import { AnimationAction, AnimationClip, AnimationMixer, Box3, BoxGeometry, Group, LoopOnce, LoopRepeat, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { clone as cloneModel } from 'three/addons/utils/SkeletonUtils.js';
import { modelUrl } from '../cloud/models';
import { createGltfLoader } from '../scene/gltf';
import { applyParts, nodeByPath } from './parts';
import { lightMetals, paintModel, paintPart } from './selection';
import type { RoomModel } from './types';

// Keeps scene objects in step with `room.models`: loads each GLB once (cached per
// path), keeps its real size, centres it on x/z with its base on y=0, and applies
// position / yaw / scale. Shared by the PC editor and the headset view.
// One GLB is downloaded and parsed once, however many rooms or models use it.
const assets = new Map<string, Promise<Object3D>>();
const clipsByPath = new Map<string, AnimationClip[]>(); // the animations each file carries
let loader: ReturnType<typeof createGltfLoader> | null = null;

function asset(path: string): Promise<Object3D> {
  let p = assets.get(path);
  if (!p) {
    p = modelUrl(path)
      .then((url) => (loader ??= createGltfLoader()).loadAsync(url))
      .then((gltf) => {
        clipsByPath.set(path, gltf.animations ?? []);
        const box = new Box3().setFromObject(gltf.scene);
        const c = box.getCenter(new Vector3());
        const wrapper = new Group();
        gltf.scene.position.set(-c.x, -box.min.y, -c.z);
        wrapper.add(gltf.scene);
        return wrapper;
      });
    p.catch(() => assets.delete(path)); // allow a retry on the next sync
    assets.set(path, p);
  }
  return p;
}

let pending = 0; // models being downloaded/parsed (any layer): the loading label waits for this to reach 0
export const modelsPending = () => pending;

// Start downloading and parsing models before they are placed (the file is then cached for the layer).
export function preloadModels(paths: string[]) {
  for (const path of new Set(paths)) void asset(path).catch(() => undefined);
}

// What colouring a model asks for, as a comparable string ('' = the file's own colours).
const partsKey = (m: RoomModel) => (m.parts && Object.keys(m.parts).length ? JSON.stringify(m.parts) : '');
const lookKey = (m: RoomModel) => [m.color, m.materialColors, m.finish, m.materialFinish].map((x) => (x && Object.keys(x).length ? JSON.stringify(x) : '')).join('|').replace(/^\|+$/, '');

export function createModelLayer(parent: Object3D, onError: (text: string, model: RoomModel) => void) {
  const holders = new Map<string, Group>();
  // The file's own animations: one mixer per placed model, driven by `update(dt)`; what plays is chosen in `model.anim`.
  interface Anim {
    mixer: AnimationMixer;
    clips: AnimationClip[];
    clip: string | null; // the one set up now
    action: AnimationAction | null;
    playing: boolean;
    started: boolean; // the automatic start has been done
  }
  const anims = new Map<string, Anim>();
  function applyAnim(m: RoomModel) {
    const st = anims.get(m.id);
    if (!st) return;
    const a = m.anim;
    const name = a?.clip && st.clips.some((c) => c.name === a.clip) ? a.clip : null;
    if (st.clip !== name) {
      st.mixer.stopAllAction();
      st.action = null;
      st.clip = name;
      if (name) {
        st.action = st.mixer.clipAction(st.clips.find((c) => c.name === name)!);
        st.action.play();
      } else st.playing = false;
    }
    if (!st.action) return;
    const loop = a?.loop ?? true;
    st.action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    st.action.clampWhenFinished = true;
    st.action.timeScale = a?.speed ?? 1;
    if (a?.auto && !st.started) {
      st.started = true;
      st.playing = true;
    }
    st.action.paused = !st.playing;
  }

  // Colours of the model, then the moved / coloured components on top; each only when it changed.
  function refresh(h: Group, m: RoomModel) {
    if (!h.children.length) return;
    const lk = lookKey(m);
    const pk = partsKey(m);
    if ((h.userData.painted ?? '') !== lk) {
      paintModel(h, m);
      h.userData.painted = lk;
      h.userData.partsPainted = null; // the materials were reset
    }
    if ((h.userData.partsKey ?? '') !== pk || (pk && !h.userData.partsApplied)) {
      applyParts(h, m.parts);
      h.userData.partsApplied = true;
      h.userData.partsKey = pk;
    }
    if ((h.userData.partsPainted ?? '') !== pk) {
      paintModel(h, m); // first the model's own look everywhere (a component's colour may have been removed)
      for (const [path, e] of Object.entries(m.parts ?? {})) {
        const node = nodeByPath(h, path);
        if (node && (e.color || e.finish)) paintPart(node, e);
      }
      h.userData.partsPainted = pk;
    }
  }

  function attach(holder: Group, m: RoomModel) {
    pending++;
    asset(m.path)
      .then((obj) => {
        const inst = cloneModel(obj) as Object3D;
        holder.add(inst);
        const clips = clipsByPath.get(m.path) ?? [];
        if (clips.length) anims.set(m.id, { mixer: new AnimationMixer(inst), clips, clip: null, action: null, playing: false, started: false });
        lightMetals(holder);
        const look = holder.userData.look as RoomModel | undefined;
        if (look) {
          refresh(holder, look);
          applyAnim(look);
        }
      })
      .catch((e: Error) => {
        onError(`${m.name}: ${e.message}`, m);
        holder.add(new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: 0xff3030, wireframe: true })));
      })
      .finally(() => pending--);
  }

  return {
    holders,
    // The animations of a model's file (empty for most), and whether one plays now.
    clips: (id: string) => (anims.get(id)?.clips ?? []).map((c) => ({ name: c.name, duration: c.duration })),
    isPlaying: (id: string) => !!anims.get(id)?.playing,
    setPlaying(id: string, on: boolean) {
      const st = anims.get(id);
      if (!st?.action) return;
      st.playing = on;
      if (on && !st.action.isRunning() && !st.action.paused && st.action.time >= st.action.getClip().duration) st.action.reset().play();
      st.action.paused = !on;
    },
    // Every frame, with the seconds since the last one.
    update(dt: number) {
      for (const st of anims.values()) if (st.playing) st.mixer.update(dt);
    },
    // Call after any change to the list or to a model's transform.
    sync(models: RoomModel[]) {
      const ids = new Set(models.map((m) => m.id));
      for (const [id, h] of holders) {
        if (!ids.has(id)) {
          parent.remove(h);
          holders.delete(id);
          anims.delete(id);
        }
      }
      for (const m of models) {
        let h = holders.get(m.id);
        if (!h) {
          h = new Group();
          h.userData.modelId = m.id;
          parent.add(h);
          holders.set(m.id, h);
          attach(h, m);
        }
        h.userData.look = m;
        refresh(h, m);
        applyAnim(m);
        h.position.set(...m.pos);
        h.rotation.set(m.tilt?.[0] ?? 0, m.yaw, m.tilt?.[1] ?? 0, 'YXZ'); // yaw first, then the tilt in the model's own frame
        h.scale.setScalar(m.scale);
      }
    },
  };
}

export type ModelLayer = ReturnType<typeof createModelLayer>;

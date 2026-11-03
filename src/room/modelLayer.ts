import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { modelUrl } from '../cloud/models';
import { createGltfLoader } from '../scene/gltf';
import { paintModel } from './selection';
import type { RoomModel } from './types';

// Keeps scene objects in step with `room.models`: loads each GLB once (cached per
// path), keeps its real size, centres it on x/z with its base on y=0, and applies
// position / yaw / scale. Shared by the PC editor and the headset view.
// One GLB is downloaded and parsed once, however many rooms or models use it.
const assets = new Map<string, Promise<Object3D>>();
let loader: ReturnType<typeof createGltfLoader> | null = null;

function asset(path: string): Promise<Object3D> {
  let p = assets.get(path);
  if (!p) {
    p = modelUrl(path)
      .then((url) => (loader ??= createGltfLoader()).loadAsync(url))
      .then((gltf) => {
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

export function createModelLayer(parent: Object3D, onError: (text: string) => void) {
  const holders = new Map<string, Group>();

  function attach(holder: Group, m: RoomModel) {
    pending++;
    asset(m.path)
      .then((obj) => {
        holder.add(obj.clone(true));
        if (holder.userData.color) {
          paintModel(holder, holder.userData.color);
          holder.userData.painted = holder.userData.color;
        }
      })
      .catch((e: Error) => {
        onError(`${m.name}: ${e.message}`);
        holder.add(new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: 0xff3030, wireframe: true })));
      })
      .finally(() => pending--);
  }

  return {
    holders,
    // Call after any change to the list or to a model's transform.
    sync(models: RoomModel[]) {
      const ids = new Set(models.map((m) => m.id));
      for (const [id, h] of holders) {
        if (!ids.has(id)) {
          parent.remove(h);
          holders.delete(id);
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
        h.userData.color = m.color;
        if ((h.userData.painted ?? '') !== (m.color ?? '') && h.children.length) {
          paintModel(h, m.color);
          h.userData.painted = m.color;
        }
        h.position.set(...m.pos);
        h.rotation.set(0, m.yaw, 0);
        h.scale.setScalar(m.scale);
      }
    },
  };
}

export type ModelLayer = ReturnType<typeof createModelLayer>;

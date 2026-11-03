/* eslint-disable @typescript-eslint/no-explicit-any */
import { MeshBasicMaterial, Object3D, PlaneGeometry, Quaternion, Vector3, type WebGLRenderer } from 'three';
import type { Panel } from './panel';

// Panels as WebXR quad layers (the equivalent of Unreal's stereo layers). The headset's compositor samples the panel's
// canvas straight to the display, with the lens correction applied once, instead of the panel being drawn into the
// eye buffer and resampled: text stays crisp. The panel's mesh stays in the scene only as the target of the pointing
// rays (not drawn while its layer works); if anything goes wrong with a layer the mesh is drawn again.
//
// Layers are composed over the 3D scene without depth testing, so the laser's end circle is a small layer of its own.
const KEY = 'immersa.layers';
export const layersPreferred = () => {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
};
const FLIP_Y = new URLSearchParams(location.search).get('flipy') !== '0'; // ?flipy=0 if a headset shows panels upside down
const REFRESH_FRAMES = 3; // a layer's image is a swapchain: after a change write it a few frames in a row

interface Item {
  canvas: HTMLCanvasElement;
  layer: any | null;
  frames: number; // frames still to write
  stamp: number;
  shown: boolean;
  failed: boolean;
  checked: boolean; // the first write was checked for GL errors
}
const item = (canvas: HTMLCanvasElement): Item => ({ canvas, layer: null, frames: 0, stamp: -1, shown: false, failed: false, checked: false });

const visible = (o: Object3D | null) => {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
};

export function createPanelLayers(renderer: WebGLRenderer, log: (text: string) => void) {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const panels = new Map<Panel, Item>();
  let enabled = layersPreferred();
  let active = false; // layers are drawing the panels right now
  let session: XRSession | null = null;
  let applied: any[] = [];
  let announced = false;
  let touched = false; // raw GL calls were made this frame
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();

  // The laser's end circle.
  const dot = document.createElement('canvas');
  dot.width = dot.height = 128;
  {
    const c = dot.getContext('2d')!;
    c.fillStyle = 'rgba(184,184,184,0.92)';
    c.beginPath();
    c.arc(64, 64, 58, 0, 2 * Math.PI);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 8;
    c.beginPath();
    c.arc(64, 64, 58, 0, 2 * Math.PI);
    c.stroke();
  }
  const reticle = item(dot);
  let reticleAsk: { pos: Vector3; toward: Vector3; radius: number } | null = null;
  const facing = new Object3D();

  const transform = (p: Vector3, q: Quaternion) => new XRRigidTransform({ x: p.x, y: p.y, z: p.z, w: 1 }, { x: q.x, y: q.y, z: q.z, w: q.w });

  function create(binding: any, ref: XRSpace, it: Item, width: number, height: number) {
    it.layer = binding.createQuadLayer({
      space: ref,
      viewPixelWidth: it.canvas.width,
      viewPixelHeight: it.canvas.height,
      layout: 'mono',
      textureType: 'texture',
      isStatic: false,
      transform: transform(pos, quat),
    });
    it.layer.width = width;
    it.layer.height = height;
  }

  function write(binding: any, frame: XRFrame, it: Item) {
    if (!it.checked) while (gl.getError() !== gl.NO_ERROR); // clear errors that are not ours before the first write
    touched = true;
    const sub = binding.getSubImage(it.layer, frame);
    const vp = sub.viewport;
    gl.bindTexture(gl.TEXTURE_2D, sub.colorTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, FLIP_Y);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, vp.x, vp.y, gl.RGBA, gl.UNSIGNED_BYTE, it.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // Brings one item up to date; returns its layer when it should be shown this frame.
  function sync(binding: any, frame: XRFrame, ref: XRSpace, it: Item, want: boolean, stamp: number, width: number, height: number, name: string) {
    if (!want || it.failed) {
      it.shown = false;
      return null;
    }
    if (!it.layer) create(binding, ref, it, width, height);
    else {
      it.layer.transform = transform(pos, quat);
      if (it.layer.width !== width) it.layer.width = width;
      if (it.layer.height !== height) it.layer.height = height;
    }
    if (!it.shown || it.stamp !== stamp) it.frames = REFRESH_FRAMES;
    if (it.layer.needsRedraw) it.frames = Math.max(it.frames, 1);
    it.shown = true;
    it.stamp = stamp;
    if (it.frames > 0) {
      write(binding, frame, it);
      it.frames--;
      if (!it.checked) {
        it.checked = true;
        const err = gl.getError();
        if (err !== gl.NO_ERROR) {
          it.failed = true;
          log(`layer ${name}: errore GL ${err}, uso la scena`);
          return null;
        }
      }
    }
    return it.layer;
  }

  return {
    // True while panels are drawn as layers.
    get active() {
      return active;
    },
    register(panel: Panel) {
      panels.set(panel, item(panel.canvas));
    },
    setEnabled(on: boolean) {
      enabled = on;
      try {
        localStorage.setItem(KEY, on ? '1' : '0');
      } catch {
        /* storage can be unavailable */
      }
    },
    // Where the laser lands; call every frame it should show (the circle is hidden otherwise).
    showReticle(at: Vector3, toward: Vector3, radius: number) {
      reticleAsk = { pos: at.clone(), toward: toward.clone(), radius };
    },
    // Once per XR frame, after the scene was rendered and the panels were placed.
    update(frame: XRFrame, ref: XRReferenceSpace) {
      if (frame.session !== session) {
        session = frame.session;
        applied = [];
        announced = false;
        for (const it of [...panels.values(), reticle]) {
          it.layer = null;
          it.shown = false;
        }
      }
      const binding = renderer.xr.getBinding() as any;
      const proj = renderer.xr.getBaseLayer() as any;
      const can = enabled && !!binding && typeof binding.createQuadLayer === 'function' && !!proj && 'textureWidth' in proj;
      const list: any[] = [];
      try {
        for (const [panel, it] of panels) {
          const mat = panel.mesh.material as MeshBasicMaterial;
          const want = can && visible(panel.mesh);
          if (want) {
            panel.mesh.updateWorldMatrix(true, false);
            panel.mesh.matrixWorld.decompose(pos, quat, scl);
            const g = (panel.mesh.geometry as PlaneGeometry).parameters;
            const layer = sync(binding, frame, ref, it, true, panel.stamp, g.width * scl.x, g.height * scl.y, 'pannello');
            if (layer) list.push(layer);
          } else {
            it.shown = false;
          }
          mat.visible = !(can && !it.failed); // drawn in the scene only when the layer is not doing it
        }
        if (can && reticleAsk) {
          facing.position.copy(reticleAsk.pos);
          facing.lookAt(reticleAsk.toward);
          pos.copy(reticleAsk.pos);
          quat.copy(facing.quaternion);
          const d = reticleAsk.radius * 2;
          const layer = sync(binding, frame, ref, reticle, true, 0, d, d, 'cerchio');
          if (layer) list.push(layer);
        } else reticle.shown = false;
        reticleAsk = null;
        if (list.length !== applied.length || list.some((l, i) => l !== applied[i])) {
          frame.session.updateRenderState({ layers: [proj, ...list] } as any);
          applied = list;
        }
        if (can && !announced && list.length) {
          announced = true;
          log(`layer attivi (${panels.size} pannelli)`);
        }
        if (!can && !announced) {
          announced = true;
          log(`layer non usati: ${enabled ? (binding ? 'non supportati' : 'binding assente') : 'disattivati'}`);
        }
        active = can && !!list.length;
      } catch (e) {
        // Anything unexpected: back to panels in the scene, for good in this session.
        for (const [panel] of panels) (panel.mesh.material as MeshBasicMaterial).visible = true;
        for (const it of panels.values()) it.failed = true;
        reticle.failed = true;
        active = false;
        try {
          frame.session.updateRenderState({ layers: [proj] } as any);
        } catch {
          /* the session may be ending */
        }
        applied = [];
        log(`layer: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (touched) {
        touched = false;
        if (touched) {
        touched = false;
        renderer.resetState(); // the raw GL calls above changed state that three.js caches
      }
      }
    },
  };
}

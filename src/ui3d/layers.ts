/* eslint-disable @typescript-eslint/no-explicit-any */
import { Matrix4, MeshBasicMaterial, Object3D, PlaneGeometry, Quaternion, Vector3, type WebGLRenderer } from 'three';
import { FADE, LASER_OPACITY, MOVING_COLOR, RADIUS } from './laser';
import type { Panel } from './panel';
import type { LabelLayer } from '../room/measureView';

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
// The headset's quad layers come out about twice the size asked for here (measured on a Quest 3): sizes are given halved.
const QUAD_SIZE = 0.5;
const MAX_LABEL_LAYERS = 10; // the compositor handles a limited number of layers: the nearest labels get one
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
  const labelItems = new Map<HTMLCanvasElement, Item>();
  const labelMats = new Map<HTMLCanvasElement, MeshBasicMaterial>();
  let labelSource: ((max: number) => LabelLayer[]) | null = null;
  let enabled = layersPreferred();
  let active = false; // layers are drawing the panels right now
  let session: XRSession | null = null;
  let applied: any[] = [];
  let announced = false;
  let touched = false; // raw GL calls were made this frame
  let savedActive: number | null = null; // the texture unit three.js had active before them
  // A texture unit three.js never uses (it stays within MAX_TEXTURE_IMAGE_UNITS): the layer images are written there.
  const SPARE_UNIT = gl.TEXTURE0 + Math.min(gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS) as number, 32) - 1;
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();

  // The laser's end circle (grey; turquoise while something is being moved).
  const dot = document.createElement('canvas');
  dot.width = dot.height = 128;
  function drawDot(moving: boolean) {
    const c = dot.getContext('2d')!;
    c.clearRect(0, 0, 128, 128);
    c.fillStyle = moving ? MOVING_COLOR : 'rgba(184,184,184,0.92)';
    c.beginPath();
    c.arc(64, 64, 58, 0, 2 * Math.PI);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 8;
    c.beginPath();
    c.arc(64, 64, 58, 0, 2 * Math.PI);
    c.stroke();
  }
  drawDot(false);
  // The laser beam: a flat ribbon turned towards the eye, its image redrawn every frame (the fades are in metres).
  const ribbon = document.createElement('canvas');
  ribbon.width = 256;
  ribbon.height = 16;
  const ribbonCtx = ribbon.getContext('2d')!;
  function drawRibbon(length: number, moving: boolean) {
    const c = ribbonCtx;
    const { width: w, height: h } = ribbon;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, w, h);
    c.fillStyle = moving ? MOVING_COLOR : '#ffffff';
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'destination-in';
    const along = c.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= 32; i++) {
      const x = i / 32;
      const a = Math.min(1, (x * length) / FADE, ((1 - x) * length) / FADE);
      along.addColorStop(x, `rgba(255,255,255,${a * a * LASER_OPACITY})`);
    }
    c.fillStyle = along;
    c.fillRect(0, 0, w, h);
    const across = c.createLinearGradient(0, 0, 0, h);
    across.addColorStop(0, 'rgba(255,255,255,0)');
    across.addColorStop(0.3, 'rgba(255,255,255,1)');
    across.addColorStop(0.7, 'rgba(255,255,255,1)');
    across.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = across;
    c.fillRect(0, 0, w, h);
    c.globalCompositeOperation = 'source-over';
  }
  const beam = item(ribbon);
  let beamAsk: { origin: Vector3; dir: Vector3; length: number; toward: Vector3; moving: boolean } | null = null;
  let beamFrame = 0;
  const basis = new Matrix4();
  const bx = new Vector3();
  const by = new Vector3();
  const bz = new Vector3();
  const reticle = item(dot);
  let reticleAsk: { pos: Vector3; toward: Vector3; radius: number; moving: boolean } | null = null;
  let reticleMoving = false;
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
    it.layer.width = width * QUAD_SIZE;
    it.layer.height = height * QUAD_SIZE;
  }

  function write(binding: any, frame: XRFrame, it: Item) {
    if (!it.checked) while (gl.getError() !== gl.NO_ERROR); // clear errors that are not ours before the first write
    touched = true;
    const sub = binding.getSubImage(it.layer, frame);
    const vp = sub.viewport;
    // three.js remembers which texture is bound on which unit and does not bind again what it thinks is there: writing on
    // the unit it had active replaced one of its textures behind its back and the models were drawn with the wrong texture.
    savedActive ??= gl.getParameter(gl.ACTIVE_TEXTURE) as number;
    gl.activeTexture(SPARE_UNIT);
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
      if (it.layer.width !== width * QUAD_SIZE) it.layer.width = width * QUAD_SIZE;
      if (it.layer.height !== height * QUAD_SIZE) it.layer.height = height * QUAD_SIZE;
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
    // Measure and annotation labels: asked every frame for the ones that should be layers.
    setLabelSource(fn: (max: number) => LabelLayer[]) {
      labelSource = fn;
    },
    setEnabled(on: boolean) {
      enabled = on;
      try {
        localStorage.setItem(KEY, on ? '1' : '0');
      } catch {
        /* storage can be unavailable */
      }
    },
    // The laser beam from the hand; call every frame it should show.
    showBeam(origin: Vector3, dir: Vector3, length: number, toward: Vector3, moving = false) {
      beamAsk = { origin: origin.clone(), dir: dir.clone(), length, toward: toward.clone(), moving };
    },
    // Where the laser lands; call every frame it should show (the circle is hidden otherwise).
    showReticle(at: Vector3, toward: Vector3, radius: number, moving = false) {
      reticleAsk = { pos: at.clone(), toward: toward.clone(), radius, moving };
    },
    // Once per XR frame, after the scene was rendered and the panels were placed.
    update(frame: XRFrame, ref: XRReferenceSpace) {
      if (frame.session !== session) {
        session = frame.session;
        applied = [];
        announced = false;
        for (const it of [...panels.values(), ...labelItems.values(), reticle, beam]) {
          it.layer = null;
          it.shown = false;
        }
      }
      const binding = renderer.xr.getBinding() as any;
      const proj = renderer.xr.getBaseLayer() as any;
      const can = enabled && !!binding && typeof binding.createQuadLayer === 'function' && !!proj && 'textureWidth' in proj;
      const list: any[] = [];
      try {
        // Labels first: layers are drawn in this order, and the menu must stay above them.
        const wanted = can && labelSource ? labelSource(MAX_LABEL_LAYERS) : [];
        const seen = new Set<HTMLCanvasElement>();
        for (const lab of wanted) {
          let it = labelItems.get(lab.canvas);
          if (!it) labelItems.set(lab.canvas, (it = item(lab.canvas)));
          seen.add(lab.canvas);
          lab.mesh.updateWorldMatrix(true, false);
          lab.mesh.matrixWorld.decompose(pos, quat, scl);
          const layer = sync(binding, frame, ref, it, true, lab.stamp, scl.x, scl.y, 'etichetta');
          if (layer) list.push(layer);
          const lm = lab.mesh.material as MeshBasicMaterial;
          labelMats.set(lab.canvas, lm);
          lm.visible = !layer;
        }
        for (const [canvas, it] of labelItems)
          if (!seen.has(canvas)) {
            it.shown = false;
            if (labelMats.has(canvas)) labelMats.get(canvas)!.visible = true; // back in the scene
          }
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
        if (can && beamAsk) {
          // x along the beam, z towards the eye: the ribbon always shows its flat side
          bx.copy(beamAsk.dir);
          pos.copy(beamAsk.origin).addScaledVector(bx, beamAsk.length / 2);
          bz.copy(beamAsk.toward).sub(pos);
          bz.addScaledVector(bx, -bz.dot(bx));
          if (bz.lengthSq() < 1e-6) bz.set(0, 1, 0);
          bz.normalize();
          by.crossVectors(bz, bx);
          quat.setFromRotationMatrix(basis.makeBasis(bx, by, bz));
          drawRibbon(beamAsk.length, beamAsk.moving);
          const layer = sync(binding, frame, ref, beam, true, ++beamFrame, beamAsk.length, RADIUS * 2.4, 'raggio');
          if (layer) list.push(layer);
        } else beam.shown = false;
        beamAsk = null;
        if (can && reticleAsk) {
          facing.position.copy(reticleAsk.pos);
          facing.lookAt(reticleAsk.toward);
          pos.copy(reticleAsk.pos);
          quat.copy(facing.quaternion);
          const d = reticleAsk.radius * 2;
          if (reticleMoving !== reticleAsk.moving) {
            reticleMoving = reticleAsk.moving;
            drawDot(reticleMoving);
          }
          const layer = sync(binding, frame, ref, reticle, true, reticleMoving ? 1 : 0, d, d, 'cerchio');
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
        for (const m of labelMats.values()) m.visible = true;
        for (const it of labelItems.values()) it.failed = true;
        reticle.failed = true;
        beam.failed = true;
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
        // Put back the one piece of GL state we moved (see write()).
        touched = false;
        if (savedActive !== null) gl.activeTexture(savedActive);
        savedActive = null;
      }
    },
  };
}

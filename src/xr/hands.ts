import { BackSide, DoubleSide, Group, MeshBasicMaterial, SkinnedMesh, Vector3, type Mesh, type Object3D, type PlaneGeometry, type Scene, type WebGLRenderer } from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

// Virtual hands like the system ones: the standard skinned hand mesh (generic-hand profile of the WebXR input
// profiles, downloaded when the first hand appears), dark and semi-transparent, with a white outline made by a
// slightly inflated copy drawn behind. If the mesh cannot be loaded no hand is drawn (the passthrough hand stays).
const fill = new MeshBasicMaterial({ color: 0x0a1424, transparent: true, opacity: 0.32, side: DoubleSide });
const edge = new MeshBasicMaterial({ color: 0xffffff, side: BackSide });
edge.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * 0.0035;');
};

function style(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.material = fill;
    mesh.renderOrder = 1401; // over everything, the keyboard (1300) included
    mesh.frustumCulled = false;
    mesh.raycast = () => undefined; // never picked
    const shell = new SkinnedMesh(mesh.geometry, edge);
    shell.bind(mesh.skeleton, mesh.bindMatrix);
    shell.renderOrder = 1400;
    shell.frustumCulled = false;
    shell.raycast = () => undefined;
    mesh.parent?.add(shell);
  });
}

// A hand that reaches a surface (the keyboard) rests on it: the virtual hand is lifted by how far the real one went through,
// so the fingers never go behind the keys. Far enough through (the real hand is clearly taking its leave), it lets go.
const REST_FULL = 0.1; // m through the surface up to which the virtual hand stays on it
const REST_GONE = 0.17; // m: from here the virtual hand follows the real one again

export function createHands(renderer: WebGLRenderer, scene: Scene, surface: () => Object3D | null = () => null) {
  const factory = new XRHandModelFactory(null, style);
  const group = new Group();
  scene.add(group);
  const hands: { hand: Group; model: Object3D }[] = [];
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i);
    const model = factory.createHandModel(hand, 'mesh');
    hand.add(model);
    group.add(hand);
    hands.push({ hand, model });
  }
  // A mesh whose joints were never tracked (or are lost) sits at the origin in its bind pose: draw it only while the wrist is tracked.
  const lift = new Map<Object3D, number>(); // how far each virtual hand is lifted now (smoothed)
  const local = new Vector3();
  const normal = new Vector3();
  scene.onBeforeRender = () => {
    const plane = surface();
    if (plane) {
      plane.updateWorldMatrix(true, false);
      normal.set(0, 0, 1).transformDirection(plane.matrixWorld);
    }
    const g = plane ? (((plane as Mesh).geometry as PlaneGeometry).parameters ?? null) : null;
    for (const h of hands) {
      const joints = (h.hand as unknown as { joints?: Record<string, Object3D & { jointRadius?: number }> }).joints;
      h.model.visible = !!joints?.wrist?.visible;
      let depth = 0;
      if (plane && g && joints && h.model.visible) {
        for (const j of Object.values(joints)) {
          if (!j.visible) continue;
          local.copy(j.position);
          plane.worldToLocal(local);
          if (Math.abs(local.x) > g.width / 2 + 0.03 || Math.abs(local.y) > g.height / 2 + 0.03) continue;
          depth = Math.max(depth, (j.jointRadius ?? 0.008) - local.z); // in front of the surface: local.z > 0
        }
      }
      // rest on it up to REST_FULL, fade out to nothing by REST_GONE
      const want = depth <= 0 ? 0 : depth <= REST_FULL ? depth : depth >= REST_GONE ? 0 : depth * (1 - (depth - REST_FULL) / (REST_GONE - REST_FULL));
      const now = (lift.get(h.model) ?? 0) + (want - (lift.get(h.model) ?? 0)) * 0.6;
      lift.set(h.model, now);
      if (now > 1e-4) {
        h.model.position.copy(normal).multiplyScalar(now);
        h.model.updateMatrixWorld(true); // the hand model was already updated this frame: update it again with the lift
      } else if (h.model.position.lengthSq() > 0) {
        h.model.position.set(0, 0, 0);
        h.model.updateMatrixWorld(true);
      }
    }
  };
  return { group };
}

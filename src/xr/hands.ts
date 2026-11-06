import { BackSide, DoubleSide, Group, MeshBasicMaterial, SkinnedMesh, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

// Virtual hands like the system ones: the standard skinned hand mesh (generic-hand profile of the WebXR input
// profiles, downloaded when the first hand appears), dark and semi-transparent, with an azure outline made by a
// slightly inflated copy drawn behind. If the mesh cannot be loaded no hand is drawn (the passthrough hand stays).
const fill = new MeshBasicMaterial({ color: 0x0a1424, transparent: true, opacity: 0.6, side: DoubleSide });
const edge = new MeshBasicMaterial({ color: 0x2ec4ff, side: BackSide });
edge.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * 0.0035;');
};

function style(root: Object3D) {
  root.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.material = fill;
    mesh.renderOrder = 1001;
    mesh.frustumCulled = false;
    mesh.raycast = () => undefined; // never picked
    const shell = new SkinnedMesh(mesh.geometry, edge);
    shell.bind(mesh.skeleton, mesh.bindMatrix);
    shell.renderOrder = 1000;
    shell.frustumCulled = false;
    shell.raycast = () => undefined;
    mesh.parent?.add(shell);
  });
}

export function createHands(renderer: WebGLRenderer, scene: Scene) {
  const factory = new XRHandModelFactory(null, style);
  const group = new Group();
  scene.add(group);
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i);
    hand.add(factory.createHandModel(hand, 'mesh'));
    group.add(hand);
  }
  return { group };
}

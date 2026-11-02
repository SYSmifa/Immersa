import { CylinderGeometry, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';

// A thin visible laser from the hand; the tip shows the target (white: nothing, azure: a model, green: a button).
const UP = new Vector3(0, 1, 0);
export function createLaser() {
  const geo = new CylinderGeometry(0.0015, 0.0015, 1, 6, 1, true).translate(0, 0.5, 0);
  const mat = new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthTest: false });
  const mesh = new Mesh(geo, mat);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  mesh.visible = false;
  const q = new Quaternion();
  return {
    mesh,
    show(origin: Vector3, dir: Vector3, length: number, color: number) {
      mesh.visible = true;
      mesh.position.copy(origin);
      mesh.quaternion.copy(q.setFromUnitVectors(UP, dir));
      mesh.scale.set(1, length, 1);
      mat.color.set(color);
    },
    hide() {
      mesh.visible = false;
    },
  };
}

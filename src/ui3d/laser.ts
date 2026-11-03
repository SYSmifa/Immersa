import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, RingGeometry, ShaderMaterial, Vector3 } from 'three';

// The hand's laser, in the style of Meta's: a soft white beam that fades in at the hand and out at the tip, and a grey
// circle where it lands that shrinks while the pinch is held.
export const LASER_OPACITY = 1; // the middle of the beam is fully opaque
export const FADE = 0.45; // m of fade at each end
export const RADIUS = 0.0022; // m (beam is 4.4 mm thick)
const RETICLE = 0.0094; // m, radius of the circle
const RETICLE_PINCH = 0.6; // its size while pinching, as a fraction

const UP = new Vector3(0, 1, 0);
export function createLaser() {
  const geo = new CylinderGeometry(RADIUS, RADIUS, 1, 8, 1, true).translate(0, 0.5, 0); // y: 0 at the hand .. 1 at the tip
  const beam = new ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { beamLength: { value: 1 }, fade: { value: FADE }, opacity: { value: LASER_OPACITY } },
    vertexShader: 'varying float vY; void main() { vY = position.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform float beamLength; uniform float fade; uniform float opacity; varying float vY;' +
      'void main() { float d = vY * beamLength; float a = smoothstep(0.0, fade, d) * smoothstep(0.0, fade, beamLength - d);' +
      'a *= a; gl_FragColor = vec4(1.0, 1.0, 1.0, a * opacity); }',
  });
  const mesh = new Mesh(geo, beam);
  mesh.renderOrder = 1000;
  mesh.frustumCulled = false;
  mesh.visible = false;

  const reticle = new Group();
  const disc = new Mesh(new CircleGeometry(1, 32), new MeshBasicMaterial({ color: 0xb8b8b8, transparent: true, opacity: 0.9, depthTest: false }));
  const ring = new Mesh(new RingGeometry(0.92, 1, 32), new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
  disc.renderOrder = 1001;
  ring.renderOrder = 1002;
  reticle.add(disc, ring);
  reticle.visible = false;
  let size = 1; // 1 = resting, RETICLE_PINCH = pinching (eased)

  const root = new Group();
  root.add(mesh, reticle);
  const q = new Quaternion();
  return {
    mesh: root,
    meshBeam: true, // false: the beam is drawn as a layer by the caller (see layers.ts)
    meshReticle: true, // false: the circle is drawn as a layer by the caller (see layers.ts)
    // `hit`: the beam ends on something (a panel, a model) and the circle is shown there; `toward` is the head, which the
    // circle faces. `pinching` shrinks the circle.
    show(origin: Vector3, dir: Vector3, length: number, hit: boolean, pinching: boolean, toward: Vector3): { pos: Vector3; radius: number } | null {
      mesh.visible = this.meshBeam;
      mesh.position.copy(origin);
      mesh.quaternion.copy(q.setFromUnitVectors(UP, dir));
      mesh.scale.set(1, length, 1);
      beam.uniforms.beamLength.value = length;
      reticle.visible = false;
      if (!hit) return null;
      size += ((pinching ? RETICLE_PINCH : 1) - size) * 0.35;
      const at = origin.clone().addScaledVector(dir, length);
      // A little bigger with distance, so the circle stays readable.
      const radius = RETICLE * size * Math.max(1, Math.min(2.5, length * 0.7));
      if (this.meshReticle) {
        reticle.visible = true;
        reticle.position.copy(at);
        reticle.lookAt(toward);
        reticle.scale.setScalar(radius);
      }
      return { pos: at, radius };
    },
    hide() {
      mesh.visible = false;
      reticle.visible = false;
    },
  };
}

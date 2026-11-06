import { Color, CylinderGeometry, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, SphereGeometry, Vector3, type Scene, BackSide } from 'three';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Virtual hands like the system ones: a dark, semi-transparent hand with an azure outline, built from the 25 tracked
// joints (a sphere per joint, a cylinder per bone, a slightly larger azure shell behind for the outline). Only for
// tracked hands (controllers keep their own rendering by the system).
const J = 25;
const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24]];
const BONES: [number, number][] = [];
for (const f of FINGERS) {
  BONES.push([0, f[0]]);
  for (let i = 1; i < f.length; i++) BONES.push([f[i - 1], f[i]]);
}
for (const [a, b] of [[5, 10], [10, 15], [15, 20], [6, 11], [11, 16], [16, 21]]) BONES.push([a, b]); // fills the palm

const FILL = new Color(0x0a1424);
const EDGE = new Color(0x2ec4ff);
const OUT = 1.18; // outline shell scale
const PAD = 0.0015; // m, the hand is drawn a little fatter than the tracked joint radii

class HandModel {
  readonly root = new Group();
  private sphereFill: InstancedMesh;
  private sphereEdge: InstancedMesh;
  private boneFill: InstancedMesh;
  private boneEdge: InstancedMesh;
  private pose = new Float32Array(J * 16);
  private radii = new Float32Array(J);
  private m = new Matrix4();
  private q = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private a = new Vector3();
  private b = new Vector3();
  private s = new Vector3();

  constructor() {
    const sg = new SphereGeometry(1, 12, 8);
    const cg = new CylinderGeometry(1, 1, 1, 10, 1, true);
    const fill = () => new MeshBasicMaterial({ color: FILL, transparent: true, opacity: 0.55, depthWrite: true });
    const edge = () => new MeshBasicMaterial({ color: EDGE, side: BackSide });
    const mk = (g: SphereGeometry | CylinderGeometry, mat: MeshBasicMaterial, n: number, order: number) => {
      const im = new InstancedMesh(g, mat, n);
      im.instanceMatrix.setUsage(DynamicDrawUsage);
      im.frustumCulled = false;
      im.renderOrder = order;
      im.raycast = () => undefined; // never picked
      this.root.add(im);
      return im;
    };
    this.sphereEdge = mk(sg, edge(), J, 1000);
    this.boneEdge = mk(cg, edge(), BONES.length, 1000);
    this.sphereFill = mk(sg, fill(), J, 1001);
    this.boneFill = mk(cg, fill(), BONES.length, 1001);
    this.root.visible = false;
  }

  update(frame: XRFrame, hand: any, ref: XRReferenceSpace): boolean {
    const f = frame as any;
    const ok = f.fillPoses?.(hand.values(), ref, this.pose) && f.fillJointRadii?.(hand.values(), this.radii);
    if (!ok) return false;
    for (let i = 0; i < J; i++) {
      const r = (this.radii[i] || 0.008) + PAD;
      this.m.fromArray(this.pose, i * 16);
      this.a.setFromMatrixPosition(this.m);
      this.m.makeScale(r, r, r).setPosition(this.a);
      this.sphereFill.setMatrixAt(i, this.m);
      this.m.makeScale(r * OUT, r * OUT, r * OUT).setPosition(this.a);
      this.sphereEdge.setMatrixAt(i, this.m);
    }
    BONES.forEach(([i, j], k) => {
      this.a.setFromMatrixPosition(this.m.fromArray(this.pose, i * 16));
      this.b.setFromMatrixPosition(this.m.fromArray(this.pose, j * 16));
      const len = this.a.distanceTo(this.b);
      const r = ((this.radii[i] || 0.008) + (this.radii[j] || 0.008)) / 2 + PAD;
      this.q.setFromUnitVectors(this.up, this.s.subVectors(this.b, this.a).normalize());
      const mid = this.s.copy(this.a).add(this.b).multiplyScalar(0.5);
      this.m.compose(mid, this.q, new Vector3(r, len, r));
      this.boneFill.setMatrixAt(k, this.m);
      this.m.compose(mid, this.q, new Vector3(r * OUT, len, r * OUT));
      this.boneEdge.setMatrixAt(k, this.m);
    });
    for (const im of [this.sphereFill, this.sphereEdge, this.boneFill, this.boneEdge]) im.instanceMatrix.needsUpdate = true;
    return true;
  }
}

export function createHands(scene: Scene) {
  const models = new Map<XRInputSource, HandModel>();
  return {
    // Call every frame: draws each tracked hand, hides the ones no longer tracked.
    update(frame: XRFrame, ref: XRReferenceSpace) {
      const live = new Set<XRInputSource>();
      for (const src of frame.session.inputSources) {
        const hand = (src as any).hand;
        if (!hand) continue;
        live.add(src);
        let m = models.get(src);
        if (!m) {
          m = new HandModel();
          scene.add(m.root);
          models.set(src, m);
        }
        m.root.visible = m.update(frame, hand, ref);
      }
      for (const [src, m] of models) {
        if (!live.has(src)) {
          scene.remove(m.root);
          models.delete(src);
        }
      }
    },
    hide() {
      for (const m of models.values()) m.root.visible = false;
    },
  };
}

import { Vector3 } from 'three';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Position of a pinch: midpoint of thumb and index tips for hands, grip for controllers.
export function pinchPoint(frame: XRFrame, src: XRInputSource, ref: XRReferenceSpace): Vector3 | null {
  const hand = (src as any).hand;
  if (hand) {
    const a = hand.get('thumb-tip');
    const b = hand.get('index-finger-tip');
    const pa = a && frame.getJointPose?.(a, ref);
    const pb = b && frame.getJointPose?.(b, ref);
    if (!pa || !pb) return null;
    const u = pa.transform.position;
    const v = pb.transform.position;
    return new Vector3((u.x + v.x) / 2, (u.y + v.y) / 2, (u.z + v.z) / 2);
  }
  return gripPoint(frame, src, ref);
}

// Where the hand / controller is (wrist for hands), or null if untracked.
export function handAnchor(frame: XRFrame, src: XRInputSource, ref: XRReferenceSpace): Vector3 | null {
  const wrist = (src as any).hand?.get('wrist');
  const pose = wrist ? frame.getJointPose?.(wrist, ref) : null;
  if (pose) {
    const p = pose.transform.position;
    return new Vector3(p.x, p.y, p.z);
  }
  return gripPoint(frame, src, ref);
}

function gripPoint(frame: XRFrame, src: XRInputSource, ref: XRReferenceSpace): Vector3 | null {
  const space = src.gripSpace ?? src.targetRaySpace;
  const pose = space && frame.getPose(space, ref);
  if (!pose) return null;
  const p = pose.transform.position;
  return new Vector3(p.x, p.y, p.z);
}

// Where the palm of a tracked hand points (unit vector in `ref`), or null for controllers / an untracked hand. Taken from
// the positions of the wrist and of the index and little finger bases, so it does not depend on joint axis conventions.
export function palmNormal(frame: XRFrame, src: XRInputSource, ref: XRReferenceSpace): { normal: Vector3; wrist: Vector3 } | null {
  const hand = (src as any).hand;
  if (!hand) return null;
  const at = (name: string) => {
    const joint = hand.get(name);
    const pose = joint && frame.getJointPose?.(joint, ref);
    return pose ? new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z) : null;
  };
  const wrist = at('wrist');
  const index = at('index-finger-metacarpal');
  const little = at('pinky-finger-metacarpal');
  if (!wrist || !index || !little) return null;
  const normal = index.sub(wrist).cross(little.sub(wrist)).normalize();
  if (src.handedness === 'left') normal.negate(); // mirrored hand
  return { normal, wrist };
}

// The pointing pose of a tracked hand: index finger out, the other three curled, thumb away from the index (not a pinch).
// A finger is "out" when its tip is much farther from the wrist than its first knuckle is. Returns the index fingertip, else null;
// `info.text` says what was measured (shown on the card while the gesture is being tuned).
export function pointingTip(frame: XRFrame, src: XRInputSource, ref: XRReferenceSpace, info?: { text: string }): Vector3 | null {
  const hand = (src as any).hand;
  if (!hand) {
    if (info) info.text = 'nessuna mano (controller?)';
    return null;
  }
  const at = (name: string) => {
    const joint = hand.get(name);
    const pose = joint && frame.getJointPose?.(joint, ref);
    return pose ? new Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z) : null;
  };
  const wrist = at('wrist');
  const tip = at('index-finger-tip');
  const thumb = at('thumb-tip');
  if (!wrist || !tip || !thumb) {
    if (info) info.text = 'mano non vista';
    return null;
  }
  const ratio = (finger: string) => {
    const t = at(`${finger}-finger-tip`);
    const k = at(`${finger}-finger-phalanx-proximal`);
    return t && k ? t.distanceTo(wrist) / Math.max(0.01, k.distanceTo(wrist)) : null;
  };
  const r = ['index', 'middle', 'ring', 'pinky'].map(ratio);
  const gap = thumb.distanceTo(tip);
  const f = (v: number | null) => (v === null ? '?' : v.toFixed(1));
  const out = r[0] !== null && r[0] >= 1.4; // the index is out
  const apart = gap >= 0.04;
  const curled = r.slice(1).filter((v) => v !== null && v < 1.25).length; // the others are folded
  if (info) info.text = `indice ${f(r[0])} (≥1,4) · altre ${f(r[1])} ${f(r[2])} ${f(r[3])} (<1,25) · pollice ${(gap * 100).toFixed(0)} cm (≥4) → ${out && apart && curled >= 2 ? 'OK' : !out ? 'indice non teso' : !apart ? 'pollice vicino' : 'altre dita aperte'}`;
  return out && apart && curled >= 2 ? tip : null;
}

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

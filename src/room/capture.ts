import type { RoomPlane } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Planes currently detected by the headset, as plane centres in `ref` space.
export function readPlanes(frame: XRFrame, ref: XRReferenceSpace): RoomPlane[] {
  const out: RoomPlane[] = [];
  for (const plane of ((frame as any).detectedPlanes ?? []) as Set<any>) {
    const pose = frame.getPose(plane.planeSpace, ref);
    if (!pose) continue;
    const p = pose.transform.position;
    out.push({ label: plane.semanticLabel || plane.orientation || '?', pos: [p.x, p.y, p.z] });
  }
  return out;
}

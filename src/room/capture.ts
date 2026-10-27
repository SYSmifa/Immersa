import type { RoomPlane } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// Planes currently detected by the headset, in `ref` space.
export function readPlanes(frame: XRFrame, ref: XRReferenceSpace): RoomPlane[] {
  const out: RoomPlane[] = [];
  for (const plane of ((frame as any).detectedPlanes ?? []) as Set<any>) {
    const pose = frame.getPose(plane.planeSpace, ref);
    if (!pose) continue;
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    out.push({
      label: plane.semanticLabel || plane.orientation || '?',
      pos: [p.x, p.y, p.z],
      quat: [q.x, q.y, q.z, q.w].map(r3) as RoomPlane['quat'],
      poly: ((plane.polygon ?? []) as DOMPointReadOnly[]).flatMap((v) => [r3(v.x), r3(v.z)]),
    });
  }
  return out;
}

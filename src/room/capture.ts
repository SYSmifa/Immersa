import type { RoomBox, RoomPlane } from './types';

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

const MAX_BOX_VERTICES = 64; // volumes are simple boxes; the room's global mesh has thousands

// Furniture volumes: detected meshes that are not the global mesh, as oriented boxes.
export function readBoxes(frame: XRFrame, ref: XRReferenceSpace): RoomBox[] {
  const out: RoomBox[] = [];
  for (const mesh of ((frame as any).detectedMeshes ?? []) as Set<any>) {
    const label = String(mesh.semanticLabel ?? '').toLowerCase();
    const v = mesh.vertices as Float32Array | undefined;
    if (!v || v.length < 9 || v.length > 3 * MAX_BOX_VERTICES || label === 'global mesh') continue;
    const pose = frame.getPose(mesh.meshSpace, ref);
    if (!pose) continue;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < v.length; i++) {
      min[i % 3] = Math.min(min[i % 3], v[i]);
      max[i % 3] = Math.max(max[i % 3], v[i]);
    }
    const p = pose.transform.position;
    const q = pose.transform.orientation;
    out.push({
      label: label || '?',
      pos: [p.x, p.y, p.z],
      quat: [q.x, q.y, q.z, q.w].map(r3) as RoomBox['quat'],
      min: min.map(r3) as RoomBox['min'],
      max: max.map(r3) as RoomBox['max'],
    });
  }
  return out;
}

// Run: npx tsx docs/test-plans/gen-anchors-golden.mts
// Writes unity/Tests/Core.Tests/Fixtures/anchors-golden.json: random (irregular) rooms and what src/room/anchors.ts (the source of
// truth) computes for them. The C# port (unity/Assets/Scripts/Core/Anchors.cs) is tested against it by `dotnet run`.
import { writeFileSync } from 'node:fs';
import { Quaternion, Vector3 } from 'three';
import { alignFromTouches, floorHeight, suggestCorners } from '../../src/room/anchors.ts';
import type { RoomPlane } from '../../src/room/types.ts';

let seed = 777;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 1000) / 1000;

// A wall plane at `pos`, facing `normal` (horizontal), `h` high and `len` long.
const plane = (label: string, pos: [number, number, number], normal: [number, number, number], len: number, h: number): RoomPlane => {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...normal));
  return { label, pos, quat: [q.x, q.y, q.z, q.w], poly: [-len / 2, -h / 2, len / 2, -h / 2, len / 2, h / 2, -len / 2, h / 2] };
};

const scenarios = [];
for (let n = 0; n < 25; n++) {
  // an irregular convex polygon: 4-6 corners at random angles and radii (no two equal diagonals)
  const k = 4 + Math.floor(rnd() * 3);
  const angs = Array.from({ length: k }, (_, i) => ((i + r(0.1, 0.9)) / k) * Math.PI * 2);
  const pts: [number, number][] = angs.map((a) => [r(1.5, 4) * Math.cos(a) + r(-0.5, 0.5), r(1.5, 4) * Math.sin(a) + r(-0.5, 0.5)]);
  const planes: RoomPlane[] = [];
  const floorY = r(-0.05, 0.1);
  for (let i = 0; i < k; i++) {
    const a = pts[i], b = pts[(i + 1) % k];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.3) continue;
    const nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len; // a horizontal normal
    const mid: [number, number, number] = [(a[0] + b[0]) / 2, floorY + 1.25, (a[1] + b[1]) / 2];
    planes.push(plane('wall', mid, [nx, 0, nz], len + r(-0.3, 0.3), 2.5));
    if (rnd() < 0.4) planes.push(plane(rnd() < 0.5 ? 'door' : 'window', [mid[0] + nx * 0.02, floorY + 1, mid[2] + nz * 0.02], [nx, 0, nz], r(0.5, 1.2), 2));
  }
  if (rnd() < 0.7) planes.push({ label: 'floor', pos: [0, floorY, 0], quat: [0, 0, 0, 1], poly: [-2, -2, 2, -2, 2, 2, -2, 2] });
  if (rnd() < 0.3) planes.push({ label: 'table', pos: [0, 0.4, 0], quat: [0, 0, 0, 1], poly: [-1, -1, 1, -1, 1, 1, -1, 1] });
  const plan = suggestCorners(planes);
  const touches = plan
    ? (() => {
        const yaw = r(0, 6.2), tx = r(-3, 3), tz = r(-3, 3);
        const put = (p: [number, number, number]): [number, number, number] => [Math.cos(yaw) * p[0] - Math.sin(yaw) * p[2] + tx + r(-0.05, 0.05), p[1] + 0.1, Math.sin(yaw) * p[0] + Math.cos(yaw) * p[2] + tz + r(-0.05, 0.05)];
        const wrong = rnd() < 0.3;
        const ta = put(plan.a);
        const tb = wrong ? put([plan.a[0] + 1.3, plan.a[1], plan.a[2] + 0.4]) : put(plan.b);
        const floorLive = rnd() < 0.5 ? r(-0.1, 0.2) : null;
        return { ta, tb, floorLive, result: alignFromTouches(plan.a, plan.b, ta, tb, floorLive) };
      })()
    : null;
  scenarios.push({ planes, expected: { floorHeight: floorHeight(planes), plan, touches } });
}
writeFileSync('unity/Tests/Core.Tests/Fixtures/anchors-golden.json', JSON.stringify({ scenarios }));
console.log('written', scenarios.length, 'scenarios;', scenarios.filter((s) => s.expected.plan).length, 'with corners');

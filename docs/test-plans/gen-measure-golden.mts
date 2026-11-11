// Run: npx tsx docs/test-plans/gen-measure-golden.mts
// Writes unity/Tests/Core.Tests/Fixtures/measure-golden.json: random rooms and what src/room/measure.ts (the source of truth)
// computes for them. The C# port (unity/Assets/Scripts/Core/Measure.cs) is tested against this file by `dotnet run`.
import { writeFileSync } from 'node:fs';
import { Euler, Quaternion, Vector3 } from 'three';
import { boxSolid, dimsOfSolid, dimsOfStructure, gapsOfSolid, modelSolid, planeSeg, roomAxes, solidSegs, wallSegs, ceilingYOf, floorYOf } from '../../src/room/measure.ts';
import type { RoomBox, RoomModel, RoomPlane, Structure } from '../../src/room/types.ts';

let seed = 12345;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 1000) / 1000;
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];

const scenarios = [];
for (let n = 0; n < 25; n++) {
  const W = r(3, 9);
  const D = r(3, 7);
  const rot = r(0, 6.2);
  const rotp = ([x, z]: [number, number]): [number, number] => [Math.round((x * Math.cos(rot) - z * Math.sin(rot)) * 1000) / 1000, Math.round((x * Math.sin(rot) + z * Math.cos(rot)) * 1000) / 1000];
  const corners: [number, number][] = [rotp([0, 0]), rotp([W, 0]), rotp([W, D]), rotp([0, D])];
  const walls: Structure[] = corners.map((c, i) => ({
    id: `w${i}`, roomId: 'r', kind: 'wall', a: c, b: corners[(i + 1) % 4], y: 0, height: r(2.4, 3), thickness: r(0.08, 0.3),
    ...(rnd() < 0.6 ? { align: pick(['left', 'center', 'right'] as const) } : {}),
    ...(rnd() < 0.2 ? { xf: { d: [r(-0.2, 0.2), r(-0.2, 0.2)] as [number, number], yaw: r(-0.1, 0.1), scale: r(0.9, 1.1) } } : {}),
  }));
  const floors: Structure[] = [
    { id: 'f0', roomId: 'r', kind: 'floor', a: [0, 0], b: [r(1, 4), r(1, 4)], y: 0, height: 0, thickness: r(0.05, 0.2) },
    { id: 'f1', roomId: 'r', kind: 'floor', a: [0, 0], b: [1, 1], y: 0, height: 0, thickness: 0.1, pts: [[0, 0], [r(2, 4), 0], [r(2, 4), r(2, 4)], [0, r(1, 3)]], ...(rnd() < 0.5 ? { xf: { yaw: r(-1, 1), scale: r(0.8, 1.2) } } : {}) },
  ];
  const models: { model: RoomModel; lo: [number, number, number]; hi: [number, number, number] }[] = [];
  for (let i = 0; i < 3; i++) {
    const w = r(0.3, 1.5), d = r(0.3, 1.5), h = r(0.4, 2.2);
    models.push({
      model: { id: `m${i}`, roomId: 'r', name: `m${i}`, path: 'x', pos: [r(0.5, W - 0.5), rnd() < 0.3 ? r(0, 1.5) : 0, r(0.5, D - 0.5)], yaw: r(0, 6.2), scale: r(0.5, 2), ...(rnd() < 0.4 ? { tilt: [r(-0.4, 0.4), r(-0.4, 0.4)] as [number, number] } : {}) },
      lo: [-w / 2, 0, -d / 2], hi: [w / 2, h, d / 2],
    });
  }
  const boxes: RoomBox[] = [];
  for (let i = 0; i < 2; i++) {
    const q = new Quaternion().setFromEuler(new Euler(0, r(0, 6.2), 0));
    boxes.push({ label: 'table', pos: [r(0.5, W - 0.5), 0, r(0.5, D - 0.5)], quat: [q.x, q.y, q.z, q.w], min: [-r(0.3, 1), 0, -r(0.3, 1)], max: [r(0.3, 1), r(0.4, 1), r(0.3, 1)] });
  }
  const planes: RoomPlane[] = [{ label: 'floor', pos: [0, r(-0.05, 0.05), 0] }, { label: 'ceiling', pos: [0, r(2.4, 3), 0] }];
  for (let i = 0; i < 3; i++) {
    const q = new Quaternion().setFromEuler(new Euler(0, r(0, 6.2), 0)).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2));
    const hw = r(0.5, 3), hh = r(1, 1.5);
    planes.push({ label: pick(['wall', 'wall face', 'door']), pos: [r(0, 5), r(1, 1.5), r(0, 5)], quat: [q.x, q.y, q.z, q.w], poly: [-hh, -hw, hh, -hw, hh, hw, -hh, hw] });
  }
  planes.push({ label: 'wall', pos: [0, 1, 0], quat: [0, 0, 0, 1], poly: [0, 0, 1, 0, 1, 1] }); // horizontal: no face

  const axesMode = pick(['room', 'none']);
  const vertical = rnd() < 0.7;
  const wallFaces = walls.flatMap(wallSegs);
  const planeSegs = planes.map((p, i) => planeSeg(p, i));
  const solids = [...models.map((m) => modelSolid(m.model, m.lo, m.hi)), ...boxes.map((b, i) => boxSolid(b, i))];
  const obstacles = [...wallFaces, ...planeSegs.filter((s) => s), ...solids.flatMap(solidSegs)] as ReturnType<typeof solidSegs>;
  const ctx = { obstacles, axes: axesMode === 'room' ? roomAxes(wallFaces) : null, ceilingY: ceilingYOf(planes), floorY: floorYOf(planes), vertical, ...(rnd() < 0.3 ? { maxRange: r(1, 5) } : {}) };
  scenarios.push({
    input: { walls, floors, models, boxes, planes, axesMode, vertical, maxRange: (ctx as { maxRange?: number }).maxRange ?? null },
    expected: {
      wallFaces,
      planeSegs,
      roomAxes: roomAxes(wallFaces),
      ceilingY: ctx.ceilingY,
      floorY: ctx.floorY,
      solids,
      dims: solids.map(dimsOfSolid),
      gaps: solids.map((s) => gapsOfSolid(s, ctx)),
      structDims: [...walls, ...floors].map(dimsOfStructure),
    },
  });
}
writeFileSync('unity/Tests/Core.Tests/Fixtures/measure-golden.json', JSON.stringify({ scenarios }));
console.log('written', scenarios.length, 'scenarios');

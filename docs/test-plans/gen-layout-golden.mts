// Run: npx tsx docs/test-plans/gen-layout-golden.mts
// Writes unity/Tests/Core.Tests/Fixtures/layout-golden.json: random rooms, links and measures, and what src/room/layout.ts (the
// source of truth) computes for them. The C# port (unity/Assets/Scripts/Core/Layout.cs) is tested against it by `dotnet run`.
import { writeFileSync } from 'node:fs';
import { apply, compose, invert, learnedLinks, linkSummary, placeAround, placeByLinks, planModelMoves, poseDistance, relative, roomContains } from '../../src/room/layout.ts';
import type { Alignment } from '../../src/room/align.ts';
import type { Room, RoomLink, RoomModel } from '../../src/room/types.ts';

const NOW = 1_760_000_000_000;
Date.now = () => NOW; // learnedLinks stamps links with the clock

let seed = 4242;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const r = (lo: number, hi: number) => Math.round((lo + rnd() * (hi - lo)) * 1000) / 1000;
const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
const pose = () => ({ yaw: r(-3.1, 3.1), tx: r(-8, 8), ty: r(-0.2, 0.2), tz: r(-8, 8) });

const out: Record<string, unknown> = {};

// 1. pose algebra
out.poses = Array.from({ length: 30 }, () => {
  const f = pose(), g = pose();
  const p: [number, number, number] = [r(-5, 5), r(0, 2), r(-5, 5)];
  return { f, g, p, apply: apply(f, p), compose: compose(f, g), invert: invert(f), relative: relative(f, g), distance: poseDistance(f, g) };
});

// 2. rooms
const mkRoom = (id: string, place: string | undefined, links: Record<string, RoomLink> | undefined, kind: number): Room => {
  const w = r(3, 7), d = r(2.5, 6);
  const planes =
    kind === 0
      ? [{ label: 'floor', pos: [0, 0, 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number], poly: [-w / 2, -d / 2, w / 2, -d / 2, w / 2, d / 2, -w / 2, d / 2] }, { label: 'ceiling', pos: [0, r(2.3, 3), 0] as [number, number, number], quat: [0, 0, 0, 1] as [number, number, number, number] }, { label: 'wall', pos: [w / 2, 1.2, 0] as [number, number, number] }]
      : kind === 1
        ? [{ label: 'floor', pos: [r(-1, 1), r(-0.1, 0.1), r(-1, 1)] as [number, number, number] }, { label: 'wall', pos: [w, 1, 0] as [number, number, number] }, { label: 'wall', pos: [-w, 1, d] as [number, number, number] }]
        : [];
  return { id, name: id.toUpperCase(), place, createdAt: '', updatedAt: '', scan: { version: 1, savedAt: 0, planes, ...(links ? { links } : {}) } };
};
const randLink = (): RoomLink => ({ ...pose(), at: 1000, src: pick(['meta', 'manual'] as const), ...(rnd() < 0.8 ? { n: pick([1, 2, 3]) } : {}), sess: pick(['s1', 's2']), ...(rnd() < 0.2 ? { cand: { ...pose(), at: 2000, n: 1, sess: 's3' } } : {}) });

out.worlds = Array.from({ length: 30 }, () => {
  const k = 3 + Math.floor(rnd() * 3);
  const ids = Array.from({ length: k }, (_, i) => `r${i}`);
  const places = ids.map(() => (rnd() < 0.85 ? pick(['Casa', ' casa ', 'Sede']) : undefined));
  const links: Record<string, Record<string, RoomLink>> = {};
  for (const a of ids) for (const b of ids) if (a !== b && rnd() < 0.3) (links[a] ??= {})[b] = randLink();
  const rooms = ids.map((id, i) => mkRoom(id, places[i], links[id], i === k - 1 && rnd() < 0.3 ? 2 : i === k - 2 && rnd() < 0.3 ? 1 : 0));
  const current = rooms[0];
  const members = rnd() < 0.8 ? rooms : rooms.slice(0, k - 1);
  const placed = new Map<string, Alignment>([[current.id, { ...pose(), resid: 0, matched: 0, total: 0 }]]);
  const models: RoomModel[] = Array.from({ length: 8 }, (_, i) => ({ id: `m${i}`, roomId: pick([current.id, current.id, rooms[1].id]), name: `m${i}`, path: 'p', pos: [r(-4, 8), r(-0.2, 3.5), r(-4, 8)], yaw: r(0, 6), scale: 1 }));
  const around = placeAround(current, members);
  const points = rooms.map((room) => ({ room: room.id, pts: Array.from({ length: 6 }, () => ({ p: [r(-4, 5), r(-0.8, 3.6), r(-4, 5)] as [number, number, number] })).map((q) => ({ ...q, in: roomContains(room, q.p) })) }));
  const moves = planModelMoves(current, members, models);
  return {
    rooms, current: current.id, members: members.map((m) => m.id), placed: [...placed].map(([id, a]) => ({ id, ...a })), models,
    expected: {
      around: [...around].map(([id, v]) => ({ id, ...v })),
      byLinks: [...placeByLinks(members, placed)].map(([id, v]) => ({ id, ...v })),
      summary: rooms.map((room) => linkSummary(room, rooms)),
      points,
      moves: moves.moves.map((m) => ({ model: m.model.id, to: m.to.id, pos: m.pos, yaw: m.yaw })),
      stay: moves.stay.map((s) => ({ model: s.model.id, to: s.to?.id ?? null, why: s.why })),
    },
  };
});

// 3. sequences of measures of one pair of rooms
out.sequences = Array.from({ length: 70 }, () => {
  let A = mkRoom('A', 'Casa', undefined, 0);
  let B = mkRoom('B', pick(['Casa', 'Casa', 'Casa', 'Casa', 'Casa', 'Altro']), undefined, 0);
  const truth = pose();
  const steps = [];
  for (let i = 0; i < 6; i++) {
    const pa = pose();
    // most measures agree with the truth; some are a metre off
    const off = rnd() < 0.35 ? { yaw: r(-0.1, 0.1), tx: r(-1.2, 1.2), ty: 0, tz: r(-1.2, 1.2) } : { yaw: 0, tx: r(-0.01, 0.01), ty: 0, tz: r(-0.01, 0.01) };
    const pb = compose(pa, compose(truth, off));
    const src = rnd() < 0.15 ? 'manual' : 'meta';
    const sess = pick(['s1', 's2', 's3', 's4']);
    const together = rnd() < 0.08;
    const res = learnedLinks(A, B, pa, pb, src, sess, together);
    steps.push({ pa, pb, src, sess, together, result: res });
    if (res?.links) {
      A = { ...A, scan: { ...A.scan, links: { ...A.scan.links, B: res.links[0] } } };
      B = { ...B, scan: { ...B.scan, links: { ...B.scan.links, A: res.links[1] } } };
    }
  }
  return { placeB: B.place, steps };
});

writeFileSync('unity/Tests/Core.Tests/Fixtures/layout-golden.json', JSON.stringify({ now: NOW, ...out }));
const w = out.worlds as { expected: { moves: unknown[]; stay: unknown[]; around: unknown[] } }[];
console.log('worlds', w.length, 'moves', w.reduce((n, x) => n + x.expected.moves.length, 0), 'stay', w.reduce((n, x) => n + x.expected.stay.length, 0));
const seqs = out.sequences as { steps: { result: { links: unknown; note: string } | null }[] }[];
const notes = new Map<string, number>();
for (const s of seqs) for (const st of s.steps) { const k = st.result ? st.result.note.replace(/[0-9.]+ m/, 'X m') : 'null'; notes.set(k, (notes.get(k) ?? 0) + 1); }
console.log([...notes]);

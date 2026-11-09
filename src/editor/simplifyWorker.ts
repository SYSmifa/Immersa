import { MeshoptSimplifier } from 'meshoptimizer';

// The heavy part of the simplification (meshoptimizer on millions of triangles) runs here, off the page's thread, so the editor
// stays alive and several parts can be done at the same time (see simplify.ts).
export interface Job {
  id: number;
  idx: Uint32Array;
  pos: Float32Array; // x y z per vertex
  attr: Float32Array; // UVs, `stride` floats per vertex (empty when stride is 0)
  stride: number;
  weights: number[];
  target: number; // index count wanted
  error: number; // deviation allowed: relative to the part's size, or in metres when `absolute`
  absolute: boolean;
  fallback: boolean; // finish with the coarse simplifier when the careful one stops early
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const j = e.data;
  try {
    await MeshoptSimplifier.ready;
    const flags = j.absolute ? ['ErrorAbsolute' as const] : undefined;
    let [out] = j.stride
      ? MeshoptSimplifier.simplifyWithAttributes(j.idx, j.pos, 3, j.attr, j.stride, j.weights, null, j.target, j.error, flags)
      : MeshoptSimplifier.simplify(j.idx, j.pos, 3, j.target, j.error, flags);
    // Topology can stop the careful pass early (many separate shells): the coarse one ignores the attributes.
    if (j.fallback && out.length > j.target * 1.3) out = MeshoptSimplifier.simplifySloppy(out, j.pos, 3, null, j.target, 1)[0];
    const copy = new Uint32Array(out); // own buffer, so it can be handed back without copying
    (self as unknown as Worker).postMessage({ id: j.id, out: copy }, [copy.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: j.id, error: err instanceof Error ? err.message : String(err) });
  }
};

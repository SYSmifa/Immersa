// Tiny timing helper for the fps panel (Options → "Pannello fps"): `timed` runs a function and reports how long it took under a name, the
// panel shows the longest of each name in the last half second. Does nothing until a sink is set.
export const perf: { sink: ((name: string, ms: number) => void) | null } = { sink: null };

export function timed<T>(name: string, fn: () => T): T {
  if (!perf.sink) return fn();
  const t = performance.now();
  try {
    return fn();
  } finally {
    perf.sink(name, performance.now() - t);
  }
}

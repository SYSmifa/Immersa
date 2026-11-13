import { Matrix4, Vector3, type WebGLRenderer } from 'three';
import { GRID_U, GRID_V, createGpuDepthReader, rawToMeters } from './depthGpu';

// The headset's depth as points of the session's world, for the depth correction of the rooms (app/core.ts `depthPoints`).
// Quest gives the depth only as a GPU texture: depthGpu.ts samples it on a 32 x 24 grid. The way to turn a sample into a point is
// the one the ?depth probe found to be the flattest on a real floor ("z/basso": the distance is along the view axis, and the
// vertical coordinate of the texture runs from the bottom).
const MIN_RANGE = 0.25; // m: nearer is hands and noise
const MAX_RANGE = 4.5; // m: farther is too coarse for walls

export type World3 = [number, number, number];

export function createDepthSampler(renderer: WebGLRenderer) {
  const gpu = createGpuDepthReader(renderer);
  const invP = new Matrix4();
  const viewM = new Matrix4();
  const dir = new Vector3();
  let fails = 0;
  let worked = false;
  return {
    get error() {
      return gpu.error;
    },
    // Did a reading ever work, and how many times in a row did it fail (to say once that there is no depth).
    get state() {
      return { worked, fails };
    },
    // The points of one eye's view of this frame, in the frame's reference space; null when no depth this frame.
    sample(frame: XRFrame, ref: XRReferenceSpace, session: XRSession): { points: World3[]; head: World3 } | null {
      const pose = frame.getViewerPose(ref);
      const view = pose?.views[0];
      if (!pose || !view) return null;
      const g = gpu.read(session, view, 0);
      if (!g) {
        fails++;
        return null;
      }
      fails = 0;
      worked = true;
      invP.fromArray(view.projectionMatrix as unknown as number[]).invert();
      viewM.fromArray(view.transform.matrix as unknown as number[]);
      const points: World3[] = [];
      for (let a = 0; a < GRID_U; a++) {
        for (let b = 0; b < GRID_V; b++) {
          const d = rawToMeters(g.grid[b * GRID_U + a], g.near, g.far);
          if (!(d > MIN_RANGE && d < MAX_RANGE)) continue;
          const u = (a + g.jitter[0]) / GRID_U;
          const v = (b + g.jitter[1]) / GRID_V;
          dir.set(2 * u - 1, 2 * v - 1, -1).applyMatrix4(invP);
          dir.multiplyScalar(d / -dir.z).applyMatrix4(viewM);
          points.push([dir.x, dir.y, dir.z]);
        }
      }
      const p = pose.transform.position;
      return { points, head: [p.x, p.y, p.z] };
    },
  };
}

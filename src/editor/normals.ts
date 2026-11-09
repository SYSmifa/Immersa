import { BufferAttribute, BufferGeometry } from 'three';

// Vertex normals worked out again from the triangles, with a crease angle: neighbouring faces whose normals differ by less than
// `creaseDeg` are smoothed together, a sharper edge stays sharp (the vertex is split there). CAD files often carry normals that
// are averaged across hard edges; with the fine tessellation nobody sees it, but after simplification a few big triangles
// interpolate those wrong corner normals across a whole flat surface (soft gradients instead of one flat grey).
// Needs an indexed geometry; vertices at the same position are treated as one, so UV seams do not show as shading seams.
export function withCreasedNormals(g: BufferGeometry, creaseDeg = 35): BufferGeometry {
  const pos = g.getAttribute('position') as BufferAttribute;
  const index = g.index?.array as ArrayLike<number> | undefined;
  if (!index || !pos) return g;
  const nv = pos.count;
  const nf = Math.floor(index.length / 3);
  const P = (i: number, k: number) => pos.getComponent(i, k);

  // 1. Vertices at the same place share a group.
  let size = 1;
  while (size < nv * 2) size <<= 1;
  const table = new Int32Array(size).fill(-1);
  const group = new Uint32Array(nv);
  const bits = new Uint32Array(3);
  const f32 = new Float32Array(bits.buffer);
  const first: number[] = []; // first vertex of each group, to compare positions
  for (let v = 0; v < nv; v++) {
    f32[0] = P(v, 0) + 0; // + 0 turns -0 into 0
    f32[1] = P(v, 1) + 0;
    f32[2] = P(v, 2) + 0;
    let h = Math.imul(Math.imul(Math.imul(2166136261 ^ bits[0], 16777619) ^ bits[1], 16777619) ^ bits[2], 16777619);
    let slot = (h ^ (h >>> 15)) & (size - 1);
    for (;;) {
      const gi = table[slot];
      if (gi < 0) {
        table[slot] = first.length;
        group[v] = first.length;
        first.push(v);
        break;
      }
      const u = first[gi];
      if (P(u, 0) + 0 === f32[0] && P(u, 1) + 0 === f32[1] && P(u, 2) + 0 === f32[2]) {
        group[v] = gi;
        break;
      }
      slot = (slot + 1) & (size - 1);
    }
  }

  // 2. Face normals (unit) and areas.
  const fn = new Float32Array(nf * 3);
  const fa = new Float32Array(nf);
  for (let f = 0; f < nf; f++) {
    const a = index[3 * f];
    const b = index[3 * f + 1];
    const c = index[3 * f + 2];
    const ux = P(b, 0) - P(a, 0);
    const uy = P(b, 1) - P(a, 1);
    const uz = P(b, 2) - P(a, 2);
    const vx = P(c, 0) - P(a, 0);
    const vy = P(c, 1) - P(a, 1);
    const vz = P(c, 2) - P(a, 2);
    const x = uy * vz - uz * vy;
    const y = uz * vx - ux * vz;
    const z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z);
    fa[f] = l / 2;
    if (l > 1e-30) {
      fn[3 * f] = x / l;
      fn[3 * f + 1] = y / l;
      fn[3 * f + 2] = z / l;
    }
  }

  // 3. Faces around each group (compressed lists).
  const ng = first.length;
  const start = new Uint32Array(ng + 1);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) start[group[index[3 * f + k]] + 1]++;
  for (let i = 0; i < ng; i++) start[i + 1] += start[i];
  const fill = start.slice(0, ng);
  const around = new Uint32Array(nf * 3);
  for (let f = 0; f < nf; f++) for (let k = 0; k < 3; k++) around[fill[group[index[3 * f + k]]]++] = f;

  // 4. One normal per corner (faces around it within the crease angle), shared by corners of the same vertex that agree.
  const cos = Math.cos((creaseDeg * Math.PI) / 180);
  const src: number[] = []; // original vertex of each new vertex
  const nx: number[] = [];
  const ny: number[] = [];
  const nz: number[] = [];
  const chainNext: number[] = [];
  const head = new Int32Array(nv).fill(-1);
  const newIndex = new Uint32Array(nf * 3);
  for (let f = 0; f < nf; f++) {
    const fx = fn[3 * f];
    const fy = fn[3 * f + 1];
    const fz = fn[3 * f + 2];
    for (let k = 0; k < 3; k++) {
      const v = index[3 * f + k];
      const gi = group[v];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let q = start[gi]; q < start[gi + 1]; q++) {
        const h = around[q];
        if (fx * fn[3 * h] + fy * fn[3 * h + 1] + fz * fn[3 * h + 2] >= cos) {
          sx += fn[3 * h] * fa[h];
          sy += fn[3 * h + 1] * fa[h];
          sz += fn[3 * h + 2] * fa[h];
        }
      }
      let l = Math.hypot(sx, sy, sz);
      if (l < 1e-30) {
        sx = fx;
        sy = fy;
        sz = fz;
        l = 1;
      }
      sx /= l;
      sy /= l;
      sz /= l;
      let nvIdx = head[v];
      while (nvIdx >= 0 && !(Math.abs(nx[nvIdx] - sx) < 1e-3 && Math.abs(ny[nvIdx] - sy) < 1e-3 && Math.abs(nz[nvIdx] - sz) < 1e-3)) nvIdx = chainNext[nvIdx];
      if (nvIdx < 0) {
        nvIdx = src.length;
        src.push(v);
        nx.push(sx);
        ny.push(sy);
        nz.push(sz);
        chainNext.push(head[v]);
        head[v] = nvIdx;
      }
      newIndex[3 * f + k] = nvIdx;
    }
  }

  // 5. The new geometry: the same attributes for the (possibly split) vertices, the new normals.
  const out = new BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    if (name === 'normal') continue;
    const src0 = a as BufferAttribute;
    const arr = new Float32Array(src.length * src0.itemSize);
    for (let i = 0; i < src.length; i++) for (let k = 0; k < src0.itemSize; k++) arr[i * src0.itemSize + k] = src0.getComponent(src[i], k);
    out.setAttribute(name, new BufferAttribute(arr, src0.itemSize));
  }
  const normals = new Float32Array(src.length * 3);
  for (let i = 0; i < src.length; i++) {
    normals[3 * i] = nx[i];
    normals[3 * i + 1] = ny[i];
    normals[3 * i + 2] = nz[i];
  }
  out.setAttribute('normal', new BufferAttribute(normals, 3));
  out.setIndex(new BufferAttribute(src.length > 65535 ? newIndex : Uint16Array.from(newIndex), 1));
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.userData = { ...g.userData };
  return out;
}

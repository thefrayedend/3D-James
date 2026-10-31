// Flat areas of a mesh (an imported STL has no faces, only triangles): neighbouring triangles that lie in one plane
// are one area, so a click on a mesh can pick a surface to sketch on, like a face of a solid.

const SAME_WAY = Math.cos((1.5 * Math.PI) / 180); // triangles in one area face the same way within 1.5°
const SMOOTH = Math.cos((30 * Math.PI) / 180); // an area that bends on into its neighbours by less than this is part of a curve

const cache = new WeakMap();

/** The areas of a mesh body's data ({vertices, triangles}), worked out once per mesh. */
export function meshAreas(d) {
  let a = cache.get(d);
  if (!a) { a = findAreas(d.vertices, d.triangles); cache.set(d, a); }
  return a;
}

function findAreas(V, T) {
  const nt = T.length / 3;
  // the same corner may be stored more than once: one number per place
  const ids = new Map(), at = new Int32Array(V.length / 3);
  for (let i = 0; i < at.length; i++) {
    const k = `${Math.round(V[3 * i] * 1e4)},${Math.round(V[3 * i + 1] * 1e4)},${Math.round(V[3 * i + 2] * 1e4)}`;
    let id = ids.get(k); if (id === undefined) { id = ids.size; ids.set(k, id); } at[i] = id;
  }
  const nv = ids.size;
  const N = new Float64Array(nt * 3), A = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = T[3 * t] * 3, b = T[3 * t + 1] * 3, c = T[3 * t + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z);
    A[t] = l / 2; if (l > 0) { N[3 * t] = x / l; N[3 * t + 1] = y / l; N[3 * t + 2] = z / l; }
  }
  // which triangles share each side
  const sides = new Map();
  const sideKey = (p, q) => (p < q ? p * nv + q : q * nv + p);
  for (let t = 0; t < nt; t++) for (let s = 0; s < 3; s++) {
    const k = sideKey(at[T[3 * t + s]], at[T[3 * t + (s + 1) % 3]]);
    const l = sides.get(k); if (l) l.push(t); else sides.set(k, [t]);
  }
  const nextTo = (t, s) => sides.get(sideKey(at[T[3 * t + s]], at[T[3 * t + (s + 1) % 3]])).filter((o) => o !== t);
  const dot = (t, n) => N[3 * t] * n[0] + N[3 * t + 1] * n[1] + N[3 * t + 2] * n[2];
  // grow each area from a triangle over sides into neighbours lying in the same plane
  const areaOf = new Int32Array(nt).fill(-1), areas = [];
  let size = 0; for (let i = 0; i < 3; i++) { let lo = Infinity, hi = -Infinity; for (let k = i; k < V.length; k += 3) { lo = Math.min(lo, V[k]); hi = Math.max(hi, V[k]); } size = Math.max(size, hi - lo); }
  const tol = Math.max(0.005, size * 1e-5);
  for (let s0 = 0; s0 < nt; s0++) {
    if (areaOf[s0] >= 0) continue;
    const id = areas.length, n = [N[3 * s0], N[3 * s0 + 1], N[3 * s0 + 2]], a0 = T[3 * s0] * 3;
    const off = n[0] * V[a0] + n[1] * V[a0 + 1] + n[2] * V[a0 + 2];
    const tris = [s0]; areaOf[s0] = id;
    if (A[s0] > 0) for (let i = 0; i < tris.length; i++) {
      for (let s = 0; s < 3; s++) for (const o of nextTo(tris[i], s)) {
        if (areaOf[o] >= 0 || !(A[o] > 0) || dot(o, n) < SAME_WAY) continue;
        let inPlane = true;
        for (let k = 0; k < 3; k++) { const v = T[3 * o + k] * 3; if (Math.abs(n[0] * V[v] + n[1] * V[v + 1] + n[2] * V[v + 2] - off) > tol) inPlane = false; }
        if (inPlane) { areaOf[o] = id; tris.push(o); }
      }
    }
    areas.push({ tris });
  }
  // each area: its middle, which way it faces, its outline, and whether it is a flat face or a facet of a curve
  for (const ar of areas) {
    let w = 0; const c = [0, 0, 0], n = [0, 0, 0];
    for (const t of ar.tris) for (let k = 0; k < 3; k++) {
      n[k] += N[3 * t + k] * A[t];
      for (let j = 0; j < 3; j++) c[k] += (V[T[3 * t + j] * 3 + k] * A[t]) / 3;
      if (k === 0) w += A[t];
    }
    const nl = Math.hypot(...n) || 1;
    ar.n = n.map((v) => v / nl); ar.P = c.map((v) => v / (w || 1)); ar.area = w;
    const edges = []; let smooth = 0, all = 0;
    for (const t of ar.tris) for (let s = 0; s < 3; s++) {
      const others = nextTo(t, s); if (others.some((o) => areaOf[o] === areaOf[t])) continue;
      const p = T[3 * t + s] * 3, q = T[3 * t + (s + 1) % 3] * 3;
      edges.push(V[p], V[p + 1], V[p + 2], V[q], V[q + 1], V[q + 2]);
      const len = Math.hypot(V[q] - V[p], V[q + 1] - V[p + 1], V[q + 2] - V[p + 2]);
      all += len; if (others.length === 1 && dot(others[0], ar.n) > SMOOTH) smooth += len;
    }
    ar.edges = edges;
    ar.curved = !(w > 0) || smooth > all * 0.5;
  }
  return { areaOf, areas, normal: (t) => [N[3 * t], N[3 * t + 1], N[3 * t + 2]] };
}

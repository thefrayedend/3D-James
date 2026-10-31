// Painting parts of an object in other colours, like colour painting in OrcaSlicer, Bambu Studio and PrusaSlicer.
// The paint is kept as the strokes that made it (fills, brush strokes, bands), in mm, and laid on the triangles again
// after every rebuild, so it stays on when the object changes. Where the edge of a stroke runs through a big
// triangle, the triangle is split in four, and those again where needed: the way the slicers keep their paint, so it
// goes into a 3MF as their per-triangle "paint_color" and arrives there as filament paint you can still change.
//
// A stroke (an "op"), with c = its colour ('#rrggbb', or null to rub paint off):
//   { t: 'fill', c, p: [x,y,z], n: [nx,ny,nz], a }   the area around the point, spreading over edges sharper than a°
//   { t: 'brush', c, r, d: [dx,dy,dz], pts: [x,y,z, x,y,z, ...] }  a round brush looking along d (the view)
//   { t: 'ball', c, r, pts }                          everything within r of the points (Orca's sphere)
//   { t: 'band', c, o: [x,y,z], n: [nx,ny,nz], w }    a band w wide across n, centred on o (Orca's height range)

const MAX_DEPTH = 12;

/** Lay the strokes on a mesh ({vertices, triangles, faceRanges?}). Returns { colors, trees }: trees[t] is the paint
 * of triangle t, 0 (none), n (colors[n - 1]), or four smaller triangles [at corner 0, corner 1, corner 2, middle]. */
export function paintMesh(mesh, ops) {
  const ctx = meshContext(mesh);
  const out = { colors: [], trees: new Array(ctx.nt).fill(0) };
  for (const op of ops || []) applyOp(ctx, out, op);
  return out;
}

/** Add one stroke to paint made by paintMesh (used while a brush is being dragged, so it stays quick). */
export function applyOp(ctx, paint, op) {
  if (!ctx.nt) return;
  const c = op.c ? String(op.c).toLowerCase() : null;
  let state = 0;
  if (c) { state = paint.colors.indexOf(c) + 1; if (!state) state = paint.colors.push(c); }
  if (op.t === 'fill') { for (const t of fillArea(ctx, op.p, op.n, op.a)) paint.trees[t] = state; return; }
  const dabs = makeDabs(op);
  if (!dabs.length) return;
  const res2 = op.t === 'band' ? 0.01 : Math.max(0.05, op.r / 5) ** 2;
  const { V, T, N } = ctx;
  const grid = dabGrid(dabs);
  for (let t = 0; t < ctx.nt; t++) {
    if (op.t === 'brush' && N[3 * t] * op.d[0] + N[3 * t + 1] * op.d[1] + N[3 * t + 2] * op.d[2] > -0.02) continue; // faces away from the view
    const A = corner(V, T[3 * t]), B = corner(V, T[3 * t + 1]), C = corner(V, T[3 * t + 2]);
    const near = grid ? grid(A, B, C) : dabs;
    if (!near.length) continue;
    paint.trees[t] = paintNode(paint.trees[t], A, B, C, near, state, res2, 0);
  }
}

const corner = (V, i) => [V[3 * i], V[3 * i + 1], V[3 * i + 2]];
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function paintNode(node, A, B, C, dabs, state, res2, depth) {
  const keep = [];
  for (const d of dabs) {
    const k = d.cls(A, B, C);
    if (k === 1) return state; // all of it is inside the stroke
    if (k === 0) keep.push(d);
  }
  if (!keep.length) return node;
  const split = Array.isArray(node);
  if (depth >= MAX_DEPTH || (!split && Math.max(d2(A, B), d2(B, C), d2(C, A)) <= res2)) {
    if (split) return node; // finer than this stroke can go: keep what is there
    const P = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    return keep.some((d) => d.has(P)) ? state : node;
  }
  const ch = split ? node.slice() : [node, node, node, node];
  const ab = mid(A, B), bc = mid(B, C), ca = mid(C, A);
  ch[0] = paintNode(ch[0], A, ab, ca, keep, state, res2, depth + 1);
  ch[1] = paintNode(ch[1], ab, B, bc, keep, state, res2, depth + 1);
  ch[2] = paintNode(ch[2], bc, C, ca, keep, state, res2, depth + 1);
  ch[3] = paintNode(ch[3], ab, bc, ca, keep, state, res2, depth + 1);
  return !Array.isArray(ch[0]) && ch.every((x) => x === ch[0]) ? ch[0] : ch;
}

// ---- the shapes a stroke covers: each one says if a triangle is all inside (1), all outside (-1) or both (0)
function makeDabs(op) {
  const out = [];
  if (op.t === 'band') {
    const [nx, ny, nz] = unit(op.n), o = op.o, h = op.w / 2;
    const s = (P) => (P[0] - o[0]) * nx + (P[1] - o[1]) * ny + (P[2] - o[2]) * nz;
    out.push({
      cls(A, B, C) { const a = s(A), b = s(B), c = s(C); if (Math.abs(a) <= h && Math.abs(b) <= h && Math.abs(c) <= h) return 1; if ((a > h && b > h && c > h) || (a < -h && b < -h && c < -h)) return -1; return 0; },
      has: (P) => Math.abs(s(P)) <= h,
    });
    return out;
  }
  const r = op.r, r2 = r * r, pts = op.pts || [];
  if (op.t === 'ball') {
    for (let i = 0; i + 2 < pts.length; i += 3) {
      const q = [pts[i], pts[i + 1], pts[i + 2]];
      out.push({ q, R: r,
        cls(A, B, C) { if (d2(A, q) <= r2 && d2(B, q) <= r2 && d2(C, q) <= r2) return 1; return closest2(q, A, B, C) > r2 ? -1 : 0; },
        has: (P) => d2(P, q) <= r2 });
    }
  } else if (op.t === 'brush') {
    // a round brush: a short cylinder along the view (as deep as it is wide), so it paints the surface you see
    const d = unit(op.d), h = r;
    for (let i = 0; i + 2 < pts.length; i += 3) {
      const q = [pts[i], pts[i + 1], pts[i + 2]];
      const along = (P) => (P[0] - q[0]) * d[0] + (P[1] - q[1]) * d[1] + (P[2] - q[2]) * d[2];
      const flat = (P, t) => [P[0] - t * d[0], P[1] - t * d[1], P[2] - t * d[2]];
      out.push({ q, R: r * Math.SQRT2,
        cls(A, B, C) {
          const a = along(A), b = along(B), c = along(C);
          if ((a > h && b > h && c > h) || (a < -h && b < -h && c < -h)) return -1;
          const fa = flat(A, a), fb = flat(B, b), fc = flat(C, c);
          if (Math.abs(a) <= h && Math.abs(b) <= h && Math.abs(c) <= h && d2(fa, q) <= r2 && d2(fb, q) <= r2 && d2(fc, q) <= r2) return 1;
          return closest2(q, fa, fb, fc) > r2 ? -1 : 0;
        },
        has(P) { const t = along(P); return Math.abs(t) <= h && d2(flat(P, t), q) <= r2; } });
    }
  }
  return out;
}

/** For many dabs: a grid, so each triangle only looks at the dabs near it. Returns (A, B, C) => dabs, or null. */
function dabGrid(dabs) {
  if (dabs.length < 8 || dabs[0].R == null) return null;
  const R = dabs[0].R, cell = 2 * R, key = (i, j, k) => `${i},${j},${k}`, cells = new Map();
  for (const d of dabs) {
    const k = key(Math.floor(d.q[0] / cell), Math.floor(d.q[1] / cell), Math.floor(d.q[2] / cell));
    const l = cells.get(k); if (l) l.push(d); else cells.set(k, [d]);
  }
  return (A, B, C) => {
    const lo = [0, 1, 2].map((i) => Math.floor((Math.min(A[i], B[i], C[i]) - R) / cell)), hi = [0, 1, 2].map((i) => Math.floor((Math.max(A[i], B[i], C[i]) + R) / cell));
    const n = (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
    const inBox = (d) => [0, 1, 2].every((i) => d.q[i] >= Math.min(A[i], B[i], C[i]) - R && d.q[i] <= Math.max(A[i], B[i], C[i]) + R);
    if (n > cells.size) return dabs.filter(inBox);
    const out = [];
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const l = cells.get(key(i, j, k)); if (l) for (const d of l) if (inBox(d)) out.push(d); }
    return out;
  };
}

function unit(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }

/** Squared distance from p to the nearest point of triangle abc (Ericson, Real-Time Collision Detection 5.1.5). */
function closest2(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2_ = dot(ac, ap);
  if (d1 <= 0 && d2_ <= 0) return d2(p, a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return d2(p, b);
  const vc = d1 * d4 - d3 * d2_;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return d2(p, [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return d2(p, c);
  const vb = d5 * d2_ - d1 * d6;
  if (vb <= 0 && d2_ >= 0 && d6 <= 0) { const w = d2_ / (d2_ - d6); return d2(p, [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return d2(p, [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return d2(p, [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

// ---- the mesh, with what fills need: each triangle's direction, its neighbours, and (on a solid) its face
const contexts = new WeakMap();
export function meshContext(mesh) {
  let ctx = contexts.get(mesh);
  if (ctx) return ctx;
  const V = mesh.vertices, T = mesh.triangles, nt = T.length / 3, N = new Float64Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = T[3 * t] * 3, b = T[3 * t + 1] * 3, c = T[3 * t + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2], vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1;
    N[3 * t] = x / l; N[3 * t + 1] = y / l; N[3 * t + 2] = z / l;
  }
  let faceOf = null;
  const R = mesh.faceRanges;
  if (R?.length) {
    faceOf = new Int32Array(nt).fill(-1);
    for (let f = 0; f < R.length / 2; f++) for (let i = R[2 * f] / 3; i < (R[2 * f] + R[2 * f + 1]) / 3; i++) faceOf[i] = f;
  }
  ctx = { V, T, N, nt, faceOf, sides: null };
  contexts.set(mesh, ctx);
  return ctx;
}

/** Which triangles share each side (corners stored more than once count as one), worked out when a fill needs it. */
function neighbours(ctx) {
  if (ctx.sides) return ctx.sides;
  const { V, T, nt } = ctx, ids = new Map(), at = new Int32Array(V.length / 3);
  for (let i = 0; i < at.length; i++) {
    const k = `${Math.round(V[3 * i] * 1e4)},${Math.round(V[3 * i + 1] * 1e4)},${Math.round(V[3 * i + 2] * 1e4)}`;
    let id = ids.get(k); if (id === undefined) { id = ids.size; ids.set(k, id); } at[i] = id;
  }
  const nv = ids.size, bySide = new Map();
  for (let t = 0; t < nt; t++) for (let s = 0; s < 3; s++) {
    const p = at[T[3 * t + s]], q = at[T[3 * t + (s + 1) % 3]], k = p < q ? p * nv + q : q * nv + p;
    const l = bySide.get(k); if (l) l.push(t); else bySide.set(k, [t]);
  }
  const adj = Array.from({ length: nt }, () => []);
  for (const l of bySide.values()) for (const a of l) for (const b of l) if (a !== b) adj[a].push(b);
  ctx.sides = adj;
  return adj;
}

/** The triangle a fill starts from: the nearest one to p facing about the way n does. */
export function seedTriangle(ctx, p, n) {
  const { V, T, N, nt } = ctx;
  let best = -1, bd = Infinity;
  for (let t = 0; t < nt; t++) {
    if (n && N[3 * t] * n[0] + N[3 * t + 1] * n[1] + N[3 * t + 2] * n[2] < 0.5) continue;
    const dd = closest2(p, corner(V, T[3 * t]), corner(V, T[3 * t + 1]), corner(V, T[3 * t + 2]));
    if (dd < bd) { bd = dd; best = t; }
  }
  return best;
}

/** The triangles a fill covers (like 3D Builder's Coverage, or Orca's smart fill): from the clicked face it spreads
 * over every edge that bends less than a degrees (a whole face of a solid at 0, everything that touches at 180). */
export function fillArea(ctx, p, n, a = 0, seed = -1) {
  const t0 = seed >= 0 ? seed : seedTriangle(ctx, p, n);
  if (t0 < 0) return [];
  const adj = neighbours(ctx), { N, faceOf } = ctx;
  const lim = Math.cos((Math.min(180, Math.max(a || 0, faceOf ? 0 : 1.5)) * Math.PI) / 180) - 1e-9;
  const seen = new Uint8Array(ctx.nt), out = [t0], stack = [t0];
  seen[t0] = 1;
  while (stack.length) {
    const t = stack.pop();
    for (const u of adj[t]) {
      if (seen[u]) continue;
      const same = faceOf && faceOf[u] === faceOf[t] && faceOf[t] >= 0;
      if (!same && N[3 * t] * N[3 * u] + N[3 * t + 1] * N[3 * u + 1] + N[3 * t + 2] * N[3 * u + 2] < lim) continue;
      seen[u] = 1; out.push(u); stack.push(u);
    }
  }
  return out;
}

// ---- showing it: the painted pieces as triangles with a colour each
/** Every painted piece: fn(triangle, state, [a,b,c] weights of its 3 corners on the triangle's own corners). */
export function eachPiece(trees, fn) {
  const walk = (t, node, a, b, c) => {
    if (!Array.isArray(node)) { if (node) fn(t, node, a, b, c); return; }
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    walk(t, node[0], a, ab, ca); walk(t, node[1], ab, b, bc); walk(t, node[2], bc, c, ca); walk(t, node[3], ab, bc, ca);
  };
  for (let t = 0; t < trees.length; t++) if (trees[t]) walk(t, trees[t], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
}

// ---- 3MF: OrcaSlicer / Bambu Studio "paint_color" (PrusaSlicer "mmu_segmentation"), one per triangle.
// Read from their TriangleSelector::serialize: 4 bits per piece, written as hex with the first piece last. A piece is
// either split (0b0011: in four, its four parts follow, the middle one first) or a leaf: 0, 1, 2 as 0b00nn << 2, and
// from 3 up as 0b1100 followed by n - 3 (n from 18 up: 0b1100, 0b1111, n - 18). n is the filament (0 = the object's own).
export function paintString(node, filament) {
  const nib = [];
  const put = (x) => {
    if (Array.isArray(x)) { nib.push(3); for (let i = 3; i >= 0; i--) put(x[i]); return; }
    const n = x ? filament(x) : 0;
    if (n < 3) nib.push(n << 2);
    else if (n <= 17) nib.push(12, n - 3);
    else nib.push(12, 15, n - 18);
  };
  put(node);
  let s = '';
  for (let i = nib.length - 1; i >= 0; i--) s += nib[i].toString(16).toUpperCase();
  return s === '0' ? '' : s;
}

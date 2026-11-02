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
//   { t: 'bucket', c, p: [x,y,z], n: [nx,ny,nz], a }  the area of one colour around the point, as far as other paint
//                                                     goes and over edges that bend less than a° (Orca's bucket fill)

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
  if (op.t === 'bucket') { bucketFill(ctx, paint, op.p, op.n, op.a ?? 180, state); return; }
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

// ---- bucket fill: the connected area of the colour under the point, up to where other paint starts (Orca's Bucket
// fill). Paint is a tree of ever smaller triangles inside each mesh triangle, so the area is found piece by piece: two
// pieces touch when their sides overlap along a line. A piece's corners are weights on its mesh triangle's corners, in
// steps of 1/4096 (12 levels of splitting at most), so sides on one line compare exactly.
const S = 4096;
function vertexIds(ctx) {
  if (ctx.vid) return ctx.vid;
  const { V } = ctx, ids = new Map(), at = new Int32Array(V.length / 3);
  for (let i = 0; i < at.length; i++) {
    const k = `${Math.round(V[3 * i] * 1e4)},${Math.round(V[3 * i + 1] * 1e4)},${Math.round(V[3 * i + 2] * 1e4)}`;
    let id = ids.get(k); if (id === undefined) { id = ids.size; ids.set(k, id); } at[i] = id;
  }
  return (ctx.vid = at);
}
/** p as weights on triangle a, b, c (the nearest point on it). */
function weights(p, a, b, c) {
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v2 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1), d20 = dot(v2, v0), d21 = dot(v2, v1), den = d00 * d11 - d01 * d01 || 1;
  let v = (d11 * d20 - d01 * d21) / den, w = (d00 * d21 - d01 * d20) / den;
  v = Math.max(0, Math.min(1, v)); w = Math.max(0, Math.min(1 - v, w));
  return [1 - v - w, v, w];
}
const imid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
function bucketFill(ctx, paint, p, n, a0, state) {
  const t0 = seedTriangle(ctx, p, n); if (t0 < 0) return;
  const { V, T, N, nt, faceOf } = ctx, trees = paint.trees, vid = vertexIds(ctx);
  const lim = Math.cos((Math.min(180, Math.max(a0, faceOf ? 0 : 1.5)) * Math.PI) / 180) - 1e-9;
  // across a side of the mesh only where it bends less than a0 (or inside one face of a solid), like Fill
  const bends = (t, u) => t !== u && !(faceOf && faceOf[t] === faceOf[u] && faceOf[t] >= 0) && N[3 * t] * N[3 * u] + N[3 * t + 1] * N[3 * u + 1] + N[3 * t + 2] * N[3 * u + 2] < lim;
  // the piece under the point: down the clicked triangle's tree by where the point sits on each smaller triangle
  let [a, b, c] = weights(p, corner(V, T[3 * t0]), corner(V, T[3 * t0 + 1]), corner(V, T[3 * t0 + 2]));
  let node = trees[t0];
  const seedPath = [];
  while (Array.isArray(node)) {
    let k;
    if (a >= 0.5) { k = 0; [a, b, c] = [2 * a - 1, 2 * b, 2 * c]; }
    else if (b >= 0.5) { k = 1; [a, b, c] = [2 * a, 2 * b - 1, 2 * c]; }
    else if (c >= 0.5) { k = 2; [a, b, c] = [2 * b, 2 * c - 1, 2 * a]; }
    else { k = 3; [a, b, c] = [a + b - c, b + c - a, a + c - b]; }
    seedPath.push(k); node = node[k];
  }
  const target = node;
  if (target === state) return;
  // every piece of that colour, with its triangle, its way down the tree and its corners
  const pieces = [];
  let seed = -1;
  const walk = (t, nd, path, A, B, C) => {
    if (Array.isArray(nd)) {
      const ab = imid(A, B), bc = imid(B, C), ca = imid(C, A);
      walk(t, nd[0], [...path, 0], A, ab, ca); walk(t, nd[1], [...path, 1], ab, B, bc);
      walk(t, nd[2], [...path, 2], bc, C, ca); walk(t, nd[3], [...path, 3], ab, bc, ca);
    } else if (nd === target) {
      if (t === t0 && path.length === seedPath.length && path.every((x, i) => x === seedPath[i])) seed = pieces.length;
      pieces.push({ t, path, P: [A, B, C] });
    }
  };
  for (let t = 0; t < nt; t++) walk(t, trees[t], [], [S, 0, 0], [0, S, 0], [0, 0, S]);
  if (seed < 0) return;
  // the sides of the pieces, by the line they lie on: inside a triangle, or a side of the mesh shared by two triangles
  const lines = new Map();
  pieces.forEach((pc, i) => {
    for (let k = 0; k < 3; k++) {
      const u = pc.P[k], w = pc.P[(k + 1) % 3];
      const j = u[0] === w[0] ? 0 : u[1] === w[1] ? 1 : 2; // the weight that stays the same along this side
      let key, lo, hi;
      if (u[j] === 0) {
        const c1 = (j + 1) % 3, c2 = (j + 2) % 3, g1 = vid[T[3 * pc.t + c1]], g2 = vid[T[3 * pc.t + c2]];
        let s1 = u[c2], s2 = w[c2];
        if (g1 > g2) { s1 = S - s1; s2 = S - s2; }
        key = `e${Math.min(g1, g2)},${Math.max(g1, g2)}`; lo = Math.min(s1, s2); hi = Math.max(s1, s2);
      } else {
        const q = (j + 1) % 3;
        key = `i${pc.t},${j},${u[j]}`; lo = Math.min(u[q], w[q]); hi = Math.max(u[q], w[q]);
      }
      if (hi <= lo) continue;
      const l = lines.get(key); if (l) l.push([lo, hi, i]); else lines.set(key, [[lo, hi, i]]);
    }
  });
  const up = Int32Array.from(pieces, (_, i) => i);
  const root = (i) => { while (up[i] !== i) { up[i] = up[up[i]]; i = up[i]; } return i; };
  for (const l of lines.values()) {
    if (l.length < 2) continue;
    l.sort((x, y) => x[0] - y[0]);
    let open = [];
    for (const e of l) {
      open = open.filter((o) => o[1] > e[0]);
      for (const o of open) if (!bends(pieces[o[2]].t, pieces[e[2]].t)) up[root(o[2])] = root(e[2]);
      open.push(e);
    }
  }
  const r0 = root(seed);
  pieces.forEach((pc, i) => { if (root(i) === r0) trees[pc.t] = setLeaf(trees[pc.t], pc.path, 0, state); });
}
function setLeaf(node, path, i, state) {
  if (i === path.length) return state;
  const ch = node.slice();
  ch[path[i]] = setLeaf(node[path[i]], path, i + 1, state);
  return !Array.isArray(ch[0]) && ch.every((x) => x === ch[0]) ? ch[0] : ch;
}

// ---- the paint as real triangles (for files with one colour per triangle: a standard 3MF, as Bambu Studio reads it)
/** Every painted piece as triangles of its own, each with its paint state (0: the object's own colour). Where smaller
 * pieces meet a piece's side (inside a triangle, or across a side of the mesh), that side gets their corners too, so
 * the surface stays closed. Returns { vertices: [x,y,z, ...] (three per triangle), states: [state per triangle] }. */
export function paintedMesh(mesh, paint) {
  const ctx = meshContext(mesh), { V, T, nt } = ctx, vid = vertexIds(ctx), trees = paint.trees;
  // where a weight-triple point sits on each line it lies on: inside triangle t, or on a side of the mesh
  const line = (t, j, P) => {
    if (P[j] !== 0) return [`i${t},${j},${P[j]}`, P[(j + 1) % 3], false];
    const c1 = (j + 1) % 3, c2 = (j + 2) % 3, g1 = vid[T[3 * t + c1]], g2 = vid[T[3 * t + c2]];
    return [`e${Math.min(g1, g2)},${Math.max(g1, g2)}`, g1 > g2 ? S - P[c2] : P[c2], g1 > g2];
  };
  const leaves = [], lines = new Map();
  const walk = (t, nd, A, B, C) => {
    if (Array.isArray(nd)) {
      const ab = imid(A, B), bc = imid(B, C), ca = imid(C, A);
      walk(t, nd[0], A, ab, ca); walk(t, nd[1], ab, B, bc); walk(t, nd[2], bc, C, ca); walk(t, nd[3], ab, bc, ca);
      return;
    }
    leaves.push([t, A, B, C, nd || 0]);
    for (const P of [A, B, C]) for (let j = 0; j < 3; j++) {
      const [k, s] = line(t, j, P);
      let l = lines.get(k); if (!l) lines.set(k, (l = new Set())); l.add(s);
    }
  };
  for (let t = 0; t < nt; t++) walk(t, trees[t] || 0, [S, 0, 0], [0, S, 0], [0, 0, S]);
  const out = [], states = [];
  for (const [t, ...rest] of leaves) {
    const P = rest.slice(0, 3), state = rest[3];
    const ca = corner(V, T[3 * t]), cb = corner(V, T[3 * t + 1]), cc = corner(V, T[3 * t + 2]);
    const at = (w) => [0, 1, 2].map((i) => (w[0] * ca[i] + w[1] * cb[i] + w[2] * cc[i]) / S);
    // the piece's outline: its corners, and the corners of other pieces on its sides, in order
    const ring = [];
    for (let k = 0; k < 3; k++) {
      const u = P[k], w = P[(k + 1) % 3];
      ring.push(u);
      const j = u[0] === w[0] ? 0 : u[1] === w[1] ? 1 : 2;
      const [key, su, flip] = line(t, j, u), [, sw] = line(t, j, w);
      const lo = Math.min(su, sw), hi = Math.max(su, sw), mids = [...(lines.get(key) || [])].filter((s) => s > lo && s < hi);
      mids.sort((x, y) => (su < sw ? x - y : y - x));
      for (const s of mids) {
        const m = [0, 0, 0];
        if (u[j] !== 0) { m[j] = u[j]; m[(j + 1) % 3] = s; m[(j + 2) % 3] = S - u[j] - s; }
        else { const c2 = (j + 2) % 3, c1 = (j + 1) % 3, s2 = flip ? S - s : s; m[c2] = s2; m[c1] = S - s2; }
        ring.push(m);
      }
    }
    const pts = ring.map(at);
    if (pts.length === 3) { out.push(...pts.flat()); states.push(state); continue; }
    // more than three corners: a fan round its middle
    const mid = [0, 1, 2].map((i) => pts.reduce((sum, p) => sum + p[i], 0) / pts.length);
    for (let i = 0; i < pts.length; i++) { out.push(...mid, ...pts[i], ...pts[(i + 1) % pts.length]); states.push(state); }
  }
  return { vertices: out, states };
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

// Sketch geometry shared by the sketch board and the geometry engine.
// A loop is { type: 'circle', c: [x, y], r } or { type: 'poly', pts: [[x, y], ...], bulge?: [...], round?: [...] }.
// Open loops have no side back to their first point: { type: 'line', pts: [A, B] } is a helper line (a guide, never solid)
// and { type: 'open', pts, bulge? } is a line still being drawn (it becomes an outline once its two ends meet).
//   bulge[i]: the side from pts[i] to pts[i + 1] is an arc. 0 = straight. Same idea as DXF:
//             bulge = tan(sweep / 4); positive turns counter-clockwise (the arc bulges to the right of the side).
//   round[i]: corner pts[i] is rounded with this radius (the points stay the sharp corners, so the rounding
//             stays a true tangent arc when points move). Ignored on a corner next to an arc.

const EPS = 1e-9;
/** Closed outlines and circles: the loops that make the solid. */
export const isSolidLoop = (l) => !!l && l.type !== 'line' && l.type !== 'open';
/** Helper lines and unfinished lines: no side runs from the last point back to the first. */
export const isOpenLoop = (l) => l?.type === 'line' || l?.type === 'open';
/** How many sides a loop has (side i runs from point i to point i + 1). */
export const sideCount = (l) => (l.type === 'circle' ? 0 : isOpenLoop(l) ? Math.max(0, l.pts.length - 1) : l.pts.length);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = (a) => Math.hypot(a[0], a[1]);

/** Midpoint of the arc from A to B with this bulge (on the chord when straight). */
export function arcMid(A, B, b) {
  const d = sub(B, A), c = len(d) || 1;
  const s = (b * c) / 2; // sagitta, signed
  return [(A[0] + B[0]) / 2 + (d[1] / c) * s, (A[1] + B[1]) / 2 - (d[0] / c) * s];
}
/** Bulge of the arc from A to B that passes through H halfway along it. */
export function bulgeFromMid(A, B, H) {
  const d = sub(B, A), c = len(d); if (c < EPS) return 0;
  const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const s = ((H[0] - m[0]) * d[1] - (H[1] - m[1]) * d[0]) / c; // signed distance to the right of A→B
  return (2 * s) / c;
}
/** Bulge of the arc from A to B that passes through any point M. */
export function bulgeFrom3(A, M, B) {
  const ax = A[0], ay = A[1], bx = M[0], by = M[1], cx = B[0], cy = B[1];
  const D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(D) < EPS) return 0; // in a straight line
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
  const R = Math.hypot(ax - ux, ay - uy), c = Math.hypot(cx - ax, cy - ay);
  const d = sub(B, A);
  const side = (p) => (p[0] - ax) * d[1] - (p[1] - ay) * d[0]; // > 0: right of A→B
  const sM = side(M), sC = side([ux, uy]);
  let sweep = 2 * Math.asin(Math.min(1, c / (2 * R)));
  if (sM * sC > 0) sweep = 2 * Math.PI - sweep; // center on the same side as M: the long way round
  return Math.sign(sM) * Math.tan(sweep / 4);
}
/** Radius of the arc from A to B with bulge b (Infinity when straight). */
export function arcRadius(A, B, b) {
  if (Math.abs(b) < EPS) return Infinity;
  const c = len(sub(B, A));
  return (c * (1 + b * b)) / (4 * Math.abs(b));
}
/** The bulge giving radius R over the same chord (the short way round), keeping the side it bends to. */
export function bulgeForRadius(A, B, b, R) {
  const c = len(sub(B, A)); if (!(R > c / 2 - 1e-9)) return null;
  const k = (2 * R - Math.sqrt(Math.max(0, 4 * R * R - c * c))) / c;
  return (Math.sign(b) || 1) * k;
}
/** Length along the arc (or the straight side). */
export function sideLength(A, B, b) {
  const c = len(sub(B, A)); if (Math.abs(b) < EPS) return c;
  const sweep = 4 * Math.atan(Math.abs(b));
  return arcRadius(A, B, b) * sweep;
}

/**
 * The outline with rounded corners worked out: a list of points with a bulge for the side after each one.
 * Corners whose radius does not fit are rounded as much as fits.
 */
export function expandLoop(l) {
  const P = l.pts, n = P.length, open = isOpenLoop(l);
  const B = (i) => (open && i >= n - 1 ? 0 : +(l.bulge?.[i] || 0));
  const Rr = (i) => {
    const r = +(l.round?.[i] || 0);
    if (open && (i === 0 || i === n - 1)) return 0; // the two ends of an open line are not corners
    if (!(r > 0) || Math.abs(B(i)) > EPS || Math.abs(B((i - 1 + n) % n)) > EPS) return 0;
    return r;
  };
  if (!l.round?.some((r) => +r > 0)) return { pts: P.map((p) => [+p[0], +p[1]]), bulge: P.map((_, i) => B(i)) };
  // how far each rounding eats into its two sides
  const cut = P.map((p, i) => {
    const r = Rr(i); if (!r) return 0;
    const a = P[(i - 1 + n) % n], c = P[(i + 1) % n];
    const u1 = sub(a, p), u2 = sub(c, p), l1 = len(u1), l2 = len(u2);
    if (l1 < EPS || l2 < EPS) return 0;
    const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2);
    const th = Math.acos(Math.max(-1, Math.min(1, cos)));
    if (th < 1e-4 || th > Math.PI - 1e-4) return 0;
    return r / Math.tan(th / 2);
  });
  // never more than each side has room for (shared between the two corners at its ends)
  const room = (i) => len(sub(P[(i + 1) % n], P[i])); // side i
  const t = cut.map((x, i) => {
    if (!x) return 0;
    const prevSide = (i - 1 + n) % n, nextSide = i;
    const sharePrev = cut[(i - 1 + n) % n] ? room(prevSide) * (x / (x + cut[(i - 1 + n) % n])) : room(prevSide);
    const shareNext = cut[(i + 1) % n] ? room(nextSide) * (x / (x + cut[(i + 1) % n])) : room(nextSide);
    return Math.min(x, sharePrev * 0.9999, shareNext * 0.9999);
  });
  const pts = [], bulge = [];
  for (let i = 0; i < n; i++) {
    const p = P[i];
    if (!t[i]) { pts.push([+p[0], +p[1]]); bulge.push(B(i)); continue; }
    const a = P[(i - 1 + n) % n], c = P[(i + 1) % n];
    const u1 = sub(a, p), u2 = sub(c, p), l1 = len(u1), l2 = len(u2);
    const T1 = [p[0] + (u1[0] / l1) * t[i], p[1] + (u1[1] / l1) * t[i]];
    const T2 = [p[0] + (u2[0] / l2) * t[i], p[1] + (u2[1] / l2) * t[i]];
    const cos = (u1[0] * u2[0] + u1[1] * u2[1]) / (l1 * l2);
    const turn = Math.PI - Math.acos(Math.max(-1, Math.min(1, cos))); // how much the outline turns here
    // turning left (counter-clockwise) when the corner is convex on a CCW outline
    const d1 = sub(p, a), d2 = sub(c, p), cross = d1[0] * d2[1] - d1[1] * d2[0];
    pts.push(T1); bulge.push(Math.sign(cross) * Math.tan(turn / 4));
    pts.push(T2); bulge.push(B(i));
  }
  return { pts, bulge };
}

/** Points along an arc side, not including A, including B. */
export function arcPoints(A, B, b, maxStep = 0.5) {
  if (Math.abs(b) < EPS) return [[B[0], B[1]]];
  const sweep = 4 * Math.atan(b); // signed, CCW positive
  const R = arcRadius(A, B, b);
  const n = Math.max(4, Math.min(256, Math.ceil(Math.abs(sweep) / maxStep * 8)));
  // center: from the chord midpoint, toward the side away from the bulge
  const M = arcMid(A, B, b), cM = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const toMid = sub(M, cM), tl = len(toMid) || 1;
  const off = R - len(toMid); // distance from chord midpoint to center, away from the arc
  const C = [cM[0] - (toMid[0] / tl) * off, cM[1] - (toMid[1] / tl) * off];
  const a0 = Math.atan2(A[1] - C[1], A[0] - C[0]);
  const out = [];
  for (let k = 1; k <= n; k++) { const a = a0 + (sweep * k) / n; out.push([C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]); }
  out[out.length - 1] = [B[0], B[1]];
  return out;
}

/** The loop as a plain polygon (arcs and rounded corners turned into many short sides). */
export function flattenLoop(l) {
  if (l.type === 'circle') {
    const n = 72, out = [];
    for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; out.push([+l.c[0] + l.r * Math.cos(a), +l.c[1] + l.r * Math.sin(a)]); }
    return out;
  }
  const { pts, bulge } = expandLoop(l), n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    out.push(pts[i]);
    if (Math.abs(bulge[i]) > EPS) { const seg = arcPoints(pts[i], pts[(i + 1) % n], bulge[i]); seg.pop(); out.push(...seg); }
  }
  return out;
}

export function loopArea(l) {
  if (l.type === 'circle') return Math.PI * l.r * l.r;
  const p = flattenLoop(l); let a = 0;
  for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
  return Math.abs(a / 2);
}
export function insideLoop(l, [x, y]) {
  if (isOpenLoop(l)) return false; // an open line has no inside
  if (l.type === 'circle') return Math.hypot(x - l.c[0], y - l.c[1]) < l.r;
  let inside = false; const p = flattenLoop(l);
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function loopsBounds(ls) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of ls) for (const [x, y] of l.type === 'circle' ? [[l.c[0] - l.r, l.c[1] - l.r], [+l.c[0] + +l.r, +l.c[1] + +l.r]] : flattenLoop(l)) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** Shortest distance from a point to the outline of a loop. */
export function distToLoop(l, [x, y]) {
  if (l.type === 'circle') return Math.abs(Math.hypot(x - l.c[0], y - l.c[1]) - l.r);
  const p = flattenLoop(l); let best = Infinity;
  for (let i = 0; i < (isOpenLoop(l) ? p.length - 1 : p.length); i++) {
    const A = p[i], B = p[(i + 1) % p.length], dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy || 1e-18;
    const t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (y - A[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(x - (A[0] + t * dx), y - (A[1] + t * dy)));
  }
  return best;
}
/** Is loop l completely inside loop o (it may touch o's outline)? Then it is a hole in o. Partly overlapping is not inside. */
export function loopInside(o, l, tol = 1e-3) {
  const pts = flattenLoop(l); let strictly = 0;
  for (const q of pts) {
    if (distToLoop(o, q) <= tol) continue; // on the outline: fine either way
    if (!insideLoop(o, q)) return false;
    strictly++;
  }
  if (strictly) return true;
  // every corner sits on o's outline (e.g. a notch along its edges): decide by a point just inside l
  const c = l.type === 'circle' ? [+l.c[0], +l.c[1]] : (() => { const f = pts; return [(f[0][0] + f[1][0] + f[2 % f.length][0]) / 3, (f[0][1] + f[1][1] + f[2 % f.length][1]) / 3]; })();
  return insideLoop(l, c) && insideLoop(o, c);
}

/** The same loop going the other way round (bulges and corner radii follow). */
export function reverseLoop(l) {
  if (l.type !== 'poly') return JSON.parse(JSON.stringify(l));
  const n = l.pts.length;
  const pts = l.pts.slice().reverse().map((p) => [p[0], p[1]]);
  const out = { type: l.type, pts };
  // side i of the new loop runs from old point n-1-i to old point n-2-i: the old side n-2-i, backwards
  if (l.bulge) out.bulge = pts.map((_, i) => -(+(l.bulge[(n - 2 - i + n) % n] || 0)));
  if (l.round) out.round = l.round.slice().reverse();
  return out;
}
/** Mirror a loop across a center line (ax 0: x → -x, ax 1: y → -y). Mirroring flips which way arcs bend. */
export function mirrorLoop(l, ax) {
  const flip = (p) => { const q = [p[0], p[1]]; q[ax] = -q[ax]; return q; };
  if (l.type === 'circle') return { type: 'circle', c: flip(l.c), r: l.r };
  const out = { type: l.type, pts: l.pts.map(flip) };
  if (l.bulge) out.bulge = l.bulge.map((b) => -(+b || 0));
  if (l.round) out.round = l.round.slice();
  return reverseLoop(out); // keep the same turning direction as the original
}

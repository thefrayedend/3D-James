// Where sketch lines cross, and cutting sides at those points (for Trim). Pure geometry, no board.
// A piece of line is { A, B, b } (a straight side or an arc with bulge b, see sketchgeom.js) or { c, r } (a whole
// circle). Positions along a piece are t = 0..1 (from A to B; on a circle, the angle from +x, counter-clockwise / 2π).
import { arcRadius, arcMid } from './sketchgeom.js';

const TAU = 2 * Math.PI;
const EPS = 1e-9;

/** The circle an arc lies on, where it starts (angle) and how far it turns (signed, CCW positive). */
export function arcInfo(A, B, b) {
  const sweep = 4 * Math.atan(b), R = arcRadius(A, B, b);
  const M = arcMid(A, B, b), cM = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const tm = [M[0] - cM[0], M[1] - cM[1]], tl = Math.hypot(tm[0], tm[1]) || 1, off = R - tl;
  const C = [cM[0] - (tm[0] / tl) * off, cM[1] - (tm[1] / tl) * off];
  return { C, R, a0: Math.atan2(A[1] - C[1], A[0] - C[0]), sweep };
}
const isArc = (s) => s.c == null && Math.abs(s.b || 0) > EPS;
/** The point at t along a piece. */
export function pointAt(s, t) {
  if (s.c) return [+s.c[0] + s.r * Math.cos(TAU * t), +s.c[1] + s.r * Math.sin(TAU * t)];
  if (!isArc(s)) return [s.A[0] + (s.B[0] - s.A[0]) * t, s.A[1] + (s.B[1] - s.A[1]) * t];
  const { C, R, a0, sweep } = arcInfo(s.A, s.B, s.b), a = a0 + sweep * t;
  return [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)];
}
/** Where along a piece a point lies (the piece's own direction), or null when it is off the piece. */
function paramOf(s, P, tol = 1e-6) {
  if (s.c) { const a = Math.atan2(P[1] - s.c[1], P[0] - s.c[0]); return (((a / TAU) % 1) + 1) % 1; }
  if (!isArc(s)) {
    const d = [s.B[0] - s.A[0], s.B[1] - s.A[1]], L2 = d[0] * d[0] + d[1] * d[1]; if (L2 < EPS) return null;
    const t = ((P[0] - s.A[0]) * d[0] + (P[1] - s.A[1]) * d[1]) / L2, L = Math.sqrt(L2);
    return t < -tol / L || t > 1 + tol / L ? null : Math.max(0, Math.min(1, t));
  }
  const { C, a0, sweep, R } = arcInfo(s.A, s.B, s.b);
  let da = (Math.atan2(P[1] - C[1], P[0] - C[0]) - a0) * Math.sign(sweep);
  da = ((da % TAU) + TAU) % TAU;
  const full = Math.abs(sweep), slack = tol / R;
  if (da > TAU - slack) da -= TAU; // just before the start
  if (da < -slack || da > full + slack) return null;
  return Math.max(0, Math.min(1, da / full));
}
/** The closest point on a piece to P: { t, d } (t along the piece, d the distance). */
export function nearest(s, P) {
  if (s.c) { const t = paramOf(s, P); return { t, d: Math.abs(Math.hypot(P[0] - s.c[0], P[1] - s.c[1]) - s.r) }; }
  if (!isArc(s)) {
    const d = [s.B[0] - s.A[0], s.B[1] - s.A[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1e-18;
    const t = Math.max(0, Math.min(1, ((P[0] - s.A[0]) * d[0] + (P[1] - s.A[1]) * d[1]) / L2)), Q = pointAt(s, t);
    return { t, d: Math.hypot(P[0] - Q[0], P[1] - Q[1]) };
  }
  const { C, R } = arcInfo(s.A, s.B, s.b), dc = Math.hypot(P[0] - C[0], P[1] - C[1]) || 1;
  const on = paramOf(s, [C[0] + ((P[0] - C[0]) / dc) * R, C[1] + ((P[1] - C[1]) / dc) * R]);
  if (on != null) return { t: on, d: Math.abs(dc - R) };
  // past the ends of the arc: the closer end
  const dA = Math.hypot(P[0] - s.A[0], P[1] - s.A[1]), dB = Math.hypot(P[0] - s.B[0], P[1] - s.B[1]);
  return dA < dB ? { t: 0, d: dA } : { t: 1, d: dB };
}
/** The line or circle a piece lies on. */
const carrier = (s) => (s.c ? { C: [+s.c[0], +s.c[1]], R: +s.r } : isArc(s) ? (({ C, R }) => ({ C, R }))(arcInfo(s.A, s.B, s.b)) : { P: s.A, d: [s.B[0] - s.A[0], s.B[1] - s.A[1]] });
function meet(u, v) {
  if (u.P && v.P) {
    const den = u.d[0] * v.d[1] - u.d[1] * v.d[0]; if (Math.abs(den) < EPS * Math.hypot(...u.d) * Math.hypot(...v.d)) return [];
    const t = ((v.P[0] - u.P[0]) * v.d[1] - (v.P[1] - u.P[1]) * v.d[0]) / den;
    return [[u.P[0] + u.d[0] * t, u.P[1] + u.d[1] * t]];
  }
  if (u.C && v.P) return meet(v, u);
  if (u.P && v.C) {
    const L = Math.hypot(...u.d); if (L < EPS) return [];
    const e = [u.d[0] / L, u.d[1] / L], w = [u.P[0] - v.C[0], u.P[1] - v.C[1]];
    const bq = w[0] * e[0] + w[1] * e[1], cq = w[0] * w[0] + w[1] * w[1] - v.R * v.R, disc = bq * bq - cq;
    if (disc < -1e-9 * v.R * v.R) return [];
    const s = Math.sqrt(Math.max(0, disc));
    const at = (k) => [u.P[0] + e[0] * k, u.P[1] + e[1] * k];
    return s < 1e-9 ? [at(-bq)] : [at(-bq - s), at(-bq + s)];
  }
  const d = Math.hypot(v.C[0] - u.C[0], v.C[1] - u.C[1]);
  if (d < EPS || d > u.R + v.R + 1e-9 || d < Math.abs(u.R - v.R) - 1e-9) return [];
  const a = (u.R * u.R - v.R * v.R + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, u.R * u.R - a * a));
  const m = [u.C[0] + ((v.C[0] - u.C[0]) * a) / d, u.C[1] + ((v.C[1] - u.C[1]) * a) / d], n = [-(v.C[1] - u.C[1]) / d, (v.C[0] - u.C[0]) / d];
  return hh < 1e-9 ? [m] : [[m[0] + n[0] * hh, m[1] + n[1] * hh], [m[0] - n[0] * hh, m[1] - n[1] * hh]];
}
/** Where two pieces cross: [{ t, u, P }] (t along s, u along o). Overlapping pieces lying on each other don't count. */
export function crossings(s, o) {
  const out = [];
  for (const P of meet(carrier(s), carrier(o))) {
    const t = paramOf(s, P), u = paramOf(o, P);
    if (t != null && u != null) out.push({ t, u, P });
  }
  return out;
}
/** The bulge of the part of an arc from t0 to t1. */
export function partBulge(b, t0, t1) { return Math.abs(b) < EPS ? 0 : Math.tan((4 * Math.atan(b) * (t1 - t0)) / 4); }
/** The exact box around loops [x0, y0, x1, y1]: arcs reach their outermost points (not just their ends). */
export function exactBounds(loops) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p) => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); };
  for (const l of loops) {
    if (l.type === 'circle') { add([l.c[0] - l.r, l.c[1] - l.r]); add([+l.c[0] + +l.r, +l.c[1] + +l.r]); continue; }
    const n = l.pts.length, sides = l.type === 'poly' ? n : n - 1;
    for (let i = 0; i < n; i++) add(l.pts[i]);
    for (let i = 0; i < sides; i++) {
      const s = { A: l.pts[i], B: l.pts[(i + 1) % n], b: +(l.bulge?.[i] || 0) };
      if (!isArc(s)) continue;
      const { C, R } = arcInfo(s.A, s.B, s.b);
      for (const a of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI]) { const P = [C[0] + R * Math.cos(a), C[1] + R * Math.sin(a)]; if (paramOf(s, P) != null) add(P); }
    }
  }
  return [x0, y0, x1, y1];
}

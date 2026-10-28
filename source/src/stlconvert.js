// STL to editable steps: rebuilds a mesh as sketches pushed up or spun around, merged and cut, so a
// model from an STL can be changed like anything drawn in 3DJames. Runs where Manifold is loaded (the
// geometry worker). Plain maths: no screen code.
//
// How it works, for one solid part:
// 1. Pick the directions to try: X, Y, Z and the directions of its biggest flat faces.
// 2. For each direction: cut the part into layers at its flat faces (the levels where the outline
//    changes). Each layer's outline, seen from above, becomes a sketch pushed up by the layer's height;
//    layers with the same outline become one sketch. Holes that run through several layers become one
//    cutting sketch. Also try "spun around": a profile turned about an axis, when the part is round.
// 3. Keep the try closest to the STL. What it gets wrong (side holes, notches, a handle) is worked out
//    the same way, one level deeper, and merged in or cut out.
// 4. Outlines become lines and true arcs (circles, rounded corners) so they are easy to edit.
import * as SG from './sketchgeom.js';
import { r3 } from './shared.js';
import { Matrix4, Euler } from 'three';

let MF = null;
let trash = []; // Manifold objects to free when the conversion ends
const keep = (x) => { trash.push(x); return x; };

const PALETTE = ['#22B14C', '#00A2E8', '#FF7F27', '#A349A4', '#FFC90E', '#3F48CC', '#B97A57', '#ED1C24'];
const HOLE_COLOR = '#8b96a3';

// ---------------------------------------------------------------- small maths
/** A size as a person would type it: 9.9998 -> 10, 12.3449 -> 12.345. */
function nice(x, tol) {
  for (const step of [1, 0.5, 0.1, 0.05, 0.01]) { const v = Math.round(x / step) * step; if (Math.abs(v - x) <= tol) return +v.toFixed(3); }
  return r3(x);
}
const mulRv = (R, v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
const polyArea = (P) => { let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
const polyLen = (P) => { let s = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; s += Math.hypot(q[0] - p[0], q[1] - p[1]); } return s; };

// ---------------------------------------------------------------- frames
// A frame says where a sketch sits: world = O + R * local. Local x, y are the sketch's own axes and local z
// is the direction it is pushed (or, spun around, the axis).
const AXIS_FRAMES = {
  z: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], // drawn on the floor, pushed up
  y: [[1, 0, 0], [0, 0, -1], [0, 1, 0]], // drawn standing (front view), pushed back
  x: [[0, 0, 1], [1, 0, 0], [0, 1, 0]], // drawn standing (side view), pushed sideways
};
function frameFor(d) {
  // a frame whose local z is d; local x as close to world X (or Y) as possible
  const ax = Math.abs(d[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const z = norm3(d), x = norm3(add3(ax, scale3(z, -dot3(ax, z)))), y = cross3(z, x);
  return [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]];
}
/** Manifold matrix taking world to the local frame. */
function toLocalMat(R, O) {
  // local = R^T (w - O)
  const t = [0, 1, 2].map((j) => -(R[0][j] * O[0] + R[1][j] * O[1] + R[2][j] * O[2]));
  return [R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, t[0], t[1], t[2], 1];
}
function toWorldMat(R, O) {
  return [R[0][0], R[1][0], R[2][0], 0, R[0][1], R[1][1], R[2][1], 0, R[0][2], R[1][2], R[2][2], 0, O[0], O[1], O[2], 1];
}
/** The 3DJames rotation (degrees, order ZYX) for a frame. */
function rotOf(R) {
  const m = new Matrix4().set(R[0][0], R[0][1], R[0][2], 0, R[1][0], R[1][1], R[1][2], 0, R[2][0], R[2][1], R[2][2], 0, 0, 0, 0, 1);
  const e = new Euler().setFromRotationMatrix(m, 'ZYX');
  return [e.x, e.y, e.z].map((a) => { const d = Math.round((a * 180) / Math.PI * 1e4) / 1e4; return Object.is(d, -0) || Math.abs(d) < 1e-9 ? 0 : d; });
}

// ---------------------------------------------------------------- mesh helpers
function meshArrays(m) {
  const g = m.getMesh(); const np = g.numProp, vp = g.vertProperties;
  const V = new Float64Array((vp.length / np) * 3);
  for (let i = 0; i < vp.length / np; i++) { V[3 * i] = vp[np * i]; V[3 * i + 1] = vp[np * i + 1]; V[3 * i + 2] = vp[np * i + 2]; }
  return { V, T: g.triVerts };
}
/** Area-weighted face directions: the main directions of the flat faces (both ways count as one). */
function mainDirections(m, max = 3) {
  const { V, T } = meshArrays(m);
  const bins = new Map();
  let total = 0;
  for (let i = 0; i < T.length; i += 3) {
    const a = 3 * T[i], b = 3 * T[i + 1], c = 3 * T[i + 2];
    const u = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], w = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
    let n = cross3(u, w); const A = Math.hypot(...n) / 2; if (A <= 0) continue;
    n = norm3(n);
    // one direction for n and -n
    if (n[2] < -1e-9 || (Math.abs(n[2]) <= 1e-9 && (n[1] < -1e-9 || (Math.abs(n[1]) <= 1e-9 && n[0] < 0)))) n = scale3(n, -1);
    const k = n.map((x) => Math.round(x * 200)).join(',');
    const e = bins.get(k) || { A: 0, s: [0, 0, 0] };
    e.A += A; e.s = add3(e.s, scale3(n, A)); bins.set(k, e); total += A;
  }
  return [...bins.values()].sort((p, q) => q.A - p.A).slice(0, max).filter((e) => e.A > total * 0.04).map((e) => norm3(e.s));
}
/** How much of the surface faces straight along, or straight across, its best axis (0..1). */
function boxiness(m) {
  const { V, T } = meshArrays(m);
  const along = [0, 0, 0], across = [0, 0, 0]; let total = 0;
  for (let i = 0; i < T.length; i += 3) {
    const a = 3 * T[i], b = 3 * T[i + 1], c = 3 * T[i + 2];
    const n = cross3([V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]]);
    const l = Math.hypot(...n); if (!l) continue;
    total += l;
    for (let k = 0; k < 3; k++) { const d = Math.abs(n[k]) / l; if (d > 0.999) along[k] += l; if (d < 0.02) across[k] += l; }
  }
  return total ? Math.max(...[0, 1, 2].map((k) => (along[k] + across[k]) / total)) : 0;
}

/** Heights (along local z) of the flat faces facing straight up or down. */
function capLevels(L, tol) {
  const { V, T } = meshArrays(L);
  const flats = [];
  for (let i = 0; i < T.length; i += 3) {
    const a = 3 * T[i], b = 3 * T[i + 1], c = 3 * T[i + 2];
    const u = [V[b] - V[a], V[b + 1] - V[a + 1], V[b + 2] - V[a + 2]], w = [V[c] - V[a], V[c + 1] - V[a + 1], V[c + 2] - V[a + 2]];
    const n = cross3(u, w), l = Math.hypot(...n); if (l <= 1e-12) continue;
    if (Math.abs(n[2]) / l > 0.99995) flats.push({ z: (V[a + 2] + V[b + 2] + V[c + 2]) / 3, area: l / 2 });
  }
  const bb = L.boundingBox();
  flats.sort((p, q) => p.z - q.z);
  // a flat face is a level only when it is more than a speck (slicers leave tiny flat triangles in sloped
  // grooves; each would start a level of its own)
  const minA = Math.min(0.2, 1e-4 * (bb.max[0] - bb.min[0]) * (bb.max[1] - bb.min[1]));
  const groups = [];
  for (const f of flats) { const g = groups[groups.length - 1]; if (g && f.z - g.z <= tol) g.area += f.area; else groups.push({ z: f.z, area: f.area }); }
  const zs = [bb.min[2], ...groups.filter((g) => g.area >= minA).map((g) => g.z), bb.max[2]].sort((p, q) => p - q);
  const out = [];
  for (const z of zs) if (!out.length || z - out[out.length - 1] > tol) out.push(z);
  // the very top and bottom are the box's; heights rounded the way they would be typed (levels that touch
  // must meet exactly, so the rounding is done here, once, for all of them)
  out[0] = bb.min[2]; if (bb.max[2] - out[out.length - 1] <= tol) out[out.length - 1] = bb.max[2]; else out.push(bb.max[2]);
  return out.map((z) => nice(z, Math.min(tol, 1e-3)));
}
function slab(L, a, b) {
  // a hair inside the layer, so the flat faces on its top and bottom (and float rounding) stay out
  const e = Math.min((b - a) / 4, 0.002); a += e; b -= e;
  const s1 = keep(L.trimByPlane([0, 0, 1], a));
  return keep(s1.trimByPlane([0, 0, -1], -b));
}
/** The outlines of a cross-section: [{outer, holes}] with the outer counter-clockwise, holes clockwise. */
function regions(cs) {
  // outlines that touch themselves or each other at a point are split apart by a hair (the CAD kernel cannot
  // draw them); far enough that rounding the points to hundredths does not join them again
  const seen = new Map();
  const pinched = cs.toPolygons().some((P, pi) => P.some((q, i) => {
    const k = `${Math.round(q[0] * 100)},${Math.round(q[1] * 100)}`, o = seen.get(k);
    if (o && (o[0] !== pi || Math.min(Math.abs(o[1] - i), P.length - Math.abs(o[1] - i)) > 2)) return true;
    seen.set(k, [pi, i]); return false;
  }));
  if (pinched) cs = keep(keep(cs.offset(-0.01, 'Miter', 4)).offset(0.01, 'Miter', 4));
  const out = [];
  for (const comp of cs.decompose()) {
    keep(comp);
    const polys = comp.toPolygons().map((p) => p.map((q) => [q[0], q[1]]));
    const outer = polys.reduce((best, p) => (polyArea(p) > (best ? polyArea(best) : 0) ? p : best), null);
    if (!outer) continue;
    out.push({ outer, holes: polys.filter((p) => p !== outer && polyArea(p) < 0), cs: comp });
  }
  return out;
}
const csOf = (contours) => keep(MF.CrossSection.ofPolygons(contours, 'EvenOdd'));
/** Do two outlines match (within tol along their length)? */
function sameShape(P, Q, tol) {
  const a = Math.abs(polyArea(P)), b = Math.abs(polyArea(Q));
  const per = Math.max(polyLen(P), polyLen(Q));
  if (Math.abs(a - b) > tol * per) return false;
  const A = csOf([P]), B = csOf([Q]);
  const x = keep(A.subtract(B)).area() + keep(B.subtract(A)).area();
  return x <= tol * per;
}

// ---------------------------------------------------------------- outlines to lines and arcs
function fitCircle(P) {
  // least squares (Kasa), centered for accuracy
  let mx = 0, my = 0; for (const p of P) { mx += p[0]; my += p[1]; } mx /= P.length; my /= P.length;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of P) {
    const u = p[0] - mx, v = p[1] - my;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv; if (Math.abs(det) < 1e-18) return null;
  const b1 = (suuu + suvv) / 2, b2 = (svvv + svuu) / 2;
  const uc = (b1 * svv - b2 * suv) / det, vc = (suu * b2 - suv * b1) / det;
  const c = [uc + mx, vc + my];
  let r = 0; for (const p of P) r += Math.hypot(p[0] - c[0], p[1] - c[1]); r /= P.length;
  let dev = 0; for (const p of P) dev = Math.max(dev, Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r));
  return { c, r, dev };
}
function dedupe(P, eps) {
  const out = [];
  for (const p of P) if (!out.length || Math.hypot(p[0] - out[out.length - 1][0], p[1] - out[out.length - 1][1]) > eps) out.push(p);
  while (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  // drop points on a straight line between their neighbours
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const a = out[(i - 1 + out.length) % out.length], p = out[i], b = out[(i + 1) % out.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d = L > 0 ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L : 0;
      if (d < eps) { out.splice(i, 1); changed = true; i--; }
    }
  }
  return out;
}
const turnAt = (a, p, b) => { const u = [p[0] - a[0], p[1] - a[1]], v = [b[0] - p[0], b[1] - p[1]]; return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]); };
const ARC_TURN = (35 * Math.PI) / 180; // a tessellated arc never turns more than this at one point
// How far the flat facets of the STL's round parts stray from the true curves (the largest seen while fitting).
// Thin slivers between the rebuilt curves and the facets are no more than this thick.
let maxSag = 0;
let fitPlain = false; // straight sides only (a fallback when the engine cannot build the arcs)
/**
 * How much detail to keep (the user's choice in Make editable). Precise follows the mesh to a few hundredths of a
 * mm, as close as it gets; the others follow it about as closely as a printer can make (a tenth of a mm or so),
 * leave out smaller features and count every extra step dearer, so the recipe comes out shorter and plainer.
 *   tol: how far an outline may stray (mm, at most)   minVol: smallest part worked out (share of the volume)
 *   step: how much each step counts against closeness  wtol: how coarse the steps on a slope may be (times)
 *   maxError: how much may differ (share of the volume) before a part stays a mesh
 */
export const DETAIL = {
  precise: { tol: 0.02, minVol: 2e-4, step: 1, wtol: 1, maxError: 0.02 },
  balanced: { tol: 0.05, minVol: 1e-3, step: 3, wtol: 2, maxError: 0.03 },
  simple: { tol: 0.12, minVol: 4e-3, step: 8, wtol: 4, maxError: 0.05 },
};
let D = DETAIL.precise;
function noteSag(pts, r) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const c = Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    if (c < 2 * r) maxSag = Math.max(maxSag, r - Math.sqrt(r * r - (c * c) / 4));
  }
}

/**
 * A closed polygon as a sketch loop: a circle when it is one, otherwise points with arcs (bulges) where
 * runs of short sides lie on a circle, and rounded corners where such an arc meets two straight sides
 * smoothly. tol is how far the drawing may stray from the polygon (mm).
 */
export function fitLoop(P0, tol, plain = fitPlain) {
  let P = dedupe(P0, tol * 0.02);
  if (P.length < 3) return null;
  const size = Math.max(...P.map((p) => p[0])) - Math.min(...P.map((p) => p[0])) + Math.max(...P.map((p) => p[1])) - Math.min(...P.map((p) => p[1]));
  const n0 = P.length;
  if (n0 >= 8 && !plain) {
    const f = fitCircle(P);
    // (all its points on one circle; either evenly round, or covering the whole circle: a ragged slice of a
    // cone has a few sharp jags, but it is still that circle)
    if (f && f.dev <= tol && (P.every((p, i) => Math.abs(turnAt(P[(i - 1 + n0) % n0], p, P[(i + 1) % n0])) < ARC_TURN)
      || (n0 >= 24 && Math.abs(polyArea(P)) >= 0.98 * Math.PI * f.r * f.r))) return noteSag([...P, P[0]], f.r), { type: 'circle', c: [nice(f.c[0], tol / 4), nice(f.c[1], tol / 4)], r: nice(f.r, tol / 4) };
  }
  // start at the sharpest corner (or, with none, where the longest side starts) so no arc is split in two
  let start = 0, sharp = -1;
  for (let i = 0; i < n0; i++) { const t = Math.abs(turnAt(P[(i - 1 + n0) % n0], P[i], P[(i + 1) % n0])); if (t > sharp) { sharp = t; start = i; } }
  if (sharp < ARC_TURN) {
    let best = -1;
    for (let i = 0; i < n0; i++) { const c = Math.hypot(P[(i + 1) % n0][0] - P[i][0], P[(i + 1) % n0][1] - P[i][1]); if (c > best) { best = c; start = i; } }
  }
  P = [...P.slice(start), ...P.slice(0, start)];
  const n = P.length, at = (i) => P[i % n];
  const segs = []; // {i, j, arc: {c, r} | null}
  let i = 0;
  while (i < n) {
    let best = null;
    const t0 = turnAt(at(i), at(i + 1), at(i + 2)), sign0 = Math.sign(t0);
    for (let j = i + 3; j <= n && Math.abs(t0) <= ARC_TURN && !plain; j++) {
      const t = turnAt(at(j - 2), at(j - 1), at(j));
      if (Math.abs(t) > ARC_TURN || Math.sign(t) !== sign0 || Math.abs(t) < 1e-6) break;
      const pts = []; for (let k = i; k <= j; k++) pts.push(at(k));
      const f = fitCircle(pts);
      if (!f || f.dev > tol || f.r > size * 20) break;
      // the sides of a faceted arc are about equally long and stay close to it (a long straight side next to
      // a small rounded corner is not part of one big flat arc)
      const ch = []; for (let k = 0; k + 1 < pts.length; k++) ch.push(Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]));
      const cmax = Math.max(...ch), cmed = ch.slice().sort((p, q) => p - q)[ch.length >> 1];
      if (cmax > 4 * cmed + tol * 4 || f.r - Math.sqrt(Math.max(0, f.r * f.r - (cmax * cmax) / 4)) > Math.max(0.25, tol * 10)) break;
      // the sweep must stay below a full turn
      let sw = 0; for (let k = i + 1; k < j; k++) sw += turnAt(at(k - 1), at(k), at(k + 1));
      if (Math.abs(sw) > 2 * Math.PI - 0.2) break;
      best = { j, f };
    }
    // (an arc too small or too flat to tell from a line is a line: the CAD kernel cannot always draw those)
    if (best) { const A = at(i), B = at(best.j), ch = Math.hypot(B[0] - A[0], B[1] - A[1]); if (ch < Math.max(0.05, 5 * tol) || best.f.r - Math.sqrt(Math.max(0, best.f.r * best.f.r - (ch * ch) / 4)) < Math.max(0.002, tol / 2)) best = null; }
    if (best) { const run = []; for (let k = i; k <= best.j; k++) run.push(at(k)); noteSag(run, best.f.r); segs.push({ i, j: best.j, arc: best.f }); i = best.j; } else { segs.push({ i, j: i + 1, arc: null }); i++; }
  }
  // points and bulges
  const pts = [], bulge = [];
  for (const s of segs) {
    const A = at(s.i);
    pts.push(A);
    if (!s.arc) { bulge.push(0); continue; }
    let sweep = 0;
    const c = s.arc.c, a0 = Math.atan2(A[1] - c[1], A[0] - c[0]);
    let prev = a0;
    for (let k = s.i + 1; k <= s.j; k++) { const p = at(k), a = Math.atan2(p[1] - c[1], p[0] - c[0]); let d = a - prev; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; sweep += d; prev = a; }
    bulge.push(Math.tan(sweep / 4));
  }
  // an arc that meets two straight sides smoothly is a rounded corner
  const m = pts.length;
  const round = new Array(m).fill(0);
  const keepPt = new Array(m).fill(true);
  const corner = []; // index -> replacement point
  for (let k = 0; k < m; k++) {
    if (!bulge[k] || m < 4) continue;
    const pk = (k - 1 + m) % m, nk = (k + 1) % m;
    if (bulge[pk] || bulge[nk] || !keepPt[k] || !keepPt[nk] || round[pk] || round[nk]) continue;
    const A0 = pts[pk], A = pts[k], B = pts[nk], B1 = pts[(k + 2) % m];
    const d1 = [A[0] - A0[0], A[1] - A0[1]], d2 = [B1[0] - B[0], B1[1] - B[1]];
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) continue;
    const s = ((B[0] - A[0]) * d2[1] - (B[1] - A[1]) * d2[0]) / den;
    const X = [A[0] + d1[0] * s, A[1] + d1[1] * s];
    const r = SG.arcRadius(A, B, bulge[k]);
    // tangent: the corner is as far from both ends, and that distance fits the radius
    const t1 = Math.hypot(X[0] - A[0], X[1] - A[1]), t2 = Math.hypot(X[0] - B[0], X[1] - B[1]);
    const turn = 4 * Math.atan(Math.abs(bulge[k]));
    if (Math.abs(t1 - t2) > tol * 2 || Math.abs(t1 - r * Math.tan(turn / 2)) > tol * 2 || s <= 0) continue;
    corner[k] = X; round[k] = r; keepPt[nk] = false;
  }
  const P2 = [], B2 = [], R2 = [];
  for (let k = 0; k < m; k++) {
    if (!keepPt[k]) continue;
    if (corner[k]) { P2.push(corner[k]); B2.push(0); R2.push(round[k]); } else { P2.push(pts[k]); B2.push(bulge[k]); R2.push(0); }
  }
  // rounded to sizes a person would type, on a grid of a hundredth of a millimetre: two walls are then either exactly
  // in line or clearly apart (walls a few thousandths apart make the CAD kernel give up); points closer than
  // that become one (sides that short only trouble the geometry engine)
  const minEdge = Math.max(0.01, 2 * tol);
  const grid = (x) => +(Math.round(nice(x, tol / 4) * 100) / 100).toFixed(2);
  const Q = [], QB = [], QR = [];
  P2.forEach((p, k) => {
    const q = [grid(p[0]), grid(p[1])];
    if (Q.length && Math.hypot(q[0] - Q[Q.length - 1][0], q[1] - Q[Q.length - 1][1]) < minEdge) { QB[QB.length - 1] = QB[QB.length - 1] || B2[k]; return; }
    Q.push(q); QB.push(B2[k]); QR.push(R2[k]);
  });
  while (Q.length > 2 && Math.hypot(Q[0][0] - Q[Q.length - 1][0], Q[0][1] - Q[Q.length - 1][1]) < minEdge) { Q.pop(); QB.pop(); QR.pop(); }
  // (an arc made too small or too flat by the rounding is a line: the CAD kernel cannot always draw those)
  for (let k = 0; k < Q.length; k++) {
    if (!QB[k]) continue;
    const A = Q[k], B = Q[(k + 1) % Q.length], ch = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (ch < Math.max(0.05, 5 * tol) || Math.abs(QB[k]) * ch / 2 < Math.max(0.002, tol / 2)) QB[k] = 0;
  }
  // a spike: the outline goes along a straight line and straight back (no width; the CAD kernel cannot build it)
  for (let k = 0, guard = 0; Q.length > 3 && k < Q.length && guard < 1000; k++, guard++) {
    const m2 = Q.length, kp = (k - 1 + m2) % m2;
    if (QB[kp] || QB[k] || QR[k]) continue;
    const A = Q[kp], X = Q[k], B = Q[(k + 1) % m2];
    const u = [X[0] - A[0], X[1] - A[1]], v = [B[0] - X[0], B[1] - X[1]];
    const lu = Math.hypot(...u), lv = Math.hypot(...v);
    if (!lu || !lv || (u[0] * v[0] + u[1] * v[1]) / (lu * lv) > -0.9995) continue;
    Q.splice(k, 1); QB.splice(k, 1); QR.splice(k, 1);
    k = Math.max(-1, k - 2); // (the point before may now be the tip of a spike)
  }
  const loop = { type: 'poly', pts: Q };
  if (QB.some((b) => b)) loop.bulge = QB.map((b) => Math.round(b * 1e6) / 1e6);
  if (QR.some((r) => r)) loop.round = QR.map((r) => (r ? nice(r, tol * 1.5) : 0));
  if (loop.pts.length < 3 && !(loop.pts.length === 2 && loop.bulge?.some((b) => b))) return null;
  return loop;
}
/** Does the outline cross itself? (the CAD kernel builds such an outline differently from what it looks like) */
function crossesItself(l) {
  if (l.type !== 'poly') return false;
  const P = SG.flattenLoop(l), n = P.length;
  if (n > 3000) return false;
  const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = P[j], d = P[(j + 1) % n];
      if (Math.max(a[0], b[0]) < Math.min(c[0], d[0]) || Math.max(c[0], d[0]) < Math.min(a[0], b[0]) || Math.max(a[1], b[1]) < Math.min(c[1], d[1]) || Math.max(c[1], d[1]) < Math.min(a[1], b[1])) continue;
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  }
  return false;
}
/** A closed polygon with the points that stray less than e from the line through their neighbours left out. */
function simplify(P, e) {
  if (P.length < 5) return P;
  // (split at the point farthest from the first, then each half the Douglas-Peucker way)
  let far = 0, fd = -1;
  P.forEach((p, i) => { const d = Math.hypot(p[0] - P[0][0], p[1] - P[0][1]); if (d > fd) { fd = d; far = i; } });
  const keepPts = new Array(P.length).fill(false);
  keepPts[0] = keepPts[far] = true;
  const dp = (i, j) => { // i < j, indices into the closed list (j may be P.length: the first point again)
    const A = P[i], B = P[j % P.length], L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1e-12;
    let k = -1, dk = e;
    for (let m = i + 1; m < j; m++) { const d = Math.abs((B[0] - A[0]) * (A[1] - P[m][1]) - (A[0] - P[m][0]) * (B[1] - A[1])) / L; if (d > dk) { dk = d; k = m; } }
    if (k < 0) return;
    keepPts[k] = true; dp(i, k); dp(k, j);
  };
  dp(0, far); dp(far, P.length);
  const out = P.filter((_, i) => keepPts[i]);
  return out.length >= 3 ? out : P;
}
/** fitLoop, checked: when the drawing strays from the polygon (it crosses itself, say), plain straight sides. */
function fitChecked(P, tol) {
  const per = polyLen(P);
  const ok = (x, e) => {
    if (!x) return false;
    const A = loopsCs([x]), B = csOf([P]);
    return Math.abs(A.area() - Math.abs(polyArea(P))) <= e * per * 2 && keep(A.subtract(B)).area() + keep(B.subtract(A)).area() <= e * per * 3;
  };
  const sag0 = maxSag;
  let best = null;
  // An outline that needs dozens of short sides to follow the mesh closely (a rounded corner that is no true
  // arc, a wall the slicer left wavy) is drawn more loosely, still well within what a printer can make: a few
  // arcs instead of a hundred tiny sides, much easier to edit and for the CAD kernel to build.
  for (const t of [tol, 4 * tol, Math.max(10 * tol, 0.03)]) {
    if (best && (t > 0.05 || best.l.pts?.length <= 24 || best.l.type === 'circle')) break;
    maxSag = 0;
    const l = fitLoop(P, t);
    const e = t + maxSag;
    if (ok(l, e) && !crossesItself(l) && (!best || (l.pts?.length ?? 1) < best.l.pts.length * 0.7)) best = { l, sag: maxSag };
  }
  maxSag = Math.max(sag0, best?.sag ?? 0);
  // A hole that met another cut comes out as half a circle closed by a straight side, which the fit then
  // bends into an arc: all of it on one circle after all. Drawn as that circle, its diameter can be typed in.
  if (best && best.l.type === 'poly') {
    const F = SG.flattenLoop(best.l), f = F.length >= 8 ? fitCircle(F) : null;
    const e = Math.max(2 * tol, 0.03);
    if (f && f.dev <= e && Math.abs(Math.abs(polyArea(F)) - Math.PI * f.r * f.r) <= 0.03 * Math.PI * f.r * f.r) {
      const c = { type: 'circle', c: [nice(f.c[0], tol / 4), nice(f.c[1], tol / 4)], r: nice(f.r, tol / 4) };
      if (ok(c, e)) return c;
    }
  }
  if (best) return best.l;
  // (straight sides: the mesh's points, less those that lie on a line between their neighbours anyway)
  const plain = simplify(dedupe(P, tol * 0.02), Math.max(tol, 0.005)).map((p) => [r3(p[0]), r3(p[1])]).filter((p, i, a) => !i || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) >= 1e-3);
  return plain.length >= 3 ? { type: 'poly', pts: plain } : null;
}
/**
 * The same round wall cut at different levels comes out as circles and arcs with radii a hair apart, which
 * leaves paper-thin ledges. Arcs and circles that belong to one circle (within e) get exactly the same centre
 * and radius, their end points moved onto it.
 */
function sameCircles(loops, e) {
  const arcs = [];
  for (const l of loops) {
    if (l.type === 'circle') { arcs.push({ l, c: l.c, r: l.r, full: true }); continue; }
    if (l.type !== 'poly' || !l.bulge) continue;
    const n = l.pts.length;
    for (let i = 0; i < n; i++) {
      const b = l.bulge[i]; if (!b || Math.abs(b) < 1e-6) continue;
      const A = l.pts[i], B = l.pts[(i + 1) % n], r = SG.arcRadius(A, B, b), M = SG.arcMid(A, B, b);
      const f = fitCircle([A, M, B]); if (!f) continue;
      arcs.push({ l, i, c: f.c, r, sweep: 4 * Math.atan(b) });
    }
  }
  const groups = [];
  for (const a of arcs.sort((p, q) => (q.full ? 1 : 0) - (p.full ? 1 : 0))) {
    const g = groups.find((x) => Math.abs(x.r - a.r) <= e && Math.hypot(x.c[0] - a.c[0], x.c[1] - a.c[1]) <= e);
    if (g) g.items.push(a); else groups.push({ c: a.c, r: a.r, items: [a] });
  }
  // short straight sides with both ends on one of these circles, that stray from it no more than a facet
  // would, are facets of it the arc finder could not see (too short, between two corners)
  for (const l of loops) {
    if (l.type !== 'poly') continue;
    const n = l.pts.length;
    for (let i = 0; i < n; i++) {
      if (l.bulge?.[i]) continue;
      const A = l.pts[i], B = l.pts[(i + 1) % n], chord = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const g = groups.find((x) => x.items.length && [A, B].every((P) => Math.abs(Math.hypot(P[0] - x.c[0], P[1] - x.c[1]) - x.r) <= e)
        && x.r - Math.sqrt(Math.max(0, x.r * x.r - (chord * chord) / 4)) <= e);
      if (!g) continue;
      let sw = Math.atan2(B[1] - g.c[1], B[0] - g.c[0]) - Math.atan2(A[1] - g.c[1], A[0] - g.c[0]);
      while (sw > Math.PI) sw -= 2 * Math.PI;
      while (sw < -Math.PI) sw += 2 * Math.PI;
      if (!l.bulge) l.bulge = new Array(n).fill(0);
      l.bulge[i] = Math.tan(sw / 4);
      g.items.push({ l, i, c: g.c, r: g.r, sweep: sw });
    }
  }
  for (const g of groups) {
    if (g.items.length < 2) continue;
    const C = g.c, R = g.r;
    for (const a of g.items) {
      if (a.full) { a.l.c = [C[0], C[1]]; a.l.r = R; continue; }
      const n = a.l.pts.length, A = a.l.pts[a.i], B = a.l.pts[(a.i + 1) % n];
      const onC = (P) => { const t = Math.atan2(P[1] - C[1], P[0] - C[0]); return [r3(C[0] + R * Math.cos(t)), r3(C[1] + R * Math.sin(t))]; };
      const A2 = onC(A), B2 = onC(B);
      A[0] = A2[0]; A[1] = A2[1]; B[0] = B2[0]; B[1] = B2[1];
      let sw = Math.atan2(B2[1] - C[1], B2[0] - C[0]) - Math.atan2(A2[1] - C[1], A2[0] - C[0]);
      while (sw - a.sweep > Math.PI) sw -= 2 * Math.PI;
      while (a.sweep - sw > Math.PI) sw += 2 * Math.PI;
      a.l.bulge[a.i] = Math.round(Math.tan(sw / 4) * 1e6) / 1e6;
    }
  }
}
/** One side of an outline: a straight line, or an arc with its centre, radius, start angle and sweep. */
function sideGeo(A, B, b) {
  if (!b || Math.abs(b) < 1e-9) return { A, B, line: true };
  const sw = 4 * Math.atan(b), r = SG.arcRadius(A, B, b);
  const M = SG.arcMid(A, B, b), cM = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const tm = [M[0] - cM[0], M[1] - cM[1]], tl = Math.hypot(...tm) || 1, off = r - tl;
  const c = [cM[0] - (tm[0] / tl) * off, cM[1] - (tm[1] / tl) * off];
  return { A, B, c, r, a0: Math.atan2(A[1] - c[1], A[0] - c[0]), sw };
}
const sideAt = (g, t) => (g.line ? [g.A[0] + (g.B[0] - g.A[0]) * t, g.A[1] + (g.B[1] - g.A[1]) * t]
  : [g.c[0] + g.r * Math.cos(g.a0 + g.sw * t), g.c[1] + g.r * Math.sin(g.a0 + g.sw * t)]);
/** The nearest point of a side to P: { t (0..1 along it), d }. */
function nearSide(g, P) {
  let t;
  if (g.line) {
    const d = [g.B[0] - g.A[0], g.B[1] - g.A[1]], L2 = d[0] * d[0] + d[1] * d[1];
    t = L2 ? Math.max(0, Math.min(1, ((P[0] - g.A[0]) * d[0] + (P[1] - g.A[1]) * d[1]) / L2)) : 0;
  } else {
    let u = (Math.atan2(P[1] - g.c[1], P[0] - g.c[0]) - g.a0) * Math.sign(g.sw);
    u = ((u % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const S = Math.abs(g.sw);
    t = u <= S ? u / S : (u - S < 2 * Math.PI - u ? 1 : 0);
  }
  const Q = sideAt(g, t);
  return { t, d: Math.hypot(P[0] - Q[0], P[1] - Q[1]) };
}
/**
 * The same wall cut at different levels comes out as outlines a hair apart (rounded corners that are no true
 * arc become chains of small arcs that differ from level to level). Pushed up and joined, such near-miss walls
 * make the CAD kernel slow and often fail. Where an outline runs along an earlier one (within e), it takes
 * that stretch over exactly, so the walls of the levels meet exactly.
 */
function sameWalls(loops, e) {
  const polys = loops.filter((l) => l.type === 'poly' && l.pts.length >= 3);
  const minEdge = 0.01;
  const sides = (X) => X.pts.map((p, i) => sideGeo(p, X.pts[(i + 1) % X.pts.length], X.bulge[i]));
  const locate = (G, P) => { let best = { k: -1, t: 0, d: Infinity }; G.forEach((g, k) => { const q = nearSide(g, P); if (q.d < best.d) best = { k, ...q }; }); return best; };
  const onAll = (G, g) => [0, 0.25, 0.5, 0.75, 1].every((t) => locate(G, sideAt(g, t)).d <= e);
  const box = (X) => { const xs = X.pts.map((p) => p[0]), ys = X.pts.map((p) => p[1]); return [Math.min(...xs) - e, Math.min(...ys) - e, Math.max(...xs) + e, Math.max(...ys) + e]; };
  const exp = new Map(polys.map((l) => [l, SG.expandLoop(l)]));
  for (let bi = 1; bi < polys.length; bi++) {
    const Bl = polys[bi];
    let X = exp.get(Bl), changed = false;
    // (a cutter's wall that lies on a level's wall goes round the other way: matched against it reversed too)
    const rev = (Z) => { const n = Z.pts.length; return { pts: Z.pts.slice().reverse(), bulge: Z.pts.map((_, i) => -Z.bulge[(2 * n - 2 - i) % n]) }; };
    for (const [Y, back] of polys.slice(0, bi).flatMap((l) => [[exp.get(l), false], [rev(exp.get(l)), true]])) {
      const ba = box(X), bb = box(Y);
      if (ba[0] > bb[2] || bb[0] > ba[2] || ba[1] > bb[3] || bb[1] > ba[3]) continue;
      const GA = sides(Y), GB = sides(X), n = GA.length;
      const on = GA.map((g) => onAll(GB, g));
      if (!on.some(Boolean)) continue;
      if (on.every(Boolean) && GB.every((g) => onAll(GA, g))) { if (!back) { X = { pts: Y.pts.map((p) => [...p]), bulge: [...Y.bulge] }; changed = true; } continue; }
      if (on.every(Boolean)) continue;
      // stretches of the earlier outline that this one runs along (from a side that is not shared)
      const runs = [];
      const s0 = on.findIndex((x) => !x);
      for (let k = 1; k <= n; k++) {
        const j = (s0 + k) % n;
        if (on[j] && !on[(j - 1 + n) % n]) runs.push({ j0: j, len: 0 });
        if (on[j]) runs[runs.length - 1].len++;
      }
      for (const { j0, len } of runs) {
        const j1 = (j0 + len) % n;
        const runLen = Array.from({ length: len }, (_, q) => SG.sideLength(Y.pts[(j0 + q) % n], Y.pts[(j0 + q + 1) % n], Y.bulge[(j0 + q) % n])).reduce((p, q) => p + q, 0);
        if (runLen < 3 * e) continue;
        const G = sides(X), m = G.length;
        const pS = locate(G, Y.pts[j0]), pE = locate(G, Y.pts[j1]);
        if (pS.d > e || pE.d > e) continue;
        // this outline must go the same way round, over about the same length
        let fwd = 0;
        if (pS.k === pE.k && pE.t >= pS.t) fwd = SG.sideLength(X.pts[pS.k], X.pts[(pS.k + 1) % m], X.bulge[pS.k]) * (pE.t - pS.t);
        else {
          fwd = SG.sideLength(X.pts[pS.k], X.pts[(pS.k + 1) % m], X.bulge[pS.k]) * (1 - pS.t);
          for (let k = (pS.k + 1) % m; k !== pE.k; k = (k + 1) % m) fwd += SG.sideLength(X.pts[k], X.pts[(k + 1) % m], X.bulge[k]);
          fwd += SG.sideLength(X.pts[pE.k], X.pts[(pE.k + 1) % m], X.bulge[pE.k]) * pE.t;
        }
        if (Math.abs(fwd - runLen) > runLen * 0.1 + 4 * e) continue;
        if (pS.k === pE.k && pE.t >= pS.t && len < n - 1 && fwd < runLen * 0.5) continue;
        // the stretch from the earlier outline, then the rest of this one (sides cut where the stretch ends)
        const sub = (g, t0, t1) => (g.line ? 0 : Math.tan((g.sw * (t1 - t0)) / 4));
        const pts = [], bul = [], fixed = [];
        for (let q = 0; q < len; q++) { pts.push([...Y.pts[(j0 + q) % n]]); bul.push(Y.bulge[(j0 + q) % n]); fixed.push(true); }
        pts.push([...Y.pts[j1]]); bul.push(sub(G[pE.k], pE.t, 1)); fixed.push(true);
        // (when the stretch lies inside one side, the rest is the whole outline round from there)
        for (let k = (pE.k + 1) % m; ; k = (k + 1) % m) {
          pts.push([...X.pts[k]]); fixed.push(false);
          if (k === pS.k) { bul.push(sub(G[k], 0, pS.t)); break; }
          bul.push(X.bulge[k]);
        }
        // points a hair apart become one (keeping the earlier outline's)
        for (let k = 0; k < pts.length && pts.length > 3; k++) {
          const k2 = (k + 1) % pts.length;
          if (Math.hypot(pts[k2][0] - pts[k][0], pts[k2][1] - pts[k][1]) >= minEdge) continue;
          const drop = !fixed[k2] ? k2 : !fixed[k] ? k : -1;
          if (drop < 0) continue;
          if (drop === k2) bul[k] = bul[k] || bul[k2]; // (the side before the dropped point runs on to the next)
          pts.splice(drop, 1); bul.splice(drop, 1); fixed.splice(drop, 1); k--;
        }
        if (pts.length < 3) continue;
        X = { pts, bulge: bul }; changed = true;
      }
    }
    if (!changed) continue;
    const l2 = { type: 'poly', pts: X.pts.map((p) => [Math.round(p[0] * 1e6) / 1e6, Math.round(p[1] * 1e6) / 1e6]), bulge: X.bulge.map((b) => Math.round(b * 1e9) / 1e9) };
    // (only when the outline stays where it was: what differs is a thin strip along it at most)
    const was = loopsCs([Bl]), now = loopsCs([l2]);
    if (crossesItself(l2) || keep(was.subtract(now)).area() + keep(now.subtract(was)).area() > e * polyLen(SG.flattenLoop(Bl))) continue;
    Bl.pts = l2.pts; Bl.bulge = l2.bulge.some((b) => b) ? l2.bulge : undefined; delete Bl.round;
    if (!Bl.bulge) delete Bl.bulge;
    exp.set(Bl, SG.expandLoop(Bl));
  }
}
/** Loops back to a cross-section, to check them against the mesh. */
function loopsCs(loops) {
  const contours = [];
  for (const l of loops) {
    const P = SG.flattenLoop(l.type === 'circle' ? { ...l } : l);
    if (l.type === 'circle') {
      const n = Math.max(48, Math.min(360, Math.ceil(l.r * 8))); P.length = 0;
      for (let k = 0; k < n; k++) { const a = (2 * Math.PI * k) / n; P.push([l.c[0] + l.r * Math.cos(a), l.c[1] + l.r * Math.sin(a)]); }
    }
    contours.push(P);
  }
  return csOf(contours);
}
function loopsBox(loops) { const b = SG.loopsBounds(loops); return { min: [b[0], b[1]], max: [b[2], b[3]] }; }

// ---------------------------------------------------------------- the two ways to rebuild a part
/**
 * Layers along local z: [{a, b, loops (fitted), raw region data}] grouped into sketches.
 * Returns { sketches: [{a, b, loops}], cutters: [{a, b, loops}], A: Manifold (local) } or null.
 */
function insidePolys(polys, [x, y]) {
  let inside = false;
  for (const P of polys) for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/**
 * Move the sides of an outline (counter-clockwise) that do not touch anything to avoid outward by g, the
 * sides next to them stretched to meet: a cutter that ends exactly on a surface leaves a paper-thin skin.
 */
function pushOut(P, avoid, g, tol) {
  const n = P.length, N = [], mov = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    N[i] = L > 0 ? [(b[1] - a[1]) / L, (a[0] - b[0]) / L] : [0, 0];
    const e = tol * 2 + 1e-3;
    mov.push(L > 1e-9 && !insidePolys(avoid, [(a[0] + b[0]) / 2 + N[i][0] * e, (a[1] + b[1]) / 2 + N[i][1] * e]));
  }
  if (!mov.some(Boolean)) return null;
  const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  return P.map((v, i) => {
    const ip = (i - 1 + n) % n, n1 = N[ip], n2 = N[i];
    if (!mov[ip] && !mov[i]) return v;
    if (mov[ip] && mov[i]) { const k = 1 + n1[0] * n2[0] + n1[1] * n2[1]; if (k < 0.25) return [v[0] + (n1[0] + n2[0]) * g, v[1] + (n1[1] + n2[1]) * g]; return [v[0] + ((n1[0] + n2[0]) * g) / k, v[1] + ((n1[1] + n2[1]) * g) / k]; }
    // one side stays: slide along it (stretching it) until the moved side's new line
    const [u, nn] = mov[i] ? [unit([v[0] - P[ip][0], v[1] - P[ip][1]]), n2] : [unit([v[0] - P[(i + 1) % n][0], v[1] - P[(i + 1) % n][1]]), n1];
    const c = u[0] * nn[0] + u[1] * nn[1];
    return c > 0.2 ? [v[0] + (u[0] * g) / c, v[1] + (u[1] * g) / c] : [v[0] + nn[0] * g, v[1] + nn[1] * g];
  });
}

/**
 * The layers of a part along local z: between its flat faces, each layer's outline seen from above. A layer
 * whose walls slope or curve is cut again where its shape changes (at the heights of its mesh points), so the
 * steps follow the surface within wtol; its outline is then the cut through its middle.
 */
function layers(L, tol, ztol, wtol, AV = null) {
  const levels = capLevels(L, ztol);
  if (levels.length - 1 > 80) return null;
  const { V } = meshArrays(L);
  const zs = [];
  for (let i = 2; i < V.length; i += 3) zs.push(V[i]);
  zs.sort((p, q) => p - q);
  const kinks = [];
  for (const z of zs) if (!kinks.length || z - kinks[kinks.length - 1] > ztol) kinks.push(nice(z, Math.min(ztol, 1e-3)));
  const out = [];
  const per = (cs) => cs.toPolygons().reduce((k, P) => k + polyLen(P), 0) || 1;
  const add = (a, b, depth) => {
    if (out.length > 60) return;
    const proj = keep(slab(L, a, b).project());
    const e = Math.min((b - a) / 4, 0.002);
    const lo = keep(L.slice(a + e)), hi = keep(L.slice(b - e));
    const P = per(proj);
    // how far the walls move inside this layer (on average along the outline)
    const move = (proj.area() - Math.min(lo.area(), hi.area())) / P;
    if (b - a < 0.002) return; // (no height to speak of)
    if (move <= wtol) { out.push({ a, b, cs: proj }); return; }
    // a part cut out (or merged in) may fill its widest outline where that only meets don't-care space
    if (AV && keep(proj.intersect(keep(slab(AV, a, b).project()))).area() <= tol * P) { out.push({ a, b, cs: proj }); return; }
    // (no step thinner than a printed layer: finer steps add nothing a printer can make, and their walls,
    // a hair apart, trouble the CAD kernel)
    const minH = 0.1;
    if (b - a < 2 * minH) { out.push({ a, b, cs: keep(L.slice((a + b) / 2)), sloped: true }); return; }
    const inside = kinks.filter((z) => z > a + Math.max(ztol, minH) && z < b - Math.max(ztol, minH));
    if (inside.length && depth < 12) {
      const mid = (a + b) / 2;
      const z = inside.reduce((p, q) => (Math.abs(q - mid) < Math.abs(p - mid) ? q : p));
      add(a, z, depth + 1); add(z, b, depth + 1);
      return;
    }
    // a straight slope (a chamfer, a draft): even steps
    const n = Math.min(8, Math.ceil(move / wtol));
    for (let k = 0; k < n; k++) {
      const a1 = r3(a + ((b - a) * k) / n), b1 = k + 1 === n ? b : r3(a + ((b - a) * (k + 1)) / n);
      out.push({ a: a1, b: b1, cs: keep(L.slice((a1 + b1) / 2)), sloped: true });
    }
  };
  for (let i = 0; i + 1 < levels.length; i++) add(levels[i], levels[i + 1], 0);
  return out.length > 60 ? null : out; // dozens of layers: this direction does not suit the part
}

function prismPlan(L, tol, ztol, AV = null) {
  const lb = L.boundingBox();
  const wtol = D.wtol * Math.max(0.1, 0.0015 * Math.max(lb.max[0] - lb.min[0], lb.max[1] - lb.min[1]));
  const layerList = layers(L, tol, ztol, wtol, AV);
  if (!layerList) return null; // a sloped or curved part: far too many layers
  const bands = [];
  // Arms thinner than `thin` and slits narrower than `slit` (the bottom of a V-groove cut in thin layers) are
  // left out: no printer makes them (a slit that narrow closes up under a 0.4 mm nozzle), and the CAD kernel
  // cannot build solids from them. (Not in pieces cut out or merged in: their sharp wedges would lose their tips.)
  const thin = AV ? 0 : Math.max(0.03, 3 * tol), slit = 0.12;
  for (const { a, b, cs: cs0 } of layerList) {
    const cs = !thin ? cs0 : keep(keep(keep(keep(cs0.offset(-thin, 'Miter', 4)).offset(thin + slit, 'Miter', 4)).offset(-slit, 'Miter', 4)));
    // leave out paper-thin slivers (facets of round parts that do not quite line up)
    const thick = (P) => (2 * Math.abs(polyArea(P))) / Math.max(polyLen(P), 1e-9) > tol * 1.5;
    let regs = regions(cs).filter((r) => thick(r.outer)).map((r) => ({ ...r, holes: r.holes.filter(thick) }));
    if (AV && regs.length) {
      // a part cut out (or merged in) may stick out where that changes nothing: past the surfaces it opens onto
      const bb = L.boundingBox(), g = Math.min(1, Math.max(0.2, 0.1 * Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1])));
      const av = keep(slab(AV, a, b).project()), avP = av.toPolygons();
      regs = regs.flatMap((r) => {
        const P = pushOut(r.outer, avP, g, tol); if (!P) return [r];
        let grown = keep(keep(csOf([P, ...r.holes])).add(r.cs));
        if (keep(grown.intersect(av)).area() > tol * polyLen(r.outer)) grown = keep(grown.subtract(av));
        return regions(grown).filter((q) => thick(q.outer)).map((q) => ({ ...q, holes: q.holes.filter(thick) }));
      });
    }
    bands.push({ a, b, regs });
  }
  // Holes first: the same hole in layers next to each other is one hole run, and it runs on through layers
  // where its spot is open anyway (a pocket it meets, the space under a bridge). A hole run that crosses layers
  // becomes one cutter; the layers it crosses are then drawn without it (its spot filled in).
  const holeRuns = [];
  let cur = [];
  bands.forEach((band, bi) => {
    const nxt = [];
    for (const reg of band.regs) for (const H of reg.holes) {
      const prev = cur.find((h) => !h.taken && sameShape(h.P, H, tol));
      if (prev) { prev.taken = true; prev.last = bi; nxt.push(prev); } else { const h = { P: H, first: bi, last: bi, C: csOf([H.slice().reverse()]) }; holeRuns.push(h); nxt.push(h); }
    }
    for (const h of nxt) h.taken = false;
    cur = nxt;
  });
  const emptyAt = (h, band) => band.regs.every((reg) => keep(reg.cs.intersect(h.C)).area() <= tol * polyLen(h.P));
  const cutters = [];
  for (const h of holeRuns) {
    while (h.first > 0 && emptyAt(h, bands[h.first - 1])) h.first--;
    while (h.last + 1 < bands.length && emptyAt(h, bands[h.last + 1])) h.last++;
    if (h.first === h.last) continue; // one layer only: it stays a hole in that layer's sketch
    if (cutters.some((c) => c.first === h.first && c.last === h.last && sameShape(c.P, h.P, tol))) continue;
    cutters.push({ a: bands[h.first].a, b: bands[h.last].b, P: h.P, C: h.C, first: h.first, last: h.last });
  }
  // Two cutters side by side with a shared edge leave a wall of no thickness between them. The one that cuts
  // less deep reaches into the other's spot instead (cut away there anyway at those heights).
  for (const sc of cutters) for (const dc of cutters) {
    if (sc === dc || dc.first > sc.first || dc.last < sc.last) continue;
    const reach = Math.max(tol * 20, 0.2);
    const into = keep(dc.C.intersect(keep(sc.C.offset(reach, 'Miter', 4))));
    if (into.area() <= tol * tol) continue;
    const merged = regions(keep(sc.C.add(into)));
    if (merged.length !== 1 || merged[0].holes.length) continue;
    // (not when it would reach into dozens of spots at once, a round edge turned into a saw: such an outline
    // is far harder to edit, and its walls lying on the other cutters' trouble the CAD kernel)
    if (merged[0].outer.length > sc.P.length * 1.5 + 16) continue;
    sc.P = merged[0].outer; sc.C = merged[0].cs;
  }
  // a cutter that reaches the very top or bottom goes on a little into the air: flush with the face, the CAD
  // kernel can leave a paper-thin skin
  const past = Math.min(1, Math.max(0.2, 0.1 * (lb.max[2] - lb.min[2])));
  for (const c of cutters) {
    if (c.last === bands.length - 1 && Math.abs(c.b - lb.max[2]) <= 0.05) c.b = lb.max[2] + past;
    if (c.first === 0 && Math.abs(c.a - lb.min[2]) <= 0.05) c.a = lb.min[2] - past;
  }
  // Where the cutter's spot was a hole, the layer is drawn without that hole. Where the spot was open in another
  // way (a pocket the cutter passes through), the layer is drawn with the spot filled in: the cutter takes it
  // away again, and a cutter wall lying exactly on a layer wall leaves a skin of no thickness.
  for (const c of cutters) for (let bi = c.first; bi <= c.last; bi++) {
    const band = bands[bi];
    let wasHole = false;
    for (const reg of band.regs) {
      const keepH = reg.holes.filter((H) => !sameShape(H, c.P, tol));
      if (keepH.length !== reg.holes.length) { reg.holes = keepH; reg.cs = csOf([reg.outer, ...keepH]); wasHole = true; }
    }
    if (globalThis.DEBUG_CONV > 2) console.log('cutter', c.first, c.last, bi, band.a, band.b, wasHole, band.regs.length);
    if (wasHole || !band.regs.length) continue;
    const near = band.regs.some((reg) => keep(reg.cs.intersect(keep(c.C.offset(tol * 4, 'Miter', 4)))).area() > tol * tol);
    if (!near) continue; // open all round: nothing to line up with
    const dd = Math.max(2 * tol, 0.02);
    const filled = keep(keep(keep(MF.CrossSection.union([...band.regs.map((r) => r.cs), c.C])).offset(dd, 'Miter', 4)).offset(-dd, 'Miter', 4));
    // (a strip left between the cutter and a slightly wider opening at this level, too narrow to print, is
    // filled too: drawn, it would be a hairline slit the CAD kernel cannot build)
    const wide = (H) => Math.abs(polyArea(H)) > tol * tol && (!thin || (2 * Math.abs(polyArea(H))) / polyLen(H) > 2 * slit);
    band.regs = regions(filled).filter((r) => Math.abs(polyArea(r.outer)) > tol * tol).map((r) => {
      const holes = r.holes.filter(wide);
      return holes.length === r.holes.length ? { ...r, holes } : { ...r, holes, cs: csOf([r.outer, ...holes]) };
    });
  }
  // runs: the same outline (with its holes) in layers next to each other is one sketch pushed up
  const sameHoles = (A, B) => A.length === B.length && A.every((H) => B.some((K) => sameShape(H, K, tol)));
  const runs = [];
  let open = [];
  for (const band of bands) {
    const next = [];
    for (const reg of band.regs) {
      const prev = open.find((r) => !r.taken && Math.abs(r.b - band.a) <= ztol && sameShape(r.outer, reg.outer, tol) && sameHoles(r.holes, reg.holes));
      if (prev) { prev.taken = true; prev.b = band.b; next.push(prev); } else { const r = { a: band.a, b: band.b, outer: reg.outer, holes: reg.holes, cs: reg.cs }; runs.push(r); next.push(r); }
    }
    for (const r of next) r.taken = false;
    open = next;
  }
  for (const r of runs) r.inline = r.holes;
  if (AV) {
    // the ends of a part cut out (or merged in) go a little past a surface when nothing is in the way
    const bb = L.boundingBox(), g = Math.min(1, Math.max(0.2, 0.1 * (bb.max[2] - bb.min[2])));
    for (const r of runs) {
      if (r.b >= bb.max[2] - ztol && keep(keep(slab(AV, r.b, r.b + g).project()).intersect(r.cs)).area() <= tol * polyLen(r.outer)) r.b += g;
      if (r.a <= bb.min[2] + ztol && keep(keep(slab(AV, r.a - g, r.a).project()).intersect(r.cs)).area() <= tol * polyLen(r.outer)) r.a -= g;
    }
  }
  // fit outlines; group sketches and cutters that share the same heights
  const fit = (P) => fitChecked(polyArea(P) < 0 ? P.slice().reverse() : P, tol);
  // (an item that overlaps one already in a group goes in a group of its own: overlapping outlines in one
  // sketch cannot be drawn)
  const overlaps = (c, d) => c.C && d.C && keep(c.C.intersect(d.C)).area() > tol * tol;
  const groupBy = (items) => {
    const g = [];
    for (const it of items) {
      const e = g.find((x) => Math.abs(x.a - it.a) <= ztol && Math.abs(x.b - it.b) <= ztol && !x.items.some((o) => overlaps(o, it)));
      if (e) e.items.push(it); else g.push({ a: it.a, b: it.b, items: [it] });
    }
    return g;
  };
  maxSag = 0;
  const sketches = groupBy(runs).map((g) => ({ a: g.a, b: g.b, loops: g.items.flatMap((r) => [fit(r.outer), ...r.inline.map(fit)]).filter(Boolean) }));
  // a cutter wholly inside another that cuts at least as far up and down takes nothing more away: one step less
  // (the same hole found twice, or a pocket inside a bigger one)
  const needed = cutters.filter((c) => !cutters.some((d) => d !== c && d.a <= c.a + ztol && d.b >= c.b - ztol
    && keep(c.C.subtract(d.C)).area() <= tol * polyLen(c.P) && (keep(d.C.subtract(c.C)).area() > tol * polyLen(d.P) || cutters.indexOf(d) < cutters.indexOf(c))));
  const cut = groupBy(needed).map((g) => ({ a: g.a, b: g.b, loops: g.items.map((c) => fit(c.P)).filter(Boolean) }));
  const eps = maxSag;
  sameCircles([...sketches, ...cut].flatMap((x) => x.loops), Math.max(4 * tol, 2 * eps, 0.03));
  // (between the levels only: cutters that share walls exactly with each other trouble the CAD kernel more)
  sameWalls(sketches.flatMap((x) => x.loops), Math.max(4 * tol, 2 * eps, 0.03));
  // (a level a few thousandths of a mm thick is a facet the slicer left, not a step anyone drew: no printer makes it)
  const real = (x) => x.loops.length && x.b - x.a >= 0.02;
  const S = sketches.filter((x) => real(x) || (x.loops.length && !sketches.some(real))).map((x) => ({ ...x, cs: loopsCs(x.loops) }));
  const K = cut.filter(real).map((x) => ({ ...x, cs: loopsCs(x.loops) }));
  if (!S.length) return null;
  // the model these make (grown or shrunk by delta), to compare with the mesh
  const model = (delta = 0) => {
    const ext = (x, d) => keep(keep((d ? keep(x.cs.offset(d, 'Miter', 4)) : x.cs).extrude(x.b - x.a)).translate([0, 0, x.a]));
    let A = keep(MF.Manifold.union(S.map((x) => ext(x, delta))));
    if (K.length) A = keep(A.subtract(keep(MF.Manifold.union(K.map((x) => ext(x, -delta))))));
    return A;
  };
  return { kind: 'prism', sketches: S, cutters: K, A: model(0), model, eps };
}

/** Is the part round about local z? Then: the profile spun around ({ center, loops, A }), or null. */
function revolvePlan(L, tol, AV = null) {
  const bb = L.boundingBox();
  const H = bb.max[2] - bb.min[2]; if (H <= tol) return null;
  const centers = [], sags = [];
  let tried = 0;
  for (let k = 1; k <= 9; k++) {
    const z = bb.min[2] + (H * k) / 10;
    const regs = regions(keep(L.slice(z)));
    if (!regs.length) continue;
    tried++;
    const big = regs.reduce((p, q) => (Math.abs(polyArea(q.outer)) > Math.abs(polyArea(p.outer)) ? q : p));
    const P = dedupe(big.outer, tol * 0.02);
    if (P.length < 8) continue;
    // most of the outline on one circle is enough (text engraved on the side, a flat, a notch)
    let f = fitCircle(P);
    for (let k = 0; f && k < 3 && f.dev > Math.max(tol, f.r * 0.002); k++) {
      const ok = (q) => Math.abs(Math.hypot(q[0] - f.c[0], q[1] - f.c[1]) - f.r) <= Math.max(tol * 3, f.r * (k ? 0.001 : 0.01));
      const on = P.filter(ok);
      // measured along the outline (engraved letters have many more points than the plain wall)
      let lenOn = 0; P.forEach((q, i) => { const w = P[(i + 1) % P.length]; if (ok(q) && ok(w)) lenOn += Math.hypot(w[0] - q[0], w[1] - q[1]); });
      if (lenOn < polyLen(P) * 0.6 || on.length < 8) { f = null; break; }
      f = fitCircle(on);
      if (f) f.dev = Math.max(...on.map((q) => Math.abs(Math.hypot(q[0] - f.c[0], q[1] - f.c[1]) - f.r)));
    }
    if (f && f.dev <= Math.max(tol, f.r * 0.002)) { centers.push(f.c); maxSag = 0; noteSag([...P, P[0]], f.r); sags.push(Math.max(maxSag, f.dev * 2)); }
  }
  if (globalThis.DEBUG_CONV > 1) console.log('revolve centers', tried, JSON.stringify(centers));
  if (centers.length < 3 || centers.length < tried * 0.3) return null; // (the vote below and the comparison decide)
  const med = (k) => centers.map((c) => c[k]).sort((p, q) => p - q)[centers.length >> 1];
  const c = [med(0), med(1)];
  if (centers.filter((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) <= tol * 2).length < centers.length * 0.6) return null;
  const C = keep(L.translate([-c[0], -c[1], 0]));
  // the profile at several angles; the most typical one (median area) leaves out handles and notches
  const R = Math.max(Math.abs(bb.min[0] - c[0]), Math.abs(bb.max[0] - c[0]), Math.abs(bb.min[1] - c[1]), Math.abs(bb.max[1] - c[1])) * 2 + 10;
  const half = keep(MF.CrossSection.square([R, H + 20]).translate([0, bb.min[2] - 10]));
  const profs = [];
  for (let k = 0; k < 12; k++) {
    const th = (k * 30 * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
    // x' = co*x + si*y, y' = z, z' = si*x - co*y: the half plane at angle th lies flat at z' = 0
    const rot = [co, 0, si, 0, si, 0, -co, 0, 0, 1, 0, 0, 0, 0, 0, 1];
    const T = keep(C.transform(rot));
    const cs = keep(keep(T.slice(0)).intersect(half));
    profs.push({ cs, A: cs.area(), rot });
  }
  // What most angles agree on: kept everywhere, it is in every cut (I); where the cuts differ (a notch, a
  // handle), each piece is kept when it is in most of them.
  const I = keep(MF.CrossSection.intersection(profs.map((q) => q.cs))), U = keep(MF.CrossSection.union(profs.map((q) => q.cs)));
  const polysOf = profs.map((q) => q.cs.toPolygons());
  let P = I;
  for (const piece of keep(U.subtract(I)).decompose()) {
    keep(piece);
    const pp = piece.toPolygons(), b = piece.bounds();
    let votes = 0, n = 0;
    for (let i = 1; i < 8 && n < 30; i++) for (let j = 1; j < 8 && n < 30; j++) {
      const pt = [b.min[0] + ((b.max[0] - b.min[0]) * i) / 8, b.min[1] + ((b.max[1] - b.min[1]) * j) / 8];
      if (!insidePolys(pp, pt)) continue;
      n++; votes += polysOf.filter((q) => insidePolys(q, pt)).length / profs.length;
    }
    if (n && votes / n > 0.5) P = keep(P.add(piece));
  }
  const prof = { cs: P, A: P.area(), rot: profs[0].rot };
  if (!(prof.A > tol * tol)) return null;
  const loops = [];
  maxSag = Math.max(...sags);
  // The cut runs across flat facets, a little inside the true curves. The mesh's own points sit exactly on
  // them: every point (as distance from the axis, height) near the cut outline replaces it.
  const cloud = new Map();
  { const { V } = meshArrays(C); for (let i = 0; i < V.length; i += 3) { const r = Math.hypot(V[i], V[i + 1]), z = V[i + 2]; cloud.set(`${Math.round(r * 1e4)},${Math.round(z * 1e4)}`, [r, z]); } }
  const near = Math.max(maxSag * 3, tol * 2);
  const onCurves = (P) => {
    const n = P.length, cell = Math.max(near * 4, 0.5), grid = new Map(), key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      for (let x = Math.floor((Math.min(a[0], b[0]) - near) / cell); x <= Math.floor((Math.max(a[0], b[0]) + near) / cell); x++) for (let y = Math.floor((Math.min(a[1], b[1]) - near) / cell); y <= Math.floor((Math.max(a[1], b[1]) + near) / cell); y++) {
        const k = `${x},${y}`; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
      }
    }
    const hits = [];
    for (const q of cloud.values()) {
      let best = null;
      for (const i of grid.get(key(q[0], q[1])) || []) {
        const a = P[i], b = P[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0;
        const d = Math.hypot(a[0] + dx * t - q[0], a[1] + dy * t - q[1]);
        if (d <= near && (!best || d < best.d)) best = { d, at: i + t };
      }
      if (best) hits.push([best.at, q]);
    }
    // a cut point with no mesh point next to it stays
    // a cut point stays only where no mesh point lies along the sides next to it
    const onSide = new Array(n).fill(false);
    for (const [at] of hits) onSide[Math.min(n - 1, Math.floor(at))] = true;
    for (let i = 0; i < n; i++) if (!onSide[i] && !onSide[(i - 1 + n) % n]) hits.push([i, P[i]]);
    const out = hits.sort((u, v) => u[0] - v[0]).map(([, q]) => q);
    // a ragged result (points from facets that do not line up) is worse than the cut itself
    let back = 0; for (let i = 1; i < hits.length; i++) if (hits[i][0] - hits[i - 1][0] < 1e-9 && Math.hypot(out[i][0] - out[i - 1][0], out[i][1] - out[i - 1][1]) > near) back++;
    return out.length > n * 4 + 200 || back > out.length * 0.1 ? P : out;
  };
  // a part cut out (or merged in) may stick out past the surfaces it opens onto (see pushOut)
  const avP = AV ? keep(keep(keep(AV.translate([-c[0], -c[1], 0])).transform(prof.rot)).slice(0)).toPolygons() : null;
  const gp = Math.min(1, Math.max(0.2, 0.1 * H));
  for (const reg of regions(prof.cs)) {
    for (const P0 of [reg.outer, ...reg.holes]) {
      let P = onCurves(P0);
      if (avP && P0 === reg.outer) P = pushOut(P, avP, gp, tol) || P;
      // points right on the axis stay on it
      const Q = P.map((p) => [Math.abs(p[0]) < tol ? 0 : p[0], p[1]]);
      const l = fitChecked(polyArea(Q) < 0 ? Q.slice().reverse() : Q, tol);
      if (l) loops.push(l);
    }
  }
  if (!loops.length || loops.reduce((k, l) => k + (l.pts?.length || 1), 0) > 400) return null;
  for (const l of loops) if (l.type === 'poly') l.pts.forEach((p) => { if (p[0] < 0) p[0] = 0; });
  const eps = maxSag, pcs = loopsCs(loops);
  const right = keep(MF.CrossSection.square([R, H + 20]).translate([0, bb.min[2] - 10]));
  const model = (delta = 0) => keep(keep(keep(delta ? keep(pcs.offset(delta, 'Miter', 4)).intersect(right) : pcs).revolve(Math.max(64, Math.min(256, Math.round(R * 2))))).translate([c[0], c[1], 0]));
  return { kind: 'revolve', center: c, loops, A: model(0), model, eps };
}

/**
 * A piece of a ring (one of several copies around an upright axis ax): its profile spun part of the way
 * around that axis. Returns a revolve plan with start and angle (degrees), or null.
 */
function sectorPlan(L, tol, ax) {
  const { V } = meshArrays(L);
  const angs = [];
  for (let i = 0; i < V.length; i += 3) angs.push((Math.atan2(V[i + 1] - ax[1], V[i] - ax[0]) * 180) / Math.PI);
  angs.sort((p, q) => p - q);
  let gap = angs[0] + 360 - angs[angs.length - 1], start = angs[0];
  for (let i = 1; i < angs.length; i++) if (angs[i] - angs[i - 1] > gap) { gap = angs[i] - angs[i - 1]; start = angs[i]; }
  const angle = 360 - gap;
  if (!(angle > 0.5 && angle < 300)) return null;
  const mid = start + angle / 2;
  const bb = L.boundingBox();
  // the cut through the middle of the piece, in the plane through the axis
  const C = keep(keep(L.translate([-ax[0], -ax[1], 0])).rotate([0, 0, -mid]));
  const R = Math.max(...[0, 1].flatMap((k) => [Math.abs(bb.min[k] - ax[k]), Math.abs(bb.max[k] - ax[k])])) * 2 + 10, H = bb.max[2] - bb.min[2];
  const right = keep(MF.CrossSection.square([R, H + 20]).translate([0, bb.min[2] - 10]));
  const cs = keep(keep(keep(C.transform([1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1])).slice(0)).intersect(right));
  maxSag = 0;
  const loops = regions(cs).flatMap((r) => [r.outer, ...r.holes]).map((P) => fitChecked(polyArea(P) < 0 ? P.slice().reverse() : P, tol)).filter(Boolean);
  if (!loops.length || loops.reduce((k, l) => k + (l.pts?.length || 1), 0) > 200) return null;
  const pcs = loopsCs(loops), eps = maxSag;
  const ang = +angle.toFixed(4), st = +start.toFixed(4);
  const model = (delta = 0) => keep(keep(keep(keep(delta ? keep(keep(pcs.offset(delta, 'Miter', 4)).intersect(right)) : pcs).revolve(Math.max(16, Math.round(ang)), ang)).rotate([0, 0, st])).translate([ax[0], ax[1], 0]));
  return { kind: 'revolve', center: [0, 0], axisAt: ax, loops, angle: ang, start: st, A: model(0), model, eps };
}

// ---------------------------------------------------------------- choosing and refining
const xorVol = (P, Q) => keep(P.subtract(Q)).volume() + keep(Q.subtract(P)).volume();
function significant(m, tol) {
  const v = m.volume(); if (v < Math.max(0.3, tol * tol * tol * 20)) return false;
  return (2 * v) / Math.max(m.surfaceArea(), 1e-9) > tol; // not a paper-thin sliver along a face
}

/** The shape grown by about g each way (copies moved along the axes, joined). */
function grow(m, g) {
  const moved = [[g, 0, 0], [-g, 0, 0], [0, g, 0], [0, -g, 0], [0, 0, g], [0, 0, -g]].map((v) => keep(m.translate(v)));
  return keep(MF.Manifold.union([m, ...moved]));
}

/**
 * One solid (world coordinates) as a plan: a base way of building it, plus parts merged in and cut out.
 * Q is where the result matters (null: everywhere). A part cut out only matters inside what it cuts, and
 * a part merged in only outside what it is merged into, so those can be simpler shapes that stick out.
 */
function solve(T, ctx, depth, Q = null, avoid = null) {
  const V = T.volume();
  const bb = T.boundingBox();
  const size = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
  const tol = ctx.tol, ztol = Math.max(1e-3, size * 1e-6);
  if (depth > 0) {
    // only the neighbourhood of this piece matters: much less to cut through
    const g = size * 0.25 + 2;
    const near = keep(keep(MF.Manifold.cube([0, 1, 2].map((k) => bb.max[k] - bb.min[k] + 2 * g))).translate(bb.min.map((x) => x - g)));
    if (Q) Q = keep(Q.intersect(near));
    if (avoid) avoid = keep(avoid.intersect(near));
  }
  const dirs = [['z', AXIS_FRAMES.z], ['x', AXIS_FRAMES.x], ['y', AXIS_FRAMES.y]];
  for (const d of mainDirections(T)) {
    const axisLike = Math.max(...d.map(Math.abs)) > 0.9995;
    if (!axisLike && !dirs.some(([, R]) => Math.abs(dot3([R[0][2], R[1][2], R[2][2]], d)) > 0.9995)) dirs.push(['d', frameFor(d)]);
  }
  const inQ = (m) => (Q ? keep(m.intersect(Q)) : m);
  const errOf = (W) => keep(T.subtract(W)).volume() + keep(inQ(W).subtract(T)).volume();
  const cands = [];
  const O = [0, 0, 0];
  for (const [name, R] of dirs) {
    const L = keep(T.transform(toLocalMat(R, O)));
    const t0 = Date.now();
    const p = depth === 0 && ctx.roundOnly ? null : prismPlan(L, tol, ztol, avoid && keep(avoid.transform(toLocalMat(R, O))));
    if (p) { const W = keep(p.A.transform(toWorldMat(R, O))); cands.push({ ...p, dir: name, R, err: errOf(W), W }); }
    if (globalThis.DEBUG_CONV) console.log('  '.repeat(depth) + ` prism ${name} ${Date.now() - t0} ms`);
    if (depth <= 1) {
      const t1 = Date.now();
      const r = revolvePlan(L, tol, avoid && keep(avoid.transform(toLocalMat(R, O))));
      if (globalThis.DEBUG_CONV) console.log('  '.repeat(depth) + ` revolve ${name} ${Date.now() - t1} ms`);
      if (r) { const W = keep(r.A.transform(toWorldMat(R, O))); if (globalThis.DEBUG_CONV > 1) console.log(' rev tris', W.numTri(), r.loops.length, JSON.stringify(r.loops).slice(0, 1500)); cands.push({ ...r, dir: name, R, err: errOf(W), W }); }
    }
  }
  for (const c of cands) { const world = toWorldMat(c.R, O); c.modelW = (dl) => keep(c.model(dl).transform(world)); }
  // Drawn as views, like a technical drawing: the outline seen from the top, the side or the front, each pushed
  // right through, keeping only where they overlap. Two or three sketches for many parts that a stack of
  // layers would need dozens for.
  const views = [];
  for (const [name, R] of depth === 0 && ctx.roundOnly ? [] : dirs.slice(0, 3)) {
    const L = keep(T.transform(toLocalMat(R, O))), lb = L.boundingBox();
    maxSag = 0;
    const loops = regions(keep(L.project())).flatMap((r) => [r.outer, ...r.holes]).map((P) => fitChecked(polyArea(P) < 0 ? P.slice().reverse() : P, tol)).filter(Boolean);
    if (!loops.length || loops.reduce((k, l) => k + (l.pts?.length || 1), 0) > 600) continue;
    const pad = Math.max(0.5, size * 0.01);
    views.push({ dir: name, R, loops, a: lb.min[2] - pad, b: lb.max[2] + pad, cs: loopsCs(loops), eps: maxSag });
    if (globalThis.DEBUG_CONV > 1) console.log('view', name, 'proj area', keep(L.project()).area().toFixed(1), 'loops area', views[views.length - 1].cs.area().toFixed(1), loops.length, JSON.stringify(loops).slice(0, 600));
  }
  const viewSolid = (v, dl) => keep(keep(keep((dl ? keep(v.cs.offset(dl, 'Miter', 4)) : v.cs).extrude(v.b - v.a)).translate([0, 0, v.a])).transform(toWorldMat(v.R, O)));
  if (views.length >= 2 && !(depth === 0 && ctx.roundOnly)) {
    const combos = views.length === 3 ? [[0, 1], [0, 2], [1, 2], [0, 1, 2]] : [[0, 1]];
    for (const combo of combos) {
      const vs = combo.map((i) => views[i]);
      const modelW = (dl = 0) => keep(MF.Manifold.intersection(vs.map((v) => viewSolid(v, dl))));
      const W = modelW(0);
      cands.push({ kind: 'views', views: vs, dir: vs.map((v) => v.dir).join(''), R: AXIS_FRAMES.z, W, modelW, err: errOf(W), eps: Math.max(...vs.map((v) => v.eps)) });
    }
  }
  if (depth === 0 && ctx.axis) {
    const sp = sectorPlan(T, tol, ctx.axis);
    if (sp) cands.push({ ...sp, dir: 'z', R: AXIS_FRAMES.z, err: errOf(sp.A), W: sp.A, modelW: sp.model });
  }
  if (!cands.length) return null;
  const nSteps = (c) => (c.kind === 'views' ? c.views.length + 1 : c.kind === 'revolve' ? 1 : c.sketches.length + c.cutters.length + (c.sketches.length > 1) + (c.cutters.length > 0));
  const cost = (c) => c.err / V + 0.0015 * D.step * nSteps(c) - (c.kind === 'revolve' ? 0.004 : 0) - (c.dir === 'z' ? 0.0005 : 0);
  cands.sort((p, q) => cost(p) - cost(q));
  if (globalThis.DEBUG_CONV) console.log('  '.repeat(depth) + 'cands', V.toFixed(1), cands.map((c) => `${c.kind}${c.dir} err ${(c.err / V * 100).toFixed(2)}% n ${c.sketches?.length}/${c.cutters?.length}`).join(' | '));
  // The best few starts are each worked out in full (with their parts merged in and cut out); the one that
  // ends closest to the mesh with the fewest steps wins. Below the top, the best start is taken as it is.
  // (no need when the best start is already as good as it gets)
  const tries = depth === 0 && cands[0].err / V > 0.003 ? cands.slice(0, 3).filter((c, i) => i === 0 || cost(c) < cost(cands[0]) + 0.15) : [cands[0]];
  // (at the top, the start alone also competes: extra steps that fix next to nothing only make it harder to edit)
  if (tries.length === 1 && depth > 0) return refine(tries[0]);
  let pick = null;
  const n0 = ctx.n, end = ctx.deadline;
  tries.sort((p, q) => nSteps(p) - nSteps(q)); // the simplest first: it is often the best
  for (const [i, best] of tries.entries()) {
    ctx.n = n0;
    ctx.deadline = Math.min(end, Date.now() + (end - Date.now()) / (tries.length - i)); // a fair share of the time
    const node = refine(best);
    const A = planModel(node), steps = countSteps(node);
    const score = (keep(T.subtract(A)).volume() + keep(A.subtract(T)).volume()) / V + 0.003 * D.step * steps;
    if (globalThis.DEBUG_CONV) console.log(`try ${best.kind}${best.dir}: ${steps} steps, score ${score.toFixed(4)}`);
    if (!pick || score < pick.score) pick = { node, score };
    // (only when what the extra steps fix is slivers, not real features like holes: those are thicker)
    const thin = [...node.add, ...node.sub].every((ch) => ch.thick < Math.max(0.3, 10 * tol));
    const bare = { base: best, add: [], sub: [], vol: V }, bareScore = best.err / V + 0.003 * D.step * countSteps(bare);
    if (thin && bareScore < pick.score) pick = { node: bare, score: bareScore };
    if (score - 0.003 * D.step * steps < 0.003) break; // (already as close as it gets)
  }
  ctx.n = n0 + countSteps(pick.node); ctx.deadline = end;
  return pick.node;

  function refine(best) {
    ctx.n += nSteps(best);
    const node = { base: best, add: [], sub: [], vol: V };
    if (depth >= ctx.maxDepth || best.err / V < 1e-4 || Date.now() > ctx.deadline) return node;
    // What the base gets wrong: material to add, then material to cut away. The facets of round parts leave
    // thin slivers all over; real pieces are found by growing (or shrinking) the base a little first, then each
    // is taken back at its full size.
    const d = Math.max(best.eps * 1.5 + tol, tol);
    const Win = best.modelW(-d), Wout = best.modelW(d);
    const children = (full, core, list, Qc, avoidC) => {
      const cores = core.decompose().map(keep).filter((m) => m.volume() > ctx.minVol && significant(m, tol)).sort((p, q) => q.volume() - p.volume());
      for (const c of cores.slice(0, 24)) {
        if (ctx.n > ctx.maxSteps || Date.now() > ctx.deadline) break;
        const piece = keep(full.intersect(grow(c, 2 * d + tol)));
        if (piece.isEmpty()) continue;
        const child = solve(piece, ctx, depth + 1, Qc, avoidC);
        if (child) { const pb = c.boundingBox(); child.thick = Math.min(...[0, 1, 2].map((k) => pb.max[k] - pb.min[k])); }
        // a piece only gets steps of its own when they at least halve what is wrong there
        if (child && child.base.err < piece.volume() * 0.5) list.push(child); else if (child) ctx.n -= countSteps(child);
      }
    };
    const U = keep(keep(MF.Manifold.cube([0, 1, 2].map((k) => bb.max[k] - bb.min[k] + 4 * size + 20))).translate(bb.min.map((x) => x - 2 * size - 10)));
    children(keep(T.subtract(best.W)), keep(T.subtract(Wout)), node.add, keep((Q || U).subtract(best.W)), keep(U.subtract(T)));
    let W2 = best.W, W2in = Win;
    for (const ch of node.add) { const m = planModel(ch); W2 = keep(W2.add(m)); W2in = keep(W2in.add(m)); }
    children(keep(inQ(W2).subtract(T)), keep(inQ(W2in).subtract(T)), node.sub, Q ? keep(Q.intersect(W2)) : W2, T);
    return node;
  }
}

// ---------------------------------------------------------------- the 3DJames steps
function emitter(doc, firstSeq = 1, mainBody = null) {
  // ids from the project's own counter, and the first object keeps the mesh object's id, so the steps can go
  // straight into the project (and the shapes built in the trial run are used again)
  let seq = firstSeq, first = mainBody;
  const id = (p) => p + seq++;
  return {
    id,
    body(name, color, hole) { const b = first || id('b'); first = null; doc.bodies[b] = { name, color, ...(hole ? { hole: true } : {}) }; return b; },
    push(f) { doc.features.push({ id: id('f'), ...f }); return doc.features[doc.features.length - 1]; },
    done() { doc.seq = seq + 1; },
  };
}
const mm = (x) => `${+x.toFixed(2)} mm`;
const DIR_WORD = { z: 'pushed up', x: 'pushed sideways', y: 'pushed back', d: 'pushed out' };
/**
 * Last check of an outline before it becomes a sketch: arcs so short or so flat the CAD kernel cannot tell them
 * from a line ("point not on curve") become lines, and points a hair apart become one.
 */
function cleanLoop(l) {
  if (l.type !== 'poly' || !l.bulge) return l;
  const pts = [], bulge = [];
  l.pts.forEach((p, k) => {
    const q = l.pts[(k + 1) % l.pts.length], ch = Math.hypot(q[0] - p[0], q[1] - p[1]);
    let b = l.bulge[k] || 0;
    if (b && (ch < 0.05 || (Math.abs(b) * ch) / 2 < 0.002)) b = 0;
    if (pts.length && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1]) < 0.005) { bulge[bulge.length - 1] = b; return; }
    pts.push(p); bulge.push(b);
  });
  while (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.005) { pts.pop(); bulge.pop(); }
  const out = { ...l, pts, bulge };
  if (l.round) out.round = l.round.length === pts.length ? l.round : undefined;
  if (!out.round) delete out.round;
  if (!bulge.some((b) => b)) delete out.bulge;
  return out;
}
function sketchFeature(E, body, loops, h, R, O, name, mode, angle = 360) {
  loops = loops.map(cleanLoop);
  const b = loopsBox(loops);
  let c3;
  if (mode === 'revolve') {
    c3 = [0, 0, (b.min[1] + b.max[1]) / 2];
    h = b.max[1] - b.min[1];
    if (angle < 360) {
      // spun part of the way round: the middle of what it sweeps (x, y) is not on the axis
      const pts = loops.flatMap((l) => (l.type === 'circle' ? [[l.c[0] - l.r, 0], [l.c[0] + l.r, 0]] : SG.flattenLoop(l)));
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let k = 0; k <= 720; k++) {
        const t = ((angle * k) / 720) * (Math.PI / 180);
        for (const [r] of pts) { const x = r * Math.cos(t), y = r * Math.sin(t); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      c3 = [(x0 + x1) / 2, (y0 + y1) / 2, c3[2]];
    }
  } else c3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, h / 2];
  const pos = add3(O, mulRv(R, c3)); pos[2] -= h / 2;
  const p = { loops };
  if (mode === 'revolve') { p.mode = 'revolve'; if (angle < 360) p.angle = angle; } else p.h = Math.round(h * 1e6) / 1e6;
  return E.push({ type: 'shape', body, kind: 'sketch', name, p, pos: pos.map((x) => Math.round(x * 1e6) / 1e6), rot: rotOf(R) });
}
/** Write a plan as steps. Returns the body that holds the result. */
function emitNode(E, node, name, color, role, ctx) {
  const { base } = node;
  const R = base.R;
  let main = null;
  const merged = [], cuts = [];
  if (base.kind === 'views') {
    const VIEW = { z: 'outline seen from the top', x: 'outline seen from the side', y: 'outline seen from the front' };
    const parts = base.views.map((v, i) => {
      const b = i === 0 ? (main = E.body(name, color, role === 'cut')) : E.body(`${name} ${VIEW[v.dir].split(' ').pop()} view`, color, role === 'cut');
      sketchFeature(E, b, v.loops, v.b - v.a, v.R, mulRv(v.R, [0, 0, v.a]), `${name}: ${VIEW[v.dir]}, pushed through`);
      return b;
    });
    E.push({ type: 'combine', op: 'intersect', body: main, tools: parts.slice(1), name: `${name}: keep where the views overlap` });
  } else if (base.kind === 'revolve') {
    main = E.body(name, color, role === 'cut');
    if (base.start != null) {
      // part of the way round, about an axis found from the copies around it
      const t = (base.start * Math.PI) / 180, Rz = [[Math.cos(t), -Math.sin(t), 0], [Math.sin(t), Math.cos(t), 0], [0, 0, 1]];
      sketchFeature(E, main, base.loops, 0, Rz, [base.axisAt[0], base.axisAt[1], 0], `${name}: profile spun ${+base.angle.toFixed(2)}° around`, 'revolve', base.angle);
    } else {
      const O = mulRv(R, [base.center[0], base.center[1], 0]);
      sketchFeature(E, main, base.loops, 0, R, O, role === 'cut' ? `${name}: profile spun around` : `${name}: profile spun around (sketch)`, 'revolve');
    }
  } else {
    base.sketches.forEach((s, i) => {
      const O = mulRv(R, [0, 0, s.a]);
      const b = i === 0 ? (main = E.body(name, color, role === 'cut')) : E.body(`${name} level ${i + 1}`, color, role === 'cut');
      // heights mean something when pushed up; sideways, the level number says enough
      const at = base.dir === 'z' ? ` at ${mm(s.a)}` : '';
      const what = i === 0 ? `${name}: outline ${DIR_WORD[base.dir]} ${mm(s.b - s.a)}` : `${name}: level ${i + 1}${at}, ${DIR_WORD[base.dir]} ${mm(s.b - s.a)}`;
      sketchFeature(E, b, s.loops, s.b - s.a, R, O, what);
      if (i) merged.push(b);
    });
    if (merged.length) E.push({ type: 'combine', op: 'union', body: main, tools: merged.slice(), name: `${name}: join the levels` });
    base.cutters.forEach((c, i) => {
      const O = mulRv(R, [0, 0, c.a]);
      const circles = c.loops.every((l) => l.type === 'circle');
      const label = circles ? (c.loops.length > 1 ? `${c.loops.length} holes` : `Hole Ø${+(c.loops[0].r * 2).toFixed(2)}`) : (c.loops.length > 1 ? `${c.loops.length} cut-outs` : 'Cut-out');
      const b = E.body(`${name} ${label.toLowerCase()} ${i + 1}`, HOLE_COLOR, true);
      sketchFeature(E, b, c.loops, c.b - c.a, R, O, base.dir === 'z' ? `${name}: ${label} at ${mm(c.a)}, ${mm(c.b - c.a)} deep` : `${name}: ${label}, ${mm(c.b - c.a)} long (${DIR_WORD[base.dir].split(' ')[1]})`);
      cuts.push(b);
    });
    if (cuts.length) E.push({ type: 'combine', op: 'subtract', body: main, tools: cuts.slice(), name: `${name}: cut the holes` });
  }
  const adds = node.add.map((ch, i) => emitNode(E, ch, `${name} added part ${i + 1}`, color, 'add', ctx));
  if (adds.length) E.push({ type: 'combine', op: 'union', body: main, tools: adds, name: `${name}: merge the added parts` });
  const subs = node.sub.map((ch, i) => emitNode(E, ch, `${name} cut ${i + 1}`, HOLE_COLOR, 'cut', ctx));
  if (subs.length) E.push({ type: 'combine', op: 'subtract', body: main, tools: subs, name: `${name}: cut away` });
  return main;
}
function countSteps(node) {
  if (!node) return 0;
  const b = node.base;
  return (b.kind === 'views' ? b.views.length + 1 : b.kind === 'revolve' ? 1 : b.sketches.length + b.cutters.length + 2) + node.add.reduce((s, c) => s + countSteps(c) + 1, 0) + node.sub.reduce((s, c) => s + countSteps(c) + 1, 0);
}
function planModel(node) {
  // the solid the plan makes (world), to measure it against the mesh
  let A = node.base.W;
  for (const c of node.add) A = keep(A.add(planModel(c)));
  for (const c of node.sub) A = keep(A.subtract(planModel(c)));
  return A;
}

// ---------------------------------------------------------------- copies in a pattern
function centroid(m) {
  const { V, T } = meshArrays(m);
  let vol = 0; const c = [0, 0, 0];
  for (let i = 0; i < T.length; i += 3) {
    const a = 3 * T[i], b = 3 * T[i + 1], d = 3 * T[i + 2];
    const A = [V[a], V[a + 1], V[a + 2]], B = [V[b], V[b + 1], V[b + 2]], D = [V[d], V[d + 1], V[d + 2]];
    const v = dot3(A, cross3(B, D)) / 6;
    vol += v; for (let k = 0; k < 3; k++) c[k] += (v * (A[k] + B[k] + D[k])) / 4;
  }
  return vol ? c.map((x) => x / vol) : c;
}
/**
 * Parts that are copies of one another, set in a ring (turned about an upright axis) or a row: one part is
 * drawn and the rest made by a pattern step. Returns [{ lead, members, step }] with step the 3DJames array step.
 */
function findPatterns(parts, tol) {
  const used = new Set(), out = [];
  const info = parts.map((m) => ({ m, v: m.volume(), c: centroid(m) }));
  const same = (A, B) => { const x = keep(A.subtract(B)).volume() + keep(B.subtract(A)).volume(); return x < A.volume() * 0.03; }; // (copies faceted a little differently)
  for (let i = 0; i < parts.length; i++) {
    if (used.has(i)) continue;
    const grp = info.map((p, j) => j).filter((j) => !used.has(j) && Math.abs(info[j].v - info[i].v) <= info[i].v * 0.002);
    if (grp.length < 3) continue;
    const zs = grp.map((j) => info[j].c[2]);
    const pb = info[i].m.boundingBox(), psize = Math.max(...[0, 1, 2].map((k) => pb.max[k] - pb.min[k]));
    // (copies exported from CAD are each faceted a little differently: their middles wander a little)
    const wander = Math.max(tol * 10, psize * 0.01);
    if (Math.max(...zs) - Math.min(...zs) > wander) continue;
    // a ring: the middles on a circle, evenly spaced
    const f = fitCircle(grp.map((j) => [info[j].c[0], info[j].c[1]]));
    if (globalThis.DEBUG_CONV) console.log('pattern?', grp.length, info[i].v.toFixed(1), f && f.r.toFixed(2), f && f.dev.toFixed(3), wander.toFixed(3));
    if (f && f.r > wander * 3 && f.dev < wander) {
      const ang = grp.map((j) => ({ j, a: (Math.atan2(info[j].c[1] - f.c[1], info[j].c[0] - f.c[0]) * 180) / Math.PI })).sort((p, q) => p.a - q.a);
      const gaps = ang.map((p, k) => ((ang[(k + 1) % ang.length].a - p.a + 360) % 360) || 360);
      const nFull = Math.round(360 / Math.min(...gaps)), step = 360 / nFull;
      if (nFull >= 2 && nFull <= 200 && gaps.every((g) => Math.abs(g / step - Math.round(g / step)) < 0.05)) {
        // the run starts after the biggest gap (for a full ring, anywhere)
        const big = gaps.indexOf(Math.max(...gaps));
        const order = ang.map((_, k) => ang[(big + 1 + k) % ang.length]);
        const full = order.length === nFull;
        const span = full ? 360 : ((order[order.length - 1].a - order[0].a + 360) % 360);
        if (full || Math.abs(span / step - (order.length - 1)) < 0.05) {
          const lead = info[order[0].j].m;
          const turned = (deg) => keep(keep(keep(lead.translate([-f.c[0], -f.c[1], 0])).rotate([0, 0, deg])).translate([f.c[0], f.c[1], 0]));
          if (globalThis.DEBUG_CONV) console.log('  ring', order.length, step, order.map((o, k) => k && (keep(turned(step * k).subtract(info[o.j].m)).volume() / info[i].v).toFixed(3)).join(' '));
          if (order.every((o, k) => !k || same(turned(step * k), info[o.j].m))) {
            order.forEach((o) => used.add(o.j));
            const cx = nice(f.c[0], tol), cy = nice(f.c[1], tol);
            out.push({ lead: order[0].j, members: order.map((o) => o.j), step: { type: 'array', kind: 'circular', n: order.length, angle: full ? 360 : nice(step * (order.length - 1), 1e-3), cx, cy } });
            continue;
          }
        }
      }
    }
    // a row: evenly spaced along a straight line
    const row = grp.slice().sort((p, q) => info[p].c[0] - info[q].c[0] || info[p].c[1] - info[q].c[1] || info[p].c[2] - info[q].c[2]);
    const d = [0, 1, 2].map((k) => info[row[1]].c[k] - info[row[0]].c[k]);
    if (Math.hypot(...d) > wander * 3 && row.every((j, k) => [0, 1, 2].every((a) => Math.abs(info[j].c[a] - info[row[0]].c[a] - d[a] * k) < wander))) {
      const lead = info[row[0]].m;
      if (row.every((j, k) => !k || same(keep(lead.translate(d.map((x) => x * k))), info[j].m))) {
        row.forEach((j) => used.add(j));
        out.push({ lead: row[0], members: row, step: { type: 'array', kind: 'linear', n: row.length, dx: nice(d[0], tol), dy: nice(d[1], tol), dz: nice(d[2], tol) } });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- entry point
/**
 * Rebuild a closed mesh as editable steps.
 * mf: the Manifold module. mesh: a Manifold (it is not changed). Returns
 * { features, bodies, seq, parts: [{body, name, volume, error (0..1 of the volume), steps, mesh: bool}] }
 * Parts that cannot be rebuilt closely (error above maxError) are left out (parts[i].mesh = true) so the
 * caller can keep them as an imported mesh.
 */
export function convertMesh(mf, mesh, { name = 'Part', detail = 'precise', maxError, maxSteps = 100, maxSeconds = 60, maxDepth = 3, plain = false, meshParts = [], seq = 1, body = null, reuse = null } = {}) {
  MF = mf; trash = []; fitPlain = plain;
  const LEVELS = ['simple', 'balanced', 'precise'], first = Math.max(0, LEVELS.indexOf(detail));
  D = DETAIL[LEVELS[first]];
  const doc = { bodies: {}, features: [] };
  const E = emitter(doc, seq, body);
  const out = [];
  try {
    const parts = mesh.decompose().map(keep).filter((m) => m.volume() > 1e-6).sort((p, q) => q.volume() - p.volume());
    const keepUntilEnd = trash.length; // the parts themselves; what each part makes is freed when it is done
    const freeFrom = (k) => { for (const x of trash.splice(Math.max(k, keepUntilEnd))) { try { x.delete(); } catch { /* already freed */ } } };
    // copies in a ring or a row: drawn once, then a pattern step (one object for the lot)
    const bbAll = mesh.boundingBox();
    const patterns = parts.length >= 3 ? findPatterns(parts, Math.min(0.02, Math.max(0.003, Math.hypot(...[0, 1, 2].map((k) => bbAll.max[k] - bbAll.min[k])) * 2e-5))) : [];
    const patternOf = new Map(patterns.map((g) => [g.lead, g]));
    const follower = new Set(patterns.flatMap((g) => g.members.slice(1)));
    freeFrom(keepUntilEnd);
    parts.forEach((T, pi) => { try { part(T, pi); } finally { freeFrom(keepUntilEnd); } });
    function part(T, pi) {
      if (follower.has(pi)) return;
      const pat = patternOf.get(pi);
      const bb = T.boundingBox();
      const size = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]);
      if (meshParts.includes(pi) || maxError < 0) {
        for (const j of [pi, ...(pat?.members.slice(1) || [])]) out.push({ name: parts.length > 1 ? `${name} part ${j + 1}` : name, volume: parts[j].volume(), error: 1, steps: 0, mesh: true, T: parts[j], broken: true });
        return;
      }
      const partName = parts.length > 1 ? `${name} part ${pi + 1}` : name;
      // (a part that was fine in an earlier try is written again as it was)
      const again = reuse?.get(pi);
      // With less detail asked for, a part that then strays too far is worked out again with more detail, rather
      // than left a mesh.
      let node = null, steps = 0, error = 1, ctx, limit = maxError ?? D.maxError;
      for (let lv = first; lv < LEVELS.length; lv++) {
        D = DETAIL[LEVELS[lv]]; limit = maxError ?? D.maxError;
        const tol = Math.min(D.tol, Math.max(0.003, size * 2e-5 * (D.tol / 0.02)));
        ctx = { axis: pat?.step.kind === 'circular' ? [pat.step.cx, pat.step.cy] : null, tol, minVol: T.volume() * D.minVol, maxDepth, maxSteps, n: 0, deadline: Date.now() + maxSeconds * 1000 };
        // curved all over (a figure, a boat): only a spun-around profile can do; anything else stays a mesh
        ctx.roundOnly = boxiness(T) < 0.5;
        node = again ? again.node : solve(T, ctx, 0);
        steps = countSteps(node);
        error = !node ? 1 : again ? again.error : xorVol(T, planModel(node)) / T.volume();
        if (globalThis.DEBUG_CONV) console.log('part error', error, 'steps', steps, LEVELS[lv]);
        if (again || (node && error <= limit && steps <= maxSteps)) break;
      }
      D = DETAIL[LEVELS[first]];
      if (!node) { out.push({ name: partName, volume: T.volume(), error: 1, steps: 0, mesh: true, T }); return; }
      if (error > limit || steps > maxSteps) {
        out.push({ name: partName, volume: T.volume(), error, steps, mesh: true, T });
        // its copies stay meshes too, each where it is
        for (const j of pat?.members.slice(1) || []) out.push({ name: `${name} part ${j + 1}`, volume: parts[j].volume(), error, steps: 0, mesh: true, T: parts[j] });
        return;
      }
      const start = doc.features.length;
      const body = emitNode(E, node, pat ? `${partName} (×${pat.members.length})` : partName, PALETTE[pi % PALETTE.length], 'main', ctx);
      if (pat) E.push({ ...pat.step, body, name: pat.step.kind === 'circular' ? `${pat.members.length} copies around a circle` : `${pat.members.length} copies in a row` });
      out.push({ pi, node, name: partName, body, volume: T.volume() * (pat ? pat.members.length : 1), error, steps: doc.features.length - start, mesh: false, from: start, to: doc.features.length });
    }
    E.done();
    // parts kept as meshes come back as triangles, to bring in as imported meshes
    return {
      features: doc.features, bodies: doc.bodies, seq: doc.seq,
      parts: out.map(({ T, ...p }) => {
        if (p.node) Object.defineProperty(p, 'node', { value: p.node, enumerable: false }); // (kept for a retry, not sent back)
        if (p.mesh) { const { V, T: tri } = meshArrays(T); p.vertices = new Float32Array(V); p.triangles = new Uint32Array(tri); } return p; }),
    };
  } finally {
    for (const x of trash) { try { x.delete(); } catch { /* already freed */ } }
    trash = [];
  }
}

// ---------------------------------------------------------------- how close is it?
function closestOnTri(p, a, b, c) {
  // Ericson, Real-Time Collision Detection 5.1.5
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = dot3(ab, ap), d2 = dot3(ac, ap); if (d1 <= 0 && d2 <= 0) return a;
  const bp = [p[0] - b[0], p[1] - b[1], p[2] - b[2]], d3 = dot3(ab, bp), d4 = dot3(ac, bp); if (d3 >= 0 && d4 <= d3) return b;
  const vc = d1 * d4 - d3 * d2; if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return add3(a, scale3(ab, v)); }
  const cp = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], d5 = dot3(ab, cp), d6 = dot3(ac, cp); if (d6 >= 0 && d5 <= d6) return c;
  const vb = d5 * d2 - d1 * d6; if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return add3(a, scale3(ac, w)); }
  const va = d3 * d6 - d5 * d4; if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); return add3(b, scale3([c[0] - b[0], c[1] - b[1], c[2] - b[2]], w)); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return add3(a, add3(scale3(ab, v), scale3(ac, w)));
}
function boundsOf(V) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], V[i + k]); max[k] = Math.max(max[k], V[i + k]); }
  return { min, max };
}
/** The largest distance from points of mesh P to the surface of mesh Q (Manifolds, or { V, T } triangles). */
function maxDistance(P, Q) {
  const { V, T } = Q.V ? Q : meshArrays(Q);
  const bb = boundsOf(V);
  const span = Math.max(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) || 1;
  const n = Math.max(1, Math.min(96, Math.round(Math.cbrt(T.length / 3 / 2))));
  const cell = span / n + 1e-9;
  const key = (i, j, k) => (i * 1031 + j) * 1031 + k;
  const grid = new Map();
  const ci = (x, ax) => Math.max(0, Math.min(n - 1, Math.floor((x - bb.min[ax]) / cell)));
  const tri = (t) => [0, 1, 2].map((k) => [V[3 * T[3 * t + k]], V[3 * T[3 * t + k] + 1], V[3 * T[3 * t + k] + 2]]);
  for (let t = 0; t < T.length / 3; t++) {
    const p = tri(t);
    const lo = [0, 1, 2].map((ax) => ci(Math.min(p[0][ax], p[1][ax], p[2][ax]), ax)), hi = [0, 1, 2].map((ax) => ci(Math.max(p[0][ax], p[1][ax], p[2][ax]), ax));
    for (let i = lo[0]; i <= hi[0]; i++) for (let j = lo[1]; j <= hi[1]; j++) for (let k = lo[2]; k <= hi[2]; k++) { const g = key(i, j, k); if (!grid.has(g)) grid.set(g, []); grid.get(g).push(t); }
  }
  const pts = P.V ? P : meshArrays(P);
  const samples = [];
  for (let i = 0; i < pts.V.length; i += 3) samples.push([pts.V[i], pts.V[i + 1], pts.V[i + 2]]);
  for (let t = 0; t < pts.T.length; t += 3) { const a = 3 * pts.T[t], b = 3 * pts.T[t + 1], c = 3 * pts.T[t + 2]; samples.push([0, 1, 2].map((k) => (pts.V[a + k] + pts.V[b + k] + pts.V[c + k]) / 3)); }
  const step = Math.max(1, Math.floor(samples.length / 20000));
  let worst = 0;
  for (let s = 0; s < samples.length; s += step) {
    const p = samples[s];
    const c0 = [0, 1, 2].map((ax) => ci(p[ax], ax));
    let best = Infinity;
    for (let r = 0; r <= n; r++) {
      if (best < (r - 1) * cell) break;
      for (let i = c0[0] - r; i <= c0[0] + r; i++) for (let j = c0[1] - r; j <= c0[1] + r; j++) for (let k = c0[2] - r; k <= c0[2] + r; k++) {
        if (Math.max(Math.abs(i - c0[0]), Math.abs(j - c0[1]), Math.abs(k - c0[2])) !== r) continue;
        const list = grid.get(key(i, j, k)); if (!list) continue;
        for (const t of list) { const [a, b, c] = tri(t); const q = closestOnTri(p, a, b, c); const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d < best) best = d; }
      }
    }
    if (best > worst) { worst = best; maxDistance.at = p; }
    if (best === Infinity) break;
  }
  return worst;
}
/**
 * Compare the rebuilt objects (Manifolds, not changed) with the original mesh.
 * Returns { volume, rebuiltVolume, volumeDiff, xor (share of the volume that differs), maxGap (mm), size, rebuiltSize }.
 */
export function compareResult(mf, original, bodies, soups = []) {
  MF = mf; trash = [];
  try {
    let A = null;
    for (const m of bodies) A = A ? keep(A.add(m)) : m;
    // parts of the STL that overlap count once
    const mesh = keep(mf.Manifold.union(original.decompose().map(keep)));
    const V = mesh.volume(), bb = mesh.boundingBox();
    const size = [0, 1, 2].map((k) => bb.max[k] - bb.min[k]);
    if (soups.length) {
      // some solids only as triangles that do not close up: their volume from the CAD kernel, the gaps from the
      // triangles (how much differs is then estimated from the volumes)
      const all = { V: [], T: [] };
      const addSoup = (V2, T2) => { const o = all.V.length / 3; for (const x of V2) all.V.push(x); for (const t of T2) all.T.push(t + o); };
      for (const s of soups) addSoup(s.vertices, s.triangles);
      for (const m of bodies) { const { V: V2, T: T2 } = meshArrays(m); addSoup(V2, T2); }
      // (parts that overlap each other count each time, on both sides)
      const vol = soups.reduce((k, s) => k + s.volume, 0) + bodies.reduce((k, m) => k + m.volume(), 0);
      const V1 = original.decompose().map(keep).reduce((k, m) => k + m.volume(), 0);
      const ab = boundsOf(all.V);
      return { volume: V1, rebuiltVolume: vol, volumeDiff: Math.abs(vol - V1) / V1, xor: Math.abs(vol - V1) / V1, estimated: true,
        maxGap: Math.max(maxDistance(original, all), maxDistance(all, original)), size, rebuiltSize: [0, 1, 2].map((k) => ab.max[k] - ab.min[k]) };
    }
    if (!A) return { volume: V, rebuiltVolume: 0, volumeDiff: 1, xor: 1, maxGap: Infinity, size, rebuiltSize: [0, 0, 0] };
    const ab = A.boundingBox();
    return {
      volume: V, rebuiltVolume: A.volume(), volumeDiff: Math.abs(A.volume() - V) / V, xor: xorVol(mesh, A) / V,
      maxGap: Math.max(maxDistance(mesh, A), maxDistance(A, mesh)), gaps: [maxDistance(mesh, A), maxDistance(A, mesh)], size, rebuiltSize: [0, 1, 2].map((k) => ab.max[k] - ab.min[k]),
    };
  } finally {
    for (const x of trash) { try { x.delete(); } catch { /* already freed */ } }
    trash = [];
  }
}
export const worstAt = () => maxDistance.at;

/**
 * convertMesh, then build the steps with the real geometry engine (build(doc) -> { errors, meshes: Map body ->
 * Manifold }) and measure the result against the mesh. When the engine cannot build a part, it is tried again
 * more simply (fewer levels of cut-outs, then straight sides only); a part that still fails stays a mesh.
 */
export function convertAndCheck(mf, mesh, opts, build) {
  // the simpler tries may differ a little more from the mesh, rather than leave it a mesh
  // again: the main shape only (no cut-outs and additions), then with straight sides
  // (with less detail asked for, all the detail comes first: the engine may fail on the looser drawing)
  const tries = [{}, ...(opts.detail && opts.detail !== 'precise' ? [{ detail: 'precise' }] : []),
    { detail: 'precise', maxDepth: 0, maxError: 0.05, maxSeconds: 25 }, { detail: 'precise', maxDepth: 0, plain: true, maxError: 0.05, maxSeconds: 25 }];
  let res, check, meshParts = [];
  const t0 = Date.now();
  let reuse = null;
  for (let t = 0; t <= tries.length; t++) {
    res = convertMesh(mf, mesh, { ...opts, ...(tries[Math.min(t, tries.length - 1)]), meshParts, reuse });
    check = build({ vars: [], bodies: res.bodies, features: res.features });
    // (a part the CAD kernel built far from what the plan makes failed too, without saying so: a cut that took
    // everything away, or nothing)
    const builtVol = (p) => { const m = check.meshes.get(p.body), s = check.soups?.get(p.body); return m ? m.volume() : s ? s.volume : 0; };
    const bad = res.parts.filter((p) => !p.mesh
      && (!(check.meshes.get(p.body) || check.soups?.get(p.body)) || res.features.slice(p.from, p.to).some((f) => check.errors[f.id]) || check.errors['body:' + p.body]
        || Math.abs(builtVol(p) - p.volume) > 0.1 * p.volume)).map((p) => p.pi);
    if (globalThis.DEBUG_CONV && bad.length) console.log('engine could not build parts', bad, JSON.stringify(check.errors).slice(0, 400));
    if (!bad.length) break;
    // only the parts the engine could not build are tried again
    reuse = new Map(res.parts.filter((p) => !p.mesh && !bad.includes(p.pi)).map((p) => [p.pi, { node: p.node, error: p.error }]));
    if (t >= tries.length - 1 || Date.now() - t0 > 150000 + 60000 * (tries.length - 3)) { meshParts = [...meshParts, ...bad]; t = tries.length - 1; } // a simpler try failed too: leave it a mesh
  }
  if (globalThis.DEBUG_CONV) console.log('parts', JSON.stringify(res.parts.map((p) => ({ pi: p.pi, body: p.body, mesh: p.mesh, built: !!check.meshes.get(p.body), soup: !!check.soups?.get(p.body), steps: p.steps }))));
  const kept = res.parts.filter((p) => p.mesh).map((p) => new mf.Manifold(new mf.Mesh({ numProp: 3, vertProperties: p.vertices, triVerts: p.triangles })));
  const built = res.parts.filter((p) => !p.mesh);
  const solids = built.map((p) => check.meshes.get(p.body)).filter(Boolean);
  const soups = built.map((p) => !check.meshes.get(p.body) && check.soups?.get(p.body)).filter(Boolean);
  res.report = solids.length || soups.length ? compareResult(mf, mesh, [...solids, ...kept], soups) : null;
  for (const m of kept) m.delete();
  if (globalThis.DEBUG_CONV) console.log('report', JSON.stringify(res.report));
  if (res.report && res.report.xor > 0.1) {
    // the built result is far from what the plan promised: say it plainly and keep the mesh
    return convertAndCheck(mf, mesh, { ...opts, maxError: -1 }, build);
  }
  res.errors = check.errors;
  return res;
}

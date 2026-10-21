// The sketch rules solver: rules ("stays flat", "parallel to", "this long"...) and how they are made to hold.
// Plain math on loops (see sketchgeom.js), no screen code, so it can be used and tested on its own.
import * as SG from './sketchgeom.js';

export const POINT_RULES = new Set(['dx', 'dy', 'dist']);
export const isCircleRef = (s) => !!s?.circle;
export const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };
// rules that hold a point onto something: { t: 'same', p, q } | { t: 'on', p, a } | { t: 'mid', p, a } | { t: 'pin', p, v: [x, y] }
// a: a side {l, i}, a whole circle {l, circle: 1}, or a fixed line {fixed: [[x,y],[x,y]]} (an edge of the face sketched on)
export const ATTACH = new Set(['same', 'on', 'mid', 'pin']);
/** The points (p, q) and sides (a, b) a rule refers to, so they can be renumbered when points are added or removed. */
export function ruleRefs(r) {
  if (POINT_RULES.has(r.t) || r.t === 'same') return { pts: [r.p, r.q], sides: [] };
  if (r.t === 'pin') return { pts: [r.p], sides: [] };
  if (r.t === 'on' || r.t === 'mid') return { pts: [r.p], sides: r.a.fixed || r.a.circle ? [] : [r.a], whole: r.a.circle ? [r.a] : [] };
  if (r.t === 'smooth') return { pts: [], sides: [], corners: [r.a] };
  if (r.t === 'anchor') return { pts: [r.p], sides: [] };
  if (r.t === 'freeze') return { pts: [], sides: [], whole: [r.a] };
  if (r.t === 'sym') return { pts: [r.p, r.q], sides: r.a && r.a.i != null ? [r.a] : [] };
  const ab = [r.a, r.b].filter(Boolean);
  return { pts: [], sides: ab.filter((s) => !isCircleRef(s)), whole: ab.filter(isCircleRef) };
}

// ---------------------------------------------------------------- rules solver
// Rules on sides: { t, a: {l, i}, b?: {l, i}, v? }   (i = side number: from point i to point i + 1)
// Rules between two points: { t: 'dx' | 'dy' | 'dist', p: ref, q: ref, v }   ref = {l, k} (point k, or a circle's center) or {o: 1} (the center of the sketch)
// Smooth join at a corner: { t: 'smooth', a: {l, i} }  (i = the corner between side i-1 and side i; one of them is an arc)
export const ORIGIN = Object.freeze([0, 0]);
export function pointOf(loops, r) {
  if (!r) return null; if (r.o) return ORIGIN;
  const l = loops[r.l]; if (!l) return null;
  return l.type === 'circle' ? l.c : l.pts?.[r.k] || null;
}
export function sideVec(loops, s) { const l = loops[s.l]; if (!l?.pts) return null; const A = l.pts[s.i], B = l.pts[(s.i + 1) % l.pts.length]; return A && B ? [A, B] : null; }
export const bulgeOf = (l, i) => +(l?.bulge?.[i] || 0);
export const rot = ([x, y], a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
/** Direction a side leaves its first point (start) or arrives at its last point (end). */
export function sideTangent(l, i, atEnd) {
  const n = l.pts.length, A = l.pts[i], B = l.pts[(i + 1) % n], d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d) || 1e-9, u = [d[0] / L, d[1] / L];
  const b = bulgeOf(l, i); if (!b) return u;
  const half = 2 * Math.atan(b); // half the sweep
  return rot(u, atEnd ? half : -half);
}
/** Radius of a whole circle ({l, circle: 1}) or of an arc side ({l, i}); null for a straight side. */
export function radiusOf(loops, s) {
  const l = loops[s.l]; if (!l) return null;
  if (s.circle) return l.type === 'circle' ? +l.r : null;
  const v = sideVec(loops, s); if (!v) return null;
  const R = SG.arcRadius(v[0], v[1], bulgeOf(l, s.i)); return Number.isFinite(R) ? R : null;
}
/** Direction of a straight side, in radians. */
export function sideAngle(loops, s) { const v = sideVec(loops, s); return v ? Math.atan2(v[1][1] - v[0][1], v[1][0] - v[0][0]) : null; }
/** Angle of an angle rule as it is now (degrees, signed: the same way the rule stores it). */
export function angleNow(loops, r) {
  const a = sideAngle(loops, r.a); if (a == null) return null;
  if (!r.b) return (a * 180) / Math.PI;
  const b = sideAngle(loops, r.b); if (b == null) return null;
  return (wrapPi(b - a) * 180) / Math.PI;
}
/** What a "value" rule measures right now. */
export function valueNow(loops, r) {
  if (r.t === 'angle') return angleNow(loops, r);
  if (r.t === 'diam') { const c = loops[r.a.l]; return c?.type === 'circle' ? 2 * c.r : null; }
  if (r.t === 'radius') return radiusOf(loops, r.a);
  if (r.t === 'length') { const v = sideVec(loops, r.a); return v ? Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]) : null; }
  const P = pointOf(loops, r.p), Q = pointOf(loops, r.q); if (!P || !Q) return null;
  return r.t === 'dx' ? Q[0] - P[0] : r.t === 'dy' ? Q[1] - P[1] : Math.hypot(Q[0] - P[0], Q[1] - P[1]);
}
export function ruleResiduals(loops, rules) {
  const out = [];
  for (const r of rules) {
    if (r.ref || r.off || r.t === 'anchor' || r.t === 'freeze') continue; // just showing / not rules the solver works on
    if (r.t === 'diam') { const c = loops[r.a.l]; if (c?.type === 'circle') out.push(2 * c.r - r.v); continue; }
    if (r.t === 'eqr') { const A = radiusOf(loops, r.a), B = radiusOf(loops, r.b); if (A != null && B != null) out.push(A - B); continue; }
    if (r.t === 'tangent') {
      const [s1, s2] = isCircleRef(r.a) ? [r.b, r.a] : [r.a, r.b]; // s2 is always a circle
      const c2 = loops[s2.l]; if (c2?.type !== 'circle') continue;
      if (isCircleRef(s1)) {
        const c1 = loops[s1.l]; if (c1?.type !== 'circle') continue;
        const d = Math.hypot(c1.c[0] - c2.c[0], c1.c[1] - c2.c[1]);
        out.push(r.inside ? d - Math.abs(c1.r - c2.r) : d - (+c1.r + +c2.r));
      } else {
        const v = sideVec(loops, s1); if (!v) continue; const [A, B] = v;
        const d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d) || 1e-9;
        out.push(Math.abs(((c2.c[0] - A[0]) * d[1] - (c2.c[1] - A[1]) * d[0]) / L) - c2.r);
      }
      continue;
    }
    if (r.t === 'sym') {
      const P = pointOf(loops, r.p), Q = pointOf(loops, r.q); if (!P || !Q) continue;
      if (r.a?.axis != null) { const k = r.a.axis, o = 1 - k; out.push(P[k] + Q[k], P[o] - Q[o]); continue; }
      const v = sideVec(loops, r.a); if (!v) continue; const [A, B] = v;
      const d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d) || 1e-9, u = [d[0] / L, d[1] / L];
      const M = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2];
      out.push((M[0] - A[0]) * u[1] - (M[1] - A[1]) * u[0], (Q[0] - P[0]) * u[0] + (Q[1] - P[1]) * u[1]);
      continue;
    }
    if (r.t === 'angle') {
      const now = angleNow(loops, r); if (now == null) continue;
      const v = sideVec(loops, r.a), la = v ? Math.hypot(v[1][0] - v[0][0], v[1][1] - v[0][1]) : 1;
      let lb = la; if (r.b) { const w = sideVec(loops, r.b); lb = w ? Math.hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]) : 1; }
      out.push(wrapPi(((now - r.v) * Math.PI) / 180) * Math.min(la, lb));
      continue;
    }
    if (POINT_RULES.has(r.t)) {
      const P = pointOf(loops, r.p), Q = pointOf(loops, r.q); if (!P || !Q) continue;
      if (r.t === 'dx') out.push(Q[0] - P[0] - r.v);
      else if (r.t === 'dy') out.push(Q[1] - P[1] - r.v);
      else out.push(Math.hypot(Q[0] - P[0], Q[1] - P[1]) - r.v);
      continue;
    }
    if (ATTACH.has(r.t)) {
      const P = pointOf(loops, r.p); if (!P) continue;
      if (r.t === 'pin') { out.push(P[0] - r.v[0], P[1] - r.v[1]); continue; }
      if (r.t === 'same') { const Q = pointOf(loops, r.q); if (!Q) continue; out.push(Q[0] - P[0], Q[1] - P[1]); continue; }
      if (r.a.circle) { const c = loops[r.a.l]; if (c?.type !== 'circle') continue; out.push(Math.hypot(P[0] - c.c[0], P[1] - c.c[1]) - c.r); continue; }
      const AB = r.a.fixed || sideVec(loops, r.a); if (!AB) continue;
      const [A, B] = AB;
      if (r.t === 'mid') { const M = r.a.fixed ? [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] : SG.arcMid(A, B, bulgeOf(loops[r.a.l], r.a.i)); out.push(P[0] - M[0], P[1] - M[1]); continue; }
      const d = [B[0] - A[0], B[1] - A[1]], L = Math.hypot(...d) || 1e-9;
      out.push(((P[0] - A[0]) * d[1] - (P[1] - A[1]) * d[0]) / L); // how far off the line (the line runs on past its ends)
      continue;
    }
    if (r.t === 'smooth') {
      const l = loops[r.a.l]; if (!l?.pts) continue; const n = l.pts.length, k = r.a.i;
      const tin = sideTangent(l, (k - 1 + n) % n, true), tout = sideTangent(l, k, false);
      out.push((tin[0] * tout[1] - tin[1] * tout[0]) * 10);
      continue;
    }
    const a = sideVec(loops, r.a), b = r.b ? sideVec(loops, r.b) : null;
    if (!a || (r.b && !b)) continue;
    const da = [a[1][0] - a[0][0], a[1][1] - a[0][1]], la = Math.hypot(...da) || 1e-9;
    if (r.t === 'flat') out.push(da[1]);
    else if (r.t === 'upright') out.push(da[0]);
    else if (r.t === 'length') out.push(la - r.v);
    else if (r.t === 'radius') { const R = SG.arcRadius(a[0], a[1], bulgeOf(loops[r.a.l], r.a.i)); out.push(Number.isFinite(R) ? R - r.v : 1e3); }
    else {
      const db = [b[1][0] - b[0][0], b[1][1] - b[0][1]], lb = Math.hypot(...db) || 1e-9;
      if (r.t === 'parallel') out.push(((da[0] * db[1] - da[1] * db[0]) / (la * lb)) * Math.min(la, lb));
      else if (r.t === 'square') out.push(((da[0] * db[0] + da[1] * db[1]) / (la * lb)) * Math.min(la, lb));
      else if (r.t === 'equal') out.push(la - lb);
    }
  }
  return out;
}
/** Every number the rules may change: the points they touch, and how much arcs bend. */
/** Points no rule may move: the locked starting point, and everything in a frozen shape. */
function heldThings(loops, rules, opt = {}) {
  const pts = new Set(), frozen = new Set();
  for (const r of rules) {
    if (r.t === 'anchor' && !r.off && !opt.noAnchor) { const P = pointOf(loops, r.p); if (P) pts.add(P); }
    if (r.t === 'freeze') { const l = loops[r.a.l]; if (!l) continue; frozen.add(l); for (const p of l.type === 'circle' ? [l.c] : l.pts) pts.add(p); }
  }
  return { pts, frozen };
}
function ruleVars(loops, rules, fixed, opt = {}) {
  const vars = [], seenP = new Set(), seenB = new Set(), seenR = new Set();
  const held = heldThings(loops, rules, opt);
  // helper lines give way first: their points move much more easily than the outline's
  const helperPts = new Set(loops.filter((l) => l.type === 'line').flatMap((l) => l.pts));
  // `fixed` (the point being dragged or typed) holds on hardest, but pins and other rules still win over it
  const addP = (p) => { if (!p || p === ORIGIN || seenP.has(p) || held.pts.has(p)) return; seenP.add(p); const w = fixed.has(p) ? 1e4 : helperPts.has(p) ? 0.05 : 1; vars.push({ w, get: () => p[0], set: (v) => { p[0] = v; } }, { w, get: () => p[1], set: (v) => { p[1] = v; } }); };
  const addB = (l, i) => {
    const tag = `${loops.indexOf(l)}:${i}`; if (seenB.has(tag) || !bulgeOf(l, i) || held.frozen.has(l)) return; seenB.add(tag);
    vars.push({ w: 1, get: () => bulgeOf(l, i), set: (v) => { if (!l.bulge) l.bulge = l.pts.map(() => 0); l.bulge[i] = v; } });
  };
  const addR = (l) => { if (l?.type !== 'circle' || seenR.has(l) || held.frozen.has(l)) return; seenR.add(l); vars.push({ w: 1, get: () => +l.r, set: (v) => { l.r = v; } }); };
  const addRef = (s) => {
    if (!s) return; const L2 = loops[s.l]; if (!L2) return;
    if (isCircleRef(s)) { addP(L2.c); addR(L2); return; }
    if (!L2.pts) return; addP(L2.pts[s.i]); addP(L2.pts[(s.i + 1) % L2.pts.length]); addB(L2, s.i);
  };
  for (const r of rules) {
    if (r.ref || r.off || r.t === 'anchor' || r.t === 'freeze') continue;
    if (r.t === 'diam' || r.t === 'eqr' || r.t === 'tangent' || r.t === 'angle') { addRef(r.a); addRef(r.b); continue; }
    if (r.t === 'sym') { addP(pointOf(loops, r.p)); addP(pointOf(loops, r.q)); if (r.a && r.a.i != null) addRef(r.a); continue; }
    if (POINT_RULES.has(r.t)) { addP(pointOf(loops, r.p)); addP(pointOf(loops, r.q)); continue; }
    if (ATTACH.has(r.t)) {
      addP(pointOf(loops, r.p)); if (r.q) addP(pointOf(loops, r.q));
      if (r.a && !r.a.fixed) { const L2 = loops[r.a.l]; if (L2?.type === 'circle') addP(L2.c); else if (L2?.pts) { addP(L2.pts[r.a.i]); addP(L2.pts[(r.a.i + 1) % L2.pts.length]); } }
      continue;
    }
    const l = loops[r.a.l]; if (!l?.pts) continue; const n = l.pts.length;
    if (r.t === 'smooth') { const k = r.a.i; for (const j of [k - 1, k, k + 1]) addP(l.pts[(j + n) % n]); addB(l, (k - 1 + n) % n); addB(l, k); continue; }
    for (const s of [r.a, r.b]) { if (!s) continue; const L2 = loops[s.l]; if (!L2?.pts) continue; addP(L2.pts[s.i]); addP(L2.pts[(s.i + 1) % L2.pts.length]); }
    if (r.t === 'radius') addB(l, r.a.i);
  }
  return vars;
}
export function solveRules(loops, rules, fixed = new Set(), opt = {}) {
  if (!rules?.length) return true;
  const vars = ruleVars(loops, rules, fixed, opt);
  if (!vars.length) return ruleResiduals(loops, rules).every((x) => Math.abs(x) < 1e-6);
  const get = () => vars.map((v) => v.get());
  const set = (x) => vars.forEach((v, i) => v.set(x[i]));
  const x0 = get();
  const lm = (x, W) => {
    const resid = (y) => { set(y); const r = ruleResiduals(loops, rules); return W ? [...r, ...y.map((v, i) => (v - x0[i]) * W * vars[i].w)] : r; };
    let lam = 1e-3;
    for (let it = 0; it < 400; it++) {
      const r0 = resid(x), n = x.length, m = r0.length;
      const cost = r0.reduce((s, v) => s + v * v, 0);
      if (cost < 1e-24) break;
      const J = Array.from({ length: m }, () => new Float64Array(n));
      for (let j = 0; j < n; j++) { const xs = x.slice(); const hstep = 1e-7 * Math.max(1, Math.abs(xs[j])); xs[j] += hstep; const r1 = resid(xs); for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r0[i]) / hstep; }
      const JTJ = Array.from({ length: n }, () => new Float64Array(n)), g = new Float64Array(n);
      for (let i = 0; i < m; i++) { const Ji = J[i]; for (let a = 0; a < n; a++) { if (!Ji[a]) continue; g[a] += Ji[a] * r0[i]; for (let b = 0; b < n; b++) JTJ[a][b] += Ji[a] * Ji[b]; } }
      let ok = false;
      for (let tries = 0; tries < 16 && !ok; tries++) {
        const A = JTJ.map((row, a) => { const r = Float64Array.from(row); r[a] += lam * vars[a].w * vars[a].w; return r; });
        const dx = gauss(A, Array.from(g, (v) => -v));
        if (dx) {
          const xn = x.map((v, i) => v + dx[i]);
          const c1 = resid(xn).reduce((s, v) => s + v * v, 0);
          if (c1 < cost) { x = xn; ok = true; lam = Math.max(1e-12, lam / 5); break; }
        }
        lam *= 6;
      }
      if (!ok) break;
    }
    return x;
  };
  // Levenberg-Marquardt, twice: first with a very light pull back to where things were (so parts no rule touches
  // stay put), then without it to make the rules come out exact.
  let x = lm(x0.slice(), 1e-4);
  x = lm(x, 1e-7);
  set(x.map((v) => Math.round(v * 1e6) / 1e6));
  return ruleResiduals(loops, rules).every((v) => Math.abs(v) < 1e-3);
}
/**
 * How locked the drawing is. Every point (and arc bend and circle size) is a number that could change; each rule
 * takes some freedom away. Returns how many ways it can still move (`free`) and which points are fully locked.
 */
export function analyzeSketch(loops, rules) {
  const held = heldThings(loops, rules);
  const vars = []; // { get, set, owner, kind }
  for (const l of loops) {
    const pts = l.type === 'circle' ? [l.c] : l.pts;
    for (const p of pts) if (!held.pts.has(p)) vars.push({ get: () => p[0], set: (v) => { p[0] = v; }, owner: p }, { get: () => p[1], set: (v) => { p[1] = v; }, owner: p });
    if (held.frozen.has(l)) continue;
    if (l.type === 'circle') vars.push({ get: () => +l.r, set: (v) => { l.r = v; }, owner: l });
    else (l.bulge || []).forEach((b, i) => { if (+b) vars.push({ get: () => bulgeOf(l, i), set: (v) => { l.bulge[i] = v; }, owner: `${loops.indexOf(l)}:${i}` }); });
  }
  const n = vars.length;
  if (!n) return { free: 0, locked: () => true };
  const r0 = ruleResiduals(loops, rules), m = r0.length;
  const J = Array.from({ length: m }, () => new Float64Array(n));
  for (let j = 0; j < n; j++) {
    const v0 = vars[j].get(), hs = 1e-6 * Math.max(1, Math.abs(v0));
    vars[j].set(v0 + hs); const r1 = ruleResiduals(loops, rules); vars[j].set(v0);
    for (let i = 0; i < m; i++) J[i][j] = (r1[i] - r0[i]) / hs;
  }
  // row-reduce to find which numbers the rules pin down
  const piv = []; let row = 0;
  for (let c = 0; c < n && row < m; c++) {
    let p = row; for (let r = row + 1; r < m; r++) if (Math.abs(J[r][c]) > Math.abs(J[p][c])) p = r;
    if (Math.abs(J[p][c]) < 1e-6) continue;
    [J[row], J[p]] = [J[p], J[row]];
    const d = J[row][c]; for (let k = c; k < n; k++) J[row][k] /= d;
    for (let r = 0; r < m; r++) { if (r === row) continue; const f = J[r][c]; if (!f) continue; for (let k = c; k < n; k++) J[r][k] -= f * J[row][k]; }
    piv.push(c); row++;
  }
  const isPiv = new Set(piv), freeCols = [...Array(n).keys()].filter((c) => !isPiv.has(c));
  const moving = new Set(); // owners that can still change
  for (const f of freeCols) {
    moving.add(vars[f].owner);
    piv.forEach((c, r) => { if (Math.abs(J[r][f]) > 1e-6) moving.add(vars[c].owner); });
  }
  return { free: freeCols.length, locked: (owner) => !moving.has(owner) };
}
function gauss(A, b) {
  const n = b.length; const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}

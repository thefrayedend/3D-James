// Helpers (Object > Helpers): common jobs done on the parts you already have, each one step in History.
//   fit     the part cut out of an object it passes through, with a printing gap all round (the part stays)
//   split   connectors for a split that keeps both halves: pegs, pins or a dovetail
//   lid     a lid for an open box: friction fit, snap-on or slide-in
//   hinge   two parts side by side joined by a print-in-place pin hinge or a living hinge
//   holes   screw holes on a face: plain, countersunk, counterbored, heat-set insert, nut trap
//   snap    a snap hook standing on a face, or the window it catches in
//   vents   a pattern of holes through a face: honeycomb, round or slots
// Outlines are worked out with Manifold cross-sections (CrossSection) and the pieces are built as solids, so a solid
// stays a solid (it can still be rounded, embossed and saved as STEP). E is the engine's own toolbox (see engine.js).
import * as R from 'replicad';
import { Matrix4, Vector3 } from 'three';

const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };

/** A flat frame: origin o, x across, y = n × x, n out of it (as on a replicad Plane). M: frame -> world. */
function frame(o, n, x) {
  n = unit(n); x = unit(x);
  const y = cross(n, x);
  const M = new Matrix4().makeBasis(new Vector3(...x), new Vector3(...y), new Vector3(...n)).setPosition(...o);
  return { o, n, x, y, M, inv: M.clone().invert() };
}
const place = (E, shape, M) => E.placeSolid(shape, M);
const at = (F, u, v, w = 0) => F.M.clone().multiply(new Matrix4().makeTranslation(u, v, w));

/** The object cut by the plane w = level of frame F, in the frame's u, v (the caller deletes it). */
function section(E, v, key, F, level = 0) {
  const t = E.asMf(v, key).transform(F.inv.elements);
  try { return t.slice(level); } finally { t.delete(); }
}
const polysOf = (cs) => cs.toPolygons().filter((p) => p.length >= 3);
const signedArea = (p) => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;
/** Inside the outlines (holes count as outside). */
function inside(polys, [x, y]) {
  let c = false;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
/** A cross-section as a replicad drawing (its holes cut out), or null when empty. */
function drawingOf(cs) {
  const s = cs.simplify(0.005);
  try {
    const polys = polysOf(s);
    const line = (p) => { let d = R.draw([p[0][0], p[0][1]]); for (const q of p.slice(1)) d = d.lineTo([q[0], q[1]]); return d.close(); };
    let d = null;
    for (const p of polys.filter((q) => signedArea(q) > 0)) d = d ? d.fuse(line(p)) : line(p);
    if (d) for (const p of polys.filter((q) => signedArea(q) < 0)) d = d.cut(line(p));
    return d;
  } finally { s.delete(); }
}
/** A cross-section stood up from w = z0, h tall, in frame M (world when M is left out). */
function prismOf(E, cs, z0, h, M) {
  const d = drawingOf(cs); if (!d) return null;
  const s = d.sketchOnPlane('XY', z0).extrude(h);
  return M ? place(E, s, M) : s;
}
const free = (...cs) => { for (const c of cs) { try { c?.delete(); } catch { /* */ } } };
function freeShape(s) { try { s?.delete(); } catch { /* the kernel owns a shared result */ } }

/** Combine two body values (solid or mesh) and free nothing. */
const bool = (E, op, a, akey, b, bkey) => E.boolV(op, a, akey, b, bkey);
let seq = 0;
const tmpKey = (tag) => `job:${tag}:${++seq}`;
/** a (a body value) with a solid piece added or cut, as a new value. */
function withPiece(E, op, a, akey, piece) {
  if (!piece) return a;
  return bool(E, op, a, akey, { shape: piece }, tmpKey(op));
}

/** How deep a hole at each point (u, v) of frame F must go to come out of the material under it: through the wall. */
function throughDepth(E, v, key, F, pts, maxD) {
  const t = E.asMf(v, key).transform(F.inv.elements);
  try {
    const out = pts.map(() => null); let left = pts.length;
    const step = 0.25;
    for (let k = 1; left && k * step <= maxD && k <= 600; k++) {
      const s = t.slice(-k * step), polys = polysOf(s); s.delete();
      pts.forEach((p, i) => { if (out[i] == null && !inside(polys, p)) { out[i] = k * step + 0.3; left--; } });
    }
    return out.map((d) => d ?? maxD);
  } finally { t.delete(); }
}
const diagOf = (E, v) => { const [mn, mx] = E.bbOf(v); return Math.hypot(...sub(mx, mn)); };

// ---------------------------------------------------------------- fit around
/** The part grown by gap all round (a solid stays a solid; a mesh is stretched about its middle). */
function grow(E, v, gap) {
  if (v.shape) {
    for (const join of ['GeomAbs_Arc', 'GeomAbs_Intersection']) {
      const oc = R.getOC(), mk = new oc.BRepOffsetAPI_MakeOffsetShape(), pr = new oc.Message_ProgressRange();
      try {
        mk.PerformByJoin(v.shape.wrapped, gap, 1e-3, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType[join], false, pr);
        if (!mk.IsDone()) continue;
        let s = R.cast(mk.Shape());
        try { s = R.makeSolid([s]); } catch { /* already a solid */ }
        if (R.measureVolume(s) > R.measureVolume(v.shape)) return { shape: s };
        freeShape(s);
      } catch { /* try the next way */ } finally { pr.delete(); mk.delete(); }
    }
  }
  const [mn, mx] = E.bbOf(v), c = mn.map((a, i) => (a + mx[i]) / 2);
  const k = mn.map((a, i) => (mx[i] - a + 2 * gap) / Math.max(mx[i] - a, 1e-6));
  const M = new Matrix4().makeTranslation(...c).multiply(new Matrix4().makeScale(...k)).multiply(new Matrix4().makeTranslation(...c.map((x) => -x)));
  return E.transformV(v, M);
}
export function fitAround(E, target, tkey, part, pkey, gap) {
  if (!(gap >= 0)) E.fail('The gap cannot be below 0');
  if (gap === 0) return bool(E, 'sub', target, tkey, part, pkey);
  const g = grow(E, part, gap);
  try {
    const r = bool(E, 'sub', target, tkey, g, tmpKey('fit'));
    if (r.shape) { try { return { shape: r.shape.simplify() }; } catch { return r; } }
    return r;
  } finally { E.freeValue(g); }
}

// ---------------------------------------------------------------- split connectors
/** Points spread over a cross-section (each with room around it), as many as fit up to count. */
function spreadPoints(cs, room, count) {
  const ins = cs.offset(-room, 'Round');
  try {
    const polys = polysOf(ins);
    if (!polys.length) return [];
    const b = ins.bounds(), w = b.max[0] - b.min[0], hgt = b.max[1] - b.min[1];
    const step = Math.max(Math.sqrt((w * hgt) / 3000), 0.2);
    const cand = [];
    for (let x = b.min[0] + step / 2; x < b.max[0]; x += step) for (let y = b.min[1] + step / 2; y < b.max[1]; y += step) if (inside(polys, [x, y])) cand.push([x, y]);
    if (!cand.length) return [];
    const cx = cand.reduce((s, p) => s + p[0], 0) / cand.length, cy = cand.reduce((s, p) => s + p[1], 0) / cand.length;
    const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    const pick = [];
    if (count === 1) pick.push(cand.reduce((best, p) => (d2(p, [cx, cy]) < d2(best, [cx, cy]) ? p : best)));
    else pick.push(cand.reduce((best, p) => (d2(p, [cx, cy]) > d2(best, [cx, cy]) ? p : best)));
    while (pick.length < count) {
      let best = null, bd = -1;
      for (const p of cand) { const m = Math.min(...pick.map((q) => d2(p, q))); if (m > bd) { bd = m; best = p; } }
      if (!best || Math.sqrt(bd) < room * 1.6) break; // no room for another
      pick.push(best);
    }
    return pick;
  } finally { ins.delete(); }
}
/** The longest way across a cross-section (for a dovetail), through its middle. */
function longAxis(cs) {
  const polys = polysOf(cs), pts = polys.flat();
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  let xx = 0, xy = 0, yy = 0;
  for (const p of pts) { const a = p[0] - c[0], b = p[1] - c[1]; xx += a * a; xy += a * b; yy += b * b; }
  const ang = 0.5 * Math.atan2(2 * xy, xx - yy);
  return { c, t: [Math.cos(ang), Math.sin(ang)] };
}
/**
 * Connectors for the two halves of a split (parts[0] below the plane, parts[1] above it). n: the plane's normal (from
 * below to above), p: a point on it. Returns { parts, pins } (pins: loose pins to print, or null).
 */
export function splitJoints(E, v, key, parts, n, p, f, num) {
  const kind = f.joint;
  const d = num(f.jd ?? 5), L = num(f.jl ?? 8), gap = num(f.jgap ?? 0.15), count = Math.round(num(f.jn ?? 2));
  if (!(d > 0.5)) E.fail('Connector size must be above 0.5 mm');
  if (!(L > 0.5)) E.fail('Connector length must be above 0.5 mm');
  if (!(gap >= 0 && gap < d / 2)) E.fail('The connector gap must be from 0 to half the connector size');
  if (count < 1 || count > 20) E.fail('Connectors: 1 to 20');
  const F = frame(p, n, E.faceXDir(n));
  const cs = section(E, v, key, F, 0);
  try {
    if (cs.isEmpty()) E.fail('The cut face could not be found for the connectors');
    let [below, above] = parts, pins = null;
    const bk = tmpKey('below'), ak = tmpKey('above');
    if (kind === 'dovetail') {
      const { c, t } = longAxis(cs), q = [-t[1], t[0]];
      const big = diagOf(E, v) * 2 + 10, flare = Math.tan((15 * Math.PI) / 180) * L;
      const rail = (g) => {
        const half = d / 2 + g, top = d / 2 + flare + g;
        const pen = R.draw([-half, -0.3]).lineTo([half, -0.3]).lineTo([top, L + g]).lineTo([-top, L + g]).close();
        const pl = new R.Plane([c[0] - (t[0] * big) / 2, c[1] - (t[1] * big) / 2, 0], [q[0], q[1], 0], [t[0], t[1], 0]);
        return place(E, pen.sketchOnPlane(pl).extrude(big), F.M);
      };
      // the rail belongs to the lower half and only runs where the cut face has material (trimmed to the outline)
      const r0 = rail(0), face = prismOf(E, cs, -0.3, L + 0.3, F.M);
      let kept = null;
      try {
        const inBody = bool(E, 'int', { shape: r0 }, tmpKey('rail'), v, key);
        const onFace = face ? bool(E, 'int', inBody, tmpKey('railb'), { shape: face }, tmpKey('face')) : inBody;
        if (onFace !== inBody) E.freeValue(inBody);
        kept = onFace;
        below = bool(E, 'add', below, bk, kept, tmpKey('railk'));
      } finally { freeShape(r0); freeShape(face); if (kept) E.freeValue(kept); }
      const r1 = rail(gap);
      try { above = withPiece(E, 'sub', above, ak, r1); } finally { freeShape(r1); }
    } else {
      const r = d / 2, wall = Math.max(1.2, d * 0.4);
      const pts = spreadPoints(cs, r + gap + wall, count);
      if (!pts.length) E.fail('The cut face is too small for connectors this size. Make them smaller.');
      const cyl = (u, w, rad, h) => place(E, R.makeCylinder(rad, h, [0, 0, 0], [0, 0, 1]), at(F, u, w[0], w[1]));
      for (const [u, w] of pts) {
        if (kind === 'pegs') {
          // a peg on the lower half, a hole for it in the upper half
          const peg = cyl(u, [w, -0.3], r, L + 0.3), hole = cyl(u, [w, -0.05], r + gap, L + gap + 0.4 + 0.05);
          try { below = withPiece(E, 'add', below, bk, peg); above = withPiece(E, 'sub', above, ak, hole); } finally { freeShape(peg); freeShape(hole); }
        } else {
          // a hole in each half; the pins are printed on their own
          const lo = cyl(u, [w, -(L / 2 + gap + 0.4)], r + gap, L / 2 + gap + 0.45), hi = cyl(u, [w, -0.05], r + gap, L / 2 + gap + 0.45);
          try { below = withPiece(E, 'sub', below, bk, lo); above = withPiece(E, 'sub', above, ak, hi); } finally { freeShape(lo); freeShape(hi); }
        }
      }
      if (kind === 'pins') {
        // loose pins standing beside the object, a little shorter than the two holes, with a chamfer to start them
        const [mn, mx] = E.bbOf(v), x0 = mx[0] + 5 + r;
        let all = null;
        pts.forEach((_, i) => {
          const len = L - 0.2, ch = Math.min(0.4, r / 3);
          const pin = R.draw([0, 0]).lineTo([r - ch, 0]).lineTo([r, ch]).lineTo([r, len - ch]).lineTo([r - ch, len]).lineTo([0, len]).close().sketchOnPlane('XZ').revolve([0, 0, 1])
            .translate([x0 + i * (d + 3), (mn[1] + mx[1]) / 2, mn[2]]);
          all = all ? all.fuse(pin) : pin;
        });
        pins = { shape: all };
      }
    }
    return { parts: [below, above], pins };
  } finally { cs.delete(); }
}

// ---------------------------------------------------------------- lid
/**
 * A lid for an open box (v), printed upside down beside it: plate on the floor, lip up. style: friction (a lip that
 * fits inside the opening), snap (the lip has a bead that clicks into a groove cut inside the box) or slide (a plate
 * that slides into grooves cut in the walls from the front). Returns { parts: [lid, box or null when unchanged] }.
 */
export function makeLid(E, v, key, f, num) {
  const style = f.style || 'friction';
  const t = num(f.t ?? 2), lip = num(f.lip ?? 4), wall = num(f.wall ?? 1.2), gap = num(f.gap ?? 0.15), slot = num(f.slot ?? 1);
  if (!(t > 0.2)) E.fail('Lid thickness must be above 0.2 mm');
  if (!(gap >= 0 && gap < 2)) E.fail('The gap must be from 0 to 2 mm');
  const [mn, mx] = E.bbOf(v), top = mx[2], hgt = mx[2] - mn[2];
  const W = frame([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const sec = section(E, v, key, W, top - Math.min(0.3, hgt / 10));
  const keep = [sec];
  const mk = (cs) => { keep.push(cs); return cs; };
  try {
    const polys = polysOf(sec);
    const filled = mk(new (E.MF().CrossSection)(polys.filter((p) => signedArea(p) > 0), 'Positive'));
    const opening = mk(filled.subtract(sec));
    if (opening.area() < 1) E.fail('This object has no opening at the top. Hollow it out first with the top face left open (Faces > Hollow), then make the lid.');
    const lid = [], boxCuts = [];
    if (style === 'slide') {
      if (!(slot > 0.2)) E.fail('The groove depth must be above 0.2 mm');
      const front = mn[1] - 10 - (mx[1] - mn[1]);
      const sweep = (cs) => mk(E.MF().CrossSection.hull([cs, mk(cs.translate([0, front - mn[1]]))]));
      const groove = sweep(mk(opening.offset(slot, 'Miter')));
      const room = mk(groove.subtract(mk(filled.offset(-0.6, 'Miter'))));
      // the groove must stay inside the walls except at the front, where the lid goes in
      const outside = mk(room.intersect(mk(MFrect(E, mn[0] - 50, mn[1] + 0.8, mx[0] + 50, mx[1] + 50))));
      if (outside.area() > 0.5) E.fail(`The walls are too thin for a sliding lid: they need about ${(slot + 0.8).toFixed(1)} mm. Use a push-on or snap lid, or thicker walls.`);
      const rim = Math.max(0.8, num(f.rim ?? 1));
      boxCuts.push(prismOf(E, groove, top - rim - t - 2 * gap, t + 2 * gap));
      lid.push(prismOf(E, mk(mk(sweep(mk(opening.offset(slot - gap, 'Miter')))).intersect(filled)), 0, t));
    } else {
      if (!(lip > 0.5)) E.fail('Lip depth must be above 0.5 mm');
      if (!(wall > 0.4)) E.fail('Lip wall must be above 0.4 mm');
      if (lip >= hgt - 0.5) E.fail('The lip is deeper than the box');
      // printed upside down, so drawn as the mirror image: turned over, it matches the box (any way round you flip it)
      const fm = mk(filled.mirror([0, 1])), om = mk(opening.mirror([0, 1]));
      lid.push(prismOf(E, fm, 0, t));
      const ring = mk(mk(om.offset(-gap, 'Miter')).subtract(mk(om.offset(-gap - wall, 'Miter'))));
      if (ring.area() < 0.5) E.fail('The opening is too small for a lip. Make the lip wall or the gap smaller.');
      lid.push(prismOf(E, ring, t - 0.01, lip + 0.01));
      if (style === 'snap') {
        if (lip < 2.5) E.fail('A snap lid needs a lip at least 2.5 mm deep');
        const bead = Math.max(0.2, num(f.bead ?? 0.5));
        const beadRing = mk(mk(om.offset(-gap + bead, 'Round')).subtract(mk(om.offset(-gap - 0.3, 'Miter'))));
        lid.push(prismOf(E, beadRing, t + lip - 1.6, 1));
        const groove = mk(mk(opening.offset(bead + 0.15, 'Round')).subtract(mk(opening.offset(-0.05, 'Miter'))));
        boxCuts.push(prismOf(E, groove, top - (lip - 0.4), 1.4));
      }
    }
    let shape = null;
    for (const s of lid.filter(Boolean)) shape = shape ? shape.fuse(s) : s;
    if (!shape) E.fail('The lid could not be made');
    const dx = num(f.dx ?? (mx[0] - mn[0] + 10)), dy = num(f.dy ?? 0) + (style === 'slide' ? 0 : mn[1] + mx[1]); // (the mirror image sits across y = 0)
    const lidV = { shape: shape.translate([dx, dy, mn[2]]) };
    let box = null;
    for (const c of boxCuts.filter(Boolean)) { const nb = withPiece(E, 'sub', box || v, box ? tmpKey('box') : key, c); if (box) E.freeValue(box); box = nb; freeShape(c); }
    return { parts: [lidV, box] };
  } finally { free(...keep); }
}
function MFrect(E, x0, y0, x1, y1) { return E.MF().CrossSection.square([x1 - x0, y1 - y0]).translate([x0, y0]); }

// ---------------------------------------------------------------- hinge
/**
 * Join two parts that sit side by side (edges facing each other, a few mm apart) with a hinge along their bottom edge.
 * style pin: print-in-place knuckles that alternate between the parts, with a pin through them (the parts stay separate).
 * style living: a thin strip across the gap that bends (the parts become one object). Returns { parts: [a, b or null] }.
 */
export function makeHinge(E, a, akey, b, bkey, f, num) {
  const A = E.bbOf(a), B = E.bbOf(b);
  let best = null;
  for (const ax of [0, 1]) {
    const o = 1 - ax;
    const sep = Math.max(B[0][ax] - A[1][ax], A[0][ax] - B[1][ax]);
    const ov = Math.min(A[1][o], B[1][o]) - Math.max(A[0][o], B[0][o]);
    if (ov > 4 && sep > -0.01 && (!best || sep > best.sep)) best = { ax, o, sep, ov };
  }
  if (!best) E.fail('Put the two parts side by side, edges facing each other and not overlapping (a few mm apart), then add the hinge.');
  const { ax, o } = best;
  const aFirst = A[1][ax] <= B[0][ax] + 0.01;
  const [P, PB, Q, QB] = aFirst ? [a, A, b, B] : [b, B, a, A]; // P: the part on the low side
  const pKey = aFirst ? akey : bkey, qKey = aFirst ? bkey : akey;
  const faceP = PB[1][ax], faceQ = QB[0][ax], c0 = (faceP + faceQ) / 2;
  const zb = Math.max(PB[0][2], QB[0][2]);
  const m = num(f.margin ?? 1);
  const s0 = Math.max(PB[0][o], QB[0][o]) + m, s1 = Math.min(PB[1][o], QB[1][o]) - m, len = s1 - s0;
  if (len < 4) E.fail('The parts face each other along too short an edge for a hinge');
  const pt = (av, sv, z) => { const r = [0, 0, z]; r[ax] = av; r[o] = sv; return r; };
  const box = (a0, a1, t0, t1, z0, z1) => R.makeBox(pt(Math.min(a0, a1), t0, z0), pt(Math.max(a0, a1), t1, z1));
  const dirO = o === 0 ? [1, 0, 0] : [0, 1, 0];
  const pieces = [];
  const keepPiece = (s) => { pieces.push(s); return s; };
  try {
    if (f.style === 'living') {
      const t = num(f.t ?? 0.6);
      if (!(t >= 0.2 && t <= 3)) E.fail('Strip thickness: 0.2 to 3 mm');
      if (best.sep < 1) E.fail('Move the parts a little apart first: the gap between them is what bends (2 to 4 mm works well).');
      const strip = keepPiece(box(faceP - 3, faceQ + 3, s0, s1, zb, zb + t));
      const p1 = withPiece(E, 'add', P, pKey, strip);
      const joined = bool(E, 'add', p1, tmpKey('lh'), Q, qKey);
      if (p1 !== P) E.freeValue(p1);
      return { parts: [joined, null] };
    }
    const d = num(f.d ?? 6), R0 = d / 2, c = num(f.clear ?? 0.3), kg = num(f.kgap ?? 0.4);
    const pin = num(f.pin ?? 0) > 0 ? num(f.pin) : Math.max(1.2, d * 0.4);
    if (!(d >= 2)) E.fail('Knuckle size must be at least 2 mm');
    if (pin >= d - 1) E.fail('The pin is too thick for the knuckles');
    let n = Math.round(num(f.n ?? 0));
    if (!n) n = Math.max(3, Math.min(15, Math.round(len / (d * 2.2)) | 1));
    if (n < 3 || n > 15 || n % 2 === 0) E.fail('Knuckles: an odd number from 3 to 15 (0 picks one for you)');
    const kl = (len - (n - 1) * kg) / n;
    if (kl < 2) E.fail('The hinge is too short for that many knuckles');
    const zc = zb + R0;
    const cyl = (rad, from, l) => keepPiece(R.makeCylinder(rad, l, pt(c0, from, zc), dirO));
    let p = P, q = Q;
    const pk = tmpKey('hp'), qk = tmpKey('hq');
    const swap = (old, nv, base) => { if (old !== base) E.freeValue(old); return nv; };
    // room around the other part's knuckles first, then each part's own knuckles and the webs joining them to it
    for (let i = 0; i < n; i++) {
      const si = s0 + i * (kl + kg), mine = i % 2 === 0;
      const room = cyl(R0 + c, si - kg / 2, kl + kg);
      if (mine) q = swap(q, withPiece(E, 'sub', q, q === Q ? qKey : qk, room), Q);
      else p = swap(p, withPiece(E, 'sub', p, p === P ? pKey : pk, room), P);
    }
    for (let i = 0; i < n; i++) {
      const si = s0 + i * (kl + kg), mine = i % 2 === 0;
      const k = keepPiece(cyl(R0, si, kl).fuse(mine ? box(faceP - 0.5, c0, si, si + kl, zb, zc) : box(c0, faceQ + 0.5, si, si + kl, zb, zc)));
      if (mine) p = swap(p, withPiece(E, 'add', p, p === P ? pKey : pk, k), P);
      else q = swap(q, withPiece(E, 'add', q, q === Q ? qKey : qk, k), Q);
    }
    p = swap(p, withPiece(E, 'add', p, pk, cyl(pin / 2, s0, len)), P);
    q = swap(q, withPiece(E, 'sub', q, qk, cyl(pin / 2 + c, s0 - 1, len + 2)), Q);
    return { parts: aFirst ? [p, q] : [q, p] };
  } finally { for (const s of pieces) freeShape(s); }
}

// ---------------------------------------------------------------- pieces on a face
/** The face a step was put on, and its frame (u across, v up the face, w out of it). */
function faceFrame(E, shape, v, ref, what) {
  const [hit] = E.matchRefs(E.faceInfo(shape), [ref], E.bbOf(v), 'n', 'faces');
  if (hit.f.geomType !== 'PLANE') E.fail(`${what} needs a flat face. Delete this step and pick a flat face.`);
  return frame(hit.c, hit.n, E.faceXDir(hit.n));
}

/** Screw holes: the cutter for one hole, along -w from the face, depth D (the hole itself; heads open at the face). */
function holeCutter(E, f, num, D) {
  const kind = f.kind || 'plain', r = num(f.d ?? 3.4) / 2;
  if (!(r > 0.1)) E.fail('Hole diameter must be above 0.2 mm');
  const spin = (pts) => { let d = R.draw(pts[0]); for (const q of pts.slice(1)) d = d.lineTo(q); return d.close().sketchOnPlane('XZ').revolve([0, 0, 1]); };
  if (kind === 'countersunk') {
    const rh = num(f.hd ?? 6.72) / 2; if (rh <= r) E.fail('The countersink must be wider than the hole');
    return spin([[0, 0.05], [rh, 0.05], [rh, 0], [r, -(rh - r)], [r, -Math.max(D, rh - r + 0.2)], [0, -Math.max(D, rh - r + 0.2)]]);
  }
  if (kind === 'counterbore') {
    const rc = num(f.cb ?? 6.5) / 2, k = num(f.hk ?? 3.3); if (rc <= r) E.fail('The counterbore must be wider than the hole');
    if (!(k > 0)) E.fail('Counterbore depth must be above 0');
    return spin([[0, 0.05], [rc, 0.05], [rc, -k], [r, -k], [r, -Math.max(D, k + 0.2)], [0, -Math.max(D, k + 0.2)]]);
  }
  if (kind === 'insert') {
    const depth = num(f.idepth ?? 6); if (!(depth > 0)) E.fail('Insert depth must be above 0');
    return spin([[0, 0.05], [r, 0.05], [r, -depth], [0, -depth]]);
  }
  if (kind === 'nut') {
    const af = num(f.af ?? 5.7), m = num(f.m ?? 2.6); if (af / 2 <= r) E.fail('The nut must be wider than the hole');
    const hex = R.drawPolysides(af / 2 / Math.cos(Math.PI / 6), 6).sketchOnPlane('XY', -m).extrude(m + 0.05);
    return hex.fuse(spin([[0, 0.05], [r, 0.05], [r, -Math.max(D, m + 0.2)], [0, -Math.max(D, m + 0.2)]]));
  }
  return spin([[0, 0.05], [r, 0.05], [r, -D], [0, -D]]);
}
export function cutHoles(E, v, key, f, num) {
  const shape = E.needSolid(v, 'Screw holes');
  const F = faceFrame(E, shape, v, f.face, 'Screw holes');
  const pts = (f.pts || []).map((q) => [num(q[0]), num(q[1])]);
  if (!pts.length) E.fail('Click on the face where the holes go');
  if (pts.length > 100) E.fail('Use 100 holes or fewer in one step');
  const depth = num(f.depth ?? 0);
  if (depth < 0) E.fail('Depth cannot be below 0 (0 goes through)');
  const depths = depth > 0 ? pts.map(() => depth) : throughDepth(E, v, key, F, pts, diagOf(E, v) + 1);
  let out = shape;
  for (let i = 0; i < pts.length; i++) {
    const c = place(E, holeCutter(E, f, num, depths[i]), at(F, pts[i][0], pts[i][1]));
    try { const nx = out.cut(c); if (out !== shape) freeShape(out); out = nx; } finally { freeShape(c); }
  }
  return { shape: out === shape ? shape.clone() : out };
}

/** A snap hook standing out of a face (mode hook), or the window it clicks into (mode window). */
export function snapPiece(E, v, key, f, num) {
  const shape = E.needSolid(v, 'Snap clip');
  const F = faceFrame(E, shape, v, f.face, 'A snap clip');
  const w = num(f.w ?? 6), len = num(f.len ?? 8), t = num(f.t ?? 1.6), barb = num(f.barb ?? 0.8), gap = num(f.gap ?? 0.2);
  if (!(w > 1 && len > 2 && t > 0.4 && barb > 0.1)) E.fail('Width above 1, length above 2, thickness above 0.4 and catch above 0.1 mm');
  if (barb >= len / 2) E.fail('The catch is too big for the hook');
  const M = at(F, num(f.u ?? 0), num(f.v ?? 0)).multiply(new Matrix4().makeRotationZ((num(f.angle ?? 0) * Math.PI) / 180));
  if (f.mode === 'window') {
    const depth = num(f.depth ?? 0);
    const D = depth > 0 ? depth : throughDepth(E, v, key, F, [[num(f.u ?? 0), num(f.v ?? 0)]], diagOf(E, v) + 1)[0];
    const win = place(E, R.makeBox([-(w / 2 + gap), -(t / 2 + gap), -D], [w / 2 + gap, t / 2 + barb + gap, 0.05]), M);
    try { return { shape: shape.clone().cut(win) }; } finally { freeShape(win); }
  }
  // the beam, with a ramp at the tip and a flat catch facing back toward the face
  const bl = Math.max(barb * 2.5, 1);
  const beam = R.makeBox([-w / 2, -t / 2, -0.3], [w / 2, t / 2, len]);
  const tri = R.draw([t / 2 - 0.05, len - bl]).lineTo([t / 2 + barb, len - bl]).lineTo([t / 2 - 0.05, len]).close()
    .sketchOnPlane(new R.Plane([-w / 2, 0, 0], [0, 1, 0], [1, 0, 0])).extrude(w);
  const hook = place(E, beam.fuse(tri), M);
  freeShape(beam); freeShape(tri);
  try { return { shape: shape.clone().fuse(hook) }; } finally { freeShape(hook); }
}

/** Vents: a pattern of holes over a face (inside a margin), cut through the wall under it. */
export function cutVents(E, v, key, f, num) {
  const shape = E.needSolid(v, 'Vents');
  const F = faceFrame(E, shape, v, f.face, 'Vents');
  const s = num(f.s ?? 5), bar = num(f.bar ?? 1.6), margin = num(f.margin ?? 3), pattern = f.pattern || 'hex';
  if (!(s >= 0.8)) E.fail('Hole size must be at least 0.8 mm');
  if (!(bar >= 0.4)) E.fail('The bars between holes must be at least 0.4 mm');
  if (!(margin >= 0)) E.fail('The margin cannot be below 0');
  const lo = section(E, v, key, F, -0.05), hi = section(E, v, key, F, 0.05);
  const keep = [lo, hi];
  const mk = (cs) => { keep.push(cs); return cs; };
  try {
    const area = mk(mk(lo.subtract(hi)).offset(-margin, 'Miter'));
    const polys = polysOf(area);
    if (!polys.length) E.fail('The face is too small for vents with this margin');
    const b = area.bounds();
    const holes = []; // [cs of one hole, centre]
    const fits = (pts) => pts.every((p) => inside(polys, p));
    if (pattern === 'slots') {
      const along = f.dir === 'up' ? 1 : 0, pitch = s + bar;
      const [a0, a1] = along === 0 ? [b.min[1], b.max[1]] : [b.min[0], b.max[0]];
      const n = Math.floor((a1 - a0 + bar) / pitch);
      const start = (a0 + a1) / 2 - ((n - 1) * pitch) / 2;
      for (let i = 0; i < n; i++) {
        const y = start + i * pitch;
        const strip = mk(along === 0 ? MFrect(E, b.min[0] - 1, y - s / 2, b.max[0] + 1, y + s / 2) : MFrect(E, y - s / 2, b.min[1] - 1, y + s / 2, b.max[1] + 1));
        const cut = mk(area.intersect(strip));
        for (const piece of cut.decompose()) {
          keep.push(piece);
          const rounded = mk(mk(piece.offset(-s * 0.49, 'Round')).offset(s * 0.49, 'Round'));
          if (rounded.area() > s * s * 0.5) holes.push(rounded);
        }
      }
    } else {
      const hex = pattern === 'hex';
      const rad = hex ? s / Math.sqrt(3) : s / 2; // a hexagon s across its flats; a circle s wide
      const px = s + bar, py = hex ? px * Math.sqrt(3) / 2 : px;
      const nx = Math.floor((b.max[0] - b.min[0]) / px) + 2, ny = Math.floor((b.max[1] - b.min[1]) / py) + 2;
      if (nx * ny > 20000) E.fail('That is far too many holes. Make them bigger.');
      const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
      const ring = hex ? 6 : 12;
      for (let j = -Math.ceil(ny / 2); j <= Math.ceil(ny / 2); j++) {
        for (let i = -Math.ceil(nx / 2); i <= Math.ceil(nx / 2); i++) {
          const x = cx + i * px + (hex && j % 2 ? px / 2 : 0), y = cy + j * py;
          const around = Array.from({ length: ring }, (_, k) => { const a = (Math.PI * 2 * k) / ring + (hex ? Math.PI / 6 : 0); return [x + rad * Math.cos(a), y + rad * Math.sin(a)]; });
          if (fits(around)) holes.push({ c: [x, y], pts: around });
        }
      }
    }
    if (!holes.length) E.fail('No holes fit on this face. Make them smaller or the margin narrower.');
    if (holes.length > 1500) E.fail(`That makes ${holes.length} holes, too many to cut. Make them bigger.`);
    const centre = holes[0].c || (() => { const bb = holes[0].bounds(); return [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2]; })();
    const depth = num(f.depth ?? 0);
    if (depth < 0) E.fail('Depth cannot be below 0 (0 goes through the wall)');
    const D = depth > 0 ? depth : throughDepth(E, v, key, F, [centre], diagOf(E, v) + 1)[0];
    const prisms = holes.map((hl) => {
      let d;
      if (!hl.c) d = drawingOf(hl);
      else if (pattern === 'round') d = R.drawCircle(s / 2).translate(hl.c[0], hl.c[1]);
      else { d = R.draw(hl.pts[0]); for (const q of hl.pts.slice(1)) d = d.lineTo(q); d = d.close(); }
      return d.sketchOnPlane('XY', 0.05).extrude(-(D + 0.05));
    });
    const tool = place(E, prisms.length === 1 ? prisms[0] : R.makeCompound(prisms), F.M);
    try { return { shape: shape.clone().cut(tool) }; } finally { freeShape(tool); for (const p of prisms) freeShape(p); }
  } finally { free(...keep); }
}

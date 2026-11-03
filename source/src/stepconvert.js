// STEP to sketches, from the part's own exact edges. A part from a STEP file made of flat faces and straight round
// walls (holes, rounded corners, slots) along one direction is rebuilt as sketches: at each level where its outline
// changes, a paper-thin slice of the part gives the outline as the STEP's true lines, arcs and circles, and that
// outline becomes a sketch pushed up to the next level. The levels are merged into one object, and the result is
// checked against the part's volume. Anything else (rounded top edges, cones, free-form surfaces) goes to the mesh
// converter (stlconvert.js), and when that cannot rebuild it either, the part stays the exact STEP solid.
import * as R from 'replicad';
import * as SG from './sketchgeom.js';
import { sketchFeature, emitter, AXIS_FRAMES, compareResult, toLocalMat } from './stlconvert.js';
import { fuzzyBool } from './engine.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const col = (M, j) => [M[0][j], M[1][j], M[2][j]];
const r6 = (x) => Math.round(x * 1e6) / 1e6;
const mm = (x) => `${+x.toFixed(2)} mm`;
const WORD = { z: 'up', y: 'back', x: 'sideways' };
const sameCircle = (a, b) => a.type === 'circle' && b.type === 'circle' && Math.abs(a.r - b.r) < 1e-4 && Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) < 1e-4;
/** Is this circle a hole: inside an odd number of the other outlines? */
function isHole(c, loops) {
  let n = 0;
  for (const l of loops) {
    if (l === c) continue;
    const P = l.type === 'circle' ? null : SG.flattenLoop(l);
    const inside = P ? insidePoly(P, c.c) : Math.hypot(c.c[0] - l.c[0], c.c[1] - l.c[1]) < l.r;
    if (inside) n++;
  }
  return n % 2 === 1;
}
function insidePoly(P, [x, y]) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i], [xj, yj] = P[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Each face's kind: a plane and its direction, a cylinder and its axis, or something else. */
function faceKinds(shape) {
  return shape.faces.map((f) => {
    const t = f.geomType;
    if (t === 'PLANE') return { t, n: f.normalAt().toTuple(), c: f.center.toTuple() };
    if (t === 'CYLINDRE') { // (replicad's name for a cylinder)
      const oc = R.getOC(), ad = new oc.BRepAdaptor_Surface(f.wrapped, false), cy = ad.Cylinder(), ax = cy.Axis(), d = ax.Direction();
      const a = [d.X(), d.Y(), d.Z()];
      d.delete(); ax.delete(); cy.delete(); ad.delete();
      return { t: 'CYLINDER', a };
    }
    return { t };
  });
}

/** Can the part be drawn as outlines pushed along Z (flat faces across or along Z, round walls along Z only)? */
function prismatic(kinds, Z) {
  return kinds.every((k) => (k.t === 'PLANE' ? Math.abs(dot(k.n, Z)) > 1 - 1e-6 || Math.abs(dot(k.n, Z)) < 1e-6
    : k.t === 'CYLINDER' ? Math.abs(dot(k.a, Z)) > 1 - 1e-6 : false));
}

/** The middle and radius of the circle through three points, or null when they are (nearly) in a line. */
function circum(A, B, C) {
  const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
  if (Math.abs(d) < 1e-12) return null;
  const s = (P) => P[0] * P[0] + P[1] * P[1];
  const c = [(s(A) * (B[1] - C[1]) + s(B) * (C[1] - A[1]) + s(C) * (A[1] - B[1])) / d, (s(A) * (C[0] - B[0]) + s(B) * (A[0] - C[0]) + s(C) * (B[0] - A[0])) / d];
  return [c[0], c[1], Math.hypot(A[0] - c[0], A[1] - c[1])];
}
/** How a loop goes along one edge from s to t ([{ p: point, b: bulge }], each a line or arc starting at p): a line,
 * an arc, or for any other curve (a slice through a rounded part can come out as a spline) the arc it is when it is
 * one to a thousandth of a mm, else short straight lines along it. */
function edgeSteps(e, to2, s, t, rev) {
  if (e.geomType === 'LINE') return [{ p: s, b: 0 }];
  const at = (u) => to2(e.pointAt(rev ? 1 - u : u));
  if (e.geomType === 'CIRCLE') return [{ p: s, b: SG.bulgeFrom3(s, at(0.5), t) }];
  const N = 16, P = Array.from({ length: N + 1 }, (_, k) => (k === 0 ? s : k === N ? t : at(k / N)));
  const L = Math.hypot(t[0] - s[0], t[1] - s[1]);
  if (L > 1e-9 && P.every((p) => Math.abs((t[0] - s[0]) * (p[1] - s[1]) - (t[1] - s[1]) * (p[0] - s[0])) / L < 1e-4)) return [{ p: s, b: 0 }];
  const c = circum(s, P[N / 2], t);
  if (c && P.every((p) => Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - c[2]) < 1e-3)) return [{ p: s, b: SG.bulgeFrom3(s, P[N / 2], t) }];
  return P.slice(0, N).map((p) => ({ p, b: 0 }));
}

/** A wire's edges in order round the loop, as 2D points and bulges (true arcs), or null if they do not join up. */
function wireLoop(wire, to2) {
  const edges = wire.edges;
  if (edges.length === 1) {
    // a whole circle (or a closed curve that is one): its middle from points on it
    const e = edges[0], Q = Array.from({ length: 12 }, (_, k) => to2(e.pointAt(k / 12)));
    const c = circum(Q[0], Q[4], Q[8]);
    if (c && Q.every((q) => Math.abs(Math.hypot(q[0] - c[0], q[1] - c[1]) - c[2]) < 1e-3)) return { type: 'circle', c: [c[0], c[1]].map(r6), r: r6(c[2]) };
    if (e.geomType === 'CIRCLE') return null;
    const P = Array.from({ length: 48 }, (_, k) => to2(e.pointAt(k / 48)).map(r6));
    return { type: 'poly', pts: P };
  }
  const segs = edges.map((e) => ({ e, s: to2(e.startPoint), t: to2(e.endPoint), rev: false }));
  const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 2e-4; // (curves cut from faceted faces meet a hair apart)
  const order = [segs.shift()];
  while (segs.length) {
    const at = order[order.length - 1].t;
    const i = segs.findIndex((g) => same(g.s, at) || same(g.t, at)); if (i < 0) return null;
    const g = segs.splice(i, 1)[0];
    order.push(same(g.s, at) ? g : { e: g.e, s: g.t, t: g.s, rev: true });
  }
  if (!same(order[order.length - 1].t, order[0].s)) return null;
  const pts = [], bulge = [];
  for (const g of order) {
    if (same(g.s, g.t) && g.e.geomType === 'LINE') continue;
    for (const st of edgeSteps(g.e, to2, g.s, g.t, g.rev)) { pts.push(st.p.map(r6)); bulge.push(r6(st.b)); }
  }
  if (pts.length < 2) return null;
  return bulge.some((b) => b) ? { type: 'poly', pts, bulge } : { type: 'poly', pts };
}

/** The part's outline at height z along Z (a thin slice of it), as loops in the frame's X, Y: [] where there is
 * nothing (a gap between two pieces), null when it has curves a sketch cannot hold. */
function outlineAt(shape, Rm, z, bb) {
  const X = col(Rm, 0), Y = col(Rm, 1), Z = col(Rm, 2), e = 1e-3;
  const lo = [0, 1, 2].map((i) => bb[0][i] - 1), hi = [0, 1, 2].map((i) => bb[1][i] + 1);
  const ax = Z.findIndex((v) => Math.abs(v) > 0.5);
  lo[ax] = z * Z[ax] - e; hi[ax] = z * Z[ax] + e; // (Z is along an axis, either way round)
  if (lo[ax] > hi[ax]) [lo[ax], hi[ax]] = [hi[ax], lo[ax]];
  const slab = R.makeBox(lo, hi);
  let cut;
  try { cut = shape.clone().intersect(slab); } catch { return null; } finally { try { slab.delete(); } catch { /* */ } }
  try {
    const to2 = (p) => { const w = p.toTuple ? p.toTuple() : p; return [dot(w, X), dot(w, Y)]; };
    const loops = [];
    for (const f of cut.faces) {
      if (f.geomType !== 'PLANE' || dot(f.normalAt().toTuple(), Z) < 1 - 1e-6) continue;
      // (replicad frees a face when asked for its outer or inner wires: ask copies)
      for (const w of [f.clone().outerWire(), ...f.clone().innerWires()]) { const l = wireLoop(w, to2); if (!l) return null; loops.push(l); }
    }
    return loops;
  } finally { try { cut.delete(); } catch { /* */ } }
}

const key = (loops) => JSON.stringify(loops.map((l) => (l.type === 'circle' ? ['c', ...l.c, l.r] : ['p', ...l.pts.flat(), ...(l.bulge || [])]).map((x) => Math.round(x * 1e4))).sort());

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const UNIT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** x with rows . x = y (3 x 3), or null when the rows are (nearly) dependent. */
function solve3(M, y) {
  const det = dot(M[0], cross3(M[1], M[2]));
  if (Math.abs(det) < 1e-9) return null;
  const c0 = cross3(M[1], M[2]), c1 = cross3(M[2], M[0]), c2 = cross3(M[0], M[1]);
  return [0, 1, 2].map((i) => (c0[i] * y[0] + c1[i] * y[1] + c2[i] * y[2]) / det);
}
const boundsOf = (s) => { const b = s.boundingBox; const r = [b.bounds[0], b.bounds[1]]; b.delete?.(); return r; };
const vol = (s) => { try { return R.measureVolume(s); } catch { return Infinity; } };
const free = (...s) => { for (const x of s) { try { x?.delete(); } catch { /* */ } } };
/** The separate solids in a boolean's result. */
function solidsOf(s) {
  const oc = R.getOC(), out = [];
  const ex = new oc.TopExp_Explorer(s.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) out.push(R.cast(ex.Current()));
  ex.delete();
  return out;
}
/**
 * Heights, sorted, those less than 2e-5 apart as one, each kept to 1e-6 (rounder would leave a skin between a face
 * drawn there and the part's own, a few millionths of a mm thick, that joins pieces of what is left over).
 */
const levelSet = (zs) => {
  const out = [];
  for (const z of [...zs].sort((a, b) => a - b)) if (!out.length || z - out[out.length - 1] > 2e-5) out.push(r6(z));
  return out;
};
/** The flat faces across Z (as heights along Z). */
const levelsOf = (kinds, Z, skip = () => false) => levelSet(kinds.filter((k) => k.t === 'PLANE' && Math.abs(dot(k.n, Z)) > 0.5 && !skip(k)).map((k) => dot(k.c, Z)));

/**
 * How a shape is drawn as outlines pushed along one axis: each run of levels with the same outline, and the holes
 * through two or more of them, or null. outline(z0, z1) gives the outline between two levels.
 */
function prismPlan(lv, outline, axis) {
  const groups = [];
  for (let i = 0; i + 1 < lv.length; i++) {
    const loops = outline(lv[i], lv[i + 1]);
    if (loops === null) return null;
    if (!loops.length) continue; // a gap between two pieces of the part
    const k = key(loops), last = groups[groups.length - 1];
    if (last && last.k === k && Math.abs(last.z1 - lv[i]) < 1e-9) last.z1 = lv[i + 1];
    else groups.push({ k, loops, z0: lv[i], z1: lv[i + 1] });
  }
  if (!groups.length || groups.length > 40) return null;
  // holes through two or more levels (the same circle, inside the outline, in each) become one cutting sketch
  const holes = [];
  for (let i = 0; i < groups.length; i++) {
    for (const c of groups[i].loops.filter((l) => l.type === 'circle' && isHole(l, groups[i].loops))) {
      let j = i + 1;
      while (j < groups.length && groups[j].z0 === groups[j - 1].z1 && groups[j].loops.some((l) => sameCircle(l, c) && isHole(l, groups[j].loops))) j++;
      if (j - i < 2) continue;
      for (let k = i; k < j; k++) groups[k].loops = groups[k].loops.filter((l) => !sameCircle(l, c));
      holes.push({ c, z0: groups[i].z0, z1: groups[j - 1].z1 });
    }
  }
  return { kind: 'prism', axis, groups, holes };
}

/** Write a prism plan as steps (levels joined, holes cut). Returns the object that holds it. */
function emitPrism(E, plan, name, color, hole = false) {
  const { axis } = plan, Rm = AXIS_FRAMES[axis], Z = col(Rm, 2), ids = [];
  plan.groups.forEach((g, i) => {
    const b = E.body(i ? `${name} level ${i + 1}` : name, color, hole);
    const O = [Z[0] * g.z0, Z[1] * g.z0, Z[2] * g.z0];
    sketchFeature(E, b, g.loops, g.z1 - g.z0, Rm, O, i ? `${name}: level ${i + 1} at ${mm(g.z0 - plan.groups[0].z0)}, pushed ${WORD[axis]} ${mm(g.z1 - g.z0)}` : `${name}: outline pushed ${WORD[axis]} ${mm(g.z1 - g.z0)}`, 'extrude');
    ids.push(b);
  });
  if (ids.length > 1) E.push({ type: 'combine', op: 'union', name: `${name}: join the levels`, body: ids[0], tools: ids.slice(1) });
  // the holes, grouped by where they run, cut out together
  const runs = new Map();
  for (const h of plan.holes) { const k = `${h.z0},${h.z1}`; if (!runs.has(k)) runs.set(k, []); runs.get(k).push(h); }
  const cutters = [];
  for (const list of runs.values()) {
    const { z0, z1 } = list[0], b = E.body(`${name} ${list.length === 1 ? 'hole' : `${list.length} holes`}`, '#8b96a3', true);
    const O = [Z[0] * z0, Z[1] * z0, Z[2] * z0];
    sketchFeature(E, b, list.map((h) => h.c), z1 - z0, Rm, O, list.length === 1 ? `${name}: hole Ø${+(2 * list[0].c.r).toFixed(2)}, ${mm(z1 - z0)} deep` : `${name}: ${list.length} holes`, 'extrude');
    cutters.push(b);
  }
  if (cutters.length) E.push({ type: 'combine', op: 'subtract', name: `${name}: cut the holes`, body: ids[0], tools: cutters });
  return ids[0];
}

/** Write spun-around profiles as steps (one per axis, joined). Returns the object that holds them. */
function emitRevolve(E, plan, name, color, hole = false) {
  let main = null;
  const rest = [];
  plan.items.forEach((it, i) => {
    const b = E.body(i ? `${name} ${i + 1}` : name, color, hole);
    // local X: away from the axis (the profile's width), local Z: along the axis (its height)
    const Y = cross3(it.d, it.r);
    const Rr = [[it.r[0], Y[0], it.d[0]], [it.r[1], Y[1], it.d[1]], [it.r[2], Y[2], it.d[2]]];
    sketchFeature(E, b, it.loops, 0, Rr, it.P, `${i ? `${name} ${i + 1}` : name}: profile spun around`, 'revolve');
    if (i) rest.push(b); else main = b;
  });
  if (rest.length) E.push({ type: 'combine', op: 'union', name: `${name}: join`, body: main, tools: rest });
  return main;
}

/**
 * The part (shape: its exact solid; mesh: the same as Manifold, to compare with) as sketches, or null when it cannot
 * be drawn so or the rebuilt part does not come out the same. build(doc, solidsOnly) builds steps in a trial run
 * ({ meshes, solids }). Returns what convertMesh does: { features, bodies, seq, parts, report, errors }.
 */
export function stepToSketches(mf, shape, mesh, { name = 'Part', seq = 1, body = null }, build) {
  const kinds = faceKinds(shape);
  const bb = boundsOf(shape);
  const volume = mesh.volume();
  // the same as the STEP part? (its volume, built by the engine from the new steps)
  const accept = (doc, main) => {
    const check = build({ vars: [], bodies: doc.bodies, features: doc.features });
    // (a sound solid whose triangles do not quite close up, as where a rounded flare meets a wall, is measured from
    // the CAD kernel's volume and its triangles)
    const soup = !check.meshes.get(main) && check.soups?.get(main);
    if (soup && !Object.keys(check.errors).length && Math.abs(soup.volume - volume) <= Math.max(0.01, volume * 1e-3)) {
      const report = compareResult(mf, mesh, [], [soup]);
      return {
        features: doc.features, bodies: doc.bodies, seq: doc.seq, errors: {}, report, exact: true,
        parts: [{ pi: 0, name, body: main, volume, error: 0, steps: doc.features.length, mesh: false, from: 0, to: doc.features.length }],
      };
    }
    const built = check.meshes.get(main);
    if (globalThis.DEBUG_CONV) console.log('step check', built?.volume(), volume, JSON.stringify(check.errors).slice(0, 300));
    if (globalThis.DEBUG_CONV && Object.keys(check.errors).length) for (const f of doc.features) console.log('     ', f.id, f.type, f.kind || f.op || '', f.body, (f.tools || []).join(','), '|', f.name);
    if (!built || Object.keys(check.errors).length || Math.abs(built.volume() - volume) > Math.max(0.01, volume * 1e-3)) return null;
    const report = compareResult(mf, mesh, [built], []);
    return {
      features: doc.features, bodies: doc.bodies, seq: doc.seq, errors: {}, report, exact: true,
      parts: [{ pi: 0, name, body: main, volume, error: 0, steps: doc.features.length, mesh: false, from: 0, to: doc.features.length }],
    };
  };
  for (const axis of ['z', 'y', 'x']) {
    const Rm = AXIS_FRAMES[axis], Z = col(Rm, 2);
    if (!prismatic(kinds, Z)) continue;
    const lv = levelsOf(kinds, Z);
    if (lv.length < 2 || lv.length > 60) continue;
    const plan = prismPlan(lv, (a, b) => outlineAt(shape, Rm, (a + b) / 2, bb), axis);
    if (!plan) continue;
    const doc = { bodies: {}, features: [] }, E = emitter(doc, seq, body);
    const main = emitPrism(E, plan, name, '#22B14C');
    E.done();
    const res = accept(doc, main);
    if (res) return res;
  }
  // an outline pushed along one axis with round parts spun around other axes (bosses, countersunk holes) and pieces
  // drawn along X, Y or Z
  try {
    const doc = mixedPlan(shape, kinds, bb, { name, seq, body }, build, mf);
    if (doc) { const res = accept(doc, doc.main); if (res) return res; }
  } catch (err) { if (globalThis.DEBUG_CONV) console.log('mixed', err?.stack || err); }
  return null;
}

// ---------------------------------------------------------------- outlines with round parts spun around
// A part like a bracket with round bosses on it: the bracket is an outline pushed up (taken where the bosses and
// holes poke into it, they are left out of it: a straight line across), and what is left over (the bosses, the holes,
// small cut-outs) is each drawn on its own: as a profile spun around its axis (from a slice of the part through the
// axis: true lines and arcs), or as an outline pushed along X, Y or Z. A spun boss that was cut off flat (at the floor,
// say) is spun whole and then cut off again. Used only when the whole comes out the same as the part.

/** The 4 directions across axis d (d is along X, Y or Z). */
const across = (d) => UNIT.filter((u) => Math.abs(dot(u, d)) < 0.5).flatMap((u) => [u, scale3(u, -1)]);

/** Round features of the part not drawn by the outline along A: axes of cylinders, cones and rounds across or along
 * A (including holes made of many flat faces), with how far out (rcap) and how far along (t0..t1) they reach. */
function roundFeatures(shape, A) {
  const oc = R.getOC(), items = [];
  shape.faces.forEach((f) => {
    const t = f.geomType;
    const pts = [f.center.toTuple()];
    for (const e of f.edges) for (const u of [0, 0.5, 1]) pts.push(e.pointAt(u).toTuple());
    if (t === 'PLANE') {
      const n = f.normalAt().toTuple();
      if (UNIT.some((u) => Math.abs(Math.abs(dot(n, u)) - 1) < 1e-6) || Math.abs(dot(n, A)) < 1e-6) return; // a wall or a level
      items.push({ pts, samples: [{ c: f.center.toTuple(), n }], b: boundsOf(f) });
    } else if (t === 'CYLINDRE') {
      const ad = new oc.BRepAdaptor_Surface(f.wrapped, false), cy = ad.Cylinder(), ax = cy.Axis(), d = ax.Direction(), l = ax.Location();
      const dd = [d.X(), d.Y(), d.Z()], P = [l.X(), l.Y(), l.Z()];
      free(l, d, ax, cy, ad);
      if (Math.abs(dot(dd, A)) > 1 - 1e-6) return; // a hole along A: in the outline
      items.push({ pts, axis: { d: dd, P }, samples: [], b: boundsOf(f) });
    } else {
      // (any surface spun around an axis has its normals in the planes through the axis)
      const samples = f.edges.map((e) => { const p = e.pointAt(0.5).toTuple(); let n = null; try { n = f.normalAt(p).toTuple(); } catch { /* */ } return n && { c: p, n }; }).filter(Boolean);
      items.push({ pts, samples, b: boundsOf(f) });
    }
  });
  // faces that touch belong together
  const parent = items.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const near = (a, b) => [0, 1, 2].every((i) => a[0][i] <= b[1][i] + 0.3 && b[0][i] <= a[1][i] + 0.3);
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) if (near(items[i].b, items[j].b)) parent[find(i)] = find(j);
  const clusters = new Map();
  items.forEach((it, i) => { const k = find(i); if (!clusters.has(k)) clusters.set(k, []); clusters.get(k).push(it); });
  // how far a sample is from lying in a plane through the axis (0 for a surface spun around it; a few hundredths of a
  // mm for faces cut into triangles, whose middles are not quite on it)
  const TOL_AXIS = 0.05;
  const off = (s, d, P) => dot(s.n, cross3(d, sub3(s.c, P)));
  // The axes the samples are spun around. For a direction d each sample's normal must lie in a plane through the
  // axis, which puts the axis on a line; where most of those lines meet is an axis. Its samples are taken out and the
  // rest looked at again (a tab can have a peg, a rounded top and a rounded edge, each round its own axis).
  const peel = (samples) => {
    const found = [];
    let left = samples;
    for (let round = 0; round < 8 && left.length >= 4; round++) {
      let best = null;
      for (const d of UNIT) {
        const L = left.map((s) => ({ s, a: cross3(s.n, d), b: dot(s.n, cross3(d, s.c)) })).filter((l) => Math.hypot(...l.a) > 1e-3);
        if (L.length < 4) continue;
        const step = Math.max(1, Math.floor(L.length / 40));
        for (let i = 0; i < L.length; i += step) {
          for (let j = i + 1; j < L.length; j += step) {
            const P = solve3([L[i].a, L[j].a, d], [L[i].b, L[j].b, 0]);
            if (!P) continue;
            const inl = L.filter((l) => Math.abs(dot(l.a, P) - l.b) < TOL_AXIS);
            if (!best || inl.length > best.inl.length) best = { d, P, inl };
          }
        }
      }
      if (!best || best.inl.length < 8) break;
      left = left.filter((s) => !best.inl.some((l) => l.s === s));
      // (from three faces or more, normals pointing at least three ways: not a few faces that happen to line up)
      const dirs = [];
      for (const l of best.inl) if (!dirs.some((m) => Math.abs(dot(m, l.s.n)) > 0.996)) dirs.push(l.s.n);
      // (and all round it, not a strip of faces on one side)
      const ang = best.inl.map((l) => { const v = sub3(l.s.c, best.P), w = sub3(v, scale3(best.d, dot(v, best.d))); const u = across(best.d)[0], u2 = cross3(best.d, u); return Math.atan2(dot(w, u2), dot(w, u)); }).sort((a, b) => a - b);
      const gap = Math.max(...ang.map((a, i) => (i ? a - ang[i - 1] : a + 2 * Math.PI - ang[ang.length - 1])));
      if (dirs.length >= 3 && new Set(best.inl.map((l) => l.s.face)).size >= 3 && 2 * Math.PI - gap >= Math.PI / 3) found.push({ d: best.d, P: best.P });
    }
    return found;
  };
  const axes = [];
  for (const list of clusters.values()) {
    const own = [];
    for (const it of list) if (it.axis && !own.some((a) => sameAxis(a, it.axis))) own.push({ d: it.axis.d, P: it.axis.P, pts: [] });
    // (faces already round a cylinder's axis are not looked at again)
    const loose = list.filter((it) => !it.axis && !own.some((a) => it.samples.length && it.samples.every((x) => Math.abs(off(x, a.d, a.P)) < TOL_AXIS)));
    for (const a of peel(loose.flatMap((it, k) => it.samples.map((x) => ({ ...x, face: k }))))) if (!own.some((b) => sameAxis(a, b))) own.push({ d: a.d, P: a.P, pts: [] });
    if (!own.length) continue;
    // every face to the axis it is spun around (faces round none of them are left out)
    for (const it of list) {
      let k = -1;
      if (it.axis) k = own.findIndex((a) => sameAxis(a, it.axis));
      else if (it.samples.length) {
        const err = own.map((a) => Math.max(...it.samples.map((x) => Math.abs(off(x, a.d, a.P)))));
        const m = Math.min(...err);
        if (m < TOL_AXIS) k = err.indexOf(m);
      }
      if (k >= 0) { own[k].pts.push(...it.pts); it.done = true; }
    }
    for (const a of own) {
      if (!a.pts.length) continue;
      const prev = axes.find((b) => sameAxis(a, b));
      if (prev) prev.pts.push(...a.pts); else axes.push(a);
    }
  }
  // (a curved face round an axis found among other faces: a tapered boss round a hole along the same axis, say, whose
  // faces do not touch the hole's)
  for (const it of items) {
    if (it.done || it.axis || it.samples.length < 2) continue;
    const err = axes.map((a) => Math.max(...it.samples.map((x) => Math.abs(off(x, a.d, a.P)))));
    const m = Math.min(...err);
    if (m < TOL_AXIS) axes[err.indexOf(m)].pts.push(...it.pts);
  }
  // (only axes along X, Y or Z: a slice through the axis must be a flat cut along them)
  return axes.filter((a) => a.d.some((x) => Math.abs(Math.abs(x) - 1) < 1e-6)).map((a) => {
    const t = a.pts.map((p) => dot(sub3(p, a.P), a.d));
    const r = a.pts.map((p) => { const v = sub3(p, a.P); return Math.hypot(...sub3(v, scale3(a.d, dot(v, a.d)))); });
    return { d: a.d.map((x) => Math.round(x)), P: a.P, rcap: Math.max(...r), t0: Math.min(...t), t1: Math.max(...t) };
  });
}
const sameAxis = (a, b) => { const v = sub3(b.P, a.P); return Math.abs(Math.abs(dot(a.d, b.d)) - 1) < 1e-6 && Math.hypot(...sub3(v, scale3(a.d, dot(v, a.d)))) < 1e-3; };
const insideFeature = (c, f) => { const v = sub3(c, f.P), t = dot(v, f.d); return t >= f.t0 - 1e-6 && t <= f.t1 + 1e-6 && Math.hypot(...sub3(v, scale3(f.d, t))) <= f.rcap + 1e-6; };

/** The part's own walls along A (flat faces along it and cylinders along it, not inside a round feature): edges on
 * them are the outline's. */
function wallsAlong(shape, A, feats) {
  const oc = R.getOC(), out = [];
  // (a flat face is inside a round feature when its edges are: the round end of a boss cut off flat, say, whose box
  // corners are not)
  const edgePts = (f) => f.edges.flatMap((e) => [0, 0.25, 0.5, 0.75, 1].map((u) => e.pointAt(u).toTuple()));
  for (const f of shape.faces) {
    const t = f.geomType;
    if (t === 'PLANE') {
      const n = f.normalAt().toTuple(), b = boundsOf(f);
      if (Math.abs(dot(n, A)) < 1e-6 && !feats.some((g) => edgePts(f).every((c) => insideFeature(c, g)))) out.push({ t, n, c: f.center.toTuple(), b });
    }
    else if (t === 'CYLINDRE') {
      const ad = new oc.BRepAdaptor_Surface(f.wrapped, false), cy = ad.Cylinder(), ax = cy.Axis(), d = ax.Direction(), l = ax.Location();
      const dd = [d.X(), d.Y(), d.Z()], P = [l.X(), l.Y(), l.Z()], rad = cy.Radius();
      free(l, d, ax, cy, ad);
      if (Math.abs(dot(dd, A)) > 1 - 1e-6) out.push({ t, d: dd, P, rad, b: boundsOf(f) });
    }
  }
  return out;
}
const onWall = (p, walls) => walls.some((f) => {
  if (p.some((x, i) => x < f.b[0][i] - 1e-4 || x > f.b[1][i] + 1e-4)) return false;
  if (f.t === 'PLANE') return Math.abs(dot(f.n, sub3(p, f.c))) < 1e-5;
  const v = sub3(p, f.P);
  return Math.abs(Math.hypot(...sub3(v, scale3(f.d, dot(v, f.d)))) - f.rad) < 1e-5;
});

/** A wire as a loop where the runs of edges that are not on the walls become one straight line (a boss or a hole
 * poking into the outline is left out of it). false when none of it is on a wall; null when it cannot be a sketch. */
function cleanWire(wire, to2, walls) {
  const edges = wire.edges;
  const isWall = (e) => onWall(e.pointAt(0.5).toTuple(), walls);
  if (edges.length === 1) return isWall(edges[0]) ? wireLoop(wire, to2) : false;
  const segs = edges.map((e) => ({ e, s: to2(e.startPoint), t: to2(e.endPoint), wall: isWall(e) }));
  const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 2e-4; // (curves cut from faceted faces meet a hair apart)
  const order = [segs.shift()];
  while (segs.length) {
    const at = order[order.length - 1].t;
    const i = segs.findIndex((g) => same(g.s, at) || same(g.t, at)); if (i < 0) return null;
    const g = segs.splice(i, 1)[0];
    order.push(same(g.s, at) ? g : { ...g, s: g.t, t: g.s, rev: true });
  }
  if (!order.some((g) => g.wall)) return false;
  const k0 = order.findIndex((g) => g.wall), ring = [...order.slice(k0), ...order.slice(0, k0)];
  let pts = [], bulge = [];
  for (let i = 0; i < ring.length;) {
    const g = ring[i];
    if (g.wall) {
      for (const st of edgeSteps(g.e, to2, g.s, g.t, g.rev)) { pts.push(st.p); bulge.push(st.b); }
      i++;
    } else {
      pts.push(g.s); bulge.push(0);
      while (i < ring.length && !ring[i].wall) i++;
    }
  }
  // straight lines one after another along the same direction become one; points a hair apart become one
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const j = (i + 1) % pts.length, k = (i + 2) % pts.length;
      const a = pts[i], b = pts[j], c = pts[k];
      const u = [b[0] - a[0], b[1] - a[1]], w = [c[0] - b[0], c[1] - b[1]];
      const lu = Math.hypot(...u), lw = Math.hypot(...w);
      if (lu < 1e-6 || (!bulge[i] && !bulge[j] && Math.abs(u[0] * w[1] - u[1] * w[0]) < 1e-6 * lu * lw + 1e-9 && u[0] * w[0] + u[1] * w[1] > 0)) {
        if (lu < 1e-6) bulge[i] = bulge[j];
        pts.splice(j, 1); bulge.splice(j, 1); changed = true; break;
      }
    }
  }
  if (pts.length < 3 && !bulge.some((x) => x)) return false;
  pts = pts.map((p) => p.map(r6)); bulge = bulge.map(r6);
  return bulge.some((x) => x) ? { type: 'poly', pts, bulge } : { type: 'poly', pts };
}

/**
 * The outlines between two levels with bosses and holes left out, one per height sliced at (from the middle out;
 * null where a slice does not give one).
 */
function* cleanOutlines(shape, Rm, z0, z1, walls) {
  const X = col(Rm, 0), Y = col(Rm, 1), Z = col(Rm, 2);
  const to2 = (p) => { const w = p.toTuple ? p.toTuple() : p; return [dot(w, X), dot(w, Y)]; };
  const N = 13, order = [...Array(N).keys()].sort((a, b) => Math.abs(a - (N - 1) / 2) - Math.abs(b - (N - 1) / 2) || a - b);
  for (const k of order) {
    const z = z0 + ((k + 0.5) / N) * (z1 - z0);
    // (the part where a flat sheet across it at that height lies inside it: its faces, facing along Z)
    const P3 = (u, v) => [0, 1, 2].map((i) => u * X[i] + v * Y[i] + z * Z[i]);
    const sheet = R.makePolygon([P3(-1e4, -1e4), P3(1e4, -1e4), P3(1e4, 1e4), P3(-1e4, 1e4)]);
    let cut;
    try { cut = fuzzyBool('int', shape, sheet, 0); } catch { yield null; continue; } finally { free(sheet); }
    let loops = [];
    try {
      for (const f of cut.faces) {
        if (f.geomType !== 'PLANE' || dot(f.normalAt().toTuple(), Z) < 1 - 1e-6) continue;
        for (const w of [f.clone().outerWire(), ...f.clone().innerWires()]) {
          const l = cleanWire(w, to2, walls);
          if (l === null) { if (globalThis.DEBUG_CONV) console.log(`   outline at ${z.toFixed(2)}: a wall edge is not a line or arc`, w.edges.map((e) => e.geomType).join(' ')); loops = null; break; }
          if (l) loops.push(l);
        }
        if (!loops) break;
      }
    } finally { free(cut); }
    yield loops?.length ? loops : null;
  }
}

/** A slice of a solid through an axis, on one side of it (direction r): loops in (out from the axis, along it). */
function halfSection(solid, d, r, P, bb) {
  const Z = cross3(r, d);
  const Rm = [[r[0], d[0], Z[0]], [r[1], d[1], Z[1]], [r[2], d[2], Z[2]]];
  const lo = bb[0].map((x) => x - 1), hi = bb[1].map((x) => x + 1);
  const ri = r.findIndex((v) => Math.abs(v) > 0.5);
  if (r[ri] > 0) lo[ri] = Math.max(lo[ri], P[ri]); else hi[ri] = Math.min(hi[ri], P[ri]);
  if (lo[ri] >= hi[ri]) return [];
  const half = R.makeBox(lo, hi);
  let part;
  try { part = solid.clone().intersect(half); } catch { return null; } finally { free(half); }
  try {
    const loops = outlineAt(part, Rm, dot(P, Z), bb);
    if (!loops) return null;
    const s0 = dot(P, r), t0 = dot(P, d);
    return loops.map((l) => (l.type === 'circle' ? { ...l, c: [r6(l.c[0] - s0), r6(l.c[1] - t0)] } : { ...l, pts: l.pts.map(([x, y]) => [r6(x - s0), r6(y - t0)]) }));
  } finally { free(part); }
}

/** A piece's profile with the flat edge it sits on (its longest straight edge across the axis: where it meets the
 * object it is joined to) pushed e outward, as a thin strip into that object: no knife edge where a rounded flare
 * meets a wall (it would leave needle-thin slivers). */
function seat(loops, e) {
  let best = null;
  loops.forEach((l, li) => {
    if (l.type === 'circle') return;
    l.pts.forEach((p, i) => {
      const q = l.pts[(i + 1) % l.pts.length];
      if (Math.abs(p[1] - q[1]) < 1e-4 && !(l.bulge?.[i]) && (!best || Math.abs(q[0] - p[0]) > best.len)) best = { li, y0: p[1], dx: q[0] - p[0], len: Math.abs(q[0] - p[0]) };
    });
  });
  if (!best || best.len < 1e-3) return loops;
  // outward: away from the inside of the loop (on the left of each edge when it runs anticlockwise)
  const L = loops[best.li], area = L.pts.reduce((a, p, i) => { const q = L.pts[(i + 1) % L.pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
  const dy = -e * Math.sign(best.dx) * Math.sign(area);
  return loops.map((l, li) => {
    if (li !== best.li) return l;
    const n = l.pts.length, on = l.pts.map((p) => Math.abs(p[1] - best.y0) < 1e-4), B = (i) => l.bulge?.[i] || 0;
    const pts = [], bulge = [];
    for (let i = 0; i < n; i++) {
      const p = l.pts[i], prev = on[(i - 1 + n) % n], next = on[(i + 1) % n];
      const moved = [p[0], r6(p[1] + dy)];
      if (!on[i] || (!prev && !next)) { pts.push(p); bulge.push(B(i)); }
      else if (!prev) { pts.push(p, moved); bulge.push(0, B(i)); }
      else if (!next) { pts.push(moved, p); bulge.push(0, B(i)); }
      else { pts.push(moved); bulge.push(B(i)); }
    }
    return bulge.some((x) => x) ? { type: 'poly', pts, bulge } : { type: 'poly', pts };
  });
}
/** Loops with the points at their lowest and highest y moved out by e (a cutter made a hair longer). */
function reach(loops, e) {
  const ys = loops.flatMap((l) => (l.type === 'circle' ? [l.c[1] - l.r, l.c[1] + l.r] : l.pts.map((p) => p[1])));
  const lo = Math.min(...ys), hi = Math.max(...ys);
  return loops.map((l) => (l.type === 'circle' ? l : { ...l, pts: l.pts.map(([x, y]) => [x, Math.abs(y - lo) < 1e-4 ? r6(y - e) : Math.abs(y - hi) < 1e-4 ? r6(y + e) : y]) }));
}

/**
 * One left-over piece as steps: spun around the round features' axes that run through it, or an outline pushed
 * along X, Y or Z. role 'add' (a boss: it must stay inside the part) or 'cut' (a hole: it must not cut the part).
 * Returns a plan, or null.
 */
function piecePlan(piece, role, feats, shape, bbPart, build, mfOf, partM, drawn = piece) {
  const pb = boundsOf(drawn), pv = vol(piece), ptol = Math.max(0.1, pv * 0.05);
  let pieceM = null;
  // (measured with meshes as fine as the piece's size needs: where a drawn piece lies on the part's faces, finer
  // meshes only make the measuring slow)
  const MT = Math.max(0.002, Math.min(0.05, Math.hypot(...[0, 1, 2].map((i) => pb[1][i] - pb[0][i])) / 1500));
  try { pieceM = mfOf(piece, false, MT); } catch { return null; }
  // how much of the piece C leaves out, and how much it puts where it must not (outside the part for a boss, into
  // the part for a hole), trimmed to the part's box
  // (measured as meshes: the CAD kernel can fail without a word on faces lying exactly on each other)
  const measure = (C) => {
    const made = [];
    const keep = (m) => { made.push(m); return m; };
    try {
      const box = keep(mfOf.cube(bbPart));
      const Ct = keep(keep(mfOf(C, false, MT)).intersect(box));
      const miss = keep(pieceM.subtract(Ct)).volume();
      const extra = keep(role === 'add' ? Ct.subtract(partM) : Ct.intersect(partM)).volume();
      return { miss, extra };
    } catch { return { miss: Infinity, extra: Infinity }; } finally { for (const m of made) { try { m.delete(); } catch { /* */ } } }
  };
  const built = (plan, emit) => {
    const doc = { bodies: {}, features: [] }, E = emitter(doc, 1, 'b0');
    const m = emit(E, plan, 'piece', '#888888', false);
    E.done();
    return build({ vars: [], bodies: doc.bodies, features: doc.features }, true).solids?.get(m) || null;
  };
  const tryPlan = (plan, emit) => {
    const C = built(plan, emit);
    if (!C) return null;
    const { miss, extra } = measure(C);
    if (globalThis.DEBUG_CONV) console.log(`   piece ${role} ${pv.toFixed(2)} as ${plan.kind}: misses ${miss.toFixed(3)}, too much ${extra.toFixed(3)}`);
    return miss <= ptol && extra <= ptol ? { ...plan, bounds: boundsOf(C) } : null;
  };
  // spun around the axes through it (each on a side of its axis away from the others, where it reaches furthest)
  const pc = [0, 1, 2].map((i) => (pb[0][i] + pb[1][i]) / 2), half = Math.hypot(...[0, 1, 2].map((i) => pb[1][i] - pb[0][i])) / 2;
  const mine = feats.filter((f) => insideFeature(pc, { ...f, rcap: f.rcap + half, t0: f.t0 - half, t1: f.t1 + half }));
  if (mine.length) {
    const items = [];
    for (const f of mine) {
      // each side of the axis it can be sliced from (not toward another axis of the piece), spun round: the one that
      // fits best (a hex hole spun round is a circle through its flats or through its corners, depending on the side)
      let best = null;
      for (const r of across(f.d)) {
        if (mine.some((g) => g !== f && (() => { const v = sub3(g.P, f.P), w = sub3(v, scale3(f.d, dot(v, f.d))); return dot(w, r) > 1e-6; })())) continue;
        const loops0 = halfSection(drawn, f.d, r, f.P, pb);
        if (!loops0 || !loops0.length) continue;
        // (drawn from the piece itself, a hole's cutter reaches a hair past its ends, into the open space there)
        const item = { d: f.d, r, P: f.P, loops: drawn !== piece ? loops0 : role === 'cut' ? reach(loops0, 0.02) : seat(loops0, 0.05) };
        const C = built({ kind: 'revolve', items: [item] }, emitRevolve);
        const m1 = C ? measure(C) : null;
        if (globalThis.DEBUG_CONV) console.log(`   piece ${role} ${pv.toFixed(2)}${drawn === piece ? '' : ' (with margin)'}: axis ${f.P.map((x) => +x.toFixed(2))} side ${r}: ${m1 ? `misses ${m1.miss.toFixed(3)}, too much ${m1.extra.toFixed(3)}` : 'not built'}`, pv > 1000 ? JSON.stringify(item.loops) : '');
        if (m1 && m1.extra <= ptol && (!best || m1.miss + m1.extra < best.score)) best = { item, score: m1.miss + m1.extra };
      }
      // (an axis is used only when spinning the piece round it stays where it may: a peg next to a rounded tab top
      // is spun round its own axis, not the top's)
      if (best) items.push(best.item);
    }
    if (items.length) {
      let plan = tryPlan({ kind: 'revolve', items }, emitRevolve);
      // (an axis it fits without is left out: one spin per round part)
      for (let k = items.length - 1; plan && items.length > 1 && k >= 0; k--) {
        const fewer = tryPlan({ kind: 'revolve', items: items.filter((_, i) => i !== k) }, emitRevolve);
        if (fewer) { items.splice(k, 1); plan = fewer; }
      }
      if (plan) return plan;
    }
  }
  // an outline pushed along X, Y or Z
  const kinds = faceKinds(drawn);
  for (const axis of ['z', 'y', 'x']) {
    const Rm = AXIS_FRAMES[axis], Z = col(Rm, 2);
    if (!prismatic(kinds, Z)) continue;
    const lv = levelsOf(kinds, Z);
    if (lv.length < 2 || lv.length > 60) continue;
    const plan0 = prismPlan(lv, (a, b) => outlineAt(drawn, Rm, (a + b) / 2, pb), axis);
    if (!plan0) continue;
    if (role === 'cut' && drawn === piece) {
      // (drawn from the piece itself, a cutter reaches a hair past the piece every way: no needle-thin slivers left
      // where its edges would lie exactly on the part's)
      plan0.groups[0].z0 -= 0.02; plan0.groups[plan0.groups.length - 1].z1 += 0.02;
      for (const g of plan0.groups) {
        const cs = mfOf.mf.CrossSection.ofPolygons(g.loops.map((l) => SG.flattenLoop(l)), 'EvenOdd'), big = cs.offset(0.01, 'Miter', 4);
        g.loops = big.toPolygons().map((P) => ({ type: 'poly', pts: P.map((q) => [r6(q[0]), r6(q[1])]) }));
        cs.delete(); big.delete();
      }
    }
    const plan = tryPlan(plan0, emitPrism);
    if (plan) return plan;
  }
  return null;
}

/** The part as an outline pushed along one axis plus spun round parts, holes and pieces (see above), or null. */
function mixedPlan(shape, kinds, bb, { name, seq, body }, build, mf) {
  const V0 = vol(shape), tol = Math.max(0.05, V0 * 2e-5);
  // a shape as a fine mesh (to measure how pieces fit; mt: how close to the surface, else by its size). snap: each
  // coordinate within 2e-5 mm of one the part's own mesh uses is moved onto it (where a face is drawn on one of the
  // part's, rounding would otherwise leave a skin a few millionths of a mm thick between the two, which joins pieces of
  // what is left over that are really apart).
  let grid = null;
  const nearest = (g, x) => {
    let lo = 0, hi = g.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (g[mid] < x) lo = mid + 1; else hi = mid; }
    return lo > 0 && x - g[lo - 1] < g[lo] - x ? g[lo - 1] : g[lo];
  };
  const mfOf = (s, snap = false, mt = 0) => {
    const b = boundsOf(s), diag = Math.hypot(...[0, 1, 2].map((i) => b[1][i] - b[0][i])) || 1;
    const me = s.mesh({ tolerance: mt || Math.max(0.002, Math.min(0.02, diag / 5000)), angularTolerance: mt > 0.02 ? 0.2 : 0.1 }), v = me.vertices;
    if (s === shape && !grid) grid = [0, 1, 2].map((a) => Float64Array.from(new Set(v.filter((_, i) => i % 3 === a))).sort());
    if (snap && grid) for (let i = 0; i < v.length; i++) { const g = nearest(grid[i % 3], v[i]); if (Math.abs(g - v[i]) < 2e-5) v[i] = g; }
    const m = new mf.Mesh({ numProp: 3, vertProperties: new Float32Array(v), triVerts: new Uint32Array(me.triangles) });
    m.merge();
    return new mf.Manifold(m);
  };
  mfOf.cube = (b) => mf.Manifold.cube([0, 1, 2].map((i) => b[1][i] - b[0][i])).translate(b[0]);
  mfOf.mf = mf;
  let partM = null;
  const CUT_WORD = { '2-': 'below the floor', '2+': 'above the top', '0-': 'past the left side', '0+': 'past the right side', '1-': 'past the front', '1+': 'past the back' };
  for (const axis of ['z', 'y', 'x']) {
    const Rm = AXIS_FRAMES[axis], A = col(Rm, 2);
    const feats = roundFeatures(shape, A);
    if (globalThis.DEBUG_CONV) console.log(`mixed ${axis}: round features`, JSON.stringify(feats.map((f) => ({ d: f.d, P: f.P.map((x) => +x.toFixed(2)), r: +f.rcap.toFixed(2), t: [+f.t0.toFixed(2), +f.t1.toFixed(2)] }))));
    // the levels: flat faces across A that are not part of a round feature, and the part's ends
    const ends = [dot(bb[0], A), dot(bb[1], A)];
    const lv = levelSet([...levelsOf(kinds, A, (k) => feats.some((f) => insideFeature(k.c, f))), ...ends]);
    if (lv.length < 2 || lv.length > 60) continue;
    const walls = wallsAlong(shape, A, feats);
    // of the outlines the heights give, the one that pushed up leaves the least over (measured as meshes)
    if (!partM) partM = mfOf(shape);
    const partLocal = partM.transform(toLocalMat(Rm, [0, 0, 0]));
    // (sliced from the middle out, each new outline measured as it comes: done when four slices more, after five or
    // more, bring none better)
    const choose = (a, b) => {
      const made = [], keep = (m) => { made.push(m); return m; };
      try {
        let best = null, ref = null, n = 0, since = 0;
        const seen = new Set();
        for (const loops of cleanOutlines(shape, Rm, a, b, walls)) {
          n++; since++;
          if (loops && !seen.has(key(loops))) {
            seen.add(key(loops));
            const big = 1e4;
            ref ||= keep(partLocal.intersect(keep(mf.Manifold.cube([2 * big, 2 * big, b - a]).translate([-big, -big, a]))));
            const ex = keep(keep(keep(mf.CrossSection.ofPolygons(loops.map((l) => SG.flattenLoop(l)), 'EvenOdd')).extrude(b - a)).translate([0, 0, a]));
            const score = keep(ref.subtract(ex)).volume() + keep(ex.subtract(ref)).volume();
            if (globalThis.DEBUG_CONV) console.log(`   outline ${n}: leaves ${score.toFixed(2)} over`);
            if (!best || score < best.score - 1e-3) { best = { score, loops }; since = 0; }
          }
          if (best && n >= 5 && since >= 4) break;
        }
        return best?.loops ?? null;
      } finally { for (const m of made) { try { m.delete(); } catch { /* */ } } }
    };
    const plan = prismPlan(lv, choose, axis);
    partLocal.delete();
    if (globalThis.DEBUG_CONV) console.log(`mixed ${axis}: levels ${lv.join(', ')}; walls ${walls.length}; outline ${plan ? plan.groups.map((g) => `${g.loops.length} loop(s) ${g.z0}..${g.z1}`).join(', ') : 'none'}`);
    if (!plan) continue;
    if (globalThis.DEBUG_CONV) for (const g of plan.groups) for (const l of g.loops) console.log(`   outline loop: ${l.type === 'circle' ? 'circle' : l.pts.length + ' points'}`, l.pts ? JSON.stringify(l.pts.map((q) => q.map((x) => +x.toFixed(3)))) : '');
    // the outline pushed up, built, and what is left over: pieces to add and pieces to cut
    const baseDoc = { bodies: {}, features: [] }, E0 = emitter(baseDoc, 1, 'b0');
    const b0 = emitPrism(E0, plan, name, '#22B14C');
    E0.done();
    const B = build({ vars: [], bodies: baseDoc.bodies, features: baseDoc.features }, true).solids?.get(b0)?.clone();
    if (!B) continue;
    // What is left over, found as meshes (the CAD kernel can drop pieces where faces lie exactly on each other), and
    // each cut out exactly within a box round it, the way (plain, or treating faces a hair apart as touching) that
    // gives a piece of the size the meshes say.
    if (!partM) partM = mfOf(shape);
    const Bm = mfOf(B, true);
    const meshPieces = (role) => {
      const m = role === 'add' ? partM.subtract(Bm) : Bm.subtract(partM), out = [];
      for (const q of m.decompose()) {
        const v = q.volume();
        if (v > tol) { const b = q.boundingBox(); out.push({ v, b: [[...b.min], [...b.max]] }); }
        q.delete();
      }
      m.delete();
      return out;
    };
    const exactPiece = (role, mp) => {
      const lo = mp.b[0].map((x) => x - 0.2), hi = mp.b[1].map((x) => x + 0.2);
      const within = (s) => { const b = boundsOf(s); return [0, 1, 2].every((i) => b[0][i] >= lo[i] - 0.1 && b[1][i] <= hi[i] + 0.1); };
      for (const fz of [0, 1e-5, 1e-4]) {
        let box = null, inBox = null, X = null;
        try {
          box = R.makeBox(lo, hi);
          inBox = (role === 'add' ? shape : B).clone().intersect(box);
          const other = role === 'add' ? B : shape;
          X = fz ? fuzzyBool('sub', inBox, other, fz) : inBox.clone().cut(other.clone());
          const sols = solidsOf(X).filter((q) => vol(q) > tol * 0.5 && within(q));
          const tot = sols.reduce((a, q) => a + vol(q), 0);
          if (sols.length && Math.abs(tot - mp.v) <= Math.max(0.05, mp.v * 0.03)) return sols.length === 1 ? sols[0] : R.makeCompound(sols);
          free(...sols);
        } catch { /* the next way */ } finally { free(box, inBox, X); }
      }
      return null;
    };
    const addsM = meshPieces('add'), cutsM = meshPieces('cut');
    Bm.delete();
    if (globalThis.DEBUG_CONV) for (const [r, L] of [['add', addsM], ['cut', cutsM]]) for (const x of L) console.log(`   mesh piece ${r} ${x.v.toFixed(2)} box ${JSON.stringify(x.b.map((v) => v.map((y) => +y.toFixed(2))))}`);
    if (addsM.length + cutsM.length > 24) { free(B); continue; }
    const adds = addsM.map((mp) => exactPiece('add', mp)), cuts = cutsM.map((mp) => exactPiece('cut', mp));
    free(B);
    if (adds.some((x) => !x) || cuts.some((x) => !x)) {
      if (globalThis.DEBUG_CONV) console.log(`mixed ${axis}: a left-over piece could not be cut out exactly`, adds.map((x) => !!x), cuts.map((x) => !!x));
      free(...adds.filter(Boolean), ...cuts.filter(Boolean));
      continue;
    }
    if (!adds.length && !cuts.length) continue; // (the plain outline already failed)
    // each piece is drawn with a margin (0.05 mm) round it, of the part for one to add (it overlaps what it is joined
    // to) and of open space for one to cut (it reaches past the faces it is cut from): no faces lying exactly on each
    // other, which can leave needle-thin slivers or trip the CAD kernel
    const margin = (role, piece) => {
      const b = boundsOf(piece), box = R.makeBox(b[0].map((x) => x - 0.05), b[1].map((x) => x + 0.05));
      try {
        const m = role === 'add' ? shape.clone().intersect(box) : box.clone().cut(shape.clone());
        return vol(m) >= vol(piece) * 0.98 ? m : piece;
      } catch { return piece; } finally { free(box); }
    };
    // (a piece to add with the margin first, one to cut from the piece itself first (fewer levels); then the other)
    const planOf = (role, p) => (role === 'add'
      ? piecePlan(p, role, feats, shape, bb, build, mfOf, partM, margin(role, p)) || piecePlan(p, role, feats, shape, bb, build, mfOf, partM)
      : piecePlan(p, role, feats, shape, bb, build, mfOf, partM) || piecePlan(p, role, feats, shape, bb, build, mfOf, partM, margin(role, p)));
    const addPlans = adds.map((p) => planOf('add', p));
    const cutPlans = cuts.map((p) => planOf('cut', p));
    free(...adds, ...cuts);
    if (addPlans.some((p) => !p) || cutPlans.some((p) => !p)) { if (globalThis.DEBUG_CONV) console.log(`mixed ${axis}: pieces not drawn`, addPlans.map(Boolean), cutPlans.map(Boolean)); continue; }
    // the steps: the outline, the round parts and pieces joined to it, cut off where they stick out of the part,
    // then the holes and cut-outs
    const doc = { bodies: {}, features: [] }, E = emitter(doc, seq, body);
    const main = emitPrism(E, plan, name, '#22B14C');
    let nr = 0, np = 0, nh = 0, nc = 0;
    const added = addPlans.map((p) => (p.kind === 'revolve' ? emitRevolve(E, p, `${name} round piece ${++nr}`, '#22B14C') : emitPrism(E, p, `${name} piece ${++np}`, '#22B14C')));
    if (added.length) E.push({ type: 'combine', op: 'union', name: `${name}: join the ${nr ? 'round pieces' : 'pieces'}${nr && np ? ' and other pieces' : ''}`, body: main, tools: added });
    const trims = [];
    for (let i = 0; i < 3; i++) {
      for (const side of ['-', '+']) {
        const out = addPlans.filter((p) => (side === '-' ? p.bounds[0][i] < bb[0][i] - 1e-4 : p.bounds[1][i] > bb[1][i] + 1e-4));
        if (!out.length) continue;
        const lo = [0, 1, 2].map((k) => Math.min(bb[0][k], ...out.map((p) => p.bounds[0][k])) - 1), hi = [0, 1, 2].map((k) => Math.max(bb[1][k], ...out.map((p) => p.bounds[1][k])) + 1);
        if (side === '-') hi[i] = bb[0][i]; else lo[i] = bb[1][i];
        const b = E.body(`${name} cut off ${CUT_WORD[i + side]}`, '#8b96a3', true);
        E.push({ type: 'shape', body: b, kind: 'box', name: `${name}: cut off ${CUT_WORD[i + side]}`, p: { w: r6(hi[0] - lo[0]), d: r6(hi[1] - lo[1]), h: r6(hi[2] - lo[2]), round: 0, roundMode: 'all' }, pos: [r6((lo[0] + hi[0]) / 2), r6((lo[1] + hi[1]) / 2), r6(lo[2])], rot: [0, 0, 0] });
        trims.push(b);
      }
    }
    if (trims.length) E.push({ type: 'combine', op: 'subtract', name: `${name}: cut off what sticks out`, body: main, tools: trims });
    const cutters = cutPlans.map((p) => (p.kind === 'revolve' ? emitRevolve(E, p, `${name} round hole ${++nh}`, '#8b96a3', true) : emitPrism(E, p, `${name} cut-out ${++nc}`, '#8b96a3', true)));
    if (cutters.length) E.push({ type: 'combine', op: 'subtract', name: `${name}: cut the ${nh ? 'round holes' : 'cut-outs'}${nh && nc ? ' and cut-outs' : ''}`, body: main, tools: cutters });
    E.done();
    doc.main = main;
    return doc;
  }
  return null;
}

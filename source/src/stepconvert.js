// STEP to sketches, from the part's own exact edges. A part from a STEP file made of flat faces and straight round
// walls (holes, rounded corners, slots) along one direction is rebuilt as sketches: at each level where its outline
// changes, a paper-thin slice of the part gives the outline as the STEP's true lines, arcs and circles, and that
// outline becomes a sketch pushed up to the next level. The levels are merged into one object, and the result is
// checked against the part's volume. Anything else (rounded top edges, cones, free-form surfaces) goes to the mesh
// converter (stlconvert.js), and when that cannot rebuild it either, the part stays the exact STEP solid.
import * as R from 'replicad';
import * as SG from './sketchgeom.js';
import { sketchFeature, emitter, AXIS_FRAMES, compareResult } from './stlconvert.js';

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

/** A wire's edges in order round the loop, as 2D points and bulges (true arcs), or null if it has other curves. */
function wireLoop(wire, to2) {
  const edges = wire.edges;
  if (edges.length === 1 && edges[0].geomType === 'CIRCLE') {
    // a whole circle: its middle from three points on it
    const e = edges[0], A = to2(e.pointAt(0)), B = to2(e.pointAt(1 / 3)), C = to2(e.pointAt(2 / 3));
    const d = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
    if (Math.abs(d) < 1e-12) return null;
    const s = (P) => P[0] * P[0] + P[1] * P[1];
    const c = [(s(A) * (B[1] - C[1]) + s(B) * (C[1] - A[1]) + s(C) * (A[1] - B[1])) / d, (s(A) * (C[0] - B[0]) + s(B) * (A[0] - C[0]) + s(C) * (B[0] - A[0])) / d];
    return { type: 'circle', c: c.map(r6), r: r6(Math.hypot(A[0] - c[0], A[1] - c[1])) };
  }
  if (edges.some((e) => e.geomType !== 'LINE' && e.geomType !== 'CIRCLE')) return null;
  const segs = edges.map((e) => ({ e, s: to2(e.startPoint), t: to2(e.endPoint) }));
  const same = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-5;
  const order = [segs.shift()];
  while (segs.length) {
    const at = order[order.length - 1].t;
    const i = segs.findIndex((g) => same(g.s, at) || same(g.t, at)); if (i < 0) return null;
    const g = segs.splice(i, 1)[0];
    order.push(same(g.s, at) ? g : { e: g.e, s: g.t, t: g.s });
  }
  if (!same(order[order.length - 1].t, order[0].s)) return null;
  const pts = [], bulge = [];
  for (const g of order) {
    if (same(g.s, g.t)) continue;
    pts.push(g.s.map(r6));
    bulge.push(g.e.geomType === 'CIRCLE' ? r6(SG.bulgeFrom3(g.s, to2(g.e.pointAt(0.5)), g.t)) : 0);
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

/**
 * The part (shape: its exact solid; mesh: the same as Manifold, to compare with) as sketches, or null when it is
 * not made of outlines pushed along X, Y or Z, or the rebuilt part does not come out the same. build(doc) builds
 * steps in a trial run ({ meshes }). Returns what convertMesh does: { features, bodies, seq, parts, report, errors }.
 */
export function stepToSketches(mf, shape, mesh, { name = 'Part', seq = 1, body = null }, build) {
  const kinds = faceKinds(shape);
  const bb = (() => { const b = shape.boundingBox; const r = [b.bounds[0], b.bounds[1]]; b.delete?.(); return r; })();
  const volume = mesh.volume();
  for (const axis of ['z', 'y', 'x']) {
    const Rm = AXIS_FRAMES[axis], Z = col(Rm, 2);
    if (!prismatic(kinds, Z)) continue;
    // the levels: every flat face across Z
    const lv = [...new Set(kinds.filter((k) => k.t === 'PLANE' && Math.abs(dot(k.n, Z)) > 0.5).map((k) => Math.round(dot(k.c, Z) * 1e5) / 1e5))].sort((a, b) => a - b);
    if (lv.length < 2 || lv.length > 60) continue;
    // the outline between each pair of levels; the same outline over several levels is one sketch
    const groups = [];
    let ok = true;
    for (let i = 0; i + 1 < lv.length && ok; i++) {
      const loops = outlineAt(shape, Rm, (lv[i] + lv[i + 1]) / 2, bb);
      if (loops === null) { ok = false; break; }
      if (!loops.length) continue; // a gap between two pieces of the part
      const k = key(loops), last = groups[groups.length - 1];
      if (last && last.k === k && Math.abs(last.z1 - lv[i]) < 1e-9) last.z1 = lv[i + 1];
      else groups.push({ k, loops, z0: lv[i], z1: lv[i + 1] });
    }
    if (!ok || !groups.length || groups.length > 40) continue;
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
    const doc = { bodies: {}, features: [] };
    const E = emitter(doc, seq, body);
    const ids = [];
    groups.forEach((g, i) => {
      const b = E.body(i ? `${name} level ${i + 1}` : name, '#22B14C');
      const O = [Z[0] * g.z0, Z[1] * g.z0, Z[2] * g.z0];
      sketchFeature(E, b, g.loops, g.z1 - g.z0, Rm, O, i ? `${name}: level ${i + 1} at ${mm(g.z0 - groups[0].z0)}, pushed ${WORD[axis]} ${mm(g.z1 - g.z0)}` : `${name}: outline pushed ${WORD[axis]} ${mm(g.z1 - g.z0)}`, 'extrude');
      ids.push(b);
    });
    if (ids.length > 1) E.push({ type: 'combine', op: 'union', name: `${name}: join the levels`, body: ids[0], tools: ids.slice(1) });
    // the holes, grouped by where they run, cut out together
    const runs = new Map();
    for (const h of holes) { const k = `${h.z0},${h.z1}`; if (!runs.has(k)) runs.set(k, []); runs.get(k).push(h); }
    const cutters = [];
    for (const list of runs.values()) {
      const { z0, z1 } = list[0], b = E.body(`${name} ${list.length === 1 ? 'hole' : `${list.length} holes`}`, '#8b96a3', true);
      const O = [Z[0] * z0, Z[1] * z0, Z[2] * z0];
      sketchFeature(E, b, list.map((h) => h.c), z1 - z0, Rm, O, list.length === 1 ? `${name}: hole Ø${+(2 * list[0].c.r).toFixed(2)}, ${mm(z1 - z0)} deep` : `${name}: ${list.length} holes`, 'extrude');
      cutters.push(b);
    }
    if (cutters.length) E.push({ type: 'combine', op: 'subtract', name: `${name}: cut the holes`, body: ids[0], tools: cutters });
    E.done();
    // the same as the STEP part? (its volume, built by the engine from the new steps)
    const check = build({ vars: [], bodies: doc.bodies, features: doc.features });
    const built = check.meshes.get(ids[0]);
    if (!built || Object.keys(check.errors).length || Math.abs(built.volume() - volume) > Math.max(0.01, volume * 1e-3)) continue;
    const report = compareResult(mf, mesh, [built], []);
    return {
      features: doc.features, bodies: doc.bodies, seq: doc.seq, errors: {}, report, exact: true,
      parts: [{ pi: 0, name, body: ids[0], volume, error: 0, steps: doc.features.length, mesh: false, from: 0, to: doc.features.length }],
    };
  }
  return null;
}

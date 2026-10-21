// Geometry engine: evaluates the parametric history.
// Solid (B-rep) bodies use OpenCascade via replicad. Threads and imported meshes use
// Manifold (fast, robust mesh booleans). Mixing the two converts the solid to a mesh.
import * as SG from './sketchgeom.js';
import * as R from 'replicad';
import { Matrix4, Vector3, Quaternion, Euler } from 'three';
import { threadRodMesh } from './threadmesh.js';
import { evalExpr, varScope, EXTRUSIONS, EXTRUSION_ALIAS, SLOT_HALF, JOIN_CAVITY } from './shared.js';

let MF = null; // manifold wasm module
export function setManifoldModule(m) { MF = m; }

const shapeCache = new Map(); // key -> body value {shape}|{mf}|{parts}
const meshCache = new Map(); // key -> display payload
const importCache = new Map(); // fileId -> Manifold
const stepShapes = new Map(); // fileId -> solid read from a STEP file
export function hasStep(id) { return stepShapes.has(id); }
export function registerStep(id, shape) { stepShapes.set(id, shape); stepPartCache.delete(id); }
// the separate solids inside a STEP file (an assembly has several), in file order
export function countSolids(shape) {
  const oc = R.getOC();
  const ex = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let n = 0; for (; ex.More(); ex.Next()) n++;
  ex.delete();
  return n;
}
const stepPartCache = new Map();
export function stepParts(id) {
  if (stepPartCache.has(id)) return stepPartCache.get(id);
  const sh = stepShapes.get(id); if (!sh) return null;
  const oc = R.getOC();
  const parts = [];
  const ex = new oc.TopExp_Explorer(sh.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) parts.push(R.cast(ex.Current()));
  ex.delete();
  if (!parts.length) parts.push(sh);
  stepPartCache.set(id, parts);
  return parts;
}

export function hash(str) {
  let h1 = 0xdeadbeef ^ str.length, h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

class UserError extends Error {}
const fail = (msg) => { throw new UserError(msg); };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.sqrt(dot(a, a));

// ---------- body helpers (a body value is {shape} for solids or {mf} for meshes) ----------
// Exact bounds are slow on huge imported models, so big ones use a quick estimate
function faceCount(shape) {
  const oc = R.getOC();
  const ex = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  let n = 0; for (; ex.More(); ex.Next()) n++;
  ex.delete();
  return n;
}
export function solidBounds(shape) {
  if (faceCount(shape) <= 400) return shape.boundingBox.bounds;
  const oc = R.getOC(); const b = new oc.Bnd_Box();
  try {
    oc.BRepBndLib.Add(shape.wrapped, b, true);
    const a = b.CornerMin(), c = b.CornerMax();
    return [[a.X(), a.Y(), a.Z()], [c.X(), c.Y(), c.Z()]];
  } finally { b.delete(); }
}
function bbOf(v) {
  if (v.mf) { const b = v.mf.boundingBox(); return [[...b.min], [...b.max]]; }
  return solidBounds(v.shape);
}
function freeValue(v) {
  try { if (v.mf) v.mf.delete(); else if (v.shape) v.shape.delete(); else if (v.parts) { freeValue(v.parts[0]); freeValue(v.parts[1]); } } catch { /* already gone */ }
}

function mfFromArrays(vertices, triangles) {
  // merge coincident vertices so the mesh is closed
  const map = new Map(); const out = []; const remap = new Uint32Array(vertices.length / 3);
  for (let i = 0; i < vertices.length / 3; i++) {
    const x = vertices[3 * i], y = vertices[3 * i + 1], z = vertices[3 * i + 2];
    const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let j = map.get(k);
    if (j === undefined) { j = out.length / 3; map.set(k, j); out.push(x, y, z); }
    remap[i] = j;
  }
  const tri = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const a = remap[triangles[i]], b = remap[triangles[i + 1]], c = remap[triangles[i + 2]];
    if (a !== b && b !== c && a !== c) tri.push(a, b, c);
  }
  let m;
  try {
    m = new MF.Manifold(new MF.Mesh({ numProp: 3, vertProperties: new Float32Array(out), triVerts: new Uint32Array(tri) }));
  } catch {
    fail('This model is not a closed (watertight) shape, so it cannot be used.');
  }
  return m;
}

const mfConvCache = new Map(); // body key -> Manifold
function asMf(v, key) {
  if (v.mf) return v.mf;
  let m = mfConvCache.get(key);
  if (m) return m;
  const bb = solidBounds(v.shape);
  const diag = len3(sub(bb[1], bb[0])) || 1;
  const me = v.shape.mesh({ tolerance: Math.max(0.005, diag / 2500), angularTolerance: 0.15 });
  m = mfFromArrays(me.vertices, me.triangles);
  mfConvCache.set(key, m);
  return m;
}

function needSolid(v, what) {
  if (!v.shape) fail(`${what} only works on solid shapes. This object became a mesh when it was combined with a thread or an imported model. Do the ${what.toLowerCase()} before combining.`);
  return v.shape;
}

// Moving or turning a solid only changes where it sits, so it is done by attaching a placement to the
// shape instead of copying all of its geometry (instant even for huge STEP models). Only scaling, which
// placements cannot do, rebuilds the geometry.
function placeSolid(shape, M) {
  const oc = R.getOC();
  const t = new Vector3(), q = new Quaternion(), sc = new Vector3();
  M.decompose(t, q, sc);
  const k = (sc.x + sc.y + sc.z) / 3;
  let base = shape;
  let rigid = M;
  if (Math.abs(k - 1) > 1e-9) {
    base = shape.clone().scale(k, [0, 0, 0]);
    rigid = new Matrix4().compose(t, q, new Vector3(1, 1, 1));
  }
  const e = rigid.elements;
  const tr = new oc.gp_Trsf();
  try {
    tr.SetValues(e[0], e[4], e[8], e[12], e[1], e[5], e[9], e[13], e[2], e[6], e[10], e[14]);
    const loc = new oc.TopLoc_Location(tr);
    const moved = R.cast(base.wrapped.Moved(loc, false));
    loc.delete();
    if (base !== shape) base.delete();
    return moved;
  } finally { tr.delete(); }
}
// shapes that build their own stretched (oval) version; the rest are stretched afterwards
const STRETCH_BUILT = new Set(['sketch', 'box', 'wedge', 'cyl', 'sphere', 'cone', 'pyramid', 'tube', 'prism', 'text', 'extrusion', 'washer', 'standoff', 'insert']);
const isEven = (sc) => Math.abs(sc.x - sc.y) < 1e-9 && Math.abs(sc.y - sc.z) < 1e-9;
// A solid turned into a mesh: needed only to stretch a combined solid unevenly, which the solid kernel here cannot do.
function solidToMf(shape) {
  const bb = solidBounds(shape);
  const diag = len3(sub(bb[1], bb[0])) || 1;
  const me = shape.mesh({ tolerance: Math.max(0.005, diag / 2500), angularTolerance: 0.15 });
  return mfFromArrays(me.vertices, me.triangles);
}
function stretchValue(v, [sx, sy, sz]) {
  if (v.mf) return { mf: v.mf.scale([sx, sy, sz]) };
  if (Math.abs(sx - sy) < 1e-9 && Math.abs(sy - sz) < 1e-9) return { shape: v.shape.clone().scale(sx, [0, 0, 0]) };
  const m = solidToMf(v.shape);
  const out = m.scale([sx, sy, sz]); m.delete();
  return { mf: out };
}
/** Apply a 4x4 matrix (three.js Matrix4) to a body value; returns a new value. */
function transformV(v, M) {
  if (v.mf) return { mf: v.mf.transform(M.elements) };
  const t = new Vector3(), q = new Quaternion(), sc = new Vector3();
  M.decompose(t, q, sc);
  if (!isEven(sc)) { const m = solidToMf(v.shape); const out = m.transform(M.elements); m.delete(); return { mf: out }; }
  return { shape: placeSolid(v.shape, M) };
}
const translateV = (v, d) => transformV(v, new Matrix4().makeTranslation(d[0], d[1], d[2]));
function rotateV(v, rot, c) {
  const d2r = Math.PI / 180;
  const R3 = new Matrix4().makeRotationFromEuler(new Euler(rot[0] * d2r, rot[1] * d2r, rot[2] * d2r, 'ZYX'));
  return transformV(v, new Matrix4().makeTranslation(c[0], c[1], c[2]).multiply(R3).multiply(new Matrix4().makeTranslation(-c[0], -c[1], -c[2])));
}
function boolV(op, a, akey, b, bkey) {
  if (a.shape && b.shape) {
    const s = a.shape.clone();
    if (op === 'add') return { shape: s.fuse(b.shape.clone()) };
    if (op === 'sub') return { shape: s.cut(b.shape.clone()) };
    return { shape: s.intersect(b.shape.clone()) };
  }
  const ma = asMf(a, akey), mb = asMf(b, bkey);
  if (op === 'add') return { mf: ma.add(mb) };
  if (op === 'sub') return { mf: ma.subtract(mb) };
  return { mf: ma.intersect(mb) };
}
function mirrorV(v, ax, o) {
  if (v.mf) {
    const n = [0, 0, 0]; n[ax] = 1;
    return { mf: v.mf.translate([-o[0], -o[1], -o[2]]).mirror(n).translate(o) };
  }
  return { shape: v.shape.clone().mirror(['YZ', 'XZ', 'XY'][ax], o) };
}

// ---------- primitives ----------
const revolveProfile = (pts) => {
  let pen = R.draw(pts[0]);
  for (const q of pts.slice(1)) pen = pen.lineTo(q);
  return pen.close().sketchOnPlane('XZ').revolve([0, 0, 1]);
};

const LABELS = { w: 'Width', d: 'Diameter', h: 'Height', D: 'Diameter', P: 'Pitch', len: 'Length', od: 'Outer diameter', id: 'Inner diameter', af: 'Width across flats', size: 'Letter height', depth: 'Thickness', headH: 'Head height', nutH: 'Nut height' };
const labelOf = (k) => LABELS[k] || k;

// st: stretch along the shape's own X, Y and Z (1 = none). Round shapes stretched unevenly become ovals.
function buildPrimitive(kind, p, num, ctx, st = [1, 1, 1]) {
  const pos = (k, min = 0.001) => { const v = num(p[k]); if (!(v >= min)) fail(`${labelOf(k)} must be at least ${min}`); return v; };
  const [sx, sy, sz] = st;
  const even = Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9;
  const flat = (d) => (even ? d : d.stretch(sx, [0, 1], [0, 0]).stretch(sy, [1, 0], [0, 0])); // stretch a 2D outline (the direction given is the axis it stretches away from)
  const up = (d, h) => ({ shape: flat(d).sketchOnPlane('XY').extrude(h * sz) }); // stand a 2D outline up
  switch (kind) {
    case 'box': {
      const w = pos('w') * sx, d = pos('d') * sy, h = pos('h') * sz;
      let s = R.makeBaseBox(w, d, h);
      const r = num(p.round ?? 0);
      if (r > 0) {
        const mode = p.roundMode || 'all';
        const lim = (mode === 'vertical' ? Math.min(w, d) : Math.min(w, d, h)) / 2 - 0.01;
        if (r >= lim) fail(`Round edges must be less than ${lim.toFixed(2)}`);
        if (mode === 'all') s = s.fillet(r);
        else if (mode === 'vertical') s = s.fillet(r, (e) => e.inDirection('Z'));
        else s = s.fillet(r, (e) => e.inPlane('XY', h));
      }
      return { shape: s };
    }
    case 'cyl': return even ? { shape: R.makeCylinder(pos('d') / 2, pos('h') * sz) } : up(R.drawCircle(pos('d') / 2), pos('h'));
    case 'sphere': {
      const r = pos('d') / 2;
      return even && Math.abs(sz - 1) < 1e-9 ? { shape: R.makeSphere(r) } : { shape: R.makeEllipsoid(r * sx, r * sy, r * sz) };
    }
    case 'cone': {
      const r1 = num(p.d1) / 2, r2 = num(p.d2) / 2, h = pos('h') * sz;
      if (r1 < 0 || r2 < 0 || (r1 === 0 && r2 === 0)) fail('At least one diameter must be above 0');
      if (!even) {
        // oval cone: loft between two oval outlines (or to a point)
        if (r1 > 0 && r2 > 0) return { shape: flat(R.drawCircle(r1)).sketchOnPlane('XY').loftWith(flat(R.drawCircle(r2)).sketchOnPlane('XY', h), { ruled: true }) };
        if (r1 > 0) return { shape: flat(R.drawCircle(r1)).sketchOnPlane('XY').loftWith([], { endPoint: [0, 0, h], ruled: true }) };
        return { shape: flat(R.drawCircle(r2)).sketchOnPlane('XY', h).loftWith([], { endPoint: [0, 0, 0], ruled: true }) };
      }
      const pts = [[0, 0]];
      if (r1 > 0) pts.push([r1, 0]);
      pts.push([r2, h]);
      if (r2 > 0) pts.push([0, h]);
      return { shape: revolveProfile(pts) };
    }
    case 'torus': {
      const D = pos('D'), d = pos('d');
      if (d >= D) fail('Tube diameter must be smaller than ring diameter');
      return { shape: R.drawCircle(d / 2).translate(D / 2 - d / 2, 0).sketchOnPlane('XZ').revolve([0, 0, 1]) };
    }
    case 'wedge': {
      const w = pos('w') * sx, d = pos('d') * sy, h = pos('h') * sz;
      return { shape: R.draw([0, 0]).lineTo([w, 0]).lineTo([0, h]).close().sketchOnPlane('XZ').extrude(d) };
    }
    case 'pyramid': {
      const n = Math.round(num(p.n)); if (n < 3 || n > 64) fail('Sides must be 3 to 64');
      const d = pos('d'), h = pos('h');
      return { shape: flat(R.drawPolysides(d / 2, n)).sketchOnPlane('XY').loftWith([], { endPoint: [0, 0, h * sz], ruled: true }) };
    }
    case 'tube': {
      const od = pos('od'), id = pos('id'), h = pos('h');
      if (id >= od) fail('Inner diameter must be smaller than outer');
      return up(R.drawCircle(od / 2).cut(R.drawCircle(id / 2)), h);
    }
    case 'prism': {
      const n = Math.round(num(p.n)); if (n < 3 || n > 128) fail('Sides must be 3 to 128');
      const af = pos('af'), h = pos('h');
      const rc = af / 2 / Math.cos(Math.PI / n);
      return up(R.drawPolysides(rc, n).rotate(n % 2 === 0 ? 180 / n : 0), h);
    }
    case 'text': {
      const t = String(p.text ?? '').trim(); if (!t) fail('Type some text');
      const size = pos('size'), depth = pos('depth');
      const font = ctx.fonts.has(p.font) ? p.font : 'sans';
      // drawText's fontSize is the em size; scale so capital letters come out near "size"
      return up(R.drawText(t, { fontSize: size * 1.37, fontFamily: font }), depth);
    }
    case 'thread': return { mf: buildThread(p, num, pos) };
    // ---- hardware (all stand on the floor, centered, pointing up; holes open at the top)
    case 'washer': {
      const id = pos('id'), od = pos('od');
      if (id >= od) fail('Inner diameter must be smaller than outer');
      return up(R.drawCircle(od / 2).cut(R.drawCircle(id / 2)), pos('t'));
    }
    case 'standoff': {
      const hole = num(p.hole), od = pos('od');
      if (hole >= od) fail('Hole must be smaller than the outer diameter');
      return up(hole > 0 ? R.drawCircle(od / 2).cut(R.drawCircle(hole / 2)) : R.drawCircle(od / 2), pos('h'));
    }
    case 'insert': return up(R.drawCircle(pos('d') / 2), pos('depth'));
    case 'screwhole': {
      const r = pos('d') / 2, L = pos('len');
      let pts = [[0, 0], [r, 0], [r, L], [0, L]];
      if (p.head === 'countersunk') {
        const rh = pos('hd') / 2; if (rh <= r) fail('Countersink must be wider than the hole');
        if (L <= rh - r) fail('Make the hole deeper than the countersink');
        pts = [[0, 0], [r, 0], [r, L - (rh - r)], [rh, L], [0, L]];
      } else if (p.head === 'counterbore') {
        const rc = pos('cb') / 2, k = pos('hk'); if (rc <= r) fail('Counterbore must be wider than the hole');
        if (k >= L) fail('Make the hole deeper than the counterbore');
        pts = [[0, 0], [r, 0], [r, L - k], [rc, L - k], [rc, L], [0, L]];
      }
      return { shape: revolveProfile(pts) };
    }
    case 'nuttrap': {
      const L = pos('len'), m = pos('m'), af = pos('af');
      if (m >= L) fail('Make the screw hole deeper than the nut pocket');
      const hex = R.drawPolysides(af / 2 / Math.cos(Math.PI / 6), 6).sketchOnPlane('XY', L - m).extrude(m);
      return { shape: hex.fuse(R.makeCylinder(pos('d') / 2, L)) };
    }
    // ---- ready-made parts (plain solids: no thread detail). Screws stand on the tip, head up.
    case 'screw': {
      const r = pos('d') / 2, L = pos('len'), t = p.type || 'socket';
      const sKey = num(p.s);
      const hexR = (af) => af / 2 / Math.cos(Math.PI / 6);
      const socket = (top, depth) => (sKey > 0 ? R.drawPolysides(hexR(sKey), 6).sketchOnPlane('XY', top - depth).extrude(depth + 0.01) : null);
      if (t === 'set') {
        let s = R.makeCylinder(r, L); const sk = socket(L, Math.min(L * 0.6, 2.5 * sKey)); if (sk) s = s.cut(sk);
        return { shape: s };
      }
      const dk = t === 'hex' ? sKey : pos('dk'), k = pos('k');
      if (t === 'flat') {
        if (dk / 2 <= r) fail('Head must be wider than the thread');
        const cone = Math.min(L, (dk / 2 - r) / Math.tan(Math.PI / 4)); // 90° countersink
        let s = revolveProfile([[0, 0], [r, 0], [r, L - cone], [dk / 2, L], [0, L]]);
        const sk = socket(L, Math.min(k * 0.9, cone)); if (sk) s = s.cut(sk);
        return { shape: s };
      }
      let head;
      if (t === 'hex') head = R.drawPolysides(hexR(sKey), 6).sketchOnPlane('XY', L).extrude(k);
      else if (t === 'button') {
        // a low dome
        const pts = [[0, L], [dk / 2, L]];
        for (let i = 1; i <= 12; i++) { const a = (i / 12) * (Math.PI / 2); pts.push([(dk / 2) * Math.cos(a), L + k * Math.sin(a)]); }
        head = revolveProfile(pts.slice(0, -1).concat([[0, L + k]]));
      } else head = R.makeCylinder(dk / 2, k, [0, 0, L]);
      let s = R.makeCylinder(r, L + 0.01).fuse(head);
      if (t !== 'hex') { const sk = socket(L + k, k * (t === 'button' ? 0.55 : 0.6)); if (sk) s = s.cut(sk); }
      return { shape: s };
    }
    case 'nut': {
      const af = pos('af'), m = pos('m'), r = pos('d') / 2;
      if (r * 2 >= af) fail('Hole must be smaller than the nut');
      const hexR = af / 2 / Math.cos(Math.PI / 6);
      let s;
      if (p.type === 'nylock') {
        const hm = m * 0.72;
        s = R.drawPolysides(hexR, 6).sketchOnPlane('XY').extrude(hm).fuse(R.makeCylinder(af * 0.46, m - hm + 0.01, [0, 0, hm - 0.01]));
      } else s = R.drawPolysides(hexR, 6).sketchOnPlane('XY').extrude(m);
      return { shape: s.cut(R.makeCylinder(r, m + 2, [0, 0, -1])) };
    }
    case 'bearing': {
      const ri = pos('id') / 2, ro = pos('od') / 2, w = pos('w'), fd = num(p.fd), ft = num(p.ft);
      if (ri >= ro) fail('Bore must be smaller than the outside');
      let s = R.makeCylinder(ro, w).cut(R.makeCylinder(ri, w + 2, [0, 0, -1]));
      if (fd > ro * 2 && ft > 0) s = s.fuse(R.makeCylinder(fd / 2, ft, [0, 0, w - ft]).cut(R.makeCylinder(ri, w + 2, [0, 0, -1])));
      if (!String(p.size || '').startsWith('LM')) {
        // the shields between the inner and outer rings, set in a little
        const a = ri + (ro - ri) * 0.28, b = ro - (ro - ri) * 0.18, dep = Math.min(0.3, w * 0.08);
        if (b > a) {
          const ring = (z) => R.makeCylinder(b, dep, [0, 0, z]).cut(R.makeCylinder(a, dep + 1, [0, 0, z - 0.5]));
          s = s.cut(ring(-0.0)).cut(ring(w - dep));
        }
      }
      return { shape: s };
    }
    case 'pin': {
      const r = pos('d') / 2, L = pos('len'), c = Math.min(r * 0.25, 0.4);
      return { shape: revolveProfile([[0, 0], [r - c, 0], [r, c], [r, L - c], [r - c, L], [0, L]]) };
    }
    case 'rod': return { shape: R.makeCylinder(pos('d') / 2, pos('len')) };
    case 'magnet': return { shape: R.makeCylinder(pos('d') / 2, pos('h')) };
    case 'hexstandoff': {
      const af = pos('af'), L = pos('len'), r = pos('d') / 2;
      let s = R.drawPolysides(af / 2 / Math.cos(Math.PI / 6), 6).sketchOnPlane('XY').extrude(L);
      if (p.male) {
        s = s.cut(R.makeCylinder(r, Math.min(L * 0.6, 8) + 1, [0, 0, L - Math.min(L * 0.6, 8)]));
        s = s.fuse(R.makeCylinder(r, pos('stud') + 0.01, [0, 0, -pos('stud')]));
      } else s = s.cut(R.makeCylinder(r, L + 2, [0, 0, -1]));
      return { shape: s };
    }
    case 'sketch': {
      // outlines inside other outlines are holes (inside a hole again: solid, and so on)
      const loops = (p.loops || []).filter((l) => SG.isSolidLoop(l) && (l.type === 'circle' ? +l.r > 0 : l.pts?.length >= 3 || (l.pts?.length === 2 && l.bulge?.some((b) => +b))));
      if (!loops.length) fail('The sketch has no closed outline');
      const shape = (l) => {
        if (l.type === 'circle') return R.drawCircle(num(l.r)).translate(num(l.c[0]), num(l.c[1]));
        const { pts, bulge } = SG.expandLoop({ ...l, pts: l.pts.map((q) => [num(q[0]), num(q[1])]) });
        let pen = R.draw(pts[0]);
        for (let i = 0; i < pts.length; i++) {
          const A = pts[i], B = pts[(i + 1) % pts.length];
          if (i === pts.length - 1) { if (Math.abs(bulge[i]) > 1e-9) pen = pen.threePointsArcTo(B, SG.arcMid(A, B, bulge[i])); break; }
          pen = Math.abs(bulge[i]) > 1e-9 ? pen.threePointsArcTo(B, SG.arcMid(A, B, bulge[i])) : pen.lineTo(B);
        }
        return pen.close();
      };
      if (p.mode === 'loft') {
        // from the first outline (bottom) to the second (top), changing shape smoothly over the height
        if (loops.length !== 2) fail('For Loft, draw exactly two outlines: the bottom shape first, then the top shape');
        const [A, B] = p.flip ? [loops[1], loops[0]] : loops;
        const h = pos('h');
        const s1 = flat(shape(A)).sketchOnPlane('XY'), s2 = flat(shape(B)).sketchOnPlane('XY', h * sz);
        return { shape: s1.loftWith(s2, { ruled: !!p.ruled }) };
      }
      if (p.mode === 'sweep') {
        // the outline (holes included) is carried along a path made of helper lines joined end to end
        const segs = (p.loops || []).filter((l) => l.type === 'line' && l.pts?.length === 2);
        if (!segs.length) fail('For Sweep, draw the path with Helper lines, joined end to end');
        const key = (q) => `${Math.round(num(q[0]) * 1000)},${Math.round(num(q[1]) * 1000)}`;
        const ends = new Map();
        segs.forEach((l, i) => { for (const k of [0, 1]) { const kk = key(l.pts[k]); if (!ends.has(kk)) ends.set(kk, []); ends.get(kk).push([i, k]); } });
        let start = [...ends.values()].find((v) => v.length === 1)?.[0] || [0, 0];
        const used = new Set(), path = [];
        let [i, k] = start;
        while (i != null && !used.has(i)) {
          used.add(i); const l = segs[i], a = l.pts[k], b = l.pts[1 - k];
          let bulge = +(l.bulge?.[0] || 0); if (k === 1) bulge = -bulge; // walking the line backwards flips its bend
          if (!path.length) path.push([num(a[0]), num(a[1])]);
          path.push({ to: [num(b[0]), num(b[1])], bulge });
          const next = (ends.get(key(b)) || []).find(([j]) => !used.has(j));
          [i, k] = next || [null, null];
        }
        if (used.size !== segs.length) fail('For Sweep, the helper lines must make one path, joined end to end (no branches)');
        let pen = R.draw(path[0]);
        for (let s2 = 1; s2 < path.length; s2++) {
          const A = s2 === 1 ? path[0] : path[s2 - 1].to, st = path[s2];
          pen = Math.abs(st.bulge) > 1e-9 ? pen.threePointsArcTo(st.to, SG.arcMid(A, st.to, st.bulge)) : pen.lineTo(st.to);
        }
        const spine = pen.done().sketchOnPlane('XY');
        // the profile: the outlines, centered on the path's start, standing across the path
        const sortedP = loops.slice().sort((a, b) => SG.loopArea(b) - SG.loopArea(a));
        let prof = null;
        for (const l of sortedP) {
          const depth = sortedP.filter((o) => o !== l && SG.loopArea(o) > SG.loopArea(l) && SG.loopInside(o, l)).length;
          const s3 = shape(l); prof = !prof ? s3 : depth % 2 ? prof.cut(s3) : prof.fuse(s3);
        }
        const bb = SG.loopsBounds(loops), cx = (bb[0] + bb[2]) / 2, cy = (bb[1] + bb[3]) / 2;
        prof = prof.translate(-cx, -cy);
        const solid = spine.sweepSketch((plane, origin) => prof.clone().sketchOnPlane(plane, origin), { transitionMode: 'round', frenet: true });
        return { shape: solid };
      }
      const sorted = loops.slice().sort((a, b) => SG.loopArea(b) - SG.loopArea(a));
      let d = null;
      for (const l of sorted) {
        const depth = sorted.filter((o) => o !== l && SG.loopArea(o) > SG.loopArea(l) && SG.loopInside(o, l)).length;
        const s = shape(l);
        d = !d ? s : depth % 2 ? d.cut(s) : d.fuse(s);
      }
      if (p.mode === 'revolve') {
        const ang = num(p.angle ?? 360);
        if (!(ang > 0 && ang <= 360)) fail('Turn angle must be between 0 and 360');
        const b = SG.loopsBounds(loops);
        const tol = 0.05; // a hair over the line (from rounding or a slightly turned drawing) is trimmed off
        if (b[0] < -tol && b[2] > tol) fail('For Spin around, keep the whole outline on one side of the green line. Tip: pick the corner that should sit on the green line and click Move to center.');
        let prof = d;
        if (b[0] < -1e-9 && b[2] > 1e-9) {
          const big = 4 * Math.max(Math.abs(b[0]), Math.abs(b[2]), Math.abs(b[1]), Math.abs(b[3]), 1);
          const keepRight = b[2] > -b[0];
          prof = d.intersect(R.drawRectangle(big, big * 2).translate(keepRight ? big / 2 : -big / 2, (b[1] + b[3]) / 2));
        }
        const solid = flat(prof).sketchOnPlane('XZ').revolve([0, 0, 1], { angle: ang });
        return { shape: solid };
      }
      return up(d, pos('h'));
    }
    case 'extrusion': {
      const e = EXTRUSIONS[p.size] || EXTRUSIONS[EXTRUSION_ALIAS[p.size]]; if (!e) fail('Unknown profile');
      return up(extrusionProfile(e), pos('len'));
    }
    case 'import': {
      if (p.fmt === 'step') {
        const sh = p.part == null ? stepShapes.get(p.file) : stepParts(p.file)?.[p.part];
        if (!sh) fail('The STEP file could not be read');
        return { shape: sh.clone() };
      }
      return { mf: ctx.getImport(p.file).translate([0, 0, 0]) };
    }
    default: fail(`Unknown shape ${kind}`);
  }
}

// A polygon (list of [x, y]) as a drawing, optionally mirrored across the x axis, turned by `deg` and moved to (x, y).
function poly(pts, { mirror = false, deg = 0, x = 0, y = 0 } = {}) {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const q = pts.map(([px, py]) => { const my = mirror ? -py : py; return [px * c - my * s + x, px * s + my * c + y]; });
  let d = R.draw(q[0]);
  for (const pt of q.slice(1)) d = d.lineTo(pt);
  return d.close();
}
// Cross-section of a 20 mm-grid extrusion. Same layout rules as the bd_vslot library: an outside face gets a slot,
// a face joined to another cell gets the matching hollow.
function extrusionProfile(e) {
  const cells = e.cells, nx = cells.length, ny = cells[0].length;
  const has = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && !!cells[i][j];
  const slotHalf = SLOT_HALF[e.kind];
  // the half outline runs from the slot bottom (on the axis) out to the face (on the axis); add its mirror image back
  const slot = [...slotHalf, ...slotHalf.slice(1, -1).reverse().map(([a, b]) => [a, -b])];
  const W = nx * 20, D = ny * 20;
  let prof = e.kind === 't' ? R.drawRoundedRectangle(W, D, 1.5) : R.drawRectangle(W, D);
  prof = prof.translate((nx - 1) * 10, (ny - 1) * 10);
  const cut = (pts, o) => { prof = prof.cut(poly(pts, o)); };
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (!has(i, j)) continue;
    const x = 20 * i, y = 20 * j;
    prof = prof.cut(R.drawCircle(2.1).translate(x, y));
    [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([di, dj], n) => {
      const at = { deg: 90 * n, x, y };
      if (!has(i + di, j + dj)) { cut(slot, at); return; }
      // the two halves of the join hollow depend on what sits diagonally next to this cell
      const sides = di ? [[j + di, false], [j - di, true]] : [[i + dj, true], [i - dj, false]];
      for (const [k, mirror] of sides) {
        const side = di ? has(i, k) : has(k, j);
        const diag = di ? has(i + di, k) : has(k, j + dj);
        cut(JOIN_CAVITY[!side ? 'edge' : diag ? 'center' : 'corner'], { ...at, mirror });
      }
    });
  }
  return prof;
}

function mfRod(D, P, len, clear) {
  const t = threadRodMesh({ D, P, len, clear });
  const m = new MF.Manifold(new MF.Mesh({ numProp: 3, vertProperties: t.verts, triVerts: t.tris }));
  return { m, ...t };
}
const mfRevolve = (pts, seg = 96) => MF.Manifold.revolve([pts], seg);

function buildThread(p, num, pos) {
  const D = pos('D', 0.5), P = pos('P', 0.1), clear = num(p.clear ?? 0);
  if (P > D / 2) fail('Pitch is too large for this diameter');
  const kind = p.kind || 'bolt';
  const tmp = [];
  const keep = (m) => { tmp.push(m); return m; };
  try {
    if (kind === 'bolt') {
      const len = pos('len', P);
      const rod = mfRod(D, P, len, -clear); keep(rod.m);
      const noHead = !p.head || p.head === 'none';
      let res = rod.m;
      if (p.chamfer) {
        const c = rod.depth * 1.15, R0 = rod.rMaj + 0.05;
        const bot = noHead ? [[0, -0.1], [R0 - c - 0.1, -0.1], [R0, c]] : [[0, -0.1], [R0, -0.1]];
        const env = keep(mfRevolve([...bot, [R0, len - c], [R0 - c - 0.1, len + 0.1], [0, len + 0.1]]));
        res = keep(res.intersect(env));
      }
      if (!noHead) {
        const hh = pos('headH'), af = pos('af');
        if (af <= D) fail('Head must be wider than the thread');
        let head;
        if (p.head === 'hex') {
          const rc = af / 2 / Math.cos(Math.PI / 6);
          const hex = keep(MF.Manifold.cylinder(hh, rc, rc, 6).rotate([0, 0, 30]));
          const ch = rc - af / 2 + 0.2;
          head = keep(hex.intersect(keep(mfRevolve([[0, -0.1], [rc + 0.1, -0.1], [rc + 0.1, hh - ch], [af / 2 - 0.2, hh + 0.01], [0, hh + 0.01]]))));
        } else {
          const r = af / 2, f = Math.min(hh / 3, af / 8);
          const pts = [[0, 0], [r, 0], [r, hh - f]];
          for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); pts.push([r - f + f * Math.cos(a), hh - f + f * Math.sin(a)]); }
          pts.push([0, hh]);
          head = keep(mfRevolve(pts, 96));
        }
        return keep(res.translate([0, 0, hh - 0.01])).add(head);
      }
      return res.translate([0, 0, 0]);
    }
    const len = kind === 'nut' ? pos('nutH') : pos('len', P);
    const rod = mfRod(D, P, len + 2 * P, clear); keep(rod.m);
    let cutter = keep(rod.m.translate([0, 0, -P]));
    if (p.chamfer) {
      const cs = rod.depth * 1.2, rA = rod.rMaj + cs, rc = rod.rMin * 0.8;
      const sink = keep(mfRevolve([[0, -0.05], [rA, -0.05], [rc, rA - rc - 0.05], [rc, len - (rA - rc) + 0.05], [rA, len + 0.05], [0, len + 0.05]]));
      cutter = keep(cutter.add(sink));
    }
    if (kind === 'cutter') return cutter.translate([0, 0, 0]);
    const af = pos('af');
    if (af <= D + 1) fail('Nut must be wider than the thread');
    const rc = af / 2 / Math.cos(Math.PI / 6), ch = rc - af / 2 + 0.2;
    const hex = keep(MF.Manifold.cylinder(len, rc, rc, 6).rotate([0, 0, 30]));
    const prof = keep(mfRevolve([[0, -0.1], [af / 2 - 0.2, -0.1], [rc + 0.1, ch], [rc + 0.1, len - ch], [af / 2 - 0.2, len + 0.1], [0, len + 0.1]]));
    const body = keep(hex.intersect(prof));
    return body.subtract(cutter);
  } finally {
    for (const m of tmp) { try { m.delete(); } catch { /* */ } }
  }
}

// ---------- topology references (solids only) ----------
function normCoord(p, bb) {
  return [0, 1, 2].map((i) => { const s = bb[1][i] - bb[0][i]; return s > 1e-6 ? (p[i] - bb[0][i]) / s : 0.5; });
}
function edgeInfo(shape) {
  return shape.edges.map((e) => {
    let m = [0, 0, 0], t = [0, 0, 1];
    try { m = e.pointAt(0.5).toTuple(); } catch { /* */ }
    try { t = e.tangentAt(0.5).toTuple(); } catch { /* */ }
    return { e, m, t };
  });
}
function faceInfo(shape) {
  return shape.faces.map((f) => {
    let c = [0, 0, 0], n = [0, 0, 1];
    try { c = f.center.toTuple(); } catch { /* */ }
    try { n = f.normalAt().toTuple(); } catch { /* */ }
    return { f, c, n };
  });
}
function matchRefs(items, refs, bb, dirKey, what) {
  return refs.map((ref) => {
    let best = null, bestD = Infinity;
    for (const it of items) {
      const dir = it[dirKey];
      const al = dot(dir, ref.d) / ((len3(dir) * len3(ref.d)) || 1);
      if ((dirKey === 't' ? Math.abs(al) : al) < 0.9) continue;
      const dd = len3(sub(normCoord(dirKey === 't' ? it.m : it.c, bb), ref.nc));
      if (dd < bestD) { bestD = dd; best = it; }
    }
    if (!best || bestD > 0.2) fail(`One of the picked ${what} no longer exists after an earlier change. Delete this step and pick again.`);
    return best;
  });
}

// ---------- evaluation ----------
export let lastState = new Map();

/**
 * Rebuild every body from the step list.
 * files: imported file bytes by id. ghostOf: id of the step being edited; objects that step uses
 * but that no longer exist at the end (like a groove shape cut out of a post) come back as see-through "ghosts".
 */
export function evaluate(doc, fonts, { files = {}, ghostOf = null } = {}) {
  const scope = varScope(doc.vars);
  const scopeKey = JSON.stringify(scope);
  const num = (v) => evalExpr(v, scope);
  const ctx = {
    fonts,
    getImport(fileId) {
      let m = importCache.get(fileId);
      if (m) return m;
      const bytes = files[fileId];
      if (!bytes) fail('The imported file is missing from this project');
      m = parseSTLToMf(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      importCache.set(fileId, m);
      return m;
    },
  };
  const gf = ghostOf && (doc.features || []).find((x) => x.id === ghostOf);
  const ghostIds = new Set(!gf ? [] : gf.type === 'combine' ? gf.tools : [gf.body, gf.body2].filter(Boolean));
  const ghostVals = new Map();
  const state = new Map(); // body -> {v, key}
  const errors = {};
  const touched = new Set();
  const timings = {};
  const heights = {};
  const bodyProps = doc.bodies || {};
  const t0 = Date.now();
  let curId = null;

  const cached = (key, fn) => {
    touched.add(key);
    const hit = shapeCache.get(key);
    if (hit) return hit;
    const ts = Date.now();
    const v = fn();
    timings[curId] = (timings[curId] || 0) + Date.now() - ts;
    shapeCache.set(key, v);
    return v;
  };
  const need = (id) => { const b = state.get(id); if (!b) fail('The object this step works on is missing (an earlier step failed or was turned off)'); return b; };
  const set = (id, v, key) => state.set(id, { v, key });
  // an object used up by a step (cut out, merged in, deleted); remembered when it may be shown as a ghost
  const consume = (id) => { const b = state.get(id); if (b && ghostIds.has(id)) ghostVals.set(id, b); state.delete(id); };

  for (const f of doc.features || []) {
    if (f.suppressed) continue;
    curId = f.id;
    try {
      const fj = JSON.stringify({ ...f, name: undefined, suppressed: undefined, id: undefined });
      switch (f.type) {
        case 'shape': {
          const key = hash('S' + fj + scopeKey);
          set(f.body, cached(key, () => {
            const st = (f.stretch || [1, 1, 1]).map(num);
            let v0 = buildPrimitive(f.kind, f.p || {}, num, ctx, st);
            if (!STRETCH_BUILT.has(f.kind) && st.some((x) => Math.abs(x - 1) > 1e-9)) { const v1 = stretchValue(v0, st); freeValue(v0); v0 = v1; }
            const bb = bbOf(v0);
            // a new shape sits centered on X/Y with its bottom on the floor; parts of an imported
            // assembly all share one offset (p.off) so they stay where they were relative to each other
            const off = f.p?.off || [-(bb[0][0] + bb[1][0]) / 2, -(bb[0][1] + bb[1][1]) / 2, -bb[0][2]];
            const h = bb[1][2] + off[2];
            const d2r = Math.PI / 180;
            const [rx, ry, rz] = (f.rot || [0, 0, 0]).map(num);
            const M = new Matrix4().makeTranslation(...(f.pos || [0, 0, 0]).map(num))
              .multiply(new Matrix4().makeTranslation(0, 0, h / 2))
              .multiply(new Matrix4().makeRotationFromEuler(new Euler(rx * d2r, ry * d2r, rz * d2r, 'ZYX')))
              .multiply(new Matrix4().makeTranslation(off[0], off[1], off[2] - h / 2));
            const v = transformV(v0, M);
            freeValue(v0);
            v.h = h;
            return v;
          }), key);
          heights[f.id] = state.get(f.body).v.h;
          break;
        }
        case 'copy': {
          const src = need(f.src);
          const key = hash('C' + fj + src.key + scopeKey);
          set(f.body, cached(key, () => translateV(src.v, (f.d || [0, 0, 0]).map(num))), key);
          break;
        }
        case 'move': {
          const b = need(f.body);
          const key = hash('M' + fj + b.key);
          set(f.body, cached(key, () => transformV(b.v, new Matrix4().fromArray(f.m))), key);
          break;
        }
        case 'combine': {
          const b = need(f.body);
          const tools = (f.tools || []).map((id) => ({ id, ...need(id) }));
          const holeSig = JSON.stringify([f.body, ...f.tools].map((id) => !!bodyProps[id]?.hole));
          const key = hash('B' + fj + b.key + tools.map((t) => t.key).join(',') + holeSig);
          set(f.body, cached(key, () => {
            const run = (op, list, base) => {
              let acc = base;
              for (const t of list) {
                const nv = boolV(op, acc.v, acc.key, t.v, t.key);
                if (acc.tmp) freeValue(acc.v);
                acc = { v: nv, key: hash(acc.key + op + t.key), tmp: true };
              }
              return acc;
            };
            const self = { id: f.body, ...b };
            let r;
            if (f.op === 'subtract') r = run('sub', tools, self);
            else if (f.op === 'intersect') r = run('int', tools, self);
            else {
              const all = [self, ...tools];
              const solids = all.filter((x) => !bodyProps[x.id]?.hole);
              const holes = all.filter((x) => bodyProps[x.id]?.hole);
              const base = solids.length ? solids : holes;
              r = run('add', base.slice(1), base[0]);
              if (solids.length && holes.length) r = run('sub', holes, r);
            }
            let v = r.tmp ? r.v : translateV(r.v, [0, 0, 0]);
            if (v.shape) { try { v = { shape: v.shape.simplify() }; } catch { /* keep */ } }
            if (v.mf && v.mf.isEmpty()) fail('The result is empty: the objects do not overlap.');
            return v;
          }), key);
          for (const t of f.tools) consume(t);
          break;
        }
        case 'fillet':
        case 'chamfer': {
          const b = need(f.body);
          const key = hash('F' + fj + b.key + scopeKey);
          set(f.body, cached(key, () => {
            const shape = needSolid(b.v, f.type === 'fillet' ? 'Fillet' : 'Chamfer');
            const r = num(f.r); if (!(r > 0)) fail('Size must be above 0');
            if (!f.edges?.length) fail('No edges picked');
            const picked = matchRefs(edgeInfo(shape), f.edges, bbOf(b.v), 't', 'edges').map((x) => x.e);
            const fn = (e) => (picked.some((q) => q.isSame(e)) ? r : null);
            try {
              return { shape: f.type === 'fillet' ? shape.clone().fillet(fn) : shape.clone().chamfer(fn) };
            } catch {
              fail(`The ${f.type} could not be made at this size. Try a smaller size or fewer edges.`);
            }
          }), key);
          break;
        }
        case 'shell': {
          const b = need(f.body);
          const key = hash('H' + fj + b.key + scopeKey);
          set(f.body, cached(key, () => {
            const shape = needSolid(b.v, 'Hollow');
            const t = num(f.t); if (!(t > 0)) fail('Wall thickness must be above 0');
            if (!f.faces?.length) {
              const oc = R.getOC();
              const mk = new oc.BRepOffsetAPI_MakeOffsetShape();
              const pr = new oc.Message_ProgressRange();
              mk.PerformByJoin(shape.wrapped, -t, 1e-3, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, pr);
              pr.delete();
              if (!mk.IsDone()) { mk.delete(); fail('Could not hollow at this thickness. Try a thinner wall.'); }
              const inner = R.cast(mk.Shape());
              mk.delete();
              let solid = inner;
              try { solid = R.makeSolid([inner]); } catch { /* already a solid */ }
              return { shape: shape.clone().cut(solid) };
            }
            const picked = matchRefs(faceInfo(shape), f.faces, bbOf(b.v), 'n', 'faces').map((x) => x.f);
            try {
              return { shape: shape.clone().shell(t, (finder) => finder.when(({ element }) => picked.some((q) => q.isSame(element)))) };
            } catch {
              fail('Could not hollow at this thickness. Try a thinner wall.');
            }
          }), key);
          break;
        }
        case 'mirror': {
          const b = need(f.body);
          const key = hash('R' + fj + b.key + scopeKey);
          set(f.body, cached(key, () => {
            const [mn, mx] = bbOf(b.v);
            const ax = { x: 0, y: 1, z: 2 }[f.axis || 'x'];
            const o = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
            if (f.at != null) o[ax] = num(f.at); // mirrored across a fixed plane (a mirror copy made as its own object)
            else if (f.copy) o[ax] = f.side === 'min' ? mn[ax] : mx[ax];
            const m = mirrorV(b.v, ax, o);
            if (!f.copy) return m;
            const r = boolV('add', b.v, b.key, m, key + 'm');
            freeValue(m);
            return r;
          }), key);
          break;
        }
        case 'array': {
          const b = need(f.body);
          const key = hash('A' + fj + b.key + scopeKey);
          set(f.body, cached(key, () => {
            const n = Math.round(num(f.n)); if (n < 2 || n > 200) fail('Count must be 2 to 200');
            let acc = translateV(b.v, [0, 0, 0]);
            for (let i = 1; i < n; i++) {
              let c;
              if (f.kind === 'circular') {
                const total = num(f.angle ?? 360);
                const step = Math.abs(Math.abs(total) - 360) < 1e-6 ? total / n : total / (n - 1);
                c = rotateV(b.v, [0, 0, step * i], [num(f.cx ?? 0), num(f.cy ?? 0), 0]);
              } else {
                const d = [num(f.dx ?? 0), num(f.dy ?? 0), num(f.dz ?? 0)];
                if (len3(d) < 1e-6) fail('Spacing cannot be zero');
                c = translateV(b.v, d.map((x) => x * i));
              }
              const nx = boolV('add', acc, key + 'acc' + i, c, key + 'c' + i);
              freeValue(acc); freeValue(c);
              acc = nx;
            }
            return acc;
          }), key);
          break;
        }
        case 'split': {
          const b = need(f.body);
          const key = hash('P' + fj + b.key + scopeKey);
          const val = cached(key, () => {
            const [mn, mx] = bbOf(b.v);
            let n, p;
            if (f.axis) {
              // older flat cuts: axis + absolute position
              const ax = { x: 0, y: 1, z: 2 }[f.axis];
              n = [0, 0, 0]; n[ax] = 1;
              p = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]; p[ax] = num(f.at);
            } else {
              const q = new Quaternion().setFromEuler(new Euler(num(f.roll ?? 0) * Math.PI / 180, num(f.pitch ?? 0) * Math.PI / 180, num(f.yaw ?? 0) * Math.PI / 180, 'ZYX'));
              const nv = new Vector3(0, 0, 1).applyQuaternion(q);
              n = nv.toArray();
              const off = num(f.off ?? 0);
              p = [(mn[0] + mx[0]) / 2 + n[0] * off, (mn[1] + mx[1]) / 2 + n[1] * off, (mn[2] + mx[2]) / 2 + n[2] * off];
            }
            // the plane must actually pass through the object
            const corners = [];
            for (const x of [mn[0], mx[0]]) for (const y of [mn[1], mx[1]]) for (const z of [mn[2], mx[2]]) corners.push(dot(sub([x, y, z], p), n));
            if (Math.min(...corners) >= -1e-6 || Math.max(...corners) <= 1e-6) fail('The cutting plane does not go through the object');
            if (b.v.mf) {
              const [above, below] = b.v.mf.splitByPlane(n, dot(n, p));
              return { parts: [{ mf: below }, { mf: above }] };
            }
            const big = len3(sub(mx, mn)) * 2 + 10;
            const nv = new Vector3(...n);
            const qq = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), nv);
            const ang = 2 * Math.acos(Math.min(1, Math.max(-1, qq.w)));
            const place = (s0) => {
              let s1 = s0;
              if (ang > 1e-9) { const sn = Math.sqrt(1 - qq.w * qq.w) || 1; s1 = s1.rotate((ang * 180) / Math.PI, [0, 0, 0], [qq.x / sn, qq.y / sn, qq.z / sn]); }
              return s1.translate(p);
            };
            const up = place(R.makeBox([-big, -big, 0], [big, big, big]));
            const down = place(R.makeBox([-big, -big, -big], [big, big, 0]));
            return { parts: [{ shape: b.v.shape.clone().intersect(down) }, { shape: b.v.shape.clone().intersect(up) }] };
          });
          const keep = f.keep || 'both';
          if (keep === 'below') set(f.body, val.parts[0], key + 'b');
          else if (keep === 'above') set(f.body, val.parts[1], key + 'a');
          else { set(f.body, val.parts[0], key + 'b'); set(f.body2, val.parts[1], key + 'a'); }
          break;
        }
        case 'emboss': {
          const b = need(f.body);
          const key = hash('emboss' + fj + b.key + scopeKey);
          set(f.body, cached(key, () => {
            const shape = needSolid(b.v, 'Emboss / engrave');
            const [hit] = matchRefs(faceInfo(shape), [f.face], bbOf(b.v), 'n', 'faces');
            if (hit.f.geomType !== 'PLANE') fail('Emboss / engrave needs a flat face.');
            const depth = num(f.depth), size = num(f.size);
            if (!(depth > 0 && size > 0)) fail('Artwork size and depth must be above 0.');
            let drawing;
            if (f.source === 'logo') {
              if (!f.logo?.shapes?.length || f.logo.shapes.length > 1000) fail('Choose a valid filled SVG logo.');
              let points = 0;
              const outline = (pts) => {
                if (!Array.isArray(pts) || pts.length < 3 || (points += pts.length) > 20000 || pts.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => !Number.isFinite(v)))) fail('The logo outline is invalid or too complex.');
                let pen = R.draw(pts[0].map((v) => v * size));
                for (const p of pts.slice(1)) pen = pen.lineTo(p.map((v) => v * size));
                return pen.close();
              };
              for (const s of f.logo.shapes) {
                let part = outline(s.outer);
                for (const hole of s.holes || []) part = part.cut(outline(hole));
                drawing = drawing ? drawing.fuse(part) : part;
              }
            } else {
              const text = String(f.text || '').trim(); if (!text) fail('Type some text.');
              if (text.length > 500) fail('Use 500 characters or fewer.');
              drawing = R.drawText(text, { fontFamily: fonts.has(f.font) ? f.font : 'sans', fontSize: size * 1.37 });
              const center = drawing.boundingBox.center;
              drawing = drawing.translate(-center[0], -center[1]);
            }
            drawing = drawing.rotate(num(f.angle ?? 0)).translate(num(f.u ?? 0), num(f.v ?? 0));
            const n = hit.n, cut = f.mode === 'cut', lift = cut ? 0.01 : -0.01;
            const xDir = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : (() => { const x = [-n[1], n[0], 0], l = len3(x); return x.map((v) => v / l); })();
            const plane = new R.Plane(hit.c.map((v, i) => v + n[i] * lift), xDir, n);
            let prism, slab, clipped;
            try {
              prism = drawing.sketchOnPlane(plane).extrude((cut ? -1 : 1) * (depth + 0.01));
              const direction = cut ? -1 : 1;
              slab = R.basicFaceExtrusion(hit.f, new R.Vector(n.map((v) => v * direction * (depth + 0.02)))).translate(n.map((v) => -v * direction * 0.01));
              clipped = prism.intersect(slab);
              if (!(R.measureVolume(clipped) > 1e-8)) fail('The artwork misses the face. Reduce its shift or size.');
              return { shape: cut ? shape.clone().cut(clipped) : shape.clone().fuse(clipped) };
            } finally {
              for (const s of new Set([clipped, slab, prism])) { try { s?.delete(); } catch { /* kernel owns a shared result */ } }
            }
          }), key);
          break;
        }
        case 'extrude': {
          const b = need(f.body);
          const key = hash('E' + fj + b.key + scopeKey);
          set(f.body, cached(key, () => {
            const shape = needSolid(b.v, 'Extrude on face');
            const [hit] = matchRefs(faceInfo(shape), [f.face], bbOf(b.v), 'n', 'faces');
            const n = hit.n, c = hit.c;
            const xDir = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : (() => { const v = [-n[1], n[0], 0]; const l = len3(v); return v.map((x) => x / l); })();
            const depth = num(f.depth); if (!(depth > 0)) fail('Depth must be above 0');
            const cut = f.mode === 'cut';
            const lift = cut ? 0.02 : -0.01;
            const plane = new R.Plane([c[0] + n[0] * lift, c[1] + n[1] * lift, c[2] + n[2] * lift], xDir, n);
            const u = num(f.u ?? 0), v = num(f.v ?? 0);
            let dr;
            if (f.prof === 'circle') dr = R.drawCircle(num(f.d) / 2);
            else if (f.prof === 'poly') { const k = Math.round(num(f.n)); if (k < 3) fail('Sides must be 3 or more'); dr = R.drawPolysides(num(f.d) / 2 / Math.cos(Math.PI / k), k); }
            else if (f.prof === 'slot') { const w = num(f.w), h = num(f.h); dr = R.drawRoundedRectangle(w, h, Math.min(w, h) / 2 - 0.001); }
            else dr = R.drawRectangle(num(f.w), num(f.h));
            dr = dr.translate(u, v);
            const total = depth + Math.abs(lift);
            const prism = dr.sketchOnPlane(plane).extrude(cut ? -total : total);
            return { shape: cut ? shape.clone().cut(prism) : shape.clone().fuse(prism) };
          }), key);
          break;
        }
        case 'pushpull': {
          const b = need(f.body);
          const key = hash('U' + fj + b.key + scopeKey);
          set(f.body, cached(key, () => {
            const shape = needSolid(b.v, 'Push/pull');
            const d = num(f.d);
            if (!d) fail('The distance cannot be 0');
            const [hit] = matchRefs(faceInfo(shape), [f.face], bbOf(b.v), 'n', 'faces');
            if (hit.f.geomType !== 'PLANE') fail('Push/pull works on flat faces. Delete this step and pick a flat face.');
            // sweep the face along its normal: out adds material, in (a negative distance) removes it
            const slab = R.basicFaceExtrusion(hit.f, new R.Vector(hit.n.map((x) => x * d)));
            try {
              return { shape: d > 0 ? shape.clone().fuse(slab) : shape.clone().cut(slab) };
            } catch {
              fail('Push/pull could not be done at this distance. Try a smaller one.');
            }
          }), key);
          break;
        }
        case 'delete': consume(f.body); break;
        default: fail(`Unknown step type ${f.type}`);
      }
    } catch (err) {
      errors[f.id] = err instanceof UserError ? err.message : `Failed: ${err?.message || err}`;
    }
  }

  lastState = state;
  for (const [k, v] of shapeCache) if (!touched.has(k)) { freeValue(v); shapeCache.delete(k); }
  for (const [k, m] of mfConvCache) {
    if (![...state.values()].some((b) => b.key === k) && !touched.has(k)) { try { m.delete(); } catch { /* */ } mfConvCache.delete(k); }
  }

  const display = (id, b) => {
    let payload = meshCache.get(b.key);
    if (!payload) {
      const tm = Date.now();
      try { payload = b.v.mf ? meshMf(b.v.mf) : meshSolid(b.v.shape); timings['mesh:' + id] = Date.now() - tm; } catch (err) { errors['body:' + id] = 'Could not display this object: ' + (err?.message || err); return null; }
      meshCache.set(b.key, payload);
    }
    return { id, key: b.key, ...payload };
  };
  const bodies = [...state].map(([id, b]) => display(id, b)).filter(Boolean);
  const ghosts = [...ghostVals].filter(([id]) => !state.has(id)).map(([id, b]) => display(id, b)).filter(Boolean);
  const live = new Set([...bodies, ...ghosts].map((b) => b.key));
  for (const k of meshCache.keys()) if (!live.has(k)) meshCache.delete(k);
  return { bodies, ghosts, errors, ms: Date.now() - t0, timings, heights };
}

function meshSolid(shape) {
  let nFaces = 0;
  try { nFaces = faceCount(shape); } catch { /* */ }
  let bb = solidBounds(shape);
  const diag = len3(sub(bb[1], bb[0])) || 1;
  // big models (thousands of faces) get a coarser display mesh so they stay quick
  const heavy = nFaces > 1500 ? Math.min(4, nFaces / 1500) : 1;
  // how far the flat triangles may stray from the true curve: small on big round things too (never more than
  // about 0.12 mm), so they look round, not like a stop sign
  const tol = Math.max(0.01, Math.min(diag / 1000, 0.12)) * heavy;
  const m = shape.mesh({ tolerance: tol, angularTolerance: heavy > 1 ? 0.8 : 0.3 });
  const em = shape.meshEdges({ tolerance: tol * 2, angularTolerance: 0.5 });
  const faceRanges = new Int32Array(m.faceGroups.length * 2);
  m.faceGroups.forEach((g, i) => { faceRanges[2 * i] = g.start; faceRanges[2 * i + 1] = g.count; });
  const edgeRanges = new Int32Array(em.edgeGroups.length * 2);
  em.edgeGroups.forEach((g, i) => { edgeRanges[2 * i] = g.start; edgeRanges[2 * i + 1] = g.count; });
  let pick;
  if (heavy === 1) pick = pickInfoExact(shape);
  else {
    // asking the kernel about every edge and face is slow on big models, so work it out from the display mesh
    pick = pickInfoFromMesh(m, em);
    const V = m.vertices; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < V.length; i += 3) for (let k = 0; k < 3; k++) { const v = V[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
    if (V.length) bb = [mn, mx];
  }
  let volume = 0;
  try { volume = R.measureVolume(shape); } catch { /* */ }
  return {
    solid: true, bbox: bb, volume,
    vertices: new Float32Array(m.vertices), normals: new Float32Array(m.normals), triangles: new Uint32Array(m.triangles),
    faceRanges, lines: new Float32Array(em.lines), edgeRanges, ...pick,
  };
}

// For picking: each edge's midpoint and direction, each face's center, normal and whether it is flat.
function pickInfoExact(shape) {
  const ei = edgeInfo(shape);
  const edges = new Float32Array(ei.length * 6);
  ei.forEach((x, i) => { edges.set(x.m, i * 6); edges.set(x.t, i * 6 + 3); });
  const fi = faceInfo(shape);
  const faces = new Float32Array(fi.length * 6);
  const flat = new Uint8Array(fi.length);
  fi.forEach((x, i) => { faces.set(x.c, i * 6); faces.set(x.n, i * 6 + 3); try { flat[i] = x.f.geomType === 'PLANE' ? 1 : 0; } catch { flat[i] = 1; } });
  return { edges, faces, flat };
}
function pickInfoFromMesh(m, em) {
  const L = em.lines;
  const edges = new Float32Array(em.edgeGroups.length * 6);
  em.edgeGroups.forEach((g, i) => {
    let total = 0;
    for (let k = g.start; k + 1 < g.start + g.count; k += 2) total += Math.hypot(L[3 * k + 3] - L[3 * k], L[3 * k + 4] - L[3 * k + 1], L[3 * k + 5] - L[3 * k + 2]);
    let acc = 0;
    for (let k = g.start; k + 1 < g.start + g.count; k += 2) {
      const dx = L[3 * k + 3] - L[3 * k], dy = L[3 * k + 4] - L[3 * k + 1], dz = L[3 * k + 5] - L[3 * k + 2];
      const sl = Math.hypot(dx, dy, dz);
      if (acc + sl >= total / 2 || k + 3 >= g.start + g.count) {
        const t = sl > 0 ? (total / 2 - acc) / sl : 0;
        const l = sl || 1;
        edges.set([L[3 * k] + dx * t, L[3 * k + 1] + dy * t, L[3 * k + 2] + dz * t, dx / l, dy / l, dz / l], 6 * i);
        break;
      }
      acc += sl;
    }
  });
  const V = m.vertices, T = m.triangles;
  const faces = new Float32Array(m.faceGroups.length * 6);
  const flat = new Uint8Array(m.faceGroups.length);
  m.faceGroups.forEach((g, i) => {
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0, A = 0, Asum = 0;
    for (let k = g.start; k < g.start + g.count; k += 3) {
      const a3 = 3 * T[k], b3 = 3 * T[k + 1], c3 = 3 * T[k + 2];
      const ux = V[b3] - V[a3], uy = V[b3 + 1] - V[a3 + 1], uz = V[b3 + 2] - V[a3 + 2];
      const vx = V[c3] - V[a3], vy = V[c3 + 1] - V[a3 + 1], vz = V[c3 + 2] - V[a3 + 2];
      const qx = uy * vz - uz * vy, qy = uz * vx - ux * vz, qz = ux * vy - uy * vx;
      const ar = Math.hypot(qx, qy, qz) / 2;
      cx += ar * (V[a3] + V[b3] + V[c3]) / 3; cy += ar * (V[a3 + 1] + V[b3 + 1] + V[c3 + 1]) / 3; cz += ar * (V[a3 + 2] + V[b3 + 2] + V[c3 + 2]) / 3;
      nx += qx; ny += qy; nz += qz; A += ar; Asum += Math.hypot(qx, qy, qz);
    }
    const nl = Math.hypot(nx, ny, nz) || 1;
    faces.set([cx / (A || 1), cy / (A || 1), cz / (A || 1), nx / nl, ny / nl, nz / nl], i * 6);
    flat[i] = nl > Asum * 0.999 ? 1 : 0; // all triangles face the same way
  });
  return { edges, faces, flat };
}

function meshMf(mf) {
  const m = mf.getMesh();
  const np = m.numProp;
  let verts = m.vertProperties;
  if (np !== 3) { const n = verts.length / np; const v = new Float32Array(n * 3); for (let i = 0; i < n; i++) { v[3 * i] = verts[np * i]; v[3 * i + 1] = verts[np * i + 1]; v[3 * i + 2] = verts[np * i + 2]; } verts = v; }
  const b = mf.boundingBox();
  return { solid: false, bbox: [[...b.min], [...b.max]], volume: mf.volume(), vertices: new Float32Array(verts), triangles: new Uint32Array(m.triVerts) };
}

// ---------- STL import ----------
export function parseSTL(buf) {
  const dv = new DataView(buf);
  const isBinary = buf.byteLength >= 84 && 84 + dv.getUint32(80, true) * 50 === buf.byteLength;
  const v = [];
  if (isBinary) {
    const n = dv.getUint32(80, true);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) v.push(dv.getFloat32(o + k * 4, true));
    }
  } else {
    const text = new TextDecoder().decode(buf);
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
    let m; while ((m = re.exec(text))) v.push(+m[1], +m[2], +m[3]);
  }
  if (!v.length) fail('No triangles found in this STL file');
  if (v.length % 9 || v.some((x) => !Number.isFinite(x))) fail('This STL has incomplete triangles or invalid coordinates.');
  const tri = new Uint32Array(v.length / 3); for (let i = 0; i < tri.length; i++) tri[i] = i;
  return { vertices: new Float32Array(v), triangles: tri };
}

export function parseSTLToMf(buf) {
  const { vertices, triangles } = parseSTL(buf);
  return mfFromArrays(vertices, triangles);
}

// ---------- export helpers ----------
export function exportMeshOf(id) {
  const b = lastState.get(id);
  if (!b) return null;
  if (b.v.mf) { const m = meshMf(b.v.mf); return { vertices: m.vertices, triangles: m.triangles }; }
  const bb = solidBounds(b.v.shape);
  const diag = len3(sub(bb[1], bb[0])) || 1;
  const m = b.v.shape.mesh({ tolerance: Math.max(0.002, Math.min(diag / 5000, 0.05)), angularTolerance: 0.1 }); // fine enough for printing, even on big round parts
  return { vertices: m.vertices, triangles: m.triangles };
}
/** Exact tangent frame at a clicked point on the current world-space CAD solid. */
export function surfacePlane(id, index, point) {
  const shape = solidOf(id);
  if (!shape) throw new Error('A sketch plane needs a CAD solid.');
  if (!Number.isInteger(index) || index < 0 || index >= shape.faces.length || !Array.isArray(point) || point.length !== 3 || point.some((v) => !Number.isFinite(v))) throw new Error('Pick a valid point on a face.');
  const face = shape.faces[index];
  const [u, v] = face.uvCoordinates(point), b = face.UVBounds;
  const du = b.uMax - b.uMin, dv = b.vMax - b.vMin;
  if (!(du > 0 && dv > 0)) throw new Error('This surface cannot define a stable sketch plane.');
  let position, normal;
  try {
    position = face.pointOnSurface((u - b.uMin) / du, (v - b.vMin) / dv);
    normal = face.normalAt(position);
    const P = position.toTuple(), raw = normal.toTuple(), length = Math.hypot(...raw);
    if (!P.every(Number.isFinite) || !Number.isFinite(length) || length < 1e-8) throw new Error('Choose a point away from the surface tip or seam.');
    return { P, n: raw.map((v) => v / length), curved: face.geomType !== 'PLANE' };
  } finally { position?.delete(); normal?.delete(); }
}
/**
 * Sketch: weld outlines that touch or overlap into single outlines (2D union, arcs stay arcs).
 * Gets the outlines (holes included, as in a sketch: inside another outline = a hole) and returns the outlines
 * of the resulting region: [{type:'poly', pts, bulge?} | {type:'circle', c, r}], outer ones and holes.
 */
/** One sketch outline as a replicad drawing (arcs stay arcs). */
function drawLoop(l) {
  if (l.type === 'circle') return R.drawCircle(+l.r).translate(+l.c[0], +l.c[1]);
  const { pts, bulge } = SG.expandLoop({ ...l, pts: l.pts.map((q) => [+q[0], +q[1]]) });
  let pen = R.draw(pts[0]);
  for (let i = 0; i < pts.length; i++) {
    const A = pts[i], B = pts[(i + 1) % pts.length];
    if (i === pts.length - 1) { if (Math.abs(bulge[i]) > 1e-9) pen = pen.threePointsArcTo(B, SG.arcMid(A, B, bulge[i])); break; }
    pen = Math.abs(bulge[i]) > 1e-9 ? pen.threePointsArcTo(B, SG.arcMid(A, B, bulge[i])) : pen.lineTo(B);
  }
  return pen.close();
}

/** Every closed wire of a replicad drawing, back as sketch outlines (whole circles as circles). */
function loopsOfDrawing(d) {
  const wires = [];
  const collect = (x) => { if (!x) return; if (Array.isArray(x.curves)) wires.push(x); else for (const b of x.blueprints || []) collect(b); };
  collect(d?.innerShape);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const out = [];
  for (const w of wires) {
    const cs = w.curves;
    // a whole circle (the kernel may hand it back in pieces): a circle again
    const circleOf = (c) => {
      const t0 = c.firstParameter, t1 = c.lastParameter;
      const A = c.value(t0), B = c.value(t0 + (t1 - t0) / 3), C = c.value(t0 + 2 * (t1 - t0) / 3);
      const D = 2 * (A[0] * (B[1] - C[1]) + B[0] * (C[1] - A[1]) + C[0] * (A[1] - B[1]));
      if (Math.abs(D) < 1e-12) return null;
      const ux = ((A[0] ** 2 + A[1] ** 2) * (B[1] - C[1]) + (B[0] ** 2 + B[1] ** 2) * (C[1] - A[1]) + (C[0] ** 2 + C[1] ** 2) * (A[1] - B[1])) / D;
      const uy = ((A[0] ** 2 + A[1] ** 2) * (C[0] - B[0]) + (B[0] ** 2 + B[1] ** 2) * (A[0] - C[0]) + (C[0] ** 2 + C[1] ** 2) * (B[0] - A[0])) / D;
      return [ux, uy, Math.hypot(A[0] - ux, A[1] - uy)];
    };
    if (cs.every((c) => c.geomType === 'CIRCLE')) {
      const ks = cs.map(circleOf), k0 = ks[0];
      if (k0 && ks.every((k) => k && Math.abs(k[0] - k0[0]) < 1e-6 && Math.abs(k[1] - k0[1]) < 1e-6 && Math.abs(k[2] - k0[2]) < 1e-6)) {
        out.push({ type: 'circle', c: [r6(k0[0]), r6(k0[1])], r: r6(k0[2]) });
        continue;
      }
    }
    const pts = [], bulge = [];
    for (const c of cs) {
      const t0 = c.firstParameter, t1 = c.lastParameter, A = c.value(t0), B = c.value(t1), type = c.geomType;
      if (type === 'LINE') { pts.push(A); bulge.push(0); }
      else if (type === 'CIRCLE') { pts.push(A); bulge.push(SG.bulgeFrom3(A, c.value((t0 + t1) / 2), B)); }
      else { const n = 24; for (let k = 0; k < n; k++) { pts.push(c.value(t0 + ((t1 - t0) * k) / n)); bulge.push(0); } } // any other curve: short straight pieces
    }
    // tidy up: no repeated points, no corner in the middle of a straight run
    let P = pts.map((q) => [r6(q[0]), r6(q[1])]), Bg = bulge.map((b) => (Math.abs(b) < 1e-9 ? 0 : r6(b)));
    for (let changed = true; changed && P.length > 3;) {
      changed = false;
      for (let i = 0; i < P.length && P.length > 3; i++) {
        const n = P.length, prev = (i - 1 + n) % n, A = P[prev], M = P[i], B = P[(i + 1) % n];
        const same = Math.hypot(M[0] - A[0], M[1] - A[1]) < 1e-4;
        const straight = !Bg[prev] && !Bg[i] && Math.abs((M[0] - A[0]) * (B[1] - A[1]) - (M[1] - A[1]) * (B[0] - A[0])) < 1e-6 * Math.max(1, Math.hypot(B[0] - A[0], B[1] - A[1])) && ((M[0] - A[0]) * (B[0] - M[0]) + (M[1] - A[1]) * (B[1] - M[1])) >= 0;
        if (same || straight) { if (same) Bg[prev] = Bg[i] || Bg[prev]; P.splice(i, 1); Bg.splice(i, 1); changed = true; break; }
      }
    }
    const l = { type: 'poly', pts: P };
    if (Bg.some((b) => b)) l.bulge = Bg;
    out.push(l);
  }
  return out;
}

export function unionLoops(loops, tol = 0.01) {
  const ls = JSON.parse(JSON.stringify(loops.filter((l) => SG.isSolidLoop(l) && (l.type === 'circle' ? +l.r > 0 : l.pts?.length >= 2))));
  if (!ls.length) return [];
  // close calls first: points within `tol` of another outline's corner or straight side are put exactly on it, so
  // outlines drawn "touching" (but a hair apart or a hair overlapping) weld instead of leaving slivers or gaps
  for (const l of ls) if (l.pts) l.pts = l.pts.map((q) => [+q[0], +q[1]]);
  const polys = ls.filter((l) => l.pts);
  for (const A of polys) for (const P of A.pts) {
    let best = null, bd = tol;
    for (const B of polys) if (B !== A) for (const Q of B.pts) { const d = Math.hypot(P[0] - Q[0], P[1] - Q[1]); if (d > 0 && d < bd) { bd = d; best = Q; } }
    if (best) { P[0] = best[0]; P[1] = best[1]; }
  }
  for (const A of polys) for (const P of A.pts) {
    let best = null, bd = tol;
    for (const B of polys) {
      if (B === A) continue;
      const n = B.pts.length;
      for (let i = 0; i < n; i++) {
        if (Math.abs(+(B.bulge?.[i] || 0)) > 1e-9) continue;
        const U = B.pts[i], V = B.pts[(i + 1) % n], dx = V[0] - U[0], dy = V[1] - U[1], L2 = dx * dx + dy * dy; if (L2 < 1e-18) continue;
        const t = ((P[0] - U[0]) * dx + (P[1] - U[1]) * dy) / L2; if (t <= 0 || t >= 1) continue;
        const X = [U[0] + t * dx, U[1] + t * dy], d = Math.hypot(P[0] - X[0], P[1] - X[1]);
        if (d > 0 && d < bd) { bd = d; best = X; }
      }
    }
    if (best) { P[0] = best[0]; P[1] = best[1]; }
  }
  const sorted = ls.slice().sort((a, b) => SG.loopArea(b) - SG.loopArea(a));
  let d = null;
  for (const l of sorted) {
    const depth = sorted.filter((o) => o !== l && SG.loopArea(o) > SG.loopArea(l) && SG.loopInside(o, l)).length;
    const s = drawLoop(l); d = !d ? s : depth % 2 ? d.cut(s) : d.fuse(s);
  }
  return loopsOfDrawing(d);
}

/**
 * Offset outlines: each one a copy grown (dist > 0) or shrunk (dist < 0) by dist all round, for walls and clearances.
 * corners: 'sharp' (corners stay corners) or 'round' (outward corners become arcs). An outline that shrinks away
 * comes back as nothing.
 */
export function offsetLoops(loops, dist, corners = 'sharp') {
  const out = [];
  for (const l0 of loops) {
    const l = JSON.parse(JSON.stringify(l0));
    if (!SG.isSolidLoop(l)) continue;
    if (l.type === 'circle') { const r = +l.r + dist; if (r > 1e-6) out.push([{ type: 'circle', c: [+l.c[0], +l.c[1]], r: Math.round(r * 1e6) / 1e6 }]); else out.push([]); continue; }
    l.pts = l.pts.map((q) => [+q[0], +q[1]]);
    let d;
    try { d = drawLoop(l).offset(dist, { lineJoinType: corners === 'round' ? 'round' : 'miter' }); } catch { out.push([]); continue; }
    out.push(loopsOfDrawing(d));
  }
  return out;
}
export function solidOf(id) { return lastState.get(id)?.v.shape || null; }
export { R };

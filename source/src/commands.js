// Changes to the project: adding shapes, moving and sizing, combining, copying, deleting, grouping.
// Each one is a single undo step.
import { Matrix4, Vector3, Euler, Quaternion, MathUtils } from 'three';
import { store, creatorOf, isSimplePrimitive, lastFeatureOf, nextName, nextColor, featuresOfBody } from './store.js';
import { SHAPES, evalExpr, HOLE_KINDS } from './shared.js';
import { app, scope, bodyData } from './state.js';
import { r2, r4, toast } from './ui/dom.js';
import { valueNow } from './ui/sketch.js';
import { vp } from './view.js';
import { requestBuild } from './build.js';
import { renderAll } from './ui/panels.js';

// ---------------------------------------------------------------- selection and the step being edited
export function select(ids) { app.sel = ids; editStep(null); vp.setSelection(ids); renderAll(); }
export function selectNone() { select([]); }
export function selectAll() { select([...app.results.bodies.keys()].filter((id) => !store.doc.bodies[id]?.hidden)); }
/** Open a step for editing (or close it with null). Objects the step used up show as see-through ghosts. */
export function editStep(fid) {
  const changed = app.feature !== fid;
  app.feature = fid;
  if (!fid) vp.setGhosts([]);
  else if (changed) requestBuild();
}

export function copySel() { app.clip = app.sel.slice(); }
export function paste() {
  const ids = (app.clip || []).filter((id) => app.results.bodies.has(id));
  if (ids.length) { app.sel = ids; duplicateSel(); }
}

// ---------------------------------------------------------------- shapes
export function placeNew() {
  // the middle of the floor when empty; otherwise just to the right of what is already there
  const ids = [...app.results.bodies.keys()].filter((id) => !store.doc.bodies[id]?.hidden);
  if (!ids.length) return [0, 0, 0];
  const b = vp.selectionBox(ids);
  return [Math.ceil(b.max.x + 25), r2((b.min.y + b.max.y) / 2), 0];
}

// default colors, matched to the nearest Windows Paint color
const SHAPE_COLORS = { box: '#22B14C', sphere: '#22B14C', cyl: '#00A2E8', tetra: '#99D9EA', wedge: '#7092BE', hexagon: '#FFC90E', cone: '#FF7F27', torus: '#FFF200', pyramid: '#B5E61D', tube: '#ED1C24', extrusion: '#C3C3C3', thread: '#7F7F7F', washer: '#C3C3C3', standoff: '#FFC90E', sketch: '#3F48CC', screw: '#C3C3C3', nut: '#C3C3C3', bearing: '#7F7F7F', pin: '#C3C3C3', rod: '#C3C3C3', magnet: '#7F7F7F', hexstandoff: '#FFC90E' };
export function defaultColor(kind, label, doc) {
  if (label === 'Tetrahedron') return SHAPE_COLORS.tetra;
  if (label === 'Hexagon') return SHAPE_COLORS.hexagon;
  return SHAPE_COLORS[kind] || nextColor(doc);
}

/** Add a shape with its bottom middle at a spot (dropped there from the toolbar). Same arguments as addShape after it. */
export function addShapeAt(at, ...args) {
  dropAt = at;
  try { return addShape(...args); } finally { dropAt = null; }
}
let dropAt = null;
export function addShape(kind, extra = {}, label0) {
  let id;
  store.commit((doc) => {
    id = store.newId('b');
    const p = { ...SHAPES[kind].defaults, ...extra };
    const fid = store.newId('f');
    let pos = dropAt ? dropAt.map(r4) : placeNew(), rot = [0, 0, 0];
    const wp = dropAt ? null : app.workplane; // dropped somewhere: right there, even with a workplane set
    if (wp) {
      // on the workplane: standing out from the face; the exact spot is set once its height is known (see build.js)
      const e = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...wp.n).normalize()), 'ZYX');
      rot = [e.x, e.y, e.z].map((a) => r4(MathUtils.radToDeg(a)));
      pos = wp.P.map(r4);
      app.toPlane = [...(app.toPlane || []), { fid, P: wp.P, n: wp.n }];
    }
    doc.features.push({ id: fid, type: 'shape', body: id, kind, p, pos, rot });
    const label = label0 || (kind === 'thread' ? ({ bolt: 'Bolt', nut: 'Nut', cutter: 'Threaded hole' }[p.kind] || 'Thread') : SHAPES[kind].label);
    const hole = (kind === 'thread' && p.kind === 'cutter') || HOLE_KINDS.has(kind);
    doc.bodies[id] = { name: nextName(doc, label), color: hole ? '#8b96a3' : defaultColor(kind, label0, doc), hole };
  });
  select([id]);
  return id;
}

/** Where a shape's position and turn go when a world-space matrix (move + turn, no stretch) is applied; null if it can't be worked out. */
function placeByMatrix(f, M, hgt) {
  const decomp = { t: new Vector3(), q: new Quaternion(), s: new Vector3() };
  M.decompose(decomp.t, decomp.q, decomp.s);
  const uniform = Math.abs(decomp.s.x - 1) < 1e-6 && Math.abs(decomp.s.y - 1) < 1e-6 && Math.abs(decomp.s.z - 1) < 1e-6;
  if (hgt == null || !uniform) return null;
  const sc = scope();
  let pos, rot;
  try { pos = f.pos.map((v) => evalExpr(v, sc)); rot = f.rot.map((v) => evalExpr(v, sc)); } catch { return null; }
  const c = new Vector3(0, 0, hgt / 2);
  const W = new Vector3(...pos).add(c).applyMatrix4(M);
  const Rold = new Matrix4().makeRotationFromEuler(new Euler(...rot.map((d) => MathUtils.degToRad(d)), 'ZYX'));
  const Rd = new Matrix4().makeRotationFromQuaternion(decomp.q);
  const Rn = new Matrix4().multiplyMatrices(Rd, Rold);
  const e = new Euler().setFromRotationMatrix(Rn, 'ZYX');
  return { pos: W.sub(c).toArray().map(r4), rot: [e.x, e.y, e.z].map((a) => { let d = r4(MathUtils.radToDeg(a)); if (Math.abs(d) < 1e-4) d = 0; return d; }) };
}
export function bodyMatrixFeature(doc, id, M) {
  // Apply a world-space matrix to a body as one step.
  if (isSimplePrimitive(doc, id)) {
    const f = creatorOf(doc, id);
    const pr = placeByMatrix(f, M, app.results.heights[f.id]);
    if (pr) { f.pos = pr.pos; f.rot = pr.rot; return; }
  }
  const last = lastFeatureOf(doc, id);
  if (last && last.type === 'move' && last.body === id) {
    const prev = new Matrix4().fromArray(last.m);
    last.m = new Matrix4().multiplyMatrices(M, prev).elements.map((v) => Math.round(v * 1e9) / 1e9);
  } else {
    doc.features.push({ id: store.newId('f'), type: 'move', body: id, m: M.elements.map((v) => Math.round(v * 1e9) / 1e9) });
  }
}

// Sizing a plain shape changes its own numbers (a box gets a new width, depth and height). Whatever the numbers
// cannot show, like a cylinder made oval, is kept as a stretch along the shape's own X, Y and Z.
// Each entry returns [new numbers, extra stretch].
const SCALE_MAP = {
  box: (p, s) => [{ w: p.w * s.x, d: p.d * s.y, h: p.h * s.z }],
  wedge: (p, s) => [{ w: p.w * s.x, d: p.d * s.y, h: p.h * s.z }],
  cyl: (p, s) => [{ d: p.d * s.y, h: p.h * s.z }, [s.x / s.y, 1, 1]],
  sphere: (p, s) => [{ d: p.d * s.y }, [s.x / s.y, 1, s.z / s.y]],
  cone: (p, s) => [{ d1: p.d1 * s.y, d2: p.d2 * s.y, h: p.h * s.z }, [s.x / s.y, 1, 1]],
  torus: (p, s) => [{ D: p.D * s.y, d: p.d * s.z }, [s.x / s.y, 1, 1]],
  pyramid: (p, s) => [{ d: p.d * s.y, h: p.h * s.z }, [s.x / s.y, 1, 1]],
  tube: (p, s) => [{ od: p.od * s.y, id: p.id * s.y, h: p.h * s.z }, [s.x / s.y, 1, 1]],
  prism: (p, s) => [{ af: p.af * s.y, h: p.h * s.z }, [s.x / s.y, 1, 1]],
  text: (p, s) => [{ size: p.size * s.y, depth: p.depth * s.z }, [s.x / s.y, 1, 1]],
  extrusion: (p, s) => [{ len: p.len * s.z }, [s.x, s.y, 1]],
  import: () => [{}, null],
  // hardware keeps its standard numbers; resizing it just stretches it
  washer: () => [{}, null], standoff: () => [{}, null], screw: () => [{}, null], nut: () => [{}, null], bearing: () => [{}, null], magnet: () => [{}, null], hexstandoff: () => [{}, null],
  sketch: (p, s) => [{ h: p.h * s.z }, [s.x, s.y, 1]],
  pin: (p, s) => [{ len: p.len * s.z }, [s.x, s.y, 1]], rod: (p, s) => [{ len: p.len * s.z }, [s.x, s.y, 1]], insert: () => [{}, null], screwhole: () => [{}, null], nuttrap: () => [{}, null],
};

/** Which way a shape's own height grows, after its turn (rot in degrees): [x, y, z]. */
export function turnedUp(rot) {
  return new Vector3(0, 0, 1).applyEuler(new Euler(...rot.map((d) => MathUtils.degToRad(d)), 'ZYX')).toArray();
}
/** For a shape turned only in quarter turns: which of X, Y, Z (0, 1, 2) each of its own X, Y, Z lies along; else null. */
function axisMap(rot) {
  const e = new Matrix4().makeRotationFromEuler(new Euler(...rot.map((d) => MathUtils.degToRad(d)), 'ZYX')).elements;
  const own = [0, 1, 2].map((i) => [0, 1, 2].findIndex((j) => Math.abs(Math.abs(e[i * 4 + j]) - 1) < 1e-6));
  return own.every((j) => j >= 0) && new Set(own).size === 3 ? own : null;
}

/**
 * A shape followed only by Move steps (moves, turns, and sizing the same in every direction, e.g. from an older
 * version): fold those steps into the shape itself, so it is a plain shape again whose own numbers can be changed.
 * The result looks exactly the same. Returns true when it is a plain shape afterwards.
 */
const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** Objects that are a shape plus leftover Move steps it can take in: their ids (checked after a build). */
export function foldableBodies(doc) {
  return Object.keys(doc.bodies).filter((id) => {
    const fs = featuresOfBody(doc, id), f = fs[0];
    return fs.length > 1 && f?.type === 'shape' && f.body === id && fs.slice(1).every((x) => x.type === 'move' && x.body === id);
  });
}
export function foldMoves(doc, id) {
  if (isSimplePrimitive(doc, id)) return true;
  const f = creatorOf(doc, id), h = app.results.heights?.[f?.id];
  if (f?.type !== 'shape' || f.body !== id || h == null || !SCALE_MAP[f.kind] || f.kind === 'thread') return false;
  const rest = featuresOfBody(doc, id).filter((x) => x !== f);
  if (!rest.length || !rest.every((x) => x.type === 'move' && x.body === id && Array.isArray(x.m))) return false;
  let M = new Matrix4();
  for (const x of rest) M = new Matrix4().multiplyMatrices(new Matrix4().fromArray(x.m), M);
  const t = new Vector3(), q = new Quaternion(), sv = new Vector3();
  M.decompose(t, q, sv);
  const k = sv.x;
  if (!(k > 0) || Math.abs(sv.y - k) > 1e-6 * k || Math.abs(sv.z - k) > 1e-6 * k || M.determinant() < 0) return false; // stretched or mirrored
  const sc = scope();
  let p, pos;
  try {
    p = Object.fromEntries(Object.entries(f.p).map(([key, v]) => [key, typeof v === 'string' && SHAPES[f.kind].fields.find((x) => x[0] === key)?.[2] === 'num' ? evalExpr(v, sc) : v]));
    pos = f.pos.map((v) => evalExpr(v, sc)); f.rot.map((v) => evalExpr(v, sc));
  } catch { return false; }
  // 1. the size: the shape's own numbers k times bigger (what they can't show goes into its stretch)
  if (Math.abs(k - 1) > 1e-9) {
    const [np, extra0] = SCALE_MAP[f.kind](p, { x: k, y: k, z: k });
    for (const [key, v] of Object.entries(np)) f.p[key] = r4(v); // (its stretch is kept finer: it must look the same)
    const extra = extra0 === null ? [k, k, k] : extra0;
    if (extra) {
      const st = (f.stretch || [1, 1, 1]).map((v, i) => r6(evalExpr(v, sc) * extra[i]));
      if (st.every((v) => Math.abs(v - 1) < 1e-4)) delete f.stretch; else f.stretch = st;
    }
    // sized around 0,0,0 like the step did: its middle moves k times as far out
    const c = new Vector3(0, 0, h / 2), mid = new Vector3(...pos).add(c).multiplyScalar(k);
    f.pos = mid.sub(new Vector3(0, 0, (h * k) / 2)).toArray().map(r4);
  }
  // 2. the move and turn
  const rigid = new Matrix4().compose(t, q, new Vector3(1, 1, 1));
  const pr = placeByMatrix(f, rigid, h * k);
  if (!pr) return false;
  f.pos = pr.pos; f.rot = pr.rot;
  doc.features = doc.features.filter((x) => !rest.includes(x));
  return true;
}

export function markSettle(ids) {
  // objects resting on the floor before turning are put back down on it afterwards, like 3D Builder
  app.settle = ids.filter((id) => { const d = bodyData(id); return d && Math.abs(d.bbox[0][2]) < 0.01; });
}

export function commitTransform(ids, M, info) {
  let note = null;
  if (info.mode === 'rotate') markSettle(ids);
  store.commit((doc) => {
    for (const id of ids) {
      if (info.mode === 'scale') {
        const s = info.scale;
        const piv = new Vector3(...info.pivot);
        foldMoves(doc, id); // a shape that was only moved, turned or evenly sized since: its own numbers again
        const f = creatorOf(doc, id);
        const simple = isSimplePrimitive(doc, id);
        const sc = scope();
        if (simple && f.type === 'shape' && f.kind === 'thread') { note = 'Threads keep their standard size. Change the size in the thread settings.'; continue; }
        if (simple && f.type === 'shape' && SCALE_MAP[f.kind]) {
          let p, rot, pos;
          try {
            p = Object.fromEntries(Object.entries(f.p).map(([k, v]) => [k, typeof v === 'string' && SHAPES[f.kind].fields.find((x) => x[0] === k)?.[2] === 'num' ? evalExpr(v, sc) : v]));
            rot = f.rot.map((v) => evalExpr(v, sc)); pos = f.pos.map((v) => evalExpr(v, sc));
          } catch { p = null; }
          // turned only in quarter turns (any way: a sketch on an upright face is turned on its side): each of the
          // shape's own directions lies along one of X, Y, Z, so sizing along that one changes the shape's own number
          // (for a sketch standing on a face, sizing across the face changes its height)
          const own = p && axisMap(rot), data = bodyData(id);
          if (own && data) {
            const sw = [s.x, s.y, s.z], ss = { x: sw[own[0]], y: sw[own[1]], z: sw[own[2]] };
            const [np, extra0] = SCALE_MAP[f.kind](p, ss);
            const extra = extra0 === null ? [ss.x, ss.y, ss.z] : extra0;
            for (const [k, v] of Object.entries(np)) f.p[k] = r2(v);
            if (extra) {
              const st = (f.stretch || [1, 1, 1]).map((v, i) => r6(evalExpr(v, sc) * extra[i]));
              if (st.every((v) => Math.abs(v - 1) < 1e-4)) delete f.stretch; else f.stretch = st;
            }
            // the shape is placed by its middle, half its own height above pos. Its middle goes where sizing puts it,
            // except along its own height: there its base (the side on the floor, or on the face it stands on) stays
            const j = own[2], up = turnedUp(rot)[j], h = data.bbox[1][j] - data.bbox[0][j], h2 = h * ss.z;
            const mid0 = new Vector3(...pos).add(new Vector3(0, 0, h / 2)), mid = mid0.clone().sub(piv).multiply(s).add(piv);
            if (ids.length === 1) mid.setComponent(j, mid0.getComponent(j) + (up * (h2 - h)) / 2); // (several at once: sized together)
            f.pos = mid.sub(new Vector3(0, 0, h2 / 2)).toArray().map(r4);
            continue;
          }
        }
        // anything else is sized by a scaling step (a combined solid sized unevenly becomes a mesh)
        const data = bodyData(id);
        if (data?.solid && (Math.abs(s.x - s.y) > 1e-3 || Math.abs(s.y - s.z) > 1e-3)) note = 'Stretched unevenly, so it is now a mesh: it still prints and exports to STL, but fillets and STEP export no longer work on it. Size it before combining to keep it a solid.';
        const U = new Matrix4().makeTranslation(piv.x, piv.y, piv.z).multiply(new Matrix4().makeScale(s.x, s.y, s.z)).multiply(new Matrix4().makeTranslation(-piv.x, -piv.y, -piv.z));
        bodyMatrixFeature(doc, id, U);
      } else {
        bodyMatrixFeature(doc, id, M);
      }
    }
  });
  if (note) toast(note);
  vp.updateGizmo();
}

export function translateSel(dx, dy, dz) {
  if (!app.sel.length) return;
  store.commit((doc) => { for (const id of app.sel) bodyMatrixFeature(doc, id, new Matrix4().makeTranslation(dx, dy, dz)); });
}
export function rotateSel(axis, deg) {
  if (!app.sel.length) return;
  const b = vp.selectionBox(); const c = b.getCenter(new Vector3());
  const R = new Matrix4().makeRotationAxis(new Vector3(...{ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis]), MathUtils.degToRad(deg));
  const M = new Matrix4().makeTranslation(c.x, c.y, c.z).multiply(R).multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  markSettle(app.sel);
  store.commit((doc) => { for (const id of app.sel) bodyMatrixFeature(doc, id, M); });
}
/** Align (like TinkerCAD): line the selected objects up with the anchor object (the first one picked, which stays put).
 *  axis 0/1/2 = X/Y/Z; where -1 = low side, 0 = middle, 1 = high side. Grouped objects move together.
 *  Returns {id: [dx,dy,dz]} for every object that would move. */
export function alignPlan(axis, where, anchor = app.align?.anchor ?? app.sel[0]) {
  const units = new Map();
  for (const id of app.sel) { const g = store.doc.bodies[id]?.group || id; if (!units.has(g)) units.set(g, []); units.get(g).push(id); }
  const span = (ids) => { let lo = Infinity, hi = -Infinity; for (const id of ids) { const b = bodyData(id)?.bbox; if (b) { lo = Math.min(lo, b[0][axis]); hi = Math.max(hi, b[1][axis]); } } return [lo, hi]; };
  const at = ([lo, hi]) => (where < 0 ? lo : where > 0 ? hi : (lo + hi) / 2);
  const anchorUnit = [...units.values()].find((ids) => ids.includes(anchor)) || [...units.values()][0];
  const goal = at(span(anchorUnit));
  const plan = {};
  if (!Number.isFinite(goal)) return plan;
  for (const ids of units.values()) {
    if (ids === anchorUnit) continue;
    const d = goal - at(span(ids));
    if (Math.abs(d) > 1e-6) for (const id of ids) { plan[id] = [0, 0, 0]; plan[id][axis] = d; }
  }
  return plan;
}
/** Center the other picked objects on the first one picked (it stays put), along the given axes (0 X, 1 Y, 2 Z). */
export function centerOn(axes) {
  if (app.sel.length < 2) return toast('Pick the object to center on first, then Ctrl+click the ones to move onto its center.');
  const total = {};
  for (const ax of axes) for (const [id, d] of Object.entries(alignPlan(ax, 0, app.sel[0]))) { total[id] ||= [0, 0, 0]; total[id][ax] += d[ax]; }
  if (!Object.keys(total).length) return;
  store.commit((doc) => { for (const [id, d] of Object.entries(total)) bodyMatrixFeature(doc, id, new Matrix4().makeTranslation(...d)); });
}
export function alignSel(axis, where, anchor) {
  if (app.sel.length < 2) return toast('Select two or more objects to line up. Hold Ctrl and click to add to the selection.');
  const plan = alignPlan(axis, where, anchor);
  if (!Object.keys(plan).length) return;
  store.commit((doc) => { for (const [id, d] of Object.entries(plan)) bodyMatrixFeature(doc, id, new Matrix4().makeTranslation(...d)); });
}
export function dropSel() {
  if (!app.sel.length) return;
  store.commit((doc) => {
    for (const id of app.sel) { const d = bodyData(id); if (d && Math.abs(d.bbox[0][2]) > 1e-6) bodyMatrixFeature(doc, id, new Matrix4().makeTranslation(0, 0, -d.bbox[0][2])); }
  });
}

export function deleteSel() {
  if (!app.sel.length) return;
  const ids = app.sel.slice();
  store.commit((doc) => {
    for (const id of ids) {
      const usedElsewhere = doc.features.some((f) => f.src === id);
      if (isSimplePrimitive(doc, id) && !usedElsewhere) {
        doc.features = doc.features.filter((f) => !(f.type === 'shape' && f.body === id));
        delete doc.bodies[id];
      } else {
        doc.features.push({ id: store.newId('f'), type: 'delete', body: id });
      }
    }
  });
  selectNone();
}

export function duplicateSel() {
  if (!app.sel.length) return;
  const box = vp.selectionBox();
  // like 3D Builder: the copy goes to the right as you are looking at it, lined up with the original
  vp.camera.updateMatrixWorld();
  const right = new Vector3().setFromMatrixColumn(vp.camera.matrixWorld, 0);
  const ax = Math.abs(right.x) >= Math.abs(right.y) ? 0 : 1;
  const sign = Math.sign(ax === 0 ? right.x : right.y) || 1;
  const step = r2((ax === 0 ? box.max.x - box.min.x : box.max.y - box.min.y) + 5) * sign;
  let off = [ax === 0 ? step : 0, ax === 1 ? step : 0, 0];
  // repeat duplicate (like TinkerCAD): duplicating the copy you just made, after moving it, repeats that move
  const last = app.lastDup, same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  if (last && same(app.sel, last.copies)) {
    const built = last.copies.every((id) => vp.bodies.has(id));
    if (built) { const c = new Vector3(); box.getCenter(c); off = [0, 1, 2].map((i) => r4(c.getComponent(i) - last.center[i])); } else off = last.off;
  }
  { const c = new Vector3(); box.getCenter(c); app.lastDup = { center: [c.x, c.y, c.z], off }; }
  const newIds = [];
  const groupMap = {};
  store.commit((doc) => {
    for (const id of app.sel) {
      const nid = store.newId('b');
      if (isSimplePrimitive(doc, id)) {
        const f = creatorOf(doc, id);
        const copy = JSON.parse(JSON.stringify(f));
        copy.id = store.newId('f'); copy.body = nid;
        copy.pos = f.pos.map((v, i) => (!off[i] ? v : typeof v === 'number' ? r4(v + off[i]) : `${v} + ${off[i]}`));
        doc.features.push(copy);
      } else {
        doc.features.push({ id: store.newId('f'), type: 'copy', src: id, body: nid, d: off });
      }
      const pb = doc.bodies[id] || {};
      doc.bodies[nid] = { ...pb, name: nextName(doc, (pb.name || 'Object').replace(/\s+\d+$/, '')) };
      if (pb.group) { groupMap[pb.group] = groupMap[pb.group] || store.newId('g'); doc.bodies[nid].group = groupMap[pb.group]; }
      newIds.push(nid);
    }
  });
  app.lastDup.copies = newIds;
  app.sel = newIds; vp.setSelection(app.sel); renderAll();
}

// ---- groups: objects stay separate but are picked, moved and sized together
export function withGroup(ids) {
  const out = new Set(ids);
  for (const id of ids) { const g = store.doc.bodies[id]?.group; if (g) for (const [bid, p] of Object.entries(store.doc.bodies)) if (p.group === g && app.results.bodies.has(bid)) out.add(bid); }
  return [...out];
}
export function groupSel() {
  if (app.sel.length < 2) return toast('Select two or more objects to group. Hold Ctrl and click to add to the selection.');
  store.commit((doc) => { const g = store.newId('g'); for (const id of app.sel) doc.bodies[id] = { ...doc.bodies[id], group: g }; }, 'ui');
  toast('Grouped. Click any of them to pick the whole group.', 'info', 2500);
}
export function ungroupSel() {
  if (!app.sel.some((id) => store.doc.bodies[id]?.group)) return toast('Nothing selected is in a group.');
  store.commit((doc) => { for (const id of app.sel) { const p = { ...doc.bodies[id] }; delete p.group; doc.bodies[id] = p; } }, 'ui');
}

export function setBodyProp(ids, key, value, kind = 'ui') {
  store.commit((doc) => { for (const id of ids) { doc.bodies[id] = { ...(doc.bodies[id] || {}), [key]: value }; } }, kind);
}

export function combine(op) {
  if (op === 'subtract' && app.sel.length === 1) return subtractFromAll(app.sel[0]);
  if (app.sel.length < 2) { toast(op === 'subtract' ? 'Select the object to cut with, then click Subtract.' : 'Select two or more objects first. Hold Ctrl and click to add to the selection.'); return; }
  const [target, ...tools] = app.sel;
  store.commit((doc) => {
    doc.features.push({ id: store.newId('f'), type: 'combine', op, body: target, tools });
    if (op === 'union') {
      const all = [target, ...tools];
      const allHoles = all.every((id) => doc.bodies[id]?.hole);
      doc.bodies[target] = { ...doc.bodies[target], hole: allHoles };
    } else doc.bodies[target] = { ...doc.bodies[target], hole: false };
  });
  app.sel = [target]; vp.setSelection(app.sel); renderAll();
}

/**
 * Like 3D Builder: with just one object selected, Subtract cuts it out of every object it passes through.
 * Each of those objects gets its own copy of the cutter, so each cut stays editable in its History.
 */
export function subtractFromAll(cutter) {
  const cb = bodyData(cutter); if (!cb) return;
  const eps = 1e-4;
  const overlaps = (d) => [0, 1, 2].every((i) => d.bbox[0][i] < cb.bbox[1][i] - eps && d.bbox[1][i] > cb.bbox[0][i] + eps);
  const targets = [...app.results.bodies.keys()].filter((id) => id !== cutter && !store.doc.bodies[id]?.hidden && !store.doc.bodies[id]?.hole && overlaps(bodyData(id)));
  if (!targets.length) { toast('Nothing to cut: move the object so it passes through the objects you want to cut, then click Subtract.'); return; }
  store.commit((doc) => {
    const props = doc.bodies[cutter] || {};
    const cutters = targets.map((t, i) => {
      if (i === 0) return cutter;
      const c = store.newId('b');
      doc.features.push({ id: store.newId('f'), type: 'copy', src: cutter, body: c, d: [0, 0, 0], name: `${props.name || 'Cutter'} (for ${doc.bodies[t]?.name || 'object'})` });
      doc.bodies[c] = { ...props, name: `${props.name || 'Cutter'} (copy ${i + 1})` };
      delete doc.bodies[c].group;
      return c;
    });
    targets.forEach((t, i) => {
      doc.features.push({ id: store.newId('f'), type: 'combine', op: 'subtract', body: t, tools: [cutters[i]], name: `${doc.bodies[t]?.name || 'Object'}: cut by ${props.name || 'cutter'}` });
      doc.bodies[t] = { ...doc.bodies[t], hole: false };
    });
  });
  select(targets);
  if (targets.length > 1) toast(`Cut out of ${targets.length} objects.`, 'info', 2500);
}

export function mirrorSel(axis, copy) {
  if (!app.sel.length) return;
  if (!copy) { store.commit((doc) => { for (const id of app.sel) doc.features.push({ id: store.newId('f'), type: 'mirror', body: id, axis, copy, side: 'max' }); }); return; }
  // Mirror copy: a new, separate object on the far side (a sketch stays an editable sketch, drawn flipped)
  const ax = { x: 0, y: 1, z: 2 }[axis];
  const box = vp.selectionBox(), at = r4(box.max.getComponent(ax)); // the selection is mirrored as a whole, across its far side
  const newIds = [], groupMap = {};
  store.commit((doc) => {
    for (const id of app.sel) {
      if (!bodyData(id)) continue;
      const nid = store.newId('b'), f = creatorOf(doc, id);
      const sk = f?.kind === 'sketch' && isSimplePrimitive(doc, id) ? mirroredSketch(f, ax, at, app.results.heights[f.id]) : null;
      if (sk) { sk.id = store.newId('f'); sk.body = nid; doc.features.push(sk); }
      else {
        doc.features.push({ id: store.newId('f'), type: 'copy', src: id, body: nid, d: [0, 0, 0] });
        doc.features.push({ id: store.newId('f'), type: 'mirror', body: nid, axis, copy: false, at });
      }
      const pb = doc.bodies[id] || {};
      doc.bodies[nid] = { ...pb, name: nextName(doc, `${(pb.name || 'Object').replace(/\s+\d+$/, '')} mirrored`) };
      if (pb.group) { groupMap[pb.group] = groupMap[pb.group] || store.newId('g'); doc.bodies[nid].group = groupMap[pb.group]; }
      newIds.push(nid);
    }
  });
  select(newIds);
}
// Turning the far side of a mirror plane into Euler angles (ZYX): a turn about the mirror axis stays, the other two reverse.
const MIRROR_EULER = [[1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
/** A sketch shape mirrored across the plane (axis ax) at `at`, still an editable sketch: its outline is flipped.
 *  Returns null when that can't be done exactly (then the caller makes a mirrored copy instead). */
export function mirroredSketch(f, ax, at, h) {
  const p = f.p || {};
  const plain = (v) => typeof v === 'number' || (typeof v === 'string' && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v.trim()));
  if (h == null || !f.pos?.every(plain) || !(f.rot || [0, 0, 0]).every(plain) || p.mode === 'sweep') return null;
  if (p.mode === 'revolve' && Math.abs(+(p.angle ?? 360) - 360) > 1e-9) return null;
  const g = JSON.parse(JSON.stringify(f));
  const pos = g.pos.map(Number), rot = (g.rot || [0, 0, 0]).map(Number);
  // the drawing direction that flips: for Push up / Loft the drawing is the floor plane; for Spin around it stands up
  // (its x is the radius, its y is the height), and a full turn is the same mirrored left-right or front-back
  let flip = null, loftFlip = false;
  if (p.mode === 'revolve') flip = ax === 2 ? 1 : null;
  else if (ax === 2) loftFlip = p.mode === 'loft';
  else flip = ax;
  if (flip != null) {
    for (const l of g.p.loops || []) {
      if (l.type === 'circle') { l.c[flip] = r4(-l.c[flip]); continue; }
      l.pts = l.pts.map((q) => { const c = [q[0], q[1]]; c[flip] = r4(-c[flip]); return c; });
      if (l.bulge) l.bulge = l.bulge.map((b) => (+b ? -b : 0));
    }
    for (const r of g.p.rules || []) {
      if (r.t === 'pin' && r.v) r.v[flip] = r4(-r.v[flip]);
      for (const k of ['a', 'b']) if (r[k]?.fixed) r[k].fixed = r[k].fixed.map((q) => { const c = [q[0], q[1]]; c[flip] = -c[flip]; return c; });
      if (['dx', 'dy', 'angle'].includes(r.t)) { const v = valueNow(g.p.loops, r); if (v != null) r.v = r4(v); }
    }
  }
  if (loftFlip) { if (g.p.flip) delete g.p.flip; else g.p.flip = true; }
  if (flip != null) delete g.p.photo; // a photo to trace over doesn't mirror: the copy goes without it
  // the middle of the shape goes to the mirrored spot; its turn is mirrored too
  const c = [pos[0], pos[1], pos[2] + h / 2];
  c[ax] = 2 * at - c[ax];
  g.pos = [c[0], c[1], c[2] - h / 2].map(r4);
  g.rot = rot.map((a, i) => { const d = r4(a * MIRROR_EULER[ax][i]); return Math.abs(d) < 1e-9 ? 0 : d; });
  if (g.p.sketchPlane) { g.p.sketchPlane.P[ax] = r4(2 * at - g.p.sketchPlane.P[ax]); g.p.sketchPlane.n[ax] = -g.p.sketchPlane.n[ax]; }
  return g;
}
/** Turned copy: a copy turned about the up (Z) axis, placed beside the original (like Duplicate). Its own object. */
export function turnCopySel(deg) {
  if (!app.sel.length) return;
  const box = vp.selectionBox(), c = box.getCenter(new Vector3()), size = box.getSize(new Vector3());
  vp.camera.updateMatrixWorld();
  const right = new Vector3().setFromMatrixColumn(vp.camera.matrixWorld, 0);
  const ax = Math.abs(right.x) >= Math.abs(right.y) ? 0 : 1, sign = Math.sign(ax === 0 ? right.x : right.y) || 1;
  // beside the original with a 5 mm gap; a quarter turn swaps width and depth
  const quarter = Math.abs(Math.round(deg / 90)) % 2 === 1;
  const half = (ax === 0 ? size.x : size.y) / 2, halfTurned = (quarter ? (ax === 0 ? size.y : size.x) : (ax === 0 ? size.x : size.y)) / 2;
  const step = r2(half + halfTurned + 5) * sign;
  const R = new Matrix4().makeRotationZ(MathUtils.degToRad(deg));
  const M = new Matrix4().makeTranslation(c.x + (ax === 0 ? step : 0), c.y + (ax === 1 ? step : 0), c.z).multiply(R).multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  const newIds = [], groupMap = {};
  store.commit((doc) => {
    for (const id of app.sel) {
      const nid = store.newId('b');
      let placed = false;
      if (isSimplePrimitive(doc, id)) {
        const f = creatorOf(doc, id), g = JSON.parse(JSON.stringify(f));
        const pr = placeByMatrix(f, M, app.results.heights[f.id]);
        if (pr) { g.id = store.newId('f'); g.body = nid; g.pos = pr.pos; g.rot = pr.rot; doc.features.push(g); placed = true; }
      }
      if (!placed) {
        doc.features.push({ id: store.newId('f'), type: 'copy', src: id, body: nid, d: [0, 0, 0] });
        doc.features.push({ id: store.newId('f'), type: 'move', body: nid, m: M.elements.map((v) => Math.round(v * 1e9) / 1e9) });
      }
      const pb = doc.bodies[id] || {};
      doc.bodies[nid] = { ...pb, name: nextName(doc, `${(pb.name || 'Object').replace(/\s+\d+$/, '')} turned`) };
      if (pb.group) { groupMap[pb.group] = groupMap[pb.group] || store.newId('g'); doc.bodies[nid].group = groupMap[pb.group]; }
      newIds.push(nid);
    }
  });
  select(newIds);
}

export function addPattern() {
  if (app.sel.length !== 1) return toast('Select one object to repeat.');
  const id = app.sel[0]; const d = bodyData(id);
  const w = d ? r2(d.bbox[1][0] - d.bbox[0][0] + 5) : 25;
  let fid;
  store.commit((doc) => { fid = store.newId('f'); doc.features.push({ id: fid, type: 'array', body: id, kind: 'linear', n: 3, dx: w, dy: 0, dz: 0, angle: 360, cx: 0, cy: 0 }); });
  editStep(fid); renderAll();
}

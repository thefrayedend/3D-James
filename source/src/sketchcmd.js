// Starting, finishing and editing sketches: on the floor or on a face of an object, pushed up or spun around,
// added as a new object or cut into what it touches.
import { Vector3, Quaternion, Euler, Matrix4, MathUtils } from 'three';
import { store, isSimplePrimitive } from './store.js';
import { app, bodyData, scope } from './state.js';
import { evalExpr, r4 } from './shared.js';
import { toast } from './ui/dom.js';
import { vp } from './view.js';
import { addShape, subtractFromAll, select } from './commands.js';
import { openSketch, askSolid, ruleRefs } from './ui/sketch.js';
import { updateFeature } from './ui/fields.js';
import { openPanel } from './ui/panels.js';
import { setWorkplane } from './tools.js';
import { workerCall } from './build.js';
import * as SG from './sketchgeom.js';
import { photoToSketch } from './ui/photowin.js';

const Z = new Vector3(0, 0, 1);
/** The turn that stands a shape up on a face (the same one Insert uses on a workplane). */
function planeQuat(n) {
  const q = new Quaternion().setFromUnitVectors(Z, new Vector3(...n).normalize());
  // through Euler angles (rounded) exactly as addShape stores them, so the sketch lines up with the result
  const e = new Euler().setFromQuaternion(q, 'ZYX');
  const r = [e.x, e.y, e.z].map((a) => Math.round(MathUtils.radToDeg(a) * 1e4) / 1e4);
  return new Quaternion().setFromEuler(new Euler(...r.map((d) => MathUtils.degToRad(d)), 'ZYX'));
}

/** The edges of a body that lie on a plane, as 2D lines in that plane, plus their corners, middles and circle centers. */
function edgesOnPlane(d, P0, toLocal, onPlane) {
  const segs = [], pts = [];
  if (!d?.lines || !d.edgeRanges) return { segs, pts };
  const L = d.lines, R = d.edgeRanges;
  for (let e = 0; e < R.length / 2; e++) {
    const start = R[2 * e], count = R[2 * e + 1]; if (count < 2) continue;
    const vs = [];
    for (let k = 0; k < count; k++) vs.push(new Vector3(L[(start + k) * 3], L[(start + k) * 3 + 1], L[(start + k) * 3 + 2]));
    if (!vs.every(onPlane)) continue;
    // the vertices come in pairs (one short straight piece each): chain them into one line
    const chain = [vs[0]]; for (let k = 1; k < vs.length; k += 2) chain.push(vs[k]);
    const p2 = chain.map((v) => { const q = toLocal(v); return [Math.round(q.x * 1e4) / 1e4, Math.round(q.y * 1e4) / 1e4]; });
    segs.push(p2);
    const a = p2[0], b = p2[p2.length - 1];
    const closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3;
    if (closed && p2.length > 6) {
      // a round edge: its center
      const c = p2.slice(0, -1).reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]).map((v) => v / (p2.length - 1));
      pts.push({ p: c, kind: 'center' });
    } else {
      pts.push({ p: a, kind: 'corner' }, { p: b, kind: 'corner' });
      const straight = p2.every((p) => Math.abs((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) < 1e-3 * Math.hypot(b[0] - a[0], b[1] - a[1]) + 1e-6);
      if (straight) pts.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], kind: 'middle' });
    }
  }
  return { segs, pts };
}

/** The turn and shift that put a world point onto a sketch board (the board's plane becomes z = 0). */
function boardMatrix(wp) {
  if (!wp) return new Matrix4();
  return new Matrix4().makeRotationFromQuaternion(planeQuat(wp.n).invert()).multiply(new Matrix4().makeTranslation(-wp.P[0], -wp.P[1], -wp.P[2]));
}
/** What to show under a sketch: the edges lying on its plane (a face's edges, or the bottoms of everything on the floor). */
function sketchRef(M, skip = []) {
  const ref = { segs: [], pts: [] };
  const toLocal = (v) => v.clone().applyMatrix4(M), onPlane = (v) => Math.abs(toLocal(v).z) < 0.02;
  for (const id of shownBodies(skip)) { const r = edgesOnPlane(bodyData(id), null, toLocal, onPlane); ref.segs.push(...r.segs); ref.pts.push(...r.pts); }
  return ref;
}
/** The outline of a mesh's flat area (pairs of points, from meshfaces.js) as lines on the board, with their corners. */
function meshEdgeRef(ref, E, M) {
  if (!E?.length) return ref;
  const toLocal = (i) => { const v = new Vector3(E[i], E[i + 1], E[i + 2]).applyMatrix4(M); return [Math.round(v.x * 1e4) / 1e4, Math.round(v.y * 1e4) / 1e4, v.z]; };
  const key = (p) => `${Math.round(p[0] * 1e3)},${Math.round(p[1] * 1e3)}`;
  const from = new Map(), used = new Set();
  const segs = [];
  for (let i = 0; i < E.length; i += 6) {
    const a = toLocal(i), b = toLocal(i + 3); if (Math.abs(a[2]) > 0.02 || Math.abs(b[2]) > 0.02) continue;
    const s = segs.push([a, b]) - 1;
    for (const p of [a, b]) { const l = from.get(key(p)); if (l) l.push(s); else from.set(key(p), [s]); }
  }
  // join the pieces end to end into lines, keep only the points where a line turns
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used.has(s0)) continue;
    used.add(s0); const line = [segs[s0][0], segs[s0][1]];
    for (;;) {
      const end = line[line.length - 1], next = (from.get(key(end)) || []).find((s) => !used.has(s)); if (next === undefined) break;
      used.add(next); line.push(key(segs[next][0]) === key(end) ? segs[next][1] : segs[next][0]);
    }
    const pts = [line[0]];
    for (let i = 1; i < line.length - 1; i++) {
      const a = pts[pts.length - 1], b = line[i], c = line[i + 1];
      const turn = Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) / ((Math.hypot(b[0] - a[0], b[1] - a[1]) * Math.hypot(c[0] - b[0], c[1] - b[1])) || 1);
      if (turn > 0.05) pts.push(b);
    }
    pts.push(line[line.length - 1]);
    ref.segs.push(pts.map((p) => [p[0], p[1]]));
    for (const p of pts.length > 12 ? [pts[0]] : pts) ref.pts.push({ p: [p[0], p[1]], kind: 'corner' });
  }
  return ref;
}
const shownBodies = (skip) => [...app.results.bodies.keys()].filter((id) => !store.doc.bodies[id]?.hidden && !skip.includes(id));
/** Then, a moment later: every object seen straight on through the board, so it is clear where the drawing goes. */
function addOutline(k, M, skip = []) {
  const ids = shownBodies(skip);
  if (!k?.setOutline || !ids.length) return;
  workerCall({ type: 'outline', ids, m: M.elements.slice() }).then((r) => k.setOutline(r.polys || [])).catch((err) => console.warn('sketch outline:', err?.message || err));
}

/** Insert > Sketch: draw on the floor, or on the workplane's face when one is set. */
export function startSketch({ restoreWorkplane, start = [] } = {}) {
  const wp = app.workplane;
  const prev = restoreWorkplane;
  const done = () => { if (prev !== undefined) setWorkplane(prev); };
  const M = boardMatrix(wp);
  const k = openSketch(start, (loops, rules, extra = {}) => {
    askSolid((o) => { createSketch(loops, rules, o, wp, extra); done(); }, { onFace: !!wp, loops });
  }, wp ? (wp.curved ? 'Sketch on a tangent plane: straight extrusion or cut, without wrapping' : 'Sketch on a face: dashed lines are the face’s edges, grey is your objects seen straight on') : 'Sketch on the floor: grey is your objects seen from above, dashed lines are their bottoms', { ref: meshEdgeRef(sketchRef(M), wp?.meshEdges, M), onCancel: done });
  addOutline(k, M);
  return k;
}
/** Insert > Sketch > From a photo: size the photo, then trace it (or let 3DJames find the outline) on the board. */
export function startPhotoSketch() {
  return photoToSketch(({ loops, photo }) => startSketch({ start: { loops, rules: [], photo } }));
}
/** Insert > Sketch > From a DXF / SVG file: a new sketch with the drawing's lines in it (pick the file first). */
export function startImportSketch() {
  const k = startSketch();
  k?.importFile();
  return k;
}
/** Insert > Sketch > On a face: pick the face first. */
export function startFaceSketch() {
  const prev = app.workplane || null;
  import('./tools.js').then((T) => {
    T.startTool('workplane');
    app.afterWorkplane = () => startSketch({ restoreWorkplane: prev });
  });
  toast('Click a flat or curved surface to sketch on.', 'info', 3000);
}

export function createSketch(loops, rules, { mode, h, angle, cut }, wp, extra = {}) {
  const p = { loops, h: mode === 'revolve' ? 10 : (cut ? h + 0.02 : h) };
  if (extra.photo) p.photo = extra.photo; // a photo traced over (kept for Edit sketch)
  if (wp) p.sketchPlane = { P: wp.P.slice(), n: wp.n.slice(), curved: !!wp.curved };
  if (rules?.length) p.rules = rules;
  if (mode === 'revolve') { p.mode = 'revolve'; p.angle = angle; }
  if (mode === 'loft' || mode === 'sweep') p.mode = mode;
  // where the result's middle is in the drawing (for a sweep: the middle of its path)
  const b = SG.loopsBounds(loops.filter((l) => (mode === 'sweep' ? l.type === 'line' : SG.isSolidLoop(l)))), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const id = addShape('sketch', p, cut ? 'Sketch cut' : 'Sketch');
  if (wp) {
    // where the drawing's middle is on the face (the solid is built around its own middle)
    const entry = app.toPlane?.[app.toPlane.length - 1];
    if (entry) {
      const off = mode === 'revolve' ? new Vector3() : new Vector3(c[0], c[1], 0).applyQuaternion(planeQuat(wp.n));
      entry.P = [entry.P[0] + off.x, entry.P[1] + off.y, entry.P[2] + off.z];
      if (cut) entry.sink = 0.02;
    }
  } else {
    // on the floor: right where it was drawn
    store.amend((doc) => {
      const f = doc.features.find((x) => x.type === 'shape' && x.body === id);
      f.pos = mode === 'revolve' ? [0, 0, 0] : [Math.round(c[0] * 1e4) / 1e4, Math.round(c[1] * 1e4) / 1e4, cut ? -0.01 : 0];
    });
  }
  if (cut) {
    app.afterBuild = { fn: () => { select([id]); subtractFromAll(id); } };
  }
  openPanel('props');
  return id;
}

/** Properties > Edit sketch: the solid stays where it is while its outline changes. */
export function editSketch(f) {
  if (!sketchGroup([f.body]).why) return editSketches([f.body], 'Edit sketch');
  openSketch({ loops: f.p.loops, rules: f.p.rules || [], photo: f.p.photo || null }, (loops, rules, extra = {}) => {
    const b0 = SG.loopsBounds(solidLoops(f.p.loops)), b1 = SG.loopsBounds(solidLoops(loops));
    const d = [((b1[0] + b1[2]) - (b0[0] + b0[2])) / 2, ((b1[1] + b1[3]) - (b0[1] + b0[3])) / 2];
    updateFeature(f.id, (x) => {
      x.p.loops = loops;
      if (rules?.length) x.p.rules = rules; else delete x.p.rules;
      if (extra.photo) x.p.photo = extra.photo; else delete x.p.photo;
      if (x.p.mode !== 'revolve' && !x.p.off && (Math.abs(d[0]) > 1e-9 || Math.abs(d[1]) > 1e-9)) {
        let rot = [0, 0, 0]; try { rot = x.rot.map((v) => evalExpr(v, scope())); } catch { /* */ }
        const w = new Vector3(d[0], d[1], 0).applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...rot.map((a) => MathUtils.degToRad(a)), 'ZYX')));
        x.pos = x.pos.map((v, i) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) && String(n) === String(v).trim() ? Math.round((n + [w.x, w.y, w.z][i]) * 1e4) / 1e4 : `(${v}) + ${Math.round([w.x, w.y, w.z][i] * 1e4) / 1e4}`; });
      }
    });
  }, 'Edit sketch');
}

// ---- several sketches on one board
const OWNER_COLORS = ['#2f6fdf', '#e8590c', '#2b9a3e', '#ae3ec9', '#d6336c', '#0c8599', '#f59f00', '#5c7cfa'];
const plainNum = (v) => typeof v === 'number' || (typeof v === 'string' && /^[-+]?(\d+\.?\d*|\.\d+)$/.test(v.trim()));
const solidLoops = (ls) => ls.filter(SG.isSolidLoop);
/**
 * Where a sketch's drawing sits in the world: world = O + R·E(p), with E(p) = (x, y, 0) for Push up / Loft (the
 * floor of the shape) or (x, 0, y) for a full Spin around (the drawing stands up; x is the radius).
 * Built the same way as the engine places a shape: centered on its middle, turned about it.
 */
function sketchFrame(f) {
  const p = f.p || {}, h = app.results.heights[f.id];
  if (h == null || !f.pos.every(plainNum) || !f.rot.every(plainNum)) return null;
  if (p.mode === 'sweep') return null;
  if (p.mode === 'revolve' && Math.abs(+(p.angle ?? 360) - 360) > 1e-9) return null;
  const pos = new Vector3(...f.pos.map(Number)), rot = f.rot.map(Number);
  const R = new Matrix4().makeRotationFromEuler(new Euler(...rot.map((a) => MathUtils.degToRad(a)), 'ZYX'));
  const b = SG.loopsBounds(solidLoops(p.loops || [])); if (!Number.isFinite(b[0])) return null;
  const up = p.mode === 'revolve';
  // usually the shape is centered on its own middle; with p.off the drawing keeps a fixed origin instead
  const off = Array.isArray(p.off) && p.off.length === 3 && p.off.every((v) => Number.isFinite(+v)) ? new Vector3(...p.off.map(Number)) : null;
  const local = off ? new Vector3(0, 0, h / 2).sub(off) : up ? new Vector3(0, 0, (b[1] + b[3]) / 2) : new Vector3((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, h / 2);
  const O = pos.clone().add(new Vector3(0, 0, h / 2)).sub(local.applyMatrix4(R));
  return { up, R, rot, O, h, off };
}
/** The position that keeps a sketch's drawing where it was after its outline changed (from its frame). */
function posForFrame(fr, loops) {
  if (fr.off) return null; // a fixed drawing origin: the position stays as it is
  const b = SG.loopsBounds(solidLoops(loops));
  const h = fr.up ? b[3] - b[1] : fr.h;
  const local = fr.up ? new Vector3(0, 0, (b[1] + b[3]) / 2) : new Vector3((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, h / 2);
  return fr.O.clone().add(local.applyMatrix4(fr.R)).sub(new Vector3(0, 0, h / 2)).toArray().map((v) => Math.round(v * 1e4) / 1e4);
}
/** Can these sketch objects be opened together on one board? Returns their frames, or a reason why not. */
export function sketchGroup(ids) {
  const doc = store.doc;
  const fs = ids.map((id) => doc.features.find((x) => x.type === 'shape' && x.body === id && x.kind === 'sketch'));
  if (!fs.length || fs.some((f) => !f)) return { why: 'Select two or more sketch objects (Ctrl+click to add to the selection).' };
  const frames = fs.map(sketchFrame);
  if (frames.some((fr) => !fr)) return { why: 'Sweeps, part turns (Spin around less than 360°) and sketches placed with formulas can only be edited one at a time.' };
  if (frames.some((fr) => fr.up !== frames[0].up)) return { why: 'Spin around sketches and Push up sketches are drawn on different boards. Edit them separately.' };
  // where each drawing's origin sits on the shared plane, measured from the world's 0,0 (so the board shows real positions)
  const Ri = frames[0].R.clone().invert(), offs = frames.map((fr) => fr.O.clone().applyMatrix4(Ri)), o0 = offs[0];
  const same = frames.every((fr) => fr.rot.every((a, i) => Math.abs(a - frames[0].rot[i]) < 1e-6));
  const flat = offs.every((d) => (frames[0].up ? Math.abs(d.y - o0.y) < 0.05 && Math.abs(d.x - o0.x) < 0.05 : Math.abs(d.z - o0.z) < 0.05));
  if (!same || !flat) return { why: frames[0].up ? 'These sketches don’t spin around the same line. Edit them separately.' : 'These sketches aren’t drawn on the same flat plane (one is turned, lifted or on another face). Edit them separately.' };
  // Spin around keeps its own axis on the green line (it spins around that line), so only the height is shifted
  return { fs, frames, offs: offs.map((d) => (frames[0].up ? [0, d.z] : [d.x, d.y])).map(([x, y]) => [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]) };
}
/** Properties (several sketches picked) > Edit sketches together: one board, each sketch in its own color. */
export function editSketches(ids, title) {
  const g = sketchGroup(ids);
  // refused: say why, and give back nothing (no board was opened)
  if (g.why) { toast(g.why, 'info', 5000); return null; }
  if (ids.length < 2 && !title) { toast('Select two or more sketch objects (Ctrl+click to add to the selection).', 'info', 5000); return null; }
  const { fs, frames, offs } = g;
  const names = ids.map((id) => store.doc.bodies[id]?.name || 'Sketch');
  // everything on the first sketch's board; each sketch shifted by where its drawing sits relative to the first
  const loops = [], rules = [];
  fs.forEach((f, k) => {
    const base = loops.length, [dx, dy] = offs[k];
    for (const l0 of f.p.loops || []) {
      const l = JSON.parse(JSON.stringify(l0)); l.owner = k;
      if (l.type === 'circle') l.c = [+l.c[0] + dx, +l.c[1] + dy];
      else l.pts = l.pts.map((q) => [+q[0] + dx, +q[1] + dy]);
      loops.push(l);
    }
    for (const r0 of f.p.rules || []) {
      const r = JSON.parse(JSON.stringify(r0));
      for (const x of refsOfRule(r)) if (x.l != null) x.l += base;
      if (r.t === 'pin' && r.v) r.v = [r.v[0] + dx, r.v[1] + dy];
      for (const kk of ['a', 'b']) if (r[kk]?.fixed) r[kk].fixed = r[kk].fixed.map((q) => [q[0] + dx, q[1] + dy]);
      rules.push(r);
    }
  });
  // one sketch alone: its photo comes along (moved like its outlines); several: photos stay as they are
  const photo0 = fs.length === 1 && fs[0].p.photo ? { ...fs[0].p.photo, x: r4(fs[0].p.photo.x + offs[0][0]), y: r4(fs[0].p.photo.y + offs[0][1]) } : null;
  // what is around it: the board's plane in the world (Push up only: a Spin around board stands up through its axis)
  const Mb = frames[0].up ? null : new Matrix4().makeTranslation(0, 0, -frames[0].O.clone().applyMatrix4(frames[0].R.clone().invert()).z).multiply(frames[0].R.clone().invert());
  // a sketch object on its own is left out (it is what's being drawn); one that other steps were joined into stays,
  // as the whole object around the drawing
  const skip = fs.map((f) => f.body).filter((id) => isSimplePrimitive(store.doc, id) && !store.doc.features.some((x) => x.src === id));
  const k = openSketch({ loops, rules, photo: photo0 }, (out, outRules, extra = {}) => {
    // back into each sketch, in its own drawing coordinates; rules that link two sketches can't be kept
    const parts = fs.map(() => ({ loops: [], map: new Map() }));
    out.forEach((l, i) => { const k = l.owner ?? 0, P = parts[k]; P.map.set(i, P.loops.length); const c = JSON.parse(JSON.stringify(l)); delete c.owner; P.loops.push(c); });
    const keepRules = parts.map(() => []); let dropped = 0;
    for (const r0 of outRules) {
      const r = JSON.parse(JSON.stringify(r0)), refs = refsOfRule(r).filter((x) => x.l != null);
      const ks = new Set(refs.map((x) => out[x.l]?.owner ?? 0));
      if (ks.size > 1) { dropped++; continue; }
      const k = ks.size ? [...ks][0] : 0;
      for (const x of refs) x.l = parts[k].map.get(x.l);
      const [dx, dy] = offs[k];
      if (r.t === 'pin' && r.v) r.v = [r.v[0] - dx, r.v[1] - dy];
      for (const kk of ['a', 'b']) if (r[kk]?.fixed) r[kk].fixed = r[kk].fixed.map((q) => [q[0] - dx, q[1] - dy]);
      keepRules[k].push(r);
    }
    parts.forEach((P, k) => { const [dx, dy] = offs[k]; for (const l of P.loops) { if (l.type === 'circle') l.c = [r4(+l.c[0] - dx), r4(+l.c[1] - dy)]; else l.pts = l.pts.map((q) => [r4(q[0] - dx), r4(q[1] - dy)]); } });
    const empty = parts.map((P) => !solidLoops(P.loops).length);
    if (empty[0]) { toast(`${names[0]} needs at least one closed outline (it is the sketch the others join into). Nothing was changed.`, 'err', 6000); return; }
    const gone = [];
    store.commit((doc) => {
      fs.forEach((f0, k) => {
        if (empty[k]) {
          // all its shapes were joined into another sketch (or deleted): the object goes away
          const id = f0.body, simple = isSimplePrimitive(doc, id) && !doc.features.some((x) => x.src === id);
          if (simple) { doc.features = doc.features.filter((x) => x.id !== f0.id); delete doc.bodies[id]; } else doc.features.push({ id: store.newId('f'), type: 'delete', body: id });
          gone.push(names[k]); return;
        }
        const f = doc.features.find((x) => x.id === f0.id);
        f.p.loops = parts[k].loops;
        if (fs.length === 1) { if (extra.photo) f.p.photo = { ...extra.photo, x: r4(extra.photo.x - offs[0][0]), y: r4(extra.photo.y - offs[0][1]) }; else delete f.p.photo; }
        if (keepRules[k].length) f.p.rules = keepRules[k]; else delete f.p.rules;
        const np = posForFrame(frames[k], parts[k].loops); if (np) f.pos = np;
      });
    });
    const msg = [];
    if (gone.length) msg.push(`${gone.join(', ')} ${gone.length === 1 ? 'was' : 'were'} joined into ${names[0]}.`);
    if (dropped) msg.push(`${dropped} rule${dropped === 1 ? '' : 's'} linking different sketches ${dropped === 1 ? 'was' : 'were'} removed (each sketch keeps its own rules).`);
    if (msg.length) toast(msg.join(' '), 'info', 6000);
    if (ids.length > 1) select(ids.filter((id) => store.doc.bodies[id]));
  }, title || `Editing ${fs.length} sketches together`, { owners: names.map((name, k) => ({ name, color: OWNER_COLORS[k % OWNER_COLORS.length] })), ref: Mb ? sketchRef(Mb, skip) : null });
  if (Mb) addOutline(k, Mb, skip);
  return k;
}
/** Every loop reference in a rule (points, sides, corners, whole shapes). */
function refsOfRule(r) {
  const R = ruleRefs(r);
  return [...R.pts, ...R.sides, ...(R.corners || []), ...(R.whole || [])].filter((x) => x && !x.o && !x.fixed);
}

/** View > Look at face: turn the view to look straight at a picked face. */
export function lookAtFace(hit) {
  const d = bodyData(hit.body); if (!d) return;
  const P = Array.from(d.faces.subarray(hit.index * 6, hit.index * 6 + 3)), n = Array.from(d.faces.subarray(hit.index * 6 + 3, hit.index * 6 + 6));
  const size = Math.max(...[0, 1, 2].map((k) => d.bbox[1][k] - d.bbox[0][k]));
  vp.lookAt(P, n, size);
}

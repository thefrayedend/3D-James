// Paint kept with each object (doc.bodies[id].paint = { ops, at }): the strokes (see paint.js), in mm, and where the
// object's own shape stood when they were made (at = its position, turn and height). A shape moved or turned by
// changing its numbers (Properties, the bottom bar, the AI link) takes its paint along: the strokes are moved by the
// same amount when they are used. Everything that moves an object with a step (move, turn, size, copy, mirror)
// moves the strokes itself, with movePaint.
import { Matrix3, Matrix4, Vector3, Euler, MathUtils } from 'three';
import { creatorOf } from './store.js';
import { evalExpr } from './shared.js';
import { app, scope } from './state.js';

const placeOf = (doc, id, h) => {
  const f = creatorOf(doc, id);
  if (f?.type !== 'shape' || f.body !== id || h == null) return null;
  try { const sc = scope(); return [...f.pos.map((v) => evalExpr(v, sc)), ...f.rot.map((v) => evalExpr(v, sc)), h]; } catch { return null; }
};
// a shape stands with its middle half its height above pos, turned about that middle
const frame = (at) => new Matrix4().makeTranslation(at[0], at[1], at[2] + at[6] / 2)
  .multiply(new Matrix4().makeRotationFromEuler(new Euler(...at.slice(3, 6).map((d) => MathUtils.degToRad(d)), 'ZYX')));
const heightOf = (doc, id) => app.results.heights?.[creatorOf(doc, id)?.id];

const memo = new Map();
/** The strokes on an object, where it is now (null: none). */
export function worldPaint(doc, id) {
  const p = doc.bodies[id]?.paint;
  if (!p?.ops?.length) return null;
  if (!p.at) return p.ops;
  const now = placeOf(doc, id, heightOf(doc, id));
  if (!now || now.every((v, i) => Math.abs(v - p.at[i]) < 1e-7)) return p.ops;
  const key = now.join(','), m = memo.get(id);
  if (m && m.ops === p.ops && m.key === key) return m.out;
  const out = transformOps(p.ops, frame(now).multiply(frame(p.at).invert()));
  memo.set(id, { ops: p.ops, key, out });
  return out;
}

/** Keep these strokes (where the object is now) on the object. h: its shape's height, if it is about to change. */
export function setPaint(doc, id, ops, h = heightOf(doc, id)) {
  const b = { ...(doc.bodies[id] || {}) };
  if (ops?.length) b.paint = { ops, at: placeOf(doc, id, h) }; else delete b.paint;
  doc.bodies[id] = b;
}

/** Run change(), which moves the object by the world matrix M, and move its paint along. */
export function movePaint(doc, id, M, change, h) {
  const before = worldPaint(doc, id);
  const r = change?.();
  if (before) setPaint(doc, id, transformOps(before, M), h);
  return r;
}

/** The strokes moved, turned, sized or mirrored by a world matrix. */
export function transformOps(ops, M) {
  const k = Math.cbrt(Math.abs(M.determinant())) || 1;
  const L = new Matrix3().setFromMatrix4(M), N = L.clone().invert().transpose(); // directions across a surface (normals) go by N
  const pt = (p) => new Vector3(...p).applyMatrix4(M).toArray().map(r6);
  const dir = (d) => new Vector3(...d).applyMatrix3(L).normalize().toArray().map(r6);
  const nrm = (n) => new Vector3(...n).applyMatrix3(N).normalize().toArray().map(r6);
  return ops.map((op) => {
    const o = { ...op };
    if (op.p) o.p = pt(op.p);
    if (op.o) o.o = pt(op.o);
    if (op.n) o.n = nrm(op.n);
    if (op.d) o.d = dir(op.d);
    if (op.r) o.r = r6(op.r * k);
    // the band's two sides are planes across n: how far apart they end up
    if (op.w) o.w = r6(op.w / (new Vector3(...op.n).normalize().applyMatrix3(N).length() || 1));
    if (op.pts) {
      const v = new Vector3(), out = new Array(op.pts.length);
      for (let i = 0; i < op.pts.length; i += 3) { v.set(op.pts[i], op.pts[i + 1], op.pts[i + 2]).applyMatrix4(M); out[i] = r6(v.x); out[i + 1] = r6(v.y); out[i + 2] = r6(v.z); }
      o.pts = out;
    }
    return o;
  });
}
const r6 = (v) => Math.round(v * 1e6) / 1e6;

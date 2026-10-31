// Paint tab > Paint parts: colour parts of an object, like 3D Builder's Color mode (Cancel and Done, the colour,
// Coverage) with the slicers' brushes (OrcaSlicer's colour painting): Fill, Brush, Sphere, Band and Eraser.
// While painting, the strokes are kept here (with their own Undo); Done keeps them as one step, Cancel drops them.
import { store } from './store.js';
import { PALETTE } from './shared.js';
import { app } from './state.js';
import { h, ic, toast } from './ui/dom.js';
import { vp } from './view.js';
import { worldPaint, setPaint } from './painting.js';
import { meshContext, fillArea } from './paint.js';
import { renderCmdBar } from './ui/ribbon.js';
import { renderAll } from './ui/panels.js';

const MODES = [
  ['fill', 'PaintBucket', 'Fill', 'Click a face to fill it, like 3D Builder. Coverage sets how far it spreads: over edges that bend less than that many degrees (0: just that face).'],
  ['brush', 'Paintbrush', 'Brush', 'Paint with a round brush on the surface you see (like the Circle in OrcaSlicer).'],
  ['ball', 'Globe', 'Sphere', 'Paint everything within a ball around the pointer, on every side (like the Sphere in OrcaSlicer).'],
  ['band', 'Rows3', 'Band', 'Click to paint a level band all the way round the object, as tall as Size (like the Height range in OrcaSlicer).'],
  ['erase', 'Eraser', 'Eraser', 'Rub paint off with a round brush, back to the object\'s own color. (Holding Shift while painting does the same with any tool.)'],
];
export const paintPrefs = { mode: 'fill', color: '#ED1C24', size: 4, coverage: 30 };
const prefs = paintPrefs;

/** The strokes an object shows now (while painting: the ones being made). */
export function paintOpsOf(id) {
  const t = app.tool;
  if (t?.type === 'paint' && Object.hasOwn(t.ops, id)) return t.ops[id];
  return worldPaint(store.doc, id);
}

export function startPaint() {
  if (app.tool) return;
  app.tool = { type: 'paint', ops: {}, undo: [], redo: [], stroke: null };
  vp.setPaintMode(true);
  vp.renderer.domElement.addEventListener('wheel', onWheel, { capture: true, passive: false });
  renderCmdBar(); renderAll();
  toast('Pick a color and a tool, then click or drag on an object. Drag beside it to turn the view.', 'info', 5000);
}

/** Done (keep: true) or Cancel. */
export function finishPaint(keep) {
  const t = app.tool; if (t?.type !== 'paint') return;
  app.tool = null;
  vp.renderer.domElement.removeEventListener('wheel', onWheel, { capture: true });
  vp.setPaintMode(false);
  const ids = Object.keys(t.ops);
  if (keep && ids.length) store.commit((doc) => { for (const id of ids) if (doc.bodies[id]) setPaint(doc, id, t.ops[id]); }, 'ui');
  else vp.updateStyles(); // the strokes made go away again
  renderCmdBar(); renderAll();
}

export function paintUndo(redo) {
  const t = app.tool, from = redo ? t.redo : t.undo, to = redo ? t.undo : t.redo;
  const step = from.pop(); if (!step) { toast(redo ? 'Nothing to redo.' : 'Nothing to undo.'); return; }
  to.push({ id: step.id, ops: opsNow(step.id) });
  t.ops[step.id] = step.ops;
  vp.updateStyles();
}

const opsNow = (id) => paintOpsOf(id) || [];
function keep(id, op) {
  const t = app.tool;
  t.undo.push({ id, ops: opsNow(id) }); t.redo.length = 0;
  t.ops[id] = [...opsNow(id), op];
  vp.updateStyles();
}

// ---- the pointer (from the 3D view): hover shows what would be painted, down / drag / up paint
export function paintPointer(kind, hit, e) {
  const t = app.tool; if (t?.type !== 'paint') return false;
  const erase = prefs.mode === 'erase' || e?.shiftKey, color = erase ? null : prefs.color;
  const r = prefs.size / 2, show = erase ? '#ffffff' : prefs.color;
  if (kind === 'up') {
    const s = t.stroke; t.stroke = null;
    if (s) keep(s.id, s.op);
    return true;
  }
  if (kind === 'drag') {
    const s = t.stroke;
    if (s && hit && hit.body === s.id) {
      // dabs no more than a third of the brush apart, so the stroke has no gaps
      const last = s.op.pts.slice(-3), P = hit.point, d = Math.hypot(P[0] - last[0], P[1] - last[1], P[2] - last[2]);
      const n = Math.ceil(d / Math.max(r / 3, 0.05)), add = [];
      for (let i = 1; i <= n && n < 400; i++) for (let k = 0; k < 3; k++) add.push(last[k] + ((P[k] - last[k]) * i) / n);
      if (add.length) { s.op.pts.push(...add); vp.paintLive(s.id, { ...s.op, pts: add }); }
    }
    cursor(hit, r, show);
    return true;
  }
  const id = hit?.body, props = id && store.doc.bodies[id];
  if (kind === 'hover') {
    if (prefs.mode === 'fill' && hit && !props?.hole) {
      const key = [id, hit.tri, prefs.coverage, show, vp.bodies.get(id).key].join();
      if (t.preview !== key) { t.preview = key; vp.showPaintPreview(id, fillArea(meshContext(vp.bodies.get(id).data), hit.point, hit.normal, prefs.coverage, hit.tri), show); }
      vp.showPaintCursor(null);
    } else { t.preview = null; vp.showPaintPreview(null); cursor(hit, r, show); }
    vp.renderer.domElement.style.cursor = hit ? 'crosshair' : 'default';
    return true;
  }
  // down
  if (!hit) return false;
  if (props?.hole) { toast('Holes are not printed, so they cannot be painted.'); return false; }
  if (props?.hidden) return false;
  const c = color && color.toLowerCase();
  if (prefs.mode === 'fill') { keep(id, { t: 'fill', c, p: hit.point.map(r4), n: hit.normal.map(r4), a: prefs.coverage }); t.preview = null; vp.showPaintPreview(null); return true; }
  if (prefs.mode === 'band') { keep(id, { t: 'band', c, o: hit.point.map(r4), n: [0, 0, 1], w: prefs.size }); return true; }
  const op = { t: prefs.mode === 'ball' ? 'ball' : 'brush', c, r, pts: hit.point.map(r4) };
  if (op.t === 'brush') op.d = hit.dir.map(r4);
  t.stroke = { id, op };
  vp.paintLive(id, op);
  return true;
}
const r4 = (v) => Math.round(v * 1e4) / 1e4;

function cursor(hit, r, color) {
  if (!hit) { vp.showPaintCursor(null); return; }
  if (prefs.mode === 'band') {
    // a level ring around the object at the height it paints
    const b = vp.bodies.get(hit.body)?.data.bbox, R = b ? Math.hypot(b[1][0] - b[0][0], b[1][1] - b[0][1]) / 2 + 2 : 20;
    vp.showPaintCursor(b ? [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, hit.point[2]] : hit.point, [0, 0, 1], R, color);
    return;
  }
  // the brush looks along the view; the sphere's ring lies on the surface
  vp.showPaintCursor(hit.point, prefs.mode === 'ball' ? hit.normal : hit.dir.map((v) => -v), r, color);
}

// Alt + mouse wheel: brush size (as in OrcaSlicer); Ctrl + wheel: coverage
function onWheel(e) {
  if (!e.altKey && !e.ctrlKey) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const up = e.deltaY < 0;
  if (e.ctrlKey) prefs.coverage = Math.max(0, Math.min(180, prefs.coverage + (up ? 5 : -5)));
  else prefs.size = Math.max(0.5, Math.min(60, Math.round((prefs.size * (up ? 1.15 : 1 / 1.15)) * 10) / 10));
  renderCmdBar();
}

/** Clear: take all paint off the selected objects (or every object, when none is selected). */
function clearPaint() {
  const t = app.tool;
  const ids = (app.sel.length ? app.sel : [...vp.bodies.keys()]).filter((id) => opsNow(id).length);
  if (!ids.length) { toast('There is no paint to take off.'); return; }
  for (const id of ids) { t.undo.push({ id, ops: opsNow(id) }); t.ops[id] = []; }
  t.redo.length = 0;
  vp.updateStyles();
  toast(`Paint taken off ${ids.length === 1 ? 'the object' : `${ids.length} objects`}. Undo brings it back.`, 'info', 2500);
}

// ---- the command row while painting (in place of the Paint tab's)
export function paintBar(cb, sep) {
  const set = (k, v) => { prefs[k] = v; renderCmdBar(); };
  const sizeMode = prefs.mode !== 'fill';
  const [label, key, min, max, step, unit] = sizeMode ? ['Size', 'size', 0.5, 60, 0.5, 'mm'] : ['Coverage', 'coverage', 0, 180, 5, '°'];
  // the colors already on the objects first (like the slicers' filament list), then the palette
  const used = [...new Set([...vp.bodies.keys()].flatMap((id) => [store.doc.bodies[id]?.color, ...opsNow(id).map((o) => o.c)]).filter(Boolean).map((c) => c.toLowerCase()))];
  const sw = (c) => h('button', { class: 'swl' + (c.toLowerCase() === prefs.color.toLowerCase() ? ' on' : ''), style: `background:${c}`, title: c, 'aria-label': `Paint color ${c}`, onclick: () => set('color', c) });
  return [
    cb('', 'ArrowLeft', 'Cancel', () => finishPaint(false), { title: 'Stop painting and take off the paint added since you started' }),
    cb('', 'Check', 'Done', () => finishPaint(true), { title: 'Keep the paint (one Undo step)' }), sep(),
    h('span', { class: 'cmuted' }, 'Color'),
    h('div', { class: 'swgrid' }, [...PALETTE, ...used.filter((c) => !PALETTE.some((p) => p.toLowerCase() === c))].slice(0, 30).map(sw)),
    h('label', { class: 'cb', title: 'Pick any color' }, ic('Pipette'), h('span', {}, 'More'), h('input', { type: 'color', value: prefs.color, style: 'width:0;height:0;opacity:0;position:absolute', onchange: (e) => set('color', e.target.value) })), sep(),
    ...MODES.map(([k, icon, name, tip]) => cb(`paint-${k}`, icon, name, () => set('mode', k), { on: prefs.mode === k, title: tip })), sep(),
    h('label', { class: 'cmuted', title: sizeMode ? 'How wide the brush is (Alt + mouse wheel)' : 'How far a fill spreads: over edges that bend less than this (Ctrl + mouse wheel)' }, label,
      h('input', { type: 'range', min, max, step, value: prefs[key], style: 'width:110px;vertical-align:middle;margin:0 6px', 'aria-label': label, oninput: (e) => { prefs[key] = +e.target.value; e.target.nextSibling.textContent = `${prefs[key]} ${unit}`; } }),
      h('span', {}, `${prefs[key]} ${unit}`)), sep(),
    cb('paint-clear', 'Trash2', 'Clear', clearPaint, { title: 'Take all paint off the selected objects (or off every object, when none is selected)' }),
  ];
}

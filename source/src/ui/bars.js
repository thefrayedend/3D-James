// The bar at the bottom of the view (move / turn / size with typed X, Y, Z), the hint line and the status corner.
import { Matrix4 } from 'three';
import { store, creatorOf, isSimplePrimitive } from '../store.js';
import { evalExpr } from '../shared.js';
import { app, scope, saveSettings } from '../state.js';
import { $, h, ic, fmt, r4, toast, pickMenu } from './dom.js';
import { vp } from '../view.js';
import { engineReady, startWorker, ENGINE_TIMEOUT_MS } from '../build.js';
import { translateSel, rotateSel, commitTransform, markSettle } from '../commands.js';
import { updateFeature } from './fields.js';
import { ONE_CLICK } from '../tools.js';
import { openPanel } from './panels.js';

// the three mode buttons, drawn like 3D Builder's
const BAR_ICONS = {
  translate: '<path d="M4 13.5h6.5V20H4z"/><path d="M10.5 13.5 13 11h0M4 13.5 6.5 11h6.5v6.5l-2.5 2.5"/><path d="M14 8.5h6.5M17.5 5.5l3 3-3 3"/>',
  rotate: '<path d="M18.6 13.4A7 7 0 1 1 16.9 7"/><path d="M17.5 3.5v4h-4"/>',
  scale: '<rect x="8" y="8" width="8" height="8"/><path d="M3.5 7.5v-4h4M16.5 3.5h4v4M20.5 16.5v4h-4M7.5 20.5h-4v-4"/>',
};
export function barIcon(k) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24'); el.setAttribute('fill', 'none'); el.setAttribute('stroke', 'currentColor'); el.setAttribute('stroke-width', '1.4'); el.setAttribute('stroke-linejoin', 'round'); el.setAttribute('stroke-linecap', 'round');
  el.innerHTML = BAR_ICONS[k];
  return el;
}
const UNITS = { mm: 1, cm: 10, in: 25.4 };
const fmtBar = (v) => (app.settings.unit === 'in' && app.gizmo !== 'rotate' ? (+v.toFixed(3)).toString() : fmt(v));
const unitF = () => (app.gizmo === 'rotate' ? 1 : UNITS[app.settings.unit] || 1);

export function setBarValues(vals) {
  document.querySelectorAll('#objbar input.bv').forEach((inp, i) => { if (document.activeElement !== inp && vals[i] != null) inp.value = fmtBar(vals[i] / unitF()); });
}

export function barValues() {
  const box = vp.selectionBox();
  if (box.isEmpty()) return [0, 0, 0];
  if (app.gizmo === 'scale') return [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z];
  if (app.gizmo === 'rotate') {
    if (app.sel.length === 1 && isSimplePrimitive(store.doc, app.sel[0])) {
      const f = creatorOf(store.doc, app.sel[0]);
      try { return f.rot.map((v) => evalExpr(v, scope())); } catch { return [0, 0, 0]; }
    }
    return [0, 0, 0];
  }
  // like 3D Builder: X, Y and Z are all the middle of the object (a 20 mm cube on the floor shows Z = 10)
  return [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2];
}

export function barCommit(i, raw) {
  let v; try { v = evalExpr(raw, scope()) * unitF(); } catch (err) { toast(err.message, 'err'); renderObjBar(true); return; }
  const cur = barValues();
  if (Math.abs(v - cur[i]) < 1e-6) return;
  if (app.gizmo === 'translate') { const d = [0, 0, 0]; d[i] = v - cur[i]; translateSel(...d); return; }
  if (app.gizmo === 'scale') {
    if (!(v > 0)) { toast('Size must be above 0.', 'err'); renderObjBar(true); return; }
    const f = v / (cur[i] || 1);
    const s = app.settings.lock ? { x: f, y: f, z: f } : { x: i === 0 ? f : 1, y: i === 1 ? f : 1, z: i === 2 ? f : 1 };
    const box = vp.selectionBox();
    const piv = [(box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, box.min.z];
    const M = new Matrix4().makeTranslation(...piv).multiply(new Matrix4().makeScale(s.x, s.y, s.z)).multiply(new Matrix4().makeTranslation(-piv[0], -piv[1], -piv[2]));
    commitTransform(app.sel.slice(), M, { mode: 'scale', scale: s, pivot: piv });
    return;
  }
  // rotate
  if (app.sel.length === 1 && isSimplePrimitive(store.doc, app.sel[0])) {
    const f = creatorOf(store.doc, app.sel[0]);
    markSettle(app.sel);
    updateFeature(f.id, (x) => { x.rot[i] = r4(v); });
  } else rotateSel('xyz'[i], v);
}

export function renderSplitBar(bar) {
  const t = app.tool;
  bar.hidden = false; bar.replaceChildren();
  const mode = (m, label) => h('button', { class: 'mb' + (t.pmode === m ? ' on' : ''), title: label, 'aria-label': label, onclick: () => { t.pmode = m; vp.setPlane({ mode: m === 'move' ? 'move' : 'rotate' }); renderObjBar(true); } }, barIcon(m === 'move' ? 'translate' : 'rotate'));
  const field = (label, key, i) => {
    const inp = h('input', { class: 'bv', value: fmt(t[key] ?? 0), spellcheck: 'false', 'aria-label': label });
    const commit = () => { let v; try { v = evalExpr(inp.value, scope()); } catch (err) { toast(err.message, 'err'); return; } t[key] = r4(v); vp.setPlane({ [key]: t[key] }); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); inp.blur(); } });
    inp.addEventListener('blur', commit);
    return h('label', { class: 'bf ax' + 'XYZ'[i] }, h('span', { class: 'bl' }, label), inp);
  };
  bar.append(mode('move', 'Move the plane'), mode('rotate', 'Tilt the plane'),
    ...(t.pmode === 'rotate' ? [field('Roll', 'roll', 0), field('Pitch', 'pitch', 1), field('Yaw', 'yaw', 2), h('span', { class: 'bunit static' }, 'deg')] : [field('Offset', 'off', 0), h('span', { class: 'bunit static' }, 'mm')]));
}

export function renderObjBar(force) {
  const bar = $('objbar');
  if (app.tool?.type === 'split') { if (!force && bar.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; renderSplitBar(bar); return; }
  if (!app.sel.length || app.tool) { bar.hidden = true; return; }
  if (!force && bar.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  bar.hidden = false; bar.replaceChildren();
  const mode = (m, icon, label, key) => h('button', { class: 'mb' + (app.gizmo === m ? ' on' : ''), title: `${label} (${key})`, 'aria-label': label, onclick: () => setGizmo(m) }, barIcon(m));
  const vals = barValues();
  app.barBase = app.gizmo === 'scale' ? null : vals.slice();
  const scaleMode = app.gizmo === 'scale';
  const unit = app.gizmo === 'rotate' ? '°' : app.settings.unit || 'mm';
  const fields = ['X', 'Y', 'Z'].map((ax, i) => {
    const inp = h('input', { class: 'bv', value: fmtBar(vals[i] / unitF()), spellcheck: 'false', inputmode: 'decimal', 'aria-label': `${ax} ${scaleMode ? 'size' : app.gizmo === 'rotate' ? 'angle' : 'position'}` });
    let start = inp.value;
    inp.addEventListener('focus', () => { start = inp.value; inp.select(); vp.setActiveAxis(i); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const val = inp.value; inp.blur(); if (val !== start) barCommit(i, val); }
      else if (e.key === 'Escape') { inp.value = start; inp.blur(); }
      else if (e.key === 'Tab') { if (inp.value !== start) { const val = inp.value; setTimeout(() => barCommit(i, val), 0); } }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const st = (app.gizmo === 'rotate' ? 15 : app.settings.unit === 'in' ? 0.0625 : app.settings.unit === 'cm' ? 0.1 : app.settings.grid || 1) * (e.shiftKey ? 10 : 1);
        const n = parseFloat(inp.value); if (!Number.isFinite(n)) return;
        const nv = r4(n + (e.key === 'ArrowUp' ? st : -st));
        inp.value = fmt(nv); start = inp.value; barCommit(i, String(nv));
      }
    });
    inp.addEventListener('blur', () => { if (inp.value !== start && inp.value.trim()) { const val = inp.value; start = val; barCommit(i, val); } });
    return h('label', { class: 'bf ax' + ax + (vp.activeAxis === i ? ' on' : '') }, h('span', { class: 'bl' }, ax), inp);
  });
  bar.append(mode('translate', 'Move3d', 'Move', 'M'), mode('rotate', 'Rotate3d', 'Rotate', 'R'), mode('scale', 'Scale3d', 'Scale', 'S'),
    ...fields,
    app.gizmo === 'rotate' ? h('span', { class: 'bunit static' }, '°') : h('button', { class: 'bunit', title: 'Change units', onclick: (e) => pickMenu(e.currentTarget, 'Units', [['mm', 'Millimeters (mm)'], ['cm', 'Centimeters (cm)'], ['in', 'Inches (in)']], app.settings.unit || 'mm', (v) => { app.settings.unit = v; saveSettings(); renderObjBar(true); }) }, unit),
    ...(scaleMode ? [h('button', { class: 'mb' + (app.settings.lock ? ' on' : ''), title: app.settings.lock ? 'Scaling evenly (click to size each side on its own)' : 'Sizing each side on its own (click to scale evenly)', 'aria-label': 'Lock proportions', onclick: () => { app.settings.lock = !app.settings.lock; vp.lockScale = app.settings.lock; saveSettings(); renderObjBar(true); } }, ic(app.settings.lock ? 'Lock' : 'LockOpen'))] :
      // an empty place for it in the other modes: the bar keeps one width, so Move / Rotate / Scale never slide sideways
      [h('span', { class: 'mb', style: 'visibility:hidden', 'aria-hidden': 'true' })]));
}
/** Green underline under the active axis's box, blue under the others (like 3D Builder). */
export function markActiveAxis(ax) {
  document.querySelectorAll('#objbar .bf').forEach((el, i) => el.classList.toggle('on', i === ax));
}
export function setGizmo(m) { app.gizmo = m; vp.setGizmoMode(m); renderObjBar(true); }

export function renderHint() {
  const el = $('hint');
  const t = app.tool;
  if (!t) { el.hidden = true; return; }
  el.hidden = false; el.replaceChildren();
  const msg = { fillet: 'Click edges to round', chamfer: 'Click edges to bevel', shell: 'Click faces to leave open', extrude: 'Click a face', pushpull: 'Click a flat face to push or pull', layflat: 'Click the face that should sit on the bed', insertpocket: 'Click the face to put the insert pocket in', workplane: 'Click a flat or curved surface to build on', sketchplane: 'Click a spot on an object (a solid or an imported mesh) to place the sketch plane', align: 'Click a dot to line up with the outlined object (hover to preview). Click another picked object to line up with it instead', split: 'Move or tilt the green plane, then click Split', paint: 'Click or drag on an object to paint' }[t.type];
  const oneClick = ONE_CLICK.has(t.type);
  if (t.type === 'paint') { el.append(h('span', {}, msg), h('span', { class: 'k' }, 'Shift: rub off'), h('span', { class: 'k' }, 'Esc: Done')); return; }
  el.append(h('span', {}, msg), h('span', { class: 'k' }, t.type === 'align' ? 'Esc when done' : 'Esc to cancel'), ...(oneClick ? [] : [h('span', { class: 'k' }, 'Enter to apply')]));
}

export function renderStatus() {
  const el = $('status'); el.replaceChildren();
  if (app.backupError) el.append(h('span', { role: 'status', title: app.backupError, style: 'color:var(--danger);margin-right:8px' }, 'Backup unavailable ·'));
  if (app.engineError) {
    el.append(h('span', { role: 'alert' }, app.engineError), h('button', { class: 'btn', onclick: () => startWorker().catch(() => {}) }, 'Restart engine'));
    return;
  }
  if (!engineReady()) { el.append('Starting…'); return; }
  el.title = '';
  if (app.building) {
    // big models can take minutes: show how long it has been going
    const s = Math.round((Date.now() - (app.buildStarted || Date.now())) / 1000);
    el.append(h('span', { class: 'spin' }), s < 3 ? 'Building' : `Building… ${s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`}`);
    if (s >= 3) el.title = `Big models can take a while. The engine keeps going for up to ${Math.round(ENGINE_TIMEOUT_MS / 60000)} minutes.`;
  }
  else {
    const nErr = Object.keys(app.results.errors).length;
    el.append(`${app.results.bodies.size} object${app.results.bodies.size === 1 ? '' : 's'}`);
    el.title = `Last rebuild: ${app.results.ms < 1000 ? app.results.ms + ' ms' : (app.results.ms / 1000).toFixed(1) + ' s'}`;
    if (nErr) el.append(h('button', { class: 'linkish', title: 'Show the problems', onclick: () => { app.historyAll = true; openPanel('history'); } }, `· ${nErr} problem${nErr === 1 ? '' : 's'}`));
  }
}

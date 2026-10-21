// Placement controls shared by curved-surface picking and plane adjustment.
import { h, modal, toast } from './ui/dom.js';
import { app } from './state.js';
import { store } from './store.js';
import { vp } from './view.js';
import { setWorkplane } from './tools.js';
import { startSketch } from './sketchcmd.js';

export function adjustedPlane(base, offset, flip) {
  if (!Number.isFinite(offset) || Math.abs(offset) > 1000000) throw new Error('Enter a finite plane offset within ±1,000,000 mm.');
  const length = Math.hypot(...base.n);
  if (!(length > 1e-8) || !base.P.every(Number.isFinite)) throw new Error('The sketch plane is invalid.');
  const n = base.n.map((v) => v / length);
  return { ...base, P: base.P.map((v, i) => v + n[i] * offset), n: n.map((v) => v * (flip ? -1 : 1)) };
}

export function planeDialog(base, then) {
  const previous = app.workplane || null, source = store.doc, revision = store.revision;
  const offset = h('input', { class: 'in', type: 'number', value: '0', step: '0.5', 'aria-label': 'Plane offset (mm)' });
  const flip = h('input', { type: 'checkbox', 'aria-label': 'Flip plane direction' });
  const label = h('div', { class: 'muted', style: 'font-size:12px' });
  const current = () => adjustedPlane(base, Number(offset.value), flip.checked);
  const preview = () => {
    try { const p = current(); vp.setWorkplane(p); label.textContent = `Origin: ${p.P.map((v) => v.toFixed(2)).join(', ')} mm`; }
    catch (err) { label.textContent = err.message; }
  };
  offset.addEventListener('input', preview); flip.addEventListener('change', preview);
  const restore = () => vp.setWorkplane(previous);
  const use = (sketch) => {
    try {
      if (store.doc !== source || store.revision !== revision) throw new Error('The project changed. Close this dialog and place the plane again.');
      if (!offset.value.trim()) throw new Error('Enter a plane offset.');
      const plane = current(); setWorkplane(plane); close();
      if (then) then(); else if (sketch) startSketch();
      else toast('Sketch plane set. Use Sketch → On the sketch plane. Workplane returns to the floor.');
    } catch (err) { toast(err.message, 'err'); }
  };
  const close = modal('Sketch plane', h('div', {},
    h('p', {}, base.curved ? 'Tangent to the curved surface at the point you clicked.' : 'Aligned with the surface at the point you clicked.'),
    h('div', { class: 'field' }, h('label', {}, 'Offset from surface (mm)'), offset),
    h('label', { style: 'display:flex;gap:8px;align-items:center;margin:12px 0' }, flip, 'Flip extrusion / cut direction'), label,
    h('p', { class: 'muted' }, 'Positive offset moves outward; negative moves into the object. A cut goes inward from this plane. For a new object that will merge into a curved body, use a small negative offset for overlap.'),
    h('p', { class: 'muted' }, 'This is a flat plane, not a wrapped drawing. Placement stays fixed if the supporting body changes. Sketch solids retain their position when saved.')),
  (done) => [h('button', { class: 'btn', onclick: () => { restore(); done(); } }, 'Cancel'),
    ...(!then ? [h('button', { class: 'btn', onclick: () => use(false) }, 'Use plane')] : []),
    h('button', { class: 'btn primary', onclick: () => use(true) }, 'Sketch here')], restore);
  preview(); offset.focus(); offset.select();
}

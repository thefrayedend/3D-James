// Input boxes used in the side panel: numbers (or formulas with variables), drop-downs, check boxes, X/Y/Z rows.
import { store } from '../store.js';
import { evalExpr } from '../shared.js';
import { scope, app } from '../state.js';
import { h, r4, toast, isPlainNumber } from './dom.js';

export function exprField(label, value, onCommit, opts = {}) {
  const inp = h('input', { class: 'in', value: value ?? '', spellcheck: 'false', 'aria-label': label, inputmode: opts.text ? 'text' : 'decimal' });
  const parse = (txt) => {
    const s = txt.trim();
    if (opts.text) return s;
    if (isPlainNumber(s)) return parseFloat(s);
    evalExpr(s, scope());
    return s;
  };
  const commit = () => {
    if (String(inp.value) === String(value ?? '')) return;
    try { const v = parse(inp.value); inp.classList.remove('bad'); onCommit(v); }
    catch (err) { inp.classList.add('bad'); toast(err.message, 'err'); }
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { inp.blur(); }
    else if (e.key === 'Escape') { inp.value = value ?? ''; inp.classList.remove('bad'); inp.blur(); }
    else if (!opts.text && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && isPlainNumber(inp.value)) {
      e.preventDefault();
      const st = (opts.step || 1) * (e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
      const v = r4(parseFloat(inp.value) + (e.key === 'ArrowUp' ? st : -st));
      inp.value = v; onCommit(v); value = v;
    }
  });
  inp.addEventListener('blur', commit);
  const lab = h('label', { class: opts.text ? 'plain' : '' }, label);
  if (!opts.text) {
    // drag the label left/right to change the value
    lab.title = 'Drag left or right to change';
    lab.addEventListener('pointerdown', (e) => {
      const s = inp.value.trim(); if (!isPlainNumber(s)) return;
      const start = parseFloat(s), x0 = e.clientX; let last = start, moved = false;
      lab.setPointerCapture(e.pointerId);
      store.beginTransient();
      const mv = (ev) => {
        const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true;
        const st = (opts.step || 1) * (ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1);
        let v = r4(start + Math.round(dx / 4) * st);
        if (opts.min != null) v = Math.max(opts.min, v);
        if (v !== last) { last = v; inp.value = v; opts.onLive ? opts.onLive(v) : null; }
      };
      const up = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', up); store.endTransient(); if (moved && last !== start) { value = last; } };
      lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', up);
    });
  }
  let slider = opts.slider;
  if (slider === 'auto') {
    // a range that suits the current number: from the smallest allowed (or as far below zero as above) to a round
    // number well above it. Boxes holding a formula (like wall*2) get no slider.
    const cur = isPlainNumber(String(value ?? '').trim()) ? parseFloat(value) : null;
    if (cur == null || opts.text) slider = null;
    else {
      const top = niceAbove(Math.max(Math.abs(cur) * 2.5, opts.int ? 10 : 20));
      const lo = opts.min != null ? opts.min : -top;
      slider = { min: lo, max: top, step: opts.int ? 1 : top <= 20 ? 0.1 : top <= 100 ? 0.5 : 1 };
    }
  }
  if (slider) {
    // a slider under the box: drag it to see the change live (one undo step per drag); the box still takes exact numbers
    const { min = 0, max = 10, step = 0.1 } = slider;
    const cur = parseFloat(inp.value);
    const sl = h('input', { type: 'range', class: 'fslider', min, max: Math.max(max, Number.isFinite(cur) ? cur : max), step, value: Number.isFinite(cur) ? cur : min, 'aria-label': `${label} slider` });
    let live = false;
    sl.addEventListener('input', () => {
      const v = r4(parseFloat(sl.value)); inp.value = v;
      if (opts.onLive) { if (!live) { live = true; app.scrubbing = true; store.beginTransient(); } opts.onLive(v); }
    });
    sl.addEventListener('change', () => {
      const v = r4(parseFloat(sl.value)); value = v;
      if (opts.onLive) { live = false; app.scrubbing = false; store.endTransient(); store.emit('ui'); opts.onLiveEnd?.(v); } else onCommit(v);
    });
    return h('div', { class: 'field fs' }, lab, inp, sl);
  }
  return h('div', { class: 'field' }, lab, inp);
}

function niceAbove(x) {
  const p = 10 ** Math.floor(Math.log10(Math.max(x, 1e-9)));
  for (const m of [1, 2, 5, 10]) if (m * p >= x) return m * p;
  return 10 * p;
}

export function selectField(label, value, options, onChange) {
  return h('div', { class: 'field' }, h('label', { class: 'plain' }, label), h('select', { class: 'in', onchange: (e) => onChange(e.target.value) }, options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t))));
}
export function checkField(label, value, onChange) {
  return h('label', { class: 'check', style: 'margin:4px 0' }, h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onChange(e.target.checked) }), label);
}
export function trioField(label, values, onCommit, step = 1) {
  const cells = values.map((v, i) => {
    const inp = h('input', { class: 'in', value: v, spellcheck: 'false', 'aria-label': `${label} ${'XYZ'[i]}` });
    const commit = () => {
      if (String(inp.value) === String(v)) return;
      const s = inp.value.trim();
      try { const val = isPlainNumber(s) ? parseFloat(s) : (evalExpr(s, scope()), s); inp.classList.remove('bad'); onCommit(i, val); }
      catch (err) { inp.classList.add('bad'); toast(err.message, 'err'); }
    };
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inp.blur();
      else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && isPlainNumber(inp.value)) {
        e.preventDefault(); const st = step * (e.shiftKey ? 10 : 1);
        const nv = r4(parseFloat(inp.value) + (e.key === 'ArrowUp' ? st : -st)); inp.value = nv; v = nv; onCommit(i, nv);
      }
    });
    inp.addEventListener('blur', commit);
    return h('div', {}, inp, h('div', { class: 'ax' }, 'XYZ'[i]));
  });
  return h('div', { style: 'margin-bottom:8px' }, h('div', { style: 'color:var(--ink-2);margin-bottom:4px' }, label), h('div', { class: 'trio' }, cells));
}

export function updateFeature(fid, fn, kind = 'geom') { store.commit((doc) => { const f = doc.features.find((x) => x.id === fid); if (f) fn(f, doc); }, kind); }
export function liveFeature(fid, fn) { store.transient((doc) => { const f = doc.features.find((x) => x.id === fid); if (f) fn(f, doc); }); }

// Boolean previews run in the worker on a temporary document. Apply is one undo step.
import { store } from './store.js';
import { app, bodyName } from './state.js';
import { vp } from './view.js';
import { waitForBuild, requestBuild } from './build.js';
import { h, modal, toast } from './ui/dom.js';
import { selectField } from './ui/fields.js';
import { endTool } from './tools.js';
import { renderAll } from './ui/panels.js';

export function booleanPlan(base, op, ids, results) {
  const doc = JSON.parse(JSON.stringify(base));
  const newId = (prefix) => prefix + doc.seq++;
  let targets;
  if (op === 'subtract' && ids.length === 1) {
    const cutter = ids[0], bb = results.get(cutter)?.bbox;
    if (!bb) throw new Error('The cutter is unavailable.');
    targets = [...results].filter(([id, d]) => id !== cutter && !doc.bodies[id]?.hidden && !doc.bodies[id]?.hole && [0, 1, 2].every((i) => d.bbox[0][i] < bb[1][i] - 1e-4 && d.bbox[1][i] > bb[0][i] + 1e-4)).map(([id]) => id);
    if (!targets.length) throw new Error('The cutter does not overlap another object.');
    const cutters = targets.map((target, i) => {
      if (!i) return cutter;
      const id = newId('b');
      doc.features.push({ id: newId('f'), type: 'copy', body: id, src: cutter, d: [0, 0, 0] });
      doc.bodies[id] = { ...doc.bodies[cutter], name: `${doc.bodies[cutter]?.name || 'Cutter'} copy` }; delete doc.bodies[id].group;
      return id;
    });
    targets.forEach((body, i) => { doc.features.push({ id: newId('f'), type: 'combine', op, body, tools: [cutters[i]] }); doc.bodies[body] = { ...doc.bodies[body], hole: false }; });
  } else {
    if (ids.length < 2) throw new Error('Select two or more objects first.');
    const [body, ...tools] = ids; targets = [body];
    doc.features.push({ id: newId('f'), type: 'combine', op, body, tools });
    doc.bodies[body] = { ...doc.bodies[body], hole: op === 'union' && ids.every((id) => doc.bodies[id]?.hole) };
  }
  return { doc, targets };
}
let counter = 0;
export async function previewCombine(op) {
  try {
    if (app.preview) return;
    if (app.tool) endTool();
    await waitForBuild();
    const base = JSON.parse(JSON.stringify(store.doc)), source = store.doc, revision = store.revision;
    const ids = app.sel.slice(), results = new Map(app.results.bodies), originalSelection = ids.slice();
    if (!ids.length) return toast('Select the objects to combine first.');
    booleanPlan(base, op, ids, results); // Validate before opening or locking any controls.
    let plan, close, apply;
    const status = h('p', { class: 'muted', role: 'status' }, 'Building preview…');
    const description = h('div', { class: 'card muted' });
    const cancel = () => {
      document.body.classList.remove('operation-preview');
      app.preview = null; vp.mode = 'select'; app.sel = originalSelection;
      requestBuild(); renderAll();
    };
    const rebuild = () => {
      try {
        plan = booleanPlan(base, op, ids, results);
        description.textContent = ids.length === 1 ? `Cutter: ${bodyName(ids[0])}. Cuts ${plan.targets.length} overlapping object(s).` :
          `Keep: ${bodyName(ids[0])}. ${op === 'subtract' ? 'Cut with' : op === 'union' ? 'Merge in' : 'Intersect with'}: ${ids.slice(1).map(bodyName).join(', ')}.`;
        if (apply) apply.disabled = true;
        status.textContent = 'Building preview…';
        app.preview = { id: `boolean-${++counter}`, doc: plan.doc, cancel: () => { cancel(); close(); }, onBuilt: (m) => {
          const errors = Object.values(m.errors);
          status.textContent = errors.length ? errors.join('\n') : 'Preview ready. Apply keeps this result; Cancel restores the original objects.';
          if (apply) apply.disabled = errors.length > 0;
        } };
        vp.mode = 'preview'; vp.clearHandles(); requestBuild();
      } catch (err) { status.textContent = err.message; if (apply) apply.disabled = true; }
    };
    const content = h('div', {}, ids.length > 1 ? selectField('Object to keep', ids[0], ids.map((id) => [id, bodyName(id)]), (id) => {
      ids.splice(ids.indexOf(id), 1); ids.unshift(id); rebuild();
    }) : null, description, status);
    close = modal({ union: 'Preview Merge', subtract: 'Preview Subtract', intersect: 'Preview Intersect' }[op], content, (done) => [
      h('button', { class: 'btn', onclick: () => { cancel(); done(); } }, 'Cancel'),
      apply = h('button', { class: 'btn primary', disabled: true, 'data-action': 'apply-preview', onclick: () => {
        if (app.building || app.pending || store.revision !== revision || store.doc !== source) return toast('The project changed. Cancel and preview again.', 'err');
        document.body.classList.remove('operation-preview'); app.preview = null; vp.mode = 'select'; close();
        store.commit((doc) => { doc.features = plan.doc.features; doc.bodies = plan.doc.bodies; doc.seq = plan.doc.seq; });
        app.sel = plan.targets; vp.setSelection(app.sel); renderAll();
      } }, 'Apply'),
    ], cancel);
    // A floating modeless panel leaves the canvas available for orbiting the preview.
    const dialog = content.closest('dialog');
    dialog.close(); dialog.classList.add('preview-dialog');
    dialog.parentElement.classList.add('preview-back');
    dialog.style.cssText += ';position:fixed;inset:110px 16px auto auto;margin:0;pointer-events:auto';
    dialog.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); close(); } });
    document.body.classList.add('operation-preview'); dialog.show();
    rebuild();
  } catch (err) { toast(err.message, 'err', 7000); }
}

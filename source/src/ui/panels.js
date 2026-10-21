// The fold-away panel on the right: Properties, History (how things were made) and Objects.
import { store, featureRefs, describeFeature, stepTree } from '../store.js';
import { evalExpr, varScope } from '../shared.js';
import { app, saveSettings, bodyData, bodyName } from '../state.js';
import { $, h, ic, fmt, toast, featureIcon, modal } from './dom.js';
import { select, editStep, setBodyProp } from '../commands.js';
import { updateFeature } from './fields.js';
import { renderProps, renderFeaturePanel } from './props.js';
import { renderObjBar, renderHint, renderStatus } from './bars.js';
import { dependentSteps } from '../history.js';
import { renderCmdBar, updateToolbar } from './ribbon.js';

export { renderProps, renderStatus };

export function renderAll() { renderSide(); renderObjBar(); renderHint(); renderStatus(); if (app.tab === 'Paint') renderCmdBar(); else updateToolbar(); }

export function openPanel(tab) { app.settings.panelOpen = true; app.panelTab = tab; saveSettings(); renderSide(); }
function closePanel() { app.settings.panelOpen = false; saveSettings(); renderSide(); }

// Each tab remembers how far down it was scrolled, so clicking something never throws you back to the top.
const scrolled = {};
const sideBody = () => document.querySelector('#side .side-body');
function rememberScroll() { const b = sideBody(); if (b) scrolled[app.panelTab] = b.scrollTop; }
function restoreScroll() { const b = sideBody(); if (b && scrolled[app.panelTab] != null) b.scrollTop = scrolled[app.panelTab]; }

export function renderSide() {
  const side = $('side');
  if (app.scrubbing) return; // a slider is being dragged: don't redraw it away
  if (side.querySelector('.side-body')) rememberScroll();
  side.replaceChildren();
  const open = !!app.settings.panelOpen;
  side.classList.toggle('open', open);
  const tabs = [['props', 'Properties'], ['history', 'History'], ['objects', 'Objects']];
  if (!open) {
    side.append(h('button', { class: 'strip-btn', title: 'Show panel', 'aria-label': 'Show panel', onclick: () => openPanel(app.panelTab || 'props') }, ic('ChevronLeft')),
      ...tabs.map(([k, label]) => h('button', { class: 'strip-tab', onclick: () => openPanel(k) }, label)));
    return;
  }
  side.append(h('div', { class: 'side-head' },
    ...tabs.map(([k, label]) => h('button', { class: 'stab' + (app.panelTab === k ? ' on' : ''), onclick: () => { rememberScroll(); app.panelTab = k; saveSettings(); renderSide(); } }, label)),
    h('button', { class: 'ib', title: 'Hide panel', 'aria-label': 'Hide panel', onclick: closePanel }, ic('ChevronRight'))));
  const body = h('div', { class: 'side-body' });
  side.append(body);
  if (app.panelTab === 'history') {
    body.append(h('div', { class: 'list', id: 'leftList' }), h('div', { class: 'vars', id: 'vars' }));
    renderHistory($('leftList'));
    renderVars();
  } else if (app.panelTab === 'objects') {
    body.append(h('div', { class: 'list', id: 'leftList' }));
    renderObjects($('leftList'));
  } else {
    body.append(h('div', { class: 'props', id: 'props' }));
    renderProps();
  }
  restoreScroll();
}

// ---------------------------------------------------------------- History
// With an object selected: how that object was made, as a tree. Under each merge or cut are the shapes it used,
// each with its own steps. Click a step to change it right there; shapes that were cut away show as see-through ghosts.
const shown = new Map(); // which 'used' groups are open; by default only the first level is
const usesLabel = (f, body) => (f.type === 'copy' ? 'copied from' : f.type === 'split' ? 'split from' : f.op === 'subtract' || store.doc.bodies[body]?.hole ? 'cut out' : f.op === 'intersect' ? 'overlapped with' : 'merged in');

function stepRow(f, depth, opts = {}) {
  const doc = store.doc;
  const d = describeFeature(doc, f);
  const err = app.results.errors[f.id];
  const open = app.feature === f.id;
  const row = h('div', { class: `row-item step${open ? ' sel' : ''}${f.suppressed ? ' off' : ''}${err ? ' err' : ''}`, style: `--depth:${depth}`, title: err || '', onclick: () => {
    if (open) { editStep(null); renderSide(); return; }
    if (opts.selectBody && app.results.bodies.has(f.body)) app.sel = [f.body];
    editStep(f.id);
    renderAll();
  } },
  h('span', { class: 'ic' }, ic(err ? 'TriangleAlert' : featureIcon(f))),
  h('div', { style: 'min-width:0' }, h('div', { class: 't' }, f.name || d.title), h('div', { class: 's' }, err || (!f.name ? d.sub : f.type === 'shape' ? d.sub : `${d.title} · ${d.sub}`))),
  h('div', { class: 'acts' },
    h('button', { class: 'ib', title: f.suppressed ? 'Turn this step back on' : 'Turn this step off', onclick: (e) => { e.stopPropagation(); updateFeature(f.id, (x) => { x.suppressed = !x.suppressed; }); } }, ic(f.suppressed ? 'EyeOff' : 'Eye')),
    h('button', { class: 'ib', title: 'Delete this step', onclick: (e) => { e.stopPropagation(); deleteFeature(f.id); } }, ic('Trash2'))));
  if (!open) return [row];
  const editor = h('div', { class: 'props inline', style: `--depth:${depth}` });
  renderFeaturePanel(editor, f, { inline: true });
  return [row, editor];
}

function treeRows(nodes, depth, out) {
  for (const { f, uses } of nodes) {
    out.push(...stepRow(f, depth));
    for (const u of uses) {
      const key = `${f.id}:${u.body}`;
      const shut = !(shown.get(key) ?? depth < 1);
      out.push(h('div', { class: 'row-uses', style: `--depth:${depth + 1}`, title: shut ? 'Show its steps' : 'Hide its steps', onclick: () => { shown.set(key, shut); renderSide(); } },
        ic(shut ? 'ChevronRight' : 'ChevronDown'),
        h('span', {}, `${usesLabel(f, u.body)}: `, h('b', { class: 'link', title: app.results.bodies.has(u.body) ? 'Select it' : 'Show where it was (see-through)', onclick: (e) => {
          // a link to the object that shaped this one: select it if it still exists, otherwise show it as a ghost
          e.stopPropagation();
          if (app.results.bodies.has(u.body)) { select([u.body]); return; }
          const last = u.steps[u.steps.length - 1]; if (last) { editStep(last.f.id); renderAll(); }
        } }, bodyName(u.body))),
        h('span', { class: 'n' }, `${u.steps.length} step${u.steps.length === 1 ? '' : 's'}`)));
      if (!shut) treeRows(u.steps, depth + 1, out);
    }
  }
  return out;
}

function renderHistory(list) {
  const doc = store.doc;
  const root = app.sel.length === 1 ? app.sel[0] : null;
  const showAll = app.historyAll || !root;
  if (root) {
    list.append(h('div', { class: 'seg' },
      h('button', { class: showAll ? '' : 'on', onclick: () => { app.historyAll = false; renderSide(); } }, 'This object'),
      h('button', { class: showAll ? 'on' : '', onclick: () => { app.historyAll = true; renderSide(); } }, 'All steps')));
  }
  if (!showAll) {
    list.append(h('div', { class: 'hist-h' }, 'How ', h('b', {}, bodyName(root)), ' was made'));
    list.append(...treeRows(stepTree(doc, root), 0, []));
    return;
  }
  const errs = Object.entries(app.results.errors);
  if (errs.length) {
    list.append(h('div', { class: 'err-box', style: 'margin:2px 2px 8px' }, h('b', {}, `${errs.length} step${errs.length === 1 ? '' : 's'} could not be built`),
      ...errs.map(([fid, msg]) => {
        const f = doc.features.find((x) => x.id === fid);
        const label = f ? f.name || describeFeature(doc, f).title : 'An object';
        return h('div', { style: 'margin-top:6px;color:var(--ink)' }, h('div', {}, h('b', {}, label), ': ', msg),
          f ? h('div', { class: 'chip-row', style: 'margin-top:4px' },
            h('button', { class: 'chip', onclick: () => { editStep(fid); renderAll(); } }, 'Edit'),
            h('button', { class: 'chip', onclick: () => updateFeature(fid, (x) => { x.suppressed = true; }) }, 'Turn off'),
            h('button', { class: 'chip', onclick: () => deleteFeature(fid) }, 'Delete step')) : null);
      })));
  }
  if (!doc.features.length) { list.append(h('div', { class: 'empty' }, 'Every step you take shows up here. Click a step to change it later, or turn it off to see the model without it.')); return; }
  if (!root) list.append(h('div', { class: 'muted', style: 'padding:2px 8px 8px' }, 'Select an object to see just the steps that made it.'));
  for (const f of doc.features) list.append(...stepRow(f, 0, { selectBody: true }));
}

export function deleteFeature(fid, cascade = false, approved = false) {
  const dependents = dependentSteps(store.doc, fid);
  if (dependents.length && !approved) {
    const f = store.doc.features.find((x) => x.id === fid);
    modal('Delete history step?', h('div', {}, h('p', {}, `${f?.name || describeFeature(store.doc, f).title} has ${dependents.length} later step(s) that depend on its geometry.`),
      h('p', { class: 'muted' }, 'Deleting only this step may leave later steps with missing objects or changed edges/faces. Both choices can be undone.')),
      (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'),
        h('button', { class: 'btn', onclick: () => { done(); deleteFeature(fid, false, true); } }, 'Delete this step only'),
        h('button', { class: 'btn danger', onclick: () => { done(); deleteFeature(fid, true, true); } }, `Delete with ${dependents.length} dependent step(s)`)]);
    return;
  }
  const removed = new Set([fid, ...(cascade ? dependents : [])]);
  store.commit((doc) => {
    const f = doc.features.find((x) => x.id === fid); if (!f) return false;
    doc.features = doc.features.filter((x) => !removed.has(x.id));
    // drop body records nobody creates any more
    for (const id of Object.keys(doc.bodies)) if (!doc.features.some((x) => featureRefs(x).includes(id))) delete doc.bodies[id];
  });
  if (removed.has(app.feature)) editStep(null);
  renderAll();
}

let varsOpen = null; // folded away by default when a project has lots of them
function renderVars() {
  const box = $('vars'); box.replaceChildren();
  const doc = store.doc;
  const open = varsOpen ?? doc.vars.length <= 6;
  box.append(h('div', { class: 'sec-h toggle', onclick: () => { varsOpen = !open; renderSide(); } }, ic(open ? 'ChevronDown' : 'ChevronRight'), h('span', {}, `Variables${doc.vars.length ? ` (${doc.vars.length})` : ''}`),
    h('button', { class: 'ib', title: 'Add a variable', onclick: (e) => {
      e.stopPropagation(); varsOpen = true;
      store.commit((d) => { let i = 1; while (d.vars.some((v) => v.name === `size${i}`)) i++; d.vars.push({ name: d.vars.length ? `size${i}` : 'wall', expr: '2' }); });
    } }, ic('Plus'))));
  if (!open) return;
  if (!doc.vars.length) box.append(h('div', { class: 'muted', style: 'font-size:12px' }, 'Name a number once, like wall = 2, then type wall or wall*2 into any size box. Change it here and everything updates.'));
  const sc = varScope(doc.vars);
  doc.vars.forEach((v, i) => {
    const name = h('input', { class: 'in', value: v.name, 'aria-label': 'Variable name', spellcheck: 'false', onchange: (e) => {
      const nv = e.target.value.trim().replace(/[^A-Za-z0-9_]/g, '');
      if (!/^[A-Za-z_]/.test(nv)) { toast('Names start with a letter.', 'err'); e.target.value = v.name; return; }
      store.commit((d) => { d.vars[i].name = nv; });
    } });
    let bad = false; try { evalExpr(v.expr, Object.fromEntries(Object.entries(sc).filter(([k]) => k !== v.name))); } catch { bad = true; }
    const val = h('input', { class: 'in' + (bad ? ' bad' : ''), value: v.expr, 'aria-label': `Value of ${v.name}`, spellcheck: 'false', title: sc[v.name] != null ? `= ${fmt(sc[v.name])}` : '', onchange: (e) => store.commit((d) => { d.vars[i].expr = e.target.value.trim(); }) });
    box.append(h('div', { class: 'var-row' }, name, h('span', {}, '='), val, h('button', { class: 'ib', title: 'Remove', onclick: () => store.commit((d) => { d.vars.splice(i, 1); }) }, ic('X'))));
  });
}

// ---------------------------------------------------------------- Objects
function renderObjects(list) {
  const doc = store.doc;
  const ids = [...app.results.bodies.keys()];
  if (!ids.length) list.append(h('div', { class: 'empty' }, 'No objects yet. Add a shape from the toolbar.'));
  for (const id of ids) {
    const p = doc.bodies[id] || {};
    const d = bodyData(id);
    list.append(h('div', { class: `row-item${app.sel.includes(id) ? ' sel' : ''}${p.hidden ? ' off' : ''}`, onclick: (e) => {
      const add = e.ctrlKey || e.metaKey || e.shiftKey;
      select(add ? (app.sel.includes(id) ? app.sel.filter((x) => x !== id) : [...app.sel, id]) : [id]);
    } },
    h('span', { class: 'ic' }, p.hole ? ic('CircleDashed') : h('span', { class: 'swatch', style: `background:${p.color || '#C3C3C3'}` })),
    h('div', { style: 'min-width:0' }, h('div', { class: 't' }, p.name || id), h('div', { class: 's' }, d ? `${fmt(d.bbox[1][0] - d.bbox[0][0])} × ${fmt(d.bbox[1][1] - d.bbox[0][1])} × ${fmt(d.bbox[1][2] - d.bbox[0][2])} mm${p.hole ? ' · hole' : ''}` : '')),
    h('div', { class: 'acts' }, h('button', { class: 'ib', title: p.hidden ? 'Show' : 'Hide', onclick: (e) => { e.stopPropagation(); setBodyProp([id], 'hidden', !p.hidden); } }, ic(p.hidden ? 'EyeOff' : 'Eye')))));
  }
}

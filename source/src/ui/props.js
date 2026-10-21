// The Properties tab: the selected object, the step being edited, or the open tool.
import { Matrix4, Vector3, Quaternion } from 'three';
import { store, creatorOf, isSimplePrimitive, featuresOfBody, describeFeature, nextColor, stepTree } from '../store.js';
import { SHAPES, threadDefaults, evalExpr, PALETTE, HARDWARE, HARDWARE_DEFAULTS } from '../shared.js';
import { PART_SHAPES, presetFor } from '../catalog.js';
import { editSketch, editSketches, sketchGroup } from '../sketchcmd.js';
import { app, scope, bodyData, bodyName } from '../state.js';
import { $, h, ic, fmt, r2, r4, isPlainNumber } from './dom.js';
import { vp } from '../view.js';
import { duplicateSel, deleteSel, setBodyProp, translateSel, rotateSel, editStep } from '../commands.js';
import { endTool, applyTool, quickEdges, ONE_CLICK, toolPreview, toolPreviewDone } from '../tools.js';
import { exprField, selectField, checkField, trioField, updateFeature, liveFeature } from './fields.js';
import { openPanel, deleteFeature } from './panels.js';
import { previewCombine } from '../boolean-preview.js';
import { historyDependencies, dependentSteps, canMoveFeature, moveFeature } from '../history.js';
import { renderMeasurePanel } from '../measure.js';
import { embossFields } from './emboss.js';
import { saveToMyParts } from '../myparts.js';

export function shapeFields(f) {
  const def = SHAPES[f.kind]; if (!def) return [];
  const out = [];
  for (const [key, label, type, a, b] of def.fields) {
    const extra = type === 'select' ? a : null;
    const opts = (type === 'select' ? b : a) || {};
    if (opts.show && !opts.show(f.p)) continue;
    if (f.kind === 'thread' && (key === 'D' || key === 'P') && f.p.size !== 'custom') {
      out.push(h('div', { class: 'field' }, h('label', { class: 'plain' }, label), h('div', { class: 'num', style: 'padding-left:9px' }, `${f.p[key]} mm`)));
      continue;
    }
    if (type === 'select') {
      out.push(selectField(label, f.p[key], extra, (v) => updateFeature(f.id, (x) => {
        x.p[key] = v;
        if (x.kind === 'thread' && key === 'size' && v !== 'custom') Object.assign(x.p, threadDefaults(v));
        if (key === 'size' && HARDWARE[x.kind]?.[v]) Object.assign(x.p, HARDWARE_DEFAULTS(x.kind, v));
        if ((key === 'size' || key === 'type') && PART_SHAPES[x.kind]) Object.assign(x.p, presetFor(x.kind, x.p));
        if (x.kind === 'sketch' && key === 'mode' && v === 'revolve' && x.p.angle == null) x.p.angle = 360;
        if (x.kind === 'thread' && key === 'kind') {
          store.doc.bodies[x.body] && Object.assign(store.doc.bodies[x.body], { hole: v === 'cutter' });
        }
      })));
    } else if (type === 'bool') {
      out.push(checkField(label, f.p[key], (v) => updateFeature(f.id, (x) => { x.p[key] = v; })));
    } else {
      out.push(exprField(label, f.p[key], (v) => updateFeature(f.id, (x) => { x.p[key] = type === 'int' && typeof v === 'number' ? Math.round(v) : v; }), {
        text: type === 'text', step: type === 'int' ? 1 : key === 'clear' || key === 'P' ? 0.05 : 1,
        slider: type === 'text' ? null : 'auto', int: type === 'int', min: type === 'int' ? Math.min(3, Number(f.p[key]) || 0) : ['round', 'clear', 'hole', 'fd', 'ft', 'd1', 'd2', 'stud'].includes(key) ? 0 : 0.1,
        onLive: (v) => liveFeature(f.id, (x) => { x.p[key] = type === 'int' ? Math.round(v) : v; }),
      }));
    }
  }
  return out;
}

// The file keeps a shape's bottom Z (pos); like 3D Builder, the Z you see and type is its middle.
const halfH = (f) => (app.results.heights?.[f.id] ?? 0) / 2;
const zTail = (k) => ` - ${r4(k)}`;
function shownPos(f) {
  const k = halfH(f), z = f.pos[2];
  if (!k) return f.pos;
  let shown;
  if (typeof z === 'number' || isPlainNumber(String(z))) shown = r4(+z + k);
  else if (String(z).endsWith(zTail(k))) shown = String(z).slice(0, -zTail(k).length).replace(/^\((.*)\)$/, '$1');
  else { try { shown = r4(evalExpr(z, scope()) + k); } catch { shown = z; } }
  return [f.pos[0], f.pos[1], shown];
}
function storedZ(v, k) {
  if (!k) return v;
  return typeof v === 'number' ? r4(v - k) : `(${v})${zTail(k)}`;
}
export function placementCard(f) {
  return h('div', { class: 'card' }, h('h3', {}, 'Placement'),
    trioField('Position of the middle (mm)', shownPos(f), (i, v) => updateFeature(f.id, (x) => { x.pos[i] = i === 2 ? storedZ(v, halfH(f)) : v; })),
    trioField('Rotation (degrees)', f.rot, (i, v) => updateFeature(f.id, (x) => { x.rot[i] = v; }), 15),
    f.stretch ? trioField('Stretch (1 = none)', f.stretch, (i, v) => updateFeature(f.id, (x) => { x.stretch[i] = v; if (x.stretch.every((s) => +s === 1)) delete x.stretch; }), 0.1) : null);
}

export function errorBox(fid) { const e = app.results.errors[fid]; return e ? h('div', { class: 'err-box', role: 'alert' }, e) : null; }

// slider range for rounding / beveling edges: up to about half the object's thinnest size
function edgeSlider(body) {
  const b = bodyData(body)?.bbox; const thin = b ? Math.min(...[0, 1, 2].map((i) => b[1][i] - b[0][i])) : 20;
  const max = Math.max(1, Math.round(thin / 2 * 10) / 10);
  return { min: 0.1, max, step: max > 20 ? 0.5 : 0.1 };
}
export function renderProps() {
  const el = $('props'); if (!el) return; el.replaceChildren();
  const doc = store.doc;
  if (app.tool) return renderToolPanel(el);
  const f = app.feature && doc.features.find((x) => x.id === app.feature);
  if (f) return renderFeaturePanel(el, f);
  if (app.sel.length === 1) return renderObjectPanel(el, app.sel[0]);
  if (app.sel.length > 1) {
    el.append(h('div', {}, h('h2', {}, `${app.sel.length} objects selected`), h('div', { class: 'sub' }, `First selected: ${bodyName(app.sel[0])}`)));
    if (app.sel.every((id) => creatorOf(doc, id)?.kind === 'sketch')) {
      const g = sketchGroup(app.sel);
      el.append(h('div', { class: 'card' }, h('h3', {}, 'Sketches'),
        h('div', { class: 'muted', style: 'margin-bottom:8px' }, g.why || 'Open them on one board, each in its own color: change any of them, line them up with each other, or join them into one sketch.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn', disabled: !!g.why, onclick: () => editSketches(app.sel) }, ic('PenLine'), 'Edit sketches together'))));
    }
    el.append(
      h('div', { class: 'card' }, h('h3', {}, 'Combine'),
        h('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Merge joins them. Subtract cuts the others out of the first one you clicked. Intersect keeps only the overlap. Objects marked as holes are cut out when you merge.'),
        h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => previewCombine('union') }, ic('SquaresUnite'), 'Merge'), h('button', { class: 'btn', onclick: () => previewCombine('subtract') }, ic('SquaresSubtract'), 'Subtract'), h('button', { class: 'btn', onclick: () => previewCombine('intersect') }, ic('SquaresIntersect'), 'Intersect'))),
      h('div', { class: 'card' }, h('h3', {}, 'Color'), swatches(app.sel)),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: duplicateSel }, ic('Copy'), 'Duplicate'), h('button', { class: 'btn danger', onclick: deleteSel }, ic('Trash2'), 'Delete')));
    return;
  }
  renderWelcome(el);
}

export function swatches(ids) {
  const cur = store.doc.bodies[ids[0]]?.color;
  return h('div', { class: 'swatches' }, PALETTE.map((c) => h('button', { class: 'sw' + (c.toLowerCase() === String(cur).toLowerCase() ? ' on' : ''), style: `background:${c}`, title: c, 'aria-label': `Color ${c}`, onclick: () => setBodyProp(ids, 'color', c) })),
    h('input', { type: 'color', value: cur || '#C3C3C3', title: 'Custom color', style: 'width:28px;height:24px;border:0;background:none;padding:0', onchange: (e) => setBodyProp(ids, 'color', e.target.value) }));
}

/** The sketch steps an object was made from, its own first (walks its History tree, so merged and cut-out sketches count). */
function sketchesIn(doc, id) {
  const out = [];
  const walk = (nodes) => { for (const { f, uses } of nodes) { if (f.type === 'shape' && f.kind === 'sketch' && !out.includes(f)) out.push(f); for (const u of uses) walk(u.steps); } };
  walk(stepTree(doc, id));
  return out.sort((a, b) => (b.body === id) - (a.body === id));
}

export function renderObjectPanel(el, id) {
  const doc = store.doc; const p = doc.bodies[id] || {}; const d = bodyData(id);
  const cf = creatorOf(doc, id);
  const simple = isSimplePrimitive(doc, id);
  const nameIn = h('input', { class: 'in', value: p.name || '', style: 'font:600 15px var(--ui);height:32px', 'aria-label': 'Object name', onchange: (e) => setBodyProp([id], 'name', e.target.value.trim() || p.name) });
  el.append(h('div', {}, nameIn, h('div', { class: 'sub' }, `${d?.solid ? 'Solid' : 'Mesh'}${cf?.type === 'shape' ? ' · ' + SHAPES[cf.kind]?.label : ''}${d ? ` · ${fmt(d.volume / 1000)} cm³` : ''}`)));
  // every sketch that went into this object (its own, and any merged into it or cut out of it): one click to edit
  const sketches = sketchesIn(doc, id);
  if (sketches.length) el.append(h('div', { class: 'btns' }, ...sketches.map((f) => h('button', { class: 'btn', title: 'Open this sketch on the drawing board to change its outline', onclick: () => editSketch(f) }, ic('PenLine'),
    f.body === id ? 'Edit sketch' : `Edit sketch: ${doc.bodies[f.body]?.name || f.name || 'Sketch'}`))));
  if (cf?.type === 'shape') {
    const fields = shapeFields(cf);
    if (fields.length) el.append(h('div', { class: 'card' }, h('h3', {}, simple ? 'Size' : 'Starting shape'), errorBox(cf.id), fields));
  }
  if (simple && cf?.type === 'shape') el.append(placementCard(cf));
  else if (d) {
    const c = [(d.bbox[0][0] + d.bbox[1][0]) / 2, (d.bbox[0][1] + d.bbox[1][1]) / 2, (d.bbox[0][2] + d.bbox[1][2]) / 2].map(r2);
    el.append(h('div', { class: 'card' }, h('h3', {}, 'Placement'),
      trioField('Position of the middle (mm)', c, (i, v) => {
        let val; try { val = evalExpr(v, scope()); } catch { return; }
        const delta = [0, 0, 0]; delta[i] = val - c[i];
        translateSel(...delta);
      }),
      h('div', { class: 'muted', style: 'margin:2px 0 6px' }, 'Turn 90°'),
      h('div', { class: 'chip-row' }, ['x', 'y', 'z'].map((a) => h('button', { class: 'chip', onclick: () => rotateSel(a, 90) }, `${a.toUpperCase()} +90°`)))));
  }
  el.append(h('div', { class: 'card' }, h('h3', {}, 'Color'), swatches([id])));
  if (d) el.append(h('div', { class: 'card' }, h('h3', {}, 'Size'),
    h('div', { class: 'stat' }, h('span', {}, 'Width × depth × height'), h('b', {}, `${fmt(d.bbox[1][0] - d.bbox[0][0])} × ${fmt(d.bbox[1][1] - d.bbox[0][1])} × ${fmt(d.bbox[1][2] - d.bbox[0][2])}`)),
    h('div', { class: 'stat' }, h('span', {}, 'Volume'), h('b', {}, `${fmt(d.volume / 1000)} cm³`))));
  const n = featuresOfBody(doc, id).length;
  el.append(h('div', { class: 'card' }, h('h3', {}, 'How it was made'),
    h('div', { class: 'muted', style: 'margin-bottom:8px' }, `${n} step${n === 1 ? '' : 's'}. History shows each one, including the shapes that were cut out of it or merged into it, and lets you change them.`),
    h('button', { class: 'btn', onclick: () => { app.historyAll = false; openPanel('history'); } }, ic('History'), 'Show in History')));
  el.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => saveToMyParts(id), title: 'Keep this object (and every step that made it) for use in any project: Insert > Parts > My parts' }, ic('Package'), 'Save to My parts')));
  el.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: duplicateSel }, ic('Copy'), 'Duplicate'), h('button', { class: 'btn danger', onclick: deleteSel }, ic('Trash2'), 'Delete')));
}

/** The settings of one step. inline: shown inside the History list, under the step's row. */
export function renderFeaturePanel(el, f, { inline = false } = {}) {
  const doc = store.doc; const dsc = describeFeature(doc, f);
  if (!inline) el.append(h('div', {},
    h('button', { class: 'chip', style: 'margin-bottom:8px', onclick: () => { editStep(null); openPanel('history'); } }, '← History'),
    h('h2', {}, f.name || dsc.title), h('div', { class: 'sub' }, dsc.sub)));
  const eb = errorBox(f.id); if (eb) el.append(eb);
  const deps = historyDependencies(doc).get(f.id) || [];
  const dependents = dependentSteps(doc, f.id);
  el.append(h('label', { class: 'field' }, h('span', {}, 'Step name'), h('input', { class: 'in', value: f.name || '', placeholder: dsc.title, 'aria-label': 'Step name', onchange: (e) => store.commit((d) => { const step = d.features.find((x) => x.id === f.id); if (step) step.name = e.target.value.trim().slice(0, 128); }, 'ui') })),
    h('div', { class: 'muted' }, `${f.suppressed ? 'Turned off' : 'Active'} · ${dependents.length} later dependent step(s)`),
    deps.length ? h('div', { class: 'chip-row' }, h('span', { class: 'muted' }, 'Depends on:'), deps.map((id) => { const step = doc.features.find((x) => x.id === id); return h('button', { class: 'chip', onclick: () => { editStep(id); openPanel('history'); } }, step.name || describeFeature(doc, step).title); })) : null,
    h('div', { class: 'btns' }, h('button', { class: 'btn', disabled: !canMoveFeature(doc, f.id, -1), title: 'Move earlier when dependencies allow it', onclick: () => moveFeature(f.id, -1) }, '↑ Earlier'),
      h('button', { class: 'btn', disabled: !canMoveFeature(doc, f.id, 1), title: 'Move later when dependencies allow it', onclick: () => moveFeature(f.id, 1) }, '↓ Later')));
  const card = h('div', { class: 'card' });
  // every number of a step gets a slider too (live preview while dragging), unless it is given its own
  const num = (label, key, opts = {}) => exprField(label, f[key], (v) => updateFeature(f.id, (x) => { x[key] = v; }), { slider: 'auto', int: opts.step === 1 && /count|sides/i.test(label), ...opts, onLive: (v) => liveFeature(f.id, (x) => { x[key] = v; }) });
  switch (f.type) {
    case 'shape':
      card.append(h('h3', {}, SHAPES[f.kind]?.label || 'Shape'), ...shapeFields(f));
      if (f.kind === 'sketch') card.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => editSketch(f) }, ic('PenLine'), 'Edit sketch')));
      el.append(card, placementCard(f));
      break;
    case 'copy':
      card.append(h('h3', {}, 'Offset from the original'), trioField('Offset (mm)', f.d, (i, v) => updateFeature(f.id, (x) => { x.d[i] = v; })),
        h('div', { class: 'muted' }, `This copy follows changes made to ${bodyName(f.src)} before this step.`));
      el.append(card); break;
    case 'move': {
      const m = new Matrix4().fromArray(f.m); const t = new Vector3(), q = new Quaternion(), s = new Vector3(); m.decompose(t, q, s);
      card.append(h('h3', {}, 'Moved by'), trioField('Offset (mm)', t.toArray().map(r2), (i, v) => {
        let val; try { val = evalExpr(v, scope()); } catch { return; }
        updateFeature(f.id, (x) => { const mm = new Matrix4().fromArray(x.m); mm.elements[12 + i] = val; x.m = mm.elements; });
      }), h('div', { class: 'muted' }, 'Rotation and scale from this step are kept. Drag the object to adjust them.'));
      el.append(card); break;
    }
    case 'combine':
      card.append(h('h3', {}, 'Operation'), selectField('Type', f.op, [['union', 'Merge'], ['subtract', 'Subtract'], ['intersect', 'Intersect']], (v) => updateFeature(f.id, (x) => { x.op = v; })),
        h('div', { class: 'muted' }, `Keeps ${bodyName(f.body)}; uses ${f.tools.map(bodyName).join(', ')}. Delete this step to separate them again.`));
      el.append(card); break;
    case 'fillet': case 'chamfer':
      card.append(h('h3', {}, f.type === 'fillet' ? 'Rounded edges' : 'Beveled edges'), num(f.type === 'fillet' ? 'Radius' : 'Size', 'r', { step: 0.25, min: 0.01, slider: edgeSlider(f.body) }),
        h('div', { class: 'muted' }, `${f.edges.length} edge${f.edges.length === 1 ? '' : 's'} picked. To pick different edges, delete this step and run ${f.type === 'fillet' ? 'Fillet' : 'Chamfer'} again.`));
      el.append(card); break;
    case 'shell':
      card.append(h('h3', {}, 'Hollow'), num('Wall thickness', 't', { step: 0.2, min: 0.05 }), h('div', { class: 'muted' }, f.faces.length ? `${f.faces.length} face${f.faces.length === 1 ? '' : 's'} left open.` : 'Closed inside, no openings.'));
      el.append(card); break;
    case 'mirror':
      card.append(h('h3', {}, 'Mirror'), selectField('Across', f.axis, [['x', 'X (left–right)'], ['y', 'Y (front–back)'], ['z', 'Z (up–down)']], (v) => updateFeature(f.id, (x) => { x.axis = v; })),
        checkField('Keep the original and add a mirrored copy', f.copy, (v) => updateFeature(f.id, (x) => { x.copy = v; })),
        f.copy ? selectField('Copy goes to', f.side || 'max', [['max', 'Positive side'], ['min', 'Negative side']], (v) => updateFeature(f.id, (x) => { x.side = v; })) : null);
      el.append(card); break;
    case 'array':
      card.append(h('h3', {}, 'Pattern'), selectField('Kind', f.kind, [['linear', 'In a row'], ['circular', 'Around a center']], (v) => updateFeature(f.id, (x) => { x.kind = v; })), num('Count', 'n', { step: 1, min: 2 }));
      if (f.kind === 'circular') card.append(num('Total angle', 'angle', { step: 15 }), num('Center X', 'cx'), num('Center Y', 'cy'), h('div', { class: 'muted' }, 'Copies turn around the vertical axis through the center point. 360° spreads them evenly.'));
      else card.append(num('Step X', 'dx'), num('Step Y', 'dy'), num('Step Z', 'dz'));
      el.append(card); break;
    case 'split':
      card.append(h('h3', {}, 'Split'));
      if (f.axis) card.append(selectField('Cut across', f.axis, [['z', 'Height (Z)'], ['x', 'Width (X)'], ['y', 'Depth (Y)']], (v) => updateFeature(f.id, (x) => { x.axis = v; })), num('At position', 'at', { step: 1 }));
      else card.append(num('Move from center (mm)', 'off', { step: 1 }), num('Roll (°)', 'roll', { step: 15 }), num('Pitch (°)', 'pitch', { step: 15 }), num('Yaw (°)', 'yaw', { step: 15 }));
      card.append(selectField('Keep', f.keep, [['above', 'Keep top'], ['below', 'Keep bottom'], ['both', 'Keep both']], (v) => updateFeature(f.id, (x, d) => { x.keep = v; if (v === 'both' && !d.bodies[x.body2]) d.bodies[x.body2] = { name: `${bodyName(x.body)} (part 2)`, color: nextColor(d) }; })));
      el.append(card); break;
    case 'emboss':
      card.append(h('h3', {}, 'Emboss / engrave'), ...embossFields(f, (values) => updateFeature(f.id, (x) => Object.assign(x, values))));
      el.append(card); break;
    case 'extrude':
      card.append(h('h3', {}, 'Shape on face'), selectField('Action', f.mode, [['add', 'Add (extrude out)'], ['cut', 'Cut (pocket or hole)']], (v) => updateFeature(f.id, (x) => { x.mode = v; })),
        selectField('Outline', f.prof, [['rect', 'Rectangle'], ['circle', 'Circle'], ['slot', 'Slot'], ['poly', 'Polygon']], (v) => updateFeature(f.id, (x) => { x.prof = v; })));
      if (f.prof === 'circle') card.append(num('Diameter', 'd', { min: 0.1 }));
      else if (f.prof === 'poly') card.append(num('Sides', 'n', { step: 1, min: 3 }), num('Across flats', 'd', { min: 0.1 }));
      else card.append(num('Width', 'w', { min: 0.1 }), num('Height', 'h', { min: 0.1 }));
      card.append(num('Depth', 'depth', { step: 0.5, min: 0.01 }), num('Shift across', 'u'), num('Shift up', 'v'), h('div', { class: 'muted' }, 'Centered on the face you clicked. Use the shift values to move it.'));
      el.append(card); break;
    case 'pushpull':
      card.append(h('h3', {}, 'Push/pull a flat face'), num('Distance (mm)', 'd', { step: 0.5 }),
        h('div', { class: 'muted' }, 'A positive distance pulls the face out and adds material. A negative one pushes it in and removes material, for example to make a hole deeper or a part shorter.'));
      el.append(card); break;
    case 'delete':
      card.append(h('div', { class: 'muted' }, `${bodyName(f.body)} is removed at this step. Delete the step to bring it back.`)); el.append(card); break;
    default: break;
  }
  el.append(h('div', { class: 'btns' },
    h('button', { class: 'btn', onclick: () => updateFeature(f.id, (x) => { x.suppressed = !x.suppressed; }) }, ic(f.suppressed ? 'Eye' : 'EyeOff'), f.suppressed ? 'Turn on' : 'Turn off'),
    h('button', { class: 'btn danger', onclick: () => deleteFeature(f.id) }, ic('Trash2'), 'Delete step')));
}

export function renderToolPanel(el) {
  const t = app.tool;
  if (t.type === 'measure') return renderMeasurePanel(el);
  const titles = { emboss: 'Emboss / engrave', fillet: 'Fillet edges', chamfer: 'Chamfer edges', shell: 'Hollow', extrude: 'Shape on a face', pushpull: 'Push/pull', layflat: 'Lay flat', insertpocket: 'Heat-set insert pocket', workplane: 'Workplane', sketchplane: 'Sketch plane', align: 'Align', split: 'Split' };
  el.append(h('div', {}, h('h2', {}, titles[t.type]), h('div', { class: 'sub' }, bodyName(t.body))));
  const card = h('div', { class: 'card' });
  if (t.type === 'fillet' || t.type === 'chamfer') {
    card.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Click the edges you want to change. Click again to unpick. Drag with the right mouse button to look around.'),
      exprField(t.type === 'fillet' ? 'Radius' : 'Size', t.r, (v) => { t.r = v; }, { step: 0.25, slider: edgeSlider(t.body), onLive: toolPreview, onLiveEnd: toolPreviewDone }),
      h('div', { class: 'stat' }, h('span', {}, 'Edges picked'), h('b', {}, String(t.items.length))),
      h('div', { class: 'muted', style: 'margin:6px 0 4px' }, 'Quick pick'),
      h('div', { class: 'chip-row' }, [['all', 'All'], ['top', 'Top'], ['bottom', 'Bottom'], ['vertical', 'Vertical'], ['none', 'None']].map(([k, l]) => h('button', { class: 'chip', onclick: () => (k === 'none' ? (t.items = [], vp.setPickItems([]), renderProps()) : quickEdges(k)) }, l))));
  } else if (t.type === 'shell') {
    card.append(h('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Click the faces to leave open, like the top of a cup. Pick none for a closed, hollow part.'),
      exprField('Wall thickness', t.t, (v) => { t.t = v; }, { step: 0.2 }),
      h('div', { class: 'stat' }, h('span', {}, 'Open faces'), h('b', {}, String(t.items.length))));
  } else if (t.type === 'emboss') {
    card.append(h('div', { class: 'muted', role: 'status' }, t.face ? 'Face selected. Set the artwork and dimensions, then Apply.' : 'Click a flat face to place text or a logo.'),
      ...embossFields(t, (values) => { Object.assign(t, values); renderProps(); }));
  } else if (t.type === 'extrude') {
    card.append(h('div', { class: 'muted' }, 'Click a face. A 10 mm square appears on it, and you can then change its shape, size, depth, and whether it adds or cuts.'));
  } else if (t.type === 'insertpocket') {
    card.append(h('div', { class: 'muted' }, 'Click a flat face. A pocket sized for an M3 heat-set insert (4 mm wide, 6 mm deep) is cut in the middle of it. You can then change its size and move it on the face.'));
  } else if (t.type === 'layflat') {
    card.append(h('div', { class: 'muted' }, 'Click the face that should sit on the printer bed. The object turns so that face points down and sets down on the floor.'));
  } else if (t.type === 'pushpull') {
    card.append(h('div', { class: 'muted' }, 'Click a flat face. You can then type how far to move it: out to add material, in (a negative number) to remove it.'));
  } else if (t.type === 'split') {
    card.append(h('div', { class: 'muted' }, 'Drag the green arrow to move the cutting plane, or switch to turning in the bar at the bottom to tilt it. Pick what to keep in the bar at the top, then click Split.'));
  }
  el.append(card);
  el.append(h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: endTool }, 'Cancel'), !ONE_CLICK.has(t.type) ? h('button', { class: 'btn primary', onclick: applyTool }, ic('Check'), 'Apply') : null));
}

export function renderWelcome(el) {
  const n = app.results.bodies.size;
  el.append(h('div', {}, h('h2', {}, store.doc.name || 'Untitled'), h('div', { class: 'sub' }, `${n} object${n === 1 ? '' : 's'} · ${store.doc.features.length} step${store.doc.features.length === 1 ? '' : 's'}`)));
  el.append(h('div', { class: 'card' }, h('h3', {}, 'Mouse'), h('div', { class: 'keys' },
    h('span', { class: 'k' }, 'Left drag (empty)'), h('span', {}, 'Turn the view'),
    h('span', { class: 'k' }, 'Right drag'), h('span', {}, 'Slide the view'),
    h('span', { class: 'k' }, 'Wheel'), h('span', {}, 'Zoom toward the pointer'),
    h('span', { class: 'k' }, 'Middle drag'), h('span', {}, 'Slide the view'),
    h('span', { class: 'k' }, 'Click'), h('span', {}, 'Select'),
    h('span', { class: 'k' }, 'Ctrl + click'), h('span', {}, 'Add to selection'),
    h('span', { class: 'k' }, 'Drag object'), h('span', {}, 'Slide it along the floor'),
    h('span', { class: 'k' }, 'Shift + drag'), h('span', {}, 'Lift it up or down'),
    h('span', { class: 'k' }, 'Double-click'), h('span', {}, 'Fly in to it (again: closer, again: back)'))));
  el.append(h('div', { class: 'card' }, h('h3', {}, 'Keys'), h('div', { class: 'keys' },
    h('span', { class: 'k' }, 'Ctrl+Z / Ctrl+Y'), h('span', {}, 'Undo / redo'),
    h('span', { class: 'k' }, 'Delete'), h('span', {}, 'Delete selection'),
    h('span', { class: 'k' }, 'Ctrl+D'), h('span', {}, 'Duplicate'),
    h('span', { class: 'k' }, 'Arrows, PgUp/PgDn'), h('span', {}, 'Nudge (Shift ×10)'),
    h('span', { class: 'k' }, 'M / R / S'), h('span', {}, 'Move, rotate, scale handles'),
    h('span', { class: 'k' }, 'D'), h('span', {}, 'Drop to the floor'),
    h('span', { class: 'k' }, 'F / Home'), h('span', {}, 'Fit view / home view'),
    h('span', { class: 'k' }, 'Ctrl+S'), h('span', {}, 'Save project'))));
  el.append(h('div', { class: 'card muted' }, 'Everything you do is kept as a step in History. Select an object and History shows how it was made; change any number there and the model rebuilds. Your work is backed up automatically; use Save to keep a project file.'));
}

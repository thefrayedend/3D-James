// Make editable: an imported mesh (STL, OBJ, 3MF) or STEP part rebuilt as sketches and steps (src/stlconvert.js
// does the work in the geometry engine, on a fine mesh of the STEP's exact solid). One undo step; Undo gives the
// import back. A STEP part that cannot be rebuilt whole stays the exact solid (never swapped for a mesh).
import { store } from './store.js';
import { app, saveSettings } from './state.js';
import { h, toast, modal } from './ui/dom.js';
import { workerCall, waitForBuild, restartEngine } from './build.js';
import { keepFile, newFileId } from './storage.js';
import { meshToStl } from './formats.js';
import { select } from './commands.js';

/** Can this object be made editable? (an imported mesh or STEP part, not changed by any later step) */
export function canMakeEditable(doc, id) {
  const f = doc.features.find((x) => x.type === 'shape' && x.body === id);
  return !!f && f.kind === 'import' && !f.suppressed;
}

/** What the last Make editable did, in words (read by the AI link, src/bridge.js). */
export let lastReport = null;

const pct = (x) => (x < 0.0005 ? 'over 99.9%' : `${(100 - x * 100).toFixed(1)}%`);
const mm = (x) => (x < 0.01 ? '0.01 mm' : `${x < 1 ? x.toFixed(2) : x.toFixed(1)} mm`);

/** How much detail Make editable keeps: the user's last choice (Balanced at first). */
const DETAILS = [
  ['simple', 'Simplest', 'The fewest, plainest steps. Small details and fine curves are left out or drawn straight; the shape may differ by a few tenths of a mm.'],
  ['balanced', 'Balanced', 'Far fewer steps, still about as close as a printer can make (about a tenth of a mm).'],
  ['precise', 'Most precise', 'As close to the file as it gets (a few hundredths of a mm), with more steps, some of them very thin.'],
];
export const editDetail = () => (DETAILS.some(([k]) => k === app.settings.editDetail) ? app.settings.editDetail : 'balanced');
/** The slider for it: fewer steps on the left, closer to the file on the right. */
export function detailPicker() {
  const at = () => DETAILS.findIndex(([k]) => k === editDetail());
  const name = h('b', {}, DETAILS[at()][1]), say = h('div', { class: 'muted' }, DETAILS[at()][2]);
  const slider = h('input', { type: 'range', min: 0, max: 2, step: 1, value: at(), 'aria-label': 'How much detail to keep',
    oninput: (e) => { const d = DETAILS[+e.target.value]; app.settings.editDetail = d[0]; saveSettings(); name.textContent = d[1]; say.textContent = d[2]; } });
  return h('div', { class: 'detail-pick' },
    h('div', { class: 'detail-row' }, h('span', {}, 'Detail: '), name),
    h('div', { class: 'detail-row' }, h('span', { class: 'muted' }, 'Fewer steps'), slider, h('span', { class: 'muted' }, 'Closer to the file')),
    say);
}

/** Rebuild an imported mesh object as editable steps, in place of its import step. */
export async function makeEditable(id, { quiet = false, detail = editDetail() } = {}) {
  const doc = store.doc;
  const fi = doc.features.findIndex((x) => x.type === 'shape' && x.body === id);
  const f = doc.features[fi];
  if (!f || !canMakeEditable(doc, id)) { toast('Make editable works on an imported STL, OBJ, 3MF or STEP model.', 'err'); return false; }
  const step = f.p?.fmt === 'step', from = step ? 'the STEP file' : 'the STL', stays = step ? 'stays the exact STEP solid' : 'stays a mesh';
  const name = doc.bodies[id]?.name || f.p?.name || 'Part';
  const was = JSON.stringify(f); // the import step as it was when the work started
  const busy = toast(`Making ${name} editable… big or detailed models can take a minute.`, 'info', 600000);
  app.converting = true;
  let res, seq;
  try {
    await waitForBuild(); // the engine has the mesh file
    seq = store.doc.seq;
    // a STEP part gets three minutes: then the engine starts again by itself and the part stays the exact solid
    res = await workerCall({ type: 'convertImport', feature: f, name, seq, body: id, detail }, undefined, step ? { timeout: 180000, restart: true } : undefined);
  } catch (err) {
    if (err.tooLong) {
      lastReport = { done: false, summary: `${name} took too long to rebuild as sketches, so it ${stays}.` };
      toast(`${name} took too long to rebuild as sketches, so it ${stays}.`, 'info', 9000);
      return false;
    }
    // the engine failed on it: it starts again fresh, so the failure cannot spoil the next job (or the next try)
    restartEngine();
    // (a STEP part simply stays as it is; the engine's own words are only for the AI link and Send feedback)
    const say = step ? `${name} could not be rebuilt as sketches, so it ${stays}.` : `Could not make ${name} editable: ${err.message}`;
    lastReport = { done: false, summary: say, reason: err.message };
    toast(say, step ? 'info' : 'err', 9000);
    return false;
  } finally { app.converting = false; busy.remove(); }
  let solidParts = res.parts.filter((p) => !p.mesh);
  // a STEP part is exact: rebuilt only whole and close (within a quarter of a mm), or it stays as it is (a piece of
  // it as a mesh, or a rough copy of it, would be a step back)
  const rough = step && solidParts.length && res.report && res.report.maxGap > 0.25;
  const partly = step && solidParts.length && (rough || res.parts.some((p) => p.mesh));
  if (partly) solidParts = [];
  lastReport = { done: !!solidParts.length, summary: solidParts.length ? summary(res, from) : rough ? `${name} could only be drawn roughly as sketches (up to ${mm(res.report.maxGap)} off), so it ${stays}.` : partly ? `Part of ${name} could not be drawn as sketches, so it ${stays}.` : `${name} has curves that sketches cannot match closely enough, so it ${stays}.`,
    meshParts: res.parts.filter((p) => p.mesh).map((p) => p.name), stepsWithErrors: Object.keys(res.errors || {}) };
  if (!solidParts.length) {
    if (!quiet) explain(name, res, false, from, stays, partly, rough);
    else toast(rough ? lastReport.summary : `${name} could not be rebuilt from sketches (${partly ? 'part of it has' : 'it has'} curves that sketches cannot match closely enough), so it ${stays}.`, 'info', 9000);
    return false;
  }
  // Another project opened, or the import step changed or went while the engine worked: the result is for
  // something that is no longer there, so it is dropped rather than put in place of whatever is there now.
  const at = store.doc.features.findIndex((x) => x.id === f.id);
  if (at < 0 || JSON.stringify(store.doc.features[at]) !== was || !store.doc.bodies[id]) {
    lastReport = { done: false, summary: `${name} changed (or another project was opened) while it was being made editable, so nothing was changed.` };
    toast(`${name} changed (or another project was opened) while it was being made editable, so nothing was changed. Try again if you still want it.`, 'info', 9000);
    return false;
  }
  // The steps were numbered from this project's counter, the first part keeping the object's id (so later
  // steps still find it). If the project changed meanwhile, they get fresh ids.
  const same = store.doc.seq === seq && at === fi;
  const ids = new Map();
  const map = (old, prefix) => { if (!ids.has(old)) ids.set(old, same || old === solidParts[0].body ? (same ? old : id) : store.newId(prefix)); return ids.get(old); };
  const newIds = [];
  store.commit((d) => {
    if (same) d.seq = Math.max(d.seq, res.seq);
    const steps = res.features.map((x) => {
      const y = { ...x, id: same ? x.id : store.newId('f') };
      for (const k of ['body', 'body2', 'src']) if (y[k]) y[k] = map(y[k], 'b');
      if (y.tools) y.tools = y.tools.map((t) => map(t, 'b'));
      return y;
    });
    const color = d.bodies[id]?.color;
    for (const [old, nu] of ids) {
      const b = res.bodies[old];
      d.bodies[nu] = nu === id ? { ...d.bodies[id], name } : { ...b };
      if (nu === id && color) d.bodies[nu].color = color;
      if (nu !== id && !b.hole && solidParts.some((p) => ids.get(p.body) === nu)) newIds.push(nu);
    }
    // parts that stay meshes (curved all over) come back as imported meshes of their own, where they were
    for (const p of res.parts.filter((x) => x.mesh)) {
      const bytes = meshToStl(p.vertices, p.triangles);
      const fid = newFileId(); keepFile(fid, bytes);
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.vertices.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p.vertices[i + k]); mx[k] = Math.max(mx[k], p.vertices[i + k]); }
      const b = store.newId('b');
      d.bodies[b] = { name: `${p.name} (mesh)`, color: '#C3C3C3' };
      steps.push({ id: store.newId('f'), type: 'shape', body: b, kind: 'import', name: `${p.name}: kept as a mesh`, p: { file: fid, name: p.name, fmt: 'stl' }, pos: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, mn[2]], rot: [0, 0, 0] });
      newIds.push(b);
    }
    d.features.splice(at, 1, ...steps);
  });
  select([id, ...newIds]);
  if (!quiet || res.parts.some((p) => p.mesh) || Object.keys(res.errors || {}).length) explain(name, res, true, from, stays);
  else toast(summary(res, from), 'info', 9000);
  return true;
}

function summary(res, from = 'the STL') {
  const sketches = res.features.filter((f) => f.kind === 'sketch').length;
  const r = res.report;
  return `Rebuilt as ${res.features.length} step${res.features.length === 1 ? '' : 's'} (${sketches} sketch${sketches === 1 ? '' : 'es'})`
    + (r ? `: ${pct(r.xor)} the same as ${from}, surfaces at most ${mm(r.maxGap)} apart.` : '.');
}

function explain(name, res, done, from = 'the STL', stays = 'stays a mesh', partly = false, rough = false) {
  const meshParts = res.parts.filter((p) => p.mesh);
  const body = h('div', {},
    done ? h('p', {}, summary(res, from)) : h('p', {}, rough ? `${name} could only be drawn roughly as sketches (up to ${mm(res.report.maxGap)} off), so it ${stays}: you can still move, size, paint and combine it.` : `${partly ? `Part of ${name} has` : `${name} has`} curves that outlines pushed up or spun around cannot match closely enough (like rounded bumps, blended corners or a sculpted shape), so it cannot be drawn as sketches. It ${stays}: you can still move, size, paint and combine it.`),
    done ? h('p', { class: 'muted' }, `Each sketch is in History: select the object and click Edit sketch (or open the step in History) to change a size. Undo (Ctrl+Z) gives back ${from === 'the STL' ? 'the mesh' : 'the STEP part'}.`) : null,
    meshParts.length && done ? h('p', {}, `${meshParts.length === 1 ? 'One part' : `${meshParts.length} parts`} could not be drawn as sketches and ${meshParts.length === 1 ? 'stays a mesh' : 'stay meshes'} (grey, named "… (mesh)"): ${meshParts.map((p) => p.name).join(', ')}.`) : null,
    Object.keys(res.errors || {}).length ? h('p', { class: 'err' }, 'Some steps could not be built; they are marked in History.') : null);
  const close = modal(done ? `${name} is now editable` : `${name} ${stays}`, body, () => [h('button', { class: 'btn primary', onclick: () => close() }, 'OK')]);
}

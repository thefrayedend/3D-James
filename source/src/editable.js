// Make editable: an imported mesh (STL, OBJ, 3MF) rebuilt as sketches and steps (src/stlconvert.js does the
// work in the geometry engine). One undo step; Undo gives the mesh back.
import { store } from './store.js';
import { app, saveSettings } from './state.js';
import { h, toast, modal } from './ui/dom.js';
import { workerCall, waitForBuild } from './build.js';
import { keepFile, newFileId } from './storage.js';
import { meshToStl } from './formats.js';
import { select } from './commands.js';

/** Can this object be made editable? (an imported mesh, not changed by any later step) */
export function canMakeEditable(doc, id) {
  const f = doc.features.find((x) => x.type === 'shape' && x.body === id);
  return !!f && f.kind === 'import' && f.p?.fmt !== 'step' && !f.suppressed;
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
  if (!f || !canMakeEditable(doc, id)) { toast('Make editable works on an imported STL, OBJ or 3MF mesh.', 'err'); return false; }
  const name = doc.bodies[id]?.name || f.p?.name || 'Part';
  const busy = toast(`Making ${name} editable… big or detailed models can take a minute.`, 'info', 600000);
  app.converting = true;
  let res, seq;
  try {
    await waitForBuild(); // the engine has the mesh file
    seq = store.doc.seq;
    res = await workerCall({ type: 'convertImport', feature: f, name, seq, body: id, detail });
  } catch (err) {
    lastReport = { done: false, summary: `Could not make ${name} editable: ${err.message}` };
    toast(`Could not make ${name} editable: ${err.message}`, 'err', 8000);
    return false;
  } finally { app.converting = false; busy.remove(); }
  const solidParts = res.parts.filter((p) => !p.mesh);
  lastReport = { done: !!solidParts.length, summary: solidParts.length ? summary(res) : `${name} is curved all over, so it cannot be drawn as sketches and stays a mesh.`,
    meshParts: res.parts.filter((p) => p.mesh).map((p) => p.name), stepsWithErrors: Object.keys(res.errors || {}) };
  if (!solidParts.length) {
    if (!quiet) explain(name, res, false);
    else toast(`${name} could not be rebuilt from sketches (it is curved all over), so it stays a mesh.`, 'info', 9000);
    return false;
  }
  // The steps were numbered from this project's counter, the first part keeping the object's id (so later
  // steps still find it). If the project changed meanwhile, they get fresh ids.
  const same = store.doc.seq === seq && store.doc.features.indexOf(f) === fi;
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
    d.features.splice(fi, 1, ...steps);
  });
  select([id, ...newIds]);
  if (!quiet || res.parts.some((p) => p.mesh) || Object.keys(res.errors || {}).length) explain(name, res, true);
  else toast(summary(res), 'info', 9000);
  return true;
}

function summary(res) {
  const sketches = res.features.filter((f) => f.kind === 'sketch').length;
  const r = res.report;
  return `Rebuilt as ${res.features.length} step${res.features.length === 1 ? '' : 's'} (${sketches} sketch${sketches === 1 ? '' : 'es'})`
    + (r ? `: ${pct(r.xor)} the same as the STL, surfaces at most ${mm(r.maxGap)} apart.` : '.');
}

function explain(name, res, done) {
  const meshParts = res.parts.filter((p) => p.mesh);
  const body = h('div', {},
    done ? h('p', {}, summary(res)) : h('p', {}, `${name} is curved all over (like a figure or a sculpted shape), so it cannot be drawn as sketches. It stays a mesh: you can still move, size, paint and combine it.`),
    done ? h('p', { class: 'muted' }, 'Each sketch is in History: select the object and click Edit sketch (or open the step in History) to change a size. Undo (Ctrl+Z) gives back the mesh.') : null,
    meshParts.length && done ? h('p', {}, `${meshParts.length === 1 ? 'One part' : `${meshParts.length} parts`} could not be drawn as sketches and ${meshParts.length === 1 ? 'stays a mesh' : 'stay meshes'} (grey, named "… (mesh)"): ${meshParts.map((p) => p.name).join(', ')}.`) : null,
    Object.keys(res.errors || {}).length ? h('p', { class: 'err' }, 'Some steps could not be built; they are marked in History.') : null);
  const close = modal(done ? `${name} is now editable` : `${name} stays a mesh`, body, () => [h('button', { class: 'btn primary', onclick: () => close() }, 'OK')]);
}

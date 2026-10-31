// Opening, saving, importing and exporting files.
import { store, emptyDoc, nextColor, normalizeDoc } from './store.js';
import { app, bodyData, bodyName } from './state.js';
import { $, h, toast, modal } from './ui/dom.js';
import { vp } from './view.js';
import { workerCall, markSent, waitForBuild } from './build.js';
import { keepFile, newFileId, absorbFiles, absorbVersions, versionDataForSave, filesForSave, rememberOpenFile, rememberFolder } from './storage.js';
import { drive } from './drive/index.js';
import { select, placeNew } from './commands.js';
import { endTool, setWorkplane } from './tools.js';
import { readZip, parse3mf, parseObj, meshToStl } from './formats.js';
import { worldPaint } from './painting.js';
import { modelSnapshot } from './versions.js';
import { idb } from './storage.js';
import { zipStore } from './zip.js';
import { canMakeEditable, makeEditable, detailPicker } from './editable.js';

// ---------------------------------------------------------------- file types
const TYPES = {
  '3dj': { description: '3DJames project (.3dj)', accept: { 'application/x-3djames': ['.3dj'] } },
  '3mf': { description: '3MF model (keeps the editable history)', accept: { 'model/3mf': ['.3mf'] } },
  json: { description: 'Old 3DJames project (.json)', accept: { 'application/json': ['.json'] } }, // opens; no longer saved
  stl: { description: 'STL (finished shape, for slicers)', accept: { 'model/stl': ['.stl'] } },
  step: { description: 'STEP (exact solids, for other CAD programs)', accept: { 'model/step': ['.step', '.stp'] } },
  obj: { description: 'OBJ mesh', accept: { 'model/obj': ['.obj'] } },
};
const allOf = (keys, description) => ({ description, accept: Object.assign({}, ...keys.map((k) => TYPES[k].accept)) });
const OPEN_TYPES = [allOf(['3dj', '3mf', 'json', 'step', 'stl', 'obj'], '3D files and 3DJames projects'), ...['3dj', '3mf', 'step', 'stl', 'obj'].map((k) => TYPES[k])];
const INSERT_TYPES = [allOf(['step', 'stl', '3mf', 'obj'], '3D models'), ...['step', 'stl', '3mf', 'obj'].map((k) => TYPES[k])];
// Save as makes every kind of file: projects (all editable) and the finished shape for slicers / other CAD programs.
const PROJECT = ['3dj', '3mf'];
const SAVE_FMTS = ['3dj', '3mf', 'stl', 'step'];
const SAVE_TYPES = SAVE_FMTS.map((k) => TYPES[k]);

const extOf = (name) => (String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '');
export const fmtOf = (name) => ({ '3dj': '3dj', '3mf': '3mf', json: 'json', stl: 'stl', step: 'step', stp: 'step', obj: 'obj' }[extOf(name)] || null);
const baseName = (name) => String(name).replace(/\.[a-z0-9]+$/i, '');
const safeName = () => (store.doc.name || 'model').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'model';

// ---------------------------------------------------------------- the Open / Save windows
// They belong to the drive: this computer's Open / Save windows, or the server's folders (see drive/).
export async function openDialog() {
  const r = await drive.pickOpen(OPEN_TYPES, 'Open');
  if (r) await openFile(r.file, r.handle);
}
export async function insertDialog() {
  const r = await drive.pickOpen(INSERT_TYPES, 'Insert a model');
  if (r) await insertFile(r.file);
}
export const chooseProjectsFolder = () => drive.chooseProjectsFolder?.();
/** Write the file; when someone else saved it on the server meanwhile, ask first. False: not saved. */
async function writeChecked(handle, data) {
  try { await drive.write(handle, data); return true; } catch (err) {
    if (!err.conflict || !drive.askConflict) throw err;
    const choice = await drive.askConflict(err, handle.name);
    if (choice === 'overwrite') { await drive.write(handle, data, { force: true }); return true; }
    if (choice === 'copy') saveAs();
    return false;
  }
}

// ---------------------------------------------------------------- saving
function exportItems() {
  return [...app.results.bodies.keys()].filter((id) => !store.doc.bodies[id]?.hidden && !store.doc.bodies[id]?.hole)
    .map((id) => ({ id, name: bodyName(id), color: store.doc.bodies[id]?.color || '#C3C3C3', paint: worldPaint(store.doc, id) }));
}

/** Painted objects in a 3MF: which filament number each color is on in OrcaSlicer / Bambu Studio. They keep the
 * filament colors you have set there, so this says which to give each one. */
function filamentNote(colors) {
  toast(h('div', {}, h('div', {}, 'In OrcaSlicer or Bambu Studio, set the filaments to these colors:'),
    h('div', { style: 'display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px' }, colors.map((c, i) => h('span', { style: 'display:inline-flex;align-items:center;gap:4px' },
      h('b', {}, String(i + 1)), h('span', { style: `display:inline-block;width:14px;height:14px;border:1px solid #888;background:${c}` }))))), 'info', 15000);
}

/** The bytes of the project in a file format. .3dj and 3MF keep the full step history (and imported files). */
export async function buildFileData(fmt, onSnapshot) {
  if (!SAVE_FMTS.includes(fmt)) throw new Error(`3DJames can't save ${fmt} files.`);
  if (['3mf', 'stl', 'step'].includes(fmt)) {
    await waitForBuild();
    if (Object.keys(app.results.errors).length) throw new Error('Fix the model problems before saving the shape.');
  }
  const source = store.doc, revision = store.revision;
  const doc = JSON.parse(JSON.stringify(source));
  const portable = PROJECT.includes(fmt);
  const versions = portable ? versionDataForSave(doc) : {};
  const files = portable ? filesForSave(doc) : {};
  onSnapshot?.({ source, revision, model: modelSnapshot(doc) });
  if (fmt === '3dj') {
    // a zip: the project, every imported file exactly as it came in, and a small picture of the model
    const enc = new TextEncoder();
    const parts = [{ name: 'project.json', data: enc.encode(JSON.stringify(doc, null, 1)) },
      ...Object.entries(files).map(([k, v]) => ({ name: `files/${k}`, data: v })),
      ...Object.entries(versions).map(([k, v]) => ({ name: `versions/${k}.json`, data: enc.encode(JSON.stringify(v)) }))];
    const png = await vp.snapshot(512);
    if (png) parts.push({ name: 'preview.png', data: png });
    if (parts.reduce((total, p) => total + p.data.byteLength + 256, 22) > 400 * 1048576) throw new Error('This project exceeds 400 MB. Delete older versions or reduce imported model size before saving.');
    return zipStore(parts);
  }
  const items = exportItems();
  if (fmt === '3mf') {
    const extra = [...Object.entries(files).map(([k, v]) => ({ name: `Metadata/3djames-files/${k}`, data: v.slice().buffer })),
      ...Object.entries(versions).map(([k, v]) => ({ name: `Metadata/3djames-versions/${k}.json`, data: new TextEncoder().encode(JSON.stringify(v)).buffer }))];
    const r = await workerCall({ type: 'export', format: '3mf', items, base: safeName(), project: JSON.stringify(doc), extra });
    if (r.files[0].data.byteLength > 400 * 1048576) throw new Error('The 3MF exceeds 400 MB. Delete older versions or reduce model detail before saving.');
    if (r.filaments) filamentNote(r.filaments);
    return r.files[0].data;
  }
  if (!items.length) throw new Error('There is nothing to save yet.');
  if (fmt === 'step' && items.some((it) => !bodyData(it.id)?.solid)) toast('Threads and imported meshes are not solids, so they were left out of the STEP file.', 'info', 6000);
  const r = await workerCall({ type: 'export', format: fmt, items, base: safeName() });
  return r.files[0].data;
}

export function markSaved(name, fmt, handle, snapshot) {
  // A project opened while this save was writing must keep its own identity.
  if (snapshot.source !== store.doc) return;
  app.file = { name, fmt, handle: handle || null };
  app.savedModel = snapshot.model; app.savedAt = Date.now();
  rememberSavedModel();
  app.dirty = store.revision !== snapshot.revision;
  if (!app.dirty) store.doc.name = baseName(name);
  store.save();
  rememberOpenFile(app.file);
  updateTitle();
  toast(app.dirty ? `Saved ${name}. Newer changes still need saving.` : `Saved ${name}`, 'info', app.dirty ? 5000 : 2200);
}

/** Save: back into the file that is open, in its own format (a project: .3dj or 3MF). */
export async function saveDoc() {
  const f = app.file;
  if (!f?.handle || !PROJECT.includes(f.fmt)) return saveAs();
  try {
    let snapshot;
    const data = await buildFileData(f.fmt, (s) => { snapshot = s; });
    if (!(await writeChecked(f.handle, data))) return;
    markSaved(f.name, f.fmt, f.handle, snapshot);
  } catch (err) { toast(`Could not save: ${err.message}`, 'err', 7000); }
}

/** Save as: pick the place, the name and the type: a 3DJames project, 3MF, or the finished shape as STL or STEP. */
export async function saveAs() {
  const handle = await drive.pickSave({ suggestedName: `${safeName()}.${app.file?.fmt === '3mf' ? '3mf' : '3dj'}`, types: SAVE_TYPES });
  if (!handle) return;
  if (handle === 'download') return saveAsDownload();
  const fmt = SAVE_FMTS.includes(fmtOf(handle.name)) ? fmtOf(handle.name) : '3dj';
  try {
    let snapshot;
    const data = await buildFileData(fmt, (s) => { snapshot = s; });
    if (!(await writeChecked(handle, data))) return;
    if (PROJECT.includes(fmt)) markSaved(handle.name, fmt, handle, snapshot);
    else { if (drive.mode === 'local') rememberFolder(handle); shapeSaved(handle.name, fmt); }
  } catch (err) { toast(`Could not save: ${err.message}`, 'err', 7000); }
}

/** An STL or STEP file was saved: it keeps only the finished shape, so the project itself stays as it was. */
function shapeSaved(name, fmt) {
  toast(`Saved ${name}. ${fmt.toUpperCase()} keeps only the finished shape: to keep everything editable, also save it as a 3DJames project${app.file && PROJECT.includes(app.file.fmt) ? ` (Ctrl+S saves ${app.file.name})` : ''}.`, 'info', 7000);
}

function saveAsDownload() {
  // only where the Windows save window is not available: the file goes to Downloads
  const opt = (val, title, sub, on) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'fmt', value: val, checked: on }), h('b', {}, title), h('small', {}, sub));
  const nameIn = h('input', { class: 'in', value: safeName(), 'aria-label': 'File name', style: 'font-family:var(--ui)' });
  const form = h('form', { style: 'display:grid;gap:10px' }, h('div', { class: 'field' }, h('label', { class: 'plain' }, 'File name'), nameIn),
    h('div', { style: 'display:grid;gap:6px' },
      opt('3dj', '3DJames project (.3dj)', 'Everything: full step history and any imported files.', true),
      opt('3mf', '3MF', 'Opens in slicers and keeps the full step history for 3DJames.'),
      opt('stl', 'STL', 'The finished shape for your slicer (not editable in 3DJames).'),
      opt('step', 'STEP', 'Exact solids for other CAD programs (not editable in 3DJames).')));
  const close = modal('Save as', form, (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => form.requestSubmit() }, 'Save')]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fmt = new FormData(form).get('fmt');
    const name = `${(nameIn.value || 'model').trim()}.${fmt}`;
    close();
    try {
      let snapshot;
      const blob = new Blob([await buildFileData(fmt, (s) => { snapshot = s; })]);
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      if (PROJECT.includes(fmt)) markSaved(name, fmt, null, snapshot); else shapeSaved(name, fmt);
    } catch (err) { toast(err.message, 'err', 7000); }
  });
  nameIn.focus(); nameIn.select();
}

function rememberSavedModel() {
  idb.put('kv', app.savedModel ? { model: app.savedModel, t: app.savedAt, name: app.file?.name } : null, 'savedModel').catch(() => {});
}

// ---------------------------------------------------------------- opening
export function loadProject(doc, file) {
  app.loading = true;
  try { store.load(absorbVersions(absorbFiles(normalizeDoc(doc)))); } finally { app.loading = false; }
  if (app.tool) endTool();
  if (app.workplane) setWorkplane(null);
  select([]);
  app.viewSet = false; // look at the new project from the home view once it is built
  app.file = file; app.dirty = false;
  app.savedModel = file ? modelSnapshot(store.doc) : null; app.savedAt = Date.now(); rememberSavedModel();
  rememberOpenFile(file);
  updateTitle();
}

export function newProject() {
  loadProject(emptyDoc(), null);
  vp.view('home');
  // again once the old objects are gone from the view (until then Home frames them, not the empty floor)
  app.afterBuild = { fn: () => vp.view('home') };
}

export async function openFile(file, handle) {
  const fmt = fmtOf(file.name);
  try {
    if (fmt === '3dj') {
      const zip = await readZip(new Uint8Array(await file.arrayBuffer()));
      const proj = zip.get('project.json');
      if (!proj) throw new Error('That file is not a 3DJames project.');
      const doc = JSON.parse(new TextDecoder().decode(proj));
      const files = {};
      for (const [k, v] of zip) if (k.startsWith('files/')) files[k.slice(6)] = v;
      const versionData = Object.fromEntries([...zip].filter(([k]) => k.startsWith('versions/') && k.endsWith('.json')).map(([k, v]) => [k.slice(9, -5), JSON.parse(new TextDecoder().decode(v))]));
      loadProject({ ...doc, files, versionData }, { name: file.name, fmt: '3dj', handle });
    } else if (fmt === 'json') {
      const doc = JSON.parse(await file.text());
      if (!doc || !Array.isArray(doc.features)) throw new Error('That file is not a 3DJames project.');
      loadProject(doc, { name: file.name, fmt: 'json', handle });
    } else if (fmt === '3mf') {
      const zip = await readZip(new Uint8Array(await file.arrayBuffer()));
      const proj = zip.get('Metadata/3djames.json');
      if (proj) {
        // a 3MF saved by 3DJames: open the full history (and the files it imported)
        const doc = JSON.parse(new TextDecoder().decode(proj));
        const files = {};
        for (const [k, v] of zip) if (k.startsWith('Metadata/3djames-files/')) files[k.slice('Metadata/3djames-files/'.length)] = v;
        const versionData = Object.fromEntries([...zip].filter(([k]) => k.startsWith('Metadata/3djames-versions/') && k.endsWith('.json')).map(([k, v]) => [k.slice('Metadata/3djames-versions/'.length, -5), JSON.parse(new TextDecoder().decode(v))]));
        loadProject({ ...doc, files, versionData }, { name: file.name, fmt: '3mf', handle });
      } else {
        const stage = [];
        await addMeshParts(parse3mf(zip).map((m) => ({ ...m, name: m.name || baseName(file.name) })), stage);
        loadProject({ name: baseName(file.name) }, { name: file.name, fmt: '3mf', handle });
        for (const add of stage) add();
        offerEditable();
      }
    } else if (fmt === 'stl' || fmt === 'obj' || fmt === 'step') {
      const stage = [];
      const ok = await insertFile(file, { stage, throwErrors: true });
      if (ok === false) return;
      loadProject({ name: baseName(file.name) }, { name: file.name, fmt, handle });
      for (const add of stage) add();
      if (fmt !== 'step') offerEditable();
    } else { toast('3DJames opens 3MF, STEP, STL, OBJ and 3DJames project files.', 'err'); return; }
    app.savedModel = modelSnapshot(store.doc); app.savedAt = file.lastModified || Date.now(); rememberSavedModel();
    toast(`Opened ${file.name}`, 'info', 2200);
  } catch (err) { toast(`Could not open ${file.name}: ${err.message}`, 'err', 7000); }
}

/** Add a model from a file to the project. opts.stepParts: 'separate' or 'one' skips the question for STEP assemblies. */
export async function insertFile(file, opts = {}) {
  const fmt = fmtOf(file.name);
  try {
    const mb = file.size / 1048576;
    if (mb > 400) throw new Error(`That file is ${Math.round(mb)} MB, more than 3DJames can handle. Try exporting it with less detail or as separate parts.`);
    if (mb > 15) toast(`Reading ${file.name} (${Math.round(mb)} MB). Big files can take a minute or two.`, 'info', 9000);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (fmt === 'stl') await addMeshParts([{ name: baseName(file.name), stl: bytes }], opts.stage);
    else if (fmt === 'obj') await addMeshParts([{ ...parseObj(new TextDecoder().decode(bytes)), name: baseName(file.name) }], opts.stage);
    else if (fmt === '3mf') await addMeshParts(parse3mf(await readZip(bytes)).map((m) => ({ ...m, name: m.name || baseName(file.name) })), opts.stage);
    else if (fmt === 'step') return await addStep(baseName(file.name), bytes, opts.stepParts, opts.stage);
    else if (fmt === 'json' || fmt === '3dj') return openFile(file, null);
    else toast('Insert works with STEP, STL, 3MF and OBJ files.', 'err');
    return true;
  } catch (err) { if (opts.throwErrors) throw err; toast(`Could not insert ${file.name}: ${err.message}`, 'err', 7000); return false; }
}

/**
 * Add meshes (each { name, stl } or { name, verts, tris }) as objects. Every part is checked before any is added,
 * so a bad part leaves the project as it was; then they all come in as one undo step. Parts of one file (a 3MF
 * with several objects) keep where they were relative to each other; the group as a whole is placed like a new shape.
 */
async function addMeshParts(parts, stage) {
  const checked = [];
  for (const part of parts) {
    const stl = part.stl || meshToStl(part.verts, part.tris);
    const fid = newFileId();
    const info = await workerCall({ type: 'checkImport', fileId: fid, data: stl.slice().buffer });
    checked.push({ name: part.name, stl, fid, tris: info.tris, box: part.verts ? meshBox(part.verts) : null });
  }
  for (const c of checked) { markSent(c.fid); keepFile(c.fid, c.stl); }
  const all = checked.length > 1 && checked.every((c) => c.box) ? [0, 1].map((k) => [0, 1, 2].map((i) => (k ? Math.max : Math.min)(...checked.map((c) => c.box[k][i])))) : null;
  const add = () => {
    const ids = [];
    store.commit((doc) => {
      const at = placeNew();
      for (const c of checked) {
        const id = store.newId('b');
        // a shape sits on pos by the middle of its bottom, so each part's spot is its own bottom middle, measured from the group's
        const pos = all ? [at[0] + (c.box[0][0] + c.box[1][0] - all[0][0] - all[1][0]) / 2, at[1] + (c.box[0][1] + c.box[1][1] - all[0][1] - all[1][1]) / 2, at[2] + c.box[0][2] - all[0][2]].map((v) => Math.round(v * 1e4) / 1e4) : at;
        doc.features.push({ id: store.newId('f'), type: 'shape', body: id, kind: 'import', p: { file: c.fid, name: c.name, fmt: 'stl' }, pos, rot: [0, 0, 0] });
        doc.bodies[id] = { name: c.name, color: nextColor(doc) };
        ids.push(id);
      }
    });
    select(ids);
    for (const c of checked) if (c.tris > 60000) toast(`${c.name}: ${c.tris.toLocaleString()} triangles. Large models make combining slower.`);
  };
  if (stage) stage.push(add); else add();
}

function meshBox(verts) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < verts.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], verts[i + k]); mx[k] = Math.max(mx[k], verts[i + k]); }
  return [mn, mx];
}

function askStepParts(n) {
  // an assembly: bring each part in as its own object, or all of it as one
  const many = n > 200;
  return new Promise((resolve) => {
    const close = modal('This STEP file has several parts', h('div', { class: 'muted' }, many
      ? `It holds ${n.toLocaleString()} parts. That many separate objects makes 3DJames slow, so bringing it in as one object is recommended.`
      : `It holds ${n} parts. Bring them in as separate objects you can move, paint and delete one by one, or as a single object.`),
    () => [
      h('button', { class: 'btn' + (many ? ' primary' : ''), onclick: () => { close(); resolve('one'); } }, 'One object'),
      h('button', { class: 'btn' + (many ? '' : ' primary'), onclick: () => { close(); resolve('separate'); } }, `${n.toLocaleString()} separate parts`),
    ], () => resolve(null));
  });
}

async function addStep(name, bytes, partsChoice, stage) {
  toast('Reading the STEP file…', 'info', 2500);
  const fid = newFileId();
  const info = await workerCall({ type: 'checkImport', fmt: 'step', fileId: fid, data: bytes.slice().buffer });
  markSent(fid); keepFile(fid, bytes);
  const choice = info.parts > 1 ? partsChoice || await askStepParts(info.parts) : 'one';
  if (!choice) return false; // the question was closed: nothing is added
  const separate = choice === 'separate';
  const [mn, mx] = info.bbox;
  // every part shares the assembly's offset, so the parts stay where they belong relative to each other
  const off = [-(mn[0] + mx[0]) / 2, -(mn[1] + mx[1]) / 2, -mn[2]].map((v) => Math.round(v * 1e6) / 1e6);
  const add = () => {
    const ids = [];
    store.commit((doc) => {
      const pos = placeNew();
      const parts = separate ? [...Array(info.parts).keys()] : [null];
      for (const part of parts) {
        const id = store.newId('b');
        const partName = part == null ? name : `${name} part ${part + 1}`;
        const p = part == null ? { file: fid, name, fmt: 'step' } : { file: fid, name: partName, fmt: 'step', part, off };
        doc.features.push({ id: store.newId('f'), type: 'shape', body: id, kind: 'import', p, pos, rot: [0, 0, 0], name: partName });
        doc.bodies[id] = { name: partName, color: nextColor(doc) };
        ids.push(id);
      }
    });
    select(ids);
  };
  if (stage) stage.push(add); else add();
  return true;
}

/** A mesh was just opened: offer to rebuild it as sketches (Make editable) or keep it as it is. */
function offerEditable() {
  const ids = Object.keys(store.doc.bodies).filter((id) => canMakeEditable(store.doc, id));
  if (!ids.length) return;
  const close = modal('Make it editable?', h('div', {},
    h('p', {}, 'This file is a mesh: a shell of triangles. 3DJames can move, size and combine it, but not change its shape.'),
    h('p', {}, 'Make editable rebuilds it as sketches pushed up or spun around (with holes and cut-outs as steps), so you can change its sizes later in History. It works best on parts designed in a CAD app; figures and sculpted shapes stay meshes.'),
    detailPicker()),
  () => [
    h('button', { class: 'btn', onclick: () => close() }, 'Keep as a mesh'),
    h('button', { class: 'btn primary', onclick: async () => { close(); for (const id of ids) await makeEditable(id); } }, 'Make editable'),
  ]);
}

export function updateTitle() {
  const name = app.file?.name || `${store.doc.name || 'Untitled'}`;
  const el = $('docName');
  if (el && document.activeElement !== el) el.value = name + (app.dirty ? ' *' : '');
  document.title = `${name}${app.dirty ? ' *' : ''} - 3DJames`;
}

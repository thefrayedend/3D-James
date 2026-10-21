// Opening, saving, importing and exporting files.
import { store, emptyDoc, nextColor, normalizeDoc } from './store.js';
import { app, bodyData, bodyName } from './state.js';
import { $, h, toast, modal } from './ui/dom.js';
import { vp } from './view.js';
import { workerCall, markSent, waitForBuild } from './build.js';
import { keepFile, newFileId, absorbFiles, absorbVersions, versionDataForSave, filesForSave, toB64, rememberOpenFile, rememberFolder } from './storage.js';
import { drive } from './drive/index.js';
import { select, placeNew } from './commands.js';
import { endTool, setWorkplane } from './tools.js';
import { readZip, parse3mf, parseObj, meshToStl } from './formats.js';
import { modelSnapshot } from './versions.js';
import { idb } from './storage.js';
import { zipStore } from './zip.js';

// ---------------------------------------------------------------- file types
const TYPES = {
  '3dj': { description: '3DJames project (.3dj)', accept: { 'application/x-3djames': ['.3dj'] } },
  '3mf': { description: '3MF model (keeps the editable history)', accept: { 'model/3mf': ['.3mf'] } },
  json: { description: '3DJames project (.json)', accept: { 'application/json': ['.json'] } },
  stl: { description: 'STL mesh', accept: { 'model/stl': ['.stl'] } },
  step: { description: 'STEP solid', accept: { 'model/step': ['.step', '.stp'] } },
  obj: { description: 'OBJ mesh', accept: { 'model/obj': ['.obj'] } },
};
const allOf = (keys, description) => ({ description, accept: Object.assign({}, ...keys.map((k) => TYPES[k].accept)) });
const OPEN_TYPES = [allOf(['3dj', '3mf', 'json', 'step', 'stl', 'obj'], '3D files and 3DJames projects'), ...['3dj', 'json', '3mf', 'step', 'stl', 'obj'].map((k) => TYPES[k])];
const INSERT_TYPES = [allOf(['step', 'stl', '3mf', 'obj'], '3D models'), ...['step', 'stl', '3mf', 'obj'].map((k) => TYPES[k])];
const SAVE_TYPES = ['3dj', '3mf', 'json'].map((k) => TYPES[k]);

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
    .map((id) => ({ id, name: bodyName(id), color: store.doc.bodies[id]?.color || '#C3C3C3' }));
}

/** The bytes of the project in a file format. .3dj, 3MF and .json keep the full step history (and imported files). */
export async function buildFileData(fmt, onSnapshot) {
  if (app.preview) throw new Error('Apply or cancel the preview before saving or exporting.');
  if (['3mf', 'stl', 'step'].includes(fmt)) {
    await waitForBuild();
    if (Object.keys(app.results.errors).length) throw new Error('Fix the model problems before exporting geometry.');
  }
  const source = store.doc, revision = store.revision;
  const doc = JSON.parse(JSON.stringify(source));
  const portable = ['3dj', '3mf', 'json'].includes(fmt);
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
  if (fmt === 'json') {
    const embedded = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, toB64(v)]));
    return new TextEncoder().encode(JSON.stringify({ ...doc, ...(Object.keys(embedded).length ? { files: embedded } : {}), ...(Object.keys(versions).length ? { versionData: versions } : {}) }));
  }
  const items = exportItems();
  if (fmt === '3mf') {
    const extra = [...Object.entries(files).map(([k, v]) => ({ name: `Metadata/3djames-files/${k}`, data: v.slice().buffer })),
      ...Object.entries(versions).map(([k, v]) => ({ name: `Metadata/3djames-versions/${k}.json`, data: new TextEncoder().encode(JSON.stringify(v)).buffer }))];
    const r = await workerCall({ type: 'export', format: '3mf', items, base: safeName(), project: JSON.stringify(doc), extra });
    if (r.files[0].data.byteLength > 400 * 1048576) throw new Error('The 3MF exceeds 400 MB. Delete older versions or reduce model detail before saving.');
    return r.files[0].data;
  }
  if (!items.length) throw new Error('There is nothing to save yet.');
  if (fmt === 'step' && items.some((it) => !bodyData(it.id)?.solid)) toast('Threads and imported meshes are not solids, so they were left out of the STEP file.', 'info', 6000);
  const r = await workerCall({ type: 'export', format: fmt, items, base: safeName() });
  return r.files[0].data;
}

const lossyShown = new Set();
function lossyNote(fmt) {
  if ((fmt !== 'stl' && fmt !== 'step') || lossyShown.has(fmt)) return;
  lossyShown.add(fmt);
  toast(`${fmt.toUpperCase()} files keep only the finished shape, not the step history. Save as 3MF or a 3DJames project to keep everything editable.`, 'info', 7000);
}

function markSaved(name, fmt, handle, snapshot) {
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

/** Save: back into the file that is open, in its own format. */
export async function saveDoc() {
  const f = app.file;
  if (!f?.handle || !['3dj', '3mf', 'json'].includes(f.fmt)) return saveAs();
  try {
    lossyNote(f.fmt);
    let snapshot;
    const data = await buildFileData(f.fmt, (s) => { snapshot = s; });
    if (!(await writeChecked(f.handle, data))) return;
    markSaved(f.name, f.fmt, f.handle, snapshot);
  } catch (err) { toast(`Could not save: ${err.message}`, 'err', 7000); }
}

/** Save as: pick the place, the name and the type. */
export async function saveAs() {
  const handle = await drive.pickSave({ suggestedName: `${safeName()}.${['json', '3mf'].includes(app.file?.fmt) ? app.file.fmt : '3dj'}`, types: SAVE_TYPES });
  if (!handle) return;
  if (handle === 'download') return saveAsDownload();
  const fmt = fmtOf(handle.name) || '3dj';
  if (!['3dj', '3mf', 'json'].includes(fmt)) return toast('Save preserves an editable project. Use File → Export for STL or STEP.', 'err');
  try {
    lossyNote(fmt);
    let snapshot;
    const data = await buildFileData(fmt, (s) => { snapshot = s; });
    if (!(await writeChecked(handle, data))) return;
    markSaved(handle.name, fmt, handle, snapshot);
  } catch (err) { toast(`Could not save: ${err.message}`, 'err', 7000); }
}

function saveAsDownload() {
  // only where the Windows save window is not available: the file goes to Downloads
  const opt = (val, title, sub, on) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'fmt', value: val, checked: on }), h('b', {}, title), h('small', {}, sub));
  const nameIn = h('input', { class: 'in', value: safeName(), 'aria-label': 'File name', style: 'font-family:var(--ui)' });
  const form = h('form', { style: 'display:grid;gap:10px' }, h('div', { class: 'field' }, h('label', { class: 'plain' }, 'File name'), nameIn),
    h('div', { style: 'display:grid;gap:6px' },
      opt('3dj', '3DJames project (.3dj)', 'Everything: full step history and any imported files.', true),
      opt('3mf', '3MF', 'Opens in slicers and keeps the full step history for 3DJames.'),
      opt('json', '3DJames project (.json)', 'Full step history, as text (older format).')));
  const close = modal('Save as', form, (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => form.requestSubmit() }, 'Save')]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fmt = new FormData(form).get('fmt');
    const name = `${(nameIn.value || 'model').trim()}.${fmt}`;
    close();
    try {
      lossyNote(fmt);
      let snapshot;
      const blob = new Blob([await buildFileData(fmt, (s) => { snapshot = s; })]);
      const a = h('a', { href: URL.createObjectURL(blob), download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      markSaved(name, fmt, null, snapshot);
    } catch (err) { toast(err.message, 'err', 7000); }
  });
  nameIn.focus(); nameIn.select();
}

/** Export never changes the project's save location or clears its unsaved state. */
export async function exportDialog() {
  const format = h('select', { class: 'in', 'aria-label': 'Export format' }, [['stl', 'STL — finished mesh'], ['step', 'STEP — exact solids'], ['3mf', '3MF — model and editable project']].map(([value, label]) => h('option', { value }, label)));
  const name = h('input', { class: 'in', value: safeName(), 'aria-label': 'Export name' });
  const form = h('form', { style: 'display:grid;gap:12px' }, h('label', {}, 'Format', format), h('label', {}, 'File name', name), h('p', { class: 'muted' }, 'Export creates an output file. Your editable project still needs to be saved separately.'));
  const close = modal('Export model', form, (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => form.requestSubmit() }, 'Export')]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); const fmt = format.value;
    try {
      // Request the picker before geometry work to preserve the browser's user activation.
      let handle = null;
      if (drive.mode === 'server') {
        close();
        handle = await drive.pickSave({ suggestedName: `${name.value || 'model'}.${fmt}`, types: [TYPES[fmt]], title: 'Export to' });
        if (!handle) return;
        if (handle === 'download') handle = null;
      } else if (window.showSaveFilePicker) handle = await window.showSaveFilePicker({ suggestedName: `${name.value || 'model'}.${fmt}`, types: [TYPES[fmt]], excludeAcceptAllOption: true });
      close();
      const data = await buildFileData(fmt);
      if (handle) { await drive.write(handle, data); if (drive.mode === 'local') rememberFolder(handle); }
      else {
        const url = URL.createObjectURL(new Blob([data]));
        const a = h('a', { href: url, download: `${name.value || 'model'}.${fmt}` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
      toast('Exported model. Your project save location and unsaved changes are unchanged.');
    } catch (err) { if (err.name !== 'AbortError') toast(`Could not export: ${err.message}`, 'err', 7000); }
  });
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
        for (const m of parse3mf(zip)) await addMeshBody(m.name || baseName(file.name), meshToStl(m.verts, m.tris), stage);
        loadProject({ name: baseName(file.name) }, { name: file.name, fmt: '3mf', handle });
        for (const add of stage) add();
      }
    } else if (fmt === 'stl' || fmt === 'obj' || fmt === 'step') {
      const stage = [];
      const ok = await insertFile(file, { stage, throwErrors: true });
      if (ok === false) return;
      loadProject({ name: baseName(file.name) }, { name: file.name, fmt, handle });
      for (const add of stage) add();
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
    if (fmt === 'stl') await addMeshBody(baseName(file.name), bytes, opts.stage);
    else if (fmt === 'obj') { const m = parseObj(new TextDecoder().decode(bytes)); await addMeshBody(baseName(file.name), meshToStl(m.verts, m.tris), opts.stage); }
    else if (fmt === '3mf') { for (const m of parse3mf(await readZip(bytes))) await addMeshBody(m.name || baseName(file.name), meshToStl(m.verts, m.tris), opts.stage); }
    else if (fmt === 'step') return await addStep(baseName(file.name), bytes, opts.stepParts, opts.stage);
    else if (fmt === 'json' || fmt === '3dj') return openFile(file, null);
    else toast('Insert works with STEP, STL, 3MF and OBJ files.', 'err');
    return true;
  } catch (err) { if (opts.throwErrors) throw err; toast(`Could not insert ${file.name}: ${err.message}`, 'err', 7000); return false; }
}

async function addMeshBody(name, stlBytes, stage) {
  const fid = newFileId();
  const info = await workerCall({ type: 'checkImport', fileId: fid, data: stlBytes.slice().buffer });
  markSent(fid); keepFile(fid, stlBytes);
  const add = () => {
    let id;
    store.commit((doc) => {
      id = store.newId('b');
      doc.features.push({ id: store.newId('f'), type: 'shape', body: id, kind: 'import', p: { file: fid, name, fmt: 'stl' }, pos: placeNew(), rot: [0, 0, 0] });
      doc.bodies[id] = { name, color: nextColor(doc) };
    });
    select([id]);
    if (info.tris > 60000) toast(`${name}: ${info.tris.toLocaleString()} triangles. Large models make combining slower.`);
  };
  if (stage) stage.push(add); else add();
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

export function updateTitle() {
  const name = app.file?.name || `${store.doc.name || 'Untitled'}`;
  const el = $('docName');
  if (el && document.activeElement !== el) el.value = name + (app.dirty ? ' *' : '');
  document.title = `${name}${app.dirty ? ' *' : ''} - 3DJames`;
}

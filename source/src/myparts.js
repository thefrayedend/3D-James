// My parts: save any object (with every step that made it, and any imported files) and add it to other projects.
// Each part is a normal .3dj file in a folder you pick once (your "3D Objects" folder, in a "3DJames Parts" folder),
// so every copy of 3DJames (the one on your PC and the installed one) shares the same parts, and you can see,
// back up and share them in File Explorer. Browsers that can't use folders keep them inside the browser instead.
import { Matrix4 } from 'three';
import { store, stepTree, featureRefs } from './store.js';
import { bodyData, bodyName } from './state.js';
import { h, ic, toast, modal } from './ui/dom.js';
import { idb, fileStore, keepFile, newFileId, fileRefsOf, renameStepFiles } from './storage.js';
import { select, placeNew, bodyMatrixFeature } from './commands.js';
import { zipStore } from './zip.js';
import { readZip } from './formats.js';
import { drive } from './drive/index.js';

const NAME = /[A-Za-z_][A-Za-z0-9_]*/g;
const FOLDER = '3DJames Parts';
const onServer = () => drive.mode === 'server';
const canUseFolders = () => onServer() || typeof window.showDirectoryPicker === 'function';

/** The parts, newest list: [{ name, file, part }] (file = the .3dj file name in the folder, if any). */
export let myParts = [];

// ---------------------------------------------------------------- the parts folder
let current = null;
async function savedFolder() { if (current) return current; if (onServer()) return (current = await drive.partsDir().catch(() => null)); try { return (current = (await idb.get('kv', 'partsFolder')) || null); } catch { return null; } }
async function allowed(dir, ask) {
  const opts = { mode: 'readwrite' };
  if (!dir.queryPermission) return true; // a folder the browser keeps for us (no question needed)
  if ((await dir.queryPermission(opts)) === 'granted') return true;
  if (!ask) return false;
  try { return (await dir.requestPermission(opts)) === 'granted'; } catch { return false; }
}
/** The parts folder, or null. ask: may show the browser's permission question (needs a click to have just happened). */
async function partsFolder(ask) {
  const dir = await savedFolder();
  return dir && (await allowed(dir, ask)) ? dir : null;
}

/** Ask where My parts live (once). Suggests the 3D Objects folder; makes a "3DJames Parts" folder inside it. */
export function chooseFolder() {
  return new Promise((resolve) => {
    modal('Where to keep My parts', [
      h('p', {}, 'My parts are saved as .3dj files in a folder, so every copy of 3DJames can use them and you can see them in File Explorer.'),
      h('p', {}, 'Pick your ', h('b', {}, '3D Objects'), ' folder (it is in your user folder, next to Documents: C:\\Users\\you\\3D Objects). 3DJames makes a "', FOLDER, '" folder inside it.'),
    ], (done) => [h('button', { class: 'btn', onclick: () => { done(); resolve(null); } }, 'Cancel'), h('button', { class: 'btn primary', onclick: async () => {
      let dir;
      try { dir = await window.showDirectoryPicker({ id: '3dj-parts', mode: 'readwrite', startIn: 'documents' }); } catch { return; } // closed the window: stay here
      done();
      resolve(await usePartsFolder(dir));
      toast(`My parts are kept in "${FOLDER}".`, 'info', 3500);
    } }, 'Choose folder…')], () => resolve(null));
  });
}

/** Use this folder for My parts (makes "3DJames Parts" inside it unless that is the one picked). */
export async function usePartsFolder(dir) {
  if (dir.name !== FOLDER) dir = await dir.getDirectoryHandle(FOLDER, { create: true });
  current = dir;
  await idb.put('kv', dir, 'partsFolder').catch(() => {}); // remembered for next time
  await moveOldParts(dir);
  await refreshMyParts();
  return dir;
}

// parts saved inside the browser before the folder existed are written out as files once
async function moveOldParts(dir) {
  let old = [];
  try { old = (await idb.get('kv', 'myParts')) || []; } catch { /* none */ }
  for (const p of old) {
    const name = fileName(p.name);
    try { await dir.getFileHandle(name); continue; } catch { /* not there yet */ }
    await writeFile(dir, name, partBytes(p));
  }
  if (old.length) { await idb.put('kv', old, 'myPartsMoved'); await idb.put('kv', [], 'myParts'); }
}

// ---------------------------------------------------------------- part <-> .3dj file
const fileName = (name) => `${String(name || 'Part').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Part'}.3dj`;
function partBytes(p) {
  // a normal 3DJames project (opens like any other), plus which object is the part and how big it is
  const doc = { v: 1, name: p.name, vars: p.vars || [], bodies: p.bodies, features: p.features, counters: {}, part: { root: p.root, bbox: p.bbox, saved: p.saved || Date.now() } };
  const enc = new TextEncoder();
  return zipStore([{ name: 'project.json', data: enc.encode(JSON.stringify(doc, null, 1)) },
    ...Object.entries(p.files || {}).map(([k, v]) => ({ name: `files/${k}`, data: v }))]);
}
async function partFromBytes(bytes, fallbackName) {
  const zip = await readZip(bytes);
  const doc = JSON.parse(new TextDecoder().decode(zip.get('project.json')));
  const files = {};
  for (const [k, v] of zip) if (k.startsWith('files/')) files[k.slice(6)] = v;
  const shapes = (doc.features || []).filter((f) => f.body);
  // a plain project dropped into the folder works too: its last object is placed beside your model
  return { name: doc.name || fallbackName, features: doc.features || [], bodies: doc.bodies || {}, vars: doc.vars || [], files,
    root: doc.part?.root || shapes[shapes.length - 1]?.body, bbox: doc.part?.bbox || null, saved: doc.part?.saved || 0 };
}
async function writeFile(dir, name, bytes) {
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(bytes); await w.close();
}

// ---------------------------------------------------------------- the list
const cache = new Map(); // file name -> { stamp, part }
/** Read the parts again (from the folder, or from the browser). ask: may ask for permission to the folder. */
export async function refreshMyParts(ask = false) {
  const dir = canUseFolders() ? await partsFolder(ask) : null;
  if (!dir) {
    if (!canUseFolders() || !(await savedFolder())) {
      let list = []; try { list = (await idb.get('kv', 'myParts')) || []; } catch { /* none */ }
      myParts = list.map((part) => ({ name: part.name, part }));
    }
    return myParts;
  }
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !/\.3dj$/i.test(name)) continue;
    try {
      const f = await handle.getFile(), stamp = `${f.size}-${f.lastModified}`;
      let c = cache.get(name);
      if (!c || c.stamp !== stamp) { c = { stamp, part: await partFromBytes(new Uint8Array(await f.arrayBuffer()), name.replace(/\.3dj$/i, '')) }; cache.set(name, c); }
      out.push({ name: c.part.name, file: name, part: c.part });
    } catch { /* not a 3DJames file: skip it */ }
  }
  myParts = out.sort((a, b) => a.name.localeCompare(b.name));
  return myParts;
}
/** At start: show the parts if the folder is already allowed (no questions asked). */
export const loadMyParts = () => refreshMyParts(false).catch(() => myParts);

/** Save the object to My parts. */
export async function saveToMyParts(id) {
  const doc = store.doc;
  const d = bodyData(id);
  if (!d) return;
  // every step that went into it, in project order
  const ids = new Set();
  const walk = (nodes) => { for (const n of nodes) { ids.add(n.f.id); for (const u of n.uses) walk(u.steps); } };
  walk(stepTree(doc, id));
  const features = doc.features.filter((f) => ids.has(f.id) && !f.suppressed);
  const bodies = Object.fromEntries([...new Set(features.flatMap(featureRefs))].map((b) => [b, doc.bodies[b] || {}]));
  // the variables those steps use
  const text = JSON.stringify(features);
  const used = new Set(text.match(NAME));
  const vars = doc.vars.filter((v) => used.has(v.name));
  const files = {};
  for (const f of features) for (const fid of fileRefsOf(f)) if (fileStore.has(fid)) files[fid] = fileStore.get(fid);
  const name = bodyName(id);
  const part = { name, saved: Date.now(), root: id, features, bodies, vars, files, bbox: d.bbox };
  if (canUseFolders()) {
    const dir = (await partsFolder(true)) || (await chooseFolder());
    if (!dir) return;
    await writeFile(dir, fileName(name), partBytes(part));
    await refreshMyParts();
    toast(`Saved "${name}" to My parts (${fileName(name)} in "${FOLDER}").`, 'info', 4000);
    return;
  }
  let list = []; try { list = (await idb.get('kv', 'myParts')) || []; } catch { /* none */ }
  await idb.put('kv', [...list.filter((p) => p.name !== name), part], 'myParts');
  await refreshMyParts();
  toast(`Saved "${name}" to My parts (Insert tab > Parts > My parts).`, 'info', 4000);
}

/** Add a saved part to the open project, beside what is already there. */
export function insertMyPart(part) {
  const doc0 = store.doc;
  const fileNames = {};
  for (const [fid, bytes] of Object.entries(part.files || {})) { fileNames[fid] = newFileId(); keepFile(fileNames[fid], bytes); }
  // variables: reuse ones that match, rename ones whose name is taken by a different value
  const varNames = {};
  const addVars = [];
  for (const v of part.vars || []) {
    const mine = doc0.vars.find((x) => x.name === v.name);
    if (mine && mine.expr === v.expr) continue;
    let n = v.name;
    if (mine) { let k = 2; while (doc0.vars.some((x) => x.name === `${v.name}_${k}`)) k++; n = `${v.name}_${k}`; varNames[v.name] = n; }
    addVars.push({ name: n, expr: v.expr });
  }
  const renameVars = (x) => (typeof x === 'string' && Object.keys(varNames).length ? x.replace(NAME, (w) => varNames[w] || w) : x);
  const deep = (x) => (Array.isArray(x) ? x.map(deep) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deep(v)])) : renameVars(x));
  let root;
  store.commit((doc) => {
    const ids = {};
    const bid = (b) => (ids[b] ||= store.newId('b'));
    doc.vars.push(...addVars.map((v) => ({ ...v, expr: renameVars(v.expr) })));
    for (const f0 of part.features) {
      const f = deep(f0);
      f.id = store.newId('f');
      for (const k of ['body', 'body2', 'src']) if (f[k]) f[k] = bid(f[k]);
      if (f.tools) f.tools = f.tools.map(bid);
      doc.features.push(renameStepFiles(f, fileNames));
    }
    for (const [b, props] of Object.entries(part.bodies)) if (ids[b]) { const p = { ...props }; delete p.group; doc.bodies[ids[b]] = p; }
    root = ids[part.root];
    // put it to the right of what is already there
    if (part.bbox && root) {
      const [mn, mx] = part.bbox;
      const at = placeNew();
      bodyMatrixFeature(doc, root, new Matrix4().makeTranslation(at[0] - (mn[0] + mx[0]) / 2, at[1] - (mn[1] + mx[1]) / 2, -mn[2]));
    }
  });
  if (root) select([root]);
}

/** List of saved parts with a way to delete them, and where they are kept. */
export async function manageMyParts() {
  await refreshMyParts(true);
  const dir = canUseFolders() ? await partsFolder(false) : null;
  const when = (t) => (t ? new Date(t).toLocaleDateString() : '');
  const list = h('div', { style: 'display:grid;gap:4px;max-height:50vh;overflow:auto' });
  const remove = async (p) => {
    if (p.file && dir) { try { await dir.removeEntry(p.file); } catch (e) { toast(`Could not delete ${p.file}: ${e.message}`, 'err'); } }
    else { let l = []; try { l = (await idb.get('kv', 'myParts')) || []; } catch { /* none */ } await idb.put('kv', l.filter((x) => x.name !== p.name), 'myParts'); }
    await refreshMyParts(); fill();
  };
  const fill = () => {
    list.replaceChildren(...(myParts.length ? myParts.map((p) => h('div', { class: 'stat', style: 'align-items:center' }, h('span', {}, [p.name, when(p.part.saved)].filter(Boolean).join(' · ')),
      h('button', { class: 'ib', title: p.file ? `Delete ${p.file}` : 'Remove from My parts', onclick: () => remove(p) }, ic('Trash2'))))
      : [h('div', { class: 'muted' }, 'No saved parts yet. Select an object and click "Save to My parts" in Properties.')]));
  };
  fill();
  const where = !canUseFolders() ? 'They are kept inside this browser.'
    : onServer() ? `They are .3dj files in the "${FOLDER}" folder of your own folder on the server.`
    : dir ? `They are .3dj files in your "${dir.name}" folder. Add or delete files there and they show up here.` : 'No folder chosen yet.';
  modal('My parts', [h('div', { class: 'muted' }, 'Parts you saved, with every step that made them. They can be added to any project. ', where), list],
    (close) => [canUseFolders() && !onServer() ? h('button', { class: 'btn', onclick: async () => { close(); await chooseFolder(); } }, dir ? 'Change folder…' : 'Choose folder…') : null,
      h('button', { class: 'btn', onclick: close }, 'Close')].filter(Boolean));
}

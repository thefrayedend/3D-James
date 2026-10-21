// Everything 3DJames keeps in the browser's own database: the work in progress, automatic backups,
// imported model files, and the last folder used in the Open/Save windows.
import { store, normalizeDoc } from './store.js';
import { app } from './state.js';
import { h, toast, $ } from './ui/dom.js';
import { reviveHandle } from './drive/index.js';

function backupFailure(err) {
  app.backupError = err?.message || 'Browser storage is unavailable. Save a project file to keep your work.';
  let notice = $('backupWarning');
  if (!notice) {
    notice = h('div', { id: 'backupWarning', class: 'toast err', role: 'alert', style: 'position:fixed;bottom:36px;right:12px;z-index:10000;max-width:420px' });
    document.body.append(notice);
  }
  notice.textContent = 'Backup unavailable. Save a project file to keep your work.';
  notice.title = app.backupError;
}
function backupRecovered() { app.backupError = null; $('backupWarning')?.remove(); }
const failedFileWrites = new Set();
export const idb = {
  db: null,
  // on a 3DJames server each person gets their own (so people sharing a tablet never see each other's work)
  name: '3djames',
  async open() {
    if (this.db) return this.db;
    this.db = await new Promise((res, rej) => {
      const r = indexedDB.open(this.name, 2);
      r.onupgradeneeded = () => {
        const names = r.result.objectStoreNames;
        if (!names.contains('kv')) r.result.createObjectStore('kv');
        if (!names.contains('backups')) r.result.createObjectStore('backups', { keyPath: 't' });
        if (!names.contains('files')) r.result.createObjectStore('files');
      };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async tx(storeName, mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => { const t = db.transaction(storeName, mode); const st = t.objectStore(storeName); const r = fn(st); t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Storage transaction was aborted')); });
  },
  put(s, val, key) { return this.tx(s, 'readwrite', (st) => (key === undefined ? st.put(val) : st.put(val, key))); },
  get(s, key) { return this.tx(s, 'readonly', (st) => st.get(key)); },
  all(s) { return this.tx(s, 'readonly', (st) => st.getAll()); },
  del(s, key) { return this.tx(s, 'readwrite', (st) => st.delete(key)); },
};

// ---------------------------------------------------------------- imported model files
// Imported STEP/STL/3MF/OBJ bytes live here (and in the database), never inside the project itself,
// so undo, backups and the project stay small and fast even with huge models.
export const fileStore = new Map();
export const versionStore = new Map();
export function keepVersion(id, snapshot) {
  versionStore.set(id, snapshot);
  idb.put('kv', snapshot, 'version:' + id).catch(backupFailure);
}
export function versionDataForSave(doc) {
  const out = {};
  for (const v of doc.versions || []) {
    const snapshot = versionStore.get(v.id);
    if (!snapshot) throw new Error(`Saved version "${v.label}" is missing. Remove it or restore its project file before saving.`);
    out[v.id] = snapshot;
  }
  return out;
}
export function absorbVersions(doc) {
  if (!doc.versionData) return doc;
  const versions = (doc.versions || []).map((v) => {
    if (!Object.prototype.hasOwnProperty.call(doc.versionData, v.id)) throw new Error(`Saved version "${v.label}" is missing.`);
    const snapshot = normalizeDoc(doc.versionData[v.id]);
    delete snapshot.versions; delete snapshot.versionData; delete snapshot.files;
    const id = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    keepVersion(id, snapshot);
    return { ...v, id };
  });
  const out = { ...doc, versions }; delete out.versionData;
  return out;
}

/** The stored files a step uses: an imported model, or a sketch's photo. */
export function fileRefsOf(f) {
  if (f?.type !== 'shape') return [];
  if (f.kind === 'import' && f.p?.file) return [f.p.file];
  if (f.kind === 'sketch' && f.p?.photo?.file) return [f.p.photo.file];
  return [];
}
/** Every stored file a project (and its saved versions) uses. modelsOnly: just the imported models (for the engine). */
export function referencedFiles(doc, { modelsOnly = false } = {}) {
  const out = new Set();
  const snapshots = [doc, ...(doc.versions || []).map((v) => versionStore.get(v.id)).filter(Boolean)];
  for (const snapshot of snapshots) for (const f of snapshot.features || []) if (!modelsOnly || f.kind === 'import') for (const id of fileRefsOf(f)) out.add(id);
  return out;
}
export function bytesFromB64(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
export function toB64(bytes) { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }

/** A name for an imported file that no other project will ever use (they all share one store). */
export const newFileId = () => `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
/** A step pointed at new file names (imported model, sketch photo). */
export function renameStepFiles(f, names) {
  if (f?.type !== 'shape') return f;
  if (f.kind === 'import' && names[f.p?.file]) return { ...f, p: { ...f.p, file: names[f.p.file] } };
  if (f.kind === 'sketch' && names[f.p?.photo?.file]) return { ...f, p: { ...f.p, photo: { ...f.p.photo, file: names[f.p.photo.file] } } };
  return f;
}
/** Point a project's steps at new file names. */
export function renameFiles(doc, names) {
  return { ...doc, features: (doc.features || []).map((f) => renameStepFiles(f, names)),
    ...(doc.versionData ? { versionData: Object.fromEntries(Object.entries(doc.versionData).map(([id, snapshot]) => [id, renameFiles(snapshot, names)])) } : {}) };
}
export function keepFile(id, bytes) {
  fileStore.set(id, bytes);
  idb.put('files', bytes, id).then(() => { failedFileWrites.delete(id); }).catch((err) => { failedFileWrites.add(id); backupFailure(err); });
}
/** Project files (.json, .3mf) carry their imported files with them; take them out of the project on open. */
// Each file gets a fresh name, so it can never overwrite another project's file with the same old name.
export function absorbFiles(doc) {
  if (!doc.files) return doc;
  const names = {};
  for (const [id, v] of Object.entries(doc.files)) {
    names[id] = newFileId();
    keepFile(names[id], typeof v === 'string' ? bytesFromB64(v) : new Uint8Array(v));
  }
  const d = renameFiles(doc, names); delete d.files;
  return d;
}
export async function loadStoredFiles(doc) {
  for (const v of doc.versions || []) if (!versionStore.has(v.id)) {
    try { const snapshot = await idb.get('kv', 'version:' + v.id); if (snapshot) versionStore.set(v.id, normalizeDoc(snapshot)); }
    catch (err) { backupFailure(err); }
  }
  for (const id of referencedFiles(doc)) {
    if (fileStore.has(id)) continue;
    try { const b = await idb.get('files', id); if (b) fileStore.set(id, b); } catch { /* database unavailable */ }
  }
}
export function filesForSave(doc) {
  const out = {};
  for (const id of referencedFiles(doc)) {
    if (!fileStore.has(id)) throw new Error(`An imported file is missing (${id}). Restore or reinsert it before saving.`);
    out[id] = fileStore.get(id);
  }
  return out;
}

// ---------------------------------------------------------------- work in progress and backups
// Written a moment after you stop changing things (never during a drag), so it never slows you down.
let backupTimer = null, lastVersionAt = 0;
export function scheduleBackup() {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(async function run() {
    if (app.dragging) { backupTimer = setTimeout(run, 1500); return; }
    const json = JSON.stringify(store.doc);
    try {
      for (const v of store.doc.versions || []) { const snapshot = versionStore.get(v.id); if (snapshot) await idb.put('kv', snapshot, 'version:' + v.id); }
      await idb.put('kv', json, 'current');
      if (Date.now() - lastVersionAt > 60000) {
        const versionAt = Date.now();
        await idb.put('backups', { t: versionAt, name: store.doc.name || 'Untitled', json });
        lastVersionAt = versionAt;
        const all = (await idb.all('backups')).sort((a, b) => b.t - a.t);
        for (const old of all.slice(25)) await idb.del('backups', old.t);
      }
      // Retry imported files that could not previously be persisted.
      for (const id of failedFileWrites) {
        const bytes = fileStore.get(id);
        if (bytes) { await idb.put('files', bytes, id); failedFileWrites.delete(id); }
      }
      if (!failedFileWrites.size) backupRecovered();
    } catch (err) { backupFailure(err); }
  }, 2500);
}

/** The project that was open last time (or null). */
export async function restoreSession() {
  let json = null;
  try { json = await idb.get('kv', 'current'); } catch (err) { backupFailure(err); }
  if (!json) {
    // projects from the BuildPlate days were kept in simpler browser storage; move them over once
    try { json = localStorage.getItem('buildplate.doc'); if (json) localStorage.removeItem('buildplate.doc'); } catch { /* */ }
  }
  if (!json) return null;
  let doc;
  try { doc = absorbVersions(absorbFiles(normalizeDoc(JSON.parse(json)))); } catch { return null; }
  await loadStoredFiles(doc);
  let file = null;
  try { file = (await idb.get('kv', 'file')) || null; } catch { /* */ }
  if (file?.handle) file.handle = reviveHandle(file.handle);
  let saved = null;
  try { const record = await idb.get('kv', 'savedModel'); if (record?.name === file?.name) saved = record; } catch { /* current model remains available */ }
  return { doc, file, savedModel: saved?.model || null, savedAt: saved?.t || null };
}
export const rememberOpenFile = (file) => idb.put('kv', file || null, 'file').catch(() => {});

export async function backupsDialog(restore) {
  let list = [];
  try { list = (await idb.all('backups')).sort((a, b) => b.t - a.t); } catch { /* */ }
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) back.remove(); } });
  const when = (t) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  back.append(h('div', { class: 'modal' }, h('h2', {}, 'Backups'),
    h('div', { class: 'muted' }, '3DJames keeps a copy of your work about once a minute while you change things (last 25). Restoring one replaces what is on screen; Undo brings it back.'),
    list.length ? h('div', { style: 'display:grid;gap:4px;max-height:50vh;overflow:auto' }, list.map((b) => h('div', { class: 'stat', style: 'align-items:center' }, h('span', {}, `${b.name} · ${when(b.t)}`), h('button', { class: 'btn', onclick: async () => {
      back.remove();
      const d = JSON.parse(b.json); await loadStoredFiles(d); restore(absorbFiles(d));
      toast(`Restored the backup from ${when(b.t)}`);
    } }, 'Restore')))) : h('div', { class: 'muted' }, 'No backups yet.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => back.remove() }, 'Close'))));
  document.body.append(back);
}

// ---------------------------------------------------------------- folders for the Open and Save windows
// The browser cannot open a folder by its path, but it can start in the folder of a file or folder it was given before.
export async function lastFolder() { try { return (await idb.get('kv', 'lastHandle')) || (await idb.get('kv', 'projectsFolder')) || null; } catch { return null; } }
export const rememberFolder = (handle) => { if (handle) idb.put('kv', handle, 'lastHandle').catch(() => {}); };
export const setProjectsFolder = (dir) => idb.put('kv', dir, 'projectsFolder');
export async function projectsFolder() { try { return (await idb.get('kv', 'projectsFolder')) || null; } catch { return null; } }

// Files on a 3DJames server (the appliance). The server logs people in before the app loads and decides which
// folders each person may use; here they show up in 3DJames' own Open / Save window. Handles behave like the
// browser's file handles (name, getFile, createWritable), so the rest of the app treats them the same way.
//
// Server API (same address as the app; the login cookie goes along by itself):
//   GET  /api/me                          { user, name, admin, folders: [{ id, label, write }], version }
//   GET  /api/list?folder=&path=          { entries: [{ name, dir, size, mtime }] }
//   GET  /api/file?folder=&path=          the bytes; header ETag
//   PUT  /api/file?folder=&path=          body = bytes; header If-Match: <etag> | new | any -> { etag }
//                                         409 { error: 'conflict', by, mtime } when someone saved it meanwhile
//   POST /api/mkdir   { folder, path }    POST /api/delete { folder, path }
//   POST /api/presence { folder, path }   -> { others: [names] } (who else has that file open; empty path: none)
//   GET  /logout
import { app } from '../state.js';
import { h, ic, toast, modal } from '../ui/dom.js';

export const mode = 'server';
export let me = null;

const api = async (path, opts = {}) => {
  const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...opts });
  if (r.status === 401) { location.href = '/login'; throw new Error('Signed out. Please sign in again.'); }
  return r;
};
const json = async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || `The server said ${r.status}`), j); return j; };
const qs = (o) => new URLSearchParams(o).toString();
const join = (...p) => p.filter(Boolean).join('/').replace(/\/+/g, '/');

/** Is this app running on a 3DJames server? Then sign-in info and folders come from it. */
export async function connect() {
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return false;
    const j = await r.json();
    if (!j?.user || !Array.isArray(j.folders)) return false;
    me = j;
    startPresence();
    return true;
  } catch { return false; }
}

// ---------------------------------------------------------------- handles
/** A file on the server. Saving checks that nobody else saved it since it was opened (unless loose). */
export class ServerFileHandle {
  // loose: never checked (My parts); replaceOnce: the next save replaces what is there (picked in Save as)
  constructor(folder, path, etag = null, loose = false, replaceOnce = false) { this.kind = 'file'; this.__server = 1; this.folder = folder; this.path = path; this.etag = etag; this.loose = loose; this.replaceOnce = replaceOnce; }
  get name() { return this.path.split('/').pop(); }
  async getFile() {
    const r = await api(`/api/file?${qs({ folder: this.folder, path: this.path })}`);
    if (!r.ok) await json(r);
    this.etag = r.headers.get('ETag');
    const buf = await r.arrayBuffer();
    return new File([buf], this.name, { lastModified: +r.headers.get('X-Modified') || Date.now() });
  }
  async createWritable() {
    const parts = [];
    return { write: async (d) => { parts.push(d); }, close: async () => this.put(new Blob(parts)), abort: async () => {} };
  }
  async put(body, force = false) {
    const r = await api(`/api/file?${qs({ folder: this.folder, path: this.path })}`, { method: 'PUT', body, headers: { 'If-Match': force || this.loose || this.replaceOnce ? 'any' : this.etag || 'new' } });
    if (r.status === 409) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(`${this.name} was changed on the server since you opened it${j.by ? ` (by ${j.by})` : ''}.`), { conflict: j }); }
    this.etag = (await json(r)).etag; this.replaceOnce = false;
  }
}
/** A folder on the server, with the parts of the browser's folder-handle API that My parts uses. */
export class ServerDirHandle {
  constructor(folder, path) { this.kind = 'directory'; this.__server = 1; this.folder = folder; this.path = path; }
  get name() { return this.path.split('/').pop() || folderLabel(this.folder); }
  async *entries() {
    for (const e of await list(this.folder, this.path)) yield [e.name, e.dir ? new ServerDirHandle(this.folder, join(this.path, e.name)) : new ServerFileHandle(this.folder, join(this.path, e.name), null, true)];
  }
  async getFileHandle(name) { return new ServerFileHandle(this.folder, join(this.path, name), null, true); }
  async getDirectoryHandle(name, { create } = {}) { if (create) await mkdir(this.folder, join(this.path, name)); return new ServerDirHandle(this.folder, join(this.path, name)); }
  async removeEntry(name) { await json(await api('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: this.folder, path: join(this.path, name) }) })); }
}
/** Handles kept in the browser's database come back as plain objects: make them handles again. */
export const revive = (x) => (x?.__server ? (x.kind === 'directory' ? new ServerDirHandle(x.folder, x.path) : new ServerFileHandle(x.folder, x.path, x.etag, x.loose)) : null);

async function list(folder, path) { return (await json(await api(`/api/list?${qs({ folder, path })}`))).entries || []; }
async function mkdir(folder, path) { await json(await api('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder, path }) })); }
const folderLabel = (id) => me?.folders.find((f) => f.id === id)?.label || id;

/** Write a file (Save). opts.force: overwrite even if someone else saved it meanwhile. */
export async function write(handle, data, opts = {}) {
  if (!handle?.__server) throw new Error('That file is not on the server.');
  await handle.put(new Blob([data]), !!opts.force);
  presence(handle);
}

/** My parts live in "3DJames Parts" in your own folder (the first one you may write to). */
export async function partsDir() {
  const home = me?.folders.find((f) => f.write);
  if (!home) return null;
  await mkdir(home.id, '3DJames Parts');
  return new ServerDirHandle(home.id, '3DJames Parts');
}

// ---------------------------------------------------------------- who else has the file open
let lastOthers = '';
async function presence(handle) {
  try {
    const body = handle?.__server ? { folder: handle.folder, path: handle.path } : {};
    const j = await json(await api('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const others = (j.others || []).join(', ');
    if (others && others !== lastOthers) toast(`${others} also ${j.others.length === 1 ? 'has' : 'have'} ${handle.name} open. Saving over each other loses work: agree who saves, or use Save as.`, 'info', 9000);
    lastOthers = others;
  } catch { /* the server will answer next time */ }
}
function startPresence() { setInterval(() => presence(app.file?.handle), 45000); }

// ---------------------------------------------------------------- the Open / Save window
const prefKey = () => `3dj.fb.${me?.user}`;
const rememberPlace = (p) => { try { localStorage.setItem(prefKey(), JSON.stringify(p)); } catch { /* */ } };
const lastPlace = () => { try { return JSON.parse(localStorage.getItem(prefKey())) || null; } catch { return null; } };
const extsOf = (types) => [...new Set(types.flatMap((t) => Object.values(t.accept).flat()))].map((e) => e.toLowerCase());
const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const when = (t) => new Date(t).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/**
 * 3DJames' own window for the server's folders. kind 'open' returns { file, handle }; kind 'save' returns a handle,
 * 'download' (save to this device instead) or null. types: the file types (like the browser's Open window).
 */
function browse({ kind, title, types, suggestedName = '' }) {
  return new Promise((resolve) => {
    if (!me?.folders.length) { toast('Your account has no folders yet. Ask the person who runs the 3DJames server to give you one.', 'err', 7000); resolve(null); return; }
    const exts = extsOf(types);
    const saving = kind === 'save';
    const start = lastPlace();
    let folder = me.folders.find((f) => f.id === start?.folder && (!saving || f.write)) || me.folders.find((f) => !saving || f.write) || me.folders[0];
    let path = folder.id === start?.folder ? start.path || '' : '';
    let entries = [], picked = null, finished = false;
    const finish = (v) => { if (finished) return; finished = true; close(); resolve(v); };

    const side = h('div', { class: 'fb-side' });
    const crumbs = h('div', { class: 'fb-crumbs' });
    const listEl = h('div', { class: 'fb-list', role: 'listbox', 'aria-label': 'Files' });
    const nameIn = h('input', { class: 'in', value: suggestedName, 'aria-label': 'File name', style: 'font-family:var(--ui);flex:1' });
    const typeSel = h('select', { class: 'in', 'aria-label': 'File type', style: 'width:auto' }, types.map((t, i) => h('option', { value: i }, t.description)));
    const status = h('div', { class: 'muted fb-status' });
    typeSel.onchange = () => { const ext = Object.values(types[+typeSel.value].accept).flat()[0]; nameIn.value = nameIn.value.replace(/\.[a-z0-9]+$/i, '') + ext; render(); };

    const go = async (f, p) => {
      folder = f; path = p; picked = null;
      status.textContent = 'Loading…';
      try { entries = await list(folder.id, path); status.textContent = ''; }
      catch (err) { entries = []; status.textContent = err.message; }
      render();
    };
    const ok = async () => {
      if (!saving) {
        if (!picked) return toast('Pick a file first.');
        const handle = new ServerFileHandle(folder.id, join(path, picked.name));
        status.textContent = 'Opening…';
        try { const file = await handle.getFile(); rememberPlace({ folder: folder.id, path }); presence(handle); finish({ file, handle }); }
        catch (err) { status.textContent = `Could not open it: ${err.message}`; }
        return;
      }
      let name = nameIn.value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      if (!name) return toast('Type a file name.');
      const ext = Object.values(types[+typeSel.value].accept).flat()[0];
      if (!exts.some((e) => name.toLowerCase().endsWith(e))) name += ext;
      if (!folder.write) return toast(`"${folder.label}" is read-only for you. Pick one of your own folders.`, 'err');
      const existing = entries.find((e) => !e.dir && e.name.toLowerCase() === name.toLowerCase());
      if (existing && !confirm(`${existing.name} already exists. Replace it?`)) return;
      rememberPlace({ folder: folder.id, path });
      // an existing file is replaced on purpose: no "someone else saved it" check for this first save
      finish(new ServerFileHandle(folder.id, join(path, existing ? existing.name : name), null, false, !!existing));
    };
    const render = () => {
      side.replaceChildren(...me.folders.map((f) => h('button', { class: 'fb-place' + (f === folder ? ' on' : ''), title: f.write ? '' : 'Read-only', onclick: () => go(f, '') }, ic(f.write ? 'FolderOpen' : 'Eye'), h('span', {}, f.label))));
      const segs = path ? path.split('/') : [];
      crumbs.replaceChildren(h('button', { class: 'chip', onclick: () => go(folder, '') }, folder.label),
        ...segs.flatMap((s, i) => [h('span', { class: 'muted' }, '›'), h('button', { class: 'chip', onclick: () => go(folder, segs.slice(0, i + 1).join('/')) }, s)]));
      const shown = entries.filter((e) => e.dir || exts.some((x) => e.name.toLowerCase().endsWith(x))).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
      listEl.replaceChildren(...(path ? [h('div', { class: 'fb-row', ondblclick: () => go(folder, segs.slice(0, -1).join('/')), onclick: () => go(folder, segs.slice(0, -1).join('/')) }, ic('ArrowLeft'), h('span', {}, 'Up one folder'), h('span'), h('span'))] : []),
        ...shown.map((e) => h('div', { class: 'fb-row' + (picked === e ? ' on' : ''), role: 'option', tabindex: 0,
          onclick: () => { if (e.dir) return go(folder, join(path, e.name)); picked = e; if (saving) nameIn.value = e.name; render(); },
          ondblclick: () => { if (!e.dir) { picked = e; if (saving) nameIn.value = e.name; ok(); } },
          onkeydown: (ev) => { if (ev.key === 'Enter') { if (e.dir) go(folder, join(path, e.name)); else { picked = e; ok(); } } } },
        ic(e.dir ? 'FolderOpen' : 'Box'), h('span', {}, e.name), h('span', { class: 'muted' }, e.dir ? '' : size(e.size)), h('span', { class: 'muted' }, e.mtime ? when(e.mtime) : ''))),
        ...(shown.length ? [] : [h('div', { class: 'muted', style: 'padding:14px' }, path || entries.length ? 'No matching files here.' : 'This folder is empty.')]));
    };
    const body = h('div', { class: 'fb' }, side, h('div', { class: 'fb-main' }, crumbs, listEl,
      saving ? h('div', { class: 'fb-name' }, nameIn, typeSel) : null, status));
    const newFolder = async () => {
      if (!folder.write) return toast(`"${folder.label}" is read-only for you.`, 'err');
      const n = prompt('Name of the new folder:'); if (!n?.trim()) return;
      try { await mkdir(folder.id, join(path, n.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_'))); await go(folder, join(path, n.trim())); }
      catch (err) { toast(`Could not make the folder: ${err.message}`, 'err'); }
    };
    const fromDevice = () => {
      const inp = h('input', { type: 'file', accept: exts.join(',') });
      inp.onchange = () => { const f = inp.files?.[0]; if (f) finish({ file: f, handle: null }); };
      inp.click();
    };
    const close = modal(title, body, (done) => [
      h('button', { class: 'btn', onclick: newFolder, title: 'Make a folder here' }, ic('Plus'), 'New folder'),
      saving ? h('button', { class: 'btn', onclick: () => finish('download'), title: 'Save a copy to this device instead (Downloads)' }, 'Download to this device')
        : h('button', { class: 'btn', onclick: fromDevice, title: 'A file on this computer, phone or tablet instead' }, 'From this device…'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'btn', onclick: () => { done(); finish(null); } }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: ok }, saving ? 'Save' : 'Open')], () => finish(null));
    body.closest('dialog').classList.add('fb-dialog');
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    if (saving) { const i = types.findIndex((t) => extsOf([t]).some((x) => suggestedName.toLowerCase().endsWith(x))); typeSel.value = String(Math.max(0, i)); }
    go(folder, path);
  });
}

/** Pick a file to open or insert: { file, handle } or null. */
export const pickOpen = (types, title = 'Open') => browse({ kind: 'open', title, types });
/** Pick where to save: a handle, 'download' or null. */
export const pickSave = ({ suggestedName, types, title = 'Save as' }) => browse({ kind: 'save', title, types, suggestedName });

/** Saving collided with someone else's save: overwrite, save a copy instead, or stop. */
export function askConflict(err, name) {
  return new Promise((resolve) => {
    const c = err.conflict || {};
    modal('Someone else saved this file', [
      h('p', {}, `${name} was saved by ${c.by || 'someone else'}${c.mtime ? ` at ${when(c.mtime)}` : ''}, after you opened it.`),
      h('p', { class: 'muted' }, 'Replace it and their changes are lost. Save a copy keeps both: yours under a new name.')],
    (done) => [h('button', { class: 'btn', onclick: () => { done(); resolve(null); } }, 'Cancel'),
      h('button', { class: 'btn', onclick: () => { done(); resolve('overwrite'); } }, 'Replace their version'),
      h('button', { class: 'btn primary', onclick: () => { done(); resolve('copy'); } }, 'Save a copy')], () => resolve(null));
  });
}

/** File menu: who is signed in, and Sign out. */
export function signOut() {
  if (app.dirty && !confirm('Your changes are not saved. Sign out anyway?')) return;
  app.dirty = false;
  location.href = '/logout';
}

// Portable, named project snapshots. Files are shared across snapshots, never nested.
import { store, normalizeDoc } from './store.js';
import { app } from './state.js';
import { versionStore, keepVersion, loadStoredFiles } from './storage.js';
import { h, modal, toast } from './ui/dom.js';
import { waitForBuild } from './build.js';

export function modelSnapshot(doc) {
  const out = JSON.parse(JSON.stringify(doc));
  delete out.versions; delete out.versionData; delete out.files;
  return out;
}
export function createVersion(label, note = '') {
  const list = store.doc.versions || [];
  if (list.length >= 200) throw new Error('This project has 200 saved versions. Delete an older version before adding another.');
  const id = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const snapshot = modelSnapshot(store.doc);
  let previous = null;
  if (!list.length && app.savedModel && JSON.stringify(snapshot) !== JSON.stringify(app.savedModel)) {
    const previousId = `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    keepVersion(previousId, modelSnapshot(app.savedModel));
    previous = { id: previousId, label: 'Previously saved', note: 'The saved model before version history was started.', t: app.savedAt || Date.now() };
  }
  keepVersion(id, snapshot);
  store.commit((doc) => {
    if (previous) (doc.versions ||= []).push(previous);
    (doc.versions ||= []).push({ id, label: String(label || `Version ${list.length + 1}`).trim().slice(0, 128), note: String(note).slice(0, 1000), t: Date.now() });
  }, 'ui');
  return id;
}
export function deleteVersion(id) {
  return store.commit((doc) => { doc.versions = (doc.versions || []).filter((v) => v.id !== id); }, 'ui');
}
export async function restoreVersion(id) {
  const snapshot = versionStore.get(id);
  if (!snapshot) throw new Error('This version is missing from the project.');
  const restored = normalizeDoc(modelSnapshot(snapshot)), source = store.doc;
  await loadStoredFiles(restored);
  if (store.doc !== source) throw new Error('The open project changed before the version could be restored.');
  store.commit((doc) => {
    const versions = doc.versions || [];
    for (const k of Object.keys(doc)) delete doc[k];
    Object.assign(doc, restored, { versions });
  });
  app.feature = null; app.sel = []; app.viewSet = false;
}
export function saveNewVersionDialog(save) {
  const label = h('input', { class: 'in', value: `Version ${(store.doc.versions || []).length + 1}`, required: true, maxlength: '128', 'aria-label': 'Version name' });
  const note = h('textarea', { class: 'in', rows: '3', maxlength: '1000', 'aria-label': 'Version notes', placeholder: 'What changed? (optional)', style: 'height:auto' });
  const form = h('form', { style: 'display:grid;gap:10px' }, h('label', {}, 'Version name', label), h('label', {}, 'Notes', note),
    h('p', { class: 'muted' }, 'Stores a snapshot of this model inside the project. Imported files are shared between versions. Then saves the project file.'));
  const close = modal('Save as new version', form, (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => form.requestSubmit() }, 'Save version')]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await waitForBuild(); if (app.savedModel) await loadStoredFiles(app.savedModel); createVersion(label.value, note.value); close(); await save(); }
    catch (err) { toast(err.message, 'err', 7000); }
  });
  label.focus(); label.select();
}
export function versionsDialog() {
  const list = h('div', { style: 'display:grid;gap:10px;max-height:55vh;overflow:auto' });
  const render = () => {
    list.replaceChildren();
    const versions = (store.doc.versions || []).slice().reverse();
    if (!versions.length) list.append(h('p', { class: 'muted' }, 'No saved versions yet. Use File → Save as new version.'));
    for (const v of versions) {
      const data = versionStore.get(v.id);
      list.append(h('div', { class: 'card' }, h('b', {}, v.label), h('small', { class: 'muted' }, new Date(v.t).toLocaleString()),
        v.note ? h('p', {}, v.note) : null,
        h('div', { class: 'muted' }, data ? `${data.features.length} steps · ${Object.keys(data.bodies).length} object records` : 'Snapshot missing'),
        h('div', { class: 'btns' }, h('button', { class: 'btn primary', disabled: !data, onclick: async () => {
          try { await restoreVersion(v.id); close(); toast(`Restored ${v.label}. Undo returns to your previous work. Save to keep this change.`, 'info', 6500); }
          catch (err) { toast(err.message, 'err'); }
        } }, 'Restore'), h('button', { class: 'btn danger', onclick: () => { deleteVersion(v.id); render(); toast('Version removed. Undo brings it back; save the project to keep the deletion.'); } }, 'Delete version'))));
    }
  };
  const close = modal('Select version', h('div', {}, h('p', { class: 'muted' }, 'Restoring changes the working model and keeps the version list. Undo returns to your previous work. Version deletions also support Undo.'), list),
    (done) => [h('button', { class: 'btn', onclick: done }, 'Close')]);
  render();
}

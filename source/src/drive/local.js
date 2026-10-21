// Files on this computer: the browser's own Open / Save windows (Edge and Chrome), or downloads where those
// windows don't exist. Handles are the browser's FileSystemFileHandle objects.
import { $, toast } from '../ui/dom.js';
import { lastFolder, rememberFolder, setProjectsFolder, projectsFolder } from '../storage.js';

export const mode = 'local';

// The windows start in the folder used last time (or the Projects folder). The browser only allows that
// through a file or folder it was handed before, so those are remembered.
async function startIn() { return (await lastFolder()) || 'documents'; }

const acceptList = (types) => [...new Set(types.flatMap((t) => Object.values(t.accept).flat()))].join(',');
function pickWithInput(types) {
  // only where the Windows Open window is not available
  return new Promise((resolve) => {
    const inp = $('fileInput');
    inp.accept = acceptList(types); inp.multiple = false; inp.value = '';
    inp.onchange = () => { const f = inp.files?.[0]; resolve(f ? { file: f, handle: null } : null); };
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}

/** Pick a file to open or insert: { file, handle } or null (closed). */
export async function pickOpen(types) {
  if (!window.showOpenFilePicker) return pickWithInput(types);
  const opts = { types, startIn: await startIn() };
  let handles;
  try { handles = await window.showOpenFilePicker(opts); } catch (err) {
    if (err?.name === 'AbortError') return null;
    // the remembered folder may be gone; try again from Documents
    try { handles = await window.showOpenFilePicker({ ...opts, startIn: 'documents' }); } catch (err2) { if (err2?.name === 'AbortError') return null; return pickWithInput(types); }
  }
  rememberFolder(handles[0]);
  return { file: await handles[0].getFile(), handle: handles[0] };
}

/** Pick where to save: a handle, null (closed) or 'download' (no Save window in this browser). */
export async function pickSave({ suggestedName, types }) {
  if (!window.showSaveFilePicker) return 'download';
  const opts = { suggestedName, types, excludeAcceptAllOption: true, startIn: await startIn() };
  let handle;
  try { handle = await window.showSaveFilePicker(opts); } catch (err) {
    if (err?.name === 'AbortError') return null;
    try { handle = await window.showSaveFilePicker({ ...opts, startIn: 'documents' }); } catch (err2) { if (err2?.name === 'AbortError') return null; return 'download'; }
  }
  rememberFolder(handle);
  return handle;
}

/** Write a file. */
export async function write(handle, data) {
  if (handle.queryPermission && (await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('Windows did not allow writing to that file');
  }
  const w = await handle.createWritable();
  try { await w.write(data); await w.close(); }
  catch (err) { try { await w.abort?.(); } catch { /* Preserve the write error. */ } throw err; }
}

/** File > Projects folder: where Open and Save start. */
export async function chooseProjectsFolder() {
  if (!window.showDirectoryPicker) return toast('Choosing a folder is not available here.', 'err');
  try {
    const dir = await window.showDirectoryPicker({ id: 'projects', startIn: (await projectsFolder()) || 'documents' });
    await setProjectsFolder(dir);
    toast(`Open and Save will start in "${dir.name}" until you use another folder.`, 'info', 5000);
  } catch (err) { if (err?.name !== 'AbortError') toast(`Could not use that folder: ${err.message}`, 'err'); }
}

export const revive = (handle) => handle;

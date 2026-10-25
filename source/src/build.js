// Talks to the geometry engine, which runs in the background (a web worker) so the window never freezes.
import { Matrix4 } from 'three';
import { store } from './store.js';
import { app } from './state.js';
import { $, toast } from './ui/dom.js';
import { fileStore, referencedFiles } from './storage.js';
import { vp } from './view.js';
import { renderAll, renderStatus } from './ui/panels.js';
import { bodyMatrixFeature, turnedUp, foldableBodies, foldMoves } from './commands.js';

let worker = null;
let workerReady = false;
let workerUrl = null;
let buildTimer = null;
let buildTick = null; // updates the "Building… 12 s" status while a build runs
let starting = null;
let msgId = 0;
const waiters = new Map();
const sentFiles = new Set(); // imported files the engine already has
// How long the engine may work on one job (start-up, a build, an export, reading an import) before it counts as stuck.
// Big STEP imports and detailed models can take several minutes on a slow PC.
export const ENGINE_TIMEOUT_MS = 10 * 60 * 1000;
const minutes = () => Math.round(ENGINE_TIMEOUT_MS / 60000);

function b64bytes(b64) { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

/** Start the engine. Its code and data are built into the page (window.__3DJ_EMBED). */
export function startWorker() {
  if (starting) return starting;
  if (worker) worker.terminate();
  worker = null; workerReady = false; sentFiles.clear();
  app.building = false; app.pending = false; app.builtRevision = -1; app.engineError = null;
  const E = window.__3DJ_EMBED;
  const url = URL.createObjectURL(new Blob([new TextDecoder().decode(b64bytes(E.worker))], { type: 'text/javascript' }));
  workerUrl = url;
  const startup = new Promise((resolve, reject) => {
    const w = new Worker(url);
    worker = w;
    const fail = (err) => { clearTimeout(timer); failWorker(err); reject(err); };
    const timer = setTimeout(() => fail(new Error('The geometry engine took too long to start')), ENGINE_TIMEOUT_MS);
    w.onmessage = (e) => {
      if (e.data.type === 'ready') {
        clearTimeout(timer);
        URL.revokeObjectURL(url); workerUrl = null;
        worker = w; workerReady = true;
        w.onmessage = onMessage;
        $('loading').hidden = true;
        requestBuild();
        resolve();
      } else if (e.data.type === 'error') fail(new Error(e.data.message));
    };
    w.onerror = (e) => fail(new Error(e.message || 'The geometry engine stopped. Restart it to continue.'));
    w.onmessageerror = () => fail(new Error('Could not read the geometry engine response.'));
    const assets = { occ: b64bytes(E.occ), manifold: b64bytes(E.manifold), sans: b64bytes(E.sans).buffer, round: b64bytes(E.round).buffer };
    w.postMessage({ type: 'init', assets });
  });
  starting = startup;
  const finished = () => { if (starting === startup) starting = null; };
  startup.then(finished, finished);
  return startup;
}
export const engineReady = () => workerReady;

function failWorker(err) {
  clearTimeout(buildTimer); clearInterval(buildTick);
  workerReady = false;
  worker?.terminate(); worker = null;
  if (workerUrl) { URL.revokeObjectURL(workerUrl); workerUrl = null; }
  sentFiles.clear();
  app.building = false; app.pending = false; app.builtRevision = -1;
  app.engineError = err.message;
  for (const w of waiters.values()) { clearTimeout(w.timer); w.reject(err); }
  waiters.clear();
  renderStatus();
}

/** Resolve only when the display and engine describe the current document. */
export async function waitForBuild() {
  if (app.preview) throw new Error('Apply or cancel the operation preview before saving or exporting.');
  const deadline = Date.now() + ENGINE_TIMEOUT_MS;
  while (app.building || app.pending || app.builtRevision !== store.revision) {
    if (app.engineError || !workerReady) throw new Error(app.engineError || 'The geometry engine is not ready.');
    if (Date.now() > deadline) throw new Error(`The model took longer than ${minutes()} minutes to build.`);
    if (!app.building) requestBuild();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function onMessage(e) {
  const m = e.data;
  if (m.type === 'built') {
    clearTimeout(buildTimer); clearInterval(buildTick);
    app.building = false;
    if (m.revision === store.revision && (m.previewId || null) === (app.preview?.id || null)) { app.builtRevision = m.revision; applyResults(m); }
    else app.pending = true;
    if (app.pending) { app.pending = false; requestBuild(); }
    renderStatus();
    return;
  }
  const w = waiters.get(m.id);
  if (w) { clearTimeout(w.timer); waiters.delete(m.id); m.type === 'error' ? w.reject(new Error(m.message)) : w.resolve(m); }
  else if (m.type === 'error') { failWorker(new Error(m.message)); toast(m.message, 'err'); }
}

/** Ask the engine something and wait for the answer (exports, reading imported files). */
export function workerCall(msg, transfer) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    if (!workerReady || !worker) { reject(new Error(app.engineError || 'The geometry engine is not ready.')); return; }
    const timer = setTimeout(() => failWorker(new Error(`The geometry engine took longer than ${minutes()} minutes to respond. Restart it to continue.`)), ENGINE_TIMEOUT_MS);
    waiters.set(id, { resolve, reject, timer });
    try { worker.postMessage({ ...msg, id }, transfer || []); }
    catch (err) { clearTimeout(timer); waiters.delete(id); reject(err); }
  });
}
/** The engine got this imported file along with a checkImport call. */
export const markSent = (fileId) => sentFiles.add(fileId);

/** Rebuild the model. Changes made while a build runs are picked up by one more build right after. */
export function requestBuild() {
  if (!workerReady) return;
  if (app.building) { app.pending = true; return; }
  app.building = true;
  renderStatus();
  const doc = app.preview?.doc || store.doc;
  for (const id of referencedFiles(doc, { modelsOnly: true })) {
    if (sentFiles.has(id) || !fileStore.has(id)) continue;
    worker.postMessage({ type: 'addFile', fileId: id, data: fileStore.get(id).slice().buffer });
    sentFiles.add(id);
  }
  app.buildStarted = Date.now();
  clearInterval(buildTick); buildTick = setInterval(renderStatus, 1000);
  buildTimer = setTimeout(() => failWorker(new Error(`The model took longer than ${minutes()} minutes to build. Restart the engine to continue.`)), ENGINE_TIMEOUT_MS);
  worker.postMessage({ type: 'build', id: ++msgId, revision: store.revision, previewId: app.preview?.id || null, doc, ghostOf: app.feature });
}

const shownErrors = {};
function applyResults(m) {
  const map = new Map(m.bodies.map((b) => [b.id, b]));
  app.results = { bodies: map, errors: m.errors, heights: m.heights || {}, ghosts: m.ghosts || [], ms: m.ms };
  vp.setBodies(m.bodies, (app.preview?.doc || store.doc).bodies);
  vp.setGhosts(app.results.ghosts);
  if (app.preview) { vp.clearHandles(); app.preview.onBuilt?.(m); renderAll(); return; }
  app.sel = app.sel.filter((id) => map.has(id));
  vp.setSelection(app.sel);
  // tell about each new problem once
  for (const [fid, msg] of Object.entries(m.errors)) if (shownErrors[fid] !== msg) { shownErrors[fid] = msg; toast(msg, 'err', 6500); }
  for (const k of Object.keys(shownErrors)) if (!m.errors[k]) delete shownErrors[k];
  if (!app.viewSet) { app.viewSet = true; vp.view('home', false); }
  if (app.toPlane?.length) {
    // shapes added on a workplane: put their bottom on the face (needs the height, known only now)
    const list = app.toPlane; app.toPlane = null;
    store.amend((doc) => {
      for (const { fid, P, n, sink } of list) {
        const f = doc.features.find((x) => x.id === fid), h = app.results.heights[fid];
        if (!f || h == null) continue;
        const len = Math.hypot(...n) || 1;
        const k = sink != null ? -h / 2 + sink : h / 2; // sink: sunk into the face (a cut), sticking out by this much
        f.pos = [0, 1, 2].map((i) => Math.round((P[i] + (n[i] / len) * k - (i === 2 ? h / 2 : 0)) * 1e4) / 1e4);
      }
    });
  }
  if (app.keepBase?.length) {
    // a turned shape whose numbers changed (Properties): its height grew from its middle; move it so its base stays
    // where it was, as on the floor (a sketch standing on a face grows out of the face, not into it)
    const list = app.keepBase; app.keepBase = null;
    const moves = [];
    for (const { fid, h } of list) {
      const f = store.doc.features.find((x) => x.id === fid), h2 = app.results.heights[fid];
      if (!f || h2 == null || Math.abs(h2 - h) < 1e-9 || !Array.isArray(f.pos) || !Array.isArray(f.rot)) continue;
      if (![...f.pos, ...f.rot].every((v) => typeof v === 'number')) continue; // typed as formulas: left as typed
      const up = turnedUp(f.rot);
      if (Math.abs(up[2] - 1) < 1e-9) continue; // standing upright: its base already stays on the floor
      moves.push({ fid, d: [0, 1, 2].map((i) => ((up[i] - (i === 2 ? 1 : 0)) * (h2 - h)) / 2) });
    }
    if (moves.length) store.amend((doc) => { for (const { fid, d } of moves) { const f = doc.features.find((x) => x.id === fid); f.pos = f.pos.map((v, i) => Math.round((v + d[i]) * 1e4) / 1e4); } });
  }
  // a shape with leftover Move steps (moved, turned or evenly sized by an older version): taken into the shape, so its
  // own numbers (Height...) are its real size again. It looks exactly the same.
  if (!app.preview && !app.scrubbing) {
    const ids = foldableBodies(store.doc).filter((id) => { const f = store.doc.features.find((x) => x.body === id && x.type === 'shape'); return app.results.heights?.[f.id] != null && !app.results.errors?.[f.id]; });
    if (ids.length) {
      const test = JSON.parse(JSON.stringify(store.doc)), ok = ids.filter((id) => foldMoves(test, id));
      if (ok.length) store.amend((doc) => { for (const id of ok) foldMoves(doc, id); });
    }
  }
  if (app.settle?.length) {
    // objects that sat on the floor before turning are put back down on it, like 3D Builder
    const ids = app.settle; app.settle = null;
    const fix = ids.filter((id) => { const d = map.get(id); return d && Math.abs(d.bbox[0][2]) > 1e-4; });
    if (fix.length) store.amend((doc) => { for (const id of fix) bodyMatrixFeature(doc, id, new Matrix4().makeTranslation(0, 0, -map.get(id).bbox[0][2])); });
  }
  // something waiting for the new object to be built where it belongs (e.g. a sketch that cuts what it touches)
  if (app.afterBuild && !app.pending && !app.building) { const a = app.afterBuild; app.afterBuild = null; setTimeout(a.fn, 0); } // only once the model is up to date
  renderAll();
}

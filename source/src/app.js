// 3DJames: a local, 3D Builder-style parametric modeler. This file starts everything up and handles the keyboard.
import { store, emptyDoc } from './store.js';
import { app } from './state.js';
import { $, h, menuOpen, closeMenu, loadCustomIcons, iconNames, iconFile } from './ui/dom.js';
import { vp } from './view.js';
import { startWorker, workerCall, requestBuild } from './build.js';
import { createVersion, restoreVersion, deleteVersion, versionsDialog } from './versions.js';
import { parseLogo } from './logo.js';
import { moveFeature, canMoveFeature, historyDependencies, dependentSteps } from './history.js';
import { measureResult, measurePick, setMeasureMode } from './measure.js';
import { scheduleBackup, restoreSession, idb } from './storage.js';
import { saveToMyParts, insertMyPart, loadMyParts, usePartsFolder } from './myparts.js';
import {
  centerOn, alignSel, addShape, combine, mirrorSel, turnCopySel, addPattern, duplicateSel, deleteSel, dropSel, rotateSel, translateSel, groupSel, ungroupSel, setBodyProp,
  selectAll, selectNone, editStep, copySel, paste,
} from './commands.js';
import { startTool, endTool, applyTool, quickEdges, toolPick, ONE_CLICK } from './tools.js';
import { openDialog, openFile, insertFile, saveDoc, saveAs, buildFileData, loadProject, newProject, updateTitle, fmtOf } from './files.js';
import { readZip, parse3mf } from './formats.js';
import { renderAll, openPanel } from './ui/panels.js';
import { buildTabBar, renderCmdBar, addThread, doUndo, doRedo } from './ui/ribbon.js';
import { showAbout } from './ui/about.js';
import { presetFor } from './catalog.js';
import { openSketch } from './ui/sketch.js';
import { planeDialog, adjustedPlane } from './sketchplane.js';
import { createSketch, startSketch, editSketch, editSketches, startFaceSketch, startPhotoSketch, startImportSketch } from './sketchcmd.js';
import { setWorkplane } from './tools.js';
import { barCommit, setGizmo } from './ui/bars.js';
import { applyTheme } from './theme.js';
import { detectDrive } from './drive/index.js';
import { applyTouchMode, toggleMod, mods, onTouchModeChange } from './touch.js';
import * as server from './drive/server.js';
import { makeEditable } from './editable.js';
import { startBridge } from './bridge.js';

// ---------------------------------------------------------------- keyboard
// Remember what a text box held when you clicked into it, so Ctrl+Z can tell typing from undoing.
document.addEventListener('focusin', (e) => { const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) t.dataset.start = t.value; });
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA') && !['checkbox', 'radio', 'color', 'file'].includes(ae.type);
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && (k === 'z' || k === 'y')) {
    // undo the model, unless you are in the middle of typing in a box (then the box undoes your typing)
    if (typing && ae.value !== (ae.dataset.start ?? ae.value)) return;
    e.preventDefault();
    if (ae && ae !== document.body) ae.blur();
    if (k === 'y' || e.shiftKey) doRedo(); else doUndo();
    return;
  }
  if (mod && k === 's') { e.preventDefault(); e.shiftKey ? saveAs() : saveDoc(); return; }
  if (mod && k === 'o') { e.preventDefault(); openDialog(); return; }
  if (typing) return;
  if (mod && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
  if (mod && k === 'c') { copySel(); return; }
  if (mod && k === 'v') { paste(); return; }
  if (e.key === 'Escape') { if (menuOpen()) closeMenu(); else if (app.tool) endTool(); else selectNone(); return; }
  if (e.key === 'Enter' && app.tool && !ONE_CLICK.has(app.tool.type)) { applyTool(); return; }
  if (mod || e.altKey) return;
  const step = (app.settings.grid || 1) * (e.shiftKey ? 10 : 1);
  const keys = {
    Delete: deleteSel, Backspace: deleteSel,
    ArrowLeft: () => translateSel(-step, 0, 0), ArrowRight: () => translateSel(step, 0, 0),
    ArrowUp: () => translateSel(0, step, 0), ArrowDown: () => translateSel(0, -step, 0),
    PageUp: () => translateSel(0, 0, step), PageDown: () => translateSel(0, 0, -step),
    m: () => setGizmo('translate'), r: () => setGizmo('rotate'), s: () => setGizmo('scale'),
    d: dropSel, f: () => vp.view(app.sel.length ? 'selection' : 'fit'), home: () => vp.view('home'),
  };
  const fn = keys[e.key] || keys[k];
  if (fn) { e.preventDefault(); fn(); }
});

// dropping a file on the window opens it (or adds it to what is already there)
['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => {
  if (!e.dataTransfer?.types?.includes('Files')) return;
  e.preventDefault();
  if (ev !== 'drop') return;
  const f = e.dataTransfer.files?.[0];
  if (f) { if (['3dj', 'json'].includes(fmtOf(f.name)) || !app.results.bodies.size) openFile(f, null); else insertFile(f); }
}));
window.addEventListener('beforeunload', (e) => { if (app.dirty) { e.preventDefault(); e.returnValue = ''; } });

// ---------------------------------------------------------------- example shown on the very first start
function exampleDoc() {
  const d = emptyDoc();
  d.name = 'Example bracket';
  d.vars = [{ name: 'wall', expr: '4' }];
  d.bodies = {
    b1: { name: 'Base', color: '#7092BE' }, b2: { name: 'Upright', color: '#7092BE' }, b3: { name: 'Threaded hole 1', color: '#8b96a3', hole: true },
    b4: { name: 'Bolt 1', color: '#7F7F7F' },
  };
  d.features = [
    { id: 'f1', type: 'shape', body: 'b1', kind: 'box', p: { w: 50, d: 30, h: 'wall', round: 3, roundMode: 'vertical' }, pos: [-20, 0, 0], rot: [0, 0, 0] },
    { id: 'f2', type: 'shape', body: 'b2', kind: 'box', p: { w: 'wall', d: 30, h: 30, round: 0, roundMode: 'all' }, pos: [3, 0, 0], rot: [0, 0, 0] },
    { id: 'f3', type: 'combine', op: 'union', body: 'b1', tools: ['b2'] },
    { id: 'f4', type: 'fillet', body: 'b1', edges: [{ nc: [0.92, 0.5, 0.1333], d: [0, 1, 0] }], r: 4 },
    { id: 'f5', type: 'shape', body: 'b3', kind: 'thread', p: { size: 'M8', D: 8, P: 1.25, len: 4, kind: 'cutter', clear: 0.15, head: 'hex', headH: 5.6, af: 13, nutH: 6.4, chamfer: true }, pos: [-32, 0, 0], rot: [0, 0, 0] },
    { id: 'f6', type: 'combine', op: 'subtract', body: 'b1', tools: ['b3'] },
    { id: 'f7', type: 'shape', body: 'b4', kind: 'thread', p: { size: 'M8', D: 8, P: 1.25, len: 16, kind: 'bolt', clear: 0.15, head: 'hex', headH: 5.6, af: 13, nutH: 6.4, chamfer: true }, pos: [35, 0, 0], rot: [0, 0, 0] },
  ];
  d.seq = 20; d.counters = { Bolt: 1, 'Threaded hole': 1 };
  return d;
}

// ---------------------------------------------------------------- start
buildTabBar();
renderCmdBar();
// touch mode: a "Pick more" switch over the 3D view stands in for Ctrl+click
const pickMore = h('button', { class: 'touch-only touch-key float', title: 'Pick more than one object (like holding Ctrl)', onclick: () => pickMore.classList.toggle('on', toggleMod('multi')) }, 'Pick more');
$('view').append(pickMore);
onTouchModeChange(() => { pickMore.classList.toggle('on', mods.multi); renderCmdBar(); });
applyTouchMode();
store.save = scheduleBackup; // every change is backed up in the background a moment later
store.onChange((kind) => {
  if (kind === 'geom' && app.tool?.type === 'measure') { app.tool.items = []; vp.setMeasurements([]); }
  if (kind === 'geom') requestBuild();
  if (!app.loading) app.dirty = true;
  updateTitle();
  vp.props = store.doc.bodies; vp.updateStyles();
  renderAll();
});
(async () => {
  // opened from a 3DJames server? Then files come from the server's folders, and each person keeps their own backups
  if ((await detectDrive()).mode === 'server') { idb.name = `3djames-${server.me.user}`; buildTabBar(); renderCmdBar(); }
  loadMyParts();
  startBridge(); // an AI helper on this computer may ask to work in this window (src/bridge.js)
  loadCustomIcons(() => { buildTabBar(); renderCmdBar(); renderAll(); });
  const last = await restoreSession();
  store.doc = last?.doc || exampleDoc();
  app.file = last?.file || null;
  app.savedModel = last?.savedModel || null; app.savedAt = last?.savedAt || null;
  app.dirty = false;
  updateTitle();
  vp.grid = app.settings.grid; vp.rotSnap = app.settings.rot; vp.showEdges = app.settings.edges; vp.lockScale = app.settings.lock; vp.display = app.settings.display || 'solid'; vp.ruler = !!app.settings.ruler;
  applyTheme();
  vp.view('home', false);
  if (app.settings.flat) vp.setFlat(true);
  renderAll();
  startWorker().catch((err) => {
    $('loading').replaceChildren(h('div', { class: 'card float' }, h('div', {}, h('b', {}, 'The geometry engine could not start.'), h('div', { class: 'muted' }, err.message || String(err)), h('button', { class: 'btn', onclick: () => startWorker().catch(() => {}) }, 'Restart engine'))));
  });
})();

// for the automated tests
window.__3dj = {
  app, store, vp,
  commands: {
    createVersion, restoreVersion, deleteVersion, versionsDialog, parseLogo, moveFeature, canMoveFeature, historyDependencies, dependentSteps, measureResult, measurePick, setMeasureMode,
    startWorker, barCommit, setGizmo, openPanel, endTool, showAbout, presetFor, openSketch, renderCmdBar, workerCall, applyTheme, addShape, combine, startTool, applyTool, quickEdges, addThread, mirrorSel, turnCopySel,
    iconNames, iconFile, centerOn, alignSel, addPattern, duplicateSel, deleteSel, dropSel, rotateSel, saveDoc, saveAs, openFile, insertFile, groupSel, ungroupSel, readZip, parse3mf,
    buildFileData, makeEditable, translateSel, setBodyProp, toolPick, createSketch, startSketch, editSketch, editSketches, startFaceSketch, startPhotoSketch, startImportSketch, planeDialog, adjustedPlane, setWorkplane, newProject, loadProject, editStep, renderAll, saveToMyParts, insertMyPart, loadMyParts, usePartsFolder, idb,
  },
};

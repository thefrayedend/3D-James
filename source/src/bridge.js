// The AI link: an AI helper (Gemini, Claude...) can work in this window through "3DJames Link", a small program on
// their computer that the AI starts (source in windows-desktop/link/). The link only listens on their computer
// (127.0.0.1). This page asks it for jobs, does them and sends back the answer; the first job asks the user "Allow?".
//
//   GET  http://127.0.0.1:47831/page/next?w=<window>&focus=<time>   waits up to 20 s: { job: { id, tool, args, client } }
//   POST http://127.0.0.1:47831/page/result                           { id, ok, result | error }
//
// Jobs are a short fixed list (TOOLS below): no running of code. Each change is one Undo step and says who made it.
// The steps are the same JSON as in a .3dj project (skill/3djames-project/SKILL.md).
import { store, normalizeDoc, describeFeature } from './store.js';
import { app, bodyName } from './state.js';
import { h, ic, toast, modal } from './ui/dom.js';
import { vp } from './view.js';
import { waitForBuild } from './build.js';
import { drive } from './drive/index.js';
import { openFile, insertFile, newProject, buildFileData, markSaved, updateTitle } from './files.js';
import { canMakeEditable, makeEditable } from './editable.js';
import * as editable from './editable.js';
import { dependentSteps } from './history.js';
import { r3 } from './shared.js';
import { endTool } from './tools.js';
import { toB64, bytesFromB64 } from './storage.js';

let BASE = 'http://127.0.0.1:47831';
const windowId = Math.random().toString(36).slice(2, 10);
let focusAt = document.hasFocus() ? Date.now() : 0;
// Which AIs may work here: the user is asked the first time; Allow this time lets that AI work in this window, Always
// trust lets it work in every window from then on (kept on this computer). Stop in a window makes it ask there again.
let declinedUntil = 0, connected = false, who = null, pill = null, pendingSave = null;
const TRUSTED = '3djames.link.trusted', HERE = '3djames.link.here', STOPPED = '3djames.link.stopped';
const names = (store, key) => { try { return new Set(JSON.parse(store.getItem(key) || '[]')); } catch { return new Set(); } };
const keepNames = (store, key, set) => { try { store.setItem(key, JSON.stringify([...set])); } catch { /* storage unavailable */ } };
const trusted = () => names(localStorage, TRUSTED);
const allowed = (ai) => !!ai && !names(sessionStorage, STOPPED).has(ai) && (trusted().has(ai) || names(sessionStorage, HERE).has(ai));
const named = (ai) => ai && ai !== 'An AI helper'; // (only a named AI can be trusted for good)

/** Start listening for the link (only for files on their computer; the 3DJames box will get its own way). */
export function startBridge() {
  if (drive.mode !== 'local') return;
  let test = false;
  try { test = localStorage.getItem('3djames.link') === 'test'; } catch { /* storage unavailable */ }
  if (navigator.webdriver && !test) return; // automated tests: no link unless a test asks for it
  if (test) try { BASE = `http://127.0.0.1:${+localStorage.getItem('3djames.linkport') || 47831}`; } catch { /* storage unavailable */ } // (tests keep off the user's own link)
  window.addEventListener('focus', () => { focusAt = Date.now(); });
  loop();
}

async function loop() {
  for (;;) {
    let job = null;
    try {
      const r = await fetch(`${BASE}/page/next?w=${windowId}&focus=${focusAt}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      job = (await r.json()).job || null;
      connected = true;
    } catch {
      connected = false; showPill();
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }
    showPill();
    if (!job) continue;
    // long jobs (Make editable can take minutes): tell the link this window is still there
    const alive = setInterval(() => fetch(`${BASE}/page/alive?w=${windowId}`, { cache: 'no-store' }).catch(() => {}), 10000);
    const reply = await handle(job).finally(() => clearInterval(alive));
    try { await fetch(`${BASE}/page/result`, { method: 'POST', body: JSON.stringify(reply) }); } catch { /* the link went away */ }
  }
}

async function handle(job) {
  who = job.client || 'An AI helper';
  if (!allowed(who)) {
    if (Date.now() < declinedUntil) return { id: job.id, ok: false, error: 'The user said no to letting an AI work in 3DJames just now. Ask them before trying again.' };
    const yes = await ask();
    if (!yes) { declinedUntil = Date.now() + 60000; return { id: job.id, ok: false, error: 'The user said no (or did not answer) when 3DJames asked whether to let you work in it.' }; }
    const stopped = names(sessionStorage, STOPPED); stopped.delete(who); keepNames(sessionStorage, STOPPED, stopped);
    const here = names(sessionStorage, HERE); here.add(who); keepNames(sessionStorage, HERE, here);
    if (yes === 'always') { const t = trusted(); t.add(who); keepNames(localStorage, TRUSTED, t); }
  }
  showPill(); // (the note names the AI)
  try {
    const tool = TOOLS[job.tool];
    if (!tool) throw new Error(`3DJames does not know the job "${job.tool}". It may need updating.`);
    return { id: job.id, ok: true, result: await tool(job.args || {}) };
  } catch (err) {
    return { id: job.id, ok: false, error: err?.message || String(err) };
  }
}

function ask() {
  return new Promise((resolve) => {
    let done = false;
    // the window is often behind the AI's: show the question in the taskbar too, and try to come to the front
    const title = document.title;
    const flash = setInterval(() => { document.title = document.title === title ? `(!) Allow ${who}? - 3DJames` : title; }, 1000);
    try { window.focus(); } catch { /* not allowed */ }
    const answer = (yes) => { // (false; true: this window; 'always': trusted from now on)
      if (done) return; done = true; clearInterval(flash); document.title = title; close();
      resolve(yes);
    };
    const body = h('div', { style: 'display:grid;gap:8px;max-width:440px' },
      h('p', {}, `${who} (on their computer) wants to work in this 3DJames window: open and save projects in your Projects folder, add and change steps, and look at the model.`),
      h('p', { class: 'muted' }, `You see every change as it happens, and Ctrl+Z undoes it. Stop at the top of the window stops it any time.${named(who) ? ` Always trust ${who}: it won't ask about ${who} again, in any window.` : ''}`));
    const close = modal(`Let ${who} work in 3DJames?`, body, () => [
      h('button', { class: 'btn', onclick: () => answer(false) }, "Don't allow"),
      h('button', { class: named(who) ? 'btn' : 'btn primary', onclick: () => answer(true) }, named(who) ? 'Allow this time' : 'Allow'),
      named(who) && h('button', { class: 'btn primary', onclick: () => answer('always') }, `Always trust ${who}`)].filter(Boolean), () => answer(false));
    setTimeout(() => answer(false), 180000);
  });
}

/** The note at the top of the window while an AI may work here, with Stop. */
function showPill() {
  const on = connected && allowed(who);
  if (!on) { pill?.remove(); pill = null; return; }
  if (!pill) {
    pill = h('div', { class: 'card float', role: 'status', style: 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:8px;padding:4px 6px 4px 10px' },
      ic('Bot'), h('span', { class: 'who' }),
      h('button', { class: 'btn', title: 'Stop letting the AI work here', onclick: stop }, 'Stop'));
    document.getElementById('view').append(pill);
  }
  pill.querySelector('.who').textContent = `${who} can work here${trusted().has(who) ? ' (trusted)' : ''}`;
}
/** Stop: in this window (it asks here next time), and for a trusted AI also, if the user says so, stop trusting it. */
function stop() {
  const ai = who, inWindow = () => {
    const s = names(sessionStorage, STOPPED); s.add(ai); keepNames(sessionStorage, STOPPED, s);
    const here = names(sessionStorage, HERE); here.delete(ai); keepNames(sessionStorage, HERE, here);
    showPill();
  };
  if (!trusted().has(ai)) {
    inWindow();
    toast(`${ai} can no longer work in this window. It will ask again if it tries.`);
    return;
  }
  modal(`Stop ${ai}?`, h('p', { style: 'max-width:420px' }, `${ai} is trusted: it works in 3DJames without asking. Stop it just in this window, or stop trusting it (then it asks again, in every window).`), (close) => [
    h('button', { class: 'btn', onclick: () => close() }, 'Cancel'),
    h('button', { class: 'btn', onclick: () => { close(); inWindow(); toast(`${ai} can no longer work in this window. It will ask again if it tries here.`); } }, 'Just this window'),
    h('button', { class: 'btn primary', onclick: () => { close(); const t = trusted(); t.delete(ai); keepNames(localStorage, TRUSTED, t); inWindow(); toast(`${ai} is no longer trusted. It will ask again if it tries.`); } }, `Stop trusting ${ai}`)]);
}

// ---------------------------------------------------------------- helpers
const copy = (x) => JSON.parse(JSON.stringify(x));

/** Changes need the window to be free: no sketch board or tool open in the middle of the user's own work. */
function needFree() {
  if (document.querySelector('.sk-svg')) throw new Error('The user has the sketch board open in 3DJames. Ask them to finish it (Done or Cancel) first.');
  if (app.converting) throw new Error('3DJames is busy making a model editable. Try again when it is done.');
  if (app.tool && app.tool.type !== 'measure') endTool();
}

function projectJson() {
  const d = copy(store.doc);
  delete d.files; delete d.versionData;
  return d;
}

/** Build and describe the result: problems per step, and each object's size and volume. */
async function report() {
  await waitForBuild();
  const doc = store.doc;
  const errors = Object.entries(app.results.errors || {}).map(([id, message]) => {
    const f = doc.features.find((x) => x.id === id);
    return { step: id, name: f?.name || (f ? describeFeature(doc, f).title : id), message };
  });
  const objects = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  for (const [id, d] of app.results.bodies) {
    const b = doc.bodies[id] || {};
    if (b.hidden || !d?.bbox) continue;
    const o = { id, name: bodyName(id), size_mm: d.bbox[1].map((v, i) => r3(v - d.bbox[0][i])), from_mm: d.bbox[0].map(r3), to_mm: d.bbox[1].map(r3), volume_cm3: r3((d.volume || 0) / 1000), solid: !!d.solid };
    if (b.hole) o.hole = true;
    else { volume += d.volume || 0; for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], d.bbox[0][k]); hi[k] = Math.max(hi[k], d.bbox[1][k]); } }
    objects.push(o);
  }
  const overall = objects.some((o) => !o.hole) ? { size_mm: hi.map((v, k) => r3(v - lo[k])), from_mm: lo.map(r3), to_mm: hi.map(r3), volume_cm3: r3(volume / 1000) } : null;
  return { built: !errors.length, problems: errors, objects, overall, steps: doc.features.length };
}

/**
 * Change the project as one Undo step. The change is made on a copy first, so a mistake changes nothing.
 * mutate(doc, newId) may throw; newId('f') / newId('b') hand out free ids.
 */
async function change(what, mutate) {
  needFree();
  const next = copy(store.doc);
  const newId = (prefix) => { const id = prefix + next.seq; next.seq += 1; return id; };
  const extra = mutate(next, newId);
  const clean = normalizeDoc(next);
  const changed = store.commit((d) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, clean); });
  if (changed) toast(`${who}: ${what}`, 'info', 3500);
  return { changed, ...(extra || {}), ...(await report()) };
}

function setVars(d, vars, remove) {
  for (const v of vars || []) {
    if (!v || typeof v.name !== 'string' || !/^[A-Za-z_]\w*$/.test(v.name)) throw new Error(`A variable needs a name made of letters, digits and _ (got ${JSON.stringify(v?.name)}).`);
    const expr = String(v.expr ?? v.value ?? '');
    const old = d.vars.find((x) => x.name === v.name);
    if (old) old.expr = expr; else d.vars.push({ name: v.name, expr });
  }
  if (remove?.length) d.vars = d.vars.filter((x) => !remove.includes(x.name));
}

function setObjects(d, objects) {
  for (const [id, o] of Object.entries(objects || {})) {
    if (!/^[a-z]+\d+$/i.test(id)) throw new Error(`Object ids look like b1, b2... (got "${id}").`);
    d.bodies[id] = { ...(d.bodies[id] || { name: 'Object', color: '#C3C3C3' }), ...o };
    for (const [k, v] of Object.entries(o || {})) if (v === null) delete d.bodies[id][k];
  }
}

function notOpenEdits() {
  if (app.dirty) throw new Error(`"${store.doc.name}" has changes the user has not saved. Save it first (save_project), or ask the user whether to throw them away and then pass discard_changes: true.`);
}

// ---------------------------------------------------------------- the jobs
const TOOLS = {
  async status() {
    return {
      app_version: window.__3DJ_VERSION || 'dev', project: store.doc.name, file: app.file?.name || null, unsaved_changes: !!app.dirty,
      steps: store.doc.features.length, objects: Object.keys(store.doc.bodies).length,
      selected: app.sel.map((id) => ({ id, name: bodyName(id) })),
      busy: document.querySelector('.sk-svg') ? 'sketch board open' : app.converting ? 'making editable' : null,
    };
  },

  async get_project() { return { project: projectJson(), ...(await report()) }; },

  async build() { return report(); },

  async new_project({ name, discard_changes }) {
    needFree();
    if (!discard_changes) notOpenEdits();
    newProject();
    if (name) { store.doc.name = String(name); updateTitle(); }
    app.dirty = false;
    toast(`${who}: started a new project`, 'info', 3500);
    return TOOLS.status();
  },

  async open_project({ name, data, discard_changes }) {
    needFree();
    if (!discard_changes) notOpenEdits();
    const file = new File([bytesFromB64(data)], name);
    await openFile(file, null);
    if (app.file?.name !== name) throw new Error(`3DJames could not open ${name} (it shows why in the window).`);
    return { project: projectJson(), ...(await report()) };
  },

  async add_steps({ steps = [], objects, vars, after }) {
    if (!Array.isArray(steps)) throw new Error('steps must be a list of steps.');
    return change(`added ${steps.length} step${steps.length === 1 ? '' : 's'}`, (d, newId) => {
      setVars(d, vars);
      setObjects(d, objects);
      const used = new Set(d.features.map((f) => f.id)), added = [];
      for (const s of steps) {
        if (!s || typeof s !== 'object' || typeof s.type !== 'string') throw new Error('Each step needs a "type" (shape, combine, move, fillet...).');
        const f = copy(s);
        if (!f.id) f.id = newId('f');
        if (used.has(f.id)) throw new Error(`Step id ${f.id} is already used. Leave "id" out to get a new one, or use change_step to change that step.`);
        if (f.type === 'shape' && !f.body) f.body = newId('b');
        used.add(f.id); added.push(f);
      }
      let at = d.features.length;
      if (after) { const i = d.features.findIndex((f) => f.id === after); if (i < 0) throw new Error(`There is no step ${after}.`); at = i + 1; }
      d.features.splice(at, 0, ...added);
      const unnamed = [...new Set(added.flatMap((f) => [f.body, f.body2, ...(f.tools || [])]).filter((id) => id && !d.bodies[id]))];
      return { added: added.map((f) => f.id), ...(unnamed.length ? { note: `These objects have no name or colour yet (add them under "objects"): ${unnamed.join(', ')}` } : {}) };
    });
  },

  async change_step({ id, changes = {} }) {
    return change(`changed step ${id}`, (d) => {
      const f = d.features.find((x) => x.id === id);
      if (!f) throw new Error(`There is no step ${id}. get_project lists the steps.`);
      for (const [k, v] of Object.entries(changes)) {
        if (k === 'id') continue;
        if (v === null) delete f[k];
        else if (k === 'p' && typeof v === 'object' && !Array.isArray(v)) f.p = { ...f.p, ...v };
        else f[k] = v;
      }
    });
  },

  async delete_steps({ ids = [] }) {
    const after = [...new Set(ids.flatMap((id) => dependentSteps(store.doc, id)))].filter((id) => !ids.includes(id));
    return change(`deleted ${ids.length} step${ids.length === 1 ? '' : 's'}`, (d) => {
      for (const id of ids) if (!d.features.some((f) => f.id === id)) throw new Error(`There is no step ${id}.`);
      d.features = d.features.filter((f) => !ids.includes(f.id));
      return after.length ? { note: `These later steps used what was deleted; check them: ${after.join(', ')}` } : {};
    });
  },

  async set_vars({ vars, remove }) { return change('changed variables', (d) => { setVars(d, vars, remove); }); },

  async set_objects({ objects }) { return change('changed objects', (d) => { setObjects(d, objects); }); },

  async replace_project({ project }) {
    if (!project || !Array.isArray(project.features)) throw new Error('project needs a "features" list (the same JSON as project.json in a .3dj).');
    return change('replaced the whole project', (d) => {
      const keep = { files: d.files };
      for (const k of Object.keys(d)) delete d[k];
      Object.assign(d, { v: 1, vars: [], bodies: {}, counters: {}, seq: 1 }, copy(project), keep.files ? keep : {});
    });
  },

  async undo({ steps = 1 }) {
    needFree();
    let n = 0;
    while (n < Math.min(+steps || 1, 50) && store.undo()) n++;
    toast(`${who}: undid ${n} change${n === 1 ? '' : 's'}`, 'info', 3500);
    return { undone: n, ...(await report()) };
  },

  async picture({ view = 'home', width = 900 }) {
    try { await waitForBuild(); } catch { /* show what there is */ }
    if (view !== 'current') vp.view(view, false);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const png = await vp.snapshot(Math.max(200, Math.min(+width || 900, 1600)));
    if (!png) throw new Error('3DJames could not take a picture (the 3D view is not ready).');
    return { image: toB64(png) };
  },

  async make_editable({ id, name, data, detail }) {
    needFree();
    if (data) {
      const before = new Set(store.doc.features.map((f) => f.id));
      if ((await insertFile(new File([bytesFromB64(data)], name), { throwErrors: true })) === false) throw new Error(`3DJames could not read ${name}.`);
      const f = store.doc.features.find((x) => !before.has(x.id) && x.kind === 'import');
      if (!f) throw new Error(`3DJames could not read ${name} (it shows why in the window).`);
      id = f.body;
    }
    if (!canMakeEditable(store.doc, id)) throw new Error(`Object ${id} is not an imported STL, OBJ, 3MF or STEP model, so it cannot be made editable.`);
    await makeEditable(id, { quiet: true, ...(['simple', 'balanced', 'precise'].includes(detail) ? { detail } : {}) });
    return { object: id, result: editable.lastReport, ...(await report()) };
  },

  /** Saving, part 1: the file's bytes. The link writes them into the Projects folder, then calls saved. */
  async file_data({ name, format = '3dj', exists }) {
    if (exists && !(await confirmOverwrite(name))) throw new Error(`The user chose not to save over ${name}. Pick another name.`);
    let snapshot = null;
    const data = await buildFileData(format, (s) => { snapshot = s; });
    pendingSave = { name, format, snapshot };
    return { data: toB64(data instanceof Uint8Array ? data : new Uint8Array(data)) };
  },
  /** Saving, part 2: the file is written. */
  async saved({ name }) {
    const s = pendingSave; pendingSave = null;
    if (!s || s.name !== name) return {};
    if (['3dj', '3mf'].includes(s.format)) markSaved(name, s.format, null, s.snapshot);
    else toast(`${who}: saved ${name} (the finished shape) in Projects`, 'info', 5000);
    return { saved: name };
  },
};

function confirmOverwrite(name) {
  return new Promise((resolve) => {
    let done = false;
    const answer = (yes) => { if (done) return; done = true; close(); resolve(yes); };
    const close = modal('Save over a file?', h('p', {}, `${who} wants to save over ${name} in your Projects folder. The old file will be replaced.`), () => [
      h('button', { class: 'btn', onclick: () => answer(false) }, 'Keep the old file'),
      h('button', { class: 'btn primary', onclick: () => answer(true) }, 'Save over it')], () => answer(false));
  });
}

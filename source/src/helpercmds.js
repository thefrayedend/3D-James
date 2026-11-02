// The Helpers menu (Object tab): common jobs on the parts you already have. Each one adds a step that opens in
// Properties, so its sizes can be changed afterwards. The geometry is in jobs.js; the face-clicking ones
// (screw holes, snap clips, vents) are tools in tools.js.
import { store, nextColor } from './store.js';
import { app, bodyData, bodyName } from './state.js';
import { toast } from './ui/dom.js';
import { vp } from './view.js';
import { editStep } from './commands.js';
import { openPanel, renderAll } from './ui/panels.js';
import { faceRef } from './tools.js';

const r1 = (v) => Math.round(v * 10) / 10;
function openStep(id, select) {
  if (select) { app.sel = select; vp.setSelection(app.sel); }
  editStep(id); openPanel('props'); renderAll();
}

/** Fit around: the selected part is cut out of every object it passes through, with a gap all round; the part stays. */
export function fitAround() {
  if (app.sel.length !== 1) return toast('Select the part that should fit (only that one), placed where it goes, then click Fit around.');
  const part = app.sel[0], pd = bodyData(part); if (!pd) return;
  const eps = 1e-4;
  const overlaps = (d) => [0, 1, 2].every((i) => d.bbox[0][i] < pd.bbox[1][i] - eps && d.bbox[1][i] > pd.bbox[0][i] + eps);
  const targets = [...app.results.bodies.keys()].filter((id) => id !== part && !store.doc.bodies[id]?.hidden && !store.doc.bodies[id]?.hole && overlaps(bodyData(id)));
  if (!targets.length) return toast('Move the part into the object it should fit into first (they need to overlap), then click Fit around.', 'err', 6000);
  let first;
  const before = new Set(Object.keys(app.results.errors));
  store.commit((doc) => {
    for (const body of targets) {
      const id = store.newId('f'); first ||= id;
      doc.features.push({ id, type: 'fit', body, tools: [part], gap: 0.2, keepPart: true });
    }
  });
  if (targets.length > 1) toast(`Cut out of ${targets.length} objects. Each one has its own Fit around step.`, 'info', 4000);
  openStep(first, [targets[0]]);
  checkAfterBuild(first, before);
}

/**
 * A new step that should work as it is: when the rebuild shows a problem, it is taken back out and the problem shown,
 * so a helper never leaves a broken step behind. fix(err) may mend it instead (return true when it did).
 */
function checkAfterBuild(fid, before, fix) {
  app.helperCheck = true;
  app.afterBuild = { fn: () => {
    app.helperCheck = false;
    const err = app.results.errors[fid] || Object.entries(app.results.errors).find(([id]) => !before.has(id))?.[1];
    if (!err || (fix && fix(err))) return;
    store.undo(); store.redoStack.pop();
    app.sel = []; vp.setSelection([]); editStep(null); renderAll();
    toast(err, 'err', 8000);
  } };
}

/** Make a lid: a new object, beside the open box, that fits it. A closed box is hollowed out first, top left open. */
export function makeLid() {
  if (app.sel.length !== 1) return toast('Select one open box (hollowed out with the top left open), then click Make a lid.');
  const src = app.sel[0], d = bodyData(src); if (!d) return;
  const before = new Set(Object.keys(app.results.errors));
  let fid, lid;
  store.commit((doc) => {
    lid = store.newId('b'); fid = store.newId('f');
    doc.bodies[lid] = { name: `${bodyName(src)} lid`, color: nextColor(doc) };
    doc.features.push({ id: fid, type: 'lid', src, body: lid, style: 'friction', t: 2, lip: 4, wall: 1.2, gap: 0.15, slot: 1, dx: r1(d.bbox[1][0] - d.bbox[0][0] + 10), dy: 0 });
  });
  openStep(fid, [lid]);
  checkAfterBuild(fid, before, (err) => {
    if (!/no opening/.test(err)) return false;
    const top = topFace(d); if (top == null) return false;
    store.amend((doc) => {
      const at = doc.features.findIndex((f) => f.id === fid);
      doc.features.splice(at, 0, { id: store.newId('f'), type: 'shell', body: src, faces: [faceRef(d, top)], t: 2 });
    });
    toast(`${bodyName(src)} was closed, so it was hollowed out first: 2 mm walls, top left open. Change the walls in its Hollow step.`, 'info', 7000);
    checkAfterBuild(fid, before);
    return true;
  });
}
/** The flat face on top of an object (pointing straight up, at its highest point), or null. */
function topFace(d) {
  if (!d.faces) return null;
  const n = d.faces.length / 6, zTop = d.bbox[1][2], tol = Math.max(1e-3, (zTop - d.bbox[0][2]) * 1e-3);
  for (let i = 0; i < n; i++) if (d.faces[i * 6 + 5] > 0.999 && Math.abs(d.faces[i * 6 + 2] - zTop) < tol) return i;
  return null;
}

/** Hinge between two parts that sit side by side (a print-in-place pin hinge to start with). */
export function addHinge() {
  if (app.sel.length !== 2) return toast('Select the two parts to join (click one, Ctrl+click the other). Put them side by side, a few mm apart, edges facing each other. They fold shut top to top, like a book.');
  const [a, b] = app.sel, da = bodyData(a), db = bodyData(b); if (!da || !db) return;
  const height = Math.min(da.bbox[1][2] - da.bbox[0][2], db.bbox[1][2] - db.bbox[0][2]);
  const d = Math.max(3, Math.min(8, Math.floor(height * 2) / 2)); // the knuckles reach down from the top edge
  let fid;
  const before = new Set(Object.keys(app.results.errors));
  store.commit((doc) => { fid = store.newId('f'); doc.features.push({ id: fid, type: 'hinge', body: a, body2: b, style: 'pin', d, n: 0, pin: 0, clear: 0.3, kgap: 0.4, t: 0.6, margin: 1 }); });
  openStep(fid, [a]);
  checkAfterBuild(fid, before);
}

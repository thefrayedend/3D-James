// Tools that ask you to click edges, faces or a cutting plane first: fillet, chamfer, hollow,
// shape on a face, push/pull and split.
import { store, nextColor } from './store.js';
import { evalExpr, HARDWARE } from './shared.js';
import { app, scope, bodyData } from './state.js';
import { r4, toast } from './ui/dom.js';
import { vp } from './view.js';
import { editStep, bodyMatrixFeature, withGroup } from './commands.js';
import { Matrix4, Vector3, Quaternion } from 'three';
import { renderAll, renderProps, openPanel } from './ui/panels.js';
import { renderCmdBar } from './ui/ribbon.js';
import { measurePick } from './measure.js';
import { planeDialog } from './sketchplane.js';
import { workerCall, waitForBuild, refreshToolPreview } from './build.js';
import { lookAtFace } from './sketchcmd.js';
import { finishPaint } from './painttool.js';

// tools that finish with a single click (no Apply button)
export const ONE_CLICK = new Set(['extrude', 'pushpull', 'layflat', 'insertpocket', 'workplane', 'sketchplane', 'align', 'lookat', 'measure']);

/** Workplane (like TinkerCAD): new shapes are placed on this face, standing out from it. null = the floor. */
export function setWorkplane(wp) {
  app.workplane = wp; vp.setWorkplane(wp);
  renderCmdBar();
}

export function solidSelected(what) {
  if (app.sel.length !== 1) { toast(`Select one object, then choose ${what}.`); return null; }
  const id = app.sel[0];
  const d = bodyData(id);
  if (!d) return null;
  if (!d.solid) { toast(`${what} works on solid shapes. This object is a mesh because it contains a thread or an imported model. Add the ${what.toLowerCase()} before combining.`, 'err', 7000); return null; }
  return id;
}

export function startTool(type) {
  if (app.tool) endTool();
  if (type === 'fillet' || type === 'chamfer') {
    const id = solidSelected(type === 'fillet' ? 'Fillet' : 'Chamfer'); if (!id) return;
    app.tool = { type, body: id, items: [], r: type === 'fillet' ? 2 : 1 };
    vp.startPick('edge', (b) => b === id, []);
  } else if (type === 'shell') {
    const id = solidSelected('Hollow'); if (!id) return;
    app.tool = { type, body: id, items: [], t: 2 };
    vp.startPick('face', (b) => b === id, []);
  } else if (['extrude', 'pushpull', 'layflat', 'insertpocket'].includes(type)) {
    const id = solidSelected({ extrude: 'Shape on face', pushpull: 'Push/pull', layflat: 'Lay flat', insertpocket: 'Insert pocket' }[type]); if (!id) return;
    app.tool = { type, body: id, items: [] };
    vp.startPick('face', (b) => b === id, []);
  } else if (type === 'measure') {
    app.tool = { type, kind: 'point', unit: 'mm', items: [] };
    vp.startPick('point', () => true, []);
  } else if (type === 'emboss') {
    const id = solidSelected('Emboss / engrave'); if (!id) return;
    app.tool = { type, body: id, items: [], source: 'text', text: '3DJames', font: 'sans', size: 8, depth: 1, angle: 0, u: 0, v: 0, mode: 'add' };
    vp.startPick('face', (b) => b === id, []);
  } else if (type === 'align') {
    if (app.sel.length < 2) return toast('Select two or more objects first (hold Ctrl and click), then click Align.');
    app.tool = { type, anchor: app.sel[0], items: [] };
    vp.setAlign({ anchor: withGroup([app.sel[0]]) });
  } else if (['workplane', 'sketchplane'].includes(type)) {
    app.tool = { type, items: [] };
    vp.startPick('face', (b) => !!bodyData(b), [], { meshes: true });
  } else if (type === 'lookat') {
    app.tool = { type, items: [] };
    vp.startPick('face', () => true, []);
  } else if (type === 'split') {
    if (app.sel.length !== 1) return toast('Select one object to split.');
    const id = app.sel[0]; const d = bodyData(id);
    const [mn, mx] = d.bbox;
    const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
    app.tool = { type, body: id, off: 0, roll: 0, pitch: 0, yaw: 0, keep: 'above', pmode: 'move' };
    vp.startPlane({ center: [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2], size: Math.max(diag * 1.15, 10), off: 0, roll: 0, pitch: 0, yaw: 0 });
  }
  editStep(null);
  if (app.tool && !['split', 'workplane', 'sketchplane', 'align', 'lookat'].includes(app.tool.type)) openPanel('props');
  renderCmdBar();
  renderAll();
}
export function endTool() {
  if (app.tool?.type === 'paint') { finishPaint(true); return; } // Esc while painting keeps the paint, like Done
  if (app.tool?.type === 'workplane') app.afterWorkplane = null;
  const wasSplit = app.tool?.type === 'split';
  const hadPreview = app.tool?.type === 'emboss' && app.tool.face; // its orange preview goes away
  if (app.tool?.type === 'align') vp.setAlign(null);
  app.tool = null;
  vp.setMeasurements([]);
  vp.endPick();
  if (wasSplit) vp.endPlane();
  if (hadPreview) refreshToolPreview();
  renderCmdBar();
  renderAll();
}
export function splitBarValues() { const t = app.tool; return t.pmode === 'rotate' ? [t.roll, t.pitch, t.yaw] : [t.off]; }

export function toolPick(kind, hit) {
  const t = app.tool; if (!t) return;
  if (t.type === 'measure') return measurePick(hit);
  const i = t.items.findIndex((x) => x.body === hit.body && x.index === hit.index);
  if (['workplane', 'sketchplane'].includes(t.type)) {
    if (t.busy) return;
    const d = bodyData(hit.body); if (!d) return;
    if (hit.area) {
      // a mesh (an imported STL): a flat area is used as it is; on a curve, the plane touches the mesh where it was clicked
      const ar = hit.area, size = Math.max(40, Math.round(1.6 * Math.max(...[0, 1, 2].map((k) => d.bbox[1][k] - d.bbox[0][k])) / 10) * 10);
      const then = app.afterWorkplane; app.afterWorkplane = null;
      const flat = !ar.curved, n = flat ? ar.n : hit.normal;
      // a flat area's plane goes through its middle (Place sketch plane: the clicked point on it); a curve's through the clicked point
      const dist = flat ? hit.point.reduce((s, v, k) => s + (v - ar.P[k]) * n[k], 0) : 0;
      const P = flat && t.type === 'workplane' ? ar.P : hit.point.map((v, k) => v - n[k] * dist);
      const wp = { P, n: n.slice(), curved: !flat, size, body: hit.body, meshEdges: flat ? ar.edges : null };
      endTool();
      if (flat && t.type === 'workplane') { setWorkplane(wp); if (then) then(); else toast('Workplane set. New shapes go on this plane; click Workplane to return to the floor.'); }
      else planeDialog(wp, then);
      return;
    }
    const curved = d.flat && !d.flat[hit.index];
    const pickedRevision = store.revision;
    if ((curved || t.type === 'sketchplane') && (app.building || app.pending || app.builtRevision !== pickedRevision)) return toast('Wait for the model to finish rebuilding, then click the surface again.');
    const size = Math.max(40, Math.round(1.6 * Math.max(...[0, 1, 2].map((k) => d.bbox[1][k] - d.bbox[0][k])) / 10) * 10);
    const finish = (plane) => {
      if (app.tool !== t) return;
      const then = app.afterWorkplane; app.afterWorkplane = null;
      const edit = curved || t.type === 'sketchplane';
      endTool();
      const wp = { ...plane, size, body: hit.body, face: hit.index };
      if (edit) planeDialog(wp, then);
      else { setWorkplane(wp); if (then) then(); else toast('Workplane set. New shapes go on this plane; click Workplane to return to the floor.'); }
    };
    if (!curved && t.type !== 'sketchplane') {
      finish({ P: Array.from(d.faces.subarray(hit.index * 6, hit.index * 6 + 3)), n: Array.from(d.faces.subarray(hit.index * 6 + 3, hit.index * 6 + 6)), curved: false });
      return;
    }
    t.busy = true;
    (async () => {
      try {
        await waitForBuild();
        if (app.tool !== t) return;
        if (store.revision !== pickedRevision) throw new Error('The model changed. Pick the surface again.');
        const revision = store.revision;
        const result = await workerCall({ type: 'surfacePlane', body: hit.body, face: hit.index, point: hit.point });
        if (app.tool !== t) return;
        if (revision !== store.revision) throw new Error('The model changed. Pick the surface again.');
        finish(result.plane);
      } catch (err) { if (app.tool === t) { t.busy = false; toast(err.message, 'err'); } }
    })();
    return;
  }
  if (t.type === 'emboss') {
    const d = bodyData(hit.body);
    if (d.flat && !d.flat[hit.index]) return toast('Pick a flat face for embossing. Curved wrapping is not supported yet.', 'err');
    t.face = faceRef(d, hit.index); t.items = [hit]; vp.setPickItems(t.items); renderProps(); refreshToolPreview(); return;
  }
  if (t.type === 'lookat') { endTool(); lookAtFace(hit); return; }
  if (t.type === 'layflat') {
    // turn the object so the clicked face points straight down, then set it on the floor
    const d = bodyData(hit.body);
    const n = new Vector3(...d.faces.subarray(hit.index * 6 + 3, hit.index * 6 + 6)).normalize();
    const q = new Quaternion().setFromUnitVectors(n, new Vector3(0, 0, -1));
    const c = new Vector3((d.bbox[0][0] + d.bbox[1][0]) / 2, (d.bbox[0][1] + d.bbox[1][1]) / 2, (d.bbox[0][2] + d.bbox[1][2]) / 2);
    const M = new Matrix4().makeTranslation(c.x, c.y, c.z).multiply(new Matrix4().makeRotationFromQuaternion(q)).multiply(new Matrix4().makeTranslation(-c.x, -c.y, -c.z));
    app.settle = [hit.body];
    store.commit((doc) => bodyMatrixFeature(doc, hit.body, M));
    endTool();
    return;
  }
  if (t.type === 'extrude' || t.type === 'pushpull' || t.type === 'insertpocket') {
    // one click is enough: the step is made right away and opened, so its numbers can be typed in
    const d = bodyData(hit.body);
    if (t.type === 'pushpull' && d.flat && !d.flat[hit.index]) return toast('Push/pull works on flat faces. Click a flat face.', 'err');
    const face = faceRef(d, hit.index);
    let fid;
    store.commit((doc) => {
      fid = store.newId('f');
      const ins = HARDWARE.insert.M3;
      doc.features.push(t.type === 'extrude'
        ? { id: fid, type: 'extrude', body: hit.body, face, prof: 'rect', w: 10, h: 10, d: 10, n: 6, u: 0, v: 0, depth: 5, mode: 'add' }
        : t.type === 'insertpocket'
          // a round pocket the size of an M3 heat-set insert, in the middle of the face (size and spot can be changed)
          ? { id: fid, type: 'extrude', body: hit.body, face, prof: 'circle', w: 10, h: 10, d: ins.d, n: 6, u: 0, v: 0, depth: ins.depth, mode: 'cut', name: 'M3 heat-set insert pocket' }
          : { id: fid, type: 'pushpull', body: hit.body, face, d: 5 });
    });
    app.tool = null; vp.endPick(); editStep(fid); openPanel('props'); renderCmdBar(); renderAll();
    return;
  }
  if (i >= 0) t.items.splice(i, 1); else t.items.push(hit);
  vp.setPickItems(t.items);
  renderProps();
}

export function edgeRef(d, index) {
  const m = Array.from(d.edges.subarray(index * 6, index * 6 + 3)), t = Array.from(d.edges.subarray(index * 6 + 3, index * 6 + 6));
  return { nc: normCoord(m, d.bbox).map(r4), d: t.map(r4) };
}
export function faceRef(d, index) {
  const c = Array.from(d.faces.subarray(index * 6, index * 6 + 3)), n = Array.from(d.faces.subarray(index * 6 + 3, index * 6 + 6));
  return { nc: normCoord(c, d.bbox).map(r4), d: n.map(r4) };
}
export function normCoord(p, bb) { return [0, 1, 2].map((i) => { const s = bb[1][i] - bb[0][i]; return s > 1e-6 ? (p[i] - bb[0][i]) / s : 0.5; }); }

export function quickEdges(which) {
  const t = app.tool; const d = bodyData(t.body); if (!d) return;
  const n = d.edges.length / 6; const items = [];
  const zMin = d.bbox[0][2], zMax = d.bbox[1][2], tol = Math.max(1e-3, (zMax - zMin) * 1e-3);
  for (let i = 0; i < n; i++) {
    const mz = d.edges[i * 6 + 2]; const tz = Math.abs(d.edges[i * 6 + 5]);
    const ok = which === 'all' || (which === 'top' && Math.abs(mz - zMax) < tol && tz < 0.05) || (which === 'bottom' && Math.abs(mz - zMin) < tol && tz < 0.05) || (which === 'vertical' && tz > 0.99);
    if (ok) items.push({ body: t.body, index: i });
  }
  t.items = items; vp.setPickItems(items); renderProps();
}

/** While picking edges for Fillet/Chamfer, moving the size slider shows the result right away (the step is made
 *  as you drag; letting go keeps it and opens it, so the slider keeps working there). */
export function toolPreview(v) {
  const t = app.tool; if (!t || !t.items.length) { if (t) t.r = v; return; }
  t.r = v;
  const d = bodyData(t.body);
  if (!t.previewId) {
    t.previewId = store.newId('f');
    store.transient((doc) => doc.features.push({ id: t.previewId, type: t.type, body: t.body, edges: t.items.map((it) => edgeRef(d, it.index)), r: v }));
  } else store.transient((doc) => { const f = doc.features.find((x) => x.id === t.previewId); if (f) f.r = v; });
}
export function toolPreviewDone() {
  const t = app.tool; if (!t?.previewId) return;
  const fid = t.previewId; t.previewId = null;
  endTool(); editStep(fid); openPanel('props');
}
export function applyTool() {
  const t = app.tool; if (!t) return;
  if (t.type === 'paint') { finishPaint(true); return; }
  const d = bodyData(t.body);
  if (t.type === 'emboss') {
    if (!t.face) return toast('Pick a flat face first.');
    if (t.source === 'logo' && !t.logo) return toast('Choose an SVG logo first.');
    const { type, body, face, source, text, font, size, depth, angle, u, v, mode, logo } = t;
    let id;
    store.commit((doc) => { id = store.newId('f'); doc.features.push({ id, type, body, face, source, text, font, size, depth, angle, u, v, mode, ...(logo ? { logo } : {}) }); });
    endTool(); editStep(id); openPanel('props'); return;
  }
  if (t.type === 'fillet' || t.type === 'chamfer') {
    if (t.previewId) return toolPreviewDone(); // already made by dragging its size
    if (!t.items.length) return toast('Click one or more edges first.');
    let r; try { r = evalExpr(t.r, scope()); } catch (err) { return toast(err.message, 'err'); }
    if (!(r > 0)) return toast('Size must be above 0.', 'err');
    const fid = store.newId('f');
    store.commit((doc) => doc.features.push({ id: fid, type: t.type, body: t.body, edges: t.items.map((it) => edgeRef(d, it.index)), r: t.r }));
    // open the new step right away so its size slider shows the rounding live
    endTool(); editStep(fid); openPanel('props'); return;
  } else if (t.type === 'shell') {
    store.commit((doc) => doc.features.push({ id: store.newId('f'), type: 'shell', body: t.body, faces: t.items.map((it) => faceRef(d, it.index)), t: t.t }));
  } else if (t.type === 'split') {
    store.commit((doc) => {
      const b2 = store.newId('b');
      doc.features.push({ id: store.newId('f'), type: 'split', body: t.body, body2: b2, off: t.off, roll: t.roll, pitch: t.pitch, yaw: t.yaw, keep: t.keep });
      if (t.keep === 'both') { const pb = doc.bodies[t.body] || {}; doc.bodies[b2] = { ...pb, name: `${pb.name || 'Object'} (part 2)`, color: nextColor(doc) }; }
    });
  }
  endTool();
}

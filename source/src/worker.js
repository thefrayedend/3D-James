import initOC from '../node_modules/replicad-opencascadejs/dist/replicad_single.js';
import ManifoldModule from 'manifold-3d';
import { evaluate, setManifoldModule, R, exportMeshOf, solidOf, parseSTLToMf, hasStep, registerStep, countSolids, solidBounds, surfacePlane, unionLoops, offsetLoops, outlineOf } from './engine.js';
import { zipStore } from './zip.js';
import { convertAndCheck } from './stlconvert.js';
import { paintMesh, paintString } from './paint.js';

const fonts = new Set();
let ready = false;
let MFmod = null;
const files = {}; // imported file bytes by id, sent once by the page
async function readStep(bytes) {
  try {
    return await R.importSTEP(new Blob([bytes]));
  } catch (err) {
    const m = String(err?.message || err);
    if (/memory|alloc|RangeError|Aborted/i.test(m)) throw new Error('This STEP file is too big for 3DJames to read here (it ran out of memory). Try exporting it with less detail, or as separate parts.');
    throw new Error('3DJames could not read this STEP file. It may be damaged or use an unusual STEP version.');
  }
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// The page hands over the engine files (they are built into 3DJames.html, so nothing is downloaded).
async function init(assets) {
  const oc = await initOC({ wasmBinary: await gunzip(assets.occ), locateFile: (f) => f });
  R.setOC(oc);
  const mf = await ManifoldModule({ wasmBinary: assets.manifold, locateFile: (f) => f });
  mf.setup();
  setManifoldModule(mf);
  MFmod = mf;
  for (const name of ['sans', 'round']) {
    try { await R.loadFont(assets[name], name); fonts.add(name); } catch (err) { console.warn('font', name, err); }
  }
  ready = true;
}

function stlBinary(parts) {
  let n = 0; for (const p of parts) n += p.triangles.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const hdr = '3DJames export';
  for (let i = 0; i < hdr.length; i++) dv.setUint8(i, hdr.charCodeAt(i));
  dv.setUint32(80, n, true);
  let o = 84;
  for (const { vertices: v, triangles: t } of parts) {
    for (let i = 0; i < t.length; i += 3) {
      const a = t[i] * 3, b = t[i + 1] * 3, c = t[i + 2] * 3;
      const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
      const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
      let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
      for (let k = 0; k < 3; k++) {
        const idx = t[i + k] * 3;
        dv.setFloat32(o + 12 + k * 12, v[idx], true); dv.setFloat32(o + 16 + k * 12, v[idx + 1], true); dv.setFloat32(o + 20 + k * 12, v[idx + 2], true);
      }
      o += 50;
    }
  }
  return new Uint8Array(buf);
}

function threeMF(parts, project, extra = [], out = {}) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  // each object's colour is a colour group (the 3MF materials extension): OrcaSlicer and Bambu Studio put each
  // different colour on a filament of its own (checked with both). They skip <basematerials> colours.
  // Paint (see paint.js) goes on each triangle as their "paint_color", which names a filament by its number. Every
  // paint colour gets a colour group too, after the objects' ones: they number the filaments by each new colour in
  // the order of the colour groups, so the numbers here are worked out the same way.
  const painted = parts.map((p) => (p.paint?.length ? paintMesh(p, p.paint) : null));
  const hex = (c) => `${c.toUpperCase()}FF`;
  const groups = [...parts.map((p) => hex(p.color)), ...new Set(painted.flatMap((x) => x?.colors || []).map(hex))];
  const filament = new Map();
  for (const g of groups) if (!filament.has(g)) filament.set(g, filament.size + 1);
  if (painted.some(Boolean)) out.filaments = [...filament.keys()].map((g) => g.slice(0, 7)); // (told after saving)
  let mats = '', objs = '', items = '';
  groups.forEach((g, i) => { mats += `<m:colorgroup id="${parts.length + i + 2}"><m:color color="${g}"/></m:colorgroup>`; });
  parts.forEach((p, i) => {
    const v = p.vertices, t = p.triangles, pt = painted[i];
    const fil = pt && ((s) => filament.get(hex(pt.colors[s - 1])));
    let vs = '', ts = '';
    for (let k = 0; k < v.length; k += 3) vs += `<vertex x="${+v[k].toFixed(5)}" y="${+v[k + 1].toFixed(5)}" z="${+v[k + 2].toFixed(5)}"/>`;
    for (let k = 0; k < t.length; k += 3) {
      const s = pt?.trees[k / 3] ? paintString(pt.trees[k / 3], fil) : '';
      ts += `<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"${s ? ` paint_color="${s}"` : ''}/>`;
    }
    objs += `<object id="${i + 2}" name="${esc(p.name)}" type="model" pid="${parts.length + i + 2}" pindex="0"><mesh><vertices>${vs}</vertices><triangles>${ts}</triangles></mesh></object>`;
    items += `<item objectid="${i + 2}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"><resources>${mats}${objs}</resources><build>${items}</build></model>`;
  const enc = new TextEncoder();
  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>') },
    { name: '_rels/.rels', data: enc.encode('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>') },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
    ...(project ? [{ name: 'Metadata/3djames.json', data: enc.encode(project) }] : []),
    ...extra.map((x) => ({ name: x.name, data: new Uint8Array(x.data) })),
  ]);
}

async function doExport({ format, items, base, project, extra }) {
  const parts = [];
  for (const it of items) {
    const m = exportMeshOf(it.id);
    if (m) parts.push({ ...m, name: it.name, color: it.color, paint: it.paint });
  }
  if (!parts.length && !(format === '3mf' && project)) throw new Error('Nothing to export');
  const files = [], info = {};
  if (format === 'stl') files.push({ name: base + '.stl', data: stlBinary(parts) });
  else if (format === 'stl-each') items.forEach((it, i) => parts[i] && files.push({ name: `${base}-${it.name.replace(/[^\w.-]+/g, '_')}.stl`, data: stlBinary([parts[i]]) }));
  else if (format === '3mf') files.push({ name: base + '.3mf', data: threeMF(parts, project, extra, info) });
  else if (format === 'step') {
    const solids = items.map((it) => ({ shape: solidOf(it.id), name: it.name, color: it.color })).filter((x) => x.shape);
    if (!solids.length) throw new Error('STEP needs solid shapes. Threads and imported models are meshes and can only be saved as STL or 3MF.');
    const blob = R.exportSTEP(solids.map((s) => ({ shape: s.shape.clone(), name: s.name, color: s.color })));
    files.push({ name: base + '.step', data: new Uint8Array(await blob.arrayBuffer()) });
  }
  return { zip: zipStore(files), files, skipped: format === 'step' ? items.length - files.length : 0, filaments: info.filaments };
}

/**
 * Make an imported mesh editable: rebuild it as sketches and steps (src/stlconvert.js), build those in a trial
 * run and measure them against the mesh. msg.feature is the import step (it says where the mesh sits).
 */
function convertImport({ feature, name, seq, body, detail }) {
  const trial = evaluate({ vars: [], bodies: {}, features: [{ ...feature, id: 'f0', body: 'b0' }] }, fonts, { files, scratch: true });
  const mesh = trial.meshes.get('b0');
  if (!mesh) throw new Error(Object.values(trial.errors)[0] || 'The mesh could not be read.');
  return convertAndCheck(MFmod, mesh, { name, seq, body, detail }, (doc) => evaluate(doc, fonts, { scratch: true }));
}

async function handleMessage(e) {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      await init(msg.assets);
      self.postMessage({ type: 'ready' });
    } else if (msg.type === 'addFile') {
      files[msg.fileId] = new Uint8Array(msg.data);
    } else if (msg.type === 'build') {
      if (!ready) return;
      // STEP files are read once (it takes a moment), then reused
      for (const f of msg.doc.features || []) {
        if (f.type === 'shape' && f.kind === 'import' && f.p?.fmt === 'step' && !hasStep(f.p.file) && files[f.p.file]) {
          try { registerStep(f.p.file, await readStep(files[f.p.file])); } catch (err) { console.warn('step', err); }
        }
      }
      const res = evaluate(msg.doc, fonts, { files, ghostOf: msg.ghostOf, show: msg.show || [], preview: msg.preview || null });
      self.postMessage({ type: 'built', id: msg.id, revision: msg.revision, ...res });
    } else if (msg.type === 'surfacePlane') {
      self.postMessage({ type: 'surfacePlane', id: msg.id, plane: surfacePlane(msg.body, msg.face, msg.point) });
    } else if (msg.type === 'outline') {
      self.postMessage({ type: 'outline', id: msg.id, polys: outlineOf(msg.ids || [], msg.m) });
    } else if (msg.type === 'unionLoops') {
      self.postMessage({ type: 'unionLoops', id: msg.id, loops: unionLoops(msg.loops || []) });
    } else if (msg.type === 'offsetLoops') {
      self.postMessage({ type: 'offsetLoops', id: msg.id, loops: offsetLoops(msg.loops || [], +msg.dist || 0, msg.corners) });
    } else if (msg.type === 'convertImport') {
      const res = convertImport(msg);
      self.postMessage({ type: 'converted', id: msg.id, ...res });
    } else if (msg.type === 'export') {
      const res = await doExport(msg);
      self.postMessage({ type: 'exported', id: msg.id, data: res.zip, files: res.files });
    } else if (msg.type === 'checkImport' && msg.fmt === 'step') {
      // read a STEP file: its overall bounds, and how many separate parts it holds
      const bytes = new Uint8Array(msg.data);
      files[msg.fileId] = bytes;
      const sh = await readStep(bytes);
      registerStep(msg.fileId, sh);
      const bb = solidBounds(sh);
      self.postMessage({ type: 'importOk', id: msg.id, bbox: bb, parts: Math.max(1, countSolids(sh)) });
    } else if (msg.type === 'checkImport') {
      files[msg.fileId] = new Uint8Array(msg.data.slice(0));
      const m = parseSTLToMf(msg.data);
      const tris = m.numTri(); m.delete();
      self.postMessage({ type: 'importOk', id: msg.id, tris });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, op: msg.type, message: err?.message || String(err) });
  }
};

// Kernel state is shared: finish each operation before starting the next one.
let operations = Promise.resolve();
self.onmessage = (e) => { operations = operations.then(() => handleMessage(e)); };

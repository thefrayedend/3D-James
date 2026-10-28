// 3DJames regression suite. Runs inside the page through window.__3dj.
(() => {
  const B = window.__3dj; const C = B.commands; const S = B.store;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function built() {
    await sleep(40);
    for (let i = 0; i < 6000; i++) {
      if (!B.app.building && !B.app.pending) { await sleep(30); if (!B.app.building && !B.app.pending) return; }
      await sleep(20);
    }
    throw new Error('build timed out');
  }
  const results = [];
  async function t(name, fn) {
    if (window.__ONLY && !window.__ONLY.split('|').some((w) => name.includes(w))) return;
    try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e?.message || String(e) }); }
    console.log('TEST ' + (results[results.length - 1].ok ? 'PASS ' : 'FAIL ') + name);
  }
  const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
  const near = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;
  const errs = () => Object.values(B.app.results.errors);
  const noErr = () => assert(!errs().length, 'build errors: ' + errs().join('; '));
  const bodies = () => [...B.app.results.bodies.keys()];
  const data = (id) => B.app.results.bodies.get(id);
  const size = (id) => { const b = data(id).bbox; return [0, 1, 2].map((i) => b[1][i] - b[0][i]); };
  const center = (id) => { const b = data(id).bbox; return [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2, b[0][2]]; };
  const sel = (ids) => { B.app.sel = ids; B.vp.setSelection(ids); };
  const fresh = async () => { C.newProject(); await built(); };
  const add = async (kind, extra, label) => { const id = C.addShape(kind, extra, label); await built(); return id; };
  const creator = (id) => S.doc.features.find((f) => f.type === 'shape' && f.body === id);
  const place = async (id, pos) => { S.commit((d) => { d.features.find((f) => f.type === 'shape' && f.body === id).pos = pos; }); await built(); };
  const SG_area = (l) => { // area of an outline with arcs: polygon plus/minus each arc's cap
    let a = 0; const P = l.pts, n = P.length;
    for (let i = 0; i < n; i++) { const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % n]; a += x1 * y2 - x2 * y1; }
    a /= 2; const sg = Math.sign(a) || 1; a = Math.abs(a);
    for (let i = 0; i < n; i++) { const b = +(l.bulge?.[i] || 0); if (!b) continue; const A = P[i], B = P[(i + 1) % n], c = Math.hypot(B[0] - A[0], B[1] - A[1]); const th = 4 * Math.atan(Math.abs(b)), R = c * (1 + b * b) / (4 * Math.abs(b)); const cap = R * R / 2 * (th - Math.sin(th)); a += (Math.sign(b) === sg ? 1 : -1) * cap; }
    return a;
  };
  const lastFeature = () => S.doc.features[S.doc.features.length - 1];
  const faceIndex = (id, n) => { const f = data(id).faces; for (let i = 0; i < f.length / 6; i++) if (near(f[i * 6 + 3], n[0], 0.01) && near(f[i * 6 + 4], n[1], 0.01) && near(f[i * 6 + 5], n[2], 0.01)) return i; return -1; };

  window.__runTests = async () => {
    await built();

    await t('all shapes build', async () => {
      await fresh();
      for (const k of ['box', 'cyl', 'sphere', 'cone', 'torus', 'wedge', 'pyramid', 'tube', 'prism', 'text', 'thread', 'extrusion']) await add(k);
      await add('prism', { n: 6, af: 20, h: 20 }, 'Hexagon'); await add('pyramid', { n: 3, d: 23.09, h: 16.33 }, 'Tetrahedron');
      noErr(); for (const k of ['t2040', 'v2020', 'v2040', 'v4040']) await add('extrusion', { size: k }); noErr();
      assert(bodies().length === 18, 'expected 18 objects, got ' + bodies().length);
    });

    await t('default 3D Builder colors', async () => {
      const col = (n) => Object.values(S.doc.bodies).find((b) => b.name.startsWith(n))?.color;
      assert(col('Box') === '#22B14C' && col('Cylinder') === '#00A2E8' && col('Hexagon') === '#FFC90E' && col('Tetrahedron') === '#99D9EA', 'colors wrong');
    });

    let a, b;
    await t('merge', async () => {
      await fresh(); a = await add('box'); b = await add('cyl'); await place(b, [10, 0, 0]);
      sel([a, b]); C.combine('union'); await built(); noErr();
      assert(bodies().length === 1 && near(size(a)[0], 30), 'merge size ' + size(a));
    });
    await t('subtract', async () => {
      await fresh(); a = await add('box', { w: 40, d: 40, h: 10 }); b = await add('cyl', { d: 10, h: 30 }); await place(b, [0, 0, -5]);
      sel([a, b]); C.combine('subtract'); await built(); noErr();
      assert(data(a).volume < 40 * 40 * 10 - 700, 'hole not cut ' + data(a).volume);
    });
    await t('subtract like 3D Builder: one cutter cuts everything it passes through', async () => {
      await fresh(); a = await add('box', { w: 30, d: 30, h: 10 }); b = await add('box', { w: 30, d: 30, h: 10 }); await place(b, [30, 0, 0]);
      const far = await add('box'); await place(far, [200, 0, 0]);
      const c = await add('cyl', { d: 10, h: 30 }); await place(c, [15, 0, -5]);
      sel([c]); C.combine('subtract'); await built(); noErr();
      assert(bodies().length === 3, 'objects ' + bodies().length);
      assert(data(a).volume < 9000 - 150 && data(b).volume < 9000 - 150, 'not cut out of both');
      assert(near(data(far).volume, 8000, 1), 'cut something it does not touch');
      C.openPanel('history'); sel([b]); B.app.historyAll = false; C.openPanel('history');
      assert(document.querySelector('#leftList .row-uses b.link'), 'no link to the cutter in History');
    });
    await t('intersect', async () => {
      await fresh(); a = await add('box'); b = await add('box'); await place(b, [10, 0, 0]);
      sel([a, b]); C.combine('intersect'); await built(); noErr();
      assert(near(size(a)[0], 10), 'intersect size ' + size(a));
    });
    await t('hole flag cuts on merge', async () => {
      await fresh(); a = await add('box', { w: 40, d: 40, h: 10 }); b = await add('cyl', { d: 10, h: 30 }); await place(b, [0, 0, -5]);
      C.setBodyProp([b], 'hole', true, 'geom'); await built();
      sel([a, b]); C.combine('union'); await built(); noErr();
      assert(data(a).volume < 40 * 40 * 10 - 700, 'hole not cut');
    });

    await t('fillet (top edges)', async () => {
      await fresh(); a = await add('box');
      sel([a]); C.startTool('fillet'); C.quickEdges('top'); B.app.tool.r = 3; C.applyTool(); await built(); noErr();
      assert(lastFeature().type === 'fillet' && lastFeature().edges.length === 4, 'fillet feature');
      assert(data(a).volume < 8000 - 30, 'fillet did not round');
    });
    await t('chamfer (vertical edges)', async () => {
      await fresh(); a = await add('box');
      sel([a]); C.startTool('chamfer'); C.quickEdges('vertical'); C.applyTool(); await built(); noErr();
      assert(lastFeature().type === 'chamfer', 'chamfer feature');
    });
    await t('hollow with open top', async () => {
      await fresh(); a = await add('box');
      sel([a]); C.startTool('shell'); const i = faceIndex(a, [0, 0, 1]); assert(i >= 0, 'no top face');
      B.app.tool.items.push({ body: a, index: i }); C.applyTool(); await built(); noErr();
      assert(data(a).volume < 4000, 'not hollow ' + data(a).volume);
    });
    await t('shape on face (cut)', async () => {
      await fresh(); a = await add('box');
      sel([a]); C.startTool('extrude'); C.toolPick('face', { body: a, index: faceIndex(a, [0, 0, 1]) }); await built();
      const f = lastFeature(); assert(f.type === 'extrude', 'extrude feature');
      S.commit((d) => { d.features.find((x) => x.id === f.id).mode = 'cut'; }); await built(); noErr();
      assert(data(a).volume < 8000 - 400, 'pocket not cut');
    });
    await t('lay flat on a face', async () => {
      await fresh(); a = await add('wedge');
      const f = data(a).faces; let i = -1;
      for (let k = 0; k < f.length / 6; k++) if (Math.abs(f[k * 6 + 5]) > 0.2 && Math.abs(f[k * 6 + 5]) < 0.9) i = k; // the slope
      assert(i >= 0, 'no sloped face');
      sel([a]); C.startTool('layflat'); C.toolPick('face', { body: a, index: i }); await built(); await built(); noErr();
      const g = data(a).faces; let down = false;
      for (let k = 0; k < g.length / 6; k++) if (g[k * 6 + 5] < -0.999 && Math.abs(g[k * 6 + 2] - data(a).bbox[0][2]) < 0.01) down = true;
      assert(down && near(data(a).bbox[0][2], 0, 0.01), 'slope is not flat on the floor');
    });
    await t('heat-set insert pocket on a face', async () => {
      await fresh(); a = await add('box');
      sel([a]); C.startTool('insertpocket'); C.toolPick('face', { body: a, index: faceIndex(a, [0, 0, 1]) }); await built(); noErr();
      const want = Math.PI * 2 * 2 * 6; // M3 insert: 4 mm wide, 6 mm deep
      assert(near(8000 - data(a).volume, want, 1), 'pocket volume ' + (8000 - data(a).volume));
    });
    await t('hardware: washer, screw holes, nut trap, insert hole, standoff', async () => {
      await fresh();
      for (const [k, x] of [['washer'], ['standoff'], ['insert'], ['nuttrap'], ['screwhole', { head: 'countersunk' }], ['screwhole', { head: 'counterbore' }], ['screwhole', { head: 'plain' }]]) {
        const id = await add(k, x); noErr(); assert(data(id)?.volume > 0, k + ' did not build');
        if (['insert', 'nuttrap', 'screwhole'].includes(k)) assert(S.doc.bodies[id].hole, k + ' should be a hole');
      }
      await fresh();
      const box = await add('box', { w: 30, d: 30, h: 10 }); const sh = await add('screwhole', { head: 'counterbore' });
      await place(box, [0, 0, 0]); await place(sh, [0, 0, 0]);
      sel([sh]); C.combine('subtract'); await built(); noErr();
      assert(data(box).volume < 9000 - 100, 'screw hole not cut ' + data(box).volume);
    });
    await t('mirror copy', async () => {
      await fresh(); a = await add('wedge'); sel([a]); C.mirrorSel('x', true); await built(); noErr();
      const m = B.app.sel[0]; assert(m && m !== a && bodies().length === 2, 'the mirror copy should be its own object');
      assert(near(size(a)[0], 20) && near(data(m).bbox[0][0], data(a).bbox[1][0]) && near(data(m).bbox[1][0] - data(a).bbox[0][0], 40), 'mirror copy placement ' + JSON.stringify([data(a).bbox, data(m).bbox]));
    });
    await t('pattern', async () => {
      await fresh(); a = await add('box'); sel([a]); C.addPattern(); await built(); noErr();
      assert(near(size(a)[0], 70), 'pattern width ' + size(a));
    });
    await t('split keep both', async () => {
      await fresh(); a = await add('box'); sel([a]); C.startTool('split'); B.app.tool.keep = 'both'; C.applyTool(); await built(); noErr();
      assert(bodies().length === 2, 'split parts ' + bodies().length);
    });
    await t('threads: bolt, nut, threaded hole', async () => {
      await fresh(); C.addThread('bolt'); await built(); C.addThread('nut'); await built();
      a = await add('box', { w: 30, d: 30, h: 10 }); C.addThread('cutter'); await built();
      const cut = bodies().find((id) => S.doc.bodies[id].hole); await place(cut, [0, 0, -1]);
      sel([a, cut]); C.combine('subtract'); await built(); noErr();
      assert(bodies().length === 3, 'thread objects ' + bodies().length);
    });

    await t('duplicate goes beside, delete, undo, redo', async () => {
      await fresh(); a = await add('box'); sel([a]); C.duplicateSel(); await built();
      assert(bodies().length === 2, 'duplicate');
      const c = B.app.sel[0]; assert(c !== a && near(Math.abs(center(c)[0] - center(a)[0]) + Math.abs(center(c)[1] - center(a)[1]), 25), 'dup offset');
      C.deleteSel(); await built(); assert(bodies().length === 1, 'delete');
      S.undo(); await built(); assert(bodies().length === 2, 'undo');
      S.redo(); await built(); assert(bodies().length === 1, 'redo');
    });
    await t('group and ungroup', async () => {
      await fresh(); a = await add('box'); b = await add('cyl'); sel([a, b]); C.groupSel();
      assert(S.doc.bodies[a].group && S.doc.bodies[a].group === S.doc.bodies[b].group, 'group');
      C.ungroupSel(); assert(!S.doc.bodies[a].group, 'ungroup');
    });
    await t('bottom bar: move, size, turn', async () => {
      await fresh(); a = await add('box'); sel([a]);
      C.setGizmo('translate'); C.barCommit(0, '50'); await built(); assert(near(center(a)[0], 50), 'move x ' + center(a));
      C.setGizmo('scale'); C.barCommit(0, '99'); await built(); assert(near(size(a)[0], 99) && near(size(a)[1], 99), 'size ' + size(a));
      B.app.settings.lock = false; C.barCommit(2, '5'); await built(); assert(near(size(a)[2], 5) && near(size(a)[0], 99), 'unlocked size ' + size(a)); B.app.settings.lock = true;
      C.setGizmo('rotate'); C.barCommit(2, '90'); await built(); noErr(); C.setGizmo('translate');
    });
    await t('resizing: ovals, several objects at once, combined objects', async () => {
      await fresh(); a = await add('cyl'); b = await add('box'); const c = await add('sphere');
      sel([a]); C.setGizmo('scale'); B.app.settings.lock = false; C.barCommit(0, '40'); await built(); noErr();
      assert(near(size(a)[0], 40) && near(size(a)[1], 20), 'cylinder did not become an oval ' + size(a));
      assert(creator(a).stretch, 'no stretch kept');
      sel([a, b, c]); const w0 = B.vp.selectionBox().max.x - B.vp.selectionBox().min.x; C.barCommit(1, '30'); await built(); noErr();
      for (const id of [a, b, c]) assert(near(size(id)[1], 30), 'not all resized: ' + size(id));
      assert(near(B.vp.selectionBox().max.x - B.vp.selectionBox().min.x, w0), 'width changed');
      sel([b, c]); C.combine('union'); await built(); sel([b]); C.barCommit(2, '50'); await built(); noErr();
      assert(near(size(b)[2], 50, 0.2), 'combined object not stretched ' + size(b));
      B.app.settings.lock = true; C.setGizmo('translate');
    });
    await t('variables drive sizes', async () => {
      await fresh(); S.commit((d) => { d.vars.push({ name: 'w', expr: '30' }); }); a = await add('box', { w: 'w' });
      assert(near(size(a)[0], 30), 'var size'); S.commit((d) => { d.vars[0].expr = '45'; }); await built(); assert(near(size(a)[0], 45), 'var change');
    });

    await t('every panel renders for every step', async () => {
      await fresh(); a = await add('box'); b = await add('cyl'); await place(b, [5, 0, 0]);
      sel([a]); C.startTool('fillet'); C.quickEdges('top'); C.applyTool(); await built();
      sel([a, b]); C.combine('union'); await built(); sel([a]); C.mirrorSel('y', true); C.addPattern(); await built();
      C.startTool('split'); C.applyTool(); await built(); C.translateSel(5, 0, 0); await built();
      for (const tab of ['props', 'history', 'objects']) { C.openPanel(tab); assert(document.querySelector('#side .side-body'), 'panel ' + tab); }
      for (const f of S.doc.features) { B.app.feature = f.id; C.openPanel('props'); assert(document.querySelector('#props')?.children.length, 'props for ' + f.type); }
      B.app.feature = null; sel([a]); C.openPanel('props'); assert(document.querySelector('#props input'), 'object panel');
    });

    await t('old .json projects still open (they are no longer saved)', async () => {
      await fresh(); a = await add('box'); b = await add('torus'); const bytes = new TextEncoder().encode(JSON.stringify(S.doc));
      await C.openFile(new File([bytes], 'p.json'), null); await built(); noErr(); assert(bodies().length === 2, 'json reopen');
      let err; try { await C.buildFileData('json'); } catch (e) { err = e; } assert(err, '.json can still be saved');
    });
    await t('save/open 3MF with history', async () => {
      const bytes = await C.buildFileData('3mf'); const zip = await C.readZip(new Uint8Array(bytes));
      assert(zip.get('Metadata/3djames.json') && zip.get('3D/3dmodel.model'), '3mf parts');
      await C.openFile(new File([bytes], 'p.3mf'), null); await built(); noErr(); assert(bodies().length === 2 && S.doc.features.length === 2, '3mf reopen');
    });
    let stlBytes, stepBytes;
    await t('export STL and STEP', async () => {
      stlBytes = await C.buildFileData('stl'); assert(stlBytes.byteLength > 1000, 'stl size');
      stepBytes = await C.buildFileData('step'); assert(new TextDecoder().decode(stepBytes.slice(0, 20)).includes('ISO-10303'), 'step header');
    });
    await t('insert STL, STEP, OBJ', async () => {
      await fresh(); await C.insertFile(new File([stlBytes], 'part.stl')); await built();
      await C.insertFile(new File([stepBytes], 'part.step'), { stepParts: 'one' }); await built();
      await C.insertFile(new File(['v 0 0 0\nv 10 0 0\nv 0 10 0\nv 0 0 10\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n'], 'tet.obj')); await built();
      noErr(); assert(bodies().length >= 3, 'inserted ' + bodies().length);
    });
    await t('imported files stay out of the project', async () => {
      assert(!S.doc.files || !Object.keys(S.doc.files).length, 'files inside doc'); assert(JSON.stringify(S.doc).length < 5000, 'doc too big');
      const bytes = await C.buildFileData('3dj'); await C.openFile(new File([bytes], 'q.3dj'), null); await built(); noErr();
      assert(bodies().length >= 3, 'reopen with imports ' + bodies().length);
    });
    await t('.3dj project: zip with the project, imported files and a preview', async () => {
      const n0 = bodies().length;
      const bytes = await C.buildFileData('3dj'); const zip = await C.readZip(new Uint8Array(bytes));
      assert(zip.get('project.json') && zip.get('preview.png'), '3dj parts ' + [...zip.keys()]);
      assert([...zip.keys()].some((k) => k.startsWith('files/')), 'imported files missing');
      await C.openFile(new File([bytes], 'r.3dj'), null); await built(); noErr();
      assert(bodies().length === n0 && B.app.file.fmt === '3dj', 'reopen 3dj ' + bodies().length);
    });
    await t('STEP assembly comes in as separate parts, in place', async () => {
      await fresh(); a = await add('box'); b = await add('torus'); await place(b, [40, 10, 5]); await built();
      const gap = center(b)[0] - center(a)[0];
      const bytes = await C.buildFileData('step');
      await fresh(); await C.insertFile(new File([bytes], 'asm.step'), { stepParts: 'separate' }); await built(); noErr();
      const ids = bodies(); assert(ids.length === 2, 'parts ' + ids.length);
      const xs = ids.map((id) => center(id)[0]).sort((p, q) => p - q);
      assert(near(xs[1] - xs[0], gap, 0.05), `parts moved apart: ${xs[1] - xs[0]} vs ${gap}`);
      sel([ids[0]]); C.deleteSel(); await built(); assert(bodies().length === 1, 'delete one part');
    });
    await t('push/pull a flat face out and in', async () => {
      await fresh(); a = await add('box');
      sel([a]); C.startTool('pushpull'); C.toolPick('face', { body: a, index: faceIndex(a, [0, 0, 1]) }); await built(); noErr();
      const f = lastFeature(); assert(f.type === 'pushpull', 'pushpull feature');
      assert(near(size(a)[2], 25), 'pulled out ' + size(a));
      S.commit((d) => { d.features.find((x) => x.id === f.id).d = -8; }); await built(); noErr();
      assert(near(size(a)[2], 12), 'pushed in ' + size(a));
    });
    await t('history shows how the selected object was made, with ghosts', async () => {
      await fresh(); a = await add('box', { w: 40, d: 40, h: 10 }); b = await add('cyl', { d: 10, h: 30 }); await place(b, [0, 0, -5]);
      S.commit((d) => { d.features.find((x) => x.body === b).name = 'Center hole'; });
      sel([a, b]); C.combine('subtract'); await built(); sel([a]); B.app.historyAll = false;
      C.openPanel('history');
      const uses = document.querySelector('#leftList .row-uses'); assert(uses && uses.textContent.includes('cut out'), 'no cut-out group');
      const rows = [...document.querySelectorAll('#leftList .row-item.step')]; assert(rows.length === 3, 'tree rows ' + rows.length);
      const holeRow = rows.find((r) => r.textContent.includes('Center hole')); assert(holeRow, 'named step');
      holeRow.click(); await built();
      assert(B.app.results.ghosts.length === 1, 'ghost ' + B.app.results.ghosts.length);
      assert(document.querySelector('#leftList .props.inline input'), 'inline editor');
      C.editStep(null); await built(); assert(B.vp.ghosts.children.length === 0, 'ghost cleared');
    });
    await t('panel keeps its scroll position', async () => {
      await fresh(); for (let i = 0; i < 40; i++) C.addShape('box'); await built();
      C.openPanel('objects'); const body = () => document.querySelector('#side .side-body'); body().scrollTop = 99999; const top = body().scrollTop;
      assert(top > 100, 'list not scrollable ' + top);
      [...document.querySelectorAll('#leftList .row-item')].pop().click(); await sleep(50);
      assert(Math.abs(body().scrollTop - top) < 2, 'scroll jumped to ' + body().scrollTop);
    });
    await t('workplane: new shapes stand on the picked face', async () => {
      await fresh(); a = await add('wedge');
      const f = data(a).faces; let i = -1;
      for (let k = 0; k < f.length / 6; k++) if (Math.abs(f[k * 6 + 5]) > 0.2 && Math.abs(f[k * 6 + 5]) < 0.9) i = k; // the slope
      B.commands.startTool('workplane'); C.toolPick('face', { body: a, index: i }); assert(B.app.workplane, 'no workplane');
      b = await add('cyl', { d: 6, h: 10 }); await built(); noErr();
      // the cylinder's axis follows the slope's normal and its bottom center sits on the face point
      const n = B.app.workplane.n, P = B.app.workplane.P, bb = data(b).bbox;
      const mid = [0, 1, 2].map((k) => (bb[0][k] + bb[1][k]) / 2);
      const want = [0, 1, 2].map((k) => P[k] + n[k] * 5);
      assert(want.every((v, k) => near(v, mid[k], 0.3)), 'cylinder middle ' + mid + ' want ' + want);
      C.addShape('box'); await built(); await built();
      B.commands.newProject(); await built(); assert(!B.app.workplane, 'workplane kept after New');
    });
    await t('ruler shows gaps and types an exact gap', async () => {
      await fresh(); a = await add('box'); b = await add('box');
      const pa = creator(a).pos; await place(b, [pa[0] + 32, pa[1], pa[2]]); // 20 mm boxes: 12 mm apart
      sel([a]); B.vp.setRuler(true); B.vp.render();
      const g = B.vp.rulerGaps().find((x) => x.ax === 0); assert(g && near(g.gap, 12), 'gap ' + g?.gap);
      const lab = [...document.querySelectorAll('.ruler-num')].find((x) => x.textContent === '12'); assert(lab, 'no 12 label');
      lab.click(); const inp = document.querySelector('.ruler-in'); inp.value = '5';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); await built(); noErr();
      assert(near(data(b).bbox[0][0] - data(a).bbox[1][0], 5), 'gap after typing ' + (data(b).bbox[0][0] - data(a).bbox[1][0]));
      B.vp.setRuler(false);
    });
    await t('align lines objects up', async () => {
      await fresh(); a = await add('box'); b = await add('box', { w: 10, d: 10, h: 40 }); await place(b, [37, 22, 5]);
      sel([a, b]); C.alignSel(0, -1); await built(); noErr();
      assert(near(data(a).bbox[0][0], data(b).bbox[0][0]), 'left sides ' + data(a).bbox[0][0] + ' ' + data(b).bbox[0][0]);
      C.alignSel(1, 0); await built(); assert(near(center(a)[1], center(b)[1]), 'centers');
      C.alignSel(2, 1); await built(); assert(near(data(a).bbox[1][2], data(b).bbox[1][2]), 'tops');
    });
    await t('align tool: dots, preview, first picked stays put', async () => {
      await fresh(); a = await add('box'); b = await add('box', { w: 10, d: 10, h: 40 });
      const pa = creator(a).pos; await place(b, [pa[0] + 37, pa[1] + 22, 5]);
      const a0 = JSON.stringify(data(a).bbox);
      sel([a, b]); C.startTool('align'); B.vp.render();
      const dots = document.querySelectorAll('.al-dot'); assert(dots.length === 9, 'dots ' + dots.length);
      const n0 = S.undoStack.length;
      dots[0].dispatchEvent(new MouseEvent('mouseenter')); assert(S.undoStack.length === n0, 'preview changed the project');
      dots[0].dispatchEvent(new MouseEvent('mouseleave'));
      dots[0].click(); await built(); noErr();
      assert(JSON.stringify(data(a).bbox) === a0, 'the first picked object moved');
      assert(near(data(b).bbox[0][0], data(a).bbox[0][0]), 'left sides not lined up');
      dots[8].click(); await built(); assert(near(data(b).bbox[1][2], data(a).bbox[1][2]), 'tops not lined up');
      assert(B.app.tool?.type === 'align', 'align closed after one click');
      C.endTool(); assert(!document.querySelector('.al-dot'), 'dots left after closing');
    });
    await t('About / Licenses lists every open-source part with its license text', async () => {
      const L = window.__3DJ_LICENSES; assert(L && L.credits.length >= 10, 'credits missing');
      for (const c of L.credits) assert((L.texts[c.file] || '').length > 300, 'license text missing for ' + c.name);
      assert(/LESSER GENERAL PUBLIC LICENSE/.test(L.texts['opencascade-LGPL-2.1.txt']), 'LGPL text');
      C.showAbout(); const n = document.querySelectorAll('.modal .lic').length; document.querySelector('.modal-back').remove();
      assert(n >= 11, 'about rows ' + n);
    });
    await t('the direction being worked on is green in the bar and on its arrows, the others blue (both ways)', async () => {
      const BLUE = ['rgb(30, 160, 255)', '#1ea0ff'], GREEN = ['rgb(126, 211, 33)', '#7ed321'];
      for (const mode of ['scale', 'translate']) {
        await fresh(); a = await add('box'); sel([a]); B.commands.setGizmo(mode); B.vp.setActiveAxis(null); B.vp.render();
        const arrows = () => B.vp.hudItems.filter((it) => ['face', 'lift', 'slide'].includes(it.data.type));
        const colorOf = (ax) => arrows().filter((it) => it.data.ax === ax).map((it) => it.el.style.color);
        assert(arrows().length === 6 && arrows().every((it) => BLUE.includes(it.el.style.color)), mode + ': not all blue at first');
        // clicking into the Z box: Z box and Z arrows green, the rest blue
        document.querySelectorAll('#objbar .bf input')[2].focus(); B.vp.render();
        assert(colorOf(2).length === 2 && colorOf(2).every((c) => GREEN.includes(c)), mode + ': Z arrows not green: ' + colorOf(2));
        assert([0, 1].every((ax) => colorOf(ax).every((c) => BLUE.includes(c))), mode + ': X/Y arrows not blue');
        assert(document.querySelectorAll('#objbar .bf')[2].classList.contains('on'), mode + ': Z box not green');
        document.activeElement.blur();
        // pressing an X arrow: X box and X arrows green, Z back to blue
        const xa = arrows().find((it) => it.data.ax === 0);
        xa.el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
        xa.el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 }));
        await sleep(50); B.vp.render();
        assert(!B.vp.handleDrag && !app.dragging, mode + ': the arrow press did not end');
        const bf = document.querySelectorAll('#objbar .bf');
        assert(bf[0].classList.contains('on') && !bf[2].classList.contains('on'), mode + ': X box did not turn green from its arrow');
        assert(colorOf(0).every((c) => GREEN.includes(c)) && colorOf(2).every((c) => BLUE.includes(c)), mode + ': arrow colours after pressing X: ' + colorOf(0) + ' / ' + colorOf(2));
      }
      B.commands.setGizmo('translate'); B.vp.setActiveAxis(null);
    });
    await t('parts: screws, nuts, bearings, pins, rods, magnets, standoffs', async () => {
      await fresh();
      for (const type of ['socket', 'button', 'flat', 'hex', 'set']) { const id = await add('screw', { ...C.presetFor('screw', { type, size: 'M3' }), len: 16 }); noErr(); assert(data(id).volume > 0, type + ' screw'); }
      const cap = await add('screw', { ...C.presetFor('screw', { type: 'socket', size: 'M3' }), len: 16 });
      assert(near(size(cap)[2], 19) && near(size(cap)[0], 5.5), 'M3x16 socket head size ' + size(cap));
      const flat = await add('screw', { ...C.presetFor('screw', { type: 'flat', size: 'M4' }), len: 20 });
      assert(near(size(flat)[2], 20) && near(size(flat)[0], 8.96), 'M4x20 flat head size ' + size(flat));
      for (const type of ['regular', 'nylock', 'thin']) { const id = await add('nut', C.presetFor('nut', { type, size: 'M5' })); noErr(); assert(data(id).volume > 0, type + ' nut'); }
      const nut = await add('nut', C.presetFor('nut', { type: 'regular', size: 'M3' }));
      assert(near(size(nut)[2], 2.4) && near(Math.min(size(nut)[0], size(nut)[1]), 5.5), 'M3 nut size ' + size(nut));
      const b608 = await add('bearing', C.presetFor('bearing', { size: '608' }));
      assert(near(size(b608)[0], 22) && near(size(b608)[2], 7), '608 size ' + size(b608));
      for (const k of ['F608', 'LM8UU']) { const id = await add('bearing', C.presetFor('bearing', { size: k })); noErr(); assert(data(id).volume > 0, k); }
      await add('pin', { d: 3, len: 12 }); await add('rod', { d: 8, len: 100 }); await add('magnet', { size: '6x3', d: 6, h: 3 });
      const st = await add('hexstandoff', { ...C.presetFor('hexstandoff', { size: 'M3' }), len: 10, male: true, stud: 6 });
      noErr(); assert(near(size(st)[2], 16), 'male standoff height ' + size(st));
    });
    await t('sketch: outlines with exact sizes, holes inside, made solid and editable', async () => {
      await fresh();
      let made = null;
      const k = C.openSketch([], (loops) => { made = loops; });
      await sleep(100);
      k.setTool('rect'); k.click([0, 0]); k.typedInput('60,40');
      k.setTool('circle'); k.click([15, 20]); k.typedInput('10');
      k.setTool('line'); k.click([35, 10]); k.typedInput('15,0'); k.typedInput('-8,20'); k.click([35, 10]);
      assert(k.loops.length === 3, 'loops ' + k.loops.length);
      k.finish(); assert(made && !document.querySelector('.sketch'), 'board did not close');
      a = await add('sketch', { loops: made, h: 8 }); noErr();
      const want = 60 * 40 * 8 - Math.PI * 25 * 8 - (15 * 20 / 2) * 8;
      assert(near(data(a).volume, want, 1), 'volume ' + data(a).volume + ' want ' + want);
      assert(near(size(a)[0], 60) && near(size(a)[1], 40) && near(size(a)[2], 8), 'size ' + size(a));
      // editing: change the circle's diameter
      S.commit((d) => { d.features.find((f) => f.body === a).p.loops[1].r = 8; }); await built(); noErr();
      assert(near(data(a).volume, 60 * 40 * 8 - Math.PI * 64 * 8 - 1200, 1), 'edited volume ' + data(a).volume);
    });
    await t('sketch: click a length to change it, flat/parallel, center and mirror', async () => {
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [60, 0], [60, 40], [0, 40]] }], () => {});
      await sleep(100); k.setTool('select');
      // click the bottom line's length label and type 80
      const lab = [...document.querySelectorAll('.sk-len')].find((t) => t.textContent === '60'); assert(lab, 'no length label');
      lab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(50);
      const inp = document.querySelector('.sk-ask'); assert(inp, 'no box to type in'); inp.value = '80';
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      const xs = k.loops[0].pts.map((p) => p[0]);
      assert(Math.max(...xs) === 80 && Math.min(...xs) === 0, 'stretched to ' + xs);
      k.pick(0); k.center(0); assert(Math.max(...k.loops[0].pts.map((p) => p[0])) === 40, 'not centered');
      // half outline with both ends on the center line, mirrored into a whole one
      k.loops.push({ type: 'poly', pts: [[0, 50], [10, 50], [10, 60], [0, 70]] }); k.pick(1); k.mirror(0);
      assert(k.loops[1].pts.length === 6 && k.loops[1].pts.some((p) => p[0] === -10), 'mirror ' + JSON.stringify(k.loops[1].pts));
      // a slanted line made flat
      k.loops.push({ type: 'poly', pts: [[100, 0], [120, 5], [110, 30]] }); k.pickEdge(2, 0); k.lineOp('flat');
      assert(k.loops[2].pts[1][1] === 0, 'not flat ' + k.loops[2].pts[1]);
      k.close();
    });
    await t('sketch: arcs, rounded corners and bent sides make the right solid', async () => {
      await fresh();
      // a 40 x 20 rectangle with every corner rounded 5
      let k = C.openSketch([], () => {}); await sleep(80);
      k.setTool('rect'); k.click([0, 0]); k.typedInput('40,20');
      for (let i = 0; i < 4; i++) k.setRound(0, i, 5);
      const rr = JSON.parse(JSON.stringify(k.loops)); k.close();
      a = await add('sketch', { loops: rr, h: 10 }); noErr();
      assert(near(data(a).volume, (800 - (4 - Math.PI) * 25) * 10, 2), 'rounded rect volume ' + data(a).volume);
      // a half circle drawn with Line then Arc (closing the outline with the arc)
      k = C.openSketch([], () => {}); await sleep(80);
      k.setTool('line'); k.click([0, 0]); k.click([20, 0]); k.setTool('arc'); k.click([0, 0]); k.click([10, 10]);
      assert(k.loops.length === 1 && k.loops[0].bulge, 'arc outline ' + JSON.stringify(k.loops));
      const half = JSON.parse(JSON.stringify(k.loops)); k.close();
      a = await add('sketch', { loops: half, h: 10 }); noErr();
      assert(near(data(a).volume, Math.PI * 100 / 2 * 10, 2), 'half circle volume ' + data(a).volume);
      // a straight side bent into a half circle
      k = C.openSketch([{ type: 'poly', pts: [[0, 0], [30, 0], [30, 10], [0, 10]] }], () => {}); await sleep(80);
      k.setBulge(0, 2, 1); const bent = JSON.parse(JSON.stringify(k.loops)); k.close();
      a = await add('sketch', { loops: bent, h: 1 }); noErr();
      assert(near(data(a).volume, 300 + Math.PI * 225 / 2, 1), 'bent side volume ' + data(a).volume);
    });
    await t('sketch: snaps to corners, middles and lined-up spots', async () => {
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 0], [40, 20], [0, 20]] }], () => {}); await sleep(80);
      const m = k.snapAt([20.15, 0.1]); assert(m.kind === 'middle' && m.p[0] === 20 && m.p[1] === 0, 'middle ' + JSON.stringify(m));
      const c = k.snapAt([39.9, 19.85]); assert(c.kind === 'corner' && c.p[0] === 40 && c.p[1] === 20, 'corner ' + JSON.stringify(c));
      const g = k.snapAt([40.1, 31.3]); assert(g.kind === 'guide' && g.p[0] === 40, 'guide ' + JSON.stringify(g));
      k.close();
    });
    await t('sketch: rules stay (flat, parallel, locked length) while points move', async () => {
      let out = null;
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 0], [40, 20], [0, 20]] }], (l, r) => { out = { l, r }; }); await sleep(80);
      k.pickEdge(0, 0); k.lineOp('flat');
      k.lineOp('parallel', { l: 0, i: 2 });
      k.setLength(0, 0, 50);
      const P = () => k.loops[0].pts;
      assert(near(Math.hypot(P()[1][0] - P()[0][0], P()[1][1] - P()[0][1]), 50, 1e-3), 'length ' + JSON.stringify(P()));
      k.movePoint(0, 1, [55, 7]);
      const d = (i, j) => Math.hypot(P()[j][0] - P()[i][0], P()[j][1] - P()[i][1]);
      assert(near(P()[0][1], P()[1][1], 1e-3), 'bottom not flat ' + JSON.stringify(P()));
      assert(near(d(0, 1), 50, 1e-3), 'length not kept ' + d(0, 1));
      const top = [P()[3][0] - P()[2][0], P()[3][1] - P()[2][1]];
      assert(Math.abs(top[1]) < 1e-3 * Math.hypot(...top), 'top not parallel ' + JSON.stringify(P()));
      k.finish(); assert(out && out.r.filter((r) => r.t !== 'anchor').length === 3, 'rules returned ' + JSON.stringify(out?.r));
    });
    await t('sketch: measure between any two points, radius and smooth join (Alex\'s bracket)', async () => {
      await fresh();
      let out = null;
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [85, 0], [85, 12], [62, 22], [62, 30], [40, 30], [10, 63], [0, 63]], bulge: [0, 0, 0, 0, 0, 0.3, 0, 0] }], (l, r) => { out = { l, r }; });
      await sleep(80);
      const P = (i) => k.loops[0].pts[i], O = { o: 1 }, pt = (i) => ({ l: 0, k: i });
      k.measureRule('dx', O, pt(1), 88); k.measureRule('dy', pt(1), pt(2), 10);
      k.addRule('flat', { l: 0, i: 0 }); k.addRule('upright', { l: 0, i: 7 }); k.addRule('upright', { l: 0, i: 1 });
      k.addRule('flat', { l: 0, i: 4 }); k.addRule('flat', { l: 0, i: 6 }); k.addRule('upright', { l: 0, i: 3 });
      k.measureRule('dy', O, pt(7), 65); k.measureRule('dx', O, pt(5), 42); k.measureRule('dx', O, pt(6), 9); k.measureRule('dx', pt(4), pt(5), 23);
      k.setRadius(0, 5, 33); k.smoothJoin(0, 6);
      const near2 = (p, q, tol = 0.01) => Math.abs(p[0] - q[0]) < tol && Math.abs(p[1] - q[1]) < tol;
      assert(near2(P(0), [0, 0]) && near2(P(1), [88, 0]) && near2(P(2), [88, 10]), 'base ' + JSON.stringify(k.loops[0].pts));
      assert(near(P(5)[0], 42, 0.01) && near(P(6)[0], 9, 0.01) && near(P(7)[1], 65, 0.01) && near(P(6)[1], 65, 0.01), 'arc ends ' + JSON.stringify(k.loops[0].pts));
      assert(near(P(4)[0] - P(5)[0], 23, 0.01), '23 ' + JSON.stringify(k.loops[0].pts));
      const L = k.loops[0], R = 33;
      // radius 33 and smooth into the flat top: the arc's center sits right under its top end
      const A = L.pts[5], B = L.pts[6], b = L.bulge[5];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]), rad = len * (1 + b * b) / (4 * Math.abs(b));
      assert(near(rad, R, 0.01), 'radius ' + rad);
      assert(near(A[1], 65 - 33, 0.02), 'arc end height (center under the top end) ' + A[1]);
      // helper line: never part of the solid
      k.setTool('helper'); k.click([0, 30]); k.click([88, 30]);
      assert(k.loops[1]?.type === 'line', 'helper line ' + JSON.stringify(k.loops[1]));
      k.measureRule('dy', O, { l: 1, k: 0 }, 20);
      assert(near(k.loops[1].pts[0][1], 20, 0.01), 'helper moved by its rule');
      k.finish(); assert(out && out.r.some((r) => r.t === 'dx') && out.r.some((r) => r.t === 'smooth'), 'rules kept');
      a = await add('sketch', { loops: out.l, rules: out.r, h: 5 }); noErr();
      const want = SG_area(out.l[0]) * 5;
      assert(near(data(a).volume, want, 5), 'volume ' + data(a).volume + ' want ' + want);
      assert(near(size(a)[0], 88, 0.05) && near(size(a)[1], 65, 0.05), 'size ' + size(a));
    });
    await t('sketch: Measure tool picks two points and offers the three distances', async () => {
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 0], [40, 20], [0, 20]] }], () => {}); await sleep(80);
      k.measurePick({ l: 0, k: 0 }, { l: 0, k: 2 });
      const box = document.querySelector('.sk-mchoose'); assert(box, 'no chooser');
      const texts = [...box.querySelectorAll('.chip')].map((b) => b.textContent);
      assert(texts.includes('↔ 40') && texts.includes('↕ 20'), 'choices ' + texts);
      [...box.querySelectorAll('.chip')].find((b) => b.textContent === '↔ 40').click(); await sleep(30);
      const inp = document.querySelector('.sk-ask'); inp.value = '50'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      assert(near(k.loops[0].pts[2][0] - k.loops[0].pts[0][0], 50, 0.01), 'set to 50 ' + JSON.stringify(k.loops[0].pts));
      assert(document.querySelectorAll('.sk-meas').length === 1, 'measurement shown ' + document.querySelectorAll('.sk-meas').length + ' ' + JSON.stringify(k.rules));
      k.close();
    });

    await t('sketch: snap onto lines, Shift for straight/45°, move helper lines that latch on', async () => {
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 0], [40, 20], [0, 20]] }], () => {}); await sleep(80);
      const e = k.snapAt([13.3, 20.15]); assert(e.kind === 'edge' && near(e.p[1], 20, 1e-6) && near(e.p[0], 13.3, 0.01), 'on line ' + JSON.stringify(e));
      const a0 = k.snapAt([10, 3.7], { shift: true, anchor: [0, 0] }); assert(a0.kind === 'angle' && a0.p[1] === 0 && a0.p[0] === 10, 'shift flat ' + JSON.stringify(a0));
      const a45 = k.snapAt([10, 9], { shift: true, anchor: [0, 0] }); assert(near(a45.p[0], a45.p[1], 1e-6) && a45.p[0] > 8, 'shift 45 ' + JSON.stringify(a45));
      const sq = k.snapAt([10, 4], { shift: true, anchor: [0, 0], diagonal: true }); assert(near(sq.p[0], sq.p[1], 1e-6), 'square ' + JSON.stringify(sq));
      k.setTool('helper'); k.click([5, 30]); k.click([35, 30]); k.setTool('select');
      assert(k.loops[1].type === 'line', 'helper');
      const latched = k.latchLine(1, [0, -9.8]);
      assert(latched === 'edge' && near(k.loops[1].pts[0][1], 20, 1e-6) && near(k.loops[1].pts[1][1], 20, 1e-6), 'latched onto the top side ' + JSON.stringify(k.loops[1].pts));
      const free = k.latchLine(1, [1.234, 3.5]);
      assert(!free && near(k.loops[1].pts[0][1], 23.5, 1e-6) && near(k.loops[1].pts[0][0], 6.234, 1e-6), 'free placement ' + JSON.stringify(k.loops[1].pts));
      k.close();
    });

    await t('sketch: helper lines stay attached and control the shape; straighten, center and pin', async () => {
      let k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 0], [40, 20], [0, 20]] }], () => {}); await sleep(80);
      // a helper line from the bottom side to the top side: both ends stay on those sides
      k.setTool('helper'); k.click([10.03, 0.05]); k.click([10.02, 19.96]); k.setTool('select');
      assert(k.rules.filter((r) => r.t === 'on').length === 2, 'attached ' + JSON.stringify(k.rules));
      k.addRule('flat', { l: 0, i: 0 }); k.addRule('flat', { l: 0, i: 2 }); k.addRule('upright', { l: 1, i: 0 });
      k.setLength(1, 0, 30);
      const P = () => k.loops[0].pts;
      assert(near(P()[2][1] - P()[1][1], 30, 0.01) && near(P()[3][1] - P()[0][1], 30, 0.01), 'helper set the height to 30 ' + JSON.stringify(P()));
      k.close();
      // a helper dragged onto a side latches and then follows it
      k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 0], [40, 20], [0, 20]] }, { type: 'line', pts: [[5, 25], [35, 25]] }], () => {}); await sleep(80);
      k.dragLine(1, [0, -4.8]);
      assert(near(k.loops[1].pts[0][1], 20, 1e-6) && k.rules.filter((r) => r.t === 'on').length === 2, 'latched ' + JSON.stringify(k.loops[1].pts) + JSON.stringify(k.rules));
      k.movePoint(0, 2, [40, 26]); k.movePoint(0, 3, [0, 26]);
      assert(near(k.loops[1].pts[0][1], 26, 0.01) && near(k.loops[1].pts[1][1], 26, 0.01), 'helper followed the side ' + JSON.stringify(k.loops[1].pts));
      k.close();
      // straighten a turned drawing, move a corner to the center, pin a point
      const a = 10 * Math.PI / 180, R = ([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
      k = C.openSketch([{ type: 'poly', pts: [[5, 5], [45, 5], [45, 25], [5, 25]].map(R) }], () => {}); await sleep(80);
      k.straighten(0, 0); assert(near(k.loops[0].pts[0][1], k.loops[0].pts[1][1], 1e-3) && near(k.loops[0].pts[1][0], k.loops[0].pts[2][0], 1e-3), 'straight ' + JSON.stringify(k.loops[0].pts));
      k.moveToCenter(0, 0); assert(near(k.loops[0].pts[0][0], 0, 1e-6) && near(k.loops[0].pts[0][1], 0, 1e-6), 'centered ' + JSON.stringify(k.loops[0].pts));
      // to the right of the green line, even with a measurement from the center of the sketch
      k.measureRule('dx', { o: 1 }, { l: 0, k: 1 }, 30);
      k.toGreenLine(); const xs = k.loops[0].pts.map((p) => p[0]);
      assert(near(Math.min(...xs), 0, 1e-6) && Math.max(...xs) > 39, 'right of green line ' + JSON.stringify(k.loops[0].pts));
      k.moveToCenter(0, 0);
      k.togglePin(0, 0); k.addRule('flat', { l: 0, i: 0 });
      k.movePoint(0, 1, [50, 7]);
      assert(near(k.loops[0].pts[0][0], 0, 1e-3) && near(k.loops[0].pts[0][1], 0, 1e-3), 'pinned point moved ' + JSON.stringify(k.loops[0].pts));
      k.close();
    });

    await t('sketch: the starting point stays locked while rules move other things', async () => {
      let k = C.openSketch([], () => {}); await sleep(80);
      k.setTool('line'); k.click([12, 7]); k.click([52, 9]); k.click([50, 30]); k.click([12, 7]);
      assert(k.rules.some((r) => r.t === 'anchor' && r.p.l === 0 && r.p.k === 0), 'starting point lock ' + JSON.stringify(k.rules));
      k.addRule('flat', { l: 0, i: 0 }); k.addRule('upright', { l: 0, i: 1 }); k.setLength(0, 0, 30);
      const P = k.loops[0].pts;
      assert(near(P[0][0], 12, 1e-6) && near(P[0][1], 7, 1e-6), 'start moved ' + JSON.stringify(P));
      assert(near(P[1][1], 7, 1e-3) && near(P[1][0], 42, 1e-3) && near(P[2][0], 42, 1e-3), 'rules held ' + JSON.stringify(P));
      // a size you set from the center of the sketch may still move it
      k.measureRule('dx', { o: 1 }, { l: 0, k: 0 }, 5);
      assert(near(P[0][0], 5, 1e-3), 'start follows a rule you set ' + JSON.stringify(P));
      // unlocked: rules may move it
      k.toggleAnchor(); assert(k.rules.find((r) => r.t === 'anchor').off, 'unlock');
      k.close();
    });
    await t('sketch: Rules row (flat, parallel, square, same size, touch, join, mirror pair, angle, size, freeze)', async () => {
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 2], [42, 20], [-1, 22]] }, { type: 'circle', c: [60, 10], r: 4 }, { type: 'circle', c: [80, 10], r: 6 }, { type: 'line', pts: [[0, 40], [40, 47]] }], () => {});
      await sleep(80);
      const L = k.loops, P = L[0].pts, side = (i) => ({ l: 0, i });
      const ang = (A, B) => Math.atan2(B[1] - A[1], B[0] - A[0]) * 180 / Math.PI;
      // pick first, then click the rule
      k.pickItems([side(0)]); k.pressRule('flat'); assert(near(P[0][1], P[1][1], 1e-3), 'flat ' + JSON.stringify(P));
      k.pickItems([side(0), side(2)]); k.pressRule('parallel'); assert(near(P[2][1], P[3][1], 1e-3), 'parallel ' + JSON.stringify(P));
      // click the rule first, then the lines (it waits)
      k.pickItems([]); k.pressRule('square'); assert(k.ruleWait === 'square', 'waiting');
      k.clickPick(side(0)); assert(k.ruleWait === 'square', 'still waiting for the second line');
      k.clickPick(side(1)); assert(!k.ruleWait, 'made');
      const a01 = ang(P[0], P[1]) - ang(P[1], P[2]); assert(near(Math.abs(a01), 90, 1e-2), 'square ' + a01);
      k.pickItems([side(0), side(1)]); k.pressRule('equal'); const len = (i, j) => Math.hypot(P[j][0] - P[i][0], P[j][1] - P[i][1]);
      assert(near(len(0, 1), len(1, 2), 1e-3), 'same length ' + len(0, 1) + ' ' + len(1, 2));
      k.pickItems([{ l: 1, circle: 1 }, { l: 2, circle: 1 }]); k.pressRule('equal'); assert(near(L[1].r, L[2].r, 1e-3), 'same size circles ' + L[1].r + ' ' + L[2].r);
      k.pickItems([{ l: 1, circle: 1 }, { l: 2, circle: 1 }]); k.pressRule('tangent');
      assert(near(Math.hypot(L[1].c[0] - L[2].c[0], L[1].c[1] - L[2].c[1]), L[1].r + L[2].r, 1e-3), 'circles touch');
      // the helper line touches circle 1
      k.pickItems([{ l: 3, i: 0 }, { l: 1, circle: 1 }]); k.pressRule('tangent');
      const [A, B] = L[3].pts, d = [B[0] - A[0], B[1] - A[1]], dl = Math.hypot(...d);
      assert(near(Math.abs(((L[1].c[0] - A[0]) * d[1] - (L[1].c[1] - A[1]) * d[0]) / dl), L[1].r, 1e-3), 'line touches circle');
      // join the helper line's end onto the outline's corner
      k.pickItems([{ pt: 1, l: 3, k: 0 }, { pt: 1, l: 0, k: 3 }]); k.pressRule('join');
      assert(near(L[3].pts[0][0], P[3][0], 1e-3) && near(L[3].pts[0][1], P[3][1], 1e-3), 'joined ' + JSON.stringify(L[3].pts));
      // mirror pair: the two circle centers across the green line (a chooser asks which line)
      k.pickItems([{ pt: 1, l: 1, k: 0 }, { pt: 1, l: 2, k: 0 }]); k.pressRule('sym');
      const ch = [...document.querySelectorAll('.sk-mchoose .chip')].find((b) => b.textContent.includes('Green')); assert(ch, 'mirror chooser'); ch.click();
      assert(near(L[1].c[0], -L[2].c[0], 1e-3) && near(L[1].c[1], L[2].c[1], 1e-3), 'mirror pair ' + JSON.stringify([L[1].c, L[2].c]));
      // angle of the helper line: 30° from level
      L.push({ type: 'line', pts: [[100, 0], [130, 10]] });
      k.pickItems([{ l: 4, i: 0 }]); k.pressRule('angle');
      let inp = document.querySelector('.sk-ask'); assert(inp, 'angle box'); inp.value = '30'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      assert(near(ang(L[4].pts[0], L[4].pts[1]), 30, 1e-2), 'angle ' + ang(L[4].pts[0], L[4].pts[1]));
      // and between two lines: the helper line at 90° to the outline's bottom
      L.push({ type: 'line', pts: [[100, 20], [130, 25]] });
      k.pickItems([{ l: 0, i: 0 }, { l: 5, i: 0 }]); k.pressRule('angle');
      inp = document.querySelector('.sk-ask'); inp.value = '45'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      assert(near(Math.abs(ang(L[5].pts[0], L[5].pts[1]) - ang(P[0], P[1])), 45, 1e-2), 'angle between ' + ang(L[5].pts[0], L[5].pts[1]));
      // size of circle 2: diameter 10, and it stays
      k.pickItems([{ l: 2, circle: 1 }]); k.pressRule('size');
      inp = document.querySelector('.sk-ask'); inp.value = '10'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      assert(near(L[2].r, 5, 1e-3) && near(L[1].r, 5, 1e-3), 'diameter 10 (and the same-size circle followed) ' + L[1].r + ' ' + L[2].r);
      assert(k.rules.some((r) => r.t === 'diam'), 'diameter rule');
      // freeze the outline: a rule that would move it moves the other thing instead
      const before = JSON.stringify(P);
      k.pickItems([{ l: 0, shape: 1 }]); k.pressRule('freeze'); assert(k.rules.some((r) => r.t === 'freeze'), 'frozen');
      k.pickItems([{ pt: 1, l: 1, k: 0 }, { l: 0, i: 1 }]); k.pressRule('join');
      assert(JSON.stringify(P) === before, 'frozen outline moved ' + before + ' -> ' + JSON.stringify(P));
      // buttons that do not fit what is picked are greyed out
      k.pickItems([{ l: 1, circle: 1 }]); assert(document.querySelector('.sk-rb[data-rule="parallel"]').classList.contains('off'), 'parallel greyed for a circle');
      // every rule shows a badge on the drawing; clicking one offers to remove it
      const n0 = k.rules.length, bd = document.querySelector('.sk-badge'); assert(bd, 'badges');
      bd.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await sleep(20);
      const rm = [...document.querySelectorAll('.sk-mchoose .chip')].find((b) => /Remove|Unlock/.test(b.textContent)); assert(rm, 'badge menu'); rm.click();
      assert(k.rules.length === n0 || k.rules.some((r) => r.off), 'badge removed/unlocked a rule');
      k.close();
    });
    await t('sketch: fully locked turns green; a size can just show instead of holding', async () => {
      const k = C.openSketch([{ type: 'poly', pts: [[0, 0], [40, 0], [40, 20], [0, 20]] }], () => {}); await sleep(80);
      assert(k.analyze().free === 6, 'free at start ' + k.analyze().free + JSON.stringify(k.rules) + document.querySelectorAll('.sketch').length);
      k.addRule('flat', { l: 0, i: 0 }); k.addRule('flat', { l: 0, i: 2 }); k.addRule('upright', { l: 0, i: 1 }); k.addRule('upright', { l: 0, i: 3 });
      assert(k.analyze().free === 2, 'free with flat/upright ' + k.analyze().free);
      k.setLength(0, 0, 40); k.setLength(0, 1, 20);
      assert(k.analyze().free === 0, 'free when locked ' + k.analyze().free);
      await sleep(20);
      assert(document.querySelector('.sk-status.done'), 'status says fully locked: ' + document.querySelector('.sk-status')?.textContent);
      assert(document.querySelectorAll('.sk-locked').length === 4, 'green sides ' + document.querySelectorAll('.sk-locked').length);
      // the 20 just shows: dragging the top changes it, and the number follows
      const ri = k.rules.findIndex((r) => r.t === 'length' && r.a.i === 1);
      k.setShowing(ri, true); assert(k.analyze().free === 1, 'free with a shown size ' + k.analyze().free);
      k.movePoint(0, 2, [40, 26]);
      assert(near(k.loops[0].pts[2][1], 26, 1e-3) && near(k.loops[0].pts[3][1], 26, 1e-3), 'moved ' + JSON.stringify(k.loops[0].pts));
      assert(near(k.rules[ri].v, 26, 1e-3), 'shown size follows ' + k.rules[ri].v);
      k.close();
    });
    await t('sketch: live mirror draws the other side too', async () => {
      const k = C.openSketch([], () => {}); await sleep(80);
      k.setLiveMirror(0); k.setTool('line');
      k.click([0, 0]); k.click([10, 0]); k.click([10, 10]); k.click([0, 10]); k.click([0, 0]);
      assert(k.loops.length === 1 && k.loops[0].pts.length === 6 && k.loops[0].pts.some((p) => p[0] === -10), 'whole outline ' + JSON.stringify(k.loops));
      k.setTool('circle'); k.click([15, 5]); k.typedInput('4');
      assert(k.loops.length === 3 && k.loops[2].type === 'circle' && k.loops[2].c[0] === -15, 'mirrored circle ' + JSON.stringify(k.loops));
      k.setTool('rect'); k.click([-5, 20]); k.typedInput('10,5');
      assert(k.loops.length === 4, 'symmetric rectangle not doubled ' + k.loops.length);
      k.close();
    });
    await t('sketch: loft and sweep', async () => {
      await fresh();
      a = await add('sketch', { mode: 'loft', h: 20, loops: [{ type: 'poly', pts: [[-10, -10], [10, -10], [10, 10], [-10, 10]] }, { type: 'circle', c: [0, 0], r: 5 }] }); noErr();
      assert(near(size(a)[2], 20, 0.01) && data(a).volume > Math.PI * 25 * 20 && data(a).volume < 8000, 'loft ' + size(a) + ' ' + data(a).volume);
      const b = await add('sketch', { mode: 'sweep', loops: [{ type: 'circle', c: [0, 0], r: 2 }, { type: 'line', pts: [[0, 0], [30, 0]] }, { type: 'line', pts: [[30, 0], [30, 30]] }] }); noErr();
      const v = data(b).volume; assert(v > Math.PI * 4 * 50 && v < Math.PI * 4 * 62, 'sweep volume ' + v);
      assert(near(size(b)[0], 32, 0.2) && near(size(b)[1], 32, 0.2) && near(size(b)[2], 4, 0.05), 'sweep size ' + size(b));
    });
    await t('3D: dragged objects snap onto hole centers and line up with other objects', async () => {
      await fresh();
      const plate = await add('box', { w: 40, d: 40, h: 5 }); await place(plate, [0, 0, 0]);
      const hole = await add('cyl', { d: 6, h: 20 }); await place(hole, [10, 5, -5]);
      sel([plate, hole]); C.combine('subtract'); await built();
      const pin = await add('cyl', { d: 6, h: 10 }); await place(pin, [60, 30, 0]);
      const vp = B.vp; const z0 = data(pin).bbox[0][2];
      const d = vp.snapToObjects([pin], new B.vp.camera.position.constructor(10.2 - 60, 5.15 - 30, 0), [0, 1]);
      assert(near(60 + d.x, 10, 1e-6) && near(30 + d.y, 5, 1e-6), 'onto hole center ' + d.toArray());
      const free = vp.snapToObjects([pin], new B.vp.camera.position.constructor(10.2 - 60, 5.15 - 30, 0), [0, 1], true);
      assert(near(free.x, 10.2 - 60, 1e-9), 'Alt: no snapping');
      vp.setSnapGuides(null); noErr();
    });

    await t('Help tab shows the picture guide below the tab bar', async () => {
      const tab = (n) => [...document.querySelectorAll('#tabbar .tab')].find((b) => b.textContent === n);
      tab('Help').click(); await sleep(100);
      const v = document.getElementById('helpview'); assert(v, 'no help view');
      assert(v.querySelectorAll('.help-section').length >= 5 && v.querySelectorAll('.help-link').length >= 2, 'chapters ' + v.querySelectorAll('.help-section').length + ', pages ' + v.querySelectorAll('.help-link').length);
      assert([...v.querySelectorAll('.help-body img')].every((i) => i.src.startsWith('data:image')), 'pictures built in');
      tab('Insert').click(); await sleep(50);
      assert(!document.getElementById('helpview') && !document.body.classList.contains('help-docked'), 'help stayed on screen after leaving the Help tab without Keep visible');
      tab('Help').click(); await sleep(100);
      [...document.querySelectorAll('#helpview button')].find((b) => b.textContent === 'Keep visible').click(); await sleep(50);
      assert(document.getElementById('helpview')?.classList.contains('docked'), 'Keep visible did not keep help beside the model');
      tab('Object').click(); await sleep(50);
      assert(document.getElementById('helpview')?.classList.contains('docked'), 'kept help went away on another tab');
      document.querySelector('[aria-label="Close Help"]').click();
      assert(!document.getElementById('helpview'), 'help did not close');
    });

    await t('sketch: spin around makes a round solid; a part turn makes part of it', async () => {
      await fresh();
      const L = [{ type: 'poly', pts: [[0, 0], [10, 0], [10, 20], [0, 20]] }];
      a = await add('sketch', { loops: L, mode: 'revolve', angle: 360 }); noErr();
      assert(near(data(a).volume, Math.PI * 100 * 20, 3), 'revolve volume ' + data(a).volume);
      assert(near(size(a)[0], 20) && near(size(a)[2], 20), 'revolve size ' + size(a));
      const b = await add('sketch', { loops: L, mode: 'revolve', angle: 180 }); noErr();
      // a hair over the green line (a slightly turned drawing) still spins
      const c = await add('sketch', { loops: [{ type: 'poly', pts: [[-0.02, 0], [10, 0], [10, 20], [-0.01, 20]] }], mode: 'revolve', angle: 360 }); noErr();
      assert(near(data(c).volume, Math.PI * 100 * 20, 3), 'trimmed revolve ' + data(c).volume);
      assert(near(data(b).volume, Math.PI * 100 * 10, 3), 'half turn volume ' + data(b).volume);
    });
    await t('sketch: cut a hole from the floor, and a pocket into a face', async () => {
      await fresh();
      const box = await add('box', { w: 40, d: 40, h: 10 }); await place(box, [0, 0, 0]);
      const v0 = data(box).volume;
      const waitVol = async (id, cond) => { for (let i = 0; i < 100; i++) { await built(); const d = data(id); if (d && cond(d.volume)) return true; await sleep(50); } return false; };
      C.createSketch([{ type: 'circle', c: [0, 0], r: 5 }], [], { mode: 'extrude', h: 20, cut: true }, null);
      assert(await waitVol(box, (v) => v < v0 - 100), 'floor cut did not happen ' + data(box)?.volume);
      assert(near(data(box).volume, v0 - Math.PI * 25 * 10, 2), 'floor hole volume ' + data(box).volume);
      const v1 = data(box).volume;
      const top = faceIndex(box, [0, 0, 1]); assert(top >= 0, 'no top face');
      const f = data(box).faces;
      const wp = { P: Array.from(f.subarray(top * 6, top * 6 + 3)), n: [0, 0, 1], size: 60, body: box, face: top };
      C.setWorkplane(wp);
      // the board shows the face's edges to draw against
      C.startSketch();
      let refs = 0; for (let i = 0; i < 40 && !refs; i++) { await sleep(50); refs = document.querySelectorAll('.sketch .sk-ref').length; }
      [...document.querySelectorAll('.sketch .btn')].find((b) => b.textContent === 'Cancel')?.click();
      assert(!document.querySelector('.sketch'), 'board still open');
      assert(refs >= 2, 'face edges shown: ' + refs);
      C.createSketch([{ type: 'circle', c: [12, 0], r: 3 }], [], { mode: 'extrude', h: 4, cut: true }, wp);
      C.setWorkplane(null);
      assert(await waitVol(box, (v) => v < v1 - 50), 'face cut did not happen ' + data(box)?.volume);
      assert(near(data(box).volume, v1 - Math.PI * 9 * 4, 2), 'pocket volume ' + data(box).volume);
      noErr();
    });
    await t('look at face turns the view straight at it', async () => {
      await built(); await sleep(400); await built();
      const id = bodies()[0]; const top = faceIndex(id, [0, 0, 1]);
      const cam0 = B.vp.camera.position.clone(), tg0 = B.vp.orbit.target.clone();
      C.startTool('lookat'); assert(B.app.tool?.type === 'lookat', 'tool ' + B.app.tool?.type);
      C.toolPick('face', { body: id, index: top }); assert(B.vp.anim, 'no camera move');
      const trace = []; let v;
      for (let i = 0; i < 100; i++) { await sleep(60); v = B.vp.camera.position.clone().sub(B.vp.orbit.target).normalize(); trace.push(`${!!B.vp.anim}:${v.z.toFixed(2)}`); if (v.z > 0.999 && !B.vp.anim) break; }
      B.vp.camera.position.copy(cam0); B.vp.orbit.target.copy(tg0); B.vp.orbit.update(); B.vp.requestRender();
      assert(v.z > 0.999, 'view direction ' + v.toArray() + ' ' + trace.join(' ') + ' top ' + top + ' id ' + id);
    });

    await t('fillet: slider shows the rounding live, one undo per drag', async () => {
      await fresh(); a = await add('box', { w: 30, d: 30, h: 20 }); sel([a]);
      C.startTool('fillet'); C.quickEdges('top'); C.applyTool(); await built(); noErr();
      const sl = document.querySelector('#side .fslider'); assert(sl, 'no slider on the fillet step');
      const v0 = data(a).volume, n0 = S.undoStack.length;
      sl.value = '6'; sl.dispatchEvent(new Event('input')); await built();
      assert(data(a).volume < v0 - 50, 'no live change ' + data(a).volume + ' vs ' + v0);
      assert(document.querySelector('#side .fslider') === sl, 'slider was redrawn while dragging');
      sl.dispatchEvent(new Event('change')); await built();
      assert(S.undoStack.length === n0 + 1, 'undo steps ' + (S.undoStack.length - n0));
      assert(S.doc.features.find((f) => f.type === 'fillet').r === 6, 'radius not saved');
    });
    await t('fillet: slider previews live even before Apply', async () => {
      await fresh(); a = await add('box', { w: 30, d: 30, h: 20 }); sel([a]);
      C.startTool('fillet'); C.quickEdges('top'); await sleep(50);
      const sl = document.querySelector('#side .fslider'); assert(sl, 'no slider in the tool');
      const v0 = data(a).volume, n0 = S.undoStack.length;
      sl.value = '5'; sl.dispatchEvent(new Event('input')); await built();
      assert(data(a).volume < v0 - 50, 'no preview before Apply');
      sl.dispatchEvent(new Event('change')); await built();
      assert(!B.app.tool && S.doc.features.filter((f) => f.type === 'fillet').length === 1, 'step not kept once');
      assert(S.undoStack.length === n0 + 1, 'undo steps ' + (S.undoStack.length - n0));
    });
    await t('center on another object; sliders on shape sizes', async () => {
      await fresh(); a = await add('box', { w: 60, d: 40, h: 10 }); b = await add('cyl', { d: 10, h: 30 });
      sel([a, b]); C.centerOn([0, 1]); await built(); noErr();
      assert(near(center(b)[0], center(a)[0]) && near(center(b)[1], center(a)[1]), 'not centered ' + center(b) + ' vs ' + center(a));
      sel([a]); C.openPanel('props'); await sleep(100);
      assert(document.querySelectorAll('#side .fslider').length >= 3, 'size sliders missing');
    });
    await t('repeat duplicate repeats the last move', async () => {
      await fresh(); a = await add('box'); sel([a]); C.duplicateSel(); await built();
      const p0 = creator(a).pos, a0 = center(a);
      const c1 = B.app.sel[0]; await place(c1, [p0[0], p0[1] + 30, p0[2]]);
      sel([c1]); C.duplicateSel(); await built(); const c2 = B.app.sel[0];
      assert(near(center(c2)[1], a0[1] + 60) && near(center(c2)[0], a0[0]), 'second copy at ' + center(c2));
      C.duplicateSel(); await built(); assert(near(center(B.app.sel[0])[1], a0[1] + 90), 'third copy at ' + center(B.app.sel[0]));
    });
    await t('view: display modes and flat view', async () => {
      await fresh(); a = await add('box');
      for (const m of ['wire', 'see', 'xray', 'solid']) { B.vp.setDisplay(m); B.vp.render(); }
      const e = B.vp.bodies.get(a); assert(!e.mesh.material.transparent && e.mirror.visible, 'solid not restored');
      const wpp = B.vp.worldPerPixel(); B.vp.setFlat(true); B.vp.render();
      assert(Math.abs(B.vp.worldPerPixel() / wpp - 1) < 0.02, 'flat view changed the zoom ' + B.vp.worldPerPixel() / wpp);
      B.vp.setFlat(false); assert(B.vp.camera.fov === 32, 'perspective not restored');
    });
    await t('My parts: save an object and add it to another project', async () => {
      await fresh(); S.commit((d) => { d.vars.push({ name: 'w', expr: '40' }); });
      a = await add('box', { w: 'w', d: 40, h: 10 }); b = await add('cyl', { d: 10, h: 30 }); await place(b, [0, 0, -5]);
      sel([a, b]); C.combine('subtract'); await built();
      await C.insertFile(new File([stlBytes], 'knob.stl')); await built();
      const knob = B.app.sel[0];
      // a part saved the old way (inside the browser) moves into the folder when the folder is set up
      await C.idb.put('kv', [{ name: 'Old part', saved: 1, root: 'b1', features: [{ id: 'f1', type: 'shape', body: 'b1', kind: 'box', p: { w: 5, d: 5, h: 5 }, pos: [0, 0, 0], rot: [0, 0, 0] }], bodies: { b1: { name: 'Old part', color: '#22B14C' } }, vars: [], files: {}, bbox: [[-2.5, -2.5, 0], [2.5, 2.5, 5]] }], 'myParts');
      // a stand-in for a folder on the PC (pages opened from a file can't use the browser's own folders)
      const fakeDir = (name) => {
        const files = new Map(), dirs = new Map();
        return { kind: 'directory', name, files,
          async getDirectoryHandle(n) { if (!dirs.has(n)) dirs.set(n, fakeDir(n)); return dirs.get(n); },
          async getFileHandle(n, o) {
            if (!files.has(n) && !o?.create) throw new Error('missing');
            return { kind: 'file', getFile: async () => new File([files.get(n) || new Uint8Array()], n), createWritable: async () => { let buf; return { write: async (b) => { buf = b; }, close: async () => { files.set(n, buf); } }; } };
          },
          async* entries() { for (const n of files.keys()) yield [n, await this.getFileHandle(n)]; },
          async removeEntry(n) { files.delete(n); } };
      };
      const dir = await C.usePartsFolder(fakeDir('3D Objects'));
      await C.saveToMyParts(a); await C.saveToMyParts(knob);
      const names = []; for await (const [n] of dir.entries()) names.push(n);
      assert(names.includes(S.doc.bodies[a].name + '.3dj') && names.includes('Old part.3dj'), 'files in the folder: ' + names);
      const parts = (await C.loadMyParts()).filter((p) => p.name !== 'Old part');
      assert(parts.some((p) => p.name === S.doc.bodies[a].name), 'not saved');
      await fresh(); S.commit((d) => { d.vars.push({ name: 'w', expr: '99' }); }); await built();
      for (const p of parts) { C.insertMyPart(p.part); await built(); }
      noErr(); assert(bodies().length === 2, 'inserted ' + bodies().length);
      const boxId = bodies().find((id) => data(id).solid);
      assert(near(size(boxId)[0], 40) && data(boxId).volume < 16000 - 700, 'part not rebuilt right ' + size(boxId));
      assert(S.doc.vars.some((v) => v.name === 'w_2' && v.expr === '40'), 'variable clash not handled');
      assert(near(data(boxId).bbox[0][2], 0), 'not on the floor');
    });
    await t('imported files get unique names on open', async () => {
      const bytes = await C.buildFileData('3dj');
      await C.openFile(new File([bytes], 'a.3dj'), null); await built(); const f1 = S.doc.features.find((f) => f.kind === 'import').p.file;
      await C.openFile(new File([bytes], 'b.3dj'), null); await built(); const f2 = S.doc.features.find((f) => f.kind === 'import').p.file;
      noErr(); assert(f1 !== f2 && f1.startsWith('file-'), `names ${f1} ${f2}`);
    });
    await t('Z shows the middle of the object, like 3D Builder (bar and Properties)', async () => {
      await fresh();
      const id = await add('box', { w: 20, d: 20, h: 20 });
      C.setGizmo('translate'); sel([id]); C.openPanel('props'); C.renderAll(); await sleep(50);
      const barZ = () => parseFloat(document.querySelectorAll('#objbar input.bv')[2].value);
      const propZ = () => document.querySelector('input[aria-label="Position of the middle (mm) Z"]');
      assert(near(barZ(), 10), 'bar Z ' + barZ());
      assert(near(parseFloat(propZ().value), 10), 'props Z ' + propZ().value);
      // typing the middle in Properties puts the bottom half a height lower
      const inp = propZ(); inp.value = '30'; inp.dispatchEvent(new Event('blur')); await built();
      assert(near(center(id)[2], 20), 'bottom after props ' + center(id)[2]);
      assert(near(creator(id).pos[2], 20), 'stored bottom ' + creator(id).pos[2]);
      // the bar does the same
      C.barCommit(2, '10'); await built();
      assert(near(center(id)[2], 0), 'bottom after bar ' + center(id)[2]);
      // making it taller keeps it on the floor; the middle goes up
      S.commit((d) => { d.features.find((f) => f.type === 'shape' && f.body === id).p.h = 40; }); await built(); C.renderAll(); await sleep(50);
      assert(near(center(id)[2], 0) && near(barZ(), 20) && near(parseFloat(propZ().value), 20), 'after taller ' + barZ() + ' ' + propZ().value);
      noErr();
    });

    await t('background backup is written', async () => {
      await fresh(); await add('box'); await sleep(3500);
      const db = await new Promise((res, rej) => { const r = indexedDB.open('3djames'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const cur = await new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get('current'); q.onsuccess = () => res(q.result); });
      db.close(); assert(cur && JSON.parse(cur).features.length === 1, 'no current backup');
    });
    return results;
  };

  let hid = null;
  window.__handleSetup = async () => {
    await fresh(); hid = await add('box', { w: 40, d: 10, h: 10 }); sel([hid]); C.setGizmo('translate');
    B.vp.anim = null; B.vp.view('home', false); B.vp.view('selection', false); B.vp.camera.position.multiplyScalar(1.6); B.vp.orbit.update(); B.vp.requestRender(); await sleep(1500);
  };
  window.__h = () => { const b = data(hid).bbox; return { x: (b[0][0] + b[1][0]) / 2, y: (b[0][1] + b[1][1]) / 2, z: b[0][2], w: b[1][0] - b[0][0], turned: Math.abs((b[1][1] - b[0][1]) - 10) > 1 || Math.abs((b[1][2] - b[0][2]) - 10) > 1 }; };
  let snapIds = null;
  window.__snapSetup = async () => {
    await fresh(); const a1 = await add('box'); const b1 = await add('box'); await place(b1, [21.3, 0, 0]);
    sel([]); B.vp.view('home', false); B.vp.anim = null; await sleep(400);
    snapIds = [a1, b1];
    const v = B.vp; const r = v.renderer.domElement.getBoundingClientRect();
    const scr = (p) => { const q = p.clone().project(v.camera); return [r.left + (q.x + 1) / 2 * r.width, r.top + (1 - q.y) / 2 * r.height]; };
    const c = v.selectionBox([b1]).getCenter(v.camera.position.clone()); c.z = 10;
    const c2 = c.clone(); c2.x -= 1;
    return { at: scr(c), to: scr(c2) };
  };
  window.__snapGap = () => data(snapIds[1]).bbox[0][0] - data(snapIds[0]).bbox[1][0];
  let mouse = {};
  window.__mouseSetup = async () => {
    await fresh(); const id = await add('box'); sel([]); B.app.sel = []; B.vp.setSelection([]);
    await sleep(600);
    const v = B.vp; v.anim = null; v.camera.position.sub(v.orbit.target).multiplyScalar(6).add(v.orbit.target); v.orbit.update(); v.requestRender();
    await sleep(300);
    const c = v.selectionBox([id]).getCenter(v.camera.position.clone()).project(v.camera);
    const r = v.renderer.domElement.getBoundingClientRect();
    mouse = { id, dist: v.camera.position.distanceTo(v.orbit.target) };
    return { dbl: [r.left + (c.x + 1) / 2 * r.width, r.top + (1 - c.y) / 2 * r.height] };
  };
  window.__mouseCheck = async () => {
    const out = [];
    const d = B.vp.camera.position.distanceTo(B.vp.orbit.target);
    out.push({ name: 'double-click selects and flies in', ok: B.app.sel[0] === mouse.id && d < mouse.dist * 0.6, msg: `sel ${B.app.sel} dist ${mouse.dist.toFixed(0)} -> ${d.toFixed(0)}` });
    return out;
  };
})();

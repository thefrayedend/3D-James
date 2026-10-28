window.__runFeatureTests = async () => {
  const { app, store: S, commands: C, vp } = window.__3dj;
  const results = [];
  const assert = (v, msg) => { if (!v) throw new Error(msg); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const built = async () => {
    const deadline = Date.now() + 120000;
    while (app.building || app.pending || app.builtRevision !== S.revision) {
      if (app.engineError) throw new Error(app.engineError);
      if (Date.now() > deadline) throw new Error('build timed out'); await sleep(20);
    }
  };
  const test = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, message: e.message }); }
    console.log('TEST ' + (results.at(-1).ok ? 'PASS ' : 'FAIL ') + name);
  };
  const fresh = async (p = {}) => { C.newProject(); await built(); const id = C.addShape('box', { w: 60, d: 40, h: 10, ...p }); await built(); app.sel = [id]; vp.setSelection([id]); return id; };
  const body = (id) => app.results.bodies.get(id);
  const noErr = () => assert(!Object.keys(app.results.errors).length, JSON.stringify(app.results.errors));
  const top = (id) => {
    const d = body(id);
    for (let i = 0; i < d.faces.length / 6; i++) if (d.flat[i] && d.faces[i * 6 + 5] > 0.99) return i;
    throw new Error('top face missing');
  };
  const emboss = async (id, values) => {
    C.startTool('emboss'); C.toolPick('face', { body: id, index: top(id) });
    Object.assign(app.tool, values); C.applyTool(); await built(); noErr();
  };
  await test('raised text emboss increases solid volume and stays editable', async () => {
    const id = await fresh(), before = body(id).volume;
    await emboss(id, { text: 'HI', size: 8, depth: 1 });
    assert(body(id).solid && body(id).volume > before + 1, 'text did not add material');
    const feature = S.doc.features.at(-1); assert(feature.type === 'emboss' && feature.text === 'HI', 'emboss feature not saved');
    C.editStep(feature.id); C.openPanel('props'); assert(document.querySelector('#props input'), 'emboss editor missing');
    S.undo(); await built(); assert(Math.abs(body(id).volume - before) < 0.01, 'emboss undo failed');
    S.redo(); await built(); noErr(); assert(body(id).volume > before, 'emboss redo failed');
  });
  await test('engraved text removes material and survives 3dj round trip', async () => {
    const id = await fresh(), before = body(id).volume;
    await emboss(id, { text: 'A', size: 8, depth: 1, mode: 'cut' });
    assert(body(id).volume < before - 1, 'engraving did not cut material');
    const volume = body(id).volume, bytes = await C.buildFileData('3dj');
    await C.openFile(new File([bytes], 'engraved.3dj'), null); await built(); noErr();
    assert(Math.abs(body(id).volume - volume) < 0.01 && S.doc.features.at(-1).text === 'A', 'engraving round trip failed');
  });
  await test('SVG emboss preserves a logo hole and rejects active/external SVG', async () => {
    const id = await fresh(), before = body(id).volume;
    const logo = C.parseLogo('<svg xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" d="M0 0H20V20H0Z M5 5V15H15V5Z"/></svg>', 'square-ring.svg');
    assert(logo.shapes.length === 1 && logo.shapes[0].holes.length === 1, 'SVG hole lost');
    await emboss(id, { source: 'logo', logo, size: 10, depth: 2 });
    assert(Math.abs(body(id).volume - before - 150) < 0.5, 'wrong logo volume: ' + (body(id).volume - before));
    let bad = false; try { C.parseLogo('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'); } catch { bad = true; }
    assert(bad, 'active SVG accepted');
  });
  await test('emboss tool cancel does not change project', async () => {
    const id = await fresh(), before = JSON.stringify(S.doc);
    C.startTool('emboss'); C.toolPick('face', { body: id, index: top(id) }); C.endTool();
    assert(JSON.stringify(S.doc) === before, 'canceled emboss mutated document');
  });
  await test('surface-point measure is read-only and gives world-axis deltas', async () => {
    const id = await fresh(), before = JSON.stringify(S.doc), undo = S.undoStack.length;
    C.startTool('measure'); C.measurePick({ body: id, index: 0, point: [0, 0, 0] }); C.measurePick({ body: id, index: 1, point: [3, 4, 12] });
    const r = C.measureResult('point', app.tool.items);
    assert(r.rows.find((x) => x[0] === 'Distance')[1] === 13, 'point distance wrong');
    assert(vp.measurePoints.length === 2 && document.querySelector('.measure-overlay line'), 'measurement markers missing');
    assert(JSON.stringify(S.doc) === before && S.undoStack.length === undo, 'measure changed document');
    C.endTool(); assert(vp.measurePoints.length === 0, 'measurement overlay remains');
  });
  await test('face measure reports parallel spacing and edge lengths', async () => {
    const id = await fresh(), d = body(id); let bottom = -1;
    for (let i = 0; i < d.faces.length / 6; i++) if (d.flat[i] && d.faces[i * 6 + 5] < -0.99) bottom = i;
    const rows = C.measureResult('face', [{ body: id, index: top(id) }, { body: id, index: bottom }]).rows;
    assert(Math.abs(rows.find((x) => x[0] === 'Parallel face gap')[1] - 10) < 0.001, 'face spacing wrong');
    const length = C.measureResult('edge', [{ body: id, index: 0 }]).rows[0][1];
    assert([10, 40, 60].some((n) => Math.abs(length - n) < 0.001), 'edge length wrong');
  });
  await test('circular edge measurement reports a diameter', async () => {
    C.newProject(); await built(); const id = C.addShape('cyl', { d: 18, h: 10 }); await built();
    const d = body(id); let found = false;
    for (let i = 0; i < d.edgeRanges.length / 2; i++) {
      const row = C.measureResult('edge', [{ body: id, index: i }]).rows.find((x) => x[0].includes('diameter'));
      if (row) { assert(Math.abs(row[1] - 18) < 0.05, 'wrong circle diameter'); found = true; break; }
    }
    assert(found, 'circular edge not recognized');
  });
  await test('named versions are separate archive entries and restore with undo', async () => {
    await fresh({ w: 20 }); C.createVersion('First design', 'baseline');
    S.commit((d) => { d.features[0].p.w = 35; }); await built(); C.createVersion('Wider design');
    const bytes = await C.buildFileData('3dj'), zip = await C.readZip(bytes);
    const entries = [...zip.keys()].filter((k) => k.startsWith('versions/'));
    assert(entries.length === 2, 'version JSON files missing');
    for (const name of entries) { const data = JSON.parse(new TextDecoder().decode(zip.get(name))); assert(!data.versions && !data.files && !data.versionData, 'snapshots recursively embedded'); }
    await C.openFile(new File([bytes], 'versions.3dj'), null); await built(); noErr();
    assert(S.doc.versions.length === 2, 'version metadata lost');
    await C.restoreVersion(S.doc.versions.find((v) => v.label === 'First design').id); await built();
    assert(S.doc.features[0].p.w === 20 && S.doc.versions.length === 2, 'restore did not preserve snapshot/list');
    S.undo(); await built(); assert(S.doc.features[0].p.w === 35, 'restore Undo failed');
    const id = S.doc.versions[0].id; C.deleteVersion(id); assert(S.doc.versions.length === 1, 'delete failed'); S.undo(); await built(); assert(S.doc.versions.length === 2, 'version deletion Undo failed');
  });
  await test('versions survive .3dj and editable 3MF saves', async () => {
    for (const fmt of ['3dj', '3mf']) {
      const bytes = await C.buildFileData(fmt);
      await C.openFile(new File([bytes], 'versions.' + fmt), null); await built(); noErr();
      assert(S.doc.versions.length === 2, fmt + ' lost versions');
      await C.restoreVersion(S.doc.versions[0].id); await built(); noErr();
    }
  });
  await test('first versioned save retains the previously saved model', async () => {
    await fresh({ w: 20 }); const initial = await C.buildFileData('3dj');
    await C.openFile(new File([initial], 'previous.3dj'), null); await built();
    S.commit((d) => { d.features[0].p.w = 47; }); await built(); C.createVersion('Changed design');
    assert(S.doc.versions.length === 2 && S.doc.versions[0].label === 'Previously saved', 'previous saved model not retained');
    await C.restoreVersion(S.doc.versions[0].id); await built(); assert(S.doc.features[0].p.w === 20, 'previously saved geometry was lost');
  });
  await test('archived-only imported model bytes stay in the portable project', async () => {
    await fresh(); const stl = await C.buildFileData('stl');
    C.newProject(); await built(); await C.insertFile(new File([stl], 'imported.stl')); await built();
    C.createVersion('Imported original');
    S.commit((d) => { d.features = []; d.bodies = {}; }); await built();
    const bytes = await C.buildFileData('3dj'), zip = await C.readZip(bytes);
    assert([...zip.keys()].some((k) => k.startsWith('files/')), 'archived import bytes omitted');
    await C.openFile(new File([bytes], 'archived-import.3dj'), null); await built();
    await C.restoreVersion(S.doc.versions[0].id); await built(); noErr(); assert(app.results.bodies.size === 1, 'archived import did not rebuild');
  });
  await test('history permits independent reordering and protects dependencies', async () => {
    await fresh(); const second = C.addShape('cyl'); await built();
    const firstId = S.doc.features[0].id, secondId = S.doc.features[1].id;
    assert(C.canMoveFeature(S.doc, secondId, -1), 'independent shape cannot reorder');
    assert(C.moveFeature(secondId, -1), 'reorder failed'); await built(); noErr(); assert(S.doc.features[0].id === secondId, 'order unchanged');
    app.sel = [second, S.doc.features.find((f) => f.id === firstId).body]; C.combine('union'); await built(); noErr();
    const combined = S.doc.features.at(-1);
    assert(C.dependentSteps(S.doc, secondId).includes(combined.id), 'dependent combine not detected');
    assert(!C.canMoveFeature(S.doc, combined.id, -1), 'combine moved before its input');
    C.editStep(combined.id); C.openPanel('props'); assert(document.querySelector('[aria-label="Step name"]'), 'history naming control missing');
  });
  await test('Merge and Subtract happen in one click, each one undo step', async () => {
    const a = await fresh({ w: 20, d: 20, h: 20 });
    const b = C.addShape('box', { w: 20, d: 20, h: 20 }); await built();
    S.commit((d) => { d.features.find((f) => f.body === b).pos = [10, 0, 0]; }); await built();
    app.sel = [a, b]; vp.setSelection(app.sel);
    const before = JSON.stringify(S.doc), undos = S.undoStack.length;
    // one click and it is done: one step in History, one Undo
    C.combine('union'); await built(); noErr();
    assert(app.results.bodies.size === 1 && Math.abs(body(a).volume - 12000) < 0.1 && S.undoStack.length === undos + 1, 'merge wrong');
    S.undo(); await built(); assert(app.results.bodies.size === 2 && JSON.stringify(S.doc) === before, 'merge undo failed');
    app.sel = [a, b]; vp.setSelection(app.sel);
    C.combine('subtract'); await built(); noErr();
    assert(Math.abs(body(a).volume - 4000) < 0.1 && S.undoStack.length === undos + 1 && S.doc.features.at(-1).op === 'subtract', 'subtract wrong');
    S.undo(); await built(); assert(app.results.bodies.size === 2, 'subtract undo failed');
  });
  await test('Save as STL writes the shape and leaves the project file and unsaved state unchanged', async () => {
    await fresh(); const before = JSON.stringify(app.file), dirty = app.dirty; let bytes, offered;
    const original = window.showSaveFilePicker;
    window.showSaveFilePicker = async (o) => { offered = o.types.map((t) => Object.values(t.accept).flat()[0]); return { name: 'output.stl', createWritable: async () => ({ write: async (data) => { bytes = data; }, close: async () => {} }) }; };
    try {
      await C.saveAs();
      for (let i = 0; i < 1000 && !bytes; i++) await sleep(20);
      assert(JSON.stringify(offered) === JSON.stringify(['.3dj', '.3mf', '.stl', '.step']), 'Save as types: ' + JSON.stringify(offered));
      assert(bytes?.length > 84, 'Save as STL did not write');
      assert(app.dirty === dirty && JSON.stringify(app.file) === before, 'Save as STL changed the project save state');
    } finally { window.showSaveFilePicker = original; }
  });
  await fresh({ w: 32 }); C.createVersion('Session marker');
  await C.idb.put('kv', JSON.stringify(S.doc), 'current');
  return results;
};

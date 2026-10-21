window.__runReliability = async () => {
  const { app, store: S, commands: C } = window.__3dj;
  const out = [];
  const assert = (ok, why) => { if (!ok) throw new Error(why); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const built = async () => {
    const deadline = Date.now() + 120000;
    while (app.building || app.pending || app.builtRevision !== S.revision) {
      if (app.engineError) throw new Error(app.engineError);
      if (Date.now() > deadline) throw new Error('build timed out');
      await sleep(20);
    }
  };
  const fresh = async () => { C.newProject(); await built(); C.addShape('box'); await built(); };
  const test = async (name, fn) => {
    try { await fn(); out.push({ name, ok: true }); }
    catch (e) { out.push({ name, ok: false, msg: e.message }); }
    console.log('TEST ' + (out.at(-1).ok ? 'PASS ' : 'FAIL ') + name);
  };
  await test('an edit during saving stays dirty and survives', async () => {
    await fresh(); let saved;
    app.file = { name: 'save-race.json', fmt: 'json', handle: { createWritable: async () => ({
      write: async (bytes) => {
        saved = JSON.parse(new TextDecoder().decode(bytes));
        S.commit((d) => { d.name = 'Later edit'; d.features[0].p.w = 73; });
      }, close: async () => {},
    }) } };
    await C.saveDoc();
    assert(app.dirty, 'later edit was marked saved');
    assert(S.doc.name === 'Later edit' && S.doc.features[0].p.w === 73, 'later edit was overwritten');
    assert(saved.features[0].p.w !== 73, 'test did not edit after the snapshot');
    await built();
  });
  await test('a document opened during saving keeps its file identity', async () => {
    await fresh();
    app.file = { name: 'old.json', fmt: 'json', handle: { createWritable: async () => ({
      write: async () => { C.newProject(); }, close: async () => {},
    }) } };
    await C.saveDoc();
    assert(app.file === null && S.doc.name === 'Untitled', 'old save changed the new document');
    await built();
  });
  await test('failed STL open preserves document, undo and file', async () => {
    await fresh(); const doc = JSON.stringify(S.doc), file = app.file, undos = S.undoStack.length;
    await C.openFile(new File(['not STL'], 'broken.stl'), null);
    assert(JSON.stringify(S.doc) === doc && app.file === file && S.undoStack.length === undos, 'failed open replaced the project');
    assert(!document.getElementById('toasts').innerText.includes('Opened broken.stl'), 'false success toast');
  });
  await test('oversized import is rejected before reading bytes', async () => {
    let read = false;
    const ok = await C.insertFile({ name: 'huge.stl', size: 401 * 1048576, arrayBuffer: async () => { read = true; return new ArrayBuffer(0); } });
    assert(ok === false && !read, 'oversized file was read');
  });
  await test('exports wait for the newest queued build', async () => {
    await fresh();
    S.commit((d) => { d.features[0].p.w = 41; });
    S.commit((d) => { d.features[0].p.w = 87; });
    const data = await C.buildFileData('stl');
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < dv.getUint32(80, true); i++) for (let k = 0; k < 3; k++) {
      const x = dv.getFloat32(84 + i * 50 + 12 + k * 12, true); min = Math.min(min, x); max = Math.max(max, x);
    }
    assert(Math.abs(max - min - 87) < 0.01, 'export contains stale geometry: ' + (max - min));
    assert(app.builtRevision === S.revision, 'export did not reach latest revision');
  });
  await test('missing imported bytes prevent incomplete project saves', async () => {
    C.loadProject({ features: [{ id: 'f1', body: 'b1', type: 'shape', kind: 'import', p: { file: 'missing', fmt: 'stl' } }] }, null);
    let error;
    try { await C.buildFileData('json'); } catch (e) { error = e; }
    assert(error?.message.includes('missing'), 'incomplete project was saved');
    await built(); await fresh();
  });
  await test('invalid project metadata leaves the open model intact', async () => {
    await fresh(); const before = JSON.stringify(S.doc);
    await C.openFile(new File([JSON.stringify({ features: [null] })], 'broken.json'), null);
    assert(JSON.stringify(S.doc) === before && !app.loading, 'bad metadata changed the document or stuck loading');
  });
  await test('invalid mesh indices and nonfinite coordinates are rejected', async () => {
    await fresh(); const before = JSON.stringify(S.doc);
    assert(await C.insertFile(new File(['v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99'], 'bad.obj')) === false, 'invalid index accepted');
    assert(await C.insertFile(new File(['v NaN 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'], 'nan.obj')) === false, 'NaN accepted');
    assert(JSON.stringify(S.doc) === before, 'invalid mesh changed the model');
  });
  await test('cyclic 3MF components are rejected', async () => {
    const xml = '<model xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1"><components><component objectid="1"/></components></object></resources><build><item objectid="1"/></build></model>';
    let error;
    try { C.parse3mf(new Map([['3D/3dmodel.model', new TextEncoder().encode(xml)]])); } catch (e) { error = e; }
    assert(error?.message.includes('cyclic'), 'cyclic component was accepted');
  });
  await test('ZIP CRC corruption and oversized expansion are rejected', async () => {
    await fresh(); const bytes = await C.buildFileData('3dj');
    const bad = bytes.slice(), dv = new DataView(bad.buffer);
    const dataStart = 30 + dv.getUint16(26, true) + dv.getUint16(28, true);
    bad[dataStart] ^= 1;
    let error; try { await C.readZip(bad); } catch (e) { error = e; }
    assert(error?.message.includes('damaged'), 'CRC corruption accepted');
    const large = bytes.slice(), ldv = new DataView(large.buffer);
    const cd = ldv.getUint32(large.length - 22 + 16, true); ldv.setUint32(cd + 24, 401 * 1048576, true);
    error = null; try { await C.readZip(large); } catch (e) { error = e; }
    assert(error?.message.includes('too large'), 'oversized expansion accepted');
  });
  await test('backup failure stays visible and clears after recovery', async () => {
    const original = C.idb.put;
    try {
      C.idb.put = async () => { throw new Error('test quota exceeded'); };
      S.save(); await sleep(2900);
      assert(app.backupError && document.getElementById('backupWarning'), 'backup failure hidden');
    } finally { C.idb.put = original; }
    S.save(); await sleep(2900);
    assert(!app.backupError && !document.getElementById('backupWarning'), 'recovery warning remains');
  });
  await test('unsaved new projects get a close warning', async () => {
    await fresh(); assert(!app.file && app.dirty, 'test is not unsaved');
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event);
    assert(event.defaultPrevented, 'no close warning for new document');
  });
  await test('worker failure rejects outstanding calls and restart rebuilds', async () => {
    const result = C.workerCall({ type: 'test-unhandled-operation' }).then(() => null, (e) => e);
    window.__reviewWorkers.at(-1).dispatchEvent(new ErrorEvent('error', { message: 'Simulated worker failure' }));
    const error = await result;
    assert(error?.message.includes('Simulated') && app.engineError && !app.building && !app.pending, 'worker failure was not recovered');
    assert(document.querySelector('#status button')?.textContent === 'Restart engine', 'restart control missing');
    const restart = C.startWorker();
    assert(C.startWorker() === restart, 'repeated restart created competing workers');
    await restart; await built();
    assert(!app.engineError && app.results.bodies.size === 1, 'restart failed to rebuild');
    assert((await C.buildFileData('stl')).length > 84, 'export unavailable after recovery');
  });
  return out;
};

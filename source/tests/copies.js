// Mirror copy and turned copy make separate objects; a mirrored sketch stays an editable sketch.
window.__runCopyTests = async () => {
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
  const body = (id) => app.results.bodies.get(id);
  const noErr = () => assert(!Object.keys(app.results.errors).length, JSON.stringify(app.results.errors));
  const sel = (ids) => { app.sel = ids; vp.setSelection(ids); };
  const creator = (id) => S.doc.features.find((f) => f.type === 'shape' && f.body === id);
  const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
  const L = { type: 'poly', pts: [[0, 0], [40, 0], [40, 8], [14, 8], [10, 30], [0, 30]], bulge: [0, 0, 0, 0.3, 0, 0] };
  const sketch = async (p, pos = [0, 0, 0], rot = [0, 0, 0]) => {
    C.newProject(); await built();
    const id = C.addShape('sketch', { loops: [JSON.parse(JSON.stringify(L))], h: 12, ...p }, 'Sketch'); await built();
    S.commit((d) => { const f = d.features.find((x) => x.body === id); f.pos = pos; f.rot = rot; }); await built(); noErr();
    return id;
  };
  // the exact answer: the engine's own mirror of a copy, across the same plane
  const reference = async (id, axis, at) => {
    const r = S.newId('b');
    S.commit((d) => { d.bodies[r] = { name: 'ref' }; d.features.push({ id: S.newId('f'), type: 'copy', src: id, body: r, d: [0, 0, 0] }, { id: S.newId('f'), type: 'mirror', body: r, axis, copy: false, at }); });
    await built(); noErr(); return r;
  };
  const sameShape = (a, b, what) => {
    const A = body(a), B = body(b);
    for (let k = 0; k < 3; k++) for (const e of [0, 1]) assert(near(A.bbox[e][k], B.bbox[e][k]), `${what}: box ${JSON.stringify(A.bbox)} vs ${JSON.stringify(B.bbox)}`);
    assert(Math.abs(A.volume - B.volume) < 0.002 * B.volume, `${what}: volume ${A.volume} vs ${B.volume}`);
  };
  const mirrorCheck = async (id, axis, what, editable = true) => {
    const ax = { x: 0, y: 1, z: 2 }[axis], before = JSON.stringify(body(id).bbox), at = body(id).bbox[1][ax];
    const n0 = app.results.bodies.size;
    sel([id]); C.mirrorSel(axis, true); await built(); noErr();
    assert(app.results.bodies.size === n0 + 1, `${what}: a new object should appear`);
    assert(JSON.stringify(body(id).bbox) === before, `${what}: the original changed`);
    const copy = app.sel[0]; assert(copy && copy !== id, `${what}: the copy should be selected`);
    if (editable) assert(creator(copy)?.kind === 'sketch' && S.doc.features.filter((f) => f.body === copy).length === 1, `${what}: the copy should be a plain editable sketch`);
    const ref = await reference(id, axis, at);
    sameShape(copy, ref, what);
    return copy;
  };
  await test('mirror copy of a sketch is its own editable sketch, flipped exactly (x, y and z)', async () => {
    for (const axis of ['x', 'y', 'z']) {
      const id = await sketch({}, [20, 10, 0]);
      const copy = await mirrorCheck(id, axis, 'push-up ' + axis);
      if (axis === 'x') assert(creator(copy).p.loops[0].pts.some((q) => q[0] === -40), 'the outline should be drawn flipped');
    }
  });
  await test('mirror copy of a turned (rotated) sketch matches the exact mirror', async () => {
    for (const axis of ['x', 'y', 'z']) { const id = await sketch({}, [5, -8, 4], [30, 15, 40]); await mirrorCheck(id, axis, 'turned ' + axis); }
  });
  await test('mirror copy of spun (revolve) and loft sketches', async () => {
    for (const axis of ['x', 'z']) { const id = await sketch({ mode: 'revolve', angle: 360, loops: [{ type: 'poly', pts: [[5, 0], [20, 0], [20, 4], [9, 25], [5, 25]] }] }); await mirrorCheck(id, axis, 'spin ' + axis); }
    const id = await sketch({ mode: 'loft', h: 20, loops: [{ type: 'poly', pts: [[0, 0], [30, 0], [30, 30], [0, 30]] }, { type: 'circle', c: [20, 18], r: 6 }] });
    await mirrorCheck(id, 'z', 'loft z');
  });
  await test('mirror copy of other objects is a separate object, not joined', async () => {
    C.newProject(); await built();
    const id = C.addShape('wedge'); await built();
    await mirrorCheck(id, 'x', 'wedge', false);
    // a merged object too
    C.newProject(); await built();
    const a = C.addShape('box'); await built(); const b = C.addShape('cyl'); await built();
    S.commit((d) => { d.features.find((f) => f.body === b).pos = [12, 0, 0]; }); await built();
    sel([a, b]); C.combine('union'); await built();
    await mirrorCheck(a, 'y', 'merged', false);
  });
  await test('Flip (not a copy) still flips the object in place', async () => {
    const id = await sketch({}, [20, 10, 0]); const bb = JSON.stringify(body(id).bbox);
    sel([id]); C.mirrorSel('x', false); await built(); noErr();
    assert(app.results.bodies.size === 1 && JSON.stringify(body(id).bbox) === bb, 'flip should stay one object in the same place');
  });
  await test('older projects with a joined mirror copy still open the same', async () => {
    C.newProject(); await built();
    const id = C.addShape('wedge'); await built();
    S.commit((d) => d.features.push({ id: S.newId('f'), type: 'mirror', body: id, axis: 'x', copy: true, side: 'max' })); await built(); noErr();
    assert(near(body(id).bbox[1][0] - body(id).bbox[0][0], 40), 'old joined mirror copy width');
  });
  await test('turned copies: their own object beside the original, a quarter turn swaps width and depth', async () => {
    for (const deg of [90, 180, -90]) {
      C.newProject(); await built();
      const id = C.addShape('box', { w: 40, d: 20, h: 10 }); await built();
      sel([id]); C.turnCopySel(deg); await built(); noErr();
      const copy = app.sel[0], c = creator(copy), A = body(id).bbox, B = body(copy).bbox;
      assert(copy !== id && app.results.bodies.size === 2, 'one new object');
      assert(c && near(Math.abs(c.rot[2]), Math.abs(deg)), 'the copy stays an editable shape, turned: ' + JSON.stringify(c?.rot));
      const w = B[1][0] - B[0][0], dd = B[1][1] - B[0][1];
      assert(Math.abs(deg) === 90 ? near(w, 20) && near(dd, 40) : near(w, 40) && near(dd, 20), `size ${w} x ${dd}`);
      assert(B[0][0] > A[1][0] - 0.01 || B[1][0] < A[0][0] + 0.01 || B[0][1] > A[1][1] - 0.01 || B[1][1] < A[0][1] + 0.01, 'the copy should sit beside the original, not on top of it');
    }
    // something with steps after it (a merged object): a copy that is turned as its own object
    const a = C.addShape('wedge'); await built(); const v = body(a).volume;
    sel([a]); C.startTool('fillet'); C.quickEdges('vertical'); C.applyTool(); await built();
    const vf = body(a).volume; sel([a]); C.turnCopySel(180); await built(); noErr();
    assert(Math.abs(body(app.sel[0]).volume - vf) < 0.01 * vf && vf !== v, 'turned copy of a rounded wedge');
  });
  // ---- several sketches on one board
  const two = async (p2 = {}, pos2 = [60, 5, 0], rot = [0, 0, 0], pos1 = [0, 0, 0]) => {
    C.newProject(); await built();
    const a = C.addShape('sketch', { loops: [JSON.parse(JSON.stringify(L))], h: 12 }, 'Sketch'); await built();
    const b = C.addShape('sketch', { loops: [{ type: 'circle', c: [3, 4], r: 8 }, { type: 'poly', pts: [[20, 0], [30, 0], [30, 10]] }], h: 12, ...p2 }, 'Sketch'); await built();
    S.commit((d) => { const fa = d.features.find((x) => x.body === a), fb = d.features.find((x) => x.body === b); fa.pos = pos1; fa.rot = rot; fb.pos = pos2; fb.rot = rot; });
    await built(); noErr(); return [a, b];
  };
  const boxes = (ids) => ids.map((id) => JSON.stringify(body(id).bbox.map((v) => v.map((x) => Math.round(x * 100) / 100))));
  await test('edit sketches together: one board, colors per sketch, Done leaves both exactly in place', async () => {
    for (const [rot, pos1, pos2] of [[[0, 0, 0], [0, 0, 0], [60, 5, 0]], [[0, 0, 35], [10, 3, 0], [70, -20, 0]], [[25, 10, 35], [10, 3, 8], null]]) {
      let p2 = pos2;
      if (!p2) { // a second sketch on the same turned, lifted plane: 40 mm further along the plane's own x
        const R = new (vp.camera.matrix.constructor)().makeRotationFromEuler(new (vp.camera.rotation.constructor)(...rot.map((x) => x * Math.PI / 180), 'ZYX'));
        const v = new (vp.camera.position.constructor)(40, 0, 0).applyMatrix4(R); p2 = [pos1[0] + v.x, pos1[1] + v.y, pos1[2] + v.z];
      }
      const ids = await two({}, p2, rot, pos1); const before = boxes(ids);
      sel(ids); C.renderAll?.();
      const k = C.editSketches(ids); assert(k, 'board should open for ' + JSON.stringify(rot)); k.setTool('line');
      assert(k.loops.length === 3 && new Set(k.loops.map((l) => l.owner)).size === 2, 'both sketches on the board');
      assert(document.querySelectorAll('.sk-owner').length === 2, 'the Sketches list: ' + document.querySelectorAll('.sk-owner').length + ' ' + document.querySelector('.sk-side')?.innerText.slice(0, 300));
      k.finish(); await built(); noErr();
      const after = boxes(ids); assert(JSON.stringify(after) === JSON.stringify(before), `moved: ${before} -> ${after}`);
    }
  });
  await test('edit sketches together: change one, move a shape between sketches, rules stay with their sketch', async () => {
    const ids = await two(); const before1 = body(ids[1]).bbox[0][0] ;
    const k = C.editSketches(ids); k.setTool('line');
    // the circle (second sketch) goes 10 mm right; the triangle moves to the first sketch
    const circ = k.loops.find((l) => l.type === 'circle'); circ.c[0] += 10;
    k.pick(k.loops.findIndex((l) => l.type === 'poly' && l.owner === 1));
    [...document.querySelectorAll('.sk-side .chip')].find((c) => c.textContent === 'Move picked shape here').click();
    k.finish(); await built(); noErr();
    const fa = creator(ids[0]), fb = creator(ids[1]);
    assert(fa.p.loops.length === 2 && fb.p.loops.length === 1 && fb.p.loops[0].type === 'circle', 'shapes went to the right sketch');
    assert(!fa.p.loops.some((l) => 'owner' in l), 'no board-only data saved in the file');
    // the circle moved 10 mm to the right in the world (the first sketch did not move: its outline only grew)
    assert(near(body(ids[1]).bbox[0][0], before1 + 10, 0.05), `circle moved ${before1} -> ${body(ids[1]).bbox[0][0]}`);
  });
  await test('join sketches into one sketch object', async () => {
    const ids = await two(); const v = body(ids[0]).volume + body(ids[1]).volume;
    const union = [0, 1, 2].map((i) => [Math.min(body(ids[0]).bbox[0][i], body(ids[1]).bbox[0][i]), Math.max(body(ids[0]).bbox[1][i], body(ids[1]).bbox[1][i])]);
    const k = C.editSketches(ids); k.setTool('line');
    [...document.querySelectorAll('.sk-side .chip')].find((c) => c.textContent === 'Join into one sketch').click();
    k.finish(); await built(); noErr();
    assert(app.results.bodies.size === 1 && body(ids[0]) && !body(ids[1]), 'one object left: ' + app.results.bodies.size + JSON.stringify(creator(ids[0])?.p.loops.length) + document.querySelector('.toast,.toasts')?.innerText);
    assert(Math.abs(body(ids[0]).volume - v) < 0.01 * v, `volume ${body(ids[0]).volume} vs ${v}`);
    for (let i = 0; i < 3; i++) assert(near(body(ids[0]).bbox[0][i], union[i][0], 0.05) && near(body(ids[0]).bbox[1][i], union[i][1], 0.05), 'joined in place: ' + JSON.stringify(body(ids[0]).bbox));
  });
  await test('edit sketches together: spin around sketches on one line; mixed or different planes are refused clearly', async () => {
    C.newProject(); await built();
    const a = C.addShape('sketch', { mode: 'revolve', angle: 360, loops: [{ type: 'poly', pts: [[5, 0], [20, 0], [20, 4], [9, 25], [5, 25]] }], h: 10 }, 'Sketch'); await built();
    const b = C.addShape('sketch', { mode: 'revolve', angle: 360, loops: [{ type: 'poly', pts: [[0, 25], [12, 25], [3, 40], [0, 40]] }], h: 10 }, 'Sketch'); await built();
    S.commit((d) => { for (const id of [a, b]) { const f = d.features.find((x) => x.body === id); f.pos = [0, 0, 0]; } d.features.find((x) => x.body === b).pos = [0, 0, 25]; }); await built(); noErr();
    const before = boxes([a, b]);
    const k = C.editSketches([a, b]); assert(k, 'spin sketches open together');
    const pb = k.loops.find((l) => l.owner === 1); assert(pb.pts.some((q) => Math.abs(q[1] - 40) < 1e-6) && pb.pts.some((q) => Math.abs(q[1] - 25) < 1e-6), 'second profile sits above the first on the board: ' + JSON.stringify(pb.pts));
    k.finish(); await built(); noErr(); assert(JSON.stringify(boxes([a, b])) === JSON.stringify(before), 'spin sketches stayed put');
    const c = C.addShape('sketch', { loops: [JSON.parse(JSON.stringify(L))], h: 12 }, 'Sketch'); await built();
    assert(!C.editSketches([a, c]), 'mixed spin and push-up refused');
    S.commit((d) => { d.features.find((x) => x.body === c).rot = [0, 30, 0]; }); await built();
    const d2 = C.addShape('sketch', { loops: [JSON.parse(JSON.stringify(L))], h: 12 }, 'Sketch'); await built();
    assert(!C.editSketches([c, d2]), 'different planes refused');
  });
  await test('the board shows real positions: gaps and distance from 0,0 match the model (also with a fixed drawing origin)', async () => {
    // two sketches drawn at the same spot, then moved apart: 20 mm gap, the first 30 mm right of 0,0
    C.newProject(); await built();
    const sq = (w) => ({ loops: [{ type: 'poly', pts: [[0, 0], [w, 0], [w, 10], [0, 10]] }], h: 5 });
    const a = C.addShape('sketch', sq(10), 'Sketch'), b = C.addShape('sketch', sq(10), 'Sketch'); await built();
    S.commit((d) => { d.features.find((x) => x.body === a).pos = [35, 0, 0]; d.features.find((x) => x.body === b).pos = [65, 0, 0]; }); await built();
    const k = C.editSketches([a, b]); k.setTool('line');
    const xr = (o) => { const q = k.loops.filter((l) => l.owner === o).flatMap((l) => l.pts.map((p) => p[0])); return [Math.min(...q), Math.max(...q)]; };
    const [A, Bx] = [xr(0), xr(1)];
    assert(near(A[0], 30) && near(A[1], 40) && near(Bx[0], 60) && near(Bx[1], 70), 'board positions ' + JSON.stringify([A, Bx]));
    k.close(true);
    // a project saved with a fixed drawing origin (p.off): outlines already in real coordinates, must not overlap or move
    C.newProject(); await built();
    const c = C.addShape('sketch', { loops: [{ type: 'poly', pts: [[-100, -50], [-10, -50], [-10, 50], [-100, 50]] }], h: 20, off: [0, 0, 0] }, 'Sketch');
    const e = C.addShape('sketch', { loops: [{ type: 'poly', pts: [[10, -50], [100, -50], [100, 50], [10, 50]] }], h: 20, off: [0, 0, 0] }, 'Sketch'); await built();
    S.commit((d) => { for (const id of [c, e]) d.features.find((x) => x.body === id).pos = [0, 0, 0]; }); await built();
    const bb = () => JSON.stringify([c, e].map((id) => body(id).bbox));
    const before = bb();
    const k2 = C.editSketches([c, e]); k2.setTool('line');
    const q = k2.loops.find((l) => l.owner === 1).pts; assert(Math.min(...q.map((p) => p[0])) === 10, 'fixed-origin sketch kept its real place on the board');
    k2.finish(); await built(); assert(bb() === before, 'fixed-origin sketches moved after Done');
    const k3 = C.editSketch(creator(e)); k3.setTool('line'); k3.finish(); await built(); assert(bb() === before, 'single Edit sketch moved a fixed-origin sketch');
  });
  await test('merge touching outlines: one outline, arcs kept, holes and separate outlines left alone', async () => {
    C.newProject(); await built();
    const k = C.openSketch([], () => {}); k.setTool('line');
    k.loops.push({ type: 'poly', pts: [[0, 0], [20, 0], [20, 10], [0, 10]] }, { type: 'poly', pts: [[10, 5], [30, 5], [30, 20], [10, 20]] }, { type: 'circle', c: [50, 50], r: 5 },
      { type: 'poly', pts: [[60, 0], [80, 0], [80, 10], [60, 10]] }, { type: 'circle', c: [80, 5], r: 4 }, { type: 'circle', c: [5, 5], r: 2 });
    const lone = k.loops[2], hole = k.loops[5];
    await k.mergeTouching();
    assert(k.loops.length === 4 && k.loops.includes(lone) && k.loops.includes(hole), 'untouched circle and the hole stay as they were: ' + JSON.stringify(k.loops.map((l) => l.type)));
    const merged = k.loops.filter((l) => l !== lone && l !== hole);
    assert(merged.some((l) => l.pts?.length === 8 && !l.bulge), 'two overlapping rectangles became one 8-corner outline');
    assert(merged.some((l) => l.bulge?.some((b) => b)), 'rectangle + circle became one outline with an arc');
    k.close(true);
  });
  await test('merge touching sketches on one board: the emptied sketch is removed at Done, the solid is the union', async () => {
    C.newProject(); await built();
    const a = C.addShape('sketch', { loops: [{ type: 'poly', pts: [[0, 0], [40, 0], [40, 10], [0, 10]] }], h: 5 }, 'Sketch');
    const b = C.addShape('sketch', { loops: [{ type: 'poly', pts: [[0, 0], [10, 0], [10, 40], [0, 40]] }], h: 5 }, 'Sketch'); await built();
    S.commit((d) => { d.features.find((x) => x.body === a).pos = [20, 5, 0]; d.features.find((x) => x.body === b).pos = [5, 20, 0]; }); await built();
    const k = C.editSketches([a, b]); k.setTool('line');
    await k.mergeTouching();
    assert(k.loops.filter((l) => l.type !== 'line').length === 1, 'one outline after merging');
    k.finish(); await built(); noErr();
    assert(body(a) && !body(b), 'the second sketch was merged into the first');
    assert(Math.abs(body(a).volume - (400 + 400 - 100) * 5) < 2, 'L-shaped union volume ' + body(a).volume);
  });
  await test('merge welds outlines that are a hair apart or a hair overlapping (rounded corners vs exact ones)', async () => {
    C.newProject(); await built();
    const k = C.openSketch([], () => {}); k.setTool('line');
    // two walls whose ends are not on the 0.001 mm grid, and a bridge rectangle drawn with rounded corners
    k.loops.push({ type: 'poly', pts: [[-99.998943, -60], [-95.000987, -60], [-95.000987, -10.350001], [-99.998943, -10.350001]] },
      { type: 'poly', pts: [[-99.998943, 10.349998], [-95.014401, 10.349998], [-95.014401, 60], [-99.998943, 60]] },
      { type: 'poly', pts: [[-99.999, -10.35], [-95.014, -10.35], [-95.014, 10.35], [-99.999, 10.35]] });
    await k.mergeTouching();
    assert(k.loops.length === 1, 'the three should weld into one outline, got ' + k.loops.length);
    k.close(true);
  });
  return results;
};

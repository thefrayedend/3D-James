// Ready-made parts (src/parts/), checked with the real geometry engine (no browser needed):
//   node tests/parts.mjs [kind ...]
// Builds every part with its standard numbers and with the variations below, and checks that it builds, has volume,
// is the size it should be, and that parts which are holes are marked as holes. Writes each result to dist/parts/ as a
// .3dj project to open in 3DJames.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..');
const nm = (p) => pathToFileURL(path.join(SRC, 'node_modules', p)).href;
const { default: initOC } = await import(nm('replicad-opencascadejs/dist/replicad_single.js'));
const { default: ManifoldModule } = await import(nm('manifold-3d/manifold.js'));
const E = await import(pathToFileURL(path.join(SRC, 'src/engine.js')).href);
const { SHAPES, HOLE_KINDS } = await import(pathToFileURL(path.join(SRC, 'src/shared.js')).href);
const { PART_DEFS, PART_MENU, PART_HOLES } = await import(pathToFileURL(path.join(SRC, 'src/parts/defs.js')).href);
const { zipStore } = await import(pathToFileURL(path.join(SRC, 'src/zip.js')).href);

const oc = await initOC({ locateFile: (f) => path.join(SRC, 'node_modules/replicad-opencascadejs/dist', f) });
E.R.setOC(oc);
const MF = await ManifoldModule(); MF.setup(); E.setManifoldModule(MF);

// [kind, numbers on top of the standard ones, what to expect: size [x, y, z] in mm (or null), a note]
const CASES = JSON.parse(fs.readFileSync(path.join(HERE, 'parts.cases.json'), 'utf8'));

// parts that print in place are several separate solids with a gap between them
const STANDARD_SOLIDS = { hinge: 2, balljoint: 2, ujoint: 3, tolerancetest: 7 };
const OUT = path.join(SRC, 'dist', 'parts');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);
let failed = 0, n = 0;
const run = (kind, extra, expect, note, solidsWanted) => {
  const p = { ...SHAPES[kind].defaults, ...extra };
  const doc = { v: 1, name: kind, vars: [], bodies: { b1: { name: SHAPES[kind].label, color: '#C3C3C3', hole: HOLE_KINDS.has(kind) } }, features: [{ id: 'f1', type: 'shape', body: 'b1', kind, p, pos: [0, 0, 0], rot: [0, 0, 0] }], seq: 10, counters: {} };
  const t0 = Date.now();
  let res, err = null;
  try { res = E.evaluate(doc, new Set()); } catch (e) { err = e.message; }
  const ms = Date.now() - t0;
  const b = res?.bodies?.[0];
  const errs = Object.values(res?.errors || {});
  const sh = res && E.solidOf('b1'), solids = sh ? E.countSolids(sh) : null;
  const size = b ? [0, 1, 2].map((i) => +(b.bbox[1][i] - b.bbox[0][i]).toFixed(2)) : null;
  const problems = [];
  if (err) problems.push('threw: ' + err);
  if (errs.length) problems.push('build error: ' + errs[0]);
  if (b && !(b.volume > 0)) problems.push('no volume');
  if (b && expect && expect.some((v, i) => v != null && Math.abs(v - size[i]) > Math.max(0.15, v * 0.01))) problems.push(`size ${size} should be ${expect}`);
  if (solidsWanted != null && solids !== solidsWanted) problems.push(`${solids} separate solids, should be ${solidsWanted} (the moving pieces must not touch)`);
  if (ms > 20000) problems.push(`slow: ${ms} ms`);
  n++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${(kind + ' ' + (note || '')).padEnd(46)} ${String(ms).padStart(6)} ms  ${size ? size.join(' x ') : ''}${b?.volume ? '  vol ' + Math.round(b.volume) : ''}${solids > 1 ? '  ' + solids + ' solids' : ''}${problems.length ? '   <- ' + problems.join('; ') : ''}`);
  if (problems.length) failed++;
  if (b) fs.writeFileSync(path.join(OUT, `${kind}${note ? '-' + note.replace(/[^\w.-]+/g, '_') : ''}.3dj`), zipStore([{ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(doc)) }]));
};

for (const kind of [...new Set([...Object.keys(PART_DEFS), ...CASES.map((c) => c[0])])]) {
  if (only.length && !only.includes(kind)) continue;
  const cases = CASES.filter((c) => c[0] === kind);
  if (!cases.some((c) => !c[1] || !Object.keys(c[1]).length)) run(kind, {}, null, 'standard', STANDARD_SOLIDS[kind]);
  for (const [, extra, expect, note, solids] of cases) run(kind, extra || {}, expect, note || JSON.stringify(extra), solids);
}

// a Gridfinity bin sits in a Gridfinity baseplate without overlapping it (its foot is a bit smaller than the pocket)
if (!only.length || only.includes('gfbin')) {
  const body = (id) => ({ name: id, color: '#C3C3C3' });
  const shape = (id, kind, p, pos) => ({ id: 'f' + id, type: 'shape', body: id, kind, p: { ...SHAPES[kind].defaults, ...p }, pos, rot: [0, 0, 0] });
  const vol = (features) => { const r = E.evaluate({ v: 1, name: 'fit', vars: [], bodies: { b1: body('b1'), b2: body('b2') }, features, seq: 10, counters: {} }, new Set()); return { v: r.bodies.reduce((s, b) => s + b.volume, 0), e: Object.values(r.errors) }; };
  const A = shape('b1', 'gfbaseplate', { nx: 2, ny: 1, floor: 0 }, [0, 0, 0]), B = shape('b2', 'gfbin', { nx: 2, ny: 1, nz: 2 }, [0, 0, 0]);
  const apart = vol([A, { ...B, pos: [300, 0, 0] }]), together = vol([A, B, { id: 'f9', type: 'combine', op: 'union', body: 'b1', tools: ['b2'] }]);
  const overlap = apart.v - together.v;
  n++;
  console.log(`${Math.abs(overlap) < 0.5 && !apart.e.length && !together.e.length ? 'ok  ' : 'FAIL'} gridfinity bin fits in the baseplate (overlap ${overlap.toFixed(3)} mm3)`);
  if (!(Math.abs(overlap) < 0.5) || apart.e.length || together.e.length) failed++;
}
// every menu item builds, and every hole part is a hole
if (!only.length) {
  const items = (list) => list.flatMap((x) => (x.items ? items(x.items) : x.sub ? items(x.items || []) : [x]));
  const walk = (entries) => entries.flatMap((e) => (e.sub ? walk(e.items) : e.items ? walk(e.items) : [e]));
  for (const sec of PART_MENU) for (const it of walk(sec.items)) {
    const [label, kind, extra] = it;
    if (!SHAPES[kind]) { console.log('FAIL menu item has no such part:', kind); failed++; continue; }
    if (extra) for (const k of Object.keys(extra)) if (!(k in SHAPES[kind].defaults)) { console.log(`FAIL menu item ${kind}: "${k}" is not one of its numbers`); failed++; }
    // built the way the Parts menu adds it: the standard numbers for its size or board, then the item's own
    const def = SHAPES[kind];
    run(kind, { ...(def.preset ? def.preset({ ...def.defaults, ...extra }) : {}), ...extra }, null, `menu: ${label}`);
  }
  for (const k of PART_HOLES) if (!PART_DEFS[k]) { console.log('FAIL hole kind has no part:', k); failed++; }
}
// the AI skill lists every part (node tools/make_skill_parts.mjs writes it)
const skill = fs.readFileSync(path.join(SRC, 'skill/3djames-project/SKILL.md'), 'utf8');
for (const k of Object.keys(PART_DEFS)) if (!skill.includes(`| ${k}`)) { console.log(`FAIL the AI skill does not list "${k}": run node tools/make_skill_parts.mjs`); failed++; }
console.log(`\n${n - failed >= 0 ? n : 0} builds, ${failed} problem${failed === 1 ? '' : 's'}`);
process.exit(failed ? 1 : 0);

// STL -> editable 3DJames steps, checked with the real geometry engine (no browser needed):
//   node tests/stl_convert.mjs [file.stl ...]      (DETAIL=balanced or simple: how much detail to keep)
// Converts each STL, rebuilds the steps in the engine and compares the result with the STL
// (volume, size, how much of the model differs, how far apart the surfaces are). Writes each result
// as a .3dj to dist/stl_convert/ to open in 3DJames.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..');
const nm = (p) => pathToFileURL(path.join(SRC, 'node_modules', p)).href;
const { default: initOC } = await import(nm('replicad-opencascadejs/dist/replicad_single.js'));
const { default: ManifoldModule } = await import(nm('manifold-3d/manifold.js'));
const E = await import(pathToFileURL(path.join(SRC, 'src/engine.js')).href);
const C = await import(pathToFileURL(path.join(SRC, 'src/stlconvert.js')).href);
const { zipStore } = await import(pathToFileURL(path.join(SRC, 'src/zip.js')).href);

const oc = await initOC({ locateFile: (f) => path.join(SRC, 'node_modules/replicad-opencascadejs/dist', f) });
E.R.setOC(oc);
const MF = await ManifoldModule(); MF.setup(); E.setManifoldModule(MF);

globalThis.DEBUG_CONV = +(process.env.DEBUG_CONV || 0);
const FIX = path.join(HERE, 'fixtures', 'stl');
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(FIX).filter((f) => f.endsWith('.stl')).map((f) => path.join(FIX, f));
const checkClose = !process.argv.slice(2).length; // the test parts must come out (almost) the same
const OUT = path.join(SRC, 'dist', 'stl_convert');
fs.mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const file of files) {
  const t0 = Date.now();
  const name = path.basename(file).replace(/\.stl$/i, '');
  const buf = fs.readFileSync(file);
  const { vertices, triangles } = E.parseSTL(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  let mesh;
  try { mesh = E.mfFromArrays(vertices, triangles); } catch (err) { console.log(name.padEnd(44), 'SKIPPED:', err.message); continue; }
  const res = C.convertAndCheck(MF, mesh, { name, detail: process.env.DETAIL || 'precise' }, (d) => E.evaluate(d, new Set(), { scratch: true }));
  const t1 = Date.now();
  const doc = { v: 1, name, vars: [], bodies: res.bodies, features: res.features, seq: res.seq, counters: {} };
  const ev = { errors: res.errors };
  const t2 = t1;
  if (process.env.SHOW) for (const f of res.features) console.log(' ', f.id, f.type, f.name, String(JSON.stringify(f.p?.loops ?? f.tools ?? f)).slice(0, +process.env.SHOW));
  const report = res.report || { volumeDiff: 1, xor: 1, maxGap: Infinity };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name + '.3dj'), zipStore([{ name: 'project.json', data: new TextEncoder().encode(JSON.stringify(doc)) }]));
  const errs = Object.entries(ev.errors);
  const sketches = res.features.filter((f) => f.kind === 'sketch').length;
  console.log(`${name.slice(0, 44).padEnd(44)} steps ${String(res.features.length).padStart(3)} (${sketches} sketches) mesh parts ${res.parts.filter((p) => p.mesh).length}/${res.parts.length}`
    + ` | vol ${(report.volumeDiff * 100).toFixed(2)}% differs ${(report.xor * 100).toFixed(2)}% max gap ${report.maxGap.toFixed(3)} mm`
    + ` | ${t1 - t0} + ${t2 - t1} ms${errs.length ? ' | ERRORS ' + JSON.stringify(errs).slice(0, 300) : ''}`);
  if (process.env.SHOW) console.log('  worst gap at', C.worstAt(), report.gaps);
  if (errs.length || (checkClose && (report.xor > 0.005 || report.maxGap > 0.1 || res.parts.some((p) => p.mesh) || !sketches))) { failed++; console.log('  FAILED'); }
  mesh.delete();
}
process.exit(failed ? 1 : 0);

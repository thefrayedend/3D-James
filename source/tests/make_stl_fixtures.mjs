// Test STLs for Make editable, designed here in 3DJames steps and exported as meshes (so they are ours to
// share): node tests/make_stl_fixtures.mjs  ->  tests/fixtures/stl/*.stl
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..');
const nm = (p) => pathToFileURL(path.join(SRC, 'node_modules', p)).href;
const { default: initOC } = await import(nm('replicad-opencascadejs/dist/replicad_single.js'));
const { default: ManifoldModule } = await import(nm('manifold-3d/manifold.js'));
const E = await import(pathToFileURL(path.join(SRC, 'src/engine.js')).href);
const oc = await initOC({ locateFile: (f) => path.join(SRC, 'node_modules/replicad-opencascadejs/dist', f) });
E.R.setOC(oc);
const MF = await ManifoldModule(); MF.setup(); E.setManifoldModule(MF);

const sk = (id, body, loops, h, pos, extra = {}) => ({ id, type: 'shape', body, kind: 'sketch', p: { loops, h, ...extra }, pos, rot: [0, 0, 0] });
const box = (id, body, w, d, h, pos, rot = [0, 0, 0]) => ({ id, type: 'shape', body, kind: 'box', p: { w, d, h }, pos, rot });
const cyl = (id, body, d, h, pos, rot = [0, 0, 0]) => ({ id, type: 'shape', body, kind: 'cyl', p: { d, h }, pos, rot });
const B = (...ids) => Object.fromEntries(ids.map((b) => [b, { name: b, color: '#22B14C' }]));
const MODELS = {
  // an L bracket: rounded corners, 4 holes, one counterbored, a raised boss with a hole
  bracket: {
    bodies: B('b1', 'b2', 'b3', 'b4', 'b5', 'b6'),
    features: [
      sk('f1', 'b1', [{ type: 'poly', pts: [[0, 0], [80, 0], [80, 20], [20, 20], [20, 60], [0, 60]], round: [4, 4, 0, 0, 4, 4] }], 6, [40, 30, 0]),
      cyl('f2', 'b2', 16, 10, [10, 50, 5.99]),
      { id: 'f3', type: 'combine', op: 'union', body: 'b1', tools: ['b2'] },
      cyl('f4', 'b3', 5, 30, [10, 10, -1]), cyl('f5', 'b4', 5, 30, [70, 10, -1]), cyl('f6', 'b5', 6, 30, [10, 50, -1]),
      cyl('f7', 'b6', 10, 3.01, [70, 10, 3]),
      { id: 'f8', type: 'combine', op: 'subtract', body: 'b1', tools: ['b3', 'b4', 'b5', 'b6'] },
    ],
  },
  // a knob: a profile with a rounded top spun around, four notches cut in its rim
  knob: {
    bodies: B('b1', 'b2', 'b3'),
    features: [
      sk('f1', 'b1', [{ type: 'poly', pts: [[4, 0], [30, 0], [30, 12], [24, 18], [4, 18]], bulge: [0, 0, 0.2, 0, 0] }], 0, [0, 0, 0], { mode: 'revolve' }),
      box('f2', 'b2', 8, 80, 8, [0, 0, 12]), box('f3', 'b3', 80, 8, 8, [0, 0, 12]),
      { id: 'f4', type: 'combine', op: 'subtract', body: 'b1', tools: ['b2', 'b3'] },
    ],
  },
  // a block with a pocket on top and a hole through it from the side
  block: {
    bodies: B('b1', 'b2', 'b3'),
    features: [
      box('f1', 'b1', 50, 30, 20, [0, 0, 0]),
      box('f2', 'b2', 30, 14, 10.01, [-5, 0, 10]),
      cyl('f3', 'b3', 6, 70, [0, 0, -25], [0, 90, 0]), // turned: pos is its middle less half its length
      { id: 'f4', type: 'combine', op: 'subtract', body: 'b1', tools: ['b2', 'b3'] },
    ],
  },
};

function stl(m) {
  const n = m.triangles.length / 3, buf = Buffer.alloc(84 + n * 50);
  buf.writeUInt32LE(n, 80);
  for (let t = 0; t < n; t++) for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) buf.writeFloatLE(m.vertices[3 * m.triangles[3 * t + k] + a], 84 + t * 50 + 12 + k * 12 + a * 4);
  return buf;
}
const OUT = path.join(HERE, 'fixtures', 'stl');
fs.mkdirSync(OUT, { recursive: true });
for (const [name, m] of Object.entries(MODELS)) {
  const r = E.evaluate({ vars: [], ...m }, new Set());
  if (Object.keys(r.errors).length) throw new Error(name + ' ' + JSON.stringify(r.errors));
  fs.writeFileSync(path.join(OUT, name + '.stl'), stl(E.exportMeshOf('b1')));
  console.log('wrote', name + '.stl', r.bodies.find((b) => b.id === 'b1').volume.toFixed(1), 'mm³');
}

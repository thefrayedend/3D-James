// Writes the table of ready-made parts into skill/3djames-project/SKILL.md from the same definitions the app uses
// (src/catalog.js and src/parts/defs.js), so the AI skill always lists every part kind and its numbers:
//   node tools/make_skill_parts.mjs
// The table goes between the <!-- parts:start --> and <!-- parts:end --> lines; the checker's KINDS list between
// "# parts:kinds:start" and "# parts:kinds:end".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { SHAPES, HOLE_KINDS } = await import(pathToFileURL(path.join(SRC, 'src/shared.js')).href);
const { PART_DEFS } = await import(pathToFileURL(path.join(SRC, 'src/parts/defs.js')).href);
const { PART_SHAPES } = await import(pathToFileURL(path.join(SRC, 'src/catalog.js')).href);

const kinds = [...Object.keys(PART_SHAPES), ...Object.keys(PART_DEFS)];
const show = (v) => (typeof v === 'string' ? `"${v}"` : String(v));
const rows = kinds.map((k) => {
  const d = SHAPES[k];
  const parts = d.fields.map(([key, label, type, a]) => {
    const dv = d.defaults[key];
    const opts = type === 'select' ? ` (${a.map(([v]) => `\`${v}\``).join('/')})` : '';
    return `\`${key}\` ${show(dv)}${opts}`;
  });
  return `| ${k}${HOLE_KINDS.has(k) ? ' (hole)' : ''} | ${d.label}: ${parts.join(', ')} |`;
});
const table = ['<!-- parts:start -->', '### Ready-made parts (each stands on its base, centred; every number can be an expression)', '| kind | label: p (defaults) |', '|---|---|', ...rows,
  '', 'Mark the bodies of parts shown as `(hole)` with `"hole": true`. Moving parts (hinge, ball joint, universal joint, tolerance test) are separate solids with a gap: do not merge them with anything touching the gap. `gear` types: `spur`, `helical`, `bevel`. Part sizes with a standard list (fans, boards, bearings, fittings) fill in their numbers when you pick one in 3DJames; in a project, give every number.', '<!-- parts:end -->'].join('\n');

const file = path.join(SRC, 'skill/3djames-project/SKILL.md');
let s = fs.readFileSync(file, 'utf8');
const crlf = s.includes('\r\n'); if (crlf) s = s.replace(/\r\n/g, '\n');
const swap = (re, text) => { if (!re.test(s)) throw new Error('marker not found: ' + re); s = s.replace(re, () => text); };
if (s.includes('<!-- parts:start -->')) swap(/<!-- parts:start -->[\s\S]*?<!-- parts:end -->/, table);
else s = s.replace('\n### Sketches (`kind: "sketch"`)', `\n${table}\n\n### Sketches (\`kind: "sketch"\`)`);
const base = ['box', 'cyl', 'sphere', 'cone', 'torus', 'wedge', 'pyramid', 'tube', 'prism', 'text', 'thread', 'extrusion', 'washer', 'standoff', 'screwhole', 'nuttrap', 'insert', 'sketch'];
const all = [...new Set([...base, ...kinds])];
const kl = `# parts:kinds:start\nKINDS = {${all.map((k) => `'${k}'`).join(',')}}\n# parts:kinds:end`;
if (s.includes('# parts:kinds:start')) swap(/# parts:kinds:start[\s\S]*?# parts:kinds:end/, kl);
else swap(/KINDS = \{[^}]*\}/, kl);
swap(/\| extrusion \| `size` `t2020`\/`t2040` \(T-slot\) or `v2020`\/`v2040`\/`v4040` \(V-slot\), exact profiles; `len` 100 \|/, '| extrusion | `size` `t2020`/`t2040`/`t2060`/`t3030`/`t4040` (T-slot) or `v2020`/`v2040`/`v2060`/`v2080`/`v4040` (V-slot), exact profiles (3030: typical dimensions); `len` 100 |');
if (crlf) s = s.replace(/\n/g, '\r\n');
fs.writeFileSync(file, s);
console.log(`SKILL.md: ${kinds.length} ready-made parts listed`);

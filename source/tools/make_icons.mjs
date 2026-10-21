// Writes icons/originals/*.svg (the built-in button pictures) and icons/README.txt next to 3DJames.html.
import * as L from 'lucide';
import fs from 'fs';
const out = process.argv[2] || 'local/icons';
const dom = fs.readFileSync('src/ui/dom.js', 'utf8');
const names = dom.match(/const LUCIDE = \{([\s\S]*?)\};/)[1].split(',').map((s) => s.trim()).filter(Boolean);
const file = (n) => n.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z]{2,})(\d)/g, '$1-$2').toLowerCase() + '.svg';
// what each picture is used for, read from the ribbon and menus
const uses = {};
for (const f of ['src/ui/ribbon.js', 'src/ui/props.js', 'src/ui/panels.js', 'src/ui/bars.js']) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:cb\('[^']*',\s*|mi\(|subMenu\(|ic\()'([A-Za-z0-9]+)'(?:\)?,\s*'([^']+)')?/g)) {
    if (!m[2]) continue;
    (uses[m[1]] ||= new Set()).add(m[2].replace(/\.\.\.$/, ''));
  }
}
const shapes = { Box: 'Cube', Cylinder: 'Cylinder', Circle: 'Sphere', Cone: 'Cone', Torus: 'Torus', TriangleRight: 'Wedge', Pyramid: 'Pyramid', CircleDot: 'Tube', Hexagon: 'Hexagon', Type: 'Text', Bolt: 'Thread' };
for (const [k, v] of Object.entries(shapes)) (uses[k] ||= new Set()).add(v);
fs.mkdirSync(`${out}/originals`, { recursive: true });
const attr = (o) => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
const lines = [];
for (const n of names) {
  const node = L[n]; if (!node) continue;
  const body = node.map(([tag, a]) => `  <${tag} ${attr(a)}/>`).join('\n');
  fs.writeFileSync(`${out}/originals/${file(n)}`, `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">\n${body}\n</svg>\n`);
  lines.push(`${file(n).padEnd(30)} ${[...(uses[n] || [])].slice(0, 6).join(', ') || '(small buttons and lists)'}`);
}
fs.writeFileSync(`${out}/README.txt`, `3DJames button pictures
=======================

To change a button's picture:
  1. Copy its file from the "originals" folder into this "icons" folder (next to this README).
  2. Edit it in Inkscape (or any drawing app that saves .svg).
     Or draw your own in Paint and save it as PNG with the same name, like box.png.
  3. Restart 3DJames. It uses your picture; delete your copy to get the original back.

Draw dark lines on a see-through or white background, square (24 x 24, or 48 x 48 for PNG).
In dark mode 3DJames turns black into white for you. Keep the exact file name.

File                           Used for
------------------------------ -------------------------------------------------------
${lines.join('\n')}
`);
console.log(names.length, 'icons');

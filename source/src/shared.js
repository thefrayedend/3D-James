// Shared definitions used by both the UI and the geometry worker.
import { PART_SHAPES } from './catalog.js';

// ---------- Expression evaluator (no eval; small recursive-descent parser) ----------
const FUNCS = {
  sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180),
  tan: (d) => Math.tan((d * Math.PI) / 180), sqrt: Math.sqrt, abs: Math.abs,
  min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil,
};
const CONSTS = { pi: Math.PI, PI: Math.PI };

export function evalExpr(src, scope = {}) {
  if (typeof src === 'number') return src;
  if (typeof src === 'boolean') return src ? 1 : 0;
  const s = String(src ?? '').trim();
  if (s === '') throw new Error('Empty value');
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return parseFloat(s);
  let i = 0;
  const peek = () => { while (s[i] === ' ') i++; return s[i]; };
  const expect = (c) => { if (peek() !== c) throw new Error(`Expected "${c}"`); i++; };
  function primary() {
    const c = peek();
    if (c === '(') { i++; const v = add(); expect(')'); return v; }
    if (c === '-') { i++; return -power(); }
    if (c === '+') { i++; return power(); }
    const num = /^(\d+\.?\d*|\.\d+)(e[-+]?\d+)?/i.exec(s.slice(i));
    if (num) { i += num[0].length; return parseFloat(num[0]); }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (id) {
      i += id[0].length; const name = id[0];
      if (peek() === '(') {
        const f = FUNCS[name]; if (!f) throw new Error(`Unknown function "${name}"`);
        i++; const args = [];
        if (peek() !== ')') { args.push(add()); while (peek() === ',') { i++; args.push(add()); } }
        expect(')'); return f(...args);
      }
      if (name in scope) return scope[name];
      if (name in CONSTS) return CONSTS[name];
      throw new Error(`Unknown name "${name}"`);
    }
    throw new Error('Could not read this value');
  }
  function power() { let b = primary(); if (peek() === '^') { i++; b = Math.pow(b, power()); } return b; }
  function mul() {
    let v = power();
    for (;;) { const c = peek(); if (c === '*') { i++; v *= power(); } else if (c === '/') { i++; v /= power(); } else if (c === '%') { i++; v %= power(); } else return v; }
  }
  function add() {
    let v = mul();
    for (;;) { const c = peek(); if (c === '+') { i++; v += mul(); } else if (c === '-') { i++; v -= mul(); } else return v; }
  }
  const v = add();
  if (peek() !== undefined) throw new Error(`Unexpected "${s[i]}"`);
  if (!Number.isFinite(v)) throw new Error('Result is not a number');
  return v;
}

export function varScope(vars = []) {
  const scope = {};
  for (const v of vars) {
    if (!v.name) continue;
    try { scope[v.name] = evalExpr(v.expr, scope); } catch { /* reported in UI */ }
  }
  return scope;
}

// ---------- Threads ----------
// [label, majorDiameter, pitch, hexAcrossFlats]
export const THREADS = [
  ['M2', 2, 0.4, 4], ['M2.5', 2.5, 0.45, 5], ['M3', 3, 0.5, 5.5], ['M4', 4, 0.7, 7], ['M5', 5, 0.8, 8],
  ['M6', 6, 1, 10], ['M8', 8, 1.25, 13], ['M10', 10, 1.5, 17], ['M12', 12, 1.75, 19], ['M14', 14, 2, 22],
  ['M16', 16, 2, 24], ['M20', 20, 2.5, 30], ['M24', 24, 3, 36], ['M30', 30, 3.5, 46],
  ['#6-32', 3.505, 0.794, 7.94], ['#8-32', 4.166, 0.794, 8.73], ['#10-24', 4.826, 1.058, 9.53],
  ['1/4"-20', 6.35, 1.27, 11.11], ['5/16"-18', 7.938, 1.411, 12.7], ['3/8"-16', 9.525, 1.5875, 14.29],
  ['1/2"-13', 12.7, 1.954, 19.05],
];

// ---------- Hardware (standard sizes; every number stays editable afterwards) ----------
// washers: ISO 7089 (inner, outer, thickness)
// screw holes: ISO 273 medium clearance, countersink for ISO 10642 flat heads (90°), counterbore for ISO 4762 socket heads
// nut traps: ISO 4032 hex nuts (across flats, thickness) + 0.2 mm print clearance
// heat-set inserts: typical sizes of the common short brass inserts for 3D prints (check your inserts' datasheet)
export const HARDWARE = {
  washer: { M2: { id: 2.2, od: 5, t: 0.3 }, 'M2.5': { id: 2.7, od: 6, t: 0.5 }, M3: { id: 3.2, od: 7, t: 0.5 }, M4: { id: 4.3, od: 9, t: 0.8 }, M5: { id: 5.3, od: 10, t: 1 }, M6: { id: 6.4, od: 12, t: 1.6 }, M8: { id: 8.4, od: 16, t: 1.6 }, M10: { id: 10.5, od: 20, t: 2 }, M12: { id: 13, od: 24, t: 2.5 } },
  screwhole: { M2: { d: 2.4, hd: 4.4, hk: 2.2 }, 'M2.5': { d: 2.9, hd: 5.5, hk: 2.7 }, M3: { d: 3.4, hd: 6.72, hk: 3.3 }, M4: { d: 4.5, hd: 8.96, hk: 4.3 }, M5: { d: 5.5, hd: 11.2, hk: 5.3 }, M6: { d: 6.6, hd: 13.44, hk: 6.3 }, M8: { d: 9, hd: 17.92, hk: 8.3 } },
  nuttrap: { M2: { af: 4.2, m: 1.8, d: 2.4 }, 'M2.5': { af: 5.2, m: 2.2, d: 2.9 }, M3: { af: 5.7, m: 2.6, d: 3.4 }, M4: { af: 7.2, m: 3.4, d: 4.5 }, M5: { af: 8.2, m: 4.9, d: 5.5 }, M6: { af: 10.2, m: 5.4, d: 6.6 }, M8: { af: 13.2, m: 7, d: 9 } },
  insert: { M2: { d: 3.2, depth: 4 }, 'M2.5': { d: 3.6, depth: 5 }, M3: { d: 4, depth: 6 }, M4: { d: 5.6, depth: 9 }, M5: { d: 6.4, depth: 10.5 } },
  standoff: { M2: { od: 5, hole: 1.7, h: 6 }, 'M2.5': { od: 5.5, hole: 2.1, h: 6 }, M3: { od: 6, hole: 2.5, h: 6 }, M4: { od: 8, hole: 3.3, h: 8 }, M5: { od: 9, hole: 4.2, h: 8 } },
};
// counterbore diameter for a socket head (head diameter + clearance)
export const CBORE = { M2: 4.4, 'M2.5': 5.5, M3: 6.5, M4: 8, M5: 10, M6: 11, M8: 15 };
export const HOLE_KINDS = new Set(['screwhole', 'nuttrap', 'insert']);
export function HARDWARE_DEFAULTS(kind, size) { const v = { ...HARDWARE[kind][size] }; if (kind === 'screwhole') v.cb = CBORE[size]; return v; }
const sizes = (k) => Object.keys(HARDWARE[k]).map((s) => [s, s]);

// field: [key, label, type, extra]
// ---------- Shape catalogue ----------
export const SHAPES = {
  box: { label: 'Box', defaults: { w: 20, d: 20, h: 20, round: 0, roundMode: 'all' },
    fields: [['w', 'Width (X)', 'num'], ['d', 'Depth (Y)', 'num'], ['h', 'Height (Z)', 'num'], ['round', 'Round edges', 'num'],
      ['roundMode', 'Round which edges', 'select', [['all', 'All edges'], ['vertical', 'Vertical corners'], ['top', 'Top edges']]]] },
  cyl: { label: 'Cylinder', defaults: { d: 20, h: 20 }, fields: [['d', 'Diameter', 'num'], ['h', 'Height', 'num']] },
  sphere: { label: 'Sphere', defaults: { d: 20 }, fields: [['d', 'Diameter', 'num']] },
  cone: { label: 'Cone', defaults: { d1: 20, d2: 0, h: 20 }, fields: [['d1', 'Bottom diameter', 'num'], ['d2', 'Top diameter', 'num'], ['h', 'Height', 'num']] },
  torus: { label: 'Torus', defaults: { D: 24, d: 6 }, fields: [['D', 'Ring diameter', 'num'], ['d', 'Tube diameter', 'num']] },
  wedge: { label: 'Wedge', defaults: { w: 20, d: 20, h: 20 }, fields: [['w', 'Length (X)', 'num'], ['d', 'Width (Y)', 'num'], ['h', 'Height (Z)', 'num']] },
  pyramid: { label: 'Pyramid', defaults: { n: 4, d: 20, h: 20 }, fields: [['n', 'Sides', 'int'], ['d', 'Base diameter', 'num'], ['h', 'Height', 'num']] },
  tube: { label: 'Tube', defaults: { od: 20, id: 14, h: 20 }, fields: [['od', 'Outer diameter', 'num'], ['id', 'Inner diameter', 'num'], ['h', 'Height', 'num']] },
  prism: { label: 'Polygon', defaults: { n: 6, af: 20, h: 10 }, fields: [['n', 'Sides', 'int'], ['af', 'Width across flats', 'num'], ['h', 'Height', 'num']] },
  text: { label: 'Text', defaults: { text: 'Text', size: 10, depth: 3, font: 'sans' },
    fields: [['text', 'Text', 'text'], ['size', 'Letter height', 'num'], ['depth', 'Thickness', 'num'],
      ['font', 'Font', 'select', [['sans', 'Sans bold'], ['round', 'Geometric bold']]]] },
  thread: { label: 'Thread', defaults: { size: 'M8', D: 8, P: 1.25, len: 16, kind: 'bolt', clear: 0.15, head: 'hex', headH: 5.5, af: 13, nutH: 6.5, chamfer: true },
    fields: [
      ['kind', 'Make', 'select', [['bolt', 'Bolt (outside thread)'], ['nut', 'Nut'], ['cutter', 'Threaded hole cutter']]],
      ['size', 'Size', 'select', [...THREADS.map((t) => [t[0], t[0]]), ['custom', 'Custom']]],
      ['D', 'Major diameter', 'num'], ['P', 'Pitch', 'num'], ['len', 'Thread length', 'num', { show: (p) => p.kind !== 'nut' }],
      ['clear', 'Print clearance', 'num'],
      ['head', 'Head', 'select', [['none', 'None (threaded rod)'], ['hex', 'Hex'], ['round', 'Round']], { show: (p) => p.kind === 'bolt' }],
      ['headH', 'Head height', 'num', { show: (p) => p.kind === 'bolt' && p.head !== 'none' }],
      ['af', 'Hex across flats', 'num', { show: (p) => (p.kind === 'bolt' && p.head !== 'none') || p.kind === 'nut' }],
      ['nutH', 'Nut height', 'num', { show: (p) => p.kind === 'nut' }],
      ['chamfer', 'Chamfer thread ends', 'bool']] },
  extrusion: { label: 'Aluminum extrusion', defaults: { size: 't2020', len: 100 },
    fields: [['size', 'Profile', 'select', [['t2020', 'T-slot 2020'], ['t2040', 'T-slot 2040'], ['v2020', 'V-slot 2020'], ['v2040', 'V-slot 2040'], ['v4040', 'V-slot 4040']]], ['len', 'Length', 'num']] },
  washer: { label: 'Washer', defaults: { size: 'M3', ...HARDWARE_DEFAULTS('washer', 'M3') },
    fields: [['size', 'Size', 'select', sizes('washer')], ['id', 'Inner diameter', 'num'], ['od', 'Outer diameter', 'num'], ['t', 'Thickness', 'num']] },
  screwhole: { label: 'Screw hole', defaults: { size: 'M3', head: 'countersunk', len: 10, ...HARDWARE_DEFAULTS('screwhole', 'M3') },
    fields: [['size', 'Size', 'select', sizes('screwhole')], ['head', 'Head', 'select', [['plain', 'Plain hole'], ['countersunk', 'Countersunk (flat head)'], ['counterbore', 'Counterbored (socket head)']]],
      ['d', 'Hole diameter', 'num'], ['len', 'Depth', 'num'], ['hd', 'Countersink diameter', 'num', { show: (p) => p.head === 'countersunk' }],
      ['cb', 'Counterbore diameter', 'num', { show: (p) => p.head === 'counterbore' }], ['hk', 'Counterbore depth', 'num', { show: (p) => p.head === 'counterbore' }]] },
  nuttrap: { label: 'Nut trap', defaults: { size: 'M3', len: 10, ...HARDWARE_DEFAULTS('nuttrap', 'M3') },
    fields: [['size', 'Size', 'select', sizes('nuttrap')], ['af', 'Nut across flats', 'num'], ['m', 'Nut pocket depth', 'num'], ['d', 'Screw hole diameter', 'num'], ['len', 'Screw hole depth', 'num']] },
  insert: { label: 'Heat-set insert hole', defaults: { size: 'M3', ...HARDWARE_DEFAULTS('insert', 'M3') },
    fields: [['size', 'Size', 'select', sizes('insert')], ['d', 'Hole diameter', 'num'], ['depth', 'Depth', 'num']] },
  standoff: { label: 'Standoff', defaults: { size: 'M3', ...HARDWARE_DEFAULTS('standoff', 'M3') },
    fields: [['size', 'Screw size', 'select', sizes('standoff')], ['od', 'Outer diameter', 'num'], ['hole', 'Hole diameter', 'num'], ['h', 'Height', 'num']] },
  import: { label: 'Imported model', defaults: {}, fields: [] },
  // drawn outlines (Insert > Sketch): loops of points or circles, made solid at a height
  sketch: { label: 'Sketch', defaults: { loops: [], h: 10 },
    fields: [['mode', 'Made solid by', 'select', [['extrude', 'Pushing it up'], ['revolve', 'Spinning it around the green line'], ['loft', 'Loft: one outline to the other'], ['sweep', 'Sweep along the helper lines']]],
      ['h', 'Height', 'num', { show: (p) => !p.mode || p.mode === 'extrude' || p.mode === 'loft' }], ['angle', 'Turn (degrees)', 'num', { show: (p) => p.mode === 'revolve' }],
      ['flip', 'Loft: swap bottom and top', 'bool', { show: (p) => p.mode === 'loft' }], ['ruled', 'Loft: straight sides (no curving)', 'bool', { show: (p) => p.mode === 'loft' }]] },
  ...PART_SHAPES,
};

// Aluminum extrusion profiles, all on the common 20 mm grid.
// V-slot: the OpenBuilds V-Slot 20 cross-section, as published in the MIT-licensed bd_vslot library (James Keal).
// T-slot: the standard "European" 2020 (6.2 mm slot opening, 1.8 mm lip, 11 mm inner channel, 7.8 mm core,
// 4.2 mm center hole for an M5 tap, 1.5 mm outer corner radius), the usual low-cost T-slot stock.
export const EXTRUSIONS = {
  t2020: { label: 'T-slot 2020', kind: 't', cells: [[1]] },
  t2040: { label: 'T-slot 2040', kind: 't', cells: [[1, 1]] },
  v2020: { label: 'V-slot 2020', kind: 'v', cells: [[1]] },
  v2040: { label: 'V-slot 2040', kind: 'v', cells: [[1, 1]] },
  v4040: { label: 'V-slot 4040', kind: 'v', cells: [[1, 1], [1, 1]] },
};
// half of each slot (cell center at 0,0, slot opening on the +x side), mirrored across the x axis
export const SLOT_HALF = {
  v: [[3.75, 0], [3.9, 0.15], [3.9, 2.84], [6.56, 5.5], [8.2, 5.5], [8.2, 3.125], [8.545, 3.125], [10, 4.58], [10, 0]],
  t: [[3.75, 0], [3.9, 0.15], [3.9, 2.84], [6.56, 5.5], [8.2, 5.5], [8.2, 3.1], [10, 3.1], [10, 0]],
};
// hollows where two cells join (+x side), from the same V-slot drawing; T-slot cores are the same
export const JOIN_CAVITY = {
  edge: [[10, 0], [3.9, 0], [3.9, 3.16], [7.3, 6.56], [7.3, 8.2], [10, 8.2]],
  corner: [[10, 0], [3.9, 0], [3.9, 2.84], [9.26, 8.2], [10, 8.2]],
  center: [[10, 0], [3.9, 0], [3.9, 2.84], [3.37, 3.37], [10, 10]],
};
// projects from the first version used plain sizes; they were T-slot
export const EXTRUSION_ALIAS = { 2020: 't2020', 2040: 't2040', 3030: 't2020', 4040: 'v4040' };

export function threadDefaults(label) {
  const t = THREADS.find((x) => x[0] === label);
  if (!t) return null;
  const [, D, P, af] = t;
  return { D, P, af, headH: +(D * 0.7).toFixed(2), nutH: +(D * 0.8).toFixed(2) };
}

// The Windows Paint colors, in Paint's order (two rows of ten).
export const PALETTE = [
  '#000000', '#7F7F7F', '#880015', '#ED1C24', '#FF7F27', '#FFF200', '#22B14C', '#00A2E8', '#3F48CC', '#A349A4',
  '#FFFFFF', '#C3C3C3', '#B97A57', '#FFAEC9', '#FFC90E', '#EFE4B0', '#B5E61D', '#99D9EA', '#7092BE', '#C8BFE7',
];
// colors given in turn to objects that have no shape color of their own (imports, parts)
export const AUTO_COLORS = ['#00A2E8', '#FF7F27', '#22B14C', '#ED1C24', '#A349A4', '#FFC90E', '#3F48CC', '#B97A57', '#7092BE', '#FFAEC9'];
export const PLAIN_COLOR = '#C3C3C3'; // an object with no color set

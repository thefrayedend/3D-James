// Ready-made maker parts with standard sizes: screws, nuts, bearings, pins, rods, magnets, standoffs.
// They are plain solids (no thread detail) so they are fast and easy to place; the Thread tool makes real threads.
// Every number can still be changed in Properties after the part is added.

export const METRIC = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10'];
const D = { M2: 2, 'M2.5': 2.5, M3: 3, M4: 4, M5: 5, M6: 6, M8: 8, M10: 10, M12: 12 };

// screws: head diameter dk, head height k, hex key size s
const SOCKET = { M2: [3.8, 2, 1.5], 'M2.5': [4.5, 2.5, 2], M3: [5.5, 3, 2.5], M4: [7, 4, 3], M5: [8.5, 5, 4], M6: [10, 6, 5], M8: [13, 8, 6], M10: [16, 10, 8] }; // ISO 4762
const BUTTON = { M3: [5.7, 1.65, 2], M4: [7.6, 2.2, 2.5], M5: [9.5, 2.75, 3], M6: [10.5, 3.3, 4], M8: [14, 4.4, 5], M10: [17.5, 5.5, 6] }; // ISO 7380
const FLAT = { M3: [6.72, 1.86, 2], M4: [8.96, 2.48, 2.5], M5: [11.2, 3.1, 3], M6: [13.44, 3.72, 4], M8: [17.92, 4.96, 5], M10: [22.4, 6.2, 6] }; // ISO 10642
const HEXHEAD = { M3: [5.5, 2], M4: [7, 2.8], M5: [8, 3.5], M6: [10, 4], M8: [13, 5.3], M10: [16, 6.4] }; // ISO 4017: across flats, head height
const SETSCREW = { M3: 1.5, M4: 2, M5: 2.5, M6: 3, M8: 4, M10: 5 }; // ISO 4026 hex key
export const SCREW_TYPES = {
  socket: { label: 'Socket head (ISO 4762)', sizes: Object.keys(SOCKET) },
  button: { label: 'Button head (ISO 7380)', sizes: Object.keys(BUTTON) },
  flat: { label: 'Countersunk / flat head (ISO 10642)', sizes: Object.keys(FLAT) },
  hex: { label: 'Hex head bolt (ISO 4017)', sizes: Object.keys(HEXHEAD) },
  set: { label: 'Set screw / grub screw (ISO 4026)', sizes: Object.keys(SETSCREW) },
};
export const SCREW_LENGTHS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80];
const DEFAULT_LEN = { M2: 8, 'M2.5': 8, M3: 10, M4: 12, M5: 16, M6: 20, M8: 25, M10: 30 };
function screwPreset(type, size) {
  const d = D[size];
  if (type === 'socket') { const [dk, k, s] = SOCKET[size]; return { d, dk, k, s }; }
  if (type === 'button') { const [dk, k, s] = BUTTON[size]; return { d, dk, k, s }; }
  if (type === 'flat') { const [dk, k, s] = FLAT[size]; return { d, dk, k, s }; }
  if (type === 'hex') { const [s, k] = HEXHEAD[size]; return { d, dk: s, k, s }; }
  return { d, dk: d, k: 0, s: SETSCREW[size] };
}

// nuts: across flats, height. Regular ISO 4032, nylon insert DIN 985, thin ISO 4035
const NUT_AF = { M2: 4, 'M2.5': 5, M3: 5.5, M4: 7, M5: 8, M6: 10, M8: 13, M10: 16, M12: 18 };
const NUT_H = {
  regular: { M2: 1.6, 'M2.5': 2, M3: 2.4, M4: 3.2, M5: 4.7, M6: 5.2, M8: 6.8, M10: 8.4, M12: 10.8 },
  nylock: { M3: 4, M4: 5, M5: 5, M6: 6, M8: 8, M10: 10, M12: 12 },
  thin: { M3: 1.8, M4: 2.2, M5: 2.7, M6: 3.2, M8: 4, M10: 5, M12: 6 },
};
export const NUT_TYPES = {
  regular: { label: 'Hex nut (ISO 4032)', sizes: Object.keys(NUT_H.regular) },
  nylock: { label: 'Nylon lock nut (DIN 985)', sizes: Object.keys(NUT_H.nylock) },
  thin: { label: 'Thin nut / jam nut (ISO 4035)', sizes: Object.keys(NUT_H.thin) },
};

// bearings: bore, outside diameter, width (+ flange diameter, flange thickness)
export const BEARINGS = {
  623: [3, 10, 4], 624: [4, 13, 5], 625: [5, 16, 5], 626: [6, 19, 6], 608: [8, 22, 7], 688: [8, 16, 5], 6800: [10, 19, 5],
  6000: [10, 26, 8], 6001: [12, 28, 8], 6002: [15, 32, 9], 6200: [10, 30, 9], 6201: [12, 32, 10], 6202: [15, 35, 11],
  F623: [3, 10, 4, 11.5, 1], F624: [4, 13, 5, 15, 1], F625: [5, 16, 5, 18, 1], F608: [8, 22, 7, 25, 1.5], F688: [8, 16, 5, 18, 1.1],
  LM6UU: [6, 12, 19], LM8UU: [8, 15, 24], LM10UU: [10, 19, 29], LM12UU: [12, 21, 30],
};
export const BEARING_GROUPS = {
  'Ball bearings': ['608', '623', '624', '625', '626', '688', '6800', '6000', '6001', '6002', '6200', '6201', '6202'],
  'Flanged bearings': ['F623', 'F624', 'F625', 'F608', 'F688'],
  'Linear bearings': ['LM6UU', 'LM8UU', 'LM10UU', 'LM12UU'],
};

// pins, rods, magnets, standoffs
export const DOWELS = [2, 3, 4, 5, 6, 8]; // ISO 8734 diameters
export const RODS = [3, 4, 5, 6, 8, 10, 12];
export const MAGNETS = ['3x2', '5x2', '6x2', '6x3', '8x2', '8x3', '10x2', '10x3', '10x5', '12x3', '15x3', '20x3']; // round, diameter x thickness
const STANDOFF_AF = { M2: 4, 'M2.5': 5, M3: 5, M4: 7 };
export const STANDOFF_SIZES = Object.keys(STANDOFF_AF);

/** The standard numbers for a part when its type or size is picked. */
export function presetFor(kind, p) {
  if (kind === 'screw') {
    const t = SCREW_TYPES[p.type] ? p.type : 'socket';
    const size = SCREW_TYPES[t].sizes.includes(p.size) ? p.size : SCREW_TYPES[t].sizes.includes('M3') ? 'M3' : SCREW_TYPES[t].sizes[0];
    return { type: t, size, ...screwPreset(t, size) };
  }
  if (kind === 'nut') {
    const t = NUT_TYPES[p.type] ? p.type : 'regular';
    const size = NUT_H[t][p.size] ? p.size : 'M3';
    return { type: t, size, d: D[size], af: NUT_AF[size], m: NUT_H[t][size] };
  }
  if (kind === 'bearing') {
    const [id, od, w, fd = 0, ft = 0] = BEARINGS[p.size] || BEARINGS[608];
    return { size: BEARINGS[p.size] ? p.size : '608', id, od, w, fd, ft };
  }
  if (kind === 'magnet') { const [d, h] = String(p.size || '6x3').split('x').map(Number); return { d, h }; }
  if (kind === 'hexstandoff') { const size = STANDOFF_AF[p.size] ? p.size : 'M3'; return { size, af: STANDOFF_AF[size], d: D[size] }; }
  return {};
}

const sel = (list) => list.map((v) => [String(v), String(v)]);
const screwSizes = [...new Set(Object.values(SCREW_TYPES).flatMap((t) => t.sizes))];
const headShown = (p) => p.type !== 'set';

/** Shape catalogue entries (merged into SHAPES). */
export const PART_SHAPES = {
  screw: { label: 'Screw', defaults: { type: 'socket', size: 'M3', len: 10, ...screwPreset('socket', 'M3') },
    fields: [['type', 'Type', 'select', Object.entries(SCREW_TYPES).map(([k, t]) => [k, t.label])], ['size', 'Size', 'select', sel(screwSizes)],
      ['len', 'Length (under the head; flat heads: overall)', 'num'], ['d', 'Thread diameter', 'num'],
      ['dk', 'Head diameter', 'num', { show: (p) => headShown(p) && p.type !== 'hex' }], ['k', 'Head height', 'num', { show: headShown }],
      ['s', 'Hex key / across flats', 'num']] },
  nut: { label: 'Nut', defaults: { type: 'regular', size: 'M3', ...presetFor('nut', { type: 'regular', size: 'M3' }) },
    fields: [['type', 'Type', 'select', Object.entries(NUT_TYPES).map(([k, t]) => [k, t.label])], ['size', 'Size', 'select', sel(Object.keys(NUT_AF))],
      ['af', 'Across flats', 'num'], ['m', 'Height', 'num'], ['d', 'Hole diameter', 'num']] },
  bearing: { label: 'Bearing', defaults: presetFor('bearing', { size: '608' }),
    fields: [['size', 'Bearing', 'select', sel(Object.keys(BEARINGS))], ['id', 'Bore (inside)', 'num'], ['od', 'Outside diameter', 'num'], ['w', 'Width', 'num'],
      ['fd', 'Flange diameter (0 = none)', 'num'], ['ft', 'Flange thickness', 'num', { show: (p) => +p.fd > 0 }]] },
  pin: { label: 'Dowel pin', defaults: { d: 3, len: 12 }, fields: [['d', 'Diameter', 'num'], ['len', 'Length', 'num']] },
  rod: { label: 'Smooth rod', defaults: { d: 8, len: 100 }, fields: [['d', 'Diameter', 'num'], ['len', 'Length', 'num']] },
  magnet: { label: 'Round magnet', defaults: { size: '6x3', d: 6, h: 3 }, fields: [['size', 'Size (diameter x thickness)', 'select', sel(MAGNETS)], ['d', 'Diameter', 'num'], ['h', 'Thickness', 'num']] },
  hexstandoff: { label: 'Hex standoff', defaults: { size: 'M3', af: 5, d: 3, len: 10, male: false, stud: 6 },
    fields: [['size', 'Size', 'select', sel(STANDOFF_SIZES)], ['len', 'Length', 'num'], ['af', 'Across flats', 'num'], ['d', 'Thread diameter', 'num'],
      ['male', 'Threaded stud on one end (male-female)', 'bool'], ['stud', 'Stud length', 'num', { show: (p) => !!p.male }]] },
};
export const PART_DEFAULT_LEN = DEFAULT_LEN;

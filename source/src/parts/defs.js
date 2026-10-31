// The ready-made maker parts beyond the plain hardware in catalog.js: what each one is called, its numbers (and their
// standard starting values) and where it sits in the Insert > Parts menu. The builders are in src/parts/*.js (engine
// only); this file is shared by the app, the engine and the tests.
//
// A field is [key, label, type, options]: type 'num' | 'int' | 'bool' | 'text', or 'select' with its list before the
// options. options: { show: (p) => bool, zero: true (may be 0) }.

import { BEARINGS } from '../catalog.js';
import { BOARDS, FANS, FITTINGS } from './tables.js';

const num = (key, label, opts) => [key, label, 'num', opts];
const int = (key, label, opts) => [key, label, 'int', opts];
const bool = (key, label, opts) => [key, label, 'bool', opts];
const pick = (key, label, list, opts) => [key, label, 'select', list, opts];
const opt = (list) => list.map((v) => (Array.isArray(v) ? v : [String(v), String(v)]));
const TNUT_TAP = { M3: 2.5, M4: 3.3, M5: 4.2, M6: 5, M8: 6.8 };
const tnutPreset = (p) => { const s = p.series === '3030' ? [15.5, 15, 6.2] : [9.8, 10, 4.2]; return { w: s[0], len: s[1], t: s[2], hole: TNUT_TAP[p.thread] || 4.2 }; };
const screwPreset = (p) => { const d = +p.size; return { d, dk: p.type === 'wood' ? 2 * d : 1.9 * d, k: 0.7 * d }; };
// picking a fan size fills in that size's standard numbers
const fanPreset = (p, withSide) => { const f = FANS[p.size]; return f ? { ...(withSide ? { side: +p.size } : {}), spacing: f[0], screw: f[1], open: f[2] } : {}; };

export const PART_DEFS = {
  // ---- Organizing
  gfbaseplate: { label: 'Gridfinity baseplate', defaults: { nx: 3, ny: 3, floor: 0, magnets: false },
    fields: [int('nx', 'Units wide (X, 42 mm each)', { min: 1 }), int('ny', 'Units deep (Y, 42 mm each)', { min: 1 }),
      num('floor', 'Floor under the pockets (0 = open frame)', { zero: true }), bool('magnets', 'Magnet holes (6.5 × 2.4) in the floor', { show: (p) => +p.floor >= 2.8 })] },
  gfbin: { label: 'Gridfinity bin', defaults: { nx: 2, ny: 1, nz: 3, wall: 1.2, lip: true, magnets: false, divx: 1, divy: 1 },
    fields: [int('nx', 'Units wide (X, 42 mm each)', { min: 1 }), int('ny', 'Units deep (Y, 42 mm each)', { min: 1 }), int('nz', 'Units tall (7 mm each)', { min: 1 }), num('wall', 'Wall thickness'),
      bool('lip', 'Stacking lip (2 units tall or more)'), bool('magnets', 'Magnet holes (6.5 × 2.4) underneath'),
      int('divx', 'Compartments across (X)', { min: 1 }), int('divy', 'Compartments front to back (Y)', { min: 1 })] },
  boardhook: { label: 'Wall hook', defaults: { style: 'pegboard', armLen: 40, armW: 10, armT: 4, lipH: 15, plateT: 4, pegD: 6, spacing: 25.4, pegLen: 10, pegs: 2, slotW: 5, board: 5, tabClear: 0.3, tabGap: 40 },
    fields: [pick('style', 'For', [['pegboard', 'Pegboard (6.35 mm holes, 25.4 apart)'], ['skadis', 'IKEA Skadis (5 × 15 mm slots)']]),
      num('armLen', 'Arm length (reach out from the wall)'), num('armW', 'Arm width'), num('armT', 'Arm thickness'), num('lipH', 'Lip height at the end (0 = none)', { zero: true }), num('plateT', 'Back plate thickness'),
      num('pegD', 'Peg diameter', { show: (p) => p.style !== 'skadis' }), num('spacing', 'Distance between pegs', { show: (p) => p.style !== 'skadis' }), num('pegLen', 'Peg length', { show: (p) => p.style !== 'skadis' }), int('pegs', 'Pegs (1 to 3)', { min: 1, show: (p) => p.style !== 'skadis' }),
      num('slotW', 'Slot width', { show: (p) => p.style === 'skadis' }), num('board', 'Board thickness', { show: (p) => p.style === 'skadis' }), num('tabClear', 'Tab clearance in the slot', { show: (p) => p.style === 'skadis', zero: true }), num('tabGap', 'Distance between the tabs', { show: (p) => p.style === 'skadis' })] },
  drawerdivider: { label: 'Drawer divider', defaults: { len: 200, h: 60, t: 2, slots: 3, depth: 0.5, clear: 0.25, slotsOn: 'top' },
    fields: [num('len', 'Length'), num('h', 'Height'), num('t', 'Thickness'), int('slots', 'Crossing slots (0 to 20)', { zero: true }), num('depth', 'Slot depth (fraction of the height)'), num('clear', 'Slot clearance', { zero: true }), pick('slotsOn', 'Slots are in the', [['top', 'Top edge'], ['bottom', 'Bottom edge']])] },
  lidbox: { label: 'Box with lid', defaults: { part: 'box', style: 'press', w: 80, d: 60, h: 40, wall: 2, round: 4, clear: 0.3, knuckles: 5, pin: 2 },
    fields: [pick('part', 'Part', [['box', 'The box'], ['lid', 'The lid (add it too, same sizes)']]), pick('style', 'Lid', [['press', 'Press-fit (a rim fits inside)'], ['sliding', 'Sliding (slides in from the front)'], ['hinged', 'Hinged (a pin through knuckles)']]),
      num('w', 'Width (X)'), num('d', 'Depth (Y)'), num('h', 'Height of the box'), num('wall', 'Wall thickness'), num('round', 'Round corners', { zero: true }), num('clear', 'Lid clearance', { zero: true }),
      int('knuckles', 'Hinge knuckles (odd, 3 or more)', { min: 3, show: (p) => p.style === 'hinged' }), num('pin', 'Hinge pin (1.75 filament: 2)', { show: (p) => p.style === 'hinged' })] },
  // ---- Wall mounting
  keyhole: { label: 'Keyhole slot', defaults: { head: 9, shank: 4.5, slot: 9, depth: 5, pocket: 3 },
    fields: [num('head', 'Screw head diameter'), num('shank', 'Screw shank (slot width)'), num('slot', 'Slot length'), num('depth', 'Plate thickness'), num('pocket', 'Head pocket depth on the back')] },
  screwtab: { label: 'Screw tab', defaults: { w: 20, len: 30, t: 3, hole: 4.5, csk: 9 },
    fields: [num('w', 'Width'), num('len', 'Length'), num('t', 'Thickness'), num('hole', 'Screw hole diameter'), num('csk', 'Countersink diameter (0 = none)', { zero: true })] },
  frenchcleat: { label: 'French cleat', defaults: { part: 'wall', len: 150, h: 40, t: 10, holes: 3 },
    fields: [pick('part', 'Strip', [['wall', 'The wall strip'], ['item', 'The strip for the thing you hang']]), num('len', 'Length'), num('h', 'Height'), num('t', 'Thickness (out from the wall)'), int('holes', 'Screw holes (0 to 20)', { zero: true })] },
  // ---- Cables
  cableclip: { label: 'Cable clip', defaults: { cable: 6, wall: 1.6, len: 10, gap: 0.7, hole: 3.4, base: 2 },
    fields: [num('cable', 'Cable diameter'), num('wall', 'Wall thickness'), num('len', 'Length'), num('gap', 'Opening (fraction of the cable)'), num('hole', 'Screw hole diameter (0 = none)', { zero: true }), num('base', 'Base thickness')] },
  zipanchor: { label: 'Zip-tie anchor', defaults: { tie: 4.8, tieT: 1.4, padW: 22, padD: 14, t: 2.4, hole: 3.4 },
    fields: [num('tie', 'Zip tie width'), num('tieT', 'Zip tie thickness'), num('padW', 'Pad width'), num('padD', 'Pad depth'), num('t', 'Pad thickness'), num('hole', 'Screw hole diameter (0 = none)', { zero: true })] },
  grommet: { label: 'Desk grommet', defaults: { hole: 60, thick: 25, wall: 2.5, flange: 6, flangeT: 3, clear: 0.4, slot: false },
    fields: [num('hole', 'Hole in the desk (diameter)'), num('thick', 'Desk thickness'), num('wall', 'Sleeve wall'), num('flange', 'Flange width'), num('flangeT', 'Flange thickness'), num('clear', 'Clearance', { zero: true }), bool('slot', 'Slot in the flange for plugs')] },
  chainlink: { label: 'Cable-chain link', defaults: { inW: 30, inH: 12, t: 3, pitch: 20, pin: 3, clear: 0.3 },
    fields: [num('inW', 'Inside width (for the cables)'), num('inH', 'Inside height'), num('t', 'Wall thickness'), num('pitch', 'Pin to pin distance'), num('pin', 'Pin diameter'), num('clear', 'Pin clearance', { zero: true })] },
  // ---- Electronics
  boardposts: { label: 'Board standoffs', defaults: { board: 'pi4', h: 6, od: 6, pilot: 0, pilotDepth: 5, plate: 2, margin: 3, hx: 58, hy: 49 },
    fields: [pick('board', 'Board', [...Object.entries(BOARDS).map(([k, b]) => [k, b.label]), ['custom', 'Any rectangle of 4 holes']]),
      num('hx', 'Hole distance across (X)', { show: (p) => p.board === 'custom' }), num('hy', 'Hole distance front to back (Y)', { show: (p) => p.board === 'custom' }),
      num('h', 'Post height'), num('od', 'Post diameter'), num('pilot', 'Hole in each post (0 = standard for the board)', { zero: true }), num('pilotDepth', 'Hole depth', { zero: true }),
      num('plate', 'Base plate thickness (0 = none)', { zero: true }), num('margin', 'Base plate margin round the board', { show: (p) => +p.plate > 0, zero: true })] },
  boardholes: { label: 'Board mounting holes', defaults: { board: 'pi4', d: 0, len: 10, hx: 58, hy: 49 },
    fields: [pick('board', 'Board', [...Object.entries(BOARDS).map(([k, b]) => [k, b.label]), ['custom', 'Any rectangle of 4 holes']]),
      num('hx', 'Hole distance across (X)', { show: (p) => p.board === 'custom' }), num('hy', 'Hole distance front to back (Y)', { show: (p) => p.board === 'custom' }),
      num('d', 'Hole diameter (0 = standard for the board)', { zero: true }), num('len', 'Depth')] },
  fanmount: { label: 'Fan mount plate', defaults: { size: '40', side: 40, spacing: 32, screw: 3.4, open: 37, t: 3, round: 3 }, presetOn: ['size'], preset: (p) => fanPreset(p, true),
    fields: [pick('size', 'Fan size (mm)', opt(Object.keys(FANS))), num('side', 'Plate size'), num('spacing', 'Screw hole spacing'), num('screw', 'Screw hole diameter'), num('open', 'Airflow opening'), num('t', 'Thickness'), num('round', 'Round corners', { zero: true })] },
  fanholes: { label: 'Fan holes', defaults: { size: '40', spacing: 32, screw: 3.4, open: 37, len: 4 }, presetOn: ['size'], preset: (p) => fanPreset(p, false),
    fields: [pick('size', 'Fan size (mm)', opt(Object.keys(FANS))), num('spacing', 'Screw hole spacing'), num('screw', 'Screw hole diameter'), num('open', 'Airflow opening'), num('len', 'Depth (wall thickness)')] },
  // ---- Filament and printer
  ptfehole: { label: 'PTFE push-fit hole', defaults: { fit: 'PC4-M10', len: 15, depth: 8, tap: 0, bore: 0 },
    fields: [pick('fit', 'Fitting', opt(Object.keys(FITTINGS))), num('len', 'Plate thickness'), num('depth', 'Hole for the fitting thread (depth)'), num('tap', 'Thread hole (0 = standard)', { zero: true }), num('bore', 'Tube hole (0 = standard)', { zero: true })] },
  filamentguide: { label: 'Filament guide', defaults: { bore: 2.4, len: 20, od: 8, flangeD: 20, flangeT: 3, funnel: 2.5, hole: 3.4 },
    fields: [num('bore', 'Filament hole (1.75 filament: 2.4)'), num('len', 'Length'), num('od', 'Tube diameter'), num('flangeD', 'Flange diameter'), num('flangeT', 'Flange thickness'), num('funnel', 'Funnel at the entry (0 = none)', { zero: true }), num('hole', 'Screw hole diameter (0 = none)', { zero: true })] },
  spoolaxle: { label: 'Spool axle', defaults: { d: 8, len: 120, flangeD: 75, flangeT: 4, seatD: 54, seatLen: 25 },
    fields: [num('d', 'Rod diameter'), num('len', 'Total length'), num('flangeD', 'Flange diameter'), num('flangeT', 'Flange thickness'), num('seatD', 'Seat for the spool hole (diameter)'), num('seatLen', 'Seat length')] },
  bearingmount: { label: 'Bearing mount', defaults: { bearing: '608', clear: 0.15, wall: 4, base: 4, hole: 3.4 },
    fields: [pick('bearing', 'Bearing', opt(Object.keys(BEARINGS))), num('clear', 'Pocket clearance', { zero: true }), num('wall', 'Wall round the bearing'), num('base', 'Base thickness'), num('hole', 'Screw hole diameter (0 = none)', { zero: true })] },
  bearingpocket: { label: 'Bearing pocket', defaults: { bearing: '608', clear: 0.15, len: 12 },
    fields: [pick('bearing', 'Bearing', opt(Object.keys(BEARINGS))), num('clear', 'Pocket clearance', { zero: true }), num('len', 'Plate thickness')] },
  // ---- Motion
  gt2pulley: { label: 'GT2 pulley', defaults: { teeth: 20, bore: 5, belt: 6.5, hubD: 16, hubH: 8, flat: 0, setscrew: true },
    fields: [int('teeth', 'Teeth (10 to 80)', { min: 10 }), num('bore', 'Bore diameter'), num('flat', 'Flat on the bore for a D shaft (0 = round)', { zero: true }), num('belt', 'Belt width'), num('hubD', 'Hub diameter'), num('hubH', 'Hub height (0 = none)', { zero: true }), bool('setscrew', 'Set screw hole in the hub', { show: (p) => +p.hubH > 0 })] },
  shaftcollar: { label: 'Shaft collar', defaults: { style: 'set', bore: 8, od: 18, w: 10, screw: 3.4 },
    fields: [pick('style', 'Holds with', [['set', 'A set screw'], ['clamp', 'A split and a clamp screw']]), num('bore', 'Shaft diameter'), num('od', 'Outside diameter'), num('w', 'Width'), num('screw', 'Screw hole diameter')] },
  vwheel: { label: 'V-slot wheel', defaults: { size: 'standard', od: 23.9, w: 10.2, vdepth: 2.6, lip: 1, bore: 5, seat: 16, seatDepth: 5 }, presetOn: ['size'], preset: (p) => (p.size === 'mini' ? { od: 15.2, w: 9.9, vdepth: 1.8, lip: 1.2, bore: 5, seat: 11, seatDepth: 4 } : p.size === 'standard' ? { od: 23.9, w: 10.2, vdepth: 2.6, lip: 1, bore: 5, seat: 16, seatDepth: 5 } : {}),
    fields: [pick('size', 'Size', [['standard', 'Standard (24 mm)'], ['mini', 'Mini (15 mm)'], ['custom', 'My own numbers']]), num('od', 'Outside diameter'), num('w', 'Width'), num('vdepth', 'Groove depth'), num('lip', 'Flat lip each side'), num('bore', 'Axle hole'), num('seat', 'Bearing seat diameter (0 = none)', { zero: true }), num('seatDepth', 'Bearing seat depth', { show: (p) => +p.seat > 0 })] },
  // ---- Feet
  footpocket: { label: 'Foot pocket', defaults: { d: 12, depth: 3, screw: 0, len: 10 },
    fields: [num('d', 'Foot diameter'), num('depth', 'Pocket depth'), num('screw', 'Screw hole diameter (0 = none)', { zero: true }), num('len', 'Screw hole length', { show: (p) => +p.screw > 0 })] },
  levelfoot: { label: 'Leveling foot', defaults: { baseD: 30, baseH: 5, stemD: 8, stemLen: 25, dome: 3 },
    fields: [num('baseD', 'Pad diameter'), num('baseH', 'Pad thickness'), num('dome', 'Dome height'), num('stemD', 'Stem diameter'), num('stemLen', 'Stem length')] },
  // ---- Joints
  hinge: { label: 'Hinge', defaults: { style: 'inplace', len: 40, leaf: 22, t: 3, d: 8, pin: 3, knuckles: 5, gap: 0.4, clear: 0.3, screws: 2, hole: 3.4 },
    fields: [pick('style', 'Kind', [['inplace', 'Print-in-place (comes off the printer ready to swing)'], ['pin', 'Pin hinge (you add a pin: a nail, filament)']]),
      num('len', 'Length (along the pin)'), num('leaf', 'Leaf width (from the pin)'), num('t', 'Leaf thickness'), num('d', 'Knuckle diameter'), num('pin', 'Pin diameter'), int('knuckles', 'Knuckles (odd: 3, 5, 7…)', { min: 3 }),
      num('gap', 'Gap between knuckles', { zero: true }), num('clear', 'Clearance round the pin', { zero: true }), int('screws', 'Screw holes in each leaf (0 = none)', { zero: true }), num('hole', 'Screw hole diameter', { show: (p) => +p.screws > 0 })] },
  dovetail: { label: 'Dovetail tail', defaults: { len: 30, w: 14, h: 6, angle: 15, base: 3 },
    fields: [num('len', 'Length'), num('w', 'Width at the top of the tail'), num('h', 'Tail height'), num('angle', 'Side angle (degrees)'), num('base', 'Base plate thickness (0 = tail only)', { zero: true })] },
  dovetailslot: { label: 'Dovetail slot', defaults: { len: 30, w: 14, h: 6, angle: 15, clear: 0.2 },
    fields: [num('len', 'Length'), num('w', 'Width of the tail it takes'), num('h', 'Tail height'), num('angle', 'Side angle (degrees)'), num('clear', 'Clearance', { zero: true })] },
  peg: { label: 'Peg', defaults: { d: 8, len: 12, chamfer: 1, baseD: 16, baseH: 3 },
    fields: [num('d', 'Peg diameter'), num('len', 'Peg length'), num('chamfer', 'Rounded tip', { zero: true }), num('baseD', 'Base disc diameter (0 = none)', { zero: true }), num('baseH', 'Base disc thickness', { show: (p) => +p.baseD > 0 })] },
  pegsocket: { label: 'Peg socket', defaults: { d: 8, depth: 12, clear: 0.2, chamfer: 0.8 },
    fields: [num('d', 'Peg diameter'), num('depth', 'Depth'), num('clear', 'Clearance', { zero: true }), num('chamfer', 'Lead-in at the top', { zero: true })] },
  balljoint: { label: 'Ball joint', defaults: { d: 14, stem: 6, stemLen: 14, wall: 3, clear: 0.35, postD: 10, postLen: 8 },
    fields: [num('d', 'Ball diameter'), num('stem', 'Stem diameter'), num('stemLen', 'Stem length above the ball'), num('wall', 'Socket wall'), num('clear', 'Gap round the ball', { zero: true }), num('postD', 'Socket post diameter'), num('postLen', 'Socket post length')] },
  ujoint: { label: 'Universal joint', defaults: { size: 14, pin: 4, armT: 4, armW: 12, clear: 0.4, shaft: 8, shaftLen: 20 },
    fields: [num('size', 'Middle block size'), num('pin', 'Pin diameter'), num('armT', 'Fork arm thickness'), num('armW', 'Fork arm width'), num('clear', 'Gap round the pins', { zero: true }), num('shaft', 'Shaft diameter'), num('shaftLen', 'Shaft length')] },
  shafthole: { label: 'Shaft hole', defaults: { type: 'd', d: 5, len: 12, flat: 0.5, kw: 2, kd: 1, clear: 0.1 },
    fields: [pick('type', 'Shape', [['d', 'D (one flat)'], ['dd', 'Double D (two flats)'], ['keyway', 'Round with a key slot'], ['round', 'Round']]), num('d', 'Shaft diameter'), num('len', 'Depth'),
      num('flat', 'Flat depth', { show: (p) => p.type === 'd' || p.type === 'dd' }), num('kw', 'Key slot width', { show: (p) => p.type === 'keyway' }), num('kd', 'Key slot depth', { show: (p) => p.type === 'keyway' }), num('clear', 'Clearance', { zero: true })] },
  boss: { label: 'Screw boss', defaults: { od: 8, h: 12, hole: 2.5, depth: 8, ribs: 4, ribT: 1.6, ribH: 0.7, ribL: 8 },
    fields: [num('od', 'Post diameter'), num('h', 'Height'), num('hole', 'Pilot hole diameter'), num('depth', 'Pilot hole depth'), int('ribs', 'Ribs round it (0 to 8)', { zero: true }), num('ribT', 'Rib thickness', { show: (p) => +p.ribs > 0 }), num('ribH', 'Rib height (fraction of the post)', { show: (p) => +p.ribs > 0 }), num('ribL', 'Rib reach out', { show: (p) => +p.ribs > 0 })] },
  rib: { label: 'Rib (gusset)', defaults: { w: 20, h: 20, t: 3 }, fields: [num('w', 'Base length'), num('h', 'Height'), num('t', 'Thickness')] },
  // ---- Knobs and handles
  knob: { label: 'Knob', defaults: { style: 'knurl', d: 30, h: 16, teeth: 20, depth: 1.5, bore: 6, flat: 0, trapAF: 0, trapH: 3, setscrew: false },
    fields: [pick('style', 'Grip', [['knurl', 'Knurled (V teeth)'], ['scallop', 'Scalloped (round dents)'], ['round', 'Plain round']]), num('d', 'Diameter'), num('h', 'Height'),
      int('teeth', 'Teeth or dents', { min: 3, show: (p) => p.style !== 'round' }), num('depth', 'Tooth or dent depth', { show: (p) => p.style !== 'round' }),
      num('bore', 'Shaft hole diameter'), num('flat', 'Flat on the shaft hole for a D shaft (0 = round)', { zero: true }), num('trapAF', 'Nut pocket underneath: nut across flats (0 = none)', { zero: true }), num('trapH', 'Nut pocket depth', { show: (p) => +p.trapAF > 0 }), bool('setscrew', 'Set screw hole in the side')] },
  thumbscrew: { label: 'Thumbscrew', defaults: { head: 'wing', hd: 30, hh: 8, d: 5, len: 20 },
    fields: [pick('head', 'Head', [['wing', 'Wing'], ['knurl', 'Knurled disc'], ['hex', 'Hex']]), num('hd', 'Head width'), num('hh', 'Head height'), num('d', 'Shaft diameter'), num('len', 'Shaft length')] },
  drawerpull: { label: 'Drawer pull', defaults: { spacing: 96, barD: 12, reach: 30, postD: 10, hole: 3.3, holeDepth: 15 },
    fields: [num('spacing', 'Screw spacing (center to center)'), num('barD', 'Bar diameter'), num('reach', 'Stands out from the drawer'), num('postD', 'Post diameter'), num('hole', 'Screw hole diameter (0 = none)', { zero: true }), num('holeDepth', 'Screw hole depth', { show: (p) => +p.hole > 0 })] },
  // ---- Print helpers
  snapfit: { label: 'Snap-fit clip', defaults: { w: 10, len: 15, t: 1.6, hook: 1.2, hookH: 2.5, baseD: 8, baseH: 4 },
    fields: [num('w', 'Width'), num('len', 'Beam length'), num('t', 'Beam thickness'), num('hook', 'Hook reach'), num('hookH', 'Hook height'), num('baseD', 'Base depth'), num('baseH', 'Base thickness')] },
  tolerancetest: { label: 'Tolerance test', defaults: { d: 8, n: 6, step: 0.1, t: 4, pegLen: 6 },
    fields: [num('d', 'Peg diameter'), int('n', 'Number of holes (2 to 12)', { min: 2 }), num('step', 'Each hole this much wider'), num('t', 'Plate thickness'), num('pegLen', 'Peg length')] },
  // ---- Gears
  gear: { label: 'Gear', defaults: { type: 'spur', m: 1.5, z: 20, w: 10, pa: 20, bore: 5, flat: 0, hubD: 0, hubH: 0, helix: 20, herring: false, mate: 40 },
    fields: [pick('type', 'Kind', [['spur', 'Spur (straight teeth)'], ['helical', 'Helical (slanted teeth)'], ['bevel', 'Bevel (for shafts at 90°)']]),
      num('m', 'Module (tooth size)'), int('z', 'Teeth', { min: 8 }), num('w', 'Thickness'), num('pa', 'Pressure angle (degrees)'),
      num('helix', 'Helix angle (degrees)', { show: (p) => p.type === 'helical' }), bool('herring', 'Herringbone (two opposed halves)', { show: (p) => p.type === 'helical' }), int('mate', 'Teeth of the gear it meshes with', { min: 6, show: (p) => p.type === 'bevel' }),
      num('bore', 'Shaft hole diameter'), num('flat', 'Flat on the shaft hole (0 = round)', { zero: true }), num('hubD', 'Hub diameter (0 = none)', { zero: true }), num('hubH', 'Hub height', { show: (p) => +p.hubD > 0 })] },
  rack: { label: 'Gear rack', defaults: { m: 1.5, teeth: 15, w: 10, base: 5, pa: 20 },
    fields: [num('m', 'Module (tooth size)'), int('teeth', 'Teeth', { min: 2 }), num('w', 'Thickness'), num('base', 'Base thickness under the teeth'), num('pa', 'Pressure angle (degrees)')] },
  worm: { label: 'Worm', defaults: { m: 1.5, starts: 1, len: 30, pitchD: 14, bore: 5, flat: 0, hand: 'right' },
    fields: [num('m', 'Module (tooth size)'), int('starts', 'Starts (1 to 4)', { min: 1 }), num('len', 'Length'), num('pitchD', 'Pitch diameter'), pick('hand', 'Winds', [['right', 'Right-handed'], ['left', 'Left-handed']]), num('bore', 'Shaft hole diameter'), num('flat', 'Flat on the shaft hole (0 = round)', { zero: true })] },
  // ---- Aluminum extrusion, profiles and fasteners
  stock: { label: 'Profile', defaults: { shape: 'tube', w: 40, d: 40, t: 3, tw: 3, len: 200 },
    fields: [pick('shape', 'Profile', [['tube', 'Square or rectangular tube'], ['ibeam', 'I-beam'], ['cchannel', 'C-channel'], ['angle', 'Angle (L)'], ['tbeam', 'T-beam'], ['flat', 'Flat bar']]),
      num('w', 'Width'), num('d', 'Depth'), num('t', 'Wall or flange thickness', { show: (p) => p.shape !== 'flat' }), num('tw', 'Web thickness', { show: (p) => ['ibeam', 'cchannel', 'tbeam'].includes(p.shape) }), num('len', 'Length')] },
  cornerbracket: { label: 'Corner bracket', defaults: { w: 20, armA: 25, armB: 25, t: 3, hole: 5.5, gusset: true },
    fields: [num('w', 'Width'), num('armA', 'Lower arm length'), num('armB', 'Upright arm length'), num('t', 'Thickness'), num('hole', 'Screw hole diameter'), bool('gusset', 'Triangular gusset')] },
  tnut: { label: 'T-nut', defaults: { series: '2020', thread: 'M5', w: 9.8, len: 10, t: 4.2, hole: 4.2 }, presetOn: ['series', 'thread'], preset: (p) => tnutPreset(p),
    fields: [pick('series', 'Extrusion', [['2020', '2020 (6 mm slot)'], ['3030', '3030 (8 mm slot)']]), pick('thread', 'Screw', opt(Object.keys(TNUT_TAP))), num('w', 'Width'), num('len', 'Length'), num('t', 'Thickness'), num('hole', 'Thread hole diameter')] },
  woodscrew: { label: 'Wood or sheet-metal screw', defaults: { type: 'wood', size: '4', len: 30, d: 4, dk: 8, k: 2.8 }, presetOn: ['size', 'type'], preset: (p) => screwPreset(p),
    fields: [pick('type', 'Kind', [['wood', 'Wood screw, countersunk'], ['pan', 'Wood screw, pan head'], ['sheet', 'Sheet-metal screw (pan head)']]), pick('size', 'Diameter (mm)', opt(['2.5', '3', '3.5', '4', '4.5', '5', '6'])),
      num('len', 'Length (countersunk: overall; pan head: under the head)'), num('d', 'Shank diameter'), num('dk', 'Head diameter'), num('k', 'Head height (pan head)', { show: (p) => p.type !== 'wood' })] },
  rivet: { label: 'Pop rivet', defaults: { size: '4', d: 4, len: 8, flangeD: 8, flangeT: 0.8, bore: 2 }, presetOn: ['size'], preset: (p) => ({ d: +p.size, flangeD: 2 * p.size, flangeT: 0.2 * p.size, bore: 0.5 * p.size }),
    fields: [pick('size', 'Diameter (mm)', opt(['3.2', '4', '4.8'])), num('d', 'Body diameter'), num('len', 'Body length'), num('flangeD', 'Flange diameter'), num('flangeT', 'Flange thickness'), num('bore', 'Mandrel hole')] },
};

/** Kinds that are holes (gray, cut out when merged): negative parts like pockets, slots and hole patterns. */
export const PART_HOLES = new Set(['keyhole', 'footpocket', 'boardholes', 'fanholes', 'ptfehole', 'bearingpocket', 'dovetailslot', 'pegsocket', 'shafthole']);

/** The Parts menu: sections of items [label, kind, starting numbers, name of the object], or { sub, items } for a flyout. */
const fans = (kind, name) => Object.keys(FANS).map((s) => [`${s} mm fan`, kind, { size: s }, name]);
const boards = (kind, name) => [...Object.entries(BOARDS).map(([k, b]) => [b.label, kind, { board: k }, name]), ['Any rectangle of 4 holes', kind, { board: 'custom' }, name]];
const bearings = (kind, name) => ['608', '623', '624', '625', '626', '688', '6000', '6001', '6200', 'F608', 'LM8UU'].map((b) => [`${b} bearing`, kind, { bearing: b, ...(kind === 'bearingpocket' ? { len: Math.ceil(BEARINGS[b][2] + 3) } : {}) }, name]);

export const PART_MENU = [
  { label: 'Organizing', icon: 'LayoutGrid', items: [
    { sub: 'Gridfinity baseplate', items: [['1 × 1', 'gfbaseplate', { nx: 1, ny: 1 }], ['2 × 2', 'gfbaseplate', { nx: 2, ny: 2 }], ['3 × 3', 'gfbaseplate', { nx: 3, ny: 3 }], ['4 × 4', 'gfbaseplate', { nx: 4, ny: 4 }], ['5 × 5', 'gfbaseplate', { nx: 5, ny: 5 }], ['With a floor and magnet holes (3 × 3)', 'gfbaseplate', { nx: 3, ny: 3, floor: 3, magnets: true }]], name: 'Gridfinity baseplate' },
    { sub: 'Gridfinity bin', items: [['1 × 1 × 3', 'gfbin', { nx: 1, ny: 1, nz: 3 }], ['2 × 1 × 3', 'gfbin', { nx: 2, ny: 1, nz: 3 }], ['2 × 2 × 3', 'gfbin', { nx: 2, ny: 2, nz: 3 }], ['3 × 2 × 4', 'gfbin', { nx: 3, ny: 2, nz: 4 }], ['4 × 2 × 6 with 4 compartments', 'gfbin', { nx: 4, ny: 2, nz: 6, divx: 2, divy: 2 }], ['With magnet holes (2 × 1 × 3)', 'gfbin', { nx: 2, ny: 1, nz: 3, magnets: true }]], name: 'Gridfinity bin' },
    { sub: 'Pegboard and Skadis hooks', items: [['Pegboard hook, 2 pegs', 'boardhook', { style: 'pegboard' }, 'Pegboard hook'], ['Pegboard hook, 1 peg', 'boardhook', { style: 'pegboard', pegs: 1, plateT: 4 }, 'Pegboard hook'], ['IKEA Skadis hook', 'boardhook', { style: 'skadis' }, 'Skadis hook']] },
    { sub: 'Drawer divider', items: [['With slots in the top edge', 'drawerdivider', { slotsOn: 'top' }], ['With slots in the bottom edge', 'drawerdivider', { slotsOn: 'bottom' }], ['Plain', 'drawerdivider', { slots: 0 }]], name: 'Drawer divider' },
    { sub: 'Box with lid', items: [['Press-fit box', 'lidbox', { part: 'box', style: 'press' }, 'Box'], ['Press-fit lid', 'lidbox', { part: 'lid', style: 'press' }, 'Lid'], ['Sliding-lid box', 'lidbox', { part: 'box', style: 'sliding' }, 'Box'], ['Sliding lid', 'lidbox', { part: 'lid', style: 'sliding' }, 'Lid'], ['Hinged box', 'lidbox', { part: 'box', style: 'hinged' }, 'Box'], ['Hinged lid', 'lidbox', { part: 'lid', style: 'hinged' }, 'Lid']] },
  ] },
  { label: 'Electronics', icon: 'Cpu', items: [
    { sub: 'Board standoffs (posts on a plate)', items: boards('boardposts', 'Board standoffs') },
    { sub: 'Board mounting holes (to cut)', items: boards('boardholes', 'Board holes') },
    { sub: 'Fan mount plate', items: fans('fanmount', 'Fan mount') },
    { sub: 'Fan holes (to cut)', items: fans('fanholes', 'Fan holes') },
  ] },
  { label: 'Joints', icon: 'Link', items: [
    ['Print-in-place hinge', 'hinge', { style: 'inplace' }, 'Hinge'], ['Pin hinge (add your own pin)', 'hinge', { style: 'pin' }, 'Hinge'],
    ['Dovetail tail', 'dovetail', {}, 'Dovetail'], ['Dovetail slot (to cut)', 'dovetailslot', {}, 'Dovetail slot'],
    ['Peg', 'peg', {}], ['Peg socket (to cut)', 'pegsocket', {}, 'Peg socket'],
    ['Ball joint (prints in place)', 'balljoint', {}, 'Ball joint'], ['Universal joint (prints in place)', 'ujoint', {}, 'Universal joint'],
    { sub: 'Shaft hole (to cut)', items: [['D shaft', 'shafthole', { type: 'd' }], ['Double D shaft', 'shafthole', { type: 'dd' }], ['Round with a key slot', 'shafthole', { type: 'keyway' }], ['Round', 'shafthole', { type: 'round' }]], name: 'Shaft hole' },
    ['Screw boss with ribs', 'boss', {}], ['Rib (gusset)', 'rib', {}],
  ] },
  { label: 'Wall mounting and cables', icon: 'Anchor', items: [
    ['Keyhole slot (to cut)', 'keyhole', {}], ['Screw tab', 'screwtab', {}],
    { sub: 'French cleat', items: [['Strip for the wall', 'frenchcleat', { part: 'wall' }, 'Wall cleat'], ['Strip for the thing you hang', 'frenchcleat', { part: 'item' }, 'Item cleat']] },
    { sub: 'Cable clip', items: [['4 mm cable', 'cableclip', { cable: 4 }], ['6 mm cable', 'cableclip', { cable: 6 }], ['8 mm cable', 'cableclip', { cable: 8 }], ['10 mm cable', 'cableclip', { cable: 10 }], ['15 mm cable (a bundle)', 'cableclip', { cable: 15 }]], name: 'Cable clip' },
    ['Zip-tie anchor', 'zipanchor', {}], ['Cable-chain link', 'chainlink', {}],
    { sub: 'Desk grommet', items: [['60 mm hole', 'grommet', { hole: 60 }], ['80 mm hole', 'grommet', { hole: 80 }], ['60 mm hole with a slot for plugs', 'grommet', { hole: 60, slot: true }]], name: 'Grommet' },
  ] },
  { label: 'Knobs, handles and feet', icon: 'Grip', items: [
    ['Knurled knob', 'knob', { style: 'knurl' }], ['Scalloped knob', 'knob', { style: 'scallop', teeth: 8, depth: 3 }], ['Plain knob', 'knob', { style: 'round' }], ['Knob with an M5 nut pocket', 'knob', { style: 'knurl', bore: 5, trapAF: 8, trapH: 4.2 }, 'Knob'],
    { sub: 'Thumbscrew', items: [['Wing head', 'thumbscrew', { head: 'wing' }], ['Knurled head', 'thumbscrew', { head: 'knurl' }], ['Hex head', 'thumbscrew', { head: 'hex' }]], name: 'Thumbscrew' },
    { sub: 'Drawer pull', items: [['64 mm holes', 'drawerpull', { spacing: 64 }], ['96 mm holes', 'drawerpull', { spacing: 96 }], ['128 mm holes', 'drawerpull', { spacing: 128 }]], name: 'Drawer pull' },
    ['Rubber foot pocket (to cut)', 'footpocket', {}], ['Leveling foot', 'levelfoot', {}],
  ] },
  { label: 'Filament and printer', icon: 'Spool', items: [
    { sub: 'PTFE push-fit hole (to cut)', items: Object.keys(FITTINGS).map((f) => [`${f} fitting`, 'ptfehole', { fit: f }, 'PTFE hole']) },
    ['Filament guide', 'filamentguide', {}], ['Spool holder axle', 'spoolaxle', {}],
    { sub: 'Bearing mount', items: bearings('bearingmount', 'Bearing mount') },
    { sub: 'Bearing pocket (to cut)', items: bearings('bearingpocket', 'Bearing pocket') },
    ['Snap-fit clip', 'snapfit', {}], ['Tolerance test', 'tolerancetest', {}], ['Print-in-place hinge', 'hinge', { style: 'inplace' }, 'Hinge'],
  ] },
  { label: 'Motion and gears', icon: 'Cog', items: [
    { sub: 'GT2 belt pulley', items: [[16, 5], [20, 5], [20, 8], [30, 5], [36, 8], [60, 8]].map(([n, b]) => [`${n} teeth, ${b} mm bore`, 'gt2pulley', { teeth: n, bore: b }, 'GT2 pulley']) },
    { sub: 'Shaft collar', items: [['5 mm shaft, set screw', 'shaftcollar', { bore: 5, od: 14, w: 8 }], ['8 mm shaft, set screw', 'shaftcollar', { bore: 8 }], ['8 mm shaft, clamp', 'shaftcollar', { bore: 8, style: 'clamp' }], ['10 mm shaft, set screw', 'shaftcollar', { bore: 10, od: 22 }]], name: 'Shaft collar' },
    { sub: 'V-slot wheel', items: [['Standard (24 mm)', 'vwheel', { size: 'standard' }], ['Mini (15 mm)', 'vwheel', { size: 'mini' }]], name: 'V-slot wheel' },
    { sub: 'Spur gear', items: [12, 16, 20, 30, 40, 60].map((z) => [`${z} teeth`, 'gear', { type: 'spur', z }, 'Spur gear']) },
    { sub: 'Helical gear', items: [[20, false], [30, false], [20, true]].map(([z, herring]) => [`${z} teeth${herring ? ', herringbone' : ''}`, 'gear', { type: 'helical', z, herring }, 'Helical gear']) },
    { sub: 'Bevel gear pair (90°)', items: [['20 teeth meshing with 20', 'gear', { type: 'bevel', z: 20, mate: 20, w: 8 }, 'Bevel gear'], ['16 teeth meshing with 32', 'gear', { type: 'bevel', z: 16, mate: 32, w: 8 }, 'Bevel gear'], ['32 teeth meshing with 16', 'gear', { type: 'bevel', z: 32, mate: 16, w: 8 }, 'Bevel gear']] },
    { sub: 'Gear rack', items: [['15 teeth', 'rack', { teeth: 15 }], ['30 teeth', 'rack', { teeth: 30 }]], name: 'Gear rack' },
    { sub: 'Worm', items: [['1 start', 'worm', { starts: 1 }], ['2 starts', 'worm', { starts: 2 }]], name: 'Worm' },
  ] },
  { label: 'Profiles, brackets and fasteners', icon: 'Frame', items: [
    { sub: 'Tube and structural profiles', items: [['Square tube 40 × 40 × 3', 'stock', { shape: 'tube' }, 'Square tube'], ['Square tube 20 × 20 × 2', 'stock', { shape: 'tube', w: 20, d: 20, t: 2 }, 'Square tube'], ['Rectangular tube 40 × 20 × 2', 'stock', { shape: 'tube', w: 40, d: 20, t: 2 }, 'Rectangular tube'],
      ['I-beam', 'stock', { shape: 'ibeam', w: 50, d: 80, t: 5, tw: 4 }, 'I-beam'], ['C-channel', 'stock', { shape: 'cchannel', w: 30, d: 50, t: 4, tw: 4 }, 'C-channel'], ['Angle iron (L)', 'stock', { shape: 'angle', w: 40, d: 40, t: 4 }, 'Angle'], ['T-beam', 'stock', { shape: 'tbeam', w: 40, d: 40, t: 4, tw: 4 }, 'T-beam'], ['Flat bar', 'stock', { shape: 'flat', w: 30, d: 5 }, 'Flat bar']] },
    ['Corner bracket', 'cornerbracket', {}],
    { sub: 'T-nut for aluminium extrusion', items: [['2020, M3', 'tnut', { series: '2020', thread: 'M3' }], ['2020, M4', 'tnut', { series: '2020', thread: 'M4' }], ['2020, M5', 'tnut', { series: '2020', thread: 'M5' }], ['3030, M5', 'tnut', { series: '3030', thread: 'M5' }], ['3030, M6', 'tnut', { series: '3030', thread: 'M6' }], ['3030, M8', 'tnut', { series: '3030', thread: 'M8' }]], name: 'T-nut' },
    { sub: 'Wood and sheet-metal screws', items: [['Wood screw, countersunk 4 × 30', 'woodscrew', { type: 'wood', size: '4' }, 'Wood screw'], ['Wood screw, countersunk 5 × 50', 'woodscrew', { type: 'wood', size: '5', len: 50 }, 'Wood screw'], ['Wood screw, pan head 4 × 30', 'woodscrew', { type: 'pan', size: '4' }, 'Wood screw'], ['Sheet-metal screw 3.5 × 16', 'woodscrew', { type: 'sheet', size: '3.5', len: 16 }, 'Sheet-metal screw'], ['Sheet-metal screw 4.2 × 19', 'woodscrew', { type: 'sheet', size: '4', len: 19 }, 'Sheet-metal screw']] },
    { sub: 'Pop rivet', items: [['3.2 mm', 'rivet', { size: '3.2' }], ['4 mm', 'rivet', { size: '4' }], ['4.8 mm', 'rivet', { size: '4.8' }]], name: 'Pop rivet' },
  ] },
];

// Sketch board: small shared helpers and the tables behind the rule buttons, badges and snaps.

export const NS = 'http://www.w3.org/2000/svg';
export const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
import { r3 } from '../shared.js';
export { r3 };
export const fmtN = (v) => String(r3(v));
export const EPS = 1e-9;
/** Two points this close are the same point (line ends join, a line that ends where it started closes). */
export const JOIN_TOL = 1e-3;
export const samePt = (a, b) => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1]) < JOIN_TOL;

export const SNAP_KINDS = [['end', 'Loose ends'], ['corner', 'Corners'], ['middle', 'Middles'], ['center', 'Centers'], ['edge', 'On lines'], ['guide', 'Line-up'], ['level', 'Level & upright'], ['grid', 'Grid']];
export const RULE_TEXT = { flat: 'Flat', upright: 'Upright', parallel: 'Parallel', square: 'Square (90°)', equal: 'Same length', length: 'Length', radius: 'Radius',
  smooth: 'Smooth join', dx: 'Left-right distance', dy: 'Up-down distance', dist: 'Straight distance',
  same: 'Joined', on: 'On line', mid: 'At the middle', pin: 'Pinned',
  anchor: 'Starting point locked', angle: 'Angle', tangent: 'Touching', eqr: 'Same size', sym: 'Mirror pair', freeze: 'Frozen', diam: 'Diameter' };
export const RULE_MARK = { flat: '—', upright: '|', parallel: '∥', square: '⊥', equal: '=', length: '🔒', radius: '🔒', smooth: '⌒', dx: '↔', dy: '↕', dist: '⟋',
  same: '●', on: '⊷', mid: '◇', pin: '📌', anchor: '⚓', angle: '∠', tangent: '⌓', eqr: '=', sym: '⇹', freeze: '❄', diam: '⌀' };
/** Rules that hold a number (they can be switched to "just showing": shown and kept up to date, but not holding). */
export const VALUE_RULES = new Set(['length', 'radius', 'dx', 'dy', 'dist', 'angle', 'diam']);

// The Rules row: [key, label, what it does in plain words]
export const RULE_BTNS = [
  ['flat', 'Flat', 'Flat: keep a line level (left-right).\nOr pick two points: they stay at the same height.'],
  ['upright', 'Upright', 'Upright: keep a line straight up and down.\nOr pick two points: one stays right above the other.'],
  ['parallel', 'Parallel', 'Parallel: two lines keep pointing the same way.'],
  ['square', 'Square', 'Square: two lines stay at 90° (a right angle) to each other.'],
  ['equal', 'Same size', 'Same size: two lines stay the same length,\nor two circles (or arcs) stay the same size.'],
  ['tangent', 'Touch', 'Touch: a line just touches a circle, or two circles just touch.\nPick a corner where an arc meets a line: they join smoothly, without a bump.'],
  ['join', 'Join', 'Join: two points stay together,\nor a point stays on a line or circle.'],
  ['sym', 'Mirror pair', 'Mirror pair: two points stay mirror images of each other,\nacross the green line, the red line, or a line you pick.'],
  ['angle', 'Angle', 'Angle: set the angle of a line (from level),\nor the angle between two lines.'],
  ['size', 'Size', 'Size: set the length of a line, the size of a circle or arc,\nor the distance between two points. It stays that size.'],
  ['freeze', 'Freeze', 'Freeze: a whole shape stays exactly where it is.\nRules and dragging can no longer move it. Use it again to unfreeze.'],
];
export const ICON_PATHS = {
  flat: ['M3 10H17', 'c3 10', 'c17 10'],
  upright: ['M10 3V17', 'c10 3', 'c10 17'],
  parallel: ['M4 16L10 4', 'M10 16L16 4'],
  square: ['M5 3V15H17', 'M5 11H9V15'],
  equal: ['M4 7.5H16', 'M4 12.5H16'],
  tangent: ['M2 6H18', 'o10 11.5 5.5'],
  join: ['M3 17L10 9', 'M17 17L10 9', 'C10 9 2.2'],
  sym: ['M10 2V18 d', 'C4.5 10 1.8', 'C15.5 10 1.8', 'M6.5 10H8 M12 10H13.5'],
  angle: ['M3 16H17', 'M3 16L13 5', 'M10 16A7 7 0 0 0 7.8 10.9'],
  size: ['M3 13H17', 'M3 9V17', 'M17 9V17', 'M5.5 11L3 13L5.5 15', 'M14.5 11L17 13L14.5 15'],
  freeze: ['M5 9.5H15V17H5Z', 'M7 9.5V6.5A3 3 0 0 1 13 6.5V9.5'],
  anchor: ['o10 4.5 1.8', 'M10 6.3V17', 'M6.5 9.5H13.5', 'M4 12.5A6 6 0 0 0 16 12.5'],
};
/** A small line-drawing icon for a rule. */
export function ruleIcon(k) {
  const s = svgEl('svg', { viewBox: '0 0 20 20', width: 18, height: 18, class: 'sk-ricon' });
  for (const d of ICON_PATHS[k] || []) {
    if (d[0] === 'c' || d[0] === 'C') { const [x, y, r] = d.slice(1).split(' ').map(Number); s.append(svgEl('circle', { cx: x, cy: y, r: r || 1.6, class: d[0] === 'C' ? 'f' : 'f' })); }
    else if (d[0] === 'o') { const [x, y, r] = d.slice(1).split(' ').map(Number); s.append(svgEl('circle', { cx: x, cy: y, r })); }
    else if (d.endsWith(' d')) s.append(svgEl('path', { d: d.slice(0, -2), 'stroke-dasharray': '2 2' }));
    else s.append(svgEl('path', { d }));
  }
  return s;
}

// Electronics: mounting-hole patterns for common boards (posts to print, or holes to cut) and PC fan mounts.
import { BOARDS } from './tables.js';

const holesOf = (p, K) => {
  if (p.board === 'custom') {
    const hx = K.num(p.hx) / 2, hy = K.num(p.hy) / 2;
    return { holes: [[-hx, -hy], [hx, -hy], [-hx, hy], [hx, hy]], size: [K.num(p.hx) + 10, K.num(p.hy) + 10], at: [-hx - 5, -hy - 5], d: 3.2 };
  }
  const b = BOARDS[p.board] || BOARDS.pi4;
  return { holes: b.holes, size: b.size, at: [0, 0], d: b.d };
};

/** Standoff posts at a board's mounting holes, on a base plate that covers the board. */
export function boardposts(p, K, pos) {
  const b = holesOf(p, K), h = pos('h', 1), od = pos('od', 2), pilot = K.num(p.pilot ?? 0) || b.d - 0.4, pd = Math.min(K.num(p.pilotDepth ?? h), h);
  if (pilot >= od) K.fail('The pilot hole is wider than the post');
  const parts = [], t = K.num(p.plate ?? 0), m = K.num(p.margin ?? 0);
  if (t > 0) parts.push(K.box(b.size[0] + 2 * m, b.size[1] + 2 * m, t, b.at[0] + b.size[0] / 2, b.at[1] + b.size[1] / 2, 0, 3));
  const cuts = [];
  for (const [x, y] of b.holes) {
    parts.push(K.cyl(od / 2, h, x, y, Math.max(0, t - 0.01)));
    if (pd > 0) cuts.push(K.cyl(pilot / 2, pd + 0.01, x, y, Math.max(0, t) + h - pd));
  }
  return { shape: K.cutMany(K.fuse(parts), cuts) };
}

/** The holes of a board's mounting pattern, to cut through a plate or a case (a hole part). */
export function boardholes(p, K, pos) {
  const b = holesOf(p, K), len = pos('len', 1), d = K.num(p.d ?? 0) || b.d;
  return { shape: K.fuse(b.holes.map(([x, y]) => K.cyl(d / 2, len, x, y, 0))) };
}

/** A square plate for a PC fan: the airflow opening and four screw holes. */
export function fanmount(p, K, pos) {
  const side = pos('side', 10), sp = pos('spacing', 5), sd = pos('screw', 1.5), open = pos('open', 5), t = pos('t', 0.8), r = K.num(p.round ?? 0);
  if (open >= side) K.fail('The opening is wider than the fan');
  if (sp + sd >= side) K.fail('The screw holes fall off the edge');
  const cuts = [K.cyl(open / 2, t + 2, 0, 0, -1)];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) cuts.push(K.cyl(sd / 2, t + 2, (sx * sp) / 2, (sy * sp) / 2, -1));
  return { shape: K.cut(K.box(side, side, t, 0, 0, 0, Math.min(r, side / 2 - 0.1)), cuts) };
}

/** The same opening and screw holes as a hole part, to cut into the wall of a case. */
export function fanholes(p, K, pos) {
  const sp = pos('spacing', 5), sd = pos('screw', 1.5), open = pos('open', 5), len = pos('len', 1);
  const parts = [K.cyl(open / 2, len, 0, 0, 0)];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(K.cyl(sd / 2, len, (sx * sp) / 2, (sy * sp) / 2, 0));
  return { shape: K.fuse(parts) };
}

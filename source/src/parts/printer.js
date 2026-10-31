// Filament and printer parts: PTFE push-fit holes, filament guides, spool axles, bearing mounts and pockets.
import { BEARINGS } from '../catalog.js';
import { FITTINGS } from './tables.js';

/** A hole part for a push-fit fitting (and the PTFE tube behind it); the fitting screws in from the top. */
export function ptfehole(p, K, pos) {
  const f = FITTINGS[p.fit] || FITTINGS['PC4-M10'], len = pos('len', 2), depth = Math.min(pos('depth', 1), len);
  const tap = K.num(p.tap ?? 0) || f[1], bore = K.num(p.bore ?? 0) || f[2];
  return { shape: K.fuse(K.cyl(tap / 2, depth + 0.5, 0, 0, len - depth), K.cyl(bore / 2, len + 0.5, 0, 0, 0)) };
}

/** A filament guide: a tube with a funnel at the top and a flange with two screw holes. */
export function filamentguide(p, K, pos) {
  const bore = pos('bore', 1), L = pos('len', 5), od = pos('od', 3), fd = pos('flangeD', 8), ft = pos('flangeT', 1), funnel = K.num(p.funnel ?? 0), hole = K.num(p.hole ?? 0);
  if (bore >= od) K.fail('The bore is wider than the tube');
  if (fd <= od) K.fail('The flange must be wider than the tube');
  const body = K.revolve([[0, 0], [fd / 2, 0], [fd / 2, ft], [od / 2, ft], [od / 2, L], [0, L]]);
  const inner = [[0, -1], [bore / 2, -1], [bore / 2, L - funnel], ...(funnel > 0 ? [[bore / 2 + funnel, L + 0.01]] : [[bore / 2, L + 1]]), [0, L + 1]];
  const cuts = [K.revolve(inner)];
  if (hole > 0) for (const sx of [-1, 1]) cuts.push(K.cyl(hole / 2, ft + 2, (sx * (fd + od)) / 4, 0, -1));
  return { shape: K.cut(body, cuts) };
}

/** A spool holder axle: a rod with a flange at one end and a tapered seat that the spool's hole slides over. */
export function spoolaxle(p, K, pos) {
  const d = pos('d', 2), L = pos('len', 10), fd = pos('flangeD', 10), ft = pos('flangeT', 1), seat = pos('seatD', 10), seatL = pos('seatLen', 5);
  if (seatL + ft > L) K.fail('The seat and flange are longer than the axle');
  if (seat <= d) K.fail('The seat must be wider than the rod');
  const profile = [[0, 0], [fd / 2, 0], [fd / 2, ft], [seat / 2, ft], [seat / 2 - 2, ft + seatL], [d / 2, ft + seatL], [d / 2, L], [0, L]];
  return { shape: K.revolve(profile) };
}

/** A mount for a bearing: a block with a pocket for it, on a base with two screw holes. */
export function bearingmount(p, K, pos) {
  const [id, od, w] = BEARINGS[p.bearing] || BEARINGS[608], c = K.num(p.clear ?? 0.15), wall = pos('wall', 1), bt = pos('base', 1), hole = K.num(p.hole ?? 3.4);
  const D = od + 2 * wall, bw = D + 2 * (hole + 4);
  const pocketAt = bt + D / 2;
  // the bearing stands on its side: its axis is along Y
  const block = K.fuse(K.box(bw, D, bt, 0, 0, 0, 2), K.move(K.turn(K.cyl(D / 2, w + 2 * wall), 90, 'x'), 0, w / 2 + wall, pocketAt), K.box(D, w + 2 * wall, D / 2, 0, 0, bt - 0.01));
  const cuts = [K.move(K.turn(K.cyl((od + 2 * c) / 2, w + 2 * c), 90, 'x'), 0, w / 2 + c, pocketAt), K.move(K.turn(K.cyl(Math.max(id, 2) / 2 + 0.5, w + 2 * wall + 2), 90, 'x'), 0, w / 2 + wall + 1, pocketAt)];
  if (hole > 0) for (const sx of [-1, 1]) cuts.push(K.cyl(hole / 2, bt + 2, sx * (D / 2 + hole / 2 + 2), 0, -1));
  return { shape: K.cut(block, cuts) };
}

/** A bearing pocket (a hole part): the pocket for a bearing and the hole for its shaft, opening at the top. */
export function bearingpocket(p, K, pos) {
  const [id, od, w] = BEARINGS[p.bearing] || BEARINGS[608], c = K.num(p.clear ?? 0.15), L = pos('len', 2);
  if (L < w + 1) K.fail(`The plate must be thicker than the bearing (${w} mm) plus 1 mm`);
  return { shape: K.fuse(K.cyl((od + 2 * c) / 2, w + c + 0.5, 0, 0, L - w - c), K.cyl(Math.max(id - 0.5, 1) / 2 + 0.25, L + 0.5, 0, 0, 0)) };
}

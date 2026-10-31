// Wall mounting (keyhole slots, screw tabs, French cleats), cables (clips, zip-tie anchors, desk grommets, chain
// links) and feet (rubber-foot pockets, leveling feet).

/** A slot-shaped solid, h tall from z: width w, from (0, 0) to (0, L), rounded at both ends. */
const slotSolid = (K, w, L, h, z) => K.fuse(K.cyl(w / 2, h, 0, 0, z), K.cyl(w / 2, h, 0, L, z), K.box(w, L, h, 0, L / 2, z));

/** Keyhole slot (a hole): hang a plate on a screw head. The big round end lets the head in, the narrow slot holds the
 *  shank, and a pocket on the back (the bottom here) lets the head sit inside so the plate lies flat on the wall. */
export function keyhole(p, K, pos) {
  const head = pos('head', 2), shank = pos('shank', 1), slot = pos('slot', 1), depth = pos('depth', 0.5), pocket = pos('pocket', 0.2);
  if (shank >= head) K.fail('The screw head must be wider than the shank');
  if (pocket >= depth) K.fail('The pocket for the head must be shallower than the plate');
  const through = K.fuse(K.cyl(head / 2, depth + 0.02, 0, 0, -0.01), slotSolid(K, shank, slot, depth + 0.02, -0.01));
  return { shape: K.fuse(through, slotSolid(K, head, slot, pocket + 0.01, -0.01)) };
}

/** A mounting ear with a screw hole (optionally countersunk). */
export function screwtab(p, K, pos) {
  const w = pos('w', 5), L = pos('len', 5), t = pos('t', 0.8), hd = pos('hole', 1.5), cs = K.num(p.csk ?? 0);
  if (hd >= w - 1) K.fail('The hole is too wide for the tab');
  const s = K.box(w, L, t, 0, 0, 0, Math.min(w / 2 - 0.01, 6));
  const y = L / 2 - Math.max(w / 2, hd);
  const cut = [K.cyl(hd / 2, t + 2, 0, y, -1)];
  if (cs > hd) cut.push(K.revolve([[0, t - (cs - hd) / 2], [hd / 2, t - (cs - hd) / 2], [cs / 2, t + 0.001], [cs / 2, t + 1], [0, t + 1]]).translate([0, y, 0]));
  return { shape: K.cut(s, cut) };
}

/** A French cleat: two matching strips with a 45 degree slope. The wall strip is screwed to the wall, the other to
 *  the thing you hang; it drops over the first. Seen from the end: thickness T (out from the wall) and height H. */
export function frenchcleat(p, K, pos) {
  const L = pos('len', 10), H = pos('h', 10), T = pos('t', 3), holes = Math.round(K.num(p.holes ?? 0));
  if (H < 2 * T) K.fail('Make the cleat taller than twice its thickness');
  if (holes < 0 || holes > 20) K.fail('Screw holes: 0 to 20');
  const wall = p.part !== 'item';
  // cross-section in (x = out from the wall, z = up); the item strip is the wall strip turned half a turn about the slope
  const pts = wall ? [[0, 0], [T, 0], [T, H - T], [0, H]] : [[T, H], [0, H], [0, T], [T, 0]];
  const s = K.poly(pts).sketchOnPlane('XZ').extrude(L); // (grows towards -Y)
  const z = wall ? (H - T) / 2 : (H + T) / 2;
  const cuts = Array.from({ length: holes }, (_, i) => K.move(K.turn(K.cyl(2.2, T + 2), 90, 'y'), -1, -(L * (i + 0.5)) / holes, z));
  return { shape: K.cutMany(s, cuts) };
}

/** A C-clip that holds a cable of this thickness, on a base with two screw holes. */
export function cableclip(p, K, pos) {
  const cd = pos('cable', 1), wall = pos('wall', 0.8), len = pos('len', 3), gap = K.num(p.gap ?? 0.7) * cd, hole = K.num(p.hole ?? 3.4), bt = pos('base', 0.8);
  if (!(gap > 0 && gap < cd)) K.fail('The opening must be narrower than the cable');
  const R = cd / 2 + wall, bw = 2 * R + 2 * (hole + 3);
  // the ring lies along Y; its opening faces up
  const ring = K.cut(K.cyl(R, len), K.cyl(cd / 2, len + 2, 0, 0, -1), K.box(gap, R + 1, len + 2, 0, -(R + 1) / 2, -1));
  const s = K.fuse(K.box(bw, len, bt, 0, len / 2, 0, 1), K.move(K.turn(ring, -90, 'x'), 0, 0, bt + R - 0.3));
  if (!(hole > 0)) return { shape: s };
  return { shape: K.cut(s, K.cyl(hole / 2, bt + 2, -(R + hole / 2 + 1.5), len / 2, -1), K.cyl(hole / 2, bt + 2, R + hole / 2 + 1.5, len / 2, -1)) };
}

/** A zip-tie anchor: a pad with a tunnel for the tie, and an optional screw hole each side. */
export function zipanchor(p, K, pos) {
  const tw = pos('tie', 1), tt = pos('tieT', 0.3), pw = pos('padW', 5), pd = pos('padD', 5), t = pos('t', 0.8), hole = K.num(p.hole ?? 0);
  const tunnel = tt + 0.5, top = 1.6, bw = tw + 6;
  if (pd < 6) K.fail('The pad must be at least 6 mm deep');
  let s = K.fuse(K.box(pw, pd, t, 0, 0, 0, 1), K.box(bw, pd - 1, tunnel + top, 0, 0, t - 0.01));
  const cuts = [K.box(tw + 0.6, pd + 2, tunnel, 0, 0, t)];
  if (hole > 0) { const x = Math.max(bw / 2 + hole / 2 + 1, pw / 2 - hole / 2 - 1.5); cuts.push(K.cyl(hole / 2, t + 2, -x, 0, -1), K.cyl(hole / 2, t + 2, x, 0, -1)); }
  s = K.cut(s, cuts);
  return { shape: s };
}

/** A desk grommet: a sleeve that goes through the hole, with a flange on top (and an optional slot for plugs to pass). */
export function grommet(p, K, pos) {
  const hd = pos('hole', 10), thick = pos('thick', 1), wall = pos('wall', 1), fl = pos('flange', 2), ft = pos('flangeT', 1), c = K.num(p.clear ?? 0.4);
  const od = hd - 2 * c, id = od - 2 * wall;
  if (id <= 4) K.fail('The walls are too thick for this hole');
  const sleeve = K.cut(K.cyl(od / 2, thick + ft), K.cyl(id / 2, thick + ft + 2, 0, 0, -1));
  const flange = K.cut(K.cyl(hd / 2 + fl, ft, 0, 0, thick), K.cyl(id / 2, ft + 2, 0, 0, thick - 1));
  const s = K.fuse(sleeve, flange);
  return { shape: p.slot ? K.cut(s, K.box(Math.min(id * 0.4, 30), hd, ft + 2, 0, hd / 2, thick - 1)) : s };
}

/** A cable-chain link: two side plates, each with a hole at both ends for a pin (a bit of rod or filament), and two
 *  cross bars. Print several, pin them together end to end. */
export function chainlink(p, K, pos) {
  const iw = pos('inW', 5), ih = pos('inH', 5), t = pos('t', 0.8), pitch = pos('pitch', 5), pin = pos('pin', 1), c = K.num(p.clear ?? 0.3);
  const h = ih + 2 * t, L = pitch + h;
  // a side plate stands in the X-Z plane (length along X), rounded at both ends
  const plate = (y) => K.move(K.turn(K.ext(K.R.drawRoundedRectangle(L, h, h / 2 - 0.01), t), 90, 'x'), 0, y + t, 0);
  const bars = [1, -1].map((s) => K.box(pitch * 0.5, iw + 0.2, t, 0, t + iw / 2, s > 0 ? h / 2 - t : -h / 2));
  const pins = [-1, 1].map((s) => K.move(K.turn(K.cyl((pin + c) / 2, 2 * t + iw + 2), 90, 'x'), (s * pitch) / 2, 2 * t + iw + 1, 0));
  return { shape: K.cut(K.fuse(plate(0), plate(t + iw), bars), pins) };
}

/** A rubber-foot pocket (a hole): a round recess for a stick-on or push-in foot, with an optional screw hole. */
export function footpocket(p, K, pos) {
  const d = pos('d', 2), depth = pos('depth', 0.3), screw = K.num(p.screw ?? 0), len = pos('len', 1);
  return { shape: screw > 0 ? K.fuse(K.cyl(d / 2, depth), K.cyl(screw / 2, depth + len)) : K.cyl(d / 2, depth) };
}

/** A leveling foot: a pad with a domed top and a stem (use the Thread tool, or a screw, for a threaded stem). */
export function levelfoot(p, K, pos) {
  const bd = pos('baseD', 5), bh = pos('baseH', 1), sd = pos('stemD', 2), sl = pos('stemLen', 3), dome = pos('dome', 0.5);
  if (sd >= bd) K.fail('The stem must be thinner than the pad');
  return { shape: K.revolve([[0, 0], [bd / 2, 0], [bd / 2, bh * 0.5], [bd / 2 - bh * 0.5, bh], [sd / 2 + 2, bh + dome], [sd / 2, bh + dome], [sd / 2, bh + dome + sl], [0, bh + dome + sl]]) };
}

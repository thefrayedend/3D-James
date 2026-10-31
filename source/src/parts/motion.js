// Motion: GT2 pulleys, shaft collars and V-slot wheels.

/** A hole for a shaft: round, or with a flat (a D shaft, like a stepper motor's 5 mm shaft). */
const bore = (K, d, flat, L, z) => {
  const c = K.cyl(d / 2, L, 0, 0, z);
  return flat > 0 ? K.cut(c, K.box(d, d, L + 2, d / 2 + (d / 2 - flat), 0, z - 1)) : c;
};

/** A GT2 (2 mm pitch) belt pulley: teeth, two flanges, a hub with a set screw, a round or D-shaped bore. */
export function gt2pulley(p, K, pos) {
  const n = Math.round(pos('teeth', 10)), b = pos('bore', 1), bw = pos('belt', 3), hubD = pos('hubD', 4), hubH = K.num(p.hubH ?? 0), flat = K.num(p.flat ?? 0);
  if (n > 80) K.fail('Up to 80 teeth');
  const od = (n * 2) / Math.PI - 0.76, ft = 1, tooth = bw + 1;
  if (b >= od - 1) K.fail('The bore is too wide for this many teeth');
  if (hubH > 0 && hubD <= b + 2) K.fail('The hub must be wider than the bore');
  const z0 = hubH, parts = [];
  if (hubH > 0) parts.push(K.cyl(hubD / 2, hubH + 0.01));
  parts.push(K.cyl(od / 2 + 1, ft, 0, 0, z0), K.cyl(od / 2 + 1, ft, 0, 0, z0 + ft + tooth));
  // the toothed part: round, then a groove for every tooth
  let teeth = K.cyl(od / 2, tooth + 0.02, 0, 0, z0 + ft - 0.01);
  teeth = K.cutMany(teeth, K.circle(n, od / 2, (x, y) => K.cyl(0.65, tooth + 2, x, y, z0 + ft - 1)));
  parts.push(teeth);
  let s = K.fuse(parts);
  const total = z0 + 2 * ft + tooth, cuts = [bore(K, b, flat, total + 2, -1)];
  if (p.setscrew && hubH > 0) cuts.push(K.move(K.turn(K.cyl(1.6, hubD / 2 + 1), 90, 'y'), 0, 0, hubH / 2));
  return { shape: K.cut(s, cuts) };
}

/** A shaft collar: a ring that holds a shaft with a set screw hole, or clamps it with a split and a screw hole. */
export function shaftcollar(p, K, pos) {
  const b = pos('bore', 1), od = pos('od', 2), w = pos('w', 2), screw = pos('screw', 1);
  if (od <= b + 3) K.fail('The collar must be wider than the shaft');
  const clamp = p.style === 'clamp';
  const ring = K.cut(K.cyl(od / 2, w), K.cyl(b / 2, w + 2, 0, 0, -1));
  const cuts = [];
  if (clamp) {
    // a slit from the bore out through one side, and a screw across it
    cuts.push(K.box(0.8, od / 2 + 1, w + 2, 0, (od / 2 + 1) / 2, -1));
    cuts.push(K.move(K.turn(K.cyl(screw / 2, od + 2), 90, 'y'), -(od / 2) - 1, (b / 2 + od / 2) / 2, w / 2));
  } else {
    cuts.push(K.move(K.turn(K.cyl(screw / 2, od / 2 + 1), 90, 'y'), 0, 0, w / 2));
  }
  return { shape: K.cut(ring, cuts) };
}

/** A V-slot wheel: a rim with a 90 degree groove that rides on aluminium V-slot, with a bore (or bearing seats). */
export function vwheel(p, K, pos) {
  const od = pos('od', 5), w = pos('w', 3), vd = pos('vdepth', 1), lip = pos('lip', 0.2), b = pos('bore', 1), seat = K.num(p.seat ?? 0);
  const a = lip;
  if (w - 2 * a - 2 * vd < 0) K.fail('The groove is deeper than the wheel is wide');
  if (vd >= od / 2 - b / 2 - 1) K.fail('The groove is too deep for this wheel');
  const R = od / 2;
  const prof = [[0, 0], [R, 0], [R, a], [R - vd, a + vd], [R - vd, w - a - vd], [R, w - a], [R, w], [0, w]];
  const cuts = [K.cyl(b / 2, w + 2, 0, 0, -1)];
  if (seat > 0) cuts.push(K.cyl(seat / 2, K.num(p.seatDepth ?? 5) + 0.01, 0, 0, -0.01), K.cyl(seat / 2, K.num(p.seatDepth ?? 5) + 0.01, 0, 0, w - K.num(p.seatDepth ?? 5)));
  return { shape: K.cut(K.revolve(prof), cuts) };
}

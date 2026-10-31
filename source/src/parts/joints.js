// Joints: hinges, dovetails, pegs and sockets, ball joints, universal joints, shaft holes (keyway, D, double D),
// screw bosses and ribs. Parts with moving pieces print in place: the pieces are separate solids with a small gap.

/** A hinge lying flat: the pin runs along Y. In place: the leaf on the left owns the pin; the right leaf turns on it
 *  (a small gap all round). As a pin hinge: both leaves have a hole for a pin you supply (filament, a nail). */
export function hinge(p, K, pos) {
  const L = pos('len', 10), leaf = pos('leaf', 5), t = pos('t', 1), d = pos('d', 4), pin = pos('pin', 1), n = Math.round(pos('knuckles', 3)), gap = K.num(p.gap ?? 0.4), screws = Math.round(K.num(p.screws ?? 0)), sd = K.num(p.hole ?? 3.4);
  const inPlace = p.style !== 'pin';
  if (n < 3 || n > 15 || n % 2 === 0) K.fail('Knuckles: an odd number from 3 to 15');
  if (pin >= d - 1.2) K.fail('The pin is too thick for the knuckle');
  if (leaf < d / 2 + 4) K.fail('The leaf is too short');
  const kl = (L - (n - 1) * gap) / n;
  if (kl < 2) K.fail('The hinge is too short for that many knuckles');
  const R = d / 2, c = K.num(p.clear ?? 0.3), edge = R + c; // each leaf starts a little away from the other leaf's knuckles
  const A = [], B = [], holesA = [], holesB = [];
  for (let i = 0; i < n; i++) {
    const y0 = i * (kl + gap), mineA = i % 2 === 0, list = mineA ? A : B, sgn = mineA ? -1 : 1;
    list.push(K.move(K.turn(K.cyl(R, kl), -90, 'x'), 0, y0, R)); // a knuckle: a cylinder along Y with its bottom on the floor
    list.push(K.box(edge + 0.3, kl, t, (sgn * (edge + 0.3)) / 2, y0 + kl / 2, 0)); // joined to its leaf by a web
    if (!inPlace || !mineA) (mineA ? holesA : holesB).push(K.move(K.turn(K.cyl((pin + 2 * c) / 2, kl + 2), -90, 'x'), 0, y0 - 1, R));
  }
  // the leaves: one long plate each side, from the web outwards
  const plate = (sgn) => K.box(leaf - edge, L, t, sgn * (edge + (leaf - edge) / 2), L / 2, 0);
  let a = K.fuse(A, plate(-1)), b = K.fuse(B, plate(1));
  if (inPlace) a = K.fuse(a, K.move(K.turn(K.cyl(pin / 2, L), -90, 'x'), 0, 0, R)); // the pin, part of the first leaf
  if (holesA.length) a = K.cut(a, holesA);
  if (holesB.length) b = K.cut(b, holesB);
  // screw holes in the leaves
  const sc = (sgn) => (screws > 0 && sd > 0 ? Array.from({ length: screws }, (_, i) => K.cyl(sd / 2, t + 2, sgn * (edge + (leaf - edge) / 2), (L * (i + 0.5)) / screws, -1)) : []);
  a = K.cutMany(a, sc(-1)); b = K.cutMany(b, sc(1));
  return { shape: K.fuse(a, b) };
}

/** The sliding tail of a dovetail joint, on a base plate. The tail is widest at its top. */
export function dovetail(p, K, pos) {
  const L = pos('len', 5), w = pos('w', 5), h = pos('h', 2), ang = pos('angle', 1), bt = K.num(p.base ?? 0);
  if (ang >= 60) K.fail('The angle must be less than 60 degrees');
  const nar = w - 2 * h * Math.tan((ang * Math.PI) / 180);
  if (nar < 1) K.fail('The tail gets too narrow at its foot: make it wider, lower or less steep');
  // the end view: in Y-Z, extruded along X for the length (then turned so the tail runs along Y)
  const tail = K.poly([[-nar / 2, 0], [nar / 2, 0], [w / 2, h], [-w / 2, h]]).sketchOnPlane('XZ').extrude(L); // (grows towards -Y)
  if (!(bt > 0)) return { shape: K.move(tail, 0, L, 0) };
  return { shape: K.fuse(K.box(w + 2 * bt + 6, L, bt, 0, L / 2, 0, 0.5), K.move(tail, 0, L, bt - 0.01)) };
}

/** The slot for a dovetail tail (a hole): wider at the bottom, so the tail slides in from the end and cannot lift out. */
export function dovetailslot(p, K, pos) {
  const L = pos('len', 5), w = pos('w', 5), h = pos('h', 2), ang = pos('angle', 1), c = K.num(p.clear ?? 0.2);
  const nar = w - 2 * h * Math.tan((ang * Math.PI) / 180);
  if (nar < 1) K.fail('The slot gets too narrow at the top: make it wider, lower or less steep');
  const W = w + 2 * c, N = nar + 2 * c, H = h + c;
  // wide at the bottom, narrow at the top (the opening); the cutter runs a bit beyond both ends
  const s = K.poly([[-W / 2, 0], [W / 2, 0], [N / 2, H], [-N / 2, H]]).sketchOnPlane('XZ').extrude(L + 2);
  return { shape: K.move(s, 0, L + 1, 0) };
}

/** A peg on a base disc: it fits the matching socket. */
export function peg(p, K, pos) {
  const d = pos('d', 1), L = pos('len', 1), ch = K.num(p.chamfer ?? 0), bd = K.num(p.baseD ?? 0), bh = K.num(p.baseH ?? 0);
  const R = d / 2, c = Math.max(0, Math.min(ch, R - 0.1, L / 2)), top = (bd > d ? bh : 0) + L;
  const prof = [[0, 0]];
  if (bd > d) prof.push([bd / 2, 0], [bd / 2, bh], [R, bh]); else prof.push([R, 0]);
  if (c > 0) prof.push([R, top - c], [R - c, top]); else prof.push([R, top]);
  prof.push([0, top]);
  return { shape: K.revolve(prof) };
}

/** A socket for a peg (a hole): a little wider than the peg, with a lead-in at the top. */
export function pegsocket(p, K, pos) {
  const d = pos('d', 1), depth = pos('depth', 1), c = K.num(p.clear ?? 0.2), ch = K.num(p.chamfer ?? 0.5);
  const R = d / 2 + c;
  return { shape: K.revolve([[0, 0], [R, 0], [R, depth], [R + Math.min(ch, depth), depth + Math.min(ch, depth)], [0, depth + Math.min(ch, depth)]]) };
}

/** A ball-and-socket joint that prints in place: a ball on a stem inside a socket on a post, with a gap all round. */
export function balljoint(p, K, pos) {
  const R = pos('d', 4) / 2, stem = pos('stem', 2), stemLen = pos('stemLen', 1), wall = pos('wall', 1), c = K.num(p.clear ?? 0.35), post = pos('postD', 4), postLen = pos('postLen', 1);
  if (stem >= R * 1.4) K.fail('The stem is too thick for the ball');
  const zc = wall + R + c; // the ball's middle
  const H = zc + R * 0.55; // the socket goes a little past the ball's equator
  const od = 2 * R + 2 * wall + 2 * c;
  const opening = Math.max(stem + 1.5, R * 1.35); // narrower than the ball, so it cannot come out
  let socket = K.fuse(K.cyl(od / 2, H), K.cyl(post / 2, postLen + 0.01, 0, 0, -postLen));
  socket = K.cut(socket, K.move(K.R.makeSphere(R + c), 0, 0, zc), K.cyl(opening / 2, H, 0, 0, zc + 0.01));
  const ball = K.fuse(K.move(K.R.makeSphere(R), 0, 0, zc), K.cyl(stem / 2, R + stemLen, 0, 0, zc));
  return { shape: K.fuse(socket, ball) };
}

/** A universal joint (cardan joint) that prints in place: a cross block with four pins, between two forks. */
export function ujoint(p, K, pos) {
  const s = pos('size', 3), pd = pos('pin', 1), at = pos('armT', 1), aw = pos('armW', 3), c = K.num(p.clear ?? 0.4), sd = pos('shaft', 2), sl = pos('shaftLen', 1);
  const g = c, bt = at;
  if (aw > s + 0.01) K.fail('The fork arms must be no wider than the middle block');
  if (pd / 2 + 3 >= s / 2 + g) K.fail('The pin is too thick for the middle block');
  const reach = s / 2 + g + at, pr = pd / 2 + 3; // the arms stand out this far, and rise this far past the pin
  const ph = pd + 2 * c; // clearance hole in the arms
  // the middle: a block with a pin out of every side
  const cross = K.fuse(K.box(s, s, s, 0, 0, -s / 2), K.move(K.turn(K.cyl(pd / 2, 2 * reach - 0.8), 90, 'y'), -(reach - 0.4), 0, 0), K.move(K.turn(K.cyl(pd / 2, 2 * reach - 0.8), -90, 'x'), 0, -(reach - 0.4), 0));
  // fork 1 below (arms on the left and right), fork 2 above (arms in front and behind)
  const fork = (up) => {
    const sg = up ? 1 : -1, z0 = sg * (s / 2 + g);
    const bridge = K.box(2 * reach, aw, bt, 0, 0, up ? z0 : z0 - bt);
    const arms = [-1, 1].map((e) => K.box(at, aw, pr + s / 2 + g + bt, e * (s / 2 + g + at / 2), 0, up ? -pr : z0 - bt));
    const shaft = K.cyl(sd / 2, sl, 0, 0, up ? z0 + bt - 0.01 : z0 - bt - sl + 0.01);
    let f = K.fuse(bridge, arms, shaft);
    f = K.cut(f, [-1, 1].map((e) => K.move(K.turn(K.cyl(ph / 2, at + 2), 90, 'y'), e * (s / 2 + g + at / 2) - (at + 2) / 2, 0, 0)));
    return up ? K.turn(f, 90, 'z') : f;
  };
  return { shape: K.fuse(cross, fork(false), fork(true)) };
}

/** A hole for a shaft (a hole part): round, with a flat (D), two flats, or a key slot. */
export function shafthole(p, K, pos) {
  const d = pos('d', 1), L = pos('len', 1), c = K.num(p.clear ?? 0.1), type = p.type || 'd', R = d / 2 + c;
  const round = K.cyl(R, L);
  if (type === 'round') return { shape: round };
  const flat = pos('flat', 0.1);
  if (flat >= d / 2) K.fail('The flat is deeper than the shaft is wide');
  if (type === 'd') return { shape: K.cut(round, K.box(d + 2, d + 2, L + 2, d / 2 - flat + c + (d + 2) / 2, 0, -1)) };
  if (type === 'dd') return { shape: K.cut(round, K.box(d + 2, d + 2, L + 2, d / 2 - flat + c + (d + 2) / 2, 0, -1), K.box(d + 2, d + 2, L + 2, -(d / 2 - flat + c + (d + 2) / 2), 0, -1)) };
  const kw = pos('kw', 0.5), kd = pos('kd', 0.2);
  return { shape: K.fuse(round, K.box(kw + 2 * c, R + kd + c, L, 0, (R + kd + c) / 2 + 0, 0)) };
}

/** A screw boss: a post with a pilot hole and supporting ribs round it. */
export function boss(p, K, pos) {
  const od = pos('od', 2), h = pos('h', 1), hole = pos('hole', 0.5), depth = Math.min(pos('depth', 0.5), h), n = Math.round(K.num(p.ribs ?? 0)), rt = pos('ribT', 0.4), rh = K.num(p.ribH ?? 0.7) * h, rl = K.num(p.ribL ?? od);
  if (hole >= od - 1) K.fail('The pilot hole is too wide for the post');
  if (n < 0 || n > 8) K.fail('Ribs: 0 to 8');
  const parts = [K.cyl(od / 2, h)];
  for (let i = 0; i < n; i++) {
    // a triangle standing against the post, thickness rt
    const rib = K.poly([[od / 2 - 0.3, 0], [od / 2 + rl, 0], [od / 2 - 0.3, rh]]).sketchOnPlane('XZ').extrude(rt);
    parts.push(K.turn(K.move(rib, 0, rt / 2, 0), (360 * i) / n, 'z'));
  }
  return { shape: K.cut(K.fuse(parts), K.cyl(hole / 2, depth + 0.01, 0, 0, h - depth)) };
}

/** A rib (gusset): a triangle that stiffens a corner. */
export function rib(p, K, pos) {
  const w = pos('w', 2), h = pos('h', 2), t = pos('t', 0.4);
  return { shape: K.turn(K.poly([[0, 0], [w, 0], [0, h]]).sketchOnPlane('XY').extrude(t), 90, 'x') };
}

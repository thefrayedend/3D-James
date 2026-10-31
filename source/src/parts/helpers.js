// Print helpers: a snap-fit clip and a tolerance test piece.

/** A cantilever snap-fit: a base with a flexible beam that ends in a hook. Print it with the beam standing up, or
 *  (stronger) lying down, and test how far the hook should reach for your printer. */
export function snapfit(p, K, pos) {
  const w = pos('w', 2), L = pos('len', 4), t = pos('t', 0.6), hook = pos('hook', 0.3), hh = pos('hookH', 1), bd = pos('baseD', 4), bh = pos('baseH', 1);
  if (hook >= L / 3) K.fail('The hook is too big for this beam');
  const top = bh + L;
  const beam = K.box(w, t, L + 0.02, 0, t / 2, bh - 0.01);
  const hookP = K.poly([[t - 0.01, top], [t + hook, top - hh], [t - 0.01, top - hh]]).sketchOnPlane('YZ').extrude(w);
  return { shape: K.fuse(K.box(w, bd, bh, 0, bd / 2, 0), beam, K.move(hookP, -w / 2, 0, 0)) };
}

/** A tolerance test: a plate with holes a little bigger each time, and loose pegs to try in them. The smallest hole a
 *  peg fits (turning freely, or tight, as you like) is the clearance to use for that printer and material. */
export function tolerancetest(p, K, pos) {
  const d = pos('d', 2), n = Math.round(pos('n', 2)), step = pos('step', 0.01), t = pos('t', 1), pl = pos('pegLen', 1);
  if (n > 12) K.fail('Up to 12 holes');
  const pitch = d + step * n + 6, W = n * pitch + 6, D = d + step * n + 12;
  let plate = K.box(W, D, t, 0, 0, 0, 2);
  const holes = Array.from({ length: n }, (_, i) => K.cyl((d + step * i) / 2, t + 2, -W / 2 + 3 + pitch * (i + 0.5), 0, -1));
  plate = K.cutMany(plate, holes);
  const y = -(D / 2 + d / 2 + 4);
  const pegs = Array.from({ length: n }, (_, i) => K.cyl(d / 2, pl, -W / 2 + 3 + pitch * (i + 0.5), y, 0));
  return { shape: K.fuse(plate, pegs) };
}

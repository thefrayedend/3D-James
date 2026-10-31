// Organizing: hooks for pegboard and IKEA Skadis, drawer dividers, and boxes with lids. (Gridfinity: gridfinity.js)
// Hooks are drawn as they hang on the wall: the back plate stands in the X-Z plane (wall at Y = 0, pegs and tabs going
// into the wall towards -Y, the hook reaching out towards +Y). Turn one flat (Object > Faces > Lay flat) to print it.

/** Pegboard (6.35 mm holes, 25.4 mm apart) and Skadis (5 x 15 mm slots) hooks. */
export function boardhook(p, K, pos) {
  const style = p.style === 'skadis' ? 'skadis' : 'pegboard';
  const arm = pos('armLen', 5), aw = pos('armW', 2), at = pos('armT', 1.5), lip = pos('lipH', 0), plateT = pos('plateT', 1.5);
  const parts = [];
  let plateH, zArm;
  if (style === 'pegboard') {
    const pd = pos('pegD', 2), sp = pos('spacing', 5), len = pos('pegLen', 4), n = Math.round(pos('pegs', 1));
    if (n > 3) K.fail('Up to 3 pegs');
    plateH = Math.max(sp * (n - 1) + pd + 8, aw + 4);
    const w = Math.max(pd + 8, aw);
    parts.push(K.box(w, plateT, plateH, 0, plateT / 2, 0, 0.5));
    for (let i = 0; i < n; i++) {
      const z = 4 + pd / 2 + i * sp;
      // a peg: a cylinder going into the wall, rounded at the end
      parts.push(K.move(K.turn(K.cyl(pd / 2, len), 90, 'x'), 0, 0.2, z));
    }
    zArm = 4 + pd / 2;
  } else {
    const slotW = pos('slotW', 2), board = pos('board', 1), tabClear = K.num(p.tabClear ?? 0.3), sp = pos('tabGap', 5);
    const tw = slotW - 2 * tabClear, tz = 2.4, hook = 8;
    plateH = sp + 18;
    parts.push(K.box(Math.max(slotW + 8, aw), plateT, plateH, 0, plateT / 2, 0, 0.5));
    for (const z of [plateH - 6, plateH - 6 - sp]) {
      if (z < tz + hook) continue;
      // a tab through the slot and down behind the board
      parts.push(K.box(tw, board + 2.2 + 0.2, tz, 0, -(board + 2.2) / 2 + 0.1, z - tz));
      parts.push(K.box(tw, 2.2, hook, 0, -(board + 1.1), z - hook));
    }
    zArm = 6;
  }
  // the arm reaches out from the plate, with a lip at its end
  parts.push(K.box(aw, arm, at, 0, plateT + arm / 2 - 0.01, zArm - at / 2, Math.min(aw, at) / 3));
  if (lip > 0) parts.push(K.box(aw, at, lip + at / 2, 0, plateT + arm - at / 2, zArm - at / 2));
  return { shape: K.fuse(parts) };
}

/** A flat divider with half-height slots, so two of them cross like an egg crate (one with its slots on top, one below). */
export function drawerdivider(p, K, pos) {
  const L = pos('len', 10), h = pos('h', 5), t = pos('t', 0.4), n = Math.round(K.num(p.slots ?? 0)), depth = K.num(p.depth ?? 0.5);
  if (n < 0 || n > 20) K.fail('Slots: 0 to 20');
  if (!(depth > 0 && depth < 1)) K.fail('Slot depth is a fraction of the height between 0 and 1');
  const c = K.num(p.clear ?? 0.25), slotW = t + 2 * c;
  let s = K.box(L, t, h);
  const cuts = [];
  for (let i = 1; i <= n; i++) {
    const x = -L / 2 + (L * i) / (n + 1), sd = h * depth;
    cuts.push(K.box(slotW, t + 2, sd + 0.01, x, 0, p.slotsOn === 'bottom' ? -0.01 : h - sd));
  }
  return { shape: K.cutMany(s, cuts) };
}

/** A box with a matching lid (add the box and the lid as two parts with the same sizes). */
export function lidbox(p, K, pos) {
  const w = pos('w', 15), d = pos('d', 15), h = pos('h', 8), wall = pos('wall', 0.8), r = K.num(p.round ?? 0), c = K.num(p.clear ?? 0.3);
  const style = ['press', 'sliding', 'hinged'].includes(p.style) ? p.style : 'press';
  const lid = p.part === 'lid';
  if (2 * wall >= Math.min(w, d)) K.fail('The walls are thicker than the box');
  if (r < 0 || r >= Math.min(w, d) / 2 - 0.01) K.fail('Round corners must be less than half the box');
  const rin = Math.max(0.2, r - wall);
  const iw = w - 2 * wall, id = d - 2 * wall;
  if (style === 'press') {
    if (!lid) return { shape: K.cut(K.box(w, d, h, 0, 0, 0, r), K.box(iw, id, h, 0, 0, wall, rin)) };
    // the lid: a plate with a rim that fits inside the box
    const lipH = Math.min(4, h - wall), lt = Math.min(1.2, wall);
    const plate = K.box(w, d, wall, 0, 0, 0, r);
    const rim = K.cut(K.box(iw - 2 * c, id - 2 * c, lipH, 0, 0, wall - 0.01, Math.max(0.2, rin - c)), K.box(iw - 2 * c - 2 * lt, id - 2 * c - 2 * lt, lipH + 1, 0, 0, wall - 0.02, Math.max(0.1, rin - c - lt)));
    return { shape: K.fuse(plate, rim) };
  }
  if (style === 'sliding') {
    // rails: a groove in both side walls near the top; the front wall is open above it so the lid slides in from the front
    const lt = wall, gd = Math.min(1.2, wall * 0.7), tl = Math.min(1.2, wall), gh = lt + 2 * c, z0 = h - tl - gh;
    if (z0 < wall + 1) K.fail('Make the box taller for a sliding lid');
    if (!lid) {
      const s = K.cut(K.box(w, d, h, 0, 0, 0, r), K.box(iw, id, h, 0, 0, wall, rin));
      return { shape: K.cut(s, K.box(iw + 2 * gd, id + wall + 1, gh, 0, -wall / 2 - 0.5, z0), K.box(iw, wall + 2, h - z0 + 1, 0, -d / 2 + wall / 2, z0)) };
    }
    return { shape: K.box(iw + 2 * gd - 2 * c, d - wall - c, lt, 0, 0, 0) };
  }
  // hinged: knuckles along the back edge, alternate ones on the box and on the lid; a pin (a bit of filament) goes through
  const Rk = Math.max(3, wall * 1.6), nk = Math.max(3, Math.round(K.num(p.knuckles ?? 5)) | 1), pin = K.num(p.pin ?? 2), gap = 0.35;
  const kw = (w - 2 * r - (nk - 1) * gap) / nk;
  if (kw < 2) K.fail('The box is too narrow for that many hinge knuckles');
  const body = lid ? K.box(w, d, wall, 0, 0, 0, r) : K.cut(K.box(w, d, h, 0, 0, 0, r), K.box(iw, id, h, 0, 0, wall, rin));
  const ay = d / 2 + Rk, az = lid ? 0 : h; // where the hinge pin runs
  const parts = [body], holes = [];
  for (let i = 0; i < nk; i++) {
    if ((i % 2 === 0) !== !lid) continue; // box: even knuckles, lid: odd ones
    const x = -w / 2 + r + kw / 2 + i * (kw + gap);
    parts.push(K.move(K.turn(K.cyl(Rk, kw), 90, 'y'), x - kw / 2, ay, az));
    parts.push(K.box(kw, Rk + 0.5, lid ? wall : Rk * 2, x, d / 2 + Rk / 2 - 0.25, lid ? 0 : az - Rk * 2));
  }
  let s = K.fuse(parts);
  // the pin hole runs through every knuckle (a little loose, so it turns)
  holes.push(K.move(K.turn(K.cyl((pin + 0.2) / 2, w + 2), 90, 'y'), -w / 2 - 1, ay, az));
  s = K.cut(s, holes);
  return { shape: s };
}

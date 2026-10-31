// Stock and brackets: tube, I-beam, C-channel, angle and T profiles to any length, a corner bracket, T-nuts, and the
// 3030 T-slot extrusion profile.

/** The cross-section of a 30 x 30 T-slot extrusion (8 mm slot), with typical dimensions, as a drawing. */
export function tslot30Profile(R) {
  const half = [[5.5, 0], [5.65, 0.15], [5.65, 4], [9.9, 8.25], [12.9, 8.25], [12.9, 4.1], [15, 4.1], [15, 0]]; // from the slot bottom out to the face (+x side)
  const slot = [...half, ...half.slice(1, -1).reverse().map(([a, b]) => [a, -b])];
  const poly = (pts, deg) => {
    const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), q = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
    let d = R.draw(q[0]); for (const pt of q.slice(1)) d = d.lineTo(pt); return d.close();
  };
  let prof = R.drawRoundedRectangle(30, 30, 1).cut(R.drawCircle(3.4));
  for (let n = 0; n < 4; n++) prof = prof.cut(poly(slot, 90 * n));
  return prof;
}

/** Structural profiles to any length, standing up (Z is the length). w x d is the outline, t the wall or flange. */
export function stock(p, K, pos) {
  const w = pos('w', 2), d = pos('d', 2), t = pos('t', 0.2), tw = K.num(p.tw ?? t) || t, L = pos('len', 1), shape = p.shape || 'tube';
  const hw = w / 2, hd = d / 2;
  if (shape === 'tube') {
    if (2 * t >= Math.min(w, d)) K.fail('The wall is thicker than the tube');
    return { shape: K.ext(K.R.drawRectangle(w, d).cut(K.R.drawRectangle(w - 2 * t, d - 2 * t)), L) };
  }
  const outlines = {
    ibeam: () => { if (2 * t >= d || tw >= w) K.fail('The flanges and web do not fit the beam'); return [[-hw, -hd], [hw, -hd], [hw, -hd + t], [tw / 2, -hd + t], [tw / 2, hd - t], [hw, hd - t], [hw, hd], [-hw, hd], [-hw, hd - t], [-tw / 2, hd - t], [-tw / 2, -hd + t], [-hw, -hd + t]]; },
    cchannel: () => { if (2 * t >= d || tw >= w) K.fail('The flanges and web do not fit the channel'); return [[-hw, -hd], [hw, -hd], [hw, -hd + t], [-hw + tw, -hd + t], [-hw + tw, hd - t], [hw, hd - t], [hw, hd], [-hw, hd]]; },
    angle: () => { if (t >= Math.min(w, d)) K.fail('The legs are thinner than they are thick'); return [[-hw, -hd], [hw, -hd], [hw, -hd + t], [-hw + t, -hd + t], [-hw + t, hd], [-hw, hd]]; },
    tbeam: () => { if (t >= d || tw >= w) K.fail('The flange and stem do not fit the beam'); return [[-hw, hd], [hw, hd], [hw, hd - t], [tw / 2, hd - t], [tw / 2, -hd], [-tw / 2, -hd], [-tw / 2, hd - t], [-hw, hd - t]]; },
    flat: () => [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]],
  };
  const make = outlines[shape];
  if (!make) K.fail('Unknown profile');
  return { shape: K.ext(K.poly(make()), L) };
}

/** An L-shaped corner bracket with a screw hole in each arm and an optional triangular gusset. */
export function cornerbracket(p, K, pos) {
  const w = pos('w', 5), a = pos('armA', 5), b = pos('armB', 5), t = pos('t', 0.8), hole = pos('hole', 1), gusset = !!p.gusset;
  if (hole >= w - 2) K.fail('The hole is too wide for the bracket');
  const parts = [K.box(w, a, t, 0, a / 2, 0, 0.5), K.box(w, t, b, 0, t / 2, 0)];
  if (gusset) parts.push(K.move(K.poly([[t - 0.01, t - 0.01], [a * 0.7, t - 0.01], [t - 0.01, b * 0.7]]).sketchOnPlane('YZ').extrude(t), -t / 2, 0, 0));
  const cuts = [K.cyl(hole / 2, t + 2, 0, (a + t) / 2, -1), K.move(K.turn(K.cyl(hole / 2, t + 2), 90, 'x'), 0, t + 1, (b + t) / 2)];
  return { shape: K.cut(K.fuse(parts), cuts) };
}

/** A drop-in T-nut for aluminium extrusion: a block with chamfered edges and a hole to tap or fit a screw. */
export function tnut(p, K, pos) {
  const w = pos('w', 5), L = pos('len', 5), t = pos('t', 1), hole = pos('hole', 1), ch = Math.min(1.2, t / 3, w / 6);
  if (hole >= w - 2) K.fail('The hole is too wide for the nut');
  const prof = [[-w / 2 + ch, 0], [w / 2 - ch, 0], [w / 2, ch], [w / 2, t - ch], [w / 2 - ch, t], [-w / 2 + ch, t], [-w / 2, t - ch], [-w / 2, ch]];
  const body = K.move(K.poly(prof).sketchOnPlane('XZ').extrude(L), 0, L / 2, 0);
  return { shape: K.cut(body, K.cyl(hole / 2, t + 2, 0, 0, -1)) };
}

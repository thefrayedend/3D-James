// Knobs and handles: knurled / scalloped / plain knobs, thumbscrews, drawer pulls.

/** The outline of a knurled wheel: n V-shaped teeth, outer radius R, depth deep. */
const teethOutline = (K, R, depth, n) => {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; pts.push([R * Math.cos(a), R * Math.sin(a)], [(R - depth) * Math.cos(a + Math.PI / n), (R - depth) * Math.sin(a + Math.PI / n)]); }
  return K.poly(pts);
};

/** A hole for a shaft: round, or with a flat (a D shaft). */
const shaftBore = (K, d, flat, L, z) => {
  const c = K.cyl(d / 2, L, 0, 0, z);
  return flat > 0 ? K.cut(c, K.box(d, d, L + 2, d - flat, 0, z - 1)) : c;
};

/** A round knob: knurled (V teeth), scalloped (round dents) or plain; with a shaft hole (round or D), a nut pocket
 *  underneath and a set-screw hole. */
export function knob(p, K, pos) {
  const d = pos('d', 5), h = pos('h', 2), bore = pos('bore', 0.5), flat = K.num(p.flat ?? 0), style = ['knurl', 'scallop', 'round'].includes(p.style) ? p.style : 'knurl';
  const n = Math.round(K.num(p.teeth ?? 20)), depth = K.num(p.depth ?? 1.5), R = d / 2;
  if (bore >= d - 4) K.fail('The shaft hole is too wide for the knob');
  let body;
  if (style === 'knurl') {
    if (n < 6 || n > 80) K.fail('Teeth: 6 to 80');
    if (depth <= 0 || depth > R * 0.4) K.fail('The teeth are too deep for this knob');
    body = K.ext(teethOutline(K, R, depth, n), h);
  } else if (style === 'scallop') {
    if (n < 3 || n > 24) K.fail('Dents: 3 to 24');
    const s = Math.sin(Math.PI / n), rs = (0.97 * (R - depth) * s) / (1 - s);
    if (depth <= 0 || depth > R * 0.5) K.fail('The dents are too deep for this knob');
    body = K.cutMany(K.cyl(R, h), K.circle(n, R - depth + rs, (x, y) => K.cyl(rs, h + 2, x, y, -1)));
  } else {
    const ch = Math.min(1.5, h / 4, R / 6);
    body = K.revolve([[0, 0], [R, 0], [R, h - ch], [R - ch, h], [0, h]]);
  }
  const cuts = [shaftBore(K, bore, flat, h + 2, -1)];
  const af = K.num(p.trapAF ?? 0);
  if (af > 0) cuts.push(K.ext(K.hex(af + 0.3), Math.min(K.num(p.trapH ?? 3), h - 1) + 0.01, -0.01));
  if (p.setscrew) cuts.push(K.move(K.turn(K.cyl(1.6, R + 1), 90, 'y'), 0, 0, Math.min(h / 2, 8)));
  return { shape: K.cut(body, cuts) };
}

/** A thumbscrew: a wing, knurled or hex head on a plain shaft (give it a thread with the Thread tool, or print it
 *  with a hole and use a real bolt). */
export function thumbscrew(p, K, pos) {
  const hd = pos('hd', 5), hh = pos('hh', 2), d = pos('d', 1), L = pos('len', 1), head = ['wing', 'knurl', 'hex'].includes(p.head) ? p.head : 'wing';
  const shaft = K.cyl(d / 2, L + 0.01);
  let top;
  if (head === 'wing') {
    const hub = Math.max(d + 6, hh * 1.4);
    top = K.fuse(K.cyl(hub / 2, hh, 0, 0, L), K.box(hd, Math.max(3, hh * 0.45), hh, 0, 0, L, 1.2));
  } else if (head === 'knurl') top = K.ext(teethOutline(K, hd / 2, Math.min(1.2, hd / 12), 24), hh, L);
  else top = K.ext(K.hex(hd), hh, L);
  return { shape: K.fuse(shaft, top) };
}

/** A bar-shaped drawer pull: two posts and a bar, with a screw hole up each post from underneath. */
export function drawerpull(p, K, pos) {
  const sp = pos('spacing', 5), bd = pos('barD', 3), reach = pos('reach', 5), pd = pos('postD', 3), hole = K.num(p.hole ?? 0), hd = K.num(p.holeDepth ?? 0);
  if (reach < bd / 2 + 2) K.fail('The pull must stand further out from the drawer');
  const R = bd / 2;
  const parts = [K.move(K.turn(K.cyl(R, sp), 90, 'y'), -sp / 2, 0, reach), K.R.makeSphere(R).translate([-sp / 2, 0, reach]), K.R.makeSphere(R).translate([sp / 2, 0, reach])];
  for (const e of [-1, 1]) parts.push(K.cyl(pd / 2, reach, (e * sp) / 2, 0, 0));
  let s = K.fuse(parts);
  if (hole > 0 && hd > 0) s = K.cut(s, K.cyl(hole / 2, Math.min(hd, reach) + 0.01, -sp / 2, 0, -0.01), K.cyl(hole / 2, Math.min(hd, reach) + 0.01, sp / 2, 0, -0.01));
  return { shape: s };
}

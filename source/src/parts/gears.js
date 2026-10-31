// Gears: spur, helical (and herringbone) and bevel gears with involute teeth, racks, and worms.
// Teeth follow the standard proportions for module m: tip m above the pitch circle, root 1.25 m below it.

const inv = (a) => Math.tan(a) - a;

/** The outline of a gear: [x, y] points round z involute teeth of module m (pressure angle pa degrees). */
function gearOutline(K, m, z, pa) {
  const a = (pa * Math.PI) / 180, rp = (m * z) / 2, ra = rp + m, rr = rp - 1.25 * m, rb = rp * Math.cos(a), r0 = Math.max(rb, rr);
  const half = (r) => Math.PI / (2 * z) + inv(a) - inv(Math.acos(Math.min(1, rb / r))); // half the tooth's angle at radius r
  if (2 * half(ra) * ra < 0.1 * m) K.fail('Too few teeth for this pressure angle: the teeth come to a point. Use more teeth or a smaller pressure angle');
  if (rr <= 0.5) K.fail('The gear is too small for its teeth: use more teeth or a bigger module');
  const polar = (r, th) => [r * Math.cos(th), r * Math.sin(th)];
  const N = z > 40 ? 3 : z > 24 ? 4 : 6, pts = [];
  for (let i = 0; i < z; i++) {
    const phi = (2 * Math.PI * i) / z;
    for (let k = 0; k <= N; k++) { const r = r0 + ((ra - r0) * k) / N; pts.push(polar(r, phi - half(r))); }
    for (let k = N; k >= 0; k--) { const r = r0 + ((ra - r0) * k) / N; pts.push(polar(r, phi + half(r))); }
    // down to the root, and along the root circle to where the next tooth starts
    const a1 = phi + half(r0), a2 = phi + (2 * Math.PI) / z - half(r0), under = rr < r0 - 1e-6, rootR = under ? rr : r0;
    if (under) pts.push(polar(rr, a1));
    const steps = Math.max(1, Math.round((a2 - a1) / 0.3));
    for (let k = 1; k < steps; k++) pts.push(polar(rootR, a1 + ((a2 - a1) * k) / steps));
    if (under) pts.push(polar(rr, a2));
  }
  return K.poly(pts);
}

/** A hole for a shaft: round, or with a flat (a D shaft). */
const shaftBore = (K, d, flat, L, z) => {
  const c = K.cyl(d / 2, L, 0, 0, z);
  return flat > 0 ? K.cut(c, K.box(d, d, L + 2, d - flat, 0, z - 1)) : c;
};

/** A gear: spur (straight teeth), helical (slanted teeth, optionally two opposed halves: herringbone) or bevel (teeth
 *  on a cone, for a pair of gears whose shafts meet at 90 degrees). */
export function gear(p, K, pos) {
  const m = pos('m', 0.1), z = Math.round(pos('z', 6)), w = pos('w', 0.5), pa = pos('pa', 5), bore = pos('bore', 0.5), flat = K.num(p.flat ?? 0);
  const type = ['spur', 'helical', 'bevel'].includes(p.type) ? p.type : 'spur';
  if (z > 150) K.fail('Up to 150 teeth');
  if (pa > 35) K.fail('The pressure angle must be 35 degrees or less');
  const rp = (m * z) / 2, hubD = K.num(p.hubD ?? 0), hubH = K.num(p.hubH ?? 0);
  if (bore >= 2 * (rp - 1.25 * m) - 1) K.fail('The shaft hole is too wide for this gear');
  const outline = gearOutline(K, m, z, pa);
  let body;
  if (type === 'spur') body = K.ext(outline, w);
  else if (type === 'helical') {
    const beta = K.num(p.helix ?? 20);
    if (!(beta > 0 && beta < 45)) K.fail('The helix angle must be between 0 and 45 degrees');
    const herring = !!p.herring, wh = herring ? w / 2 : w;
    const twist = ((wh * Math.tan((beta * Math.PI) / 180)) / rp) * (180 / Math.PI); // the teeth lean over this far, in degrees
    const half = K.ext(outline, wh, 0, { twistAngle: twist });
    body = herring ? K.R.makeCompound([half, half.clone().mirror('XY', [0, 0, wh])]) : half;
  } else {
    const zm = Math.round(K.num(p.mate ?? z));
    if (zm < 6) K.fail('The other gear needs at least 6 teeth');
    const apex = rp / Math.tan(Math.atan2(z, zm)); // how far along the axis the cone's point is
    if (w >= apex * 0.8) K.fail('The face is too wide for the cone: make the gear narrower or its partner bigger');
    body = K.ext(outline, w, 0, { extrusionProfile: { profile: 'linear', endFactor: 1 - w / apex } });
  }
  const parts = [body];
  if (hubD > bore + 2 && hubH > 0) parts.push(K.cyl(hubD / 2, hubH + 0.01, 0, 0, w - 0.01));
  const cuts = [shaftBore(K, bore, flat, w + hubH + 2, -1)];
  return { shape: K.cut(K.fuse(parts), cuts) };
}

/** A rack: a straight bar of teeth that a gear of the same module runs along. */
export function rack(p, K, pos) {
  const m = pos('m', 0.1), n = Math.round(pos('teeth', 2)), w = pos('w', 0.5), base = pos('base', 0.5), pa = pos('pa', 5);
  if (n > 200) K.fail('Up to 200 teeth');
  const pitch = Math.PI * m, t = Math.tan((pa * Math.PI) / 180), hd = 1.25 * m;
  const pts = [];
  for (let k = 0; k < n; k++) {
    const x = k * pitch;
    pts.push([x - (pitch / 4 + hd * t), -hd], [x - (pitch / 4 - m * t), m], [x + (pitch / 4 - m * t), m], [x + (pitch / 4 + hd * t), -hd]);
  }
  const x0 = pts[0][0], x1 = pts[pts.length - 1][0];
  return { shape: K.ext(K.poly([[x0, -hd - base], ...pts, [x1, -hd - base]]), w) };
}

/** A worm: a screw-shaped gear that turns a worm wheel (a spur or helical gear of the same module). */
export function worm(p, K, pos) {
  const m = pos('m', 0.1), starts = Math.round(pos('starts', 1)), L = pos('len', 1), pd = pos('pitchD', 2), bore = pos('bore', 0.5), flat = K.num(p.flat ?? 0);
  if (starts > 4) K.fail('Starts: 1 to 4');
  const ra = pd / 2 + m, rr = pd / 2 - 1.25 * m;
  if (rr <= bore / 2 + 1) K.fail('The worm is too thin for its shaft hole');
  // across the worm, a round bar with a rounded ridge for every start; the ridge winds round as it goes along
  const pts = [], M = 36 * starts;
  for (let i = 0; i < M; i++) {
    const th = (2 * Math.PI * i) / M, f = Math.min(1, Math.max(0, 1.3 * Math.cos(starts * th) + 0.15));
    const r = rr + (ra - rr) * f;
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  const lead = starts * Math.PI * m, twist = (360 * L) / lead * (p.hand === 'left' ? -1 : 1);
  const body = K.ext(K.poly(pts), L, 0, { twistAngle: twist });
  return { shape: K.cut(body, shaftBore(K, bore, flat, L + 2, -1)) };
}

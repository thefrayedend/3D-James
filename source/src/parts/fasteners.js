// More fasteners: wood and sheet-metal screws (pointed, plain solids) and pop rivets.

/** A wood screw (countersunk or pan head) or a sheet-metal screw (pan head), standing on its point, head up. */
export function woodscrew(p, K, pos) {
  const d = pos('d', 1), L = pos('len', 3), dk = pos('dk', 2), k = pos('k', 0.5), type = p.type || 'wood', R = d / 2;
  if (dk <= d) K.fail('The head must be wider than the shank');
  const tip = Math.min(L * 0.45, (type === 'sheet' ? 1.6 : 2.2) * d);
  const pts = [[0, 0], [R, tip]];
  if (type === 'wood') {
    // countersunk (90 degrees): the length is overall, head included
    const cone = Math.min(L - tip - 0.1, (dk - d) / 2);
    pts.push([R, L - cone], [dk / 2, L], [0, L]);
  } else {
    // pan head: the length is under the head; the head is a low dome
    pts.push([R, L], [dk / 2, L]);
    for (let i = 1; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); pts.push([(dk / 2) * Math.cos(a), L + k * Math.sin(a)]); }
    pts.pop(); pts.push([0, L + k]);
  }
  let s = K.revolve(pts);
  // a cross-shaped recess in the head
  const top = type === 'wood' ? L : L + k, rw = Math.max(0.5, dk * 0.12), rl = dk * 0.55, rd = Math.min(k, dk * 0.25, 2);
  s = K.cut(s, K.box(rl, rw, rd + 0.01, 0, 0, top - rd), K.box(rw, rl, rd + 0.01, 0, 0, top - rd));
  return { shape: s };
}

/** A pop rivet (open type): a body with a flange and a hole for the mandrel. */
export function rivet(p, K, pos) {
  const d = pos('d', 1), L = pos('len', 1), fd = pos('flangeD', 1), ft = pos('flangeT', 0.2), bore = pos('bore', 0.1);
  if (fd <= d) K.fail('The flange must be wider than the body');
  if (bore >= d - 0.6) K.fail('The hole is too wide for the body');
  return { shape: K.revolve([[bore / 2, 0], [d / 2, 0], [d / 2, L], [fd / 2, L], [fd / 2, L + ft], [bore / 2, L + ft]]) };
}

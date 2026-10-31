// Small helpers for the ready-made part builders (src/parts/*.js), on top of replicad (R). Parts are built standing on
// the floor (Z up), around X = Y = 0; the engine then centers them and puts the bottom on Z = 0.
// replicad's booleans leave their inputs alone, so a finished piece can be used again; pieces that were only
// stepping stones are freed with free().

export function makeKit(R, num, fail) {
  const K = { R, num, fail };

  /** A cylinder standing on z, centered on (x, y). */
  K.cyl = (r, h, x = 0, y = 0, z = 0) => R.makeCylinder(r, h, [x, y, z]);
  /** A drawing stood up from height z, h tall. */
  K.ext = (d, h, z = 0, opts) => d.sketchOnPlane('XY', z).extrude(h, opts);
  /** A box w x d x h centered on (x, y) with its bottom at z; r rounds its vertical corners. */
  K.box = (w, d, h, x = 0, y = 0, z = 0, r = 0) => K.ext(R.drawRoundedRectangle(w, d, r).translate(x, y), h, z);
  /** A closed outline through these [x, y] points. */
  K.poly = (pts) => { let d = R.draw(pts[0]); for (const q of pts.slice(1)) d = d.lineTo(q); return d.close(); };
  /** A profile of [radius, height] points spun around Z. */
  K.revolve = (pts) => K.poly(pts).sketchOnPlane('XZ').revolve([0, 0, 1]);
  K.move = (s, x = 0, y = 0, z = 0) => s.translate([x, y, z]);
  /** Turned deg degrees about an axis through the origin ('x', 'y' or 'z'). */
  K.turn = (s, deg, axis = 'x') => s.rotate(deg, [0, 0, 0], { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[axis]);
  K.free = (...shapes) => { for (const s of shapes.flat()) { try { s?.delete(); } catch { /* already gone */ } } };
  K.fuse = (...list) => { const l = list.flat().filter(Boolean); return l.slice(1).reduce((a, b) => a.fuse(b), l[0]); };
  K.cut = (base, ...list) => list.flat().filter(Boolean).reduce((a, b) => a.cut(b), base);
  // Many pieces at once go in as one compound, which is far quicker than one boolean after another. ONLY for pieces
  // that do not overlap each other (a row of pockets, a ring of holes): overlapping pieces make the boolean do nothing.
  const group = (l) => (l.length === 1 ? l[0] : R.makeCompound(l));
  K.fuseMany = (base, pieces) => { const l = pieces.filter(Boolean); return l.length ? base.fuse(group(l)) : base; };
  K.cutMany = (base, tools) => { const l = tools.filter(Boolean); return l.length ? base.cut(group(l)) : base; };
  /** Cylinders around the Z axis, n of them evenly on a circle of radius R0 (a bolt circle), turned by deg. */
  K.circle = (n, R0, make, deg = 0) => Array.from({ length: n }, (_, i) => { const a = ((deg + (360 * i) / n) * Math.PI) / 180; return make(R0 * Math.cos(a), R0 * Math.sin(a), i); });
  /** A hexagon drawing with this width across flats. */
  K.hex = (af) => R.drawPolysides(af / 2 / Math.cos(Math.PI / 6), 6);
  /** Through the same rounded outline at several heights (a smooth, straight-sided blend): rings = [{ z, w, d, r }]. */
  K.stack = (rings) => {
    const sk = rings.map((g) => R.drawRoundedRectangle(g.w, g.d, Math.max(0.05, Math.min(g.r, g.w / 2 - 0.01, g.d / 2 - 0.01))).sketchOnPlane('XY', g.z));
    return sk[0].loftWith(sk.slice(1), { ruled: true });
  };
  return K;
}

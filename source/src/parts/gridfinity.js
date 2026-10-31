// Gridfinity (Zack Freedman's open storage system): baseplates and bins on the 42 mm grid, 7 mm height units.
// The numbers follow the common community profile: a bin's foot is 4.75 mm tall (0.8 chamfer, 1.8 straight, 2.15
// chamfer) and 41.5 mm wide at the top; a baseplate pocket is 4.65 mm deep and 0.25 mm roomier on each side, so a bin
// slides in (its top is a hair under 42 so the walls between cells do not meet in a knife edge); magnet holes 6.5 x 2.4 mm
// at 13 mm from the middle of each cell.

const PITCH = 42, GAP = 0.5, HW = (PITCH - GAP) / 2; // a bin cell is 41.5 wide (half: 20.75)
const FOOT = [[0, 17.8], [0.8, 18.6], [2.6, 18.6], [4.75, HW]]; // [height, half width] of a bin's foot
const POCKET = [[0, 18.15], [0.7, 18.85], [2.5, 18.85], [4.65, 20.9]]; // the baseplate pocket the foot sits in
const R_TOP = 3.75, MAG_D = 6.5, MAG_DEPTH = 2.4, MAG_AT = 13, LIP = 4.4;
const rOf = (hw) => hw - (HW - R_TOP);

const cells = (nx, ny) => { const out = []; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) out.push([(i - (nx - 1) / 2) * PITCH, (j - (ny - 1) / 2) * PITCH]); return out; };
const loft = (K, ring, x = 0, y = 0) => K.stack(ring.map(([z, hw, r]) => ({ z, w: 2 * hw, d: 2 * hw, r: r ?? rOf(hw) }))).translate([x, y, 0]);

export function gfbaseplate(p, K, pos) {
  const nx = Math.round(pos('nx', 1)), ny = Math.round(pos('ny', 1)), fl = K.num(p.floor ?? 0);
  if (nx > 12 || ny > 12) K.fail('A baseplate can be up to 12 units each way');
  if (!(fl >= 0)) K.fail('Floor cannot be negative');
  const H = fl + 4.65;
  let s = K.box(nx * PITCH, ny * PITCH, H, 0, 0, 0, R_TOP + 0.25);
  const pockets = [], magnets = [];
  for (const [x, y] of cells(nx, ny)) {
    // the pocket, a little over the top so the cut is clean
    pockets.push(loft(K, [...POCKET.map(([z, hw]) => [fl + z, hw]), [H + 0.3, 20.9, R_TOP + 0.15]], x, y));
    if (p.magnets && fl >= MAG_DEPTH + 0.4) for (const sx of [-1, 1]) for (const sy of [-1, 1]) magnets.push(K.cyl(MAG_D / 2, MAG_DEPTH + 0.01, x + sx * MAG_AT, y + sy * MAG_AT, fl - MAG_DEPTH));
  }
  return { shape: K.cutMany(K.cutMany(s, pockets), magnets) };
}

export function gfbin(p, K, pos) {
  const nx = Math.round(pos('nx', 1)), ny = Math.round(pos('ny', 1)), nz = Math.round(pos('nz', 1)), wall = pos('wall', 0.8);
  if (nx > 8 || ny > 8) K.fail('A bin can be up to 8 units each way');
  if (nz > 20) K.fail('A bin can be up to 20 units tall');
  const dx = Math.round(K.num(p.divx ?? 1)), dy = Math.round(K.num(p.divy ?? 1));
  if (dx < 1 || dy < 1 || dx > 12 || dy > 12) K.fail('Compartments must be 1 to 12 each way');
  if (wall > 6) K.fail('Wall must be 6 mm or less');
  const W = nx * PITCH - GAP, D = ny * PITCH - GAP, H = nz * 7, lip = !!p.lip;
  if (lip && H - 4.75 < 6.2) K.fail('A stacking lip needs a bin at least 2 units tall');
  const inW = W - 2 * wall, inD = D - 2 * wall;
  const grid = cells(nx, ny);
  let s = K.fuseMany(K.box(W, D, H - 4.75, 0, 0, 4.75, R_TOP), grid.map(([x, y]) => loft(K, FOOT, x, y)));
  // inside: the cavity above the feet, and under each cell a smaller one, down to a 0.8 mm floor
  s = s.cut(K.box(inW, inD, H + 1 - 4.75, 0, 0, 4.75, Math.max(0.4, R_TOP - wall)));
  s = K.cutMany(s, grid.map(([x, y]) => loft(K, [[0.8, 18.6 - wall], [2.6, 18.6 - wall], [4.75, HW - wall], [4.85, HW - wall]].map(([z, hw]) => [z, hw, Math.max(0.4, rOf(hw + wall) - wall)]), x, y)));
  if (p.magnets) {
    const holes = [];
    for (const [x, y] of grid) for (const sx of [-1, 1]) for (const sy of [-1, 1]) holes.push(K.cyl(MAG_D / 2, MAG_DEPTH, x + sx * MAG_AT, y + sy * MAG_AT, -0.01));
    s = K.cutMany(s, holes);
  }
  // dividers between compartments (up to the lip)
  const top = lip ? H - LIP : H, add = [];
  for (let i = 1; i < dx; i++) add.push(K.box(wall, inD + 0.4, top - 4.7, -inW / 2 + (i * (inW - (dx - 1) * wall)) / dx + (i - 0.5) * wall, 0, 4.7));
  for (let j = 1; j < dy; j++) add.push(K.box(inW + 0.4, wall, top - 4.7, 0, -inD / 2 + (j * (inD - (dy - 1) * wall)) / dy + (j - 0.5) * wall, 4.7));
  if (add.length) s = K.fuse(s, add);
  if (lip) {
    // the stacking lip: a rim round the top that the foot of the next bin sits in
    const outer = K.stack([{ z: H - 6.05, w: W, d: D, r: R_TOP }, { z: H, w: W, d: D, r: R_TOP }]);
    const ring = ([z, o]) => ({ z, w: W - 2 * o, d: D - 2 * o, r: Math.max(0.4, R_TOP - o) });
    const inner = K.stack([[H - 6.05, wall], [H - 4.4, HW - 17.9], [H - 3.6, HW - 18.7], [H - 1.8, HW - 18.7], [H, HW - 20.25], [H + 0.2, HW - 20.25]].map(ring));
    s = K.fuse(s, K.cut(outer, inner));
  }
  return { shape: s };
}

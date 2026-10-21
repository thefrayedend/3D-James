// Reading DXF and SVG drawings into sketch lines: straight lines and arcs stay lines and arcs (circles stay circles),
// other curves become short straight pieces. Lines come back as unfinished (open) lines; the sketch board joins the
// ones whose ends meet into closed outlines. Sizes are in millimetres. Parsed as data only.
import { bulgeFrom3 } from './sketchgeom.js';

const MAX_PIECES = 20000;
const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** Straight pieces per curve: about one every 1 mm, between 8 and 64. */
const stepsFor = (len) => Math.max(8, Math.min(64, Math.ceil(len)));

/** A list of 2D points (+ bulge for the side after each) as an open line; or null when it is too small. */
function openLine(pts, bulge, closed) {
  const P = [], B = [];
  pts.forEach((p, i) => {
    if (!p.every(Number.isFinite)) return;
    if (P.length && Math.hypot(p[0] - P[P.length - 1][0], p[1] - P[P.length - 1][1]) < 1e-9) { B[B.length - 1] = B[B.length - 1] || bulge?.[i] || 0; return; }
    P.push([p[0], p[1]]); B.push(+(bulge?.[i] || 0));
  });
  if (closed && P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) > 1e-9) { P.push([P[0][0], P[0][1]]); B.push(0); }
  else if (closed && P.length > 1) B[B.length - 1] = 0;
  if (P.length < 2) return null;
  B[B.length - 1] = 0;
  const l = { type: 'open', pts: P };
  if (B.some((x) => Math.abs(x) > 1e-12)) l.bulge = B;
  return l;
}
/** An arc (center, radius, start and end angle in radians, counter-clockwise) as points + bulges (at most a half turn each). */
function arcPts(c, r, a0, a1) {
  let sweep = a1 - a0; while (sweep <= 1e-12) sweep += 2 * Math.PI;
  const n = Math.ceil(sweep / Math.PI - 1e-9), pts = [], bulge = [];
  for (let k = 0; k <= n; k++) { const a = a0 + (sweep * k) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); bulge.push(k < n ? Math.tan(sweep / n / 4) : 0); }
  return { pts, bulge };
}

// ---------------------------------------------------------------- DXF
/** DXF text → [[code, value], ...]. */
function dxfPairs(text) {
  const L = text.split(/\r\n|\r|\n/), out = [];
  for (let i = 0; i + 1 < L.length; i += 2) { const code = parseInt(L[i].trim(), 10); if (!Number.isFinite(code)) continue; out.push([code, L[i + 1].trim()]); }
  return out;
}
/** The entities of a DXF list (from the ENTITIES section or one block): [{ type, g: [[code, value]...] }]. */
function entityList(pairs, from, until) {
  const out = []; let cur = null;
  for (let i = from; i < until; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { cur = { type: v, g: [] }; out.push(cur); } else if (cur) cur.g.push([c, v]);
  }
  return out;
}
const num = (g, code, d = 0) => { const x = g.find((p) => p[0] === code); return x ? parseFloat(x[1]) : d; };
const str = (g, code) => g.find((p) => p[0] === code)?.[1];
const nums = (g, code) => g.filter((p) => p[0] === code).map((p) => parseFloat(p[1]));
const DXF_UNITS = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0000254, 9: 0.0254, 10: 914.4 };

/** De Boor: a point on a B-spline (NURBS when weights are given). */
function splineAt(t, deg, knots, cps, w) {
  const n = cps.length - 1;
  let s = deg; while (s < n && knots[s + 1] <= t) s++;
  const d = []; for (let j = 0; j <= deg; j++) { const P = cps[s - deg + j], wt = w ? w[s - deg + j] : 1; d.push([P[0] * wt, P[1] * wt, wt]); }
  for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
    const i = s - deg + j, den = knots[i + deg + 1 - r] - knots[i], a = den ? (t - knots[i]) / den : 0;
    d[j] = [0, 1, 2].map((k) => (1 - a) * d[j - 1][k] + a * d[j][k]);
  }
  return [d[deg][0] / d[deg][2], d[deg][1] / d[deg][2]];
}

/**
 * Read a DXF file (text). Returns { loops, skipped } in millimetres: LINE, ARC, CIRCLE, LWPOLYLINE / POLYLINE (with
 * bulges), ELLIPSE and SPLINE (as short straight pieces), and blocks placed with INSERT. Text, hatches, dimensions and
 * 3D things are skipped (counted in skipped).
 */
export function readDxf(text) {
  if (text.length > 30 * 1048576) throw new Error('Use a DXF file smaller than 30 MB.');
  const pairs = dxfPairs(text);
  if (!pairs.some(([c, v]) => c === 0 && v === 'SECTION')) throw new Error('This is not a DXF file (or it is a binary DXF: save it as ASCII DXF).');
  // sections
  const sections = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1]; let j = i + 2; while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1] === 'ENDSEC')) j++;
      sections[name] = [i + 2, j]; i = j;
    }
  }
  // units ($INSUNITS in the header; none given: millimetres)
  let scale = 1;
  if (sections.HEADER) for (let i = sections.HEADER[0]; i < sections.HEADER[1]; i++) if (pairs[i][0] === 9 && pairs[i][1] === '$INSUNITS') { scale = DXF_UNITS[parseInt(pairs[i + 1]?.[1], 10)] || 1; break; }
  // blocks
  const blocks = {};
  if (sections.BLOCKS) {
    const ents = entityList(pairs, ...sections.BLOCKS);
    let cur = null;
    for (const e of ents) {
      if (e.type === 'BLOCK') { cur = { name: str(e.g, 2), base: [num(e.g, 10), num(e.g, 20)], ents: [] }; blocks[cur.name] = cur; }
      else if (e.type === 'ENDBLK') cur = null;
      else if (cur) cur.ents.push(e);
    }
  }
  const loops = []; let skipped = 0;
  // a transform: [a, b, c, d, e, f]: x' = a x + c y + e, y' = b x + d y + f
  const apply = (T, p) => [T[0] * p[0] + T[2] * p[1] + T[4], T[1] * p[0] + T[3] * p[1] + T[5]];
  const mul = (T, U) => [T[0] * U[0] + T[2] * U[1], T[1] * U[0] + T[3] * U[1], T[0] * U[2] + T[2] * U[3], T[1] * U[2] + T[3] * U[3], T[0] * U[4] + T[2] * U[5] + T[4], T[1] * U[4] + T[3] * U[5] + T[5]];
  const det = (T) => T[0] * T[3] - T[1] * T[2];
  const uniform = (T) => Math.abs(Math.hypot(T[0], T[1]) - Math.hypot(T[2], T[3])) < 1e-9 * Math.hypot(T[0], T[1]) && Math.abs(T[0] * T[2] + T[1] * T[3]) < 1e-9;
  const add = (pts, bulge, closed, T) => {
    if (loops.length > MAX_PIECES) throw new Error('This drawing has too much in it for a sketch. Simplify it first.');
    const flip = det(T) < 0 ? -1 : 1;
    const l = openLine(pts.map((p) => apply(T, p)), bulge?.map((b) => b * flip), closed);
    if (l) loops.push(l);
  };
  const addCurve = (pts, T) => add(pts, null, false, T);
  const walk = (ents, T, depth) => {
    // a drawing turned over (extrusion direction 0,0,-1): mirrored left-right
    for (const e of ents) {
      const g = e.g, ez = num(g, 230, 1), Tm = ez < 0 ? mul(T, [-1, 0, 0, 1, 0, 0]) : T;
      switch (e.type) {
        case 'LINE': add([[num(g, 10), num(g, 20)], [num(g, 11), num(g, 21)]], null, false, T); break;
        case 'CIRCLE': {
          const c = [num(g, 10), num(g, 20)], r = num(g, 40);
          if (!(r > 0)) break;
          if (uniform(Tm)) { const C = apply(Tm, c), k = Math.hypot(Tm[0], Tm[1]); loops.push({ type: 'circle', c: C, r: r * k }); }
          else { const n = stepsFor(2 * Math.PI * r), pts = []; for (let k = 0; k <= n; k++) { const a = (2 * Math.PI * k) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } addCurve(pts, Tm); }
          break;
        }
        case 'ARC': {
          const c = [num(g, 10), num(g, 20)], r = num(g, 40), a0 = (num(g, 50) * Math.PI) / 180, a1 = (num(g, 51) * Math.PI) / 180;
          if (!(r > 0)) break;
          if (uniform(Tm)) { const { pts, bulge } = arcPts(c, r, a0, a1); add(pts, bulge, false, Tm); }
          else { let sw = a1 - a0; while (sw <= 0) sw += 2 * Math.PI; const n = stepsFor(sw * r), pts = []; for (let k = 0; k <= n; k++) { const a = a0 + (sw * k) / n; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } addCurve(pts, Tm); }
          break;
        }
        case 'LWPOLYLINE': {
          // vertices: 10/20 each, with an optional 42 (bulge) after; 70 bit 1: closed
          const pts = [], bulge = [], closed = (num(g, 70) & 1) === 1;
          for (const [c, v] of g) { if (c === 10) { pts.push([parseFloat(v), 0]); bulge.push(0); } else if (c === 20 && pts.length) pts[pts.length - 1][1] = parseFloat(v); else if (c === 42 && pts.length) bulge[bulge.length - 1] = parseFloat(v); }
          if (closed && pts.length > 1) { pts.push(pts[0].slice()); }
          add(pts, uniform(Tm) ? bulge : null, closed, Tm); // (squashed by a block: arcs can't stay arcs)
          break;
        }
        case 'ELLIPSE': {
          const c = [num(g, 10), num(g, 20)], M = [num(g, 11), num(g, 21)], k = num(g, 40, 1), t0 = num(g, 41, 0), t1 = num(g, 42, 2 * Math.PI);
          const Mn = [-M[1] * k, M[0] * k]; let sw = t1 - t0; while (sw <= 1e-12) sw += 2 * Math.PI;
          const n = stepsFor(sw * Math.hypot(...M)), pts = [];
          for (let j = 0; j <= n; j++) { const t = t0 + (sw * j) / n; pts.push([c[0] + M[0] * Math.cos(t) + Mn[0] * Math.sin(t), c[1] + M[1] * Math.cos(t) + Mn[1] * Math.sin(t)]); }
          addCurve(pts, Tm); break;
        }
        case 'SPLINE': {
          const deg = num(g, 71, 3), knots = nums(g, 40), w = nums(g, 41), xs = nums(g, 10), ys = nums(g, 20);
          const fx = nums(g, 11), fy = nums(g, 21);
          const cps = xs.map((x, i) => [x, ys[i] ?? 0]);
          if (cps.length > deg && knots.length === cps.length + deg + 1) {
            const k0 = knots[deg], k1 = knots[cps.length], n = Math.max(16, Math.min(200, cps.length * 8)), pts = [];
            for (let j = 0; j <= n; j++) pts.push(splineAt(k0 + ((k1 - k0) * j) / n, deg, knots, cps, w.length === cps.length ? w : null));
            addCurve(pts, Tm);
          } else if (fx.length >= 2) addCurve(fx.map((x, i) => [x, fy[i] ?? 0]), Tm);
          else skipped++;
          break;
        }
        case 'INSERT': {
          const b = blocks[str(g, 2)]; if (!b || depth > 8) { skipped++; break; }
          const sx = num(g, 41, 1), sy = num(g, 42, 1), rot = (num(g, 50) * Math.PI) / 180, P = [num(g, 10), num(g, 20)];
          const cs = Math.cos(rot), sn = Math.sin(rot);
          // place: move the block's base point to 0, scale, turn, move to P
          let U = [cs * sx, sn * sx, -sn * sy, cs * sy, 0, 0]; U = mul(U, [1, 0, 0, 1, -b.base[0], -b.base[1]]); U[4] += P[0]; U[5] += P[1];
          // a grid of copies (columns 70 / rows 71, spacing 44 / 45)
          const cols = Math.max(1, num(g, 70, 1)), rows = Math.max(1, num(g, 71, 1)), dc = num(g, 44), dr = num(g, 45);
          for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
            const off = [cs * q * dc - sn * r * dr, sn * q * dc + cs * r * dr];
            walk(b.ents, mul(Tm, [U[0], U[1], U[2], U[3], U[4] + off[0], U[5] + off[1]]), depth + 1);
          }
          break;
        }
        case 'POLYLINE': break; // its VERTEX entities follow (below)
        case 'VERTEX': case 'SEQEND': break;
        case 'POINT': case 'ATTDEF': case 'ATTRIB': break;
        default: skipped++;
      }
    }
    // old-style POLYLINE: VERTEX entities up to SEQEND
    for (let i = 0; i < ents.length; i++) {
      if (ents[i].type !== 'POLYLINE') continue;
      const g = ents[i].g; if (num(g, 70) & (8 | 16 | 64)) { skipped++; continue; } // 3D polylines and meshes
      const pts = [], bulge = []; let j = i + 1;
      for (; j < ents.length && ents[j].type === 'VERTEX'; j++) { pts.push([num(ents[j].g, 10), num(ents[j].g, 20)]); bulge.push(num(ents[j].g, 42)); }
      const closed = (num(g, 70) & 1) === 1;
      if (closed && pts.length > 1) pts.push(pts[0].slice());
      add(pts, bulge, closed, num(g, 230, 1) < 0 ? mul(T, [-1, 0, 0, 1, 0, 0]) : T);
      i = j;
    }
  };
  if (!sections.ENTITIES) throw new Error('This DXF has no drawing in it.');
  walk(entityList(pairs, ...sections.ENTITIES), [scale, 0, 0, scale, 0, 0], 0);
  return { loops: tidy(loops), skipped };
}

// ---------------------------------------------------------------- SVG
const SVG_UNITS = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
/** How many mm one SVG user unit is (from the width and viewBox; plain numbers are pixels, 96 to the inch). */
function svgScale(root) {
  const m = /^\s*([\d.eE+-]+)\s*([a-z%]*)\s*$/.exec(root.getAttribute('width') || '');
  const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
  const unit = m && m[2] !== '%' ? SVG_UNITS[m[2]] : null;
  if (m && unit && vb.length === 4 && vb[2] > 0) return (parseFloat(m[1]) * unit) / vb[2];
  if (m && unit) return unit;
  return 25.4 / 96;
}
/**
 * Read an SVG drawing (text). Every path, line, rectangle, circle, ellipse and polygon (filled or just drawn) becomes
 * sketch lines; circles stay circles, circle arcs stay arcs. Returns { loops, skipped } in millimetres, y going up.
 * SVGLoader comes from three.js (passed in, so this file stays free of the 3D library).
 */
export function readSvg(text, SVGLoader) {
  if (text.length > 10 * 1048576) throw new Error('Use an SVG smaller than 10 MB.');
  const xml = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (xml.querySelector('parsererror') || xml.documentElement.localName !== 'svg') throw new Error('This is not a valid SVG file.');
  const k = svgScale(xml.documentElement);
  const skipped = xml.querySelectorAll('text, image').length;
  const { paths } = new SVGLoader().parse(text);
  const loops = [];
  const P = (v) => [v.x * k, -v.y * k];
  for (const path of paths) {
    for (const sp of path.subPaths) {
      if (loops.length > MAX_PIECES) throw new Error('This drawing has too much in it for a sketch. Simplify it first.');
      const cs = sp.curves; if (!cs.length) continue;
      // a whole circle: a circle
      if (cs.length === 1 && cs[0].isEllipseCurve && Math.abs(cs[0].xRadius - cs[0].yRadius) < 1e-9 && Math.abs(Math.abs(cs[0].aEndAngle - cs[0].aStartAngle) - 2 * Math.PI) < 1e-6) {
        const c = cs[0]; loops.push({ type: 'circle', c: [c.aX * k, -c.aY * k], r: c.xRadius * k }); continue;
      }
      const pts = [], bulge = [];
      for (const c of cs) {
        if (c.isLineCurve) { if (!pts.length) { pts.push(P(c.v1)); bulge.push(0); } pts.push(P(c.v2)); bulge.push(0); continue; }
        const first = c.getPoint(0);
        if (!pts.length) { pts.push(P(first)); bulge.push(0); }
        if (c.isEllipseCurve && Math.abs(c.xRadius - c.yRadius) < 1e-9 && !c.aRotation) {
          // a circle arc: one arc side per half turn at most
          const sw = Math.abs(c.aEndAngle - c.aStartAngle), n = Math.max(1, Math.ceil(sw / Math.PI - 1e-9));
          for (let j = 1; j <= n; j++) { const A = pts[pts.length - 1], M = P(c.getPoint((j - 0.5) / n)), B = P(c.getPoint(j / n)); bulge[bulge.length - 1] = bulgeFrom3(A, M, B); pts.push(B); bulge.push(0); }
          continue;
        }
        const n = Math.ceil(stepsFor(c.getLength() * k) / 2);
        for (let j = 1; j <= n; j++) { pts.push(P(c.getPoint(j / n))); bulge.push(0); }
      }
      const l = openLine(pts, bulge, sp.autoClose);
      if (l) loops.push(l);
    }
  }
  return { loops: tidy(loops), skipped };
}

/** Round to a millionth of a mm, drop empty pieces. */
function tidy(loops) {
  const out = [];
  for (const l of loops) {
    if (l.type === 'circle') { if (l.r > 1e-6 && l.c.every(Number.isFinite)) out.push({ type: 'circle', c: l.c.map(r6), r: r6(l.r) }); continue; }
    l.pts = l.pts.map((p) => p.map(r6));
    if (l.bulge) l.bulge = l.bulge.map((b) => r6(b));
    out.push(l);
  }
  return out;
}

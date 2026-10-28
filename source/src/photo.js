// Photos for sketches: straighten a photo (taken at an angle) from a rectangle of known size, scale it from a line
// of known length, and find the outline of a part on a plain background. Plain image maths on canvases, no screen code.
//
// A photo in a sketch: p.photo = { file, x, y, w, h, opacity, hidden }   (mm; x, y = its lower-left corner on the board)
// The picture itself is a JPEG kept like an imported model file (saved inside the project).
import { bulgeFrom3 } from './sketchgeom.js';
import { r3 } from './shared.js';

/** Load a picture file (photo) into an <img>, smaller if huge (the long side at most maxSide pixels). */
export async function loadPicture(file, maxSide = 3000) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('That file is not a picture this browser can open (use JPEG or PNG).')); i.src = url; });
    const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally { URL.revokeObjectURL(url); }
}

// ---------------------------------------------------------------- perspective (homography)
/** The 3x3 projective map taking 4 source points to 4 target points (both [[x, y] x4]). */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  if (!h) throw new Error('Those four corners don\'t make a rectangle. Click them in order around the shape.');
  return [...h, 1];
}
export const applyH = (H, [x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
export function invertH(H) {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map((v) => v / det);
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Put 4 clicked corners in order around the shape (counter-clockwise from the lowest-left one on screen). */
export function orderCorners(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / 4, cy = pts.reduce((s, p) => s + p[1], 0) / 4;
  const by = pts.slice().sort((a, b) => Math.atan2(cy - a[1], a[0] - cx) - Math.atan2(cy - b[1], b[0] - cx)); // screen y points down
  // start at the corner nearest the bottom-left of the picture
  let k = 0, best = Infinity;
  by.forEach((p, i) => { const d = (p[0] - cx) - (p[1] - cy); if (d < best) { best = d; k = i; } });
  return [...by.slice(k), ...by.slice(0, k)];
}

/**
 * Straighten a photo: the 4 corners (picture pixels, in order around) of a rectangle w x h mm become an exact
 * rectangle. The whole photo comes along (big parts can stick out past the rectangle). Returns a canvas at `pxPerMm`
 * and where the rectangle's lower-left corner is in it: { canvas, mmPerPx, rect: [x0, y0] (mm, from the canvas's
 * lower-left), w, h (mm) }.
 */
export function straighten(src, corners, wMm, hMm, maxSide = 2400) {
  // millimetres with y up: lower-left (0,0), lower-right (w,0), upper-right (w,h), upper-left (0,h)
  const mm = [[0, 0], [wMm, 0], [wMm, hMm], [0, hMm]];
  const H = homography(corners, mm), Hi = invertH(H);
  // where the whole photo lands (corners of the picture), kept within 4x the rectangle so a steep photo stays sane
  const pc = [[0, 0], [src.width, 0], [src.width, src.height], [0, src.height]].map((p) => applyH(H, p));
  const lim = 4 * Math.max(wMm, hMm);
  const xs = pc.map((p) => p[0]), ys = pc.map((p) => p[1]);
  const x0 = Math.max(-lim, Math.min(...xs, 0)), x1 = Math.min(wMm + lim, Math.max(...xs, wMm));
  const y0 = Math.max(-lim, Math.min(...ys, 0)), y1 = Math.min(hMm + lim, Math.max(...ys, hMm));
  // resolution: about what the photo had across the rectangle, at most maxSide pixels
  const across = Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]) / wMm;
  let ppm = Math.max(1, across);
  ppm = Math.min(ppm, maxSide / (x1 - x0), maxSide / (y1 - y0));
  const W = Math.max(1, Math.round((x1 - x0) * ppm)), Hh = Math.max(1, Math.round((y1 - y0) * ppm));
  const s = src.getContext('2d').getImageData(0, 0, src.width, src.height), sd = s.data;
  const out = document.createElement('canvas'); out.width = W; out.height = Hh;
  const o = out.getContext('2d').createImageData(W, Hh), od = o.data;
  for (let j = 0; j < Hh; j++) {
    const ym = y1 - (j + 0.5) / ppm;
    for (let i = 0; i < W; i++) {
      const [u, v] = applyH(Hi, [x0 + (i + 0.5) / ppm, ym]);
      const k = (j * W + i) * 4;
      if (u < 0 || v < 0 || u >= src.width - 1 || v >= src.height - 1) { od[k] = od[k + 1] = od[k + 2] = 235; od[k + 3] = 255; continue; }
      const ui = u | 0, vi = v | 0, fu = u - ui, fv = v - vi, p = (vi * src.width + ui) * 4, q = p + src.width * 4;
      for (let ch = 0; ch < 3; ch++) od[k + ch] = (sd[p + ch] * (1 - fu) + sd[p + 4 + ch] * fu) * (1 - fv) + (sd[q + ch] * (1 - fu) + sd[q + 4 + ch] * fu) * fv;
      od[k + 3] = 255;
    }
  }
  out.getContext('2d').putImageData(o, 0, 0);
  return { canvas: out, mmPerPx: 1 / ppm, rect: [-x0, -y0], w: wMm, h: hMm };
}

/** Scale only (no straightening): two picture points are `lenMm` apart. */
export function scaleOnly(src, a, b, lenMm, maxSide = 2400) {
  const px = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (px < 5) throw new Error('Click two points further apart.');
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const out = document.createElement('canvas'); out.width = Math.round(src.width * k); out.height = Math.round(src.height * k);
  out.getContext('2d').drawImage(src, 0, 0, out.width, out.height);
  return { canvas: out, mmPerPx: lenMm / (px * k) };
}

/** The picture as JPEG bytes (for saving inside the project). */
export async function jpegBytes(canvas, quality = 0.85) {
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  return new Uint8Array(await blob.arrayBuffer());
}

// ---------------------------------------------------------------- finding the outline
/** How dark each pixel is (0..255), a little smoothed. */
function grey(canvas) {
  const { width: W, height: H } = canvas, d = canvas.getContext('2d').getImageData(0, 0, W, H).data;
  const g = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // 3x3 box blur, twice (takes the grain out of photos)
  for (let pass = 0; pass < 2; pass++) {
    const t = new Float32Array(g);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += t[(y + dy) * W + x + dx];
      g[y * W + x] = s / 9;
    }
  }
  return g;
}
/** Otsu's threshold: the grey level that best splits the picture in two. */
function otsu(g, mask) {
  const hist = new Float64Array(256); let n = 0;
  for (let i = 0; i < g.length; i++) if (!mask || mask[i]) { hist[Math.max(0, Math.min(255, g[i] | 0))]++; n++; }
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sB += t * hist[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}

/**
 * Find the outlines of the part. area: [x0, y0, x1, y1] pixels to look in (e.g. inside the paper), or the whole picture.
 * level: -1..1 shifts the light/dark split. detail: mm, how far the outline may stray from the edge.
 * Returns loops in mm (y up, from the canvas's lower-left): [{ type: 'poly', pts, bulge? } | { type: 'circle', c, r }].
 */
export function findOutline(canvas, mmPerPx, { area = null, level = 0, detail = 0.5, minArea = 4 } = {}) {
  const W = canvas.width, H = canvas.height, g = grey(canvas);
  const [ax0, ay0, ax1, ay1] = area ? area.map(Math.round) : [0, 0, W, H];
  const inArea = new Uint8Array(W * H);
  for (let y = Math.max(0, ay0); y < Math.min(H, ay1); y++) for (let x = Math.max(0, ax0); x < Math.min(W, ax1); x++) inArea[y * W + x] = 1;
  const th = otsu(g, inArea) + level * 60;
  // which side is the part: the background is what touches the edge of the area most
  let darkEdge = 0, edgeN = 0;
  for (let x = ax0; x < ax1; x++) for (const y of [ay0, ay1 - 1]) if (y >= 0 && y < H && x >= 0 && x < W) { edgeN++; if (g[y * W + x] < th) darkEdge++; }
  for (let y = ay0; y < ay1; y++) for (const x of [ax0, ax1 - 1]) if (y >= 0 && y < H && x >= 0 && x < W) { edgeN++; if (g[y * W + x] < th) darkEdge++; }
  const partIsDark = darkEdge < edgeN / 2;
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = inArea[i] && ((g[i] < th) === partIsDark) ? 1 : 0;
  // hair-thin lines touching the part (tape, scratches, a pencil line) are not part of it
  open1(m, W, H);
  // keep only the pieces that don't touch the area's edge (shadows, the table) and aren't specks
  const minPx = minArea / (mmPerPx * mmPerPx);
  keepParts(m, W, H, minPx);
  // the outline of every piece, and of every hole in it
  const loops = [];
  for (const ring of traceRings(m, W, H)) {
    if (Math.abs(ringArea(ring)) < minPx) continue;
    const mm = ring.map(([x, y]) => [x * mmPerPx, (H - y) * mmPerPx]);
    const tol = Math.max(detail, mmPerPx * 1.5); // pixel stair-steps are not corners
    const circle = asCircle(mm, tol);
    if (circle) { loops.push(circle); continue; }
    const simple = simplifyClosed(mm, tol);
    if (simple.length >= 3) loops.push(withArcs(simple, tol));
  }
  return loops;
}

/** Morphological opening by one pixel: removes lines one or two pixels thin, keeps everything thicker. */
function open1(m, W, H) {
  const er = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; er[i] = m[i] && m[i - 1] && m[i + 1] && m[i - W] && m[i + W] ? 1 : 0; }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; m[i] = er[i] || er[i - 1] || er[i + 1] || er[i - W] || er[i + W] ? 1 : 0; }
}
/** Drop pieces touching the picture's edge and pieces smaller than minPx. */
function keepParts(m, W, H, minPx) {
  const lab = new Int32Array(W * H), stack = [];
  let n = 0;
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || lab[s]) continue;
    n++; let size = 0, touches = false; const cells = [];
    stack.push(s); lab[s] = n;
    while (stack.length) {
      const i = stack.pop(); cells.push(i); size++;
      const x = i % W, y = (i / W) | 0;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
      for (const j of [i - 1, i + 1, i - W, i + W]) if (j >= 0 && j < W * H && m[j] && !lab[j] && Math.abs((j % W) - x) <= 1) { lab[j] = n; stack.push(j); }
    }
    if (touches || size < minPx) for (const i of cells) m[i] = 0;
  }
}

/** Marching squares: every boundary between part and background, as closed rings of corner points. */
function traceRings(m, W, H) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? m[y * W + x] : 0);
  // edges between pixel corners; each directed edge has the part on its left
  const next = new Map();
  const key = (x, y) => y * (W + 1) + x;
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) {
    // horizontal edge from (x,y) to (x+1,y): between pixel (x,y-1) above and (x,y) below
    if (x < W) { const up = at(x, y - 1), dn = at(x, y); if (up !== dn) { if (dn) add(x + 1, y, x, y); else add(x, y, x + 1, y); } }
    // vertical edge from (x,y) to (x,y+1): between pixel (x-1,y) left and (x,y) right
    if (y < H) { const lf = at(x - 1, y), rt = at(x, y); if (lf !== rt) { if (rt) add(x, y, x, y + 1); else add(x, y + 1, x, y); } }
  }
  function add(x0, y0, x1, y1) { const k = key(x0, y0); if (!next.has(k)) next.set(k, []); next.get(k).push([x1, y1]); }
  const rings = [];
  while (next.size) {
    const [k0] = next.keys();
    let cur = [k0 % (W + 1), Math.floor(k0 / (W + 1))], prev = null;
    const ring = [cur];
    for (let guard = 0; guard < 4 * (W + 1) * (H + 1); guard++) {
      const k = key(cur[0], cur[1]), list = next.get(k);
      if (!list) break;
      // at a corner where two rings touch, turn left (keeps pieces apart)
      let pick = 0;
      if (list.length > 1 && prev) {
        const din = [cur[0] - prev[0], cur[1] - prev[1]];
        pick = list.findIndex((p) => { const d = [p[0] - cur[0], p[1] - cur[1]]; return din[0] * d[1] - din[1] * d[0] < 0; });
        if (pick < 0) pick = 0;
      }
      const nx = list.splice(pick, 1)[0];
      if (!list.length) next.delete(k);
      prev = cur; cur = nx;
      if (cur[0] === ring[0][0] && cur[1] === ring[0][1]) break;
      ring.push(cur);
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}
function ringArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

/** Douglas-Peucker on a closed ring. */
export function simplifyClosed(pts, tol) {
  if (pts.length < 4) return pts.slice();
  // split at the two points furthest apart, simplify both halves
  let a = 0, b = 0, best = -1;
  for (let i = 0; i < pts.length; i += Math.max(1, (pts.length / 64) | 0)) for (let j = i + 1; j < pts.length; j += Math.max(1, (pts.length / 64) | 0)) {
    const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2; if (d > best) { best = d; a = i; b = j; }
  }
  const half1 = pts.slice(a, b + 1), half2 = [...pts.slice(b), ...pts.slice(0, a + 1)];
  const s1 = dp(half1, tol), s2 = dp(half2, tol);
  return sharpen(dropStraight([...s1.slice(0, -1), ...s2.slice(0, -1)], tol), tol);
}
/** Two corners very close together (a corner the photo's blur shaved off) become one sharp corner, where the two
 *  sides around them meet. */
function sharpen(pts, tol) {
  const out = pts.slice(), near = Math.max(tol * 3, 1.2);
  for (let i = 0; i < out.length && out.length > 3; i++) {
    const n = out.length, A = out[(i - 1 + n) % n], P = out[i], Q = out[(i + 1) % n], B = out[(i + 2) % n];
    if (Math.hypot(Q[0] - P[0], Q[1] - P[1]) > near) continue;
    // where line A-P meets line Q-B
    const d1 = [P[0] - A[0], P[1] - A[1]], d2 = [B[0] - Q[0], B[1] - Q[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) continue;
    const t = ((Q[0] - A[0]) * d2[1] - (Q[1] - A[1]) * d2[0]) / den, X = [A[0] + d1[0] * t, A[1] + d1[1] * t];
    if (Math.hypot(X[0] - P[0], X[1] - P[1]) > near * 2) continue;
    out.splice(i, 2, X); if (i >= out.length) break;
    i--;
  }
  return out;
}
/** Corners that lie on a straight line between their neighbours (left where the ring was split) go away. */
function dropStraight(pts, tol) {
  const out = pts.slice();
  for (let changed = true; changed && out.length > 3;) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 3; i++) {
      const A = out[(i - 1 + out.length) % out.length], P = out[i], B = out[(i + 1) % out.length];
      const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9;
      if (Math.abs((P[0] - A[0]) * dy - (P[1] - A[1]) * dx) / L <= tol * 0.8) { out.splice(i, 1); changed = true; i--; }
    }
  }
  return out;
}
function dp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const A = pts[0], B = pts[pts.length - 1], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9;
  let far = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i][0] - A[0]) * dy - (pts[i][1] - A[1]) * dx) / L; if (d > far) { far = d; idx = i; } }
  if (far <= tol) return [A, B];
  return [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)];
}

/** A ring that is a circle (a hole for a screw, a round part): { type: 'circle' }. */
function asCircle(pts, tol) {
  if (pts.length < 16) return null;
  const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const rs = pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])), r = rs.reduce((s, v) => s + v, 0) / rs.length;
  if (r < 0.5) return null;
  const dev = Math.max(...rs.map((v) => Math.abs(v - r)));
  return dev <= Math.max(tol, r * 0.04) ? { type: 'circle', c: c.map(r3), r: r3(r) } : null;
}

/** Runs of short sides along a curve become one arc each (bulge), so a curved edge is a few arcs, not 40 lines. */
function withArcs(simple, tol) {
  const n = simple.length, pts = simple.map((p) => [r3(p[0]), r3(p[1])]);
  const bulge = new Array(n).fill(0);
  // a side is "short" next to the size of the shape; runs of 3+ short sides that bend the same way are tried as an arc
  const len = (i) => Math.hypot(pts[(i + 1) % n][0] - pts[i][0], pts[(i + 1) % n][1] - pts[i][1]);
  const turn = (i) => { const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n]; return Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])); };
  const per = pts.reduce((s, _, i) => s + len(i), 0), short = per / 12;
  const keep = new Array(n).fill(true);
  let i = 0;
  while (i < n) {
    if (len(i) > short) { i++; continue; }
    let j = i; const t = turn((i + 1) % n);
    while (j + 1 < n + i && len((j + 1) % n) <= short && turn((j + 1) % n) === t) j++;
    if (j - i >= 2) {
      const A = pts[i], B = pts[(j + 1) % n], M = pts[(((i + j + 1) / 2) | 0) % n];
      const b = bulgeFrom3(A, M, B);
      const ok = b !== 0 && [...Array(j - i)].every((_, k) => arcDist(A, B, b, pts[(i + 1 + k) % n]) <= tol * 1.5);
      if (ok) { bulge[i] = b; for (let k = i + 1; k <= j; k++) keep[k % n] = false; }
    }
    i = j + 1;
  }
  const out = { type: 'poly', pts: [], bulge: [] };
  for (let k = 0; k < n; k++) if (keep[k]) { out.pts.push(pts[k]); out.bulge.push(Math.round(bulge[k] * 1e6) / 1e6); }
  if (!out.bulge.some((x) => x)) delete out.bulge;
  return out;
}
function arcDist(A, B, b, P) {
  // distance from P to the circle through the arc
  const c = Math.hypot(B[0] - A[0], B[1] - A[1]), R = (c * (1 + b * b)) / (4 * Math.abs(b));
  const s = (b * c) / 2, mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2, dx = (B[0] - A[0]) / c, dy = (B[1] - A[1]) / c;
  const off = R - Math.abs(s), C = [mx - (dy * s / Math.abs(s)) * off, my + (dx * s / Math.abs(s)) * off];
  return Math.abs(Math.hypot(P[0] - C[0], P[1] - C[1]) - R);
}

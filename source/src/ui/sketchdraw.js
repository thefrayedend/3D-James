// Sketch board: screen coordinates, snapping, and drawing the board (lines, sizes, rule badges, measurements).
// Installed on the board object `sb` by openSketch (sketch.js); everything shared lives on sb.
import { ATTACH, POINT_RULES, analyzeSketch, bulgeOf, isCircleRef, pointOf } from '../sketchsolve.js';
import * as SG from '../sketchgeom.js';
import { app } from '../state.js';
import { h } from './dom.js';
import { EPS, RULE_BTNS, RULE_MARK, fmtN, r3, samePt, svgEl } from './sketchkit.js';

export function installDraw(sb) {

  // ---- coordinates
  sb.rect = () => sb.svg.getBoundingClientRect();
  sb.toScreen = ([x, y]) => [sb.view.ox + x * sb.view.s, sb.view.oy - y * sb.view.s];
  sb.toMm = (cx, cy) => { const r = sb.rect(); return [(cx - r.left - sb.view.ox) / sb.view.s, -(cy - r.top - sb.view.oy) / sb.view.s]; };
  sb.grid = () => (app.settings.grid > 0 ? app.settings.grid : 0);
  /** Outlines and unfinished lines: drawn sides that can be picked, deleted and redrawn (not circles or helper lines). */
  sb.hasSides = (l) => l?.type === 'poly' || l?.type === 'open';
  sb.sideMid = (l, i) => { const n = l.pts.length; return SG.arcMid(l.pts[i], l.pts[(i + 1) % n], +(l.bulge?.[i] || 0)); };

  /** Snap targets: [{p, kind}] (corners, middles of sides, centers). */
  sb.targets = function targets(exclude, skipLoop) {
    const S = sb.snaps(), out = [];
    if (S.center) out.push({ p: [0, 0], kind: 'center', ref: { o: 1 } });
    for (const [li, l] of sb.loops.entries()) {
      if (li === skipLoop) continue;
      if (l.type === 'circle') { if (S.center) out.push({ p: l.c, kind: 'center', ref: { l: li, k: 0 } }); continue; }
      const n = l.pts.length;
      for (let i = 0; i < n; i++) {
        if (S.corner && l.pts[i] !== exclude) out.push({ p: l.pts[i], kind: 'corner', ref: { l: li, k: i } });
        if (S.middle && l.pts[i] !== exclude && l.pts[(i + 1) % n] !== exclude && i < SG.sideCount(l)) out.push({ p: sb.sideMid(l, i), kind: 'middle', side: { l: li, i } });
      }
    }
    if (sb.current?.type === 'poly') {
      sb.current.pts.forEach((p, i) => {
        if (S.corner) out.push({ p, kind: 'corner' });
        if (S.middle && i) out.push({ p: SG.arcMid(sb.current.pts[i - 1], p, sb.current.bulge[i - 1] || 0), kind: 'middle' });
      });
    }
    if (sb.ref) for (const t of sb.ref.pts || []) if (S[t.kind] !== false) out.push({ ...t, pinAt: t.p });
    return out;
  };
  /** Where a click really lands: a corner, middle or center close by; else lined up with one; else the grid. */
  /** Every line on the board as short straight pieces (arcs and circles cut up finely), for snapping onto lines. */
  sb.pieces = function pieces(skipLoop, skipPt) {
    const out = [];
    sb.loops.forEach((l, li) => {
      if (li === skipLoop) return;
      if (l.type === 'circle') { const f = SG.flattenLoop(l); f.forEach((p, k) => out.push([p, f[(k + 1) % f.length], false, { l: li, circle: 1 }])); return; }
      const n = l.pts.length;
      for (let i = 0; i < SG.sideCount(l); i++) {
        const A = l.pts[i], B = l.pts[(i + 1) % n];
        if (skipPt && (A === skipPt || B === skipPt)) continue;
        const pts = [A, ...SG.arcPoints(A, B, bulgeOf(l, i))];
        for (let k = 0; k + 1 < pts.length; k++) out.push([pts[k], pts[k + 1], !bulgeOf(l, i), bulgeOf(l, i) ? null : { l: li, i }]);
      }
    });
    for (const sgm of sb.ref?.segs || []) for (let k = 0; k + 1 < sgm.length; k++) out.push([sgm[k], sgm[k + 1], sgm.length === 2, sgm.length === 2 ? { fixed: [sgm[0], sgm[1]] } : null]);
    for (const o of sb.ref?.outline || []) o.forEach((p, k) => out.push([p, o[(k + 1) % o.length], false, null]));
    return out;
  };
  sb.nearestOn = (p, [A, B]) => { const d = [B[0] - A[0], B[1] - A[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1e-12; const t = Math.max(0, Math.min(1, ((p[0] - A[0]) * d[0] + (p[1] - A[1]) * d[1]) / L2)); return [A[0] + d[0] * t, A[1] + d[1] * t]; };
  /** Holding Shift: only straight across, straight up and down, or at 45° from where the line starts (like Paint). */
  sb.constrain45 = function constrain45(anchor, p, diagonalOnly) {
    const d = [p[0] - anchor[0], p[1] - anchor[1]];
    let a = Math.atan2(d[1], d[0]);
    a = diagonalOnly ? Math.PI / 4 + Math.round((a - Math.PI / 4) / (Math.PI / 2)) * (Math.PI / 2) : Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    const u = [Math.cos(a), Math.sin(a)];
    let t = d[0] * u[0] + d[1] * u[1];
    const g = sb.snaps().grid ? sb.grid() : 0;
    if (g) t = Math.round(t / g) * g;
    return [r3(anchor[0] + u[0] * t), r3(anchor[1] + u[1] * t)];
  };
  /** A loose end that has grabbed the pointer: { key, minD (closest the pointer came), free (pulled back: let go) }. */
  sb.endGrab = null;
  sb.PULL_BACK_PX = 14; // pulling back this far (on screen) from the closest point lets go of the loose end
  /** How far (mm) a loose end reaches while Alt is held (and for Join close ends): "Loose ends" under Snap to, 10 mm to start. */
  sb.endReach = () => Math.max(+app.settings.skEndReach > 0 ? +app.settings.skEndReach : 10, 12 / sb.view.s);
  /** How far a loose end reaches normally: 2 mm, but never less than about 12 pixels on screen (zoomed out). */
  sb.nearReach = () => Math.max(2, (12 * sb.fat) / sb.view.s);
  /** The loose ends a new point can join: the ends of unfinished lines, and where the line being drawn started. */
  sb.looseEnds = function looseEnds(exclude) {
    const out = [];
    sb.loops.forEach((l, li) => { if (l.type === 'open' && !sb.isFrozen(li)) for (const k of [0, l.pts.length - 1]) if (l.pts[k] !== exclude) out.push({ p: l.pts[k], ref: { l: li, k } }); });
    if (sb.current?.type === 'poly' && sb.current.pts.length >= 2) out.push({ p: sb.current.pts[0], start: 1 });
    return out;
  };
  sb.snap = function snap(p, exclude, opt = {}) {
    // Ctrl: exactly where the pointer is, no snapping at all
    if (opt.free) { sb.snapInfo = { kind: 'free', at: p }; sb.reachNow = 0; return p.map(r3); }
    // a loose end close by wins over everything else: lines join up instead of just missing each other.
    // It reaches 2 mm normally, and much further (10 mm) while Alt is held.
    sb.reachNow = opt.ends && sb.snaps().end ? (opt.alt ? sb.endReach() : sb.nearReach()) : 0;
    if (sb.reachNow) {
      let best = null, bd = sb.reachNow;
      const from = opt.anchor;
      for (const t of sb.looseEnds(exclude)) { if (from && samePt(t.p, from)) continue; const d = Math.hypot(t.p[0] - p[0], t.p[1] - p[1]); if (d < bd) { bd = d; best = t; } }
      if (!best) sb.endGrab = null;
      else {
        // the end grabs the pointer as it comes closer; pulling back away from it lets go (place the point anywhere
        // near it); leaving its zone and coming back grabs again
        const key = `${best.p[0]},${best.p[1]}`;
        if (sb.endGrab?.key !== key) sb.endGrab = { key, minD: bd, free: false };
        if (!sb.endGrab.free) { sb.endGrab.minD = Math.min(sb.endGrab.minD, bd); if (bd > sb.endGrab.minD + sb.PULL_BACK_PX / sb.view.s) sb.endGrab.free = true; }
        if (!sb.endGrab.free) { sb.snapInfo = { kind: 'end', at: [best.p[0], best.p[1]], ref: best.ref }; return [best.p[0], best.p[1]]; }
      }
    } else sb.endGrab = null;
    if (opt.shift && opt.anchor) { const q = sb.constrain45(opt.anchor, p, opt.diagonal); sb.snapInfo = { kind: 'angle', at: q, from: opt.anchor }; return q; }
    const S = sb.snaps(), tol = (9 * sb.fat) / sb.view.s;
    const T = sb.targets(exclude, opt.skipLoop);
    let best = null, bd = tol;
    for (const t of T) { const d = Math.hypot(t.p[0] - p[0], t.p[1] - p[1]); if (d < bd - 1e-9 || (best && Math.abs(d - bd) < 1e-9 && t.kind === 'corner')) { bd = d; best = t; } }
    if (best) { sb.snapInfo = { kind: best.kind, at: [best.p[0], best.p[1]], ref: best.ref, side: best.side, pinAt: best.pinAt }; return [r3(best.p[0]), r3(best.p[1])]; }
    if (S.edge) {
      // close to a line (any side, arc, circle, helper line, or the face's edges): latch onto it
      let on = null, od = (7 * sb.fat) / sb.view.s, onRef = null;
      for (const pc of sb.pieces(opt.skipLoop, exclude)) { const q = sb.nearestOn(p, pc); const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < od) { od = d; on = q; onRef = pc[3]; } }
      if (on) { sb.snapInfo = { kind: 'edge', at: on, line: onRef }; return on.map((v) => Math.round(v * 1e4) / 1e4); }
    }
    const q = [p[0], p[1]]; const guides = []; let lockX = false, lockY = false, level = null;
    // Level & upright: a line drawn within 2° of level (or of straight up and down) goes exactly level, and keeps a rule
    if (S.level && opt.anchor && !opt.diagonal && !opt.dragging) {
      const dx = p[0] - opt.anchor[0], dy = p[1] - opt.anchor[1], k = Math.tan((2 * Math.PI) / 180);
      if (Math.hypot(dx, dy) > 1e-6) {
        if (Math.abs(dy) <= k * Math.abs(dx)) { q[1] = opt.anchor[1]; lockY = true; level = 'level'; }
        else if (Math.abs(dx) <= k * Math.abs(dy)) { q[0] = opt.anchor[0]; lockX = true; level = 'upright'; }
      }
    }
    if (S.guide) {
      let gx = null, gy = null, dx = 6 / sb.view.s, dy = 6 / sb.view.s;
      for (const t of T) {
        if (t.kind === 'middle') continue;
        if (Math.abs(t.p[0] - p[0]) < dx) { dx = Math.abs(t.p[0] - p[0]); gx = t.p; }
        if (Math.abs(t.p[1] - p[1]) < dy) { dy = Math.abs(t.p[1] - p[1]); gy = t.p; }
      }
      if (gx && !lockX) { q[0] = gx[0]; guides.push(gx); lockX = true; }
      if (gy && !lockY) { q[1] = gy[1]; guides.push(gy); lockY = true; }
    }
    const g = S.grid ? sb.grid() : 0;
    if (g) { if (!lockX) q[0] = Math.round(q[0] / g) * g; if (!lockY) q[1] = Math.round(q[1] / g) * g; }
    sb.snapInfo = guides.length ? { kind: 'guide', guides, at: q, ...(level ? { from: opt.anchor } : {}) } : level ? { kind: level, at: q, from: opt.anchor } : null;
    return q.map(r3);
  };
  sb.fit = function fit() {
    const r = sb.rect();
    const all = [...sb.loops]; if (sb.current?.type === 'poly' && sb.current.pts.length) all.push({ type: 'poly', pts: sb.current.pts });
    let b = all.length ? SG.loopsBounds(all) : null;
    const refLines = [...(sb.ref?.segs || []), ...(sb.ref?.outline || [])];
    if (refLines.length) { const rb = SG.loopsBounds(refLines.map((s) => ({ type: 'poly', pts: s }))); b = b ? [Math.min(b[0], rb[0]), Math.min(b[1], rb[1]), Math.max(b[2], rb[2]), Math.max(b[3], rb[3])] : rb; }
    if (!b || !Number.isFinite(b[0])) { sb.view.s = 6; sb.view.ox = r.width / 2; sb.view.oy = r.height / 2; sb.draw(); return; }
    const w = Math.max(b[2] - b[0], 10), hh = Math.max(b[3] - b[1], 10);
    sb.view.s = Math.min(r.width / w, r.height / hh) * 0.7;
    sb.view.ox = r.width / 2 - ((b[0] + b[2]) / 2) * sb.view.s; sb.view.oy = r.height / 2 + ((b[1] + b[3]) / 2) * sb.view.s;
    sb.draw();
  };

  // ---- drawing
  sb.pathOf = (pts, closed = true) => 'M' + pts.map((p) => sb.toScreen(p).join(' ')).join(' L') + (closed ? ' Z' : '');
  sb.draw = function draw() {
    if (sb.owners) for (const l of sb.loops) if (l.owner == null || !sb.owners[l.owner]) l.owner = sb.newOwner;
    sb.ensureAnchor(); sb.refreshShown();
    if (!sb.drag && !sb.press?.moving) {
      const key = JSON.stringify([sb.loops, sb.rules]);
      if (key !== sb.lockKey) { sb.lockKey = key; try { sb.lockInfo = sb.loops.length ? analyzeSketch(sb.loops, sb.rules) : null; } catch { sb.lockInfo = null; } }
    }
    const r = sb.rect(); sb.svg.replaceChildren();
    // grid: minor lines every grid step (when not too dense), major every 10 mm
    const g = sb.grid() || 1, step = g * sb.view.s >= 6 ? g : 10;
    const [mx0, my1] = sb.toMm(r.left, r.top), [mx1, my0] = sb.toMm(r.right, r.bottom);
    const gg = svgEl('g', { class: 'sk-grid' });
    for (let x = Math.floor(mx0 / step) * step; x <= mx1; x += step) { const [sx] = sb.toScreen([x, 0]); gg.append(svgEl('line', { x1: sx, y1: 0, x2: sx, y2: r.height, class: Math.abs(x % 10) < 1e-6 ? 'major' : '' })); }
    for (let y = Math.floor(my0 / step) * step; y <= my1; y += step) { const [, sy] = sb.toScreen([0, y]); gg.append(svgEl('line', { x1: 0, y1: sy, x2: r.width, y2: sy, class: Math.abs(y % 10) < 1e-6 ? 'major' : '' })); }
    const [axx, axy] = sb.toScreen([0, 0]);
    gg.append(svgEl('line', { x1: 0, y1: axy, x2: r.width, y2: axy, class: 'axis x' }), svgEl('line', { x1: axx, y1: 0, x2: axx, y2: r.height, class: 'axis y' }));
    sb.drawPhoto(); // a photo to trace over: under the grid lines
    sb.svg.append(gg);
    // the objects seen straight on (light), then the edges lying on the sketch plane (dashed)
    if (sb.ref?.outline?.length) sb.svg.append(svgEl('path', { d: sb.ref.outline.map((o) => sb.pathOf(o)).join(' '), class: 'sk-outline', 'fill-rule': 'evenodd' }));
    // the face being sketched on
    if (sb.ref?.segs) for (const s of sb.ref.segs) sb.svg.append(svgEl('path', { d: sb.pathOf(s, false), class: 'sk-ref' }));
    // shapes: filled with even-odd so holes show as holes
    const flat = sb.loops.map((l) => SG.flattenLoop(l));
    const path = flat.filter((_, i) => SG.isSolidLoop(sb.loops[i])).map((f) => sb.pathOf(f)).join(' ');
    if (path) sb.svg.append(svgEl('path', { d: path, class: 'sk-fill', 'fill-rule': 'evenodd' }));
    sb.loops.forEach((l, i) => {
      sb.svg.append(svgEl('path', { d: sb.pathOf(flat[i], !SG.isOpenLoop(l)), class: (l.type === 'line' ? 'sk-helper' : 'sk-loop') + (l.type === 'open' ? ' open' : '') + (sb.sel === i ? ' sel' : ''), ...(sb.owners && sb.sel !== i ? { style: `stroke:${sb.owners[l.owner]?.color}` } : {}) }));
      // fully locked parts turn green
      if (sb.lockInfo && sb.sel !== i) {
        if (l.type === 'circle') { if (sb.lockInfo.locked(l.c) && sb.lockInfo.locked(l)) sb.svg.append(svgEl('path', { d: sb.pathOf(flat[i]), class: 'sk-locked' })); }
        else for (let k = 0; k < SG.sideCount(l); k++) {
          const A = l.pts[k], B = l.pts[(k + 1) % l.pts.length];
          if (sb.lockInfo.locked(A) && sb.lockInfo.locked(B) && (!bulgeOf(l, k) || sb.lockInfo.locked(`${i}:${k}`))) sb.svg.append(svgEl('path', { d: sb.pathOf([A, ...SG.arcPoints(A, B, bulgeOf(l, k))], false), class: 'sk-locked' + (l.type === 'line' ? ' helper' : '') }));
        }
      }
      for (const p of l.type === 'circle' ? [l.c] : l.pts) { const [x, y] = sb.toScreen(p); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: sb.sel === i ? 4.5 : 3, class: 'sk-pt' + (sb.sel === i ? ' sel' : sb.lockInfo?.locked(p) ? ' locked' : '') })); }
      // the picked shape gets a small diamond on each side: drag it to bend the side into an arc
      if (sb.sel === i && (l.type === 'poly' || l.type === 'open') && sb.tool === 'select') {
        for (let k = 0; k < SG.sideCount(l); k++) {
          const [x, y] = sb.toScreen(sb.sideMid(l, k));
          sb.svg.append(svgEl('rect', { x: x - 4, y: y - 4, width: 8, height: 8, transform: `rotate(45 ${x} ${y})`, class: 'sk-bend' }));
        }
      }
    });
    // the loose ends of unfinished lines: orange rings (click one with Line or Arc to carry on from it)
    for (const l of sb.loops) if (l.type === 'open') for (const p of [l.pts[0], l.pts[l.pts.length - 1]]) { const [x, y] = sb.toScreen(p); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 7, class: 'sk-open-end' })); }
    // drawing near a loose end: its pull zone shows (inside it, the point goes onto the end)
    // holding Alt while drawing: the long reach of the loose ends shows as dashed circles
    if (sb.cursor && sb.reachNow > sb.nearReach() + 1e-9 && (sb.tool === 'line' || sb.tool === 'arc' || sb.drag)) {
      const R = sb.reachNow;
      for (const t of sb.looseEnds(null)) if (Math.hypot(t.p[0] - sb.cursor[0], t.p[1] - sb.cursor[1]) < 2 * R) { const [x, y] = sb.toScreen(t.p); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: R * sb.view.s, class: 'sk-reach' + (sb.endGrab?.free && sb.endGrab.key === `${t.p[0]},${t.p[1]}` ? ' free' : '') })); }
    }
    for (const p of sb.picks) {
      if (sb.pickIs.side(p)) { const l = sb.loops[p.l]; if (!l?.pts) continue; const A = l.pts[p.i], B = l.pts[(p.i + 1) % l.pts.length]; sb.svg.append(svgEl('path', { d: sb.pathOf([A, ...SG.arcPoints(A, B, bulgeOf(l, p.i))], false), class: 'sk-edge-sel' })); }
      else if (sb.pickIs.pt(p)) { const P = pointOf(sb.loops, sb.ptRef(p)); if (P) { const [x, y] = sb.toScreen(P); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 7, class: 'sk-corner-sel' })); } }
      else if (sb.pickIs.circle(p)) { const l = sb.loops[p.l]; if (l?.type === 'circle') sb.svg.append(svgEl('path', { d: sb.pathOf(flat[p.l]), class: 'sk-edge-sel', fill: 'none' })); }
    }
    if (sb.selCorner && sb.loops[sb.selCorner.l]?.pts?.[sb.selCorner.i]) { const [x, y] = sb.toScreen(sb.loops[sb.selCorner.l].pts[sb.selCorner.i]); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 7, class: 'sk-corner-sel' })); }
    // sizes: every straight side's length, every arc's radius, rounded corners, circles (click one to change it)
    sb.loops.forEach((l, li) => {
      if (l.type === 'circle') {
        const [cx, cy] = sb.toScreen([l.c[0], +l.c[1] + +l.r]);
        sb.dimLabel(`⌀ ${fmtN(l.r * 2)}`, cx, cy - 10, (v) => sb.setDiameter(li, v), sb.rules.some((r) => r.t === 'diam' && r.a.l === li && !r.ref));
        return;
      }
      const n = l.pts.length;
      for (let i = 0; i < SG.sideCount(l); i++) {
        const A = l.pts[i], B = l.pts[(i + 1) % n], b = +(l.bulge?.[i] || 0), len = Math.hypot(B[0] - A[0], B[1] - A[1]);
        if (len < 1e-6) continue;
        const [ax, ay] = sb.toScreen(A), [bx, by] = sb.toScreen(B);
        if (sb.selEdge && sb.selEdge.l === li && sb.selEdge.i === i) sb.svg.append(svgEl('path', { d: sb.pathOf([A, ...SG.arcPoints(A, B, b)], false), class: 'sk-edge-sel' }));
        const M = SG.arcMid(A, B, b), [mx, my] = sb.toScreen(M);
        let nx = -(by - ay), ny = bx - ax; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const probe = [M[0] + (nx / sb.view.s) * 3, M[1] - (ny / sb.view.s) * 3];
        if (SG.insideLoop(l, probe)) { nx = -nx; ny = -ny; }
        if (Math.hypot(bx - ax, by - ay) < 28) continue; // too short on screen for a label
        if (Math.abs(b) > EPS) sb.dimLabel(`R ${fmtN(SG.arcRadius(A, B, b))}`, mx + nx * 16, my + ny * 16, (v) => sb.setRadius(li, i, v), sb.rules.some((r) => r.t === 'radius' && r.a?.l === li && r.a?.i === i && !r.ref));
        else sb.dimLabel(fmtN(len), mx + nx * 14, my + ny * 14, (v) => { if (v > 0) sb.setLength(li, i, v, true); }, sb.rules.some((r) => r.t === 'length' && r.a?.l === li && r.a?.i === i && !r.ref));
      }
      // rounded corners
      (l.round || []).forEach((rr, i) => {
        if (!(+rr > 0)) return;
        const [x, y] = sb.toScreen(l.pts[i]);
        const c = SG.loopsBounds([l]); const cx = (c[0] + c[2]) / 2, cy = (c[1] + c[3]) / 2; const [sx, sy] = sb.toScreen([cx, cy]);
        const d = Math.hypot(sx - x, sy - y) || 1;
        sb.dimLabel(`R${fmtN(rr)}`, x + ((sx - x) / d) * 22, y + ((sy - y) / d) * 22, (v) => sb.setRound(l, i, v));
      });
    });
    sb.drawBadges();
    // attached points: a small purple dot (pins: a pin)
    for (const r of sb.rules) {
      if (!ATTACH.has(r.t) || r.t === 'pin') continue; const P = pointOf(sb.loops, r.p); if (!P) continue; const [x, y] = sb.toScreen(P);
      sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 4, class: 'sk-attach' }));
    }
    // measurements between points (they stay): a thin line with arrows and the number
    sb.rules.forEach((r, k) => { if (POINT_RULES.has(r.t)) sb.drawMeasure(r, k); });
    if (sb.measure?.p) { const P = pointOf(sb.loops, sb.measure.p); if (P) { const [x, y] = sb.toScreen(P); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 7, class: 'sk-corner-sel' })); if (sb.cursor) { const [cx, cy] = sb.toScreen(sb.cursor); sb.svg.append(svgEl('line', { x1: x, y1: y, x2: cx, y2: cy, class: 'sk-guide' })); } } }
    if (sb.current?.type === 'helper' && sb.cursor) { const [x1, y1] = sb.toScreen(sb.current.a), [x2, y2] = sb.toScreen(sb.cursor); sb.svg.append(svgEl('line', { x1, y1, x2, y2, class: 'sk-helper' })); }
    // what is being drawn right now, with its size
    const label = (text, [x, y]) => { const t = svgEl('text', { x: x + 12, y: y - 12, class: 'sk-dim' }); t.textContent = text; sb.svg.append(t); };
    if (sb.current && (sb.cursor || sb.current.pts?.length > 1)) {
      const c = sb.cursor || sb.current.pts[sb.current.pts.length - 1];
      if (sb.current.type === 'poly') {
        const pts = [sb.current.pts[0]];
        for (let i = 1; i < sb.current.pts.length; i++) pts.push(...SG.arcPoints(sb.current.pts[i - 1], sb.current.pts[i], sb.current.bulge[i - 1] || 0));
        const a = sb.current.pts[sb.current.pts.length - 1];
        if (sb.current.arcEnd) {
          const b = SG.bulgeFrom3(a, c, sb.current.arcEnd);
          pts.push(...SG.arcPoints(a, sb.current.arcEnd, b));
          label(`R ${fmtN(SG.arcRadius(a, sb.current.arcEnd, b))} mm`, sb.toScreen(c));
        } else { pts.push(c); if (sb.cursor) label(`${fmtN(Math.hypot(c[0] - a[0], c[1] - a[1]))} mm`, sb.toScreen(c)); }
        sb.svg.append(svgEl('path', { d: sb.pathOf(pts, false), class: 'sk-draft' }));
        for (const p of sb.current.pts) { const [x, y] = sb.toScreen(p); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 3, class: 'sk-pt' })); }
        // where the line started: clicking it again closes the outline
        if (sb.current.pts.length >= 2) { const [sx, sy] = sb.toScreen(sb.current.pts[0]); sb.svg.append(svgEl('circle', { cx: sx, cy: sy, r: 8, class: 'sk-open-to' })); }
        if (sb.current.arcEnd) { const [x, y] = sb.toScreen(sb.current.arcEnd); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 3.5, class: 'sk-cursor' })); }
      } else if (sb.current.type === 'rect') {
        const a = sb.current.a; const [x1, y1] = sb.toScreen(a), [x2, y2] = sb.toScreen(c);
        sb.svg.append(svgEl('rect', { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), class: 'sk-draft' }));
        label(`${fmtN(Math.abs(c[0] - a[0]))} × ${fmtN(Math.abs(c[1] - a[1]))} mm`, sb.toScreen(c));
      } else if (sb.current.type === 'circle') {
        const [cx, cy] = sb.toScreen(sb.current.c); const rr = Math.hypot(c[0] - sb.current.c[0], c[1] - sb.current.c[1]);
        sb.svg.append(svgEl('circle', { cx, cy, r: rr * sb.view.s, class: 'sk-draft' }));
        label(`⌀ ${fmtN(rr * 2)} mm`, sb.toScreen(c));
      }
    }
    sb.drawMore(label); // Slot, Polygon, Trim
    // live mirror: the mirror line stands out, and what is being drawn shows its mirror image too
    if (sb.liveMirror != null) {
      const [ax0, ay0] = sb.toScreen([0, 0]);
      sb.svg.append(sb.liveMirror === 0 ? svgEl('line', { x1: ax0, y1: 0, x2: ax0, y2: r.height, class: 'sk-mirror-axis' }) : svgEl('line', { x1: 0, y1: ay0, x2: r.width, y2: ay0, class: 'sk-mirror-axis x' }));
      const tf = sb.liveMirror === 0 ? `matrix(-1,0,0,1,${2 * ax0},0)` : `matrix(1,0,0,-1,0,${2 * ay0})`;
      for (const el of [...sb.svg.querySelectorAll('.sk-draft')]) { const c2 = el.cloneNode(true); c2.setAttribute('transform', tf); c2.classList.add('mirror'); sb.svg.append(c2); }
    }
    // snap feedback: dotted line-up guides and a marker saying what it snapped to
    if (sb.cursor && sb.tool !== 'select' && sb.snapInfo) {
      const [x, y] = sb.toScreen(sb.cursor);
      if (sb.snapInfo.kind === 'guide') for (const gp of sb.snapInfo.guides) { const [gx, gy] = sb.toScreen(gp); sb.svg.append(svgEl('line', { x1: gx, y1: gy, x2: x, y2: y, class: 'sk-guide' })); }
      if (sb.snapInfo.kind === 'guide' && sb.snapInfo.from) { const [fx, fy] = sb.toScreen(sb.snapInfo.from); sb.svg.append(svgEl('line', { x1: fx, y1: fy, x2: x, y2: y, class: 'sk-guide' })); }
      else {
        const word = { end: 'Loose end: joins here (pull back to place it nearby)', free: 'Free: no snapping (Ctrl)', corner: 'Corner', middle: 'Middle', center: 'Center', edge: 'On line', angle: 'Straight / 45°', level: 'Level: stays level', upright: 'Upright: stays upright' }[sb.snapInfo.kind];
        if (['angle', 'level', 'upright'].includes(sb.snapInfo.kind) && sb.snapInfo.from) { const [fx, fy] = sb.toScreen(sb.snapInfo.from); sb.svg.append(svgEl('line', { x1: fx, y1: fy, x2: x, y2: y, class: 'sk-guide' })); }
        sb.svg.append(svgEl('rect', { x: x - 6, y: y - 6, width: 12, height: 12, class: 'sk-snap ' + sb.snapInfo.kind }));
        if (word && (!sb.current || ['angle', 'edge', 'end', 'free', 'level', 'upright'].includes(sb.snapInfo.kind))) { const t = svgEl('text', { x: x + 10, y: y + 18, class: 'sk-snap-t' }); t.textContent = word; sb.svg.append(t); }
      }
    }
    if (sb.cursor && sb.tool !== 'select') { const [x, y] = sb.toScreen(sb.cursor); sb.svg.append(svgEl('circle', { cx: x, cy: y, r: 3.5, class: 'sk-cursor' })); }
    for (const b of sb.bar.querySelectorAll('.sk-tool')) b.classList.toggle('on', b.dataset.tool === sb.tool);
    { const ds = sb.bar.querySelector('.sk-delseg'), can = !sb.current && !!sb.selEdge && sb.hasSides(sb.loops[sb.selEdge.l]);
      ds.disabled = !can; const n = can ? sb.pickedSidesOf(sb.selEdge).length : 1; ds.querySelector('span').textContent = n > 1 ? `Delete ${n} segments` : 'Delete segment'; }
    const tips = {
      line: sb.current ? 'Click the next point · click the ringed start or an orange end to close / join (Alt: reach it from further) · Enter or Esc: stop here (the line stays) · Shift: straight or 45° · type a length + Enter · A: arc'
        : 'Click to start a line · click an orange end to carry on an unfinished line (hold Alt to reach it from further) · Ctrl: no snapping',
      arc: sb.current ? (sb.current.arcEnd ? 'Click a point the arc bends through' : 'Click where the arc ends (the ringed start or an orange end closes / joins) · Enter or Esc: stop here · L: straight lines')
        : 'Click to start · click an orange end to carry on an unfinished line (hold Alt to reach it from further) · Ctrl: no snapping',
      rect: sb.current ? 'Click the other corner · or type width,height + Enter' : 'Click the first corner',
      circle: sb.current ? 'Click the edge · or type the diameter + Enter' : 'Click the center',
      slot: !sb.current ? 'Click the center of one round end' : !sb.current.b ? 'Click the center of the other end · or type the length (center to center) + Enter, or length,width' : 'Click how wide it is · or type the width + Enter',
      polygon: sb.current ? `Click a corner (${sb.polySides()} sides, turns in 15° steps) · or type the size across flats + Enter` : `Click the center (${sb.polySides()} sides: change it on the right)`,
      trim: 'Click a piece of a line to take it out, up to the lines that cross it (it turns red) · Ctrl+Z puts it back',
      helper: sb.current ? 'Click the other end of the helper line · hold Shift: straight or 45°' : 'Click where the helper line starts (it is only a guide: it never becomes solid)',
      measure: sb.measure ? 'Now click the second point' : 'Click the first point: a corner, a circle center, a helper line end or the center of the sketch',
      select: sb.pickFor ? 'Click the other line' : 'Click a side, corner or shape to pick it · click a size to change it · drag points or helper lines to move them (Shift: straight) · drag a ◆ to bend a side',
    };
    if (sb.ruleWait) tips.select = (sb.evalRule(sb.ruleWait, sb.picks, true).need || '') + ` (${RULE_BTNS.find((x) => x[0] === sb.ruleWait)[1]})`;
    for (const b of sb.rbar.querySelectorAll('.sk-rb')) {
      const k = b.dataset.rule; b.classList.toggle('on', sb.ruleWait === k);
      b.classList.toggle('off', !sb.ruleWait && sb.picks.length > 0 && !!sb.evalRule(k, sb.picks, false).bad);
    }
    const nOpen = sb.loops.filter((l) => l.type === 'open').length;
    if (nOpen) {
      sb.status.hidden = false; sb.status.className = 'sk-status open';
      sb.status.textContent = `${nOpen} unfinished line${nOpen === 1 ? '' : 's'}: join the orange ends to close ${nOpen === 1 ? 'it' : 'them'}`;
      sb.status.title = 'An outline becomes solid once it is closed. Carry on from an orange end with Line or Arc, and click the other orange end (or the end of another line) to join them. Unfinished lines can stay while you work.';
    } else if (sb.lockInfo && sb.loops.some((l) => l.type !== 'line')) {
      sb.status.hidden = false; sb.status.className = 'sk-status' + (sb.lockInfo.free ? '' : ' done');
      sb.status.textContent = sb.lockInfo.free ? `Not fully locked: ${sb.lockInfo.free} more size${sb.lockInfo.free === 1 ? '' : 's'} or rule${sb.lockInfo.free === 1 ? '' : 's'} to go` : '✓ Fully locked';
      sb.status.title = sb.lockInfo.free ? 'Green lines are locked: nothing can change them by accident. Blue lines can still change when you drag or change something. Add sizes or rules until everything is green (you don\'t have to: it is just a help).' : 'Every line is held by sizes and rules: nothing can change by accident.';
    } else sb.status.hidden = true;
    sb.hint.replaceChildren(h('span', {}, tips[sb.tool]), ...(sb.typed ? [h('b', { class: 'sk-typed' }, sb.typed)] : []), h('span', { class: 'muted' }, ' · wheel zooms · right-drag slides · Esc stops'));
    sb.renderSide();
  };

  /** Small badges on the drawing, one for each rule (hover: what it is; click: remove or change it). */
  sb.drawBadges = function drawBadges() {
    const perSide = new Map();
    const outward = (l, i) => {
      const n = l.pts.length, A = l.pts[i], B = l.pts[(i + 1) % n], M = SG.arcMid(A, B, bulgeOf(l, i));
      const [ax, ay] = sb.toScreen(A), [bx, by] = sb.toScreen(B), [mx, my] = sb.toScreen(M);
      let nx = -(by - ay), ny = bx - ax; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      if (l.type === 'poly' && SG.insideLoop(l, [M[0] + (nx / sb.view.s) * 3, M[1] - (ny / sb.view.s) * 3])) { nx = -nx; ny = -ny; }
      return { mx, my, nx, ny, tx: ny, ty: -nx };
    };
    const badge = (k, x, y, text, extra = '') => {
      const r = sb.rules[k], g = svgEl('g', { class: 'sk-badge' + extra, transform: `translate(${x} ${y})` });
      const w = Math.max(18, 7 * [...text].length + 8);
      g.append(svgEl('rect', { x: -w / 2, y: -9, width: w, height: 18, rx: 5 }));
      const t = svgEl('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }); t.textContent = text; g.append(t);
      const tt = svgEl('title'); tt.textContent = sb.ruleLabel(r) + '\nClick to change or remove it.'; g.append(tt);
      g.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); sb.openBadge(k, x, y - 12); });
      sb.svg.append(g);
    };
    const onSide = (k, s, text) => {
      const l = sb.loops[s.l]; if (!l?.pts || !l.pts[s.i]) return;
      const key = `${s.l}:${s.i}`, idx = perSide.get(key) || 0; perSide.set(key, idx + 1);
      // inside the shape, next to the side (the size is shown on the outside); more badges line up along the side
      const o = outward(l, s.i), back = 16 + Math.floor(idx / 3) * 20, along = [0, 24, -24][idx % 3];
      badge(k, o.mx - o.nx * back + o.tx * along, o.my - o.ny * back + o.ty * along, text);
    };
    const atPoint = (k, P, text, dx = 12, dy = -12, extra = '') => { if (!P) return; const [x, y] = sb.toScreen(P); badge(k, x + dx, y + dy, text, extra); };
    const atCircle = (k, s, text) => { const l = sb.loops[s.l]; if (l?.type !== 'circle') return; const [x, y] = sb.toScreen([l.c[0] - l.r * 0.72, +l.c[1] + l.r * 0.72]); badge(k, x - 8, y - 8, text); };
    sb.rules.forEach((r, k) => {
      const mark = RULE_MARK[r.t];
      if (['flat', 'upright', 'parallel', 'square', 'equal'].includes(r.t)) { onSide(k, r.a, mark); if (r.b) onSide(k, r.b, mark); }
      else if (r.t === 'angle') { const s = r.b || r.a; onSide(k, s, `∠${fmtN(Math.round(sb.shownAngle(r) * 10) / 10)}°`); }
      else if (r.t === 'eqr' || r.t === 'tangent') for (const s of [r.a, r.b]) { if (isCircleRef(s)) atCircle(k, s, mark); else onSide(k, s, mark); }
      else if (r.t === 'smooth') atPoint(k, sb.loops[r.a.l]?.pts?.[r.a.i], mark, 12, -12);
      else if (r.t === 'pin') atPoint(k, pointOf(sb.loops, r.p), '📌', 12, -12);
      else if (r.t === 'anchor') atPoint(k, pointOf(sb.loops, r.p), '⚓', -13, 13, r.off ? ' off' : ' anchor');
      else if (r.t === 'sym') { const P = pointOf(sb.loops, r.p), Q = pointOf(sb.loops, r.q); if (P && Q) atPoint(k, [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2], mark, 0, -12); }
      else if (r.t === 'freeze') { const l = sb.loops[r.a.l]; if (l) { const b = SG.loopsBounds([l]); atPoint(k, [b[0], b[3]], mark, -10, -10); } }
    });
  };
  /** One measurement between two points, drawn like on a drawing: extension lines, a line with arrows, the number. */
  sb.drawMeasure = function drawMeasure(r, k) {
    const P = pointOf(sb.loops, r.p), Q = pointOf(sb.loops, r.q); if (!P || !Q) return;
    const [px, py] = sb.toScreen(P), [qx, qy] = sb.toScreen(Q), g = svgEl('g', { class: 'sk-meas' + (r.ref ? ' ref' : '') });
    let a, b; // the two ends of the dimension line, on screen
    if (r.t === 'dx') { const y = Math.min(py, qy) - 22 - (k % 3) * 6; a = [px, y]; b = [qx, y]; g.append(svgEl('line', { x1: px, y1: py, x2: px, y2: y - 4 }), svgEl('line', { x1: qx, y1: qy, x2: qx, y2: y - 4 })); }
    else if (r.t === 'dy') { const x = Math.max(px, qx) + 22 + (k % 3) * 6; a = [x, py]; b = [x, qy]; g.append(svgEl('line', { x1: px, y1: py, x2: x + 4, y2: py }), svgEl('line', { x1: qx, y1: qy, x2: x + 4, y2: qy })); }
    else { const d = [qx - px, qy - py], L = Math.hypot(...d) || 1, nrm = [-d[1] / L * 16, d[0] / L * 16]; a = [px + nrm[0], py + nrm[1]]; b = [qx + nrm[0], qy + nrm[1]]; g.append(svgEl('line', { x1: px, y1: py, x2: a[0], y2: a[1] }), svgEl('line', { x1: qx, y1: qy, x2: b[0], y2: b[1] })); }
    g.append(svgEl('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'main' }));
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (const [e, s2] of [[a, 1], [b, -1]]) { const t1 = ang + s2 * 0.4, t2 = ang - s2 * 0.4, d = 7 * s2; g.append(svgEl('path', { d: `M${e[0]} ${e[1]} L${e[0] + Math.cos(t1) * d} ${e[1] + Math.sin(t1) * d} M${e[0]} ${e[1]} L${e[0] + Math.cos(t2) * d} ${e[1] + Math.sin(t2) * d}` })); }
    sb.svg.append(g);
    sb.dimLabel(`${RULE_MARK[r.t]} ${fmtN(Math.abs(r.v))}`, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - (r.t === 'dy' ? 0 : 8), (v) => { if (v < 0 || (r.t === 'dist' && !(v > 0))) return; r.v = (Math.sign(r.v) || 1) * v; delete r.ref; sb.settle(new Set()); }, r.ref ? false : 'meas');
  };
  // a clickable size on the drawing: click it, type a new number, Enter
  sb.dimLabel = function dimLabel(text, x, y, apply, locked) {
    const t = svgEl('text', { x, y, class: 'sk-len' + (locked ? ' locked' : ''), 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
    t.textContent = text + (locked === true ? ' 🔒' : '');
    t.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); sb.askNumber(x, y, parseFloat(text.replace(/[^0-9.\-]/g, '')), apply); });
    sb.svg.append(t);
  };
  sb.askNumber = function askNumber(x, y, v0, apply, always) {
    sb.canvas.querySelector('.sk-ask')?.remove();
    const inp = h('input', { class: 'in sk-ask', value: fmtN(v0), style: `left:${x}px;top:${y}px` });
    sb.canvas.append(inp);
    let finished = false;
    const done = (ok) => {
      if (finished) return; finished = true;
      const v = parseFloat(inp.value); inp.remove();
      if (ok && Number.isFinite(v) && (always || Math.abs(v - v0) > 1e-9)) { sb.remember(); apply(v); }
      sb.draw();
    };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
    setTimeout(() => { inp.focus(); inp.select(); }, 0);
  };
}

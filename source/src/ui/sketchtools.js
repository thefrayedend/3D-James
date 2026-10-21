// Sketch board: the drawing tools (Line, Arc, Rectangle, Circle, Helper line) and what a click does with each.
// (Slot, Polygon and Trim: sketchmore.js.)
// Installed on the board object `sb` by openSketch (sketch.js); everything shared lives on sb.
import * as SG from '../sketchgeom.js';
import { toast } from './dom.js';
import { EPS, r3, samePt } from './sketchkit.js';

export function installTools(sb) {

  // ---- tools
  sb.setTool = function setTool(k) {
    const keep = sb.current?.type === 'poly' && ['line', 'arc'].includes(k) && ['line', 'arc'].includes(sb.tool);
    if (!keep && sb.current?.type === 'poly') sb.commitCurrent(); // the line drawn so far stays (open)
    sb.tool = k; sb.typed = ''; sb.measure = null; sb.trimHover = null; sb.canvas.querySelector('.sk-mchoose')?.remove();
    if (keep) sb.current.arcEnd = null; else sb.current = null;
    if (k !== 'select') { sb.selCorner = null; sb.picks = []; sb.ruleWait = null; }
    sb.draw();
  };
  /**
   * The line being drawn becomes part of the drawing. It stays an unfinished (open) line unless its ends meet: then it
   * closes into an outline, or joins up with the unfinished line it ends on. Returns false when there was no line yet.
   */
  sb.commitCurrent = function commitCurrent() {
    const c = sb.current; sb.current = null; sb.typed = '';
    if (c?.type !== 'poly' || c.pts.length < 2) return false;
    sb.remember();
    const bulge = c.pts.map((_, i) => (i < c.pts.length - 1 ? Math.round((+c.bulge[i] || 0) * 1e6) / 1e6 : 0));
    const l = { type: 'open', pts: c.pts };
    if (bulge.some((x) => Math.abs(x) > EPS)) l.bulge = bulge;
    if (sb.owners) l.owner = sb.newOwner;
    sb.loops.push(l);
    sb.levelRules(sb.loops.length - 1);
    sb.sel = sb.joinEnds(sb.loops.length - 1);
    sb.autoMirror();
    return true;
  };
  /** Close the line being drawn by going back to where it started (bClose: how that last side bends). */
  sb.closeLoop = function closeLoop(bClose = 0) {
    const c = sb.current;
    if (c?.type !== 'poly') return;
    if (!(c.pts.length >= 3 || (c.pts.length === 2 && (bClose || c.bulge[0])))) { toast('An outline needs at least 3 points (or 2 with an arc).'); return; }
    c.bulge[c.pts.length - 1] = bClose; c.pts.push([c.pts[0][0], c.pts[0][1]]);
    sb.commitCurrent(); sb.draw();
  };
  /** Close unfinished lines by joining each one's two ends with a straight side. Returns how many closed. */
  sb.closeWithLines = function closeWithLines(idx) {
    let n = 0;
    for (const li of idx) {
      const l = sb.loops[li]; if (l?.type !== 'open') continue;
      l.pts.push([l.pts[0][0], l.pts[0][1]]); if (l.bulge) l.bulge.push(0); if (l.round) l.round.push(0);
      if (sb.closeOpen(li)) n++; else { l.pts.pop(); l.bulge?.pop(); l.round?.pop(); }
    }
    if (n < idx.length) toast('A single straight line can’t be closed into an outline. Draw more of it, or delete it.', 'info', 4500);
    return n;
  };
  sb.addPoint = function addPoint(p, b = 0) {
    if (!sb.current) { sb.current = { type: 'poly', pts: [p], bulge: [] }; return; }
    const first = sb.current.pts[0], last = sb.current.pts[sb.current.pts.length - 1];
    if (samePt(p, last)) return;
    if (samePt(p, first)) {
      if (sb.current.pts.length >= 3 || (sb.current.pts.length >= 2 && b)) sb.closeLoop(b);
      else toast('An outline needs at least 3 points (or 2 with an arc).');
      return;
    }
    sb.current.bulge[sb.current.pts.length - 1] = b;
    sb.current.pts.push(p);
    // ended on the loose end of an unfinished line: they join up here
    if (sb.isOpenEnd(p)) sb.commitCurrent();
  };
  sb.arcClick = function arcClick(p) {
    if (!sb.current) { sb.addPoint(p); return; }
    if (!sb.current.arcEnd) {
      const last = sb.current.pts[sb.current.pts.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 1e-6) return;
      sb.current.arcEnd = p; return;
    }
    const a = sb.current.pts[sb.current.pts.length - 1], e = sb.current.arcEnd;
    const b = SG.bulgeFrom3(a, p, e);
    sb.current.arcEnd = null;
    if (!b) { sb.addPoint(e, 0); return; }
    sb.addPoint(e, b);
  };
  sb.finishRect = function finishRect(a, b) {
    if (Math.abs(b[0] - a[0]) < 1e-6 || Math.abs(b[1] - a[1]) < 1e-6) return;
    sb.remember(); sb.loops.push({ type: 'poly', pts: [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]].map((p) => p.map(r3)), ...(sb.owners ? { owner: sb.newOwner } : {}) }); sb.sel = sb.loops.length - 1; sb.current = null;
    sb.levelRules(sb.sel); // it stays a rectangle: two sides flat, two upright
    sb.autoMirror();
  };
  /**
   * Level & upright (under Snap to): straight sides of loop li drawn exactly level get a Flat rule, exactly straight up
   * and down an Upright rule, so they stay that way when you change the drawing later.
   */
  sb.levelRules = function levelRules(li) {
    if (!sb.snaps().level) return;
    const l = sb.loops[li];
    for (let i = 0; i < SG.sideCount(l); i++) {
      if (Math.abs(+(l.bulge?.[i] || 0)) > EPS) continue;
      const A = l.pts[i], B = l.pts[(i + 1) % l.pts.length], dx = Math.abs(B[0] - A[0]), dy = Math.abs(B[1] - A[1]);
      const t = dy < 1e-9 && dx > 1e-6 ? 'flat' : dx < 1e-9 && dy > 1e-6 ? 'upright' : null;
      if (t && !sb.rules.some((r) => (r.t === 'flat' || r.t === 'upright') && r.a?.l === li && r.a?.i === i)) sb.rules.push({ t, a: { l: li, i } });
    }
  };
  sb.finishCircle = function finishCircle(c, r) { if (r <= 0) return; sb.remember(); sb.loops.push({ type: 'circle', c: c.map(r3), r: r3(r) }); sb.sel = sb.loops.length - 1; sb.current = null; sb.autoMirror(); };
  /** Live mirror on: what was just drawn gets its mirror image (a half outline ending on the line becomes whole). */
  sb.autoMirror = function autoMirror() { if (sb.liveMirror != null && sb.sel != null) sb.mirror(sb.liveMirror, true); };
  sb.applyTyped = function applyTyped() {
    const parts = sb.typed.split(/[,;x×]/).map((s) => parseFloat(s)).filter((n) => Number.isFinite(n));
    sb.typed = '';
    if (!parts.length) return sb.draw();
    if ((sb.tool === 'line' || sb.tool === 'arc') && sb.current?.type === 'poly' && !sb.current.arcEnd) {
      const a = sb.current.pts[sb.current.pts.length - 1];
      let p;
      if (parts.length >= 2) p = [r3(a[0] + parts[0]), r3(a[1] + parts[1])];
      else { const c = sb.cursor || [a[0] + 1, a[1]]; const L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1; p = [r3(a[0] + ((c[0] - a[0]) / L) * parts[0]), r3(a[1] + ((c[1] - a[1]) / L) * parts[0])]; }
      if (sb.tool === 'arc') sb.current.arcEnd = p; else sb.addPoint(p);
    } else if (sb.tool === 'rect' && sb.current?.type === 'rect') {
      const a = sb.current.a, c = sb.cursor || [a[0] + 1, a[1] + 1];
      const w = parts[0], hh = parts.length > 1 ? parts[1] : parts[0];
      sb.finishRect(a, [a[0] + Math.sign(c[0] - a[0] || 1) * w, a[1] + Math.sign(c[1] - a[1] || 1) * hh]);
    } else if (sb.tool === 'circle' && sb.current?.type === 'circle') sb.finishCircle(sb.current.c, parts[0] / 2);
    else sb.typedMore(parts);
    sb.draw();
  };
  sb.delSel = function delSel() {
    if (sb.current) return;
    if (sb.selCorner) return sb.deletePoint(sb.selCorner.l, sb.selCorner.i);
    if (sb.selEdge && sb.hasSides(sb.loops[sb.selEdge.l])) return sb.deleteSides(sb.selEdge.l, sb.pickedSidesOf(sb.selEdge));
    if (sb.sel == null) return toast('Pick a shape first (Select tool).');
    sb.remember(); sb.removeLoop(sb.sel); sb.sel = null; sb.selEdge = null; sb.draw();
  };
  /**
   * Merge touching outlines: outlines that touch or overlap become one outline (arcs stay arcs; holes stay holes).
   * Works on the picked shapes when two or more are picked (Shift+click), otherwise on every outline.
   * Outlines that don't touch anything are left exactly as they are (with their rules).
   */
  sb.merging = false;
  sb.mergeTouching = async function mergeTouching() {
    if (sb.merging || sb.current) return;
    const pickedLoops = [...new Set(sb.picks.filter((p) => p.shape || p.circle).map((p) => p.l))].filter((i) => SG.isSolidLoop(sb.loops[i]));
    const idx = pickedLoops.length >= 2 ? pickedLoops : sb.loops.map((l, i) => [l, i]).filter(([l]) => SG.isSolidLoop(l)).map(([, i]) => i);
    if (idx.length < 2) return toast('Draw (or pick) at least two outlines that touch or overlap.');
    if (idx.some((i) => sb.isFrozen(i))) return toast('A frozen shape can\'t be merged. Unfreeze it first.', 'info', 3500);
    sb.merging = true;
    let res;
    try {
      const { workerCall } = await import('../build.js');
      const strip = (l) => { const c = JSON.parse(JSON.stringify(l)); delete c.owner; return c; };
      res = (await workerCall({ type: 'unionLoops', loops: idx.map((i) => strip(sb.loops[i])) })).loops || [];
    } catch (err) { sb.merging = false; return toast('Could not merge: ' + (err?.message || err), 'err', 5000); }
    sb.merging = false;
    if (!sb.root.isConnected) return;
    // an outline that comes back unchanged was not touching anything: keep the original (and its rules)
    const key = (l) => (l.type === 'circle' ? `c${r3(l.c[0])},${r3(l.c[1])},${r3(l.r)}` : 'p' + l.pts.map((q) => `${r3(q[0])},${r3(q[1])}`).sort().join(';'));
    const inKeys = new Map(idx.map((i) => [key(sb.loops[i]), i]));
    const keep = new Set(), added = [];
    for (const l of res) { const k = inKeys.get(key(l)); if (k != null && !keep.has(k)) keep.add(k); else added.push(l); }
    const gone = idx.filter((i) => !keep.has(i));
    if (!added.length && !gone.length) return toast('None of these outlines touch or overlap, so there is nothing to merge.', 'info', 3500);
    sb.remember();
    // which sketch a merged outline belongs to: the biggest outline it was made from (holes go with their outline)
    const probe = (l) => (l.type === 'circle' ? [+l.c[0] + l.r * 0.999, +l.c[1]] : SG.flattenLoop(l)[0]);
    const ownerOf = (nl) => {
      const from = gone.filter((i) => { const P = probe(sb.loops[i]); return SG.insideLoop(nl, P) || nl.type !== 'circle' && SG.flattenLoop(nl).some((q) => Math.hypot(q[0] - P[0], q[1] - P[1]) < 1e-3); });
      const best = (from.length ? from : gone).slice().sort((a, b) => SG.loopArea(sb.loops[b]) - SG.loopArea(sb.loops[a]))[0];
      return sb.loops[best]?.owner;
    };
    const owners2 = added.map(ownerOf);
    for (const i of gone.slice().sort((a, b) => b - a)) { sb.dropLoopRules(i); sb.loops.splice(i, 1); }
    added.forEach((l, k) => { if (sb.owners) l.owner = owners2[k] ?? sb.newOwner; sb.loops.push(l); });
    if (sb.owners) {
      // a hole goes with the outline it sits in (so a hole left untouched follows its merged outline)
      const outlines = sb.loops.filter(SG.isSolidLoop);
      for (const l of outlines) {
        const outer = outlines.filter((o) => o !== l && SG.loopArea(o) > SG.loopArea(l) && SG.loopInside(o, l)).sort((a, b) => SG.loopArea(a) - SG.loopArea(b))[0];
        if (outer && added.includes(outer)) l.owner = outer.owner;
      }
    }
    sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.picks = [];
    toast(`Merged ${gone.length} outlines into ${added.length}.`, 'info', 3000);
    sb.draw();
  };
  /** The Delete segment button in the top bar. */
  sb.delSegment = function delSegment() {
    if (sb.current) return;
    if (!sb.selEdge || !sb.hasSides(sb.loops[sb.selEdge.l])) return toast('Pick a side of an outline first (Select tool, click the side). Shift+click more sides next to it for a longer piece.', 'info', 3500);
    sb.deleteSides(sb.selEdge.l, sb.pickedSidesOf(sb.selEdge));
  };
  /** The picked side plus any other sides of the same outline picked with Shift. */
  sb.pickedSidesOf = function pickedSidesOf(e) { return [...new Set([e.i, ...sb.picks.filter((p) => sb.pickIs.side(p) && p.l === e.l).map((p) => p.i)])]; };
  sb.undo = function undo() {
    // while drawing a line, Undo takes back its last point
    if (sb.current?.auto && sb.current.pts.length === 1) sb.current = null; // nothing drawn yet from the open end: undo what came before
    if (sb.current) { if (sb.current.arcEnd) sb.current.arcEnd = null; else if (sb.current.pts?.length > 1) { sb.current.pts.pop(); sb.current.bulge.length = sb.current.pts.length - 1; } else sb.current = null; sb.draw(); return; }
    const st = sb.undoStack.pop(); if (st) { ({ loops: sb.loops, rules: sb.rules, photo: sb.photo = null } = JSON.parse(st)); sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.draw(); }
  };
  sb.click = function click(q) {
    if (sb.tool === 'helper') {
      if (!sb.current) sb.current = { type: 'helper', a: q, snapA: sb.snapInfo ? { ...sb.snapInfo } : null };
      else if (Math.hypot(q[0] - sb.current.a[0], q[1] - sb.current.a[1]) > 1e-6) {
        sb.remember(); sb.loops.push({ type: 'line', pts: [sb.current.a, q] });
        const li = sb.loops.length - 1; sb.attach(li, 0, sb.current.snapA); sb.attach(li, 1, sb.snapInfo); sb.levelRules(li);
        sb.sel = li; sb.current = null; sb.settle(new Set());
      }
    } else if (sb.clickMore(q)) { /* Slot, Polygon */ } else if (sb.tool === 'line') sb.addPoint(q);
    else if (sb.tool === 'arc') sb.arcClick(q);
    else if (sb.tool === 'rect') { if (!sb.current) sb.current = { type: 'rect', a: q }; else sb.finishRect(sb.current.a, q); }
    else if (sb.tool === 'circle') { if (!sb.current) sb.current = { type: 'circle', c: q }; else sb.finishCircle(sb.current.c, Math.hypot(q[0] - sb.current.c[0], q[1] - sb.current.c[1])); }
    sb.draw();
  };

  /** Moving a whole helper line: an end close to a corner/middle/center lands on it; lying close to and in line
   *  with another straight line, it latches onto that line; otherwise it goes exactly where you put it. */
  sb.latchLine = function latchLine(li, A0, B0, d) {
    const tol = 9 / sb.view.s;
    const T = sb.targets(null, li);
    let best = null, bd = tol; sb.latched = null;
    [A0, B0].forEach((E0, end) => {
      const E = [E0[0] + d[0], E0[1] + d[1]];
      for (const t of T) { const dist = Math.hypot(t.p[0] - E[0], t.p[1] - E[1]); if (dist < bd) { bd = dist; best = [t.p[0] - E0[0], t.p[1] - E0[1]]; sb.snapInfo = { kind: t.kind, at: t.p }; sb.latched = { end, info: { kind: t.kind, ref: t.ref, side: t.side, pinAt: t.pinAt } }; } }
    });
    if (best) return best;
    const u = [B0[0] - A0[0], B0[1] - A0[1]], ul = Math.hypot(...u) || 1; u[0] /= ul; u[1] /= ul;
    const nrm = [-u[1], u[0]], M = [(A0[0] + B0[0]) / 2 + d[0], (A0[1] + B0[1]) / 2 + d[1]];
    let shift = null, sd = tol;
    let lineRef = null;
    for (const [P, Q, straight, pref] of sb.pieces(li)) {
      if (!straight) continue;
      const v = [Q[0] - P[0], Q[1] - P[1]], vl = Math.hypot(...v) || 1;
      if (Math.abs((u[0] * v[1] - u[1] * v[0]) / vl) > 0.02) continue; // not in line with it
      const off = (P[0] - M[0]) * nrm[0] + (P[1] - M[1]) * nrm[1]; // how far apart, across the lines
      if (Math.abs(off) < sd) { sd = Math.abs(off); shift = off; lineRef = pref; }
    }
    sb.snapInfo = null;
    if (shift != null) { sb.snapInfo = { kind: 'edge', at: M }; sb.latched = lineRef ? { line: lineRef } : null; return [d[0] + nrm[0] * shift, d[1] + nrm[1] * shift]; }
    return d;
  };
  /** Where the line being drawn starts (Shift keeps the new point straight or at 45° from it). */
  sb.drawOpts = function drawOpts(e) {
    // Line and Arc points go onto loose ends close by (not the point an arc bends through)
    const o = { shift: !!e?.shiftKey, alt: !!e?.altKey, free: !!(e?.ctrlKey || e?.metaKey), ends: (sb.tool === 'line' || sb.tool === 'arc') && !sb.current?.arcEnd };
    if ((sb.tool === 'line' || sb.tool === 'arc') && sb.current?.type === 'poly' && !sb.current.arcEnd) o.anchor = sb.current.pts[sb.current.pts.length - 1];
    else if (sb.tool === 'arc' && sb.current?.arcEnd) o.anchor = null; // the bend point goes anywhere
    else if (sb.tool === 'helper' && sb.current) o.anchor = sb.current.a;
    else if (sb.tool === 'rect' && sb.current) { o.anchor = sb.current.a; o.diagonal = true; } // Shift: a square
    else if (sb.tool === 'slot' && sb.current && !sb.current.b) o.anchor = sb.current.a;
    return o;
  };
}

// Sketch board: mouse, fingers, pen and keyboard.
// Installed on the board object `sb` by openSketch (sketch.js); everything shared lives on sb.
import { ORIGIN } from '../sketchsolve.js';
import * as SG from '../sketchgeom.js';
import { toast } from './dom.js';
import { r3 } from './sketchkit.js';
import { mods, palm, fat } from '../touch.js';

export function installInput(sb) {
  // ---- mouse
  sb.panning = null; sb.press = null; sb.latched = null;
  sb.fat = 1; // pick distances (on screen) grow for a finger
  sb.screenDist = (p, e) => { const [x, y] = sb.toScreen(p), r = sb.rect(); return Math.hypot(x + r.left - e.clientX, y + r.top - e.clientY); };
  /** A circle whose outline is under the mouse. */
  sb.circleAt = function circleAt(e) {
    const r = sb.rect(), px = e.clientX - r.left, py = e.clientY - r.top; let best = null, bd = 7 * sb.fat;
    sb.loops.forEach((l, li) => { if (l.type !== 'circle') return; const [cx, cy] = sb.toScreen(l.c); const d = Math.abs(Math.hypot(px - cx, py - cy) - l.r * sb.view.s); if (d < bd) { bd = d; best = li; } });
    return best;
  };
  /** Clicking a circle's center: the circle itself, unless the rule being made wants points. */
  sb.centerPick = function centerPick(li) {
    const wantsPoints = ['join', 'sym', 'flat', 'upright'].includes(sb.ruleWait) || (sb.ruleWait === 'size' && sb.picks.some(sb.pickIs.pt)) || sb.picks.some(sb.pickIs.pt);
    return wantsPoints ? { pt: 1, l: li, k: 0 } : { l: li, circle: 1 };
  };
  sb.sideAt = function sideAt(e) {
    const r = sb.rect(); let best = null, bd = 7 * sb.fat;
    sb.loops.forEach((l, li) => {
      if (l.type === 'circle') return;
      const n = l.pts.length;
      for (let i = 0; i < SG.sideCount(l); i++) {
        const A = l.pts[i], pts = [A, ...SG.arcPoints(A, l.pts[(i + 1) % n], +(l.bulge?.[i] || 0))];
        for (let k = 0; k + 1 < pts.length; k++) {
          const [ax, ay] = sb.toScreen(pts[k]), [bx, by] = sb.toScreen(pts[k + 1]);
          const px = e.clientX - r.left, py = e.clientY - r.top, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
          const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
          if (d < bd) { bd = d; best = { l: li, i }; }
        }
      }
    });
    return best;
  };
  sb.svg.addEventListener('contextmenu', (e) => e.preventDefault());
  const onDown = (e) => {
    if (sb.photoMode && e.button === 0 && sb.photoDown(sb.toMm(e.clientX, e.clientY))) return; // moving or sizing the photo
    if (e.button === 2 || e.button === 1) { sb.panning = { x: e.clientX, y: e.clientY, ox: sb.view.ox, oy: sb.view.oy }; return; }
    const raw = sb.toMm(e.clientX, e.clientY);
    if (sb.tool === 'select') {
      sb.canvas.querySelector('.sk-mchoose')?.remove();
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      // the picked shape's bend diamonds first
      if (sb.sel != null && sb.hasSides(sb.loops[sb.sel]) && !sb.ruleWait && !additive) {
        const l = sb.loops[sb.sel];
        for (let i = 0; i < SG.sideCount(l); i++) if (sb.screenDist(sb.sideMid(l, i), e) < 7 * sb.fat) { sb.remember(); sb.press = { bend: { l: sb.sel, i }, x: e.clientX, y: e.clientY }; return; }
      }
      // grab a point of any shape (picked shape first)
      const order = sb.sel != null ? [sb.sel, ...sb.loops.keys()] : [...sb.loops.keys()];
      for (const i of order) {
        const l = sb.loops[i]; const pts = l.type === 'circle' ? [l.c] : l.pts;
        for (let k = 0; k < pts.length; k++) if (sb.screenDist(pts[k], e) < 8 * sb.fat) { sb.press = { point: pts[k], l: i, k, circle: l.type === 'circle', additive, frozen: sb.isFrozen(i), x: e.clientX, y: e.clientY, saved: JSON.stringify({ loops: sb.loops, rules: sb.rules }) }; return; }
      }
      if (sb.screenDist(ORIGIN, e) < 8 * sb.fat && (sb.ruleWait || additive)) { sb.addPick({ pt: 1, o: 1 }, additive); sb.draw(); return; }
      const best = sb.sideAt(e);
      if (best && sb.pickFor && sb.selEdge) { const op = sb.pickFor; sb.pickFor = null; sb.lineOp(op, best); return; }
      if (best && sb.loops[best.l].type === 'line' && !sb.ruleWait && !additive && !sb.isFrozen(best.l)) {
        // a helper line: click picks it, dragging moves the whole line
        const l = sb.loops[best.l];
        sb.press = { lineDrag: best, start: raw, orig: l.pts.map((q) => [q[0], q[1]]), x: e.clientX, y: e.clientY, saved: JSON.stringify({ loops: sb.loops, rules: sb.rules }) };
        return;
      }
      sb.pickFor = null;
      if (best) { sb.selEdge = best; sb.selCorner = null; sb.sel = best.l; sb.addPick({ l: best.l, i: best.i }, additive); sb.draw(); return; }
      const circ = sb.circleAt(e);
      if (circ != null) { sb.sel = circ; sb.selEdge = null; sb.selCorner = null; sb.addPick({ l: circ, circle: 1 }, additive); sb.draw(); return; }
      sb.selEdge = null; sb.selCorner = null; sb.sel = null;
      for (let i = sb.loops.length - 1; i >= 0; i--) if (SG.insideLoop(sb.loops[i], raw)) { sb.sel = i; break; }
      if (sb.sel != null) sb.addPick(sb.loops[sb.sel].type === 'circle' ? { l: sb.sel, circle: 1 } : { l: sb.sel, shape: 1 }, additive);
      else if (!sb.ruleWait && !additive) sb.picks = [];
      sb.draw(); return;
    }
    if (sb.tool === 'trim') { if (!sb.trimAt(raw)) toast('Click on a line: the part between the lines that cross it is taken out.', 'info', 2500); return; }
    if (sb.tool === 'measure') {
      const ref = sb.pointRefAt(e);
      if (!ref) { toast('Click a corner, a circle center, a helper line end, or the center of the sketch.', 'info', 2500); return; }
      if (!sb.measure) { sb.measure = { p: ref }; sb.canvas.querySelector('.sk-mchoose')?.remove(); sb.draw(); return; }
      if (sb.sameRef(sb.measure.p, ref)) return;
      const p = sb.measure.p; sb.measure = null; sb.draw(); sb.measureChoose(p, ref); return;
    }
    sb.click(sb.snap(raw, null, sb.drawOpts(e)));
  };
  const onMove = (e) => {
    if (sb.photoMove(sb.toMm(e.clientX, e.clientY))) return;
    if (sb.panning) { sb.view.ox = sb.panning.ox + e.clientX - sb.panning.x; sb.view.oy = sb.panning.oy + e.clientY - sb.panning.y; sb.draw(); return; }
    const raw = sb.toMm(e.clientX, e.clientY);
    if (sb.press?.bend) {
      const l = sb.loops[sb.press.bend.l], i = sb.press.bend.i, n = l.pts.length, A = l.pts[i], B = l.pts[(i + 1) % n];
      let b = SG.bulgeFromMid(A, B, raw);
      // close to straight: straight
      const c = Math.hypot(B[0] - A[0], B[1] - A[1]); if (Math.abs((b * c) / 2) * sb.view.s < 5) b = 0;
      sb.setBulge(l, i, Math.max(-1, Math.min(1, b)) === b ? b : Math.sign(b));
      sb.draw(); return;
    }
    if (sb.press?.lineDrag) {
      if (!sb.press.moving && Math.hypot(e.clientX - sb.press.x, e.clientY - sb.press.y) < 3 * sb.fat) return;
      if (!sb.press.moving) { sb.undoStack.push(sb.press.saved); sb.press.moving = true; sb.sel = sb.press.lineDrag.l; sb.selEdge = null; sb.selCorner = null; sb.dropAuto(sb.press.lineDrag.l); }
      const li = sb.press.lineDrag.l, l = sb.loops[li], [A0, B0] = sb.press.orig;
      let d = [raw[0] - sb.press.start[0], raw[1] - sb.press.start[1]];
      if (e.shiftKey) d = Math.abs(d[0]) > Math.abs(d[1]) ? [d[0], 0] : [0, d[1]]; // Shift: only straight across or up-down
      d = sb.latchLine(li, A0, B0, d);
      l.pts[0][0] = r3(A0[0] + d[0]); l.pts[0][1] = r3(A0[1] + d[1]); l.pts[1][0] = r3(B0[0] + d[0]); l.pts[1][1] = r3(B0[1] + d[1]);
      sb.settle(new Set(l.pts));
      sb.cursor = null; sb.draw(); return;
    }
    if (sb.press?.point) {
      if (!sb.drag && Math.hypot(e.clientX - sb.press.x, e.clientY - sb.press.y) < 3 * sb.fat) return;
      if (sb.press.additive || sb.ruleWait) return; // picking, not dragging
      if (sb.press.frozen) { if (!sb.press.told) { sb.press.told = true; toast('That shape is frozen. Click it and use Freeze again to unfreeze it.', 'info', 3000); } return; }
      if (!sb.drag) { sb.undoStack.push(sb.press.saved); sb.drag = sb.press.point; sb.sel = sb.press.l; sb.press.start = [sb.drag[0], sb.drag[1]]; if (sb.loops[sb.press.l]?.type === 'line') sb.dropAuto(sb.press.l, sb.press.k); }
      const p = sb.snap(raw, sb.drag, { shift: e.shiftKey, alt: e.altKey, free: e.ctrlKey || e.metaKey, ends: true, anchor: sb.press.start, dragging: true }); sb.drag[0] = p[0]; sb.drag[1] = p[1];
      sb.settle(new Set([sb.drag]));
      sb.cursor = null; sb.draw(); return;
    }
    if (sb.tool === 'trim') { sb.trimHover = sb.trimSpanAt(raw); sb.cursor = null; sb.draw(); return; }
    sb.lastMove = { raw, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    sb.cursor = sb.snap(raw, null, sb.drawOpts(e)); sb.draw();
  };
  const onUp = () => {
    if (sb.photoUp()) return;
    if (sb.press?.lineDrag && !sb.press.moving) { sb.selEdge = sb.press.lineDrag; sb.sel = sb.press.lineDrag.l; sb.selCorner = null; sb.draw(); }
    else if (sb.press?.lineDrag && sb.press.moving && sb.latched) {
      // dropped onto something: it stays attached (moving that thing later takes the helper line along)
      const li = sb.press.lineDrag.l;
      if (sb.latched.end != null) sb.attach(li, sb.latched.end, sb.latched.info);
      else if (sb.latched.line) { sb.attach(li, 0, { kind: 'edge', line: sb.latched.line }); sb.attach(li, 1, { kind: 'edge', line: sb.latched.line }); }
      sb.latched = null; sb.settle(new Set()); sb.draw();
    } else if (sb.press?.point && sb.drag && sb.loops[sb.press.l]?.type === 'line' && sb.snapInfo) { sb.attach(sb.press.l, sb.press.k, sb.snapInfo); sb.settle(new Set()); sb.draw(); }
    else if (sb.press?.point && sb.drag && sb.loops[sb.press.l]?.type === 'open') { sb.sel = sb.joinEnds(sb.press.l); sb.selCorner = null; sb.draw(); } // dropped on a loose end: joined
    else if (sb.press?.point && !sb.drag && !sb.press.circle) { sb.sel = sb.press.l; sb.selCorner = { l: sb.press.l, i: sb.press.k }; sb.selEdge = null; sb.addPick({ pt: 1, l: sb.press.l, k: sb.press.k }, sb.press.additive); sb.draw(); }
    else if (sb.press?.point && !sb.drag && sb.press.circle) { sb.sel = sb.press.l; sb.selCorner = null; sb.selEdge = null; sb.addPick(sb.centerPick(sb.press.l), sb.press.additive); sb.draw(); }
    sb.panning = null; sb.drag = null; sb.press = null; sb.snapInfo = null;
  };

  // ---- fingers and pens
  // A finger draws by touch, slide to adjust (the point snaps as usual), lift to place. Two fingers slide and pinch
  // the board. A pen works like the mouse. In touch mode the on-screen keys stand in for Shift / Ctrl / Alt.
  const touches = new Map();
  let pinch = null, touchDraw = null, waitAllUp = false;
  const withMods = (e, phase) => ({ clientX: e.clientX, clientY: e.clientY, pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, metaKey: e.metaKey,
    shiftKey: e.shiftKey || (phase === 'down' && sb.tool === 'select' ? mods.multi : mods.straight),
    ctrlKey: e.ctrlKey || (phase === 'down' && sb.tool === 'select' ? false : mods.free),
    altKey: e.altKey || mods.reach });
  const drawingTool = () => !['select', 'measure'].includes(sb.tool);
  const startPinch = () => {
    const [a, b] = [...touches.values()], r = sb.rect();
    const mid = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: sb.view.s, w: [(mid[0] - sb.view.ox) / sb.view.s, -(mid[1] - sb.view.oy) / sb.view.s] };
  };
  const movePinch = () => {
    const [a, b] = [...touches.values()], r = sb.rect();
    const mid = [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
    const ns = Math.min(400, Math.max(0.3, (pinch.s0 * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.d0));
    sb.view.s = ns; sb.view.ox = mid[0] - pinch.w[0] * ns; sb.view.oy = mid[1] + pinch.w[1] * ns;
    sb.cursor = null; sb.draw();
  };
  sb.svg.addEventListener('pointerdown', (e) => {
    if (palm(e)) return; // a palm resting on the screen while the pen is in use
    sb.fat = fat(e);
    try { sb.svg.setPointerCapture(e.pointerId); } catch { /* */ }
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // a second finger: slide and zoom the board; what the first finger started is dropped (a point drag stays where it is)
        touchDraw = null; if (sb.press) onUp(); sb.cursor = null; startPinch(); waitAllUp = true; return;
      }
      if (touches.size > 2 || waitAllUp) return;
      if (drawingTool()) { touchDraw = { id: e.pointerId }; onMove(withMods(e, 'move')); return; } // placed when the finger lifts
    }
    onDown(withMods(e, 'down'));
  });
  sb.svg.addEventListener('pointermove', (e) => {
    if (palm(e)) return;
    if (e.pointerType === 'touch') {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch) { if (touches.size >= 2) movePinch(); return; }
      if (waitAllUp) return;
    }
    sb.fat = fat(e);
    onMove(withMods(e, 'move'));
  });
  const up = (e) => {
    if (e.pointerType === 'touch') {
      touches.delete(e.pointerId);
      if (pinch || waitAllUp) { if (touches.size < 2) pinch = null; if (!touches.size) waitAllUp = false; return; }
      if (touchDraw?.id === e.pointerId) {
        touchDraw = null;
        if (e.type === 'pointerup') { sb.fat = fat(e); onDown(withMods(e, 'down')); }
        sb.cursor = null; sb.draw();
        return;
      }
    }
    onUp(e);
  };
  sb.svg.addEventListener('pointerup', up);
  sb.svg.addEventListener('pointercancel', up);
  sb.svg.addEventListener('dblclick', (e) => {
    if ((sb.tool === 'line' || sb.tool === 'arc') && sb.current) { sb.commitCurrent(); sb.draw(); return; }
    if (sb.tool === 'select') {
      const best = sb.sideAt(e); if (!best) return;
      // a new corner on the side, right where you double-clicked
      const l = sb.loops[best.l], A = l.pts[best.i], B = l.pts[(best.i + 1) % l.pts.length], raw = sb.toMm(e.clientX, e.clientY);
      const d = [B[0] - A[0], B[1] - A[1]], L2 = d[0] * d[0] + d[1] * d[1] || 1, t = Math.max(0.05, Math.min(0.95, ((raw[0] - A[0]) * d[0] + (raw[1] - A[1]) * d[1]) / L2));
      sb.insertPoint(best.l, best.i, [r3(A[0] + d[0] * t), r3(A[1] + d[1] * t)]);
    }
  });
  sb.svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = sb.rect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015), ns = Math.min(400, Math.max(0.3, sb.view.s * k));
    sb.view.ox = mx - ((mx - sb.view.ox) * ns) / sb.view.s; sb.view.oy = my - ((my - sb.view.oy) * ns) / sb.view.s; sb.view.s = ns; sb.draw();
  }, { passive: false });

  // ---- keys (the board keeps them to itself while it is open)
  sb.onKey = (e) => {
    if (e.target.tagName === 'INPUT' || e.target.closest?.('dialog')) return;
    e.stopPropagation();
    if (e.key === 'Alt' || e.key === 'Control') { if (e.key === 'Alt') e.preventDefault(); sb.modsChanged(e); return; } // (Alt must not open the browser menu)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); sb.undo(); return; }
    if (e.key === 'Escape') { e.preventDefault(); sb.canvas.querySelector('.sk-mchoose')?.remove(); if (sb.typed) sb.typed = ''; else if (sb.ruleWait) { sb.ruleWait = null; sb.picks = []; } else if (sb.current?.arcEnd) sb.current.arcEnd = null; else if (sb.current?.type === 'poly') sb.commitCurrent(); else if (sb.current) sb.current = null; else if (sb.pickFor) sb.pickFor = null; else if (sb.measure) sb.measure = null; else { sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.picks = []; } sb.draw(); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (sb.ruleWait === 'angle' && sb.picks.length === 1 && sb.pickIs.side(sb.picks[0])) { const a = sb.picks[0]; sb.picks = []; sb.ruleWait = null; sb.askAngle(a, null); sb.draw(); return; } if (sb.typed) sb.applyTyped(); else if (sb.current?.type === 'poly') { sb.commitCurrent(); sb.draw(); } return; }
    if (e.key === 'Delete') { e.preventDefault(); sb.delSel(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); sb.typed = sb.typed.slice(0, -1); sb.draw(); return; }
    if (/^[0-9.,\-x×;]$/.test(e.key) && sb.current) { e.preventDefault(); sb.typed += e.key; sb.draw(); return; }
    if (!e.ctrlKey && !e.metaKey) {
      const k = { l: 'line', a: 'arc', r: 'rect', c: 'circle', o: 'slot', p: 'polygon', s: 'select', t: 'trim', h: 'helper', m: 'measure' }[e.key.toLowerCase()];
      if (k && (!sb.current || ['line', 'arc'].includes(k))) sb.setTool(k);
    }
  };
  /** Alt (long reach) or Ctrl (no snapping) pressed or let go without moving the mouse: show the change at once. */
  sb.modsChanged = (e) => {
    if (!sb.lastMove || sb.drag || sb.tool === 'select' || sb.tool === 'trim') return;
    sb.lastMove = { ...sb.lastMove, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey };
    sb.cursor = sb.snap(sb.lastMove.raw, null, sb.drawOpts(sb.lastMove)); sb.draw();
  };
  sb.onKeyUp = (e) => { if (e.key === 'Alt' || e.key === 'Control') { e.preventDefault(); sb.modsChanged(e); } };
  window.addEventListener('keydown', sb.onKey, true);
  window.addEventListener('keyup', sb.onKeyUp, true);
  sb.ro = new ResizeObserver(() => sb.draw()); sb.ro.observe(sb.svg);
}

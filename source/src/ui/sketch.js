// Sketch: a flat drawing board for outlines (lines, arcs, rectangles, circles) with exact sizes.
// Closed outlines become a solid (pushed up or spun around); outlines inside other outlines become holes.
// Loops: see sketchgeom.js. Rules ("stays flat", "parallel to", "this long"...) keep holding while you change things.
// The board is one object, `sb`, made here; each part installs its functions on it:
//   sketchdraw.js (screen, snapping, drawing) · sketchedit.js (changing the drawing, rules, joining lines)
//   sketchpanel.js (the panel on the right) · sketchtools.js (Line, Arc, Rectangle...) · sketchinput.js (mouse, keys)
//   sketchmore.js (Trim, Slot, Polygon, Offset, Pattern, Import) · sketchkit.js (shared helpers and tables) · ../sketchsolve.js (the rules solver) · ../sketchgeom.js (geometry)
import { $, h, ic, toast, modal } from './dom.js';
import { app } from '../state.js';
import * as SG from '../sketchgeom.js';
import { pointOf, analyzeSketch } from '../sketchsolve.js';
import { toggleMod, mods } from '../touch.js';
import { SNAP_KINDS, svgEl, RULE_BTNS, ruleIcon, fmtN } from './sketchkit.js';

export { insideLoop, loopArea } from '../sketchgeom.js';
export { ruleRefs, pointOf, angleNow, valueNow, solveRules, analyzeSketch } from '../sketchsolve.js';
import { installDraw } from './sketchdraw.js';
import { installPhoto } from './sketchphoto.js';
import { installEdit } from './sketchedit.js';
import { installPanel } from './sketchpanel.js';
import { installTools } from './sketchtools.js';
import { installInput } from './sketchinput.js';
import { installMore } from './sketchmore.js';

/**
 * Open the sketch board.
 * start: the outlines to begin with: an array of loops, or { loops, rules }.
 * onDone(loops, rules) is called with the result; closing without Done changes nothing.
 * opts.ref: lines to show underneath (and snap to) when sketching on a face: { segs: [[[x,y],...]], pts: [{p, kind}] }.
 */
export function openSketch(start, onDone, title = 'Sketch', opts = {}) {
  const sb = { start, onDone, title, opts };
  sb.st0 = Array.isArray(sb.start) ? { loops: sb.start, rules: [] } : sb.start || {};
  sb.loops = JSON.parse(JSON.stringify(sb.st0.loops || []));
  sb.rules = JSON.parse(JSON.stringify(sb.st0.rules || []));
  sb.ref = sb.opts.ref || null;
  // several sketches on one board: each loop knows which sketch it belongs to (loop.owner = index into owners)
  sb.owners = sb.opts.owners?.length > 1 ? sb.opts.owners : null;
  sb.newOwner = 0; // where newly drawn shapes go
  sb.undoStack = [];
  sb.remember = () => { sb.undoStack.push(JSON.stringify({ loops: sb.loops, rules: sb.rules, photo: sb.photo })); if (sb.undoStack.length > 200) sb.undoStack.shift(); };
  sb.tool = 'line'; sb.current = null; sb.sel = null; sb.drag = null; sb.cursor = null; sb.snapInfo = null; sb.typed = '';
  sb.measure = null; // Measure tool: { p: the first point picked }
  sb.liveMirror = null; // Live mirror: null (off), 0 (across the green line) or 1 (across the red line)
  sb.selEdge = null; sb.selCorner = null; sb.pickFor = null; // a picked side {l, i} / corner {l, i}; waiting for a second side
  // Everything picked for a rule: sides {l, i}, points {pt: 1, l, k} or {pt: 1, o: 1}, circles {l, circle: 1}, shapes {l, shape: 1}
  sb.picks = []; sb.ruleWait = null; // ruleWait: a rule button was clicked first and is waiting for its things
  sb.lockInfo = null; sb.lockKey = ''; // how locked the drawing is (worked out again only when something changed)
  sb.view = { s: 6, ox: 0, oy: 0 }; // pixels per mm and where 0,0 sits on screen
  sb.snaps = () => { const s = app.settings.skSnap || {}; return Object.fromEntries(SNAP_KINDS.map(([k]) => [k, s[k] !== false])); };

  sb.host = $('view');
  sb.root = h('div', { class: 'sketch' });
  sb.svg = svgEl('svg', { class: 'sk-svg' });
  sb.side = h('div', { class: 'sk-side' });
  sb.hint = h('div', { class: 'sk-hint' });
  sb.toolBtn = (k, icon, label, title2) => h('button', { class: 'cb sk-tool', 'data-tool': k, title: title2, onclick: () => sb.setTool(k) }, ic(icon), h('span', {}, label));
  sb.bar = h('div', { class: 'sk-bar' },
    sb.toolBtn('line', 'PenLine', 'Line', 'Click from point to point. Click the first point again to close the outline, or press Enter / Esc to stop: the line stays open and you can carry on from its orange end later. Lines whose ends meet join into one. Type a length + Enter for an exact line. (L)'),
    sb.toolBtn('arc', 'Spline', 'Arc', 'Curved side: click where it ends, then click a point it bends through. Switch between Line and Arc while drawing one outline. (A)'),
    sb.toolBtn('rect', 'Square', 'Rectangle', 'Click two corners. Type width,height + Enter for an exact size. (R)'),
    sb.toolBtn('circle', 'Circle', 'Circle', 'Click the center, then the edge. Type the diameter + Enter. (C)'),
    sb.toolBtn('slot', 'Pill', 'Slot', 'A rounded slot: click the two centers of its round ends, then how wide it is. Or type the length (center to center) + Enter, then the width + Enter. (O)'),
    sb.toolBtn('polygon', 'Hexagon', 'Polygon', 'A hexagon (or any number of sides): click the center, then a corner. Or type the size across flats + Enter. (P)'),
    sb.toolBtn('helper', 'Minus', 'Helper line', 'A dotted line to line things up and measure from. It never becomes part of the solid. Click two points. (H)'),
    sb.toolBtn('measure', 'Ruler', 'Measure', 'Click two points (corners, circle centers, the center of the sketch): see how far apart they are left-right, up-down and straight. Click a number to set it; it stays. (M)'),
    sb.toolBtn('select', 'MousePointer2', 'Select', 'Click a shape, side or corner to pick it; drag points to move them; drag the small diamond on a side to bend it. (S)'),
    sb.toolBtn('trim', 'Eraser', 'Trim', 'Click a piece of a line to take it out, up to the lines that cross it (the piece turns red first). Trim overlapping shapes into one outline. (T)'),
    h('span', { class: 'csep' }),
    h('button', { class: 'cb', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', onclick: () => sb.undo() }, ic('Undo2')),
    h('button', { class: 'cb sk-short', 'aria-label': 'Delete', title: 'Delete the picked corner, side or shape (Delete). Deleting a side opens the outline: it stays as an unfinished line until you close it again.', onclick: () => sb.delSel() }, ic('Trash2'), h('span', {}, 'Delete')),
    h('button', { class: 'cb sk-delseg', title: 'Delete segment: take the picked side (or sides, picked with Shift) out. The outline opens up so you can draw something new in its place, now or later. Pick a side with Select first.', onclick: () => sb.delSegment() }, ic('Scissors'), h('span', {}, 'Delete segment')),
    h('button', { class: 'cb', title: 'Fit everything in view', 'aria-label': 'Fit', onclick: () => sb.fit() }, ic('Maximize')),
    h('button', { class: 'cb sk-short', 'aria-label': 'Import', title: 'Import a DXF or SVG drawing into this sketch: lines, arcs and circles you can change like any other', onclick: () => sb.importFile() }, ic('Import'), h('span', {}, 'Import')),
    h('span', { style: 'flex:1' }),
    h('button', { class: 'btn', onclick: () => sb.close(true) }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => sb.finish() }, ic('Check'), 'Done'));
  sb.canvas = h('div', { class: 'sk-canvas' }, sb.svg, sb.hint);
  sb.status = h('div', { class: 'sk-status' });
  sb.canvas.append(sb.status);
  sb.rbar = h('div', { class: 'sk-rbar' }, h('span', { class: 'sk-rbar-l', title: 'Rules keep your drawing the way you want it, even when you change things later. Pick lines, points or circles (Select tool; Shift+click to pick more than one), then click a rule. Or click a rule first and then the things it is for.' }, 'Rules'),
    ...RULE_BTNS.map(([k, label, tip]) => h('button', { class: 'cb sk-rb', 'data-rule': k, title: tip, onclick: () => sb.pressRule(k) }, ruleIcon(k), h('span', {}, label))),
    // touch mode only: stand-ins for the keys a tablet doesn't have
    h('span', { class: 'touch-only sk-keys' },
      ...[['multi', 'Pick more', 'Pick more than one thing (like holding Shift)'], ['straight', 'Straight', 'Lines go straight or at 45° (like holding Shift)'],
        ['reach', 'Reach', 'Loose ends reach 10 mm instead of 2 mm (like holding Alt)'], ['free', 'Free', 'No snapping at all (like holding Ctrl)']]
        .map(([k, label, tip]) => h('button', { class: 'cb sk-key', 'data-key': k, title: tip, onclick: (e) => { e.currentTarget.classList.toggle('on', toggleMod(k)); } }, h('span', {}, label))),
      h('button', { class: 'cb', title: 'Type a size: a length while drawing a line, width,height for a rectangle, the diameter of a circle', onclick: () => sb.numberPad() }, h('span', {}, '123'))));
  sb.root.dataset.title = sb.title; // no title row: the board itself shows you are sketching
  sb.root.append(sb.bar, sb.rbar, h('div', { class: 'sk-main' }, sb.canvas, sb.side));
  document.body.classList.add('sketching');
  sb.host.append(sb.root);
  installPhoto(sb); installDraw(sb); installEdit(sb); installPanel(sb); installTools(sb); installMore(sb); installInput(sb);

  sb.close = function close(cancelled = true) { sb.releasePhoto(); document.body.classList.remove('sketching'); window.removeEventListener('keydown', sb.onKey, true); window.removeEventListener('keyup', sb.onKeyUp, true); sb.ro.disconnect(); sb.root.remove(); if (cancelled) sb.opts.onCancel?.(); };
  sb.finish = function finish() {
    if (sb.current?.type === 'poly') sb.commitCurrent();
    sb.current = null;
    const nOpen = sb.loops.filter((l) => l.type === 'open').length;
    if (nOpen) return sb.askOpenLines(nOpen);
    if (!sb.loops.some(SG.isSolidLoop)) { sb.draw(); return toast('Draw at least one closed outline first (helper lines do not count).'); }
    sb.close(false); sb.onDone(sb.loops, sb.rules, { photo: sb.photo });
  };
  /** Done with lines still open: close them, keep drawing, or finish with just the closed outlines. */
  sb.askOpenLines = function askOpenLines(n) {
    sb.draw();
    // would joining the ends that nearly touch close something? try it on a copy
    const saved = JSON.stringify({ loops: sb.loops, rules: sb.rules }); sb.joinCloseEnds(); const closeGaps = sb.loops.filter((l) => l.type === 'open').length < n || JSON.stringify({ loops: sb.loops, rules: sb.rules }) !== saved; ({ loops: sb.loops, rules: sb.rules } = JSON.parse(saved));
    const solid = sb.loops.some(SG.isSolidLoop), all = () => sb.loops.map((l, i) => (l.type === 'open' ? i : -1)).filter((i) => i >= 0);
    modal('Unfinished lines', [
      h('p', {}, `${n === 1 ? 'One line is' : `${n} lines are`} not closed yet (the orange ends). Only closed outlines become solid.`),
      h('p', { class: 'muted' }, solid ? 'Finish without them: they stay in the sketch (not solid), so you can finish them later with Edit sketch.' : `Close ${n === 1 ? 'it' : 'them'} first: there is no closed outline yet.`)],
    (done) => [
      h('button', { class: 'btn', onclick: done }, 'Keep drawing'),
      ...(closeGaps ? [h('button', { class: 'btn', title: `Loose ends within ${fmtN(sb.endReach())} mm of each other are moved together and joined`, onclick: () => { done(); sb.remember(); sb.joinCloseEnds(); sb.draw(); sb.finish(); } }, 'Join close ends')] : []),
      ...(solid ? [h('button', { class: 'btn', title: 'Make the solid from the closed outlines; the open lines are kept in the sketch for later', onclick: () => { done(); sb.close(false); sb.onDone(sb.loops, sb.rules, { photo: sb.photo }); } }, 'Finish without them')] : []),
      h('button', { class: 'btn primary', title: 'Join the two ends of each unfinished line with a straight side', onclick: () => { done(); sb.remember(); sb.closeWithLines(all()); sb.draw(); if (!sb.loops.some((l) => l.type === 'open')) sb.finish(); } }, 'Close with straight lines')]);
  };
  /** Touch mode: type a size without a keyboard (the same as typing numbers + Enter while drawing). */
  sb.numberPad = function numberPad() {
    if (!sb.current) return toast('Start drawing first (click the first point), then type the length or size.', 'info', 3500);
    sb.canvas.querySelector('.sk-ask')?.remove();
    const inp = h('input', { class: 'in sk-ask sk-pad', inputmode: 'decimal', placeholder: { rect: 'width,height', circle: 'diameter', polygon: 'across flats', slot: sb.current.b ? 'width' : 'length (or length,width)' }[sb.current.type] || 'length (or x,y)' });
    let finished = false;
    const done = (ok) => { if (finished) return; finished = true; const v = inp.value.trim(); inp.remove(); if (ok && v) { sb.typed = v; sb.applyTyped(); } sb.draw(); };
    inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
    sb.canvas.append(inp); inp.focus();
  };
  for (const b of sb.bar.querySelectorAll('.sk-key')) b.classList.toggle('on', !!mods[b.dataset.key]);
  sb.ensureAnchor();
  requestAnimationFrame(() => { sb.fit(); });
  return {
    close: sb.close, finish: sb.finish, get loops() { return sb.loops; }, get rules() { return sb.rules; },
    pickEdge: (l, i) => { sb.selEdge = { l, i }; sb.sel = l; sb.draw(); }, pickCorner: (l, i) => { sb.selCorner = { l, i }; sb.sel = l; sb.draw(); },
    lineOp: sb.lineOp, setLength: (l, i, v) => { sb.setLength(l, i, v, true); sb.draw(); }, center: sb.center, mirror: sb.mirror, pick: (i) => { sb.sel = i; sb.draw(); },
    typedInput: (s) => { sb.typed = s; sb.applyTyped(); }, click: (p, o) => sb.click(sb.snap(p, null, o || {})), setTool: sb.setTool, setRound: (l, i, r) => { sb.setRound(sb.loops[l], i, r); sb.draw(); },
    setBulge: (l, i, b) => { sb.setBulge(sb.loops[l], i, b); sb.draw(); }, movePoint: (l, k, p) => { const q = sb.loops[l].pts[k]; q[0] = p[0]; q[1] = p[1]; sb.settle(new Set([q])); sb.draw(); },
    measureRule: (t, p, q, v) => { const P = pointOf(sb.loops, p), Q = pointOf(sb.loops, q); const cur = t === 'dx' ? Q[0] - P[0] : t === 'dy' ? Q[1] - P[1] : 1; sb.rules.push({ t, p, q, v: (Math.sign(cur) || 1) * v }); sb.settle(new Set()); sb.draw(); },
    measurePick: (p, q) => sb.measureChoose(p, q), setRadius: (l, i, R) => { sb.setRadius(l, i, R); sb.draw(); }, smoothJoin: sb.smoothJoin, addRule: (t, a, b) => sb.addRule(t, a, b),
    straighten: (l, i) => sb.straighten(l, i), toGreenLine: sb.toGreenLine, moveToCenter: (l, k) => sb.moveToCenter(pointOf(sb.loops, { l, k })), togglePin: sb.togglePin,
    dragLine: (li, d) => { sb.dropAuto(li); const L = sb.loops[li], A0 = L.pts[0].slice(), B0 = L.pts[1].slice(); const dd = sb.latchLine(li, A0, B0, d); L.pts[0][0] = A0[0] + dd[0]; L.pts[0][1] = A0[1] + dd[1]; L.pts[1][0] = B0[0] + dd[0]; L.pts[1][1] = B0[1] + dd[1];
      if (sb.latched?.end != null) sb.attach(li, sb.latched.end, sb.latched.info); else if (sb.latched?.line) { sb.attach(li, 0, { kind: 'edge', line: sb.latched.line }); sb.attach(li, 1, { kind: 'edge', line: sb.latched.line }); }
      sb.latched = null; sb.settle(new Set()); sb.draw(); },
    setLiveMirror: (ax) => { sb.liveMirror = ax; sb.draw(); },
    pickItems: (ps) => { sb.picks = ps.map((p) => ({ ...p })); sb.ruleWait = null; sb.draw(); }, pressRule: (k) => sb.pressRule(k), clickPick: (p, additive) => { sb.addPick({ ...p }, additive); sb.draw(); },
    get picks() { return sb.picks; }, get ruleWait() { return sb.ruleWait; }, analyze: () => analyzeSketch(sb.loops, sb.rules), toggleAnchor: sb.toggleAnchor, setShowing: sb.setShowing, setDiameter: (li, v) => { sb.setDiameter(li, v); sb.draw(); },
    toggleFreeze: (ls) => { sb.toggleFreeze(ls); sb.draw(); },
    screenOf: (p) => { const r = sb.rect(), [x, y] = sb.toScreen(p); return [x + r.left, y + r.top]; },
    snapAt: (p, o) => { const q = sb.snap(p, null, o || {}); return { p: q, kind: sb.snapInfo?.kind || null }; },
    latchLine: (li, d) => { const l = sb.loops[li]; const A0 = l.pts[0].slice(), B0 = l.pts[1].slice(); const dd = sb.latchLine(li, A0, B0, d); l.pts[0] = [A0[0] + dd[0], A0[1] + dd[1]]; l.pts[1] = [B0[0] + dd[0], B0[1] + dd[1]]; sb.draw(); return sb.snapInfo?.kind || null; }, insertPoint: sb.insertPoint, deletePoint: sb.deletePoint, mergeTouching: () => sb.mergeTouching(), deleteSides: (li, sides) => sb.deleteSides(li, sides), get drawing() { return sb.current; }, undo: () => sb.undo(),
    trimAt: (p) => sb.trimAt(p), trimSpanAt: (p) => { const s = sb.trimSpanAt(p); return s && { l: s.li, i: s.i, t0: s.t0, t1: s.t1 }; }, offset: (idx, d, corners, keep) => sb.offset(idx, d, corners, keep), pattern: (idx, o) => sb.pattern(idx, o),
    makeHelper: (li, sides) => sb.makeHelper(li, sides), makeDrawn: (li) => sb.makeDrawn(li), addImported: (ls, place) => sb.addImported(ls, place), readDrawing: (name, text) => sb.readDrawing(name, text), importText: (name, text) => sb.importText(name, text), importFile: () => sb.importFile(),
  };
}

/** Ask how to make the sketch solid: pushed up (with a height) or spun around the green line; added or cut. */
export function askSolid(onOk, { h0 = 10, onFace = false, loops = null } = {}) {
  let mode = 'extrude', cut = false;
  const hIn = h('input', { class: 'in', value: String(h0), style: 'font-family:var(--ui)' });
  const aIn = h('input', { class: 'in', value: '360', style: 'font-family:var(--ui)' });
  const hRow = h('div', { class: 'field' }, h('label', { class: 'plain' }, 'Height (mm)'), hIn);
  const aRow = h('div', { class: 'field', hidden: true }, h('label', { class: 'plain' }, 'Turn (degrees, 360 = all the way)'), aIn);
  const seg = (opts, get, set) => h('div', { class: 'seg' }, ...opts.map(([v, label, tip]) => {
    const b = h('button', { class: get() === v ? 'on' : '', title: tip, onclick: () => { set(v); for (const x of b.parentNode.children) x.classList.toggle('on', x === b); upd(); } }, label);
    return b;
  }));
  const hint = h('div', { class: 'muted', style: 'font-size:12px;margin:-2px 2px 6px' });
  const HINTS = { loft: 'Loft: goes from the first outline you drew (bottom) to the second one (top) over the height. Draw exactly two outlines.',
    sweep: 'Sweep: carries the outline along a path. Draw the path with Helper lines joined end to end; the outline is stood up across the path at its start.' };
  const upd = () => { hRow.hidden = !(mode === 'extrude' || mode === 'loft'); aRow.hidden = mode !== 'revolve'; hint.textContent = HINTS[mode] || ''; hint.hidden = !HINTS[mode]; };
  const ok = () => {
    const v = parseFloat(hIn.value), a = parseFloat(aIn.value);
    if ((mode === 'extrude' || mode === 'loft') && !(v > 0)) { toast('Type a height above 0.'); return false; }
    if (loops && mode === 'loft' && loops.filter(SG.isSolidLoop).length !== 2) { toast('For Loft, draw exactly two outlines (bottom first, then top). Helper lines don\'t count.', 'err', 5000); return false; }
    if (loops && mode === 'sweep' && !loops.some((l) => l.type === 'line')) { toast('For Sweep, draw the path with Helper lines first.', 'err', 5000); return false; }
    if (mode === 'revolve' && !(a > 0 && a <= 360)) { toast('Type a turn between 1 and 360.'); return false; }
    onOk({ mode, h: v, angle: a, cut }); return true;
  };
  const close = modal('Make it solid', [
    h('div', { class: 'ask-group' }, h('div', { class: 'ask-label' }, 'How'), seg([['extrude', 'Push up', 'Give the outline a height'], ['revolve', 'Spin around', 'Spin the outline around the green line, like a lathe (cups, knobs, wheels)'],
      ['loft', 'Loft', 'Change from one shape to another going up (square bottom to round top, a funnel, a vase)'], ['sweep', 'Sweep', 'Carry the outline along a path drawn with helper lines (handles, pipes, rails)']], () => mode, (v) => { mode = v; })),
    hint, hRow, aRow,
    h('div', { class: 'ask-group' }, h('div', { class: 'ask-label' }, 'Result'), seg([['add', 'New object', 'Make a new solid'], ['cut', onFace ? 'Cut into the face' : 'Cut a hole', onFace ? 'Cut the outline into the object, as deep as the height' : 'Cut the outline out of whatever it passes through']], () => (cut ? 'cut' : 'add'), (v) => { cut = v === 'cut'; })),
    h('div', { class: 'muted' }, 'You can change all of this, and the outline, later in Properties.')],
  (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (ok()) done(); } }, 'OK')]);
  for (const inp of [hIn, aIn]) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ok()) close(); });
  upd();
  setTimeout(() => { hIn.focus(); hIn.select(); }, 0);
}

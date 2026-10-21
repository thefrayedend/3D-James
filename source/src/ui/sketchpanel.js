// Sketch board: the panel on the right (picked corner/side, unfinished lines, rules, sketches, snaps, shapes) and names.
// Installed on the board object `sb` by openSketch (sketch.js); everything shared lives on sb.
import { POINT_RULES, isCircleRef } from '../sketchsolve.js';
import * as SG from '../sketchgeom.js';
import { app, saveSettings } from '../state.js';
import { h, toast } from './dom.js';
import { RULE_MARK, RULE_TEXT, SNAP_KINDS, VALUE_RULES, fmtN } from './sketchkit.js';

export function installPanel(sb) {

  // ---- the exact numbers on the right
  sb.renderSide = function renderSide() {
    if (sb.side.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    sb.side.replaceChildren();
    const btn = (label, fn, title2, on) => h('button', { class: 'chip' + (on ? ' on' : ''), title: title2 || label, onclick: fn }, label);
    const numIn = (v, set, attrs = {}) => h('input', { class: 'in', value: fmtN(v), ...attrs, onchange: (e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) { sb.remember(); set(n); sb.draw(); } } });
    // lines that are still open: they don't have to go back to where they started
    if (sb.tool === 'polygon') sb.side.append(sb.polygonPanel(btn, numIn));
    const openIdx = sb.loops.map((l, i) => (l.type === 'open' ? i : -1)).filter((i) => i >= 0);
    const drawingLine = sb.current?.type === 'poly';
    if (openIdx.length || (drawingLine && sb.current.pts.length >= 2)) {
      const target = sb.sel != null && sb.loops[sb.sel]?.type === 'open' ? [sb.sel] : openIdx;
      sb.side.append(h('div', { class: 'sk-item sel' },
        h('div', { class: 'sk-item-h' }, h('b', {}, drawingLine ? 'Drawing a line' : `Unfinished line${openIdx.length === 1 ? '' : 's'} (${openIdx.length})`)),
        h('div', { class: 'muted', style: 'font-size:12px;margin-bottom:6px' }, drawingLine
          ? 'Click the ringed start to close the outline, or an orange end to join that line. Enter or Esc stops here: the line stays, and you can carry on from its end later.'
          : 'Carry on from an orange end with Line or Arc. When the two ends meet (or meet another line), it closes into an outline. Only closed outlines become solid.'),
        h('div', { class: 'chip-row' },
          ...(drawingLine && sb.current.pts.length >= 2 ? [btn('Stop here', () => { sb.commitCurrent(); sb.draw(); }, 'Keep the line as it is and stop drawing (Enter or Esc)'), btn('Close with a line', () => { sb.current.arcEnd = null; sb.closeLoop(); }, 'Go straight back to where this line started')] : []),
          ...(!drawingLine && openIdx.length ? [btn(`Join close ends (≤ ${fmtN(sb.endReach())} mm)`, () => { sb.remember(); const n = sb.joinCloseEnds(); if (!n) { sb.undoStack.pop(); toast(`No loose ends are within ${fmtN(sb.endReach())} mm of each other. (Change the distance under Snap to.)`, 'info', 4000); } else toast(`${n} gap${n === 1 ? '' : 's'} joined.`, 'info', 2500); sb.draw(); }, 'Loose ends that are close to each other but not quite touching are moved together and joined')] : []),
          ...(!drawingLine && target.length ? [btn(target.length === 1 ? 'Close it with a line' : `Close all ${target.length} with lines`, () => { sb.remember(); sb.closeWithLines(target); sb.draw(); }, 'Join the two ends of each unfinished line with a straight line')] : []))));
    }
    if (sb.selCorner && sb.loops[sb.selCorner.l]?.pts) {
      const l = sb.loops[sb.selCorner.l], i = sb.selCorner.i, p = l.pts[i], rr = +(l.round?.[i] || 0);
      sb.side.append(h('div', { class: 'sk-item sel' },
        h('div', { class: 'sk-item-h' }, h('b', {}, `Corner P${i + 1}`)),
        h('div', { class: 'sk-row' }, h('span', {}, 'Spot'), numIn(p[0], (n) => { p[0] = n; sb.settle(new Set([p])); }), numIn(p[1], (n) => { p[1] = n; sb.settle(new Set([p])); })),
        h('div', { class: 'sk-row two' }, h('span', {}, 'Round it'), numIn(rr, (n) => sb.setRound(l, i, Math.max(0, n)), { title: 'Radius of the rounding (0 = sharp)' })),
        h('div', { class: 'chip-row' }, ...[0, 1, 2, 3, 5, 10].map((v) => btn(v ? `R${v}` : 'Sharp', () => { sb.remember(); sb.setRound(l, i, v); sb.draw(); }, v ? `Round this corner with radius ${v} mm` : 'Make it a sharp corner', Math.abs(rr - v) < 1e-9))),
        h('div', { class: 'chip-row', style: 'margin-top:6px' },
          btn(sb.rules.some((r) => r.t === 'pin' && !r.p.o && r.p.l === sb.selCorner.l && r.p.k === i) ? 'Unpin' : 'Pin', () => sb.togglePin(sb.selCorner.l, i), 'Pin this point where it is: nothing can move it (keeps the drawing from sliding or turning)'),
          btn('Move to center', () => sb.moveToCenter(p), 'Slide the whole drawing so this point sits on the center of the sketch (where the red and green lines cross)'),
          btn('Smooth join', () => sb.smoothJoin(sb.selCorner.l, i), 'Where an arc meets a side here: join them without a bump (tangent), and keep it that way'),
          btn('Delete corner', () => sb.deletePoint(sb.selCorner.l, i), 'Take this corner out (its two sides become one)'))));
    }
    if (sb.selEdge && sb.loops[sb.selEdge.l]?.pts) {
      const l = sb.loops[sb.selEdge.l], i = sb.selEdge.i, u = sb.edgeDir(l, i), n = l.pts.length, b = +(l.bulge?.[i] || 0);
      const A = l.pts[i], B = l.pts[(i + 1) % n];
      const ang = ((Math.atan2(u[1], u[0]) * 180) / Math.PI + 360) % 360;
      const mine = sb.rules.map((r, k) => [r, k]).filter(([r]) => (r.a?.l === sb.selEdge.l && r.a?.i === i) || (r.b && r.b.l === sb.selEdge.l && r.b.i === i));
      const box = h('div', { class: 'sk-item sel' },
        h('div', { class: 'sk-item-h' }, h('b', {}, `${b ? 'Arc' : 'Line'} P${i + 1}–P${((i + 1) % n) + 1}`), h('span', { class: 'muted' }, b ? '' : `${fmtN(ang)}°`)));
      if (b) {
        box.append(h('div', { class: 'sk-row two' }, h('span', {}, 'Radius'), numIn(SG.arcRadius(A, B, b), (v) => { const nb = SG.bulgeForRadius(A, B, b, v); if (nb == null) toast(`At least ${fmtN(sb.edgeLen(l, i) / 2)}.`); else sb.setBulge(l, i, nb); })),
          h('div', { class: 'chip-row' }, btn('Make straight', () => { sb.remember(); sb.setBulge(l, i, 0); sb.draw(); }), btn('Flip bend', () => { sb.remember(); sb.setBulge(l, i, -b); sb.draw(); }, 'Bend the other way'),
            btn('Half circle', () => { sb.remember(); sb.setBulge(l, i, b < 0 ? -1 : 1); sb.draw(); })));
      } else {
        box.append(h('div', { class: 'sk-row two' }, h('span', {}, 'Length'), numIn(sb.edgeLen(l, i), (v) => { if (v > 0) sb.setLength(sb.selEdge.l, i, v, true); })),
          h('div', { class: 'chip-row' },
            btn('Straighten', () => sb.straighten(sb.selEdge.l, i), 'Turn the whole drawing so this line is exactly level (or straight up, whichever is closer)'), btn('Bend', () => { sb.remember(); sb.setBulge(l, i, 0.25); sb.draw(); }, 'Make this side a curve (then drag its ◆ or type a radius)')),
          h('div', { class: 'muted', style: 'font-size:11.5px;margin:6px 0 0' }, 'To keep it flat, parallel, square to another line… use the Rules row above the drawing.'));
      }
      if (sb.hasSides(l)) {
        const ns = sb.pickedSidesOf(sb.selEdge).length;
        box.append(h('div', { class: 'chip-row', style: 'margin-top:6px' }, btn(ns > 1 ? `Delete ${ns} segments` : 'Delete segment', () => sb.deleteSides(sb.selEdge.l, sb.pickedSidesOf(sb.selEdge)),
          'Take this side out (Delete). The outline opens up: draw the new part from its open end with Line or Arc and click the other orange end to close it, now or later. Shift+click more sides to take out more.'),
          ...(b ? [] : [btn(ns > 1 ? `Make ${ns} helper lines` : 'Make helper line', () => sb.makeHelper(sb.selEdge.l, sb.pickedSidesOf(sb.selEdge)), 'Turn this side into a helper line: a dotted guide that never becomes solid. The outline opens up where it was.')])));
      } else if (l.type === 'line') box.append(h('div', { class: 'chip-row', style: 'margin-top:6px' }, btn('Make it a drawn line', () => sb.makeDrawn(sb.selEdge.l), 'Turn this helper line into a real line of the drawing: it joins lines whose ends meet it, and closed outlines become solid')));
      if (mine.length) box.append(h('div', { style: 'margin-top:6px' }, ...mine.map(([r, k]) => h('div', { class: 'sk-rule-row' }, h('span', {}, sb.ruleLabel(r)), h('button', { class: 'chip', title: 'Remove this rule', onclick: () => sb.removeRule(k) }, '✕')))));
      if (sb.pickFor) box.append(h('div', { class: 'muted', style: 'margin-top:6px' }, 'Click the other line… (Esc to stop)'));
      sb.side.append(box);
    }
    // folding sections (they remember whether they are open)
    const fold = (key, title2, sub, open0, ...body) => {
      const F = app.settings.skFold || {}, open = F[key] ?? open0;
      const head = h('button', { class: 'sk-fold-h' + (open ? ' open' : ''), title: open ? 'Click to fold away' : 'Click to open', onclick: () => { app.settings.skFold = { ...F, [key]: !open }; saveSettings(); sb.draw(); } },
        h('span', { class: 'sk-chev' }, open ? '▾' : '▸'), h('span', {}, title2), sub ? h('span', { class: 'muted' }, sub) : null);
      sb.side.append(head); if (open) sb.side.append(h('div', { class: 'sk-fold-b' }, ...body));
    };
    // rules
    const anc = sb.anchorRule();
    const ruleRows = sb.rules.map((r, k) => h('div', { class: 'sk-rule-row' + (r.off ? ' off' : '') }, h('span', {}, sb.ruleLabel(r)),
      h('div', { style: 'display:flex;gap:3px' },
        ...(VALUE_RULES.has(r.t) ? [h('button', { class: 'chip' + (r.ref ? '' : ' on'), title: r.ref ? 'Just showing: the size is shown but does not hold. Click to lock it.' : 'Locked: this size holds. Click to just show it instead.', onclick: () => sb.setShowing(k, !r.ref) }, r.ref ? '👁' : '🔒')] : []),
        r.t === 'anchor' ? h('button', { class: 'chip', title: r.off ? 'Lock the starting point again' : 'Let rules move the starting point', onclick: () => sb.toggleAnchor() }, r.off ? 'Lock' : 'Unlock')
          : h('button', { class: 'chip', title: 'Remove this rule', onclick: () => sb.removeRule(k) }, '✕'))));
    if (sb.owners) {
      const counts = sb.owners.map((_, i) => sb.loops.filter((l) => l.owner === i && l.type !== 'line').length);
      const joined = counts.filter((n) => n > 0).length <= 1 && sb.loops.length > 0;
      fold('sketches', `Sketches (${sb.owners.length})`, '', true,
        ...sb.owners.map((o, i) => h('div', { class: 'sk-owner' + (sb.newOwner === i ? ' on' : '') },
          h('span', { class: 'sk-owner-dot', style: `background:${o.color}` }), h('b', {}, o.name), h('span', { class: 'muted' }, `${counts[i]} shape${counts[i] === 1 ? '' : 's'}`),
          h('div', { class: 'chip-row' },
            btn(sb.newOwner === i ? 'New shapes go here ✓' : 'New shapes go here', () => { sb.newOwner = i; sb.draw(); }, 'Shapes you draw from now on become part of this sketch', sb.newOwner === i),
            ...(sb.sel != null && sb.loops[sb.sel] && sb.loops[sb.sel].owner !== i ? [btn('Move picked shape here', () => { sb.remember(); sb.loops[sb.sel].owner = i; sb.draw(); }, 'The picked shape becomes part of this sketch')] : [])))),
        h('div', { class: 'chip-row', style: 'margin-top:6px' },
          btn('Merge touching sketches', () => sb.mergeTouching(), 'Outlines that touch or overlap, in any of these sketches, become one outline. A sketch whose shapes all got merged into another one is removed when you click Done.'),
          btn(joined ? 'Joined into one sketch' : 'Join into one sketch', () => { if (joined) return; sb.remember(); for (const l of sb.loops) l.owner = 0; sb.newOwner = 0; toast(`Joined: Done makes one sketch, ${sb.owners[0].name}. The other sketch objects are removed. (Undo separates them again.)`, 'info', 5000); sb.draw(); },
            'Put all the shapes into the first sketch. When you click Done, it becomes one sketch object (with its height or spin) and the other sketch objects are removed.', joined)),
        h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:4px' }, 'Each sketch has its own color. After Done they stay separate objects, unless you join them. Rules can only link shapes of the same sketch.'));
    }
    fold('rules', `Rules (${sb.rules.filter((r) => r.t !== 'anchor').length})`, '', true,
      ...(anc ? [h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' }, anc.off ? '⚓ Starting point unlocked: rules may move it.' : '⚓ The starting point is locked: rules never move it, so the drawing can\'t wander off. You can still drag it.')] : []),
      ...(sb.rules.length > (anc ? 1 : 0) ? ruleRows : [...ruleRows, h('div', { class: 'muted', style: 'font-size:11.5px' }, 'No rules yet. Pick lines or points, then click a rule in the Rules row.')]));
    // the whole sketch / the picked shape
    const wholeBody = [h('div', { class: 'chip-row', style: 'margin-bottom:6px' }, btn(sb.merging ? 'Merging…' : 'Merge touching outlines', () => sb.mergeTouching(), 'Outlines that touch or overlap become one outline (arcs stay arcs, holes stay holes). Shift+click two or more shapes to merge only those; otherwise every outline that touches another is merged.')),
      h('div', { class: 'chip-row', style: 'margin-bottom:6px' },
      btn('Center ↔', () => sb.center(0), 'Center it left-right on the green line'), btn('Center ↕', () => sb.center(1), 'Center it front-back on the red line'),
      ...(sb.sel == null ? [btn('Right of green line', () => sb.toGreenLine(), 'For Spin around: slide the whole drawing so it sits just to the right of the green line, touching it (the green line is what it spins around)')] : []),
      ...(sb.sel != null ? [btn('Mirror ↔', () => sb.mirror(0), 'Mirror across the green line. Draw half an outline with both ends on the green line, and it becomes the whole, symmetric outline.'),
        btn('Mirror ↕', () => sb.mirror(1), 'Mirror across the red line'),
        btn(sb.isFrozen(sb.sel) ? 'Unfreeze' : 'Freeze', () => { sb.toggleFreeze([sb.sel]); sb.draw(); }, 'Freeze: this shape stays exactly where it is (rules and dragging cannot move it)')] : [])),
      ...(sb.sel != null && sb.loops[sb.sel] ? [h('div', { class: 'chip-row', style: 'margin-bottom:6px' },
        ...(SG.isSolidLoop(sb.loops[sb.sel]) ? [btn('Offset…', () => sb.askOffset(), 'A copy of this outline bigger or smaller by a distance all round: a wall that thick, or room around a part (Shift+click more shapes to offset them too)')] : []),
        btn('Pattern…', () => sb.askPattern(), 'Copies of this shape in a row or in a circle: a row of holes, bolt holes around a flange (Shift+click more shapes to copy them together)'),
        ...(sb.hasSides(sb.loops[sb.sel]) ? [btn('Make helper lines', () => sb.makeHelper(sb.sel, null), 'Turn this whole shape into helper lines: dotted guides that never become solid (straight sides only)')] : []),
        ...(sb.loops[sb.sel].type === 'line' ? [btn('Make it a drawn line', () => sb.makeDrawn(sb.sel), 'Turn this helper line into a real line of the drawing')] : []))] : [])];
    if (sb.sel != null && sb.loops[sb.sel]?.type === 'poly') {
      const l = sb.loops[sb.sel];
      const allIn = h('input', { class: 'in', value: '2', style: 'width:56px' });
      wholeBody.push(h('div', { class: 'sk-row two', style: 'margin-bottom:6px' }, h('span', {}, 'Round all'), h('div', { style: 'display:flex;gap:4px' }, allIn,
        h('button', { class: 'chip', title: 'Round every corner of this shape with this radius (0 = all sharp)', onclick: () => { const v = parseFloat(allIn.value); if (!(v >= 0)) return; sb.remember(); l.pts.forEach((_, i) => { const n = l.pts.length; if (!(+(l.bulge?.[i] || 0) || +(l.bulge?.[(i - 1 + n) % n] || 0))) sb.setRound(l, i, v); }); sb.draw(); } }, 'Apply'))));
    }
    fold('whole', sb.sel != null ? `Picked shape: ${sb.loopName(sb.sel)}` : 'Whole sketch', '', true, ...wholeBody);
    // live mirror
    if (sb.photo) fold('photo', 'Photo', sb.photo.hidden ? 'Hidden' : '', true, ...sb.photoPanel(btn));
    fold('mirror', 'Live mirror', sb.liveMirror == null ? 'Off' : sb.liveMirror === 0 ? 'Green line' : 'Red line', false,
      h('div', { class: 'chip-row' },
        btn('Off', () => { sb.liveMirror = null; sb.draw(); }, 'Draw normally', sb.liveMirror == null),
        btn('↔ Green line', () => { sb.liveMirror = 0; sb.draw(); }, 'Everything you draw is mirrored across the green (up-down) line. Draw half an outline from the line and back to it, and it becomes the whole symmetric outline.', sb.liveMirror === 0),
        btn('↕ Red line', () => { sb.liveMirror = 1; sb.draw(); }, 'Everything you draw is mirrored across the red (left-right) line', sb.liveMirror === 1)));
    // snaps
    const S = sb.snaps(), nOn = SNAP_KINDS.filter(([k]) => S[k]).length;
    fold('snap', 'Snap to', nOn === SNAP_KINDS.length ? 'All on' : `${nOn} of ${SNAP_KINDS.length} on`, false,
      h('div', { class: 'chip-row' }, ...SNAP_KINDS.map(([k, label]) => btn(label, () => { app.settings.skSnap = { ...S, [k]: !S[k] }; saveSettings(); sb.draw(); }, {
        end: 'Loose ends of unfinished lines (and where the line you are drawing started) grab the pointer within 2 mm, or within the distance below while you hold Alt, so lines join up. Pull back away from the end to let go.', corner: 'Jump onto corners', middle: 'Jump onto the middle of sides', center: 'Jump onto circle centers and the center of the sketch', edge: 'Jump onto any line, arc or circle', guide: 'Line up with corners and centers (dotted guide lines)', grid: 'Jump to the grid',
      }[k], S[k]))),
      h('div', { class: 'sk-row two', style: 'margin-top:6px', title: 'Holding Alt, a loose end grabs a new point (or a dragged end) from this far away, so the lines join. Without Alt it is 2 mm. Pull back away from the end to let go.' }, h('span', {}, 'Alt: loose ends reach (mm)'),
        numIn(+app.settings.skEndReach > 0 ? +app.settings.skEndReach : 10, (n) => { if (n > 0) { app.settings.skEndReach = n; saveSettings(); } })));
    // shapes and their exact numbers
    const shapeBoxes = sb.loops.map((l, i) => {
      const box = h('div', { class: 'sk-item' + (sb.sel === i ? ' sel' : ''), onclick: () => { sb.sel = i; sb.draw(); } });
      box.append(h('div', { class: 'sk-item-h' }, h('b', {}, sb.loopName(i) + (sb.isFrozen(i) ? ' ❄' : '')), h('span', { class: 'muted' }, sb.hasSides(l) ? `${l.pts.length} points` : '')));
      if (l.type === 'circle') {
        box.append(h('div', { class: 'sk-row' }, h('span', {}, 'Center'), numIn(l.c[0], (n) => { l.c[0] = n; sb.settle(new Set([l.c])); }), numIn(l.c[1], (n) => { l.c[1] = n; sb.settle(new Set([l.c])); })),
          h('div', { class: 'sk-row' }, h('span', {}, 'Diameter'), numIn(l.r * 2, (n) => sb.setDiameter(i, n))));
      } else if (sb.sel === i) {
        l.pts.forEach((p, k) => box.append(h('div', { class: 'sk-row' }, h('span', {}, `P${k + 1}`), numIn(p[0], (n) => { p[0] = n; sb.settle(new Set([p])); }), numIn(p[1], (n) => { p[1] = n; sb.settle(new Set([p])); }))));
      }
      return box;
    });
    fold('shapes', `Shapes (${sb.loops.length})`, '', true,
      ...(sb.loops.length ? shapeBoxes : [h('div', { class: 'muted', style: 'font-size:12px' }, 'Draw an outline with Line, Arc, Rectangle or Circle. Outlines inside other outlines become holes.')]));
  };
  sb.loopName = (li) => { const l = sb.loops[li]; return `${l?.type === 'circle' ? 'Circle' : l?.type === 'line' ? 'Helper line' : l?.type === 'open' ? 'Unfinished line' : 'Outline'} ${li + 1}${sb.owners && l ? ` (${sb.owners[l.owner]?.name})` : ''}`; };
  sb.sideName = (s) => `${sb.loopName(s.l)}, P${s.i + 1}–P${((s.i + 1) % (sb.loops[s.l]?.pts?.length || 1)) + 1}`;
  sb.pointName = (r) => (r.o ? 'center of the sketch' : sb.loops[r.l]?.type === 'circle' ? `${sb.loopName(r.l)} center` : `${sb.loopName(r.l)} P${r.k + 1}`);
  sb.ruleLabel = (r) => {
    const t = `${RULE_MARK[r.t]} ${RULE_TEXT[r.t]}`;
    if (POINT_RULES.has(r.t)) return `${t} ${fmtN(Math.abs(r.v))}${r.ref ? ' (just showing)' : ''}: ${sb.pointName(r.p)} to ${sb.pointName(r.q)}`;
    if (r.t === 'smooth') return `${t}: ${sb.loopName(r.a.l)} at P${r.a.i + 1}`;
    if (r.t === 'pin') return `${t}: ${sb.pointName(r.p)}`;
    if (r.t === 'anchor') return `${RULE_MARK.anchor} Starting point (${sb.pointName(r.p)})${r.off ? ': unlocked' : ': locked'}`;
    if (r.t === 'freeze') return `${t}: ${sb.loopName(r.a.l)}`;
    if (r.t === 'diam') return `${t} ${fmtN(r.v)}${r.ref ? ' (just showing)' : ''}: ${sb.loopName(r.a.l)}`;
    if (r.t === 'angle') return `${t} ${fmtN(Math.round(sb.shownAngle(r) * 1000) / 1000)}°${r.ref ? ' (just showing)' : ''}: ${sb.sideName(r.a)}${r.b ? ` & ${sb.sideName(r.b)}` : ' (from level)'}`;
    if (r.t === 'eqr' || r.t === 'tangent') { const nm = (x) => (isCircleRef(x) ? sb.loopName(x.l) : sb.sideName(x)); return `${t}: ${nm(r.a)} & ${nm(r.b)}`; }
    if (r.t === 'sym') return `${t}: ${sb.pointName(r.p)} & ${sb.pointName(r.q)} across ${r.a?.axis === 0 ? 'the green line' : r.a?.axis === 1 ? 'the red line' : sb.sideName(r.a)}`;
    if (r.t === 'same') return `${t}: ${sb.pointName(r.p)} to ${sb.pointName(r.q)}`;
    if (r.t === 'on' || r.t === 'mid') return `${t}: ${sb.pointName(r.p)} ${r.t === 'on' ? 'on' : 'of'} ${r.a.fixed ? 'the face edge' : r.a.circle ? sb.loopName(r.a.l) : sb.sideName(r.a)}`;
    return `${t}${r.t === 'length' || r.t === 'radius' ? ` ${fmtN(r.v)}${r.ref ? ' (just showing)' : ''}` : ''}: ${sb.sideName(r.a)}${r.b ? ` & ${sb.sideName(r.b)}` : ''}`;
  };
}

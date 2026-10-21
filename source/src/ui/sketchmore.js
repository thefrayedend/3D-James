// Sketch board: Trim, Slot, Polygon, Offset, Pattern, helper line <-> drawn line, and importing DXF / SVG drawings.
// Installed on the board object `sb` by openSketch (sketch.js); everything shared lives on sb.
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import * as SG from '../sketchgeom.js';
import { crossings, nearest, pointAt, partBulge, exactBounds } from '../sketchcut.js';
import { readDxf, readSvg } from '../sketchimport.js';
import { bulgeOf } from '../sketchsolve.js';
import { app, saveSettings } from '../state.js';
import { h, toast, modal } from './dom.js';
import { EPS, fmtN, r3, svgEl } from './sketchkit.js';

const TAU = 2 * Math.PI;

export function installMore(sb) {
  // ---- the pieces of line on the board (for Trim): every side of every outline, line and helper line, and circles
  /** Side i of loop li as a piece ({A, B, b}); a circle: {c, r}. */
  sb.pieceOf = (li, i) => { const l = sb.loops[li]; if (l.type === 'circle') return { c: l.c, r: +l.r }; return { A: l.pts[i], B: l.pts[(i + 1) % l.pts.length], b: bulgeOf(l, i) }; };
  const allPieces = () => {
    const out = [];
    sb.loops.forEach((l, li) => { if (l.type === 'circle') out.push({ li, i: -1, s: sb.pieceOf(li, -1) }); else for (let i = 0; i < SG.sideCount(l); i++) out.push({ li, i, s: sb.pieceOf(li, i) }); });
    return out;
  };
  /** The piece under the pointer and the part of it between the lines that cross it (what Trim takes out). */
  sb.trimSpanAt = function trimSpanAt(raw) {
    const tol = (8 * sb.fat) / sb.view.s;
    let best = null;
    for (const p of allPieces()) { const n = nearest(p.s, raw); if (n.d < tol && (!best || n.d < best.d)) best = { ...p, t: n.t, d: n.d }; }
    if (!best) return null;
    // where every other line crosses it
    const ts = [];
    for (const o of allPieces()) {
      if (o.li === best.li && o.i === best.i) continue;
      for (const x of crossings(best.s, o.s)) ts.push(x.t);
    }
    const circle = best.i < 0, inner = [...new Set(ts.filter((t) => circle || (t > 1e-6 && t < 1 - 1e-6)).map((t) => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
    let t0 = 0, t1 = 1;
    if (circle) {
      if (inner.length < 2) return { ...best, t0: 0, t1: 1, whole: true, cuts: inner };
      const after = inner.find((t) => t > best.t), before = [...inner].reverse().find((t) => t <= best.t);
      t0 = before ?? inner[inner.length - 1] - 1; t1 = after ?? inner[0] + 1;
      return { ...best, t0, t1, whole: false, cuts: inner };
    }
    for (const t of inner) { if (t <= best.t) t0 = t; else { t1 = t; break; } }
    return { ...best, t0, t1, whole: t0 === 0 && t1 === 1, cuts: inner };
  };
  /** Points along a piece from t0 to t1 (for drawing it). */
  const spanPts = (s, t0, t1) => { const n = s.c || Math.abs(s.b || 0) > EPS ? 48 : 1, out = []; for (let k = 0; k <= n; k++) out.push(pointAt(s, t0 + ((t1 - t0) * k) / n)); return out; };
  /** Cut side i of loop li at these spots (0..1, sorted): new corners there. Returns how many were added. */
  sb.splitSide = function splitSide(li, i, ts) {
    const l = sb.loops[li], s = sb.pieceOf(li, i), b = bulgeOf(l, i), n = l.pts.length, m = ts.length;
    if (!m) return 0;
    const P = ts.map((t) => pointAt(s, t).map((v) => Math.round(v * 1e6) / 1e6)), cuts = [0, ...ts, 1];
    l.pts.splice(i + 1, 0, ...P);
    if (l.bulge || Math.abs(b) > EPS) {
      const bl = l.bulge ? l.bulge.slice() : new Array(n).fill(0);
      bl.splice(i, 1, ...cuts.slice(0, -1).map((t, k) => partBulge(b, t, cuts[k + 1])));
      l.bulge = bl.map((x) => Math.round(x * 1e9) / 1e9);
    }
    if (l.round) l.round.splice(i + 1, 0, ...P.map(() => 0));
    // rules on the cut side said something about the whole side: they go
    sb.remapRules(li, (k) => (k === i ? null : k > i ? k + m : k), (k) => (k > i ? k + m : k));
    return m;
  };
  /** Unfinished lines whose ends meet join up (and close into outlines). */
  sb.joinAllEnds = function joinAllEnds() {
    for (let guard = 0, again = true; again && guard < 500; guard++) {
      again = false;
      for (let li = 0; li < sb.loops.length; li++) {
        if (sb.loops[li].type !== 'open') continue;
        const before = sb.loops.length, type = sb.loops[li].type;
        sb.joinEnds(li);
        if (sb.loops.length !== before || sb.loops[li]?.type !== type) { again = true; break; }
      }
    }
  };
  /** Trim: take out the piece of line under the pointer, up to the lines that cross it. */
  sb.trimAt = function trimAt(raw) {
    const sp = sb.trimSpanAt(raw);
    if (!sp) return false;
    const l = sb.loops[sp.li];
    if (sb.isFrozen(sp.li)) { toast('That shape is frozen. Pick it and use Freeze again to unfreeze it first.', 'info', 3500); return false; }
    sb.remember();
    sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.picks = [];
    if (l.type === 'circle') {
      if (sp.whole) sb.removeLoop(sp.li);
      else {
        // what is left: an arc from the end of the piece round to its start, with a corner at every other crossing
        const a = sp.t1, e = sp.t0 + 1, stops = [a, ...sp.cuts.map((t) => (t < a ? t + 1 : t)).filter((t) => t > a + 1e-9 && t < e - 1e-9).sort((x, y) => x - y), e];
        const pts = [], bulge = [];
        for (let k = 0; k + 1 < stops.length; k++) {
          const sw = (stops[k + 1] - stops[k]) * TAU, parts = Math.max(1, Math.ceil(sw / Math.PI - 1e-9)); // at most a half turn per arc
          for (let j = 0; j < parts; j++) { pts.push(pointAt(sp.s, stops[k] + ((stops[k + 1] - stops[k]) * j) / parts)); bulge.push(Math.tan(sw / parts / 4)); }
        }
        pts.push(pointAt(sp.s, e)); bulge.push(0);
        const nl = { type: 'open', pts: pts.map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)), bulge: bulge.map((x) => Math.round(x * 1e9) / 1e9) };
        if (l.owner != null) nl.owner = l.owner;
        sb.removeLoop(sp.li); sb.loops.push(nl);
      }
    } else if (l.type === 'line') {
      // a helper line: what is left of it stays as one or two helper lines
      const [A, B] = l.pts, keep = [];
      if (sp.t0 > 1e-6) keep.push([A, pointAt(sp.s, sp.t0)]);
      if (sp.t1 < 1 - 1e-6) keep.push([pointAt(sp.s, sp.t1), B]);
      sb.removeLoop(sp.li);
      for (const [p, q] of keep) sb.loops.push({ type: 'line', pts: [p.map(r3), q.map(r3)], ...(l.owner != null ? { owner: l.owner } : {}) });
    } else {
      // a side of an outline or of an unfinished line: cut it where the lines cross, then take out the middle part
      const ts = [...(sp.t0 > 0 ? [sp.t0] : []), ...(sp.t1 < 1 ? [sp.t1] : [])];
      sb.splitSide(sp.li, sp.i, ts);
      const left = sb.cutSides(sp.li, new Set([sp.i + (sp.t0 > 0 ? 1 : 0)]));
      if (left != null) sb.joinAllEnds();
    }
    sb.trimHover = null;
    sb.draw();
    return true;
  };

  // ---- Slot and Polygon
  /** A slot (a rounded oblong) from center a to center b, w wide. */
  sb.slotLoop = function slotLoop(a, b, w) {
    const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(d[0], d[1]); if (L < 1e-6 || !(w > 0)) return null;
    const u = [d[0] / L, d[1] / L], n = [-u[1], u[0]], r = w / 2;
    const pts = [[a[0] - n[0] * r, a[1] - n[1] * r], [b[0] - n[0] * r, b[1] - n[1] * r], [b[0] + n[0] * r, b[1] + n[1] * r], [a[0] + n[0] * r, a[1] + n[1] * r]];
    return { type: 'poly', pts: pts.map((p) => p.map(r3)), bulge: [0, 1, 0, 1] };
  };
  sb.finishSlot = function finishSlot(a, b, w) {
    const l = sb.slotLoop(a, b, w); if (!l) return;
    sb.remember(); if (sb.owners) l.owner = sb.newOwner; sb.loops.push(l);
    const li = sb.loops.length - 1;
    // it stays a slot: the sides stay parallel and run smoothly into the round ends
    sb.rules.push({ t: 'parallel', a: { l: li, i: 0 }, b: { l: li, i: 2 } }, ...[0, 1, 2, 3].map((i) => ({ t: 'smooth', a: { l: li, i } })));
    sb.sel = li; sb.current = null; sb.autoMirror(); sb.settle(new Set());
  };
  sb.polySides = () => Math.max(3, Math.min(64, Math.round(+app.settings.skPolySides || 6)));
  /** A regular polygon around c with a corner at `corner`. */
  sb.polygonLoop = function polygonLoop(c, corner, n = sb.polySides()) {
    const R = Math.hypot(corner[0] - c[0], corner[1] - c[1]); if (R < 1e-6) return null;
    const a0 = Math.atan2(corner[1] - c[1], corner[0] - c[0]);
    // (corners to a millionth of a mm, so all the sides show the same length)
    return { type: 'poly', pts: Array.from({ length: n }, (_, k) => [c[0] + R * Math.cos(a0 + (TAU * k) / n), c[1] + R * Math.sin(a0 + (TAU * k) / n)].map((v) => Math.round(v * 1e6) / 1e6)) };
  };
  /** The corner for a polygon across flats F wide, with a flat side at the bottom. */
  sb.polygonCornerFlats = (c, F, n = sb.polySides()) => { const R = F / 2 / Math.cos(Math.PI / n), a = -Math.PI / 2 + Math.PI / n; return [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]; };
  /** The corner the pointer sets: the polygon turns in steps of 15° (so a flat side at the bottom is easy to hit). */
  sb.polygonCornerAt = (c, p) => { const R = Math.hypot(p[0] - c[0], p[1] - c[1]), st = Math.PI / 12, a = Math.round(Math.atan2(p[1] - c[1], p[0] - c[0]) / st) * st; return [c[0] + R * Math.cos(a), c[1] + R * Math.sin(a)]; };
  sb.finishPolygon = function finishPolygon(c, corner) {
    const l = sb.polygonLoop(c, corner); if (!l) return;
    sb.remember(); if (sb.owners) l.owner = sb.newOwner; sb.loops.push(l); sb.sel = sb.loops.length - 1; sb.current = null; sb.autoMirror();
  };
  const acrossFlats = (c, corner, n = sb.polySides()) => 2 * Math.hypot(corner[0] - c[0], corner[1] - c[1]) * Math.cos(Math.PI / n);

  /** Previews while drawing a slot or polygon, and the piece Trim would take out. */
  sb.drawMore = function drawMore(label) {
    const c = sb.cursor;
    if (sb.tool === 'trim' && sb.trimHover) {
      const sp = sb.trimHover;
      sb.svg.append(svgEl('path', { d: sb.pathOf(spanPts(sp.s, sp.t0, sp.t1), false), class: 'sk-trim' }));
    }
    if (!sb.current || !c) return;
    if (sb.current.type === 'slot') {
      const { a, b } = sb.current;
      if (!b) { const [x1, y1] = sb.toScreen(a), [x2, y2] = sb.toScreen(c); sb.svg.append(svgEl('line', { x1, y1, x2, y2, class: 'sk-draft' })); label(`${fmtN(Math.hypot(c[0] - a[0], c[1] - a[1]))} mm`, sb.toScreen(c)); return; }
      const w = 2 * slotHalf(a, b, c), l = sb.slotLoop(a, b, w);
      if (l) { sb.svg.append(svgEl('path', { d: sb.pathOf(SG.flattenLoop(l)), class: 'sk-draft' })); label(`${fmtN(w)} wide`, sb.toScreen(c)); }
    } else if (sb.current.type === 'polygon') {
      const corner = sb.polygonCornerAt(sb.current.c, c), l = sb.polygonLoop(sb.current.c, corner);
      if (l) { sb.svg.append(svgEl('path', { d: sb.pathOf(l.pts), class: 'sk-draft' })); label(`${sb.polySides()} sides · ${fmtN(acrossFlats(sb.current.c, corner))} across flats`, sb.toScreen(c)); }
    }
  };
  const slotHalf = (a, b, p) => { const d = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(...d) || 1; return Math.abs(((p[0] - a[0]) * d[1] - (p[1] - a[1]) * d[0]) / L); };
  /** A click with Slot or Polygon. True: handled. */
  sb.clickMore = function clickMore(q) {
    if (sb.tool === 'slot') {
      if (!sb.current) sb.current = { type: 'slot', a: q };
      else if (!sb.current.b) { if (Math.hypot(q[0] - sb.current.a[0], q[1] - sb.current.a[1]) > 1e-6) sb.current.b = q; }
      else { const w = 2 * slotHalf(sb.current.a, sb.current.b, q); if (w > 1e-6) sb.finishSlot(sb.current.a, sb.current.b, w); }
      return true;
    }
    if (sb.tool === 'polygon') {
      if (!sb.current) sb.current = { type: 'polygon', c: q };
      else sb.finishPolygon(sb.current.c, sb.polygonCornerAt(sb.current.c, q));
      return true;
    }
    return false;
  };
  /** Numbers typed with Slot or Polygon: true when used. */
  sb.typedMore = function typedMore(parts) {
    const c = sb.cursor;
    if (sb.tool === 'slot' && sb.current?.type === 'slot') {
      const { a } = sb.current;
      if (!sb.current.b) {
        // length (center to center), or length,width
        const p = c && Math.hypot(c[0] - a[0], c[1] - a[1]) > 1e-6 ? c : [a[0] + 1, a[1]], L = Math.hypot(p[0] - a[0], p[1] - a[1]);
        const b = [r3(a[0] + ((p[0] - a[0]) / L) * parts[0]), r3(a[1] + ((p[1] - a[1]) / L) * parts[0])];
        if (parts.length >= 2) sb.finishSlot(a, b, parts[1]); else sb.current.b = b;
      } else sb.finishSlot(a, sb.current.b, parts[0]);
      return true;
    }
    if (sb.tool === 'polygon' && sb.current?.type === 'polygon') { if (parts[0] > 0) sb.finishPolygon(sb.current.c, sb.polygonCornerFlats(sb.current.c, parts[0])); return true; }
    return false;
  };
  /** The Polygon box on the right: how many sides. */
  sb.polygonPanel = function polygonPanel(btn, numIn) {
    const n = sb.polySides(), set = (v) => { app.settings.skPolySides = Math.max(3, Math.min(64, Math.round(v))); saveSettings(); sb.draw(); };
    return h('div', { class: 'sk-item sel' }, h('div', { class: 'sk-item-h' }, h('b', {}, 'Polygon')),
      h('div', { class: 'sk-row two' }, h('span', {}, 'Sides'), numIn(n, set, { title: 'How many sides (3 to 64)' })),
      h('div', { class: 'chip-row' }, ...[3, 4, 5, 6, 8, 12].map((v) => btn(String(v), () => set(v), `${v} sides`, n === v))),
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-top:6px' }, 'Click the center, then a corner (it turns in 15° steps). Or type the size across flats + Enter: a flat side goes at the bottom (a nut that size fits a wrench that size).'));
  };

  // ---- helper line <-> drawn line
  /** Make sides (or a whole outline) helper lines: guides that never become solid. Arcs can't be helper lines. */
  sb.makeHelper = function makeHelper(li, sides) {
    const l = sb.loops[li]; if (!sb.hasSides(l)) return;
    if (sb.isFrozen(li)) return toast('That shape is frozen. Unfreeze it first.', 'info', 3000);
    const S = sides ? [...sides] : [...Array(SG.sideCount(l)).keys()];
    if (S.some((i) => bulgeOf(l, i))) return toast('Helper lines are straight: an arc can’t become one. Pick straight sides.', 'info', 4000);
    if (!sides && l.round?.some((r) => +r > 0)) return toast('This shape has rounded corners: make them sharp first (Round all 0).', 'info', 4000);
    sb.remember();
    const lines = S.map((i) => ({ type: 'line', pts: [l.pts[i].slice(), l.pts[(i + 1) % l.pts.length].slice()], ...(l.owner != null ? { owner: l.owner } : {}) }));
    if (!sides || (l.type === 'poly' && S.length >= l.pts.length)) sb.removeLoop(li);
    else { const left = sb.cutSides(li, new Set(S)); if (left != null) sb.joinAllEnds(); }
    sb.loops.push(...lines);
    sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.picks = [];
    toast(`${lines.length === 1 ? 'It is now a helper line' : `${lines.length} helper lines`}: a guide that never becomes solid.`, 'info', 3000);
    sb.draw();
  };
  /** A helper line becomes a drawn line (it joins up with lines whose ends meet it). */
  sb.makeDrawn = function makeDrawn(li) {
    const l = sb.loops[li]; if (l?.type !== 'line') return;
    sb.remember();
    // its rules stay (a helper line's points and side are numbered the same as a two-point line's)
    l.type = 'open';
    sb.sel = sb.joinEnds(li); sb.selEdge = null; sb.selCorner = null; sb.picks = [];
    toast(sb.loops[sb.sel]?.type === 'poly' ? 'Now a drawn line: it closed an outline.' : 'Now a drawn line (orange ends: join them up to close an outline).', 'info', 3000);
    sb.draw();
  };

  // ---- the shapes Offset and Pattern work on: the picked shapes (Shift+click for more), else the picked one
  sb.pickedShapes = function pickedShapes() {
    const ls = [...new Set(sb.picks.filter((p) => p.shape || p.circle).map((p) => p.l))];
    if (sb.sel != null && !ls.includes(sb.sel)) ls.push(sb.sel);
    return ls.filter((i) => sb.loops[i]);
  };

  // ---- Offset: a copy of an outline, bigger or smaller all round (walls, clearances)
  sb.offsetBusy = false;
  sb.offset = async function offset(idx, dist, corners = 'sharp', keep = true) {
    if (sb.offsetBusy) return;
    const ls = idx.filter((i) => SG.isSolidLoop(sb.loops[i]));
    if (!ls.length) return toast('Pick a closed outline or a circle first. (Unfinished lines and helper lines can’t be offset.)', 'info', 4000);
    if (!(Math.abs(dist) > 1e-6)) return;
    sb.offsetBusy = true;
    let res;
    try {
      const { workerCall } = await import('../build.js');
      const strip = (l) => { const c = JSON.parse(JSON.stringify(l)); delete c.owner; return c; };
      res = (await workerCall({ type: 'offsetLoops', loops: ls.map((i) => strip(sb.loops[i])), dist, corners })).loops || [];
    } catch (err) { sb.offsetBusy = false; return toast('Could not offset: ' + (err?.message || err), 'err', 5000); }
    sb.offsetBusy = false;
    if (!sb.root.isConnected) return;
    const made = res.flat();
    if (!made.length) return toast(`Nothing is left: the outline is less than ${fmtN(2 * Math.abs(dist))} mm across. Try a smaller distance.`, 'info', 4500);
    sb.remember();
    const owners = ls.map((i, k) => res[k].map(() => sb.loops[i].owner));
    if (!keep) for (const i of ls.slice().sort((a, b) => b - a)) sb.removeLoop(i);
    made.forEach((l, k) => { const o = owners.flat()[k]; if (sb.owners) l.owner = o ?? sb.newOwner; sb.loops.push(l); });
    sb.sel = sb.loops.length - 1; sb.selEdge = null; sb.selCorner = null; sb.picks = [];
    toast(`Offset ${dist > 0 ? 'outward' : 'inward'} by ${fmtN(Math.abs(dist))} mm.`, 'info', 2500);
    sb.draw();
  };
  sb.askOffset = function askOffset() {
    const idx = sb.pickedShapes().filter((i) => SG.isSolidLoop(sb.loops[i]));
    if (!idx.length) return toast('Pick a closed outline or a circle first (Select tool, click inside it).', 'info', 3500);
    const S = app.settings.skOffset || {};
    let out = S.out !== false, round = !!S.round, keep = S.keep !== false;
    const dIn = h('input', { class: 'in', value: fmtN(S.d > 0 ? S.d : 2), style: 'font-family:var(--ui)' });
    const seg = (opts, get, set) => h('div', { class: 'seg' }, ...opts.map(([v, label, tip]) => { const b = h('button', { class: get() === v ? 'on' : '', title: tip, onclick: () => { set(v); for (const x of b.parentNode.children) x.classList.toggle('on', x === b); } }, label); return b; }));
    const go = () => {
      const d = parseFloat(dIn.value); if (!(d > 0)) { toast('Type a distance above 0.'); return false; }
      app.settings.skOffset = { d, out, round, keep }; saveSettings();
      sb.offset(idx, out ? d : -d, round ? 'round' : 'sharp', keep); return true;
    };
    const close = modal('Offset', [
      h('div', { class: 'muted', style: 'margin-bottom:8px' }, `A copy of ${idx.length === 1 ? 'the picked outline' : `the ${idx.length} picked outlines`}, bigger or smaller by the same distance all round. Inside: a wall that thick. Outside: room around a part.`),
      h('div', { class: 'field' }, h('label', { class: 'plain' }, 'Distance (mm)'), dIn),
      h('div', { class: 'ask-group' }, h('div', { class: 'ask-label' }, 'Where'), seg([[true, 'Outside (bigger)', 'The copy is bigger, around the outline'], [false, 'Inside (smaller)', 'The copy is smaller, inside the outline (with the original: a wall)']], () => out, (v) => { out = v; })),
      h('div', { class: 'ask-group' }, h('div', { class: 'ask-label' }, 'Corners'), seg([[false, 'Sharp', 'Corners stay sharp corners'], [true, 'Round', 'Corners going outward become arcs: the copy is the same distance away everywhere']], () => round, (v) => { round = v; })),
      h('div', { class: 'ask-group' }, h('div', { class: 'ask-label' }, 'The original'), seg([[true, 'Keep it', 'Keep the outline too (for a wall: the outline and its offset)'], [false, 'Replace it', 'Only the offset copy stays']], () => keep, (v) => { keep = v; }))],
    (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (go()) done(); } }, 'Offset')]);
    dIn.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && go()) close(); });
    setTimeout(() => { dIn.focus(); dIn.select(); }, 0);
  };

  // ---- Pattern: copies in a row or around the center of the sketch
  /** Copies of loop l moved by d and turned by a (radians) around the center of the sketch. */
  const movedCopy = (l, d, a) => {
    const cs = Math.cos(a), sn = Math.sin(a), T = (p) => [r3(cs * p[0] - sn * p[1] + d[0]), r3(sn * p[0] + cs * p[1] + d[1])];
    const c = JSON.parse(JSON.stringify(l));
    if (c.type === 'circle') c.c = T(c.c); else c.pts = c.pts.map(T);
    return c;
  };
  sb.pattern = function pattern(idx, o) {
    const ls = idx.filter((i) => sb.loops[i]); if (!ls.length) return toast('Pick a shape first (Select tool, click inside it).', 'info', 3000);
    const n = Math.max(2, Math.min(200, Math.round(o.count))); if (!Number.isFinite(n)) return;
    sb.remember();
    const src = ls.map((i) => sb.loops[i]), added = [];
    for (let k = 1; k < n; k++) {
      let d = [0, 0], a = 0;
      if (o.kind === 'row') d = [o.dx * k, o.dy * k];
      else { const all = Math.abs(Math.abs(o.angle) - 360) < 1e-9; a = ((all ? 360 / n : o.angle / (n - 1)) * k * Math.PI) / 180; }
      for (const l of src) added.push(movedCopy(l, d, a));
    }
    sb.loops.push(...added);
    sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.picks = [];
    sb.joinAllEnds();
    toast(`${n} in all (${added.length} cop${added.length === 1 ? 'y' : 'ies'} added).`, 'info', 2500);
    sb.draw();
  };
  sb.askPattern = function askPattern() {
    const idx = sb.pickedShapes();
    if (!idx.length) return toast('Pick a shape first (Select tool, click inside it or on it). Shift+click to pick more.', 'info', 3500);
    const S = app.settings.skPattern || {};
    let kind = S.kind === 'circle' ? 'circle' : 'row';
    const inp = (v) => h('input', { class: 'in', value: fmtN(v), style: 'font-family:var(--ui)' });
    const nIn = inp(S.count > 1 ? S.count : 4), dxIn = inp(S.dx ?? 20), dyIn = inp(S.dy ?? 0), aIn = inp(S.angle ?? 360);
    const rowBox = h('div', {}, h('div', { class: 'field' }, h('label', { class: 'plain' }, 'Step left-right (mm)'), dxIn), h('div', { class: 'field' }, h('label', { class: 'plain' }, 'Step up-down (mm)'), dyIn));
    const circBox = h('div', {}, h('div', { class: 'field' }, h('label', { class: 'plain' }, 'Turn (degrees, 360 = evenly all the way round)'), aIn),
      h('div', { class: 'muted', style: 'font-size:12px' }, 'Turns around the center of the sketch (where the red and green lines cross).'));
    const upd = () => { rowBox.hidden = kind !== 'row'; circBox.hidden = kind !== 'circle'; };
    const seg = h('div', { class: 'seg' }, ...[['row', 'In a row', 'Copies one step apart, in a line'], ['circle', 'In a circle', 'Copies around the center of the sketch']].map(([v, label, tip]) => {
      const b = h('button', { class: kind === v ? 'on' : '', title: tip, onclick: () => { kind = v; for (const x of b.parentNode.children) x.classList.toggle('on', x === b); upd(); } }, label); return b;
    }));
    const go = () => {
      const o = { kind, count: parseFloat(nIn.value), dx: parseFloat(dxIn.value) || 0, dy: parseFloat(dyIn.value) || 0, angle: parseFloat(aIn.value) };
      if (!(o.count >= 2)) { toast('How many in all: at least 2.'); return false; }
      if (kind === 'row' && !o.dx && !o.dy) { toast('Type a step: how far apart the copies are.'); return false; }
      if (kind === 'circle' && !(Math.abs(o.angle) > 0 && Math.abs(o.angle) <= 360)) { toast('Type a turn between 1 and 360 degrees.'); return false; }
      app.settings.skPattern = o; saveSettings();
      sb.pattern(idx, o); return true;
    };
    const close = modal('Pattern', [
      h('div', { class: 'muted', style: 'margin-bottom:8px' }, `Copies of ${idx.length === 1 ? 'the picked shape' : `the ${idx.length} picked shapes`}: a row of holes, bolt holes around a flange.`),
      h('div', { class: 'ask-group' }, h('div', { class: 'ask-label' }, 'How'), seg),
      h('div', { class: 'field' }, h('label', { class: 'plain' }, 'How many in all (with the original)'), nIn), rowBox, circBox],
    (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn primary', onclick: () => { if (go()) done(); } }, 'Make copies')]);
    for (const x of [nIn, dxIn, dyIn, aIn]) x.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && go()) close(); });
    upd(); setTimeout(() => { nIn.focus(); nIn.select(); }, 0);
  };

  // ---- importing a DXF or SVG drawing
  /** Add a drawing's lines to the board. place: 'center' (its middle on the center of the sketch) or 'keep'. */
  sb.addImported = function addImported(loops, place = 'center') {
    if (!loops.length) return 0;
    // the middle to a hundredth of a mm (round numbers stay round)
    const b = exactBounds(loops), d = place === 'center' ? [-Math.round(((b[0] + b[2]) / 2) * 100) / 100, -Math.round(((b[1] + b[3]) / 2) * 100) / 100] : [0, 0];
    const mv = (p) => [Math.round((p[0] + d[0]) * 1e6) / 1e6, Math.round((p[1] + d[1]) * 1e6) / 1e6];
    sb.remember();
    for (const l of loops) { const c = JSON.parse(JSON.stringify(l)); if (c.type === 'circle') c.c = mv(c.c); else c.pts = c.pts.map(mv); if (sb.owners) c.owner = sb.newOwner; sb.loops.push(c); }
    sb.joinAllEnds();
    sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.picks = [];
    sb.fit();
    return loops.length;
  };
  /** Read a file's text as a drawing: { loops, skipped }. */
  sb.readDrawing = (name, text) => (/\.svg$/i.test(name) || /^\s*(<\?xml|<svg)/i.test(text) ? readSvg(text, SVGLoader) : readDxf(text));
  /** Import a drawing (name + text): asks where to put it. */
  sb.importText = function importText(name, text) {
    let res;
    try { res = sb.readDrawing(name, text); } catch (err) { return toast(err.message || String(err), 'err', 6000); }
    if (!res.loops.length) return toast('Nothing to import: no lines, arcs or circles found in this drawing.', 'err', 5000);
    const b = exactBounds(res.loops), w = b[2] - b[0], hh = b[3] - b[1];
    const nC = res.loops.filter((l) => l.type === 'circle').length;
    modal('Import a drawing', [
      h('p', {}, h('b', {}, name)),
      h('p', {}, `${res.loops.length - nC} line${res.loops.length - nC === 1 ? '' : 's'} / outline${res.loops.length - nC === 1 ? '' : 's'}${nC ? ` and ${nC} circle${nC === 1 ? '' : 's'}` : ''}, ${fmtN(w)} × ${fmtN(hh)} mm.`),
      ...(res.skipped ? [h('p', { class: 'muted' }, `${res.skipped} thing${res.skipped === 1 ? '' : 's'} left out (text, hatching, dimensions or pictures).`)] : []),
      h('p', { class: 'muted' }, 'Lines whose ends meet join into closed outlines; the rest stay unfinished lines (orange ends) you can join up. Wrong size? The file may be in other units: use Measure and scale it in your drawing program.')],
    (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'),
      h('button', { class: 'btn', title: 'Keep the positions in the file (0,0 of the drawing on the center of the sketch)', onclick: () => { done(); sb.addImported(res.loops, 'keep'); report(); } }, 'Keep its position'),
      h('button', { class: 'btn primary', title: 'Put the middle of the drawing on the center of the sketch', onclick: () => { done(); sb.addImported(res.loops, 'center'); report(); } }, 'Put it in the middle')]);
    const report = () => { const open = sb.loops.filter((l) => l.type === 'open').length; toast(`Imported ${name}.${open ? ` ${open} unfinished line${open === 1 ? '' : 's'}: join the orange ends (or Join close ends).` : ''}`, 'info', 4500); };
  };
  /** The Import button: pick a DXF or SVG file. */
  sb.importFile = function importFile() {
    const inp = h('input', { type: 'file', accept: '.dxf,.svg,image/svg+xml,application/dxf', style: 'display:none' });
    inp.addEventListener('change', async () => { const f = inp.files?.[0]; inp.remove(); if (f) sb.importText(f.name, await f.text()); });
    document.body.append(inp); inp.click();
  };
}

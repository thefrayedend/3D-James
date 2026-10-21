// Sketch board: changing the drawing (sizes, rules, points, sides, unfinished lines joining up, the Rules row, merging).
// Installed on the board object `sb` by openSketch (sketch.js); everything shared lives on sb.
import { ORIGIN, POINT_RULES, angleNow, bulgeOf, isCircleRef, pointOf, radiusOf, rot, ruleRefs, solveRules, valueNow } from '../sketchsolve.js';
import * as SG from '../sketchgeom.js';
import { h, toast } from './dom.js';
import { JOIN_TOL, VALUE_RULES, fmtN, r3, samePt } from './sketchkit.js';

export function installEdit(sb) {

  // ---- changing things (rules keep holding afterwards)
  sb.edgeLen = (l, i) => { const A = l.pts[i], B = l.pts[(i + 1) % l.pts.length]; return Math.hypot(B[0] - A[0], B[1] - A[1]); };
  sb.edgeDir = (l, i) => { const A = l.pts[i], B = l.pts[(i + 1) % l.pts.length], L = sb.edgeLen(l, i) || 1; return [(B[0] - A[0]) / L, (B[1] - A[1]) / L]; };
  /** Make every rule hold again. The locked starting point stays put, unless a rule you set says it has to move. */
  sb.settle = function settle(fixed) {
    if (!sb.rules.length) return;
    const before = JSON.stringify(sb.loops);
    if (solveRules(sb.loops, sb.rules, fixed)) return;
    if (sb.rules.some((r) => r.t === 'anchor' && !r.off)) {
      sb.restoreLoops(JSON.parse(before));
      if (solveRules(sb.loops, sb.rules, fixed, { noAnchor: true })) return;
    }
    toast('Those rules fight each other. Remove one (Rules, on the right), or press Undo.', 'err', 4500);
  };
  /** Put saved numbers back into the same loops (other code holds on to the point arrays, so they are kept). */
  sb.restoreLoops = function restoreLoops(saved) {
    saved.forEach((s, i) => {
      const l = sb.loops[i]; if (!l) return;
      if (l.type === 'circle') { l.c[0] = s.c[0]; l.c[1] = s.c[1]; l.r = s.r; return; }
      s.pts.forEach((p, k) => { if (l.pts[k]) { l.pts[k][0] = p[0]; l.pts[k][1] = p[1]; } });
      if (s.bulge) l.bulge = s.bulge; else delete l.bulge;
    });
  };
  /** The first point you clicked stays where it is while rules move other things (so the drawing never wanders off). */
  sb.ensureAnchor = function ensureAnchor() {
    if (sb.rules.some((r) => r.t === 'anchor')) return;
    const li = sb.loops.findIndex((l) => l.type !== 'line'); if (li < 0) return;
    sb.rules.unshift({ t: 'anchor', p: { l: li, k: 0 } });
  };
  sb.anchorRule = () => sb.rules.find((r) => r.t === 'anchor');
  sb.toggleAnchor = function toggleAnchor() { const r = sb.anchorRule(); if (!r) return; sb.remember(); if (r.off) delete r.off; else r.off = 1; sb.draw(); };
  sb.isFrozen = (li) => sb.rules.some((r) => r.t === 'freeze' && r.a.l === li);
  /** New length for a side. With no rules the shape stretches: points beyond its end move along. Typing a length
   *  makes it a rule (it stays that long). */
  sb.setLength = function setLength(li, i, L, keep) {
    const l = sb.loops[li]; const A = l.pts[i], cur = sb.edgeLen(l, i); if (cur < 1e-9 || !(L > 0)) return;
    const u = sb.edgeDir(l, i), delta = L - cur;
    for (const p of l.pts) {
      if (p === A) continue;
      const t = (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1];
      if (t >= cur - 1e-6) { p[0] = r3(p[0] + u[0] * delta); p[1] = r3(p[1] + u[1] * delta); }
    }
    if (keep) { sb.rules = sb.rules.filter((r) => !(r.t === 'length' && r.a?.l === li && r.a?.i === i)); sb.rules.push({ t: 'length', a: { l: li, i }, v: r3(L) }); }
    sb.settle(new Set([A]));
  };
  sb.setBulge = function setBulge(l, i, b) {
    if (!l.bulge) l.bulge = l.pts.map(() => 0);
    l.bulge[i] = Math.abs(b) < 1e-6 ? 0 : Math.round(b * 1e6) / 1e6;
    if (l.bulge.every((x) => !x)) delete l.bulge;
    else if (l.round) { const n = l.pts.length; if (l.round[i]) l.round[i] = 0; if (l.round[(i + 1) % n]) l.round[(i + 1) % n] = 0; }
  };
  /** A typed radius for an arc: it stays (a rule). */
  sb.setRadius = function setRadius(li, i, R) {
    const l = sb.loops[li], A = l.pts[i], B = l.pts[(i + 1) % l.pts.length], b = bulgeOf(l, i);
    if (!(R > 0)) return;
    const nb = SG.bulgeForRadius(A, B, b, R); if (nb != null) sb.setBulge(l, i, nb);
    sb.rules = sb.rules.filter((r) => !(r.t === 'radius' && r.a?.l === li && r.a?.i === i)); sb.rules.push({ t: 'radius', a: { l: li, i }, v: r3(R) });
    sb.settle(new Set([A]));
  };
  /** The arc and the straight side meeting at this corner join without a bump, and keep doing so. */
  sb.smoothJoin = function smoothJoin(li, k) {
    const l = sb.loops[li], n = l.pts.length;
    if (!bulgeOf(l, k) && !bulgeOf(l, (k - 1 + n) % n)) return toast('Smooth join is for a corner where an arc meets another side. Bend one of the sides first.');
    sb.remember(); sb.rules = sb.rules.filter((r) => !(r.t === 'smooth' && r.a?.l === li && r.a?.i === k)); sb.rules.push({ t: 'smooth', a: { l: li, i: k } });
    sb.settle(new Set([l.pts[k]])); sb.draw();
  };
  // ---- helper lines stay attached to what they were snapped onto
  sb.attachRule = function attachRule(pref, info) {
    if (!info) return null;
    if ((info.kind === 'corner' || info.kind === 'center') && info.ref) return { t: 'same', p: pref, q: { ...info.ref }, auto: 1 };
    if (info.pinAt) return { t: 'pin', p: pref, v: [r3(info.pinAt[0]), r3(info.pinAt[1])], auto: 1 };
    if (info.kind === 'middle' && info.side) return { t: 'mid', p: pref, a: { ...info.side }, auto: 1 };
    if (info.kind === 'edge' && info.line) return { t: 'on', p: pref, a: info.line.fixed ? { fixed: info.line.fixed.map((q) => [q[0], q[1]]) } : { ...info.line }, auto: 1 };
    return null;
  };
  /** Forget what a helper line (or one end of it) was attached to: it is being moved somewhere else. */
  sb.dropAuto = function dropAuto(li, k) { sb.rules = sb.rules.filter((r) => !(r.auto && ruleRefs(r).pts.some((x) => x && !x.o && x.l === li && (k == null || x.k === k)))); };
  sb.attach = function attach(li, k, info) { const r = sb.attachRule({ l: li, k }, info); if (r) sb.rules.push(r); };
  /** Turn the whole drawing so this line is exactly level (or upright, whichever is closer). */
  sb.straighten = function straighten(li, i) {
    const l = sb.loops[li], A = l.pts[i], B = l.pts[(i + 1) % l.pts.length];
    const ang = Math.atan2(B[1] - A[1], B[0] - A[0]), target = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2), da = target - ang;
    if (Math.abs(da) < 1e-9) return toast('That line is already straight.');
    sb.remember();
    const c = [A[0], A[1]], turn = (p) => { const q = rot([p[0] - c[0], p[1] - c[1]], da); p[0] = r3(c[0] + q[0]); p[1] = r3(c[1] + q[1]); };
    for (const L of sb.loops) for (const p of L.type === 'circle' ? [L.c] : L.pts) turn(p);
    for (const r of sb.rules) if (r.t === 'pin') turn(r.v);
    sb.rebaseOriginRules();
    sb.settle(new Set()); sb.draw();
  };
  /** Rules measured from the center of the sketch would pull the drawing back after it is moved or turned:
   *  make them match where things are now. */
  sb.rebaseOriginRules = function rebaseOriginRules() {
    for (const r of sb.rules) {
      if (!POINT_RULES.has(r.t) || !(r.p.o || r.q.o)) continue;
      const P = pointOf(sb.loops, r.p), Q = pointOf(sb.loops, r.q);
      r.v = r3(r.t === 'dx' ? Q[0] - P[0] : r.t === 'dy' ? Q[1] - P[1] : Math.hypot(Q[0] - P[0], Q[1] - P[1]));
    }
  };
  /** Slide the whole drawing (everything moves together; its own rules are untouched). */
  sb.slideAll = function slideAll(d) {
    if (!d[0] && !d[1]) return;
    sb.remember();
    for (const L of sb.loops) for (const q of L.type === 'circle' ? [L.c] : L.pts) { q[0] = r3(q[0] + d[0]); q[1] = r3(q[1] + d[1]); }
    for (const r of sb.rules) if (r.t === 'pin') { r.v[0] = r3(r.v[0] + d[0]); r.v[1] = r3(r.v[1] + d[1]); }
    sb.rebaseOriginRules();
    sb.settle(new Set()); sb.draw();
  };
  /** Slide the whole drawing so this point sits on the center of the sketch. */
  sb.moveToCenter = function moveToCenter(p) { sb.slideAll([-p[0], -p[1]]); };
  /** For Spin around: slide the drawing sideways so it sits just right of the green line, touching it. */
  sb.toGreenLine = function toGreenLine() {
    const solid = sb.loops.filter(SG.isSolidLoop); if (!solid.length) return;
    const b = SG.loopsBounds(solid); sb.slideAll([-b[0], 0]);
  };
  sb.togglePin = function togglePin(li, k) {
    sb.remember();
    const i = sb.rules.findIndex((r) => r.t === 'pin' && !r.p.o && r.p.l === li && r.p.k === k);
    if (i >= 0) sb.rules.splice(i, 1);
    else { const P = pointOf(sb.loops, { l: li, k }); sb.rules.push({ t: 'pin', p: { l: li, k }, v: [P[0], P[1]] }); }
    sb.draw();
  };
  /** The point (corner, circle center, helper line end, or the center of the sketch) under the mouse, as a ref. */
  sb.pointRefAt = function pointRefAt(e) {
    let best = null, bd = 10 * sb.fat;
    sb.loops.forEach((l, li) => {
      const pts = l.type === 'circle' ? [l.c] : l.pts;
      pts.forEach((p, k) => { const d = sb.screenDist(p, e); if (d < bd) { bd = d; best = l.type === 'circle' ? { l: li, k: 0 } : { l: li, k }; } });
    });
    if (!best && sb.screenDist(ORIGIN, e) < 10) best = { o: 1 };
    return best;
  };
  /** After two points are picked: the three distances between them, each one click away from being set. */
  sb.measureChoose = function measureChoose(p, q) {
    const P = pointOf(sb.loops, p), Q = pointOf(sb.loops, q);
    sb.canvas.querySelector('.sk-mchoose')?.remove();
    const [x, y] = sb.toScreen([(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2]);
    const dx = Q[0] - P[0], dy = Q[1] - P[1], d = Math.hypot(dx, dy);
    const pick = (t, cur) => () => {
      box.remove();
      sb.askNumber(x, y, Math.abs(cur), (v) => {
        if (v < 0 || (t === 'dist' && !(v > 0))) return;
        sb.rules = sb.rules.filter((r) => !(r.t === t && sb.sameRef(r.p, p) && sb.sameRef(r.q, q)));
        sb.rules.push({ t, p: { ...p }, q: { ...q }, v: r3((Math.sign(cur) || 1) * v) });
        sb.settle(new Set());
      });
    };
    const box = h('div', { class: 'sk-mchoose', style: `left:${x}px;top:${y}px` },
      h('div', { class: 'muted' }, 'Click the one to set:'),
      h('button', { class: 'chip', onclick: pick('dx', dx), title: 'Distance left-right' }, `↔ ${fmtN(Math.abs(dx))}`),
      h('button', { class: 'chip', onclick: pick('dy', dy), title: 'Distance up-down' }, `↕ ${fmtN(Math.abs(dy))}`),
      h('button', { class: 'chip', onclick: pick('dist', d), title: 'Straight-line distance' }, `⟋ ${fmtN(d)}`),
      h('button', { class: 'chip', onclick: () => box.remove(), title: 'Just looking' }, '✕'));
    sb.canvas.append(box);
  };
  sb.sameRef = (a, b) => (a.o && b.o) || (!a.o && !b.o && a.l === b.l && a.k === b.k);
  sb.setRound = function setRound(l, i, r) {
    const n = l.pts.length;
    if (r > 0 && (+(l.bulge?.[i] || 0) || +(l.bulge?.[(i - 1 + n) % n] || 0))) return toast('A corner next to a curved side cannot be rounded.');
    if (!l.round) l.round = l.pts.map(() => 0);
    l.round[i] = r > 0 ? r3(r) : 0;
    if (l.round.every((x) => !x)) delete l.round;
  };
  sb.addRule = function addRule(t, a, b) {
    sb.remember();
    sb.rules = sb.rules.filter((r) => !(r.t === t && r.a?.l === a.l && r.a?.i === a.i && (!b || (r.b && r.b.l === b.l && r.b.i === b.i))));
    // a side cannot be both flat and upright, or flat and square to a flat side…: the solver will say so
    sb.rules.push(b ? { t, a: { ...a }, b: { ...b } } : { t, a: { ...a } });
    const l = sb.loops[a.l]; sb.settle(new Set([l.pts[a.i]]));
    sb.draw();
  };
  sb.lineOp = function lineOp(op, other) {
    if (!sb.selEdge) return;
    if (op === 'flat' || op === 'upright') return sb.addRule(op, sb.selEdge);
    if (other) {
      if (other.l === sb.selEdge.l && other.i === sb.selEdge.i) return toast('Pick a different line.');
      sb.addRule(op, sb.selEdge, other);
    }
  };
  sb.removeRule = function removeRule(k) { sb.remember(); sb.rules.splice(k, 1); sb.draw(); };
  /**
   * Visit every reference to a loop in every rule: fn(x, kind) may change x in place (kind: 'pt' {l, k}, 'side' {l, i},
   * 'corner' {l, i} or 'whole' {l}); returning false drops the rule. The one place rules are renumbered.
   */
  sb.eachRef = function eachRef(fn) {
    sb.rules = sb.rules.filter((r) => {
      const R = ruleRefs(r);
      for (const [list, kind] of [[R.pts, 'pt'], [R.sides, 'side'], [R.corners || [], 'corner'], [R.whole || [], 'whole']]) {
        for (const x of list) { if (!x || x.o || x.fixed) continue; if (fn(x, kind) === false) return false; }
      }
      return true;
    });
  };
  /** After points are added to or taken from loop li: map(side) and pmap(point) give the new numbers (null: gone). */
  sb.remapRules = function remapRules(li, map, pmap, cmap = pmap) {
    sb.eachRef((x, kind) => {
      if (x.l !== li) return;
      if (kind === 'pt') { if (sb.loops[li]?.type === 'circle') return; const j = pmap ? pmap(x.k) : x.k; if (j == null) return false; x.k = j; }
      else if (kind === 'corner') { if (!cmap) return; const j = cmap(x.i); if (j == null) return false; x.i = j; }
      else if (kind === 'side') { const j = map(x.i); if (j == null) return false; x.i = j; }
    });
  };
  /** Loop li goes away: rules on it go too, and the loops after it move up one. */
  sb.dropLoopRules = function dropLoopRules(li) {
    sb.eachRef((x) => (x.l === li ? false : undefined));
    sb.eachRef((x) => { if (x.l > li) x.l--; });
  };
  sb.removeLoop = function removeLoop(li) { sb.dropLoopRules(li); sb.loops.splice(li, 1); };

  // ---- unfinished (open) lines: they join end to end, and close into an outline when their two ends meet
  /** Run an open line the other way round (its rules follow). */
  sb.reverseOpen = function reverseOpen(li) {
    const l = sb.loops[li], n = l.pts.length;
    l.pts.reverse();
    if (l.bulge) { const b = l.bulge; l.bulge = l.pts.map((_, i) => (i < n - 1 ? -(+(b[n - 2 - i] || 0)) : 0)); }
    if (l.round) l.round.reverse();
    sb.remapRules(li, (i) => n - 2 - i, (k) => n - 1 - k);
  };
  /** Line b starts where line a ends: b is added onto the end of a and goes away. Returns a's new number. */
  sb.appendOpen = function appendOpen(a, b) {
    const A = sb.loops[a], B = sb.loops[b], nA = A.pts.length;
    const bulge = [...A.pts.slice(0, -1).map((_, i) => bulgeOf(A, i)), ...B.pts.slice(0, -1).map((_, i) => bulgeOf(B, i)), 0];
    const round = A.round || B.round ? [...A.pts.map((_, i) => +(A.round?.[i] || 0)), ...B.pts.slice(1).map((_, i) => +(B.round?.[i + 1] || 0))] : null;
    A.pts = A.pts.concat(B.pts.slice(1));
    if (bulge.some((x) => x)) A.bulge = bulge; else delete A.bulge;
    if (round?.some((x) => x)) A.round = round; else delete A.round;
    sb.eachRef((x, kind) => { if (x.l !== b) return; x.l = a; if (kind === 'pt') x.k += nA - 1; else if (kind === 'side' || kind === 'corner') x.i += nA - 1; });
    // a rule joining the two ends that are now one point says nothing any more
    sb.rules = sb.rules.filter((r) => !(r.t === 'same' && !r.p.o && !r.q.o && r.p.l === r.q.l && r.p.k === r.q.k));
    sb.loops.splice(b, 1);
    sb.eachRef((x) => { if (x.l > b) x.l--; });
    return a > b ? a - 1 : a;
  };
  /** An open line whose two ends meet becomes a closed outline (false when it is too small to be one). */
  sb.closeOpen = function closeOpen(li) {
    const l = sb.loops[li], n = l.pts.length, m = n - 1;
    const bulge = l.pts.slice(0, m).map((_, i) => bulgeOf(l, i));
    if (!(m >= 3 || (m === 2 && bulge.some((x) => x)))) return false;
    l.type = 'poly'; l.pts = l.pts.slice(0, m);
    if (bulge.some((x) => x)) l.bulge = bulge; else delete l.bulge;
    if (l.round) { l.round = l.round.slice(0, m); l.round[0] = 0; if (!l.round.some((x) => +x)) delete l.round; }
    sb.remapRules(li, (i) => i, (k) => (k === m ? 0 : k));
    return true;
  };
  /**
   * Tidy up after an open line was drawn or changed: its ends join the ends of other open lines (one longer line,
   * whichever sketch they came from), and once its two ends meet it closes into an outline. Returns its new number.
   */
  sb.joinEnds = function joinEnds(li) {
    for (let guard = 0; guard < 200 && sb.loops[li]?.type === 'open'; guard++) {
      const l = sb.loops[li], last = () => l.pts[l.pts.length - 1];
      if (l.pts.length > 2 && samePt(l.pts[0], last())) { if (sb.closeOpen(li)) return li; break; }
      let hit = null;
      sb.loops.forEach((m, j) => {
        if (hit || j === li || m.type !== 'open' || sb.isFrozen(j)) return;
        const e = m.pts.length - 1;
        if (samePt(last(), m.pts[0])) hit = { j, rev: false, atEnd: true };
        else if (samePt(last(), m.pts[e])) hit = { j, rev: true, atEnd: true };
        else if (samePt(l.pts[0], m.pts[e])) hit = { j, rev: false, atEnd: false };
        else if (samePt(l.pts[0], m.pts[0])) hit = { j, rev: true, atEnd: false };
      });
      if (!hit) break;
      if (hit.rev) sb.reverseOpen(hit.j);
      // the line that was there first keeps its exact point where they meet
      if (hit.atEnd) { const P = sb.loops[hit.j].pts[0], Q = last(); Q[0] = P[0]; Q[1] = P[1]; li = sb.appendOpen(li, hit.j); }
      else { const P = sb.loops[hit.j].pts[sb.loops[hit.j].pts.length - 1]; l.pts[0][0] = P[0]; l.pts[0][1] = P[1]; li = sb.appendOpen(hit.j, li); }
    }
    return li;
  };
  /**
   * Lines that end close to each other but not on each other: each loose end moves onto the nearest other loose end
   * within the pull-in distance, and they join (closing outlines where both ends of a line meet). Returns how many joins.
   */
  sb.joinCloseEnds = function joinCloseEnds() {
    let n = 0;
    for (let guard = 0; guard < 500; guard++) {
      const R = sb.endReach(); let best = null;
      sb.loops.forEach((l, li) => {
        if (l.type !== 'open' || sb.isFrozen(li)) return;
        for (const k of [0, l.pts.length - 1]) {
          const P = l.pts[k];
          sb.loops.forEach((m, mj) => {
            if (m.type !== 'open' || sb.isFrozen(mj)) return;
            for (const q of [0, m.pts.length - 1]) {
              if (mj === li && (q === k || l.pts.length < 4)) continue; // its own other end: only when that makes an outline
              const d = Math.hypot(m.pts[q][0] - P[0], m.pts[q][1] - P[1]);
              if (d > JOIN_TOL && d < R && (!best || d < best.d)) best = { d, li, k, to: m.pts[q] };
            }
          });
        }
      });
      if (!best) break;
      const P = sb.loops[best.li].pts[best.k]; P[0] = best.to[0]; P[1] = best.to[1];
      sb.joinEnds(best.li); n++;
    }
    return n;
  };
  /** Is this spot the loose end of an unfinished line? */
  sb.isOpenEnd = (p) => sb.loops.some((l) => l.type === 'open' && (samePt(p, l.pts[0]) || samePt(p, l.pts[l.pts.length - 1])));
  /** Center the picked shape (or everything) on the center lines: ax 0 = left-right, 1 = front-back. */
  sb.center = function center(ax) {
    const ls = sb.sel != null ? [sb.loops[sb.sel]] : sb.loops; if (!ls.length) return;
    const b = SG.loopsBounds(ls), mid = ax === 0 ? (b[0] + b[2]) / 2 : (b[1] + b[3]) / 2;
    sb.remember();
    for (const l of ls) for (const p of l.type === 'circle' ? [l.c] : l.pts) p[ax] = r3(p[ax] - mid);
    sb.draw();
  };
  /** Mirror across a center line. A half outline whose two ends sit on the line becomes one whole, symmetric outline;
   *  anything else gets a mirrored copy. ax 0: across the up-down (green) line; ax 1: across the left-right (red) line. */
  sb.mirror = function mirror(ax, auto) {
    if (sb.sel == null) return toast('Pick a shape first (Select tool).');
    const l = sb.loops[sb.sel];
    if (auto) {
      // already the same on both sides of the line (e.g. a rectangle drawn across it): nothing to add
      const b = SG.loopsBounds([l]); const lo = ax === 0 ? b[0] : b[1], hi = ax === 0 ? b[2] : b[3];
      const touches = sb.hasSides(l) && Math.abs(l.pts[0][ax]) < 1e-6 && Math.abs(l.pts[l.pts.length - 1][ax]) < 1e-6;
      if (!touches && Math.abs(lo + hi) < 1e-6) return;
    } else sb.remember();
    const flip = (p) => { const q = [p[0], p[1]]; q[ax] = r3(-q[ax]); return q; };
    if (l.type === 'circle') sb.loops.push({ type: 'circle', c: flip(l.c), r: l.r, ...(sb.owners ? { owner: l.owner } : {}) });
    else {
      const n = l.pts.length, first = l.pts[0], last = l.pts[n - 1];
      if (Math.abs(first[ax]) < 1e-6 && Math.abs(last[ax]) < 1e-6 && n >= 3) {
        // the back half: mirrored points in reverse order; each mirrored side, run backwards, keeps its bend
        const back = l.pts.slice(1, n - 1).reverse().map(flip);
        const B = (i) => +(l.bulge?.[i] || 0);
        const bulge = l.pts.map((_, i) => (i < n - 1 ? B(i) : B(n - 2)));
        for (let k = 0; k < back.length; k++) bulge.push(B(n - 3 - k));
        const round = l.round ? [...l.round, ...l.pts.slice(1, n - 1).map((_, k) => l.round[n - 2 - k])] : null;
        l.pts = l.pts.concat(back);
        l.type = 'poly'; // an unfinished half from the line and back to it: now a whole, closed outline
        if (bulge.some((x) => x)) l.bulge = bulge; else delete l.bulge;
        if (round?.some((x) => x)) l.round = round;
        // side n-1 used to be the closing side on the line; it is now a new side
        sb.remapRules(sb.sel, (i) => (i < n - 1 ? i : null), (k) => k);
      } else {
        sb.loops.push(sb.owners ? { ...SG.mirrorLoop(l, ax), owner: l.owner } : SG.mirrorLoop(l, ax));
        // an unfinished line with one end on the mirror line: its mirror image carries it on
        if (l.type === 'open') sb.sel = sb.joinEnds(sb.loops.length - 1);
      }
    }
    sb.draw();
  };
  sb.insertPoint = function insertPoint(li, i, p) {
    const l = sb.loops[li]; if (+(l.bulge?.[i] || 0)) return toast('Add points on straight sides only.');
    sb.remember();
    l.pts.splice(i + 1, 0, p);
    if (l.bulge) l.bulge.splice(i + 1, 0, 0);
    if (l.round) l.round.splice(i + 1, 0, 0);
    sb.remapRules(li, (k) => (k === i ? null : k > i ? k + 1 : k), (k) => (k > i ? k + 1 : k));
    sb.selCorner = { l: li, i: i + 1 }; sb.selEdge = null; sb.draw();
  };
  sb.deletePoint = function deletePoint(li, i) {
    const l = sb.loops[li], n = l.pts.length, open = l.type === 'open';
    if (open && n <= 2) { sb.remember(); sb.removeLoop(li); sb.sel = null; sb.selCorner = null; sb.selEdge = null; sb.draw(); return; }
    if (!open && n <= 3) return toast('An outline needs at least 3 corners. Delete the whole shape instead.');
    sb.remember();
    if (open && (i === 0 || i === n - 1)) {
      // an end of an unfinished line: the line gets one side shorter
      const b = l.pts.slice(0, -1).map((_, k) => bulgeOf(l, k)); b.splice(i === 0 ? 0 : n - 2, 1); b.push(0);
      l.pts.splice(i, 1);
      if (b.some((x) => x)) l.bulge = b; else delete l.bulge;
      if (l.round) { l.round.splice(i, 1); l.round[0] = 0; l.round[l.round.length - 1] = 0; if (!l.round.some((x) => +x)) delete l.round; }
      sb.remapRules(li, (s) => (i === 0 ? (s === 0 ? null : s - 1) : (s === n - 2 ? null : s)), (k) => (k === i ? null : i === 0 ? k - 1 : k));
    } else {
      l.pts.splice(i, 1);
      if (l.bulge) { l.bulge.splice(i, 1); l.bulge[(i - 1 + n - 1) % (n - 1)] = 0; if (l.bulge.every((x) => !x)) delete l.bulge; }
      if (l.round) { l.round.splice(i, 1); if (l.round.every((x) => !x)) delete l.round; }
      // sides i-1 and i become one
      sb.remapRules(li, (k) => (k === i || k === (i - 1 + n) % n ? null : k > i ? k - 1 : k), (k) => (k === i ? null : k > i ? k - 1 : k));
    }
    sb.selCorner = null; sb.draw();
  };
  /**
   * Take sides out of an outline or an unfinished line. A closed outline opens up into an unfinished line; sides taken
   * out of the middle of an unfinished line split it into pieces. The rules on the sides that stay are kept.
   * Returns the number of the (first) line that is left, or null when nothing is left.
   */
  sb.cutSides = function cutSides(li, S) {
    let l = sb.loops[li];
    if (l.type === 'poly') {
      // open it up at a side whose next side stays: the line then runs from the point after that side all the way round
      const n = l.pts.length, d = [...S].find((i) => !S.has((i + 1) % n)), start = (d + 1) % n;
      const order = l.pts.map((_, m) => (start + m) % n), pos = new Map(order.map((k, m) => [k, m]));
      const bulge = order.map((k, m) => (m < n - 1 ? bulgeOf(l, k) : 0));
      const round = order.map((k, m) => (m === 0 || m === n - 1 ? 0 : +(l.round?.[k] || 0)));
      l.type = 'open'; l.pts = order.map((k) => l.pts[k]);
      if (bulge.some((x) => x)) l.bulge = bulge; else delete l.bulge;
      if (round.some((x) => x)) l.round = round; else delete l.round;
      sb.remapRules(li, (j) => (j === d ? null : pos.get(j)), (k) => pos.get(k), (k) => { const m = pos.get(k); return m === 0 || m === n - 1 ? null : m; });
      S = new Set([...S].filter((j) => j !== d).map((j) => pos.get(j)));
      l = sb.loops[li];
    }
    // an unfinished line: each run of sides that stays becomes a line of its own
    const ns = l.pts.length - 1, runs = [];
    let s0 = null;
    for (let i = 0; i <= ns; i++) {
      const keep = i < ns && !S.has(i);
      if (keep && s0 == null) s0 = i;
      if (!keep && s0 != null) { runs.push([s0, i - 1]); s0 = null; }
    }
    if (!runs.length) { sb.removeLoop(li); return null; }
    if (runs.length === 1 && runs[0][0] === 0 && runs[0][1] === ns - 1) return li;
    const srcPts = l.pts, srcBulge = l.pts.map((_, i) => bulgeOf(l, i)), srcRound = l.round;
    const idx = runs.map(([a, b], r) => {
      const m = r === 0 ? l : { type: 'open', ...(l.owner != null ? { owner: l.owner } : {}) };
      m.pts = srcPts.slice(a, b + 2);
      const bl = srcBulge.slice(a, b + 1).concat([0]);
      if (bl.some((x) => x)) m.bulge = bl; else delete m.bulge;
      if (srcRound) { const rd = srcRound.slice(a, b + 2); rd[0] = 0; rd[rd.length - 1] = 0; if (rd.some((x) => +x)) m.round = rd; else delete m.round; }
      if (r === 0) return li;
      sb.loops.push(m); return sb.loops.length - 1;
    });
    const ptPiece = (k) => runs.findIndex(([a, b]) => k >= a && k <= b + 1), sidePiece = (i) => runs.findIndex(([a, b]) => i >= a && i <= b);
    sb.eachRef((x, kind) => {
      if (x.l !== li || kind === 'whole') return;
      if (kind === 'side') { const r = sidePiece(x.i); if (r < 0) return false; x.l = idx[r]; x.i -= runs[r][0]; return; }
      const k = kind === 'pt' ? x.k : x.i, r = ptPiece(k);
      if (r < 0 || (kind === 'corner' && (k === runs[r][0] || k === runs[r][1] + 1))) return false;
      x.l = idx[r]; if (kind === 'pt') x.k -= runs[r][0]; else x.i -= runs[r][0];
    });
    return li;
  };
  /**
   * Delete segment: take one side (or several, picked with Shift) out. A closed outline opens up and Line/Arc carry on
   * from its open end; click the other open end to close it again, or leave it open and finish it later.
   */
  sb.deleteSides = function deleteSides(li, sides) {
    const l = sb.loops[li];
    if (!sb.hasSides(l)) return toast('Pick a side of an outline. (Circles have no sides: draw the new shape with Arc instead.)');
    if (sb.isFrozen(li)) return toast('That shape is frozen. Pick it and use Freeze again to unfreeze it first.', 'info', 3500);
    const S = new Set(sides), wasClosed = l.type === 'poly';
    if (wasClosed && S.size >= l.pts.length) return toast('That is every side. To remove the whole outline, click inside it and press Delete.');
    sb.remember();
    const left = sb.cutSides(li, S);
    sb.sel = null; sb.selEdge = null; sb.selCorner = null; sb.picks = []; sb.ruleWait = null; sb.pickFor = null; sb.measure = null; sb.typed = '';
    if (wasClosed && left != null) {
      const L = sb.loops[left], end = L.pts[L.pts.length - 1];
      sb.tool = sb.tool === 'arc' ? 'arc' : 'line';
      sb.current = { type: 'poly', pts: [[end[0], end[1]]], bulge: [], auto: 1 }; // started for you: Undo skips it
      toast(`${S.size === 1 ? 'Segment' : `${S.size} segments`} taken out. Draw the new part from the open end and click the other orange end to close it, or press Esc and finish it later.`, 'info', 5000);
    }
    sb.draw();
  };

  // ---- the Rules row: pick things, then click a rule (or click a rule, then the things)
  sb.pickIs = { side: (p) => !p.pt && !p.circle && !p.shape && p.i != null, pt: (p) => !!p.pt, circle: (p) => !!p.circle, shape: (p) => !!p.shape };
  sb.isArc = (s) => !!bulgeOf(sb.loops[s.l], s.i);
  sb.samePick = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  sb.ptRef = (p) => (p.o ? { o: 1 } : { l: p.l, k: p.k });
  /** Can this rule be made from these picks? { ok: () => make it } | { need: 'what to click next' } | { bad: 'why not' } */
  sb.evalRule = function evalRule(kind, ps, waiting) {
    const S = ps.filter(sb.pickIs.side), L = S.filter((s) => !sb.isArc(s)), A = S.filter(sb.isArc), P = ps.filter(sb.pickIs.pt), C = ps.filter(sb.pickIs.circle), N = ps.length;
    const only = (arr) => arr.length === N;
    const add = (...rs) => () => { sb.remember(); for (const r of rs) sb.rules.push(r); sb.settle(new Set()); };
    switch (kind) {
      case 'flat': case 'upright':
        if (!N) return { need: `Click the line to keep ${kind === 'flat' ? 'level' : 'straight up and down'} (or two points)` };
        if (only(L)) return { ok: add(...L.map((s) => ({ t: kind, a: { l: s.l, i: s.i } }))) };
        if (only(P) && N === 1) return { need: 'Click the second point' };
        if (only(P) && N === 2) return { ok: add({ t: kind === 'flat' ? 'dy' : 'dx', p: sb.ptRef(P[0]), q: sb.ptRef(P[1]), v: 0 }) };
        return { bad: `${kind === 'flat' ? 'Flat' : 'Upright'} is for straight lines, or for two points.` };
      case 'parallel': case 'square':
        if (!N) return { need: 'Click the first line' };
        if (only(L) && N === 1) return { need: 'Click the second line' };
        if (only(L) && N === 2) return { ok: add({ t: kind, a: { l: L[0].l, i: L[0].i }, b: { l: L[1].l, i: L[1].i } }) };
        return { bad: `${kind === 'parallel' ? 'Parallel' : 'Square'} is for two straight lines.` };
      case 'equal':
        if (!N) return { need: 'Click the first line, circle or arc' };
        if (only(L)) return N === 1 ? { need: 'Click the second line' } : N === 2 ? { ok: add({ t: 'equal', a: { l: L[0].l, i: L[0].i }, b: { l: L[1].l, i: L[1].i } }) } : { bad: 'Same size works on two at a time.' };
        if (A.length + C.length === N) {
          const R = [...C.map((c) => ({ l: c.l, circle: 1 })), ...A.map((s) => ({ l: s.l, i: s.i }))];
          return N === 1 ? { need: 'Click the second circle or arc' } : N === 2 ? { ok: add({ t: 'eqr', a: R[0], b: R[1] }) } : { bad: 'Same size works on two at a time.' };
        }
        return { bad: 'Same size is for two lines, or for two circles/arcs.' };
      case 'tangent': {
        if (!N) return { need: 'Click a line and a circle, two circles, or a corner where an arc meets a line' };
        if (only(P) && N === 1 && !P[0].o) {
          const l = sb.loops[P[0].l]; if (l?.type !== 'poly') return { bad: 'Pick a corner of an outline.' };
          const n = l.pts.length, k = P[0].k;
          if (!bulgeOf(l, k) && !bulgeOf(l, (k - 1 + n) % n)) return { bad: 'That corner has no arc. Bend one of its sides first.' };
          return { ok: () => sb.smoothJoin(P[0].l, k) };
        }
        if (L.length === 1 && C.length === 1 && N === 2) return { ok: add({ t: 'tangent', a: { l: L[0].l, i: L[0].i }, b: { l: C[0].l, circle: 1 } }) };
        if (C.length === 2 && N === 2) {
          const c1 = sb.loops[C[0].l], c2 = sb.loops[C[1].l], d = Math.hypot(c1.c[0] - c2.c[0], c1.c[1] - c2.c[1]);
          const inside = d < Math.max(c1.r, c2.r);
          return { ok: add({ t: 'tangent', a: { l: C[0].l, circle: 1 }, b: { l: C[1].l, circle: 1 }, ...(inside ? { inside: 1 } : {}) }) };
        }
        if (N === 1 && (L.length || C.length)) return { need: L.length ? 'Now click the circle it should touch' : 'Now click the line or the other circle' };
        return { bad: 'Touch is for a line and a circle, two circles, or a corner where an arc meets a line.' };
      }
      case 'join':
        if (!N) return { need: 'Click a point' };
        if (only(P) && N === 2) return { ok: add({ t: 'same', p: sb.ptRef(P[0]), q: sb.ptRef(P[1]) }) };
        if (P.length === 1 && N === 1) return { need: 'Click the other point, or the line or circle it should sit on' };
        if (P.length === 1 && N === 2 && L.length === 1) return { ok: add({ t: 'on', p: sb.ptRef(P[0]), a: { l: L[0].l, i: L[0].i } }) };
        if (P.length === 1 && N === 2 && C.length === 1) return { ok: add({ t: 'on', p: sb.ptRef(P[0]), a: { l: C[0].l, circle: 1 } }) };
        if (N === 1 && (L.length || C.length)) return { need: 'Now click the point that should sit on it' };
        return { bad: 'Join is for two points, or a point and a line or circle.' };
      case 'sym':
        if (!N) return { need: 'Click the first of the two points' };
        if (only(P) && N === 1) return { need: 'Click the second point' };
        if (P.length === 2 && L.length === 1 && N === 3) return { ok: add({ t: 'sym', p: sb.ptRef(P[0]), q: sb.ptRef(P[1]), a: { l: L[0].l, i: L[0].i } }) };
        if (only(P) && N === 2) return waiting ? { need: 'Mirror across which line? Pick it below, or click a line', choose: 'sym' } : { ok: () => sb.symChooser(P) };
        return { bad: 'Mirror pair is for two points (and the line they mirror across).' };
      case 'angle':
        if (!N) return { need: 'Click the line (or two lines)' };
        if (only(L) && N === 1) return waiting ? { need: 'Click a second line, or press Enter for the angle from level' } : { ok: () => sb.askAngle(L[0], null) };
        if (only(L) && N === 2) return { ok: () => sb.askAngle(L[0], L[1]) };
        return { bad: 'Angle is for one or two straight lines.' };
      case 'size':
        if (!N) return { need: 'Click a line, a circle, or two points' };
        if (only(L) && N === 1) return { ok: () => sb.askSize(L[0]) };
        if (only(A) && N === 1) return { ok: () => sb.askSize(A[0]) };
        if (only(C) && N === 1) return { ok: () => sb.askSize(C[0]) };
        if (only(P) && N === 1) return { need: 'Click the second point' };
        if (only(P) && N === 2) return { ok: () => sb.measureChoose(sb.ptRef(P[0]), sb.ptRef(P[1])) };
        return { bad: 'Size is for one line, one circle or arc, or two points.' };
      case 'freeze': {
        const ls = [...new Set(ps.filter((p) => !p.o).map((p) => p.l))].filter((l) => l != null);
        if (!ls.length) return sb.sel != null && !N ? { ok: () => sb.toggleFreeze([sb.sel]) } : { need: 'Click the shape to freeze (or unfreeze)' };
        return { ok: () => sb.toggleFreeze(ls) };
      }
    }
    return { bad: '' };
  };
  sb.toggleFreeze = function toggleFreeze(ls) {
    sb.remember();
    const allFrozen = ls.every(sb.isFrozen);
    sb.rules = sb.rules.filter((r) => !(r.t === 'freeze' && ls.includes(r.a.l)));
    if (!allFrozen) for (const l of ls) sb.rules.push({ t: 'freeze', a: { l } });
    toast(allFrozen ? 'Unfrozen: it can move again.' : 'Frozen: rules and dragging can no longer move it.', 'info', 2500);
  };
  sb.runRule = function runRule(res) { sb.picks = []; sb.ruleWait = null; res.ok(); sb.draw(); };
  sb.pressRule = function pressRule(kind) {
    if (sb.ruleWait === kind) { sb.ruleWait = null; sb.picks = []; sb.draw(); return; }
    sb.canvas.querySelector('.sk-mchoose')?.remove();
    const res = sb.evalRule(kind, sb.picks, false);
    if (res.ok) return sb.runRule(res);
    if (res.bad) sb.picks = [];
    sb.ruleWait = kind; if (sb.tool !== 'select') { const keep = sb.picks; sb.setTool('select'); sb.picks = keep; }
    sb.draw();
  };
  /** A thing was clicked with the Select tool: pick it (Shift or Ctrl adds to what is picked). */
  sb.addPick = function addPick(p, additive) {
    if (additive || sb.ruleWait) {
      const i = sb.picks.findIndex((q) => sb.samePick(q, p));
      if (i >= 0) sb.picks.splice(i, 1); else sb.picks.push(p);
    } else sb.picks = [p];
    if (sb.ruleWait) {
      const res = sb.evalRule(sb.ruleWait, sb.picks, true);
      if (res.ok) return sb.runRule(res);
      if (res.bad) { toast(res.bad, 'info', 3000); sb.picks.pop(); }
    }
  };
  sb.symChooser = function symChooser(P) {
    const [a, b] = P.map((p) => pointOf(sb.loops, sb.ptRef(p)));
    const [x, y] = sb.toScreen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    sb.canvas.querySelector('.sk-mchoose')?.remove();
    const go = (ax) => () => { box.remove(); sb.remember(); sb.rules.push({ t: 'sym', p: sb.ptRef(P[0]), q: sb.ptRef(P[1]), a: { axis: ax } }); sb.settle(new Set()); sb.picks = []; sb.ruleWait = null; sb.draw(); };
    const box = h('div', { class: 'sk-mchoose', style: `left:${x}px;top:${y}px` },
      h('div', { class: 'muted' }, 'Mirror across:'),
      h('button', { class: 'chip', onclick: go(0), title: 'The green (up-down) line' }, '↔ Green line'),
      h('button', { class: 'chip', onclick: go(1), title: 'The red (left-right) line' }, '↕ Red line'),
      h('button', { class: 'chip', title: 'Click any straight line to mirror across', onclick: () => { box.remove(); sb.picks = P.slice(); sb.ruleWait = 'sym'; sb.draw(); } }, 'A line I pick…'),
      h('button', { class: 'chip', onclick: () => box.remove(), title: 'Never mind' }, '✕'));
    sb.canvas.append(box);
  };
  sb.sideScreenMid = (s) => { const l = sb.loops[s.l]; return sb.toScreen(isCircleRef(s) ? [l.c[0], +l.c[1] + +l.r] : sb.sideMid(l, s.i)); };
  /** Angle rule: shown in plain degrees (0 to 180). */
  sb.shownAngle = (r) => { const v = r.v; if (r.b) return Math.abs(v); return v < 0 ? v + 180 : v >= 180 ? v - 180 : v; };
  sb.askAngle = function askAngle(a, b) {
    const r = { t: 'angle', a: { l: a.l, i: a.i }, ...(b ? { b: { l: b.l, i: b.i } } : {}) };
    r.v = angleNow(sb.loops, r);
    const [x, y] = sb.sideScreenMid(b || a);
    sb.askNumber(x, y, Math.round(sb.shownAngle(r) * 1000) / 1000, (deg) => {
      if (!(deg >= 0 && deg <= 180)) return toast('Type an angle from 0 to 180.');
      if (b) r.v = (r.v < 0 ? -1 : 1) * deg; else r.v = r.v < 0 ? deg - 180 : deg;
      sb.rules = sb.rules.filter((q) => !(q.t === 'angle' && sb.samePick(q.a, r.a) && sb.samePick(q.b || null, r.b || null)));
      sb.rules.push(r); sb.settle(new Set());
    }, true);
  };
  sb.askSize = function askSize(s) {
    const [x, y] = sb.sideScreenMid(s);
    if (isCircleRef(s)) { const c = sb.loops[s.l]; sb.askNumber(x, y, 2 * c.r, (v) => sb.setDiameter(s.l, v), true); return; }
    if (sb.isArc(s)) { sb.askNumber(x, y, radiusOf(sb.loops, s), (v) => sb.setRadius(s.l, s.i, v), true); return; }
    sb.askNumber(x, y, sb.edgeLen(sb.loops[s.l], s.i), (v) => { if (v > 0) sb.setLength(s.l, s.i, v, true); }, true);
  };
  /** A typed circle size: it stays (a rule). */
  sb.setDiameter = function setDiameter(li, v) {
    if (!(v > 0)) return;
    const c = sb.loops[li]; c.r = r3(v / 2);
    sb.rules = sb.rules.filter((r) => !(r.t === 'diam' && r.a.l === li)); sb.rules.push({ t: 'diam', a: { l: li, circle: 1 }, v: r3(v) });
    sb.settle(new Set([c.c]));
  };
  /** "Just showing" sizes follow the drawing. */
  sb.refreshShown = function refreshShown() { for (const r of sb.rules) if (r.ref && VALUE_RULES.has(r.t)) { const v = valueNow(sb.loops, r); if (v != null) r.v = r3(v); } };
  sb.setShowing = function setShowing(k, on) {
    const r = sb.rules[k]; if (!r || !VALUE_RULES.has(r.t)) return;
    sb.remember(); if (on) r.ref = 1; else { delete r.ref; const v = valueNow(sb.loops, r); if (v != null) r.v = r3(v); }
    sb.draw();
  };
  /** Click a rule's badge on the drawing: what it is, and a button to remove it. */
  sb.openBadge = function openBadge(k, x, y) {
    sb.canvas.querySelector('.sk-mchoose')?.remove();
    const r = sb.rules[k]; if (!r) return;
    const box = h('div', { class: 'sk-mchoose', style: `left:${x}px;top:${y}px` },
      h('div', {}, h('b', {}, sb.ruleLabel(r))),
      ...(r.t === 'angle' ? [h('button', { class: 'chip', onclick: () => { box.remove(); sb.askAngle(r.a, r.b); } }, 'Change'),
        h('button', { class: 'chip', title: 'Locked: the angle holds. Just showing: it is shown but not held.', onclick: () => { box.remove(); sb.setShowing(k, !r.ref); } }, r.ref ? 'Lock it' : 'Just show it')] : []),
      ...(r.t === 'anchor' ? [h('button', { class: 'chip', onclick: () => { box.remove(); sb.toggleAnchor(); } }, r.off ? 'Lock it' : 'Unlock')]
        : [h('button', { class: 'chip', onclick: () => { box.remove(); sb.removeRule(k); } }, 'Remove rule')]),
      h('button', { class: 'chip', onclick: () => box.remove(), title: 'Close' }, '✕'));
    sb.canvas.append(box);
  };
}

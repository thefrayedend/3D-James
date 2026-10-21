// Insert > Sketch > From a photo: pick a photo, tell 3DJames the size of something in it (a sheet of paper, a
// rectangle you measured, or a line you measured), then trace over it yourself or let 3DJames find the outline.
// The result opens on the sketch board with the photo underneath.
import { h, ic, toast, modal } from './dom.js';
import { keepFile, newFileId } from '../storage.js';
import { loadPicture, orderCorners, straighten, scaleOnly, jpegBytes, findOutline } from '../photo.js';

const PAPERS = [['a4', 'A4 (210 × 297 mm)', 210, 297], ['letter', 'Letter (8.5 × 11 in)', 215.9, 279.4], ['a3', 'A3 (297 × 420 mm)', 297, 420], ['legal', 'Legal (8.5 × 14 in)', 215.9, 355.6]];
const fmt = (v) => String(Math.round(v * 10) / 10);

/** Ask for a picture file. */
function pickPicture() {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept: 'image/*' });
    inp.onchange = () => resolve(inp.files?.[0] || null);
    inp.oncancel = () => resolve(null);
    inp.click();
  });
}

/**
 * The whole flow. onSketch({ loops, photo }) opens the sketch board. Returns when the window closes.
 */
export async function photoToSketch(onSketch) {
  const file = await pickPicture();
  if (!file) return;
  let src;
  try { src = await loadPicture(file); } catch (err) { toast(err.message, 'err', 6000); return; }

  // ---------------------------------------------------------------- state
  const S = { kind: 'paper', paper: 'a4', rw: '', rh: '', len: '', pts: [], swap: false, result: null, mode: null, level: 0, detail: 0.5, loops: [] };
  const need = () => (S.kind === 'line' ? 2 : 4);
  const view = { k: 1, ox: 0, oy: 0 }; // canvas pixels per picture pixel, and where the picture's 0,0 is
  const canvas = h('canvas', { class: 'pw-canvas' });
  const loupe = h('canvas', { class: 'pw-loupe', width: 160, height: 160 });
  const holder = h('div', { class: 'pw-holder' }, canvas, loupe);
  const side = h('div', { class: 'pw-side' });
  const status = h('div', { class: 'pw-status' });
  const body = h('div', { class: 'pw' }, h('div', { class: 'pw-left' }, holder, status), side);
  let close = null;
  close = modal('Photo to sketch', body, (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel')]);
  body.closest('dialog').classList.add('pw-dialog');

  // ---------------------------------------------------------------- showing the picture
  const shown = () => S.result?.canvas || src;
  function fit() {
    const r = holder.getBoundingClientRect(), img = shown();
    canvas.width = Math.max(100, r.width | 0); canvas.height = Math.max(100, r.height | 0);
    view.k = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.96;
    view.ox = (canvas.width - img.width * view.k) / 2; view.oy = (canvas.height - img.height * view.k) / 2;
    paint();
  }
  const toImg = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left - view.ox) / view.k, (e.clientY - r.top - view.oy) / view.k]; };
  const toCan = ([x, y]) => [view.ox + x * view.k, view.oy + y * view.k];
  function paint() {
    const g = canvas.getContext('2d'), img = shown();
    g.fillStyle = '#2b2f36'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(img, view.ox, view.oy, img.width * view.k, img.height * view.k);
    if (!S.result) {
      // the clicked corners / ends
      g.lineWidth = 2; g.strokeStyle = '#ff7a00'; g.fillStyle = 'rgba(255,122,0,.15)';
      if (S.pts.length > 1) {
        g.beginPath(); S.pts.forEach((p, i) => { const [x, y] = toCan(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        if (S.kind !== 'line' && S.pts.length === 4) { g.closePath(); g.fill(); }
        g.stroke();
      }
      S.pts.forEach((p, i) => { const [x, y] = toCan(p); g.beginPath(); g.arc(x, y, 7, 0, 7); g.stroke(); g.fillStyle = '#ff7a00'; g.font = 'bold 13px sans-serif'; g.fillText(String(i + 1), x + 9, y - 9); });
    } else if (S.mode === 'outline') {
      // the outline found, over the straightened photo
      const { mmPerPx } = S.result, H = S.result.canvas.height;
      g.lineWidth = 2.5; g.strokeStyle = '#ff2d55';
      for (const l of S.loops) {
        g.beginPath();
        if (l.type === 'circle') { const [x, y] = toCan([l.c[0] / mmPerPx, H - l.c[1] / mmPerPx]); g.arc(x, y, (l.r / mmPerPx) * view.k, 0, 7); }
        else l.pts.forEach((p, i) => { const [x, y] = toCan([p[0] / mmPerPx, H - p[1] / mmPerPx]); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
        g.closePath(); g.stroke();
      }
    }
  }
  // a magnifier while placing points (fingers hide what is under them)
  function showLoupe(e) {
    if (S.result) { loupe.style.display = 'none'; return; }
    const [ix, iy] = toImg(e), r = holder.getBoundingClientRect(), g = loupe.getContext('2d');
    loupe.style.display = 'block';
    loupe.style.left = `${Math.min(r.width - 170, Math.max(4, e.clientX - r.left + 24))}px`; loupe.style.top = `${Math.max(4, e.clientY - r.top - 190)}px`;
    g.fillStyle = '#2b2f36'; g.fillRect(0, 0, 160, 160);
    const span = 160 / (view.k * 3);
    g.imageSmoothingEnabled = false;
    g.drawImage(src, ix - span / 2, iy - span / 2, span, span, 0, 0, 160, 160);
    g.strokeStyle = '#ff7a00'; g.lineWidth = 1; g.beginPath(); g.moveTo(80, 60); g.lineTo(80, 100); g.moveTo(60, 80); g.lineTo(100, 80); g.stroke();
  }

  // ---------------------------------------------------------------- clicking the points (they can be dragged after)
  let dragging = -1;
  canvas.addEventListener('pointerdown', (e) => {
    if (S.result) return;
    canvas.setPointerCapture(e.pointerId);
    const p = toImg(e), grab = (e.pointerType === 'touch' ? 26 : 12) / view.k;
    dragging = S.pts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < grab);
    if (dragging < 0 && S.pts.length < need()) { S.pts.push(p); dragging = S.pts.length - 1; }
    showLoupe(e); paint(); renderSide();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging >= 0) { S.pts[dragging] = toImg(e); paint(); showLoupe(e); }
    else if (!S.result && S.pts.length < need() && e.pointerType !== 'touch') showLoupe(e);
  });
  const up = () => { dragging = -1; loupe.style.display = 'none'; renderSide(); };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', () => { if (dragging < 0) loupe.style.display = 'none'; });

  // ---------------------------------------------------------------- the steps on the right
  const sizes = () => {
    if (S.kind === 'paper') { const p = PAPERS.find((x) => x[0] === S.paper); return [p[2], p[3]]; }
    if (S.kind === 'rect') return [parseFloat(S.rw), parseFloat(S.rh)];
    return [parseFloat(S.len)];
  };
  function measure() {
    const [w, hh] = sizes();
    if (S.kind === 'line') {
      if (!(w > 0)) throw new Error('Type how long that line really is (mm).');
      const r = scaleOnly(src, S.pts[0], S.pts[1], w);
      return { ...r, place: [-(r.canvas.width * r.mmPerPx) / 2, -(r.canvas.height * r.mmPerPx) / 2], area: null };
    }
    if (!(w > 0 && hh > 0)) throw new Error('Type the width and height of the rectangle (mm).');
    const c = orderCorners(S.pts);
    // the longer measured side goes along the sides that look longer in the photo (opposite sides averaged, so a
    // photo taken at an angle doesn't fool it); "Swap" turns it the other way if it still guessed wrong
    const d = (a, b) => Math.hypot(c[b][0] - c[a][0], c[b][1] - c[a][1]);
    const across = (d(0, 1) + d(2, 3)) / 2, up = (d(1, 2) + d(3, 0)) / 2;
    const [lo, hi] = [Math.min(w, hh), Math.max(w, hh)];
    const [W, H] = (across >= up) !== S.swap ? [hi, lo] : [lo, hi];
    const r = straighten(src, c, W, H);
    const Hm = r.canvas.height * r.mmPerPx;
    // where to look for the part: inside the paper (a sheet of paper is the background); anywhere for a measured rectangle
    const m = 0.03 * Math.min(W, H);
    const area = S.kind === 'paper' ? [(r.rect[0] + m) / r.mmPerPx, (Hm - (r.rect[1] + H) + m) / r.mmPerPx, (r.rect[0] + W - m) / r.mmPerPx, (Hm - r.rect[1] - m) / r.mmPerPx] : null;
    return { ...r, place: [-(r.rect[0] + W / 2), -(r.rect[1] + H / 2)], area };
  }
  let timer = null;
  function outline() {
    clearTimeout(timer);
    status.textContent = 'Looking for the outline…';
    timer = setTimeout(() => {
      try {
        // on a smaller copy (fast), scaled back to millimetres
        const big = S.result.canvas, k = Math.min(1, 1400 / Math.max(big.width, big.height));
        const small = document.createElement('canvas'); small.width = Math.round(big.width * k); small.height = Math.round(big.height * k);
        small.getContext('2d').drawImage(big, 0, 0, small.width, small.height);
        const area = S.result.area ? S.result.area.map((v) => v * k) : null;
        S.loops = findOutline(small, S.result.mmPerPx / k, { area, level: S.level, detail: S.detail });
        const n = S.loops.length;
        status.textContent = n ? `Found ${n} outline${n === 1 ? '' : 's'}${S.loops.some((l) => l.type === 'circle') ? ' (round holes became circles)' : ''}. Adjust the sliders if it missed something.` : 'Nothing found. Move the light/dark slider, or trace it yourself.';
      } catch (err) { status.textContent = err.message; S.loops = []; }
      paint(); renderSide();
    }, 60);
  }
  async function finish() {
    const r = S.result;
    const bytes = await jpegBytes(r.canvas);
    const fid = newFileId(); keepFile(fid, bytes);
    const W = r.canvas.width * r.mmPerPx, H = r.canvas.height * r.mmPerPx, [px, py] = r.place;
    const photo = { file: fid, x: round(px), y: round(py), w: round(W), h: round(H), opacity: S.mode === 'outline' ? 0.35 : 0.55 };
    const shift = (q) => [round(q[0] + px), round(q[1] + py)];
    const loops = S.mode === 'outline' ? S.loops.map((l) => (l.type === 'circle' ? { type: 'circle', c: shift(l.c), r: l.r } : { ...l, pts: l.pts.map(shift) })) : [];
    close();
    onSketch({ loops, photo });
  }
  const round = (v) => Math.round(v * 1000) / 1000;

  function renderSide() {
    const chip = (label, on, fn, title) => h('button', { class: 'chip' + (on ? ' on' : ''), title, onclick: fn }, label);
    const n = need(), left = n - S.pts.length;
    if (!S.result) {
      const kindRow = h('div', { class: 'chip-row' },
        chip('Sheet of paper', S.kind === 'paper', () => { S.kind = 'paper'; S.pts = S.pts.slice(0, 4); renderSide(); paint(); }, 'The part lies on a sheet of printer paper: click the paper\'s 4 corners'),
        chip('A rectangle I measured', S.kind === 'rect', () => { S.kind = 'rect'; renderSide(); paint(); }, 'Anything rectangular you know the size of: a cutting mat, a floor tile, the printer bed, a box you measured'),
        chip('A line I measured', S.kind === 'line', () => { S.kind = 'line'; S.pts = S.pts.slice(0, 2); renderSide(); paint(); }, 'Two points you know the distance between (no straightening: take the photo from straight above)'));
      const sizeRow = S.kind === 'paper'
        ? h('select', { class: 'in', onchange: (e) => { S.paper = e.target.value; } }, PAPERS.map(([k, label]) => h('option', { value: k, selected: S.paper === k }, label)))
        : S.kind === 'rect'
          ? h('div', { class: 'pw-two' }, h('input', { class: 'in', inputmode: 'decimal', placeholder: 'width mm', value: S.rw, oninput: (e) => { S.rw = e.target.value; } }), h('span', {}, '×'), h('input', { class: 'in', inputmode: 'decimal', placeholder: 'height mm', value: S.rh, oninput: (e) => { S.rh = e.target.value; } }))
          : h('input', { class: 'in', inputmode: 'decimal', placeholder: 'length in mm', value: S.len, oninput: (e) => { S.len = e.target.value; } });
      const go = (mode) => () => {
        try { S.result = measure(); S.mode = mode; } catch (err) { toast(err.message, 'err', 5000); return; }
        fit();
        if (mode === 'outline') outline(); else { status.textContent = ''; finish(); }
        renderSide();
      };
      side.replaceChildren(
        h('h3', {}, '1. What do you know the size of?'), kindRow, sizeRow,
        h('div', { class: 'muted pw-tip' }, S.kind === 'line'
          ? 'Click the two ends of something you measured (the longer, the better). Best with the photo taken from straight above.'
          : `Click the ${S.kind === 'paper' ? 'paper\'s' : 'rectangle\'s'} 4 corners, in any order. The photo is straightened too, so it can be taken at an angle.${S.kind === 'rect' ? ' The longer number goes along the longer side.' : ''}`),
        h('div', { class: 'pw-count' }, left > 0 ? `Click ${left} more point${left === 1 ? '' : 's'}` : '✓ All points placed (drag them to adjust)'),
        h('div', { class: 'chip-row' }, chip('Start over', false, () => { S.pts = []; paint(); renderSide(); }, 'Remove the points'),
          ...(S.kind !== 'line' ? [chip('Swap long / short side', S.swap, () => { S.swap = !S.swap; renderSide(); }, 'If the result looks stretched: the long side of the rectangle goes the other way')] : [])),
        h('h3', {}, '2. Then'),
        h('div', { class: 'pw-go' },
          h('button', { class: 'btn primary', disabled: left > 0, onclick: go('trace'), title: 'The photo goes under the sketch board, the right size: draw over it with Line, Arc and the other tools' }, ic('PenLine'), 'Trace it myself'),
          h('button', { class: 'btn', disabled: left > 0, onclick: go('outline'), title: 'For a part on a plain background that stands out from it: 3DJames finds its edge' }, 'Find the outline')));
      return;
    }
    // finding the outline: sliders and the result
    const lvl = h('input', { type: 'range', min: -1, max: 1, step: 0.05, value: S.level, oninput: (e) => { S.level = +e.target.value; outline(); } });
    const det = h('input', { type: 'range', min: 0.1, max: 3, step: 0.1, value: S.detail, oninput: (e) => { S.detail = +e.target.value; det.nextSibling.textContent = `${fmt(S.detail)} mm`; outline(); } });
    side.replaceChildren(
      h('h3', {}, 'Find the outline'),
      h('div', { class: 'muted pw-tip' }, 'Works best with the part on a plain background that stands out from it (dark part on white paper), lit evenly, without strong shadows.'),
      h('label', { class: 'pw-label' }, 'Light / dark split'), lvl,
      h('label', { class: 'pw-label' }, 'Follow the edge within'), h('div', { class: 'pw-two' }, det, h('span', {}, `${fmt(S.detail)} mm`)),
      h('div', { class: 'muted pw-tip' }, 'The outline is a normal sketch afterwards: fix it with the usual tools. The photo stays underneath (faded) to check against.'),
      h('div', { class: 'pw-go' },
        h('button', { class: 'btn primary', disabled: !S.loops.length, onclick: finish }, ic('PenLine'), 'Open in the sketch'),
        h('button', { class: 'btn', onclick: () => { S.mode = 'trace'; finish(); }, title: 'Use the photo only, and draw yourself' }, 'Trace it myself instead'),
        h('button', { class: 'btn', onclick: () => { S.result = null; S.loops = []; status.textContent = ''; fit(); renderSide(); } }, 'Back (looks stretched? swap the sides there)')));
  }
  renderSide();
  requestAnimationFrame(fit);
  new ResizeObserver(() => fit()).observe(holder);
}

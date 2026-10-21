// Sketch board: a photo under the drawing (to trace over). Shown under the grid, faded; it can be moved, sized again
// from two points you know the distance between, hidden or removed. It is kept with the sketch (p.photo) and saved
// inside the project. See photo.js for straightening and finding outlines.
import { h, toast } from './dom.js';
import { fileStore } from '../storage.js';
import { svgEl, fmtN, r3 } from './sketchkit.js';

export function installPhoto(sb) {
  sb.photo = sb.st0.photo ? JSON.parse(JSON.stringify(sb.st0.photo)) : null;
  sb.photoMode = null; // 'move' (drag it) | 'scale' (click two points, type how far apart they are)
  let url = null, urlFor = null, scalePts = [], drag = null;
  const imageUrl = () => {
    const id = sb.photo?.file;
    if (id !== urlFor) { if (url) URL.revokeObjectURL(url); url = null; urlFor = id; const bytes = id && fileStore.get(id); if (bytes) url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })); }
    return url;
  };
  sb.releasePhoto = () => { if (url) URL.revokeObjectURL(url); url = null; urlFor = null; };

  /** Draw it (under the grid lines). */
  sb.drawPhoto = function drawPhoto() {
    const p = sb.photo; if (!p || p.hidden) return;
    const href = imageUrl(); if (!href) return;
    const [x, y] = sb.toScreen([p.x, p.y + p.h]);
    sb.svg.append(svgEl('image', { href, x, y, width: p.w * sb.view.s, height: p.h * sb.view.s, opacity: p.opacity ?? 0.5, preserveAspectRatio: 'none', class: 'sk-photo' }));
    for (const q of scalePts) { const [sx, sy] = sb.toScreen(q); sb.svg.append(svgEl('circle', { cx: sx, cy: sy, r: 7, class: 'sk-corner-sel' })); }
    if (scalePts.length === 1 && sb.cursor) { const [ax, ay] = sb.toScreen(scalePts[0]), [bx, by] = sb.toScreen(sb.cursor); sb.svg.append(svgEl('line', { x1: ax, y1: ay, x2: bx, y2: by, class: 'sk-guide' })); }
  };

  const setMode = (m) => { sb.photoMode = sb.photoMode === m ? null : m; scalePts = []; drag = null; sb.draw(); };
  /** Mouse / finger on the board while moving or sizing the photo. True: handled here. */
  sb.photoDown = (raw) => {
    if (!sb.photo || !sb.photoMode) return false;
    if (sb.photoMode === 'move') { sb.remember(); drag = { start: raw, x0: sb.photo.x, y0: sb.photo.y }; return true; }
    scalePts.push(raw);
    if (scalePts.length === 2) {
      const [a, b] = scalePts, now = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (now < 1e-3) { scalePts = []; return true; }
      const [mx, my] = sb.toScreen([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      sb.askNumber(mx, my, now, (want) => {
        if (!(want > 0)) return;
        const k = want / now, p = sb.photo;
        // scaled around the first point, so it stays where it is
        p.x = r3(a[0] + (p.x - a[0]) * k); p.y = r3(a[1] + (p.y - a[1]) * k); p.w = r3(p.w * k); p.h = r3(p.h * k);
        toast(`Photo sized: those two points are now ${fmtN(want)} mm apart.`, 'info', 3500);
      }, true);
      scalePts = []; sb.photoMode = null;
    }
    sb.draw();
    return true;
  };
  sb.photoMove = (raw) => {
    if (!drag) return false;
    sb.photo.x = r3(drag.x0 + raw[0] - drag.start[0]); sb.photo.y = r3(drag.y0 + raw[1] - drag.start[1]);
    sb.draw(); return true;
  };
  sb.photoUp = () => { if (!drag) return false; drag = null; return true; };

  /** The Photo box on the right. */
  sb.photoPanel = function photoPanel(btn) {
    const p = sb.photo; if (!p) return [];
    const fade = h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: p.opacity ?? 0.5, style: 'width:100%;min-width:0;max-width:150px', 'aria-label': 'How strong the photo shows',
      oninput: (e) => { p.opacity = +e.target.value; const im = sb.svg.querySelector('.sk-photo'); if (im) im.setAttribute('opacity', p.opacity); } });
    return [
      h('div', { class: 'muted', style: 'font-size:11.5px;margin-bottom:4px' }, `${fmtN(p.w)} × ${fmtN(p.h)} mm. Draw over it with Line, Arc and the other tools; it never becomes part of the solid.`),
      h('div', { class: 'sk-row two' }, h('span', {}, 'Show'), fade),
      h('div', { class: 'chip-row', style: 'margin-top:6px' },
        btn(p.hidden ? 'Show photo' : 'Hide photo', () => { sb.remember(); p.hidden = !p.hidden; sb.draw(); }, 'Hide or show the photo (it stays in the sketch)'),
        btn(sb.photoMode === 'move' ? 'Moving… (click to stop)' : 'Move photo', () => setMode('move'), 'Drag the photo to line it up with your drawing', sb.photoMode === 'move'),
        btn(sb.photoMode === 'scale' ? 'Click two points…' : 'Size again', () => setMode('scale'), 'Click two points on the photo that you know the distance between, then type the distance', sb.photoMode === 'scale'),
        btn('Remove photo', () => { sb.remember(); sb.photo = null; sb.photoMode = null; sb.draw(); toast('Photo removed from the sketch (Undo brings it back).', 'info', 3000); }, 'Take the photo out of this sketch')),
    ];
  };
}

// Small DOM helpers shared by every part of the interface: element builder, icons, toasts, menus, number formatting.
import {
  createElement as lucideCreate, Crosshair, PenLine, Square, MousePointer2, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowDownToLine, ArrowLeft, ArrowUpDown, ArrowUpFromLine, Bolt, Box, BoxSelect, Check, ChevronDown, ChevronLeft,
  Camera, Eraser, Import, Pill, ChevronRight, Circle, CircleDashed, CircleDot, ClipboardPaste, Cone, Copy, Cylinder, Diamond, Eye, EyeOff, FilePlus, FlipHorizontal2,
  FlipVertical2, FolderOpen, Grid2x2, Group, Hexagon, History, House, Layers, Lock, LockOpen, Magnet, Maximize, Menu, Minus, Mouse,
  MousePointerClick, Move3d, Nut, Package, Pipette, Plus, Printer, Pyramid, Settings2, Redo2, Rotate3d, Ruler, RulerDimensionLine, Save, SaveAll, Scale3d, ScanEye, Scissors, SlidersHorizontal, Spline,
  SquareRoundCorner, SquaresIntersect, SquaresSubtract, SquaresUnite, SunMoon, Torus, Trash2, Triangle, TriangleAlert, TriangleRight, Type,
  Undo2, Ungroup, X, Bot,
} from 'lucide';

const LUCIDE = {
  Crosshair, PenLine, Square, MousePointer2, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical, ArrowDownToLine, ArrowLeft, ArrowUpDown, ArrowUpFromLine, Bolt, Box, BoxSelect, Check, ChevronDown, ChevronLeft, Camera, Eraser, Import, Pill, ChevronRight, Circle,
  CircleDashed, CircleDot, ClipboardPaste, Cone, Copy, Cylinder, Diamond, Eye, EyeOff, FilePlus, FlipHorizontal2, FlipVertical2, FolderOpen,
  Grid2x2, Group, Hexagon, History, House, Layers, Lock, LockOpen, Magnet, Maximize, Menu, Minus, Mouse, MousePointerClick, Move3d, Nut,
  Package, Pipette, Plus, Printer, Pyramid, Settings2, Redo2, Rotate3d, Ruler, RulerDimensionLine, Save, SaveAll, Scale3d, ScanEye, Scissors, SlidersHorizontal, Spline, SquareRoundCorner, SquaresIntersect,
  SquaresSubtract, SquaresUnite, SunMoon, Torus, Trash2, Triangle, TriangleAlert, TriangleRight, Type, Undo2, Ungroup, X, Bot,
};

export const $ = (id) => document.getElementById(id);

/** Icon for each shape kind and step type. */
export const ICONS = {
  box: 'Box', cyl: 'Cylinder', sphere: 'Circle', cone: 'Cone', torus: 'Torus', wedge: 'TriangleRight', pyramid: 'Pyramid', tube: 'CircleDot',
  prism: 'Hexagon', text: 'Type', thread: 'Bolt', extrusion: 'Grid2x2', import: 'Package',
  emboss: 'Type', move: 'Move3d', combine: 'SquaresUnite', union: 'SquaresUnite', subtract: 'SquaresSubtract', intersect: 'SquaresIntersect',
  fillet: 'SquareRoundCorner', chamfer: 'Diamond', shell: 'BoxSelect', mirror: 'FlipHorizontal2', array: 'Grid2x2', split: 'Scissors',
  extrude: 'ArrowUpFromLine', pushpull: 'ArrowUpDown', copy: 'Copy', delete: 'Trash2',
};
export const featureIcon = (f) => (f.type === 'shape' ? ICONS[f.kind] : f.type === 'combine' ? ICONS[f.op] : ICONS[f.type]) || 'Circle';

// Your own button pictures: an "icons" folder next to 3DJames.html with files named like the ones in
// icons/originals (box.svg, squares-unite.svg, ...). Any that are there are used instead of the built-in ones.
export const iconFile = (name) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/([a-z]{2,})(\d)/g, '$1-$2').toLowerCase() + '.svg';
const customIcons = new Map();
export function loadCustomIcons(onFound) {
  // only look when the icons folder is there (it ships with icons/originals/box.svg)
  const probe = new Image();
  probe.onload = () => lookForIcons(onFound);
  probe.src = 'icons/originals/box.svg';
}
function lookForIcons(onFound) {
  let t = null;
  for (const name of Object.keys(LUCIDE)) {
    for (const ext of ['png', 'svg']) { // an .svg wins over a .png of the same name
      const url = `icons/${iconFile(name).replace(/svg$/, ext)}`, img = new Image();
      img.onload = () => { if (ext === 'svg' || !customIcons.get(name)?.endsWith('.svg')) customIcons.set(name, url); clearTimeout(t); t = setTimeout(onFound, 50); };
      img.src = url;
    }
  }
}
export function ic(name) {
  const url = customIcons.get(name);
  if (url) return h('img', { class: 'lucide uic', src: url, alt: '', draggable: 'false' });
  return lucideCreate(LUCIDE[name] || Circle, { class: 'lucide' });
}
export const iconNames = () => Object.keys(LUCIDE);

/** Build an element: h('div', { class, onclick, ... }, ...children). */
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
}

export const r2 = (v) => Math.round(v * 100) / 100;
export { r4 } from '../shared.js';
export const fmt = (v) => (Math.abs(v) < 0.005 ? '0' : (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2)).replace(/\.?0+$/, '') || '0');
export const isPlainNumber = (s) => /^[-+]?(\d+\.?\d*|\.\d+)$/.test(String(s).trim());

export function toast(msg, kind = 'info', ms = 4200) {
  const t = h('div', { class: 'toast' + (kind === 'err' ? ' err' : ''), role: kind === 'err' ? 'alert' : 'status' }, msg);
  $('toasts').append(t);
  setTimeout(() => t.remove(), ms);
  return t;
}

// ---------------------------------------------------------------- pop-up menus
let openMenuEl = null;
export const menuOpen = () => !!openMenuEl;
export function closeMenu() { document.querySelectorAll('.menu').forEach((m) => m.remove()); openMenuEl = null; }
export function popMenu(anchor, content) {
  closeMenu();
  const m = h('div', { class: 'menu', role: 'menu' }, content);
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth, hh = m.offsetHeight;
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  m.style.top = Math.min(r.bottom + 4, innerHeight - hh - 8) + 'px';
  openMenuEl = m;
  setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!e.target.closest?.('.menu')) { closeMenu(); document.removeEventListener('pointerdown', off); } }), 0);
  return m;
}
/** A menu entry that opens a second menu beside it (on hover or click). */
export function subMenu(icon, label, items) {
  const open = (e) => {
    const btn = e.currentTarget;
    // menus can open inside menus: close only the ones deeper than this one
    const level = +(btn.closest('.menu')?.dataset.level || 0) + 1;
    if (btn.classList.contains('open') && document.querySelector(`.menu.sub[data-level="${level}"]`)) return;
    document.querySelectorAll('.menu.sub').forEach((x) => { if (+x.dataset.level >= level) x.remove(); });
    btn.parentElement.querySelectorAll('.mi.open').forEach((x) => x.classList.remove('open'));
    btn.classList.add('open');
    const sm = h('div', { class: 'menu sub', role: 'menu', 'data-level': String(level) }, items());
    document.body.append(sm);
    const r = btn.getBoundingClientRect();
    // keep opening the same way as the menu it came from (so menus never land on top of each other)
    const goingLeft = btn.closest('.menu')?.dataset.dir === 'left';
    const fitsRight = r.right + 2 + sm.offsetWidth < innerWidth - 8, fitsLeft = r.left - sm.offsetWidth - 2 >= 8;
    const right = goingLeft ? !fitsLeft : fitsRight;
    sm.dataset.dir = right ? 'right' : 'left';
    sm.style.left = (right ? r.right + 2 : Math.max(8, r.left - sm.offsetWidth - 2)) + 'px';
    sm.style.top = Math.max(8, Math.min(r.top - 5, innerHeight - sm.offsetHeight - 8)) + 'px';
  };
  return h('button', { class: 'mi has-sub', onmouseenter: open, onclick: open }, icon ? ic(icon) : null, label, h('small', {}, ic('ChevronRight')));
}
export const mi = (icon, label, fn, key) => h('button', { class: 'mi', onclick: () => { closeMenu(); fn(); } }, icon ? ic(icon) : null, label, key ? h('small', {}, key) : null);
export function pickMenu(anchor, title, options, current, onPick) {
  popMenu(anchor, [h('div', { class: 'sec-h', style: 'padding:4px 10px' }, title), ...options.map(([v, label]) => h('button', { class: 'mi', onclick: () => { closeMenu(); onPick(v); } }, String(v) === String(current) ? ic('Check') : h('span', { style: 'width:18px' }), label))]);
}

/** A simple dialog box. `buttons(close)` makes its buttons; clicking beside it calls onDismiss. Returns a close function. */
export function modal(title, body, buttons, onDismiss) {
  const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) dismiss(); } });
  const previous = document.activeElement;
  const close = () => { dialog.close(); back.remove(); previous?.focus(); };
  const dismiss = () => { close(); onDismiss?.(); };
  const dialog = h('dialog', { class: 'modal', 'aria-label': title, style: 'border:0;max-height:85vh;overflow:auto;margin:auto' }, h('h2', {}, title), body, h('div', { class: 'btns' }, buttons(close)));
  dialog.addEventListener('cancel', (e) => { e.preventDefault(); e.stopPropagation(); dismiss(); });
  dialog.addEventListener('keydown', (e) => e.stopPropagation());
  dialog.addEventListener('click', (e) => {
    const r = dialog.getBoundingClientRect();
    if (e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dismiss();
  });
  back.append(dialog);
  document.body.append(back);
  dialog.showModal();
  return close;
}

// The 3D Builder-style ribbon: the blue tab strip at the top and the row of commands under it, plus its menus.
import { store } from '../store.js';
import { PALETTE, threadDefaults, EXTRUSIONS, HARDWARE, HARDWARE_DEFAULTS, SHAPES } from '../shared.js';
import { SCREW_TYPES, NUT_TYPES, BEARINGS, BEARING_GROUPS, DOWELS, RODS, MAGNETS, STANDOFF_SIZES, SCREW_LENGTHS, presetFor } from '../catalog.js';
import { app, saveSettings } from '../state.js';
import { $, h, ic, toast, popMenu, closeMenu, mi, pickMenu, subMenu } from './dom.js';
import { vp } from '../view.js';
import { centerOn, addShape, addShapeAt, mirrorSel, turnCopySel, addPattern, groupSel, ungroupSel, duplicateSel, dropSel, deleteSel, setBodyProp, selectAll, selectNone, select, editStep, copySel, paste } from '../commands.js';
import { setWorkplane, startTool, endTool, applyTool } from '../tools.js';
import { newProject, openDialog, saveDoc, saveAs, exportDialog, insertDialog, chooseProjectsFolder, updateTitle } from '../files.js';
import { previewCombine } from '../boolean-preview.js';
import { saveNewVersionDialog, versionsDialog } from '../versions.js';
import { backupsDialog } from '../storage.js';
import { saveToMyParts, insertMyPart, manageMyParts, myParts, refreshMyParts } from '../myparts.js';
import { openPanel } from './panels.js';
import { applyTheme } from '../theme.js';
import { showHelp } from './help.js';
import { planeDialog } from '../sketchplane.js';
import { drive } from '../drive/index.js';
import { setInputMode } from '../touch.js';
import * as server from '../drive/server.js';
import { startSketch, startFaceSketch, startPhotoSketch, startImportSketch, editSketches } from '../sketchcmd.js';

// Parts: ready-made, fully editable parts, grouped in sections that open to the side
function sketchMenu(anchor) {
  popMenu(anchor, [
    mi('PenLine', app.workplane ? 'On the sketch plane' : 'On the floor', () => startSketch()),
    mi('Layers', 'On a surface…', () => startFaceSketch()),
    mi('Camera', 'From a photo…', () => startPhotoSketch()),
    mi('Import', 'From a DXF / SVG file…', () => startImportSketch()),
    mi('Layers', 'Place sketch plane…', () => { startTool('sketchplane'); toast('Click a spot on a flat or curved solid.'); }),
    ...(app.workplane ? [mi('Settings2', 'Adjust current plane…', () => planeDialog(app.workplane))] : []),
    h('hr'),
    mi('PenLine', 'Edit picked sketches together', () => editSketches(app.sel)),
  ]);
}
export function partsMenu(anchor) {
  refreshMyParts(true).catch(() => {}); // pick up parts added to the folder (this click allows asking for the folder)
  const part = (kind, extra, label) => () => { addShape(kind, extra, label); openPanel('props'); };
  const hole = (k) => () => { addShape(k); openPanel('props'); toast('Put it where the hole goes, then select it and click Subtract (Object tab).', 'info', 6000); };
  const sizes = (list, make) => () => list.map(make);
  popMenu(anchor, [
    // Screws: type > size > length, e.g. Socket head > M3 > 16 mm
    subMenu('Bolt', 'Screws and bolts', () => Object.entries(SCREW_TYPES).map(([t, def]) => {
      const name = def.label.replace(/ \(.*\)/, '');
      return subMenu('Bolt', name, sizes(def.sizes, (sz) => {
        const d = parseFloat(sz.slice(1)), lens = SCREW_LENGTHS.filter((L) => L >= Math.max(3, d * (t === 'set' ? 0.75 : 1)) && L <= Math.max(20, d * 10));
        return subMenu('Bolt', sz, () => lens.map((L) => mi('Bolt', `${sz} × ${L} mm`, part('screw', { ...presetFor('screw', { type: t, size: sz }), len: L }, `${sz}×${L} ${name.toLowerCase()}`))));
      }));
    })),
    subMenu('Nut', 'Nuts and washers', () => [
      ...Object.entries(NUT_TYPES).map(([t, def]) => subMenu('Nut', def.label.replace(/ \(.*\)/, ''), sizes(def.sizes, (sz) => mi('Nut', sz, part('nut', presetFor('nut', { type: t, size: sz }), `${sz} ${def.label.replace(/ \(.*\)/, '').toLowerCase()}`))))),
      subMenu('Circle', 'Washer', sizes(Object.keys(HARDWARE.washer), (sz) => mi('Circle', sz, part('washer', { size: sz, ...HARDWARE_DEFAULTS('washer', sz) }, `${sz} washer`)))),
    ]),
    subMenu('CircleDot', 'Bearings', () => Object.entries(BEARING_GROUPS).map(([g, list]) => subMenu('CircleDot', g, sizes(list, (b) => {
      const [id, od, w] = BEARINGS[b];
      return mi('CircleDot', `${b}  (${id}×${od}×${w})`, part('bearing', presetFor('bearing', { size: b }), `${b} bearing`));
    })))),
    subMenu('Minus', 'Pins, rods and magnets', () => [
      subMenu('Minus', 'Dowel pin', sizes(DOWELS, (d) => mi('Minus', `${d} mm × ${d * 4} mm`, part('pin', { d, len: d * 4 }, `${d}×${d * 4} dowel pin`)))),
      subMenu('Minus', 'Smooth rod', sizes(RODS, (d) => mi('Minus', `${d} mm × 100 mm`, part('rod', { d, len: 100 }, `${d} mm rod`)))),
      subMenu('Circle', 'Round magnet', sizes(MAGNETS, (m) => mi('Circle', `${m.replace('x', ' × ')} mm`, part('magnet', { size: m, ...presetFor('magnet', { size: m }) }, `${m} magnet`)))),
    ]),
    subMenu('Hexagon', 'Standoffs', () => [
      subMenu('Hexagon', 'Hex standoff (female-female)', sizes(STANDOFF_SIZES, (sz) => mi('Hexagon', `${sz} × 10 mm`, part('hexstandoff', { ...presetFor('hexstandoff', { size: sz }), len: 10, male: false }, `${sz}×10 standoff`)))),
      subMenu('Hexagon', 'Hex standoff (male-female)', sizes(STANDOFF_SIZES, (sz) => mi('Hexagon', `${sz} × 10 mm`, part('hexstandoff', { ...presetFor('hexstandoff', { size: sz }), len: 10, male: true, stud: 6 }, `${sz}×10 standoff (male)`)))),
      mi('CircleDot', 'Printed standoff', part('standoff')),
    ]),
    subMenu('CircleDashed', 'Holes and pockets', () => [
      mi('CircleDashed', 'Screw hole (plain, countersunk, counterbored)', hole('screwhole')),
      mi('Hexagon', 'Nut trap', hole('nuttrap')),
      mi('CircleDot', 'Heat-set insert hole', hole('insert')),
      mi('CircleDashed', 'Threaded hole (cutter)', () => addThread('cutter')),
    ]),
    subMenu('Spline', 'Custom threads', () => [mi('Bolt', 'Threaded bolt', () => addThread('bolt')), mi('Nut', 'Threaded nut', () => addThread('nut')), mi('Minus', 'Threaded rod', () => addThread('rod'))]),
    subMenu('Grid2x2', 'Aluminum extrusion', () => Object.entries(EXTRUSIONS).map(([k, e]) => mi('Grid2x2', e.label, () => { addShape('extrusion', { size: k }, e.label); openPanel('props'); }))),
    h('hr'),
    subMenu('Package', 'My parts', () => [
      ...myParts.map((p) => mi('Package', p.name, () => insertMyPart(p.part))),
      myParts.length ? h('hr') : null,
      mi('Plus', 'Save selected object', () => (app.sel.length === 1 ? saveToMyParts(app.sel[0]) : toast('Select one object to save it to My parts.'))),
      mi('Settings2', 'Manage My parts…', manageMyParts),
    ].filter(Boolean)),
  ]);
}
export function addThread(kind) {
  const d = threadDefaults('M8');
  if (kind === 'rod') addShape('thread', { ...d, size: 'M8', kind: 'bolt', head: 'none', len: 30 });
  else addShape('thread', { ...d, size: 'M8', kind, len: kind === 'cutter' ? 12 : 16 });
  openPanel('props');
  if (kind === 'cutter') toast('Place the threaded hole where you want it. Then select the part first, this cutter second, and click Subtract on the Object tab.', 'info', 8000);
}
export function mirrorMenu(anchor) {
  popMenu(anchor, [
    mi('FlipHorizontal2', 'Flip left–right', () => mirrorSel('x', false), 'X'),
    mi('FlipVertical2', 'Flip front–back', () => mirrorSel('y', false), 'Y'),
    mi('FlipVertical2', 'Flip upside down', () => mirrorSel('z', false), 'Z'),
    h('hr'),
    mi('Copy', 'Mirror copy to the right', () => mirrorSel('x', true), 'X'),
    mi('Copy', 'Mirror copy to the back', () => mirrorSel('y', true), 'Y'),
    mi('Copy', 'Mirror copy on top', () => mirrorSel('z', true), 'Z'),
    h('hr'),
    mi('Rotate3d', 'Turned copy: ¼ turn left (90°)', () => turnCopySel(90)),
    mi('Rotate3d', 'Turned copy: ½ turn (180°)', () => turnCopySel(180)),
    mi('Rotate3d', 'Turned copy: ¼ turn right (−90°)', () => turnCopySel(-90)),
  ]);
}
export function fileMenu(anchor) {
  popMenu(anchor, [
    mi('FilePlus', 'New', newProject),
    mi('FolderOpen', 'Open…', openDialog, 'Ctrl+O'),
    mi('Save', 'Save', saveDoc, 'Ctrl+S'),
    mi('SaveAll', 'Save as…', saveAs, 'Ctrl+Shift+S'),
    mi('History', 'Save as new version…', () => saveNewVersionDialog(saveDoc)),
    mi('History', 'Select version…', versionsDialog),
    mi('SaveAll', 'Export…', exportDialog),
    h('hr'),
    mi('Plus', 'Insert a model…', insertDialog),
    h('hr'),
    ...(drive.mode === 'local' ? [mi('FolderOpen', 'Projects folder…', chooseProjectsFolder)] : []),
    mi('History', 'Backups…', () => backupsDialog((doc) => { store.load(doc); select([]); })),
    // on a 3DJames server: who is signed in
    ...(drive.mode === 'server' ? [h('hr'), mi('X', `Sign out (${server.me.name || server.me.user})`, server.signOut)] : []),
  ]);
}

const TABS = ['Insert', 'Object', 'Edit', 'Paint', 'View', 'Help'];
const cmdButtons = {};
function cb(key, icon, label, fn, opts = {}) {
  const b = h('button', { class: 'cb' + (opts.on ? ' on' : ''), title: opts.title || label, 'data-dropdown': opts.dd ? 'true' : null, 'data-priority': ['union', 'subtract', 'intersect', 'emboss', 'fillet', 'split', 'measure'].includes(key) ? 'true' : null, onclick: (e) => fn(e.currentTarget) }, icon ? ic(icon) : null, h('span', {}, label), opts.dd ? ic('ChevronDown') : null);
  if (key) cmdButtons[key] = b;
  return b;
}
const sepEl = () => h('span', { class: 'csep' });
/** Roughly how big a new shape is ([w, d, h] mm), for the see-through preview while dragging it in. */
function ghostSize(kind, extra) {
  const p = { ...SHAPES[kind]?.defaults, ...extra }, n = (v, d = 20) => (Number.isFinite(+v) && +v > 0 ? +v : d);
  if (kind === 'box' || kind === 'wedge') return [n(p.w), n(p.d), n(p.h)];
  if (kind === 'sphere') return [n(p.d), n(p.d), n(p.d)];
  if (kind === 'torus') { const D = n(p.D) + n(p.d, 5); return [D, D, n(p.d, 5)]; }
  if (kind === 'cone') { const d = Math.max(n(p.d1), n(p.d2, 0)); return [d, d, n(p.h)]; }
  if (kind === 'tube') return [n(p.od), n(p.od), n(p.h)];
  if (kind === 'prism') { const d = n(p.af) * 1.155; return [d, n(p.af), n(p.h)]; }
  if (kind === 'text') return [n(p.size, 10) * 3, n(p.size, 10), n(p.depth, 3)];
  return [n(p.d), n(p.d), n(p.h)];
}
/**
 * A shape button: click it and the shape goes beside what is already there; drag it into the view and it lands
 * where you let go (on the floor, or on top of an object), like 3D Builder. A see-through box shows where.
 */
function shapeCb(icon, label, kind, extra, label0, after) {
  const b = cb('', icon, label, () => { if (b.dragged) { b.dragged = false; return; } addShape(kind, extra, label0); after?.(); });
  b.title = `${label}: click to add it, or drag it to where you want it`;
  b.style.touchAction = 'pan-x'; // a finger sliding along the toolbar still scrolls it; down into the view drags
  b.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let chip = null, at = null;
    const canvas = vp.renderer.domElement, size = ghostSize(kind, extra);
    const overView = (ev) => document.elementFromPoint(ev.clientX, ev.clientY) === canvas;
    const move = (ev) => {
      if (!chip && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
      if (!chip) { chip = h('div', { class: 'drag-chip' }, ic(icon), h('span', {}, label)); document.body.append(chip); b.dragged = true; }
      chip.style.left = `${ev.clientX + 12}px`; chip.style.top = `${ev.clientY + 12}px`;
      at = overView(ev) ? vp.dropPoint(ev) : null;
      if (at) { const g = app.settings.grid > 0 ? app.settings.grid : 0; if (g) { at.x = Math.round(at.x / g) * g; at.y = Math.round(at.y / g) * g; } }
      vp.showDrop(at, size, kind, +(extra?.n || 0));
      chip.classList.toggle('no', !at);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
      if (!chip) return; // a plain click
      chip.remove(); vp.showDrop(null);
      if (at) { addShapeAt([at.x, at.y, at.z], kind, extra, label0); after?.(); }
      setTimeout(() => { b.dragged = false; }, 0); // (the click that may follow a drag is not another add)
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  });
  return b;
}

export function buildTabBar() {
  const bar = $('tabbar'); bar.replaceChildren();
  bar.append(
    h('button', { class: 'tb-icon', title: 'File', 'aria-label': 'File menu', onclick: (e) => fileMenu(e.currentTarget) }, ic('Menu')),
    h('div', { class: 'tabs-row', role: 'tablist' }, TABS.map((t) => h('button', { class: 'tab' + (app.tab === t ? ' on' : ''), role: 'tab', onclick: () => { app.tab = t; buildTabBar(); renderCmdBar(); } }, t))),
    h('div', { style: 'flex:1' }),
    h('input', { id: 'docName', class: 'doc-name', value: store.doc.name || 'Untitled', 'aria-label': 'Project name', onfocus: (e) => { e.target.value = store.doc.name || 'Untitled'; }, onblur: () => updateTitle(), onchange: (e) => store.commit((d) => { d.name = e.target.value.trim().replace(/\s*\*$/, '') || 'Untitled'; }, 'ui') }),
    h('button', { class: 'tb-text', title: 'Save an editable project (Ctrl+Shift+S). Use File → Export for STL or STEP.', onclick: saveAs }, ic('SaveAll'), 'Save as'),
    h('button', { class: 'tb-icon', title: 'Save (Ctrl+S)', onclick: saveDoc }, ic('Save')),
    h('span', { class: 'tb-sep' }),
    cmdButtons.undoTop = h('button', { class: 'tb-icon', title: 'Undo (Ctrl+Z)', onclick: doUndo }, ic('Undo2')),
    cmdButtons.redoTop = h('button', { class: 'tb-icon', title: 'Redo (Ctrl+Y)', onclick: doRedo }, ic('Redo2')));
}

// printer bed sizes for the outline on the floor (width x depth in mm)
const PRINTERS = [['', 'Off'],
  ['256x256', 'Bambu Lab X1 / P1 / A1 (256 × 256)'], ['180x180', 'Bambu Lab A1 mini / Prusa MINI (180 × 180)'],
  ['220x220', 'Creality Ender 3 / K1 (220 × 220)'], ['300x300', 'Creality K1 Max (300 × 300)'], ['250x210', 'Prusa MK4 / MK3 (250 × 210)'],
  ['360x360', 'Prusa XL (360 × 360)'], ['350x350', 'Voron 350 (350 × 350)']];

// The command row fits itself to the window: first a little tighter, then icons only (names show on hover).
function fitRibbon() {
  const bar = $('cmdbar');
  if (bar._ribbonFull) bar.replaceChildren(...bar._ribbonFull);
  else bar._ribbonFull = Array.from(bar.childNodes);
  bar.classList.remove('compact', 'icons');
  if (bar.scrollWidth > bar.clientWidth) bar.classList.add('compact');
  if (bar.scrollWidth <= bar.clientWidth) return;
  const more = h('button', { class: 'cb ribbon-more', 'aria-label': 'More tools', onclick: () => {
    const hidden = bar._ribbonFull.filter((node) => node.nodeType === 1 && node.classList.contains('cb') && node.parentElement !== bar);
    const menu = popMenu(more, hidden);
    menu.classList.add('ribbon-more-menu');
    menu.addEventListener('click', (e) => { const button = e.target.closest('button'); if (button && button.dataset.dropdown !== 'true') closeMenu(); });
  } }, 'More', ic('ChevronDown'));
  bar.append(more);
  while (bar.scrollWidth > bar.clientWidth) {
    const buttons = [...bar.children].filter((node) => node.classList.contains('cb') && node !== more);
    const candidate = buttons.filter((node) => node.dataset.priority !== 'true').at(-1) || buttons.at(-1);
    if (!candidate) break;
    candidate.remove();
    for (const node of [...bar.children]) if (node.classList.contains('csep') && (!node.previousElementSibling || node.previousElementSibling.classList.contains('csep') || node.nextElementSibling === more)) node.remove();
  }
}
new ResizeObserver(() => fitRibbon()).observe($('cmdbar'));

export function renderCmdBar() {
  const bar = $('cmdbar'); bar._ribbonFull = null; bar.replaceChildren();
  if (app.tab !== 'Help') showHelp(false);
  for (const k of Object.keys(cmdButtons)) if (!k.endsWith('Top')) delete cmdButtons[k];
  if (app.tool?.type === 'split') {
    const tl = app.tool;
    const keep = (k, label) => cb('', 'Triangle', label, () => { tl.keep = k; renderCmdBar(); }, { on: tl.keep === k });
    bar.append(cb('', 'ArrowLeft', 'Cancel', endTool), cb('', 'Check', 'Split', applyTool), sepEl(), keep('above', 'Keep top'), keep('below', 'Keep bottom'), keep('both', 'Keep both'));
    return;
  }
  const t = app.tab;
  if (t === 'Insert') {
    bar.append(cb('', 'Plus', 'Add', insertDialog, { title: 'Insert a model from a file (STL, STEP, 3MF, OBJ)' }), sepEl(),
      shapeCb('Box', 'Cube', 'box'), shapeCb('Cylinder', 'Cylinder', 'cyl'), shapeCb('Pyramid', 'Pyramid', 'pyramid'),
      shapeCb('Cone', 'Cone', 'cone'), shapeCb('Circle', 'Sphere', 'sphere'), shapeCb('Hexagon', 'Hexagon', 'prism', { n: 6, af: 20, h: 20 }, 'Hexagon'),
      shapeCb('TriangleRight', 'Wedge', 'wedge'), shapeCb('Torus', 'Torus', 'torus'),
      shapeCb('Triangle', 'Tetrahedron', 'pyramid', { n: 3, d: 23.09, h: 16.33 }, 'Tetrahedron'),
      shapeCb('CircleDot', 'Tube', 'tube'), sepEl(),
      shapeCb('Type', 'Text', 'text', undefined, undefined, () => openPanel('props')), cb('', 'PenLine', 'Sketch', (b) => sketchMenu(b), { dd: true, title: 'Draw an outline (lines, arcs, rectangles, circles) with exact sizes, then push it up, spin it around, or cut it in. On the floor or on a face.' }), cb('', 'Package', 'Parts', (b) => partsMenu(b), { dd: true, title: 'Ready-made parts: hardware, aluminum extrusion and more' }), sepEl(),
      cb('workplane', 'Layers', 'Workplane', () => (app.workplane ? setWorkplane(null) : startTool('workplane')), { on: !!app.workplane || app.tool?.type === 'workplane', title: app.workplane ? 'New shapes go on the picked face. Click to go back to the floor.' : 'Click a flat or curved solid to place a sketch plane; click again to return to the floor' }));
  } else if (t === 'Object') {
    bar.append(cb('union', 'SquaresUnite', 'Merge', () => previewCombine('union'), { title: 'Join the selected objects (holes get cut out)' }),
      cb('subtract', 'SquaresSubtract', 'Subtract', () => previewCombine('subtract'), { title: 'Select the object to cut with and click Subtract: it is cut out of everything it passes through. (With several selected, the others are cut out of the first one you clicked.)' }),
      cb('intersect', 'SquaresIntersect', 'Intersect', () => previewCombine('intersect'), { title: 'Keep only where they overlap' }), sepEl(),
      cb('emboss', 'Type', 'Emboss', () => startTool('emboss'), { title: 'Add raised or recessed text / SVG artwork to a flat face' }),
      cb('fillet', 'SquareRoundCorner', 'Round edges', () => startTool('fillet'), { title: 'Round edges' }),
      cb('chamfer', 'Diamond', 'Bevel edges', () => startTool('chamfer'), { title: 'Bevel edges' }),
      cb('faces', 'BoxSelect', 'Faces', (b) => popMenu(b, [
        mi('BoxSelect', 'Hollow', () => startTool('shell')),
        mi('ArrowUpFromLine', 'Shape on a face', () => startTool('extrude')),
        mi('ArrowUpDown', 'Push/pull a face', () => startTool('pushpull')),
        mi('ArrowDownToLine', 'Lay flat on a face', () => startTool('layflat')),
        mi('CircleDot', 'Heat-set insert pocket on a face', () => startTool('insertpocket')),
      ]), { dd: true, title: 'Hollow, shape on a face, push/pull a face, lay flat on a face' }), sepEl(),
      cb('mirror', 'FlipHorizontal2', 'Mirror', (b) => mirrorMenu(b), { dd: true }),
      cb('array', 'Grid2x2', 'Pattern', addPattern, { title: 'Repeat in a row or a circle' }),
      cb('split', 'Scissors', 'Split', () => startTool('split'), { title: 'Cut in two with a flat plane' }), sepEl(),
      cb('group', 'Group', 'Group', (b) => popMenu(b, [
        mi('Group', 'Group', groupSel, 'Ctrl+G'),
        mi('Ungroup', 'Ungroup', ungroupSel, 'Ctrl+Shift+G'),
      ]), { dd: true, title: 'Group: keep objects separate but move and size them together' }),
      cb('align', 'AlignCenterVertical', 'Align', () => (app.tool?.type === 'align' ? endTool() : startTool('align')), { title: 'Line up the selected objects: dots appear around them; the first one you picked stays put' }),
      cb('center', 'Crosshair', 'Center', (b) => popMenu(b, [
        mi('Crosshair', 'Center on it (left-right and front-back)', () => centerOn([0, 1])),
        mi('Crosshair', 'Center on it in every direction', () => centerOn([0, 1, 2])),
        h('hr'),
        mi('AlignCenterVertical', 'Left-right only', () => centerOn([0])),
        mi('AlignCenterVertical', 'Front-back only', () => centerOn([1])),
        mi('AlignCenterHorizontal', 'Up-down only', () => centerOn([2])),
      ]), { dd: true, title: 'Click the object to center on, Ctrl+click the ones to move, then pick how' }), sepEl(),
      cb('dup', 'Copy', 'Duplicate', duplicateSel), cb('drop', 'ArrowDownToLine', 'Settle', dropSel, { title: 'Put it down on the floor' }));
  } else if (t === 'Edit') {
    bar.append(cb('undo', 'Undo2', 'Undo', doUndo), cb('redo', 'Redo2', 'Redo', doRedo), sepEl(),
      cb('copy', 'Copy', 'Copy', () => { copySel(); toast('Copied.', 'info', 1500); }),
      cb('paste', 'ClipboardPaste', 'Paste', paste),
      cb('dup', 'Copy', 'Duplicate', duplicateSel), cb('del', 'Trash2', 'Delete', deleteSel), sepEl(),
      cb('', 'MousePointerClick', 'Select all', selectAll), cb('', 'X', 'Select none', selectNone));
  } else if (t === 'Paint') {
    const cur = store.doc.bodies[app.sel[0]]?.color;
    bar.append(h('span', { class: 'cmuted' }, app.sel.length ? 'Color' : 'Select an object to paint'),
      h('div', { class: 'swgrid' }, PALETTE.map((c) => h('button', { class: 'swl' + (c.toLowerCase() === String(cur).toLowerCase() ? ' on' : ''), style: `background:${c}`, title: c, 'aria-label': `Color ${c}`, onclick: () => app.sel.length && setBodyProp(app.sel, 'color', c) }))),
      h('label', { class: 'cb', title: 'Pick any color' }, ic('Pipette'), h('span', {}, 'More'), h('input', { type: 'color', value: cur || '#C3C3C3', style: 'width:0;height:0;opacity:0;position:absolute', onchange: (e) => app.sel.length && setBodyProp(app.sel, 'color', e.target.value) })));
  } else if (t === 'View') {
    const s = app.settings;
    bar.append(cb('', 'House', 'Home', () => vp.view('home')), cb('', 'Maximize', 'Fit', () => vp.view(app.sel.length ? 'selection' : 'fit')), sepEl(),
      cb('', null, 'Top', () => vp.view('top')), cb('', null, 'Front', () => vp.view('front')), cb('', null, 'Left', () => vp.view('left')), cb('', null, 'Right', () => vp.view('right')), cb('', null, 'Back', () => vp.view('back')), cb('', null, 'Bottom', () => vp.view('bottom')), sepEl(),
      cb('', 'Box', { solid: 'Solid', wire: 'Wireframe', see: 'See-through', xray: 'X-ray' }[s.display] || 'Solid', (b) => pickMenu(b, 'How objects are drawn', [['solid', 'Solid'], ['wire', 'Wireframe'], ['see', 'See-through'], ['xray', 'X-ray (hidden edges show)']], s.display, (v) => { s.display = v; vp.setDisplay(v); saveSettings(); renderCmdBar(); }), { dd: true }),
      cb('', 'Spline', 'Edges', () => { s.edges = !s.edges; vp.setEdgesVisible(s.edges); saveSettings(); renderCmdBar(); }, { on: s.edges }),
      cb('lookat', 'ScanEye', 'Look at face', () => startTool('lookat'), { on: app.tool?.type === 'lookat', title: 'Click a face, and the view turns to look straight at it' }),
      cb('measure', 'Ruler', 'Measure', () => startTool('measure'), { title: 'Measure surface points, edge lengths, face areas and parallel face spacing' }),
      cb('', 'RulerDimensionLine', 'Ruler', () => { s.ruler = !s.ruler; vp.setRuler(s.ruler); saveSettings(); renderCmdBar(); }, { on: s.ruler, title: 'Show the gaps around the selected object; click a number to type an exact gap' }),
      cb('', 'Grid2x2', 'Flat view', () => { s.flat = !s.flat; vp.setFlat(s.flat); saveSettings(); renderCmdBar(); }, { on: s.flat, title: 'Flat (orthographic) view: no perspective, sizes don\'t shrink with distance' }),
      cb('', 'Magnet', `Snap ${s.grid ? s.grid + ' mm' : 'off'}`, (b) => pickMenu(b, 'Snap when moving and sizing', [[0, 'Off'], [0.1, '0.1 mm'], [0.5, '0.5 mm'], [1, '1 mm'], [2, '2 mm'], [5, '5 mm'], [10, '10 mm']], s.grid, (v) => { s.grid = +v; vp.grid = s.grid; saveSettings(); renderCmdBar(); }), { dd: true }),
      cb('', 'Rotate3d', `Turn ${s.rot ? s.rot + '°' : 'free'}`, (b) => pickMenu(b, 'Snap when rotating', [[0, 'Off'], [5, '5°'], [15, '15°'], [45, '45°'], [90, '90°']], s.rot, (v) => { s.rot = +v; vp.rotSnap = s.rot; vp.updateGizmo(); saveSettings(); renderCmdBar(); }), { dd: true }),
      cb('', 'Printer', s.printer ? (PRINTERS.find(([v]) => v === s.printer.join('x'))?.[1].split(' (')[0] || `Printer ${s.printer.join('×')}`) : 'Printer area', (b) => pickMenu(b, 'Show a printer bed outline', PRINTERS, s.printer ? s.printer.join('x') : '', (v) => { s.printer = v ? v.split('x').map(Number) : null; vp.setPrinterOutline(s.printer); saveSettings(); renderCmdBar(); }), { dd: true }),
      cb('', 'Mouse', { auto: 'Touch: auto', touch: 'Touch: on', mouse: 'Touch: off' }[s.inputMode || 'auto'], (b) => pickMenu(b, 'Touch mode: bigger buttons and on-screen keys for tablets', [['auto', 'Automatic (on when a finger or pen is used)'], ['touch', 'Always on'], ['mouse', 'Always off']], s.inputMode || 'auto', (v) => { setInputMode(v); renderCmdBar(); }), { dd: true, title: 'Touch mode: bigger buttons and on-screen keys (Pick more...) for tablets and the Apple Pencil' }),
      cb('', 'SunMoon', 'Theme', (b) => pickMenu(b, 'Theme', [['auto', 'Match Windows'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => { s.theme = v; saveSettings(); applyTheme(); }), { dd: true }), sepEl(),
      cb('', 'History', 'History', () => openPanel('history')), cb('', 'Layers', 'Objects', () => openPanel('objects')));
  } else if (t === 'Help') {
    // the Help page covers this row (it has its own topic list, search and Licenses button)
    showHelp(true);
  }
  updateToolbar();
  fitRibbon();
}


export function updateToolbar() {
  const n = app.sel.length;
  const en = { emboss: n === 1, measure: app.results.bodies.size > 0, align: n >= 2, center: n >= 2, group: n >= 1, faces: n === 1, union: n >= 2, subtract: n >= 1, intersect: n >= 2, fillet: n === 1, chamfer: n === 1, mirror: n >= 1, array: n === 1, split: n === 1, dup: n >= 1, drop: n >= 1, del: n >= 1, copy: n >= 1, paste: !!app.clip?.length, undo: store.undoStack.length > 0, redo: store.redoStack.length > 0, undoTop: store.undoStack.length > 0, redoTop: store.redoStack.length > 0 };
  for (const [k, v] of Object.entries(en)) if (cmdButtons[k]) cmdButtons[k].disabled = !v;
  const selected = n === 1 ? app.results.bodies.get(app.sel[0]) : null;
  for (const key of ['fillet', 'chamfer', 'faces', 'emboss']) if (cmdButtons[key]) {
    cmdButtons[key].disabled = !selected?.solid;
    cmdButtons[key].title = !selected ? 'Select one object first.' : !selected.solid ? 'This tool needs a solid. Imported STL/OBJ meshes do not have editable CAD faces.' : ({ fillet: 'Round edges (Fillet)', chamfer: 'Bevel edges (Chamfer)', faces: 'Edit solid faces', emboss: 'Emboss or engrave text / SVG on a flat face' }[key]);
  }
  for (const k of ['fillet', 'chamfer', 'split', 'align']) cmdButtons[k]?.classList.toggle('on', app.tool?.type === k);
  cmdButtons.faces?.classList.toggle('on', ['shell', 'extrude', 'pushpull', 'layflat', 'insertpocket'].includes(app.tool?.type));
}
export function doUndo() { if (app.tool) endTool(); if (!store.undo()) toast('Nothing to undo.'); editStep(null); }
export function doRedo() { if (app.tool) endTool(); if (!store.redo()) toast('Nothing to redo.'); }

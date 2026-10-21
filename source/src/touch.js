// Touch screens and pens (tablets, phones, touch laptops, the Apple Pencil) next to mouse and keyboard.
// Every pointer event says whether it came from a mouse, a finger or a pen, so each is handled its own way and
// the mouse never changes. "Touch mode" (body class touch-ui) only adds things: bigger buttons and on-screen
// stand-ins for the keys a tablet doesn't have (Shift, Ctrl, Alt, typing numbers). It switches on by itself when
// a finger or pen is used and off when a mouse is used; View > Touch can also force it on or off.
import { app, saveSettings } from './state.js';

/** On-screen stand-ins for keys: multi = Shift/Ctrl+click (pick more), straight = Shift (straight / 45°),
 *  reach = Alt (loose ends reach further), free = Ctrl (no snapping). */
export const mods = { multi: false, straight: false, reach: false, free: false };

let auto = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const listeners = new Set();
export const onTouchModeChange = (fn) => listeners.add(fn);

/** Is touch mode on? */
export function touchUI() {
  const m = app.settings.inputMode || 'auto';
  return m === 'touch' || (m === 'auto' && auto);
}
export function applyTouchMode() {
  const on = touchUI();
  document.body.classList.toggle('touch-ui', on);
  if (!on) for (const k of Object.keys(mods)) mods[k] = false;
  for (const fn of listeners) fn(on);
}
/** View > Touch: 'auto' (follows what you use), 'touch' or 'mouse'. */
export function setInputMode(m) { app.settings.inputMode = m; saveSettings(); applyTouchMode(); }

window.addEventListener('pointerdown', (e) => {
  const was = touchUI();
  if (e.pointerType === 'touch' || e.pointerType === 'pen') auto = true;
  else if (e.pointerType === 'mouse') auto = false;
  if (touchUI() !== was) applyTouchMode();
}, true);

/** Pens: a palm resting on the screen while the pen is used is not a finger. */
let penAt = 0;
window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'pen') penAt = Date.now(); }, true);
window.addEventListener('pointermove', (e) => { if (e.pointerType === 'pen') penAt = Date.now(); }, true);
export const palm = (e) => e.pointerType === 'touch' && Date.now() - penAt < 1500;

/** How much bigger pick distances are for a finger (fingers are wider and less exact than a mouse or pen). */
export const fat = (e) => (e?.pointerType === 'touch' ? 2.4 : 1);

/** Toggle one of the on-screen keys; returns its new state. */
export function toggleMod(k) { mods[k] = !mods[k]; for (const fn of listeners) fn(touchUI()); return mods[k]; }

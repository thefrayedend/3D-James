// Light, dark, or match Windows.
import { app } from './state.js';
import { vp } from './view.js';

export function applyTheme() {
  const t = app.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  vp.setTheme({ accent: v('--accent'), outline: v('--outline'), pick: v('--pick'), edge: v('--edge'), floorA: v('--floor-a'), floorB: v('--floor-b'), bg: v('--vp-bg'), ruler: v('--ruler') });
  vp.setPrinterOutline(app.settings.printer);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

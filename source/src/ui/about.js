// Help > About / Licenses: what 3DJames is built on, with every license text.
import { h, modal } from './dom.js';
import { inProgram, watchUpdates, checkNow, setUpdatesOn, updateText } from '../updates.js';

// Only in the installed Windows program: it can look on GitHub for a newer version when it starts (see src/updates.js).
function updatesBlock() {
  const status = h('div', { class: 'muted', role: 'status', 'data-update-status': '' });
  const check = h('button', { class: 'btn', onclick: () => checkNow() }, 'Check now');
  const box = h('input', { type: 'checkbox', onchange: (e) => setUpdatesOn(e.target.checked) });
  watchUpdates((u) => { box.checked = u.enabled; status.textContent = updateText(u); check.disabled = u.status === 'checking'; });
  return h('div', { class: 'lic', style: 'padding:8px 10px;display:grid;gap:6px' },
    h('b', {}, 'Updates'),
    h('label', { class: 'check' }, box, 'Look for a newer version on GitHub when 3DJames starts'),
    h('div', { class: 'muted' }, 'It downloads one small list and, if there is a newer version, the new 3DJames.html. Nothing of yours is sent; GitHub only sees that this computer asked.'),
    h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, check, status));
}

export function showAbout() {
  const L = window.__3DJ_LICENSES || { credits: [], texts: {}, notice: '' };
  const rows = L.credits.map((c) => h('details', { class: 'lic' },
    h('summary', {}, h('b', {}, c.name), h('span', {}, ` · ${c.license}`), h('small', {}, `${c.what}. ${c.by}${c.ver ? ` · ${c.ver}` : ''}`)),
    h('div', { class: 'lic-url' }, c.url),
    h('pre', { class: 'lic-text' }, L.texts[c.file] || '')));
  const box = modal('About 3DJames', [
    h('p', { style: 'margin:0' }, h('b', {}, `Version ${window.__3DJ_VERSION || '?'}`)),
    h('p', { style: 'margin:0' }, '3DJames is a parametric 3D modeler for 3D printing. Everything runs on your computer; nothing of yours is sent online.'),
    inProgram() ? updatesBlock() : null,
    h('details', { class: 'lic' }, h('summary', {}, h('b', {}, '3DJames itself'), h('span', {}, ' · GPL 3.0 or later'), h('small', {}, 'Free software: you may use, share and change it. Copies you share, changed or not, must stay under the same license with their source code. Copyright © 2026 the 3DJames authors.')),
      h('pre', { class: 'lic-text' }, L.own || '')),
    h('p', { class: 'muted', style: 'margin:0' }, 'Built on these open-source projects. Click one to read its license.'),
    h('div', { class: 'lic-list' }, rows),
    h('details', { class: 'lic' }, h('summary', {}, h('b', {}, 'About OpenCascade and its source code')), h('pre', { class: 'lic-text' }, L.notice)),
  ], (close) => [h('button', { class: 'btn primary', onclick: close }, 'Close')]);
  document.querySelector('.modal-back:last-of-type .modal')?.classList.add('wide');
  return box;
}

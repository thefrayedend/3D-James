import { h, modal, toast } from './dom.js';
import { app } from '../state.js';

/** Bundled projects are copied before opening; the distributed example never changes. */
export function bindExamples(body) {
  for (const button of body.querySelectorAll('[data-example]')) button.addEventListener('click', async () => {
    const key = button.dataset.example, example = window.__3DJ_HELP?.examples?.[key];
    if (!example) return toast('This example is missing from the build.', 'err');
    if (button.dataset.action === 'download') {
      const bytes = Uint8Array.from(atob(example.archive), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      const link = h('a', { href: url, download: `${key}.3dj` });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    const open = async () => {
      const F = await import('../files.js');
      if (document.body.classList.contains('sketching')) throw new Error('Finish or cancel your sketch before opening an example.');
      F.loadProject(JSON.parse(JSON.stringify(example.doc)), null);
      app.dirty = true; F.updateTitle();
      toast('Opened an editable copy. Save as a .3dj project to keep your changes.');
    };
    const safelyOpen = async () => { try { await open(); } catch (err) { toast(err.message, 'err'); } };
    if (!app.dirty) return safelyOpen();
    modal('Open tutorial example?', h('p', {}, 'Your current project has unsaved changes. Cancel and save it first, or open the example without saving. The example opens as a new editable copy.'),
      (done) => [h('button', { class: 'btn', onclick: done }, 'Cancel'), h('button', { class: 'btn danger', onclick: () => { done(); safelyOpen(); } }, 'Open without saving')]);
  });
}

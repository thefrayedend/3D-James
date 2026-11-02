// Help > Send feedback: tell the people who make 3DJames about a problem or an idea. It opens a new report on the
// 3DJames page on GitHub, in the browser, already filled in: what you wrote, the version, and the model's problems.
// 3DJames itself sends nothing: you look it over and post it there (GitHub needs a free account). With "Attach this
// project", a copy of the project is saved to Downloads first, to drag into the report so the problem can be seen.
import { h, ic, modal, toast } from './ui/dom.js';
import { app } from './state.js';
import { store, describeFeature } from './store.js';
import { buildFileData } from './files.js';
import { inProgram } from './updates.js';

export const FEEDBACK_URL = 'https://github.com/thefrayedend/3D-James/issues/new';
const KINDS = [['problem', 'Something went wrong'], ['idea', 'An idea or a wish'], ['question', 'A question']];

/** What goes in the report besides the words: the version, where 3DJames runs, and the model's problems. */
export function feedbackDetails() {
  const ua = navigator.userAgent, browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone / iPad' : /Linux/.test(ua) ? 'Linux' : 'unknown';
  const lines = [`3DJames ${window.__3DJ_VERSION || '?'}, ${inProgram() ? 'the Windows program' : `in ${browser}`} on ${os}`,
    `The model: ${app.results.bodies.size} object(s), ${store.doc.features.length} step(s)`];
  const errs = Object.entries(app.results.errors || {});
  for (const [fid, msg] of errs.slice(0, 10)) {
    const f = store.doc.features.find((x) => x.id === fid);
    lines.push(`Problem in "${f?.name || (f ? describeFeature(f) : fid)}": ${msg}`);
  }
  if (app.engineError) lines.push(`Geometry engine: ${app.engineError}`);
  return lines;
}

export function feedbackDialog() {
  const kind = h('select', { class: 'in', style: 'width:100%', 'aria-label': 'What is it about' }, ...KINDS.map(([v, t]) => h('option', { value: v }, t)));
  if (Object.keys(app.results.errors || {}).length) kind.value = 'problem';
  const title = h('input', { class: 'in', style: 'width:100%;font-family:var(--ui)', placeholder: 'In a few words, for example: Hollow fails after a hinge', 'aria-label': 'Title' });
  const text = h('textarea', { class: 'in', rows: 6, style: 'width:100%;height:auto;padding:6px 8px;resize:vertical;font-family:var(--ui);font-size:13px;line-height:1.4', 'aria-label': 'What happened, or what you would like',
    placeholder: 'What did you do, what happened, and what did you expect? For an idea: what would you like 3DJames to do?' });
  const hasModel = store.doc.features.length > 0;
  const attach = h('input', { type: 'checkbox', checked: hasModel, disabled: !hasModel });
  const details = feedbackDetails();
  const row = (label, el) => h('label', { style: 'display:grid;gap:4px' }, h('span', { class: 'muted' }, label), el);
  const body = h('div', { style: 'display:grid;gap:12px' },
    h('p', { style: 'margin:0' }, 'This opens a new report on the 3DJames page on GitHub, in your browser, filled in with what you write here. Look it over there and click ', h('b', {}, 'Create'), ' to send it (GitHub needs a free account). 3DJames itself sends nothing.'),
    row('What is it about', kind), row('Title', title), row('Tell us more', text),
    h('label', { class: 'check', title: hasModel ? '' : 'There is nothing in this project yet' }, attach,
      'Attach this project, so the problem can be seen (a copy is saved to your Downloads folder: drag it into the report)'),
    h('details', {}, h('summary', { class: 'muted' }, 'Also put in the report'), h('pre', { class: 'lic-text', style: 'white-space:pre-wrap;margin:6px 0 0' }, details.join('\n'))));
  const close = modal('Send feedback', body, (done) => [
    h('button', { class: 'btn', onclick: done }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => send(done) }, ic('Send'), 'Open the report')]);
  document.querySelector('.modal-back:last-of-type .modal')?.classList.add('wide');
  title.focus();

  async function send(done) {
    const words = text.value.trim(), head = title.value.trim();
    if (!head && !words) { toast('Write a few words first: what happened, or what you would like.', 'err'); title.focus(); return; }
    let file = null;
    if (attach.checked) {
      try {
        // GitHub takes .zip files, not .3dj: a .3dj is a zip, so it is saved as name.3dj.zip (3DJames opens that too)
        const data = await buildFileData('3dj');
        file = `${(store.doc.name || 'model').trim().replace(/[^\w.-]+/g, '-') || 'model'}.3dj.zip`;
        const a = h('a', { href: URL.createObjectURL(new Blob([data], { type: 'application/zip' })), download: file });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      } catch (err) { toast(`The project could not be saved for the report: ${err.message}`, 'err', 7000); return; }
    }
    const label = KINDS.find(([v]) => v === kind.value)[1];
    const report = [words || '(no more words)', '', `**${label}**`, '', ...details.map((l) => `- ${l}`),
      ...(file ? ['', `The project: drag ${file} (in your Downloads folder) here.`] : [])].join('\n');
    const url = `${FEEDBACK_URL}?title=${encodeURIComponent(head || words.split('\n')[0].slice(0, 80))}&body=${encodeURIComponent(report)}`;
    window.open(url, '_blank', 'noopener');
    done();
    toast(file ? `The report opened in your browser. ${file} is in your Downloads folder: drag it into the report's text box, then click Create.` : 'The report opened in your browser: look it over, then click Create.', 'info', 12000);
  }
  return close;
}

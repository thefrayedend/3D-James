import { h, toast } from './dom.js';
import { exprField, selectField } from './fields.js';
import { parseLogo } from '../logo.js';

export function embossFields(model, change) {
  const fields = [selectField('Artwork', model.source || 'text', [['text', 'Text'], ['logo', 'SVG logo']], (v) => change({ source: v }))];
  if (model.source === 'logo') {
    fields.push(h('button', { class: 'btn', onclick: () => {
      const input = h('input', { type: 'file', accept: '.svg,image/svg+xml' });
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file) return;
        try { if (file.size > 2 * 1048576) throw new Error('Use an SVG smaller than 2 MB.'); change({ logo: parseLogo(await file.text(), file.name) }); }
        catch (err) { toast(err.message, 'err', 7000); }
      });
      input.click();
    } }, model.logo ? `Replace ${model.logo.label}` : 'Choose SVG logo…'), h('div', { class: 'muted' }, 'Filled SVG paths; text and strokes must be converted to outlines. Curves are approximated. The logo travels inside the project.'));
  } else fields.push(exprField('Text', model.text, (v) => change({ text: String(v) }), { text: true }),
    selectField('Font', model.font || 'sans', [['sans', 'DejaVu Sans Bold'], ['round', 'Poppins Bold']], (v) => change({ font: v })));
  for (const [key, label, step] of [['size', model.source === 'logo' ? 'Logo width (mm)' : 'Letter height (mm)', 1], ['depth', 'Depth (mm)', 0.1], ['u', 'Shift across face (mm)', 1], ['v', 'Shift up face (mm)', 1], ['angle', 'Turn on face (°)', 15]])
    fields.push(exprField(label, model[key] ?? 0, (v) => change({ [key]: v }), { step, slider: null }));
  fields.push(selectField('Action', model.mode || 'add', [['add', 'Raised (emboss)'], ['cut', 'Recessed (engrave)']], (v) => change({ mode: v })),
    h('div', { class: 'muted' }, 'Artwork is centered on the chosen flat face and clipped to its boundary. Shift and turn it to position the design.'));
  return fields;
}

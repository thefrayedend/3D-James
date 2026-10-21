// Read-only measurements use displayed geometry; no document or history mutations.
import { app, bodyData, bodyName } from './state.js';
import { vp } from './view.js';
import { h, toast } from './ui/dom.js';
import { selectField } from './ui/fields.js';
import { renderProps } from './ui/props.js';
import { endTool } from './tools.js';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const length = (p) => Math.hypot(...p);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function circleOf(points) {
  if (points.length < 8) return null;
  const p = points[0], a = sub(points[Math.floor(points.length / 3)], p), b = sub(points[Math.floor(points.length * 2 / 3)], p), n = cross(a, b), nn = dot(n, n);
  if (nn < 1e-12) return null;
  const bn = cross(b, n), na = cross(n, a), aa = dot(a, a), bb = dot(b, b);
  const center = p.map((v, i) => v + (aa * bn[i] + bb * na[i]) / (2 * nn));
  const radius = length(sub(center, p)), tolerance = Math.max(0.005, radius * 0.002), normalLength = Math.sqrt(nn);
  if (!Number.isFinite(radius) || radius < 1e-5 || points.some((q) => Math.abs(length(sub(q, center)) - radius) > tolerance || Math.abs(dot(sub(q, p), n)) / normalLength > tolerance)) return null;
  return { radius, closed: length(sub(points.at(-1), p)) < tolerance };
}
export function faceMeasurement(data, index) {
  const center = Array.from(data.faces.subarray(index * 6, index * 6 + 3));
  const normal = Array.from(data.faces.subarray(index * 6 + 3, index * 6 + 6));
  const start = data.faceRanges[index * 2], count = data.faceRanges[index * 2 + 1];
  let area = 0;
  for (let k = start; k < start + count; k += 3) {
    const p = [0, 1, 2].map((j) => Array.from(data.vertices.subarray(3 * data.triangles[k + j], 3 * data.triangles[k + j] + 3)));
    const a = sub(p[1], p[0]), b = sub(p[2], p[0]);
    area += length([a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]) / 2;
  }
  return { center, normal, area, flat: !!data.flat?.[index] };
}
export function edgeMeasurement(data, index) {
  const start = data.edgeRanges[index * 2], count = data.edgeRanges[index * 2 + 1];
  let total = 0;
  for (let k = start; k + 1 < start + count; k += 2) total += length(sub(Array.from(data.lines.subarray(k * 3, k * 3 + 3)), Array.from(data.lines.subarray((k + 1) * 3, (k + 1) * 3 + 3))));
  const points = [];
  for (let k = start; k < start + count; k++) points.push(Array.from(data.lines.subarray(k * 3, k * 3 + 3)));
  return { length: total, center: Array.from(data.edges.subarray(index * 6, index * 6 + 3)), circle: circleOf(points) };
}
export function measureResult(kind, items, getData = bodyData) {
  const out = { rows: [], points: [] };
  if (kind === 'point') out.points = items.map((x) => x.point);
  else if (kind === 'edge') {
    for (const [i, item] of items.entries()) {
      const edge = edgeMeasurement(getData(item.body), item.index);
      out.rows.push([`Edge ${i + 1} length (approx.)`, edge.length, 1]); out.points.push(item.point || edge.center);
      if (edge.circle) out.rows.push([edge.circle.closed ? `Circle ${i + 1} diameter (approx.)` : `Arc ${i + 1} radius (approx.)`, edge.circle.radius * (edge.circle.closed ? 2 : 1), 1]);
    }
  } else {
    const faces = items.map((item) => faceMeasurement(getData(item.body), item.index));
    for (const [i, f] of faces.entries()) out.rows.push([`Face ${i + 1} area (approx.)`, f.area, 2]);
    out.points = items.map((x, i) => x.point || faces[i].center);
    if (faces.length === 2 && faces.every((f) => f.flat)) {
      const n = faces.map((f) => f.normal.map((v) => v / (length(f.normal) || 1)));
      const cosine = Math.min(1, Math.abs(dot(n[0], n[1])));
      out.rows.push(['Angle between planes', Math.acos(cosine) * 180 / Math.PI, 0]);
      if (cosine > 0.999999) out.rows.push(['Parallel face gap', Math.abs(dot(sub(faces[1].center, faces[0].center), n[0])), 1]);
    }
  }
  if (out.points.length === 2) {
    const delta = sub(out.points[1], out.points[0]);
    out.rows.push([kind === 'point' ? 'Distance' : 'Distance between picked points', length(delta), 1], ...delta.map((v, i) => [`Δ${'XYZ'[i]}`, v, 1]));
  }
  return out;
}
export function setMeasureMode(kind) {
  const t = app.tool; if (t?.type !== 'measure') return;
  t.kind = kind; t.items = []; vp.setMeasurements([]);
  vp.startPick(kind, () => true, []); renderProps();
}
export function measurePick(hit) {
  const t = app.tool; if (t?.type !== 'measure') return;
  if (t.items.length === 2) t.items = [];
  if (t.kind !== 'point') {
    const existing = t.items.findIndex((x) => x.body === hit.body && x.index === hit.index);
    if (existing >= 0) t.items.splice(existing, 1); else t.items.push(hit);
  } else t.items.push(hit);
  vp.setPickItems(t.items);
  vp.setMeasurements(measureResult(t.kind, t.items).points);
  renderProps();
}
export function renderMeasurePanel(el) {
  const t = app.tool;
  const result = measureResult(t.kind, t.items);
  const factor = t.unit === 'in' ? 25.4 : 1;
  const text = result.rows.map(([name, value, power]) => `${name}: ${(value / (factor ** power)).toFixed(power ? 3 : 2)} ${power === 0 ? '°' : t.unit + (power === 2 ? '²' : '')}`);
  el.append(h('h2', {}, 'Measure'), h('p', { class: 'muted' }, 'Pick up to two surface points, edges, or faces. A third pick starts a new measurement. Measurements do not change the model.'),
    selectField('Pick', t.kind, [['point', 'Surface points (solids or meshes)'], ['edge', 'Edges (solids)'], ['face', 'Faces (solids)']], setMeasureMode),
    selectField('Units', t.unit, [['mm', 'Millimeters'], ['in', 'Inches']], (v) => { t.unit = v; renderProps(); }),
    h('div', { class: 'muted' }, `${t.items.length} picked${t.items.length ? ': ' + t.items.map((x) => bodyName(x.body)).join(', ') : ''}`),
    ...text.map((line) => h('div', { class: 'stat mono' }, line)),
    h('p', { class: 'muted' }, t.kind === 'face' ? 'Exact plane spacing is shown for parallel flat faces. Surface area uses the display triangles. Other distances are between the actual picked points, not a minimum surface gap.' : t.kind === 'edge' ? 'Curved-edge length uses the display segments and is approximate.' : 'Near a triangle vertex, points snap to that displayed vertex. Coordinates use the model axes.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => setMeasureMode(t.kind) }, 'Clear'),
      h('button', { class: 'btn', disabled: !text.length, onclick: async () => { try { await navigator.clipboard.writeText(text.join('\n')); toast('Measurements copied.'); } catch { toast('Clipboard is unavailable here. Select and copy the values above.'); } } }, 'Copy values'),
      h('button', { class: 'btn primary', onclick: endTool }, 'Done')));
}

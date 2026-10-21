import { store, featureRefs } from './store.js';

/** Immediate geometry dependencies, including the preceding operation on each body. */
export function historyDependencies(doc) {
  const writer = new Map(), graph = new Map();
  for (const f of doc.features) {
    const inputs = f.type === 'shape' ? [] : f.type === 'copy' ? [f.src] : featureRefs(f).filter((id) => !(f.type === 'split' && id === f.body2));
    graph.set(f.id, [...new Set(inputs.map((id) => writer.get(id)).filter(Boolean))]);
    for (const id of featureRefs(f)) if (id !== f.src || f.body === f.src) writer.set(id, f.id);
  }
  return graph;
}
export function dependentSteps(doc, id) {
  const graph = historyDependencies(doc), found = new Set([id]);
  for (const f of doc.features) if ((graph.get(f.id) || []).some((dep) => found.has(dep))) found.add(f.id);
  found.delete(id); return [...found];
}
export function canMoveFeature(doc, id, delta) {
  const list = doc.features.slice(), i = list.findIndex((f) => f.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return false;
  const graph = historyDependencies(doc);
  [list[i], list[j]] = [list[j], list[i]];
  const order = new Map(list.map((f, k) => [f.id, k]));
  return [...graph].every(([fid, deps]) => deps.every((dep) => order.get(dep) < order.get(fid)));
}
export function moveFeature(id, delta) {
  if (!canMoveFeature(store.doc, id, delta)) return false;
  return store.commit((doc) => { const i = doc.features.findIndex((f) => f.id === id), j = i + delta; [doc.features[i], doc.features[j]] = [doc.features[j], doc.features[i]]; });
}

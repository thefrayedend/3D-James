// Document model, undo/redo and history helpers.
import { SHAPES, AUTO_COLORS, PLAIN_COLOR } from './shared.js';

export function emptyDoc() {
  return { v: 1, name: 'Untitled', vars: [], bodies: {}, features: [], seq: 1, counters: {} };
}

/**
 * Fill in anything a project file left out (files written by hand or by other tools often skip
 * defaults), so every part of 3DJames can count on a complete project.
 */
export function normalizeDoc(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Invalid project document.');
  if (doc.features != null && !Array.isArray(doc.features)) throw new Error('The project feature list is invalid.');
  if (doc.vars != null && !Array.isArray(doc.vars)) throw new Error('The project variable list is invalid.');
  if (doc.bodies != null && (typeof doc.bodies !== 'object' || Array.isArray(doc.bodies))) throw new Error('The project object list is invalid.');
  for (const f of doc.features || []) {
    if (!f || typeof f !== 'object' || typeof f.type !== 'string' || typeof f.id !== 'string') throw new Error('The project contains an invalid feature.');
    for (const key of ['tools', 'edges', 'faces']) if (f[key] != null && !Array.isArray(f[key])) throw new Error(`Invalid ${key} in the project.`);
    for (const key of ['pos', 'rot']) if (f[key] != null && (!Array.isArray(f[key]) || f[key].length !== 3)) throw new Error(`Invalid ${key} in the project.`);
  }
  if (doc.versions != null && (!Array.isArray(doc.versions) || doc.versions.length > 200 || doc.versions.some((v) => !v || typeof v.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(v.id) || typeof v.label !== 'string' || !Number.isFinite(v.t)))) throw new Error('The project version list is invalid.');
  const d = { ...emptyDoc(), ...doc };
  delete d.plate; // left over from the BuildPlate days
  d.bodies = { ...d.bodies };
  d.features = (d.features || []).map((f) => {
    if (f.type !== 'shape') return f;
    return { ...f, p: { ...(SHAPES[f.kind]?.defaults || {}), ...f.p }, pos: f.pos || [0, 0, 0], rot: f.rot || [0, 0, 0] };
  });
  let maxId = 0;
  for (const id of [...d.features.map((f) => f.id), ...d.features.flatMap(featureRefs), ...Object.keys(d.bodies)]) {
    const n = +String(id).replace(/^[a-z]+/i, '');
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
  }
  d.seq = Math.max(d.seq || 1, maxId + 1);
  for (const id of new Set(d.features.flatMap(featureRefs))) if (!d.bodies[id]) d.bodies[id] = { name: 'Object', color: PLAIN_COLOR };
  return d;
}

export const store = {
  doc: emptyDoc(),
  revision: 0,
  undoStack: [],
  redoStack: [],
  listeners: new Set(),
  onChange(fn) { this.listeners.add(fn); },
  emit(kind) { this.revision++; for (const fn of this.listeners) fn(kind); },

  newId(prefix) { const id = prefix + this.doc.seq; this.doc.seq += 1; return id; },

  /** Apply a change as one undo step. `kind` is 'geom' when a rebuild is needed. */
  commit(mutator, kind = 'geom') {
    const before = JSON.stringify(this.doc);
    const r = mutator(this.doc);
    if (r === false) return false;
    const after = JSON.stringify(this.doc);
    if (after === before) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > 300) this.undoStack.shift();
    this.redoStack.length = 0;
    this.save();
    this.emit(kind);
    return true;
  },
  // Live edits (scrubbing a value) rebuild without adding undo steps until they end.
  beginTransient() { this.transientBase = JSON.stringify(this.doc); },
  transient(mutator) { mutator(this.doc); this.emit('geom'); },
  endTransient() {
    if (this.transientBase == null) return;
    const before = this.transientBase; this.transientBase = null;
    if (JSON.stringify(this.doc) !== before) { this.undoStack.push(before); if (this.undoStack.length > 300) this.undoStack.shift(); this.redoStack.length = 0; this.save(); this.emit('ui'); }
  },
  /** Change the document as part of the previous undo step (used for automatic follow-ups). */
  amend(mutator) { mutator(this.doc); this.save(); this.emit('geom'); },
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.undoStack.pop());
    this.save(); this.emit('geom');
    return true;
  },
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(this.redoStack.pop());
    this.save(); this.emit('geom');
    return true;
  },
  load(doc) {
    const normalized = normalizeDoc(doc);
    this.undoStack.push(JSON.stringify(this.doc));
    this.redoStack.length = 0;
    this.doc = normalized;
    this.save(); this.emit('geom');
  },
  /** Called after every change; the app points this at its background backup. */
  save() {},
};

// ---------- helpers ----------
export const featureRefs = (f) => [f.body, f.src, f.body2, ...(f.tools || [])].filter(Boolean);

/** All features that touch a body (directly). */
export function featuresOfBody(doc, id) {
  return doc.features.filter((f) => featureRefs(f).includes(id));
}

/**
 * How an object was made, as a tree: every step that changed it, in order. Under a step that used other
 * objects (merge/subtract, a copy, the second half of a split) are those objects with their own steps.
 */
export function stepTree(doc, id, before = doc.features.length) {
  const out = [];
  for (let i = 0; i < before; i++) {
    const f = doc.features[i];
    if (f.body !== id && !(f.type === 'split' && f.body2 === id)) continue;
    let uses = [];
    if (f.type === 'combine') uses = f.tools;
    else if (f.type === 'copy') uses = [f.src];
    else if (f.type === 'split' && f.body !== id) uses = [f.body];
    out.push({ f, uses: uses.map((b) => ({ body: b, steps: stepTree(doc, b, i) })) });
  }
  return out;
}

/** The feature that created the body. */
export function creatorOf(doc, id) {
  return doc.features.find((f) => (f.type === 'shape' && f.body === id) || (f.type === 'copy' && f.body === id) || (f.type === 'split' && f.body2 === id));
}

/** A body that is only its creation shape feature (so moving/scaling edits its parameters). */
export function isSimplePrimitive(doc, id) {
  const fs = featuresOfBody(doc, id);
  return fs.length === 1 && fs[0].type === 'shape' && fs[0].body === id;
}

/** Last feature that targets this body (as its main body). */
export function lastFeatureOf(doc, id) {
  for (let i = doc.features.length - 1; i >= 0; i--) {
    const f = doc.features[i];
    if (featureRefs(f).includes(id)) return f;
  }
  return null;
}

export function nextName(doc, base) {
  doc.counters = doc.counters || {};
  doc.counters[base] = (doc.counters[base] || 0) + 1;
  return `${base} ${doc.counters[base]}`;
}

export function nextColor(doc) {
  const n = Object.keys(doc.bodies).length;
  return AUTO_COLORS[n % AUTO_COLORS.length];
}

export function shapeLabel(kind) { return SHAPES[kind]?.label || kind; }

export function describeFeature(doc, f) {
  const bn = (id) => doc.bodies[id]?.name || 'object';
  switch (f.type) {
    case 'shape': return { title: bn(f.body), sub: shapeLabel(f.kind) };
    case 'copy': return { title: bn(f.body), sub: `Copy of ${bn(f.src)}` };
    case 'move': return { title: 'Move', sub: bn(f.body) };
    case 'combine': return { title: { union: 'Merge', subtract: 'Subtract', intersect: 'Intersect' }[f.op] || 'Combine', sub: `${bn(f.body)} + ${f.tools.length}` };
    case 'fillet': return { title: 'Fillet', sub: `${bn(f.body)} · ${f.edges.length} edge${f.edges.length === 1 ? '' : 's'}` };
    case 'chamfer': return { title: 'Chamfer', sub: `${bn(f.body)} · ${f.edges.length} edge${f.edges.length === 1 ? '' : 's'}` };
    case 'shell': return { title: 'Hollow', sub: bn(f.body) };
    case 'mirror': return { title: f.copy ? 'Mirror copy' : 'Mirror', sub: `${bn(f.body)} · ${String(f.axis).toUpperCase()}` };
    case 'array': return { title: 'Pattern', sub: `${bn(f.body)} · ${f.kind === 'circular' ? 'circular' : 'linear'}` };
    case 'split': return { title: 'Split', sub: bn(f.body) };
    case 'extrude': return { title: f.mode === 'cut' ? 'Cut into face' : 'Extrude on face', sub: bn(f.body) };
    case 'emboss': return { title: f.mode === 'cut' ? 'Engrave' : 'Emboss', sub: `${bn(f.body)} · ${f.source === 'logo' ? f.logo?.label || 'SVG logo' : f.text}` };
    case 'pushpull': return { title: 'Push/pull', sub: `${bn(f.body)} · ${f.d} mm` };
    case 'delete': return { title: 'Delete', sub: bn(f.body) };
    default: return { title: f.type, sub: '' };
  }
}

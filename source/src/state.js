// What the interface is showing right now (selection, open tool, last build results) and the user's settings.
import { store } from './store.js';
import { varScope } from './shared.js';

export const app = {
  sel: [], // selected object ids
  feature: null, // step being edited (id), or null
  tool: null, // open picking tool (fillet, split, push/pull, ...)
  results: { bodies: new Map(), errors: {}, heights: {}, ghosts: [], ms: 0 },
  gizmo: 'translate',
  building: false, pending: false, builtRevision: -1, engineError: null, backupError: null,
  tab: 'Insert', panelTab: 'props',
  historyAll: false, // History shows every step instead of just the selected object's
  file: null, // { name, fmt, handle } of the open file
  dirty: false,
  settings: { grid: 1, rot: 15, edges: true, theme: 'auto', lock: true, panelOpen: false, printer: null, unit: 'mm', display: 'solid', flat: false, ruler: false },
};

const SETTINGS_KEY = '3djames.settings';
try {
  // (3DJames was called BuildPlate in its first days; pick up settings saved under that name once)
  const saved = localStorage.getItem(SETTINGS_KEY) ?? localStorage.getItem('buildplate.settings');
  Object.assign(app.settings, JSON.parse(saved || '{}'));
  localStorage.removeItem('buildplate.settings');
} catch { /* storage unavailable */ }
export const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(app.settings)); } catch { /* storage unavailable */ } };

export const scope = () => varScope(store.doc.vars);
export const bodyData = (id) => app.results.bodies.get(id);
export const bodyName = (id) => store.doc.bodies[id]?.name || 'Object';

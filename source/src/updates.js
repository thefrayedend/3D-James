// Updates in the installed Windows program. The program (3DJames.exe, source in Installation/build/App.cs) looks on GitHub
// for a newer 3DJames.html once, a few seconds after it starts, keeps the newest copy in the user's own app data folder and
// shows it from the next start. This is the page's side: it listens to what the program says, tells the user when a newer
// version is ready, and drives the switch and the "Check now" button in Help > Licenses and components.
//
//   page -> program (strings):  __3dj_status  __3dj_check  __3dj_updates_on  __3dj_updates_off
//   program -> page (JSON):     { type: '3dj-update', status, version, current, enabled }
//   status: idle | checking | current | downloaded | offline | failed
//
// In a browser (or the 3DJames box) there is no program: window.__3DJ_HOST is not set and none of this shows.
import { toast } from './ui/dom.js';

const host = () => window.chrome?.webview;
export const inProgram = () => !!(host() && window.__3DJ_HOST?.program);

export const update = { status: 'idle', version: null, current: null, enabled: true };
const listeners = new Set();
let told = null;

/** Called by About: runs `fn` with the state now and on every change. Returns a function that stops listening. */
export function watchUpdates(fn) { listeners.add(fn); fn(update); return () => listeners.delete(fn); }

export function startUpdates() {
  if (!inProgram()) return;
  update.enabled = window.__3DJ_HOST.updates !== false;
  host().addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.type !== '3dj-update') return;
    Object.assign(update, { status: m.status, version: m.version ?? null, current: m.current ?? null, enabled: m.enabled !== false });
    if (m.status === 'downloaded' && told !== m.version) {
      told = m.version;
      toast(`3DJames ${m.version} has been downloaded. It opens the next time you start 3DJames.`, 'info', 10000);
    }
    for (const fn of listeners) fn(update);
  });
  host().postMessage('__3dj_status');
}

export const checkNow = () => host()?.postMessage('__3dj_check');
export function setUpdatesOn(on) { update.enabled = on; host()?.postMessage(on ? '__3dj_updates_on' : '__3dj_updates_off'); }

/** What to tell the user about where updates stand. */
export function updateText(u = update) {
  switch (u.status) {
    case 'checking': return 'Looking for a newer version…';
    case 'current': return `You have the newest version (${u.current || u.version}).`;
    case 'downloaded': return `Version ${u.version} is downloaded. It opens the next time you start 3DJames.`;
    case 'offline': return 'Could not reach GitHub. Try again when you are online.';
    case 'failed': return 'Could not get the update just now. It will try again next time.';
    default: return u.enabled ? 'It looks once, a few seconds after 3DJames starts.' : 'Automatic checks are off. "Check now" still works.';
  }
}

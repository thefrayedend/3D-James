// 3DJames admin page: set up the box, users and their folders, storage places (this box, a USB drive or a NAS), the shared
// folder, app updates, network and the box itself. Talks to the admin API of 3djames_server.py.
'use strict';

const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v; else if (k === 'checked') el.checked = !!v; else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
let toastTimer;
function toast(msg, err) { const t = $('toast'); t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block'; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, err ? 8000 : 3500); }
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof Blob) opts.body = body; else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({ ok: false, message: `The box said ${r.status}` }));
  if (r.status === 401 && j.signedIn === false) { start(); throw new Error(j.message); }
  if (!r.ok || j.ok === false) throw new Error(j.message || `The box said ${r.status}`);
  return j;
}
const run = (fn) => async (e) => { const b = e?.currentTarget; if (b) b.disabled = true; try { await fn(); } catch (err) { toast(err.message, true); } finally { if (b) b.disabled = false; } };
const field = (label, input, hint) => h('div', {}, h('label', {}, label), input, hint ? h('div', { class: 'muted' }, hint) : null);
const input = (attrs) => h('input', attrs);
const check = (label, on, hint) => { const c = input({ type: 'checkbox', checked: on }); return [h('label', { class: 'check' }, c, label), hint ? h('div', { class: 'muted' }, hint) : null, c]; };
const gb = (n) => (n / 1e9).toFixed(n > 1e11 ? 0 : 1) + ' GB';
const when = (t) => new Date(t).toLocaleString();

let S = null, tab = 'users';

// ---------------------------------------------------------------- start: set up, sign in, or the pages
async function start() {
  const st = await api('/api/state');
  $('tabs').hidden = true; $('who').textContent = '';
  if (st.setup) return setupPage(st);
  if (!st.signedIn) return loginPage(st);
  await load();
}
function setupPage(st) {
  const u = input({ value: '', placeholder: 'alex', autocapitalize: 'none' }), n = input({ placeholder: 'Alex' }), p1 = input({ type: 'password' }), p2 = input({ type: 'password' });
  $('main').replaceChildren(h('div', { class: 'card narrow' }, h('h2', {}, 'Welcome to your 3DJames box'),
    h('p', { class: 'muted' }, 'First, make the admin account (that\'s you). You can add more people afterwards.'),
    field('Sign-in name', u, 'Short, lower-case, no spaces.'), field('Your name', n), field('Password', p1), field('Password again', p2),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: run(async () => {
      if (p1.value !== p2.value) throw new Error('The two passwords are not the same.');
      await api('/api/setup', { user: u.value, name: n.value, password: p1.value });
      toast('Done! You are the admin.'); await load();
    }) }, 'Create the admin account'))));
  u.focus();
}
function loginPage() {
  const u = input({ autocapitalize: 'none', autocomplete: 'username' }), p = input({ type: 'password', autocomplete: 'current-password' });
  const go = run(async () => { await api('/api/login', { user: u.value, password: p.value }); await load(); });
  p.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  $('main').replaceChildren(h('div', { class: 'card narrow' }, h('h2', {}, 'Admin sign-in'), field('Name', u), field('Password', p),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: go }, 'Sign in'))));
  u.focus();
}
async function load() {
  S = await api('/api/overview');
  $('who').replaceChildren(`Signed in as ${S.me} · `, h('a', { href: '#', style: 'color:#fff', onclick: run(async () => { await api('/api/logout', {}); start(); }) }, 'Sign out'));
  $('tabs').hidden = false;
  for (const b of $('tabs').children) { b.classList.toggle('on', b.dataset.tab === tab); b.onclick = () => { tab = b.dataset.tab; load().catch((e) => toast(e.message, true)); }; }
  ({ users, storage, shared, app, box })[tab]();
}
const placeOptions = (sel) => Object.entries(S.config.places).map(([id, p]) => h('option', { value: id, selected: id === sel }, p.label));
const appAddress = () => `http://${S.host}.local${S.appPort === 80 ? '' : ':' + S.appPort}`;

// ---------------------------------------------------------------- users
function users() {
  const U = S.config.users;
  const rows = Object.entries(U).sort().map(([name, u]) => h('tr', {},
    h('td', {}, h('b', {}, name), h('div', { class: 'muted' }, u.name || '')),
    h('td', {}, u.admin ? h('span', { class: 'pill ok' }, 'admin') : ''),
    h('td', {}, (u.folders || []).map((f) => h('div', {}, `${f.label}: ${S.config.places[f.place]?.label || f.place} / ${f.path || '(top)'}${f.write ? '' : ' (read-only)'}`)),
      S.config.shared.enabled && u.shared ? h('div', { class: 'muted' }, `+ ${S.config.shared.label}`) : null),
    h('td', {}, h('button', { class: 'btn', onclick: () => editUser(name) }, 'Edit'))));
  $('main').replaceChildren(
    h('div', { class: 'card' }, h('h2', {}, 'People who can use 3DJames'),
      h('p', { class: 'muted' }, `They open `, h('b', {}, appAddress()), ` and sign in. Their folders show up in Open and Save.`),
      h('table', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, ''), h('th', {}, 'Folders'), h('th', {}, '')), rows),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => editUser(null) }, 'Add a person'))));
}
function editUser(name) {
  const isNew = !name, u = isNew ? { folders: [], shared: true } : S.config.users[name];
  const un = input({ value: name || '', disabled: !isNew, autocapitalize: 'none', placeholder: 'sam' });
  const dn = input({ value: u.name || '', placeholder: 'Sam' });
  const pw = input({ type: 'password', placeholder: isNew ? '' : 'leave empty to keep it' });
  const [admL, admH, adm] = check('Admin (may use this admin page)', u.admin);
  const [shL, shH, sh] = check(`May use the shared folder ("${S.config.shared.label}")`, u.shared, S.config.shared.enabled ? '' : 'The shared folder is switched off (Shared folder tab).');
  const folders = (u.folders?.length ? u.folders : [{ label: 'My files', place: 'box', path: `users/${name || ''}`, write: true }]).map((f) => ({ ...f }));
  const list = h('div');
  const drawFolders = () => list.replaceChildren(...folders.map((f, i) => {
    const lab = input({ value: f.label, oninput: (e) => { f.label = e.target.value; } });
    const pl = h('select', { onchange: (e) => { f.place = e.target.value; } }, placeOptions(f.place));
    const pa = input({ value: f.path, placeholder: 'folder inside it', oninput: (e) => { f.path = e.target.value; } });
    const wr = input({ type: 'checkbox', checked: f.write, onchange: (e) => { f.write = e.target.checked; } });
    return h('div', { class: 'folder' }, lab, pl, pa, h('label', { class: 'check', title: 'May save there' }, wr, 'save'), h('button', { class: 'btn', title: 'Remove', onclick: () => { folders.splice(i, 1); drawFolders(); } }, '✕'));
  }));
  drawFolders();
  if (isNew) un.addEventListener('input', () => { const f = folders[0]; if (f && /^users\//.test(f.path)) { f.path = `users/${un.value.trim().toLowerCase()}`; drawFolders(); } });
  $('main').replaceChildren(h('div', { class: 'card' }, h('h2', {}, isNew ? 'Add a person' : `Edit ${name}`),
    h('div', { class: 'row' }, field('Sign-in name', un, 'Lower-case, no spaces.'), field('Name shown', dn), field(isNew ? 'Password' : 'New password', pw, 'At least 6 characters.')),
    admL, admH, shL, shH,
    h('h3', {}, 'Folders'), h('div', { class: 'muted' }, 'Where this person opens and saves. Label · storage place · folder inside it · may save. The first one you may save to also holds their My parts.'),
    list, h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: () => { folders.push({ label: 'Files', place: 'box', path: '', write: true }); drawFolders(); } }, 'Add a folder')),
    h('div', { class: 'btns' },
      h('button', { class: 'btn primary', onclick: run(async () => { await api('/api/user/save', { isNew, user: un.value, name: dn.value, password: pw.value, admin: adm.checked, shared: sh.checked, folders }); toast('Saved.'); tab = 'users'; await load(); }) }, 'Save'),
      h('button', { class: 'btn', onclick: () => load() }, 'Cancel'),
      isNew ? null : h('button', { class: 'btn danger', onclick: run(async () => { if (!confirm(`Remove ${name}? Their files stay where they are.`)) return; const r = await api('/api/user/delete', { user: name }); toast(r.message); await load(); }) }, 'Remove this person'))));
}

// ---------------------------------------------------------------- storage places
function storage() {
  const P = S.config.places;
  const kind = { local: 'On this box', usb: 'USB drive', smb: 'NAS share (Windows file sharing)', nfs: 'Network share (NFS)' };
  const where = (p) => p.type === 'local' ? (p.path || 'the SD card') : p.type === 'smb' ? `\\\\${p.server}\\${p.share}` : p.type === 'usb' ? (p.name || 'USB drive') : `${p.server}:${p.export}`;
  const status = (p) => p.connected ? (p.type === 'usb' ? 'ready' : p.type === 'local' ? 'ready' : 'connected') : p.type === 'usb' ? 'not plugged in' : 'not connected';
  const rows = Object.entries(P).map(([id, p]) => h('tr', {},
    h('td', {}, h('b', {}, p.label), h('div', { class: 'muted' }, kind[p.type])),
    h('td', { class: 'muted' }, where(p)),
    h('td', {}, h('span', { class: 'pill ' + (p.connected ? 'ok' : 'bad') }, status(p)),
      p.space ? h('div', { class: 'muted' }, `${gb(p.space.free)} free of ${gb(p.space.total)}`) : null,
      !p.connected && p.problem && p.type !== 'usb' ? h('div', { class: 'muted' }, p.problem) : null),
    h('td', { class: 'muted' }, p.used.length ? `Used by ${p.used.join(', ')}` : 'Not used yet'),
    h('td', {}, p.type !== 'local' ? h('button', { class: 'btn', onclick: run(async () => { const r = await api('/api/place/connect', { id }); toast(r.message || 'Connected.'); await load(); }) }, p.type === 'usb' ? 'Check' : 'Reconnect') : null,
      id !== 'box' ? h('button', { class: 'btn', onclick: () => editPlace(id) }, 'Edit') : null)));
  const cards = [h('div', { class: 'card' }, h('h2', {}, 'Where files are kept'),
    h('p', { class: 'muted' }, 'Each person\'s folders are inside one of these: this box (the SD card), a USB drive plugged into the box, or a share on your NAS (so it is backed up with everything else).'),
    h('table', {}, h('tr', {}, h('th', {}, 'Place'), h('th', {}, 'Where'), h('th', {}, 'Status'), h('th', {}, ''), h('th', {}, '')), rows),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: () => editPlace(null, 'smb') }, 'Add a NAS share')),
    h('p', { class: 'muted' }, 'Next: give people a folder there (Users tab > Edit > Add a folder, and pick it under "storage place").'))];
  if (S.usb) {
    const free = S.usb.filter((d) => !d.place);
    cards.push(h('div', { class: 'card' }, h('h2', {}, 'USB drives'),
      free.length ? h('table', {}, free.map((d) => h('tr', {},
        h('td', {}, h('b', {}, d.name), h('div', { class: 'muted' }, `${gb(d.size)} · ${d.fstype}`)),
        h('td', {}, h('button', { class: 'btn primary', onclick: run(async () => {
          toast('Getting the drive ready…');
          const r = await api('/api/place/save', { type: 'usb', uuid: d.uuid, label: d.name === 'USB drive' ? 'USB drive' : `USB: ${d.name}` }); toast(r.message || 'Ready.'); tab = 'storage'; await load();
        }) }, 'Use this drive')))))
        : h('p', { class: 'muted' }, S.usb.length ? 'Every USB drive plugged in is already in the list above.' : 'No USB drive is plugged in. Plug one into the box (formatted by Windows or a Mac: exFAT, FAT32 or NTFS), then click Look again.'),
      h('p', { class: 'muted' }, 'Files are kept in normal folders on the drive, so you can also plug it into a PC and see them. Wait until saving has finished before you pull the drive out.'),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run(async () => { await load(); }) }, 'Look again'))));
  }
  $('main').replaceChildren(...cards);
}
function editPlace(id, newType) {
  const p = id ? S.config.places[id] : { type: newType, label: 'NAS' };
  const label = input({ value: p.label }), fields = { label };
  const body = [field('Name shown in 3DJames and here', label)];
  if (p.type === 'local') { fields.path = input({ value: p.path || '', placeholder: '/srv/3djames' }); body.push(field('Folder on this box', fields.path, 'The full path. Made if it is not there.')); }
  else if (p.type === 'usb') body.push(h('p', { class: 'muted' }, `The USB drive "${p.name || 'USB drive'}". Files stay on the drive when you remove it here.`));
  else if (p.type === 'smb') {
    fields.server = input({ value: p.server || '', placeholder: '192.168.1.20 or mynas.local' });
    fields.share = input({ value: p.share || '', placeholder: 'Files' }); fields.username = input({ value: p.username || '', autocapitalize: 'none' });
    fields.password = input({ type: 'password', placeholder: id && p.username ? 'leave empty to keep it' : '' }); fields.domain = input({ value: p.domain || '', placeholder: '(usually empty)' });
    body.push(h('div', { class: 'row' }, field('NAS name or address', fields.server, 'Like 192.168.1.20. (In Windows it is the part after \\\\.)'), field('Share name', fields.share, 'The first folder under the NAS, like Files.')),
      h('div', { class: 'row' }, field('NAS user name', fields.username, 'Leave empty if the share needs no password.'), field('NAS password', fields.password), field('Domain / workgroup', fields.domain)),
      h('p', { class: 'muted' }, 'Example: if Windows shows the folder as \\\\192.168.1.50\\Alex\\3D Objects, the NAS address is 192.168.1.50 and the share name is Alex. Pick the "3D Objects" folder inside it later, when you give someone a folder (Users tab). 3DJames keeps people out of each other\'s folders.'));
  } else {
    fields.server = input({ value: p.server || '' }); fields.export = input({ value: p.export || '' });
    body.push(field('NAS name or address', fields.server), field('Exported folder', fields.export));
  }
  const save = run(async () => {
    const b = { id, type: p.type };
    for (const [k, el] of Object.entries(fields)) b[k] = el.value;
    if (p.type === 'smb') toast('Connecting… (3DJames saves a small test file there and deletes it again)');
    const r = await api('/api/place/save', b); toast(r.message || 'Saved.'); tab = 'storage'; await load();
  });
  $('main').replaceChildren(h('div', { class: 'card' }, h('h2', {}, id ? `Edit ${p.label}` : 'Add a NAS share'), ...body,
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: save }, p.type === 'smb' ? 'Save and connect' : 'Save'), h('button', { class: 'btn', onclick: () => load() }, 'Cancel'),
      id ? h('button', { class: 'btn danger', onclick: run(async () => { if (!confirm(`Remove ${p.label}? Files on it are not deleted.`)) return; await api('/api/place/delete', { id }); toast('Removed.'); await load(); }) }, 'Remove') : null)));
}

// ---------------------------------------------------------------- the shared folder
function shared() {
  const s = S.config.shared;
  const [onL, onH, on] = check('Switch on the shared folder', s.enabled, 'People you allow (Users tab) see it in Open and Save, next to their own folders.');
  const label = input({ value: s.label }), place = h('select', {}, placeOptions(s.place)), path = input({ value: s.path });
  const [wL, wH, wr] = check('Everyone may save into it', s.write, 'Switched off: they can only open files from it.');
  const who = Object.entries(S.config.users).filter(([, u]) => u.shared).map(([n]) => n);
  $('main').replaceChildren(h('div', { class: 'card' }, h('h2', {}, 'Shared folder'), onL, onH,
    h('div', { class: 'row' }, field('Name shown', label), field('Kept on', place), field('Folder', path)), wL, wH,
    h('p', { class: 'muted' }, who.length ? `Allowed now: ${who.join(', ')}.` : 'Nobody is allowed yet: tick "May use the shared folder" for people on the Users tab.'),
    h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: run(async () => { await api('/api/shared/save', { enabled: on.checked, label: label.value, place: place.value, path: path.value, write: wr.checked }); toast('Saved.'); await load(); }) }, 'Save'))));
}

// ---------------------------------------------------------------- the app
function app() {
  const a = S.app, prev = S.previousApp;
  const file = input({ type: 'file', accept: '.html' });
  const upload = run(async () => {
    const f = file.files[0]; if (!f) throw new Error('Pick the new 3DJames.html first.');
    toast(`Uploading ${f.name} (${(f.size / 1e6).toFixed(0)} MB)…`);
    const r = await api('/api/app', f, 'PUT'); toast(r.message); await load();
  });
  const [usL, usH, us] = check('Update folder on the network', S.config.settings.updateShare, `Copy a new 3DJames.html into \\\\${S.host}\\3DJames-update from any Windows PC and it is installed by itself within a few seconds (sign in there as "threedjames" with the password below).`);
  const pw = input({ type: 'password', placeholder: S.config.settings.updateShare ? 'leave empty to keep it' : 'password for the update folder' });
  $('main').replaceChildren(
    h('div', { class: 'card' }, h('h2', {}, 'The 3DJames app'),
      a ? h('p', {}, h('b', {}, `Version ${a.version}`), h('span', { class: 'muted' }, ` · ${(a.size / 1e6).toFixed(1)} MB · installed ${when(a.installed)}`)) : h('p', {}, 'Not installed yet.'),
      h('p', { class: 'muted' }, 'To update: build or download the new 3DJames.html and upload it here. People get it the next time they open or reload the app. Nothing else on the box changes.'),
      field('New app file (3DJames.html)', file),
      h('div', { class: 'btns' }, h('button', { class: 'btn primary', onclick: upload }, 'Upload and install'),
        prev ? h('button', { class: 'btn', onclick: run(async () => { if (!confirm(`Go back to version ${prev.version}?`)) return; const r = await api('/api/app/rollback', {}); toast(r.message); await load(); }) }, `Go back to ${prev.version}`) : null)),
    h('div', { class: 'card' }, h('h2', {}, 'Update folder'), usL, usH, field('Password for the update folder', pw),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run(async () => { const r = await api('/api/update-share', { enabled: us.checked, password: pw.value }); toast(r.message || 'Saved.'); await load(); }) }, 'Save'))));
}

// ---------------------------------------------------------------- network & box
async function box() {
  const sysCard = h('div', { class: 'card' }, h('h2', {}, 'This box'), h('p', { class: 'muted' }, 'Loading…'));
  const netCard = h('div', { class: 'card' }, h('h2', {}, 'Network'), h('p', { class: 'muted' }, 'Loading…'));
  const name = input({ value: S.host, autocapitalize: 'none' });
  const oldPw = input({ type: 'password' }), newPw = input({ type: 'password' });
  const srv = input({ type: 'file', accept: '.zip' });
  $('main').replaceChildren(
    h('div', { class: 'card' }, h('h2', {}, 'Addresses'),
      h('p', {}, 'The app: ', h('b', {}, appAddress()), h('br'), 'This admin page: ', h('b', {}, `http://${S.host}.local:${S.adminPort}`)),
      h('p', { class: 'muted' }, 'If a .local name doesn\'t open on some device, use the box\'s number address shown under Network instead.')),
    netCard, sysCard,
    h('div', { class: 'card' }, h('h2', {}, 'Box name'), field('Name on the network', name, 'The app is then at http://<name>.local'),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run(async () => { const r = await api('/api/system/hostname', { name: name.value }); toast(r.message); }) }, 'Rename'))),
    h('div', { class: 'card' }, h('h2', {}, 'My admin password'), h('div', { class: 'row' }, field('Current password', oldPw), field('New password', newPw)),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run(async () => { const r = await api('/api/password', { old: oldPw.value, new: newPw.value }); toast(r.message); oldPw.value = newPw.value = ''; }) }, 'Change password'))),
    h('div', { class: 'card' }, h('h2', {}, 'Server program'), h('p', { class: 'muted' }, `Version ${S.server}. Only needed for fixes to the server itself (not for app updates): upload a 3djames-server zip.`),
      field('Server update (.zip)', srv), h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run(async () => { const f = srv.files[0]; if (!f) throw new Error('Pick the server zip first.'); const r = await api('/api/server-update', f, 'PUT'); toast(r.message || 'Updated. The server restarts.'); }) }, 'Update the server')),
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run(async () => { if (confirm('Restart the box? It is back in about a minute.')) toast((await api('/api/system/reboot', {})).message || 'Restarting…'); }) }, 'Restart the box'),
        h('button', { class: 'btn danger', onclick: run(async () => { if (confirm('Shut the box down? Unplug and plug it in to start it again.')) toast((await api('/api/system/shutdown', {})).message || 'Shutting down…'); }) }, 'Shut down'))));
  if (!S.helper) { sysCard.lastChild.textContent = 'System details are only available on the 3DJames box.'; netCard.lastChild.textContent = 'Network settings are only available on the 3DJames box.'; return; }
  try {
    const { system: s, net: n } = await api('/api/system');
    sysCard.replaceChildren(h('h2', {}, 'This box'), h('table', {}, [['Board', s.model], ['System', s.os], ['Running for', s.uptime], ['Temperature', s.temp], ['Memory', s.memory], ['SD card', s.disk]].filter(([, v]) => v).map(([k, v]) => h('tr', {}, h('td', { class: 'muted' }, k), h('td', {}, v)))));
    const ssid = input({ value: n.wifi?.ssid || '' }), wpw = input({ type: 'password' });
    const nets = h('div', { class: 'muted' });
    netCard.replaceChildren(h('h2', {}, 'Network'),
      h('p', {}, `Cable: ${n.ethernet?.connected ? `connected (${n.ethernet.ip})` : 'not connected'}`, h('br'), `Wi-Fi: ${n.wifi?.connected ? `"${n.wifi.ssid}" (${n.wifi.ip})` : n.hotspot?.active ? `setup hotspot "${n.hotspot.ssid}" is on` : 'not connected'}`),
      h('h3', {}, 'Wi-Fi'), h('div', { class: 'row' }, field('Wi-Fi name', ssid), field('Wi-Fi password', wpw)), nets,
      h('div', { class: 'btns' }, h('button', { class: 'btn', onclick: run(async () => { const r = await api('/api/wifi/scan', {}); nets.replaceChildren('Nearby: ', ...(r.networks || []).slice(0, 12).map((x) => h('a', { href: '#', style: 'margin-right:10px', onclick: (e) => { e.preventDefault(); ssid.value = x.ssid; } }, `${x.ssid} (${x.signal}%)`))); }) }, 'Search for Wi-Fi'),
        h('button', { class: 'btn primary', onclick: run(async () => { toast('Connecting… if this page stops answering, open it again at the box\'s new address.'); const r = await api('/api/wifi/connect', { ssid: ssid.value, password: wpw.value }); toast(r.message); }) }, 'Connect')));
  } catch (err) { sysCard.lastChild.textContent = err.message; }
}

start().catch((e) => toast(e.message, true));

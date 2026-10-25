// Help tab: the picture guide. It fills everything below the tab bar; pick a topic on the left.
// Topics are grouped in chapters (help/pages/contents.json) that fold open and shut; the one being read is open.
// The pages come from help/pages/*.html and their pictures from help/img (built into the app by build.py).
import { $, h, ic, modal } from './dom.js';
import { app } from '../state.js';
import { bindExamples } from './help-examples.js';
import { showAbout } from './about.js';

let view = null, docked = false, pinned = false, currentPage = 'about'; // pinned: Keep visible was clicked
let navPage = null; // the page the topic list was last drawn for
let navAnchor = null; // the chapter or topic just clicked in the list: it stays at the same spot on screen
const openChapters = new Set(); // chapters folded open by hand (the current page's chapter is always open)
const positions = new Map();
function readingPosition() {
  const article = view?.querySelector('.help-article'), blocks = [...(view?.querySelector('.help-body')?.children || [])];
  if (!article) return null;
  const top = article.getBoundingClientRect().top;
  const index = blocks.findIndex((e) => e.getBoundingClientRect().bottom > top + 2);
  return index < 0 ? null : { index, offset: blocks[index].getBoundingClientRect().top - top };
}
function restorePosition(position) {
  const article = view?.querySelector('.help-article'), block = view?.querySelector('.help-body')?.children[position?.index];
  if (article && block) article.scrollTop += block.getBoundingClientRect().top - article.getBoundingClientRect().top - position.offset;
}
function rememberPosition() { if (view) positions.set(currentPage, readingPosition()); }
function goPage(id) { rememberPosition(); currentPage = id; render(); }
async function modelTab(tab) { app.tab = tab; const R = await import('./ribbon.js'); R.buildTabBar(); R.renderCmdBar(); }
function dock(on) {
  if (!view || docked === on) return;
  const position = readingPosition();
  docked = on; document.body.classList.toggle('help-docked', on);
  (on ? $('app') : document.body).append(view);
  view.classList.toggle('docked', on); view.style.top = on ? '' : `${$('tabbar').getBoundingClientRect().bottom}px`;
  const button = view.querySelector('[data-help-dock]'); if (button) button.textContent = on ? 'Full Help' : 'Keep visible';
  restorePosition(position);
  requestAnimationFrame(() => { if (view && docked === on) restorePosition(position); });
}
/** Take Help off the screen (it opens again on the same topic and scroll position). */
function hideHelp() { rememberPosition(); view?.remove(); view = null; docked = false; pinned = false; document.body.classList.remove('help-docked'); }
function closeHelp() { hideHelp(); if (app.tab === 'Help') modelTab('Insert'); }
const data = () => window.__3DJ_HELP || { pages: [], img: {} };

function pageHtml(p) {
  const img = data().img;
  // pictures are built in: swap each file name for the picture itself
  return p.html.replace(/src="([^"]+)"/g, (m, f) => (img[f] ? `src="${img[f]}"` : m));
}

function render(query = '') {
  const pages = data().pages;
  if (!pages.length) { view.replaceChildren(h('div', { class: 'help-empty' }, 'No help pages in this build.')); return; }
  let cur = pages.findIndex((p) => p.id === currentPage); if (cur < 0) cur = 0;
  const q = query.trim().toLowerCase();
  const plain = (p) => p.html.replace(/<[^>]+>/g, ' ').toLowerCase();
  const list = pages.map((p, i) => [p, i]).filter(([p]) => !q || plain(p).includes(q) || p.title.toLowerCase().includes(q));
  const go = (i) => { rememberPosition(); currentPage = pages[i].id; for (const k of [...openChapters]) if (k.startsWith('-')) openChapters.delete(k); render(search.value); };
  const search = h('input', { class: 'in help-search', placeholder: 'Search help…', value: query, oninput: (e) => render(e.target.value) });
  // the chapters, in order, with their pages (numbered within the chapter)
  const chapters = [];
  pages.forEach((p, i) => { const s = p.section || 'Reference'; let c = chapters[chapters.length - 1]; if (c?.name !== s) chapters.push(c = { name: s, items: [] }); c.items.push(i); });
  const curChapter = chapters.find((c) => c.items.includes(cur));
  const shown = new Set(list.map(([, i]) => i));
  // open: the chapter being read (unless folded away by hand), chapters opened by hand, and every chapter while searching
  const isOpen = (c) => !!q || (c === curChapter ? !openChapters.has('-' + c.name) : openChapters.has(c.name));
  const toggle = (c) => { const k = c === curChapter ? '-' + c.name : c.name; if (openChapters.has(k)) openChapters.delete(k); else openChapters.add(k); render(search.value); };
  const groups = chapters.map((c, ci) => {
    const items = c.items.filter((i) => shown.has(i)); if (!items.length) return null;
    const open = isOpen(c);
    const head = h('button', { class: 'help-section' + (open ? ' open' : ''), 'aria-expanded': String(open), title: open ? 'Fold this chapter away' : 'Show the topics in this chapter', 'data-key': 'c:' + c.name, onclick: () => { if (!q) { navAnchor = 'c:' + c.name; toggle(c); } } },
      h('span', { class: 'help-chev' }, open ? '▾' : '▸'), h('span', { class: 'help-ch-num' }, String(ci + 1)), h('span', { class: 'help-ch-name' }, c.name), h('span', { class: 'help-ch-count' }, String(c.items.length)));
    return h('div', { class: 'help-group' }, head, ...(open ? items.map((i) => h('button', { class: 'help-link' + (i === cur ? ' on' : ''), 'data-key': 'p:' + pages[i].id, onclick: () => { navAnchor = 'p:' + pages[i].id; go(i); } }, h('span', { class: 'help-num' }, `${ci + 1}.${c.items.indexOf(i) + 1}`), pages[i].title)) : []));
  });
  const nav = h('nav', { class: 'help-nav' }, search, ...groups,
    list.length ? null : h('div', { class: 'muted', style: 'padding:8px' }, 'Nothing found.'),
    h('div', { class: 'help-foot' },
      h('button', { class: 'btn', onclick: showAbout }, ic('Package'), 'Licenses and components'),
      h('div', { class: 'muted' }, `3DJames ${window.__3DJ_VERSION || ''}`)));
  const body = h('div', { class: 'help-body' }); body.innerHTML = pageHtml(pages[cur]);
  // where this page sits: "Sketching · 3 of 9" (click the chapter name to see its other topics)
  if (curChapter) body.prepend(h('div', { class: 'help-where' }, h('button', { class: 'help-where-ch', title: 'Show the topics in this chapter', onclick: () => { openChapters.delete('-' + curChapter.name); render(search.value); view.querySelector('.help-link.on')?.scrollIntoView({ block: 'nearest' }); } }, curChapter.name), ` · ${curChapter.items.indexOf(cur) + 1} of ${curChapter.items.length}`));
  bindExamples(body);
  for (const link of body.querySelectorAll('[data-help-topic]')) link.addEventListener('click', () => goPage(link.dataset.helpTopic));
  for (const img of body.querySelectorAll('img')) {
    img.tabIndex = 0; img.setAttribute('role', 'button');
    img.setAttribute('aria-label', `${img.alt || 'Help picture'}. Enlarge image`);
    img.title = 'Click to enlarge';
    const enlarge = () => {
      img.focus();
      const fitHeight = 'calc(80vh - 120px)';
      const picture = h('img', { src: img.src, alt: img.alt, style: `display:block;max-width:100%;max-height:${fitHeight};object-fit:contain;margin:auto` });
      const frame = h('div', { style: `overflow:auto;max-height:${fitHeight}` }, picture);
      let actual = false;
      const zoom = h('button', { class: 'btn', onclick: () => {
        actual = !actual; zoom.textContent = actual ? 'Fit picture' : 'Actual size';
        picture.style.maxWidth = actual ? 'none' : '100%';
        picture.style.maxHeight = actual ? 'none' : fitHeight;
      } }, 'Actual size');
      modal(img.alt || 'Help picture', frame, (done) => [zoom, h('button', { class: 'btn primary', onclick: done }, 'Close picture')]);
      const dialog = picture.closest('dialog');
      dialog.style.width = 'min(1440px, 96vw)'; dialog.style.maxWidth = '96vw';
    };
    img.addEventListener('click', enlarge);
    img.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); enlarge(); } });
  }
  const pager = h('div', { class: 'help-pager' },
    cur > 0 ? h('button', { class: 'btn', onclick: () => go(cur - 1) }, '← ', pages[cur - 1].title) : h('span'),
    cur < pages.length - 1 ? h('button', { class: 'btn primary', onclick: () => go(cur + 1) }, pages[cur + 1].title, ' →') : h('span'));
  const article = h('article', { class: 'help-article' }, body, pager);
  const topics = h('select', { class: 'in help-topics', 'aria-label': 'Help topic', onchange: (e) => goPage(e.target.value) },
    ...chapters.map((c) => h('optgroup', { label: c.name }, ...c.items.map((i) => h('option', { value: pages[i].id }, pages[i].title))))); topics.value = pages[cur].id;
  const toolbar = h('div', { class: 'help-toolbar' }, h('b', {}, 'Help & tutorials'), topics, h('button', { class: 'btn', 'data-help-dock': '', onclick: () => { if (docked) modelTab('Help'); else { pinned = true; dock(true); modelTab('Insert'); } } }, docked ? 'Full Help' : 'Keep visible'), h('button', { class: 'btn', onclick: closeHelp, 'aria-label': 'Close Help' }, 'Close'));
  // the topic list keeps its scroll position when it is drawn again (opening a chapter, picking a topic)
  const oldNav = view.querySelector('.help-nav'), navTop = oldNav?.scrollTop || 0;
  const find = (n, key) => key && [...n.querySelectorAll('[data-key]')].find((e) => e.dataset.key === key);
  const gap = (n, e) => e.getBoundingClientRect().top - n.getBoundingClientRect().top;
  const was = oldNav && find(oldNav, navAnchor), wasGap = was ? gap(oldNav, was) : 0;
  view.replaceChildren(toolbar, h('div', { class: 'help-content' }, nav, article));
  nav.scrollTop = navTop;
  const now = was && find(nav, navAnchor);
  if (now) nav.scrollTop += gap(nav, now) - wasGap; // chapters above it may have folded or opened: keep the clicked line still
  else if (navPage !== currentPage) nav.querySelector('.help-link.on')?.scrollIntoView({ block: 'nearest' }); // Next / Back or a link: its topic in sight
  navAnchor = null; navPage = currentPage;
  restorePosition(positions.get(currentPage));
  if (document.activeElement !== search && query) { search.focus(); search.setSelectionRange(query.length, query.length); }
}

/** Help starts at About each app session. Its page and scroll remain in memory.
 *  Leaving the Help tab closes it, unless Keep visible was clicked: then it stays docked beside the model until Close. */
export function showHelp(on) {
  if (!on) { if (view) { if (pinned) dock(true); else hideHelp(); } return; }
  if (!view) {
    docked = false;
    view = h('div', { id: 'helpview', class: 'helpview', role: 'document' });
    view.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(view);
    view.style.top = `${$('tabbar').getBoundingClientRect().bottom}px`;
    render();
  } else dock(false);
}
export const helpOpen = () => !!view;

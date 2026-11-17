import * as store from './store.js';
import * as sync from './sync.js';
import { STATUSES, LABELS, ROLE_INFO, isContainer } from './store.js';
import { icon, hydrateIcons } from './icons.js';
import { createScene } from './scene.js';
import { mountEditor, sanitize } from './editor.js';
import * as sound from './sound.js';

// ---------------------------------------------------------------- settings
const SETTINGS_KEY = 'faulkner.settings';
const DEFAULTS = {
  theme: 'auto', font: 'courier', fontSize: 19, width: 680,
  typewriter: true, smartQuotes: true, sounds: true, volume: 0.45,
  scene: true, sceneTime: 'auto', weather: 'auto', body: 'seafoam', motion: true,
  dailyGoal: 500,
};
let settings = { ...DEFAULTS, ...safeJSON(localStorage.getItem(SETTINGS_KEY)) };
function safeJSON(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
function saveSettings(patch) {
  settings = { ...settings, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applySettings();
}

const BODIES = {
  seafoam: ['#6fa596', '#97c7b8', '#4b7b6d'],
  cherry: ['#a8413a', '#c9665c', '#7a2c27'],
  charcoal: ['#3a3b3f', '#56585e', '#25262a'],
  butter: ['#d8bf72', '#ecd896', '#a98f4a'],
  slate: ['#4f6d8a', '#7091ae', '#374e66'],
};
const FONTS = {
  courier: "'Courier Prime', 'Courier New', monospace",
  elite: "'Special Elite', 'Courier Prime', monospace",
  literata: "'Literata', Georgia, serif",
};

// ---------------------------------------------------------------- dom
const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const view = $('#view');
const tree = $('#tree');
const inspector = $('#inspector');
const menuEl = $('#menu');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString();

let selected = localStorage.getItem('faulkner.selected') || null;
let expanded = new Set(safeJSON(localStorage.getItem('faulkner.expanded')).ids || []);
let editor = null;
let scene = null;
let searchTerm = '';

function saveExpanded() { localStorage.setItem('faulkner.expanded', JSON.stringify({ ids: [...expanded] })); }

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- templates
const T = (rows) => rows.map(r => `<p><b>${r}:</b> </p>`).join('');
const TEMPLATES = {
  characters: T(['Role in the story', 'Wants', 'Needs', 'Wound / secret', 'Appearance', 'Voice & mannerisms', 'Arc']),
  places: T(['First impression', 'Sounds', 'Smells', 'Weather & light', 'History', 'Who goes there']),
  premise: T(['Logline', 'Premise', 'Theme', 'Protagonist', 'Antagonistic force', 'Ending']),
};

function iconFor(it) {
  if (it.type === 'project') return 'book';
  if (it.type === 'folder') return it.role && ROLE_INFO[it.role] ? ROLE_INFO[it.role].icon : (expanded.has(it.id) ? 'folderOpen' : 'folder');
  if (it.type === 'note') return 'note';
  return 'doc';
}

function newProject() {
  const p = store.create({ type: 'project', title: 'Untitled Project' });
  const roles = ['manuscript', 'outline', 'characters', 'places', 'notes', 'research'];
  const f = {};
  roles.forEach((role, i) => { f[role] = store.create({ type: 'folder', parentId: p.id, title: ROLE_INFO[role].title, role, order: i + 1 }); });
  const ch = store.create({ type: 'folder', parentId: f.manuscript.id, title: 'Chapter One' });
  const scene1 = store.create({ type: 'doc', parentId: ch.id, title: 'Opening Scene', synopsis: 'Where it all begins.' });
  store.create({ type: 'note', parentId: f.outline.id, title: 'Premise', content: TEMPLATES.premise });
  [p.id, f.manuscript.id, ch.id].forEach(id => expanded.add(id));
  saveExpanded();
  select(scene1.id);
  toast('New project ready. Rename it in the binder or inspector.');
  return p;
}

function newChild(parentId, type) {
  const parent = store.get(parentId);
  if (parent && !isContainer(parent)) { parentId = parent.parentId; }
  const role = parentId ? store.roleOf(parentId) : null;
  if (!type) type = role && ['characters', 'places', 'notes', 'research', 'outline'].includes(role) ? 'note' : 'doc';
  const titles = { doc: 'New Scene', note: role === 'characters' ? 'New Character' : role === 'places' ? 'New Place' : 'New Note', folder: 'New Folder' };
  const content = type !== 'folder' && (role === 'characters' || role === 'places') ? TEMPLATES[role] : '';
  const it = store.create({ type, parentId, title: titles[type], content });
  if (parentId) { expanded.add(parentId); saveExpanded(); }
  select(it.id);
  if (type !== 'folder') setTimeout(() => $('.doc-title')?.select(), 50);
  return it;
}

// ---------------------------------------------------------------- binder
function renderBinder() {
  const trashCount = store.allItems().filter(i => i.trashed).length;
  $('#trash-count').textContent = trashCount ? `(${trashCount})` : '';
  $('#btn-trash').classList.toggle('active', selected === 'trash');

  if (searchTerm) {
    const q = searchTerm.toLowerCase();
    const hits = store.allItems().filter(i => !store.isHidden(i.id) && (
      (i.title || '').toLowerCase().includes(q) || (i.synopsis || '').toLowerCase().includes(q) || store.plainText(i.content).toLowerCase().includes(q)));
    tree.innerHTML = hits.length
      ? hits.map(i => rowHtml(i, 0, true)).join('')
      : `<div class="empty-note">No matches for “${esc(searchTerm)}”.</div>`;
    return;
  }

  const roots = store.children(null);
  if (!roots.length) {
    tree.innerHTML = `<div class="empty-note">Your binder is empty.<br>Start a project below.</div>`;
    return;
  }
  const out = [];
  const walk = (list, depth) => {
    for (const it of list) {
      out.push(rowHtml(it, depth));
      if (isContainer(it) && expanded.has(it.id)) walk(store.children(it.id), depth + 1);
    }
  };
  walk(roots, 0);
  tree.innerHTML = out.join('');
}

function rowHtml(it, depth, flat = false) {
  const kids = isContainer(it) && store.children(it.id).length > 0;
  const open = expanded.has(it.id);
  const sub = flat ? `<span class="row-sub">${esc(store.ancestors(it.id).map(a => a.title).join(' › '))}</span>` : '';
  return `<div class="row ${it.id === selected ? 'sel' : ''} type-${it.type}" data-id="${it.id}" draggable="true" role="treeitem" aria-selected="${it.id === selected}" ${isContainer(it) ? `aria-expanded="${open}"` : ''} style="--depth:${depth}">
    <button class="twisty ${kids ? '' : 'none'} ${open ? 'open' : ''}" data-act="toggle" tabindex="-1" aria-label="Expand">${kids ? icon('caret') : ''}</button>
    <span class="ico">${icon(iconFor(it))}</span>
    <span class="title">${esc(it.title || 'Untitled')}${sub}</span>
    ${it.label ? `<span class="lbl lbl-${it.label}"></span>` : ''}
    <button class="more" data-act="more" aria-label="Actions">${icon('dots')}</button>
  </div>`;
}

tree.addEventListener('click', e => {
  const row = e.target.closest('.row');
  if (!row) return;
  const id = row.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'toggle') {
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    saveExpanded();
    renderBinder();
    return;
  }
  if (act === 'more') {
    const r = e.target.closest('button').getBoundingClientRect();
    itemMenu(id, r.right, r.bottom);
    return;
  }
  const it = store.get(id);
  if (isContainer(it) && id === selected) { expanded.has(id) ? expanded.delete(id) : expanded.add(id); saveExpanded(); renderBinder(); return; }
  select(id);
  if (isContainer(it) && !expanded.has(id)) { expanded.add(id); saveExpanded(); renderBinder(); }
  if (matchMedia('(max-width: 760px)').matches && !isContainer(it)) closeDrawers();
});
tree.addEventListener('dblclick', e => {
  const row = e.target.closest('.row');
  if (row && !e.target.closest('button')) renameInline(row.dataset.id);
});
tree.addEventListener('contextmenu', e => {
  const row = e.target.closest('.row');
  if (!row) return;
  e.preventDefault();
  itemMenu(row.dataset.id, e.clientX, e.clientY);
});

function renameInline(id) {
  const row = tree.querySelector(`.row[data-id="${id}"]`);
  const it = store.get(id);
  if (!row || !it) return;
  const span = row.querySelector('.title');
  const input = document.createElement('input');
  input.className = 'rename';
  input.value = it.title;
  span.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = ok => {
    if (done) return;
    done = true;
    if (ok && input.value.trim()) store.update(id, { title: input.value.trim() });
    renderAll();
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); e.stopPropagation(); });
  input.addEventListener('blur', () => finish(true));
}

// Drag and drop
let dragId = null;
tree.addEventListener('dragstart', e => {
  const row = e.target.closest('.row');
  if (!row) return;
  dragId = row.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragId);
  row.classList.add('dragging');
});
tree.addEventListener('dragend', () => { dragId = null; tree.querySelectorAll('.drop-before,.drop-after,.drop-in,.dragging').forEach(r => r.classList.remove('drop-before', 'drop-after', 'drop-in', 'dragging')); });
function dropZone(row, e) {
  const r = row.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  const it = store.get(row.dataset.id);
  if (isContainer(it)) return y < 0.25 ? 'before' : y > 0.75 && !expanded.has(it.id) ? 'after' : 'in';
  return y < 0.5 ? 'before' : 'after';
}
tree.addEventListener('dragover', e => {
  if (!dragId) return;
  e.preventDefault();
  tree.querySelectorAll('.drop-before,.drop-after,.drop-in').forEach(r => r.classList.remove('drop-before', 'drop-after', 'drop-in'));
  const row = e.target.closest('.row');
  if (row && row.dataset.id !== dragId) row.classList.add('drop-' + dropZone(row, e));
});
tree.addEventListener('drop', e => {
  if (!dragId) return;
  e.preventDefault();
  const row = e.target.closest('.row');
  const id = dragId;
  if (!row) { store.move(id, null); renderAll(); return; }
  const target = store.get(row.dataset.id);
  if (!target || target.id === id) return;
  const zone = dropZone(row, e);
  if (zone === 'in') { store.move(id, target.id); expanded.add(target.id); saveExpanded(); }
  else if (zone === 'before') store.move(id, target.parentId, target.id);
  else {
    const sibs = store.children(target.parentId).filter(s => s.id !== id);
    const next = sibs[sibs.findIndex(s => s.id === target.id) + 1];
    store.move(id, target.parentId, next ? next.id : null);
  }
  renderAll();
});

// ---------------------------------------------------------------- menus
function showMenu(x, y, entries) {
  menuEl.innerHTML = entries.map((m, i) => m === '-' ? '<hr>' :
    `<button data-i="${i}" class="${m.danger ? 'danger' : ''}" style="${m.indent ? `padding-left:${12 + m.indent * 14}px` : ''}" ${m.disabled ? 'disabled' : ''}>${m.icon ? icon(m.icon) : ''}<span>${esc(m.label)}</span></button>`).join('');
  menuEl.hidden = false;
  const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  menuEl.style.left = Math.max(8, Math.min(x - mw, innerWidth - mw - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - mh - 8)) + 'px';
  menuEl.onclick = e => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    const m = entries[+b.dataset.i];
    hideMenu();
    m.action?.();
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, { capture: true }), 0);
}
function outside(e) { if (!menuEl.contains(e.target)) hideMenu(); }
function hideMenu() { menuEl.hidden = true; document.removeEventListener('pointerdown', outside, { capture: true }); }

function itemMenu(id, x, y) {
  const it = store.get(id);
  if (!it) return;
  const container = isContainer(it);
  const entries = [];
  if (container) {
    entries.push({ label: 'New scene / document', icon: 'doc', action: () => newChild(id, 'doc') });
    entries.push({ label: 'New note', icon: 'note', action: () => newChild(id, 'note') });
    entries.push({ label: 'New folder', icon: 'folder', action: () => newChild(id, 'folder') });
    entries.push('-');
  }
  entries.push({ label: 'Rename', action: () => { if (!tree.querySelector(`.row[data-id="${id}"]`)) openBinder(); renameInline(id); } });
  entries.push({ label: 'Move up', icon: 'up', action: () => { store.shift(id, -1); renderAll(); } });
  entries.push({ label: 'Move down', icon: 'down', action: () => { store.shift(id, 1); renderAll(); } });
  entries.push({ label: 'Move to…', action: () => moveToMenu(id, x, y) });
  entries.push({ label: 'Duplicate', action: () => { const c = store.duplicate(id); if (c) select(c.id); } });
  if (it.type === 'doc' || it.type === 'note') {
    entries.push({ label: it.type === 'doc' ? 'Convert to note' : 'Convert to manuscript doc', action: () => { store.update(id, { type: it.type === 'doc' ? 'note' : 'doc' }); renderAll(); } });
  }
  if (container) {
    entries.push('-');
    entries.push({ label: 'Compile to file…', action: () => compileMenu(id, x, y) });
  }
  entries.push('-');
  entries.push({ label: 'Move to Trash', icon: 'trash', danger: true, action: () => { store.trash(id); if (selected === id || store.isHidden(selected)) select(it.parentId || null); else renderAll(); toast(`“${it.title}” moved to Trash.`); } });
  showMenu(x, y, entries);
}

function moveToMenu(id, x, y) {
  const entries = [{ label: 'Top level', action: () => { store.move(id, null); renderAll(); } }];
  const walk = (pid, depth) => {
    for (const c of store.children(pid)) {
      if (!isContainer(c) || c.id === id) continue;
      entries.push({ label: c.title, indent: depth, icon: iconFor(c), action: () => { store.move(id, c.id); expanded.add(c.id); saveExpanded(); renderAll(); } });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 1);
  showMenu(x, y, entries);
}

// ---------------------------------------------------------------- selection & views
function select(id) {
  if (editor) { editor.destroy(); editor = null; }
  selected = id;
  if (id) localStorage.setItem('faulkner.selected', id); else localStorage.removeItem('faulkner.selected');
  if (id && id !== 'trash') for (const a of store.ancestors(id)) expanded.add(a.id);
  renderAll();
}

function renderAll() {
  renderBinder();
  renderCrumbs();
  renderView();
  renderInspector();
  renderStatus();
}

function renderCrumbs() {
  const c = $('#crumbs');
  if (selected === 'trash') { c.innerHTML = '<span>Trash</span>'; return; }
  const it = store.get(selected);
  if (!it || store.isHidden(selected)) { c.innerHTML = ''; return; }
  const path = [...store.ancestors(selected), it];
  c.innerHTML = path.map((p, i) => i === path.length - 1 ? `<span>${esc(p.title)}</span>` : `<a href="#" data-id="${p.id}">${esc(p.title)}</a>`).join('<i>›</i>');
}
$('#crumbs').addEventListener('click', e => { const a = e.target.closest('a[data-id]'); if (a) { e.preventDefault(); select(a.dataset.id); } });

function renderView() {
  app.classList.remove('mode-editor', 'mode-board', 'mode-welcome', 'mode-trash');
  if (selected === 'trash') return renderTrash();
  const it = store.get(selected);
  if (!it || store.isHidden(selected)) {
    if (selected) { selected = null; localStorage.removeItem('faulkner.selected'); }
    return renderWelcome();
  }
  if (isContainer(it)) return renderBoard(it);
  return renderEditor(it);
}

function renderWelcome() {
  app.classList.add('mode-welcome');
  const projects = store.children(null).filter(p => p.type === 'project');
  view.innerHTML = `<div class="scroller"><div class="welcome">
    <h1 class="pixel">The tide is out.<br>The page is blank.</h1>
    <p>Faulkner keeps your fiction, notes and outlines in one binder, saves every keystroke on this device, and syncs to your other devices when you connect a GitHub vault.</p>
    <div class="welcome-actions">
      <button class="btn big" data-w="new">${icon('plus')} Start a new project</button>
      ${!sync.isConfigured() ? `<button class="btn ghost big" data-w="sync">${icon('gear')} Connect sync</button>` : ''}
    </div>
    ${projects.length ? `<h2 class="pixel small">Your projects</h2><div class="proj-list">${projects.map(p => `<button class="proj" data-id="${p.id}">${icon('book')}<span>${esc(p.title)}</span><em>${fmt(store.wordsUnder(p.id, { docsOnly: true }))} words</em></button>`).join('')}</div>` : ''}
  </div></div>`;
  view.querySelector('[data-w="new"]').onclick = () => newProject();
  view.querySelector('[data-w="sync"]')?.addEventListener('click', () => openSettings('sync'));
  view.querySelectorAll('.proj').forEach(b => b.onclick = () => select(b.dataset.id));
}

function renderEditor(it) {
  app.classList.add('mode-editor');
  view.innerHTML = `<div class="scroller"><div class="sheet ${it.type === 'note' ? 'is-note' : ''}">
    <input class="doc-title" value="${esc(it.title)}" aria-label="Title" spellcheck="true">
    <div class="page" id="page" role="textbox" aria-multiline="true" aria-label="${esc(it.title)}"></div>
  </div><div class="sheet-tail"></div></div>`;
  const page = $('#page');
  editor = mountEditor(page, it, {
    settings: () => settings,
    onKey: kind => {
      if (settings.sounds) sound.play(kind);
      scene?.key(kind);
    },
    onWords: delta => { addToday(delta); renderStatus(); if (!inspector.contains(document.activeElement)) renderInspectorSoon(); },
  });
  const title = view.querySelector('.doc-title');
  let tt;
  title.addEventListener('input', () => {
    clearTimeout(tt);
    tt = setTimeout(() => { store.update(it.id, { title: title.value || 'Untitled' }); renderBinder(); renderCrumbs(); }, 300);
  });
  title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); page.focus(); } });
  if (!it.content && !matchMedia('(pointer: coarse)').matches) setTimeout(() => page.focus(), 30);
}

function viewMode(id) { return safeJSON(localStorage.getItem('faulkner.viewmode'))[id] || 'cork'; }
function setViewMode(id, mode) {
  const all = safeJSON(localStorage.getItem('faulkner.viewmode'));
  all[id] = mode;
  localStorage.setItem('faulkner.viewmode', JSON.stringify(all));
}

function renderBoard(it) {
  app.classList.add('mode-board');
  const mode = viewMode(it.id);
  const kids = store.children(it.id);
  const words = store.wordsUnder(it.id, { docsOnly: it.type === 'project' || store.roleOf(it.id) === 'manuscript' });
  const head = `<div class="board-head">
      <input class="board-title" value="${esc(it.title)}" aria-label="Folder title">
      <span class="board-meta">${kids.length} item${kids.length === 1 ? '' : 's'} · ${fmt(words)} words</span>
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="View">
        <button data-mode="cork" class="${mode === 'cork' ? 'on' : ''}">${icon('cork')} Corkboard</button>
        <button data-mode="outline" class="${mode === 'outline' ? 'on' : ''}">${icon('list')} Outline</button>
      </div>
      <button class="btn" data-add="auto">${icon('plus')} New</button>
      <button class="btn ghost" data-add="folder">${icon('folder')} Folder</button>
      <button class="btn ghost" data-compile>Compile</button>
    </div>`;
  let body;
  if (mode === 'outline') {
    const rows = [];
    const walk = (pid, depth) => {
      for (const c of store.children(pid)) {
        rows.push(`<tr data-id="${c.id}" class="type-${c.type}">
          <td class="o-title" style="padding-left:${10 + depth * 18}px">${icon(iconFor(c))}<a href="#" data-open="${c.id}">${esc(c.title)}</a></td>
          <td><input class="o-syn" data-field="synopsis" value="${esc(c.synopsis)}" placeholder="Synopsis…"></td>
          <td><select data-field="status">${STATUSES.map(s => `<option ${s === c.status ? 'selected' : ''} value="${esc(s)}">${s || '—'}</option>`).join('')}</select></td>
          <td class="num">${fmt(isContainer(c) ? store.wordsUnder(c.id) : store.wordsOf(c))}</td>
          <td class="num"><input type="number" min="0" step="100" data-field="target" value="${c.target || ''}" placeholder="—"></td>
        </tr>`);
        if (isContainer(c)) walk(c.id, depth + 1);
      }
    };
    walk(it.id, 0);
    body = rows.length
      ? `<div class="outline-wrap"><table class="outline"><thead><tr><th>Title</th><th>Synopsis</th><th>Status</th><th class="num">Words</th><th class="num">Target</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`
      : emptyBoard();
  } else {
    body = kids.length ? `<div class="cork">${kids.map(c => `
      <article class="card lbl-${c.label || 'none'}" data-id="${c.id}" draggable="true">
        <span class="pin"></span>
        <header><span class="ico">${icon(iconFor(c))}</span><a href="#" data-open="${c.id}">${esc(c.title)}</a></header>
        <textarea data-field="synopsis" placeholder="Synopsis…" rows="4">${esc(c.synopsis)}</textarea>
        <footer><span>${c.status ? esc(c.status) : ''}</span><span>${fmt(isContainer(c) ? store.wordsUnder(c.id) : store.wordsOf(c))} w</span></footer>
      </article>`).join('')}
      <button class="card add-card" data-add="auto">${icon('plus')}<span>Add card</span></button></div>` : emptyBoard();
  }
  view.innerHTML = `<div class="scroller board">${head}${body}</div>`;

  const bt = view.querySelector('.board-title');
  bt.addEventListener('change', () => { store.update(it.id, { title: bt.value || 'Untitled' }); renderBinder(); renderCrumbs(); });
  view.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { setViewMode(it.id, b.dataset.mode); renderView(); });
  view.querySelectorAll('[data-add]').forEach(b => b.onclick = () => newChild(it.id, b.dataset.add === 'folder' ? 'folder' : undefined));
  view.querySelector('[data-compile]').onclick = e => { const r = e.target.getBoundingClientRect(); compileMenu(it.id, r.right, r.bottom); };
  view.querySelectorAll('[data-field]').forEach(inp => {
    const id = inp.closest('[data-id]').dataset.id;
    const field = inp.dataset.field;
    const ev = inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => store.update(id, { [field]: field === 'target' ? (+inp.value || 0) : inp.value }, { quiet: true }));
  });
  // Card drag-to-reorder
  let dragCard = null;
  view.querySelectorAll('.card[data-id]').forEach(card => {
    card.addEventListener('dragstart', e => { if (e.target.tagName === 'TEXTAREA') return; dragCard = card.dataset.id; card.classList.add('dragging'); e.dataTransfer.setData('text/plain', dragCard); });
    card.addEventListener('dragend', () => { card.classList.remove('dragging'); dragCard = null; });
    card.addEventListener('dragover', e => { if (dragCard && dragCard !== card.dataset.id) { e.preventDefault(); card.classList.add('drop-target'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
    card.addEventListener('drop', e => {
      e.preventDefault();
      card.classList.remove('drop-target');
      if (!dragCard) return;
      store.move(dragCard, it.id, card.dataset.id);
      renderAll();
    });
  });
}
view.addEventListener('click', e => { const a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); select(a.dataset.open); } });
function emptyBoard() {
  return `<div class="empty-board"><p class="pixel">Nothing pinned here yet.</p><p>Add a scene, a note, or a folder, and each one shows up here as an index card.</p></div>`;
}

function renderTrash() {
  app.classList.add('mode-trash');
  const list = store.allItems().filter(i => i.trashed).sort((a, b) => b.updatedAt - a.updatedAt);
  view.innerHTML = `<div class="scroller board"><div class="board-head"><h2 class="pixel">Trash</h2><span class="spacer"></span>
    ${list.length ? '<button class="btn danger" data-empty>Empty Trash</button>' : ''}</div>
    ${list.length ? `<ul class="trash-list">${list.map(i => `<li data-id="${i.id}">${icon(iconFor(i))}<span>${esc(i.title)}</span><em>${fmt(store.wordsUnder(i.id))} words</em>
      <button class="btn ghost" data-restore>Restore</button><button class="btn ghost danger" data-purge>Delete forever</button></li>`).join('')}</ul>`
      : '<div class="empty-board"><p class="pixel">Swept clean.</p><p>Items you trash land here until you delete them for good.</p></div>'}
  </div>`;
  view.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => { store.restore(b.closest('li').dataset.id); renderAll(); });
  view.querySelectorAll('[data-purge]').forEach(b => b.onclick = () => {
    const id = b.closest('li').dataset.id;
    if (confirm(`Delete “${store.get(id).title}” and everything inside it permanently?`)) { store.purge(id); renderAll(); }
  });
  view.querySelector('[data-empty]')?.addEventListener('click', () => {
    if (confirm('Permanently delete everything in the Trash?')) { list.forEach(i => store.get(i.id) && store.purge(i.id)); renderAll(); }
  });
}

// ---------------------------------------------------------------- inspector
function renderInspector() {
  const it = store.get(selected);
  if (!it || store.isHidden(selected)) {
    inspector.innerHTML = `<div class="insp-empty">${icon('info')}<p>Select something in the binder to see its synopsis, status and notes.</p></div>`;
    return;
  }
  const words = isContainer(it) ? store.wordsUnder(it.id) : store.wordsOf(it);
  const pct = it.target ? Math.min(100, Math.round((words / it.target) * 100)) : 0;
  const snaps = (it.snapshots || []).slice().reverse();
  inspector.innerHTML = `
    <div class="insp-head"><span class="pixel">Inspector</span><button class="icon-btn close-insp" aria-label="Close">${icon('close')}</button></div>
    <label class="field"><span>Synopsis</span><textarea data-f="synopsis" rows="5" placeholder="What happens here, in a sentence or two.">${esc(it.synopsis)}</textarea></label>
    <div class="field-row">
      <label class="field"><span>Status</span><select data-f="status">${STATUSES.map(s => `<option value="${esc(s)}" ${s === it.status ? 'selected' : ''}>${s || '—'}</option>`).join('')}</select></label>
      <label class="field"><span>Label</span><select data-f="label">${Object.entries(LABELS).map(([k, v]) => `<option value="${k}" ${k === (it.label || '') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Word target</span><input type="number" min="0" step="100" data-f="target" value="${it.target || ''}" placeholder="None"></label>
    ${it.target ? `<div class="target"><div class="px-bar"><span style="width:${pct}%"></span></div><small>${fmt(words)} / ${fmt(it.target)} (${pct}%)</small></div>` : `<small class="muted">${fmt(words)} words</small>`}
    <label class="field"><span>Notes</span><textarea data-f="notes" rows="7" placeholder="Margin notes, ideas, things to fix…">${esc(it.notes)}</textarea></label>
    ${!isContainer(it) ? `
      <div class="field"><span>Snapshots</span>
        <button class="btn ghost small" data-snap>Take snapshot</button>
        <ul class="snaps">${snaps.map((s, i) => `<li><span>${new Date(s.at).toLocaleString()}${s.note ? ` · ${esc(s.note)}` : ''}</span><em>${fmt(store.countWords(s.content))} w</em><button class="btn ghost small" data-restore-snap="${snaps.length - 1 - i}">Restore</button></li>`).join('') || '<li class="muted">Save a copy of this text before a big revision.</li>'}</ul>
      </div>` : ''}
    <p class="muted tiny">Created ${new Date(it.createdAt).toLocaleDateString()} · Edited ${new Date(it.updatedAt).toLocaleString()}</p>`;
  inspector.querySelector('.close-insp').onclick = () => app.classList.remove('insp-open');
  inspector.querySelectorAll('[data-f]').forEach(el => {
    const f = el.dataset.f;
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
      store.update(it.id, { [f]: f === 'target' ? (+el.value || 0) : el.value }, { quiet: f !== 'label' });
      if (f === 'label') renderBinder();
      if (f === 'target' || f === 'status') { renderInspectorSoon(); if (app.classList.contains('mode-board')) renderView(); }
    });
  });
  inspector.querySelector('[data-snap]')?.addEventListener('click', () => {
    editor?.flush();
    const cur = store.get(it.id);
    const note = prompt('Name this snapshot (optional):', '') ?? null;
    if (note === null) return;
    store.update(it.id, { snapshots: [...(cur.snapshots || []), { at: Date.now(), note, content: cur.content }].slice(-12) });
    renderInspector();
    toast('Snapshot saved.');
  });
  inspector.querySelectorAll('[data-restore-snap]').forEach(b => b.onclick = () => {
    const cur = store.get(it.id);
    const snap = cur.snapshots[+b.dataset.restoreSnap];
    if (!snap || !confirm('Replace the current text with this snapshot? (The current text is snapshotted first.)')) return;
    editor?.flush();
    const fresh = store.get(it.id);
    store.update(it.id, {
      snapshots: [...fresh.snapshots, { at: Date.now(), note: 'Before restore', content: fresh.content }].slice(-12),
      content: snap.content,
    });
    select(it.id);
    toast('Snapshot restored.');
  });
}
let inspT;
function renderInspectorSoon() { clearTimeout(inspT); inspT = setTimeout(renderInspector, 400); }

// ---------------------------------------------------------------- status & goals
function todayKey() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; }
function getToday() {
  const t = safeJSON(localStorage.getItem('faulkner.today'));
  return t.date === todayKey() ? t.words || 0 : 0;
}
function addToday(delta) {
  const words = Math.max(0, getToday() + delta);
  localStorage.setItem('faulkner.today', JSON.stringify({ date: todayKey(), words }));
}
function renderStatus() {
  const it = store.get(selected);
  let doc = '';
  if (it && !store.isHidden(selected)) {
    const proj = store.projectOf(selected);
    const w = isContainer(it) ? store.wordsUnder(it.id) : store.wordsOf(it);
    doc = `${esc(it.title)}: <b>${fmt(w)}</b> words`;
    if (proj && proj.id !== it.id) doc += ` <span class="dim">· ${esc(proj.title)}: ${fmt(store.wordsUnder(proj.id, { docsOnly: true }))}</span>`;
  }
  $('#stat-doc').innerHTML = doc;
  const today = getToday();
  const goal = settings.dailyGoal || 0;
  $('#stat-today').textContent = goal ? `Today ${fmt(today)} / ${fmt(goal)}` : `Today ${fmt(today)}`;
  const bar = $('#goal-bar');
  bar.hidden = !goal;
  bar.firstElementChild.style.width = goal ? Math.min(100, (today / goal) * 100) + '%' : '0';
  bar.classList.toggle('done', goal && today >= goal);
}

// ---------------------------------------------------------------- compile & backup
function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
const slug = s => (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

function gatherManuscript(rootId) {
  const root = store.get(rootId);
  let start = [root];
  if (root.type === 'project') {
    const ms = store.children(root.id).filter(c => c.role === 'manuscript');
    if (ms.length) start = ms;
  }
  const parts = [];
  const walk = (pid, depth) => {
    for (const c of store.children(pid)) {
      if (c.type === 'folder') { parts.push({ kind: 'heading', depth, title: c.title }); walk(c.id, depth + 1); }
      else if (c.type === 'doc') parts.push({ kind: 'text', html: sanitize(c.content), title: c.title });
    }
  };
  start.forEach(s => (s.type === 'doc' ? parts.push({ kind: 'text', html: sanitize(s.content) }) : walk(s.id, 0)));
  return parts;
}

function htmlToMarkdown(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const inline = n => [...n.childNodes].map(c => {
    if (c.nodeType === 3) return c.data.replace(/([*_\\])/g, '\\$1');
    const t = c.tagName;
    const inner = inline(c);
    if (t === 'B' || t === 'STRONG') return inner.trim() ? `**${inner}**` : inner;
    if (t === 'I' || t === 'EM') return inner.trim() ? `*${inner}*` : inner;
    if (t === 'BR') return '  \n';
    return inner;
  }).join('');
  const blocks = [];
  for (const n of div.childNodes) {
    if (n.nodeType === 3) { if (n.data.trim()) blocks.push(n.data.trim()); continue; }
    const t = n.tagName;
    if (/^H\d$/.test(t)) blocks.push('#'.repeat(Math.min(6, +t[1] + 1)) + ' ' + inline(n));
    else if (t === 'BLOCKQUOTE') blocks.push(inline(n).split('\n').map(l => '> ' + l).join('\n'));
    else if (t === 'HR') blocks.push('* * *');
    else if (t === 'UL' || t === 'OL') blocks.push([...n.children].map((li, i) => (t === 'UL' ? '- ' : `${i + 1}. `) + inline(li)).join('\n'));
    else { const s = inline(n).trim(); if (s) blocks.push(s); }
  }
  return blocks.join('\n\n');
}

function compile(rootId, format) {
  editor?.flush();
  const root = store.get(rootId);
  const proj = store.projectOf(rootId) || root;
  const parts = gatherManuscript(rootId);
  const words = parts.reduce((n, p) => n + (p.html ? store.countWords(p.html) : 0), 0);
  const title = proj.title;
  let out = '';
  let prevText = false;
  if (format === 'html') {
    const body = parts.map(p => {
      if (p.kind === 'heading') { prevText = false; return `<h${Math.min(3, p.depth + 1)}>${esc(p.title)}</h${Math.min(3, p.depth + 1)}>`; }
      const sep = prevText ? '<p class="sep">#</p>' : '';
      prevText = true;
      return sep + p.html;
    }).join('\n');
    out = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
      body{font-family:'Courier Prime','Courier New',monospace;font-size:12pt;line-height:2;max-width:6.5in;margin:1in auto;color:#111}
      .title{text-align:center;margin:3in 0}h1{text-align:center;page-break-before:always;margin-top:2in}h2,h3{text-align:center}
      p{margin:0;text-indent:.5in}h1+p,h2+p,h3+p,.sep+p,hr+p{text-indent:0}.sep{text-align:center;text-indent:0;margin:1em 0}
      hr{border:0;text-align:center}hr:after{content:'#'}blockquote{margin:1em .5in}
    </style></head><body><div class="title"><h1 style="page-break-before:avoid;margin:0">${esc(title)}</h1><p style="text-indent:0">about ${fmt(Math.round(words / 100) * 100)} words</p></div>\n${body}</body></html>`;
    download(`${slug(title)}.html`, out, 'text/html');
  } else if (format === 'md') {
    out = `# ${title}\n\n` + parts.map(p => {
      if (p.kind === 'heading') { prevText = false; return `${'#'.repeat(Math.min(6, p.depth + 2))} ${p.title}`; }
      const sep = prevText ? '* * *\n\n' : '';
      prevText = true;
      return sep + htmlToMarkdown(p.html);
    }).join('\n\n') + '\n';
    download(`${slug(title)}.md`, out, 'text/markdown');
  } else {
    out = `${title.toUpperCase()}\n\n` + parts.map(p => {
      if (p.kind === 'heading') { prevText = false; return `\n${p.title.toUpperCase()}\n`; }
      const sep = prevText ? '                #\n\n' : '';
      prevText = true;
      return sep + store.plainText(p.html).replace(/\n{3,}/g, '\n\n').trim();
    }).join('\n\n') + '\n';
    download(`${slug(title)}.txt`, out, 'text/plain');
  }
  toast(`Compiled ${fmt(words)} words.`);
}

function compileMenu(id, x, y) {
  showMenu(x, y, [
    { label: 'Manuscript (.html, print-ready)', action: () => compile(id, 'html') },
    { label: 'Markdown (.md)', action: () => compile(id, 'md') },
    { label: 'Plain text (.txt)', action: () => compile(id, 'txt') },
  ]);
}

function exportBackup() {
  editor?.flush();
  const data = { app: 'faulkner', version: 1, exportedAt: new Date().toISOString(), items: store.allItems().map(store.serialize) };
  download(`faulkner-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 1), 'application/json');
}
function importBackup(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      const n = store.importItems(data.items || []);
      renderAll();
      toast(`Imported ${n} item${n === 1 ? '' : 's'}.`);
    } catch (e) { toast('That file could not be read as a Faulkner backup.'); }
  };
  r.readAsText(file);
}

// ---------------------------------------------------------------- settings dialog
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });

function opt(value, label, cur) { return `<option value="${value}" ${String(cur) === String(value) ? 'selected' : ''}>${label}</option>`; }

function openSettings(section) {
  const dlg = $('#settings');
  const form = $('#settings-form');
  const cfg = sync.getConfig() || {};
  const st = sync.getState();
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  form.innerHTML = `
    <div class="dlg-head"><h2 class="pixel">Settings</h2><button class="icon-btn" value="close" aria-label="Close">${icon('close')}</button></div>
    <div class="dlg-scroll">
    <section id="sec-sync">
      <h3>Sync across devices</h3>
      <p class="muted">Your writing is always saved on this device first. To use it on your phone and other computers, Faulkner keeps a copy in a <b>private GitHub repository</b> that you own. It needs no server and no subscription.</p>
      <details ${cfg.token ? '' : 'open'}><summary>One-time setup (about 3 minutes)</summary>
        <ol class="steps">
          <li>On GitHub, create a new <b>private</b> repository, e.g. <code>faulkner-vault</code>. Leave it empty.</li>
          <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Fine-grained tokens → Generate new token</a>. Under <i>Repository access</i> pick <b>Only select repositories</b> → your vault. Under <i>Permissions → Repository permissions</i> set <b>Contents: Read and write</b>. Pick a long expiration.</li>
          <li>Paste your GitHub username, the repo name, and the token below, then press <b>Connect</b>.</li>
          <li>On each other device, either repeat step 3, or tap <b>Copy setup code</b> here and use <b>Paste setup code</b> there.</li>
        </ol>
      </details>
      <div class="field-row">
        <label class="field"><span>GitHub owner</span><input name="owner" value="${esc(cfg.owner || '')}" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="your-username"></label>
        <label class="field"><span>Repository</span><input name="repo" value="${esc(cfg.repo || '')}" autocapitalize="off" spellcheck="false" placeholder="faulkner-vault"></label>
      </div>
      <label class="field"><span>Access token</span><input name="token" type="password" value="${esc(cfg.token || '')}" autocomplete="off" spellcheck="false" placeholder="github_pat_…"></label>
      <div class="btn-row">
        <button class="btn" type="button" data-s="connect">${cfg.token ? 'Save & sync now' : 'Connect'}</button>
        ${cfg.token ? '<button class="btn ghost" type="button" data-s="copy">Copy setup code</button><button class="btn ghost danger" type="button" data-s="disconnect">Disconnect</button>' : '<button class="btn ghost" type="button" data-s="paste">Paste setup code</button>'}
      </div>
      <p class="sync-msg ${st.status}">${syncLine(st)}</p>
      <p class="muted tiny">The token is stored only in this browser. The setup code contains it, so share it only between your own devices.</p>
    </section>

    <section>
      <h3>Writing</h3>
      <div class="field-row">
        <label class="field"><span>Typeface</span><select name="font">${opt('courier', 'Courier Prime', settings.font)}${opt('elite', 'Special Elite', settings.font)}${opt('literata', 'Literata (book serif)', settings.font)}</select></label>
        <label class="field"><span>Size</span><input name="fontSize" type="range" min="14" max="28" value="${settings.fontSize}"></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Page width</span><input name="width" type="range" min="480" max="960" step="20" value="${settings.width}"></label>
        <label class="field"><span>Daily word goal</span><input name="dailyGoal" type="number" min="0" step="50" value="${settings.dailyGoal}"></label>
      </div>
      <label class="check"><input type="checkbox" name="typewriter" ${settings.typewriter ? 'checked' : ''}> Typewriter scrolling (keeps your line centered)</label>
      <label class="check"><input type="checkbox" name="smartQuotes" ${settings.smartQuotes ? 'checked' : ''}> Smart quotes, em dashes (--) and ellipses (...)</label>
      <label class="check"><input type="checkbox" name="sounds" ${settings.sounds ? 'checked' : ''}> Typewriter sounds</label>
      <label class="field"><span>Sound volume</span><input name="volume" type="range" min="0" max="1" step="0.05" value="${settings.volume}"></label>
    </section>

    <section>
      <h3>Atmosphere</h3>
      <div class="field-row">
        <label class="field"><span>Theme</span><select name="theme">${opt('auto', 'Match device', settings.theme)}${opt('driftwood', 'Driftwood (light)', settings.theme)}${opt('foghorn', 'Foghorn (sepia)', settings.theme)}${opt('tidepool', 'Tidepool (dark)', settings.theme)}</select></label>
        <label class="field"><span>Typewriter</span><select name="body">${Object.keys(BODIES).map(k => opt(k, k[0].toUpperCase() + k.slice(1), settings.body)).join('')}</select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>Time of day</span><select name="sceneTime">${opt('auto', 'Follow the clock', settings.sceneTime)}${opt('dawn', 'Dawn', settings.sceneTime)}${opt('day', 'Day', settings.sceneTime)}${opt('dusk', 'Dusk', settings.sceneTime)}${opt('night', 'Night', settings.sceneTime)}</select></label>
        <label class="field"><span>Weather</span><select name="weather">${opt('auto', 'Coastal forecast', settings.weather)}${opt('clear', 'Clear', settings.weather)}${opt('drizzle', 'Drizzle', settings.weather)}${opt('rain', 'Rain', settings.weather)}${opt('fog', 'Fog', settings.weather)}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="scene" ${settings.scene ? 'checked' : ''}> Show the window</label>
      <label class="check"><input type="checkbox" name="motion" ${settings.motion ? 'checked' : ''}> Animate the scene</label>
    </section>

    <section>
      <h3>Library</h3>
      <div class="btn-row">
        <button class="btn ghost" type="button" data-s="export">Download backup</button>
        <label class="btn ghost file-btn">Restore from backup<input type="file" accept=".json,application/json" data-s="import" hidden></label>
        ${installPrompt ? '<button class="btn" type="button" data-s="install">Install app</button>' : ''}
      </div>
      ${isIOS ? '<p class="muted tiny">To install on iPhone or iPad: tap Share → <b>Add to Home Screen</b>.</p>' : '<p class="muted tiny">Install Faulkner from your browser menu (“Install app” or “Add to Home screen”) to open it like a native app.</p>'}
    </section>
    </div>`;

  form.onsubmit = e => { if (e.submitter?.value !== 'close') e.preventDefault(); };
  form.oninput = form.onchange = e => {
    const el = e.target;
    if (!el.name || ['owner', 'repo', 'token'].includes(el.name)) return;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? +el.value : el.value;
    saveSettings({ [el.name]: v });
  };
  form.onclick = async e => {
    const b = e.target.closest('[data-s]');
    if (!b) return;
    const act = b.dataset.s;
    const msg = form.querySelector('.sync-msg');
    if (act === 'connect') {
      const next = { owner: form.owner.value.trim(), repo: form.repo.value.trim(), token: form.token.value.trim() };
      if (!next.owner || !next.repo || !next.token) { msg.textContent = 'Fill in all three fields.'; msg.className = 'sync-msg error'; return; }
      msg.textContent = 'Checking…'; msg.className = 'sync-msg syncing';
      try {
        const repo = await sync.testConfig(next);
        if (!repo.private) toast('Heads up: that repository is public. Make it private to keep your writing to yourself.', 6000);
        const prev = sync.getConfig();
        sync.setConfig({ ...next, branch: prev && prev.repo === next.repo && prev.owner === next.owner ? prev.branch : repo.default_branch });
        await runSync();
        openSettings('sync');
      } catch (err) {
        msg.textContent = err.status === 401 ? 'GitHub rejected that token.' : err.status === 404 ? 'Repository not found, or the token cannot see it.' : (err.message || 'Could not connect.');
        msg.className = 'sync-msg error';
      }
    } else if (act === 'disconnect') {
      if (confirm('Stop syncing on this device? Your writing stays here and in the vault.')) { sync.setConfig(null); openSettings('sync'); }
    } else if (act === 'copy') {
      const code = sync.encodeSetupCode(sync.getConfig());
      try { await navigator.clipboard.writeText(code); toast('Setup code copied. Paste it into Faulkner on your other device.'); }
      catch { prompt('Copy this setup code:', code); }
    } else if (act === 'paste') {
      let code = '';
      try { code = await navigator.clipboard.readText(); } catch { /* fall through */ }
      if (!code || !code.startsWith('FAULKNER1:')) code = prompt('Paste your setup code:') || '';
      try {
        const c = sync.decodeSetupCode(code);
        form.owner.value = c.owner; form.repo.value = c.repo; form.token.value = c.token;
        form.querySelector('[data-s="connect"]').click();
      } catch { toast('That does not look like a Faulkner setup code.'); }
    } else if (act === 'export') exportBackup();
    else if (act === 'install' && installPrompt) { installPrompt.prompt(); installPrompt = null; }
  };
  form.querySelector('[data-s="import"]').onchange = e => { const f = e.target.files[0]; if (f) importBackup(f); };
  if (!dlg.open) dlg.showModal();
  if (section) form.querySelector('#sec-' + section)?.scrollIntoView();
}

function syncLine(st) {
  if (!sync.isConfigured()) return 'Not connected. Writing is saved on this device only.';
  if (st.status === 'syncing') return 'Syncing…';
  if (st.status === 'error' || st.status === 'offline') return st.message;
  return st.lastSync ? `Synced ${timeAgo(st.lastSync)}.` : 'Connected.';
}
function timeAgo(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---------------------------------------------------------------- sync wiring
const syncHooks = {
  beforeSync: () => editor?.flush(),
  afterSync: res => {
    if (res.conflicts?.length) toast(`Edited on two devices at once: kept both versions of “${res.conflicts[0]}”.`, 6000);
    if (res.pulled) {
      const it = store.get(selected);
      if (editor && it && !store.isHidden(selected) && (it.type === 'doc' || it.type === 'note')) {
        editor.reload(it);
        const t = view.querySelector('.doc-title');
        if (t && document.activeElement !== t) t.value = it.title;
        renderBinder(); renderCrumbs(); renderInspector(); renderStatus();
      } else if (!app.classList.contains('mode-board') || !view.contains(document.activeElement)) {
        if (editor) { editor.destroy(); editor = null; }
        renderAll();
      } else renderBinder();
    }
  },
};
let syncTimer = null;
function runSync() { clearTimeout(syncTimer); return sync.sync(syncHooks); }
function scheduleSync(ms = 4000) {
  if (!sync.isConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, ms);
}

sync.onStatus(st => {
  const chip = $('#sync-status');
  chip.className = 'chip sync-' + (sync.isConfigured() ? st.status : 'off');
  const label = !sync.isConfigured() ? 'Local' : st.status === 'syncing' ? 'Syncing' : st.status === 'error' ? 'Sync issue' : st.status === 'offline' ? 'Offline' : 'Synced';
  chip.querySelector('.label').textContent = label;
  chip.title = syncLine(st);
  const m = document.querySelector('#settings .sync-msg');
  if (m) { m.textContent = syncLine(st); m.className = 'sync-msg ' + st.status; }
});
$('#sync-status').onclick = () => {
  const st = sync.getState();
  if (!sync.isConfigured() || st.status === 'error') openSettings('sync');
  else runSync();
};

// ---------------------------------------------------------------- chrome
function applySettings() {
  const root = document.documentElement;
  const theme = settings.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'tidepool' : 'driftwood') : settings.theme;
  root.dataset.theme = theme;
  root.style.setProperty('--editor-font', FONTS[settings.font] || FONTS.courier);
  root.style.setProperty('--editor-size', settings.fontSize + 'px');
  root.style.setProperty('--page-width', settings.width + 'px');
  document.querySelector('meta[name="theme-color"]').content = getComputedStyle(root).getPropertyValue('--chrome').trim() || '#1c2b2d';
  app.classList.toggle('no-scene', !settings.scene);
  $('#toolbar [data-cmd="typewriter"]').classList.toggle('on', settings.typewriter);
  sound.setVolume(settings.volume);
  const [b, hi, lo] = BODIES[settings.body] || BODIES.seafoam;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (settings.scene && !scene) scene = createScene($('#scene'), {});
  if (scene) {
    scene.setOptions({ time: settings.sceneTime, weather: settings.weather, body: b, bodyHi: hi, bodyLo: lo, motion: settings.motion && !reduce });
    settings.scene ? scene.resume() : scene.pause();
  }
  renderStatus();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applySettings);

function openBinder() { app.classList.add('binder-open'); }
function closeDrawers() { app.classList.remove('binder-open', 'insp-open'); }
const narrow = () => matchMedia('(max-width: 760px)').matches;

$('#btn-binder').onclick = () => {
  if (narrow()) { app.classList.toggle('binder-open'); app.classList.remove('insp-open'); }
  else app.classList.toggle('binder-hidden');
};
$('#btn-inspector').onclick = () => {
  if (matchMedia('(max-width: 1100px)').matches) { app.classList.toggle('insp-open'); app.classList.remove('binder-open'); }
  else app.classList.toggle('insp-hidden');
  localStorage.setItem('faulkner.insp', app.classList.contains('insp-hidden') ? 'hidden' : 'shown');
};
$('#scrim').onclick = closeDrawers;
$('#btn-settings').onclick = () => openSettings();
$('#btn-focus').onclick = () => toggleFocus();
$('#btn-new-project').onclick = () => { newProject(); if (narrow()) closeDrawers(); };
$('#btn-trash').onclick = () => { select('trash'); if (narrow()) closeDrawers(); };
$('#search').addEventListener('input', e => { searchTerm = e.target.value.trim(); renderBinder(); });

function toggleFocus(force) {
  const on = force ?? !app.classList.contains('focus');
  app.classList.toggle('focus', on);
  if (on) toast('Focus mode. Press Esc to return.', 1800);
}

$('#toolbar').addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); });
$('#toolbar').addEventListener('click', e => {
  const b = e.target.closest('button[data-cmd]');
  if (!b) return;
  if (b.dataset.cmd === 'typewriter') { saveSettings({ typewriter: !settings.typewriter }); return; }
  editor?.command(b.dataset.cmd);
});

addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (e.key === 'Escape') { if (app.classList.contains('focus')) toggleFocus(false); hideMenu(); closeDrawers(); }
  if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocus(); }
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); editor?.flush(); store.flush(); runSync(); toast(sync.isConfigured() ? 'Saved & syncing.' : 'Saved on this device.', 1400); }
});

// Persist & sync around lifecycle events.
store.subscribe((reason, detail) => {
  if (reason !== 'local') return;
  scheduleSync(detail && detail.quiet ? 6000 : 2500);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { editor?.flush(); store.flush(); runSync(); }
  else { applySettings(); runSync(); }
});
addEventListener('pagehide', () => { editor?.flush(); store.flush(); });
addEventListener('online', () => runSync());
setInterval(() => { if (!document.hidden) runSync(); }, 60000);
setInterval(() => { if (!document.hidden && scene && settings.sceneTime === 'auto') scene.setOptions({}); }, 5 * 60000);

// ---------------------------------------------------------------- boot
async function boot() {
  hydrateIcons();
  if (localStorage.getItem('faulkner.insp') === 'hidden') app.classList.add('insp-hidden');
  try { await navigator.storage?.persist?.(); } catch { /* best effort */ }
  await store.load();
  applySettings();
  renderAll();
  if (sync.isConfigured()) runSync();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

// Exposed for debugging and tests.
window.faulkner = { store, sync, select, runSync };

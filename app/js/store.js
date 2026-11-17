// In-memory model of the binder, persisted to IndexedDB.
// Item shape (synced fields):
//   id, type ('project'|'folder'|'doc'|'note'), parentId, order, title, content (html),
//   synopsis, status, label, target, notes, role, trashed, snapshots[], createdAt, updatedAt
// Local-only fields start with "_":  _sha (remote blob sha at last sync), _dirty, _rev, _deleted (tombstone)
import { db } from './db.js';

const items = new Map();
const listeners = new Set();
const pending = new Set();
let flushTimer = null;

export const STATUSES = ['', 'To Do', 'First Draft', 'Revised Draft', 'Final Draft', 'Done'];
export const LABELS = {
  '': 'None',
  kelp: 'Kelp',
  tide: 'Tide',
  salmon: 'Salmon',
  driftwood: 'Driftwood',
  huckleberry: 'Huckleberry',
  fog: 'Fog',
};

export const ROLE_INFO = {
  manuscript: { title: 'Manuscript', icon: 'book' },
  outline: { title: 'Outline', icon: 'list' },
  characters: { title: 'Characters', icon: 'person' },
  places: { title: 'Places', icon: 'tree' },
  notes: { title: 'Notes', icon: 'note' },
  research: { title: 'Research', icon: 'folder' },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export const isContainer = it => it && (it.type === 'project' || it.type === 'folder');

export function emit(reason, detail) {
  for (const fn of listeners) fn(reason, detail);
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function load() {
  const all = await db.all();
  items.clear();
  for (const it of all) items.set(it.id, it);
}

export const get = id => (id ? items.get(id) : undefined);
export const live = it => it && !it._deleted;
export const allItems = () => [...items.values()].filter(live);
export const rawItems = () => [...items.values()];

export function children(parentId, { includeTrashed = false } = {}) {
  return allItems()
    .filter(i => (i.parentId || null) === (parentId || null) && (includeTrashed || !i.trashed))
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}

export function ancestors(id) {
  const out = [];
  let cur = get(id);
  const seen = new Set();
  while (cur && cur.parentId && !seen.has(cur.parentId)) {
    seen.add(cur.parentId);
    cur = get(cur.parentId);
    if (cur) out.unshift(cur);
  }
  return out;
}

export function projectOf(id) {
  const it = get(id);
  if (!it) return null;
  if (it.type === 'project') return it;
  return ancestors(id).find(a => a.type === 'project') || null;
}

export function isHidden(id) {
  const it = get(id);
  if (!it || it._deleted) return true;
  if (it.trashed) return true;
  return ancestors(id).some(a => a.trashed);
}

export function roleOf(id) {
  const it = get(id);
  if (it && it.role) return it.role;
  const anc = ancestors(id).reverse().find(a => a.role);
  return anc ? anc.role : null;
}

export function descendants(id) {
  const out = [];
  const walk = pid => {
    for (const c of allItems().filter(i => i.parentId === pid)) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

function persist(id) {
  pending.add(id);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, 250);
}

export async function flush() {
  clearTimeout(flushTimer);
  if (!pending.size) return;
  const ids = [...pending];
  pending.clear();
  const puts = [], dels = [];
  for (const id of ids) {
    const it = items.get(id);
    if (it) puts.push(it); else dels.push(id);
  }
  if (puts.length) await db.putMany(puts);
  if (dels.length) await db.delMany(dels);
}

function nextOrder(parentId) {
  const sib = children(parentId, { includeTrashed: true });
  return sib.length ? sib[sib.length - 1].order + 1 : 1;
}

export function create(fields) {
  const now = Date.now();
  const it = {
    id: uid(),
    type: 'doc',
    parentId: null,
    title: 'Untitled',
    content: '',
    synopsis: '',
    status: '',
    label: '',
    target: 0,
    notes: '',
    role: '',
    trashed: false,
    snapshots: [],
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
  if (it.order == null) it.order = nextOrder(it.parentId);
  it._dirty = true;
  it._rev = 1;
  items.set(it.id, it);
  persist(it.id);
  emit('local', { id: it.id, created: true });
  return it;
}

// Apply a local edit. Marks the item for sync.
export function update(id, patch, { quiet = false } = {}) {
  const it = items.get(id);
  if (!it || it._deleted) return null;
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (it[k] !== v) { it[k] = v; changed = true; }
  }
  if (!changed) return it;
  it.updatedAt = Date.now();
  it._dirty = true;
  it._rev = (it._rev || 0) + 1;
  persist(id);
  emit('local', { id, patch, quiet });
  return it;
}

export function move(id, parentId, beforeId = null) {
  const it = get(id);
  if (!it) return;
  // Refuse to move into own subtree.
  if (parentId && (parentId === id || ancestors(parentId).some(a => a.id === id))) return;
  const sibs = children(parentId).filter(s => s.id !== id);
  let order;
  if (beforeId) {
    const idx = sibs.findIndex(s => s.id === beforeId);
    if (idx === -1) order = nextOrder(parentId);
    else {
      const prev = sibs[idx - 1];
      order = prev ? (prev.order + sibs[idx].order) / 2 : sibs[idx].order - 1;
    }
  } else {
    order = sibs.length ? sibs[sibs.length - 1].order + 1 : 1;
  }
  update(id, { parentId: parentId || null, order });
}

export function shift(id, dir) {
  const it = get(id);
  if (!it) return;
  const sibs = children(it.parentId);
  const idx = sibs.findIndex(s => s.id === id);
  const target = sibs[idx + dir];
  if (!target) return;
  const a = it.order, b = target.order;
  update(id, { order: b });
  update(target.id, { order: a });
}

export function trash(id) { update(id, { trashed: true }); }
export function restore(id) {
  const it = get(id);
  if (!it) return;
  // If the parent is gone, restore to the top of the project tree.
  const parent = get(it.parentId);
  const patch = { trashed: false };
  if (it.parentId && (!parent || parent._deleted)) patch.parentId = null;
  update(id, patch);
}

// Permanently delete (with sync tombstones).
export function purge(id) {
  const ids = [id, ...descendants(id).map(d => d.id)];
  for (const i of ids) {
    const it = items.get(i);
    if (!it) continue;
    if (it._sha) {
      items.set(i, { id: i, _deleted: true, _sha: it._sha, _dirty: true, _rev: (it._rev || 0) + 1 });
    } else {
      items.delete(i);
    }
    persist(i);
  }
  emit('local', { id, purged: true });
}

export function duplicate(id) {
  const it = get(id);
  if (!it) return null;
  const clone = (src, parentId, order) => {
    const { id: _i, _sha, _dirty, _rev, createdAt, updatedAt, ...rest } = src;
    const copy = create({ ...rest, parentId, order, title: src === it ? `${src.title} (copy)` : src.title });
    for (const c of children(src.id)) clone(c, copy.id, c.order);
    return copy;
  };
  const sibs = children(it.parentId);
  const idx = sibs.findIndex(s => s.id === id);
  const next = sibs[idx + 1];
  return clone(it, it.parentId, next ? (it.order + next.order) / 2 : it.order + 1);
}

// --- Sync hooks ---------------------------------------------------------
export function serialize(it) {
  const out = {};
  for (const [k, v] of Object.entries(it)) if (!k.startsWith('_')) out[k] = v;
  return out;
}

// Replace local item with a remote version (no dirty flag).
export function applyRemote(data, sha) {
  items.set(data.id, { ...data, _sha: sha, _dirty: false, _rev: 0 });
  persist(data.id);
}
export function removeLocal(id) { items.delete(id); persist(id); }
export function markSynced(id, sha, rev) {
  const it = items.get(id);
  if (!it) return;
  if (it._deleted) {
    if (it._rev === rev) items.delete(id);
  } else {
    it._sha = sha;
    if (it._rev === rev) it._dirty = false;
  }
  persist(id);
}
export function setSha(id, sha) { const it = items.get(id); if (it) { it._sha = sha; persist(id); } }
export function forgetSync() {
  // Used when switching repositories: everything becomes "new" again.
  for (const [id, it] of items) {
    if (it._deleted) { items.delete(id); persist(id); continue; }
    it._sha = null; it._dirty = true; persist(id);
  }
}
export const dirtyItems = () => rawItems().filter(i => i._dirty);

// Merge items from a backup file; newer versions win.
export function importItems(list) {
  let n = 0;
  for (const data of list) {
    if (!data || !data.id || !data.type) continue;
    const local = items.get(data.id);
    if (local && !local._deleted && (local.updatedAt || 0) >= (data.updatedAt || 0)) continue;
    items.set(data.id, { ...data, _sha: local ? local._sha : null, _dirty: true, _rev: ((local && local._rev) || 0) + 1 });
    persist(data.id);
    n++;
  }
  emit('local', { imported: n });
  return n;
}

// --- Text helpers ---------------------------------------------------------
const scratch = typeof document !== 'undefined' ? document.createElement('div') : null;
export function plainText(html) {
  if (!html) return '';
  scratch.innerHTML = html.replace(/<\/(p|h\d|blockquote|li|div)>/gi, '</$1>\n').replace(/<br\s*\/?>(?!\n)/gi, '<br>\n');
  return scratch.textContent || '';
}
export function countWords(html) {
  const m = plainText(html).match(/[\p{L}\p{N}'’-]+/gu);
  return m ? m.length : 0;
}
const wcCache = new Map();
export function wordsOf(it) {
  if (!it || !it.content) return 0;
  const hit = wcCache.get(it.id);
  if (hit && hit.content === it.content) return hit.n;
  const n = countWords(it.content);
  wcCache.set(it.id, { content: it.content, n });
  return n;
}
export function wordsUnder(id, { docsOnly = false } = {}) {
  const it = get(id);
  let n = it && (!docsOnly || it.type === 'doc') ? wordsOf(it) : 0;
  for (const d of descendants(id)) if (!d.trashed && (!docsOnly || d.type === 'doc')) n += wordsOf(d);
  return n;
}

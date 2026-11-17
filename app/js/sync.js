// Sync with a private GitHub repository using the Git Data API.
// Every binder item is a JSON file: items/<id>.json. One sync = pull changed blobs,
// resolve conflicts, then push all local changes as a single commit.
import * as store from './store.js';
import { db } from './db.js';
import * as files from './files.js';

const API = 'https://api.github.com';
// Storage keys keep the app's original 'faulkner' prefix so existing data stays put.
const CONFIG_KEY = 'faulkner.sync';

const state = {
  status: 'off', // off | idle | syncing | error | offline
  message: '',
  lastSync: 0,
  running: null,
  again: false,
};
const listeners = new Set();
export const onStatus = fn => { listeners.add(fn); fn(state); };
function setStatus(status, message = '') {
  state.status = status;
  state.message = message;
  for (const fn of listeners) fn(state);
}
export const getState = () => state;

export function getConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || null; } catch { return null; }
}
export function setConfig(cfg) {
  const prev = getConfig();
  if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(CONFIG_KEY);
  const changedRepo = !prev || !cfg || prev.owner !== cfg.owner || prev.repo !== cfg.repo;
  if (changedRepo) {
    store.forgetSync();
    db.setMeta('lastHead', null);
  }
  setStatus(cfg ? 'idle' : 'off');
}
export const isConfigured = () => {
  const c = getConfig();
  return !!(c && c.owner && c.repo && c.token);
};

export function encodeSetupCode(cfg) {
  return 'CARVER1:' + btoa(unescape(encodeURIComponent(JSON.stringify({ o: cfg.owner, r: cfg.repo, t: cfg.token }))));
}
export function decodeSetupCode(code) {
  const raw = code.trim().replace(/^(CARVER1|FAULKNER1):/, '');
  const o = JSON.parse(decodeURIComponent(escape(atob(raw))));
  return { owner: o.o, repo: o.r, token: o.t };
}

class GitHubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function gh(cfg, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}/repos/${cfg.owner}/${cfg.repo}${path}`, {
    method,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch { /* ignore */ }
    throw new GitHubError(res.status, msg);
  }
  return res.status === 204 ? null : res.json();
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function blobSha(text) {
  const body = enc.encode(text);
  const head = enc.encode(`blob ${body.length}\0`);
  const all = new Uint8Array(head.length + body.length);
  all.set(head); all.set(body, head.length);
  const hash = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

const pathFor = id => `items/${id}.json`;
const idFromPath = p => { const m = /^items\/(.+)\.json$/.exec(p); return m ? m[1] : null; };
const stringify = data => JSON.stringify(data, null, 1) + '\n';

async function ensureBranch(cfg) {
  if (!cfg.branch) {
    const repo = await gh(cfg, '');
    cfg.branch = repo.default_branch || 'main';
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  }
  try {
    const ref = await gh(cfg, `/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    return ref.object.sha;
  } catch (e) {
    if (e.status !== 409 && e.status !== 404) throw e;
    // Empty repository: create a first commit so the Git Data API works.
    const readme = '# Carver vault\n\nThis private repository stores writing synced by Carver.\nEach file in `items/` is one binder item. Please don\'t edit by hand.\n';
    await gh(cfg, '/contents/README.md', {
      method: 'PUT',
      body: { message: 'Initialize Carver vault', content: btoa(readme), branch: cfg.branch },
    });
    const ref = await gh(cfg, `/git/ref/heads/${encodeURIComponent(cfg.branch)}`);
    return ref.object.sha;
  }
}

function deviceName() {
  let n = localStorage.getItem('faulkner.device');
  if (!n) {
    const ua = navigator.userAgent;
    n = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
    localStorage.setItem('faulkner.device', n);
  }
  return n;
}

async function syncOnce(cfg, hooks) {
  hooks.beforeSync?.();
  await store.flush();
  const head = await ensureBranch(cfg);
  const lastHead = await db.getMeta('lastHead');
  const dirty = store.dirtyItems();
  if (head === lastHead && !dirty.length) return { pulled: 0, pushed: 0 };

  let pulled = 0;
  const conflicts = [];
  const remote = new Map(); // id -> sha
  const remoteFiles = new Set(); // attachment hashes stored in the vault

  {
    const commit = await gh(cfg, `/git/commits/${head}`);
    const tree = await gh(cfg, `/git/trees/${commit.tree.sha}?recursive=1`);
    for (const e of tree.tree) {
      if (e.type !== 'blob') continue;
      const id = idFromPath(e.path);
      if (id) remote.set(id, e.sha);
      else if (e.path.startsWith('files/')) remoteFiles.add(e.path.slice(6));
    }
  }

  if (head !== lastHead) {

    // Pull: new or changed remote items.
    const changed = [...remote].filter(([id, sha]) => {
      const local = store.get(id);
      return !local || local._sha !== sha;
    });
    const CONCURRENCY = 6;
    for (let i = 0; i < changed.length; i += CONCURRENCY) {
      const batch = changed.slice(i, i + CONCURRENCY);
      const blobs = await Promise.all(batch.map(([, sha]) => gh(cfg, `/git/blobs/${sha}`)));
      batch.forEach(([id, sha], j) => {
        let data;
        try { data = JSON.parse(decodeBase64(blobs[j].content)); } catch { return; }
        const local = store.get(id); // read *now*, after the await, so we see the latest edits
        if (!local) { store.applyRemote(data, sha); pulled++; return; }
        if (local._deleted) { store.setSha(id, sha); return; } // our delete wins
        if (!local._dirty) { store.applyRemote(data, sha); pulled++; return; }
        // Both sides changed.
        const mine = store.serialize(local);
        if (JSON.stringify(mine) === JSON.stringify(data)) { store.markSynced(id, sha, local._rev); return; }
        const mineNewer = (local.updatedAt || 0) >= (data.updatedAt || 0);
        const loser = mineNewer ? data : mine;
        if (!mineNewer) store.applyRemote(data, sha); else store.setSha(id, sha);
        if (loser.type !== 'project' && loser.type !== 'folder' && (loser.content || '') !== ((mineNewer ? mine : data).content || '')) {
          const { id: _drop, ...rest } = loser;
          store.create({ ...rest, order: (loser.order || 0) + 0.001, title: `${loser.title} (conflict copy)` });
          conflicts.push(loser.title);
        }
        pulled++;
      });
    }

    // Remote deletions: we knew it remotely, it's gone now, and we haven't touched it.
    for (const it of store.rawItems()) {
      if (it._sha && !remote.has(it.id)) {
        if (it._deleted || !it._dirty) { store.removeLocal(it.id); pulled++; }
        else store.setSha(it.id, null);
      }
    }
  }

  // Push.
  const toPush = store.dirtyItems();
  let pushed = 0;
  if (toPush.length) {
    const entries = [];
    const results = [];
    for (const it of toPush) {
      if (it._deleted) {
        if (remote.has(it.id)) entries.push({ path: pathFor(it.id), mode: '100644', type: 'blob', sha: null });
        results.push({ id: it.id, sha: null, rev: it._rev });
      } else {
        const text = stringify(store.serialize(it));
        entries.push({ path: pathFor(it.id), mode: '100644', type: 'blob', content: text });
        results.push({ id: it.id, sha: await blobSha(text), rev: it._rev });
      }
    }
    // Attachments: upload new ones, drop ones nothing points to any more.
    const referenced = new Set(attachments().map(a => a.sha));
    for (const sha of referenced) {
      if (remoteFiles.has(sha)) continue;
      const rec = await files.getFile(sha);
      if (!rec) continue;
      const b64 = await files.blobToBase64(rec.blob);
      await gh(cfg, '/git/blobs', { method: 'POST', body: { content: b64, encoding: 'base64' } });
      entries.push({ path: `files/${sha}`, mode: '100644', type: 'blob', sha });
    }
    for (const sha of remoteFiles) {
      if (!referenced.has(sha)) entries.push({ path: `files/${sha}`, mode: '100644', type: 'blob', sha: null });
    }
    if (entries.length) {
      const commit = await gh(cfg, `/git/commits/${head}`);
      const tree = await gh(cfg, '/git/trees', { method: 'POST', body: { base_tree: commit.tree.sha, tree: entries } });
      const n = entries.length;
      const next = await gh(cfg, '/git/commits', {
        method: 'POST',
        body: { message: `Carver: ${n} change${n === 1 ? '' : 's'} from ${deviceName()}`, tree: tree.sha, parents: [head] },
      });
      try {
        await gh(cfg, `/git/refs/heads/${encodeURIComponent(cfg.branch)}`, { method: 'PATCH', body: { sha: next.sha, force: false } });
      } catch (e) {
        if (e.status === 422 || e.status === 409) { await store.flush(); return { retry: true }; }
        throw e;
      }
      await db.setMeta('lastHead', next.sha);
    } else {
      await db.setMeta('lastHead', head);
    }
    for (const r of results) store.markSynced(r.id, r.sha, r.rev);
    pushed = results.length;
  } else {
    await db.setMeta('lastHead', head);
  }
  await store.flush();
  return { pulled, pushed, conflicts };
}

export function sync(hooks = {}) {
  if (!isConfigured()) { setStatus('off'); return Promise.resolve(null); }
  if (state.running) { state.again = true; return state.running; }
  if (!navigator.onLine) { setStatus('offline', 'Offline. Changes are saved on this device.'); return Promise.resolve(null); }
  setStatus('syncing');
  state.running = (async () => {
    const cfg = getConfig();
    let result = null;
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        result = await syncOnce(cfg, hooks);
        if (!result.retry) break;
      }
      state.lastSync = Date.now();
      setStatus('idle');
      if (result && (result.pulled || result.pushed)) hooks.afterSync?.(result);
    } catch (e) {
      console.error('sync failed', e);
      let msg = e.message || String(e);
      if (e.status === 401) msg = 'GitHub rejected the token. It may have expired.';
      else if (e.status === 403) msg = 'The token lacks permission. Give it Contents: Read & write on the vault repo.';
      else if (e.status === 404) msg = 'Repository not found. Check the owner/name and that the token can access it.';
      else if (e instanceof TypeError) msg = 'Network error. Will retry.';
      setStatus(e instanceof TypeError ? 'offline' : 'error', msg);
    } finally {
      state.running = null;
      if (state.again) { state.again = false; setTimeout(() => sync(hooks), 50); }
    }
    return result;
  })();
  return state.running;
}

// Download an attachment from the vault (used when a file was added on another device).
const fetching = new Map();
export function fetchFile(sha, mime) {
  if (!isConfigured()) return Promise.resolve(null);
  if (!fetching.has(sha)) {
    fetching.set(sha, (async () => {
      const blob = await gh(getConfig(), `/git/blobs/${sha}`);
      const bytes = files.base64ToBytes(blob.content);
      await files.putBytes(sha, bytes, mime);
      return files.getFile(sha);
    })().finally(() => fetching.delete(sha)));
  }
  return fetching.get(sha);
}
// Every binary file the binder points at: uploaded attachments and eBook covers.
function attachments() {
  const out = [];
  for (const it of store.allItems()) {
    if (it.type === 'file' && it.fileSha) out.push({ sha: it.fileSha, mime: it.mime });
    const cover = it.compile && it.compile.meta;
    if (cover && cover.coverSha) out.push({ sha: cover.coverSha, mime: cover.coverMime });
  }
  return out;
}
export async function fetchMissingFiles() {
  for (const a of attachments()) {
    if (await files.hasFile(a.sha)) continue;
    try { await fetchFile(a.sha, a.mime); } catch (e) { console.warn('could not fetch attachment', e); }
  }
}

// Quick connectivity/permission check used by the settings dialog.
export async function testConfig(cfg) {
  const repo = await gh(cfg, '');
  if (repo.permissions && repo.permissions.push === false) throw new GitHubError(403, 'Token can read but not write to this repository.');
  return repo;
}

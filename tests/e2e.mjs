// End-to-end test: two devices (desktop + phone) syncing through a mocked GitHub API.
// Run:  node tests/e2e.mjs   (needs Playwright + Chromium)
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const OUT = process.env.SHOTS || path.join(path.dirname(fileURLToPath(import.meta.url)), 'shots');
fs.mkdirSync(OUT, { recursive: true });

// ---- static server
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

// ---- mock GitHub (Git Data API subset)
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const gitBlobSha = s => { const b = Buffer.from(s, 'utf8'); return sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])); };
const gh = { blobs: new Map(), trees: new Map(), commits: new Map(), ref: null, calls: 0 };
function putTree(entries) { const s = sha1(JSON.stringify([...entries].sort((a, b) => a.path.localeCompare(b.path)))); gh.trees.set(s, entries); return s; }

async function handle(route) {
  const req = route.request();
  const url = new URL(req.url());
  const m = url.pathname.match(/^\/repos\/me\/vault(.*)$/);
  gh.calls++;
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
  if (req.headers()['authorization'] !== 'Bearer good-token') return json(401, { message: 'Bad credentials' });
  if (!m) return json(404, { message: 'Not Found' });
  const p = m[1];
  const body = req.postData() ? JSON.parse(req.postData()) : null;
  const method = req.method();
  if (p === '' && method === 'GET') return json(200, { default_branch: 'main', private: true, permissions: { push: true } });
  if (p === '/git/ref/heads/main') return gh.ref ? json(200, { object: { sha: gh.ref } }) : json(409, { message: 'Git Repository is empty.' });
  if (p === '/contents/README.md' && method === 'PUT') {
    const text = Buffer.from(body.content, 'base64').toString('utf8');
    const bs = gitBlobSha(text); gh.blobs.set(bs, text);
    const t = putTree([{ path: 'README.md', sha: bs }]);
    const c = sha1('c' + t + Date.now()); gh.commits.set(c, { tree: t, parents: [] }); gh.ref = c;
    return json(201, {});
  }
  let mm;
  if ((mm = p.match(/^\/git\/commits\/(\w+)$/))) { const c = gh.commits.get(mm[1]); return c ? json(200, { sha: mm[1], tree: { sha: c.tree } }) : json(404, {}); }
  if ((mm = p.match(/^\/git\/trees\/(\w+)$/))) {
    const t = gh.trees.get(mm[1]);
    return json(200, { sha: mm[1], truncated: false, tree: t.map(e => ({ path: e.path, type: 'blob', mode: '100644', sha: e.sha })) });
  }
  if ((mm = p.match(/^\/git\/blobs\/(\w+)$/))) return json(200, { content: Buffer.from(gh.blobs.get(mm[1]), 'utf8').toString('base64').replace(/(.{60})/g, '$1\n'), encoding: 'base64' });
  if (p === '/git/trees' && method === 'POST') {
    const map = new Map(gh.trees.get(body.base_tree).map(e => [e.path, e]));
    for (const e of body.tree) {
      if (e.sha === null) map.delete(e.path);
      else { const bs = gitBlobSha(e.content); gh.blobs.set(bs, e.content); map.set(e.path, { path: e.path, sha: bs }); }
    }
    return json(201, { sha: putTree([...map.values()]) });
  }
  if (p === '/git/commits' && method === 'POST') { const c = sha1(JSON.stringify(body) + Math.random()); gh.commits.set(c, { tree: body.tree, parents: body.parents }); return json(201, { sha: c }); }
  if (p === '/git/refs/heads/main' && method === 'PATCH') {
    const c = gh.commits.get(body.sha);
    if (!c.parents.includes(gh.ref)) return json(422, { message: 'Update is not a fast forward' });
    gh.ref = body.sha; return json(200, {});
  }
  return json(404, { message: 'unhandled ' + method + ' ' + p });
}

const browser = await chromium.launch();
const errors = [];
async function device(name, opts) {
  const ctx = await browser.newContext({ ...opts, serviceWorkers: 'block' });
  await ctx.route('https://api.github.com/**', handle);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await page.goto(BASE);
  await page.waitForSelector('.welcome');
  return page;
}
const check = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok -', msg); };
const remoteItems = () => { const t = gh.trees.get(gh.commits.get(gh.ref).tree); return t.filter(e => e.path.startsWith('items/')).map(e => JSON.parse(gh.blobs.get(e.sha))); };

async function connect(page) {
  await page.click('#btn-settings');
  await page.fill('input[name=owner]', 'me');
  await page.fill('input[name=repo]', 'vault');
  await page.fill('input[name=token]', 'good-token');
  await page.click('[data-s=connect]');
  await page.waitForFunction(() => window.faulkner.sync.getState().status === 'idle' && window.faulkner.sync.getState().lastSync > 0);
  await page.click('dialog [value=close]');
}
const syncNow = page => page.evaluate(() => window.faulkner.runSync());

// ---- Desktop: write something
const A = await device('desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await A.evaluate(() => localStorage.setItem('faulkner.settings', JSON.stringify({ sceneTime: 'dusk', weather: 'drizzle', sounds: false })));
await A.reload(); await A.waitForSelector('.welcome');
await A.screenshot({ path: `${OUT}/1-welcome.png` });
await A.click('[data-w=new]');
await A.waitForSelector('#page');
await A.click('#page');
await A.keyboard.type('The fog came in off the water before the boats did. "Not yet," she said -- and waited...');
await A.keyboard.press('Enter');
await A.keyboard.type('Somewhere past the jetty a bell buoy rang, slow as a heartbeat.');
await A.waitForTimeout(700);
const text = await A.evaluate(() => document.querySelector('#page').innerText);
check(text.includes('“Not yet,”') && text.includes('—') && text.includes('…'), 'smart quotes, em dash & ellipsis');
await A.screenshot({ path: `${OUT}/2-editor-desktop.png` });

// Inspector & corkboard
await A.fill('[data-f=synopsis]', 'Mara waits on the dock for the boats that are late.');
await A.click('#crumbs a:nth-of-type(3)');
await A.waitForSelector('.cork');
await A.screenshot({ path: `${OUT}/3-corkboard.png` });
await A.click('[data-mode=outline]');
await A.waitForSelector('.outline');
await A.screenshot({ path: `${OUT}/4-outline.png` });

// ---- Sync
await connect(A);
check(remoteItems().length === 10, `pushed project to vault (${remoteItems().length} items)`);
const scene = remoteItems().find(i => i.title === 'Opening Scene');
check(scene && scene.content.includes('bell buoy'), 'scene text is in the vault');

const B = await device('phone', { ...devices['iPhone 13'] });
await B.evaluate(() => localStorage.setItem('faulkner.settings', JSON.stringify({ sceneTime: 'night', weather: 'rain', sounds: false })));
await B.reload(); await B.waitForSelector('.welcome');
await connect(B);
await B.waitForSelector('.proj');
check(await B.locator('.proj').count() === 1, 'phone pulled the project');
await B.screenshot({ path: `${OUT}/5-phone-welcome.png` });
await B.evaluate(id => window.faulkner.select(id), scene.id);
await B.waitForSelector('#page');
check((await B.locator('#page').innerText()).includes('bell buoy'), 'phone sees desktop text');
await B.click('#page');
await B.keyboard.press('Control+End');
await B.keyboard.press('Enter');
await B.keyboard.type('On the phone, later: the boats came back one by one.');
await B.waitForTimeout(600);
await B.screenshot({ path: `${OUT}/6-phone-editor.png` });
await syncNow(B);
await syncNow(A);
await A.evaluate(id => window.faulkner.select(id), scene.id);
check((await A.locator('#page').innerText()).includes('one by one'), 'desktop received phone edit');

// ---- Conflict: both edit same doc offline-ish
await A.evaluate(id => window.faulkner.store.update(id, { content: '<p>Desktop version.</p>' }), scene.id);
await B.evaluate(id => window.faulkner.store.update(id, { content: '<p>Phone version.</p>' }), scene.id);
await syncNow(A);
await syncNow(B);
await syncNow(A);
const titles = remoteItems().map(i => i.title);
check(titles.some(t => t.includes('conflict copy')), 'conflict produced a kept copy');
const bodies = remoteItems().filter(i => i.title.startsWith('Opening Scene')).map(i => i.content).join('|');
check(bodies.includes('Desktop version') && bodies.includes('Phone version'), 'both versions preserved');

// ---- Delete propagates
const noteId = remoteItems().find(i => i.title === 'Premise').id;
await A.evaluate(id => { window.faulkner.store.trash(id); window.faulkner.store.purge(id); }, noteId);
await syncNow(A);
await syncNow(B);
check(!remoteItems().some(i => i.id === noteId), 'delete reached vault');
check(await B.evaluate(id => !window.faulkner.store.get(id), noteId), 'delete reached phone');

// ---- Mobile binder drawer + settings + themes
await B.click('#btn-binder');
await B.waitForTimeout(300);
await B.screenshot({ path: `${OUT}/7-phone-binder.png` });
await B.click('#scrim', { position: { x: 370, y: 400 } });
await A.click('#btn-settings');
await A.waitForTimeout(200);
await A.screenshot({ path: `${OUT}/8-settings.png` });
await A.click('dialog [value=close]');
await A.evaluate(() => { localStorage.setItem('faulkner.settings', JSON.stringify({ theme: 'tidepool', sceneTime: 'night', weather: 'clear', sounds: false })); });
await A.reload(); await A.waitForSelector('#page');
await A.screenshot({ path: `${OUT}/9-tidepool-night.png` });
await A.evaluate(() => { localStorage.setItem('faulkner.settings', JSON.stringify({ theme: 'driftwood', sceneTime: 'day', weather: 'fog', sounds: false })); });
await A.reload(); await A.waitForSelector('#page');
await A.screenshot({ path: `${OUT}/10-driftwood-day-fog.png` });

// ---- Compile
const [dl] = await Promise.all([A.waitForEvent('download'), A.evaluate(() => {
  const p = window.faulkner.store.allItems().find(i => i.type === 'project');
  window.faulkner.select(p.id);
}).then(() => A.click('[data-compile]')).then(() => A.click('.menu button:nth-child(2)'))]);
const md = fs.readFileSync(await dl.path(), 'utf8');
check(md.startsWith('# Untitled Project') && md.includes('Chapter One'), 'compile to markdown');

check(errors.length === 0, 'no page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
console.log(`GitHub API calls: ${gh.calls}`);
await browser.close();
server.close();

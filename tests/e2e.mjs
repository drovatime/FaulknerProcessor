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
const gitBlobSha = s => { const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'utf8'); return sha1(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])); };
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
    const bs = gitBlobSha(text); gh.blobs.set(bs, Buffer.from(text));
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
  if ((mm = p.match(/^\/git\/blobs\/(\w+)$/))) return json(200, { content: gh.blobs.get(mm[1]).toString('base64').replace(/(.{60})/g, '$1\n'), encoding: 'base64' });
  if (p === '/git/blobs' && method === 'POST') { const b = Buffer.from(body.content, 'base64'); const bs = gitBlobSha(b); gh.blobs.set(bs, b); return json(201, { sha: bs }); }
  if (p === '/git/trees' && method === 'POST') {
    const map = new Map(gh.trees.get(body.base_tree).map(e => [e.path, e]));
    for (const e of body.tree) {
      if (e.sha === null) map.delete(e.path);
      else if (e.content != null) { const bs = gitBlobSha(e.content); gh.blobs.set(bs, Buffer.from(e.content)); map.set(e.path, { path: e.path, sha: bs }); }
      else { if (!gh.blobs.has(e.sha)) return json(422, { message: 'missing blob' }); map.set(e.path, { path: e.path, sha: e.sha }); }
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
const remoteItems = () => { const t = gh.trees.get(gh.commits.get(gh.ref).tree); return t.filter(e => e.path.startsWith('items/')).map(e => JSON.parse(gh.blobs.get(e.sha).toString())); };

async function connect(page) {
  await page.click('#btn-settings');
  await page.fill('input[name=owner]', 'me');
  await page.fill('input[name=repo]', 'vault');
  await page.fill('input[name=token]', 'good-token');
  await page.click('[data-s=connect]');
  await page.waitForFunction(() => window.carver.sync.getState().status === 'idle' && window.carver.sync.getState().lastSync > 0);
  await page.click('dialog [value=close]');
}
const syncNow = page => page.evaluate(() => window.carver.runSync());

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
await B.evaluate(id => window.carver.select(id), scene.id);
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
await A.evaluate(id => window.carver.select(id), scene.id);
check((await A.locator('#page').innerText()).includes('one by one'), 'desktop received phone edit');

// ---- Conflict: both edit same doc offline-ish
await A.evaluate(id => window.carver.store.update(id, { content: '<p>Desktop version.</p>' }), scene.id);
await B.evaluate(id => window.carver.store.update(id, { content: '<p>Phone version.</p>' }), scene.id);
await syncNow(A);
await syncNow(B);
await syncNow(A);
const titles = remoteItems().map(i => i.title);
check(titles.some(t => t.includes('conflict copy')), 'conflict produced a kept copy');
const bodies = remoteItems().filter(i => i.title.startsWith('Opening Scene')).map(i => i.content).join('|');
check(bodies.includes('Desktop version') && bodies.includes('Phone version'), 'both versions preserved');

// ---- Delete propagates
const noteId = remoteItems().find(i => i.title === 'Premise').id;
await A.evaluate(id => { window.carver.store.trash(id); window.carver.store.purge(id); }, noteId);
await syncNow(A);
await syncNow(B);
check(!remoteItems().some(i => i.id === noteId), 'delete reached vault');
check(await B.evaluate(id => !window.carver.store.get(id), noteId), 'delete reached phone');

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

// ---- Uploads: markdown outline (split at headings), a PNG and a PDF
const FIX = path.join(OUT, 'fixtures'); fs.mkdirSync(FIX, { recursive: true });
fs.writeFileSync(path.join(FIX, 'Story Bible.md'), '# Mara Lund\n\nHarbor pilot. *Hates* fog.\n\n# Tillicum Bay\n\nA cold harbor town.\n\n- cannery\n- jetty\n');
fs.copyFileSync(path.join(ROOT, 'icons', 'icon-192.png'), path.join(FIX, 'mood board.png'));
function minimalPdf(text) {
  const objs = ['<</Type/Catalog/Pages 2 0 R>>', '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    null, '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>'];
  const stream = `BT /F1 18 Tf 30 70 Td (${text}) Tj ET`;
  objs[3] = `<</Length ${stream.length}>>stream\n${stream}\nendstream`;
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj${o}endobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
fs.writeFileSync(path.join(FIX, 'research.pdf'), minimalPdf('Bell buoy log'));
const notesId = await A.evaluate(() => window.carver.store.allItems().find(i => i.role === 'notes').id);
await A.evaluate(id => window.carver.select(id), notesId);
await A.waitForSelector('[data-upload]');
const [chooser] = await Promise.all([A.waitForEvent('filechooser'), A.click('[data-upload]')]);
await chooser.setFiles([path.join(FIX, 'Story Bible.md'), path.join(FIX, 'mood board.png'), path.join(FIX, 'research.pdf')]);
await A.waitForSelector('dialog.ask');
await A.click('dialog.ask button[value=ok]');
await A.waitForFunction(() => window.carver.store.allItems().filter(i => i.type === 'file').length === 2);
const up = await A.evaluate(() => window.carver.store.allItems().map(i => ({ t: i.title, type: i.type, c: i.content })));
check(up.some(i => i.t === 'Mara Lund' && i.c.includes('<i>Hates</i>')) && up.some(i => i.t === 'Tillicum Bay' && i.c.includes('<li>jetty</li>')), 'markdown split into notes at headings');
const pdfId = await A.evaluate(() => window.carver.store.allItems().find(i => i.title === 'research').id);
await A.evaluate(id => window.carver.select(id), pdfId);
await A.waitForSelector('.pdf-pages canvas');
await A.waitForTimeout(400);
await A.screenshot({ path: `${OUT}/11-pdf-attachment.png` });
await A.click('[data-extract]');
await A.waitForFunction(() => window.carver.store.allItems().some(i => i.title === 'research (text)' && i.content.includes('Bell buoy log')));
check(true, 'PDF viewer renders and extracts text');
await syncNow(A);
const files = gh.trees.get(gh.commits.get(gh.ref).tree).filter(e => e.path.startsWith('files/'));
check(files.length === 2, `attachments uploaded to vault (${files.length})`);
await syncNow(B);
const pngId = await B.evaluate(() => window.carver.store.allItems().find(i => i.title === 'mood board').id);
await B.evaluate(id => window.carver.select(id), pngId);
await B.waitForSelector('.file-img');
check(await B.evaluate(() => document.querySelector('.file-img').naturalWidth) === 192, 'phone downloaded the image attachment');

// ---- Compile: build a few chapters, then preview & export each format
await A.evaluate(() => {
  const s = window.carver.store;
  const ms = s.allItems().find(i => i.role === 'manuscript');
  const para = n => Array.from({ length: n }, (_, k) => `<p>${'The tide turned under the pilings and the town held its breath, the way it always did when the boats were late. '.repeat(3 + (k % 4))}<i>Not yet,</i> she thought.</p>`).join('');
  for (let c = 2; c <= 4; c++) {
    const f = s.create({ type: 'folder', parentId: ms.id, title: c === 3 ? 'The Cannery' : `Chapter ${c}` });
    s.create({ type: 'doc', parentId: f.id, title: 'Scene A', content: para(14) });
    s.create({ type: 'doc', parentId: f.id, title: 'Scene B', content: para(10) + '<hr>' + para(6) });
  }
  const p = s.allItems().find(i => i.type === 'project');
  s.update(p.id, { title: 'The Bell Buoy' });
  window.carver.select(p.id);
});
await A.waitForSelector('[data-compile]');
await A.click('[data-compile]');
await A.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.cmp-info')?.textContent || ''));
await A.fill('input[name="m.author"]', 'Harper Vale');
await A.fill('textarea[name="m.contact"]', '12 Harbor Rd\nAstoria, OR 97103\nharper@example.com');
await A.waitForTimeout(900);
await A.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.cmp-info')?.textContent || ''));
const msInfo = await A.textContent('.cmp-info');
await A.evaluate(() => document.querySelectorAll('#compile .cmp-wrap')[2].scrollIntoView());
await A.screenshot({ path: `${OUT}/12-compile-manuscript.png` });
const pageCheck = await A.evaluate(() => {
  const pages = [...document.querySelectorAll('#compile .cmp-page')];
  const over = pages.filter(p => { const b = p.querySelector('.cmp-body-box'); return b.scrollHeight > b.clientHeight + 1; }).length;
  return { n: pages.length, over, head: pages[1]?.querySelector('.cmp-rh')?.textContent };
});
check(pageCheck.n > 5 && pageCheck.over === 0, `manuscript paginates without overflow (${msInfo})`);
check(pageCheck.head === 'Vale / THE BELL BUOY / 1', `manuscript header: ${pageCheck.head}`);
async function exportBytes(kind) {
  const [d] = await Promise.all([A.waitForEvent('download'), A.click(`[data-export=${kind}]`)]);
  const f = path.join(OUT, `export-${Date.now()}.${kind}`);
  fs.copyFileSync(await d.path(), f);
  return f;
}
const docx = await exportBytes('docx');
await A.click('input[name=preset][value=kdp]');
await A.waitForFunction(() => /KDP/.test(document.querySelector('.cmp-info')?.textContent || ''));
const kdpInfo = await A.textContent('.cmp-info');
check(/inside margin/.test(kdpInfo), `KDP gutter reported (${kdpInfo})`);
await A.evaluate(() => document.querySelectorAll('#compile .cmp-spread')[3].scrollIntoView());
await A.screenshot({ path: `${OUT}/13-compile-kdp.png` });
const kdpDocx = await exportBytes('docx');
await A.click('input[name=preset][value=ebook]');
await A.waitForFunction(() => /pages?/.test(document.querySelector('.cmp-info')?.textContent || '') && document.querySelector('[data-export=epub]'));
await A.waitForTimeout(300);
const epub = await exportBytes('epub');
await A.screenshot({ path: `${OUT}/14-compile-ebook.png` });
await A.click('input[name=preset][value=reading]');
await A.waitForSelector('[data-export=md]');
const md = fs.readFileSync(await exportBytes('md'), 'utf8');
check(md.startsWith('# The Bell Buoy') && md.includes('## Chapter Three: The Cannery'), 'markdown export');
fs.writeFileSync(path.join(OUT, 'exports.json'), JSON.stringify({ docx, kdpDocx, epub }));

// Phone compile view
await syncNow(A); await syncNow(B);
await B.evaluate(() => { const p = window.carver.store.allItems().find(i => i.type === 'project'); window.carver.select(p.id); });
await B.click('[data-compile]');
await B.waitForFunction(() => /\d+ pages?/.test(document.querySelector('.cmp-info')?.textContent || ''));
await B.screenshot({ path: `${OUT}/15-phone-compile.png` });
await B.click('[data-tab=opts]');
await B.screenshot({ path: `${OUT}/16-phone-compile-options.png` });

check(errors.length === 0, 'no page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
console.log(`GitHub API calls: ${gh.calls}`);
await browser.close();
server.close();

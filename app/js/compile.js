// Compile: lay a manuscript out as real pages for different destinations
// (agent submission, KDP and other paperbacks, large print, eBook, reading copy),
// preview them, and export Word (.docx), print-ready PDF, EPUB, Markdown or text.
import * as store from './store.js';
import { sanitize } from './editor.js';
import { icon } from './icons.js';
import { jszip } from './vendor.js';
import * as files_ from './files.js';
import * as sync from './sync.js';

const IN = 96; // CSS px per inch
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => n.toLocaleString();

const FONTS = {
  times: { label: 'Times New Roman', css: "'Tinos', 'Times New Roman', Times, serif", load: 'Tinos', docx: 'Times New Roman' },
  courier: { label: 'Courier', css: "'Courier Prime', 'Courier New', monospace", load: 'Courier Prime', docx: 'Courier New' },
  garamond: { label: 'Garamond', css: "'EB Garamond', Garamond, serif", load: 'EB Garamond', docx: 'Garamond' },
  baskerville: { label: 'Baskerville', css: "'Libre Baskerville', Baskerville, serif", load: 'Libre Baskerville', docx: 'Baskerville Old Face' },
  crimson: { label: 'Crimson', css: "'Crimson Pro', Georgia, serif", load: 'Crimson Pro', docx: 'Crimson Pro' },
  literata: { label: 'Literata', css: "'Literata', Georgia, serif", load: 'Literata', docx: 'Georgia' },
};
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,600;1,400&family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=Tinos:ital,wght@0,400;0,700;1,400;1,700&display=swap';

const TRIMS = {
  '5x8': { label: '5″ × 8″', size: [5, 8] },
  '5.25x8': { label: '5.25″ × 8″', size: [5.25, 8] },
  '5.5x8.5': { label: '5.5″ × 8.5″', size: [5.5, 8.5] },
  '6x9': { label: '6″ × 9″', size: [6, 9] },
  '8.5x11': { label: '8.5″ × 11″ (US Letter)', size: [8.5, 11] },
  ebook: { label: 'Phone screen', size: [3.6, 6] },
};

export const PRESETS = {
  manuscript: {
    label: 'Manuscript submission', short: 'Manuscript',
    blurb: 'Standard manuscript format for agents, editors and magazines: 12 pt, double-spaced, 1″ margins, name/title/page header.',
    kind: 'manuscript', trim: '8.5x11', trims: ['8.5x11'], font: 'times', size: 12, leading: 2, indent: 0.5, justify: false,
    margins: { top: 1, bottom: 1, inside: 1, outside: 1 }, mirror: false, sceneBreak: '#', heading: 'title',
    exports: ['docx', 'pdf'],
  },
  kdp: {
    label: 'KDP paperback', short: 'KDP paperback',
    blurb: 'Print-ready interior for Amazon KDP. The inside (gutter) margin grows with page count to meet KDP’s minimums.',
    kind: 'book', trim: '5.5x8.5', trims: ['5x8', '5.25x8', '5.5x8.5', '6x9'], font: 'garamond', size: 11.5, leading: 1.4, indent: 0.3, justify: true,
    margins: { top: 0.75, bottom: 0.75, inside: 0.5, outside: 0.5 }, mirror: true, kdpGutter: true, sceneBreak: '⁂', heading: 'number-title',
    exports: ['pdf', 'docx'],
  },
  paperback: {
    label: 'Paperback (IngramSpark & other printers)', short: 'Paperback',
    blurb: 'Trade paperback interior with generous margins for print-on-demand printers.',
    kind: 'book', trim: '6x9', trims: ['5x8', '5.25x8', '5.5x8.5', '6x9'], font: 'baskerville', size: 10.5, leading: 1.5, indent: 0.3, justify: true,
    margins: { top: 0.8, bottom: 0.8, inside: 0.75, outside: 0.6 }, mirror: true, sceneBreak: '* * *', heading: 'number-title',
    exports: ['pdf', 'docx'],
  },
  largeprint: {
    label: 'Large print paperback', short: 'Large print',
    blurb: '16 pt type and wider leading for readers who need larger text.',
    kind: 'book', trim: '6x9', trims: ['5.5x8.5', '6x9'], font: 'literata', size: 16, leading: 1.45, indent: 0.35, justify: false,
    margins: { top: 0.8, bottom: 0.8, inside: 0.75, outside: 0.6 }, mirror: true, kdpGutter: true, sceneBreak: '* * *', heading: 'number-title',
    exports: ['pdf', 'docx'],
  },
  ebook: {
    label: 'eBook (Kindle, Apple Books, Kobo)', short: 'eBook',
    blurb: 'Reflowable EPUB, accepted by KDP, Apple Books, Kobo and Google Play. The preview approximates a phone screen; readers reflow the text.',
    kind: 'ebook', trim: 'ebook', trims: ['ebook'], font: 'literata', size: 10, leading: 1.5, indent: 0.22, justify: false,
    margins: { top: 0.3, bottom: 0.35, inside: 0.25, outside: 0.25 }, mirror: false, sceneBreak: '⁂', heading: 'number-title',
    exports: ['epub'],
  },
  reading: {
    label: 'Reading copy', short: 'Reading copy',
    blurb: 'Comfortable letter-size pages for beta readers or editing on paper. Also exports Markdown and plain text.',
    kind: 'book', trim: '8.5x11', trims: ['8.5x11', '6x9'], font: 'literata', size: 12, leading: 1.6, indent: 0.35, justify: false,
    margins: { top: 1, bottom: 1, inside: 1.1, outside: 1.1 }, mirror: false, sceneBreak: '⁂', heading: 'number-title',
    exports: ['pdf', 'docx', 'md', 'txt'],
  },
};

const HEADINGS = {
  title: 'Folder titles (as written)',
  'number-title': 'Chapter One + title',
  'chapter-words': 'Chapter One',
  'chapter-number': 'Chapter 1',
  number: '1',
  none: 'No headings',
};
const EXPORT_LABEL = { docx: 'Word (.docx)', pdf: 'PDF', epub: 'EPUB', md: 'Markdown', txt: 'Text' };

// KDP paperback minimum inside margins by page count.
function kdpGutter(pages) {
  if (pages <= 150) return 0.375;
  if (pages <= 300) return 0.5;
  if (pages <= 500) return 0.625;
  if (pages <= 700) return 0.75;
  return 0.875;
}

const ONES = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function numberWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  return String(n);
}

// ------------------------------------------------------------------ content
function manuscriptRoot(rootId) {
  const root = store.get(rootId);
  if (root.type !== 'project') return root;
  return store.children(root.id).find(c => c.role === 'manuscript') || root;
}

// → [{ id, title, scenes: [html], included }]
export function gatherChapters(rootId, { all = false } = {}) {
  const root = manuscriptRoot(rootId);
  const docsUnder = id => {
    const out = [];
    for (const c of store.children(id)) {
      if (c.exclude && !all) continue;
      if (c.type === 'doc') out.push(c);
      else if (c.type === 'folder') out.push(...docsUnder(c.id));
    }
    return out;
  };
  const kids = store.children(root.id);
  let tops = kids.filter(c => c.type === 'folder' || c.type === 'doc');
  if (root.type === 'folder' && root.role !== 'manuscript' && !tops.some(t => t.type === 'folder')) tops = [root];
  return tops
    .filter(t => all || !t.exclude)
    .map(t => ({
      id: t.id, title: t.title, included: !t.exclude,
      scenes: (t.type === 'doc' ? [t] : docsUnder(t.id)).map(d => sanitize(d.content || '')),
    }));
}

function headingParts(style, index, title) {
  const n = index + 1;
  switch (style) {
    case 'title': return { num: '', title };
    case 'number-title': return { num: `Chapter ${numberWords(n)}`, title: /^chapter\s/i.test(title) ? '' : title };
    case 'chapter-words': return { num: '', title: `Chapter ${numberWords(n)}` };
    case 'chapter-number': return { num: '', title: `Chapter ${n}` };
    case 'number': return { num: '', title: String(n) };
    default: return null;
  }
}

// Break scene HTML into flow blocks: { tag, cls, html }
function blocksOf(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const out = [];
  for (const n of div.childNodes) {
    if (n.nodeType === 3) { if (n.data.trim()) out.push({ tag: 'p', cls: '', html: esc(n.data.trim()) }); continue; }
    if (n.nodeType !== 1) continue;
    const t = n.tagName;
    const inner = n.innerHTML;
    const empty = !n.textContent.trim();
    if (t === 'HR') { out.push({ tag: 'scene' }); continue; }
    if (empty) continue;
    if (/^H[1-3]$/.test(t)) out.push({ tag: 'p', cls: 'sub-head', html: inner });
    else if (t === 'BLOCKQUOTE') out.push({ tag: 'p', cls: 'bq', html: inner });
    else if (t === 'UL' || t === 'OL') [...n.children].forEach((li, i) => out.push({ tag: 'p', cls: 'li', html: `${t === 'UL' ? '•' : `${i + 1}.`} ${li.innerHTML}` }));
    else out.push({ tag: 'p', cls: '', html: inner });
  }
  return out;
}

const roundWords = n => (n < 17500 ? Math.max(100, Math.round(n / 100) * 100) : Math.round(n / 1000) * 1000);

// ------------------------------------------------------------------ layout model
function layoutFor(cfg) {
  const P = PRESETS[cfg.preset];
  const o = cfg.opts;
  const [w, h] = TRIMS[o.trim]?.size || TRIMS[P.trim].size;
  return {
    P, o, w, h,
    m: { ...P.margins, inside: Math.max(P.margins.inside, o.inside || 0) },
    font: FONTS[o.font] || FONTS[P.font],
  };
}

function bodyBox(L) {
  return { w: (L.w - L.m.inside - L.m.outside) * IN, h: (L.h - L.m.top - L.m.bottom) * IN };
}

// Build the flow: a list of { el: HTMLElement } and { brk: true, recto } items.
function buildFlow(cfg, L, chapters) {
  const { P, o } = L;
  const meta = cfg.meta;
  const box = bodyBox(L);
  const flow = [];
  const el = (html, cls, kind) => {
    const d = document.createElement(cls && cls.startsWith('p') ? 'p' : 'div');
    d.className = cls;
    if (kind) d.dataset.kind = kind;
    d.innerHTML = html;
    return d;
  };
  const para = (b, first) => {
    const p = document.createElement('p');
    p.className = [b.cls, first && P.kind !== 'manuscript' ? 'first' : ''].filter(Boolean).join(' ');
    p.innerHTML = b.html;
    return p;
  };
  const brk = recto => flow.push({ brk: true, recto: !!recto });
  const title = meta.title || 'Untitled';
  const author = meta.author || '';
  const words = chapters.reduce((n, c) => n + c.scenes.reduce((m, s) => m + store.countWords(s), 0), 0);

  if (P.kind === 'manuscript') {
    const contact = [meta.legalName || author, ...(meta.contact || '').split('\n')].filter(s => s.trim()).map(esc).join('<br>');
    const tp = `<div class="ms-contact">${contact}</div><div class="ms-wc">About ${fmt(roundWords(words))} words</div>
      <div class="ms-title-block"><div class="ms-title">${esc(title)}</div>${author ? `<div class="ms-by">by ${esc(author)}</div>` : ''}</div>`;
    if (o.shortStory) {
      const d = el(tp, 'ms-tp short', 'front');
      d.style.setProperty('--tp-drop', `${box.h * 0.3}px`);
      flow.push({ el: d });
    } else {
      const d = el(tp, 'ms-tp', 'front');
      d.style.height = `${box.h - 2}px`;
      flow.push({ el: d });
    }
  } else if (P.kind === 'book' || P.kind === 'ebook') {
    if (P.kind === 'ebook' && meta.coverSha && L.coverUrl) flow.push({ cover: true });
    if (o.titlePage) {
      const d = el(`<div class="tp-title">${esc(title)}</div>${meta.subtitle ? `<div class="tp-sub">${esc(meta.subtitle)}</div>` : ''}<div class="tp-author">${esc(author)}</div>`, 'title-page', 'front');
      d.style.height = `${box.h - 2}px`;
      flow.push({ el: d });
      brk();
    }
    if (o.copyrightPage) {
      const lines = (meta.copyright || defaultCopyright(meta)).split('\n').map(l => (l.trim() ? `<p>${esc(l)}</p>` : '<p class="gap">&nbsp;</p>')).join('');
      const d = el(lines, 'copyright-page', 'front');
      d.style.height = `${box.h - 2}px`;
      flow.push({ el: d });
      brk();
    }
    if (meta.dedication && meta.dedication.trim()) {
      if (P.mirror) brk(true);
      const d = el(meta.dedication.split('\n').map(esc).join('<br>'), 'dedication', 'front');
      d.style.setProperty('--drop', `${box.h * 0.28}px`);
      flow.push({ el: d });
      brk();
    }
  }

  const drop = P.kind === 'manuscript' ? box.h / 3 - 24 : P.kind === 'ebook' ? box.h * 0.08 : box.h * 0.2;
  const singleShort = P.kind === 'manuscript' && o.shortStory && chapters.length <= 1;
  chapters.forEach((ch, ci) => {
    if (!singleShort) {
      if (!(P.kind === 'manuscript' && o.shortStory && ci === 0)) brk(P.mirror && o.recto);
      else if (P.kind === 'manuscript' && !o.shortStory) brk();
      const hp = headingParts(o.heading, ci, ch.title);
      if (hp) {
        const d = el(`${hp.num ? `<div class="ch-num">${esc(hp.num)}</div>` : ''}${hp.title ? `<div class="ch-title">${esc(hp.title)}</div>` : ''}`, 'chapter-head', 'chapter');
        d.style.setProperty('--drop', `${o.shortStory && ci === 0 ? 0 : drop}px`);
        flow.push({ el: d });
      } else {
        const d = el('', 'chapter-head empty', 'chapter');
        d.style.setProperty('--drop', `${drop}px`);
        flow.push({ el: d });
      }
    }
    let first = true;
    ch.scenes.forEach((html, si) => {
      const blocks = blocksOf(html);
      if (!blocks.length) return;
      if (si > 0 && !first) { flow.push({ el: el(esc(o.sceneBreak || '#'), 'scene-break') }); first = true; }
      for (const b of blocks) {
        if (b.tag === 'scene') { flow.push({ el: el(esc(o.sceneBreak || '#'), 'scene-break') }); first = true; continue; }
        flow.push({ el: para(b, first) });
        first = false;
      }
    });
  });
  if (P.kind === 'manuscript' && o.end) flow.push({ el: el('END', 'scene-break end') });
  return { flow, words };
}

export function defaultCopyright(meta) {
  const year = new Date().getFullYear();
  return `Copyright © ${year} ${meta.author || 'Author Name'}\nAll rights reserved.\n\nThis is a work of fiction. Names, characters, places and incidents are products of the author’s imagination or are used fictitiously.\n\nNo part of this book may be reproduced in any form without written permission from the author, except for brief quotations in reviews.`;
}

// ------------------------------------------------------------------ pagination
const tick = () => new Promise(r => setTimeout(r, 0));

function wordStops(el) {
  const stops = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walker.nextNode())) {
    const re = /\S+/g;
    let m;
    while ((m = re.exec(n.data))) stops.push({ node: n, offset: m.index + m[0].length });
  }
  return stops;
}

function part(el, from, to) {
  const r = document.createRange();
  if (from) r.setStart(from.node, from.offset); else r.setStart(el, 0);
  if (to) r.setEnd(to.node, to.offset); else r.setEnd(el, el.childNodes.length);
  const p = el.cloneNode(false);
  p.appendChild(r.cloneContents());
  if (from) {
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    const t = w.nextNode();
    if (t) t.data = t.data.replace(/^\s+/, '');
  }
  return p;
}

async function paginate(cfg, L, flow, isStale) {
  const box = bodyBox(L);
  const host = document.createElement('div');
  host.className = `cmp-measure cmp-typeset ${typesetClass(L)}`;
  applyTypeVars(host, L);
  host.style.width = `${box.w}px`;
  document.body.appendChild(host);
  const fits = () => host.getBoundingClientRect().height <= box.h + 0.5;
  const linePx = (L.o.size * 96 / 72) * L.o.leading;
  const pages = [];
  const finish = (force = false) => {
    if (!host.childNodes.length && !force) return;
    // Don't end a page on a scene break or a chapter heading.
    const carry = [];
    while (host.lastElementChild && host.childNodes.length > 1 && (host.lastElementChild.classList.contains('scene-break') && !host.lastElementChild.classList.contains('end') || host.lastElementChild.classList.contains('chapter-head'))) {
      carry.unshift(host.removeChild(host.lastElementChild));
    }
    const firstKind = host.firstElementChild?.dataset.kind || 'body';
    pages.push({ html: host.innerHTML, kind: host.childNodes.length ? firstKind : 'blank' });
    host.innerHTML = '';
    for (const c of carry) host.appendChild(c);
  };

  let count = 0;
  for (const item of flow) {
    if (++count % 150 === 0) { await tick(); if (isStale()) { host.remove(); return null; } }
    if (item.cover) { finish(); pages.push({ html: '', kind: 'cover' }); continue; }
    if (item.brk) {
      finish();
      if (item.recto && pages.length % 2 === 1) pages.push({ html: '', kind: 'blank' });
      continue;
    }
    let node = item.el.cloneNode(true);
    let guard = 0;
    while (node && guard++ < 500) {
      host.appendChild(node);
      if (fits()) { node = null; break; }
      host.removeChild(node);
      if (node.tagName === 'P' && !node.classList.contains('scene-break')) {
        const stops = wordStops(node);
        let lo = 1, hi = stops.length - 2, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const head = part(node, null, stops[mid]);
          host.appendChild(head);
          const ok = fits();
          host.removeChild(head);
          if (ok) { best = mid; lo = mid + 1; } else hi = mid - 1;
        }
        if (best > 0) {
          const head = part(node, null, stops[best]);
          head.classList.add('split-head');
          host.appendChild(head);
          const lines = Math.round(head.getBoundingClientRect().height / linePx);
          if (lines >= 2 || !host.childNodes.length) {
            const tail = part(node, stops[best], null);
            tail.classList.remove('first');
            tail.classList.add('cont');
            finish();
            node = tail;
            continue;
          }
          host.removeChild(head);
        }
      }
      if (!host.childNodes.length) { host.appendChild(node); finish(); node = null; break; }
      finish();
    }
  }
  finish();
  host.remove();
  return pages;
}

function typesetClass(L) {
  return `k-${L.P.kind} ${L.P.justify ? 'justify' : ''}`;
}
function applyTypeVars(el, L) {
  el.style.setProperty('--cf', L.font.css);
  el.style.setProperty('--cs', `${L.o.size}pt`);
  el.style.setProperty('--cl', String(L.o.leading));
  el.style.setProperty('--ci', `${L.P.indent}in`);
  el.lang = 'en';
}

// Decorate pages with running heads and folios.
function decorate(pages, cfg, L) {
  const { P, o } = L;
  const meta = cfg.meta;
  const surname = (meta.legalName || meta.author || 'Author').trim().split(/\s+/).pop();
  const shortTitle = (meta.shortTitle || meta.title || 'Untitled').toUpperCase();
  const msOffset = P.kind === 'manuscript' && !o.shortStory ? 1 : 0;
  return pages.map((pg, i) => {
    const n = i + 1;
    let head = '', folio = '';
    if (P.kind === 'manuscript') {
      if (n > 1) head = `${esc(surname)} / ${esc(shortTitle)} / ${n - msOffset}`;
    } else if (P.kind === 'book') {
      if (pg.kind === 'body') head = n % 2 === 0 ? esc(meta.author || '') : esc(meta.title || '');
      if (pg.kind === 'body' || pg.kind === 'chapter') folio = String(n);
    }
    return { ...pg, n, head, folio, recto: n % 2 === 1 };
  });
}

function pageHtml(pg, L) {
  if (pg.kind === 'cover') return `<div class="cmp-page cover" style="width:${L.w * IN}px;height:${L.h * IN}px"><img src="${L.coverUrl}" alt="Cover"></div>`;
  const box = bodyBox(L);
  const left = (L.P.mirror ? (pg.recto ? L.m.inside : L.m.outside) : L.m.inside) * IN;
  const cls = `cmp-page ${pg.kind} ${pg.recto ? 'recto' : 'verso'}`;
  return `<div class="${cls}" style="width:${L.w * IN}px;height:${L.h * IN}px">
    ${pg.head ? `<div class="cmp-rh" style="left:${left}px;width:${box.w}px;top:${L.m.top * IN * 0.45}px">${pg.head}</div>` : ''}
    <div class="cmp-body-box" style="left:${left}px;top:${L.m.top * IN}px;width:${box.w}px;height:${box.h}px">${pg.html}</div>
    ${pg.folio ? `<div class="cmp-folio" style="left:${left}px;width:${box.w}px;bottom:${L.m.bottom * IN * 0.42}px">${pg.folio}</div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ eBook cover
const coverUrls = new Map();
async function coverUrl(meta) {
  if (!meta.coverSha) return null;
  if (coverUrls.has(meta.coverSha)) return coverUrls.get(meta.coverSha);
  let rec = await files_.getFile(meta.coverSha);
  if (!rec && sync.isConfigured()) { try { rec = await sync.fetchFile(meta.coverSha, meta.coverMime); } catch { /* offline */ } }
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  coverUrls.set(meta.coverSha, url);
  return url;
}
async function imageSize(file) {
  try { const b = await createImageBitmap(file); const r = [b.width, b.height]; b.close?.(); return r; }
  catch {
    return new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res([0, 0]); i.src = URL.createObjectURL(file); });
  }
}
function coverAdvice(meta) {
  if (!meta.coverSha) return 'KDP recommends 1600 × 2560 pixels (a 1 : 1.6 shape), as a JPG. The same image works for Apple Books, Kobo and Google Play.';
  const [w, h] = [meta.coverW || 0, meta.coverH || 0];
  const notes = [`${w} × ${h} px.`];
  const ratio = w ? h / w : 0;
  if (ratio && (ratio < 1.4 || ratio > 1.8)) notes.push('Stores expect a tall cover about 1.6 times as high as it is wide.');
  if (h && h < 1600) notes.push('Under 1600 px tall can look soft on modern screens.');
  if (notes.length === 1) notes.push('Looks good for KDP and the other stores.');
  return notes.join(' ');
}
async function setCover(file) {
  if (!/^image\/(jpeg|png)$/.test(file.type)) { state.deps.toast('Please choose a JPG or PNG image.'); return; }
  const rec = await files_.saveFile(file);
  const [w, h] = await imageSize(file);
  Object.assign(state.cfg.meta, { coverSha: rec.sha, coverMime: rec.mime, coverW: w, coverH: h });
  persist();
  renderShell(document.getElementById('compile'));
  relayout();
}

// ------------------------------------------------------------------ UI
let state = null;

export function openCompile(rootId, deps) {
  const root = store.get(rootId);
  const project = store.projectOf(rootId) || root;
  const saved = project.compile || {};
  const meta = {
    title: project.title, subtitle: '', author: '', legalName: '', contact: '', shortTitle: '', copyright: '', dedication: '',
    ...(saved.meta || {}),
  };
  if (!saved.meta) meta.title = project.title;
  const preset = saved.preset && PRESETS[saved.preset] ? saved.preset : 'manuscript';
  state = { rootId, projectId: project.id, deps, cfg: { preset, meta, optsBy: saved.optsBy || {} }, gen: 0, pages: null, L: null, words: 0, zoom: +(localStorage.getItem('carver.cmpzoom') || 0) };
  ensureFonts();

  let el = document.getElementById('compile');
  if (!el) {
    el = document.createElement('div');
    el.id = 'compile';
    document.getElementById('app').appendChild(el);
  }
  el.hidden = false;
  document.getElementById('app').classList.add('compiling');
  renderShell(el);
  relayout();
}

function opts() {
  const { cfg } = state;
  const P = PRESETS[cfg.preset];
  const base = {
    trim: P.trim, font: P.font, size: P.size, leading: P.leading, sceneBreak: P.sceneBreak, heading: P.heading,
    recto: true, titlePage: true, copyrightPage: P.kind !== 'ebook' || true, end: true, shortStory: false, inside: 0,
  };
  return { ...base, ...(cfg.optsBy[cfg.preset] || {}) };
}

function persist() {
  const { cfg } = state;
  store.update(state.projectId, { compile: { preset: cfg.preset, meta: cfg.meta, optsBy: cfg.optsBy } }, { quiet: true });
}

function ensureFonts() {
  if (!document.querySelector('link[data-cmp-fonts]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = FONT_CSS;
    l.dataset.cmpFonts = '1';
    document.head.appendChild(l);
  }
}

function close() {
  const el = document.getElementById('compile');
  if (el) { el.hidden = true; el.innerHTML = ''; }
  document.getElementById('app').classList.remove('compiling');
  state = null;
}

function renderShell(el) {
  const { cfg } = state;
  const P = PRESETS[cfg.preset];
  const o = opts();
  const meta = cfg.meta;
  const proj = store.get(state.projectId);
  const chapters = gatherChapters(state.rootId, { all: true });
  const sel = (name, entries, cur) => `<select name="${name}">${entries.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const isMs = P.kind === 'manuscript';
  const isBook = P.kind === 'book';
  el.innerHTML = `
  <div class="cmp-top">
    <button class="icon-btn" data-c="close" aria-label="Close compile">${icon('close')}</button>
    <span class="pixel cmp-heading">Compile</span>
    <span class="cmp-proj">${esc(proj.title)}</span>
    <span class="spacer"></span>
    <div class="seg cmp-tabs"><button data-tab="opts">Options</button><button data-tab="preview" class="on">Preview</button></div>
    <div class="cmp-exports">${P.exports.map((x, i) => `<button class="btn ${i ? 'ghost' : ''}" data-export="${x}">${icon('down')} ${EXPORT_LABEL[x]}</button>`).join('')}</div>
  </div>
  <div class="cmp-main show-preview">
    <form class="cmp-side" autocomplete="off" onsubmit="return false">
      <h3>Format</h3>
      <div class="cmp-presets">${Object.entries(PRESETS).map(([k, p]) => `
        <label class="cmp-preset ${k === cfg.preset ? 'on' : ''}"><input type="radio" name="preset" value="${k}" ${k === cfg.preset ? 'checked' : ''}>
          <b>${esc(p.label)}</b><small>${esc(p.blurb)}</small></label>`).join('')}</div>

      ${P.kind === 'ebook' ? `
      <h3>Cover</h3>
      <div class="cover-pick">
        <div class="cover-thumb">${meta.coverSha ? '<img data-cover-img alt="Cover">' : '<span>No cover yet</span>'}</div>
        <div class="cover-actions">
          <label class="btn ghost small file-btn">${meta.coverSha ? 'Replace image…' : 'Upload cover…'}<input type="file" accept="image/jpeg,image/png" data-cover hidden></label>
          ${meta.coverSha ? '<button type="button" class="btn ghost small danger" data-cover-remove>Remove</button>' : ''}
          <small class="muted">${esc(coverAdvice(meta))}</small>
        </div>
      </div>` : ''}

      <h3>Book details</h3>
      <label class="field"><span>Title</span><input name="m.title" value="${esc(meta.title)}"></label>
      ${!isMs ? `<label class="field"><span>Subtitle</span><input name="m.subtitle" value="${esc(meta.subtitle)}" placeholder="Optional"></label>` : ''}
      <label class="field"><span>${isMs ? 'Byline (pen name)' : 'Author'}</span><input name="m.author" value="${esc(meta.author)}" placeholder="Your name as it appears on the cover"></label>
      ${isMs ? `
        <label class="field"><span>Legal name</span><input name="m.legalName" value="${esc(meta.legalName)}" placeholder="If different from your byline"></label>
        <label class="field"><span>Contact details</span><textarea name="m.contact" rows="4" placeholder="Street address&#10;City, State ZIP&#10;Phone&#10;Email">${esc(meta.contact)}</textarea></label>
        <label class="field"><span>Short title for page headers</span><input name="m.shortTitle" value="${esc(meta.shortTitle)}" placeholder="${esc(meta.title)}"></label>` : ''}
      ${isBook || P.kind === 'ebook' ? `
        <label class="field"><span>Copyright page</span><textarea name="m.copyright" rows="6" placeholder="${esc(defaultCopyright(meta))}">${esc(meta.copyright)}</textarea></label>
        <label class="field"><span>Dedication</span><textarea name="m.dedication" rows="2" placeholder="Optional. For…">${esc(meta.dedication)}</textarea></label>` : ''}

      <h3>Layout</h3>
      <div class="field-row">
        ${P.trims.length > 1 ? `<label class="field"><span>Trim size</span>${sel('o.trim', P.trims.map(t => [t, TRIMS[t].label]), o.trim)}</label>` : ''}
        <label class="field"><span>Typeface</span>${sel('o.font', Object.entries(FONTS).filter(([k]) => isMs ? ['times', 'courier'].includes(k) : k !== 'courier').map(([k, f]) => [k, f.label]), o.font)}</label>
      </div>
      ${!isMs ? `<div class="field-row">
        <label class="field"><span>Size (pt)</span><input type="number" name="o.size" min="8" max="20" step="0.5" value="${o.size}"></label>
        <label class="field"><span>Line spacing</span><input type="number" name="o.leading" min="1" max="2.4" step="0.05" value="${o.leading}"></label>
      </div>` : ''}
      <div class="field-row">
        <label class="field"><span>Chapter headings</span>${sel('o.heading', Object.entries(HEADINGS), o.heading)}</label>
        <label class="field"><span>Scene break</span>${sel('o.sceneBreak', [['#', '#'], ['* * *', '* * *'], ['⁂', '⁂'], ['~', '~'], ['◆', '◆']], o.sceneBreak)}</label>
      </div>
      ${isMs ? `
        <label class="check"><input type="checkbox" name="o.shortStory" ${o.shortStory ? 'checked' : ''}> Short story: start the text on the title page</label>
        <label class="check"><input type="checkbox" name="o.end" ${o.end ? 'checked' : ''}> Add “END” after the last line</label>` : ''}
      ${isBook || P.kind === 'ebook' ? `
        <label class="check"><input type="checkbox" name="o.titlePage" ${o.titlePage ? 'checked' : ''}> Title page</label>
        <label class="check"><input type="checkbox" name="o.copyrightPage" ${o.copyrightPage ? 'checked' : ''}> Copyright page</label>` : ''}
      ${isBook && P.mirror ? `<label class="check"><input type="checkbox" name="o.recto" ${o.recto ? 'checked' : ''}> Start chapters on a right-hand page</label>` : ''}

      <h3>Contents</h3>
      <p class="muted tiny">Untick anything to leave it out. This is the same as “Include in compile” in the inspector.</p>
      <div class="cmp-contents">${chapters.map(c => `<label class="check"><input type="checkbox" data-include="${c.id}" ${c.included ? 'checked' : ''}> ${esc(c.title)} <em class="muted">${fmt(c.scenes.reduce((n, s) => n + store.countWords(s), 0))} w</em></label>`).join('') || '<p class="muted">Nothing in the Manuscript folder yet.</p>'}</div>
    </form>
    <section class="cmp-preview">
      <div class="cmp-status"><span class="cmp-info">Laying out pages…</span><span class="spacer"></span>
        <label class="cmp-zoom">${icon('eye')}<input type="range" min="-3" max="3" step="1" value="${state.zoom}" aria-label="Zoom"></label></div>
      <div class="cmp-pages" lang="en"></div>
    </section>
  </div>`;

  const form = el.querySelector('.cmp-side');
  form.addEventListener('input', onForm);
  form.addEventListener('change', onForm);
  el.querySelector('[data-c=close]').onclick = close;
  el.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    el.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === b));
    el.querySelector('.cmp-main').classList.toggle('show-preview', b.dataset.tab === 'preview');
  });
  el.querySelectorAll('[data-export]').forEach(b => b.onclick = () => doExport(b.dataset.export));
  el.querySelector('[data-cover]')?.addEventListener('change', e => { const f = e.target.files[0]; if (f) setCover(f); });
  el.querySelector('[data-cover-remove]')?.addEventListener('click', () => {
    for (const k of ['coverSha', 'coverMime', 'coverW', 'coverH']) delete state.cfg.meta[k];
    persist();
    renderShell(document.getElementById('compile'));
    relayout();
  });
  const thumb = el.querySelector('[data-cover-img]');
  if (thumb) coverUrl(meta).then(u => { if (u) thumb.src = u; });
  el.querySelector('.cmp-zoom input').oninput = e => { state.zoom = +e.target.value; localStorage.setItem('carver.cmpzoom', state.zoom); renderPages(); };
}

let relayoutT;
function onForm(e) {
  const t = e.target;
  const { cfg } = state;
  if (t.name === 'preset') {
    if (e.type !== 'change') return;
    cfg.preset = t.value;
    persist();
    renderShell(document.getElementById('compile'));
    relayout();
    return;
  }
  if (t.dataset.include) {
    if (e.type !== 'change') return;
    store.update(t.dataset.include, { exclude: !t.checked });
  } else if (t.name?.startsWith('m.')) {
    cfg.meta[t.name.slice(2)] = t.value;
  } else if (t.name?.startsWith('o.')) {
    const k = t.name.slice(2);
    const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? +t.value : t.value;
    cfg.optsBy[cfg.preset] = { ...(cfg.optsBy[cfg.preset] || {}), [k]: v };
  } else return;
  persist();
  clearTimeout(relayoutT);
  relayoutT = setTimeout(relayout, t.tagName === 'TEXTAREA' || t.type === 'text' ? 600 : 150);
}

async function relayout() {
  if (!state) return;
  const gen = ++state.gen;
  const isStale = () => !state || state.gen !== gen;
  const info = document.querySelector('#compile .cmp-info');
  if (info) info.textContent = 'Laying out pages…';
  const cfg = { preset: state.cfg.preset, meta: state.cfg.meta, opts: opts() };
  const chapters = gatherChapters(state.rootId);
  let L = layoutFor(cfg);
  L.coverUrl = cfg.preset === 'ebook' ? await coverUrl(cfg.meta) : null;
  if (isStale()) return;
  try { await document.fonts.load(`${cfg.opts.size}pt "${L.font.load}"`); await document.fonts.load(`italic ${cfg.opts.size}pt "${L.font.load}"`); } catch { /* fallback font */ }
  if (isStale()) return;
  let pages, words, note = '';
  for (let pass = 0; pass < 3; pass++) {
    const built = buildFlow(cfg, L, chapters);
    words = built.words;
    pages = await paginate(cfg, L, built.flow, isStale);
    if (!pages) return;
    if (!L.P.kdpGutter) break;
    const need = kdpGutter(pages.length);
    if (L.m.inside + 1e-6 >= need) { note = ` · inside margin ${L.m.inside}″ (KDP minimum for ${pages.length} pages is ${need}″)`; break; }
    L = { ...L, m: { ...L.m, inside: need } };
    note = ` · inside margin raised to ${need}″ for KDP`;
  }
  if (isStale()) return;
  state.pages = decorate(pages, cfg, L);
  state.L = L;
  state.cfgNow = cfg;
  state.chapters = chapters;
  state.words = words;
  const n = state.pages.length;
  let warn = '';
  if (L.P.kdpGutter && n < 24) warn = ' · KDP paperbacks need at least 24 pages';
  if (info) info.textContent = `${fmt(n)} page${n === 1 ? '' : 's'} · ${fmt(words)} words · ${TRIMS[cfg.opts.trim]?.label || ''}${note}${warn}`;
  renderPages();
}

function renderPages() {
  const wrap = document.querySelector('#compile .cmp-pages');
  if (!wrap || !state.pages) return;
  const L = state.L;
  const avail = wrap.clientWidth - 32;
  const spreads = L.P.mirror && avail > L.w * IN * 0.9;
  const fitW = spreads ? avail / 2 - 8 : Math.min(avail, 900);
  const fitH = Math.max(200, wrap.clientHeight - 70) / (L.h * IN);
  const base = Math.min(1, fitW / (L.w * IN), fitH);
  const scale = Math.max(0.15, base * Math.pow(1.25, state.zoom));
  const ph = L.h * IN * scale, pw = L.w * IN * scale;
  const cls = `cmp-typeset ${typesetClass(L)}`;
  const pages = state.pages.map(pg => `<div class="cmp-wrap" style="width:${pw}px;height:${ph}px"><div class="cmp-scale" style="transform:scale(${scale})">${pageHtml(pg, L)}</div><span class="cmp-num">${pg.n}</span></div>`);
  let html;
  if (spreads) {
    const rows = [`<div class="cmp-spread"><div class="cmp-wrap ghost" style="width:${pw}px;height:${ph}px"></div>${pages[0] || ''}</div>`];
    for (let i = 1; i < pages.length; i += 2) rows.push(`<div class="cmp-spread">${pages[i]}${pages[i + 1] || `<div class="cmp-wrap ghost" style="width:${pw}px;height:${ph}px"></div>`}</div>`);
    html = rows.join('');
  } else html = `<div class="cmp-single">${pages.join('')}</div>`;
  wrap.className = `cmp-pages ${cls}`;
  applyTypeVars(wrap, L);
  wrap.innerHTML = html;
}

// ------------------------------------------------------------------ export
const slug = s => (s || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';

async function doExport(kind) {
  if (!state?.pages) { state?.deps.toast('Still laying out pages. Try again in a moment.'); return; }
  const { cfgNow: cfg, L, chapters } = state;
  const name = `${slug(cfg.meta.title)}-${slug(PRESETS[cfg.preset].short)}`;
  const preview = window.CARVER_PREVIEW;
  try {
    if (kind === 'pdf') {
      if (preview) { state.deps.toast('PDF export opens your browser’s print dialog, which this preview can’t do. It works in the installed app.', 6000); return; }
      printPdf();
      return;
    }
    let blob;
    if (kind === 'docx') blob = await buildDocx(cfg, L, chapters, state.words);
    else if (kind === 'epub') blob = await buildEpub(cfg, chapters);
    else if (kind === 'md') blob = new Blob([toMarkdown(cfg, chapters)], { type: 'text/markdown' });
    else blob = new Blob([toText(cfg, chapters)], { type: 'text/plain' });
    state.deps.download(`${name}.${kind}`, blob);
    state.deps.toast(preview ? 'Downloads are blocked in this preview, but the file was built successfully. It will download in the installed app.' : `Exported ${EXPORT_LABEL[kind]}.`, preview ? 6000 : 3000);
  } catch (e) {
    console.error(e);
    state.deps.toast(`Export failed: ${e.message}`);
  }
}

function printPdf() {
  const L = state.L;
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.className = `cmp-typeset ${typesetClass(L)}`;
  applyTypeVars(root, L);
  root.innerHTML = `<style>@page { size: ${L.w}in ${L.h}in; margin: 0; }</style>` + state.pages.map(pg => pageHtml(pg, L)).join('');
  document.body.appendChild(root);
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); root.remove(); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  document.fonts.ready.then(() => {
    window.print();
    setTimeout(() => { if (!matchMedia('print').matches) done(); }, 1500);
  });
  state.deps.toast('Choose “Save as PDF” as the printer. Set margins to None and turn off headers and footers.', 7000);
}

// ---- shared text helpers
function htmlToMarkdown(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const inline = n => [...n.childNodes].map(c => {
    if (c.nodeType === 3) return c.data.replace(/([*_\\])/g, '\\$1');
    if (c.nodeType !== 1) return '';
    const t = c.tagName, inner = inline(c);
    if ((t === 'B' || t === 'STRONG') && inner.trim()) return `**${inner}**`;
    if ((t === 'I' || t === 'EM') && inner.trim()) return `*${inner}*`;
    if (t === 'BR') return '  \n';
    return inner;
  }).join('');
  const out = [];
  for (const n of div.childNodes) {
    if (n.nodeType === 3) { if (n.data.trim()) out.push(n.data.trim()); continue; }
    if (n.nodeType !== 1) continue;
    const t = n.tagName;
    if (/^H\d$/.test(t)) out.push('### ' + inline(n));
    else if (t === 'BLOCKQUOTE') out.push('> ' + inline(n));
    else if (t === 'HR') out.push('* * *');
    else if (t === 'UL' || t === 'OL') out.push([...n.children].map((li, i) => (t === 'UL' ? '- ' : `${i + 1}. `) + inline(li)).join('\n'));
    else { const s = inline(n).trim(); if (s) out.push(s); }
  }
  return out.join('\n\n');
}
function chapterLabel(cfg, i, ch) {
  const hp = headingParts(cfg.opts.heading, i, ch.title);
  return hp ? [hp.num, hp.title].filter(Boolean).join(': ') : '';
}
function toMarkdown(cfg, chapters) {
  const m = cfg.meta;
  return `# ${m.title || 'Untitled'}\n\n${m.author ? `*by ${m.author}*\n\n` : ''}` + chapters.map((ch, i) => {
    const h = chapterLabel(cfg, i, ch);
    return (h ? `## ${h}\n\n` : '') + ch.scenes.map(htmlToMarkdown).filter(Boolean).join(`\n\n${cfg.opts.sceneBreak}\n\n`);
  }).join('\n\n') + '\n';
}
function toText(cfg, chapters) {
  const m = cfg.meta;
  return `${(m.title || 'Untitled').toUpperCase()}\n${m.author ? `by ${m.author}\n` : ''}\n` + chapters.map((ch, i) => {
    const h = chapterLabel(cfg, i, ch);
    return (h ? `\n${h.toUpperCase()}\n\n` : '') + ch.scenes.map(s => store.plainText(s).replace(/\n{2,}/g, '\n').trim()).filter(Boolean).join(`\n\n${cfg.opts.sceneBreak}\n\n`);
  }).join('\n\n') + '\n';
}

// ---- DOCX
const xml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TW = 1440;

function runsOf(node, fmt0 = {}) {
  let out = '';
  for (const c of node.childNodes) {
    if (c.nodeType === 3) {
      if (!c.data) continue;
      const rpr = `${fmt0.b ? '<w:b/>' : ''}${fmt0.i ? '<w:i/>' : ''}${fmt0.u ? '<w:u w:val="single"/>' : ''}`;
      out += `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(c.data.replace(/\s+/g, ' '))}</w:t></w:r>`;
    } else if (c.nodeType === 1) {
      const t = c.tagName;
      if (t === 'BR') { out += '<w:r><w:br/></w:r>'; continue; }
      const f = { ...fmt0 };
      if (t === 'B' || t === 'STRONG') f.b = true;
      if (t === 'I' || t === 'EM') f.i = true;
      if (t === 'U') f.u = true;
      out += runsOf(c, f);
    }
  }
  return out;
}
const P_ = (style, runs, extra = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${runs}</w:p>`;
const T_ = (text, rpr = '') => `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;

async function buildDocx(cfg, L, chapters, words) {
  const JSZip = await jszip();
  const { P, o } = L;
  const m = cfg.meta;
  const ms = P.kind === 'manuscript';
  const font = L.font.docx;
  const sz = Math.round(o.size * 2);
  const line = Math.round(240 * o.leading);
  const indent = Math.round(P.indent * TW);
  const pageW = Math.round(L.w * TW), pageH = Math.round(L.h * TW);
  const bodyW = Math.round((L.w - L.m.inside - L.m.outside) * TW);
  const body = [];
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const FRONT_END = '<!--front-end-->';

  if (ms) {
    const contact = [m.legalName || m.author, ...(m.contact || '').split('\n')].filter(s => s && s.trim());
    contact.forEach((c, i) => body.push(P_('Contact', T_(c) + (i === 0 ? `<w:r><w:tab/></w:r>${T_(`About ${fmt(roundWords(words))} words`)}` : ''), `<w:tabs><w:tab w:val="right" w:pos="${bodyW}"/></w:tabs>`)));
    body.push(P_('TitleLine', T_(m.title || 'Untitled'), `<w:spacing w:before="${o.shortStory ? 2880 : 4320}"/>`));
    if (m.author) body.push(P_('TitleLine', T_(`by ${m.author}`)));
    if (!o.shortStory) body.push(pageBreak);
  } else {
    if (o.titlePage) {
      body.push(P_('BookTitle', T_(m.title || 'Untitled'), '<w:spacing w:before="2880"/>'));
      if (m.subtitle) body.push(P_('TitleLine', T_(m.subtitle, '<w:i/>')));
      body.push(P_('TitleLine', T_(m.author || ''), '<w:spacing w:before="720"/>'));
      body.push(pageBreak);
    }
    if (o.copyrightPage) {
      (m.copyright || defaultCopyright(m)).split('\n').forEach(l => body.push(P_('Small', l.trim() ? T_(l) : '')));
      body.push(pageBreak);
    }
    if (m.dedication && m.dedication.trim()) {
      body.push(P_('TitleLine', T_(m.dedication.replace(/\n/g, ' '), '<w:i/>'), '<w:spacing w:before="2880"/>'));
      body.push(pageBreak);
    }
  }

  // Book front matter gets its own section so it has no running heads or page numbers.
  if (!ms && body.length && body[body.length - 1] === pageBreak) body[body.length - 1] = FRONT_END;
  const single = ms && o.shortStory && chapters.length <= 1;
  chapters.forEach((ch, ci) => {
    if (!single) {
      const hp = headingParts(o.heading, ci, ch.title) || { num: '', title: '' };
      const shortFirst = ms && o.shortStory && ci === 0;
      const pb = !shortFirst && !(ci === 0 && body.length && (body[body.length - 1] === pageBreak || body[body.length - 1] === FRONT_END));
      // Drop the chapter opening down the page with blank lines (honored by Word, Pages, LibreOffice and Google Docs).
      const blanks = shortFirst ? 1 : ms ? 6 : 4;
      for (let k = 0; k < blanks; k++) body.push(P_('BodyFirst', '', k === 0 && pb ? '<w:pageBreakBefore/>' : ''));
      const first = '';
      if (hp.num) body.push(P_('ChapterNum', T_(hp.num), first));
      if (hp.title) body.push(P_('Chapter', T_(hp.title), hp.num ? '' : first));
      if (!hp.num && !hp.title) body.push(P_('Chapter', '', first));
    }
    let firstPara = true;
    ch.scenes.forEach((html, si) => {
      const div = document.createElement('div');
      div.innerHTML = html;
      const blocks = [...div.childNodes].filter(n => n.nodeType === 1 ? (n.tagName === 'HR' || n.textContent.trim()) : n.textContent.trim());
      if (!blocks.length) return;
      if (si > 0 && !firstPara) { body.push(P_('SceneBreak', T_(o.sceneBreak))); firstPara = true; }
      for (const n of blocks) {
        if (n.nodeType === 3) { body.push(P_(firstPara && !ms ? 'BodyFirst' : 'Body', T_(n.data.trim()))); firstPara = false; continue; }
        const t = n.tagName;
        if (t === 'HR') { body.push(P_('SceneBreak', T_(o.sceneBreak))); firstPara = true; continue; }
        if (t === 'UL' || t === 'OL') { [...n.children].forEach((li, i) => body.push(P_('BodyFirst', T_(t === 'UL' ? '• ' : `${i + 1}. `) + runsOf(li)))); continue; }
        if (/^H[1-3]$/.test(t)) { body.push(P_('SceneBreak', runsOf(n, { b: true }))); firstPara = true; continue; }
        if (t === 'BLOCKQUOTE') { body.push(P_('Quote', runsOf(n))); continue; }
        body.push(P_(firstPara && !ms ? 'BodyFirst' : 'Body', runsOf(n)));
        firstPara = false;
      }
    });
  });
  if (ms && o.end) body.push(P_('SceneBreak', T_('END')));

  const surname = (m.legalName || m.author || 'Author').trim().split(/\s+/).pop();
  const shortTitle = (m.shortTitle || m.title || 'Untitled').toUpperCase();
  const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const hdr = inner => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${inner}</w:hdr>`;
  const ftr = inner => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${inner}</w:ftr>`;
  const parts = {};
  let refs = '';
  const rels = [];
  const addPart = (file, kind, type, content) => {
    const rid = `rId${10 + rels.length}`;
    parts[`word/${file}`] = content;
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${file}"/>`);
    refs += `<w:${kind}Reference w:type="${type}" r:id="${rid}"/>`;
  };
  const empty = '<w:p/>';
  if (ms) {
    addPart('header1.xml', 'header', 'default', hdr(`<w:p><w:pPr><w:pStyle w:val="HeaderLine"/></w:pPr>${T_(`${surname} / ${shortTitle} / `)}${pageField}</w:p>`));
    addPart('header2.xml', 'header', 'first', hdr(empty));
  } else {
    addPart('header1.xml', 'header', 'default', hdr(`<w:p><w:pPr><w:pStyle w:val="RunningHead"/></w:pPr>${T_(m.title || '')}</w:p>`));
    addPart('header2.xml', 'header', 'even', hdr(`<w:p><w:pPr><w:pStyle w:val="RunningHead"/></w:pPr>${T_(m.author || '')}</w:p>`));
    addPart('header3.xml', 'header', 'first', hdr(empty));
    addPart('footer1.xml', 'footer', 'default', ftr(`<w:p><w:pPr><w:pStyle w:val="Folio"/></w:pPr>${pageField}</w:p>`));
    addPart('footer2.xml', 'footer', 'even', ftr(`<w:p><w:pPr><w:pStyle w:val="Folio"/></w:pPr>${pageField}</w:p>`));
    addPart('footer3.xml', 'footer', 'first', ftr(empty));
  }
  let frontRefs = '';
  if (!ms) {
    addPart('header4.xml', 'header', 'default', hdr(empty)); addPart('header5.xml', 'header', 'even', hdr(empty));
    addPart('footer4.xml', 'footer', 'default', ftr(empty)); addPart('footer5.xml', 'footer', 'even', ftr(empty));
    frontRefs = refs.split('<w:').filter(Boolean).map(x => '<w:' + x).slice(-4).join('') + refs.match(/<w:headerReference w:type="first"[^>]*>/)[0] + refs.match(/<w:footerReference w:type="first"[^>]*>/)[0];
    refs = refs.split('<w:').filter(Boolean).map(x => '<w:' + x).slice(0, -4).join('');
  }
  const mar = L.m;
  const pgSetup = `<w:pgSz w:w="${pageW}" w:h="${pageH}"/>
    <w:pgMar w:top="${Math.round(mar.top * TW)}" w:right="${Math.round(mar.outside * TW)}" w:bottom="${Math.round(mar.bottom * TW)}" w:left="${Math.round(mar.inside * TW)}" w:header="${Math.round(mar.top * TW * 0.45)}" w:footer="${Math.round(mar.bottom * TW * 0.4)}" w:gutter="0"/>`;
  const frontSect = `<w:p><w:pPr><w:sectPr>${frontRefs}${pgSetup}<w:titlePg/></w:sectPr></w:pPr></w:p>`;
  const bodyXml = body.map(b => (b === FRONT_END ? frontSect : b)).join('');
  const sect = `<w:sectPr>${refs}<w:pgSz w:w="${pageW}" w:h="${pageH}"/>
    <w:pgMar w:top="${Math.round(mar.top * TW)}" w:right="${Math.round(mar.outside * TW)}" w:bottom="${Math.round(mar.bottom * TW)}" w:left="${Math.round(mar.inside * TW)}" w:header="${Math.round(mar.top * TW * 0.45)}" w:footer="${Math.round(mar.bottom * TW * 0.4)}" w:gutter="0"/>
    ${ms && !o.shortStory ? '<w:pgNumType w:start="0"/>' : ''}${ms || !bodyXml.includes(frontSect) ? '<w:titlePg/>' : ''}</w:sectPr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}${sect}</w:body></w:document>`;
  const jc = P.justify ? 'both' : 'left';
  const style = (id, name, ppr, rpr = '', based = 'Normal') => `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:qFormat/><w:pPr>${ppr}</w:pPr>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}</w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>
    <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}" w:eastAsia="${font}"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
      <w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
    <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/></w:pPr></w:style>
    ${style('Body', 'Body Text', `<w:ind w:firstLine="${indent}"/><w:jc w:val="${jc}"/>`)}
    ${style('BodyFirst', 'Body First', `<w:jc w:val="${jc}"/>`)}
    ${style('Quote', 'Block Quote', `<w:ind w:left="${indent}" w:right="${indent}"/><w:spacing w:before="${line / 2}" w:after="${line / 2}"/>`)}
    ${style('SceneBreak', 'Scene Break', '<w:jc w:val="center"/><w:spacing w:before="' + (ms ? 0 : line / 2) + '" w:after="' + (ms ? 0 : line / 2) + '"/>')}
    ${style('ChapterNum', 'Chapter Number', '<w:keepNext/><w:jc w:val="center"/><w:spacing w:after="120"/>', ms ? '' : `<w:caps/><w:spacing w:val="40"/><w:sz w:val="${Math.round(sz * 0.9)}"/>`)}
    ${style('Chapter', 'Chapter Title', `<w:keepNext/><w:jc w:val="center"/><w:spacing w:after="${ms ? 480 : 720}"/><w:outlineLvl w:val="0"/>`, ms ? '' : `<w:sz w:val="${Math.round(sz * 1.6)}"/>`)}
    ${style('Contact', 'Contact Info', '<w:spacing w:line="240" w:lineRule="auto"/>')}
    ${style('TitleLine', 'Title Line', '<w:jc w:val="center"/>')}
    ${style('BookTitle', 'Book Title', '<w:jc w:val="center"/><w:spacing w:after="240"/>', `<w:sz w:val="${sz * 2}"/>`)}
    ${style('Small', 'Copyright', '<w:spacing w:line="276" w:lineRule="auto"/>', `<w:sz w:val="${Math.max(16, sz - 4)}"/>`)}
    ${style('HeaderLine', 'Manuscript Header', '<w:jc w:val="right"/><w:spacing w:line="240" w:lineRule="auto"/>')}
    ${style('RunningHead', 'Running Head', '<w:jc w:val="center"/><w:spacing w:line="240" w:lineRule="auto"/>', `<w:smallCaps/><w:spacing w:val="20"/><w:sz w:val="${Math.round(sz * 0.8)}"/>`)}
    ${style('Folio', 'Page Number', '<w:jc w:val="center"/><w:spacing w:line="240" w:lineRule="auto"/>', `<w:sz w:val="${Math.round(sz * 0.85)}"/>`)}
  </w:styles>`;
  const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}>${P.mirror ? '<w:mirrorMargins/>' : ''}${!ms ? '<w:evenAndOddHeaders/>' : ''}<w:defaultTabStop w:val="720"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;

  const zip = new JSZip();
  const overrides = Object.keys(parts).map(f => `<Override PartName="/${f}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${f.includes('header') ? 'header' : 'footer'}+xml"/>`).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${overrides}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(m.title)}</dc:title><dc:creator>${xml(m.author || m.legalName)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
  zip.file('word/document.xml', doc);
  zip.file('word/styles.xml', styles);
  zip.file('word/settings.xml', settings);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${rels.join('')}</Relationships>`);
  for (const [f, c] of Object.entries(parts)) zip.file(f, c);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---- EPUB 3
function xhtmlOf(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('hr').forEach(hr => { const p = document.createElement('p'); p.className = 'scene'; p.textContent = state?.cfgNow?.opts.sceneBreak || '⁂'; hr.replaceWith(p); });
  div.querySelectorAll('p,div').forEach(p => { if (!p.textContent.trim() && !p.querySelector('br + *')) p.remove(); });
  const ser = new XMLSerializer();
  return [...div.childNodes].map(n => ser.serializeToString(n)).join('\n').replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '');
}

async function buildEpub(cfg, chapters) {
  const JSZip = await jszip();
  const m = cfg.meta;
  const o = cfg.opts;
  const uid = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
  const page = (title, body, cls = '') => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta charset="utf-8"/><title>${xml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body class="${cls}">${body}</body></html>`;
  const files = [];
  let cover = null;
  if (m.coverSha) {
    const rec = await files_.getFile(m.coverSha) || (sync.isConfigured() ? await sync.fetchFile(m.coverSha, m.coverMime).catch(() => null) : null);
    if (rec) {
      const ext = rec.mime === 'image/png' ? 'png' : 'jpg';
      cover = { blob: rec.blob, href: `images/cover.${ext}`, mime: rec.mime === 'image/png' ? 'image/png' : 'image/jpeg' };
      files.push({ id: 'cover', file: 'cover.xhtml', title: 'Cover', html: page(m.title || 'Cover', `<section epub:type="cover" class="cover"><img src="${cover.href}" alt="${xml(m.title || 'Cover')}"/></section>`, 'cover') });
    }
  }
  if (o.titlePage) files.push({ id: 'title', file: 'title.xhtml', title: 'Title Page', html: page(m.title, `<section epub:type="titlepage" class="titlepage"><h1>${xml(m.title || 'Untitled')}</h1>${m.subtitle ? `<p class="sub">${xml(m.subtitle)}</p>` : ''}<p class="author">${xml(m.author || '')}</p></section>`) });
  if (o.copyrightPage) files.push({ id: 'copyright', file: 'copyright.xhtml', title: 'Copyright', html: page('Copyright', `<section epub:type="copyright-page" class="copyright">${(m.copyright || defaultCopyright(m)).split('\n').map(l => (l.trim() ? `<p>${xml(l)}</p>` : '<p class="gap">&#160;</p>')).join('')}</section>`) });
  if (m.dedication && m.dedication.trim()) files.push({ id: 'dedication', file: 'dedication.xhtml', title: 'Dedication', html: page('Dedication', `<section epub:type="dedication" class="dedication"><p>${m.dedication.split('\n').map(xml).join('<br/>')}</p></section>`) });
  chapters.forEach((ch, i) => {
    const hp = headingParts(o.heading, i, ch.title);
    const label = hp ? [hp.num, hp.title].filter(Boolean).join(': ') : ch.title;
    const head = hp ? `<header>${hp.num ? `<p class="ch-num">${xml(hp.num)}</p>` : ''}${hp.title ? `<h2>${xml(hp.title)}</h2>` : ''}</header>` : '';
    const scenes = ch.scenes.map(xhtmlOf).filter(s => s.trim()).join(`\n<p class="scene">${xml(o.sceneBreak)}</p>\n`);
    files.push({ id: `ch${i + 1}`, file: `chapter-${i + 1}.xhtml`, title: label, toc: true, html: page(label, `<section epub:type="chapter">${head}${scenes}</section>`) });
  });
  const tocItems = files.filter(f => f.toc);
  const nav = page('Contents', `<nav epub:type="toc" id="toc"><h2>Contents</h2><ol>${tocItems.map(f => `<li><a href="${f.file}">${xml(f.title)}</a></li>`).join('')}</ol></nav>`);
  const css = `body{font-family:serif;line-height:1.5;margin:0 4%}
p{margin:0;text-indent:1.3em;text-align:left}
header+p,p.scene+p,section>p:first-child{text-indent:0}
p.scene{text-align:center;text-indent:0;margin:1em 0}
header{margin:3em 0 2em;text-align:center}
.ch-num{text-transform:uppercase;letter-spacing:.2em;font-size:.85em;text-indent:0;text-align:center}
h2{font-weight:normal;font-size:1.5em;margin:.3em 0 0}
blockquote{margin:1em 1.5em;font-style:italic}
.titlepage{text-align:center;margin-top:30%}.titlepage h1{font-weight:normal;font-size:2em}.titlepage p{text-indent:0;text-align:center}
.titlepage .author{margin-top:2em;letter-spacing:.1em;text-transform:uppercase;font-size:.9em}
body.cover{margin:0;padding:0;text-align:center}.cover img{max-width:100%;max-height:100%;height:auto}
.copyright p{text-indent:0;font-size:.8em}.dedication{margin-top:30%;text-align:center;font-style:italic}.dedication p{text-indent:0;text-align:center}`;
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uid}</dc:identifier><dc:title>${xml(m.title || 'Untitled')}</dc:title><dc:creator>${xml(m.author || 'Unknown')}</dc:creator><dc:language>en</dc:language>
${cover ? '<meta name="cover" content="cover-image"/>' : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
${cover ? `<item id="cover-image" href="${cover.href}" media-type="${cover.mime}" properties="cover-image"/>` : ''}
${files.map(f => `<item id="${f.id}" href="${f.file}" media-type="application/xhtml+xml"/>`).join('\n')}</manifest>
<spine toc="ncx">${files.map(f => `<itemref idref="${f.id}"/>`).join('')}</spine></package>`;
  const ncx = `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${xml(m.title)}</text></docTitle><navMap>${tocItems.map((f, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${xml(f.title)}</text></navLabel><content src="${f.file}"/></navPoint>`).join('')}</navMap></ncx>`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
  zip.file('OEBPS/content.opf', opf);
  zip.file('OEBPS/nav.xhtml', nav);
  zip.file('OEBPS/toc.ncx', ncx);
  zip.file('OEBPS/style.css', css);
  for (const f of files) zip.file(`OEBPS/${f.file}`, f.html);
  if (cover) zip.file(`OEBPS/${cover.href}`, cover.blob, { compression: 'STORE' });
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' });
}

export const _test = { buildDocx: (...a) => buildDocx(...a), buildEpub: (...a) => buildEpub(...a), state: () => state };

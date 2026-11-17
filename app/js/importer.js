// Turn uploaded files into binder items: documents become editable notes,
// everything else (PDFs, images…) is kept as an attachment.
import { sanitize, textToHtml } from './editor.js';
import { mammoth } from './vendor.js';

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function inlineMd(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<b>${a || b}</b>`)
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)|(^|\W)_(?!\s)(.+?)_(?!\w)/g, (_, p1, a, p2, b) => `${p1 ?? p2 ?? ''}<i>${a ?? b}</i>`);
}

export function markdownToHtml(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [], list = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inlineMd(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.type}>${list.items.map(i => `<li>${inlineMd(i)}</li>`).join('')}</${list.type}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) { flushPara(); flushList(); const n = Math.min(3, m[1].length); out.push(`<h${n}>${inlineMd(m[2])}</h${n}>`); continue; }
    if (/^(\*\s*\*\s*\*|-{3,}|_{3,}|#\s*#\s*#)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>'); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<blockquote>${inlineMd(m[1])}</blockquote>`); continue; }
    if ((m = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line))) {
      flushPara();
      const type = /\d/.test(m[1]) ? 'ol' : 'ul';
      if (!list || list.type !== type) { flushList(); list = { type, items: [] }; }
      list.items.push(m[2]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('') || '<p><br></p>';
}

const TEXT_EXT = ['txt', 'text', 'md', 'markdown', 'html', 'htm', 'docx', 'fountain'];
export const isConvertible = name => TEXT_EXT.includes(ext(name));
export const ext = name => (name.split('.').pop() || '').toLowerCase();
export const baseName = name => name.replace(/\.[^.]+$/, '') || name;

// Returns HTML for a text-like file.
export async function convert(file) {
  const e = ext(file.name);
  if (e === 'docx') {
    const lib = await mammoth();
    const res = await lib.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, {
      styleMap: ['p[style-name=\'Title\'] => h1:fresh', 'p[style-name=\'Subtitle\'] => h2:fresh'],
    });
    return sanitize(res.value.replace(/<a [^>]*>|<\/a>|<img[^>]*>/g, ''));
  }
  const text = await file.text();
  if (e === 'md' || e === 'markdown') return sanitize(markdownToHtml(text));
  if (e === 'html' || e === 'htm') {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    return sanitize(doc.body.innerHTML);
  }
  return textToHtml(text);
}

// Split converted HTML at its top-level headings → [{title, html}]
export function splitAtHeadings(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  const parts = [];
  let cur = null;
  for (const node of [...div.childNodes]) {
    if (node.nodeType === 1 && /^H[1-3]$/.test(node.tagName)) {
      cur = { title: node.textContent.trim() || 'Untitled', nodes: [] };
      parts.push(cur);
      continue;
    }
    if (!cur) { cur = { title: null, nodes: [] }; parts.push(cur); }
    cur.nodes.push(node);
  }
  return parts
    .map(p => ({ title: p.title, html: p.nodes.map(n => (n.nodeType === 1 ? n.outerHTML : (n.textContent.trim() ? `<p>${esc(n.textContent)}</p>` : ''))).join('') }))
    .filter(p => p.title || p.html.replace(/<[^>]+>/g, '').trim());
}
export function headingCount(html) { return (html.match(/<h[1-3][\s>]/g) || []).length; }

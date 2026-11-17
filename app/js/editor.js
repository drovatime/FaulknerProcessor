// The writing surface: a contenteditable "sheet of paper" with typewriter niceties.
import * as store from './store.js';

const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'HR', 'UL', 'OL', 'LI', 'DIV', 'SPAN']);

export function sanitize(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!ALLOWED.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE'].includes(child.tagName)) { child.remove(); continue; }
          walk(child);
          child.replaceWith(...child.childNodes);
          continue;
        }
        for (const a of [...child.attributes]) child.removeAttribute(a.name);
        walk(child);
      } else if (child.nodeType !== 3) {
        child.remove();
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

const escapeHtml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function textToHtml(text) {
  const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}|\n/);
  return paras.map(p => (p.trim() ? `<p>${escapeHtml(p)}</p>` : '')).join('') || '<p><br></p>';
}

function charBeforeCaret() {
  const sel = getSelection();
  if (!sel.rangeCount) return '';
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return '';
  const n = r.startContainer;
  if (n.nodeType === 3 && r.startOffset > 0) return n.data[r.startOffset - 1];
  return '';
}

export function mountEditor(page, item, { settings, onKey, onWords }) {
  let saveTimer = null;
  let lastSaved = item.content || '';
  let baseWords = store.wordsOf(item);

  page.innerHTML = sanitize(item.content) || '<p><br></p>';
  page.contentEditable = 'true';
  page.spellcheck = true;
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* old browsers */ }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    let html = page.innerHTML;
    if (html === '<p><br></p>' || html === '<br>') html = '';
    if (html === lastSaved) return;
    lastSaved = html;
    store.update(item.id, { content: html }, { quiet: true });
    const now = store.wordsOf(store.get(item.id));
    onWords?.(now - baseWords, now);
    baseWords = now;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 450);
  }

  function typewriterScroll() {
    if (!settings().typewriter) return;
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0).cloneRange();
    let rect = r.getClientRects()[0];
    if (!rect) {
      const el = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentElement;
      rect = el && el.getBoundingClientRect();
    }
    if (!rect) return;
    const scroller = page.closest('.scroller');
    const box = scroller.getBoundingClientRect();
    const target = box.top + box.height * 0.45;
    const delta = rect.top - target;
    if (Math.abs(delta) > 4) scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }

  function onBeforeInput(e) {
    const s = settings();
    let kind = null;
    switch (e.inputType) {
      case 'insertParagraph': case 'insertLineBreak': kind = 'enter'; break;
      case 'deleteContentBackward': case 'deleteWordBackward': case 'deleteContentForward': kind = 'back'; break;
      case 'insertText': case 'insertReplacementText': case 'insertCompositionText':
        kind = e.data === ' ' ? 'space' : 'char'; break;
    }
    if (kind) onKey?.(kind);

    if (s.smartQuotes && e.inputType === 'insertText' && e.data) {
      const prev = charBeforeCaret();
      let rep = null;
      const opening = !prev || /[\s(\[{—–-]/.test(prev);
      if (e.data === '"') rep = opening ? '“' : '”';
      else if (e.data === "'") rep = opening ? '‘' : '’';
      else if (e.data === '-' && prev === '-') {
        e.preventDefault();
        document.execCommand('delete');
        document.execCommand('insertText', false, '—');
        return;
      } else if (e.data === '.' && prev === '.') {
        const sel = getSelection();
        const r = sel.rangeCount && sel.getRangeAt(0);
        const n = r && r.startContainer;
        if (n && n.nodeType === 3 && r.startOffset >= 2 && n.data.slice(r.startOffset - 2, r.startOffset) === '..') {
          e.preventDefault();
          document.execCommand('delete');
          document.execCommand('delete');
          document.execCommand('insertText', false, '…');
          return;
        }
      }
      if (rep) {
        e.preventDefault();
        document.execCommand('insertText', false, rep);
      }
    }
  }

  function onInput() {
    scheduleSave();
    requestAnimationFrame(typewriterScroll);
  }

  function onPaste(e) {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    if (!/\n/.test(text)) document.execCommand('insertText', false, text);
    else document.execCommand('insertHTML', false, textToHtml(text));
  }

  function onKeydown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, ' ');
    }
  }

  page.addEventListener('beforeinput', onBeforeInput);
  page.addEventListener('input', onInput);
  page.addEventListener('paste', onPaste);
  page.addEventListener('keydown', onKeydown);
  page.addEventListener('click', () => requestAnimationFrame(typewriterScroll));
  page.addEventListener('blur', save);

  return {
    flush: save,
    reload(next) {
      if ((next.content || '') === lastSaved) return;
      if (saveTimer) return; // user is typing; their version will be saved & synced
      page.innerHTML = sanitize(next.content) || '<p><br></p>';
      lastSaved = next.content || '';
      baseWords = store.wordsOf(next);
    },
    destroy() {
      save();
      page.removeEventListener('beforeinput', onBeforeInput);
      page.removeEventListener('input', onInput);
      page.removeEventListener('paste', onPaste);
      page.removeEventListener('keydown', onKeydown);
      page.removeEventListener('blur', save);
    },
    command(cmd) {
      page.focus();
      switch (cmd) {
        case 'bold': case 'italic': case 'underline': case 'undo': case 'redo':
          document.execCommand(cmd); break;
        case 'h2': {
          const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
          document.execCommand('formatBlock', false, cur === 'h2' ? 'p' : 'h2');
          break;
        }
        case 'quote': {
          const cur = (document.queryCommandValue('formatBlock') || '').toLowerCase();
          document.execCommand('formatBlock', false, cur === 'blockquote' ? 'p' : 'blockquote');
          break;
        }
        case 'break':
          document.execCommand('insertHTML', false, '<hr><p><br></p>');
          break;
      }
      onInput();
    },
  };
}

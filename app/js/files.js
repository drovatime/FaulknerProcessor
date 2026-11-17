// Attachments (PDFs, images, anything else). Stored by content hash (the same hash
// Git uses), so the same file is only ever stored and uploaded once.
import { db } from './db.js';

const enc = new TextEncoder();

export async function gitSha(bytes) {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  const hash = await crypto.subtle.digest('SHA-1', all);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function saveFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = await gitSha(bytes);
  const mime = file.type || guessMime(file.name);
  await db.putFile({ sha, blob: new Blob([bytes], { type: mime }), mime, size: bytes.length });
  return { sha, mime, size: bytes.length };
}

export const getFile = sha => db.getFile(sha);
export async function hasFile(sha) { return !!(await db.getFile(sha)); }
export async function putBytes(sha, bytes, mime) {
  await db.putFile({ sha, blob: new Blob([bytes], { type: mime }), mime, size: bytes.length });
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
export function base64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', rtf: 'application/rtf', mp3: 'audio/mpeg', m4a: 'audio/mp4', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
export function guessMime(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}
export function fileKind(mime = '') {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/')) return 'text';
  return 'other';
}
export function humanSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

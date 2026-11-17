// Load a bundled library on first use (keeps startup fast).
const loading = new Map();
const base = new URL('../vendor/', import.meta.url);
export function loadVendor(file, globalName) {
  if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
  if (!loading.has(file)) {
    loading.set(file, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = new URL(file, base).href;
      s.onload = () => resolve(globalName ? window[globalName] : true);
      s.onerror = () => { loading.delete(file); reject(new Error(`Could not load ${file}`)); };
      document.head.appendChild(s);
    }));
  }
  return loading.get(file);
}
export const vendorUrl = file => new URL(file, base).href;

export async function pdfjs() {
  const lib = await loadVendor('pdf.min.js', 'pdfjsLib');
  lib.GlobalWorkerOptions.workerSrc = vendorUrl('pdf.worker.min.js');
  return lib;
}
export const jszip = () => loadVendor('jszip.min.js', 'JSZip');
export const mammoth = () => loadVendor('mammoth.browser.min.js', 'mammoth');

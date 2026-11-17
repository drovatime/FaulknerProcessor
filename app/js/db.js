// Tiny IndexedDB wrapper. Everything lives on-device first; sync is layered on top.
const DB_NAME = 'faulkner'; // original app name; kept so existing data stays put
const VERSION = 2;
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'sha' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const out = fn(tx.objectStore(storeName));
    tx.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export const db = {
  all: () => run('items', 'readonly', s => s.getAll()),
  put: item => run('items', 'readwrite', s => { s.put(item); }),
  putMany: items => run('items', 'readwrite', s => { items.forEach(i => s.put(i)); }),
  del: id => run('items', 'readwrite', s => { s.delete(id); }),
  delMany: ids => run('items', 'readwrite', s => { ids.forEach(id => s.delete(id)); }),
  getMeta: key => run('meta', 'readonly', s => s.get(key)),
  setMeta: (key, value) => run('meta', 'readwrite', s => { s.put(value, key); }),
  getFile: sha => run('files', 'readonly', s => s.get(sha)),
  putFile: rec => run('files', 'readwrite', s => { s.put(rec); }),
  fileKeys: () => run('files', 'readonly', s => s.getAllKeys()),
};

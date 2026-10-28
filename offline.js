// מצב בלי אינטרנט: רשימת המסמכים ודפי המסמכים החשובים נשמרים בתוך האפליקציה (לא בגלריה ולא בקבצים)
const DB = "nayeret-offline";
let dbp = null;
function open() {
  if (!("indexedDB" in self)) return Promise.reject(new Error("no-idb"));
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv"); r.result.createObjectStore("files"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
  }));
}
function run(store, mode, fn) {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = t.onabort = () => rej(t.error);
  }));
}
const quiet = (p, def) => p.catch((e) => { console.warn("offline", e); return def; });

export const saveSnapshot = (snap) => quiet(run("kv", "readwrite", (s) => s.put({ ...snap, at: Date.now() }, "snap")));
export const loadSnapshot = () => quiet(run("kv", "readonly", (s) => s.get("snap")), null);
export const getFile = (fid) => quiet(run("files", "readonly", (s) => s.get(fid)), null);
export const putFile = (fid, data) => quiet(run("files", "readwrite", (s) => s.put(data, fid)));
export const fileKeys = () => quiet(run("files", "readonly", (s) => s.getAllKeys()), []);
export const delFiles = (fids) => fids.length ? quiet(run("files", "readwrite", (s) => { fids.forEach((f) => s.delete(f)); })) : Promise.resolve();
export const clearAll = () => quiet(Promise.all([run("kv", "readwrite", (s) => s.clear()), run("files", "readwrite", (s) => s.clear())]));

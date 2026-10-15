// חיבור לשרת הקטן בגוגל (Apps Script), או מצב תצוגה בזיכרון
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class RemoteApi {
  constructor(url) { this.url = url; this.k = ""; this.demo = false; }
  async call(a, body = {}) {
    // text/plain בלי כותרות מיוחדות: גוגל מאפשרת את זה מכל אתר
    const res = await fetch(this.url, { method: "POST", body: JSON.stringify({ a, k: this.k, ...body }), redirect: "follow" });
    if (!res.ok) throw new Error(`שגיאת שרת (${res.status})`);
    const out = await res.json();
    if (!out.ok) { const e = new Error(out.error || "error"); e.code = out.error; throw e; }
    return out;
  }
  login(k) { this.k = k; return this.call("login"); }
  thumbs() { return this.call("thumbs").then((r) => r.thumbs || {}); }
  pages(id) { return this.call("pages", { id }).then((r) => r.pages || []); }
  saveDoc(doc, pages, thumb) { return this.call("saveDoc", { doc, pages, thumb }).then((r) => r.doc); }
  deleteDocs(ids) { return this.call("delete", { ids }); }
  saveSettings(patch) { return this.call("settings", { patch }).then((r) => r.settings); }
  setPassword(newK) { return this.call("setPassword", { newK }); }
}

// מצב תצוגה: הכול בזיכרון, לבדיקה בלי חיבור
export class DemoApi {
  constructor() { this.demo = true; this.k = ""; this.docs = []; this.pagesById = {}; this.thumbsById = {}; this.settings = {}; this.pw = ""; }
  async login(k) {
    if (!this.pw) this.pw = k;
    if (k !== this.pw) { const e = new Error("bad-password"); e.code = "bad-password"; throw e; }
    this.k = k;
    return { settings: { ...this.settings }, docs: this.docs.map((d) => ({ ...d })) };
  }
  async thumbs() { return { ...this.thumbsById }; }
  async pages(id) { return (this.pagesById[id] || []).slice(); }
  async saveDoc(doc, pages, thumb) {
    const d = { ...doc };
    if (!d.id) { d.id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); d.createdAt = Date.now(); }
    d.updatedAt = Date.now();
    if (pages && pages.length) { this.pagesById[d.id] = pages.slice(); d.pageCount = pages.length; }
    if (thumb) this.thumbsById[d.id] = thumb;
    const i = this.docs.findIndex((x) => x.id === d.id);
    if (i >= 0) this.docs[i] = { ...this.docs[i], ...d }; else this.docs.push(d);
    return { ...(i >= 0 ? this.docs[i] : d) };
  }
  async deleteDocs(ids) { this.docs = this.docs.filter((d) => !ids.includes(d.id)); ids.forEach((id) => { delete this.pagesById[id]; delete this.thumbsById[id]; }); return { ok: true }; }
  async saveSettings(patch) { Object.assign(this.settings, patch); return { ...this.settings }; }
  async setPassword(newK) { this.pw = newK; return { ok: true }; }
}

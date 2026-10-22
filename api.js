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
  file(fid) { return this.call("file", { fid }).then((r) => r.data); }
  addLite(id, lites) { return this.call("addLite", { id, lites }).then((r) => r.doc); }
  saveDoc(doc, pages, thumb, lites) { return this.call("saveDoc", { doc, pages, thumb, lites }).then((r) => r.doc); }
  deleteDocs(ids) { return this.call("delete", { ids }); }
  saveSettings(patch) { return this.call("settings", { patch }).then((r) => r.settings); }
  setPassword(newK) { return this.call("setPassword", { newK }); }
}

// מצב תצוגה: הכול בזיכרון, לבדיקה בלי חיבור
export class DemoApi {
  constructor() { this.demo = true; this.k = ""; this.docs = []; this.pagesById = {}; this.litesById = {}; this.thumbsById = {}; this.settings = {}; this.pw = ""; }
  async login(k) {
    if (!this.pw) this.pw = k;
    if (k !== this.pw) { const e = new Error("bad-password"); e.code = "bad-password"; throw e; }
    this.k = k;
    return { settings: { ...this.settings }, docs: this.docs.map((d) => ({ ...d })) };
  }
  async thumbs() { return { ...this.thumbsById }; }
  async pages(id) { return (this.pagesById[id] || []).slice(); }
  async file(fid) { await new Promise((r) => setTimeout(r, 150)); const [id, kind, i] = fid.split("|"); return (kind === "l" ? this.litesById : this.pagesById)[id][Number(i)]; }
  async addLite(id, lites) { this.litesById[id] = lites.slice(); const d = this.docs.find((x) => x.id === id); d.liteIds = lites.map((_, i) => `${id}|l|${i}`); return { ...d }; }
  async saveDoc(doc, pages, thumb, lites) {
    const d = { ...doc };
    if (!d.id) { d.id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); d.createdAt = Date.now(); }
    d.updatedAt = Date.now();
    if (pages && pages.length) {
      this.pagesById[d.id] = pages.slice(); d.pageCount = pages.length; d.fileIds = pages.map((_, i) => `${d.id}|o|${i}`);
      if (lites && lites.length === pages.length) { this.litesById[d.id] = lites.slice(); d.liteIds = lites.map((_, i) => `${d.id}|l|${i}`); } else d.liteIds = [];
    }
    if (thumb) this.thumbsById[d.id] = thumb;
    const i = this.docs.findIndex((x) => x.id === d.id);
    if (i >= 0) this.docs[i] = { ...this.docs[i], ...d }; else this.docs.push(d);
    return { ...(i >= 0 ? this.docs[i] : d) };
  }
  async deleteDocs(ids) { this.docs = this.docs.filter((d) => !ids.includes(d.id)); ids.forEach((id) => { delete this.pagesById[id]; delete this.thumbsById[id]; }); return { ok: true }; }
  async saveSettings(patch) { Object.assign(this.settings, patch); return { ...this.settings }; }
  async setPassword(newK) { this.pw = newK; return { ok: true }; }
}

/* ======================= כניסה עם גוגל: הקבצים נשמרים בדרייב של המשתמש ======================= */
// הרשאה מצומצמת: האפליקציה רואה רק קבצים שהיא עצמה יצרה (התיקייה "ניירת בית"), לא את שאר הדרייב
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file email";
const TOK_KEY = "nb_gtok", MAIL_KEY = "nb_gmail";
const ls = { get: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };
// כתובת החזרה חייבת להיות בדיוק כמו שנרשמה בגוגל (בלי index.html)
export const appBaseUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

export function googleAuthUrl(clientId, { prompt = "", hint = "", state = "" } = {}) {
  const p = new URLSearchParams({ client_id: clientId, redirect_uri: appBaseUrl(), response_type: "token", scope: GOOGLE_SCOPE, include_granted_scopes: "true" });
  if (prompt) p.set("prompt", prompt);
  if (hint) p.set("login_hint", hint);
  if (state) p.set("state", state);
  return "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString();
}
// אחרי החזרה מגוגל: #access_token=…&expires_in=…  או  #error=…
export function takeAuthFromHash() {
  const h = location.hash.replace(/^#/, "");
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, "", location.pathname + location.search);
  if (p.get("error")) return { error: p.get("error"), state: p.get("state") || "" };
  const tok = { t: p.get("access_token"), exp: Date.now() + (Number(p.get("expires_in")) || 3600) * 1000 };
  ls.set(TOK_KEY, JSON.stringify(tok));
  return { ok: true, state: p.get("state") || "" };
}
export function googleToken() { try { const t = JSON.parse(ls.get(TOK_KEY) || "null"); return t && t.t ? t : null; } catch { return null; } }
export const tokenMinutesLeft = () => { const t = googleToken(); return t ? (t.exp - Date.now()) / 60000 : 0; };
export const googleEmail = () => ls.get(MAIL_KEY);
export function googleSignOut() { const t = googleToken(); ls.set(TOK_KEY, ""); if (t) fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(t.t), { method: "POST" }).catch(() => {}); }

const DRIVE = "https://www.googleapis.com/drive/v3/files", UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const qs = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
function dataUrlToBlob(url) {
  const [head, b64] = url.split(","); const mime = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
const blobToDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });

export class DriveApi {
  constructor({ onAuthNeeded } = {}) { this.demo = false; this.google = true; this.onAuthNeeded = onAuthNeeded; this.ids = {}; this.root = ""; this.files = ""; this.k = ""; }
  async req(url, opts = {}) {
    const tok = googleToken();
    if (!tok || tok.exp < Date.now()) { this.onAuthNeeded && this.onAuthNeeded(); const e = new Error("auth"); e.code = "auth"; throw e; }
    const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${tok.t}` } });
    if (res.status === 401) { this.onAuthNeeded && this.onAuthNeeded(); const e = new Error("auth"); e.code = "auth"; throw e; }
    if (!res.ok) { const e = new Error(`Drive ${res.status}`); e.status = res.status; e.body = await res.text().catch(() => ""); throw e; }
    return res;
  }
  async list(q) {
    const res = await this.req(`${DRIVE}?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100&spaces=drive`);
    return (await res.json()).files || [];
  }
  async folder(name, parent) {
    const found = await this.list(`name='${qs(name)}' and mimeType='${FOLDER}' and trashed=false${parent ? ` and '${parent}' in parents` : ""}`);
    if (found.length) return found[0].id;
    const res = await this.req(`${DRIVE}?fields=id`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) });
    return (await res.json()).id;
  }
  async create(name, parent, content, mime) {
    const b = "nb" + Math.random().toString(36).slice(2);
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: [parent] })}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`, content, `\r\n--${b}--`]);
    const res = await this.req(`${UPLOAD}?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${b}` }, body });
    return (await res.json()).id;
  }
  async init() {
    if (this.root) return;
    this.root = await this.folder("ניירת בית");
    this.files = await this.folder("קבצים", this.root);
    for (const f of await this.list(`'${this.root}' in parents and trashed=false and mimeType!='${FOLDER}'`)) this.ids[f.name] = f.id;
  }
  async readJson(name, def) {
    const id = this.ids[name]; if (!id) return def;
    try { return await (await this.req(`${DRIVE}/${id}?alt=media`)).json(); } catch (e) { if (e.code === "auth") throw e; return def; }
  }
  async writeJson(name, obj) {
    const text = JSON.stringify(obj);
    if (this.ids[name]) await this.req(`${UPLOAD}/${this.ids[name]}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: text });
    else this.ids[name] = await this.create(name, this.root, text, "application/json");
  }
  async trash(id) { await this.req(`${DRIVE}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trashed: true }) }).catch((e) => { if (e.code === "auth") throw e; }); }

  async login() {
    await this.init();
    if (!googleEmail()) {
      fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(googleToken().t)).then((r) => r.json()).then((j) => j.email && ls.set(MAIL_KEY, j.email)).catch(() => {});
    }
    const [settings, docs] = await Promise.all([this.readJson("settings.json", {}), this.readJson("index.json", [])]);
    return { settings, docs };
  }
  thumbs() { return this.init().then(() => this.readJson("thumbs.json", {})); }
  async pages(id) {
    await this.init();
    const d = (await this.readJson("index.json", [])).find((x) => x.id === id);
    const out = [];
    for (const fid of (d && d.fileIds) || []) { try { out.push(await blobToDataUrl(await (await this.req(`${DRIVE}/${fid}?alt=media`)).blob())); } catch (e) { if (e.code === "auth") throw e; } }
    return out;
  }
  async liteFolder() { if (!this.lite) this.lite = await this.folder("תצוגה מהירה", this.root); return this.lite; }
  async file(fid) { return blobToDataUrl(await (await this.req(`${DRIVE}/${fid}?alt=media`)).blob()); }
  async upPages(folder, id, pages, suffix) { return Promise.all(pages.map((p, i) => this.create(`${id}-${i + 1}${suffix}.jpg`, folder, dataUrlToBlob(p), "image/jpeg"))); }
  // כתיבות לרשימת המסמכים אחת אחרי השנייה, כדי ששתי שמירות לא ידרסו זו את זו
  serial(fn) { const run = (this.chain || Promise.resolve()).then(fn, fn); this.chain = run.catch(() => {}); return run; }
  addLite(id, lites) { return this.serial(() => this._addLite(id, lites)); }
  saveDoc(...a) { return this.serial(() => this._saveDoc(...a)); }
  deleteDocs(ids) { return this.serial(() => this._deleteDocs(ids)); }
  async _addLite(id, lites) {
    await this.init();
    const docs = await this.readJson("index.json", []), d = docs.find((x) => x.id === id);
    if (!d || lites.length !== (d.fileIds || []).length) throw new Error("no-doc");
    if (d.liteIds?.length) return d;
    d.liteIds = await this.upPages(await this.liteFolder(), id, lites, "-lite");
    await this.writeJson("index.json", docs);
    return d;
  }
  async _saveDoc(doc, pages, thumb, lites) {
    await this.init();
    doc = { ...doc };
    const docs = await this.readJson("index.json", []);
    if (!doc.id) { doc.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7); doc.createdAt = Date.now(); }
    doc.updatedAt = Date.now();
    if (pages && pages.length) {
      const prev = docs.find((x) => x.id === doc.id) || {};
      doc.fileIds = await this.upPages(this.files, doc.id, pages, "");
      doc.liteIds = lites && lites.length === pages.length ? await this.upPages(await this.liteFolder(), doc.id, lites, "-lite") : [];
      doc.pageCount = pages.length;
      for (const fid of [...(prev.fileIds || []), ...(prev.liteIds || [])]) await this.trash(fid);
    }
    const i = docs.findIndex((x) => x.id === doc.id);
    if (i >= 0) docs[i] = { ...docs[i], ...doc }; else docs.push(doc);
    await this.writeJson("index.json", docs);
    if (thumb) { const t = await this.readJson("thumbs.json", {}); t[doc.id] = thumb; await this.writeJson("thumbs.json", t); }
    return i >= 0 ? docs[i] : doc;
  }
  async _deleteDocs(ids) {
    await this.init();
    const docs = await this.readJson("index.json", []), t = await this.readJson("thumbs.json", {});
    for (const d of docs.filter((x) => ids.includes(x.id))) for (const fid of [...(d.fileIds || []), ...(d.liteIds || [])]) await this.trash(fid);
    ids.forEach((id) => delete t[id]);
    await this.writeJson("index.json", docs.filter((x) => !ids.includes(x.id)));
    await this.writeJson("thumbs.json", t);
    return { ok: true };
  }
  async saveSettings(patch) {
    await this.init();
    const s = { ...(await this.readJson("settings.json", {})), ...patch };
    await this.writeJson("settings.json", s);
    return s;
  }
  async setPassword() { throw new Error("בכניסה עם גוגל אין סיסמה"); }
}

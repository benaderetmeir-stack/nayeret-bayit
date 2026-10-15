/**
 * ניירת בית: השרת הקטן שרץ בחשבון הגוגל שלך (Google Apps Script)
 * הוא בודק את הסיסמה, ושומר ומביא מסמכים מהתיקייה "ניירת בית" בדרייב שלך.
 *
 * לפני הפרסום הראשון: כתבי כאן את הסיסמה הראשונה. אחר כך אפשר להחליף אותה מתוך המערכת.
 */
const INITIAL_PASSWORD = "שני-את-זה";

const ROOT_NAME = "ניירת בית";
const FILES_NAME = "קבצים";

function doGet() {
  return ContentService.createTextOutput("ניירת בית פועל ✓");
}

function doPost(e) {
  let out;
  try {
    const req = JSON.parse(e.postData.contents || "{}");
    out = handle_(req);
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(req) {
  if (!checkPassword_(req.k)) return { ok: false, error: "bad-password" };
  const a = req.a;
  if (a === "login") {
    return { ok: true, settings: readJson_("settings.json", {}), docs: readJson_("index.json", []) };
  }
  if (a === "thumbs") return { ok: true, thumbs: readJson_("thumbs.json", {}) };
  if (a === "pages") return { ok: true, pages: readPages_(req.id) };
  return withLock_(function () {
    if (a === "saveDoc") return saveDoc_(req.doc, req.pages, req.thumb);
    if (a === "delete") return deleteDocs_(req.ids || []);
    if (a === "settings") {
      const s = readJson_("settings.json", {});
      Object.keys(req.patch || {}).forEach(function (key) { s[key] = req.patch[key]; });
      writeJson_("settings.json", s);
      return { ok: true, settings: s };
    }
    if (a === "setPassword") {
      if (!/^[0-9a-f]{64}$/.test(req.newK || "")) return { ok: false, error: "bad-new-password" };
      PropertiesService.getScriptProperties().setProperty("PW_HASH", req.newK);
      return { ok: true };
    }
    return { ok: false, error: "unknown-action" };
  });
}

/* ---------- סיסמה (נשמרת כגיבוב, עם הגנה מניחושים) ---------- */
function sha256Hex_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ("0" + (b & 0xff).toString(16)).slice(-2); }).join("");
}
function checkPassword_(k) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get("fails") || 0);
  if (fails >= 15) throw new Error("too-many-attempts");
  const props = PropertiesService.getScriptProperties();
  let hash = props.getProperty("PW_HASH");
  if (!hash) { hash = sha256Hex_(INITIAL_PASSWORD); props.setProperty("PW_HASH", hash); }
  const ok = typeof k === "string" && k === hash;
  if (!ok) cache.put("fails", String(fails + 1), 600);
  return ok;
}

/* ---------- תיקיות וקבצי JSON ---------- */
function rootFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("ROOT_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* נמחקה: יוצרים מחדש */ } }
  const it = DriveApp.getFoldersByName(ROOT_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_NAME);
  props.setProperty("ROOT_ID", f.getId());
  return f;
}
function filesFolder_() {
  const root = rootFolder_();
  const it = root.getFoldersByName(FILES_NAME);
  return it.hasNext() ? it.next() : root.createFolder(FILES_NAME);
}
function jsonFile_(name) {
  const root = rootFolder_();
  const it = root.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
function readJson_(name, fallback) {
  const f = jsonFile_(name);
  if (!f) return fallback;
  try { return JSON.parse(f.getBlob().getDataAsString("UTF-8")); } catch (e) { return fallback; }
}
function writeJson_(name, data) {
  const text = JSON.stringify(data);
  const f = jsonFile_(name);
  if (f) f.setContent(text);
  else rootFolder_().createFile(name, text, "application/json");
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- מסמכים ---------- */
function newId_() { return Utilities.getUuid().replace(/-/g, "").slice(0, 16); }

function saveDoc_(doc, pages, thumb) {
  if (!doc) return { ok: false, error: "no-doc" };
  const docs = readJson_("index.json", []);
  const isNew = !doc.id;
  if (isNew) { doc.id = newId_(); doc.createdAt = Date.now(); }
  doc.updatedAt = Date.now();
  if (pages && pages.length) {
    const folder = filesFolder_();
    const old = (docs.filter(function (d) { return d.id === doc.id; })[0] || {}).fileIds || [];
    old.forEach(function (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} });
    doc.fileIds = pages.map(function (url, i) {
      const b64 = String(url).split(",")[1] || "";
      const blob = Utilities.newBlob(Utilities.base64Decode(b64), "image/jpeg", doc.id + "-" + (i + 1) + ".jpg");
      return folder.createFile(blob).getId();
    });
    doc.pageCount = pages.length;
  }
  const i = docs.findIndex(function (d) { return d.id === doc.id; });
  if (i >= 0) docs[i] = Object.assign({}, docs[i], doc); else docs.push(doc);
  writeJson_("index.json", docs);
  if (thumb) { const t = readJson_("thumbs.json", {}); t[doc.id] = thumb; writeJson_("thumbs.json", t); }
  return { ok: true, doc: i >= 0 ? docs[i] : doc };
}

function readPages_(id) {
  const docs = readJson_("index.json", []);
  const d = docs.filter(function (x) { return x.id === id; })[0];
  if (!d) return [];
  return (d.fileIds || []).map(function (fid) {
    try { return "data:image/jpeg;base64," + Utilities.base64Encode(DriveApp.getFileById(fid).getBlob().getBytes()); }
    catch (e) { return ""; }
  }).filter(String);
}

// מחיקה = העברה לסל האשפה של הדרייב (נשאר שם 30 יום)
function deleteDocs_(ids) {
  const docs = readJson_("index.json", []);
  const t = readJson_("thumbs.json", {});
  const keep = [];
  docs.forEach(function (d) {
    if (ids.indexOf(d.id) < 0) { keep.push(d); return; }
    (d.fileIds || []).forEach(function (fid) { try { DriveApp.getFileById(fid).setTrashed(true); } catch (e) {} });
    delete t[d.id];
  });
  writeJson_("index.json", keep);
  writeJson_("thumbs.json", t);
  return { ok: true, deleted: docs.length - keep.length };
}

// להרצה ידנית פעם אחת מתוך העורך, כדי לאשר הרשאות ולבדוק שהכול עובד
function setup() {
  rootFolder_(); filesFolder_();
  if (!jsonFile_("index.json")) writeJson_("index.json", []);
  if (!jsonFile_("settings.json")) writeJson_("settings.json", {});
  if (!jsonFile_("thumbs.json")) writeJson_("thumbs.json", {});
  Logger.log("התיקייה מוכנה: " + rootFolder_().getUrl());
}

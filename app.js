// ניירת בית: כל המסמכים של הבית והמשפחה
import { RemoteApi, DemoApi, sha256Hex, DriveApi, googleAuthUrl, takeAuthFromHash, tokenMinutesLeft, googleEmail, googleSignOut } from "./api.js?v=13";
import { fileToPages, makeThumb, isPdf, loadImage } from "./images.js?v=13";
import { recognize, DEFAULT_TOPICS, addMonths, ruleOf, classifyFolders, placementFix, OLD_TOPICS } from "./ocr.js?v=13";
import { exportExcel } from "./excel.js?v=13";
import { scanPage, scannerSupported } from "./scanner.js?v=13";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = (n) => String(n).padStart(2, "0");
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => localIso(new Date());
const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return localIso(new Date(y, m - 1, d + n)); };
const daysUntil = (iso) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); };
const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const fmtMoney = (n) => n == null || n === "" ? "" : Number(n).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const numVal = (el) => { const v = parseFloat(String(el.value).replace(",", ".")); return Number.isFinite(v) ? Math.round(v * 100) / 100 : null; };

const TOPIC_ICON = { "בריאות": "🩺", "אחריות ומוצרים": "🧾", "חשבוניות לבית": "💡", "רכב": "🚗", "ביטוחים": "🛡️", "מסמכים אישיים": "🪪", "לימודים": "🎓", "דירה ונכס": "🏠", "חברים": "🤝", "נסיעות": "✈️", "שונות": "📁" };
const TOPIC_TINT = { "בריאות": "#FDE8E8", "אחריות ומוצרים": "#FFF1E6", "חשבוניות לבית": "#FEF9C3", "רכב": "#E3EEFB", "ביטוחים": "#E3F5EC", "מסמכים אישיים": "#FEF3C7", "לימודים": "#E8F0E0", "דירה ונכס": "#F3EAFB", "חברים": "#FCE7F3", "נסיעות": "#E0F2FE", "שונות": "#F1F4F6" };
const TOPIC_SHORT = { "אחריות ומוצרים": "אחריות", "דירה ונכס": "דירות", "רכב": "רכבים", "מסמכים אישיים": "אישי", "חשבוניות לבית": "חשבונות הבית" };
const PRIMARY = ["דירה ונכס", "בריאות", "מסמכים אישיים", "לימודים", "רכב", "נסיעות", "אחריות ומוצרים", "ביטוחים"];
const SUB_ICON = { "בדיקות": "🩸", "רופאים": "👩‍⚕️", "ביטוח בריאות": "🛡️", "ביטוח חיים": "🛡️", "ביטוח פנסיוני": "🏦", "תעודת זהות": "🪪", "דרכון": "🛂", "רישיון נהיגה": "🚗", "תעודות": "📜", "אישורים": "📋", "תשלומים": "💳",
  "טיסות": "✈️", "מלון": "🏨", "ביטוח נסיעות": "🛡️", "השכרת רכב": "🚙", "כרטיסים": "🎟️", "אחר": "📄", "רישיון רכב": "📄", "ביטוח": "🛡️", "טיפולים ותיקונים": "🔧", "דוחות וקנסות": "🚨", "קנייה ומכירה": "🤝", "בדיקות דם": "🩸", "הדמיה וצילומים": "🩻", "רופא משפחה": "👩‍⚕️", "רופאים מומחים": "👨‍⚕️", "עיניים": "👁️", "שיניים": "🦷", "מרשמים ותרופות": "💊", "הפניות ואישורים": "📋", "אשפוז וניתוחים": "🏥", "חיסונים": "💉", "חוזים": "📝", "משכנתא": "🏦", "שיפוצים ותיקונים": "🔨", "מיסים ואגרות": "🏛️",
  "ביטוח דירה": "🏠", "ביטוח רכב": "🚗", "ביטוח בריאות": "🩺", "ביטוח חיים": "❤️", "ביטוח נסיעות": "✈️", "ביטוח משכנתא": "🏦", "חשמל": "⚡", "מים": "💧", "ארנונה": "🏛️", "גז": "🔥", "אינטרנט וטלפון": "🌐", "ועד בית": "🏢" };
const FOLDER_ICON = { "רכב": "🚙", "בריאות": "👤", "מסמכים אישיים": "👤", "לימודים": "👤", "אחריות ומוצרים": "📦", "דירה ונכס": "🏠", "חברים": "🤝" };
const topicIcon = (t) => TOPIC_ICON[t] || "📄";
const topicShort = (t) => TOPIC_SHORT[t] || t;
const tint = (t) => TOPIC_TINT[t] || "#F1F4F6";
const folderIcon = (topic, name) => SUB_ICON[name] || FOLDER_ICON[topic] || "📂";
const CLEAN_AFTER_DAYS = 182;   // חצי שנה אחרי שהמסמך הפסיק להיות רלוונטי
const REMIND_AHEAD_DAYS = 60;

const state = { api: null, settings: {}, docs: [], thumbs: {}, view: "home", pages: new Map(), tripOpen: null,
  nav: { topic: null, folder: null, sub: null, more: false }, archOpen: false, attnAll: false, sorting: false };

/* ======================= הודעות ואישור ======================= */
let toastT;
function toast(msg, ms = 2600) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }
function confirmBox(text, yes = "כן", danger = true, no = "ביטול") {
  return new Promise((res) => {
    const d = $("confirmDlg"); $("cfText").textContent = text;
    const y = $("cfYes"); y.textContent = yes; y.className = "btn " + (danger ? "btn-danger" : "btn-primary");
    $("cfNo").textContent = no;
    const done = (v) => { d.close(); y.onclick = $("cfNo").onclick = null; res(v); };
    y.onclick = () => done(true); $("cfNo").onclick = () => done(false);
    d.oncancel = (e) => { e.preventDefault(); done(null); };
    d.showModal();
  });
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-close]"); if (b) b.closest("dialog").close(); });
const lsGet = (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } };
const lsSet = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} };

/* ======================= כניסה ======================= */
/* ----- כניסה עם גוגל ----- */
let pendingHash = "";
const isGoogle = () => !!state.api?.google;
function googleRedirect(prompt) {
  location.href = googleAuthUrl(state.gid, { prompt, hint: googleEmail(), state: pendingHash || (location.hash.startsWith("#doc=") ? location.hash : "") });
}
// תוקף הכניסה לגוגל הוא שעה. מחדשים בשקט כשאין חלון פתוח (כדי לא לאבד עבודה)
function onAuthNeeded() {
  if (document.querySelector("dialog[open]")) { toast("החיבור לגוגל פג. סגרי את החלון ונתחבר מחדש אוטומטית.", 5000); return; }
  toast("מתחבר מחדש לגוגל…", 3000); setTimeout(() => googleRedirect("none"), 400);
}
async function startGoogle() {
  state.api = new DriveApi({ onAuthNeeded });
  $("demoBanner").hidden = true;
  try { enterApp(await state.api.login()); }
  catch (e) {
    console.error(e);
    if (e.code === "auth") return;
    showLogin(); toast("לא הצלחתי להתחבר לגוגל דרייב. נסי שוב.", 4500);
  }
}
$("gLoginBtn").onclick = () => { lsSet("nb_mode", "google"); googleRedirect("select_account"); };
$("pwToggle").onclick = () => { $("loginForm").hidden = !$("loginForm").hidden; if (!$("loginForm").hidden) setTimeout(() => $("loginPassword").focus(), 30); };
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isGoogle() && tokenMinutesLeft() < 10 && !document.querySelector("dialog[open]")) googleRedirect("none");
});

async function boot() {
  const cfg = window.BAYIT_CONFIG || {};
  state.gid = (cfg.googleClientId || "").trim();
  $("gLoginBox").hidden = !state.gid;
  $("loginForm").hidden = !!state.gid;
  if (state.gid) {
    const back = takeAuthFromHash();
    if (back?.state) pendingHash = back.state;
    if (back?.error) {
      lsSet("nb_mode", "");
      showLogin();
      if (back.error !== "access_denied" && back.error !== "interaction_required" && back.error !== "login_required") toast("הכניסה עם גוגל לא הצליחה. נסי שוב.", 4500);
      return;
    }
    if (back?.ok || lsGet("nb_mode") === "google") {
      lsSet("nb_mode", "google");
      if (tokenMinutesLeft() > 2) return startGoogle();
      return googleRedirect("none");   // נגמר תוקף הכניסה: חידוש שקט, בלי ללחוץ שוב
    }
  }
  const url = (cfg.scriptUrl || "").trim();
  state.api = url ? new RemoteApi(url) : new DemoApi();
  $("demoBanner").hidden = !state.api.demo;
  const saved = lsGet("nb_k");
  if (saved && !state.api.demo) {
    try { return enterApp(await state.api.login(saved)); }
    catch (e) { if (e.code !== "bad-password") { showLogin(); return toast("אין חיבור לשרת. נסי שוב.", 4000); } lsSet("nb_k", ""); }
  }
  showLogin();
}
function showLogin() { $("appView").hidden = true; $("loginView").hidden = false; $("loginPassword").value = ""; setTimeout(() => $("loginPassword").focus(), 50); }
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("loginBtn"), err = $("loginError"); err.hidden = true; btn.disabled = true; btn.textContent = "נכנסת…";
  try {
    const k = await sha256Hex($("loginPassword").value);
    const data = await state.api.login(k);
    lsSet("nb_k", k);
    if (state.api.demo && !data.docs.length) { await seedDemo(); return enterApp(await state.api.login(k)); }
    enterApp(data);
  } catch (ex) {
    err.hidden = false;
    err.textContent = ex.code === "bad-password" ? "סיסמה שגויה" : ex.code === "too-many-attempts" ? "יותר מדי ניסיונות. נסי שוב בעוד 10 דקות." : "אין חיבור לשרת. בדקי אינטרנט ונסי שוב.";
  } finally { btn.disabled = false; btn.textContent = "כניסה"; }
});

function enterApp(data) {
  state.settings = data.settings || {};
  state.docs = (data.docs || []).filter(Boolean);
  $("loginView").hidden = true; $("appView").hidden = false;
  setView(state.view || "home", { replace: true });
  state.api.thumbs().then((t) => { state.thumbs = t || {}; render(); }).catch((e) => console.warn("thumbs", e));
  // קישור מהאקסל: #doc=… פותח את המסמך
  const m = (pendingHash || location.hash).match(/^#doc=(.+)$/); pendingHash = "";
  if (m) { history.replaceState(null, "", location.pathname + location.search); const d = docById(decodeURIComponent(m[1])); if (d) openViewer(d); }
  setTimeout(() => autoSort(false), 1500);
}

/* ======================= נתונים נגזרים ======================= */
const topics = () => {
  const base = state.settings.topics && state.settings.topics.length ? state.settings.topics : DEFAULT_TOPICS;
  const list = [...new Set([...DEFAULT_TOPICS, ...base])].filter((t) => !OLD_TOPICS.includes(t));
  state.docs.forEach((d) => { if (d.topic && !list.includes(d.topic)) list.push(d.topic); });
  return list;
};
// ביטוחים: גרים אצל הבעלים (דירה, רכב, אדם, נסיעה), והאריח "ביטוחים" מרכז את כולם
const isInsurance = (d) => d.topic === "ביטוחים" || /ביטוח/.test(d.sub || "");
function insKind(d) {
  if (d.topic === "ביטוחים") return d.folder || "ביטוח אחר";
  if (d.topic === "רכב") return "ביטוח רכב";
  if (d.topic === "דירה ונכס") return "ביטוח דירה";
  return d.sub || "ביטוח";
}
const people = () => state.settings.people || [];
const trips = () => (state.settings.trips || []).slice().sort((a, b) => (b.from || "").localeCompare(a.from || ""));
const tripById = (id) => (state.settings.trips || []).find((t) => t.id === id);
const docById = (id) => state.docs.find((d) => d.id === id);

// ארכיון: מה שתוקפו עבר, או שהוחלף במסמך חדש. לא נמחק, רק לא מעמיס על התיקייה
// הארכות ונספחים: מסמך שמאריך מסמך קיים (חוזה, אחריות, ביטוח). הנספח מוצג מתחת למסמך המקורי
const EXT_RE = /הארכ|נספח|חידוש החוזה|חידוש חוזה|תוספת לחוזה|addendum|extension/i;
const looksLikeExtension = (d) => EXT_RE.test(`${d.title || ""} ${d.details || ""} ${d.relevantReason || ""}`);
const appendicesOf = (d) => state.docs.filter((x) => x.extends === d.id);
const isAppendix = (d) => !!(d.extends && docById(d.extends));
function effectiveUntil(d) {
  let u = d.relevantUntil || "";
  for (const a of appendicesOf(d)) if ((a.relevantUntil || "") > u) u = a.relevantUntil;
  return u;
}
// ארכיון: מה שתוקפו עבר (כולל הארכות), או שהוחלף במסמך חדש. "עדיין בתוקף" (keepActive) גובר על הכול
function isArchived(d) {
  if (d.keepActive) return false;
  if (isAppendix(d)) return isArchived(docById(d.extends));
  if (d.archived || d.replacedBy) return true;
  const u = effectiveUntil(d);
  return !!u && u < today();
}
function folderOf(d) {
  if (d.folder) return d.folder;
  return ruleOf(d.topic).by === "person" && d.people?.length ? d.people[0] : "";
}
const subOf = (d) => d.sub || "";
const pathText = (d) => [topicShort(d.topic || ""), folderOf(d), subOf(d)].filter(Boolean).join(" › ");
function knownFolders() {
  const m = {};
  state.docs.forEach((d) => { const f = folderOf(d); if (f && d.topic) (m[d.topic] ||= new Set()).add(f); });
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]));
}
const plural = (n, one, many) => n === 1 ? one : `${n} ${many}`;
// גרסת הסידור: 2 = כל הביטוחים בתוך "ביטוחים", מחולקים לפי סוג ומה מבוטח

/* ----- קישורים: אותו דבר (דירה, רכב, אדם) בכמה נושאים ----- */
const ekey = (s) => norm(s).replace(/[·,.\-–()]/g, " ").replace(/\s+/g, " ").trim();
function sameEntity(a, b) {
  if (!a || !b) return false;
  const A = ekey(a), B = ekey(b);
  if (A && A === B) return true;
  const da = String(a).replace(/\D/g, ""), db = String(b).replace(/\D/g, "");
  if (da.length >= 5 && da === db) return true;   // אותו מספר רישוי
  const [s, l] = A.length <= B.length ? [A, B] : [B, A];
  const st = s.split(" "), lt = l.split(" ");
  return st.length >= 2 && st.every((t) => lt.includes(t));   // "הרצל 12" ו"הרצל 12, ראשון לציון"
}
// כל המקומות בארון: תיקייה בנושא רגיל, או "סוג › מה מבוטח" בביטוחים
function entityLocations() {
  const m = new Map();
  for (const d of state.docs) {
    if (isArchived(d)) continue;
    const f = folderOf(d); if (!f) continue;
    let key, loc;
    if (d.topic === "ביטוחים") {
      const s = subOf(d); if (!s) continue;
      key = `${d.topic}|${f}|${s}`; loc = { key, entity: s, nav: { topic: d.topic, folder: f, sub: s }, icon: "🛡️", label: `${f} › ${s}` };
    } else {
      key = `${d.topic}|${f}`; loc = { key, entity: f, nav: { topic: d.topic, folder: f }, icon: topicIcon(d.topic), label: `${topicShort(d.topic)} › ${f}` };
    }
    const cur = m.get(key) || { ...loc, count: 0 }; cur.count++; m.set(key, cur);
  }
  return [...m.values()];
}
function relatedLinks(entities, here) {
  if (!entities.length) return [];
  // לא מקשרים למקום שכבר נמצאים בו
  return entityLocations().filter((l) => !(l.nav.topic === here.topic && l.nav.folder === here.folder) && entities.some((e) => sameEntity(e, l.entity)))
    .sort((a, b) => (a.nav.topic === "ביטוחים") - (b.nav.topic === "ביטוחים") || a.label.localeCompare(b.label, "he")).slice(0, 8);
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[֑-ׇ]/g, "").replace(/["'״׳`]/g, "").replace(/\s+/g, " ");
function haystack(d) {
  if (d._h) return d._h;
  const t = tripById(d.tripId);
  d._h = norm([d.title, d.topic, d.folder, d.sub, (d.people || []).join(" "), d.provider, d.details, d.note, d.fullText, d.relevantReason,
    t ? t.name : "", d.date, fmtDate(d.date), d.relevantUntil, fmtDate(d.relevantUntil), d.amount != null ? String(d.amount) : ""].join(" "));
  return d._h;
}
function matches(d, q) {
  const h = haystack(d);
  return norm(q).split(" ").filter(Boolean).every((tok) => {
    if (h.includes(tok)) return true;
    const n = parseFloat(tok.replace(/[₪,]/g, ""));
    return Number.isFinite(n) && /^[\d.,₪]+$/.test(tok) && d.amount != null && Math.trunc(d.amount) === Math.trunc(n);
  });
}

function validity(d) {
  const u = effectiveUntil(d);
  if (!u) return d.keepActive ? { cls: "tag-valid", text: "בתוקף" } : null;
  const why = u !== d.relevantUntil ? "הוארך עד" : (d.relevantReason || "בתוקף עד");
  const n = daysUntil(u);
  if (n < 0) return d.keepActive ? { cls: "tag-valid", text: "סומן כבתוקף" } : { cls: "tag-old", text: `${d.relevantReason || "רלוונטי עד"} ${fmtDate(u)} (עבר)` };
  if (n <= REMIND_AHEAD_DAYS) return { cls: "tag-soon", text: `${why} ${fmtDate(u)}` };
  return { cls: "tag-valid", text: `${why} ${fmtDate(u)}` };
}

// תזכורות: מסמכים שתוקפם מתקרב, ונסיעות קרובות (כולל בדיקת דרכונים)
function reminders() {
  const out = [];
  for (const d of state.docs) {
    if (!d.relevantUntil || d.noRemind || d.replacedBy || d.archived || isAppendix(d)) continue;
    const ru = effectiveUntil(d), n = daysUntil(ru);
    if (n > REMIND_AHEAD_DAYS || n < -14 || (d.keepActive && n < 0)) continue;
    const reason = ru !== d.relevantUntil ? "סוף ההארכה" : (d.relevantReason || "בתוקף עד");
    out.push({ key: `d:${d.id}:${ru}`, ico: topicIcon(d.topic), days: n, docId: d.id, title: d.title || "מסמך",
      sub: n < 0 ? `${reason}: עבר לפני ${-n} ימים (${fmtDate(ru)})` : n === 0 ? `${reason}: היום` : `${reason}: בעוד ${n} ימים (${fmtDate(ru)})`,
      cal: { title: `${reason}: ${d.title || "מסמך"}`, date: n > 30 ? addDays(ru, -30) : today(), details: `${reason} ב-${fmtDate(ru)}. מתוך ניירת בית.` } });
  }
  // "הזכר לי" שהוגדר במסמך: מופיע מ-7 ימים לפני
  for (const d of state.docs) {
    if (!d.remindAt) continue;
    const n = daysUntil(d.remindAt);
    if (n > 7 || n < -30) continue;
    const what = d.remindText || d.title || "מסמך";
    out.push({ key: `r:${d.id}:${d.remindAt}`, ico: "🔔", days: n, docId: d.id, title: what,
      sub: `${n < 0 ? `תזכורת מ-${fmtDate(d.remindAt)}` : n === 0 ? "תזכורת להיום" : `תזכורת בעוד ${n} ימים (${fmtDate(d.remindAt)})`}${d.remindText ? ` · ${d.title || ""}` : ""}`,
      cal: { title: what, date: n > 0 ? d.remindAt : today(), details: `${d.title || ""}. מתוך ניירת בית.` } });
  }
  for (const t of state.settings.trips || []) {
    if (!t.from) continue;
    const n = daysUntil(t.from);
    if (n < 0 || n > REMIND_AHEAD_DAYS) continue;
    out.push({ key: `t:${t.id}:${t.from}`, ico: "✈️", days: n, tripId: t.id, title: `נסיעה: ${t.name}`, sub: `${n === 0 ? "היום" : `בעוד ${n} ימים`} · לבדוק שהדרכונים בתוקף (לפחות חצי שנה)`,
      cal: { title: `לבדוק דרכונים לפני ${t.name}`, date: n > 14 ? addDays(t.from, -14) : today(), details: `הנסיעה מתחילה ב-${fmtDate(t.from)}. דרכון צריך להיות בתוקף לפחות חצי שנה מיום החזרה.` } });
    const end = t.to || t.from;
    for (const d of state.docs) {
      if (!d.relevantUntil || d.replacedBy || !/דרכון/.test(`${d.title} ${d.relevantReason} ${d.details}`)) continue;
      if (d.relevantUntil < addDays(end, 183)) {
        out.push({ key: `p:${d.id}:${t.id}`, ico: "⚠️", days: n - 0.5, docId: d.id, title: `דרכון${d.people?.length ? " של " + d.people.join(", ") : ""}`,
          sub: `בתוקף עד ${fmtDate(d.relevantUntil)}, פחות מחצי שנה אחרי הנסיעה ל${t.name}`,
          cal: { title: `לחדש דרכון${d.people?.length ? " – " + d.people.join(", ") : ""}`, date: today(), details: `הדרכון בתוקף עד ${fmtDate(d.relevantUntil)}. נסיעה ל${t.name} ב-${fmtDate(t.from)}.` } });
      }
    }
  }
  const dismissed = new Set(state.settings.dismissed || []);
  return out.filter((r) => !dismissed.has(r.key)).sort((a, b) => a.days - b.days);
}
// "סידור הארון": מה שתוקפו נגמר לפני יותר מחצי שנה, או שהוחלף במסמך חדש
const tidyCandidates = () => state.docs.filter((d) => !d.keep && !d.keepActive && !isAppendix(d) && (d.replacedBy || (effectiveUntil(d) && daysUntil(effectiveUntil(d)) < -CLEAN_AFTER_DAYS)));
function calUrl({ title, date, details }) {
  const a = date.replace(/-/g, ""), b = addDays(date, 1).replace(/-/g, "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${a}/${b}&details=${encodeURIComponent(details || "")}`;
}

/* ======================= תצוגות ======================= */
// כל מעבר מסך נכנס להיסטוריה, כך שהחלקה אחורה באייפון / כפתור "חזרה" עובדים כמו באפליקציה
function setView(v, opts = {}) {
  state.view = v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === (v === "browse" || v === "trips" ? "home" : v)));
  ["home", "browse", "docs", "trips", "settings"].forEach((k) => ($(k + "View").hidden = k !== v));
  const st = { view: v, nav: { ...state.nav }, tripOpen: state.tripOpen, archOpen: state.archOpen };
  try { if (opts.replace) history.replaceState(st, ""); else if (!opts.fromHistory) history.pushState(st, ""); } catch {}
  if (!opts.keepScroll) window.scrollTo(0, 0);
  render();
}
window.addEventListener("popstate", (e) => {
  const st = e.state; if (!st || $("appView").hidden) return;
  if (document.querySelector("dialog[open]")) { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); }
  state.nav = { ...st.nav }; state.tripOpen = st.tripOpen || null; state.archOpen = !!st.archOpen;
  setView(st.view, { fromHistory: true });
});
function go(nav) { state.nav = { topic: null, folder: null, sub: null, more: false, ...nav }; state.archOpen = false; setView("browse"); }
$("tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".tab"); if (!t) return;
  if (t.dataset.view === "docs") { resetFilters(); }
  setView(t.dataset.view);
});
function render() {
  if (state.view === "home") renderHome();
  else if (state.view === "browse") renderBrowse();
  else if (state.view === "docs") renderDocs();
  else if (state.view === "trips") renderTrips();
  else if (state.view === "settings") renderSettings();
}

function docCard(d, opts = {}) {
  const v = validity(d), t = tripById(d.tripId), th = state.thumbs[d.id], arch = isArchived(d);
  const path = opts.path === false ? (opts.sub && subOf(d) ? subOf(d) : "") : pathText(d);
  const ppl = (d.people || []).filter((p) => p !== folderOf(d));
  const apps = appendicesOf(d);
  const card = `<button type="button" class="doc-card${arch ? " is-arch" : ""}" data-doc="${d.id}">
    ${th ? `<img class="thumb" src="${th}" alt="">` : `<span class="thumb"></span>`}
    <span class="d-main">
      <span class="d-title">${esc(d.title || "מסמך")}</span>
      ${path ? `<span class="d-path">${opts.path === false ? folderIcon(d.topic, path) : topicIcon(d.topic)} ${esc(path)}</span>` : ""}
      <span class="d-meta">${d.date ? `<span>${fmtDate(d.date)}</span>` : ""}${d.provider ? `<span>· ${esc(d.provider)}</span>` : ""}${ppl.map((p) => `<span class="tag tag-person">${esc(p)}</span>`).join("")}</span>
      ${v || t || d.replacedBy ? `<span class="d-meta">${d.replacedBy ? `<span class="tag tag-old">הוחלף במסמך חדש</span>` : v ? `<span class="tag ${v.cls}">${esc(v.text)}</span>` : ""}${t ? `<span class="tag tag-trip">✈️ ${esc(t.name)}</span>` : ""}</span>` : ""}
    </span>
    ${d.amount != null ? `<span class="d-amt">₪${fmtMoney(d.amount)}</span>` : ""}
  </button>`;
  if (!apps.length) return card;
  // הנספח מוצג כמסמך רגיל (עם תמונה), מתחת למסמך המקורי, עם הערה קטנה
  return `<div class="doc-group">${card}${apps.map((a) => `<div class="app-note">📎 נספח / הארכה של המסמך הזה</div>${docCard(a, { path: false })}`).join("")}</div>`;
}
document.addEventListener("click", (e) => { const c = e.target.closest("[data-doc]"); if (c && !e.target.closest("dialog")) openViewer(docById(c.dataset.doc)); });

/* ----- מסך הבית: חיפוש, "דורש תשומת לב", אריחים ----- */
const tidyDue = () => { const n = tidyCandidates().length, last = state.settings.lastTidy; return n && (!last || daysUntil(last) <= -30) ? n : 0; };
function renderHome() {
  const rem = reminders(), tidy = tidyDue();
  const shown = state.attnAll ? rem : rem.slice(0, 3);
  $("attnBox").hidden = !rem.length && !tidy;
  $("attnList").innerHTML = shown.map((r) => `<li class="attn-item${r.days <= 14 ? " is-soon" : ""}" data-open="${r.docId ? "d:" + r.docId : "t:" + r.tripId}">
      <span class="a-dot" aria-hidden="true"></span>
      <span class="a-main"><b>${esc(r.title)}</b><small>${esc(r.sub)}</small></span>
      <a class="a-btn" href="${calUrl(r.cal)}" target="_blank" rel="noopener" title="הוספה ליומן" aria-label="הוספה ליומן">📅</a>
      <button type="button" class="a-btn" data-dismiss="${esc(r.key)}" title="טופל, להסיר" aria-label="טופל">✓</button>
    </li>`).join("") + (tidy ? `<li class="attn-item is-tidy" data-open="tidy"><span class="a-ico" aria-hidden="true">🧹</span><span class="a-main"><b>סידור הארון</b><small>${plural(tidy, "מסמך ישן אחד שאפשר למחוק", "מסמכים ישנים שאפשר למחוק")}</small></span><span class="a-go">‹</span></li>` : "");
  $("attnMore").hidden = rem.length <= 3;
  $("attnMore").textContent = state.attnAll ? "פחות" : `עוד ${rem.length - 3} ${rem.length - 3 === 1 ? "תזכורת" : "תזכורות"}`;

  const all = topics(), prim = PRIMARY.filter((t) => all.includes(t)), rest = all.filter((t) => !prim.includes(t));
  const tile = (t) => {
    const inT = (d) => t === "ביטוחים" ? isInsurance(d) : d.topic === t;
    const soon = state.docs.some((d) => inT(d) && !isArchived(d) && d.relevantUntil && daysUntil(d.relevantUntil) <= REMIND_AHEAD_DAYS);
    const has = state.docs.some(inT) || (t === "נסיעות" && (state.settings.trips || []).length);
    return `<button type="button" class="tile${has ? "" : " is-empty"}" data-topic="${esc(t)}">${soon ? `<span class="t-dot" title="משהו מסתיים בקרוב"></span>` : ""}<span class="t-ico" style="--tint:${tint(t)}">${topicIcon(t)}</span><span class="t-name">${esc(topicShort(t))}</span><span class="t-sub">${esc(tileSub(t))}</span></button>`;
  };
  const restCount = state.docs.filter((d) => rest.includes(d.topic)).length;
  $("tileGrid").innerHTML = prim.map(tile).join("") + (rest.length ? `<button type="button" class="tile" data-more="1"><span class="t-ico" style="--tint:#F1F4F6">📦</span><span class="t-name">עוד</span><span class="t-sub">${esc(rest.map(topicShort).join(", "))}</span></button>` : "");
  $("homeEmpty").hidden = state.docs.length > 0;
}
function tileSub(t) {
  if (t === "ביטוחים") { const n = state.docs.filter((d) => isInsurance(d) && !isArchived(d)).length; return n ? plural(n, "פוליסה אחת בתוקף", "פוליסות בתוקף") : "אין עדיין"; }
  const docs = state.docs.filter((d) => d.topic === t), act = docs.filter((d) => !isArchived(d));
  if (t === "נסיעות") {
    const next = (state.settings.trips || []).filter((x) => (x.to || x.from || "") >= today()).sort((a, b) => (a.from || "").localeCompare(b.from || ""))[0];
    if (next) return `קרובה: ${next.name.split(",")[0]}`;
    const n = (state.settings.trips || []).length; return n ? plural(n, "נסיעה אחת", "נסיעות") : "אין עדיין";
  }
  if (!docs.length) return "אין עדיין";
  const fs = new Set(act.map(folderOf).filter(Boolean)).size;
  if (t === "רכב" && fs) return plural(fs, "רכב אחד", "רכבים");
  if (ruleOf(t).by === "person" && fs) return plural(fs, "אדם אחד", "אנשים");
  if (t === "אחריות ומוצרים") return plural(act.length, "מוצר אחד בתוקף", "מוצרים בתוקף");
  if (t === "ביטוחים") { const n = state.docs.filter((d) => isInsurance(d) && !isArchived(d)).length; return n ? plural(n, "פוליסה אחת בתוקף", "פוליסות בתוקף") : "אין עדיין"; }
  if (t === "דירה ונכס" && fs) return plural(fs, "דירה אחת", "דירות");
  return act.length ? plural(act.length, "מסמך אחד", "מסמכים") : "רק בארכיון";
}
$("tileGrid").addEventListener("click", (e) => {
  const c = e.target.closest("[data-topic],[data-more]"); if (!c) return;
  if (c.dataset.more) return go({ more: true });
  if (c.dataset.topic === "נסיעות") { state.tripOpen = null; return setView("trips"); }
  go({ topic: c.dataset.topic });
});
$("homeSearchForm").addEventListener("submit", (e) => { e.preventDefault(); resetFilters(); $("qText").value = $("homeSearch").value; $("homeSearch").value = ""; setView("docs"); });
$("attnMore").onclick = () => { state.attnAll = !state.attnAll; renderHome(); };
$("attnList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-dismiss]");
  if (b) {
    b.closest("li").remove();
    await saveSettings({ dismissed: [...(state.settings.dismissed || []), b.dataset.dismiss].slice(-400) });
    toast("התזכורת הוסרה"); renderHome(); return;
  }
  if (e.target.closest("a")) return;
  const li = e.target.closest("[data-open]"); if (!li) return;
  const o = li.dataset.open;
  if (o === "tidy") return openCleanup();
  if (o.startsWith("d:")) return openViewer(docById(o.slice(2)));
  if (o.startsWith("t:")) { state.tripOpen = o.slice(2); setView("trips"); }
});
document.addEventListener("click", (e) => { const t = e.target.closest("[data-trip]"); if (t && !e.target.closest("dialog")) { state.tripOpen = t.dataset.trip; setView("trips"); } });

/* ----- תיקיות: נושא → תיקייה → בתוך התיקייה ----- */
function groupStatus(docs) {
  const act = docs.filter((d) => !isArchived(d));
  const count = act.length ? plural(act.length, "מסמך אחד", "מסמכים") : `רק בארכיון (${docs.length})`;
  const dated = act.filter((d) => effectiveUntil(d) && !(d.keepActive && effectiveUntil(d) < today())).sort((a, b) => effectiveUntil(a).localeCompare(effectiveUntil(b)));
  if (dated.length) {
    const d = dated[0], u = effectiveUntil(d), n = daysUntil(u), why = u !== d.relevantUntil ? "הוארך עד" : (d.relevantReason || "בתוקף עד");
    if (n <= REMIND_AHEAD_DAYS) return { count, cls: "st-warn", text: `${why}: ${n === 0 ? "היום" : `בעוד ${n} ימים`}` };
    if (dated.length === 1) return { count, cls: "st-ok", text: `${why} ${fmtDate(u)}` };
    return { count, cls: "st-ok", text: "הכול בתוקף" };
  }
  const last = act.map((d) => d.date || "").filter(Boolean).sort().pop();
  return { count, cls: "", text: last ? `אחרון ${last.slice(5, 7)}/${last.slice(0, 4)}` : "" };
}
function foldCard(topic, name, docs, attrs) {
  const st = groupStatus(docs);
  return `<button type="button" class="fold" ${attrs}><span class="f-ico" style="--tint:${tint(topic)}">${folderIcon(topic, name)}</span><span class="f-main"><b>${esc(name)}</b><small>${esc(st.count)}${st.text ? ` · <span class="${st.cls}">${esc(st.text)}</span>` : ""}</small></span><span class="f-go" aria-hidden="true">‹</span></button>`;
}
const sortDocs = (list) => list.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
function renderBrowse() {
  const { topic, folder, sub, more } = state.nav;
  // שביל ניווט
  const crumbs = [`<button type="button" class="crumb" data-crumb="home">בית</button>`];
  if (more) crumbs.push(`<span class="crumb is-here">עוד</span>`);
  if (topic) crumbs.push(folder != null ? `<button type="button" class="crumb" data-crumb="topic">${esc(topicShort(topic))}</button>` : `<span class="crumb is-here">${esc(topicShort(topic))}</span>`);
  if (folder != null) crumbs.push(sub != null ? `<button type="button" class="crumb" data-crumb="folder">${esc(folder)}</button>` : `<span class="crumb is-here">${esc(folder)}</span>`);
  if (sub != null) crumbs.push(`<span class="crumb is-here">${esc(sub)}</span>`);
  $("crumbs").innerHTML = crumbs.join(`<span class="crumb-sep">‹</span>`);
  $("browseRename").hidden = folder == null && sub == null;
  $("browseExcel").hidden = !!more;

  if (more) {
    const rest = topics().filter((t) => !PRIMARY.includes(t));
    $("browseTitle").innerHTML = `📦 עוד נושאים`;
    $("foldList").innerHTML = rest.map((t) => { const docs = state.docs.filter((d) => d.topic === t); return `<button type="button" class="fold" data-gotopic="${esc(t)}"><span class="f-ico" style="--tint:${tint(t)}">${topicIcon(t)}</span><span class="f-main"><b>${esc(topicShort(t))}</b><small>${docs.length ? esc(groupStatus(docs).count) : "אין עדיין"}</small></span><span class="f-go" aria-hidden="true">‹</span></button>`; }).join("");
    $("foldList").hidden = !rest.length;
    ["looseTitle", "looseList", "archToggle", "archList", "browseEmpty", "linkBox"].forEach((id) => ($(id).hidden = true));
    return;
  }
  if (topic === "ביטוחים") return renderInsurance();
  const level = sub != null ? 3 : folder != null ? 2 : 1;
  $("browseTitle").innerHTML = `${level === 1 ? topicIcon(topic) : folderIcon(topic, level === 2 ? folder : sub)} ${esc(level === 1 ? topicShort(topic) : level === 2 ? folder : sub)}`;
  const inHere = state.docs.filter((d) => !isAppendix(d) && d.topic === topic && (folder == null || folderOf(d) === folder) && (sub == null || subOf(d) === sub));
  const act = inHere.filter((d) => !isArchived(d)), arch = inHere.filter(isArchived);
  // קבוצות: ברמת הנושא לפי תיקייה, בתוך תיקייה לפי "סוג"
  const keyOf = level === 1 ? folderOf : level === 2 ? subOf : () => "";
  const groups = new Map();
  inHere.forEach((d) => { const k = keyOf(d); if (k) (groups.get(k) || groups.set(k, []).get(k)).push(d); });
  // תיקייה עם מעט מסמכים וסוג אחד בלבד: מראים ישר את המסמכים, בלי עוד שכבה
  const flat = level === 2 && (groups.size <= 1 || inHere.length <= 3);
  // תיקייה שכל המסמכים בה כבר בארכיון לא מוצגת כאן (היא בארכיון למטה)
  const groupList = flat ? [] : [...groups.entries()].filter(([, docs]) => docs.some((d) => !isArchived(d))).sort((a, b) => {
    const aa = a[1].some((d) => !isArchived(d)), bb = b[1].some((d) => !isArchived(d));
    return (bb - aa) || a[0].localeCompare(b[0], "he");
  });
  const attr = (k) => level === 1 ? `data-gofolder="${esc(k)}"` : `data-gosub="${esc(k)}"`;
  $("foldList").innerHTML = groupList.map(([k, docs]) => foldCard(topic, k, docs, attr(k))).join("");
  $("foldList").hidden = !groupList.length;
  const loose = sortDocs(act.filter((d) => flat || !keyOf(d)));
  $("looseList").innerHTML = loose.map((d) => docCard(d, { path: false, sub: level === 2 })).join("");
  $("looseList").hidden = !loose.length;
  $("looseTitle").hidden = !loose.length || !groupList.length;
  $("looseTitle").textContent = level === 1 ? "בלי תיקייה" : "מסמכים";
  // 🔗 קשור: הביטוח של הדירה / הרכב, ומהביטוח חזרה לדירה / לרכב / לאדם
  const isIns = topic === "ביטוחים";
  const entities = level === 1 ? [] : isIns ? (level === 3 ? [sub] : flat ? [...new Set(act.map(subOf).filter(Boolean))] : []) : [folder];
  const links = relatedLinks(entities, { topic, folder });
  const tripIds = [...new Set(act.map((d) => d.tripId).filter((id) => id && tripById(id)))];
  $("linkBox").hidden = !links.length && !tripIds.length;
  $("linkList").innerHTML = links.map((l) => `<button type="button" class="link-card" data-link="${esc(JSON.stringify(l.nav))}"><span class="l-ico">${l.icon}</span><span class="l-main"><b>${esc(l.label)}</b><small>${plural(l.count, "מסמך אחד", "מסמכים")}</small></span><span class="f-go" aria-hidden="true">‹</span></button>`).join("")
    + tripIds.map((id) => { const t = tripById(id); return `<button type="button" class="link-card" data-trip="${id}"><span class="l-ico">✈️</span><span class="l-main"><b>נסיעה: ${esc(t.name)}</b><small>${fmtDate(t.from)}</small></span><span class="f-go" aria-hidden="true">‹</span></button>`; }).join("");
  $("archToggle").hidden = !arch.length;
  $("archToggle").textContent = `🗄 ארכיון (${plural(arch.length, "מסמך ישן אחד", "מסמכים ישנים")}) ${state.archOpen ? "▴" : "▾"}`;
  $("archList").hidden = !state.archOpen || !arch.length;
  $("archList").innerHTML = state.archOpen ? sortDocs(arch.slice()).map((d) => docCard(d, { path: level < 3 })).join("") : "";
  $("browseEmpty").hidden = inHere.length > 0;
}
// 🛡️ ביטוחים: כל הביטוחים מכל המקומות, לפי סוג. כל ביטוח גר אצל הבעלים שלו (דירה, רכב, אדם, נסיעה)
function renderInsurance() {
  const kind = state.nav.folder;
  const all = state.docs.filter((d) => isInsurance(d) && !isAppendix(d)), act = all.filter((d) => !isArchived(d)), arch = all.filter(isArchived);
  $("browseRename").hidden = true; $("browseExcel").hidden = !all.length;
  $("browseTitle").innerHTML = `🛡️ ${esc(kind || "ביטוחים")}`;
  $("linkBox").hidden = true;
  if (kind == null) {
    const groups = new Map();
    act.forEach((d) => { const k = insKind(d); (groups.get(k) || groups.set(k, []).get(k)).push(d); });
    $("foldList").innerHTML = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], "he")).map(([k, docs]) => foldCard("ביטוחים", k, docs, `data-gofolder="${esc(k)}"`)).join("");
    $("foldList").hidden = !groups.size;
    $("looseList").hidden = $("looseTitle").hidden = true;
  } else {
    const list = sortDocs(act.filter((d) => insKind(d) === kind));
    $("foldList").hidden = true;
    $("looseTitle").hidden = true;
    $("looseList").hidden = !list.length;
    // מתחת לכל ביטוח: קישור ישיר לבעלים שלו (הדירה, הרכב, האדם, הנסיעה)
    const ownerLink = (d) => {
      const f = folderOf(d), t = tripById(d.tripId);
      if (d.topic !== "ביטוחים" && d.topic !== "נסיעות" && f) return `<button type="button" class="owner-link" data-link="${esc(JSON.stringify({ topic: d.topic, folder: f }))}">${topicIcon(d.topic)} לכל המסמכים של ${esc(f)} <span aria-hidden="true">‹</span></button>`;
      if (t) return `<button type="button" class="owner-link" data-trip="${t.id}">✈️ לכל המסמכים של הנסיעה ${esc(t.name)} <span aria-hidden="true">‹</span></button>`;
      return "";
    };
    $("looseList").innerHTML = list.map((d) => `<div class="doc-with-link">${docCard(d)}${ownerLink(d)}</div>`).join("");
    $("linkBox").hidden = true;
  }
  const archHere = kind == null ? arch : arch.filter((d) => insKind(d) === kind);
  $("archToggle").hidden = !archHere.length;
  $("archToggle").textContent = `🗄 ארכיון (${plural(archHere.length, "פוליסה ישנה אחת", "פוליסות ישנות")}) ${state.archOpen ? "▴" : "▾"}`;
  $("archList").hidden = !state.archOpen || !archHere.length;
  $("archList").innerHTML = state.archOpen ? sortDocs(archHere.slice()).map((d) => docCard(d)).join("") : "";
  $("browseEmpty").hidden = all.length > 0;
}
$("browseView").addEventListener("click", (e) => {
  const lk = e.target.closest("[data-link]"); if (lk) { try { return go(JSON.parse(lk.dataset.link)); } catch { return; } }
  const c = e.target.closest("[data-crumb],[data-gotopic],[data-gofolder],[data-gosub]"); if (!c) return;
  const n = state.nav;
  if (c.dataset.crumb === "home") return setView("home");
  if (c.dataset.crumb === "topic") return go({ topic: n.topic });
  if (c.dataset.crumb === "folder") return go({ topic: n.topic, folder: n.folder });
  if (c.dataset.gotopic) return c.dataset.gotopic === "נסיעות" ? (state.tripOpen = null, setView("trips")) : go({ topic: c.dataset.gotopic });
  if (c.dataset.gofolder != null) return go({ topic: n.topic, folder: c.dataset.gofolder });
  if (c.dataset.gosub != null) return go({ topic: n.topic, folder: n.folder, sub: c.dataset.gosub });
});
$("archToggle").onclick = () => { state.archOpen = !state.archOpen; try { history.replaceState({ ...history.state, archOpen: state.archOpen }, ""); } catch {} renderBrowse(); };
$("browseExcel").onclick = () => {
  const { topic, folder, sub } = state.nav;
  const docs = topic === "ביטוחים" ? state.docs.filter((d) => isInsurance(d) && (folder == null || insKind(d) === folder))
    : state.docs.filter((d) => d.topic === topic && (folder == null || folderOf(d) === folder) && (sub == null || subOf(d) === sub));
  if (!docs.length) return toast("אין כאן מסמכים");
  runExcel(docs, [topic, folder, sub].filter((x) => x != null).join(" › "));
};
// שינוי שם של תיקייה (או איחוד עם תיקייה קיימת)
$("browseRename").onclick = () => {
  const { sub, folder } = state.nav;
  $("rnName").value = sub != null ? sub : folder;
  $("rnTitle").textContent = sub != null ? "שינוי שם" : "שינוי שם התיקייה";
  $("rnList").innerHTML = (sub != null ? [...new Set(state.docs.filter((d) => d.topic === state.nav.topic).map(subOf).filter(Boolean))] : (knownFolders()[state.nav.topic] || [])).map((x) => `<option value="${esc(x)}">`).join("");
  $("renameDlg").showModal(); setTimeout(() => $("rnName").select(), 30);
};
$("rnSave").onclick = async () => {
  const name = $("rnName").value.replace(/\s+/g, " ").trim(); if (!name) return toast("חסר שם");
  const { topic, folder, sub } = state.nav;
  const list = state.docs.filter((d) => d.topic === topic && folderOf(d) === folder && (sub == null || subOf(d) === sub));
  $("rnSave").disabled = true;
  try {
    for (const d of list) { const patch = sub != null ? { sub: name } : { folder: name }; await state.api.saveDoc({ id: d.id, ...patch }); Object.assign(d, patch); delete d._h; }
    $("renameDlg").close(); toast("השם עודכן");
    state.nav = sub != null ? { ...state.nav, sub: name } : { ...state.nav, folder: name };
    try { history.replaceState({ ...history.state, nav: { ...state.nav } }, ""); } catch {}
    renderBrowse();
  } catch (e) { console.error(e); toast("השמירה נכשלה, נסי שוב", 4000); }
  finally { $("rnSave").disabled = false; }
};

/* ----- חיפוש ----- */
function resetFilters() { ["qText", "qFrom", "qTo"].forEach((id) => ($(id).value = "")); $("qTopic").value = ""; $("qPerson").value = ""; $("qTopic").dataset.want = ""; }
function renderDocs() {
  const sel = (el, list, all) => { const want = el.dataset.want || el.value; el.innerHTML = `<option value="">${all}</option>` + list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join(""); el.value = list.includes(want) ? want : ""; el.dataset.want = ""; };
  sel($("qTopic"), topics(), "כל הנושאים");
  sel($("qPerson"), people(), "כל האנשים");
  const q = $("qText").value.trim(), tp = $("qTopic").value, pr = $("qPerson").value, from = $("qFrom").value, to = $("qTo").value;
  const any = q || tp || pr || from || to;
  $("qFilterBtn").classList.toggle("is-on", !!(tp || pr || from || to));
  if (!any) {
    // בלי חיפוש: מה שנוסף בשבועיים האחרונים
    const since = Date.now() - 14 * 86400000;
    const recent = state.docs.filter((d) => (d.createdAt || 0) >= since).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12);
    $("resultCount").textContent = recent.length ? "נוספו לאחרונה" : "כתבי מה לחפש: שם, רופא, מוצר, מספר פוליסה, מילה מתוך המסמך…";
    $("docList").innerHTML = recent.map((d) => docCard(d)).join("");
    return;
  }
  const rows = sortDocs(state.docs.filter((d) => (!tp || d.topic === tp) && (!pr || (d.people || []).includes(pr) || folderOf(d) === pr) && (!from || (d.date || "") >= from) && (!to || (d.date || "") <= to) && (!q || matches(d, q))));
  // בתוקף קודם, ארכיון בסוף
  rows.sort((a, b) => isArchived(a) - isArchived(b));
  $("resultCount").textContent = rows.length === 1 ? "נמצא מסמך אחד" : rows.length ? `נמצאו ${rows.length} מסמכים` : "לא נמצאו מסמכים שמתאימים לחיפוש";
  $("docList").innerHTML = rows.map((d) => docCard(d)).join("");
}
let qT; $("qText").addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(renderDocs, 250); });
["qTopic", "qPerson", "qFrom", "qTo"].forEach((id) => $(id).addEventListener("change", renderDocs));
$("qClear").onclick = () => { resetFilters(); renderDocs(); };
$("qFilterBtn").onclick = () => { $("qFilters").hidden = !$("qFilters").hidden; };

/* ======================= נסיעות ======================= */
function renderTrips() {
  const open = state.tripOpen && tripById(state.tripOpen);
  $("tripCrumbs").innerHTML = `<button type="button" class="crumb" data-crumb="home">בית</button><span class="crumb-sep">‹</span>${open ? `<button type="button" class="crumb" data-crumb="trips">נסיעות</button><span class="crumb-sep">‹</span><span class="crumb is-here">${esc(open.name)}</span>` : `<span class="crumb is-here">נסיעות</span>`}`;
  $("tripList").hidden = !!open; $("tripDetail").hidden = !open; $("tripNew").hidden = !!open;
  if (open) {
    const docs = state.docs.filter((d) => d.tripId === open.id).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    $("tripHead").innerHTML = `<div><h2>✈️ ${esc(open.name)}</h2><span class="hint">${fmtDate(open.from)}${open.to && open.to !== open.from ? " – " + fmtDate(open.to) : ""} · ${docs.length === 1 ? "מסמך אחד" : `${docs.length} מסמכים`}</span></div><button class="btn btn-ghost btn-sm" id="tripEdit">עריכה</button>`;
    const kinds = [...new Set(docs.map(subOf))];
    $("tripDocs").innerHTML = !docs.length ? `<div class="empty"><p>עוד אין מסמכים בנסיעה הזו.</p></div>`
      : kinds.length > 1 ? kinds.map((k) => `<h3 class="sub-head">${folderIcon("נסיעות", k || "אחר")} ${esc(k || "אחר")}</h3>` + docs.filter((d) => subOf(d) === k).map((d) => docCard(d, { path: false })).join("")).join("")
      : docs.map((d) => docCard(d, { path: false, sub: true })).join("");
    $("tripEdit").onclick = () => openTripDlg(open);
    return;
  }
  const list = trips();
  $("tripList").innerHTML = list.length ? list.map((t) => {
    const n = state.docs.filter((d) => d.tripId === t.id).length, past = (t.to || t.from || "") < today();
    return `<button type="button" class="trip-card${past ? " is-past" : ""}" data-trip="${t.id}"><span class="tr-name">✈️ ${esc(t.name)}</span><span class="tr-dates">${fmtDate(t.from)}${t.to && t.to !== t.from ? " – " + fmtDate(t.to) : ""}</span><span class="hint">${n === 1 ? "מסמך אחד" : `${n} מסמכים`}</span></button>`;
  }).join("") : `<div class="empty"><p>עוד אין נסיעות. כשמעלים כרטיס טיסה, הזמנת מלון או ביטוח נסיעות, המערכת יוצרת נסיעה לבד.</p></div>`;
}
$("tripBack").onclick = () => { state.tripOpen = null; setView("trips"); };
$("tripCrumbs").addEventListener("click", (e) => { const c = e.target.closest("[data-crumb]"); if (!c) return; if (c.dataset.crumb === "home") setView("home"); else { state.tripOpen = null; setView("trips"); } });
$("tripNew").onclick = () => openTripDlg(null);
let tripEditing = null;
function openTripDlg(t) {
  tripEditing = t;
  $("tdTitle").textContent = t ? "עריכת נסיעה" : "נסיעה חדשה";
  $("tdName").value = t?.name || ""; $("tdFrom").value = t?.from || ""; $("tdTo").value = t?.to || "";
  $("tdDelete").hidden = !t;
  $("tripDlg").showModal();
}
$("tdSave").onclick = async () => {
  const name = $("tdName").value.trim(); if (!name) return toast("חסר שם לנסיעה");
  const list = (state.settings.trips || []).slice();
  const t = tripEditing ? list.find((x) => x.id === tripEditing.id) : { id: "t" + Date.now().toString(36) };
  Object.assign(t, { name, from: $("tdFrom").value, to: $("tdTo").value || $("tdFrom").value });
  if (!tripEditing) list.push(t);
  await saveSettings({ trips: list });
  state.docs.forEach((d) => delete d._h);
  $("tripDlg").close(); state.tripOpen = t.id; renderTrips();
};
$("tdDelete").onclick = async () => {
  if (!(await confirmBox("למחוק את הנסיעה? המסמכים עצמם לא יימחקו, רק יוצאו מהתיק.", "מחק נסיעה"))) return;
  await saveSettings({ trips: (state.settings.trips || []).filter((x) => x.id !== tripEditing.id) });
  $("tripDlg").close(); state.tripOpen = null; renderTrips();
};

/* ======================= הגדרות ======================= */
async function saveSettings(patch) {
  Object.assign(state.settings, patch);
  try { state.settings = { ...state.settings, ...(await state.api.saveSettings(patch)) }; }
  catch (e) { console.error(e); toast("השמירה נכשלה, נסי שוב", 4000); }
}
function renderSettings() {
  $("sPwPanel").hidden = isGoogle();
  $("sLogoutHint").textContent = isGoogle() ? `מחובר עם גוגל${googleEmail() ? ": " + googleEmail() : ""}. המסמכים נשמרים בדרייב שלך, בתיקייה "ניירת בית".` : "המכשיר זוכר את הכניסה. כדי שבפעם הבאה תידרש סיסמה, לחצי יציאה.";
  $("sKey").value = state.settings.geminiKey || "";
  $("sPeople").innerHTML = people().map((p, i) => `<li>${esc(p)}<button data-rmp="${i}" aria-label="הסרה">✕</button></li>`).join("") || `<li class="hint">עוד אין שמות</li>`;
  $("sTopics").innerHTML = topics().map((t, i) => `<li>${topicIcon(t)} ${esc(t)}<button data-rmt="${i}" aria-label="הסרה">✕</button></li>`).join("");
}
$("sSaveKey").onclick = async () => { await saveSettings({ geminiKey: $("sKey").value.trim() }); toast("נשמר"); };
$("sPersonAdd").onclick = async () => { const v = $("sPersonNew").value.trim(); if (!v) return; await saveSettings({ people: [...new Set([...people(), v])] }); $("sPersonNew").value = ""; renderSettings(); };
$("sTopicAdd").onclick = async () => { const v = $("sTopicNew").value.trim(); if (!v) return; await saveSettings({ topics: [...new Set([...topics(), v])] }); $("sTopicNew").value = ""; renderSettings(); };
$("sPeople").addEventListener("click", async (e) => { const b = e.target.closest("[data-rmp]"); if (!b) return; const list = people().slice(); list.splice(Number(b.dataset.rmp), 1); await saveSettings({ people: list }); renderSettings(); });
$("sTopics").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-rmt]"); if (!b) return;
  const list = topics(), t = list[Number(b.dataset.rmt)];
  if (state.docs.some((d) => d.topic === t)) return toast(`יש מסמכים בנושא "${t}", אז אי אפשר להסיר אותו`, 3500);
  await saveSettings({ topics: list.filter((x) => x !== t) }); renderSettings();
});
$("sPwSave").onclick = async () => {
  const a = $("sPw1").value, b = $("sPw2").value;
  if (a.length < 4) return toast("סיסמה קצרה מדי (לפחות 4 תווים)");
  if (a !== b) return toast("שתי הסיסמאות לא זהות");
  try { const k = await sha256Hex(a); await state.api.setPassword(k); state.api.k = k; lsSet("nb_k", k); $("sPw1").value = $("sPw2").value = ""; toast("הסיסמה הוחלפה"); }
  catch (e) { console.error(e); toast("ההחלפה נכשלה, נסי שוב", 4000); }
};
$("sTidy").onclick = () => { if (!tidyCandidates().length) return toast("הארון מסודר. אין כרגע מסמכים ישנים להצעה."); openCleanup(); };
$("sExcel").onclick = () => { if (!state.docs.length) return toast("עוד אין מסמכים"); runExcel(state.docs, ""); };
$("sResort").onclick = async () => {
  if (!state.settings.geminiKey) return toast("צריך מפתח זיהוי כדי לסדר מחדש");
  if (!(await confirmBox("לסדר מחדש את כל המסמכים לתיקיות? שמות תיקיות ששינית ידנית עלולים להשתנות.", "לסדר מחדש", false))) return;
  autoSort(true);
};
$("sLogout").onclick = () => { if (isGoogle()) { googleSignOut(); lsSet("nb_mode", ""); } lsSet("nb_k", ""); state.api.k = ""; state.docs = []; state.thumbs = {}; showLogin(); };

/* ======================= צפייה במסמך ======================= */
const view = { doc: null, pages: [], zoom: 1 };
async function getPages(id) {
  if (state.pages.has(id)) return state.pages.get(id);
  const p = await state.api.pages(id); state.pages.set(id, p); return p;
}
async function openViewer(d) {
  if (!d) return;
  view.doc = d; view.zoom = 1;
  $("vwTitle").textContent = d.title || "מסמך";
  const v = validity(d), t = tripById(d.tripId);
  $("vwMeta").innerHTML = [
    `<span>${topicIcon(d.topic)} <b>${esc([d.topic, folderOf(d), subOf(d)].filter(Boolean).join(" › "))}</b></span>`,
    isArchived(d) ? `<span class="tag tag-old">בארכיון${d.replacedBy ? " · הוחלף במסמך חדש" : ""}</span>` : "",
    ...appendicesOf(d).map((a) => `<span class="tag tag-valid">📎 ${esc(a.title || "נספח")}${a.relevantUntil ? " · עד " + fmtDate(a.relevantUntil) : ""}</span>`),
    isAppendix(d) ? `<span class="tag">📎 נספח ל: ${esc(docById(d.extends).title || "מסמך")}</span>` : "",
    d.people?.length ? `<span>של: <b>${esc(d.people.join(", "))}</b></span>` : "",
    d.date ? `<span>תאריך: <b>${fmtDate(d.date)}</b></span>` : "",
    d.provider ? `<span>גורם: <b>${esc(d.provider)}</b></span>` : "",
    d.amount != null ? `<span>סכום: <b>₪${fmtMoney(d.amount)}</b></span>` : "",
    v ? `<span class="tag ${v.cls}">${esc(v.text)}</span>` : "",
    t ? `<span class="tag tag-trip">✈️ ${esc(t.name)}</span>` : "",
    d.details ? `<span class="vw-details">פירוט: <b>${esc(d.details)}</b></span>` : "",
    d.note ? `<span class="vw-details">הערה: <b>${esc(d.note)}</b></span>` : "",
    d.remindAt ? `<span class="tag tag-soon">🔔 ${fmtDate(d.remindAt)}${d.remindText ? " · " + esc(d.remindText) : ""}</span>` : ""
  ].join("");
  $("vwCal").hidden = !d.relevantUntil && !d.remindAt;
  $("vwActive").hidden = !isArchived(d) || isAppendix(d);
  $("vwArchive").hidden = isArchived(d) || isAppendix(d) || !(d.keepActive || d.relevantUntil);
  $("vwBody").innerHTML = `<div class="busy"><span class="spinner"></span>טוען…</div>`;
  $("viewDlg").showModal();
  try { view.pages = await getPages(d.id); } catch (e) { console.error(e); view.pages = []; $("vwBody").innerHTML = `<div class="empty"><p>לא הצלחתי לטעון את המסמך. בדקי חיבור ונסי שוב.</p></div>`; return; }
  renderViewerPages();
}
function renderViewerPages() {
  $("vwBody").innerHTML = view.pages.map((p, i) => `<figure class="vw-page" style="width:${Math.round(100 * view.zoom)}%"><img src="${p}" alt="דף ${i + 1}">${view.pages.length > 1 ? `<figcaption class="vw-page-bar">דף ${i + 1} מתוך ${view.pages.length}</figcaption>` : ""}</figure>`).join("");
}
$("vwZoomIn").onclick = () => { view.zoom = Math.min(3, view.zoom + 0.25); renderViewerPages(); };
$("vwZoomOut").onclick = () => { view.zoom = Math.max(0.5, view.zoom - 0.25); renderViewerPages(); };
$("vwCal").onclick = () => {
  const d = view.doc;
  if (d.remindAt) return window.open(calUrl({ title: d.remindText || d.title || "תזכורת", date: d.remindAt, details: `${d.title || ""}. מתוך ניירת בית.` }), "_blank", "noopener");
  const reason = d.relevantReason || "בתוקף עד", n = daysUntil(d.relevantUntil);
  window.open(calUrl({ title: `${reason}: ${d.title || "מסמך"}`, date: n > 30 ? addDays(d.relevantUntil, -30) : today(), details: `${reason} ב-${fmtDate(d.relevantUntil)}. מתוך ניירת בית.` }), "_blank", "noopener");
};
async function docPdf(d, pages) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  for (let i = 0; i < pages.length; i++) {
    const img = await loadImage(pages[i]);
    const W = 595, H = 842, r = Math.min(W / img.naturalWidth, H / img.naturalHeight);
    if (i) pdf.addPage("a4");
    pdf.addImage(pages[i], "JPEG", (W - img.naturalWidth * r) / 2, (H - img.naturalHeight * r) / 2, img.naturalWidth * r, img.naturalHeight * r);
  }
  const name = `${(d.title || "מסמך").replace(/[\\/:*?"<>|]+/g, "")}${d.date ? " " + fmtDate(d.date).replace(/\//g, "-") : ""}.pdf`;
  return { blob: pdf.output("blob"), name };
}
function downloadBlob(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
$("vwDownload").onclick = async () => { const f = await docPdf(view.doc, view.pages); downloadBlob(f.blob, f.name); };
$("vwShare").onclick = async () => {
  const f = await docPdf(view.doc, view.pages);
  const file = new File([f.blob], f.name, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: view.doc.title }); return; } catch (e) { if (e.name === "AbortError") return; } }
  downloadBlob(f.blob, f.name); toast("הקובץ ירד. אפשר לצרף אותו להודעה או למייל.");
};
$("vwPrint").onclick = () => {
  const w = window.open("", "_blank"); if (!w) return toast("הדפדפן חסם חלון חדש");
  w.document.write(`<!doctype html><html dir="rtl"><head><title>${esc(view.doc.title)}</title><style>body{margin:0}img{width:100%;page-break-after:always;display:block}</style></head><body>${view.pages.map((p) => `<img src="${p}">`).join("")}<script>window.onload=()=>{window.print();}<\/script></body></html>`);
  w.document.close();
};
// "עדיין בתוקף": מחזיר מסמך מהארכיון (אפשר עם תאריך חדש)
$("vwActive").onclick = () => { $("acUntil").value = ""; $("activeDlg").showModal(); };
$("acSave").onclick = async () => {
  const d = view.doc, until = $("acUntil").value;
  const patch = until ? { relevantUntil: until, relevantReason: d.relevantReason || "בתוקף עד", keepActive: false, archived: false, replacedBy: "" } : { keepActive: true, archived: false, replacedBy: "" };
  try { await state.api.saveDoc({ id: d.id, ...patch }); Object.assign(d, patch); $("activeDlg").close(); $("viewDlg").close(); toast("המסמך חזר מהארכיון"); render(); }
  catch (e) { console.error(e); toast("השמירה נכשלה, נסי שוב", 4000); }
};
$("vwArchive").onclick = async () => {
  const d = view.doc, patch = { keepActive: false, archived: true };
  try { await state.api.saveDoc({ id: d.id, ...patch }); Object.assign(d, patch); $("viewDlg").close(); toast("עבר לארכיון"); render(); }
  catch (e) { console.error(e); toast("השמירה נכשלה, נסי שוב", 4000); }
};
$("vwEdit").onclick = () => { $("viewDlg").close(); openUpload({ edit: view.doc, pages: view.pages }); };
$("vwDelete").onclick = async () => {
  const d = view.doc;
  if (!(await confirmBox(`למחוק את "${d.title || "המסמך"}"? הוא יעבור לסל האשפה של הדרייב ויישאר שם 30 יום.`, "מחק"))) return;
  try { await state.api.deleteDocs([d.id]); state.docs = state.docs.filter((x) => x.id !== d.id); state.pages.delete(d.id); $("viewDlg").close(); toast("נמחק"); render(); }
  catch (e) { console.error(e); toast("המחיקה נכשלה, נסי שוב", 4000); }
};

/* ======================= הצעות למחיקה ======================= */
const cleanChoice = new Map();
function openCleanup() {
  cleanChoice.clear();
  const list = tidyCandidates().sort((a, b) => (a.relevantUntil || "9").localeCompare(b.relevantUntil || "9"));
  $("cleanList").innerHTML = list.map((d) => `<li data-cid="${d.id}">
    <span class="c-main"><span class="c-title">${topicIcon(d.topic)} ${esc(d.title || "מסמך")}</span><br><span class="c-sub">${esc(pathText(d))} · ${d.replacedBy ? "הוחלף במסמך חדש" : `${esc(d.relevantReason || "רלוונטי עד")} ${fmtDate(d.relevantUntil)}`}</span></span>
    <button class="btn btn-ghost btn-sm" data-cview="${d.id}">צפייה</button>
    <span class="seg-mini"><button type="button" data-c="del">למחוק</button><button type="button" data-c="keep">לשמור</button></span>
  </li>`).join("");
  $("cleanDlg").showModal();
}
// "אחר כך": לא להציע שוב החודש
$("cleanDlg").addEventListener("close", () => { if (state.settings.lastTidy !== today()) saveSettings({ lastTidy: today() }).then(() => state.view === "home" && renderHome()); });
$("cleanList").addEventListener("click", (e) => {
  const v = e.target.closest("[data-cview]"); if (v) { openViewer(docById(v.dataset.cview)); return; }
  const b = e.target.closest("[data-c]"); if (!b) return;
  const li = b.closest("[data-cid]"), id = li.dataset.cid;
  cleanChoice.set(id, b.dataset.c);
  li.querySelectorAll("[data-c]").forEach((x) => x.className = x === b ? (b.dataset.c === "del" ? "on-del" : "on-keep") : "");
});
$("cleanGo").onclick = async () => {
  const del = [...cleanChoice].filter(([, c]) => c === "del").map(([id]) => id);
  const keep = [...cleanChoice].filter(([, c]) => c === "keep").map(([id]) => id);
  if (!del.length && !keep.length) return toast("סמני ליד מסמך 'למחוק' או 'לשמור'");
  if (del.length && !(await confirmBox(`למחוק ${del.length === 1 ? "מסמך אחד" : `${del.length} מסמכים`}? הם יעברו לסל האשפה של הדרייב ל-30 יום.`, "מחק"))) return;
  try {
    if (del.length) { await state.api.deleteDocs(del); state.docs = state.docs.filter((d) => !del.includes(d.id)); }
    for (const id of keep) { const d = docById(id); if (d) { d.keep = true; await state.api.saveDoc({ id, keep: true }); } }
    await saveSettings({ lastTidy: today() });
    $("cleanDlg").close(); toast(`${del.length ? `נמחקו ${del.length}` : ""}${del.length && keep.length ? " · " : ""}${keep.length ? `נשמרו ${keep.length}` : ""}`); render();
  } catch (e) { console.error(e); toast("הפעולה נכשלה, נסי שוב", 4000); }
};

/* ======================= הוספת מסמך ======================= */
const up = { pages: [], edit: null, batch: null, runId: 0, skipCtl: null, pendingFiles: null, splitDirect: false };
const OTHER_TOPIC = "__new__", NEW_TRIP = "__newtrip__";
function showStep(id) { ["upCollect", "upMulti", "upPdfSplit", "upReview"].forEach((s) => ($(s).hidden = s !== id)); }
function openUpload(opts = {}) {
  up.runId++; up.skipCtl?.abort(); up.batch = null;
  up.pages = opts.pages ? opts.pages.slice() : []; up.edit = opts.edit || null;
  $("upTitle").textContent = up.edit ? "עריכת פרטי מסמך" : "מסמך חדש";
  if (up.edit) { showStep("upReview"); fillForm(formFromDoc(up.edit), null); renderBatchNav(); }
  else { showStep("upCollect"); $("upStart").hidden = false; $("upPagesBox").hidden = true; $("upBusy").hidden = true; renderBatchNav(); }
  if (!$("uploadDlg").open) $("uploadDlg").showModal();
}
$("fab").onclick = () => {
  // בכניסה עם גוגל: אם החיבור עומד לפוג, מחדשים לפני שמתחילים לצלם
  if (isGoogle() && tokenMinutesLeft() < 15) { toast("רגע, מחדש את החיבור לגוגל…", 3000); return setTimeout(() => googleRedirect("none"), 400); }
  openUpload();
};
$("uploadDlg").addEventListener("close", () => { up.runId++; up.skipCtl?.abort(); ["inCamera", "inFile", "inCameraMore", "inFileMore"].forEach((id) => ($(id).value = "")); });
function bindInput(id, more) { $(id).addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; if (files.length) handleFiles(files, more); }); }
bindInput("inCamera", false); bindInput("inFile", false); bindInput("inCameraMore", true); bindInput("inFileMore", true);
// סריקה עם מסגרת ירוקה, ולצידה צילום רגיל (כשהסורק לא תופס טוב)
if (scannerSupported()) { $("upScan").hidden = false; $("upScanMore").hidden = false; }
if (/iPhone|iPad|iPod/.test(navigator.userAgent)) $("iosTip").hidden = false;
async function doScan(nativeInputId) {
  let page;
  try { page = await scanPage({ onNative: () => $(nativeInputId).click() }); }
  catch (err) { console.warn(err); $("upScan").hidden = $("upScanMore").hidden = true; toast("לא קיבלתי גישה למצלמה. אפשר לצלם ב'צילום רגיל'.", 4500); return; }
  if (!page) return;
  up.pages.push(page);
  $("upStart").hidden = true; showStep("upCollect"); renderPageStrip();
}
$("upScan").onclick = () => doScan("inCamera");
$("upScanMore").onclick = () => doScan("inCameraMore");
function handleFiles(files, more) {
  if (!more && files.length > 1) { up.pendingFiles = files; $("upMultiQ").textContent = `נבחרו ${files.length} קבצים. מה הם?`; showStep("upMulti"); return; }
  addFiles(files);
}
$("upMultiSame").onclick = () => { showStep("upCollect"); addFiles(up.pendingFiles); };
$("upMultiSep").onclick = async () => {
  const files = up.pendingFiles, groups = [];
  showStep("upCollect"); $("upStart").hidden = true; $("upBusy").hidden = false;
  for (let k = 0; k < files.length; k++) {
    $("upBusyText").textContent = `קורא קובץ ${k + 1} מתוך ${files.length}…`;
    try { const p = await fileToPages(files[k]); if (p.length) groups.push(p); } catch (e) { toast(`לא הצלחתי לקרוא את ${files[k].name}`, 4000); }
  }
  if (!groups.length) { $("upBusy").hidden = true; $("upStart").hidden = false; return; }
  startBatch(groups);
};
async function addFiles(files) {
  const startLen = up.pages.length;
  $("upStart").hidden = true; $("upPagesBox").hidden = true; $("upBusy").hidden = false;
  try {
    for (const f of files) {
      $("upBusyText").textContent = isPdf(f) ? "קורא את ה-PDF…" : "מכין את התמונה…";
      up.pages.push(...await fileToPages(f, (p, n) => ($("upBusyText").textContent = `קורא דף ${p} מתוך ${n}…`)));
    }
  } catch (e) { console.error(e); toast(e.message || "לא הצלחתי לקרוא את הקובץ", 4000); }
  $("upBusy").hidden = true;
  if (!up.pages.length) { $("upStart").hidden = false; return; }
  if (startLen === 0 && files.length === 1 && isPdf(files[0]) && up.pages.length > 1) {
    $("upPdfSplitQ").textContent = `בקובץ יש ${up.pages.length} דפים. מה הם?`;
    showStep("upPdfSplit"); setTimeout(() => $("upPdfOne").focus(), 30); return;
  }
  renderPageStrip();
}
$("upPdfOne").onclick = () => { showStep("upCollect"); renderPageStrip(); };
$("upPdfEach").onclick = () => startBatch(up.pages.map((p) => [p]));
function renderPageStrip() {
  $("upPagesBox").hidden = false;
  $("upPages").innerHTML = up.pages.map((p, i) => `<li><img src="${p}" alt="דף ${i + 1}"><span class="pg-num">${i + 1}</span><button type="button" class="pg-del" data-i="${i}" aria-label="הסרת דף">✕</button></li>`).join("");
}
$("upPages").addEventListener("click", (e) => { const b = e.target.closest(".pg-del"); if (!b) return; up.pages.splice(Number(b.dataset.i), 1); if (!up.pages.length) { $("upPagesBox").hidden = true; $("upStart").hidden = false; } else renderPageStrip(); });
$("upDone").onclick = () => startBatch([up.pages.slice()]);
$("upSkip").onclick = () => up.skipCtl?.abort();

// זיהוי של מסמך אחד או כמה ביחד, ואז אישור (עם דפדוף כשיש כמה)
async function startBatch(groups) {
  const runId = ++up.runId;
  up.batch = { drafts: groups.map((pages) => ({ pages })), i: -1 };
  const drafts = up.batch.drafts, n = drafts.length;
  if (n > 1) $("upTitle").textContent = `${n} מסמכים חדשים`;
  showStep("upCollect"); $("upStart").hidden = true; $("upPagesBox").hidden = true; $("upBusy").hidden = false;
  const ctl = new AbortController(), t0 = Date.now(); up.skipCtl = ctl;
  let done = 0;
  const text = () => `${n > 1 ? `מזהה ${n} מסמכים… ${done} מוכנים` : "מזהה את המסמך…"} · ${Math.round((Date.now() - t0) / 1000)} שניות`;
  $("upBusyText").textContent = text();
  const tick = setInterval(() => { $("upBusyText").textContent = text(); if (Date.now() - t0 >= 15000) $("upSkipBox").hidden = false; }, 1000);
  const ctx = { topics: topics(), people: people(), today: today(), folders: knownFolders() };
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const d = drafts[next++];
      d.rec = ctl.signal.aborted ? { ok: false, message: "דילגת על הזיהוי. ממלאים ידנית." } : await recognize(d.pages, state.settings, ctl.signal, ctx);
      done++;
    }
  };
  try { await Promise.all([worker(), worker(), worker()]); }
  finally { clearInterval(tick); if (runId === up.runId) { $("upSkipBox").hidden = true; up.skipCtl = null; } }
  if (runId !== up.runId || !$("uploadDlg").open) return;
  $("upBusy").hidden = true;
  showStep("upReview");
  showDraft(0);
}
function showDraft(i) {
  const b = up.batch;
  if (b.i >= 0 && b.i !== i) b.drafts[b.i].form = getForm();
  b.i = i;
  const d = b.drafts[i];
  up.pages = d.pages;
  if (d.form) fillForm(d.form, null);
  else fillForm(formFromResult(d.rec?.ok ? d.rec.result : {}), d.rec);
  renderBatchNav();
}
function renderBatchNav() {
  const b = up.batch, multi = !!(b && b.drafts.length > 1);
  $("rvBatch").hidden = !multi;
  $("upReview").classList.toggle("is-dropped", !!(multi && b.drafts[b.i]?.drop));
  const live = b ? b.drafts.filter((d) => !d.drop && !d.saved).length : 1;
  $("rvSave").textContent = multi && live > 1 ? `אישור ושמירה של כל ה-${live}` : "אישור ושמירה";
  if (!multi) return;
  const d = b.drafts[b.i];
  $("rvBatchPos").textContent = `מסמך ${b.i + 1} מתוך ${b.drafts.length}`;
  $("rvPrev").disabled = b.i === 0; $("rvNext").disabled = b.i === b.drafts.length - 1;
  $("rvBatchDots").innerHTML = b.drafts.map((x, k) => `<button type="button" data-bi="${k}" class="dot${k === b.i ? " is-active" : ""}${x.drop ? " is-drop" : ""}${x.rec && !x.rec.ok ? " is-manual" : ""}">${k + 1}</button>`).join("");
  $("rvDrop").textContent = d.drop ? "להחזיר את המסמך הזה" : "לא לשמור את המסמך הזה";
}
$("rvPrev").onclick = () => up.batch.i > 0 && showDraft(up.batch.i - 1);
$("rvNext").onclick = () => up.batch.i < up.batch.drafts.length - 1 && showDraft(up.batch.i + 1);
$("rvBatchDots").addEventListener("click", (e) => { const b = e.target.closest("[data-bi]"); if (b) showDraft(Number(b.dataset.bi)); });
$("rvDrop").onclick = () => { const d = up.batch.drafts[up.batch.i]; d.drop = !d.drop; renderBatchNav(); };

// טופס האישור כאובייקט פשוט: קל לשמור ולהחזיר בדפדוף
function formFromDoc(d) {
  return { title: d.title || "", topic: d.topic || "", folder: d.folder || (d.id ? folderOf(d) : ""), sub: d.sub || "", people: (d.people || []).join(", "), date: d.date || "", provider: d.provider || "", amount: d.amount ?? "",
    until: d.relevantUntil || "", reason: d.relevantReason || "", details: d.details || "", note: d.note || "", fullText: d.fullText || "", tripId: d.tripId || "", tripNew: null,
    remindSel: d.remindAt ? "date" : "", remindDate: d.remindAt || "", remindText: d.remindText || "" };
}
function formFromResult(r) {
  const f = formFromDoc({ ...r, people: (r.people || []).map(matchPerson) });
  if (!f.topic && r.trip) f.topic = "נסיעות";
  // תיקייה: אם זו תיקייה שכבר קיימת בכתיב קצת אחר, לוקחים את הקיימת
  const rule = ruleOf(f.topic);
  if (rule.by === "person") f.folder = f.folder ? matchPerson(f.folder) : ((r.people || []).map(matchPerson)[0] || "");
  if (f.folder) { const hit = (knownFolders()[f.topic] || []).find((x) => norm(x) === norm(f.folder)); if (hit) f.folder = hit; }
  { const fix = placementPatch({ ...r, topic: f.topic, folder: f.folder, sub: f.sub }); if (fix) Object.assign(f, fix); }
  // נסיעה: לחבר לנסיעה קיימת שהתאריכים שלה מתאימים, או להציע נסיעה חדשה
  const tr = r.trip;
  if (tr || f.topic === "נסיעות") {
    const from = tr?.from || r.date, to = tr?.to || from;
    const hit = from && (state.settings.trips || []).find((t) => t.from && from <= addDays(t.to || t.from, 3) && (to || from) >= addDays(t.from, -3));
    if (hit) f.tripId = hit.id;
    else if (from) { f.tripId = NEW_TRIP; f.tripNew = { name: `${tr?.destination || "נסיעה"}, ${monthName(from)}`, from, to }; }
    else {   // בלי תאריכים: הנסיעה הקרובה שעוד לא הסתיימה
      const next = (state.settings.trips || []).filter((t) => (t.to || t.from || "") >= today()).sort((a, b) => a.from.localeCompare(b.from))[0];
      if (next) f.tripId = next.id;
    }
  }
  return f;
}
const MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
const monthName = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
// שם שהזיהוי מצא: אם הוא דומה לשם שכבר מוכר, לוקחים את הכתיב המוכר
function matchPerson(name) {
  const n = norm(name);
  const first = (s) => s.split(" ")[0];
  const hit = people().find((p) => { const q = norm(p); return q === n || ((n.split(" ").length === 1 || q.split(" ").length === 1) && first(q) === first(n)); });
  return hit || name;
}
function setTopicOptions(value) {
  const list = topics(), extra = value && value !== OTHER_TOPIC && !list.includes(value) ? [value] : [];
  $("rvTopic").innerHTML = [...list, ...extra].map((t) => `<option value="${esc(t)}">${topicIcon(t)} ${esc(t)}</option>`).join("") + `<option value="${OTHER_TOPIC}">נושא חדש…</option>`;
  $("rvTopic").value = value || "שונות";
  if (!$("rvTopic").value) $("rvTopic").value = list[list.length - 1];
  $("rvTopicNewBox").hidden = $("rvTopic").value !== OTHER_TOPIC;
}
function setTripOptions(f) {
  const show = f.topic === "נסיעות" || !!f.tripId;
  $("rvTripBox").hidden = !show;
  const opts = [`<option value="">בלי נסיעה</option>`, ...trips().map((t) => `<option value="${t.id}">${esc(t.name)} (${fmtDate(t.from)})</option>`)];
  if (f.tripNew) opts.push(`<option value="${NEW_TRIP}">נסיעה חדשה: ${esc(f.tripNew.name)}</option>`);
  $("rvTrip").innerHTML = opts.join("");
  $("rvTrip").value = f.tripId || "";
  up.tripNew = f.tripNew || null;
}
function fillForm(f, rec) {
  up.pageIdx = 0; renderReviewImg();
  const r = $("rvRecog");
  if (rec) { r.hidden = false; r.textContent = rec.ok ? "זיהיתי את הפרטים הבאים. בדקי, תקני במידת הצורך ואשרי." : rec.message; } else r.hidden = true;
  $("rvTitle").value = f.title; setTopicOptions(f.topic); $("rvTopicNew").value = f.topicNew || "";
  $("rvFolder").value = f.folder || ""; $("rvSub").value = f.sub || ""; syncFolderUi();
  $("rvPeople").value = f.people; $("rvDate").value = f.date; $("rvProvider").value = f.provider; $("rvAmount").value = f.amount;
  $("rvUntil").value = f.until; $("rvReason").value = f.reason; $("rvDetails").value = f.details; $("rvNote").value = f.note;
  $("rvFullText").textContent = f.fullText || "(אין)"; up.fullText = f.fullText || "";
  setTripOptions(f);
  $("rvRemindSel").value = f.remindSel || ""; $("rvRemindDate").value = f.remindDate || ""; $("rvRemindText").value = f.remindText || ""; syncRemindUi();
  checkDup();
  $("peopleList").innerHTML = people().map((p) => `<option value="${esc(p)}">`).join("");
}
function getForm() {
  return { title: $("rvTitle").value.trim(), topic: $("rvTopic").value, topicNew: $("rvTopicNew").value.trim(), folder: $("rvFolder").value.replace(/\s+/g, " ").trim(), sub: $("rvSub").value.replace(/\s+/g, " ").trim(), people: $("rvPeople").value, date: $("rvDate").value,
    provider: $("rvProvider").value.trim(), amount: $("rvAmount").value, until: $("rvUntil").value, reason: $("rvReason").value.trim(), details: $("rvDetails").value.trim(),
    note: $("rvNote").value.trim(), fullText: up.fullText || "", tripId: $("rvTrip").value, tripNew: up.tripNew,
    remindSel: $("rvRemindSel").value, remindDate: $("rvRemindDate").value, remindText: $("rvRemindText").value.trim() };
}
$("rvTopic").addEventListener("change", () => {
  const o = $("rvTopic").value === OTHER_TOPIC; $("rvTopicNewBox").hidden = !o; if (o) setTimeout(() => $("rvTopicNew").focus(), 30);
  const f = getForm(); setTripOptions({ ...f, topic: f.topic });
  syncFolderUi();
});
// שדות התיקייה משתנים לפי הנושא: "איזה רכב" + "סוג", "של מי", "מוצר"…
function syncFolderUi() {
  const tp = $("rvTopic").value, r = tp === OTHER_TOPIC ? { label: "תיקייה" } : ruleOf(tp);
  const show = !!r.label;
  $("rvFolderBox").hidden = !show;
  $("rvSubBox").hidden = !(r.subs || r.subLabel);
  $("rvSubLbl").textContent = r.subLabel || "סוג";
  $("subList").innerHTML = (r.subs || []).map((x) => `<option value="${esc(x)}">`).join("");
  if (!show) return;
  $("rvFolderLbl").textContent = `📂 ${r.label}`;
  $("rvFolder").placeholder = r.hint || (r.by === "person" ? "שם" : "");
  const known = tp === OTHER_TOPIC ? [] : (knownFolders()[tp] || []);
  const opts = [...new Set([...(r.fixed || []), ...known, ...(r.by === "person" ? people() : [])])];
  $("folderList").innerHTML = opts.map((x) => `<option value="${esc(x)}">`).join("");
  $("rvSubLbl").textContent = r.subLabel || "סוג";
  const kf = knownFolders();
  const subs = [...new Set([...(r.subs || []), ...state.docs.filter((d) => d.topic === tp).map(subOf).filter(Boolean),
    ...(tp === "ביטוחים" ? [...(kf["דירה ונכס"] || []), ...(kf["רכב"] || []), ...people()] : [])])];
  $("subList").innerHTML = subs.map((x) => `<option value="${esc(x)}">`).join("");
}
// בנושאים לפי אדם: אם אין עדיין תיקייה, השם הראשון ב"של מי"
$("rvPeople").addEventListener("change", () => { if (ruleOf($("rvTopic").value).by === "person" && !$("rvFolder").value) $("rvFolder").value = matchPerson($("rvPeople").value.split(/[,،]/)[0].trim()); });
// אחריות: אם יש תאריך קנייה ואין "רלוונטי עד", מציעים שנה
$("rvDate").addEventListener("change", () => {
  if ($("rvTopic").value === "אחריות ומוצרים" && $("rvDate").value && !$("rvUntil").value) { $("rvUntil").value = addMonths($("rvDate").value, 12); if (!$("rvReason").value) $("rvReason").value = "סוף אחריות"; }
});
function renderReviewImg() {
  $("rvImg").src = up.pages[up.pageIdx] || ""; $("rvImgFrame").hidden = !up.pages.length;
  $("rvImgNav").innerHTML = up.pages.length > 1 ? up.pages.map((_, i) => `<button type="button" data-pi="${i}" class="${i === up.pageIdx ? "is-active" : ""}">דף ${i + 1}</button>`).join("") : "";
}
$("rvImgNav").addEventListener("click", (e) => { const b = e.target.closest("[data-pi]"); if (b) { up.pageIdx = Number(b.dataset.pi); renderReviewImg(); } });
$("rvImg").addEventListener("click", () => $("rvImg").classList.toggle("zoomed"));
$("rvCancel").onclick = async () => {
  const left = up.batch ? up.batch.drafts.filter((d) => !d.drop && !d.saved).length : 0;
  if (left > 1 && !(await confirmBox(`לבטל את כל ${left} המסמכים בלי לשמור?`, "בטל הכול"))) return;
  $("uploadDlg").close();
};

// מהטופס למסמך. מחזיר null אם חסר משהו
function formToDoc(f) {
  const topic = f.topic === OTHER_TOPIC ? f.topicNew : f.topic;
  if (!topic) { toast("חסר נושא"); $("rvTopicNew").focus(); return null; }
  const ppl = f.people.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  const amount = f.amount === "" ? null : (Number.isFinite(parseFloat(f.amount)) ? Math.round(parseFloat(f.amount) * 100) / 100 : null);
  const title = f.title || `${topic}${f.provider ? " – " + f.provider : ""}${f.date ? " " + fmtDate(f.date) : ""}`;
  const remindAt = remindDateOf(f);
  if (f.remindSel === "date" && !remindAt) { toast("חסר תאריך לתזכורת"); $("rvRemindDate").focus(); return null; }
  let folder = f.folder || "";
  if (!folder && ruleOf(topic).by === "person" && ppl.length) folder = ppl[0];
  if (ruleOf(topic).trips) folder = "";
  let tp = topic, sb = f.sub || "";
  // כל דבר אצל הבעלים שלו (ביטוח רכב ברכב, חשבון חשמל בדירה…)
  const fix = placementPatch({ topic: tp, folder, sub: sb, people: ppl });
  if (fix) { tp = fix.topic; folder = fix.folder; sb = fix.sub; }
  if (folder) folder = canonicalFolder(tp, folder);
  return { title, topic: tp, folder, sub: sb, people: ppl, date: f.date, provider: f.provider, amount, relevantUntil: f.until, relevantReason: f.until ? (f.reason || "בתוקף עד") : "",
    details: f.details, note: f.note, fullText: f.fullText, tripId: f.tripId, remindAt, remindText: remindAt ? f.remindText : "" };
}
// "הזכר לי": בעוד שבוע / חודש / שנה, או תאריך מסוים
function remindDateOf(f) {
  const v = f.remindSel;
  if (!v) return "";
  if (v === "date") return f.remindDate || "";
  if (/^\d+$/.test(v)) return addDays(today(), Number(v));
  if (/^m\d+$/.test(v)) return addMonths(today(), Number(v.slice(1)));
  return "";
}
function syncRemindUi() {
  const v = $("rvRemindSel").value;
  $("rvRemindDateBox").hidden = v !== "date";
  $("rvRemindTextBox").hidden = !v;
}
$("rvRemindSel").addEventListener("change", () => { syncRemindUi(); if ($("rvRemindSel").value === "date") setTimeout(() => $("rvRemindDate").focus(), 30); });

// שני מסמכים באותה העלאה עם כמעט אותו טקסט
function findDupPair(a, b) { const A = words(a.fullText), B = words(b.fullText); if (A.size < 8) return false; let n = 0; A.forEach((w) => B.has(w) && n++); return n / Math.max(A.size, B.size) >= 0.8; }
// מסמך שכבר שמור? (צולם פעמיים): אותו טקסט, או אותו תאריך + אותו גורם/סכום
const words = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 1));
function findDuplicate(f, selfId) {
  const tw = words(f.fullText), amt = parseFloat(f.amount);
  return state.docs.find((d) => {
    if (d.id === selfId) return false;
    if (tw.size >= 8 && d.fullText) {
      const dw = words(d.fullText); let both = 0; tw.forEach((w) => dw.has(w) && both++);
      if (both / Math.max(tw.size, dw.size) >= 0.8) return true;
    }
    if (f.date && d.date === f.date) {
      if (Number.isFinite(amt) && d.amount != null && Math.abs(d.amount - amt) < 0.01) return true;
      if (f.provider && d.provider && norm(f.provider) === norm(d.provider) && norm(f.title) === norm(d.title)) return true;
    }
    return false;
  }) || null;
}
function checkDup() {
  const f = getForm(), dup = findDuplicate(f, up.edit?.id);
  up.dup = dup;
  $("rvDup").hidden = !dup;
  if (dup) $("rvDup").innerHTML = `נראה שהמסמך הזה כבר שמור: <b>${esc(dup.title || "מסמך")}</b>${dup.date ? ` מ-${fmtDate(dup.date)}` : ""}. אם זה אותו מסמך, אין צורך לשמור שוב.`;
}
["rvDate", "rvAmount", "rvProvider", "rvTitle"].forEach((id) => $(id).addEventListener("change", checkDup));
async function learnFrom(doc, tripNew) {
  const patch = {};
  const newPeople = doc.people.filter((p) => !people().includes(p));
  if (newPeople.length) patch.people = [...people(), ...newPeople];
  if (!topics().includes(doc.topic) || !state.settings.topics) patch.topics = [...new Set([...topics(), doc.topic])];
  if (doc.tripId === NEW_TRIP && tripNew) {
    // אותה נסיעה חדשה בכמה מסמכים באותה העלאה: נוצרת פעם אחת
    const same = (state.settings.trips || []).find((x) => x.name === tripNew.name && x.from === tripNew.from);
    if (same) doc.tripId = same.id;
    else { const t = { id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), ...tripNew }; patch.trips = [...(state.settings.trips || []), t]; doc.tripId = t.id; }
  } else if (doc.tripId) {
    // נסיעה קיימת: מרחיבים את התאריכים אם צריך
    const list = (state.settings.trips || []).map((t) => ({ ...t })), t = list.find((x) => x.id === doc.tripId);
    if (t && doc.date && (doc.date < t.from || doc.date > (t.to || t.from)) && Math.abs(daysUntil(doc.date) - daysUntil(t.from)) < 30) {
      if (doc.date < t.from) t.from = doc.date; else t.to = doc.date; patch.trips = list;
    }
  }
  if (doc.tripId === NEW_TRIP) doc.tripId = "";
  if (Object.keys(patch).length) await saveSettings(patch);
}

$("upReview").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("rvSave");
  if (up.edit) {
    const doc = formToDoc(getForm()); if (!doc) return;
    btn.disabled = true; btn.textContent = "שומר…";
    try {
      await learnFrom(doc, up.tripNew);
      const saved = await state.api.saveDoc({ ...doc, id: up.edit.id });
      const i = state.docs.findIndex((d) => d.id === saved.id); state.docs[i] = saved;
      toast("הפרטים עודכנו"); $("uploadDlg").close(); render();
    } catch (err) { console.error(err); toast("השמירה נכשלה. בדקי חיבור ונסי שוב.", 4000); }
    finally { btn.disabled = false; btn.textContent = "אישור ושמירה"; }
    return;
  }
  const b = up.batch;
  b.drafts[b.i].form = getForm();
  const todo = [];
  for (let k = 0; k < b.drafts.length; k++) {
    const d = b.drafts[k];
    if (d.drop || d.saved) continue;
    if (k !== b.i) showDraft(k);
    const f = d.form || getForm();
    const doc = formToDoc(f);
    if (!doc) { if (b.drafts.length > 1) toast(`מסמך ${k + 1}: חסרים פרטים`, 3500); return; }
    const dup = findDuplicate(f) || todo.map((t) => t.f).find((g) => g.fullText && findDupPair(g, f));
    if (dup && !(await confirmBox(`${b.drafts.length > 1 ? `מסמך ${k + 1}: ` : ""}נראה שהמסמך כבר שמור${dup.title ? ` ("${dup.title}")` : ""}. לשמור בכל זאת?`, "שמור בכל זאת", false))) return;
    todo.push({ d, doc, f, tripNew: f.tripNew });
  }
  if (!todo.length) { $("uploadDlg").close(); return; }
  btn.disabled = true;
  let saved = 0;
  const savedDocs = [];
  try {
    for (const { d, doc, tripNew } of todo) {
      btn.textContent = todo.length > 1 ? `שומר ${saved + 1} מתוך ${todo.length}…` : "שומר…";
      await learnFrom(doc, tripNew);
      const thumb = await makeThumb(d.pages[0], 180);
      const res = await state.api.saveDoc(doc, d.pages, thumb);
      state.docs.push(res); state.thumbs[res.id] = thumb; state.pages.set(res.id, d.pages);
      d.saved = true; saved++; savedDocs.push(res);
    }
  } catch (err) {
    console.error(err);
    toast(saved ? `נשמרו ${saved} מתוך ${todo.length}. השמירה של השאר נכשלה, נסי שוב.` : "השמירה נכשלה. בדקי חיבור ונסי שוב.", 5000);
    btn.disabled = false; renderBatchNav(); render(); return;
  }
  btn.disabled = false;
  toast(saved > 1 ? `נשמרו ${saved} מסמכים` : `נשמר ב: ${pathText(savedDocs[0])}`, 3500);
  up.batch = null; $("uploadDlg").close(); render();
  await offerReplace(savedDocs);
});

// מסמך חדש שמחליף מסמך קודם (ביטוח חדש לאותו רכב, דרכון חדש…): מציעים למחוק את הקודם או להעביר לארכיון
// המסמך המקורי שהנספח / ההארכה שייך אליו
function findBase(doc) {
  const cands = state.docs.filter((o) => o.id !== doc.id && !o.extends && !looksLikeExtension(o) && o.topic === doc.topic && folderOf(o) === folderOf(doc)
    && (!subOf(o) || !subOf(doc) || subOf(o) === subOf(doc)) && (o.date || "") <= (doc.date || "9999"));
  return cands.sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0] || null;
}
function findReplaced(doc) {
  if (!doc.relevantUntil || looksLikeExtension(doc)) return null;
  const tw = words(doc.title.replace(/[\d\/.\-–]+/g, " "));
  return state.docs.find((o) => {
    if (o.id === doc.id || o.replacedBy || o.archived || !o.relevantUntil || o.relevantUntil >= doc.relevantUntil) return false;
    if (o.topic !== doc.topic || folderOf(o) !== folderOf(doc) || subOf(o) !== subOf(doc)) return false;
    if (!folderOf(doc) && !subOf(doc) && norm(o.provider) !== norm(doc.provider)) return false;
    if (o.relevantReason && o.relevantReason === doc.relevantReason) return true;
    const ow = words(o.title.replace(/[\d\/.\-–]+/g, " ")); let both = 0; tw.forEach((w) => ow.has(w) && both++);
    return tw.size && both / Math.max(tw.size, ow.size) >= 0.5;
  }) || null;
}
async function offerReplace(newDocs) {
  for (const doc of newDocs) {
    if (looksLikeExtension(doc)) {
      const base = findBase(doc);
      if (base) {
        const longer = doc.relevantUntil && doc.relevantUntil > effectiveUntil(base);
        const ok = await confirmBox(`זה נראה כמו הארכה / נספח של "${base.title}".\nלחבר ביניהם${longer ? ` ולהאריך את התוקף עד ${fmtDate(doc.relevantUntil)}` : ""}?`, "כן, לחבר", false, "לא, מסמך נפרד");
        if (ok) {
          try { await state.api.saveDoc({ id: doc.id, extends: base.id }); const d = docById(doc.id); if (d) d.extends = base.id; toast(longer ? "חוברו. החוזה בתוקף עד " + fmtDate(doc.relevantUntil) : "חוברו"); }
          catch (e) { console.error(e); toast("החיבור נכשל, נסי שוב", 4000); }
        } else if (ok === false) { try { await state.api.saveDoc({ id: doc.id, extNo: true }); const d = docById(doc.id); if (d) d.extNo = true; } catch {} }
        render(); continue;
      }
    }
    const old = findReplaced(doc); if (!old) continue;
    const ans = await confirmBox(`נכנס מסמך חדש: "${doc.title}".\nיש כבר את הקודם: "${old.title}" (${old.relevantReason || "בתוקף עד"} ${fmtDate(old.relevantUntil)}).\nמה לעשות עם הקודם?`, "למחוק את הקודם", true, "להעביר לארכיון");
    try {
      if (ans) { await state.api.deleteDocs([old.id]); state.docs = state.docs.filter((x) => x.id !== old.id); toast("המסמך הקודם נמחק"); }
      else { await state.api.saveDoc({ id: old.id, replacedBy: doc.id }); old.replacedBy = doc.id; toast("המסמך הקודם עבר לארכיון"); }
    } catch (e) { console.error(e); toast("הפעולה נכשלה, נסי שוב", 4000); }
    render();
  }
}

/* ======================= סידור לתיקיות של מסמכים קיימים ======================= */
// שם קיים של אותה דירה / אותו רכב / אותו אדם, כדי שלא ייווצרו שתי תיקיות לאותו דבר
function canonicalFolder(topic, name) {
  if (!name) return name;
  const hit = (knownFolders()[topic] || []).find((x) => sameEntity(x, name));
  return hit || name;
}
function placementPatch(d) {
  const p = placementFix(d, { properties: knownFolders()["דירה ונכס"] || [] });
  if (!p) return null;
  if (p.folder) p.folder = canonicalFolder(p.topic, p.folder);
  return p;
}
async function autoSort(all) {
  if (state.sorting) return;
  state.sorting = true;
  let n = 0;
  try {
    // 1. מעבר למבנה החדש (כל דבר אצל הבעלים שלו): לפי כללים קבועים, בלי זיהוי
    for (const d of state.docs.slice()) {
      const p = placementPatch(d); if (!p) continue;
      try { await state.api.saveDoc({ id: d.id, ...p }); Object.assign(d, p); delete d._h; n++; }
      catch (e) { console.warn("migrate", e); break; }
    }
    // 1א. נספחי הארכה שכבר שמורים: מחברים לחוזה המקורי (והוא חוזר מהארכיון)
    for (const d of state.docs.slice()) {
      if (d.extends || d.extNo || !looksLikeExtension(d)) continue;
      const base = findBase(d); if (!base) continue;
      try { await state.api.saveDoc({ id: d.id, extends: base.id }); d.extends = base.id; n++; }
      catch (e) { console.warn("link", e); break; }
    }
    // 2. מסמכים שעוד לא סודרו בכלל: לפי הטקסט שלהם
    const todo = state.docs.filter((d) => all || d.folder === undefined);
    let results = [];
    if (todo.length && (state.settings.geminiKey || "").trim()) {
      if (all || todo.length > 3) toast("מסדר את המסמכים לתיקיות… אפשר להמשיך לעבוד", 3500);
      for (let i = 0; i < todo.length; i += 25) {
        const chunk = todo.slice(i, i + 25).map((d) => ({ id: d.id, title: d.title || "", topic: d.topic || "", folder: d.folder || "", sub: d.sub || "", people: d.people || [], provider: d.provider || "", details: d.details || "", until: d.relevantReason || "", text: String(d.fullText || "").slice(0, 1500) }));
        const r = await classifyFolders(chunk, state.settings, { topics: topics(), people: people(), folders: all ? {} : knownFolders() });
        if (!r) break;   // לא הצליח עכשיו: ננסה שוב בכניסה הבאה
        results.push(...r);
      }
    } else if (todo.length) {
      results = todo.map((d) => ({ id: d.id, topic: d.topic, folder: ruleOf(d.topic).by === "person" ? (d.people?.[0] || "") : (d.folder || ""), sub: d.sub || "" }));
    }
    for (const r of results) {
      const d = docById(r.id); if (!d) continue;
      let patch = { folder: r.folder || "", sub: r.sub || "" };
      if (r.topic && r.topic !== d.topic && (topics().includes(r.topic) || DEFAULT_TOPICS.includes(r.topic))) patch.topic = r.topic;
      const tp = patch.topic || d.topic;
      if (ruleOf(tp).trips) patch.folder = "";
      if (!patch.folder && ruleOf(tp).by === "person" && d.people?.length) patch.folder = d.people[0];
      patch.folder = canonicalFolder(tp, patch.folder);
      const fix = placementFix({ ...d, ...patch }, { properties: knownFolders()["דירה ונכס"] || [] });
      if (fix) patch = { ...fix, folder: canonicalFolder(fix.topic, fix.folder) };
      try { await state.api.saveDoc({ id: d.id, ...patch }); Object.assign(d, patch); delete d._h; n++; }
      catch (e) { console.warn("autoSort", e); break; }
    }
    if (n) { toast(`סידרתי ${plural(n, "מסמך אחד", "מסמכים")} לתיקיות`, 3500); render(); }
  } finally { state.sorting = false; }
}

/* ======================= אקסל ======================= */
async function runExcel(docs, scope) {
  toast("מכין אקסל…", 6000);
  try {
    const f = await exportExcel(docs, { scope, appUrl: location.origin + location.pathname, folderOf, subOf, isArchived, isInsurance, insKind, trips: state.settings.trips || [], topicsOrder: topics() });
    downloadBlob(f.blob, f.name); toast("האקסל ירד");
  } catch (e) { console.error(e); toast("לא הצלחתי להכין אקסל. בדקי חיבור ונסי שוב.", 4500); }
}

/* ======================= מצב תצוגה: מסמכים לדוגמה ======================= */
function sampleImage(title, lines) {
  const c = document.createElement("canvas"); c.width = 620; c.height = 820;
  const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, 620, 820); x.direction = "rtl";
  x.fillStyle = "#0B3448"; x.textAlign = "right"; x.font = "700 34px Heebo, Arial"; x.fillText(title, 580, 80);
  x.fillStyle = "#4A6B7C"; x.font = "400 22px Heebo, Arial"; lines.forEach((l, i) => x.fillText(l, 580, 150 + i * 42));
  x.strokeStyle = "#CDEBF5"; x.lineWidth = 3; x.strokeRect(20, 20, 580, 780);
  return c.toDataURL("image/jpeg", 0.8);
}
async function seedDemo() {
  const t = today(), ago = (n) => addDays(t, -n), ahead = (n) => addDays(t, n);
  await state.api.saveSettings({ people: ["עינבר", "מאיר", "נועה"], trips: [{ id: "t1", name: "רומא, " + monthName(ahead(35)), from: ahead(35), to: ahead(41) }] });
  const car1 = "מאזדה 3 · 12-345-67", car2 = "טויוטה יאריס · 98-765-43";
  const items = [
    { title: "בדיקת דם – ספירה מלאה", topic: "בריאות", folder: "עינבר", sub: "בדיקות דם", people: ["עינבר"], date: ago(20), provider: "מכבי שירותי בריאות", details: "ספירת דם, ברזל, ויטמין D", fullText: "ספירת דם מלאה המוגלובין 13.2 ברזל ויטמין D רופאת משפחה ד״ר לוי" },
    { title: "בדיקת דם – שומנים", topic: "בריאות", folder: "עינבר", sub: "בדיקות דם", people: ["עינבר"], date: ago(200), provider: "מכבי שירותי בריאות" },
    { title: "בדיקת ראייה", topic: "בריאות", folder: "עינבר", sub: "עיניים", people: ["עינבר"], date: ago(90), provider: "אופטיקה הלפרין", details: "מינוס 1.25 בשתי העיניים" },
    { title: "הפניה לרופא עור", topic: "בריאות", folder: "נועה", sub: "הפניות ואישורים", people: ["נועה"], date: ago(10), provider: "ד״ר לוי", relevantUntil: ahead(80), relevantReason: "תוקף ההפניה" },
    { title: "סיכום ביקור אורתופד", topic: "בריאות", folder: "מאיר", sub: "רופאים מומחים", people: ["מאיר"], date: ago(45), provider: "ד״ר כהן" },
    { title: "רישיון רכב", topic: "רכב", folder: car1, sub: "רישיון רכב", people: ["מאיר"], date: ago(200), provider: "משרד התחבורה", amount: 1290, relevantUntil: ahead(165), relevantReason: "תוקף הרישיון" },
    { title: "פוליסת ביטוח רכב – מקיף וחובה", topic: "ביטוחים", folder: "ביטוח רכב", sub: car1, sv: 2, people: ["מאיר"], date: ago(353), provider: "הראל", amount: 4200, relevantUntil: ahead(12), relevantReason: "סוף הפוליסה", details: "פוליסה 88231 · מקיף + חובה" },
    { title: "טיפול 60,000 ק״מ", topic: "רכב", folder: car1, sub: "טיפולים ותיקונים", date: ago(70), provider: "מוסך דוד", amount: 1850 },
    { title: "החלפת צמיגים", topic: "רכב", folder: car1, sub: "טיפולים ותיקונים", date: ago(400), provider: "צמיגי השרון", amount: 2400 },
    { title: "רישיון רכב", topic: "רכב", folder: car2, sub: "רישיון רכב", people: ["עינבר"], date: ago(100), provider: "משרד התחבורה", amount: 1100, relevantUntil: ahead(265), relevantReason: "תוקף הרישיון" },
    { title: "ביטוח חובה", topic: "רכב", folder: car2, sub: "ביטוח", people: ["עינבר"], date: ago(100), provider: "ביטוח ישיר", amount: 1650, relevantUntil: ahead(265), relevantReason: "סוף הפוליסה" },
    { title: "אחריות מקרר סמסונג", topic: "אחריות ומוצרים", folder: "מקרר סמסונג", people: [], date: ago(340), provider: "מחסני חשמל", amount: 6490, relevantUntil: ahead(25), relevantReason: "סוף אחריות", details: "מקרר RF50 4 דלתות", fullText: "סמסונג מקרר 4 דלתות דגם RF50 אחריות שנה מחסני חשמל" },
    { title: "אחריות מכונת כביסה", topic: "אחריות ומוצרים", folder: "מכונת כביסה LG", date: ago(500), provider: "באג", amount: 2890, relevantUntil: ago(135), relevantReason: "סוף אחריות" },
    { title: "פוליסת ביטוח דירה", topic: "ביטוחים", folder: "ביטוח דירה", sub: "הרצל 12", sv: 2, people: ["עינבר", "מאיר"], date: ago(100), provider: "מגדל", amount: 1380, relevantUntil: ahead(265), relevantReason: "סוף הפוליסה" },
    { title: "ביטוח בריאות משלים", topic: "ביטוחים", folder: "ביטוח בריאות", sub: "עינבר", sv: 2, people: ["עינבר"], date: ago(160), provider: "מכבי זהב", amount: 1100, relevantUntil: ahead(205), relevantReason: "סוף הפוליסה" },
    { title: "ביטוח נסיעות 2025", topic: "ביטוחים", folder: "ביטוח נסיעות", sub: "אילת", sv: 2, people: ["עינבר"], date: ago(420), provider: "פספורטכארד", amount: 210, relevantUntil: ago(400), relevantReason: "סוף הביטוח" },
    { title: "טיסה תל אביב–רומא", topic: "נסיעות", people: ["עינבר", "מאיר"], date: ahead(35), provider: "אל על", amount: 3120, relevantUntil: ahead(41), relevantReason: "טיסה חזור", tripId: "t1", details: "LY381 / LY382" },
    { title: "דרכון – מאיר", topic: "מסמכים אישיים", folder: "מאיר", people: ["מאיר"], date: ago(3300), provider: "רשות האוכלוסין", relevantUntil: ahead(150), relevantReason: "תוקף הדרכון" },
    { title: "תעודת זהות – נועה", topic: "מסמכים אישיים", people: ["נועה"], date: ago(900), provider: "רשות האוכלוסין" },
    { title: "חוזה שכירות", topic: "דירה ונכס", folder: "הרצל 12, ראשון לציון", sub: "חוזים", date: ago(150), provider: "משה לוי", amount: 6500, relevantUntil: ahead(215), relevantReason: "סוף החוזה" },
    { title: "חוזה שכירות", topic: "דירה ונכס", folder: "רוטשילד 5, תל אביב", sub: "חוזים", date: ago(385), provider: "דנה כהן", amount: 7200, relevantUntil: ago(20), relevantReason: "סוף החוזה" },
    { title: "נספח הארכת חוזה שכירות", topic: "דירה ונכס", folder: "רוטשילד 5, תל אביב", sub: "חוזים", date: ago(40), provider: "דנה כהן", relevantUntil: ahead(345), relevantReason: "סוף ההארכה" },
    { title: "חשבון חשמל", topic: "חשבוניות לבית", folder: "חשמל", date: ago(15), provider: "חברת החשמל", amount: 612 },
    { title: "כרטיס טיסה לאילת", topic: "נסיעות", people: ["נועה"], date: ago(380), provider: "ישראייר", amount: 450, relevantUntil: ago(378), relevantReason: "תאריך הטיסה" }
  ];
  for (const it of items) {
    const img = sampleImage(it.title, [it.provider || "", it.date ? fmtDate(it.date) : "", it.details || "", it.amount ? "סכום: ₪" + fmtMoney(it.amount) : ""].filter(Boolean));
    const base = { tripId: "", amount: null, relevantUntil: "", relevantReason: "", details: "", note: "", fullText: "", people: [] };
    await state.api.saveDoc({ ...base, ...it }, [img], await makeThumb(img, 180));
  }
}

/* ======================= עדכון אוטומטי של הגרסה ======================= */
const MY_VERSION = new URL(import.meta.url).searchParams.get("v") || "";
let lastCheck = 0;
async function checkForUpdate() {
  if (!MY_VERSION || Date.now() - lastCheck < 60000) return;
  lastCheck = Date.now();
  try {
    const html = await (await fetch("./index.html", { cache: "reload" })).text();
    const v = (html.match(/app\.js\?v=([\w.-]+)/) || [])[1];
    if (v && v !== MY_VERSION && !document.querySelector("dialog[open]")) {
      let done = ""; try { done = sessionStorage.getItem("nbReloadedTo") || ""; sessionStorage.setItem("nbReloadedTo", v); } catch {}
      if (done !== v) location.reload();
    }
  } catch { /* בלי רשת */ }
}
setTimeout(checkForUpdate, 3000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkForUpdate(); });

boot();

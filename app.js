// ניירת בית: כל המסמכים של הבית והמשפחה
import { RemoteApi, DemoApi, sha256Hex } from "./api.js?v=1";
import { fileToPages, makeThumb, isPdf, loadImage } from "./images.js?v=1";
import { recognize, DEFAULT_TOPICS, addMonths } from "./ocr.js?v=1";

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

const TOPIC_ICON = { "בריאות": "🩺", "אחריות ומוצרים": "🧾", "חשבוניות לבית": "🏠", "רכב": "🚗", "ביטוחים": "🛡️", "מסמכים אישיים": "🪪", "לימודים": "🎓", "דירה ונכס": "🔑", "חברים": "🤝", "נסיעות": "✈️", "שונות": "📁" };
const topicIcon = (t) => TOPIC_ICON[t] || "📄";
const CLEAN_AFTER_DAYS = 182;   // חצי שנה אחרי שהמסמך הפסיק להיות רלוונטי
const REMIND_AHEAD_DAYS = 60;

const state = { api: null, settings: {}, docs: [], thumbs: {}, view: "home", pages: new Map(), tripOpen: null };

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
async function boot() {
  const url = (window.BAYIT_CONFIG?.scriptUrl || "").trim();
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
  setView(state.view || "home");
  state.api.thumbs().then((t) => { state.thumbs = t || {}; render(); }).catch((e) => console.warn("thumbs", e));
}

/* ======================= נתונים נגזרים ======================= */
const topics = () => {
  const list = (state.settings.topics && state.settings.topics.length ? state.settings.topics : DEFAULT_TOPICS).slice();
  state.docs.forEach((d) => { if (d.topic && !list.includes(d.topic)) list.push(d.topic); });
  return list;
};
const people = () => state.settings.people || [];
const trips = () => (state.settings.trips || []).slice().sort((a, b) => (b.from || "").localeCompare(a.from || ""));
const tripById = (id) => (state.settings.trips || []).find((t) => t.id === id);
const docById = (id) => state.docs.find((d) => d.id === id);

const norm = (s) => String(s ?? "").toLowerCase().replace(/[֑-ׇ]/g, "").replace(/["'״׳`]/g, "").replace(/\s+/g, " ");
function haystack(d) {
  if (d._h) return d._h;
  const t = tripById(d.tripId);
  d._h = norm([d.title, d.topic, (d.people || []).join(" "), d.provider, d.details, d.note, d.fullText, d.relevantReason,
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
  if (!d.relevantUntil) return null;
  const n = daysUntil(d.relevantUntil);
  if (n < 0) return { cls: "tag-old", text: `${d.relevantReason || "רלוונטי עד"} ${fmtDate(d.relevantUntil)} (עבר)` };
  if (n <= REMIND_AHEAD_DAYS) return { cls: "tag-soon", text: `${d.relevantReason || "בתוקף עד"} ${fmtDate(d.relevantUntil)}` };
  return { cls: "tag-valid", text: `${d.relevantReason || "בתוקף עד"} ${fmtDate(d.relevantUntil)}` };
}

// תזכורות: מסמכים שתוקפם מתקרב, ונסיעות קרובות (כולל בדיקת דרכונים)
function reminders() {
  const out = [];
  for (const d of state.docs) {
    if (!d.relevantUntil || d.noRemind) continue;
    const n = daysUntil(d.relevantUntil);
    if (n > REMIND_AHEAD_DAYS || n < -14) continue;
    const reason = d.relevantReason || "בתוקף עד";
    out.push({ ico: topicIcon(d.topic), days: n, docId: d.id, title: d.title || "מסמך",
      sub: n < 0 ? `${reason}: עבר לפני ${-n} ימים (${fmtDate(d.relevantUntil)})` : n === 0 ? `${reason}: היום` : `${reason}: בעוד ${n} ימים (${fmtDate(d.relevantUntil)})`,
      cal: { title: `${reason}: ${d.title || "מסמך"}`, date: n > 30 ? addDays(d.relevantUntil, -30) : today(), details: `${reason} ב-${fmtDate(d.relevantUntil)}. מתוך ניירת בית.` } });
  }
  for (const t of state.settings.trips || []) {
    if (!t.from) continue;
    const n = daysUntil(t.from);
    if (n < 0 || n > REMIND_AHEAD_DAYS) continue;
    out.push({ ico: "✈️", days: n, tripId: t.id, title: `נסיעה: ${t.name}`, sub: `${n === 0 ? "היום" : `בעוד ${n} ימים`} · לבדוק שהדרכונים בתוקף (לפחות חצי שנה)`,
      cal: { title: `לבדוק דרכונים לפני ${t.name}`, date: n > 14 ? addDays(t.from, -14) : today(), details: `הנסיעה מתחילה ב-${fmtDate(t.from)}. דרכון צריך להיות בתוקף לפחות חצי שנה מיום החזרה.` } });
    const end = t.to || t.from;
    for (const d of state.docs) {
      if (!d.relevantUntil || !/דרכון/.test(`${d.title} ${d.relevantReason} ${d.details}`)) continue;
      if (d.relevantUntil < addDays(end, 183)) {
        out.push({ ico: "⚠️", days: n - 0.5, docId: d.id, title: `דרכון${d.people?.length ? " של " + d.people.join(", ") : ""}`,
          sub: `בתוקף עד ${fmtDate(d.relevantUntil)}, פחות מחצי שנה אחרי הנסיעה ל${t.name}`,
          cal: { title: `לחדש דרכון${d.people?.length ? " – " + d.people.join(", ") : ""}`, date: today(), details: `הדרכון בתוקף עד ${fmtDate(d.relevantUntil)}. נסיעה ל${t.name} ב-${fmtDate(t.from)}.` } });
      }
    }
  }
  return out.sort((a, b) => a.days - b.days);
}
const cleanupCandidates = () => state.docs.filter((d) => d.relevantUntil && !d.keep && daysUntil(d.relevantUntil) < -CLEAN_AFTER_DAYS);
function calUrl({ title, date, details }) {
  const a = date.replace(/-/g, ""), b = addDays(date, 1).replace(/-/g, "");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${a}/${b}&details=${encodeURIComponent(details || "")}`;
}

/* ======================= תצוגות ======================= */
function setView(v) {
  state.view = v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === v));
  ["home", "docs", "trips", "settings"].forEach((k) => ($(k + "View").hidden = k !== v));
  render();
}
$("tabs").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) { if (t.dataset.view === "trips") state.tripOpen = null; setView(t.dataset.view); } });
function render() {
  if (state.view === "home") renderHome();
  else if (state.view === "docs") renderDocs();
  else if (state.view === "trips") renderTrips();
  else if (state.view === "settings") renderSettings();
}

function docCard(d) {
  const v = validity(d), t = tripById(d.tripId), th = state.thumbs[d.id];
  return `<button type="button" class="doc-card" data-doc="${d.id}">
    ${th ? `<img class="thumb" src="${th}" alt="">` : `<span class="thumb"></span>`}
    <span class="d-main">
      <span class="d-title">${esc(d.title || "מסמך")}</span>
      <span class="d-meta"><span class="tag">${topicIcon(d.topic)} ${esc(d.topic || "")}</span>${(d.people || []).map((p) => `<span class="tag tag-person">${esc(p)}</span>`).join("")}${d.date ? `<span>${fmtDate(d.date)}</span>` : ""}${d.provider ? `<span>· ${esc(d.provider)}</span>` : ""}</span>
      <span class="d-meta">${v ? `<span class="tag ${v.cls}">${esc(v.text)}</span>` : ""}${t ? `<span class="tag tag-trip">✈️ ${esc(t.name)}</span>` : ""}</span>
      ${d.details ? `<span class="d-details">${esc(d.details)}</span>` : ""}
    </span>
    ${d.amount != null ? `<span class="d-amt">₪${fmtMoney(d.amount)}</span>` : ""}
  </button>`;
}
document.addEventListener("click", (e) => { const c = e.target.closest("[data-doc]"); if (c && !e.target.closest("dialog")) openViewer(docById(c.dataset.doc)); });

function renderHome() {
  const cand = cleanupCandidates();
  const cb = $("cleanupBanner"); cb.hidden = !cand.length;
  cb.textContent = `🧹 ${cand.length === 1 ? "מסמך אחד כבר לא רלוונטי" : `${cand.length} מסמכים כבר לא רלוונטיים`} (עברה חצי שנה). לבדוק מה למחוק ←`;
  const rem = reminders();
  $("remindPanel").hidden = !rem.length;
  $("remindList").innerHTML = rem.map((r, i) => `<li class="${r.days <= 14 ? "r-soon" : ""}">
    <span class="r-ico">${r.ico}</span>
    <span class="r-main"><span class="r-title">${esc(r.title)}</span><br><span class="r-sub">${esc(r.sub)}</span></span>
    <span class="r-acts">${r.docId ? `<button class="btn btn-ghost btn-sm" data-doc="${r.docId}">פתיחה</button>` : `<button class="btn btn-ghost btn-sm" data-trip="${r.tripId}">פתיחה</button>`}<a class="btn btn-ghost btn-sm" href="${calUrl(r.cal)}" target="_blank" rel="noopener">הוסף ליומן</a></span>
  </li>`).join("");
  const counts = {}; state.docs.forEach((d) => (counts[d.topic] = (counts[d.topic] || 0) + 1));
  $("topicGrid").innerHTML = topics().map((t) => `<button type="button" class="topic-card${counts[t] ? "" : " is-empty"}" data-topic="${esc(t)}"><span class="t-ico">${topicIcon(t)}</span><span class="t-name">${esc(t)}</span><span class="t-count">${counts[t] ? (counts[t] === 1 ? "מסמך אחד" : `${counts[t]} מסמכים`) : "אין עדיין"}</span></button>`).join("");
  const recent = state.docs.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 6);
  $("recentList").innerHTML = recent.map(docCard).join("");
  $("recentTitle").hidden = !recent.length;
  $("homeEmpty").hidden = state.docs.length > 0;
}
$("topicGrid").addEventListener("click", (e) => { const c = e.target.closest("[data-topic]"); if (!c) return; resetFilters(); $("qTopic").dataset.want = c.dataset.topic; setView("docs"); });
$("homeSearchForm").addEventListener("submit", (e) => { e.preventDefault(); resetFilters(); $("qText").value = $("homeSearch").value; $("homeSearch").value = ""; setView("docs"); });
$("cleanupBanner").onclick = openCleanup;
document.addEventListener("click", (e) => { const t = e.target.closest("[data-trip]"); if (t && !e.target.closest("dialog")) { state.tripOpen = t.dataset.trip; setView("trips"); } });

function resetFilters() { ["qText", "qFrom", "qTo"].forEach((id) => ($(id).value = "")); $("qTopic").value = ""; $("qPerson").value = ""; $("qTopic").dataset.want = ""; }
function renderDocs() {
  const sel = (el, list, all) => { const want = el.dataset.want || el.value; el.innerHTML = `<option value="">${all}</option>` + list.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join(""); el.value = list.includes(want) ? want : ""; el.dataset.want = ""; };
  sel($("qTopic"), topics(), "כל הנושאים");
  sel($("qPerson"), people(), "כל האנשים");
  const q = $("qText").value.trim(), tp = $("qTopic").value, pr = $("qPerson").value, from = $("qFrom").value, to = $("qTo").value;
  let rows = state.docs.filter((d) => (!tp || d.topic === tp) && (!pr || (d.people || []).includes(pr)) && (!from || (d.date || "") >= from) && (!to || (d.date || "") <= to) && (!q || matches(d, q)));
  rows.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
  const any = q || tp || pr || from || to;
  $("resultCount").textContent = any ? (rows.length === 1 ? "נמצא מסמך אחד" : rows.length ? `נמצאו ${rows.length} מסמכים` : "לא נמצאו מסמכים שמתאימים לחיפוש") : (rows.length === 1 ? "מסמך אחד" : `${rows.length} מסמכים`);
  $("docList").innerHTML = rows.map(docCard).join("");
}
let qT; $("qText").addEventListener("input", () => { clearTimeout(qT); qT = setTimeout(renderDocs, 250); });
["qTopic", "qPerson", "qFrom", "qTo"].forEach((id) => $(id).addEventListener("change", renderDocs));
$("qClear").onclick = () => { resetFilters(); renderDocs(); };

/* ======================= נסיעות ======================= */
function renderTrips() {
  const open = state.tripOpen && tripById(state.tripOpen);
  $("tripList").hidden = !!open; $("tripDetail").hidden = !open; $("tripNew").hidden = !!open;
  if (open) {
    const docs = state.docs.filter((d) => d.tripId === open.id).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    $("tripHead").innerHTML = `<div><h2>✈️ ${esc(open.name)}</h2><span class="hint">${fmtDate(open.from)}${open.to && open.to !== open.from ? " – " + fmtDate(open.to) : ""} · ${docs.length === 1 ? "מסמך אחד" : `${docs.length} מסמכים`}</span></div><button class="btn btn-ghost btn-sm" id="tripEdit">עריכה</button>`;
    $("tripDocs").innerHTML = docs.length ? docs.map(docCard).join("") : `<div class="empty"><p>עוד אין מסמכים בנסיעה הזו.</p></div>`;
    $("tripEdit").onclick = () => openTripDlg(open);
    return;
  }
  const list = trips();
  $("tripList").innerHTML = list.length ? list.map((t) => {
    const n = state.docs.filter((d) => d.tripId === t.id).length, past = (t.to || t.from || "") < today();
    return `<button type="button" class="trip-card${past ? " is-past" : ""}" data-trip="${t.id}"><span class="tr-name">✈️ ${esc(t.name)}</span><span class="tr-dates">${fmtDate(t.from)}${t.to && t.to !== t.from ? " – " + fmtDate(t.to) : ""}</span><span class="hint">${n === 1 ? "מסמך אחד" : `${n} מסמכים`}</span></button>`;
  }).join("") : `<div class="empty"><p>עוד אין נסיעות. כשמעלים כרטיס טיסה, הזמנת מלון או ביטוח נסיעות, המערכת יוצרת נסיעה לבד.</p></div>`;
}
$("tripBack").onclick = () => { state.tripOpen = null; renderTrips(); };
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
$("sLogout").onclick = () => { lsSet("nb_k", ""); state.api.k = ""; state.docs = []; state.thumbs = {}; showLogin(); };

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
    `<span>${topicIcon(d.topic)} <b>${esc(d.topic || "")}</b></span>`,
    d.people?.length ? `<span>של: <b>${esc(d.people.join(", "))}</b></span>` : "",
    d.date ? `<span>תאריך: <b>${fmtDate(d.date)}</b></span>` : "",
    d.provider ? `<span>גורם: <b>${esc(d.provider)}</b></span>` : "",
    d.amount != null ? `<span>סכום: <b>₪${fmtMoney(d.amount)}</b></span>` : "",
    v ? `<span class="tag ${v.cls}">${esc(v.text)}</span>` : "",
    t ? `<span class="tag tag-trip">✈️ ${esc(t.name)}</span>` : "",
    d.details ? `<span class="vw-details">פירוט: <b>${esc(d.details)}</b></span>` : "",
    d.note ? `<span class="vw-details">הערה: <b>${esc(d.note)}</b></span>` : ""
  ].join("");
  $("vwCal").hidden = !d.relevantUntil;
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
  const d = view.doc, reason = d.relevantReason || "בתוקף עד", n = daysUntil(d.relevantUntil);
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
  const list = cleanupCandidates().sort((a, b) => a.relevantUntil.localeCompare(b.relevantUntil));
  $("cleanList").innerHTML = list.map((d) => `<li data-cid="${d.id}">
    <span class="c-main"><span class="c-title">${topicIcon(d.topic)} ${esc(d.title || "מסמך")}</span><br><span class="c-sub">${esc(d.relevantReason || "רלוונטי עד")} ${fmtDate(d.relevantUntil)}${d.people?.length ? " · " + esc(d.people.join(", ")) : ""}</span></span>
    <button class="btn btn-ghost btn-sm" data-cview="${d.id}">צפייה</button>
    <span class="seg-mini"><button type="button" data-c="del">למחוק</button><button type="button" data-c="keep">לשמור</button></span>
  </li>`).join("");
  $("cleanDlg").showModal();
}
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
$("fab").onclick = () => openUpload();
$("uploadDlg").addEventListener("close", () => { up.runId++; up.skipCtl?.abort(); ["inCamera", "inFile", "inCameraMore", "inFileMore"].forEach((id) => ($(id).value = "")); });
function bindInput(id, more) { $(id).addEventListener("change", (e) => { const files = [...e.target.files]; e.target.value = ""; if (files.length) handleFiles(files, more); }); }
bindInput("inCamera", false); bindInput("inFile", false); bindInput("inCameraMore", true); bindInput("inFileMore", true);
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
  const ctx = { topics: topics(), people: people(), today: today() };
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
  return { title: d.title || "", topic: d.topic || "", people: (d.people || []).join(", "), date: d.date || "", provider: d.provider || "", amount: d.amount ?? "",
    until: d.relevantUntil || "", reason: d.relevantReason || "", details: d.details || "", note: d.note || "", fullText: d.fullText || "", tripId: d.tripId || "", tripNew: null };
}
function formFromResult(r) {
  const f = formFromDoc({ ...r, people: (r.people || []).map(matchPerson) });
  if (!f.topic && r.trip) f.topic = "נסיעות";
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
  $("rvPeople").value = f.people; $("rvDate").value = f.date; $("rvProvider").value = f.provider; $("rvAmount").value = f.amount;
  $("rvUntil").value = f.until; $("rvReason").value = f.reason; $("rvDetails").value = f.details; $("rvNote").value = f.note;
  $("rvFullText").textContent = f.fullText || "(אין)"; up.fullText = f.fullText || "";
  setTripOptions(f);
  $("peopleList").innerHTML = people().map((p) => `<option value="${esc(p)}">`).join("");
}
function getForm() {
  return { title: $("rvTitle").value.trim(), topic: $("rvTopic").value, topicNew: $("rvTopicNew").value.trim(), people: $("rvPeople").value, date: $("rvDate").value,
    provider: $("rvProvider").value.trim(), amount: $("rvAmount").value, until: $("rvUntil").value, reason: $("rvReason").value.trim(), details: $("rvDetails").value.trim(),
    note: $("rvNote").value.trim(), fullText: up.fullText || "", tripId: $("rvTrip").value, tripNew: up.tripNew };
}
$("rvTopic").addEventListener("change", () => {
  const o = $("rvTopic").value === OTHER_TOPIC; $("rvTopicNewBox").hidden = !o; if (o) setTimeout(() => $("rvTopicNew").focus(), 30);
  const f = getForm(); setTripOptions({ ...f, topic: f.topic });
});
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
  return { title, topic, people: ppl, date: f.date, provider: f.provider, amount, relevantUntil: f.until, relevantReason: f.until ? (f.reason || "בתוקף עד") : "",
    details: f.details, note: f.note, fullText: f.fullText, tripId: f.tripId };
}
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
    const doc = formToDoc(d.form || getForm());
    if (!doc) { if (b.drafts.length > 1) toast(`מסמך ${k + 1}: חסר נושא`, 3500); return; }
    todo.push({ d, doc, tripNew: (d.form || getForm()).tripNew });
  }
  if (!todo.length) { $("uploadDlg").close(); return; }
  btn.disabled = true;
  let saved = 0;
  try {
    for (const { d, doc, tripNew } of todo) {
      btn.textContent = todo.length > 1 ? `שומר ${saved + 1} מתוך ${todo.length}…` : "שומר…";
      await learnFrom(doc, tripNew);
      const thumb = await makeThumb(d.pages[0], 180);
      const res = await state.api.saveDoc(doc, d.pages, thumb);
      state.docs.push(res); state.thumbs[res.id] = thumb; state.pages.set(res.id, d.pages);
      d.saved = true; saved++;
    }
  } catch (err) {
    console.error(err);
    toast(saved ? `נשמרו ${saved} מתוך ${todo.length}. השמירה של השאר נכשלה, נסי שוב.` : "השמירה נכשלה. בדקי חיבור ונסי שוב.", 5000);
    btn.disabled = false; renderBatchNav(); render(); return;
  }
  btn.disabled = false;
  toast(saved > 1 ? `נשמרו ${saved} מסמכים` : "נשמר");
  up.batch = null; $("uploadDlg").close(); render();
});

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
  const items = [
    { title: "בדיקת דם – ספירה מלאה", topic: "בריאות", people: ["עינבר"], date: ago(20), provider: "מכבי שירותי בריאות", details: "ספירת דם, ברזל, ויטמין D", fullText: "ספירת דם מלאה המוגלובין 13.2 ברזל ויטמין D רופאת משפחה ד״ר לוי" },
    { title: "הפניה לרופא עור", topic: "בריאות", people: ["נועה"], date: ago(10), provider: "ד״ר לוי", relevantUntil: ahead(80), relevantReason: "תוקף ההפניה" },
    { title: "אחריות מקרר סמסונג", topic: "אחריות ומוצרים", people: [], date: ago(340), provider: "מחסני חשמל", amount: 6490, relevantUntil: ahead(25), relevantReason: "סוף אחריות", details: "מקרר RF50 4 דלתות", fullText: "סמסונג מקרר 4 דלתות דגם RF50 אחריות שנה מחסני חשמל" },
    { title: "פוליסת ביטוח רכב", topic: "ביטוחים", people: ["מאיר"], date: ago(300), provider: "הראל", amount: 4200, relevantUntil: ahead(65), relevantReason: "סוף הפוליסה", details: "פוליסה 88231 · מקיף + חובה" },
    { title: "טיסה תל אביב–רומא", topic: "נסיעות", people: ["עינבר", "מאיר"], date: ahead(35), provider: "אל על", amount: 3120, relevantUntil: ahead(41), relevantReason: "טיסה חזור", tripId: "t1", details: "LY381 / LY382" },
    { title: "דרכון – מאיר", topic: "מסמכים אישיים", people: ["מאיר"], date: ago(3300), provider: "רשות האוכלוסין", relevantUntil: ahead(150), relevantReason: "תוקף הדרכון" },
    { title: "ביטוח נסיעות 2025", topic: "ביטוחים", people: ["עינבר"], date: ago(420), provider: "פספורטכארד", amount: 210, relevantUntil: ago(400), relevantReason: "סוף הביטוח" },
    { title: "כרטיס טיסה לאילת", topic: "נסיעות", people: ["נועה"], date: ago(380), provider: "ישראייר", amount: 450, relevantUntil: ago(378), relevantReason: "תאריך הטיסה" }
  ];
  for (const it of items) {
    const img = sampleImage(it.title, [it.provider || "", it.date ? fmtDate(it.date) : "", it.details || "", it.amount ? "סכום: ₪" + fmtMoney(it.amount) : ""].filter(Boolean));
    await state.api.saveDoc({ tripId: "", amount: null, relevantUntil: "", relevantReason: "", details: "", note: "", fullText: "", ...it }, [img], await makeThumb(img, 180));
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

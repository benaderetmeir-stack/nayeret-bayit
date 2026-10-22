// זיהוי מסמכים עם Google Gemini (מכסה חינמית)
import { askGemini, shrinkPages } from "./fastgem.js?v=14";
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"];

export const DEFAULT_TOPICS = ["דירה ונכס", "בריאות", "מסמכים אישיים", "לימודים", "רכב", "נסיעות", "אחריות ומוצרים", "ביטוחים", "חברים", "שונות"];

// כל מסמך "גר" אצל הבעלים שלו: הדירה, האדם, הרכב או הנסיעה, ובתוכו לפי סוג.
// folder = הבעלים (by: "person" = שם האדם). sub = הסוג. subs = רשימה מוצעת
export const FOLDER_RULES = {
  "דירה ונכס": { label: "איזו דירה", hint: "כתובת, למשל: הרצל 12, ראשון לציון", subLabel: "סוג", subs: ["ארנונה", "חשמל", "מים", "גז", "ועד בית", "אינטרנט וטלפון", "ביטוח דירה", "חוזים", "משכנתא", "שיפוצים ותיקונים", "אחר"] },
  "בריאות": { label: "של מי", by: "person", subLabel: "סוג", subs: ["בדיקות", "רופאים", "מרשמים ותרופות", "הפניות ואישורים", "שיניים", "עיניים", "אשפוז וניתוחים", "חיסונים", "אחר"] },
  "מסמכים אישיים": { label: "של מי", by: "person", subLabel: "סוג", subs: ["תעודת זהות", "דרכון", "רישיון נהיגה", "אחר"] },
  "לימודים": { label: "של מי", by: "person", subLabel: "סוג", subs: ["תעודות", "אישורים", "תשלומים", "אחר"] },
  "רכב": { label: "איזה רכב", hint: "דגם ומספר רישוי, למשל: מאזדה 3 · 12-345-67", subLabel: "סוג", subs: ["רישיון רכב", "ביטוח", "טיפולים ותיקונים", "דוחות וקנסות", "קנייה ומכירה", "אחר"] },
  "נסיעות": { trips: true, subLabel: "סוג", subs: ["טיסות", "מלון", "ביטוח נסיעות", "השכרת רכב", "כרטיסים", "אחר"] },
  "אחריות ומוצרים": { label: "מוצר", hint: "למשל: מקרר סמסונג" },
  "ביטוחים": { label: "סוג הביטוח", fixed: ["ביטוח בית ספר", "ביטוח תאונות אישיות", "ביטוח בריאות", "ביטוח חיים", "ביטוח פנסיוני", "ביטוח משכנתא", "ביטוח טלפון / מכשיר", "ביטוח חיית מחמד", "אחר"], subLabel: "של מי", by2: "person" },
  "חברים": { label: "חבר/ה" },
  "שונות": {}
};
// נושאים ישנים שכבר לא בשימוש (המסמכים שלהם עוברים לדירה)
export const OLD_TOPICS = ["חשבוניות לבית"];

// מעביר מסמך ממבנה ישן למבנה החדש. מחזיר null אם אין מה לשנות
// known: { properties: [...] } כדי לנחש דירה כשיש רק אחת
export function placementFix(d, known = {}) {
  const t = d.topic || "", f = d.folder || "", s = d.sub || "";
  const oneProp = (known.properties || []).length === 1 ? known.properties[0] : "";
  const person = f || (d.people || [])[0] || "";
  if (t === "חשבוניות לבית") return { topic: "דירה ונכס", folder: oneProp, sub: f || s || "אחר" };
  const txt = `${d.title || ""} ${d.details || ""}`;
  const SCHOOL = /בית ?ה?ספר|בית-ספר|תלמיד|גן ילדים|צהרון/;
  const personOf = () => (d.people || [])[0] || "";
  // ביטוח של אדם (בית ספר, תאונות אישיות, בריאות, חיים) גר ב"ביטוחים". "בית הספר" הוא לא בית!
  if (/ביטוח/.test(s) && t !== "ביטוחים" && t !== "רכב" && t !== "נסיעות") {
    if (SCHOOL.test(txt)) return { topic: "ביטוחים", folder: "ביטוח בית ספר", sub: personOf() || (t === "דירה ונכס" ? "" : f) };
    if (/תאונות אישיות/.test(txt)) return { topic: "ביטוחים", folder: "ביטוח תאונות אישיות", sub: personOf() || (t === "דירה ונכס" ? "" : f) };
    if (t === "בריאות") return { topic: "ביטוחים", folder: "ביטוח בריאות", sub: f || personOf() };
    if (t === "מסמכים אישיים") return { topic: "ביטוחים", folder: /חיים/.test(s) ? "ביטוח חיים" : "ביטוח תאונות אישיות", sub: f || personOf() };
  }
  if (t === "ביטוחים") {
    if (SCHOOL.test(txt) && f !== "ביטוח בית ספר") return { topic: t, folder: "ביטוח בית ספר", sub: s || personOf() };
    if (/דירה|מבנה|תכולה/.test(f) && !SCHOOL.test(txt)) return { topic: "דירה ונכס", folder: s || oneProp, sub: "ביטוח דירה" };
    if (/רכב/.test(f)) return { topic: "רכב", folder: s, sub: "ביטוח" };
    if (/נסיעות/.test(f)) return { topic: "נסיעות", folder: "", sub: "ביטוח נסיעות" };
    return null;
  }
  if (t === "בריאות") {
    const map = { "בדיקות דם": "בדיקות", "הדמיה וצילומים": "בדיקות", "רופא משפחה": "רופאים", "רופאים מומחים": "רופאים" };
    if (map[s]) return { topic: t, folder: person, sub: map[s] };
  }
  if (t === "דירה ונכס" && s === "מיסים ואגרות") return { topic: t, folder: f, sub: "ארנונה" };
  return null;
}
export const ruleOf = (topic) => FOLDER_RULES[topic] || { label: "תיקייה" };

function folderGuide(folders) {
  const lines = Object.entries(FOLDER_RULES).filter(([, r]) => r.label).map(([t, r]) => {
    const known = (folders && folders[t]) || [];
    const how = r.by === "person" ? "the person's first name (same spelling as the known people)" : r.fixed ? `one of: ${r.fixed.join(", ")}` : r.hint ? `${r.label} (${r.hint})` : r.label;
    const sub = r.subHow ? `sub = ${r.subHow}` : r.by2 === "person" ? "sub = the insured person's first name" : r.subs ? `sub = one of: ${r.subs.join(", ")}` : r.subLabel ? `sub = ${r.subLabel}` : `sub = ""`;
    return `  - ${t}: folder = ${how}${known.length ? `. Existing folders (reuse exactly when it is the same one): ${known.slice(0, 30).join(" | ")}` : ""}. ${sub}`;
  });
  return lines.join("\n") + `\n  - other topics: folder = "" and sub = ""`;
}

function prompt(topics, people, today, folders) {
  return `You read personal and family paperwork (Hebrew or English) for a home document archive in Israel.
Today is ${today}. Look at the page images (all pages belong to ONE document) and return ONLY a JSON object:
{
  "title": string,            // short clear Hebrew title saying WHAT the document is, e.g. "חידוש ביטוח דירה", "ביטוח מקיף לרכב", "בדיקת דם – ספירה מלאה", "אחריות מקרר סמסונג", "טיסה תל אביב–רומא". Do NOT put the company / insurer name in the title (it goes in "provider"), and do NOT put the address, car or person it belongs to (the app adds them)
  "topic": string,            // EXACTLY one of: ${topics.map((t) => JSON.stringify(t)).join(", ")}. If none fits, use "שונות". Never invent a new topic
  "people": string[],         // names of the people the document is about (patient, insured, passenger, owner). Known family names: ${people.length ? people.join(", ") : "(none yet)"} — reuse the exact known spelling when it is the same person
  "date": "YYYY-MM-DD",       // the document's main date (issue / purchase / test / flight date); "" if none
  "monthOnly": boolean,       // true if the date has only month and year
  "provider": string,         // who issued it: clinic / doctor / store / insurer / airline / hotel / school…
  "amount": number | null,    // main amount paid, if any
  "currency": "ILS" | "USD" | "EUR" | "GBP",  // currency of the amount: $ / דולר / USD → "USD", € / יורו / EUR → "EUR", £ → "GBP", otherwise "ILS"
  "relevantUntil": "YYYY-MM-DD", // until when the document matters: warranty end, policy end, last flight/hotel date, prescription or referral expiry, passport/ID expiry. "" if it stays relevant indefinitely
  "relevantReason": string,   // short Hebrew label for that date: "סוף אחריות", "סוף הפוליסה", "תאריך הטיסה", "תוקף המרשם", "תוקף הדרכון"...
  "warrantyMonths": number | null, // for purchases with warranty: the warranty length in months if printed, else null
  "isWarranty": boolean,      // true for a purchase receipt / invoice of a product that normally has a warranty (appliance, electronics, furniture...)
  "trip": { "destination": string, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } | null, // for travel documents (flight, hotel, travel insurance, car rental)
  "folder": string,           // the folder inside the topic, see the folder rules below. "" if unclear
  "sub": string,              // the sub folder inside that folder, see the rules below. "" if not relevant
  "details": string,          // one short Hebrew line: what it is about (test results summary, product + model, policy number, flight numbers…)
  "fullText": string          // the readable text of the document, plain, up to 1500 characters, for searching
}
Folder rules per topic:
${folderGuide(folders)}
- Everything lives with its OWNER: a bill (ארנונה, חשמל, מים, גז, ועד בית, אינטרנט) goes to topic "דירה ונכס", folder = the property, sub = the type.
- Insurance: car insurance → "רכב" (sub "ביטוח"); insurance of an apartment building / contents (מבנה, תכולה, דירה) → "דירה ונכס" (sub "ביטוח דירה"); travel insurance → "נסיעות" (sub "ביטוח נסיעות"). ALL OTHER insurance (school / student accident insurance, personal accident, health, life, pension, phone, pet…) → topic "ביטוחים", folder = the insurance type, sub = the insured person's first name.
- "בית ספר" / "בית הספר" means SCHOOL, not a home. A school or student insurance is "ביטוח בית ספר", never "ביטוח דירה".
- Hebrew years: תשפ"ד = 2023-2024, תשפ"ה = 2024-2025, תשפ"ו = 2025-2026, תשפ"ז = 2026-2027, תשפ"ח = 2027-2028, תשפ"ט = 2028-2029, תש"צ = 2029-2030. A school year runs 1 September → 31 August, so a document "for school year תשפ"ז" is relevant until 2027-08-31.
- For topic "נסיעות": folder = "" and sub = one of: טיסות, מלון, ביטוח נסיעות, השכרת רכב, כרטיסים, אחר.
- For a car, folder = model + plate number when visible, e.g. "מאזדה 3 · 12-345-67". Reuse an existing car folder when the plate or model matches.
Rules:
- Dates in Israel are written day/month/year.
- Never invent values; use "" or null when unsure.
- Numbers as plain numbers.`;
}

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function isoDate(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return "";
}
export const lastDay = (iso) => { const [y, m] = iso.split("-").map(Number); return `${iso.slice(0, 7)}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
export function addMonths(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1 + n, 1);
  const dd = Math.min(d, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate());
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function normalizeResult(r) {
  r = r || {};
  let date = isoDate(r.date);
  if (r.monthOnly && date) date = lastDay(date);
  const out = {
    title: String(r.title || "").trim().slice(0, 80),
    topic: String(r.topic || "").trim().slice(0, 30),
    people: (Array.isArray(r.people) ? r.people : String(r.people || "").split(/[,،]/)).map((p) => String(p).trim()).filter(Boolean).slice(0, 6),
    date,
    provider: String(r.provider || "").trim().slice(0, 60),
    amount: num(r.amount),
    currency: ["USD", "EUR", "GBP"].includes(String(r.currency || "").toUpperCase()) ? String(r.currency).toUpperCase() : "ILS",
    relevantUntil: isoDate(r.relevantUntil),
    relevantReason: String(r.relevantReason || "").trim().slice(0, 30),
    folder: String(r.folder || "").replace(/\s+/g, " ").trim().slice(0, 50),
    sub: String(r.sub || "").replace(/\s+/g, " ").trim().slice(0, 40),
    details: String(r.details || "").replace(/\s+/g, " ").trim().slice(0, 200),
    fullText: String(r.fullText || "").replace(/\s+/g, " ").trim().slice(0, 3000),
    trip: null
  };
  // אחריות: כשלא כתוב כמה זמן, שנה (המינימום בחוק)
  const wm = num(r.warrantyMonths);
  if ((r.isWarranty || wm) && date && !out.relevantUntil) {
    out.relevantUntil = addMonths(date, wm && wm > 0 ? wm : 12);
    out.relevantReason = "סוף אחריות";
    if (!out.topic) out.topic = "אחריות ומוצרים";
  }
  const t = r.trip;
  if (t && (t.destination || t.from)) out.trip = { destination: String(t.destination || "").trim(), from: isoDate(t.from), to: isoDate(t.to) || isoDate(t.from) };
  return out;
}

function safeMsg(body) { try { return (JSON.parse(body).error?.message || "").slice(0, 160); } catch { return String(body).slice(0, 160); } }

// מחזיר {ok, result, message}
export async function recognize(pages, settings, signal, ctx = {}) {
  const text = prompt(ctx.topics || DEFAULT_TOPICS, ctx.people || [], ctx.today || new Date().toISOString().slice(0, 10), ctx.folders);
  const key = (settings.geminiKey || "").trim();
  if (!key) return { ok: false, message: "לא הוגדר מפתח זיהוי, אז ממלאים ידנית. אפשר להוסיף מפתח בהגדרות." };
  const models = [settings.geminiModel || FALLBACK_MODELS[0], ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  let last, hitQuota = false;
  try {
    const { json, model } = await askGemini({ key, models, text, pages: await shrinkPages(pages), signal });
    return { ok: true, result: normalizeResult(json), model };
  } catch (st) { last = st.last; hitQuota = st.hitQuota; }
  const detail = last ? ` (קוד: ${last.status || last.name || "?"}${last.body ? " · " + (safeMsg(last.body)) : ""})` : "";
  let message = "הזיהוי לא הצליח, אז ממלאים ידנית." + detail;
  if (signal?.aborted) return { ok: false, message: "דילגת על הזיהוי. ממלאים ידנית." };
  if (last?.status === "timeout") message = "הזיהוי לא ענה בזמן (השרת עמוס כרגע). ממלאים ידנית, או מנסים שוב בעוד כמה דקות.";
  if (hitQuota || last?.status === 429) message = "נגמרה לעכשיו מכסת הזיהוי החינמית. ממלאים ידנית, או מנסים שוב בעוד כמה דקות. ";
  else if ((last?.status === 400 || last?.status === 403) && /API.?KEY|api key|PERMISSION/i.test(last.body || "")) message = "מפתח הזיהוי לא תקין או חסום. בדקי אותו בהגדרות. בינתיים ממלאים ידנית." + detail;
  else if (last instanceof SyntaxError) message = "התשובה מהזיהוי לא הייתה ברורה, אז ממלאים ידנית.";
  return { ok: false, message };
}

// סידור חד-פעמי של מסמכים קיימים לתיקיות: לפי הטקסט שכבר שמור, בלי לשלוח תמונות
// items: [{id, title, topic, people, provider, details, text}] → [{id, topic, folder, sub}], או null אם נכשל
export async function classifyFolders(items, settings, ctx = {}) {
  const key = (settings.geminiKey || "").trim();
  if (!key || !items.length) return null;
  const text = `You sort an existing home document archive (Israel, Hebrew) into folders.
Topics: ${(ctx.topics || DEFAULT_TOPICS).join(", ")}. Known people: ${(ctx.people || []).join(", ") || "(none)"}.
Folder rules per topic:
${folderGuide(ctx.folders)}
- Everything lives with its OWNER (property / person / car / trip), with the type as sub. Bills and apartment insurance → "דירה ונכס"; car insurance → "רכב" sub "ביטוח"; travel insurance → "נסיעות" sub "ביטוח נסיעות". All other insurance (school, personal accident, health, life…) → topic "ביטוחים", folder = insurance type, sub = person. "בית ספר" is a school, not a home.
- Use the SAME folder name for documents that belong together (same car, same product, same person, same property).
- Keep the given topic unless it is clearly wrong.
Return ONLY JSON: {"items":[{"id":string,"topic":string,"folder":string,"sub":string}]} with one entry for every document below.
Documents:
${JSON.stringify(items)}`;
  const models = [settings.geminiModel || FALLBACK_MODELS[0], ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  try {
    const { json: out } = await askGemini({ key, models, text });
    const list = Array.isArray(out?.items) ? out.items : [];
    return list.filter((x) => x && x.id).map((x) => ({ id: String(x.id), topic: String(x.topic || "").trim(), folder: String(x.folder || "").replace(/\s+/g, " ").trim().slice(0, 50), sub: String(x.sub || "").trim().slice(0, 40) }));
  } catch { return null; }
}

// זיהוי מסמכים עם Google Gemini (מכסה חינמית)
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const FALLBACK_MODELS = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-2.5-flash"];

export const DEFAULT_TOPICS = ["בריאות", "אחריות ומוצרים", "חשבוניות לבית", "רכב", "ביטוחים", "מסמכים אישיים", "לימודים", "דירה ונכס", "חברים", "נסיעות", "שונות"];

// איך מסדרים כל נושא לתיקיות (folder) ובתוכן (sub)
// by: "person" = התיקייה היא שם האדם. fixed = רשימה קבועה של תיקיות. subs = רשימה מוצעת לתת-תיקייה
export const FOLDER_RULES = {
  "בריאות": { label: "של מי", by: "person", subLabel: "סוג", subs: ["בדיקות דם", "הדמיה וצילומים", "רופא משפחה", "רופאים מומחים", "עיניים", "שיניים", "מרשמים ותרופות", "הפניות ואישורים", "אשפוז וניתוחים", "חיסונים", "אחר"] },
  "רכב": { label: "איזה רכב", hint: "דגם ומספר רישוי, למשל: מאזדה 3 · 12-345-67", subLabel: "סוג", subs: ["רישיון רכב", "ביטוח", "טיפולים ותיקונים", "דוחות וקנסות", "קנייה ומכירה", "אחר"] },
  "ביטוחים": { label: "סוג הביטוח", fixed: ["ביטוח דירה", "ביטוח בריאות", "ביטוח חיים", "ביטוח נסיעות", "ביטוח משכנתא", "אחר"] },
  "אחריות ומוצרים": { label: "מוצר", hint: "למשל: מקרר סמסונג" },
  "חשבוניות לבית": { label: "סוג", fixed: ["חשמל", "מים", "ארנונה", "גז", "אינטרנט וטלפון", "ועד בית", "אחר"] },
  "דירה ונכס": { label: "נכס", hint: "כתובת או שם הנכס", subLabel: "סוג", subs: ["חוזים", "משכנתא", "שיפוצים ותיקונים", "מיסים ואגרות", "אחר"] },
  "לימודים": { label: "של מי", by: "person", subLabel: "מוסד / שנה" },
  "מסמכים אישיים": { label: "של מי", by: "person" },
  "חברים": { label: "חבר/ה" },
  "נסיעות": { trips: true },
  "שונות": {}
};
export const ruleOf = (topic) => FOLDER_RULES[topic] || { label: "תיקייה" };

function folderGuide(folders) {
  const lines = Object.entries(FOLDER_RULES).filter(([, r]) => !r.trips && r.label).map(([t, r]) => {
    const known = (folders && folders[t]) || [];
    const how = r.by === "person" ? "the person's first name (same spelling as the known people)" : r.fixed ? `one of: ${r.fixed.join(", ")}` : r.hint ? `${r.label} (${r.hint})` : r.label;
    const sub = r.subs ? `sub = one of: ${r.subs.join(", ")}` : r.subLabel ? `sub = ${r.subLabel}` : `sub = ""`;
    return `  - ${t}: folder = ${how}${known.length ? `. Existing folders (reuse exactly when it is the same one): ${known.slice(0, 30).join(" | ")}` : ""}. ${sub}`;
  });
  return lines.join("\n") + `\n  - other topics: folder = "" and sub = ""`;
}

function prompt(topics, people, today, folders) {
  return `You read personal and family paperwork (Hebrew or English) for a home document archive in Israel.
Today is ${today}. Look at the page images (all pages belong to ONE document) and return ONLY a JSON object:
{
  "title": string,            // short clear Hebrew title, e.g. "בדיקת דם – ספירה מלאה", "אחריות מקרר סמסונג", "טיסה תל אביב–רומא", "פוליסת ביטוח רכב"
  "topic": string,            // one of: ${topics.map((t) => JSON.stringify(t)).join(", ")}. Only if none fits, a new short Hebrew topic (1-2 words)
  "people": string[],         // names of the people the document is about (patient, insured, passenger, owner). Known family names: ${people.length ? people.join(", ") : "(none yet)"} — reuse the exact known spelling when it is the same person
  "date": "YYYY-MM-DD",       // the document's main date (issue / purchase / test / flight date); "" if none
  "monthOnly": boolean,       // true if the date has only month and year
  "provider": string,         // who issued it: clinic / doctor / store / insurer / airline / hotel / school…
  "amount": number | null,    // main amount paid, if any
  "relevantUntil": "YYYY-MM-DD", // until when the document matters: warranty end, policy end, last flight/hotel date, prescription or referral expiry, passport/ID expiry. "" if it stays relevant indefinitely
  "relevantReason": string,   // short Hebrew label for that date: "סוף אחריות", "סוף הפוליסה", "תאריך הטיסה", "תוקף המרשם", "תוקף הדרכון"...
  "warrantyMonths": number | null, // for purchases with warranty: the warranty length in months if printed, else null
  "isWarranty": boolean,      // true for a purchase receipt / invoice of a product that normally has a warranty (appliance, electronics, furniture...)
  "trip": { "destination": string, "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } | null, // for travel documents (flight, hotel, travel insurance, car rental)
  "folder": string,           // the folder inside the topic, see the folder rules below. "" if unclear
  "sub": string,              // the sub folder inside that folder, see the rules below. "" if not relevant
  "details": string,          // one short Hebrew line: what it is about (test results summary, product + model, policy number, flight numbers…)
  "fullText": string          // all readable text of the document, plain, up to 3000 characters, for searching
}
Folder rules per topic:
${folderGuide(folders)}
- A car insurance policy (חובה / מקיף / צד ג) goes to topic "רכב", sub "ביטוח", NOT to "ביטוחים".
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

const CALL_TIMEOUT = 40000; // שניות לכל ניסיון, אחר כך עוברים לדגם הבא
async function callModel(model, key, pages, signal, text) {
  const parts = [{ text }];
  for (const p of pages.slice(0, 4)) parts.push({ inline_data: { mime_type: "image/jpeg", data: p.slice(p.indexOf(",") + 1) } });
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), CALL_TIMEOUT);
  const stop = () => ctl.abort(); signal?.addEventListener("abort", stop);
  let res;
  try {
    res = await fetch(API + encodeURIComponent(model) + ":generateContent", {
    signal: ctl.signal,
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } })
  });
  } catch (e) {
    const err = new Error(signal?.aborted ? "skipped" : "timeout"); err.status = signal?.aborted ? "skip" : "timeout"; throw err;
  } finally { clearTimeout(t); signal?.removeEventListener("abort", stop); }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`Gemini ${res.status}`); err.status = res.status; err.body = body; throw err;
  }
  const data = await res.json();
  const reply = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const json = reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1);
  return JSON.parse(json);
}

// מחזיר {ok, result, message}
export async function recognize(pages, settings, signal, ctx = {}) {
  const text = prompt(ctx.topics || DEFAULT_TOPICS, ctx.people || [], ctx.today || new Date().toISOString().slice(0, 10), ctx.folders);
  const key = (settings.geminiKey || "").trim();
  if (!key) return { ok: false, message: "לא הוגדר מפתח זיהוי, אז ממלאים ידנית. אפשר להוסיף מפתח בהגדרות." };
  const models = [settings.geminiModel || FALLBACK_MODELS[0], ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  let last, hitQuota = false, timeouts = 0;
  for (const m of models) {
    try {
      if (signal?.aborted) break;
      return { ok: true, result: normalizeResult(await callModel(m, key, pages, signal, text)), model: m };
    } catch (e) {
      last = e;
      // דגם לא קיים / לא נתמך / עמוס → מנסים את הבא
      // מכסה נגמרה (429) → לכל דגם מכסה חינמית נפרדת, אז עוברים לבא
      if (e.status === "skip") break;
      if (e.status === "timeout") { if (++timeouts >= 2) break; continue; }
      if (e.status === 429) { hitQuota = true; continue; }
      if ([404, 500, 503].includes(e.status) || (e.status === 400 && /model|not found|not supported/i.test(e.body || ""))) continue;
      break;
    }
  }
  const detail = last ? ` (קוד: ${last.status || last.name || "?"}${last.body ? " · " + (safeMsg(last.body)) : ""})` : "";
  let message = "הזיהוי לא הצליח, אז ממלאים ידנית." + detail;
  if (signal?.aborted) return { ok: false, message: "דילגת על הזיהוי. ממלאים ידנית." };
  if (last?.status === "timeout") message = "הזיהוי לא ענה בזמן (השרת עמוס כרגע). ממלאים ידנית, או מנסים שוב בעוד כמה דקות.";
  if (hitQuota || last?.status === 429) message = "נגמרה לעכשיו מכסת הזיהוי החינמית. ממלאים ידנית, או מנסים שוב בעוד כמה דקות. ";
  else if (last?.status === 400 || last?.status === 403) message = "מפתח הזיהוי לא תקין או חסום. בדקי אותו בהגדרות. בינתיים ממלאים ידנית." + detail;
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
- A car insurance policy goes to topic "רכב", sub "ביטוח" (change its topic if it is under "ביטוחים").
- Use the SAME folder name for documents that belong together (same car, same product, same person, same property).
- Keep the given topic unless it is clearly wrong.
Return ONLY JSON: {"items":[{"id":string,"topic":string,"folder":string,"sub":string}]} with one entry for every document below.
Documents:
${JSON.stringify(items)}`;
  const models = [settings.geminiModel || FALLBACK_MODELS[0], ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
  for (const m of models) {
    try {
      const out = await callModel(m, key, [], null, text);
      const list = Array.isArray(out?.items) ? out.items : [];
      return list.filter((x) => x && x.id).map((x) => ({ id: String(x.id), topic: String(x.topic || "").trim(), folder: String(x.folder || "").replace(/\s+/g, " ").trim().slice(0, 50), sub: String(x.sub || "").trim().slice(0, 40) }));
    } catch (e) {
      if (e.status === 429 || e.status === "timeout" || [404, 500, 503].includes(e.status) || (e.status === 400 && /model|not found|not supported/i.test(e.body || ""))) continue;
      return null;
    }
  }
  return null;
}

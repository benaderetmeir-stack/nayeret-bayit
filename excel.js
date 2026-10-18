// ניירת בית: אקסל אישי. לשונית "תמונת מצב" + לשונית לכל נושא
const EXCELJS = "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js";
let loading = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return (loading ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = EXCELJS; s.onload = () => res(); s.onerror = () => { loading = null; rej(new Error("exceljs")); };
    document.head.appendChild(s);
  }));
}

const pad = (n) => String(n).padStart(2, "0");
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (iso) => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const daysUntil = (iso) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(); return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); };
const asDate = (iso) => { if (!iso) return null; const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const sheetName = (s, used) => {
  let n = String(s).replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 28) || "גיליון";
  let k = n, i = 2; while (used.has(k)) k = `${n} ${i++}`; used.add(k); return k;
};

const ORANGE = "FFEA580C", INK = "FF3A2E25", INK2 = "FF6B5A4E", LINE = "FFF1E4D8";
const FILL = { ok: "FFE3F5EC", soon: "FFFFF1E6", arch: "FFF1F4F6", head: "FFFFF1E6", zebra: "FFFFFAF5", title: ORANGE };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const font = (o = {}) => ({ name: "Arial", color: { argb: INK }, ...o });

function titleRows(ws, title, sub, n) {
  ws.mergeCells(1, 1, 1, n);
  const t = ws.getCell(1, 1);
  t.value = title; t.font = font({ size: 16, bold: true, color: { argb: "FFFFFFFF" } }); t.fill = fill(FILL.title);
  t.alignment = { horizontal: "right", vertical: "middle" }; ws.getRow(1).height = 30;
  ws.mergeCells(2, 1, 2, n);
  const s = ws.getCell(2, 1); s.value = sub; s.font = font({ size: 11, color: { argb: INK2 } }); s.alignment = { horizontal: "right" };
}
function headRow(ws, r, labels) {
  const row = ws.getRow(r);
  labels.forEach((l, i) => {
    const c = row.getCell(i + 1); c.value = l;
    c.font = font({ bold: true }); c.fill = fill(FILL.head);
    c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    c.border = { bottom: { style: "medium", color: { argb: ORANGE } } };
  });
  row.height = 22;
}
function sectionTitle(ws, r, text, n) {
  ws.mergeCells(r, 1, r, n);
  const c = ws.getCell(r, 1); c.value = text; c.font = font({ size: 13, bold: true, color: { argb: ORANGE } });
  c.alignment = { horizontal: "right" }; ws.getRow(r).height = 22;
}
const MONEY = '#,##0 "₪"';

export async function exportExcel(docs, ctx) {
  await loadExcelJS();
  const { folderOf, subOf, isArchived, appUrl, scope } = ctx;
  const wb = new window.ExcelJS.Workbook();
  wb.creator = "ניירת בית"; wb.created = new Date();
  const used = new Set();
  const made = fmtDate(todayIso());
  const status = (d) => isArchived(d) ? { t: "ארכיון", f: FILL.arch } : d.relevantUntil ? (daysUntil(d.relevantUntil) <= 60 ? { t: "מסתיים בקרוב", f: FILL.soon } : { t: "בתוקף", f: FILL.ok }) : { t: "", f: null };

  /* ---------- תמונת מצב (רק באקסל של הכול) ---------- */
  if (!scope) {
    const ws = wb.addWorksheet(sheetName("תמונת מצב", used), { views: [{ rightToLeft: true }] });
    const N = 6;
    titleRows(ws, "ניירת בית · תמונת מצב", `הופק ${made}`, N);
    [34, 30, 16, 20, 14, 14].forEach((w, i) => (ws.getColumn(i + 1).width = w));
    let r = 4;

    // 1. מה מסתיים ב-3 החודשים הקרובים
    sectionTitle(ws, r++, "⏰ מסתיים ב-3 החודשים הקרובים", N);
    const soon = docs.filter((d) => !isArchived(d) && d.relevantUntil && daysUntil(d.relevantUntil) >= 0 && daysUntil(d.relevantUntil) <= 92)
      .sort((a, b) => a.relevantUntil.localeCompare(b.relevantUntil));
    headRow(ws, r++, ["מסמך", "איפה", "של מי", "מה מסתיים", "תאריך", "עוד ימים"]);
    if (!soon.length) { ws.getCell(r, 1).value = "שום דבר לא מסתיים בקרוב"; ws.getCell(r, 1).font = font({ color: { argb: INK2 } }); r++; }
    soon.forEach((d, i) => {
      const row = ws.getRow(r++);
      row.values = [d.title || "מסמך", [d.topic, folderOf(d), subOf(d)].filter(Boolean).join(" › "), (d.people || []).join(", "), d.relevantReason || "בתוקף עד", asDate(d.relevantUntil), daysUntil(d.relevantUntil)];
      row.getCell(5).numFmt = "dd/mm/yyyy";
      row.eachCell((c) => { c.font = font(); if (i % 2) c.fill = fill(FILL.zebra); });
      if (daysUntil(d.relevantUntil) <= 30) row.getCell(6).font = font({ bold: true, color: { argb: ORANGE } });
    });
    r++;

    // 2. כל הביטוחים
    sectionTitle(ws, r++, "🛡️ ביטוחים בתוקף", N);
    const ins = docs.filter((d) => !isArchived(d) && (d.topic === "ביטוחים" || (d.topic === "רכב" && /ביטוח/.test(subOf(d)))))
      .sort((a, b) => (a.relevantUntil || "").localeCompare(b.relevantUntil || ""));
    headRow(ws, r++, ["ביטוח", "סוג", "חברה", "של מי", "בתוקף עד", "עלות"]);
    const insFirst = r;
    ins.forEach((d, i) => {
      const row = ws.getRow(r++);
      const kind = d.topic === "רכב" ? `ביטוח רכב · ${folderOf(d)}` : ([folderOf(d), subOf(d)].filter(Boolean).join(" · ") || "ביטוח");
      row.values = [d.title || "פוליסה", kind, d.provider || "", (d.people || []).join(", "), asDate(d.relevantUntil), d.amount ?? null];
      row.getCell(5).numFmt = "dd/mm/yyyy"; row.getCell(6).numFmt = MONEY;
      row.eachCell((c) => { c.font = font(); if (i % 2) c.fill = fill(FILL.zebra); });
    });
    if (!ins.length) { ws.getCell(r, 1).value = "אין ביטוחים בתוקף במערכת"; ws.getCell(r, 1).font = font({ color: { argb: INK2 } }); r++; }
    else {
      const row = ws.getRow(r++);
      row.getCell(1).value = 'סה"כ בשנה';
      row.getCell(6).value = { formula: `SUM(F${insFirst}:F${r - 2})`, result: ins.reduce((s, d) => s + (d.amount || 0), 0) };
      row.getCell(6).numFmt = MONEY;
      row.eachCell((c) => { c.font = font({ bold: true, color: { argb: ORANGE } }); c.border = { top: { style: "medium", color: { argb: ORANGE } } }; });
    }
    r++;

    // 3. הוצאות לכל רכב לפי שנה (כולל ארכיון)
    const carDocs = docs.filter((d) => d.topic === "רכב" && d.amount != null && d.date && folderOf(d));
    if (carDocs.length) {
      const cars = [...new Set(carDocs.map(folderOf))].sort();
      const years = [...new Set(carDocs.map((d) => d.date.slice(0, 4)))].sort();
      sectionTitle(ws, r++, "🚗 הוצאות רכב לפי שנה", Math.max(N, years.length + 2));
      headRow(ws, r++, ["רכב", ...years, 'סה"כ']);
      cars.forEach((car, i) => {
        const row = ws.getRow(r);
        row.getCell(1).value = car;
        years.forEach((y, k) => {
          const v = carDocs.filter((d) => folderOf(d) === car && d.date.startsWith(y)).reduce((s, d) => s + d.amount, 0);
          row.getCell(k + 2).value = v || null; row.getCell(k + 2).numFmt = MONEY;
        });
        const last = ws.getColumn(years.length + 1).letter;
        row.getCell(years.length + 2).value = { formula: `SUM(B${r}:${last}${r})`, result: carDocs.filter((d) => folderOf(d) === car).reduce((s, d) => s + d.amount, 0) };
        row.getCell(years.length + 2).numFmt = MONEY;
        row.eachCell((c) => { c.font = font(); if (i % 2) c.fill = fill(FILL.zebra); });
        row.getCell(years.length + 2).font = font({ bold: true });
        r++;
      });
      for (let k = 2; k <= years.length + 2; k++) ws.getColumn(k).width = Math.max(ws.getColumn(k).width || 0, 14);
    }
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  }

  /* ---------- לשונית לכל נושא ---------- */
  const order = ctx.topicsOrder || [];
  const topics = [...new Set(docs.map((d) => d.topic || "שונות"))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const tripName = (id) => (ctx.trips.find((t) => t.id === id) || {}).name || "";
  const COLS = [
    { h: "תיקייה", w: 24 }, { h: "בתוך", w: 18 }, { h: "מסמך", w: 34 }, { h: "של מי", w: 16 }, { h: "תאריך", w: 12 },
    { h: "בתוקף עד", w: 12 }, { h: "סטטוס", w: 14 }, { h: "סכום", w: 12 }, { h: "גורם", w: 22 }, { h: "פירוט", w: 40 }, { h: "מסמך", w: 10 }
  ];
  for (const tp of topics) {
    const list = docs.filter((d) => (d.topic || "שונות") === tp).sort((a, b) =>
      (isArchived(a) - isArchived(b)) || (folderOf(a) || "תתת").localeCompare(folderOf(b) || "תתת", "he") || subOf(a).localeCompare(subOf(b), "he") || (b.date || "").localeCompare(a.date || ""));
    const ws = wb.addWorksheet(sheetName(scope ? scope.split(" › ").pop() : tp, used), { views: [{ rightToLeft: true, state: "frozen", ySplit: 3 }] });
    titleRows(ws, scope ? `ניירת בית · ${scope}` : `ניירת בית · ${tp}`, `${list.length} מסמכים · הופק ${made}`, COLS.length);
    COLS.forEach((c, i) => (ws.getColumn(i + 1).width = c.w));
    headRow(ws, 3, COLS.map((c) => c.h));
    ws.getCell(3, 11).value = "קישור";
    list.forEach((d, i) => {
      const r = 4 + i, row = ws.getRow(r), st = status(d);
      const folder = tp === "נסיעות" ? tripName(d.tripId) : folderOf(d);
      row.values = [folder, subOf(d), d.title || "מסמך", (d.people || []).join(", "), asDate(d.date), asDate(d.relevantUntil), st.t, d.amount ?? null, d.provider || "", [d.details, d.note].filter(Boolean).join(" · "), null];
      row.getCell(5).numFmt = "dd/mm/yyyy"; row.getCell(6).numFmt = "dd/mm/yyyy"; row.getCell(8).numFmt = MONEY;
      row.eachCell({ includeEmpty: true }, (c, k) => {
        if (k > COLS.length) return;
        c.font = font({ color: { argb: isArchived(d) ? "FF9A8F86" : INK } });
        c.border = { bottom: { style: "thin", color: { argb: LINE } } };
        c.alignment = { vertical: "top", wrapText: k === 10 };
      });
      if (st.f) row.getCell(7).fill = fill(st.f);
      const link = row.getCell(11);
      link.value = { text: "פתיחה", hyperlink: `${appUrl}#doc=${encodeURIComponent(d.id)}` };
      link.font = font({ color: { argb: "FF0563C1" }, underline: true });
    });
    if (list.length) ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + list.length, column: COLS.length } };
    ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  }

  const buf = await wb.xlsx.writeBuffer();
  const safe = (s) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const name = safe(`ניירת בית${scope ? " - " + scope.replace(/ › /g, " - ") : ""} ${made.replace(/\//g, "-")}`) + ".xlsx";
  return { blob: new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name };
}

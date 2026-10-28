// שומר את האפליקציה עצמה (המסכים והקוד), כדי שתיפתח גם בלי אינטרנט.
// תמיד מנסה קודם מהאינטרנט (כך שעדכונים מגיעים כרגיל), ורק כשאין חיבור משתמש בעותק השמור.
const CACHE = "nb-shell-1";
const WAIT = 4000;   // חיבור חלש מאוד: אחרי 4 שניות פותחים מהעותק השמור

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["./", "./index.html"])).catch(() => {}));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function remember(req, res) {
  const c = await caches.open(CACHE), u = new URL(req.url);
  // גרסה ישנה של אותו קובץ (?v=…) לא צריך לשמור
  if (u.origin === location.origin) for (const k of await c.keys()) { const ku = new URL(k.url); if (ku.pathname === u.pathname && ku.search !== u.search) c.delete(k); }
  await c.put(req, res);
}
// שמירה ברקע (אם האירוע כבר נגמר, ממשיכים בלי לחכות)
function keep(e, p) { p.catch(() => {}); try { e.waitUntil(p); } catch {} }
async function fromCache(req) {
  return (await caches.match(req)) || (req.mode === "navigate" ? (await caches.match("./index.html")) || (await caches.match("./")) : undefined);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  const mine = u.origin === location.origin, font = /^fonts\.(googleapis|gstatic)\.com$/.test(u.hostname);
  if (u.hostname === "cdnjs.cloudflare.com") {
    // ספריות בגרסה קבועה (PDF): קודם מהעותק השמור
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((res) => { if (res.ok || res.type === "opaque") keep(e, caches.open(CACHE).then((k) => k.put(req, res.clone()))); return res; })));
    return;
  }
  if (!mine && !font) return;   // דרייב, גוגל סקריפט, זיהוי: לא נוגעים
  e.respondWith((async () => {
    const net = fetch(req).then((res) => { if (res.ok) keep(e, remember(req, res.clone())); return res; });
    const slow = new Promise((r) => setTimeout(r, WAIT)).then(() => fromCache(req));
    try {
      const first = await Promise.race([net, slow]);
      if (first) return first;
      return await net;
    } catch {
      const c = await fromCache(req);
      if (c) return c;
      throw new Error("offline");
    }
  })());
});

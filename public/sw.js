// Offline shell: network-first for navigations, cache-first for hashed assets. API calls are never cached.
// v2: never cache an HTML response for an /assets/ URL. Right after a deploy a chunk can briefly be missing at the
// edge and the SPA fallback answers with index.html; v1 cached that and broke the chunk until the cache was cleared.
// Activating v2 deletes the old caches (and any such poisoned entries).
const CACHE = "lumen-v2";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/"]))); });
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));
const isAsset = (r) => r.ok && !/text\/html/i.test(r.headers.get("content-type") || "");
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname === "/rss.xml") return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((x) => x.put("/", c)); } return r; }).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((hit) => {
      if (hit && isAsset(hit)) return hit;
      return fetch(e.request).then((r) => { if (isAsset(r)) { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); } return r; });
    }));
  }
});

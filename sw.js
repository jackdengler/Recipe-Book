const CACHE = "recipe-book-v4";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      // Drop old caches.
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
      // Reload any open pages once so a brand-new shell takes effect
      // immediately instead of waiting for the next manual refresh — this
      // is what frees a client that was pinned to an old cached build.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const c of clients) {
        try {
          c.navigate(c.url);
        } catch (_) {}
      }
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never touch GitHub API traffic — always straight to the network.
  if (url.hostname === "api.github.com") return;
  if (url.origin !== self.location.origin) return;

  // Network-first for the app shell: online visitors always get the latest
  // code; the cache is only a fallback when offline. This prevents a stale
  // cached build from sticking around after a deploy.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});

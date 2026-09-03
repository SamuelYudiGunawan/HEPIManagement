const CACHE = "hepi-static-v1";
const ASSETS = [
  "/",
  "/styles.css",
  "/js/hepi-api.js",
  "/js/textsize.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) { return cache.addAll(ASSETS); }).then(function() {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function(event) {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(function() { return caches.match("/"); }));
    return;
  }

  event.respondWith(
    caches.match(req).then(function(cached) {
      if (cached) return cached;
      return fetch(req).then(function(res) {
        if (res && res.ok && req.method === "GET") {
          const copy = res.clone();
          caches.open(CACHE).then(function(cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});

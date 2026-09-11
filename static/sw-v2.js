const CACHE = "hepi-static-v4";
// styles/js are now served from content-hashed /assets/<hash>/... URLs (see
// server.js) — a given hash never changes meaning, so those are safe to
// cache-first forever and don't need to be precached by exact path here.
const ASSETS = [
  "/",
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

self.addEventListener("push", function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || "HEPI Property";
  const url = data.url || "/";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: url }
    })
  );
});

self.addEventListener("notificationclick", function(event) {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

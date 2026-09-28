const CACHE = "hepi-static-v14";
console.log("[SW] Loaded:", self.location.href);
// styles/js are now served from content-hashed /assets/<hash>/... URLs (see
// server.js) — a given hash never changes meaning, so those are safe to
// cache-first forever and don't need to be precached by exact path here.
const ASSETS = [
  "/manifest-v5.webmanifest",
  "/apple-touch-icon-v4.png",
  "/favicon-v4.png",
  "/icons/hepi-icon-192-v4.png",
  "/icons/hepi-icon-512-v4.png"
];

self.addEventListener("install", function(event) {
  event.waitUntil(
    caches.open(CACHE).then(function(cache) {
      // One unavailable optional asset must not cancel the whole installation.
      // Caching "/" was also unsafe: it could preserve a login redirect or a
      // stale authenticated HTML page and leave mobile launches on a blank/
      // splash-like screen after a deploy.
      return Promise.all(ASSETS.map(function(url) {
        return cache.add(url).catch(function(error) {
          console.warn("[SW] optional precache failed", url, error);
        });
      }));
    }).then(function() {
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
    event.respondWith(fetch(req).catch(function() {
      return caches.match(req).then(function(cached) {
        return cached || new Response("Aplikasi sedang offline. Periksa koneksi internet.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
      });
    }));
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
  event.waitUntil((async function() {
    let data = {};
    const raw = event.data ? event.data.text() : "";
    console.log("[SW] PUSH EVENT RECEIVED", raw);
    if (raw) {
      try {
        data = JSON.parse(raw) || {};
      } catch (e) {
        // Keep notifications visible even if an older server sends plain text.
        console.error("[SW] JSON parse failed", e);
        data = { body: raw };
      }
    }
    const title = String(data.title || "HEPI Property");
    const body = String(data.body || "Ada update baru.");
    const url = data.url || "/";
    console.log("[SW] Showing:", { title: title, body: body });
    await self.registration.showNotification(title, {
      body: body,
      icon: "/icons/hepi-icon-192-v3.png",
      badge: "/icons/hepi-icon-192-v3.png",
      tag: "hepi-" + Date.now(),
      renotify: true,
      data: { url: url }
    });
    console.log("[SW] showNotification SUCCESS");
  })().catch(function(error) {
    // Keep the failure visible in the worker console instead of silently
    // letting Chrome display its generic background-update notification.
    console.error("[push] showNotification failed", error);
  }));
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

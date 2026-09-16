function hepiApi(path, options) {
  options = options || {};
  var init = { method: options.method || (options.body || options.formData ? "POST" : "GET") };
  if (options.formData) {
    init.body = options.formData;
  } else if (options.body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
  }
  return fetch(path, init).then(function(res) {
    return res.json().then(function(data) {
      if (!res.ok) {
        var err = new Error((data && (data.error || data.pesan)) || res.statusText || "Request failed");
        err.status = res.status;
        err.data = data;
        throw err;
      }
      return data;
    }, function() {
      if (!res.ok) throw new Error(res.statusText || "Request failed");
      return {};
    });
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function() {
    // server.js rewrites this literal path to a content-hashed /assets/<hash>/sw-v2.js
    // URL when serving this file — the explicit scope keeps it controlling the
    // whole site even though it's served from a nested path.
    window.hepiServiceWorkerReady = navigator.serviceWorker.register("/sw-v2.js", { scope: "/" })
      .then(function(registration) {
        // Ask the browser to check the content-hashed worker immediately. This
        // prevents a stale worker from surviving after a deploy.
        return registration.update().catch(function() { return registration; });
      })
      .catch(function(error) {
        console.error("[push] service worker registration failed", error);
        throw error;
      });
  });
}

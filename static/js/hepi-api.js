function hepiApi(path, options) {
  options = options || {};
  var method = String(options.method || (options.body || options.formData ? "POST" : "GET")).toUpperCase();
  var timeoutMs = Number(options.timeoutMs || (options.formData ? 180000 : 45000));
  var retryCount = options.retry == null ? (method === "GET" ? 1 : 0) : Number(options.retry) || 0;

  function request(attempt) {
    var init = {
      method: method,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Accept": "application/json" }
    };
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function() { controller.abort(); }, timeoutMs) : null;
    if (controller) init.signal = controller.signal;

    if (options.formData) {
      init.body = options.formData;
    } else if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    return fetch(path, init).then(function(res) {
      return res.text().then(function(raw) {
        var data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) {
          if (!res.ok) data = { error: raw || res.statusText || "Request failed" };
          else throw new Error("Server mengirim respons yang tidak valid.");
        }
        if (!res.ok) {
          var err = new Error((data && (data.error || data.pesan)) || res.statusText || "Request failed");
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    }).catch(function(error) {
      var isAbort = error && error.name === "AbortError";
      var isNetwork = !error || isAbort || error instanceof TypeError;
      var isTransientServer = error && [408, 429, 500, 502, 503, 504].indexOf(error.status) !== -1;
      if ((isNetwork || isTransientServer) && attempt < retryCount) {
        return new Promise(function(resolve) {
          setTimeout(function() { resolve(request(attempt + 1)); }, 300 * Math.pow(2, attempt));
        });
      }

      if (isAbort) {
        var timeoutError = new Error("Koneksi terlalu lama. Periksa jaringan lalu coba lagi.");
        timeoutError.code = "HEPI_TIMEOUT";
        timeoutError.cause = error;
        throw timeoutError;
      }
      if (isNetwork) {
        var networkError = new Error(navigator.onLine === false
          ? "Perangkat sedang offline. Periksa koneksi internet lalu coba lagi."
          : "Koneksi ke server gagal. Coba lagi beberapa saat.");
        networkError.code = "HEPI_NETWORK";
        networkError.cause = error;
        throw networkError;
      }
      throw error;
    }).finally(function() {
      if (timer) clearTimeout(timer);
    });
  }

  return request(0);
}

if ("serviceWorker" in navigator) {
  // server.js rewrites this literal path to a content-hashed
  // /assets/<hash>/sw-v2.js URL when serving this file. Register immediately
  // so push-client.js never needs to race a second registration on Android.
  window.hepiServiceWorkerReady = navigator.serviceWorker.register("/sw-v2.js", { scope: "/" })
    .catch(function(error) {
      console.error("[push] service worker registration failed", error);
      throw error;
    });
}

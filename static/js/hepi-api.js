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
    navigator.serviceWorker.register("/sw.js").catch(function() {});
  });
}

(function () {
  "use strict";

  var session = { loggedIn: false };
  var isReady = false;
  var readyCallbacks = [];

  function notifyReady() {
    isReady = true;
    renderNavbar();
    var callbacks = readyCallbacks;
    readyCallbacks = [];
    callbacks.forEach(function (cb) { cb(session); });
  }

  function isListingEditor() {
    var status = String(session.status || "").toLowerCase().trim();
    return status === "admin" || status === "adminkantor";
  }

  function renderNavbar() {
    var nav = document.querySelector(".appNav");
    if (!nav) return;

    var admin = isListingEditor();
    var current = window.location.pathname.replace(/\/$/, "") || "/";
    var links = [
      ["/", "Cari Listing", false],
      ["/activity", "Aktivitas", false],
      ["/scores", "Skor", false],
      ["/history", "History", false],
      ["/closing", "Closing", true],
      ["/inputlisting", "Input Listing", true],
      ["/form-listing", "Tambah Listing", false],
      ["/form-listing-review", "Review Form", true],
      ["/revisi-listing", "Revisi", false],
      ["/revisi-review", "Review Revisi", true],
      ["/import-monitor", "Monitor Import", true]
    ];

    nav.innerHTML = links
      .filter(function (link) { return !link[2] || admin; })
      .map(function (link) {
        var active = current === link[0] ? " active" : "";
        return '<a class="appNavLink' + active + '" href="' + link[0] + '" target="_top">' + link[1] + '</a>';
      })
      .join("");
  }

  function loadSession() {
    hepiApi("/api/me").then(function (res) {
      session = (res && res.loggedIn) ? res : { loggedIn: false };
    }).catch(function () {
      session = { loggedIn: false };
    }).then(notifyReady);
  }

  function ssoErrorMessage(code) {
    var messages = {
      not_whitelisted: "Email kamu belum terdaftar sebagai agen. Hubungi admin untuk didaftarkan.",
      state: "Sesi login kedaluwarsa. Silakan coba login lagi.",
      oauth: "Login dengan Google gagal. Silakan coba lagi."
    };
    return messages[code] || "Login gagal. Silakan coba lagi.";
  }

  var pendingSsoError = new URLSearchParams(window.location.search).get("ssoError");

  function showPendingSsoError() {
    if (!pendingSsoError) return;
    var code = pendingSsoError;
    pendingSsoError = null;

    var url = new URL(window.location.href);
    url.searchParams.delete("ssoError");
    var newSearch = url.searchParams.toString();
    window.history.replaceState(null, "", window.location.pathname + (newSearch ? "?" + newSearch : ""));

    var msg = ssoErrorMessage(code);
    if (typeof window.showMessage === "function" && document.getElementById("messageModal")) {
      window.showMessage(msg);
    } else {
      alert(msg);
    }
  }

  window.hepiAuth = {
    onReady: function (cb) {
      if (isReady) cb(session);
      else readyCallbacks.push(cb);
    },
    getSession: function () { return session; },
    isLoggedIn: function () { return !!session.loggedIn; },
    isAdmin: function () { return String(session.status || "").toLowerCase().trim() === "admin"; },
    isListingEditor: isListingEditor,
    renderNavbar: renderNavbar,
    getNama: function () { return session.nama || session.agentCode || ""; },
    getAgentCode: function () { return session.agentCode || ""; },
    getStatus: function () { return session.status || ""; },
    login: function (returnTo) {
      window.top.location.href = "/auth/google?returnTo=" + encodeURIComponent(returnTo || window.location.pathname);
    },
    logout: function () {
      window.top.location.href = "/auth/logout";
    }
  };

  loadSession();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      renderNavbar();
      showPendingSsoError();
    });
  } else {
    renderNavbar();
    showPendingSsoError();
  }
})();

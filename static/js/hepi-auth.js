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
    renderNotificationCenter();
  }

  function notificationEscape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function renderNotificationCenter() {
    if (!session.loggedIn) return;
    var logout = document.querySelector(".headerLogout");
    if (!logout || document.getElementById("notificationCenter")) return;
    var wrap = document.createElement("div");
    wrap.id = "notificationCenter";
    wrap.className = "notificationCenter";
    wrap.innerHTML = '<button type="button" class="notificationBell" aria-label="Notifikasi" title="Notifikasi">🔔<span class="notificationBadge" style="display:none"></span></button>'
      + '<div class="notificationPanel" style="display:none"><div class="notificationPanelHead"><b>Notifikasi</b><button type="button" class="notificationClearAll">Hapus semua</button></div><div class="notificationItems"></div></div>';
    logout.parentNode.insertBefore(wrap, logout);
    wrap.querySelector(".notificationBell").addEventListener("click", function (event) {
      event.stopPropagation();
      var panel = wrap.querySelector(".notificationPanel");
      panel.style.display = panel.style.display === "none" ? "block" : "none";
      if (panel.style.display === "block") loadNotifications();
    });
    wrap.querySelector(".notificationClearAll").addEventListener("click", function () {
      hepiApi("/api/notifications/clear", { body: { all: true } }).then(loadNotifications);
    });
    wrap.querySelector(".notificationItems").addEventListener("click", function (event) {
      var clear = event.target.closest("[data-notification-clear]");
      if (!clear) return;
      event.stopPropagation();
      hepiApi("/api/notifications/clear", { body: { id: clear.getAttribute("data-notification-clear") } }).then(loadNotifications);
    });
    document.addEventListener("click", function (event) {
      if (!wrap.contains(event.target)) wrap.querySelector(".notificationPanel").style.display = "none";
    });
    loadNotifications();
  }

  function loadNotifications() {
    var wrap = document.getElementById("notificationCenter");
    if (!wrap) return;
    hepiApi("/api/notifications").then(function (result) {
      var items = (result && result.notifications) || [];
      var badge = wrap.querySelector(".notificationBadge");
      badge.textContent = items.length > 99 ? "99+" : String(items.length);
      badge.style.display = items.length ? "inline-flex" : "none";
      var target = wrap.querySelector(".notificationItems");
      target.innerHTML = items.length ? items.map(function (item) {
        var when = new Date(item.dateCreated).toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        return '<div class="notificationItem"><a href="' + notificationEscape(item.url || "/") + '" target="_top"><b>' + notificationEscape(item.title) + '</b><span>' + notificationEscape(item.body).replace(/\n/g, "<br>") + '</span><small>' + notificationEscape(when) + '</small></a><button type="button" aria-label="Hapus notifikasi" title="Hapus notifikasi" data-notification-clear="' + notificationEscape(item.id) + '">×</button></div>';
      }).join("") : '<div class="notificationEmpty">Tidak ada notifikasi.</div>';
    }).catch(function () {});
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

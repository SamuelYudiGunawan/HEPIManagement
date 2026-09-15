// Shared by every logged-in page: prompts the agent/adminkantor to enable
// browser push notifications, and subscribes them via the service worker's
// PushManager. Call window.initPushNotifications() once the caller knows
// the visitor is logged in (e.g. inside hepiAuth.onReady()).
(function () {
  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && typeof hepiApi === "function";
  }

  function wasDismissedRecently() {
    try {
      const at = Number(localStorage.getItem("hepi_push_dismissed_at") || 0);
      return !!at && (Date.now() - at) < 3 * 24 * 60 * 60 * 1000; // 3 days
    } catch (e) {
      return false;
    }
  }

  function dismiss(bar) {
    if (bar) bar.remove();
    try { localStorage.setItem("hepi_push_dismissed_at", String(Date.now())); } catch (e) {}
  }

  function showBanner(onEnable) {
    if (document.getElementById("pushEnableBanner")) return;
    const bar = document.createElement("div");
    bar.id = "pushEnableBanner";
    bar.className = "pushEnableBanner";
    bar.innerHTML =
      '<span class="pushEnableText">🔔 Aktifkan notifikasi biar tidak ketinggalan update?</span>'
      + '<span class="pushEnableActions">'
      + '<button type="button" class="pushEnableBtn">Aktifkan</button>'
      + '<button type="button" class="pushDismissBtn">Nanti</button>'
      + '</span>';
    document.body.appendChild(bar);
    bar.querySelector(".pushEnableBtn").addEventListener("click", function () {
      bar.remove();
      onEnable();
    });
    bar.querySelector(".pushDismissBtn").addEventListener("click", function () {
      dismiss(bar);
    });
  }

  async function subscribeNow(registration) {
    const res = await hepiApi("/api/push/vapid-public-key");
    if (!res || !res.key) return;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(res.key)
    });
    await hepiApi("/api/push/subscribe", { body: { subscription: subscription.toJSON() } });
  }

  window.initPushNotifications = function () {
    if (!supported()) return;
    if (Notification.permission === "denied") return;

    navigator.serviceWorker.ready.then(function (registration) {
      registration.pushManager.getSubscription().then(function (existing) {
        // Re-save an existing browser subscription as well. The same browser
        // can be used by different agents, and the Sheet may have lost the
        // row, so returning here can silently leave notifications assigned to
        // the previous account.
        if (existing) {
          subscribeNow(registration).catch(function () {});
          return;
        }

        if (Notification.permission === "granted") {
          subscribeNow(registration).catch(function () {});
          return;
        }

        if (wasDismissedRecently()) return;

        showBanner(function () {
          Notification.requestPermission().then(function (perm) {
            if (perm === "granted") subscribeNow(registration).catch(function () {});
          });
        });
      });
    });
  };
})();

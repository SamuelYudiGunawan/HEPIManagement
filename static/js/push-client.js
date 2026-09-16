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
    return { ok: true };
  }

  function pushErrorMessage(error) {
    if (Notification.permission === "denied") {
      return "Notifikasi sedang diblokir browser. Buka Site settings lalu ubah Notifications menjadi Allow.";
    }
    return (error && error.message) || "Notifikasi belum berhasil diaktifkan.";
  }

  async function getRegistration() {
    if (window.hepiServiceWorkerReady) return window.hepiServiceWorkerReady;
    const registration = await navigator.serviceWorker.register("/sw-v2.js", { scope: "/" });
    await registration.update().catch(function() {});
    return registration;
  }

  window.getPushDiagnostic = async function () {
    const result = {
      notificationPermission: "Notification" in window ? Notification.permission : "unsupported",
      serviceWorkerSupported: "serviceWorker" in navigator,
      pushSupported: "PushManager" in window,
      serviceWorkerRegistration: false,
      serviceWorkerState: null,
      serviceWorkerUrl: null,
      subscription: false,
      endpoint: null,
      vapidConfigured: false
    };
    try {
      const vapid = await hepiApi("/api/push/vapid-public-key");
      result.vapidConfigured = !!(vapid && vapid.key);
    } catch (error) {
      result.error = error.message;
    }
    if (!result.serviceWorkerSupported) return result;
    try {
      const registration = await getRegistration();
      result.serviceWorkerRegistration = !!registration;
      if (registration && registration.active) {
        result.serviceWorkerState = registration.active.state;
        result.serviceWorkerUrl = registration.active.scriptURL;
      }
      if (registration && result.pushSupported) {
        const subscription = await registration.pushManager.getSubscription();
        result.subscription = !!subscription;
        result.endpoint = subscription ? subscription.endpoint : null;
      }
    } catch (error) {
      result.error = error.message;
    }
    return result;
  };

  window.testLocalNotification = async function () {
    if (!supported()) throw new Error("Browser ini belum mendukung push notification.");
    if (Notification.permission !== "granted") throw new Error(pushErrorMessage());
    const registration = await getRegistration();
    await registration.showNotification("HEPI Test", {
      body: "Kalau ini muncul, Notification API dan service worker sudah bekerja.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: "hepi-local-test-" + Date.now(),
      data: { url: "/" }
    });
    return { ok: true };
  };

  async function enablePush(forceReset) {
    if (!supported()) throw new Error("Browser ini belum mendukung push notification.");
    if (Notification.permission === "denied") throw new Error(pushErrorMessage());

    const permission = Notification.permission === "granted"
      ? "granted"
      : await Notification.requestPermission();
    if (permission !== "granted") throw new Error(pushErrorMessage());

    const registration = await getRegistration();
    const existing = await registration.pushManager.getSubscription();
    if (forceReset && existing) await existing.unsubscribe();
    return subscribeNow(registration);
  }

  window.resetPushNotifications = function () {
    return enablePush(true).then(function(result) {
      window.dispatchEvent(new CustomEvent("hepi-push-status", { detail: { ok: true } }));
      return result;
    }).catch(function(error) {
      console.error("[push] reset failed", error);
      window.dispatchEvent(new CustomEvent("hepi-push-status", { detail: { ok: false, message: pushErrorMessage(error) } }));
      throw error;
    });
  };

  window.initPushNotifications = function () {
    if (!supported()) return;
    if (Notification.permission === "denied") return;

    getRegistration().then(function (registration) {
      registration.pushManager.getSubscription().then(function (existing) {
        // Re-save an existing browser subscription as well. The same browser
        // can be used by different agents, and the Sheet may have lost the
        // row, so returning here can silently leave notifications assigned to
        // the previous account.
        if (existing) {
          subscribeNow(registration).catch(function (error) {
            console.error("[push] existing subscription refresh failed", error);
          });
          return;
        }

        if (Notification.permission === "granted") {
          subscribeNow(registration).catch(function (error) {
            console.error("[push] subscription failed", error);
          });
          return;
        }

        if (wasDismissedRecently()) return;

        showBanner(function () {
          Notification.requestPermission().then(function (perm) {
            if (perm === "granted") {
              subscribeNow(registration).catch(function (error) {
                console.error("[push] subscription failed", error);
              });
            }
          });
        });
      }).catch(function(error) {
        console.error("[push] initialization failed", error);
      });
    }).catch(function(error) {
      console.error("[push] service worker unavailable", error);
    });
  };
})();

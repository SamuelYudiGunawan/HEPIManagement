"use strict";

const webpush = require("web-push");
const sheets = require("./sheets");
const agents = require("./agents");
const { SHEET_NAMES } = require("./config");
const { writeMutex } = require("./lock");
const crypto = require("crypto");

const SUB_RANGE = "A2:F";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@hepiproperty.com";

function hasVapid() {
  return !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

if (hasVapid()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function getRows() {
  await sheets.ensurePushSubscriptionSheet();
  return sheets.getValues(SHEET_NAMES.PUSH_SUBSCRIPTIONS, SUB_RANGE);
}

// One row per (agent, device) — an agent already subscribed on this exact
// device (same endpoint) just gets its row refreshed rather than duplicated.
async function saveSubscription(agentCode, subscription, userAgent) {
  const kodeAgen = String(agentCode || "").toUpperCase().trim();
  const endpoint = subscription && subscription.endpoint;
  if (!kodeAgen) throw new Error("Login dulu.");
  if (!endpoint) throw new Error("Data subscription tidak lengkap.");
  const keys = subscription.keys || {};

  const values = await getRows();
  const idx = values.findIndex((r) => String((r || [])[1] || "") === endpoint);
  const row = [kodeAgen, endpoint, keys.p256dh || "", keys.auth || "", String(userAgent || ""), new Date().toISOString()];
  if (idx >= 0) {
    await sheets.updateValues(SHEET_NAMES.PUSH_SUBSCRIPTIONS, "A" + (idx + 2) + ":F" + (idx + 2), [row]);
  } else {
    await sheets.appendValues(SHEET_NAMES.PUSH_SUBSCRIPTIONS, [row]);
  }
  return { ok: true };
}

async function removeByEndpoint(endpoint) {
  if (!endpoint) return;
  const values = await getRows();
  const idx = values.findIndex((r) => String((r || [])[1] || "") === endpoint);
  if (idx >= 0) await sheets.deleteRow(SHEET_NAMES.PUSH_SUBSCRIPTIONS, idx + 2);
}

async function unsubscribe(endpoint) {
  await removeByEndpoint(endpoint);
  return { ok: true };
}

function rowToSub(row) {
  return { endpoint: row[1], keys: { p256dh: row[2], auth: row[3] } };
}

// A push failure (agent uninstalled the PWA, revoked permission, endpoint
// expired, etc.) should never break the caller's actual action — feedback
// was already saved, a revision was already applied, etc. — so every
// failure here is swallowed after cleaning up a dead subscription; nothing
// is ever thrown back to the caller.
async function sendToRows(rows, payload) {
  if (!hasVapid() || !rows.length) return;
  const body = JSON.stringify(payload);
  await Promise.all(rows.map((row) =>
    webpush.sendNotification(rowToSub(row), body).catch((err) => {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        return removeByEndpoint(row[1]);
      }
    })
  ));
}

async function recordForAgents(kodes, payload) {
  try {
    const recipients = Array.from(new Set((kodes || []).map((k) => String(k || "").toUpperCase().trim()).filter(Boolean)));
    if (!recipients.length) return;
    await sheets.ensureNotificationSheet();
    const now = new Date().toISOString();
    await sheets.appendValues(SHEET_NAMES.NOTIFICATIONS, recipients.map((kode) => [
      "NTF-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex"),
      kode,
      String(payload.title || "HEPI Property"),
      String(payload.body || ""),
      String(payload.url || "/"),
      now
    ]));
  } catch (e) {
    // The notification inbox must never break the underlying action.
  }
}

async function notifyAgent(kodeAgen, payload) {
  try {
    const kode = String(kodeAgen || "").toUpperCase().trim();
    if (!kode) return;
    const rows = (await getRows()).filter((r) => String((r || [])[0] || "").toUpperCase() === kode);
    await recordForAgents([kode], payload);
    await sendToRows(rows, payload);
  } catch (e) {
    // best-effort — see sendToRows
  }
}

async function notifyAdminKantor(payload) {
  try {
    const agentMap = await agents.getAgentDataFromSheet();
    const kodes = Object.keys(agentMap).filter((k) => agentMap[k].status === "adminkantor");
    const rows = (await getRows()).filter((r) => kodes.indexOf(String((r || [])[0] || "").toUpperCase()) >= 0);
    await recordForAgents(kodes, payload);
    await sendToRows(rows, payload);
  } catch (e) {
    // best-effort — see sendToRows
  }
}

async function notifyDailyActivityReminder(kodes, dateKey) {
  const recipients = Array.from(new Set((kodes || [])
    .map((k) => String(k || "").toUpperCase().trim())
    .filter(Boolean)));
  if (!recipients.length) return { sent: 0, skipped: 0 };

  const title = "Pengingat Isi Aktivitas";
  const body = "Kamu belum mengisi aktivitas hari ini. Yuk isi sekarang.";
  let pending = [];
  await writeMutex.run(async () => {
    await sheets.ensureActivityReminderSheet();
    const values = await sheets.getValues(SHEET_NAMES.ACTIVITY_REMINDERS, "A2:D");
    const sentIds = new Set(values.map((row) => String((row || [])[0] || "")));
    pending = recipients.filter((kode) => !sentIds.has("ACT-REMINDER-" + dateKey + "-" + kode));
    if (!pending.length) return;

    const now = new Date().toISOString();
    await sheets.appendValues(SHEET_NAMES.ACTIVITY_REMINDERS, pending.map((kode) => [
      "ACT-REMINDER-" + dateKey + "-" + kode,
      dateKey,
      kode,
      now
    ]));
  });

  if (!pending.length) return { sent: 0, skipped: recipients.length };

  const payload = { title, body, url: "/activity" };
  await recordForAgents(pending, payload);
  try {
    const pendingSet = new Set(pending);
    const rows = (await getRows()).filter((row) => pendingSet.has(String((row || [])[0] || "").toUpperCase()));
    await sendToRows(rows, payload);
  } catch (e) {
    // The in-app notification is already recorded; push remains best-effort.
  }
  return { sent: pending.length, skipped: recipients.length - pending.length };
}

module.exports = {
  hasVapid,
  vapidPublicKey: VAPID_PUBLIC_KEY,
  saveSubscription,
  unsubscribe,
  notifyAgent,
  notifyAdminKantor,
  notifyDailyActivityReminder
};

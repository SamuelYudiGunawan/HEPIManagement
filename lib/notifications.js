"use strict";

const sheets = require("./sheets");
const { SHEET_NAMES } = require("./config");
const { writeMutex } = require("./lock");

const RANGE = "A2:F";
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

function rowToObject(row, rowNumber) {
  return {
    id: String(row[0] || ""),
    kodeAgen: String(row[1] || "").toUpperCase().trim(),
    title: String(row[2] || "HEPI Property"),
    body: String(row[3] || ""),
    url: String(row[4] || "/"),
    dateCreated: String(row[5] || ""),
    rowNumber
  };
}

function isFresh(item, now) {
  const at = Date.parse(item.dateCreated);
  return Number.isFinite(at) && now - at < MAX_AGE_MS && now >= at - 60000;
}

async function listForAgent(agentCode) {
  const kode = String(agentCode || "").toUpperCase().trim();
  await sheets.ensureNotificationSheet();
  const values = await sheets.getValues(SHEET_NAMES.NOTIFICATIONS, RANGE);
  const now = Date.now();
  return values.map((row, i) => rowToObject(row, i + 2))
    .filter((item) => item.kodeAgen === kode && isFresh(item, now))
    .sort((a, b) => Date.parse(b.dateCreated) - Date.parse(a.dateCreated));
}

async function clear(agentCode, notificationId) {
  return writeMutex.run(async () => {
    const kode = String(agentCode || "").toUpperCase().trim();
    await sheets.ensureNotificationSheet();
    const values = await sheets.getValues(SHEET_NAMES.NOTIFICATIONS, RANGE);
    const rows = values.map((row, i) => rowToObject(row, i + 2))
      .filter((item) => item.kodeAgen === kode && (!notificationId || item.id === String(notificationId)));
    const targets = rows.map((item) => item.rowNumber).sort((a, b) => b - a);
    for (const rowNumber of targets) await sheets.deleteRow(SHEET_NAMES.NOTIFICATIONS, rowNumber);
    return { ok: true, cleared: targets.length };
  });
}

module.exports = { listForAgent, clear };

"use strict";

const dates = require("./dates");
const activity = require("./activity");
const push = require("./push");

async function handleCron(now) {
  const current = now instanceof Date ? now : new Date();
  const parts = dates.partsInTz(current);
  if (parts.hour !== 22) {
    return { ok: true, skipped: true, reason: "outside_reminder_time" };
  }

  const dateKey = dates.ymd(current);
  const missing = await activity.listAgentsMissingActivity(dateKey);
  if (!missing.length) {
    return { ok: true, skipped: true, reason: "all_activities_filled", date: dateKey };
  }

  const result = await push.notifyDailyActivityReminder(missing, dateKey);
  return {
    ok: true,
    date: dateKey,
    missing: missing.length,
    notified: result.sent,
    alreadyNotified: result.skipped
  };
}

module.exports = { handleCron };

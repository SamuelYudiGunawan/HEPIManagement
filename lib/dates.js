"use strict";

const { TZ } = require("./config");

const BULAN = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];

function partsInTz(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz || TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const map = {};
  fmt.formatToParts(date).forEach((p) => { map[p.type] = p.value; });
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute)
  };
}

function ymd(date) {
  const p = partsInTz(date instanceof Date ? date : new Date());
  const mm = p.month < 10 ? "0" + p.month : String(p.month);
  const dd = p.day < 10 ? "0" + p.day : String(p.day);
  return p.year + "-" + mm + "-" + dd;
}

function currentBulanTahunFolderName() {
  const p = partsInTz(new Date());
  return BULAN[p.month - 1] + " " + p.year;
}

function formatBulanTahunForFrontend(value) {
  if (!value) return "";
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) {
    return BULAN[value.getMonth()] + " " + value.getFullYear();
  }
  if (typeof value === "number" && isFinite(value) && value > 20000) {
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d)) return BULAN[d.getUTCMonth()] + " " + d.getUTCFullYear();
  }
  return String(value);
}

function toDateKey(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return ymd(value);
  }
  if (typeof value === "number" && isFinite(value) && value > 20000) {
    const ms = (value - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d)) return ymd(d);
  }
  const s = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) return ymd(parsed);
  return s;
}

function parseDateInput(yyyyMmDd) {
  const m = String(yyyyMmDd || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error("Tanggal tidak valid.");
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(year, month - 1, day, 12, 0, 0);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    throw new Error("Tanggal tidak valid.");
  }
  return dt;
}

function dateCreatedMs(value) {
  if (!value) return 0;
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value)) return value.getTime();
  if (typeof value === "number" && isFinite(value)) {
    if (value > 1e12) return value;
    if (value > 20000) return (value - 25569) * 86400 * 1000;
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Converts a local wall-clock time (in `tz`) to a UTC epoch ms, without a
// timezone-database dependency. Works for both fixed-offset zones (e.g.
// Asia/Jakarta) and DST zones — it converges in at most 2 correction passes
// since offsets never shift by more than a day between guesses.
function localTimeToEpoch(year, month, day, hour, minute, tz) {
  let guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 2; i++) {
    const p = partsInTz(new Date(guess), tz);
    const wantDate = Date.UTC(year, month - 1, day);
    const gotDate = Date.UTC(p.year, p.month - 1, p.day);
    const diffMinutes = (hour * 60 + minute) - (p.hour * 60 + p.minute) + Math.round((wantDate - gotDate) / 60000);
    guess += diffMinutes * 60000;
  }
  return guess;
}

// The next time `hour:minute` (local, in `tz`) occurs at or after `fromMs`.
function nextDailyBoundary(fromMs, hour, minute, tz) {
  const p = partsInTz(new Date(fromMs), tz);
  let boundary = localTimeToEpoch(p.year, p.month, p.day, hour, minute, tz);
  if (boundary <= fromMs) {
    const nextDayParts = partsInTz(new Date(boundary + 24 * 3600 * 1000), tz);
    boundary = localTimeToEpoch(nextDayParts.year, nextDayParts.month, nextDayParts.day, hour, minute, tz);
  }
  return boundary;
}

function monthMeta(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthKey = year + "-" + (month < 10 ? "0" : "") + month;
  const labelDate = new Date(year, month - 1, 15, 12, 0, 0);
  return {
    year,
    month,
    monthKey,
    bulan: formatBulanTahunForFrontend(labelDate),
    daysInMonth
  };
}

module.exports = {
  BULAN,
  partsInTz,
  ymd,
  currentBulanTahunFolderName,
  formatBulanTahunForFrontend,
  toDateKey,
  parseDateInput,
  dateCreatedMs,
  monthMeta,
  localTimeToEpoch,
  nextDailyBoundary
};

"use strict";

try { require("dotenv").config(); } catch (e) {}

process.env.ACTIVITY_STORAGE = "mysql";

const sheets = require("../lib/sheets");
const activityDb = require("../lib/activityDb");
const dates = require("../lib/dates");
const {
  SHEET_NAMES,
  ACTIVITY_HEADERS,
  MEETING_ATTENDANCE_HEADERS
} = require("../lib/config");

const doImport = process.argv.includes("--import");
const showHelp = process.argv.includes("--help");

function blankRow(row) {
  return !row || !row.some((value) => String(value == null ? "" : value).trim());
}

function dateKey(value, sheetName, rowNumber, errors) {
  const valueKey = dates.toDateKey(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueKey)) {
    errors.push(sheetName + " row " + rowNumber + ": invalid date value.");
    return "";
  }
  return valueKey;
}

function safeText(value, limit, label, rowNumber, errors) {
  const text = String(value == null ? "" : value).trim();
  if (Buffer.byteLength(text, "utf8") > limit) errors.push(label + " row " + rowNumber + ": text exceeds " + limit + " bytes.");
  return text;
}

function safeCount(value, label, rowNumber, errors, allowNegative) {
  if (value === "" || value == null) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || (!allowNegative && number < 0)) {
    errors.push(label + " row " + rowNumber + ": invalid number.");
    return 0;
  }
  return Math.floor(number);
}

function safeScore(value, label, rowNumber, errors) {
  if (value === "" || value == null) return "";
  const number = Number(value);
  if (!Number.isFinite(number)) {
    errors.push(label + " row " + rowNumber + ": invalid score.");
    return "";
  }
  return number;
}

function sourceTimestampMs(value) {
  const text = String(value == null ? "" : value).trim();
  const dayFirst = text.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = Number(dayFirst[2]);
    const year = Number(dayFirst[3]);
    const hour = Number(dayFirst[4] || 0);
    const minute = Number(dayFirst[5] || 0);
    const second = Number(dayFirst[6] || 0);
    if (hour > 23 || minute > 59 || second > 59) return 0;
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
    const parsed = new Date(timestamp);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return 0;
    return timestamp;
  }
  return dates.dateCreatedMs(value);
}

function keepLatestPerDateAgent(rows, sourceRows, dateIndex, codeIndex, timestampIndex, label) {
  const selected = new Map();
  const duplicates = [];
  rows.forEach((row, index) => {
    const date = String(row[dateIndex] || "");
    const agentCode = String(row[codeIndex] || "").toUpperCase().trim();
    const key = date && agentCode ? date + "|" + agentCode : "invalid:" + index;
    const candidate = {
      row,
      index,
      sourceRow: sourceRows[index],
      timestamp: sourceTimestampMs(row[timestampIndex])
    };
    const current = selected.get(key);
    if (!current) {
      selected.set(key, candidate);
      return;
    }

    const candidateWins = candidate.timestamp > current.timestamp
      || (candidate.timestamp === current.timestamp && candidate.sourceRow > current.sourceRow);
    const kept = candidateWins ? candidate : current;
    const skipped = candidateWins ? current : candidate;
    duplicates.push({
      label,
      date,
      agentCode,
      keptSourceRow: kept.sourceRow,
      skippedSourceRow: skipped.sourceRow
    });
    if (candidateWins) selected.set(key, candidate);
  });

  const kept = Array.from(selected.values()).sort((a, b) => a.index - b.index);
  return { rows: kept.map((item) => item.row), duplicates };
}

async function readSource() {
  const [rawActivity, rawAttendance] = await Promise.all([
    sheets.getValues(SHEET_NAMES.DAILY_ACTIVITY, "A1:O"),
    sheets.getValues(SHEET_NAMES.MEETING_ATTENDANCE, "A1:H")
  ]);
  const errors = [];
  const activity = [];
  const activitySourceRows = [];
  const attendance = [];
  const attendanceSourceRows = [];

  rawActivity.slice(1).forEach((sourceRow, index) => {
    if (blankRow(sourceRow)) return;
    const rowNumber = index + 2;
    const row = ACTIVITY_HEADERS.map((_, i) => sourceRow[i] == null ? "" : sourceRow[i]);
    const date = dateKey(row[1], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors);
    const code = safeText(row[2], 32, SHEET_NAMES.DAILY_ACTIVITY + " agent code", rowNumber, errors).toUpperCase();
    if (!code) errors.push(SHEET_NAMES.DAILY_ACTIVITY + " row " + rowNumber + ": agent code is blank.");
    const timestamp = safeText(row[0], 40, SHEET_NAMES.DAILY_ACTIVITY + " timestamp", rowNumber, errors);
    const name = safeText(row[3], 160, SHEET_NAMES.DAILY_ACTIVITY + " agent name", rowNumber, errors);
    activity.push([
      timestamp, date, code, name,
      safeCount(row[4], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors, true),
      safeCount(row[5], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors, true),
      safeCount(row[6], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors, true),
      safeCount(row[7], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors, true),
      safeCount(row[8], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors, true),
      safeScore(row[9], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors),
      safeScore(row[10], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors),
      safeScore(row[11], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors),
      safeScore(row[12], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors),
      safeScore(row[13], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors),
      safeScore(row[14], SHEET_NAMES.DAILY_ACTIVITY, rowNumber, errors)
    ]);
    activitySourceRows.push(rowNumber);
  });

  rawAttendance.slice(1).forEach((sourceRow, index) => {
    if (blankRow(sourceRow)) return;
    const rowNumber = index + 2;
    const row = MEETING_ATTENDANCE_HEADERS.map((_, i) => sourceRow[i] == null ? "" : sourceRow[i]);
    const date = dateKey(row[0], SHEET_NAMES.MEETING_ATTENDANCE, rowNumber, errors);
    const code = safeText(row[1], 32, SHEET_NAMES.MEETING_ATTENDANCE + " agent code", rowNumber, errors).toUpperCase();
    if (!code) errors.push(SHEET_NAMES.MEETING_ATTENDANCE + " row " + rowNumber + ": agent code is blank.");
    const name = safeText(row[2], 160, SHEET_NAMES.MEETING_ATTENDANCE + " agent name", rowNumber, errors);
    const timestamp = safeText(row[3], 40, SHEET_NAMES.MEETING_ATTENDANCE + " timestamp", rowNumber, errors);
    const ip = safeText(row[5], 45, SHEET_NAMES.MEETING_ATTENDANCE + " IP", rowNumber, errors);
    attendance.push([
      date, code, name, timestamp,
      row[4] === "" || row[4] == null ? 100 : safeCount(row[4], SHEET_NAMES.MEETING_ATTENDANCE, rowNumber, errors),
      ip,
      safeCount(row[6], SHEET_NAMES.MEETING_ATTENDANCE, rowNumber, errors),
      safeScore(row[7], SHEET_NAMES.MEETING_ATTENDANCE, rowNumber, errors)
    ]);
    attendanceSourceRows.push(rowNumber);
  });

  const activityDeduped = keepLatestPerDateAgent(activity, activitySourceRows, 1, 2, 0, SHEET_NAMES.DAILY_ACTIVITY);
  const attendanceDeduped = keepLatestPerDateAgent(attendance, attendanceSourceRows, 0, 1, 3, SHEET_NAMES.MEETING_ATTENDANCE);
  return {
    activity: activityDeduped.rows,
    attendance: attendanceDeduped.rows,
    sourceActivityCount: activity.length,
    sourceAttendanceCount: attendance.length,
    resolvedDuplicates: activityDeduped.duplicates.concat(attendanceDeduped.duplicates),
    errors
  };
}

async function main() {
  if (showHelp) {
    console.log("Usage: node scripts/migrate-activity-to-mysql.js [--import]");
    console.log("Without --import, validates the Google Sheets source and prints a dry-run summary.");
    return;
  }
  if (!process.env.GOOGLE_SHEETS_ID) throw new Error("GOOGLE_SHEETS_ID is not set.");
  if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE || !process.env.MYSQL_PASSWORD) {
    throw new Error("Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE before running migration.");
  }

  const source = await readSource();
  console.log("Daily Activity rows in Sheets: " + source.sourceActivityCount + "; rows selected for MySQL: " + source.activity.length);
  console.log("Absensi Meeting rows in Sheets: " + source.sourceAttendanceCount + "; rows selected for MySQL: " + source.attendance.length);
  source.resolvedDuplicates.forEach((item) => {
    console.log(item.label + " duplicate " + item.date + " / " + item.agentCode
      + ": kept source row " + item.keptSourceRow + ", skipped older row " + item.skippedSourceRow + ".");
  });
  if (source.errors.length) {
    console.error("Source validation found " + source.errors.length + " issue(s):");
    source.errors.slice(0, 40).forEach((error) => console.error("- " + error));
    if (source.errors.length > 40) console.error("- Additional issues omitted.");
    process.exitCode = 1;
    return;
  }
  if (!doImport) {
    console.log("Dry run only; no database rows were written. Use --import after reviewing this report.");
    return;
  }

  const result = await activityDb.importRows(source.activity, source.attendance);
  console.log("Imported rows: Daily Activity=" + result.activity + ", Absensi Meeting=" + result.attendance);
  console.log("Google Sheets was left unchanged.");
}

main().catch((error) => {
  console.error(error && error.message ? error.message : "Migration failed.");
  process.exitCode = 1;
}).finally(() => activityDb.closePool().catch(() => {}));

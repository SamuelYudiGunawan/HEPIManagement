"use strict";

try { require("dotenv").config(); } catch (e) {}

process.env.ACTIVITY_STORAGE = "mysql";

const fs = require("fs");
const activityDb = require("../lib/activityDb");

const inputPath = process.argv[2];
const doRestore = process.argv.includes("--restore");

async function main() {
  if (!inputPath || inputPath === "--help") {
    console.log("Usage: node scripts/restore-activity-backup.js decrypted-backup.json [--restore]");
    console.log("Without --restore, validates the file and prints a dry-run summary.");
    return;
  }
  if (!process.env.MYSQL_HOST || !process.env.MYSQL_USER || !process.env.MYSQL_DATABASE || !process.env.MYSQL_PASSWORD) {
    throw new Error("Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, and MYSQL_DATABASE before restoring.");
  }
  const backup = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  if (backup.format !== "hepi-activity-backup-v1"
    || !Array.isArray(backup.activity) || !Array.isArray(backup.attendance)) {
    throw new Error("Unsupported or incomplete activity backup file.");
  }
  console.log("Backup created: " + String(backup.createdAt || "unknown"));
  console.log("Daily Activity rows: " + backup.activity.length);
  console.log("Absensi Meeting rows: " + backup.attendance.length);
  if (!doRestore) {
    console.log("Dry run only; no database rows were written. Use --restore after reviewing this report.");
    return;
  }
  const result = await activityDb.importRows(backup.activity, backup.attendance);
  console.log("Restored rows: Daily Activity=" + result.activity + ", Absensi Meeting=" + result.attendance);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : "Restore failed.");
  process.exitCode = 1;
}).finally(() => activityDb.closePool().catch(() => {}));

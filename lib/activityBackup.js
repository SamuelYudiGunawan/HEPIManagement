"use strict";

const crypto = require("crypto");
const zlib = require("zlib");
const activityDb = require("./activityDb");
const drive = require("./drive");

function getBackupFolderId() {
  const id = String(process.env.ACTIVITY_BACKUP_FOLDER_ID || "").trim();
  if (!id) throw new Error("ACTIVITY_BACKUP_FOLDER_ID is not set.");
  return id;
}

function getPublicKey() {
  const encoded = String(process.env.ACTIVITY_BACKUP_PUBLIC_KEY_B64 || "").trim();
  if (!encoded) throw new Error("ACTIVITY_BACKUP_PUBLIC_KEY_B64 is not set.");
  const pem = Buffer.from(encoded, "base64").toString("utf8");
  if (!pem.includes("BEGIN PUBLIC KEY")) throw new Error("Activity backup public key is invalid.");
  return pem;
}

function encryptBackup(payload) {
  const key = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const wrappedKey = crypto.publicEncrypt({
    key: getPublicKey(),
    padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: "sha256"
  }, key);
  return Buffer.from(JSON.stringify({
    format: "hepi-encrypted-activity-backup-v1",
    algorithm: "RSA-OAEP-SHA256+A256GCM+gzip",
    wrappedKey: wrappedKey.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  }), "utf8");
}

async function createDriveBackup() {
  if (!activityDb.enabled()) throw new Error("Activity backup requires ACTIVITY_STORAGE=mysql.");
  const payload = await activityDb.exportRows();
  const encrypted = encryptBackup(payload);
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const name = "hepi-activity-" + stamp + ".enc.json";
  const file = await drive.uploadFile(getBackupFolderId(), name, "application/json", encrypted);
  return {
    fileId: file.id,
    fileName: file.name,
    activityRows: payload.activity.length,
    attendanceRows: payload.attendance.length,
    bytes: encrypted.length
  };
}

module.exports = { createDriveBackup };

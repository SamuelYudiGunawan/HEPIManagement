"use strict";

const crypto = require("crypto");
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const [backupPath, privateKeyPath, outputPath] = process.argv.slice(2);
if (!backupPath || !privateKeyPath || !outputPath || backupPath === "--help") {
  console.error("Usage: node scripts/decrypt-activity-backup.js backup.enc.json private-key.pem output.json");
  process.exit(2);
}

const envelope = JSON.parse(fs.readFileSync(backupPath, "utf8"));
if (envelope.format !== "hepi-encrypted-activity-backup-v1") throw new Error("Unsupported backup format.");
const privateKey = fs.readFileSync(privateKeyPath, "utf8");
const key = crypto.privateDecrypt({
  key: privateKey,
  padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: "sha256"
}, Buffer.from(envelope.wrappedKey, "base64"));
const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
const compressed = Buffer.concat([
  decipher.update(Buffer.from(envelope.ciphertext, "base64")),
  decipher.final()
]);
const plaintext = zlib.gunzipSync(compressed);
const resolvedOutput = path.resolve(outputPath);
fs.writeFileSync(resolvedOutput, plaintext, { mode: 0o600, flag: "wx" });
console.log("Decrypted backup saved with owner-only permissions: " + resolvedOutput);

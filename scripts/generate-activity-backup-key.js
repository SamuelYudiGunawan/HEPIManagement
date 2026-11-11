"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const outputPath = process.argv[2];
if (!outputPath || outputPath === "--help") {
  console.error("Usage: node scripts/generate-activity-backup-key.js /path/outside/project/activity-backup-private.pem");
  process.exit(2);
}

const projectRoot = path.resolve(__dirname, "..");
const privatePath = path.resolve(outputPath);
if (privatePath === projectRoot || privatePath.startsWith(projectRoot + path.sep)) {
  console.error("Store the private key outside the website project folder.");
  process.exit(2);
}
if (fs.existsSync(privatePath)) {
  console.error("Refusing to overwrite an existing private key file.");
  process.exit(2);
}

const pair = crypto.generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});
fs.mkdirSync(path.dirname(privatePath), { recursive: true, mode: 0o700 });
fs.writeFileSync(privatePath, pair.privateKey, { mode: 0o600, flag: "wx" });
console.log("Private key saved locally: " + privatePath);
console.log("Add this single-line public key value to the hosting environment as ACTIVITY_BACKUP_PUBLIC_KEY_B64:");
console.log(Buffer.from(pair.publicKey, "utf8").toString("base64"));

"use strict";

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

let authClient = null;

function loadCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw && String(raw).trim()) {
    const s = String(raw).trim();
    if (s.startsWith("{")) return JSON.parse(s);
    const p = path.resolve(s);
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file) return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const local = path.join(__dirname, "..", "service-account.json");
  if (fs.existsSync(local)) return JSON.parse(fs.readFileSync(local, "utf8"));
  throw new Error("Missing Google service account. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.");
}

async function getAuth() {
  if (authClient) return authClient;
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  authClient = await auth.getClient();
  return authClient;
}

async function sheetsClient() {
  return google.sheets({ version: "v4", auth: await getAuth() });
}

async function driveClient() {
  return google.drive({ version: "v3", auth: await getAuth() });
}

function hasCredentials() {
  try {
    loadCredentials();
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { getAuth, sheetsClient, driveClient, hasCredentials, loadCredentials };

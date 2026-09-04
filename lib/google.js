"use strict";

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

let authClient = null;

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
];

function hasOAuthUserCreds() {
  return !!(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN
  );
}

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

  // Personal Gmail accounts have no Shared Drives / domain-wide delegation,
  // and a bare service account has zero storage quota of its own — so when
  // OAuth user credentials are configured, run as that real Google account
  // (its own quota, same as the old GAS script) instead of the service account.
  if (hasOAuthUserCreds()) {
    console.log("[google-auth] using OAuth user credentials (real Google account)");
    const oauth2 = new google.auth.OAuth2(
      process.env.GOOGLE_OAUTH_CLIENT_ID,
      process.env.GOOGLE_OAUTH_CLIENT_SECRET
    );
    oauth2.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
    authClient = oauth2;
    return authClient;
  }

  console.log("[google-auth] using service account credentials — GOOGLE_OAUTH_CLIENT_ID=%s GOOGLE_OAUTH_CLIENT_SECRET=%s GOOGLE_OAUTH_REFRESH_TOKEN=%s",
    process.env.GOOGLE_OAUTH_CLIENT_ID ? "set" : "MISSING",
    process.env.GOOGLE_OAUTH_CLIENT_SECRET ? "set" : "MISSING",
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN ? "set" : "MISSING");
  const credentials = loadCredentials();
  const auth = new google.auth.GoogleAuth({ credentials, scopes: SCOPES });
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
  if (hasOAuthUserCreds()) return true;
  try {
    loadCredentials();
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { getAuth, sheetsClient, driveClient, hasCredentials, loadCredentials, hasOAuthUserCreds };

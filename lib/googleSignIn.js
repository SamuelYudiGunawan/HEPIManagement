"use strict";

// End-user "Sign in with Google" — a SEPARATE OAuth client from the one in
// lib/google.js (that one is a service-level grant so the app's own
// Sheets/Drive writes run under a personal Gmail's storage quota; this one
// authenticates agents in the browser). Reuses google.auth.OAuth2 from the
// already-installed googleapis package — no extra dependency needed.

const { google } = require("googleapis");

const SCOPES = ["openid", "email", "profile"];

function client() {
  return new google.auth.OAuth2(
    process.env.SSO_GOOGLE_CLIENT_ID,
    process.env.SSO_GOOGLE_CLIENT_SECRET,
    process.env.SSO_GOOGLE_REDIRECT_URI
  );
}

function hasCredentials() {
  return !!(
    process.env.SSO_GOOGLE_CLIENT_ID &&
    process.env.SSO_GOOGLE_CLIENT_SECRET &&
    process.env.SSO_GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(state) {
  return client().generateAuthUrl({
    scope: SCOPES,
    state,
    prompt: "select_account"
  });
}

async function verifyCallback(code) {
  const oauth2Client = client();
  const { tokens } = await oauth2Client.getToken(code);
  const ticket = await oauth2Client.verifyIdToken({
    idToken: tokens.id_token,
    audience: process.env.SSO_GOOGLE_CLIENT_ID
  });
  const payload = ticket.getPayload() || {};
  return {
    email: String(payload.email || "").toLowerCase().trim(),
    emailVerified: !!payload.email_verified,
    name: String(payload.name || "").trim()
  };
}

module.exports = { hasCredentials, getAuthUrl, verifyCallback };

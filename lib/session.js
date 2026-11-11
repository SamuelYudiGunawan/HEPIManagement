"use strict";

// Stateless, signed-cookie session — no server-side store needed since the
// payload is small and non-secret (agentCode/nama/status/email). Same
// "roll a small crypto primitive with Node's core `crypto`" style already
// used elsewhere in this codebase (e.g. server.js's timingSafeStringEqual).

const crypto = require("crypto");

const COOKIE_NAME = "hepi_session";
// Keep browser sessions to one month so a stolen cookie has a shorter life.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function requireSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set.");
  return secret;
}

function sign(payloadB64) {
  return crypto.createHmac("sha256", requireSecret()).update(payloadB64).digest("base64url");
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ""));
  const bufB = Buffer.from(String(b || ""));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function createSessionCookie(data) {
  const issuedAt = Date.now();
  const payload = Buffer.from(JSON.stringify(Object.assign({}, data, {
    iat: issuedAt,
    exp: issuedAt + MAX_AGE_MS
  }))).toString("base64url");
  return payload + "." + sign(payload);
}

function verifySessionCookie(value) {
  if (!value) return null;
  const parts = String(value).split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!timingSafeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const now = Date.now();
    if (!Number.isFinite(data.iat) || !Number.isFinite(data.exp)
      || data.iat > now + 60000 || data.exp <= now || data.exp - data.iat > MAX_AGE_MS) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    const key = part.slice(0, idx).trim();
    if (!key) return;
    const value = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(value);
    } catch (e) {
      out[key] = value;
    }
  });
  return out;
}

module.exports = {
  COOKIE_NAME,
  MAX_AGE_MS,
  timingSafeEqual,
  createSessionCookie,
  verifySessionCookie,
  parseCookies
};

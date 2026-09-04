"use strict";

// Stateless, signed-cookie session — no server-side store needed since the
// payload is small and non-secret (agentCode/nama/status/email). Same
// "roll a small crypto primitive with Node's core `crypto`" style already
// used elsewhere in this codebase (e.g. server.js's timingSafeStringEqual).

const crypto = require("crypto");

const COOKIE_NAME = "hepi_session";
// 400 days: the practical max — Chrome clamps any Set-Cookie Max-Age past
// this to 400 days anyway, so asking for longer would just be silently
// truncated there while other browsers honored the longer value.
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

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
  const payload = Buffer.from(JSON.stringify(Object.assign({}, data, { exp: Date.now() + MAX_AGE_MS }))).toString("base64url");
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
    if (!data.exp || Date.now() > data.exp) return null;
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
    out[key] = decodeURIComponent(part.slice(idx + 1).trim());
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

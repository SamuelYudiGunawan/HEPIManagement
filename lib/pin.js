"use strict";

// Agent PINs used to be stored and compared as plain text straight from the
// "Data Agen" sheet. This hashes them with scrypt (Node's built-in, so no
// native-module install headaches on shared hosting) instead.
//
// Existing plaintext PINs are upgraded lazily: verifyPin() still accepts a
// plain value for backwards compatibility, and the caller (see
// agents.verifyAgentLogin) rewrites the sheet cell to a hash the next time
// that agent logs in successfully. There is no bulk migration step.

const crypto = require("crypto");

const PREFIX = "scrypt";
const KEY_LENGTH = 64;

function isHashed(value) {
  return typeof value === "string" && value.startsWith(PREFIX + "$");
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pin), salt, KEY_LENGTH);
  return PREFIX + "$" + salt.toString("hex") + "$" + hash.toString("hex");
}

function verifyPin(stored, candidate) {
  const storedStr = String(stored == null ? "" : stored);
  const candidateStr = String(candidate == null ? "" : candidate);

  if (!isHashed(storedStr)) {
    // Legacy plaintext PIN — compare directly. Not timing-safe, but a PIN
    // this short offers no meaningful timing-attack surface either way;
    // it gets upgraded to a hash on the caller's next successful login.
    return storedStr.length > 0 && storedStr === candidateStr;
  }

  const parts = storedStr.split("$");
  if (parts.length !== 3) return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(candidateStr, salt, KEY_LENGTH);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPin, verifyPin, isHashed };

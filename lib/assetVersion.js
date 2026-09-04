"use strict";

const fs = require("fs");
const crypto = require("crypto");

// mtime-keyed so unchanged files don't get re-hashed (re-reading disk +
// sha256 on every request) — only recomputes when a file's mtime moves.
const cache = new Map();

function hashFile(absPath) {
  const stat = fs.statSync(absPath);
  const cached = cache.get(absPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.hash;
  const buf = fs.readFileSync(absPath);
  const hash = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 10);
  cache.set(absPath, { mtimeMs: stat.mtimeMs, hash });
  return hash;
}

module.exports = { hashFile };

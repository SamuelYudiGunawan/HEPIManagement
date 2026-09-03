"use strict";

const RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_NET_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"]);

function statusFromError(err) {
  if (!err) return null;
  if (typeof err.code === "number") return err.code;
  if (err.response && typeof err.response.status === "number") return err.response.status;
  return null;
}

function isRetryable(err) {
  const status = statusFromError(err);
  if (status !== null && RETRYABLE_HTTP_STATUS.has(status)) return true;
  if (typeof err.code === "string" && RETRYABLE_NET_CODES.has(err.code)) return true;
  return false;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wraps a single Google API call with exponential backoff + jitter. `fn` is
// re-invoked from scratch on each attempt, so it must build its own request
// (this matters for streamed upload bodies, which can only be read once).
async function withRetry(fn, opts) {
  const attempts = (opts && opts.attempts) || 3;
  const baseDelayMs = (opts && opts.baseDelayMs) || 300;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetryable(err)) throw err;
      const jitter = Math.random() * baseDelayMs;
      await delay(baseDelayMs * Math.pow(2, i) + jitter);
    }
  }
  throw lastErr;
}

module.exports = { withRetry, isRetryable };

"use strict";

try {
  require("dotenv").config();
} catch (e) {
  // dotenv is optional; CloudLinux / LiteSpeed inject env vars themselves
}

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Fastify = require("fastify");
const { hasCredentials } = require("./lib/google");
const { ROOT_FOLDER_ID } = require("./lib/config");
const agents = require("./lib/agents");
const listings = require("./lib/listings");
const activity = require("./lib/activity");
const importer = require("./lib/import");
const formListing = require("./lib/formListing");
const { hashFile } = require("./lib/assetVersion");
const session = require("./lib/session");
const googleSignIn = require("./lib/googleSignIn");
const STATIC_DIR = path.join(__dirname, "static");
const HTML_DIR = path.join(__dirname, "html");
const BODY_LIMIT = 32 * 1024 * 1024;

const PAGE_FILES = {
  "/": "index.html",
  "/activity": "activity.html",
  "/scores": "scores.html",
  "/history": "history.html",
  "/closing": "closing.html",
  "/inputlisting": "inputlisting.html",
  "/form-listing": "formlisting.html",
  "/form-listing-review": "formlistingreview.html"
};

// Every page requires login, including "/" — an unauthenticated visitor is
// bounced to Google sign-in before any page's HTML/JS ever reaches the
// browser (rather than relying on a client-side modal, which can be
// inspected away).
const PUBLIC_ROUTES = new Set([]);

// Content-hashed asset URLs: the hash is derived from the file's own
// bytes, so any edit to styles-v2.css / hepi-api.js / textsize.js changes
// the URL automatically — both the browser's Service Worker cache and the
// host's edge cache (which was ignoring cache-busting query strings) treat
// a changed path as a brand-new resource, no manual rename needed anymore.
function assetUrl(relPath) {
  const abs = path.join(STATIC_DIR, relPath);
  return "/assets/" + hashFile(abs) + "/" + relPath;
}

function sendHtml(reply, filename) {
  const file = path.join(HTML_DIR, filename);
  let html = fs.readFileSync(file, "utf8");
  html = html
    .replace('href="/styles-v2.css"', 'href="' + assetUrl("styles-v2.css") + '"')
    .replace('src="/js/hepi-api.js"', 'src="' + assetUrl("js/hepi-api.js") + '"')
    .replace('src="/js/hepi-auth.js"', 'src="' + assetUrl("js/hepi-auth.js") + '"')
    .replace('src="/js/textsize.js"', 'src="' + assetUrl("js/textsize.js") + '"');
  return reply.type("text/html; charset=utf-8").send(html);
}

const ASSET_CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8"
};

function registerAssetRoute(app) {
  app.get("/assets/:hash/*", async (req, reply) => {
    const rel = String(req.params["*"] || "");
    const abs = path.normalize(path.join(STATIC_DIR, rel));
    if (abs !== STATIC_DIR && !abs.startsWith(STATIC_DIR + path.sep)) {
      return reply.status(400).send("Bad path");
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      return reply.status(404).send("Not found");
    }

    let body = fs.readFileSync(abs);
    if (rel === "js/hepi-api.js") {
      // rewrite the SW registration to this same content-hashed scheme
      const swHash = hashFile(path.join(STATIC_DIR, "sw-v2.js"));
      body = Buffer.from(
        body.toString("utf8").replace('"/sw-v2.js"', '"/assets/' + swHash + '/sw-v2.js"')
      );
    }

    const ext = path.extname(abs).toLowerCase();
    reply
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .type(ASSET_CONTENT_TYPES[ext] || "application/octet-stream")
      .send(body);
  });
}

function credsOrThrow() {
  if (!hasCredentials()) {
    const err = new Error("Google credentials are not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON.");
    err.statusCode = 503;
    throw err;
  }
  if (!process.env.GOOGLE_SHEETS_ID) {
    const err = new Error("GOOGLE_SHEETS_ID is not set.");
    err.statusCode = 503;
    throw err;
  }
  if (!ROOT_FOLDER_ID) {
    const err = new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID is not set.");
    err.statusCode = 503;
    throw err;
  }
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a == null ? "" : a));
  const bufB = Buffer.from(String(b == null ? "" : b));
  if (bufA.length !== bufB.length) {
    // still run a compare of equal length so a wrong-length token takes the
    // same time as a right-length one, rather than short-circuiting here
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isHttps(req) {
  return req.protocol === "https";
}

function setCookie(reply, req, name, value, maxAgeSeconds) {
  const parts = [
    name + "=" + encodeURIComponent(value),
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=" + maxAgeSeconds
  ];
  if (isHttps(req)) parts.push("Secure");
  reply.header("Set-Cookie", parts.join("; "));
}

function clearCookie(reply, req, name) {
  setCookie(reply, req, name, "", 0);
}

function sessionFrom(req) {
  const cookies = session.parseCookies(req.headers.cookie);
  return session.verifySessionCookie(cookies[session.COOKIE_NAME]);
}

function requireSession(req) {
  const s = sessionFrom(req);
  if (!s) {
    const err = new Error("Login dulu.");
    err.statusCode = 401;
    throw err;
  }
  return s;
}

function safeReturnTo(raw) {
  const value = String(raw || "");
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

async function readMultipart(req) {
  const fields = {};
  const files = {};
  const parts = req.parts();
  for await (const part of parts) {
    if (part.file) {
      const buf = await part.toBuffer();
      files[part.fieldname] = buf;
      files[part.fieldname + "Mime"] = part.mimetype;
      files[part.fieldname + "Name"] = part.filename;
    } else {
      fields[part.fieldname] = part.value;
    }
  }
  ["nego", "fullBangunan", "useOwnNarrative"].forEach((k) => {
    if (fields[k] === "true" || fields[k] === "1") fields[k] = true;
    if (fields[k] === "false" || fields[k] === "0") fields[k] = false;
  });
  return { fields, files };
}

async function build() {
  const app = Fastify({
    logger: true,
    bodyLimit: BODY_LIMIT,
    trustProxy: true
  });

  await app.register(require("@fastify/multipart"), {
    limits: { fileSize: BODY_LIMIT, files: 4 }
  });

  await app.register(require("@fastify/static"), {
    root: STATIC_DIR,
    prefix: "/",
    index: false,
    decorateReply: false
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode || 500;
    req.log.error(err);
    reply.status(status).send({ error: err.message || "Server error" });
  });

  // Some hosts front this app with LiteSpeed's page cache, which can cache a
  // dynamic response (e.g. the login-required redirect, or a page's HTML)
  // per visitor even though nothing here is meant to be edge-cached — the
  // hashed /assets/* routes already handle their own long-lived caching.
  // X-LiteSpeed-Cache-Control is LiteSpeed's own opt-out header, honored by
  // its cache engine regardless of any control-panel cache configuration.
  app.addHook("onSend", async (req, reply, payload) => {
    if (!req.url.startsWith("/assets/")) {
      reply.header("X-LiteSpeed-Cache-Control", "no-cache");
    }
    return payload;
  });

  Object.keys(PAGE_FILES).forEach((route) => {
    const file = PAGE_FILES[route];
    app.get(route, async (req, reply) => {
      if (!PUBLIC_ROUTES.has(route) && !sessionFrom(req)) {
        return reply.redirect("/auth/google?returnTo=" + encodeURIComponent(route));
      }
      return sendHtml(reply, file);
    });
  });

  registerAssetRoute(app);

  app.get("/api/health", async () => ({
    ok: true,
    google: hasCredentials(),
    sheets: !!process.env.GOOGLE_SHEETS_ID
  }));

  app.get("/auth/google", async (req, reply) => {
    if (!googleSignIn.hasCredentials()) {
      const err = new Error("Google sign-in belum dikonfigurasi.");
      err.statusCode = 503;
      throw err;
    }
    const returnTo = safeReturnTo(req.query.returnTo);
    const state = crypto.randomBytes(16).toString("hex");
    setCookie(reply, req, "hepi_oauth_state", state + "|" + returnTo, 600);
    return reply.redirect(googleSignIn.getAuthUrl(state));
  });

  app.get("/auth/google/callback", async (req, reply) => {
    const cookies = session.parseCookies(req.headers.cookie);
    const stored = String(cookies.hepi_oauth_state || "");
    clearCookie(reply, req, "hepi_oauth_state");
    const [storedState, storedReturnTo] = stored.split("|");
    const returnTo = safeReturnTo(storedReturnTo);
    const state = String(req.query.state || "");
    const code = String(req.query.code || "");
    if (!storedState || !session.timingSafeEqual(state, storedState)) {
      return reply.redirect("/?ssoError=state");
    }
    if (!code) {
      return reply.redirect("/?ssoError=state");
    }

    let profile;
    try {
      profile = await googleSignIn.verifyCallback(code);
    } catch (e) {
      req.log.error(e);
      return reply.redirect("/?ssoError=oauth");
    }
    if (!profile.emailVerified || !profile.email) {
      return reply.redirect("/?ssoError=not_whitelisted");
    }

    credsOrThrow();
    const agent = await agents.findAgentByEmail(profile.email);
    if (!agent || !agents.isAgentActive(agent)) {
      return reply.redirect("/?ssoError=not_whitelisted");
    }

    const cookieValue = session.createSessionCookie({
      agentCode: agent.kode,
      nama: agent.nama || agent.kode,
      status: agent.status || "",
      email: profile.email
    });
    setCookie(reply, req, session.COOKIE_NAME, cookieValue, session.MAX_AGE_MS / 1000);
    return reply.redirect(returnTo);
  });

  app.get("/auth/logout", async (req, reply) => {
    clearCookie(reply, req, session.COOKIE_NAME);
    return reply.redirect("/");
  });

  app.get("/api/me", async (req) => {
    const s = sessionFrom(req);
    if (!s) return { loggedIn: false };
    return {
      loggedIn: true,
      agentCode: s.agentCode,
      nama: s.nama,
      status: s.status,
      email: s.email
    };
  });

  app.get("/api/listings", async () => {
    credsOrThrow();
    return listings.getListings();
  });

  app.post("/api/sold", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    const status = await listings.markAsSold(body.fileId, agentCode);
    return { status };
  });

  app.get("/api/narrative/:id", async (req) => {
    credsOrThrow();
    return listings.getNarrativeText(req.params.id);
  });

  app.post("/api/narratives", async (req) => {
    credsOrThrow();
    const ids = (req.body && req.body.fileIds) || [];
    return listings.getNarrativeTexts(ids);
  });

  app.post("/api/agents", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    const which = String(body.for || "listing").toLowerCase();
    if (which === "closing") return activity.getActiveAgentsForClosing(agentCode);
    return listings.getActiveAgentsForListing(agentCode);
  });

  app.post("/api/input-listing", async (req) => {
    credsOrThrow();
    const isMulti = typeof req.isMultipart === "function" && req.isMultipart();
    if (isMulti) {
      const { fields, files } = await readMultipart(req);
      const { agentCode } = requireSession(req);
      return listings.submitOneListing(agentCode, fields, files);
    }
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    return listings.submitOneListing(agentCode, body, {});
  });

  app.post("/api/activity", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    return activity.submitDailyActivity(agentCode, body);
  });

  app.post("/api/activity/check", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    return activity.checkDailyActivityDate(agentCode, body.tanggal);
  });

  app.post("/api/scores", async (req) => {
    credsOrThrow();
    const { agentCode } = requireSession(req);
    return activity.getMonthlyAgentScores(agentCode);
  });

  app.post("/api/history", async (req) => {
    credsOrThrow();
    const { agentCode } = requireSession(req);
    return activity.getAgentMonthHistory(agentCode);
  });

  app.post("/api/closings", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    return activity.submitClosings(agentCode, body);
  });

  app.post("/api/form-listing/submit", async (req) => {
    credsOrThrow();
    const { fields, files } = await readMultipart(req);
    const { agentCode } = requireSession(req);
    return formListing.submitOneForm(agentCode, fields, files);
  });

  app.post("/api/form-listing/mine", async (req) => {
    credsOrThrow();
    const { agentCode } = requireSession(req);
    return formListing.listForAgent(agentCode);
  });

  app.post("/api/form-listing/queue", async (req) => {
    credsOrThrow();
    const { agentCode } = requireSession(req);
    return formListing.listForAdmin(agentCode);
  });

  app.post("/api/form-listing/feedback", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    return formListing.giveFeedback(agentCode, body.fileId, body.feedback);
  });

  app.post("/api/form-listing/done", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode } = requireSession(req);
    return formListing.markDone(agentCode, body.fileId);
  });

  app.post("/api/form-listing/edit", async (req) => {
    credsOrThrow();
    const { fields, files } = await readMultipart(req);
    const { agentCode } = requireSession(req);
    return formListing.editSubmission(agentCode, fields.fileId, fields, files);
  });

  app.get("/api/cron/import", async (req, reply) => {
    const token = String(req.query.token || req.headers["x-cron-token"] || "");
    const secret = String(process.env.CRON_SECRET || "");
    if (!secret || !timingSafeStringEqual(token, secret)) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    credsOrThrow();
    const force = String(req.query.force || "") === "1";
    if (force) return importer.runImport(true, req.log);
    return importer.handleCron(req.log);
  });

  return app;
}

function listenOptions() {
  const raw = process.env.PORT;
  const host = process.env.HOST || "127.0.0.1";

  // CloudLinux Passenger (rare on Niagahoster; they use LiteSpeed lsnode)
  if (typeof PhusionPassenger !== "undefined") {
    PhusionPassenger.configure({ autoInstall: false });
    return { path: "passenger" };
  }

  // LiteSpeed sets PORT to a unix socket path, not a number
  if (raw && String(raw).startsWith("/")) {
    return { path: String(raw) };
  }

  const port = Number(raw);
  return {
    port: Number.isFinite(port) && port > 0 ? port : 3000,
    host
  };
}

async function start() {
  const app = await build();
  try {
    await app.listen(listenOptions());
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// LiteSpeed loads this file via require() from lsnode.js, so require.main
// is NOT this module. Always start.
start();

module.exports = { build };

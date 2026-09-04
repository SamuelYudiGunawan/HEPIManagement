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

function authFrom(body, query) {
  const src = body || {};
  const q = query || {};
  return {
    agentCode: src.agentCode || src.kode || q.agentCode || "",
    pin: src.pin || q.pin || ""
  };
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

  Object.keys(PAGE_FILES).forEach((route) => {
    const file = PAGE_FILES[route];
    app.get(route, async (req, reply) => sendHtml(reply, file));
  });

  registerAssetRoute(app);

  app.get("/api/health", async () => ({
    ok: true,
    google: hasCredentials(),
    sheets: !!process.env.GOOGLE_SHEETS_ID
  }));

  app.post("/api/login", async (req) => {
    credsOrThrow();
    const { agentCode, pin } = authFrom(req.body);
    return agents.verifyAgentLogin(agentCode, pin);
  });

  app.get("/api/listings", async () => {
    credsOrThrow();
    return listings.getListings();
  });

  app.post("/api/sold", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    const status = await listings.markAsSold(body.fileId, agentCode, pin);
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
    const { agentCode, pin } = authFrom(body);
    const which = String(body.for || "listing").toLowerCase();
    if (which === "closing") return activity.getActiveAgentsForClosing(agentCode, pin);
    return listings.getActiveAgentsForListing(agentCode, pin);
  });

  app.post("/api/input-listing", async (req) => {
    credsOrThrow();
    const isMulti = typeof req.isMultipart === "function" && req.isMultipart();
    if (isMulti) {
      const { fields, files } = await readMultipart(req);
      const { agentCode, pin } = authFrom(fields);
      return listings.submitOneListing(agentCode, pin, fields, files);
    }
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return listings.submitOneListing(agentCode, pin, body, {});
  });

  app.post("/api/activity", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return activity.submitDailyActivity(agentCode, pin, body);
  });

  app.post("/api/activity/check", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return activity.checkDailyActivityDate(agentCode, pin, body.tanggal);
  });

  app.post("/api/scores", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return activity.getMonthlyAgentScores(agentCode, pin);
  });

  app.post("/api/history", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return activity.getAgentMonthHistory(agentCode, pin);
  });

  app.post("/api/closings", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return activity.submitClosings(agentCode, pin, body);
  });

  app.post("/api/form-listing/submit", async (req) => {
    credsOrThrow();
    const { fields, files } = await readMultipart(req);
    const { agentCode, pin } = authFrom(fields);
    return formListing.submitOneForm(agentCode, pin, fields, files);
  });

  app.post("/api/form-listing/mine", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return formListing.listForAgent(agentCode, pin);
  });

  app.post("/api/form-listing/queue", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return formListing.listForAdmin(agentCode, pin);
  });

  app.post("/api/form-listing/feedback", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return formListing.giveFeedback(agentCode, pin, body.fileId, body.feedback);
  });

  app.post("/api/form-listing/done", async (req) => {
    credsOrThrow();
    const body = req.body || {};
    const { agentCode, pin } = authFrom(body);
    return formListing.markDone(agentCode, pin, body.fileId);
  });

  app.post("/api/form-listing/edit", async (req) => {
    credsOrThrow();
    const { fields, files } = await readMultipart(req);
    const { agentCode, pin } = authFrom(fields);
    return formListing.editSubmission(agentCode, pin, fields.fileId, fields, files);
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

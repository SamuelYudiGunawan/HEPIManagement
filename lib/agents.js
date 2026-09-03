"use strict";

const sheets = require("./sheets");
const { SHEET_NAMES } = require("./config");
const { normalizePhone_ } = require("./parser");
const { hashPin, verifyPin, isHashed } = require("./pin");

let agentCache = { at: 0, data: null };
const AGENT_TTL = 30 * 1000;

function invalidateAgents() {
  agentCache = { at: 0, data: null };
}

async function getAgentDataFromSheet(force) {
  if (!force && agentCache.data && Date.now() - agentCache.at < AGENT_TTL) {
    return agentCache.data;
  }
  await sheets.ensureAgentSheet();
  const values = await sheets.getValues(SHEET_NAMES.AGENTS, "A2:F");
  const agents = {};
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const kode = String(row[0] || "").toUpperCase().trim();
    const nama = String(row[1] || "").trim();
    const pin = String(row[2] || "").trim();
    const status = String(row[3] || "").toLowerCase().trim();
    const hp = normalizePhone_(row[4]);
    const active = String(row[5] || "ya").trim().toLowerCase();
    if (!kode) continue;
    agents[kode] = { kode, nama, pin, status, hp, active, rowNumber: i + 2 };
  }
  agentCache = { at: Date.now(), data: agents };
  return agents;
}

async function upgradeAgentPinHash(agent, plainPin) {
  // Lazily migrate this agent's PIN to a hash now that we've seen it in the
  // clear. Best-effort: a failed write just means we try again next login.
  try {
    await sheets.updateValues(SHEET_NAMES.AGENTS, "C" + agent.rowNumber, [[hashPin(plainPin)]]);
    invalidateAgents();
  } catch (e) {
    // swallow — login already succeeded, this is just housekeeping
  }
}

async function verifyAgentLogin(agentCode, pin) {
  agentCode = String(agentCode || "").toUpperCase().trim();
  pin = String(pin || "").trim();
  const agents = await getAgentDataFromSheet();
  const agent = agents[agentCode];
  if (agent && verifyPin(agent.pin, pin)) {
    if (!isHashed(agent.pin)) await upgradeAgentPinHash(agent, pin);
    return {
      valid: true,
      nama: agent.nama || agentCode,
      status: agent.status || "",
      hp: agent.hp || ""
    };
  }
  return { valid: false, pesan: "🤣 wkwkwk... NGAWUR! SALAH!" };
}

async function requireAgent(agentCode, pin) {
  const result = await verifyAgentLogin(agentCode, pin);
  if (!result || !result.valid) {
    const err = new Error((result && result.pesan) || "Login dulu.");
    err.statusCode = 401;
    throw err;
  }
  const agents = await getAgentDataFromSheet();
  return agents[String(agentCode || "").toUpperCase().trim()];
}

async function requireAdmin(agentCode, pin) {
  const agent = await requireAgent(agentCode, pin);
  if (String(agent.status || "").toLowerCase().trim() !== "admin") {
    const err = new Error("Hanya admin yang bisa akses.");
    err.statusCode = 403;
    throw err;
  }
  return agent;
}

function isListingEditor(agent) {
  const status = String((agent && agent.status) || "").toLowerCase().trim();
  return status === "admin" || status === "adminkantor";
}

async function requireListingEditor(agentCode, pin) {
  const agent = await requireAgent(agentCode, pin);
  if (!isListingEditor(agent)) {
    const err = new Error("Hanya admin atau adminkantor yang bisa akses.");
    err.statusCode = 403;
    throw err;
  }
  return agent;
}

function isAgentActive(agent) {
  const active = String((agent && agent.active) || "ya").trim().toLowerCase();
  return active !== "tidak" && active !== "no" && active !== "n" && active !== "nonaktif";
}

async function listActiveAgents() {
  const agents = await getAgentDataFromSheet();
  const list = [];
  Object.keys(agents).forEach((kode) => {
    const a = agents[kode];
    if (!isAgentActive(a)) return;
    list.push({
      kode: a.kode,
      nama: a.nama || a.kode,
      hp: a.hp || ""
    });
  });
  list.sort((a, b) => String(a.nama).localeCompare(String(b.nama), "id"));
  return list;
}

module.exports = {
  invalidateAgents,
  getAgentDataFromSheet,
  verifyAgentLogin,
  requireAgent,
  requireAdmin,
  isListingEditor,
  requireListingEditor,
  isAgentActive,
  listActiveAgents
};

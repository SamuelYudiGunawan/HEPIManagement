"use strict";

const sheets = require("./sheets");
const { SHEET_NAMES } = require("./config");
const { normalizePhone_ } = require("./parser");

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
  const values = await sheets.getValues(SHEET_NAMES.AGENTS, "A2:G");
  const agents = {};
  for (let i = 0; i < values.length; i++) {
    const row = values[i] || [];
    const kode = String(row[0] || "").toUpperCase().trim();
    const nama = String(row[1] || "").trim();
    const status = String(row[3] || "").toLowerCase().trim();
    const hp = normalizePhone_(row[4]);
    const active = String(row[5] || "ya").trim().toLowerCase();
    const email = String(row[6] || "").toLowerCase().trim();
    if (!kode) continue;
    agents[kode] = { kode, nama, email, status, hp, active, rowNumber: i + 2 };
  }
  agentCache = { at: Date.now(), data: agents };
  return agents;
}

async function findAgentByEmail(email) {
  const normalized = String(email || "").toLowerCase().trim();
  if (!normalized) return null;
  const agentsMap = await getAgentDataFromSheet();
  const kode = Object.keys(agentsMap).find((k) => agentsMap[k].email === normalized);
  return kode ? agentsMap[kode] : null;
}

async function requireAgent(agentCode) {
  agentCode = String(agentCode || "").toUpperCase().trim();
  const agentsMap = await getAgentDataFromSheet();
  const agent = agentsMap[agentCode];
  if (!agent || !isAgentActive(agent)) {
    const err = new Error("Login dulu.");
    err.statusCode = 401;
    throw err;
  }
  return agent;
}

async function requireAdmin(agentCode) {
  const agent = await requireAgent(agentCode);
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

async function requireListingEditor(agentCode) {
  const agent = await requireAgent(agentCode);
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
  findAgentByEmail,
  requireAgent,
  requireAdmin,
  isListingEditor,
  requireListingEditor,
  isAgentActive,
  listActiveAgents
};

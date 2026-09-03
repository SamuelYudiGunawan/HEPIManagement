"use strict";

const { sheetsClient } = require("./google");
const { withRetry } = require("./retry");
const { hashPin } = require("./pin");
const {
  SHEETS_ID,
  SHEET_NAMES,
  PROPERTY_HEADERS,
  ACTIVITY_HEADERS,
  AGENT_HEADERS,
  LOG_SOLD_HEADERS
} = require("./config");

function quoteSheet(name) {
  return "'" + String(name).replace(/'/g, "''") + "'";
}

function a1(sheetName, range) {
  return quoteSheet(sheetName) + "!" + range;
}

function requireSheetsId() {
  if (!SHEETS_ID) throw new Error("GOOGLE_SHEETS_ID is not set.");
  return SHEETS_ID;
}

let metaCache = { at: 0, sheets: null };

async function getSheetMeta(force) {
  if (!force && metaCache.sheets && Date.now() - metaCache.at < 60000) return metaCache.sheets;
  const sheets = await sheetsClient();
  const res = await withRetry(() => sheets.spreadsheets.get({
    spreadsheetId: requireSheetsId(),
    fields: "sheets.properties"
  }));
  metaCache = {
    at: Date.now(),
    sheets: (res.data.sheets || []).map((s) => s.properties)
  };
  return metaCache.sheets;
}

async function ensureSheet(title, headers) {
  const sheets = await sheetsClient();
  const id = requireSheetsId();
  let meta = await getSheetMeta();
  let found = meta.find((p) => p.title === title);
  if (!found) {
    await withRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title } } }]
      }
    }));
    metaCache.sheets = null;
    meta = await getSheetMeta(true);
    found = meta.find((p) => p.title === title);
    if (headers && headers.length) {
      await updateValues(title, "A1", [headers]);
    }
    return found;
  }

  const values = await getValues(title, "A1:AZ1");
  const existing = (values[0] || []).map((v) => String(v || "").trim());
  if (!existing.length && headers && headers.length) {
    await updateValues(title, "A1", [headers]);
    return found;
  }
  if (headers && headers.length) {
    let needsRepair = false;
    for (let i = 0; i < headers.length; i++) {
      if (existing[i] !== headers[i]) {
        needsRepair = true;
        break;
      }
    }
    if (needsRepair) {
      await updateValues(title, "A1", [headers]);
    }
  }
  return found;
}

async function getValues(sheetName, range, opts) {
  const sheets = await sheetsClient();
  const res = await withRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: requireSheetsId(),
    range: a1(sheetName, range),
    valueRenderOption: (opts && opts.render) || "UNFORMATTED_VALUE",
    dateTimeRenderOption: (opts && opts.dates) || "FORMATTED_STRING"
  }));
  return res.data.values || [];
}

async function updateValues(sheetName, range, values, userEntered) {
  const sheets = await sheetsClient();
  await withRetry(() => sheets.spreadsheets.values.update({
    spreadsheetId: requireSheetsId(),
    range: a1(sheetName, range),
    valueInputOption: userEntered ? "USER_ENTERED" : "RAW",
    requestBody: { values }
  }));
}

async function appendValues(sheetName, values) {
  const sheets = await sheetsClient();
  const res = await withRetry(() => sheets.spreadsheets.values.append({
    spreadsheetId: requireSheetsId(),
    range: a1(sheetName, "A1"),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values }
  }));
  const updated = res.data.updates && res.data.updates.updatedRange;
  let row = 0;
  if (updated) {
    const m = String(updated).match(/![A-Z]+(\d+)/);
    if (m) row = Number(m[1]);
  }
  return row;
}

async function getFormula(sheetName, cell) {
  const values = await getValues(sheetName, cell, { render: "FORMULA" });
  return String((values[0] && values[0][0]) || "").trim();
}

async function ensurePropertySheet() {
  return ensureSheet(SHEET_NAMES.PROPERTIES, PROPERTY_HEADERS);
}

async function ensureAgentSheet() {
  const sheets = await sheetsClient();
  const id = requireSheetsId();
  const meta = await getSheetMeta();
  const found = meta.find((p) => p.title === SHEET_NAMES.AGENTS);
  if (!found) {
    await withRetry(() => sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAMES.AGENTS } } }] }
    }));
    metaCache.sheets = null;
    await updateValues(SHEET_NAMES.AGENTS, "A1", [AGENT_HEADERS]);
    await appendValues(SHEET_NAMES.AGENTS, [["ADM1", "Admin Utama", hashPin("12345"), "admin", "", "ya"]]);
    return;
  }
  const values = await getValues(SHEET_NAMES.AGENTS, "A1:F1");
  if (!values.length) {
    await updateValues(SHEET_NAMES.AGENTS, "A1", [AGENT_HEADERS]);
    await appendValues(SHEET_NAMES.AGENTS, [["ADM1", "Admin Utama", hashPin("12345"), "admin", "", "ya"]]);
  }
}

async function ensureLogSoldSheet() {
  return ensureSheet(SHEET_NAMES.LOG_SOLD, LOG_SOLD_HEADERS);
}

async function ensureDailyActivitySheet() {
  await ensureSheet(SHEET_NAMES.DAILY_ACTIVITY, ACTIVITY_HEADERS);
  try {
    const formula = await getFormula(SHEET_NAMES.DAILY_ACTIVITY, "J2");
    if (!formula) {
      await updateValues(SHEET_NAMES.DAILY_ACTIVITY, "J2:O2", [[
        "=ARRAYFORMULA(IF(LEN(C2:C),N(E2:E)*50,))",
        "=ARRAYFORMULA(IF(LEN(C2:C),N(F2:F)*50,))",
        "=ARRAYFORMULA(IF(LEN(C2:C),N(G2:G)*1,))",
        "=ARRAYFORMULA(IF(LEN(C2:C),N(H2:H)*50,))",
        "=ARRAYFORMULA(IF(LEN(C2:C),N(I2:I)*1,))",
        "=ARRAYFORMULA(IF(LEN(C2:C),N(E2:E)*50+N(F2:F)*50+N(G2:G)*1+N(H2:H)*50+N(I2:I)*1,))"
      ]], true);
    }
  } catch (e) {
    // formulas are optional if the sheet already has them
  }
}

function colLetter(index0) {
  let n = index0 + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

module.exports = {
  quoteSheet,
  a1,
  requireSheetsId,
  getSheetMeta,
  ensureSheet,
  getValues,
  updateValues,
  appendValues,
  ensurePropertySheet,
  ensureAgentSheet,
  ensureLogSoldSheet,
  ensureDailyActivitySheet,
  colLetter
};

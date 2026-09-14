"use strict";

// Preview and optionally remove duplicate Data Properti rows. This script
// never deletes Drive files; it only removes older duplicate Sheet rows.
require("dotenv").config();

const { sheetsClient } = require("../lib/google");
const sheets = require("../lib/sheets");
const { SHEET_NAMES, SHEETS_ID } = require("../lib/config");

function normalize(value) {
  return String(value || "").trim().replace(/\/+$/, "").toLowerCase();
}

function colIndex(headers, name) {
  const index = headers.findIndex((header) => normalize(header) === name);
  if (index < 0) throw new Error("Kolom " + name + " tidak ditemukan.");
  return index;
}

async function getPropertySheetId() {
  const client = await sheetsClient();
  const response = await client.spreadsheets.get({
    spreadsheetId: SHEETS_ID,
    fields: "sheets.properties"
  });
  const sheet = (response.data.sheets || [])
    .map((item) => item.properties)
    .find((properties) => properties.title === SHEET_NAMES.PROPERTIES);
  if (!sheet) throw new Error("Sheet " + SHEET_NAMES.PROPERTIES + " tidak ditemukan.");
  return { client, sheetId: sheet.sheetId };
}

function findDuplicateGroups(values) {
  const headers = (values[0] || []).map((value) => String(value || "").trim());
  const folderIndex = colIndex(headers, "folder_link");
  const categoryIndex = colIndex(headers, "kategori");
  const fileIdIndex = colIndex(headers, "file_id");
  const fileNameIndex = colIndex(headers, "file_name");
  const groups = new Map();

  values.slice(1).forEach((row, offset) => {
    const rowNumber = offset + 2;
    const folderLink = String(row[folderIndex] || "").trim();
    const category = String(row[categoryIndex] || "").trim();
    const key = normalize(folderLink) + "|" + normalize(category);
    if (!folderLink || !category || key === "|") return;

    const entry = {
      rowNumber,
      fileId: String(row[fileIdIndex] || "").trim(),
      fileName: String(row[fileNameIndex] || "").trim(),
      folderLink,
      kategori: category
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  return Array.from(groups.values())
    .filter((rows) => rows.length > 1)
    .map((rows) => {
      rows.sort((a, b) => b.rowNumber - a.rowNumber);
      return {
        key: normalize(rows[0].folderLink) + "|" + normalize(rows[0].kategori),
        keep: rows[0],
        remove: rows.slice(1)
      };
    });
}

async function removeRows(groups) {
  const { client, sheetId } = await getPropertySheetId();
  const rowsToDelete = groups
    .flatMap((group) => group.remove.map((row) => row.rowNumber))
    .sort((a, b) => b - a);
  if (!rowsToDelete.length) return;

  await client.spreadsheets.batchUpdate({
    spreadsheetId: SHEETS_ID,
    requestBody: {
      requests: rowsToDelete.map((rowNumber) => ({
        deleteDimension: {
          range: {
            sheetId,
            dimension: "ROWS",
            startIndex: rowNumber - 1,
            endIndex: rowNumber
          }
        }
      }))
    }
  });
}

async function main() {
  if (!SHEETS_ID) throw new Error("GOOGLE_SHEETS_ID belum diatur.");
  const values = await sheets.getValues(SHEET_NAMES.PROPERTIES, "A1:AZ");
  const groups = findDuplicateGroups(values);
  const report = {
    sheet: SHEET_NAMES.PROPERTIES,
    duplicateGroups: groups.length,
    duplicateRows: groups.reduce((total, group) => total + group.remove.length, 0),
    groups,
    applied: false
  };

  if (process.argv.includes("--apply")) {
    if (!process.argv.includes("--confirm")) {
      throw new Error("Mode apply membutuhkan --confirm. Preview tidak mengubah Sheet.");
    }
    await removeRows(groups);
    report.applied = true;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});


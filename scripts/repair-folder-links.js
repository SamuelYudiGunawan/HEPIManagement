"use strict";

// Repair only the folder_link column in Data Properti. The narrative file's
// current Drive parent is the source of truth; no Drive files are moved.
require("dotenv").config();

const drive = require("../lib/drive");
const sheets = require("../lib/sheets");
const { sheetsClient } = require("../lib/google");
const { withRetry } = require("../lib/retry");
const { SHEET_NAMES, SHEETS_ID } = require("../lib/config");

const BATCH_SIZE = 8;
const UPDATE_BATCH_SIZE = 100;

function text(value) { return String(value == null ? "" : value).trim(); }

function folderIdFromLink(value) {
  const match = text(value).match(/\/folders\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : "";
}

function parseRowFilter() {
  const arg = process.argv.find((value) => value.indexOf("--row=") === 0);
  if (!arg) return null;
  const row = Number(arg.slice("--row=".length));
  if (!Number.isInteger(row) || row < 2) throw new Error("--row harus berupa nomor baris sheet >= 2.");
  return row;
}

async function mapWithConcurrency(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function getFolderLink(folderId, cache) {
  if (cache.has(folderId)) return cache.get(folderId);
  const meta = await drive.getFile(folderId, "id,name,webViewLink,parents");
  const value = {
    id: folderId,
    name: text(meta.name),
    link: text(meta.webViewLink) || drive.folderWebUrl(folderId)
  };
  cache.set(folderId, value);
  return value;
}

async function getSheetRows() {
  const values = await sheets.getValues(SHEET_NAMES.PROPERTIES, "A1:Y");
  const headers = (values[0] || []).map((value) => text(value));
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  for (const required of ["file_id", "thumbnail", "folder_link"]) {
    if (index[required] == null) throw new Error("Kolom " + required + " tidak ditemukan.");
  }
  return { values, index };
}

async function inspectRow(row, index, folderCache) {
  const fileId = text(row[index.file_id]);
  const currentFolderId = folderIdFromLink(row[index.folder_link]);
  if (!fileId) return { status: "skip", rowNumber: row.__rowNumber };

  let file;
  try {
    file = await drive.getFile(fileId, "id,name,parents");
  } catch (error) {
    return { status: "missing_file", rowNumber: row.__rowNumber, fileId, fileName: text(row[index.file_name]), error: error.message };
  }

  const actualFolderId = text((file.parents || [])[0]);
  if (!actualFolderId) {
    return { status: "no_parent", rowNumber: row.__rowNumber, fileId, fileName: text(row[index.file_name]) };
  }

  const target = await getFolderLink(actualFolderId, folderCache);
  if (currentFolderId === actualFolderId) {
    return { status: "ok", rowNumber: row.__rowNumber, fileId, fileName: text(row[index.file_name]), folder: target };
  }

  let thumbnail = null;
  const thumbnailId = text(row[index.thumbnail]);
  if (thumbnailId) {
    try {
      const image = await drive.getFile(thumbnailId, "id,name,parents");
      thumbnail = {
        id: thumbnailId,
        name: text(image.name),
        parentId: text((image.parents || [])[0]),
        matchesTarget: text((image.parents || [])[0]) === actualFolderId
      };
    } catch (error) {
      thumbnail = { id: thumbnailId, error: error.message };
    }
  }

  return {
    status: "repair",
    rowNumber: row.__rowNumber,
    fileId,
    fileName: text(row[index.file_name]),
    oldFolderId: currentFolderId,
    newFolderId: actualFolderId,
    newFolderName: target.name,
    newFolderLink: target.link,
    thumbnail
  };
}

async function applyRepairs(repairs) {
  const client = await sheetsClient();
  for (let start = 0; start < repairs.length; start += UPDATE_BATCH_SIZE) {
    const batch = repairs.slice(start, start + UPDATE_BATCH_SIZE);
    await withRetry(() => client.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEETS_ID,
      requestBody: {
        valueInputOption: "RAW",
        data: batch.map((item) => ({
          range: "'" + SHEET_NAMES.PROPERTIES.replace(/'/g, "''") + "'!V" + item.rowNumber,
          values: [[item.newFolderLink]]
        }))
      }
    }));
    console.log("updated", Math.min(start + batch.length, repairs.length), "/", repairs.length);
  }
}

async function main() {
  if (!SHEETS_ID) throw new Error("GOOGLE_SHEETS_ID belum diatur.");
  const rowFilter = parseRowFilter();
  const { values, index } = await getSheetRows();
  const rows = values.slice(1).map((row, offset) => {
    const copy = row.slice();
    copy.__rowNumber = offset + 2;
    return copy;
  }).filter((row) => !rowFilter || row.__rowNumber === rowFilter);
  const folderCache = new Map();
  let completed = 0;
  const inspected = await mapWithConcurrency(rows, BATCH_SIZE, async (row) => {
    const result = await inspectRow(row, index, folderCache);
    completed++;
    if (completed % 50 === 0 || completed === rows.length) console.log("checked", completed, "/", rows.length);
    return result;
  });
  const repairs = inspected.filter((item) => item.status === "repair");
  const report = {
    sheet: SHEET_NAMES.PROPERTIES,
    rowsChecked: inspected.length,
    repairs: repairs.length,
    missingFiles: inspected.filter((item) => item.status === "missing_file").length,
    noParent: inspected.filter((item) => item.status === "no_parent").length,
    repairRows: repairs
  };
  console.log(JSON.stringify(report, null, 2));

  if (process.argv.includes("--apply")) {
    if (!process.argv.includes("--confirm")) throw new Error("Mode apply membutuhkan --confirm.");
    await applyRepairs(repairs);
    console.log("Repair folder_link selesai.");
  } else {
    console.log("Preview saja. Gunakan --apply --confirm untuk mengubah folder_link.");
  }
}

main().catch((error) => {
  console.error(error.response?.data || error.message || String(error));
  process.exitCode = 1;
});

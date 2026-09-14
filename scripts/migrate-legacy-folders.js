"use strict";

// Preview/migrate legacy folders that contain both Jual and Sewa listings.
// Files are moved, never copied, so their Drive IDs remain stable.
require("dotenv").config();

const drive = require("../lib/drive");
const sheets = require("../lib/sheets");
const dates = require("../lib/dates");
const { SHEET_NAMES, SHEETS_ID, ROOT_FOLDER_ID, PROPERTY_HEADERS, LISTING_TIPE_CODE } = require("../lib/config");

function text(value) { return String(value == null ? "" : value).trim(); }
function key(value) { return text(value).replace(/\/+$/, "").toLowerCase(); }
function stem(name) { return text(name).replace(/\.[^.]+$/, ""); }
function folderIdFromLink(link) {
  const match = text(link).match(/\/folders\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : "";
}
function isImage(file) { return /\.(png|jpe?g|webp|gif)$/i.test(text(file.name)); }
function isNarrative(file) {
  return /\.txt$/i.test(text(file.name)) || drive.isGoogleDocMime(file.mimeType);
}
function safeName(value) {
  return text(value).replace(/[\\/:*?"<>|#%{}~&]/g, " ").replace(/\s+/g, " ").trim();
}
function col(headers, name) {
  const index = headers.findIndex((header) => key(header) === name);
  if (index < 0) throw new Error("Kolom " + name + " tidak ditemukan.");
  return index;
}

function targetFolderName(row, fileName) {
  const fromFile = safeName(stem(fileName));
  if (fromFile) return fromFile;
  const prefix = (text(row.kategori).toLowerCase() === "sewa" ? "S" : "J")
    + (LISTING_TIPE_CODE[row.tipe] || "");
  return safeName(prefix + " " + row.area + " " + row.fileId);
}

function rowObject(headers, row, rowNumber) {
  const get = (name) => row[col(headers, name)] || "";
  return {
    rowNumber,
    fileId: text(get("file_id")),
    fileName: text(get("file_name")),
    kategori: text(get("kategori")),
    tipe: text(get("tipe")),
    area: text(get("area")),
    folderLink: text(get("folder_link")),
    thumbnail: text(get("thumbnail")),
    bulantahun: text(get("bulantahun"))
  };
}

function imageMatches(image, listing, folderImages) {
  if (image.id === listing.thumbnail) return "thumbnail";
  const imageBase = key(stem(image.name));
  const fileBase = key(stem(listing.fileName));
  if (imageBase && fileBase && imageBase === fileBase) return "filename";
  return "";
}

async function buildPlan() {
  const values = await sheets.getValues(SHEET_NAMES.PROPERTIES, "A1:Y");
  const headers = (values[0] || []).map((value) => String(value || "").trim());
  const rows = values.slice(1).map((row, index) => rowObject(headers, row, index + 2))
    .filter((row) => row.fileId && row.folderLink);
  const byFolder = new Map();
  rows.forEach((row) => {
    const folderKey = key(row.folderLink);
    if (!byFolder.has(folderKey)) byFolder.set(folderKey, []);
    byFolder.get(folderKey).push(row);
  });

  const plan = [];
  for (const listings of byFolder.values()) {
    const folderId = folderIdFromLink(listings[0].folderLink);
    if (!folderId || folderId === ROOT_FOLDER_ID) continue;
    const byCategory = new Map();
    listings.forEach((row) => {
      const category = key(row.kategori);
      if (!byCategory.has(category)) byCategory.set(category, []);
      byCategory.get(category).push(row);
    });
    const sourceFiles = await drive.listChildren(folderId);
    const images = sourceFiles.filter(isImage);
    const narratives = sourceFiles.filter(isNarrative);
    for (const [category, categoryRows] of byCategory.entries()) {
      const entry = {
        sourceFolderId: folderId,
        sourceFolderLink: listings[0].folderLink,
        kategori: category,
        rows: categoryRows,
        action: categoryRows.length === 1 ? "ready" : "ambiguous_duplicate_rows",
        targetFolderName: categoryRows.length === 1 ? targetFolderName(categoryRows[0], categoryRows[0].fileName) : "",
        files: [],
        warnings: []
      };
      categoryRows.forEach((row) => {
        const narrative = narratives.find((file) => file.id === row.fileId);
        if (!narrative) {
          entry.action = "needs_review";
          entry.warnings.push("Narrative file_id tidak ditemukan di folder: " + row.fileId);
          return;
        }
        const matchedImages = images.filter((image) => imageMatches(image, row, images));
        if (!matchedImages.length && row.thumbnail) {
          entry.action = "needs_review";
          entry.warnings.push("Thumbnail tidak ditemukan di folder: " + row.thumbnail);
        }
        entry.files.push({ rowNumber: row.rowNumber, fileId: row.fileId, fileName: row.fileName, imageIds: matchedImages.map((image) => image.id) });
      });
      plan.push(entry);
    }
  }
  return plan.filter((entry) => entry.action !== "ready" || entry.sourceFolderLink !== entry.targetFolderName);
}

async function applyPlan(plan) {
  for (const entry of plan) {
    if (entry.action !== "ready") continue;
    const monthName = entry.rows[0].bulantahun || dates.currentBulanTahunFolderName();
    const monthFolder = await drive.getOrCreateChildFolder(ROOT_FOLDER_ID, monthName);
    const target = await drive.getOrCreateChildFolder(monthFolder.id, entry.targetFolderName);
    for (const file of entry.files) {
      await drive.moveFile(file.fileId, entry.sourceFolderId, target.id);
      for (const imageId of file.imageIds) await drive.moveFile(imageId, entry.sourceFolderId, target.id);
    }
    const headers = (await sheets.getValues(SHEET_NAMES.PROPERTIES, "A1:Y"))[0].map((value) => String(value || "").trim());
    const folderIndex = col(headers, "folder_link");
    const targetLink = target.webViewLink || drive.folderWebUrl(target.id);
    for (const row of entry.rows) {
      const cell = String.fromCharCode(65 + folderIndex) + row.rowNumber;
      await sheets.updateValues(SHEET_NAMES.PROPERTIES, cell, [[targetLink]]);
    }
  }
}

async function main() {
  if (!SHEETS_ID || !ROOT_FOLDER_ID) throw new Error("GOOGLE_SHEETS_ID dan GOOGLE_DRIVE_ROOT_FOLDER_ID wajib diatur.");
  const plan = await buildPlan();
  console.log(JSON.stringify({
    groups: plan.length,
    ready: plan.filter((entry) => entry.action === "ready").length,
    needsReview: plan.filter((entry) => entry.action !== "ready").length,
    plan
  }, null, 2));
  if (process.argv.includes("--apply")) {
    if (!process.argv.includes("--confirm")) throw new Error("Mode apply membutuhkan --confirm.");
    await applyPlan(plan);
    console.log("Migration selesai.");
  }
}

main().catch((error) => { console.error(error.message || String(error)); process.exitCode = 1; });


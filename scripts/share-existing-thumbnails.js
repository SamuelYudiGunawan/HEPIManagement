"use strict";
// One-time backfill — run ONCE (locally or on the production server),
// BEFORE restricting the Drive folder's own sharing setting.
//
// Existing listing thumbnails are currently only publicly viewable because
// their containing Drive folder is shared "Anyone with the link" — the app
// never explicitly shared each thumbnail file on its own (new listings do,
// as of the code change alongside this script). If you restrict the
// folder without running this first, every existing listing's photo will
// break on the site.
//
// This grants "Anyone with the link can view" directly to each existing
// listing's thumbnail file, independent of the folder's own permission, so
// the folder can then be safely restricted without breaking old listings.
//
// Usage: node scripts/share-existing-thumbnails.js

try {
  require("dotenv").config();
} catch (e) {}

const sheets = require("../lib/sheets");
const drive = require("../lib/drive");
const { SHEET_NAMES } = require("../lib/config");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("Membaca listing dari sheet Data Properti...");
  await sheets.ensurePropertySheet();
  const values = await sheets.getValues(SHEET_NAMES.PROPERTIES, "A1:Y");
  if (values.length < 2) {
    console.log("Tidak ada listing ditemukan.");
    return;
  }

  const headers = (values[0] || []).map((h) => String(h).trim());
  const thumbCol = headers.indexOf("thumbnail");
  if (thumbCol === -1) {
    console.error("Kolom 'thumbnail' tidak ditemukan di header sheet.");
    process.exit(1);
  }

  const thumbnailIds = new Set();
  for (let i = 1; i < values.length; i++) {
    const id = String((values[i] || [])[thumbCol] || "").trim();
    if (id) thumbnailIds.add(id);
  }

  const ids = Array.from(thumbnailIds);
  console.log(`Ditemukan ${ids.length} foto thumbnail unik. Memberi izin akses publik satu per satu...\n`);

  let ok = 0;
  let failed = 0;
  const failedIds = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    try {
      await drive.shareAnyoneReader(id);
      ok++;
    } catch (e) {
      failed++;
      failedIds.push(id);
      console.error(`Gagal untuk ${id}: ${(e && e.message) || e}`);
    }
    if ((i + 1) % 20 === 0 || i === ids.length - 1) {
      console.log(`Progres: ${i + 1}/${ids.length} (berhasil: ${ok}, gagal: ${failed})`);
    }
    // jeda kecil biar tidak kena rate limit Google Drive API
    await delay(150);
  }

  console.log(`\nSelesai. Berhasil: ${ok}, Gagal: ${failed}, Total: ${ids.length}`);
  if (failedIds.length) {
    console.log("\nID yang gagal (biasanya file sudah dihapus dari Drive atau ID tidak valid):");
    failedIds.forEach((id) => console.log("  " + id));
  }
}

main().catch((err) => {
  console.error("Error fatal:", (err && err.message) || err);
  process.exit(1);
});

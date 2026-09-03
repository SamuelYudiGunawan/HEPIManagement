"use strict";

const path = require("path");

const SHEET_NAMES = {
  PROPERTIES: "Data Properti",
  AGENTS: "Data Agen",
  LOG_SOLD: "LOG SOLD",
  DAILY_ACTIVITY: "Daily Activity"
};

const PROPERTY_HEADERS = [
  "file_id", "file_name", "kategori", "tipe", "area", "harga",
  "luas_tanah", "luas_bangunan", "kamar_tidur", "kamar_mandi",
  "listrik", "sumber_air", "furnished", "full_bangunan", "hadap",
  "garasi", "sertifikat", "kontak", "agen", "bulantahun",
  "thumbnail", "folder_link", "sold", "date_created",
  "harga_per_m2"
];

const ACTIVITY_HEADERS = [
  "timestamp", "tanggal", "kode_agen", "nama_agen",
  "listing", "konten", "posting", "survey", "closing",
  "skor_listing", "skor_konten", "skor_posting", "skor_survey", "skor_closing", "skor_total"
];

const AGENT_HEADERS = ["kode_agen", "nama_agen", "pin", "status", "hp", "active"];

const LOG_SOLD_HEADERS = ["Tanggal", "Nama Agen", "Kode Agen", "File ID", "Nama Listing", "Aksi"];

const LISTING_TIPE_CODE = {
  Gudang: "G",
  Tanah: "T",
  Rumah: "R",
  Ruko: "U",
  Kost: "K",
  Apartemen: "A"
};

const SCORE_WEIGHTS = {
  listing: 50,
  konten: 50,
  posting: 1,
  survey: 50,
  closing: 1
};

const MONTH_TARGETS = {
  listing: 4,
  posting: 300,
  closing: 1
};

const KONTEN_POSTING_TIERS = [
  { konten: 20, posting: 100 },
  { konten: 10, posting: 200 }
];

const TZ = process.env.TZ || "Asia/Jakarta";
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "";
const SHEETS_ID = process.env.GOOGLE_SHEETS_ID || "";
// getListings() serves its cache all day and only refreshes once wall-clock
// crosses this local time — writes (submit/sold/import) still invalidate it
// immediately regardless, this only governs the passive/idle refresh.
const CACHE_DAILY_RESET_HOUR = 17;
const CACHE_DAILY_RESET_MINUTE = 30;
const IMPORT_MAX_MS = Number(process.env.IMPORT_MAX_MS) || 45000;
const DATA_DIR = path.join(__dirname, "..", "data");
const IMPORT_STATE_FILE = path.join(DATA_DIR, "import-state.json");

module.exports = {
  SHEET_NAMES,
  PROPERTY_HEADERS,
  ACTIVITY_HEADERS,
  AGENT_HEADERS,
  LOG_SOLD_HEADERS,
  LISTING_TIPE_CODE,
  SCORE_WEIGHTS,
  MONTH_TARGETS,
  KONTEN_POSTING_TIERS,
  TZ,
  ROOT_FOLDER_ID,
  SHEETS_ID,
  CACHE_DAILY_RESET_HOUR,
  CACHE_DAILY_RESET_MINUTE,
  IMPORT_MAX_MS,
  DATA_DIR,
  IMPORT_STATE_FILE
};

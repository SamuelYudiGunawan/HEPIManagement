"use strict";

const path = require("path");

const SHEET_NAMES = {
  PROPERTIES: "Data Properti",
  AGENTS: "Data Agen",
  LOG_SOLD: "LOG SOLD",
  DAILY_ACTIVITY: "Daily Activity",
  FORM_LISTING_QUEUE: "Form Listing Queue",
  REVISIONS: "Revisi Listing"
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

const AGENT_HEADERS = ["kode_agen", "nama_agen", "pin", "status", "hp", "active", "email"];

const LOG_SOLD_HEADERS = ["Tanggal", "Nama Agen", "Kode Agen", "File ID", "Nama Listing", "Aksi"];

const FORM_LISTING_HEADERS = [
  "file_id", "tanggal", "kode_agen", "nama_agen",
  "form_file_id", "form_file_name", "form_mime", "property_file_id",
  "narasi", "status", "feedback", "date_created", "date_updated", "folder_link"
];

// revision_id is its own unique key — file_id is the TARGET listing, which
// isn't unique per row (a listing can have multiple revision requests over
// time), so it can't be used on its own to address one specific request.
const REVISION_HEADERS = [
  "revision_id", "file_id", "nama_listing", "kode_agen", "nama_agen",
  "perubahan", "foto_baru_id", "catatan",
  "status", "feedback", "date_created", "date_updated"
];

// Single source of truth for which "Data Properti" fields a revision
// request can touch, and how each one's narrative line gets rewritten.
// kind:
//   "harga"     — its own multi-line block replace (parser.replaceHargaBlock_)
//   "furnished" — bare word line, no "label value" pair (parser.replaceFurnishedLine_)
//   "garasi"    — "label value" but formatted via parser's parkLine_ ("N mobil")
//   "labeled"   — generic "Label value[suffix]" line (parser.replaceLabeledLine_)
//   "area"      — rewrites the "di <area>" tail of the opening line
//                 (parser.replaceAreaLine_); also best-effort renames the
//                 listing's Drive folder/.txt/.png (listings.renameListingFolderForArea)
const REVISABLE_FIELDS = {
  area: { label: "Area", sheetCol: "area", kind: "area" },
  harga: { label: "Harga", sheetCol: "harga", kind: "harga" },
  luas_tanah: { label: "Luas Tanah", sheetCol: "luas_tanah", kind: "labeled", suffix: " m²" },
  luas_bangunan: { label: "Luas Bangunan", sheetCol: "luas_bangunan", kind: "labeled", suffix: " m²" },
  kamar_tidur: { label: "Kamar Tidur", sheetCol: "kamar_tidur", kind: "labeled" },
  kamar_mandi: { label: "Kamar Mandi", sheetCol: "kamar_mandi", kind: "labeled" },
  listrik: { label: "Listrik", sheetCol: "listrik", kind: "labeled", suffix: " Watt" },
  sumber_air: { label: "Air", sheetCol: "sumber_air", kind: "labeled" },
  sertifikat: { label: "Sertifikat", sheetCol: "sertifikat", kind: "labeled" },
  hadap: { label: "Hadap", sheetCol: "hadap", kind: "labeled" },
  garasi: { label: "Garasi", sheetCol: "garasi", kind: "garasi" },
  furnished: { label: "Furnished", sheetCol: "furnished", kind: "furnished" }
};

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
  FORM_LISTING_HEADERS,
  REVISION_HEADERS,
  REVISABLE_FIELDS,
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

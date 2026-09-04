"use strict";

const sheets = require("./sheets");
const drive = require("./drive");
const agents = require("./agents");
const parser = require("./parser");
const dates = require("./dates");
const { writeMutex } = require("./lock");
const {
  SHEET_NAMES,
  PROPERTY_HEADERS,
  LISTING_TIPE_CODE,
  CACHE_DAILY_RESET_HOUR,
  CACHE_DAILY_RESET_MINUTE,
  TZ,
  ROOT_FOLDER_ID
} = require("./config");

let listingsCache = { at: 0, data: null };

function invalidateListings() {
  listingsCache = { at: 0, data: null };
}

function padRow(row, len) {
  const out = Array.isArray(row) ? row.slice() : [];
  while (out.length < len) out.push("");
  return out;
}

async function getPropertyRows() {
  await sheets.ensurePropertySheet();
  const values = await sheets.getValues(SHEET_NAMES.PROPERTIES, "A1:Y");
  return values;
}

function buildPropertyState(values) {
  const state = {
    byFileId: {},
    byFileName: {},
    soldByFileId: {},
    lastRow: values.length
  };
  for (let i = 1; i < values.length; i++) {
    const row = padRow(values[i], PROPERTY_HEADERS.length);
    const rowNumber = i + 1;
    const fileId = String(row[0] || "").trim();
    const fileName = String(row[1] || "").trim();
    const sold = String(row[22] || "").trim();
    if (fileId) {
      state.byFileId[fileId] = rowNumber;
      state.soldByFileId[fileId] = sold;
    }
    if (fileName) state.byFileName[fileName] = rowNumber;
  }
  return state;
}

function rowDataFrom(params, oldSold) {
  const data = params.data || {};
  return [
    params.fileId,
    params.fileName,
    data.kategori || "",
    data.tipe || "",
    data.area || "",
    Number(data.harga || 0),
    data.luasTanah || "",
    data.luasBangunan || "",
    data.kamarTidur || "",
    data.kamarMandi || "",
    data.listrik || "",
    data.sumberAir || "",
    data.furnished || "",
    data.fullBangunan || "",
    data.hadap || "",
    data.garasi || "",
    data.sertifikat || "",
    data.kontak || "",
    data.agen || "",
    data.bulanTahun || "",
    params.thumbnail || "",
    params.folderLink || "#",
    oldSold || "",
    params.dateCreated || "",
    Number(data.hargaPerM2 || 0)
  ];
}

async function upsertFast(params, values, state) {
  const fileId = String(params.fileId || "").trim();
  const fileName = String(params.fileName || "").trim();
  if (!fileId) return;

  let rowNumber = state.byFileId[fileId] || 0;
  if (!rowNumber && fileName && state.byFileName[fileName]) {
    rowNumber = state.byFileName[fileName];
  }

  let oldSold = "";
  if (rowNumber) {
    oldSold = state.soldByFileId[fileId] || "";
    if (!oldSold && fileName && state.byFileName[fileName] === rowNumber) {
      const row = padRow(values[rowNumber - 1], PROPERTY_HEADERS.length);
      oldSold = String(row[22] || "").trim();
    }
  }

  const rowData = rowDataFrom(params, oldSold);

  if (!rowNumber) {
    const newRow = await sheets.appendValues(SHEET_NAMES.PROPERTIES, [rowData]);
    state.byFileId[fileId] = newRow;
    if (fileName) state.byFileName[fileName] = newRow;
    state.soldByFileId[fileId] = oldSold || "";
    state.lastRow = newRow;
    values[newRow - 1] = rowData;
  } else {
    await sheets.updateValues(SHEET_NAMES.PROPERTIES, "A" + rowNumber + ":Y" + rowNumber, [rowData]);
    state.byFileId[fileId] = rowNumber;
    if (fileName) state.byFileName[fileName] = rowNumber;
    state.soldByFileId[fileId] = oldSold || "";
    values[rowNumber - 1] = rowData;
  }
}

function listingsCacheStillFresh() {
  if (!listingsCache.data) return false;
  const expiresAt = dates.nextDailyBoundary(listingsCache.at, CACHE_DAILY_RESET_HOUR, CACHE_DAILY_RESET_MINUTE, TZ);
  return Date.now() < expiresAt;
}

async function getListings(force) {
  if (!force && listingsCacheStillFresh()) {
    return listingsCache.data;
  }
  const values = await getPropertyRows();
  if (values.length < 2) {
    listingsCache = { at: Date.now(), data: [] };
    return [];
  }
  const headers = (values[0] || []).map((h) => String(h).trim());
  const agentData = await agents.getAgentDataFromSheet();
  const knownAgentIdentifiers = new Set();
  const inactiveNames = new Set();
  const inactiveCodes = new Set();
  // The "agen" column on a listing row holds the agent's NAME (parser.js
  // falls back to storing the code there only if the name lookup failed at
  // import time) — this map lets the frontend search by kode agen too, by
  // resolving whichever identifier is stored back to a real agent code.
  const kodeByIdentifier = {};
  Object.values(agentData).forEach((a) => {
    if (a.nama) knownAgentIdentifiers.add(a.nama.toLowerCase().trim());
    if (a.kode) knownAgentIdentifiers.add(a.kode.toLowerCase().trim());
    if (a.nama) kodeByIdentifier[a.nama.toLowerCase().trim()] = a.kode;
    if (a.kode) kodeByIdentifier[a.kode.toLowerCase().trim()] = a.kode;
    if (a.active === "tidak") {
      if (a.nama) inactiveNames.add(a.nama.toLowerCase().trim());
      if (a.kode) inactiveCodes.add(a.kode.toLowerCase().trim());
    }
  });

  const list = values.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return {
      fileId: obj.file_id || "",
      fileName: obj.file_name || "",
      kategori: obj.kategori || "",
      tipe: obj.tipe || "",
      area: obj.area || "",
      harga: Number(obj.harga) || 0,
      hargaPerM2: Number(obj.harga_per_m2) || 0,
      luasTanah: obj.luas_tanah || "",
      luasBangunan: obj.luas_bangunan || "",
      kamarTidur: obj.kamar_tidur || "",
      kamarMandi: obj.kamar_mandi || "",
      listrik: obj.listrik || "",
      sumberAir: obj.sumber_air || "",
      furnished: obj.furnished || "",
      fullBangunan: obj.full_bangunan || "",
      hadap: obj.hadap || "",
      garasi: obj.garasi || "",
      sertifikat: obj.sertifikat || "",
      agen: obj.agen || "",
      kodeAgen: kodeByIdentifier[String(obj.agen || "").toLowerCase().trim()] || "",
      kontak: String(obj.kontak || ""),
      bulanTahun: dates.formatBulanTahunForFrontend(obj.bulantahun),
      thumbnail: obj.thumbnail || "",
      folderLink: obj.folder_link || "#",
      sold: obj.sold || "",
      dateCreated: dates.dateCreatedMs(obj.date_created)
    };
  }).filter((item) => {
    const agenLower = String(item.agen || "").toLowerCase().trim();
    if (!agenLower || !knownAgentIdentifiers.has(agenLower)) return false;
    return !inactiveNames.has(agenLower) && !inactiveCodes.has(agenLower);
  });

  listingsCache = { at: Date.now(), data: list };
  return list;
}

async function logSold(namaAgen, kodeAgen, fileId, namaListing, aksi) {
  await sheets.ensureLogSoldSheet();
  await sheets.appendValues(SHEET_NAMES.LOG_SOLD, [[
    new Date().toISOString(),
    namaAgen || "",
    kodeAgen || "",
    fileId || "",
    namaListing || "",
    aksi || "SOLD"
  ]]);
}

async function markAsSold(fileId, agentCode) {
  fileId = String(fileId || "").trim();
  agentCode = String(agentCode || "").toUpperCase().trim();
  if (!fileId) throw new Error("File ID kosong.");

  return writeMutex.run(async () => {
    const currentAgent = await agents.requireAgent(agentCode);

    const values = await getPropertyRows();
    if (values.length < 2) throw new Error("Data listing kosong.");
    const header = values[0];
    const fileIdCol = header.indexOf("file_id");
    const soldCol = header.indexOf("sold");
    const namaCol = header.indexOf("file_name");
    const agenCol = header.indexOf("agen");
    if (fileIdCol === -1 || soldCol === -1 || namaCol === -1 || agenCol === -1) {
      throw new Error("Struktur sheet Data Properti tidak valid.");
    }

    const isAdmin = String(currentAgent.status || "").toLowerCase() === "admin";
    const namaLengkapAgenInput = currentAgent.nama || agentCode;

    for (let i = 1; i < values.length; i++) {
      if (String(values[i][fileIdCol]) !== fileId) continue;
      const currentStatus = String(values[i][soldCol] || "").toUpperCase().trim();
      const namaPemilikListingDiSheet = String(values[i][agenCol] || "").trim();
      const namaListing = String(values[i][namaCol] || "").trim();
      const isOwner = !namaPemilikListingDiSheet || namaLengkapAgenInput === namaPemilikListingDiSheet;
      const cell = sheets.colLetter(soldCol) + (i + 1);

      if (currentStatus === "YA") {
        if (!isAdmin && !isOwner) {
          throw new Error(
            "No No No! Anda bukan pemilik listing ini. Hanya " +
            namaPemilikListingDiSheet +
            " atau Admin yang bisa membatalkan SOLD."
          );
        }
        await sheets.updateValues(SHEET_NAMES.PROPERTIES, cell, [[""]]);
        await logSold(namaLengkapAgenInput, agentCode, fileId, namaListing, "UNSOLD");
        invalidateListings();
        return "UNSOLD";
      }

      if (!isAdmin && !isOwner) {
        throw new Error(
          "No No No! Anda bukan pemilik listing ini. Hanya " +
          namaPemilikListingDiSheet +
          " atau Admin yang bisa menandai SOLD."
        );
      }
      await sheets.updateValues(SHEET_NAMES.PROPERTIES, cell, [["YA"]]);
      await logSold(namaLengkapAgenInput, agentCode, fileId, namaListing, "SOLD");
      invalidateListings();
      return "SOLD";
    }
    throw new Error("Listing tidak ditemukan.");
  });
}

async function getNarrativeText(fileId) {
  try {
    const file = await drive.getFile(fileId, "id,name");
    if (!String(file.name || "").toLowerCase().endsWith(".txt")) {
      return { success: false, error: "Bukan file teks" };
    }
    const content = await drive.getFileText(fileId);
    return { success: true, content };
  } catch (e) {
    return { success: false, error: e.message || String(e) };
  }
}

async function getNarrativeTexts(fileIds) {
  const ids = Array.isArray(fileIds) ? fileIds : [];
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const id = String(ids[i] || "").trim();
    const res = await getNarrativeText(id);
    out.push(Object.assign({ fileId: id }, res));
  }
  return out;
}

async function getActiveAgentsForListing(agentCode) {
  await agents.requireListingEditor(agentCode);
  const all = await agents.getAgentDataFromSheet();
  const list = [];
  Object.keys(all).forEach((kode) => {
    const a = all[kode];
    if (!agents.isAgentActive(a)) return;
    list.push({
      kode: String(a.kode || kode),
      nama: String(a.nama || a.kode || kode),
      hp: String(a.hp || "")
    });
  });
  list.sort((a, b) => String(a.nama).localeCompare(String(b.nama), "id"));
  return list;
}

function decodeImageBuffer(raw, fallbackBuf) {
  if (fallbackBuf && Buffer.isBuffer(fallbackBuf) && fallbackBuf.length) return fallbackBuf;
  const b64 = parser.stripDataUrl_(raw);
  if (!b64) return null;
  try {
    return Buffer.from(b64, "base64");
  } catch (e) {
    return null;
  }
}

async function submitOneListing(agentCode, payload, files) {
  payload = payload || {};
  files = files || {};

  return writeMutex.run(async () => {
    await agents.requireListingEditor(agentCode);

    const kategori = String(payload.kategori || "").trim();
    const tipe = String(payload.tipe || "").trim();
    const daerah = parser.sanitizeDriveName_(payload.daerah);
    const harga = parser.sanitizeDriveName_(parser.hargaForTitle_(payload.harga));
    const kodeAgen = String(payload.kodeAgen || "").toUpperCase().trim();
    const tipeCode = LISTING_TIPE_CODE[tipe];

    if (kategori !== "Jual" && kategori !== "Sewa") throw new Error("Pilih Jual atau Sewa.");
    if (!tipeCode) throw new Error("Pilih tipe properti.");
    if (!daerah) throw new Error("Isi nama daerah.");
    if (!harga) throw new Error("Isi harga.");
    if (!kodeAgen) throw new Error("Pilih agen.");

    const agentMap = await agents.getAgentDataFromSheet();
    const listingAgent = agentMap[kodeAgen];
    if (!listingAgent) throw new Error("Agen tidak ditemukan: " + kodeAgen);
    if (!agents.isAgentActive(listingAgent)) throw new Error("Agen nonaktif: " + kodeAgen);

    const thumbBytes = decodeImageBuffer(payload.thumbBase64, files.thumb);
    const origBytes = decodeImageBuffer(payload.origBase64, files.orig);
    if (!thumbBytes) throw new Error("Upload thumbnail.");
    if (!origBytes) throw new Error("Upload foto original.");

    const prefix = (kategori === "Sewa" ? "S" : "J") + tipeCode;
    const baseName = parser.sanitizeDriveName_(prefix + " " + daerah + " " + harga + " " + kodeAgen);
    if (!baseName) throw new Error("Nama folder listing tidak valid.");

    const monthName = dates.currentBulanTahunFolderName();
    const monthFolder = await drive.getOrCreateChildFolder(ROOT_FOLDER_ID, monthName);
    const listingFolder = await drive.createUniqueListingFolder(monthFolder.id, baseName);
    const folderName = listingFolder.name;

    const fields = {
      kategori,
      tipe,
      daerah: String(payload.daerah || "").replace(/\s+/g, " ").trim(),
      harga: String(payload.harga || "").replace(/\s+/g, " ").trim(),
      nego: !!payload.nego,
      luasTanah: String(payload.luasTanah || "").trim(),
      luasBangunan: String(payload.luasBangunan || "").trim(),
      kamarTidur: String(payload.kamarTidur || "").trim(),
      kamarMandi: String(payload.kamarMandi || "").trim(),
      listrik: String(payload.listrik || "").trim(),
      air: String(payload.air || "").trim(),
      sertifikat: String(payload.sertifikat || "").trim(),
      hadap: String(payload.hadap || "").trim(),
      furnished: String(payload.furnished || "").trim(),
      garasi: String(payload.garasi || "").trim(),
      carport: String(payload.carport || "").trim(),
      fullBangunan: payload.fullBangunan === true || payload.fullBangunan === "true" || payload.fullBangunan === "1",
      narasi: String(payload.narasi || "").trim()
    };

    let narrative = "";
    const useOwn = payload.useOwnNarrative === true || payload.useOwnNarrative === "true";
    if (useOwn) {
      const raw = String(payload.ownNarrative || "").trim();
      if (!raw) throw new Error("Tempel narasi sendiri dulu.");
      narrative = raw;
    } else {
      const edited = String(payload.autoNarrative || "").trim();
      narrative = edited || parser.buildListingNarrative_(fields, listingAgent);
    }

    const txtFile = await drive.uploadFile(
      listingFolder.id,
      folderName + ".txt",
      "text/plain",
      Buffer.from(narrative, "utf8")
    );

    const thumbMime = String(payload.thumbMime || (files.thumbMime) || "image/jpeg").split(";")[0] || "image/jpeg";
    const origMime = String(payload.origMime || (files.origMime) || "image/jpeg").split(";")[0] || "image/jpeg";
    const origExt = parser.normalizeImageExt_(payload.origExt, origMime);

    const thumbFile = await drive.uploadFile(listingFolder.id, folderName + ".png", thumbMime, thumbBytes);
    await drive.uploadFile(listingFolder.id, "1." + origExt, origMime, origBytes);

    const values = await getPropertyRows();
    const state = buildPropertyState(values);
    const data = parser.extractData(narrative, txtFile.name, monthName, agentMap);
    await upsertFast({
      fileId: txtFile.id,
      fileName: txtFile.name,
      data,
      thumbnail: thumbFile.id,
      folderLink: listingFolder.webViewLink || drive.folderWebUrl(listingFolder.id),
      dateCreated: txtFile.createdTime || new Date().toISOString()
    }, values, state);

    invalidateListings();
    return {
      ok: true,
      folderName,
      folderUrl: listingFolder.webViewLink || drive.folderWebUrl(listingFolder.id),
      fileId: txtFile.id,
      bulanTahun: monthName
    };
  });
}

module.exports = {
  invalidateListings,
  getPropertyRows,
  buildPropertyState,
  upsertFast,
  getListings,
  markAsSold,
  getNarrativeText,
  getNarrativeTexts,
  getActiveAgentsForListing,
  submitOneListing
};

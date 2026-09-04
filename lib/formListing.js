"use strict";

const sheets = require("./sheets");
const drive = require("./drive");
const agents = require("./agents");
const dates = require("./dates");
const { writeMutex } = require("./lock");
const { SHEET_NAMES, ROOT_FOLDER_ID } = require("./config");

const QUEUE_RANGE = "A2:N";
const FORM_LISTING_FOLDER_NAME = "FORM LISTING";

function extFromMime(mime, fallback) {
  const m = String(mime || "").toLowerCase();
  if (m.indexOf("pdf") >= 0) return "pdf";
  if (m.indexOf("png") >= 0) return "png";
  if (m.indexOf("webp") >= 0) return "webp";
  if (m.indexOf("gif") >= 0) return "gif";
  if (m.indexOf("jpeg") >= 0 || m.indexOf("jpg") >= 0) return "jpg";
  return fallback || "bin";
}

function rowToObj(row, rowNumber) {
  row = row || [];
  return {
    fileId: String(row[0] || ""),
    tanggal: String(row[1] || ""),
    kodeAgen: String(row[2] || ""),
    namaAgen: String(row[3] || ""),
    formFileId: String(row[4] || ""),
    formFileName: String(row[5] || ""),
    formMime: String(row[6] || ""),
    propertyFileId: String(row[7] || ""),
    narasi: String(row[8] || ""),
    status: String(row[9] || "pending"),
    feedback: String(row[10] || ""),
    dateCreated: String(row[11] || ""),
    dateUpdated: String(row[12] || ""),
    folderLink: String(row[13] || ""),
    rowNumber
  };
}

async function getQueueRows() {
  await sheets.ensureFormListingQueueSheet();
  return sheets.getValues(SHEET_NAMES.FORM_LISTING_QUEUE, QUEUE_RANGE);
}

async function findRow(fileId) {
  const values = await getQueueRows();
  for (let i = 0; i < values.length; i++) {
    if (String((values[i] || [])[0] || "") === String(fileId || "")) {
      return rowToObj(values[i], i + 2);
    }
  }
  return null;
}

function sortOldestFirst(rows) {
  return rows.slice().sort((a, b) => String(a.dateCreated).localeCompare(String(b.dateCreated)));
}

async function submitOneForm(agentCode, pin, fields, files) {
  fields = fields || {};
  files = files || {};

  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode, pin);
    const kodeAgen = String(agent.kode || agentCode || "").toUpperCase().trim();

    const formBuf = files.form;
    const propertyBuf = files.property;
    if (!formBuf || !formBuf.length) throw new Error("Upload form fisik (foto atau PDF).");
    if (!propertyBuf || !propertyBuf.length) throw new Error("Upload foto property.");

    const formMime = String(files.formMime || "").split(";")[0] || "application/octet-stream";
    const propertyMime = String(files.propertyMime || "image/jpeg").split(";")[0] || "image/jpeg";
    if (formMime !== "application/pdf" && formMime.indexOf("image/") !== 0) {
      throw new Error("Form fisik harus foto atau PDF.");
    }
    if (propertyMime.indexOf("image/") !== 0) throw new Error("Foto property harus berupa gambar.");

    const narasi = String(fields.narasi || "").trim();

    const formListingRoot = await drive.getOrCreateChildFolder(ROOT_FOLDER_ID, FORM_LISTING_FOLDER_NAME);
    const monthName = dates.currentBulanTahunFolderName();
    const monthFolder = await drive.getOrCreateChildFolder(formListingRoot.id, monthName);
    const agentFolder = await drive.getOrCreateChildFolder(monthFolder.id, kodeAgen);
    const dateFolder = await drive.createUniqueListingFolder(agentFolder.id, dates.ymd(new Date()));

    const formName = "form." + extFromMime(formMime, "jpg");
    const propertyName = "property." + extFromMime(propertyMime, "jpg");

    const formFile = await drive.uploadFile(dateFolder.id, formName, formMime, formBuf);
    await drive.shareAnyoneReader(formFile.id);
    const propertyFile = await drive.uploadFile(dateFolder.id, propertyName, propertyMime, propertyBuf);
    await drive.shareAnyoneReader(propertyFile.id);

    const nowIso = new Date().toISOString();
    const folderLink = dateFolder.webViewLink || drive.folderWebUrl(dateFolder.id);

    await sheets.appendValues(SHEET_NAMES.FORM_LISTING_QUEUE, [[
      dateFolder.id,
      dates.ymd(new Date()),
      kodeAgen,
      agent.nama || kodeAgen,
      formFile.id,
      formName,
      formMime,
      propertyFile.id,
      narasi,
      "pending",
      "",
      nowIso,
      nowIso,
      folderLink
    ]]);

    return { ok: true, fileId: dateFolder.id, folderLink };
  });
}

async function listForAgent(agentCode, pin) {
  const agent = await agents.requireAgent(agentCode, pin);
  const kodeAgen = String(agent.kode || agentCode || "").toUpperCase().trim();
  const values = await getQueueRows();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const obj = rowToObj(values[i], i + 2);
    if (obj.kodeAgen === kodeAgen) rows.push(obj);
  }
  return { rows: sortOldestFirst(rows) };
}

async function listForAdmin(agentCode, pin) {
  await agents.requireListingEditor(agentCode, pin);
  const values = await getQueueRows();
  const rows = values.map((row, i) => rowToObj(row, i + 2));
  return { rows: sortOldestFirst(rows) };
}

async function giveFeedback(agentCode, pin, fileId, feedbackText) {
  return writeMutex.run(async () => {
    await agents.requireListingEditor(agentCode, pin);
    const row = await findRow(fileId);
    if (!row) throw new Error("Submission tidak ditemukan.");
    if (row.status === "selesai") {
      const err = new Error("Sudah selesai, tidak bisa diberi feedback lagi.");
      err.statusCode = 403;
      throw err;
    }
    const nowIso = new Date().toISOString();
    await sheets.updateValues(SHEET_NAMES.FORM_LISTING_QUEUE, "J" + row.rowNumber + ":M" + row.rowNumber, [[
      "revisi", String(feedbackText || "").trim(), row.dateCreated, nowIso
    ]]);
    return { ok: true, status: "revisi" };
  });
}

async function markDone(agentCode, pin, fileId) {
  return writeMutex.run(async () => {
    await agents.requireListingEditor(agentCode, pin);
    const row = await findRow(fileId);
    if (!row) throw new Error("Submission tidak ditemukan.");
    const nowIso = new Date().toISOString();
    await sheets.updateValues(SHEET_NAMES.FORM_LISTING_QUEUE, "J" + row.rowNumber + ":M" + row.rowNumber, [[
      "selesai", row.feedback, row.dateCreated, nowIso
    ]]);
    return { ok: true, status: "selesai" };
  });
}

async function editSubmission(agentCode, pin, fileId, fields, files) {
  fields = fields || {};
  files = files || {};

  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode, pin);
    const kodeAgen = String(agent.kode || agentCode || "").toUpperCase().trim();

    const row = await findRow(fileId);
    if (!row) throw new Error("Submission tidak ditemukan.");
    if (row.kodeAgen !== kodeAgen) {
      const err = new Error("Bukan submission Anda.");
      err.statusCode = 403;
      throw err;
    }
    if (row.status === "selesai") {
      const err = new Error("Sudah selesai, tidak bisa diedit.");
      err.statusCode = 403;
      throw err;
    }

    let formFileId = row.formFileId;
    let formFileName = row.formFileName;
    let formMime = row.formMime;
    if (files.form && files.form.length) {
      formMime = String(files.formMime || "").split(";")[0] || "application/octet-stream";
      if (formMime !== "application/pdf" && formMime.indexOf("image/") !== 0) {
        throw new Error("Form fisik harus foto atau PDF.");
      }
      formFileName = "form." + extFromMime(formMime, "jpg");
      await drive.replaceFileContent(formFileId, formFileName, formMime, files.form);
      await drive.shareAnyoneReader(formFileId);
    }

    if (files.property && files.property.length) {
      const propertyMime = String(files.propertyMime || "image/jpeg").split(";")[0] || "image/jpeg";
      if (propertyMime.indexOf("image/") !== 0) throw new Error("Foto property harus berupa gambar.");
      const propertyName = "property." + extFromMime(propertyMime, "jpg");
      await drive.replaceFileContent(row.propertyFileId, propertyName, propertyMime, files.property);
      await drive.shareAnyoneReader(row.propertyFileId);
    }

    const narasi = fields.narasi != null ? String(fields.narasi).trim() : row.narasi;
    const nowIso = new Date().toISOString();

    await sheets.updateValues(SHEET_NAMES.FORM_LISTING_QUEUE, "E" + row.rowNumber + ":M" + row.rowNumber, [[
      formFileId, formFileName, formMime, row.propertyFileId,
      narasi, "pending", "", row.dateCreated, nowIso
    ]]);

    return { ok: true, status: "pending" };
  });
}

module.exports = {
  submitOneForm,
  listForAgent,
  listForAdmin,
  giveFeedback,
  markDone,
  editSubmission
};

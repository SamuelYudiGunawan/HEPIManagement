"use strict";

const sheets = require("./sheets");
const drive = require("./drive");
const agents = require("./agents");
const dates = require("./dates");
const parser = require("./parser");
const { writeMutex } = require("./lock");
const { SHEET_NAMES, ROOT_FOLDER_ID } = require("./config");

const QUEUE_RANGE = "A2:O";
const FORM_LISTING_FOLDER_NAME = "FORM LISTING";
const PROPERTY_PHOTOS_FOLDER_NAME = "Foto Property";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_PROPERTY_PHOTOS = 5;

function extFromMime(mime, fallback) {
  const m = String(mime || "").toLowerCase();
  if (m.indexOf("pdf") >= 0) return "pdf";
  if (m.indexOf("png") >= 0) return "png";
  if (m.indexOf("webp") >= 0) return "webp";
  if (m.indexOf("gif") >= 0) return "gif";
  if (m.indexOf("jpeg") >= 0 || m.indexOf("jpg") >= 0) return "jpg";
  return fallback || "bin";
}

// The client sends each property photo under its own field name
// (property1..property5) rather than repeating one field name — that keeps
// the shared readMultipart() helper (used by several routes) untouched,
// since it doesn't accumulate repeated field names into an array.
function collectPropertyFiles(files) {
  const list = [];
  for (let i = 1; i <= MAX_PROPERTY_PHOTOS; i++) {
    const key = "property" + i;
    const buf = files[key];
    if (buf && buf.length) {
      list.push({
        buf,
        mime: String(files[key + "Mime"] || "image/jpeg").split(";")[0] || "image/jpeg"
      });
    }
  }
  return list;
}

// property_file_id can be either a plain image file (every row created
// before multi-photo support) or a folder of up to 5 photos (new rows) —
// this resolves either shape into the same array so callers never need to
// know which case they're in.
async function resolvePropertyPhotos(propertyFileId) {
  if (!propertyFileId) return [];
  const meta = await drive.getFile(propertyFileId, "id,mimeType");
  if (meta.mimeType !== FOLDER_MIME) return [{ fileId: propertyFileId }];
  const children = await drive.listChildren(propertyFileId);
  return children
    .filter((f) => parser.isImageName_(f.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((f) => ({ fileId: f.id }));
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
    judul: String(row[14] || ""),
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

async function submitOneForm(agentCode, fields, files) {
  fields = fields || {};
  files = files || {};

  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode);
    const kodeAgen = String(agent.kode || agentCode || "").toUpperCase().trim();

    const formBuf = files.form;
    if (!formBuf || !formBuf.length) throw new Error("Upload form fisik (foto atau PDF).");

    const propertyPhotos = collectPropertyFiles(files);
    if (!propertyPhotos.length) throw new Error("Upload foto property.");
    if (propertyPhotos.length > MAX_PROPERTY_PHOTOS) throw new Error("Maksimal " + MAX_PROPERTY_PHOTOS + " foto property.");
    propertyPhotos.forEach((p) => {
      if (p.mime.indexOf("image/") !== 0) throw new Error("Foto property harus berupa gambar.");
    });

    const formMime = String(files.formMime || "").split(";")[0] || "application/octet-stream";
    if (formMime !== "application/pdf" && formMime.indexOf("image/") !== 0) {
      throw new Error("Form fisik harus foto atau PDF.");
    }

    const narasi = String(fields.narasi || "").trim();
    const judulRaw = String(fields.judul || "").trim();
    const judul = parser.sanitizeDriveName_(fields.judul);

    const formListingRoot = await drive.getOrCreateChildFolder(ROOT_FOLDER_ID, FORM_LISTING_FOLDER_NAME);
    const monthName = dates.currentBulanTahunFolderName();
    const monthFolder = await drive.getOrCreateChildFolder(formListingRoot.id, monthName);
    const agentFolder = await drive.getOrCreateChildFolder(monthFolder.id, kodeAgen);
    const folderBaseName = judul || dates.ymd(new Date());
    const dateFolder = await drive.createUniqueListingFolder(agentFolder.id, folderBaseName);

    const formName = "form." + extFromMime(formMime, "jpg");
    const formFile = await drive.uploadFile(dateFolder.id, formName, formMime, formBuf);
    await drive.shareAnyoneReader(formFile.id);

    const propertyFolder = await drive.getOrCreateChildFolder(dateFolder.id, PROPERTY_PHOTOS_FOLDER_NAME);
    for (let i = 0; i < propertyPhotos.length; i++) {
      const p = propertyPhotos[i];
      const name = "property" + (i + 1) + "." + extFromMime(p.mime, "jpg");
      const uploaded = await drive.uploadFile(propertyFolder.id, name, p.mime, p.buf);
      await drive.shareAnyoneReader(uploaded.id);
    }

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
      propertyFolder.id,
      narasi,
      "pending",
      "",
      nowIso,
      nowIso,
      folderLink,
      judulRaw
    ]]);

    return { ok: true, fileId: dateFolder.id, folderLink };
  });
}

async function listForAgent(agentCode) {
  const agent = await agents.requireAgent(agentCode);
  const kodeAgen = String(agent.kode || agentCode || "").toUpperCase().trim();
  const values = await getQueueRows();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const obj = rowToObj(values[i], i + 2);
    if (obj.kodeAgen === kodeAgen) rows.push(obj);
  }
  return { rows: sortOldestFirst(rows) };
}

async function listForAdmin(agentCode) {
  await agents.requireListingEditor(agentCode);
  const values = await getQueueRows();
  const rows = values.map((row, i) => rowToObj(row, i + 2));
  return { rows: sortOldestFirst(rows) };
}

async function giveFeedback(agentCode, fileId, feedbackText) {
  return writeMutex.run(async () => {
    await agents.requireListingEditor(agentCode);
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

async function markDone(agentCode, fileId) {
  return writeMutex.run(async () => {
    await agents.requireListingEditor(agentCode);
    const row = await findRow(fileId);
    if (!row) throw new Error("Submission tidak ditemukan.");
    const nowIso = new Date().toISOString();
    await sheets.updateValues(SHEET_NAMES.FORM_LISTING_QUEUE, "J" + row.rowNumber + ":M" + row.rowNumber, [[
      "selesai", row.feedback, row.dateCreated, nowIso
    ]]);
    return { ok: true, status: "selesai" };
  });
}

async function editSubmission(agentCode, fileId, fields, files) {
  fields = fields || {};
  files = files || {};

  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode);
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

    // A new set of property photos is a full replace (matches the old
    // single-photo edit semantics) — old photos are trashed, not permanently
    // deleted, so a mistaken edit is still recoverable from Drive's trash.
    let propertyFileId = row.propertyFileId;
    const propertyPhotos = collectPropertyFiles(files);
    if (propertyPhotos.length > MAX_PROPERTY_PHOTOS) throw new Error("Maksimal " + MAX_PROPERTY_PHOTOS + " foto property.");
    if (propertyPhotos.length) {
      propertyPhotos.forEach((p) => {
        if (p.mime.indexOf("image/") !== 0) throw new Error("Foto property harus berupa gambar.");
      });

      const meta = await drive.getFile(propertyFileId, "id,mimeType,parents");
      let propertyFolderId;
      if (meta.mimeType === FOLDER_MIME) {
        propertyFolderId = propertyFileId;
        const children = await drive.listChildren(propertyFolderId);
        for (const child of children) {
          await drive.trashFile(child.id);
        }
      } else {
        // Legacy row from before multi-photo support: propertyFileId is a
        // plain file sitting directly in the submission's date folder —
        // trash it, create the photos subfolder alongside it, and migrate
        // the sheet cell to point at the new folder from now on.
        await drive.trashFile(propertyFileId);
        const parentId = (meta.parents || [])[0];
        const propertyFolder = await drive.getOrCreateChildFolder(parentId, PROPERTY_PHOTOS_FOLDER_NAME);
        propertyFolderId = propertyFolder.id;
      }

      for (let i = 0; i < propertyPhotos.length; i++) {
        const p = propertyPhotos[i];
        const name = "property" + (i + 1) + "." + extFromMime(p.mime, "jpg");
        const uploaded = await drive.uploadFile(propertyFolderId, name, p.mime, p.buf);
        await drive.shareAnyoneReader(uploaded.id);
      }

      propertyFileId = propertyFolderId;
    }

    const narasi = fields.narasi != null ? String(fields.narasi).trim() : row.narasi;
    const nowIso = new Date().toISOString();

    await sheets.updateValues(SHEET_NAMES.FORM_LISTING_QUEUE, "E" + row.rowNumber + ":M" + row.rowNumber, [[
      formFileId, formFileName, formMime, propertyFileId,
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
  editSubmission,
  resolvePropertyPhotos
};

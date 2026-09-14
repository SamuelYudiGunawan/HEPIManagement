"use strict";

const crypto = require("crypto");
const sheets = require("./sheets");
const drive = require("./drive");
const agents = require("./agents");
const listings = require("./listings");
const parser = require("./parser");
const dates = require("./dates");
const push = require("./push");
const { writeMutex } = require("./lock");
const { SHEET_NAMES, ROOT_FOLDER_ID, REVISABLE_FIELDS } = require("./config");

const QUEUE_RANGE = "A2:M";
const REVISI_FOLDER_NAME = "REVISI FOTO";

function extFromMime_(mime, fallback) {
  const m = String(mime || "").toLowerCase();
  if (m.indexOf("png") >= 0) return "png";
  if (m.indexOf("webp") >= 0) return "webp";
  if (m.indexOf("gif") >= 0) return "gif";
  if (m.indexOf("jpeg") >= 0 || m.indexOf("jpg") >= 0) return "jpg";
  return fallback || "jpg";
}

function normalizeName_(s) {
  return String(s || "").toLowerCase().trim();
}

function newRevisionId_() {
  return "REV-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
}

function rowToObj(row, rowNumber) {
  row = row || [];
  let perubahan = [];
  try {
    perubahan = JSON.parse(row[5] || "[]");
    if (!Array.isArray(perubahan)) perubahan = [];
  } catch (e) {
    perubahan = [];
  }
  return {
    revisionId: String(row[0] || ""),
    fileId: String(row[1] || ""),
    namaListing: String(row[2] || ""),
    kodeAgen: String(row[3] || ""),
    namaAgen: String(row[4] || ""),
    perubahan,
    fotoBaruId: String(row[6] || ""),
    catatan: String(row[7] || ""),
    status: String(row[8] || "pending"),
    feedback: String(row[9] || ""),
    dateCreated: String(row[10] || ""),
    dateUpdated: String(row[11] || ""),
    narasi: String(row[12] || ""),
    rowNumber
  };
}

async function getQueueRows() {
  await sheets.ensureRevisionSheet();
  return sheets.getValues(SHEET_NAMES.REVISIONS, QUEUE_RANGE);
}

async function findRow(revisionId) {
  const values = await getQueueRows();
  for (let i = 0; i < values.length; i++) {
    if (String((values[i] || [])[0] || "") === String(revisionId || "")) {
      return rowToObj(values[i], i + 2);
    }
  }
  return null;
}

function sortNewestFirst(rows) {
  return rows.slice().sort((a, b) => String(b.dateCreated).localeCompare(String(a.dateCreated)));
}

function sortForAdminReview(rows) {
  const active = rows.filter((r) => r.status === "pending" || r.status === "revisi");
  const done = rows.filter((r) => r.status === "selesai" || r.status === "dibatalkan");
  const oldestFirst = (a, b) => String(a.dateCreated).localeCompare(String(b.dateCreated));
  const newestDoneFirst = (a, b) => String(b.dateUpdated || b.dateCreated).localeCompare(String(a.dateUpdated || a.dateCreated));
  return active.sort(oldestFirst).concat(done.sort(newestDoneFirst));
}

// Only adminkantor may request a revision for a listing they don't own —
// mirrors (inverted) the SOLD button's admin-only ownership bypass.
function assertCanRequestRevision_(agent, listingAgenName) {
  if (String(agent.status || "").toLowerCase().trim() === "adminkantor") return;
  const owner = normalizeName_(listingAgenName);
  if (!owner) return;
  if (owner === normalizeName_(agent.nama)) return;
  const err = new Error("Anda bukan pemilik listing ini.");
  err.statusCode = 403;
  throw err;
}

async function submitRevision(agentCode, targetFileId, perubahanInput, catatan, files, narasiInput) {
  files = files || {};

  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode);

    const target = await listings.findPropertyRow(targetFileId);
    if (!target) throw new Error("Listing tidak ditemukan.");

    assertCanRequestRevision_(agent, target.obj.agen);

    // Re-validate every requested field against the registry server-side —
    // never trust the client's field list blindly.
    const perubahan = (Array.isArray(perubahanInput) ? perubahanInput : [])
      .map((p) => {
        const fieldKey = String((p && p.field) || "").trim();
        const meta = REVISABLE_FIELDS[fieldKey];
        const nilaiBaru = String((p && p.nilaiBaru) || "").trim();
        if (!meta || !nilaiBaru) return null;
        return {
          field: fieldKey,
          label: meta.label,
          nilaiLama: String(target.obj[meta.sheetCol] || ""),
          nilaiBaru
        };
      })
      .filter(Boolean);

    let fotoBaruId = "";
    if (files.foto && files.foto.length) {
      const mime = String(files.fotoMime || "image/jpeg").split(";")[0] || "image/jpeg";
      if (mime.indexOf("image/") !== 0) throw new Error("Foto harus berupa gambar.");
      const revisiRoot = await drive.getOrCreateChildFolder(ROOT_FOLDER_ID, REVISI_FOLDER_NAME);
      const monthFolder = await drive.getOrCreateChildFolder(revisiRoot.id, dates.currentBulanTahunFolderName());
      const agentFolder = await drive.getOrCreateChildFolder(monthFolder.id, agent.kode);
      const requestFolder = await drive.createUniqueListingFolder(
        agentFolder.id,
        String(target.obj.file_name || dates.ymd(new Date()))
      );
      const fotoFile = await drive.uploadFile(
        requestFolder.id,
        "foto." + extFromMime_(mime, "jpg"),
        mime,
        files.foto
      );
      await drive.shareAnyoneReader(fotoFile.id);
      fotoBaruId = fotoFile.id;
    }

    const narasi = String(narasiInput || "");

    if (!perubahan.length && !fotoBaruId && !String(catatan || "").trim() && !narasi.trim()) {
      throw new Error("Isi minimal satu perubahan, foto, catatan, atau narasi.");
    }

    const nowIso = new Date().toISOString();
    await sheets.ensureRevisionSheet();
    await sheets.appendValues(SHEET_NAMES.REVISIONS, [[
      newRevisionId_(),
      String(targetFileId),
      String(target.obj.file_name || ""),
      agent.kode,
      agent.nama || agent.kode,
      JSON.stringify(perubahan),
      fotoBaruId,
      String(catatan || "").trim(),
      "pending",
      "",
      nowIso,
      nowIso,
      narasi
    ]]);

    await push.notifyAdminKantor({
      title: "Revisi Baru",
      body: agent.nama + " mengajukan revisi untuk " + (target.obj.file_name || "listing"),
      url: "/revisi-review"
    });

    return { ok: true };
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
  return { rows: sortNewestFirst(rows) };
}

async function listForAdmin(agentCode) {
  await agents.requireListingEditor(agentCode);
  const values = await getQueueRows();
  const rows = values.map((row, i) => rowToObj(row, i + 2));

  // One-click preview needs the target listing's *current* Drive photo and
  // folder — not anything stored on the revision request itself — so pull
  // one bulk index instead of a findPropertyRow() per row.
  const propIndex = await listings.getPropertyIndexByFileId();
  rows.forEach((r) => {
    const p = propIndex[r.fileId];
    r.thumbnailId = (p && p.thumbnail) || "";
    r.folderLink = (p && p.folder_link) || "";
  });

  return { rows: sortForAdminReview(rows) };
}

async function listForToday() {
  const values = await getQueueRows();
  return { rows: values.map((row, i) => rowToObj(row, i + 2)) };
}

async function giveFeedback(agentCode, revisionId, feedbackText) {
  return writeMutex.run(async () => {
    await agents.requireListingEditor(agentCode);
    const row = await findRow(revisionId);
    if (!row) throw new Error("Revisi tidak ditemukan.");
    if (row.status === "selesai") {
      const err = new Error("Sudah selesai, tidak bisa diberi feedback lagi.");
      err.statusCode = 403;
      throw err;
    }
    const nowIso = new Date().toISOString();
    await sheets.updateValues(SHEET_NAMES.REVISIONS, "I" + row.rowNumber + ":L" + row.rowNumber, [[
      "revisi", String(feedbackText || "").trim(), row.dateCreated, nowIso
    ]]);

    await push.notifyAgent(row.kodeAgen, {
      title: "Feedback Revisi",
      body: (row.namaListing || "Revisi Anda") + ": " + String(feedbackText || "").trim(),
      url: "/revisi-listing"
    });

    return { ok: true, status: "revisi" };
  });
}

// Either the owning agent (withdrawing their own request) or an admin/
// adminkantor (rejecting one without applying it) can cancel — mirrors
// assertCanRequestRevision_'s "self OR privileged role" shape, but compared
// by kodeAgen here since that's what's stored directly on the request row,
// rather than by name against the listing's free-text "agen" column.
async function cancelRevision(agentCode, revisionId) {
  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode);
    const row = await findRow(revisionId);
    if (!row) throw new Error("Revisi tidak ditemukan.");
    if (row.status === "selesai" || row.status === "dibatalkan") {
      const err = new Error("Revisi ini sudah tidak bisa dibatalkan.");
      err.statusCode = 403;
      throw err;
    }
    const isOwner = row.kodeAgen === String(agent.kode || "").toUpperCase().trim();
    if (!isOwner && !agents.isListingEditor(agent)) {
      const err = new Error("Anda bukan pemilik revisi ini.");
      err.statusCode = 403;
      throw err;
    }
    const nowIso = new Date().toISOString();
    await sheets.updateValues(SHEET_NAMES.REVISIONS, "I" + row.rowNumber + ":L" + row.rowNumber, [[
      "dibatalkan", row.feedback, row.dateCreated, nowIso
    ]]);
    return { ok: true, status: "dibatalkan" };
  });
}

async function applyRevision(agentCode, revisionId, resolvedPerubahan, files, manualNarasi) {
  files = files || {};

  return writeMutex.run(async () => {
    await agents.requireListingEditor(agentCode);
    const row = await findRow(revisionId);
    if (!row) throw new Error("Revisi tidak ditemukan.");
    if (row.status === "selesai") {
      const err = new Error("Sudah selesai.");
      err.statusCode = 403;
      throw err;
    }

    const hasManualNarasi = manualNarasi !== undefined && manualNarasi !== null;
    const narasiText = hasManualNarasi ? String(manualNarasi || "") : "";
    if (hasManualNarasi && !narasiText.trim()) {
      throw new Error("Narasi tidak boleh kosong.");
    }

    const perubahan = (Array.isArray(resolvedPerubahan) ? resolvedPerubahan : row.perubahan)
      .map((p) => {
        const fieldKey = String((p && p.field) || "").trim();
        const meta = REVISABLE_FIELDS[fieldKey];
        const nilaiBaru = String((p && p.nilaiBaru) || "").trim();
        if (!meta || !nilaiBaru) return null;
        return { field: fieldKey, meta, nilaiBaru };
      })
      .filter(Boolean);

    let changed = false;

    if (perubahan.length || hasManualNarasi) {
      const target = await listings.findPropertyRow(row.fileId);
      if (!target) throw new Error("Listing target tidak ditemukan.");

      const file = await drive.getFile(row.fileId, "id,name,mimeType");
      let narasi = hasManualNarasi ? narasiText : await drive.getFileText(row.fileId, file.mimeType);
      let newArea = "";
      let newHarga = "";

      for (const item of perubahan) {
        if (item.field === "area") {
          if (!hasManualNarasi) narasi = parser.replaceAreaLine_(narasi, item.nilaiBaru);
          await listings.updatePropertyField(row.fileId, "area", item.nilaiBaru);
          newArea = item.nilaiBaru;
        } else if (item.field === "harga") {
          const luasTanah = Number(target.obj.luas_tanah) || 0;
          const luasBangunan = Number(target.obj.luas_bangunan) || 0;
          const parsed = parser.extractHarga_(item.nilaiBaru, luasTanah, luasBangunan);
          // extractHarga_ expects a "Harga"-style context; a bare price
          // string like "500 juta" already matches its fallback branch, so
          // this reuses the same robust multi-option/NJOP/per-m2 parsing
          // fixed earlier rather than a separate ad hoc parser.
          if (!hasManualNarasi) narasi = parser.replaceHargaBlock_(narasi, item.nilaiBaru);
          await listings.updatePropertyField(row.fileId, "harga", parsed.harga);
          await listings.updatePropertyField(row.fileId, "harga_per_m2", parsed.hargaPerM2);
          newHarga = parsed.harga;
        } else if (item.meta.kind === "furnished") {
          if (!hasManualNarasi) narasi = parser.replaceFurnishedLine_(narasi, item.nilaiBaru);
          await listings.updatePropertyField(row.fileId, item.meta.sheetCol, item.nilaiBaru);
        } else {
          if (!hasManualNarasi) {
            const line = parser.buildRevisionLine_(item.meta, item.nilaiBaru);
            narasi = parser.replaceLabeledLine_(narasi, item.meta.label, line);
          }
          await listings.updatePropertyField(row.fileId, item.meta.sheetCol, item.nilaiBaru);
        }
      }

      await drive.replaceFileContent(row.fileId, file.name, "text/plain", Buffer.from(narasi, "utf8"));
      // The folder name embeds both area and harga ("<prefix> <area> <harga>
      // <kodeAgen>") — each rename call only touches its own token, so both
      // can run when a single ticket changes both fields.
      if (newArea) await listings.renameListingFolderForArea(row.fileId, newArea);
      if (newHarga) await listings.renameListingFolderForHarga(row.fileId, newHarga);
      changed = true;
    }

    if (files.foto && files.foto.length) {
      const target = await listings.findPropertyRow(row.fileId);
      const oldThumbnailId = target && target.obj.thumbnail;
      if (!oldThumbnailId) throw new Error("Listing ini tidak punya thumbnail untuk diganti.");
      const mime = String(files.fotoMime || "image/jpeg").split(";")[0] || "image/jpeg";
      if (mime.indexOf("image/") !== 0) throw new Error("Foto harus berupa gambar.");

      const ext = extFromMime_(mime, "jpg");
      let thumbName = "thumb." + ext;
      let folderId = null;
      try {
        const txtFile = await drive.getFile(row.fileId, "id,parents");
        folderId = (txtFile.parents || [])[0] || null;
        const folder = folderId && await drive.getFile(folderId, "id,name");
        if (folder && folder.name) thumbName = folder.name + "." + ext;
      } catch (e) {
        // best-effort naming only — falls back to a generic name below
      }
      if (!folderId) {
        const oldThumbMeta = await drive.getFile(oldThumbnailId, "id,parents");
        folderId = (oldThumbMeta.parents || [])[0] || null;
      }
      if (!folderId) throw new Error("Tidak menemukan folder listing untuk upload foto baru.");

      // Uploaded as a brand-new file (not an in-place content replace of the
      // same ID) so the listing's photo gets a new URL — Google serves the
      // direct image URL with a 24h browser cache keyed on that exact URL,
      // so overwriting the same file's bytes would leave every visitor
      // who'd already loaded this listing seeing the stale photo for up to
      // a day. A new file ID has never been cached by anyone. The old
      // thumbnail is trashed rather than deleted outright, same as
      // everywhere else this app removes a superseded file.
      const newThumb = await drive.uploadFile(folderId, thumbName, mime, files.foto);
      await drive.shareAnyoneReader(newThumb.id);
      await listings.updatePropertyField(row.fileId, "thumbnail", newThumb.id);
      await drive.trashFile(oldThumbnailId);
      changed = true;
    }

    if (changed) listings.invalidateListings();

    const nowIso = new Date().toISOString();
    await sheets.updateValues(SHEET_NAMES.REVISIONS, "I" + row.rowNumber + ":L" + row.rowNumber, [[
      "selesai", row.feedback, row.dateCreated, nowIso
    ]]);

    await push.notifyAgent(row.kodeAgen, {
      title: "Revisi Selesai",
      body: "Revisi untuk " + (row.namaListing || "listing Anda") + " sudah diterapkan.",
      url: "/revisi-listing"
    });

    return { ok: true, status: "selesai", applied: changed };
  });
}

module.exports = {
  submitRevision,
  listForAgent,
  listForAdmin,
  listForToday,
  giveFeedback,
  cancelRevision,
  applyRevision
};

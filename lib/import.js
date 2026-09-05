"use strict";

const fs = require("fs");
const drive = require("./drive");
const listings = require("./listings");
const agents = require("./agents");
const parser = require("./parser");
const dates = require("./dates");
const { importMutex, writeMutex } = require("./lock");
const { ROOT_FOLDER_ID, IMPORT_MAX_MS, DATA_DIR, IMPORT_STATE_FILE } = require("./config");

const noopLogger = { info: () => {}, warn: () => {}, error: () => {} };

function loadState() {
  try {
    if (!fs.existsSync(IMPORT_STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(IMPORT_STATE_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}

function saveState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  // write-then-rename so a crash mid-write can't leave import-state.json
  // truncated/corrupted (a plain writeFileSync isn't atomic)
  const tmpFile = IMPORT_STATE_FILE + "." + process.pid + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2));
  fs.renameSync(tmpFile, IMPORT_STATE_FILE);
}

async function getMonthFolderName(folderId, folderName) {
  try {
    const file = await drive.getFile(folderId, "id,name,parents");
    const parents = file.parents || [];
    if (!parents.length) return "";
    const parent = await drive.getFile(parents[0], "id,name");
    return parent.name || "";
  } catch (e) {
    return folderName || "";
  }
}

async function scanFolderAssets(folderId, folderMeta) {
  const result = {
    txtFiles: [],
    thumbnailId: "",
    folderUrl: (folderMeta && folderMeta.webViewLink) || drive.folderWebUrl(folderId),
    subFolderIds: []
  };

  const files = await drive.listChildren(folderId);
  const pngByBaseName = {};
  const pngIds = [];
  const allImageIds = [];

  files.forEach((f) => {
    const name = String(f.name || "");
    if (f.mimeType === "application/vnd.google-apps.folder") {
      result.subFolderIds.push(f.id);
      return;
    }
    // A narrative normally stays a plain .txt, but adminkantor sometimes
    // opens one with "Google Docs" to edit it, which converts the file in
    // place — its name can lose the ".txt" extension entirely, so this
    // also recognizes it by mimeType regardless of what it got renamed to.
    const isTxtByName = /\.txt$/i.test(name) && !/kata\s*kunci/i.test(name);
    const isConvertedGoogleDoc = drive.isGoogleDocMime(f.mimeType) && !/kata\s*kunci/i.test(name);
    if (isTxtByName || isConvertedGoogleDoc) {
      result.txtFiles.push(f);
      return;
    }
    if (parser.isImageName_(name)) {
      allImageIds.push(f.id);
      if (/\.png$/i.test(name)) {
        const base = name.replace(/\.[^.]+$/, "").toLowerCase();
        if (!pngByBaseName[base]) pngByBaseName[base] = f.id;
        pngIds.push(f.id);
      }
    }
  });

  let thumbnailId = "";
  if (result.txtFiles.length > 0) {
    const txtBase = result.txtFiles[0].name.replace(/\.txt$/i, "").toLowerCase();
    thumbnailId = pngByBaseName[txtBase] || "";
  }
  if (!thumbnailId && pngIds.length > 0) thumbnailId = pngIds[0];
  if (!thumbnailId && allImageIds.length > 0) {
    thumbnailId = allImageIds[Math.floor(Math.random() * allImageIds.length)];
  }
  result.thumbnailId = thumbnailId;
  return result;
}

async function processQueue(queue, state, start, log) {
  const agentDatabase = await agents.getAgentDataFromSheet(true);
  const values = await listings.getPropertyRows();
  const propertyState = listings.buildPropertyState(values);
  const lastImportTime = state.lastImportTime ? new Date(state.lastImportTime) : null;
  let processed = 0;

  while (queue.length > 0) {
    if (Date.now() - start > IMPORT_MAX_MS) {
      state.queue = queue;
      saveState(state);
      return { ok: true, stopped: true, remaining: queue.length, processed };
    }

    const folderId = queue.shift();
    let folderMeta;
    try {
      folderMeta = await drive.getFile(folderId, "id,name,webViewLink");
    } catch (err) {
      log.warn({ folderId, err: err.message || String(err) }, "import: folder not found / access denied");
      continue;
    }

    const bulanTahun = await getMonthFolderName(folderId, folderMeta.name);
    const folderAssets = await scanFolderAssets(folderId, folderMeta);

    for (let i = 0; i < folderAssets.txtFiles.length; i++) {
      if (Date.now() - start > IMPORT_MAX_MS) {
        queue.unshift(folderId);
        state.queue = queue;
        saveState(state);
        return { ok: true, stopped: true, remaining: queue.length, processed };
      }

      const file = folderAssets.txtFiles[i];
      const fileId = file.id;
      const fileName = file.name;
      const alreadyExists = !!propertyState.byFileId[fileId];
      const modified = file.modifiedTime ? new Date(file.modifiedTime) : null;
      if (alreadyExists && lastImportTime && modified && modified <= lastImportTime) {
        continue;
      }

      try {
        const text = await drive.getFileText(fileId, file.mimeType);
        const data = parser.extractData(text, fileName, bulanTahun, agentDatabase);
        await listings.upsertFast({
          fileId,
          fileName,
          data,
          thumbnail: folderAssets.thumbnailId || "",
          folderLink: folderAssets.folderUrl || "#",
          dateCreated: file.createdTime || ""
        }, values, propertyState);
        processed++;
        // invalidate right away instead of waiting for the whole queue to
        // drain — a big backlog can take several IMPORT_MAX_MS-bounded runs
        // to finish, and listings imported in an earlier run shouldn't sit
        // stale for that whole time just because the run got cut short
        listings.invalidateListings();
      } catch (e) {
        log.error({ fileName, err: e.message || String(e) }, "import: failed to process file");
      }
    }

    for (let j = 0; j < folderAssets.subFolderIds.length; j++) {
      queue.push(folderAssets.subFolderIds[j]);
    }
  }

  state.queue = [];
  state.lastImportTime = new Date().toISOString();
  state.pendingImportAt = 0;
  saveState(state);
  listings.invalidateListings();
  return { ok: true, stopped: false, remaining: 0, processed };
}

async function runImport(forceFull, logger) {
  const log = logger || noopLogger;
  if (importMutex.locked) return { ok: true, skipped: true, reason: "import already running" };

  return importMutex.run(async () => {
    // also serialize against listings.js/activity.js's writeMutex — both
    // touch the "Data Properti" sheet, and without this a manual listing
    // submission running concurrently with a cron import could each think
    // a given file is new and append it twice
    return writeMutex.run(async () => {
      const start = Date.now();
      const state = loadState();
      let queue = Array.isArray(state.queue) ? state.queue.slice() : [];
      if (forceFull || !queue.length) {
        queue = [ROOT_FOLDER_ID];
      }
      const result = await processQueue(queue, state, start, log);
      result.mode = forceFull ? "full" : "resume";
      return result;
    });
  });
}

async function handleCron(logger) {
  const log = logger || noopLogger;
  const now = new Date();
  const p = dates.partsInTz(now);
  const state = loadState();

  if (Array.isArray(state.queue) && state.queue.length) {
    return runImport(false, log);
  }

  if (p.hour === 18) {
    const today = dates.ymd(now);
    if (state.lastFullScanDate !== today) {
      state.lastFullScanDate = today;
      state.queue = [ROOT_FOLDER_ID];
      saveState(state);
      return runImport(true, log);
    }
  }

  if (p.hour < 9 || p.hour >= 18) {
    return { ok: true, skipped: true, reason: "outside working hours" };
  }

  if (state.pendingImportAt && Date.now() >= Number(state.pendingImportAt)) {
    state.pendingImportAt = 0;
    saveState(state);
    return runImport(true, log);
  }

  const since = new Date(Date.now() - 12 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
  let files = [];
  try {
    files = await drive.searchRecentTxt(since);
  } catch (e) {
    log.error({ err: e.message || String(e) }, "import: searchRecentTxt failed");
    return { ok: false, error: e.message || String(e) };
  }

  if (!files.length) {
    return { ok: true, skipped: true, reason: "nothing new" };
  }

  if (!state.pendingImportAt) {
    state.pendingImportAt = Date.now() + 5 * 60 * 1000;
    saveState(state);
    return {
      ok: true,
      scheduled: true,
      files: files.map((f) => f.name),
      importAt: new Date(state.pendingImportAt).toISOString()
    };
  }

  return { ok: true, skipped: true, reason: "import already scheduled" };
}

module.exports = { loadState, saveState, runImport, handleCron };

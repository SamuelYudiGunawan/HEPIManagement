"use strict";

const { Readable } = require("stream");
const { driveClient } = require("./google");
const { withRetry } = require("./retry");

function escapeQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function listChildren(folderId) {
  const drive = await driveClient();
  const files = [];
  let pageToken;
  do {
    const res = await withRetry(() => drive.files.list({
      q: `'${escapeQueryValue(folderId)}' in parents and trashed = false`,
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime,createdTime,webViewLink)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    }));
    files.push.apply(files, res.data.files || []);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return files;
}

async function getFile(fileId, fields) {
  const drive = await driveClient();
  const res = await withRetry(() => drive.files.get({
    fileId,
    fields: fields || "id,name,mimeType,modifiedTime,createdTime,webViewLink,parents",
    supportsAllDrives: true
  }));
  return res.data;
}

async function getFileText(fileId) {
  const drive = await driveClient();
  const res = await withRetry(() => drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" }
  ));
  return Buffer.from(res.data).toString("utf8");
}

async function createFolder(parentId, name) {
  const drive = await driveClient();
  const res = await withRetry(() => drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId]
    },
    fields: "id,name,webViewLink",
    supportsAllDrives: true
  }));
  return res.data;
}

async function findChildFolder(parentId, name) {
  const drive = await driveClient();
  const res = await withRetry(() => drive.files.list({
    q: `'${escapeQueryValue(parentId)}' in parents and name = '${escapeQueryValue(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name,webViewLink)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  }));
  return (res.data.files && res.data.files[0]) || null;
}

async function getOrCreateChildFolder(parentId, name) {
  const existing = await findChildFolder(parentId, name);
  if (existing) return existing;
  return createFolder(parentId, name);
}

async function createUniqueListingFolder(monthFolderId, baseName) {
  if (!(await findChildFolder(monthFolderId, baseName))) {
    return createFolder(monthFolderId, baseName);
  }
  let n = 2;
  while (await findChildFolder(monthFolderId, baseName + " (" + n + ")")) {
    n++;
  }
  return createFolder(monthFolderId, baseName + " (" + n + ")");
}

async function uploadFile(parentId, name, mimeType, buffer) {
  const drive = await driveClient();
  // Readable.from(buffer) is recreated on every retry attempt (see withRetry) —
  // safe because `buffer` is a plain Buffer, not a stream that gets drained.
  const res = await withRetry(() => drive.files.create({
    requestBody: {
      name,
      parents: [parentId],
      mimeType: mimeType || "application/octet-stream"
    },
    media: {
      mimeType: mimeType || "application/octet-stream",
      body: Readable.from(buffer)
    },
    fields: "id,name,webViewLink,createdTime",
    supportsAllDrives: true
  }));
  return res.data;
}

async function searchRecentTxt(sinceIso) {
  const drive = await driveClient();
  const q = "mimeType = 'text/plain'"
    + " and (createdTime > '" + sinceIso + "' or modifiedTime > '" + sinceIso + "')"
    + " and trashed = false";
  const res = await withRetry(() => drive.files.list({
    q,
    fields: "files(id,name,modifiedTime,createdTime)",
    pageSize: 20,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  }));
  return res.data.files || [];
}

function folderWebUrl(folderId) {
  return "https://drive.google.com/drive/folders/" + folderId;
}

module.exports = {
  listChildren,
  getFile,
  getFileText,
  createFolder,
  findChildFolder,
  getOrCreateChildFolder,
  createUniqueListingFolder,
  uploadFile,
  searchRecentTxt,
  folderWebUrl
};

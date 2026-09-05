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

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";

function isGoogleDocMime(mimeType) {
  return mimeType === GOOGLE_DOC_MIME;
}

// A narrative file downloaded straight (alt=media) works for a plain .txt,
// but a native Google Doc — e.g. adminkantor opened the .txt with "Google
// Docs" to edit it, which converts it in place — has no raw byte content to
// download that way and needs to be exported as plain text instead.
async function getFileText(fileId, mimeType) {
  const drive = await driveClient();
  if (isGoogleDocMime(mimeType)) {
    const res = await withRetry(() => drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "arraybuffer" }
    ));
    return Buffer.from(res.data).toString("utf8");
  }
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

async function replaceFileContent(fileId, name, mimeType, buffer) {
  const drive = await driveClient();
  // Readable.from(buffer) is recreated on every retry attempt (see withRetry) —
  // safe because `buffer` is a plain Buffer, not a stream that gets drained.
  const res = await withRetry(() => drive.files.update({
    fileId,
    requestBody: {
      name,
      mimeType: mimeType || "application/octet-stream"
    },
    media: {
      mimeType: mimeType || "application/octet-stream",
      body: Readable.from(buffer)
    },
    fields: "id,name,webViewLink,modifiedTime",
    supportsAllDrives: true
  }));
  return res.data;
}

async function shareAnyoneReader(fileId) {
  const drive = await driveClient();
  await withRetry(() => drive.permissions.create({
    fileId,
    requestBody: { role: "reader", type: "anyone" },
    supportsAllDrives: true
  }));
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
  isGoogleDocMime,
  createFolder,
  findChildFolder,
  getOrCreateChildFolder,
  createUniqueListingFolder,
  uploadFile,
  replaceFileContent,
  shareAnyoneReader,
  searchRecentTxt,
  folderWebUrl
};

"use strict";

const dates = require("./dates");
const listings = require("./listings");
const revision = require("./revision");

async function listToday(agentCode) {
  const [allListings, revisions] = await Promise.all([
    listings.getListings(true),
    revision.listForToday()
  ]);
  const today = dates.ymd(new Date());
  const items = [];
  const listingById = {};
  (allListings || []).forEach((row) => { listingById[row.fileId] = row; });
  (allListings || []).forEach((row) => {
    if (!row.dateCreated || dates.toDateKey(row.dateCreated) !== today) return;
    items.push({ kind: "listing", label: "Listing Baru", id: row.fileId, title: row.area || row.fileName || row.fileId, agent: row.agen || row.kodeAgen, status: row.sold === "YA" ? "SOLD" : "Tayang", dateCreated: row.dateCreated, url: "/?id=" + encodeURIComponent(row.fileId), listing: row });
  });
  (revisions.rows || []).forEach((row) => {
    if (row.status !== "selesai" || dates.toDateKey(row.dateUpdated) !== today) return;
    items.push({ kind: "revision", label: "Revisi", id: row.revisionId, title: row.namaListing || (listingById[row.fileId] && listingById[row.fileId].area) || row.fileId, agent: row.namaAgen || row.kodeAgen, status: row.status, dateCreated: row.dateUpdated || row.dateCreated, url: "/revisi-review", revision: row, listing: listingById[row.fileId] || null });
  });
  items.sort((a, b) => String(b.dateCreated).localeCompare(String(a.dateCreated)));
  return { date: today, items };
}

module.exports = { listToday };

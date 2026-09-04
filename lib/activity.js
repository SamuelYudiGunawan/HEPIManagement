"use strict";

const sheets = require("./sheets");
const agents = require("./agents");
const dates = require("./dates");
const { writeMutex } = require("./lock");
const { SHEET_NAMES, SCORE_WEIGHTS, MONTH_TARGETS, KONTEN_POSTING_TIERS } = require("./config");
const { partsInTz, ymd, monthMeta, toDateKey, parseDateInput } = dates;

function toCount(value) {
  const n = Math.floor(Number(value));
  if (!isFinite(n) || n < 0) return 0;
  return n;
}

function isActivityFilled(row) {
  return toCount(row && row[4]) > 0
    || toCount(row && row[5]) > 0
    || toCount(row && row[6]) > 0
    || toCount(row && row[7]) > 0;
}

function computeScore(listing, konten, posting, survey, closing) {
  return listing * SCORE_WEIGHTS.listing
    + konten * SCORE_WEIGHTS.konten
    + posting * SCORE_WEIGHTS.posting
    + survey * SCORE_WEIGHTS.survey
    + closing * SCORE_WEIGHTS.closing;
}

function postingTargetForKonten(konten) {
  const n = toCount(konten);
  for (let i = 0; i < KONTEN_POSTING_TIERS.length; i++) {
    if (n >= KONTEN_POSTING_TIERS[i].konten) return KONTEN_POSTING_TIERS[i].posting;
  }
  return MONTH_TARGETS.posting;
}

function monthPassStatus(totals) {
  const listing = toCount(totals && totals.listing);
  const konten = toCount(totals && totals.konten);
  const posting = toCount(totals && totals.posting);
  const closing = toCount(totals && totals.closing);
  const targetListing = MONTH_TARGETS.listing;
  const targetPosting = postingTargetForKonten(konten);
  const needListing = Math.max(0, targetListing - listing);
  const needPosting = Math.max(0, targetPosting - posting);
  const needClosing = Math.max(0, MONTH_TARGETS.closing - closing);
  const passByQuota = needListing === 0 && needPosting === 0;
  const passByClosing = closing >= MONTH_TARGETS.closing;
  return {
    passed: passByQuota || passByClosing,
    reason: passByClosing ? "closing" : (passByQuota ? "quota" : ""),
    listing,
    posting,
    closing,
    needListing,
    needPosting,
    needClosing,
    targetListing,
    targetPosting,
    targetClosing: MONTH_TARGETS.closing
  };
}

async function getActivityValues() {
  await sheets.ensureDailyActivitySheet();
  return sheets.getValues(SHEET_NAMES.DAILY_ACTIVITY, "A1:O");
}

async function getActiveAgentsForClosing(agentCode) {
  await agents.requireAdmin(agentCode);
  return agents.listActiveAgents();
}

async function submitClosings(agentCode, payload) {
  payload = payload || {};
  return writeMutex.run(async () => {
    await agents.requireAdmin(agentCode);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const agentMap = await agents.getAgentDataFromSheet();
    const merged = {};
    items.forEach((item) => {
      const kode = String((item && item.kode) || "").toUpperCase().trim();
      if (!kode) return;
      if (!agentMap[kode]) throw new Error("Agen tidak ditemukan: " + kode);
      if (!agents.isAgentActive(agentMap[kode])) throw new Error("Agen nonaktif: " + kode);
      const tanggal = parseDateInput(item.tanggal || payload.tanggal);
      const dateKey = toDateKey(tanggal);
      const key = kode + "|" + dateKey;
      if (!merged[key]) merged[key] = { kode, tanggal, dateKey, jumlah: 0 };
      merged[key].jumlah += toCount(item.jumlah);
    });
    const keys = Object.keys(merged);
    if (!keys.length) throw new Error("Isi minimal satu agent closing.");

    const values = await getActivityValues();
    const now = new Date().toISOString();
    const saved = [];

    for (let k = 0; k < keys.length; k++) {
      const rec = merged[keys[k]];
      const agent = agentMap[rec.kode];
      const nama = agent.nama || rec.kode;
      const jumlah = rec.jumlah;
      const dateKey = rec.dateKey;
      let matchRow = -1;
      let emptyRow = -1;
      for (let i = 1; i < values.length; i++) {
        const rowKode = String(values[i][2] || "").toUpperCase().trim();
        if (rowKode === rec.kode && toDateKey(values[i][1]) === dateKey) {
          matchRow = i + 1;
          break;
        }
        if (!rowKode && emptyRow < 0) emptyRow = i + 1;
      }

      if (matchRow > 0) {
        await sheets.updateValues(SHEET_NAMES.DAILY_ACTIVITY, "I" + matchRow, [[jumlah]]);
      } else if (jumlah <= 0) {
        continue;
      } else if (emptyRow > 0) {
        await sheets.updateValues(SHEET_NAMES.DAILY_ACTIVITY, "A" + emptyRow + ":I" + emptyRow, [[
          now, dateKey, rec.kode, nama, "", "", "", "", jumlah
        ]]);
        values[emptyRow - 1] = [now, dateKey, rec.kode, nama, "", "", "", "", jumlah];
      } else {
        await sheets.appendValues(SHEET_NAMES.DAILY_ACTIVITY, [[
          now, dateKey, rec.kode, nama, "", "", "", "", jumlah
        ]]);
      }
      saved.push({ kode: rec.kode, nama, jumlah, tanggal: dateKey });
    }

    if (!saved.length) throw new Error("Jumlah closing harus lebih dari 0.");
    return { ok: true, saved };
  });
}

async function submitDailyActivity(agentCode, payload) {
  payload = payload || {};
  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode);
    const tanggal = parseDateInput(payload.tanggal);
    const listing = toCount(payload.listing);
    const konten = toCount(payload.konten);
    const posting = toCount(payload.posting);
    const survey = toCount(payload.survey);
    const dateKey = toDateKey(tanggal);
    const kode = String(agent.kode || agentCode).toUpperCase().trim();
    const nama = agent.nama || kode;
    const now = new Date().toISOString();
    const values = await getActivityValues();

    let matchRow = -1;
    let emptyRow = -1;
    for (let i = 1; i < values.length; i++) {
      const rowKode = String(values[i][2] || "").toUpperCase().trim();
      if (rowKode === kode && toDateKey(values[i][1]) === dateKey) {
        matchRow = i + 1;
        break;
      }
      if (!rowKode && emptyRow < 0) emptyRow = i + 1;
    }

    const rowValues = [now, dateKey, kode, nama, listing, konten, posting, survey];

    if (matchRow > 0) {
      if (isActivityFilled(values[matchRow - 1])) {
        return { ok: false, alreadyFilled: true, tanggal: dateKey };
      }
      await sheets.updateValues(SHEET_NAMES.DAILY_ACTIVITY, "A" + matchRow, [[now]]);
      await sheets.updateValues(SHEET_NAMES.DAILY_ACTIVITY, "E" + matchRow + ":H" + matchRow, [[listing, konten, posting, survey]]);
      return { ok: true, updated: true, tanggal: dateKey };
    }

    if (emptyRow > 0) {
      await sheets.updateValues(SHEET_NAMES.DAILY_ACTIVITY, "A" + emptyRow + ":I" + emptyRow, [rowValues.concat([""])]);
      return { ok: true, updated: false, tanggal: dateKey };
    }

    await sheets.appendValues(SHEET_NAMES.DAILY_ACTIVITY, [rowValues.concat([""])]);
    return { ok: true, updated: false, tanggal: dateKey };
  });
}

async function checkDailyActivityDate(agentCode, tanggal) {
  const agent = await agents.requireAgent(agentCode);
  const dateKey = toDateKey(parseDateInput(tanggal));
  const kode = String(agent.kode || agentCode).toUpperCase().trim();
  const values = await getActivityValues();
  for (let i = 1; i < values.length; i++) {
    const rowKode = String(values[i][2] || "").toUpperCase().trim();
    if (rowKode === kode && toDateKey(values[i][1]) === dateKey) {
      return {
        filled: isActivityFilled(values[i]),
        hasClosing: toCount(values[i][8]) > 0,
        tanggal: dateKey
      };
    }
  }
  return { filled: false, hasClosing: false, tanggal: dateKey };
}

function currentYearMonth() {
  const p = partsInTz(new Date());
  return { year: p.year, month: p.month };
}

async function getMonthlyAgentScores(agentCode) {
  await agents.requireAgent(agentCode);
  const values = await getActivityValues();
  const { year, month } = currentYearMonth();
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const monthMetas = [monthMeta(prevYear, prevMonth), monthMeta(year, month)];
  const allowed = {};
  monthMetas.forEach((m) => { allowed[m.monthKey] = true; });
  const byMonth = {};
  monthMetas.forEach((m) => { byMonth[m.monthKey] = {}; });

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const kode = String(row[2] || "").toUpperCase().trim();
    if (!kode) continue;
    const dateKey = toDateKey(row[1]);
    const mk = dateKey ? dateKey.slice(0, 7) : "";
    if (!dateKey || !allowed[mk]) continue;
    const listing = toCount(row[4]);
    const konten = toCount(row[5]);
    const posting = toCount(row[6]);
    const survey = toCount(row[7]);
    const closing = toCount(row[8]);
    let skor = Number(row[14]);
    if (row[14] === "" || row[14] == null || !isFinite(skor)) {
      skor = computeScore(listing, konten, posting, survey, closing);
    }
    if (!byMonth[mk][kode]) {
      byMonth[mk][kode] = {
        kode,
        nama: String(row[3] || kode).trim() || kode,
        listing: 0, konten: 0, posting: 0, survey: 0, closing: 0, skor: 0
      };
    }
    const rec = byMonth[mk][kode];
    if (row[3]) rec.nama = String(row[3]).trim();
    rec.listing += listing;
    rec.konten += konten;
    rec.posting += posting;
    rec.survey += survey;
    rec.closing += closing;
    rec.skor += skor;
  }

  const months = monthMetas.map((m) => {
    const list = Object.keys(byMonth[m.monthKey]).map((k) => {
      const rec = byMonth[m.monthKey][k];
      rec.progress = monthPassStatus(rec);
      return rec;
    });
    list.sort((a, b) => {
      if (b.skor !== a.skor) return b.skor - a.skor;
      return String(a.nama).localeCompare(String(b.nama), "id");
    });
    return { bulan: m.bulan, monthKey: m.monthKey, agents: list };
  });
  return { months };
}

async function getAgentMonthHistory(agentCode) {
  const agent = await agents.requireAgent(agentCode);
  const values = await getActivityValues();
  const { year, month } = currentYearMonth();
  const today = ymd(new Date());
  const kode = String(agent.kode || agentCode).toUpperCase().trim();
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const monthMetas = [monthMeta(prevYear, prevMonth), monthMeta(year, month)];
  const allowed = {};
  monthMetas.forEach((m) => { allowed[m.monthKey] = true; });
  const byMonth = {};
  monthMetas.forEach((m) => {
    byMonth[m.monthKey] = {
      monthKey: m.monthKey,
      bulan: m.bulan,
      daysInMonth: m.daysInMonth,
      filled: {},
      totals: { listing: 0, konten: 0, posting: 0, survey: 0, closing: 0, skor: 0 }
    };
  });

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rowKode = String(row[2] || "").toUpperCase().trim();
    if (rowKode !== kode) continue;
    const dateKey = toDateKey(row[1]);
    const mk = dateKey ? dateKey.slice(0, 7) : "";
    if (!dateKey || !allowed[mk]) continue;
    const listing = toCount(row[4]);
    const konten = toCount(row[5]);
    const posting = toCount(row[6]);
    const survey = toCount(row[7]);
    const closing = toCount(row[8]);
    let skor = Number(row[14]);
    if (row[14] === "" || row[14] == null || !isFinite(skor)) {
      skor = computeScore(listing, konten, posting, survey, closing);
    }
    const rec = byMonth[mk];
    rec.filled[dateKey] = { listing, konten, posting, survey, closing, skor };
    rec.totals.listing += listing;
    rec.totals.konten += konten;
    rec.totals.posting += posting;
    rec.totals.survey += survey;
    rec.totals.closing += closing;
    rec.totals.skor += skor;
  }

  const months = monthMetas.map((m) => {
    const rec = byMonth[m.monthKey];
    rec.progress = monthPassStatus(rec.totals);
    return rec;
  });

  return { nama: agent.nama || kode, kode, today, months };
}

module.exports = {
  getActiveAgentsForClosing,
  submitClosings,
  submitDailyActivity,
  checkDailyActivityDate,
  getMonthlyAgentScores,
  getAgentMonthHistory
};

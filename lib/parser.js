"use strict";

function normalizePhone_(value) {
  let s = String(value || "").trim();
  if (!s) return "";
  s = s.replace(/[^\d+]/g, "");
  if (s.startsWith("+62")) s = "0" + s.substring(3);
  if (s.startsWith("62")) s = "0" + s.substring(2);
  return s;
}

function titleCase_(str) {
  str = String(str || "").trim();
  if (!str) return "";
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

function getFirstMatch_(text, regex) {
  const m = String(text || "").match(regex);
  if (!m) return "";
  return String(m[1] !== undefined ? m[1] : m[0]).trim();
}

function parseRoomCountText_(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const plus = s.match(/(\d+)\s*\+\s*(\d+)/);
  if (plus) {
    const a = parseInt(plus[1], 10);
    const b = parseInt(plus[2], 10);
    if (isNaN(a) || isNaN(b) || a > 20 || b > 20) return "";
    return a + "+" + b;
  }
  const m = s.match(/\d+/);
  if (!m) return "";
  const n = parseInt(m[0], 10);
  if (isNaN(n) || n > 20) return "";
  return String(n);
}

function bersihkanHargaProperti(teksHarga) {
  if (!teksHarga) return 0;
  let str = String(teksHarga).toLowerCase().trim();
  str = str.replace(/(?:\/\s*m\s*[2²]\b|\/\s*meter\b|per\s*meter\b|\bper\s*m\s*[2²]\b).*$/i, "").trim();

  const matchHarga = str.match(/\d+(?:[.,]\d+)?\s*(?:miliar|milyar|m|juta|jt|ribu|rb)/i);
  if (matchHarga) str = matchHarga[0];

  str = str.replace(/rp/gi, "");
  str = str.replace(/\s+/g, "");

  let pengali = 1;
  if (/miliar|milyar/i.test(str)) pengali = 1000000000;
  else if (/juta|jt/i.test(str)) pengali = 1000000;
  else if (/ribu|rb/i.test(str)) pengali = 1000;
  else if (/\d+(?:[.,]\d+)?m\b/i.test(str)) pengali = 1000000000;

  str = str.replace(/[^\d.,]/g, "");
  str = str.replace(/,/g, ".");

  const dotCount = (str.match(/\./g) || []).length;
  if (dotCount > 1) {
    str = str.replace(/\./g, "");
  } else if (dotCount === 1) {
    const belakang = str.split(".")[1] || "";
    if (belakang.length === 3 && pengali === 1) str = str.replace(/\./g, "");
  }

  const num = parseFloat(str) || 0;
  return Math.round(num * pengali);
}

function extractHarga_(text, luasTanah) {
  text = String(text || "");
  luasTanah = Number(luasTanah) || 0;
  let harga = 0;
  let hargaPerM2 = 0;
  let hargaLine = "";

  const hargaMatch = text.match(/^harga\s*[:\-]?\s*(.+)$/im);
  if (hargaMatch) hargaLine = String(hargaMatch[1] || "").trim();

  if (!hargaLine) {
    const sewaMatch = text.match(
      /^disewakan\s+.*?(\d+(?:[.,]\d+)?\s*(?:m|miliar|milyar|jt|juta|rb|ribu).*)$/im
    );
    if (sewaMatch) hargaLine = String(sewaMatch[1] || "").trim();
  }

  if (!hargaLine) {
    const angkaMatch = text.match(/(\d+(?:[.,]\d+)?\s*(?:miliar|milyar|m|juta|jt|ribu|rb))/i);
    if (angkaMatch) hargaLine = angkaMatch[1];
  }

  if (hargaLine) {
    harga = bersihkanHargaProperti(hargaLine);
    const isHargaPerM2 = /\/\s*m\s*2\b|\/\s*m²|per\s*meter|permeter\b|\/\s*meter\b|\bper\s*m\s*2\b/i.test(hargaLine);
    if (isHargaPerM2 && luasTanah > 0) {
      hargaPerM2 = harga;
      harga = Math.round(harga * luasTanah);
    }
  }

  return { harga, hargaPerM2 };
}

function extractData(text, fileName, bulanTahun, agentDatabase) {
  text = String(text || "");
  fileName = String(fileName || "");
  bulanTahun = String(bulanTahun || "");
  const upperFileName = fileName.toUpperCase();
  const code = upperFileName.substring(0, 2);

  const kategori =
    code[0] === "J" ? "Jual" :
    code[0] === "S" ? "Sewa" :
    "Unknown";

  const tipeMap = {
    T: "Tanah", R: "Rumah", U: "Ruko", K: "Kost",
    N: "Kantor", P: "Pabrik", A: "Apartemen", G: "Gudang"
  };

  let tipe =
    (code === "JR" && /kost/i.test(fileName))
      ? "Kost"
      : (tipeMap[code[1]] || "Unknown");

  let area = getFirstMatch_(text, /(?:Dijual|Disewakan|Disewa).*?\s+di\s+([^\n]+)/i);
  if (!area) area = fileName.replace(/\.txt$/i, "").trim();

  let luasTanah =
    parseFloat(getFirstMatch_(text, /Luas Tanah\s*[:]?\s*(\d+(?:[.,]\d+)?)/i).replace(",", ".")) || 0;
  let luasBangunan =
    parseFloat(getFirstMatch_(text, /Luas Bangunan\s*[:]?\s*(\d+(?:[.,]\d+)?)/i).replace(",", ".")) || 0;
  const luasUnit =
    parseFloat(getFirstMatch_(text, /Luas Unit\s*[:]?\s*(\d+(?:[.,]\d+)?)/i).replace(",", ".")) || 0;
  if (!luasBangunan && luasUnit) luasBangunan = luasUnit;
  if (/full bangunan/i.test(text) && luasTanah) luasBangunan = luasTanah;

  const hargaResult = extractHarga_(text, luasTanah);
  const harga = hargaResult.harga;
  const hargaPerM2 = hargaResult.hargaPerM2;

  let kamarTidur = parseRoomCountText_(getFirstMatch_(text, /Kamar Tidur\s*[:\-]?\s*([^\n]+)/i));
  let kamarMandi = parseRoomCountText_(getFirstMatch_(text, /Kamar Mandi\s*[:\-]?\s*([^\n]+)/i));

  if (!kamarTidur) {
    const scanKT = text.match(/(\d+)\s*kt\b/i) || text.match(/\bkt\s*[:\-]?\s*(\d+)/i);
    if (scanKT && parseInt(scanKT[1], 10) <= 20) kamarTidur = scanKT[1];
  }
  if (!kamarMandi) {
    const scanKM = text.match(/(\d+)\s*km\b/i) || text.match(/\bkm\s*[:\-]?\s*(\d+)/i);
    if (scanKM && parseInt(scanKM[1], 10) <= 20) kamarMandi = scanKM[1];
  }
  if (isNaN(parseInt(kamarTidur, 10)) || parseInt(kamarTidur, 10) > 20) kamarTidur = "";
  if (isNaN(parseInt(kamarMandi, 10)) || parseInt(kamarMandi, 10) > 20) kamarMandi = "";

  const listrik = getFirstMatch_(text, /Listrik\s*[:]?\s*(\d+)/i);

  let sumberAir = "";
  if (/PDAM/i.test(text)) sumberAir = "PDAM";
  if (/Artetis|Artesis|Sumur Bor/i.test(text)) {
    sumberAir = sumberAir ? sumberAir + " + Sumur Bor" : "Sumur Bor";
  }
  if (/Sumur/i.test(text) && !sumberAir) sumberAir = "Sumur";

  let furnished = "Tidak";
  if (/semi furnished/i.test(text)) furnished = "Semi";
  else if (/full furnished|furnished/i.test(text)) furnished = "Ya";

  let hadap = "";
  const hadapMatch = text.match(
    /hadap\s*[:\-]?\s*(utara|selatan|timur|barat|timur laut|barat laut|barat daya|tenggara)/i
  );
  if (hadapMatch) hadap = titleCase_(hadapMatch[1]);

  let garasiRaw = getFirstMatch_(text, /Garasi\s*[:\-]?\s*([^\n]+)/i);
  let garasi = parseRoomCountText_(garasiRaw);
  if (garasi) garasi = garasi + " mobil";

  const sertifikat = getFirstMatch_(text, /Sertifikat\s*[:]?\s*([^\n]+)/i);

  let agen = "";
  let kontak = "";
  const agentMatch = upperFileName.match(/\b(HP[A-Z0-9]{3,})\b/);
  if (agentMatch) {
    const codeAgent = agentMatch[1].trim();
    const agent = agentDatabase[codeAgent];
    if (agent) {
      agen = agent.nama || codeAgent;
      kontak = agent.hp || "";
    } else {
      agen = codeAgent;
      kontak = "";
    }
  }

  return {
    kategori,
    tipe,
    area,
    harga,
    hargaPerM2,
    luasTanah,
    luasBangunan,
    kamarTidur,
    kamarMandi,
    listrik,
    sumberAir,
    furnished,
    fullBangunan: /full bangunan/i.test(text) ? "Ya" : "Tidak",
    hadap,
    garasi,
    sertifikat,
    kontak,
    agen,
    bulanTahun,
    sold: ""
  };
}

function sanitizeDriveName_(name) {
  return String(name || "")
    .replace(/[\/\\:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 180);
}

function hargaForTitle_(harga) {
  let s = String(harga || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = s.replace(/^rp\.?\s*/i, "");
  s = s.replace(
    /(\d+(?:[.,]\d+)?)\s*(?:juta|jt)\b(?:\s*(?:\/|\bper\b)?\s*(?:tahun|thn|th|year))?/gi,
    "$1JT"
  );
  s = s.replace(/(\d+(?:[.,]\d+)?)\s*(?:miliar|milyar)\b/gi, "$1M");
  s = s.replace(/\s*(?:\/|\bper\b)\s*(?:tahun|thn|th|year)\b/gi, "");
  s = s.replace(/\b(?:tahun|thn)\b/gi, "");
  s = s.replace(/\s*(?:\/|\bper\b)?\s*(?:bulan|bln|month)\b/gi, "BLN");
  s = s.replace(/\s+(JT|M|BLN)\b/gi, "$1");
  s = s.replace(/\b(JT|M)BLN\b/gi, "$1BLN");
  return s.replace(/\s+/g, " ").trim();
}

function stripDataUrl_(value) {
  return String(value || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
}

function normalizeImageExt_(ext, mime) {
  const e = String(ext || "").toLowerCase().replace(/^\./, "").trim();
  if (e === "png" || e === "jpg" || e === "jpeg" || e === "webp" || e === "gif") {
    return e === "jpeg" ? "jpg" : e;
  }
  const m = String(mime || "").toLowerCase();
  if (m.indexOf("png") >= 0) return "png";
  if (m.indexOf("webp") >= 0) return "webp";
  if (m.indexOf("gif") >= 0) return "gif";
  return "jpg";
}

function parkLine_(label, value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (new RegExp("^" + label + "\\b", "i").test(v)) return v;
  if (/mobil/i.test(v)) return label + " " + v;
  return label + " " + v + " mobil";
}

function formatPhoneDisplay_(hp) {
  const d = String(hp || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length < 8) return d;
  return d.replace(/(\d{4})(\d{4})(\d+)/, "$1-$2-$3");
}

function listingHashtags_(agent) {
  return "#HepiProperty #HepiPropertySemarang #JualanPropertyItuAsyik #SingPentingHepi #" + String(agent && agent.kode || "").toUpperCase();
}

function canonicalAgentFooter_(agent) {
  agent = agent || {};
  const lines = [];
  lines.push("Hubungi : ");
  lines.push(agent.nama || agent.kode || "");
  const hp = formatPhoneDisplay_(agent.hp);
  if (hp) lines.push(hp);
  lines.push("");
  lines.push(listingHashtags_(agent));
  return lines.join("\n");
}

function buildListingNarrative_(fields, agent) {
  fields = fields || {};
  agent = agent || {};
  const verb = fields.kategori === "Sewa" ? "Disewakan" : "Dijual";
  const lines = [];
  lines.push(verb + " " + fields.tipe + " di " + fields.daerah);
  lines.push("");
  if (fields.luasTanah) lines.push("Luas Tanah " + fields.luasTanah + " m²");
  if (fields.luasBangunan) lines.push("Luas Bangunan " + fields.luasBangunan + " m²");
  if (fields.kamarTidur) lines.push("Kamar Tidur " + fields.kamarTidur);
  if (fields.kamarMandi) lines.push("Kamar Mandi " + fields.kamarMandi);
  if (fields.listrik) {
    lines.push(/watt/i.test(fields.listrik) ? "Listrik " + fields.listrik : "Listrik " + fields.listrik + " Watt");
  }
  if (fields.air) {
    lines.push(/^air\b/i.test(fields.air) ? fields.air : "Air " + fields.air);
  }
  if (fields.sertifikat) {
    lines.push(/^sertifikat\b/i.test(fields.sertifikat) ? fields.sertifikat : "Sertifikat " + fields.sertifikat);
  }
  if (fields.hadap) lines.push("Hadap " + fields.hadap);
  if (fields.furnished === "Ya") lines.push("Furnished");
  else if (fields.furnished === "Semi") lines.push("Semi Furnished");
  const gLine = parkLine_("Garasi", fields.garasi);
  const cLine = parkLine_("Carport", fields.carport);
  if (gLine) lines.push(gLine);
  if (cLine) lines.push(cLine);
  if (fields.fullBangunan) lines.push("Full Bangunan");
  if (fields.narasi) {
    lines.push("");
    lines.push(fields.narasi);
  }
  lines.push("");
  let hargaLine = "Harga " + fields.harga;
  if (fields.nego) hargaLine += " nego";
  lines.push(hargaLine);
  lines.push("");
  lines.push(canonicalAgentFooter_(agent).trim());
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function isImageName_(name) {
  return /\.(png|jpg|jpeg|webp|gif)$/i.test(String(name || "").toLowerCase());
}

module.exports = {
  normalizePhone_,
  extractHarga_,
  extractData,
  sanitizeDriveName_,
  hargaForTitle_,
  stripDataUrl_,
  normalizeImageExt_,
  buildListingNarrative_,
  isImageName_
};

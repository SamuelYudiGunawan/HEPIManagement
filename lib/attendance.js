"use strict";

const sheets = require("./sheets");
const agents = require("./agents");
const { writeMutex } = require("./lock");
const {
  SHEET_NAMES,
  ATTENDANCE_POINTS,
  ATTENDANCE_OFFICE_IPS,
  ATTENDANCE_REQUIRE_OFFICE_IP,
  ATTENDANCE_OFFICE_LAT,
  ATTENDANCE_OFFICE_LON,
  ATTENDANCE_RADIUS_METERS
} = require("./config");
const { partsInTz, ymd } = require("./dates");

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function normalizeIp(value) {
  let ip = String(value || "").trim().toLowerCase();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  return ip;
}

function officeWifiAllowed(remoteIp) {
  if (!ATTENDANCE_REQUIRE_OFFICE_IP) return true;
  const normalized = normalizeIp(remoteIp);
  return !!normalized && ATTENDANCE_OFFICE_IPS.some((ip) => normalizeIp(ip) === normalized);
}

function meetingTime(now) {
  const parts = partsInTz(now || new Date());
  const date = ymd(now || new Date());
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const allowed = parts.weekday === "Wed" && minuteOfDay >= 18 * 60 && minuteOfDay <= 22 * 60 + 30;
  return { date, parts, allowed };
}

function distanceMeters(lat1, lon1, lat2, lon2) {
  const toRadians = (degrees) => degrees * Math.PI / 180;
  const earthRadius = 6371000;
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(deltaLon / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function officeLocation() {
  return {
    latitude: ATTENDANCE_OFFICE_LAT,
    longitude: ATTENDANCE_OFFICE_LON,
    radiusMeters: ATTENDANCE_RADIUS_METERS
  };
}

async function getAllRecords() {
  await sheets.ensureMeetingAttendanceSheet();
  return sheets.getValues(SHEET_NAMES.MEETING_ATTENDANCE, "A1:H");
}

function hasAttendance(values, date, agentCode) {
  const kode = String(agentCode || "").toUpperCase().trim();
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    if (String(row[0] || "").trim() === date
      && String(row[1] || "").toUpperCase().trim() === kode) return true;
  }
  return false;
}

async function getStatus(agentCode, remoteIp, now) {
  const agent = await agents.requireAgent(agentCode);
  const meeting = meetingTime(now || new Date());
  const networkAllowed = officeWifiAllowed(remoteIp);
  const eligible = meeting.allowed && networkAllowed;
  const values = eligible ? await getAllRecords() : [];
  const alreadyMarked = eligible && hasAttendance(values, meeting.date, agent.kode || agentCode);
  let reason = "ready";
  if (!meeting.allowed) reason = "outside_window";
  else if (!networkAllowed) reason = "outside_office_wifi";
  else if (alreadyMarked) reason = "already_marked";
  return {
    date: meeting.date,
    weekday: meeting.parts.weekday,
    timeAllowed: meeting.allowed,
    officeWifiAllowed: networkAllowed,
    requireOfficeIp: ATTENDANCE_REQUIRE_OFFICE_IP,
    eligible,
    alreadyMarked,
    reason,
    points: ATTENDANCE_POINTS,
    office: officeLocation(),
    nama: agent.nama || agent.kode
  };
}

async function submit(agentCode, remoteIp, payload) {
  payload = payload || {};
  return writeMutex.run(async () => {
    const agent = await agents.requireAgent(agentCode);
    const meeting = meetingTime(new Date());
    if (!meeting.allowed) {
      throw httpError("Absensi hanya tersedia hari Rabu pukul 18.00–22.30 WIB.", 403);
    }
    if (!officeWifiAllowed(remoteIp)) {
      throw httpError("Hubungkan perangkat ke Wi-Fi kantor untuk melakukan absensi.", 403);
    }

    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    const accuracy = Number(payload.accuracy);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
      || !Number.isFinite(accuracy) || accuracy < 0) {
      throw httpError("Lokasi perangkat belum terbaca. Izinkan akses lokasi lalu coba lagi.", 400);
    }

    const distance = distanceMeters(latitude, longitude, ATTENDANCE_OFFICE_LAT, ATTENDANCE_OFFICE_LON);
    if (distance > ATTENDANCE_RADIUS_METERS) {
      throw httpError("Lokasi perangkat berada di luar radius kantor " + ATTENDANCE_RADIUS_METERS + " meter.", 403);
    }

    const values = await getAllRecords();
    const kode = String(agent.kode || agentCode).toUpperCase().trim();
    if (hasAttendance(values, meeting.date, kode)) {
      throw httpError("Absensi meeting hari ini sudah tercatat. Poin tidak ditambahkan lagi.", 409);
    }

    const timestamp = new Date().toISOString();
    const row = [
      meeting.date,
      kode,
      agent.nama || kode,
      timestamp,
      ATTENDANCE_POINTS,
      normalizeIp(remoteIp),
      Math.round(distance),
      accuracy
    ];
    await sheets.appendValues(SHEET_NAMES.MEETING_ATTENDANCE, [row]);
    return {
      ok: true,
      date: meeting.date,
      timestamp,
      points: ATTENDANCE_POINTS,
      distanceMeters: Math.round(distance)
    };
  });
}

module.exports = {
  getAllRecords,
  getStatus,
  submit,
  distanceMeters,
  meetingTime
};

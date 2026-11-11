"use strict";

const mysql = require("mysql2/promise");
const { ACTIVITY_HEADERS, MEETING_ATTENDANCE_HEADERS } = require("./config");

const ACTIVITY_TABLE = "hepi_daily_activity";
const ATTENDANCE_TABLE = "hepi_meeting_attendance";
let pool = null;

function enabled() {
  return String(process.env.ACTIVITY_STORAGE || "sheets").trim().toLowerCase() === "mysql";
}

function mysqlConfig() {
  const required = ["MYSQL_HOST", "MYSQL_USER", "MYSQL_DATABASE"];
  const missing = required.filter((name) => !String(process.env[name] || "").trim());
  if (missing.length) throw new Error("MySQL configuration is missing: " + missing.join(", "));
  if (!process.env.MYSQL_PASSWORD) throw new Error("MYSQL_PASSWORD is not set.");
  const port = Number(process.env.MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("MYSQL_PORT is invalid.");
  const connectionLimit = Math.max(1, Math.min(10, Number(process.env.MYSQL_CONNECTION_LIMIT) || 5));
  const config = {
    host: String(process.env.MYSQL_HOST).trim(),
    port,
    user: String(process.env.MYSQL_USER).trim(),
    password: process.env.MYSQL_PASSWORD,
    database: String(process.env.MYSQL_DATABASE).trim(),
    charset: "utf8mb4",
    waitForConnections: true,
    connectionLimit,
    queueLimit: 20,
    connectTimeout: 5000,
    enableKeepAlive: true,
    multipleStatements: false,
    dateStrings: true
  };
  if (String(process.env.MYSQL_SSL || "").toLowerCase() === "true") {
    config.ssl = { rejectUnauthorized: true };
  }
  return config;
}

function getPool() {
  if (!enabled()) throw new Error("ACTIVITY_STORAGE is not set to mysql.");
  if (!pool) pool = mysql.createPool(mysqlConfig());
  return pool;
}

function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function asNullableNumber(value) {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function activityRow(row) {
  return [
    row.submitted_at || "",
    row.activity_date || "",
    row.agent_code || "",
    row.agent_name || "",
    row.listing_count,
    row.content_count,
    row.posting_count,
    row.survey_count,
    row.closing_count,
    row.listing_score == null ? "" : Number(row.listing_score),
    row.content_score == null ? "" : Number(row.content_score),
    row.posting_score == null ? "" : Number(row.posting_score),
    row.survey_score == null ? "" : Number(row.survey_score),
    row.closing_score == null ? "" : Number(row.closing_score),
    row.total_score == null ? "" : Number(row.total_score)
  ];
}

function attendanceRow(row) {
  return [
    row.attendance_date || "",
    row.agent_code || "",
    row.agent_name || "",
    row.submitted_at || "",
    row.points,
    row.ip_address || "",
    row.distance_meters,
    row.accuracy_meters == null ? "" : Number(row.accuracy_meters)
  ];
}

async function getActivityRows(range) {
  const params = [];
  const conditions = [];
  if (range && range.fromDate) {
    conditions.push("activity_date >= ?");
    params.push(range.fromDate);
  }
  if (range && range.date) {
    conditions.push("activity_date = ?");
    params.push(range.date);
  }
  if (range && range.toDateExclusive) {
    conditions.push("activity_date < ?");
    params.push(range.toDateExclusive);
  }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const [rows] = await getPool().execute(
    "SELECT submitted_at, DATE_FORMAT(activity_date, '%Y-%m-%d') AS activity_date, agent_code, agent_name, "
      + "listing_count, content_count, posting_count, survey_count, closing_count, listing_score, content_score, "
      + "posting_score, survey_score, closing_score, total_score FROM " + ACTIVITY_TABLE
      + where + " ORDER BY activity_date, agent_code, id",
    params
  );
  return [ACTIVITY_HEADERS].concat(rows.map(activityRow));
}

async function getAttendanceRows(range) {
  const params = [];
  const conditions = [];
  if (range && range.fromDate) {
    conditions.push("attendance_date >= ?");
    params.push(range.fromDate);
  }
  if (range && range.toDateExclusive) {
    conditions.push("attendance_date < ?");
    params.push(range.toDateExclusive);
  }
  const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "";
  const [rows] = await getPool().execute(
    "SELECT DATE_FORMAT(attendance_date, '%Y-%m-%d') AS attendance_date, agent_code, agent_name, submitted_at, "
      + "points, ip_address, distance_meters, accuracy_meters FROM " + ATTENDANCE_TABLE
      + where + " ORDER BY attendance_date, agent_code, id",
    params
  );
  return [MEETING_ATTENDANCE_HEADERS].concat(rows.map(attendanceRow));
}

async function checkSchema() {
  const db = getPool();
  await db.execute("SELECT id FROM " + ACTIVITY_TABLE + " LIMIT 0");
  await db.execute("SELECT id FROM " + ATTENDANCE_TABLE + " LIMIT 0");
}

async function getActivityRow(date, agentCode) {
  const [rows] = await getPool().execute(
    "SELECT submitted_at, DATE_FORMAT(activity_date, '%Y-%m-%d') AS activity_date, agent_code, agent_name, "
      + "listing_count, content_count, posting_count, survey_count, closing_count, listing_score, content_score, "
      + "posting_score, survey_score, closing_score, total_score FROM " + ACTIVITY_TABLE
      + " WHERE activity_date = ? AND agent_code = ? LIMIT 1",
    [date, agentCode]
  );
  return rows.length ? activityRow(rows[0]) : null;
}

async function addClosings(items, timestamp) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    for (const item of items) {
      await connection.execute(
        "INSERT INTO " + ACTIVITY_TABLE
          + " (submitted_at, activity_date, agent_code, agent_name, closing_count) VALUES (?, ?, ?, ?, ?) "
          + "ON DUPLICATE KEY UPDATE submitted_at = VALUES(submitted_at), agent_name = VALUES(agent_name), "
          + "closing_count = closing_count + VALUES(closing_count), total_score = NULL",
        [timestamp, item.dateKey, item.kode, item.nama, asCount(item.jumlah)]
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function submitDailyActivity(record) {
  const pool = getPool();
  const update = await pool.execute(
    "UPDATE " + ACTIVITY_TABLE + " SET submitted_at = ?, listing_count = ?, content_count = ?, "
      + "posting_count = ?, survey_count = ?, agent_name = ?, total_score = NULL WHERE activity_date = ? AND agent_code = ? "
      + "AND listing_count = 0 AND content_count = 0 AND posting_count = 0 AND survey_count = 0",
    [record.timestamp, record.listing, record.konten, record.posting, record.survey, record.nama, record.date, record.kode]
  );
  if (update[0].affectedRows > 0) return { ok: true, updated: true, tanggal: record.date };

  const [insert] = await pool.execute(
    "INSERT INTO " + ACTIVITY_TABLE
      + " (submitted_at, activity_date, agent_code, agent_name, listing_count, content_count, posting_count, survey_count) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
    [record.timestamp, record.date, record.kode, record.nama, record.listing, record.konten, record.posting, record.survey]
  );
  if (insert.affectedRows === 1) return { ok: true, updated: false, tanggal: record.date };
  return { ok: false, alreadyFilled: true, tanggal: record.date };
}

async function hasAttendance(date, agentCode) {
  const [rows] = await getPool().execute(
    "SELECT 1 FROM " + ATTENDANCE_TABLE + " WHERE attendance_date = ? AND agent_code = ? LIMIT 1",
    [date, agentCode]
  );
  return rows.length > 0;
}

async function addAttendance(record) {
  await getPool().execute(
    "INSERT INTO " + ATTENDANCE_TABLE
      + " (attendance_date, agent_code, agent_name, submitted_at, points, ip_address, distance_meters, accuracy_meters) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [record.date, record.kode, record.nama, record.timestamp, record.points, record.ip, record.distance, record.accuracy]
  );
}

function normalizedActivityRow(row) {
  return [
    String(row[0] || ""), String(row[1] || ""), String(row[2] || "").toUpperCase().trim(), String(row[3] || ""),
    asCount(row[4]), asCount(row[5]), asCount(row[6]), asCount(row[7]), asCount(row[8]),
    asNullableNumber(row[9]), asNullableNumber(row[10]), asNullableNumber(row[11]),
    asNullableNumber(row[12]), asNullableNumber(row[13]), asNullableNumber(row[14])
  ];
}

function normalizedAttendanceRow(row) {
  const ip = String(row[5] || "");
  if (Buffer.byteLength(ip, "utf8") > 45) throw new Error("Attendance IP exceeds 45 characters.");
  return [
    String(row[0] || ""), String(row[1] || "").toUpperCase().trim(), String(row[2] || ""), String(row[3] || ""),
    row[4] === "" || row[4] == null ? 100 : asCount(row[4]),
    ip, asCount(row[6]), asNullableNumber(row[7])
  ];
}

function makeInsertSql(table, columns, count) {
  const rowMarks = "(" + columns.map(() => "?").join(", ") + ")";
  return "INSERT INTO " + table + " (" + columns.join(", ") + ") VALUES "
    + Array.from({ length: count }, () => rowMarks).join(", ");
}

async function tableCount(connection, table) {
  const [rows] = await connection.execute("SELECT COUNT(*) AS row_count FROM " + table);
  return Number(rows[0].row_count || 0);
}

async function importRows(activityRows, attendanceRows) {
  const connection = await getPool().getConnection();
  const activityColumns = [
    "submitted_at", "activity_date", "agent_code", "agent_name", "listing_count", "content_count",
    "posting_count", "survey_count", "closing_count", "listing_score", "content_score", "posting_score",
    "survey_score", "closing_score", "total_score"
  ];
  const attendanceColumns = [
    "attendance_date", "agent_code", "agent_name", "submitted_at", "points", "ip_address", "distance_meters", "accuracy_meters"
  ];
  try {
    await connection.beginTransaction();
    const activityCount = await tableCount(connection, ACTIVITY_TABLE);
    const attendanceCount = await tableCount(connection, ATTENDANCE_TABLE);
    if (activityCount || attendanceCount) {
      throw new Error("Import stopped: destination tables are not empty. Existing data was left unchanged.");
    }
    const chunkSize = 250;
    for (let offset = 0; offset < activityRows.length; offset += chunkSize) {
      const chunk = activityRows.slice(offset, offset + chunkSize).map(normalizedActivityRow);
      const values = chunk.reduce((all, row) => all.concat(row), []);
      await connection.execute(makeInsertSql(ACTIVITY_TABLE, activityColumns, chunk.length), values);
    }
    for (let offset = 0; offset < attendanceRows.length; offset += chunkSize) {
      const chunk = attendanceRows.slice(offset, offset + chunkSize).map(normalizedAttendanceRow);
      const values = chunk.reduce((all, row) => all.concat(row), []);
      await connection.execute(makeInsertSql(ATTENDANCE_TABLE, attendanceColumns, chunk.length), values);
    }
    const importedActivity = await tableCount(connection, ACTIVITY_TABLE);
    const importedAttendance = await tableCount(connection, ATTENDANCE_TABLE);
    if (importedActivity !== activityRows.length || importedAttendance !== attendanceRows.length) {
      throw new Error("Import row counts do not match the source counts.");
    }
    await connection.commit();
    return { activity: importedActivity, attendance: importedAttendance };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function exportRows() {
  const [activity, attendance] = await Promise.all([getActivityRows(), getAttendanceRows()]);
  return {
    format: "hepi-activity-backup-v1",
    createdAt: new Date().toISOString(),
    activity: activity.slice(1),
    attendance: attendance.slice(1)
  };
}

async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}

module.exports = {
  enabled,
  checkSchema,
  getActivityRows,
  getAttendanceRows,
  getActivityRow,
  addClosings,
  submitDailyActivity,
  hasAttendance,
  addAttendance,
  importRows,
  exportRows,
  closePool
};

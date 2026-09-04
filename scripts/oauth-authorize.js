"use strict";
// One-time setup — run on any machine with Node + a browser (does NOT
// have to be the production server): node scripts/oauth-authorize.js
//
// Requires GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET to already
// be set in .env (from a "Desktop app" OAuth client you create in Google
// Cloud Console — same project the service account lives in).
//
// Opens a consent URL; once you approve it in the browser, this catches
// the redirect on localhost, exchanges the code for a refresh token, and
// prints the three env vars to add to .env (both local and production).

try {
  require("dotenv").config();
} catch (e) {}

const http = require("http");
const { google } = require("googleapis");

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive"
];
const PORT = 53682;
const REDIRECT_URI = "http://localhost:" + PORT;

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env first.");
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const url = oauth2.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES });

  console.log("\nBuka URL ini di browser, login pakai akun Google yang dipakai HEPI Property:\n");
  console.log(url);
  console.log("\nMenunggu Anda menyetujui akses...\n");

  const server = http.createServer(async (req, res) => {
    if (!req.url || req.url === "/favicon.ico") { res.end(); return; }
    let code;
    try {
      code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
    } catch (e) {
      res.end("Bad request");
      return;
    }
    if (!code) { res.end("Menunggu kode..."); return; }

    res.end("Berhasil! Anda bisa tutup tab ini dan kembali ke terminal.");
    server.close();

    try {
      const { tokens } = await oauth2.getToken(code);
      if (!tokens.refresh_token) {
        console.log("PERINGATAN: tidak ada refresh_token di respons.");
        console.log("Biasanya karena akun ini sudah pernah authorize app ini sebelumnya.");
        console.log("Buka https://myaccount.google.com/permissions, cabut akses untuk app ini,");
        console.log("lalu jalankan script ini lagi.");
        process.exit(1);
      }
      console.log("Sukses! Tambahkan 3 baris ini ke .env (lokal dan produksi):\n");
      console.log("GOOGLE_OAUTH_CLIENT_ID=" + clientId);
      console.log("GOOGLE_OAUTH_CLIENT_SECRET=" + clientSecret);
      console.log("GOOGLE_OAUTH_REFRESH_TOKEN=" + tokens.refresh_token);
      process.exit(0);
    } catch (err) {
      console.error("Gagal tukar code jadi token:", err.message);
      process.exit(1);
    }
  });

  server.listen(PORT);
}

main();

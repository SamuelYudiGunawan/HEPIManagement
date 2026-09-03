# HEPI Property Listings (website)

**This folder is the whole Node website.** Zip it (or push only `website/`) to cPanel. Leave the Apps Script files (`code.gs`, HTML at the repo root) on Google — do not upload those.

Node.js + Fastify, same **Google Sheet** and **Google Drive** as the Apps Script app. Search, Input Listing, Daily Activity, scores, history, and closing work on your own domain. The site is a PWA so you can wrap it as an Android `.apk` later.

Keep the GAS web app running until this site is verified, then point agents to the new URL.

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `GOOGLE_SHEETS_ID` — from the spreadsheet URL (`/d/THIS_ID/edit`)
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` — already set to the current HEPI root folder
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — paste the full JSON key, or set `GOOGLE_APPLICATION_CREDENTIALS` to a file path
   - `CRON_SECRET` — random string for the import cron URL
2. In [Google Cloud Console](https://console.cloud.google.com/) create a project, enable **Google Sheets API** and **Google Drive API**, create a **service account**, download the JSON key.
3. Share the spreadsheet and the Drive root folder with the service account email (Editor).
4. Install and run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## What to upload (cPanel / git)

Include:

- `server.js`, `package.json`, `.env.example`, `.gitignore`, `README.md`
- `lib/`, `html/` (new pages), `static/` (css/js/icons), `data/`

Do **not** upload: `.env`, `node_modules/`, `service-account.json`, or the GAS files outside this folder.

Zip from this folder (so `server.js` is at the zip root):

```bash
cd website
zip -r ../hepi-website.zip . -x "*.DS_Store" -x ".env" -x "node_modules/*"
```

On the host run `npm install` after upload. Put secrets in hPanel env vars, not in the zip.

## Deploy on Niagahoster Bisnis

1. hPanel → **Setup Node.js App** (Node 18 or 20).
2. Upload `hepi-website.zip` or set application root to this `website` folder. Start command: `npm start` or `node server.js`.
3. Set env vars in the Node app dashboard. **Do not paste the service-account JSON there** — CloudLinux writes `export ...` into a bash wrapper and the private key newlines make Node fail to start (503). Upload `service-account.json` next to `server.js` (File Manager, permissions `600`) and only set:

   - `GOOGLE_SHEETS_ID`
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID`
   - `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json`
   - `CRON_SECRET`
   - `TZ=Asia/Jakarta`

   Values must be one line, no spaces around `=`, no JSON.
4. Point the domain at the Node app. Enable HTTPS. Save env vars, then **NPM Install** and **Restart**.

CloudLinux Node.js Selector creates its own `public/` folder. Our assets are in `static/` so they do not clash. If the site shows **It works!**, delete `public/index.html` that the selector added, then restart the app.

Application root for subdomain `management.hepiproperty.com` is OK as:

`/home/u7047694/public_html/management.hepiproperty.com`

as long as that folder contains `server.js` (not a nested extra `website/` folder).
5. cPanel **Cron Jobs**, every 10 minutes:

```
curl -fsS "https://YOUR-DOMAIN/api/cron/import?token=CRON_SECRET"
```

The handler:

- 09:00–18:00 (Asia/Jakarta): looks for new/changed `.txt` files, waits 5 minutes, then imports
- 18:00: full Drive scan
- If a batch hits the time limit, the next cron continues the queue

Until this cron is stable, you can leave GAS import on.

## Pages

| URL | Page |
|---|---|
| `/` | Cari listing |
| `/activity` | Daily activity |
| `/scores` | Skor agen |
| `/history` | History |
| `/closing` | Closing (admin) |
| `/inputlisting` | Input listing (admin / adminkantor) |

## Android APK later

This site already has `manifest.webmanifest`, icons, and a service worker (static files only; listing data stays network-first).

After HTTPS is live:

1. Open [PWABuilder](https://www.pwabuilder.com/) and enter your domain, **or**
2. Use Capacitor / Trusted Web Activity against the same URL

Then sideload the `.apk` or use Play internal testing. No iOS / App Store in this project.

## Local files

- `html/` — **new** website pages (`hepiApi` / fetch). Served by Node.
- `static/` — css, js, icons, PWA (not `public/` — CloudLinux uses `public/` itself)
- `lib/` — Sheets, Drive, parser, import
- `data/import-state.json` — created at runtime
- Repo root still has **GAS** HTML + `code.gs` (`google.script.run`). Do not overwrite those.

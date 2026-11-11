# HEPI Property Listings (website)

**This folder is the whole Node website.** Zip it (or push only `website/`) to cPanel. Leave the Apps Script files (`code.gs`, HTML at the repo root) on Google — do not upload those.

Node.js + Fastify. Listing metadata and listing files continue to use **Google Sheets** and **Google Drive**. Daily Activity and Meeting Attendance can use MySQL after the full history is imported. Search, Input Listing, scores, history, and closing work on your own domain. The site is a PWA so you can wrap it as an Android `.apk` later.

Keep the GAS web app running until this site is verified, then point agents to the new URL.

## Setup

1. Copy `.env.example` to `.env` and fill in:
   - `GOOGLE_SHEETS_ID` — from the spreadsheet URL (`/d/THIS_ID/edit`)
   - `GOOGLE_DRIVE_ROOT_FOLDER_ID` — already set to the current HEPI root folder
   - `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json` — path to the local service-account key file; keep that file out of git and deployment zips
   - `CRON_SECRET` — random secret for cron endpoints
   - `PUBLIC_ORIGIN` and `PUBLIC_HTTPS` — the public site origin and HTTPS state
   - `TRUST_PROXY_CIDRS` — leave empty for the current direct-origin setup; do not set this to `true` or trust arbitrary forwarded headers
   - Meeting attendance defaults to Wednesday 18:00–22:30 WIB, within 50 m of the office pin, and the office public IP `182.253.58.67`. Set `ATTENDANCE_OFFICE_IPS` when the ISP assigns a different public IP. Set `ATTENDANCE_REQUIRE_OFFICE_IP=false` only if you need to disable the Wi-Fi IP check; the meeting time and location checks remain active.
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
- `lib/`, `html/` (new pages), `static/` (css/js/icons), `scripts/`, `database/`, `data/`

Do **not** upload: `.env`, `node_modules/`, `service-account.json`, or the GAS files outside this folder.

Zip from this folder (so `server.js` is at the zip root):

```bash
cd website
zip -r ../hepi-website.zip . \
  -x "*.DS_Store" ".env" "*/.env" \
  "service-account.json" "*/service-account.json" \
  "activity-backup-private.pem" "*/activity-backup-private.pem" \
  "*.enc.json" "decrypted-backup.json" \
  "node_modules/*" "*/node_modules/*" "data/*.json" "data/*.lock"
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
   - `SSO_GOOGLE_CLIENT_ID`
   - `SSO_GOOGLE_CLIENT_SECRET`
   - `SSO_GOOGLE_REDIRECT_URI=https://management.hepiproperty.com/auth/google/callback`
   - `SESSION_SECRET` (generate a random 32+ byte value)
   - `PUBLIC_ORIGIN=https://management.hepiproperty.com`
   - `PUBLIC_HTTPS=true`
   - Leave `TRUST_PROXY_CIDRS` empty for now. `management.hepiproperty.com` currently points directly to the origin and does not use Hostinger CDN.
   - `TZ=Asia/Jakarta`

   Values must be one line, no spaces around `=`, no JSON. Keep `TRUST_PROXY_CIDRS` empty; do not set it to `true` or trust forwarded headers based on guessed IPs. Revisit this only if the subdomain is later put behind a confirmed proxy/CDN and direct access to the origin is restricted.
4. Point the domain at the Node app. Enable HTTPS. Save env vars, then **NPM Install** and **Restart**.

CloudLinux Node.js Selector creates its own `public/` folder. Our assets are in `static/` so they do not clash. If the site shows **It works!**, delete `public/index.html` that the selector added, then restart the app.

Application root for subdomain `management.hepiproperty.com` is OK as:

`/home/u7047694/public_html/management.hepiproperty.com`

as long as that folder contains `server.js` (not a nested extra `website/` folder).
5. cPanel **Cron Jobs**, every 10 minutes:

```
curl -fsS -H "X-Cron-Token: CRON_SECRET" "https://YOUR-DOMAIN/api/cron/import"
```

The handler:

- Sunday at 02:00 (Asia/Jakarta): starts the weekly full Drive scan
- At 22:00 (Asia/Jakarta): sends an activity reminder to each active agent/admin account, including adminkantor, that has not entered activity for that day. The same cron call checks this and only sends once per person per day.
- The cron does not scan automatically when a `.txt` file changes; listing and revision submissions update their own data directly
- If the weekly batch hits the time limit, the next cron continues that weekly queue

Until this cron is stable, you can leave GAS import on.

## Move Activity and Attendance to MySQL

The app defaults to Google Sheets until `ACTIVITY_STORAGE=mysql` is set. Listing metadata, photos, and documents stay in Google Sheets/Drive.

1. In hPanel, create a MySQL database and user. Import [`database/activity-schema.sql`](database/activity-schema.sql) through phpMyAdmin. The runtime app only needs `SELECT`, `INSERT`, and `UPDATE` on these two tables; schema setup is done separately.
2. Set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_CONNECTION_LIMIT=5`, and `MYSQL_SSL` in the Node app environment. Keep the database limited to local hosting access unless remote access is required for a controlled recovery.
3. Keep the current Google Sheets tabs unchanged. Run the migration script first without flags to validate dates, field lengths, and duplicate date/agent pairs. Fix any reported source rows before importing:

   ```bash
   node scripts/migrate-activity-to-mysql.js
   node scripts/migrate-activity-to-mysql.js --import
   ```

   The import only writes to empty MySQL tables and checks the final row counts. It aborts on duplicates or invalid source data. Run it during a quiet maintenance window so no new activity or attendance is submitted between the final Sheets read and cutover. The script reads Google Sheets credentials from the Node environment or a protected local `.env`; never put secrets in shell history or send them in chat.
4. Compare the imported counts with the two Sheets tabs, then set `ACTIVITY_STORAGE=mysql` and restart the app. If the new database is unavailable or the tables are missing, the app fails closed instead of silently writing to the old Sheets.
5. Keep the original Sheets tabs read-only as the rollback archive until the database has been used successfully for a while.

For a quiet cutover, set `MAINTENANCE_MODE=true` in the Node.js app environment. Only an account whose current agent-sheet status is exactly `admin` can access the app; other visitors receive a maintenance page. Google sign-in remains available so the admin can log in. Set `MAINTENANCE_MODE=false` after the migration and checks are complete. Confirm your own agent account has status `admin` before enabling this switch.

## Encrypted Drive Backups

Backups contain only Activity and Attendance records. They are compressed and encrypted before upload. The website uses an RSA public key; keep the matching private key only on a trusted computer.

1. Create a private Drive folder that is not shared with agents. Set its ID as `ACTIVITY_BACKUP_FOLDER_ID`.
2. Generate a key pair on a trusted computer, storing the private key outside the website project:

   ```bash
   node scripts/generate-activity-backup-key.js ~/activity-backup-private.pem
   ```

   Add the printed one-line public key value to the hosting environment as `ACTIVITY_BACKUP_PUBLIC_KEY_B64`. Keep the private key offline and make a second secure copy; the hosting app cannot decrypt the backup without it.
3. After switching to MySQL, add a weekly cPanel cron job (choose a quiet time, for example Sunday at 03:00 WIB):

   ```bash
   curl -fsS -X POST -H "X-Cron-Token: CRON_SECRET" "https://YOUR-DOMAIN/api/cron/activity-backup"
   ```

   The endpoint requires the cron token in a header, the database mode to be MySQL, Google Drive credentials, the private folder ID, and the public key. It does not delete older backups automatically.
4. To recover a backup, download the encrypted file from Drive and decrypt it on the trusted computer:

   ```bash
   node scripts/decrypt-activity-backup.js backup.enc.json ~/activity-backup-private.pem decrypted-backup.json
   node scripts/restore-activity-backup.js decrypted-backup.json
   node scripts/restore-activity-backup.js decrypted-backup.json --restore
   ```

   Restore only writes into empty tables and requires database access from the computer running the command. If Hostinger blocks remote database access, use a controlled recovery session and keep the temporary decrypted file outside the public web root, then securely remove it.

## Security Notes

- SQL values use prepared statements; user data is never concatenated into SQL. Database table names are fixed in code.
- Rate limits are applied per signed-in agent where possible and per normalized IP otherwise. They reduce abusive application traffic; network-level DDoS protection must come from Hostinger or a CDN/WAF in front of the origin.
- `management.hepiproperty.com` currently resolves directly to the origin, with no Hostinger CDN in front. Keep `TRUST_PROXY_CIDRS` empty so Fastify does not trust public `X-Forwarded-*` headers. Set `PUBLIC_HTTPS=true` and the exact `PUBLIC_ORIGIN` on production so secure cookies and same-origin checks use the public HTTPS site. If Hostinger's internal Node.js routing makes all requests appear to come from one IP, confirm its proxy behavior with Hostinger before changing proxy trust; do not guess an allowlist.
- Check [Hostinger CDN status](https://www.hostinger.com/support/hostinger-cdn-how-to-confirm-its-active-and-what-it-speeds-up/) at **Websites → Manage site → Performance → CDN**. A response with `x-hcdn-request-id` confirms that the request passed through its CDN. Hostinger documents [network-level DDoS protections](https://www.hostinger.com/support/5634639-what-is-a-ddos-attack-and-how-to-prevent-it-at-hostinger/) for its web hosting; the CDN helps absorb/filter traffic but does not make dynamic app/database work faster. Use only one CDN/proxy layer at a time.
- Hostinger documents that [Node apps receive visitor IP/protocol through forwarded headers](https://www.hostinger.com/support/hostinger-cdn-visitor-ip-addresses-in-logs-and-analytics/) when its CDN is active. Keep proxy trust restricted to Hostinger's confirmed proxy addresses; direct requests to the origin must not be allowed to spoof those headers.
- State-changing API requests require the configured same-origin `Origin` header. Dynamic responses include basic security headers, and unexpected server errors do not expose internal messages.
- Signed login sessions expire after 30 days, so agents will need to sign in again after this change.
- If the older compromised site shared this hosting account, secure the hosting/domain accounts and rotate passwords, deployment keys, OAuth secrets, and any Google credentials that may have been stored there before deploying this project.
- Security controls reduce exposure but cannot guarantee that a website will never be attacked. Confirm Hostinger's active CDN/WAF and incident cleanup with the provider.

## Pages

| URL | Page |
|---|---|
| `/` | Cari listing |
| `/activity` | Daily activity |
| `/scores` | Skor agen |
| `/absen` | Absensi meeting (Rabu, 18.00–22.30 WIB) |
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

# School Management System (SMS) — Ghanaian Private Basic School

A mobile-first, low-bandwidth School Management System sold and installed **per school**
(one database per school), built so the future SaaS/subscriber and offline (PWA) phases can
be added without a rewrite. Ships with **Ghana defaults** (GES/NaCCA structure, SBA scoring,
GHS, MoMo/SMS) that are all editable in **Settings** — nothing school-specific is hard-coded.

The entire build (Phases 1–11 of the brief) is implemented.

---

## 1. What was built

**App shell** — left sidebar (slide-in on mobile): Dashboard, Students, Assessment, Finance,
Attendance, Communication, Administration, Inventory, Settings. Top bar shows the school name +
current term and a role switcher. UI is role-gated by an Admin-editable permission matrix.
Theme: deep teal primary, warm gold accent, off-white background, system fonts.

| Module | Highlights |
|---|---|
| **Settings & Customization** | School profile · academic year/terms (vacation+reopening, current & promotional term) · categories & classes · per-class subjects · grade bands · score weighting (50/50 default) · fee types · inventory categories · **report templates A & B** with toggle/rename of every block & field · ID rules · roles & permission matrix · message templates & report labels · data export/import/reset |
| **Students & Academic** | Admissions, records, search/filter, parents (multi-child), auto ID `ST0001`, promotion screen (promote/retain/complete; Basic 9 → Alumni), bulk admissions upload |
| **Assessment** | Score entry per class/subject (auto total, grade, remark, positions), Creche competency checklist entry, **Template A (Creche)** & **Template B (Standard)** report cards, print/Save-PDF, bulk score upload |
| **Finance & Fees** | Term billing from fee types, fee positions (billed/paid/arrears), payments via **test-mode** MoMo/Paystack stub, printable receipts, Bills/Fees report + CSV |
| **Attendance & Discipline** | Fast daily marking (P/A/L), all-present/absent, conduct notes, bulk upload; totals feed the report card |
| **Communication** | SMS via **mock sender**, announcements, editable templates with placeholders, multi-child parents |
| **Administration & Reporting** | Role-aware dashboard, staff records (`SF0001`), exam/finance/attendance reports with day/week/month/term/year filters + CSV export |
| **Inventory / Stock** | Items, stock in/out, low-stock view, stock report with time filters + CSV |
| **Bulk file entry** | Download template / Upload filled (CSV) on score entry, attendance, admissions, fee billing — every row validated, bad rows rejected with reasons, **no silent overwrites** |
| **Accounting** | Income (auto from Finance + manual other-income) vs. expenses (manual + auto-posted payroll), time-filtered overview, editable expense/income categories, CSV export |
| **Payroll** | Per-staff pay setup (basic/allowances/bonus/other/deductions), configurable pay structure (SSNIT/PAYE bands, employer contributions, custom fields), run & finalise monthly payroll (posts to Accounting), payslips, history, reports |
| **Access Control** (Settings, Admin-only) | Per-parent login enable/disable, parent report-download control (school-wide/by-class/per-parent), and **Login accounts**: reset any user's password or add a new login for a staff member/parent |
| **Subscription / Licensing** | 30-day free trial, offline plan activation via signed licence key (ECDSA/WebCrypto), read-only lock on expiry |

**Architecture** — a single **swappable data-access layer** (`app/js/store.js`) with two adapters:
- `LocalAdapter` (default): browser `localStorage`. The app runs by just opening `index.html`.
- `ApiAdapter`: the included **PHP + PDO REST API** (`app/api/`), SQLite in dev / MySQL on cPanel.

Screens never change between the two — flip one flag (`useApi`). Every record is tenant-aware
(belongs to one top-level `School`).

---

## 2. How to run it

### A) Instant local preview (no server) — Local mode
1. Open `app/index.html` in a modern browser (Chrome/Edge/Firefox/Safari).
2. Sign in — school name is pre-filled, pick a user type (Admin sees everything), and the
   demo password fills in automatically (see §5 for the values; auto-fill stops once a
   password is changed). Ghana defaults are pre-seeded.
3. Settings → Data → "Reset to Ghana defaults" restores seed data (incl. demo login accounts)
   at any time.

> Local mode stores data in your browser only. Use it for demos/training.

### B) Run against the PHP API locally — API mode
1. Install PHP 7.4+ with PDO SQLite (most installs have it).
2. From `app/`, start a server: `php -S 127.0.0.1:8000`
3. Edit `app/index.html` → set `window.DB_CONFIG = { useApi: true, apiBase: 'api/index.php' }`.
4. Visit `http://127.0.0.1:8000/index.html`. The API auto-creates `app/api/data/sms.sqlite`
   and seeds Ghana defaults from `app/api/seed.json` on first request.

---

## 3. Deploy to cPanel (PHP + MySQL via PDO)

1. **Upload**: copy the contents of `app/` into `public_html/` (so `index.html` is at the web
   root and the API is at `public_html/api/`).
2. **Create the database** in cPanel → *MySQL Databases*: a database, a user, and grant the user
   all privileges on it.
3. **Import schema + seed** in cPanel → *phpMyAdmin*:
   - run `api/schema.mysql.sql` (creates the operational store + a normalised reference schema),
   - then `api/seed.mysql.sql` (Ghana defaults for the reference tables).
   > Note: the live app also auto-seeds its operational store from `seed.json` on first request,
   > so seeding works even if you skip `seed.mysql.sql`.
4. **Configure** `api/config.php`:
   - set `'DB_DRIVER' => 'mysql'`,
   - fill `MYSQL_NAME`, `MYSQL_USER`, `MYSQL_PASS` (and host if not `localhost`).
5. **Switch the front end to API mode**: in `index.html` set `useApi: true`.
6. **Secure**: `api/data/` ships with an `.htaccess` denying web access (used only by SQLite dev);
   on MySQL it is unused. Keep `config.php` out of any public listing (it is plain PHP, not served).
7. **Before going live, protect the API itself**: `api/index.php` has no authentication of its
   own — any request to it (including `import`/`reset`, which overwrite/wipe the whole dataset)
   is currently accepted from anyone who can reach the URL. At minimum, restrict `public_html/api/`
   with HTTP Basic Auth (cPanel → Directory Privacy) or an IP allowlist before enabling API mode
   on a public domain. (This is why `useApi` defaults to `false` / Local mode.)
8. Visit your domain. Done.

**Go-live (real providers):** replace the placeholder keys in `api/config.php` (and
`app/js/services.js` for the front-end fallback) and implement the two functions in
`api/services-stub.php` (`svc_payment_charge`, `svc_sms_send`) with your Paystack/MoMo and
SMS gateway calls. The front-end and API contracts do not change.

---

## 4. Review checklist (what to verify)

- **Creche Template A vs Standard Template B**
  - Assessment → Report Cards → class **Creche**: competency checklist (3 domains, YES/PAR/NES) +
    light scores table (Class/Exam/Total/Remarks), **no Grade, no Position**.
  - Settings → Report Templates → Template A: toggle checklist and scores **independently**
    (checklist-only, scores-only, or both).
  - Any other class (e.g. **Basic 1**): subjects table with Grade, Position-in-subject, overall
    Position, Remarks; conduct lines; promotion line on the promotional term.
  - Settings → Report Templates → Template B: hide/rename Grade, Position-in-subject, Position,
    Remarks and re-preview.
- **Settings customization** — change school name, add/edit/remove a class, subject, grade band,
  fee type, inventory category; change weighting to 60/40 and confirm totals update; rename a
  fees label and see it on the report.
- **Bulk upload/validation** — Students → Template → add a bad row (blank name / unknown class) →
  Upload → confirm the summary rejects bad rows and imports only valid ones.
- **Identity** — admit a student and confirm `ST####`; Settings → Identity → enable manual entry.
- **Roles** — switch to Teacher (own class only), Parent (read-only own child), and confirm the
  sidebar/permissions adjust. Admin is always full.
- **Finance** — generate term bills, take a test-mode payment, print a receipt, view Bills report.
- **Reports** — Administration → Reports → change the day/week/month/term/year filter; export CSV.

---

## 5. Placeholders & assumptions (where to change them)

| Item | Placeholder used | Where to change |
|---|---|---|
| School identity | "Demo Basic School", `P.O. Box [PLACEHOLDER]`, sample phones/email | Settings → Profile (or `app/js/seed.js`) |
| School logo | none (initials badge shown) | Settings → Profile → Logo URL |
| Term dates | sample 2025/2026 dates | Settings → Academic |
| Payment provider | `mock` test mode, `sk_test_PLACEHOLDER` | `api/config.php` + `api/services-stub.php`; `app/js/services.js` |
| SMS gateway | `mock` test mode, `sms_test_PLACEHOLDER` | same as above |
| MySQL credentials | `cpaneluser_*`, `CHANGE_ME_PLACEHOLDER` | `api/config.php` |
| Demo login passwords | `admin/admin123`, `director/director123`, `teacher/teacher123`, `staff/staff123`, `parent/parent123` (school name = the seeded school name). The login screen pre-fills the school name and auto-fills the password once you pick a user type — only while that account is still on its original seeded password; it stops the instant it's changed. | Settings → Access Control → Login accounts → Reset password (do this before going live) |
| Sample data | 5 students, 3 parents, 4 staff | Settings → Data → Reset, or edit `seed.js` |
| Creche checklist indicators | seeded from the sample report | Settings → Report Templates → Template A → Edit checklist domains |

## 5b. New client setup (cloning this as a base template)

This codebase is the standard base for every school client — each subscribing school gets its
own install/deployment (its own browser/localStorage instance, or its own MySQL database in API
mode), never a shared database with another school. Recommended order for onboarding a new
client:

1. **Deploy a fresh copy** (new Render static site / new cPanel install). If using the PHP API,
   set a unique `SCHOOL_ID` env var (`SMS_SCHOOL_ID`) per client — never reuse `sch-1` across two
   real schools sharing infrastructure. Local mode generates a unique per-install ID automatically.
2. **Admin signs in** with the seeded demo credentials (§5 above), then immediately:
   - Settings → Profile: school name, motto, contact details, logo/signature/stamp, **Branding →
     Theme colors** (primary + accent — used across the app, printed reports, and receipts).
   - Settings → Access Control → Login accounts: reset every demo password (or delete the demo
     accounts and add real ones) before handing off to the school.
   - Settings → Classes & Subjects, Grading, Fees, Academic, Identity: adjust to the client's
     actual structure — none of this requires a code change.
3. **Bulk-load existing rosters** rather than typing them in one at a time: Students → "Download
   template" / "Upload filled", and Administration → Staff → "Download template" / "Upload
   filled". Both templates are generated from THIS install's own classes, so they only work
   correctly after step 2's class list is set up. Inventory → Item Master has the same
   download-template/upload-filled pattern for stock items. Every upload validates row-by-row and
   only imports valid rows — bad rows are rejected with a reason, nothing is silently overwritten.
4. **Parent access**: Settings → Access Control lets Admin enable/disable an individual parent's
   login and control report-card download, school-wide or per class or per parent.
5. Anything not covered by a Settings screen today (theme is now covered; the payment/SMS
   provider, and the Payroll statutory engine's Ghana-specific shape, are not) requires a code
   change — see "Known limitations" below before promising a client those are self-service.

## 6. Known limitations / stubs (by design for this build)

- **Authentication is client-side only.** Login requires school name + user type + password
  (PBKDF2-SHA256 hashed via WebCrypto, `app/js/auth-lib.js`) — this stops casual access and
  protects passwords from plaintext inspection, but there is no server enforcing it: in Local
  mode, anyone with local access to the browser/device could still edit `localStorage` directly
  to bypass it. Treat this as "keep honest users honest and deter casual snooping," not as
  server-grade security. Real server-side session auth (via the PHP API) is the next step for a
  true multi-device/shared-hosting deployment, and is not built in this pass.
- **Payments & SMS** are test-mode stubs — they never move money or send real texts.
- **PDF output** uses the browser's Print → "Save as PDF" (no heavy PDF library, to keep pages
  light). Report cards are styled to one page per pupil.
- **Google Form bulk option** (online alternative to CSV) is noted in the brief for the online
  phase; the robust **CSV** template/upload flow is fully implemented.
- **Offline PWA** is intentionally not built; the front end is structured (single data-access
  layer, no framework) so a service-worker/PWA layer can be added later without redesign.
- **"By school" report filter** is reserved for the future subscriber/SaaS phase.
- Local mode keeps data in one browser; use API/MySQL mode for shared, multi-device use.
- **Payment receipts** use a fixed layout (`app/js/views/finance.js`) — unlike the exam report
  card, there is no Settings-driven receipt template yet. A client can't reorder/relabel/rebrand
  the receipt without a code change.
- **Payroll's statutory engine** (SSNIT/PAYE terminology and calculation order in
  `app/js/payroll-lib.js`) is shaped for Ghana. Rates and bands are editable in Settings →
  Pay Structure, but modeling a different country's statutory scheme (e.g. Nigeria's
  PAYE+Pension+NHF) needs engineering work, not just data entry.
- **Dashboard KPI cards** (Enrolment, Fees collected, Attendance rate, etc.) are a fixed set —
  not yet Settings-configurable.

---

## Project layout

```
SMS Webapp/
  README.md
  app/                      <- deploy the CONTENTS of this folder to public_html/
    index.html              <- SPA entry (DB_CONFIG flag: Local vs API mode)
    css/  app.css report.css
    js/   seed.js store.js util.js grading.js finance-lib.js reports-lib.js
          bulk.js report.js services.js app.js  views/*.js
    api/                    <- PHP REST API (PDO; SQLite dev / MySQL prod)
      index.php config.php db.php services-stub.php
      seed.json             <- Ghana defaults (single source of truth)
      schema.mysql.sql seed.mysql.sql
      data/                 <- dev SQLite lives here (web-denied)
```

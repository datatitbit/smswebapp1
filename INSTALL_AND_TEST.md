# School Management System — Install & Test Guide
_Last updated: 2026-06-26 · living document (updated at the end of each change)_

This guide covers how to install/run the SMS web app and how to test every feature.
The app has two run modes behind one swappable data layer:
- **Local mode** (default): runs by opening `app/index.html`; data in the browser.
- **API mode**: PHP + PDO REST API (`app/api/`), SQLite in dev / MySQL on cPanel.

---

## 1. Install / Run

### A) Local mode (no server — fastest)
1. Open `app/index.html` in Chrome, Edge, Firefox or Safari.
2. Sign in with the school name, a user type, and that account's password (see the demo
   passwords table in §5 of the README). Ghana defaults are pre-seeded.
3. To restore seed data anytime: Settings → Data → **Reset to Ghana defaults** (this also resets
   login accounts/passwords back to the seeded demo values).

### B) API mode locally (PHP + SQLite)
1. Ensure PHP 7.4+ with PDO SQLite.
2. In `app/`: `php -S 127.0.0.1:8000`
3. In `app/index.html`, set `window.DB_CONFIG = { useApi: true, apiBase: 'api/index.php' }`.
4. Open `http://127.0.0.1:8000/index.html`. The API auto-creates `app/api/data/sms.sqlite`
   and seeds Ghana defaults from `app/api/seed.json` on first request.

### C) cPanel deployment (PHP + MySQL)
1. Upload the **contents of `app/`** into `public_html/` (so `index.html` is at web root,
   API at `public_html/api/`).
2. cPanel → MySQL Databases: create DB + user, grant privileges.
3. cPanel → phpMyAdmin: import `api/schema.mysql.sql`, then `api/seed.mysql.sql`.
4. Edit `api/config.php`: set `'DB_DRIVER' => 'mysql'` and fill `MYSQL_NAME/USER/PASS`.
5. In `index.html` set `useApi: true`.
6. `api/data/` already has an `.htaccess` denying web access (SQLite dev only).
7. Go-live: replace placeholder keys in `api/config.php` + implement the two functions in
   `api/services-stub.php` (payments, SMS). Front-end/API contract unchanged.

---

## 2. Automated tests (developer)

**There are currently no automated test suites in this repository** — no jsdom smoke/functional
tests and no PHP API test script exist as files you can run. Testing today is manual, via the
checklist in §3 below. (An earlier version of this document claimed specific "PASS" results for
suites that were never committed — that claim has been removed as inaccurate. If/when automated
tests are added, they belong in a `tests/` folder with a documented `npm test`-style command, and
this section should be updated to match.)

---

## 3. Manual review checklist

### Settings & Customization
- [ ] Profile: change school name; **upload logo, signature, stamp** (images preview; Save).
- [ ] Academic: edit year, current term, promotional term, vacation/reopening dates.
- [ ] Classes & Subjects: add/edit/remove a category, class, subject; change a class template.
- [ ] **Grading (Option A)**: bands show Level / Grade (A1…E9) / Range / Meaning; edit a band,
      change weighting to 60/40 and confirm totals update; **Reset to Option A** restores default.
- [ ] Fees: add/edit/remove a fee type; change amount/applies-to/frequency/required.
- [ ] Inventory categories: add/edit/remove.
- [ ] Report Templates → Template A: toggle checklist and scores **independently**.
- [ ] Report Templates → Template B: hide/rename Grade, Position-in-subject, Position, Remarks;
      **edit Conduct/Attitude/Interest/Overall option lists** (rename, add, remove, reset each);
      "Reset fields & remarks to default".
- [ ] Identity: confirm `ST####`/`SF####`; toggle manual entry.
- [ ] Roles: permission matrix; Admin always full; save.
- [ ] Profile → Branding: change primary/accent theme colors, confirm the app + a printed report
      pick up the new color; "Reset colors to default" restores the standard look.
- [ ] Access Control → Login accounts: reset a password; add a new login account.

### Subscription & Licence
- [ ] Subscription → Free trial settings: change trial length (e.g. 45 days), confirm "Days
      remaining"/"Trial ends" update immediately; "Reset to default" restores 30 days. Control is
      hidden once a real licence key is activated (key-based expiry is signed, not admin-editable).

### Students & Academic
- [ ] Admit a student (auto ST id); edit; link to a parent (multi-child).
- [ ] Bulk admissions: download template, add a bad row, upload → only valid rows import.
- [ ] Promotion (promotional term): promote/retain/complete; Basic 9 → Alumni.

### Assessment
- [ ] Score entry per class/subject: totals/grade auto-compute from Option A; save.
- [ ] Creche: competency checklist entry (YES/PAR/NES).
- [ ] Report Cards → **Creche (Template A)**: checklist + light scores, no grade/position.
- [ ] Report Cards → **Basic 1 (Template B)**: subjects table w/ grade & positions; click
      **Remarks** per pupil → pick Conduct/Attitude/Interest/Overall + teacher remark; preview
      shows them; **Print / Save PDF**. Logo in header; signature + stamp in signature area.
- [ ] Bulk scores: download template, upload, validation summary.

### Finance
- [ ] Generate term bills; take a test-mode payment; print receipt; Bills report + CSV.
- [ ] Confirm Director/Parent (view-only roles) do **not** see "Generate term bills" or any
      edit control in Finance/Payroll/Accounting/Administration — only Admin and Other staff can.

### Attendance & Discipline
- [ ] **Student Attendance**: pick class/date; present by default; P/A/L; All present/absent; save.
- [ ] **Staff Attendance**: pick date; staff present by default; P/A/L; save.
- [ ] Bulk attendance upload (validation). Conduct notes per pupil.
- [ ] Confirm report card attendance line reflects saved days.

### Communication
- [ ] Send SMS (mock) by class/all parents with placeholders; preview; sent log.
- [ ] Post/delete an announcement (shows on dashboard).

### Administration & Reporting
- [ ] Dashboard KPIs per role.
- [ ] Staff records (SF id) add/edit; assign classes.
- [ ] Staff bulk upload: download template, add a bad row (missing name / unknown role / unknown
      class), upload → only valid rows import with a clear reason for each rejection.
- [ ] Reports: exam summary, finance, attendance with day/week/month/term/year filters + CSV.

### Inventory
- [ ] Add item; stock in/out; low-stock flag; stock report with time filter + CSV.
- [ ] Item Master bulk upload: download template, add a bad row (missing name / unknown category /
      negative cost), upload → only valid rows import with a clear reason for each rejection.

### Roles (gating)
- [ ] Teacher: own class only; no Finance/Settings. Parent: read-only own child. Admin: full.
- [ ] Other staff (Account/Finance office): Finance, Payroll, Inventory, Accounting, Students,
      Administration — no Assessment, no Settings.
- [ ] Login: wrong school name / user type / password is rejected with a generic error (no hint
      about which field was wrong). Settings → Access Control → Login accounts: reset a
      password, add a new login account.
- [ ] Login convenience: school name is pre-filled; selecting a user type auto-fills the
      password ONLY for accounts still on their original seeded demo password. Reset/change a
      demo account's password, then confirm auto-fill no longer fills it in (manual entry of
      the new password still logs in correctly). No "which user" step — the password itself
      picks the account among everyone sharing that role.

---

## 4. Change log
- 2026-07-16 — Simplified login to exactly 3 fields: school name (now pre-filled), user type,
  password — removed the separate "your name" picker. The password itself now identifies which
  account among a shared role to sign in as (checked against each candidate's hash in turn), so
  a school can have several people on the same role without a username. School name is
  pre-filled from the current school profile. Selecting a user type auto-fills the password ONLY
  when that role's account is still on its original seeded demo password (a small table of the
  5 known seed hashes/passwords in `app.js`) — the instant that account's password is changed by
  anyone, its hash no longer matches and auto-fill permanently stops for it; it never applies to
  accounts a school creates itself.
- 2026-07-16 — Admin can now customize/extend the free trial length (Subscription → Free trial
  settings; `License.setTrialDays()` in `license-lib.js`). Default stays 30 days; changing the
  length adjusts days remaining without resetting the trial's start date. Hidden once a signed
  licence key is active.
- 2026-07-16 — Multi-client template readiness pass: per-install `SCHOOL_ID` generation (was a
  shared hardcoded literal); Settings → Profile → Branding theme colors (primary/accent, applied
  live across the app, printed reports, and receipts, with a scoped reset); bulk
  download-template/upload-filled for Staff (Administration) and Item Master (Inventory), matching
  the existing Students/Scores/Attendance pattern; grade-band overlap/range validation and fee
  amount validation on save; manual student/staff ID uniqueness check; `App.permissions` now
  reads seed.js's default matrix directly instead of silently falling back to a second hardcoded
  copy in app.js; Roles tab now explains that these toggles control visibility, not edit rights.
- 2026-07-16 — Replaced the no-password role-picker with real per-account login (school name +
  user type + password, PBKDF2-SHA256 hashed client-side). Added Settings → Access Control →
  Login accounts (reset password / add account). Fixed several view-only bypasses (Director could
  edit staff/payroll/accounting; Parent/Director could generate fee bills). Fixed a stored-XSS in
  payment receipts. "Other staff" now defaults to the Account/Finance office permission set
  (stock, payroll, fees, student & staff data). Removed false automated-test claims from this doc.
- 2026-06-26 — Grading switched to **Option A** (A1–E9 with proficiency level + meaning,
  fully editable, reset-to-default). Added editable **Conduct/Attitude/Interest/Overall**
  remark option sets (selected per pupil on Template B). Added **Staff daily attendance**
  (present by default). Added **logo / signature / stamp** upload in Settings → Profile
  (printed on report cards). Storage version bumped to v2 (auto-seeds new defaults).
- 2026-06-25 — Initial end-to-end build (Phases 1–11): all modules, both report templates,
  PHP/MySQL API, bulk CSV entry, test-mode payment/SMS stubs.

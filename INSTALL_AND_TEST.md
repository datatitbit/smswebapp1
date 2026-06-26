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
2. On the demo sign-in, pick a role (**Admin** sees everything). Ghana defaults are pre-seeded.
3. To restore seed data anytime: Settings → Data → **Reset to Ghana defaults**.

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

Run with Node + a headless DOM (jsdom). Two suites live in the build scratch:
- **Smoke test** — boots the app and renders every screen for all 5 roles; asserts zero errors.
- **Functional test (24 assertions)** — grading maths & weighting, position ties, Template A
  (Creche, no grade/position; checklist independently switchable) and Template B (hide/rename
  Grade/Position/Remarks), fees→payment→arrears, bulk CSV validation (reject bad rows),
  `ST####` IDs, payment + SMS test-mode stubs.
- **PHP API test** — live server CRUD, singletons, sequence, replace, export/reset, pay/sms.

_Latest run results:_ JS smoke = PASS (all roles/routes); functional = 24/24 PASS;
PHP API = PASS (seeds Option A grades A1–E9, remark sets, signature/stamp keys).

> Note: in this build environment the shell's file-view occasionally lags behind saved files;
> when that happens the source is verified by direct file review instead of re-running jsdom.

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
- [ ] Reports: exam summary, finance, attendance with day/week/month/term/year filters + CSV.

### Inventory
- [ ] Add item; stock in/out; low-stock flag; stock report with time filter + CSV.

### Roles (gating)
- [ ] Teacher: own class only; no Finance/Settings. Parent: read-only own child. Admin: full.

---

## 4. Change log
- 2026-06-26 — Grading switched to **Option A** (A1–E9 with proficiency level + meaning,
  fully editable, reset-to-default). Added editable **Conduct/Attitude/Interest/Overall**
  remark option sets (selected per pupil on Template B). Added **Staff daily attendance**
  (present by default). Added **logo / signature / stamp** upload in Settings → Profile
  (printed on report cards). Storage version bumped to v2 (auto-seeds new defaults).
- 2026-06-25 — Initial end-to-end build (Phases 1–11): all modules, both report templates,
  PHP/MySQL API, bulk CSV entry, test-mode payment/SMS stubs.

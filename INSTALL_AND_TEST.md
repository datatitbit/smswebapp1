# School Management System — Install & Test Guide
_Last updated: 2026-07-18 · living document (updated at the end of each change)_

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
- [ ] **Grading (Option A)**: bands show Level / Grade (A1…E9) / Range / Meaning; edit a band;
      **Reset to Option A** restores default.
- [ ] **Score weighting**: change class/exam max points to 40/60 (must sum to 100); in Assessment →
      Score Entry confirm the input caps update to max 40 / max 60 and Total = the direct sum (e.g.
      26 + 23 = 49, not a re-weighted blend) — this matches standard SBA reporting.
- [ ] Fees: add/edit/remove a fee type; change amount/applies-to/frequency/required.
- [ ] Inventory categories: add/edit/remove.
- [ ] Report Templates → Template A: toggle checklist and scores **independently**.
- [ ] Report Templates → Template B: hide/rename Grade, Position-in-subject, Position, Remarks;
      **edit Conduct/Attitude/Interest/Overall option lists** (rename, add, remove, reset each);
      "Reset fields & remarks to default"; confirm Grade and Position-in-class can each be removed
      independently and that "Reset fields & remarks to default" restores both.
- [ ] Identity: confirm `ST####`/`SF####`; toggle manual entry.
- [ ] Roles: permission matrix; Admin always full; save.
- [ ] Profile → Branding: with "Use these colours" OFF, confirm the app stays on the standard
      look regardless of saved colours; set primary + 2 secondary colours and turn the toggle ON,
      confirm the app, login screen and a printed report all pick up the new colours; turn the
      toggle back OFF and confirm it reverts to default while keeping the colours saved (re-enable
      restores them without re-entering); "Reset to default (and turn off)" clears everything.
- [ ] Access Control → Login accounts: reset a password; add a new login account.
- [ ] Admission Form: rename a core field (e.g. Class) and toggle one required — confirm Students →
      "Admit student" picks up both immediately; add a custom field (any section), confirm it
      appears and saves under the student's record, edit the same student and confirm the value
      reloads; delete a custom field; **rename an existing custom field's label** and confirm it
      updates on the admission form and the field list without losing already-saved student
      values; add a "Siblings" field, add/remove sibling rows, save, and confirm the sibling list
      reloads correctly on Edit; "Reset to sample-form defaults" restores the full seeded set (8
      core + 28 custom fields); toggle the "Profile" checkbox off for a field and confirm it
      disappears from Students → "Download student profile" output.

### Subscription & Licence
- [ ] Subscription → Free trial settings: change trial length (e.g. 45 days), confirm "Days
      remaining"/"Trial ends" update immediately; "Reset to default" restores 30 days. Control is
      hidden once a real licence key is activated (key-based expiry is signed, not admin-editable).

### Students & Academic
- [ ] Admit a student (auto ST id); edit; link to a parent (multi-child).
- [ ] Bulk admissions: download template, add a bad row, upload → only valid rows import.
- [ ] **Update existing students**: pick "Single student", download the data template (pre-filled
      with current values), change a field, keep student_id unchanged, upload → confirm the
      existing record updates (not a duplicate insert); repeat with "Whole class" scope; confirm an
      unknown/mismatched student_id in the upload is rejected with a clear reason, not silently
      skipped or inserted.
- [ ] **Download student profile**: pick a class, tick one/several/all students, download/print →
      confirm the sheet shows only the fields marked "Profile" in Settings → Admission Form.
- [ ] Promotion (promotional term): promote/retain/complete; Basic 9 → Alumni.

### Assessment
- [ ] Score entry per class/subject: class/exam inputs capped at the configured max points; total
      is the direct sum; grade auto-computes from Option A; save.
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
- [ ] **Update one staff member**: click "Update template" on a staff row, edit a field (e.g.
      phone), keep staff_id unchanged, use "Upload staff update" → confirm that one record updates;
      confirm uploading a template for a different/unknown staff_id is rejected, not applied.
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
- 2026-07-18 — Fixed a real grading bug: class score and exam score were each being entered out of
  100 and then re-blended by percentage, silently deflating totals whenever weighting wasn't 50/50
  (e.g. a 35/60-max entry was cut to 14). Class score and exam score are now entered already scaled
  to their own weight (e.g. 40 + 60 when weighting is 40/60, standard Ghanaian SBA convention) and
  the total is a direct sum — verified against a real sample report card (26 + 23 = 49). Input caps
  and bulk-upload validation now track the configured weighting instead of a hardcoded 0–100.
  `Grading.computeTotal()` dropped its now-unused weighting argument (old 3-arg callers still work
  harmlessly). Settings → Grading relabeled to "max points" and explains the new semantics.
- 2026-07-18 — Students: added "Update existing student records" (Students tab) — download a
  spreadsheet pre-filled with current details for a whole class or a single student, edit, and
  upload it back to UPDATE the matching record by student_id (separate from the new-admissions
  template, which only inserts). Added "Download student profile" — a printable profile sheet for
  one, several, or a whole class of students; which fields appear is controlled per-field by a new
  "Profile" toggle in Settings → Admission Form (declaration and office-use fields are excluded by
  default, everything else included).
- 2026-07-18 — Administration → Staff: added a per-staff "Update template" download plus an
  "Upload staff update" button — the same download/edit/upload-to-update pattern as students, but
  one staff member at a time (matched by staff_id). Existing bulk buttons relabeled "New-staff
  template" / "Upload new staff" to distinguish them from the update flow.
- 2026-07-18 — Settings → Profile → Branding rebuilt: one primary/dominant colour plus two
  secondary colours (was primary + a single accent), behind an explicit "Use these colours" toggle
  that defaults OFF — the app, login/admission screens and printed reports keep the standard
  Zetranova look until an admin turns it on. Turning it off preserves the saved colours (turning it
  back on restores them without re-entering); "Reset to default (and turn off)" clears everything.
  `school.theme_accent` is now `theme_secondary1` + new `theme_secondary2`; `App.themeHex()` still
  returns `.accent` for compatibility alongside the new `.secondary1`/`.secondary2`.
- 2026-07-17 — Admission form is now fully admin-configurable (Settings → Admission Form, new
  tab). Core fields used elsewhere in the app (first/last name, gender, DOB, class, parent, status,
  admitted-on) can be renamed and marked required/optional but never removed, since the student
  list, bulk upload, promotion and reports all depend on their keys. Admin can add unlimited custom
  fields grouped into five sections — Personal Details, Health Needs, Parent/Guardian Details,
  Declaration, For Office Use Only — each with a type (short text, long text, number, date,
  dropdown, yes/no checkbox, or a repeatable "siblings" list capturing name + class), optional
  helper text, and its own required flag; custom fields can be edited or deleted at any time, and
  "Reset to sample-form defaults" restores the full seeded set. Seeded with 28 custom fields modeled
  on a real Ghanaian school admission form (nationality, previous school, siblings already enrolled
  with their class, special educational/medical needs, food allergies, guardian age/relationship/
  address/profession/how-they-heard-about-the-school, a declaration acknowledgement, and
  office-use admission-assessment scores). Custom field values are stored per student under
  `student.extra` and do not appear in the student list, bulk upload template, or printed reports —
  only on the Admit/Edit student form itself.
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

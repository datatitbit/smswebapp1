# WEBAPP LOGIC — School Management System (Ghanaian Private Basic School)
_Single source of truth. Paste into an AI builder to reconstruct the app without further guidance._
_Last updated: 2026-07-16 (living document — updated at the end of each change)._

> **Drift note (2026-07-16):** sections below describe the original Phase 1–11 build and predate
> several shipped modules — **Accounting**, **Payroll**, **Settings → Access Control**, and
> **Subscription/Licensing** (`app/js/license-lib.js`, `app/js/auth-lib.js`, `views/accounting.js`,
> `views/payroll.js`, `views/subscription.js`). It also predates real login (see below). Treat this
> file as the original architectural spec, and README.md's module table as the current feature
> list, until this file is fully re-authored.
>
> **Authentication (added 2026-07-16):** login is now school name + user type + password, not a
> no-password role picker. Each `users` record carries `password_salt`/`password_hash` (PBKDF2-
> SHA256 via `app/js/auth-lib.js`, WebCrypto) and `must_change_password`. Session (`sms_session`)
> stores only `{id, role, name}` — never the hash. This is still client-side-only enforcement
> (see README §6 "Known limitations") — a real server-side session layer is future work.
>
> **Multi-client templating (added 2026-07-16):** `seed.js`'s `SCHOOL_ID` is now generated once
> per install (persisted under the separate `sms_school_id` localStorage key) instead of a shared
> literal `'sch-1'` baked into the codebase — see README §5b "New client setup". The `school`
> singleton gained `theme_primary`/`theme_accent` (Settings → Profile → Branding), applied at boot
> via `App.themeHex()`/`applyTheme()` in `app.js` as CSS custom-property overrides. `App.permissions`
> now reads `seed.js`'s `permissions` object directly as the real default (previously it silently
> fell back to a second, separately-hardcoded matrix in `app.js` until the first Settings → Roles
> save). Students, Staff, and Inventory Item Master all have a download-template/upload-filled CSV
> pattern (`app/js/bulk.js`); Finance/Accounting bulk import does not exist yet.

## 0. One-paragraph brief
Build a mobile-first, low-bandwidth School Management System sold and installed **per school**
(one database per school). It must be **tenant-aware**: a single top-level `School` record that
every other record belongs to (so a future multi-school SaaS is a hosting change, not a rewrite).
Ship with **Ghana defaults** (GES/NaCCA structure, SBA 50/50 scoring, GHS currency, MoMo/SMS)
that are **all editable in Settings — never hard-coded**. Build online first; structure the front
end so an offline PWA can be derived later. Clean, calm, education-appropriate UI: **deep teal
primary (#0f5e5e), warm gold accent (#d9a521), off-white background (#faf8f3), system fonts**.

## 1. Stack & architecture
- **Front end**: mobile-first single-page app in plain HTML/CSS/JavaScript (no framework, no
  build step), loaded via `<script>` tags. Hash-router. System fonts only.
- **Back end**: PHP REST API using **PDO** so the same code runs on **SQLite (dev)** and
  **MySQL (cPanel prod)**. Deployable to shared cPanel hosting.
- **Swappable data-access layer** is the key pattern: every screen talks ONLY to a `DB` facade
  (`store.js`). Two adapters implement the same async interface:
  - `LocalAdapter` — browser `localStorage` (default; app runs by just opening index.html).
  - `ApiAdapter` — the PHP/MySQL REST API.
  Switching backend = flip `DB_CONFIG.useApi`. No screen changes.
- **External services** (payments MoMo/Paystack, SMS gateway) are **test-mode mock stubs** behind
  a clean interface; real providers plug in later by changing config only. Never store real keys.

### Front-end file layout
```
app/index.html
app/css/app.css        (theme + shell + components)
app/css/report.css     (printable report card; @media print)
app/js/seed.js         (Ghana default seed data — single source of truth)
app/js/store.js        (DB facade + LocalAdapter + ApiAdapter)
app/js/util.js         (el(), $/$all, toast, modal, form builder, money, dates, debounce)
app/js/grading.js      (computeTotal, gradeFor, positions, ordinal)
app/js/finance-lib.js  (fee maths)
app/js/reports-lib.js  (time-filter control: day/week/month/term/year/all + inRange)
app/js/bulk.js         (CSV download/parse, file pick, row validation, summary modal)
app/js/report.js       (build report card DOM for Template A & B; print)
app/js/services.js     (front-end payment + SMS mock stubs)
app/js/app.js          (shell: top bar, slide-in sidebar, session/role, router, permission gating)
app/js/views/{dashboard,students,assessment,finance,attendance,communication,inventory,administration,settings}.js
app/api/{index.php,config.php,db.php,services-stub.php,seed.json,schema.mysql.sql,seed.mysql.sql,data/}
```
Script load order matters: seed, store, util, grading, finance-lib, reports-lib, bulk, report,
services, **app.js (defines global App BEFORE views capture it)**, then all views. Views register
onto `global.Views[route] = { render(container) }`. `app.js` boots on DOMContentLoaded.

## 2. Data model (tenant-aware; all records carry school_id)
The operational store is a generic document store mirrored on both adapters. Collections (arrays)
and singletons (one object per school).

**Singletons:** `school`, `academic`, `idRules`, `weighting`, `labels`.
**Collections:** `categories`, `classes`, `gradeBands`, `feeTypes`, `inventoryCategories`,
`reportTemplates`, `permissions`, `messageTemplates`, `users`, `staff`, `parents`, `students`,
`scores`, `attendance`, `staffAttendance`, `studentRemarks`, `checklists`, `conduct`, `invoices`,
`payments`, `inventoryItems`, `stockMovements`, `announcements`, `messages`. Plus `meta.seq`
counters for ID generation (`student`, `staff`).

### Record shapes (key fields)
- **school**: id, name(required), motto, address, location, phone, whatsapp, email, website,
  logo(dataURI/url), **signature(dataURI)**, **stamp(dataURI)**, currency('GHS').
- **academic**: id, year('2025/2026'), current_term(int), promotional_term(int default 3),
  terms:[{n, name, vacation(date), reopening(date)}] (three terms).
- **idRules**: student_prefix('ST'), staff_prefix('SF'), digits(4), auto_generate(bool),
  allow_manual(bool). ID = prefix + zero-padded number = 6 chars (e.g. ST0001).
- **weighting**: class_pct(50), exam_pct(50). class+exam must total 100.
- **labels**: editable report/fees labels: fees_arrears, fees_next, fees_payable, roll,
  attendance, out_of.
- **categories**: id, name, sort.
- **classes**: id, category_id, name, template('A'|'B'), subjects:[string], sort.
- **gradeBands** (see §4): id, level(int), grade(code), min, max, remark(meaning).
- **feeTypes**: id, name, amount, applies_to('all'|category_id), frequency('per_term'|'one_time'),
  required(bool).
- **inventoryCategories**: id, name.
- **reportTemplates**: see §6.
- **permissions**: [{role, perms:{module:bool}}] (see §5).
- **messageTemplates**: id, name, body (placeholders).
- **users**: id, name, username, role, staff_id?, class_ids?, linked_student_ids? (demo login).
- **staff**: id, staff_id(SF####), name, role, phone, class_ids:[].
- **parents**: id, name, phone, whatsapp, email, student_ids:[studentCode] (multi-child).
- **students**: id, student_id(ST####), first_name, last_name, gender, dob, class_id, parent_id,
  status('active'|'withdrawn'|'completed'), admitted_on, promoted_to.
- **scores**: id, student_id(code), class_id, subject, term, class_score(0-100|null),
  exam_score(0-100|null). Total/grade/position are COMPUTED, never stored.
- **attendance**: id, student_id, class_id, date, status('present'|'absent'|'late').
- **staffAttendance**: id, staff_id, date, status('present'|'absent'|'late').
- **studentRemarks**: id, student_id, class_id, term, conduct, attitude, interest, overall,
  teacher_remark (selected values for Template B).
- **checklists**: id, student_id, class_id, term, marks:{indicator: 'YES'|'PAR'|'NES'} (Template A).
- **conduct**: id, student_id, class_id, date, note, by.
- **invoices**: id, student_id, class_id, term, fee_type_id, fee_name, amount, created_on.
- **payments**: id, student_id, term, amount, method, reference, receipt_no, created_on, by.
- **inventoryItems**: id, name, category, qty, unit, unit_cost, low_threshold.
- **stockMovements**: id, item_id, item_name, type('in'|'out'), qty, note, date, by.
- **announcements**: id, title, body, at, by.   **messages**: id, to, body, channel, status, at, by.

## 3. App shell, roles & routing
- **Top bar**: menu button (mobile), school name + academic year + current term, role switcher.
- **Sidebar** (slide-in on mobile, fixed ≥900px): Dashboard, Students, Assessment, Finance,
  Attendance, Communication, Administration, Inventory, Settings. Items the role can't access are
  disabled. All modules are functional.
- **Session**: demo role-picker (no passwords this phase; `users` table has a password_hash column
  in the relational schema for real auth later). Role stored in localStorage.

## 4. Grading — OPTION A default (fully editable)
Default grade bands (admin may edit any value, add/remove bands, rename meanings, or **Reset to
Option A**):

| Proficiency level | Range (%) | Grade | Meaning |
|---|---|---|---|
| 1 | 90–100 | A1 | EXCELLENT |
| 2 | 80–89 | B2 | VERY GOOD |
| 3 | 75–79 | B3 | GOOD |
| 4 | 70–74 | C4 | FAIRLY GOOD |
| 5 | 65–69 | C5 | AVERAGE |
| 6 | 60–64 | D6 | BELOW AVERAGE |
| 7 | 55–59 | D7 | CREDIT |
| 8 | 50–54 | E8 | PASS |
| 9 | 0–49  | E9 | BEGINNING |

- **Score weighting** (SBA split): Class Score % and Exam Score %, default **50/50**, editable
  (must total 100). Class & exam are each entered out of 100; Total = class*cw + exam*ew.
- **Grade** = band whose [min,max] contains Total. **Remark/meaning** comes from the band.
- **Positions**: overall class position (by sum of subject totals) and position-in-subject (by
  subject total), computed automatically, ties share the rank (1,1,3).
- Admin may **hide, rename, or reset** the Grade column, Position-in-subject, overall Position,
  and Remarks per template (Template B fields).

## 5. Roles & permission matrix
Five roles: **Admin, Director, Teacher, Other staff, Parent**. Module-level on/off matrix, editable
by Admin. **Admin is always full.** Defaults:
- Admin: all (incl. Settings).
- Director: all except Settings.
- Teacher: Dashboard, Students, Assessment, Attendance (own class(es) only). No Finance/Settings.
- Other staff: Dashboard, Students, Attendance, Communication, Inventory (configurable; can be
  granted Finance to become a bursar).
- Parent: read-only own child(ren) — Dashboard, Students, Assessment, Finance, Attendance,
  Communication (all view-only).

## 6. Report cards (core deliverable)
A template is assigned per class. Default: **Creche → Template A**; all other classes → **Template B**.
Both share a header and footer; every block/field is toggleable and most are renamable in Settings.

**Shared header**: logo (or initials badge) + school name + motto + contact (from profile); term
label (e.g. "Third Term Report") + academic year; student name + student ID; class; number on roll;
attendance (present out of total days recorded for the class); term vacation + next-term reopening
dates; **fees block** (arrears / next term's fees / total payable — labels editable). **Footer**:
editable note (e.g. "Any erasure on this report invalidates it") + KEYS legend where used. If a
school **signature** and/or **stamp** image is uploaded, they print in the signature area.

**Template A — Creche (competency, modular):**
- Competency checklist grouped by developmental domain (Health & Physical; Emotional & Social;
  Cognitive & Language), each with indicator statements rated **YES / PAR(tially) / NES (needs
  effort)** via a KEYS legend. Domains/indicators editable; seeded from the sample report.
- Light scores table for the Creche subjects (Class % / Exam % / Total % / Remarks) — **no Grade,
  no Position**.
- The **checklist block and the scores block are each independently switchable** (checklist-only,
  scores-only, or both). Overall remarks; head signature/stamp; fees block.

**Template B — Standard (marks-based):**
- Subjects table: Class % / Exam % / Total % / **Grade** / **Position in subject** / **Remarks**.
- Overall **Position** in class at top. Each of Grade, Position-in-subject, Position, Remarks is
  **hideable and renamable**, with **reset to default**.
- **Conduct / Attitude / Interest / Overall remark** lines — selected per pupil from **editable
  option lists** (defaults below), plus a free-text **Class Teacher's Remark** and **Head
  Teacher's Signature/Stamp** line (each toggleable/renamable).
- On the **promotional term**, a "Promoted to:" line appears (defaults to next class; retained
  pupils repeat; Basic 9 → Completed/Alumni).
- Output: clean printable PDF via the browser's Print → Save as PDF, one page per pupil.

### Default editable remark option sets (Template B)
- **CONDUCT**: SATISFACTORY, EXCELLENT, FAIRLY GOOD, GENERALLY ACTIVE, ENERGETIC, UNPREDICTABLE.
- **ATTITUDE**: CALM, ADVENTUROUS, SOCIABLE, RESERVED, WELL BEHAVED, DISCIPLINED.
- **INTEREST**: READING/ENGLISH, MATHEMATICS, SCIENCE, SPORTS/GAMES, MUSIC/DANCE, MAKING ARTWORK,
  COMPUTING, MULTI-TALENTED, INDOOR ACTIVITIES, OUTDOOR ACTIVITIES.
- **OVERALL REMARK**: EXCEEDS EXPECTATIONS, MEETS EXPECTATIONS, APPROACHING EXPECTATIONS,
  NEEDS IMPROVEMENT, BELOW EXPECTATIONS.
Admin may rename each category, add/edit/remove options, toggle show, or reset each set to default.

## 7. Classes, categories & subjects (seed; all editable)
Categories: **Preschool, Lower Primary, Upper Primary, Junior High School**.
Classes & templates:
- Preschool: **Creche → Template A**; Nursery 1, Nursery 2, KG 1, KG 2 → Template B.
- Lower Primary: Basic 1–3 → Template B.
- Upper Primary: Basic 4–6 → Template B.
- JHS: Basic 7–9 → Template B.
Default subjects per class:
- Creche: Literacy, Numeracy, Creativity, Picture Reading.
- Nursery/KG: Language & Literacy, Writing, Numeracy, Creative Arts, Our World Our People.
- Basic 1–3: English Language, Mathematics, Science, Creative Arts, History, Our World Our People,
  RME, Fantse.
- Basic 4–6: English Language, Mathematics, Science, History, Creative Arts, Our World Our People,
  RME, Computing, Fantse.
- Basic 7–9: English Language, Mathematics, Science, Career Technology, Creative Art & Design,
  Our World Our People, RME, Computing, Fantse.
The Ghanaian-language subject (Fantse) is itself editable (varies by region).

## 8. Fees (seed; editable)
Each fee type: name, amount, applies-to (category or all), frequency (per term / one-time),
required (yes/no). Seed: Tuition (600, req), PTA Dues (30, req), Examination Fee (50, req),
ICT Fee (40, opt), Feeding (300, opt) — all per term, GHS.
- **Billing** generates invoices per pupil from applicable fee types for a class/term.
- **Fee position**: arrears = Σinvoices − Σpayments; next = next term's standard bill for the class;
  payable = arrears + next. Same figures show in the report fees block.
- **Payments**: Mobile Money / card (Paystack) via a **test-mode stub** (no real charge), plus cash;
  produce a printable receipt. **Bills/Fees report** is dedicated, separate from the exam report.

## 9. Attendance & discipline
- **Daily student attendance** per class/date; **present by default**; mark P/A/L; "All present /
  All absent" quick actions; bulk CSV upload with validation. Totals feed the report card.
- **Daily staff attendance** per date; staff **present by default**; mark P/A/L; save.
- Optional conduct/discipline notes per pupil.

## 10. Communication
SMS (and later WhatsApp) to parents via a **mock sender**: announcements, fee reminders,
"report ready". Editable message templates with placeholders `{parent} {student} {term} {balance}
{currency} {school} {message}`. One parent links to several pupils (multi-child) — one message
covers all. Announcements list shows on the dashboard.

## 11. Administration & reporting
Role-aware dashboard (enrolment, fees collected/outstanding, attendance rate, low stock, key
dates, announcements). Staff records (SF####), class assignment. Cross-cutting reports — exam
summary (per class), finance collections, attendance — with **day/week/month/term/year** time
filters and **CSV export**. ("By school" filter reserved for the future SaaS phase.)

## 12. Inventory / stock
Items: name, inventory category (from Settings), quantity, unit, optional unit cost, low-stock
threshold. Stock-in/out movements adjust quantity. Low-stock view; stock report with the same time
filters + CSV.

## 13. Identity & numbering
Student IDs prefixed **ST**, staff **SF**; prefix + 4 digits = 6 chars (ST0001). Auto-generate by
default (next available via `meta.seq`), with a Settings switch to allow manual entry. Unique within
the school.

## 14. Bulk data entry by file (CSV)
On high-volume screens — **score entry, daily attendance, bulk admissions, fee billing** — provide
**Download template** (pre-filled with the right columns and existing rows, e.g. pupil names/IDs)
and **Upload filled**. Upload validates every row, shows a summary of what will import vs what is
rejected and why, and imports **only valid rows — never silently overwrites**. (A Google-Form
alternative is planned for the online phase; CSV is the robust core.)

## 15. REST API (PHP + PDO)
Front controller `api/index.php` routed via `?r=...`, mirroring the front-end DB facade:
```
GET    ?r={collection}            list
GET    ?r={collection}/{id}       get one
POST   ?r={collection}            insert (JSON body)
PUT    ?r={collection}/{id}       update (partial JSON)
DELETE ?r={collection}/{id}       remove
PUT    ?r={collection}            {replace:[...]} replace whole collection
GET    ?r=singleton/{name}        get singleton
PUT    ?r=singleton/{name}        set singleton
POST   ?r=seq/{kind}              next sequence number (portable upsert)
GET    ?r=export                  full dataset      PUT ?r=import  replace dataset
POST   ?r=reset                   wipe + reseed
POST   ?r=pay  {amount,...}       mock payment (test mode)
POST   ?r=sms  {to,body}          mock SMS (test mode)
```
Storage: a small document store — `documents(id, collection, school_id, data JSON)`,
`singletons(name, data)`, `meta_seq(kind, val)` — auto-created and seeded from `seed.json` on first
run. A **normalised relational MySQL schema** (`schema.mysql.sql`) + Ghana **seed**
(`seed.mysql.sql`) are also provided for DBAs / future server-side modules. `config.php` selects
SQLite vs MySQL and holds placeholder credentials + test-mode service keys.

## 16. Build order (phased)
1. Settings & Customization core (foundation). 2. Student & Academic. 3. Assessment & report cards
(Templates A & B, PDF). 4. Finance & fees. 5. Attendance & discipline (student + staff).
6. Communication. 7. Administration & reporting. 8. Inventory. 9. Bulk file entry. 10. External
services as test-mode stubs. 11. cPanel deploy (MySQL). 12. (Later) offline PWA — derive from the
same codebase; do not build now.

## 17. Non-functional rules
Mobile-first; low-bandwidth (light pages, system fonts, minimal images, no heavy frameworks);
validation everywhere (esp. uploads); role-gated UI; clean calm interface; everything
school-specific lives in Settings, never hard-coded; tenant-aware throughout; clear save
confirmations.

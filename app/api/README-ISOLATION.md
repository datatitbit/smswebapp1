# API — Per-School Isolation (backend security)

_Added 28 July 2026. Status: **built, NOT yet tested on a live PHP host.**_

This describes the multi-tenant security layer added to the PHP/MySQL API so a
single shared database can safely host many schools, with each school able to
see **only its own data**.

> ⚠️ **The live website is unaffected by these files.** Render serves the app
> client-only (`useApi:false`) and does not run PHP. This backend only becomes
> active when the app is deployed to a PHP host (e.g. Namecheap cPanel) with
> `DB_CONFIG.useApi = true`. **Test it there before go-live** using the
> checklist below — it has not been run yet (no PHP in the build environment).

---

## How isolation works

1. **Login is the only public route.** `POST ?r=auth/login` verifies the
   username/password against that school's users (same PBKDF2-SHA256 scheme as
   the front end) and returns a **signed token** carrying the school id + role.
2. **Every other request must send** `Authorization: Bearer <token>`.
3. **The active school is read from the token only** — never from the request
   body or URL. Every read is filtered by it; every write is stamped with it;
   upserts/patches cannot touch or overwrite another school's row.
4. **Subscription gate.** A school whose `schools.status` is not
   `active|trial|grace` is refused at login and on every request.

Data model (all tenant-tagged):

```
schools(id, name, status, plan, created_at)   -- tenant registry
documents(id, collection, school_id, data)    -- array collections
singletons(school_id, name, data)             -- per-school settings
meta_seq(school_id, kind, val)                -- per-school counters (ST/SF numbering)
```

---

## One-time setup on the PHP host

Set these environment variables (cPanel: "Setup Node/PHP App" env vars, or an
`.htaccess`/`SetEnv`, or edit `config.php` directly):

```
SMS_DB_DRIVER = mysql
SMS_DB_HOST   = localhost
SMS_DB_NAME   = <cpaneluser>_sms
SMS_DB_USER   = <cpaneluser>_smsapp
SMS_DB_PASS   = <the db password>

SMS_APP_SECRET = <64 hex chars>     # openssl rand -hex 32   (REQUIRED)
SMS_TOKEN_TTL  = 43200              # optional, seconds

# Optional platform super-admin (can provision/suspend schools):
SMS_PLATFORM_USER = zetranova
SMS_PLATFORM_SALT = <from hashpass>
SMS_PLATFORM_HASH = <from hashpass>
```

Generate the platform admin salt/hash:

```
php tools/hashpass.php "YourStrongPassword"
```

The API refuses to issue tokens while `APP_SECRET` is the placeholder.

---

## Provisioning a new school (subscription flow)

As the platform admin (log in to get a platform token), call:

```
POST ?r=provision   { "school_id": "st-marys", "name": "St Mary's Basic" }
```

`school_id` becomes that school's public URL directly — `zetclass.com/st-marys`
— so pick it deliberately (lowercase letters, numbers, hyphens only). It's
rejected if it collides with a reserved word (see `RESERVED_SLUGS` in
`app/js/app.js` and this file's matching list in `index.php`). This creates
the registry row and seeds that school's defaults from `seed.json`.
Suspend / reactivate on payment status:

```
POST ?r=suspend     { "school_id": "st-marys", "status": "suspended" }
```

---

## Migration note (existing databases)

`singletons` and `meta_seq` are now keyed by `school_id`. A database created by
the **old** schema (name-only / kind-only primary key) must be rebuilt or
migrated first. For a fresh install there is nothing to do — the tables are
created correctly and the default school is seeded on first run.

---

## TEST CHECKLIST (run on a PHP host before go-live)

Isolation is security-critical, so verify all of these pass:

1. `php -l` on every file in `api/` reports "No syntax errors".
2. Fresh DB: first request seeds the default school; `schools` has 1 row.
3. `POST ?r=auth/login {username:"admin",password:"admin123"}` returns a token.
4. Wrong password returns **401**; no token.
5. Any data route **without** a token returns **401**.
6. With a valid token, `GET ?r=students` returns only that school's students.
7. Provision a 2nd school; log in as each; confirm neither can read, update,
   `POST` over, or `DELETE` the other's rows (expect empty lists / 403 / 404).
8. `POST ?r=students` with a body containing another school's `school_id` still
   stores the row under the **token's** school (spoofing ignored).
9. `seq` counters increment **independently** per school (ST numbering).
10. Suspend a school → its users can no longer log in or call the API (403).
11. `POST ?r=trial {school_id, days}` as platform → that school's
    `singletons.license.trial_days` increases by `days`; a non-platform token
    gets 403.

---

## Front-end wiring (done) and deployment (see /DEPLOY.md)

The front-end wiring described in earlier versions of this doc is done:
`store.js`'s `ApiAdapter` logs in via `?r=auth/login`, stores the returned
token, and attaches `Authorization: Bearer <token>` to every request;
`app.js` has a dedicated API-mode login screen (`chooseRoleApi`), path-based
routing (`/:slug/...`, `/admin/...`), and a platform dashboard
(`/admin`) for provisioning, suspending, resetting, extending trials, and
impersonating schools.
Flip `DB_CONFIG.useApi = true` in `app/index.html` to switch the app into API
mode — see that file's `API_BASE` comment and **`/DEPLOY.md`** for how to
point it at a PHP host that may not share the frontend's origin (Render
serves the static frontend only; the PHP API is deployed separately).

What is still genuinely pending: real execution of the TEST CHECKLIST above on
an actual PHP host (this sandbox has no PHP interpreter, so the API code has
only been reviewed statically) and the impersonation audit log
(`impersonation_log`) has no admin-facing viewer yet — it is written on every
`?r=impersonate` call but only queryable directly in the database today.

# Deployment topology — Render (frontend) + cPanel/Namecheap (PHP API)

_Added as part of the multi-tenant wiring work (Steps 1–5, `feature/multi-tenant-wiring`)._

This app has **two independent deployment targets**. They are never the same
host, and Render can never run the PHP API — understanding that split is the
point of this document.

```
Render (Static Site)                          cPanel / Namecheap host
  app/ only, api/ stripped     -- Bearer -->     PHP + MySQL (app/api/)
  https://zetclass.com (Render behind it)         api/index.php + PDO/MySQL
  serves index.html, js/, css/  <-- JSON ---      login, CRUD, platform routes
  static files only, no PHP                       (provision/suspend/impersonate)
```

## 0. Domain structure — client name NOW vs. LATER (read this first)

> **Plain-English summary:** right now, a school's name goes **after** the
> domain, as part of the page address. **Later**, once we move to a proper
> server, a school's name will go **before** the domain instead. This is a
> deliberate, staged decision — not an accident — and it is the single most
> important thing to remember about how client URLs work in this app.

| Stage | Example URL for a school called "Schoola" | Pattern |
|---|---|---|
| **NOW** (this build, on shared hosting) | `zetclass.com/school/schoola` | client name comes **AFTER** the domain (**path-based routing**) |
| **LATER** (once on a bigger server) | `schoola.zetclass.com` | client name comes **BEFORE** the domain (**subdomain routing**) |

**Why NOW is path-based:** subdomain routing needs a **wildcard SSL
certificate** (a security certificate that covers `*.zetclass.com` — i.e. any
name in front of the domain — instead of just one exact address) plus
**wildcard DNS** (telling the internet's address book that *any* name before
`zetclass.com` should point at our server). Ordinary shared hosting (cPanel /
Namecheap, which is what this app targets today — see §2 below) does not make
that easy or automatic. Path-based routing needs none of that extra setup, so
it is what `app.js`'s `/school/:slug/...` routing (see §3) actually
implements today — this is **not a trust boundary or security feature**, it
only decides which login screen pre-fills; see the code comment at the top of
`parsePathRoute()` in `app/js/app.js` for the full explanation.

**Why LATER should move to subdomains:** once there are enough paying
schools to justify a **VPS** (Virtual Private Server — your own dedicated
slice of a real server, instead of shared hosting where you share a machine
with other websites), subdomains become easy to set up properly and are the
standard, more professional pattern serious SaaS (Software-as-a-Service —
software rented online rather than installed) products use. It also gives
each school session a cleaner separation in the browser (via **cookies** —
small pieces of login data a browser stores per address).

**When switching, what actually changes:** only the URL pattern and the
hosting/DNS/SSL setup around it — the underlying security model does NOT
change. The school's data is, and always will be, isolated by the **signed
token** issued at login (see `README-ISOLATION.md`), never by the URL itself.
Whether a school's address is `zetclass.com/school/schoola` or
`schoola.zetclass.com`, the server never trusts what's in the URL for
security — only the token. So this is purely a URL-presentation/hosting
decision, safe to defer and change later without touching the security design.

## 1. Render — static frontend only

- `render.yaml`'s `buildCommand: rm -rf app/api` **removes the entire `api/`
  folder** (including `config.php` and any credentials pasted into it) before
  publishing. Render's static-site runtime does not execute PHP even if the
  folder were left in place — it only serves files as-is.
- The live site (`https://zetclass.com`, served by Render — see custom-domain
  note below) therefore **always runs
  in Local mode** (`DB_CONFIG.useApi = false`, browser `localStorage`) unless
  and until `index.html` is changed to point at a real, separately-hosted API
  (see §3). Pushing to `main` never deploys or affects the PHP API in any way
  — the two are completely decoupled.
- This is intentional, not a limitation to fix: Render's free static-site tier
  has no PHP/MySQL runtime, so it was never a candidate for hosting the API.

## 2. cPanel / Namecheap — the PHP + MySQL API

The API (`app/api/`) is designed to run on a standard shared-hosting PHP+MySQL
stack (cPanel, Namecheap, or equivalent). Full setup steps (schema import,
`config.php` environment variables, the platform super-admin account, the
provision/suspend/impersonate routes) are documented in
[app/api/README-ISOLATION.md](app/api/README-ISOLATION.md) — that file is the
source of truth for API setup; this document only covers the **split-host
wiring** between it and the Render frontend.

Two ways to lay this out:

- **Same-origin** (simplest): upload `app/`'s contents (including `api/`) to
  the PHP host's `public_html/`, so the frontend *and* API are served from the
  same domain. `apiBase: 'api/index.php'` (a relative path) just works — this
  is what `README.md` §3 already documents.
- **Split-origin** (this repo's actual target topology): the frontend stays on
  Render, only `api/` is deployed to the PHP host under its own domain (e.g.
  `https://api.zetclass.com`). This requires the frontend to know the
  **full URL** of the API — see §3 below — and relies on `index.php`'s
  existing `Access-Control-Allow-Origin: *` header, which already permits
  cross-origin requests from the Render domain with no further server change.

## 3. Frontend config: pointing at the right API per environment

`app/index.html` sets `window.DB_CONFIG` once, at the top of the page, in a
single editable spot:

```html
<script>
  // ---- API base URL per environment ----
  // Render hosts the static frontend ONLY — it can never run api/index.php
  // (see DEPLOY.md). API_BASE must be a URL this page can actually
  // reach api/index.php at:
  //   - same-origin PHP host (frontend + api/ deployed together)
  //     -> a relative path: 'api/index.php'
  //   - split-origin (frontend on Render, API on cPanel/Namecheap)
  //     -> the API's full URL: 'https://api.zetclass.com/api/index.php'
  // useApi stays false (Local/localStorage mode) until the PHP API + MySQL
  // deployment above is live and reachable at API_BASE.
  var API_BASE = 'api/index.php';
  window.DB_CONFIG = { useApi: false, apiBase: API_BASE };
</script>
```

There is no build step or bundler in this app (dependency-free vanilla JS by
design — see the project's standing rules), so there is no environment-variable
injection at deploy time. Switching environments means editing these two lines
directly before publishing:

| Environment | `useApi` | `API_BASE` |
|---|---|---|
| Local dev, no server | `false` | *(unused)* |
| Local dev against `php -S` (same machine) | `true` | `'api/index.php'` |
| Render (frontend) + cPanel (API), split-origin | `true` | `'https://api.zetclass.com/api/index.php'` |
| Single PHP host serving both frontend + API | `true` | `'api/index.php'` |

Path-based routing (`/school/:slug/...`, `/admin/...` — see `app.js`) only
activates once `DB.isApi` is true; it has no effect in Local mode.

## 4. What is NOT yet done

- The PHP host's own SPA-fallback rewrite (equivalent to `render.yaml`'s
  `routes: [{type: rewrite, source: /*, destination: /index.html}]`, needed so
  a hard refresh on `/school/sch-x/students` doesn't 404) is **not yet
  written**. On Apache/cPanel this is a one-line `.htaccess`:
  ```
  RewriteEngine On
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteRule ^ index.html [L]
  ```
  Add this to the frontend's document root if/when the frontend itself is
  ever hosted on the same PHP host (same-origin layout, §2). It is not needed
  on Render (already has an equivalent rewrite) and not needed for a
  split-origin API-only PHP host (no HTML is served from there).
- Real end-to-end verification of the API on an actual PHP host (see
  `README-ISOLATION.md`'s TEST CHECKLIST) — this sandbox has no PHP
  interpreter, so all API code in this branch has been reviewed statically
  only, not executed.

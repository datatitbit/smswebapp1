# Zetclass — Hosting & App Roadmap (plain-English)

_Last updated: 28 July 2026_

This explains, in simple terms, two decisions we've made and how we upgrade
later as more schools sign up. No jargon.

---

## 1. Where the school data lives

### Now — Shared hosting + MySQL
- We host on cheap shared hosting (e.g. Namecheap cPanel).
- Data is stored in a **MySQL** database (the standard database that comes
  with this kind of hosting).
- This is enough for our first schools and costs very little.

### The one rule we must never break
Every school must only ever see **its own** data.
- Each record already carries a `school_id` (a tag saying which school it
  belongs to).
- MySQL does **not** enforce this automatically, so **our app code must add
  "only this school" to every single data request — and we must test it.**
- This is the single most important thing to get right. A mistake here means
  one school could see another school's data.

### Later — VPS + PostgreSQL (when we're growing)
When we have many paying schools, we move the database to **PostgreSQL** on a
**VPS** (a more powerful server we control) or a managed database service.
- PostgreSQL can enforce the "only your school" rule **itself**, as a safety
  net beneath the app — much safer at scale.
- Nothing built now is wasted: it's an **upgrade, not a restart.** Same
  `school_id` model, stronger enforcement.

**Steps to upgrade the database (later):**
1. Get a VPS (~$7–12/month) or a managed PostgreSQL service (some have free
   tiers to start).
2. Install PostgreSQL.
3. Copy the data across from MySQL.
4. Turn on PostgreSQL's per-school security rules (Row-Level Security).
5. Point the app at the new database. Done.

---

## 2. How users get the app

### Now — Progressive Web App (PWA) ✅ just added
The app is now an **installable website**:
- Parents and teachers can **"Add to Home Screen"** and it opens like a normal
  app.
- It **loads offline** once it has been opened online at least once (good for
  areas with poor connectivity).
- **One codebase** serves the big admin screens *and* phones.
- We sell subscriptions on the web (Mobile Money / Paystack) — **no app-store
  fees.**
- Updates go live **instantly** — no app-store review wait.

**What we added:** an app icon (`icon.svg`), a "manifest"
(`manifest.webmanifest`, makes it installable), and a "service worker"
(`sw.js`, makes it load offline). The service worker uses **network-first**
loading, so an online user always gets the latest version.

**Optional finishing touch:** add PNG icon sizes (192px and 512px) for the
nicest icon on every phone, especially iPhone. Not required to work — just
polish.

### Later — optional app-store version (only if needed)
If we ever want a listing on Google Play / the Apple App Store, we **wrap the
same app** (using a tool like Capacitor) — we do **not** rebuild it.
- Reuses ~100% of what we already have.
- Keep selling subscriptions on our website to avoid app-store fees
  (the "manage your subscription online" approach).

**When to consider it:** if we need stronger iPhone notifications, or a store
listing for marketing / trust.

---

## When to upgrade — quick guide

| Signal | Action |
|---|---|
| A few schools, keeping costs low | Stay on MySQL shared hosting |
| Many paying schools / heavy use | Move database to PostgreSQL (VPS or managed) |
| A big client demands their data kept fully separate | Give that client their own database |
| Need app-store presence or better iPhone push | Wrap the PWA with Capacitor — no rebuild |

---

## The bigger "later" work (tied to the MySQL backend)

The PWA added now makes the app **install and load offline** using its current
storage. The richer offline features come **after** the MySQL backend is built:

- **Offline data sync** — a teacher marks attendance with no signal, and it
  uploads automatically when the network returns. (Needs the backend + a small
  storage upgrade from `localStorage` to IndexedDB.)
- **Push notifications** — fee reminders, absence alerts. (Needs the backend.)

These are planned, not done yet — listed here so the sequence is clear:
**backend + per-school security first, then offline sync and push.**

---

## Mini-glossary

- **MySQL / PostgreSQL** — two databases (filing systems for data). PostgreSQL
  has stronger built-in safety for multi-school setups.
- **Shared hosting** — a cheap rented slice of a server. **VPS** — your own
  bigger server that you control.
- **school_id** — a tag on every record marking which school it belongs to.
- **PWA (Progressive Web App)** — a website that installs and behaves like a
  phone app, works offline, and can send notifications.
- **Service worker / manifest** — the two small files that make a website
  installable and offline-capable.
- **Capacitor** — a tool that wraps a website into an app-store app without
  rebuilding it.
- **Row-Level Security** — a PostgreSQL feature that makes the database itself
  guarantee each school only sees its own data.

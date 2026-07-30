/* ============================================================
 * app.js — App shell, session/role, router, permission gating.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB;

  var MODULES = global.SMS_SEED.constants.MODULES;
  var ICONS = {
    Dashboard: '▤', Students: '👥', Assessment: '✎', Finance: '₵', Attendance: '✓',
    Communication: '✉', Administration: '⚙', Inventory: '▦',
    Accounting: '∑', Payroll: '💼', Settings: '⚙', Subscription: '★'
  };
  var ROUTES = {
    Dashboard: 'dashboard', Students: 'students', Assessment: 'assessment', Finance: 'finance',
    Attendance: 'attendance', Communication: 'communication', Administration: 'administration',
    Inventory: 'inventory', Accounting: 'accounting', Payroll: 'payroll', Settings: 'settings', Subscription: 'subscription'
  };

  // Last-resort fallback only — used if the `permissions` collection is
  // completely empty/unreadable (e.g. a corrupted install). The real default
  // lives in seed.js's `permissions` object; normalisePerms() below reads that
  // directly so there is exactly one authored source of truth for defaults.
  // Kept here in the same shape as seed.js for the rare case both are needed.
  function defaultPerms() {
    function mk(list) { var o = {}; MODULES.forEach(function (m) { o[m] = list.indexOf(m) !== -1; }); return o; }
    return {
      'Admin': mk(MODULES),
      'Director': mk(MODULES.filter(function (m) { return m !== 'Settings'; })),
      'Teacher': mk(['Dashboard', 'Students', 'Assessment', 'Attendance']),
      'Other staff': mk(['Dashboard', 'Students', 'Finance', 'Communication', 'Administration', 'Inventory', 'Accounting', 'Payroll']),
      'Parent': mk(['Dashboard', 'Students', 'Assessment', 'Finance', 'Attendance', 'Communication'])
    };
  }

  var App = {
    ctx: {},        // cached settings/context
    user: null,
    permissions: {},
    license: null,  // licence/trial state, set at boot by License.resolve()
    // API mode only: the current session's school id (from the login response —
    // never client-chosen after login) and optional URL-slug hints a router can
    // set BEFORE start()/chooseRoleApi() run, purely to pre-fill the login form.
    schoolId: null,
    schoolIdHint: null,
    schoolSlugLabel: null,
    // API mode only: set when a background request comes back 403 (subscription
    // inactive) — rendered as a persistent banner until the page is reloaded.
    forbiddenMessage: null,
    // View-only roles: Parent and Director can view & download but never edit.
    get readOnly() { return App.user && (App.user.role === 'Parent' || App.user.role === 'Director'); },
    // When the free trial / subscription has lapsed the whole app becomes read-only.
    get locked() { return !!(App.license && App.license.locked); }
  };

  // ---- Load shared context (settings used everywhere) ----
  App.refresh = function () {
    return Promise.all([
      DB.singleton('school'), DB.singleton('academic'), DB.singleton('idRules'),
      DB.singleton('weighting'), DB.singleton('labels'),
      DB.all('permissions'), DB.all('gradeBands'), DB.all('categories'),
      DB.all('classes'), DB.all('reportTemplates'), DB.all('feeTypes'), DB.all('parents'),
      DB.singleton('admissionFields'), DB.all('staff'), DB.singleton('dashboardSettings')
    ]).then(function (r) {
      App.ctx = {
        school: r[0], academic: r[1], idRules: r[2], weighting: r[3], labels: r[4],
        gradeBands: r[6], categories: r[7], classes: r[8], reportTemplates: r[9], feeTypes: r[10], parents: r[11],
        admissionFields: (Array.isArray(r[12]) && r[12].length) ? r[12] : JSON.parse(JSON.stringify(global.SMS_SEED.admissionFields || [])),
        staff: r[13] || [],
        dashboardSettings: r[14] || JSON.parse(JSON.stringify(global.SMS_SEED.dashboardSettings))
      };
      // permissions stored as array of {role, perms} OR object — normalise
      App.permissions = normalisePerms(r[5]);
      applyTheme(App.ctx.school);
      return App.ctx;
    });
  };

  // ---- Per-school theme colors (Settings -> Profile -> Branding) ----
  // Custom branding is OFF by default (theme_enabled: false) — the app, admission
  // forms and printed reports keep the standard Zetranova look until an admin
  // turns it on AND has set valid colors. Derived shades come from U.shade() so
  // a client only has to pick three swatches, not every CSS variable individually.
  var DEFAULT_THEME = { primary: '#0f5e5e', secondary1: '#e0ab2b', secondary2: '#1c6b6b' };
  function resolveTheme(school) {
    var on = !!(school && school.theme_enabled) && U.isHexColor(school.theme_primary);
    return {
      primary: on ? school.theme_primary : DEFAULT_THEME.primary,
      secondary1: (on && U.isHexColor(school.theme_secondary1)) ? school.theme_secondary1 : DEFAULT_THEME.secondary1,
      secondary2: (on && U.isHexColor(school.theme_secondary2)) ? school.theme_secondary2 : DEFAULT_THEME.secondary2
    };
  }
  function applyTheme(school) {
    if (!school || !U.shade) return;
    var t = resolveTheme(school);
    var root = document.documentElement.style;
    root.setProperty('--teal', t.primary);
    root.setProperty('--teal-dark', U.shade(t.primary, -0.3));
    root.setProperty('--teal-deep', U.shade(t.primary, -0.5));
    root.setProperty('--teal-mid', U.shade(t.primary, 0.15));
    root.setProperty('--teal-light', U.shade(t.primary, 0.88));
    root.setProperty('--gold', t.secondary1);
    root.setProperty('--gold-dark', U.shade(t.secondary1, -0.25));
    root.setProperty('--gold-soft', U.shade(t.secondary1, 0.82));
    root.setProperty('--sec2', t.secondary2);
    root.setProperty('--sec2-dark', U.shade(t.secondary2, -0.25));
  }
  App.themeHex = function () {
    var t = resolveTheme(App.ctx.school || {});
    return { primary: t.primary, accent: t.secondary1, secondary1: t.secondary1, secondary2: t.secondary2 };
  };

  function normalisePerms(p) {
    if (Array.isArray(p) && p.length) {
      var o = {}; p.forEach(function (row) { o[row.role] = row.perms; });
      if (Object.keys(o).length) return o;
    } else if (p && typeof p === 'object' && Object.keys(p).length) {
      // seed.js ships `permissions` as a plain {role: {module: bool}} object —
      // this is the real, single-authored default until Settings -> Roles is
      // first saved (which then persists it as the {role,perms} array shape).
      return p;
    }
    return defaultPerms();
  }

  // The parents record backing the signed-in Parent user (matched by linked ward).
  function parentRecordFor(user) {
    var ids = (user && user.linked_student_ids) || [];
    return (App.ctx.parents || []).filter(function (p) {
      return (p.student_ids || []).some(function (c) { return ids.indexOf(c) !== -1; });
    })[0];
  }
  App.parentRecord = function () { return parentRecordFor(App.user); };

  App.can = function (module) {
    if (!App.user) return false;
    if (App.user.role === 'Admin') return true;      // Admin always full
    if (module === 'Subscription') return App.user.role === 'Director'; // Admin above; Director may view
    if (App.user.role === 'Parent') {
      // Admin can switch OFF an individual parent's portal (Students → Parents).
      var pr = parentRecordFor(App.user);
      if (pr && pr.portal_enabled === false) return false;
    }
    var perms = App.permissions[App.user.role] || {};
    return !!perms[module];
  };

  // Can this role EDIT (create/update/delete) in the given module?
  App.canEdit = function (module) {
    if (!App.user) return false;
    if (App.locked) return false;                 // trial/subscription lapsed → read-only
    var role = App.user.role;
    if (role === 'Admin') return true;                         // edit everywhere
    if (role === 'Director' || role === 'Parent') return false; // view / download only
    if (role === 'Teacher') return module === 'Assessment' || module === 'Attendance';
    if (role === 'Other staff') return ['Finance', 'Accounting', 'Payroll', 'Inventory', 'Students', 'Administration'].indexOf(module) !== -1;
    return false;
  };

  // The staff record linked to the signed-in user (via staff_id) — the single
  // source of truth for a teacher's class-teacher / subject-teacher assignments.
  App.myStaff = function () {
    if (!App.user || !App.user.staff_id) return null;
    return (App.ctx.staff || []).filter(function (s) { return s.staff_id === App.user.staff_id; })[0] || null;
  };
  // Classes this Teacher can act on: class-teacher assignments (whole class,
  // all subjects) unioned with the classes covered by their subject-teacher
  // assignments (one subject, one or more classes).
  App.teacherClassIds = function () {
    var st = App.myStaff();
    var ids = (st && st.class_ids) || App.user.class_ids || [];
    var subj = (st && st.subject_teacher_of) || [];
    subj.forEach(function (a) { (a.class_ids || []).forEach(function (id) { if (ids.indexOf(id) === -1) ids.push(id); }); });
    return ids;
  };
  // Subjects a Teacher may enter for a given class: all of them if they are
  // the class teacher there, otherwise only the subjects assigned to them.
  App.teacherSubjectsFor = function (classId) {
    var st = App.myStaff();
    if (!st) return null; // null = no restriction (non-staff-linked teacher account)
    if ((st.class_ids || []).indexOf(classId) !== -1) return null; // class teacher — all subjects
    var subj = (st.subject_teacher_of || []).filter(function (a) { return (a.class_ids || []).indexOf(classId) !== -1; }).map(function (a) { return a.subject; });
    return subj; // restricted list (possibly empty)
  };

  // Full dashboard (Finance KPIs + enrolment/attendance) is open to Admin,
  // Director, Other staff (Account/Finance office) by default, plus any staff
  // member an Admin has explicitly flagged via Administration → Staff.
  // Everyone else with Dashboard access sees the Enrolment & Attendance side only.
  App.canFullDashboard = function () {
    if (!App.user) return false;
    var role = App.user.role;
    if (role === 'Admin' || role === 'Director' || role === 'Other staff') return true;
    var st = App.myStaff();
    return !!(st && st.dashboard_full_access);
  };

  App.className = function (id) {
    var c = (App.ctx.classes || []).filter(function (x) { return x.id === id; })[0];
    return c ? c.name : '—';
  };
  App.termName = function () {
    var a = App.ctx.academic; if (!a) return '';
    var t = (a.terms || []).filter(function (x) { return x.n === a.current_term; })[0];
    return t ? t.name : ('Term ' + a.current_term);
  };

  // ---- Session ----
  // Only non-sensitive fields are persisted; the fresh record (incl. password
  // hash, used only for change-password checks) is re-fetched from DB on boot.
  function loadSession() {
    try { return JSON.parse(localStorage.getItem('sms_session')); } catch (e) { return null; }
  }
  function saveSession(u) {
    localStorage.setItem('sms_session', JSON.stringify({ id: u.id, role: u.role, name: u.name }));
  }
  function clearSession() { localStorage.removeItem('sms_session'); }

  // ---- API-mode session metadata (non-secret: user/role/school_id only).
  // The actual bearer token lives separately in store.js's own storage key,
  // so the adapter can rehydrate itself independently of this file.
  var API_SESSION_KEY = 'sms_api_session_meta';
  function loadApiSessionMeta() {
    try { return JSON.parse(localStorage.getItem(API_SESSION_KEY)); } catch (e) { return null; }
  }
  function saveApiSessionMeta(meta) {
    try { localStorage.setItem(API_SESSION_KEY, JSON.stringify(meta)); } catch (e) {}
  }
  function clearApiSessionMeta() { try { localStorage.removeItem(API_SESSION_KEY); } catch (e) {} }

  function initials(name) {
    return (name || 'School').split(/\s+/).slice(0, 3).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function logout() {
    if (DB.isApi) {
      DB.apiLogout().then(function () {
        App.user = null; App.schoolId = null; App.forbiddenMessage = null;
        clearApiSessionMeta(); chooseRoleApi();
      });
      return;
    }
    App.user = null; clearSession(); chooseRole();
  }

  // ---- API mode: global 401/403 handling ----
  // Registered unconditionally (harmless in local mode — ApiAdapter is never
  // instantiated there, so these callbacks simply never fire).
  global.DB_CONFIG = global.DB_CONFIG || {};
  global.DB_CONFIG.onUnauthorized = function () {
    clearApiSessionMeta();
    App.user = null; App.schoolId = null; App.forbiddenMessage = null;
    if (U && U.toast) U.toast('Your session has expired. Please sign in again.', 'warn');
    chooseRoleApi();
  };
  global.DB_CONFIG.onForbidden = function (message) {
    App.forbiddenMessage = message || "This school's subscription is inactive.";
    if (App.user && App.ctx && App.ctx.school) { renderShell(); router(); }
    else if (U && U.toast) U.toast(App.forbiddenMessage, 'err');
  };

  // Fingerprint of each seeded demo account's UNCHANGED password hash -> its known
  // demo password. These 5 passwords are already public (README, seed.js comments) —
  // fine to auto-fill for convenience. The moment any of these 5 accounts' password is
  // reset or changed (by anyone, on any device), its stored hash changes forever and
  // stops matching here, so auto-fill silently and permanently stops for that account.
  // It never applies to accounts the school creates itself (Settings -> Access Control).
  var DEMO_CREDS = {
    'u-admin':   { hash: '5e53a758512b9074082dfd890884eba14d56061b728d130ef2a23eb1e3ecb764', password: 'admin123' },
    'u-dir':     { hash: '84fe3ec4a95b5e494b3948ee202fa54fbfeab91ba4e9c18d6ab7a84f6c74719c', password: 'director123' },
    'u-teacher': { hash: 'c7ec5397a81a36e91c3ec1133215f98381e1c46b0cca0868906f80f7be4587da', password: 'teacher123' },
    'u-staff':   { hash: '119570daabe181e0cfbebf03cc76afcccc5d6bf1721b7b1d8902102ed146b019', password: 'staff123' },
    'u-parent':  { hash: 'ba3af436dd8f9363645143b03709483a4ea07da9b6b7fe7c43cb541617ece706', password: 'parent123' }
  };
  function knownDemoPassword(user) {
    var d = user && DEMO_CREDS[user.id];
    return (d && d.hash === user.password_hash) ? d.password : null;
  }

  // Try a password against every account sharing a role (no separate "which user" step —
  // the password itself, individually salted/hashed per account, identifies the account).
  // Note: if two people on the same role pick the same password, whichever is checked
  // first wins the ambiguity — schools should keep each person's password unique.
  function verifyAgainstAny(candidates, password) {
    function tryNext(i) {
      if (i >= candidates.length) return Promise.resolve(null);
      var u = candidates[i];
      return global.Auth.verifyPassword(password, u.password_salt, u.password_hash).then(function (ok) {
        return ok ? u : tryNext(i + 1);
      });
    }
    return tryNext(0);
  }

  // ---- Login: school name + user type + password (per-account, PBKDF2-hashed) ----
  function chooseRole() {
    DB.all('users').then(function (users) {
      var root = U.clear(U.$('#root'));
      var wrap = U.el('div', { class: 'login-wrap' });
      var card = U.el('div', { class: 'card' });
      var sName = App.ctx.school ? App.ctx.school.name : 'School Management System';
      card.appendChild(U.el('div', { class: 'login-badge', text: initials(sName) }));
      card.appendChild(U.el('h1', { text: sName }));
      card.appendChild(U.el('p', { class: 'muted', text: 'Sign in with your school name, user type, and password.' }));

      var errBox = U.el('div', { class: 'login-error', style: 'display:none;color:#b3261e;font-size:.85rem;margin:.4rem 0' });

      function field(labelText, inputEl) { return U.el('div', { class: 'field' }, [U.el('label', { text: labelText }), inputEl]); }

      var schoolInput = U.el('input', { type: 'text', autocomplete: 'organization', value: sName });
      var roleSelect = U.el('select');
      roleSelect.appendChild(U.el('option', { value: '', text: 'Select user type…' }));
      var rolesSeen = [];
      users.forEach(function (u) { if (rolesSeen.indexOf(u.role) === -1) rolesSeen.push(u.role); });
      rolesSeen.forEach(function (r) { roleSelect.appendChild(U.el('option', { value: r, text: r })); });

      var passInput = U.el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });

      // If exactly one account for the chosen role is still on its untouched demo
      // password, fill it in — the user can still overwrite it with a real password.
      roleSelect.addEventListener('change', function () {
        var matches = users.filter(function (u) { return u.role === roleSelect.value; });
        var demoMatches = matches.map(knownDemoPassword).filter(Boolean);
        passInput.value = (demoMatches.length === 1) ? demoMatches[0] : '';
      });

      function showError(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }

      var submitBtn = U.el('button', { class: 'btn gold', type: 'submit', text: 'Sign in' });
      function doLogin(e) {
        if (e) e.preventDefault();
        errBox.style.display = 'none';
        var schoolVal = schoolInput.value.trim();
        var roleVal = roleSelect.value;
        var passVal = passInput.value;
        if (!schoolVal || !roleVal || !passVal) { showError('Please fill in all fields.'); return; }
        var realSchoolName = ((App.ctx.school && App.ctx.school.name) || '').trim();
        if (schoolVal.toLowerCase() !== realSchoolName.toLowerCase()) {
          showError('Incorrect school name, user type, or password.'); return;
        }
        var candidates = users.filter(function (u) { return u.role === roleVal; });
        submitBtn.disabled = true; submitBtn.textContent = 'Signing in…';
        verifyAgainstAny(candidates, passVal).then(function (user) {
          submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
          if (!user) { showError('Incorrect school name, user type, or password.'); return; }
          App.user = user; saveSession(user); boot();
        });
      }

      var form = U.el('form', { class: 'form login-form', onsubmit: doLogin });
      form.appendChild(errBox);
      form.appendChild(field('School name', schoolInput));
      form.appendChild(field('User type', roleSelect));
      form.appendChild(field('Password', passInput));
      form.appendChild(submitBtn);

      card.appendChild(form);
      wrap.appendChild(card);
      root.appendChild(wrap);
      roleSelect.focus();
    });
  }

  // ---- Change password (self-service; also used after an admin reset) ----
  function openChangePasswordModal() {
    var body = U.el('div');
    var cur = U.el('input', { type: 'password', placeholder: 'Current password' });
    var next = U.el('input', { type: 'password', placeholder: 'New password (min 6 characters)' });
    var next2 = U.el('input', { type: 'password', placeholder: 'Confirm new password' });
    function field(l, i) { return U.el('div', { class: 'field' }, [U.el('label', { text: l }), i]); }
    body.appendChild(field('Current password', cur));
    body.appendChild(field('New password', next));
    body.appendChild(field('Confirm new password', next2));
    var errBox = U.el('div', { style: 'color:#b3261e;font-size:.85rem;display:none' });
    body.appendChild(errBox);
    U.modal({
      title: 'Change password', body: body,
      actions: [
        { label: 'Cancel', onClick: function (c) { c(); } },
        { label: 'Save', kind: 'gold', onClick: function (c) {
          errBox.style.display = 'none';
          if (next.value.length < 6) { errBox.textContent = 'New password must be at least 6 characters.'; errBox.style.display = 'block'; return; }
          if (next.value !== next2.value) { errBox.textContent = 'New passwords do not match.'; errBox.style.display = 'block'; return; }
          // Re-fetch the full record for the CURRENT-password check: in API mode
          // App.user came from the login response, which deliberately omits
          // password_salt/password_hash (never sent over the wire at login).
          DB.get('users', App.user.id).then(function (fullUser) {
            return global.Auth.verifyPassword(cur.value, fullUser && fullUser.password_salt, fullUser && fullUser.password_hash);
          }).then(function (ok) {
            if (!ok) { errBox.textContent = 'Current password is incorrect.'; errBox.style.display = 'block'; return; }
            return global.Auth.hashPassword(next.value).then(function (r) {
              return DB.update('users', App.user.id, { password_salt: r.salt, password_hash: r.hash, must_change_password: false });
            }).then(function (u) {
              App.user = u;
              if (DB.isApi) { saveApiSessionMeta({ user: u, school_id: App.schoolId, role: u.role }); }
              else { saveSession(u); }
              U.toast('Password changed.'); c(); renderShell(); router();
            });
          });
        } }
      ]
    });
  }

  function accountMenu() {
    var body = U.el('div', { class: 'role-grid' });
    body.appendChild(U.el('button', { text: 'Change password', onclick: function () { m.close(); openChangePasswordModal(); } }));
    body.appendChild(U.el('button', { text: 'Log out', onclick: function () { m.close(); logout(); } }));
    var m = U.modal({ title: App.user.name + ' (' + App.user.role + ')', body: body, actions: [{ label: 'Close', onClick: function (c) { c(); } }] });
  }

  // ---- Licence/trial banner ----
  function licenseBanner() {
    var lic = App.license; if (!lic || lic.state === 'active') return null;
    var trial = lic.state === 'trialing';
    var style = 'display:flex;gap:.6rem;align-items:center;justify-content:center;padding:.45rem .8rem;font-size:.85rem;font-weight:600;flex-wrap:wrap;'
      + (trial ? 'background:#fff7e6;color:#7a5b00;border-bottom:1px solid #f0d98c' : 'background:#fde8e8;color:#8a1c1c;border-bottom:1px solid #f3b4b4');
    var msg = trial
      ? 'Free trial — ' + (lic.daysLeft >= 0 ? lic.daysLeft : 0) + ' day' + (lic.daysLeft === 1 ? '' : 's') + ' left'
      : 'Your trial has ended — the app is read-only until a licence is activated.';
    var bar = U.el('div', { style: style }, [U.el('span', { text: msg })]);
    if (App.user && App.user.role === 'Admin') bar.appendChild(U.el('button', { class: 'btn sm', text: trial ? 'Manage subscription' : 'Activate now', onclick: function () { location.hash = '#/subscription'; } }));
    return bar;
  }

  function passwordBanner() {
    if (!App.user || !App.user.must_change_password) return null;
    var style = 'display:flex;gap:.6rem;align-items:center;justify-content:center;padding:.45rem .8rem;font-size:.85rem;font-weight:600;flex-wrap:wrap;background:#fde8e8;color:#8a1c1c;border-bottom:1px solid #f3b4b4';
    var bar = U.el('div', { style: style }, [U.el('span', { text: 'You are using a default password — please change it.' })]);
    bar.appendChild(U.el('button', { class: 'btn sm', text: 'Change password', onclick: openChangePasswordModal }));
    return bar;
  }

  // ---- API mode: subscription-inactive banner (set by DB_CONFIG.onForbidden) ----
  function forbiddenBanner() {
    if (!App.forbiddenMessage) return null;
    var style = 'display:flex;gap:.6rem;align-items:center;justify-content:center;padding:.45rem .8rem;font-size:.85rem;font-weight:600;flex-wrap:wrap;background:#fde8e8;color:#8a1c1c;border-bottom:1px solid #f3b4b4';
    return U.el('div', { style: style }, [U.el('span', { text: App.forbiddenMessage })]);
  }

  // ---- Shell ----
  function renderShell() {
    var root = U.clear(U.$('#root'));

    var topbar = U.el('div', { class: 'topbar' }, [
      U.el('button', { class: 'menu-btn', html: '&#9776;', 'aria-label': 'Menu', onclick: toggleSidebar }),
      U.el('div', { class: 'school-name' }, [
        document.createTextNode(App.ctx.school.name),
        U.el('small', { text: App.ctx.academic.year + ' · ' + App.termName() })
      ]),
      U.el('div', { class: 'spacer' }),
      U.el('button', { class: 'role-pill', text: App.user.name + ' (' + App.user.role + ') ▾', onclick: accountMenu })
    ]);

    var sidebar = U.el('div', { class: 'sidebar', id: 'sidebar' });
    sidebar.appendChild(U.el('div', { class: 'brand', text: 'SMS · ' + (App.ctx.school.motto || '') }));
    var nav = U.el('nav');
    MODULES.forEach(function (m) {
      var allowed = App.can(m);
      var a = U.el('a', { href: '#/' + ROUTES[m], class: allowed ? '' : 'disabled', 'data-mod': m }, [
        U.el('span', { class: 'ico', text: ICONS[m] || '•' }),
        document.createTextNode(m)
      ]);
      if (!allowed) a.addEventListener('click', function (e) { e.preventDefault(); U.toast('Your role cannot access ' + m, 'warn'); });
      else a.addEventListener('click', closeSidebar);
      nav.appendChild(a);
    });
    if (App.user.role === 'Admin' || App.user.role === 'Director') {
      var subA = U.el('a', { href: '#/subscription', 'data-mod': 'Subscription' }, [U.el('span', { class: 'ico', text: ICONS.Subscription }), document.createTextNode('Subscription')]);
      subA.addEventListener('click', closeSidebar);
      nav.appendChild(subA);
    }
    sidebar.appendChild(nav);
    sidebar.appendChild(U.el('div', { style: 'margin-top:auto;padding:1rem;font-size:.72rem;opacity:.6', text: 'v1.0 · ' + (DB.isApi ? 'API mode' : 'Local mode') }));

    var backdrop = U.el('div', { class: 'backdrop', id: 'backdrop', onclick: closeSidebar });
    var main = U.el('main', { class: 'main', id: 'view' });

    root.appendChild(topbar);
    var lb = licenseBanner(); if (lb) root.appendChild(lb);
    var pb = passwordBanner(); if (pb) root.appendChild(pb);
    var fb = forbiddenBanner(); if (fb) root.appendChild(fb);
    root.appendChild(sidebar);
    root.appendChild(backdrop);
    root.appendChild(main);
  }

  function toggleSidebar() { U.$('#sidebar').classList.toggle('open'); U.$('#backdrop').classList.toggle('show'); }
  function closeSidebar() { var s = U.$('#sidebar'); if (s) { s.classList.remove('open'); U.$('#backdrop').classList.remove('show'); } }

  function setActive(route) {
    U.$all('.sidebar a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#/' + route);
    });
  }

  // ---- Router ----
  function router() {
    var hash = (location.hash || '#/dashboard').replace(/^#\//, '');
    var parts = hash.split('/');
    var route = parts[0] || 'dashboard';
    // find module for route
    var module = Object.keys(ROUTES).filter(function (k) { return ROUTES[k] === route; })[0];
    if (!module) { location.hash = '#/dashboard'; return; }
    if (!App.can(module)) { U.toast('No access to ' + module, 'warn'); location.hash = '#/dashboard'; return; }
    setActive(route);
    var view = global.Views[route];
    var container = U.clear(U.$('#view'));
    if (!view) { container.appendChild(U.el('div', { class: 'placeholder-page', text: 'Module not found.' })); return; }
    container.appendChild(U.el('div', { class: 'loader', text: 'Loading…' }));
    Promise.resolve(view.render(container, parts.slice(1))).catch(function (e) {
      console.error(e);
      U.clear(container).appendChild(U.el('div', { class: 'card', html: '<h3>Something went wrong</h3><pre style="white-space:pre-wrap">' + U.esc(e.message || e) + '</pre>' }));
    });
  }

  function boot() {
    App.refresh().then(function () {
      return (global.License ? global.License.resolve() : Promise.resolve(null));
    }).then(function (lic) {
      App.license = lic;
      renderShell();
      router();
      // Automation "night clerk": routine admin done automatically (Settings → Automation).
      if (global.Automation) {
        global.Automation.runAll().then(function (acts) {
          if (acts && acts.length) router(); // re-render current view with fresh data
        }).catch(function (e) { console.error('Automation error:', e); });
      }
    }).catch(function (e) {
      // In API mode, a 401 on the very first authenticated call (expired/invalid
      // saved token) already triggered onUnauthorized above — this just stops it
      // from surfacing as a noisy unhandled promise rejection.
      console.error('Boot error:', e);
    });
  }

  // ---- API-mode login screen: School ID + Username + Password ----
  // Distinct from chooseRole() (local mode) because the two modes have genuinely
  // different trust models: local mode's browser already holds every account's
  // data, so guessing a role and trying its password client-side costs nothing.
  // API mode must not fetch other users' password hashes to the client just to
  // guess among them — it needs a real username, verified server-side.
  function chooseRoleApi() {
    var root = U.clear(U.$('#root'));
    var wrap = U.el('div', { class: 'login-wrap' });
    var card = U.el('div', { class: 'card' });
    var label = App.schoolSlugLabel || 'School Management System';
    card.appendChild(U.el('div', { class: 'login-badge', text: initials(label) }));
    card.appendChild(U.el('h1', { text: label }));
    card.appendChild(U.el('p', { class: 'muted', text: 'Sign in to your school portal.' }));

    var errBox = U.el('div', { class: 'login-error', style: 'display:none;color:#b3261e;font-size:.85rem;margin:.4rem 0' });
    function field(labelText, inputEl) { return U.el('div', { class: 'field' }, [U.el('label', { text: labelText }), inputEl]); }

    // school_id is only ever a LOOKUP HINT for the login call (pre-filled by a
    // URL-slug router when present) — the server never trusts it for anything
    // beyond finding this school's user by username; every route after login
    // is scoped purely by the signed token, never by anything the client sends.
    var schoolInput = U.el('input', { type: 'text', value: App.schoolIdHint || '', placeholder: 'e.g. sch-stmarys' });
    var userInput = U.el('input', { type: 'text', autocomplete: 'username', placeholder: 'Username' });
    var passInput = U.el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });

    function showError(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }

    var submitBtn = U.el('button', { class: 'btn gold', type: 'submit', text: 'Sign in' });
    function doLogin(e) {
      if (e) e.preventDefault();
      errBox.style.display = 'none';
      var schoolVal = schoolInput.value.trim();
      var userVal = userInput.value.trim();
      var passVal = passInput.value;
      if (!userVal || !passVal) { showError('Please enter your username and password.'); return; }
      submitBtn.disabled = true; submitBtn.textContent = 'Signing in…';
      DB.apiLogin(userVal, passVal, schoolVal).then(function (res) {
        submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
        App.user = res.user; App.schoolId = res.school_id; App.forbiddenMessage = null;
        saveApiSessionMeta({ user: res.user, school_id: res.school_id, role: res.role });
        boot();
      }).catch(function (err) {
        submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
        showError((err && err.message) || 'Incorrect username, password, or school.');
      });
    }

    var form = U.el('form', { class: 'form login-form', onsubmit: doLogin });
    form.appendChild(errBox);
    form.appendChild(field('School ID', schoolInput));
    form.appendChild(field('Username', userInput));
    form.appendChild(field('Password', passInput));
    form.appendChild(submitBtn);

    card.appendChild(form);
    wrap.appendChild(card);
    root.appendChild(wrap);
    userInput.focus();
  }

  global.App = App;
  global.Views = global.Views || {};

  window.addEventListener('hashchange', function () { if (App.user) router(); });
  window.addEventListener('DOMContentLoaded', start);
  function start() {
    if (DB.isApi) { startApi(); return; }
    App.refresh().then(function () {
      var s = loadSession();
      if (s) {
        // re-fetch fresh user record
        DB.all('users').then(function (users) {
          var u = users.filter(function (x) { return x.id === s.id; })[0] || s;
          App.user = u; boot();
        });
      } else chooseRole();
    });
  }

  // API mode: NEVER call App.refresh() before a token exists — every route it
  // touches (school/academic/etc.) requires Authorization, and there is no
  // token yet on a fresh visit. Restore a saved session's metadata (if any)
  // and let boot() -> App.refresh() be the first authenticated call; a stale
  // token surfaces there as a 401 and onUnauthorized routes back to login.
  function startApi() {
    var meta = loadApiSessionMeta();
    if (meta && DB.hasApiToken()) {
      App.user = meta.user; App.schoolId = meta.school_id;
      boot();
    } else {
      chooseRoleApi();
    }
  }
  // In case DOMContentLoaded already fired
  if (document.readyState !== 'loading') start();
})(window);

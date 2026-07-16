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
      DB.all('classes'), DB.all('reportTemplates'), DB.all('feeTypes'), DB.all('parents')
    ]).then(function (r) {
      App.ctx = {
        school: r[0], academic: r[1], idRules: r[2], weighting: r[3], labels: r[4],
        gradeBands: r[6], categories: r[7], classes: r[8], reportTemplates: r[9], feeTypes: r[10], parents: r[11]
      };
      // permissions stored as array of {role, perms} OR object — normalise
      App.permissions = normalisePerms(r[5]);
      applyTheme(App.ctx.school);
      return App.ctx;
    });
  };

  // ---- Per-school theme colors (Settings -> Profile -> Branding) ----
  // Empty theme_primary/theme_accent => the shipped deep-teal/warm-gold brand.
  // Derived shades are computed from the two picked colors so a client only
  // has to choose two swatches, not every CSS variable individually.
  var DEFAULT_THEME = { primary: '#0f5e5e', accent: '#e0ab2b' };
  function applyTheme(school) {
    if (!school || !U.shade) return;
    var primary = U.isHexColor(school.theme_primary) ? school.theme_primary : DEFAULT_THEME.primary;
    var accent = U.isHexColor(school.theme_accent) ? school.theme_accent : DEFAULT_THEME.accent;
    var root = document.documentElement.style;
    root.setProperty('--teal', primary);
    root.setProperty('--teal-dark', U.shade(primary, -0.3));
    root.setProperty('--teal-deep', U.shade(primary, -0.5));
    root.setProperty('--teal-mid', U.shade(primary, 0.15));
    root.setProperty('--teal-light', U.shade(primary, 0.88));
    root.setProperty('--gold', accent);
    root.setProperty('--gold-dark', U.shade(accent, -0.25));
    root.setProperty('--gold-soft', U.shade(accent, 0.82));
  }
  App.themeHex = function () {
    var school = App.ctx.school || {};
    return {
      primary: U.isHexColor(school.theme_primary) ? school.theme_primary : DEFAULT_THEME.primary,
      accent: U.isHexColor(school.theme_accent) ? school.theme_accent : DEFAULT_THEME.accent
    };
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

  function initials(name) {
    return (name || 'School').split(/\s+/).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
  }

  function logout() { App.user = null; clearSession(); chooseRole(); }

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

      var schoolInput = U.el('input', { type: 'text', autocomplete: 'organization', placeholder: sName });
      var roleSelect = U.el('select');
      roleSelect.appendChild(U.el('option', { value: '', text: 'Select user type…' }));
      var rolesSeen = [];
      users.forEach(function (u) { if (rolesSeen.indexOf(u.role) === -1) rolesSeen.push(u.role); });
      rolesSeen.forEach(function (r) { roleSelect.appendChild(U.el('option', { value: r, text: r })); });

      var nameSelect = U.el('select', { disabled: true });
      nameSelect.appendChild(U.el('option', { value: '', text: 'Select user type first…' }));

      var passInput = U.el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' });

      roleSelect.addEventListener('change', function () {
        U.clear(nameSelect);
        var matches = users.filter(function (u) { return u.role === roleSelect.value; });
        if (!matches.length) {
          nameSelect.appendChild(U.el('option', { value: '', text: 'No accounts found' }));
          nameSelect.disabled = true;
          return;
        }
        matches.forEach(function (u) { nameSelect.appendChild(U.el('option', { value: u.id, text: u.name })); });
        nameSelect.disabled = false;
        if (matches.length === 1) nameSelect.value = matches[0].id;
      });

      function showError(msg) { errBox.textContent = msg; errBox.style.display = 'block'; }

      var submitBtn = U.el('button', { class: 'btn gold', type: 'submit', text: 'Sign in' });
      function doLogin(e) {
        if (e) e.preventDefault();
        errBox.style.display = 'none';
        var schoolVal = schoolInput.value.trim();
        var roleVal = roleSelect.value;
        var userId = nameSelect.value;
        var passVal = passInput.value;
        if (!schoolVal || !roleVal || !userId || !passVal) { showError('Please fill in all fields.'); return; }
        var realSchoolName = ((App.ctx.school && App.ctx.school.name) || '').trim();
        var user = users.filter(function (u) { return u.id === userId && u.role === roleVal; })[0];
        if (schoolVal.toLowerCase() !== realSchoolName.toLowerCase() || !user) {
          showError('Incorrect school name, user type, or password.'); return;
        }
        submitBtn.disabled = true; submitBtn.textContent = 'Signing in…';
        global.Auth.verifyPassword(passVal, user.password_salt, user.password_hash).then(function (ok) {
          submitBtn.disabled = false; submitBtn.textContent = 'Sign in';
          if (!ok) { showError('Incorrect school name, user type, or password.'); return; }
          App.user = user; saveSession(user); boot();
        });
      }

      var form = U.el('form', { class: 'form login-form', onsubmit: doLogin });
      form.appendChild(errBox);
      form.appendChild(field('School name', schoolInput));
      form.appendChild(field('User type', roleSelect));
      form.appendChild(field('Your name', nameSelect));
      form.appendChild(field('Password', passInput));
      form.appendChild(submitBtn);

      card.appendChild(form);
      wrap.appendChild(card);
      root.appendChild(wrap);
      schoolInput.focus();
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
          global.Auth.verifyPassword(cur.value, App.user.password_salt, App.user.password_hash).then(function (ok) {
            if (!ok) { errBox.textContent = 'Current password is incorrect.'; errBox.style.display = 'block'; return; }
            return global.Auth.hashPassword(next.value).then(function (r) {
              return DB.update('users', App.user.id, { password_salt: r.salt, password_hash: r.hash, must_change_password: false });
            }).then(function (u) {
              App.user = u; saveSession(u); U.toast('Password changed.'); c(); renderShell(); router();
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
    if (App.user.role === 'Admin') {
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
    });
  }

  global.App = App;
  global.Views = global.Views || {};

  window.addEventListener('hashchange', function () { if (App.user) router(); });
  window.addEventListener('DOMContentLoaded', start);
  function start() {
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
  // In case DOMContentLoaded already fired
  if (document.readyState !== 'loading') start();
})(window);

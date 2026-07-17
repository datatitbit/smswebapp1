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
      DB.all('classes'), DB.all('reportTemplates'), DB.all('feeTypes'), DB.all('parents'),
      DB.singleton('admissionFields')
    ]).then(function (r) {
      App.ctx = {
        school: r[0], academic: r[1], idRules: r[2], weighting: r[3], labels: r[4],
        gradeBands: r[6], categories: r[7], classes: r[8], reportTemplates: r[9], feeTypes: r[10], parents: r[11],
        admissionFields: (Array.isArray(r[12]) && r[12].length) ? r[12] : JSON.parse(JSON.stringify(global.SMS_SEED.admissionFields || []))
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

  // permissions collection may be an array of {role,perms} rows (current shape)
  // or (rare/legacy) a bare {role:{module:bool}} object. Normalise to the latter
  // for lookups. Falls back to seed.js's authored default, then defaultPerms().
  function normalisePerms(raw) {
    var out = {};
    if (Array.isArray(raw) && raw.length) {
      raw.forEach(function (r) { if (r && r.role) out[r.role] = r.perms || {}; });
      if (Object.keys(out).length) return out;
    } else if (raw && typeof raw === 'object' && Object.keys(raw).length) {
      return raw;
    }
    return (global.SMS_SEED && global.SMS_SEED.permissions) ? JSON.parse(JSON.stringify(global.SMS_SEED.permissions)) : defaultPerms();
  }

  App.can = function (moduleName) {
    if (!App.user) return false;
    var p = App.permissions[App.user.role];
    return !!(p && p[moduleName]);
  };
  // Edit rights follow each role's fixed job function, not the visibility matrix above.
  App.canEdit = function (moduleName) {
    if (!App.user) return false;
    if (App.locked) return false;
    if (!App.can(moduleName)) return false;
    if (App.readOnly) return false; // Director/Parent: view + download only, never edit
    if (App.user.role === 'Teacher') return moduleName === 'Assessment' || moduleName === 'Attendance';
    if (App.user.role === 'Other staff') return ['Finance', 'Accounting', 'Payroll', 'Inventory', 'Students', 'Administration'].indexOf(moduleName) !== -1;
    return true; // Admin
  };

  App.className = function (classId) {
    var c = (App.ctx.classes || []).filter(function (x) { return x.id === classId; })[0];
    return c ? c.name : '—';
  };
  App.termName = function () {
    var a = App.ctx.academic; if (!a) return '';
    var t = (a.terms || []).filter(function (x) { return x.n === a.current_term; })[0];
    return t ? t.name : ('Term ' + a.current_term);
  };

  // ---- Session ----
  function saveSession(u) { sessionStorage.setItem('sms_session', JSON.stringify({ id: u.id, role: u.role, name: u.name })); }
  function loadSession() { try { return JSON.parse(sessionStorage.getItem('sms_session')); } catch (e) { return null; } }
  function logout() { sessionStorage.removeItem('sms_session'); App.user = null; render(); }

  // ---- Demo password auto-fill (safe: only while an account is still on its
  // original seeded demo password — the instant it's changed by anyone, the
  // hash no longer matches and auto-fill permanently stops for that account).
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

  // Try each candidate's password against the given plaintext, in order.
  // The password itself identifies which account (among a shared role) to log
  // in as — no separate username/name-picker step.
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

  function chooseRole() {
    var root = U.$('#root'); U.clear(root);
    var sName = (App.ctx.school && App.ctx.school.name) || 'the school';
    var box = el('div', { class: 'login-box' }, [
      el('div', { class: 'login-card' }, [
        el('h1', { text: 'School Management System' }),
        el('p', { class: 'muted', text: 'Sign in to continue' })
      ])
    ]);
    var schoolInput = el('input', { type: 'text', placeholder: 'School name', value: sName });
    var roleSelect = el('select');
    roleSelect.appendChild(el('option', { value: '', text: 'Select user type…' }));
    global.SMS_SEED.constants.ROLES.forEach(function (r) { roleSelect.appendChild(el('option', { value: r, text: r })); });
    var passInput = el('input', { type: 'password', placeholder: 'Password' });
    var errBox = el('div', { class: 'login-err', style: 'display:none' });

    roleSelect.addEventListener('change', function () {
      passInput.value = '';
      var role = roleSelect.value; if (!role) return;
      DB.all('users').then(function (users) {
        var candidates = users.filter(function (u) { return u.role === role; });
        var known = candidates.map(knownDemoPassword).filter(function (p) { return p != null; });
        if (known.length === 1 && candidates.length === 1) passInput.value = known[0];
      });
    });

    var form = el('form', { class: 'login-form', onsubmit: function (e) { e.preventDefault(); doLogin(); } }, [
      el('div', { class: 'field' }, [el('label', { text: 'School name' }), schoolInput]),
      el('div', { class: 'field' }, [el('label', { text: 'User type' }), roleSelect]),
      el('div', { class: 'field' }, [el('label', { text: 'Password' }), passInput]),
      errBox,
      el('button', { class: 'btn gold', type: 'submit', text: 'Sign in' })
    ]);
    box.firstChild.appendChild(form);
    root.appendChild(box);

    function doLogin() {
      errBox.style.display = 'none';
      var schoolVal = schoolInput.value.trim(), role = roleSelect.value, passVal = passInput.value;
      if (!schoolVal || !role || !passVal) { errBox.textContent = 'Please fill in all fields.'; errBox.style.display = 'block'; return; }
      if (schoolVal.toLowerCase() !== sName.toLowerCase()) { errBox.textContent = 'Incorrect school name, user type, or password.'; errBox.style.display = 'block'; return; }
      DB.all('users').then(function (users) {
        var candidates = users.filter(function (u) { return u.role === role; });
        return verifyAgainstAny(candidates, passVal);
      }).then(function (u) {
        if (!u) { errBox.textContent = 'Incorrect school name, user type, or password.'; errBox.style.display = 'block'; return; }
        App.user = u; saveSession(u); render();
      });
    }
  }

  function el(tag, attrs, children) { return U.el(tag, attrs, children); }

  // ---- Change password (self-service) ----
  function openChangePasswordModal() {
    var body = el('div');
    var cur = el('input', { type: 'password', placeholder: 'Current password' });
    var next = el('input', { type: 'password', placeholder: 'New password (min 6 characters)' });
    var next2 = el('input', { type: 'password', placeholder: 'Confirm new password' });
    body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Current password' }), cur]));
    body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'New password' }), next]));
    body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Confirm new password' }), next2]));
    var errBox = el('div', { style: 'color:#b3261e;font-size:.85rem;display:none' });
    body.appendChild(errBox);
    U.modal({
      title: 'Change password', body: body,
      actions: [
        { label: 'Cancel', onClick: function (c) { c(); } },
        { label: 'Save', kind: 'gold', onClick: function (c) {
          errBox.style.display = 'none';
          if (next.value.length < 6) { errBox.textContent = 'New password must be at least 6 characters.'; errBox.style.display = 'block'; return; }
          if (next.value !== next2.value) { errBox.textContent = 'New passwords do not match.'; errBox.style.display = 'block'; return; }
          DB.get('users', App.user.id).then(function (u) {
            return global.Auth.verifyPassword(cur.value, u.password_salt, u.password_hash).then(function (ok) {
              if (!ok) { errBox.textContent = 'Current password is incorrect.'; errBox.style.display = 'block'; return; }
              return global.Auth.hashPassword(next.value).then(function (r) {
                return DB.update('users', u.id, { password_salt: r.salt, password_hash: r.hash, must_change_password: false });
              }).then(function () {
                App.user.must_change_password = false;
                U.toast('Password updated.'); c(); render();
              });
            });
          });
        } }
      ]
    });
  }

  function accountMenu() {
    var wrap = el('div', { class: 'account-menu' });
    var btn = el('button', { class: 'account-btn', text: App.user.name + ' (' + App.user.role + ') ▾' });
    var menu = el('div', { class: 'account-dropdown', style: 'display:none' }, [
      el('button', { text: 'Change password', onclick: function () { menu.style.display = 'none'; openChangePasswordModal(); } }),
      el('button', { text: 'Sign out', onclick: logout })
    ]);
    btn.addEventListener('click', function (e) { e.stopPropagation(); menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; });
    document.addEventListener('click', function () { menu.style.display = 'none'; });
    wrap.appendChild(btn); wrap.appendChild(menu);
    return wrap;
  }

  function passwordBanner() {
    if (!App.user.must_change_password) return null;
    return el('div', { class: 'must-change-banner' }, [
      el('span', { text: 'You are using a default password — please change it.' }),
      el('button', { class: 'btn sm', text: 'Change password', onclick: openChangePasswordModal })
    ]);
  }

  function licenseBanner() {
    var lic = App.license; if (!lic) return null;
    if (lic.state === 'active') return null;
    var isAdmin = App.user.role === 'Admin';
    if (lic.state === 'expired') {
      return el('div', { class: 'license-banner expired' }, [
        el('span', { text: 'Your free trial has ended. The app is now read-only.' + (isAdmin ? ' Activate a licence to keep editing.' : ' Ask your Administrator to activate a licence.') }),
        isAdmin ? el('a', { href: '#/subscription', class: 'btn sm gold', text: 'Manage subscription' }) : null
      ]);
    }
    if (lic.state === 'trialing' && lic.daysLeft <= 7) {
      return el('div', { class: 'license-banner trial' }, [
        el('span', { text: 'Free trial — ' + lic.daysLeft + ' day(s) left.' + (isAdmin ? '' : ' Contact your Administrator to activate a licence.') }),
        isAdmin ? el('a', { href: '#/subscription', class: 'btn sm gold', text: 'Manage subscription' }) : null
      ]);
    }
    if (lic.state === 'trialing') {
      return el('div', { class: 'license-banner trial subtle' }, [
        el('span', { text: 'Free trial — ' + lic.daysLeft + ' days left.' }),
        isAdmin ? el('a', { href: '#/subscription', class: 'btn sm ghost', text: 'Manage subscription' }) : null
      ]);
    }
    return null;
  }

  // ---- Shell / router ----
  function shell() {
    var root = U.$('#root'); U.clear(root);
    var sidebar = el('aside', { class: 'sidebar' }, [
      el('div', { class: 'brand' }, [
        el('div', { class: 'brand-name', text: App.ctx.school.name }),
        el('div', { class: 'brand-sub', text: App.ctx.academic.year + ' · ' + App.termName() })
      ]),
      el('nav', { id: 'nav' })
    ]);
    var topbar = el('header', { class: 'topbar' }, [
      el('button', { class: 'menu-btn', text: '☰', onclick: function () { sidebar.classList.toggle('open'); } }),
      el('div', { class: 'spacer' }),
      accountMenu()
    ]);
    var main = el('main', { id: 'view' });
    var bannerHost = el('div', { id: 'banner-host' });
    var pwBanner = passwordBanner(); if (pwBanner) bannerHost.appendChild(pwBanner);
    var licBanner = licenseBanner(); if (licBanner) bannerHost.appendChild(licBanner);
    root.appendChild(sidebar); root.appendChild(el('div', { class: 'content-col' }, [topbar, bannerHost, main]));
    buildNav();
    router();
    window.addEventListener('hashchange', router);
  }

  function buildNav() {
    var nav = U.$('#nav');
    MODULES.concat(['Subscription']).forEach(function (m) {
      if (m !== 'Subscription' && !App.can(m)) return;
      if (m === 'Subscription' && App.user.role !== 'Admin') return;
      var a = el('a', { href: '#/' + ROUTES[m], class: 'nav-link' }, [el('span', { class: 'nav-ic', text: ICONS[m] || '•' }), el('span', { text: m })]);
      a._mod = m;
      nav.appendChild(a);
    });
  }

  function router() {
    var hash = location.hash.replace('#/', '') || 'dashboard';
    var view = U.$('#view');
    var modByRoute = {}; Object.keys(ROUTES).forEach(function (m) { modByRoute[ROUTES[m]] = m; });
    var mod = modByRoute[hash];
    if (mod && mod !== 'Subscription' && !App.can(mod)) { location.hash = '#/dashboard'; return; }
    U.$all('.nav-link').forEach(function (a) { a.classList.toggle('active', a.getAttribute('href') === '#/' + hash); });
    var V = global.Views && global.Views[hash];
    if (V) V.render(view);
    else view.innerHTML = '<div class="empty">Not found.</div>';
  }

  function render() {
    if (!App.user) { chooseRole(); return; }
    shell();
  }

  function boot() {
    App.refresh().then(function () {
      var sess = loadSession();
      if (sess) {
        DB.get('users', sess.id).then(function (u) {
          App.user = u || null;
          afterLicense();
        });
      } else afterLicense();
    });
  }
  function afterLicense() {
    var afterBoot = function () { render(); };
    if (global.License) {
      global.License.resolve().then(function (st) { App.license = st; afterBoot(); });
    } else { App.license = null; afterBoot(); }
  }

  global.App = App;
  document.addEventListener('DOMContentLoaded', boot);
})(window);

/* ============================================================
 * platform.js — Zetranova owner / platform console (the "/admin" area).
 *
 * This is the OWNER plane, not a school's plane. It is deliberately kept in
 * its own file and rendered outside the normal app shell (renderShell/router
 * in app.js), because a platform account has no school context at all: no
 * App.ctx, no role permissions, no 12-module sidebar. app.js owns the
 * platform LOGIN and hands control here afterwards via Platform.render().
 *
 * Everything here calls DB.platform* (see store.js). The server re-checks the
 * caller's platform claim on every one of those routes — nothing on this
 * screen is a security boundary, it is only the operator's control surface.
 * Every action taken here is written to the server's platform_audit log.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB;
  var el = U.el;

  // Callbacks supplied by app.js: { user, onLogout, onImpersonate }.
  var HOOKS = {};

  var PLANS = ['basic', 'growth', 'premium'];
  var PLAN_LABEL = { basic: 'Basic', growth: 'Growth', premium: 'Premium' };
  var STATE_LABEL = { active: 'Active (paid)', trialing: 'Free trial', expired: 'Trial expired', suspended: 'Suspended' };
  var STATE_COLOR = { active: '#0f5e5e', trialing: '#c99a2e', expired: '#b91c1c', suspended: '#b91c1c' };

  function field(label, input) { return el('div', { class: 'field' }, [el('label', { text: label }), input]); }
  function errBox() { return el('div', { style: 'color:#b3261e;font-size:.85rem;display:none' }); }
  function showErr(box, msg) { box.textContent = msg; box.style.display = 'block'; }
  function today() { var d = new Date(); return d.toISOString().slice(0, 10); }
  function plusDays(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }

  // School name -> URL slug: lowercase, hyphens between words, letters/numbers
  // only, truncated at a whole word (never mid-word) so long names still read
  // cleanly. Mirrors slugify_school_name() in api/index.php, which is the real
  // safety backstop (reserved-word + format check) if this suggestion is
  // edited or bypassed. Kept short (40 chars) — the school's actual name is
  // shown everywhere in the app; the slug only has to be short and readable.
  function slugify(name, maxLen) {
    maxLen = maxLen || 40;
    var s = String(name || '').toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > maxLen) {
      s = s.slice(0, maxLen).replace(/-[^-]*$/, '').replace(/-+$/, '');
    }
    return s;
  }

  function stateChip(row) {
    var label = STATE_LABEL[row.state] || row.state || '—';
    return el('span', { class: 'tag', style: 'background:' + (STATE_COLOR[row.state] || '#666') + ';color:#fff', text: label });
  }

  // Human-readable trial line. A past end date is reported as "expired on ..."
  // rather than a negative countdown ("-33d left"), which reads as a bug.
  function trialSummary(row, longForm) {
    if (!row.trial_ends_at) {
      return longForm ? 'No free trial running (treated as a paid school).' : 'no trial running';
    }
    var d = row.days_left;
    if (d === null || d === undefined) {
      return (longForm ? 'Free trial ends ' : 'ends ') + row.trial_ends_at;
    }
    if (d < 0) {
      return (longForm ? 'Free trial expired on ' : 'expired ') + row.trial_ends_at;
    }
    return longForm
      ? ('Free trial ends ' + row.trial_ends_at + ' — ' + d + ' day' + (d === 1 ? '' : 's') + ' left')
      : ('ends ' + row.trial_ends_at + ' · ' + d + 'd left');
  }

  /* ---------------- Shell ---------------- */

  function render(hooks) {
    HOOKS = hooks || {};
    var root = U.clear(U.$('#root'));

    var topbar = el('div', { class: 'topbar' }, [
      el('div', { class: 'school-name' }, [document.createTextNode('Zetranova Platform')]),
      el('div', { class: 'spacer' }),
      el('button', { class: 'role-pill', text: ((HOOKS.user && HOOKS.user.name) || 'Platform') + ' ▾', onclick: accountMenu })
    ]);
    root.appendChild(topbar);

    var wrap = el('div', { style: 'padding:1.2rem;max-width:1150px;margin:0 auto' });
    var card = el('div', { class: 'card' });
    var head = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;margin-bottom:.8rem' });
    head.appendChild(el('h1', { text: 'Schools', style: 'margin:0' }));
    head.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn ghost', text: 'Activity log', onclick: function () { openAuditModal(null); } }),
      el('button', { class: 'btn gold', text: '+ Add school', onclick: openProvisionModal })
    ]));
    card.appendChild(head);
    card.appendChild(el('div', { id: 'plat-schools' }, [el('div', { class: 'loader', text: 'Loading…' })]));
    wrap.appendChild(card);
    root.appendChild(wrap);

    loadSchools();
  }

  function accountMenu() {
    var body = el('div', { class: 'role-grid' });
    body.appendChild(el('button', { text: 'Log out', onclick: function () { m.close(); if (HOOKS.onLogout) HOOKS.onLogout(); } }));
    var m = U.modal({ title: 'Platform account', body: body, actions: [{ label: 'Close', onClick: function (c) { c(); } }] });
  }

  /* ---------------- Schools table ---------------- */

  function loadSchools() {
    var host = U.$('#plat-schools');
    if (!host) return;
    U.clear(host).appendChild(el('div', { class: 'loader', text: 'Loading…' }));
    DB.platformSchoolsList().then(function (schools) {
      var h = U.$('#plat-schools');
      if (!h) return; // operator navigated away mid-request
      U.clear(h);
      if (!schools || !schools.length) {
        h.appendChild(el('p', { class: 'muted', text: 'No schools yet. Use “+ Add school” to create the first one.' }));
        return;
      }
      var table = el('table', { class: 'data' });
      table.appendChild(el('thead', {}, [el('tr', {},
        ['School', 'School ID', 'Subscription', 'Plan', 'Users', 'Created', 'Actions']
          .map(function (t) { return el('th', { text: t }); })
      )]));
      var tb = el('tbody');
      schools.forEach(function (s) { tb.appendChild(schoolRow(s)); });
      table.appendChild(tb);
      h.appendChild(el('div', { class: 'table-wrap' }, [table]));
    }).catch(function (err) {
      var h = U.$('#plat-schools');
      if (h) U.clear(h).appendChild(el('p', { style: 'color:#b3261e', text: 'Could not load schools: ' + ((err && err.message) || 'error') }));
    });
  }

  function schoolRow(s) {
    var live = s.status === 'active' || s.status === 'trial' || s.status === 'grace';

    var subCell = el('td', {}, [
      stateChip(s),
      el('div', { class: 'muted', style: 'font-size:.72rem;margin-top:.2rem', text: trialSummary(s, false) })
    ]);

    var actions = el('td', { class: 'actions', style: 'display:flex;gap:.35rem;flex-wrap:wrap' });
    // Plan and trial are one concept to the operator, so they live behind a
    // single "Subscription" control rather than separate scattered buttons.
    actions.appendChild(el('button', { class: 'btn sm gold', text: 'Subscription', onclick: function () { openSubscriptionModal(s); } }));
    actions.appendChild(el('button', { class: 'btn sm', text: 'Users', onclick: function () { openUsersModal(s); } }));
    actions.appendChild(el('button', { class: 'btn sm', text: live ? 'Suspend' : 'Activate', onclick: function () {
      var next = live ? 'suspended' : 'active';
      if (live && !global.confirm('Suspend ' + (s.name || s.id) + '? Their staff and parents will not be able to log in until you reactivate. No data is deleted.')) return;
      DB.platformSuspend(s.id, next)
        .then(function () { U.toast(live ? 'School suspended.' : 'School reactivated.'); loadSchools(); })
        .catch(function (err) { U.toast((err && err.message) || 'Could not update status.', 'err'); });
    } }));
    actions.appendChild(el('button', { class: 'btn sm', text: 'Impersonate', onclick: function () {
      DB.platformImpersonate(s.id)
        .then(function (res) { if (HOOKS.onImpersonate) HOOKS.onImpersonate(res); })
        .catch(function (err) { U.toast((err && err.message) || 'Could not impersonate.', 'err'); });
    } }));
    actions.appendChild(el('button', { class: 'btn sm', text: 'Reset', onclick: function () {
      if (!global.confirm('Reset ' + (s.name || s.id) + ' back to default starting data?\n\nEVERY student, staff member, payment and record for this school will be permanently deleted. This cannot be undone.')) return;
      DB.platformReset(s.id)
        .then(function () { U.toast('School reset to default data.'); loadSchools(); })
        .catch(function (err) { U.toast((err && err.message) || 'Could not reset school.', 'err'); });
    } }));

    return el('tr', {}, [
      el('td', { text: s.name || '—' }),
      el('td', {}, [el('code', { style: 'font-size:.75rem', text: s.id })]),
      subCell,
      el('td', { text: PLAN_LABEL[s.plan] || s.plan || '—' }),
      el('td', { text: String(s.user_count || 0) }),
      el('td', { text: (s.created_at || '').slice(0, 10) }),
      actions
    ]);
  }

  /* ---------------- Add school ---------------- */

  function openProvisionModal() {
    var body = el('div');
    var idInput = el('input', { type: 'text', placeholder: 'auto-filled from the school name' });
    var nameInput = el('input', { type: 'text', placeholder: 'e.g. St Mary’s Basic School' });
    var preview = el('div', { class: 'help', style: 'font-family:monospace' });
    // Auto-suggest the web-address slug from the name as the operator types,
    // but stop the moment they touch the ID field themselves — their edit
    // always wins over the suggestion.
    var idTouched = false;
    function updatePreview() { preview.textContent = 'Web address: zetclass.com/' + (idInput.value || '…'); }
    idInput.addEventListener('input', function () { idTouched = true; updatePreview(); });
    nameInput.addEventListener('input', function () {
      if (!idTouched) idInput.value = slugify(nameInput.value);
      updatePreview();
    });
    updatePreview();
    body.appendChild(field('School name', nameInput));
    body.appendChild(field('School ID / web address', idInput));
    body.appendChild(preview);
    body.appendChild(el('div', { class: 'help', text: 'Lowercase letters, numbers and hyphens only — edit the auto-filled suggestion for something shorter if you prefer. A few words (admin, pricing, api, etc.) are reserved and cannot be used. New schools start on a 30-day free trial, which you can change any time from Subscription.' }));
    var e = errBox(); body.appendChild(e);

    U.modal({
      title: 'Add a new school', body: body,
      actions: [
        { label: 'Cancel', onClick: function (c) { c(); } },
        { label: 'Create', kind: 'gold', onClick: function (c) {
          e.style.display = 'none';
          if (!nameInput.value.trim()) { showErr(e, 'School name is required.'); return; }
          DB.platformProvision(idInput.value.trim(), nameInput.value.trim()).then(function (res) {
            U.toast('School created: ' + (res.school_id || ''));
            c(); loadSchools();
          }).catch(function (err) { showErr(e, (err && err.message) || 'Could not create school.'); });
        } }
      ]
    });
  }

  /* ---------------- Subscription: plan + trial in ONE place ---------------- */

  function openSubscriptionModal(s) {
    var body = el('div');
    var row = s; // refreshed in place after each change

    function paint() {
      U.clear(body);

      body.appendChild(el('div', { style: 'display:flex;gap:.5rem;align-items:center;flex-wrap:wrap;margin-bottom:.8rem' }, [
        stateChip(row),
        el('span', { class: 'muted', style: 'font-size:.82rem', text: trialSummary(row, true) })
      ]));

      // ---- Plan ----
      var planSel = el('select');
      PLANS.forEach(function (p) {
        var o = el('option', { value: p, text: PLAN_LABEL[p] });
        if ((row.plan || '') === p) o.selected = true;
        planSel.appendChild(o);
      });
      var planErr = errBox();
      var planCard = el('div', { class: 'card', style: 'margin-bottom:.7rem' }, [el('h3', { text: 'Plan' })]);
      planCard.appendChild(field('Subscription tier', planSel));
      planCard.appendChild(planErr);
      planCard.appendChild(el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn gold', text: 'Save plan', onclick: function () {
          planErr.style.display = 'none';
          DB.platformPlan(row.id, planSel.value).then(function () {
            row.plan = planSel.value;
            U.toast('Plan updated to ' + PLAN_LABEL[planSel.value] + '.');
            paint(); loadSchools();
          }).catch(function (err) { showErr(planErr, (err && err.message) || 'Could not change plan.'); });
        } })
      ]));
      body.appendChild(planCard);

      // ---- Free trial ----
      var trialErr = errBox();
      var trialCard = el('div', { class: 'card' }, [el('h3', { text: 'Free trial' })]);
      trialCard.appendChild(el('div', { class: 'help', text: 'The trial is stored on our server, not in the school’s browser, so a school cannot give itself extra time.' }));

      var daysInput = el('input', { type: 'number', min: '1', max: '3650', value: '30', style: 'width:110px' });
      var extendRow = el('div', { style: 'display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap' }, [
        field('Add days', daysInput),
        el('button', { class: 'btn', text: 'Extend trial', onclick: function () {
          trialErr.style.display = 'none';
          var n = Number(daysInput.value);
          if (!isFinite(n) || n < 1 || n > 3650) { showErr(trialErr, 'Enter a whole number of days between 1 and 3650.'); return; }
          DB.platformExtendTrial(row.id, Math.floor(n)).then(function (res) { applySub(res); U.toast('Trial extended.'); })
            .catch(function (err) { showErr(trialErr, (err && err.message) || 'Could not extend trial.'); });
        } })
      ]);
      trialCard.appendChild(extendRow);
      trialCard.appendChild(el('div', { class: 'help', text: 'Adds to the current end date if the trial is still running, or starts fresh from today if it has already expired.' }));

      var dateInput = el('input', { type: 'date', value: row.trial_ends_at || plusDays(30), style: 'width:180px' });
      var dateRow = el('div', { style: 'display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap;margin-top:.6rem' }, [
        field('Or set an exact end date', dateInput),
        el('button', { class: 'btn', text: 'Set date', onclick: function () {
          trialErr.style.display = 'none';
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value || '')) { showErr(trialErr, 'Pick a valid date.'); return; }
          DB.platformSetTrial(row.id, dateInput.value).then(function (res) { applySub(res); U.toast('Trial end date set.'); })
            .catch(function (err) { showErr(trialErr, (err && err.message) || 'Could not set trial date.'); });
        } })
      ]);
      trialCard.appendChild(dateRow);

      trialCard.appendChild(el('div', { class: 'btn-row', style: 'margin-top:.7rem' }, [
        el('button', { class: 'btn ghost', text: 'End trial now (mark as paid)', onclick: function () {
          trialErr.style.display = 'none';
          if (!global.confirm('End the free trial for ' + (row.name || row.id) + '?\n\nThey will be treated as a fully paid school — the app stays fully editable and no countdown is shown.')) return;
          DB.platformClearTrial(row.id).then(function (res) { applySub(res); U.toast('Trial ended — school marked as paid.'); })
            .catch(function (err) { showErr(trialErr, (err && err.message) || 'Could not end trial.'); });
        } })
      ]));
      trialCard.appendChild(trialErr);
      body.appendChild(trialCard);

      body.appendChild(el('div', { class: 'help', style: 'margin-top:.6rem', text: 'Every change here is recorded in the Activity log.' }));
    }

    // The trial routes return the recomputed subscription state — trust that
    // rather than guessing locally, so the modal always shows what the server
    // actually decided.
    function applySub(res) {
      var sub = res && res.subscription;
      if (sub) {
        row.trial_ends_at = sub.trial_ends_at;
        row.state = sub.state;
        row.days_left = sub.days_left;
        row.status = sub.status;
        row.plan = sub.plan;
      }
      paint();
      loadSchools();
    }

    paint();
    U.modal({
      title: 'Subscription — ' + (s.name || s.id),
      body: body,
      actions: [{ label: 'Done', onClick: function (c) { c(); } }]
    });
  }

  /* ---------------- Per-user enable / disable ---------------- */

  function openUsersModal(s) {
    var body = el('div', {}, [el('div', { class: 'loader', text: 'Loading accounts…' })]);

    function paint(users) {
      U.clear(body);
      body.appendChild(el('div', { class: 'help', text: 'Disabling an account blocks that person from logging in. Their records are untouched, and you can re-enable them at any time. To stop a whole school, use Suspend instead.' }));
      if (!users.length) { body.appendChild(el('p', { class: 'muted', text: 'This school has no login accounts.' })); return; }

      var errB = errBox(); body.appendChild(errB);
      var table = el('table', { class: 'data' });
      table.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Username', 'Role', 'Status', ''].map(function (t) { return el('th', { text: t }); }))]));
      var tb = el('tbody');
      users.forEach(function (u) {
        var btn = el('button', { class: 'btn sm', text: u.disabled ? 'Enable' : 'Disable', onclick: function () {
          errB.style.display = 'none';
          btn.disabled = true;
          DB.platformUserStatus(s.id, u.id, !u.disabled).then(function (res) {
            u.disabled = res.disabled;
            U.toast(res.disabled ? 'Account disabled.' : 'Account enabled.');
            reload();
          }).catch(function (err) {
            btn.disabled = false;
            showErr(errB, (err && err.message) || 'Could not change this account.');
          });
        } });
        tb.appendChild(el('tr', {}, [
          el('td', { text: u.name || '—' }),
          el('td', {}, [el('code', { style: 'font-size:.75rem', text: u.username || '—' })]),
          el('td', { text: u.role || '—' }),
          el('td', {}, [el('span', { class: 'tag', style: 'background:' + (u.disabled ? '#b91c1c' : '#0f5e5e') + ';color:#fff', text: u.disabled ? 'Disabled' : 'Active' })]),
          el('td', { class: 'actions' }, [btn])
        ]));
      });
      table.appendChild(tb);
      body.appendChild(el('div', { class: 'table-wrap' }, [table]));
    }

    function reload() {
      DB.platformUsers(s.id).then(paint).catch(function (err) {
        U.clear(body).appendChild(el('p', { style: 'color:#b3261e', text: 'Could not load accounts: ' + ((err && err.message) || 'error') }));
      });
    }

    reload();
    U.modal({
      title: 'Login accounts — ' + (s.name || s.id),
      body: body,
      actions: [{ label: 'Done', onClick: function (c) { c(); } }]
    });
  }

  /* ---------------- Audit / activity log ---------------- */

  var ACTION_LABEL = {
    provision: 'Created school', status: 'Changed status', trial: 'Changed trial',
    plan: 'Changed plan', reset: 'Reset school data',
    user_disable: 'Disabled an account', user_enable: 'Enabled an account',
    impersonate: 'Logged in as school'
  };

  function describe(r) {
    var d = r.detail || {};
    if (r.action === 'trial')  return (d.from || 'no trial') + ' → ' + (d.to || 'no trial');
    if (r.action === 'plan')   return (d.from || '—') + ' → ' + (d.to || '—');
    if (r.action === 'status') return (d.from || '—') + ' → ' + (d.to || '—');
    if (r.action === 'provision') return d.name || '';
    if (r.action === 'impersonate') return 'expired ' + (d.expires_at || '').slice(0, 19).replace('T', ' ');
    if (r.action === 'user_disable' || r.action === 'user_enable') return d.username || r.target_id || '';
    return '';
  }

  function openAuditModal(schoolId) {
    var body = el('div', {}, [el('div', { class: 'loader', text: 'Loading activity…' })]);

    DB.platformAudit(schoolId, 200).then(function (rows) {
      U.clear(body);
      body.appendChild(el('div', { class: 'help', text: 'Every owner action is recorded here permanently. Entries can never be edited or deleted from the app — this is the accountability record for the platform account.' }));
      if (!rows || !rows.length) { body.appendChild(el('p', { class: 'muted', text: 'No activity recorded yet.' })); return; }
      var table = el('table', { class: 'data' });
      table.appendChild(el('thead', {}, [el('tr', {}, ['When (UTC)', 'Action', 'School', 'Details', 'By'].map(function (t) { return el('th', { text: t }); }))]));
      var tb = el('tbody');
      rows.forEach(function (r) {
        tb.appendChild(el('tr', {}, [
          el('td', { text: (r.created_at || '').slice(0, 19).replace('T', ' ') }),
          el('td', { text: ACTION_LABEL[r.action] || r.action }),
          el('td', {}, [el('code', { style: 'font-size:.72rem', text: r.school_id || '—' })]),
          el('td', { class: 'muted', style: 'font-size:.78rem', text: describe(r) }),
          el('td', { text: r.platform_uid || '—' })
        ]));
      });
      table.appendChild(tb);
      body.appendChild(el('div', { class: 'table-wrap' }, [table]));
    }).catch(function (err) {
      U.clear(body).appendChild(el('p', { style: 'color:#b3261e', text: 'Could not load the activity log: ' + ((err && err.message) || 'error') }));
    });

    U.modal({
      title: schoolId ? 'Activity log — ' + schoolId : 'Activity log',
      body: body,
      actions: [{ label: 'Close', onClick: function (c) { c(); } }]
    });
  }

  global.Platform = { render: render, reload: loadSchools };
})(window);

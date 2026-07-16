/* ============================================================
 * payroll.js — configurable payroll.
 *   Tabs: Run Payroll · History · Staff Pay Setup · Reports · Pay Structure
 * Run Payroll is a read-only computed sheet (filters + finalise only);
 * all per-person figures (basic, allowances, bonus, other earnings and
 * other deductions) are set in Staff Pay Setup. SSNIT is deducted before
 * PAYE. Employer contributions are a separate cost ledger. Finalised runs
 * post their employer cost into Accounting.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, PL = global.PayrollLib, Bulk = global.Bulk;
  var el = U.el;
  var cur = function () { return App.ctx.school.currency; };

  function getConfig() {
    return DB.singleton('payrollSettings').then(function (s) { return PL.normalizeConfig(s); });
  }
  function saveConfig(cfg) { return DB.setSingleton('payrollSettings', cfg); }

  // Per-staff standing extras used by every calculation (set in Staff Pay Setup).
  function staffExtras(s) { return { bonus: Number(s.bonus) || 0, other: Number(s.other) || 0, other_deductions: Number(s.other_deductions) || 0 }; }
  function lineFor(s, config) {
    return Object.assign({ staff_id: s.staff_id, name: s.name, role: s.role,
      employee_type: s.employee_type || 'Full-time', payment_method: s.payment_method || '' },
      PL.payrollLine(s, config, staffExtras(s)));
  }

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Payroll' })]));
    if (App.readOnly) container.appendChild(el('div', { class: 'note', text: 'View-only: you can see payroll figures and print reports, but cannot run or edit payroll.' }));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Run Payroll';
    ['Run Payroll', 'History', 'Staff Pay Setup', 'Reports', 'Pay Structure'].forEach(function (t) {
      var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b);
    });
    container.appendChild(bar); container.appendChild(panel);
    function draw() {
      U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); });
      U.clear(panel);
      if (active === 'Run Payroll') tabRun(panel);
      else if (active === 'History') tabHistory(panel);
      else if (active === 'Staff Pay Setup') tabSetup(panel);
      else if (active === 'Reports') tabReports(panel);
      else tabStructure(panel);
    }
    draw();
  }

  /* ================= Run Payroll (read-only) ================= */
  function tabRun(panel) {
    Promise.all([DB.all('staff'), getConfig(), DB.all('payrollRuns')]).then(function (r) {
      var allStaff = r[0].filter(function (s) { return Number(s.basic_salary) > 0; });
      var config = r[1]; var runs = r[2];
      var ym = new Date().toISOString().slice(0, 7);

      var head = el('div', { class: 'card' });
      head.appendChild(el('h3', { text: 'New payroll run' }));
      var monthInp = el('input', { type: 'month', value: ym });
      var methodSel = el('select'); methodSel.appendChild(el('option', { value: '', text: 'All methods' }));
      (config.payment_methods || []).forEach(function (m) { methodSel.appendChild(el('option', { value: m, text: m })); });
      var typeSel = el('select'); typeSel.appendChild(el('option', { value: '', text: 'All types' }));
      (config.employee_types || []).forEach(function (t) { typeSel.appendChild(el('option', { value: t, text: t })); });
      head.appendChild(el('div', { class: 'toolbar' }, [
        el('span', { class: 'muted', text: 'Month:' }), monthInp,
        el('span', { class: 'muted', text: 'Pay method:' }), methodSel,
        el('span', { class: 'muted', text: 'Employee type:' }), typeSel
      ]));
      if (!allStaff.length) {
        head.appendChild(el('div', { class: 'empty', text: 'No staff have a basic salary yet. Set salaries in "Staff Pay Setup" first.' }));
        panel.appendChild(head); return;
      }
      head.appendChild(el('div', { class: 'note', html: 'This is a read-only sheet. All figures come from <b>Staff Pay Setup</b> (basic, allowances, bonus, other, deductions) and <b>Pay Structure</b> (rates & toggles). SSNIT is deducted <b>before</b> PAYE. Adjust a person\'s pay in Staff Pay Setup, then finalise here.' }));
      panel.appendChild(head);

      var card = el('div', { class: 'card' });
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Staff', 'Type', 'Basic', 'Allow.', 'Bonus', 'Other', 'Gross', 'SSNIT', 'Tier2', 'PAYE', 'Other ded.', 'NET'].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody'); t.appendChild(tb);
      card.appendChild(el('div', { class: 'table-wrap' }, [t]));
      var totLine = el('p', { style: 'font-weight:700' });
      card.appendChild(totLine);

      function filtered() {
        var pm = methodSel.value, ty = typeSel.value;
        return allStaff.filter(function (s) {
          if (pm && (s.payment_method || '') !== pm) return false;
          if (ty && (s.employee_type || 'Full-time') !== ty) return false;
          return true;
        });
      }
      function compute() { return filtered().map(function (s) { return lineFor(s, config); }); }
      function draw() {
        U.clear(tb);
        var lines = compute();
        var totals = { gross: 0, net: 0, paye: 0, ssnit: 0, employer: 0 };
        if (!lines.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 12, html: '<span class=empty>No staff match this filter.</span>' })]));
        lines.forEach(function (L) {
          totals.gross += L.gross; totals.net += L.net; totals.paye += L.paye;
          totals.ssnit += L.ssnit_employee + L.ssnit_employer; totals.employer += L.employer_cost;
          tb.appendChild(el('tr', {}, [
            el('td', { text: L.name }),
            el('td', {}, [el('span', { class: 'tag', text: L.employee_type })]),
            el('td', { text: U.money(L.basic, cur()) }),
            el('td', { text: U.money(L.allowances, cur()) }),
            el('td', { text: U.money(L.bonus, cur()) }),
            el('td', { text: U.money(L.other, cur()) }),
            el('td', { text: U.money(L.gross, cur()) }),
            el('td', { text: U.money(L.ssnit_employee, cur()) }),
            el('td', { text: U.money(L.tier2, cur()) }),
            el('td', { text: U.money(L.paye, cur()) }),
            el('td', { text: U.money(L.other_deductions, cur()) }),
            el('td', { html: '<b>' + U.esc(U.money(L.net, cur())) + '</b>' })
          ]));
        });
        totLine.textContent = 'Total gross: ' + U.money(totals.gross, cur())
          + ' · Net payable: ' + U.money(totals.net, cur())
          + ' · PAYE to GRA: ' + U.money(totals.paye, cur())
          + ' · SSNIT (both parts): ' + U.money(totals.ssnit, cur())
          + ' · Total employer cost: ' + U.money(totals.employer, cur());
      }
      methodSel.addEventListener('change', draw);
      typeSel.addEventListener('change', draw);
      draw();

      if (!App.readOnly) card.appendChild(el('button', { class: 'btn gold', text: 'Finalise payroll for this month', onclick: function () {
        var month = monthInp.value;
        if (!month) return U.toast('Choose a month', 'err');
        if (runs.some(function (x) { return x.month === month && x.status === 'finalized'; }))
          return U.toast('A finalised run already exists for ' + PL.monthLabel(month) + '. See History.', 'err');
        var lines = compute();
        if (!lines.length) return U.toast('No staff in this filter to finalise.', 'err');
        var totalNet = lines.reduce(function (a, x) { return a + x.net; }, 0);
        var totalCost = lines.reduce(function (a, x) { return a + x.employer_cost; }, 0);
        U.confirm('Finalise ' + PL.monthLabel(month) + ' payroll for ' + lines.length + ' staff (net ' + U.money(totalNet, cur()) + ')? This posts the cost to Accounting and cannot be edited after.', function () {
          DB.insert('payrollRuns', {
            month: month, status: 'finalized', created_on: U.todayISO(), by: App.user.name,
            settings_snapshot: config, lines: lines,
            total_net: PL.round2(totalNet), total_employer_cost: PL.round2(totalCost)
          }).then(function () {
            return DB.insert('expenses', {
              date: U.todayISO(), category: 'Salaries & Wages',
              description: 'Payroll — ' + PL.monthLabel(month) + ' (' + lines.length + ' staff, incl. employer contributions)',
              amount: PL.round2(totalCost), method: 'bank', by: App.user.name, source: 'payroll'
            });
          }).then(function () {
            U.toast('Payroll finalised and posted to Accounting.');
            render(U.$('#view'));
          });
        });
      } }));
      panel.appendChild(card);
    });
  }

  /* ================= History & payslips ================= */
  function tabHistory(panel) {
    DB.all('payrollRuns').then(function (runs) {
      runs = runs.slice().sort(function (a, b) { return (b.month || '').localeCompare(a.month || ''); });
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Payroll history' })]);
      if (!runs.length) { c.appendChild(el('div', { class: 'empty', text: 'No payroll runs yet.' })); panel.appendChild(c); return; }
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Month', 'Staff', 'Net paid', 'Employer cost', 'Run by', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      runs.forEach(function (r) {
        tb.appendChild(el('tr', {}, [
          el('td', { text: PL.monthLabel(r.month) }),
          el('td', { text: (r.lines || []).length }),
          el('td', { text: U.money(r.total_net, cur()) }),
          el('td', { text: U.money(r.total_employer_cost, cur()) }),
          el('td', { text: r.by || '—' }),
          el('td', {}, [
            el('button', { class: 'btn sm ghost', text: 'View / payslips', onclick: function () { viewRun(r); } }),
            el('button', { class: 'btn sm ghost', text: '⤓ CSV', onclick: function () {
              var data = [['Staff ID', 'Name', 'Type', 'Basic', 'Allowances', 'Bonus', 'Other', 'Gross', 'SSNIT (emp)', 'Tier2', 'PAYE', 'Other ded.', 'NET', 'SSNIT (employer)', 'Employer cost']]
                .concat((r.lines || []).map(function (L) { return [L.staff_id, L.name, L.employee_type || '', L.basic, L.allowances, L.bonus, L.other || 0, L.gross, L.ssnit_employee, L.tier2 || 0, L.paye, L.other_deductions, L.net, L.ssnit_employer, L.employer_cost]; }));
              Bulk.download('payroll-' + r.month + '.csv', data);
            } })
          ])
        ]));
      });
      t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t]));
      panel.appendChild(c);
    });
  }

  function viewRun(r) {
    var body = el('div');
    var t = el('table', { class: 'data' });
    t.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Gross', 'SSNIT', 'PAYE', 'NET', ''].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    (r.lines || []).forEach(function (L) {
      tb.appendChild(el('tr', {}, [
        el('td', { text: L.name }),
        el('td', { text: U.money(L.gross, cur()) }),
        el('td', { text: U.money(L.ssnit_employee, cur()) }),
        el('td', { text: U.money(L.paye, cur()) }),
        el('td', { text: U.money(L.net, cur()) }),
        el('td', {}, [el('button', { class: 'btn sm ghost', text: 'Payslip', onclick: function () { payslip(r, L); } })])
      ]));
    });
    t.appendChild(tb); body.appendChild(el('div', { class: 'table-wrap' }, [t]));
    U.modal({ title: 'Payroll · ' + PL.monthLabel(r.month), wide: true, body: body, actions: [{ label: 'Close', onClick: function (x) { x(); } }] });
  }

  // Payslip inner HTML (reused by the modal and the Reports export).
  function payslipInnerHtml(run, L) {
    var sc = App.ctx.school;
    function lines(list, sign) {
      return (list || []).filter(function (x) { return x.amount; }).map(function (x) {
        return '<b>' + U.esc(x.name) + ':</b> ' + (sign || '') + U.money(x.amount, cur());
      }).join('<br>');
    }
    var earnHtml = lines(L.earnings) || ('<b>Basic:</b> ' + U.money(L.basic, cur()));
    var dedHtml = lines(L.deductions, '−') || '—';
    var empHtml = lines(L.employer) || '—';
    return '<div class="rc-term">' + U.esc(sc.name) + ' — PAYSLIP · ' + PL.monthLabel(run.month) + '</div>' +
      '<p><b>Staff:</b> ' + U.esc(L.name) + ' (' + U.esc(L.staff_id) + ')' + (L.employee_type ? ' · ' + U.esc(L.employee_type) : '') + (L.payment_method ? ' · paid by ' + U.esc(L.payment_method) : '') + '<hr>' +
      '<u>EARNINGS</u><br>' + earnHtml + '<br><b>Gross pay:</b> ' + U.money(L.gross, cur()) + '<hr>' +
      '<u>DEDUCTIONS</u><br>' + dedHtml + '<hr>' +
      '<b style="font-size:1.1em">NET PAY: ' + U.money(L.net, cur()) + '</b><hr>' +
      '<span class="muted"><u>EMPLOYER CONTRIBUTIONS</u> (paid by school, not deducted)<br>' + empHtml +
      '<br>Total cost to school: ' + U.money(L.employer_cost, cur()) + '</span></p>' +
      '<p class="rc-foot">Generated by SMS · ' + U.fmtDate(run.created_on) + '</p>';
  }

  function payslip(run, L) {
    var body = el('div', { class: 'report-card', style: 'width:auto', html: payslipInnerHtml(run, L) });
    U.modal({ title: 'Payslip', body: body, actions: [
      { label: 'Print', onClick: function () { printReport('Payslip', '<div class="report-card">' + payslipInnerHtml(run, L) + '</div>'); } },
      { label: 'Close', onClick: function (x) { x(); } }
    ] });
  }

  /* ================= Staff Pay Setup ================= */
  function tabSetup(panel) {
    Promise.all([DB.all('staff'), getConfig()]).then(function (r) {
      var staff = r[0], config = r[1];
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Monthly pay per staff member' })]);
      c.appendChild(el('div', { class: 'help', text: 'Everything Run Payroll needs is set here. Basic salary is what SSNIT/pension apply to; Allowances are taxed but not SSNIT-able; Bonus and Other are extra earnings; Other ded. is a standing deduction (e.g. staff loan). Set each person\'s payment method and employee type too (used as payroll filters). Use "Overrides" to give someone a different statutory rate or toggle. Leave Basic at 0 to exclude from payroll.' }));
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Staff', 'Role', 'Employee type', 'Pay method', 'Basic', 'Allowances', 'Bonus', 'Other', 'Other ded.', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      function payInp(v) { return el('input', { type: 'number', min: 0, step: '0.01', value: v || 0, style: 'width:85px' }); }
      staff.forEach(function (s) {
        var typeSel = selectFrom(config.employee_types, s.employee_type || 'Full-time');
        var methSel = selectFrom(config.payment_methods, s.payment_method || (config.payment_methods[0] || 'Bank'));
        var b = payInp(s.basic_salary), a = payInp(s.allowances), bo = payInp(s.bonus), ot = payInp(s.other), od = payInp(s.other_deductions);
        if (App.readOnly) { [typeSel, methSel, b, a, bo, ot, od].forEach(function (n) { n.disabled = true; }); }
        tb.appendChild(el('tr', {}, [
          el('td', { text: s.name }), el('td', { text: s.role }),
          el('td', {}, [typeSel]), el('td', {}, [methSel]),
          el('td', {}, [b]), el('td', {}, [a]), el('td', {}, [bo]), el('td', {}, [ot]), el('td', {}, [od]),
          el('td', {}, [App.readOnly ? null : el('div', { class: 'wrap-actions' }, [
            el('button', { class: 'btn sm gold', text: 'Save', onclick: function () {
              DB.update('staff', s.id, { basic_salary: Number(b.value) || 0, allowances: Number(a.value) || 0,
                bonus: Number(bo.value) || 0, other: Number(ot.value) || 0, other_deductions: Number(od.value) || 0,
                employee_type: typeSel.value, payment_method: methSel.value })
                .then(function () { U.toast('Saved ' + s.name + '.'); });
            } }),
            el('button', { class: 'btn sm ghost', text: 'Overrides', onclick: function () { editOverrides(s, config); } })
          ])])
        ]));
      });
      t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t]));
      panel.appendChild(c);
    });
  }
  function selectFrom(opts, val) {
    var s = el('select', { style: 'min-width:110px' });
    (opts || []).forEach(function (o) { var op = el('option', { value: o, text: o }); if (o === val) op.selected = true; s.appendChild(op); });
    return s;
  }

  function editOverrides(staff, config) {
    var ov = JSON.parse(JSON.stringify(staff.payroll_overrides || {}));
    var body = el('div');
    body.appendChild(el('div', { class: 'help', text: 'Per-employee overrides beat the company default. Blank value = use company default. Locked statutory fields stay on.' }));
    config.fields.slice().sort(byOrder).forEach(function (f) {
      var o = ov[f.key] = ov[f.key] || {};
      var enabledDefault = o.enabled != null ? o.enabled : f.enabled;
      var cb = el('input', { type: 'checkbox' }); cb.checked = f.locked_on ? true : enabledDefault; cb.disabled = !!f.locked_on;
      cb.addEventListener('change', function () { o.enabled = cb.checked; });
      var valInp = el('input', { type: 'number', step: '0.01', style: 'width:90px',
        value: o.value != null ? o.value : '', placeholder: 'def ' + (f.kind === 'graduated' ? 'bands' : f.default) });
      valInp.disabled = f.editable === false || f.kind === 'graduated';
      valInp.addEventListener('input', function () { o.value = valInp.value === '' ? null : Number(valInp.value); });
      body.appendChild(el('div', { class: 'flex', style: 'gap:.5rem;align-items:center;margin:.2rem 0;flex-wrap:wrap' }, [
        el('label', { class: 'check-label', style: 'min-width:210px' }, [cb, document.createTextNode(' ' + f.name)]),
        el('span', { class: 'muted', text: sectionTag(f.type) }),
        valInp, el('span', { class: 'muted', text: f.kind === 'percent' ? '%' : (f.kind === 'graduated' ? '' : cur()) })
      ]));
    });
    U.modal({ title: 'Overrides · ' + staff.name, wide: true, body: body, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Clear all', onClick: function (x) { DB.update('staff', staff.id, { payroll_overrides: {} }).then(function () { x(); U.toast('Overrides cleared.'); }); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        Object.keys(ov).forEach(function (k) { var o = ov[k]; if (o.enabled == null && (o.value == null)) delete ov[k]; });
        DB.update('staff', staff.id, { payroll_overrides: ov }).then(function () { x(); U.toast('Overrides saved for ' + staff.name + '.'); });
      } }
    ] });
  }
  function sectionTag(type) { return type === 'earning' ? 'earning' : type === 'employer_cost' ? 'employer' : 'deduction'; }
  function byOrder(a, b) { return (a.order || 0) - (b.order || 0); }

  /* ================= Reports ================= */
  function tabReports(panel) {
    Promise.all([DB.all('staff'), getConfig()]).then(function (r) {
      var allStaff = r[0].filter(function (s) { return Number(s.basic_salary) > 0; });
      var config = r[1];
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Generate payroll report' })]);
      if (!allStaff.length) { c.appendChild(el('div', { class: 'empty', text: 'No staff with a salary yet — set salaries in Staff Pay Setup first.' })); panel.appendChild(c); return; }

      var monthInp = el('input', { type: 'month', value: new Date().toISOString().slice(0, 7) });
      var typeSel = optSelect([
        { value: 'payslips', label: 'Payslips' },
        { value: 'salary', label: 'Salary details (month)' },
        { value: 'statutory', label: 'Statutory summary (SSNIT & PAYE)' },
        { value: 'schedule', label: 'Payment schedule (by pay method)' }
      ]);
      var scopeSel = optSelect([
        { value: 'all', label: 'All staff' },
        { value: 'selected', label: 'Selected staff' },
        { value: 'single', label: 'Single staff member' }
      ]);
      var singleSel = optSelect(allStaff.map(function (s) { return { value: s.staff_id, label: s.staff_id + ' · ' + s.name }; }));
      var checkHost = el('div', { class: 'grid cols-2' });
      allStaff.forEach(function (s) {
        var cb = el('input', { type: 'checkbox', value: s.staff_id });
        checkHost.appendChild(el('label', { class: 'check-label', style: 'display:block' }, [cb, document.createTextNode(' ' + s.staff_id + ' · ' + s.name)]));
      });
      var pickerBox = el('div');
      function drawPicker() {
        U.clear(pickerBox);
        if (scopeSel.value === 'single') pickerBox.appendChild(field('Staff member', singleSel));
        else if (scopeSel.value === 'selected') pickerBox.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Tick staff to include' }), checkHost]));
      }
      scopeSel.addEventListener('change', drawPicker); drawPicker();

      c.appendChild(el('div', { class: 'form-grid' }, [field('Month', monthInp), field('Report type', typeSel), field('Scope', scopeSel)]));
      c.appendChild(pickerBox);
      c.appendChild(el('button', { class: 'btn gold', text: '+ Generate Report', onclick: function () { generate(); } }));
      panel.appendChild(c);
      var preview = el('div'); panel.appendChild(preview);

      function chosen() {
        var sc = scopeSel.value;
        if (sc === 'single') return allStaff.filter(function (s) { return s.staff_id === singleSel.value; });
        if (sc === 'selected') { var ids = U.$all('input[type=checkbox]', checkHost).filter(function (x) { return x.checked; }).map(function (x) { return x.value; }); return allStaff.filter(function (s) { return ids.indexOf(s.staff_id) !== -1; }); }
        return allStaff;
      }
      function generate() {
        var list = chosen();
        if (!list.length) return U.toast('Select at least one staff member.', 'err');
        var lines = list.map(function (s) { return lineFor(s, config); });
        var run = { month: monthInp.value || new Date().toISOString().slice(0, 7), created_on: U.todayISO() };
        U.clear(preview);
        var type = typeSel.value;
        if (type === 'payslips') renderPayslips(preview, run, lines);
        else if (type === 'salary') renderSalary(preview, run, lines);
        else if (type === 'statutory') renderStatutory(preview, run, lines);
        else renderSchedule(preview, run, lines);
      }
    });
  }

  function renderPayslips(preview, run, lines) {
    var wrap = el('div', { class: 'card' });
    wrap.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;align-items:center' }, [
      el('h3', { text: 'Payslips · ' + PL.monthLabel(run.month) + ' (' + lines.length + ')' }),
      el('button', { class: 'btn sm', text: '⤓ Print / PDF', onclick: function () {
        var html = lines.map(function (L) { return '<div class="report-card">' + payslipInnerHtml(run, L) + '</div>'; }).join('');
        printReport('Payslips ' + run.month, html);
      } })
    ]));
    lines.forEach(function (L) {
      wrap.appendChild(el('div', { class: 'report-card', style: 'width:auto;margin:.6rem 0;border:1px solid var(--line);border-radius:8px;padding:.6rem', html: payslipInnerHtml(run, L) }));
    });
    preview.appendChild(wrap);
  }

  function renderSalary(preview, run, lines) {
    var heads = ['Staff', 'Type', 'Method', 'Basic', 'Allow.', 'Bonus', 'Other', 'Gross', 'SSNIT', 'Tier2', 'PAYE', 'Other ded.', 'NET', 'Employer cost'];
    var moneyCols = { 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 12: 1, 13: 1 };
    var rows = lines.map(function (L) { return [L.name, L.employee_type, L.payment_method, L.basic, L.allowances, L.bonus, L.other, L.gross, L.ssnit_employee, L.tier2, L.paye, L.other_deductions, L.net, L.employer_cost]; });
    var tot = lines.reduce(function (a, L) { a.basic += L.basic; a.gross += L.gross; a.ssnit += L.ssnit_employee; a.paye += L.paye; a.net += L.net; a.emp += L.employer_cost; return a; }, { basic: 0, gross: 0, ssnit: 0, paye: 0, net: 0, emp: 0 });
    var wrap = el('div', { class: 'card' });
    wrap.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;align-items:center' }, [
      el('h3', { text: 'Salary details · ' + PL.monthLabel(run.month) }),
      el('div', { class: 'wrap-actions' }, [
        el('button', { class: 'btn sm ghost', text: '⤓ CSV', onclick: function () { Bulk.download('salary-details-' + run.month + '.csv', [heads].concat(rows)); } }),
        el('button', { class: 'btn sm', text: '⤓ Print / PDF', onclick: function () { printReport('Salary details ' + run.month, htmlTable('Salary details — ' + PL.monthLabel(run.month), heads, rows, moneyCols)); } })
      ])
    ]));
    wrap.appendChild(previewTable(heads, rows, moneyCols));
    wrap.appendChild(el('p', { style: 'font-weight:700' , text: 'Totals — Gross: ' + U.money(tot.gross, cur()) + ' · SSNIT (emp): ' + U.money(tot.ssnit, cur()) + ' · PAYE: ' + U.money(tot.paye, cur()) + ' · NET: ' + U.money(tot.net, cur()) + ' · Employer cost: ' + U.money(tot.emp, cur()) }));
    preview.appendChild(wrap);
  }

  function renderStatutory(preview, run, lines) {
    var heads = ['Staff', 'SSNIT Tier 1 (emp)', 'Tier 2', 'Tier 3', 'PAYE', 'SSNIT Tier 1 (employer)'];
    var moneyCols = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
    var rows = lines.map(function (L) { return [L.name, L.ssnit_employee, L.tier2, L.tier3, L.paye, L.ssnit_employer]; });
    var tot = lines.reduce(function (a, L) { a.s1 += L.ssnit_employee; a.t2 += L.tier2; a.t3 += L.tier3; a.paye += L.paye; a.emp += L.ssnit_employer; return a; }, { s1: 0, t2: 0, t3: 0, paye: 0, emp: 0 });
    rows.push(['TOTAL', tot.s1, tot.t2, tot.t3, tot.paye, tot.emp]);
    var wrap = el('div', { class: 'card' });
    wrap.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;align-items:center' }, [
      el('h3', { text: 'Statutory summary · ' + PL.monthLabel(run.month) }),
      el('div', { class: 'wrap-actions' }, [
        el('button', { class: 'btn sm ghost', text: '⤓ CSV', onclick: function () { Bulk.download('statutory-' + run.month + '.csv', [heads].concat(rows)); } }),
        el('button', { class: 'btn sm', text: '⤓ Print / PDF', onclick: function () { printReport('Statutory summary ' + run.month, htmlTable('Statutory summary (SSNIT & PAYE) — ' + PL.monthLabel(run.month), heads, rows, moneyCols)); } })
      ])
    ]));
    wrap.appendChild(el('div', { class: 'note', html: 'Remittance totals — <b>SSNIT to pay</b> (employee Tier 1 + employer): ' + U.money(tot.s1 + tot.emp, cur()) + ' · <b>PAYE to GRA</b>: ' + U.money(tot.paye, cur()) }));
    wrap.appendChild(previewTable(heads, rows, moneyCols));
    preview.appendChild(wrap);
  }

  function renderSchedule(preview, run, lines) {
    var groups = {};
    lines.forEach(function (L) { var m = L.payment_method || 'Unspecified'; (groups[m] = groups[m] || []).push(L); });
    var wrap = el('div', { class: 'card' });
    var csvRows = [['Pay method', 'Staff ID', 'Name', 'Net pay']];
    var htmlParts = ['<h2>Payment schedule — ' + U.esc(PL.monthLabel(run.month)) + '</h2>'];
    wrap.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;align-items:center' }, [
      el('h3', { text: 'Payment schedule · ' + PL.monthLabel(run.month) }),
      el('div', { class: 'wrap-actions' }, [
        el('button', { class: 'btn sm ghost', text: '⤓ CSV', onclick: function () { Bulk.download('payment-schedule-' + run.month + '.csv', csvRows); } }),
        el('button', { class: 'btn sm', text: '⤓ Print / PDF', onclick: function () { printReport('Payment schedule ' + run.month, htmlParts.join('')); } })
      ])
    ]));
    var grand = 0;
    Object.keys(groups).forEach(function (m) {
      var list = groups[m]; var sub = list.reduce(function (a, L) { return a + L.net; }, 0); grand += sub;
      wrap.appendChild(el('h4', { text: m + ' — ' + list.length + ' staff · ' + U.money(sub, cur()) }));
      var rows = list.map(function (L) { csvRows.push([m, L.staff_id, L.name, L.net]); return [L.staff_id, L.name, L.net]; });
      wrap.appendChild(previewTable(['Staff ID', 'Name', 'Net pay'], rows, { 2: 1 }));
      htmlParts.push('<h3>' + U.esc(m) + ' — ' + U.money(sub, cur()) + '</h3>' + htmlTable('', ['Staff ID', 'Name', 'Net pay'], rows, { 2: 1 }));
    });
    csvRows.push(['GRAND TOTAL', '', '', grand]);
    wrap.appendChild(el('p', { style: 'font-weight:700', text: 'Grand total net payable: ' + U.money(grand, cur()) }));
    htmlParts.push('<p><b>Grand total net payable: ' + U.money(grand, cur()) + '</b></p>');
    preview.appendChild(wrap);
  }

  /* ---- report helpers ---- */
  function previewTable(heads, rows, moneyCols) {
    var t = el('table', { class: 'data' });
    t.appendChild(el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    rows.forEach(function (row) { tb.appendChild(el('tr', {}, row.map(function (cell, i) { return el('td', { text: (moneyCols && moneyCols[i] && typeof cell === 'number') ? U.money(cell, cur()) : cell }); }))); });
    t.appendChild(tb);
    return el('div', { class: 'table-wrap' }, [t]);
  }
  function htmlTable(title, heads, rows, moneyCols) {
    var brand = (App.themeHex ? App.themeHex().primary : '#0f5e5e');
    var h = title ? '<h3>' + U.esc(title) + '</h3>' : '';
    h += '<table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%"><thead><tr>' +
      heads.map(function (x) { return '<th style="background:' + brand + ';color:#fff;text-align:left">' + U.esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (row) { h += '<tr>' + row.map(function (cell, i) { return '<td>' + U.esc((moneyCols && moneyCols[i] && typeof cell === 'number') ? U.money(cell, cur()) : cell) + '</td>'; }).join('') + '</tr>'; });
    h += '</tbody></table><br>';
    return h;
  }
  function printReport(title, innerHtml) {
    var w = window.open('', '_blank');
    var brand = (App.themeHex ? App.themeHex().primary : '#0f5e5e');
    w.document.write('<html><head><title>' + U.esc(title) + '</title><link rel="stylesheet" href="css/report.css"><style>body{font-family:Arial,Helvetica,sans-serif;padding:20px}table{border-collapse:collapse;width:100%;margin-bottom:12px}th,td{border:1px solid #999;padding:4px;font-size:12px;text-align:left}th{background:' + brand + ';color:#fff}h1,h2,h3{color:' + brand + '}.report-card{page-break-after:always;margin-bottom:20px}</style></head><body>' + innerHtml + '</body></html>');
    w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
  }
  function optSelect(opts) { var s = el('select'); opts.forEach(function (o) { s.appendChild(el('option', { value: o.value, text: o.label })); }); return s; }
  function field(label, node) { return el('div', { class: 'field' }, [el('label', { text: label }), node]); }

  /* ================= Pay Structure (config) ================= */
  function tabStructure(panel) {
    getConfig().then(function (cfg) {
      var config = JSON.parse(JSON.stringify(cfg));

      var fc = el('div', { class: 'card' }, [el('h3', { text: '1. Filters & global settings' })]);
      var apply = checkRow('Apply SSNIT & PAYE automatically (statutory master switch)', config.apply_statutory !== false, function (v) { config.apply_statutory = v; });
      fc.appendChild(apply);
      var ceil = U.form([{ name: 'ssnit_ceiling', label: 'SSNIT insurable-earnings ceiling (0 = no cap)', type: 'number', min: 0, value: config.ssnit_ceiling, help: 'Max monthly basic on which SSNIT/pension % is charged. Revised yearly by SSNIT — enter the current figure.' }], {});
      fc.appendChild(ceil);
      fc.appendChild(listEditor('Payment methods', config.payment_methods));
      fc.appendChild(listEditor('Employee types', config.employee_types));
      panel.appendChild(fc);

      panel.appendChild(sectionCard('2. Earnings', 'earning', config, false));
      panel.appendChild(sectionCard('3. Statutory & other deductions', 'deduction', config, false));
      panel.appendChild(sectionCard('4. Employer contributions', 'employer_cost', config, true));

      if (App.readOnly) { panel.appendChild(el('div', { class: 'note', text: 'View-only: changes on this tab are not saved for your role.' })); return; }

      panel.appendChild(el('div', { class: 'card' }, [el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn gold', text: 'Save pay structure', onclick: function () {
          config.ssnit_ceiling = Number(ceil.readValues().ssnit_ceiling) || 0;
          var t2 = fieldDef(config, 'tier2'), t3 = fieldDef(config, 'tier3');
          if (t2 && t3 && t2.enabled && t3.enabled && (Number(t2.default) + Number(t3.default) > 16.5))
            U.toast('Note: Tier 2 + Tier 3 exceed the 16.5% combined pension relief cap.', 'warn');
          saveConfig(config).then(function () { U.toast('Pay structure saved.'); });
        } }),
        el('button', { class: 'btn ghost', text: 'Reset to Ghana defaults', onclick: function () {
          U.confirm('Replace the whole pay structure with the seeded Ghana defaults?', function () {
            saveConfig(PL.defaultConfig()).then(function () { U.toast('Reset to Ghana defaults.'); render(U.$('#view')); });
          });
        } })
      ])]));
    });
  }

  function sectionCard(title, type, config, isEmployerSection) {
    var c = el('div', { class: 'card' }, [el('h3', { text: title })]);
    if (isEmployerSection) {
      c.appendChild(el('div', { class: 'note', html: 'Master switch for the whole section. Turn OFF if you don\'t track employer-side cost.' }));
      c.appendChild(checkRow('Track employer contributions', config.employer_section_enabled !== false, function (v) {
        config.employer_section_enabled = v; body.style.opacity = v ? '' : '.45'; body.style.pointerEvents = v ? '' : 'none';
      }));
    }
    var body = el('div');
    if (isEmployerSection && config.employer_section_enabled === false) { body.style.opacity = '.45'; body.style.pointerEvents = 'none'; }
    var listBox = el('div');
    function redraw() {
      U.clear(listBox);
      config.fields.filter(function (f) { return f.type === type; }).sort(byOrder).forEach(function (f) {
        listBox.appendChild(fieldRow(f, config, redraw));
      });
    }
    redraw();
    body.appendChild(listBox);
    body.appendChild(el('button', { class: 'btn sm', text: '+ Add ' + (type === 'earning' ? 'earning' : type === 'employer_cost' ? 'employer cost' : 'deduction'),
      onclick: function () { addField(type, config, redraw); } }));
    c.appendChild(body);
    return c;
  }

  function fieldRow(f, config, redraw) {
    var row = el('div', { class: 'flex', style: 'gap:.5rem;align-items:center;margin:.3rem 0;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:.3rem' });
    var cb = el('input', { type: 'checkbox' }); cb.checked = f.locked_on ? true : f.enabled !== false; cb.disabled = !!f.locked_on;
    cb.addEventListener('change', function () { f.enabled = cb.checked; });
    row.appendChild(el('label', { class: 'check-label', title: f.locked_on ? 'Statutory — always on' : 'On/off' }, [cb]));
    if (f.custom) {
      var nameInp = el('input', { type: 'text', value: f.name, style: 'flex:1;min-width:150px;font-weight:600' });
      nameInp.addEventListener('input', function () { f.name = nameInp.value; });
      row.appendChild(nameInp);
    } else {
      row.appendChild(el('span', { style: 'flex:1;min-width:150px;font-weight:600', text: f.name + (f.locked_on ? ' 🔒' : '') }));
    }
    var kindEditable = f.custom || f.key === 'bonus' || f.key === 'other';
    if (f.kind === 'graduated') {
      row.appendChild(el('span', { class: 'tag', text: 'graduated' }));
      row.appendChild(el('button', { class: 'btn sm ghost', text: 'Edit PAYE bands', onclick: function () { editBands(config); } }));
    } else if (kindEditable) {
      var kSel = el('select', { style: 'width:110px' });
      [['amount', cur() + ' amount'], ['percent', '% of basic']].forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); if (f.kind === o[0]) op.selected = true; kSel.appendChild(op); });
      kSel.addEventListener('change', function () { f.kind = kSel.value; f.basis = kSel.value === 'percent' ? 'basic' : 'flat'; });
      row.appendChild(kSel);
    } else {
      row.appendChild(el('span', { class: 'tag', text: f.kind === 'percent' ? '% of basic' : cur() }));
    }
    if (f.kind !== 'graduated') {
      var valInp = el('input', { type: 'number', step: '0.01', value: f.default, style: 'width:100px' });
      valInp.disabled = f.editable === false;
      valInp.addEventListener('input', function () { f.default = Number(valInp.value) || 0; });
      row.appendChild(valInp);
      row.appendChild(el('span', { class: 'muted', text: f.kind === 'percent' ? '%' : '' }));
    }
    if (f.max_pct) row.appendChild(el('span', { class: 'muted', text: '(max ' + f.max_pct + '%)' }));
    if (f.custom) {
      row.appendChild(el('button', { class: 'btn sm danger', text: '✕', onclick: function () {
        config.fields = config.fields.filter(function (x) { return x.key !== f.key; }); redraw();
      } }));
    }
    return row;
  }

  function addField(type, config, redraw) {
    var f = U.form([
      { name: 'name', label: 'Field name', required: true },
      { name: 'kind', label: 'Value type', type: 'select', options: [{ value: 'amount', label: cur() + ' amount' }, { value: 'percent', label: '% of basic' }] },
      { name: 'default', label: 'Default value', type: 'number', value: 0 },
      { name: 'pre_tax', label: 'Deduct before PAYE (pension / tax-deductible)', type: 'checkbox', value: false },
      { name: 'enabled', label: 'On by default', type: 'checkbox', value: true }
    ], {});
    if (type !== 'deduction') { var pr = f.querySelector('[name="pre_tax"]'); if (pr) pr.closest('.field').style.display = 'none'; }
    U.modal({ title: 'Add ' + (type === 'earning' ? 'earning' : type === 'employer_cost' ? 'employer cost' : 'deduction'), body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Add', kind: 'gold', onClick: function (x) {
        var v = f.readValues(); if (!v.name.trim()) return U.toast('Name required', 'err');
        var maxOrder = config.fields.reduce(function (m, x2) { return Math.max(m, x2.order || 0); }, 0);
        config.fields.push({
          key: 'custom_' + Date.now().toString(36),
          name: v.name.trim(), type: type, kind: v.kind, basis: v.kind === 'percent' ? 'basic' : 'flat',
          default: Number(v.default) || 0, enabled: !!v.enabled, editable: true,
          pre_tax: type === 'deduction' ? !!v.pre_tax : false, custom: true, order: maxOrder + 1
        });
        x(); redraw(); U.toast('Field added — remember to Save.');
      } }
    ] });
  }

  function editBands(config) {
    var bands = JSON.parse(JSON.stringify(config.paye_monthly_bands || PL.defaultConfig().paye_monthly_bands));
    var box = el('div');
    box.appendChild(el('div', { class: 'help', text: 'Each row: band width in ' + cur() + ' and its rate. Blank width on the last row = "everything above". Seeded with GRA bands — verify yearly.' }));
    var bandsBox = el('div');
    function drawBands() {
      U.clear(bandsBox);
      bands.forEach(function (b, i) {
        var w = el('input', { type: 'number', step: '0.01', placeholder: 'rest', value: b.chunk == null ? '' : b.chunk, style: 'width:120px' });
        var rt = el('input', { type: 'number', step: '0.1', value: b.rate, style: 'width:80px' });
        w.addEventListener('change', function () { b.chunk = w.value === '' ? null : Number(w.value); });
        rt.addEventListener('change', function () { b.rate = Number(rt.value) || 0; });
        bandsBox.appendChild(el('div', { class: 'flex', style: 'gap:.5rem;align-items:center;margin:.25rem 0' }, [
          el('span', { class: 'muted', style: 'width:60px', text: 'Band ' + (i + 1) }), w,
          el('span', { class: 'muted', text: '@' }), rt, el('span', { class: 'muted', text: '%' }),
          el('button', { class: 'btn sm ghost', text: '✕', onclick: function () { bands.splice(i, 1); drawBands(); } })
        ]));
      });
      bandsBox.appendChild(el('button', { class: 'btn sm ghost', text: '＋ Add band', onclick: function () { bands.push({ chunk: 0, rate: 0 }); drawBands(); } }));
    }
    drawBands();
    box.appendChild(bandsBox);
    U.modal({ title: 'PAYE monthly bands', wide: true, body: box, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Apply', kind: 'gold', onClick: function (x) { config.paye_monthly_bands = bands; x(); U.toast('Bands updated — remember to Save.'); } }
    ] });
  }

  /* ---- small shared controls ---- */
  function checkRow(label, val, onChange) {
    var c = el('input', { type: 'checkbox' }); c.checked = val;
    c.addEventListener('change', function () { onChange(c.checked); });
    return el('label', { class: 'check-label', style: 'display:block;margin:.3rem 0' }, [c, document.createTextNode(' ' + label)]);
  }
  function listEditor(title, arr) {
    var box = el('div', { class: 'field' }, [el('label', { text: title })]);
    var listBox = el('div');
    function redraw() {
      U.clear(listBox);
      arr.forEach(function (item, i) {
        var inp = el('input', { type: 'text', value: item, style: 'flex:1' });
        inp.addEventListener('input', function () { arr[i] = inp.value; });
        listBox.appendChild(el('div', { class: 'flex', style: 'margin-bottom:.25rem;gap:.4rem' }, [
          inp, el('button', { class: 'btn sm danger', text: '✕', onclick: function () { arr.splice(i, 1); redraw(); } })
        ]));
      });
      listBox.appendChild(el('button', { class: 'btn sm ghost', text: '+ Add', onclick: function () { arr.push('New'); redraw(); } }));
    }
    redraw(); box.appendChild(listBox); return box;
  }
  function fieldDef(config, key) { return config.fields.filter(function (f) { return f.key === key; })[0]; }

  global.Views = global.Views || {};
  global.Views.payroll = { title: 'Payroll', render: render };
})(window);

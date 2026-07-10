/* ============================================================
 * dashboard.js — role-aware key figures, finance KPIs, key dates.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, FL = global.FinanceLib;
  var el = U.el;

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Dashboard' }),
      el('div', { class: 'spacer' }), el('span', { class: 'muted', text: App.user.role + ' · ' + App.user.name })]));

    // Parents get a compact ward summary; everyone else (incl. view-only Director) gets the full board.
    if (App.user.role === 'Parent') return parentDash(container);

    var term = App.ctx.academic.current_term;
    Promise.all([DB.all('students'), DB.all('invoices'), DB.all('payments'), DB.all('attendance'), DB.all('staff'), DB.all('inventoryItems'), DB.all('otherIncome'), DB.all('expenses')])
      .then(function (r) {
        var students = r[0].filter(function (s) { return s.status === 'active'; });
        var allPayments = r[2];
        var invoices = r[1].filter(function (i) { return i.term === term; });
        var payments = allPayments.filter(function (p) { return p.term === term; });
        var attendance = r[3], staff = r[4], items = r[5], otherIncome = r[6], expenses = r[7];
        var cur = App.ctx.school.currency;

        var billed = 0, paid = 0;
        students.forEach(function (s) {
          var klass = App.ctx.classes.filter(function (c) { return c.id === s.class_id; })[0];
          var pos = FL.studentFeePosition(s.student_id, klass, invoices, payments, App.ctx.feeTypes);
          billed += pos.billed; paid += pos.paid;
        });
        var present = attendance.filter(function (a) { return a.status === 'present'; }).length;
        var rate = attendance.length ? Math.round(present / attendance.length * 100) : 0;
        var low = items.filter(function (i) { return Number(i.qty) <= Number(i.low_threshold || 0); });

        var stats = el('div', { class: 'grid cols-4' });
        function s(n, l, route, accent) {
          var d = el('div', { class: 'stat' + (accent ? ' accent' : '') + (route ? ' kpi-link' : '') }, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]);
          if (route) d.addEventListener('click', function () { location.hash = '#/' + route; });
          return d;
        }
        stats.appendChild(s(students.length, 'Enrolment', 'students', true));
        if (App.can('Finance')) {
          stats.appendChild(s(U.money(paid, cur), 'Fees collected (' + App.termName() + ')', 'finance'));
          stats.appendChild(s(U.money(billed - paid, cur), 'Outstanding fees', 'finance'));
        }
        stats.appendChild(s(rate + '%', 'Attendance rate', 'attendance'));
        if (App.can('Administration')) stats.appendChild(s(staff.length, 'Staff', 'administration'));
        if (App.can('Inventory')) stats.appendChild(s(low.length, 'Low-stock items', 'inventory', low.length > 0));
        container.appendChild(stats);

        // ---- Finance — today (visible to finance-capable roles) ----
        if (App.can('Finance') || App.can('Accounting')) {
          var today = U.todayISO();
          var feesToday = allPayments.filter(function (p) { return (p.created_on || '') === today; }).reduce(function (a, p) { return a + Number(p.amount || 0); }, 0);
          var otherToday = otherIncome.filter(function (o) { return (o.date || '') === today; }).reduce(function (a, o) { return a + Number(o.amount || 0); }, 0);
          var expToday = expenses.filter(function (e) { return (e.date || '') === today; }).reduce(function (a, e) { return a + Number(e.amount || 0); }, 0);
          var fcard = el('div', { class: 'card' }, [el('h3', { text: 'Finance — today (' + U.fmtDate(today) + ')' })]);
          fcard.appendChild(el('div', { class: 'grid cols-4' }, [
            stat(U.money(feesToday, cur), 'Fees paid today'),
            stat(U.money(billed - paid, cur), 'Arrears (as of today)'),
            stat(U.money(feesToday + otherToday, cur), 'Total income today'),
            stat(U.money(expToday, cur), 'Total expenses today')
          ]));
          container.appendChild(fcard);
        }

        // Enrolment by class
        var byClass = {};
        students.forEach(function (st) { byClass[st.class_id] = (byClass[st.class_id] || 0) + 1; });
        var ecard = el('div', { class: 'card' }, [el('h3', { text: 'Enrolment by class' })]);
        var grid = el('div', { class: 'grid cols-3' });
        App.ctx.classes.slice().sort(function (a, b) { return a.sort - b.sort; }).forEach(function (c) {
          grid.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;border-bottom:1px solid var(--line);padding:.25rem 0' }, [el('span', { text: c.name }), el('b', { text: byClass[c.id] || 0 })]));
        });
        ecard.appendChild(grid); container.appendChild(ecard);

        upcoming(container);
        announcements(container);
      });
  }

  function upcoming(container) {
    var ac = App.ctx.academic;
    var c = el('div', { class: 'card' }, [el('h3', { text: 'Key dates' })]);
    ac.terms.forEach(function (t) {
      c.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;border-bottom:1px solid var(--line);padding:.25rem 0' }, [
        el('span', { text: t.name + (t.n === ac.current_term ? ' (current)' : '') }),
        el('span', { class: 'muted', text: 'Vacation ' + U.fmtDate(t.vacation) + ' · Reopen ' + U.fmtDate(t.reopening) })
      ]));
    });
    container.appendChild(c);
  }

  function announcements(container) {
    DB.all('announcements').then(function (anns) {
      if (!anns.length) return;
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Latest announcements' })]);
      anns.slice(-3).reverse().forEach(function (a) { c.appendChild(el('div', { style: 'border-bottom:1px solid var(--line);padding:.3rem 0' }, [el('b', { text: a.title }), el('div', { class: 'help', text: a.body })])); });
      container.appendChild(c);
    });
  }

  function parentDash(container) {
    var codes = App.user.linked_student_ids || [];
    var term = App.ctx.academic.current_term;
    Promise.all([DB.all('students'), DB.all('invoices'), DB.all('payments'), DB.all('attendance'), DB.all('announcements')]).then(function (r) {
      var mine = r[0].filter(function (s) { return codes.indexOf(s.student_id) !== -1; });
      container.appendChild(el('div', { class: 'note', text: 'Welcome, ' + App.user.name + '. A quick summary of your ward(s) — open “My Ward” (Students) for the full report.' }));
      mine.forEach(function (s) {
        var klass = App.ctx.classes.filter(function (c) { return c.id === s.class_id; })[0];
        var pos = FL.studentFeePosition(s.student_id, klass, r[1].filter(function (i) { return i.term === term; }), r[2].filter(function (p) { return p.term === term; }), App.ctx.feeTypes);
        var present = r[3].filter(function (a) { return a.student_id === s.student_id && a.status === 'present'; }).length;
        var c = el('div', { class: 'card' }, [
          el('h3', { text: s.first_name + ' ' + s.last_name + ' · ' + (klass ? klass.name : '') }),
          el('div', { class: 'grid cols-3' }, [
            stat(U.money(pos.arrears, App.ctx.school.currency), 'Fees balance'),
            stat(present, 'Days present'),
            stat(s.student_id, 'Student ID')
          ]),
          el('div', { class: 'btn-row', style: 'margin-top:.5rem' }, [
            el('button', { class: 'btn sm ghost', text: 'View report / attendance', onclick: function () { location.hash = '#/students'; } })
          ])
        ]);
        container.appendChild(c);
      });
      if (!mine.length) container.appendChild(el('div', { class: 'empty', text: 'No ward linked to this account. Please contact the school office.' }));
      announcements(container);
    });
  }

  function stat(n, l) { return el('div', { class: 'stat accent' }, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]); }
  global.Views = global.Views || {};
  global.Views.dashboard = { title: 'Dashboard', render: render };
})(window);

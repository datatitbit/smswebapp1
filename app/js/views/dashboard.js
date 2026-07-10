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

        trendsSection(container, { students: r[0], attendance: attendance, payments: allPayments, otherIncome: otherIncome, expenses: expenses, cur: cur });

        upcoming(container);
        announcements(container);
      });
  }


  /* ---------------- Trends (inline SVG, dependency-free) ---------------- */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) { var e = document.createElementNS(SVGNS, tag); if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function svgText(x, y, str, anchor, size) { var t = svg('text', { x: x, y: y, 'text-anchor': anchor || 'start', 'font-size': size || 10, fill: '#6b7280' }); t.textContent = str; return t; }
  function iso(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function shortDay(isoStr) { var p = isoStr.split('-'); return p[2] + '/' + p[1]; }
  function shortMon(isoStr) { var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; var p = isoStr.split('-'); return m[Number(p[1]) - 1] + ' ' + p[0].slice(2); }

  function rangeFor(period) {
    var end = new Date(U.todayISO() + 'T00:00:00'); var start = new Date(end);
    if (period === 'week') { start.setDate(end.getDate() - 6); return { start: start, end: end, unit: 'day' }; }
    if (period === 'month') { start.setDate(end.getDate() - 29); return { start: start, end: end, unit: 'day' }; }
    if (period === 'term') { start.setDate(end.getDate() - 119); return { start: start, end: end, unit: 'week' }; }
    start.setMonth(end.getMonth() - 11); start.setDate(1); return { start: start, end: end, unit: 'month' };
  }
  function makeBuckets(range) {
    var b = [], d = new Date(range.start);
    while (d <= range.end) {
      var st = new Date(d), en, label;
      if (range.unit === 'day') { en = new Date(d); label = shortDay(iso(st)); d.setDate(d.getDate() + 1); }
      else if (range.unit === 'week') { en = new Date(d); en.setDate(en.getDate() + 6); label = shortDay(iso(st)); d.setDate(d.getDate() + 7); }
      else { en = new Date(d.getFullYear(), d.getMonth() + 1, 0); label = shortMon(iso(st)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1); }
      b.push({ start: iso(st), end: iso(en), label: label });
    }
    return b;
  }
  function bucketIndex(buckets, dateStr) { if (!dateStr) return -1; for (var i = 0; i < buckets.length; i++) { if (dateStr >= buckets[i].start && dateStr <= buckets[i].end) return i; } return -1; }

  function lineChart(series, o) {
    o = o || {}; var W = 520, H = 158, pad = { l: 40, r: 10, t: 12, b: 22 };
    var vals = series.map(function (p) { return p.value; });
    var maxV = Math.max.apply(null, vals.concat([0])); var minV = o.zero ? 0 : Math.min.apply(null, vals.concat([0]));
    if (maxV === minV) maxV = minV + 1;
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, n = series.length;
    function x(i) { return pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw); }
    function y(v) { return pad.t + ih - ((v - minV) / (maxV - minV)) * ih; }
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });
    s.appendChild(svg('line', { x1: pad.l, y1: pad.t + ih, x2: pad.l + iw, y2: pad.t + ih, stroke: '#e5e7eb' }));
    s.appendChild(svgText(pad.l - 6, pad.t + 9, o.fmt ? o.fmt(maxV) : Math.round(maxV), 'end'));
    s.appendChild(svgText(pad.l - 6, pad.t + ih, o.fmt ? o.fmt(minV) : Math.round(minV), 'end'));
    var pts = series.map(function (p, i) { return x(i) + ',' + y(p.value); }).join(' ');
    s.appendChild(svg('polyline', { points: pts, fill: 'none', stroke: o.color || '#0f5e5e', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    var step = Math.max(1, Math.ceil(n / 6));
    series.forEach(function (p, i) {
      s.appendChild(svg('circle', { cx: x(i), cy: y(p.value), r: 2.4, fill: o.color || '#0f5e5e' }));
      if (n <= 8 || i % step === 0 || i === n - 1) s.appendChild(svgText(x(i), pad.t + ih + 14, p.label, 'middle', 9));
    });
    return s;
  }
  function barsChart(buckets, income, expense, o) {
    o = o || {}; var W = 520, H = 168, pad = { l: 46, r: 10, t: 12, b: 26 };
    var maxV = Math.max(1, Math.max.apply(null, income.concat(expense)));
    var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b, n = buckets.length;
    var groupW = iw / n, bw = Math.max(3, Math.min(14, groupW / 3));
    function y(v) { return pad.t + ih - (v / maxV) * ih; }
    var s = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H });
    s.appendChild(svg('line', { x1: pad.l, y1: pad.t + ih, x2: pad.l + iw, y2: pad.t + ih, stroke: '#e5e7eb' }));
    s.appendChild(svgText(pad.l - 6, pad.t + 9, o.fmt ? o.fmt(maxV) : Math.round(maxV), 'end'));
    var step = Math.max(1, Math.ceil(n / 6));
    buckets.forEach(function (b, i) {
      var cx = pad.l + groupW * i + groupW / 2, inc = income[i] || 0, exp = expense[i] || 0;
      s.appendChild(svg('rect', { x: cx - bw - 1, y: y(inc), width: bw, height: (pad.t + ih) - y(inc), fill: '#0f5e5e', rx: 2 }));
      s.appendChild(svg('rect', { x: cx + 1, y: y(exp), width: bw, height: (pad.t + ih) - y(exp), fill: '#c99a2e', rx: 2 }));
      if (n <= 8 || i % step === 0 || i === n - 1) s.appendChild(svgText(cx, pad.t + ih + 14, b.label, 'middle', 9));
    });
    return s;
  }
  function chartBlock(title, node) { return el('div', { style: 'margin-top:.6rem' }, [el('div', { class: 'help', style: 'font-weight:600;color:var(--ink)', text: title }), node]); }
  function legend(items) { var w = el('div', { class: 'flex', style: 'gap:1rem;flex-wrap:wrap;margin:.2rem 0 .1rem' }); items.forEach(function (it) { w.appendChild(el('span', { class: 'flex', style: 'align-items:center;gap:.3rem;font-size:.75rem;color:var(--muted,#6b7280)' }, [el('span', { style: 'width:10px;height:10px;border-radius:2px;display:inline-block;background:' + it[1] }), document.createTextNode(it[0])])); }); return w; }

  function trendsSection(container, D) {
    var showFinance = App.can('Finance') || App.can('Accounting');
    var period = 'week';
    var head = el('div', { class: 'flex', style: 'justify-content:space-between;flex-wrap:wrap;gap:.5rem;align-items:center' }, [el('h3', { text: 'Trends' })]);
    var bar = el('div', { class: 'btn-row' });
    [['week', 'Week'], ['month', 'Month'], ['term', 'Term'], ['year', 'Year']].forEach(function (pp) {
      var b = el('button', { class: 'btn sm' + (pp[0] === period ? ' gold' : ''), text: pp[1], onclick: function () { period = pp[0]; U.$all('button', bar).forEach(function (x) { x.classList.remove('gold'); }); b.classList.add('gold'); draw(); } });
      bar.appendChild(b);
    });
    head.appendChild(bar);
    var card = el('div', { class: 'card' }, [head]);
    var area = el('div'); card.appendChild(area);
    container.appendChild(card);
    draw();

    function draw() {
      U.clear(area);
      var buckets = makeBuckets(rangeFor(period));
      // Attendance rate per bucket
      var present = buckets.map(function () { return 0; }), tot = buckets.map(function () { return 0; });
      D.attendance.forEach(function (a) { var i = bucketIndex(buckets, a.date); if (i < 0) return; tot[i]++; if (a.status === 'present') present[i]++; });
      var attSeries = buckets.map(function (b, i) { return { label: b.label, value: tot[i] ? Math.round(present[i] / tot[i] * 100) : 0 }; });
      // Enrolment cumulative to bucket end
      var enrSeries = buckets.map(function (b) { return { label: b.label, value: D.students.filter(function (s) { return (s.admitted_on || '0000-00-00') <= b.end && s.status !== 'withdrawn'; }).length }; });
      // Finance income/expense per bucket
      var income = buckets.map(function () { return 0; }), expense = buckets.map(function () { return 0; });
      D.payments.forEach(function (p) { var i = bucketIndex(buckets, p.created_on); if (i >= 0) income[i] += Number(p.amount || 0); });
      (D.otherIncome || []).forEach(function (o) { var i = bucketIndex(buckets, o.date); if (i >= 0) income[i] += Number(o.amount || 0); });
      (D.expenses || []).forEach(function (e) { var i = bucketIndex(buckets, e.date); if (i >= 0) expense[i] += Number(e.amount || 0); });

      var hasAtt = tot.some(function (v) { return v > 0; });
      area.appendChild(chartBlock('Attendance rate (%)', hasAtt ? lineChart(attSeries, { color: '#0f5e5e', zero: true, fmt: function (v) { return Math.round(v) + '%'; } }) : el('div', { class: 'empty', text: 'No attendance recorded in this period yet.' })));
      area.appendChild(chartBlock('Enrolment (cumulative)', lineChart(enrSeries, { color: '#2563eb', zero: true })));
      if (showFinance) {
        var hasFin = income.some(function (v) { return v > 0; }) || expense.some(function (v) { return v > 0; });
        if (hasFin) {
          area.appendChild(chartBlock('Income vs expenses (' + D.cur + ')', barsChart(buckets, income, expense, { fmt: function (v) { return U.money(v, D.cur); } })));
          area.appendChild(legend([['Income', '#0f5e5e'], ['Expenses', '#c99a2e']]));
        } else {
          area.appendChild(chartBlock('Income vs expenses (' + D.cur + ')', el('div', { class: 'empty', text: 'No finance activity recorded in this period yet.' })));
        }
      }
    }
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

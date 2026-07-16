/* ============================================================
 * finance.js — billing from fee types, payments (test mode),
 * receipts, arrears, bills report. Bulk fee billing included.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, FL = global.FinanceLib,
    Services = global.Services, Bulk = global.Bulk;
  var el = U.el;
  var cur = function () { return App.ctx.school.currency; };

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Finance & Fees' })]));
    container.appendChild(el('div', { class: 'note', html: 'Payments run in <b>TEST MODE</b> (mock MoMo / Paystack). No real money moves. Live keys are added at deployment.' }));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Billing';
    ['Billing', 'Record Payment', 'Bills Report'].forEach(function (t) { var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b); });
    container.appendChild(bar); container.appendChild(panel);
    function draw() { U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); }); U.clear(panel);
      if (active === 'Billing') tabBilling(panel); else if (active === 'Record Payment') tabPayment(panel); else tabReport(panel); }
    draw();
  }

  /* ---------------- Billing ---------------- */
  function tabBilling(panel) {
    var term = App.ctx.academic.current_term;
    var classes = App.ctx.classes.slice().sort(bySort);
    var tools = el('div', { class: 'toolbar' });
    var clsSel = el('select'); clsSel.appendChild(el('option', { value: '', text: 'All classes' }));
    classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
    tools.appendChild(el('span', { class: 'muted', text: 'Class:' })); tools.appendChild(clsSel);
    tools.appendChild(el('div', { style: 'flex:1' }));
    if (!App.readOnly) tools.appendChild(el('button', { class: 'btn', text: 'Generate term bills', onclick: function () { generateBills(clsSel.value, term); } }));
    panel.appendChild(tools);
    var area = el('div'); panel.appendChild(area);
    clsSel.addEventListener('change', function () { drawList(); });
    drawList();

    function drawList() {
      U.clear(area);
      Promise.all([DB.all('students'), DB.all('invoices'), DB.all('payments'), DB.all('feeTypes')]).then(function (r) {
        var students = r[0].filter(function (s) { return s.status === 'active'; });
        if (clsSel.value) students = students.filter(function (s) { return s.class_id === clsSel.value; });
        var invoices = r[1].filter(function (i) { return i.term === term; });
        var payments = r[2].filter(function (p) { return p.term === term; });
        var card = el('div', { class: 'card' });
        card.appendChild(el('h3', { text: 'Fee positions · ' + App.termName() }));
        if (!students.length) { card.appendChild(el('div', { class: 'empty', text: 'No students.' })); area.appendChild(card); return; }
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['Pupil', 'Class', 'Billed', 'Paid', 'Balance', ''].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody'); var tot = { b: 0, p: 0 };
        students.forEach(function (s) {
          var klass = App.ctx.classes.filter(function (c) { return c.id === s.class_id; })[0];
          var pos = FL.studentFeePosition(s.student_id, klass, invoices, payments, r[3]);
          tot.b += pos.billed; tot.p += pos.paid;
          tb.appendChild(el('tr', {}, [
            el('td', { text: s.first_name + ' ' + s.last_name }),
            el('td', { text: klass ? klass.name : '—' }),
            el('td', { text: U.money(pos.billed, cur()) }),
            el('td', { text: U.money(pos.paid, cur()) }),
            el('td', {}, [el('span', { class: pos.arrears > 0 ? 'tag req' : 'tag', text: U.money(pos.arrears, cur()) })]),
            el('td', {}, [el('button', { class: 'btn sm ghost', text: 'View bill', onclick: function () { viewBill(s, klass, invoices, payments); } })])
          ]));
        });
        t.appendChild(tb);
        t.appendChild(el('tfoot', {}, [el('tr', {}, [el('th', { text: 'Totals' }), el('th'), el('th', { text: U.money(tot.b, cur()) }), el('th', { text: U.money(tot.p, cur()) }), el('th', { text: U.money(tot.b - tot.p, cur()) }), el('th')])]));
        card.appendChild(el('div', { class: 'table-wrap' }, [t]));
        area.appendChild(card);
      });
    }
  }

  function generateBills(classId, term) {
    if (App.readOnly) return;
    U.confirm('Generate per-term bills from your fee types for ' + (classId ? App.className(classId) : 'all classes') + '? Existing identical bills are skipped.', function () {
      Promise.all([DB.all('students'), DB.all('invoices'), DB.all('feeTypes')]).then(function (r) {
        var students = r[0].filter(function (s) { return s.status === 'active' && (!classId || s.class_id === classId); });
        var existing = r[1]; var feeTypes = r[2];
        var ops = []; var created = 0;
        students.forEach(function (s) {
          var klass = App.ctx.classes.filter(function (c) { return c.id === s.class_id; })[0]; if (!klass) return;
          FL.feesForClass(klass, feeTypes).filter(function (f) { return f.frequency === 'per_term'; }).forEach(function (f) {
            var dup = existing.some(function (i) { return i.student_id === s.student_id && i.term === term && i.fee_type_id === f.id; });
            if (dup) return;
            created++;
            ops.push(DB.insert('invoices', { student_id: s.student_id, class_id: s.class_id, term: term, fee_type_id: f.id, fee_name: f.name, amount: f.amount, created_on: U.todayISO() }));
          });
        });
        Promise.all(ops).then(function () { U.toast(created ? ('Generated ' + created + ' bill line(s).') : 'No new bills (already billed).'); render(U.$('#view')); });
      });
    });
  }

  function viewBill(s, klass, invoices, payments) {
    var inv = invoices.filter(function (i) { return i.student_id === s.student_id; });
    var pos = FL.studentFeePosition(s.student_id, klass, invoices, payments, App.ctx.feeTypes);
    var body = el('div');
    var t = el('table', { class: 'data' });
    t.appendChild(el('thead', {}, [el('tr', {}, [el('th', { text: 'Fee' }), el('th', { text: 'Amount' })])]));
    var tb = el('tbody'); inv.forEach(function (i) { tb.appendChild(el('tr', {}, [el('td', { text: i.fee_name }), el('td', { text: U.money(i.amount, cur()) })])); });
    if (!inv.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 2, html: '<span class=muted>No bills generated yet.</span>' })]));
    t.appendChild(tb); body.appendChild(el('div', { class: 'table-wrap' }, [t]));
    body.appendChild(el('p', { html: 'Billed: <b>' + U.money(pos.billed, cur()) + '</b> · Paid: <b>' + U.money(pos.paid, cur()) + '</b> · Balance: <b>' + U.money(pos.arrears, cur()) + '</b>' }));
    U.modal({ title: 'Bill · ' + s.first_name + ' ' + s.last_name, wide: true, body: body, actions: [{ label: 'Close', onClick: function (x) { x(); } }] });
  }

  /* ---------------- Record Payment ---------------- */
  function tabPayment(panel) {
    if (App.readOnly) { panel.appendChild(el('div', { class: 'empty', text: 'Read-only role: payments cannot be recorded.' })); return; }
    var term = App.ctx.academic.current_term;
    DB.all('students').then(function (students) {
      students = students.filter(function (s) { return s.status === 'active'; });
      var f = U.form([
        { name: 'student_id', label: 'Pupil', type: 'select', options: students.map(function (s) { return { value: s.student_id, label: s.first_name + ' ' + s.last_name + ' (' + s.student_id + ')' }; }) },
        { name: 'amount', label: 'Amount', type: 'number', min: 0, required: true },
        { name: 'method', label: 'Method', type: 'select', options: [{ value: 'mobile_money', label: 'Mobile Money (MoMo)' }, { value: 'card', label: 'Card (Paystack)' }, { value: 'cash', label: 'Cash' }] },
        { name: 'phone', label: 'MoMo / contact number' }
      ], {});
      f.classList.add('form-grid');
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Record a payment' }), f]);
      c.appendChild(el('button', { class: 'btn gold', text: 'Take payment', onclick: function () {
        var v = f.readValues(); if (!v.amount) return U.toast('Amount required', 'err');
        var ref = 'RCT-' + Date.now().toString(36).toUpperCase();
        var proceed = function (gw) {
          DB.insert('payments', { student_id: v.student_id, term: term, amount: Number(v.amount), method: v.method, reference: ref, gateway_ref: gw && gw.reference, receipt_no: ref, created_on: U.todayISO(), by: App.user.name }).then(function (p) {
            showReceipt(p, students.filter(function (s) { return s.student_id === v.student_id; })[0], gw);
            render(U.$('#view'));
          });
        };
        if (v.method === 'cash') proceed(null);
        else Services.Payments.charge({ amount: Number(v.amount), currency: cur(), method: v.method, phone: v.phone, reference: ref }).then(proceed);
      } }));
      panel.appendChild(c);

      DB.all('payments').then(function (pays) {
        var recent = pays.slice(-10).reverse();
        var card = el('div', { class: 'card' }, [el('h3', { text: 'Recent payments' })]);
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['Receipt', 'Pupil', 'Amount', 'Method', 'Date', ''].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        recent.forEach(function (p) {
          var s = students.filter(function (x) { return x.student_id === p.student_id; })[0];
          tb.appendChild(el('tr', {}, [el('td', { text: p.receipt_no }), el('td', { text: s ? s.first_name + ' ' + s.last_name : p.student_id }), el('td', { text: U.money(p.amount, cur()) }), el('td', { text: p.method }), el('td', { text: U.fmtDate(p.created_on) }), el('td', {}, [el('button', { class: 'btn sm ghost', text: 'Receipt', onclick: function () { showReceipt(p, s, null); } })])]));
        });
        if (!recent.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 6, html: '<span class=muted>No payments yet.</span>' })]));
        t.appendChild(tb); card.appendChild(el('div', { class: 'table-wrap' }, [t]));
        panel.appendChild(card);
      });
    });
  }

  function showReceipt(p, s, gw) {
    var sc = App.ctx.school;
    var body = el('div', { class: 'report-card', style: 'width:auto' });
    body.appendChild(el('div', { class: 'rc-term', text: sc.name + ' — PAYMENT RECEIPT' }));
    body.appendChild(el('p', { html: '<b>Receipt:</b> ' + U.esc(p.receipt_no) + '<br><b>Date:</b> ' + U.esc(U.fmtDate(p.created_on)) + '<br><b>Pupil:</b> ' + U.esc(s ? s.first_name + ' ' + s.last_name + ' (' + s.student_id + ')' : p.student_id) + '<br><b>Amount:</b> ' + U.esc(U.money(p.amount, cur())) + '<br><b>Method:</b> ' + U.esc(p.method) + '<br><b>Received by:</b> ' + U.esc(p.by || '—') }));
    if (gw && gw.test_mode) body.appendChild(el('p', { class: 'muted', text: gw.message }));
    body.appendChild(el('p', { class: 'rc-foot', text: 'Thank you. Keep this receipt as proof of payment.' }));
    U.modal({ title: 'Receipt', body: body, actions: [
      { label: 'Print', kind: '', onClick: function () { var w = window.open('', '_blank'); w.document.write('<link rel="stylesheet" href="css/report.css"><div class="report-card">' + body.innerHTML + '</div>'); w.document.close(); w.print(); } },
      { label: 'Close', onClick: function (x) { x(); } }
    ] });
  }

  /* ---------------- Bills Report ---------------- */
  function tabReport(panel) {
    var term = App.ctx.academic.current_term;
    Promise.all([DB.all('students'), DB.all('invoices'), DB.all('payments')]).then(function (r) {
      var students = r[0].filter(function (s) { return s.status === 'active'; });
      var invoices = r[1].filter(function (i) { return i.term === term; });
      var payments = r[2].filter(function (p) { return p.term === term; });
      var rows = students.map(function (s) {
        var klass = App.ctx.classes.filter(function (c) { return c.id === s.class_id; })[0];
        var pos = FL.studentFeePosition(s.student_id, klass, invoices, payments, App.ctx.feeTypes);
        return { name: s.first_name + ' ' + s.last_name, id: s.student_id, klass: klass ? klass.name : '—', billed: pos.billed, paid: pos.paid, bal: pos.arrears };
      });
      var totB = rows.reduce(function (a, x) { return a + x.billed; }, 0);
      var totP = rows.reduce(function (a, x) { return a + x.paid; }, 0);
      var c = el('div', { class: 'card' });
      c.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
        el('h3', { text: 'Bills / Fees Report · ' + App.termName() }),
        el('button', { class: 'btn ghost sm', text: '⤓ Export CSV', onclick: function () {
          var data = [['Student ID', 'Name', 'Class', 'Billed', 'Paid', 'Balance']].concat(rows.map(function (x) { return [x.id, x.name, x.klass, x.billed, x.paid, x.bal]; }));
          Bulk.download('bills-report.csv', data);
        } })
      ]));
      c.appendChild(el('div', { class: 'grid cols-3', style: 'margin:.5rem 0' }, [
        stat(U.money(totB, cur()), 'Total billed'), stat(U.money(totP, cur()), 'Total collected'), stat(U.money(totB - totP, cur()), 'Outstanding')
      ]));
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['ID', 'Name', 'Class', 'Billed', 'Paid', 'Balance'].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      rows.forEach(function (x) { tb.appendChild(el('tr', {}, [el('td', { text: x.id }), el('td', { text: x.name }), el('td', { text: x.klass }), el('td', { text: U.money(x.billed, cur()) }), el('td', { text: U.money(x.paid, cur()) }), el('td', { text: U.money(x.bal, cur()) })])); });
      t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t]));
      panel.appendChild(c);
    });
  }

  function stat(n, l) { return el('div', { class: 'stat accent' }, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]); }
  function bySort(a, b) { return (a.sort || 0) - (b.sort || 0); }
  global.Views = global.Views || {};
  global.Views.finance = { title: 'Finance', render: render };
})(window);

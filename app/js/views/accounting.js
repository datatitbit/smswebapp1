/* ============================================================
 * accounting.js — school income & expense book.
 * Income = fee payments (auto, from Finance) + other income (manual).
 * Expenses = manual entries + payroll postings (auto, from Payroll).
 * Time-filtered overview, CSV exports, editable categories.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Reports = global.Reports, Bulk = global.Bulk;
  var el = U.el;
  var cur = function () { return App.ctx.school.currency; };

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Accounting' })]));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Overview';
    ['Overview', 'Expenses', 'Other Income', 'Categories'].forEach(function (t) {
      var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b);
    });
    container.appendChild(bar); container.appendChild(panel);
    function draw() {
      U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); });
      U.clear(panel);
      if (active === 'Overview') tabOverview(panel);
      else if (active === 'Expenses') tabBook(panel, 'expenses', 'expenseCategories', 'Expense');
      else if (active === 'Other Income') tabBook(panel, 'otherIncome', 'incomeCategories', 'Income');
      else tabCategories(panel);
    }
    draw();
  }

  /* ---------------- Overview ---------------- */
  function tabOverview(panel) {
    var tf = Reports.timeFilter(function () { drawArea(); });
    panel.appendChild(tf.node);
    var area = el('div'); panel.appendChild(area);
    drawArea();

    function drawArea() {
      U.clear(area);
      Promise.all([DB.all('payments'), DB.all('otherIncome'), DB.all('expenses'), DB.all('expenseCategories'), DB.all('incomeCategories')]).then(function (r) {
        var range = tf.current();
        var fees = r[0].filter(function (p) { return Reports.inRange(p.created_on, range); });
        var other = r[1].filter(function (x) { return Reports.inRange(x.date, range); });
        var exps = r[2].filter(function (x) { return Reports.inRange(x.date, range); });
        var feeTotal = sum(fees, 'amount'), otherTotal = sum(other, 'amount'), expTotal = sum(exps, 'amount');
        var income = feeTotal + otherTotal, net = income - expTotal;

        area.appendChild(el('div', { class: 'grid cols-3', style: 'margin:.5rem 0' }, [
          stat(U.money(income, cur()), 'Income (' + range.label + ')'),
          stat(U.money(expTotal, cur()), 'Expenses'),
          stat(U.money(net, cur()), net >= 0 ? 'Surplus' : 'Deficit')
        ]));
        area.appendChild(el('div', { class: 'note', html: 'Income = fee payments recorded in <b>Finance</b> (' + U.money(feeTotal, cur()) + ') + other income (' + U.money(otherTotal, cur()) + '). Payroll runs post into expenses automatically when finalised.' }));

        // Expense breakdown by category
        var byCat = {};
        exps.forEach(function (x) { byCat[x.category] = (byCat[x.category] || 0) + Number(x.amount || 0); });
        var rows = Object.keys(byCat).map(function (k) { return { cat: k, amt: byCat[k] }; }).sort(function (a, b) { return b.amt - a.amt; });
        var c = el('div', { class: 'card' });
        c.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
          el('h3', { text: 'Expenses by category' }),
          el('button', { class: 'btn ghost sm', text: '⤓ Export CSV', onclick: function () {
            var data = [['Category', 'Amount']].concat(rows.map(function (x) { return [x.cat, x.amt]; }));
            data.push(['TOTAL EXPENSES', expTotal]); data.push(['TOTAL INCOME', income]); data.push(['NET', net]);
            Bulk.download('accounting-summary.csv', data);
          } })
        ]));
        if (!rows.length) c.appendChild(el('div', { class: 'empty', text: 'No expenses in this period.' }));
        else {
          var max = Math.max.apply(null, rows.map(function (x) { return x.amt; }));
          rows.forEach(function (x) {
            c.appendChild(el('div', { class: 'flex', style: 'align-items:center;gap:.6rem;margin:.35rem 0' }, [
              el('div', { style: 'width:160px;font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: x.cat }),
              el('div', { style: 'background:var(--teal,#0f5e5e);height:16px;border-radius:4px;width:' + Math.max(2, Math.round(55 * x.amt / max)) + '%' }),
              el('div', { style: 'font-size:.8rem;font-weight:600', text: U.money(x.amt, cur()) })
            ]));
          });
        }
        area.appendChild(c);
      });
    }
  }

  /* ---------------- Expense / Other income book ---------------- */
  function tabBook(panel, coll, catColl, label) {
    if (App.readOnly) { panel.appendChild(el('div', { class: 'empty', text: 'Read-only role.' })); return; }
    Promise.all([DB.all(coll), DB.all(catColl)]).then(function (r) {
      var entries = r[0].slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var cats = r[1];
      var f = U.form([
        { name: 'date', label: 'Date', type: 'date', value: U.todayISO(), required: true },
        { name: 'category', label: 'Category', type: 'select', options: cats.map(function (c) { return c.name; }) },
        { name: 'description', label: 'Description', required: true, placeholder: label === 'Expense' ? 'e.g. ECG prepaid units' : 'e.g. Uniform sales' },
        { name: 'amount', label: 'Amount (' + cur() + ')', type: 'number', min: 0, step: '0.01', required: true },
        { name: 'method', label: 'Method', type: 'select', options: ['cash', 'mobile_money', 'bank', 'cheque'] }
      ], {});
      f.classList.add('form-grid');
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Record ' + label.toLowerCase() }), f]);
      c.appendChild(el('button', { class: 'btn gold', text: 'Save ' + label.toLowerCase(), onclick: function () {
        var v = f.readValues();
        var errs = f.validate(); if (!v.amount || v.amount <= 0) errs.push('Amount must be above zero.');
        if (errs.length) return U.toast(errs[0], 'err');
        DB.insert(coll, { date: v.date, category: v.category, description: v.description, amount: Number(v.amount), method: v.method, by: App.user.name, source: 'manual' })
          .then(function () { U.toast(label + ' saved.'); render(U.$('#view')); });
      } }));
      panel.appendChild(c);

      var card = el('div', { class: 'card' });
      card.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
        el('h3', { text: label + ' book (' + entries.length + ')' }),
        el('button', { class: 'btn ghost sm', text: '⤓ Export CSV', onclick: function () {
          var data = [['Date', 'Category', 'Description', 'Amount', 'Method', 'By']].concat(
            entries.map(function (x) { return [x.date, x.category, x.description, x.amount, x.method || '', x.by || '']; }));
          Bulk.download(coll + '.csv', data);
        } })
      ]));
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Date', 'Category', 'Description', 'Amount', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      entries.slice(0, 100).forEach(function (x) {
        var canDelete = (App.user.role === 'Admin' || App.user.role === 'Director') && x.source !== 'payroll';
        tb.appendChild(el('tr', {}, [
          el('td', { text: U.fmtDate(x.date) }),
          el('td', { text: x.category || '—' }),
          el('td', { text: x.description + (x.source === 'payroll' ? ' (auto: payroll)' : '') }),
          el('td', { text: U.money(x.amount, cur()) }),
          el('td', {}, canDelete ? [el('button', { class: 'btn sm ghost', text: '✕', onclick: function () {
            U.confirm('Delete this ' + label.toLowerCase() + ' entry?', function () {
              DB.remove(coll, x.id).then(function () { U.toast('Deleted.'); render(U.$('#view')); });
            });
          } })] : [])
        ]));
      });
      if (!entries.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 5, html: '<span class=muted>Nothing recorded yet.</span>' })]));
      t.appendChild(tb);
      card.appendChild(el('div', { class: 'table-wrap' }, [t]));
      panel.appendChild(card);
    });
  }

  /* ---------------- Categories ---------------- */
  function tabCategories(panel) {
    if (App.user.role !== 'Admin' && App.user.role !== 'Director') {
      panel.appendChild(el('div', { class: 'empty', text: 'Only Admin / Director can edit categories.' })); return;
    }
    [['expenseCategories', 'Expense categories'], ['incomeCategories', 'Other-income categories']].forEach(function (pair) {
      var coll = pair[0];
      DB.all(coll).then(function (cats) {
        var c = el('div', { class: 'card' }, [el('h3', { text: pair[1] })]);
        var list = el('div');
        cats.forEach(function (cat) {
          list.appendChild(el('div', { class: 'flex', style: 'align-items:center;gap:.5rem;margin:.25rem 0' }, [
            el('div', { style: 'flex:1', text: cat.name }),
            el('button', { class: 'btn sm ghost', text: '✕', onclick: function () {
              U.confirm('Remove category "' + cat.name + '"? Existing entries keep their label.', function () {
                DB.remove(coll, cat.id).then(function () { U.toast('Removed.'); render(U.$('#view')); });
              });
            } })
          ]));
        });
        c.appendChild(list);
        var inp = el('input', { placeholder: 'New category name' });
        c.appendChild(el('div', { class: 'flex', style: 'gap:.5rem;margin-top:.5rem' }, [
          inp,
          el('button', { class: 'btn', text: 'Add', onclick: function () {
            var name = inp.value.trim(); if (!name) return;
            DB.insert(coll, { name: name }).then(function () { U.toast('Added.'); render(U.$('#view')); });
          } })
        ]));
        panel.appendChild(c);
      });
    });
  }

  function stat(n, l) { return el('div', { class: 'stat accent' }, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]); }
  function sum(arr, k) { return arr.reduce(function (a, x) { return a + Number(x[k] || 0); }, 0); }

  global.Views = global.Views || {};
  global.Views.accounting = { title: 'Accounting', render: render };
})(window);

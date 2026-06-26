/* ============================================================
 * inventory.js — items, stock in/out, low-stock, stock report
 * with day/week/month/term/year time filters + CSV export.
 * Categories come from Settings.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Bulk = global.Bulk, Reports = global.Reports;
  var el = U.el;

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Inventory / Stock' })]));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Items';
    ['Items', 'Stock Movements', 'Stock Report'].forEach(function (t) { var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b); });
    container.appendChild(bar); container.appendChild(panel);
    function draw() { U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); }); U.clear(panel);
      if (active === 'Items') tabItems(panel); else if (active === 'Stock Movements') tabMovements(panel); else tabReport(panel); }
    draw();
  }

  function tabItems(panel) {
    Promise.all([DB.all('inventoryItems'), DB.all('inventoryCategories')]).then(function (r) {
      var items = r[0], cats = r[1];
      var tools = el('div', { class: 'toolbar' });
      if (!App.readOnly) tools.appendChild(el('button', { class: 'btn', text: '+ Add item', onclick: function () { editItem(null, cats, refresh); } }));
      panel.appendChild(tools);
      var low = items.filter(function (i) { return Number(i.qty) <= Number(i.low_threshold || 0); });
      if (low.length) panel.appendChild(el('div', { class: 'note', html: '<b>Low stock:</b> ' + low.map(function (i) { return U.esc(i.name) + ' (' + i.qty + ')'; }).join(', ') }));
      var c = el('div', { class: 'card' });
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Item', 'Category', 'Qty', 'Unit', 'Unit cost', 'Value', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      items.forEach(function (i) {
        var lowFlag = Number(i.qty) <= Number(i.low_threshold || 0);
        var act = el('div', { class: 'wrap-actions' });
        if (!App.readOnly) {
          act.appendChild(el('button', { class: 'btn sm gold', text: 'In', onclick: function () { move(i, 'in', refresh); } }));
          act.appendChild(el('button', { class: 'btn sm ghost', text: 'Out', onclick: function () { move(i, 'out', refresh); } }));
          act.appendChild(el('button', { class: 'btn sm', text: 'Edit', onclick: function () { editItem(i, cats, refresh); } }));
          act.appendChild(el('button', { class: 'btn sm danger', text: 'Del', onclick: function () { U.confirm('Delete ' + i.name + '?', function () { DB.remove('inventoryItems', i.id).then(refresh); }); } }));
        }
        tb.appendChild(el('tr', {}, [
          el('td', { text: i.name }), el('td', { text: i.category }),
          el('td', {}, [el('span', { class: lowFlag ? 'tag req' : 'tag', text: i.qty })]),
          el('td', { text: i.unit || '—' }),
          el('td', { text: i.unit_cost != null ? U.money(i.unit_cost, App.ctx.school.currency) : '—' }),
          el('td', { text: U.money(Number(i.qty) * Number(i.unit_cost || 0), App.ctx.school.currency) }),
          el('td', {}, [act])
        ]));
      });
      if (!items.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 7, html: '<span class=empty>No items yet.</span>' })]));
      t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); panel.appendChild(c);
    });
    function refresh() { U.clear(panel); tabItems(panel); }
  }

  function editItem(i, cats, done) {
    var f = U.form([
      { name: 'name', label: 'Item name', required: true },
      { name: 'category', label: 'Category', type: 'select', options: cats.map(function (c) { return c.name; }) },
      { name: 'qty', label: 'Quantity', type: 'number', min: 0 },
      { name: 'unit', label: 'Unit (e.g. pcs, box)' },
      { name: 'unit_cost', label: 'Unit cost (optional)', type: 'number', min: 0 },
      { name: 'low_threshold', label: 'Low-stock threshold', type: 'number', min: 0 }
    ], i || { qty: 0, low_threshold: 5 });
    f.classList.add('form-grid');
    U.modal({ title: i ? 'Edit item' : 'Add item', wide: true, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        var v = f.readValues(); if (!v.name.trim()) return U.toast('Name required', 'err');
        var p = i ? DB.update('inventoryItems', i.id, v) : DB.insert('inventoryItems', v);
        p.then(function () { x(); U.toast('Saved.'); done(); });
      } }
    ] });
  }

  function move(item, type, done) {
    var f = U.form([
      { name: 'qty', label: 'Quantity to ' + (type === 'in' ? 'add' : 'remove'), type: 'number', min: 1, required: true },
      { name: 'note', label: 'Note (supplier / purpose)' }
    ], {});
    U.modal({ title: 'Stock ' + (type === 'in' ? 'In' : 'Out') + ' · ' + item.name, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Confirm', kind: 'gold', onClick: function (x) {
        var v = f.readValues(); var q = Number(v.qty); if (!q || q < 1) return U.toast('Enter a quantity', 'err');
        var newQty = Number(item.qty) + (type === 'in' ? q : -q);
        if (newQty < 0) return U.toast('Not enough stock.', 'err');
        DB.insert('stockMovements', { item_id: item.id, item_name: item.name, type: type, qty: q, note: v.note, date: U.todayISO(), by: App.user.name }).then(function () {
          DB.update('inventoryItems', item.id, { qty: newQty }).then(function () { x(); U.toast('Stock updated.'); done(); });
        });
      } }
    ] });
  }

  function tabMovements(panel) {
    Promise.all([DB.all('stockMovements')]).then(function (r) {
      var moves = r[0].slice().reverse();
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Stock movements' })]);
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Date', 'Item', 'Type', 'Qty', 'Note', 'By'].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      moves.forEach(function (m) { tb.appendChild(el('tr', {}, [el('td', { text: U.fmtDate(m.date) }), el('td', { text: m.item_name }), el('td', {}, [el('span', { class: 'tag ' + (m.type === 'in' ? '' : 'req'), text: m.type.toUpperCase() })]), el('td', { text: m.qty }), el('td', { text: m.note || '—' }), el('td', { text: m.by || '—' })])); });
      if (!moves.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 6, html: '<span class=empty>No movements.</span>' })]));
      t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); panel.appendChild(c);
    });
  }

  function tabReport(panel) {
    var filterBar = Reports.timeFilter(function (range) { draw(range); });
    panel.appendChild(filterBar.node);
    var area = el('div'); panel.appendChild(area);
    draw(filterBar.current());
    function draw(range) {
      U.clear(area);
      DB.all('stockMovements').then(function (moves) {
        var rows = moves.filter(function (m) { return Reports.inRange(m.date, range); });
        var inQ = rows.filter(function (m) { return m.type === 'in'; }).reduce(function (a, m) { return a + Number(m.qty); }, 0);
        var outQ = rows.filter(function (m) { return m.type === 'out'; }).reduce(function (a, m) { return a + Number(m.qty); }, 0);
        var c = el('div', { class: 'card' });
        c.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
          el('h3', { text: 'Stock report · ' + range.label }),
          el('button', { class: 'btn ghost sm', text: '⤓ Export CSV', onclick: function () { Bulk.download('stock-report.csv', [['Date', 'Item', 'Type', 'Qty', 'Note']].concat(rows.map(function (m) { return [m.date, m.item_name, m.type, m.qty, m.note || '']; }))); } })
        ]));
        c.appendChild(el('div', { class: 'grid cols-2', style: 'margin:.5rem 0' }, [stat(inQ, 'Total stock-in'), stat(outQ, 'Total stock-out')]));
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['Date', 'Item', 'Type', 'Qty', 'Note'].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody'); rows.slice().reverse().forEach(function (m) { tb.appendChild(el('tr', {}, [el('td', { text: U.fmtDate(m.date) }), el('td', { text: m.item_name }), el('td', { text: m.type }), el('td', { text: m.qty }), el('td', { text: m.note || '—' })])); });
        if (!rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 5, html: '<span class=empty>No movements in this period.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); area.appendChild(c);
      });
    }
  }

  function stat(n, l) { return el('div', { class: 'stat accent' }, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]); }
  global.Views = global.Views || {};
  global.Views.inventory = { title: 'Inventory', render: render };
})(window);

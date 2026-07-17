/* ============================================================
 * inventory.js — Inventory & Asset Management (Ghana schools).
 * Five core sections + a Settings tab for the "uncommon" feature
 * toggles that strip/expose columns and form inputs globally:
 *   1. Item Master        — what the school owns / sells / issues
 *   2. Stock Levels       — physical stock per storeroom
 *   3. Allocation & Sales — stock movement (restock / sale / issue)
 *   4. Audit Ledger       — immutable delta history
 *   5. Reports            — filtered export engine (PDF / DOCX / CSV)
 *
 * Data flow rule: every sale / issue / restock / manual audit
 * updates Stock Levels (QOH / Allocated) AND writes an immutable
 * Audit log. Item.qty is kept as a rollup of location QOH so the
 * Dashboard and Automation low-stock checks keep working.
 *
 * CRUD: rows in sections 1–3 are Editable, Soft-removable (Archive)
 * and Resettable. Section 4 is view-only (+ manual entry).
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Bulk = global.Bulk, Reports = global.Reports;
  var el = U.el;
  var money = function (n) { return U.money(n, App.ctx.school.currency); };

  var TXN_TYPES = [
    { v: 'restock', label: 'Purchase Receipt / Restock' },
    { v: 'sale', label: 'Student Sale' },
    { v: 'staff_issue', label: 'Staff Issue' }
  ];
  function txnLabel(v) { var t = TXN_TYPES.filter(function (x) { return x.v === v; })[0]; return t ? t.label : v; }

  /* ---------------- settings / toggles ---------------- */
  function defaultSettings() {
    return {
      id: 'inv-1',
      toggles: { supplierDetails: false, batchTracking: false, multiCampus: false, auditSnapshot: false },
      storeLocations: ['Main Admin Store', 'Bookshop'],
      reasonCodes: ['New Supply / Restock', 'Damaged / Torn', 'Classroom Allocation', 'Physical Count Discrepancy', 'Theft / Loss', 'Student Sale', 'Staff Issue'],
      paymentStatuses: ['Cash/MoMo Paid', 'Billed to School Fees Ledger', 'Not Applicable (Staff Internal Use)'],
      branches: ['Main Campus']
    };
  }
  function getSettings() {
    return DB.singleton('inventorySettings').then(function (s) {
      var d = defaultSettings();
      if (!s) return d;
      s.toggles = Object.assign({}, d.toggles, s.toggles || {});
      ['storeLocations', 'reasonCodes', 'paymentStatuses', 'branches'].forEach(function (k) { if (!s[k] || !s[k].length) s[k] = d[k]; });
      s.id = s.id || 'inv-1';
      return s;
    });
  }
  function saveSettings(s) { return DB.setSingleton('inventorySettings', s); }

  /* ---------------- shell ---------------- */
  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Inventory & Asset Management' })]));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Item Master';
    var TABS = ['Item Master', 'Stock Levels', 'Allocation & Sales', 'Audit Ledger', 'Reports', 'Settings'];
    TABS.forEach(function (t) { var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b); });
    container.appendChild(bar); container.appendChild(panel);
    function draw() {
      U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); });
      U.clear(panel);
      getSettings().then(function (S) {
        if (active === 'Item Master') tabItems(panel, S);
        else if (active === 'Stock Levels') tabStock(panel, S);
        else if (active === 'Allocation & Sales') tabTxns(panel, S);
        else if (active === 'Audit Ledger') tabAudit(panel, S);
        else if (active === 'Reports') tabReports(panel, S);
        else tabSettings(panel, S);
      });
    }
    draw();
  }

  /* ============ shared stock engine ============ */
  // Recompute item.qty = Σ QOH of its non-archived stock rows.
  function recomputeRollup(itemId) {
    return DB.all('inventoryStock').then(function (rows) {
      var sum = rows.filter(function (r) { return r.item_id === itemId && !r.archived; })
        .reduce(function (a, r) { return a + Number(r.qoh || 0); }, 0);
      return DB.find('inventoryItems', function (i) { return i.id === itemId; }).then(function (m) {
        if (m[0]) return DB.update('inventoryItems', m[0].id, { qty: sum });
      });
    });
  }
  // Find (or create) the stock row for an item at a location; apply a QOH/allocated delta.
  function adjustStock(itemId, itemName, location, dQoh, dAlloc, reorderIfNew) {
    return DB.all('inventoryStock').then(function (rows) {
      var row = rows.filter(function (r) { return r.item_id === itemId && r.location === location && !r.archived; })[0];
      if (row) {
        return DB.update('inventoryStock', row.id, {
          qoh: Number(row.qoh || 0) + dQoh,
          allocated: Math.max(0, Number(row.allocated || 0) + (dAlloc || 0))
        });
      }
      return DB.insert('inventoryStock', {
        item_id: itemId, item_name: itemName, location: location,
        qoh: dQoh, allocated: Math.max(0, dAlloc || 0),
        reorder_level: reorderIfNew || 0, batch: {}, archived: false
      });
    });
  }
  // Immutable audit entry.
  function logAudit(item, deltaText, qtyChange, reason, before, after, snapshotOn) {
    var rec = {
      log_id: 'LOG-' + Date.now().toString(36).toUpperCase(),
      ts: new Date().toISOString(), item_id: item.id, item_name: item.name,
      qty_change: qtyChange, reason_code: reason, user: App.user.name
    };
    if (snapshotOn) rec.snapshot = 'From: ' + before + ' → To: ' + after;
    return DB.insert('inventoryAudit', rec);
  }

  /* ============ SECTION 1: ITEM MASTER ============ */
  function tabItems(panel, S) {
    Promise.all([DB.all('inventoryItems'), DB.all('inventoryCategories'), Promise.resolve(App.ctx.classes || [])]).then(function (r) {
      var items = r[0], cats = r[1], classes = r[2];
      var state = { type: '', cat: '', cls: '', showArchived: false };

      var tools = el('div', { class: 'toolbar' });
      if (!App.readOnly) {
        tools.appendChild(el('button', { class: 'btn', text: '+ Add item', onclick: function () { editItem(null, cats, classes, S, refresh); } }));
        tools.appendChild(el('button', { class: 'btn ghost sm', text: '⤓ Download template', onclick: function () { downloadItemTemplate(cats); } }));
        tools.appendChild(el('button', { class: 'btn ghost sm', text: '⤒ Upload filled', onclick: function () { uploadItems(cats, refresh); } }));
      }
      // filters
      var typeSel = filterSelect('All types', [['resale', 'Resale Item (Sold to Parents)'], ['asset', 'School Asset / Property']], function (v) { state.type = v; draw(); });
      var catSel = filterSelect('All categories', cats.map(function (c) { return [c.name, c.name]; }), function (v) { state.cat = v; draw(); });
      var clsSel = filterSelect('All classes/forms', classes.map(function (c) { return [c.id, c.name]; }), function (v) { state.cls = v; draw(); });
      var arch = el('label', { class: 'check-label' }, [(function () { var c = el('input', { type: 'checkbox' }); c.addEventListener('change', function () { state.showArchived = c.checked; draw(); }); return c; })(), document.createTextNode(' Show archived')]);
      tools.appendChild(el('span', { class: 'muted', text: 'Filter:' }));
      tools.appendChild(typeSel); tools.appendChild(catSel); tools.appendChild(clsSel); tools.appendChild(arch);
      panel.appendChild(tools);

      var listArea = el('div'); panel.appendChild(listArea);
      draw();
      function draw() {
        U.clear(listArea);
        var supplierOn = S.toggles.supplierDetails;
        var rows = items.filter(function (i) {
          if (!state.showArchived && i.archived) return false;
          if (state.showArchived && !i.archived) return false;
          if (state.type && (i.inventory_type || 'resale') !== state.type) return false;
          if (state.cat && i.category !== state.cat) return false;
          if (state.cls && i.target_class !== state.cls) return false;
          return true;
        });
        var low = items.filter(function (i) { return !i.archived && Number(i.qty) <= Number(i.low_threshold || 0); });
        if (low.length && !state.showArchived) listArea.appendChild(el('div', { class: 'note', html: '<b>Low stock:</b> ' + low.map(function (i) { return U.esc(i.name) + ' (' + (i.qty || 0) + ')'; }).join(', ') }));
        var c = el('div', { class: 'card' });
        var heads = ['SKU', 'Item', 'Type', 'Category', 'Class/Form', 'Cost', 'Selling', 'Qty'];
        if (supplierOn) heads.splice(7, 0, 'Supplier');
        heads.push('');
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        rows.forEach(function (i) {
          var isAsset = (i.inventory_type === 'asset');
          var lowFlag = Number(i.qty) <= Number(i.low_threshold || 0);
          var tds = [
            el('td', { text: i.sku || '—' }),
            el('td', { text: i.name }),
            el('td', {}, [el('span', { class: 'tag ' + (isAsset ? '' : 'req'), text: isAsset ? 'Asset' : 'Resale' })]),
            el('td', { text: i.category || '—' }),
            el('td', { text: className(classes, i.target_class) }),
            el('td', { text: i.cost_price != null ? money(i.cost_price) : '—' }),
            el('td', { text: isAsset ? 'N/A' : (i.selling_price != null ? money(i.selling_price) : '—') }),
            el('td', {}, [el('span', { class: lowFlag ? 'tag req' : 'tag', text: i.qty || 0 })])
          ];
          if (supplierOn) tds.splice(7, 0, el('td', { text: supplierText(i.supplier) }));
          tds.push(el('td', {}, [rowActions(i, 'inventoryItems', refresh, {
            edit: function () { editItem(i, cats, classes, S, refresh); },
            reset: function () {
              U.confirm('Reset "' + i.name + '" selling price back to its base cost rate (clears custom margin)?', function () {
                DB.update('inventoryItems', i.id, { selling_price: Number(i.cost_price || 0) }).then(function () { U.toast('Reset to base rate.'); refresh(); });
              });
            }
          })]));
          tb.appendChild(el('tr', {}, tds));
        });
        if (!rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: heads.length, html: '<span class=empty>No items match.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); listArea.appendChild(c);
      }
      function refresh() { U.clear(panel); tabItems(panel, S); }
    });
  }

  function editItem(i, cats, classes, S, done) {
    var fields = [
      { name: 'sku', label: 'Item ID / SKU', placeholder: 'e.g. BK-MAT-JHS3' },
      { name: 'name', label: 'Item name', required: true },
      { name: 'inventory_type', label: 'Inventory type', type: 'select', options: [{ value: 'resale', label: 'Resale Item (Sold to Parents)' }, { value: 'asset', label: 'School Asset / Property (Internal Use)' }] },
      { name: 'category', label: 'Category / Department', type: 'select', options: cats.map(function (c) { return c.name; }) },
      { name: 'target_class', label: 'Target class / form', type: 'select', options: [{ value: '', label: '— none —' }].concat(classes.map(function (c) { return { value: c.id, label: c.name }; })) },
      { name: 'cost_price', label: 'Cost price (' + App.ctx.school.currency + ')', type: 'number', min: 0 },
      { name: 'selling_price', label: 'Selling price (' + App.ctx.school.currency + ') — N/A for assets', type: 'number', min: 0 },
      { name: 'unit', label: 'Unit (pcs, box…)' },
      { name: 'low_threshold', label: 'Reorder / low-stock level', type: 'number', min: 0 }
    ];
    var sup = (i && i.supplier) || {};
    if (S.toggles.supplierDetails) {
      fields.push({ name: 'sup_name', label: 'Supplier name' });
      fields.push({ name: 'sup_contact', label: 'Supplier contact' });
      fields.push({ name: 'sup_location', label: 'Supplier location (Accra, Kumasi…)' });
    }
    var seed = Object.assign({ inventory_type: 'resale', cost_price: 0, selling_price: 0, low_threshold: 5,
      sup_name: sup.name, sup_contact: sup.contact, sup_location: sup.location }, i || {});
    var f = U.form(fields, seed);
    f.classList.add('form-grid');
    U.modal({ title: i ? 'Edit item' : 'Add item', wide: true, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        var v = f.readValues(); if (!String(v.name).trim()) return U.toast('Name required', 'err');
        var rec = {
          sku: v.sku, name: v.name, inventory_type: v.inventory_type, category: v.category,
          target_class: v.target_class, cost_price: Number(v.cost_price) || 0,
          selling_price: v.inventory_type === 'asset' ? 0 : (Number(v.selling_price) || 0),
          unit: v.unit, unit_cost: Number(v.cost_price) || 0, low_threshold: Number(v.low_threshold) || 0
        };
        if (S.toggles.supplierDetails) rec.supplier = { name: v.sup_name, contact: v.sup_contact, location: v.sup_location };
        var p = i ? DB.update('inventoryItems', i.id, rec) : DB.insert('inventoryItems', Object.assign({ qty: 0, archived: false }, rec));
        p.then(function () { x(); U.toast('Saved.'); done(); });
      } }
    ] });
  }

  /* ---------- Bulk item upload ---------- */
  function downloadItemTemplate(cats) {
    var rows = [['sku', 'name', 'inventory_type', 'category', 'unit', 'cost_price', 'selling_price', 'low_threshold']];
    rows.push(['BK-SAMPLE', 'Sample Textbook', 'resale', cats[0] ? cats[0].name : '', 'pcs', '15', '20', '5']);
    Bulk.download('inventory-items-template.csv', rows);
    U.toast('Template downloaded. Fill it and upload. (Type: "resale" or "asset". Category must match an existing Inventory category, or leave blank.)');
  }
  function uploadItems(cats, done) {
    Bulk.pickFile().then(function (file) {
      var res = Bulk.processUpload(file.rows, ['name'], function (row) {
        var errs = [];
        if (!row.name) errs.push('name missing');
        var type = (row.inventory_type || 'resale').toLowerCase();
        if (type !== 'resale' && type !== 'asset') errs.push('inventory_type must be "resale" or "asset"');
        var cat = '';
        if (row.category) {
          var match = cats.filter(function (c) { return c.name.toLowerCase() === row.category.toLowerCase(); })[0];
          if (!match) errs.push('unknown category "' + row.category + '"');
          else cat = match.name;
        }
        var cost = row.cost_price === '' ? 0 : Number(row.cost_price);
        var sell = row.selling_price === '' ? 0 : Number(row.selling_price);
        var low = row.low_threshold === '' ? 0 : Number(row.low_threshold);
        if (isNaN(cost) || cost < 0) errs.push('cost_price must be a number >= 0');
        if (isNaN(sell) || sell < 0) errs.push('selling_price must be a number >= 0');
        if (isNaN(low) || low < 0) errs.push('low_threshold must be a number >= 0');
        if (errs.length) return { ok: false, errors: errs };
        return { ok: true, value: {
          sku: row.sku || '', name: row.name, inventory_type: type, category: cat, unit: row.unit || '',
          cost_price: cost, selling_price: type === 'asset' ? 0 : sell, unit_cost: cost,
          low_threshold: low, qty: 0, archived: false
        } };
      });
      Bulk.summaryModal('Import inventory items', res, function (valid) {
        Promise.all(valid.map(function (v) { return DB.insert('inventoryItems', v); }))
          .then(function () { U.toast('Imported ' + valid.length + ' item(s). Add opening stock quantities in Stock Levels.'); done(); });
      });
    }).catch(function () { /* user cancelled file picker */ });
  }

  /* ============ SECTION 2: STOCK LEVELS ============ */
  function tabStock(panel, S) {
    Promise.all([DB.all('inventoryStock'), DB.all('inventoryItems')]).then(function (r) {
      var stock = r[0], items = r[1].filter(function (i) { return !i.archived; });
      var state = { loc: '', low: false, showArchived: false };
      var tools = el('div', { class: 'toolbar' });
      if (!App.readOnly) tools.appendChild(el('button', { class: 'btn', text: '+ Add / adjust stock', onclick: function () { editStock(null, items, S, refresh); } }));
      tools.appendChild(el('span', { class: 'muted', text: 'Filter:' }));
      tools.appendChild(filterSelect('All locations', S.storeLocations.map(function (l) { return [l, l]; }), function (v) { state.loc = v; draw(); }));
      tools.appendChild(filterSelect('All stock', [['low', 'Low stock only']], function (v) { state.low = (v === 'low'); draw(); }));
      tools.appendChild(el('label', { class: 'check-label' }, [(function () { var c = el('input', { type: 'checkbox' }); c.addEventListener('change', function () { state.showArchived = c.checked; draw(); }); return c; })(), document.createTextNode(' Show archived')]));
      panel.appendChild(tools);
      var area = el('div'); panel.appendChild(area);
      draw();
      function draw() {
        U.clear(area);
        var batchOn = S.toggles.batchTracking;
        var rows = stock.filter(function (s) {
          if (!state.showArchived && s.archived) return false;
          if (state.showArchived && !s.archived) return false;
          if (state.loc && s.location !== state.loc) return false;
          if (state.low && !(Number(s.qoh) <= Number(s.reorder_level || 0))) return false;
          return true;
        });
        var heads = ['Item', 'QOH', 'Allocated', 'Available', 'Location', 'Reorder'];
        if (batchOn) heads.push('Batch / Expiry');
        heads.push('');
        var c = el('div', { class: 'card' });
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        rows.forEach(function (s) {
          var avail = Number(s.qoh || 0) - Number(s.allocated || 0);
          var lowFlag = Number(s.qoh) <= Number(s.reorder_level || 0);
          var tds = [
            el('td', { text: s.item_name }),
            el('td', {}, [el('span', { class: lowFlag ? 'tag req' : 'tag', text: s.qoh || 0 })]),
            el('td', { text: s.allocated || 0 }),
            el('td', { text: avail }),
            el('td', { text: s.location }),
            el('td', { text: s.reorder_level || 0 })
          ];
          if (batchOn) tds.push(el('td', { text: batchText(s.batch) }));
          tds.push(el('td', {}, [rowActions(s, 'inventoryStock', refresh, {
            edit: function () { editStock(s, items, S, refresh); },
            reset: function () { U.confirm('Reset allocated/reserved for this row to 0?', function () { DB.update('inventoryStock', s.id, { allocated: 0 }).then(function () { recomputeRollup(s.item_id).then(function () { U.toast('Reset.'); refresh(); }); }); }); },
            afterArchive: function () { recomputeRollup(s.item_id); }
          })]));
          tb.appendChild(el('tr', {}, tds));
        });
        if (!rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: heads.length, html: '<span class=empty>No stock rows match.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); area.appendChild(c);
      }
      function refresh() { U.clear(panel); tabStock(panel, S); }
    });
  }

  function editStock(s, items, S, done) {
    var fields = [
      { name: 'item_id', label: 'Item', type: 'select', options: items.map(function (i) { return { value: i.id, label: (i.sku ? i.sku + ' · ' : '') + i.name }; }) },
      { name: 'location', label: 'Store location', type: 'select', options: S.storeLocations.map(function (l) { return l; }) },
      { name: 'qoh', label: 'Quantity on hand (QOH)', type: 'number', min: 0 },
      { name: 'allocated', label: 'Allocated / reserved stock', type: 'number', min: 0 },
      { name: 'reorder_level', label: 'Reorder level / critical threshold', type: 'number', min: 0 }
    ];
    var batch = (s && s.batch) || {};
    if (S.toggles.batchTracking) {
      fields.push({ name: 'batch_no', label: 'Batch number' });
      fields.push({ name: 'batch_expiry', label: 'Expiry date', type: 'date' });
    }
    var seed = Object.assign({ qoh: 0, allocated: 0, reorder_level: 0, batch_no: batch.no, batch_expiry: batch.expiry }, s || {});
    var f = U.form(fields, seed); f.classList.add('form-grid');
    U.modal({ title: s ? 'Adjust stock' : 'Add / initialise stock', wide: true, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        var v = f.readValues();
        var item = items.filter(function (i) { return i.id === v.item_id; })[0];
        if (!item) return U.toast('Choose an item', 'err');
        var rec = { item_id: v.item_id, item_name: item.name, location: v.location,
          qoh: Number(v.qoh) || 0, allocated: Number(v.allocated) || 0, reorder_level: Number(v.reorder_level) || 0, archived: false };
        if (S.toggles.batchTracking) rec.batch = { no: v.batch_no, expiry: v.batch_expiry };
        var before = s ? Number(s.qoh || 0) : 0;
        var p = s ? DB.update('inventoryStock', s.id, rec) : DB.insert('inventoryStock', rec);
        p.then(function () {
          return recomputeRollup(v.item_id);
        }).then(function () {
          // manual count adjustment is auditable
          if (Number(rec.qoh) !== before) logAudit(item, '', Number(rec.qoh) - before, 'Physical Count Discrepancy', before, rec.qoh, S.toggles.auditSnapshot);
          x(); U.toast('Stock saved.'); done();
        });
      } }
    ] });
  }

  /* ============ SECTION 3: ALLOCATION & SALES ============ */
  function tabTxns(panel, S) {
    Promise.all([DB.all('inventoryTransactions'), DB.all('inventoryItems')]).then(function (r) {
      var txns = r[0], items = r[1];
      var state = { type: '', from: '', to: '', pay: '', showArchived: false };
      var tools = el('div', { class: 'toolbar' });
      if (!App.readOnly) {
        tools.appendChild(el('button', { class: 'btn', text: '+ New transaction', onclick: function () { newTxn(items, S, refresh); } }));
        tools.appendChild(el('button', { class: 'btn ghost sm', text: '⤓ Template', onclick: function () { downloadTxnTemplate(items); } }));
        tools.appendChild(el('button', { class: 'btn gold sm', text: '⤒ Upload', onclick: function () { uploadTxns(items, S, refresh); } }));
      }
      tools.appendChild(el('span', { class: 'muted', text: 'Filter:' }));
      tools.appendChild(filterSelect('All types', TXN_TYPES.map(function (t) { return [t.v, t.label]; }), function (v) { state.type = v; draw(); }));
      tools.appendChild(filterSelect('All payment status', S.paymentStatuses.map(function (p) { return [p, p]; }), function (v) { state.pay = v; draw(); }));
      var fromInp = el('input', { type: 'date' }); var toInp = el('input', { type: 'date' });
      fromInp.addEventListener('change', function () { state.from = fromInp.value; draw(); });
      toInp.addEventListener('change', function () { state.to = toInp.value; draw(); });
      tools.appendChild(el('span', { class: 'muted', text: 'From' })); tools.appendChild(fromInp);
      tools.appendChild(el('span', { class: 'muted', text: 'To' })); tools.appendChild(toInp);
      tools.appendChild(el('label', { class: 'check-label' }, [(function () { var c = el('input', { type: 'checkbox' }); c.addEventListener('change', function () { state.showArchived = c.checked; draw(); }); return c; })(), document.createTextNode(' Show archived')]));
      panel.appendChild(tools);
      var area = el('div'); panel.appendChild(area);
      draw();
      function draw() {
        U.clear(area);
        var multi = S.toggles.multiCampus;
        var rows = txns.slice().reverse().filter(function (m) {
          if (!state.showArchived && m.archived) return false;
          if (state.showArchived && !m.archived) return false;
          if (state.type && m.type !== state.type) return false;
          if (state.pay && m.payment_status !== state.pay) return false;
          if (state.from && (m.date || '') < state.from) return false;
          if (state.to && (m.date || '') > state.to) return false;
          return true;
        });
        var heads = ['Txn ID', 'Type', 'Item', 'Qty', 'Recipient', 'Payment'];
        if (multi) heads.push('Branch route');
        heads.push('Date'); heads.push('');
        var c = el('div', { class: 'card' });
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        rows.forEach(function (m) {
          var tds = [
            el('td', { text: m.txn_id }),
            el('td', {}, [el('span', { class: 'tag ' + (m.type === 'restock' ? '' : 'req'), text: txnLabel(m.type) })]),
            el('td', { text: m.item_name }),
            el('td', { text: (m.type === 'restock' ? '+' : '−') + m.qty }),
            el('td', { text: m.recipient_id || '—' }),
            el('td', { text: m.payment_status || '—' })
          ];
          if (multi) tds.push(el('td', { text: m.branch_route || '—' }));
          tds.push(el('td', { text: U.fmtDate(m.date) }));
          tds.push(el('td', {}, [rowActions(m, 'inventoryTransactions', refresh, {
            edit: function () { editTxn(m, S, refresh); }
          })]));
          tb.appendChild(el('tr', {}, tds));
        });
        if (!rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: heads.length, html: '<span class=empty>No transactions match.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); area.appendChild(c);
      }
      function refresh() { U.clear(panel); tabTxns(panel, S); }
    });
  }

  function newTxn(items, S, done) {
    Promise.all([DB.all('inventoryStock'), DB.all('students'), DB.all('staff')]).then(function (r) {
      var stock = r[0], students = r[1], staff = r[2];
      var liveItems = items.filter(function (i) { return !i.archived; });
      var typeSel = el('select');
      TXN_TYPES.forEach(function (t) { typeSel.appendChild(el('option', { value: t.v, text: t.label })); });
      var body = el('div');
      var host = el('div'); body.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Transaction type' }), typeSel])); body.appendChild(host);
      typeSel.addEventListener('change', build);
      build();
      function build() {
        U.clear(host);
        var type = typeSel.value;
        var itemSel = selectOpts(liveItems.map(function (i) { return { value: i.id, label: (i.sku ? i.sku + ' · ' : '') + i.name }; }));
        var locSel = selectOpts(S.storeLocations.map(function (l) { return { value: l, label: l }; }));
        var qtyInp = el('input', { type: 'number', min: 1, value: 1 });
        host.appendChild(field('Item', itemSel));
        host.appendChild(field('Store location', locSel));
        host.appendChild(field('Quantity', qtyInp));
        var recipSel, paySel, branchSel;
        if (type === 'sale') {
          recipSel = selectOpts([{ value: '', label: '— select student —' }].concat(students.map(function (s) { return { value: s.student_id, label: s.student_id + ' · ' + (s.first_name + ' ' + s.last_name).trim() }; })));
          host.appendChild(field('Recipient (student)', recipSel));
          paySel = selectOpts(S.paymentStatuses.filter(function (p) { return p.indexOf('Not Applicable') === -1; }).map(function (p) { return { value: p, label: p }; }));
          host.appendChild(field('Payment status', paySel));
        } else if (type === 'staff_issue') {
          recipSel = selectOpts([{ value: '', label: '— select staff —' }].concat(staff.map(function (s) { return { value: s.staff_id, label: s.staff_id + ' · ' + s.name }; })));
          host.appendChild(field('Recipient (staff)', recipSel));
          paySel = selectOpts([{ value: 'Not Applicable (Staff Internal Use)', label: 'Not Applicable (Staff Internal Use)' }]);
          host.appendChild(field('Payment status', paySel));
        } else { // restock
          recipSel = el('input', { type: 'text', placeholder: 'Supplier / PO reference' });
          host.appendChild(field('Supplier / reference', recipSel));
          paySel = selectOpts([{ value: 'Not Applicable (Staff Internal Use)', label: 'N/A (incoming stock)' }]);
        }
        if (S.toggles.multiCampus) { branchSel = selectOpts(S.branches.map(function (b) { return { value: b, label: b }; })); host.appendChild(field('Branch route', branchSel)); }
        host._read = function () {
          return { type: type, item_id: itemSel.value, location: locSel.value, qty: Number(qtyInp.value) || 0,
            recipient_id: recipSel.value, payment_status: paySel ? paySel.value : 'Not Applicable (Staff Internal Use)',
            branch_route: branchSel ? branchSel.value : '' };
        };
      }
      U.modal({ title: 'New inventory transaction', wide: true, body: body, actions: [
        { label: 'Cancel', onClick: function (x) { x(); } },
        { label: 'Commit', kind: 'gold', onClick: function (x) {
          var v = host._read();
          var item = liveItems.filter(function (i) { return i.id === v.item_id; })[0];
          if (!item) return U.toast('Choose an item', 'err');
          if (!v.qty || v.qty < 1) return U.toast('Enter a quantity', 'err');
          var out = (v.type !== 'restock');
          if (out) {
            var row = stock.filter(function (s2) { return s2.item_id === v.item_id && s2.location === v.location && !s2.archived; })[0];
            var avail = row ? Number(row.qoh || 0) : 0;
            if (avail < v.qty) return U.toast('Only ' + avail + ' in ' + v.location + '. Restock first.', 'err');
          }
          var dQoh = out ? -v.qty : v.qty;
          var before = (function () { var row2 = stock.filter(function (s2) { return s2.item_id === v.item_id && s2.location === v.location && !s2.archived; })[0]; return row2 ? Number(row2.qoh || 0) : 0; })();
          var reason = v.type === 'restock' ? 'New Supply / Restock' : v.type === 'sale' ? 'Student Sale' : 'Staff Issue';
          DB.nextSeq('invtxn').then(function (n) {
            var txnId = 'TXN-' + String(n).padStart(5, '0');
            var amount = v.type === 'sale' ? (Number(item.selling_price || 0) * v.qty) : 0;
            return DB.insert('inventoryTransactions', {
              txn_id: txnId, type: v.type, item_id: v.item_id, item_name: item.name, qty: v.qty,
              recipient_id: v.recipient_id, payment_status: v.payment_status, amount: amount,
              branch_route: v.branch_route, date: U.todayISO(), by: App.user.name, archived: false
            });
          }).then(function () {
            return adjustStock(v.item_id, item.name, v.location, dQoh, 0, item.low_threshold);
          }).then(function () {
            return recomputeRollup(v.item_id);
          }).then(function () {
            return logAudit(item, '', dQoh, reason, before, before + dQoh, S.toggles.auditSnapshot);
          }).then(function () { x(); U.toast('Transaction committed & stock updated.'); done(); });
        } }
      ] });
    });
  }

  /* ---------- Bulk stock movement upload (daily restock/sale/issue from a paper log) ---------- */
  function downloadTxnTemplate(items) {
    var live = items.filter(function (i) { return !i.archived; });
    var rows = [['type (restock/sale/staff_issue)', 'item_sku_or_name', 'location', 'qty', 'recipient_id', 'payment_status']];
    rows.push(['restock', live[0] ? (live[0].sku || live[0].name) : 'ITEM-SKU', 'Main Admin Store', '10', 'Supplier ABC', '']);
    Bulk.download('stock-movements-template.csv', rows);
    U.toast('Template downloaded. type must be restock, sale, or staff_issue. recipient_id = student_id for sale, staff_id for staff_issue (leave blank for restock).');
  }
  function uploadTxns(items, S, done) {
    var liveItems = items.filter(function (i) { return !i.archived; });
    Promise.all([DB.all('inventoryStock'), DB.all('students'), DB.all('staff')]).then(function (r) {
      var stock = r[0], students = r[1], staff = r[2];
      var studentIds = {}; students.forEach(function (s) { studentIds[s.student_id] = true; });
      var staffIds = {}; staff.forEach(function (s) { staffIds[s.staff_id] = true; });
      Bulk.pickFile().then(function (file) {
        var res = Bulk.processUpload(file.rows, ['type (restock/sale/staff_issue)', 'item_sku_or_name', 'location', 'qty'], function (row) {
          var errs = [];
          var type = (row['type (restock/sale/staff_issue)'] || '').toLowerCase();
          if (['restock', 'sale', 'staff_issue'].indexOf(type) === -1) errs.push('type must be restock, sale, or staff_issue');
          var itemKey = (row.item_sku_or_name || '').toLowerCase();
          var item = liveItems.filter(function (i) { return (i.sku && i.sku.toLowerCase() === itemKey) || i.name.toLowerCase() === itemKey; })[0];
          if (!item) errs.push('unknown item "' + row.item_sku_or_name + '"');
          var loc = row.location;
          if (S.storeLocations.indexOf(loc) === -1) errs.push('unknown location "' + loc + '"');
          var qty = Number(row.qty);
          if (isNaN(qty) || qty < 1) errs.push('qty must be a positive number');
          if (type === 'sale' && !studentIds[row.recipient_id]) errs.push('recipient_id must be a known student_id for sale');
          if (type === 'staff_issue' && !staffIds[row.recipient_id]) errs.push('recipient_id must be a known staff_id for staff_issue');
          if (errs.length) return { ok: false, errors: errs };
          return { ok: true, value: {
            type: type, item_id: item ? item.id : null, item_name: item ? item.name : '', location: loc, qty: qty,
            recipient_id: row.recipient_id || '', payment_status: row.payment_status || (type === 'staff_issue' ? 'Not Applicable (Staff Internal Use)' : '')
          } };
        });
        Bulk.summaryModal('Import stock movements', res, function (valid) {
          var i = 0, imported = 0;
          function step() {
            if (i >= valid.length) { U.toast('Imported ' + imported + ' of ' + valid.length + ' movement(s).'); done(); return; }
            var v = valid[i++];
            var item = liveItems.filter(function (x) { return x.id === v.item_id; })[0];
            var out = v.type !== 'restock';
            var row2 = stock.filter(function (s2) { return s2.item_id === v.item_id && s2.location === v.location && !s2.archived; })[0];
            var avail = row2 ? Number(row2.qoh || 0) : 0;
            if (out && avail < v.qty) { U.toast('Skipped ' + v.item_name + ': only ' + avail + ' available in ' + v.location + '.', 'warn'); step(); return; }
            var dQoh = out ? -v.qty : v.qty;
            var before = avail;
            var reason = v.type === 'restock' ? 'New Supply / Restock' : v.type === 'sale' ? 'Student Sale' : 'Staff Issue';
            DB.nextSeq('invtxn').then(function (n) {
              var txnId = 'TXN-' + String(n).padStart(5, '0');
              var amount = v.type === 'sale' ? (Number(item.selling_price || 0) * v.qty) : 0;
              return DB.insert('inventoryTransactions', {
                txn_id: txnId, type: v.type, item_id: v.item_id, item_name: v.item_name, qty: v.qty,
                recipient_id: v.recipient_id, payment_status: v.payment_status, amount: amount,
                date: U.todayISO(), by: App.user.name, archived: false
              });
            }).then(function () {
              return adjustStock(v.item_id, v.item_name, v.location, dQoh, 0, item.low_threshold);
            }).then(function () {
              return recomputeRollup(v.item_id);
            }).then(function () {
              return logAudit(item, '', dQoh, reason, before, before + dQoh, S.toggles.auditSnapshot);
            }).then(function () {
              // keep the in-memory stock snapshot in sync so subsequent rows in this
              // batch see the running balance, not the pre-upload availability.
              if (row2) row2.qoh = before + dQoh; else stock.push({ item_id: v.item_id, location: v.location, qoh: before + dQoh, archived: false });
              imported++; step();
            });
          }
          step();
        });
      }).catch(function () { /* user cancelled file picker */ });
    });
  }

  // Edit only safe fields (payment status / recipient / branch) — qty & type are locked to keep stock integrity.
  function editTxn(m, S, done) {
    var fields = [
      { name: 'payment_status', label: 'Payment status', type: 'select', options: S.paymentStatuses.map(function (p) { return p; }) },
      { name: 'recipient_id', label: 'Recipient ID' }
    ];
    if (S.toggles.multiCampus) fields.push({ name: 'branch_route', label: 'Branch route', type: 'select', options: S.branches.map(function (b) { return b; }) });
    var f = U.form(fields, m);
    U.modal({ title: 'Edit transaction · ' + m.txn_id, body: el('div', {}, [el('div', { class: 'help', text: 'Quantity, item and type are locked to protect stock integrity. To reverse a movement, post a correcting transaction or a manual audit entry.' }), f]), actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) { DB.update('inventoryTransactions', m.id, f.readValues()).then(function () { x(); U.toast('Saved.'); done(); }); } }
    ] });
  }

  /* ============ SECTION 4: AUDIT LEDGER ============ */
  function tabAudit(panel, S) {
    Promise.all([DB.all('inventoryAudit'), DB.all('inventoryItems'), DB.all('inventoryStock')]).then(function (r) {
      var logs = r[0], items = r[1], stock = r[2];
      var state = { reason: '', user: '', from: '', to: '' };
      var users = uniq(logs.map(function (l) { return l.user; }));
      var tools = el('div', { class: 'toolbar' });
      if (!App.readOnly) tools.appendChild(el('button', { class: 'btn', text: '+ Manual audit entry', onclick: function () { manualAudit(items, stock, S, refresh); } }));
      tools.appendChild(el('span', { class: 'muted', text: 'Filter:' }));
      tools.appendChild(filterSelect('All reasons', S.reasonCodes.map(function (c) { return [c, c]; }), function (v) { state.reason = v; draw(); }));
      tools.appendChild(filterSelect('All users', users.map(function (u) { return [u, u]; }), function (v) { state.user = v; draw(); }));
      var fromInp = el('input', { type: 'date' }); var toInp = el('input', { type: 'date' });
      fromInp.addEventListener('change', function () { state.from = fromInp.value; draw(); });
      toInp.addEventListener('change', function () { state.to = toInp.value; draw(); });
      tools.appendChild(el('span', { class: 'muted', text: 'From' })); tools.appendChild(fromInp);
      tools.appendChild(el('span', { class: 'muted', text: 'To' })); tools.appendChild(toInp);
      panel.appendChild(tools);
      panel.appendChild(el('div', { class: 'note', html: 'This ledger is <b>immutable</b> — entries cannot be edited or deleted, for financial security and anti-theft accountability.' }));
      var area = el('div'); panel.appendChild(area);
      draw();
      function draw() {
        U.clear(area);
        var snapOn = S.toggles.auditSnapshot;
        var rows = logs.slice().reverse().filter(function (l) {
          var d = (l.ts || '').slice(0, 10);
          if (state.reason && l.reason_code !== state.reason) return false;
          if (state.user && l.user !== state.user) return false;
          if (state.from && d < state.from) return false;
          if (state.to && d > state.to) return false;
          return true;
        });
        var heads = ['Log ID', 'Timestamp', 'Item', 'Qty Δ', 'Reason', 'User'];
        if (snapOn) heads.push('Before → After');
        var c = el('div', { class: 'card' });
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, heads.map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        rows.forEach(function (l) {
          var pos = Number(l.qty_change) >= 0;
          var tds = [
            el('td', { text: l.log_id }),
            el('td', { text: fmtTs(l.ts) }),
            el('td', { text: l.item_name }),
            el('td', {}, [el('span', { class: 'tag ' + (pos ? '' : 'req'), text: (pos ? '+' : '') + l.qty_change })]),
            el('td', { text: l.reason_code }),
            el('td', { text: l.user || '—' })
          ];
          if (snapOn) tds.push(el('td', { text: l.snapshot || '—' }));
          tb.appendChild(el('tr', {}, tds));
        });
        if (!rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: heads.length, html: '<span class=empty>No audit entries match.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); area.appendChild(c);
      }
      function refresh() { U.clear(panel); tabAudit(panel, S); }
    });
  }

  function manualAudit(items, stock, S, done) {
    var liveItems = items.filter(function (i) { return !i.archived; });
    var fields = [
      { name: 'item_id', label: 'Item', type: 'select', options: liveItems.map(function (i) { return { value: i.id, label: (i.sku ? i.sku + ' · ' : '') + i.name }; }) },
      { name: 'location', label: 'Store location', type: 'select', options: S.storeLocations.map(function (l) { return l; }) },
      { name: 'qty_change', label: 'Quantity change (Δ, e.g. -5 damaged, +100 supply)', type: 'number' },
      { name: 'reason_code', label: 'Reason code', type: 'select', options: S.reasonCodes.map(function (c) { return c; }) },
      { name: 'note', label: 'Note (optional)' }
    ];
    var f = U.form(fields, { qty_change: 0 }); f.classList.add('form-grid');
    U.modal({ title: 'Manual stock audit entry', wide: true, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Commit', kind: 'gold', onClick: function (x) {
        var v = f.readValues();
        var item = liveItems.filter(function (i) { return i.id === v.item_id; })[0];
        if (!item) return U.toast('Choose an item', 'err');
        var delta = Number(v.qty_change) || 0;
        if (!delta) return U.toast('Enter a non-zero change', 'err');
        var row = stock.filter(function (s2) { return s2.item_id === v.item_id && s2.location === v.location && !s2.archived; })[0];
        var before = row ? Number(row.qoh || 0) : 0;
        if (before + delta < 0) return U.toast('Change would push stock below zero.', 'err');
        adjustStock(v.item_id, item.name, v.location, delta, 0, item.low_threshold)
          .then(function () { return recomputeRollup(v.item_id); })
          .then(function () { return logAudit(item, v.note, delta, v.reason_code, before, before + delta, S.toggles.auditSnapshot); })
          .then(function () { x(); U.toast('Audit entry logged & stock updated.'); done(); });
      } }
    ] });
  }

  /* ============ SECTION 5: REPORTS ============ */
  function tabReports(panel, S) {
    var c = el('div', { class: 'card' }, [el('h3', { text: 'Report generation' })]);
    // time period
    var filter = Reports.timeFilter(function () {});
    c.appendChild(filter.node);
    // data scope
    var scopes = { items: true, stock: true, txns: true, audit: false };
    var scopeBox = el('div', { class: 'field' }, [el('label', { text: 'Data scope (tick one or more)' })]);
    [['items', 'Item Master (catalog & prices)'], ['stock', 'Current stock levels & storehouse'], ['txns', 'Sales & allocation logistics'], ['audit', 'Audit trail (damages, losses)']].forEach(function (o) {
      var cb = el('input', { type: 'checkbox' }); cb.checked = scopes[o[0]]; cb.addEventListener('change', function () { scopes[o[0]] = cb.checked; });
      scopeBox.appendChild(el('label', { class: 'check-label', style: 'display:block' }, [cb, document.createTextNode(' ' + o[1])]));
    });
    c.appendChild(scopeBox);
    // format
    var fmtSel = selectOpts([{ value: 'pdf', label: 'PDF document (print / Save as PDF)' }, { value: 'doc', label: 'DOCX / Word document' }, { value: 'csv', label: 'CSV (spreadsheet)' }]);
    c.appendChild(field('Export format', fmtSel));
    var consolidate = { on: false };
    if (S.toggles.multiCampus) c.appendChild(el('label', { class: 'check-label', style: 'display:block;margin:.4rem 0' }, [(function () { var cb = el('input', { type: 'checkbox' }); cb.addEventListener('change', function () { consolidate.on = cb.checked; }); return cb; })(), document.createTextNode(' Consolidate all campuses into one document')]));
    c.appendChild(el('button', { class: 'btn gold', text: '+ Generate Report', onclick: function () { generate(filter.current(), scopes, fmtSel.value, S, consolidate.on, preview); } }));
    panel.appendChild(c);
    var preview = el('div'); panel.appendChild(preview);
  }

  function generate(range, scopes, fmt, S, consolidate, preview) {
    Promise.all([DB.all('inventoryItems'), DB.all('inventoryStock'), DB.all('inventoryTransactions'), DB.all('inventoryAudit'), Promise.resolve(App.ctx.classes || [])]).then(function (r) {
      var items = r[0].filter(function (i) { return !i.archived; });
      var stock = r[1].filter(function (s) { return !s.archived; });
      var txns = r[2].filter(function (m) { return !m.archived && Reports.inRange(m.date, range); });
      var audit = r[3].filter(function (l) { return Reports.inRange((l.ts || '').slice(0, 10), range); });
      var classes = r[4];
      var blocks = []; // { title, headers, rows }
      if (scopes.items) blocks.push({ title: 'Item Master — catalog & prices', headers: ['SKU', 'Item', 'Type', 'Category', 'Class/Form', 'Cost', 'Selling', 'Qty'],
        rows: items.map(function (i) { return [i.sku || '', i.name, i.inventory_type === 'asset' ? 'Asset' : 'Resale', i.category || '', className(classes, i.target_class), i.cost_price || 0, i.inventory_type === 'asset' ? 'N/A' : (i.selling_price || 0), i.qty || 0]; }) });
      if (scopes.stock) blocks.push({ title: 'Stock levels & storehouse status', headers: ['Item', 'Location', 'QOH', 'Allocated', 'Available', 'Reorder'],
        rows: stock.map(function (s) { return [s.item_name, s.location, s.qoh || 0, s.allocated || 0, (Number(s.qoh || 0) - Number(s.allocated || 0)), s.reorder_level || 0]; }) });
      if (scopes.txns) {
        var salesRev = txns.filter(function (m) { return m.type === 'sale'; }).reduce(function (a, m) { return a + Number(m.amount || 0); }, 0);
        blocks.push({ title: 'Sales & allocation logistics · ' + range.label + '  (sales revenue: ' + money(salesRev) + ')', headers: ['Txn ID', 'Type', 'Item', 'Qty', 'Recipient', 'Payment', 'Amount', 'Date'],
          rows: txns.map(function (m) { return [m.txn_id, txnLabel(m.type), m.item_name, (m.type === 'restock' ? '+' : '-') + m.qty, m.recipient_id || '', m.payment_status || '', m.amount || 0, m.date]; }) });
      }
      if (scopes.audit) blocks.push({ title: 'Audit trail · ' + range.label, headers: ['Log ID', 'Timestamp', 'Item', 'Qty Δ', 'Reason', 'User'],
        rows: audit.map(function (l) { return [l.log_id, fmtTs(l.ts), l.item_name, l.qty_change, l.reason_code, l.user || '']; }) });

      if (!blocks.length) { U.clear(preview); preview.appendChild(el('div', { class: 'empty', text: 'Tick at least one data scope, then Generate.' })); return; }

      // live preview
      U.clear(preview);
      var head = el('div', { class: 'flex', style: 'justify-content:space-between;align-items:center' }, [
        el('h3', { text: 'Report preview · ' + range.label }),
        el('div', { class: 'wrap-actions' }, [
          el('button', { class: 'btn sm', text: fmt === 'csv' ? '⤓ Download CSV' : fmt === 'doc' ? '⤓ Download Word (.doc)' : '⤓ PDF / Print', onclick: function () { exportReport(blocks, fmt, range); } })
        ])
      ]);
      var wrap = el('div', { class: 'card' }, [head]);
      if (consolidate) wrap.appendChild(el('div', { class: 'help', text: 'Consolidated across: ' + (S.branches || []).join(', ') }));
      blocks.forEach(function (b) {
        wrap.appendChild(el('h4', { text: b.title }));
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, b.headers.map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        b.rows.forEach(function (row) { tb.appendChild(el('tr', {}, row.map(function (cell, i) { return el('td', { text: (b.headers[i] === 'Cost' || b.headers[i] === 'Selling' || b.headers[i] === 'Amount') && typeof cell === 'number' ? money(cell) : cell }); }))); });
        if (!b.rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: b.headers.length, html: '<span class=empty>No data in this period.</span>' })]));
        t.appendChild(tb); wrap.appendChild(el('div', { class: 'table-wrap' }, [t]));
      });
      preview.appendChild(wrap);
    });
  }

  function exportReport(blocks, fmt, range) {
    var sc = App.ctx.school;
    if (fmt === 'csv') {
      var rows = [];
      blocks.forEach(function (b) { rows.push([b.title]); rows.push(b.headers); b.rows.forEach(function (r) { rows.push(r); }); rows.push([]); });
      return Bulk.download('inventory-report-' + U.todayISO() + '.csv', rows);
    }
    var brand = (App.themeHex ? App.themeHex().primary : '#0f5e5e');
    var html = '<h1>' + U.esc(sc.name) + '</h1><h3>Inventory Report — ' + U.esc(range.label) + ' · ' + U.fmtDate(U.todayISO()) + '</h3>';
    blocks.forEach(function (b) {
      html += '<h2>' + U.esc(b.title) + '</h2><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%"><thead><tr>' +
        b.headers.map(function (h) { return '<th style="background:' + brand + ';color:#fff;text-align:left">' + U.esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>';
      b.rows.forEach(function (r) { html += '<tr>' + r.map(function (c) { return '<td>' + U.esc(c) + '</td>'; }).join('') + '</tr>'; });
      if (!b.rows.length) html += '<tr><td colspan="' + b.headers.length + '">No data.</td></tr>';
      html += '</tbody></table><br>';
    });
    if (fmt === 'doc') {
      var docHtml = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>' + html + '</body></html>';
      var blob = new Blob(['﻿', docHtml], { type: 'application/msword' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'inventory-report-' + U.todayISO() + '.doc'; document.body.appendChild(a); a.click(); document.body.removeChild(a);
      return U.toast('Word document downloaded.');
    }
    // pdf via print window
    var w = window.open('', '_blank');
    w.document.write('<html><head><title>Inventory Report</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:24px}table{border-collapse:collapse;width:100%;margin-bottom:16px}th,td{border:1px solid #999;padding:4px;text-align:left;font-size:12px}th{background:' + brand + ';color:#fff}h1,h2,h3{color:' + brand + '}</style></head><body>' + html + '</body></html>');
    w.document.close(); w.focus(); setTimeout(function () { w.print(); }, 300);
  }

  /* ============ SETTINGS (toggles + lists) ============ */
  function tabSettings(panel, S) {
    var work = JSON.parse(JSON.stringify(S));
    var c = el('div', { class: 'card' }, [el('h3', { text: 'Feature toggles (uncommon fields)' })]);
    c.appendChild(el('div', { class: 'help', text: 'Turn these ON only if your school needs them. When OFF, the related columns and form inputs are stripped everywhere to keep screens clean.' }));
    [['supplierDetails', 'Supplier details (vendor name, contact, location) on items'],
     ['batchTracking', 'Batch / expiry tracking (kitchen dry food, lab chemicals)'],
     ['multiCampus', 'Multi-campus / branch routing on transfers & reports'],
     ['auditSnapshot', 'Before/After snapshot text in the audit ledger']].forEach(function (o) {
      var cb = el('input', { type: 'checkbox' }); cb.checked = !!work.toggles[o[0]];
      cb.addEventListener('change', function () { work.toggles[o[0]] = cb.checked; });
      c.appendChild(el('label', { class: 'check-label', style: 'display:block;margin:.3rem 0' }, [cb, document.createTextNode(' ' + o[1])]));
    });
    panel.appendChild(c);

    var c2 = el('div', { class: 'card' }, [el('h3', { text: 'Configuration lists' })]);
    c2.appendChild(listEditor('Store locations', work.storeLocations));
    c2.appendChild(listEditor('Audit reason codes', work.reasonCodes));
    c2.appendChild(listEditor('Payment statuses', work.paymentStatuses));
    c2.appendChild(listEditor('Campuses / branches', work.branches));
    panel.appendChild(c2);

    panel.appendChild(el('div', { class: 'card' }, [el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn gold', text: 'Save inventory settings', onclick: function () {
        ['storeLocations', 'reasonCodes', 'paymentStatuses', 'branches'].forEach(function (k) { work[k] = work[k].map(function (x) { return String(x).trim(); }).filter(Boolean); });
        saveSettings(work).then(function () { U.toast('Inventory settings saved.'); render(U.$('#view')); });
      } }),
      el('button', { class: 'btn ghost', text: 'Reset to defaults', onclick: function () {
        U.confirm('Reset inventory toggles and lists to defaults?', function () { saveSettings(defaultSettings()).then(function () { U.toast('Reset.'); render(U.$('#view')); }); });
      } })
    ])]));
  }

  /* ============ shared UI helpers ============ */
  function rowActions(rec, coll, refresh, opts) {
    opts = opts || {};
    var box = el('div', { class: 'wrap-actions' });
    if (App.readOnly) return box;
    if (opts.edit) box.appendChild(el('button', { class: 'btn sm', text: 'Edit', onclick: opts.edit }));
    if (opts.reset) box.appendChild(el('button', { class: 'btn sm ghost', text: 'Reset', onclick: opts.reset }));
    if (rec.archived) {
      box.appendChild(el('button', { class: 'btn sm gold', text: 'Restore', onclick: function () {
        DB.update(coll, rec.id, { archived: false }).then(function () { if (opts.afterArchive) opts.afterArchive(); U.toast('Restored.'); refresh(); });
      } }));
    } else {
      box.appendChild(el('button', { class: 'btn sm danger', text: 'Archive', onclick: function () {
        U.confirm('Archive (soft-remove) this record? It stays in the database for financial tracing.', function () {
          DB.update(coll, rec.id, { archived: true }).then(function () { if (opts.afterArchive) opts.afterArchive(); U.toast('Archived.'); refresh(); });
        });
      } }));
    }
    return box;
  }
  function filterSelect(allLabel, opts, onChange) {
    var s = el('select');
    s.appendChild(el('option', { value: '', text: allLabel }));
    opts.forEach(function (o) { s.appendChild(el('option', { value: o[0], text: o[1] })); });
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }
  function selectOpts(opts) {
    var s = el('select');
    opts.forEach(function (o) { s.appendChild(el('option', { value: o.value, text: o.label })); });
    return s;
  }
  function field(label, node) { return el('div', { class: 'field' }, [el('label', { text: label }), node]); }
  function listEditor(title, arr) {
    var box = el('div', { class: 'field' }, [el('label', { text: title })]);
    var listBox = el('div');
    function redraw() {
      U.clear(listBox);
      arr.forEach(function (item, i) {
        var inp = el('input', { type: 'text', value: item, style: 'flex:1' });
        inp.addEventListener('input', function () { arr[i] = inp.value; });
        listBox.appendChild(el('div', { class: 'flex', style: 'margin-bottom:.25rem;gap:.4rem' }, [inp, el('button', { class: 'btn sm danger', text: '✕', onclick: function () { arr.splice(i, 1); redraw(); } })]));
      });
      listBox.appendChild(el('button', { class: 'btn sm ghost', text: '+ Add', onclick: function () { arr.push('New'); redraw(); } }));
    }
    redraw(); box.appendChild(listBox); return box;
  }
  function className(classes, id) { if (!id) return '—'; var c = (classes || []).filter(function (x) { return x.id === id; })[0]; return c ? c.name : id; }
  function supplierText(s) { if (!s) return '—'; return [s.name, s.location].filter(Boolean).join(' · ') || '—'; }
  function batchText(b) { if (!b || (!b.no && !b.expiry)) return '—'; return [b.no, b.expiry ? U.fmtDate(b.expiry) : ''].filter(Boolean).join(' · '); }
  function fmtTs(ts) { if (!ts) return '—'; var d = new Date(ts); if (isNaN(d)) return ts; return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function uniq(a) { var o = {}; return a.filter(function (x) { if (!x || o[x]) return false; o[x] = 1; return true; }); }

  global.Views = global.Views || {};
  global.Views.inventory = { title: 'Inventory', render: render };
})(window);

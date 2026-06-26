/* ============================================================
 * administration.js — Staff records + cross-cutting reports
 * (exam, finance, attendance) with time filters and exports.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Bulk = global.Bulk,
    Reports = global.Reports, FL = global.FinanceLib, Academics = global.Academics, G = global.Grading;
  var el = U.el;

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Administration & Reporting' })]));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Reports';
    ['Reports', 'Staff', 'Permissions'].forEach(function (t) { var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b); });
    container.appendChild(bar); container.appendChild(panel);
    function draw() { U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); }); U.clear(panel);
      if (active === 'Staff') tabStaff(panel); else if (active === 'Permissions') tabPerms(panel); else tabReports(panel); }
    draw();
  }

  /* ---------------- Reports ---------------- */
  function tabReports(panel) {
    var sub = el('div', { class: 'tabs' }); var area = el('div'); var which = 'exam';
    [['exam', 'Exam summary'], ['finance', 'Finance'], ['attendance', 'Attendance']].forEach(function (o) {
      var b = el('button', { text: o[1], onclick: function () { which = o[0]; redraw(); } }); b._w = o[0]; sub.appendChild(b);
    });
    panel.appendChild(sub); panel.appendChild(area);
    function redraw() { U.$all('button', sub).forEach(function (b) { b.classList.toggle('active', b._w === which); }); U.clear(area);
      if (which === 'exam') examReport(area); else if (which === 'finance') financeReport(area); else attendanceReport(area); }
    redraw();
  }

  function examReport(area) {
    var term = App.ctx.academic.current_term;
    var classes = App.ctx.classes.slice().sort(function (a, b) { return a.sort - b.sort; });
    var clsSel = el('select'); classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
    area.appendChild(el('div', { class: 'toolbar' }, [el('span', { class: 'muted', text: 'Class:' }), clsSel]));
    var box = el('div'); area.appendChild(box);
    clsSel.addEventListener('change', load); load();
    function load() {
      U.clear(box);
      var klass = classes.filter(function (c) { return c.id === clsSel.value; })[0];
      Academics.computeResults(klass, term).then(function (res) {
        var rows = res.students.map(function (s) {
          var subs = Object.keys(res.map[s.student_id]);
          var sum = subs.reduce(function (a, k) { return a + res.map[s.student_id][k].total; }, 0);
          var avg = subs.length ? Math.round(sum / subs.length * 10) / 10 : 0;
          return { name: s.first_name + ' ' + s.last_name, id: s.student_id, subjects: subs.length, avg: avg, pos: res.overallPos[s.student_id] };
        }).sort(function (a, b) { return (a.pos || 99) - (b.pos || 99); });
        var c = el('div', { class: 'card' });
        c.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
          el('h3', { text: 'Exam summary · ' + klass.name + ' · ' + App.termName() }),
          el('button', { class: 'btn ghost sm', text: '⤓ Export CSV', onclick: function () { Bulk.download('exam-summary-' + klass.name.replace(/\s+/g, '') + '.csv', [['Position', 'ID', 'Name', 'Subjects', 'Average %']].concat(rows.map(function (x) { return [x.pos || '', x.id, x.name, x.subjects, x.avg]; }))); } })
        ]));
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['Pos', 'Name', 'Subjects scored', 'Average %'].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        rows.forEach(function (x) { tb.appendChild(el('tr', {}, [el('td', { text: x.pos ? G.ordinal(x.pos) : '—' }), el('td', { text: x.name }), el('td', { text: x.subjects }), el('td', { text: x.avg })])); });
        if (!rows.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 4, html: '<span class=empty>No pupils.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t]));
        c.appendChild(el('div', { class: 'help', text: 'Full printable report cards are produced in Assessment → Report Cards.' }));
        box.appendChild(c);
      });
    }
  }

  function financeReport(area) {
    var filter = Reports.timeFilter(function () { load(); });
    area.appendChild(filter.node);
    var box = el('div'); area.appendChild(box);
    load();
    function load() {
      U.clear(box);
      var range = filter.current();
      Promise.all([DB.all('payments'), DB.all('students')]).then(function (r) {
        var pays = r[0].filter(function (p) { return Reports.inRange(p.created_on, range); });
        var byMethod = {}; var total = 0;
        pays.forEach(function (p) { byMethod[p.method] = (byMethod[p.method] || 0) + Number(p.amount); total += Number(p.amount); });
        var c = el('div', { class: 'card' });
        c.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
          el('h3', { text: 'Collections · ' + range.label }),
          el('button', { class: 'btn ghost sm', text: '⤓ Export CSV', onclick: function () { Bulk.download('collections.csv', [['Receipt', 'Student', 'Amount', 'Method', 'Date']].concat(pays.map(function (p) { return [p.receipt_no, p.student_id, p.amount, p.method, p.created_on]; }))); } })
        ]));
        c.appendChild(el('div', { class: 'grid cols-3', style: 'margin:.5rem 0' }, [stat(U.money(total, App.ctx.school.currency), 'Total collected'), stat(pays.length, 'Payments'), stat(Object.keys(byMethod).length, 'Methods used')]));
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['Receipt', 'Student', 'Amount', 'Method', 'Date'].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody'); pays.slice().reverse().forEach(function (p) { tb.appendChild(el('tr', {}, [el('td', { text: p.receipt_no }), el('td', { text: p.student_id }), el('td', { text: U.money(p.amount, App.ctx.school.currency) }), el('td', { text: p.method }), el('td', { text: U.fmtDate(p.created_on) })])); });
        if (!pays.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 5, html: '<span class=empty>No payments in this period.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); box.appendChild(c);
      });
    }
  }

  function attendanceReport(area) {
    var filter = Reports.timeFilter(function () { load(); });
    area.appendChild(filter.node);
    var box = el('div'); area.appendChild(box);
    load();
    function load() {
      U.clear(box);
      var range = filter.current();
      DB.all('attendance').then(function (att) {
        var rows = att.filter(function (a) { return Reports.inRange(a.date, range); });
        var byClass = {};
        rows.forEach(function (a) { byClass[a.class_id] = byClass[a.class_id] || { p: 0, t: 0 }; byClass[a.class_id].t++; if (a.status === 'present') byClass[a.class_id].p++; });
        var c = el('div', { class: 'card' });
        c.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
          el('h3', { text: 'Attendance · ' + range.label }),
          el('button', { class: 'btn ghost sm', text: '⤓ Export CSV', onclick: function () { Bulk.download('attendance-report.csv', [['Class', 'Present', 'Records', 'Rate %']].concat(Object.keys(byClass).map(function (cid) { var b = byClass[cid]; return [App.className(cid), b.p, b.t, Math.round(b.p / b.t * 100)]; }))); } })
        ]));
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['Class', 'Present', 'Records', 'Rate'].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        Object.keys(byClass).forEach(function (cid) { var b = byClass[cid]; tb.appendChild(el('tr', {}, [el('td', { text: App.className(cid) }), el('td', { text: b.p }), el('td', { text: b.t }), el('td', { text: Math.round(b.p / b.t * 100) + '%' })])); });
        if (!Object.keys(byClass).length) tb.appendChild(el('tr', {}, [el('td', { colspan: 4, html: '<span class=empty>No attendance in this period.</span>' })]));
        t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); box.appendChild(c);
      });
    }
  }

  /* ---------------- Staff ---------------- */
  function tabStaff(panel) {
    Promise.all([DB.all('staff'), DB.all('classes')]).then(function (r) {
      var staff = r[0], classes = r[1].sort(function (a, b) { return a.sort - b.sort; });
      var tools = el('div', { class: 'toolbar' });
      tools.appendChild(el('button', { class: 'btn', text: '+ Add staff', onclick: function () { editStaff(null, classes, refresh); } }));
      panel.appendChild(tools);
      var c = el('div', { class: 'card' });
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Staff ID', 'Name', 'Role', 'Phone', 'Classes', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      staff.forEach(function (s) {
        var cnames = (s.class_ids || []).map(function (id) { return App.className(id); }).join(', ') || '—';
        tb.appendChild(el('tr', {}, [el('td', { text: s.staff_id }), el('td', { text: s.name }), el('td', {}, [el('span', { class: 'tag', text: s.role })]), el('td', { text: s.phone || '—' }), el('td', { text: cnames }), el('td', {}, [el('div', { class: 'wrap-actions' }, [
          el('button', { class: 'btn sm', text: 'Edit', onclick: function () { editStaff(s, classes, refresh); } }),
          el('button', { class: 'btn sm danger', text: 'Del', onclick: function () { U.confirm('Delete ' + s.name + '?', function () { DB.remove('staff', s.id).then(refresh); }); } })
        ])])]));
      });
      t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); panel.appendChild(c);
    });
    function refresh() { U.clear(panel); tabStaff(panel); }
  }
  function editStaff(s, classes, done) {
    var rules = App.ctx.idRules;
    var fields = [
      { name: 'name', label: 'Full name', required: true },
      { name: 'role', label: 'Role', type: 'select', options: global.SMS_SEED.constants.ROLES.filter(function (r) { return r !== 'Parent'; }) },
      { name: 'phone', label: 'Phone' }
    ];
    if (rules.allow_manual && !s) fields.unshift({ name: 'staff_id', label: 'Staff ID (blank = auto)', placeholder: rules.staff_prefix + '____' });
    var f = U.form(fields, s || { role: 'Teacher' });
    var clsBox = el('div', { class: 'field' }, [el('label', { text: 'Assigned classes (for teachers)' })]);
    var sel = el('div'); var cur = (s && s.class_ids) || [];
    classes.forEach(function (c) { var cb = el('input', { type: 'checkbox', value: c.id }); if (cur.indexOf(c.id) !== -1) cb.checked = true; sel.appendChild(el('label', { class: 'check-label', style: 'display:block' }, [cb, document.createTextNode(' ' + c.name)])); });
    clsBox.appendChild(sel); f.appendChild(clsBox);
    U.modal({ title: s ? 'Edit staff' : 'Add staff', wide: true, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        var v = f.readValues(); if (!v.name.trim()) return U.toast('Name required', 'err');
        v.class_ids = U.$all('input[type=checkbox]', sel).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        if (s) DB.update('staff', s.id, v).then(function () { x(); U.toast('Saved.'); done(); });
        else {
          var go = (v.staff_id && v.staff_id.trim()) ? Promise.resolve(v.staff_id.trim()) : DB.nextCode('staff', rules.staff_prefix, rules.digits);
          go.then(function (code) { v.staff_id = code; DB.insert('staff', v).then(function () { x(); U.toast('Added ' + code); done(); }); });
        }
      } }
    ] });
  }

  function tabPerms(panel) {
    panel.appendChild(el('div', { class: 'note', text: 'The full permission matrix is edited in Settings → Roles. Admin is always full access.' }));
    panel.appendChild(el('button', { class: 'btn', text: 'Open Settings → Roles', onclick: function () { location.hash = '#/settings'; } }));
  }

  function stat(n, l) { return el('div', { class: 'stat accent' }, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]); }
  global.Views = global.Views || {};
  global.Views.administration = { title: 'Administration', render: render };
})(window);

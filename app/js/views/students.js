/* ============================================================
 * students.js — Student & Academic: admissions, records,
 * parents (multi-child), class assignment, promotion, bulk admit.
 * Parents get a read-only ward portal (select ward, view report + attendance).
 * Admin manages each parent's portal access under Settings → Access Control.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Bulk = global.Bulk;
  var el = U.el;

  function render(container) {
    U.clear(container);
    if (App.user.role === 'Parent') {
      container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'My Ward' })]));
      var p = el('div'); container.appendChild(p); parentWard(p); return;
    }
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Students & Academic' })]));
    var tabs = ['Students', 'Parents / Guardians'];
    if (App.ctx.academic.current_term === App.ctx.academic.promotional_term) tabs.push('Promotion');
    var bar = el('div', { class: 'tabs' });
    var panel = el('div');
    var active = 'Students';
    tabs.forEach(function (t) { var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b); });
    container.appendChild(bar); container.appendChild(panel);
    function draw() {
      U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); });
      U.clear(panel);
      if (active === 'Students') tabStudents(panel);
      else if (active === 'Parents / Guardians') tabParents(panel);
      else tabPromotion(panel);
    }
    draw();
  }

  /* ---------- Parent ward portal ---------- */
  function parentWard(panel) {
    Promise.all([DB.all('students'), DB.all('classes'), DB.all('scores'), DB.all('attendance'), DB.all('invoices'), DB.all('payments'), DB.all('parents'), DB.singleton('access')]).then(function (r) {
      var all = r[0], classes = r[1], scores = r[2], attendance = r[3], invoices = r[4], payments = r[5];
      var access = r[7] || {};
      var myParent = (r[6] || []).filter(function (pp) { var sids = pp.student_ids || []; return (App.user.linked_student_ids || []).some(function (id) { return sids.indexOf(id) !== -1; }); })[0] || {};
      function canDL(classId) {
        if (myParent.report_download === 'block') return false;
        if (myParent.report_download === 'allow') return true;
        var bc = access.report_download_by_class || {};
        if (bc[classId] === false) return false;
        if (bc[classId] === true) return true;
        return access.report_download_default !== false;
      }
      var ids = App.user.linked_student_ids || [];
      var wards = all.filter(function (s) { return ids.indexOf(s.student_id) !== -1; });
      if (!wards.length) { panel.appendChild(el('div', { class: 'empty', text: 'No ward is linked to your account yet. Please contact the school office.' })); return; }

      var sel = el('select');
      wards.forEach(function (s) { sel.appendChild(el('option', { value: s.student_id, text: (s.first_name + ' ' + s.last_name) + ' (' + s.student_id + ')' })); });
      if (wards.length > 1) panel.appendChild(el('div', { class: 'toolbar' }, [el('span', { class: 'muted', text: 'Select ward:' }), sel]));
      var area = el('div'); panel.appendChild(area);
      sel.addEventListener('change', draw);
      draw();

      function draw() {
        U.clear(area);
        var s = wards.filter(function (w) { return w.student_id === sel.value; })[0] || wards[0];
        var cls = classes.filter(function (c) { return c.id === s.class_id; })[0];
        var term = App.ctx.academic.current_term; var cur = App.ctx.school.currency;

        var prof = el('div', { class: 'card' });
        prof.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;flex-wrap:wrap;gap:.5rem' }, [
          el('h3', { text: (s.first_name + ' ' + s.last_name) }),
          canDL(s.class_id) ? el('button', { class: 'btn sm', text: '⤓ Print / PDF report', onclick: function () { printWard(s, cls, term); } }) : el('span', { class: 'muted', style: 'font-size:.8rem', text: 'Report download is turned off by the school.' })
        ]));
        prof.appendChild(el('div', { class: 'grid cols-3' }, [
          info('Student ID', s.student_id), info('Class', cls ? cls.name : '—'), info('Gender', s.gender || '—'),
          info('Status', s.status || 'active'), info('Date of birth', s.dob ? U.fmtDate(s.dob) : '—'), info('Admitted', s.admitted_on ? U.fmtDate(s.admitted_on) : '—')
        ]));
        area.appendChild(prof);

        var a = attStats(attendance, s.student_id);
        area.appendChild(el('div', { class: 'card' }, [el('h3', { text: 'Attendance so far' }),
          el('div', { class: 'grid cols-4' }, [stat(a.rate + '%', 'Attendance rate'), stat(a.present, 'Present'), stat(a.late, 'Late'), stat(a.absent, 'Absent')]),
          el('div', { class: 'muted', style: 'margin-top:.4rem', text: a.total + ' school day(s) recorded this term.' })
        ]));

        var billed = sumFor(invoices, s.student_id, term, 'amount');
        var paid = sumFor(payments, s.student_id, term, 'amount');
        area.appendChild(el('div', { class: 'card' }, [el('h3', { text: 'Fees (' + App.termName() + ')' }),
          el('div', { class: 'grid cols-3' }, [stat(U.money(billed, cur), 'Billed'), stat(U.money(paid, cur), 'Paid'), stat(U.money(billed - paid, cur), (billed - paid) > 0 ? 'Balance due' : 'Cleared')])
        ]));

        area.appendChild(scoresCard(scores, s.student_id, term));
      }

      function printWard(s, cls, term) {
        var sch = App.ctx.school; var cur = sch.currency;
        var a = attStats(attendance, s.student_id);
        var billed = sumFor(invoices, s.student_id, term, 'amount'), paid = sumFor(payments, s.student_id, term, 'amount');
        var sc = scores.filter(function (x) { return x.student_id === s.student_id && x.term === term; });
        var G = global.Grading, w = App.ctx.weighting, bands = (App.ctx.gradeBands || []).slice().sort(function (x, y) { return y.min - x.min; });
        var rows = sc.map(function (x) {
          var total = G ? G.computeTotal(x.class_score || 0, x.exam_score || 0, w) : (Number(x.class_score || 0) + Number(x.exam_score || 0));
          var band = G ? G.gradeFor(total, bands) : { grade: '', remark: '' };
          return '<tr><td>' + U.esc(x.subject) + '</td><td>' + (x.class_score == null ? '' : x.class_score) + '</td><td>' + (x.exam_score == null ? '' : x.exam_score) + '</td><td>' + total + '</td><td>' + U.esc(band.grade + (band.remark ? ' · ' + band.remark : '')) + '</td></tr>';
        }).join('');
        var html = '<h1>' + U.esc(sch.name) + '</h1><h3>' + U.esc(App.termName()) + ' Report — ' + U.esc(App.ctx.academic.year) + '</h3>' +
          '<p><b>Name:</b> ' + U.esc(s.first_name + ' ' + s.last_name) + ' &nbsp; <b>ID:</b> ' + U.esc(s.student_id) + ' &nbsp; <b>Class:</b> ' + U.esc(cls ? cls.name : '') + '</p>' +
          '<h2>Scores</h2><table border="1" cellspacing="0" cellpadding="4" style="border-collapse:collapse;width:100%"><thead><tr><th>Subject</th><th>Class %</th><th>Exam %</th><th>Total %</th><th>Grade</th></tr></thead><tbody>' + (rows || '<tr><td colspan="5">No scores published yet.</td></tr>') + '</tbody></table>' +
          '<h2>Attendance so far</h2><p>Rate: <b>' + a.rate + '%</b> &nbsp; Present: ' + a.present + ' &nbsp; Late: ' + a.late + ' &nbsp; Absent: ' + a.absent + ' &nbsp; (of ' + a.total + ' days)</p>' +
          '<h2>Fees (' + U.esc(App.termName()) + ')</h2><p>Billed: ' + U.money(billed, cur) + ' &nbsp; Paid: ' + U.money(paid, cur) + ' &nbsp; <b>Balance: ' + U.money(billed - paid, cur) + '</b></p>';
        printReport(sch.name + ' report', html);
      }
    });
  }
  function attStats(attendance, sid) {
    var att = attendance.filter(function (x) { return x.student_id === sid; });
    var present = att.filter(function (x) { return x.status === 'present'; }).length;
    var late = att.filter(function (x) { return x.status === 'late'; }).length;
    var absent = att.filter(function (x) { return x.status === 'absent'; }).length;
    var total = att.length;
    return { present: present, late: late, absent: absent, total: total, rate: total ? Math.round(present / total * 100) : 0 };
  }
  function sumFor(arr, sid, term, key) { return arr.filter(function (x) { return x.student_id === sid && x.term === term; }).reduce(function (a, x) { return a + Number(x[key] || 0); }, 0); }
  function scoresCard(scores, sid, term) {
    var sc = scores.filter(function (x) { return x.student_id === sid && x.term === term; });
    var card = el('div', { class: 'card' }, [el('h3', { text: App.termName() + ' scores' })]);
    if (!sc.length) { card.appendChild(el('div', { class: 'empty', text: 'No scores published yet.' })); return card; }
    var G = global.Grading, w = App.ctx.weighting, bands = (App.ctx.gradeBands || []).slice().sort(function (a, b) { return b.min - a.min; });
    var t = el('table', { class: 'data' });
    t.appendChild(el('thead', {}, [el('tr', {}, ['Subject', 'Class %', 'Exam %', 'Total %', 'Grade'].map(function (h) { return el('th', { text: h }); }))]));
    var tb = el('tbody');
    sc.forEach(function (x) {
      var total = G ? G.computeTotal(x.class_score || 0, x.exam_score || 0, w) : (Number(x.class_score || 0) + Number(x.exam_score || 0));
      var band = G ? G.gradeFor(total, bands) : { grade: '', remark: '' };
      tb.appendChild(el('tr', {}, [el('td', { text: x.subject }), el('td', { text: x.class_score == null ? '—' : x.class_score }), el('td', { text: x.exam_score == null ? '—' : x.exam_score }), el('td', { text: total }), el('td', { text: band.grade + (band.remark ? ' · ' + band.remark : '') })]));
    });
    t.appendChild(tb); card.appendChild(el('div', { class: 'table-wrap' }, [t]));
    return card;
  }
  function info(l, v) { return el('div', {}, [el('div', { class: 'muted', style: 'font-size:.75rem', text: l }), el('div', { style: 'font-weight:600', text: v })]); }
  function stat(n, l) { return el('div', { class: 'stat' }, [el('div', { class: 'n', text: n }), el('div', { class: 'l', text: l })]); }
  function printReport(title, html) {
    var wn = window.open('', '_blank');
    var brand = (App.themeHex ? App.themeHex().primary : '#0f5e5e');
    wn.document.write('<html><head><title>' + U.esc(title) + '</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:22px;color:#1c2726}table{border-collapse:collapse;width:100%;margin-bottom:14px}th,td{border:1px solid #999;padding:5px;text-align:left;font-size:12px}th{background:' + brand + ';color:#fff}h1,h2,h3{color:' + brand + ';margin:.3rem 0}</style></head><body>' + html + '</body></html>');
    wn.document.close(); wn.focus(); setTimeout(function () { wn.print(); }, 300);
  }

  /* ---------- Students ---------- */
  function tabStudents(panel) {
    Promise.all([DB.all('students'), DB.all('classes'), DB.all('parents')]).then(function (r) {
      var students = r[0], classes = r[1].sort(bySort), parents = r[2];
      var filterClass = '', q = '';
      var canEdit = App.canEdit('Students');

      var tools = el('div', { class: 'toolbar' });
      var search = el('input', { type: 'text', class: 'search', placeholder: 'Search name or ID…' });
      search.addEventListener('input', U.debounce(function () { q = search.value.toLowerCase(); drawTable(); }, 200));
      var clsSel = el('select');
      clsSel.appendChild(el('option', { value: '', text: 'All classes' }));
      classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
      clsSel.addEventListener('change', function () { filterClass = clsSel.value; drawTable(); });
      tools.appendChild(search); tools.appendChild(clsSel);
      tools.appendChild(el('div', { style: 'flex:1' }));
      if (canEdit) {
        tools.appendChild(el('button', { class: 'btn', text: '+ Admit student', onclick: function () { editStudent(null, classes, parents, refresh); } }));
        tools.appendChild(el('button', { class: 'btn ghost', text: '⤓ New-admissions template', onclick: function () { downloadTemplate(classes); } }));
        tools.appendChild(el('button', { class: 'btn gold', text: '⤒ Upload new admissions', onclick: function () { uploadAdmissions(classes, refresh); } }));
      }
      panel.appendChild(tools);

      if (canEdit) panel.appendChild(updateExistingCard(students, classes, refresh));
      panel.appendChild(profileDownloadCard(students, classes));

      var tableCard = el('div', { class: 'card' });
      panel.appendChild(tableCard);
      drawTable();

      function drawTable() {
        U.clear(tableCard);
        var rows = students.filter(function (s) {
          if (filterClass && s.class_id !== filterClass) return false;
          if (q) { var hay = (s.first_name + ' ' + s.last_name + ' ' + s.student_id).toLowerCase(); if (hay.indexOf(q) === -1) return false; }
          return true;
        });
        tableCard.appendChild(el('div', { class: 'muted', style: 'margin-bottom:.5rem', text: rows.length + ' student(s)' }));
        if (!rows.length) { tableCard.appendChild(el('div', { class: 'empty', text: 'No students match.' })); return; }
        var t = el('table', { class: 'data' });
        t.appendChild(el('thead', {}, [el('tr', {}, ['ID', 'Name', 'Class', 'Gender', 'Parent', 'Status', ''].map(function (h) { return el('th', { text: h }); }))]));
        var tb = el('tbody');
        rows.forEach(function (s) {
          var cls = classes.filter(function (c) { return c.id === s.class_id; })[0];
          var par = parents.filter(function (p) { return p.id === s.parent_id; })[0];
          var actions = el('div', { class: 'wrap-actions' });
          if (canEdit) {
            actions.appendChild(el('button', { class: 'btn sm', text: 'Edit', onclick: function () { editStudent(s, classes, parents, refresh); } }));
            actions.appendChild(el('button', { class: 'btn sm danger', text: 'Del', onclick: function () { U.confirm('Withdraw/delete ' + s.first_name + '?', function () { DB.remove('students', s.id).then(refresh); }); } }));
          } else actions.appendChild(el('span', { class: 'muted', text: 'view only' }));
          tb.appendChild(el('tr', {}, [
            el('td', { text: s.student_id }),
            el('td', { text: (s.first_name + ' ' + s.last_name) }),
            el('td', { text: cls ? cls.name : '—' }),
            el('td', { text: s.gender || '—' }),
            el('td', { text: par ? par.name : '—' }),
            el('td', {}, [el('span', { class: 'tag ' + (s.status === 'active' ? '' : 'muted'), text: s.status || 'active' })]),
            el('td', {}, [actions])
          ]));
        });
        t.appendChild(tb);
        tableCard.appendChild(el('div', { class: 'table-wrap' }, [t]));
      }
    });
    function refresh() { U.clear(panel); tabStudents(panel); }
  }

  // Sections for admin-defined custom admission fields, in display order.
  var ADMISSION_SECTIONS = [
    { key: 'personal', title: 'Additional Personal Details' },
    { key: 'health', title: 'Health Needs' },
    { key: 'guardian', title: 'Parent / Guardian Details' },
    { key: 'declaration', title: 'Declaration' },
    { key: 'office', title: 'For Office Use Only' }
  ];

  function admissionCfg() {
    var raw = App.ctx.admissionFields;
    return (Array.isArray(raw) && raw.length) ? raw : (global.SMS_SEED.admissionFields || []);
  }
  // Core-field label/required lookup (system fields can be renamed/required-toggled
  // in Settings → Admission Form, but never removed or retyped — the rest of the
  // app depends on their key/type staying exactly as seeded).
  function coreField(key, fallbackLabel, fallbackRequired) {
    var f = admissionCfg().filter(function (x) { return x.system && x.key === key; })[0];
    return { label: (f && f.label) || fallbackLabel, required: f ? !!f.required : !!fallbackRequired };
  }

  function siblingsField(def, initial) {
    var rows = (initial || []).map(function (r) { return { name: r.name || '', cls: r.cls || '' }; });
    var wrap = el('div', { class: 'field', style: 'grid-column:1/-1' }, [el('label', { text: def.label + (def.required ? ' *' : '') })]);
    var list = el('div');
    function redraw() {
      U.clear(list);
      rows.forEach(function (r, i) {
        var nameInp = el('input', { type: 'text', placeholder: 'Sibling name', value: r.name, style: 'flex:1' });
        nameInp.addEventListener('input', function () { r.name = nameInp.value; });
        var clsInp = el('input', { type: 'text', placeholder: 'Class', value: r.cls, style: 'width:160px' });
        clsInp.addEventListener('input', function () { r.cls = clsInp.value; });
        list.appendChild(el('div', { class: 'flex', style: 'gap:.4rem;margin-bottom:.3rem' }, [nameInp, clsInp,
          el('button', { class: 'btn sm danger', text: '✕', onclick: function () { rows.splice(i, 1); redraw(); } })]));
      });
    }
    redraw();
    wrap.appendChild(list);
    wrap.appendChild(el('button', { class: 'btn sm ghost', text: '+ Add sibling', onclick: function () { rows.push({ name: '', cls: '' }); redraw(); } }));
    if (def.help) wrap.appendChild(el('div', { class: 'help', text: def.help }));
    wrap._getValue = function () { return rows.filter(function (r) { return r.name.trim(); }).map(function (r) { return { name: r.name.trim(), cls: r.cls.trim() }; }); };
    wrap._required = def.required; wrap._label = def.label;
    return wrap;
  }

  function editStudent(s, classes, parents, done) {
    var rules = App.ctx.idRules;
    var cf = {
      first_name: coreField('first_name', 'First name', true),
      last_name: coreField('last_name', 'Last name', true),
      gender: coreField('gender', 'Gender', false),
      dob: coreField('dob', 'Date of birth', false),
      class_id: coreField('class_id', 'Class', false),
      parent_id: coreField('parent_id', 'Parent / Guardian', false),
      status: coreField('status', 'Status', false),
      admitted_on: coreField('admitted_on', 'Admitted on', false)
    };
    var fields = [
      { name: 'first_name', label: cf.first_name.label, required: cf.first_name.required },
      { name: 'last_name', label: cf.last_name.label, required: cf.last_name.required },
      { name: 'gender', label: cf.gender.label, type: 'select', options: ['', 'M', 'F'], required: cf.gender.required },
      { name: 'dob', label: cf.dob.label, type: 'date', required: cf.dob.required },
      { name: 'class_id', label: cf.class_id.label, type: 'select', options: classes.map(function (c) { return { value: c.id, label: c.name }; }), required: cf.class_id.required },
      { name: 'parent_id', label: cf.parent_id.label, type: 'select', options: [{ value: '', label: '— none —' }].concat(parents.map(function (p) { return { value: p.id, label: p.name }; })), required: cf.parent_id.required },
      { name: 'status', label: cf.status.label, type: 'select', options: ['active', 'withdrawn', 'completed'], required: cf.status.required },
      { name: 'admitted_on', label: cf.admitted_on.label, type: 'date', required: cf.admitted_on.required }
    ];
    if (rules.allow_manual && !s) fields.unshift({ name: 'student_id', label: 'Student ID (leave blank to auto-generate)', placeholder: rules.student_prefix + '____' });
    var f = U.form(fields, s || { status: 'active', admitted_on: U.todayISO() });
    f.classList.add('form-grid');

    // ---- Admin-defined custom fields (Settings → Admission Form), grouped by section ----
    var customDefs = admissionCfg().filter(function (x) { return !x.system; });
    var plainDefs = customDefs.filter(function (x) { return x.type !== 'siblings'; })
      .sort(function (a, b) { return ADMISSION_SECTIONS.findIndex(function (sec) { return sec.key === a.section; }) - ADMISSION_SECTIONS.findIndex(function (sec) { return sec.key === b.section; }); });
    var siblingDefs = customDefs.filter(function (x) { return x.type === 'siblings'; });
    var extraVals = (s && s.extra) ? JSON.parse(JSON.stringify(s.extra)) : {};

    var ef = null;
    if (plainDefs.length) {
      ef = U.form(plainDefs.map(function (d) { return { name: d.key, label: d.label, type: d.type, required: d.required, options: d.options, help: d.help, rows: d.type === 'textarea' ? 2 : undefined }; }), extraVals);
      ef.classList.add('form-grid');
      var rows = U.$all('.field', ef), idx = 0;
      ADMISSION_SECTIONS.forEach(function (sec) {
        var count = plainDefs.filter(function (d) { return d.section === sec.key; }).length;
        if (count) { ef.insertBefore(el('h4', { text: sec.title, style: 'grid-column:1/-1;margin:.6rem 0 0' }), rows[idx]); idx += count; }
      });
    }
    var sibNodes = siblingDefs.map(function (d) { return siblingsField(d, extraVals[d.key]); });

    var body = el('div', {}, [f, ef, sibNodes.length ? el('h4', { text: 'Siblings', style: 'margin:.6rem 0 0' }) : null].concat(sibNodes));

    U.modal({ title: s ? 'Edit student' : 'Admit student', wide: true, body: body, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        var errs = f.validate();
        if (ef) errs = errs.concat(ef.validate());
        sibNodes.forEach(function (w) { if (w._required && !w._getValue().length) errs.push(w._label + ' is required.'); });
        if (errs.length) return U.toast(errs[0], 'err');
        var v = f.readValues();
        var extra = ef ? ef.readValues() : {};
        sibNodes.forEach(function (w, i) { extra[siblingDefs[i].key] = w._getValue(); });
        v.extra = extra;
        if (s) {
          DB.update('students', s.id, v).then(function () { linkParent(s.id, v.parent_id, s.parent_id).then(function () { x(); U.toast('Student updated.'); done(); }); });
        } else {
          var manualCode = v.student_id && v.student_id.trim();
          var go = manualCode ? Promise.resolve(manualCode) : DB.nextCode('student', rules.student_prefix, rules.digits);
          go.then(function (code) {
            if (!manualCode) { proceed(code); return; }
            DB.all('students').then(function (all) {
              if (all.some(function (x2) { return x2.student_id === code; })) return U.toast('Student ID "' + code + '" is already in use — choose a different ID.', 'err');
              proceed(code);
            });
          });
          function proceed(code) {
            v.student_id = code; v.id = 'stu-' + code;
            DB.insert('students', v).then(function () { linkParent(v.id, v.parent_id, null).then(function () { x(); U.toast('Admitted as ' + code); done(); }); });
          }
        }
      } }
    ] });
  }

  // keep parent.student_ids in sync (by student code)
  function linkParent(studentId, newParentId, oldParentId) {
    return DB.all('students').then(function (sts) {
      var st = sts.filter(function (x) { return x.id === studentId; })[0];
      var code = st ? st.student_id : studentId;
      var ops = [];
      if (oldParentId && oldParentId !== newParentId) {
        ops.push(DB.get('parents', oldParentId).then(function (p) { if (p) return DB.update('parents', p.id, { student_ids: (p.student_ids || []).filter(function (c) { return c !== code; }) }); }));
      }
      if (newParentId) {
        ops.push(DB.get('parents', newParentId).then(function (p) { if (p && (p.student_ids || []).indexOf(code) === -1) return DB.update('parents', p.id, { student_ids: (p.student_ids || []).concat([code]) }); }));
      }
      return Promise.all(ops);
    });
  }

  /* ---------- Parents ---------- */
  function tabParents(panel) {
    Promise.all([DB.all('parents'), DB.all('students')]).then(function (r) {
      var parents = r[0], students = r[1], canEdit = App.canEdit('Students');
      var tools = el('div', { class: 'toolbar' });
      if (canEdit) tools.appendChild(el('button', { class: 'btn', text: '+ Add parent / guardian', onclick: function () { editParent(null, students, refresh); } }));
      panel.appendChild(tools);
      var c = el('div', { class: 'card' });
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Phone', 'WhatsApp', 'Children', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      parents.forEach(function (p) {
        var kids = students.filter(function (s) { return (p.student_ids || []).indexOf(s.student_id) !== -1; })
          .map(function (s) { return s.first_name + ' ' + s.last_name; }).join(', ') || '—';
        var act = el('div', { class: 'wrap-actions' });
        if (canEdit) {
          act.appendChild(el('button', { class: 'btn sm', text: 'Edit', onclick: function () { editParent(p, students, refresh); } }));
          act.appendChild(el('button', { class: 'btn sm danger', text: 'Del', onclick: function () { U.confirm('Delete parent ' + p.name + '?', function () { DB.remove('parents', p.id).then(refresh); }); } }));
        }
        tb.appendChild(el('tr', {}, [
          el('td', { text: p.name }), el('td', { text: p.phone || '—' }), el('td', { text: p.whatsapp || '—' }), el('td', { text: kids }),
          el('td', {}, [act])
        ]));
      });
      t.appendChild(tb);
      c.appendChild(el('div', { class: 'table-wrap' }, [t]));
      panel.appendChild(c);
      panel.appendChild(el('div', { class: 'note', text: 'One parent links to several children — a single login covers all of them. Enabling/disabling a parent login and report-download control now live under Settings → Access Control (admin only).' }));
    });
    function refresh() { U.clear(panel); tabParents(panel); }
  }
  function editParent(p, students, done) {
    var f = U.form([
      { name: 'name', label: 'Full name', required: true },
      { name: 'phone', label: 'Phone' },
      { name: 'whatsapp', label: 'WhatsApp' },
      { name: 'email', label: 'Email', type: 'email' }
    ], p || {});
    var childBox = el('div', { class: 'field' }, [el('label', { text: 'Linked children' })]);
    var sel = el('div');
    var current = (p && p.student_ids) || [];
    students.forEach(function (s) {
      var cb = el('input', { type: 'checkbox' }); cb.value = s.student_id; if (current.indexOf(s.student_id) !== -1) cb.checked = true;
      sel.appendChild(el('label', { class: 'check-label', style: 'display:block' }, [cb, document.createTextNode(' ' + s.first_name + ' ' + s.last_name + ' (' + s.student_id + ')')]));
    });
    childBox.appendChild(sel); f.appendChild(childBox);
    U.modal({ title: p ? 'Edit parent' : 'Add parent', wide: true, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        var v = f.readValues(); if (!v.name.trim()) return U.toast('Name required', 'err');
        v.student_ids = U.$all('input[type=checkbox]', sel).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
        var go = p ? DB.update('parents', p.id, v) : DB.insert('parents', v);
        go.then(function (saved) {
          DB.all('students').then(function (sts) {
            var ops = sts.map(function (s) {
              var should = v.student_ids.indexOf(s.student_id) !== -1;
              var pid = (p ? p.id : saved.id);
              if (should && s.parent_id !== pid) return DB.update('students', s.id, { parent_id: pid });
              if (!should && s.parent_id === pid) return DB.update('students', s.id, { parent_id: null });
              return null;
            }).filter(Boolean);
            Promise.all(ops).then(function () { x(); U.toast('Saved.'); done(); });
          });
        });
      } }
    ] });
  }

  /* ---------- Promotion ---------- */
  function tabPromotion(panel) {
    Promise.all([DB.all('students'), DB.all('classes')]).then(function (r) {
      var students = r[0], classes = r[1].sort(bySort);
      panel.appendChild(el('div', { class: 'note', text: 'Promotional term (' + App.termName() + '). Each pupil defaults to promotion to the next class. Flag any who repeat. Basic 9 pupils complete (BECE / Alumni).' }));
      var decisions = {};
      classes.forEach(function (c) {
        var kids = students.filter(function (s) { return s.class_id === c.id && s.status === 'active'; });
        if (!kids.length) return;
        var nextC = nextClass(c, classes);
        var body = el('div');
        kids.forEach(function (s) {
          var def = nextC ? 'promote' : 'complete';
          decisions[s.id] = { student: s, choice: def, next: nextC };
          var sel = el('select');
          [['promote', nextC ? 'Promote → ' + nextC.name : 'Promote'], ['retain', 'Retain (repeat ' + c.name + ')'], ['complete', 'Completed / Alumni']].forEach(function (o) {
            var opt = el('option', { value: o[0], text: o[1] }); if (o[0] === def) opt.selected = true; sel.appendChild(opt);
          });
          if (!nextC) sel.value = 'complete';
          sel.addEventListener('change', function () { decisions[s.id].choice = sel.value; });
          body.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between; margin-bottom:.3rem; gap:.5rem' }, [
            el('span', { text: s.first_name + ' ' + s.last_name + ' (' + s.student_id + ')' }), sel ]));
        });
        panel.appendChild(el('div', { class: 'card' }, [el('h3', { text: c.name + (nextC ? ' → ' + nextC.name : ' (final class)') }), body]));
      });
      if (!App.canEdit('Students')) return;
      panel.appendChild(el('button', { class: 'btn gold', text: 'Apply promotions', onclick: function () {
        U.confirm('Apply all promotion decisions? This updates class assignments.', function () {
          var ops = Object.keys(decisions).map(function (id) {
            var d = decisions[id];
            if (d.choice === 'promote' && d.next) return DB.update('students', id, { class_id: d.next.id, promoted_to: d.next.name });
            if (d.choice === 'complete') return DB.update('students', id, { status: 'completed', promoted_to: 'Completed (BECE / Alumni)' });
            return DB.update('students', id, { promoted_to: 'Repeated ' + (d.student && App.className(d.student.class_id)) });
          });
          Promise.all(ops).then(function () { U.toast('Promotions applied.'); U.clear(panel); tabPromotion(panel); });
        });
      } }));
    });
  }
  function nextClass(c, classes) {
    var idx = classes.findIndex(function (x) { return x.id === c.id; });
    return classes[idx + 1] || null;
  }

  /* ---------- Bulk admissions ---------- */
  function downloadTemplate(classes) {
    var rows = [['first_name', 'last_name', 'gender', 'dob', 'class_name', 'parent_name', 'parent_phone']];
    rows.push(['Sample', 'Pupil', 'F', '2018-05-01', classes[0] ? classes[0].name : 'Basic 1', 'Sample Parent', '+233...']);
    Bulk.download('admissions-template.csv', rows);
    U.toast('Template downloaded. Fill it and upload.');
  }
  function uploadAdmissions(classes, done) {
    Bulk.pickFile().then(function (file) {
      var rules = App.ctx.idRules;
      var res = Bulk.processUpload(file.rows, ['first_name', 'last_name', 'class_name'], function (row) {
        var errs = [];
        if (!row.first_name) errs.push('first_name missing');
        if (!row.last_name) errs.push('last_name missing');
        var cls = classes.filter(function (c) { return c.name.toLowerCase() === (row.class_name || '').toLowerCase(); })[0];
        if (!cls) errs.push('unknown class "' + row.class_name + '"');
        if (errs.length) return { ok: false, errors: errs };
        return { ok: true, value: { first_name: row.first_name, last_name: row.last_name, gender: row.gender || '', dob: row.dob || '', class_id: cls.id, parent_name: row.parent_name || '', parent_phone: row.parent_phone || '', status: 'active', admitted_on: U.todayISO() } };
      });
      Bulk.summaryModal('Import admissions', res, function (valid) {
        var i = 0;
        function step() {
          if (i >= valid.length) { U.toast('Imported ' + valid.length + ' student(s).'); done(); return; }
          var v = valid[i++];
          DB.nextCode('student', rules.student_prefix, rules.digits).then(function (code) {
            v.student_id = code; v.id = 'stu-' + code;
            var pname = v.parent_name; var pphone = v.parent_phone;
            delete v.parent_name; delete v.parent_phone;
            DB.insert('students', v).then(function () {
              if (pname) {
                DB.insert('parents', { name: pname, phone: pphone, whatsapp: pphone, student_ids: [code] }).then(function (par) { DB.update('students', v.id, { parent_id: par.id }).then(step); });
              } else step();
            });
          });
        }
        step();
      });
    }).catch(function () {});
  }

  /* ---------- Update existing students (download current data → fill → upload to update) ---------- */
  function updateExistingCard(students, classes, refresh) {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: 'Update existing student records' }));
    card.appendChild(el('div', { class: 'help', text: 'Download a spreadsheet pre-filled with current details for a whole class or a single student, edit the values, then upload it back — matching rows UPDATE the existing record (student_id is the match key and must not change). Use this instead of the admissions template above when correcting or bulk-editing students already on roll.' }));
    var scopeSel = el('select');
    [['class', 'Whole class'], ['one', 'Single student']].forEach(function (o) { scopeSel.appendChild(el('option', { value: o[0], text: o[1] })); });
    var clsSel = el('select');
    classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
    var stuSel = el('select', { style: 'display:none' });
    students.slice().sort(function (a, b) { return (a.first_name || '').localeCompare(b.first_name || ''); }).forEach(function (s) {
      stuSel.appendChild(el('option', { value: s.student_id, text: s.first_name + ' ' + s.last_name + ' (' + s.student_id + ')' }));
    });
    function syncVisibility() {
      clsSel.style.display = scopeSel.value === 'class' ? '' : 'none';
      stuSel.style.display = scopeSel.value === 'one' ? '' : 'none';
    }
    scopeSel.addEventListener('change', syncVisibility); syncVisibility();
    card.appendChild(el('div', { class: 'toolbar' }, [el('span', { class: 'muted', text: 'Scope:' }), scopeSel, clsSel, stuSel]));
    card.appendChild(el('div', { class: 'btn-row', style: 'margin-top:.5rem' }, [
      el('button', { class: 'btn ghost', text: '⤓ Download data template', onclick: function () { downloadUpdateTemplate(students, classes, scopeSel.value, clsSel.value, stuSel.value); } }),
      el('button', { class: 'btn gold', text: '⤒ Upload filled template', onclick: function () { uploadUpdateTemplate(classes, refresh); } })
    ]));
    return card;
  }
  function downloadUpdateTemplate(students, classes, scope, classId, studentId) {
    var list = scope === 'one' ? students.filter(function (s) { return s.student_id === studentId; }) : students.filter(function (s) { return s.class_id === classId; });
    if (!list.length) return U.toast('No matching student(s) to include.', 'err');
    var rows = [['student_id', 'first_name', 'last_name', 'gender', 'dob', 'class_name', 'status', 'admitted_on']];
    list.forEach(function (s) {
      var cls = classes.filter(function (c) { return c.id === s.class_id; })[0];
      rows.push([s.student_id, s.first_name, s.last_name, s.gender || '', s.dob || '', cls ? cls.name : '', s.status || 'active', s.admitted_on || '']);
    });
    var label = scope === 'one' ? studentId : ((classes.filter(function (c) { return c.id === classId; })[0] || {}).name || 'class');
    Bulk.download('update-students-' + String(label).replace(/\s+/g, '') + '.csv', rows);
    U.toast('Template downloaded — keep student_id unchanged, edit the rest, then upload.');
  }
  function uploadUpdateTemplate(classes, done) {
    Bulk.pickFile().then(function (file) {
      DB.all('students').then(function (allStudents) {
        var byCode = {}; allStudents.forEach(function (s) { byCode[s.student_id] = s; });
        var res = Bulk.processUpload(file.rows, ['student_id', 'first_name', 'last_name', 'class_name'], function (row) {
          var errs = [];
          var existing = byCode[row.student_id];
          if (!existing) errs.push('unknown student_id ' + row.student_id);
          if (!row.first_name) errs.push('first_name missing');
          if (!row.last_name) errs.push('last_name missing');
          var cls = classes.filter(function (c) { return c.name.toLowerCase() === (row.class_name || '').toLowerCase(); })[0];
          if (!cls) errs.push('unknown class "' + row.class_name + '"');
          if (errs.length) return { ok: false, errors: errs };
          return { ok: true, value: { id: existing.id, first_name: row.first_name, last_name: row.last_name, gender: row.gender || '', dob: row.dob || '', class_id: cls.id, status: row.status || 'active', admitted_on: row.admitted_on || '' } };
        });
        Bulk.summaryModal('Update students', res, function (valid) {
          var ops = valid.map(function (v) { var id = v.id; var patch = Object.assign({}, v); delete patch.id; return DB.update('students', id, patch); });
          Promise.all(ops).then(function () { U.toast('Updated ' + valid.length + ' student record(s).'); done(); });
        });
      });
    }).catch(function () {});
  }

  /* ---------- Student profile download (single / selected / whole class) ---------- */
  function profileFieldDefs() {
    var raw = App.ctx.admissionFields;
    var cfg = (Array.isArray(raw) && raw.length) ? raw : (global.SMS_SEED.admissionFields || []);
    return cfg.filter(function (d) { return d.inProfile !== false; });
  }
  function profileDownloadCard(students, classes) {
    var card = el('div', { class: 'card' });
    card.appendChild(el('h3', { text: 'Download student profile' }));
    card.appendChild(el('div', { class: 'help', text: 'A printable profile sheet of a student’s core details — pick a class to narrow the list below, then tick who to include (one, several, or everyone). Which fields appear is controlled in Settings → Admission Form ("Include in profile download").' }));
    var clsSel = el('select');
    clsSel.appendChild(el('option', { value: '', text: 'All classes' }));
    classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
    var checks = {};
    var listBox = el('div', { style: 'max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:.5rem;margin:.5rem 0' });
    function drawList() {
      U.clear(listBox);
      var list = students.filter(function (s) { return !clsSel.value || s.class_id === clsSel.value; })
        .sort(function (a, b) { return (a.first_name || '').localeCompare(b.first_name || ''); });
      if (!list.length) { listBox.appendChild(el('div', { class: 'muted', text: 'No students in this class.' })); return; }
      list.forEach(function (s) {
        var cb = el('input', { type: 'checkbox' }); cb.checked = !!checks[s.student_id];
        cb.addEventListener('change', function () { checks[s.student_id] = cb.checked; });
        listBox.appendChild(el('label', { class: 'check-label', style: 'display:block' }, [cb, document.createTextNode(' ' + s.first_name + ' ' + s.last_name + ' (' + s.student_id + ')')]));
      });
    }
    clsSel.addEventListener('change', drawList); drawList();
    card.appendChild(el('div', { class: 'toolbar' }, [el('span', { class: 'muted', text: 'Class:' }), clsSel]));
    card.appendChild(listBox);
    card.appendChild(el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn sm ghost', text: 'Select all shown', onclick: function () { U.$all('input[type=checkbox]', listBox).forEach(function (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }); } }),
      el('button', { class: 'btn sm ghost', text: 'Clear', onclick: function () { U.$all('input[type=checkbox]', listBox).forEach(function (cb) { cb.checked = false; cb.dispatchEvent(new Event('change')); }); } }),
      el('button', { class: 'btn gold', text: '⤓ Download / print profile(s)', onclick: function () {
        var codes = Object.keys(checks).filter(function (k) { return checks[k]; });
        if (!codes.length) return U.toast('Tick at least one student.', 'err');
        downloadProfiles(students.filter(function (s) { return codes.indexOf(s.student_id) !== -1; }), classes);
      } })
    ]));
    return card;
  }
  function downloadProfiles(list, classes) {
    var fields = profileFieldDefs();
    var sch = App.ctx.school;
    var brand = (App.themeHex ? App.themeHex().primary : '#0f5e5e');
    function fieldValue(s, def) {
      if (def.system) {
        if (def.key === 'class_id') { var c = classes.filter(function (x) { return x.id === s.class_id; })[0]; return c ? c.name : '—'; }
        if (def.key === 'parent_id') { var p = (App.ctx.parents || []).filter(function (x) { return x.id === s.parent_id; })[0]; return p ? p.name : '—'; }
        return s[def.key] || '—';
      }
      var v = s.extra ? s.extra[def.key] : null;
      if (def.type === 'siblings') return (v || []).map(function (r) { return r.name + (r.cls ? ' (' + r.cls + ')' : ''); }).join(', ') || '—';
      if (def.type === 'checkbox') return v ? 'Yes' : 'No';
      return (v == null || v === '') ? '—' : v;
    }
    var html = list.map(function (s) {
      var rows = fields.map(function (d) { return '<tr><td class="lbl">' + U.esc(d.label) + '</td><td>' + U.esc(String(fieldValue(s, d))) + '</td></tr>'; }).join('');
      return '<div class="profile-sheet"><h1>' + U.esc(sch.name) + '</h1><h3>Student Profile</h3>' +
        '<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%">' + rows + '</table></div>';
    }).join('<div style="page-break-after:always"></div>');
    var wn = window.open('', '_blank');
    wn.document.write('<html><head><title>Student profiles</title><style>body{font-family:Arial,Helvetica,sans-serif;padding:22px;color:#1c2726}table{margin-bottom:14px}td{border:1px solid #999;padding:6px;font-size:13px}td.lbl{font-weight:600;background:#faf8f3;width:220px}h1,h3{color:' + brand + ';margin:.3rem 0}</style></head><body>' + html + '</body></html>');
    wn.document.close(); wn.focus(); setTimeout(function () { wn.print(); }, 300);
  }

  function bySort(a, b) { return (a.sort || 0) - (b.sort || 0); }
  global.Views = global.Views || {};
  global.Views.students = { title: 'Students', render: render };
})(window);

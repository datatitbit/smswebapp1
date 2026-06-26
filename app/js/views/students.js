/* ============================================================
 * students.js — Student & Academic: admissions, records,
 * parents (multi-child), class assignment, promotion, bulk admit.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Bulk = global.Bulk;
  var el = U.el;

  function render(container) {
    U.clear(container);
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

  /* ---------- Students ---------- */
  function tabStudents(panel) {
    Promise.all([DB.all('students'), DB.all('classes'), DB.all('parents')]).then(function (r) {
      var students = r[0], classes = r[1].sort(bySort), parents = r[2];
      var filterClass = '', q = '';
      var ro = App.readOnly;

      var tools = el('div', { class: 'toolbar' });
      var search = el('input', { type: 'text', class: 'search', placeholder: 'Search name or ID…' });
      search.addEventListener('input', U.debounce(function () { q = search.value.toLowerCase(); drawTable(); }, 200));
      var clsSel = el('select');
      clsSel.appendChild(el('option', { value: '', text: 'All classes' }));
      classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
      clsSel.addEventListener('change', function () { filterClass = clsSel.value; drawTable(); });
      tools.appendChild(search); tools.appendChild(clsSel);
      tools.appendChild(el('div', { style: 'flex:1' }));
      if (!ro) {
        tools.appendChild(el('button', { class: 'btn', text: '+ Admit student', onclick: function () { editStudent(null, classes, parents, refresh); } }));
        tools.appendChild(el('button', { class: 'btn ghost', text: '⤓ Template', onclick: function () { downloadTemplate(classes); } }));
        tools.appendChild(el('button', { class: 'btn gold', text: '⤒ Upload', onclick: function () { uploadAdmissions(classes, refresh); } }));
      }
      panel.appendChild(tools);

      // Parent role sees only own children
      if (ro && App.user.linked_student_ids) {
        students = students.filter(function (s) { return App.user.linked_student_ids.indexOf(s.student_id) !== -1; });
      }

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
          if (!ro) {
            actions.appendChild(el('button', { class: 'btn sm', text: 'Edit', onclick: function () { editStudent(s, classes, parents, refresh); } }));
            actions.appendChild(el('button', { class: 'btn sm danger', text: 'Del', onclick: function () { U.confirm('Withdraw/delete ' + s.first_name + '?', function () { DB.remove('students', s.id).then(refresh); }); } }));
          } else actions.appendChild(el('span', { class: 'muted', text: 'read-only' }));
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

  function editStudent(s, classes, parents, done) {
    var rules = App.ctx.idRules;
    var fields = [
      { name: 'first_name', label: 'First name', required: true },
      { name: 'last_name', label: 'Last name', required: true },
      { name: 'gender', label: 'Gender', type: 'select', options: ['', 'M', 'F'] },
      { name: 'dob', label: 'Date of birth', type: 'date' },
      { name: 'class_id', label: 'Class', type: 'select', options: classes.map(function (c) { return { value: c.id, label: c.name }; }) },
      { name: 'parent_id', label: 'Parent / Guardian', type: 'select', options: [{ value: '', label: '— none —' }].concat(parents.map(function (p) { return { value: p.id, label: p.name }; })) },
      { name: 'status', label: 'Status', type: 'select', options: ['active', 'withdrawn', 'completed'] },
      { name: 'admitted_on', label: 'Admitted on', type: 'date' }
    ];
    if (rules.allow_manual && !s) fields.unshift({ name: 'student_id', label: 'Student ID (leave blank to auto-generate)', placeholder: rules.student_prefix + '____' });
    var f = U.form(fields, s || { status: 'active', admitted_on: U.todayISO() });
    f.classList.add('form-grid');
    U.modal({ title: s ? 'Edit student' : 'Admit student', wide: true, body: f, actions: [
      { label: 'Cancel', onClick: function (x) { x(); } },
      { label: 'Save', kind: 'gold', onClick: function (x) {
        var errs = f.validate(); if (errs.length) return U.toast(errs[0], 'err');
        var v = f.readValues();
        if (s) {
          DB.update('students', s.id, v).then(function () { linkParent(s.id, v.parent_id, s.parent_id).then(function () { x(); U.toast('Student updated.'); done(); }); });
        } else {
          var go = (v.student_id && v.student_id.trim())
            ? Promise.resolve(v.student_id.trim())
            : DB.nextCode('student', rules.student_prefix, rules.digits);
          go.then(function (code) {
            v.student_id = code; v.id = 'stu-' + code;
            DB.insert('students', v).then(function () { linkParent(v.id, v.parent_id, null).then(function () { x(); U.toast('Admitted as ' + code); done(); }); });
          });
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
      var parents = r[0], students = r[1], ro = App.readOnly;
      var tools = el('div', { class: 'toolbar' });
      if (!ro) tools.appendChild(el('button', { class: 'btn', text: '+ Add parent / guardian', onclick: function () { editParent(null, students, refresh); } }));
      panel.appendChild(tools);
      var c = el('div', { class: 'card' });
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Name', 'Phone', 'WhatsApp', 'Children', ''].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      parents.forEach(function (p) {
        var kids = students.filter(function (s) { return (p.student_ids || []).indexOf(s.student_id) !== -1; })
          .map(function (s) { return s.first_name + ' ' + s.last_name; }).join(', ') || '—';
        var act = el('div', { class: 'wrap-actions' });
        if (!ro) {
          act.appendChild(el('button', { class: 'btn sm', text: 'Edit', onclick: function () { editParent(p, students, refresh); } }));
          act.appendChild(el('button', { class: 'btn sm danger', text: 'Del', onclick: function () { U.confirm('Delete parent ' + p.name + '?', function () { DB.remove('parents', p.id).then(refresh); }); } }));
        }
        tb.appendChild(el('tr', {}, [el('td', { text: p.name }), el('td', { text: p.phone || '—' }), el('td', { text: p.whatsapp || '—' }), el('td', { text: kids }), el('td', {}, [act])]));
      });
      t.appendChild(tb);
      c.appendChild(el('div', { class: 'table-wrap' }, [t]));
      panel.appendChild(c);
      panel.appendChild(el('div', { class: 'note', text: 'One parent links to several children — a single message or login covers all of them.' }));
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
          // sync student.parent_id
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
      panel.appendChild(el('div', { class: 'note', text: 'Promotional term (' + App.termName() + '). Each pupil defaults to “promoted to the next class”. Flag any who repeat. Basic 9 pupils complete (BECE / Alumni).' }));
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
      if (App.readOnly) return;
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
        // sequentially assign IDs
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

  function bySort(a, b) { return (a.sort || 0) - (b.sort || 0); }
  global.Views = global.Views || {};
  global.Views.students = { title: 'Students', render: render };
})(window);

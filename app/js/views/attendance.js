/* ============================================================
 * attendance.js — daily attendance (fast mobile marking),
 * conduct notes, bulk upload. Totals feed the report card.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Bulk = global.Bulk;
  var el = U.el;

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Attendance & Discipline' })]));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Student Attendance';
    var tabs = ['Student Attendance', 'Staff Attendance', 'Conduct Notes'];
    tabs.forEach(function (t) { var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b); });
    container.appendChild(bar); container.appendChild(panel);
    function draw() {
      U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); });
      U.clear(panel);
      if (active === 'Student Attendance') tabDaily(panel);
      else if (active === 'Staff Attendance') tabStaff(panel);
      else tabConduct(panel);
    }
    draw();
  }

  function classOptions() {
    var all = App.ctx.classes.slice().sort(function (a, b) { return a.sort - b.sort; });
    if (App.user.role === 'Teacher') {
      var ids = App.teacherClassIds();
      if (ids.length) all = all.filter(function (c) { return ids.indexOf(c.id) !== -1; });
    }
    return all;
  }

  function tabDaily(panel) {
    var classes = classOptions();
    var tools = el('div', { class: 'toolbar' });
    var clsSel = el('select'); classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
    var dateInp = el('input', { type: 'date', value: U.todayISO() });
    tools.appendChild(el('span', { class: 'muted', text: 'Class:' })); tools.appendChild(clsSel);
    tools.appendChild(el('span', { class: 'muted', text: 'Date:' })); tools.appendChild(dateInp);
    tools.appendChild(el('div', { style: 'flex:1' }));
    if (!App.readOnly) {
      tools.appendChild(el('button', { class: 'btn ghost sm', text: '⤓ Template', onclick: function () { tmpl(clsSel.value, dateInp.value); } }));
      tools.appendChild(el('button', { class: 'btn gold sm', text: '⤒ Upload', onclick: function () { upload(clsSel.value, dateInp.value, load); } }));
    }
    panel.appendChild(tools);
    var area = el('div'); panel.appendChild(area);
    clsSel.addEventListener('change', load); dateInp.addEventListener('change', load);
    if (classes.length) { clsSel.value = classes[0].id; load(); } else area.appendChild(el('div', { class: 'empty', text: 'No classes assigned.' }));

    function load() {
      U.clear(area);
      var classId = clsSel.value, date = dateInp.value;
      Promise.all([DB.all('students'), DB.all('attendance')]).then(function (r) {
        var students = r[0].filter(function (s) { return s.class_id === classId && s.status === 'active'; });
        var existing = r[1].filter(function (a) { return a.class_id === classId && a.date === date; });
        var card = el('div', { class: 'card' });
        card.appendChild(el('h3', { text: App.className(classId) + ' · ' + U.fmtDate(date) }));
        if (!students.length) { card.appendChild(el('div', { class: 'empty', text: 'No pupils.' })); area.appendChild(card); return; }
        var state = {}; students.forEach(function (s) {
          var ex = existing.filter(function (a) { return a.student_id === s.student_id; })[0];
          state[s.student_id] = ex ? ex.status : 'present';
        });
        if (!App.readOnly) card.appendChild(el('div', { class: 'btn-row', style: 'margin-bottom:.5rem' }, [
          el('button', { class: 'btn sm ghost', text: 'All present', onclick: function () { students.forEach(function (s) { state[s.student_id] = 'present'; }); paint(); } }),
          el('button', { class: 'btn sm ghost', text: 'All absent', onclick: function () { students.forEach(function (s) { state[s.student_id] = 'absent'; }); paint(); } })
        ]));
        // Sortable ID / Name headers make marking a long list easier.
        var sortKey = 'id', sortDir = 'asc';
        function arrow(k) { return sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'; }
        var idH = el('button', { class: 'btn sm ghost' });
        var nameH = el('button', { class: 'btn sm ghost' });
        function setSort(k) { if (sortKey === k) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; } else { sortKey = k; sortDir = 'asc'; } idH.textContent = 'ID' + arrow('id'); nameH.textContent = 'Name' + arrow('name'); paint(); }
        idH.onclick = function () { setSort('id'); }; nameH.onclick = function () { setSort('name'); };
        idH.textContent = 'ID' + arrow('id'); nameH.textContent = 'Name' + arrow('name');
        card.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:2px solid var(--line);gap:.5rem;flex-wrap:wrap' }, [
          el('div', { class: 'btn-row' }, [el('span', { class: 'muted', text: 'Sort:' }), idH, nameH]),
          el('span', { class: 'muted', style: 'font-size:.8rem', text: 'P = present · A = absent · L = late' })
        ]));
        var listBox = el('div'); card.appendChild(listBox);
        function paint() {
          U.clear(listBox);
          var ordered = students.slice().sort(function (a, b) {
            var av = sortKey === 'name' ? (a.first_name + ' ' + a.last_name).toLowerCase() : a.student_id;
            var bv = sortKey === 'name' ? (b.first_name + ' ' + b.last_name).toLowerCase() : b.student_id;
            var c = av < bv ? -1 : av > bv ? 1 : 0; return sortDir === 'asc' ? c : -c;
          });
          ordered.forEach(function (s) {
            var row = el('div', { class: 'flex', style: 'justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--line);gap:.5rem' });
            row.appendChild(el('span', {}, [el('span', { class: 'muted', style: 'display:inline-block;min-width:70px', text: s.student_id }), document.createTextNode(s.first_name + ' ' + s.last_name)]));
            var btns = el('div', { class: 'btn-row' });
            [['present', 'P'], ['absent', 'A'], ['late', 'L']].forEach(function (o) {
              var b = el('button', { class: 'btn sm ' + (state[s.student_id] === o[0] ? (o[0] === 'absent' ? 'danger' : 'gold') : 'ghost'), text: o[1], onclick: function () { if (App.readOnly) return; state[s.student_id] = o[0]; paint(); } });
              btns.appendChild(b);
            });
            row.appendChild(btns); listBox.appendChild(row);
          });
        }
        paint();
        if (!App.readOnly) card.appendChild(el('button', { class: 'btn gold', style: 'margin-top:.7rem', text: 'Save attendance', onclick: function () {
          var ops = students.map(function (s) {
            var ex = existing.filter(function (a) { return a.student_id === s.student_id; })[0];
            var rec = { student_id: s.student_id, class_id: classId, date: date, status: state[s.student_id] };
            return ex ? DB.update('attendance', ex.id, rec) : DB.insert('attendance', rec);
          });
          Promise.all(ops).then(function () { U.toast('Attendance saved.'); load(); });
        } }));
        // summary
        DB.all('attendance').then(function (all) {
          var dates = {}; all.filter(function (a) { return a.class_id === classId; }).forEach(function (a) { dates[a.date] = true; });
          card.appendChild(el('div', { class: 'help', style: 'margin-top:.5rem', text: 'Days recorded for this class so far: ' + Object.keys(dates).length + ' (feeds the report card attendance line).' }));
        });
        area.appendChild(card);
      });
    }
    function tmpl(classId, date) {
      DB.all('students').then(function (st) {
        var rows = [['student_id', 'name', 'status (present/absent/late)']];
        st.filter(function (s) { return s.class_id === classId && s.status === 'active'; }).forEach(function (s) { rows.push([s.student_id, s.first_name + ' ' + s.last_name, 'present']); });
        Bulk.download('attendance-' + date + '.csv', rows); U.toast('Template downloaded.');
      });
    }
    function upload(classId, date, done) {
      DB.all('students').then(function (st) {
        var codes = {}; st.forEach(function (s) { codes[s.student_id] = s; });
        Bulk.pickFile().then(function (file) {
          var res = Bulk.processUpload(file.rows, ['student_id', 'status (present/absent/late)'], function (row) {
            var status = (row['status (present/absent/late)'] || '').toLowerCase();
            var errs = [];
            if (!codes[row.student_id]) errs.push('unknown student_id');
            if (['present', 'absent', 'late'].indexOf(status) === -1) errs.push('status must be present/absent/late');
            if (errs.length) return { ok: false, errors: errs };
            return { ok: true, value: { student_id: row.student_id, class_id: classId, date: date, status: status } };
          });
          Bulk.summaryModal('Import attendance · ' + date, res, function (valid) {
            DB.all('attendance').then(function (all) {
              var ops = valid.map(function (v) {
                var ex = all.filter(function (a) { return a.class_id === classId && a.date === date && a.student_id === v.student_id; })[0];
                return ex ? DB.update('attendance', ex.id, v) : DB.insert('attendance', v);
              });
              Promise.all(ops).then(function () { U.toast('Imported ' + valid.length + ' record(s).'); done(); });
            });
          });
        }).catch(function () {});
      });
    }
  }

  function tabStaff(panel) {
    var tools = el('div', { class: 'toolbar' });
    var dateInp = el('input', { type: 'date', value: U.todayISO() });
    tools.appendChild(el('span', { class: 'muted', text: 'Date:' })); tools.appendChild(dateInp);
    tools.appendChild(el('div', { style: 'flex:1' }));
    if (!App.readOnly) {
      tools.appendChild(el('button', { class: 'btn ghost sm', text: '⤓ Template', onclick: function () { staffTmpl(dateInp.value); } }));
      tools.appendChild(el('button', { class: 'btn gold sm', text: '⤒ Upload', onclick: function () { staffUpload(dateInp.value, load); } }));
    }
    panel.appendChild(tools);
    var area = el('div'); panel.appendChild(area);
    dateInp.addEventListener('change', load); load();
    function load() {
      U.clear(area);
      var date = dateInp.value;
      Promise.all([DB.all('staff'), DB.all('staffAttendance')]).then(function (r) {
        var staff = r[0], existing = r[1].filter(function (a) { return a.date === date; });
        var card = el('div', { class: 'card' });
        card.appendChild(el('h3', { text: 'Staff attendance · ' + U.fmtDate(date) }));
        if (!staff.length) { card.appendChild(el('div', { class: 'empty', text: 'No staff records.' })); area.appendChild(card); return; }
        var state = {}; staff.forEach(function (s) {
          var ex = existing.filter(function (a) { return a.staff_id === s.staff_id; })[0];
          state[s.staff_id] = ex ? ex.status : 'present'; // present by default
        });
        if (!App.readOnly) card.appendChild(el('div', { class: 'btn-row', style: 'margin-bottom:.5rem' }, [
          el('button', { class: 'btn sm ghost', text: 'All present', onclick: function () { staff.forEach(function (s) { state[s.staff_id] = 'present'; }); paint(); } }),
          el('button', { class: 'btn sm ghost', text: 'All absent', onclick: function () { staff.forEach(function (s) { state[s.staff_id] = 'absent'; }); paint(); } })
        ]));
        // Sortable ID / Name headers make marking easier.
        var sortKey = 'id', sortDir = 'asc';
        function arrow(k) { return sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'; }
        var idH = el('button', { class: 'btn sm ghost' });
        var nameH = el('button', { class: 'btn sm ghost' });
        function setSort(k) { if (sortKey === k) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; } else { sortKey = k; sortDir = 'asc'; } idH.textContent = 'ID' + arrow('id'); nameH.textContent = 'Name' + arrow('name'); paint(); }
        idH.onclick = function () { setSort('id'); }; nameH.onclick = function () { setSort('name'); };
        idH.textContent = 'ID' + arrow('id'); nameH.textContent = 'Name' + arrow('name');
        card.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between;align-items:center;padding:.35rem 0;border-bottom:2px solid var(--line);gap:.5rem;flex-wrap:wrap' }, [
          el('div', { class: 'btn-row' }, [el('span', { class: 'muted', text: 'Sort:' }), idH, nameH]),
          el('span', { class: 'muted', style: 'font-size:.8rem', text: 'P = present · A = absent · L = late' })
        ]));
        var listBox = el('div'); card.appendChild(listBox);
        function paint() {
          U.clear(listBox);
          var ordered = staff.slice().sort(function (a, b) {
            var av = sortKey === 'name' ? (a.name || '').toLowerCase() : a.staff_id;
            var bv = sortKey === 'name' ? (b.name || '').toLowerCase() : b.staff_id;
            var c = av < bv ? -1 : av > bv ? 1 : 0; return sortDir === 'asc' ? c : -c;
          });
          ordered.forEach(function (s) {
            var row = el('div', { class: 'flex', style: 'justify-content:space-between;padding:.35rem 0;border-bottom:1px solid var(--line);gap:.5rem' });
            row.appendChild(el('span', {}, [el('span', { class: 'muted', style: 'display:inline-block;min-width:70px', text: s.staff_id }), document.createTextNode(s.name + ' (' + s.role + ')')]));
            var btns = el('div', { class: 'btn-row' });
            [['present', 'P'], ['absent', 'A'], ['late', 'L']].forEach(function (o) {
              btns.appendChild(el('button', { class: 'btn sm ' + (state[s.staff_id] === o[0] ? (o[0] === 'absent' ? 'danger' : 'gold') : 'ghost'), text: o[1], onclick: function () { if (App.readOnly) return; state[s.staff_id] = o[0]; paint(); } }));
            });
            row.appendChild(btns); listBox.appendChild(row);
          });
        }
        paint();
        if (!App.readOnly) card.appendChild(el('button', { class: 'btn gold', style: 'margin-top:.7rem', text: 'Save staff attendance', onclick: function () {
          var ops = staff.map(function (s) {
            var ex = existing.filter(function (a) { return a.staff_id === s.staff_id; })[0];
            var rec = { staff_id: s.staff_id, date: date, status: state[s.staff_id] };
            return ex ? DB.update('staffAttendance', ex.id, rec) : DB.insert('staffAttendance', rec);
          });
          Promise.all(ops).then(function () { U.toast('Staff attendance saved.'); load(); });
        } }));
        area.appendChild(card);
      });
    }
    function staffTmpl(date) {
      DB.all('staff').then(function (staff) {
        var rows = [['staff_id', 'name', 'status (present/absent/late)']];
        staff.forEach(function (s) { rows.push([s.staff_id, s.name, 'present']); });
        Bulk.download('staff-attendance-' + date + '.csv', rows); U.toast('Template downloaded.');
      });
    }
    function staffUpload(date, done) {
      DB.all('staff').then(function (staff) {
        var codes = {}; staff.forEach(function (s) { codes[s.staff_id] = s; });
        Bulk.pickFile().then(function (file) {
          var res = Bulk.processUpload(file.rows, ['staff_id', 'status (present/absent/late)'], function (row) {
            var status = (row['status (present/absent/late)'] || '').toLowerCase();
            var errs = [];
            if (!codes[row.staff_id]) errs.push('unknown staff_id');
            if (['present', 'absent', 'late'].indexOf(status) === -1) errs.push('status must be present/absent/late');
            if (errs.length) return { ok: false, errors: errs };
            return { ok: true, value: { staff_id: row.staff_id, date: date, status: status } };
          });
          Bulk.summaryModal('Import staff attendance · ' + date, res, function (valid) {
            DB.all('staffAttendance').then(function (all) {
              var ops = valid.map(function (v) {
                var ex = all.filter(function (a) { return a.staff_id === v.staff_id && a.date === date; })[0];
                return ex ? DB.update('staffAttendance', ex.id, v) : DB.insert('staffAttendance', v);
              });
              Promise.all(ops).then(function () { U.toast('Imported ' + valid.length + ' record(s).'); done(); });
            });
          });
        }).catch(function () {});
      });
    }
  }

  function tabConduct(panel) {
    var classes = classOptions();
    var tools = el('div', { class: 'toolbar' });
    var clsSel = el('select'); classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
    tools.appendChild(el('span', { class: 'muted', text: 'Class:' })); tools.appendChild(clsSel);
    panel.appendChild(tools);
    var area = el('div'); panel.appendChild(area);
    clsSel.addEventListener('change', load); if (classes.length) { clsSel.value = classes[0].id; load(); }
    function load() {
      U.clear(area);
      Promise.all([DB.all('students'), DB.all('conduct')]).then(function (r) {
        var students = r[0].filter(function (s) { return s.class_id === clsSel.value && s.status === 'active'; });
        var notes = r[1] || [];
        var c = el('div', { class: 'card' }, [el('h3', { text: 'Conduct / discipline notes' })]);
        students.forEach(function (s) {
          var snotes = notes.filter(function (n) { return n.student_id === s.student_id; });
          var row = el('div', { style: 'border-bottom:1px solid var(--line);padding:.4rem 0' });
          row.appendChild(el('div', { class: 'flex', style: 'justify-content:space-between' }, [
            el('b', { text: s.first_name + ' ' + s.last_name }),
            App.readOnly ? null : el('button', { class: 'btn sm ghost', text: '+ note', onclick: function () { addNote(s, load); } })
          ]));
          if (snotes.length) snotes.forEach(function (n) { row.appendChild(el('div', { class: 'help', text: U.fmtDate(n.date) + ' — ' + n.note })); });
          else row.appendChild(el('div', { class: 'help muted', text: 'No notes.' }));
          c.appendChild(row);
        });
        if (!students.length) c.appendChild(el('div', { class: 'empty', text: 'No pupils.' }));
        area.appendChild(c);
      });
    }
    function addNote(s, done) {
      var f = U.form([{ name: 'note', label: 'Note', type: 'textarea', required: true }], {});
      U.modal({ title: 'Conduct note · ' + s.first_name, body: f, actions: [
        { label: 'Cancel', onClick: function (x) { x(); } },
        { label: 'Save', kind: 'gold', onClick: function (x) { var v = f.readValues(); if (!v.note.trim()) return U.toast('Note required', 'err'); DB.insert('conduct', { student_id: s.student_id, class_id: s.class_id, date: U.todayISO(), note: v.note, by: App.user.name }).then(function () { x(); U.toast('Saved.'); done(); }); } }
      ] });
    }
  }

  global.Views = global.Views || {};
  global.Views.attendance = { title: 'Attendance', render: render };
})(window);

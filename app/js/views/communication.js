/* ============================================================
 * communication.js — SMS / announcements (mock sender),
 * editable templates with placeholders, multi-child parents.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, Services = global.Services, FL = global.FinanceLib;
  var el = U.el;

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Communication & Engagement' })]));
    container.appendChild(el('div', { class: 'note', html: 'SMS runs through a <b>mock sender</b> (test mode). Real gateway (e.g. Arkesel / Hubtel / mNotify) is wired at deployment by changing config only.' }));
    var bar = el('div', { class: 'tabs' }); var panel = el('div'); var active = 'Send SMS';
    var tabs = App.readOnly ? ['Announcements'] : ['Send SMS', 'Announcements', 'Sent Log'];
    tabs.forEach(function (t) { var b = el('button', { text: t, onclick: function () { active = t; draw(); } }); b._t = t; bar.appendChild(b); });
    container.appendChild(bar); container.appendChild(panel);
    function draw() { U.$all('button', bar).forEach(function (b) { b.classList.toggle('active', b._t === active); }); U.clear(panel);
      if (active === 'Send SMS') tabSend(panel); else if (active === 'Announcements') tabAnnounce(panel); else tabLog(panel); }
    draw();
  }

  function fillPlaceholders(body, parent, student, extra) {
    var sc = App.ctx.school;
    return body
      .replace(/{parent}/g, parent ? parent.name : 'Parent')
      .replace(/{student}/g, student ? (student.first_name + ' ' + student.last_name) : 'your child')
      .replace(/{term}/g, App.termName())
      .replace(/{currency}/g, sc.currency)
      .replace(/{school}/g, sc.name)
      .replace(/{balance}/g, (extra && extra.balance != null) ? Number(extra.balance).toFixed(2) : '0.00')
      .replace(/{message}/g, (extra && extra.message) || '');
  }

  function tabSend(panel) {
    Promise.all([DB.all('messageTemplates'), DB.all('parents'), DB.all('students'), DB.all('classes'), DB.all('invoices'), DB.all('payments')]).then(function (r) {
      var templates = r[0], parents = r[1], students = r[2], classes = r[3].sort(function (a, b) { return a.sort - b.sort; }), invoices = r[4], payments = r[5];
      var tmplSel = el('select'); templates.forEach(function (t) { tmplSel.appendChild(el('option', { value: t.id, text: t.name })); });
      var audSel = el('select');
      [['all', 'All parents'], ['class', 'By class']].forEach(function (o) { audSel.appendChild(el('option', { value: o[0], text: o[1] })); });
      var clsSel = el('select'); classes.forEach(function (c) { clsSel.appendChild(el('option', { value: c.id, text: c.name })); });
      clsSel.style.display = 'none';
      audSel.addEventListener('change', function () { clsSel.style.display = audSel.value === 'class' ? '' : 'none'; });
      var bodyArea = el('textarea', { rows: 4, style: 'width:100%' });
      var extraMsg = el('input', { type: 'text', placeholder: 'Text for {message} placeholder (announcements)', style: 'width:100%' });
      function loadTmpl() { var t = templates.filter(function (x) { return x.id === tmplSel.value; })[0]; bodyArea.value = t ? t.body : ''; }
      tmplSel.addEventListener('change', loadTmpl); loadTmpl();

      var c = el('div', { class: 'card' }, [
        el('div', { class: 'form-grid' }, [
          field('Template', tmplSel), field('Audience', audSel), field('Class', clsSel), field('{message} text', extraMsg)
        ]),
        field('Message body (placeholders allowed)', bodyArea)
      ]);
      c.appendChild(el('div', { class: 'help', text: 'Placeholders: {parent} {student} {term} {balance} {currency} {school} {message}' }));
      c.appendChild(el('div', { class: 'btn-row', style: 'margin-top:.5rem' }, [
        el('button', { class: 'btn ghost', text: 'Preview recipients', onclick: function () { preview(false); } }),
        el('button', { class: 'btn gold', text: 'Send (test mode)', onclick: function () { preview(true); } })
      ]));
      panel.appendChild(c);

      function recipients() {
        var list = [];
        parents.forEach(function (p) {
          var kids = students.filter(function (s) { return (p.student_ids || []).indexOf(s.student_id) !== -1 && s.status === 'active'; });
          if (audSel.value === 'class') kids = kids.filter(function (s) { return s.class_id === clsSel.value; });
          if (!kids.length || !p.phone) return;
          var child = kids[0]; // multi-child: address to parent, reference first child
          var klass = classes.filter(function (cl) { return cl.id === child.class_id; })[0];
          var pos = FL.studentFeePosition(child.student_id, klass, invoices, payments, App.ctx.feeTypes);
          list.push({ parent: p, student: child, kids: kids, balance: pos.arrears });
        });
        return list;
      }
      function preview(doSend) {
        var list = recipients();
        if (!list.length) return U.toast('No matching parents with a phone number.', 'warn');
        var body = el('div');
        body.appendChild(el('p', { html: '<b>' + list.length + '</b> recipient(s). Sample:' }));
        var sample = list.slice(0, 3).map(function (rcp) {
          return el('div', { class: 'note', text: rcp.parent.phone + ' → ' + fillPlaceholders(bodyArea.value, rcp.parent, rcp.student, { balance: rcp.balance, message: extraMsg.value }) });
        });
        sample.forEach(function (n) { body.appendChild(n); });
        U.modal({ title: doSend ? 'Confirm send' : 'Preview', wide: true, body: body, actions: doSend ? [
          { label: 'Cancel', onClick: function (x) { x(); } },
          { label: 'Send to ' + list.length, kind: 'gold', onClick: function (x) {
            var msgs = list.map(function (rcp) { return { to: rcp.parent.phone, body: fillPlaceholders(bodyArea.value, rcp.parent, rcp.student, { balance: rcp.balance, message: extraMsg.value }) }; });
            Services.SMS.sendBulk(msgs).then(function () {
              var ops = msgs.map(function (m) { return DB.insert('messages', { to: m.to, body: m.body, channel: 'sms', status: 'sent (test)', at: new Date().toISOString(), by: App.user.name }); });
              Promise.all(ops).then(function () { x(); U.toast('Sent ' + msgs.length + ' message(s) (test mode).'); });
            });
          } }
        ] : [{ label: 'Close', onClick: function (x) { x(); } }] });
      }
    });
  }

  function tabAnnounce(panel) {
    DB.all('announcements').then(function (anns) {
      if (!App.readOnly) {
        var f = U.form([
          { name: 'title', label: 'Title', required: true },
          { name: 'body', label: 'Announcement', type: 'textarea', rows: 3, required: true }
        ], {});
        var c = el('div', { class: 'card' }, [el('h3', { text: 'Post an announcement' }), f]);
        c.appendChild(el('button', { class: 'btn gold', text: 'Post', onclick: function () {
          var v = f.readValues(); if (!v.title.trim() || !v.body.trim()) return U.toast('Title and body required', 'err');
          DB.insert('announcements', { title: v.title, body: v.body, at: new Date().toISOString(), by: App.user.name }).then(function () { U.toast('Posted.'); U.clear(panel); tabAnnounce(panel); });
        } }));
        panel.appendChild(c);
      }
      var list = el('div', { class: 'card' }, [el('h3', { text: 'Announcements' })]);
      anns.slice().reverse().forEach(function (a) {
        list.appendChild(el('div', { style: 'border-bottom:1px solid var(--line);padding:.5rem 0' }, [
          el('b', { text: a.title }), el('div', { class: 'help', text: U.fmtDate((a.at || '').slice(0, 10)) + ' · ' + (a.by || '') }), el('div', { text: a.body }),
          App.readOnly ? null : el('button', { class: 'btn sm danger', style: 'margin-top:.3rem', text: 'Delete', onclick: function () { DB.remove('announcements', a.id).then(function () { U.clear(panel); tabAnnounce(panel); }); } })
        ]));
      });
      if (!anns.length) list.appendChild(el('div', { class: 'empty', text: 'No announcements yet.' }));
      panel.appendChild(list);
    });
  }

  function tabLog(panel) {
    DB.all('messages').then(function (msgs) {
      var c = el('div', { class: 'card' }, [el('h3', { text: 'Sent SMS log (test mode)' })]);
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['When', 'To', 'Message', 'Status'].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      msgs.slice().reverse().forEach(function (m) { tb.appendChild(el('tr', {}, [el('td', { text: U.fmtDate((m.at || '').slice(0, 10)) }), el('td', { text: m.to }), el('td', { text: m.body }), el('td', {}, [el('span', { class: 'tag', text: m.status })])])); });
      if (!msgs.length) tb.appendChild(el('tr', {}, [el('td', { colspan: 4, html: '<span class=muted>Nothing sent yet.</span>' })]));
      t.appendChild(tb); c.appendChild(el('div', { class: 'table-wrap' }, [t])); panel.appendChild(c);
    });
  }

  function field(label, node) { return el('div', { class: 'field' }, [el('label', { text: label }), node]); }
  global.Views = global.Views || {};
  global.Views.communication = { title: 'Communication', render: render };
})(window);

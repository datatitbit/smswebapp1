/* ============================================================
 * automation.js — the school's "night clerk".
 * Idempotent boot-time rules that do routine admin work
 * automatically: term billing, fee reminders, absence notices,
 * low-stock alerts, payroll-due reminders, report-ready notices.
 * Every action is logged to `automationLog` and the important
 * ones surface as announcements. All rules are toggleable in
 * Settings → Automation. Runs for Admin/Director sessions only.
 * All messages go through the same TEST-MODE channel as the
 * Communication module — nothing real is sent until deployment.
 * ============================================================ */
(function (global) {
  'use strict';

  function U() { return global.U; }
  function DB() { return global.DB; }
  function App() { return global.App; }

  var DEFAULTS = {
    id: 'auto-1',
    enabled: true,
    auto_billing: true,          // generate current-term invoices for unbilled pupils
    fee_reminders: true,         // SMS parents with arrears every N days
    fee_reminder_days: 7,
    absence_notify: true,        // SMS parent when child marked absent today
    low_stock_alerts: true,      // announcement when items hit threshold
    payroll_reminder: true,      // announcement if month-end payroll not run
    payroll_reminder_day: 25,
    report_ready_notify: false   // SMS parents when a class's term scores are complete
  };

  function today() { return new Date().toISOString().slice(0, 10); }
  function thisMonth() { return today().slice(0, 7); }

  function getSettings() {
    return DB().singleton('automation').then(function (s) {
      return Object.assign({}, DEFAULTS, s || {});
    });
  }

  function log(rule, key, summary) {
    return DB().insert('automationLog', { rule: rule, key: key, date: today(), summary: summary, at: new Date().toISOString() });
  }
  function announce(title, body) {
    return DB().insert('announcements', { title: title, body: body, at: new Date().toISOString(), by: 'Automation' });
  }
  function sendSMS(to, body) {
    return DB().insert('messages', { to: to, body: body, channel: 'sms', status: 'sent (test mode)', at: new Date().toISOString(), by: 'Automation' });
  }
  function fill(tpl, map) {
    return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return map[k] != null ? map[k] : '{' + k + '}'; });
  }

  /* ---------- R1: auto term billing ---------- */
  function ruleBilling(S, ctx, logs) {
    if (!S.auto_billing) return Promise.resolve();
    var term = ctx.academic.current_term;
    var key = 'bill-' + ctx.academic.year + '-t' + term;
    return Promise.all([DB().all('students'), DB().all('invoices'), DB().all('feeTypes')]).then(function (r) {
      var students = r[0].filter(function (s) { return s.status === 'active'; });
      var invoices = r[1]; var feeTypes = r[2];
      var ops = []; var created = 0; var pupils = 0;
      students.forEach(function (s) {
        var klass = ctx.classes.filter(function (c) { return c.id === s.class_id; })[0]; if (!klass) return;
        var made = false;
        feeTypes.filter(function (f) {
          return f.frequency === 'per_term' && f.required &&
            (f.applies_to === 'all' || f.applies_to === klass.category_id);
        }).forEach(function (f) {
          var dup = invoices.some(function (i) { return i.student_id === s.student_id && i.term === term && i.fee_type_id === f.id; });
          if (dup) return;
          created++; made = true;
          ops.push(DB().insert('invoices', { student_id: s.student_id, class_id: s.class_id, term: term, fee_type_id: f.id, fee_name: f.name, amount: f.amount, created_on: today() }));
        });
        if (made) pupils++;
      });
      if (!created) return;
      return Promise.all(ops).then(function () {
        logs.push('Billing: ' + created + ' bill line(s) for ' + pupils + ' pupil(s)');
        return log('billing', key + '-' + today(), 'Auto-generated ' + created + ' required-fee bill line(s) for ' + pupils + ' pupil(s), term ' + term)
          .then(function () { return announce('Term bills auto-generated', created + ' required-fee bill line(s) were created automatically for ' + pupils + ' pupil(s). Optional fees are billed manually in Finance.'); });
      });
    });
  }

  /* ---------- R2: fee reminders every N days ---------- */
  function ruleFeeReminders(S, ctx, logs, prior) {
    if (!S.fee_reminders) return Promise.resolve();
    var last = prior.filter(function (x) { return x.rule === 'feerem'; }).map(function (x) { return x.date; }).sort().pop();
    if (last) {
      var days = Math.floor((new Date(today()) - new Date(last)) / 864e5);
      if (days < (Number(S.fee_reminder_days) || 7)) return Promise.resolve();
    }
    var term = ctx.academic.current_term;
    return Promise.all([DB().all('students'), DB().all('invoices'), DB().all('payments'), DB().all('parents'), DB().all('messageTemplates')]).then(function (r) {
      var students = r[0].filter(function (s) { return s.status === 'active'; });
      var invoices = r[1].filter(function (i) { return i.term === term; });
      var payments = r[2].filter(function (p) { return p.term === term; });
      var parents = r[3];
      var tpl = (r[4].filter(function (t) { return t.id === 'mt-fee'; })[0] || {}).body ||
        'Dear {parent}, {student} has an outstanding balance of {currency}{balance} for {term}. - {school}';
      var ops = []; var sent = 0;
      parents.forEach(function (pa) {
        if (!pa.phone) return;
        var kids = students.filter(function (s) { return (pa.student_ids || []).indexOf(s.student_id) !== -1; });
        var owed = 0; var names = [];
        kids.forEach(function (s) {
          var b = invoices.filter(function (i) { return i.student_id === s.student_id; }).reduce(function (a, i) { return a + Number(i.amount || 0); }, 0);
          var p = payments.filter(function (x) { return x.student_id === s.student_id; }).reduce(function (a, x) { return a + Number(x.amount || 0); }, 0);
          if (b - p > 0) { owed += b - p; names.push(s.first_name); }
        });
        if (owed <= 0) return;
        sent++;
        ops.push(sendSMS(pa.phone, fill(tpl, {
          parent: pa.name, student: names.join(' & '), term: App().termName(),
          balance: owed.toFixed(2), currency: ctx.school.currency + ' ', school: ctx.school.name, message: ''
        })));
      });
      if (!sent) return log('feerem', 'feerem-' + today(), 'Fee reminder check: no arrears — nothing sent');
      return Promise.all(ops).then(function () {
        logs.push('Fee reminders: ' + sent + ' parent(s) messaged (test mode)');
        return log('feerem', 'feerem-' + today(), 'Sent ' + sent + ' fee-reminder SMS (test mode) to parents with arrears');
      });
    });
  }

  /* ---------- R3: absence notifications (today) ---------- */
  function ruleAbsence(S, ctx, logs, prior) {
    if (!S.absence_notify) return Promise.resolve();
    if (prior.some(function (x) { return x.rule === 'absence' && x.date === today(); })) return Promise.resolve();
    return Promise.all([DB().all('attendance'), DB().all('students'), DB().all('parents')]).then(function (r) {
      var absent = r[0].filter(function (a) { return a.date === today() && a.status === 'absent'; });
      if (!absent.length) return; // nothing to do; don't log — allows later marking same day to trigger
      var students = r[1], parents = r[2];
      var ops = []; var sent = 0;
      absent.forEach(function (a) {
        var s = students.filter(function (x) { return x.student_id === a.student_id; })[0]; if (!s || !s.parent_id) return;
        var pa = parents.filter(function (x) { return x.id === s.parent_id; })[0]; if (!pa || !pa.phone) return;
        sent++;
        ops.push(sendSMS(pa.phone, 'Dear ' + pa.name + ', ' + s.first_name + ' was marked ABSENT today (' + today() + '). Please contact the school if unexpected. - ' + ctx.school.name));
      });
      if (!sent) return;
      return Promise.all(ops).then(function () {
        logs.push('Absence notices: ' + sent + ' parent(s) messaged (test mode)');
        return log('absence', 'absence-' + today(), 'Notified ' + sent + ' parent(s) of today\'s absences (test mode)');
      });
    });
  }

  /* ---------- R4: low-stock alert (daily) ---------- */
  function ruleLowStock(S, ctx, logs, prior) {
    if (!S.low_stock_alerts) return Promise.resolve();
    if (prior.some(function (x) { return x.rule === 'lowstock' && x.date === today(); })) return Promise.resolve();
    return DB().all('inventoryItems').then(function (items) {
      var low = items.filter(function (i) { return Number(i.low_threshold) > 0 && Number(i.qty) <= Number(i.low_threshold); });
      if (!low.length) return;
      var names = low.slice(0, 6).map(function (i) { return i.name + ' (' + i.qty + ' ' + (i.unit || '') + ')'; }).join(', ');
      logs.push('Low stock: ' + low.length + ' item(s) flagged');
      return log('lowstock', 'lowstock-' + today(), low.length + ' item(s) at/below threshold: ' + names)
        .then(function () { return announce('Low stock alert', low.length + ' inventory item(s) need restocking: ' + names + (low.length > 6 ? '…' : '')); });
    });
  }

  /* ---------- R5: payroll-due reminder ---------- */
  function rulePayrollDue(S, ctx, logs, prior) {
    if (!S.payroll_reminder) return Promise.resolve();
    var day = new Date().getDate();
    if (day < (Number(S.payroll_reminder_day) || 25)) return Promise.resolve();
    var key = 'payroll-' + thisMonth();
    if (prior.some(function (x) { return x.rule === 'payroll' && x.key === key; })) return Promise.resolve();
    return DB().all('payrollRuns').then(function (runs) {
      var done = runs.some(function (r) { return r.month === thisMonth() && r.status === 'finalized'; });
      if (done) return;
      logs.push('Payroll reminder raised for ' + thisMonth());
      return log('payroll', key, 'Payroll for ' + thisMonth() + ' has not been finalised — reminder announced')
        .then(function () { return announce('Payroll due', 'Payroll for this month has not been run yet. Go to Payroll → Run Payroll.'); });
    });
  }

  /* ---------- R6: report-ready notifications (per class, per term) ---------- */
  function ruleReportReady(S, ctx, logs, prior) {
    if (!S.report_ready_notify) return Promise.resolve();
    var term = ctx.academic.current_term;
    return Promise.all([DB().all('students'), DB().all('scores'), DB().all('parents'), DB().all('messageTemplates')]).then(function (r) {
      var students = r[0].filter(function (s) { return s.status === 'active'; });
      var scores = r[1].filter(function (x) { return x.term === term; });
      var parents = r[2];
      var tpl = (r[3].filter(function (t) { return t.id === 'mt-report'; })[0] || {}).body ||
        'Dear {parent}, the {term} report for {student} is ready. - {school}';
      var chain = Promise.resolve();
      ctx.classes.forEach(function (klass) {
        var key = 'report-' + ctx.academic.year + '-t' + term + '-' + klass.id;
        if (prior.some(function (x) { return x.rule === 'report' && x.key === key; })) return;
        var kids = students.filter(function (s) { return s.class_id === klass.id; });
        if (!kids.length) return;
        var complete = kids.every(function (s) {
          return (klass.subjects || []).every(function (sub) {
            var sc = scores.filter(function (x) { return x.student_id === s.student_id && x.subject === sub; })[0];
            return sc && sc.class_score != null && sc.exam_score != null;
          });
        });
        if (!complete) return;
        var ops = []; var sent = 0;
        kids.forEach(function (s) {
          var pa = parents.filter(function (x) { return x.id === s.parent_id; })[0]; if (!pa || !pa.phone) return;
          sent++;
          ops.push(sendSMS(pa.phone, fill(tpl, { parent: pa.name, student: s.first_name + ' ' + s.last_name, term: App().termName(), school: ctx.school.name, balance: '', currency: '', message: '' })));
        });
        chain = chain.then(function () {
          return Promise.all(ops).then(function () {
            logs.push('Report-ready: ' + klass.name + ' — ' + sent + ' parent(s) messaged');
            return log('report', key, klass.name + ' term scores complete — notified ' + sent + ' parent(s) (test mode)');
          });
        });
      });
      return chain;
    });
  }

  /* ---------- runner ---------- */
  var ranThisBoot = false;
  function runAll(force) {
    var app = App();
    if (!app || !app.user) return Promise.resolve([]);
    if (app.user.role !== 'Admin' && app.user.role !== 'Director') return Promise.resolve([]);
    if (ranThisBoot && !force) return Promise.resolve([]);
    ranThisBoot = true;
    var logs = [];
    return getSettings().then(function (S) {
      if (!S.enabled && !force) return [];
      var ctx = app.ctx;
      return DB().all('automationLog').then(function (prior) {
        return ruleBilling(S, ctx, logs)
          .then(function () { return ruleFeeReminders(S, ctx, logs, prior); })
          .then(function () { return ruleAbsence(S, ctx, logs, prior); })
          .then(function () { return ruleLowStock(S, ctx, logs, prior); })
          .then(function () { return rulePayrollDue(S, ctx, logs, prior); })
          .then(function () { return ruleReportReady(S, ctx, logs, prior); })
          .then(function () {
            if (logs.length && global.U) U().toast('⚙ Automation: ' + logs.length + ' task(s) done — see announcements / Settings → Automation', 'ok');
            return logs;
          });
      });
    });
  }

  global.Automation = { runAll: runAll, DEFAULTS: DEFAULTS, getSettings: getSettings };
})(window);

/* ============================================================
 * reports-lib.js — shared time-filter control + range maths
 * used by Finance, Inventory and Administration reports.
 * Filters: Today · Week · Month · Term · Year · All.
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, App = global.App;
  var el = U.el;

  function startOfWeek(d) { var x = new Date(d); var day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
  function iso(d) { return new Date(d).toISOString().slice(0, 10); }

  function rangeFor(kind) {
    var now = new Date(); var t = iso(now);
    if (kind === 'day') return { label: 'Today', from: t, to: t };
    if (kind === 'week') { var s = startOfWeek(now); var e = new Date(s); e.setDate(e.getDate() + 6); return { label: 'This week', from: iso(s), to: iso(e) }; }
    if (kind === 'month') { var ms = new Date(now.getFullYear(), now.getMonth(), 1); var me = new Date(now.getFullYear(), now.getMonth() + 1, 0); return { label: 'This month', from: iso(ms), to: iso(me) }; }
    if (kind === 'year') { return { label: 'This year', from: now.getFullYear() + '-01-01', to: now.getFullYear() + '-12-31' }; }
    if (kind === 'term') {
      var ac = App.ctx.academic; var ct = ac.current_term;
      var terms = ac.terms.slice().sort(function (a, b) { return a.n - b.n; });
      var cur = terms.filter(function (x) { return x.n === ct; })[0] || terms[terms.length - 1];
      var prev = terms.filter(function (x) { return x.n === ct - 1; })[0];
      var from = prev ? prev.reopening : (cur.vacation ? (parseInt(cur.vacation.slice(0, 4), 10) - (ct === 1 ? 0 : 0)) + '-01-01' : '1970-01-01');
      return { label: cur.name, from: from || '1970-01-01', to: cur.vacation || '2999-12-31' };
    }
    return { label: 'All time', from: '1970-01-01', to: '2999-12-31' };
  }

  function timeFilter(onChange) {
    var current = rangeFor('term');
    var sel = el('select');
    [['term', 'This term'], ['day', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year'], ['all', 'All time']]
      .forEach(function (o) { sel.appendChild(el('option', { value: o[0], text: o[1] })); });
    sel.value = 'term';
    sel.addEventListener('change', function () { current = rangeFor(sel.value); onChange(current); });
    var node = el('div', { class: 'toolbar' }, [el('span', { class: 'muted', text: 'Period:' }), sel]);
    return { node: node, current: function () { return current; } };
  }

  function inRange(dateISO, range) {
    if (!dateISO) return false;
    var d = dateISO.slice(0, 10);
    return d >= range.from && d <= range.to;
  }

  global.Reports = { timeFilter: timeFilter, inRange: inRange, rangeFor: rangeFor };
})(window);

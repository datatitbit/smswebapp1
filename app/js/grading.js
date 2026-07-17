/* ============================================================
 * grading.js — scoring + grade band + position computation.
 * All cut-offs/weights come from Settings (never hard-coded).
 * ============================================================ */
(function (global) {
  'use strict';

  // Class score and exam score are each entered ALREADY scaled to their own
  // weight (e.g. class score out of 40, exam score out of 60 when weighting
  // is 40/60) — standard Ghanaian SBA convention. Total is a direct sum of
  // the two, which lands on 100 when both are entered at their max.
  function computeTotal(classScore, examScore) {
    var total = Number(classScore || 0) + Number(examScore || 0);
    return Math.round(total * 10) / 10;
  }

  function gradeFor(total, bands) {
    var t = Number(total || 0);
    for (var i = 0; i < bands.length; i++) {
      if (t >= bands[i].min && t <= bands[i].max) return bands[i];
    }
    return bands[bands.length - 1] || { grade: '-', remark: '' };
  }

  // Positions: array of {key,total}. Returns map key->ordinal (1,2,3...) honouring ties.
  function positions(items) {
    var sorted = items.slice().sort(function (a, b) { return b.total - a.total; });
    var map = {}, lastTotal = null, lastPos = 0, i = 0;
    sorted.forEach(function (it) {
      i++;
      if (it.total === lastTotal) map[it.key] = lastPos;
      else { map[it.key] = i; lastPos = i; lastTotal = it.total; }
    });
    return map;
  }

  function ordinal(n) {
    if (!n) return '—';
    var s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  global.Grading = { computeTotal: computeTotal, gradeFor: gradeFor, positions: positions, ordinal: ordinal };
})(window);

/* ============================================================
 * finance-lib.js — shared fee maths used by Finance + Reports.
 * ============================================================ */
(function (global) {
  'use strict';
  var DB = global.DB;

  // Fee types that apply to a given class (by category or 'all').
  function feesForClass(klass, feeTypes) {
    return feeTypes.filter(function (f) {
      return f.applies_to === 'all' || f.applies_to === klass.category_id;
    });
  }

  // Per-term required + optional total for a class.
  function termBillForClass(klass, feeTypes) {
    return feesForClass(klass, feeTypes)
      .filter(function (f) { return f.frequency === 'per_term'; })
      .reduce(function (sum, f) { return sum + Number(f.amount || 0); }, 0);
  }

  // Compute a student's fee position from invoices/payments.
  // arrears  = sum(invoices) - sum(payments)  (outstanding to date)
  // next     = next term's standard bill for the class
  // payable  = arrears + next
  function studentFeePosition(studentCode, klass, invoices, payments, feeTypes) {
    var billed = invoices.filter(function (i) { return i.student_id === studentCode; })
      .reduce(function (s, i) { return s + Number(i.amount || 0); }, 0);
    var paid = payments.filter(function (p) { return p.student_id === studentCode; })
      .reduce(function (s, p) { return s + Number(p.amount || 0); }, 0);
    var arrears = Math.max(0, billed - paid);
    var next = klass ? termBillForClass(klass, feeTypes) : 0;
    return { billed: billed, paid: paid, arrears: arrears, next: next, payable: arrears + next };
  }

  global.FinanceLib = {
    feesForClass: feesForClass,
    termBillForClass: termBillForClass,
    studentFeePosition: studentFeePosition
  };
})(window);

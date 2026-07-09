/* ============================================================
 * payroll-lib.js — configurable Ghana payroll engine.
 *
 * Every pay component (earning, statutory/other deduction and
 * employer contribution) is a FIELD object stored per company
 * and, where needed, overridden per employee. Nothing is hard-
 * coded — rates, PAYE bands and the SSNIT insurable ceiling are
 * all editable in Payroll → Pay Structure.
 *
 * Field shape:
 *   { key, name, type:'earning'|'deduction'|'employer_cost',
 *     kind:'amount'|'percent'|'graduated',
 *     basis:'flat'|'basic'|'gross'|'taxable',
 *     default:Number, enabled:Bool, editable:Bool,
 *     locked_on:Bool,  // toggle cannot be switched off (statutory)
 *     pre_tax:Bool,    // deduction reduces taxable pay before PAYE
 *     source:'staff'|null, // 'staff' = value comes from staff record
 *     max_pct:Number,  // optional cap (e.g. Tier 3)
 *     order:Number, custom:Bool }
 *
 * Calculation order (per GRA practice):
 *   gross      = Σ enabled earnings
 *   preTax     = Σ enabled pre-tax deductions (SSNIT/pension) on basic
 *   taxable    = max(0, gross − preTax)
 *   PAYE       = graduated tax on taxable
 *   otherDed   = Σ enabled non-pre-tax deductions (loans, dues…)
 *   NET        = gross − preTax − PAYE − otherDed
 *   employer   = separate cost ledger (not deducted from NET)
 *
 * Loads in the browser (window.PayrollLib) AND in Node (tests).
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PayrollLib = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function num(n) { return Number(n) || 0; }

  // Graduated monthly PAYE. bands = [{chunk, rate}, ..., {chunk:null, rate}]
  // chunk = band width in currency; null = "everything above".
  function computePaye(taxable, bands) {
    var left = Math.max(0, num(taxable));
    var tax = 0;
    (bands || []).forEach(function (b) {
      if (left <= 0) return;
      var slice = (b.chunk == null) ? left : Math.min(left, num(b.chunk));
      tax += slice * num(b.rate) / 100;
      left -= slice;
    });
    return round2(tax);
  }

  // Apply the SSNIT insurable-earnings ceiling to the basic used for % calcs.
  // ceiling 0 / null = no cap.
  function cappedBasic(basic, ceiling) {
    basic = Math.max(0, num(basic));
    var c = num(ceiling);
    return c > 0 ? Math.min(basic, c) : basic;
  }

  // Resolve one field to a currency amount for a given context.
  function fieldAmount(field, ctx) {
    if (!field) return 0;
    var kind = field.kind || 'amount';
    if (kind === 'graduated') return computePaye(ctx.taxable, ctx.bands);
    if (kind === 'percent') {
      var base = field.basis === 'gross' ? ctx.gross
        : field.basis === 'taxable' ? ctx.taxable
          : cappedBasic(ctx.basic, ctx.ceiling); // default basis: basic
      return round2(base * num(field.value != null ? field.value : field.default) / 100);
    }
    // amount / flat
    return round2(num(field.value != null ? field.value : field.default));
  }

  // Merge a company field with a per-employee override {enabled?, value?}.
  function effectiveField(field, override) {
    var f = Object.assign({}, field);
    if (override) {
      if (override.enabled != null) f.enabled = !!override.enabled;
      if (override.value != null && f.editable !== false) f.value = override.value;
    }
    if (f.locked_on) f.enabled = true; // statutory fields cannot be switched off
    return f;
  }

  // Pull the per-employee value for staff-sourced earnings (basic/allowances).
  function staffValue(field, staffPay) {
    if (field.key === 'basic') return num(staffPay.basic_salary);
    if (field.key === 'allowances') return num(staffPay.allowances);
    return null;
  }

  /* ------------------------------------------------------------
   * payrollLine(staffPay, config, extras)
   *   staffPay : { basic_salary, allowances, payroll_overrides:{key:{enabled,value}} }
   *   config   : company config (see defaultConfig)
   *   extras   : per-RUN entries { bonus, other, other_deductions, values:{key:amt} }
   * Returns a detailed, backward-compatible line.
   * ---------------------------------------------------------- */
  function payrollLine(staffPay, config, extras) {
    staffPay = staffPay || {}; extras = extras || {};
    config = normalizeConfig(config);
    var overrides = staffPay.payroll_overrides || {};
    var runVals = extras.values || {};
    var statutoryOn = config.apply_statutory !== false;

    var fields = config.fields.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    // ---- 1. Earnings → gross ----
    var earnings = [];
    var basic = 0, allowances = 0, bonus = 0, other = 0, gross = 0;
    fields.filter(function (f) { return f.type === 'earning'; }).forEach(function (raw) {
      var f = effectiveField(raw, overrides[raw.key]);
      // per-run quick entry for bonus/other/custom earnings
      if (runVals[f.key] != null) f.value = runVals[f.key];
      else if (f.key === 'bonus' && extras.bonus != null) f.value = extras.bonus;
      else if (f.key === 'other' && extras.other != null) f.value = extras.other;
      else if (f.source === 'staff') { var sv = staffValue(f, staffPay); if (sv != null) f.value = sv; }
      var amt = f.enabled ? fieldAmount(f, { basic: basic, gross: 0, ceiling: config.ssnit_ceiling }) : 0;
      // basic must be known before % earnings; basic itself is flat/staff so fine
      if (f.key === 'basic') basic = amt;
      if (f.key === 'allowances') allowances = amt;
      if (f.key === 'bonus') bonus = amt;
      if (f.key === 'other') other = amt;
      if (f.enabled) { gross += amt; earnings.push({ key: f.key, name: f.name, amount: amt }); }
    });
    gross = round2(gross);

    // ---- 2. Pre-tax (statutory/pension) deductions on basic ----
    var deductions = [];
    var preTax = 0;
    var payeField = null;
    fields.filter(function (f) { return f.type === 'deduction'; }).forEach(function (raw) {
      if (raw.kind === 'graduated') { payeField = raw; return; } // PAYE computed after preTax
      var f = effectiveField(raw, overrides[raw.key]);
      if (runVals[f.key] != null) f.value = runVals[f.key];
      if (!statutoryOn && f.statutory) return; // global statutory off-switch
      var amt = f.enabled ? fieldAmount(f, { basic: basic, gross: gross, ceiling: config.ssnit_ceiling }) : 0;
      if (f.enabled && f.pre_tax) { preTax += amt; }
      if (f.enabled) deductions.push({ key: f.key, name: f.name, amount: amt, pre_tax: !!f.pre_tax });
    });
    preTax = round2(preTax);

    // ---- 3. PAYE on taxable ----
    var taxable = round2(Math.max(0, gross - preTax));
    var paye = 0;
    if (payeField) {
      var pf = effectiveField(payeField, overrides[payeField.key]);
      if (statutoryOn && pf.enabled) paye = computePaye(taxable, config.paye_monthly_bands);
      deductions.push({ key: payeField.key, name: payeField.name, amount: paye, pre_tax: false, paye: true });
    }

    // ---- 4. Other (non-pre-tax) deductions total ----
    var otherDed = 0;
    var extraOtherDed = num(extras.other_deductions); // legacy quick field
    deductions.forEach(function (d) { if (!d.pre_tax && !d.paye) otherDed += d.amount; });
    otherDed = round2(otherDed + extraOtherDed);
    if (extraOtherDed) deductions.push({ key: 'adhoc_deduction', name: 'Other deduction', amount: extraOtherDed, pre_tax: false });

    // ---- 5. NET ----
    var net = round2(gross - preTax - paye - otherDed);

    // ---- 6. Employer contributions (separate ledger) ----
    var employer = [];
    var employerContrib = 0;
    if (config.employer_section_enabled !== false) {
      fields.filter(function (f) { return f.type === 'employer_cost'; }).forEach(function (raw) {
        var f = effectiveField(raw, overrides[raw.key]);
        if (runVals[f.key] != null) f.value = runVals[f.key];
        var amt = f.enabled ? fieldAmount(f, { basic: basic, gross: gross, ceiling: config.ssnit_ceiling }) : 0;
        if (f.enabled) { employerContrib += amt; employer.push({ key: f.key, name: f.name, amount: amt }); }
      });
    }
    employerContrib = round2(employerContrib);

    // Convenience keys used by payslips/history (backward compatible)
    var ssnitEmp = dedAmount(deductions, 'ssnit_t1');
    var ssnitEmployer = empAmount(employer, 'emp_ssnit_t1');

    return {
      basic: basic, allowances: allowances, bonus: bonus, other: other,
      gross: gross, earnings: earnings,
      deductions: deductions, pre_tax_deductions: preTax,
      ssnit_employee: ssnitEmp, tier2: dedAmount(deductions, 'tier2'),
      tier3: dedAmount(deductions, 'tier3'), taxable: taxable, paye: paye,
      other_deductions: otherDed, net: net,
      employer: employer, employer_contrib: employerContrib,
      ssnit_employer: ssnitEmployer,
      employer_cost: round2(gross + employerContrib)
    };
  }
  function dedAmount(list, key) { var f = list.filter(function (d) { return d.key === key; })[0]; return f ? f.amount : 0; }
  function empAmount(list, key) { var f = list.filter(function (d) { return d.key === key; })[0]; return f ? f.amount : 0; }

  /* ------------------------------------------------------------
   * Default company configuration (Ghana). Fully editable.
   * ---------------------------------------------------------- */
  function defaultFields() {
    return [
      // ---- Earnings ----
      { key: 'basic', name: 'Basic salary', type: 'earning', kind: 'amount', basis: 'flat', default: 0, enabled: true, editable: false, locked_on: true, source: 'staff', order: 1 },
      { key: 'allowances', name: 'Allowances', type: 'earning', kind: 'amount', basis: 'flat', default: 0, enabled: true, editable: true, source: 'staff', order: 2 },
      { key: 'bonus', name: 'Bonus', type: 'earning', kind: 'amount', basis: 'flat', default: 0, enabled: true, editable: true, order: 3 },
      { key: 'other', name: 'Other', type: 'earning', kind: 'amount', basis: 'flat', default: 0, enabled: true, editable: true, order: 4 },
      // ---- Statutory / employee deductions ----
      { key: 'ssnit_t1', name: 'SSNIT Tier 1 (employee)', type: 'deduction', kind: 'percent', basis: 'basic', default: 5.5, enabled: true, editable: true, locked_on: true, statutory: true, pre_tax: true, order: 5 },
      { key: 'paye', name: 'PAYE (income tax)', type: 'deduction', kind: 'graduated', basis: 'taxable', default: 0, enabled: true, editable: false, locked_on: true, statutory: true, pre_tax: false, order: 6 },
      { key: 'tier2', name: 'Tier 2 pension', type: 'deduction', kind: 'percent', basis: 'basic', default: 5, enabled: true, editable: true, pre_tax: true, order: 7 },
      { key: 'tier3', name: 'Tier 3 pension (voluntary)', type: 'deduction', kind: 'percent', basis: 'basic', default: 0, enabled: false, editable: true, pre_tax: true, max_pct: 16.5, order: 8 },
      // ---- Employer contributions ----
      { key: 'emp_ssnit_t1', name: 'SSNIT Tier 1 (employer)', type: 'employer_cost', kind: 'percent', basis: 'basic', default: 13, enabled: true, editable: true, order: 9 },
      { key: 'emp_tier2', name: 'Tier 2 (employer)', type: 'employer_cost', kind: 'percent', basis: 'basic', default: 5, enabled: true, editable: true, order: 10 }
    ];
  }

  function defaultConfig() {
    return {
      id: 'ps-1',
      version: 2,
      apply_statutory: true,
      employer_section_enabled: true,
      // SSNIT maximum insurable monthly earning. 0 = no cap.
      // GRA/SSNIT revise this yearly — enter the current ceiling here.
      ssnit_ceiling: 0,
      payment_methods: ['Bank', 'MoMo', 'Cash'],
      employee_types: ['Full-time', 'Part-time', 'Other'],
      paye_monthly_bands: [
        { chunk: 490, rate: 0 },
        { chunk: 110, rate: 5 },
        { chunk: 130, rate: 10 },
        { chunk: 3166.67, rate: 17.5 },
        { chunk: 16000, rate: 25 },
        { chunk: 30520, rate: 30 },
        { chunk: null, rate: 35 }
      ],
      fields: defaultFields(),
      note: 'Ghana defaults. SSNIT (Tier 1/2/3) is deducted before PAYE. Verify GRA PAYE bands and the SSNIT insurable ceiling each January (November Budget Statement) and edit here.'
    };
  }

  // Ghana defaults kept for the "Reset to Ghana defaults" button + legacy callers.
  function ghanaDefaults() { return defaultConfig(); }

  /* ------------------------------------------------------------
   * normalizeConfig — upgrade an old/partial settings object to v2.
   * Old shape: { apply_statutory, ssnit_employee_pct, ssnit_employer_pct,
   *              paye_monthly_bands }
   * ---------------------------------------------------------- */
  function normalizeConfig(s) {
    if (s && s.version >= 2 && Array.isArray(s.fields)) {
      // ensure required lists exist; clone so callers never alias stored data
      var c = Object.assign({}, defaultConfig(), s);
      c.fields = JSON.parse(JSON.stringify(s.fields));
      c.paye_monthly_bands = JSON.parse(JSON.stringify(s.paye_monthly_bands || defaultConfig().paye_monthly_bands));
      if (Array.isArray(s.payment_methods)) c.payment_methods = s.payment_methods.slice();
      if (Array.isArray(s.employee_types)) c.employee_types = s.employee_types.slice();
      return c;
    }
    var cfg = defaultConfig();
    if (!s) return cfg;
    if (s.apply_statutory != null) cfg.apply_statutory = s.apply_statutory !== false;
    if (Array.isArray(s.paye_monthly_bands) && s.paye_monthly_bands.length) cfg.paye_monthly_bands = s.paye_monthly_bands;
    if (s.ssnit_ceiling != null) cfg.ssnit_ceiling = s.ssnit_ceiling;
    // migrate old flat SSNIT percentages onto the new fields
    if (s.ssnit_employee_pct != null) setFieldDefault(cfg, 'ssnit_t1', num(s.ssnit_employee_pct));
    if (s.ssnit_employer_pct != null) setFieldDefault(cfg, 'emp_ssnit_t1', num(s.ssnit_employer_pct));
    if (s.id) cfg.id = s.id;
    if (s.note) cfg.note = s.note;
    return cfg;
  }
  function setFieldDefault(cfg, key, val) {
    cfg.fields.forEach(function (f) { if (f.key === key) f.default = val; });
  }

  function monthLabel(ym) {
    if (!ym || ym.length < 7) return ym || '';
    var d = new Date(ym + '-01T00:00:00');
    if (isNaN(d)) return ym;
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  }

  // Legacy helper kept for any external caller (SSNIT on capped basic).
  function computeSsnit(basic, pct) { return round2(cappedBasic(basic, 0) * num(pct) / 100); }

  return {
    computePaye: computePaye,
    computeSsnit: computeSsnit,
    fieldAmount: fieldAmount,
    payrollLine: payrollLine,
    defaultConfig: defaultConfig,
    defaultFields: defaultFields,
    ghanaDefaults: ghanaDefaults,
    normalizeConfig: normalizeConfig,
    monthLabel: monthLabel,
    round2: round2
  };
});

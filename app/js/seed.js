/* ============================================================
 * seed.js — Ghana default seed data (single source of truth)
 * Every record is tenant-aware: belongs to one top-level School.
 * Everything here is editable in Settings after first load.
 * ============================================================ */
(function (global) {
  'use strict';

  // Generated once per install and persisted separately from the main DB blob,
  // so a "Reset to Ghana defaults" doesn't change it. Every deployment of this
  // codebase previously shared the literal 'sch-1' for every school — fine for
  // one-install-per-school today, but a real collision risk if two schools'
  // data were ever merged into a shared database. Falls back to 'sch-1' only
  // if localStorage is unavailable (e.g. some automated test environments).
  var SCHOOL_ID = (function () {
    try {
      var KEY = 'sms_school_id';
      var id = window.localStorage.getItem(KEY);
      if (!id) {
        id = 'sch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
        window.localStorage.setItem(KEY, id);
      }
      return id;
    } catch (e) { return 'sch-1'; }
  })();

  // ---- Modules used by the permission matrix / sidebar ----
  var MODULES = ['Dashboard', 'Students', 'Assessment', 'Finance',
    'Attendance', 'Communication', 'Administration', 'Inventory',
    'Accounting', 'Payroll', 'Settings'];

  var ROLES = ['Admin', 'Director', 'Teacher', 'Other staff', 'Parent'];

  // Permission matrix: role -> { module: bool }. Admin always full (enforced in code too).
  // Order: Dash, Students, Assess, Finance, Attend, Comm, Admin, Invent, Accounting, Payroll, Settings
  function row(vals) {
    var o = {}; MODULES.forEach(function (m, i) { o[m] = vals[i]; }); return o;
  }
  // 'Other staff' = the Account/Finance office: stock (Inventory), payroll, fees
  // (Finance/Accounting), student & staff data. Not Assessment or Settings.
  var permissions = {
    'Admin':       row([true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  true]),
    'Director':    row([true,  true,  true,  true,  true,  true,  true,  true,  true,  true,  false]),
    'Teacher':     row([true,  true,  true,  false, true,  false, false, false, false, false, false]),
    'Other staff': row([true,  true,  false, true,  true,  true,  true,  true,  true,  true,  false]),
    'Parent':      row([true,  true,  true,  true,  true,  true,  false, false, false, false, false])
  };

  // ---- School profile ----
  var school = {
    id: SCHOOL_ID,
    name: 'Demo Basic School',                       // REQUIRED
    motto: 'Knowledge, Discipline, Service',
    address: 'P.O. Box [PLACEHOLDER], Kasoa (C/R)',
    location: '[PLACEHOLDER location / area]',
    phone: '+233 00 000 0000',
    whatsapp: '+233 00 000 0000',
    email: 'info@demobasicschool.edu.gh',
    website: 'www.demobasicschool.edu.gh',
    logo: '',                                         // PLACEHOLDER — empty => initials badge
    signature: '',                                    // head teacher signature image (data URI)
    stamp: '',                                        // school stamp image (data URI)
    currency: 'GHS',
    // Branding is OFF by default — the app, admission forms and reports keep the
    // standard Zetranova look until an admin explicitly enables it in Settings.
    theme_enabled: false,
    theme_primary: '',                                // dominant colour
    theme_secondary1: '',                             // secondary colour 1
    theme_secondary2: ''                              // secondary colour 2
  };

  // ---- Academic year & terms ----
  var academic = {
    id: 'ay-1', school_id: SCHOOL_ID,
    year: '2025/2026',
    current_term: 3,
    promotional_term: 3,
    terms: [
      { n: 1, name: 'First Term',  vacation: '2025-12-19', reopening: '2026-01-06' },
      { n: 2, name: 'Second Term', vacation: '2026-04-02', reopening: '2026-04-28' },
      { n: 3, name: 'Third Term',  vacation: '2026-07-24', reopening: '2026-09-09' }
    ]
  };

  // ---- Categories ----
  var categories = [
    { id: 'cat-pre',   school_id: SCHOOL_ID, name: 'Preschool',           sort: 1 },
    { id: 'cat-lower', school_id: SCHOOL_ID, name: 'Lower Primary',       sort: 2 },
    { id: 'cat-upper', school_id: SCHOOL_ID, name: 'Upper Primary',       sort: 3 },
    { id: 'cat-jhs',   school_id: SCHOOL_ID, name: 'Junior High School',  sort: 4 }
  ];

  // ---- Subject lists ----
  var SUBJ = {
    creche:  ['Literacy', 'Numeracy', 'Creativity', 'Picture Reading'],
    nurkg:   ['Language & Literacy', 'Writing', 'Numeracy', 'Creative Arts', 'Our World Our People'],
    lower:   ['English Language', 'Mathematics', 'Science', 'Creative Arts', 'History', 'Our World Our People', 'RME', 'Fantse'],
    upper:   ['English Language', 'Mathematics', 'Science', 'History', 'Creative Arts', 'Our World Our People', 'RME', 'Computing', 'Fantse'],
    jhs:     ['English Language', 'Mathematics', 'Science', 'Career Technology', 'Creative Art & Design', 'Our World Our People', 'RME', 'Computing', 'Fantse']
  };

  // ---- Classes (each carries subjects + report template) ----
  function cls(id, cat, name, tmpl, subjects, sort) {
    return { id: id, school_id: SCHOOL_ID, category_id: cat, name: name,
      template: tmpl, subjects: subjects.slice(), sort: sort };
  }
  var classes = [
    cls('cl-creche', 'cat-pre', 'Creche',    'A', SUBJ.creche, 1),
    cls('cl-nur1',   'cat-pre', 'Nursery 1', 'B', SUBJ.nurkg,  2),
    cls('cl-nur2',   'cat-pre', 'Nursery 2', 'B', SUBJ.nurkg,  3),
    cls('cl-kg1',    'cat-pre', 'KG 1',      'B', SUBJ.nurkg,  4),
    cls('cl-kg2',    'cat-pre', 'KG 2',      'B', SUBJ.nurkg,  5),
    cls('cl-b1', 'cat-lower', 'Basic 1', 'B', SUBJ.lower, 6),
    cls('cl-b2', 'cat-lower', 'Basic 2', 'B', SUBJ.lower, 7),
    cls('cl-b3', 'cat-lower', 'Basic 3', 'B', SUBJ.lower, 8),
    cls('cl-b4', 'cat-upper', 'Basic 4', 'B', SUBJ.upper, 9),
    cls('cl-b5', 'cat-upper', 'Basic 5', 'B', SUBJ.upper, 10),
    cls('cl-b6', 'cat-upper', 'Basic 6', 'B', SUBJ.upper, 11),
    cls('cl-b7', 'cat-jhs', 'Basic 7', 'B', SUBJ.jhs, 12),
    cls('cl-b8', 'cat-jhs', 'Basic 8', 'B', SUBJ.jhs, 13),
    cls('cl-b9', 'cat-jhs', 'Basic 9', 'B', SUBJ.jhs, 14)
  ];

  // ---- Grade bands — OPTION A default (fully editable) ----
  // Each band: proficiency level, grade code, % range, meaning (remark).
  var gradeBands = [
    { id: 'g1', school_id: SCHOOL_ID, level: 1, grade: 'A1', min: 90, max: 100, remark: 'EXCELLENT' },
    { id: 'g2', school_id: SCHOOL_ID, level: 2, grade: 'B2', min: 80, max: 89,  remark: 'VERY GOOD' },
    { id: 'g3', school_id: SCHOOL_ID, level: 3, grade: 'B3', min: 75, max: 79,  remark: 'GOOD' },
    { id: 'g4', school_id: SCHOOL_ID, level: 4, grade: 'C4', min: 70, max: 74,  remark: 'FAIRLY GOOD' },
    { id: 'g5', school_id: SCHOOL_ID, level: 5, grade: 'C5', min: 65, max: 69,  remark: 'AVERAGE' },
    { id: 'g6', school_id: SCHOOL_ID, level: 6, grade: 'D6', min: 60, max: 64,  remark: 'BELOW AVERAGE' },
    { id: 'g7', school_id: SCHOOL_ID, level: 7, grade: 'D7', min: 55, max: 59,  remark: 'CREDIT' },
    { id: 'g8', school_id: SCHOOL_ID, level: 8, grade: 'E8', min: 50, max: 54,  remark: 'PASS' },
    { id: 'g9', school_id: SCHOOL_ID, level: 9, grade: 'E9', min: 0,  max: 49,  remark: 'BEGINNING' }
  ];

  // ---- Fee types ----
  function fee(id, name, amount, applies, freq, req) {
    return { id: id, school_id: SCHOOL_ID, name: name, amount: amount,
      applies_to: applies, frequency: freq, required: req };
  }
  var feeTypes = [
    fee('fe-tui',  'Tuition',         600, 'all', 'per_term', true),
    fee('fe-pta',  'PTA Dues',         30, 'all', 'per_term', true),
    fee('fe-exam', 'Examination Fee',  50, 'all', 'per_term', true),
    fee('fe-ict',  'ICT Fee',          40, 'all', 'per_term', false),
    fee('fe-feed', 'Feeding',         300, 'all', 'per_term', false)
  ];

  // ---- Inventory categories ----
  var inventoryCategories = ['Stationery', 'Textbooks', 'Uniforms', 'ICT Equipment', 'Furniture',
    'Cleaning Supplies', 'Sports Equipment', 'First Aid', 'Office Supplies', 'Science Lab'].map(function (n, i) {
    return { id: 'inc-' + i, school_id: SCHOOL_ID, name: n };
  });

  // ---- Accounting categories (editable in Accounting → Categories) ----
  var expenseCategories = ['Salaries & Wages', 'Utilities (ECG/Water)', 'Rent',
    'Teaching & Learning Materials', 'Repairs & Maintenance', 'Transport & Fuel',
    'Feeding / Canteen', 'Printing & Stationery', 'Marketing', 'Levies & Licences',
    'Miscellaneous'].map(function (n, i) {
    return { id: 'exc-' + i, school_id: SCHOOL_ID, name: n };
  });
  var incomeCategories = ['Donations', 'Uniform Sales', 'Canteen Sales', 'Bus Fees',
    'Facility Rental', 'Miscellaneous'].map(function (n, i) {
    return { id: 'ino-' + i, school_id: SCHOOL_ID, name: n };
  });

  // ---- Payroll statutory settings (Ghana 2026 defaults; editable, resettable) ----
  // SSNIT: employee 5.5% / employer 13% of BASIC salary.
  // PAYE monthly graduated bands per GRA 2026: chunk = band width; null = everything above.
  // ---- Automation defaults (Settings → Automation) ----
  var automation = {
    id: 'auto-1', school_id: SCHOOL_ID,
    enabled: true,
    auto_billing: true,
    fee_reminders: true, fee_reminder_days: 7,
    absence_notify: true,
    low_stock_alerts: true,
    payroll_reminder: true, payroll_reminder_day: 25,
    report_ready_notify: false
  };

  // Configurable payroll: every earning / deduction / employer cost is a
  // togglable field with an editable default. SSNIT is deducted before PAYE.
  // (payroll-lib.js normalizes/upgrades this object; keep shape in sync.)
  var payrollSettings = {
    id: 'ps-1', school_id: SCHOOL_ID,
    version: 2,
    apply_statutory: true,
    employer_section_enabled: true,
    ssnit_ceiling: 0,                 // 0 = no cap; enter current SSNIT insurable ceiling
    payment_methods: ['Bank', 'MoMo', 'Cash'],
    employee_types: ['Full-time', 'Part-time', 'Other'],
    paye_monthly_bands: [
      { chunk: 490,     rate: 0 },
      { chunk: 110,     rate: 5 },
      { chunk: 130,     rate: 10 },
      { chunk: 3166.67, rate: 17.5 },
      { chunk: 16000,   rate: 25 },
      { chunk: 30520,   rate: 30 },
      { chunk: null,    rate: 35 }
    ],
    fields: [
      { key: 'basic',       name: 'Basic salary',              type: 'earning',       kind: 'amount',    basis: 'flat',    default: 0,    enabled: true,  editable: false, locked_on: true, source: 'staff', order: 1 },
      { key: 'allowances',  name: 'Allowances',                type: 'earning',       kind: 'amount',    basis: 'flat',    default: 0,    enabled: true,  editable: true,  source: 'staff', order: 2 },
      { key: 'bonus',       name: 'Bonus',                     type: 'earning',       kind: 'amount',    basis: 'flat',    default: 0,    enabled: true,  editable: true,  order: 3 },
      { key: 'other',       name: 'Other',                     type: 'earning',       kind: 'amount',    basis: 'flat',    default: 0,    enabled: true,  editable: true,  order: 4 },
      { key: 'ssnit_t1',    name: 'SSNIT Tier 1 (employee)',   type: 'deduction',     kind: 'percent',   basis: 'basic',   default: 5.5,  enabled: true,  editable: true,  locked_on: true, statutory: true, pre_tax: true, order: 5 },
      { key: 'paye',        name: 'PAYE (income tax)',         type: 'deduction',     kind: 'graduated', basis: 'taxable', default: 0,    enabled: true,  editable: false, locked_on: true, statutory: true, pre_tax: false, order: 6 },
      { key: 'tier2',       name: 'Tier 2 pension',            type: 'deduction',     kind: 'percent',   basis: 'basic',   default: 5,    enabled: true,  editable: true,  pre_tax: true, order: 7 },
      { key: 'tier3',       name: 'Tier 3 pension (voluntary)',type: 'deduction',     kind: 'percent',   basis: 'basic',   default: 0,    enabled: false, editable: true,  pre_tax: true, max_pct: 16.5, order: 8 },
      { key: 'emp_ssnit_t1',name: 'SSNIT Tier 1 (employer)',   type: 'employer_cost', kind: 'percent',   basis: 'basic',   default: 13,   enabled: true,  editable: true,  order: 9 },
      { key: 'emp_tier2',   name: 'Tier 2 (employer)',         type: 'employer_cost', kind: 'percent',   basis: 'basic',   default: 5,    enabled: true,  editable: true,  order: 10 }
    ],
    note: 'Ghana defaults. SSNIT (Tier 1/2/3) is deducted before PAYE. Verify GRA PAYE bands and the SSNIT insurable ceiling each January and edit in Payroll → Pay Structure.'
  };

  // ---- Inventory feature toggles + configuration lists ----
  var inventorySettings = {
    id: 'inv-1', school_id: SCHOOL_ID,
    toggles: { supplierDetails: false, batchTracking: false, multiCampus: false, auditSnapshot: false },
    storeLocations: ['Main Admin Store', 'Bookshop'],
    reasonCodes: ['New Supply / Restock', 'Damaged / Torn', 'Classroom Allocation', 'Physical Count Discrepancy', 'Theft / Loss', 'Student Sale', 'Staff Issue'],
    paymentStatuses: ['Cash/MoMo Paid', 'Billed to School Fees Ledger', 'Not Applicable (Staff Internal Use)'],
    branches: ['Main Campus']
  };

  // ---- Sample inventory items (Item Master) + stock rows (Stock Levels) ----
  var inventoryItems = [
    { id: 'itm-1', school_id: SCHOOL_ID, sku: 'UNI-BRN-14', name: 'Brown Uniform - Size 14', inventory_type: 'resale', category: 'Uniforms', target_class: 'cl-b1', cost_price: 45, selling_price: 70, unit_cost: 45, unit: 'set', low_threshold: 10, qty: 40, supplier: { name: '', contact: '', location: '' }, archived: false },
    { id: 'itm-2', school_id: SCHOOL_ID, sku: 'BK-MAT-B9', name: 'Mathematics Textbook - Basic 9', inventory_type: 'resale', category: 'Textbooks', target_class: 'cl-b9', cost_price: 30, selling_price: 45, unit_cost: 30, unit: 'copy', low_threshold: 15, qty: 60, supplier: { name: '', contact: '', location: '' }, archived: false },
    { id: 'itm-3', school_id: SCHOOL_ID, sku: 'ICT-LAP-01', name: 'ICT Lab Laptop', inventory_type: 'asset', category: 'ICT Equipment', target_class: '', cost_price: 4500, selling_price: 0, unit_cost: 4500, unit: 'unit', low_threshold: 2, qty: 12, supplier: { name: '', contact: '', location: '' }, archived: false }
  ];
  var inventoryStock = [
    { id: 'stk-1', school_id: SCHOOL_ID, item_id: 'itm-1', item_name: 'Brown Uniform - Size 14', location: 'Bookshop', qoh: 40, allocated: 5, reorder_level: 10, batch: {}, archived: false },
    { id: 'stk-2', school_id: SCHOOL_ID, item_id: 'itm-2', item_name: 'Mathematics Textbook - Basic 9', location: 'Bookshop', qoh: 60, allocated: 0, reorder_level: 15, batch: {}, archived: false },
    { id: 'stk-3', school_id: SCHOOL_ID, item_id: 'itm-3', item_name: 'ICT Lab Laptop', location: 'Main Admin Store', qoh: 12, allocated: 0, reorder_level: 2, batch: {}, archived: false }
  ];

  // ---- Report templates (blocks/fields toggleable & renamable) ----
  var checklistDomains = [
    { name: 'Health & Physical Development', indicators: [
      'Shows good physical coordination',
      'Eats tidily and independently',
      'Washes and cleans hands after toilet, meals etc.' ] },
    { name: 'Emotional & Social Development', indicators: [
      'Is active and enjoys outdoor activities',
      'Remains cheerful and sociable',
      'Takes part in all class activities' ] },
    { name: 'Cognitive & Language Development', indicators: [
      'Can identify simple colours and shapes',
      'Follows activity to the conclusion',
      'Can recite rhymes',
      'Understands and uses simple words, sentences and gestures',
      'Can count from 1 to 10',
      'Can sort items and scribble simple lines' ] }
  ];

  // ---- Default editable remark option sets (Template B) ----
  var REMARK_DEFAULTS = {
    conduct:  { show: true, label: 'Conduct', options: ['SATISFACTORY', 'EXCELLENT', 'FAIRLY GOOD', 'GENERALLY ACTIVE', 'ENERGETIC', 'UNPREDICTABLE'] },
    attitude: { show: true, label: 'Attitude', options: ['CALM', 'ADVENTUROUS', 'SOCIABLE', 'RESERVED', 'WELL BEHAVED', 'DISCIPLINED'] },
    interest: { show: true, label: 'Interest', options: ['READING/ENGLISH', 'MATHEMATICS', 'SCIENCE', 'SPORTS/GAMES', 'MUSIC/DANCE', 'MAKING ARTWORK', 'COMPUTING', 'MULTI-TALENTED', 'INDOOR ACTIVITIES', 'OUTDOOR ACTIVITIES'] },
    overall:  { show: true, label: 'Overall Remark', options: ['EXCEEDS EXPECTATIONS', 'MEETS EXPECTATIONS', 'APPROACHING EXPECTATIONS', 'NEEDS IMPROVEMENT', 'BELOW EXPECTATIONS'] }
  };

  var reportTemplates = [
    {
      id: 'A', school_id: SCHOOL_ID, kind: 'A', name: 'Template A (Creche)',
      blocks: { checklist: true, scoresTable: true, conduct: false, feesBlock: true },
      checklistDomains: checklistDomains,
      labels: {
        classScore: 'Class Score %', examScore: 'Exam Score %',
        total: 'Total %', remarks: 'Remarks'
      },
      keysLegend: 'KEYS: YES = Yes   PAR = Partially / Sometimes   NES = Needs effort / Special attention',
      footer: 'Any erasure on this report invalidates it.'
    },
    {
      id: 'B', school_id: SCHOOL_ID, kind: 'B', name: 'Template B (Standard)',
      blocks: { checklist: false, scoresTable: true, conduct: true, feesBlock: true },
      fields: {  // each: { show, label }
        grade:            { show: true, label: 'Grade' },
        positionInSubject:{ show: true, label: 'Position in Subject' },
        overallPosition:  { show: true, label: 'Position' },
        remarks:          { show: true, label: 'Remarks' }
      },
      // Selectable, editable remark sets (rename / add / remove / reset in Settings)
      remarkFields: JSON.parse(JSON.stringify(REMARK_DEFAULTS)),
      // Free-text remark lines
      freeRemarks: {
        teacher: { show: true, label: "Class Teacher's Remark" },
        head:    { show: true, label: "Head Teacher's Signature / Stamp" }
      },
      keysLegend: '',
      footer: 'Any erasure on this report invalidates it.'
    }
  ];

  // ---- Identity / ID rules ----
  var idRules = {
    id: 'idr-1', school_id: SCHOOL_ID,
    student_prefix: 'ST', staff_prefix: 'SF', digits: 4,
    auto_generate: true, allow_manual: false
  };

  // ---- Admission / "Admit student" form fields ----
  // "system: true" = a core field the rest of the app relies on (student table,
  // bulk upload, promotion, reports): admin may rename its label and toggle
  // required, but cannot delete it or change its key/type. Everything else is
  // a fully admin-managed custom field (add/edit/delete/reorder-by-section),
  // stored per student under student.extra[key]. Modeled on a real Ghanaian
  // school admission form (siblings, health needs, guardian & office-use details).
  var admissionFields = [
    { key: 'first_name',  label: 'First name',            type: 'text',   required: true,  section: 'personal', system: true },
    { key: 'last_name',   label: 'Last name',              type: 'text',   required: true,  section: 'personal', system: true },
    { key: 'gender',      label: 'Gender',                 type: 'select', required: false, section: 'personal', system: true },
    { key: 'dob',         label: 'Date of birth',          type: 'date',   required: false, section: 'personal', system: true },
    { key: 'class_id',    label: 'Class',                  type: 'select', required: false, section: 'personal', system: true },
    { key: 'parent_id',   label: 'Parent / Guardian',      type: 'select', required: false, section: 'guardian', system: true },
    { key: 'status',      label: 'Status',                 type: 'select', required: false, section: 'office',   system: true },
    { key: 'admitted_on', label: 'Admitted on',            type: 'date',   required: false, section: 'office',   system: true },

    { key: 'nationality',           label: 'Nationality',                       type: 'text',     required: true,  section: 'personal', system: false },
    { key: 'place_of_birth',        label: 'Place of birth',                    type: 'text',     required: false, section: 'personal', system: false },
    { key: 'mother_tongue',         label: 'Mother tongue',                     type: 'text',     required: false, section: 'personal', system: false },
    { key: 'religion',              label: 'Religion',                          type: 'text',     required: false, section: 'personal', system: false },
    { key: 'other_languages',       label: 'Other languages spoken',            type: 'text',     required: false, section: 'personal', system: false },
    { key: 'residence_location',    label: 'Location (current residence)',      type: 'text',     required: false, section: 'personal', system: false },
    { key: 'previous_school',       label: 'Previous school attended (if any)', type: 'text',     required: false, section: 'personal', system: false },
    { key: 'previous_school_place', label: 'Previous school — place',           type: 'text',     required: false, section: 'personal', system: false },
    { key: 'previous_class',        label: 'Previous school — class',           type: 'text',     required: false, section: 'personal', system: false },
    { key: 'previous_school_year',  label: 'Previous school — year',            type: 'text',     required: false, section: 'personal', system: false },
    { key: 'siblings',              label: 'Siblings in this school',           type: 'siblings', required: false, section: 'personal', system: false,
      help: 'Add each sibling already enrolled here, with their class.' },

    { key: 'special_educational_need', label: 'Special educational need (if any)', type: 'text', required: false, section: 'health', system: false, help: 'Leave blank if none.' },
    { key: 'special_medical_need',     label: 'Special medical need (if any)',     type: 'text', required: false, section: 'health', system: false, help: 'Leave blank if none.' },
    { key: 'food_allergies',           label: 'Food allergies (if any)',           type: 'text', required: false, section: 'health', system: false, help: 'Leave blank if none.' },

    { key: 'guardian_age',          label: 'Parent/Guardian age',                type: 'number', required: false, section: 'guardian', system: false },
    { key: 'guardian_relationship', label: 'Relationship to student',            type: 'select', required: true,  section: 'guardian', system: false, options: ['Father', 'Mother', 'Other'] },
    { key: 'guardian_address',      label: 'Residential address (location)',     type: 'text',    required: true,  section: 'guardian', system: false },
    { key: 'guardian_alt_phone',    label: 'Alternative phone (when not reachable)', type: 'text', required: false, section: 'guardian', system: false },
    { key: 'guardian_languages',    label: 'Languages spoken (optional)',        type: 'text',    required: false, section: 'guardian', system: false },
    { key: 'guardian_profession',   label: 'Profession / Occupation',            type: 'text',    required: false, section: 'guardian', system: false },
    { key: 'how_heard',             label: 'How did you hear about this school?', type: 'select', required: true, section: 'guardian', system: false, options: ['Word of mouth / Referral', 'Social media / advert', 'Poster / Banner', 'School campaign', 'Other'] },

    { key: 'declaration_ack',  label: "Parent/Guardian undertakes to take an active interest in the child's education, pay fees, and cooperate with the school", type: 'checkbox', required: true, section: 'declaration', system: false, inProfile: false },
    { key: 'declaration_date', label: 'Declaration date',      type: 'date', required: false, section: 'declaration', system: false, inProfile: false },

    { key: 'assessment_english',   label: 'Admission assessment — English', type: 'number',   required: false, section: 'office', system: false, inProfile: false },
    { key: 'assessment_math',      label: 'Admission assessment — Math',    type: 'number',   required: false, section: 'office', system: false, inProfile: false },
    { key: 'assessment_other',     label: 'Admission assessment — Other',   type: 'text',      required: false, section: 'office', system: false, inProfile: false },
    { key: 'office_remarks',       label: 'Remarks (office use)',           type: 'textarea',  required: false, section: 'office', system: false, inProfile: false },
    { key: 'admission_fee_paid',   label: 'Admission fee paid',             type: 'number',    required: false, section: 'office', system: false, inProfile: false }
  ];
  // "inProfile: false" = excluded by default from the printable "Download student profile"
  // sheet (Students → Download student profile). Unset/true = included. Admin toggles this
  // per field in Settings → Admission Form.

  // ---- Score weighting ----
  var weighting = { id: 'w-1', school_id: SCHOOL_ID, class_pct: 50, exam_pct: 50 };

  // ---- Editable report/fees labels & message templates ----
  var labels = {
    id: 'lab-1', school_id: SCHOOL_ID,
    fees_arrears: 'School Fees Arrears',
    fees_next: "Next Term's School Fees",
    fees_payable: 'Total Payable',
    roll: 'Number on Roll',
    attendance: 'Attendance',
    out_of: 'Out of'
  };

  var messageTemplates = [
    { id: 'mt-fee',    school_id: SCHOOL_ID, name: 'Fee Reminder',
      body: 'Dear {parent}, this is a reminder that {student} has an outstanding balance of {currency}{balance} for {term}. Thank you. - {school}' },
    { id: 'mt-report', school_id: SCHOOL_ID, name: 'Report Ready',
      body: 'Dear {parent}, the {term} report for {student} is ready. Please visit the school. - {school}' },
    { id: 'mt-announce', school_id: SCHOOL_ID, name: 'General Announcement',
      body: 'Dear {parent}, {message} - {school}' }
  ];

  // ---- Default users (one per role) for demo login ----
  // Passwords are PBKDF2-SHA256 hashed (see auth-lib.js), never stored in plaintext.
  // DEMO PASSWORDS (change at go-live — see README "Placeholders"):
  //   admin/admin123, director/director123, teacher/teacher123, staff/staff123, parent/parent123
  var users = [
    { id: 'u-admin',   school_id: SCHOOL_ID, name: 'School Administrator', username: 'admin',    role: 'Admin',       staff_id: 'SF0001', linked_student_ids: [],
      password_salt: 'bdd6096a9cccf365986520af2c6c38cd', password_hash: '5e53a758512b9074082dfd890884eba14d56061b728d130ef2a23eb1e3ecb764', must_change_password: true },
    { id: 'u-dir',     school_id: SCHOOL_ID, name: 'The Director',          username: 'director', role: 'Director',    staff_id: 'SF0002', linked_student_ids: [],
      password_salt: '7ff64936b8ce0f27cbdeed5a5cc765d4', password_hash: '84fe3ec4a95b5e494b3948ee202fa54fbfeab91ba4e9c18d6ab7a84f6c74719c', must_change_password: true },
    { id: 'u-teacher', school_id: SCHOOL_ID, name: 'Class Teacher',         username: 'teacher',  role: 'Teacher',     staff_id: 'SF0003', class_ids: ['cl-b1'], linked_student_ids: [],
      password_salt: '04676b70f2981d9df4f2d798b15da396', password_hash: 'c7ec5397a81a36e91c3ec1133215f98381e1c46b0cca0868906f80f7be4587da', must_change_password: true },
    { id: 'u-staff',   school_id: SCHOOL_ID, name: 'Front Desk',            username: 'staff',    role: 'Other staff', staff_id: 'SF0004', linked_student_ids: [],
      password_salt: 'a4e321aa36c33a28e0c94c9b8cdf62cf', password_hash: '119570daabe181e0cfbebf03cc76afcccc5d6bf1721b7b1d8902102ed146b019', must_change_password: true },
    { id: 'u-parent',  school_id: SCHOOL_ID, name: 'A Parent',              username: 'parent',   role: 'Parent',      linked_student_ids: ['ST0001'],
      password_salt: 'bd118eecf734755b7e7691fc18b52c14', password_hash: 'ba3af436dd8f9363645143b03709483a4ea07da9b6b7fe7c43cb541617ece706', must_change_password: true }
  ];

  // ---- Staff records ----
  // basic_salary / allowances are DEMO figures — set real pay in Payroll → Staff Pay Setup.
  var staff = [
    { id: 'st-1', school_id: SCHOOL_ID, staff_id: 'SF0001', name: 'School Administrator', role: 'Admin',       phone: '+233 00 000 0001', class_ids: [], basic_salary: 2500, allowances: 300, employee_type: 'Full-time', payment_method: 'Bank', payroll_overrides: {} },
    { id: 'st-2', school_id: SCHOOL_ID, staff_id: 'SF0002', name: 'The Director',          role: 'Director',    phone: '+233 00 000 0002', class_ids: [], basic_salary: 4000, allowances: 500, employee_type: 'Full-time', payment_method: 'Bank', payroll_overrides: {} },
    { id: 'st-3', school_id: SCHOOL_ID, staff_id: 'SF0003', name: 'Class Teacher',         role: 'Teacher',     phone: '+233 00 000 0003', class_ids: ['cl-b1'], basic_salary: 1800, allowances: 200, employee_type: 'Full-time', payment_method: 'MoMo', payroll_overrides: {} },
    { id: 'st-4', school_id: SCHOOL_ID, staff_id: 'SF0004', name: 'Front Desk',            role: 'Other staff', phone: '+233 00 000 0004', class_ids: [], basic_salary: 1200, allowances: 100, employee_type: 'Part-time', payment_method: 'Cash', payroll_overrides: {} }
  ];

  // ---- Sample parents & students (demo data) ----
  var parents = [
    { id: 'pa-1', school_id: SCHOOL_ID, name: 'Kwame Mensah', phone: '+233 24 111 1111', whatsapp: '+233 24 111 1111', email: 'kmensah@example.com', student_ids: ['ST0001', 'ST0002'] },
    { id: 'pa-2', school_id: SCHOOL_ID, name: 'Ama Owusu',    phone: '+233 24 222 2222', whatsapp: '+233 24 222 2222', email: 'aowusu@example.com',  student_ids: ['ST0003'] },
    { id: 'pa-3', school_id: SCHOOL_ID, name: 'Yaw Boateng',  phone: '+233 24 333 3333', whatsapp: '+233 24 333 3333', email: '',                    student_ids: ['ST0004'] }
  ];

  function stu(code, first, last, cls, gender, parent) {
    return { id: 'stu-' + code, school_id: SCHOOL_ID, student_id: code,
      first_name: first, last_name: last, class_id: cls, gender: gender,
      dob: '', parent_id: parent, status: 'active',
      admitted_on: '2025-09-09' };
  }
  var students = [
    stu('ST0001', 'Adwoa',  'Mensah',  'cl-b1', 'F', 'pa-1'),
    stu('ST0002', 'Kojo',   'Mensah',  'cl-b1', 'M', 'pa-1'),
    stu('ST0003', 'Efua',   'Owusu',   'cl-b1', 'F', 'pa-2'),
    stu('ST0004', 'Kofi',   'Boateng', 'cl-creche', 'M', 'pa-3'),
    stu('ST0005', 'Akosua', 'Asante',  'cl-b1', 'F', null)
  ];

  var SEED = {
    school: school,
    academic: academic,
    categories: categories,
    classes: classes,
    gradeBands: gradeBands,
    feeTypes: feeTypes,
    inventoryCategories: inventoryCategories,
    inventorySettings: inventorySettings,
    expenseCategories: expenseCategories,
    incomeCategories: incomeCategories,
    payrollSettings: payrollSettings,
    automation: automation,
    reportTemplates: reportTemplates,
    idRules: idRules,
    admissionFields: admissionFields,
    weighting: weighting,
    labels: labels,
    messageTemplates: messageTemplates,
    permissions: permissions,
    users: users,
    staff: staff,
    parents: parents,
    students: students,
    // empty transactional collections
    scores: [],
    attendance: [],
    staffAttendance: [],
    studentRemarks: [],
    conduct: [],
    invoices: [],
    payments: [],
    inventoryItems: inventoryItems,
    stockMovements: [],
    inventoryStock: inventoryStock,
    inventoryTransactions: [],
    inventoryAudit: [],
    announcements: [],
    messages: [],
    expenses: [],
    otherIncome: [],
    payrollRuns: [],
    automationLog: [],
    meta: { seq: { student: 5, staff: 4, invtxn: 0 } },
    constants: { MODULES: MODULES, ROLES: ROLES, SCHOOL_ID: SCHOOL_ID }
  };

  global.SMS_SEED = SEED;
})(window);

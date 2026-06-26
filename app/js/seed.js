/* ============================================================
 * seed.js — Ghana default seed data (single source of truth)
 * Every record is tenant-aware: belongs to one top-level School.
 * Everything here is editable in Settings after first load.
 * ============================================================ */
(function (global) {
  'use strict';

  var SCHOOL_ID = 'sch-1';

  // ---- Modules used by the permission matrix / sidebar ----
  var MODULES = ['Dashboard', 'Students', 'Assessment', 'Finance',
    'Attendance', 'Communication', 'Administration', 'Inventory', 'Settings'];

  var ROLES = ['Admin', 'Director', 'Teacher', 'Other staff', 'Parent'];

  // Permission matrix: role -> { module: bool }. Admin always full (enforced in code too).
  function row(vals) {
    var o = {}; MODULES.forEach(function (m, i) { o[m] = vals[i]; }); return o;
  }
  var permissions = {
    'Admin':       row([true,  true,  true,  true,  true,  true,  true,  true,  true]),
    'Director':    row([true,  true,  true,  true,  true,  true,  true,  true,  false]),
    'Teacher':     row([true,  true,  true,  false, true,  false, false, false, false]),
    'Other staff': row([true,  true,  false, false, true,  true,  false, true,  false]),
    'Parent':      row([true,  true,  true,  true,  true,  true,  false, false, false])
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
    currency: 'GHS'
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
  var inventoryCategories = ['Stationery', 'Textbooks', 'ICT Equipment', 'Furniture',
    'Cleaning Supplies', 'Sports Equipment', 'First Aid'].map(function (n, i) {
    return { id: 'inc-' + i, school_id: SCHOOL_ID, name: n };
  });

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
  var users = [
    { id: 'u-admin',   school_id: SCHOOL_ID, name: 'School Administrator', username: 'admin',    role: 'Admin',       staff_id: 'SF0001', linked_student_ids: [] },
    { id: 'u-dir',     school_id: SCHOOL_ID, name: 'The Director',          username: 'director', role: 'Director',    staff_id: 'SF0002', linked_student_ids: [] },
    { id: 'u-teacher', school_id: SCHOOL_ID, name: 'Class Teacher',         username: 'teacher',  role: 'Teacher',     staff_id: 'SF0003', class_ids: ['cl-b1'], linked_student_ids: [] },
    { id: 'u-staff',   school_id: SCHOOL_ID, name: 'Front Desk',            username: 'staff',    role: 'Other staff', staff_id: 'SF0004', linked_student_ids: [] },
    { id: 'u-parent',  school_id: SCHOOL_ID, name: 'A Parent',              username: 'parent',   role: 'Parent',      linked_student_ids: ['ST0001'] }
  ];

  // ---- Staff records ----
  var staff = [
    { id: 'st-1', school_id: SCHOOL_ID, staff_id: 'SF0001', name: 'School Administrator', role: 'Admin',       phone: '+233 00 000 0001', class_ids: [] },
    { id: 'st-2', school_id: SCHOOL_ID, staff_id: 'SF0002', name: 'The Director',          role: 'Director',    phone: '+233 00 000 0002', class_ids: [] },
    { id: 'st-3', school_id: SCHOOL_ID, staff_id: 'SF0003', name: 'Class Teacher',         role: 'Teacher',     phone: '+233 00 000 0003', class_ids: ['cl-b1'] },
    { id: 'st-4', school_id: SCHOOL_ID, staff_id: 'SF0004', name: 'Front Desk',            role: 'Other staff', phone: '+233 00 000 0004', class_ids: [] }
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
    reportTemplates: reportTemplates,
    idRules: idRules,
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
    inventoryItems: [],
    stockMovements: [],
    announcements: [],
    messages: [],
    meta: { seq: { student: 5, staff: 4 } },
    constants: { MODULES: MODULES, ROLES: ROLES, SCHOOL_ID: SCHOOL_ID }
  };

  global.SMS_SEED = SEED;
})(window);

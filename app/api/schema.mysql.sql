-- ============================================================
-- schema.mysql.sql — MySQL schema for cPanel deployment.
--
-- PART A: operational tables used by the live REST API.
--         (The single-page app talks to these via api/index.php.
--          They are auto-created on first run; this file lets a
--          DBA create them manually if preferred.)
-- PART B: normalised relational reference schema that mirrors the
--         data model in the brief (section 20), tenant-aware.
--         Provided for schools/DBAs and future server-side modules.
-- Charset utf8mb4 throughout. One install = one school.
-- ============================================================
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------- PART A: operational document store ----------
CREATE TABLE IF NOT EXISTS documents (
  id         VARCHAR(80)  NOT NULL,
  collection VARCHAR(60)  NOT NULL,
  school_id  VARCHAR(40)  NULL,
  data       LONGTEXT     NULL,
  PRIMARY KEY (collection, id),
  KEY idx_school (school_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS singletons (
  name VARCHAR(60) PRIMARY KEY,
  data LONGTEXT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS meta_seq (
  kind VARCHAR(40) PRIMARY KEY,
  val  INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- PART B: normalised relational reference model ----------
CREATE TABLE IF NOT EXISTS schools (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  motto VARCHAR(200), address VARCHAR(200), location VARCHAR(160),
  phone VARCHAR(60), whatsapp VARCHAR(60), email VARCHAR(120),
  website VARCHAR(120), logo TEXT, currency VARCHAR(8) DEFAULT 'GHS'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS academic_years (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL,
  year VARCHAR(20) NOT NULL, current_term INT DEFAULT 1, promotional_term INT DEFAULT 3,
  FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS terms (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, year_id VARCHAR(40) NOT NULL,
  n INT NOT NULL, name VARCHAR(40), vacation DATE NULL, reopening DATE NULL,
  FOREIGN KEY (year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, name VARCHAR(80) NOT NULL, sort INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS report_templates (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, kind CHAR(1) NOT NULL,
  name VARCHAR(80), config LONGTEXT  -- blocks/fields/labels as JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS classes (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, category_id VARCHAR(40),
  name VARCHAR(80) NOT NULL, template CHAR(1) DEFAULT 'B', sort INT DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subjects (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, class_id VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL, sort INT DEFAULT 0,
  FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS parents (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, name VARCHAR(140) NOT NULL,
  phone VARCHAR(60), whatsapp VARCHAR(60), email VARCHAR(120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS students (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  first_name VARCHAR(80), last_name VARCHAR(80), gender CHAR(1), dob DATE NULL,
  class_id VARCHAR(40), parent_id VARCHAR(40) NULL, status VARCHAR(16) DEFAULT 'active',
  admitted_on DATE NULL, promoted_to VARCHAR(80) NULL,
  UNIQUE KEY uniq_code (school_id, student_id),
  FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS parent_student (
  parent_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  PRIMARY KEY (parent_id, student_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS staff (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, staff_id VARCHAR(12) NOT NULL,
  name VARCHAR(140), role VARCHAR(40), phone VARCHAR(60),
  UNIQUE KEY uniq_staff (school_id, staff_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS staff_classes (
  staff_id VARCHAR(40) NOT NULL, class_id VARCHAR(40) NOT NULL,
  PRIMARY KEY (staff_id, class_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, name VARCHAR(140),
  username VARCHAR(60), password_hash VARCHAR(255) NULL, role VARCHAR(40), staff_id VARCHAR(12) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS grade_bands (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL,
  grade VARCHAR(8), min_pct INT, max_pct INT, remark VARCHAR(60)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS scores (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  class_id VARCHAR(40), subject VARCHAR(120), term INT, class_score DECIMAL(5,2) NULL, exam_score DECIMAL(5,2) NULL,
  KEY idx_lookup (class_id, term, subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fee_types (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, name VARCHAR(120),
  amount DECIMAL(10,2), applies_to VARCHAR(40) DEFAULT 'all', frequency VARCHAR(16) DEFAULT 'per_term', required TINYINT(1) DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS invoices (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  class_id VARCHAR(40), term INT, fee_type_id VARCHAR(40), fee_name VARCHAR(120), amount DECIMAL(10,2), created_on DATE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payments (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  term INT, amount DECIMAL(10,2), method VARCHAR(30), reference VARCHAR(60), gateway_ref VARCHAR(80) NULL,
  receipt_no VARCHAR(60), created_on DATE, created_by VARCHAR(120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS attendance (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  class_id VARCHAR(40), adate DATE, status VARCHAR(10),
  KEY idx_class_date (class_id, adate)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conduct (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  class_id VARCHAR(40), cdate DATE, note TEXT, created_by VARCHAR(120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS checklists (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, student_id VARCHAR(12) NOT NULL,
  class_id VARCHAR(40), term INT, marks LONGTEXT  -- indicator->rating JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_categories (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, name VARCHAR(80)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_items (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, name VARCHAR(120),
  category VARCHAR(80), qty INT DEFAULT 0, unit VARCHAR(30), unit_cost DECIMAL(10,2) NULL, low_threshold INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS stock_movements (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, item_id VARCHAR(40),
  item_name VARCHAR(120), type VARCHAR(4), qty INT, note VARCHAR(200), mdate DATE, created_by VARCHAR(120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS announcements (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, title VARCHAR(160), body TEXT, created_at DATETIME, created_by VARCHAR(120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, recipient VARCHAR(60), body TEXT,
  channel VARCHAR(16), status VARCHAR(30), sent_at DATETIME, created_by VARCHAR(120)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS message_templates (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, name VARCHAR(80), body TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permissions (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, role VARCHAR(40), perms LONGTEXT  -- module->bool JSON
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id VARCHAR(40) PRIMARY KEY, school_id VARCHAR(40) NOT NULL, skey VARCHAR(60), data LONGTEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

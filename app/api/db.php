<?php
/* ============================================================
 * db.php — PDO connection + schema bootstrap + first-run seed.
 *
 * Multi-tenant document store. Every row is tagged with school_id and
 * the API filters every query by the school in the request's token:
 *   schools(id, name, status, plan, created_at)     -- tenant registry
 *   documents(id, collection, school_id, data)       -- array collections
 *   singletons(school_id, name, data)                -- per-school settings
 *   meta_seq(school_id, kind, val)                    -- per-school counters
 *
 * NOTE ON MIGRATION: the singletons/meta_seq tables are now keyed by
 * school_id. A database created by the OLD schema (name-only PK) must be
 * migrated or rebuilt before use — see README-ISOLATION.md.
 * ============================================================ */

function db_connect($cfg) {
    if ($cfg['DB_DRIVER'] === 'mysql') {
        $dsn = "mysql:host={$cfg['MYSQL_HOST']};dbname={$cfg['MYSQL_NAME']};charset={$cfg['MYSQL_CHARSET']}";
        $pdo = new PDO($dsn, $cfg['MYSQL_USER'], $cfg['MYSQL_PASS'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $jsonType = 'LONGTEXT';
    } else {
        $dir = dirname($cfg['SQLITE_PATH']);
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $pdo = new PDO('sqlite:' . $cfg['SQLITE_PATH'], null, null, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
        $jsonType = 'TEXT';
    }

    $pdo->exec("CREATE TABLE IF NOT EXISTS schools (
        id VARCHAR(40) PRIMARY KEY,
        name VARCHAR(160),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        plan VARCHAR(40),
        created_at VARCHAR(30)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(80) NOT NULL,
        collection VARCHAR(60) NOT NULL,
        school_id VARCHAR(40) NOT NULL,
        data $jsonType,
        PRIMARY KEY (collection, id)
    )");
    // Helps every school-scoped list query.
    try { $pdo->exec("CREATE INDEX idx_docs_coll_school ON documents (collection, school_id)"); } catch (Throwable $e) {}
    $pdo->exec("CREATE TABLE IF NOT EXISTS singletons (
        school_id VARCHAR(40) NOT NULL,
        name VARCHAR(60) NOT NULL,
        data $jsonType,
        PRIMARY KEY (school_id, name)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS meta_seq (
        school_id VARCHAR(40) NOT NULL,
        kind VARCHAR(40) NOT NULL,
        val INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (school_id, kind)
    )");

    // First-run: seed the default single-school install.
    db_seed_if_empty($pdo, $cfg['SCHOOL_ID']);
    return $pdo;
}

// Collections that are single objects (one per school).
function db_singletons() {
    return ['school', 'academic', 'idRules', 'admissionFields', 'weighting', 'labels', 'payrollSettings', 'automation', 'inventorySettings', 'dashboardSettings'];
}

// Seed a brand-new database with the default school, only if empty.
function db_seed_if_empty($pdo, $defaultSchool) {
    $count = (int)$pdo->query("SELECT COUNT(*) c FROM schools")->fetch()['c'];
    if ($count > 0) { return; } // already has at least one school
    $seed = db_load_seed();
    if (!$seed) { return; }
    $name = isset($seed['school']['name']) ? $seed['school']['name'] : 'School';
    db_seed_school($pdo, $defaultSchool, $seed, $name);
}

function db_load_seed() {
    $seedPath = __DIR__ . '/seed.json';
    if (!file_exists($seedPath)) { return null; }
    $seed = json_decode(file_get_contents($seedPath), true);
    return $seed ?: null;
}

// Insert/replace all default data for one school under $school id.
// Used both for first-run seeding and for provisioning a new subscriber.
function db_seed_school($pdo, $school, $seed, $name = null) {
    if (!$seed) { $seed = db_load_seed(); }
    if (!$seed) { return; }

    // registry row
    $reg = $pdo->prepare("INSERT INTO schools(id,name,status,plan,created_at) VALUES(?,?,?,?,?)");
    try {
        $reg->execute([$school, $name ?: ($seed['school']['name'] ?? 'School'), 'active', 'standard', gmdate('c')]);
    } catch (Throwable $e) { /* already registered */ }

    $singletons = db_singletons();
    $insDoc = $pdo->prepare("INSERT INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)");
    $insOne = $pdo->prepare("REPLACE INTO singletons(school_id,name,data) VALUES(?,?,?)");

    foreach ($seed as $key => $val) {
        if ($key === 'meta' || $key === 'constants') { continue; }
        if (in_array($key, $singletons)) {
            if (is_array($val)) { $val['school_id'] = $school; }
            $insOne->execute([$school, $key, json_encode($val)]);
        } elseif (is_array($val)) {
            foreach ($val as $rec) {
                if (!is_array($rec)) { continue; }
                $id = isset($rec['id']) ? $rec['id'] : uniqid($key . '-');
                $rec['id'] = $id;
                $rec['school_id'] = $school; // force tenant tag
                $insDoc->execute([$id, $key, $school, json_encode($rec)]);
            }
        }
    }

    $insSeq = $pdo->prepare("REPLACE INTO meta_seq(school_id,kind,val) VALUES(?,?,?)");
    if (isset($seed['meta']['seq'])) {
        foreach ($seed['meta']['seq'] as $kind => $v) { $insSeq->execute([$school, $kind, (int)$v]); }
    }
}

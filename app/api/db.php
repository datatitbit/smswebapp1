<?php
/* ============================================================
 * db.php — PDO connection + schema bootstrap + first-run seed.
 *
 * The API uses a small document store that mirrors the front-end
 * data-access layer exactly, so the SAME single-page app runs
 * unchanged against PHP/MySQL (set useApi=true in the front end):
 *   documents(id, collection, school_id, data)
 *   singletons(name, data)
 *   meta_seq(kind, val)
 * A normalised relational schema is also provided in
 * schema.mysql.sql for schools/DBAs who want a classic model.
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

    $pdo->exec("CREATE TABLE IF NOT EXISTS documents (
        id VARCHAR(80) NOT NULL,
        collection VARCHAR(60) NOT NULL,
        school_id VARCHAR(40),
        data $jsonType,
        PRIMARY KEY (collection, id)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS singletons (
        name VARCHAR(60) PRIMARY KEY,
        data $jsonType
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS meta_seq (
        kind VARCHAR(40) PRIMARY KEY,
        val INTEGER NOT NULL DEFAULT 0
    )");

    db_seed_if_empty($pdo);
    return $pdo;
}

// Collections that are single objects (one per school).
function db_singletons() {
    return ['school', 'academic', 'idRules', 'admissionFields', 'weighting', 'labels', 'payrollSettings', 'automation', 'inventorySettings', 'dashboardSettings'];
}

function db_seed_if_empty($pdo) {
    $count = (int)$pdo->query("SELECT COUNT(*) c FROM singletons")->fetch()['c'];
    if ($count > 0) return; // already seeded
    $seedPath = __DIR__ . '/seed.json';
    if (!file_exists($seedPath)) return;
    $seed = json_decode(file_get_contents($seedPath), true);
    if (!$seed) return;

    $singletons = db_singletons();
    foreach ($seed as $key => $val) {
        if ($key === 'meta' || $key === 'constants') continue;
        if (in_array($key, $singletons)) {
            $st = $pdo->prepare("INSERT INTO singletons(name,data) VALUES(?,?)");
            $st->execute([$key, json_encode($val)]);
        } elseif (is_array($val)) {
            $st = $pdo->prepare("INSERT INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)");
            foreach ($val as $rec) {
                if (!is_array($rec)) continue;
                $id = isset($rec['id']) ? $rec['id'] : uniqid($key . '-');
                $rec['id'] = $id;
                $st->execute([$id, $key, $rec['school_id'] ?? null, json_encode($rec)]);
            }
        }
    }
    if (isset($seed['meta']['seq'])) {
        $st = $pdo->prepare("INSERT INTO meta_seq(kind,val) VALUES(?,?)");
        foreach ($seed['meta']['seq'] as $kind => $v) $st->execute([$kind, (int)$v]);
    }
}

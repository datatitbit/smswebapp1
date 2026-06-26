<?php
/* ============================================================
 * index.php — REST front controller for the SMS API.
 * Mirrors the front-end data-access layer (store.js → ApiAdapter).
 *
 * Routes (via ?r=...):
 *   GET    ?r={collection}              list
 *   GET    ?r={collection}/{id}         get one
 *   POST   ?r={collection}              insert (JSON body)
 *   PUT    ?r={collection}/{id}         update (JSON body, partial)
 *   DELETE ?r={collection}/{id}         remove
 *   PUT    ?r={collection}  {replace:[]} replace whole collection
 *   GET    ?r=singleton/{name}          get singleton
 *   PUT    ?r=singleton/{name}          set singleton (JSON body)
 *   POST   ?r=seq/{kind}                next sequence number
 *   GET    ?r=export                    full dataset
 *   PUT    ?r=import                    replace full dataset
 *   POST   ?r=reset                     wipe + reseed
 *   POST   ?r=pay        {amount,...}    mock payment (test mode)
 *   POST   ?r=sms        {to,body}      mock SMS (test mode)
 * ============================================================ */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$cfg = require __DIR__ . '/config.php';
require __DIR__ . '/db.php';
require __DIR__ . '/services-stub.php';

function out($data, $code = 200) { http_response_code($code); echo json_encode($data); exit; }
function body() { $raw = file_get_contents('php://input'); return $raw ? json_decode($raw, true) : []; }

try {
    $pdo = db_connect($cfg);
} catch (Throwable $e) {
    out(['error' => 'DB connection failed', 'detail' => $e->getMessage()], 500);
}

$method = $_SERVER['REQUEST_METHOD'];
$r = isset($_GET['r']) ? trim($_GET['r'], '/') : '';
$parts = $r === '' ? [] : explode('/', $r);
$head = $parts[0] ?? '';
$arg  = $parts[1] ?? null;
$SCHOOL = $cfg['SCHOOL_ID'];

/* ---- special endpoints ---- */
if ($head === 'singleton') {
    if ($method === 'GET') {
        $row = $pdo->prepare("SELECT data FROM singletons WHERE name=?");
        $row->execute([$arg]);
        $d = $row->fetch();
        out($d ? json_decode($d['data'], true) : null);
    }
    if ($method === 'PUT') {
        $obj = body();
        $st = $pdo->prepare("REPLACE INTO singletons(name,data) VALUES(?,?)");
        $st->execute([$arg, json_encode($obj)]);
        out($obj);
    }
}

if ($head === 'seq' && $method === 'POST') {
    // Portable upsert (works on SQLite and any MySQL version).
    $chk = $pdo->prepare("SELECT val FROM meta_seq WHERE kind=?"); $chk->execute([$arg]);
    if (!$chk->fetch()) $pdo->prepare("INSERT INTO meta_seq(kind,val) VALUES(?,0)")->execute([$arg]);
    $pdo->prepare("UPDATE meta_seq SET val = val + 1 WHERE kind=?")->execute([$arg]);
    $v = $pdo->prepare("SELECT val FROM meta_seq WHERE kind=?"); $v->execute([$arg]);
    out((int)$v->fetch()['val']);
}

if ($head === 'export' && $method === 'GET') {
    $data = [];
    $cols = $pdo->query("SELECT DISTINCT collection FROM documents")->fetchAll();
    foreach ($cols as $c) {
        $rows = $pdo->prepare("SELECT data FROM documents WHERE collection=?");
        $rows->execute([$c['collection']]);
        $data[$c['collection']] = array_map(fn($x) => json_decode($x['data'], true), $rows->fetchAll());
    }
    foreach ($pdo->query("SELECT name,data FROM singletons")->fetchAll() as $s) {
        $data[$s['name']] = json_decode($s['data'], true);
    }
    $seq = [];
    foreach ($pdo->query("SELECT kind,val FROM meta_seq")->fetchAll() as $m) $seq[$m['kind']] = (int)$m['val'];
    $data['meta'] = ['seq' => $seq];
    out($data);
}

if ($head === 'import' && $method === 'PUT') {
    $data = body();
    $pdo->exec("DELETE FROM documents"); $pdo->exec("DELETE FROM singletons"); $pdo->exec("DELETE FROM meta_seq");
    $singletons = db_singletons();
    foreach ($data as $key => $val) {
        if ($key === 'meta' || $key === 'constants') continue;
        if (in_array($key, $singletons)) {
            $pdo->prepare("INSERT INTO singletons(name,data) VALUES(?,?)")->execute([$key, json_encode($val)]);
        } elseif (is_array($val)) {
            $st = $pdo->prepare("INSERT INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)");
            foreach ($val as $rec) {
                if (!is_array($rec)) continue;
                $id = $rec['id'] ?? uniqid($key . '-'); $rec['id'] = $id;
                $st->execute([$id, $key, $rec['school_id'] ?? null, json_encode($rec)]);
            }
        }
    }
    if (isset($data['meta']['seq'])) foreach ($data['meta']['seq'] as $k => $v)
        $pdo->prepare("INSERT INTO meta_seq(kind,val) VALUES(?,?)")->execute([$k, (int)$v]);
    out(['ok' => true]);
}

if ($head === 'reset' && $method === 'POST') {
    $pdo->exec("DELETE FROM documents"); $pdo->exec("DELETE FROM singletons"); $pdo->exec("DELETE FROM meta_seq");
    db_seed_if_empty($pdo);
    out(['ok' => true]);
}

if ($head === 'pay' && $method === 'POST')  out(svc_payment_charge($cfg, body()));
if ($head === 'sms' && $method === 'POST')  out(svc_sms_send($cfg, body()));

/* ---- generic collection CRUD ---- */
if ($head === '') out(['error' => 'No route'], 400);
$collection = $head;

if ($method === 'GET' && $arg === null) {
    $rows = $pdo->prepare("SELECT data FROM documents WHERE collection=?");
    $rows->execute([$collection]);
    out(array_map(fn($x) => json_decode($x['data'], true), $rows->fetchAll()));
}
if ($method === 'GET') {
    $row = $pdo->prepare("SELECT data FROM documents WHERE collection=? AND id=?");
    $row->execute([$collection, $arg]);
    $d = $row->fetch();
    out($d ? json_decode($d['data'], true) : null);
}
if ($method === 'POST') {
    $obj = body();
    if (empty($obj['id'])) $obj['id'] = $collection . '-' . bin2hex(random_bytes(5));
    if (empty($obj['school_id'])) $obj['school_id'] = $SCHOOL;
    $pdo->prepare("REPLACE INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)")
        ->execute([$obj['id'], $collection, $obj['school_id'], json_encode($obj)]);
    out($obj, 201);
}
if ($method === 'PUT' && $arg === null) {
    // replace whole collection: { replace:[...] }
    $b = body();
    $arr = $b['replace'] ?? [];
    $pdo->prepare("DELETE FROM documents WHERE collection=?")->execute([$collection]);
    $st = $pdo->prepare("INSERT INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)");
    foreach ($arr as $rec) {
        $id = $rec['id'] ?? ($collection . '-' . bin2hex(random_bytes(5))); $rec['id'] = $id;
        $st->execute([$id, $collection, $rec['school_id'] ?? $SCHOOL, json_encode($rec)]);
    }
    out($arr);
}
if ($method === 'PUT') {
    $patch = body();
    $row = $pdo->prepare("SELECT data FROM documents WHERE collection=? AND id=?");
    $row->execute([$collection, $arg]);
    $d = $row->fetch();
    if (!$d) out(null, 404);
    $obj = array_merge(json_decode($d['data'], true), $patch);
    $pdo->prepare("UPDATE documents SET data=?, school_id=? WHERE collection=? AND id=?")
        ->execute([json_encode($obj), $obj['school_id'] ?? $SCHOOL, $collection, $arg]);
    out($obj);
}
if ($method === 'DELETE') {
    $pdo->prepare("DELETE FROM documents WHERE collection=? AND id=?")->execute([$collection, $arg]);
    out(['ok' => true]);
}

out(['error' => 'Unsupported route', 'route' => $r, 'method' => $method], 400);

<?php
/* ============================================================
 * index.php — REST front controller for the SMS API.
 * Mirrors the front-end data-access layer (store.js -> ApiAdapter).
 *
 * SECURITY MODEL (multi-tenant):
 *   - POST ?r=auth/login is the ONLY public route. It verifies the
 *     username/password against that school's users and returns a
 *     signed token carrying the school id + role.
 *   - Every other route requires  Authorization: Bearer <token>.
 *   - The active school is taken FROM THE TOKEN only — never from the
 *     request body or query. Every read/write is filtered by it, and
 *     every write is stamped with it. A client cannot touch, name, or
 *     overwrite another school's data.
 *
 * Routes (via ?r=...):
 *   POST   ?r=auth/login   {username,password[,school_id]}  -> {token,...}
 *   GET    ?r={collection}                 list   (this school)
 *   GET    ?r={collection}/{id}            get one
 *   POST   ?r={collection}                 insert/upsert (JSON body)
 *   PUT    ?r={collection}/{id}            update (partial)
 *   DELETE ?r={collection}/{id}            remove
 *   PUT    ?r={collection}  {replace:[]}   replace this school's collection
 *   GET    ?r=singleton/{name}             get singleton
 *   PUT    ?r=singleton/{name}             set singleton
 *   POST   ?r=seq/{kind}                   next sequence number
 *   GET    ?r=export                       this school's full dataset
 *   POST   ?r=pay        {amount,...}      mock payment (test mode)
 *   POST   ?r=sms        {to,body}         mock SMS (test mode)
 *   -- platform super-admin only --
 *   POST   ?r=provision  {school_id,name}  create + seed a new school
 *   POST   ?r=suspend    {school_id,status}set a school's status
 *   POST   ?r=reset      {school_id}       re-seed one school
 * ============================================================ */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

$cfg = require __DIR__ . '/config.php';
require __DIR__ . '/db.php';
require __DIR__ . '/auth.php';
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

/* ============================================================
 * PUBLIC: login
 * ============================================================ */
if ($head === 'auth' && $arg === 'login' && $method === 'POST') {
    if ($cfg['APP_SECRET'] === 'CHANGE_ME_APP_SECRET_PLACEHOLDER') {
        out(['error' => 'Server not configured: APP_SECRET is unset'], 500);
    }
    $b = body();
    $username = isset($b['username']) ? $b['username'] : '';
    $password = isset($b['password']) ? $b['password'] : '';
    $school   = !empty($b['school_id']) ? $b['school_id'] : $cfg['SCHOOL_ID'];

    // Platform super-admin (cross-school), if configured.
    $pa = $cfg['PLATFORM_ADMIN'];
    if (!empty($pa['username']) && strtolower($username) === strtolower($pa['username'])) {
        if (auth_verify_password($password, $pa['salt'], $pa['hash'])) {
            $tok = token_issue($cfg['APP_SECRET'], ['sid' => null, 'uid' => 'platform', 'role' => 'Platform', 'plat' => true], $cfg['TOKEN_TTL']);
            out(['token' => $tok, 'role' => 'Platform', 'school_id' => null]);
        }
        out(['error' => 'Invalid credentials'], 401);
    }

    $u = find_user($pdo, $school, $username);
    if (!$u || !auth_verify_password($password, $u['password_salt'] ?? '', $u['password_hash'] ?? '')) {
        out(['error' => 'Invalid credentials'], 401);
    }
    if (!school_active($pdo, $school)) {
        out(['error' => 'This school\'s subscription is inactive. Please contact the administrator.'], 403);
    }
    $tok = token_issue($cfg['APP_SECRET'], [
        'sid'  => $school,
        'uid'  => $u['id'],
        'role' => $u['role'] ?? '',
        'plat' => false,
    ], $cfg['TOKEN_TTL']);
    out([
        'token'     => $tok,
        'role'      => $u['role'] ?? '',
        'school_id' => $school,
        // Non-secret profile the front-end needs to render the session.
        'user' => [
            'id'                   => $u['id'],
            'name'                 => $u['name'] ?? '',
            'username'             => $u['username'] ?? '',
            'role'                 => $u['role'] ?? '',
            'staff_id'             => $u['staff_id'] ?? null,
            'class_ids'            => $u['class_ids'] ?? [],
            'linked_student_ids'   => $u['linked_student_ids'] ?? [],
            'must_change_password' => !empty($u['must_change_password']),
        ],
    ]);
}

/* ============================================================
 * From here on, a valid token is required.
 * ============================================================ */
$claims = require_auth($cfg);
$isPlat = !empty($claims['plat']);

/* ---- platform super-admin routes ---- */
if ($head === 'provision' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid  = !empty($b['school_id']) ? $b['school_id'] : ('sch-' . bin2hex(random_bytes(5)));
    $name = $b['name'] ?? 'New School';
    $exists = $pdo->prepare("SELECT id FROM schools WHERE id=?"); $exists->execute([$sid]);
    if ($exists->fetch()) { out(['error' => 'School already exists', 'school_id' => $sid], 409); }
    db_seed_school($pdo, $sid, db_load_seed(), $name);
    out(['ok' => true, 'school_id' => $sid, 'name' => $name], 201);
}
if ($head === 'suspend' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid = $b['school_id'] ?? '';
    $status = $b['status'] ?? 'suspended'; // active | trial | grace | suspended | cancelled
    $st = $pdo->prepare("UPDATE schools SET status=? WHERE id=?");
    $st->execute([$status, $sid]);
    out(['ok' => true, 'school_id' => $sid, 'status' => $status]);
}
if ($head === 'reset' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid = $b['school_id'] ?? '';
    if (!$sid) { out(['error' => 'school_id required'], 400); }
    $pdo->prepare("DELETE FROM documents WHERE school_id=?")->execute([$sid]);
    $pdo->prepare("DELETE FROM singletons WHERE school_id=?")->execute([$sid]);
    $pdo->prepare("DELETE FROM meta_seq WHERE school_id=?")->execute([$sid]);
    db_seed_school($pdo, $sid, db_load_seed(), null);
    out(['ok' => true, 'school_id' => $sid]);
}

/* ============================================================
 * School-scoped routes. The school ALWAYS comes from the token.
 * (A platform token may target a school with ?school=<id> for support.)
 * ============================================================ */
$SCHOOL = $claims['sid'];
if ($SCHOOL === null) {
    if ($isPlat && isset($_GET['school'])) { $SCHOOL = $_GET['school']; }
    else { out(['error' => 'No school context for this token'], 400); }
}

if (!school_active($pdo, $SCHOOL)) {
    out(['error' => 'Subscription inactive'], 403);
}

/* ---- singletons (per school) ---- */
if ($head === 'singleton') {
    if ($method === 'GET') {
        $row = $pdo->prepare("SELECT data FROM singletons WHERE school_id=? AND name=?");
        $row->execute([$SCHOOL, $arg]);
        $d = $row->fetch();
        out($d ? json_decode($d['data'], true) : null);
    }
    if ($method === 'PUT') {
        $obj = body();
        if (is_array($obj)) { $obj['school_id'] = $SCHOOL; }
        $st = $pdo->prepare("REPLACE INTO singletons(school_id,name,data) VALUES(?,?,?)");
        $st->execute([$SCHOOL, $arg, json_encode($obj)]);
        out($obj);
    }
}

/* ---- per-school sequence counter ---- */
if ($head === 'seq' && $method === 'POST') {
    $chk = $pdo->prepare("SELECT val FROM meta_seq WHERE school_id=? AND kind=?");
    $chk->execute([$SCHOOL, $arg]);
    if (!$chk->fetch()) {
        $pdo->prepare("INSERT INTO meta_seq(school_id,kind,val) VALUES(?,?,0)")->execute([$SCHOOL, $arg]);
    }
    $pdo->prepare("UPDATE meta_seq SET val = val + 1 WHERE school_id=? AND kind=?")->execute([$SCHOOL, $arg]);
    $v = $pdo->prepare("SELECT val FROM meta_seq WHERE school_id=? AND kind=?");
    $v->execute([$SCHOOL, $arg]);
    out((int)$v->fetch()['val']);
}

/* ---- export just this school's data ---- */
if ($head === 'export' && $method === 'GET') {
    $data = [];
    $cols = $pdo->prepare("SELECT DISTINCT collection FROM documents WHERE school_id=?");
    $cols->execute([$SCHOOL]);
    foreach ($cols->fetchAll() as $c) {
        $rows = $pdo->prepare("SELECT data FROM documents WHERE collection=? AND school_id=?");
        $rows->execute([$c['collection'], $SCHOOL]);
        $data[$c['collection']] = array_map(fn($x) => json_decode($x['data'], true), $rows->fetchAll());
    }
    $ones = $pdo->prepare("SELECT name,data FROM singletons WHERE school_id=?");
    $ones->execute([$SCHOOL]);
    foreach ($ones->fetchAll() as $s) { $data[$s['name']] = json_decode($s['data'], true); }
    $seq = [];
    $seqs = $pdo->prepare("SELECT kind,val FROM meta_seq WHERE school_id=?");
    $seqs->execute([$SCHOOL]);
    foreach ($seqs->fetchAll() as $m) { $seq[$m['kind']] = (int)$m['val']; }
    $data['meta'] = ['seq' => $seq];
    out($data);
}

if ($head === 'pay' && $method === 'POST')  out(svc_payment_charge($cfg, body()));
if ($head === 'sms' && $method === 'POST')  out(svc_sms_send($cfg, body()));

/* ============================================================
 * Generic collection CRUD — every statement filtered by $SCHOOL.
 * ============================================================ */
if ($head === '') { out(['error' => 'No route'], 400); }
$collection = $head;

if ($method === 'GET' && $arg === null) {
    $rows = $pdo->prepare("SELECT data FROM documents WHERE collection=? AND school_id=?");
    $rows->execute([$collection, $SCHOOL]);
    out(array_map(fn($x) => json_decode($x['data'], true), $rows->fetchAll()));
}
if ($method === 'GET') {
    $row = $pdo->prepare("SELECT data FROM documents WHERE collection=? AND id=? AND school_id=?");
    $row->execute([$collection, $arg, $SCHOOL]);
    $d = $row->fetch();
    out($d ? json_decode($d['data'], true) : null);
}
if ($method === 'POST') {
    $obj = body();
    if (empty($obj['id'])) { $obj['id'] = $collection . '-' . bin2hex(random_bytes(5)); }
    $obj['school_id'] = $SCHOOL; // force tenant tag; ignore any client-supplied value

    // Guard: never let an upsert overwrite a row owned by another school.
    $own = $pdo->prepare("SELECT school_id FROM documents WHERE collection=? AND id=?");
    $own->execute([$collection, $obj['id']]);
    $exist = $own->fetch();
    if ($exist && $exist['school_id'] !== $SCHOOL) { out(['error' => 'Forbidden'], 403); }

    $pdo->prepare("REPLACE INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)")
        ->execute([$obj['id'], $collection, $SCHOOL, json_encode($obj)]);
    out($obj, 201);
}
if ($method === 'PUT' && $arg === null) {
    // replace this school's whole collection: { replace:[...] }
    $b = body();
    $arr = $b['replace'] ?? [];
    $pdo->prepare("DELETE FROM documents WHERE collection=? AND school_id=?")->execute([$collection, $SCHOOL]);
    $st = $pdo->prepare("INSERT INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)");
    foreach ($arr as $rec) {
        $id = $rec['id'] ?? ($collection . '-' . bin2hex(random_bytes(5))); $rec['id'] = $id;
        $rec['school_id'] = $SCHOOL;
        $st->execute([$id, $collection, $SCHOOL, json_encode($rec)]);
    }
    out($arr);
}
if ($method === 'PUT') {
    $patch = body();
    $row = $pdo->prepare("SELECT data FROM documents WHERE collection=? AND id=? AND school_id=?");
    $row->execute([$collection, $arg, $SCHOOL]);
    $d = $row->fetch();
    if (!$d) { out(null, 404); }
    $obj = array_merge(json_decode($d['data'], true), $patch);
    $obj['school_id'] = $SCHOOL; // never allow a patch to move a row to another school
    $pdo->prepare("UPDATE documents SET data=? WHERE collection=? AND id=? AND school_id=?")
        ->execute([json_encode($obj), $collection, $arg, $SCHOOL]);
    out($obj);
}
if ($method === 'DELETE') {
    $pdo->prepare("DELETE FROM documents WHERE collection=? AND id=? AND school_id=?")
        ->execute([$collection, $arg, $SCHOOL]);
    out(['ok' => true]);
}

out(['error' => 'Unsupported route', 'route' => $r, 'method' => $method], 400);

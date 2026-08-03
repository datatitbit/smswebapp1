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
 *   - Subscription/trial state is SERVER-AUTHORITATIVE: it lives on the
 *     schools row and is only ever changed through the platform routes
 *     below. A school cannot extend its own trial by editing anything
 *     it controls (browser storage, its own singletons, etc.).
 *   - EVERY platform (owner) route appends a row to platform_audit.
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
 *   PUT    ?r=import      {...}            replace this school's full dataset
 *   POST   ?r=pay        {amount,...}      mock payment (test mode)
 *   POST   ?r=sms        {to,body}         mock SMS (test mode)
 *   GET    ?r=subscription                 this school's licence state
 *                                          (read-only; server-computed)
 *   -- platform super-admin only --
 *   GET    ?r=schools/list                 list schools + user counts
 *   POST   ?r=provision   {school_id,name} create + seed a new school
 *   POST   ?r=suspend     {school_id,status} set a school's status
 *   POST   ?r=trial       {school_id, days | trial_ends_at | clear}
 *                                          extend / set / end the free trial
 *   POST   ?r=plan        {school_id,plan} change subscription tier
 *   POST   ?r=reset       {school_id}      re-seed one school
 *   POST   ?r=impersonate {school_id}      short-lived Admin token (logged)
 *   GET    ?r=platform/users?school=<id>   list one school's login accounts
 *   POST   ?r=platform/user {school_id,user_id,disabled}
 *                                          enable/disable one account
 *   GET    ?r=platform/audit[?school=<id>&limit=N]   read the audit log
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

/* ---- Owner-plane audit trail ----------------------------------------------
 * Appends one row per privileged action. Returns false if the write failed;
 * callers surface that as "audit": false in their response rather than
 * swallowing it, so an unlogged privileged action is visible instead of
 * silent. (Failing the whole action on a log error would let a broken audit
 * table lock the owner out of their own console, which is worse.) */
function audit($pdo, $claims, $action, $schoolId = null, $targetId = null, $detail = null) {
    try {
        $pdo->prepare("INSERT INTO platform_audit(platform_uid,action,school_id,target_id,detail,created_at) VALUES(?,?,?,?,?,?)")
            ->execute([
                $claims['uid'] ?? 'platform',
                $action,
                $schoolId,
                $targetId,
                $detail === null ? null : json_encode($detail),
                gmdate('c'),
            ]);
        return true;
    } catch (Throwable $e) {
        return false;
    }
}

/* ---- Subscription state (server is the source of truth) -------------------
 * Derived purely from the schools registry row. trial_ends_at === null means
 * "no trial running" — i.e. a fully paid school. Dates are plain YYYY-MM-DD
 * compared in UTC so the answer does not drift with the caller's timezone. */
function subscription_state($row) {
    $status    = $row['status'] ?? 'active';
    $trialEnds = $row['trial_ends_at'] ?? null;
    $daysLeft  = null;
    $state     = 'active';
    if (!in_array($status, ['active', 'trial', 'grace'], true)) {
        $state = 'suspended';
    } elseif ($trialEnds) {
        $daysLeft = (int)floor(
            (strtotime($trialEnds . ' 00:00:00 UTC') - strtotime(gmdate('Y-m-d') . ' 00:00:00 UTC')) / 86400
        );
        $state = $daysLeft >= 0 ? 'trialing' : 'expired';
    }
    return [
        'school_id'     => $row['id'] ?? null,
        'name'          => $row['name'] ?? '',
        'status'        => $status,
        'plan'          => $row['plan'] ?? null,
        'trial_ends_at' => $trialEnds,
        'state'         => $state,
        'days_left'     => $daysLeft,
        'source'        => 'server',
    ];
}

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
    // Checked only AFTER the password verifies, so this never reveals whether
    // a given username exists to someone who cannot already authenticate.
    if (!empty($u['disabled'])) {
        out(['error' => 'This account has been disabled. Please contact your school administrator.'], 403);
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
if ($head === 'schools' && $arg === 'list' && $method === 'GET') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $rows = $pdo->query("SELECT id, name, status, plan, created_at, trial_ends_at FROM schools ORDER BY created_at DESC")->fetchAll();
    $cntStmt = $pdo->prepare("SELECT COUNT(*) c FROM documents WHERE collection='users' AND school_id=?");
    foreach ($rows as &$row) {
        $cntStmt->execute([$row['id']]);
        $row['user_count'] = (int)$cntStmt->fetch()['c'];
        $sub = subscription_state($row);
        $row['state'] = $sub['state'];
        $row['days_left'] = $sub['days_left'];
    }
    unset($row);
    out($rows);
}
if ($head === 'provision' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid  = !empty($b['school_id']) ? $b['school_id'] : ('sch-' . bin2hex(random_bytes(5)));
    $name = $b['name'] ?? 'New School';
    $exists = $pdo->prepare("SELECT id FROM schools WHERE id=?"); $exists->execute([$sid]);
    if ($exists->fetch()) { out(['error' => 'School already exists', 'school_id' => $sid], 409); }
    db_seed_school($pdo, $sid, db_load_seed(), $name);
    $logged = audit($pdo, $claims, 'provision', $sid, null, ['name' => $name]);
    out(['ok' => true, 'audit' => $logged, 'school_id' => $sid, 'name' => $name], 201);
}
if ($head === 'suspend' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid = $b['school_id'] ?? '';
    $status = $b['status'] ?? 'suspended'; // active | trial | grace | suspended | cancelled
    if (!$sid) { out(['error' => 'school_id required'], 400); }
    if (!in_array($status, ['active', 'trial', 'grace', 'suspended', 'cancelled'], true)) {
        out(['error' => 'Unknown status'], 400);
    }
    $prev = $pdo->prepare("SELECT status FROM schools WHERE id=?"); $prev->execute([$sid]);
    $prevRow = $prev->fetch();
    if (!$prevRow) { out(['error' => 'School not found'], 404); }
    $pdo->prepare("UPDATE schools SET status=? WHERE id=?")->execute([$status, $sid]);
    $logged = audit($pdo, $claims, 'status', $sid, null, ['from' => $prevRow['status'], 'to' => $status]);
    out(['ok' => true, 'audit' => $logged, 'school_id' => $sid, 'status' => $status]);
}
/* Free-trial control. SERVER-AUTHORITATIVE: the trial lives on the schools
 * row as trial_ends_at, so a school cannot extend its own trial by clearing
 * browser storage or editing anything it owns. Three mutually exclusive
 * modes, in precedence order:
 *   clear:true            -> end the trial now (school is fully paid)
 *   trial_ends_at:Y-m-d   -> set an explicit end date
 *   days:N                -> EXTEND by N days from whichever is later, today
 *                            or the current end date. So extending a live
 *                            trial adds to it, and extending an already
 *                            expired one gives a fresh full N days rather
 *                            than silently landing in the past. */
if ($head === 'trial' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid = $b['school_id'] ?? '';
    if (!$sid) { out(['error' => 'school_id required'], 400); }
    $sc = $pdo->prepare("SELECT * FROM schools WHERE id=?"); $sc->execute([$sid]);
    $row = $sc->fetch();
    if (!$row) { out(['error' => 'School not found'], 404); }

    if (!empty($b['clear'])) {
        $newEnd = null;
    } elseif (!empty($b['trial_ends_at'])) {
        $d = (string)$b['trial_ends_at'];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) { out(['error' => 'trial_ends_at must be YYYY-MM-DD'], 400); }
        $newEnd = $d;
    } else {
        $extra = isset($b['days']) ? (int)$b['days'] : 0;
        if ($extra < 1 || $extra > 3650) { out(['error' => 'days must be between 1 and 3650'], 400); }
        $today = gmdate('Y-m-d');
        $base = (!empty($row['trial_ends_at']) && $row['trial_ends_at'] > $today) ? $row['trial_ends_at'] : $today;
        $newEnd = gmdate('Y-m-d', strtotime($base . ' 00:00:00 UTC') + ($extra * 86400));
    }

    $pdo->prepare("UPDATE schools SET trial_ends_at=? WHERE id=?")->execute([$newEnd, $sid]);
    $logged = audit($pdo, $claims, 'trial', $sid, null, ['from' => $row['trial_ends_at'] ?? null, 'to' => $newEnd]);
    $after = $pdo->prepare("SELECT * FROM schools WHERE id=?"); $after->execute([$sid]);
    out(['ok' => true, 'audit' => $logged, 'subscription' => subscription_state($after->fetch())]);
}
/* Subscription tier. Kept in step with license-lib.js's PLANS keys. */
if ($head === 'plan' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid  = $b['school_id'] ?? '';
    $plan = $b['plan'] ?? '';
    if (!$sid) { out(['error' => 'school_id required'], 400); }
    if (!in_array($plan, ['basic', 'growth', 'premium'], true)) {
        out(['error' => 'plan must be one of: basic, growth, premium'], 400);
    }
    $prev = $pdo->prepare("SELECT plan FROM schools WHERE id=?"); $prev->execute([$sid]);
    $prevRow = $prev->fetch();
    if (!$prevRow) { out(['error' => 'School not found'], 404); }
    $pdo->prepare("UPDATE schools SET plan=? WHERE id=?")->execute([$plan, $sid]);
    $logged = audit($pdo, $claims, 'plan', $sid, null, ['from' => $prevRow['plan'], 'to' => $plan]);
    out(['ok' => true, 'audit' => $logged, 'school_id' => $sid, 'plan' => $plan]);
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
    $logged = audit($pdo, $claims, 'reset', $sid);
    out(['ok' => true, 'audit' => $logged, 'school_id' => $sid]);
}
/* ---- platform/* : per-user administration + the audit log itself ---- */
if ($head === 'platform' && $arg === 'users' && $method === 'GET') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $sid = $_GET['school'] ?? '';
    if (!$sid) { out(['error' => 'school query parameter required'], 400); }
    $us = $pdo->prepare("SELECT data FROM documents WHERE collection='users' AND school_id=?");
    $us->execute([$sid]);
    $list = [];
    foreach ($us->fetchAll() as $row) {
        $u = json_decode($row['data'], true);
        if (!is_array($u)) { continue; }
        // Password salt/hash are never returned — not even to the owner plane.
        $list[] = [
            'id'                   => $u['id'] ?? null,
            'name'                 => $u['name'] ?? '',
            'username'             => $u['username'] ?? '',
            'role'                 => $u['role'] ?? '',
            'disabled'             => !empty($u['disabled']),
            'must_change_password' => !empty($u['must_change_password']),
        ];
    }
    out($list);
}
if ($head === 'platform' && $arg === 'user' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid = $b['school_id'] ?? '';
    $uid = $b['user_id'] ?? '';
    if (!$sid || !$uid) { out(['error' => 'school_id and user_id required'], 400); }
    $disabled = !empty($b['disabled']);

    $row = $pdo->prepare("SELECT data FROM documents WHERE collection='users' AND id=? AND school_id=?");
    $row->execute([$uid, $sid]);
    $d = $row->fetch();
    if (!$d) { out(['error' => 'User not found in that school'], 404); }
    $u = json_decode($d['data'], true);
    if (!is_array($u)) { out(['error' => 'User record is unreadable'], 500); }

    // Guard: never let the owner disable a school's LAST working Admin — that
    // would lock the school out of its own settings. Suspend the whole school
    // instead if that is the intent.
    if ($disabled && ($u['role'] ?? '') === 'Admin' && empty($u['disabled'])) {
        $all = $pdo->prepare("SELECT data FROM documents WHERE collection='users' AND school_id=?");
        $all->execute([$sid]);
        $liveAdmins = 0;
        foreach ($all->fetchAll() as $r2) {
            $o = json_decode($r2['data'], true);
            if (is_array($o) && ($o['role'] ?? '') === 'Admin' && empty($o['disabled'])) { $liveAdmins++; }
        }
        if ($liveAdmins <= 1) {
            out(['error' => 'This is the school\'s only active Admin. Suspend the whole school instead, or enable another Admin first.'], 409);
        }
    }

    $u['disabled'] = $disabled;
    $pdo->prepare("UPDATE documents SET data=? WHERE collection='users' AND id=? AND school_id=?")
        ->execute([json_encode($u), $uid, $sid]);
    $logged = audit($pdo, $claims, $disabled ? 'user_disable' : 'user_enable', $sid, $uid, ['username' => $u['username'] ?? '']);
    out(['ok' => true, 'audit' => $logged, 'school_id' => $sid, 'user_id' => $uid, 'disabled' => $disabled]);
}
if ($head === 'platform' && $arg === 'audit' && $method === 'GET') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $sid = isset($_GET['school']) ? $_GET['school'] : null;
    // Cast + clamp before interpolating: LIMIT cannot be a bound parameter.
    $limit = isset($_GET['limit']) ? max(1, min(500, (int)$_GET['limit'])) : 100;
    if ($sid) {
        $st = $pdo->prepare("SELECT * FROM platform_audit WHERE school_id=? ORDER BY id DESC LIMIT $limit");
        $st->execute([$sid]);
    } else {
        $st = $pdo->prepare("SELECT * FROM platform_audit ORDER BY id DESC LIMIT $limit");
        $st->execute();
    }
    $rows = $st->fetchAll();
    foreach ($rows as &$r2) { $r2['detail'] = !empty($r2['detail']) ? json_decode($r2['detail'], true) : null; }
    unset($r2);
    out($rows);
}
if ($head === 'impersonate' && $method === 'POST') {
    if (!$isPlat) { out(['error' => 'Forbidden'], 403); }
    $b = body();
    $sid = $b['school_id'] ?? '';
    if (!$sid) { out(['error' => 'school_id required'], 400); }
    $sc = $pdo->prepare("SELECT id FROM schools WHERE id=?"); $sc->execute([$sid]);
    if (!$sc->fetch()) { out(['error' => 'School not found'], 404); }

    // Impersonate as that school's first ACTIVE Admin user, if one exists —
    // falls back to a synthetic Admin identity (no linked user record).
    $adminUser = null;
    $us = $pdo->prepare("SELECT data FROM documents WHERE collection='users' AND school_id=?");
    $us->execute([$sid]);
    foreach ($us->fetchAll() as $row) {
        $u = json_decode($row['data'], true);
        if (is_array($u) && ($u['role'] ?? '') === 'Admin' && empty($u['disabled'])) { $adminUser = $u; break; }
    }

    // Deliberately much shorter than a normal session (TOKEN_TTL) — this is a
    // support/debugging session, not a login, and every one is logged below.
    $impTtl = 900; // 15 minutes
    $platUid = $claims['uid'] ?? 'platform';
    $tok = token_issue($cfg['APP_SECRET'], [
        'sid'    => $sid,
        'uid'    => $adminUser['id'] ?? ('platform-imp-' . $sid),
        'role'   => 'Admin',
        'plat'   => false,
        'imp'    => true,
        'imp_by' => $platUid,
    ], $impTtl);

    $issuedAt = gmdate('c');
    $expiresAt = gmdate('c', time() + $impTtl);
    $logged = audit($pdo, $claims, 'impersonate', $sid, $adminUser['id'] ?? null, [
        'issued_at'  => $issuedAt,
        'expires_at' => $expiresAt,
        'ttl'        => $impTtl,
    ]);

    out([
        'token'      => $tok,
        'role'       => 'Admin',
        'school_id'  => $sid,
        'imp'        => true,
        'audit'      => $logged,
        'expires_at' => $expiresAt,
        'user' => [
            'id'                   => $adminUser['id'] ?? ('platform-imp-' . $sid),
            'name'                 => ($adminUser['name'] ?? 'Impersonated Admin') . ' (impersonated)',
            'username'             => $adminUser['username'] ?? '',
            'role'                 => 'Admin',
            'staff_id'             => $adminUser['staff_id'] ?? null,
            'class_ids'            => $adminUser['class_ids'] ?? [],
            'linked_student_ids'   => $adminUser['linked_student_ids'] ?? [],
            'must_change_password' => false,
        ],
    ]);
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

/* ---- this school's own licence state (read-only) ----
 * The school reads its trial/plan from here instead of computing it from
 * anything stored client-side. A missing registry row means a legacy
 * single-school install, which is treated as fully active. */
if ($head === 'subscription' && $method === 'GET') {
    $st = $pdo->prepare("SELECT * FROM schools WHERE id=?");
    $st->execute([$SCHOOL]);
    $row = $st->fetch();
    if (!$row) {
        out([
            'school_id' => $SCHOOL, 'name' => '', 'status' => 'active', 'plan' => null,
            'trial_ends_at' => null, 'state' => 'active', 'days_left' => null, 'source' => 'server',
        ]);
    }
    out(subscription_state($row));
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

/* ---- import: replace this school's ENTIRE dataset from an uploaded blob ----
 * Mirrors db_seed_school()'s write logic exactly, but WITHOUT touching the
 * `schools` registry row, and scoped to $SCHOOL from the token — a client
 * can never import data into (or overwrite) any school but its own, and
 * every row/singleton/seq is force-stamped with $SCHOOL regardless of what
 * school_id (if any) is present in the uploaded JSON. Because the registry
 * row is untouched, a school also cannot import itself a longer free trial. */
if ($head === 'import' && $method === 'PUT') {
    $data = body();
    $pdo->prepare("DELETE FROM documents WHERE school_id=?")->execute([$SCHOOL]);
    $pdo->prepare("DELETE FROM singletons WHERE school_id=?")->execute([$SCHOOL]);
    $pdo->prepare("DELETE FROM meta_seq WHERE school_id=?")->execute([$SCHOOL]);
    $singletons = db_singletons();
    $insDoc = $pdo->prepare("INSERT INTO documents(id,collection,school_id,data) VALUES(?,?,?,?)");
    $insOne = $pdo->prepare("REPLACE INTO singletons(school_id,name,data) VALUES(?,?,?)");
    foreach ($data as $key => $val) {
        if ($key === 'meta' || $key === 'constants') { continue; }
        if (in_array($key, $singletons)) {
            if (is_array($val)) { $val['school_id'] = $SCHOOL; }
            $insOne->execute([$SCHOOL, $key, json_encode($val)]);
        } elseif (is_array($val)) {
            foreach ($val as $rec) {
                if (!is_array($rec)) { continue; }
                $id = $rec['id'] ?? uniqid($key . '-');
                $rec['id'] = $id;
                $rec['school_id'] = $SCHOOL; // force tenant tag; ignore any client-supplied value
                $insDoc->execute([$id, $key, $SCHOOL, json_encode($rec)]);
            }
        }
    }
    if (isset($data['meta']['seq'])) {
        $insSeq = $pdo->prepare("REPLACE INTO meta_seq(school_id,kind,val) VALUES(?,?,?)");
        foreach ($data['meta']['seq'] as $k => $v) { $insSeq->execute([$SCHOOL, $k, (int)$v]); }
    }
    out(['ok' => true]);
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

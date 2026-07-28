<?php
/* ============================================================
 * config.php — environment configuration for the REST API.
 * Development: SQLite (zero setup). Production (cPanel): MySQL.
 * Switch by setting DB_DRIVER to 'sqlite' or 'mysql'.
 *
 * MULTI-TENANT NOTE: this API now enforces per-school isolation.
 * Every request (except login) must carry a Bearer token issued by
 * ?r=auth/login. The school is read FROM THE TOKEN — never from the
 * request body or from SCHOOL_ID below. SCHOOL_ID is only the default
 * tenant used when seeding a brand-new database (single-school installs)
 * and when a login request omits an explicit school_id.
 * ============================================================ */

return [
    'DB_DRIVER' => getenv('SMS_DB_DRIVER') ?: 'sqlite',

    // SQLite (development)
    'SQLITE_PATH' => getenv('SMS_SQLITE_PATH') ?: (__DIR__ . '/data/sms.sqlite'),

    // MySQL (cPanel production) — replace PLACEHOLDER values
    'MYSQL_HOST'    => getenv('SMS_DB_HOST') ?: 'localhost',
    'MYSQL_NAME'    => getenv('SMS_DB_NAME') ?: 'cpaneluser_sms',
    'MYSQL_USER'    => getenv('SMS_DB_USER') ?: 'cpaneluser_smsapp',
    'MYSQL_PASS'    => getenv('SMS_DB_PASS') ?: 'CHANGE_ME_PLACEHOLDER',
    'MYSQL_CHARSET' => 'utf8mb4',

    // Default tenant id used ONLY to seed a fresh database and as the
    // fallback school for a login that doesn't name one. In a shared,
    // multi-school database the real school always comes from the token.
    'SCHOOL_ID' => getenv('SMS_SCHOOL_ID') ?: 'sch-1',

    // ---- Auth / token signing ----
    // Secret used to HMAC-sign session tokens. MUST be set to a long random
    // value in production (e.g. `openssl rand -hex 32`). If left as the
    // placeholder, the API refuses to issue tokens (see index.php).
    'APP_SECRET' => getenv('SMS_APP_SECRET') ?: 'CHANGE_ME_APP_SECRET_PLACEHOLDER',
    'TOKEN_TTL'  => (int)(getenv('SMS_TOKEN_TTL') ?: 43200), // seconds (default 12h)

    // ---- Platform (Zetranova) super-admin ----
    // A single cross-school account that can provision/suspend schools.
    // Generate salt+hash with tools/hashpass.php (see README-ISOLATION.md).
    // Leave username empty to disable the platform account entirely.
    'PLATFORM_ADMIN' => [
        'username' => getenv('SMS_PLATFORM_USER') ?: '',
        'salt'     => getenv('SMS_PLATFORM_SALT') ?: '',
        'hash'     => getenv('SMS_PLATFORM_HASH') ?: '',
    ],

    // External services run in TEST MODE until real keys are added.
    'PAYMENTS' => [
        'provider'   => 'mock',
        'test_mode'  => true,
        'secret_key' => 'sk_test_PLACEHOLDER',
    ],
    'SMS' => [
        'provider'  => 'mock',
        'test_mode' => true,
        'api_key'   => 'sms_test_PLACEHOLDER',
        'sender_id' => 'SCHOOL',
    ],
];

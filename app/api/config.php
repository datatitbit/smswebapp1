<?php
/* ============================================================
 * config.php — environment configuration for the REST API.
 * Development: SQLite (zero setup). Production (cPanel): MySQL.
 * Switch by setting DB_DRIVER to 'sqlite' or 'mysql'.
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

    // One install = one school. This is its tenant id — change it to something
    // unique per client install (e.g. 'sch-<clientslug>') before going live;
    // never reuse 'sch-1' across two real schools sharing infrastructure.
    'SCHOOL_ID' => getenv('SMS_SCHOOL_ID') ?: 'sch-1',

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

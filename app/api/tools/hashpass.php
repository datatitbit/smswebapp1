<?php
/* ============================================================
 * tools/hashpass.php — generate a PBKDF2 salt+hash for a password.
 * Used to create the platform super-admin credentials (config.php
 * PLATFORM_ADMIN). Produces the SAME format the app stores for users.
 *
 * Usage (CLI):
 *   php tools/hashpass.php "YourStrongPassword"
 *
 * Then set the printed values as environment variables (or paste into
 * config.php): SMS_PLATFORM_USER, SMS_PLATFORM_SALT, SMS_PLATFORM_HASH.
 * ============================================================ */

require __DIR__ . '/../auth.php';

$pw = $argv[1] ?? null;
if ($pw === null || $pw === '') {
    fwrite(STDERR, "Usage: php tools/hashpass.php \"<password>\"\n");
    exit(1);
}
$salt = bin2hex(random_bytes(16));
$hash = pbkdf2_hex($pw, $salt);
echo "salt=$salt\n";
echo "hash=$hash\n";

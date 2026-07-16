/* ============================================================
 * auth-lib.js — password hashing for user login accounts.
 * Dependency-free. Uses the browser's built-in WebCrypto PBKDF2
 * (SHA-256, 100,000 iterations) — no plaintext passwords are ever
 * stored. This protects against casual inspection of the local
 * database; it is NOT a substitute for server-side auth once a
 * real backend is deployed (see README "Known limitations").
 * ============================================================ */
(function (global) {
  'use strict';

  var ITERATIONS = 100000;
  var KEY_LEN_BITS = 256;

  function bytesToHex(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) { var h = bytes[i].toString(16); s += h.length < 2 ? '0' + h : h; }
    return s;
  }
  function hexToBytes(hex) {
    hex = String(hex || '');
    var out = new Uint8Array(hex.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function randomSaltHex() {
    var b = new Uint8Array(16);
    global.crypto.getRandomValues(b);
    return bytesToHex(b);
  }
  function textBytes(s) {
    if (global.TextEncoder) return new global.TextEncoder().encode(s);
    var b = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff; return b;
  }

  function deriveHex(password, saltHex) {
    return global.crypto.subtle.importKey('raw', textBytes(password), { name: 'PBKDF2' }, false, ['deriveBits'])
      .then(function (keyMaterial) {
        return global.crypto.subtle.deriveBits(
          { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations: ITERATIONS, hash: 'SHA-256' },
          keyMaterial, KEY_LEN_BITS
        );
      })
      .then(function (bits) { return bytesToHex(new Uint8Array(bits)); });
  }

  // hashPassword(password) -> Promise<{salt, hash}>  (for setting/resetting a password)
  function hashPassword(password) {
    var salt = randomSaltHex();
    return deriveHex(password, salt).then(function (hash) { return { salt: salt, hash: hash }; });
  }

  // verifyPassword(password, salt, hash) -> Promise<boolean>
  function verifyPassword(password, salt, hash) {
    if (!salt || !hash) return Promise.resolve(false);
    return deriveHex(password, salt).then(function (computed) { return computed === hash; })
      .catch(function () { return false; });
  }

  global.Auth = { hashPassword: hashPassword, verifyPassword: verifyPassword };
})(window);

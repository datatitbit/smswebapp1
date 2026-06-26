/* ============================================================
 * services.js — external service stubs behind a clean interface.
 * Payments (MoMo / Paystack) and SMS are MOCK / TEST-MODE only.
 * Real providers plug in later by changing config (no screen change).
 * NEVER put real API keys here.
 * ============================================================ */
(function (global) {
  'use strict';

  var CONFIG = {
    payments: {
      provider: 'mock',                 // 'mock' | 'paystack' | 'momo'
      test_mode: true,
      public_key: 'pk_test_PLACEHOLDER', // PLACEHOLDER — replace at go-live
      secret_key: 'sk_test_PLACEHOLDER'  // PLACEHOLDER — server-side only in production
    },
    sms: {
      provider: 'mock',                 // 'mock' | 'arkesel' | 'hubtel' | 'mnotify'
      test_mode: true,
      sender_id: 'SCHOOL',
      api_key: 'sms_test_PLACEHOLDER'    // PLACEHOLDER — replace at go-live
    }
  };

  // ---- Payment gateway (mock) ----
  var Payments = {
    config: CONFIG.payments,
    // Returns a fake successful charge after a short delay.
    charge: function (opts) {
      // opts: { amount, currency, method, phone, email, reference }
      return new Promise(function (resolve) {
        setTimeout(function () {
          resolve({
            ok: true,
            test_mode: true,
            provider: CONFIG.payments.provider,
            reference: opts.reference || ('TEST-' + Date.now()),
            channel: opts.method || 'mobile_money',
            amount: opts.amount,
            currency: opts.currency || 'GHS',
            message: 'TEST MODE: payment simulated as successful. No real money moved.'
          });
        }, 500);
      });
    }
  };

  // ---- SMS gateway (mock) ----
  var SMS = {
    config: CONFIG.sms,
    sent: [], // in-memory log of simulated sends
    send: function (to, body) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var rec = { to: to, body: body, at: new Date().toISOString(),
            provider: CONFIG.sms.provider, test_mode: true, status: 'simulated' };
          SMS.sent.push(rec);
          resolve(rec);
        }, 150);
      });
    },
    sendBulk: function (list) {
      // list: [{to, body}]
      return Promise.all(list.map(function (m) { return SMS.send(m.to, m.body); }));
    }
  };

  global.Services = { config: CONFIG, Payments: Payments, SMS: SMS };
})(window);

<?php
/* ============================================================
 * services-stub.php — server-side TEST-MODE stubs for the
 * external services. No real keys, no real charges/sends.
 * Swap the bodies for real provider calls at go-live; the
 * front end and API contract stay identical.
 * ============================================================ */

function svc_payment_charge($cfg, $req) {
    // $req: amount, currency, method, phone, email, reference
    // TODO at go-live: call Paystack/MoMo with $cfg['PAYMENTS']['secret_key'].
    return [
        'ok'        => true,
        'test_mode' => true,
        'provider'  => $cfg['PAYMENTS']['provider'],
        'reference' => $req['reference'] ?? ('TEST-' . time()),
        'channel'   => $req['method'] ?? 'mobile_money',
        'amount'    => $req['amount'] ?? 0,
        'currency'  => $req['currency'] ?? 'GHS',
        'message'   => 'TEST MODE: payment simulated as successful. No real money moved.',
    ];
}

function svc_sms_send($cfg, $req) {
    // $req: to, body
    // TODO at go-live: POST to Arkesel/Hubtel/mNotify with $cfg['SMS']['api_key'].
    return [
        'to'        => $req['to'] ?? '',
        'body'      => $req['body'] ?? '',
        'provider'  => $cfg['SMS']['provider'],
        'sender_id' => $cfg['SMS']['sender_id'],
        'test_mode' => true,
        'status'    => 'simulated',
        'at'        => date('c'),
    ];
}

/* ============================================================
 * subscription.js — Admin: subscription status, plans & licence activation.
 * Reads state from License (license-lib.js). Admin-only (router-gated).
 * ============================================================ */
(function (global) {
  'use strict';
  var U = global.U, DB = global.DB, App = global.App, L = global.License;
  var el = U.el;

  function info(l, v) { return el('div', {}, [el('div', { class: 'muted', style: 'font-size:.75rem', text: l }), el('div', { style: 'font-weight:600', text: v })]); }

  function render(container) {
    U.clear(container);
    container.appendChild(el('div', { class: 'page-head' }, [el('h1', { text: 'Subscription & Licence' })]));
    if (!App.user || App.user.role !== 'Admin') { container.appendChild(el('div', { class: 'empty', text: 'Only the Administrator can manage the subscription.' })); return; }
    if (!L) { container.appendChild(el('div', { class: 'empty', text: 'Licensing module not loaded.' })); return; }

    L.resolve().then(function (st) {
      var badge = st.state === 'active' ? ['Active', '#0f5e5e'] : (st.state === 'trialing' ? ['Free trial', '#c99a2e'] : ['Expired', '#b91c1c']);
      var s = el('div', { class: 'card' }, [
        el('div', { class: 'flex', style: 'justify-content:space-between;flex-wrap:wrap;gap:.5rem;align-items:center' }, [
          el('h3', { text: 'Status' }),
          el('span', { class: 'tag', style: 'background:' + badge[1] + ';color:#fff', text: badge[0] })
        ]),
        el('div', { class: 'grid cols-3' }, [
          info('Plan', st.planLabel || '—'),
          info(st.trial ? 'Trial ends' : 'Renews', st.expires || '—'),
          info('Days remaining', (st.daysLeft >= 0 ? st.daysLeft : 0) + '')
        ])
      ]);
      if (st.school) s.appendChild(el('div', { class: 'help', text: 'Licensed to: ' + st.school }));
      if (st.state === 'expired') s.appendChild(el('div', { class: 'note', style: 'background:#fde8e8;color:#8a1c1c', text: 'The app is currently read-only. Enter a valid licence key below to unlock editing. Your data is safe and can still be viewed and exported.' }));
      container.appendChild(s);

      var pr = el('div', { class: 'card' }, [el('h3', { text: 'Plans (' + L.CURRENCY + ')' })]);
      var t = el('table', { class: 'data' });
      t.appendChild(el('thead', {}, [el('tr', {}, ['Plan', 'Up to', 'Per term', 'Per year (3 terms)'].map(function (h) { return el('th', { text: h }); }))]));
      var tb = el('tbody');
      Object.keys(L.PLANS).forEach(function (k) {
        var p = L.PLANS[k];
        tb.appendChild(el('tr', {}, [el('td', { text: p.label }), el('td', { text: p.max >= 100000 ? 'unlimited' : (p.max + ' students') }), el('td', { text: L.CURRENCY + ' ' + p.term }), el('td', { text: L.CURRENCY + ' ' + p.year })]));
      });
      t.appendChild(tb); pr.appendChild(el('div', { class: 'table-wrap' }, [t]));
      pr.appendChild(el('div', { class: 'help', text: 'Every plan includes a 30-day free trial. Add-ons: bulk SMS credits and online fee payment. Prices are a guide and can be adjusted.' }));
      container.appendChild(pr);

      if (st.source !== 'key') {
        var trCard = el('div', { class: 'card' }, [el('h3', { text: 'Free trial settings' })]);
        trCard.appendChild(el('div', { class: 'help', text: 'Default free trial is 30 days. Extend or shorten it for this school below — this changes the trial length, not the start date, so extending an in-progress trial simply adds days.' }));
        var daysInp = el('input', { type: 'number', min: 1, max: 3650, value: st.trialDays || 30, style: 'width:120px' });
        trCard.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Trial length (days)' }), daysInp]));
        trCard.appendChild(el('div', { class: 'btn-row' }, [
          el('button', { class: 'btn gold', text: 'Save', onclick: function () {
            L.setTrialDays(daysInp.value).then(function (r) {
              if (!r.ok) return U.toast(r.error, 'err');
              U.toast('Trial length updated.'); render(container);
            });
          } }),
          el('button', { class: 'btn ghost', text: 'Reset to default (30 days)', onclick: function () {
            L.setTrialDays(null).then(function () { U.toast('Trial reset to 30 days.'); render(container); });
          } })
        ]));
        container.appendChild(trCard);
      }

      var ta = el('textarea', { rows: 3, placeholder: 'Paste licence key here…', style: 'width:100%;font-family:monospace;font-size:.8rem' });
      var ac = el('div', { class: 'card' }, [el('h3', { text: 'Activate / enter licence key' })]);
      ac.appendChild(el('div', { class: 'help', text: 'Paste the licence key sent by Zetranova. To request a key or a free-trial extension, quote your school name below.' }));
      ac.appendChild(el('div', { class: 'field' }, [el('label', { text: 'School name (as registered)' }), el('input', { type: 'text', value: (App.ctx.school && App.ctx.school.name) || '', readonly: 'readonly', style: 'width:100%' })]));
      ac.appendChild(el('div', { class: 'field' }, [el('label', { text: 'Licence key' }), ta]));
      ac.appendChild(el('div', { class: 'btn-row' }, [
        el('button', { class: 'btn gold', text: 'Activate', onclick: function () {
          var key = ta.value.trim(); if (!key) return U.toast('Paste a key first.', 'err');
          L.activate(key).then(function (r) { if (!r.ok) { U.toast(r.error, 'err'); return; } U.toast('Licence activated — reloading…'); setTimeout(function () { location.reload(); }, 700); });
        } }),
        (st.source === 'key' ? el('button', { class: 'btn ghost', text: 'Remove key (revert to trial)', onclick: function () { U.confirm('Remove the current licence key?', function () { L.deactivate().then(function () { U.toast('Removed — reloading…'); setTimeout(function () { location.reload(); }, 600); }); }); } }) : null)
      ]));
      container.appendChild(ac);
    });
  }

  global.Views = global.Views || {};
  global.Views.subscription = { title: 'Subscription', render: render };
})(window);

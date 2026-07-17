/* ============================================================
 * store.js — Clean swappable data-access layer.
 * Screens ONLY ever call DB.* — never localStorage or fetch directly.
 * Two adapters implement the same async interface:
 *   - LocalAdapter : browser localStorage (default; runs with no server)
 *   - ApiAdapter   : PHP/MySQL REST API (set DB_CONFIG.useApi = true)
 * Swapping backend = flip one flag. No screen changes.
 * ============================================================ */
(function (global) {
  'use strict';

  var DB_CONFIG = global.DB_CONFIG || { useApi: false, apiBase: 'api/index.php' };

  // Collections that are single objects (one per school) vs arrays.
  var SINGLETONS = ['school', 'academic', 'idRules', 'admissionFields', 'weighting', 'labels', 'payrollSettings', 'automation', 'inventorySettings'];
  var SPECIAL = ['reportTemplates', 'permissions']; // arrays/objects handled normally

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------------- LocalAdapter ---------------- */
  function LocalAdapter() {
    this.key = 'sms_db_v2';
  }
  LocalAdapter.prototype._read = function () {
    var raw = localStorage.getItem(this.key);
    if (!raw) { this._write(clone(global.SMS_SEED)); raw = localStorage.getItem(this.key); }
    try {
      return JSON.parse(raw);
    } catch (e) {
      console.error('sms_db_v2 was corrupted; restoring Ghana defaults.', e);
      this._write(clone(global.SMS_SEED));
      return JSON.parse(localStorage.getItem(this.key));
    }
  };
  LocalAdapter.prototype._write = function (data) {
    try {
      localStorage.setItem(this.key, JSON.stringify(data));
    } catch (e) {
      if (global.U && global.U.toast) global.U.toast('Could not save: browser storage is full. Export your data (Settings → Data) and free up space.', 'err');
      throw e;
    }
  };
  LocalAdapter.prototype.reset = function () {
    localStorage.removeItem(this.key); this._read(); return Promise.resolve(true);
  };
  LocalAdapter.prototype.exportAll = function () { return Promise.resolve(this._read()); };
  LocalAdapter.prototype.importAll = function (data) { this._write(data); return Promise.resolve(true); };

  LocalAdapter.prototype.all = function (coll) {
    var d = this._read(); return Promise.resolve(clone(d[coll] || []));
  };
  LocalAdapter.prototype.get = function (coll, id) {
    var d = this._read(), arr = d[coll] || [];
    var f = arr.filter(function (x) { return x.id === id; })[0];
    return Promise.resolve(f ? clone(f) : null);
  };
  LocalAdapter.prototype.insert = function (coll, obj) {
    var d = this._read(); if (!d[coll]) d[coll] = [];
    if (!obj.id) obj.id = uid(coll);
    if (!obj.school_id) obj.school_id = global.SMS_SEED.constants.SCHOOL_ID;
    d[coll].push(obj); this._write(d); return Promise.resolve(clone(obj));
  };
  LocalAdapter.prototype.update = function (coll, id, patch) {
    var d = this._read(), arr = d[coll] || [], out = null;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === id) { arr[i] = Object.assign({}, arr[i], patch); out = arr[i]; break; }
    }
    this._write(d); return Promise.resolve(out ? clone(out) : null);
  };
  LocalAdapter.prototype.remove = function (coll, id) {
    var d = this._read(); d[coll] = (d[coll] || []).filter(function (x) { return x.id !== id; });
    this._write(d); return Promise.resolve(true);
  };
  LocalAdapter.prototype.replaceAll = function (coll, arr) {
    var d = this._read(); d[coll] = arr; this._write(d); return Promise.resolve(clone(arr));
  };
  LocalAdapter.prototype.getSingleton = function (name) {
    var d = this._read(); return Promise.resolve(clone(d[name] || null));
  };
  LocalAdapter.prototype.setSingleton = function (name, obj) {
    var d = this._read(); d[name] = obj; this._write(d); return Promise.resolve(clone(obj));
  };
  LocalAdapter.prototype.nextSeq = function (kind) {
    var d = this._read(); d.meta = d.meta || { seq: {} };
    d.meta.seq[kind] = (d.meta.seq[kind] || 0) + 1; this._write(d);
    return Promise.resolve(d.meta.seq[kind]);
  };

  /* ---------------- ApiAdapter (PHP/MySQL) ---------------- */
  function ApiAdapter(base) { this.base = base; }
  ApiAdapter.prototype._req = function (method, path, body) {
    var opts = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    return fetch(this.base + '?r=' + encodeURIComponent(path), opts).then(function (r) {
      if (!r.ok) throw new Error('API request failed (' + r.status + '): ' + path);
      return r.json();
    }).catch(function (e) {
      if (global.U && global.U.toast) global.U.toast('Network/API error — check your connection.', 'err');
      throw e;
    });
  };
  ApiAdapter.prototype.all = function (coll) { return this._req('GET', coll); };
  ApiAdapter.prototype.get = function (coll, id) { return this._req('GET', coll + '/' + id); };
  ApiAdapter.prototype.insert = function (coll, obj) { return this._req('POST', coll, obj); };
  ApiAdapter.prototype.update = function (coll, id, patch) { return this._req('PUT', coll + '/' + id, patch); };
  ApiAdapter.prototype.remove = function (coll, id) { return this._req('DELETE', coll + '/' + id); };
  ApiAdapter.prototype.replaceAll = function (coll, arr) { return this._req('PUT', coll, { replace: arr }); };
  ApiAdapter.prototype.getSingleton = function (name) { return this._req('GET', 'singleton/' + name); };
  ApiAdapter.prototype.setSingleton = function (name, obj) { return this._req('PUT', 'singleton/' + name, obj); };
  ApiAdapter.prototype.nextSeq = function (kind) { return this._req('POST', 'seq/' + kind, {}); };
  ApiAdapter.prototype.exportAll = function () { return this._req('GET', 'export'); };
  ApiAdapter.prototype.importAll = function (data) { return this._req('PUT', 'import', data); };
  ApiAdapter.prototype.reset = function () { return this._req('POST', 'reset', {}); };

  var adapter = DB_CONFIG.useApi ? new ApiAdapter(DB_CONFIG.apiBase) : new LocalAdapter();

  // ---- Public facade. The whole app talks only to DB.* ----
  var DB = {
    config: DB_CONFIG,
    isApi: !!DB_CONFIG.useApi,
    uid: uid,
    SINGLETONS: SINGLETONS,

    all: function (c) { return adapter.all(c); },
    get: function (c, id) { return adapter.get(c, id); },
    insert: function (c, o) { return adapter.insert(c, o); },
    update: function (c, id, p) { return adapter.update(c, id, p); },
    remove: function (c, id) { return adapter.remove(c, id); },
    replaceAll: function (c, a) { return adapter.replaceAll(c, a); },
    singleton: function (n) { return adapter.getSingleton(n); },
    setSingleton: function (n, o) { return adapter.setSingleton(n, o); },
    nextSeq: function (k) { return adapter.nextSeq(k); },
    exportAll: function () { return adapter.exportAll(); },
    importAll: function (d) { return adapter.importAll(d); },
    reset: function () { return adapter.reset(); },

    // Convenience: find within a collection
    find: function (coll, pred) {
      return adapter.all(coll).then(function (arr) { return arr.filter(pred); });
    },

    // Generate next ST/SF code, e.g. ST0001
    nextCode: function (kind, prefix, digits) {
      return adapter.nextSeq(kind).then(function (n) {
        var s = '' + n; while (s.length < digits) s = '0' + s;
        return prefix + s;
      });
    }
  };

  global.DB = DB;
})(window);

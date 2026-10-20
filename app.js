/* Rowbin: cozy, ad-free knitting & crochet row counter.
 * Everything runs on the device: localStorage for counts/settings (written on every tap),
 * IndexedDB for photos and pattern files. No network requests, no trackers. */
(function () {
  'use strict';
  var C = window.ROWBIN_CONFIG || {};
  var FREE_LIMIT = C.FREE_PROJECT_LIMIT || 2;
  var FREE_EXTRA_COUNTERS = 1;
  var KEY = 'rowbin:v1';
  var KEY_BAK = 'rowbin:v1:launch-backup';
  var SCHEMA = 1;
  var app = document.getElementById('app');
  var sheetRoot = document.getElementById('sheet-root');

  /* ---------------- utilities ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function fmtClock(t) { try { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } }
  function fmtDay(t) {
    var d = new Date(t), today = new Date(); var y = new Date(); y.setDate(today.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }
  function fmtDur(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }
  function daysAgo(t) { return Math.floor((Date.now() - t) / 86400000); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  var ICONS = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>',
    undo: '<svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };

  /* ---------------- state ---------------- */
  function defaultSettings() {
    return { theme: 'oat', haptics: true, tapAnywhere: false, locked: false, keepAwake: false, tipsSeen: false,
      installDismissed: false, license: null, lastBackup: null, lastProjectId: null, persisted: null, createdAt: Date.now() };
  }
  function newProject(name, craft) {
    return { id: uid(), name: name || 'My project', craft: craft || 'knit', rows: 0, target: null, notes: '',
      hasPhoto: false, pattern: null, counters: [], reminders: [], undo: [], log: [],
      timer: { totalMs: 0, runningSince: null, sessions: [] }, createdAt: Date.now(), updatedAt: Date.now() };
  }
  function migrate(s) {
    if (!s || typeof s !== 'object') s = {};
    s.v = SCHEMA;
    s.settings = Object.assign(defaultSettings(), s.settings || {});
    // Licenses from the old honor-system build (no source) are dropped; dev unlocks only count while DEV_MODE is on.
    var L = s.settings.license;
    if (L && L.ok && (!L.source || (L.source === 'dev' && !C.DEV_MODE))) s.settings.license = null;
    if (!Array.isArray(s.projects)) s.projects = [];
    s.projects = s.projects.filter(function (p) { return p && typeof p === 'object'; }).map(function (p) {
      var out = Object.assign(newProject(p.name, p.craft), p);
      out.id = p.id || uid();
      out.rows = Math.max(0, parseInt(out.rows, 10) || 0);
      out.counters = (Array.isArray(out.counters) ? out.counters : []).map(function (c) {
        return Object.assign({ id: uid(), name: 'Counter', value: 0, linked: true, resetAt: null, repeats: 0, repeatTarget: null }, c);
      });
      out.reminders = Array.isArray(out.reminders) ? out.reminders : [];
      out.undo = Array.isArray(out.undo) ? out.undo.slice(-100) : [];
      out.log = Array.isArray(out.log) ? out.log.slice(-500) : [];
      out.timer = Object.assign({ totalMs: 0, runningSince: null, sessions: [] }, out.timer || {});
      return out;
    });
    return s;
  }
  function load() {
    var raw = null, s = null;
    try { raw = localStorage.getItem(KEY); s = raw ? JSON.parse(raw) : null; } catch (e) { s = null; }
    if (raw && !s) { try { s = JSON.parse(localStorage.getItem(KEY_BAK)); } catch (e) { s = null; } }
    s = migrate(s);
    try { if (raw && s) localStorage.setItem(KEY_BAK, JSON.stringify(s)); } catch (e) {}
    return s;
  }
  var S = load();
  var saveFailedShown = false;
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { if (!saveFailedShown) { saveFailedShown = true; toast('Storage is full. Remove a photo or pattern so counts can save.', 5000); } }
  }
  function proj(id) { for (var i = 0; i < S.projects.length; i++) if (S.projects[i].id === id) return S.projects[i]; return null; }

  /* ---------------- IndexedDB (photos & patterns) ---------------- */
  var dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (res, rej) {
      var r = indexedDB.open('rowbin', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('files'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
    return dbp;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (res, rej) {
        var tx = d.transaction('files', mode), st = tx.objectStore('files'), out;
        var req = fn(st);
        if (req) req.onsuccess = function () { out = req.result; };
        tx.oncomplete = function () { res(out); };
        tx.onerror = tx.onabort = function () { rej(tx.error); };
      });
    });
  }
  function fileGet(k) { return idb('readonly', function (s) { return s.get(k); }); }
  function filePut(k, v) { return idb('readwrite', function (s) { return s.put(v, k); }); }
  function fileDel(k) { return idb('readwrite', function (s) { return s.delete(k); }); }
  function fileKeys() { return idb('readonly', function (s) { return s.getAllKeys(); }); }
  var urlCache = {};
  function fileURL(k) {
    if (urlCache[k]) return Promise.resolve(urlCache[k]);
    return fileGet(k).then(function (b) { if (!b) return null; urlCache[k] = URL.createObjectURL(b); return urlCache[k]; });
  }
  function dropURL(k) { if (urlCache[k]) { URL.revokeObjectURL(urlCache[k]); delete urlCache[k]; } }

  /* ---------------- feedback ---------------- */
  var toastTimer;
  function toast(msg, ms) {
    var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2200);
  }
  function haptic(kind) {
    if (!S.settings.haptics) return;
    try {
      if (navigator.vibrate) { navigator.vibrate(kind === 'strong' ? [40, 60, 40] : kind === 'soft' ? 8 : 14); return; }
      var l = document.getElementById('hx-label'); if (l) l.click(); // iOS 18+ Safari switch haptic
    } catch (e) {}
  }

  /* ---------------- Pro / license key ---------------- */
  function maskKey(k) { k = String(k || ''); return k.length > 8 ? k.slice(0, 4) + '…' + k.slice(-4) : k; }
  function isPro() { return !!(S.settings.license && S.settings.license.ok); }
  function normCode(c) { return String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function sha256Hex(str) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }
    return Promise.resolve(sha256Fallback(str));
  }
  function sha256Fallback(ascii) { // small pure-JS SHA-256 for non-secure (http) contexts
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    var mp = Math.pow, max = mp(2, 32), result = '', words = [], hash = [], k = [], pc = 0, isC = {}, i, j;
    for (var cand = 2; pc < 64; cand++) { if (!isC[cand]) { for (i = 0; i < 313; i += cand) isC[i] = cand; hash[pc] = (mp(cand, .5) * max) | 0; k[pc++] = (mp(cand, 1 / 3) * max) | 0; } }
    hash = hash.slice(0, 8);
    ascii = unescape(encodeURIComponent(ascii)); var bl = ascii.length * 8;
    ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
    for (i = 0; i < ascii.length; i++) { j = ascii.charCodeAt(i); words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((bl / max) | 0); words[words.length] = (bl);
    for (j = 0; j < words.length;) {
      var w = words.slice(j, j += 16), oh = hash; hash = hash.slice(0, 8);
      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2], a = hash[0], e = hash[4];
        var t1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] +
          (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        var t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(t1 + t2) | 0].concat(hash); hash[4] = (hash[4] + t1) | 0;
      }
      for (i = 0; i < 8; i++) hash[i] = (hash[i] + oh[i]) | 0;
    }
    for (i = 0; i < 8; i++) for (j = 3; j + 1; j--) { var b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }
  /* Gumroad per-buyer license keys: verified online once at unlock, then stored locally so Pro works offline.
   * Result: { ok: bool, msg: string } */
  function deviceId() {
    if (!S.settings.deviceId) { S.settings.deviceId = uid() + uid(); save(); }
    return S.settings.deviceId;
  }
  function supportLine() { return C.SUPPORT_EMAIL ? ' Contact ' + C.SUPPORT_EMAIL + ' for help.' : ''; }
  function gumroadVerify(key, increment) {
    var body = new URLSearchParams();
    body.set('product_id', C.GUMROAD_PRODUCT_ID || '');
    body.set('license_key', key);
    body.set('increment_uses_count', increment ? 'true' : 'false');
    var ctrl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 15000);
    return fetch(C.LICENSE_VERIFY_URL || 'https://api.gumroad.com/v2/licenses/verify', { method: 'POST', body: body, signal: ctrl ? ctrl.signal : undefined, cache: 'no-store' })
      .then(function (r) { clearTimeout(to); return r.json().catch(function () { return { success: false, message: 'Unexpected reply from Gumroad (HTTP ' + r.status + ').', _http: r.status }; }).then(function (j) { j._http = r.status; return j; }); })
      .catch(function (e) { clearTimeout(to); return { _network: true, message: String(e && e.message || e) }; });
  }
  // Interpret a Gumroad verify response. Returns { state: 'valid'|'revoked'|'invalid'|'network', msg, uses }
  function judge(j) {
    if (!j || j._network) return { state: 'network', msg: 'Couldn’t reach Gumroad. Connect to the internet once to activate your key, then Pro works offline.' };
    if (!j.success) {
      if (j._http >= 500) return { state: 'network', msg: 'Gumroad is having trouble right now. Please try again in a few minutes.' };
      var m = String(j.message || 'That license key wasn’t recognized.');
      var disabled = /disabled|revoked/i.test(m);
      return { state: disabled ? 'revoked' : 'invalid', msg: (disabled ? 'This license key has been disabled.' : 'That key wasn’t recognized for Rowbin Pro. Check it against your Gumroad receipt.') + supportLine() };
    }
    var pu = j.purchase || {};
    if (pu.refunded) return { state: 'revoked', msg: 'This purchase was refunded, so the key no longer unlocks Pro.' + supportLine() };
    if (pu.chargebacked || (pu.disputed && !pu.dispute_won)) return { state: 'revoked', msg: 'This purchase was disputed or charged back, so the key no longer unlocks Pro.' + supportLine() };
    if (pu.subscription_ended_at || pu.subscription_cancelled_at || pu.subscription_failed_at) return { state: 'revoked', msg: 'This purchase is no longer active.' + supportLine() };
    if (C.GUMROAD_PRODUCT_ID && pu.product_id && pu.product_id !== C.GUMROAD_PRODUCT_ID) return { state: 'invalid', msg: 'That key belongs to a different product.' };
    // Note: purchase.test (the seller's own test purchase) is intentionally accepted.
    return { state: 'valid', uses: typeof j.uses === 'number' ? j.uses : null, sale: pu.sale_id || pu.id || null, test: !!pu.test };
  }
  function devUnlock(n) {
    if (!C.DEV_MODE) return Promise.resolve(false);
    return sha256Hex('rowbin:' + n).then(function (h) {
      return (C.DEV_UNLOCK_CODE_SHA256 || []).map(function (x) { return String(x).toLowerCase(); }).indexOf(h) !== -1;
    });
  }
  function tryUnlock(code) {
    var key = String(code || '').trim();
    var n = normCode(key);
    if (n.length < 4) return Promise.resolve({ ok: false, msg: 'Please enter your license key.' });
    return devUnlock(n).then(function (isDev) {
      if (isDev) {
        S.settings.license = { ok: true, key: key.toUpperCase(), at: Date.now(), source: 'dev', verifiedAt: Date.now() };
        save(); applyTheme(); return { ok: true, msg: 'Dev unlock (DEV_MODE is on).' };
      }
      if (!C.GUMROAD_PRODUCT_ID) return { ok: false, msg: 'Pro purchases aren’t set up yet. Please check back soon.' };
      if (navigator.onLine === false) return { ok: false, msg: 'You’re offline. Connect to the internet once to activate your key; after that Pro works offline.' };
      var cur = S.settings.license;
      // Re-entering the same key on this device doesn't use up another activation.
      var sameDevice = cur && cur.ok && cur.source === 'gumroad' && normCode(cur.key) === n;
      return gumroadVerify(key, !sameDevice).then(function (j) {
        var r = judge(j);
        if (r.state !== 'valid') {
          if (r.state === 'revoked' && sameDevice) { S.settings.license = null; save(); applyTheme(); }
          return { ok: false, msg: r.msg };
        }
        var max = C.MAX_ACTIVATIONS || 0;
        if (!sameDevice && max && r.uses !== null && r.uses > max) {
          return { ok: false, msg: 'This key has already been activated on ' + r.uses + ' devices (limit ' + max + '). If you got a new phone, ' + (C.SUPPORT_EMAIL ? 'email ' + C.SUPPORT_EMAIL + ' and we’ll reset it.' : 'contact the seller through your Gumroad receipt to reset it.') };
        }
        S.settings.license = { ok: true, key: key.toUpperCase(), at: (sameDevice && cur.at) || Date.now(), source: 'gumroad', verifiedAt: Date.now(), uses: r.uses, sale: r.sale, device: deviceId() };
        save(); applyTheme();
        var warn = (max && r.uses !== null && r.uses >= max - 1 && !sameDevice) ? ' Note: this key has now been used on ' + r.uses + ' of ' + max + ' allowed devices.' : '';
        return { ok: true, msg: (sameDevice ? 'Key re-checked. Pro is active.' : 'Pro unlocked. Thank you! 🧶') + warn };
      });
    });
  }
  // Quiet periodic re-check (when online) so refunded/charged-back/disabled keys stop working.
  // Network problems never remove Pro.
  function recheckLicense() {
    var L = S.settings.license, days = C.RECHECK_DAYS;
    if (!L || !L.ok || L.source !== 'gumroad' || !days || !C.GUMROAD_PRODUCT_ID || navigator.onLine === false) return Promise.resolve(null);
    if (L.verifiedAt && Date.now() - L.verifiedAt < days * 86400000) return Promise.resolve(null);
    return gumroadVerify(L.key, false).then(function (j) {
      var r = judge(j);
      if (r.state === 'valid') { L.verifiedAt = Date.now(); if (r.uses !== null) L.uses = r.uses; save(); }
      else if (r.state === 'revoked') { S.settings.license = { ok: false, key: L.key, revokedAt: Date.now(), reason: r.msg }; save(); applyTheme(); render(); toast(r.msg, 6000); }
      return r.state;
    });
  }

  /* ---------------- theme ---------------- */
  var THEMES = [
    { id: 'oat', name: 'Oatmeal', sw: '#B5523B', bg: '#FBF6EF' },
    { id: 'night', name: 'Night Owl (dark)', sw: '#E58A6F', bg: '#1B1917' },
    { id: 'sage', name: 'Sage', sw: '#4F7A5A', bg: '#F2F5EF' },
    { id: 'berry', name: 'Berry', sw: '#9C3D6B', bg: '#FAF3F6' },
    { id: 'ocean', name: 'Ocean', sw: '#2F6690', bg: '#F1F5F8' }
  ];
  function applyTheme() {
    var t = isPro() ? S.settings.theme : 'oat';
    document.documentElement.setAttribute('data-theme', t);
    var th = THEMES.filter(function (x) { return x.id === t; })[0] || THEMES[0];
    var m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', th.bg);
  }

  /* ---------------- wake lock ---------------- */
  var wakeLock = null, wantWake = false;
  function setWake(on) {
    wantWake = on;
    if (!('wakeLock' in navigator)) return Promise.resolve(false);
    if (!on) { if (wakeLock) { try { wakeLock.release(); } catch (e) {} } wakeLock = null; return Promise.resolve(true); }
    if (wakeLock) return Promise.resolve(true);
    return navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l; l.addEventListener('release', function () { wakeLock = null; }); return true;
    }).catch(function () { return false; });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && wantWake && !wakeLock) setWake(true);
    if (document.visibilityState === 'visible' && current.view === 'project') renderTimerOnly();
  });

  /* ---------------- install / persistence ---------------- */
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; });
  window.addEventListener('appinstalled', function () { S.settings.installDismissed = true; save(); requestPersist(); });
  function isStandalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function isIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function requestPersist() {
    if (!(navigator.storage && navigator.storage.persist)) return Promise.resolve(null);
    return navigator.storage.persisted().then(function (p) { return p || navigator.storage.persist(); })
      .then(function (p) { S.settings.persisted = !!p; save(); return p; }).catch(function () { return null; });
  }

  /* ---------------- sheets ---------------- */
  function openSheet(html, onMount, opts) {
    closeSheet();
    var wrap = document.createElement('div');
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>' + html + '</div>';
    wrap.addEventListener('click', function (e) { if (e.target === wrap) closeSheet(); });
    sheetRoot.appendChild(wrap);
    var first = wrap.querySelector('input[type=text],textarea');
    if (first && !(opts && opts.noFocus)) setTimeout(function () { try { first.focus({ preventScroll: true }); } catch (e) {} }, 50);
    if (onMount) onMount(wrap.firstChild, closeSheet);
    return closeSheet;
  }
  function closeSheet() { sheetRoot.innerHTML = ''; }
  function confirmSheet(title, body, okLabel) {
    return new Promise(function (res) {
      openSheet('<h2>' + esc(title) + '</h2><p class="muted">' + esc(body) + '</p><div class="row"><button class="btn grow" data-x="no">Cancel</button><button class="btn grow primary" data-x="yes">' + esc(okLabel || 'OK') + '</button></div>',
        function (el, close) {
          el.addEventListener('click', function (e) {
            var b = e.target.closest('[data-x]'); if (!b) return; close(); res(b.getAttribute('data-x') === 'yes');
          });
        }, { noFocus: true });
    });
  }
  var PRICE = esc(C.PRO_PRICE || '$14.99');
  var PRICE_NOTE = esc(C.PRO_PRICE_NOTE || 'One-time purchase, no subscription');
  function proFeatureList() {
    return '<ul class="small" style="padding-left:20px;margin:6px 0">' +
      '<li>Unlimited projects (free: ' + FREE_LIMIT + ')</li>' +
      '<li>Unlimited extra & repeat counters (free: ' + FREE_EXTRA_COUNTERS + ' per project)</li>' +
      '<li>"Every N rows" reminders</li>' +
      '<li>Pattern viewer for PDFs & photos with a movable line highlighter</li>' +
      '<li>Project timer that keeps running when the app is closed (editable)</li>' +
      '<li>Themes, including a dark mode</li></ul>';
  }
  function freeForeverList() {
    return '<ul class="small" style="padding-left:20px;margin:6px 0">' +
      '<li>The big row counter, with undo, reset and a full history log</li>' +
      '<li>' + FREE_LIMIT + ' projects with notes and a photo</li>' +
      '<li>' + FREE_EXTRA_COUNTERS + ' extra/repeat counter per project</li>' +
      '<li>Backup export & import</li>' +
      '<li>Keep-screen-on, lock and haptics</li>' +
      '<li>No ads, ever. Nothing free will ever move to Pro.</li></ul>';
  }
  function openPro(feature) {
    if (isPro()) return;
    var buy = C.CHECKOUT_URL
      ? '<a class="btn primary block" href="' + esc(C.CHECKOUT_URL) + '" target="_blank" rel="noopener">Buy Pro, ' + PRICE + ' one-time</a>'
      : '<button class="btn primary block" data-x="buy">Buy Pro, ' + PRICE + ' one-time</button>';
    openSheet(
      '<h2>' + (feature ? esc(feature) + ' is part of Pro' : 'Rowbin Pro') + '</h2>' +
      '<p style="margin:0 0 6px"><b>' + PRICE + ' one-time.</b> ' + PRICE_NOTE + '. No subscription and no account. It keeps working offline, forever.</p>' +
      proFeatureList() + buy +
      '<p class="small muted" style="margin:8px 0 14px">Gumroad emails you a personal license key. Enter it here once while online; after that Pro works offline. Keep the email so you can re-enter the key anytime.</p>' +
      '<label class="field"><span>Have a license key?</span><input type="text" id="lic" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"></label>' +
      '<p class="small" id="lic-msg" role="alert" style="display:none;color:var(--danger);margin:-4px 0 10px"></p>' +
      '<div class="row"><button class="btn grow" data-x="close">Not now</button><button class="btn soft grow" data-x="unlock">Unlock</button></div>',
      function (el, close) {
        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          var x = b.getAttribute('data-x');
          if (x === 'close') close();
          if (x === 'buy') toast('Checkout is coming soon. Thanks for your patience!', 3000);
          if (x === 'unlock') doUnlock($('#lic', el).value, close);
        });
        $('#lic', el).addEventListener('keydown', function (e) { if (e.key === 'Enter') doUnlock(e.target.value, close); });
      }, { noFocus: true });
  }
  var unlocking = false;
  function doUnlock(code, close) {
    if (unlocking) return; unlocking = true;
    $all('[data-x=unlock],[data-act=unlock2]').forEach(function (b) { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'Checking…'; });
    tryUnlock(code).then(function (r) {
      unlocking = false;
      $all('[data-x=unlock],[data-act=unlock2]').forEach(function (b) { b.disabled = false; if (b.dataset.label) b.textContent = b.dataset.label; });
      if (r.ok) { if (close) close(); haptic('strong'); toast(r.msg, 4000); render(); }
      else {
        haptic('soft'); toast(r.msg, 6000);
        var m = $('#lic-msg'); if (m) { m.textContent = r.msg; m.style.display = 'block'; }
      }
    });
  }

  /* ---------------- counting logic ---------------- */
  var lastTap = {};
  function debounced(key, ms) { var n = Date.now(); if (lastTap[key] && n - lastTap[key] < (ms || 200)) return true; lastTap[key] = n; return false; }
  function snapshot(p) { return { rows: p.rows, c: p.counters.map(function (c) { return [c.id, c.value, c.repeats]; }) }; }
  function pushUndo(p) { p.undo.push(snapshot(p)); if (p.undo.length > 100) p.undo.shift(); }
  function logEv(p, msg) { p.log.push({ t: Date.now(), m: msg, r: p.rows }); if (p.log.length > 500) p.log.shift(); p.updatedAt = Date.now(); }
  function bumpCounter(c, dir) {
    if (dir > 0) { c.value += 1; if (c.resetAt && c.value > c.resetAt) { c.value = 1; c.repeats += 1; } }
    else if (c.resetAt && c.value <= 1 && c.repeats > 0) { c.value = c.resetAt; c.repeats -= 1; }
    else c.value = Math.max(0, c.value - 1);
  }
  function lockedMsg() { toast('Counter is locked. Tap 🔒 Locked to unlock.'); }
  function changeRows(p, delta) {
    if (S.settings.locked) { lockedMsg(); return; }
    if (debounced((delta > 0 ? 'inc-' : 'dec-') + p.id, 220)) return;
    var from = p.rows, to = Math.max(0, from + delta);
    if (to === from) { haptic('soft'); return; }
    pushUndo(p);
    p.rows = to;
    p.counters.forEach(function (c) { if (c.linked) bumpCounter(c, delta); });
    logEv(p, 'Row ' + from + ' → ' + to);
    save();
    haptic();
    updateCounterUI(p, true);
    if (delta > 0) checkReminders(p);
    if (delta > 0 && p.target && to === p.target) { haptic('strong'); toast('🎉 You reached row ' + to + '!', 3000); }
  }
  function undo(p) {
    if (S.settings.locked) { lockedMsg(); return; }
    var s = p.undo.pop();
    if (!s) { toast('Nothing to undo'); return; }
    var from = p.rows; p.rows = s.rows;
    s.c.forEach(function (x) { var c = p.counters.filter(function (k) { return k.id === x[0]; })[0]; if (c) { c.value = x[1]; c.repeats = x[2]; } });
    logEv(p, 'Undo: row ' + from + ' → ' + p.rows);
    save(); haptic('soft'); updateCounterUI(p, true);
  }
  function setRows(p, to, why) {
    to = Math.max(0, parseInt(to, 10) || 0);
    pushUndo(p);
    var from = p.rows; p.rows = to;
    logEv(p, (why || 'Set') + ': row ' + from + ' → ' + to);
    save(); updateCounterUI(p, true);
  }
  function checkReminders(p) {
    if (!isPro()) return;
    var hits = p.reminders.filter(function (r) { return r.every > 0 && p.rows >= r.start && (p.rows - r.start) % r.every === 0; });
    if (hits.length) showReminder(p, hits.map(function (r) { return r.text; }).join(' · '));
  }
  function nextReminderText(p) {
    if (!isPro() || !p.reminders.length) return '';
    var best = null;
    p.reminders.forEach(function (r) {
      if (!(r.every > 0)) return;
      var d = p.rows < r.start ? r.start - p.rows : (r.every - ((p.rows - r.start) % r.every)) % r.every;
      if (best === null || d < best.d) best = { d: d, r: r };
    });
    if (!best) return '';
    return best.d === 0 ? '🔔 This row: ' + best.r.text : '🔔 ' + best.r.text + ' in ' + plural(best.d, 'row');
  }
  function showReminder(p, text) {
    haptic('strong');
    var old = $('.reminder-banner'); if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'reminder-banner'; el.setAttribute('role', 'alert');
    el.innerHTML = '<span style="font-size:26px">🔔</span><div class="grow">Row ' + p.rows + ': ' + esc(text) + '</div><button type="button">Got it</button>';
    el.querySelector('button').addEventListener('click', function () { el.remove(); });
    document.body.appendChild(el);
  }

  /* ---------------- timer (timestamp based: survives closing the app) ---------------- */
  function timerElapsed(p) { var t = p.timer; return t.totalMs + (t.runningSince ? Date.now() - t.runningSince : 0); }
  function timerToggle(p) {
    var t = p.timer;
    if (t.runningSince) {
      var end = Date.now(); t.totalMs += end - t.runningSince; t.sessions.push([t.runningSince, end]);
      if (t.sessions.length > 1000) t.sessions.shift();
      t.runningSince = null; logEv(p, 'Timer paused at ' + fmtDur(t.totalMs));
    } else { t.runningSince = Date.now(); logEv(p, 'Timer started'); }
    save(); haptic(); renderTimerOnly();
  }
  var tickHandle = null;
  function startTick() { stopTick(); tickHandle = setInterval(renderTimerOnly, 1000); }
  function stopTick() { if (tickHandle) clearInterval(tickHandle); tickHandle = null; }
  function renderTimerOnly() {
    var p = current.view === 'project' && proj(current.id); if (!p) return;
    var el = $('#timer-val'); if (el) el.textContent = fmtDur(timerElapsed(p));
    var b = $('#timer-btn'); if (b) b.textContent = p.timer.runningSince ? 'Pause' : 'Start';
    var chip = $('[data-act="timer-chip"]'); if (chip) chip.setAttribute('aria-pressed', p.timer.runningSince ? 'true' : 'false');
  }

  /* ---------------- photos ---------------- */
  function pickFile(accept) {
    return new Promise(function (res) {
      var i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.style.display = 'none';
      i.addEventListener('change', function () { res(i.files && i.files[0]); i.remove(); });
      document.body.appendChild(i); i.click();
    });
  }
  function downscale(file, max) {
    return new Promise(function (res) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b || file); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(file); };
      img.src = url;
    });
  }
  function setPhoto(p) {
    pickFile('image/*').then(function (f) {
      if (!f) return;
      return downscale(f, 1400).then(function (b) { return filePut('photo:' + p.id, b); }).then(function () {
        dropURL('photo:' + p.id); p.hasPhoto = true; save(); toast('Photo saved'); render();
      });
    }).catch(function () { toast("Couldn't save that photo."); });
  }

  /* ---------------- backup ---------------- */
  function blobToDataURL(b) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(b); }); }
  function dataURLToBlob(u) {
    var parts = u.split(','), mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    var bin = atob(parts[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function exportBackup(includeFiles) {
    var data = { app: 'rowbin', schema: SCHEMA, exportedAt: new Date().toISOString(), state: S, files: {} };
    var p = includeFiles ? fileKeys().then(function (keys) {
      return keys.reduce(function (pr, k) {
        return pr.then(function () { return fileGet(k).then(function (b) { return b ? blobToDataURL(b).then(function (u) { data.files[k] = u; }) : null; }); });
      }, Promise.resolve());
    }) : Promise.resolve();
    return p.then(function () {
      var name = 'rowbin-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      var file = null; try { file = new File([blob], name, { type: 'application/json' }); } catch (e) {}
      var shared = (isIOS() && file && navigator.canShare && navigator.canShare({ files: [file] }))
        ? navigator.share({ files: [file], title: 'Rowbin backup' }).then(function () { return true; }).catch(function (e) { return e && e.name === 'AbortError' ? 'abort' : false; })
        : Promise.resolve(false);
      return shared.then(function (ok) {
        if (ok === 'abort') return false;
        if (!ok) {
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
          document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
        }
        S.settings.lastBackup = Date.now(); save();
        toast('Backup saved: ' + name, 3000);
        return true;
      });
    });
  }
  function importBackup() {
    pickFile('application/json,.json').then(function (f) {
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var data; try { data = JSON.parse(r.result); } catch (e) { toast("That file isn't a Rowbin backup."); return; }
        if (!data || data.app !== 'rowbin' || !data.state) { toast("That file isn't a Rowbin backup."); return; }
        var n = (data.state.projects || []).length;
        confirmSheet('Restore this backup?', 'It has ' + plural(n, 'project') + ' from ' + (data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'an unknown date') + '. It will replace everything currently on this phone.', 'Restore').then(function (ok) {
          if (!ok) return;
          var keepLicense = S.settings.license, keepDevice = S.settings.deviceId;
          var next = migrate(data.state);
          // A license is tied to the device it was activated on: never import one from a backup file.
          next.settings.license = keepLicense || null; next.settings.deviceId = keepDevice;
          next.settings.tipsSeen = true;
          var files = data.files || {};
          fileKeys().then(function (keys) { return Promise.all(keys.map(fileDel)); }).then(function () {
            return Promise.all(Object.keys(files).map(function (k) { return filePut(k, dataURLToBlob(files[k])); }));
          }).then(function () {
            Object.keys(urlCache).forEach(dropURL);
            S = next; save(); applyTheme(); toast('Backup restored 🧶'); go('#/projects');
          }).catch(function () { toast('Restore failed. Your counts were not changed.'); });
        });
      };
      r.readAsText(f);
    });
  }

  /* ---------------- router ---------------- */
  var current = { view: null, id: null };
  function go(h) { if (location.hash === h) render(); else location.hash = h; }
  window.addEventListener('hashchange', render);
  function render() {
    var h = location.hash || '';
    closeSheet(); stopTick();
    var m;
    if ((m = h.match(/^#\/p\/([\w-]+)/)) && proj(m[1])) { current = { view: 'project', id: m[1] }; renderProject(proj(m[1])); }
    else if (h === '#/projects') { current = { view: 'projects' }; renderProjects(); }
    else if (h === '#/settings') { current = { view: 'settings' }; renderSettings(); }
    else if (h === '#/about') { current = { view: 'about' }; renderAbout(); }
    else { // open straight to a working counter
      var last = proj(S.settings.lastProjectId) || S.projects[0];
      if (!last) { last = newProject('My first project', 'knit'); S.projects.push(last); save(); }
      location.replace('#/p/' + last.id); return;
    }
    if (current.view !== 'project') setWake(false);
  }

  /* ---------------- views ---------------- */
  function topBar(left, title, right) { return '<header class="bar">' + left + '<h1>' + title + '</h1>' + right + '</header>'; }
  function installBanner() {
    if (isStandalone() || S.settings.installDismissed) return '';
    var why = isIOS()
      ? 'On iPhone, Safari can clear saved data from websites you haven’t opened in a while. Adding Rowbin to your Home Screen keeps your counts safe, and it opens full screen like a normal app.'
      : 'Install Rowbin so it opens full screen like a normal app, works offline and keeps your saved counts protected.';
    return '<div class="banner" id="install-banner"><div style="font-size:26px">📲</div><div class="grow"><b>Add Rowbin to your Home Screen</b><div class="small muted">' + why + '</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn small primary" data-act="install">' + (isIOS() ? 'Show me how' : 'Install') + '</button><button class="btn small" data-act="install-later">Not now</button></div></div></div>';
  }
  function tipsCard() {
    if (S.settings.tipsSeen) return '';
    return '<div class="card tips" id="tips"><h3>Welcome to Rowbin 🧶</h3><ol class="small">' +
      '<li>Tap the big <b>+</b> at the end of each row. Every tap saves right away, so closing the app never loses your place.</li>' +
      '<li>Tapped by mistake? Hit <b>Undo</b>. Every change is also kept in the History log.</li>' +
      '<li>Add a <b>repeat counter</b> below for patterns like "8-row repeat × 39". It rolls over at 8 and counts the repeats for you.</li>' +
      '<li>Free forever: no ads, no account. Pro is an optional <b>' + PRICE + ' one-time</b> unlock (one-time purchase, no subscription).</li></ol>' +
      '<button class="btn small soft" data-act="tips-ok">Got it</button></div>';
  }

  function renderProject(p) {
    if (S.settings.lastProjectId !== p.id) { S.settings.lastProjectId = p.id; save(); }
    var locked = S.settings.locked, tap = S.settings.tapAnywhere && !locked, pro = isPro();
    var countInner = '<span class="label">' + (p.craft === 'crochet' ? 'Row / Round' : 'Row') + '</span>' +
      '<span class="count-num" id="count-num" aria-live="polite" aria-atomic="true">' + p.rows + '</span>' +
      '<span class="sub" id="count-sub"></span>' +
      (locked ? '<span class="pill" style="margin-top:8px">🔒 Locked</span>' : (tap ? '<span class="small muted" style="margin-top:6px">Tap anywhere here to add a row</span>' : ''));
    var countArea = tap
      ? '<button type="button" class="count-area" data-act="inc" aria-label="Add a row">' + countInner + '</button>'
      : '<div class="count-area' + (locked ? ' locked' : '') + '">' + countInner + '</div>';
    var dis = locked ? ' disabled' : '';
    app.innerHTML =
      '<div class="counter-screen">' +
      topBar('<button class="icon-btn" data-act="nav-projects" aria-label="All projects">' + ICONS.list + '</button>',
        '<span data-act="edit-project" style="cursor:pointer">' + esc(p.name) + '</span>',
        '<button class="icon-btn" data-act="project-menu" aria-label="Project options">' + ICONS.more + '</button>') +
      '<div class="section">' + tipsCard() + installBanner() + '</div>' +
      '<div class="counter-main">' + countArea +
      '<div class="controls">' +
      '<button type="button" class="ctl minus" data-act="dec" aria-label="Subtract a row"' + dis + '>−</button>' +
      '<button type="button" class="ctl undo" data-act="undo" aria-label="Undo last change"' + dis + '>' + ICONS.undo + '<span class="small">Undo</span></button>' +
      '<button type="button" class="ctl plus" data-act="inc" aria-label="Add a row"' + dis + '>+</button>' +
      '</div></div>' +
      '<div class="section"><div class="toolrow" role="toolbar" aria-label="Tools">' +
      '<button class="chip" data-act="lock" aria-pressed="' + locked + '">' + (locked ? '🔒 Locked' : '🔓 Lock') + '</button>' +
      ('wakeLock' in navigator ? '<button class="chip" data-act="wake" aria-pressed="' + !!S.settings.keepAwake + '">☀️ Keep screen on</button>' : '') +
      '<button class="chip" data-act="pattern">📄 Pattern' + (pro ? '' : '<span class="pro-tag">PRO</span>') + '</button>' +
      '<button class="chip" data-act="timer-chip" aria-pressed="' + !!p.timer.runningSince + '">⏱ Timer' + (pro ? '' : '<span class="pro-tag">PRO</span>') + '</button>' +
      '<button class="chip" data-act="scroll" data-target="notes">📝 Notes</button>' +
      '<button class="chip" data-act="scroll" data-target="history">🕘 History</button>' +
      '</div>' +
      '<div class="card" id="counters"><div class="row"><h3 class="grow">Extra counters</h3>' +
      '<button class="btn small soft" data-act="add-counter">+ Add' + (!pro && p.counters.length >= FREE_EXTRA_COUNTERS ? '<span class="pro-tag">PRO</span>' : '') + '</button></div>' +
      (p.counters.length ? '' : '<p class="small muted" style="margin:4px 0 0">Use these for stitches, increases or a pattern repeat. A <b>linked</b> counter moves with every row. Set "repeat every N rows" and it starts over after N and counts the repeats you’ve finished.</p>') +
      '<div id="counter-list"></div></div>' +
      '<div class="card" id="reminders"><div class="row"><h3 class="grow">Row reminders' + (pro ? '' : '<span class="pro-tag">PRO</span>') + '</h3>' +
      '<button class="btn small soft" data-act="add-reminder">+ Add</button></div>' +
      (p.reminders.length ? p.reminders.map(function (r) {
        return '<div class="ctr"><div class="grow"><div class="cname">' + esc(r.text) + '</div><div class="small muted">Every ' + plural(r.every, 'row') + ', starting at row ' + r.start + '</div></div>' +
          '<button class="btn small" data-act="del-reminder" data-id="' + r.id + '" aria-label="Delete reminder">✕</button></div>';
      }).join('') : '<p class="small muted" style="margin:4px 0 0">Example: "Decrease row" every 6 rows. You get a nudge on the right row.</p>') + '</div>' +
      '<div class="card" id="timer"><h3>Project timer' + (pro ? '' : '<span class="pro-tag">PRO</span>') + '</h3>' +
      '<div class="row"><div class="grow"><div class="timer-val" id="timer-val">' + fmtDur(timerElapsed(p)) + '</div><div class="small muted">Total time. It keeps counting when the app is closed.</div></div>' +
      '<button class="btn small" data-act="timer-edit">Edit</button><button class="btn small primary" id="timer-btn" data-act="timer">' + (p.timer.runningSince ? 'Pause' : 'Start') + '</button></div></div>' +
      '<div class="card" id="notes"><h3>Notes</h3><textarea id="notes-ta" placeholder="Yarn, needle or hook size, gauge, mods…" aria-label="Project notes">' + esc(p.notes) + '</textarea>' +
      '<div class="small muted" id="notes-saved" style="margin-top:4px">Saves as you type.</div></div>' +
      '<div class="card" id="photo"><div class="row"><h3 class="grow">Project photo</h3><button class="btn small soft" data-act="photo">' + (p.hasPhoto ? 'Change' : '+ Add photo') + '</button>' +
      (p.hasPhoto ? '<button class="btn small" data-act="photo-del" aria-label="Remove photo">✕</button>' : '') + '</div>' +
      (p.hasPhoto ? '<img class="photo-big" id="photo-img" alt="Project photo" style="margin-top:10px">' : '') + '</div>' +
      '<div class="card" id="history"><h3>History</h3><p class="small muted" style="margin:0 0 6px">Every change is logged. Tap ↺ to go back to that count.</p><ul class="history" id="history-list"></ul></div>' +
      '<p class="small muted" style="text-align:center;margin:20px 0 34px"><a href="#/settings">Settings & backup</a> · <a href="#/about">About & privacy</a></p>' +
      '</div></div>';
    updateCounterUI(p, false);
    if (p.hasPhoto) fileURL('photo:' + p.id).then(function (u) { var i = $('#photo-img'); if (i && u) i.src = u; });
    var ta = $('#notes-ta'), nt;
    ta.addEventListener('input', function () {
      p.notes = ta.value; p.updatedAt = Date.now(); save();
      clearTimeout(nt); $('#notes-saved').textContent = 'Saved ✓';
      nt = setTimeout(function () { var e = $('#notes-saved'); if (e) e.textContent = 'Saves as you type.'; }, 1500);
    });
    setWake(!!S.settings.keepAwake);
    if (p.timer.runningSince) startTick();
  }

  function counterHTML(c) {
    var meta = [c.linked ? 'linked to rows' : 'manual'];
    if (c.resetAt) meta.push('repeat every ' + c.resetAt);
    var rep = c.resetAt ? '<div class="small"><b>' + c.repeats + '</b>' + (c.repeatTarget ? ' / ' + c.repeatTarget : '') + ' repeats done</div>' : '';
    return '<div class="ctr" data-cid="' + c.id + '"><div class="grow" data-act="edit-counter" data-id="' + c.id + '" style="cursor:pointer"><div class="cname">' + esc(c.name) + '</div>' +
      '<div class="small muted">' + meta.join(' · ') + ' · tap to edit</div>' + rep + '</div>' +
      '<button class="cbtn" data-act="c-dec" data-id="' + c.id + '" aria-label="' + esc(c.name) + ' minus one">−</button>' +
      '<div class="cval">' + c.value + (c.resetAt ? '<span class="small muted">/' + c.resetAt + '</span>' : '') + '</div>' +
      '<button class="cbtn plus" data-act="c-inc" data-id="' + c.id + '" aria-label="' + esc(c.name) + ' plus one">+</button></div>';
  }

  function updateCounterUI(p, animate) {
    var vc = $('#v-count'); if (vc) vc.textContent = p.rows;
    var n = $('#count-num'); if (!n) return;
    n.textContent = p.rows;
    if (animate) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
    var sub = [];
    if (p.target) sub.push('of ' + p.target + ' · ' + Math.min(100, Math.round(p.rows / p.target * 100)) + '%');
    var rem = nextReminderText(p); if (rem) sub.push(rem);
    var s = $('#count-sub'); if (s) s.innerHTML = sub.map(esc).join('<br>');
    var cl = $('#counter-list'); if (cl) cl.innerHTML = p.counters.map(counterHTML).join('');
    var hl = $('#history-list');
    if (hl) {
      var items = p.log.slice(-60).reverse();
      hl.innerHTML = items.length ? items.map(function (e, i) {
        return '<li><span>' + esc(e.m) + '<br><span class="small muted">' + fmtDay(e.t) + ', ' + fmtClock(e.t) + '</span></span>' +
          (e.r !== p.rows ? '<button class="btn small" data-act="restore" data-r="' + e.r + '" aria-label="Go back to row ' + e.r + '">↺ ' + e.r + '</button>' : '') + '</li>';
      }).join('') : '<li class="muted">No changes yet. Tap + to start.</li>';
    }
  }

  function renderProjects() {
    var pro = isPro(), backupNote = '';
    if (S.projects.some(function (p) { return p.rows > 0; })) {
      backupNote = S.settings.lastBackup
        ? 'Last backup: ' + (daysAgo(S.settings.lastBackup) === 0 ? 'today' : plural(daysAgo(S.settings.lastBackup), 'day') + ' ago')
        : 'No backup yet. It only takes a second, in Settings.';
    }
    app.innerHTML =
      '<header class="bar"><div class="brand"><img src="icons/icon-192.png" alt=""><b>Rowbin</b></div>' +
      '<button class="icon-btn" data-act="nav-about" aria-label="About">' + ICONS.info + '</button>' +
      '<button class="icon-btn" data-act="nav-settings" aria-label="Settings">' + ICONS.gear + '</button></header>' +
      '<main class="wrap">' + installBanner() +
      '<ul class="plist" id="plist">' + S.projects.slice().sort(function (a, b) { return b.updatedAt - a.updatedAt; }).map(function (p) {
        var pct = p.target ? Math.min(100, Math.round(p.rows / p.target * 100)) : null;
        return '<li><button class="pitem" data-act="open" data-id="' + p.id + '"><span class="thumb" data-thumb="' + (p.hasPhoto ? p.id : '') + '">' + (p.craft === 'crochet' ? '🪝' : '🧶') + '</span>' +
          '<span class="grow"><span class="name">' + esc(p.name) + '</span><br><span class="small muted">' + (p.craft === 'crochet' ? 'Crochet' : 'Knitting') + (p.target ? ' · ' + p.rows + ' of ' + p.target : '') + ' · ' + fmtDay(p.updatedAt) + '</span>' +
          (pct !== null ? '<span class="progress"><i style="width:' + pct + '%"></i></span>' : '') + '</span>' +
          '<span class="count">' + p.rows + '</span></button></li>';
      }).join('') + '</ul>' +
      '<button class="btn primary block" data-act="new-project" style="margin-top:6px">+ New project' + (!pro && S.projects.length >= FREE_LIMIT ? '<span class="pro-tag">PRO</span>' : '') + '</button>' +
      (!pro ? '<p class="small muted" style="text-align:center">Free: ' + FREE_LIMIT + ' projects. Pro: unlimited, ' + PRICE + ' one-time. <a href="#/about">What’s included</a></p>' : '<p class="small muted" style="text-align:center">Rowbin Pro ✓ Thank you!</p>') +
      (backupNote ? '<p class="small muted" style="text-align:center">' + esc(backupNote) + '</p>' : '') +
      '</main>';
    $all('[data-thumb]').forEach(function (el) {
      var id = el.getAttribute('data-thumb'); if (!id) return;
      fileURL('photo:' + id).then(function (u) { if (u) el.innerHTML = '<img alt="" src="' + u + '">'; });
    });
  }

  function toggleHTML(act, on, label, sub) {
    return '<div class="switch-row"><div class="grow"><div><b>' + label + '</b></div>' + (sub ? '<div class="small muted">' + sub + '</div>' : '') + '</div>' +
      '<button class="toggle" role="switch" aria-checked="' + !!on + '" aria-label="' + esc(label) + '" data-act="' + act + '"></button></div>';
  }
  function renderSettings() {
    var pro = isPro(), st = S.settings;
    app.innerHTML =
      topBar('<button class="icon-btn" data-act="back" aria-label="Back">' + ICONS.back + '</button>', 'Settings', '<span style="width:48px"></span>') +
      '<main class="wrap">' +
      '<div class="card"><h3>Counting</h3>' +
      toggleHTML('set-haptics', st.haptics, 'Vibrate on tap', navigator.vibrate ? 'A short buzz with each tap.' : 'iPhone has limited vibration support in web apps (a light tap on iOS 18+).') +
      toggleHTML('set-tap', st.tapAnywhere, 'Tap anywhere on the number', 'Off by default so pocket taps and swipes can’t change your count.') +
      toggleHTML('set-wake', st.keepAwake, 'Keep screen on while counting', 'wakeLock' in navigator ? 'Stops the screen from sleeping on the counter.' : 'Not supported in this browser.') +
      '</div>' +
      '<div class="card"><h3>Theme' + (pro ? '' : '<span class="pro-tag">PRO</span>') + '</h3><div class="themes">' +
      THEMES.map(function (t) {
        var active = (pro ? st.theme : 'oat') === t.id;
        return '<button class="theme-swatch" data-act="theme" data-id="' + t.id + '" aria-pressed="' + active + '" style="background:' + t.bg + ';color:' + (t.id === 'night' ? '#F3ECE3' : '#2E2A26') + '"><i style="background:' + t.sw + '"></i>' + esc(t.name) + '</button>';
      }).join('') + '</div></div>' +
      '<div class="card"><h3>Backup & transfer</h3><p class="small muted" style="margin-top:0">Your projects are stored only on this phone. Save a backup file now and then (to Files, iCloud Drive, Google Drive or email). To move to a new phone, restore it there.</p>' +
      '<p class="small"><b>Last backup:</b> ' + (st.lastBackup ? new Date(st.lastBackup).toLocaleString() : 'never') + '</p>' +
      '<label class="row small" style="margin:6px 0 10px"><input type="checkbox" id="bk-files" checked style="width:22px;height:22px"> Include photos & pattern files (bigger file)</label>' +
      '<div class="row"><button class="btn primary grow" data-act="export">Save backup</button><button class="btn grow" data-act="import">Restore…</button></div></div>' +
      '<div class="card"><h3>Rowbin Pro</h3>' +
      (pro ? '<p>✓ Pro is unlocked on this phone' + (st.license.source === 'dev' ? ' (dev test code)' : '') + '.</p><p class="small muted">License key: <b>' + esc(maskKey(st.license.key)) + '</b>' + (st.license.verifiedAt ? ' · verified ' + fmtDay(st.license.verifiedAt) : '') + '. Keep your Gumroad receipt email so you can enter it again anytime.</p>'
        : (st.license && st.license.revokedAt ? '<p class="small" style="margin-top:0;color:var(--danger)">' + esc(st.license.reason || 'Your license is no longer active.') + '</p>' : '') +
          '<p class="small" style="margin-top:0">' + PRICE + ' one-time. ' + PRICE_NOTE + '. No subscription.</p><button class="btn soft block" data-act="pro">See what Pro adds</button>') +
      '<label class="field"><span>' + (pro ? 'Re-enter or change license key' : 'Enter license key') + '</span><input type="text" id="lic2" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="From your Gumroad receipt"></label>' +
      '<p class="small" id="lic-msg" role="alert" style="display:none;color:var(--danger);margin:-4px 0 10px"></p>' +
      '<p class="small muted" style="margin:-4px 0 10px">Activating needs internet once. Your key is sent only to Gumroad to check it.</p>' +
      '<button class="btn block" data-act="unlock2">Apply key</button></div>' +
      '<div class="card"><h3>Storage</h3><p class="small muted" style="margin-top:0">' +
      (st.persisted ? '✓ Your browser has agreed to protect Rowbin’s data from automatic cleanup.' : 'Your browser hasn’t yet confirmed it will protect Rowbin’s data from automatic cleanup. ' + (isIOS() ? 'On iPhone, add Rowbin to your Home Screen and keep backups.' : 'Installing the app usually takes care of this.')) + '</p>' +
      (isStandalone() ? '' : '<button class="btn block" data-act="install">' + (isIOS() ? 'How to add to Home Screen' : 'Install app') + '</button>') +
      '<button class="btn block danger" style="margin-top:10px" data-act="wipe">Erase all data on this phone</button></div>' +
      '<p class="small muted" style="text-align:center"><a href="#/about">About, help & privacy</a> · Rowbin v1.0</p></main>';
  }

  function renderAbout() {
    app.innerHTML =
      topBar('<button class="icon-btn" data-act="back" aria-label="Back">' + ICONS.back + '</button>', 'About Rowbin', '<span style="width:48px"></span>') +
      '<main class="wrap">' +
      '<div class="hero"><img src="icons/icon-512.png" alt="Rowbin icon"><h2>Rowbin</h2><p><b>The cozy row counter for knitting & crochet.</b></p><p>No ads. Ever. No account. No subscription. Works offline.</p></div>' +
      '<div class="card"><h3>Free forever</h3>' + freeForeverList() + '</div>' +
      '<div class="card"><h3>Pro: ' + PRICE + ' one-time</h3><p class="small muted" style="margin:0">' + PRICE_NOTE + '. No subscription.</p>' + proFeatureList() +
      (isPro() ? '<p>✓ You have Pro. Thank you!</p>' : '<button class="btn primary block" data-act="pro">Get Pro</button>') + '</div>' +
      '<div class="card"><h3>Free vs Pro</h3><table class="compare"><thead><tr><th></th><th>Free</th><th>Pro</th></tr></thead><tbody>' +
      [['Big row counter, undo, history', '✓', '✓'], ['Projects', FREE_LIMIT, '∞'], ['Extra / repeat counters per project', FREE_EXTRA_COUNTERS, '∞'], ['Notes & project photo', '✓', '✓'],
        ['Backup export & import', '✓', '✓'], ['Keep screen on, lock, haptics', '✓', '✓'], ['Row reminders', '–', '✓'], ['Pattern viewer + highlighter', '–', '✓'],
        ['Project timer', '–', '✓'], ['Themes & dark mode', '–', '✓'], ['Ads', 'Never', 'Never']].map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="card"><h3>Install it like an app</h3><p class="small" style="margin-top:0"><b>iPhone (Safari):</b> tap the Share button (square with an arrow), then <b>Add to Home Screen</b>. On iPhone this also stops Safari from clearing your saved counts.</p>' +
      '<p class="small"><b>Android (Chrome):</b> tap the ⋮ menu, then <b>Install app</b> or <b>Add to Home screen</b>.</p></div>' +
      '<div class="card"><h3>Quick help</h3><p class="small" style="margin-top:0"><b>Repeat counters:</b> for "repeat rows 1–8, 39 times", add an extra counter, keep it linked, set "repeat every" to 8 and the repeat goal to 39. Every tap of the main + moves it along. After 8 it goes back to 1 and adds one finished repeat.</p>' +
      '<p class="small"><b>Mis-tap?</b> Tap Undo, or tap ↺ next to any History entry to jump back to that count.</p>' +
      '<p class="small"><b>Turning the phone sideways</b> works fine. The counter switches to a side-by-side layout.</p>' +
      '<p class="small"><b>New phone?</b> Settings → Save backup, then Restore on the new phone and re-enter your license key.</p></div>' +
      '<div class="card" id="privacy"><h3>Privacy</h3><p class="small" style="margin-top:0">Rowbin has no accounts, no ads, no analytics and no trackers. Your projects, notes, photos and patterns are stored only on your device, in your browser’s storage, and are never uploaded anywhere. After the first load the app needs no internet, with one exception: when you enter a Pro license key, the app sends that key (and nothing else) to Gumroad, the store that sold it, to check it. While online it quietly re-checks the key about once a month so refunded keys stop working. Backups are files you save yourself. Clearing this site’s data in your browser deletes everything, so keep a backup.</p>' +
      (C.SUPPORT_EMAIL ? '<p class="small">Questions: <a href="mailto:' + esc(C.SUPPORT_EMAIL) + '">' + esc(C.SUPPORT_EMAIL) + '</a></p>' : '') + '</div>' +
      '<p class="small muted" style="text-align:center"><a href="privacy.html">Privacy policy page</a> · Rowbin v1.0 · PDF viewing by pdf.js (Apache-2.0)</p></main>';
  }

  /* ---------------- project / counter / reminder / timer sheets ---------------- */
  function projectForm(p, isNew) {
    return '<h2>' + (isNew ? 'New project' : 'Edit project') + '</h2>' +
      '<label class="field"><span>Name</span><input type="text" id="pf-name" maxlength="60" value="' + esc(p ? p.name : '') + '" placeholder="e.g. Cozy cardigan"></label>' +
      '<div class="field"><span style="display:block;font-weight:600;margin-bottom:6px;font-size:15px">Craft</span><div class="seg" id="pf-craft">' +
      '<button type="button" data-v="knit" aria-pressed="' + (!p || p.craft !== 'crochet') + '">🧶 Knitting</button><button type="button" data-v="crochet" aria-pressed="' + (!!p && p.craft === 'crochet') + '">🪝 Crochet</button></div></div>' +
      '<label class="field"><span>Target rows (optional)</span><input type="number" inputmode="numeric" min="0" id="pf-target" value="' + (p && p.target ? p.target : '') + '" placeholder="e.g. 120"></label>' +
      (isNew ? '' : '<label class="field"><span>Current row</span><input type="number" inputmode="numeric" min="0" id="pf-rows" value="' + p.rows + '"></label>') +
      '<div class="row"><button class="btn grow" data-x="cancel">Cancel</button><button class="btn primary grow" data-x="save">' + (isNew ? 'Create' : 'Save') + '</button></div>';
  }
  function bindProjectForm(el, close, onSave) {
    var craft = $('#pf-craft button[aria-pressed="true"]', el).getAttribute('data-v');
    el.addEventListener('click', function (e) {
      var s = e.target.closest('#pf-craft button');
      if (s) { craft = s.getAttribute('data-v'); $all('#pf-craft button', el).forEach(function (b) { b.setAttribute('aria-pressed', b === s); }); return; }
      var b = e.target.closest('[data-x]'); if (!b) return;
      if (b.getAttribute('data-x') === 'cancel') return close();
      var target = parseInt($('#pf-target', el).value, 10), rowsEl = $('#pf-rows', el);
      var v = { name: $('#pf-name', el).value.trim() || 'My project', craft: craft, target: target > 0 ? target : null, rows: rowsEl ? rowsEl.value : null };
      close(); onSave(v);
    });
  }
  function newProjectFlow() {
    if (!isPro() && S.projects.length >= FREE_LIMIT) { openPro('More than ' + FREE_LIMIT + ' projects'); return; }
    openSheet(projectForm(null, true), function (el, close) {
      bindProjectForm(el, close, function (v) {
        var p = newProject(v.name, v.craft); p.target = v.target; logEv(p, 'Project created'); S.projects.push(p); save(); go('#/p/' + p.id);
      });
    });
  }
  function editProject(p) {
    openSheet(projectForm(p, false), function (el, close) {
      bindProjectForm(el, close, function (v) {
        p.name = v.name; p.craft = v.craft; p.target = v.target; p.updatedAt = Date.now();
        var r = Math.max(0, parseInt(v.rows, 10) || 0);
        if (r !== p.rows) setRows(p, r, 'Edited'); else save();
        render();
      });
    }, { noFocus: true });
  }
  function resetFlow(p) {
    confirmSheet('Reset to row 0?', 'Your current count (' + p.rows + ') stays in History, and you can undo this.', 'Reset').then(function (ok) {
      if (!ok) return; pushUndo(p); var from = p.rows; p.rows = 0;
      p.counters.forEach(function (c) { if (c.linked) { c.value = 0; c.repeats = 0; } });
      logEv(p, 'Reset: row ' + from + ' → 0'); save(); updateCounterUI(p, true); toast('Reset. Tap Undo to bring it back.', 3000);
    });
  }
  function projectMenu(p) {
    openSheet('<h2>' + esc(p.name) + '</h2>' +
      '<button class="btn block" data-x="edit" style="margin-bottom:10px">✏️ Edit name, craft, target</button>' +
      '<button class="btn block" data-x="new" style="margin-bottom:10px">➕ New project</button>' +
      '<button class="btn block" data-x="reset" style="margin-bottom:10px">↺ Reset row count to 0</button>' +
      '<button class="btn block" data-x="settings" style="margin-bottom:10px">⚙️ Settings & backup</button>' +
      '<button class="btn block danger" data-x="delete" style="margin-bottom:10px">🗑 Delete project</button>' +
      '<button class="btn block" data-x="close">Close</button>',
      function (el, close) {
        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          var x = b.getAttribute('data-x'); close();
          if (x === 'edit') editProject(p);
          if (x === 'new') newProjectFlow();
          if (x === 'settings') go('#/settings');
          if (x === 'reset') resetFlow(p);
          if (x === 'delete') confirmSheet('Delete "' + p.name + '"?', 'This removes the project, its notes, photo and pattern from this phone. It can’t be undone unless you have a backup.', 'Delete').then(function (ok) {
            if (!ok) return;
            S.projects = S.projects.filter(function (q) { return q.id !== p.id; });
            fileDel('photo:' + p.id).catch(function () {}); fileDel('pattern:' + p.id).catch(function () {});
            if (S.settings.lastProjectId === p.id) S.settings.lastProjectId = null;
            save(); go('#/projects');
          });
        });
      }, { noFocus: true });
  }
  function counterSheet(p, c) {
    var isNew = !c;
    c = c || { name: p.counters.length ? 'Counter ' + (p.counters.length + 1) : 'Repeat', value: 0, linked: true, resetAt: null, repeats: 0, repeatTarget: null };
    openSheet('<h2>' + (isNew ? 'Add a counter' : 'Edit counter') + '</h2>' +
      '<label class="field"><span>Name</span><input type="text" id="cf-name" maxlength="40" value="' + esc(c.name) + '"></label>' +
      '<div class="switch-row"><div class="grow"><b>Link to rows</b><div class="small muted">Moves by one each time you tap the main +</div></div><button class="toggle" role="switch" id="cf-linked" aria-checked="' + !!c.linked + '" aria-label="Link to rows"></button></div>' +
      '<label class="field"><span>Repeat every N rows (optional)</span><input type="number" inputmode="numeric" min="0" id="cf-reset" value="' + (c.resetAt || '') + '" placeholder="e.g. 8 (starts over and counts repeats)"></label>' +
      '<label class="field"><span>Repeat goal (optional)</span><input type="number" inputmode="numeric" min="0" id="cf-rt" value="' + (c.repeatTarget || '') + '" placeholder="e.g. 39"></label>' +
      (isNew ? '' : '<label class="field"><span>Current value</span><input type="number" inputmode="numeric" min="0" id="cf-val" value="' + c.value + '"></label>') +
      '<div class="row">' + (isNew ? '' : '<button class="btn danger" data-x="del">Delete</button>') + '<button class="btn grow" data-x="cancel">Cancel</button><button class="btn primary grow" data-x="save">Save</button></div>',
      function (el, close) {
        el.addEventListener('click', function (e) {
          var t = e.target.closest('#cf-linked'); if (t) { t.setAttribute('aria-checked', t.getAttribute('aria-checked') !== 'true'); return; }
          var b = e.target.closest('[data-x]'); if (!b) return;
          var x = b.getAttribute('data-x');
          if (x === 'cancel') return close();
          if (x === 'del') { close(); confirmSheet('Delete "' + c.name + '"?', 'This counter will be removed.', 'Delete').then(function (ok) { if (ok) { p.counters = p.counters.filter(function (k) { return k.id !== c.id; }); logEv(p, 'Counter deleted: ' + c.name); save(); render(); } }); return; }
          var ra = parseInt($('#cf-reset', el).value, 10), rt = parseInt($('#cf-rt', el).value, 10);
          c.name = $('#cf-name', el).value.trim() || 'Counter';
          c.linked = $('#cf-linked', el).getAttribute('aria-checked') === 'true';
          c.resetAt = ra > 0 ? ra : null; c.repeatTarget = rt > 0 ? rt : null;
          var vEl = $('#cf-val', el);
          if (vEl) { var nv = Math.max(0, parseInt(vEl.value, 10) || 0); if (nv !== c.value) { pushUndo(p); c.value = nv; } }
          if (c.resetAt && c.value > c.resetAt) c.value = c.resetAt;
          if (isNew) { c.id = uid(); p.counters.push(c); logEv(p, 'Counter added: ' + c.name); }
          save(); close(); render();
          setTimeout(function () { var e2 = $('#counters'); if (e2) e2.scrollIntoView({ block: 'center' }); }, 30);
        });
      });
  }
  function reminderSheet(p) {
    openSheet('<h2>Add a row reminder</h2>' +
      '<label class="field"><span>Reminder</span><input type="text" id="rf-text" maxlength="60" placeholder="e.g. Decrease row"></label>' +
      '<div class="row"><label class="field grow"><span>Every N rows</span><input type="number" inputmode="numeric" min="1" id="rf-every" value="6"></label>' +
      '<label class="field grow"><span>First at row</span><input type="number" inputmode="numeric" min="0" id="rf-start" value="' + (p.rows + 6) + '"></label></div>' +
      '<div class="row"><button class="btn grow" data-x="cancel">Cancel</button><button class="btn primary grow" data-x="save">Add</button></div>',
      function (el, close) {
        var ev = $('#rf-every', el), st = $('#rf-start', el), touched = false;
        st.addEventListener('input', function () { touched = true; });
        ev.addEventListener('input', function () { if (!touched) st.value = p.rows + (parseInt(ev.value, 10) || 0); });
        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          if (b.getAttribute('data-x') === 'cancel') return close();
          var every = parseInt(ev.value, 10); if (!(every > 0)) { toast('Enter how many rows apart'); return; }
          p.reminders.push({ id: uid(), text: $('#rf-text', el).value.trim() || 'Reminder', every: every, start: Math.max(0, parseInt(st.value, 10) || 0) });
          save(); close(); render(); setTimeout(function () { var r = $('#reminders'); if (r) r.scrollIntoView({ block: 'center' }); }, 30);
        });
      });
  }
  function timerEdit(p) {
    var ms = timerElapsed(p), h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    openSheet('<h2>Edit total time</h2><p class="small muted">Forgot to start the timer? Set the total here.</p>' +
      '<div class="row"><label class="field grow"><span>Hours</span><input type="number" inputmode="numeric" min="0" id="tf-h" value="' + h + '"></label>' +
      '<label class="field grow"><span>Minutes</span><input type="number" inputmode="numeric" min="0" max="59" id="tf-m" value="' + m + '"></label></div>' +
      '<div class="row"><button class="btn grow" data-x="cancel">Cancel</button><button class="btn primary grow" data-x="save">Save</button></div>',
      function (el, close) {
        el.addEventListener('click', function (e) {
          var b = e.target.closest('[data-x]'); if (!b) return;
          if (b.getAttribute('data-x') === 'save') {
            var total = (Math.max(0, parseInt($('#tf-h', el).value, 10) || 0) * 3600 + clamp(parseInt($('#tf-m', el).value, 10) || 0, 0, 59) * 60) * 1000;
            p.timer.totalMs = total; if (p.timer.runningSince) p.timer.runningSince = Date.now();
            logEv(p, 'Timer set to ' + fmtDur(total)); save(); renderTimerOnly();
          }
          close();
        });
      }, { noFocus: true });
  }
  function installHelp() {
    if (deferredInstall) {
      deferredInstall.prompt();
      deferredInstall.userChoice.then(function (c) { if (c && c.outcome === 'accepted') { S.settings.installDismissed = true; save(); requestPersist(); render(); } deferredInstall = null; });
      return;
    }
    openSheet('<h2>Add Rowbin to your Home Screen</h2>' +
      (isIOS()
        ? '<ol><li>Open this page in <b>Safari</b>.</li><li>Tap the <b>Share</b> button (the square with an arrow pointing up).</li><li>Scroll down, tap <b>Add to Home Screen</b>, then tap <b>Add</b>.</li></ol><p class="small muted">Why it matters: Safari can clear data from websites you haven’t visited in a few weeks. Home Screen apps keep their data, so your counts stay safe.</p>'
        : '<ol><li>Tap the browser menu (⋮).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol><p class="small muted">Rowbin then opens full screen and works offline.</p>') +
      '<button class="btn primary block" data-x="ok">Got it</button>', function (el, close) {
        el.addEventListener('click', function (e) { if (e.target.closest('[data-x]')) close(); });
      }, { noFocus: true });
  }

  /* ---------------- pattern viewer (Pro) ---------------- */
  var pdfjsP = null;
  function loadPdfJs() {
    if (pdfjsP) return pdfjsP;
    pdfjsP = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js'; res(window.pdfjsLib); };
      s.onerror = function () { pdfjsP = null; rej(new Error('PDF viewer failed to load')); };
      document.head.appendChild(s);
    });
    return pdfjsP;
  }
  function patternAction(p) {
    if (!isPro()) { openPro('The pattern viewer'); return; }
    if (p.pattern) openViewer(p); else uploadPattern(p);
  }
  function uploadPattern(p) {
    pickFile('application/pdf,image/*').then(function (f) {
      if (!f) return;
      var isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
      var store = isPdf ? Promise.resolve(f) : downscale(f, 2400);
      return store.then(function (b) { return filePut('pattern:' + p.id, b); }).then(function () {
        dropURL('pattern:' + p.id);
        p.pattern = { name: f.name || 'Pattern', type: isPdf ? 'pdf' : 'image', page: 0, rel: 0.12, size: 0.035, zoom: 1, follow: true };
        logEv(p, 'Pattern added: ' + p.pattern.name); save(); openViewer(p);
      });
    }).catch(function () { toast("Couldn't open that file. Is the phone low on storage?", 3500); });
  }
  function openViewer(p) {
    var pt = p.pattern;
    var v = document.createElement('div');
    v.className = 'viewer'; v.setAttribute('role', 'dialog'); v.setAttribute('aria-label', 'Pattern viewer');
    v.innerHTML = '<div class="vbar"><button class="icon-btn" data-v="close" aria-label="Close pattern">' + ICONS.back + '</button><div class="title">' + esc(pt.name) + '</div>' +
      '<button class="icon-btn" data-v="zout" aria-label="Zoom out">−</button><button class="icon-btn" data-v="zin" aria-label="Zoom in">+</button><button class="icon-btn" data-v="menu" aria-label="Pattern options">' + ICONS.more + '</button></div>' +
      '<div class="vscroll" id="vscroll"><div class="vcontent" id="vcontent"><div class="small muted" style="padding:30px;text-align:center">Opening pattern…</div></div></div>' +
      '<div class="vfoot"><button class="ctl" data-v="up" aria-label="Move line up">▲</button><button class="ctl" data-v="down" aria-label="Move line down">▼</button>' +
      '<button class="ctl minus" data-v="dec" aria-label="Subtract a row" style="flex:.8">−</button><div class="vcount" id="v-count" aria-live="polite">' + p.rows + '</div>' +
      '<button class="ctl plus" data-v="inc" aria-label="Add a row" style="flex:1.4">+</button></div>';
    document.body.appendChild(v);
    document.body.style.overflow = 'hidden';
    var scroller = $('#vscroll', v), content = $('#vcontent', v), pages = [], hl = null, doc = null, io = null, closed = false;

    function hlPx() { var pg = pages[clamp(pt.page, 0, pages.length - 1)]; return pg ? pg.offsetTop + pt.rel * pg.offsetHeight : 0; }
    function storeFromPx(top) { // highlighter saved as (page, relative Y) so it survives zoom & rotation
      var center = top + hl.offsetHeight / 2;
      for (var i = 0; i < pages.length; i++) {
        var pg = pages[i];
        if (center < pg.offsetTop + pg.offsetHeight + 4 || i === pages.length - 1) { pt.page = i; pt.rel = (top - pg.offsetTop) / pg.offsetHeight; break; }
      }
      save();
    }
    function placeHL(scrollTo) {
      if (!hl) {
        hl = document.createElement('div'); hl.className = 'hl'; hl.id = 'hl';
        hl.innerHTML = '<span class="grip" aria-hidden="true">⇕</span>'; hl.setAttribute('aria-label', 'Row highlighter, drag to move');
        content.appendChild(hl); bindDrag();
      }
      hl.style.height = Math.max(14, pt.size * content.offsetWidth) + 'px';
      hl.style.top = clamp(hlPx(), 0, Math.max(0, content.offsetHeight - hl.offsetHeight)) + 'px';
      if (scrollTo) scroller.scrollTop = Math.max(0, hl.offsetTop - scroller.clientHeight * 0.35);
    }
    function moveHL(dir) {
      var top = clamp(hl.offsetTop + dir * hl.offsetHeight * 0.9, 0, content.offsetHeight - hl.offsetHeight);
      hl.style.top = top + 'px'; storeFromPx(top);
      var vis = top - scroller.scrollTop;
      if (vis > scroller.clientHeight * 0.7 || vis < scroller.clientHeight * 0.1) scroller.scrollTo({ top: top - scroller.clientHeight * 0.35, behavior: 'smooth' });
    }
    function bindDrag() {
      var startY = 0, startTop = 0, dragging = false;
      hl.addEventListener('pointerdown', function (e) { dragging = true; startY = e.clientY; startTop = hl.offsetTop; try { hl.setPointerCapture(e.pointerId); } catch (x) {} e.preventDefault(); });
      hl.addEventListener('pointermove', function (e) { if (dragging) hl.style.top = clamp(startTop + e.clientY - startY, 0, content.offsetHeight - hl.offsetHeight) + 'px'; });
      function end() { if (!dragging) return; dragging = false; storeFromPx(hl.offsetTop); }
      hl.addEventListener('pointerup', end); hl.addEventListener('pointercancel', end);
    }
    content.addEventListener('click', function (e) { // tap on the pattern: move the line there
      if (!hl || e.target.closest('.hl')) return;
      var r = content.getBoundingClientRect();
      var top = clamp(e.clientY - r.top - hl.offsetHeight / 2, 0, content.offsetHeight - hl.offsetHeight);
      hl.style.top = top + 'px'; storeFromPx(top); haptic('soft');
    });
    function renderPage(c) {
      if (c._rendered || c._busy) return; c._busy = true;
      var dpr = Math.min(window.devicePixelRatio || 1, 2), base = c._page.getViewport({ scale: 1 });
      var vp = c._page.getViewport({ scale: Math.min(content.offsetWidth * dpr, 2200) / base.width });
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c._page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise.then(function () { c._rendered = true; c._busy = false; }).catch(function () { c._busy = false; });
    }
    function releasePage(c) { if (c._rendered && !c._busy) { c.width = 0; c.height = 0; c._rendered = false; } } // free memory off-screen
    function build() {
      var w = Math.round(scroller.clientWidth * pt.zoom); content.style.width = w + 'px';
      if (pt.type === 'image') {
        return fileURL('pattern:' + p.id).then(function (u) {
          content.innerHTML = ''; hl = null;
          var img = new Image(); img.alt = 'Pattern'; content.appendChild(img); pages = [img];
          return new Promise(function (res) { img.onload = res; img.onerror = res; img.src = u; });
        });
      }
      var start = doc ? Promise.resolve(doc) : Promise.all([loadPdfJs(), fileGet('pattern:' + p.id)]).then(function (r) {
        if (!r[1]) throw new Error('Pattern file missing');
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res([r[0], fr.result]); }; fr.readAsArrayBuffer(r[1]); });
      }).then(function (r) { return r[0].getDocument({ data: new Uint8Array(r[1]), isEvalSupported: false }).promise; }).then(function (d) { doc = d; return d; });
      return start.then(function (d) {
        content.innerHTML = ''; hl = null; pages = [];
        var chain = Promise.resolve();
        for (var i = 1; i <= d.numPages; i++) (function (n) {
          chain = chain.then(function () { return d.getPage(n); }).then(function (page) {
            var vp = page.getViewport({ scale: 1 }), c = document.createElement('canvas');
            c.style.height = (w * vp.height / vp.width) + 'px'; c._page = page; content.appendChild(c); pages.push(c);
          });
        })(i);
        return chain;
      }).then(function () {
        if (io) io.disconnect();
        io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) { if (en.isIntersecting) renderPage(en.target); else releasePage(en.target); });
        }, { root: scroller, rootMargin: '150% 0px' });
        pages.forEach(function (c) { io.observe(c); });
      });
    }
    function rebuild(scrollTo) {
      return build().then(function () { if (!closed) placeHL(scrollTo); }).catch(function (err) {
        content.innerHTML = '<div style="padding:30px;text-align:center">Sorry, this pattern couldn’t be opened.<br><span class="small muted">' + esc(err && err.message || '') + '</span></div>';
      });
    }
    rebuild(true);
    var rt; function onResize() { clearTimeout(rt); rt = setTimeout(function () { if (!closed) rebuild(true); }, 250); }
    window.addEventListener('resize', onResize);
    function close() {
      closed = true; window.removeEventListener('resize', onResize); if (io) io.disconnect();
      if (doc) { try { doc.destroy(); } catch (e) {} }
      v.remove(); document.body.style.overflow = ''; render();
    }
    v.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]'); if (!b) return;
      var x = b.getAttribute('data-v'), before = p.rows;
      if (x === 'close') close();
      if (x === 'inc') { changeRows(p, 1); if (p.rows !== before && pt.follow && hl) moveHL(1); }
      if (x === 'dec') { changeRows(p, -1); if (p.rows !== before && pt.follow && hl) moveHL(-1); }
      if (x === 'up' && hl) moveHL(-1);
      if (x === 'down' && hl) moveHL(1);
      if (x === 'zin' || x === 'zout') { pt.zoom = clamp(Math.round((pt.zoom + (x === 'zin' ? 0.25 : -0.25)) * 100) / 100, 1, 3); save(); rebuild(true); }
      if (x === 'menu') {
        openSheet('<h2>Pattern</h2>' +
          '<div class="switch-row"><div class="grow"><b>Move line with each row</b><div class="small muted">Tapping + here also moves the highlighter down one line</div></div><button class="toggle" role="switch" id="pv-follow" aria-checked="' + !!pt.follow + '" aria-label="Move line with each row"></button></div>' +
          '<p style="margin:14px 0 6px"><b>Highlighter thickness</b></p><div class="row"><button class="btn grow" data-x="thin">Thinner</button><button class="btn grow" data-x="thick">Thicker</button></div>' +
          '<p class="small muted">Tip: tap anywhere on the pattern to move the line there, or drag it by the ⇕ handle.</p>' +
          '<button class="btn block" data-x="replace" style="margin-top:6px">Replace pattern file</button>' +
          '<button class="btn block danger" data-x="remove" style="margin-top:10px">Remove pattern</button>' +
          '<button class="btn block" data-x="close" style="margin-top:10px">Done</button>',
          function (el, cs) {
            el.addEventListener('click', function (e2) {
              var t = e2.target.closest('#pv-follow'); if (t) { pt.follow = !pt.follow; t.setAttribute('aria-checked', pt.follow); save(); return; }
              var bb = e2.target.closest('[data-x]'); if (!bb) return;
              var y = bb.getAttribute('data-x');
              if (y === 'thin' || y === 'thick') { pt.size = clamp(pt.size * (y === 'thin' ? 0.8 : 1.25), 0.012, 0.2); save(); placeHL(false); return; }
              cs();
              if (y === 'replace') { close(); uploadPattern(p); }
              if (y === 'remove') confirmSheet('Remove pattern?', 'The pattern file will be deleted from this project.', 'Remove').then(function (ok) {
                if (!ok) return; fileDel('pattern:' + p.id).catch(function () {}); dropURL('pattern:' + p.id); p.pattern = null; save(); close();
              });
            });
          }, { noFocus: true });
      }
    });
  }

  /* ---------------- event delegation ---------------- */
  app.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var act = b.getAttribute('data-act');
    var p = current.view === 'project' ? proj(current.id) : null;
    var id = b.getAttribute('data-id');
    switch (act) {
      case 'inc': if (p) changeRows(p, 1); break;
      case 'dec': if (p) changeRows(p, -1); break;
      case 'undo': if (p) undo(p); break;
      case 'restore': if (p) { setRows(p, b.getAttribute('data-r'), 'Restored from history'); toast('Back to row ' + p.rows + '. Undo is available.'); } break;
      case 'lock': S.settings.locked = !S.settings.locked; save(); haptic('soft'); render(); toast(S.settings.locked ? 'Locked. Taps won’t change the count.' : 'Unlocked'); break;
      case 'wake': S.settings.keepAwake = !S.settings.keepAwake; save(); b.setAttribute('aria-pressed', !!S.settings.keepAwake);
        setWake(S.settings.keepAwake).then(function (ok) { toast(S.settings.keepAwake ? (ok ? 'Screen will stay on while counting' : 'Couldn’t keep the screen on in this browser') : 'Screen can sleep normally'); });
        break;
      case 'pattern': if (p) patternAction(p); break;
      case 'timer-chip': if (!isPro()) openPro('The project timer'); else { var t = $('#timer'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'center' }); } break;
      case 'timer': if (!isPro()) openPro('The project timer'); else if (p) { timerToggle(p); if (p.timer.runningSince) startTick(); else stopTick(); } break;
      case 'timer-edit': if (!isPro()) openPro('The project timer'); else if (p) timerEdit(p); break;
      case 'scroll': var tg = document.getElementById(b.getAttribute('data-target')); if (tg) tg.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'add-counter': if (p) { if (!isPro() && p.counters.length >= FREE_EXTRA_COUNTERS) openPro('More than ' + FREE_EXTRA_COUNTERS + ' extra counter'); else counterSheet(p); } break;
      case 'edit-counter': if (p) counterSheet(p, p.counters.filter(function (c) { return c.id === id; })[0]); break;
      case 'c-inc': case 'c-dec':
        if (!p) break;
        if (S.settings.locked) { lockedMsg(); break; }
        if (debounced(act + id, 180)) break;
        var c = p.counters.filter(function (k) { return k.id === id; })[0]; if (!c) break;
        pushUndo(p); var fv = c.value; bumpCounter(c, act === 'c-inc' ? 1 : -1);
        logEv(p, c.name + ': ' + fv + ' → ' + c.value); save(); haptic(); updateCounterUI(p, false);
        break;
      case 'add-reminder': if (!isPro()) openPro('Row reminders'); else if (p) reminderSheet(p); break;
      case 'del-reminder': if (p) { p.reminders = p.reminders.filter(function (r) { return r.id !== id; }); save(); render(); } break;
      case 'photo': if (p) setPhoto(p); break;
      case 'photo-del': if (p) confirmSheet('Remove photo?', 'The project photo will be deleted.', 'Remove').then(function (ok) { if (ok) { fileDel('photo:' + p.id); dropURL('photo:' + p.id); p.hasPhoto = false; save(); render(); } }); break;
      case 'edit-project': if (p) editProject(p); break;
      case 'project-menu': if (p) projectMenu(p); break;
      case 'tips-ok': S.settings.tipsSeen = true; save(); var tp = $('#tips'); if (tp) tp.remove(); requestPersist(); break;
      case 'install': installHelp(); break;
      case 'install-later': S.settings.installDismissed = true; save(); var ib = $('#install-banner'); if (ib) ib.remove(); break;
      case 'nav-projects': go('#/projects'); break;
      case 'nav-settings': go('#/settings'); break;
      case 'nav-about': go('#/about'); break;
      case 'back': go(S.settings.lastProjectId && proj(S.settings.lastProjectId) ? '#/p/' + S.settings.lastProjectId : '#/projects'); break;
      case 'open': go('#/p/' + id); break;
      case 'new-project': newProjectFlow(); break;
      case 'pro': openPro(); break;
      case 'set-haptics': S.settings.haptics = !S.settings.haptics; save(); b.setAttribute('aria-checked', S.settings.haptics); if (S.settings.haptics) haptic(); break;
      case 'set-tap': S.settings.tapAnywhere = !S.settings.tapAnywhere; save(); b.setAttribute('aria-checked', S.settings.tapAnywhere); break;
      case 'set-wake': S.settings.keepAwake = !S.settings.keepAwake; save(); b.setAttribute('aria-checked', S.settings.keepAwake); break;
      case 'theme': if (!isPro() && id !== 'oat') { openPro('Themes & dark mode'); break; } S.settings.theme = id; save(); applyTheme(); render(); break;
      case 'export': exportBackup(($('#bk-files') || {}).checked !== false).catch(function () { toast('Backup failed. Try again without photos & patterns.'); }); break;
      case 'import': importBackup(); break;
      case 'unlock2': doUnlock(($('#lic2') || {}).value); break;
      case 'wipe': confirmSheet('Erase everything?', 'All projects, counts, notes, photos and patterns on this phone will be deleted. Save a backup first if you might want them back.', 'Erase all').then(function (ok) {
        if (!ok) return; var lic = S.settings.license;
        fileKeys().then(function (k) { return Promise.all(k.map(fileDel)); }).catch(function () {}).then(function () {
          S = migrate({}); S.settings.license = lic; S.settings.tipsSeen = true; save(); applyTheme(); toast('All data erased'); go('#/');
        });
      }); break;
    }
  });

  // Keyboard / Bluetooth page-turner: Space, →, ↓, PageDown = +; ←, ↑, PageUp = −; U = undo
  document.addEventListener('keydown', function (e) {
    if (current.view !== 'project' || sheetRoot.children.length || $('.viewer') || /INPUT|TEXTAREA|SELECT|BUTTON/.test((e.target || {}).tagName)) return;
    var p = proj(current.id); if (!p) return;
    if (e.key === ' ' || e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === 'ArrowDown') { e.preventDefault(); changeRows(p, 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); changeRows(p, -1); }
    else if (e.key === 'u' || e.key === 'U') { e.preventDefault(); undo(p); }
  });

  /* ---------------- boot ---------------- */
  applyTheme();
  render();
  requestPersist();
  setTimeout(function () { recheckLicense().catch(function () {}); }, 3000);
  window.addEventListener('online', function () { recheckLicense().catch(function () {}); });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
  window.Rowbin = { state: function () { return S; }, version: '1.0.0' }; // for debugging & tests
})();

/* live.js: Pro Developer Preview & Network Inspector Engine (v2.2 Live Stream Ready)
   Website preview, Smart Hybrid (Direct + Proxy Fallback) network interception,
   full HLS.js / MediaSource / ArrayBuffer compatibility, console log capturing,
   interactive request replayer, and multi-device preview. */
(function () {
'use strict';

var $ = function (s, r) { return (r || document).querySelector(s); };
var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var fmtB = function (n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; };
var MAX_ROWS = 500, MAX_KEEP = 2000;

var NET = new Map(), ORDER = [];
var CONSOLE_LOGS = [];
var F = { type: 'all', q: '', click: null, viewMode: 'net' };
var SEL = null, DTAB = 'headers', timer = 0;
var last = { html: '', base: '' };
var deviceMode = 'desk', rotated = false;

/* ------------------------------------------------------------------
   Spy script: injected directly inside the preview iframe
------------------------------------------------------------------ */
function spy(cfg) {
  var W = window, D = document;
  try { if (D.currentScript && D.currentScript.parentNode) D.currentScript.parentNode.removeChild(D.currentScript); } catch (e) {}
  var MAXB = 35000, uid = 0, rnd = Math.random().toString(36).slice(2, 7), lastClick = null;
  var nativeFetch = W.fetch ? W.fetch.bind(W) : null;
  var OrigXHR = W.XMLHttpRequest;
  var OrigURL = W.URL;

  function post(m) { m.usv = 1; try { W.parent.postMessage(m, '*'); } catch (e) {} }
  function nid() { return rnd + (++uid); }
  function trunc(s) { s = s == null ? '' : String(s); return s.length > MAXB ? s.slice(0, MAXB) + '\n...[kata hua]' : s; }
  var pageUrl = null;
  try { pageUrl = new OrigURL(cfg.page || cfg.base); } catch (e) {}

  function isSrcdocUrl(s) {
    return !s || s === 'about:srcdoc' || s === 'srcdoc' || s === 'null' || s === 'about://' || s === 'about:///' || s === 'about:blank' || /^about:/i.test(s);
  }

  function abs(u) {
    u = String(u == null ? '' : u).trim();
    var fb = cfg.page || cfg.base || '';
    if (isSrcdocUrl(u)) {
      var suf = u.replace(/^(?:about:srcdoc|about:\/\/\/?|about:blank|srcdoc)\/?/i, '');
      if (!suf) return fb;
      u = suf;
    }
    try {
      var resolved = new OrigURL(u, cfg.base || cfg.page || D.baseURI || undefined);
      if (pageUrl) {
        if (W.location && W.location.origin && resolved.origin === W.location.origin && !/^\/api\/(proxy|fetch|fast-scan|health)/.test(resolved.pathname)) {
          resolved = new OrigURL(resolved.pathname + resolved.search + resolved.hash, pageUrl.origin);
        }
        if (resolved.pathname === '/srcdoc' || resolved.pathname.endsWith('/srcdoc')) {
          resolved.pathname = pageUrl.pathname || '/';
        } else if (resolved.pathname.indexOf('/srcdoc/') === 0) {
          resolved.pathname = resolved.pathname.replace(/^\/srcdoc\b/, pageUrl.pathname === '/' ? '' : pageUrl.pathname) || '/';
        }
      }
      return resolved.href;
    } catch (e) { return String(u); }
  }

  /* Patch window.URL so Next.js App Router / Pages Router / Vite / React Router never crash on 'about:srcdoc' or 'about://' */
  if (OrigURL) {
    var PatchedURL = function URL(url, base) {
      var fb = cfg.page || cfg.base || 'https://localhost/';
      var uStr = String(url == null ? '' : url).trim();
      var bStr = base !== undefined ? String(base == null ? '' : base).trim() : undefined;
      if (bStr !== undefined && isSrcdocUrl(bStr)) {
        base = fb;
      }
      if (isSrcdocUrl(uStr)) {
        var suffix = uStr.replace(/^(?:about:srcdoc|about:\/\/\/?|about:blank|srcdoc)\/?/i, '');
        url = suffix ? abs(suffix) : fb;
      } else if (base === undefined && /^(\/|\?|\#|\.\.?\/)/.test(uStr)) {
        base = fb;
      }
      var inst;
      try {
        inst = base !== undefined ? new OrigURL(url, base) : new OrigURL(url);
      } catch (err) {
        inst = new OrigURL(uStr || '/', fb);
      }
      if (pageUrl) {
        if (inst.pathname === '/srcdoc' || inst.pathname.endsWith('/srcdoc')) {
          inst.pathname = pageUrl.pathname || '/';
        } else if (inst.pathname.indexOf('/srcdoc/') === 0) {
          inst.pathname = inst.pathname.replace(/^\/srcdoc\b/, pageUrl.pathname === '/' ? '' : pageUrl.pathname) || '/';
        }
      }
      return inst;
    };
    PatchedURL.prototype = OrigURL.prototype;
    try { Object.setPrototypeOf(PatchedURL, OrigURL); } catch (e) {}
    ['createObjectURL', 'revokeObjectURL', 'canParse', 'parse'].forEach(function (k) {
      if (typeof OrigURL[k] === 'function') PatchedURL[k] = OrigURL[k].bind(OrigURL);
    });
    W.URL = PatchedURL;
    if (W.webkitURL) W.webkitURL = PatchedURL;
  }

  /* Prevent SecurityError in about:srcdoc when Next.js / PWA scripts touch ServiceWorker or CacheStorage */
  try {
    var fakeSwReg = { scope: '/', active: null, installing: null, waiting: null, update: function () { return Promise.resolve(); }, unregister: function () { return Promise.resolve(true); }, addEventListener: function () {}, removeEventListener: function () {} };
    var fakeSwContainer = {
      controller: null,
      ready: new Promise(function () {}),
      register: function () { return Promise.resolve(fakeSwReg); },
      getRegistration: function () { return Promise.resolve(undefined); },
      getRegistrations: function () { return Promise.resolve([]); },
      addEventListener: function () {},
      removeEventListener: function () {},
      startMessages: function () {}
    };
    Object.defineProperty(W.navigator, 'serviceWorker', { value: fakeSwContainer, configurable: true });
  } catch (e) {}
  try {
    var fakeCache = { match: function () { return Promise.resolve(undefined); }, put: function () { return Promise.resolve(); }, add: function () { return Promise.resolve(); }, addAll: function () { return Promise.resolve(); }, delete: function () { return Promise.resolve(false); }, keys: function () { return Promise.resolve([]); } };
    var fakeCaches = { open: function () { return Promise.resolve(fakeCache); }, match: function () { return Promise.resolve(undefined); }, has: function () { return Promise.resolve(false); }, delete: function () { return Promise.resolve(false); }, keys: function () { return Promise.resolve([]); } };
    Object.defineProperty(W, 'caches', { value: fakeCaches, configurable: true });
  } catch (e) {}
  function clickNow() { return lastClick && Date.now() - lastClick.t < 5000 ? lastClick.id : null; }
  function hdrs(h) { var o = {}; if (h && h.forEach) h.forEach(function (v, k) { o[k.toLowerCase()] = v; }); return o; }

  var TEXT_RE = /^(text\/|application\/(json|javascript|x-javascript|ecmascript|xml|xhtml\+xml|x-www-form-urlencoded|graphql|ld\+json|manifest\+json|vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|audio\/(mpegurl|x-mpegurl))|\+(json|xml)$|^image\/svg\+xml$/i;
  function isTextResource(ct, url) {
    if (url && /\.(m3u8|mpd|vtt|srt|json|xml|txt|css|m?js)(?=$|[?#])/i.test(url)) return true;
    if (url && /\.(ts|m4s|mp4|webm|aac|mp3|png|jpe?g|webp|gif|ico|woff2?)(?=$|[?#])/i.test(url)) return false;
    var t = String(ct || '').split(';')[0].trim();
    return !t || TEXT_RE.test(t);
  }

  /* Fallback in-memory storage if browser blocks sandboxed storage */
  function mem() {
    var d = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
      setItem: function (k, v) { d[k] = String(v); },
      removeItem: function (k) { delete d[k]; },
      clear: function () { d = {}; },
      key: function (i) { return Object.keys(d)[i] || null; },
      get length() { return Object.keys(d).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (n) {
    try { W[n].getItem('x'); } catch (e) { try { Object.defineProperty(W, n, { value: mem(), configurable: true }); } catch (_) {} }
  });
  var ck = {};
  function ingestCookies(str) {
    String(str || '').split(';').forEach(function (part) {
      var i = part.indexOf('=');
      if (i > 0) {
        var k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
        if (k) ck[k] = v;
      }
    });
  }
  function getCookieStr() {
    return Object.keys(ck).map(function (k) { return k + '=' + ck[k]; }).join('; ');
  }
  if (cfg.cookies) ingestCookies(cfg.cookies);
  try {
    if (D.cookie) ingestCookies(D.cookie);
  } catch (e) {}
  try {
    Object.defineProperty(D, 'cookie', {
      configurable: true,
      get: function () { return getCookieStr(); },
      set: function (v) {
        var p = String(v).split(';')[0], i = p.indexOf('=');
        if (i > 0) {
          ck[p.slice(0, i).trim()] = p.slice(i + 1).trim();
          post({ type: 'cookies', cookies: getCookieStr(), url: cfg.page || cfg.base });
        }
      }
    });
  } catch (_) {}

  /* Console logs capture */
  ['log', 'info', 'warn', 'error'].forEach(function (lvl) {
    var orig = W.console && W.console[lvl];
    if (!orig) return;
    W.console[lvl] = function () {
      try {
        var args = Array.prototype.slice.call(arguments).map(function (a) {
          if (a === undefined) return 'undefined';
          if (a === null) return 'null';
          if (typeof a === 'object') {
            try { return JSON.stringify(a); } catch (e) { return String(a); }
          }
          return String(a);
        });
        post({ type: 'console', level: lvl, args: args, t: Date.now() });
      } catch (e) {}
      return orig.apply(W.console, arguments);
    };
  });
  W.addEventListener('error', function (e) {
    post({ type: 'console', level: 'error', args: [e.message + (e.filename ? ' (' + e.filename + ':' + e.lineno + ')' : '')], t: Date.now() });
  });

  /* Logging helpers */
  function start(rec) { rec.type = 'req'; rec.phase = 'start'; rec.id = rec.id || nid(); rec.clickId = clickNow(); rec.t = Date.now(); post(rec); return rec; }
  function end(rec, extra) { extra.type = 'req'; extra.phase = 'end'; extra.id = rec.id; post(extra); }

  function b64ToBytes(b) {
    var s = atob(b), n = s.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  /* Proxy fetch via /api/proxy with Cookie Jar & CSRF support */
  function proxyNet(url, method, headers, body, noBody) {
    var hCopy = Object.assign({}, headers || {});
    if (ck['XSRF-TOKEN'] && !hCopy['x-xsrf-token']) {
      try { hCopy['x-xsrf-token'] = decodeURIComponent(ck['XSRF-TOKEN']); } catch (e) { hCopy['x-xsrf-token'] = ck['XSRF-TOKEN']; }
    }
    var metaCsrf = D.querySelector && D.querySelector('meta[name="csrf-token" i]');
    if (metaCsrf && metaCsrf.getAttribute('content') && !hCopy['x-csrf-token']) {
      hCopy['x-csrf-token'] = metaCsrf.getAttribute('content');
    }
    return nativeFetch(cfg.proxy, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ url: url, method: method, headers: hCopy, body: noBody ? null : body, page: cfg.page, cookies: getCookieStr() })
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j.ok) throw new TypeError(j.error || 'Proxy fetch failed');
        if (j.cookies) {
          ingestCookies(j.cookies);
          post({ type: 'cookies', cookies: getCookieStr(), url: j.finalUrl || url });
        }
        var rawBytes = null;
        var textBody = '';
        if (j.encoding === 'base64') {
          rawBytes = b64ToBytes(j.body || '');
          if (isTextResource(j.contentType, j.finalUrl || url)) {
            try { textBody = new TextDecoder('utf-8').decode(rawBytes); j.encoding = 'text'; j.body = textBody; } catch (e) {}
          }
        } else {
          textBody = j.body || '';
          rawBytes = new TextEncoder().encode(textBody);
        }
        j.rawBytes = rawBytes;
        return j;
      });
  }

  /* Direct browser fetch (uses user's own IP for geo-locked streams like Tamasha, CDNs, .m3u8, .ts) */
  function directNet(url, method, headers, body, noBody) {
    var cleanHdrs = {};
    Object.keys(headers || {}).forEach(function (k) {
      if (!/^(host|origin|referer|cookie|sec-.*|user-agent|content-length)$/i.test(k)) {
        cleanHdrs[k] = headers[k];
      }
    });
    return nativeFetch(url, {
      method: method,
      headers: Object.keys(cleanHdrs).length ? cleanHdrs : undefined,
      body: noBody ? undefined : body,
      mode: 'cors',
      credentials: 'omit'
    }).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      var finalUrl = r.url || url;
      var textRes = isTextResource(ct, finalUrl);
      return r.arrayBuffer().then(function (ab) {
        var u8 = new Uint8Array(ab);
        var decoded = '';
        if (textRes) {
          try { decoded = new TextDecoder('utf-8').decode(u8); } catch (e) {}
        }
        var hObj = hdrs(r.headers);
        if (!hObj['content-length']) hObj['content-length'] = String(u8.byteLength);
        return {
          ok: true,
          status: r.status,
          statusText: r.statusText || '',
          headers: hObj,
          encoding: textRes ? 'text' : 'binary',
          body: textRes ? decoded : '',
          rawBytes: u8,
          finalUrl: finalUrl,
          contentType: ct,
          size: u8.byteLength
        };
      });
    });
  }

  /* Smart Hybrid Request:
     - POST/PUT/PATCH/DELETE and same-origin website API/Auth requests use proxyNet FIRST (so Session Cookies & CSRF work!)
     - Live video streams (.m3u8, .ts, .mp4) & external CDNs use directNet FIRST (so Pakistani geo-locked streams work!) */
  function net(kind, url, method, headers, body) {
    url = abs(url);
    var rec = start({ kind: kind, method: method, url: url, reqHeaders: headers, reqBody: trunc(body) });
    var t0 = performance.now();
    var noBody = method === 'GET' || method === 'HEAD';
    var isMediaStream = /\.(m3u8|mpd|ts|m4s|mp4|webm|aac|mp3)(?=$|[?#])/i.test(url);
    var sameHost = false;
    try { sameHost = !!(pageUrl && new URL(url).host === pageUrl.host); } catch (e) {}

    var preferProxy = cfg.proxyOk && !isMediaStream && (!noBody || sameHost || Object.keys(ck).length > 0);
    var p;

    if (preferProxy) {
      p = proxyNet(url, method, headers, body, noBody).catch(function () {
        return directNet(url, method, headers, body, noBody);
      });
    } else {
      p = directNet(url, method, headers, body, noBody).then(function (j) {
        if ((j.status === 403 || j.status === 401 || j.status === 419) && cfg.proxyOk && !/\.(ts|m4s|mp4)(?=$|[?#])/i.test(url)) {
          return proxyNet(url, method, headers, body, noBody).then(function (pj) {
            return pj.status < 400 ? pj : j;
          }, function () { return j; });
        }
        return j;
      }, function (directErr) {
        if (cfg.proxyOk) return proxyNet(url, method, headers, body, noBody);
        if (noBody && /^https?:/i.test(url)) {
          return directNet('https://corsproxy.io/?url=' + encodeURIComponent(url), 'GET', {}, null, true).catch(function () {
            return directNet('https://api.allorigins.win/raw?url=' + encodeURIComponent(url), 'GET', {}, null, true);
          }).catch(function () { throw directErr; });
        }
        throw directErr;
      });
    }

    return p.then(function (j) {
      var displayBody = j.encoding === 'text' ? trunc(j.body) : '[binary ' + (j.contentType || 'stream') + ' · ' + (j.size || 0) + ' B]';
      end(rec, {
        status: j.status,
        statusText: j.statusText,
        resHeaders: j.headers,
        resBody: displayBody,
        size: j.size,
        ms: Math.round(performance.now() - t0),
        resType: j.contentType || '',
        redirected: j.finalUrl && j.finalUrl !== url ? j.finalUrl : ''
      });
      return j;
    }, function (err) {
      end(rec, { error: String(err && err.message || err), ms: Math.round(performance.now() - t0) });
      throw err;
    });
  }

  function synth(j) {
    var h = new Headers();
    Object.keys(j.headers || {}).forEach(function (k) {
      if (!/^(content-encoding|content-length|transfer-encoding|set-cookie)$/i.test(k)) {
        try { h.set(k, j.headers[k]); } catch (e) {}
      }
    });
    var nb = j.status === 101 || j.status === 204 || j.status === 205 || j.status === 304;
    var body = nb ? null : (j.rawBytes || j.body);
    var st = j.status >= 200 && j.status <= 599 ? j.status : 200;
    var r = new Response(body, { status: st, statusText: j.statusText || '', headers: h });
    try { Object.defineProperty(r, 'url', { value: j.finalUrl || '' }); } catch (e) {}
    return r;
  }

  /* Monkey-patch fetch */
  if (nativeFetch) {
    W.fetch = function (input, init) {
      var req;
      try {
        var normInput = typeof input === 'string' ? abs(input) : input;
        req = new Request(normInput, init);
      } catch (e) { return nativeFetch(input, init); }
      var url = abs(req.url);
      if (!/^https?:/i.test(url) || url.indexOf(cfg.proxy) === 0) return nativeFetch(input, init);
      return req.clone().text().catch(function () { return ''; }).then(function (body) {
        return net('fetch', url, req.method, hdrs(req.headers), body);
      }).then(synth);
    };
  }

  /* Full HLS.js / Video.js / Axios compatible XMLHttpRequest */
  function bodyToString(b, H) {
    if (b == null) return '';
    if (typeof b === 'string') return b;
    if (typeof URLSearchParams !== 'undefined' && b instanceof URLSearchParams) {
      if (!H['content-type']) H['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      return b.toString();
    }
    if (typeof FormData !== 'undefined' && b instanceof FormData) {
      var qs = new URLSearchParams();
      b.forEach(function (v, k) { qs.append(k, typeof v === 'string' ? v : (v && v.name) || ''); });
      if (!H['content-type']) H['content-type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
      return qs.toString();
    }
    if (b instanceof ArrayBuffer || ArrayBuffer.isView(b)) return new TextDecoder().decode(b);
    return '';
  }

  function FakeXHR() {
    var x = this, et = new EventTarget();
    var m = 'GET', u = '', H = {}, done = false, aborted = false;
    var st = { rs: 0, status: 0, statusText: '', text: '', bytes: null, url: '', hdrs: {} };
    x.responseType = ''; x.timeout = 0; x.withCredentials = false;
    x.UNSENT = 0; x.OPENED = 1; x.HEADERS_RECEIVED = 2; x.LOADING = 3; x.DONE = 4;
    x.upload = { addEventListener: function () {}, removeEventListener: function () {} };
    ['readystatechange', 'loadstart', 'progress', 'load', 'error', 'abort', 'timeout', 'loadend'].forEach(function (n) { x['on' + n] = null; });

    function patchEv(ev) {
      try { Object.defineProperty(ev, 'target', { value: x, configurable: true }); } catch (e) {}
      try { Object.defineProperty(ev, 'currentTarget', { value: x, configurable: true }); } catch (e) {}
      try { Object.defineProperty(ev, 'srcElement', { value: x, configurable: true }); } catch (e) {}
      return ev;
    }

    function makeEv(n, loaded, total) {
      var ev;
      try {
        ev = (n === 'progress' || n === 'load' || n === 'loadstart' || n === 'loadend') && typeof ProgressEvent === 'function'
          ? new ProgressEvent(n, { lengthComputable: total > 0, loaded: loaded || 0, total: total || 0 })
          : new Event(n);
      } catch (e) { ev = new Event(n); }
      return patchEv(ev);
    }

    function fire(n, loaded, total) {
      var ev = makeEv(n, loaded, total), h = x['on' + n];
      if (typeof h === 'function') {
        try { h.call(x, ev); } catch (e) { setTimeout(function () { throw e; }); }
      }
      et.dispatchEvent(ev);
    }

    x.addEventListener = function (n, fn, o) {
      if (typeof fn !== 'function' && (!fn || typeof fn.handleEvent !== 'function')) return;
      var wrapped = fn._usvWrap || (fn._usvWrap = function (ev) {
        patchEv(ev);
        if (typeof fn === 'function') return fn.call(x, ev);
        return fn.handleEvent(ev);
      });
      et.addEventListener(n, wrapped, o);
    };
    x.removeEventListener = function (n, fn, o) {
      et.removeEventListener(n, (fn && fn._usvWrap) || fn, o);
    };
    x.dispatchEvent = function (e) { patchEv(e); return et.dispatchEvent(e); };

    function setRS(n) { st.rs = n; fire('readystatechange'); }
    function resp() {
      var t = x.responseType;
      if (t === 'json') { try { return JSON.parse(st.text); } catch (e) { return null; } }
      if (t === 'arraybuffer') {
        var b = st.bytes || new TextEncoder().encode(st.text);
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      }
      if (t === 'blob') return new Blob([st.bytes || st.text], { type: st.hdrs['content-type'] || '' });
      return st.text;
    }
    Object.defineProperties(x, {
      readyState: { get: function () { return st.rs; } },
      status: { get: function () { return st.status; } },
      statusText: { get: function () { return st.statusText; } },
      responseURL: { get: function () { return st.url; } },
      responseText: { get: function () { return st.text; } },
      response: { get: resp },
      responseXML: { get: function () { return null; } }
    });
    x.open = function (method, url) {
      m = String(method || 'GET').toUpperCase();
      u = abs(url);
      H = {}; done = false; aborted = false;
      st.url = u;
      setRS(1);
    };
    x.setRequestHeader = function (k, v) { k = String(k).toLowerCase(); H[k] = H[k] ? H[k] + ', ' + v : String(v); };
    x.getResponseHeader = function (k) { var v = st.hdrs[String(k).toLowerCase()]; return v === undefined ? null : v; };
    x.getAllResponseHeaders = function () { return Object.keys(st.hdrs).map(function (k) { return k + ': ' + st.hdrs[k]; }).join('\r\n'); };
    x.overrideMimeType = function () {};
    x.abort = function () {
      aborted = true;
      if (st.rs > 0 && !done) { done = true; st.rs = 0; fire('abort', 0, 0); fire('loadend', 0, 0); }
    };
    x.send = function (body) {
      if (!/^https?:/i.test(u) && OrigXHR) {
        // For blob: or data: URLs, delegate to native XHR
        var real = new OrigXHR();
        real.responseType = x.responseType;
        real.open(m, u, true);
        real.onload = function () {
          st.status = 200; st.url = u;
          if (x.responseType === 'arraybuffer') st.bytes = new Uint8Array(real.response);
          else st.text = real.responseText || '';
          var len = st.bytes ? st.bytes.byteLength : st.text.length;
          setRS(2); setRS(3); fire('progress', len, len); setRS(4); done = true; fire('load', len, len); fire('loadend', len, len);
        };
        real.onerror = function () { st.rs = 4; fire('readystatechange'); done = true; fire('error', 0, 0); fire('loadend', 0, 0); };
        real.send(body);
        return;
      }
      var b = bodyToString(body, H);
      fire('loadstart', 0, 0);
      net('xhr', u, m, H, b).then(function (j) {
        if (aborted) return;
        st.status = j.status; st.statusText = j.statusText || ''; st.url = j.finalUrl || u;
        st.hdrs = {};
        Object.keys(j.headers || {}).forEach(function (k) { st.hdrs[k.toLowerCase()] = j.headers[k]; });
        st.bytes = j.rawBytes || new TextEncoder().encode(j.body || '');
        if (j.encoding === 'text') {
          st.text = j.body || '';
        } else {
          st.text = '';
          try { st.text = new TextDecoder().decode(st.bytes); } catch (e) {}
        }
        var len = st.bytes ? st.bytes.byteLength : st.text.length;
        if (!st.hdrs['content-length']) st.hdrs['content-length'] = String(len);
        setRS(2);
        setRS(3);
        fire('progress', len, len);
        setRS(4);
        done = true;
        fire('load', len, len);
        fire('loadend', len, len);
      }, function () {
        if (aborted) return;
        st.rs = 4; fire('readystatechange'); done = true; fire('error', 0, 0); fire('loadend', 0, 0);
      });
    };
  }
  FakeXHR.UNSENT = 0; FakeXHR.OPENED = 1; FakeXHR.HEADERS_RECEIVED = 2; FakeXHR.LOADING = 3; FakeXHR.DONE = 4;
  FakeXHR.prototype = { UNSENT: 0, OPENED: 1, HEADERS_RECEIVED: 2, LOADING: 3, DONE: 4 };
  if (nativeFetch && typeof EventTarget === 'function') W.XMLHttpRequest = FakeXHR;

  /* Hook <video> and <audio> direct stream sources (.m3u8, .mp4, etc.) */
  var seenMedia = {};
  function logMediaSrc(u, tag) {
    if (!u || /^(blob|data):/i.test(u)) return;
    var full = abs(u);
    if (!/^https?:/i.test(full) || seenMedia[full]) return;
    seenMedia[full] = 1;
    post({
      type: 'req', phase: 'end', id: nid(), kind: 'stream', method: 'GET',
      url: full, resType: 'video/stream', status: 200, size: 0, ms: 0,
      resBody: 'Live Stream / Media Source (' + (tag || 'video') + '):\n' + full,
      clickId: clickNow(), t: Date.now()
    });
  }
  try {
    if (W.HTMLMediaElement && W.HTMLMediaElement.prototype) {
      var origPlay = W.HTMLMediaElement.prototype.play;
      if (origPlay) {
        W.HTMLMediaElement.prototype.play = function () {
          try { logMediaSrc(this.currentSrc || this.src, this.tagName); } catch (e) {}
          return origPlay.apply(this, arguments);
        };
      }
      var origLoad = W.HTMLMediaElement.prototype.load;
      if (origLoad) {
        W.HTMLMediaElement.prototype.load = function () {
          try { logMediaSrc(this.currentSrc || this.src, this.tagName); } catch (e) {}
          return origLoad.apply(this, arguments);
        };
      }
    }
  } catch (e) {}

  /* Monkey-patch sendBeacon */
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon = function (u, data) {
        var body = typeof data === 'string' ? data : (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams ? data.toString() : '');
        net('beacon', abs(u), 'POST', { 'content-type': 'text/plain;charset=UTF-8' }, body).catch(function () {});
        return true;
      };
    }
  } catch (e) {}

  /* Browser PerformanceObserver */
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) {
        var it = e.initiatorType;
        if (it === 'fetch' || it === 'xmlhttprequest' || it === 'beacon') return;
        if (e.name.indexOf(cfg.proxy) === 0 || /^(data|blob):/.test(e.name)) return;
        post({ type: 'req', phase: 'end', id: nid(), kind: 'resource', method: 'GET', url: e.name, resType: it, status: e.responseStatus || 0, size: e.transferSize || e.encodedBodySize || 0, ms: Math.round(e.duration), clickId: clickNow(), t: Date.now() });
      });
    }).observe({ type: 'resource', buffered: true });
  } catch (e) {}

  /* Click tracking (does NOT auto-hide previous network requests!) */
  function describe(el) {
    if (!el || !el.tagName) return '';
    var tag = el.tagName.toLowerCase(), s = tag;
    if (el.id) s += '#' + el.id;
    else if (typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.');
    var t = '';
    if (tag !== 'body' && tag !== 'html') t = String(el.getAttribute('aria-label') || el.value || el.alt || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return s + (t ? ' "' + t + '"' : '');
  }
  W.addEventListener('click', function (e) {
    var t = e.target, el = t && t.closest ? (t.closest('a,button,input,select,summary,[role=button],[onclick]') || t) : t;
    lastClick = { id: nid(), t: Date.now() };
    post({ type: 'click', id: lastClick.id, desc: describe(el), t: Date.now() });
  }, true);

  /* Intercept link navigation */
  W.addEventListener('click', function (e) {
    if (e.defaultPrevented) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var raw = a.getAttribute('href');
    if (!raw) return;
    if (raw.charAt(0) === '#') {
      e.preventDefault();
      var id = raw.slice(1);
      try { id = decodeURIComponent(id); } catch (x) {}
      var el = id ? (D.getElementById(id) || D.getElementsByName(id)[0]) : null;
      if (el) el.scrollIntoView(); else if (!id) W.scrollTo(0, 0);
      return;
    }
    if (/^(javascript|mailto|tel|sms|data|blob):/i.test(raw) || a.hasAttribute('download')) return;
    e.preventDefault();
    post({ type: 'navigate', method: 'GET', url: abs(raw), via: 'link', clickId: lastClick && lastClick.id });
  }, false);

  /* Safe one-pass fix for dynamic forms, child iframes, and cross-origin scripts (ZERO recursion / ZERO hang) */
  var origSetAttr = Element.prototype.setAttribute;
  function fixOneEl(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.tagName === 'SCRIPT' || el.tagName === 'LINK') {
      if (el.hasAttribute('integrity')) { try { el.removeAttribute('integrity'); } catch (e) {} }
      if (el.hasAttribute('crossorigin') && el.getAttribute('type') !== 'module') {
        try { el.removeAttribute('crossorigin'); } catch (e) {}
      }
    } else if (el.tagName === 'FORM') {
      var rawAct = el.getAttribute('action');
      var fixedAct = (!rawAct || rawAct === 'about:srcdoc' || rawAct === 'srcdoc') ? (cfg.page || cfg.base || '') : abs(rawAct);
      if (fixedAct && fixedAct !== rawAct) {
        try { origSetAttr.call(el, 'action', fixedAct); } catch (e) {}
      }
    } else if (el.tagName === 'IFRAME') {
      var rawSrc = el.getAttribute('src');
      if (rawSrc === '' || rawSrc === 'about:srcdoc' || rawSrc === 'srcdoc') {
        if (rawSrc !== 'about:blank') {
          try { origSetAttr.call(el, 'src', 'about:blank'); } catch (e) {}
        }
      } else if (rawSrc && !/^(about:|javascript:|data:|blob:)/i.test(rawSrc)) {
        var fixedSrc = abs(rawSrc);
        if (fixedSrc && fixedSrc !== rawSrc) {
          try { origSetAttr.call(el, 'src', fixedSrc); } catch (e) {}
        }
      }
    }
  }
  function fixNode(root) {
    if (!root || root.nodeType !== 1) return;
    fixOneEl(root);
    if (root.querySelectorAll) {
      root.querySelectorAll('form,iframe,script[crossorigin],link[crossorigin],script[integrity],link[integrity]').forEach(fixOneEl);
    }
  }

  /* Prevent webpack dynamic chunks from failing CORS in about:srcdoc when setting script.crossOrigin */
  try {
    if (W.HTMLScriptElement && W.HTMLScriptElement.prototype) {
      Object.defineProperty(W.HTMLScriptElement.prototype, 'crossOrigin', {
        configurable: true,
        get: function () { return null; },
        set: function () {}
      });
    }
  } catch (e) {}

  /* Prevent SecurityError when Next.js / SPA scripts call history.pushState/replaceState inside srcdoc & preserve history.state */
  var currentHistoryState = null;
  var lastSpaUrl = '';
  ['pushState', 'replaceState'].forEach(function (fn) {
    var orig = W.history && W.history[fn];
    if (!orig) return;
    W.history[fn] = function (state, title, url) {
      if (state !== undefined) currentHistoryState = state;
      if (url != null && String(url).trim()) {
        var resolvedUrl = abs(url);
        if (/^https?:/i.test(resolvedUrl)) {
          lastSpaUrl = resolvedUrl;
          cfg.page = resolvedUrl;
          try { pageUrl = new OrigURL(resolvedUrl); } catch (e) {}
        }
      }
      try { return orig.call(this, state, title); } catch (e) {}
    };
  });
  try {
    var nativeStateDesc = Object.getOwnPropertyDescriptor(History.prototype, 'state');
    Object.defineProperty(W.history, 'state', {
      configurable: true,
      get: function () {
        if (currentHistoryState !== null) return currentHistoryState;
        try { return nativeStateDesc && nativeStateDesc.get ? nativeStateDesc.get.call(this) : null; } catch (e) { return null; }
      }
    });
  } catch (e) {}

  /* Automatic SSR DOM Snapshot Recovery:
     If Next.js / React / Nuxt throws "Application error: a client-side exception has occurred"
     or wipes the body blank during client hydration in srcdoc, immediately restore the SSR DOM! */
  var ssrRecovered = false;
  var recoverTimer = 0;
  function isClientCrashScreen() {
    if (!D.body) return false;
    var txt = String(D.body.innerText || D.body.textContent || '').trim();
    if (/Application error:\s*a client-side exception has occurred/i.test(txt)) return true;
    if (/Unhandled Runtime Error/i.test(txt) && txt.length < 800) return true;
    if (/Minified React error #\d+/i.test(txt) && txt.length < 800) return true;
    if (cfg.ssrBody && cfg.ssrBody.length > 180 && txt.length === 0 && !D.body.querySelector('canvas,video,iframe,svg,img,input,button,a')) {
      return true;
    }
    return false;
  }

  function checkAndRecoverSsr() {
    if (!D.body || !isClientCrashScreen()) return;
    /* If user just clicked something that triggered a SPA route push (e.g. /login) and client hydration crashed, navigate to the new URL! */
    if (lastSpaUrl && lastClick && Date.now() - lastClick.t < 3500 && lastSpaUrl !== (cfg.initialPage || '')) {
      var navTarget = lastSpaUrl;
      lastSpaUrl = '';
      post({ type: 'navigate', method: 'GET', url: navTarget, via: 'spa-recovery', clickId: lastClick.id });
      return;
    }
    if (!cfg.ssrBody) return;
    try {
      if (cfg.ssrHtmlClass && !D.documentElement.className) D.documentElement.className = cfg.ssrHtmlClass;
      if (cfg.ssrHtmlStyle && !D.documentElement.getAttribute('style')) D.documentElement.setAttribute('style', cfg.ssrHtmlStyle);
      if (cfg.ssrBodyClass) D.body.className = cfg.ssrBodyClass;
      if (cfg.ssrBodyStyle) D.body.setAttribute('style', cfg.ssrBodyStyle);
      D.body.innerHTML = cfg.ssrBody;
      if (!D.getElementById('__usv_ssr_reveal__')) {
        var st = D.createElement('style');
        st.id = '__usv_ssr_reveal__';
        st.textContent = '[style*="opacity:0"],[style*="opacity: 0"]{opacity:1!important;transform:none!important}[style*="visibility:hidden"],[style*="visibility: hidden"]{visibility:visible!important}';
        (D.head || D.documentElement).appendChild(st);
      }
      fixNode(D.body);
      if (!ssrRecovered) {
        ssrRecovered = true;
        post({ type: 'console', level: 'warn', args: ['[USV Auto-Recovery] Next.js/SPA client-side exception intercepted — SSR Website UI restored cleanly!'], t: Date.now() });
      }
    } catch (e) {}
  }

  function scheduleSsrCheck(delay) {
    clearTimeout(recoverTimer);
    recoverTimer = setTimeout(checkAndRecoverSsr, delay || 25);
  }

  W.addEventListener('error', function () { scheduleSsrCheck(20); });
  W.addEventListener('unhandledrejection', function () { scheduleSsrCheck(20); });

  /* If SSR Recovery ran and user clicks a React <button> (e.g. "Get Started", "Sign In", "Login"), route to matching link or path */
  W.addEventListener('click', function (e) {
    if (!ssrRecovered || e.defaultPrevented) return;
    var btn = e.target && e.target.closest ? e.target.closest('button,[role="button"]') : null;
    if (!btn || btn.closest('a[href]') || (btn.tagName === 'BUTTON' && btn.type === 'submit' && btn.closest('form'))) return;
    var explicitUrl = btn.getAttribute('data-href') || btn.getAttribute('data-url') || btn.getAttribute('formaction');
    if (explicitUrl) {
      e.preventDefault();
      post({ type: 'navigate', method: 'GET', url: abs(explicitUrl), via: 'button', clickId: lastClick && lastClick.id });
      return;
    }
    var label = String(btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
    if (!label) return;
    var links = Array.prototype.slice.call(D.querySelectorAll('a[href]'));
    for (var i = 0; i < links.length; i++) {
      var ltxt = String(links[i].textContent || '').trim().toLowerCase();
      var lhref = links[i].getAttribute('href') || '';
      if (ltxt && ltxt === label && lhref && lhref.charAt(0) !== '#') {
        e.preventDefault();
        post({ type: 'navigate', method: 'GET', url: abs(lhref), via: 'button-match', clickId: lastClick && lastClick.id });
        return;
      }
    }
    var slugMap = [
      [/sign\s*in|log\s*in|login/i, '/login'],
      [/sign\s*up|register|get\s*started|start\s*now/i, '/login'],
      [/dashboard|panel|console/i, '/dashboard'],
      [/pricing|plans/i, '/pricing'],
      [/docs|documentation/i, '/docs']
    ];
    for (var j = 0; j < slugMap.length; j++) {
      if (slugMap[j][0].test(label)) {
        var candidateHref = slugMap[j][1];
        for (var k = 0; k < links.length; k++) {
          var h = links[k].getAttribute('href') || '';
          if (h.toLowerCase().indexOf(candidateHref) > -1) { candidateHref = h; break; }
        }
        e.preventDefault();
        post({ type: 'navigate', method: 'GET', url: abs(candidateHref), via: 'button-route', clickId: lastClick && lastClick.id });
        return;
      }
    }
  }, false);

  /* Auto-hide any broken child iframe that accidentally loads a Vercel 404 NOT_FOUND page */
  W.addEventListener('load', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IFRAME') {
      try {
        var docText = t.contentDocument && t.contentDocument.body ? t.contentDocument.body.innerText : '';
        if (docText && (docText.indexOf('NOT_FOUND') > -1 || docText.indexOf('The page could not be found') > -1)) {
          t.style.display = 'none';
        }
      } catch (_) {}
    }
    scheduleSsrCheck(40);
  }, true);

  W.addEventListener('DOMContentLoaded', function () {
    fixNode(D.documentElement);
    scheduleSsrCheck(30);
    setTimeout(checkAndRecoverSsr, 250);
    setTimeout(checkAndRecoverSsr, 900);
    setTimeout(checkAndRecoverSsr, 2200);
  });
  try {
    new MutationObserver(function (muts) {
      var bodyChanged = false;
      muts.forEach(function (m) {
        if (m.target === D.body || m.target === D.documentElement || (m.removedNodes && m.removedNodes.length)) {
          bodyChanged = true;
        }
        m.addedNodes.forEach(function (n) {
          if (n && n.nodeType === 1) {
            fixNode(n);
            bodyChanged = true;
          }
        });
      });
      if (bodyChanged) scheduleSsrCheck(20);
    }).observe(D.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  /* Intercept user-triggered location.href / location.assign / location.replace via Navigation API (never abort initial Next.js replaceState) */
  try {
    if (W.navigation && W.navigation.addEventListener) {
      W.navigation.addEventListener('navigate', function (e) {
        if (!e.cancelable || e.hashChange || e.downloadRequest || e.formData) return;
        if (e.navigationType === 'replace' && !e.userInitiated && !(lastClick && Date.now() - lastClick.t < 2500)) return;
        var dest = e.destination && e.destination.url ? e.destination.url : '';
        if (!dest || /^about:srcdoc(#|$)/i.test(dest) || /^(javascript|mailto|tel|blob|data):/i.test(dest)) return;
        if (/\/srcdoc(\?|$)/.test(dest) && !e.userInitiated) return;
        var targetUrl = abs(dest);
        if (!/^https?:/i.test(targetUrl)) return;
        if (!e.userInitiated && !(lastClick && Date.now() - lastClick.t < 2500) && targetUrl === (cfg.page || cfg.base)) return;
        e.preventDefault();
        post({ type: 'navigate', method: 'GET', url: targetUrl, via: 'location', clickId: clickNow() });
      });
    }
  } catch (e) {}

  /* Intercept form submit */
  function submitForm(f, sub) {
    var method = String((sub && sub.getAttribute && sub.getAttribute('formmethod') ? sub.formMethod : (f.getAttribute('method') || f.method)) || 'get').toUpperCase();
    var rawAct = (sub && sub.getAttribute && sub.getAttribute('formaction')) || f.getAttribute('action') || '';
    var action = abs(rawAct);
    var fd;
    try { fd = new FormData(f, sub || undefined); } catch (e) { fd = new FormData(f); }
    var qs = new URLSearchParams();
    fd.forEach(function (v, k) { qs.append(k, typeof v === 'string' ? v : (v && v.name) || ''); });
    var cid = lastClick && lastClick.id;
    if (method === 'GET') {
      var u = new URL(action, cfg.base || cfg.page || undefined);
      u.search = qs.toString();
      post({ type: 'navigate', method: 'GET', url: u.href, via: 'form', clickId: cid, cookies: getCookieStr() });
    } else {
      post({ type: 'navigate', method: method, url: action, body: qs.toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' }, via: 'form', clickId: cid, cookies: getCookieStr() });
    }
  }
  W.addEventListener('submit', function (e) {
    if (e.defaultPrevented) return;
    e.preventDefault();
    submitForm(e.target, e.submitter);
  }, false);
  try { HTMLFormElement.prototype.submit = function () { submitForm(this); }; } catch (e) {}
  try { W.open = function (u) { if (u) post({ type: 'navigate', method: 'GET', url: abs(u), via: 'window.open' }); return null; }; } catch (e) {}
}

/* ------------------------------------------------------------------
   Preview rendering
------------------------------------------------------------------ */
function buildPreview(html, base, runJs) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('meta[http-equiv="Content-Security-Policy" i]').forEach(function (n) { n.remove(); });
  doc.querySelectorAll('script[integrity],link[integrity]').forEach(function (n) { n.removeAttribute('integrity'); });
  doc.querySelectorAll('script[crossorigin],link[crossorigin]').forEach(function (n) {
    if (n.tagName !== 'SCRIPT' || n.getAttribute('type') !== 'module') {
      n.removeAttribute('crossorigin');
    }
  });
  var eff = base || '', be = doc.querySelector('base[href]');
  if (be) { try { eff = new URL(be.getAttribute('href'), base || undefined).href; } catch (e) {} be.remove(); }
  if (eff) {
    doc.querySelectorAll('form').forEach(function (f) {
      var act = f.getAttribute('action');
      if (!act) f.setAttribute('action', base || eff);
      else { try { f.setAttribute('action', new URL(act, eff).href); } catch (e) {} }
    });
    doc.querySelectorAll('iframe').forEach(function (ifr) {
      var src = ifr.getAttribute('src');
      if (src === '') ifr.setAttribute('src', 'about:blank');
      else if (src && !/^(about:|javascript:|data:|blob:)/i.test(src)) {
        try { ifr.setAttribute('src', new URL(src, eff).href); } catch (e) {}
      }
    });
  }

  /* Capture clean Server-Side Rendered (SSR) snapshot before client scripts execute */
  var ssrBody = '', ssrBodyClass = '', ssrBodyStyle = '', ssrHtmlClass = '', ssrHtmlStyle = '';
  if (doc.body) {
    try {
      var clone = doc.body.cloneNode(true);
      clone.querySelectorAll('script,noscript,template').forEach(function (n) { n.remove(); });
      var rawSsr = clone.innerHTML.trim();
      if (rawSsr.length > 40 && !/Application error:\s*a client-side exception has occurred/i.test(rawSsr)) {
        ssrBody = rawSsr;
        ssrBodyClass = doc.body.className || '';
        ssrBodyStyle = doc.body.getAttribute('style') || '';
        ssrHtmlClass = doc.documentElement.className || '';
        ssrHtmlStyle = doc.documentElement.getAttribute('style') || '';
      }
    } catch (e) {}
  }

  /* Inject already-fetched external CSS inline as fallback so CORS/CORP never leaves the page unstyled */
  if (window.USV && window.USV.extCss) {
    try {
      var cssList = window.USV.extCss() || [];
      cssList.forEach(function (c) {
        if (!c || !c.text || c.failed) return;
        var st = doc.createElement('style');
        st.setAttribute('data-usv-css', c.url || '');
        var fixedCss = c.text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, function (m, q, u) {
          u = u.trim();
          if (/^(data:|blob:|https?:|#)/i.test(u)) return m;
          try { return 'url("' + new URL(u, c.url || eff).href + '")'; } catch (e) { return m; }
        });
        st.textContent = fixedCss;
        doc.head.appendChild(st);
      });
    } catch (e) {}
  }

  if (!runJs) doc.querySelectorAll('script').forEach(function (n) { n.remove(); });
  var web = /^https?:/.test(location.protocol);
  var cookies = (window.USV && window.USV.getCookies && base) ? window.USV.getCookies(base) : '';
  var cfg = {
    proxy: (web ? location.origin : '') + '/api/proxy',
    proxyOk: !!(web && window.USV && window.USV.apiOk()),
    page: base || '',
    initialPage: base || '',
    base: eff,
    cookies: cookies,
    ssrBody: ssrBody,
    ssrBodyClass: ssrBodyClass,
    ssrBodyStyle: ssrBodyStyle,
    ssrHtmlClass: ssrHtmlClass,
    ssrHtmlStyle: ssrHtmlStyle
  };
  var s = doc.createElement('script');
  s.textContent = '(' + spy.toString() + ')(' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ');';
  var head = doc.head;
  if (eff) {
    var b = doc.createElement('base');
    b.setAttribute('href', eff);
    head.insertBefore(b, head.firstChild);
    head.insertBefore(s, b.nextSibling);
  } else head.insertBefore(s, head.firstChild);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

function updateDeviceStyle() {
  var st = $('#pvStage');
  if (!st) return;
  st.classList.remove('mob', 'tab', 'lap', 'rot');
  if (deviceMode === 'mob') st.classList.add('mob');
  else if (deviceMode === 'tab') st.classList.add('tab');
  else if (deviceMode === 'lap') st.classList.add('lap');
  if (rotated) st.classList.add('rot');
}

function render(html, base) {
  last = { html: html, base: base || '' };
  var f = $('#frame');
  if (!f) return;
  var runJs = window.USV ? window.USV.runJs() : true;
  try { f.srcdoc = buildPreview(html, base, runJs); }
  catch (e) { f.srcdoc = '<p style="font:14px system-ui;padding:16px">Preview nahi ban saka.</p>'; }
  $('#pvUrl').textContent = base || 'Local HTML (sample ya paste kiya hua)';
  $('#pvEmpty').hidden = true;
  updateDeviceStyle();
}

/* ------------------------------------------------------------------
   Network & Console Log State
------------------------------------------------------------------ */
function num(v) { v = Number(v); return isFinite(v) ? v : null; }
function str(v, n) { return String(v == null ? '' : v).slice(0, n || 4000); }
function obj(v) { var o = {}; if (v && typeof v === 'object') Object.keys(v).slice(0, 80).forEach(function (k) { o[str(k, 120)] = str(v[k], 4000); }); return o; }

function netChanged() { if (window.USV && window.USV.netChanged) window.USV.netChanged(); }
function schedule() { if (timer) return; timer = setTimeout(function () { timer = 0; renderNet(); netChanged(); }, 40); }

function trim() {
  if (ORDER.length <= MAX_KEEP) return;
  ORDER.splice(0, ORDER.length - MAX_KEEP).forEach(function (id) { NET.delete(id); });
}

function upsert(m) {
  var id = str(m.id, 40);
  if (!id) return;
  var e = NET.get(id);
  if (!e) {
    e = { id: id, kind: 'fetch', method: 'GET', url: '', reqHeaders: {}, resHeaders: {}, status: null, t: m.t || Date.now() };
    NET.set(id, e); ORDER.push(id); trim();
  }
  if (m.kind) e.kind = str(m.kind, 12);
  if (m.method) e.method = str(m.method, 10).toUpperCase();
  if (m.url) e.url = str(m.url, 2000);
  if (m.reqHeaders) e.reqHeaders = obj(m.reqHeaders);
  if (m.resHeaders) e.resHeaders = obj(m.resHeaders);
  if (m.reqBody != null) e.reqBody = str(m.reqBody, 35000);
  if (m.resBody != null) e.resBody = str(m.resBody, 35000);
  if (m.status != null) e.status = num(m.status);
  if (m.statusText != null) e.statusText = str(m.statusText, 80);
  if (m.size != null) e.size = num(m.size);
  if (m.ms != null) e.ms = num(m.ms);
  if (m.resType != null) e.resType = str(m.resType, 120);
  if (m.redirected) e.redirected = str(m.redirected, 2000);
  if (m.error) e.error = str(m.error, 300);
  if (m.clickId) e.clickId = str(m.clickId, 40);
  if (m.trigger) e.trigger = str(m.trigger, 200);
  if (m.phase === 'end') e.done = true;
  schedule();
}

function addClick(m) {
  var id = str(m.id, 40);
  if (!id || NET.has(id)) return;
  NET.set(id, { id: id, kind: 'click', desc: str(m.desc, 120), t: m.t || Date.now() });
  ORDER.push(id); trim();
  // Do NOT auto-set F.click = id so earlier API & stream requests stay visible!
  schedule();
}

function addConsole(m) {
  CONSOLE_LOGS.push({ level: m.level || 'log', args: m.args || [], t: m.t || Date.now() });
  if (CONSOLE_LOGS.length > 500) CONSOLE_LOGS.shift();
  if (F.viewMode === 'console') renderConsole();
}

function reset() {
  NET.clear(); ORDER = []; CONSOLE_LOGS = []; F.click = null; SEL = null;
  renderNet();
  netChanged();
}

function logDoc(d) {
  var id = 'doc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  upsert({ id: id, kind: 'document', method: d.method, url: d.url, reqHeaders: d.reqHeaders, reqBody: d.reqBody, resHeaders: d.resHeaders, resBody: d.resBody, status: d.status, size: d.size, ms: d.ms, resType: d.resType, redirected: d.redirected, error: d.error, phase: 'end' });
}

function nameOf(u) {
  try {
    var x = new URL(u), p = x.pathname.split('/').filter(Boolean).pop() || x.host;
    return { name: (p + x.search).slice(0, 80), host: x.host };
  } catch (e) { return { name: str(u, 80), host: '' }; }
}

function isStreamEntry(e) {
  var u = (e.url || '').toLowerCase();
  var t = (e.resType || '').toLowerCase();
  return e.kind === 'stream' || /\.(m3u8|mpd|ts|m4s|mp4|webm|aac|mp3)(?=$|[?#])/i.test(u) || /mpegurl|dash\+xml|video\/|audio\//i.test(t);
}

function group(e) {
  var k = e.kind;
  if (isStreamEntry(e)) return 'stream';
  if (k === 'fetch' || k === 'xhr' || k === 'beacon') return 'xhr';
  if (k === 'document') return 'doc';
  var t = (e.resType || '').toLowerCase(), u = e.url.split('?')[0].toLowerCase();
  if (t === 'script' || /\.m?js$/.test(u)) return 'js';
  if (t === 'css' || /\.css$/.test(u)) return 'css';
  if (t === 'img' || /\.(png|jpe?g|gif|webp|svg|ico|avif)$/.test(u)) return 'img';
  return 'other';
}

function typeLabel(e) {
  if (isStreamEntry(e)) {
    if (/\.m3u8(?=$|[?#])/i.test(e.url)) return 'HLS m3u8';
    if (/\.mpd(?=$|[?#])/i.test(e.url)) return 'DASH mpd';
    if (/\.ts(?=$|[?#])/i.test(e.url)) return 'HLS .ts';
    return 'stream';
  }
  if (e.kind !== 'resource') return e.kind;
  var g = group(e);
  return g === 'other' ? (e.resType || 'other') : g;
}
function mc(m) { return m === 'GET' ? 'get' : m === 'POST' ? 'post' : 'other'; }
function stText(e) { return e.error ? 'ERR' : e.status == null ? '...' : e.status === 0 ? '-' : String(e.status); }
function stClass(e) {
  if (e.error) return 'bad';
  if (e.status == null) return 'pend';
  if (e.status === 0) return 'mute';
  return e.status < 300 ? 'ok' : e.status < 400 ? 'warn' : 'bad';
}

function visible(e) {
  if (e.kind === 'click') return F.click ? e.id === F.click : (F.type === 'all' && !F.q);
  if (F.click && e.clickId !== F.click) return false;
  if (F.type !== 'all') {
    var g = group(e);
    if (F.type === 'xhr') {
      if (g !== 'xhr' && !(g === 'stream' && (e.kind === 'fetch' || e.kind === 'xhr'))) return false;
    } else if (g !== F.type) return false;
  }
  if (F.q) {
    var q = F.q.toLowerCase();
    if ((e.url + ' ' + e.method + ' ' + (e.status == null ? '' : e.status) + ' ' + typeLabel(e)).toLowerCase().indexOf(q) < 0) return false;
  }
  return true;
}

function rowHtml(e) {
  if (e.kind === 'click') {
    return '<button class="nclick" type="button" data-click="' + esc(e.id) + '"><span>Click</span>' + esc(e.desc || '') + ' <small style="opacity:.7;float:right">(Filter karne ke liye dabayen)</small></button>';
  }
  var n = nameOf(e.url);
  return '<button class="nrow' + (SEL === e.id ? ' sel' : '') + '" type="button" data-id="' + esc(e.id) + '" title="' + esc(e.url) + '">' +
    '<span class="m m-' + mc(e.method) + '">' + esc(e.method) + '</span>' +
    '<span class="st ' + stClass(e) + '">' + esc(stText(e)) + '</span>' +
    '<span class="nm"><b>' + esc(n.name) + '</b><i>' + esc(n.host) + '</i></span>' +
    '<span class="mt">' + esc(typeLabel(e)) + (e.ms != null ? ' · ' + e.ms + ' ms' : '') + (e.size ? ' · ' + fmtB(e.size) : '') + '</span></button>';
}

function renderConsole() {
  var list = $('#nList');
  if (!list) return;
  if (!CONSOLE_LOGS.length) {
    list.innerHTML = '<p class="hint">Console khali hai. Website preview mein scripts ke console.log / warn / error yahan dikhenge.</p>';
    return;
  }
  var html = CONSOLE_LOGS.map(function (c) {
    var color = c.level === 'error' ? 'var(--bad)' : c.level === 'warn' ? 'var(--warn)' : 'var(--fg)';
    var prefix = c.level.toUpperCase();
    var time = new Date(c.t).toLocaleTimeString();
    return '<div style="padding:6px 10px;border-bottom:1px solid var(--line);font:500 12px var(--f-code);display:flex;gap:8px;color:' + color + '">' +
      '<span style="opacity:0.6;font-size:11px">' + time + '</span>' +
      '<span class="chip ' + (c.level === 'error' ? 'bad' : c.level === 'warn' ? 'warn' : '') + '" style="font-size:10px;padding:1px 6px">' + prefix + '</span>' +
      '<span style="flex:1;white-space:pre-wrap;overflow-wrap:anywhere">' + esc(c.args.join(' ')) + '</span></div>';
  }).join('');
  list.innerHTML = html;
  list.scrollTop = list.scrollHeight;
}

function renderNet() {
  var list = $('#nList'), det = $('#nDet');
  if (!list) return;
  if (F.viewMode === 'console') {
    renderConsole();
    return;
  }

  var reqs = ORDER.filter(function (id) { return NET.get(id).kind !== 'click'; }).length;
  $('#nCount').textContent = reqs + ' requests';

  var chip = $('#nChip');
  if (F.click && NET.has(F.click)) {
    chip.hidden = false;
    chip.innerHTML = '<span>Sirf is click ke requests: ' + esc(NET.get(F.click).desc) + '</span><button class="sm" type="button" data-act="allclicks">Sab dikhao</button>';
  } else chip.hidden = true;

  if (SEL && NET.has(SEL)) {
    list.hidden = true; chip.hidden = true; det.hidden = false;
    renderDetail();
    return;
  }
  SEL = null; list.hidden = false; det.hidden = true;
  var ids = ORDER.filter(function (id) { return visible(NET.get(id)); });
  var more = ids.length - MAX_ROWS;
  if (more > 0) ids = ids.slice(-MAX_ROWS);
  if (!ids.length) {
    list.innerHTML = '<p class="hint">' + (reqs ? 'Is filter mein koi request nahi. "Sab" chunein.' : 'Abhi koi request nahi. Website mein kisi button ya channel par click karein, uski requests aur .m3u8 streams yahan aayengi.') + '</p>';
    return;
  }
  var atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 40;
  list.innerHTML = (more > 0 ? '<p class="hint">Purani ' + more + ' requests chhupi hain, filter lagayen.</p>' : '') + ids.map(function (id) { return rowHtml(NET.get(id)); }).join('');
  if (atBottom) list.scrollTop = list.scrollHeight;
}

/* ------------------------------------------------------------------
   Request Detail with Multi-language Code & Replayer
------------------------------------------------------------------ */
function table(pairs) {
  if (!pairs.length) return '<p class="hint">Khali.</p>';
  return '<div class="tblwrap"><table class="tbl">' + pairs.map(function (p) { return '<tr><th>' + esc(p[0]) + '</th><td>' + esc(p[1]) + '</td></tr>'; }).join('') + '</table></div>';
}
function pairsOf(o) { return Object.keys(o || {}).map(function (k) { return [k, o[k]]; }); }
function tryJson(s) { try { var v = JSON.parse(s); return typeof v === 'object' && v !== null ? v : undefined; } catch (e) { return undefined; } }
function qsPairs(s) { var out = []; try { new URLSearchParams(s).forEach(function (v, k) { out.push([k, v]); }); } catch (e) {} return out; }
function queryOf(u) { try { return qsPairs(new URL(u).search); } catch (e) { return []; } }

function hdrHtml(e) {
  var click = e.clickId && NET.get(e.clickId) ? NET.get(e.clickId).desc : '';
  var gen = [
    ['URL', e.url], ['Method', e.method],
    ['Status', e.error ? 'Fail: ' + e.error : (e.status == null ? 'Intezar...' : e.status + (e.statusText ? ' ' + e.statusText : ''))],
    ['Type', typeLabel(e)]
  ];
  if (e.ms != null) gen.push(['Latency', e.ms + ' ms']);
  if (e.size) gen.push(['Size', fmtB(e.size)]);
  if (e.redirected) gen.push(['Redirected to', e.redirected]);
  if (click) gen.push(['Click se', click]);
  return '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="sm" type="button" data-copy="url">📋 Copy Full URL</button></div>' +
    '<h4>General Info</h4>' + table(gen) +
    '<h4>Request Headers</h4>' + (e.kind === 'resource' ? '<p class="hint">Browser ne khud load kiya, headers dastiyab nahi.</p>' : table(pairsOf(e.reqHeaders))) +
    '<h4>Response Headers</h4>' + (e.kind === 'resource' ? '<p class="hint">Browser resources ke headers nahi dikhata.</p>' : table(pairsOf(e.resHeaders)));
}

function payHtml(e) {
  var out = '', qp = queryOf(e.url);
  if (qp.length) out += '<h4>Query parameters</h4>' + table(qp);
  if (e.reqBody) {
    out += '<h4>Request body</h4>';
    var ct = (e.reqHeaders && e.reqHeaders['content-type']) || '', j = tryJson(e.reqBody);
    if (j !== undefined) out += '<pre>' + esc(JSON.stringify(j, null, 2)) + '</pre>';
    else if (/x-www-form-urlencoded/i.test(ct)) out += table(qsPairs(e.reqBody));
    else out += '<pre>' + esc(e.reqBody) + '</pre>';
  }
  return out || '<p class="hint">Is request ke saath koi data (payload) nahi gaya.</p>';
}

function resHtml(e) {
  if (e.error) return '<p class="hint">Request fail hui: ' + esc(e.error) + '</p>';
  if (!e.resBody) return '<p class="hint">' + (e.kind === 'resource' ? 'Browser ne ye resource khud load kiya, iski body save nahi hoti.' : 'Response ki body khali hai ya abhi nahi aayi.') + '</p>';
  var j = tryJson(e.resBody);
  return '<div style="display:flex;gap:6px;flex-wrap:wrap"><button class="sm" type="button" data-copy="res">📋 Copy Response</button><button class="sm" type="button" data-copy="url">📋 Copy URL</button></div><pre>' + esc(j !== undefined ? JSON.stringify(j, null, 2) : e.resBody) + '</pre>';
}

function sq(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function curlOf(e) {
  var p = ['curl ' + sq(e.url)];
  if (e.method !== 'GET') p.push('-X ' + e.method);
  Object.keys(e.reqHeaders || {}).forEach(function (k) { p.push('-H ' + sq(k + ': ' + e.reqHeaders[k])); });
  if (e.reqBody) p.push('--data-raw ' + sq(e.reqBody));
  return p.join(' \\\n  ');
}
function fetchOf(e) {
  var o = { method: e.method };
  if (Object.keys(e.reqHeaders || {}).length) o.headers = e.reqHeaders;
  if (e.reqBody) o.body = e.reqBody;
  return 'const res = await fetch(' + JSON.stringify(e.url) + ', ' + JSON.stringify(o, null, 2) + ');\nconst data = await res.text();\nconsole.log(res.status, data);';
}
function pyOf(e) {
  var h = JSON.stringify(e.reqHeaders || {}, null, 2);
  var b = e.reqBody ? 'data=' + JSON.stringify(e.reqBody) : '';
  return 'import requests\n\nheaders = ' + h + '\nres = requests.' + e.method.toLowerCase() + '("' + e.url + '", headers=headers' + (b ? ', ' + b : '') + ')\nprint(res.status_code, res.text)';
}
function axiosOf(e) {
  return 'const axios = require("axios");\n\nconst res = await axios({\n  method: "' + e.method.toLowerCase() + '",\n  url: "' + e.url + '",\n  headers: ' + JSON.stringify(e.reqHeaders || {}) + (e.reqBody ? ',\n  data: ' + JSON.stringify(e.reqBody) : '') + '\n});\nconsole.log(res.status, res.data);';
}

function codeHtml(e) {
  return '<h4>cURL</h4><pre>' + esc(curlOf(e)) + '</pre><button class="sm" type="button" data-copy="curl">Copy cURL</button>' +
    '<h4>JavaScript Fetch</h4><pre>' + esc(fetchOf(e)) + '</pre><button class="sm" type="button" data-copy="fetch">Copy Fetch</button>' +
    '<h4>Python (requests)</h4><pre>' + esc(pyOf(e)) + '</pre><button class="sm" type="button" data-copy="py">Copy Python</button>' +
    '<h4>Node.js (Axios)</h4><pre>' + esc(axiosOf(e)) + '</pre><button class="sm" type="button" data-copy="axios">Copy Axios</button>' +
    '<button class="sm" type="button" data-copy="url">Copy URL</button>';
}

function replayHtml(e) {
  var methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  var mOpts = methods.map(function (m) { return '<option value="' + m + '"' + (m === e.method ? ' selected' : '') + '>' + m + '</option>'; }).join('');
  var hStr = JSON.stringify(e.reqHeaders || {}, null, 2);
  var bStr = e.reqBody || '';

  return '<h4>API Request Runner & Replay</h4>' +
    '<div style="display:grid;gap:8px">' +
    '<div style="display:flex;gap:6px">' +
    '<select class="sm" id="repMeth" style="width:100px">' + mOpts + '</select>' +
    '<input class="sm" id="repUrl" type="url" value="' + esc(e.url) + '" style="flex:1">' +
    '<button class="btn go" id="repSend" type="button" style="height:32px;padding:0 14px">Send / Run</button>' +
    '</div>' +
    '<h4>Headers (JSON format)</h4>' +
    '<textarea id="repHdrs" style="width:100%;height:80px;font:400 12px var(--f-code);background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px">' + esc(hStr) + '</textarea>' +
    '<h4>Payload / Body</h4>' +
    '<textarea id="repBody" style="width:100%;height:80px;font:400 12px var(--f-code);background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:8px">' + esc(bStr) + '</textarea>' +
    '<div id="repResult"></div>' +
    '</div>';
}

function renderDetail() {
  var e = NET.get(SEL), box = $('#nDet');
  if (!e) return;
  var tabs = [['headers', 'Headers'], ['payload', 'Payload'], ['response', 'Response'], ['code', 'Code'], ['replay', 'Replay']];
  var body = DTAB === 'payload' ? payHtml(e) : DTAB === 'response' ? resHtml(e) : DTAB === 'code' ? codeHtml(e) : DTAB === 'replay' ? replayHtml(e) : hdrHtml(e);
  box.innerHTML = '<div class="dbar"><button class="sm" type="button" data-act="back">&larr; Wapas</button>' +
    '<span class="m m-' + mc(e.method) + '">' + esc(e.method) + '</span><span class="st ' + stClass(e) + '">' + esc(stText(e)) + '</span>' +
    '<div class="dtabs">' + tabs.map(function (t) { return '<button class="sm" type="button" data-tab="' + t[0] + '" aria-pressed="' + (DTAB === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div></div>' +
    '<div class="dbody">' + body + '</div>';
}

function copy(text, btn) {
  var done = function () { var o = btn.textContent; btn.textContent = 'Ho gaya'; setTimeout(function () { btn.textContent = o; }, 1100); };
  var fb = function () {
    var ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); done();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fb); else fb();
}

/* ------------------------------------------------------------------
   Export HAR (HTTP Archive 1.2)
------------------------------------------------------------------ */
function exportHar() {
  var entries = ORDER.map(function (id) { return NET.get(id); }).filter(function (e) {
    return e && e.kind !== 'click';
  }).map(function (e) {
    var started = new Date(e.t || Date.now()).toISOString();
    var reqHdrs = Object.keys(e.reqHeaders || {}).map(function (k) { return { name: k, value: e.reqHeaders[k] }; });
    var resHdrs = Object.keys(e.resHeaders || {}).map(function (k) { return { name: k, value: e.resHeaders[k] }; });
    return {
      startedDateTime: started,
      time: e.ms || 0,
      request: {
        method: e.method,
        url: e.url,
        httpVersion: 'HTTP/1.1',
        headers: reqHdrs,
        queryString: queryOf(e.url).map(function (p) { return { name: p[0], value: p[1] }; }),
        postData: e.reqBody ? { mimeType: (e.reqHeaders && e.reqHeaders['content-type']) || 'text/plain', text: e.reqBody } : undefined,
        headersSize: -1,
        bodySize: e.reqBody ? e.reqBody.length : 0
      },
      response: {
        status: e.status || 0,
        statusText: e.statusText || '',
        httpVersion: 'HTTP/1.1',
        headers: resHdrs,
        content: {
          size: e.size || 0,
          mimeType: e.resType || 'application/octet-stream',
          text: e.resBody || ''
        },
        headersSize: -1,
        bodySize: e.size || 0
      },
      cache: {},
      timings: { send: 0, wait: e.ms || 0, receive: 0 }
    };
  });

  var har = {
    log: {
      version: '1.2',
      creator: { name: 'US MODS Source Viewer Heavy Pro', version: '2.2.0' },
      entries: entries
    }
  };

  var blob = new Blob([JSON.stringify(har, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (last.base ? new URL(last.base).host.replace(/[^\w.-]/g, '_') : 'network') + '.har';
  document.body.append(a); a.click(); a.remove();
}

/* ------------------------------------------------------------------
   Interactive Request Runner Replay Trigger
------------------------------------------------------------------ */
async function runReplay() {
  var meth = $('#repMeth').value;
  var url = $('#repUrl').value;
  var hdrsJson = $('#repHdrs').value;
  var body = $('#repBody').value;
  var resBox = $('#repResult');
  var sendBtn = $('#repSend');

  var hdrs = {};
  try { if (hdrsJson.trim()) hdrs = JSON.parse(hdrsJson); } catch (e) {
    resBox.innerHTML = '<p class="msg bad">Headers JSON sahi nahi hai.</p>';
    return;
  }

  sendBtn.disabled = true; sendBtn.textContent = 'Running...';
  resBox.innerHTML = '<p class="hint">Bhej raha hoon...</p>';
  var t0 = performance.now();

  try {
    var r = await fetch('/api/proxy', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ url: url, method: meth, headers: hdrs, body: (meth === 'GET' || meth === 'HEAD') ? null : body, page: last.base || '' })
    });
    var j = await r.json();
    var elapsed = Math.round(performance.now() - t0);
    if (!j.ok) throw new Error(j.error || 'Request failed');

    var textBody = j.encoding === 'base64' ? '[Binary base64 ' + j.contentType + ']' : j.body;
    var pretty = textBody;
    try { pretty = JSON.stringify(JSON.parse(textBody), null, 2); } catch (e) {}

    resBox.innerHTML = '<h4>Response · ' + j.status + ' ' + (j.statusText || '') + ' (' + elapsed + ' ms · ' + fmtB(j.size || 0) + ')</h4>' +
      '<pre style="max-height:260px;overflow:auto">' + esc(pretty) + '</pre>';
  } catch (err) {
    resBox.innerHTML = '<p class="msg bad">Error: ' + esc(err.message || 'Failed') + '</p>';
  } finally {
    sendBtn.disabled = false; sendBtn.textContent = 'Send / Run';
  }
}

/* ------------------------------------------------------------------
   Wiring
------------------------------------------------------------------ */
window.addEventListener('message', function (ev) {
  var f = $('#frame');
  if (!f || ev.source !== f.contentWindow) return;
  var d = ev.data;
  if (!d || d.usv !== 1) return;
  if (d.type === 'req') upsert(d);
  else if (d.type === 'click') addClick(d);
  else if (d.type === 'console') addConsole(d);
  else if (d.type === 'cookies' && window.USV && window.USV.saveCookies) {
    window.USV.saveCookies(d.url || last.base, str(d.cookies, 8000));
  }
  else if (d.type === 'navigate' && window.USV) {
    if (d.cookies && window.USV.saveCookies) window.USV.saveCookies(d.url || last.base, str(d.cookies, 8000));
    window.USV.open({ url: str(d.url, 3000), method: str(d.method || 'GET', 10), body: str(d.body, 200000), headers: obj(d.headers) });
  }
});

$('#nList').addEventListener('click', function (ev) {
  var c = ev.target.closest('.nclick');
  if (c) { F.click = F.click === c.dataset.click ? null : c.dataset.click; renderNet(); return; }
  var r = ev.target.closest('.nrow');
  if (r) { SEL = r.dataset.id; DTAB = 'headers'; renderNet(); }
});
$('#nChip').addEventListener('click', function (ev) { if (ev.target.closest('[data-act="allclicks"]')) { F.click = null; renderNet(); } });
$('#nDet').addEventListener('click', function (ev) {
  var b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'back') { SEL = null; renderNet(); return; }
  if (b.dataset.tab) { DTAB = b.dataset.tab; renderDetail(); return; }
  if (b.id === 'repSend') { runReplay(); return; }
  if (b.dataset.copy) {
    var e = NET.get(SEL);
    if (!e) return;
    var t = b.dataset.copy === 'curl' ? curlOf(e)
      : b.dataset.copy === 'fetch' ? fetchOf(e)
      : b.dataset.copy === 'py' ? pyOf(e)
      : b.dataset.copy === 'axios' ? axiosOf(e)
      : b.dataset.copy === 'url' ? e.url
      : (tryJson(e.resBody || '') !== undefined ? JSON.stringify(tryJson(e.resBody), null, 2) : e.resBody || '');
    copy(t, b);
  }
});

$('#nType').addEventListener('change', function () { F.type = this.value; renderNet(); });
var qt;
$('#nQ').addEventListener('input', function () { var v = this.value; clearTimeout(qt); qt = setTimeout(function () { F.q = v.trim(); renderNet(); }, 140); });
$('#nClear').addEventListener('click', reset);

var nViewSel = $('#nViewSel');
if (nViewSel) {
  nViewSel.addEventListener('change', function () {
    F.viewMode = this.value;
    renderNet();
  });
}

var bHar = $('#bHar');
if (bHar) bHar.addEventListener('click', exportHar);

$('#pvBack').addEventListener('click', function () { if (window.USV) window.USV.back(); });
$('#pvReload').addEventListener('click', function () { if (window.USV) window.USV.reload(); });

function setDevice(mode) {
  deviceMode = mode;
  document.querySelectorAll('[data-pv-dev]').forEach(function (btn) {
    btn.setAttribute('aria-pressed', btn.dataset.pvDev === mode ? 'true' : 'false');
  });
  updateDeviceStyle();
}

document.querySelectorAll('[data-pv-dev]').forEach(function (btn) {
  btn.addEventListener('click', function () { setDevice(btn.dataset.pvDev); });
});

var pvRot = $('#pvRot');
if (pvRot) {
  pvRot.addEventListener('click', function () {
    rotated = !rotated;
    pvRot.setAttribute('aria-pressed', rotated ? 'true' : 'false');
    updateDeviceStyle();
  });
}

window.USV_live = {
  render: render,
  rerender: function () { if (last.html) render(last.html, last.base); },
  reset: reset,
  logDoc: logDoc,
  exportHar: exportHar,
  lastAuthHeader: function () {
    for (var i = ORDER.length - 1; i >= 0; i--) {
      var e = NET.get(ORDER[i]);
      if (e && e.reqHeaders) {
        var auth = e.reqHeaders['authorization'] || e.reqHeaders['Authorization'] || e.reqHeaders['x-auth-token'] || e.reqHeaders['x-api-key'];
        if (auth) return auth;
      }
    }
    return '';
  },
  apiList: function () {
    return ORDER.map(function (id) { return NET.get(id); }).filter(function (e) {
      return e.kind === 'fetch' || e.kind === 'xhr' || e.kind === 'beacon' || e.kind === 'stream' || (e.kind === 'document' && e.method !== 'GET');
    }).map(function (e) { return { id: e.id, method: e.method, url: e.url, status: e.status, error: e.error, kind: e.kind, ms: e.ms }; });
  },
  show: function (id) {
    if (!NET.has(id)) return;
    F.click = null; SEL = id; DTAB = 'headers';
    renderNet();
    var n = $('#net'); if (n && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
  }
};

renderNet();
})();

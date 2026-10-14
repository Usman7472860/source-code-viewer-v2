/* assets.js: Pro Developer Intelligence Engine
   Finds images, fonts, media, API calls, security secrets & vulnerabilities,
   tech stack & CMS frameworks, SEO & OpenGraph cards, color palettes, and links.
   Loaded before main script. Provides window.USV_assets. */
(function () {
'use strict';

var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
var IMG = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|apng)(?=$|[?#])/i;
var FONT = /\.(woff2?|ttf|otf|eot)(?=$|[?#])/i;
var MEDIA = /\.(mp4|webm|ogv|ogg|mp3|wav|m4a|aac|flac|mov|m3u8|mpd)(?=$|[?#])/i;
var AUDIO = /\.(mp3|wav|m4a|aac|flac|ogg)(?=$|[?#])/i;
var STREAM = /\.(m3u8|mpd)(?=$|[?#])/i;
var NOTAPI = /\.(js|mjs|css|map|html?|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav)(?=$|[?#])/i;
var APIISH = /\/(api|graphql|rest|ajax|wp-json|trpc|gql)(\/|\?|$|-)|\/v\d{1,2}\/|\/\/api[.-]|\.json(?=$|[?#])|\/_next\/data\//i;
var WHERE = { img: '<img> tag', srcset: 'srcset', css: 'CSS file', style: 'style attribute', meta: 'meta tag', icon: 'favicon', poster: 'video poster', js: 'JS file', svg: 'inline SVG', link: 'link (a href)' };

function nameOf(u) {
  if (/^data:/i.test(u)) return 'inline-data';
  try {
    var x = new URL(u), p = decodeURIComponent(x.pathname.split('/').filter(Boolean).pop() || '');
    return (p || x.host).slice(0, 80);
  } catch (e) {
    return String(u).split(/[?#]/)[0].split('/').pop().slice(0, 80) || String(u).slice(0, 60);
  }
}
function shortUrl(u) { try { var x = new URL(u); return x.host + x.pathname + x.search; } catch (e) { return String(u); } }
function clip(s, n) { s = String(s == null ? '' : s).trim(); return s.length > n ? s.slice(0, n) + '…' : s; }
function around(text, idx) {
  var s = text.lastIndexOf('\n', idx) + 1, e = text.indexOf('\n', idx);
  if (e < 0) e = text.length;
  if (e - s > 260) { s = Math.max(0, idx - 90); e = Math.min(text.length, idx + 170); }
  return text.slice(s, e).trim();
}
function longest(raw) {
  return String(raw).split(/\$\{[^}]*\}/).sort(function (a, b) { return b.length - a.length; })[0] || String(raw);
}

/* ------------------------------------------------------------------
   Extract: Collects all assets, security issues, tech stack, SEO & colors
------------------------------------------------------------------ */
function extract(doc, base, sources) {
  var A = {
    images: [], fonts: [], media: [], api: [], links: [], forms: [],
    frames: [], rels: [], colors: [], tech: [], security: { secrets: [], issues: [], score: 100 },
    seo: { title: '', desc: '', canonical: '', robots: '', og: {}, twitter: {}, jsonLd: [], score: 100, checks: [] }
  };
  var seen = { i: {}, f: {}, m: {}, a: {}, au: {}, l: {}, fr: {}, r: {}, col: {}, t: {} };
  var origin = '', proto = 'https:', baseHost = '';
  try { var bu = new URL(base); origin = bu.origin; proto = bu.protocol; baseHost = bu.host; } catch (e) {}
  sources = sources || [];

  function res(u, b) {
    u = String(u == null ? '' : u).trim();
    if (!u) return '';
    if (/^(data|blob):/i.test(u)) return u;
    try { return new URL(u, b || base || undefined).href; } catch (e) { return u; }
  }

  function addImg(url, where, snippet, fileId, raw, extra) {
    if (!url || A.images.length >= 400) return;
    var isData = /^data:/i.test(url);
    if (isData && (!/^data:image\//i.test(url) || url.length > 400000)) return;
    var key = isData ? url.slice(0, 80) + url.length : url;
    if (seen.i[key]) return;
    seen.i[key] = 1;
    var semi = url.indexOf(';'), comma = url.indexOf(','), mimeEnd = semi > 0 && (comma < 0 || semi < comma) ? semi : comma;
    var a = { url: url, name: isData ? 'inline-data (' + url.slice(5, mimeEnd) + ')' : nameOf(url), where: where, snippet: clip(snippet, 600), fileId: fileId || '', raw: isData ? '' : (raw || '') };
    if (extra) for (var k in extra) a[k] = extra[k];
    A.images.push(a);
  }

  function addMedia(url, kind, snippet, fileId, raw, type) {
    if (!url || /^data:/i.test(url) || A.media.length >= 120 || seen.m[url]) return;
    seen.m[url] = 1;
    A.media.push({ url: url, name: nameOf(url), kind: kind, type: type || '', snippet: clip(snippet, 500), fileId: fileId || '', raw: raw || '' });
  }

  function addFont(f) {
    var key = f.url + '|' + f.family;
    if (seen.f[key] || A.fonts.length >= 120) return;
    seen.f[key] = 1;
    A.fonts.push(f);
  }

  function addApi(method, url, src, kind, snippet, rawLit) {
    if (A.api.length >= 250) return;
    var dyn = /\$\{/.test(url), full;
    if (/^https?:\/\//i.test(url)) full = url;
    else if (/^\/\//.test(url)) full = proto + url;
    else if (url.charAt(0) === '/' && origin) full = origin + url;
    else if (dyn || !base) full = url;
    else full = res(url);
    var key = method + ' ' + full;
    if (seen.a[key]) return;
    if (method === '?' && seen.au[full]) return;
    if (method !== '?' && seen.au[full] === '?') {
      A.api = A.api.filter(function (x) { return !(x.method === '?' && x.url === full); });
      delete seen.a['? ' + full];
    }
    seen.a[key] = 1;
    seen.au[full] = method;
    A.api.push({ method: method, url: full, dyn: dyn, kind: kind, where: src.name, fileId: src.id, raw: longest(rawLit || url), snippet: clip(snippet, 500) });
  }

  function addColor(c, where, fileId) {
    c = c.trim().toLowerCase();
    if (!c || c === '#fff' || c === '#ffffff' || c === '#000' || c === '#000000' || c === 'transparent') return;
    if (!seen.col[c]) {
      seen.col[c] = { color: c, count: 0, where: where, fileId: fileId };
      A.colors.push(seen.col[c]);
    }
    seen.col[c].count++;
  }

  function addTech(name, category, version, confidence) {
    if (seen.t[name]) return;
    seen.t[name] = 1;
    A.tech.push({ name: name, category: category, version: version || '', confidence: confidence || 'High' });
  }

  /* ---- css text scan ---- */
  function cssScan(text, b, fileId, where) {
    var re = /url\(\s*(["']?)([^"')]+?)\1\s*\)/gi, m, n = 0;
    while ((m = re.exec(text)) && n < 800) {
      n++;
      var raw = m[2].trim();
      if (/^data:image\//i.test(raw)) addImg(raw, where, around(text, m.index).slice(0, 80) + '…', fileId, '');
      else if (IMG.test(raw)) addImg(res(raw, b), where, around(text, m.index), fileId, raw);
      else if (MEDIA.test(raw)) addMedia(res(raw, b), AUDIO.test(raw) ? 'audio' : 'video', around(text, m.index), fileId, raw);
    }
    // Color scan in CSS
    var hexRe = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi, cm;
    while ((cm = hexRe.exec(text))) { addColor(cm[0], where, fileId); }
    var rgbRe = /(?:rgb|rgba|hsl|hsla)\([^)]+\)/gi;
    while ((cm = rgbRe.exec(text))) { addColor(cm[0], where, fileId); }
  }

  function fontScan(text, b, src) {
    var re = /@font-face\s*\{([^}]*)\}/gi, m;
    while ((m = re.exec(text))) {
      var block = m[1];
      var fam = (/font-family\s*:\s*([^;]+)/i.exec(block) || [])[1] || '';
      fam = fam.replace(/["']/g, '').trim();
      var wt = ((/font-weight\s*:\s*([^;]+)/i.exec(block) || [])[1] || '').trim();
      var st = ((/font-style\s*:\s*([^;]+)/i.exec(block) || [])[1] || '').trim();
      var ur = /url\(\s*(["']?)([^"')]+?)\1\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/gi, u;
      while ((u = ur.exec(block))) {
        var raw = u[2].trim();
        if (/^data:/i.test(raw)) continue;
        addFont({ family: fam || nameOf(raw), weight: wt, style: st, format: (u[3] || (raw.match(/\.(\w+)(?:$|[?#])/) || [])[1] || '').toLowerCase(), url: res(raw, b), where: src.name, fileId: src.id, raw: raw, snippet: clip('@font-face {' + block.replace(/\s+/g, ' ') + '}', 500) });
      }
    }
  }

  /* ---- js text scan ---- */
  function jsScan(src) {
    var text = src.text;
    var calls = [
      { r: /\bfetch\s*\(\s*(['"`])([^'"`]+?)\1/g, k: 'fetch', m: 'GET' },
      { r: /\baxios\s*\.\s*(get|post|put|delete|patch)\s*\(\s*(['"`])([^'"`]+?)\2/gi, k: 'axios', mi: 1, ui: 3 },
      { r: /\baxios\s*\(\s*(['"`])([^'"`]+?)\1/g, k: 'axios', m: 'GET' },
      { r: /\$\s*\.\s*(get|post|getJSON)\s*\(\s*(['"`])([^'"`]+?)\2/gi, k: 'jquery', mi: 1, ui: 3 },
      { r: /\$\s*\.\s*ajax\s*\(\s*\{[^}]*?url\s*:\s*(['"`])([^'"`]+?)\1/gi, k: 'jquery', m: '?' },
      { r: /\bopen\s*\(\s*(['"`])(GET|POST|PUT|DELETE|PATCH)\1\s*,\s*(['"`])([^'"`]+?)\3/gi, k: 'xhr', mi: 2, ui: 4 }
    ];
    calls.forEach(function (c) {
      var m;
      while ((m = c.r.exec(text))) {
        var meth = c.mi ? m[c.mi].toUpperCase() : c.m;
        if (meth === 'GETJSON') meth = 'GET';
        var u = m[c.ui || 2];
        if (!NOTAPI.test(u) && !/^([a-z0-9_-]+)$/i.test(u)) {
          addApi(meth, u, src, c.k, around(text, m.index), m[0]);
        }
      }
    });

    var lits = /(["'`])((?:https?:\/\/|\/)[^"'`\s]{3,200}?)\1/g, lm, n = 0;
    while ((lm = lits.exec(text)) && n < 600) {
      n++;
      var lit = lm[2];
      if (IMG.test(lit)) addImg(res(lit), 'js', around(text, lm.index), src.id, lit);
      else if (FONT.test(lit)) addFont({ family: nameOf(lit), weight: '', style: '', format: (lit.match(/\.(\w+)(?:$|[?#])/) || [])[1] || '', url: res(lit), where: src.name, fileId: src.id, raw: lit, snippet: around(text, lm.index) });
      else if (MEDIA.test(lit)) addMedia(res(lit), AUDIO.test(lit) ? 'audio' : 'video', around(text, lm.index), src.id, lit);
      else if (APIISH.test(lit) && !NOTAPI.test(lit)) addApi('?', lit, src, 'endpoint string', around(text, lm.index), lm[0]);
    }
  }

  /* ---- Security & Secrets Scanner ---- */
  function securityScan() {
    var SECRETS_DEF = [
      { name: 'Google API Key', regex: /\bAIza[0-9A-Za-z-_]{35}\b/g, sev: 'high' },
      { name: 'AWS Access Key', regex: /\b(A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g, sev: 'critical' },
      { name: 'GitHub Personal Token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9a-zA-Z]{36}\b/g, sev: 'critical' },
      { name: 'Stripe Live Secret Key', regex: /\b(?:sk|rk)_live_[0-9a-zA-Z]{24}\b/g, sev: 'critical' },
      { name: 'OpenAI API Key', regex: /\bsk-(?:proj-)?[a-zA-Z0-9_-]{32,64}\b/g, sev: 'critical' },
      { name: 'Slack Bot/User Token', regex: /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/g, sev: 'high' },
      { name: 'JWT Token Signature', regex: /\beyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b/g, sev: 'medium' },
      { name: 'Private Key Header', regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g, sev: 'critical' }
    ];

    sources.forEach(function (s) {
      if (s.failed) return;
      var text = s.text;
      SECRETS_DEF.forEach(function (secDef) {
        var m;
        while ((m = secDef.regex.exec(text))) {
          var matched = m[0];
          A.security.secrets.push({
            type: secDef.name,
            severity: secDef.sev,
            file: s.name,
            fileId: s.id,
            snippet: clip(around(text, m.index), 180),
            raw: matched.slice(0, 8) + '...' + matched.slice(-4),
            fullRaw: matched
          });
          if (A.security.secrets.length >= 50) break;
        }
      });

      // Code security pattern checks
      var evalMatch = text.match(/\beval\s*\(/g);
      if (evalMatch && s.type === 'js') {
        A.security.issues.push({ title: 'eval() Function Usage', desc: 'Direct code execution via eval() detected (' + evalMatch.length + ' occurrences). Potential XSS vector.', sev: 'medium', file: s.name, fileId: s.id });
      }
      var docWrite = text.match(/\bdocument\.write\s*\(/g);
      if (docWrite) {
        A.security.issues.push({ title: 'document.write() Detected', desc: 'document.write() is synchronous and can block parsing or expose DOM injection.', sev: 'low', file: s.name, fileId: s.id });
      }
    });

    // DOM security issues
    doc.querySelectorAll('a[target="_blank"]').forEach(function (el) {
      var rel = (el.getAttribute('rel') || '').toLowerCase();
      if (!rel.includes('noopener') && !rel.includes('noreferrer')) {
        A.security.issues.push({ title: 'Reverse Tabnabbing Risk', desc: 'Link target="_blank" without rel="noopener noreferrer": ' + clip(el.getAttribute('href'), 60), sev: 'low', file: 'HTML', fileId: 'doc' });
      }
    });

    if (proto === 'https:') {
      doc.querySelectorAll('[src^="http:"],[href^="http:"]').forEach(function (el) {
        var at = el.getAttribute('src') || el.getAttribute('href');
        if (/^http:\/\//i.test(at) && !el.closest('a')) {
          A.security.issues.push({ title: 'Mixed Content (Insecure HTTP on HTTPS)', desc: 'Asset loaded over unencrypted HTTP: ' + clip(at, 80), sev: 'high', file: 'HTML', fileId: 'doc' });
        }
      });
    }

    doc.querySelectorAll('form[method="get" i]').forEach(function (f) {
      if (f.querySelector('input[type="password" i]')) {
        A.security.issues.push({ title: 'Password In GET Form', desc: 'Form sends password field via GET query parameters, exposing it in URLs and logs.', sev: 'critical', file: 'HTML', fileId: 'doc' });
      }
    });

    // Score deduction
    var score = 100;
    A.security.secrets.forEach(function (s) { score -= (s.severity === 'critical' ? 25 : s.severity === 'high' ? 15 : 8); });
    A.security.issues.forEach(function (i) { score -= (i.sev === 'critical' ? 20 : i.sev === 'high' ? 12 : i.sev === 'medium' ? 6 : 2); });
    A.security.score = Math.max(10, Math.min(100, score));
  }

  /* ---- Tech Stack & CMS Detector ---- */
  function techScan() {
    var html = doc.documentElement ? doc.documentElement.outerHTML : '';
    var fullJs = sources.filter(function (s) { return s.type === 'js'; }).map(function (s) { return s.text; }).join('\n');

    // CMS & Platforms
    if (html.includes('/wp-content/') || html.includes('/wp-includes/') || doc.querySelector('meta[name="generator" i][content*="WordPress" i]')) {
      var gen = doc.querySelector('meta[name="generator" i][content*="WordPress" i]');
      var ver = gen ? (gen.getAttribute('content') || '').replace(/WordPress\s*/i, '').trim() : '';
      addTech('WordPress', 'CMS', ver);
    }
    if (html.includes('cdn.shopify.com') || html.includes('Shopify.theme') || html.includes('window.Shopify')) {
      addTech('Shopify', 'E-Commerce / CMS');
    }
    if (doc.querySelector('[data-wf-site], [data-wf-page]') || html.includes('assets.website-files.com')) {
      addTech('Webflow', 'Website Builder');
    }
    if (html.includes('wix.com') || html.includes('wix-code') || doc.querySelector('meta[name="generator" i][content*="Wix" i]')) {
      addTech('Wix', 'Website Builder');
    }
    if (html.includes('static.squarespace.com') || html.includes('squarespace-headers')) {
      addTech('Squarespace', 'Website Builder');
    }

    // JavaScript Frameworks
    if (doc.querySelector('#__next, script[id="__NEXT_DATA__"]') || html.includes('/_next/')) {
      addTech('Next.js', 'React Framework');
      addTech('React', 'UI Framework');
    } else if (html.includes('react') || html.includes('__REACT_DEVTOOLS_GLOBAL_HOOK__') || fullJs.includes('react.production.min.js') || fullJs.includes('useState(')) {
      addTech('React', 'UI Framework');
    }
    if (doc.querySelector('#__nuxt') || html.includes('/_nuxt/')) {
      addTech('Nuxt.js', 'Vue Framework');
      addTech('Vue.js', 'UI Framework');
    } else if (html.includes('data-v-') || fullJs.includes('Vue.version') || fullJs.includes('vue.global.prod.js')) {
      addTech('Vue.js', 'UI Framework');
    }
    if (doc.querySelector('[ng-version], [ng-app]') || fullJs.includes('@angular/core')) {
      var ngEl = doc.querySelector('[ng-version]');
      addTech('Angular', 'UI Framework', ngEl ? ngEl.getAttribute('ng-version') : '');
    }
    if (doc.querySelector('[class*="svelte-"]') || fullJs.includes('__svelte__')) {
      addTech('Svelte', 'UI Framework');
    }

    // CSS Frameworks
    if (html.includes('tailwind') || doc.querySelector('[class*="flex items-center"], [class*="text-sm font-medium"]')) {
      addTech('Tailwind CSS', 'CSS Framework');
    }
    if (html.includes('bootstrap.min.css') || html.includes('bootstrap.bundle') || doc.querySelector('.btn-primary, .container-fluid, .col-md-6')) {
      addTech('Bootstrap', 'CSS Framework');
    }

    // Utilities & Libraries
    if (html.includes('jquery') || fullJs.includes('jQuery.fn.init') || fullJs.includes('jQuery.version')) {
      addTech('jQuery', 'JavaScript Library');
    }
    if (html.includes('fontawesome') || html.includes('fa-') || doc.querySelector('[class*="fa-"]')) {
      addTech('Font Awesome', 'Icon Font');
    }

    // Analytics & Trackers
    if (html.includes('google-analytics.com') || html.includes('gtag(') || html.includes('googletagmanager.com/gtm.js') || html.includes('G-')) {
      addTech('Google Analytics / GTM', 'Analytics');
    }
    if (html.includes('fbevents.js') || html.includes('fbq(')) {
      addTech('Meta (Facebook) Pixel', 'Advertising & Analytics');
    }
    if (html.includes('static.hotjar.com')) {
      addTech('Hotjar', 'User Behavior Analytics');
    }

    // CDNs & Infrastructure
    if (html.includes('cloudflare.com') || html.includes('cf-ray') || html.includes('__cf_bm')) {
      addTech('Cloudflare', 'CDN & Security');
    }
    if (html.includes('_vercel') || html.includes('vercel.app')) {
      addTech('Vercel', 'Hosting & Edge');
    }
  }

  /* ---- SEO, OpenGraph & Social Cards ---- */
  function seoScan() {
    var title = (doc.title || '').trim();
    var descEl = doc.querySelector('meta[name="description" i]');
    var desc = descEl ? (descEl.getAttribute('content') || '').trim() : '';
    var canonEl = doc.querySelector('link[rel="canonical" i]');
    var canonical = canonEl ? (canonEl.getAttribute('href') || '').trim() : '';
    var robEl = doc.querySelector('meta[name="robots" i]');
    var robots = robEl ? (robEl.getAttribute('content') || '').trim() : '';

    var og = {};
    doc.querySelectorAll('meta[property^="og:" i]').forEach(function (m) {
      var p = (m.getAttribute('property') || '').toLowerCase().replace('og:', '');
      og[p] = (m.getAttribute('content') || '').trim();
    });

    var tw = {};
    doc.querySelectorAll('meta[name^="twitter:" i]').forEach(function (m) {
      var p = (m.getAttribute('name') || '').toLowerCase().replace('twitter:', '');
      tw[p] = (m.getAttribute('content') || '').trim();
    });

    var jsonLd = [];
    doc.querySelectorAll('script[type="application/ld+json" i]').forEach(function (s) {
      try {
        var parsed = JSON.parse(s.textContent);
        jsonLd.push(parsed);
      } catch (e) {}
    });

    var checks = [];
    var score = 100;

    if (title.length >= 30 && title.length <= 60) checks.push({ name: 'Title Length', status: 'ok', msg: title.length + ' characters (optimal 30-60)' });
    else if (title.length > 0) { checks.push({ name: 'Title Length', status: 'warn', msg: title.length + ' characters (recommended 30-60)' }); score -= 10; }
    else { checks.push({ name: 'Title Tag', status: 'bad', msg: 'Missing title tag' }); score -= 25; }

    if (desc.length >= 70 && desc.length <= 160) checks.push({ name: 'Meta Description', status: 'ok', msg: desc.length + ' characters (optimal 70-160)' });
    else if (desc.length > 0) { checks.push({ name: 'Meta Description', status: 'warn', msg: desc.length + ' characters (recommended 70-160)' }); score -= 10; }
    else { checks.push({ name: 'Meta Description', status: 'bad', msg: 'Missing meta description' }); score -= 20; }

    if (canonical) checks.push({ name: 'Canonical URL', status: 'ok', msg: canonical });
    else { checks.push({ name: 'Canonical URL', status: 'warn', msg: 'Missing canonical URL link' }); score -= 10; }

    if (og.title && og.image) checks.push({ name: 'Open Graph (Social Card)', status: 'ok', msg: 'og:title & og:image present' });
    else { checks.push({ name: 'Open Graph (Social Card)', status: 'warn', msg: 'Incomplete Open Graph meta tags' }); score -= 15; }

    if (jsonLd.length) checks.push({ name: 'Structured Data', status: 'ok', msg: jsonLd.length + ' JSON-LD schema block(s)' });
    else checks.push({ name: 'Structured Data', status: 'mute', msg: 'No JSON-LD structured data' });

    A.seo = {
      title: title, desc: desc, canonical: canonical, robots: robots,
      og: og, twitter: tw, jsonLd: jsonLd, checks: checks, score: Math.max(10, score)
    };
  }

  /* ---- DOM Assets Scan ---- */
  function srcsets(el, attr) {
    var v = el.getAttribute(attr);
    if (!v) return;
    v.split(',').forEach(function (p) {
      var u = p.trim().split(/\s+/)[0];
      if (u) addImg(res(u), 'srcset', el.outerHTML, 'doc', u);
    });
  }

  doc.querySelectorAll('img').forEach(function (el) {
    ['src', 'data-src', 'data-lazy-src', 'data-original'].forEach(function (at) {
      var v = el.getAttribute(at);
      if (v) addImg(res(v), 'img', el.outerHTML, 'doc', v);
    });
    srcsets(el, 'srcset');
  });
  doc.querySelectorAll('source[srcset]').forEach(function (el) { srcsets(el, 'srcset'); });
  doc.querySelectorAll('input[type="image" i][src]').forEach(function (el) { addImg(res(el.getAttribute('src')), 'img', el.outerHTML, 'doc', el.getAttribute('src')); });
  doc.querySelectorAll('link[rel~="icon" i],link[rel="shortcut icon" i],link[rel~="apple-touch-icon" i]').forEach(function (el) {
    var v = el.getAttribute('href');
    if (v) addImg(res(v), 'icon', el.outerHTML, 'doc', v);
  });
  doc.querySelectorAll('meta[property^="og:image" i],meta[name^="twitter:image" i],meta[name="thumbnail" i]').forEach(function (el) {
    var v = el.getAttribute('content');
    if (v) addImg(res(v), 'meta', el.outerHTML, 'doc', v);
  });
  doc.querySelectorAll('[style*="url("]').forEach(function (el) { cssScan(el.getAttribute('style') || '', base, 'doc', 'style'); });

  doc.querySelectorAll('svg').forEach(function (el, i) {
    if (A.images.length >= 400) return;
    var outer = el.outerHTML, w = el.getAttribute('width') || '', h = el.getAttribute('height') || '';
    var label = el.getAttribute('aria-label') || (el.querySelector('title') && el.querySelector('title').textContent) || ('SVG #' + (i + 1));
    var encoded = 'data:image/svg+xml;utf8,' + encodeURIComponent(outer);
    addImg(encoded, 'svg', outer, 'doc', '', { name: label.trim().slice(0, 50), inline: true, code: outer, dims: (w && h) ? (w + 'x' + h) : '' });
  });

  doc.querySelectorAll('video,audio').forEach(function (el) {
    var tag = el.tagName.toLowerCase(), src = el.getAttribute('src');
    if (src) addMedia(res(src), tag, el.outerHTML, 'doc', src, el.getAttribute('type') || '');
    el.querySelectorAll('source[src]').forEach(function (so) { var v = so.getAttribute('src'); if (v) addMedia(res(v), tag, so.outerHTML, 'doc', v, so.getAttribute('type') || ''); });
    el.querySelectorAll('track[src]').forEach(function (t) { var v = t.getAttribute('src'); if (v) addMedia(res(v), 'track', t.outerHTML, 'doc', v, t.getAttribute('kind') || 'subtitles'); });
    if (tag === 'video' && el.getAttribute('poster')) addImg(res(el.getAttribute('poster')), 'poster', el.outerHTML, 'doc', el.getAttribute('poster'));
  });

  doc.querySelectorAll('link[rel~="preload" i][as="font" i][href]').forEach(function (el) {
    var v = el.getAttribute('href');
    if (v) addFont({ family: nameOf(v), weight: '', style: '', format: el.getAttribute('type') || '', url: res(v), where: 'link preload', fileId: 'doc', raw: v, snippet: clip(el.outerHTML, 400) });
  });
  doc.querySelectorAll('link[href*="fonts.googleapis.com" i]').forEach(function (el) {
    var href = el.getAttribute('href') || '';
    var fams = href.match(/family=([^&:]+)/g) || [];
    fams.forEach(function (f) {
      var fam = decodeURIComponent(f.replace('family=', '')).replace(/\+/g, ' ');
      addFont({ family: fam, weight: '', style: '', format: 'google-font', url: href, where: 'Google Fonts', fileId: 'doc', raw: href, snippet: clip(el.outerHTML, 400), css: true });
    });
  });

  sources.forEach(function (s) {
    if (s.failed) return;
    if (s.type === 'css') {
      cssScan(s.text, s.url || base, s.id, 'css');
      fontScan(s.text, s.url || base, s);
    } else if (s.type === 'js') {
      jsScan(s);
    }
  });

  doc.querySelectorAll('a[href]').forEach(function (el) {
    var raw = el.getAttribute('href');
    if (!raw) return;
    var u = res(raw);
    var kind = /^(mailto|tel|sms):/i.test(raw) ? 'contact' : /^(javascript|data|blob|#):/i.test(raw) ? 'other' : '';
    if (!kind) {
      try { var x = new URL(u); kind = x.host === baseHost ? 'internal' : 'external'; } catch (e) { kind = 'other'; }
    }
    if (MEDIA.test(raw)) addMedia(u, 'link', el.outerHTML, 'doc', raw);
    if (A.links.length < 500) {
      A.links.push({ url: u, text: clip(el.textContent, 60), kind: kind, snippet: clip(el.outerHTML, 400), fileId: 'doc', raw: raw });
    }
  });

  doc.querySelectorAll('form').forEach(function (f, i) {
    var act = res(f.getAttribute('action') || '');
    var meth = (f.getAttribute('method') || 'GET').toUpperCase();
    var fields = [];
    f.querySelectorAll('input,select,textarea,button[name]').forEach(function (x) {
      var n = x.getAttribute('name');
      if (n) fields.push({ name: n, type: x.getAttribute('type') || x.tagName.toLowerCase(), val: x.value || '' });
    });
    A.forms.push({ id: f.getAttribute('id') || f.getAttribute('name') || ('Form #' + (i + 1)), method: meth, url: act || (base || ''), fields: fields, snippet: clip(f.outerHTML, 600), fileId: 'doc', raw: f.getAttribute('action') || '' });
  });

  doc.querySelectorAll('iframe[src],frame[src],embed[src],object[data]').forEach(function (el) {
    var v = el.getAttribute('src') || el.getAttribute('data');
    if (v) A.frames.push({ tag: el.tagName.toLowerCase(), url: res(v), snippet: clip(el.outerHTML, 400), fileId: 'doc', raw: v });
  });

  doc.querySelectorAll('link[rel]').forEach(function (el) {
    var rel = (el.getAttribute('rel') || '').toLowerCase();
    if (/^(stylesheet|icon|shortcut icon|apple-touch-icon)$/.test(rel)) return;
    var v = el.getAttribute('href');
    var extra = ['as', 'type', 'hreflang', 'title', 'sizes', 'media'].map(function (a) { var x = el.getAttribute(a); return x ? a + '=' + x : ''; }).filter(Boolean).join(' ');
    A.rels.push({ rel: rel, url: v ? res(v) : '', extra: extra, snippet: clip(el.outerHTML, 400), fileId: 'doc', raw: v || '' });
  });

  // Run intelligence scanners
  securityScan();
  techScan();
  seoScan();

  // Sort colors by frequency
  A.colors.sort(function (a, b) { return b.count - a.count; });

  return A;
}

/* ------------------------------------------------------------------
   Views and HTML builders
------------------------------------------------------------------ */
function safeSrc(u) { return /^(https?:|data:image\/|blob:)/i.test(u) ? esc(u) : ''; }
function badge(m) { return '<span class="m m-' + (m === 'GET' ? 'get' : m === 'POST' ? 'post' : 'other') + '">' + esc(m) + '</span>'; }
function stClass(e) {
  if (e.error) return 'bad';
  if (e.status == null) return 'pend';
  if (!e.status) return 'mute';
  return e.status < 300 ? 'ok' : e.status < 400 ? 'warn' : 'bad';
}
function stText(e) { return e.error ? 'ERR' : e.status == null ? '...' : e.status === 0 ? '-' : String(e.status); }
function btn(label, act, k, i, f) { return '<button class="sm" type="button" data-act="' + act + '"' + (k ? ' data-k="' + k + '" data-i="' + i + '"' : '') + (f ? ' data-f="' + f + '"' : '') + '>' + esc(label) + '</button>'; }
function openLink(url, label) { return /^https?:\/\//i.test(url) ? '<a class="sm lnk" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(label || 'Naye tab mein') + '</a>' : ''; }
function head(title, n, hint) { return '<div class="avh"><b>' + esc(title) + '</b><span class="chip">' + n + '</span>' + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>'; }
function empty(msg) { return '<p class="hint">' + msg + '</p>'; }
function sec(title, n, body, tab) {
  return '<section class="asec"><div class="ash"><h3>' + esc(title) + '</h3><span class="chip">' + n + '</span>' +
    (tab ? '<button class="sm" type="button" data-act="go" data-tab="' + tab + '">Sab dikhao &rarr;</button>' : '') + '</div>' + body + '</section>';
}
function tbl(rows) {
  return '<div class="tblwrap"><table class="tbl">' + rows.filter(Boolean).map(function (r) { return '<tr><th>' + esc(r[0]) + '</th><td>' + r[1] + '</td></tr>'; }).join('') + '</table></div>';
}
function pre(t) { return '<pre>' + esc(t) + '</pre>'; }
function list(rows) { return '<div class="alist">' + rows.join('') + '</div>'; }
function mapIdx(arr, fn, limit) { var out = []; for (var i = 0; i < arr.length && out.length < (limit || 1e9); i++) out.push(fn(arr[i], i)); return out; }

function imgCard(a, i) {
  var s = safeSrc(a.url);
  return '<button class="acard" type="button" data-act="open" data-k="images" data-i="' + i + '" title="' + esc(a.name) + '">' +
    '<span class="thumb">' + (s ? '<img loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="" src="' + s + '">' : '') + '</span>' +
    '<span class="an">' + esc(a.name) + '</span><span class="am">' + esc(WHERE[a.where] || a.where) + '</span></button>';
}

function apiRow(a, i) {
  return '<div class="arow" role="button" tabindex="0" data-act="open" data-k="api" data-i="' + i + '">' + badge(a.method) +
    '<span class="au"><b>' + esc(shortUrl(a.url)) + '</b><i>' + esc(a.where) + ' · ' + esc(a.kind) + (a.dyn ? ' · dynamic' : '') + '</i></span>' +
    btn('Copy', 'copy', 'api', i, 'url') + '</div>';
}

function liveRow(e) {
  var n = shortUrl(e.url);
  return '<div class="arow" role="button" tabindex="0" data-act="net" data-id="' + esc(e.id) + '">' + badge(e.method) +
    '<span class="au"><b>' + esc(n) + '</b><i>' + esc(e.kind) + (e.ms != null ? ' · ' + e.ms + ' ms' : '') + '</i></span>' +
    '<span class="st ' + stClass(e) + '">' + esc(stText(e)) + '</span></div>';
}

function fontRow(a, i) {
  return '<div class="arow" role="button" tabindex="0" data-act="open" data-k="fonts" data-i="' + i + '">' +
    '<span class="fs" data-fi="' + i + '">Aa</span>' +
    '<span class="au"><b>' + esc(a.family) + '</b><i>' + esc([a.weight, a.style, a.format, a.where].filter(Boolean).join(' · ')) + '</i></span>' +
    btn('Copy', 'copy', 'fonts', i, 'url') + '</div>';
}

function playerKind(a) {
  if (a.kind === 'track' || STREAM.test(a.url)) return '';
  if (a.kind === 'link') return AUDIO.test(a.url) ? 'audio' : 'video';
  return a.kind;
}

function mediaCard(a, i) {
  var pk = playerKind(a), s = safeSrc(a.url), pl = '';
  if (pk === 'audio' && s) pl = '<audio controls preload="none" src="' + s + '"></audio>';
  else if (pk === 'video' && s) pl = '<video controls preload="none" playsinline src="' + s + '"></video>';
  return '<div class="mcard">' + pl + '<div class="au"><b>' + esc(a.name) + '</b><i>' + esc(a.kind) + (a.type ? ' · ' + esc(a.type) : '') + '</i></div>' +
    '<div class="mact">' + btn('Details', 'open', 'media', i) + btn('Copy URL', 'copy', 'media', i, 'url') + openLink(a.url) + '</div></div>';
}

function formRow(a, i) {
  return '<div class="arow" role="button" tabindex="0" data-act="open" data-k="forms" data-i="' + i + '">' + badge(a.method) +
    '<span class="au"><b>' + esc(shortUrl(a.url)) + '</b><i>' + esc(a.id) + ' · ' + a.fields.length + ' fields</i></span>' + btn('Copy', 'copy', 'forms', i, 'url') + '</div>';
}

function frameRow(a, i) {
  return '<div class="arow" role="button" tabindex="0" data-act="open" data-k="frames" data-i="' + i + '"><span class="tag t-other">' + esc(a.tag) + '</span>' +
    '<span class="au"><b>' + esc(shortUrl(a.url)) + '</b></span>' + btn('Copy', 'copy', 'frames', i, 'url') + '</div>';
}

function relRow(a, i) {
  return '<div class="arow" role="button" tabindex="0" data-act="open" data-k="rels" data-i="' + i + '"><span class="tag t-other">' + esc(a.rel.slice(0, 12)) + '</span>' +
    '<span class="au"><b>' + esc(a.url ? shortUrl(a.url) : '(inline)') + '</b><i>' + esc(a.extra) + '</i></span>' + (a.url ? btn('Copy', 'copy', 'rels', i, 'url') : '<span></span>') + '</div>';
}

function linkRow(a, i) {
  return '<div class="arow" role="button" tabindex="0" data-act="open" data-k="links" data-i="' + i + '"><span class="tag t-other">' + (a.kind === 'internal' ? 'in' : a.kind === 'external' ? 'out' : 'tel') + '</span>' +
    '<span class="au"><b>' + esc(a.text || shortUrl(a.url)) + '</b><i>' + esc(shortUrl(a.url)) + '</i></span>' + btn('Copy', 'copy', 'links', i, 'url') + '</div>';
}

/* ---- Security View ---- */
function viewSecurity(A) {
  var s = A.security;
  var scoreClass = s.score >= 80 ? 'ok' : s.score >= 50 ? 'warn' : 'bad';
  var h = '<div class="avh"><b>Security & Secrets Scanner</b><span class="chip ' + scoreClass + '">Score: ' + s.score + '/100</span><p class="hint">Automated scan across HTML, CSS and JS for hardcoded API keys, exposed secrets, dangerous functions and hygiene vulnerabilities.</p></div>';

  var secRows = s.secrets.map(function (sec, i) {
    var sevBadge = '<span class="chip ' + (sec.severity === 'critical' ? 'bad' : sec.severity === 'high' ? 'warn' : '') + '">' + esc(sec.severity.toUpperCase()) + '</span>';
    return '<div class="arow" role="button" tabindex="0" data-act="jump" data-file="' + esc(sec.fileId) + '" data-q="' + esc(sec.fullRaw) + '">' + sevBadge +
      '<span class="au"><b>' + esc(sec.type) + '</b><i>' + esc(sec.file) + ' · ' + esc(sec.raw) + '</i></span>' +
      '<button class="sm" type="button" data-act="jump-sec" data-file="' + esc(sec.fileId) + '" data-q="' + esc(sec.fullRaw) + '">Code mein dekho</button></div>';
  });

  var issRows = s.issues.map(function (iss) {
    var sevBadge = '<span class="chip ' + (iss.sev === 'critical' ? 'bad' : iss.sev === 'high' ? 'warn' : '') + '">' + esc(iss.sev.toUpperCase()) + '</span>';
    return '<div class="arow" role="button" tabindex="0" data-act="jump" data-file="' + esc(iss.fileId) + '">' + sevBadge +
      '<span class="au"><b>' + esc(iss.title) + '</b><i>' + esc(iss.desc) + ' (' + esc(iss.file) + ')</i></span></div>';
  });

  var s1 = sec('Exposed Secrets & API Keys (' + s.secrets.length + ')', s.secrets.length, s.secrets.length ? list(secRows) : empty('Koi exposed API key ya secret token nahi mila. Shandar!'));
  var s2 = sec('Security Risks & Hygiene (' + s.issues.length + ')', s.issues.length, s.issues.length ? list(issRows) : empty('Koi common security issue detect nahi hua.'));
  return h + s1 + s2;
}

/* ---- Tech Stack View ---- */
function viewTech(A) {
  var t = A.tech;
  var h = head('Tech Stack & Framework Detector', t.length, 'Page ke HTML, Scripts aur CSS se detect hue frameworks, CMS, libraries aur analytics.');
  if (!t.length) return h + empty('Is page par koi standard library ya CMS match nahi hua (vanilla code ho sakta hai).');

  var cards = t.map(function (item) {
    return '<div class="acard"><span class="an" style="font-size:14px;color:var(--tab)">' + esc(item.name) + (item.version ? ' <small style="color:var(--muted)">v' + esc(item.version) + '</small>' : '') + '</span>' +
      '<span class="am">' + esc(item.category) + '</span><span class="chip" style="justify-self:start;margin-top:4px">' + esc(item.confidence) + '</span></div>';
  }).join('');

  return h + '<div class="agrid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">' + cards + '</div>';
}

/* ---- SEO & Social Cards View ---- */
function viewSeo(A) {
  var s = A.seo;
  var scoreClass = s.score >= 80 ? 'ok' : s.score >= 50 ? 'warn' : 'bad';
  var h = '<div class="avh"><b>SEO & Social Cards Preview</b><span class="chip ' + scoreClass + '">SEO Score: ' + s.score + '/100</span><p class="hint">Search engine snippet aur social sharing card previews.</p></div>';

  // Audit checklist
  var checkList = '<div class="alist">' + s.checks.map(function (c) {
    return '<div class="arow"><span class="chip ' + (c.status === 'ok' ? 'ok' : c.status === 'bad' ? 'bad' : 'warn') + '">' + esc(c.status.toUpperCase()) + '</span>' +
      '<span class="au"><b>' + esc(c.name) + '</b><i>' + esc(c.msg) + '</i></span></div>';
  }).join('') + '</div>';

  // Google SERP Preview
  var serp = '<div style="padding:14px;border:1px solid var(--line);border-radius:10px;background:var(--panel);max-width:600px;font-family:arial,sans-serif">' +
    '<div style="font-size:12px;color:var(--muted);margin-bottom:3px">' + esc(s.canonical || 'https://website.com') + '</div>' +
    '<div style="font-size:18px;color:#1a0dab;cursor:pointer;text-decoration:hover">' + esc(s.title || 'Page Title') + '</div>' +
    '<div style="font-size:13px;color:#4d5156;margin-top:4px;line-height:1.4">' + esc(s.desc || 'No meta description provided for this webpage.') + '</div>' +
    '</div>';

  // Social Sharing Card Preview (Twitter / OpenGraph)
  var ogImg = s.og.image || s.twitter.image || '';
  var card = '<div style="border:1px solid var(--line);border-radius:12px;overflow:hidden;background:var(--panel);max-width:500px">' +
    (ogImg ? '<div style="height:200px;background:#111;overflow:hidden;display:grid;place-items:center"><img src="' + safeSrc(ogImg) + '" style="width:100%;height:100%;object-fit:cover" alt="Card Preview"></div>' : '<div style="height:120px;display:grid;place-items:center;background:var(--panel2);color:var(--muted)">No Open Graph Image</div>') +
    '<div style="padding:12px;display:grid;gap:4px">' +
    '<span style="font-size:11px;color:var(--muted);text-transform:uppercase">' + esc(s.og.site_name || s.canonical || 'WEBSITE') + '</span>' +
    '<b style="font-size:14px;color:var(--fg)">' + esc(s.og.title || s.title || 'Social Card Title') + '</b>' +
    '<p style="font-size:12px;color:var(--muted);margin:0">' + esc(s.og.description || s.desc || '') + '</p>' +
    '</div></div>';

  var ldView = s.jsonLd.length ? '<pre style="max-height:200px;overflow:auto;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)">' + esc(JSON.stringify(s.jsonLd, null, 2)) + '</pre>' : empty('Koi JSON-LD structured data nahi.');

  return h + sec('SEO Audit Checklist', s.checks.length, checkList) +
    sec('Google Search Result Preview', '', serp) +
    sec('Social Share Card (Twitter / Open Graph)', '', card) +
    sec('Structured Data (JSON-LD)', s.jsonLd.length, ldView);
}

/* ---- Color Palette View ---- */
function viewColors(A) {
  var cols = A.colors;
  var h = head('Color Palette & Swatches', cols.length, 'CSS stylesheets aur inline styles mein use huye colors. Click karein copy karne ke liye.');
  if (!cols.length) return h + empty('Is page mein koi explicit CSS color detect nahi hua.');

  var swatches = cols.map(function (c, i) {
    return '<button class="acard" type="button" data-act="copy-color" data-col="' + esc(c.color) + '" title="Click to copy ' + esc(c.color) + '">' +
      '<div style="height:48px;border-radius:6px;border:1px solid rgba(0,0,0,0.1);background:' + esc(c.color) + '"></div>' +
      '<span class="an" style="font-size:12px">' + esc(c.color) + '</span>' +
      '<span class="am">' + c.count + 'x used · ' + esc(c.where) + '</span></button>';
  }).join('');

  return h + '<div class="agrid" style="grid-template-columns:repeat(auto-fill,minmax(120px,1fr))">' + swatches + '</div>';
}

function viewImages(A) {
  if (!A.images.length) return empty('Is page mein koi image nahi mili.');
  return head('Images', A.images.length, 'Kisi par dabayen: bada preview, <code>&lt;img&gt;</code> ka code, URL aur download. Inline SVG ka poora code bhi milta hai.') +
    '<div class="agrid">' + mapIdx(A.images, imgCard).join('') + '</div>';
}

function viewApi(A, ctx) {
  var live = ctx.live || [];
  var h = head('API', live.length + A.api.length, 'Live: preview mein click karne par jo requests gayin. Source: JS code mein likhe endpoints (fetch, axios, XHR, jQuery).');
  var l = sec('Live (preview se pakdi)', live.length, live.length ? list(live.map(liveRow)) : empty('Abhi koi nahi. Website mein button ya form dabayen, uski requests yahan aayengi.'));
  var s = sec('Source mein mile endpoints', A.api.length, A.api.length ? list(mapIdx(A.api, apiRow)) : empty('JS code mein koi endpoint nahi mila. Linked JS files lane wala option on rakhein.'));
  return h + l + s;
}

function viewFonts(A) {
  if (!A.fonts.length) return empty('Is page mein koi font nahi mila.');
  return head('Fonts', A.fonts.length, 'CSS ke <code>@font-face</code> aur Google Fonts se.') + list(mapIdx(A.fonts, fontRow));
}

function viewMedia(A) {
  if (!A.media.length) return empty('Is page mein koi video ya audio nahi mili.');
  return head('Media', A.media.length, 'Video, audio aur subtitles. Player dabane par hi load hota hai.') + '<div class="mgrid">' + mapIdx(A.media, mediaCard).join('') + '</div>';
}

function viewOther(A) {
  var out = [];
  out.push(sec('Forms', A.forms.length, A.forms.length ? list(mapIdx(A.forms, formRow)) : empty('Koi form nahi.')));
  out.push(sec('Iframe aur embeds', A.frames.length, A.frames.length ? list(mapIdx(A.frames, frameRow)) : empty('Koi iframe nahi.')));
  out.push(sec('Link tags (manifest, canonical, preload...)', A.rels.length, A.rels.length ? list(mapIdx(A.rels, relRow)) : empty('Koi nahi.')));
  ['internal', 'external', 'contact'].forEach(function (kind) {
    var rows = [], n = 0;
    A.links.forEach(function (a, i) { if (a.kind === kind) { n++; if (rows.length < 150) rows.push(linkRow(a, i)); } });
    out.push(sec(kind === 'internal' ? 'Page ke andar ke links' : kind === 'external' ? 'Bahar ke links' : 'Contact (mail, phone)', n,
      n ? list(rows) + (n > rows.length ? '<p class="hint">Baqi ' + (n - rows.length) + ' links chhupe hain.</p>' : '') : empty('Koi nahi.')));
  });
  return out.join('');
}

function counts(A, ctx) {
  var src = ctx.sources || [], c = {};
  ['html', 'css', 'js'].forEach(function (t) { c[t] = src.filter(function (s) { return s.type === t; }).length; });
  c.images = A ? A.images.length : 0;
  c.api = (A ? A.api.length : 0) + (ctx.live || []).length;
  c.fonts = A ? A.fonts.length : 0;
  c.media = A ? A.media.length : 0;
  c.colors = A ? A.colors.length : 0;
  c.tech = A ? A.tech.length : 0;
  c.security = A ? (A.security.secrets.length + A.security.issues.length) : 0;
  c.seo = A ? (A.seo.title ? 1 : 0) : 0;
  c.other = A ? A.links.length + A.forms.length + A.frames.length + A.rels.length : 0;
  c.all = c.html + c.css + c.js + c.images + c.api + c.fonts + c.media + c.colors + c.tech + c.security + c.other;
  return c;
}

function viewAll(A, ctx) {
  var c = counts(A, ctx), src = ctx.sources || [];
  var NAMES = [
    ['html', 'HTML'], ['css', 'CSS'], ['js', 'JS'],
    ['images', 'Images'], ['api', 'API'], ['fonts', 'Fonts'],
    ['media', 'Media'], ['colors', 'Colors'], ['tech', 'Tech'],
    ['security', 'Security'], ['seo', 'SEO'], ['other', 'Other']
  ];
  var chips = '<div class="cbar">' + NAMES.map(function (n) {
    return '<button class="chip cbtn c-' + n[0] + '" type="button" data-act="go" data-tab="' + n[0] + '"><i></i>' + n[1] + ' ' + (c[n[0]] || 0) + '</button>';
  }).join('') + '</div>';
  var files = src.map(function (s) {
    return '<div class="arow" role="button" tabindex="0" data-act="file" data-id="' + esc(s.id) + '"><span class="tag t-' + s.type + '">' + s.type.toUpperCase() + '</span>' +
      '<span class="au"><b>' + esc(s.name) + '</b><i>' + (s.failed ? 'load nahi hua' : s.kind === 'document' ? 'page ka asal source' : s.kind === 'inline' ? 'page ke andar' : 'alag file') + '</i></span><span class="am">' + (s.size < 1024 ? s.size + ' B' : (s.size / 1024).toFixed(1) + ' KB') + '</span></div>';
  }).join('');
  return head('Sab resources', c.all, 'Is page ke code files, images, API, fonts aur security findings.') + chips +
    sec('Files (' + src.length + ')', src.length, files ? list([files]) : empty('Koi file nahi.'));
}

function view(tab, A, ctx) {
  if (!A && tab !== 'all') return empty('Kuch nahi mila.');
  switch (tab) {
    case 'all': return viewAll(A, ctx);
    case 'images': return viewImages(A);
    case 'api': return viewApi(A, ctx);
    case 'fonts': return viewFonts(A);
    case 'media': return viewMedia(A);
    case 'colors': return viewColors(A);
    case 'tech': return viewTech(A);
    case 'security': return viewSecurity(A);
    case 'seo': return viewSeo(A);
    case 'other': return viewOther(A);
  }
  return '';
}

/* ------------------------------------------------------------------
   Detail (shown in dialog) with Multi-language Code Generators
------------------------------------------------------------------ */
function genMultiCode(method, url) {
  var m = method === '?' ? 'GET' : method;
  var js = 'const res = await fetch("' + esc(url) + '", { method: "' + m + '" });\nconst data = await res.json();\nconsole.log(data);';
  var py = 'import requests\n\nres = requests.' + m.toLowerCase() + '("' + url + '")\nprint(res.status_code, res.json())';
  var nodeAxios = 'const axios = require("axios");\n\nconst { data } = await axios.' + m.toLowerCase() + '("' + url + '");\nconsole.log(data);';
  var go = 'package main\nimport (\n  "fmt"\n  "net/http"\n  "io"\n)\nfunc main() {\n  resp, _ := http.Get("' + url + '")\n  defer resp.Body.Close()\n  body, _ := io.ReadAll(resp.Body)\n  fmt.Println(string(body))\n}';
  var php = '$ch = curl_init("' + url + '");\ncurl_setopt($ch, CURLOPT_RETURNTRANSFER, true);\n$response = curl_exec($ch);\ncurl_close($ch);\necho $response;';
  return { js: js, py: py, axios: nodeAxios, go: go, php: php };
}

function detail(A, k, i) {
  var a = A && A[k] && A[k][i];
  if (!a) return null;
  var title = '', body = '', acts = [], jump = a.fileId && a.raw ? btn('Source code mein dekho', 'jump', k, i) : '';
  var code = function (label, t) { return t ? '<h4>' + esc(label) + '</h4>' + pre(t) : ''; };

  if (k === 'images') {
    title = a.name;
    body = '<div class="dprev">' + (safeSrc(a.url) ? '<img referrerpolicy="no-referrer" alt="" src="' + safeSrc(a.url) + '">' : '') + '</div>' +
      tbl([['Naam', esc(a.name)], a.inline ? null : ['URL', esc(a.url.length > 300 ? a.url.slice(0, 300) + '…' : a.url)], ['Kahan mila', esc(WHERE[a.where] || a.where)], ['Size', '<span id="adDims">...</span>']]) +
      code(a.inline ? 'SVG code' : 'Code', a.code || a.snippet);
    acts = [a.inline ? '' : btn('Copy URL', 'copy', k, i, 'url'), btn('Copy code', 'copy', k, i, 'code'), a.inline ? '' : openLink(a.url), btn(a.inline ? 'SVG download' : 'Download', 'dl', k, i), jump];
  } else if (k === 'fonts') {
    title = a.family;
    body = '<div class="fbig" data-fi="' + i + '">Aa Bb Cc 123 The quick brown fox</div>' +
      tbl([['Family', esc(a.family)], a.weight ? ['Weight', esc(a.weight)] : null, a.style ? ['Style', esc(a.style)] : null, a.format ? ['Format', esc(a.format)] : null, ['URL', esc(a.url)], ['Kahan mila', esc(a.where)]]) + code('Code', a.snippet);
    acts = [btn('Copy URL', 'copy', k, i, 'url'), btn('Copy code', 'copy', k, i, 'code'), a.css ? '' : btn('Download', 'dl', k, i), openLink(a.url), jump];
  } else if (k === 'media') {
    var pk = playerKind(a), s = safeSrc(a.url);
    title = a.name;
    body = (pk === 'audio' && s ? '<audio controls preload="none" src="' + s + '"></audio>' : pk === 'video' && s ? '<video controls preload="none" playsinline src="' + s + '"></video>' : '') +
      tbl([['Naam', esc(a.name)], ['Type', esc(a.kind + (a.type ? ' · ' + a.type : ''))], ['URL', esc(a.url)]]) + code('Code', a.snippet);
    acts = [btn('Copy URL', 'copy', k, i, 'url'), openLink(a.url), btn('Download', 'dl', k, i), jump];
  } else if (k === 'api') {
    title = a.method + ' ' + shortUrl(a.url);
    var codes = genMultiCode(a.method, a.url);
    body = tbl([['Method', badge(a.method) + (a.method === '?' ? ' <span class="msg">code se pata nahi chala</span>' : '')], ['URL', esc(a.url)], ['Kahan mila', esc(a.where)], ['Kaise', esc(a.kind)], a.dyn ? ['Note', 'URL mein variable hai, asli URL chalne par banta hai'] : null]) +
      code('Original Code Snippet', a.snippet) +
      code('JavaScript (Fetch)', codes.js) +
      code('Python (requests)', codes.py) +
      code('Node.js (Axios)', codes.axios) +
      code('Go (net/http)', codes.go) +
      code('PHP (cURL)', codes.php) +
      '<div id="adOut"></div>';
    acts = [btn('Copy URL', 'copy', k, i, 'url'), btn('Copy code', 'copy', k, i, 'snippet'), jump, (a.method === 'GET' || a.method === '?') && !a.dyn && /^https?:\/\//i.test(a.url) ? btn('GET chalao', 'try', k, i) : ''];
  } else if (k === 'forms') {
    title = 'Form: ' + a.id;
    body = tbl([['Method', badge(a.method)], ['Action', esc(a.url)], ['Naam', esc(a.id)], ['Fields', '<div class="fchips">' + (a.fields.length ? a.fields.map(function (f) { return '<span class="chip">' + esc(f.name) + ' · ' + esc(f.type) + '</span>'; }).join('') : 'koi nahi') + '</div>']]) + code('Code', a.snippet);
    acts = [btn('Copy action', 'copy', k, i, 'url'), jump];
  } else if (k === 'frames') {
    title = a.tag + ': ' + shortUrl(a.url);
    body = tbl([['Tag', esc(a.tag)], ['URL', esc(a.url)]]) + code('Code', a.snippet);
    acts = [btn('Copy URL', 'copy', k, i, 'url'), openLink(a.url), jump];
  } else if (k === 'rels') {
    title = a.rel;
    body = tbl([['rel', esc(a.rel)], a.url ? ['URL', esc(a.url)] : null, a.extra ? ['Extra', esc(a.extra)] : null]) + code('Code', a.snippet);
    acts = [a.url ? btn('Copy URL', 'copy', k, i, 'url') : '', openLink(a.url), jump];
  } else if (k === 'links') {
    title = a.text || shortUrl(a.url);
    body = tbl([['Text', esc(a.text || '(khali)')], ['URL', esc(a.url)], ['Type', esc(a.kind)]]) + code('Code', a.snippet);
    acts = [btn('Copy URL', 'copy', k, i, 'url'), openLink(a.url), jump];
  } else return null;

  return { title: title, html: body + '<div class="mact">' + acts.filter(Boolean).join('') + '</div>' };
}

window.USV_assets = { extract: extract, view: view, detail: detail, counts: counts, nameOf: nameOf };
})();

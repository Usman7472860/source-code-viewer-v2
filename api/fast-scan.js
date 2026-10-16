// Vercel Serverless Function: GET /api/fast-scan?url=https://example.com&test=1
// Equivalent to: python3 fast_extractor.py <url> --test-apis

const { PRIVATE_HOST, UA, decode, readLimited } = require('../lib/net.js');

const MAX_BYTES = 2.5 * 1024 * 1024;
const TIMEOUT_MS = 6500;

const API_PATTERNS = [
  /https?:\/\/[^"'\s<>]+\.(?:m3u8|mpd)(?:\?[^"'\s<>]*)?/gi,
  /https?:\/\/(?:api\.[a-zA-Z0-9_\-\.]+|[a-zA-Z0-9_\-\.]+(?:\/[a-zA-Z0-9_\-\.]+)*(?:\/api|\/v\d+|\/graphql|\/rest|\/ajax|\/wp-json|\/trpc))[a-zA-Z0-9_\-\/\?&=%#\.]*/gi,
  /["'`]((?:\/api|\/v\d+|\/graphql|\/rest|\/ajax|\/wp-json|\/trpc)\/[a-zA-Z0-9_\-\/\?&=%#\.]*)["'`]/gi,
  /\bfetch\s*\(\s*["'`]([^"'`\)\s,]+)["'`]/gi,
  /\baxios(?:\.(?:get|post|put|delete|patch))?\s*\(\s*["'`]([^"'`\)\s,]+)["'`]/gi,
  /\$\s*\.\s*(?:get|post|getJSON|ajax)\s*\([^"'`]*["'`]([^"'`\)\s,]+)["'`]/gi,
  /\.open\s*\(\s*["'`](?:GET|POST|PUT|DELETE|PATCH)["'`]\s*,\s*["'`]([^"'`\)\s,]+)["'`]/gi,
  /(?:endpoint|apiUrl|baseURL|api_url|api_endpoint)\s*[:=]\s*["'`]([^"'`\)\s,;]+)["'`]/gi
];

const SECRET_PATTERNS = [
  ['Google API Key', /\bAIza[0-9A-Za-z-_]{35}\b/g],
  ['AWS Access Key ID', /\b(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g],
  ['GitHub Personal Token', /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9a-zA-Z]{36}\b/g],
  ['Stripe Secret Key', /\b(?:sk|rk)_live_[0-9a-zA-Z]{24}\b/g],
  ['Stripe Publishable Key', /\bpk_live_[0-9a-zA-Z]{24}\b/g],
  ['OpenAI API Key', /\bsk-(?:proj-)?[a-zA-Z0-9_-]{32,64}\b/g],
  ['Slack Token', /\bxox[baprs]-[0-9a-zA-Z]{10,48}\b/g],
  ['JWT Token', /\beyJ[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\.[A-Za-z0-9-_]{10,}\b/g],
  ['Bearer Token', /\bBearer\s+[a-zA-Z0-9_\-\.]{20,}\b/gi]
];

async function fastFetch(url, timeoutMs = 5000, extraHeaders = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: Object.assign({ 'user-agent': UA, accept: 'application/json, text/plain, */*' }, extraHeaders)
    });
    const { buf } = await readLimited(r, MAX_BYTES);
    const body = decode(buf, r.headers.get('content-type'));
    return {
      ok: true,
      url: r.url || url,
      status: r.status,
      contentType: r.headers.get('content-type') || '',
      body,
      size: buf.length,
      ms: Math.round(performance.now() - t0)
    };
  } catch (e) {
    return {
      ok: false,
      url,
      status: 0,
      error: e.message || 'fetch failed',
      body: '',
      ms: Math.round(performance.now() - t0)
    };
  } finally {
    clearTimeout(timer);
  }
}

function scanText(text, sourceName, baseUrl) {
  const endpoints = [];
  const secrets = [];
  const seenEp = new Set();
  const seenSec = new Set();

  for (const pat of API_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(text)) !== null) {
      let ep = (m[1] || m[0] || '').trim().replace(/^["'`\\]+|["'`\\]+$/g, '');
      if (ep.length < 4 || /\.(?:js|css|png|jpe?g|svg|woff2?|ico|gif)$/i.test(ep)) continue;
      if (!ep.startsWith('/') && !/^https?:\/\//i.test(ep)) continue;
      let fullUrl = ep;
      try { fullUrl = new URL(ep, baseUrl).href; } catch (e) {}
      if (!seenEp.has(fullUrl)) {
        seenEp.add(fullUrl);
        const lower = ep.toLowerCase();
        const isPost = ['post', 'auth', 'login', 'create', 'submit'].some(k => lower.includes(k));
        endpoints.push({
          endpoint: ep,
          full_url: fullUrl,
          source: sourceName,
          method: isPost ? 'POST' : 'GET'
        });
      }
    }
  }

  for (const [secName, secPat] of SECRET_PATTERNS) {
    secPat.lastIndex = 0;
    let m;
    while ((m = secPat.exec(text)) !== null) {
      const val = (m[1] || m[0] || '').trim();
      if (val && !seenSec.has(val)) {
        seenSec.add(val);
        secrets.push({
          type: secName,
          value: val,
          masked: val.length > 12 ? val.slice(0, 8) + '...' + val.slice(-4) : '***',
          source: sourceName
        });
      }
    }
  }
  return { endpoints, secrets };
}

module.exports = async (req, res) => {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  let target = '';
  let testApis = false;
  let authHeader = '';
  let cookieHeader = '';
  try {
    const parsed = new URL(req.url, 'http://localhost');
    target = (parsed.searchParams.get('url') || '').trim();
    const tParam = parsed.searchParams.get('test') || '1';
    authHeader = (parsed.searchParams.get('auth') || req.headers['x-usv-auth'] || '').trim();
    cookieHeader = (parsed.searchParams.get('cookies') || req.headers['x-usv-cookies'] || '').trim();
    testApis = tParam === '1' || tParam === 'true';
  } catch (e) {}

  if (!target) return send(400, { ok: false, error: 'URL parameter missing' });
  if (!/^https?:\/\//i.test(target)) target = 'https://' + target;

  let u;
  try { u = new URL(target); } catch (e) {
    return send(400, { ok: false, error: 'URL sahi nahi hai.' });
  }
  if (PRIVATE_HOST.test(u.hostname)) {
    return send(400, { ok: false, error: 'Private addresses not allowed' });
  }

  const tStart = performance.now();
  const pageRes = await fastFetch(u.href, TIMEOUT_MS);
  if (!pageRes.ok) {
    return send(502, { ok: false, error: 'Failed to fetch target: ' + (pageRes.error || 'Unknown') });
  }

  const html = pageRes.body;
  const finalUrl = pageRes.url;

  const scriptRe = /<script[^>]+src=["']([^"']+)["']/gi;
  const jsUrls = [];
  const seenJs = new Set();
  let sm;
  while ((sm = scriptRe.exec(html)) !== null) {
    try {
      const full = new URL(sm[1].trim(), finalUrl).href;
      if (/^https?:\/\//i.test(full) && !seenJs.has(full) && jsUrls.length < 20) {
        seenJs.add(full);
        jsUrls.push(full);
      }
    } catch (e) {}
  }

  const inlineRe = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  const sources = [{ name: 'HTML Source', text: html, url: finalUrl }];
  let idx = 0, im;
  while ((im = inlineRe.exec(html)) !== null) {
    if (im[1].trim()) sources.push({ name: `Inline Script #${++idx}`, text: im[1], url: finalUrl });
  }

  if (jsUrls.length) {
    const jsResults = await Promise.all(jsUrls.map(url => fastFetch(url, 4000)));
    jsResults.forEach((r, i) => {
      if (r.ok && r.body) {
        const fname = jsUrls[i].split('/').pop().split('?')[0] || `script-${i}.js`;
        sources.push({ name: fname, text: r.body, url: jsUrls[i] });
      }
    });
  }

  const totalEndpoints = [];
  const totalSecrets = [];
  const seenEndpoints = new Set();

  for (const src of sources) {
    const { endpoints, secrets } = scanText(src.text, src.name, finalUrl);
    for (const ep of endpoints) {
      if (!seenEndpoints.has(ep.full_url)) {
        seenEndpoints.add(ep.full_url);
        totalEndpoints.push(ep);
      }
    }
    totalSecrets.push(...secrets);
  }

  const testedResponses = [];
  if (testApis && totalEndpoints.length) {
    const targets = totalEndpoints.filter(e => /^https?:\/\//i.test(e.full_url)).slice(0, 12);
    const testRes = await Promise.all(targets.map(async ep => {
      const extraH = {};
      if (authHeader) extraH['authorization'] = authHeader.includes(' ') ? authHeader : ('Bearer ' + authHeader);
      if (cookieHeader) extraH['cookie'] = cookieHeader;
      const r = await fastFetch(ep.full_url, 3500, extraH);
      return {
        url: ep.full_url,
        endpoint: ep.endpoint,
        status: r.status,
        ms: r.ms,
        contentType: r.contentType || '',
        snippet: (r.body || '').slice(0, 300).trim(),
        source: ep.source
      };
    }));
    testedResponses.push(...testRes);
  }

  const duration = Number(((performance.now() - tStart) / 1000).toFixed(2));
  return send(200, {
    ok: true,
    target,
    finalUrl,
    duration,
    files_analyzed: sources.length,
    endpoints_count: totalEndpoints.length,
    secrets_count: totalSecrets.length,
    endpoints: totalEndpoints,
    secrets: totalSecrets,
    tested_responses: testedResponses
  });
};

// Vercel Serverless Function: POST /api/proxy
// Body (text/plain, JSON): { url, method, headers, body, page }
// Sends the request from the server and returns status, headers and body as JSON.
// The previewed website's fetch/XHR calls go through here so they work without CORS
// and so the viewer can show every GET and POST.

const { PRIVATE_HOST, UA, isTextType, decode, readLimited } = require('../lib/net.js');

const TEXT_MAX = 3.5 * 1024 * 1024; // JSON response must stay under Vercel's ~4.5 MB limit
const BIN_MAX = 2.5 * 1024 * 1024; // base64 adds a third
const REQ_MAX = 1024 * 1024;
const TIMEOUT_MS = 8000;
const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const DROP =
  /^(host|content-length|connection|keep-alive|transfer-encoding|upgrade|te|trailer|proxy-.*|cookie|accept-encoding|origin|referer|sec-.*)$/i;

function cors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
  res.setHeader('access-control-max-age', '86400');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'string') return resolve(req.body);
      if (Buffer.isBuffer(req.body)) return resolve(req.body.toString('utf8'));
      return resolve(JSON.stringify(req.body));
    }
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > REQ_MAX * 2) {
        reject(new Error('too big'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  cors(res);
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') return send(405, { ok: false, error: 'POST chahiye.' });

  let spec;
  try {
    spec = JSON.parse(await readBody(req));
  } catch (e) {
    return send(400, { ok: false, error: 'Request body sahi nahi hai.' });
  }
  if (!spec || typeof spec !== 'object') return send(400, { ok: false, error: 'Request body sahi nahi hai.' });

  let u;
  try {
    u = new URL(String(spec.url || ''));
  } catch (e) {
    return send(400, { ok: false, error: 'URL sahi nahi hai.' });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return send(400, { ok: false, error: 'Sirf http aur https links chalte hain.' });
  }
  if (PRIVATE_HOST.test(u.hostname)) {
    return send(400, { ok: false, error: 'Private ya local address allowed nahi.' });
  }

  const method = String(spec.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) return send(400, { ok: false, error: 'Ye method allowed nahi.' });

  const payload = spec.body == null ? null : String(spec.body);
  if (payload && payload.length > REQ_MAX) return send(413, { ok: false, error: 'Request body 1 MB se badi hai.' });

  const headers = {};
  const given = spec.headers && typeof spec.headers === 'object' ? spec.headers : {};
  for (const k of Object.keys(given)) {
    const v = given[k];
    if (typeof v !== 'string' || DROP.test(k) || !/^[\w-]+$/.test(k)) continue;
    headers[k.toLowerCase()] = v;
  }
  if (!headers['user-agent']) headers['user-agent'] = UA;
  if (!headers.accept) headers.accept = '*/*';
  if (!headers['accept-language']) headers['accept-language'] = 'en-US,en;q=0.9';
  try {
    if (spec.page) {
      const p = new URL(String(spec.page));
      headers.origin = p.origin;
      headers.referer = p.href;
    }
  } catch (e) {}

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const init = { method, headers, redirect: 'follow', signal: ctrl.signal };
    if (payload != null && method !== 'GET' && method !== 'HEAD') init.body = payload;
    const r = await fetch(u.href, init);

    const finalUrl = r.url || u.href;
    try {
      if (PRIVATE_HOST.test(new URL(finalUrl).hostname)) {
        return send(400, { ok: false, error: 'Redirect private address par ja raha hai.' });
      }
    } catch (e) {}

    const contentType = r.headers.get('content-type') || '';
    const text = isTextType(contentType);
    const { buf, truncated } = await readLimited(r, text ? TEXT_MAX : BIN_MAX);

    const outHeaders = {};
    r.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'set-cookie') outHeaders[k] = v;
    });

    return send(200, {
      ok: true,
      status: r.status,
      statusText: r.statusText || '',
      finalUrl,
      contentType,
      headers: outHeaders,
      encoding: text ? 'text' : 'base64',
      body: text ? decode(buf, contentType) : buf.toString('base64'),
      size: buf.length,
      truncated,
    });
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Site ne 8 second mein jawab nahi diya.' : 'Site tak pahunch nahi saka.';
    return send(502, { ok: false, error: msg });
  } finally {
    clearTimeout(timer);
  }
};

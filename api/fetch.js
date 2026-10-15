// Vercel Serverless Function: GET /api/fetch?url=https://example.com&ua=desktop
// Fetches a public page or file on the server so the browser is not blocked by CORS.

const { PRIVATE_HOST, UA, USER_AGENTS, decode, readLimited } = require('../lib/net.js');

const MAX_BYTES = 3.5 * 1024 * 1024; // Vercel limits a function response to about 4.5 MB
const TIMEOUT_MS = 8000; // Vercel Hobby functions stop after about 10 seconds

module.exports = async (req, res) => {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };

  let target = '';
  let uaChoice = 'desktop';
  try {
    const parsed = new URL(req.url, 'http://localhost');
    target = parsed.searchParams.get('url') || '';
    uaChoice = parsed.searchParams.get('ua') || 'desktop';
  } catch (e) {}

  let u;
  try {
    u = new URL(target);
  } catch (e) {
    return send(400, { ok: false, error: 'URL sahi nahi hai.' });
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return send(400, { ok: false, error: 'Sirf http aur https links chalte hain.' });
  }
  if (PRIVATE_HOST.test(u.hostname)) {
    return send(400, { ok: false, error: 'Private ya local address allowed nahi.' });
  }

  const selectedUa = USER_AGENTS[uaChoice] || USER_AGENTS.desktop;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const t0 = performance.now();

  try {
    const r = await fetch(u.href, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': selectedUa,
        accept: 'text/html,application/xhtml+xml,text/css,application/javascript,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
      },
    });

    const elapsedMs = Math.round(performance.now() - t0);
    const finalUrl = r.url || u.href;
    try {
      if (PRIVATE_HOST.test(new URL(finalUrl).hostname)) {
        return send(400, { ok: false, error: 'Redirect private address par ja raha hai.' });
      }
    } catch (e) {}

    const { buf, truncated } = await readLimited(r, MAX_BYTES);
    const body = decode(buf, r.headers.get('content-type'));

    const headers = {};
    r.headers.forEach((v, k) => {
      const lower = k.toLowerCase();
      if (lower !== 'set-cookie') {
        headers[lower] = v;
      }
    });

    return send(200, {
      ok: true,
      status: r.status,
      statusText: r.statusText || '',
      finalUrl,
      contentType: r.headers.get('content-type') || '',
      headers,
      truncated,
      body,
      ms: elapsedMs,
      size: buf.length
    });
  } catch (e) {
    const msg = e && e.name === 'AbortError' ? 'Site ne 8 second mein jawab nahi diya.' : 'Site tak pahunch nahi saka.';
    return send(502, { ok: false, error: msg });
  } finally {
    clearTimeout(timer);
  }
};

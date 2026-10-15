'use strict';
// Helpers shared by the Vercel functions in /api and local server.

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|\[?::1?\]?|\[?f[cd][0-9a-f:]*\]?)$/i;

const USER_AGENTS = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  mobile: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
};

const UA = USER_AGENTS.desktop;

const TEXT_TYPE =
  /^(text\/|application\/(json|javascript|x-javascript|ecmascript|xml|xhtml\+xml|x-www-form-urlencoded|graphql|ld\+json|manifest\+json|vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|audio\/(mpegurl|x-mpegurl))|\+(json|xml)$|^image\/svg\+xml$/i;

function isTextType(contentType, url) {
  if (url && /\.(m3u8|mpd|vtt|srt|json|xml|txt|css|m?js)(?=$|[?#])/i.test(String(url))) return true;
  if (url && /\.(ts|m4s|mp4|webm|aac|mp3|png|jpe?g|webp|gif|ico|woff2?)(?=$|[?#])/i.test(String(url))) return false;
  const t = String(contentType || '').split(';')[0].trim();
  return !t || TEXT_TYPE.test(t);
}

function decode(buf, contentType) {
  const m = /charset=["']?([\w-]+)/i.exec(contentType || '');
  const label = m ? m[1] : 'utf-8';
  try {
    return new TextDecoder(label).decode(buf);
  } catch (e) {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function readLimited(res, max) {
  if (!res.body || !res.body.getReader) {
    const all = Buffer.from(await res.arrayBuffer());
    return { buf: all.subarray(0, max), truncated: all.length > max };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      const keep = value.length - (total - max);
      if (keep > 0) chunks.push(value.subarray(0, keep));
      truncated = true;
      try {
        await reader.cancel();
      } catch (e) {}
      break;
    }
    chunks.push(value);
  }
  return { buf: Buffer.concat(chunks.map((c) => Buffer.from(c))), truncated };
}

function parseCookieStr(str) {
  const jar = {};
  String(str || '').split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      if (k) jar[k] = v;
    }
  });
  return jar;
}

function extractSetCookies(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') {
    try { return headers.getSetCookie() || []; } catch (e) {}
  }
  const raw = headers.get ? headers.get('set-cookie') : null;
  if (!raw) return [];
  return String(raw).split(/,(?=\s*[\w.-]+=)/);
}

function mergeSetCookies(jar, setCookieArr) {
  for (const sc of setCookieArr) {
    const firstPart = String(sc || '').split(';')[0];
    const idx = firstPart.indexOf('=');
    if (idx > 0) {
      const k = firstPart.slice(0, idx).trim();
      const v = firstPart.slice(idx + 1).trim();
      if (!k) continue;
      if (v === '' || /max-age=0/i.test(sc) || /expires=thu,\s*01[- ]jan[- ]1970/i.test(sc)) {
        delete jar[k];
      } else {
        jar[k] = v;
      }
    }
  }
}

function jarToString(jar) {
  return Object.keys(jar).map((k) => `${k}=${jar[k]}`).join('; ');
}

// Fetches a URL while preserving Set-Cookie across redirects (essential for Login flows!)
async function fetchWithCookies(initialUrl, initOpts, initialCookieStr, maxRedirects = 6) {
  const jar = parseCookieStr(initialCookieStr);
  let curUrl = initialUrl;
  let method = (initOpts.method || 'GET').toUpperCase();
  let body = initOpts.body !== undefined ? initOpts.body : undefined;
  const baseHeaders = Object.assign({}, initOpts.headers || {});

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const reqHeaders = Object.assign({}, baseHeaders);
    const cookieHeader = jarToString(jar);
    if (cookieHeader) reqHeaders['cookie'] = cookieHeader;

    const r = await fetch(curUrl, {
      method,
      headers: reqHeaders,
      body: (method === 'GET' || method === 'HEAD') ? undefined : body,
      redirect: 'manual',
      signal: initOpts.signal
    });

    mergeSetCookies(jar, extractSetCookies(r.headers));

    const loc = r.headers.get('location');
    if (loc && (r.status === 301 || r.status === 302 || r.status === 303 || r.status === 307 || r.status === 308) && hop < maxRedirects) {
      let nextUrl;
      try {
        nextUrl = new URL(loc, curUrl).href;
      } catch (e) {
        break;
      }
      const nextHost = new URL(nextUrl).hostname;
      if (PRIVATE_HOST.test(nextHost)) {
        throw new Error('Redirect private address par ja raha hai.');
      }
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
        delete baseHeaders['content-type'];
        delete baseHeaders['content-length'];
      }
      try {
        const nextParsed = new URL(nextUrl);
        baseHeaders['origin'] = nextParsed.origin;
        baseHeaders['referer'] = curUrl;
      } catch (e) {}
      curUrl = nextUrl;
      continue;
    }

    return {
      response: r,
      finalUrl: r.url || curUrl,
      cookies: jarToString(jar)
    };
  }

  throw new Error('Too many redirects');
}

module.exports = {
  PRIVATE_HOST,
  UA,
  USER_AGENTS,
  isTextType,
  decode,
  readLimited,
  fetchWithCookies,
  parseCookieStr,
  jarToString
};

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
  /^(text\/|application\/(json|javascript|x-javascript|ecmascript|xml|xhtml\+xml|x-www-form-urlencoded|graphql|ld\+json|manifest\+json))|\+(json|xml)$|^image\/svg\+xml$/i;

function isTextType(contentType) {
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

// Reads at most `max` bytes from a fetch Response body.
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

// Simple counting semaphore so a burst of heavy requests (many concurrent
// users, or a page that pulls in many JS files) can't open unbounded
// sockets at once and exhaust memory/file descriptors.
class Semaphore {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.queue = [];
  }
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

// Shared outbound-fetch gate: caps how many requests this process has in
// flight at once, independent of any single handler's own timeout.
const fetchGate = new Semaphore(Number(process.env.MAX_CONCURRENT_FETCHES) || 24);

// fetch() with a timeout and retry/backoff for transient failures.
// Retries network errors, aborts, and 5xx responses; never retries 4xx,
// so a bad URL still fails fast.
async function fetchWithRetry(url, options = {}, { retries = 2, timeoutMs = 8000, baseDelayMs = 200 } = {}) {
  return fetchGate.run(async () => {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...options, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status >= 500 && res.status < 600 && attempt < retries) {
          lastErr = new Error(`HTTP ${res.status}`);
          await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
          continue;
        }
        return res;
      } catch (e) {
        clearTimeout(timer);
        lastErr = e;
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, baseDelayMs * 2 ** attempt));
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr;
  });
}

module.exports = { PRIVATE_HOST, UA, USER_AGENTS, isTextType, decode, readLimited, Semaphore, fetchGate, fetchWithRetry };

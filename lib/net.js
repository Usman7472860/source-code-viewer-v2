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

module.exports = { PRIVATE_HOST, UA, USER_AGENTS, isTextType, decode, readLimited };

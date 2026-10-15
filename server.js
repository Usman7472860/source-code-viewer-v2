'use strict';

// Standalone local development & production HTTP server.
// Runs without external dependencies using Node.js built-in modules.
// Works alongside Vercel serverless functions.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const fetchHandler = require('./api/fetch.js');
const proxyHandler = require('./api/proxy.js');
const fastScanHandler = require('./api/fast-scan.js');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

// Caps how many /api/* requests this process will handle at once. Each one
// can fan out into several outbound fetches (lib/net.js's own fetchGate
// bounds those), so this is a second, outer guard against a burst of heavy
// requests piling up faster than the process can drain them.
const MAX_CONCURRENT_API = Number(process.env.MAX_CONCURRENT_API) || 40;
let activeApiRequests = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf'
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt']);

function serveStatic(req, res, pathname) {
  let relPath = pathname === '/' ? '/index.html' : pathname;
  // Prevent directory traversal
  const safePath = path.normalize(relPath).replace(/^(\.\.[\/\\])+/, '');
  const filePath = path.join(ROOT, safePath);

  // Check if file exists within ROOT
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('File not found: ' + pathname);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    const cacheControl = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    const etag = `"${stats.mtimeMs.toString(16)}-${stats.size.toString(16)}"`;

    // Conditional GET: lets repeat clients (and any CDN in front of this)
    // skip re-downloading unchanged assets — the win compounds once many
    // users are loading the same large JS bundles.
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag });
      return res.end();
    }

    const range = req.headers.range;
    if (range && /^bytes=/.test(range)) {
      const [startStr, endStr] = range.replace('bytes=', '').split('-');
      let start = startStr ? parseInt(startStr, 10) : 0;
      let end = endStr ? parseInt(endStr, 10) : stats.size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stats.size}` });
        return res.end();
      }
      end = Math.min(end, stats.size - 1);
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${stats.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        ETag: etag
      });
      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
        }
        res.end('Server Error');
      });
      return stream.pipe(res);
    }

    const acceptEncoding = req.headers['accept-encoding'] || '';
    const canGzip = COMPRESSIBLE.has(ext) && /gzip/.test(acceptEncoding) && stats.size > 1024;

    const headers = {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'Accept-Ranges': 'bytes',
      ETag: etag
    };

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
      }
      res.end('Server Error');
    });

    if (canGzip) {
      headers['Content-Encoding'] = 'gzip';
      res.writeHead(200, headers);
      stream.pipe(zlib.createGzip()).pipe(res);
    } else {
      headers['Content-Length'] = stats.size;
      res.writeHead(200, headers);
      stream.pipe(res);
    }
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  const isApiRoute = pathname === '/api/fetch' || pathname === '/api/proxy' || pathname === '/api/fast-scan';

  if (isApiRoute) {
    if (activeApiRequests >= MAX_CONCURRENT_API) {
      res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '1' });
      return res.end(JSON.stringify({ ok: false, error: 'Server busy, thodi der mein dobara koshish karein.' }));
    }
    activeApiRequests++;
    res.on('finish', () => { activeApiRequests--; });
    res.on('close', () => { activeApiRequests--; });

    try {
      if (pathname === '/api/fetch') return await fetchHandler(req, res);
      if (pathname === '/api/proxy') return await proxyHandler(req, res);
      if (pathname === '/api/fast-scan') return await fastScanHandler(req, res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Internal server error.' }));
      }
      return;
    }
  }

  // Health check endpoint
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      server: 'US-MODS-Standalone',
      timestamp: Date.now(),
      activeApiRequests,
      maxConcurrentApi: MAX_CONCURRENT_API
    }));
  }

  return serveStatic(req, res, pathname);
});

// Keep-alive tuning: under heavy concurrent browser load, reusing
// connections instead of renegotiating TCP/TLS per request meaningfully
// cuts latency and file-descriptor churn.
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

server.listen(PORT, () => {
  console.log('========================================================');
  console.log(`  🚀 US MODS Source Viewer Server Started!`);
  console.log(`  🔗 Local URL:  http://localhost:${PORT}`);
  console.log(`  📦 APIs Ready: /api/fetch, /api/proxy, /api/fast-scan`);
  console.log(`  🛡️  Max concurrent API requests: ${MAX_CONCURRENT_API}`);
  console.log('========================================================');
});

function shutdown() {
  console.log('\nShutting down gracefully...');
  server.close(() => process.exit(0));
  // Force-exit if connections won't drain in time.
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

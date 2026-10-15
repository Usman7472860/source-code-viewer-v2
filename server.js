'use strict';

// Standalone local development & production HTTP server.
// Runs without external dependencies using Node.js built-in modules.
// Works alongside Vercel serverless functions.

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const fetchHandler = require('./api/fetch.js');
const proxyHandler = require('./api/proxy.js');
const fastScanHandler = require('./api/fast-scan.js');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

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

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // Route API requests
  if (pathname === '/api/fetch') {
    return fetchHandler(req, res);
  }
  if (pathname === '/api/proxy') {
    return proxyHandler(req, res);
  }
  if (pathname === '/api/fast-scan') {
    return fastScanHandler(req, res);
  }

  // Health check endpoint
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', server: 'US-MODS-Standalone', timestamp: Date.now() }));
  }

  // Static file serving
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
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server Error');
      }
    });
    stream.pipe(res);
  });
});

server.listen(PORT, () => {
  console.log('========================================================');
  console.log(`  🚀 US MODS Source Viewer Server Started!`);
  console.log(`  🔗 Local URL:  http://localhost:${PORT}`);
  console.log(`  📦 APIs Ready: /api/fetch, /api/proxy`);
  console.log('========================================================');
});

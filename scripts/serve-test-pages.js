#!/usr/bin/env node
/**
 * Local static server for integration-test fixture pages.
 *
 * Serves `tests/integration/fixtures/` over HTTP so you can drive the
 * test pages manually with se-cli (or a browser) without running the
 * full Vitest suite:
 *
 *   npm run test-pages:serve
 *   # -> http://127.0.0.1:8930/forms.html
 *
 *   se-cli open http://127.0.0.1:8930/forms.html
 *   se-cli snapshot
 *
 * Optional: PORT=xxxx to change the port (default 8930).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const FIXTURES_DIR = path.join(__dirname, '..', 'tests', 'integration', 'fixtures');
const PORT = Number(process.env.PORT) || 8930;
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Dynamic API routes — mirrors the DynamicRoutes registered in
// tests/integration/test-server.ts so v0.7 network-debug.html buttons
// (fetch / route mocks) work when serving fixtures manually.
const DYNAMIC_ROUTES = {
  '/api/json': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Hello from JSON API', status: 'ok' }));
  },
  '/api/data': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: [1, 2, 3], count: 3 }));
  },
  '/api/submit': (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, data: body }));
    });
  },
  '/api/mock-endpoint': (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ original: true }));
  },
  '/api/notfound': (_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  },
};

if (!fs.existsSync(FIXTURES_DIR)) {
  console.error(`Fixtures directory not found: ${FIXTURES_DIR}`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);

  // Dynamic API routes take precedence (matching test-server.ts)
  const handler = DYNAMIC_ROUTES[pathname];
  if (handler) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    handler(req, res);
    return;
  }

  let file = pathname;
  if (file === '/') file = '/example.html';

  const filePath = path.join(FIXTURES_DIR, file);
  if (!filePath.startsWith(FIXTURES_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not Found: ${file}`);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(data);
  });
});

server.listen(PORT, HOST, () => {
  const pages = fs.readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.html'));
  console.log(`Test pages server running at http://${HOST}:${PORT}/`);
  console.log(`Serving ${pages.length} fixture pages from: ${FIXTURES_DIR}`);
  console.log('');
  console.log('Try it with se-cli:');
  console.log(`  se-cli open http://${HOST}:${PORT}/forms.html`);
  console.log('  se-cli snapshot');
  console.log('');
  console.log('Press Ctrl+C to stop.');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Set PORT=xxxx to pick another.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}

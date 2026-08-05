'use strict';

/**
 * Shared dynamic API routes — single source of truth for the integration
 * test server (tests/integration/test-server.ts via lifecycle.test.ts) and
 * the manual fixture server (scripts/serve-test-pages.js).
 *
 * Keep in sync with the buttons in tests/integration/fixtures/network-debug.html
 * that fetch these endpoints.
 */

/**
 * Register every API route onto `routes` (a Map<path, handler> compatible
 * with test-server.ts's DynamicRoutes).
 */
function registerApiRoutes(routes) {
  routes.set('/api/json', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Hello from JSON API', status: 'ok' }));
  });

  routes.set('/api/data', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: [1, 2, 3], count: 3 }));
  });

  routes.set('/api/submit', (req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: true, data: body }));
    });
  });

  routes.set('/api/mock-endpoint', (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ original: true }));
  });

  routes.set('/api/notfound', (_req, res) => {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  });
}

module.exports = { registerApiRoutes };

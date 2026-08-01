/**
 * v0.7: Network route mock commands.
 *
 * Registers network intercepts via BiDi network.addIntercept to mock
 * API responses — useful for testing error handling in CI.
 *
 * Usage:
 *   route <pattern> --status=401 --body='{"error":"invalid"}'
 *   route-list
 *   unroute 0
 *   unroute --all
 */

import { Response } from '../../response';
import {
  ensureBidiInitialized,
  addRoute,
  getRoutes,
  getRoute,
  deactivateRoute,
  removeRoute,
  removeAllRoutes,
} from './network-state';

/**
 * Send a BiDi command directly via the WebSocket connection.
 *
 * This bypasses selenium-webdriver's wrapper methods (network.addIntercept,
 * network.removeIntercept, etc.) which crash with
 * "Cannot read properties of undefined (reading 'intercept')" when the
 * browser returns an error response (no `result` field).
 *
 * Direct BiDi sends let us check for `response.error` and provide
 * meaningful error messages.
 */
async function bidiSend(driver: any, method: string, params: Record<string, any>): Promise<any> {
  const bidi = await driver.getBidi();
  const response = await bidi.send({ method, params });

  if (response.error) {
    throw new Error(
      `BiDi ${method} failed: ${response.error}${response.message ? ' — ' + response.message : ''}`,
    );
  }

  return response;
}

export async function browser_route(
  driver: any,
  params: {
    pattern: string;
    status?: string;
    body?: string;
    headers?: string;
  },
  response: Response,
): Promise<void> {
  await ensureBidiInitialized(driver);

  // Parse parameters
  const status = params.status ? parseInt(params.status) : null;
  const body = params.body || null;
  let headers: Record<string, string> | null = null;
  if (params.headers) {
    try {
      headers = JSON.parse(params.headers);
    } catch {
      throw new Error(`Invalid --headers JSON: ${params.headers}`);
    }
  }

  // --status is required: without it, the BiDi intercept would block
  // matching requests indefinitely (no handler to continue/provide response).
  if (status === null) {
    throw new Error(
      'Route requires --status parameter. Usage: route <pattern> --status=<code> [--body=...] [--headers=...]',
    );
  }

  // Register the BiDi intercept directly (bypasses selenium-webdriver wrapper
  // that crashes on error responses).
  // Use type: 'pattern' for glob matching (* and ? wildcards).
  // type: 'string' would require an exact URL match and rejects wildcards.
  const interceptResponse = await bidiSend(driver, 'network.addIntercept', {
    phases: ['beforeRequestSent'],
    urlPatterns: [{ type: 'pattern', pattern: params.pattern }],
  });

  const interceptId = interceptResponse.result?.intercept;
  if (!interceptId) {
    throw new Error(
      'Route intercept did not return an intercept ID. The browser may not support BiDi network interception.',
    );
  }

  // Add to route registry. The beforeRequestSent handler in doInit
  // (network-state.ts) checks active routes and provides mock responses
  // when matching requests are intercepted.
  const routeEntry = addRoute(interceptId, params.pattern, status, body, headers);

  const statusStr = ` → ${status}`;
  const bodyStr = body ? ` ${body.slice(0, 60)}${body.length > 60 ? '...' : ''}` : '';
  response.addResult(`Route ${routeEntry.index}: ${params.pattern}${statusStr}${bodyStr}`);
  response.addCode(
    `// route "${params.pattern}" --status=${status}${body ? ` --body='${body}'` : ''}`,
  );
}

export async function browser_route_list(
  driver: any,
  _params: any,
  response: Response,
): Promise<void> {
  await ensureBidiInitialized(driver);

  const routes = getRoutes();
  if (routes.length === 0) {
    response.addResult('(no active routes)');
  } else {
    const lines = routes.map(r => {
      const statusStr = r.status !== null ? ` → ${r.status}` : '';
      const bodyStr = r.body ? ` ${r.body.slice(0, 60)}${r.body.length > 60 ? '...' : ''}` : '';
      return `[${r.index}] ${r.pattern}${statusStr}${bodyStr}`;
    });
    response.addResult(lines.join('\n'));
  }
  response.addCode('// route-list');
}

export async function browser_unroute(
  driver: any,
  params: {
    index?: number;
    all?: boolean;
  },
  response: Response,
): Promise<void> {
  await ensureBidiInitialized(driver);

  if (params.all) {
    const removed = removeAllRoutes();
    // Deactivate all routes so handler closures stop processing
    for (const route of removed) {
      deactivateRoute(route.index);
    }
    // Remove all intercepts from BiDi
    for (const route of removed) {
      try {
        await bidiSend(driver, 'network.removeIntercept', { intercept: route.interceptId });
      } catch {
        // Ignore — intercept may already be gone
      }
    }
    response.addResult(`Removed all ${removed.length} route(s)`);
    response.addCode('// unroute --all');
    return;
  }

  if (params.index === undefined || params.index === null) {
    throw new Error('unroute requires an index or --all flag. Usage: unroute <index> | unroute --all');
  }

  const route = getRoute(params.index);
  if (!route) {
    throw new Error(`No route at index ${params.index}. Use 'route-list' to see active routes.`);
  }

  // Deactivate first so the handler stops processing immediately
  deactivateRoute(params.index);

  const removed = removeRoute(params.index);
  if (!removed) {
    throw new Error(`No route at index ${params.index}. Use 'route-list' to see active routes.`);
  }

  try {
    await bidiSend(driver, 'network.removeIntercept', { intercept: removed.interceptId });
  } catch {
    // Ignore — intercept may already be gone
  }

  response.addResult(`Removed route ${params.index}: ${removed.pattern}`);
  response.addCode(`// unroute ${params.index}`);
}

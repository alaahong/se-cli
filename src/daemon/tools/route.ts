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
  getNetwork,
  type RouteEntry,
} from './network-state';

/**
 * Simple glob matching: * matches any characters except /, ** matches any.
 */
function matchesGlob(url: string, pattern: string): boolean {
  // Convert glob to regex
  const regex = pattern
    .replace(/\*\*/g, '.*')  // ** → .* (any characters including /)
    .replace(/\*/g, '[^/]*')  // * → [^/]* (any chars except /)
    .replace(/\?/g, '.');     // ? → . (single char)
  return new RegExp(regex, 'i').test(url);
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

  const network = getNetwork();
  if (!network) {
    throw new Error('BiDi Network not initialized. Ensure the browser supports BiDi.');
  }

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

  // Build BiDi intercept parameters using the correct Selenium 4.46 API.
  const { AddInterceptParameters } = require('selenium-webdriver/bidi/addInterceptParameters');
  const { InterceptPhase } = require('selenium-webdriver/bidi/interceptPhase');

  const interceptParams = new AddInterceptParameters(InterceptPhase.BEFORE_REQUEST_SENT);
  interceptParams.urlStringPattern(params.pattern);

  // Register the intercept
  const interceptId = await network.addIntercept(interceptParams);

  // Set up a response handler that intercepts matching requests and
  // provides a mock response. The handler checks routeEntry.active so
  // it can be deactivated by unroute without removing the listener
  // (Selenium BiDi doesn't support removing individual listeners).
  const { ProvideResponseParameters } = require('selenium-webdriver/bidi/provideResponseParameters');
  const { BytesValue, Header } = require('selenium-webdriver/bidi/networkTypes');

  // Store route index for the handler closure to check active status
  const routeEntry = addRoute(interceptId, params.pattern, status, body, headers);
  const routeIndex = routeEntry.index;

  await network.beforeRequestSent(async (event: any) => {
    if (!event || !event.request) return;

    // Check if this route is still active (not unrouter)
    const currentRoute = getRoute(routeIndex);
    if (!currentRoute || !currentRoute.active) return;

    const url = event.request.url || '';
    if (matchesGlob(url, params.pattern)) {
      try {
        const requestId = event.request.request || event.request.id;
        const provideParams = new ProvideResponseParameters(requestId);
        provideParams.statusCode(status);
        if (body) {
          provideParams.body(new BytesValue(BytesValue.Type.STRING, body));
        }
        if (headers) {
          const headerList = Object.entries(headers).map(
            ([k, v]) => new Header(k, new BytesValue(BytesValue.Type.STRING, v)),
          );
          provideParams.headers(headerList);
        }
        await network.provideResponse(provideParams);
      } catch {
        // If providing response fails, continue the request normally
        try {
          const { ContinueRequestParameters } = require('selenium-webdriver/bidi/continueRequestParameters');
          const requestId = event.request.request || event.request.id;
          const continueParams = new ContinueRequestParameters(requestId);
          await network.continueRequest(continueParams);
        } catch {
          // Ignore — request will timeout
        }
      }
    }
  });

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

  const network = getNetwork();
  if (!network) {
    throw new Error('BiDi Network not initialized.');
  }

  if (params.all) {
    const removed = removeAllRoutes();
    // Deactivate all routes so handler closures stop processing
    for (const route of removed) {
      deactivateRoute(route.index);
    }
    // Remove all intercepts from BiDi
    for (const route of removed) {
      try {
        await network.removeIntercept(route.interceptId);
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
    await network.removeIntercept(removed.interceptId);
  } catch {
    // Ignore — intercept may already be gone
  }

  response.addResult(`Removed route ${params.index}: ${removed.pattern}`);
  response.addCode(`// unroute ${params.index}`);
}

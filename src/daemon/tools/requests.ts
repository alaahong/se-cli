/**
 * v0.7: Network requests list and inspection commands.
 *
 * Captures network requests via BiDi network.beforeRequestSent and
 * network.responseCompleted events. Requests are buffered in the daemon.
 *
 * Usage:
 *   requests                          — list all requests
 *   requests --filter="api.example"   — filter by URL substring
 *   requests --status=500              — filter by HTTP status code
 *   requests --method=GET              — filter by HTTP method
 *   requests --clear                    — clear the buffer
 *   request 0                           — show details of request #0
 */

import { Response } from '../../response';
import {
  ensureBidiInitialized,
  getNetworkRequests,
  getNetworkRequest,
  clearNetworkRequests,
  type NetworkRequestEntry,
} from './network-state';

function truncateUrl(url: string, maxLen: number = 80): string {
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen - 3) + '...';
}

function formatRequestList(entries: NetworkRequestEntry[]): string[] {
  return entries.map(e => {
    const status = e.status !== null ? `${e.status}` : '---';
    const duration = e.duration !== null ? `${Math.round(e.duration)}ms` : '---';
    return `[${e.index}] ${e.method} ${truncateUrl(e.url)} → ${status} (${duration})`;
  });
}

function formatRequestDetail(entry: NetworkRequestEntry): string {
  const lines: string[] = [];
  lines.push(`URL: ${entry.url}`);
  lines.push(`Method: ${entry.method}`);
  lines.push(`Status: ${entry.status !== null ? entry.status : '(pending)'} ${entry.statusText}`);

  // Request headers
  const reqHeaders = Object.entries(entry.requestHeaders);
  if (reqHeaders.length > 0) {
    lines.push('Request headers:');
    for (const [k, v] of reqHeaders) {
      lines.push(`  ${k}: ${v}`);
    }
  } else {
    lines.push('Request headers: (none)');
  }

  // Request body
  if (entry.requestBody) {
    const body = entry.requestBody.length > 200
      ? entry.requestBody.slice(0, 200) + '... (truncated)'
      : entry.requestBody;
    lines.push(`Request body: ${body}`);
  } else {
    lines.push('Request body: (none)');
  }

  // Response headers
  const respHeaders = Object.entries(entry.responseHeaders);
  if (respHeaders.length > 0) {
    lines.push('Response headers:');
    for (const [k, v] of respHeaders) {
      lines.push(`  ${k}: ${v}`);
    }
  } else {
    lines.push('Response headers: (none)');
  }

  // Response body
  if (entry.responseBody) {
    const body = entry.responseBody.length > 1000
      ? entry.responseBody.slice(0, 1000) + '... (truncated)'
      : entry.responseBody;
    lines.push(`Response body: ${body}`);
  } else {
    lines.push('Response body: (none)');
  }

  return lines.join('\n');
}

export async function browser_requests(
  driver: any,
  params: {
    filter?: string;
    status?: string;
    method?: string;
    clear?: boolean;
  },
  response: Response,
): Promise<void> {
  await ensureBidiInitialized(driver);

  // Clear buffer if requested
  if (params.clear) {
    clearNetworkRequests();
    response.addResult('Network request buffer cleared');
    response.addCode('// requests --clear');
    return;
  }

  // Parse filters
  const statusFilter = params.status ? parseInt(params.status) : undefined;

  const entries = getNetworkRequests(params.filter, statusFilter, params.method);

  if (entries.length === 0) {
    response.addResult('(no network requests)');
  } else {
    const lines = formatRequestList(entries);
    response.addResult(lines.join('\n'));
  }

  response.addCode(`// requests${params.filter ? ` --filter="${params.filter}"` : ''}${params.status ? ` --status=${params.status}` : ''}${params.method ? ` --method=${params.method}` : ''}`);
}

export async function browser_request(
  driver: any,
  params: {
    index: number;
  },
  response: Response,
): Promise<void> {
  await ensureBidiInitialized(driver);

  const entry = getNetworkRequest(params.index);
  if (!entry) {
    throw new Error(`No network request at index ${params.index}. Use 'requests' to list available requests.`);
  }

  response.addResult(formatRequestDetail(entry));
  response.addCode(`// request ${params.index}`);
}

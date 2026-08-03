import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { McpServer, startHttpServer } from '../../src/mcp-server';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-mcp-http-'));
});

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

async function startServer(opts: { port?: number } = {}): Promise<{ server: http.Server; base: string }> {
  const mcp = new McpServer(tmpDir, 'http');
  const server = startHttpServer(mcp, { port: opts.port ?? 0, host: '127.0.0.1' });
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

function post(base: string, pathname: string, body: any, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      base + pathname,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      },
      (res) => {
        let out = '';
        res.on('data', (c) => (out += c));
        res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: out }));
      }
    );
    req.on('error', reject);
    req.end(data);
  });
}

function get(base: string, pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathname, { method: 'GET', headers }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: out }));
    });
    req.on('error', reject);
    req.end();
  });
}

function del(base: string, pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(base + pathname, { method: 'DELETE' }, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => resolve({ status: res.statusCode!, body: out }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('MCP Streamable HTTP transport', () => {
  it('POST initialize returns protocol info and mints a session id', async () => {
    const { server, base } = await startServer();
    try {
      const res = await post(base, '/mcp', {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      const sessionId = res.headers['mcp-session-id'];
      expect(sessionId).toBeTruthy();
      const parsed = JSON.parse(res.body);
      expect(parsed.id).toBe(1);
      expect(parsed.result.protocolVersion).toBe('2025-06-18');
      expect(parsed.result.serverInfo.name).toBe('se-cli');

      // Subsequent request echoes the session id.
      const list = await post(base, '/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, {
        'Mcp-Session-Id': sessionId as string,
      });
      expect(list.headers['mcp-session-id']).toBe(sessionId);
      const tools = JSON.parse(list.body).result.tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(40);
    } finally {
      server.close();
    }
  });

  it('POST with SSE accept responds with text/event-stream', async () => {
    const { server, base } = await startServer();
    try {
      const res = await post(base, '/mcp', { jsonrpc: '2.0', id: 3, method: 'ping' }, {
        Accept: 'text/event-stream',
      });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.body).toContain('event: message');
      expect(res.body).toContain('"id":3');
    } finally {
      server.close();
    }
  });

  it('POST notifications return 202 Accepted without a body', async () => {
    const { server, base } = await startServer();
    try {
      const res = await post(base, '/mcp', {
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      expect(res.status).toBe(202);
      expect(res.body).toBe('');
    } finally {
      server.close();
    }
  });

  it('POST invalid JSON returns 400 with a parse error', async () => {
    const { server, base } = await startServer();
    try {
      const res = await post(base, '/mcp', 'not-json');
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.code).toBe(-32700);
    } finally {
      server.close();
    }
  });

  it('POST invalid request shape returns 400', async () => {
    const { server, base } = await startServer();
    try {
      const res = await post(base, '/mcp', { jsonrpc: '2.0', id: 4 });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body).error.code).toBe(-32600);
    } finally {
      server.close();
    }
  });

  it('GET /mcp opens an SSE stream', async () => {
    const { server, base } = await startServer();
    try {
      // The SSE stream stays open — resolve as soon as headers arrive.
      const result = await new Promise<{ status: number; contentType: string }>((resolve, reject) => {
        const req = http.request(base + '/mcp', { method: 'GET', headers: { Accept: 'text/event-stream' } }, (res) => {
          const info = { status: res.statusCode!, contentType: String(res.headers['content-type'] || '') };
          res.destroy();
          resolve(info);
        });
        req.on('error', reject);
        req.end();
        setTimeout(() => {
          if (!req.destroyed) req.destroy();
          resolve({ status: 0, contentType: '' });
        }, 5000);
      });
      expect(result.status).toBe(200);
      expect(result.contentType).toContain('text/event-stream');
    } finally {
      server.close();
    }
  });

  it('DELETE /mcp terminates the session', async () => {
    const { server, base } = await startServer();
    try {
      const res = await del(base, '/mcp');
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({});
    } finally {
      server.close();
    }
  });

  it('unknown paths return 404 and unsupported methods 405', async () => {
    const { server, base } = await startServer();
    try {
      const notFound = await post(base, '/other', { jsonrpc: '2.0', id: 1, method: 'ping' });
      expect(notFound.status).toBe(404);
      const put = await new Promise<number>((resolve, reject) => {
        const req = http.request(base + '/mcp', { method: 'PUT' }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        });
        req.on('error', reject);
        req.end();
      });
      expect(put).toBe(405);
    } finally {
      server.close();
    }
  });

  it('handles EADDRINUSE on listen with a clean error instead of crashing', async () => {
    // Occupy a port first.
    const blocker = http.createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const addr = blocker.address() as any;
    const mcp = new McpServer(tmpDir, 'http');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as any);
    try {
      startHttpServer(mcp, { port: addr.port, host: '127.0.0.1' });
      await expect(new Promise<void>((resolve, reject) => {
        // The error event fires asynchronously after listen; the handler
        // calls console.error + process.exit(1) which we spy on.
        setTimeout(resolve, 500);
      })).resolves.toBeUndefined();
      expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('already in use'));
      expect(exitSpy).toHaveBeenCalledWith(1);
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
      blocker.close();
    }
  });

  it('stdio mode still writes responses to stdout (regression)', async () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const server = new McpServer(tmpDir, 'stdio');
      await (server as any).handleRequest({ id: 9, method: 'ping' });
      const written = stdoutSpy.mock.calls.map((c) => String(c[0])).join('');
      const parsed = JSON.parse(written.trim().split('\n').pop()!);
      expect(parsed.id).toBe(9);
      expect(parsed.result).toEqual({});
    } finally {
      stdoutSpy.mockRestore();
    }
  });
});

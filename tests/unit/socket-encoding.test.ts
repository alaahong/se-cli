import { describe, it, expect } from 'vitest';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import { StringDecoder } from 'string_decoder';

/**
 * Integration tests for socket-level UTF-8 encoding.
 *
 * When a large JSON response (e.g. an aria snapshot of a Chinese website like
 * Baidu) is transmitted over a Unix socket / Windows named pipe, the TCP
 * stack may split it across multiple `data` events at arbitrary byte
 * boundaries. If a multi-byte UTF-8 character (e.g. Chinese characters,
 * which are 3 bytes in UTF-8) is split across two chunks, calling
 * `data.toString()` on each chunk independently produces replacement
 * characters (U+FFFD), causing garbled text.
 *
 * The fix uses `StringDecoder('utf8')` which buffers incomplete multi-byte
 * sequences across chunks and only emits complete characters.
 */

function makeSocketPath(): string {
  const name = 'se-cli-test-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\' + name
    : path.join(os.tmpdir(), name + '.sock');
}

describe('socket UTF-8 encoding', () => {
  it('handles multi-byte characters split across TCP chunks', async () => {
    const socketPath = makeSocketPath();

    // Simulate a daemon response containing Chinese text
    const chineseText = [
      '- document:',
      '  - banner "百度":',
      '    - link "新闻"',
      '    - link "网页"',
      '    - searchbox "百度搜索" [ref=e1]',
      '    - button "百度一下" [ref=e2]',
    ].join('\n');
    const response = JSON.stringify({ ok: true, text: chineseText }) + '\n';
    const responseBytes = Buffer.from(response, 'utf8');

    // Find a split point that breaks a multi-byte character
    let splitAt = -1;
    for (let i = 0; i < responseBytes.length - 2; i++) {
      if (responseBytes[i] >= 0xE4 && responseBytes[i] <= 0xE9) {
        splitAt = i + 1; // Split after the first byte of a 3-byte char
        break;
      }
    }
    expect(splitAt).toBeGreaterThan(-1);

    const chunk1 = responseBytes.slice(0, splitAt);
    const chunk2 = responseBytes.slice(splitAt);

    const server = net.createServer((socket) => {
      const decoder = new StringDecoder('utf8');
      let buf = '';
      socket.on('data', (data) => {
        buf += decoder.write(data);
        if (buf.includes('\n')) {
          socket.write(chunk1);
          setTimeout(() => socket.write(chunk2), 50);
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = net.connect(socketPath);
    const clientDecoder = new StringDecoder('utf8');
    let clientBuf = '';

    const result = await new Promise<{ text: string; hasReplacement: boolean }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 5000);

      client.on('data', (data) => {
        clientBuf += clientDecoder.write(data);
        if (clientBuf.includes('\n')) {
          clearTimeout(timeout);
          const resp = JSON.parse(clientBuf.split('\n')[0]);
          resolve({
            text: resp.text,
            hasReplacement: resp.text.includes('\uFFFD'),
          });
        }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.write(JSON.stringify({ method: 'ping', params: { args: [], cwd: '' } }) + '\n');
    });

    client.destroy();
    server.close();

    expect(result.hasReplacement).toBe(false);
    expect(result.text).toContain('百度');
    expect(result.text).toContain('新闻');
    expect(result.text).toContain('百度搜索');
  });

  it('reproduces the bug without StringDecoder (proves the fix is needed)', () => {
    // This test verifies that the old approach (data.toString() per chunk)
    // DOES produce garbled text, proving the StringDecoder fix is necessary.
    const chineseText = '百度新闻网页贴吧知道';
    const fullBuffer = Buffer.from(chineseText, 'utf8');

    // Find a Chinese character to split on
    let splitAt = -1;
    for (let i = 0; i < fullBuffer.length - 2; i++) {
      if (fullBuffer[i] >= 0xE4 && fullBuffer[i] <= 0xE9) {
        splitAt = i + 1;
        break;
      }
    }
    expect(splitAt).toBeGreaterThan(-1);

    // Old approach: toString() per chunk
    const oldResult = fullBuffer.slice(0, splitAt).toString() +
                      fullBuffer.slice(splitAt).toString();

    // New approach: StringDecoder
    const decoder = new StringDecoder('utf8');
    const newResult = decoder.write(fullBuffer.slice(0, splitAt)) +
                      decoder.write(fullBuffer.slice(splitAt)) +
                      decoder.end();

    // The old approach should have garbled text
    expect(oldResult).toContain('\uFFFD');

    // The new approach should be correct
    expect(newResult).toBe(chineseText);
    expect(newResult).not.toContain('\uFFFD');
  });

  it('handles large responses with many Chinese characters', async () => {
    const socketPath = makeSocketPath();

    // Simulate a large snapshot with many Chinese characters
    const chineseText = '百度新闻'.repeat(500);
    const response = JSON.stringify({ ok: true, text: chineseText }) + '\n';
    const responseBytes = Buffer.from(response, 'utf8');

    // Split into multiple small chunks (128 bytes each) to maximize
    // the chance of breaking multi-byte characters
    const chunkSize = 128;
    const chunks: Buffer[] = [];
    for (let i = 0; i < responseBytes.length; i += chunkSize) {
      chunks.push(responseBytes.slice(i, i + chunkSize));
    }

    const server = net.createServer((socket) => {
      const decoder = new StringDecoder('utf8');
      let buf = '';
      socket.on('data', (data) => {
        buf += decoder.write(data);
        if (buf.includes('\n')) {
          // Send response in small chunks with tiny delays
          chunks.forEach((chunk, idx) => {
            setTimeout(() => socket.write(chunk), idx * 5);
          });
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = net.connect(socketPath);
    const clientDecoder = new StringDecoder('utf8');
    let clientBuf = '';

    const result = await new Promise<{ hasReplacement: boolean }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 10000);

      client.on('data', (data) => {
        clientBuf += clientDecoder.write(data);
        if (clientBuf.includes('\n')) {
          clearTimeout(timeout);
          const resp = JSON.parse(clientBuf.split('\n')[0]);
          resolve({
            hasReplacement: resp.text.includes('\uFFFD'),
          });
        }
      });

      client.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.write(JSON.stringify({ method: 'ping', params: { args: [], cwd: '' } }) + '\n');
    });

    client.destroy();
    server.close();

    expect(result.hasReplacement).toBe(false);
  });
});

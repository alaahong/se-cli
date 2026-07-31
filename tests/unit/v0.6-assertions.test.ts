import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  resolveConfig,
  DEFAULTS,
  type ParsedFlags,
} from '../../src/wait-config';
import { parseCommand } from '../../src/daemon/backend';
import { AssertionError } from '../../src/daemon/tools/expect';

// Helper: create a temp directory with optional config file
function makeTempDir(configContent?: object): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-cli-v06-'));
  if (configContent) {
    fs.writeFileSync(
      path.join(dir, '.se-cli.json'),
      JSON.stringify(configContent, null, 2) + '\n',
      'utf8'
    );
  }
  return dir;
}

// Helper: clean up temp directory
function cleanupDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

// Helper: mock driver with element methods
function makeMockDriver(overrides: Record<string, any> = {}) {
  const mockEl = {
    isDisplayed: vi.fn(async () => true),
    isEnabled: vi.fn(async () => true),
    isSelected: vi.fn(async () => false),
    getText: vi.fn(async () => 'Hello World'),
    getAttribute: vi.fn(async (name: string) => {
      if (name === 'value') return 'test@example.com';
      if (name === 'data-testid') return 'test-link';
      if (name === 'data-role') return 'button';
      if (name === 'data-value') return '42';
      if (name === 'target') return '_blank';
      if (name === 'href') return 'https://example.com';
      return null;
    }),
    ...overrides,
  };

  const driver = {
    findElement: vi.fn(async () => mockEl),
    findElements: vi.fn(async () => [mockEl, mockEl, mockEl]),
    getTitle: vi.fn(async () => 'Assertion Test Page'),
    getCurrentUrl: vi.fn(async () => 'http://localhost:3000/assertions.html'),
    manage: vi.fn(() => ({ timeouts: vi.fn(() => ({
      implicitWait: vi.fn(async () => {}),
      pageLoadTimeout: vi.fn(async () => {}),
      setScriptTimeout: vi.fn(async () => {}),
    })) })),
    ...overrides,
  };
  return { driver, mockEl };
}

describe('v0.6 Web-First Assertions', () => {

  // ── DEFAULTS.perCommand: expect ──────────────────────────

  describe('DEFAULTS.perCommand: expect', () => {
    it('has attached default for expect', () => {
      expect(DEFAULTS.perCommand.expect).toBeDefined();
      expect(DEFAULTS.perCommand.expect?.wait?.state).toBe('attached');
    });
  });

  // ── resolveConfig: expect command ─────────────────────────

  describe('resolveConfig: expect command', () => {
    const tmpDir = makeTempDir();
    afterEach(() => cleanupDir(tmpDir));

    it('resolves auto state to attached for expect', () => {
      const config = resolveConfig({}, tmpDir, {}, 'expect');
      // perCommand 'attached' is not 'auto', so it should be 'attached'
      expect(config.wait.state).toBe('attached');
    });

    it('respects --timeout flag for expect', () => {
      const flags: ParsedFlags = { timeout: '10000' };
      const config = resolveConfig(flags, tmpDir, {}, 'expect');
      expect(config.wait.timeout).toBe(10000);
    });

    it('respects --no-wait flag for expect (overrides to none)', () => {
      const flags: ParsedFlags = { 'no-wait': true };
      const config = resolveConfig(flags, tmpDir, {}, 'expect');
      expect(config.wait.state).toBe('none');
      expect(config.wait.timeout).toBe(0);
    });
  });

  // ── parseCommand: expect routing ──────────────────────────

  describe('parseCommand: expect routing', () => {
    it('parses expect <ref> visible', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'visible']);
      expect(toolName).toBe('browser_expect');
      expect(toolParams.target).toBe('e1');
      expect(toolParams.assertion).toBe('visible');
      expect(toolParams.not).toBe(false);
      expect(toolParams.exact).toBe(false);
    });

    it('parses expect <ref> hidden', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'hidden']);
      expect(toolName).toBe('browser_expect');
      expect(toolParams.assertion).toBe('hidden');
    });

    it('parses expect <ref> enabled', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'enabled']);
      expect(toolParams.assertion).toBe('enabled');
    });

    it('parses expect <ref> disabled', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'disabled']);
      expect(toolParams.assertion).toBe('disabled');
    });

    it('parses expect <ref> checked', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'checked']);
      expect(toolParams.assertion).toBe('checked');
    });

    it('parses expect <ref> unchecked', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'unchecked']);
      expect(toolParams.assertion).toBe('unchecked');
    });

    it('parses expect <ref> text "expected"', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'text', 'Hello World']);
      expect(toolParams.target).toBe('e1');
      expect(toolParams.assertion).toBe('text');
      expect(toolParams.expected).toBe('Hello World');
    });

    it('parses expect <ref> value "expected"', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'value', 'test@example.com']);
      expect(toolParams.assertion).toBe('value');
      expect(toolParams.expected).toBe('test@example.com');
    });

    it('parses expect <ref> count N', () => {
      const { toolName, toolParams } = parseCommand(['expect', '.item', 'count', '3']);
      expect(toolParams.assertion).toBe('count');
      expect(toolParams.expected).toBe('3');
    });

    it('parses expect <ref> attribute name value', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'e1', 'attribute', 'data-role', 'button']);
      expect(toolParams.assertion).toBe('attribute');
      expect(toolParams.expected).toBe('data-role');
      expect(toolParams.attributeValue).toBe('button');
    });

    it('parses expect title "..."', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'title', 'Test Page']);
      expect(toolParams.target).toBe('title');
      expect(toolParams.assertion).toBe('Test Page');
    });

    it('parses expect url "..."', () => {
      const { toolName, toolParams } = parseCommand(['expect', 'url', 'http://localhost']);
      expect(toolParams.target).toBe('url');
      expect(toolParams.assertion).toBe('http://localhost');
    });

    it('parses --not flag', () => {
      const { toolParams } = parseCommand(['expect', 'e1', 'visible', '--not']);
      expect(toolParams.not).toBe(true);
    });

    it('parses --exact flag', () => {
      const { toolParams } = parseCommand(['expect', 'e1', 'text', 'Hello', '--exact']);
      expect(toolParams.exact).toBe(true);
    });

    it('parses --timeout flag', () => {
      const { toolParams, flags } = parseCommand(['expect', 'e1', 'visible', '--timeout=10000']);
      expect(flags.timeout).toBe('10000');
    });

    it('parses --no-wait flag', () => {
      const { flags } = parseCommand(['expect', 'e1', 'visible', '--no-wait']);
      expect(flags['no-wait']).toBe(true);
    });
  });

  // ── AssertionError class ──────────────────────────────────

  describe('AssertionError', () => {
    it('creates an error with name "AssertionError"', () => {
      const err = new AssertionError('test message');
      expect(err.name).toBe('AssertionError');
      expect(err.message).toBe('test message');
      expect(err instanceof Error).toBe(true);
    });
  });

  // ── browser_expect: assertion logic ──────────────────────

  describe('browser_expect: assertion logic', () => {
    // These tests verify the behavior of the expect tool using mock drivers.
    // Integration tests in lifecycle.test.ts provide full E2E coverage.

    it('passes when element is visible', async () => {
      const { driver, mockEl } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      mockEl.isDisplayed.mockResolvedValue(true);

      await browser_expect(driver, {
        target: '#visible',
        assertion: 'visible',
        not: false,
        exact: false,
        _wait: { state: 'attached', timeout: 1000 },
      }, response);

      expect(response.serialize()).toContain('visible');
    });

    it('throws AssertionError when element is not visible', async () => {
      const { driver, mockEl } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      mockEl.isDisplayed.mockResolvedValue(false);

      await expect(
        browser_expect(driver, {
          target: '#hidden',
          assertion: 'visible',
          not: false,
          exact: false,
          _wait: { state: 'attached', timeout: 500 },
        }, response)
      ).rejects.toThrow('visible');
    });

    it('passes with --not when element is not visible', async () => {
      const { driver, mockEl } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      mockEl.isDisplayed.mockResolvedValue(false);

      await browser_expect(driver, {
        target: '#hidden',
        assertion: 'visible',
        not: true,
        exact: false,
        _wait: { state: 'attached', timeout: 500 },
      }, response);

      expect(response.serialize()).toContain('not visible');
    });

    it('passes when text contains expected value', async () => {
      const { driver, mockEl } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      mockEl.getText.mockResolvedValue('Hello World');

      await browser_expect(driver, {
        target: '#text',
        assertion: 'text',
        expected: 'Hello',
        not: false,
        exact: false,
        _wait: { state: 'attached', timeout: 500 },
      }, response);

      expect(response.serialize()).toContain('text');
    });

    it('passes with --exact when text matches exactly', async () => {
      const { driver, mockEl } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      mockEl.getText.mockResolvedValue('Hello World');

      await browser_expect(driver, {
        target: '#text',
        assertion: 'text',
        expected: 'Hello World',
        not: false,
        exact: true,
        _wait: { state: 'attached', timeout: 500 },
      }, response);

      expect(response.serialize()).toContain('text');
    });

    it('throws with --exact when text does not match exactly', async () => {
      const { driver, mockEl } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      mockEl.getText.mockResolvedValue('Hello World');

      await expect(
        browser_expect(driver, {
          target: '#text',
          assertion: 'text',
          expected: 'Hello',
          not: false,
          exact: true,
          _wait: { state: 'attached', timeout: 500 },
        }, response)
      ).rejects.toThrow(AssertionError);
    });

    it('passes when title matches', async () => {
      const { driver } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });

      await browser_expect(driver, {
        target: 'title',
        assertion: 'Assertion Test Page',
        not: false,
        exact: false,
        _wait: { state: 'attached', timeout: 500 },
      }, response);

      expect(response.serialize()).toContain('title');
    });

    it('passes when count matches', async () => {
      const { driver } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      driver.findElements.mockResolvedValue([{}, {}, {}]);

      await browser_expect(driver, {
        target: '.count-item',
        assertion: 'count',
        expected: '3',
        not: false,
        exact: false,
        _wait: { state: 'attached', timeout: 500 },
      }, response);

      expect(response.serialize()).toContain('count');
    });

    it('throws AssertionError when count does not match', async () => {
      const { driver } = makeMockDriver();
      const { Response } = await import('../../src/response');
      const { browser_expect } = await import('../../src/daemon/tools/expect');
      const response = new Response({ raw: false, json: false });
      driver.findElements.mockResolvedValue([{}, {}]);

      await expect(
        browser_expect(driver, {
          target: '.count-item',
          assertion: 'count',
          expected: '3',
          not: false,
          exact: false,
          _wait: { state: 'attached', timeout: 500 },
        }, response)
      ).rejects.toThrow(AssertionError);
    });
  });
});

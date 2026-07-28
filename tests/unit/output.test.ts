import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, CliError } from '../../src/output';
import type { ServerMessage } from '../../src/protocol';

describe('render', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new CliError('exit');
    }) as never);
  });

  afterEach(() => {
    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('writes successful text message to stdout', () => {
    const msg: ServerMessage = { ok: true, text: 'hello world' };
    render(msg);
    expect(writeSpy).toHaveBeenCalledWith('hello world\n');
  });

  it('writes successful raw message to stdout without trailing newline', () => {
    const msg: ServerMessage = { ok: true, raw: 'raw-output' };
    render(msg);
    expect(writeSpy).toHaveBeenCalledWith('raw-output');
  });

  it('writes successful json message to stdout as pretty JSON', () => {
    const msg: ServerMessage = { ok: true, json: { result: 'clicked' } };
    render(msg);
    expect(writeSpy).toHaveBeenCalledTimes(1);
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written.trimEnd());
    expect(parsed.result).toBe('clicked');
  });

  it('throws CliError on error message with code', () => {
    const msg: ServerMessage = { ok: false, error: 'something broke', code: 'DRIVER_ERROR' };
    try {
      render(msg);
      throw new Error('expected render to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.code).toBe('DRIVER_ERROR');
      expect(e.message).toContain('something broke');
    }
  });

  it('ELEMENT_NOT_FOUND error includes hint about snapshot', () => {
    const msg: ServerMessage = { ok: false, error: 'no such element', code: 'ELEMENT_NOT_FOUND' };
    try {
      render(msg);
      throw new Error('expected render to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.code).toBe('ELEMENT_NOT_FOUND');
      expect(e.message).toContain('snapshot');
      expect(e.message).toContain('Hint');
    }
  });

  it('DAEMON_DEAD error includes hint about open', () => {
    const msg: ServerMessage = { ok: false, error: 'connection refused', code: 'DAEMON_DEAD' };
    try {
      render(msg);
      throw new Error('expected render to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.code).toBe('DAEMON_DEAD');
      expect(e.message).toContain('open');
      expect(e.message).toContain('Hint');
    }
  });

  it('error without code still throws CliError with no hint', () => {
    const msg: ServerMessage = { ok: false, error: 'unknown failure' };
    try {
      render(msg);
      throw new Error('expected render to throw');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CliError);
      expect(e.message).toContain('unknown failure');
      expect(e.message).not.toContain('Hint');
    }
  });
});

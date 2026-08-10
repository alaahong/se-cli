import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Response } from '../../src/response';
import {
  recorder,
  browser_record_start,
  browser_record_stop,
  browser_record_status,
  browser_record_export,
  browser_record_report,
} from '../../src/daemon/tools/record';

function freshResponse(): Response {
  return new Response({ raw: false, json: false });
}

describe('record daemon tools', () => {
  beforeEach(() => {
    // reset recorder state between tests
    recorder.recording = false;
    recorder.steps = [];
  });

  it('start → status → stop lifecycle', async () => {
    const r1 = freshResponse();
    await browser_record_start(null as any, {}, r1);
    expect(recorder.recording).toBe(true);
    expect(r1.getError()).toBeUndefined();

    const r2 = freshResponse();
    await browser_record_status(null as any, {}, r2);
    expect(r2.getCode()).toEqual([]);
    expect(JSON.stringify(r2.serialize())).toContain('recording');

    // recording guard: start twice fails
    const r1b = freshResponse();
    await expect(browser_record_start(null as any, {}, r1b)).rejects.toThrow(/already active/);

    const r3 = freshResponse();
    await browser_record_stop(null as any, {}, r3);
    expect(recorder.recording).toBe(false);

    // stop when idle fails
    const r3b = freshResponse();
    await expect(browser_record_stop(null as any, {}, r3b)).rejects.toThrow(/not active/);
  });

  it('export requires format and recorded steps', async () => {
    const r1 = freshResponse();
    await expect(browser_record_export(null as any, {}, r1)).rejects.toThrow(/--format is required/);

    const r2 = freshResponse();
    await expect(browser_record_export(null as any, { format: 'mocha' }, r2)).rejects.toThrow(/No recorded steps/);
  });

  it('exports recorded steps to stdout and to a file', async () => {
    recorder.recording = true;
    recorder.steps.push({
      command: 'goto https://example.com',
      code: ["await driver.get('https://example.com');"],
      ok: true,
      timeMs: 10,
      ts: 1,
    });
    recorder.recording = false;

    const r1 = freshResponse();
    await browser_record_export(null as any, { format: 'mocha' }, r1);
    const out = r1.serialize();
    expect(out).toContain("await driver.get('https://example.com');");

    const tmp = path.join(os.tmpdir(), `v011-export-${Date.now()}.test.js`);
    const r2 = freshResponse();
    await browser_record_export(null as any, { format: 'mocha', out: tmp }, r2);
    expect(fs.existsSync(tmp)).toBe(true);
    expect(fs.readFileSync(tmp, 'utf8')).toContain("describe('se-cli session'");
    fs.unlinkSync(tmp);
  });

  it('report requires format and steps; writes junit to file', async () => {
    const r1 = freshResponse();
    await expect(browser_record_report(null as any, {}, r1)).rejects.toThrow(/--format is required/);

    const r2 = freshResponse();
    await expect(browser_record_report(null as any, { format: 'junit' }, r2)).rejects.toThrow(/No recorded steps/);

    recorder.steps.push({
      command: 'click e1',
      code: [],
      ok: false,
      error: 'boom',
      timeMs: 5,
      ts: 1,
    });
    const tmp = path.join(os.tmpdir(), `v011-report-${Date.now()}.xml`);
    const r3 = freshResponse();
    await browser_record_report(null as any, { format: 'junit', out: tmp }, r3);
    expect(fs.existsSync(tmp)).toBe(true);
    const xml = fs.readFileSync(tmp, 'utf8');
    expect(xml).toContain('<testsuite');
    expect(xml).toContain('failures="1"');
    fs.unlinkSync(tmp);

    // stdout path
    const r4 = freshResponse();
    await browser_record_report(null as any, { format: 'html' }, r4);
    expect(r4.serialize()).toContain('<!DOCTYPE html>');
  });

  it('fails gracefully when the output path is not writable', async () => {
    recorder.recording = true;
    recorder.steps.push({
      command: 'goto https://example.com',
      code: ["await driver.get('https://example.com');"],
      ok: true,
      timeMs: 10,
      ts: 1,
    });
    recorder.recording = false;

    const badPath = path.join(os.tmpdir(), 'no-such-dir-xyz', 'out.js');
    const r1 = freshResponse();
    await expect(browser_record_export(null as any, { format: 'mocha', out: badPath }, r1))
      .rejects.toThrow(/Cannot write export file/);

    const r2 = freshResponse();
    await expect(browser_record_report(null as any, { format: 'junit', out: badPath }, r2))
      .rejects.toThrow(/Cannot write report file/);
  });
});

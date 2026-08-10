import { describe, it, expect } from 'vitest';
import { renderJunitXml, renderHtmlReport, renderReport } from '../../src/report';
import type { RecordedStep } from '../../src/recorder';

function makeSteps(): RecordedStep[] {
  return [
    { command: 'goto https://example.com', code: [], ok: true, timeMs: 100, ts: 1 },
    { command: 'click e1', code: [], ok: true, timeMs: 50, ts: 2 },
    { command: 'fill e2 x', code: [], ok: false, error: 'timeout: element not found', timeMs: 2000, ts: 3 },
  ];
}

describe('renderJunitXml', () => {
  it('emits a well-formed JUnit testsuite with counts', () => {
    const out = renderJunitXml(makeSteps(), { name: 'my-suite' });
    expect(out).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(out).toContain('<testsuite name="my-suite" tests="3" failures="1" errors="0" skipped="0"');
    expect(out).toMatch(/time="2\.150"/);
    expect(out).toContain('<testcase name="step-1: goto https://example.com"');
    expect(out).toContain('<failure message="timeout: element not found"');
    // XML escaping
    const evil = renderJunitXml([{ command: 'a & b <c>', code: [], ok: false, error: '"quote"', timeMs: 1, ts: 1 }]);
    expect(evil).toContain('a &amp; b &lt;c&gt;');
    expect(evil).toContain('&quot;quote&quot;');
  });
});

describe('renderHtmlReport', () => {
  it('embeds summary and step rows', () => {
    const out = renderHtmlReport(makeSteps(), { name: 'ci-run' });
    expect(out).toContain('<!DOCTYPE html>');
    expect(out).toContain('<title>se-cli report</title>');
    expect(out).toContain('3 steps');
    expect(out).toContain('2 passed');
    expect(out).toContain('1 failed');
    expect(out).toContain('2150ms total');
    expect(out).toContain('PASS');
    expect(out).toContain('FAIL');
    expect(out).toContain('timeout: element not found');
  });

  it('escapes HTML in commands and codegen', () => {
    const steps: RecordedStep[] = [
      { command: 'goto a & <b>', code: ['await driver.get("<x>");'], ok: true, timeMs: 1, ts: 1 },
    ];
    const out = renderHtmlReport(steps, { name: 'suite & <run>' });
    expect(out).toContain('suite &amp; &lt;run&gt;');
    expect(out).toContain('a &amp; &lt;b&gt;');
    expect(out).toContain('await driver.get(&quot;&lt;x&gt;&quot;);');
  });
});

describe('renderReport dispatch', () => {
  it('routes to the requested format', () => {
    const steps = makeSteps();
    expect(renderReport('junit', steps)).toContain('<testsuite');
    expect(renderReport('html', steps)).toContain('<!DOCTYPE html>');
  });
});

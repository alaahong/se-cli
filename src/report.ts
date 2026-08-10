/**
 * v0.11: Test report generation.
 *
 * Pure functions that render recorded steps as JUnit XML or a standalone
 * HTML report for CI integration. Both formats are self-contained.
 */

import type { RecordedStep } from './recorder';

export interface ReportOptions {
  /** Suite name (default: "se-cli session"). */
  name?: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render recorded steps as a JUnit XML report (JUnit 4 schema — the
 * de-facto standard consumed by Jenkins/GitLab CI/Allure).
 * Each command is a `<testcase>`; failures carry `<failure>` detail.
 */
export function renderJunitXml(steps: RecordedStep[], opts: ReportOptions = {}): string {
  const name = opts.name ?? 'se-cli session';
  const failures = steps.filter((s) => !s.ok);
  const timeSec = steps.reduce((acc, s) => acc + s.timeMs, 0) / 1000;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${escapeXml(name)}" tests="${steps.length}" failures="${failures.length}" errors="0" skipped="0" time="${timeSec.toFixed(3)}">`,
  ];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const ts = (s.timeMs / 1000).toFixed(3);
    const className = escapeXml(name.replace(/[^A-Za-z0-9_.-]/g, '_'));
    if (s.ok) {
      lines.push(`  <testcase name="step-${i + 1}: ${escapeXml(s.command)}" classname="${className}" time="${ts}"/>`);
    } else {
      lines.push(`  <testcase name="step-${i + 1}: ${escapeXml(s.command)}" classname="${className}" time="${ts}">`);
      lines.push(`    <failure message="${escapeXml(s.error ?? 'failed')}" type="CommandError">${escapeXml(s.error ?? 'failed')}</failure>`);
      lines.push('  </testcase>');
    }
  }
  lines.push('</testsuite>');
  return lines.join('\n');
}

/**
 * Render recorded steps as a standalone HTML report with an embedded
 * summary table — no external CSS/JS, opens in any browser.
 */
export function renderHtmlReport(steps: RecordedStep[], opts: ReportOptions = {}): string {
  const name = opts.name ?? 'se-cli session';
  const okCount = steps.filter((s) => s.ok).length;
  const failCount = steps.length - okCount;
  const totalMs = steps.reduce((acc, s) => acc + s.timeMs, 0);

  const rows = steps.map((s, i) => {
    const status = s.ok
      ? '<span style="color:#16a34a;font-weight:600">PASS</span>'
      : '<span style="color:#dc2626;font-weight:600">FAIL</span>';
    const error = s.error
      ? `<div style="color:#dc2626;margin-top:4px;white-space:pre-wrap">${escapeHtml(s.error)}</div>`
      : '';
    const code = s.code.length > 0
      ? `<pre style="background:#0f172a;color:#e2e8f0;padding:8px;border-radius:4px;font-size:12px;overflow-x:auto">${escapeHtml(s.code.join('\n'))}</pre>`
      : '';
    return [
      `<tr>`,
      `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${i + 1}</td>`,
      `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${status}</td>`,
      `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${escapeHtml(s.command)}${error}</td>`,
      `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${s.timeMs}ms</td>`,
      `<td style="padding:6px 10px;border-bottom:1px solid #e2e8f0">${code}</td>`,
      `</tr>`,
    ].join('');
  });

  const summaryColor = failCount > 0 ? '#dc2626' : '#16a34a';
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>se-cli report</title></head>',
    '<body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a">',
    '<div style="max-width:960px;margin:0 auto;padding:24px">',
    `<h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(name)}</h1>`,
    `<div style="font-size:14px;color:#64748b;margin-bottom:16px">${steps.length} steps · ${okCount} passed · `,
    `<span style="color:${summaryColor};font-weight:600">${failCount} failed</span> · ${totalMs}ms total</div>`,
    '<table style="border-collapse:collapse;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">',
    '<thead><tr style="text-align:left;background:#f1f5f9">',
    '<th style="padding:8px 10px">#</th><th style="padding:8px 10px">Status</th>',
    '<th style="padding:8px 10px">Command</th><th style="padding:8px 10px">Time</th>',
    '<th style="padding:8px 10px">Codegen</th>',
    '</tr></thead>',
    '<tbody>',
    rows.join(''),
    '</tbody>',
    '</table>',
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/** Render the report in the requested format. */
export function renderReport(
  format: 'junit' | 'html',
  steps: RecordedStep[],
  opts: ReportOptions = {},
): string {
  switch (format) {
    case 'junit': return renderJunitXml(steps, opts);
    case 'html': return renderHtmlReport(steps, opts);
  }
}

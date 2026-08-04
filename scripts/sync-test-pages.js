#!/usr/bin/env node
/**
 * Sync integration-test fixture pages to the unified site (se-cli/se-site).
 *
 * The fixture pages under `tests/integration/fixtures/` are the source of
 * truth for integration tests. They are mirrored to the documentation
 * site's `static/test-pages/` so the same pages are publicly browsable:
 *
 *   local:  tests/integration/fixtures/          (integration tests)
 *   site:   <se-site>/static/test-pages/          (GitHub Pages mirror)
 *
 * Usage:
 *   npm run test-pages:sync
 *
 * The target is resolved in this order:
 *   1. SE_SITE_DIR=<path> environment variable
 *   2. ../se-site relative to this repo (sibling checkout)
 *
 * Notes:
 *   - Only *.html fixtures are mirrored (index.html is site-specific and
 *     generated/managed by se-site, never overwritten from fixtures).
 *   - Files removed from fixtures are removed from the mirror.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'tests', 'integration', 'fixtures');

function resolveSiteDir() {
  if (process.env.SE_SITE_DIR) {
    return path.resolve(process.env.SE_SITE_DIR);
  }
  return path.join(REPO_ROOT, '..', 'se-site');
}

const SITE_DIR = resolveSiteDir();
const MIRROR_DIR = path.join(SITE_DIR, 'static', 'test-pages');

function err(msg) {
  console.error(msg);
  process.exit(1);
}

if (!fs.existsSync(FIXTURES_DIR)) {
  err(`Fixtures directory not found: ${FIXTURES_DIR}`);
}
if (!fs.existsSync(path.join(SITE_DIR, 'docusaurus.config.ts'))) {
  err(
    `se-site checkout not found at: ${SITE_DIR}\n` +
      `Clone it or set SE_SITE_DIR=<path to se-site repo>.\n` +
      `Expected a Docusaurus project (docusaurus.config.ts) containing static/test-pages/.`
  );
}

fs.mkdirSync(MIRROR_DIR, { recursive: true });

// 1. Copy *.html fixtures into the mirror.
let copied = 0;
for (const file of fs.readdirSync(FIXTURES_DIR)) {
  if (!file.endsWith('.html')) continue;
  fs.copyFileSync(path.join(FIXTURES_DIR, file), path.join(MIRROR_DIR, file));
  copied += 1;
}

// 2. Remove mirrored *.html files that no longer exist in fixtures.
//    index.html is site-managed (test-page index), never deleted here.
let removed = 0;
for (const file of fs.readdirSync(MIRROR_DIR)) {
  if (!file.endsWith('.html') || file === 'index.html') continue;
  if (!fs.existsSync(path.join(FIXTURES_DIR, file))) {
    fs.unlinkSync(path.join(MIRROR_DIR, file));
    removed += 1;
  }
}

console.log(`Synced ${copied} fixture page(s) from:`);
console.log(`  ${FIXTURES_DIR}`);
console.log(`to mirror:`);
console.log(`  ${MIRROR_DIR}`);
if (removed > 0) console.log(`Removed ${removed} stale page(s) from the mirror.`);
console.log('Note: site-managed test-pages/index.html was left untouched.');

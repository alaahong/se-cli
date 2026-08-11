/**
 * v0.11: Session recording & test export.
 *
 * Pure functions (unit-testable) for the recording buffer and the
 * multi-framework test export. The daemon records each executed command
 * (command text + emitted Selenium codegen), and `export` renders the
 * recorded steps as a runnable test file for a target framework.
 */

export interface RecordedStep {
  /** CLI command as typed, e.g. `click e1` */
  command: string;
  /** Codegen lines emitted for this command (may be empty for read-only tools). */
  code: string[];
  /** Whether the command completed successfully. */
  ok: boolean;
  /** Error text when ok === false. */
  error?: string;
  /** Wall-clock duration in ms. */
  timeMs: number;
  /** Unix ms timestamp when the step was recorded. */
  ts: number;
}

export interface RecorderState {
  recording: boolean;
  steps: RecordedStep[];
  startedAt?: number;
}

/** Hard cap on buffered steps — prevents unbounded memory growth on very
 * long recordings. On overflow the oldest steps are dropped. */
export const MAX_RECORDED_STEPS = 10000;

export function createRecorder(): RecorderState {
  return { recording: false, steps: [] };
}

export function startRecording(state: RecorderState): void {
  state.recording = true;
  state.steps = [];
  state.startedAt = Date.now();
}

export function stopRecording(state: RecorderState): void {
  state.recording = false;
}

export function addStep(state: RecorderState, step: Omit<RecordedStep, 'ts'>): void {
  if (!state.recording) return;
  state.steps.push({ ...step, ts: Date.now() });
  if (state.steps.length > MAX_RECORDED_STEPS) {
    state.steps.splice(0, state.steps.length - MAX_RECORDED_STEPS);
  }
}

// ── Framework renderers ──────────────────────────────────────────────────

export interface ExportOptions {
  /** Display name for the test suite (default: "se-cli session"). */
  name?: string;
  /** Browser used to drive the session (default: chrome). */
  browser?: string;
  /** Whether to include steps that failed (default: true). */
  includeFailures?: boolean;
}

/** Steps that have codegen and succeeded — the runnable body. */
function runnableSteps(steps: RecordedStep[], opts: ExportOptions): RecordedStep[] {
  return steps.filter((s) => opts.includeFailures !== false || s.ok);
}

function escapeComment(text: string): string {
  return text.replace(/\r?\n/g, ' ');
}

/** Escape a string for embedding inside a single-quoted JS/Python string. */
function escapeSingleQuote(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Escape a string for embedding inside a double-quoted Java string. */
function escapeDoubleQuote(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Map a se-cli browser name to the selenium-webdriver class/name.
 * JS Builder.forBrowser uses lowercase; the Python binding uses the
 * capitalized class name (webdriver.Chrome()).
 */
function pythonBrowserClass(browser: string): string {
  const map: Record<string, string> = {
    chrome: 'Chrome',
    edge: 'Edge',
    firefox: 'Firefox',
    safari: 'Safari',
  };
  return map[browser] ?? 'Chrome';
}

/**
 * Escape a value for use inside an XPath 1.0 string literal delimited by
 * single quotes. XPath has no backslash escapes, so embedded single quotes
 * are split via concat() — e.g. `O'Brien` becomes concat('O', "'", 'Brien').
 */
function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  const parts = value.split("'");
  const quoted = parts.map((p) => `'${p}'`);
  const pieces: string[] = [];
  for (let i = 0; i < quoted.length; i++) {
    if (i > 0) pieces.push('"\'"');
    pieces.push(quoted[i]);
  }
  return `concat(${pieces.join(', ')})`;
}

/**
 * Render recorded steps as a Node.js Mocha/JS test file.
 * The codegen lines are already plain `await driver.…` JavaScript, so the
 * exported body is exactly the code that was verified live.
 */
export function renderMochaTest(steps: RecordedStep[], opts: ExportOptions = {}): string {
  const name = opts.name ?? 'se-cli session';
  const browser = opts.browser ?? 'chrome';
  const body = runnableSteps(steps, opts);
  // codegen uses `new By('role', …)` and `By.css(…)` — By must be imported.
  const lines: string[] = [
    "const { Builder, By } = require('selenium-webdriver');",
    '',
    `describe('${escapeSingleQuote(name)}', function () {`,
    '  let driver;',
    '',
    '  before(async function () {',
    `    driver = await new Builder().forBrowser('${escapeSingleQuote(browser)}').build();`,
    '  });',
    '',
    '  after(async function () {',
    '    await driver.quit();',
    '  });',
    '',
    `  it('replays ${escapeSingleQuote(name)}', async function () {`,
  ];
  for (const step of body) {
    if (step.code.length > 0) {
      for (const c of step.code) lines.push(`    ${c}`);
    } else {
      lines.push(`    // ${escapeComment(step.command)} (no codegen)`);
    }
    if (!step.ok && step.error) {
      lines.push(`    // FAILED: ${escapeComment(step.error)}`);
    }
  }
  lines.push('  });');
  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

/**
 * Render recorded steps as a Python pytest test file.
 * Uses selenium Python bindings with the same role/css locator semantics.
 */
export function renderPytestTest(steps: RecordedStep[], opts: ExportOptions = {}): string {
  const name = opts.name ?? 'test_se_cli_session';
  const browser = opts.browser ?? 'chrome';
  const body = runnableSteps(steps, opts);
  const fnName = `test_${name.replace(/[^A-Za-z0-9_]/g, '_')}`;
  // By.XPATH / By.CSS_SELECTOR need the By import; webdriver.<Class>() uses
  // the capitalized class name (Chrome/Edge/Firefox/Safari).
  const lines: string[] = [
    '"""Auto-exported from a se-cli recording."""',
    'import pytest',
    'from selenium import webdriver',
    'from selenium.webdriver.common.by import By',
    '',
    '',
    `def ${fnName}():`,
    `    driver = webdriver.${pythonBrowserClass(browser)}()`,
    '    try:',
  ];
  for (const step of body) {
    for (const c of step.code) {
      const py = toPython(c);
      if (py) lines.push(`        ${py}`);
    }
    if (step.code.length === 0) {
      lines.push(`        # ${escapeComment(step.command)} (no codegen)`);
    }
    if (!step.ok && step.error) {
      lines.push(`        # FAILED: ${escapeComment(step.error)}`);
    }
  }
  lines.push('    finally:');
  lines.push('        driver.quit()');
  lines.push('');
  return lines.join('\n');
}

/**
 * Best-effort translation of a JS codegen line to Python. Unsupported
 * lines are emitted as comments so the exported file stays honest about
 * what it replays.
 */

/** Convert a JS single-quoted string literal to a Python single-quoted one. */
function toPythonStringArg(jsLiteral: string): string {
  const inner = unescapeJs(jsLiteral.replace(/^'|'$/g, ''));
  // Re-encode for Python: escape the quote, backslash, and control chars
  // so the emitted literal reproduces the original value exactly.
  return `'${escapeSingleQuote(inner)
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}'`;
}

/**
 * Convert a JS single-quoted string literal to a Java double-quoted one.
 * The JS literal may carry JS escapes; unescape first, then re-encode for
 * Java (including control chars) so the value round-trips correctly.
 */
function toJavaStringArg(jsLiteral: string): string {
  const inner = unescapeJs(jsLiteral.replace(/^'|'$/g, ''));
  return `"${escapeDoubleQuote(inner)
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

/**
 * Unescape a JS single-quoted string literal (as produced by jsString):
 * `\'` → `'`, `\\` → `\`, `\n` → newline, `\r` → CR, `\t` → tab.
 * Single-pass scan so a literal `\\n` (backslash+n) stays intact.
 */
function unescapeJs(literal: string): string {
  return literal.replace(/\\(.)/g, (_m, c: string) => {
    if (c === 'n') return '\n';
    if (c === 'r') return '\r';
    if (c === 't') return '\t';
    return c; // \' → ', \\ → \
  });
}

function toPython(jsLine: string): string | null {
  // await driver.getTitle(); / await driver.getCurrentUrl();
  let m = jsLine.match(/^await driver\.getTitle\(\);\s*$/);
  if (m) return 'title = driver.title';
  m = jsLine.match(/^await driver\.getCurrentUrl\(\);\s*$/);
  if (m) return 'url = driver.current_url';
  // await driver.get('...');
  m = jsLine.match(/^await driver\.get\((.+)\);\s*$/);
  if (m) return `driver.get(${toPythonStringArg(m[1])})`;
  // await driver.findElement(...).click();
  m = jsLine.match(/^await driver\.findElement\((.+)\)\.click\(\);\s*$/);
  if (m) {
    const loc = toPythonLocator(m[1]);
    if (loc) return `driver.find_element(${loc}).click()`;
    return `# (untranslated) ${escapeComment(jsLine)}`;
  }
  // await driver.findElement(...).sendKeys(...);
  m = jsLine.match(/^await driver\.findElement\((.+)\)\.sendKeys\((.+)\);\s*$/);
  if (m) {
    const loc = toPythonLocator(m[1]);
    if (loc) return `driver.find_element(${loc}).send_keys(${toPythonStringArg(m[2])})`;
    return `# (untranslated) ${escapeComment(jsLine)}`;
  }
  // await driver.findElement(...).clear();
  m = jsLine.match(/^await driver\.findElement\((.+)\)\.clear\(\);\s*$/);
  if (m) {
    const loc = toPythonLocator(m[1]);
    if (loc) return `driver.find_element(${loc}).clear()`;
    return `# (untranslated) ${escapeComment(jsLine)}`;
  }
  // Unknown line — keep as comment.
  return `# (untranslated) ${escapeComment(jsLine)}`;
}

function toPythonLocator(jsExpr: string): string | null {
  // new By('role', { role: 'button', name: 'Save' }) — name/role may carry
  // JS-escaped quotes (O\'Brien), so match an escaped-char-aware literal.
  let m = jsExpr.match(/new By\('role', \{ role: '((?:[^'\\]|\\.)*)', name: '((?:[^'\\]|\\.)*)' \}\)/);
  if (m) return `By.XPATH, ".//*[@role=${xpathLiteral(unescapeJs(m[1]))} and normalize-space(.)=${xpathLiteral(unescapeJs(m[2]))}]"`;
  m = jsExpr.match(/new By\('role', \{ role: '((?:[^'\\]|\\.)*)' \}\)/);
  if (m) return `By.XPATH, ".//*[@role=${xpathLiteral(unescapeJs(m[1]))}]"`;
  // By.css('[data-se-ref="e1"]')
  m = jsExpr.match(/By\.css\('((?:[^'\\]|\\.)*)'\)/);
  if (m) return `By.CSS_SELECTOR, '${unescapeJs(m[1])}'`;
  // By.xpath('...')
  m = jsExpr.match(/By\.xpath\('((?:[^'\\]|\\.)*)'\)/);
  if (m) return `By.XPATH, '${unescapeJs(m[1])}'`;
  return null;
}

/**
 * Render recorded steps as a Java JUnit 5 test file.
 * Uses WebDriverManager-free plain Selenium Java bindings; the locator
 * mapping mirrors the pytest renderer (role → XPath, css → CSS).
 */
export function renderJunit5Test(steps: RecordedStep[], opts: ExportOptions = {}): string {
  // Java class names allow [A-Za-z0-9_$]; sanitize anything else.
  const name = (opts.name ?? 'SeCliSessionTest').replace(/[^A-Za-z0-9_$]/g, '_');
  const browser = opts.browser ?? 'chrome';
  const body = runnableSteps(steps, opts);
  const lines: string[] = [
    'import org.junit.jupiter.api.AfterEach;',
    'import org.junit.jupiter.api.BeforeEach;',
    'import org.junit.jupiter.api.Test;',
    'import org.openqa.selenium.By;',
    'import org.openqa.selenium.WebDriver;',
    'import org.openqa.selenium.chrome.ChromeDriver;',
    'import org.openqa.selenium.edge.EdgeDriver;',
    'import org.openqa.selenium.firefox.FirefoxDriver;',
    '',
    `public class ${name} {`,
    '    private WebDriver driver;',
    '',
    '    @BeforeEach',
    '    public void setUp() {',
    `        driver = newDriver("${browser}");`,
    '    }',
    '',
    '    @AfterEach',
    '    public void tearDown() {',
    '        if (driver != null) driver.quit();',
    '    }',
    '',
    '    private WebDriver newDriver(String name) {',
    '        switch (name) {',
    '            case "chrome": return new ChromeDriver();',
    '            case "edge": return new EdgeDriver();',
    '            case "firefox": return new FirefoxDriver();',
    '            default: throw new IllegalArgumentException("Unsupported browser: " + name);',
    '        }',
    '    }',
    '',
    '    @Test',
    '    public void replaysSession() {',
  ];
  for (const step of body) {
    for (const c of step.code) {
      const java = toJava(c);
      if (java) lines.push(`        ${java}`);
    }
    if (step.code.length === 0) {
      lines.push(`        // ${escapeComment(step.command)} (no codegen)`);
    }
    if (!step.ok && step.error) {
      lines.push(`        // FAILED: ${escapeComment(step.error)}`);
    }
  }
  lines.push('    }');
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

function toJava(jsLine: string): string | null {
  let m = jsLine.match(/^await driver\.getTitle\(\);\s*$/);
  if (m) return 'String title = driver.getTitle();';
  m = jsLine.match(/^await driver\.getCurrentUrl\(\);\s*$/);
  if (m) return 'String url = driver.getCurrentUrl();';
  m = jsLine.match(/^await driver\.get\((.+)\);\s*$/);
  if (m) return `driver.get(${toJavaStringArg(m[1])});`;
  m = jsLine.match(/^await driver\.findElement\((.+)\)\.click\(\);\s*$/);
  if (m) {
    const loc = toJavaLocator(m[1]);
    if (loc) return `driver.findElement(${loc}).click();`;
    return `// (untranslated) ${escapeComment(jsLine)}`;
  }
  m = jsLine.match(/^await driver\.findElement\((.+)\)\.sendKeys\((.+)\);\s*$/);
  if (m) {
    const loc = toJavaLocator(m[1]);
    if (loc) return `driver.findElement(${loc}).sendKeys(${toJavaStringArg(m[2])});`;
    return `// (untranslated) ${escapeComment(jsLine)}`;
  }
  m = jsLine.match(/^await driver\.findElement\((.+)\)\.clear\(\);\s*$/);
  if (m) {
    const loc = toJavaLocator(m[1]);
    if (loc) return `driver.findElement(${loc}).clear();`;
    return `// (untranslated) ${escapeComment(jsLine)}`;
  }
  return null;
}

function toJavaLocator(jsExpr: string): string | null {
  let m = jsExpr.match(/new By\('role', \{ role: '((?:[^'\\]|\\.)*)', name: '((?:[^'\\]|\\.)*)' \}\)/);
  if (m) return `By.xpath(".//*[@role=${xpathLiteral(unescapeJs(m[1]))} and normalize-space(.)=${xpathLiteral(unescapeJs(m[2]))}]")`;
  m = jsExpr.match(/new By\('role', \{ role: '((?:[^'\\]|\\.)*)' \}\)/);
  if (m) return `By.xpath(".//*[@role=${xpathLiteral(unescapeJs(m[1]))}]")`;
  m = jsExpr.match(/By\.css\('((?:[^'\\]|\\.)*)'\)/);
  if (m) return `By.cssSelector("${escapeDoubleQuote(unescapeJs(m[1]))}")`;
  m = jsExpr.match(/By\.xpath\('((?:[^'\\]|\\.)*)'\)/);
  if (m) return `By.xpath("${escapeDoubleQuote(unescapeJs(m[1]))}")`;
  return null;
}

/** Render the export in the requested framework. */
export function renderExport(
  format: 'pytest' | 'junit5' | 'mocha',
  steps: RecordedStep[],
  opts: ExportOptions = {},
): string {
  switch (format) {
    case 'pytest': return renderPytestTest(steps, opts);
    case 'junit5': return renderJunit5Test(steps, opts);
    case 'mocha': return renderMochaTest(steps, opts);
  }
}

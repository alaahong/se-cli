import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRecorder,
  startRecording,
  stopRecording,
  addStep,
  renderExport,
  renderMochaTest,
  renderPytestTest,
  renderJunit5Test,
  MAX_RECORDED_STEPS,
  type RecordedStep,
} from '../../src/recorder';

function makeSteps(): RecordedStep[] {
  return [
    {
      command: 'goto https://example.com',
      code: ["await driver.get('https://example.com');"],
      ok: true,
      timeMs: 120,
      ts: 1,
    },
    {
      command: 'fill e1 "hello"',
      code: ["await driver.findElement(new By('role', { role: 'textbox', name: 'Search' })).sendKeys('hello');"],
      ok: true,
      timeMs: 40,
      ts: 2,
    },
    {
      command: 'click e2',
      code: ["await driver.findElement(By.css('[data-se-ref=\"e2\"]')).click();"],
      ok: false,
      error: 'element not interactable',
      timeMs: 30,
      ts: 3,
    },
  ];
}

describe('recorder state machine', () => {
  let state: ReturnType<typeof createRecorder>;

  beforeEach(() => {
    state = createRecorder();
  });

  it('starts idle with no steps', () => {
    expect(state.recording).toBe(false);
    expect(state.steps).toHaveLength(0);
  });

  it('drops steps while idle', () => {
    addStep(state, { command: 'title', code: [], ok: true, timeMs: 1 });
    expect(state.steps).toHaveLength(0);
  });

  it('captures steps while recording and clears on start', () => {
    startRecording(state);
    addStep(state, { command: 'goto x', code: [], ok: true, timeMs: 1 });
    addStep(state, { command: 'title', code: [], ok: false, error: 'boom', timeMs: 2 });
    expect(state.steps).toHaveLength(2);
    expect(state.steps[1].error).toBe('boom');
    // restart clears the buffer
    startRecording(state);
    expect(state.steps).toHaveLength(0);
  });

  it('stopRecording flips the flag and keeps captured steps', () => {
    startRecording(state);
    addStep(state, { command: 'title', code: [], ok: true, timeMs: 1 });
    stopRecording(state);
    expect(state.recording).toBe(false);
    expect(state.steps).toHaveLength(1);
    // no longer capturing
    addStep(state, { command: 'url', code: [], ok: true, timeMs: 1 });
    expect(state.steps).toHaveLength(1);
  });

  it('caps buffered steps at MAX_RECORDED_STEPS (drops oldest)', () => {
    startRecording(state);
    for (let i = 0; i < MAX_RECORDED_STEPS + 5; i++) {
      addStep(state, { command: `step-${i}`, code: [], ok: true, timeMs: 1 });
    }
    expect(state.steps).toHaveLength(MAX_RECORDED_STEPS);
    // oldest steps dropped, newest retained
    expect(state.steps[0].command).toBe(`step-${5}`);
    expect(state.steps[MAX_RECORDED_STEPS - 1].command).toBe(`step-${MAX_RECORDED_STEPS + 4}`);
  });
});

describe('renderMochaTest', () => {
  it('emits a runnable mocha skeleton with codegen body', () => {
    const out = renderMochaTest(makeSteps());
    expect(out).toContain("const { Builder, By, until } = require('selenium-webdriver');");
    expect(out).toContain("describe('se-cli session', function ()");
    expect(out).toContain("forBrowser('chrome')");
    expect(out).toContain("await driver.get('https://example.com');");
    // failed step becomes a comment, body still present
    expect(out).toContain('// FAILED: element not interactable');
  });

  it('honors includeFailures=false by dropping failed steps', () => {
    const out = renderMochaTest(makeSteps(), { includeFailures: false });
    expect(out).not.toContain('element not interactable');
  });

  it('uses custom name and browser', () => {
    const out = renderMochaTest(makeSteps(), { name: 'My Suite', browser: 'firefox' });
    expect(out).toContain("describe('My Suite', function ()");
    expect(out).toContain("forBrowser('firefox')");
  });

  it('escapes single quotes in name and browser', () => {
    const out = renderMochaTest(makeSteps(), { name: "O'Brien's suite", browser: "edge's" });
    expect(out).toContain("describe('O\\'Brien\\'s suite', function ()");
  });
});

describe('renderPytestTest', () => {
  it('translates codegen to python bindings', () => {
    const out = renderPytestTest(makeSteps());
    expect(out).toContain('from selenium import webdriver');
    expect(out).toContain('from selenium.webdriver.common.by import By');
    expect(out).toContain('driver.get(\'https://example.com\')');
    expect(out).toContain("driver.find_element(By.XPATH, \".//*[@role='textbox' and normalize-space(.)='Search']\").send_keys('hello')");
    expect(out).toContain('driver.quit()');
  });

  it('translates css/xpath locators and marks untranslatable lines as comments', () => {
    const steps: RecordedStep[] = [
      { command: 'click x', code: ["await driver.findElement(By.css('[data-se-ref=\"e2\"]')).click();"], ok: true, timeMs: 1, ts: 1 },
      { command: 'click y', code: ["await driver.findElement(By.xpath('//div[@id=\"a\"]')).click();"], ok: true, timeMs: 1, ts: 2 },
      { command: 'weird', code: ['await driver.executeScript("return 1");'], ok: true, timeMs: 1, ts: 3 },
      { command: 'clear', code: ["await driver.findElement(By.css('#a')).clear();"], ok: true, timeMs: 1, ts: 4 },
    ];
    const out = renderPytestTest(steps);
    expect(out).toContain("By.CSS_SELECTOR, '[data-se-ref=\"e2\"]'");
    expect(out).toContain("By.XPATH, '//div[@id=\"a\"]'");
    expect(out).toContain('(untranslated)');
    expect(out).toContain('By.CSS_SELECTOR, \'#a\').clear()');
  });

  it('sanitizes the function name and capitalizes the browser class', () => {
    const out = renderPytestTest([], { name: 'My Suite!', browser: 'firefox' });
    expect(out).toContain('def test_My_Suite_():');
    expect(out).toContain('driver = webdriver.Firefox()');
  });

  it('escapes quotes in role names via xpath concat', () => {
    const steps: RecordedStep[] = [
      { command: 'click o', code: ["await driver.findElement(new By('role', { role: 'button', name: 'O\\'Brien' })).click();"], ok: true, timeMs: 1, ts: 1 },
    ];
    const out = renderPytestTest(steps);
    expect(out).toContain('By.XPATH, ".//*[@role=\'button\' and normalize-space(.)=concat(\'O\', "\'", \'Brien\')]"');
  });
});

describe('renderJunit5Test', () => {
  it('emits a JUnit 5 class with translated locators', () => {
    const out = renderJunit5Test(makeSteps());
    expect(out).toContain('import org.junit.jupiter.api.Test;');
    expect(out).toContain('public class SeCliSessionTest {');
    expect(out).toContain('driver.get("https://example.com");');
    expect(out).toContain('driver.findElement(By.xpath(".//*[@role=\'textbox\' and normalize-space(.)=\'Search\']")).sendKeys("hello");');
  });

  it('translates css/xpath locators and skips untranslatable lines', () => {
    const steps: RecordedStep[] = [
      { command: 'click x', code: ["await driver.findElement(By.css('[data-se-ref=\"e2\"]')).click();"], ok: true, timeMs: 1, ts: 1 },
      { command: 'click y', code: ["await driver.findElement(By.xpath('//div[@id=\"a\"]')).click();"], ok: true, timeMs: 1, ts: 2 },
      { command: 'weird', code: ['await driver.executeScript("return 1");'], ok: true, timeMs: 1, ts: 3 },
      { command: 'clear', code: ["await driver.findElement(By.css('#a')).clear();"], ok: true, timeMs: 1, ts: 4 },
    ];
    const out = renderJunit5Test(steps);
    expect(out).toContain('By.cssSelector("[data-se-ref=\\"e2\\"]")');
    expect(out).toContain('By.xpath("//div[@id=\\"a\\"]")');
    // untranslatable executeScript line is dropped entirely (no comment in java path)
    expect(out).not.toContain('executeScript');
    expect(out).toContain('driver.findElement(By.cssSelector("#a")).clear();');
  });

  it('drops java lines whose locator cannot be translated', () => {
    // role-with-name locator translates; a By.id locator is untranslatable.
    const steps: RecordedStep[] = [
      { command: 'click role', code: ["await driver.findElement(new By('role', { role: 'button', name: 'Save' })).click();"], ok: true, timeMs: 1, ts: 1 },
      { command: 'click id', code: ["await driver.findElement(By.id('x')).click();"], ok: true, timeMs: 1, ts: 2 },
      { command: 'clear bad', code: ["await driver.findElement(By.id('y')).clear();"], ok: true, timeMs: 1, ts: 3 },
    ];
    const out = renderJunit5Test(steps);
    expect(out).toContain('By.xpath(".//*[@role=\'button\' and normalize-space(.)=\'Save\']")');
    // untranslatable locators stay as comments, never as executable code:
    // the only By.id mention must be inside a `//` comment line.
    const execLines = out.split('\n').filter((l) => l.includes('By.id') && !l.trimStart().startsWith('//'));
    expect(execLines).toHaveLength(0);
    expect(out).toContain('// (untranslated) await driver.findElement(By.id(\'x\')).click();');
    expect(out).toContain('// (untranslated) await driver.findElement(By.id(\'y\')).clear();');
  });

  it('annotates junit5 steps without codegen as comments', () => {
    const steps: RecordedStep[] = [
      { command: 'title', code: [], ok: true, timeMs: 1, ts: 1 },
      { command: 'bad-step', code: [], ok: false, error: 'boom', timeMs: 1, ts: 2 },
    ];
    const out = renderJunit5Test(steps);
    expect(out).toContain('// title (no codegen)');
    expect(out).toContain('// FAILED: boom');
  });

  it('marks untranslatable python clear() as a comment', () => {
    const steps: RecordedStep[] = [
      { command: 'clear id', code: ["await driver.findElement(By.id('x')).clear();"], ok: true, timeMs: 1, ts: 1 },
    ];
    const out = renderPytestTest(steps);
    expect(out).toContain('(untranslated)');
  });

  it('sanitizes the java class name', () => {
    const out = renderJunit5Test([], { name: 'My-Suite!Name' });
    expect(out).toContain('public class My_Suite_Name {');
  });

  it('round-trips escaped string args (quotes, backslashes, newlines)', () => {
    // jsString escapes: O\'Brien, a\\b, and a newline become \n.
    const steps: RecordedStep[] = [
      { command: 'fill q', code: ["await driver.findElement(By.css('#a')).sendKeys('O\\'Brien');"], ok: true, timeMs: 1, ts: 1 },
      { command: 'goto bs', code: ["await driver.get('https://x.com/a\\\\b');"], ok: true, timeMs: 1, ts: 1 },
      { command: 'fill nl', code: ["await driver.findElement(By.css('#b')).sendKeys('line1\\nline2');"], ok: true, timeMs: 1, ts: 1 },
    ];
    const py = renderPytestTest(steps);
    // single backslash before the quote — value is O'Brien
    expect(py).toContain("send_keys('O\\'Brien')");
    // double backslash survives as literal backslash
    expect(py).toContain("driver.get('https://x.com/a\\\\b')");
    expect(py).toContain("send_keys('line1\\nline2')");
    const java = renderJunit5Test(steps);
    // double-quoted Java: inner single quote needs no escape
    expect(java).toContain('sendKeys("O\'Brien")');
    expect(java).toContain('driver.get("https://x.com/a\\\\b");');
    expect(java).toContain('sendKeys("line1\\nline2");');
  });

  it('keeps untranslatable pytest clicks as comments (not silent drops)', () => {
    const steps: RecordedStep[] = [
      { command: 'click id', code: ["await driver.findElement(By.id('x')).click();"], ok: true, timeMs: 1, ts: 1 },
    ];
    const out = renderPytestTest(steps);
    expect(out).toContain('# (untranslated) await driver.findElement(By.id(\'x\')).click();');
    expect(out).not.toContain('driver.find_element(By');
  });

  it('translates expect assertions into waits in mocha/pytest/junit5', () => {
    const steps: RecordedStep[] = [
      { command: 'expect visible', code: ["await driver.wait(until.elementIsVisible(By.css('[data-se-ref=\"e1\"]')), 5000);"], ok: true, timeMs: 100, ts: 1 },
      { command: 'expect hidden', code: ["await driver.wait(until.elementIsNotVisible(By.css('#x')), 3000);"], ok: true, timeMs: 100, ts: 2 },
      { command: 'expect enabled', code: ["await driver.wait(until.elementIsEnabled(By.css('#btn')), 2000);"], ok: true, timeMs: 100, ts: 3 },
      { command: 'expect checked', code: ["await driver.wait(until.elementIsNotSelected(By.css('#chk')), 1500);"], ok: true, timeMs: 100, ts: 4 },
    ];
    // mocha needs `until` imported for the verbatim codegen lines
    const mocha = renderMochaTest(steps);
    expect(mocha).toContain("const { Builder, By, until } = require('selenium-webdriver');");

    const py = renderPytestTest(steps);
    expect(py).toContain('from selenium.webdriver.support.ui import WebDriverWait');
    expect(py).toContain('WebDriverWait(driver, 5).until(EC.visibility_of_element_located((By.CSS_SELECTOR, \'[data-se-ref="e1"]\')))');
    expect(py).toContain('WebDriverWait(driver, 3).until(EC.invisibility_of_element_located((By.CSS_SELECTOR, \'#x\')))');
    expect(py).toContain('WebDriverWait(driver, 2).until(EC.element_to_be_clickable((By.CSS_SELECTOR, \'#btn\')))');
    expect(py).toContain('WebDriverWait(driver, 2).until(EC.not_to_be_selected((By.CSS_SELECTOR, \'#chk\')))');

    const java = renderJunit5Test(steps);
    expect(java).toContain('import org.openqa.selenium.support.ui.ExpectedConditions;');
    expect(java).toContain('new WebDriverWait(driver, Duration.ofSeconds(5)).until(ExpectedConditions.visibilityOfElementLocated(By.cssSelector("[data-se-ref=\\"e1\\"]")));');
    expect(java).toContain('ExpectedConditions.invisibilityOfElementLocated(By.cssSelector("#x"))');
    expect(java).toContain('ExpectedConditions.elementToBeClickable(By.cssSelector("#btn"))');
    expect(java).toContain('ExpectedConditions.not(ExpectedConditions.elementToBeSelected(By.cssSelector("#chk")))');
  });

  it('translates dialog alert sendKeys into pytest/junit5', () => {
    const steps: RecordedStep[] = [
      { command: 'dialog text', code: ["await driver.switchTo().alert().sendKeys(\"hello\");"], ok: true, timeMs: 1, ts: 1 },
      { command: 'goto', code: ["await driver.get(\"https://example.com\");"], ok: true, timeMs: 1, ts: 1 },
    ];
    const py = renderPytestTest(steps);
    expect(py).toContain("driver.switch_to.alert.send_keys('hello')");
    expect(py).toContain("driver.get('https://example.com')");
    const java = renderJunit5Test(steps);
    expect(java).toContain('driver.switchTo().alert().sendKeys("hello");');
    expect(java).toContain('driver.get("https://example.com");');
  });
});

describe('renderExport dispatch', () => {
  it('routes to the requested framework', () => {
    const steps = makeSteps();
    expect(renderExport('mocha', steps)).toContain("const { Builder, By, until }");
    expect(renderExport('pytest', steps)).toContain('import pytest');
    expect(renderExport('junit5', steps)).toContain('import org.junit.jupiter.api.Test;');
  });
});

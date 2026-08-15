import { describe, it, expect, vi } from 'vitest';
import * as path from 'path';
import { Response } from '../../src/response';
import { ROLE_SCRIPT, CSS_INFO_SCRIPT, COUNT_ROLE_SCRIPT } from '../../src/daemon/tools/locator';
import { browser_dialog_accept, browser_dialog_dismiss } from '../../src/daemon/tools/dialog';
import { browser_resize } from '../../src/daemon/tools/resize';
import { browser_select } from '../../src/daemon/tools/select';
import { browser_upload } from '../../src/daemon/tools/upload';
import {
  browser_keydown,
  browser_keyup,
  browser_mousemove,
  browser_mousedown,
  browser_mouseup,
  browser_mousewheel,
  browser_actions_chain,
} from '../../src/daemon/tools/advanced-input';

// ── Mock selenium-webdriver ───────────────────────────────────────
// vi.mock intercepts `import` statements (used by shared.ts for `By`),
// but does NOT intercept `require()` calls inside CommonJS source files.
// Therefore, dialog.ts/select.ts/advanced-input.ts use the REAL
// selenium-webdriver module at runtime. The mock driver's elements
// must be compatible with the real Select class (findElements, etc.).

vi.mock('selenium-webdriver', () => ({
  By: {
    css: (selector: string) => ({ using: 'css selector', value: selector }),
  },
  Select: class MockSelect {
    constructor(_el: any) {}
    selectByVisibleText = vi.fn(async () => {});
  },
  Button: { LEFT: 0, RIGHT: 2, MIDDLE: 1 },
  until: {
    alertIsPresent: () => () => true,
    elementIsVisible: () => () => true,
    elementIsNotVisible: () => () => true,
    elementIsEnabled: () => () => true,
    elementIsDisabled: () => () => true,
    stalenessOf: () => () => true,
  },
}));

// ── Mock driver factory ───────────────────────────────────────────

function makeMockDriver(opts: any = {}): any {
  // Mock <option> element — needed by the real Select.selectByVisibleText()
  // which calls setSelected() → option.isSelected() / option.click()
  const mockOptionEl = {
    click: vi.fn(async () => {}),
    isSelected: vi.fn(async () => false),
    isEnabled: vi.fn(async () => true),
    getText: vi.fn(async () => ''),
    getAttribute: vi.fn(async () => ''),
  };

  // Mock element — must be compatible with the real Select class:
  //   constructor calls el.getAttribute('tagName') → must return 'select'
  //   constructor calls el.getAttribute('multiple') → must return null
  //   selectByVisibleText calls el.findElements() → must return [option]
  const mockEl = {
    click: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
    getAttribute: vi.fn(async (name: string) => {
      if (name === 'tagName') return 'select';
      if (name === 'multiple') return null;
      return '';
    }),
    isSelected: vi.fn(async () => false),
    isEnabled: vi.fn(async () => true),
    getText: vi.fn(async () => ''),
    findElements: vi.fn(async () => [mockOptionEl]),
  };

  const alertMock = {
    accept: vi.fn(async () => {}),
    dismiss: vi.fn(async () => {}),
    sendKeys: vi.fn(async () => {}),
  };
  const setRectMock = vi.fn(async () => {});
  const actionsMock = {
    keyDown: vi.fn().mockReturnThis(),
    keyUp: vi.fn().mockReturnThis(),
    move: vi.fn().mockReturnThis(),
    press: vi.fn().mockReturnThis(),
    release: vi.fn().mockReturnThis(),
    scroll: vi.fn().mockReturnThis(),
    click: vi.fn().mockReturnThis(),
    doubleClick: vi.fn().mockReturnThis(),
    pause: vi.fn().mockReturnThis(),
    perform: vi.fn(async () => {}),
  };
  const driver = {
    getTitle: vi.fn(async () => opts.title ?? 'Test Page'),
    getCurrentUrl: vi.fn(async () => opts.url ?? 'https://example.com'),
    findElement: vi.fn(async () => mockEl),
    actions: vi.fn(() => actionsMock),
    manage: vi.fn(() => ({
      window: vi.fn(() => ({ setRect: setRectMock })),
    })),
    switchTo: vi.fn(() => ({
      alert: vi.fn(() => alertMock),
    })),
    wait: vi.fn(async () => {}),
    executeScript: vi.fn(async (...args: any[]) => {
      // v0.9: locator heuristics dispatch. Scripts are wrapped as
      // `return (${ROLE_SCRIPT})(arguments[0]);` at the call site.
      const script = args[0];
      if (typeof script === 'string' && script.includes(ROLE_SCRIPT)) return opts.roleName ?? { role: 'combobox', name: 'Country' };
      if (typeof script === 'string' && script.includes(CSS_INFO_SCRIPT)) return opts.cssInfo ?? { id: 'country', classes: [], tag: 'select', nth: 1 };
      if (typeof script === 'string' && script.includes(COUNT_ROLE_SCRIPT)) return opts.roleMatchCount ?? 1;
      return null;
    }),
    findElements: vi.fn(async () => [mockEl]),
    _el: mockEl,
    _optionEl: mockOptionEl,
    _alert: alertMock,
    _setRect: setRectMock,
    _actions: actionsMock,
  };
  return driver;
}

// ──────────────────────────────────────────────────────────────────
// dialog.ts
// ──────────────────────────────────────────────────────────────────

describe('dialog.ts', () => {
  describe('browser_dialog_accept', () => {
    it('accepts a dialog without text', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_dialog_accept(driver, {}, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver.switchTo).toHaveBeenCalled();
      expect(driver._alert.accept).toHaveBeenCalledTimes(1);
      expect(driver._alert.sendKeys).not.toHaveBeenCalled();
      expect(driver.getTitle).toHaveBeenCalled();
      expect(driver.getCurrentUrl).toHaveBeenCalled();
      expect(out.result).toBe('dialog accepted');
      expect(out.page).toEqual({ url: 'https://example.com', title: 'Test Page' });
      expect(out.code.join('\n')).toContain('await driver.switchTo().alert().accept();');
    });

    it('accepts a dialog with text (prompt)', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_dialog_accept(driver, { text: 'hello world' }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver._alert.sendKeys).toHaveBeenCalledWith('hello world');
      expect(driver._alert.accept).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('dialog accepted');
      expect(out.code.join('\n')).toContain('await driver.switchTo().alert().sendKeys("hello world");');
      expect(out.code.join('\n')).toContain('await driver.switchTo().alert().accept();');
    });

    it('includes page metadata in the response', async () => {
      const driver = makeMockDriver({ title: 'Prompt Page', url: 'https://prompt.test' });
      const resp = new Response({ raw: false, json: true });
      await browser_dialog_accept(driver, {}, resp);
      const out = JSON.parse(resp.serialize());

      expect(out.page).toEqual({ url: 'https://prompt.test', title: 'Prompt Page' });
    });
  });

  describe('browser_dialog_dismiss', () => {
    it('dismisses a dialog', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_dialog_dismiss(driver, {}, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver.switchTo).toHaveBeenCalled();
      expect(driver._alert.dismiss).toHaveBeenCalledTimes(1);
      expect(driver._alert.accept).not.toHaveBeenCalled();
      expect(out.result).toBe('dialog dismissed');
      expect(out.page).toEqual({ url: 'https://example.com', title: 'Test Page' });
      expect(out.code.join('\n')).toContain('await driver.switchTo().alert().dismiss();');
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// resize.ts
// ──────────────────────────────────────────────────────────────────

describe('resize.ts', () => {
  describe('browser_resize', () => {
    it('sets the viewport size via setRect', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_resize(driver, { width: 1024, height: 768 }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver._setRect).toHaveBeenCalledWith({ width: 1024, height: 768 });
      expect(driver.getTitle).toHaveBeenCalled();
      expect(driver.getCurrentUrl).toHaveBeenCalled();
      expect(out.result).toBe('resized to 1024x768');
      expect(out.page).toEqual({ url: 'https://example.com', title: 'Test Page' });
      expect(out.code.join('\n')).toContain('setRect({ width: 1024, height: 768 })');
    });

    it('works with different dimensions', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_resize(driver, { width: 800, height: 600 }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver._setRect).toHaveBeenCalledWith({ width: 800, height: 600 });
      expect(out.result).toBe('resized to 800x600');
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// select.ts
// ──────────────────────────────────────────────────────────────────

describe('select.ts', () => {
  describe('browser_select', () => {
    it('selects an option by visible text using a ref target', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_select(driver, { target: 'e1', value: 'Option A' }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.findElement).toHaveBeenCalled();
      // The real Select class calls findElements then clicks the matching option
      expect(driver._el.findElements).toHaveBeenCalled();
      expect(driver._optionEl.click).toHaveBeenCalled();
      expect(out.result).toBe('selected Option A');
      expect(out.code.join('\n')).toContain("selectByVisibleText('Option A')");
    });

    it('selects an option using a CSS selector target', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_select(driver, { target: 'select#country', value: 'Japan' }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.findElement).toHaveBeenCalled();
      expect(driver._optionEl.click).toHaveBeenCalled();
      expect(out.result).toBe('selected Japan');
      // v0.9: role-based codegen — combobox role locator preferred
      expect(out.code.join('\n')).toContain("new By('role', { role: 'combobox'");
    });

    it('waits for element state when _wait is provided', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_select(
        driver,
        { target: 'e1', value: 'Option B', _wait: { state: 'visible', timeout: 3000 } } as any,
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._optionEl.click).toHaveBeenCalled();
      expect(out.code.join('\n')).toContain('elementIsVisible');
      expect(out.result).toBe('selected Option B');
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// upload.ts
// ──────────────────────────────────────────────────────────────────

describe('upload.ts', () => {
  describe('browser_upload', () => {
    it('uploads a file by sending keys with resolved absolute path', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_upload(driver, { target: 'e1', file: 'test-file.txt' }, resp);
      const out = JSON.parse(resp.serialize());

      const expectedPath = path.resolve('test-file.txt');
      expect(driver.findElement).toHaveBeenCalled();
      expect(driver._el.sendKeys).toHaveBeenCalledWith(expectedPath);
      expect(driver.getTitle).toHaveBeenCalled();
      expect(driver.getCurrentUrl).toHaveBeenCalled();
      expect(out.result).toBe(`uploaded: ${expectedPath}`);
      expect(out.page).toEqual({ url: 'https://example.com', title: 'Test Page' });
      expect(out.code.join('\n')).toContain('sendKeys');
    });

    it('waits for element state when _wait is provided', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_upload(
        driver,
        { target: 'e1', file: 'doc.pdf', _wait: { state: 'enabled', timeout: 2000 } } as any,
        resp,
      );
      const out = JSON.parse(resp.serialize());

      expect(driver.wait).toHaveBeenCalled();
      expect(driver._el.sendKeys).toHaveBeenCalledWith(path.resolve('doc.pdf'));
      expect(out.code.join('\n')).toContain('elementIsEnabled');
      expect(out.result).toContain('uploaded:');
    });

    it('uploads via BiDi input.setFiles when --bidi is set', async () => {
      const send = vi.fn(async () => ({}));
      const mockEl = {
        getId: vi.fn(async () => 'shared-e1'),
        sendKeys: vi.fn(async () => {}),
      };
      const driver = makeMockDriver();
      driver.findElement = vi.fn(async () => mockEl);
      driver.getWindowHandle = vi.fn(async () => 'context-1');
      driver.getBidi = vi.fn(async () => ({ send }));

      const resp = new Response({ raw: false, json: true });
      await browser_upload(driver, { target: 'e1', file: 'test-file.txt', bidi: true } as any, resp);
      const out = JSON.parse(resp.serialize());

      expect(mockEl.sendKeys).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledWith({
        method: 'input.setFiles',
        params: {
          context: 'context-1',
          element: { sharedId: 'shared-e1' },
          files: [path.resolve('test-file.txt')],
        },
      });
      expect(out.code.join('\n')).toContain('setFiles');
      expect(out.result).toContain('uploaded:');
    });

    it('fails clearly when BiDi is unavailable for --bidi uploads', async () => {
      const driver = makeMockDriver();
      driver.getWindowHandle = vi.fn(async () => 'context-1');
      driver.getBidi = vi.fn(async () => { throw new Error('no webSocketUrl'); });

      const resp = new Response({ raw: false, json: true });
      await expect(
        browser_upload(driver, { target: 'e1', file: 'a.txt', bidi: true } as any, resp),
      ).rejects.toThrow(/BiDi/);
    });

    it('surfaces input.setFiles errors', async () => {
      const send = vi.fn(async () => ({ error: { message: 'element not found' } }));
      const driver = makeMockDriver();
      driver.findElement = vi.fn(async () => ({ getId: vi.fn(async () => 'shared-e1') }));
      driver.getWindowHandle = vi.fn(async () => 'context-1');
      driver.getBidi = vi.fn(async () => ({ send }));

      const resp = new Response({ raw: false, json: true });
      await expect(
        browser_upload(driver, { target: 'e1', file: 'a.txt', bidi: true } as any, resp),
      ).rejects.toThrow(/input\.setFiles/);
    });
  });
});

// ──────────────────────────────────────────────────────────────────
// advanced-input.ts
// ──────────────────────────────────────────────────────────────────

describe('advanced-input.ts', () => {
  describe('browser_keydown', () => {
    it('presses and holds a key via actions chain', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_keydown(driver, { key: 'Shift' }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.actions).toHaveBeenCalledWith();
      expect(driver._actions.keyDown).toHaveBeenCalledWith('Shift');
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('keydown: Shift');
      expect(out.page).toEqual({ url: 'https://example.com', title: 'Test Page' });
      expect(out.code.join('\n')).toContain('keyDown("Shift")');
    });
  });

  describe('browser_keyup', () => {
    it('releases a held key via actions chain', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_keyup(driver, { key: 'Control' }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.actions).toHaveBeenCalledWith();
      expect(driver._actions.keyUp).toHaveBeenCalledWith('Control');
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('keyup: Control');
    });
  });

  describe('browser_mousemove', () => {
    it('moves mouse to absolute coordinates', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mousemove(driver, { x: 100, y: 200 }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.actions).toHaveBeenCalledWith();
      expect(driver._actions.move).toHaveBeenCalledWith({ x: 100, y: 200, origin: 'viewport' });
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('moved to (100, 200)');
    });
  });

  describe('browser_mousedown', () => {
    it('presses left mouse button by default (no button param)', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mousedown(driver, {}, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver._actions.press).toHaveBeenCalledWith(0); // Button.LEFT
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('mousedown: left');
    });

    it('presses left mouse button explicitly', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mousedown(driver, { button: 'left' }, resp);

      expect(driver._actions.press).toHaveBeenCalledWith(0);
    });

    it('presses right mouse button', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mousedown(driver, { button: 'right' }, resp);

      expect(driver._actions.press).toHaveBeenCalledWith(2); // Button.RIGHT
    });

    it('presses middle mouse button', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mousedown(driver, { button: 'middle' }, resp);

      expect(driver._actions.press).toHaveBeenCalledWith(1); // Button.MIDDLE
    });
  });

  describe('browser_mouseup', () => {
    it('releases left mouse button by default (no button param)', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mouseup(driver, {}, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver._actions.release).toHaveBeenCalledWith(0); // Button.LEFT
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('mouseup: left');
    });

    it('releases left mouse button explicitly', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mouseup(driver, { button: 'left' }, resp);

      expect(driver._actions.release).toHaveBeenCalledWith(0);
    });

    it('releases right mouse button', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mouseup(driver, { button: 'right' }, resp);

      expect(driver._actions.release).toHaveBeenCalledWith(2); // Button.RIGHT
    });

    it('releases middle mouse button', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mouseup(driver, { button: 'middle' }, resp);

      expect(driver._actions.release).toHaveBeenCalledWith(1); // Button.MIDDLE
    });
  });

  describe('browser_mousewheel', () => {
    it('scrolls wheel by offsets', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      await browser_mousewheel(driver, { dx: 10, dy: 20 }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver.actions).toHaveBeenCalledWith();
      expect(driver._actions.scroll).toHaveBeenCalledWith(0, 0, 10, 20);
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('scrolled (10, 20)');
    });
  });

  describe('browser_actions_chain', () => {
    it('chains move, press, and release in a single perform', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([
        { type: 'move', x: 100, y: 200 },
        { type: 'press' },
        { type: 'release' },
      ]);
      await browser_actions_chain(driver, { actions }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver._actions.move).toHaveBeenCalledWith({ x: 100, y: 200, origin: 'viewport' });
      expect(driver._actions.press).toHaveBeenCalledWith(undefined);
      expect(driver._actions.release).toHaveBeenCalledWith(undefined);
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('performed 3 chained actions');
      expect(out.code.join('\n')).toContain('3 actions chained');
    });

    it('handles move with target element', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([
        { type: 'move', target: 'e1', x: 5, y: 10 },
      ]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver.findElement).toHaveBeenCalled();
      expect(driver._actions.move).toHaveBeenCalledWith({ origin: driver._el, x: 5, y: 10 });
    });

    it('handles move without target defaulting x/y to 0', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'move' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.move).toHaveBeenCalledWith({ x: 0, y: 0, origin: 'viewport' });
    });

    it('handles click without target', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'click' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.click).toHaveBeenCalledWith();
    });

    it('handles click with target element', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'click', target: 'e1' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver.findElement).toHaveBeenCalled();
      expect(driver._actions.click).toHaveBeenCalledWith(driver._el);
    });

    it('handles doubleClick without target', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'doubleClick' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.doubleClick).toHaveBeenCalledWith();
    });

    it('handles doubleClick with target element', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'doubleClick', target: 'e2' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver.findElement).toHaveBeenCalled();
      expect(driver._actions.doubleClick).toHaveBeenCalledWith(driver._el);
    });

    it('handles keydown and keyup steps', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([
        { type: 'keydown', key: 'Shift' },
        { type: 'keyup', key: 'Shift' },
      ]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.keyDown).toHaveBeenCalledWith('Shift');
      expect(driver._actions.keyUp).toHaveBeenCalledWith('Shift');
    });

    it('handles scroll step', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'scroll', x: 0, y: 50 }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.scroll).toHaveBeenCalledWith(0, 0, 0, 50);
    });

    it('handles pause step with duration', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'pause', duration: 500 }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.pause).toHaveBeenCalledWith(500);
    });

    it('handles pause step with default duration (100ms)', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'pause' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.pause).toHaveBeenCalledWith(100);
    });

    it('handles press with button specified', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'press', button: 'right' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.press).toHaveBeenCalledWith(2); // Button.RIGHT
    });

    it('handles release with button specified', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'release', button: 'middle' }]);
      await browser_actions_chain(driver, { actions }, resp);

      expect(driver._actions.release).toHaveBeenCalledWith(1); // Button.MIDDLE
    });

    it('throws on unknown action type', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([{ type: 'unknown' }]);

      await expect(browser_actions_chain(driver, { actions }, resp)).rejects.toThrow(
        'Unknown action type: unknown',
      );
    });

    it('chains a complex sequence of mixed action types', async () => {
      const driver = makeMockDriver();
      const resp = new Response({ raw: false, json: true });
      const actions = JSON.stringify([
        { type: 'move', target: 'e1' },
        { type: 'press', button: 'left' },
        { type: 'release' },
        { type: 'keydown', key: 'Control' },
        { type: 'keyup', key: 'Control' },
        { type: 'click' },
        { type: 'doubleClick', target: 'e2' },
        { type: 'scroll', x: 0, y: 100 },
        { type: 'pause', duration: 200 },
      ]);
      await browser_actions_chain(driver, { actions }, resp);
      const out = JSON.parse(resp.serialize());

      expect(driver._actions.move).toHaveBeenCalled();
      expect(driver._actions.press).toHaveBeenCalledWith(0);
      expect(driver._actions.release).toHaveBeenCalledWith(undefined);
      expect(driver._actions.keyDown).toHaveBeenCalledWith('Control');
      expect(driver._actions.keyUp).toHaveBeenCalledWith('Control');
      expect(driver._actions.click).toHaveBeenCalled();
      expect(driver._actions.doubleClick).toHaveBeenCalledWith(driver._el);
      expect(driver._actions.scroll).toHaveBeenCalledWith(0, 0, 0, 100);
      expect(driver._actions.pause).toHaveBeenCalledWith(200);
      expect(driver._actions.perform).toHaveBeenCalledTimes(1);
      expect(out.result).toBe('performed 9 chained actions');
    });
  });
});

# se-cli Design Specification

**Version**: v0.1.0 (MVP)
**Date**: 2026-07-28
**Status**: Brainstorming complete, pending implementation

## 1. Background & Goals

### 1.1 Background

Current Selenium MCP implementations consume too many tokens, mainly because:
- Tool schemas are large and loaded on every call
- Accessibility tree returns full page data
- No command-line interface; agents must interact via the MCP protocol

Microsoft's playwright-cli has proven that the "short-lived CLI + long-lived daemon + aria snapshot + ref reference" architecture effectively saves tokens. This project ports that approach to the Selenium ecosystem.

### 1.2 Goals

Build a `se-cli` command-line tool that provides:
- Short-lived CLI process + long-lived daemon process architecture; the daemon holds the WebDriver instance and keeps it alive across calls
- Named session management for parallel multi-browser isolation
- Aria snapshot + ref reference mechanism for token-efficient element location
- Code generation replay: each action emits the corresponding Selenium code
- General AI agent friendly (not bound to a specific agent; SKILL.md can be placed manually)

## 2. Project Structure

```
d:\code\opensource\se-cli\
├── src/
│   ├── cli.ts                  # Entry point (compiled to dist/cli.js)
│   ├── program.ts              # Command dispatch, argument parsing
│   ├── session.ts              # Daemon startup + socket RPC client
│   ├── registry.ts             # .session file registry
│   ├── output.ts               # TextOutput / JsonOutput / RawOutput
│   ├── protocol.ts             # Message type definitions
│   ├── config.ts               # Default configuration
│   ├── daemon/
│   │   ├── server.ts           # Daemon socket server
│   │   ├── backend.ts          # Tool dispatch (callTool)
│   │   └── tools/
│   │       ├── open.ts
│   │       ├── snapshot.ts
│   │       ├── click.ts
│   │       └── ...
│   └── snapshot/
│       └── aria-snapshot.ts    # Injected script
├── skill/
│   ├── SKILL.md
│   └── references/
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
├── tsconfig.json
└── README.md
```

### Key Dependencies

- `selenium-webdriver`: official Node bindings
- `selenium-manager`: driver binary management (bundled with selenium-webdriver)
- TypeScript + Vitest

### Configuration Directories

- Registry: `<system cache>/ms-se-cli/daemon/<workspaceHash>/<name>.session`
- Output directory: `.se-cli/` (snapshot files, screenshots)

## 3. Command Set (MVP)

### 3.1 Session-level Commands (handled in the CLI process)

```bash
se-cli open [url]              # Start daemon + browser
se-cli close                   # Close browser + daemon
se-cli list                    # List all sessions
se-cli close-all               # Close all sessions
se-cli kill-all                # Force-kill all processes
se-cli -s=<name> <cmd>         # Named session
```

### 3.2 Tool Commands (forwarded to the daemon)

**Navigation**: `goto <url>` / `go-back` / `go-forward` / `reload`

**Interaction**: `click <ref|selector>` / `fill <ref|selector> <text>` / `type <text>` / `press <key>` / `select <ref> <value>` / `check <ref>` / `uncheck <ref>`

**Snapshot & Search**: `snapshot` / `snapshot <ref>` / `snapshot --depth=N` / `find <text>` / `find --regex <pattern>`

**Save & Execute**: `screenshot [ref]` / `screenshot --filename=f` / `eval "<js>"` / `eval "<js>" <ref>` / `title` / `url`

22 commands in total.

### 3.3 Global Flags

```bash
se-cli --raw <cmd>             # Output only the value
se-cli --json <cmd>            # Structured JSON output
se-cli -s=<name> <cmd>         # Specify session
se-cli open --browser=chrome   # chrome (default) | edge | firefox
se-cli open --headed           # Default is headless
se-cli open --cdp=<url>        # Attach to a running Chrome
```

## 4. Process Architecture & Communication Protocol

### 4.1 Process Model

```
┌─────────────────┐  Unix socket / Win named pipe      ┌──────────────────────┐
│  se-cli   │ ───────── line-delimited JSON ───▶ │  se-cli daemon │
│  (short-lived   │ ◀──────── single response, close ── │  (holds WebDriver)   │
│   Node process) │                                    └──────────────────────┘
        │                                                          │
        │ spawn(detached:true) on first open ────────────────────▶│
        │                                                          │ W3C WebDriver HTTP
        │                                                          │ ─────────────────▶ ChromeDriver
        │                                                          │                          │
        │                                                          │                          ▼
        │                                                          │                       Browser
        ▼                                                          ▼
┌─────────────────┐                                       ┌──────────────────────┐
│  .session file  │                                       │  aria snapshot inject │
└─────────────────┘                                       └──────────────────────┘
```

### 4.2 Socket Path

- **Linux/macOS**: `$TMPDIR/se-cli/<userHash>/<workspaceHash>-<sessionName>.sock`
- **Windows**: `\\.\pipe\se-cli-<userHash>-<workspaceHash>-<sessionName>`
- `userHash = sha1(USERNAME||USER||"default").slice(0,8)`
- `workspaceHash = sha1(workspaceDir).slice(0,16)`

### 4.3 Message Protocol (line-delimited JSON)

**CLI → daemon**:
```typescript
interface ClientMessage {
  method: 'run' | 'stop' | 'ping';
  params: {
    args: string[];
    cwd: string;
    raw?: boolean;
    json?: boolean;
  };
}
```

**daemon → CLI**:
```typescript
interface ServerMessage {
  ok: boolean;
  text?: string;
  raw?: string;
  json?: SerializedResponse;
  error?: string;
  code?: string;  // ELEMENT_NOT_FOUND | DAEMON_DEAD | VERSION_MISMATCH
}
```

The CLI connects, sends one message, receives one response, then immediately closes the connection. On the daemon side, `net.createServer` handles one request per connection.

### 4.4 Daemon Startup Handshake

1. CLI runs `spawn(process.execPath, [dist/daemon/server.js, sessionName, socketPath, ...flags], { detached: true, stdio: ['ignore','pipe','pipe'] })`
2. Listens on daemon stdout, waits for the line `"Daemon listening on <socketPath>"`
3. Calls `child.unref()` to detach the daemon from the parent process
4. Daemon writes the `<name>.session` JSON file to disk

### 4.5 Response Serialization

Default output has 4 sections:
```
### Page
- Page URL: https://example.com/
- Page Title: Example Domain

### Snapshot
- e1 [heading "Welcome"]
- e2 [link "Learn more"]

### Ran Selenium code
await driver.findElement(By.css('[data-se-ref="e2"]')).click();

### Result
clicked
```

- `--raw` mode outputs only the Result value
- `--json` outputs a `{page, snapshot, code, result}` object

## 5. Aria Snapshot Injection Script (Core Challenge)

### 5.1 Algorithm Overview

Inject JS into the page, recursively walk the DOM, generate a simplified accessibility tree YAML per the W3C ARIA spec, and assign `data-se-ref="eN"` attributes to interactive elements.

### 5.2 Output Format

```yaml
- document:
  - heading "Welcome to Example" [level=1]
  - link "Learn more" [ref=e1]
  - textbox "Search" [ref=e2]
  - button "Submit" [ref=e3]
  - navigation:
    - link "Home" [ref=e4]
```

### 5.3 Role Determination Priority

```
a. Explicit role attribute: <div role="button">
b. ARIA implicit role: <button>→button, <a>→link, <input type=checkbox>→checkbox...
c. Fall back to tagName when no role: <nav>→navigation, <main>→main, <header>→banner
```

### 5.4 Interactive Element Detection (assign ref)

```javascript
const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea',
  'summary', 'details', 'option', 'optgroup'
]);
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'checkbox', 'radio', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'tab', 'combobox',
  'option', 'searchbox', 'spinbutton', 'slider', 'switch'
]);
```

### 5.5 Text & Label Extraction Priority

`aria-label > aria-labelledby > <label for> > alt/title > textContent > placeholder`

Text is truncated to 80 characters to prevent token bloat.

### 5.6 Ref Resolution

```typescript
async function resolveTarget(driver: WebDriver, target: string) {
  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    return By.css(`[data-se-ref="${target}"]`);
  }
  return By.css(target);
}
```

### 5.7 Key Constraints

1. **Refs are valid only within a single snapshot**: after DOM rebuild, `data-se-ref` is lost; you must snapshot again
2. **iframe handling (MVP simplification)**: do not recurse into iframes; output `- iframe: <url>` placeholder
3. **Shadow DOM (MVP simplification)**: do not recurse into open shadow roots; output placeholder
4. **Token control**: long text truncated to 80 chars; `--depth=N` limits depth (default 50); `find` command greps instead of dumping everything
5. **Performance**: `getComputedStyle` is called only for suspected hidden elements

### 5.8 Code Generation Replay

Each interaction tool hard-codes `response.addCode(...)` when executing the action:
```typescript
response.addCode(`await driver.findElement(By.css('[data-se-ref="e15"]')).click();`);
```

### 5.9 Acknowledged Gap vs playwright-cli

| Aspect | playwright-cli | se-cli MVP |
|------|---------------|-----------------|
| Aria algorithm | Built-in mature implementation | Self-written simplified version, ~70-80% coverage |
| Ref engine | Built-in `aria-ref` selector engine | `data-se-ref` attribute + CSS selector |
| Snapshot stability | High | Medium (needs iteration on real sites) |
| iframe/shadow | Full support | MVP placeholder |

## 6. Error Handling

### 6.1 Error Classification

| Error Type | Example | Handling |
|---------|------|------|
| Startup failure | driver binary not installed, port in use | daemon exits immediately, CLI suggests `se-cli install-browser` |
| Communication failure | socket connect timeout, daemon crash | CLI cleans up orphan `.session` files, suggests `open` |
| WebDriver error | NoSuchElementError, TimeoutError, StaleElementReferenceError | Returns `{ok:false, error, code}`, CLI shows friendly message |
| Injection script error | CSP blocks, Shadow DOM boundary | Returns partial snapshot + warning |
| Version mismatch | CLI 0.2 calling daemon 0.1 | Handshake exchanges versions, suggests `close && open` |

### 6.2 Error Output Format

```
### Error
Element not found: [data-se-ref="e15"]
Hint: run `se-cli snapshot` to refresh refs.
```

### 6.3 Daemon Robustness

- `selfDestructOnIdle`: self-destruct after 30 minutes with no requests (configurable)
- `heartbeat`: driver periodically calls `getTitle()` for liveness check
- `gracefulShutdown`: SIGTERM/SIGINT → quit driver → delete `.session` → exit

## 7. Test Strategy & Implementation Path

### 7.1 Test Pyramid

- **Unit tests (Vitest)**: parseCommand, aria snapshot script, Response serialization, registry
- **Integration tests**: daemon + real driver + test pages
- **E2E tests**: use se-cli to test itself (dogfooding)

### 7.2 Implementation Path (6 steps)

**Step 1: Skeleton & Protocol** — project scaffold, protocol.ts, daemon/server.ts, session.ts, registry.ts, cli.ts. Verify: `open` starts the daemon, `list` shows the session, `close` cleans up.

**Step 2: Command Dispatch & Minimal Command Set** — program.ts, output.ts, backend.ts, commands `goto/title/url/close`. Verify: `open https://example.com && title` outputs "Example Domain".

**Step 3: Aria Snapshot Injection Script** — snapshot/aria-snapshot.ts, daemon/tools/snapshot.ts, find.ts. Verify: snapshot on todomvc, YAML contains `- textbox` `- button`.

**Step 4: Interaction Commands** — click/fill/type/press/select/check/uncheck + resolveTarget + code generation replay. Verify: todomvc full flow add todo → check → clear.

**Step 5: Save & Execute** — screenshot, eval, go-back/forward/reload. Verify: screenshot generates a PNG, eval returns the correct value.

**Step 6: Session Management Polish** — `-s=<name>`, list, close-all, kill-all, --browser, --headed, --cdp. Verify: parallel multi-session, CDP attach.

### 7.3 Acceptance Criteria

```bash
se-cli open https://demo.playwright.dev/todomvc/
se-cli snapshot
# Output contains - textbox [ref=e1] - button "Add" [ref=e2]

se-cli fill e1 "Buy groceries"
se-cli click e2
se-cli snapshot
# Output contains - listitem "Buy groceries" [ref=e3]

se-cli --raw eval "document.querySelectorAll('.todo-list li').length"
# Output: 1

se-cli screenshot --filename=todo.png
se-cli close
```

Each interaction command outputs the corresponding Selenium code:
```
### Ran Selenium code
await driver.findElement(By.css('[data-se-ref="e2"]')).click();
```

## 8. Roadmap (v0.4+)

Based on competitive analysis with Playwright CLI and Selenium WebDriver BiDi.
Features are classified as **Must-Have** (基础底座), **Core** (差异化), or **Marginal** (边际).

**Guiding principles (revised 2026-07-29)**:
1. Selenium-native strengths (wait/retry/timeout, Grid, custom browsers, real Safari, Edge IE mode) are prioritized as the defensive moat — Playwright will never match these.
2. Playwright-CLI features that are easy to port (auto-wait, retry-assertion, device emulation) are ranked by `complexity × importance` and front-loaded when high value.
3. CLI has no "code writing" — every Selenium capability that requires code (explicit waits, `ExpectedConditions`, Actions chains, `setScriptTimeout`) MUST be exposed via a 4-tier priority: **flag > ENV > config file > built-in default**.
4. Explicit "will never implement" boundary to avoid misplaced community expectations.

### v0.1: MVP Architecture ✅

- [x] CLI + Daemon process architecture (short-lived CLI via socket to long-lived daemon)
- [x] Basic commands: open, close, goto, click, fill, type, press, snapshot, screenshot, eval
- [x] Aria snapshot injection + ref reference mechanism
- [x] Named session management, multi-browser support (Chrome/Edge/Firefox)
- [x] Code generation replay

### v0.2: Practical Capability Completion ✅

- [x] **Storage management**: `cookie-list/get/set/delete`, `localstorage-*`, `sessionstorage-*`
- [x] **State save/load**: export cookies + storage to JSON, restore by loading in reverse
- [x] **Tab management**: `tab-list`, `tab-new`, `tab-close`, `tab-select`
- [x] **install --skills**: copy SKILL.md to `.claude/skills/se-cli/` or `.agents/skills/se-cli/`
- [x] **--profile=<path>**: persistent user data directory
- [x] **--persistent**: auto-assign userDataDir

### v0.3: iframe & Shadow DOM ✅

- [x] **iframe recursive snapshot**: cross-frame refs (e.g. `f3e15`)
- [x] **Shadow DOM recursion**: recursively traverse `el.shadowRoot` for open shadow roots
- [x] **find command enhancement**: support cross-frame and shadow DOM search

### v0.4: Wait & Retry Configuration Layer ✅

All subsequent commands depend on this layer. Surfaces Selenium's implicit/explicit wait,
pageLoad/script timeout, and `ExpectedConditions` as CLI-native configuration.

**Configuration priority (4 tiers, high → low)**: `--flag` > `ENV` > `.se-cli.json` > built-in default

**Flag layer (per-command override)**:
- `--timeout=<ms>` — per-command explicit-wait timeout (default 5000)
- `--wait=<state>` — wait condition: `visible|hidden|enabled|disabled|stable|attached|none|auto` (default `auto`: click/fill → `visible+enabled`, snapshot/eval → `none`)
- `--retry=<n>` — failure retry count (default 0; `-1` = until timeout)
- `--retry-interval=<ms>` — polling interval (default 100)
- `--implicit-wait=<ms>` — driver implicit wait (default 0, discouraged but compatible)
- `--page-load-timeout=<ms>` — `driver.manage().timeouts().pageLoadTimeout()`
- `--script-timeout=<ms>` — `setScriptTimeout` (affects async `eval`)
- `--no-wait` — shorthand for `--wait=none --timeout=0` (precise-timing scenarios)

**ENV layer**: `SE_CLI_TIMEOUT` / `SE_CLI_WAIT` / `SE_CLI_RETRY` / `SE_CLI_RETRY_INTERVAL` / `SE_CLI_IMPLICIT_WAIT` / `SE_CLI_PAGE_LOAD_TIMEOUT` / `SE_CLI_SCRIPT_TIMEOUT`

**Config file layer** (`.se-cli.json` or `~/.config/se-cli/config.json`):
```json
{
  "wait": { "timeout": 5000, "state": "auto", "retry": 0, "retryInterval": 100 },
  "timeouts": { "implicit": 0, "pageLoad": 30000, "script": 30000 },
  "perCommand": {
    "click":    { "wait": "visible+enabled" },
    "fill":     { "wait": "visible+enabled" },
    "snapshot": { "wait": "none" },
    "eval":     { "wait": "none", "scriptTimeout": 30000 }
  }
}
```

**New commands**:
- [x] `config get <key>` / `config set <key> <value>` / `config list` (list shows source per item: flag/env/file/default)
- [x] `config init` — generate template config file

**Code generation**: emitted code reflects the effective strategy
```js
await driver.wait(until.elementIsVisible(el), 5000);
await driver.wait(until.elementIsEnabled(el), 5000);
```

**Implementation status (v0.4)**:
- [x] 4-tier configuration resolver (`src/wait-config.ts`)
- [x] Flag layer: `--timeout`, `--wait`, `--retry`, `--retry-interval`, `--implicit-wait`, `--page-load-timeout`, `--script-timeout`, `--no-wait`
- [x] ENV layer: `SE_CLI_TIMEOUT` / `SE_CLI_WAIT` / `SE_CLI_RETRY` / `SE_CLI_RETRY_INTERVAL` / `SE_CLI_IMPLICIT_WAIT` / `SE_CLI_PAGE_LOAD_TIMEOUT` / `SE_CLI_SCRIPT_TIMEOUT`
- [x] Config file layer: `.se-cli.json` and `~/.config/se-cli/config.json`
- [x] `config get/set/list/init` commands
- [x] Wait-aware code generation for interactive tools (click, fill, check, uncheck, select)
- [x] Retry logic with configurable count and interval
- [x] Auto state resolution (interactive commands → visible, read-only commands → none)
- [x] Unit tests (`tests/unit/wait-config.test.ts`)
- [x] Integration tests (`tests/integration/fixtures/wait.html`)

### v0.5: Interaction Completion ✅

Close the gap on basic interaction capabilities missing vs Playwright CLI and Selenium.
All Actions commands automatically consume the v0.4 wait/retry configuration.

- [x] **hover <ref>**: mouse hover via `driver.actions().move()`
- [x] **dblclick <ref>**: double-click via `driver.actions().doubleClick()`
- [x] **drag <start> <end>**: drag and drop via `driver.actions().dragAndDrop()`
- [x] **dialog-accept [text]**: handle alert/confirm/prompt via `driver.switchTo().alert()`
- [x] **dialog-dismiss**: dismiss dialog
- [x] **upload <ref> <file>**: file upload via `driver.findElement().sendKeys(path)`
- [x] **resize <w> <h>**: viewport control via `driver.manage().window().setRect()`
- [x] **keydown / keyup <key>**: fine-grained keyboard control via Actions chain
- [x] **mousemove <x> <y>**: mouse position control
- [x] **mousedown / mouseup [button]**: mouse button control
- [x] **mousewheel <dx> <dy>**: scroll wheel control
- [x] **actions-chain <json>**: combine multiple actions into a single `driver.actions().move().down().up().perform()` to reduce round-trips

**Implementation status (v0.5)**:
- [x] `hover`, `dblclick`, `drag` tools (`src/daemon/tools/interactions.ts`)
- [x] `dialog-accept`, `dialog-dismiss` tools (`src/daemon/tools/dialog.ts`)
- [x] `upload <ref> <file>` tool via `element.sendKeys(absolutePath)` (`src/daemon/tools/upload.ts`)
- [x] `resize <w> <h>` tool via `driver.manage().window().setRect()` (`src/daemon/tools/resize.ts`)
- [x] Fine-grained keyboard control: `keydown`, `keyup` (`src/daemon/tools/advanced-input.ts`)
- [x] Fine-grained mouse control: `mousemove`, `mousedown`, `mouseup`, `mousewheel` (`src/daemon/tools/advanced-input.ts`)
- [x] `actions-chain <json>` for batched `perform()` to reduce round-trips (`src/daemon/tools/advanced-input.ts`)
- [x] All Actions commands consume v0.4 wait/retry configuration
- [x] Code generation for all new interaction tools
- [x] Unit tests for each tool
- [x] Integration tests (`tests/integration/fixtures/interactions.html`)

### v0.6: Web-First Assertions (Core, Playwright port: medium complexity × high importance)

Playwright's `expect(locator).toBeVisible()` retry-until-timeout assertion is the key to CI-friendly tests.
CLI form with exit codes:

```
se-cli expect <ref|sel> visible   [--timeout=5000] [--not]
se-cli expect <ref>     hidden
se-cli expect <ref>     enabled | disabled
se-cli expect <ref>     checked | unchecked
se-cli expect <ref>     text "expected"  [--exact]
se-cli expect <ref>     value "expected"
se-cli expect <ref>     count N
se-cli expect <ref>     attribute <name> <value>
se-cli expect title "..."  |  expect url "..."
```

- [ ] Exit codes: success 0, failure 1 (CI/scripts can chain with `&&`)
- [ ] Default to v0.4 `--timeout`; assertion internals use `driver.wait(until.condition, timeout)`
- [ ] Code generation: `await driver.wait(ExpectedConditions.textToBe(locator, "expected"), 5000);`
- [ ] `--not` flag inverts the assertion

### v0.7: Network & Debugging (Core)

Leverage Selenium BiDi protocol (available in selenium-webdriver@4.46.0) for network
interception, console log capture, and request monitoring. BiDi works on Chrome/Edge/Firefox.
CDP used as Chromium-only enhancement.

- [ ] **route <pattern> --status= / --body= / --headers=**: network interception via BiDi `Network.addIntercept`
- [ ] **route-list**: list active route rules
- [ ] **unroute [id]**: remove route rule
- [ ] **console [level]**: capture browser console messages via `driver.script().addConsoleMessageHandler()`
- [ ] **requests**: list network requests via BiDi `beforeRequestSent`/`responseCompleted` events
- [ ] **request <index>**: show request details
- [ ] **js-error**: capture JavaScript errors via `driver.script().addJavaScriptErrorHandler()`
- [ ] **highlight <ref> [--style=]**: persistent element highlighting via CSS overlay injection
- [ ] **highlight --hide**: remove highlights

### v0.8: Device & Environment Emulation (Core, Playwright port: low complexity × medium importance)

All capabilities via CDP `Emulation.*` / `Network.*` domains, BiDi as fallback.
Selenium has no native equivalent, but CDP makes this trivial to port.

- [ ] `open --geolocation=lat,lng --timezone=America/Los_Angeles --locale=zh-CN --color-scheme=dark --viewport=WxH --user-agent="..." --permissions=geolocation,notifications`
- [ ] `device "iPhone 13"` — apply preset (UA + viewport + touch + deviceScaleFactor)
- [ ] `device-list` — list built-in device profiles (reference Playwright DeviceDescriptors)
- [ ] `emulate --offline` — go offline
- [ ] `emulate --throttle-network=slow3g` — `slow3g|fast3g|custom:--download=,--upload=,--latency=`
- [ ] `emulate --throttle-cpu=4` — CPU slowdown rate
- [ ] `emulate --reset` — restore all emulation
- [ ] Emulation state integrated into `state-save` (persist emulate configuration)

### v0.9: MCP Server & AI Ecosystem (Must-Have)

Expose se-cli as an MCP Server for AI agent integration. Playwright already provides
`@playwright/mcp`; se-cli must follow to stay competitive. Dual-track strategy:
CLI+SKILLS (token-efficient for coding agents) and MCP Server (persistent state for
autonomous workflows). Both share the same underlying tool implementation.

- [ ] **se-cli mcp**: start MCP Server using `@modelcontextprotocol/sdk`
- [ ] **MCP tool exposure**: all CLI tools wrapped as `registerTool` calls
- [ ] **stdio transport** (default): local agent communication
- [ ] **Streamable HTTP transport** (optional): remote agent communication
- [ ] **run-code "async driver => ..."**: execute arbitrary Selenium code snippets
- [ ] **generate-locator <ref>**: generate best locator expression (By.role/By.css)
- [ ] **Role-based locator code generation**: enhance codegen with `By.role()` output
- [ ] **SKILL.md frontmatter compliance**: add `name`, `description`, `license`, `compatibility` metadata per Agent Skills spec
- [ ] **install --skills enhancement**: multi-target discovery (Claude Code, Cursor, generic)

### v0.10: Remote, Grid & Custom Browsers (Core, Selenium moat)

Extend browser coverage and connection capabilities. This is the area Playwright will
never match — emphasized as a differentiated stronghold rather than a passing "Core" note.

- [ ] **--browser=safari**: real Safari via `safaridriver` (macOS only, no headless/BiDi/CDP)
- [ ] **--endpoint=<url>**: connect to Selenium Grid 4 or remote WebDriver
- [ ] **--browser-binary=<path>**: custom browser binary (360, UC, QQ, Brave, Electron-embedded, QtWebEngine, domestic browsers)
- [ ] **--driver-binary=<path>**: custom driver binary (bypass selenium-manager)
- [ ] **--browser-args="<args>"**: pass-through browser launch arguments
- [ ] **--browser-prefs=<json>**: Chromium prefs injection
- [ ] **--capabilities=<json>**: pass-through arbitrary W3C capabilities (cover all WebDriver protocol endpoints)
- [ ] **Cloud browser integration**: Browserbase, Sauce Labs, BrowserStack
- [ ] **grid status / grid attach / grid distribute --shard=x/y**: Grid management and distributed sharding
- [ ] **pdf --filename=f**: via CDP `Page.printToPDF` (Chromium only)
- [ ] **--browser=edge-ie** (Edge IE mode, recommended path for legacy IE scenarios)
  - msedgedriver + Edge IE mode loads the IE engine
  - Auto-configure Edge IE mode policy (group policy / registry / `--ie-mode-tab`)
  - Platform: Windows Edge Enterprise only
  - Capability matrix:
    - ✅ navigate / interaction / screenshot / cookie / storage / state-save / tabs
    - ✅ basic iframe (`switchTo().frame()`)
    - ✅ partial CDP: console / basic network monitoring (no interception)
    - ⚠️ Actions chain degraded (some actions execute as single steps)
    - ❌ BiDi network interception (route/unroute)
    - ❌ Shadow DOM (IE engine does not support it)
    - ❌ emulate / device / throttle
    - ❌ tracing / video
  - aria snapshot: uses main injection script (Edge shell supports modern JS), but IE-engine-rendered DOM may have role calculation drift; output header annotated `[browser=edge-ie, capabilities=limited]`
  - codegen: disable `By.role()`, keep `By.css()` / `By.xpath()`
  - Startup detects IE mode availability; if unconfigured, returns clear setup guidance (registry / group policy steps)

> **Safari limitations**: safaridriver has no headless mode, no BiDi/CDP support, macOS only.
> Basic navigation/interaction/screenshot/storage commands work; network interception,
> console logs, and BiDi features are unavailable.
>
> **Edge IE mode limitations**: Windows Edge Enterprise only; IE mode must be enabled via
> policy. Network interception, Shadow DOM, emulation, and recording unavailable.

### v0.11: Recording & Visualization (Marginal)

Recording and visualization capabilities for development and debugging workflows.
High implementation complexity but significant differentiation potential.

- [ ] **se-cli record**: recording mode — user actions generate a complete test file
- [ ] **tracing-start / tracing-stop**: operation tracing and storage (simplified; see "Will Never Implement")
- [ ] **video-start / video-stop**: video recording via CDP or ffmpeg frame capture
- [ ] **video-chapter <title>**: mark chapters in recordings
- [ ] **show**: visualization dashboard for multi-session monitoring
- [ ] **show --annotate**: page annotation for design feedback

### v0.12: VSCode Extension (Marginal)

Develop VSCode extension as a separate npm package (`@browsers-cli/se-cli-vscode`).
Depends on se-cli CLI being globally installed.

- [ ] **Task Provider**: register se-cli commands as VSCode custom tasks
- [ ] **Webview**: browser screenshot and aria snapshot preview via postMessage
- [ ] **MCP Server auto-registration**: write `.vscode/mcp.json` on install
- [ ] **attach --extension**: connect to real browser via extension

### Long-term Goals (no version commitment)

- [ ] **Multi-language SDK**: Python/Java client bindings (CLI stays Node)
- [ ] **Simplified Trace Viewer**: GUI playback for recorded traces (aligned with issue #24)
- [ ] **DOM mutation listener**: via BiDi DOM mutation events
- [ ] **Script preload**: BiDi script pinning and preloading
- [ ] **Multi-language SKILL.md**: localized skill files
- [ ] **pytest-selenium / JUnit5 hooks**: test framework integration (attach to test pause points, issue #22)
- [ ] **Appium mobile testing completion**: iOS/Android bidirectional, Appium Grid
- [ ] **Selenium Grid 4 hub/node management CLI**: deploy, autoscale, node health check

### Will Never Implement (explicitly abandoned)

- ❌ **Native aria ref engine**: cannot match the stability of Playwright's `aria-ref` selector engine; will always rely on the `data-se-ref` attribute
- ❌ **Playwright-level full tracing parity**: Selenium BiDi event stream quality is insufficient for timeline + DOM snapshot + network + console + source map integration; only a simplified version is pursued
- ❌ **Real IE 11 (IEDriverServer) support**: IE 11 is EOL; replaced by Edge IE mode (v0.10) to avoid maintaining an ES5 injection script and Windows-only CI. Users who need true IE11 should use legacy Selenium bindings directly.

## 9. Risks & Mitigation

| Risk | Impact | Mitigation |
|------|------|------|
| Aria snapshot coverage insufficient | agent misidentifies elements → high failure rate | iterate the script on common sites (todomvc/login/forms/navigation), target 80% scenario coverage |
| Refs invalid after DOM rebuild | agent skips snapshot and acts directly | enforce workflow: check ref existence before acting; if missing, prompt snapshot |
| BiDi stability (v0.4+) | network handler silently fails | prefer CDP (Chromium only), BiDi as Firefox fallback |
| Daemon orphan processes | resource leak | selfDestructOnIdle + heartbeat + liveness cleanup during list |
| Selenium driver version drift | driver mismatch after browser update | rely on selenium-manager auto-management; on startup failure suggest install-browser |

## 10. References

- playwright-cli source (d:\code\opensource\playwright-cli) — architecture reference
- [Playwright aria snapshot algorithm](https://playwright.dev/docs/aria-snapshots) — algorithm inspiration
- [Selenium 4 WebDriver BiDi](https://www.selenium.dev/documentation/webdriver/bidi/) — foundation for v0.4+ network capabilities
- [W3C ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) — role determination spec

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

**Storage**: `cookie-list` / `cookie-get <name>` / `cookie-set <name> <value>` / `cookie-delete [name]` / `localstorage-get <key>` / `localstorage-set <key> <value>` / `localstorage-delete [key]` / `localstorage-list` / `sessionstorage-get <key>` / `sessionstorage-set <key> <value>` / `sessionstorage-delete [key]` / `sessionstorage-list`

**Tabs**: `tab-list` / `tab-new [url]` / `tab-close` / `tab-select <index>`

**State**: `state-save [--filename=f]` / `state-load [--filename=f]`

35 commands in total.

### 3.3 Global Flags

```bash
se-cli --raw <cmd>             # Output only the value
se-cli --json <cmd>            # Structured JSON output
se-cli -s=<name> <cmd>         # Specify session
se-cli open --browser=chrome   # chrome (default) | edge | firefox
se-cli open --headed           # Default is headless
se-cli open --cdp=<url>        # Attach to a running Chrome
se-cli open --profile=<path>   # Use a persistent browser profile directory
se-cli open --persistent       # Keep browser profile across sessions
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

## 8. Roadmap (v0.2+)

Sorted by priority, delivered incrementally per version.

### v0.2: Practical Capability Completion

- [x] **Storage management**: `cookie-list/get/set/delete/clear`, `localstorage-*`, `sessionstorage-*` (wrapped via `execute_script`)
- [x] **State save/load**: export cookies + storage to JSON, restore by loading in reverse
- [x] **Tab management**: `tab-list`, `tab-new`, `tab-close`, `tab-select` (based on `window_handles` + `switch_to.window`)
- [x] **install --skills**: copy SKILL.md to `.claude/skills/se-cli/` or `.agents/skills/se-cli/`
- [x] **--profile=<path>**: persistent user data directory
- [x] **--persistent**: auto-assign userDataDir

### v0.3: iframe & Shadow DOM

- [ ] **iframe recursive snapshot**: cross-frame refs (e.g. `f3e15`), implemented via `driver.switchTo().frame()`
- [ ] **Shadow DOM recursion**: recursively traverse `el.shadowRoot` for open shadow roots
- [ ] **find command enhancement**: support cross-frame search

### v0.4: Network & Debugging

- [ ] **Network route mock**: based on Selenium 4 BiDi `add_request_handler` / `add_response_handler`, wrap `route <pattern> --status=404` / `route <pattern> --body='...'` / `route-list` / `unroute`
- [ ] **Console logs**: `console [min-level]` collects browser console messages (BiDi logging module)
- [ ] **Requests list**: `requests` lists network requests, `request <index>` shows details
- [ ] **highlight**: `highlight <ref> [--style=...]` persistent highlight, `highlight --hide` to hide

### v0.5: Recording & Replay

- [ ] **run-code**: execute arbitrary Selenium code snippets (`run-code "async driver => ..."`)
- [ ] **Code generation enhancement**: support role-based locators (`By.role('button', {name: 'Submit'})`) for stability
- [ ] **generate-locator <ref>**: generate the best locator expression from a ref
- [ ] **Recording mode**: `se-cli record` enters recording mode; user actions generate a complete test file

### v0.6: Visualization & Advanced Connections

- [ ] **show dashboard**: a separate window showing real-time mirrors of all sessions, click to take over mouse and keyboard (Electron or Playwright-driven UI)
- [ ] **show --annotate**: user draws boxes on the page to annotate; agent receives annotated screenshot + snapshot + notes
- [ ] **attach --extension**: control a real Chrome/Edge via a browser extension
- [ ] **attach to Grid**: `--endpoint=<url>` connect to Selenium Grid 4

### v0.7: Test Integration (Exploratory)

- [ ] **Attach to pytest-selenium pause point**: fork or hook pytest-selenium to expose a "test pause, external takeover of session" mechanism (high difficulty, may be infeasible)
- [ ] **plan/generate/heal workflow**: mimic the playwright-cli test generation workflow, adapted for pytest-selenium
- [ ] **trace viewer**: simplified trace based on BiDi event streams (far from Playwright Trace Viewer parity)

### Long-term Goals (no version commitment)

- [ ] **Multi-language bindings**: Python/Java client SDK (CLI stays Node)
- [ ] **Cloud browser integration**: Browserbase and other SaaS browser backends
- [ ] **MCP compatibility layer**: expose the daemon as an MCP server; CLI and MCP share tool handles (mimicking playwright-cli architecture)
- [ ] **AI agent ecosystem adaptation**: optimize SKILL.md for Claude Code/Cursor/Copilot individually

### Will Never Implement (explicitly abandoned)

- ❌ **Native aria ref engine**: cannot match the stability of Playwright's `aria-ref` selector engine; will always rely on the `data-se-ref` attribute
- ❌ **Full tracing equivalent**: Selenium has no native tracing; BiDi event streams are orders of magnitude worse, no parity pursued

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

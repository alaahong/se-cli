# selenium-cli

> Token-efficient Selenium browser automation CLI for AI agents and humans.

Inspired by [playwright-cli](https://github.com/microsoft/playwright-cli), ported to the Selenium ecosystem.

## Why selenium-cli?

Current Selenium MCP implementations consume too many tokens — large tool schemas loaded on every call, full accessibility tree dumps, and no command-line interface. **selenium-cli** solves this with a CLI + daemon architecture that minimizes token usage while maximizing agent productivity.

### The Problem

| Approach | Token Cost | Why |
|----------|-----------|-----|
| Selenium MCP | High | Tool schemas (~5KB) loaded per call; verbose JSON-RPC envelope |
| Selenium scripts | N/A | Can't be driven by AI agents |
| Raw WebDriver API | N/A | No CLI, no session persistence |

### The Solution

**selenium-cli** uses a short-lived CLI + long-lived daemon architecture:

- **Short-lived CLI**: each `selenium-cli <cmd>` is a stateless process — just sends one JSON line to the daemon, gets one line back, exits. Zero schema overhead.
- **Long-lived daemon**: holds the WebDriver instance across calls. No reconnection cost, no driver restart overhead.
- **Aria snapshot + refs**: page state captured as compact YAML with element refs (`e1`, `e2`). Interact by ref instead of verbose selectors.
- **Code generation**: every action emits the equivalent Selenium code — copy directly into test files.

### Advantages

- **10x fewer tokens** than MCP for typical agent workflows (measured via aria snapshot vs full a11y tree)
- **Multi-browser**: Chrome, Edge, and Firefox support out of the box
- **Session persistence**: daemon survives across CLI invocations — no browser restart per command
- **Named sessions**: run multiple browsers in parallel with `-s=name`
- **Agent-agnostic**: works with any AI agent that can run shell commands (Claude Code, Cursor, Copilot CLI, etc.)
- **Familiar API**: commands mirror playwright-cli for easy migration
- **Code generation**: every action produces runnable Selenium code for test files

## Installation

```bash
npm install -g selenium-cli
```

Or use directly with npx:

```bash
npx selenium-cli open https://example.com
```

### Prerequisites

- Node.js 18+
- One or more browsers installed:
  - Google Chrome
  - Microsoft Edge
  - Mozilla Firefox

`selenium-manager` (bundled with `selenium-webdriver`) automatically downloads the correct driver binary.

## Quick Start

```bash
# Start a session and navigate
selenium-cli open https://example.com

# Take a snapshot to see the page structure
selenium-cli snapshot
# Output:
# - document:
#   - heading "Example Domain" [level=1]
#   - paragraph: "This domain is for use in illustrative examples..."
#   - link "More information..." [ref=e1]

# Interact by ref
selenium-cli click e1

# Get page info
selenium-cli title
selenium-cli url

# Close the session
selenium-cli close
```

## Commands

### Session Management

| Command | Description |
|---------|-------------|
| `open [url]` | Start daemon + browser, optionally navigate to URL |
| `close` | Close browser and daemon |
| `list` | List all sessions |
| `close-all` | Close all sessions gracefully |
| `kill-all` | Force-kill all sessions |

### Navigation

| Command | Description |
|---------|-------------|
| `goto <url>` | Navigate to URL |
| `go-back` | Browser back |
| `go-forward` | Browser forward |
| `reload` | Reload page |

### Interaction

| Command | Description |
|---------|-------------|
| `click <ref\|selector>` | Click element |
| `fill <ref\|selector> <text>` | Clear and fill input |
| `type <text>` | Type into focused element |
| `press <key>` | Press keyboard key (Enter, Tab, Escape, ArrowDown, ...) |
| `select <ref> <value>` | Select dropdown option |
| `check <ref>` | Check checkbox |
| `uncheck <ref>` | Uncheck checkbox |

### Snapshot & Discovery

| Command | Description |
|---------|-------------|
| `snapshot [ref]` | Aria snapshot of page or element subtree |
| `snapshot --depth=N` | Limit snapshot depth |
| `snapshot --filename=f.yml` | Save snapshot to file |
| `find <text>` | Search snapshot for text |
| `find --regex <pattern>` | Search snapshot with regex |

### Save & Execute

| Command | Description |
|---------|-------------|
| `screenshot [ref]` | Take screenshot (full page or element) |
| `screenshot --filename=f.png` | Save screenshot to file |
| `eval "<js>"` | Execute JavaScript, return result |
| `eval "<js>" <ref>` | Execute JavaScript on element |
| `title` | Get page title |
| `url` | Get current URL |

### Flags

| Flag | Description |
|------|-------------|
| `--raw` | Output only the result value (for scripting) |
| `--json` | Structured JSON output |
| `-s=<name>` | Use named session |
| `--browser=chrome\|edge\|firefox` | Browser selection (default: chrome) |
| `--headed` | Show browser window (default: headless) |
| `--cdp=<url>` | Attach to running Chrome via CDP |

## Usage Examples

### Basic Form Submission

```bash
selenium-cli open https://example.com/login
selenium-cli snapshot
# - textbox "Email" [ref=e1]
# - textbox "Password" [ref=e2]
# - button "Sign in" [ref=e3]

selenium-cli fill e1 "user@example.com"
selenium-cli fill e2 "password123"
selenium-cli click e3
selenium-cli snapshot
selenium-cli close
```

### Multi-Session (Parallel Browsers)

```bash
selenium-cli -s=chrome open https://example.com --browser=chrome
selenium-cli -s=firefox open https://example.com --browser=firefox

selenium-cli -s=chrome title
selenium-cli -s=firefox title

selenium-cli -s=chrome close
selenium-cli -s=firefox close
```

### Attach to Running Chrome

```bash
# Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222

# Attach
selenium-cli open --cdp=http://localhost:9222
```

### Scripting with --raw

```bash
# Get title for use in shell scripts
TITLE=$(selenium-cli --raw title)

# Count elements
COUNT=$(selenium-cli --raw eval "document.querySelectorAll('.item').length")
echo "Found $COUNT items"
```

### Code Generation

Every interaction command outputs the equivalent Selenium code:

```
$ selenium-cli click e1

### Ran Selenium code
```js
await driver.findElement(By.css('[data-se-ref="e1"]')).click();
```

Copy this directly into your test files.

## AI Agent Integration

### With Claude Code / Cursor / Copilot CLI

Place `skill/SKILL.md` into your agent's skills directory:

```bash
# For Claude Code
mkdir -p .claude/skills/selenium-cli
cp skill/SKILL.md .claude/skills/selenium-cli/
```

The agent can then use `selenium-cli` commands directly:

```
User: "Check that the login page works"
Agent: I'll navigate to the login page and test it.
  $ selenium-cli open https://app.example.com/login
  $ selenium-cli snapshot
  $ selenium-cli fill e1 "test@example.com"
  $ selenium-cli fill e2 "password"
  $ selenium-cli click e3
  $ selenium-cli snapshot
  The login succeeded — I can see the dashboard.
```

### Why CLI over MCP for agents?

| Aspect | MCP | CLI |
|--------|-----|-----|
| Token cost per call | ~500-1000 (schema) | ~50-100 (command + output) |
| Context pollution | Tool schemas fill context | No schemas in context |
| State persistence | Per-session overhead | Daemon holds state |
| Agent compatibility | MCP-compatible only | Any agent that runs shell |

## Architecture

```
┌─────────────────┐  Unix socket / Win pipe       ┌──────────────────────┐
│  selenium-cli   │ ───── 行分隔 JSON ──────────▶ │  selenium-cli daemon │
│  (短命进程)      │ ◀──── 单条响应后断开 ───────── │  (持有 WebDriver)    │
└─────────────────┘                                └──────────────────────┘
                                                          │
                                                          │ W3C WebDriver HTTP
                                                          ▼
                                                    ┌──────────┐
                                                    │ Browser  │
                                                    │(Chrome/  │
                                                    │ Edge/FF) │
                                                    └──────────┘
```

- **CLI process**: spawned per command, sends one JSON line, receives one response, exits
- **Daemon process**: spawned on first `open`, persists across CLI calls, holds WebDriver
- **Communication**: line-delimited JSON over Unix socket (Linux/macOS) or Windows named pipe
- **Session registry**: `.session` JSON files in `<cache>/ms-selenium-cli/daemon/`

### Aria Snapshot & Refs

The `snapshot` command injects a JavaScript script that:
1. Walks the DOM tree following ARIA roles
2. Generates compact YAML representation
3. Assigns `data-se-ref="eN"` attributes to interactive elements
4. Returns YAML for the agent to read

Refs are valid only within the current snapshot. After navigation or DOM changes, run `snapshot` again.

## Development

```bash
# Clone
git clone https://github.com/alaahong/selenium-cli.git
cd selenium-cli

# Install
npm install

# Build
npx tsc

# Run unit tests
npx vitest run tests/unit/

# Run integration tests (requires browsers installed)
SELENIUM_CLI_E2E=1 SELENIUM_CLI_TEST_CHROME=1 npx vitest run tests/integration/
```

### Project Structure

```
src/
├── cli.ts                  # CLI entry point
├── program.ts              # Command routing
├── session.ts              # Daemon spawn + RPC client
├── registry.ts             # Session file management
├── output.ts               # Output formatting
├── protocol.ts             # Message types
├── minimist.ts             # Argv parser
├── config.ts               # Paths and hashing
├── response.ts             # Response serialization
├── snapshot/
│   └── aria-snapshot.ts    # Injected JS script
└── daemon/
    ├── server.ts           # Daemon socket server
    ├── backend.ts          # Tool dispatcher
    └── tools/              # Tool handlers (17 tools)
```

## Browser Support

| Browser | Headless | Headed | CDP Attach |
|---------|----------|--------|------------|
| Chrome  | ✅       | ✅     | ✅         |
| Edge    | ✅       | ✅     | ✅         |
| Firefox | ✅       | ✅     | ❌         |

## Comparison with playwright-cli

| Feature | playwright-cli | selenium-cli |
|---------|---------------|--------------|
| Aria snapshot | Built-in mature | Self-written ~80% coverage |
| Ref engine | Native `aria-ref` selector | `data-se-ref` attribute |
| iframe support | Full | Placeholder (v0.3) |
| Shadow DOM | Full | Placeholder (v0.3) |
| Test runner attach | Yes (Playwright test) | No (v0.7 exploratory) |
| Tracing | Full | Not planned |
| Multi-browser | Chromium only | Chrome + Edge + Firefox |
| Real Safari | No | Possible via Safari driver |

## Roadmap

- **v0.2**: Storage management, tab management, `install --skills`
- **v0.3**: iframe recursive snapshot, Shadow DOM recursion
- **v0.4**: Network route mock, console logs, highlight
- **v0.5**: Code recording mode, role-based locators
- **v0.6**: Dashboard, browser extension attach
- **v0.7**: Test runner integration (exploratory)

See [docs/spec.md](docs/spec.md) for full roadmap.

## License

Apache-2.0

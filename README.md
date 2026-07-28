<div align="center">
  <img src="site/assets/img/logo.svg" alt="se-cli" width="280" />
</div>

<p align="center">
  Token-efficient Selenium browser automation CLI for AI agents and humans.<br/>
  Inspired by <a href="https://github.com/microsoft/playwright-cli">playwright-cli</a>, ported to the Selenium ecosystem.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/se-cli"><img src="https://img.shields.io/npm/v/se-cli?color=22C55E&label=npm" alt="npm version" /></a>
  <a href="https://github.com/alaahong/selenium-cli/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/alaahong/selenium-cli/ci.yml?branch=main&label=CI&color=22C55E" alt="CI" /></a>
  <a href="https://www.npmjs.com/package/se-cli"><img src="https://img.shields.io/node/v/se-cli?color=22C55E" alt="Node.js" /></a>
  <a href="https://github.com/alaahong/selenium-cli/blob/main/LICENSE"><img src="https://img.shields.io/github/license/alaahong/selenium-cli?color=22C55E" alt="License" /></a>
  <a href="https://github.com/alaahong/selenium-cli"><img src="https://img.shields.io/github/stars/alaahong/selenium-cli?style=social" alt="Stars" /></a>
</p>

---

## Why se-cli?

Current Selenium MCP implementations consume too many tokens — large tool schemas loaded on every call, full accessibility tree dumps, and no command-line interface. **se-cli** solves this with a CLI + daemon architecture that minimizes token usage while maximizing agent productivity.

### The Problem

| Approach | Token Cost | Why |
|----------|-----------|-----|
| Selenium MCP | High | Tool schemas (~5KB) loaded per call; verbose JSON-RPC envelope |
| Selenium scripts | N/A | Can't be driven by AI agents |
| Raw WebDriver API | N/A | No CLI, no session persistence |

### The Solution

**se-cli** uses a short-lived CLI + long-lived daemon architecture:

- **Short-lived CLI**: each `se-cli <cmd>` is a stateless process — just sends one JSON line to the daemon, gets one line back, exits. Zero schema overhead.
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
npm install -g se-cli
```

Or use directly with npx:

```bash
npx se-cli open https://example.com
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
se-cli open https://example.com

# Take a snapshot to see the page structure
se-cli snapshot
# Output:
# - document:
#   - heading "Example Domain" [level=1]
#   - paragraph: "This domain is for use in illustrative examples..."
#   - link "More information..." [ref=e1]

# Interact by ref
se-cli click e1

# Get page info
se-cli title
se-cli url

# Close the session
se-cli close
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
se-cli open https://example.com/login
se-cli snapshot
# - textbox "Email" [ref=e1]
# - textbox "Password" [ref=e2]
# - button "Sign in" [ref=e3]

se-cli fill e1 "user@example.com"
se-cli fill e2 "password123"
se-cli click e3
se-cli snapshot
se-cli close
```

### Multi-Session (Parallel Browsers)

```bash
se-cli -s=chrome open https://example.com --browser=chrome
se-cli -s=firefox open https://example.com --browser=firefox

se-cli -s=chrome title
se-cli -s=firefox title

se-cli -s=chrome close
se-cli -s=firefox close
```

### Attach to Running Chrome

```bash
# Start Chrome with remote debugging
google-chrome --remote-debugging-port=9222

# Attach
se-cli open --cdp=http://localhost:9222
```

### Scripting with --raw

```bash
# Get title for use in shell scripts
TITLE=$(se-cli --raw title)

# Count elements
COUNT=$(se-cli --raw eval "document.querySelectorAll('.item').length")
echo "Found $COUNT items"
```

### Code Generation

Every interaction command outputs the equivalent Selenium code:

```
$ se-cli click e1

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
mkdir -p .claude/skills/se-cli
cp skill/SKILL.md .claude/skills/se-cli/
```

The agent can then use `se-cli` commands directly:

```
User: "Check that the login page works"
Agent: I'll navigate to the login page and test it.
  $ se-cli open https://app.example.com/login
  $ se-cli snapshot
  $ se-cli fill e1 "test@example.com"
  $ se-cli fill e2 "password"
  $ se-cli click e3
  $ se-cli snapshot
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
┌─────────────────┐  Unix socket / Win pipe  ┌──────────────────────┐
│  se-cli         │ ─── line-delimited JSON ─▶ │  se-cli daemon       │
│  (short-lived)  │ ◀── single response ───── │  (holds WebDriver)   │
└─────────────────┘                            └──────────────────────┘
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
- **Session registry**: `.session` JSON files in `<cache>/ms-se-cli/daemon/`

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
SE_CLI_E2E=1 SE_CLI_TEST_CHROME=1 npx vitest run tests/integration/
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

| Feature | playwright-cli | se-cli |
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

[Apache License 2.0](LICENSE) - Copyright 2024 alaahong

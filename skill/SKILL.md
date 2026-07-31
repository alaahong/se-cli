---
name: se-cli
description: Automate browser interactions and test web pages using Selenium.
allowed-tools: Bash(se-cli:*) Bash(npx:*)
---

# Browser Automation with se-cli

## Quick start

```bash
se-cli open
se-cli goto https://example.com
se-cli snapshot
se-cli click e3
se-cli expect e3 visible
se-cli close
```

## Commands

### Core
```bash
se-cli open [url]
se-cli goto <url>
se-cli close
se-cli snapshot [ref] [--depth=N]
se-cli find <text>
se-cli find --regex <pattern>
se-cli click <ref|selector>
se-cli fill <ref|selector> <text>
se-cli type <text>
se-cli press <key>
se-cli select <ref> <value>
se-cli check <ref>
se-cli uncheck <ref>
se-cli screenshot [ref] [--filename=f]
se-cli eval "<js>" [ref]
se-cli title
se-cli url
```

### Navigation
```bash
se-cli go-back
se-cli go-forward
se-cli reload
```

### Advanced Interaction (v0.5)

Mouse and keyboard control via the Selenium Actions API. All commands consume
the v0.4 wait/retry configuration and emit the equivalent Selenium code.

```bash
# Mouse actions
se-cli hover <ref>                    # Mouse hover over element
se-cli dblclick <ref>                 # Double-click element
se-cli drag <start-ref> <end-ref>     # Drag and drop from one element to another
se-cli mousemove <x> <y>             # Move mouse to absolute viewport coordinates
se-cli mousedown [button]            # Press mouse button (left|right|middle, default: left)
se-cli mouseup [button]              # Release mouse button (left|right|middle, default: left)
se-cli mousewheel <dx> <dy>          # Scroll wheel by horizontal/vertical offsets

# Keyboard actions
se-cli keydown <key>                 # Press and hold a key (e.g. Shift, Control)
se-cli keyup <key>                   # Release a held key

# Dialog handling
se-cli dialog-accept [text]          # Accept alert/confirm/prompt; optional text for prompt
se-cli dialog-dismiss                # Dismiss alert/confirm/prompt

# File upload
se-cli upload <ref> <file>           # Send file path to <input type="file"> element

# Viewport control
se-cli resize <width> <height>       # Set browser window size in pixels

# Actions chain — combine multiple actions into one perform() call
se-cli actions-chain <json-array>
```

#### actions-chain

The `actions-chain` command accepts a JSON array of action steps executed in a
single `perform()` call, reducing daemon round-trips. Supported step types:
`move`, `press`, `release`, `keydown`, `keyup`, `click`, `doubleClick`,
`scroll`, `pause`.

```bash
# Drag via manual move + press + release
se-cli actions-chain '[{"type":"move","target":"e1"},{"type":"press"},{"type":"move","x":200,"y":200},{"type":"release"}]'

# Key chord: Ctrl+Shift+A
se-cli actions-chain '[{"type":"keydown","key":"Control"},{"type":"keydown","key":"Shift"},{"type":"keydown","key":"a"},{"type":"keyup","key":"a"},{"type":"keyup","key":"Shift"},{"type":"keyup","key":"Control"}]'

# Click + pause + scroll
se-cli actions-chain '[{"type":"click","target":"e2"},{"type":"pause","duration":500},{"type":"scroll","x":0,"y":300}]'
```

### Web-First Assertions (v0.6)

Playwright-style retry-until-timeout assertions with CI-friendly exit codes
(0 = pass, 1 = fail).

```bash
# Visibility assertions
se-cli expect <ref> visible          # Assert element is visible
se-cli expect <ref> hidden           # Assert element is hidden

# State assertions
se-cli expect <ref> enabled           # Assert element is enabled
se-cli expect <ref> disabled          # Assert element is disabled
se-cli expect <ref> checked           # Assert checkbox is checked
se-cli expect <ref> unchecked         # Assert checkbox is unchecked

# Content assertions
se-cli expect <ref> text "Expected"       # Assert text contains (substring)
se-cli expect <ref> text "Exact" --exact  # Assert exact text match
se-cli expect <ref> value "Expected"       # Assert input value contains
se-cli expect <ref> attribute href "https://example.com"  # Assert attribute

# Count assertion
se-cli expect <selector> count 3    # Assert N matching elements

# Page-level assertions
se-cli expect title "My Page"       # Assert page title
se-cli expect url "example.com"     # Assert URL contains

# Inversion with --not
se-cli expect <ref> visible --not   # Assert element is NOT visible
se-cli expect <ref> text "error" --not  # Assert text does NOT contain "error"

# Timeout for async assertions (default 5000ms)
se-cli expect <ref> visible --timeout=10000  # Wait up to 10s for element to appear
```

Assertion failures exit with code 1 (CI-friendly). Assertion success exits with
code 0.

Assertions poll the condition until it passes or the timeout expires (default
5s). Use `--timeout=0` or `--no-wait` for a single check without polling.

### Storage
```bash
se-cli cookie-list
se-cli cookie-get <name>
se-cli cookie-set <name> <value>
se-cli cookie-delete [name]
se-cli localstorage-get <key>
se-cli localstorage-set <key> <value>
se-cli localstorage-delete [key]
se-cli localstorage-list
se-cli sessionstorage-get <key>
se-cli sessionstorage-set <key> <value>
se-cli sessionstorage-delete [key]
se-cli sessionstorage-list
```

### Tabs
```bash
se-cli tab-list
se-cli tab-new [url]
se-cli tab-close
se-cli tab-select <index>
```

### State
```bash
se-cli state-save [--filename=f.json]
se-cli state-load [--filename=f.json]
```

### Configuration
```bash
se-cli config get <key>
se-cli config set <key> <value>
se-cli config list
se-cli config init
```

### Flags
```bash
se-cli --raw <cmd>              # Output only the value
se-cli --json <cmd>             # Structured JSON output
se-cli -s=<name> <cmd>          # Use named session
se-cli click e1 --timeout=10000      # Per-command explicit-wait timeout
se-cli click e1 --wait=visible        # Wait condition: visible|hidden|enabled|disabled|stable|attached|none|auto
se-cli click e1 --retry=3             # Retry count (-1 = until timeout)
se-cli click e1 --retry-interval=200  # Polling interval
se-cli click e1 --implicit-wait=1000 # Driver implicit wait
se-cli click e1 --page-load-timeout=30000
se-cli eval "js" --script-timeout=30000
se-cli click e1 --no-wait             # Skip waiting (--wait=none --timeout=0)
```

### Sessions
```bash
se-cli -s=<name> <cmd>
se-cli list
se-cli close-all
```

## Snapshots

After each command, se-cli provides an aria snapshot of the page.
Each interactive element has a `[ref=eN]` attribute. Use the ref to interact:
```bash
se-cli snapshot
# Output: - link "Home" [ref=e1]
se-cli click e1
```

Refs are valid only until the page changes. Re-run `snapshot` after navigation or DOM updates.

### iframe Elements

The snapshot recurses into same-origin iframes. Elements inside an iframe get cross-frame refs in the format `f<index>e<ref>`:
```bash
se-cli snapshot
# Output:
# - iframe "Content":
#   - textbox "Name" [ref=f0e1]
#   - button "Submit" [ref=f0e2]

se-cli fill f0e1 "hello"
se-cli click f0e2
```

Cross-origin iframes appear as placeholders and cannot be interacted with.

### Shadow DOM

The snapshot traverses open shadow roots. Elements inside shadow DOM use regular refs (`e1`, `e2`) — se-cli automatically searches shadow roots when resolving refs:
```bash
se-cli snapshot
# Output:
# - textbox "Shadow Input" [ref=e5]
# - button "Shadow Button" [ref=e6]

se-cli fill e5 "test"
se-cli click e6
```

## Example: Form submission

```bash
se-cli open https://example.com/login
se-cli snapshot
se-cli fill e1 "user@example.com"
se-cli fill e2 "password"
se-cli click e3
se-cli snapshot
se-cli close
```

## Example: Save and restore state

```bash
se-cli open https://example.com
se-cli cookie-set auth_token secret123
se-cli localstorage-set theme dark
se-cli state-save --filename=session.json
se-cli close

# Later: restore in a new session
se-cli open
se-cli state-load --filename=session.json
se-cli cookie-get auth_token
```

## Example: Advanced interactions (v0.5)

```bash
# Hover over a menu item to reveal a submenu
se-cli open https://example.com
se-cli snapshot
se-cli hover e3
se-cli snapshot

# Double-click to select a word
se-cli dblclick e5

# Drag an element to a new position
se-cli drag e1 e2

# Handle a JavaScript confirm dialog
se-cli click e4          # triggers window.confirm()
se-cli dialog-accept

# Upload a file
se-cli upload e1 /path/to/document.pdf

# Resize viewport for responsive testing
se-cli resize 375 812    # iPhone 13 viewport

# Fine-grained mouse control
se-cli mousemove 100 200
se-cli mousedown left
se-cli mousemove 300 400
se-cli mouseup left

# Scroll down 500px
se-cli mousewheel 0 500

# Hold Shift and press a key
se-cli keydown Shift
se-cli press a
se-cli keyup Shift

# Chain multiple actions into one round-trip
se-cli actions-chain '[{"type":"move","target":"e1"},{"type":"press"},{"type":"move","x":200,"y":200},{"type":"release"}]'
```

## Wait & Retry Configuration (v0.4)

Control element wait conditions, timeouts, and retry behavior. Configuration is resolved
via a 4-tier priority: **flag > ENV > config file > built-in default**.

```bash
# Wait for element to be visible before clicking
se-cli click e1 --wait=visible --timeout=10000

# Retry failed commands
se-cli click e1 --retry=3 --retry-interval=200

# Skip waiting entirely (precise-timing scenarios)
se-cli click e1 --no-wait

# Configure via environment variables
SE_CLI_TIMEOUT=10000 se-cli click e1
SE_CLI_WAIT=visible se-cli click e1
SE_CLI_RETRY=3 se-cli click e1

# Config file (.se-cli.json or ~/.config/se-cli/config.json)
se-cli config init     # generate template config file
se-cli config list     # show all settings with source per item
se-cli config set wait.timeout 8000
se-cli config get wait.timeout
```

By default, interactive commands (click, fill, check, uncheck, select) wait for elements
to be visible, while read-only commands (snapshot, eval, title) skip waiting. The emitted
Selenium code reflects the effective strategy:

```js
await driver.wait(until.elementIsVisible(el), 5000);
await driver.wait(until.elementIsEnabled(el), 5000);
```

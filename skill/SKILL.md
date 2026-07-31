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

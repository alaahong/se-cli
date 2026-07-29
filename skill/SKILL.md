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

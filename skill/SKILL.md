---
name: selenium-cli
description: Automate browser interactions and test web pages using Selenium.
allowed-tools: Bash(selenium-cli:*) Bash(npx:*)
---

# Browser Automation with selenium-cli

## Quick start

```bash
selenium-cli open
selenium-cli goto https://example.com
selenium-cli snapshot
selenium-cli click e3
selenium-cli close
```

## Commands

### Core
```bash
selenium-cli open [url]
selenium-cli goto <url>
selenium-cli close
selenium-cli snapshot [ref] [--depth=N]
selenium-cli find <text>
selenium-cli find --regex <pattern>
selenium-cli click <ref|selector>
selenium-cli fill <ref|selector> <text>
selenium-cli type <text>
selenium-cli press <key>
selenium-cli select <ref> <value>
selenium-cli check <ref>
selenium-cli uncheck <ref>
selenium-cli screenshot [ref] [--filename=f]
selenium-cli eval "<js>" [ref]
selenium-cli title
selenium-cli url
```

### Navigation
```bash
selenium-cli go-back
selenium-cli go-forward
selenium-cli reload
```

### Sessions
```bash
selenium-cli -s=<name> <cmd>
selenium-cli list
selenium-cli close-all
```

## Snapshots

After each command, selenium-cli provides an aria snapshot of the page.
Each interactive element has a `[ref=eN]` attribute. Use the ref to interact:
```bash
selenium-cli snapshot
# Output: - link "Home" [ref=e1]
selenium-cli click e1
```

Refs are valid only until the page changes. Re-run `snapshot` after navigation or DOM updates.

## Example: Form submission

```bash
selenium-cli open https://example.com/login
selenium-cli snapshot
selenium-cli fill e1 "user@example.com"
selenium-cli fill e2 "password"
selenium-cli click e3
selenium-cli snapshot
selenium-cli close
```

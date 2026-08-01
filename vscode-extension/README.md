# se-cli MCP Server for VS Code

Token-efficient Selenium browser automation for AI agents.

## Overview

This extension registers [se-cli](https://github.com/se-cli/se-cli) as an MCP (Model Context Protocol) server in VS Code. Once enabled, VS Code Copilot and other MCP-aware AI tools can use se-cli's browser automation commands directly — no manual configuration needed.

## Installation

### From VS Code Marketplace

1. Open VS Code Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Search for `@mcp se-cli` or just `se-cli`
3. Click **Install**

### Manual configuration (without extension)

Add to your workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "se-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browsers-cli/se-cli", "mcp-server"]
    }
  }
}
```

Or add to user settings (`settings.json`):

```json
{
  "mcp.servers": {
    "se-cli": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@browsers-cli/se-cli", "mcp-server"]
    }
  }
}
```

## Usage

After installation, the se-cli MCP server provides **40+ browser automation tools** to AI agents:

- **Browser management**: open, close, list sessions
- **Navigation**: goto, go-back, go-forward, reload, title, url
- **Interaction**: click, fill, type, press, select, check, uncheck, hover, dblclick, drag
- **Snapshot & Search**: aria snapshot with element refs, find, screenshot, eval
- **Tab management**: list, new, close, select
- **Storage**: cookies, localStorage, sessionStorage, state save/load
- **Advanced input**: keydown/up, mousemove, mousedown/up, mousewheel, actions-chain
- **Assertions**: expect (visible, hidden, text, value, count, etc.)
- **Network & Debugging**: console logs, network requests, route mocking, element highlighting

### Example: Ask Copilot to automate a browser

```
@se-cli Open Chrome and navigate to https://example.com, take a snapshot, and click the "More information..." link.
```

## Requirements

- Node.js >= 18
- Chrome, Edge, or Firefox installed (for browser automation)

## Documentation

- [Full documentation](https://se-cli.github.io/se-cli/)
- [GitHub repository](https://github.com/se-cli/se-cli)
- [npm package](https://www.npmjs.com/package/@browsers-cli/se-cli)

## License

Apache-2.0

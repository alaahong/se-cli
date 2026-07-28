# selenium-cli

Selenium CLI with token-efficient browser automation for AI agents.

Inspired by [playwright-cli](https://github.com/microsoft/playwright-cli), ported to Selenium ecosystem.

## Why selenium-cli?

Current Selenium MCP implementations consume too many tokens due to large tool schemas and full accessibility tree dumps. selenium-cli uses a CLI + daemon architecture that is token-efficient:

- **Short-lived CLI + long-lived daemon**: each `selenium-cli <cmd>` is a stateless process that talks to a persistent daemon holding the WebDriver instance
- **aria snapshot + ref**: page state is captured as compact YAML with element refs (`e1`, `e2`) instead of verbose DOM dumps
- **Code generation**: each action emits the equivalent Selenium code for test files

## Installation

```bash
npm install -g selenium-cli
selenium-cli --help
```

## Quick start

```bash
selenium-cli open https://example.com
selenium-cli snapshot
selenium-cli click e2
selenium-cli close
```

## Status

**v0.1.0 (MVP)** — see [docs/spec.md](docs/spec.md) for full design.

## License

Apache-2.0

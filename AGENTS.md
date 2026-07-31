# AGENTS.md

Guidelines for AI agents and human contributors working on the se-cli codebase.

## Canonical Repository

- **Organization**: `se-cli`
- **Repository**: `se-cli/se-cli`
- **GitHub URL**: `https://github.com/se-cli/se-cli`
- **GitHub Pages**: `https://se-cli.github.io/se-cli/`
- **npm package**: `@browsers-cli/se-cli`
- **npm URL**: `https://www.npmjs.com/package/@browsers-cli/se-cli`

### URL Reference Rules (CRITICAL)

All GitHub URLs in documentation, source code, configuration, and website content **MUST** point to the organization repository `se-cli/se-cli`. Never use personal or fork usernames (e.g., `alaahong`) in any committed file.

**Correct patterns:**

```
https://github.com/se-cli/se-cli
https://github.com/se-cli/se-cli/issues
https://github.com/se-cli/se-cli/blob/main/docs/spec.md
https://se-cli.github.io/se-cli/
https://www.npmjs.com/package/@browsers-cli/se-cli
```

**Incorrect patterns (NEVER commit these):**

```
https://github.com/alaahong/se-cli          # personal fork
https://alaahong.github.io/se-cli/          # personal GitHub Pages
```

When creating PRs from a fork, ensure the branch is rebased onto `upstream/main` before pushing. This prevents stale fork URLs from leaking into the PR diff. See the [PR Workflow](#pr-workflow) section for details.

## Project Overview

se-cli is a token-efficient Selenium browser automation CLI for AI agents and humans. It uses a short-lived CLI + long-lived daemon architecture: the CLI sends one JSON line per command to a daemon process that holds the WebDriver instance.

- **Language**: TypeScript (Node.js >= 18)
- **Browser automation**: selenium-webdriver
- **Test framework**: Vitest
- **Module system**: CommonJS

## Architecture

```
src/
├── cli.ts              # CLI entry point
├── program.ts          # Command routing
├── session.ts          # Daemon spawn + RPC client (socket communication)
├── registry.ts         # Session file management
├── output.ts           # Output formatting
├── protocol.ts         # Message types
├── minimist.ts         # Argv parser
├── config.ts           # Paths and session config
├── response.ts         # Response serialization
├── snapshot/
│   └── aria-snapshot.ts  # Aria snapshot injection script
└── daemon/
    ├── server.ts       # Daemon socket server (net.createServer)
    ├── backend.ts      # Tool dispatcher
    └── tools/          # One file per tool (click.ts, fill.ts, etc.)
```

### Key Design Decisions

- **Socket communication**: Line-delimited JSON over Unix socket (Linux/macOS) or Windows named pipe. Uses `StringDecoder('utf8')` to correctly handle multi-byte UTF-8 characters split across TCP chunks.
- **Element references**: `data-se-ref` attribute on elements, referenced as `e1`, `e2`, etc. in CLI commands. Cross-frame refs use `f<frameIndex>e<ref>` format (e.g., `f2e5`).
- **Driver management**: `driver` is a module-level variable in `server.ts`. On `DRIVER_ERROR` or `TIMEOUT`, the driver is reset (not cached permanently). `driverInitError` is cleared on each retry.
- **Session config**: `SessionConfig` in `config.ts` supports `persistent` field for `--persistent` flag (syntax sugar for `--profile=<auto-path>`).

## CI/CD

### CI Configuration

- CI config: `.github/workflows/ci.yml`
- **Node.js version**: 22 (required)
- **Test runner**: Vitest with path-based filtering (`npx vitest run tests/unit`), NOT Jest `--filter`
- **Test timeout**: 120000ms (integration tests start browser daemons)
- **Integration tests**: Must use HTTP server (`tests/integration/test-server.ts`), not `file://` protocol
- **Test pages**: Located in `tests/integration/fixtures/`, copied to `site/test-pages/` for GitHub Pages access
- **Upload coverage**: Include `if-no-files-found: ignore` to suppress warnings
- **Flaky test mitigation**: CI retries failed integration tests automatically. Chrome jobs may fail with `0xC0000142` (STATUS_DLL_INIT_FAILED) — re-running typically resolves it.

### Timeouts

| Setting | Value | Location |
|---------|-------|----------|
| `sendAndClose` | 60s | `src/session.ts` |
| `startDaemon` | 120s | `src/session.ts` |
| `testTimeout` | 120000ms | `vitest.config.ts` |

### Release Workflow

**Branch convention**: Every release MUST be conducted on a dedicated `release/v<x.y.z>` branch (e.g., `release/v0.4.0`). Do NOT use `chore/bump-version-*` or `main` directly for releases.

**Release steps**:

1. **Create release branch** from latest `upstream/main`:
   ```bash
   git fetch upstream
   git checkout -b release/v<x.y.z> upstream/main
   ```
2. **Bump version** in `package.json` to `<x.y.z>` on the release branch
3. **Push and create PR** targeting `main`:
   ```bash
   git push origin release/v<x.y.z>
   # Create PR titled: "chore: release v<x.y.z>"
   ```
4. **Wait for CI** — all checks (lint, type check, unit tests, integration tests across Chrome/Edge/Firefox) must pass
5. **Merge the PR** (squash merge) into `main`
6. **Trigger `create-release.yml`** via `workflow_dispatch` with `version: "<x.y.z>"`, or push tag `v<x.y.z>`
7. `create-release.yml` verifies `package.json` version matches, runs quality gates, creates a draft GitHub Release
8. **Publish the Release** on GitHub — this triggers `publish.yml` which publishes to npm as `@browsers-cli/se-cli` with provenance
9. **Register the release** in the [Release Log](#release-log) table below

**CRITICAL**: The `package.json` version on `main` branch must match the release version before triggering `create-release.yml`.

### Release Log

| Version | Release Branch | PR | Release URL | npm | Date |
|---------|---------------|-----|-------------|-----|------|
| 0.1.1 | `release/v0.1.1` | — | [v0.1.1](https://github.com/se-cli/se-cli/releases/tag/v0.1.1) | `@browsers-cli/se-cli@0.1.1` | 2026-07-29 |
| 0.2.0 | `release/v0.2.0` | — | [v0.2.0](https://github.com/se-cli/se-cli/releases/tag/v0.2.0) | `@browsers-cli/se-cli@0.2.0` | 2026-07-29 |
| 0.3.0 | `release/v0.3.0` | — | [v0.3.0](https://github.com/se-cli/se-cli/releases/tag/v0.3.0) | `@browsers-cli/se-cli@0.3.0` | 2026-07-30 |
| 0.4.0 | `release/v0.4.0` | [#62](https://github.com/se-cli/se-cli/pull/62) | [v0.4.0](https://github.com/se-cli/se-cli/releases/tag/v0.4.0) | `@browsers-cli/se-cli@0.4.0` | 2026-07-31 |
| 0.5.0 | `release/v0.5.0` | — | [v0.5.0](https://github.com/se-cli/se-cli/releases/tag/v0.5.0) | `@browsers-cli/se-cli@0.5.0` | 2026-07-31 |

### Dependency Update Workflow

- `dep-update.yml` pushes a branch (e.g., `deps/selenium-webdriver-4.46.0`) and creates an Issue — it does NOT create PRs (GitHub Actions lacks permission)
- Uses `git push --force` and `git checkout -B` to reset existing branches
- Checks for existing open Issues with the same title before creating new ones

## Coding Conventions

### File Organization

- **Tool modules**: One file per functionality in `src/daemon/tools/` (e.g., `storage.ts`, `tab.ts`, `state.ts`)
- **Command routing**: Add new commands via the routing pattern in `program.ts`
- **Test files**: Unit tests in `tests/unit/`, integration tests in `tests/integration/`
- **Test fixtures**: HTML pages in `tests/integration/fixtures/`, mirrored to `site/test-pages/`

### Testing

- **Unit tests**: Use Vitest. Mock external dependencies (WebDriver, filesystem).
- **Integration tests**: Require `SE_CLI_E2E=1` environment variable. Start a daemon, send commands, verify behavior.
- **Test cleanup**: Integration tests must clean up daemon processes. Use 15s timeout with `kill-all` fallback.
- **When adding a new feature**: Add unit tests, integration tests, test pages, and update documentation (`README.md`, `skill/SKILL.md`, `docs/spec.md`, `site/index.html`).

### npm Package

- Published as `@browsers-cli/se-cli` with provenance enabled
- **npm URL**: `https://www.npmjs.com/package/@browsers-cli/se-cli`
- Install: `npm install -g @browsers-cli/se-cli`
- `package.json` `files` array must include `skill/` directory (ensures `SKILL.md` is available after npm install)
- Binary names: `se-cli`, `se`, `selenium-cli` (all point to `dist/cli.js`)

## PR Workflow

### Fork-based PRs

When contributing from a fork:

1. **Always rebase onto `upstream/main`** before pushing your branch:
   ```bash
   git fetch upstream
   git rebase --onto upstream/main <old-base-commit> <your-branch>
   ```
2. **Verify no fork URLs in diff** before pushing:
   ```bash
   git diff upstream/main..HEAD | grep -i "alaahong\|<your-fork-name>"
   # This should return nothing
   ```
3. **Force push** after rebasing:
   ```bash
   git push origin <your-branch> --force
   ```

### Commit Messages

Follow conventional commits:

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `refactor:` code change that neither fixes a bug nor adds a feature
- `test:` adding or correcting tests
- `ci:` CI configuration changes
- `chore:` maintenance tasks

### Before Submitting

- Run `npx tsc --noEmit` (type check)
- Run `npx vitest run tests/unit` (unit tests)
- Ensure no personal fork URLs in any changed file
- Ensure `package.json` version is not accidentally changed (unless intentional)

## Lessons Learned

- **Jest vs Vitest**: Using Jest-specific options (like `--filter`) with Vitest causes CACError failures. Always use Vitest's path-based filtering.
- **execFileSync deadlock**: `execFileSync` blocks the event loop, causing deadlocks in daemon scenarios. Use asynchronous `execFile` (promisified) instead.
- **Firefox session files**: Firefox CI jobs must not delete session files during `shutdown()` to prevent race conditions with new daemon sessions.
- **Firefox cookies**: Firefox requires `secure=true` for `SameSite=None` cookies during state load.
- **Chrome CI DLL errors**: Windows Chrome CI jobs may fail with `0xC0000142` (STATUS_DLL_INIT_FAILED) due to chromedriver DLL initialization. Re-running the job typically resolves it.
- **koa-connect wrapper**: Caused `ctx` leaks. Use native Koa middleware instead of wrapping Express middleware.
- **dep-update.yml**: Pushing to an existing remote branch causes non-fast-forward errors. Use `git push --force` and `git checkout -B`. Check for existing open Issues before creating new ones.

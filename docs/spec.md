# selenium-cli 设计规格

**版本**: v0.1.0 (MVP)
**日期**: 2026-07-28
**状态**: 已通过 brainstorming，待实现

## 1. 背景与目标

### 1.1 背景

当前 Selenium MCP 实现 token 消耗过大，主要原因：
- 工具 schema 体积大，每次调用都加载
- accessibility tree 全量返回页面数据
- 无命令行接口，agent 必须通过 MCP 协议交互

Microsoft 的 playwright-cli 已验证"短命 CLI + 长寿命 daemon + aria snapshot + ref 引用"架构能有效节约 token。本项目将该思路移植到 Selenium 生态。

### 1.2 目标

构建 `selenium-cli` 命令行工具，提供：
- 短命 CLI 进程 + 长寿命 daemon 进程架构，daemon 持有 WebDriver 实例跨调用保活
- 命名会话管理，多浏览器并行隔离
- aria snapshot + ref 引用机制，token 高效的元素定位
- 代码生成回放，每次操作输出对应 Selenium 代码
- 通用 AI agent 友好（不绑定特定 agent，可手动放置 SKILL.md）

## 2. 项目结构

```
d:\code\opensource\selenium-cli\
├── src/
│   ├── cli.ts                  # 入口（编译为 dist/cli.js）
│   ├── program.ts              # 命令分发、参数解析
│   ├── session.ts              # daemon 启动 + socket RPC client
│   ├── registry.ts             # .session 文件注册表
│   ├── output.ts               # TextOutput / JsonOutput / RawOutput
│   ├── protocol.ts             # 消息类型定义
│   ├── config.ts               # 默认配置
│   ├── daemon/
│   │   ├── server.ts           # daemon socket server
│   │   ├── backend.ts          # tool 调度（callTool）
│   │   └── tools/
│   │       ├── open.ts
│   │       ├── snapshot.ts
│   │       ├── click.ts
│   │       └── ...
│   └── snapshot/
│       └── aria-snapshot.ts    # 注入脚本
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

### 关键依赖

- `selenium-webdriver`：官方 Node 绑定
- `selenium-manager`：driver 二进制管理（随 selenium-webdriver 自带）
- TypeScript + Vitest

### 配置目录

- 注册表: `<系统缓存>/ms-selenium-cli/daemon/<workspaceHash>/<name>.session`
- 输出目录: `.selenium-cli/`（snapshot 文件、screenshot）

## 3. 命令集（MVP）

### 3.1 会话级命令（CLI 进程内处理）

```bash
selenium-cli open [url]              # 启动 daemon + 浏览器
selenium-cli close                   # 关闭浏览器+daemon
selenium-cli list                    # 列出所有会话
selenium-cli close-all               # 关闭所有会话
selenium-cli kill-all                # 强杀所有进程
selenium-cli -s=<name> <cmd>         # 命名会话
```

### 3.2 工具命令（转发给 daemon）

**导航**：`goto <url>` / `go-back` / `go-forward` / `reload`

**交互**：`click <ref|selector>` / `fill <ref|selector> <text>` / `type <text>` / `press <key>` / `select <ref> <value>` / `check <ref>` / `uncheck <ref>`

**快照与查找**：`snapshot` / `snapshot <ref>` / `snapshot --depth=N` / `find <text>` / `find --regex <pattern>`

**保存与执行**：`screenshot [ref]` / `screenshot --filename=f` / `eval "<js>"` / `eval "<js>" <ref>` / `title` / `url`

共 22 个命令。

### 3.3 全局 flags

```bash
selenium-cli --raw <cmd>             # 只输出值
selenium-cli --json <cmd>            # JSON 结构化输出
selenium-cli -s=<name> <cmd>         # 指定会话
selenium-cli open --browser=chrome   # chrome(默认) | edge | firefox
selenium-cli open --headed           # 默认 headless
selenium-cli open --cdp=<url>        # attach 到运行中的 Chrome
```

## 4. 进程架构与通信协议

### 4.1 进程模型

```
┌─────────────────┐  Unix socket / Win named pipe      ┌──────────────────────┐
│  selenium-cli   │ ───────── 行分隔 JSON ───────────▶ │  selenium-cli daemon │
│  (短命 Node 进程)│ ◀──────── 单条响应后断开 ────────── │  (持有 WebDriver)    │
└─────────────────┘                                       └──────────────────────┘
        │                                                          │
        │ 首次 open 时 spawn(detached:true) ──────────────────────▶│
        │                                                          │ W3C WebDriver HTTP
        │                                                          │ ─────────────────▶ ChromeDriver
        │                                                          │                          │
        │                                                          │                          ▼
        │                                                          │                       Browser
        ▼                                                          ▼
┌─────────────────┐                                       ┌──────────────────────┐
│  .session 文件   │                                       │  aria snapshot 注入   │
└─────────────────┘                                       └──────────────────────┘
```

### 4.2 socket 路径

- **Linux/macOS**: `$TMPDIR/selenium-cli/<userHash>/<workspaceHash>-<sessionName>.sock`
- **Windows**: `\\.\pipe\selenium-cli-<userHash>-<workspaceHash>-<sessionName>`
- `userHash = sha1(USERNAME||USER||"default").slice(0,8)`
- `workspaceHash = sha1(workspaceDir).slice(0,16)`

### 4.3 消息协议（行分隔 JSON）

**CLI → daemon**：
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

**daemon → CLI**：
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

CLI 连接后发一条消息，收一条响应，立即关连接。daemon 端 `net.createServer` 每连接处理一次请求。

### 4.4 daemon 启动握手

1. CLI `spawn(process.execPath, [dist/daemon/server.js, sessionName, socketPath, ...flags], { detached: true, stdio: ['ignore','pipe','pipe'] })`
2. 监听 daemon stdout，等 `"Daemon listening on <socketPath>"` 行
3. `child.unref()` 让 daemon 脱离父进程
4. daemon 写 `<name>.session` JSON 文件到磁盘

### 4.5 Response 序列化

默认输出 4 个段落：
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

- `--raw` 模式只输出 Result 值
- `--json` 输出 `{page, snapshot, code, result}` 对象

## 5. Aria Snapshot 注入脚本（核心难点）

### 5.1 算法概览

注入 JS 到页面，递归遍历 DOM，按 W3C ARIA 规范生成简化的 accessibility tree YAML，同时给可交互元素分配 `data-se-ref="eN"` 属性。

### 5.2 输出格式

```yaml
- document:
  - heading "Welcome to Example" [level=1]
  - link "Learn more" [ref=e1]
  - textbox "Search" [ref=e2]
  - button "Submit" [ref=e3]
  - navigation:
    - link "Home" [ref=e4]
```

### 5.3 角色判定优先级

```
a. 显式 role 属性: <div role="button">
b. ARIA 隐式角色: <button>→button, <a>→link, <input type=checkbox>→checkbox...
c. 无角色则用 tagName: <nav>→navigation, <main>→main, <header>→banner
```

### 5.4 可交互元素判定（分配 ref）

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

### 5.5 文本与标签提取优先级

`aria-label > aria-labelledby > <label for> > alt/title > textContent > placeholder`

文本截断到 80 字符防止 token 爆炸。

### 5.6 ref 解析

```typescript
async function resolveTarget(driver: WebDriver, target: string) {
  const refMatch = target.match(/^e\d+$/);
  if (refMatch) {
    return By.css(`[data-se-ref="${target}"]`);
  }
  return By.css(target);
}
```

### 5.7 关键约束

1. **ref 仅在单次 snapshot 内有效**：DOM 重建后 `data-se-ref` 丢失，必须重新 snapshot
2. **iframe 处理（MVP 简化）**：不递归 iframe，输出 `- iframe: <url>` 占位
3. **Shadow DOM（MVP 简化）**：不递归 open shadow root，输出占位
4. **token 控制**：超长文本截断 80 字符；`--depth=N` 限制深度（默认 50）；`find` 命令 grep 而非全量输出
5. **性能**：`getComputedStyle` 仅对疑似隐藏元素调用

### 5.8 代码生成回放

每个交互工具在执行动作时硬编码 `response.addCode(...)`：
```typescript
response.addCode(`await driver.findElement(By.css('[data-se-ref="e15"]')).click();`);
```

### 5.9 与 playwright-cli 的差距承认

| 方面 | playwright-cli | selenium-cli MVP |
|------|---------------|-----------------|
| aria 算法 | 内置成熟实现 | 自写简化版，覆盖率约 70-80% |
| ref 引擎 | 内置 `aria-ref` 选择器引擎 | `data-se-ref` 属性 + CSS selector |
| snapshot 稳定性 | 高 | 中（需在真实站点迭代） |
| iframe/shadow | 完整支持 | MVP 占位 |

## 6. 错误处理

### 6.1 错误分类

| 错误类型 | 示例 | 处理 |
|---------|------|------|
| 启动失败 | driver 二进制未安装、端口占用 | daemon 立即退出，CLI 提示 `selenium-cli install-browser` |
| 通信失败 | socket 连接超时、daemon 崩溃 | CLI 清理孤儿 `.session` 文件，提示 `open` |
| WebDriver 错误 | NoSuchElementError、TimeoutError、StaleElementReferenceError | 返回 `{ok:false, error, code}`，CLI 友好提示 |
| 注入脚本错误 | CSP 阻止、Shadow DOM 边界 | 返回部分 snapshot + warning |
| 版本不匹配 | CLI 0.2 调用 daemon 0.1 | 握手交换版本，提示 `close && open` |

### 6.2 错误输出格式

```
### Error
Element not found: [data-se-ref="e15"]
Hint: run `selenium-cli snapshot` to refresh refs.
```

### 6.3 daemon 健壮性

- `selfDestructOnIdle`：30 分钟无请求自毁（可配）
- `heartbeat`：driver 周期性 `getTitle()` 探活
- `gracefulShutdown`：SIGTERM/SIGINT → quit driver → 删 `.session` → 退出

## 7. 测试策略与实现路径

### 7.1 测试金字塔

- **单元测试（Vitest）**：parseCommand、aria snapshot 脚本、Response 序列化、registry
- **集成测试**：daemon + 真实 driver + 测试页
- **E2E 测试**：用 selenium-cli 自身测试自己（吃狗粮）

### 7.2 实现路径（6 步）

**Step 1：骨架与协议** — 项目脚手架、protocol.ts、daemon/server.ts、session.ts、registry.ts、cli.ts。验证：能 open 启动 daemon，list 看到会话，close 清理。

**Step 2：命令分发与最小命令集** — program.ts、output.ts、backend.ts、命令 `goto/title/url/close`。验证：`open https://example.com && title` 输出 "Example Domain"。

**Step 3：aria snapshot 注入脚本** — snapshot/aria-snapshot.ts、daemon/tools/snapshot.ts、find.ts。验证：todomvc 跑 snapshot，YAML 含 `- textbox` `- button`。

**Step 4：交互命令** — click/fill/type/press/select/check/uncheck + resolveTarget + 代码生成回放。验证：todomvc 完整跑 add todo → check → clear。

**Step 5：保存与执行** — screenshot、eval、go-back/forward/reload。验证：screenshot 生成 PNG，eval 返回正确值。

**Step 6：会话管理完善** — `-s=<name>`、list、close-all、kill-all、--browser、--headed、--cdp。验证：多会话并行，CDP attach。

### 7.3 验收标准

```bash
selenium-cli open https://demo.playwright.dev/todomvc/
selenium-cli snapshot
# 输出含 - textbox [ref=e1] - button "Add" [ref=e2]

selenium-cli fill e1 "Buy groceries"
selenium-cli click e2
selenium-cli snapshot
# 输出含 - listitem "Buy groceries" [ref=e3]

selenium-cli --raw eval "document.querySelectorAll('.todo-list li').length"
# 输出: 1

selenium-cli screenshot --filename=todo.png
selenium-cli close
```

每次交互命令输出对应 Selenium 代码：
```
### Ran Selenium code
await driver.findElement(By.css('[data-se-ref="e2"]')).click();
```

## 8. 后续 TODO（v0.2+ 路线图）

按优先级排序，每个版本递增交付。

### v0.2：实用能力补全

- [ ] **storage 管理**：`cookie-list/get/set/delete/clear`、`localstorage-*`、`sessionstorage-*`（用 execute_script 包装）
- [ ] **state save/load**：导出 cookie + storage 到 JSON，恢复时反向加载
- [ ] **tab 管理**：`tab-list`、`tab-new`、`tab-close`、`tab-select`（基于 `window_handles` + `switch_to.window`）
- [ ] **install --skills**：把 SKILL.md 复制到 `.claude/skills/selenium-cli/` 或 `.agents/skills/selenium-cli/`
- [ ] **--profile=<path>**：持久化用户数据目录
- [ ] **--persistent**：自动分配 userDataDir

### v0.3：iframe 与 Shadow DOM

- [ ] **iframe 递归 snapshot**：跨 frame ref（如 `f3e15`），用 `driver.switchTo().frame()` 实现
- [ ] **Shadow DOM 递归**：open shadow root 递归遍历 `el.shadowRoot`
- [ ] **find 命令增强**：支持跨 frame 搜索

### v0.4：网络与调试

- [ ] **network route mock**：基于 Selenium 4 BiDi `add_request_handler` / `add_response_handler`，包装 `route <pattern> --status=404` / `route <pattern> --body='...'` / `route-list` / `unroute`
- [ ] **console 日志**：`console [min-level]` 收集浏览器 console 消息（BiDi logging 模块）
- [ ] **requests 列表**：`requests` 列出网络请求，`request <index>` 查看详情
- [ ] **highlight**：`highlight <ref> [--style=...]` 持久化高亮，`highlight --hide` 隐藏

### v0.5：录制与回放

- [ ] **run-code**：执行任意 Selenium 代码片段（`run-code "async driver => ..."`）
- [ ] **代码生成增强**：支持生成 role-based locator（`By.role('button', {name: 'Submit'})`），更稳定
- [ ] **generate-locator <ref>**：从 ref 生成最佳 locator 表达式
- [ ] **录制模式**：`selenium-cli record` 进入录制模式，用户操作生成完整测试文件

### v0.6：可视化与高级连接

- [ ] **show dashboard**：独立窗口展示所有 session 实时镜像，可点击接管鼠标键盘（Electron 或 Playwright-driven UI）
- [ ] **show --annotate**：用户在页面画框注释，agent 收到标注截图 + snapshot + notes
- [ ] **attach --extension**：通过浏览器扩展控制真实 Chrome/Edge
- [ ] **attach 到 Grid**：`--endpoint=<url>` 连接 Selenium Grid 4

### v0.7：测试集成（探索性）

- [ ] **attach 到 pytest-selenium 暂停点**：fork 或 hook pytest-selenium，实现"测试暂停暴露 session 给外部接管"（高难度，可能不可行）
- [ ] **plan/generate/heal 工作流**：仿 playwright-cli 测试生成工作流，针对 pytest-selenium 适配
- [ ] **trace viewer**：基于 BiDi 事件流实现简化版 trace（远不及 Playwright Trace Viewer）

### 长期目标（不承诺版本）

- [ ] **多语言绑定**：Python/Java 客户端 SDK（CLI 仍用 Node）
- [ ] **云浏览器集成**：Browserbase 等 SaaS 浏览器后端
- [ ] **MCP 兼容层**：把 daemon 暴露成 MCP server，CLI 与 MCP 共享 tool handle（仿 playwright-cli 架构）
- [ ] **AI agent 生态适配**：针对 Claude Code/Cursor/Copilot 各自优化 SKILL.md

### 永不实现（明确放弃）

- ❌ **原生 aria ref 引擎**：不可能达到 Playwright `aria-ref` 选择器引擎的稳定性，永远靠 `data-se-ref` 属性
- ❌ **完整 tracing 等价物**：Selenium 无原生 tracing，BiDi 事件流体验差几个量级，不追求对等

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| aria snapshot 覆盖率不足 | agent 误判元素 → 失败率高 | 在常见站点（todomvc/登录/表单/导航）迭代脚本，目标 80% 场景可用 |
| ref 在 DOM 重建后失效 | agent 跳过 snapshot 直接操作 | 强制工作流：操作前检查 ref 是否存在，不存在则提示 snapshot |
| BiDi 稳定性（v0.4+） | network handler 静默失败 | 优先用 CDP（Chromium only），BiDi 作为 Firefox fallback |
| daemon 孤儿进程 | 资源泄漏 | selfDestructOnIdle + heartbeat + list 时探活清理 |
| Selenium driver 版本漂移 | 浏览器更新后 driver 不匹配 | 依赖 selenium-manager 自动管理，启动失败提示 install-browser |

## 10. 参考

- playwright-cli 源码（d:\code\opensource\playwright-cli）— 架构参考
- [Playwright aria snapshot 算法](https://playwright.dev/docs/aria-snapshots) — 算法灵感来源
- [Selenium 4 WebDriver BiDi](https://www.selenium.dev/documentation/webdriver/bidi/) — v0.4+ 网络能力基础
- [W3C ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/) — 角色判定规范

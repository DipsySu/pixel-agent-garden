# AGENTS.md

Languages: [English](#english) | [中文](#中文)

## English

Onboarding notes for AI coding agents working in this repository. This is the
tool-neutral version of `CLAUDE.md`: Codex, Claude Code, Cursor, and other
local agents should read this before touching code. Humans should start with
`README.md`.

## Product In One Line

Pixel Agent Garden turns local AI agent activity (Claude Code / Claude Cowork /
Codex / future adapters) into a digital garden:

`local source files` -> `AgentEvent` -> `GardenSummary` -> CLI ASCII wall /
Tauri desktop pixel garden.

Privacy is the product boundary: no network requests, no telemetry, and no
writes to source agent directories.

## Read First

1. `docs/11-tauri-rust-rewrite-spec.md` — architecture contract, modularity
   rules, phase plan, schema versioning.
2. `docs/architecture.md` — data flow and adapter contract.
3. `RUST.md` — Rust workspace and watcher notes.
4. `README.md` — user-facing CLI / Tauri usage.
5. `CHANGELOG.md` — current state of the project. Treat `## Unreleased` as the
   freshest source of truth.

## Workspace Map

```text
crates/
├── core/        # pure domain library: adapters, scan, aggregate, storage, settings
├── cli/         # agent-garden CLI
└── tauri-app/   # desktop shell, Tauri commands, tray/menu, file watcher
web/             # static frontend, vanilla HTML/CSS/JS modules, no build step
assets/sprites/  # source pixel-art assets
docs/            # specs, architecture notes, sprite/rendering docs
```

Things that should not appear:

- `tauri::`, `wry::`, or browser APIs inside `crates/core/`
- JS / TS inside `crates/`
- Python product runtime. The old prototype is gone; do not revive it.
- Network clients in scan/render paths.

## Common Commands

```bash
# Full Rust tests
cargo test --workspace

# Required before commit
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings

# CLI
cargo run --release -p local-agent-garden-cli -- adapters
cargo run --release -p local-agent-garden-cli -- scan --out ~/.local-agent-garden/events.json
cargo run --release -p local-agent-garden-cli -- garden
cargo run --release -p local-agent-garden-cli -- usage

# Desktop app
cd crates/tauri-app && cargo tauri dev

# Watcher logs
AGENT_GARDEN_DEBUG=1 cargo tauri dev

# Browser fallback preview
python3 -m http.server 8765
# open http://127.0.0.1:8765/web/index.html
```

If `cargo` is missing, try:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

## Architecture Rules

These are hard constraints. If a change violates one, redesign it.

1. `core` must not import Tauri, Wry, WebView, DOM, or frontend types.
2. Adapters do not call each other. Cross-adapter behavior belongs in
   `scan.rs`.
3. CLI and Tauri commands are thin shells. Business logic belongs in `core`.
4. Watcher watches paths and triggers rescans; it does not parse agent files.
5. JS lives only in `web/`.
6. Public Rust APIs return typed errors, not `Box<dyn Error>` / `anyhow`.
7. Local source directories are read-only. Cache/state writes go under
   `~/.local-agent-garden/`.

## Data Flow

Keep the flow one-way:

```text
agent local data -> Adapter -> AgentEvent -> scan/dedupe -> GardenSummary -> UI
```

Do not make downstream layers reach back into upstream source formats. Examples:

- UI must not depend on Claude/Codex raw JSON shapes.
- Adapters must not know frontend colors, sprite names, or layout decisions.
- Aggregation must not write to source directories.

## File Responsibilities

Each file should do one job:

| File | Responsibility |
|---|---|
| `crates/core/src/adapters/<name>.rs` | Read one source type and emit `AgentEvent` |
| `crates/core/src/scan.rs` | Run adapters, dedupe, combine events |
| `crates/core/src/aggregate.rs` | Pure event -> summary math |
| `crates/core/src/cache.rs` | Cache-first summary load and forced refresh |
| `crates/core/src/storage.rs` | Versioned `events.json` read/write |
| `crates/core/src/settings.rs` | `settings.toml` load/save |
| `crates/tauri-app/src/commands.rs` | Tauri command wrappers |
| `crates/tauri-app/src/watcher.rs` | File changes -> scan -> events |
| `crates/tauri-app/src/tray.rs` | Desktop tray/menu/window shell |
| `web/data-source.js` | Tauri/fetch data boundary |
| `web/render-*.js` | Pure rendering logic |
| `web/settings-panel.js` | Settings UI only |

If one file starts doing two unrelated jobs, split it.

## Adding An Adapter

1. Add `crates/core/src/adapters/<name>.rs`.
2. Implement the `Adapter` trait: `name`, `discover`, `collect`, and optionally
   `watch_paths`.
3. Export the module from `crates/core/src/adapters/mod.rs`.
4. Register it in `crates/core/src/registry.rs`.
5. Add fixture-based tests in the adapter module. Tests should create temporary
   files/directories; never scan the real home directory.
6. Put source-specific fields in `AgentEvent.metadata`, not top-level fields.

## Schema And Compatibility

`GardenSummary` and the `events.json` envelope have separate `schema_version`
fields. Incompatible summary-shape changes bump
`aggregate::SUMMARY_SCHEMA_VERSION`; incompatible raw event cache changes bump
`storage::EVENTS_SCHEMA_VERSION`.

Compatibility defaults matter:

- New settings fields should use `#[serde(default)]`.
- Optional new summary/event fields should be `Option<T>` where possible.
- Old cache/settings files should fail clearly or load with defaults.

## Privacy Contract

Do not break this:

- No network requests during scan, aggregation, rendering, or telemetry.
- No analytics, telemetry, crash reporting, or remote logging.
- Source agent directories are read-only.
- Cache/state writes only go to `~/.local-agent-garden/`.
- Browser fallback mode must not call Tauri APIs. Use the existing runtime
  detection boundary.

## UI / Frontend Rules

- Frontend is vanilla modules loaded by `<script type="module">`.
- Do not introduce TS, JSX, bundlers, npm dependencies, or CDN dependencies.
- Preserve the pixel-garden visual direction; prefer sprite-based rendering
  over procedural organic art when polish matters.
- Respect `settings.toml`: time mode, season mode, motion, and `auto_rescan`.
- Motion must remain CSS-driven and respect reduced/off settings.

## Tauri Events

| Event | When | Payload |
|---|---|---|
| `garden:updated` | watcher or manual scan completed | `GardenSummary` |
| `garden:error` | watcher / scan / settings / tray failure | `{ source, message, adapter? }` |
| `garden:scanning` | manual scan or future progress signal | `{ adapter? }` |

Frontend subscription lives in `web/data-source.js`.

## Testing Expectations

Before committing code changes, run:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

For Tauri shell/bundling changes, also run:

```bash
cd crates/tauri-app && cargo tauri build
```

For frontend changes, at minimum run JS syntax checks and inspect the page in a
browser or generated screenshot workflow. Keep mobile secondary; this is a
desktop-first tool.

## Commit Style

- Use English conventional commit titles: `feat:`, `fix:`, `docs:`, `chore:`.
- Commit bodies should explain why the change exists.
- Do not use `--no-verify`.
- Preserve unrelated user changes. Never reset or checkout files you did not
  intentionally modify.

## Current Phase

Use `CHANGELOG.md` as the current phase ledger. As of this file:

- Core Rust runtime is the product runtime.
- Claude Code, Claude Cowork, Codex, and manual JSONL adapters exist.
- Tauri desktop shell, settings UI, error toast, watcher, tray/menu, app
  bundling, and CI/release workflows are in place.
- Remaining distribution work is mainly signing/notarization/updater polish and
  visual/ambient garden refinements.

## When Unsure

- Adapter behavior: read `docs/architecture.md`.
- Schema changes: read `docs/11-tauri-rust-rewrite-spec.md`.
- Visual rendering: inspect `web/render-garden.js`, `web/render-svg.js`, and
  `docs/sprite-rendering.md`.
- Latest project state: read `CHANGELOG.md`.
- Product tradeoff unclear: ask the user instead of silently choosing a path.

## 中文

这是给 AI 编程 Agent 的仓库上手说明。它是 `CLAUDE.md` 的工具中立版本：
Codex、Claude Code、Cursor 以及其他本地 Agent 在改代码前都应该先读这里。
人类用户优先读 `README.md`。

### 产品一句话

Pixel Agent Garden 把本机 AI agent 活动（Claude Code / Claude Cowork /
Codex / 未来适配器）变成一个数字花园：

`本地数据源` -> `AgentEvent` -> `GardenSummary` -> CLI ASCII 墙 /
Tauri 桌面像素花园。

隐私是产品边界：不发网络请求、不做遥测、不写入源 agent 目录。

### 优先阅读

1. `docs/11-tauri-rust-rewrite-spec.md` — 架构契约、模块规则、阶段计划、schema 版本。
2. `docs/architecture.md` — 数据流和 adapter 契约。
3. `RUST.md` — Rust workspace 与 watcher 说明。
4. `README.md` — 面向用户的 CLI / Tauri 使用说明。
5. `CHANGELOG.md` — 当前项目状态；`## Unreleased` 是最新变更入口。

### 目录地图

```text
crates/
├── core/        # 纯领域库：adapters、scan、aggregate、storage、settings
├── cli/         # agent-garden CLI
└── tauri-app/   # 桌面壳、Tauri commands、托盘/菜单、文件 watcher
web/             # 静态前端，原生 HTML/CSS/JS modules，无构建步骤
assets/sprites/  # 源像素资产
docs/            # 规格、架构说明、sprite/rendering 文档
```

不应该出现的东西：

- `crates/core/` 里出现 `tauri::`、`wry::` 或浏览器 API。
- `crates/` 里出现 JS / TS。
- Python 产品运行时。旧原型已经移除，不要复活。
- scan/render 路径里的网络客户端。

### 常用命令

```bash
# 全量 Rust 测试
cargo test --workspace

# 提交前必跑
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings

# CLI
cargo run --release -p local-agent-garden-cli -- adapters
cargo run --release -p local-agent-garden-cli -- scan --out ~/.local-agent-garden/events.json
cargo run --release -p local-agent-garden-cli -- garden
cargo run --release -p local-agent-garden-cli -- usage

# 桌面 app
cd crates/tauri-app && cargo tauri dev

# watcher 日志
AGENT_GARDEN_DEBUG=1 cargo tauri dev

# 浏览器 fallback 预览
python3 -m http.server 8765
# open http://127.0.0.1:8765/web/index.html
```

如果找不到 `cargo`，先尝试：

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

### 架构硬规则

这些是硬约束。任何改动违反其中之一，都应该重新设计。

1. `core` 不能导入 Tauri、Wry、WebView、DOM 或前端类型。
2. Adapter 之间不能互相调用；跨 adapter 行为放在 `scan.rs`。
3. CLI 和 Tauri commands 只做薄封装；业务逻辑放在 `core`。
4. Watcher 只监听路径并触发重扫，不解析 agent 文件。
5. JS 只放在 `web/`。
6. 公开 Rust API 返回类型化错误，不用 `Box<dyn Error>` / `anyhow`。
7. 本地源目录只读；缓存和状态只写入 `~/.local-agent-garden/`。

### 数据流

保持单向流动：

```text
agent 本地数据 -> Adapter -> AgentEvent -> scan/dedupe -> GardenSummary -> UI
```

下游层不要回头依赖上游源格式。例如：

- UI 不应该依赖 Claude/Codex 的原始 JSON 结构。
- Adapter 不应该知道前端颜色、sprite 名称或布局决策。
- Aggregation 不应该写入源目录。

### 文件职责

| 文件 | 职责 |
|---|---|
| `crates/core/src/adapters/<name>.rs` | 读取一种数据源并产出 `AgentEvent` |
| `crates/core/src/scan.rs` | 运行 adapters、去重、合并 events |
| `crates/core/src/aggregate.rs` | 纯 event -> summary 计算 |
| `crates/core/src/cache.rs` | 缓存优先的 summary 加载和强制刷新 |
| `crates/core/src/storage.rs` | 版本化 `events.json` 读写 |
| `crates/core/src/settings.rs` | `settings.toml` 读写 |
| `crates/tauri-app/src/commands.rs` | Tauri command wrappers |
| `crates/tauri-app/src/watcher.rs` | 文件变化 -> scan -> events |
| `crates/tauri-app/src/tray.rs` | 桌面托盘/菜单/window 壳 |
| `web/data-source.js` | Tauri/fetch 数据边界 |
| `web/render-*.js` | 纯渲染逻辑 |
| `web/settings-panel.js` | 设置 UI |

如果一个文件开始承担两个无关职责，就拆分。

### 增加 Adapter

1. 新增 `crates/core/src/adapters/<name>.rs`。
2. 实现 `Adapter` trait：`name`、`discover`、`collect`，以及可选的 `watch_paths`。
3. 在 `crates/core/src/adapters/mod.rs` 导出模块。
4. 在 `crates/core/src/registry.rs` 注册。
5. 增加基于 fixture 的测试；测试创建临时文件/目录，不能扫描真实 home。
6. 数据源特有字段放进 `AgentEvent.metadata`，不要加顶层字段。

### Schema 与兼容

`GardenSummary` 和 `events.json` envelope 都有各自的 `schema_version`。不兼容的
summary 结构变更 bump `aggregate::SUMMARY_SCHEMA_VERSION`;不兼容的原始事件缓存结构变更
bump `storage::EVENTS_SCHEMA_VERSION`。

兼容默认值很重要：

- 新 settings 字段用 `#[serde(default)]`。
- 新 summary/event 字段尽量用 `Option<T>`。
- 旧 cache/settings 文件要么清晰失败，要么带默认值加载。

### 隐私契约

不要破坏：

- scan、aggregation、rendering 或 telemetry 期间不发网络请求。
- 不加 analytics、telemetry、crash reporting 或远程日志。
- 源 agent 目录只读。
- 缓存/状态只写入 `~/.local-agent-garden/`。
- 浏览器 fallback 模式不能调用 Tauri API，使用现有 runtime detection 边界。

### UI / 前端规则

- 前端是原生 modules，通过 `<script type="module">` 加载。
- 不引入 TS、JSX、bundler、npm dependency 或 CDN dependency。
- 保持 pixel-garden 视觉方向；需要精致有机视觉时优先 sprite-based rendering。
- 尊重 `settings.toml`：time mode、season mode、motion、`auto_rescan`。
- 动效必须 CSS 驱动，并尊重 reduced/off 设置。

### Tauri Events

| Event | 触发时机 | Payload |
|---|---|---|
| `garden:updated` | watcher 或手动 scan 完成 | `GardenSummary` |
| `garden:error` | watcher / scan / settings / tray 失败 | `{ source, message, adapter? }` |
| `garden:scanning` | 手动 scan 或未来进度信号 | `{ adapter? }` |

前端订阅入口在 `web/data-source.js`。

### 测试要求

提交代码前运行：

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
```

Tauri 壳/打包相关改动还要运行：

```bash
cd crates/tauri-app && cargo tauri build
```

前端改动至少做 JS syntax check，并用浏览器或截图 workflow 检查页面。移动端是次要目标；
这是 desktop-first 工具。

### Commit 风格

- 使用英文 conventional commit 标题：`feat:`、`fix:`、`docs:`、`chore:`。
- commit body 解释为什么要改。
- 不使用 `--no-verify`。
- 保留无关用户改动；不要 reset 或 checkout 不是你明确修改的文件。

### 当前阶段

以 `CHANGELOG.md` 作为当前阶段账本。目前：

- Rust core runtime 是产品运行时。
- 已有 Claude Code、Claude Cowork、Codex、manual JSONL adapters。
- Tauri 桌面壳、settings UI、error toast、watcher、tray/menu、app bundling、
  CI/release workflows 都已就位。
- 剩余分发工作主要是签名/公证/updater 打磨，以及花园视觉和 ambient 体验优化。

### 不确定时

- Adapter 行为：读 `docs/architecture.md`。
- Schema 变化：读 `docs/11-tauri-rust-rewrite-spec.md`。
- 视觉渲染：看 `web/render-garden.js`、`web/render-svg.js` 和
  `docs/sprite-rendering.md`。
- 最新项目状态：读 `CHANGELOG.md`。
- 产品取舍不清楚：问用户，不要悄悄替用户做决定。

## Imported Claude Cowork project instructions

1. 用中文进行回复, 但是可以有一些英文的技术词汇
2. 我要注意代码结构, 以及解耦性, 功能模块之间保持独立和可替代性, 以及扩展性

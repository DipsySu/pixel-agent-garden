# Tauri + Rust 改造规范 · Tauri + Rust Rewrite — Phase 1 Spec

> 状态: 草稿待审 · Status: draft for review
> 目标: 用一个 Tauri 桌面应用替换掉 Python 后端 + 独立 HTTP server, Rust 核心驱动, 嵌入现有的像素艺术 web 前端.
> Goal: replace the Python backend and standalone HTTP server with a single Tauri desktop app driven by a Rust core, embedding the existing pixel-art web frontend.

---

## 0. 目标与非目标 · Goals and non-goals

### Phase 1 范围内 · In scope

- 把 `local_agent_garden/` (Python) 重写为 Rust workspace.
  Rewrite the Python tree as a Rust workspace.
- Rust 端产出**字节级一致**的 `garden-summary.json`, 现有 `web/index.html` 不改一行.
  Produce a **byte-identical** `garden-summary.json` from Rust so the existing `web/index.html` keeps working untouched.
- 用 Tauri 包成桌面 app, 自带 `notify` 文件监听器, 数据变化实时反映到画面.
  Wrap in a Tauri app with a `notify`-based file watcher → real-time scene updates without manual `scan`.
- 保留 CLI 体验 (`agent-garden scan / projects / inspect / garden`) 为 Rust 二进制, 不让命令行用户掉队.
  Keep the CLI (`agent-garden scan / projects / inspect / garden`) alive as a Rust binary so power users don't lose anything.

### Phase 1 范围外 · Out of scope (but decisions made now)

- 新功能 (季节/昼夜视觉、PNG 导出、成本面板、更多 adapter). 留到 v1.1+, 重写完再说.
  New features (season/day-night driver, PNG export, cost panel, more adapters). Defer to v1.1+ once the rewrite has landed.
- 前端改版. `web/` 目录原样上车.
  Frontend redesign. `web/` ships as-is.
- 签名 / 公证. Phase 1 只要 dev build, signed dist 是 phase 3.
  App signing / notarization. Dev builds first; signing pipeline is phase 3.
- 删除 Python 代码. 保留到 Rust 端达到 parity, 并双跑一个 release 周期之后再清.
  Remove the Python codebase. Keep until Rust hits parity AND we've run both side-by-side for one release cycle.

### 硬性约束 · Hard requirements

- **运行时零 Python**. App 启动后不依赖任何 Python 解释器.
  **Zero Python at runtime** in the shipped app.
- `core` crate 不依赖任何 Tauri / web / IPC 库 — 必须能作为纯 Rust 库被复用 (同时支撑 `cli` 和 `tauri-app`).
  `core` crate has zero Tauri / web / IPC dependencies — usable as a plain library powering both `cli` and `tauri-app`.
- 所有现有 Python 测试必须有 Rust 对应版本, 跑同样的 fixture, 断言同样的输出.
  Every current Python test must have a Rust equivalent running the same fixtures and asserting the same output.

---

## 1. Workspace 布局 · Workspace layout

Cargo workspace 在仓库根, 和 Python tree 并存 (不替换).
Cargo workspace at the repo root, alongside (not replacing) the Python tree.

```
local-agent-garden/
├── Cargo.toml                  # workspace manifest
├── crates/
│   ├── core/                   # 域逻辑, 无 UI/IPC 依赖 · domain, no UI/IPC deps
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── event.rs        # AgentEvent + TokenUsage
│   │       ├── adapter.rs      # Adapter trait + AdapterContext
│   │       ├── registry.rs     # 内置 adapter 清单 · built-in adapters
│   │       ├── adapters/
│   │       │   ├── claude_code.rs
│   │       │   ├── codex.rs
│   │       │   └── manual_jsonl.rs
│   │       ├── aggregate.rs    # summarize() + GardenSummary
│   │       ├── scan.rs         # 编排 discover + collect · orchestrates discover + collect
│   │       ├── storage.rs      # events.json 读写 · read/write events.json
│   │       └── error.rs        # crate Error 类型
│   ├── cli/
│   │   ├── Cargo.toml
│   │   └── src/main.rs         # `agent-garden` 二进制 · binary
│   └── tauri-app/
│       ├── Cargo.toml
│       ├── tauri.conf.json
│       ├── build.rs
│       ├── src/
│       │   ├── main.rs
│       │   ├── commands.rs     # #[tauri::command] 处理器 · handlers
│       │   ├── watcher.rs      # notify 文件监听 · file watcher
│       │   └── events.rs       # Tauri 事件名 + payload · event names + payloads
│       └── dist/               # 构建期把 web/ 拷进来 · web/ bundled at build time
├── web/                        # 原样保留 · unchanged
├── local_agent_garden/         # parity 达成前保留, 之后删 · kept until parity, then deleted
└── docs/
```

依赖方向 · Dependency direction:

```
core  ←  cli
core  ←  tauri-app
```

`core` 在运行时**不**依赖 `cli` 或 `tauri-app`, 在 workspace 成员声明里强制约束.
`core` has **no** runtime dependency on `cli` or `tauri-app`. Enforced via workspace members.

---

## 2. 域模型 · Domain model

### 2.1 `AgentEvent` (对应 Python `events.AgentEvent`)

```rust
// crates/core/src/event.rs
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEvent {
    pub source: String,
    pub timestamp: DateTime<Utc>,
    pub project_path: Option<String>,
    pub session_id: Option<String>,
    #[serde(default = "default_event_type")]
    pub event_type: String,         // "activity" | "message" | "thread" | ...
    #[serde(flatten)]
    pub usage: TokenUsage,
    #[serde(default)]
    pub tool_calls: u32,
    pub model: Option<String>,
    #[serde(default)]
    pub files_touched: Vec<String>,
    pub cost_usd: Option<f64>,
    pub raw_ref: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TokenUsage {
    #[serde(default)] pub input_tokens: u64,
    #[serde(default)] pub output_tokens: u64,
    #[serde(default)] pub cache_read_tokens: u64,
    #[serde(default)] pub cache_write_tokens: u64,
    #[serde(default)] pub total_tokens: u64,
}

impl AgentEvent {
    /// aggregate 使用的派生 key, fallback 规则和 Python 一致.
    /// Derived key used by aggregate; same fallback as Python.
    pub fn project_key(&self) -> String {
        match &self.project_path {
            Some(p) => p.clone(),
            None => format!("unknown:{}", self.source),
        }
    }
}
```

**JSON 契约**: 序列化输出必须和 Python `to_json()` 完全一致 (字段名一致, key 顺序无所谓但字段存在与否必须一致). 测试用 JSON 字符串往返比对.

**JSON contract**: serialization must match Python `to_json()` exactly (field names match; key order doesn't matter, but presence/absence does). Tests round-trip diff via JSON strings.

### 2.2 `Adapter` trait

```rust
// crates/core/src/adapter.rs
use crate::event::AgentEvent;
use std::path::PathBuf;

pub struct AdapterContext {
    pub home: PathBuf,
    pub manual_jsonl: Vec<PathBuf>,
}

pub trait Adapter: Send + Sync {
    /// CLI + JSON 里曝光的稳定名, 和 Python adapter `name` 一致.
    /// Stable name surfaced in CLI + JSON. Matches Python adapter `name`.
    fn name(&self) -> &str;

    /// 廉价检查: 该 adapter 的文件存在吗?
    /// Cheap check: are this adapter's files present?
    fn discover(&self, ctx: &AdapterContext) -> bool;

    /// 读取原始文件 → AgentEvent. 必须容忍部分损坏的文件 (跳过而非 fail-fast).
    /// Read raw files, parse into AgentEvent. Must tolerate partial/corrupt files (skip rather than fail-fast).
    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, crate::Error>;

    /// 该 adapter 关心的文件路径或目录. Tauri 层订阅这些路径; 返回空 Vec 表示该 adapter 不支持实时更新.
    /// File paths or directories this adapter watches. Tauri subscribes to these; empty Vec = no live updates.
    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> {
        vec![]
    }
}
```

相对 Python 接口的关键新增 · Notable additions vs. Python:

- `watch_paths()` **新增** — watch 路径的归属在 adapter 自己, Tauri 层不需要知道 agent 特定的目录.
  `watch_paths()` is **new** — the watch story lives in the adapter so the Tauri layer doesn't need to know about agent-specific directories.
- 所有错误返回类型化 `Error` (不像 Python 那种静默 `pass`). Adapter 内部吞掉行级错误, 但 I/O 失败要冒泡.
  All errors return a typed `Error` (no silent `pass` like Python). Adapters swallow per-row errors but bubble up I/O failures.

### 2.3 `GardenSummary` + `summarize()`

对应 Python `aggregate.py`. **stage 阈值和 activity_score 公式字节级保持一致**. 这是前端读的契约.
Mirror of Python `aggregate.py`. Stage thresholds and the activity-score formula stay **byte-identical**. This is the contract the frontend reads.

```rust
pub struct GardenSummary {
    pub projects: Vec<ProjectGrowth>,
    pub sources: BTreeMap<String, u64>,
    pub total_events: u64,
    pub total_tokens: u64,
    pub first_seen: Option<DateTime<Utc>>,
    pub last_seen: Option<DateTime<Utc>>,
}
```

**关键**: `GardenSummary::to_json()` 输出形状必须和当前 `garden-summary.json` 一致, 未改前端继续工作. snapshot test 守住.
**Critical**: `GardenSummary::to_json()` output shape must match the current `garden-summary.json` so the unmodified frontend keeps rendering. Snapshot tests enforce this.

---

## 3. Adapter 逐个迁移计划 · Adapter-by-adapter migration

| Python 文件 | Rust 目标 | 风险 | 备注 · Notes |
|---|---|---|---|
| `adapters/base.py` | `core/src/adapter.rs` | 低 / low | Trait + context struct |
| `adapters/claude_code.py` | `core/src/adapters/claude_code.rs` | **中低 / low-med** | JSONL 流式读取; `serde_json` + `BufReader::lines()`. `usage` 字段名 (`input_tokens`, `cache_creation_input_tokens` 等) 必须精确映射. |
| `adapters/codex.py` | `core/src/adapters/codex.rs` | **中 / medium** | SQLite 经 `rusqlite` 只读模式 (`?mode=ro`). 三类输入: `state_5.sqlite`, `session_index.jsonl`, rollout JSONL glob. |
| `adapters/manual_jsonl.py` | `core/src/adapters/manual_jsonl.rs` | 低 / low | 单纯 JSONL parse |
| `adapters/utils.py` | `core/src/adapters/util.rs` | 低 / low | `as_int`, `read_jsonl`, `project_from_claude_dir` — 几个小自由函数 |
| `adapters/registry.py` | `core/src/registry.rs` | 低 / low | `default_adapters() -> Vec<Box<dyn Adapter>>` |

Per-adapter fixture 放在 `crates/core/tests/fixtures/<adapter>/`, 从 Python 测试套件直接拷过来. 每个 adapter 都有 snapshot test 断言 `collect()` 产出和 Python 版完全一致 — 用 `serde_json::Value` diff.

Per-adapter test fixtures live in `crates/core/tests/fixtures/<adapter>/`, copied verbatim from the Python test suite. Each adapter has a snapshot test asserting `collect()` produces the same events as the Python version — diffed via `serde_json::Value`.

---

## 4. Tauri 应用层 · Tauri app layer

### 4.1 边界 · Boundaries

`tauri-app` 只包含 · `tauri-app` only contains:

- WebView 配置、窗口配置、资源挂载 · WebView setup, window config, asset mounting
- `#[tauri::command]` 处理器 (薄薄一层, 委派给 `core`) · command handlers that delegate to `core`
- 监听 adapter watch_paths 的文件 watcher · file watcher listening to adapter watch_paths
- 防抖 / 合并 rescan 触发 · debounce / coalesce rescan triggers

**不包含**任何 agent 特定的解析逻辑 — 那些全在 `core`.
**No** agent-specific parsing — all of that lives in `core`.

### 4.2 Tauri 命令 (前端 → Rust) · Tauri commands (frontend → Rust)

```rust
// crates/tauri-app/src/commands.rs

#[tauri::command]
fn garden_summary() -> Result<GardenSummary, String> {
    // 返回当前缓存的 summary (过期则重扫)
    // Returns current cached summary (re-scans if stale)
}

#[tauri::command]
fn trigger_scan() -> Result<GardenSummary, String> {
    // 强制重扫并返回新的 summary
    // Forces a fresh scan + returns the new summary
}

#[tauri::command]
fn list_adapters() -> Vec<AdapterStatus> {
    // {name, active, watch_paths}
}

#[tauri::command]
fn data_freshness() -> Option<DateTime<Utc>> {
    // 上次成功 scan 的时间 · last successful scan time
}
```

### 4.3 Tauri 事件 (Rust → 前端) · Tauri events (Rust → frontend)

```rust
// 扫描成功并有新数据时发 · emitted when scan completes with new data
"garden:updated"   -> { generated_at: ISO8601, summary: GardenSummary }

// 扫描进行中 (罕见, 但可用于显示 spinner) · while a scan is running
"garden:scanning"  -> { adapter: Option<String> }

// 扫描失败 · scan failed
"garden:error"     -> { message: String, adapter: Option<String> }
```

### 4.4 文件 watcher · File watcher

`notify` crate, recommended-watcher 模式. 对 `default_adapters()` 的每个 adapter, 调用 `adapter.watch_paths(&ctx)` 并订阅所有返回路径.

`notify` crate, recommended-watcher mode. For each adapter in `default_adapters()`, call `adapter.watch_paths(&ctx)` and subscribe to every returned path.

**防抖**: 每 800ms 最多触发一次重扫 (可通过 `app.toml` 配置). 这个窗口内的多次文件事件合并成单次 rescan.

**Debounce**: rescan triggered at most once per 800ms (configurable via `app.toml`). Multiple file events within that window collapse into a single rescan.

**边缘情况**: 如果用户在 app 打开时手动跑了 CLI, watcher 应该检测到 `~/.local-agent-garden/events.json` 的重写并发出 `garden:updated`, 不需要重新跑 scan.

**Edge case**: if user runs the CLI manually while the app is open, the watcher should detect the rewrite of `~/.local-agent-garden/events.json` and emit `garden:updated` without re-running scan.

---

## 5. 前端改动 (最小) · Frontend changes (minimal)

当前 `web/index.html` 做的事 · what `web/index.html` currently does:

```js
fetch('./data/garden-summary.json')
  .then(r => r.json())
  .then(renderEverything);
```

Tauri-friendly 版本检测 `window.__TAURI__` 后切换路径:
The Tauri-friendly version detects `window.__TAURI__` and switches paths:

```js
async function loadSummary() {
  if (window.__TAURI__) {
    const { invoke, event } = window.__TAURI__;
    const summary = await invoke('garden_summary');
    await event.listen('garden:updated', (e) => renderEverything(e.payload.summary));
    return summary;
  }
  // 浏览器回退路径, 供 `python -m http.server` 开发流程继续用
  // Browser fallback for `python -m http.server` dev workflow
  const r = await fetch('./data/garden-summary.json');
  return r.json();
}
```

这是 `web/` 里**唯一**需要改动的文件. 渲染管线、sprite 路径、动画、hover 系统全部不用动.

This is the **only** file change required in `web/`. The render pipeline, sprite paths, animations, hover system — none of that needs touching.

**Sprite 路径**: `../assets/sprites/...` 相对路径在 Tauri 的 asset-protocol 下是否能加载, 取决于 `assets/` 是否和 `web/` 同级. Phase 1 day 1 smoke test 验证; 不行的话用 `convertFileSrc()` 或把 `assets/sprites/` 挪到 `web/` 下.

**Sprite paths**: `../assets/sprites/...` relative paths work in Tauri's asset-protocol if `assets/` is co-located with `web/`. Confirm via day-1 smoke test; if broken, use `convertFileSrc()` or move `assets/sprites/` under `web/`.

---

## 6. CLI 平替 · CLI parity

`crates/cli/src/main.rs` 复刻 · reproduces:

```
agent-garden adapters         # 列可用 adapter · list available adapters
agent-garden scan [--out ...]  # 写 events JSON · write events JSON
agent-garden projects          # 打印项目表 · print project table
agent-garden inspect --project NAME
agent-garden garden            # ASCII 墙 (port of ui/ascii_wall.py)
agent-garden export-web        # 写 web/data/garden-summary.json
```

ASCII 墙渲染器本身是一坨活 (Python `ui/ascii_wall.py` ~250 行). 单文件移植, 逻辑改动最小. 即使 Tauri app 没启动, 它也是个有用的 CLI smoke test.

The ASCII wall renderer is a chunk of work on its own (~250 lines of Python). Single-file port, minimal logic changes. Useful as a CLI smoke test even when the Tauri app isn't running.

---

## 7. 测试 · Tests

三层 · Three layers:

**`core` 单元测试** · `core` unit tests (per-adapter, in `crates/core/tests/`):

- `claude_code_basic.rs` — 喂 fixture JSONL, 断言事件数 + 抽查 total_tokens
  feeds a fixture JSONL, asserts event count + spot-check total_tokens
- `codex_threads.rs` — 读 fixture sqlite, 断言 thread events
  reads a fixture sqlite, asserts thread events
- `aggregate_snapshot.rs` — 喂已知 events, 把 GardenSummary JSON 做 snapshot, 和 golden file diff
  feeds known events, snapshot the GardenSummary JSON, diff against golden file
- **迁移保险 · Migration assurance**: 每个 Python `tests/test_*.py` 都有 Rust 对应版本, 跑同样的 fixture. Rust adapter 必须 (a) Rust 测试通过 AND (b) 和 Python 输出的 JSON-diff 为空 (或只是字段顺序差异) 才能合.
  Each Python test gets a Rust counterpart on the same fixture. We don't merge a Rust adapter until (a) its Rust test passes AND (b) the JSON diff against Python output is empty (or differs only in field order).

**`tauri-app` 集成测试** · integration tests (manual + smoke):

- `cargo test --workspace` 跑 core 测试, 无头
  runs core tests headless
- `cargo tauri dev` 启 dev 窗口; 手动 smoke: vine 渲染、hover、touch fixture file → watcher 发 `garden:updated`
  manual smoke: vine renders, hover works, touching a fixture file → watcher emits `garden:updated`
- Phase 1 没有自动化 UI 测试 · no automated UI tests in phase 1

**兼容性测试** · Compatibility test (单次, 每个 adapter port 的门禁):

- 跑 `python -m local_agent_garden scan --out /tmp/py.json`
- 跑 `agent-garden scan --out /tmp/rs.json`
- `diff <(jq -S . /tmp/py.json) <(jq -S . /tmp/rs.json)` → 必须为空 · must be empty

---

## 8. 构建、开发流、分发 · Build, dev, distribution

**开发 · Dev**:

```bash
# 仅库测试 (快) · library tests only
cargo test -p local-agent-garden-core

# CLI 健康检查 · CLI sanity
cargo run -p local-agent-garden-cli -- scan --out /tmp/x.json

# Tauri 热重载 dev · Tauri dev with hot reload
cargo tauri dev
```

**打包 · Bundle**:

```bash
cargo tauri build       # mac: .app / .dmg | win: .exe / .msi
```

Phase 1 目标: macOS 上跑得通的 dev build. Signed dist 是 phase 3.
Phase 1 target: working dev build on macOS. Signed dist is phase 3.

Bundle 大小估算 · Bundle size estimate: Tauri shell ~6MB + Rust core (~3MB stripped) + web assets (sprites ~5MB) + manifest = **未签名 ~15MB / unsigned ~15MB**. 目标 ≤20MB.

---

## 9. 数据文件位置 (不变) · Data file locations (unchanged)

Adapter 仍从用户级路径读 · Adapters keep reading from existing user-level paths:

- `~/.claude/projects/`
- `~/.codex/state_5.sqlite`, `~/.codex/sessions/`
- 任何用户提供的 JSONL 路径 · any user-supplied JSONL paths

Tauri app 把 cache 写到 `~/.local-agent-garden/` (和 Python 一致), 这样用户暂时新旧并跑也能看到一致数据.

The Tauri app writes its cache to `~/.local-agent-garden/` (same as Python), so users running both old CLI and new app temporarily see consistent data.

**故意不用** Tauri 的 `AppData` 位置, 为了保留 CLI 兼容性.
**Intentionally NOT** Tauri's `AppData` location, to preserve CLI compatibility.

---

## 10. 模块化铁律 · Modularity rules (non-negotiable)

防止未来代码臃肿 · To prevent future bloat:

1. **`core` 不准 import `tauri::`. 永远.** 如果 `core` 函数需要 IPC, 它返回 `Result`, 调用方决定怎么处理. CI lint: 禁止 `core/Cargo.toml` 出现 `tauri` 或 `wry` 依赖.
   **`core` has no `tauri::` import. Ever.** If a `core` function needs IPC, it returns a `Result` and the caller decides. CI lint: forbid `tauri` and `wry` in `core/Cargo.toml`.

2. **Adapter 之间不互相调用**. 每个 adapter = 一个文件、一个 trait impl、一套测试. 跨 adapter 的逻辑 (比如去重) 放 `scan.rs`, 不放 adapter 里.
   **Adapters never call each other.** Each adapter is one file, one trait impl, one set of tests. Cross-adapter logic (e.g. dedup) lives in `scan.rs`.

3. **`commands.rs` 不能有业务逻辑**. command 处理器是 1-3 行的 wrapper, 委派给 `core`.
   **No business logic in `commands.rs`.** Command handlers are 1-3 line wrappers that delegate to `core`.

4. **watcher 对 `core` 是无知的**. 它收到 adapter 给的 `Vec<PathBuf>`, 发出"X 路径变了". 它不知道变化的意义.
   **The watcher is `core`-agnostic.** It receives `Vec<PathBuf>` from adapters and emits "something changed at X". It doesn't know what the change means.

5. **前端只住在 `web/`**. `crates/` 里不出现 JS/TS. 如果以后加 bundler (Vite 之类), 它放在 `web/` 下, 自己的 `package.json`.
   **Frontend stays in `web/`.** No JS/TS in `crates/`. If we add a bundler later (Vite, etc.), it lives in `web/` with its own `package.json`.

6. **错误是类型化的**. `core::Error` 是 `thiserror` enum. 公开 API 里不出现 `Box<dyn Error>`.
   **Errors are typed.** `core::Error` is a `thiserror` enum. No `Box<dyn Error>` in public APIs.

---

## 11. 阶段计划 · Phase plan

**Phase 1 — core + CLI (本 spec / this spec)**:

- Week 1: workspace 脚手架, `core` 骨架, `event.rs` + `adapter.rs`, `claude_code` adapter, snapshot test 通过
  workspace scaffold, `core` skeleton, `event.rs` + `adapter.rs`, `claude_code` adapter, snapshot test passing
- Week 2: `codex` + `manual_jsonl` adapters, `aggregate`, `scan`, CLI 二进制达到和 Python CLI parity
  `codex` + `manual_jsonl` adapters, `aggregate`, `scan`, CLI binary at parity with Python CLI
- **退出门禁 · Exit gate**: `agent-garden scan` 输出和 Python 字节级一致 (除字段顺序)
  `agent-garden scan` output byte-equal to Python (modulo field order)

**Phase 2 — Tauri 应用层 · Tauri app**:

- Tauri 脚手架 + WebView 指向 `web/`
  Tauri scaffold + WebView pointing to `web/`
- 实现 commands + events
  Commands + events implemented
- `notify` watcher → 防抖 rescan → emit `garden:updated`
  `notify` watcher → debounced rescan → `garden:updated` emit
- 前端加 `window.__TAURI__` 分支
  Frontend gets the `window.__TAURI__` branch
- **退出门禁 · Exit gate**: 冷启动 → vine 渲染 < 1s; 改 `~/.claude` 文件 → 场景 1s 内更新
  cold start → vine renders < 1s; touching a `~/.claude` file → scene updates within 1s

**Phase 3 — 分发 · Distribution**:

- macOS 签名 + 公证 · code signing + notarization
- Windows 构建 + 安装包 · build + installer
- Linux AppImage
- system tray + token-count badge
- 下线 Python CLI, 用户引导到 Rust 二进制
  Sunset Python CLI; redirect users to Rust binary
- **退出门禁 · Exit gate**: 签名 `.dmg` 可分发; Python 树移到 `legacy/` 或删除
  signed `.dmg` distributable; old Python tree archived to `legacy/` or deleted

---

## 12. 待你拍板的决策 · Open questions for you

| # | 问题 · Question | 我的倾向 · My recommendation |
|---|---|---|
| Q1 | workspace 放仓库根, 还是先把 Python 挪到 `legacy/`? | **workspace 放根**, Python 暂留. Phase 3 再清. |
| | Workspace at repo root, or move Python to `legacy/` first? | **Workspace at root**, Python stays. Cleanup after phase 3. |
| Q2 | Rust 2021 还是 2024 edition? | **2024** (2025 年 2 月发布的当前 stable) |
| | Rust 2021 or 2024 edition? | **2024** (released Feb 2025, current stable) |
| Q3 | `tokio` 异步还是同步? | **`core` 同步** (文件 I/O 很快, 类型简单); `tauri-app` 内部用 `tokio` 因为 Tauri command 约定是 async |
| | `tokio` async or stay sync? | **Sync in `core`** (file I/O is fast, simpler types); `tokio` only inside `tauri-app` since Tauri commands are async by convention |
| Q4 | SQLite crate: `rusqlite` 还是 `sqlx`? | **`rusqlite`** — 同步, 简单, 正好够读只读 thread 表 |
| | SQLite crate: `rusqlite` or `sqlx`? | **`rusqlite`** — simpler, sync, exactly what we need |
| Q5 | datetime crate: `chrono` 还是 `time`? | **`chrono`** — serde 集成更好, 匹配我们要保留的 Python ISO 8601 输出 |
| | Datetime crate: `chrono` or `time`? | **`chrono`** — better serde integration, matches the Python ISO 8601 output we need to preserve |
| Q6 | 开机自启? | **phase 3 决定**, 现在不做 |
| | Auto-launch on system startup? | **Phase 3** decision, not now |
| Q7 | 窗口: 原生 chrome / 自定义 titlebar? | phase 1 用 **原生 chrome** (Tauri 默认); phase 3 polish 再说 |
| | Window: native chrome or custom titlebar? | **Native chrome** (Tauri default) for phase 1; revisit phase 3 |
| Q8 | 首次启动 onboarding (无 agent 数据)? | 现有 `pg6-empty` 空数据态已经处理, Tauri 侧零工作 |
| | First-launch onboarding (no agent data yet)? | Already handled by existing `pg6-empty` empty state; no Tauri-side work |
| Q9 | scan cache 放哪? | **`~/.local-agent-garden/events.json`** (和 Python 一致) |
| | Where does the scan cache live? | **`~/.local-agent-garden/events.json`** (same as Python) |
| Q10 | phase 1 要不要砍掉 manual-jsonl? | **保留** — 代码小、有测试、是非原生 adapter 的逃生口 |
| | Drop manual-jsonl in phase 1? | **Keep it** — small, tested, a useful escape hatch for non-native adapters |

---

## 13. 风险 · Risks

- **Tauri asset 协议 vs. sprite 相对路径**: 如果 `<img src="../assets/sprites/X.png">` 在 `tauri://localhost/` 下解析不到, 需要重构资源路径. 缓解: dev-day-1 smoke test, 锁定方案前先验证.
  **Tauri asset protocol vs. relative sprite paths**: if `<img src="../assets/sprites/X.png">` doesn't resolve under `tauri://localhost/`, asset paths need restructuring. Mitigation: dev-day-1 smoke test.

- **Codex SQLite schema 漂移**: Python adapter 读特定表结构. 重写期间 Codex 升级了 schema 就撞墙. 缓解: snapshot fixture + 宽容解析 (Python 已经做了, 移植同一套).
  **Codex SQLite schema drift**: the Python adapter reads a specific schema. If Codex updates its schema between rewrite and release we hit a wall. Mitigation: snapshot fixture + lenient parsing (already in Python, port the same).

- **Python 和 Rust JSON 输出漂移**: 小差异 (datetime 精度、token 整数 vs 浮点) 可能让 snapshot diff 翻车. 缓解: 显式 serde 格式注解 + 比对前归一化.
  **JSON output drift between Python and Rust**: small differences (datetime precision, int-vs-float for token counts) could break the snapshot diff. Mitigation: explicit serde annotations + normalize before comparing.

- **网络盘 / overlay FS 上 watcher 漏事件**: macOS 上 `notify` 用 FSEvents, 某些 mount 类型可能漏. 缓解: 已经有"手动 Rescan"按钮兜底.
  **File watcher false negatives on network drives / overlay FS**: macOS `notify` uses FSEvents which can miss changes on some mount types. Mitigation: ship a manual "Rescan" button as fallback (already planned).

---

## 14. Phase 1 交付物 · Deliverables for end of phase 1

- `crates/core/` 编译通过, 所有 adapter 测试绿
  compiles, all adapter tests green
- `crates/cli/` 二进制 drop-in 替代 `python -m local_agent_garden scan / projects / inspect / garden`
  produces a binary that drop-in replaces the Python CLI
- `cargo test --workspace` 通过 · passes
- 兼容性检查脚本: 在用户真实数据上跑 Python 和 Rust 两边的 scan, diff 必须为空
  Compatibility check script that runs both Python and Rust scans against real data and diffs the output — must be empty
- 本 spec 从 "draft" 升级到 "approved + signed off"
  This spec promoted from "draft" to "approved + signed off"
- Phase 2 spec 写出来 · Phase 2 spec written

---

**签字 · Sign-off**: 等你审完并回答 Q1–Q10, 我就开 Cargo workspace 起 phase 1 day 1.
**Sign-off**: Once you've reviewed and answered Q1–Q10, I'll open the Cargo workspace and start phase 1 day 1.

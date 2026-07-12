# Pixel Agent Garden

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) · [Product page](https://dipsysu.github.io/pixel-agent-garden/) · [🔒 100% local — verify it yourself](PRIVACY.md)

Languages: [English](#english) | [中文](#中文)

## English

A private desktop garden grown from your local AI agent activity.

![Pixel Agent Garden showing a night courtyard with project vines, seasonal lights, a pavilion, and local-only controls](docs/images/garden.png)

### Visual modes

The app includes two local-only visual modes. The 2.5D courtyard is the default
ambient view for staying open on the desktop. The Wall view keeps the original
vine-wall language visible: project growth hangs from the wall edge, programming
stickers mark the tools and ecosystems around the garden, and the brick surface
works as a direct map of local agent activity.

![Pixel Agent Garden Wall view showing project vines and programming stickers on the courtyard wall](docs/images/wall-page.jpg)

Pixel Agent Garden reads local agent traces from disk, normalizes them into one
Rust event model, and renders project growth as an ambient pixel courtyard. Each
project becomes a vine; tokens, sessions, cache activity, and recent work shape
the wall, unlock courtyard objects, and add seasonal details. It sends no
telemetry, makes no scan/render network calls, and never writes to source agent
directories.

The current app is a full-window Tauri garden with a tabbed local data drawer,
bilingual UI, tray watcher, share drawer, weekly recap and year-review cards,
one-click local Postcard export, and a small "While you were away" summary when
projects grow between visits.

## Why

- **Private by design** — only local files are read; source agent directories
  are treated as read-only, and scan/render paths do not call remote services.
- **One model, many agents** — Claude Code, Claude Cowork, Codex, and a manual
  JSONL escape hatch all normalize into the same `AgentEvent`.
- **A garden, not a dashboard** — an ambient, glanceable view of where your
  agent time actually goes.

## Highlights

- **Living pixel garden** — local time, season, tokens, sessions, cache ratio,
  and recent activity all affect the scene.
- **Agent nursery** — multi-agent gardens automatically show which local
  sources tended the garden recently, using the same local source-token rollups
  as the Composition tab; the layer can still be disabled in settings.
- **Insight without telemetry** — rank projects, distinguish same-name folders,
  inspect local cost estimates, and export daily project-token data without a
  server.
- **Share artifacts** — export the current scene to a local PNG, open a Monday
  weekly recap card, or generate a year-to-date review card entirely from local
  summaries.
- **Return diff** — when you come back, the garden shows what grew since the
  last viewed snapshot.
- **CLI + desktop** — use the terminal wall and usage commands, or keep the
  Tauri app open with tray actions and live watcher updates.

## Install

Grab the latest build for your platform from the
[Releases page](https://github.com/DipsySu/pixel-agent-garden/releases):
Code signing status and release signing rules are documented in the
[Code Signing Policy](docs/code-signing-policy.md).

- **macOS** — the `.dmg` build attached to the release. Builds are currently
  **unsigned**, so on first launch right-click the app and choose _Open_ (or
  allow it under System Settings → Privacy & Security). See
  [Unsigned Install Notes](docs/unsigned-installs.md).
- **Linux** — `.AppImage` (make it executable: `chmod +x *.AppImage`) or the
  `.deb` package.
- **Windows** — the NSIS `*-setup.exe` installer. SmartScreen may warn on an
  unsigned installer; choose _More info → Run anyway_. See
  [Unsigned Install Notes](docs/unsigned-installs.md).

On first run the app scans your local agent directories and writes a cache to
`~/.local-agent-garden/`. The tray icon gives you _Scan Now_, show/hide, open
settings, and quit.

## Adapters

- `antigravity`: Antigravity CLI conversation index at
  `~/.gemini/antigravity-cli/` (read-only summary index plus the CLI's
  `cache/last_conversations.json` and per-conversation SQLite stores;
  session-level activity only, with no token estimates)
- `claude-code`: `~/.claude/projects/**/*.jsonl`
- `claude-cowork`: Claude Desktop Cowork local agent sessions under
  `~/Library/Application Support/Claude/local-agent-mode-sessions/`
- `cline`: current SDK sessions under `~/.cline/data/db/sessions.db` and
  `~/.cline/data/sessions/`, plus legacy CLI/shared and VS Code-family task
  directories (per-turn/request, deleted-history, and subagent usage; no
  text-based token estimates)
- `codex`: `~/.codex/state_5.sqlite`, `~/.codex/session_index.jsonl`, and
  Codex rollout JSONL files when present
- `copilot-cli`: GitHub Copilot CLI session logs under
  `~/.copilot/session-state/*/events.jsonl` (API-reported per-session token
  totals split by source model; multi-day cumulative totals stay in lifetime
  usage but are not assigned to a fabricated daily bucket)
- `cursor`: Cursor foreground/local conversation indexes under its platform
  `User/globalStorage` and `User/workspaceStorage` roots (activity only; draft,
  background/cloud, transcript body, checkpoint blob, and token estimates are
  excluded)
- `gemini-cli`: Gemini CLI recorded chats under `~/.gemini/tmp/<project>/chats/`
  (legacy/API-key/Vertex/Standard/Enterprise coverage; API-reported per-message
  usage including cached and thinking tokens)
- `goose`: Goose `sessions/sessions.db` under the platform data directory
  (read-only per-inference usage ledger with cache splits, model, recorded cost,
  cost source, and compaction flag; legacy JSONL cumulative totals supported)
- `kiro`: Kiro CLI session metadata under `~/.kiro/sessions/cli/`, plus
  compatible `conversations_v2` indexes when present (activity only; transcript
  JSONL, conversation values, shell history, auth state, and token-looking
  private fields are excluded)
- `opencode`: OpenCode local store under `$XDG_DATA_HOME/opencode/` (default
  `~/.local/share/opencode/`)
  (SQLite and older JSON layouts; per-message tokens, cache splits, and cost)
- `qwen-code`: Qwen Code recordings under
  `~/.qwen/projects/*/chats/*.jsonl`, with legacy `~/.qwen/tmp/*/chats/`
  compatibility (source-reported per-message usage with cache and thinking
  metadata; forked history is not counted twice)
- `manual-jsonl`: optional local JSONL import for agents before native adapters
  exist

## Build from source

Install Rust 1.85+ and the Tauri 2 CLI:

```bash
cargo install tauri-cli --version "^2.0" --locked
```

Run the desktop app in development mode:

```bash
cd crates/tauri-app
cargo tauri dev
```

Produce distributable bundles for the current platform:

```bash
cd crates/tauri-app
cargo tauri build      # artifacts under target/release/bundle/
```

Use the Rust CLI directly:

```bash
cargo run --release -p local-agent-garden-cli -- adapters
cargo run --release -p local-agent-garden-cli -- adapters --json --watch-paths
cargo run --release -p local-agent-garden-cli -- doctor
cargo run --release -p local-agent-garden-cli -- doctor --json
cargo run --release -p local-agent-garden-cli -- scan --out ~/.local-agent-garden/events.json
cargo run --release -p local-agent-garden-cli -- projects
cargo run --release -p local-agent-garden-cli -- inspect --project demo-pay
cargo run --release -p local-agent-garden-cli -- usage
cargo run --release -p local-agent-garden-cli -- usage --date yesterday --json
cargo run --release -p local-agent-garden-cli -- garden
cargo run --release -p local-agent-garden-cli -- export-web --out web/data/garden-summary.json
```

Preview the web garden fallback in a browser (reads
`web/data/garden-summary.json`, no Tauri runtime):

```bash
python3 -m http.server 8765
# then open http://127.0.0.1:8765/web/index.html
```

If a local install behaves unexpectedly, run:

```bash
agent-garden doctor
agent-garden doctor --json
```

The doctor report checks only local state: state-dir writability,
`settings.toml`, `prices.json`, `events.json`, `rings.json`, and adapter
discovery. It does not scan source logs or call the network. Home-directory
paths are shortened to `~`, but review the report before sharing it.

## Manual JSONL Format

Use this for Aider or any source before a native adapter is added:

```json
{"source":"aider","timestamp":"2026-05-27T09:00:00Z","project_path":"/repo","session_id":"s1","input_tokens":1200,"output_tokens":400,"tool_calls":3}
```

Every field is optional except `source` and `timestamp`; unknown fields are
ignored.

Native adapter contributions should start with
[`docs/23-adapter-development-guide.md`](docs/23-adapter-development-guide.md).
When requesting support for a new agent, attach redacted local path patterns
and the output of `agent-garden adapters --json --watch-paths`.

## Model Price Overrides

Cost estimates use bundled model defaults plus your local override file at
`~/.local-agent-garden/prices.json`. In the desktop app, choose **Garden → Open
Model Prices** (or the same item in the tray menu). The app creates an empty
override table when the file does not exist; add only models you want to pin:

```json
{
  "schema_version": 2,
  "prices": {
    "my-provider/my-model": {
      "input_per_mtok": 1.25,
      "output_per_mtok": 5.0,
      "cache_read_per_mtok": 0.125,
      "cache_write_per_mtok": 1.25
    }
  }
}
```

Rates are USD per million tokens and match exact model ids. Unknown models stay
unpriced; the app never guesses. Deleting an override restores the bundled
default for that model. GPT-5.6 Sol, Terra, and Luna standard short-context
rates are included in the current default snapshot; see
[`docs/25-model-pricing-refresh.md`](docs/25-model-pricing-refresh.md) for source
and cache-pricing notes.

## Architecture

```text
local agent files
      |
      v
crates/core/src/adapters/*  ->  AgentEvent
      |
      v
crates/core/src/aggregate.rs  ->  GardenSummary
      |
      +--> crates/cli/src/ascii_wall.rs
      |
      +--> Tauri commands / watcher
      |
      +--> web/data/garden-summary.json -> web/index.html
```

The important boundary is the adapter contract: UI code never knows whether an
event came from Claude Code, Claude Cowork, Codex, or a future local agent. See
[`docs/architecture.md`](docs/architecture.md) and the
[runtime spec](docs/11-tauri-rust-rewrite-spec.md) for details.

## Privacy

- No network requests at scan or render time.
- No analytics, no telemetry.
- Source agent directories are read-only; the only writes go to
  `~/.local-agent-garden/`.
- Postcard export writes a local PNG only; it does not upload or call a remote
  service.

## Status

Rust is the only runtime for product code. `assets/` is the canonical sprite
source; `web/assets/` is generated by the Tauri build script and is not
committed. Locale-aware UI, Garden Postcard, return diff, tray/menu, watcher,
CI, and release workflows are in place. See [`CHANGELOG.md`](CHANGELOG.md) for
recent work.

## 中文

一个由本机 AI agent 活动长出来的私有桌面花园。

![Pixel Agent Garden：夜间庭院、项目藤蔓、季节光点、亭子，以及本地优先控制区](docs/images/garden.png)

### 视觉模式

应用包含两种完全本地的视觉模式。2.5D 庭院是默认的 ambient view，适合常驻桌面；
Wall 视图保留最初的藤蔓墙语言：项目增长从墙沿垂下，编程贴纸标记花园里的工具和技术生态，
砖墙表面则像一张更直接的本地 agent 活动地图。

![Pixel Agent Garden Wall 视图：庭院墙上的项目藤蔓和编程贴纸](docs/images/wall-page.jpg)

Pixel Agent Garden 从磁盘读取本机 agent 记录，把它们规范化成同一个 Rust
事件模型，然后渲染成一个安静的像素庭院。每个项目是一根藤蔓；token、session、
cache 活动和近期活跃度会影响墙面、生长状态、庭院物件和季节细节。它不做遥测，
scan/render 路径不发网络请求，也不会写入源 agent 目录。

当前 app 已经是全窗口 Tauri 花园：包含 tabbed 本地数据抽屉、双语 UI、托盘 watcher、
分享抽屉、上周周报卡、年度回顾卡、一键本地导出 Garden Postcard，以及当项目在两次查看之间增长时出现的
“你不在的时候”摘要。

### 为什么做

- **隐私优先** — 只读取本地文件；源 agent 目录只读；scan/render 路径不会访问远程服务。
- **一个模型，多个 agent** — Claude Code、Claude Cowork、Codex，以及 manual JSONL
  入口都会归一化成同一个 `AgentEvent`。
- **花园，不是仪表盘** — 它是一个安静、可瞥一眼的空间，用来看到你的 agent 时间流向哪里。

### 亮点

- **会生长的像素花园** — 本地时间、季节、token、session、cache ratio 和近期活跃度
  都会影响画面。
- **Agent 苗圃** — 可选开启的庭院层,用和“构成”页相同的本机 source-token
  数据展示最近是哪类 agent 在照料庭院。
- **本地 Insight** — 排名项目、区分同名目录、查看本地成本估算，并导出按项目拆分的每日 token 数据。
- **分享产物** — 把当前场景导出成本地 PNG，生成完全来自本机 summary 的周一回顾卡，
  或导出 year-to-date 年度回顾卡。
- **回来摘要** — 再次打开时，只在项目增长后显示“你不在的时候”变化。
- **CLI + 桌面端** — 可以用终端 ASCII 墙和 usage 命令，也可以常驻 Tauri app，
  通过托盘和 watcher 自动更新。

### 安装

从 [Releases 页面](https://github.com/DipsySu/pixel-agent-garden/releases)
下载对应平台的最新构建：
代码签名状态和 release 签名规则见
[Code Signing Policy](docs/code-signing-policy.md)。

- **macOS** — 下载 release 附带的 `.dmg`。当前构建还没有签名；首次启动时右键 app
  选择 _Open_，或在 System Settings → Privacy & Security 里允许打开。详见
  [未签名安装说明](docs/unsigned-installs.md)。
- **Linux** — 下载 `.AppImage`（先执行 `chmod +x *.AppImage`）或 `.deb` 包。
- **Windows** — 下载 NSIS `*-setup.exe` 安装器。未签名安装器可能触发 SmartScreen；
  如果信任该 release，选择 _More info → Run anyway_。详见
  [未签名安装说明](docs/unsigned-installs.md)。

首次运行时，应用会扫描本地 agent 目录，并把缓存写到 `~/.local-agent-garden/`。
托盘菜单提供 _Scan Now_、显示/隐藏窗口、打开设置和退出。

### 适配器

- `antigravity`: Antigravity CLI 的会话索引
  `~/.gemini/antigravity-cli/`（只读解析 summary index、CLI 的
  `cache/last_conversations.json` 与逐会话 SQLite；只统计 session-level
  真实活动，不估算 token）
- `claude-code`: `~/.claude/projects/**/*.jsonl`
- `claude-cowork`: Claude Desktop Cowork 本地 agent sessions，
  位于 `~/Library/Application Support/Claude/local-agent-mode-sessions/`
- `cline`: 当前 SDK 的 `~/.cline/data/db/sessions.db` 与
  `~/.cline/data/sessions/`，并兼容旧 CLI/shared 及 VS Code 系编辑器 task
  目录（逐 turn/request、已删除历史和 subagent 的真实用量；不按文本长度
  估算 token）
- `codex`: `~/.codex/state_5.sqlite`、`~/.codex/session_index.jsonl`，
  以及存在时的 Codex rollout JSONL 文件
- `copilot-cli`: GitHub Copilot CLI 会话日志，位于
  `~/.copilot/session-state/*/events.jsonl`（API 上报的会话级 token 总量;
  按源端 model 独立统计;跨日累计总量保留在全量统计中，不伪造每日归属）
- `cursor`: Cursor 平台 `User/globalStorage` 与 `User/workspaceStorage` 下的
  本地前台会话索引（仅统计真实活动;排除草稿、background/cloud、聊天正文、
  checkpoint blob 与 token 猜测）
- `gemini-cli`: Gemini CLI 保存的对话，位于 `~/.gemini/tmp/<project>/chats/`
  （legacy/API key/Vertex/Standard/Enterprise 覆盖;API 上报的逐消息用量，
  含缓存与思考 token）
- `goose`: 平台数据目录中的 Goose `sessions/sessions.db`（只读解析逐次
  usage ledger，包含 cache 拆分、model、源端 cost、cost source 与 compaction；
  同时兼容 legacy JSONL 累计总量）
- `kiro`: Kiro CLI 的 `~/.kiro/sessions/cli/` session metadata，并兼容存在时
  的 `conversations_v2` 索引（仅统计真实活动;不读 transcript JSONL、会话
  value、shell history、auth state，也不采用语义未证实的 token 字段）
- `opencode`: OpenCode 本地存储，位于 `$XDG_DATA_HOME/opencode/`（默认
  `~/.local/share/opencode/`）
  （SQLite 与旧版 JSON 布局;逐消息 token、缓存拆分与成本）
- `qwen-code`: Qwen Code 的 `~/.qwen/projects/*/chats/*.jsonl`，并兼容
  legacy `~/.qwen/tmp/*/chats/`（源端逐消息 usage，包含 cache 与 thinking
  metadata；fork 继承历史不会重复计数）
- `manual-jsonl`: 在原生 adapter 支持之前，用于 Aider 等来源的本地 JSONL 入口

### 从源码构建

安装 Rust 1.85+ 和 Tauri 2 CLI：

```bash
cargo install tauri-cli --version "^2.0" --locked
```

运行桌面开发版：

```bash
cd crates/tauri-app
cargo tauri dev
```

为当前平台生成安装包：

```bash
cd crates/tauri-app
cargo tauri build      # 产物在 target/release/bundle/
```

直接使用 Rust CLI：

```bash
cargo run --release -p local-agent-garden-cli -- adapters
cargo run --release -p local-agent-garden-cli -- adapters --json --watch-paths
cargo run --release -p local-agent-garden-cli -- doctor
cargo run --release -p local-agent-garden-cli -- doctor --json
cargo run --release -p local-agent-garden-cli -- scan --out ~/.local-agent-garden/events.json
cargo run --release -p local-agent-garden-cli -- projects
cargo run --release -p local-agent-garden-cli -- inspect --project demo-pay
cargo run --release -p local-agent-garden-cli -- usage
cargo run --release -p local-agent-garden-cli -- usage --date yesterday --json
cargo run --release -p local-agent-garden-cli -- garden
cargo run --release -p local-agent-garden-cli -- export-web --out web/data/garden-summary.json
```

用浏览器预览 web fallback（读取 `web/data/garden-summary.json`，不依赖 Tauri runtime）：

```bash
python3 -m http.server 8765
# 然后打开 http://127.0.0.1:8765/web/index.html
```

如果本地安装状态异常，先运行：

```bash
agent-garden doctor
agent-garden doctor --json
```

doctor 报告只检查本地状态：state 目录是否可写、`settings.toml`、
`prices.json`、`events.json`、`rings.json` 和 adapter discovery。它不会扫描源日志，
也不会访问网络。home 目录路径会缩短成 `~`，但分享前仍应自行复核。

### Manual JSONL 格式

Aider 或任何还没有原生 adapter 的来源，都可以先用这个格式接入：

```json
{"source":"aider","timestamp":"2026-05-27T09:00:00Z","project_path":"/repo","session_id":"s1","input_tokens":1200,"output_tokens":400,"tool_calls":3}
```

除了 `source` 和 `timestamp`，其他字段都是可选的；未知字段会被忽略。

原生 adapter 贡献从
[`docs/23-adapter-development-guide.md`](docs/23-adapter-development-guide.md)
开始。请求支持新 agent 时，请附上脱敏后的本地路径模式，以及
`agent-garden adapters --json --watch-paths` 输出。

### 模型价格配置

成本估算会合并内置默认价格和本机
`~/.local-agent-garden/prices.json`。在桌面 App 中选择 **Garden → 打开模型价格**
（托盘菜单也有同名入口）。文件不存在时，App 会先创建一个空的 override 表；只填写你确实想固定价格的模型：

```json
{
  "schema_version": 2,
  "prices": {
    "my-provider/my-model": {
      "input_per_mtok": 1.25,
      "output_per_mtok": 5.0,
      "cache_read_per_mtok": 0.125,
      "cache_write_per_mtok": 1.25
    }
  }
}
```

费率单位是每百万 token 的美元价格，并按精确 model id 匹配；未知模型保持“未计价”，
应用不会猜价格。删除某条 override 后，该模型会重新跟随内置默认值。当前默认快照已包含
GPT-5.6 Sol、Terra、Luna 的 standard short-context 费率；来源和 cache 计价边界见
[`docs/25-model-pricing-refresh.md`](docs/25-model-pricing-refresh.md)。

### 架构

```text
local agent files
      |
      v
crates/core/src/adapters/*  ->  AgentEvent
      |
      v
crates/core/src/aggregate.rs  ->  GardenSummary
      |
      +--> crates/cli/src/ascii_wall.rs
      |
      +--> Tauri commands / watcher
      |
      +--> web/data/garden-summary.json -> web/index.html
```

最重要的边界是 adapter contract：UI 不知道事件来自 Claude Code、Claude Cowork、
Codex，还是未来的新本地 agent。详情见 [`docs/architecture.md`](docs/architecture.md)
和 [runtime spec](docs/11-tauri-rust-rewrite-spec.md)。

### 隐私

- scan 或 render 时不发网络请求。
- 没有 analytics，没有 telemetry。
- 源 agent 目录只读；唯一写入位置是 `~/.local-agent-garden/`。
- Postcard 只写出本地 PNG，不上传，也不调用远程服务。

### 状态

Rust 是唯一产品运行时。`assets/` 是 sprite 源资产目录；`web/assets/` 由 Tauri
build script 生成，不提交进仓库。双语 UI、Garden Postcard、回来摘要、托盘/菜单、
watcher、CI 和 release workflows 都已就位。最近变更见 [`CHANGELOG.md`](CHANGELOG.md)。

# CLAUDE.md

Onboarding notes for AI coding assistants (Claude Code, Cursor, etc.). Humans
should start with [README.md](./README.md). This file is the AI's first stop.

## 一句话

Pixel Agent Garden 把本机 AI agent 活动(Claude Code / Cowork / Codex / …)
当作"数字庭院"渲染:Rust 读 local JSONL / SQLite → 规范化成 `AgentEvent`
→ 聚合成 `GardenSummary` → CLI 出 ASCII 墙,Tauri + web/ 出像素花园。
**零网络、零遥测、不写源目录。**

## 必读(按顺序)

1. **[docs/11-tauri-rust-rewrite-spec.md](./docs/11-tauri-rust-rewrite-spec.md)** — 这是合同。Adapter 契约、模块化铁律、phase 计划、schema versioning 都在这里。改架构前先回这里。
2. **[docs/architecture.md](./docs/architecture.md)** — 数据流图 + adapter 添加步骤。
3. **[RUST.md](./RUST.md)** — workspace 速查 + watcher 链路图(中文)。
4. **[README.md](./README.md)** — 用户视角的 CLI/Tauri 跑法。
5. **[CHANGELOG.md](./CHANGELOG.md)** — 最近的改动语义(commit 之外的人话版本)。

## Workspace 一览

```
crates/
├── core/        ← 纯库,无 UI / IPC 依赖。Adapter trait + scan + aggregate + settings + storage 都在这里
│   └── src/adapters/{claude_code,claude_cowork,codex,manual_jsonl,util}.rs
├── cli/         ← `agent-garden` 二进制(clap)
└── tauri-app/   ← 桌面 shell + file watcher + Tauri commands
web/             ← 静态前端(原生 HTML/CSS/JS,无构建步骤)
assets/sprites/  ← 像素艺术原资产(唯一来源)
docs/            ← spec + architecture + sprite-rendering
```

不应该出现的地方:
- `crates/core/` 里出现 `tauri::` / `wry::` / web API
- `crates/` 里出现 JS / TS
- 任何地方出现 Python(已删除,不要复活)

## 常用命令

```bash
# 全工作区测试(46+ 测试,应该 100% 过)
cargo test --workspace

# lint + fmt(提 PR / commit 前必跑)
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings

# CLI 子命令(release 模式快很多)
cargo run --release -p local-agent-garden-cli -- adapters
cargo run --release -p local-agent-garden-cli -- scan --out ~/.local-agent-garden/events.json
cargo run --release -p local-agent-garden-cli -- garden       # ASCII 墙
cargo run --release -p local-agent-garden-cli -- usage        # daily usage

# 桌面 app(hot reload)
cd crates/tauri-app && cargo tauri dev

# watcher 详细日志
AGENT_GARDEN_DEBUG=1 cargo tauri dev

# 前端在浏览器降级模式预览(读 web/data/garden-summary.json)
python3 -m http.server 8765
# 然后访问 http://127.0.0.1:8765/web/index.html
```

注意 cargo / tauri CLI 在 `~/.cargo/bin/`。如果 `cargo` 找不到,
`export PATH=$HOME/.cargo/bin:$PATH`。

## 添加新 Adapter

`docs/architecture.md` 写了详细步骤。简版:

1. 新文件 `crates/core/src/adapters/<name>.rs`,实现 `Adapter` trait(name / discover / collect / 可选 watch_paths)
2. 在 `crates/core/src/adapters/mod.rs` 声明 `pub mod <name>;`
3. 在 `crates/core/src/registry.rs` 的 `default_adapters()` 里加一行
4. **必须**写 fixture-based 测试(`#[cfg(test)] mod tests`),不能跑全工作区扫描。参考 `claude_cowork::tests` 的临时目录写法
5. Source-specific 字段塞 `AgentEvent.metadata: BTreeMap<String, Value>`,别污染顶层

## Modularity 铁律(spec §10)

违反任何一条 → 改回去。

1. `core` 不准 import `tauri::` / `wry::` / web 类型
2. Adapter 之间不互相调用。跨 adapter 的逻辑(dedupe、合并)放 `scan.rs`
3. CLI / Tauri command 是薄壳,业务逻辑在 `core`
4. Watcher 对 core 无知,只看 `Vec<PathBuf>`,不解析任何 agent 文件
5. JS 只住 `web/`
6. 公开 Rust API 返回 typed `Error`(enum),不要 `Box<dyn Error>`

## 数据 schema

`GardenSummary` 和 `EventsCache` 都带 `schema_version: u32`(当前 `1`,
见 [`aggregate::SCHEMA_VERSION`](crates/core/src/aggregate.rs))。
**任何改 on-disk JSON shape 的改动都要 bump 这个常量**。reader 看到比自己高的版本会拒绝缓存。

时间戳一律 `DateTime<Utc>`。前端用 `last_seen?.toISOString()` 等。

## 隐私契约(不要破坏)

- **绝对不发网络请求**(扫描 / 渲染都不行)
- **绝对不写源 agent 目录**(`~/.claude/projects/` 等是只读)
- 缓存只写 `~/.local-agent-garden/`
- 没有 telemetry、analytics
- 浏览器降级模式不应 invoke Tauri API(用 `isTauriRuntime()` 判断)

## Settings UI / Tauri events

| Event | When | Payload |
|---|---|---|
| `garden:updated` | watcher 触发的扫描完成 | `GardenSummary` |
| `garden:error` | watcher / scan / settings 失败 | `{ source, message, adapter? }` |
| `garden:scanning` | (保留)未来的进度信号 | `{ adapter? }` |

前端订阅在 [`web/data-source.js`](web/data-source.js):
`subscribeGardenUpdates` / `subscribeGardenErrors`。

Settings 写盘走 `set_settings` 命令(防抖 300ms),`auto_rescan` 切到 false
不会停 watcher,只是前端忽略 `garden:updated`。

## Commit / PR 风格

最近的 commit 格式(参考 `git log --oneline -8`):

```
feat: implement schema_version per spec

Spec §Schema Versioning was written but never wired up — `GardenSummary`
and `events.json` lacked the version field, so any future cache-format
change would be misread instead of refused.

- ...
- ...

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
```

- 标题用英文 conventional commit (`feat:` / `fix:` / `chore:` / `docs:`)
- body 解释 **why** 多于 **what**
- AI 协作的 commit 加 `Co-Authored-By:` 行(参考工具的输出)
- 不要 `--no-verify` 跳过 hook

## 代码风格 hint

- 代码注释 / commit / spec 用英文,UI 文案和 RUST.md / CHANGELOG 用中文
- Rust 用 thiserror 的 enum Error,**不要** anyhow
- 文档注释解释**为什么**(理由 / spec 引用 / 失败模式),不要复读签名
- 测试用 fixture 风格(临时目录 + 写 JSON 字符串),不要依赖真实 home 目录
- 前端 JS 没有打包器,所有文件直接被 `<script type="module">` 引用,**不能**用 TS / JSX / 第三方 npm 包

## 当前阶段

`CHANGELOG.md` 的 `## Unreleased` 反映最新工作。Phase 1/2 完工,Phase 3 进行中:

- ✅ Settings 内嵌面板 + 错误 toast + schema versioning
- ⏳ 系统菜单 / 状态栏 / Tray
- ⏳ 签名打包(macOS DMG / Windows MSI / Linux AppImage)
- ⏳ CI/CD(GHA matrix + Tauri updater)

## 如果你不确定

- 改 adapter 行为前看 `docs/architecture.md` 的"Adapter Contract"
- 改 on-disk JSON 形状前看 `docs/11-tauri-rust-rewrite-spec.md` §Schema Versioning
- 改 UI 文案前看 `web/index.html` 现有占位约定(中文 UI)
- 没把握的设计取舍 → 先问用户,不要默默选边

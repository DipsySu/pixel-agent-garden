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

## 设计约束(代码结构 / 解耦 / 扩展)

上面 6 条是**红线**;这一节是**设计哲学**。两者互补:铁律告诉你"不能做什么",
这里告诉你"该往哪种形状写"。改代码前先对照一下。

### 1. 单向数据流

源 → `AgentEvent` → `GardenSummary` → UI。**这个流向不能反**:
- UI 不能改 `AgentEvent` 的 schema 假设
- `scan.rs` / `aggregate.rs` 不能往源目录回写(隐私契约也禁了)
- adapter 不能依赖前端形状(比如不能在 adapter 里塞"前端用的颜色")

如果某个改动需要"下游回头查上游",大概率抽象切错了——先回去把边界修对。

### 2. 关注点分离 = 文件分工

一个文件**只干一件事**。这个项目已有的好范例:

| 文件 | 唯一职责 |
|---|---|
| `crates/core/src/adapters/<name>.rs` | 读一种 source,产 `AgentEvent` |
| `crates/core/src/scan.rs` | 跨 source 编排 + dedupe |
| `crates/core/src/aggregate.rs` | event → project summary 的纯数学 |
| `crates/core/src/storage.rs` | events.json 的读写 + schema version |
| `crates/core/src/settings.rs` | settings.toml 的读写 |
| `crates/tauri-app/src/watcher.rs` | 文件变化 → 触发 rescan(不解析任何文件内容) |
| `crates/tauri-app/src/commands.rs` | Tauri 命令薄壳,业务调用 core |
| `web/data-source.js` | 数据访问层(Tauri / fetch 抽象) |
| `web/settings-panel.js` | 设置 UI(只管渲染 + 派发 onChange) |
| `web/render-*.js` | 渲染层,纯函数(数据 → DOM) |

**如果一个文件同时干两件事,拆开它。** 例如:不要在 `watcher.rs` 里解析 JSONL;
不要在 adapter 里调别的 adapter;不要在 `render-svg.js` 里发 Tauri invoke。

### 3. 可替换性(Substitutability)

任何**具体实现**应该可以被换掉,caller 不需要动:

- 换底层 watcher 库(`notify` → 别的)?只改 `watcher.rs`
- 换 settings 持久化(TOML → JSON / SQLite)?只改 `settings.rs`,public API 不变
- 删 `claude-cowork` adapter?删文件 + registry 摘一行,**零**其他文件影响
- 换错误 toast 实现?只改 `error-toast.js`,`data-source.js` 不变

**"删一个模块要改 N 个文件" = 抽象漏了。** 先把抽象修对再做改动,
不要图省事就让 caller 知道实现细节。

### 4. 扩展性 = 默认值 + 可选

新增能力**不应破坏现有调用方**。已有的几个好模式:

- `Settings` 全部字段 `#[serde(default)]`,加新字段时老 config 文件继续 work
- `AgentEvent.metadata: BTreeMap<String, Value>` 收 source 特有字段,不污染顶层
- `schema_version` 兜底字段语义不兼容的变更
- Adapter trait 用 `Vec<PathBuf>` 而不是 `&[&str]`,新 adapter 想返回啥都行

加一个 `Option<T>` 字段比之后回头改 trait 容易;加一个新 method 加 default 实现
比要求所有 impl 同步改容易。**为兼容留口子,别为兼容留架构。**

### 5. 奥卡姆 / 不过度抽象

没有用户场景就不抽象:

- adapter trait 现在 4 个 impl,所以值得抽象;**只剩 1 个时把 trait 删了直接写函数**
- "为以后预留扩展点"几乎总是错的——以后真有需要时再抽,YAGNI
- `Vec<Box<dyn Adapter>>` 就够了,不需要 "PluginManager" / "AdapterRegistryBuilder" / 等
- `Settings` 是 struct 不是 `HashMap<String, dyn Any>`——结构化 + serde 就行
- 不要为了"灵活"加 trait object,如果当前只有一个实现就用具体类型

### 6. 测试也要解耦

- 每个 adapter 的测试**只测自己**,用 fixture(临时目录 + 写 JSON 字符串),
  不依赖真实 home 目录,不依赖其他 adapter
- 跨 adapter 的行为(dedupe)测在 `scan.rs` 的测试里,不在 adapter 里
- 测试**不**应该 mock `chrono::Utc::now`——用 `summarize_at(events, now)` 这种
  参数化的接口,把"现在"明确传进去
- 看到一个测试要 mock 多个东西才能跑,大概率是被测代码耦合过紧的信号

### 7. 改动前的 checklist

提交前自问:

- [ ] 这个改动**最多触及几个文件**?如果 > 5,边界对吗?
- [ ] 我有没有让 `core` 知道 UI 的存在?(import 检查)
- [ ] 我加的字段是不是 `#[serde(default)]` / `Option<T>`?(兼容性)
- [ ] 如果将来要**删**这个功能,是改一处还是 N 处?
- [ ] 我有没有为"以后可能"做抽象?如果是,**删掉它**,以后真需要时再抽
- [ ] 测试是不是只依赖被测模块?有没有偷偷拉进真实 home / 真实网络?

## 数据 schema

`GardenSummary` 和 `EventsCache` 各带独立的 `schema_version: u32`:
summary 用 [`aggregate::SUMMARY_SCHEMA_VERSION`](crates/core/src/aggregate.rs)(当前 `4`),
events 缓存用 [`storage::EVENTS_SCHEMA_VERSION`](crates/core/src/storage.rs)(当前 `1`)。
两者分开,好处是 summary 形状演进不会作废已缓存的原始 events。
**任何改对应 on-disk JSON shape 的改动都要 bump 对应常量**。reader 看到比自己高的版本会拒绝缓存。

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

- 代码注释 / commit / spec 用英文；UI 文案走 `web/i18n.js` 的 en/zh 双语层；
  RUST.md / CHANGELOG 以中文为主
- Rust 用 thiserror 的 enum Error,**不要** anyhow
- 文档注释解释**为什么**(理由 / spec 引用 / 失败模式),不要复读签名
- 测试用 fixture 风格(临时目录 + 写 JSON 字符串),不要依赖真实 home 目录
- 前端 JS 没有打包器,所有文件直接被 `<script type="module">` 引用,**不能**用 TS / JSX / 第三方 npm 包

## 当前阶段

`CHANGELOG.md` 的 `## Unreleased` 反映最新工作。Phase 1/2 完工,Phase 3/公开发布
路径大部分落地:

- ✅ Settings 内嵌面板 + 错误 toast + schema versioning
- ✅ 系统菜单 / 状态栏 / Tray(含 "Top Token Projects" 子菜单 + Scan Now)
- ✅ CI/CD GHA matrix(rustfmt + clippy + test,mac/win/linux,MSRV 1.85)
- ✅ Token Insight(per-day `daily_tokens`、sparkline、Insight 面板、core 端 `size_level`/`size_strength`)
- ✅ 打包产物(`tauri-action` 出 dmg / deb+AppImage / NSIS,`release.yml` 发真 Release)
- ✅ 公开发布信任底座(LICENSE / PRIVACY.md / 锁 CSP / CI zero-network gate)
- ✅ 双语 UI、Garden Postcard、本地 return diff、README 新截图和公开文案
- ⚠️ 下一个 Release 前必须桌面验证 CSP + Postcard 原生保存
- ⏳ 代码签名(目前是 unsigned bundle)
- ⏳ Tauri updater(自动更新尚未接线)

最近的零散修复见 `## Unreleased`:路径归一化/推测路径标记、Insight 同名消歧、
深色滚动条、`.gitattributes`、发布信任加固、Postcard、return diff、README 刷新。

## 如果你不确定

- 改 adapter 行为前看 `docs/architecture.md` 的"Adapter Contract"
- 改 on-disk JSON 形状前看 `docs/11-tauri-rust-rewrite-spec.md` §Schema Versioning
- 改 UI 文案前看 `web/index.html` 现有占位约定(中文 UI)
- 没把握的设计取舍 → 先问用户,不要默默选边

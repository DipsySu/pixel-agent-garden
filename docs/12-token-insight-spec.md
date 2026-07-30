# Token Insight Spec / Token 消耗可视化规格

> Status / 状态: Implemented. Token Insight shipped first; launcher integration
> later shipped as its own phase.
> Scope this pass / 本轮范围: **make the data honest, then surface it gently.**
> 先让数据诚实,再让 UI 轻轻露出来。
> Builds on [11-tauri-rust-rewrite-spec.md](./11-tauri-rust-rewrite-spec.md)
> (runtime contract) and [architecture.md](./architecture.md) (data flow).
> 先读 11 号(运行时合同)和 architecture(数据流)。

> Bilingual convention / 双语约定: code, field names, commits stay English; prose
> is English then 中文. 代码、字段名、commit 保持英文;正文先英文后中文。

## Why this is worth doing / 为什么值得做

The garden answers "which project is thriving"; it does **not** answer "where did
my tokens actually go lately". For a local agent tool that second question
matters, and it is the layer the garden is missing.
花园回答的是"哪个项目长得旺",但回答不了"我最近到底把 token 花在哪了"。对本地 agent 工具来说,
第二个问题很重要,而这正是花园缺的一层。

But it must **not** become a dashboard. The product's correct instinct: exact
numbers are one gesture away, never permanently pinned on screen.
但它**绝不**能变成 dashboard。产品的正确直觉是:精确数字一个动作可达,绝不常驻压屏。

## Goals / 目标

(All four shipped as of schema v3 / 四项均已落地,schema v3。)

- ✅ Make daily token data **honest** (true tokens, not an activity proxy).
  让每日 token 数据**诚实**(真 token,不是活动代理量)。
- ✅ Provide a reusable `core` ranking primitive (`top_by_tokens`).
  在 `core` 提供可复用的排名原语 `top_by_tokens`。
- ✅ Surface insight **gently**: a 14-day sparkline in the existing info card + a
  restrained, opt-in insight panel. 轻量露出:信息卡里加 14 天 sparkline + 一个克制的、点开才有的 insight 面板。
- ✅ Consolidate the token→sprite size mapping from JS into testable `core` rules
  (`size_level` / `size_strength`).
  把 token→植株大小的映射从 JS 收敛成 `core` 里可测的规则(`size_level` / `size_strength`)。

## Non-Goals (this pass) / 本轮非目标

- **No tray top-N, no open-in-terminal.** Deferred to a separate "launcher
  integration" phase (see Deferred). 不做 tray top-N、不做点击进终端,留给后续 launcher 阶段。
- **No full GitHub-size calendar heatmap** dropped into the garden. Start with a
  sparkline. 不在花园里塞整块 GitHub 日历;先做 sparkline。
- No new adapter, no network, no telemetry, no writes to source dirs.
  不新增 adapter、不联网、不 telemetry、不写源目录。
- No per-model / per-tool breakdown UI. 不做 per-model / per-tool 拆分 UI。

## Already implemented (do not rebuild) / 现状已具备(别重造)

Most of "garden hover token insight" already exists; this pass is **consolidation,
not a new feature**. "花园 hover token insight" 大半已做,本轮是**收敛而非新功能**:

- One vine per project; **all** projects shown, not just top 6.
  每项目一根藤;**全部**项目都展示,不止 top 6。
- hover / focus info card already shows project name, tokens, stage, cache, etc.
  hover/focus 信息卡已显示项目名、token、阶段、cache 等。
- bottom chip already shows project name + token number. 底部 chip 已有项目名 + token 数。
- vine size already maps to the token distribution. 藤蔓大小已按 token 分布映射。

So Surface A's job here is to **extract the token bucketing / size mapping out of
JS into an explicit, testable `core` rule** — not to add hover UI.
所以 Surface A 这轮的活是**把 token 分桶 / 大小映射从 JS 抽成明确、可测的 `core` 规则**,而不是加 hover UI。

## The Long-Tail Problem / 长尾问题(贯穿约束)

Token consumption is heavy-tailed: one project can be 3-4 orders of magnitude
larger than another (hundreds of M vs tens of K). A linear cross-project bar
collapses small projects into invisible slivers.
Token 消耗重尾:项目间可差 3~4 个数量级(上亿 vs 几十 K)。线性跨项目条会把小项目压成看不见的细线。

Rules baked in / 内化的规则:

- Ranking + formatted absolute numbers belong in display as **rank + K/M text**,
  not linear bars. 排名 + 格式化绝对数字用**序号 + K/M 文本**表达,不用线性条。
- Magnitude in the garden is the **vine size** (log-scaled / bucketed), not text.
  花园里数量级靠**藤蔓大小**(对数 / 分桶),不是文字。
- A sparkline / heatmap is each project's **own** series over time, so no
  cross-project scale is implied. sparkline / 热力图是单项目**自己**的时间序列,不隐含跨项目刻度。
- **sorting + magnitude math in `core`; number formatting + scale choice in the
  render layer; never a linear cross-project bar.** 排序与数量级运算在 `core`;
  数字格式化与刻度选择在渲染层;永不画线性跨项目条。

## Data Model / 数据模型

### The core problem: `daily_activity` is not tokens / 核心问题:`daily_activity` 不是 token

Today `daily_activity` is filled as / 现在 `daily_activity` 是这样填的:

```rust
// crates/core/src/aggregate.rs — this is ACTIVITY INTENSITY, not tokens
max(1, total_tokens / 1000 + tool_calls)
```

Using it for a "token heatmap" would be **dishonest**: a dark cell could mean a
high-`tool_calls` day, not a high-token day. The user would misread it.
拿它做"token 热力图"是**不诚实**的:格子深可能是 tool_calls 多的一天,不是 token 多的一天,会误导。

### Add new fields, do not reuse / 新增字段,不复用

```rust
pub struct ProjectGrowth {
    pub project_key: String,
    pub project_path: Option<String>,
    pub total_tokens: u64,
    pub daily_activity: BTreeMap<String, u64>,  // KEEP: activity intensity / 保留:活动强度
    pub daily_tokens: BTreeMap<String, u64>,    // NEW: honest per-day tokens / 新增:诚实的每日 token
    // ...
}

pub struct GardenSummary {
    // ...
    pub daily_tokens: BTreeMap<String, u64>,    // NEW: all-project per-day rollup / 新增:全项目按天汇总
    // (name `daily_totals` if clearer)
}
```

Both filled in `summarize_at` from real `AgentEvent.total_tokens`, summed by UTC
date. Pure, fixture-tested, no `Utc::now()` mocking.
两者都在 `summarize_at` 里用真实 `AgentEvent.total_tokens` 按 UTC 日期求和填充;纯函数、fixture 测试、不 mock `now()`。

### `top_by_tokens` is a `core` primitive, not a tray helper / 是 core 原语,不是 tray 专用

```rust
pub fn top_by_tokens(summary: &GardenSummary, n: usize) -> Vec<&ProjectGrowth>;
```

Sorting lives here. It serves the **insight panel, README/demo data, and a future
tray** — design it general, not tray-shaped. UI display format (K/M) stays
front-end. 排序在这。它服务 **insight 面板、README/demo 数据、以及未来的 tray**——按通用设计,
别按 tray 形状设计。UI 显示格式(K/M)留前端。

### Magnitude → sprite mapping / 数量级 → 植株映射 ✅ done

Done: the JS sizing logic is ported to `core` as `size_level: u8` (1..=5,
log-scaled) and `size_strength: f64` (0.0..=1.0, log mass + rank blend),
computed in `summarize_at` from the whole project distribution. The port is a
bit-exact replica of the former JS formula (Rust tests assert the JS reference
values), so rendering is unchanged. The frontend reads these two fields and maps
them to pixel width/opacity — those presentation details stay out of `core`. JS
keeps the identical formula as a fallback for summaries lacking the fields
(older caches / browser fallback data).
已完成:JS 尺寸逻辑搬到 `core`,新增 `size_level`(1..=5,对数)和 `size_strength`
(0..=1,对数质量 + 排名混合),在 `summarize_at` 里按全体项目分布计算。该移植与原 JS 公式
逐位一致(Rust 测试断言 JS 参考值),渲染不变。前端读这两个字段映射成像素宽度/透明度——
这些展示细节留在前端。JS 保留同一公式作为缺字段时的 fallback(老缓存 / 浏览器降级数据)。

## Schema Versioning — split the constant / Schema 版本——拆常量

Right now a single `SCHEMA_VERSION` (in `aggregate.rs`) is shared by **both**
`GardenSummary` and the `events.json` cache (`storage.rs::EventsCache`, which
rejects any cache whose version exceeds the reader's).
现在单个 `SCHEMA_VERSION`(在 `aggregate.rs`)被 `GardenSummary` 和 `events.json`
缓存(`storage.rs::EventsCache`,会拒绝版本高于自己的缓存)**共用**。

Bumping it for a summary-only additive field (`daily_tokens`) would also bump the
event cache version — semantically wrong, and could needlessly invalidate the
event cache on downgrade. **Split first:**
仅因 summary 加 additive 字段(`daily_tokens`)就 bump,会把事件缓存版本也带高——语义错,
还可能在降级时白白让事件缓存失效。**先拆:**

```rust
pub const EVENTS_SCHEMA_VERSION: u32 = 3;   // events.json / EventsCache
pub const SUMMARY_SCHEMA_VERSION: u32 = 2;  // GardenSummary (bumped for daily_tokens)
```

`storage.rs` checks `EVENTS_SCHEMA_VERSION`; `GardenSummary` carries
`SUMMARY_SCHEMA_VERSION`. New summary fields are `#[serde(default)]` so old
summaries still deserialize. This way summary shape can evolve without touching
event-cache compatibility. 这样 summary 形状可以演进而不动事件缓存兼容逻辑。

## Surface — gentle insight UI / 轻量 insight UI

MVP, in priority order / MVP,按优先级:

1. **14-day token sparkline in the project info card.** When a vine is
   hovered/focused, the existing card gains one line: a small sparkline of the
   last 14 days of `daily_tokens` for that project. Each project's own series →
   no long-tail issue. 信息卡里加一条"最近 14 天 token sparkline"。hover/focus 藤蔓时,
   既有卡片多一行:该项目近 14 天 `daily_tokens` 的小 sparkline。单项目自己的序列,无长尾问题。

2. **A restrained, opt-in "Insight" panel.** A small button (near the bottom
   chip or beside settings) opens a per-project token overview (ranked list via
   `top_by_tokens`, each project's sparkline). Closed by default; never auto-shown;
   does not alter the ambient garden. 一个克制的、点开才有的 "Insight" 按钮(底部 chip 旁或设置旁),
   打开每项目 token 概览(用 `top_by_tokens` 排名 + 各自 sparkline)。默认关闭、不自动弹、不破坏 ambient 花园。

Rendering / 渲染: new pure module `web/render-insight.js` (`data -> DOM`, no Tauri
invoke, no upstream mutation). Number formatting (K/M) in front-end, e.g.
`web/format.js`. 新纯模块 `web/render-insight.js`(纯函数、不 invoke Tauri、不改上游);K/M 格式化在前端。

A full GitHub-style calendar heatmap is a **later** enhancement of this panel, not
part of the MVP — a big calendar dropped into the garden breaks the mood.
整块 GitHub 日历是这个面板**以后**的增强,不进 MVP——大日历砸进花园会破坏氛围。

## Privacy / 隐私

Unchanged. No network, no writes to source agent dirs, cache only in
`~/.local-agent-garden/`, no telemetry. This pass added **no** outbound side
effects; the later terminal-launch phase is local, user-initiated, and confined
to `terminal.rs`.
不变。不联网、不写源目录、缓存只在 `~/.local-agent-garden/`、无 telemetry。本轮**不**引入任何对外副作用；
后续 terminal-launch 阶段是本地、用户发起，并限制在 `terminal.rs`。

## Modularity checklist (spec §10) / Modularity 对照

- `core` gains pure functions + additive fields only (`daily_tokens`,
  `top_by_tokens`, sprite-size rule). No `tauri::` / `wry::` / web types.
  `core` 只增纯函数 + additive 字段;不碰 UI 类型。
- Adapters untouched; no adapter calls another. Adapter 不动、不互调。
- New JS only under `web/`; `render-insight.js` is pure. 新 JS 只在 `web/`,纯函数。
- Schema constants split; summary fields `#[serde(default)]`. Schema 常量拆分;summary 字段带默认。
- Deleting the insight panel = delete `render-insight.js` + one button wire-up.
  删 insight 面板 = 删一个文件 + 摘一处按钮接线。

## Next step — the actual cut / 实际下一刀

In order, each step ≤5 files / 按顺序,每步 ≤5 文件:

1. `core`: add `daily_tokens` (per-project) + all-project daily rollup, filled in
   `summarize_at` from real tokens; fixture tests. 加 `daily_tokens` + 全项目汇总,真 token 填充,fixture 测试。
2. `core`: split `SCHEMA_VERSION` into `EVENTS_SCHEMA_VERSION` /
   `SUMMARY_SCHEMA_VERSION`; bump summary to 2. 拆 schema 常量,summary 版本 bump 到 2。
3. `core`: add `top_by_tokens(summary, n)` pure fn + tests. 加纯函数 + 测试。
4. `web`: new `render-insight.js`. 新前端模块。
5. `web`: project info card shows the 14-day token sparkline; add the restrained
   "Insight" button opening the per-project overview. 信息卡加 14 天 sparkline;加克制的 Insight 按钮。

## Implementation Notes / 实施记录

Shipped in the first token-insight cut / 第一刀已完成:

- `ProjectGrowth.daily_tokens` and `GardenSummary.daily_tokens` are filled from
  real `AgentEvent.usage.total_tokens`, while `daily_activity` remains the
  liveliness proxy. `ProjectGrowth.daily_tokens` 与 `GardenSummary.daily_tokens`
  来自真实 token;`daily_activity` 继续作为活跃度代理。
- `SUMMARY_SCHEMA_VERSION` is split from `storage::EVENTS_SCHEMA_VERSION`, so
  summary shape changes do not invalidate raw event caches. `SUMMARY_SCHEMA_VERSION`
  已与 `storage::EVENTS_SCHEMA_VERSION` 拆分,summary 形状变化不再误伤事件缓存。
- `top_by_tokens(summary, n)` exists in `core` with tests. `core` 已有
  `top_by_tokens(summary, n)` 并覆盖测试。
- `web/render-insight.js` renders 14-day sparklines and the opt-in Insight panel
  markup as pure data -> HTML/SVG. `web/render-insight.js` 以纯函数输出 14 天
  sparkline 和 Insight 面板 markup。
- The existing project info card now includes a sparkline; the footer Insight
  button opens a ranked top-project overview and can select the matching vine.
  现有项目信息卡已加 sparkline;footer 的 Insight 按钮打开项目排名概览,并能选中对应藤蔓。

## Launcher integration / launcher 集成 ✅ done

Shipped as its own phase. It crosses a new boundary (the app now launches an
external process), confined to one replaceable module and triggered only by an
explicit user click. 作为独立阶段完成。越过了新边界(app 现在会启动外部进程),但关在一个可替换模块里、
且只由用户显式点击触发。

- Tray dropdown lists top-N by tokens (via `top_by_tokens`), rank + name + K/M,
  no bars; rebuilt on `garden:updated`. tray 下拉按 token 列 top-N(序号 + 名 + K/M,不画条),
  随 `garden:updated` 重建。
- Clicking a row → opens a terminal at `project_path` (disabled when `None`).
  The Insight panel rows gained the same per-row open-terminal button.
  点行 → 在 `project_path` 开终端(`None` 时禁用);Insight 面板每行也加了同样的开终端按钮。
- `open_in_terminal(path)` Tauri command (thin shim) + replaceable
  `crates/tauri-app/src/terminal.rs`. The command-building is a pure function
  (`build_command(kind, custom, path, os)`) unit-tested for macOS/Windows/Linux;
  only `open()` spawns. 命令是薄壳;`terminal.rs` 的 `build_command` 是纯函数、按三平台测试,只有 `open()` 真正 spawn。
- Settings: `Integrations { terminal: TerminalKind, terminal_command: String,
  tray_top_n: usize }`, all `#[serde(default)]`. Resolved the open question by
  doing **both**: an allowlist (`system`/`iterm`/`warp`, default `iterm`) **and**
  a `custom` template using a `{path}` placeholder. 设置用 `Integrations`;待定问题最终**两个都做**:
  白名单(默认 `iterm`)+ `custom` 的 `{path}` 模板。

Privacy note / 隐私:terminal launch is local, user-initiated, confined to
`terminal.rs`, and never runs during scan or render. 终端启动纯本地、用户发起、关在
`terminal.rs`,绝不在扫描/渲染时跑。

# 27 — Top AI Coding Agents and Adapter Coverage Research

> 调研日期：2026-07-11
> 状态：作为下一轮 adapter 排期依据；不等同于一个虚假的“全球精确排行榜”

## 1. 结论

当前最值得 Pixel Agent Garden 覆盖的 10 个 AI coding agent 是：

1. GitHub Copilot / Copilot CLI
2. OpenAI Codex
3. Cursor
4. Claude Code
5. OpenCode
6. Cline
7. Google Antigravity CLI
8. Kiro CLI
9. Goose
10. Aider

这是一组 **market coverage set**，不是声称第 1 名一定比第 2 名多多少用户。
各家公开的口径并不相同：有的是 weekly active users，有的是安装量，有的是
GitHub stars，有的只公布企业客户或收入，不能做成一条精确、可复现的总榜。

对 adapter 的直接结论是：

- 现有代码已经覆盖其中 9 个：Copilot CLI、Codex、Cursor、Claude Code、OpenCode、
  Cline、Kiro、Goose，以及 activity-only 的 Antigravity；
- Goose + Cline 已完成，两者都有稳定的本地数据和精确 usage；
- Antigravity CLI 是 Gemini CLI 个人用户迁移后的重要入口；当前已用官方 1.1.1
  真机会话确认 workspace map 与逐会话 SQLite，并以 activity-only 接入，token
  持久化仍需稳定 schema 证明；
- Cursor 3.11 已用官方包与本机 `composerHeaders` schema 放行 activity-only；它的
  mutable cumulative token state 仍不能作为逐请求账单；
- Windsurf 的当前官方更新入口已经指向 Devin Desktop，固定旧版 2.3.15 也没有可证明
  的 content-free Cascade 索引，因此保持 NO-GO，不提交猜测 parser；
- Aider 默认只能做 activity adapter；只有用户主动配置本地 analytics JSONL 时，
  才能提供 usage；产品不能替用户开启 analytics；
- Qwen Code 虽未进入这份市场 Top 10，仍是很有价值的区域性 quick win；独立
  `qwen-code` adapter 已按 0.19.9 serializer 与本机真实 session 接入；
- Kiro CLI 2.12.1 已按本机 `~/.kiro/sessions/cli/` metadata 接入 activity-only；
  私有 token-looking 字段在有公开 accounting 契约前不计费。

## 2. 调研方法

本次把两个问题分开：

1. **市场覆盖价值**：官方采用量、活跃项目规模、开源社区和近期产品活跃度；
2. **adapter 价值**：本地是否持久化 session、timestamp、project、model、tool 和
   API-reported token，格式是否能只读解析并稳定去重。

证据优先级为：官方产品数据 > 上游 serializer / schema 源码 > 官方文档 > GitHub
stars。GitHub stars 只用于比较开源项目热度，不能与 Cursor、Windsurf、Copilot 等
闭源产品的用户量直接换算。

2026-07-11 的开源热度快照包括：OpenCode 184,556 stars、Claude Code 137,308、
Gemini CLI 105,900、Codex 97,000、Cline 64,531、Goose 51,043、Aider 47,259、
Continue 34,803、Kilo Code 25,989、Qwen Code 25,928。Roo Code 24,317 stars，但
仓库已在 2026-05-15 archived，因此不再作为独立 Top 10 目标。

## 3. Top 10 Coverage Matrix

| Agent | 当前热度证据 | 本地数据与 token 证据 | 当前结论 |
|---|---|---|---|
| GitHub Copilot / CLI | GitHub 称 Copilot 有数百万个人用户、数万企业客户，是其最广泛采用的 AI developer tool | CLI 的 `~/.copilot/session-state/*/events.jsonl` 持久化 session；现有 adapter 按源端 model 读取累计 metrics，跨日不可归属 token 不进入每日曲线 | **CLI 已覆盖**；VS Code/IDE 是独立 research gap |
| OpenAI Codex | OpenAI 在 2026-06-02 公布超过 500 万 weekly active users | 现有本地 rollout JSONL 可提供 session、model、usage 和 tool 信息 | **已覆盖** |
| Cursor | 官方称有数百万开发者，且年化收入超过 10 亿美元 | 官方保证 foreground history 本地持久化；3.11.13 真机 `composerHeaders` 可安全提供 session、workspace 与 timestamp，但 `tokenCount` 是未证明结算语义的 mutable cumulative state | **Activity adapter 已覆盖**；draft/background/cloud/body/checkpoint 均排除，token 继续 research |
| Claude Code | Anthropic 的 2026 报告分析约 40 万个 session、约 23.5 万人，用户平均每周使用 20 小时 | 现有 adapter 已读取本地 project JSONL 和 usage | **已覆盖** |
| OpenCode | 184,556 stars；官方数据页近期约 10 万–19 万 daily unique users | SQLite/legacy JSON 均有 per-message model、token、cache 与 cost | **已覆盖**；已支持 XDG override、损坏 canonical row fallback 与 WAL 创建监听 |
| Cline | 2026-01 官方公布跨编辑器超过 500 万 installs；64,531 stars | `tasks/<id>/ui_messages.json` 的 usage rows 含 `tokensIn/out`、cache read/write、cost 和 subagent usage | **P0 GO**；适合 request-level exact adapter |
| Google Antigravity CLI | Google 称 Antigravity ecosystem 已有数百万开发者；它是 Gemini consumer 用户的官方迁移方向 | 官方 CLI 1.1.1 创建 summary DB，但真机会话未写入；当前真实索引是 `cache/last_conversations.json` + `conversations/*.db`，可提供 workspace、conversation 与 session-level activity；尚未证明稳定的 per-turn token 记录 | **Activity adapter 已覆盖**；token 继续 research |
| Kiro CLI | AWS Q Developer CLI 的当前产品迁移方向；官方 2.12.1 安装包与 session management 仍在活跃发布 | 真机 `~/.kiro/sessions/cli/*.json` 提供 session、project、turn timestamp 与 model；token-looking fields 没有公开 accounting contract | **Activity adapter 已覆盖**；transcript/auth/shell history 排除，token 继续 research |
| Goose | 51,043 stars，仓库和 schema 近期持续活跃 | `sessions/sessions.db` 的 `usage_ledger` 有 timestamp、model、input/output、cache、cost、`cost_source`、`is_compaction` | **P0 GO**；目前证据质量最高的新 adapter |
| Aider | 47,259 stars，成熟 CLI 社区 | 默认 `.aider.chat.history.md` 没有可靠 usage；可选 `--analytics-log` JSONL 会记录 `message_send` token/cost | **P2 bridge**；默认 activity-only，optional log 才 exact/estimated 混合 |

Windsurf 从当前 Top 10 coverage set 移到兼容性 watch list：其 2026 官方更新入口
已经返回 Devin Desktop，而固定 Windsurf 2.3.15 仍没有可安全解析的本地 Cascade 索引。

## 4. 新 Adapter 的解析设计

### 4.1 Goose — 第一优先级

上游从 1.10.0 起使用 SQLite，legacy `.jsonl` 仍可能留在磁盘。当前 schema 中：

- `sessions/sessions.db` 是权威数据源；
- `usage_ledger` 逐条保存 `session_id`、`created_timestamp`、`model`、
  `input_tokens`、`output_tokens`、`cache_read_tokens`、`cache_write_tokens`、
  `cost`、`cost_source` 和 `is_compaction`；
- `cost_source` 必须保留到 `metadata`，区分 provider-reported 与 estimated；
- `is_compaction` 必须保留，防止将压缩请求误当成用户 turn；
- macOS 路径通过 `etcetera` 的 `Block/goose` 兼容策略计算，不能只硬编码 Linux 的
  `~/.local/share/goose`；
- SQLite 必须以 read-only / immutable 方式打开；legacy JSONL 用独立 helper 解析；
- 推荐 dedupe key：`goose:usage:<ledger-row-id>`，没有 row id 的 legacy 记录使用
  `session_id + timestamp + message ordinal`。

Token 精度：逐请求 source-reported 或 source-estimated，类型由 `cost_source` / metadata
明确声明，不混成“全部 API 精确”。

### 4.2 Cline — 第一优先级

Cline 的 host `globalStorageFsPath` 下有 `tasks/<taskId>/`，关键文件包括：

- `ui_messages.json`
- `api_conversation_history.json`
- `context_history.json`
- `task_metadata.json`

`ui_messages.json` 中的 `api_req_started`、`deleted_api_reqs`、`subagent_usage`
承载 `tokensIn`、`tokensOut`、`cacheWrites`、`cacheReads` 与 `cost`。上游自己的
`getApiMetrics` 就按这些事件汇总，因此 adapter 应复用相同语义：

- request usage 逐事件转换为 `AgentEvent`，不要只发 task 总计；
- `deleted_api_reqs` 代表 UI 已删除但仍应计入的 usage；
- `subagent_usage` 必须与父任务请求区分，避免重复累计；
- context-window progress 不是 billable total，不能混用；
- discovery 需要覆盖 VS Code、Insiders、VSCodium、remote-server，以及 Cline 正在迁移
  的 `~/.cline` 路径；
- Cline、Kilo、Roo 可以共享纯 parser helper，但必须拥有独立 source id、discovery 和
  adapter；adapter 之间不得互相调用。

推荐 dedupe key：`cline:<task-id>:<usage-message-ts-or-native-id>`。

### 4.3 Antigravity CLI — Activity 已接入，Token 继续研究

2026-06-18 起，Google 已停止 Gemini Code Assist consumer tiers 的 Login with Google
访问 Gemini CLI，并要求个人用户迁移到 Antigravity。Gemini CLI 仍可用于 API key、
Vertex AI、Standard / Enterprise，但它已经不是 consumer growth path。

因此：

- 仓库中的 `gemini-cli` adapter 可以保留为 legacy/enterprise/API-key coverage；
- 不再把 Gemini CLI 作为下一轮新增 adapter 的 P0 代表；
- 官方 CLI 1.1.1 已确认在 `~/.gemini/antigravity-cli/` 创建 summary DB，但用户
  完成并退出的真实会话仍未写入该表；不能把“存在空表”当成有效数据源；
- CLI 会真实维护 `cache/last_conversations.json`（workspace → conversation id）和
  `conversations/<id>.db`。Adapter 优先使用非空 summary row，否则只读映射、
  `trajectory_meta.cascade_id`、step count 与数据库 mtime；不读取任何 protobuf blob；
- 每个 conversation 生成一条 activity-only event，native conversation id 作为 dedupe
  key；watch path 仅包含精确的 summary/map/conversation 文件及 WAL；
- 未出现在 latest map 的旧会话仍保留 activity，但 project 安全降级为空；
- adapter 不读取 title、preview、app data、transcript、log 或凭证；
- 每会话 trajectory/transcript 中哪些字段是权威 usage 仍需真机证明；
- 必须从 serializer 或两版真机 fixture 证明 model、timestamp、usage 和 parent/subagent
  关系；只有文本和 artifact 时只能 activity-only；
- 不能调用 Antigravity CLI、网络 API 或登录流程来完成日常 scan。

### 4.4 Cursor — Activity 已接入，Token 继续研究

Cursor 3.11.13 官方包与本机真机 schema 共同确认：

- foreground history 的结构索引位于平台 `User/globalStorage/state.vscdb` 与
  `User/workspaceStorage/*/state.vscdb`；workspace 由同目录 `workspace.json` 映射；
- 当前 `composerHeaders` 表的 content-free columns 包含 `composerId`、
  `workspaceId`、`createdAt`、`lastUpdatedAt`、`isArchived`、`isSubagent`、
  `recency` 与 `checkpointAt`；`value` 只按显式 structural allowlist 解析；
- draft/empty heads、background/cloud origin 与没有 conversation checkpoint 的启动占位
  不产生事件；同一 composer 只保留最新 header；
- `cursorDiskKV`、`agentKv:*`、bubble/checkpoint/artifact blob、transcript JSONL 正文、
  title/name/subtitle、auth 和 settings 均不读取或输出；
- header `tokenCount` 是会随 checkpoint/迁移改变的累计 UI state，公开契约没有证明
  cache/reasoning/逐请求结算语义，因此全部保持 activity-only。

Background Agents 的历史位于远程数据库，不属于本地 adapter；日常 scan 不调用任何
Cursor API。

### 4.5 Windsurf — 当前 NO-GO

2026-07-11 的官方 Windsurf update endpoint 已经返回 Devin Desktop 3.4.27，而不是
旧 Windsurf。对固定官方旧版 2.3.15 DMG 的静态复核又确认：

- 全包没有社区实现声称的 `cascade.sessionData` 或 `cascade.chatdata` key；
- VS Code-compatible `state.vscdb` 的存在不能证明 Cascade activity，按 DB mtime 会把
  普通编辑器操作误计为 agent；
- protobuf descriptors 虽有 Cascade/trajectory 类型，但同一结构含 prompt、content、
  tool result 等正文，且没有稳定本地文件名、封装格式或 workspace mapping 契约；
- `user_settings.pb`、`mcp_config.json`、memories、rules、brain、auth 与 logs 均应排除。

因此当前不提交空壳或猜测 parser。未来 gate 是固定旧版、两个 workspace、两个 session
的脱敏真机 fixture，并证明存在不含正文的 `session_id + timestamp + project` 索引。

### 4.6 Aider — opt-in bridge

Aider 默认 history 适合判断“发生过活动”，不适合 token 统计。其可选
`--analytics-log filename.jsonl` 会记录 `message_send`、model、prompt/completion token
与 cost，但部分 provider 无 usage 时仍会回退到 client token count。

因此 adapter 必须：

- 默认只解析 history 为 activity-only；
- 仅当用户自己提供 analytics log 路径时解析 usage；
- metadata 标明 `api_reported` 或 `client_estimated`；
- 绝不替用户打开 analytics，也不修改 `.aider.conf.yml`。

## 5. Top 10 之外的 Quick Win：Qwen Code

Qwen Code 目前 25,928 stars，虽然没有进入市场覆盖 Top 10，但对中文和亚洲用户很有
价值。上游当前格式已经与 Gemini CLI 明显分叉：

- 默认根目录是 `~/.qwen`；上游还支持 runtime override，但当前
  `AdapterContext` 不读取 ambient process env；
- 0.19.9 session 位于 `projects/<sanitized-cwd>/chats/<session>.jsonl`；
  v0.3 及更早 whole-file records 位于 `tmp/<project-hash>/chats/session-*.json`；
- `ChatRecord` 有 `uuid`、`parentUuid`、`sessionId`、`timestamp`、`cwd`、`version`、
  `model`、`usageMetadata`、tool 和 subagent 字段；
- token 语义包括 input、output、cached、thoughts 和 total。

独立 `qwen-code` adapter 已完成。它只读取源端持久化 usage，不按文本估 token；cache
从 prompt input 中拆出，fork 复制的父历史不重复计数，current/legacy migration collision
以 current UUID row 为准。0.19.9 本机真实会话已完成脱敏 spot-check。

Kiro CLI 2.12.1 也已作为 activity-only quick win 接入：当前结构索引是
`~/.kiro/sessions/cli/<session>.json`，sibling `.jsonl` 正文永不打开；兼容旧
`conversations_v2` 时只 SELECT identity/timestamp columns。Kiro 通用 shell DB 中的
`history`、`auth_kv`、`state` 不算 agent session。私有 token-looking fields 没有官方
accounting 契约，所以保持零 token，不按 context percentage 或正文估算。

## 6. 执行顺序

### Gate 0 — 先稳住已实现来源

1. [x] 修复 Copilot CLI 的多模型累计拆分；跨日累计量保留总数但不伪造每日归属；
2. [x] 修复 OpenCode 的 XDG discovery、watch path 和失败后 fallback；
3. [x] 用用户生成的 Copilot CLI 1.0.70 真机 session 做脱敏 fixture spot-check；
4. [x] Gemini CLI 标记为 legacy/enterprise/API-key coverage，不再作为 consumer P0 宣传。

### Wave 1 — 两个高置信原生 adapter

1. [x] `goose`：只读 SQLite `usage_ledger` + legacy JSONL；cache 是 input
   子集，归一化时拆出，保留 `cost_source` / compaction / parent session；
2. [x] `cline`：当前 SDK SQLite + message artifacts，兼容 shared/CLI 与
   VS Code-family legacy task storage；当前逐 turn metrics 拆分 cache 子集，
   legacy 的逐请求、删除历史汇总、subagent usage 复用上游 `getApiMetrics` 语义；
3. [x] 覆盖当前/legacy 存储 fixture、损坏输入、迁移副本 dedupe、只读与
   最小 watch path；fixture 来自上游 serializer/schema，尚待有真实本机数据后
   再做一次脱敏 spot-check。

### Wave 2 — 新入口与闭源研究

1. [x] `antigravity` activity-only：只读官方 conversation summary SQLite；
   token ledger 仍需 serializer/真机 fixture 后再做 go/no-go；
2. [x] `cursor` activity-only：3.11.13 `composerHeaders` + workspace mapping，
   排除 draft/background/cloud/body/checkpoint，token 继续 research；
3. [x] Windsurf NO-GO：当前官方入口已迁移 Devin，旧版无安全稳定 Cascade index；
   等固定旧版双 workspace fixture 再重开。

### Wave 3 — bridge 与区域扩展

1. Aider activity + user-supplied analytics log；
2. [x] 独立 `qwen-code` adapter；
3. [x] `kiro` activity-only adapter；
4. Cline family helper 稳定后，再评估 Kilo Code；Roo Code 只做 legacy compatibility。

## 7. Adapter Go/No-Go Gate

每个新来源在实现前必须提供：

- macOS / Linux / Windows 的 path matrix；
- 两个不同 source version 的脱敏 fixture；
- 明确 timestamp、project、session、model、tool、token 字段；
- token 属于 API-reported、client-estimated、cumulative 还是 per-request；
- native dedupe key，以及 append/rewrite/SQLite update 行为；
- source directory 只读证明，测试只使用临时目录；
- auth、credential、prompt 正文不进入 metadata 或日志；
- 没有 persisted token 时明确降级 activity-only，不做文本 token 猜测。

## 8. Primary Sources

采用量与迁移：

- [GitHub Copilot adoption](https://github.com/features/copilot)
- [OpenAI: Codex has more than 5M weekly active users](https://openai.com/index/codex-for-knowledge-work/)
- [Anthropic Claude Code usage study](https://www.anthropic.com/research/claude-code-expertise)
- [Cursor: millions of developers and $1B+ annualized revenue](https://cursor.com/blog/series-d)
- [Cline: 5M installations](https://cline.bot/blog/5m-installs-1m-open-source-grant-program)
- [OpenCode current usage data](https://opencode.ai/data)
- [Google Antigravity adoption](https://antigravity.google/blog/introducing-google-antigravity-2)
- [Antigravity CLI official repository and releases](https://github.com/google-antigravity/antigravity-cli)
- [Antigravity Hooks and local app-data roots](https://antigravity.google/docs/hooks)
- [Antigravity CLI local configuration and brain layout](https://codelabs.developers.google.com/antigravity-cli-hands-on)
- [Gemini Code Assist consumer deprecation](https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals)
- [Cursor local history contract](https://docs.cursor.com/en/agent/chat/history)
- [Kiro CLI session management](https://kiro.dev/docs/cli/chat/session-management/)
- [Windsurf Cascade product documentation](https://docs.windsurf.com/windsurf/cascade/cascade)

上游持久化与 token schema（调研时固定到 commit）：

- [Cline storage filenames](https://github.com/cline/cline/blob/2d2c6694215cd5eeca987085018b12f08ff557a8/apps/vscode/src/core/storage/disk.ts)
- [Cline request/subagent metrics](https://github.com/cline/cline/blob/2d2c6694215cd5eeca987085018b12f08ff557a8/apps/vscode/src/shared/getApiMetrics.ts)
- [Goose platform paths](https://github.com/aaif-goose/goose/blob/9cec9f2f4f1f5d5c9bfce351423539b7f313dc9f/crates/goose/src/config/paths.rs)
- [Goose session and usage ledger schema](https://github.com/aaif-goose/goose/blob/9cec9f2f4f1f5d5c9bfce351423539b7f313dc9f/crates/goose/src/session/session_manager.rs)
- [Qwen Code 0.19.9 chat recording schema](https://github.com/QwenLM/qwen-code/blob/8e6a57256297685761bb0554bd3458f05218399e/packages/core/src/services/chatRecordingService.ts)
- [Qwen Code token usage semantics](https://github.com/QwenLM/qwen-code/blob/25f491d3ac47942fbd9973e5ed8008ab5ce3f5c4/packages/core/src/services/tokenUsageService.ts)
- [Aider analytics log documentation](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/more/analytics.md)
- [Aider usage event implementation](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py)

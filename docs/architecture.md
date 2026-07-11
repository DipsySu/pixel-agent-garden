# Architecture

Pixel Agent Garden is split around one boundary: adapters produce normalized
events; everything else consumes normalized events.

## Data Flow

```text
~/.gemini/antigravity-cli/conversation_summaries.db
~/.gemini/antigravity-cli/cache/last_conversations.json
~/.gemini/antigravity-cli/conversations/*.db
~/.claude/projects/**/*.jsonl
~/Library/Application Support/Claude/local-agent-mode-sessions/**/.claude/projects/**/*.jsonl
~/.codex/state_5.sqlite
~/.codex/sessions/**/*.jsonl
~/.cline/data/db/sessions.db
~/.cline/data/sessions/**/*.messages.json
~/.cline/data/tasks/*/ui_messages.json
<editor globalStorage>/saoudrizwan.claude-dev/tasks/*/ui_messages.json
<goose data>/sessions/sessions.db
manual imports
        |
        v
Adapter::collect()
        |
        v
AgentEvent[]
        |
        v
scan::collect_events()  -- source filtering + uuid dedupe
        |
        v
aggregate::summarize()
        |
        v
GardenSummary -> CLI / Tauri / web fallback
```

## Adapter Contract

Every native adapter implements `crates/core/src/adapter.rs`:

```rust
pub trait Adapter: Send + Sync {
    fn name(&self) -> &str;
    fn discover(&self, ctx: &AdapterContext) -> bool;
    fn collect(&self, ctx: &AdapterContext) -> Result<Vec<AgentEvent>, Error>;
    fn watch_paths(&self, ctx: &AdapterContext) -> Vec<PathBuf> { Vec::new() }
}
```

Adapters must be read-only. They should tolerate missing files, unknown fields,
older schemas, partial JSONL rows, and locked SQLite databases.

## Unified Event

`AgentEvent` is intentionally broad:

- `source`: agent name, such as `claude-code`, `claude-cowork`, `codex`, `aider`
- `timestamp`: event time
- `project_path`: workspace or repo path when known
- `session_id`: source session/thread id
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `total_tokens`
- `tool_calls`
- `model`
- `files_touched`
- `metadata`: source-specific fields that should not leak into UI assumptions

If a source cannot provide token usage, it can still emit events with sessions,
timestamps, tool calls, or file activity. Growth is based on a mixed activity
score rather than token usage alone.

## Adding A New Agent

1. Create `crates/core/src/adapters/<agent>.rs`.
2. Implement `Adapter`.
3. Convert source records into `AgentEvent`.
4. Add the adapter module and register it in `crates/core/src/registry.rs`.
5. Add focused Rust tests with fixture-style local files.

For agents with no stable local log format yet, use `manual-jsonl` as a bridge.

## Antigravity Accuracy Notes

Antigravity CLI 1.1.1 creates a summary index at
`~/.gemini/antigravity-cli/conversation_summaries.db`, but a real completed CLI
session did not populate it. The adapter therefore treats populated summary
rows as the preferred source and falls back to the CLI-maintained
`cache/last_conversations.json` workspace map plus exact
`conversations/<id>.db` files. It emits one activity-only event per native
conversation. Summary rows use their recorded activity time; fallback rows use
the conversation database modification time and declare that timestamp source
in metadata. Older conversations absent from the latest-workspace map remain
visible with an unknown project rather than being silently dropped.

The adapter deliberately ignores title, preview, step payload/metadata blobs,
transcript contents, per-conversation app-data paths, logs, config, and
authentication state. It reads only safe SQLite index fields and step counts.

The summary index does not persist a verified token ledger. Antigravity's
private per-conversation trajectory storage must not be inferred from protobuf
names or text length, so token and model fields stay empty until a stable
source-recorded schema is proven with versioned fixtures. The watcher follows
only exact summary/map/conversation files and their WALs, never the broader
credential-bearing root.

## Cline And Goose Accuracy Notes

Cline's current SDK message store persists per-turn assistant metrics. Current
`inputTokens` contains cache subsets, so the adapter carves them out. Legacy
task storage already contains disjoint buckets; there the adapter counts the
same three usage-bearing row types as Cline's own `getApiMetrics`: completed API
request rows, deleted-request aggregates, and subagent aggregates. Aggregate
rows do not identify one model, so the adapter does not guess one from the
parent task. A migrated task found in both stores is counted from the current
SDK store only.

Goose's SQLite `usage_ledger` records one inference per row. Its input field
includes cache read/write as subsets, so the adapter carves those subsets out
before filling normalized `AgentEvent` buckets. Legacy JSONL stores only
session-level accumulated totals; those remain useful for lifetime totals but
opt out of daily token attribution.

## Claude Cowork

Claude Desktop Cowork stores both host audit logs and an embedded Claude Code
transcript. The adapter currently reads only the embedded
`.claude/projects/**/*.jsonl` files and ignores `audit.jsonl` for token totals,
so the same assistant usage is not counted through two different local views.

`audit.jsonl` is still the more authoritative audit ledger. If we later add an
audit mode, it should be implemented as a separate parser plus reconciliation
logic in `scan.rs`.

## Privacy Rules

- No network calls for scanning or rendering local usage.
- No analytics.
- No writes to source agent directories.
- Cached output goes only to `~/.local-agent-garden/`.
- UI should explain growth from local event fields, not opaque scoring.

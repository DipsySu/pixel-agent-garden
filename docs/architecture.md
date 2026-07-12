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
~/.copilot/session-state/*/events.jsonl
~/.gemini/tmp/*/chats/*.{json,jsonl}
~/.cline/data/db/sessions.db
~/.cline/data/sessions/**/*.messages.json
~/.cline/data/tasks/*/ui_messages.json
<editor globalStorage>/saoudrizwan.claude-dev/tasks/*/ui_messages.json
<goose data>/sessions/sessions.db
~/.kiro/sessions/cli/*.json
<kiro data>/data.sqlite3 (supported conversations_v2 only)
<opencode data>/opencode.db and legacy JSON stores
~/.qwen/projects/*/chats/*.jsonl
~/.qwen/tmp/*/chats/*.{json,jsonl}
<Cursor User>/globalStorage/state.vscdb
<Cursor User>/workspaceStorage/*/{state.vscdb,workspace.json}
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

`scan` isolates typed adapter failures: healthy adapters still produce events,
while each failed adapter is returned as an `AdapterFailure`. Cache refreshes
retain that adapter's last known partition, omit the source fingerprint so the
next load retries, and surface an adapter-specific CLI warning / Tauri error
event. A malformed source must never erase unrelated garden data.

The desktop watcher periodically reconciles `watch_paths()` as well as doing so
after filesystem-triggered scans. This is required because agent roots,
workspaces, and session databases can be created after app launch. A missing
leaf may watch its direct parent with exact logical filtering; targets missing
multiple path levels rely on the bounded reconciliation interval rather than
recursively watching a broad ancestor such as the user's home directory.

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
before filling normalized `AgentEvent` buckets. Goose does not eagerly backfill
imported/pre-ledger totals, so the adapter compares each authoritative SQLite
session total with its ledger sums and emits only a positive residual as one
carried-forward event. That cumulative residual opts out of daily attribution.
Legacy JSONL is consulted only when the database has no ledger table; leftover
JSONL beside a modern database is never used as fallback truth.

## Qwen Code, Kiro, And Cursor Accuracy Notes

Qwen Code 0.19.9 writes append-only records to
`~/.qwen/projects/<sanitized-cwd>/chats/<session>.jsonl`. A local 0.19.9
session confirmed the upstream serializer contract and its persisted
`usageMetadata`: prompt, candidate, cached, thought, tool-prompt, and total
counters are source-reported. Cache reads are carved out of prompt input.
Native tool-result prompt tokens are separate input under the Google GenAI
contract and are subtracted from the reported output remainder; rows without
that field retain Qwen's overlap-safe `total - prompt` rule. Fork-copied history is
skipped, native message UUIDs are deduplicated, and legacy whole-file records
under `~/.qwen/tmp/*/chats/` remain compatible.

Kiro CLI 2.12.1 writes structural session metadata to
`~/.kiro/sessions/cli/<session>.json` and chat content to a sibling `.jsonl`.
The adapter opens only the metadata snapshot through an explicit field
allowlist and never opens the transcript. It can also read only the identity
and timestamp columns of a supported `conversations_v2` table; generic Kiro
shell state databases (`history`, `auth_kv`, and `state`) do not count as agent
discovery. Kiro's private token-looking fields do not have a published
accounting contract, so all Kiro events remain activity-only.

Cursor 3.11 stores foreground conversation headers in the `composerHeaders`
table of its platform `User` databases. The adapter reads only structural
header fields, rejects drafts and non-local/background origins, resolves
workspace IDs through `workspace.json`, and never reads `cursorDiskKV`, body
blobs, checkpoint artifacts, transcript contents, titles, or subtitles.
Cursor's header token counters are mutable cumulative UI state rather than a
documented per-request ledger, so Cursor events are activity-only.

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

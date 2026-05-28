# Architecture

Pixel Agent Garden is split around one boundary: adapters produce normalized
events; everything else consumes normalized events.

## Data Flow

```text
~/.claude/projects/**/*.jsonl
~/Library/Application Support/Claude/local-agent-mode-sessions/**/.claude/projects/**/*.jsonl
~/.codex/state_5.sqlite
~/.codex/sessions/**/*.jsonl
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

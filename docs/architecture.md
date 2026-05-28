# Architecture

Local Agent Garden is split around one boundary: adapters produce normalized events; everything else consumes normalized events.

## Data Flow

```text
~/.claude/projects/*/*.jsonl
~/.codex/state_5.sqlite
~/.codex/sessions/**/*.jsonl
manual imports
        |
        v
AgentAdapter.collect()
        |
        v
AgentEvent[]
        |
        v
summarize()
        |
        v
GardenSummary -> CLI / future desktop UI
```

## Adapter Contract

Every adapter implements:

```python
class AgentAdapter:
    name: str

    def discover(self, context: AdapterContext) -> bool:
        ...

    def collect(self, context: AdapterContext) -> list[AgentEvent]:
        ...
```

Adapters must be read-only. They should tolerate missing files, unknown fields, older schemas, partial JSONL rows, and locked SQLite databases.

## Unified Event

`AgentEvent` is intentionally broad:

- `source`: agent name, such as `claude-code`, `codex`, `aider`
- `timestamp`: event time
- `project_path`: workspace or repo path when known
- `session_id`: source session/thread id
- `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `total_tokens`
- `tool_calls`
- `model`
- `files_touched`
- `metadata`: source-specific fields that should not leak into UI assumptions

If a source cannot provide token usage, it can still emit events with sessions, timestamps, tool calls, or file activity. Growth is based on a mixed activity score rather than token usage alone.

## Adding A New Agent

1. Create `local_agent_garden/adapters/<agent>.py`.
2. Implement `discover()` and `collect()`.
3. Convert source records into `AgentEvent`.
4. Add the adapter to `local_agent_garden/adapters/registry.py`.
5. Add a small fixture-style test.

For agents with no stable local log format yet, use `manual-jsonl` as a bridge.

## Privacy Rules

- No network calls.
- No analytics.
- No writes to source agent directories.
- Cached output goes only to `~/.local-agent-garden/` when the user runs `scan`.
- UI should explain growth from local event fields, not opaque scoring.


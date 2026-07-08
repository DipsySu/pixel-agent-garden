# 23 — Adapter Development Guide

This guide is the contribution path for new local AI-agent sources. The short
rule: add one adapter, emit normalized `AgentEvent`s, and keep source
directories read-only.

## 1. First Check The Source Shape

Before writing code, answer these with redacted samples:

| Question | Required evidence |
|---|---|
| Where does the agent store local activity? | Stable path pattern, e.g. `~/.agent/sessions/**/*.jsonl` |
| Is token usage present? | One redacted row showing input/output/cache or total tokens |
| Is project/workspace path present? | One field or mapping that identifies the repo |
| Is timestamp present? | RFC3339, Unix seconds, SQLite datetime, or equivalent |
| Can rows be deduped? | UUID/message id/session+turn key, if available |

If token usage is absent, the adapter can still emit activity events, but the
review must say what growth signal remains useful.

Use the CLI inventory command when filing an issue:

```bash
agent-garden adapters --json --watch-paths
```

The output is local-only. Redact usernames and private folder names before
posting.

## 2. Implementation Checklist

1. Add `crates/core/src/adapters/<agent>.rs`.
2. Implement `Adapter`:
   - `name()` returns a stable kebab-case source id.
   - `discover()` checks only cheap filesystem markers.
   - `collect()` reads local source files and returns `AgentEvent`.
   - `watch_paths()` returns the smallest stable set of files/directories the
     Tauri watcher should observe.
3. Export the module from `crates/core/src/adapters/mod.rs`.
4. Register it in `crates/core/src/registry.rs`.
5. Add fixture-style tests in the adapter module. Tests create temporary
   files/directories and never read the real home directory.
6. Update `docs/architecture.md`, `README.md`, and `CHANGELOG.md`.

Adapters must not:

- Write to source agent directories.
- Call the network.
- Depend on UI colors, sprite names, or layout.
- Reach into another adapter.

## 3. Event Mapping

Use top-level `AgentEvent` fields only for normalized concepts:

| Source data | `AgentEvent` field |
|---|---|
| Agent/source id | `source` |
| Message/session timestamp | `timestamp` |
| Workspace/repo path | `project_path` |
| Thread/session id | `session_id` |
| Input/output/cache/total token usage | `usage` |
| Tool-call count | `tool_calls` |
| Model name | `model` |
| Source-specific fields | `metadata` |

Always call `event.normalize_totals()` before returning events if the adapter
sets partial token fields.

## 4. Deduplication

`scan.rs` owns cross-adapter dedupe. Adapter code should preserve stable source
identifiers in `metadata` or `raw_ref`; it should not try to compare itself to
other adapters.

Preferred keys, in order:

1. Native message UUID.
2. Session id + message index/turn id.
3. Source file path + line number.

## 5. Manual JSONL Bridge

If a source is not stable enough for a native adapter, document a local export
or small script that writes the manual JSONL format:

```json
{"source":"new-agent","timestamp":"2026-05-27T09:00:00Z","project_path":"/repo","session_id":"s1","input_tokens":1200,"output_tokens":400,"tool_calls":3}
```

`source` and `timestamp` are required. Unknown fields are ignored. This lets
users test value before the native parser is committed.

## 6. Review Gate

Each adapter PR must include:

- Redacted fixture data in tests.
- `cargo test --workspace` proof.
- A short note on token accuracy: exact split, total-only, or no tokens.
- A short note on privacy: source paths read, files written, and confirmation
  that the adapter is read-only.


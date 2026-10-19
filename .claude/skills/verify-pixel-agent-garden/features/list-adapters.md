# List local adapters

A user lists which local agent sources the garden can read. On this run's disposable home the only active source is the seeded manual JSONL file. Claude Code, Codex, Cursor, and the other built-in sources stay available and are not read from the real home directory.

## Sub-features

- `list-adapters-json`: `agent-garden adapters --json` prints one object per adapter with `name`, `discovered`, and `status`.
- `list-adapters-text`: `agent-garden adapters` prints the same list as aligned text.
- `list-adapters-watch-paths`: `agent-garden adapters --json --watch-paths` adds the paths that source would watch.

## How to get to it (user POV)

- Terminal: `agent-garden --manual-jsonl PATH adapters`.
- Add `--json` for a machine-readable list, and `--watch-paths` to include discovery paths.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh run from `launch` (empty data dir, fixture already written and passed as `--manual-jsonl`).

- **CLI adapters --json.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature list-adapters cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl adapters --json`. Exit code `0`. Stdout is JSON with 13 adapters. `manual-jsonl` has `"discovered": true` and `"status": "active"`. `claude-code`, `codex`, and `cursor` each have `"discovered": false` and `"status": "available"`.
- **CLI adapters.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature list-adapters cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl adapters`. Exit code `0`. Stdout contains the line `manual-jsonl   active` and the line `claude-code    available`.
- **CLI adapters --watch-paths.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature list-adapters cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl adapters --json --watch-paths`. Exit code `0`. The `manual-jsonl` object has `watch_paths` equal to `["{DATA_DIR}/fixture/events.jsonl"]` after substitution. Every other path in the document is under `{DATA_DIR}/home`.
- **Proof.** The JSON list is the read-only view. Then run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The snapshot's `fixture/events.jsonl` is still the seeded row, and the snapshot has no `home/.claude`, `home/.codex`, or `home/.cursor` directory.

## Gotchas

- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`. `scripts/agent-garden.sh` exits 2 if either directory is missing or sits inside the real user home. Without that wrapper the CLI would scan the machine's real agent directories.
- Omitting `--manual-jsonl` leaves `manual-jsonl` at `available`. The seeded file is not discovered on its own.
- `--watch-paths` prints candidate paths for some inactive adapters (observed: `antigravity`, `gemini-cli`). Those strings are under the fake home. The command does not create those directories.

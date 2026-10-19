# Scan activity into events.json

A user scans the seeded manual JSONL file and gets a normalized cache. The command writes one event and prints the path it wrote. The project list then shows that same event without trusting the scan line alone.

## Sub-features

- `scan-events-live`: `agent-garden scan` writes `~/.local-agent-garden/events.json` under the run's fake home.
- `scan-events-readback`: `agent-garden projects --from-cache` renders that cache.

## How to get to it (user POV)

- Terminal: `agent-garden --manual-jsonl PATH scan`.
- The default output path is `~/.local-agent-garden/events.json` for the `HOME` the process sees.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh run from `launch`. Launch already ran one scan; running it again overwrites the same cache with the same row.

- **CLI scan.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature scan-events cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl scan`. Exit code `0`. Stdout is `wrote 1 events from manual-jsonl to {DATA_DIR}/home/.local-agent-garden/events.json` with the run's data dir substituted.
- **Proof.** Read it back through a second view: run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature scan-events cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl projects --from-cache {DATA_DIR}/home/.local-agent-garden/events.json` and `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The projects line contains `demo-plot`, `stage=3`, `events=1`, `tokens=1650`, and `path=/tmp/verify-garden/demo-plot`. The snapshot file `home/.local-agent-garden/events.json` has `"schema_version": 3`, one event, `"source": "aider"`, `"project_path": "/tmp/verify-garden/demo-plot"`, and `"total_tokens": 1650`.

## Gotchas

- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`. Without them the wrapper exits 2. A bare `agent-garden scan` would write the real `~/.local-agent-garden/events.json`.
- `scan` with no `--manual-jsonl` on this empty home still exits 0 and writes `wrote 0 events from no adapters`. That is not this journey. The fixture path is required.
- `--out` overrides the cache location. This recipe uses the default under the fake home so the snapshot matches what a user gets.
- `projects --from-cache` records garden memory. See the rings note in [check-state.md](./check-state.md).

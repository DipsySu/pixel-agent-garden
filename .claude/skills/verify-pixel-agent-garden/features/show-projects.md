# Show projects

A user sees one row per project, then opens a single project by a substring of its name or path. The seeded garden has one project, `demo-plot`, with one event and 1650 tokens.

## Sub-features

- `show-projects-list`: `agent-garden projects` prints the table.
- `show-projects-inspect`: `agent-garden inspect --project demo-plot` prints that project's card.
- `show-projects-miss`: `agent-garden inspect --project missing-plot` exits 1 and changes nothing.

## How to get to it (user POV)

- Terminal: `agent-garden --manual-jsonl PATH projects`.
- Terminal: `agent-garden --manual-jsonl PATH inspect --project demo-plot`.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh run from `launch` (the seeded row is already scanned).

- **CLI projects.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature show-projects cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl projects`. Exit code `0`. Stdout contains `demo-plot`, `stage=3`, `events=1`, `tokens=1650`, and `path=/tmp/verify-garden/demo-plot`.
- **CLI inspect.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature show-projects cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl inspect --project demo-plot`. Exit code `0`. Stdout begins with `demo-plot` and contains `path      /tmp/verify-garden/demo-plot`, `sources   aider x1`, `sessions  1`, `events    1`, `tokens    1.6k`, `tools     3`, `stage     budding`, `score     78`, `cache     2%`, `models    manual-model`. On a machine at UTC+0800 the first and latest lines are `2026-05-27 20:00`.
- **CLI inspect miss.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature show-projects cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl inspect --project missing-plot`. Exit code `1`. Stderr is `No project matched: missing-plot`.
- **Proof.** The inspect card is the second view of the projects row. Then run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The snapshot's `garden-summary.json` still has `projects[0].display_name` equal to `demo-plot` and `total_tokens` equal to `1650`. A missed inspect does not remove that project.

## Gotchas

- `--project` is a case-insensitive substring of the display name, path, or project key. `demo` matches `demo-plot`. The recipe uses the full display name `demo-plot`.
- Token text on the card is `1.6k` (1650 rounded to one decimal in thousands). The projects table prints the integer `1650`.
- `first` and `latest` are rendered in the local timezone. The stored instant is `2026-05-27T12:00:00Z`. This machine (CST, +0800) shows `2026-05-27 20:00`.
- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`.

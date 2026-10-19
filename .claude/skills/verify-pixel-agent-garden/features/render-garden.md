# Render the ASCII garden

A user renders the vine wall in the terminal. The wall names the garden, counts projects, events, and tokens, and labels the seeded project `demo-plot` as a budding vine.

## Sub-features

- `render-garden-plain`: `agent-garden garden --no-color` prints the wall without ANSI color.
- `render-garden-from-cache`: `agent-garden garden --from-cache` renders the same wall from `events.json`.

## How to get to it (user POV)

- Terminal: `agent-garden --manual-jsonl PATH garden --no-color`.
- Width and height default to 84 and 18. The recipe passes them so the header spacing stays the one that was observed.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh run from `launch`.

- **CLI garden.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature render-garden cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl garden --no-color --width 84 --height 18`. Exit code `0`. Stdout contains `Local Agent Garden`, `1 projects · 1 events · 1.6k tokens`, `1. demo-plot`, `budding`, and `sources: aider x1`.
- **Proof.** Read it back from the cache: run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature render-garden cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh garden --no-color --width 84 --height 18 --from-cache {DATA_DIR}/home/.local-agent-garden/events.json` and `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The cache render contains the same `demo-plot` label and `1 projects · 1 events · 1.6k tokens`. The snapshot's `home/.local-agent-garden/events.json` still holds that one event.

## Gotchas

- The default render emits ANSI color. Comparisons use `--no-color`.
- `--width` is clamped to 58–96 and `--height` to 12–24. Passing 84 and 18 keeps the observed header.
- `--from-cache` does not need `--manual-jsonl`. It still needs the fake `HOME`, because the wrapper requires it, and because a summary render updates rings under that home.
- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`.

# Show one day's token usage

A user asks how many tokens landed on one local calendar day. The seeded event is `2026-05-27T12:00:00Z`, which on this machine is still 2026-05-27, and the report totals 1650 tokens for `demo-plot`.

## Sub-features

- `daily-usage-json`: `agent-garden usage --date 2026-05-27 --json` prints the machine-readable report.
- `daily-usage-text`: `agent-garden usage --date 2026-05-27` prints the same totals as text.
- `daily-usage-other-day`: `agent-garden usage --date 2026-05-26` is a real day with no seeded events.

## How to get to it (user POV)

- Terminal: `agent-garden --manual-jsonl PATH usage --date 2026-05-27`.
- `--date` accepts `today`, `yesterday`, or `YYYY-MM-DD`. This recipe uses the fixture's calendar day.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh run from `launch`.

- **CLI usage --json.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature daily-usage cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl usage --date 2026-05-27 --json`. Exit code `0`. The body has `"date": "2026-05-27"`. `total.total_tokens` is `1650`, `total.event_count` is `1`, `total.input_tokens` is `1200`, and `total.output_tokens` is `400`. `by_project[0].label` is `demo-plot` and `by_source[0].label` is `aider`.
- **CLI usage text.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature daily-usage cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl usage --date 2026-05-27`. Exit code `0`. Stdout begins `usage for 2026-05-27` and contains `demo-plot` with `tokens=1650` and `events=1`.
- **CLI usage empty day.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature daily-usage cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl usage --date 2026-05-26 --json`. Exit code `0`. `"date"` is `"2026-05-26"` and `total.total_tokens` is `0`. This does not delete the 2026-05-27 event.
- **Proof.** The text report is the second view of the JSON report. Then run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The snapshot's `events.json` still contains the 1650-token event. An empty day report does not remove it.

## Gotchas

- `--date` is the local calendar day of `timestamp`, not the UTC date by itself. The fixture instant is `2026-05-27T12:00:00Z`. On this machine (CST, +0800) that is `2026-05-27 20:00`, so `--date 2026-05-27` matches. A zone where that instant falls on another local date must pass that local date; do not change the fixture to force a match.
- `today` follows the machine clock. The recipe uses `2026-05-27` so the result does not depend on the day the harness runs.
- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`.

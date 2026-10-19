# Estimate local cost

A user estimates USD cost from the local price table. The seeded model `manual-model` is not in that table, so the estimate is `$0.00` and all 1650 tokens are reported as unpriced. The line says provider billing is the source of truth.

## Sub-features

- `estimate-cost-json`: `agent-garden cost --json` prints `total.total_usd`, `total.unpriced_tokens`, and `by_project`.
- `estimate-cost-text`: `agent-garden cost` prints the same estimate as text.

## How to get to it (user POV)

- Terminal: `agent-garden --manual-jsonl PATH cost`.
- Add `--json` for the machine-readable estimate.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh run from `launch`.

- **CLI cost --json.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature estimate-cost cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl cost --json`. Exit code `0`. `total.total_usd` is `0.0`, `total.unpriced_tokens` is `1650`, and `total.unpriced_by_model["manual-model"]` is `1650`. `by_project["/tmp/verify-garden/demo-plot"].unpriced_tokens` is `1650`.
- **CLI cost.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature estimate-cost cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl cost`. Exit code `0`. Stdout begins `estimated cost $0.00  (local prices.json — provider billing is the source of truth)` and the next line is `unpriced tokens 1650`.
- **Proof.** The text report is the second view of the JSON estimate. Then run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The snapshot does not gain a user `prices.json` under `home/.local-agent-garden/`; the bundled table is unchanged and the event is still unpriced.

## Gotchas

- This journey expects an unpriced model. A priced model name would produce a non-zero USD total. Do not swap in a known model to make the dollar figure look populated.
- Cost is an estimate. The command does not contact a provider.
- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`.
- `cost` records garden memory, like the other summary commands. See [check-state.md](./check-state.md).

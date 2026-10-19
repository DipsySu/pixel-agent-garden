# pixel-agent-garden verification map

The maintained source for verifying what pixel-agent-garden users can do. Read this index before driving the app, then follow the matching feature file as the recipe. A short pointer also lives at [../FEATURE_MAP.md](../FEATURE_MAP.md).

## Baseline preconditions

- Launch with `.claude/skills/verify-pixel-agent-garden/scripts/control.sh launch`: empty data dir, its own port, JSON with run_id, base_url, data_dir.
- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0 before the first drive.
- Never drive an instance this run did not start.
- Seed data is one synthetic manual JSONL row, written by `scripts/launch-site.sh` during launch, then ingested by the real `scan` and `export-web` commands. The row is source `aider`, project path `/tmp/verify-garden/demo-plot`, session `verify-session-1`, model `manual-model`, timestamp `2026-05-27T12:00:00Z`, 1650 total tokens. Journeys that need a project start from that row.

## Driving conventions

- Run every command from the repo root, literally as written.
- HTTP example: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature export-web-summary http GET /web/data/garden-summary.json --expect 200`.
- CLI example: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature list-adapters cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl adapters --json`. `{DATA_DIR}`, `{PORT}`, `{BASE_URL}`, and `{RUN_ID}` in arguments become this run's values.
- Start each recipe from the state its Preconditions name. Use stable handles: subcommand names, JSON fields, URL paths.

## Proof and skip reporting

- Each drive records the action and its result in `artifacts/verify/<run-id>/`.
- A mutation needs a read-only second view (a GET or a list command), then `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data` for the stored side effect.
- Record the feature id with every artifact (`--feature`).
- Report an unreachable path with the attempted command and the unmet precondition. Never report it as verified through a different path.

## Feature entry contract

Each feature file has an H1, one paragraph of user-visible behavior, then exactly these H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with control.sh`, `Gotchas`. Keep implementation details out: user paths, stable handles, required state, commands, observable proof.

## Features

- [List local adapters](./list-adapters.md): `agent-garden adapters`.
- [Scan activity into events.json](./scan-events.md): `agent-garden scan`.
- [Show projects](./show-projects.md): `agent-garden projects`, `agent-garden inspect`.
- [Render the ASCII garden](./render-garden.md): `agent-garden garden`.
- [Show one day's token usage](./daily-usage.md): `agent-garden usage`.
- [Estimate local cost](./estimate-cost.md): `agent-garden cost`.
- [Check local garden state](./check-state.md): `agent-garden doctor`.
- [Open the garden in the browser fallback](./export-web-summary.md): `agent-garden export-web`, `GET /web/index.html`, `GET /web/data/garden-summary.json`.

## Not mapped yet

- Tauri desktop shell (tray, native menu, settings persistence, file watcher): driving it requires `crates/tauri-app`, and that crate's webkit system libraries are not installed here. The harness must not build it. The same summary the desktop app shows is covered by the CLI plus the static HTTP fallback.

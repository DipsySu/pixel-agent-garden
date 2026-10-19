---
name: verify-pixel-agent-garden
description: "Launch pixel-agent-garden from an empty data dir, drive the agent-garden CLI and the static web fallback over HTTP, and keep evidence under artifacts/verify/. Use for /verify-pixel-agent-garden, before claiming a change works, or to reproduce a bug in the running app."
---

# Verify pixel-agent-garden

Prove behavior on the running app, not a proxy. Every step goes through `.claude/skills/verify-pixel-agent-garden/scripts/control.sh`, run from the repo root. The map is [FEATURE_MAP.md](FEATURE_MAP.md) and [features/README.md](features/README.md).

Primary surface: the `agent-garden` CLI (`target/debug/agent-garden`, package `local-agent-garden-cli`). Secondary surface: the static `web/` browser fallback, served over HTTP from the run's scratch site. The Tauri desktop shell is not part of this harness.

## Launch

- Build once before the first launch, and only the CLI crate. Do not build `crates/tauri-app`.

  `CARGO_BUILD_JOBS=2 cargo build -p local-agent-garden-cli`

- Tests do not replace driving. When you run them, one package at a time: `CARGO_BUILD_JOBS=2 cargo test -p local-agent-garden-core`, then `CARGO_BUILD_JOBS=2 cargo test -p local-agent-garden-cli`.
- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh launch` starts `.claude/skills/verify-pixel-agent-garden/scripts/launch-site.sh` from the repo root on a free port (or `VERIFY_PORT`), with an empty data dir under `${VERIFY_STATE_DIR:-/tmp/verify-pixel-agent-garden-$UID}/<run-id>/data`.
- `scripts/launch-site.sh` is the reproducible fixture. On that empty data dir it writes verification scaffolding at `{DATA_DIR}/fixture/events.jsonl` (one synthetic `aider` row for project `demo-plot`, timestamp `2026-05-27T12:00:00Z`, 1650 tokens), points `HOME` and `XDG_DATA_HOME` at `{DATA_DIR}/home` and `{DATA_DIR}/xdg`, then runs the real CLI: `scan` (cache at `{DATA_DIR}/home/.local-agent-garden/events.json`) and `export-web --out {DATA_DIR}/garden-summary.json`. It serves a scratch copy of `web/` plus `assets/` from the run state directory, with `/web/data/garden-summary.json` linked at that export. Cleanup deletes the scaffolding with the run state.
- Ready means the static garden is usable: `GET /web/index.html` returns 2xx, and doctor proves the seeded summary with `GET /web/data/garden-summary.json`.
- It prints JSON: run_id, pid, port, base_url, data_dir, evidence_dir. The server log is `artifacts/verify/<run-id>/launch.log`.
- It refuses to start while an earlier run in the same state root is alive. Teardown is `cleanup`. Two runs side by side need different `VERIFY_STATE_DIR` values. Never point a run at the real user home or at `~/.claude`, `~/.codex`, or `~/.cursor`.

## Doctor

`.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` is read-only and exits 1 on any failed check: the recorded pid is alive and is still the process this run started, the port answers, `GET /web/index.html` is 2xx, `GET /web/data/garden-summary.json` is 2xx, and the data dir and evidence dir exist. Run it before the first drive and again after any failed drive.

## Drive

- HTTP: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature export-web-summary http GET /web/data/garden-summary.json --expect 200`.
- CLI: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature list-adapters cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl adapters --json`. `{DATA_DIR}`, `{PORT}`, `{BASE_URL}`, and `{RUN_ID}` in arguments become this run's values.
- One recipe per feature in `features/`. Drive the public CLI subcommands and the static HTTP paths only. Every CLI argv goes through `scripts/agent-garden.sh`, which exits 2 if `HOME` or `XDG_DATA_HOME` is missing or lies inside the real user home.

## Evidence

- Every drive writes `artifacts/verify/<run-id>/NNN-<feature>-<http|cli>.json`: the request or argv, the status or exit code, the response body or stdout/stderr, and timing.
- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data` snapshots the data dir (the side effect) and writes `manifest.json` with a sha256 per file. The snapshot holds the fixture, `events.json` under the fake home, and `garden-summary.json`. The static site symlinks live beside the data dir and are not the stored side effect.
- Proof standard: the real user path (CLI subcommands and the browser-fallback URLs, no internal setters); the action and the resulting state, read back through a second view; side effects checked, not inferred. This app has no dry-run scan. `scan` always writes the cache under the fake `HOME`.

## Cleanup

`.claude/skills/verify-pixel-agent-garden/scripts/control.sh cleanup` stops only the process group this run started (pid file plus recorded start identity, never by name), deletes the scratch state and data dir, and keeps `artifacts/verify/<run-id>/`. It prints the evidence path and fails if the evidence is gone.

## Helpers

- `scripts/control.sh`: `launch | doctor | drive | evidence | cleanup | status | prove`. `.claude/skills/verify-pixel-agent-garden/scripts/control.sh --help` lists the arguments.
- `scripts/launch-site.sh`: seeds the fixture, runs `scan` and `export-web`, and execs `python3 -m http.server` on `$PORT` bound to `127.0.0.1`. `control.sh launch` is the invocation.
- `scripts/agent-garden.sh`: the only supported way to run the CLI from a recipe. It requires a disposable `HOME` and `XDG_DATA_HOME`. Invocation is the `env HOME={DATA_DIR}/home ... scripts/agent-garden.sh` form in each feature file.
- One-shot proof: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh prove --feature export-web-summary http GET /web/data/garden-summary.json` runs launch, doctor, drive, evidence, and cleanup, then checks the evidence survived.
- Contract check: `python3 .claude/skills/create-verification-skill/scripts/check_verify_skill.py .claude/skills/verify-pixel-agent-garden`.
- Drift check: `python3 .claude/skills/maintain-verification-skill/scripts/drift_check.py .claude/skills/verify-pixel-agent-garden --repo .`.

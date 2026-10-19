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
- It refuses to start while an earlier run in the same state root is alive, and `prove` then leaves that run, its state, and the `current` marker untouched. Teardown is `cleanup`. Two runs side by side need different `VERIFY_STATE_DIR` values. Never point a run at the real user home or at `~/.claude`, `~/.codex`, or `~/.cursor`.

## Doctor

`.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` is read-only and exits 1 on any failed check: the recorded pid is alive and is still the process this run started, the port answers, `GET /web/index.html` is 2xx, `GET /web/data/garden-summary.json` is 2xx, and the data dir and evidence dir exist. Run it before the first drive and again after any failed drive.

## Drive

- HTTP: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature export-web-summary http GET /web/data/garden-summary.json --expect 200`.
- CLI: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature list-adapters cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl adapters --json`. `{DATA_DIR}`, `{PORT}`, `{BASE_URL}`, and `{RUN_ID}` in arguments become this run's values.
- One recipe per feature in `features/`. Drive the public CLI subcommands and the static HTTP paths only. Every CLI argv goes through `scripts/agent-garden.sh`, which exits 2 if `HOME` or `XDG_DATA_HOME` is missing or lies inside the real user home. The real home comes from the passwd database, not from `HOME`, and a symlink or a different letter case still counts as the home.

## Evidence

- Every drive writes `artifacts/verify/<run-id>/NNN-<feature>-<http|cli>.json`: the request or argv, the status or exit code, the response body or stdout/stderr, and timing.
- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data` snapshots the data dir (the side effect) and writes `manifest.json` with a sha256 per file. The snapshot holds the fixture, `events.json` under the fake home, and `garden-summary.json`. The static site symlinks live beside the data dir and are not the stored side effect.
- Proof standard: the real user path (CLI subcommands and the browser-fallback URLs, no internal setters); the action and the resulting state, read back through a second view; side effects checked, not inferred. This app has no dry-run scan. `scan` always writes the cache under the fake `HOME`.

## Cleanup

`.claude/skills/verify-pixel-agent-garden/scripts/control.sh cleanup` stops only the process group this run started (pid file plus recorded start identity, never by name), deletes the scratch state and data dir, and keeps `artifacts/verify/<run-id>/`. It removes the `current` marker only while that marker still names the run it cleaned. It prints the evidence path and fails if the evidence is gone. `cleanup --run ID --owner TOKEN` acts only on a run that `launch` created with that owner token, and otherwise deletes nothing. `prove` uses that form.

## Helpers

- `scripts/control.sh`: `launch | doctor | drive | evidence | cleanup | status | prove`. `.claude/skills/verify-pixel-agent-garden/scripts/control.sh --help` lists the arguments.
- `scripts/launch-site.sh`: seeds the fixture, runs `scan` and `export-web`, and execs `python3 -I -u -m http.server` on `$PORT` bound to `127.0.0.1`. `control.sh launch` is the invocation. Python tooling runs in isolated mode so ambient `PYTHONPATH` and user startup hooks cannot affect a proof; CI selects Python 3.13 explicitly.
- `scripts/agent-garden.sh`: the only supported way to run the CLI from a recipe. It requires a disposable `HOME` and `XDG_DATA_HOME`. Invocation is the `env HOME={DATA_DIR}/home ... scripts/agent-garden.sh` form in each feature file.
- `scripts/outside-real-home.sh LABEL PATH`: the shared guard behind `agent-garden.sh` and `launch-site.sh`. It prints PATH's physical form, or exits 2 when PATH is missing or inside the real user home. It resolves that home with Python's stdlib `pwd` module, because macOS has no `getent`. Containment is a device+inode check, so symlinks and other letter cases are caught. It refuses whenever the lookup fails.
- One-shot proof: `.claude/skills/verify-pixel-agent-garden/scripts/control.sh prove --feature export-web-summary http GET /web/data/garden-summary.json` runs launch, doctor, drive, evidence, and cleanup, then checks the evidence survived. On any failure it tears down only the run it launched.
- `scripts/skill-checks.sh`: runs the reusable checkers. This repo commits only this skill, so the helper looks for `create-verification-skill` and `maintain-verification-skill` in `$VERIFY_SKILLS_DIR` when that is set, and only there. Otherwise it searches `<repo>/.claude/skills`, `<repo>/.codex/skills`, `${CODEX_HOME:-~/.codex}/skills`, and `~/.claude/skills`. It prints the root it used and exits 2 when none has both skills.
- Contract check, accepted only with a proof: `VERIFY_ARTIFACTS_DIR=artifacts/verify-accept .claude/skills/verify-pixel-agent-garden/scripts/control.sh prove --feature export-web-summary http GET /web/data/garden-summary.json`, then `.claude/skills/verify-pixel-agent-garden/scripts/skill-checks.sh contract artifacts/verify-accept`. It always passes `--require-proof`. That flag accepts any earlier manifest in the evidence root, so start from an evidence root no earlier run wrote to.
- Drift check: `.claude/skills/verify-pixel-agent-garden/scripts/skill-checks.sh drift`. Its route scanner finds no routes in a static-file server, so it exits 1 and lists every `GET /web/...` in the map as `route dead`. Those lines are expected. Any other line is real drift.
- Harness regressions (bash + python3, no cargo build): `bash .claude/skills/verify-pixel-agent-garden/tests/harness-regressions.sh`. CI runs it.

# Check local garden state

A user runs `agent-garden doctor` to see whether the garden's own state files and adapter discovery are healthy. Warnings about a first run are still a successful doctor. An invalid cache would fail it. After launch, the fake home has a writable state directory, a one-event cache, and the manual JSONL source active.

## Sub-features

- `check-state-after-launch`: `agent-garden doctor --json` after launch reports `"ok": true`.
- `check-state-text`: `agent-garden doctor` prints the same checks as text and exits 0 when `ok` is true.

## How to get to it (user POV)

- Terminal: `agent-garden --manual-jsonl PATH doctor`.
- Add `--json` for `ok` plus a `checks` array. Each check has `id`, `status`, `message`, and sometimes `detail`.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh launch, and no other summary command (`projects`, `inspect`, `garden`, `cost`, `export-web`) has been driven yet. Launch itself has already run one `scan` and one `export-web`.

- **CLI doctor --json.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature check-state cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl doctor --json`. Exit code `0`. `"ok"` is `true`. Check `state_dir` is `ok` with message `state directory is writable`. Check `events_cache` is `ok` with detail `1 events; fingerprint absent`. Check `rings` is `ok` with detail `2 memory events`. Check `adapters` is `ok` with detail `active: manual-jsonl; watch paths: 1`. Check `settings` is `ok` and says `settings.toml is absent; defaults will be used`. Check `prices` is `ok` with detail `35 models; user file absent`. Details that mention a path use the `~/.local-agent-garden` form.
- **CLI doctor.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature check-state cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl doctor`. Exit code `0`. The first line is `doctor ok`.
- **Proof.** The text report is the second view of the JSON report. Then run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The snapshot contains `home/.local-agent-garden/events.json` and `home/.local-agent-garden/rings.json`, and it does not contain `home/.local-agent-garden/settings.toml` or a user `prices.json`.

## Gotchas

- This `doctor` is the product command. The harness health check is `control.sh doctor`. They are different.
- On an empty home, before `scan`, product doctor still exits 0. `state_dir`, `events_cache`, `rings`, and `adapters` are `warn`, not `error`. Launch has already scanned, so this recipe expects the post-scan `ok` details above. Do not weaken it to accept the empty-home warnings.
- Each later `projects`, `inspect`, `garden`, `cost`, or `export-web` appends ring memory. After those commands, `rings` detail is no longer `2 memory events`. `events_cache` stays `1 events; fingerprint absent`.
- Omitting `--manual-jsonl` makes the adapters check warn `no local adapters discovered` even when the cache file is present.
- Doctor writes a temporary probe inside the state directory only when that directory already exists, and it deletes the probe. The snapshot must not contain a leftover `.doctor-write-` file.
- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`.

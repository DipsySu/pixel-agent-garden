# Open the garden in the browser fallback

A user exports the summary the static page reads, then opens that page in a browser. The page is `web/index.html`. Its script loads `./data/garden-summary.json`. This harness serves a scratch copy of that tree, so the export does not write the repository's `web/data/garden-summary.json`. The seeded summary names `demo-plot` and carries schema version 9.

## Sub-features

- `export-web-summary-cli`: `agent-garden export-web --out PATH` writes the summary JSON.
- `export-web-summary-http`: `GET /web/data/garden-summary.json` returns that file.
- `export-web-summary-shell`: `GET /web/index.html` returns the page shell, and `GET /web/garden.js` shows the page asks for `./data/garden-summary.json`.

## How to get to it (user POV)

- Terminal: `agent-garden export-web --from-cache CACHE --out garden-summary.json`.
- Browser fallback: open `/web/index.html` on the local static server. The page fetches `/web/data/garden-summary.json`.

## Driving it with control.sh

Preconditions:

- `.claude/skills/verify-pixel-agent-garden/scripts/control.sh doctor` exits 0.
- Fresh run from `launch`. Launch has already exported once to `{DATA_DIR}/garden-summary.json` and linked it at `/web/data/garden-summary.json`.

- **CLI export-web.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature export-web-summary cli -- env HOME={DATA_DIR}/home XDG_DATA_HOME={DATA_DIR}/xdg USERPROFILE={DATA_DIR}/home .claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh --manual-jsonl {DATA_DIR}/fixture/events.jsonl export-web --from-cache {DATA_DIR}/home/.local-agent-garden/events.json --out {DATA_DIR}/garden-summary.json`. Exit code `0`. Stdout is `wrote 1 projects to {DATA_DIR}/garden-summary.json` with the run's data dir substituted.
- **HTTP GET summary.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature export-web-summary http GET /web/data/garden-summary.json --expect 200`. Status `200`. The body has `schema_version` `9`, `active_projects` `1`, `total_events` `1`, `total_tokens` `1650`, and `projects[0].display_name` `demo-plot` with `project_path` `/tmp/verify-garden/demo-plot`, `stage` `3`, and `total_tokens` `1650`.
- **HTTP GET shell.** Run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature export-web-summary http GET /web/index.html --expect 200`. Status `200`. The body contains `<title>Local Agent Garden</title>`. Then run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh drive --feature export-web-summary http GET /web/garden.js --expect 200`. The body contains `const dataUrl = './data/garden-summary.json'`.
- **Proof.** The HTTP GET is the second view of the export. Then run `.claude/skills/verify-pixel-agent-garden/scripts/control.sh evidence --copy-data`. The snapshot's `garden-summary.json` has the same `schema_version`, `display_name`, and `total_tokens` as the GET body. The repository file `web/data/garden-summary.json` is not the file this run wrote.

## Gotchas

- The CLI default `--out` is `web/data/garden-summary.json` relative to the current directory, which is the repository. This recipe always passes `--out {DATA_DIR}/garden-summary.json`. A drive that omits `--out` would overwrite the repo's demo summary.
- The static server is `python3 -m http.server` bound to `127.0.0.1`, rooted at the run's scratch site. That is the documented browser fallback, and the JSON bytes come from `agent-garden export-web`.
- `GET /web/index.html` does not execute the page. It proves the shell is served. The summary GET proves the document the page fetches. Pixel interaction inside the canvas is not driven here.
- Re-running `export-web` appends ring memory. See [check-state.md](./check-state.md).
- Every CLI call needs `HOME={DATA_DIR}/home` and `XDG_DATA_HOME={DATA_DIR}/xdg`.

# Local Agent Garden

A private local garden grown from AI agent activity.

Local Agent Garden turns local AI-agent work traces into a calm project garden. It reads local files only, normalizes different agents into a shared event model, then renders project-level growth in both the terminal and a desktop web prototype.

## Current adapters

- `claude-code`: reads `~/.claude/projects/*/*.jsonl`
- `codex`: reads `~/.codex/state_5.sqlite`, `~/.codex/session_index.jsonl`, and Codex rollout JSONL files when present
- `manual-jsonl`: optional JSONL import for other agents before native adapters exist

No network calls are used.

## Try it

Run these from the project root, the directory that contains `pyproject.toml`:

```bash
python3 -m local_agent_garden garden
python3 -m local_agent_garden scan --out ~/.local-agent-garden/events.json
python3 -m local_agent_garden projects
python3 -m local_agent_garden inspect --project /path/to/project
```

Export data for the pixel garden:

```bash
python3 -m local_agent_garden export-web --out web/data/garden-summary.json
python3 -m http.server 8765
```

Then open `http://127.0.0.1:8765/web/index.html`.

Or install the CLI locally:

```bash
python3 -m pip install -e .
agent-garden garden
```

If you are inside the package directory itself (`local_agent_garden/`), `python3 -m local_agent_garden` will not work unless the package has been installed into that exact Python environment. Either `cd ..` first, or use the editable install command above.

## Manual JSONL format

Use this for Cursor, Aider, Gemini CLI, or any source before a native adapter is added:

```json
{"source":"aider","timestamp":"2026-05-27T09:00:00Z","project_path":"/repo","session_id":"s1","input_tokens":1200,"output_tokens":400,"tool_calls":3}
```

Every field is optional except `source` and `timestamp`; unknown fields are ignored.

## V1 Surface

- Local-only adapters for Claude Code, Codex, and manual JSONL imports.
- Normalized project growth summaries with token totals, sessions, cache ratio, recent activity, and source mix.
- ASCII wall for quick terminal checks.
- Sprite-based pixel garden with one vine per project, token-scaled vine size, pavilion unlocks, trinkets, stone cat, seasonal text, and local-data freshness.
- Empty state for first run; no demo data is shown as real activity.

## Architecture

```text
local agent files
      |
      v
adapters/*.py  ->  AgentEvent
      |
      v
core/aggregate.py  ->  GardenSummary
      |
      +--> ui/ascii_wall.py
      |
      +--> web/data/garden-summary.json -> web/index.html
```

The important boundary is the adapter contract. UI code never knows whether an event came from Claude Code, Codex, or a future agent.

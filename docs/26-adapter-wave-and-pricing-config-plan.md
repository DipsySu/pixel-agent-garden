# 26 — Adapter Wave and Pricing Configuration Plan

> Date: 2026-07-10
> Status: adapter research plan ready; GPT-5.6 defaults and the user price-file
> entry point are implemented in this change.

> 2026-07-11 market correction: Google has deprecated Login with Google for
> Gemini CLI consumer accounts and directs them to Antigravity. Keep the
> implemented Gemini adapter as legacy/Standard/Enterprise/API-key coverage,
> but use `docs/27-top-ai-coding-agents-adapter-research.md` for the current
> market Top 10 and the next adapter execution order.

> 2026-07-11 execution update: Qwen Code exact source usage, Kiro activity, and
> Cursor foreground activity have crossed their evidence gates. Windsurf is an
> explicit no-go until a fixed legacy installation proves a content-free local
> Cascade index; the current official endpoint is Devin Desktop.

## 1. Outcome

The next adapter wave should begin with evidence, not parser code:

1. **P0 research:** Gemini CLI, GitHub Copilot CLI, and OpenCode.
2. **P1 research:** the Cline family (Cline / Roo Code first) and Cursor.
3. **P2 / bridge:** Aider, Continue, and the longer-tail agents stay on
   `manual-jsonl` until a stable local usage record is proven.

The price decision is separate:

- Keep factory prices in `crates/core/src/prices-default.json`.
- Keep user overrides in `~/.local-agent-garden/prices.json`.
- Do **not** move prices into `settings.toml`: preferences and a model-price
  overlay have different schemas, merge rules, and release cadences.
- Make the existing price file discoverable next to **Open Settings** in the
  native menu. A missing file starts as an empty override table so unedited
  factory rows continue receiving release updates.

## 2. Review Method

This plan combines three inputs:

- the repository contracts in `docs/11-tauri-rust-rewrite-spec.md`,
  `docs/architecture.md`, and `docs/23-adapter-development-guide.md`;
- a read-only Claude Code CLI review using `claude-fable-5` with
  `effort=xhigh`;
- current first-party product documentation, checked on 2026-07-10.

The Claude review correctly identified Gemini CLI and the Cline family as
strong candidates and recommended preserving `prices.json`. It initially put
GitHub Copilot CLI in the watch list because it assumed the local shape was
undocumented. Current GitHub documentation now explicitly describes
`~/.copilot/session-state/<session-id>/events.jsonl` and
`~/.copilot/session-store.db`, so this plan promotes Copilot CLI into P0
research. The same evidence-first correction applies to OpenCode, whose current
CLI exposes session JSON, token statistics, and sanitized export.

## 3. Non-Negotiable Adapter Gate

No native adapter is implemented until its issue/PR contains:

- a stable path matrix for macOS, Linux, and Windows where applicable;
- at least two redacted fixtures from different source versions;
- one record proving timestamp, project/workspace, session id, model, tool
  calls, and the best available token precision;
- a documented dedupe key;
- a statement of whether counts are API-reported, client-estimated, cumulative,
  or per-turn;
- confirmation that source directories are only read and all tests use temp
  fixtures instead of the real home directory.

If a source has no persisted token usage, it may still be valuable as an
activity adapter, but its proposal must say that clearly. It must not infer
tokens from text length or provider pricing.

## 4. Priority Matrix

| Priority | Source | Evidence available now | Expected precision | Decision |
|---|---|---|---|---|
| P0 | Gemini CLI | project-scoped auto sessions under `~/.gemini/tmp/<project_hash>/`; `/stats model` reports token usage | potentially exact input/output/cached usage; fixture must prove persisted fields | research, then native if the saved chat carries usage |
| P0 | GitHub Copilot CLI | `~/.copilot/session-state/*/events.jsonl` plus local `session-store.db`; official docs describe tools/files/session history | unknown until fixture identifies token events; activity/tool counts are already plausible | research the JSONL first; never depend on the synced remote copy |
| P0 | OpenCode | current CLI has `session list --format json`, `stats`, and sanitized `export`; current installs use a local SQLite store | expected exact per-message split including cache, but DB schema needs a versioned fixture | native SQLite adapter after schema proof; export-to-manual bridge first |
| P1 | Cline / Roo Code | task folders in VS Code-family `globalStorage`; Cline documents task/request token and cost tracking | likely exact request input/output and provider-dependent cache values | one shared parser helper with two independent adapters after path/schema matrix |
| P1 | Cursor | official docs confirm local SQLite chat history; background-agent history is remote | token fields are not part of the public contract | native only if two current fixtures prove stable token rows; otherwise activity-only or bridge |
| P2 | Aider | repo-local Markdown/input history; optional raw LLM history | persisted usage is not guaranteed by the normal history files | keep manual bridge until an opt-in structured usage log is proven |
| P2 | Continue | local development/event data exists across product modes | chat, agent, and autocomplete semantics may be mixed | require a versioned fixture and an explicit filter that excludes autocomplete noise |

Watch-list sources for a later wave: Kimi Code CLI, Qwen CLI, Pi / OMP, Warp,
Goose, Codebuff, Mux, Kilo Code, and IBM Bob. They should use
`manual-jsonl` until the same gate is satisfied.

## 5. P0 Parsing Research

### 5.1 Gemini CLI

First-party baseline:

- `/resume` automatically saves project-scoped conversations.
- saved chat/checkpoint data lives below `~/.gemini/tmp/<project_hash>/` on
  macOS/Linux (with the corresponding home path on Windows).
- `/stats session`, `/stats model`, and `/stats tools` expose duration,
  token, quota, and tool statistics.

Fixture questions:

| Normalized field | Evidence to find |
|---|---|
| `timestamp` | per-message timestamp; file mtime is fallback only |
| `project_path` | a reversible cwd/workspace value, not a guessed hash |
| `session_id` | auto-session id reused by resume |
| `model` | canonical API id rather than `auto` display label |
| `usage` | prompt, candidates/output, cached input, and thought/reasoning semantics |
| `tool_calls` | structured function-call records |
| dedupe | native message id; otherwise session id + message ordinal |
| `watch_paths()` | the smallest stable project-session root; confirm append vs rewrite |

Go/no-go: native only if saved rows contain usage or a lossless relation to a
local stats record. A session browser alone is not token evidence.

### 5.2 GitHub Copilot CLI

First-party baseline:

- each local session has `~/.copilot/session-state/<id>/events.jsonl`;
- `~/.copilot/session-store.db` is a derived cross-session index and can be
  rebuilt from the session files;
- the recorded session includes prompts, responses, tool use, and modified-file
  details; remote sync is optional and outside this product's adapter path.

Preferred parser: JSONL is the authoritative source; use SQLite only if a
fixture proves that token usage is present there but absent from JSONL. This
avoids binding the adapter to a derived index.

Fixture questions:

- identify start/session/cwd/model/token/tool event types;
- distinguish context-window counters from billable request usage;
- confirm whether token fields are cumulative or per request;
- use a native event/message id for dedupe, otherwise session id + line number;
- never invoke `/chronicle`, reindex, or remote sync from the adapter.

### 5.3 OpenCode

First-party baseline:

- `opencode stats` reports session token/cost/model/tool totals;
- `opencode session list --format json` exposes session inventory;
- `opencode export <session-id> --sanitize` provides a safe bridge while the
  native store is being researched;
- current installs use a local SQLite database, but the product has had legacy
  storage forms and multiple release channels.

Fixture questions:

- enumerate `opencode*.db` through the XDG data root without opening auth data;
- map session project/cwd and parent/sub-session relationships;
- map per-message provider/model and input/output/reasoning/cache read/write;
- prove whether parent sessions already include sub-session usage before
  deciding inclusion;
- use session id + message id for dedupe;
- watch the database parent directory, not credentials or logs.

Go/no-go: read SQLite in immutable/read-only mode and keep legacy parsing in a
separate helper. Never run `opencode stats` during a normal garden scan.

## 6. P1 Research

### Cline family

Treat Cline, Roo Code, and later Kilo Code as independent source ids backed by a
shared pure parser helper. Each adapter owns discovery and path enumeration;
adapters do not call each other.

Research `ui_messages.json` request-start/completion rows and the adjacent API
conversation metadata. The path matrix must cover VS Code, Insiders, VSCodium,
remote-server storage, and source-specific publisher ids. A task id plus native
request/message id is preferred for dedupe. If stored cost is present, preserve
it in `metadata`; the garden's USD estimate still comes from `core::prices` so
one source cannot bypass the local price table.

### Cursor

Cursor is high demand but high drift. The public contract guarantees local
SQLite chat history, not table names or token fields; background-agent data is
remote and is out of scope. The research PR must cover at least two Cursor
versions and open the database read-only. If only chat text exists, do not
estimate tokens from text. Ship an activity-only adapter only if sessions,
project identity, and timestamps are stable enough to be useful.

## 7. Price Configuration Contract

The existing design already satisfies the storage requirement:

```text
bundled prices-default.json
          +
~/.local-agent-garden/prices.json   (user entries win by exact model id)
          ↓
effective PriceTable -> core::prices::estimate_summary
```

User file example:

```json
{
  "schema_version": 2,
  "prices": {
    "my-provider/my-model": {
      "input_per_mtok": 1.25,
      "output_per_mtok": 5.0,
      "cache_read_per_mtok": 0.125,
      "cache_write_per_mtok": 1.25
    }
  }
}
```

Rules:

- rates are USD per million tokens;
- exact model ids only; no wildcard or "nearest model" fallback;
- unknown models remain unpriced;
- missing user file means all factory defaults;
- only models the user edits belong in the override file;
- deleting a user entry restores the shipped default for that model;
- malformed/future-versioned user files are reported and never quarantined;
- all cost math stays in `core::prices`; frontend code only displays results.

Why not `settings.toml`: settings is a full user-preference document, while
prices is an overlay whose untouched rows must keep changing with releases.
Combining them would either pin every factory price or force price-specific
merge semantics into unrelated appearance/desktop settings.

This change adds **Open Model Prices / 打开模型价格** beside **Open Settings**
in the native app and tray menu. Future UI polish may add a row editor, but it
must load factory + override layers separately and write only real overrides.

## 8. GPT-5.6 Pricing Decision

The bundled table uses OpenAI's **Standard / short-context** prices checked on
2026-07-10:

| Model id | Input | Cached input | Cache write | Output |
|---|---:|---:|---:|---:|
| `gpt-5.6-sol` | 5.00 | 0.50 | 6.25 | 30.00 |
| `gpt-5.6-terra` | 2.50 | 0.25 | 3.125 | 15.00 |
| `gpt-5.6-luna` | 1.00 | 0.10 | 1.25 | 6.00 |

The same official table has a separate higher long-context tier. Current local
agent events do not record the per-request context threshold needed to apply it
honestly, so the app keeps its existing short-context default and labels totals
as estimates. Users with a known long-context workload can override the four
rates locally.

`GPT-5.6 Sol Pro` appears as a ChatGPT product option, but no matching standard
API per-token row/model id is published in the API price table used here. It
therefore remains unpriced instead of inheriting a guessed Sol/Pro rate.

## 9. Delivery Milestones

### M0 — price refresh and discoverability

- [x] add the three published GPT-5.6 API ids and four standard rates;
- [x] lock the rows with bundled-default tests;
- [x] add a native menu entry that creates an empty override file when absent;
- [x] document the file shape, merge rules, and long-context limitation;
- [ ] manually smoke-test opening `prices.json` in a packaged desktop app.

### M1 — P0 fixture pack

> Executed 2026-07-11 with a stated deviation: the development machine had no
> real session data for any P0 source (empty `~/.gemini` / `~/.copilot`, no
> OpenCode install), so the "redacted fixture" evidence was replaced by
> upstream SOURCE-CODE evidence — the serializer/storage code that writes the
> files — with URLs, commit/version, and verification date recorded in each
> adapter's module doc. Real-machine fixtures should be spot-checked against
> these adapters as soon as any P0 source produces local data.
>
> Follow-up 2026-07-11: Copilot CLI 1.0.70 produced a real local session. Its
> redacted envelope and unchanged API metrics now back the modern fixture;
> a read-only CLI scan matched raw `inputTokens` (including cache) plus
> `outputTokens` exactly. Gemini remains unavailable locally and OpenCode has
> no session database yet.

- [x] Gemini CLI: current `.jsonl` + legacy whole-file `.json` fixtures, with
  cached-request usage and tool-call records (evidence:
  `chatRecordingService.ts` / `chatRecordingTypes.ts` / `storage.ts` /
  `projectRegistry.ts`, main + v0.33.0);
- [x] Copilot CLI: modern metrics-bearing session + legacy 1.0.54-era
  no-`ephemeral` session fixtures (evidence: official config-dir docs,
  upstream schema issues #3520/#3551, two independent community parsers);
- [x] OpenCode: current SQLite plus flat-JSON and legacy per-project tree
  fixtures (evidence: `sst/opencode` dev@9976269 storage/session/schema
  sources, v0.6.3 legacy mapping);
- [x] go/no-go notes: all three are GO as native usage adapters — Gemini CLI
  and OpenCode carry exact per-message API usage; Copilot CLI carries exact
  per-session cumulative API totals and degrades to activity-only for
  sessions without a metrics event.

### M2 — first native adapters

- [x] implement one adapter per file, registered through `mod.rs` + registry
  (`copilot-cli`, `gemini-cli`, `opencode`; `manual-jsonl` stays last);
- [x] keep shared format helpers pure and source-neutral (no new shared
  helper was needed; each adapter is self-contained per the one-file rule);
- [x] add temp-directory fixtures and expanded parser-hardening coverage:
  two-era fixtures, corrupt-line/malformed-store skips,
  per-model/cross-day truthfulness, XDG override, fallback recovery, dedupe
  stability, cache upgrade, discover negatives, and watch-path credential
  exclusion;
- [x] add cross-source dedupe tests only in `scan.rs`
  (`dedupe_stays_source_scoped_across_the_p0_adapter_wave`: identical uuid
  text across gemini-cli/opencode stays separate; Copilot's per-model native
  synthetic ids remain stable across rescans);
- [x] update architecture, README, adapter inventory, and changelog;
- [x] bump raw-event cache schema to v2 so cached mixed-model Copilot rows are
  rejected and rebuilt from the unchanged source session files;
- [x] pass fmt, clippy `-D warnings`, and workspace tests (182 passed).

### M3 — P1 evidence and decision

- [ ] Cline/Roo path matrix and request-token semantics;
- [x] Cursor 3.11.13 package + real-machine SQLite study: ship activity-only
  from structural `composerHeaders`, exclude draft/background/cloud/body
  stores, and keep mutable cumulative token state unpriced;
- [x] Windsurf explicit no-go: the current official endpoint is Devin Desktop,
  and fixed Windsurf 2.3.15 has no proven content-free Cascade index; require a
  two-workspace legacy fixture before reopening;
- [x] Qwen Code 0.19.9 source-reported usage adapter and Kiro CLI 2.12.1
  activity-only adapter, both spot-checked against real local storage;
- [ ] keep Aider/Continue on `manual-jsonl` unless their evidence crosses the
  native gate.

## 10. Primary Research Links

- [Gemini CLI commands and session management](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/commands.md)
- [GitHub Copilot CLI local configuration/session layout](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [GitHub Copilot CLI session-data concepts](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/chronicle)
- [OpenCode CLI session/stats/export commands](https://dev.opencode.ai/docs/cli/)
- [Cline token/cost tracking](https://github.com/cline/cline/blob/main/README.md)
- [Cursor local history contract](https://docs.cursor.com/en/agent/chat/history)
- [Aider history-file configuration](https://github.com/Aider-AI/aider/blob/main/aider/website/assets/sample.aider.conf.yml)
- [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI GPT-5.6 preview and cache policy](https://openai.com/index/previewing-gpt-5-6-sol/)

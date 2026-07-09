# 25 — Model Pricing Refresh

Date: 2026-07-09

This note records the sources used for the bundled `core::prices` defaults in
`crates/core/src/prices-default.json`.

The app never fetches pricing at runtime. The bundled table is a release-time
snapshot used for local estimates only; user overrides in
`~/.local-agent-garden/prices.json` still win per model id.

## Sources

- OpenAI API pricing, "Flagship models"
  (`https://developers.openai.com/api/docs/pricing`): `gpt-5.5`, `gpt-5.5-pro`,
  `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, and `gpt-5.4-pro` standard
  short-context USD rates.
- OpenAI API pricing, "Specialized models"
  (`https://developers.openai.com/api/docs/pricing`): `chat-latest` and
  `gpt-5.3-codex` standard USD rates.
- Anthropic Claude Platform pricing, "Model pricing"
  (`https://platform.claude.com/docs/en/about-claude/pricing`): Claude Fable
  5, Opus 4.8/4.7/4.6/4.5, Opus 4.1, Sonnet 5 introductory pricing through
  2026-08-31, Sonnet 4.6/4.5/4, Haiku 4.5, and Haiku 3.5 USD rates.
- Anthropic Claude model IDs and deprecations pages
  (`https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions`
  and `https://platform.claude.com/docs/en/about-claude/model-deprecations`):
  used to keep canonical
  current Claude ids (`claude-opus-4-8`, `claude-sonnet-5`,
  `claude-sonnet-4-6`) while retaining a small set of historical ids that may
  still appear in local logs.

## Boundary

OpenAI Codex credit pricing is not converted into USD in this table. Credits
are a Codex product billing unit, while `core::prices` estimates USD from API
per-token rates. Model ids that only have credit pricing remain unpriced unless
OpenAI also publishes a USD per-token API rate for that id.

Some older OpenAI ids from previous releases are retained so historical local
logs do not abruptly become unpriced. This refresh does not certify those
legacy ids as current OpenAI offerings; the current-id path is the source list
above.

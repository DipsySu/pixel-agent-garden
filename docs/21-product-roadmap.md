# 21 — Product Roadmap: 2026H2 → 2027H1

Status: draft for discussion · Written: 2026-07-07 · Horizon: ~12 months
Companion docs: [11 (architecture contract)](./11-tauri-rust-rewrite-spec.md),
[17 (trust hardening)](./17-launch-trust-hardening-spec.md),
[20 (release validation)](./20-release-validation-checklist.md).

This is a *product* document: what we ship, in what order, and — just as
deliberately — what we refuse to ship. Engineering contracts stay in doc 11.

---

## 1. Positioning: what this thing is

> **Your AI-coding life, grown into a courtyard — and it never leaves your
> machine.**

Pixel Agent Garden sits at the intersection of three possible identities:

| Identity | Value | Competitive reality |
|---|---|---|
| **A. Ambient companion** — a digital pet/diary for your agent activity | Emotional. Nobody uninstalls the thing they're fond of | Nobody else does this. This is the moat |
| **B. Usage analytics** — local token dashboard | Utility. A reason to *glance* daily | Commoditized (ccusage, various dashboards). We can't win on charts alone |
| **C. Share artifact generator** — postcards, recaps | Growth. Every shared postcard is an ad we didn't buy | Cheap to build on top of A; worthless without A |

**Decision: A is the product, C is the growth engine, B is the supporting
cast.** When two features compete for a slot, the one that makes the garden
feel more *alive* wins over the one that adds another chart. The Insight panel
exists so the garden has answers when you ask "wait, how much did that cost?" —
not the other way around.

**Who it's for:** developers who run terminal/desktop AI agents daily
(Claude Code, Codex, Cowork today) and feel *something* about that — pride,
curiosity, or unease about how much of their work now flows through agents.
The privacy stance is not a feature checkbox for them; it's the reason this
app is allowed to read `~/.claude` at all.

## 2. Product principles (the say-no machine)

1. **Garden over charts.** The scene is the home screen. Numbers appear when
   summoned, never by default.
2. **Calm over gamification.** Growth, unlocks and history — yes. Streak
   guilt, red badges, "you're falling behind" — never. A garden that shames
   you is a treadmill.
3. **Local over everything.** Zero network at runtime is the brand, not a
   setting. Any feature that "would be better with a server" is a different
   product.
4. **Every feature must be deletable.** (Inherited from CLAUDE.md §设计约束.)
   If removing a feature touches more than its own module + one mount line,
   it was built wrong.

## 3. Non-goals — permanent, not "later"

- **No accounts, no cloud sync.** Ever. The postcard is how state travels.
- **No telemetry, not even opt-in.** We accept flying blind on DAU as the
  cost of the brand promise.
- **No LLM calls inside the app.** We *observe* agents; we don't become one.
  (An "AI summarizes your week" feature would also break zero-network.)
- **No plugin runtime / dynamic adapter loading.** Adapters are compiled in
  via PRs. A plugin system is a supply-chain attack surface strapped to an
  app whose whole pitch is trust.
- **No team/org dashboard.** That product wants telemetry, admin, and SSO —
  the exact things we refuse. Someone else can build it.
- **No mobile.** The data source lives on dev machines.

## 4. Strategic risks and the bets against them

| Risk | Reality check | Bet |
|---|---|---|
| **Novelty decay** — cute for two looks, forgotten by Friday | This kills 90% of desktop toys | Ambient presence (tray-first), day-scale visible change (weather/season/growth already exist), rare events worth catching. The app must reward a *2-second glance*, not demand a session |
| **Agent churn** — today's Claude Code is tomorrow's legacy tool | Agent CLI landscape reshuffles every quarter | Adapter breadth + a "write an adapter in an hour" contribution path. The garden doesn't care whose logs it reads — that's our hedge |
| **Trust ceiling** — "an app that reads ~/.claude? no thanks" | Unsigned bundles + a scary permission = dead on arrival for cautious users | Signing/notarization, public zero-network CI gate, PRIVACY.md, everything open source. Trust artifacts are product features here |
| **Solo maintenance bandwidth** | One person + AI pair, evenings | Phases sized ≤ a few weeks, each independently shippable; aggressive non-goals; community handles adapter long-tail |

## 5. Phases

Versions are intents, not promises. Each phase has an exit criterion so we
know it's done rather than abandoned.

### Phase R — Ship v1.1.0 — ✅ SHIPPED 2026-07-06

`v1.1.0` is tagged and published on GitHub Releases (2026-07-06); doc 20
desktop validation (CSP, postcard native save, zero-network observation)
passed and is recorded in the repo. Remaining loose end folded into Phase A:
launch posts (Show HN, V2EX, r/ClaudeAI) can go out any time — unsigned is
tolerated there; hold Product Hunt until signing lands.

**Exit (met):** release page live. Still watching for: first outside issue.

### Phase A — Trust & reach, v1.2 (2–6 weeks)

Distribution compounds everything after it, so it goes first.

- **Code signing + notarization** (macOS Developer ID; Windows via an OSS
  signing service or a cert). This is the single highest-leverage task in
  the whole roadmap.
- **Tauri updater** — only after signing (updater trust chain needs keys).
- **Package managers:** Homebrew cask, winget, AUR. Public download counts
  double as our only "metrics dashboard".
- **One-page site** (GitHub Pages, static, zero JS trackers — the site
  itself demonstrates the ethos): screenshots, the privacy pledge, install
  one-liners.

**Exit:** `brew install --cask` works on a clean Mac with no Gatekeeper
override; in-app update from v1.2.0-pre to v1.2.0 succeeds.

### Phase B — Adapter wave, v1.3 (in parallel with A where possible)

Each adapter is a new audience with zero product changes.

- **Ship 2–3 by demand**, validating log formats at implementation time.
  Current best guesses: **Gemini CLI** (`~/.gemini/`), **OpenCode**,
  **Aider** (`.aider.chat.history.md` / analytics jsonl). Runner-ups:
  Cline, Goose, Amp.
- **"Adapter in an hour" guide**: a doc + fixture template + checklist
  (trait impl, registry line, fixture test — mirrors doc 11's contract).
  The goal is that the *fourth* adapter of this phase arrives as a community
  PR, not from us.
- **Adapter request** issue template with a "paste 3 redacted log lines"
  field, so triage is data-first.

**Exit:** ≥2 new adapters shipped; ≥1 external adapter PR opened (even if
imperfect — the funnel existing is the point).

### Phase C — A living garden, v1.4 (1–2 months after B starts)

The retention phase. Everything here serves the 2-second glance.

- **Tray-first ambient mode:** launch-at-login (opt-in), tray icon that
  reflects today's state (lantern lit/unlit), menu shows today's tokens +
  top project without opening the window.
- **Unlock moments:** when a tier flips (pavilion grows, trinket appears,
  the 500M cat shows up), the *change* is celebrated once — a quiet toast in
  scene, no badge counters. New-sprite `.is-new` tagging already exists;
  finish the loop.
- **Garden history / 年轮 (tree rings):** a calm "how this garden grew"
  view — first vine, first pavilion upgrade, busiest week. This is the
  anti-streak: it only accumulates, never resets, never shames.
- **Weekly recap postcard:** Monday's first open offers last week's card
  (reuses the existing postcard + return-diff machinery; pure local).

**Exit:** a tester who didn't open the main window all week can still say
what their garden did, from the tray + one Monday postcard.

### Phase D — Insight that earns its seat, v1.5 (parallel, on demand)

Only ships where a real question exists. Every item must answer something a
user actually asked.

- **Local cost estimation:** editable per-model price table shipped as a
  local JSON (user-adjustable, no fetching); daily/monthly estimated spend
  in Insight. The #1 practical question ("how much is this costing me?").
- **Per-agent split:** garden already knows the source adapter per event;
  show Claude vs Codex vs others as a breakdown — and explore the flagship
  idea of **agent → garden region mapping** (each agent tends its own
  corner). Prototype behind a query flag first; it's a big visual bet.
- **Data export:** CSV/JSON of daily tokens per project. It's the user's
  data; let them take it.

**Exit:** cost question answerable in two clicks; export exists; region
mapping has a go/no-go decision with a prototype screenshot.

### Phase E — Seasonal & the year loop, v2.0 (calendar-driven; Dec 2026)

- **Year in Review postcard set** ("你的 2026 数字庭院年报"): total tokens,
  garden final state, first/busiest days, agents used. Timed for December —
  the single biggest organic share moment of the year. Design starts
  November.
- **Seasonal live moments** on the real calendar (cherry season, koi
  festival, first snow) — the season system already exists; this adds a few
  date-triggered variants, not a content treadmill.
- **Sticker packs / scene variants** only if community asks; config already
  supports swapping sets.

**Exit:** year-review card ships in the first week of December; at least a
handful of them spotted in the wild.

## 6. Measuring without telemetry

We measure at the edges, where users already chose to be public:

- Release download counts + Homebrew/winget public analytics (trend, not DAU).
- GitHub: stars velocity, issues opened by non-authors, adapter PRs.
- Postcards observed on social media (they carry the app name by design).
- A pinned "how's the garden doing for you?" discussion thread — qualitative,
  opt-in, honest.

We will *not* know true DAU. That is the deal we made, and we say so out loud
in the README — it's a trust feature, not an apology.

## 7. Sequencing rationale & review cadence

Ship (R) before polish because feedback beats speculation. Trust (A) before
reach-building features because unsigned builds cap every later effort.
Adapters (B) before retention (C) because retention features multiply across
whoever is already here — a bigger "here" first is compound interest.
Insight (D) stays demand-driven so principle #1 (garden over charts) survives
contact with feature requests. The year loop (E) is calendar-locked.

Revisit this document at each phase exit (or ~monthly): kill items that
stopped earning their place, promote what users actually pull for. The
roadmap obeys the same rule as the code — **every line must be deletable.**

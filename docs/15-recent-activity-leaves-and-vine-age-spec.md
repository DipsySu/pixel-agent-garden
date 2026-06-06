# Spec 15 — Per-project recent-activity fresh leaves

Status: **v2 — direction AGREED with codex (round 1). SCOPE = Item A only; Item B
(first_seen→length) DEFERRED. codex implements.**
Owner: frontend render layer (`web/render-garden.js`, `web/index.html` CSS)
Scope: surface the `recent_activity → fresh leaf overlays` Growth-Mapping contract
per project. Pure frontend, existing `leaf_cluster` sprites, no core change.
Non-scope: `crates/core/**`, schema, new art, manifest cleanup, and **Item B**
(see §3.B — deferred this batch by consensus).

> Continues the "garden reflects activity" theme (specs 12/13/14). codex round-1
> verdict: AGREE, **scope = A only** — B is not worth shipping now (the vine
> already encodes width/strands/frame/tint/hue = 5 signals; a `scaleY` length over
> the narrow 9–37-day range distorts pixel art for little gain, and would make the
> render time-dependent). codex implements A.

## 1. Why

`docs/sprite-rendering.md:30-32` promises *"Recent activity controls fresh leaf
overlays."* The 8 `leaf_cluster` sprites are consumed ONLY by `addVineCornice`
([render-garden.js:842](../web/render-garden.js)) as a static decorative cornice
indexed by tile position — never by any project's activity. `unlockTier` only
**sums** `recent_activity` across all projects for the global cherry tier
([render-garden.js:452](../web/render-garden.js)), so a single very-active vine
looks identical to a dormant one. (codex confirmed `addVineCornice` is the sole
runtime `leaf_cluster` consumer.)

## 2. Data facts (committed sample, 17 projects)

`recent_activity` is highly skewed — one ≈125k, a few in 2k–45k, and **8 of 17 are
exactly 0** (codex-corrected from "~9"). So `0` must mean **"no fresh leaves"
(neutral)**; only `>0` projects get accents, count scaled vs the wall max.

## 3. Deliverables

### A. recent_activity → fresh leaf overlays *(codex implements)*
- In `addIvyOverlay`, for each project whose **primary** strand is placed and whose
  `recent_activity > 0`, scatter **`freshLeaves` extra `leaf_cluster` sprites**:
  `freshLeaves = clamp(round( (log1p(recent_activity)/log1p(maxRecent)) * 3 ), 0, 3)`
  (`maxRecent` = max per-project `recent_activity` on the wall). Most-active → ~3,
  mid → 1–2, zero → none.
- **[v2] codex-locked placement**: a **small-radius deterministic scatter just
  below the strand crown, near the primary strand's `x`** — NOT spread along the
  whole strand, and NOT up in the cornice top band (so it doesn't compete with
  `addVineCornice`'s reading). Compute the crown `(x, y)` from the same primary
  strand the spec-13 loop already places (it's the `crownAnchors`-eligible point).
- **[v2] z-order**: **below the cornice (z<61) and above the vines (z>~22)** so
  fresh leaves nestle on the vine, under the cornice band.
- **[v2] class** = `vine-fresh-leaf` (new, styled like foliage — reuse the
  `vine-cornice` filter tone); **decorative** — do NOT pass `project` (no
  `.roving-vine`); `pointer-events:none`.
- Each accent: `pick(leaf_cluster, …)` frame (deterministic index from
  `projectIndex` + accent index), small width, modest opacity, slight `jitter`
  offset.
- **[v2]** Only the **primary** strand spawns fresh leaves (decorative spec-13
  strands do not) — keeps attribution clean and the wall calm (codex).
- Bound: cap at 3/project + reuse the project-count/`densityScale` guard so a dense
  wall doesn't clutter. Deterministic (`jitter`/`pick`; **no `Math.random`**).
  `0`/absent `recent_activity` ⇒ no accents ⇒ today's look (regression guard).

### B. first_seen → hanging-vine length *(DEFERRED — out of this batch)*
Deferred by codex r1 consensus: vine already encodes 5 signals; a `scaleY` length
over the narrow 9–37-day age range distorts pixel art for little gain and makes the
render time-dependent. Kept here for the record. **If** ever revived: a
`--vine-length` (default 1) `scaleY` on hanging primary strands, threaded through
the resting `.pg6-sprite.project.hanging` transform + `:hover`/`:focus-visible`
(index.html:149/160) + the `@keyframes pg6-vine-grow-in` end stop (line 330); the
existing hanging `transform-origin: top center` is already inherited (codex — no
new origin needed). Not implemented now.

### C. Docs
- `docs/sprite-rendering.md`: mark recent_activity→fresh leaves realized.
- `CHANGELOG.md` `## Unreleased`: a `feat:` line.

## 4. Constraints / invariants
- **No core change.** `recent_activity` already in the summary.
- **Graceful degradation**: `0`/absent ⇒ no accents (today's look). No errors on
  older caches / browser fallback.
- **Determinism**: `jitter`/`pick`, **no `Math.random`**.
- **No clutter regression**: capped at 3/project + density-gated; below the cornice.
- **a11y unchanged**: accents never add focusable elements or touch the
  one-roving-vine-per-project model.
- **Modularity (CLAUDE.md §10)**: JS only in `web/`.

## 5. Resolved decisions (codex round 1)

| # | Question | Decision |
|---|---|---|
| 1 | A count curve | `clamp(round(log1p(ra)/log1p(maxRa)*3),0,3)` — agreed |
| 1 | A placement | small scatter just below the crown, near the primary strand x; NOT along strand; NOT in the cornice band |
| 1 | A z / class | z below cornice (<61) & above vines; class `vine-fresh-leaf`, `pointer-events:none`, no `project` |
| 2 | Item B (length) | **DEFER** — not worth it now (signal overload + scaleY distortion + time-dependence) |
| 4 | which strands | **primary only** (decorative spec-13 strands get no fresh leaves) |

## 6. Verification (Claude runs after codex implements)
- The ≈125k-recent project shows ~3 fresh leaf accents near its vine crown; mid
  projects 1–2; the **8** zero-recent projects show **none** (unchanged).
- Accents are `pointer-events:none`, add **no** `.roving-vine`, no console errors;
  rendered `leaf_cluster` count rises only near active projects; z sits below the
  cornice, above the vines.
- spec-13 vine behavior intact (17 roving / 28 strands, tint, frames).
- Deterministic across a settings-toggle re-render; `cargo fmt` n/a (no Rust).

## 7. Rollback
Pure additive render logic. Remove the fresh-leaf loop + the `vine-fresh-leaf` CSS.
No data/schema/core/asset change.

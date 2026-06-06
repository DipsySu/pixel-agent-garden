# Spec 13 — "Garden reflects activity": session strands, vine variant rescue, cache-health tint

Status: **Implemented in v0.1.2 (codex-reviewed v2).**
Owner: frontend render layer (`web/render-garden.js`, `web/render-helpers.js`, `web/index.html` CSS)
Scope: pure render-wiring of EXISTING sprites against EXISTING `GardenSummary` fields.
Non-scope: `crates/core/**` (no schema/aggregation change), no new sprite art, atlas/manifest pruning (separate backlog).

> codex (gpt-5.5) reviewed v1 read-only → CHANGES NEEDED. v2 folds in all 3 must-fix
> items + every §5 decision. Diffs marked **[v2]**.

## 1. Why (three written-but-unmet contracts, all grounded + codex-verified)

1. **Session count → hanging strands.** `docs/sprite-rendering.md:36` promises it,
   but `addIvyOverlay` emits exactly **one** `addSprite` per project; `sessions`
   only feeds the stone_cat/cairn tier. 2-session vs 8-session render identically.
2. **Buried vine frames.** `pickByToken = Math.round((level-1)/4*(len-1))`
   ([web/render-helpers.js:30-33](../web/render-helpers.js)) over 8-frame groups at
   levels 1..5 yields only indices `{0,2,4,5,7}`; hanging is gated `level>=3`
   ([web/render-garden.js:754](../web/render-garden.js)) → only `{4,5,7}` (frames
   05/06/08). Dead: `hanging_vine_01/02/03/04/07` + `vertical_vine_02/04/07` —
   8 hand-authored frames unreachable. *(codex confirmed the index math.)*
3. **cache_ratio invisible.** `docs/sprite-rendering.md:38` promises it;
   `cache_ratio` is computed (`aggregate.rs:421-427`) and per-project in the
   summary, but no render code reads it.

## 2. The cache_ratio=0 trap (decided up front)

`aggregate.rs:421-427`: `denom==0 ? 0.0 : cache_read/denom`; unit test (`:633-637`)
asserts `cache_ratio(100,0,0)==0.0`. In the committed sample **11 of 17 projects are
exactly `0.0`** — including a 45M-token project (`input/cache_* == 0` but
`total_tokens` huge) — so `0.0` is overwhelmingly **"source reported no cache
fields"**, not cold cache. Non-zero values cluster ≈`0.30` and ≈`0.94–0.998`.
*(codex confirmed.)*

**Decision:** `cache_ratio == 0` (or absent) ⇒ **neutral, no tint** (today's exact
look). Only `> 0` gets tinted. This is the load-bearing call of item C.

## 3. Deliverables

### A. Session count → hanging/climbing strands (`addIvyOverlay`)

- Per project render **N strands** (was 1):
  `N = clamp(1 + Math.floor(Math.log2(sessions)), 1, cap)`.
  **[v2] Correct mapping:** sessions `1→1, 2–3→2, 4–7→3, 8+→4`
  (the v1 prose was wrong; codex caught it).
- **[v2] Anti-clutter cap by project count:**
  `cap = projectCount > 28 ? 2 : projectCount > 18 ? 3 : 4`.
  **[v2] Climbing (vertical) strands additionally `min(cap, 3)`** (sparse-wall
  vines shouldn't bunch as densely as hanging). Both vine types reflect sessions.
- Most projects have 1 session ⇒ 1 strand ⇒ **no visible change**; only busy
  projects sprout extras.
- **[v2] Strand roles (the interaction fix, see §4):**
  - **Primary strand** (`i=0`): the project's existing slot x; full
    width/opacity; `className: 'project hanging|climbing'`; passes
    `project/projectIndex/title` → it is the **only** `.roving-vine`. Contributes
    the lone `crownAnchors` entry.
  - **Decorative strands** (`i≥1`): x jittered ±~2.5% around the slot via
    `jitter(projectIndex, i)`; slightly varied y/z; **opacity ×~0.82, width
    ×~0.85**; `className: 'project hanging|climbing vine-decorative'`; **do NOT
    pass `project`/`projectIndex`/`title`** (so `addSprite` never tags them
    `.roving-vine` or wires hover/focus/keydown). Pass `hueShift` + the health
    vars explicitly so they still tint/animate.

### B. Rescue all 8 vine frames (`addIvyOverlay`)

- **[v2]** Replace the frame choice `pickByToken(group, profile.level)` with
  **`pick(group, projectIndex + strandIndex)`** (the deterministic index idiom
  `leaf_cluster` already uses). Every frame becomes reachable; adjacent
  projects/strands differ.
- **Keep size token-driven:** `profile.width`/`profile.opacity` still come from
  `tokenSizeProfile`. Only the *frame* changes. *(codex confirmed the 8 vine frames
  are morphological variety, NOT a size ladder, so this is safe.)*

### C. cache_ratio → per-vine health tint (`addSprite` + CSS)

- Compute `health = clamp((cache_ratio - 0.2) / 0.8, 0, 1)` (so ≈0.30 → faint,
  ≈0.95+ → clearly lush; `0`/absent → **do not set the vars** → unchanged look).
- **[v2] Mechanism = two saturation/brightness multiplier vars, NOT a second
  hue-rotate** (hue reads as a color swap, not vitality; and a 2nd hue would fight
  the source-based `--vine-hue-shift`). JS sets, only when `cache_ratio>0`:
  - `--vine-health-sat = (1 + health*0.5)` (lusher)
  - `--vine-health-bright = (1 + health*0.10)`
- **[v2] Apply to ALL strands of the project** (primary + decorative) — tinting
  only the primary would split one project visually (codex).
- **[v2] CSS must thread the multipliers through EVERY filter that hits a project
  vine, because `@keyframes pg6-vine-sway` (index.html:331-334) and
  `pg6-vine-breathe` (335-337) rewrite `filter` every tick and would otherwise
  clobber the tint.** Multiply `saturate()`/`brightness()` by
  `var(--vine-health-sat,1)` / `var(--vine-health-bright,1)` (defaults preserve
  today's look) in:
  1. a resting `.pg6-sprite.project` filter rule (for motion off/reduced; new rule,
     defaults = current base look so no regression),
  2. `.pg6-sprite.project:hover` (index.html:135), `.is-active` (140),
     `:focus-visible` (144),
  3. `@keyframes pg6-vine-sway` both stops (332-333),
  4. `@keyframes pg6-vine-breathe` both stops (335-337).
  `contrast()`/`hue-rotate(var(--vine-hue-shift))` stay unchanged.

### D. Docs
- `docs/sprite-rendering.md`: mark sessions→strands, cache_ratio→tint, full-frame
  vine selection as realized.
- `CHANGELOG.md` `## Unreleased`: `feat:` line.

## 4. Interaction fix — keep ONE interactive strand per project

`addSprite` only tags `.roving-vine` + tabindex + `data-project-index` +
hover/focus/keydown **when `options.project` is passed**, and `selectProjectByKey` /
the Insight chip both assume exactly one element per `data-project-index`. So:
**only the primary strand passes `project`/`projectIndex`/`title`; decorative
strands pass neither** → they render + animate + tint but stay out of the
roving/focus/select model. `.pg6-sprite.vine-decorative { pointer-events: none; }`.
`crownAnchors` collects the primary only (cornice density stays correct).

## 5. Resolved decisions (codex round 1)

| # | Question | Decision |
|---|---|---|
| 1 | Strand formula / cap / vine types | `clamp(1+floor(log2(sessions)),1,cap)`, `cap=28?2:18?3:4` by project count; both types; climbing `min(cap,3)` |
| 2 | Vine frames variety vs size | **Variety** → `pick(group, projectIndex+strandIndex)`; size stays from `tokenSizeProfile` |
| 3 | cache tint mechanism / curve | New `--vine-health-sat`/`--vine-health-bright` multipliers (no 2nd hue); `health=clamp((cache_ratio-0.2)/0.8,0,1)`; unset at 0 |
| 4 | Combined noise / tint scope | Merge OK; decorative strands dimmer/narrower; tint **all** strands of a project |

## 6. Constraints / invariants
- **No core change**; `sessions`/`cache_ratio` already present. Pure frontend.
- **Graceful degradation**: absent `sessions` ⇒ 1 strand; `cache_ratio` `0`/absent
  ⇒ no tint vars ⇒ today's look. No errors on older caches / browser fallback.
- **Determinism**: strands/frames use `jitter`/`pick` indices — **no `Math.random`**.
- **No clutter regression**: bounded by `cap` + `densityScale`; decorative strands
  dimmer/narrower.
- **Modularity (CLAUDE.md §10)**: JS only in `web/`; nothing leaks into core.
- **a11y unchanged**: exactly one focusable/roving vine per project (§4).

## 7. Verification (committed sample is representative)
- 8-session `cache≈0.993` project → **4 strands** (mixed frames), **lush** tint.
- 7-session `cache≈0.297` project → ~3 strands, **faint** tint.
- The 1-session `cache=0.0` projects → **1 strand, neutral** → **unchanged vs today**
  (regression guard).
- All 8 `hanging_vine` + 8 `vertical_vine` frames reachable across the wall (collect
  rendered `src`s in the browser).
- Tint survives the sway/breathe animation (sample a vine's computed `filter`
  mid-animation; saturate must exceed baseline for a high-cache project).
- Exactly one `.roving-vine` per project; keyboard nav + chip select + hover still
  work; decorative strands are `pointer-events:none` and unfocusable.
- No console errors; deterministic across a settings-toggle re-render.

## 8. Rollback
Pure additive render logic + default-1 CSS vars: revert the `addIvyOverlay` strand
loop, the frame-selection line, the health-var sets, and the CSS multiplier edits.
No data/schema/core/asset change.

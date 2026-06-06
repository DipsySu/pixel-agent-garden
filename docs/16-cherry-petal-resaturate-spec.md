# Spec 16 — Re-derive a punchier `cherry_tree_petal` (codex sprite-gen)

Status: **Implemented in v0.1.2; codex produced the refreshed petal asset.**
Owner: sprite asset `assets/sprites/courtyard_style/cherry_tree_petal.png`
Scope: replace the current peak-tier cherry sprite with one that reads **distinctly
fuller / more saturated / pinker than `cherry_tree_bloom` on a still frame**, while
keeping the same 313×315 footprint, alpha silhouette, and courtyard_style palette
family. Pure asset change; manifest entry + render 3-way branch already exist
(Spec 12) — we only swap the PNG bytes.
Non-scope: `crates/**`, JS/CSS, manifest schema, the bud/bloom sprites.

> This was the remaining "codex authors new sprite art" item (matching the user's
> original goal). codex produced the asset via deterministic local image
> derivation, then Claude verified stats + browser rendering.

## 1. Why (measured)

`cherry_tree_petal` is the peak `recent_activity` tier (≥100k summed; the committed
sample sums ≈211k, so the garden currently renders petal). But the current PNG is
essentially `bloom` with an imperceptible tweak — measured over the opaque region:

| sprite | meanRGB | pinkness (R−avg(G,B)) | saturation | opaque px |
|---|---|---|---|---|
| `cherry_tree_bloom` | (100.5, 90.1, 85.9) | 12.53 | 0.148 | 44738 |
| `cherry_tree_petal` | (101.1, 89.0, 85.6) | 13.80 | 0.153 | **44738 (identical)** |

Identical opaque-pixel count + near-identical color ⇒ on a still frame the peak tier
is indistinguishable from bloom. Today "peak" reads only via the render's width bump
(100→108) + 12 vs 6 falling petals. We want the *sprite itself* to signal peak.

## 2. Goal / acceptance (measurable + visual)

Produce a new `cherry_tree_petal.png` such that:
- **Same geometry**: exactly 313×315, RGBA, transparency preserved; the alpha
  **bounding box** (silhouette extent) stays within ±2 px of bloom so the render's
  anchor/width math is unchanged. (Opaque px MAY rise where blossoms get denser, but
  the overall canopy outline shouldn't balloon.)
- **Reads hotter (measured over the opaque region)**: blossom-region **saturation
  ≥ +25%** and **pinkness ≥ +40%** vs bloom (i.e. sat ≳ 0.185, pink ≳ 17.5), so the
  delta is unmistakable, not the current ~3%.
- **Fuller, not just brighter**: blossom (pink) **coverage** in the canopy visibly
  higher than bloom — peak bloom = denser flowers, not merely a recolor.
- **On-palette**: stays in the existing cherry-blossom pink/cream family — no neon /
  off-hue; trunk + branches + ground shadow unchanged in color; consistent with the
  courtyard_style dark-outline muted look (no halos / stray alpha).
- **Deterministic**: produced by a script (no RNG, or a fixed seed) so the result is
  reproducible.

## 3. Approach (codex picks; suggested)

Derive from `cherry_tree_bloom.png` (don't draw from scratch — stays on-palette):
1. Build a **blossom mask** = opaque pixels whose hue is in the pink/cream family
   (exclude the brown trunk/branch + dark outline pixels).
2. On that mask: **raise saturation + push toward blossom-pink**, lift highlights
   slightly for a peak-bloom glow.
3. For "fuller": **grow blossom coverage** — e.g. dilate the blossom mask a few px
   into adjacent canopy/gaps and fill with sampled pink tones, and/or composite a
   few extra blossom clusters cloned from the densest existing patches. Keep it
   inside the existing canopy outline.
4. Leave trunk/branch/outline pixels untouched; preserve alpha.
- codex should confirm the exact ops in alignment; the bar is the §2 acceptance,
  not a specific filter.

## 4. Constraints
- **Output path**: overwrite `assets/sprites/courtyard_style/cherry_tree_petal.png`
  (manifest + render already point here). No new manifest entry, no JS change.
- **Reproducible**: commit the derivation script too? No — keep it out of the repo
  (or a `/tmp` scratch); the deliverable is the PNG. (codex: do not leave scratch
  scripts in the tree.)
- Privacy/zero-network unaffected (local image processing only).
- Bud/bloom PNGs untouched.

## 5. Resolved questions for codex
1. Approach: pure saturation/pink push vs also dilating/cloning blossoms for density
   — which gets a convincing "fuller" read without looking noisy or off-palette?
   Pick concretely.
2. How to isolate the blossom mask from trunk/branch/outline robustly (hue +
   luminance thresholds on bloom)?
3. Acceptance thresholds in §2 reasonable, or propose better measurable targets?
4. Any risk the denser canopy changes the alpha bbox enough to shift the render
   anchor — and how you'll keep the silhouette stable.

## 6. Verification (post-implementation)
- `cherry_tree_petal.png` is 313×315 RGBA; alpha bbox within ±2 px of bloom.
- Recompute the §1 table: petal saturation ≥ +25% and pinkness ≥ +40% over bloom;
  blossom coverage up.
- Browser (sample is in petal tier): the cherry reads clearly fuller/pinker than the
  bloom frame would; on-palette, no halos; no console errors; falling-petal motion
  still works.
- Side-by-side eyeball (screenshot) — if it looks garish/off, iterate or revert.

## 7. Rollback
`cherry_tree_petal.png` is committed (4b5aa18); `git checkout -- assets/sprites/courtyard_style/cherry_tree_petal.png`
restores the old one. No code/manifest change to undo.

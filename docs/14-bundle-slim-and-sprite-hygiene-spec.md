# Spec 14 — Slim the Tauri bundle + sprite hygiene

Status: **Implemented in v0.1.2; manifest-schema cleanup remains deferred.**
Owner: build glue (`crates/tauri-app/build.rs`) + sprite assets/manifest + frontend
ground decor (`web/render-garden.js`) + dev tool (`assets/sprites/preview.html`)
Scope: remove dead weight that ships in every desktop binary, and restore the
`declared == selectable` invariant for sprites — without changing what the
production renderer draws (except adding placements for already-authored frames).
Non-scope: `crates/core/**`, aggregation/schema, no new sprite art.

> codex (gpt-5.5) reviewed v1 read-only → direction agreed; 3 doc-accuracy fixes
> required (folded into v2, marked **[v2]**) + concrete implementation params
> captured in §5. **Implemented; keep the deferred manifest cleanup scoped
> separately.**

## 1. Why (audit-confirmed, codex-verified)

1. **~12 MB of dev-only atlases ship in every binary.** The 6 `*_spritesheet.png`
   + 6 `*_spritesheet_chroma.png` files (≈12.76 MB, ~77% of the sprite dir) have
   **zero** production references (`garden.js`/`render-garden.js`/`render-svg.js`/
   `render-helpers.js` never load a spritesheet/chroma); the only consumer is the
   dev inspector `assets/sprites/preview.html`. But `build.rs::copy_dir`
   ([build.rs:27-45](../crates/tauri-app/build.rs)) mirrors **all** of
   `../../assets` into `../../web/assets` unfiltered, and `tauri.conf.json`
   `frontendDist=../../web`, so all 12 atlases + `preview.html` pack into the
   shipped app. The exact 12 files (codex-listed): `{ivy_courtyard, courtyard_objects,
   courtyard_style, mountains, pavilion_trinkets, stone_cat}_spritesheet.png` and
   the matching `_spritesheet_chroma.png`. The only `.html` under `assets/` is
   `preview.html`.
2. **Orphan sprites break `declared == selectable`.** `object_rock`
   (`courtyard_objects/rock_large_01.png`, `rock_small_01.png`) +
   `object_ground_tuft` (`ground_tuft_01.png`) are declared + on disk but have
   **zero** `web/` references (codex confirmed); `addGroundOverlay` uses the live
   `ivy_courtyard` `rock`/`grass_tuft` groups instead.
3. **Stranded hand-authored frames never render.** `addGroundOverlay`'s 2-element
   stone array never reaches `stone_base_03`/`stone_base_04`
   ([render-garden.js:957](../web/render-garden.js)); `addWallMarks`'s 3-element
   marks array never reaches `plaster_patch_04`
   ([render-garden.js:947](../web/render-garden.js)).
4. **`preview.html` crashes on heterogeneous manifest entries.** It reads
   `sprite.size[0]` unconditionally (preview.html:105), but **[v2] 21** entries
   carry only `w`/`h` and no `size[]`, so it throws `TypeError` and blanks the
   inspector after `courtyard_objects`. **[v2]** (preview.html does NOT read
   `manifest.image`/`source_chroma`; it hardcodes `./ivy_courtyard_spritesheet.png`
   — corrected from v1.)

## 2. Key design fact (why this is low-risk)

`web/garden.js:18` chooses `window.__TAURI__ ? './assets' : '../assets'`, so the
**browser degraded mode reads the repo-root `../assets`** while the **Tauri bundle
serves the generated `web/assets` mirror** (codex confirmed). So **slimming =
filtering the build.rs copy only**; the source tree is untouched →
`preview.html` + dev inspector keep working from source, only the shipped binary
shrinks. No "relocate to tools/" needed.

**[v2] Deferred (NOT in this batch), corrected reasoning:**
- Manifest top-level `image`/`source_chroma` (lines 2-3): **unused by production
  AND not read by preview.html** (preview hardcodes its atlas path). Dropping them
  is safe but is *manifest-schema cleanup* — deferred to keep this batch scoped to
  "bundle slim + orphan prune + frame rescue" (codex's recommendation).
- Manifest `mountains` group entries (lines 1164, 1171): inert for production
  grouping (render-svg.js hardcodes the mountain PNG paths). The *entries* may be
  re-evaluated later, but **`mountains/*.png` are a hard production dependency
  ([render-svg.js:110](../web/render-svg.js)) and must NOT be deleted.** Deferred.

## 3. Deliverables (implemented)

### A. build.rs — filter the web/assets copy *(headline, ~12 MB)*
- **[v2] Locked predicate** (codex-agreed): when copying a file, **skip** it when
  `file_name.contains("_spritesheet") || extension == "html"`. This catches exactly
  the 6 spritesheets + 6 `_spritesheet_chroma` files + `preview.html`, and nothing
  the renderer loads. No manifest-driven allowlist — `render-svg.js` and
  `scene-config.js` reference PNGs by direct path, so build glue must stay a dumb
  copier, not an asset-semantics parser.
- Keep `println!("cargo:rerun-if-changed=../../assets")` as-is; filtering doesn't
  weaken re-sync (a change to a skipped file shouldn't update the bundle mirror).
- Add a comment: dev-only atlases stay in source; only the shipped mirror is slim.
- Net: `web/assets` sprite payload ~17 MB → ~3.6 MB; **no runtime/dev change**.

### B. Prune orphan object_rock / object_ground_tuft
- Re-verify zero `web/` refs (codex confirmed), then delete the 3 PNGs
  (`courtyard_objects/{rock_large_01,rock_small_01,ground_tuft_01}.png`) **and**
  their manifest entries (groups `object_rock`, `object_ground_tuft`).
- Rationale: live `ivy_courtyard` `rock`/`grass_tuft` already cover ground texture.

### C. Place the stranded ground/wall variants *(codex-specified coords)*
- `addGroundOverlay` stone position array: **add 2 entries** so indices 0..3 reach
  all four `stone_base` frames — codex suggests `[42, 88, 34]` and `[62, 90, 30]`,
  reusing the existing `z:12, opacity:0.36`. (codex finalizes exact coords to avoid
  overlap with stone_cat/lantern/cairn.)
- `addWallMarks` marks array: **add 1 entry** so index 3 reaches `plaster_patch_04`
  — codex suggests `[36, 58, 30]`, reusing `opacity:0.22`.
- Deterministic only (existing `jitter`/`pick`; **no `Math.random`**).

### D. Guard preview.html against w/h-only entries
- Replace the unconditional `sprite.size[0]` with a fallback, e.g.
  `const [w, h] = sprite.size || [sprite.w, sprite.h];`, so all 21 w/h-only entries
  render instead of blanking the inspector. Dev-only.

### E. Docs
- `CHANGELOG.md` `## Unreleased`: a `perf:`/`chore:` line (≈12 MB bundle slim +
  orphan prune + frame rescue + preview fix).
- One-line note in `docs/sprite-rendering.md` that atlases are dev-only / excluded
  from the bundle (optional).

## 4. Constraints / invariants
- **No core change.** `build.rs` stays pure std::fs; no new deps.
- **No production render regression**: A drops never-loaded files; B removes
  never-placed sprites; D is dev-only; C adds only low-opacity decorative
  placements of existing art.
- **Determinism** preserved. **Modularity (CLAUDE.md §10)**: JS only in `web/`,
  build glue only in build.rs. `declared == selectable` holds after B+C.

## 5. Resolved decisions (codex round 1)

| # | Question | Decision |
|---|---|---|
| 1 | build.rs filter | denylist `file_name.contains("_spritesheet") || ext=="html"`; **no** manifest allowlist; keep `rerun-if-changed` |
| 2 | object_rock/tuft | **prune** (delete 3 PNGs + manifest entries) |
| 3 | stranded placements | stone array +`[42,88,34]`,`[62,90,30]` (z12/op0.36); marks +`[36,58,30]` (op0.22); codex finalizes coords |
| 4 | image/source_chroma + mountains | **defer** (scope); never delete `mountains/*.png` (render-svg hard dep) |

## 6. Implementation risks (codex-noted)
- `web/assets/` is gitignored; `build.rs` does `remove_dir_all` then copy, so
  deleting source orphan PNGs leaves no stale mirror.
- The Windows `libresource.a` link lock doesn't block build.rs's pre-link sync;
  full-build verification may need a separate `CARGO_TARGET_DIR`.
- Do not touch untracked `.claude/` or the spec files.

## 7. Verification (post-implementation)
- **A**: trigger a tauri-app build (build.rs re-syncs before link, so the lock
  doesn't block it), then list `web/assets/sprites/` — **no** `*_spritesheet*`,
  `*_chroma`, `*.html`; all per-sprite crop PNGs present; size delta ≈ -12 MB.
- **B**: orphan PNGs gone from source + mirror; manifest no longer declares
  `object_rock`/`object_ground_tuft`; `cargo test -p ...core` green; browser has no
  missing-sprite console errors.
- **C**: browser ground/wall `src`s now include `stone_base_03/04` +
  `plaster_patch_04`; no clutter; no console errors.
- **D**: `preview.html` renders all entries, no `TypeError`.
- **All**: `cargo fmt --all --check` clean; deterministic re-render.

## 8. Rollback
Each item reverts independently (build.rs predicate, restore PNGs+entries from git,
remove placements, revert the preview one-liner). No data/schema/core change.

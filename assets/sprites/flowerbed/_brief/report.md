# Flowerbed Heatmap PoC Report

## Generation approach

- Used Option A: built-in image generation.
- Prompted for a 5-row x 4-column chroma-key pixel-art flower sheet.
- Copied the generated source into `assets/sprites/flowerbed/flowerbed_source_imagegen.png`.
- Locally post-processed the generated sheet with PIL to remove the green key background and pack transparent PNG sprites.
- No Option B generator script was added.

## Sprite output

- Count: 20 sprites.
- Size: 24 x 32 px each.
- Levels: `0..4`.
- Variants per level: `rose`, `daisy`, `tulip`, `wildflower`.
- Main sheet: `assets/sprites/flowerbed/flowers.png` (96 x 160 px).
- Individual files: `assets/sprites/flowerbed/flower_l{level}_{variant}.png`.
- Manifest group: `flowerbed` in `assets/sprites/ivy_courtyard_manifest.json`.

## Integration approach

- Added `GardenSummary.flowerbed_year`, a 366-day UTC activity series ordered oldest-to-today.
- Bumped `aggregate::SUMMARY_SCHEMA_VERSION` to 5.
- Quantization reserves level 0 for idle days and maps active days into levels 1..4 with the same log-compressed bucket shape used by `size_level`.
- Added `web/render-flowerbed.js` to render a 6 x 61 flower grid from `flowerbed_year`.
- Added fallback client aggregation from `summary.projects[].daily_activity` for older summaries.
- Added `appearance.flowerbed = enabled | disabled`, defaulting to `disabled`.
- Added `?flowerbed=enabled` / `?flowerbed=disabled` URL override for browser PoC review.
- When enabled, `web/render-svg.js` swaps the classic grass strips for a brown dirt bed while keeping the bottom dirt strip.
- Hover/focus shows a tooltip with date, activity, and level. Click is intentionally a no-op.

## Preview artifacts

- `tools/out/flowerbed_imagegen_source_preview.png` — source imagegen sheet preview.
- `tools/out/flowerbed_sprite_preview.png` — packed 20-sprite preview.
- `tools/out/flowerbed_layout_preview.png` — static 6 x 61 layout preview using the actual sprites.
- `tools/out/flowerbed_layout_preview_crop.png` — cropped foreground preview.

## Verification

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `cargo test -p local-agent-garden-core flowerbed`
- `cargo test -p local-agent-garden-core settings`
- `node --check web/render-flowerbed.js`
- `node --check web/garden.js`
- `node --check web/render-garden.js`
- `node --check web/render-svg.js`
- `node --check web/data-source.js`
- `node --check web/settings-panel.js`
- Local server smoke check at `http://127.0.0.1:8765/web/index.html?flowerbed=enabled`.

## Known issues / TODOs

- The generated sprites are attractive but tiny at 366-day density; level 4 reads best, while levels 1-2 are subtle.
- Browser screenshot automation was unavailable in this session, so the report uses generated layout previews instead of an actual page screenshot.
- The settings UI exposes the toggle, but the PoC does not add a dedicated legend.
- Tooltip is intentionally simple and English-only.
- Future promotion to main should tune spacing against real user summaries and decide whether the flowerbed replaces or supplements the classic grass by default.

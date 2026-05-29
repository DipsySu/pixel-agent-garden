# Season Particle Sprite Brief (S3)

Generation spec for the three season-specific ambient particles used by the
pixel garden. Hand this whole file to the sprite generator (Codex). The
front-end wiring (CSS keyframes + JS spawn, gated by `data-season` /
`data-motion`) is implemented separately against the exact names below.

## Style (match the existing courtyard atlas)

- **Idiom:** original 16-bit pixel art, the same look as the existing sprites
  in `assets/sprites/` (cherry tree, lantern, trinkets). Limited palette, 2–3
  tones per color (base + shadow + soft highlight). No heavy 1px pure-black
  outline — use a slightly darker rim tone of the same hue, as the current
  sprites do.
- **Crisp pixels:** nearest-neighbor, no anti-aliasing, no blur, no drop
  shadow baked into the PNG. The renderer scales these with
  `image-rendering: pixelated`, so soft edges would look wrong.
- **Background:** fully transparent (RGBA, alpha = 0). Output transparent PNGs
  directly — do **not** use a chroma-key fill. No stray/halo pixels in the
  margin.
- **Framing:** art centered on a square canvas with a few transparent pixels
  of margin on every side, so CSS rotation/scale never clips. Treat the canvas
  as having a `center` anchor.

## Sprites to produce (9 total)

| # | File | Logical size (px) | Notes |
|---|------|-------------------|-------|
| 1 | `maple_leaf_01.png` | 44×44 | 5-lobe maple leaf, upright-ish |
| 2 | `maple_leaf_02.png` | 44×44 | same leaf rotated ~35°, distinct color |
| 3 | `maple_leaf_03.png` | 44×44 | curled/edge-on leaf, smaller silhouette |
| 4 | `maple_leaf_04.png` | 44×44 | rotated ~ -50°, distinct color |
| 5 | `firefly_glow_01.png` | 20×20 | bright glow frame (pulse "on") |
| 6 | `firefly_glow_02.png` | 20×20 | dim glow frame (pulse "off") |
| 7 | `snowflake_01.png` | 40×40 | 6-arm crystal, full |
| 8 | `snowflake_02.png` | 40×40 | simpler 6-point star, mid |
| 9 | `snowflake_03.png` | 40×40 | tiny dense flake / clustered dots |

Provide several variants (not one rotated in CSS) because rotating pixel art in
the browser destroys the crisp edges — bake the orientation into each file.

## Per-season palette (harmonized with the scene)

These are the scene's own season colors (`web/render-svg.js#resolveSeasonScene`).
Keep particles inside these ranges so they read as part of the season, not as
foreign accents.

- **Autumn maple leaves** — warm reds/oranges/golds:
  `#d8682a` `#c4521e` `#e89c44` `#f0b860` `#a8401a`.
  Spread the 4 leaves across this range (e.g. 1 deep red, 1 burnt orange,
  1 gold, 1 mixed); add one darker tone of each for veins/shadow.
- **Summer-night fireflies** — warm yellow-green bioluminescent glow:
  core `#f7f4b0`, mid `#e8e58a`, halo `#bcd86a` fading to transparent.
  The "bright" frame has a larger/lighter halo; the "dim" frame is smaller and
  more saturated. Body is tiny (a few px); the glow is the main read.
- **Winter snowflakes** — pale cool whites/blues:
  `#f0f4f6` `#e8eef0` `#cfd6da`, with a faint `#aebcc6` edge tone for
  definition against a light sky.

## Output location & manifest

1. Save the 9 PNGs under `assets/sprites/season_particles/`.
   (`assets/` is the canonical source; `crates/tauri-app/build.rs` copies it to
   `web/assets/` on build, so nothing else needs touching.)
2. Append these entries to the `sprites` array in
   `assets/sprites/ivy_courtyard_manifest.json`. Groups: `maple_leaf`,
   `firefly`, `snowflake`.

```json
{ "name": "maple_leaf_01", "group": "maple_leaf", "file": "season_particles/maple_leaf_01.png", "size": [44, 44], "anchor": "center" },
{ "name": "maple_leaf_02", "group": "maple_leaf", "file": "season_particles/maple_leaf_02.png", "size": [44, 44], "anchor": "center" },
{ "name": "maple_leaf_03", "group": "maple_leaf", "file": "season_particles/maple_leaf_03.png", "size": [44, 44], "anchor": "center" },
{ "name": "maple_leaf_04", "group": "maple_leaf", "file": "season_particles/maple_leaf_04.png", "size": [44, 44], "anchor": "center" },
{ "name": "firefly_glow_01", "group": "firefly", "file": "season_particles/firefly_glow_01.png", "size": [20, 20], "anchor": "center" },
{ "name": "firefly_glow_02", "group": "firefly", "file": "season_particles/firefly_glow_02.png", "size": [20, 20], "anchor": "center" },
{ "name": "snowflake_01", "group": "snowflake", "file": "season_particles/snowflake_01.png", "size": [40, 40], "anchor": "center" },
{ "name": "snowflake_02", "group": "snowflake", "file": "season_particles/snowflake_02.png", "size": [40, 40], "anchor": "center" },
{ "name": "snowflake_03", "group": "snowflake", "file": "season_particles/snowflake_03.png", "size": [40, 40], "anchor": "center" }
```

(The existing spritesheet-sliced entries also carry `source_box` / `trim_box`,
but those are only used by the atlas preview/slicer. Individual PNGs like the
trinkets and these particles only need `name` / `group` / `file` / `size` /
`anchor`.)

## Acceptance checklist

- [ ] 9 transparent-background PNGs at the sizes above, no stray margin pixels.
- [ ] Nearest-neighbor pixel art, no anti-aliased/blurred edges, no baked shadow.
- [ ] Colors within each season's listed palette.
- [ ] Orientation variants baked per file (don't rely on CSS rotation).
- [ ] 9 manifest entries appended; JSON still parses.
- [ ] `cargo tauri build` (or the next dev run) copies them into `web/assets/`.

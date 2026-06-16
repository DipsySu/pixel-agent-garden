# Garden cat v2 report

## Generated files

- `tools/gen_cat_sprite.py`: deterministic PIL generator using 80x56 palette-index character grids.
- `assets/sprites/garden_cat/garden_cat.png`: 800x168 RGBA master sheet, 10x3 cells.
- `tools/out/frame_*.png`: 30 preview PNGs, one for each grid cell. This includes 26 named content poses plus the 4 transparent empty cells.

## Validation results

- Command run: `python3 tools/gen_cat_sprite.py`
- Result: validation passed.
- Idempotency: running the generator twice kept the same SHA-256 for `garden_cat.png`.
- Final sheet SHA-256: `d632e5bf414b79d17690761c53cad6bcce7ac65b6c47f983449e3ed66903e205`
- Image size/mode: 800x168 RGBA.
- Palette: transparent plus exactly the 8 locked RGB colors:
  `#1a1208`, `#2a1c10`, `#3e2a18`, `#8b6a44`, `#a8624c`, `#c4a472`, `#d49a3a`, `#e8dcc4`.
- WR1 nose+mouth budget: 3 pixels total. Nose is 1 pixel at `(70, 29)`. Mouth is 2 horizontally adjacent pixels at `(67, 31)` and `(68, 31)`. Row `y=30` separates nose from mouth.
- Empty grid cells `r0c8`, `r0c9`, `r1c8`, and `r1c9` are fully transparent.
- Walk-left frames were authored separately from walk-right frames. The validator also asserts that no WL frame is a direct horizontal mirror of its WR counterpart.

## Notes

- The brief text has a preview-count ambiguity: the described 10x3 sheet has 30 cells, but only 26 named non-empty poses. I generated previews for all 30 cells so the transparent cells can be audited too.
- `assets/sprites/garden_cat/garden_cat_walk.png` was not used as an output target and was not overwritten.

## Re-run

```bash
python3 tools/gen_cat_sprite.py
```

## Deliverables checklist

- [x] `tools/gen_cat_sprite.py` idempotent generator
- [x] `assets/sprites/garden_cat/garden_cat.png` 800x168 RGBA, palette-locked
- [x] `tools/out/frame_*.png` previews
- [x] `assets/sprites/garden_cat/_brief/report.md`
- [x] Self-validation passed: mouth pixel budget, palette lock, image size, empty cells, walk-left non-mirror check, and idempotency

## v2-iteration2

- Re-read the updated brief sections for the mandatory 3x3 ear stamp, the walk-frame tail height budget, and self-validation checks #4, #5, and #6.
- Patched `tools/gen_cat_sprite.py` in place. The generator still uses the same 80x56 ASCII-grid/palette-index approach, 30-cell sheet layout, palette, paths, and mouth budget.
- Replaced the required visible-ear frames with the exact stamp:
  `.o.` / `obo` / `obo`, with separated apex pixels and a coat-base head dip between the ears where the head row would otherwise be flat outline.
- Lowered the walk tails so WR1/WR5/WL1/WL5 sit +1 px above the rendered back line, WR2/WR6/WL2/WL6 are level, WR3/WR7/WL3/WL7 sit below the back, and WR4/WR8/WL4/WL8 stay within the +3 px max.
- Added loud validators for #4 ear shape, #5 tail height, and #6 byte-identical walk-right face region across WR1..WR8.
- Regenerated `assets/sprites/garden_cat/garden_cat.png` and all 30 `tools/out/frame_*.png` previews.
- Final sheet SHA-256: `b9e66c308e1372715d98c8db896a92e345f08d50506385cc7743e80b8d68dae5`.

Validation pass output:

```bash
$ python3 tools/gen_cat_sprite.py
wrote assets/sprites/garden_cat/garden_cat.png
wrote 30 previews to tools/out
validation passed
```

## v2-iteration3

- Re-read the updated Row 2 idle-pose entry and the new mandatory silhouette anti-ambiguity validator.
- Redrew `STRETCH` as a clearer play-bow: front paws stay low and forward, the head stays down, and the raised rear now uses a broad shallow contour instead of any 3-px spike.
- Added `validate_silhouette_anti_ambiguity`, which runs across all 30 grid cells. It computes the per-column top contour, clusters 9-px-window peaks, allows only the exact canonical head-ear stamps at expected positions, and fails on any other peak.
- The new validator sweep also exposed non-head peaks outside `STRETCH`; those were fixed by broadening tail caps in WR2/WR4/WR6/WR8, WL4/WL8, T1/T4/LOOK_DN, and by flattening non-canonical point protrusions in T1/T2/T4/SLEEP/LOOK_DN.
- Regenerated `assets/sprites/garden_cat/garden_cat.png` and all 30 `tools/out/frame_*.png` previews.
- Final sheet SHA-256: `98be34cbfe1eb27df5e270fd8e2f973d8bd148383141a47dde39d94e4e73ccd0`.

Validator #7 output is included in the generator pass:

```bash
$ python3 tools/gen_cat_sprite.py
wrote assets/sprites/garden_cat/garden_cat.png
wrote 30 previews to tools/out
validation passed
```

## v2-iteration4

- Regenerated the sprite source after visual review found the profile mouth /
  whisker area could still read as a third ear-like point at scene scale.
- Removed all triangular `snout` components from the visible silhouette in
  walk, sit, stretch, look-up, look-down, and T4 profile poses.
- Replaced them with rounded internal muzzle/chin pixels painted inside the
  head shape, so only the canonical head ears can create pointed silhouette
  peaks.
- Regenerated `assets/sprites/garden_cat/garden_cat.png` and all 30
  `tools/out/frame_*.png` previews.
- Final sheet SHA-256:
  `2973c41f902c2ac3d395744bc9f4f9b1fec05bb133589ca527a9a3b80dc945b4`.

Validation pass output:

```bash
$ python3 tools/gen_cat_sprite.py
wrote assets/sprites/garden_cat/garden_cat.png
wrote 30 previews to tools/out
validation passed
```

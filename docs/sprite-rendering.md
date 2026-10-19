# Sprite Rendering Notes

The first generated atlas lives at:

- `assets/sprites/ivy_courtyard_spritesheet.png`
- `assets/sprites/ivy_courtyard_manifest.json`
- `assets/sprites/ivy_courtyard/*/*.png`

Open `assets/sprites/preview.html` to inspect the atlas and all sliced sprites.
The atlas PNGs and preview HTML are dev-only source assets and are excluded from
the shipped Tauri `web/assets` mirror.

## Current Sprite Groups

- `hanging_vine`: no-roof hanging ivy, attached to the existing wall edge
- `vertical_vine`: climbing strands for sparse wall sections
- `leaf_cluster`: dense leaves for filling top bands or branch joints
- `flower_cluster`: small accent flowers (now placed at the cherry base, count
  scaled by recent activity — see [Spec 12](./12-cherry-petal-and-flower-accents-spec.md))
- `plaster_patch`: cream wall cracks and stains
- `stone_base`: gray lower wall stones
- `grass_tuft`: ground plants
- `rock`: ground rocks
- `pavilion_compact`: three compact pavilion variants for a right-side anchor
- `bamboo_cluster`: left-side bamboo anchor variants
- `path_stones`: one horizontal stepping-stone sprite

## Growth Mapping

Use the data model to choose density and length rather than scaling sprites.

- Project age / first-seen-driven vine length was evaluated and deferred; avoid
  scaling vine sprites until a future design proves it is worth the extra signal.
- Recent activity controls fresh leaf overlays and flower probability.
  **Realized:** summed `recent_activity` drives the cherry blossom tier
  (bud → bloom → petal) and the number of `flower_cluster` accents at the cherry
  base (bud 0 / bloom 2 / petal 4) — see
  [Spec 12](./12-cherry-petal-and-flower-accents-spec.md).
  **Realized:** per-project `recent_activity` now spawns deterministic
  `leaf_cluster` fresh-leaf overlays near primary vine crowns — see
  [Spec 15](./15-recent-activity-leaves-and-vine-age-spec.md).
- Session count controls the number of independent hanging strands.
  **Realized:** each project renders `clamp(1+floor(log2(sessions)),1,cap)` strands
  (one primary interactive vine + dimmer decorative strands), so busy projects
  visibly fan out — see [Spec 13](./13-garden-reflects-activity-spec.md).
- Token usage controls density within a strand, but should use a logarithmic scale.
  **Realized:** per-vine width/opacity come from the core `size_level`/`size_strength`
  (log-scaled), via `tokenSizeProfile`.
- Cache ratio can tint or select healthier leaf variants later.
  **Realized (tint):** `cache_ratio > 0` biases a vine toward lush (a saturation/
  brightness nudge via `--vine-health-*`); `0`/absent stays neutral, because in
  practice `0.0` means "source reported no cache fields", not a cold cache — see
  [Spec 13](./13-garden-reflects-activity-spec.md). (The richer "distinct healthy
  vs sickly leaf sprite" option is still future.)
- Vine frame variety: all 8 `hanging_vine` / `vertical_vine` frames are selected by
  position (`pick(group, projectIndex + strandIndex)`), so none stay unreachable.

## Rendering Shape

The target composition should be a courtyard wall with strong negative space:

1. Draw the base wall, wall edge, stone base, and ground in the scene layer.
2. Attach mature ivy under the existing wall edge.
3. Spawn many independent hanging strands from the top band.
4. Vary length, x-offset, and density per strand.
5. Add sparse vertical vines on side walls.
6. Add flowers and small life only as accents.

This intentionally avoids the earlier "single mathematical vine" look.

## Wall Edge Rule

The current prototype does not use `roof_cap` or `hanging_vine_roof`. Keep the wall edge in the base scene, and attach `hanging_vine` underneath it.

This avoids mixed edges where some hanging vines appear to carry their own roof tiles and others do not.

## Courtyard Object Rule

Large foreground structures should be sprites, not baked into the base SVG. The base SVG provides the wall, sky, and ground. Object sprites provide bamboo, path stones, and the compact pavilion so their scale can be tuned without rewriting scene geometry.

## Resident Cat Motion

Both renderers use `web/garden-cat.js`. They supply a ground projection,
sprite URL and habitat from `web/cat-motion.js`; the controller owns the DOM,
finite CSS action phases and teardown. It does not read summaries or settings
files. Unlock selection stays with the renderer, and motion mode comes from
the resolved scene attribute plus the system accessibility preference.

- Habitat nodes form connected walkable lanes. New landmarks must update the
  lanes and obstacle-clearance tests, not introduce per-frame repulsion.
- Curved legs are sampled by projected arc length. One shared distance profile
  drives CSS transforms and the eight walking frames, with gentle acceleration,
  a constant-speed middle and braking. Direction stays fixed within a leg.
- Direction reversals use crouch / flip / landing phases, never `scaleX(-1)`.
  Rotation interpolates continuously; sprite cells always use `step-end`.
- The scene-sized outer element provides a responsive translation plane. The
  inner pose is anchored at the sheet's feet (68% of the square cell height).
  First-run opacity belongs on this pose, not on the travel animation clock.
- CSS owns playback. `animationend` chooses the next finite action; no cat rAF
  loop, resize polling or interval survives in either renderer. Hidden documents
  pause the clocks. Reduced motion breathes in place; off/system-reduced stays
  still. Changing mode snapshots the current animation position before stopping.
- Data repaints reuse the controller. Renderer teardown removes its resident,
  generated stylesheet and listeners. Postcards export a seated frame from the
  ground-anchored pose box, not the airborne/rotated sprite bounds.

Run `node --test web/tests/cat-motion.test.mjs` for route/timing checks. Open
`web/tests/garden-cat.html` through the local preview server for real-DOM CSS
animation, motion-mode, first-run reveal and lifecycle checks.

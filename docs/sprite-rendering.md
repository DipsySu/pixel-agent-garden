# Sprite Rendering Notes

The first generated atlas lives at:

- `assets/sprites/ivy_courtyard_spritesheet.png`
- `assets/sprites/ivy_courtyard_manifest.json`
- `assets/sprites/ivy_courtyard/*/*.png`

Open `assets/sprites/preview.html` to inspect the atlas and all sliced sprites.

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

- Project age controls how far down the hanging vines can extend.
- Recent activity controls fresh leaf overlays and flower probability.
  **Realized:** summed `recent_activity` drives the cherry blossom tier
  (bud → bloom → petal) and the number of `flower_cluster` accents at the cherry
  base (bud 0 / bloom 2 / petal 4) — see
  [Spec 12](./12-cherry-petal-and-flower-accents-spec.md).
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

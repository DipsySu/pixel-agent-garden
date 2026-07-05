# 2.5D Isometric Courtyard Plan

Status: Experimental 2.5D renderer landed on `codex/isometric-courtyard`.

## Intent

Move Pixel Agent Garden from a wall-first courtyard into a clearer 2.5D garden
space without losing the product's core: local agent activity becomes visible,
legible growth. The wall remains the project-history surface; the ground plane
becomes the long-lived courtyard for unlocked objects, daily activity, and
ambient life.

This is a renderer evolution, not a data-model rewrite. The first isometric
version must consume the existing `GardenSummary`.

## Reviewer Consensus

Codex and Claude Code both agreed on the same first cut:

- Do not keep adding 2.5D logic directly to `web/render-garden.js`.
- Add a renderer boundary before introducing a second visual implementation.
- Keep the existing wall renderer visually unchanged as `classic`.
- Use an experimental `isometric` renderer behind a URL flag until it is real.
- Do not change Rust schema for the first 2.5D version.

## Renderer Boundary

The frontend entry point should treat the scene renderer as replaceable:

```js
{
  paint(groups, summary, settings),
  repaintData(groups, summary),
  renderBase(settings),
  renderDynamic(groups, summary),
  showScanning(),
  showCached(summary),
  selectProjectByKey(projectKey),
  destroy()
}
```

`garden.js` owns data loading, settings, panels, watcher subscriptions, and
renderer selection. Renderers own scene drawing.

## Phase 0: Renderer Boundary

Files:

- `web/renderers/classic-wall-renderer.js`
- `web/renderers/isometric-renderer.js`
- `web/renderers/isometric-base.js`
- `web/renderers/renderer-factory.js`

Behavior:

- Default renderer is `classic`.
- `?renderer=isometric` selects the experimental 2.5D renderer.
- Unknown renderer values fall back to classic.
- Tauri desktop sessions default to `isometric` on this branch because the
  packaged `frontendDist` window cannot receive the browser query string.
- A footer `2.5D` / `Wall` toggle hot-swaps renderers and persists the choice in
  localStorage.
- Existing dynamic renderer gets a `destroy()` hook so future renderer switches
  can stop the long-lived cat animation loop and clear sprite layers.
- `render-svg.js` marks the default renderer with `data-renderer="classic"`;
  `isometric-base.js` marks the experimental renderer with
  `data-renderer="isometric"` so CSS and smoke tests can target each mode.

## Phase 1: Isometric MVP

The first real isometric renderer now includes:

- folded back wall carrying every project vine
- wall planes derived from the floor rear edges plus one wall-height offset, so
  wall tops remain parallel to wall bases
- density-adaptive wall vines so large project vines stay hoverable while all
  projects remain visible
- 2.5D ground plane with depth-seated sprites
- PixelLab isometric courtyard assets for pavilion, stone cat, willow, cherry,
  bamboo hedge, koi pond, and stone lantern
- stepping stones, with side-view-only classic objects intentionally withheld
  from the isometric renderer until matching isometric variants exist
- existing HUD, footer buttons, Insight, Dashboard, Settings, and Postcard
- project hover/focus card
- roving keyboard navigation and `selectProjectByKey` support from Insight rows

## Phase 2: Extract Shared Contracts

Move reusable logic out of the classic renderer:

- `depthToScreen` and scene constants -> `web/scene-geometry.js`
- shared sprite layer operations -> `web/render-layer-utils.js`
- visual data mapping (`unlockTier`, `tokenSizeProfile`, `vineHueShift`) ->
  `web/garden-visual-model.js`
- info-card model/content helpers -> shared card module

Keep each extraction behavior-preserving.

No Rust schema change is required.

## Data Semantics

Hard semantic bindings:

| Data | Visual |
| --- | --- |
| `projects` | wall vines |
| project `total_tokens`, `size_level`, `size_strength` | vine mass |
| project `sources` | vine hue |
| project `cache_ratio` | vine health tint |
| project `recent_activity` | fresh leaves / project vitality |
| total tokens | pavilion/trinket unlocks, HUD total |
| sessions | stone cat / cairn growth |
| today's activity | lantern lit state |
| `daily_tokens` / `heatmap_year` | Dashboard and heatmap views |

Environment-only elements should stay quiet: sky, mountains, brick weathering,
basic grass texture, fish, stepping stones, and non-interactive atmospheric
particles.

## Risks

- Depth sorting and z-index hand tuning can spiral. The isometric renderer needs
  one depth-sorting rule, not scattered magic z values.
- Data meaning can get diluted if every decorative element appears to encode a
  metric.
- Mixed projection assets can clash. Manifest metadata will eventually need
  projection/anchor/depth-origin fields for true isometric assets.

## Asset Direction

The 2.5D renderer should prefer object sprites generated or authored for the
same low top-down / isometric projection. Side-view sprites from the classic
wall renderer are not a safe fallback for large props; if a matching isometric
asset is missing, the 2.5D scene should either omit that prop or use a small
neutral placeholder until a proper asset exists.

Current generated asset folder:

```text
assets/sprites/isometric_generated/
```

These are build-time assets. Runtime scan/render paths still read only local
agent data and local files.

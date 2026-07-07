# Spec 18 — Garden Postcard (one-click local export)

Status: **Implemented; desktop native-save verification remains paired with the
CSP release gate.**

**Resolved (codex round 1):**
- Rasterize: inline the 2 mountain `<image href>` → `data:`; rasterize base SVG at
  **2×** (1360×880), `imageSmoothingEnabled=false`; composite DOM sprites in z/DOM
  order via **`getBoundingClientRect()`** (`sx=(rect.left-scene.left)/scene.width*1360`,
  etc.), per-sprite **`ctx.filter = getComputedStyle().filter`** (feature-detect;
  on failure draw without filter, don't abort) + `globalAlpha`. **Also draw the
  `.pg6-wall-edge-cover` DOM rect.** Anchors are 3: top / bottom / **center**
  (trinkets use `translate(-50%,-50%)`).
- **Particles EXCLUDED** (transient ambient motion; cleaner, reproducible still).
- **Save path**: a new Tauri command **`save_postcard(bytes, suggested_name)`** —
  `tauri-plugin-dialog` save dialog + `std::fs::write`; **NOT** `tauri-plugin-fs`,
  no frontend fs permission. Browser fallback = `<a download>`. (User-initiated
  save-as to a user-chosen path — consistent with the privacy contract; not
  autonomous writing, not a source dir.)
- **Trigger**: a labeled `<button>` in the footer (alongside Insight); **anonymize
  toggle** lives in the small export panel, **default hides the busiest-project
  clause**.
- `tauri-plugin-dialog` is local (native dialog) — no egress, won't trip the
  supply-chain gate; CSP unaffected (`save_postcard` goes over IPC).
Owner: frontend (`web/`) + the tiny Tauri `save_postcard` command.
Scope: let the user export the **current garden scene** to a local PNG (zero
network), with an anonymize-labels default and a one-line localized caption.
Non-scope: cloud upload, accounts, a share gallery, server-side rendering, video.

> The synthesis's #1 "Next" bet. The garden's identity hook is trapped in a window
> nobody can open and a frame nobody can export; **screenshots are the only
> privacy-safe growth channel a local-first app has.** Make a clean frame leavable.

## 1. What we're rasterizing (grounded)

`#pg6-scene` is **not** a single image. It is:
- a base `<svg viewBox="0 0 680 440">` built by `render-svg.js` — pure shapes
  (wood/sky/wall/bricks/ground/sun/clouds/grass/flowers) PLUS **2 external
  `<image href="${assetRoot}/sprites/mountains/…png">`** elements;
- the `.pg6-info` hover card `<div>` (hidden unless hovering);
- then DOM `<img class="pg6-sprite">` overlays appended on top (vines, cherry,
  willow, cat, pavilion, lanterns, leaves, ground decor…), absolutely positioned in
  `%`, layered by `z-index`, many carrying CSS `filter` tints
  (`--vine-hue-shift` / `--vine-health-*`) and per-element `opacity`.

So an export must composite **base SVG + DOM sprites** into one raster.

## 2. Pipeline (the core; codex to confirm exact ops)

1. **Serialize the base SVG** (the `<svg>` child of `#pg6-scene`).
2. **Inline the 2 mountain `<image href>` as `data:` URIs** before rasterizing —
   an SVG loaded as an `<img>` will NOT fetch external hrefs, so without inlining
   the mountains render blank (the known gotcha). Fetch the same-origin PNG →
   base64 → replace `href`. (Same-origin → no canvas taint.)
3. **Rasterize the inlined SVG** onto a canvas at an export scale (e.g. **2×** →
   1360×880) with `ctx.imageSmoothingEnabled = false` (crisp pixel-art).
4. **Composite the DOM sprites** in DOM/z order: for each `.pg6-sprite` (skip the
   `.pg6-info` card), compute its rect relative to the scene
   (`offsetLeft/Top/Width/Height` or `getBoundingClientRect` deltas), set
   `ctx.filter = getComputedStyle(el).filter` (so the vine hue/health tint is
   preserved — `drawImage` does NOT apply CSS filters otherwise),
   `ctx.globalAlpha = opacity`, honor the anchor transform
   (`translate(-50%,0)` top vs `translate(-50%,-100%)` bottom), then `drawImage`.
5. **Caption strip** along the bottom: a localized one-liner via `t()`
   (new i18n keys) — e.g. `Spring · 7 vines · 2.1M tokens` (+ optional
   `busiest: demo-pay`, gated by §3). One line, NOT a stat collage.
6. **Export** `canvas.toBlob('image/png')` → save locally (see §4).

## 3. Anonymize (safe default)
- The **scene itself contains no project text** (vines are unlabeled), so a bare
  garden shot is already safe. Only the **caption** can leak a project basename
  (which reveals a directory name).
- Default the "busiest: …" caption clause **OFF / anonymized**; expose a toggle
  (a checkbox in the export affordance, or a setting) to include it. Season / vine
  count / total tokens are non-identifying and always shown.

## 4. Save path (resolved)
- Desktop uses `save_postcard(bytes, suggested_name)`: Tauri dialog save path +
  `std::fs::write`, with the minimal dialog capability. It deliberately does
  **not** add `tauri-plugin-fs` or a broad frontend filesystem permission.
- Browser preview keeps the `<a download>` fallback.
- Filename: `garden-<season>-<yyyymmdd>.png` (timestamp from the frontend `Date`).

## 5. Trigger (codex to place)
- A subtle, labeled export affordance that fits the minimal/ambient aesthetic —
  candidates: a small icon button in the header meta row (near the settings gear),
  or in the footer next to Insight. Must be a real `<button>` with an
  `aria-label` (i18n). Not a loud CTA.

## 6. Constraints / invariants
- **Zero network**: only same-origin asset fetches (already how sprites/manifest
  load); nothing external — must pass under the locked CSP (`connect-src 'self'`
  already allows same-origin fetch; `img-src 'self' data:` allows the data-URI
  inlining). NO new external resource.
- **No canvas taint**: all images are same-origin/bundled, so `toBlob` works; if
  any draw taints the canvas, the export silently fails — verify.
- **No new app runtime deps**; vanilla JS only in `web/`. A Tauri save command (if
  needed) is the only Rust touch, gated behind a capability.
- **i18n**: caption + button label go through `t()` (en/zh already exist).
- **Privacy**: the export is a local file the user manually shares; no auto-share,
  no upload, no metadata beyond the visible caption.

## 7. Resolved questions for codex
1. Save path: native `save_postcard` command on desktop; `<a download>` only as
   browser fallback.
2. Particles: excluded for a cleaner, reproducible still.
3. Sprite mapping: `getBoundingClientRect()` relative to the scene, scaled to
   1360×880, with per-sprite computed CSS filter + opacity.
4. Trigger: footer button beside Insight; anonymize checkbox in the export panel.
5. Export scale: 2×; `ctx.filter` is feature-detected and falls back to drawing
   without filter if a platform lacks support.

## 8. Verification (after implement)
- Clicking export yields a PNG that **visually matches the on-screen garden**:
  mountains present (inlining worked), vine **tints preserved** (a high-cache /
  codex-hue vine looks the same as on screen), crisp pixels, correct sprite
  positions; caption present; saved locally.
- **No network** during export (CSP + lsof); canvas not tainted (export succeeds).
- Anonymize default hides the project basename; toggling shows it.
- Works in the browser preview; the Tauri save path verified (or flagged for the
  desktop run alongside the CSP check).
- No console errors; the affordance is keyboard-reachable + labeled.

## 9. Rollback
Pure additive: remove the export button + the postcard module (+ the save command/
capability if added). No data/schema/core-logic change.

# Programming Sticker Sources

28 wall stickers, generated as pixel-art renditions of well-known
language/tool identities (Go gopher, Rust Ferris, MySQL dolphin, Git, Docker,
Kubernetes, React, ...). They are decorative assets for Pixel Agent Garden,
not product logos, and several are close to upstream trademarked marks, so keep
them decorative and unbranded in any store or marketing copy.

Generation notes:

- Generated 2026-07-06 with an image-generation model as two style-consistent
  die-cut sticker sheets (magenta chromakey background), then keyed out and
  cropped into 96x96 transparent RGBA PNGs.
- Post-processing: removed isolated alpha fragments left by sheet cropping,
  normalized the canvas size, and lightly tuned contrast/saturation so the
  stickers read as aged wall decals in both flat and 2.5D renderers.
- All stickers keep a >=7px transparent margin; placement/scaling lives in
  `web/scene-config.js` (`programmingStickers`), consumed by both the flat
  and the 2.5D renderer.
- Product runtime does not fetch anything; all shipped images are local PNG
  files under this directory.

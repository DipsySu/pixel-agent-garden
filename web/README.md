# Web Prototype

This desktop web prototype uses generated sprite assets and local garden summary data.

Refresh data:

```bash
python3 -m local_agent_garden export-web --out web/data/garden-summary.json
```

Run locally from the project root:

```bash
python3 -m http.server 8765
```

Open:

```text
http://localhost:8765/web/index.html
```

The page reads only local files served by the local dev server:

- `web/data/garden-summary.json`
- `assets/sprites/ivy_courtyard_manifest.json`
- `assets/sprites/ivy_courtyard/**/*.png`
- `assets/sprites/courtyard_objects/**/*.png`
- `assets/sprites/courtyard_style/**/*.png`
- `assets/sprites/pavilion_trinkets/**/*.png`
- `assets/sprites/stone_cat/**/*.png`
- `assets/sprites/mountains/**/*.png`

There are no external fonts, icon CDNs, analytics, or API calls. Refreshing data is an explicit local CLI step in v1.

# Release Validation Checklist — v1.1.0

This checklist is the last desktop gate before tagging the first public
2.5D/sticker release. The app is still unsigned, so the trust story must be
proven by runtime behavior: local assets, locked CSP, no telemetry, and a
working local postcard export.

## Scope

- Target branch: `main`.
- Target tag: `v1.1.0`.
- Release type: public unsigned community build.
- Required runtime: a real Tauri desktop window, not only the browser fallback.

## Preflight

```bash
git status --branch --short
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
node --check web/garden.js
node --check web/renderers/isometric-renderer.js
node --check web/postcard.js
```

Expected result:

- Working tree is clean.
- Rust and JS checks pass.
- `main` is the branch being validated.

## CSP Desktop Pass

Run the app from a real desktop webview:

```bash
cd crates/tauri-app
AGENT_GARDEN_DEBUG=1 cargo tauri dev
```

Verify in the app:

- The default desktop renderer opens in `2.5D`.
- The scene renders fully: sky sprites, local fonts, wall stickers, project
  vines, octo-cat guardian, pavilion trinkets, koi pond, and live garden cat
  when unlocked.
- Switching `2.5D` / `Wall` works and persists after closing/reopening.
- Insight, Dashboard, Postcard, and Settings panels are mutually exclusive.
- Insight search/header remains visible while scrolling a long project list.
- Settings changes still apply without reloading remote resources.

Verify CSP behavior:

- Open WebView devtools if available and check the console.
- There are no `Content Security Policy` violations during initial render,
  scan, renderer switching, settings open/save, or postcard preview/export.
- All loaded resources are same-origin/bundled (`assets/`, `web/`, Tauri IPC).

The expected CSP in `crates/tauri-app/tauri.conf.json` is:

```text
default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost; font-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; worker-src 'none'; form-action 'none'; frame-ancestors 'none'
```

## Zero-Network Observation

While the app is open, run one of these from another terminal:

```bash
lsof -nP -iTCP -sTCP:ESTABLISHED | rg -i 'agent|garden|local agent|tauri' || true
nettop -p "$(pgrep -f 'agent-garden|Local Agent Garden' | head -1)"
```

Expected result:

- No established remote network connections are made by the app during scan,
  render, settings, or postcard export.
- Tauri IPC/local loopback behavior is acceptable; remote egress is not.

## Garden Postcard Native Save

In the Tauri desktop window:

1. Open `Postcard`.
2. Confirm the preview canvas renders the current scene.
3. Leave `Include project name` off and click `Export`.
4. Save to a temporary path outside any source agent directory.
5. Re-open the PNG and confirm:
   - mountains and sky are present;
   - wall stickers and sprites are present;
   - vine colors/tints are preserved closely enough;
   - no project name appears in the caption by default.
6. Toggle `Include project name`, export again, and confirm the basename appears
   only when explicitly enabled.

Expected result:

- Native save dialog appears.
- Saved PNG opens locally.
- No upload or remote call happens.
- Canceling the save dialog reports `Cancelled`, not an error.

## Unsigned Bundle Smoke

Build a local unsigned bundle:

```bash
cd crates/tauri-app
cargo tauri build
```

Expected result:

- macOS produces a `.dmg` under `target/release/bundle/`.
- First-launch behavior matches `docs/unsigned-installs.md`.
- The bundled app repeats the same CSP and Postcard checks above.

## PRD 2.0 Watch-Mode Additions (v1.4 gate)

New desktop checks introduced by the tray-watch / garden-memory work
(PRD 2.0 §6.1). Run on a real Tauri window before tagging the v1.4 release:

- Tray locale: on a zh system locale the tray menu (status row, Top Token
  Projects, Scan Now, Show/Hide, Settings, Data Folder, Quit) renders in
  Chinese; on en locale in English. Copy lives in `tray.rs` `tr(en, zh)` —
  not web/i18n.js.
- Tray glance contract: with today-activity present the status row reads
  "🏮 Lantern lit · N new growth" (N = today's ring events), and "garden
  growing quietly" when lit with zero ring events; quiet day reads
  "Garden is quiet today". No token number appears outside the Top Token
  Projects submenu.
- Tray icon two-state: lantern icon switches lit/unlit with `tiers.lamp`
  on the next summary update; on macOS the template variant adapts to
  light/dark menu bar.
- UTC midnight rollover: leave the app idle across 00:00 UTC (or fake the
  clock) — the status row and Today line roll to the new day within ~5s
  without any garden event.
- close_to_tray: with the setting on, closing the window hides it and the
  tray stays resident; with it off, close quits per platform default.
- launch_at_login: toggling the checkbox registers/unregisters the OS
  login item (macOS: System Settings → Login Items); off by default.
- Unlock banner: trigger a tier flip (fixture cache or threshold tweak) —
  one banner rises, queues at most 3, honors reduced-motion as fade, and
  clicking focuses/pulses the object.
- Empty state + demo: a data-less profile shows the wood-sign invitation;
  `?demo=1` in browser mode renders the bundled sample and never invokes
  Tauri commands for data.
- Rings resilience: corrupt `~/.local-agent-garden/rings.json` by hand →
  next scan quarantines it to a dated `.corrupt-*` sibling, the garden
  still renders, and memory restarts accumulating.
- First-run reveal: with `?firstrun=1` (or a cleared `pg6.firstrun.done`)
  the garden grows in stages (stage → vines → stickers → structures →
  creatures, ~3.5s), a click skips to the final state, reduced-motion
  renders instantly, and the welcome banner follows; a second normal
  launch does NOT replay.
- Scan curtain: on a cold profile with a large history, the "Waking the
  garden…" card appears within ~0.5s and fades once the first summary
  paints; a warm cache launch never flashes it.

## Tag Gate

Only tag after the checklist above passes:

```bash
git tag -a v1.1.0 -m "v1.1.0"
git push origin v1.1.0
```

The release workflow should publish unsigned bundles automatically. Code signing
and the Tauri updater remain post-release follow-ups.

## Current Validation Notes

Automated pass on 2026-07-06:

- `cargo fmt --all --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- JS syntax checks for `web/garden.js`, `web/renderers/isometric-renderer.js`,
  `web/postcard.js`, `web/data-source.js`, `web/renderers/renderer-factory.js`,
  and `web/renderers/isometric-base.js`
- CSP string in this checklist matches `crates/tauri-app/tauri.conf.json`
- `cargo tauri dev` launched a real desktop window; a screenshot confirmed the
  2.5D courtyard, wall stickers, local fonts, sprites, octo-cat guardian,
  pavilion trinkets, koi pond, and footer controls render under the desktop app
- `lsof -nP -iTCP -sTCP:ESTABLISHED | rg -i 'agent|garden|tauri'` returned no
  established remote connections while the desktop app was open
- `cargo tauri build` produced the unsigned macOS app and DMG:
  `target/release/bundle/macos/Local Agent Garden.app` and
  `target/release/bundle/dmg/Local Agent Garden_1.1.0_x64.dmg`
- Garden Postcard native save was verified from the bundled app by saving a real
  PNG (`garden-winter-20260706.png`, local validation artifact, not committed):
  1360x880 RGBA, SHA-256 prefix `3c5e13226f5eb14b6453af7b`. The saved image
  includes the full 2.5D scene, wall stickers, sprite layers, stamp/postmark,
  and the explicit `Include project name` caption path.

Optional final human desktop check before tagging:

- Open WebView devtools and confirm no CSP violation messages.
- Re-open the bundled app once and confirm the default Postcard checkbox remains
  off before enabling `Include project name`.

# Privacy & Security

Pixel Agent Garden is a **100% local** tool. It reads your local AI-agent activity
(Claude Code, Claude Cowork, Codex, and a manual-JSONL escape hatch for others like
Cursor) and renders it as a pixel garden. This document states the guarantee and —
because the app is distributed **unsigned** for now — shows you how to **verify it
yourself** rather than just trust us.

## The contract

1. **No network requests.** The app never connects to the internet — not to scan,
   render, update, or report anything. There is no telemetry, no analytics, no
   crash reporting, no "phone home", not even opt-in.
2. **Source directories are read-only.** It reads `~/.claude/projects/`,
   `~/.codex/`, etc., and **never writes to them**.
3. **One local cache, nothing else.** The only thing it writes is its own cache and
   settings under `~/.local-agent-garden/`.

## How the guarantee is enforced (not just promised)

- **Locked Content-Security-Policy.** The desktop webview runs under a CSP
  (`crates/tauri-app/tauri.conf.json`) that forbids loading or connecting to any
  external host:

  ```
  default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline';
  script-src 'self'; connect-src 'self' ipc: http://ipc.localhost; font-src 'self';
  object-src 'none'; base-uri 'self'; frame-src 'none'; worker-src 'none';
  form-action 'none'; frame-ancestors 'none'
  ```

  `connect-src` allows only same-origin requests (the bundled sprite manifest) and
  the local Tauri IPC bridge — **no external domain can be reached**, and a stray
  remote `<img>`/`<script>`/`fetch` is blocked by the runtime, not by discipline.
- **CI supply-chain gate.** Every push runs a "zero-network gate"
  (`.github/workflows/ci.yml` + `deny.toml`): `cargo deny check advisories bans
  sources` plus a `Cargo.lock` scan that **fails the build** if a new networking,
  server, or telemetry crate is introduced. You can read the result in the public
  CI logs.

### Honest note on dependencies

The desktop shell is built on [Tauri](https://tauri.app), which transitively
includes an HTTP client crate (`reqwest`) in the dependency tree. **The app never
calls it** — it is part of Tauri's own optional surface, not wired into any code
path here. That is exactly why the guarantee above is **behavioral and
runtime-enforced** (the CSP + the verification below), rather than a claim that "no
HTTP code is compiled in." The CI gate therefore targets *newly added* egress/
telemetry crates; it intentionally does not ban Tauri's baseline `reqwest`/`hyper`/
`tokio`.

## Verify it yourself (60 seconds)

Run the app, let it scan and render, and watch for outbound connections — you
should see **none**:

- **macOS:** `sudo lsof -i -nP | grep -i 'local-agent-garden'` (or watch with
  `nettop`, or use Little Snitch / LuLu). No remote connections appear.
- **Windows:** open **Resource Monitor → Network** (or TCPView) and filter to the
  app — no remote endpoints.
- **Linux:** `ss -tunp | grep local-agent-garden` (or `lsof -i`) while it runs.

Then read the two enforcement points above: the `csp` value in
`crates/tauri-app/tauri.conf.json`, and the supply-chain job in
`.github/workflows/ci.yml`.

## Unsigned builds

Releases are currently **unsigned** (code-signing certificates are not yet in
place). macOS Gatekeeper / Windows SmartScreen will warn on first launch; see the
README for the right-click → Open / "Run anyway" steps. Signing — and, only then,
an **explicit, opt-in, user-initiated** update check — are planned; until shipped,
the app makes **no** network requests of any kind.

## Reporting

Found something that contradicts this document? Please open an issue at
<https://github.com/DipsySu/pixel-agent-garden/issues>.

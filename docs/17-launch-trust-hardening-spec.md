# Spec 17 — Launch trust hardening (make "zero-network" provable)

Status: **v2 — direction AGREED with codex (round 1); implementing.**

**Final CSP** (codex-confirmed): `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ipc: http://ipc.localhost; font-src 'self'; object-src 'none'; base-uri 'self'; frame-src 'none'; worker-src 'none'; form-action 'none'; frame-ancestors 'none'` — `connect-src` MUST allow `'self'` (same-origin manifest fetch) + `ipc: http://ipc.localhost` (Tauri v2 IPC), NOT `'none'`; no `asset:` needed (no `convertFileSrc`).
**CI ban list** = unambiguous egress client/server/telemetry crates that are NOT in the Tauri baseline. codex flagged the trap: `reqwest`/`hyper`/`tokio`/`url` are pulled transitively by Tauri 2.x — banning them would red-line CI on the current tree, so they are intentionally excluded. TLS libs (rustls/openssl/native-tls) also excluded (ambiguous; a future Tauri bump could pull them). Empirically none of the banned crates are in the current `Cargo.lock`.
**Honest framing**: the definitive proof is runtime (lsof / Little Snitch = zero connections) + the locked CSP; the CI gate is defense-in-depth against NEW egress deps (it cannot catch new *use* of the already-transitive reqwest, which the CSP + behavioral verification cover).
Owner: repo root (LICENSE, PRIVACY.md), `crates/tauri-app/tauri.conf.json` (CSP),
`.github/workflows/` + `deny.toml` (CI gate)
Scope: turn the privacy promise from honor-system prose into a **runtime-enforced,
CI-verified, publicly-documented** guarantee — the trust foundation for a PUBLIC,
UNSIGNED early launch to a broad multi-agent audience.
Non-scope: code signing / updater (owner deferred certs), feature work, new deps in
the app runtime.

> Product decisions driving this: **public launch**, **signing certs deferred**
> (so trust CANNOT lean on code-signing — it must lean on verifiable privacy),
> **broad multi-agent audience** (frame the privacy story tool-agnostically). This
> is the synthesis's #1 "Now" recommendation.

## 1. Why
For a tool that reads `~/.claude` and ships UNSIGNED, the only thing that earns an
install from a stranger is a privacy claim they can *verify*. Today:
- `Cargo.toml` declares `license = "MIT"` but there is **no `LICENSE` file** → no
  GitHub license badge → silent trust-killer.
- `tauri.conf.json` `security.csp = null` → nothing structurally prevents the
  webview from loading remote resources or phoning home; "never reaches the
  network" is unprovable and one stray `<img src=https://…>` would violate it.
- "Zero network / zero telemetry" is asserted in docs but **not machine-checked**,
  so a future dependency could silently break it.

## 2. Deliverables

### A. `LICENSE` (MIT)
- Add a standard MIT `LICENSE` file at repo root matching `Cargo.toml`'s
  `license = "MIT"`. Owner/year per existing copyright (`© 2026 Local Agent
  Garden`). Trivial; unblocks the GitHub license badge.

### B. `PRIVACY.md` (+ a short `SECURITY.md` or a section)
- One page stating the three contract rules verbatim from CLAUDE.md: (1) never
  makes network requests, (2) never writes source agent dirs (read-only), (3)
  cache only in `~/.local-agent-garden/`; no telemetry/analytics.
- A **"verify it yourself"** recipe: watch egress with Little Snitch / `lsof -i` /
  `nettop` (macOS) or TCPView / Resource Monitor (Windows) and observe **zero**
  connections during scan + render; point at the locked CSP value; point at the CI
  no-network gate (link the workflow). Frame tool-agnostically (Claude Code /
  Cowork / Codex / Cursor-via-manual-jsonl / etc.).
- Note the ONE future deliberate exception (an opt-in, user-initiated update check)
  does **not** exist yet (no updater shipped).

### C. Lock the CSP — Tauri-aware (the careful one)
- Replace `security.csp: null` with a locked policy. **Corrected from the naive
  "connect-src 'none'"**, which would break this app, because in the Tauri webview:
  - `garden.js` does `fetch('./assets/sprites/ivy_courtyard_manifest.json')`
    (same-origin) → governed by **connect-src**;
  - `data-source.js` uses Tauri **IPC `invoke`** → needs the IPC origin allowed;
  - sprites load via same-origin `./assets/...` (`img-src 'self'`), NOT the asset:
    protocol (no `convertFileSrc` in the code);
  - `index.html` has a large inline `<style>` block → needs `style-src
    'unsafe-inline'`; scripts are external modules only (no inline script).
- **Proposed value** (codex to confirm against Tauri v2 specifics):
  ```
  default-src 'self';
  img-src 'self' data:;
  style-src 'self' 'unsafe-inline';
  script-src 'self';
  connect-src 'self' ipc: http://ipc.localhost;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  frame-src 'none'
  ```
  Rationale: allows same-origin assets/manifest + Tauri IPC, blocks ALL external
  hosts (no remote img/script/style/fetch/font), no inline/eval scripts.
- **Verification caveat**: CSP only applies in the Tauri webview (browser preview
  ignores `tauri.conf.json`). So it MUST be verified by running the desktop app
  (`cargo tauri dev`) — confirm the garden renders (sprites, inline styles, SVG),
  data loads via invoke, no CSP violations in the webview devtools console — before
  it ships. (Owner/desktop run may be needed given the CI/build environment.)

### D. CI no-network / supply-chain gate
- Add a `deny.toml` + a CI job running `cargo deny check advisories bans sources`
  (minimal: advisories + a **bans** list for networking crates), AND/OR a simpler
  `Cargo.lock` grep step that **fails the build** if known network/telemetry crates
  appear (`reqwest`, `hyper`, `isahc`, `ureq`, `tokio` with net features,
  `sentry`, etc.). Keep it minimal — bans + advisories, NOT a license crusade.
- Wire it into `.github/workflows/` so the guarantee is a machine-checked fact
  visible in public CI logs (link it from PRIVACY.md).
- Confirm the gate is honest: it must actually catch a network crate if one is
  added (test the grep/deny locally against a fake entry).

### E. Docs
- README: add the license badge + a one-line link to PRIVACY.md ("100% local —
  verify it yourself"). (Hero GIF + release publish = separate follow-up batch.)
- `CHANGELOG.md` `## Unreleased`: a `docs:`/`chore:` line.

## 3. Constraints / invariants
- **No new app runtime deps** (cargo-deny is a dev/CI tool, not linked into the app).
- The CSP must not break the real app — desktop verification is a hard gate before
  release.
- Privacy contract unchanged (this only *enforces + documents* it).
- Modularity respected; no core logic change.

## 4. Open questions for codex (align before implementing)
1. **CSP exact directives** for Tauri v2: is `connect-src 'self' ipc:
   http://ipc.localhost` the right IPC allowance (v2 with `withGlobalTauri:true`),
   or does it need `asset:`/`https://asset.localhost` / `tauri:` too given
   `assetProtocol.enable:true`? Will `img-src 'self'` cover the bundled sprites, or
   is `asset:` actually used at runtime? Any directive missing/over-broad? Pick the
   minimal correct policy.
2. **CI gate shape**: `cargo-deny` (bans+advisories) vs a lightweight `Cargo.lock`
   grep vs both? What's the right ban list so it catches real egress crates without
   false-positiving on transitive build-only deps?
3. Anything else that brushes the network in the Tauri webview at runtime that the
   CSP would break (web-fonts, telemetry, devtools)?
4. Should `withGlobalTauri:true` stay (it widens the JS surface) for a security-
   forward posture, or is it needed?

## 5. Verification
- `LICENSE` present; GitHub shows the MIT badge; matches Cargo.toml.
- PRIVACY.md recipe is accurate (the commands actually show zero egress).
- **Desktop app under the locked CSP renders fully** (sprites/SVG/inline styles),
  data loads via invoke, **no CSP violation errors** in the webview console; and a
  deliberately-added external `<img src=https://…>` IS blocked (proves the policy
  bites).
- CI gate fails when a network crate is introduced (test with a temporary fake
  entry, then revert); passes on the current tree.
- `cargo fmt`/`clippy`/tests unaffected (no Rust logic change).

## 6. Rollback
Each item reverts independently: delete LICENSE/PRIVACY.md, restore `csp:null`,
remove the deny.toml + CI job. No app code or data/schema change.

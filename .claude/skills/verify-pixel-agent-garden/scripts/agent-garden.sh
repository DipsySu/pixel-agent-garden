#!/usr/bin/env bash
# Run the agent-garden CLI only against a disposable HOME.
# Refuses the real user home so a verify drive cannot scan ~/.claude, ~/.codex, or ~/.cursor.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
BIN="$REPO_ROOT/target/debug/agent-garden"

if [[ ! -x "$BIN" ]]; then
  echo "verify: missing $BIN" >&2
  echo "verify: build with: CARGO_BUILD_JOBS=2 cargo build -p local-agent-garden-cli" >&2
  exit 127
fi

real_home="$(getent passwd "$(id -un)" | awk -F: '{print $6}')"
if [[ -z "${real_home}" || ! -d "$real_home" ]]; then
  echo "verify: could not resolve the real user home; refusing to run" >&2
  exit 2
fi
real_phys="$(cd "$real_home" && pwd -P)"

if [[ -z "${HOME:-}" || ! -d "$HOME" ]]; then
  echo "verify: HOME must be an existing disposable directory; refusing to scan the real home" >&2
  exit 2
fi
home_phys="$(cd "$HOME" && pwd -P)"
if [[ "$home_phys" == "$real_phys" || "$home_phys" == "$real_phys"/* ]]; then
  echo "verify: refusing HOME=$home_phys (inside the real user home)" >&2
  exit 2
fi

if [[ -z "${XDG_DATA_HOME:-}" || ! -d "$XDG_DATA_HOME" ]]; then
  echo "verify: XDG_DATA_HOME must be an existing disposable directory" >&2
  exit 2
fi
xdg_phys="$(cd "$XDG_DATA_HOME" && pwd -P)"
if [[ "$xdg_phys" == "$real_phys" || "$xdg_phys" == "$real_phys"/* ]]; then
  echo "verify: refusing XDG_DATA_HOME=$xdg_phys (inside the real user home)" >&2
  exit 2
fi

export HOME="$home_phys"
export XDG_DATA_HOME="$xdg_phys"
export USERPROFILE="$home_phys"
exec "$BIN" "$@"

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

home_phys="$("$SCRIPT_DIR/outside-real-home.sh" HOME "${HOME:-}")" || exit 2
xdg_phys="$("$SCRIPT_DIR/outside-real-home.sh" XDG_DATA_HOME "${XDG_DATA_HOME:-}")" || exit 2

export HOME="$home_phys"
export XDG_DATA_HOME="$xdg_phys"
export USERPROFILE="$home_phys"
exec "$BIN" "$@"

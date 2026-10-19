#!/usr/bin/env bash
# Prepare one verify run and serve the static garden the way the browser fallback does.
# Invoked by control.sh as LAUNCH_CMD, with PORT, DATA_DIR, BASE_URL, and RUN_ID exported,
# and with the working directory at the repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT"

: "${PORT:?verify: PORT is required}"
: "${DATA_DIR:?verify: DATA_DIR is required}"

real_home="$(getent passwd "$(id -un)" | awk -F: '{print $6}')"
real_phys="$(cd "$real_home" && pwd -P)"
data_phys="$(cd "$DATA_DIR" && pwd -P)"
if [[ "$data_phys" == "$real_phys" || "$data_phys" == "$real_phys"/* ]]; then
  echo "verify: DATA_DIR is inside the real user home; refusing" >&2
  exit 2
fi

RUN_STATE="$(cd "$(dirname "$DATA_DIR")" && pwd -P)"
SITE="$RUN_STATE/site"
HOME_DIR="$DATA_DIR/home"
XDG_DIR="$DATA_DIR/xdg"
FIXTURE="$DATA_DIR/fixture/events.jsonl"
SUMMARY="$DATA_DIR/garden-summary.json"

mkdir -p "$HOME_DIR" "$XDG_DIR" "$(dirname "$FIXTURE")" "$SITE/web/data"

# Verification scaffolding: a synthetic manual-jsonl source. cleanup deletes RUN_STATE.
cat > "$DATA_DIR/fixture/README.txt" <<'EOF'
Verification scaffolding. One synthetic manual-jsonl row for agent-garden.
control.sh cleanup deletes this run state directory.
EOF

cat > "$FIXTURE" <<'EOF'
{"source":"aider","timestamp":"2026-05-27T12:00:00Z","project_path":"/tmp/verify-garden/demo-plot","session_id":"verify-session-1","event_type":"message","input_tokens":1200,"output_tokens":400,"cache_read_tokens":30,"cache_write_tokens":20,"total_tokens":1650,"tool_calls":3,"model":"manual-model"}
EOF

# Real files only under DATA_DIR, so evidence --copy-data does not follow a tree of symlinks.
# The static site lives beside DATA_DIR and is removed with the run state on cleanup.
link_files() {
  local src="$1" dst="$2" f rel
  while IFS= read -r -d '' f; do
    rel="${f#"$src"/}"
    mkdir -p "$dst/$(dirname -- "$rel")"
    ln -sfn "$f" "$dst/$rel"
  done < <(find "$src" -type f -print0)
}

link_files "$REPO_ROOT/web" "$SITE/web"
rm -f "$SITE/web/data/garden-summary.json"
if [[ -d "$REPO_ROOT/assets" ]]; then
  link_files "$REPO_ROOT/assets" "$SITE/assets"
fi

export HOME="$HOME_DIR"
export XDG_DATA_HOME="$XDG_DIR"
export USERPROFILE="$HOME_DIR"

"$SCRIPT_DIR/agent-garden.sh" --manual-jsonl "$FIXTURE" scan
"$SCRIPT_DIR/agent-garden.sh" --manual-jsonl "$FIXTURE" export-web \
  --from-cache "$HOME_DIR/.local-agent-garden/events.json" \
  --out "$SUMMARY"
ln -sfn "$SUMMARY" "$SITE/web/data/garden-summary.json"

echo "verify: serving $SITE on 127.0.0.1:$PORT"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$SITE"

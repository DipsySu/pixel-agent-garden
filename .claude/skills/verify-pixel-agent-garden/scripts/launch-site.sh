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

# Physical paths from here on. agent-garden.sh exports the physical HOME, and the CLI keeps its
# canonical rings.json only for its own default cache path; a /tmp or $TMPDIR symlink (macOS) in
# --from-cache would otherwise send launch's garden memory to a sibling events.rings.json.
# The site is written beside DATA_DIR, so its parent is checked too: a DATA_DIR symlink that sits
# in the real home but points elsewhere would otherwise put site/ in that home.
DATA_DIR="$("$SCRIPT_DIR/outside-real-home.sh" DATA_DIR "$DATA_DIR")" || exit 2
RUN_STATE="$("$SCRIPT_DIR/outside-real-home.sh" 'DATA_DIR parent' "$(dirname "$DATA_DIR")")" || exit 2
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

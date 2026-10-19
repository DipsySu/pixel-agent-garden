#!/usr/bin/env bash
# Regression tests for the verify harness scripts. Needs bash and python3 only: no cargo build and no
# real agent data. Each case copies scripts/ into a throwaway repo layout under one temp root, with a
# stub launch-site.sh or a stub agent-garden binary where the case needs one, so the real control.sh,
# launch-site.sh, agent-garden.sh, and outside-real-home.sh run unchanged.
#
#   bash .claude/skills/verify-pixel-agent-garden/tests/harness-regressions.sh
#
# The real home is only stat()ed and pointed at by symlinks inside the temp root; nothing under it is
# read or written. A getent that fails loudly is first on PATH, so no case can pass by using it.
set -euo pipefail

SKILL="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/verify-harness-test.XXXXXX")"
T="$(cd "$T" && pwd -P)"
REAL_HOME="$(python3 -I -c 'import os, pwd; print(pwd.getpwuid(os.getuid()).pw_dir)')"
PIDS=()
pass=0 fail=0

teardown() {
  local p
  for p in ${PIDS[@]+"${PIDS[@]}"}; do alive "$p" && { kill -KILL -- "-$p" "$p" 2>/dev/null || true; }; done
  rm -rf "$T"
}
trap teardown EXIT

ok() { pass=$((pass + 1)); echo "ok   - $1"; }
bad() { fail=$((fail + 1)); echo "FAIL - $1" >&2; [[ -z "${2:-}" ]] || sed 's/^/       /' "$2" >&2; }
alive() { kill -0 "$1" 2>/dev/null && [[ "$(ps -o stat= -p "$1" 2>/dev/null)" != Z* ]]; }
gone_within() { local i; for i in $(seq 1 50); do alive "$1" || return 0; sleep 0.1; done; return 1; }
tree_sum() { (cd "$1" && find . -type f -print | LC_ALL=C sort | while IFS= read -r f; do printf '%s ' "$f"; cksum < "$f"; done); }

mkdir -p "$T/bin"
printf '#!/bin/sh\necho "getent was called" >> "%s/getent-called"\nexit 1\n' "$T" > "$T/bin/getent"
chmod +x "$T/bin/getent"
export PATH="$T/bin:$PATH"

# A repo layout whose .claude/skills/verify-pixel-agent-garden/scripts is a copy of the real one.
mk_repo() {
  local r="$T/$1"
  mkdir -p "$r/.claude/skills/verify-pixel-agent-garden" "$r/target/debug" "$r/web/data"
  cp -R "$SKILL/scripts" "$r/.claude/skills/verify-pixel-agent-garden/"
  echo '<title>stub</title>' > "$r/web/index.html"
  echo "$r"
}
stub_launch() {  # REPO BODY: replace launch-site.sh with a stub
  printf '#!/usr/bin/env bash\nset -euo pipefail\n%s\n' "$2" > "$1/.claude/skills/verify-pixel-agent-garden/scripts/launch-site.sh"
  chmod +x "$1/.claude/skills/verify-pixel-agent-garden/scripts/launch-site.sh"
}
stub_cli() {  # REPO: an agent-garden stub that prints its HOME and writes --out files
  cat > "$1/target/debug/agent-garden" <<'EOF'
#!/usr/bin/env bash
echo "HOME=$HOME XDG_DATA_HOME=$XDG_DATA_HOME ARGS=$*"
prev=""
for a in "$@"; do
  if [[ "$prev" == --out ]]; then echo '{"schema_version": 9, "stub": true}' > "$a"; fi
  prev="$a"
done
EOF
  chmod +x "$1/target/debug/agent-garden"
}
SERVE='mkdir -p "$DATA_DIR/site/web/data"
echo ok > "$DATA_DIR/site/web/index.html"
echo "{}" > "$DATA_DIR/site/web/data/garden-summary.json"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$DATA_DIR/site"'

# ---- control.sh: prove must not tear down a run it did not launch --------------------------------
R="$(mk_repo own)"; stub_launch "$R" "$SERVE"
C="$R/.claude/skills/verify-pixel-agent-garden/scripts/control.sh"
export VERIFY_STATE_DIR="$T/own-state" VERIFY_ARTIFACTS_DIR="$T/own-artifacts" VERIFY_READY_TIMEOUT=20

VERIFY_RUN_ID=old-run "$C" launch > "$T/old.json"
old_pid="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["pid"])' "$T/old.json")"
PIDS+=("$old_pid")
before_state="$(tree_sum "$VERIFY_STATE_DIR")"; before_ev="$(tree_sum "$VERIFY_ARTIFACTS_DIR")"
if "$C" prove http GET /web/index.html > "$T/prove.out" 2>&1; then
  bad "prove exits non-zero while an earlier run is alive" "$T/prove.out"
else
  grep -q 'run old-run is still alive' "$T/prove.out" && ok "prove refuses while an earlier run is alive" \
    || bad "prove names the live run it refused for" "$T/prove.out"
fi
alive "$old_pid" && ok "the earlier run's process is still running" || bad "the earlier run's process is still running"
[[ "$(cat "$VERIFY_STATE_DIR/current")" == old-run ]] && ok "the current marker still names the earlier run" \
  || bad "the current marker still names the earlier run"
[[ "$(tree_sum "$VERIFY_STATE_DIR")" == "$before_state" ]] && ok "the earlier run's state files are unchanged" \
  || bad "the earlier run's state files are unchanged"
[[ "$(tree_sum "$VERIFY_ARTIFACTS_DIR")" == "$before_ev" ]] && ok "no evidence was added or removed" \
  || bad "no evidence was added or removed"
"$C" doctor > "$T/doctor.out" 2>&1 && ok "the earlier run still passes doctor" || bad "the earlier run still passes doctor" "$T/doctor.out"

# A taken run id is a refused launch too: its state belongs to whoever created it.
mkdir -p "$VERIFY_STATE_DIR/taken" && echo 'RUN_ID=taken' > "$VERIFY_STATE_DIR/taken/env"
"$C" cleanup >/dev/null
gone_within "$old_pid" && ok "explicit cleanup still stops the earlier run" || bad "explicit cleanup still stops the earlier run"
if VERIFY_RUN_ID=taken "$C" prove http GET /web/index.html > "$T/taken.out" 2>&1; then
  bad "prove refuses a run id that already has state" "$T/taken.out"
else
  [[ -f "$VERIFY_STATE_DIR/taken/env" ]] && ok "a taken run id's state is left alone" || bad "a taken run id's state is left alone" "$T/taken.out"
fi
"$C" cleanup --run taken --owner nobody | grep -q '"cleaned": false' && [[ -d "$VERIFY_STATE_DIR/taken" ]] \
  && ok "cleanup --run with the wrong owner deletes nothing" || bad "cleanup --run with the wrong owner deletes nothing"
rm -rf "$VERIFY_STATE_DIR/taken"

# ---- control.sh: prove still tears down the run it did create ------------------------------------
for kind in exits hangs; do
  R="$(mk_repo "fail-$kind")"
  C="$R/.claude/skills/verify-pixel-agent-garden/scripts/control.sh"
  if [[ $kind == exits ]]; then
    stub_launch "$R" "echo \$\$ > '$T/$kind.pid'; echo 'stub: startup failed' >&2; exit 3"
  else
    stub_launch "$R" "echo \$\$ > '$T/$kind.pid'; exec sleep 300"
  fi
  export VERIFY_STATE_DIR="$T/$kind-state" VERIFY_ARTIFACTS_DIR="$T/$kind-artifacts" VERIFY_READY_TIMEOUT=2
  if VERIFY_RUN_ID="new-$kind" "$C" prove http GET /web/index.html > "$T/$kind.out" 2>&1; then
    bad "prove fails when the app $kind during startup" "$T/$kind.out"
  else
    ok "prove fails when the app $kind during startup"
  fi
  stub_pid="$(cat "$T/$kind.pid" 2>/dev/null || true)"
  [[ -n "$stub_pid" ]] && PIDS+=("$stub_pid")
  [[ -n "$stub_pid" ]] && gone_within "$stub_pid" && ok "the app that $kind is not left running" \
    || bad "the app that $kind is not left running" "$T/$kind.out"
  [[ ! -e "$VERIFY_STATE_DIR/new-$kind" && ! -e "$VERIFY_STATE_DIR/current" ]] \
    && ok "its run state and current marker are removed ($kind)" || bad "its run state and current marker are removed ($kind)" "$T/$kind.out"
  [[ -f "$VERIFY_ARTIFACTS_DIR/new-$kind/launch.log" ]] && ok "its launch log is kept ($kind)" \
    || bad "its launch log is kept ($kind)"
done

# ---- the real launch-site.sh + agent-garden.sh under prove, with getent failing ------------------
R="$(mk_repo site)"; stub_cli "$R"
C="$R/.claude/skills/verify-pixel-agent-garden/scripts/control.sh"
export VERIFY_STATE_DIR="$T/site-state" VERIFY_ARTIFACTS_DIR="$T/site-artifacts" VERIFY_READY_TIMEOUT=20
if VERIFY_RUN_ID=site-run "$C" prove http GET /web/data/garden-summary.json --expect 200 > "$T/site.out" 2>&1; then
  ok "prove passes through the real launch-site.sh"
else
  bad "prove passes through the real launch-site.sh" "$T/site.out"
fi
grep -q '"stub": true' "$VERIFY_ARTIFACTS_DIR/site-run/001-adhoc-http.json" 2>/dev/null \
  && ok "the served summary is the one export-web wrote" || bad "the served summary is the one export-web wrote" "$T/site.out"
[[ -f "$VERIFY_ARTIFACTS_DIR/site-run/manifest.json" && ! -e "$VERIFY_STATE_DIR/site-run" ]] \
  && ok "evidence kept, state removed" || bad "evidence kept, state removed"

# ---- agent-garden.sh / outside-real-home.sh: refuse the real home in every spelling --------------
G="$R/.claude/skills/verify-pixel-agent-garden/scripts/agent-garden.sh"
O="$R/.claude/skills/verify-pixel-agent-garden/scripts/outside-real-home.sh"
mkdir -p "$T/fake/home" "$T/fake/xdg"
ln -s "$REAL_HOME" "$T/home-link"
ln -s "$T/fake/home" "$T/fake-home-link"
run_g() {  # EXPECT_RC DESC HOME XDG
  local rc=0
  env HOME="$3" XDG_DATA_HOME="$4" "$G" adapters > "$T/g.out" 2>&1 || rc=$?
  if [[ "$rc" == "$1" ]]; then ok "$2"; else bad "$2 (exit $rc, want $1)" "$T/g.out"; fi
}
run_g 0 "agent-garden.sh runs with a disposable HOME and XDG_DATA_HOME" "$T/fake/home" "$T/fake/xdg"
grep -q "HOME=$T/fake/home XDG_DATA_HOME=$T/fake/xdg" "$T/g.out" && ok "the CLI sees the physical disposable paths" \
  || bad "the CLI sees the physical disposable paths" "$T/g.out"
run_g 0 "a symlink to a disposable HOME is allowed" "$T/fake-home-link" "$T/fake/xdg"
run_g 2 "HOME = the real home is refused" "$REAL_HOME" "$T/fake/xdg"
run_g 2 "HOME = a symlink to the real home is refused" "$T/home-link" "$T/fake/xdg"
run_g 2 "XDG_DATA_HOME = the real home is refused" "$T/fake/home" "$REAL_HOME"
run_g 2 "XDG_DATA_HOME = a symlink to the real home is refused" "$T/fake/home" "$T/home-link"
run_g 2 "a missing HOME is refused" "$T/fake/nope" "$T/fake/xdg"
run_g 2 "an empty HOME is refused" "" "$T/fake/xdg"
upper="$(printf '%s' "$REAL_HOME" | tr '[:lower:]' '[:upper:]')"
if [[ "$upper" != "$REAL_HOME" && -d "$upper" ]]; then
  run_g 2 "HOME = the real home in other letter case is refused" "$upper" "$T/fake/xdg"
else
  echo "skip - case-insensitive spelling of the real home (this volume is case-sensitive)"
fi
if [[ "$(cd "$REAL_HOME/.." && pwd -P)" != / ]]; then
  "$O" HOME "$REAL_HOME/.." > /dev/null 2>&1 && ok "the real home's parent is outside it" \
    || bad "the real home's parent is outside it"
fi

# Fail closed without python3: bash and dirname only on PATH.
mkdir -p "$T/nopy"
for tool in bash dirname; do ln -s "$(command -v "$tool")" "$T/nopy/$tool"; done
rc=0; env PATH="$T/nopy" HOME="$T/fake/home" XDG_DATA_HOME="$T/fake/xdg" bash "$G" adapters > "$T/nopy.out" 2>&1 || rc=$?
[[ "$rc" == 2 ]] && ok "without python3 the guard refuses (exit 2)" || bad "without python3 the guard refuses (exit $rc)" "$T/nopy.out"

[[ ! -e "$T/getent-called" ]] && ok "getent was never called" || bad "getent was never called"

# ---- skill-checks.sh: explicit resolution, always --require-proof --------------------------------
K="$R/.claude/skills/verify-pixel-agent-garden/scripts/skill-checks.sh"
rc=0; env -u VERIFY_SKILLS_DIR -u CODEX_HOME HOME="$T/fake/home" "$K" contract "$T/none" > "$T/k.out" 2>&1 || rc=$?
[[ "$rc" == 2 ]] && grep -q 'VERIFY_SKILLS_DIR' "$T/k.out" && ok "skill-checks.sh exits 2 and says how when the checkers are missing" \
  || bad "skill-checks.sh exits 2 and says how when the checkers are missing (exit $rc)" "$T/k.out"
S="$T/skills"
mkdir -p "$S/create-verification-skill/scripts" "$S/maintain-verification-skill/scripts"
printf 'import sys\nprint("ARGV", *sys.argv[1:])\n' > "$S/create-verification-skill/scripts/check_verify_skill.py"
cp "$S/create-verification-skill/scripts/check_verify_skill.py" "$S/maintain-verification-skill/scripts/drift_check.py"
: > "$S/create-verification-skill/scripts/scan_repo.py"
VERIFY_SKILLS_DIR="$S" "$K" contract "$T/ev" > "$T/k.out" 2>&1 && grep -q -- "--require-proof $T/ev" "$T/k.out" \
  && ok "contract always passes --require-proof" || bad "contract always passes --require-proof" "$T/k.out"
VERIFY_SKILLS_DIR="$S" VERIFY_ARTIFACTS_DIR="$T/ev2" "$K" contract > "$T/k.out" 2>&1 && grep -q -- "--require-proof $T/ev2" "$T/k.out" \
  && ok "contract defaults to control.sh's VERIFY_ARTIFACTS_DIR" || bad "contract defaults to control.sh's VERIFY_ARTIFACTS_DIR" "$T/k.out"
rc=0; VERIFY_SKILLS_DIR="$T/fake" "$K" drift > "$T/k.out" 2>&1 || rc=$?
[[ "$rc" == 2 ]] && ok "a VERIFY_SKILLS_DIR without the checkers is an error, not a fallback" \
  || bad "a VERIFY_SKILLS_DIR without the checkers is an error, not a fallback (exit $rc)" "$T/k.out"

echo "harness-regressions: $pass passed, $fail failed"
[[ "$fail" == 0 ]]

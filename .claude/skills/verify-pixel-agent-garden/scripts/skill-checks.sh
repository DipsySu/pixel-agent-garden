#!/usr/bin/env bash
# usage: skill-checks.sh contract [EVIDENCE_ROOT] | skill-checks.sh drift
# Runs the reusable checkers from create-verification-skill and maintain-verification-skill against
# this skill. This repo commits only verify-pixel-agent-garden, so the checkers are found, not
# assumed: $VERIFY_SKILLS_DIR when set (and only there), else the first of these skills roots that
# holds both skills: <repo>/.claude/skills, <repo>/.codex/skills, ${CODEX_HOME:-~/.codex}/skills,
# ~/.claude/skills. It prints the root it used and exits 2 when none has them.
#
# contract always passes --require-proof: a skill whose proof never ran is a draft. EVIDENCE_ROOT
# defaults to control.sh's (VERIFY_ARTIFACTS_DIR, else artifacts/verify). The checker accepts any
# earlier manifest there, so for acceptance prove into a fresh VERIFY_ARTIFACTS_DIR and check that.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"

die() { echo "skill-checks.sh: $*" >&2; exit 2; }

has_skills() {
  [[ -f "$1/create-verification-skill/scripts/check_verify_skill.py" \
    && -f "$1/create-verification-skill/scripts/scan_repo.py" \
    && -f "$1/maintain-verification-skill/scripts/drift_check.py" ]]
}

skills_root() {
  local cand
  if [[ -n "${VERIFY_SKILLS_DIR:-}" ]]; then
    has_skills "$VERIFY_SKILLS_DIR" || die "VERIFY_SKILLS_DIR=$VERIFY_SKILLS_DIR lacks create-verification-skill and maintain-verification-skill"
    echo "$VERIFY_SKILLS_DIR"
    return
  fi
  for cand in "$REPO_ROOT/.claude/skills" "$REPO_ROOT/.codex/skills" \
              "${CODEX_HOME:-${HOME:-/nonexistent}/.codex}/skills" "${HOME:-/nonexistent}/.claude/skills"; do
    if has_skills "$cand"; then echo "$cand"; return; fi
  done
  die "create-verification-skill + maintain-verification-skill not found in <repo>/.claude/skills, <repo>/.codex/skills, \${CODEX_HOME:-~/.codex}/skills, or ~/.claude/skills; install them or set VERIFY_SKILLS_DIR to their skills root"
}

cmd="${1:-}"
[[ $# -gt 0 ]] && shift
case "$cmd" in
  contract)
    [[ $# -le 1 ]] || die "usage: skill-checks.sh contract [EVIDENCE_ROOT]"
    root="$(skills_root)"
    evidence="${1:-${VERIFY_ARTIFACTS_DIR:-$REPO_ROOT/artifacts/verify}}"
    echo "skill-checks.sh: checker from $root; proof from $evidence" >&2
    exec python3 -I "$root/create-verification-skill/scripts/check_verify_skill.py" "$SKILL_DIR" --require-proof "$evidence"
    ;;
  drift)
    [[ $# -eq 0 ]] || die "usage: skill-checks.sh drift"
    root="$(skills_root)"
    echo "skill-checks.sh: drift check from $root" >&2
    exec python3 -I "$root/maintain-verification-skill/scripts/drift_check.py" "$SKILL_DIR" --repo "$REPO_ROOT"
    ;;
  -h|--help|help) sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
  *) die "usage: skill-checks.sh contract [EVIDENCE_ROOT] | skill-checks.sh drift" ;;
esac

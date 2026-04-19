#!/usr/bin/env bash
# Auto-push current branch after /plan-review consensus.
# Usage: bash .claude/lib/auto_push_on_consensus.sh
# All exit paths return 0 — push failure never overturns the consensus verdict.
# User-facing messages go to stderr.

set -uo pipefail

BRANCH=$(git branch --show-current 2>/dev/null || echo "")

# Refuse on main/master
if [[ "$BRANCH" == "main" || "$BRANCH" == "master" ]]; then
  echo "⚠️  Auto-push skipped: refusing to push main/master." >&2
  exit 0
fi

# Refuse if no branch detected
if [[ -z "$BRANCH" ]]; then
  echo "⚠️  Auto-push skipped: detached HEAD or no branch." >&2
  exit 0
fi

# Respect WORKFLOW_BYPASS — if user opted in, they've decided to skip the push safeguard
if [[ "${WORKFLOW_BYPASS:-}" == "true" ]]; then
  echo "⚠️  Auto-push skipped: WORKFLOW_BYPASS=true." >&2
  exit 0
fi

# Dirty tracked-file worktree check (allow untracked files)
if [[ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]]; then
  echo "⚠️  Auto-push skipped: uncommitted tracked-file changes detected. Commit your edits, then re-run /plan-review or push manually." >&2
  exit 0
fi

# Stale-HEAD guard: if EXPECTED_HEAD is set, confirm HEAD hasn't changed since consensus
if [[ -n "${EXPECTED_HEAD:-}" ]]; then
  CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
  if [[ "$CURRENT_HEAD" != "$EXPECTED_HEAD" ]]; then
    echo "⚠️  Auto-push skipped: HEAD changed since consensus (expected $EXPECTED_HEAD, got $CURRENT_HEAD). Push manually if the new commit is intentional." >&2
    exit 0
  fi
fi

# Attempt the push
echo "Pushing $BRANCH to origin..." >&2
PUSH_OUTPUT=$(git push -u origin HEAD 2>&1) || {
  PUSH_EXIT=$?

  # Check if blocked by a test-gate hook (look for common hook signatures)
  if echo "$PUSH_OUTPUT" | grep -qiE "tests.*passed|gate.*file|block.*push"; then
    echo "⚠️  Auto-push blocked by test-gate hook. This is expected on feat/ branches before /finalize. Re-run /plan-review after /finalize, or set WORKFLOW_BYPASS=true for this session." >&2
  else
    echo "⚠️  Auto-push failed (exit $PUSH_EXIT): $PUSH_OUTPUT" >&2
  fi
  exit 0
}

echo "✅ Pushed $BRANCH to origin." >&2
exit 0

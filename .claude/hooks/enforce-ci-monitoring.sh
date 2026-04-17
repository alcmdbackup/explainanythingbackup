#!/bin/bash
# Stop hook: blocks Claude from stopping while a PR targeting main/production has failing CI.
# Fail-open: if gh is missing, API errors, or timeout — allows stop. Push gate is the backstop.

set -euo pipefail

# Quick exit: bypass branches
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$BRANCH" =~ ^(hotfix|fix|docs|chore)/ ]]; then exit 0; fi

# Quick exit: gh not available
if ! command -v gh &>/dev/null; then exit 0; fi

# Quick exit: no PR for current branch
PR_JSON=$(gh pr view --json number,baseRefName,statusCheckRollup 2>/dev/null || echo "")
if [[ -z "$PR_JSON" || "$PR_JSON" == "" ]]; then exit 0; fi

BASE=$(echo "$PR_JSON" | jq -r '.baseRefName // ""' 2>/dev/null || echo "")
PR_NUM=$(echo "$PR_JSON" | jq -r '.number // ""' 2>/dev/null || echo "")

# Only gate PRs targeting main or production
if [[ "$BASE" != "main" && "$BASE" != "production" ]]; then exit 0; fi

# Check CI status via statusCheckRollup (gh pr checks does not support --json)
PENDING=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.status != "COMPLETED")] | length' 2>/dev/null || echo "0")
FAILED=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.conclusion == "FAILURE")] | length' 2>/dev/null || echo "0")

if [[ "$PENDING" -gt 0 || "$FAILED" -gt 0 ]]; then
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "PR #${PR_NUM} targeting ${BASE} has ${FAILED} failed and ${PENDING} pending CI checks. Continue monitoring and fixing until all checks pass."
  }
}
EOF
  exit 0
fi

# All checks passed — allow stop
exit 0

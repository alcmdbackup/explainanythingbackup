#!/bin/bash
# Stop hook: observes CI state for the current branch's PR and writes the
# observation to .claude/ci-gate.json. Sibling of enforce-ci-monitoring.sh,
# but with different responsibilities:
#   - enforce-ci-monitoring.sh blocks stop while CI is failing/pending.
#   - this hook writes state so block-pr-create-without-gate.sh can decide
#     whether to allow the next gh pr create.
#
# Critical difference from enforce-ci-monitoring.sh: we do NOT bypass on
# `fix/`, `docs/`, `chore/`. The whole point of Phase 2 is to gate those
# branches on the reactive path — the asymmetry is intentional.
#
# Always exits 0 (this hook never blocks stop). All errors are non-fatal.

set -u

# Honor kill switch
if [[ -f ".claude/ci-gate.disabled" ]]; then
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ -z "$BRANCH" ]]; then exit 0; fi

# Only hotfix bypasses (NOT fix|docs|chore — closes the iteration-2 loophole)
if [[ "$BRANCH" =~ ^hotfix/ ]]; then exit 0; fi

# Skip on main/master (no PR for these)
if [[ "$BRANCH" = "main" || "$BRANCH" = "master" || "$BRANCH" = "production" ]]; then
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then exit 0; fi

PR_JSON=$(gh pr view --json number,statusCheckRollup 2>/dev/null || echo "")
if [[ -z "$PR_JSON" || "$PR_JSON" = "" ]]; then
  # No PR yet — nothing to observe. Don't clobber any existing state.
  exit 0
fi

CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

PENDING=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.status != "COMPLETED")] | length' 2>/dev/null || echo "0")
FAILED=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]? | select(.conclusion == "FAILURE")] | length' 2>/dev/null || echo "0")
TOTAL=$(echo "$PR_JSON" | jq '[.statusCheckRollup[]?] | length' 2>/dev/null || echo "0")

# Decide new status
NEW_STATUS=""
if [[ "$FAILED" -gt 0 ]]; then
  NEW_STATUS="closed"
elif [[ "$PENDING" -gt 0 ]]; then
  # Pending: preserve existing state, only refresh timestamp.
  NEW_STATUS=""  # signal: preserve
elif [[ "$TOTAL" -gt 0 ]]; then
  # All complete and no failures = open
  NEW_STATUS="open"
else
  # No checks observed at all (workflow may not have triggered yet) — preserve.
  NEW_STATUS=""
fi

PREV_STATUS=""
PREV_FAILURE_COMMIT=""
if [[ -f ".claude/ci-gate.json" ]]; then
  PREV_STATUS=$(jq -r '.status // ""' ".claude/ci-gate.json" 2>/dev/null || echo "")
  PREV_FAILURE_COMMIT=$(jq -r '.last_failure_commit // ""' ".claude/ci-gate.json" 2>/dev/null || echo "")
  PREV_BRANCH=$(jq -r '.branch // ""' ".claude/ci-gate.json" 2>/dev/null || echo "")
  # If the file is for a different branch, treat as no prior state for THIS branch
  if [[ "$PREV_BRANCH" != "$BRANCH" ]]; then
    PREV_STATUS=""
    PREV_FAILURE_COMMIT=""
  fi
fi

# Resolve status to write
if [[ -z "$NEW_STATUS" ]]; then
  # Preserve: use prior status if it was for this branch, else "unknown"
  WRITE_STATUS="${PREV_STATUS:-unknown}"
else
  WRITE_STATUS="$NEW_STATUS"
fi

# last_failure_commit: keep prior failure SHA unless we just saw success
WRITE_FAILURE_COMMIT="$PREV_FAILURE_COMMIT"
if [[ "$NEW_STATUS" = "closed" ]]; then
  WRITE_FAILURE_COMMIT="$CURRENT_HEAD"
elif [[ "$NEW_STATUS" = "open" ]]; then
  WRITE_FAILURE_COMMIT=""
fi

# Atomic write
TMP_FILE=".claude/ci-gate.json.tmp"
cleanup() { rm -f "$TMP_FILE" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

jq -n \
  --arg branch "$BRANCH" \
  --arg status "$WRITE_STATUS" \
  --arg observed_at "$NOW" \
  --arg observed_sha "$CURRENT_HEAD" \
  --arg failure_commit "$WRITE_FAILURE_COMMIT" \
  '{
    branch: $branch,
    status: $status,
    last_observed_at: $observed_at,
    last_observed_sha: $observed_sha,
    last_failure_commit: $failure_commit,
    last_observation_source: "stop_hook",
    schema_version: 1
  }' > "$TMP_FILE" 2>/dev/null || {
    echo "update-ci-gate: failed to write tmp file" >&2
    exit 0
  }

mv "$TMP_FILE" ".claude/ci-gate.json" 2>/dev/null || {
  echo "update-ci-gate: failed to atomically install ci-gate.json" >&2
  exit 0
}

exit 0

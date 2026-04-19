#!/bin/bash
# Blocks git push to main/production unless /finalize or /mainToProd wrote a valid gate file.
# The gate file (.claude/push-gate.json) contains the HEAD SHA at the time checks passed.
# If code changes after checks (new commit), the gate becomes stale and push is blocked.

COMMAND="$TOOL_INPUT"

# Only intercept git push commands
if [[ "$COMMAND" != *"git push"* ]]; then
  exit 0
fi

# ─── Exceptions (bypass the gate) ─────────────────────────────────

# Tags-only push
if [[ "$COMMAND" == *"--tags"* ]]; then
  exit 0
fi

# Backup mirror push
if [[ "$COMMAND" =~ git\ push\ backup ]]; then
  exit 0
fi

# Bypass branches (hotfix, fix, docs, chore)
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$BRANCH" =~ ^(hotfix|fix|docs|chore)/ ]]; then
  exit 0
fi

# ─── Determine push target branch ────────────────────────────────

TARGET_BRANCH=""

# Parse explicit refspec: git push <remote> <refspec>
PUSH_ARGS="${COMMAND#*git push}"
# Strip flags (-u, -f, --force, --force-with-lease, --set-upstream, etc.)
CLEAN_ARGS=$(echo "$PUSH_ARGS" | sed -E 's/\s+-(u|f)\b//g; s/\s+--[a-z-]+//g; s/^\s+//; s/\s+$//')

# Extract remote and refspec
REMOTE=$(echo "$CLEAN_ARGS" | awk '{print $1}')
REFSPEC=$(echo "$CLEAN_ARGS" | awk '{print $2}')

if [[ -n "$REFSPEC" ]]; then
  # Handle colon syntax: HEAD:main, HEAD:refs/heads/main
  if [[ "$REFSPEC" == *":"* ]]; then
    TARGET_BRANCH="${REFSPEC##*:}"
    TARGET_BRANCH="${TARGET_BRANCH#refs/heads/}"
  else
    TARGET_BRANCH="$REFSPEC"
    if [[ "$TARGET_BRANCH" == "HEAD" ]]; then
      TARGET_BRANCH="$BRANCH"
    fi
  fi
elif [[ -n "$REMOTE" ]]; then
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null || echo "")
  if [[ -n "$UPSTREAM" ]]; then
    TARGET_BRANCH="${UPSTREAM#*/}"
  else
    TARGET_BRANCH="$BRANCH"
  fi
else
  UPSTREAM=$(git rev-parse --abbrev-ref --symbolic-full-name "@{upstream}" 2>/dev/null || echo "")
  if [[ -n "$UPSTREAM" ]]; then
    TARGET_BRANCH="${UPSTREAM#*/}"
  else
    TARGET_BRANCH="$BRANCH"
  fi
fi

# Only gate pushes to main or production
if [[ "$TARGET_BRANCH" != "main" && "$TARGET_BRANCH" != "production" ]]; then
  exit 0
fi

# ─── Gate check ───────────────────────────────────────────────────

GATE_FILE=".claude/push-gate.json"

if [[ ! -f "$GATE_FILE" ]]; then
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Push to main/production blocked: no gate file found. Run /finalize or /mainToProd first — they write .claude/push-gate.json after all checks pass."
  }
}
EOF
  exit 0
fi

# Read gate commit SHA
GATE_COMMIT=$(jq -r '.commit // ""' "$GATE_FILE" 2>/dev/null || echo "")
CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

if [[ -z "$GATE_COMMIT" || "$GATE_COMMIT" != "$CURRENT_HEAD" ]]; then
  cat << EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Push to main/production blocked: code changed since /finalize ran (gate commit: ${GATE_COMMIT:0:12}, HEAD: ${CURRENT_HEAD:0:12}). Re-run /finalize or /mainToProd."
  }
}
EOF
  exit 0
fi

# Gate valid — allow push
exit 0

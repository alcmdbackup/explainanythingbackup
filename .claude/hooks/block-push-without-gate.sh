#!/bin/bash
# Blocks git push under two conditions:
#   1. Pushes to main/production unless /finalize or /mainToProd wrote a valid
#      .claude/push-gate.json matching HEAD. Bypasses: hotfix|fix|docs|chore.
#   2. Pushes to feature branches when .claude/ci-gate.json shows status=closed
#      for the current branch — meaning the Stop hook observed a CI failure
#      and the user hasn't yet run `npm run test:gate` for the current HEAD.
#      For this second case, only `hotfix/` bypasses (asymmetric vs case 1,
#      intentionally — the whole point of Phase 2 is to gate fix/docs/chore).
#
# Always exit 0; deny decision is via JSON output.

COMMAND="$TOOL_INPUT"

# Only intercept git push commands
if [[ "$COMMAND" != *"git push"* ]]; then
  exit 0
fi

# Tags-only push: allow
if [[ "$COMMAND" == *"--tags"* ]]; then
  exit 0
fi

# Backup mirror push: allow
if [[ "$COMMAND" =~ git\ push\ backup ]]; then
  exit 0
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# ─── Determine push target branch ────────────────────────────────

TARGET_BRANCH=""
PUSH_ARGS="${COMMAND#*git push}"
CLEAN_ARGS=$(echo "$PUSH_ARGS" | sed -E 's/\s+-(u|f)\b//g; s/\s+--[a-z-]+//g; s/^\s+//; s/\s+$//')
REMOTE=$(echo "$CLEAN_ARGS" | awk '{print $1}')
REFSPEC=$(echo "$CLEAN_ARGS" | awk '{print $2}')

if [[ -n "$REFSPEC" ]]; then
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

CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")

# ─── Path 1: pushes to main/production (existing behavior) ─────────

if [[ "$TARGET_BRANCH" = "main" || "$TARGET_BRANCH" = "production" ]]; then
  # Bypass branches for the main/prod gate (existing)
  if [[ "$BRANCH" =~ ^(hotfix|fix|docs|chore)/ ]]; then
    exit 0
  fi

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

  GATE_COMMIT=$(jq -r '.commit // ""' "$GATE_FILE" 2>/dev/null || echo "")

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

  exit 0  # gate valid, allow main/prod push
fi

# ─── Path 2: feature-branch pushes (NEW: Phase 2 reactive check) ───
# Only hotfix bypasses this path. fix/docs/chore are gated — closing the
# loophole noted in iteration-2 plan review.

if [[ "$BRANCH" =~ ^hotfix/ ]]; then
  exit 0
fi

# Reactive-layer kill switch
if [[ -f ".claude/ci-gate.disabled" ]]; then
  exit 0
fi

CI_GATE_FILE=".claude/ci-gate.json"
if [[ ! -f "$CI_GATE_FILE" ]]; then
  # No state observed yet → allow (fail open)
  exit 0
fi

SCHEMA_VERSION=$(jq -r '.schema_version // 0' "$CI_GATE_FILE" 2>/dev/null) || SCHEMA_VERSION=0
if [[ "$SCHEMA_VERSION" != "1" ]]; then
  echo "ci-gate.json schema_version=$SCHEMA_VERSION not understood — allowing push" >&2
  exit 0
fi

CI_BRANCH=$(jq -r '.branch // ""' "$CI_GATE_FILE" 2>/dev/null) || CI_BRANCH=""
CI_STATUS=$(jq -r '.status // ""' "$CI_GATE_FILE" 2>/dev/null) || CI_STATUS=""

# State for a different branch → no enforcement for this branch
if [[ "$CI_BRANCH" != "$BRANCH" ]]; then
  exit 0
fi

# Not CLOSED → allow
if [[ "$CI_STATUS" != "closed" ]]; then
  exit 0
fi

# CLOSED: require valid test-pass.json or override

if [[ -f ".claude/test-pass.json" ]]; then
  TP_COMMIT=$(jq -r '.commit // ""' ".claude/test-pass.json" 2>/dev/null) || TP_COMMIT=""
  TP_SCHEMA=$(jq -r '.schema_version // 0' ".claude/test-pass.json" 2>/dev/null) || TP_SCHEMA=0
  if [[ "$TP_SCHEMA" = "1" && -n "$TP_COMMIT" && "$TP_COMMIT" = "$CURRENT_HEAD" ]]; then
    TP_TESTS=$(jq -r '.tests // [] | length' ".claude/test-pass.json" 2>/dev/null) || TP_TESTS=0
    if [[ "$TP_TESTS" -ge 6 ]]; then
      exit 0
    fi
  fi
fi

if [[ -f ".claude/ci-gate-override.json" ]]; then
  OB=$(jq -r '.branch // ""' ".claude/ci-gate-override.json" 2>/dev/null) || OB=""
  OC=$(jq -r '.commit // ""' ".claude/ci-gate-override.json" 2>/dev/null) || OC=""
  OR=$(jq -r '.reason // ""' ".claude/ci-gate-override.json" 2>/dev/null) || OR=""
  OS=$(jq -r '.schema_version // 0' ".claude/ci-gate-override.json" 2>/dev/null) || OS=0
  if [[ "$OB" = "$BRANCH" && "$OC" = "$CURRENT_HEAD" && -n "$OR" && "$OS" = "1" ]]; then
    exit 0
  fi
fi

cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Feature-branch push blocked: this branch has a known CI failure. Run `npm run test:gate` to verify tests pass locally for HEAD, or run /approve-pr to consciously ship despite the failure (reason will be in git log)."
  }
}
EOF
exit 0

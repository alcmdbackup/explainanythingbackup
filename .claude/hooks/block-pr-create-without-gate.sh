#!/bin/bash
# Blocks PR-creating commands (gh pr create, gh pr ready, gh api POST /pulls,
# gh api graphql createPullRequest) unless a valid gate file is present.
#
# Two enforcement paths:
#   High-blast (migration-touching OR --base production): fail CLOSED on parse
#     error; requires .claude/push-gate.json matching HEAD, or a matching override.
#   Reactive (normal feature -> main): fail OPEN on parse error; only enforces
#     when .claude/ci-gate.json says branch is CLOSED, requires test-pass.json
#     matching HEAD or a matching override.
#
# Bypasses:
#   - hotfix/* branches (emergency carve-out)
#   - DISABLE_PR_GATE=true env var (kill switch; emits stderr audit line)
#   - .claude/ci-gate.disabled file (reactive layer kill switch)
#   - .claude/ci-gate-override.json matching branch+HEAD (via /approve-pr)
#
# Input contract: reads stdin JSON {tool_input: {command: "..."}, ...} per the
# project test-harness convention (see scripts/test-bypass-safety-hooks.sh).

input=$(cat)
COMMAND=$(echo "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || COMMAND=""

if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Strip leading env var assignments + whitespace so `DISABLE_PR_GATE=true gh pr create`
# and bare `gh pr create` look the same after normalization.
CLEAN=$(echo "$COMMAND" | sed -E 's/^[[:space:]]*([A-Z_][A-Z_0-9]*=[^[:space:]]+[[:space:]]+)*//')

# ─── Matcher: is this a PR-creating command? ─────────────────────────
# Anchor to the START of the command (after env-var strip) so we only match
# when `gh pr create` is the actual command being executed. This prevents
# false positives when `gh pr create` appears as text inside another command:
# - git commit -m "feat: gh pr create something" (commit message body)
# - gh pr comment --body "remember gh pr create"  (PR comment text)
# - git log | grep 'gh pr create'                (grep argument)
# - echo "gh pr create"                          (echo argument)
# These all run a non-gh-pr-create top-level command, so they're allowed.
#
# Wrappers (`bash -c "gh pr create ..."`) are checked separately against the
# ORIGINAL command (since the inner gh command sits after `bash -c`, not at
# position 0).

IS_PR_CREATE=0
if [[ "$CLEAN" =~ ^gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$) ]]; then
  IS_PR_CREATE=1
elif [[ "$CLEAN" =~ ^gh[[:space:]]+pr[[:space:]]+ready([[:space:]]|$) ]] && \
     [[ ! "$CLEAN" =~ --undo ]]; then
  IS_PR_CREATE=1
elif [[ "$CLEAN" =~ ^gh[[:space:]]+api ]] && \
     [[ "$CLEAN" =~ -X[[:space:]]+POST ]] && \
     [[ "$CLEAN" =~ /pulls(/|[[:space:]]|$) ]]; then
  IS_PR_CREATE=1
elif [[ "$CLEAN" =~ ^gh[[:space:]]+api[[:space:]]+graphql ]] && \
     [[ "$COMMAND" =~ createPullRequest ]]; then
  IS_PR_CREATE=1
fi

# Wrappers: bash/sh -c with PR-creating command inside the quoted payload.
# The `-c` flag MUST be followed by a quote char for a real wrapper invocation
# (`bash -c "cmd"` or `bash -c 'cmd'`), so we anchor on that. Prevents false
# positives where "bash -c" appears as text in a commit message or docstring.
if [[ "$COMMAND" =~ (^|[[:space:]])(bash|sh)[[:space:]]+-c[[:space:]]+[\'\"] ]]; then
  if [[ "$COMMAND" =~ gh[[:space:]]+pr[[:space:]]+create ]]; then
    IS_PR_CREATE=1
  elif [[ "$COMMAND" =~ gh[[:space:]]+api ]] && \
       [[ "$COMMAND" =~ -X[[:space:]]+POST ]] && \
       [[ "$COMMAND" =~ /pulls(/|[[:space:]]|$) ]]; then
    IS_PR_CREATE=1
  fi
fi

if [[ $IS_PR_CREATE -eq 0 ]]; then
  exit 0
fi

# ─── Bypasses ─────────────────────────────────────────────────────

# Emergency kill switch — honors both `export DISABLE_PR_GATE=true` and
# inline `DISABLE_PR_GATE=true gh pr create ...` forms.
if [[ "${DISABLE_PR_GATE:-}" = "true" ]] || [[ "$COMMAND" =~ DISABLE_PR_GATE=true ]]; then
  echo "PR gate bypassed via DISABLE_PR_GATE" >&2
  exit 0
fi

# Hotfix carve-out
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$BRANCH" =~ ^hotfix/ ]]; then
  exit 0
fi

# ─── High-blast detection ──────────────────────────────────────────

# Best-effort fetch so the migration diff is accurate. Non-fatal.
git fetch origin main --quiet --depth=50 2>/dev/null || true

HIGH_BLAST=0
if git diff origin/main..HEAD --name-only -- 'supabase/migrations/**' 2>/dev/null | grep -q .; then
  HIGH_BLAST=1
elif [[ "$COMMAND" =~ --base[[:space:]=\"\']+production ]]; then
  HIGH_BLAST=1
fi

CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
OVERRIDE_FILE=".claude/ci-gate-override.json"

# Check override (used by both paths)
check_override() {
  if [[ ! -f "$OVERRIDE_FILE" ]]; then return 1; fi
  local ob oc orr
  ob=$(jq -r '.branch // ""' "$OVERRIDE_FILE" 2>/dev/null) || return 1
  oc=$(jq -r '.commit // ""' "$OVERRIDE_FILE" 2>/dev/null) || return 1
  orr=$(jq -r '.reason // ""' "$OVERRIDE_FILE" 2>/dev/null) || return 1
  if [[ -z "$ob" || -z "$oc" || -z "$orr" ]]; then return 1; fi
  if [[ "$ob" != "$BRANCH" || "$oc" != "$CURRENT_HEAD" ]]; then return 1; fi
  local sv
  sv=$(jq -r '.schema_version // 0' "$OVERRIDE_FILE" 2>/dev/null) || sv=0
  if [[ "$sv" != "1" ]]; then return 1; fi
  local at_iso at_epoch now_epoch
  at_iso=$(jq -r '.approved_at // ""' "$OVERRIDE_FILE" 2>/dev/null) || at_iso=""
  if [[ -n "$at_iso" ]]; then
    at_epoch=$(date -d "$at_iso" +%s 2>/dev/null || echo "0")
    now_epoch=$(date -u +%s)
    if [[ "$at_epoch" -gt "$now_epoch" ]]; then return 1; fi
  fi
  return 0
}

# ─── High-blast path: fail CLOSED ───────────────────────────────────

if [[ $HIGH_BLAST -eq 1 ]]; then
  if [[ -f ".claude/push-gate.json" ]]; then
    GATE_COMMIT=$(jq -r '.commit // ""' ".claude/push-gate.json" 2>/dev/null) || GATE_COMMIT=""
    if [[ -n "$GATE_COMMIT" && "$GATE_COMMIT" = "$CURRENT_HEAD" ]]; then
      exit 0
    fi
  fi
  if check_override; then
    exit 0
  fi
  cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "PR creation blocked: this PR touches migrations or targets production, which require local verification. Run /finalize first (it validates migrations against an ephemeral Docker postgres and runs the full check suite), or run /approve-pr if you're consciously skipping verification."
  }
}
EOF
  exit 0
fi

# ─── Reactive path: fail OPEN ───────────────────────────────────────

if [[ -f ".claude/ci-gate.disabled" ]]; then
  exit 0
fi

CI_GATE_FILE=".claude/ci-gate.json"
if [[ ! -f "$CI_GATE_FILE" ]]; then
  exit 0
fi

SCHEMA_VERSION=$(jq -r '.schema_version // 0' "$CI_GATE_FILE" 2>/dev/null) || SCHEMA_VERSION=0
if [[ "$SCHEMA_VERSION" != "1" ]]; then
  echo "ci-gate.json schema_version=$SCHEMA_VERSION not understood by this hook — allowing PR create" >&2
  exit 0
fi

CI_BRANCH=$(jq -r '.branch // ""' "$CI_GATE_FILE" 2>/dev/null) || CI_BRANCH=""
CI_STATUS=$(jq -r '.status // ""' "$CI_GATE_FILE" 2>/dev/null) || CI_STATUS=""

if [[ "$CI_BRANCH" != "$BRANCH" ]]; then
  exit 0
fi

# Inline refresh: if status is CLOSED and last_observed_at is >10 min old,
# try `gh pr view` with a 5s timeout to auto-recover from stale state mid-
# session (user fixed CI on the side). Per plan, fail OPEN on any refresh
# failure (gh missing or times out) — the reactive path is non-critical and
# CI itself is the backstop. An empty PR view response (no PR for this
# branch yet) is also treated as fail-open since we have nothing to refresh
# against.
if [[ "$CI_STATUS" = "closed" ]]; then
  LAST_OBSERVED=$(jq -r '.last_observed_at // ""' "$CI_GATE_FILE" 2>/dev/null) || LAST_OBSERVED=""
  if [[ -n "$LAST_OBSERVED" ]]; then
    LAST_EPOCH=$(date -d "$LAST_OBSERVED" +%s 2>/dev/null || echo "0")
    NOW_EPOCH=$(date -u +%s)
    if (( NOW_EPOCH - LAST_EPOCH > 600 )); then
      if command -v gh >/dev/null 2>&1; then
        REFRESH_JSON=$(timeout 5 gh pr view --json statusCheckRollup 2>/dev/null || echo "")
        if [[ -n "$REFRESH_JSON" ]]; then
          RF=$(echo "$REFRESH_JSON" | jq '[.statusCheckRollup[]? | select(.conclusion == "FAILURE")] | length' 2>/dev/null || echo "0")
          RP=$(echo "$REFRESH_JSON" | jq '[.statusCheckRollup[]? | select(.status != "COMPLETED")] | length' 2>/dev/null || echo "0")
          RT=$(echo "$REFRESH_JSON" | jq '[.statusCheckRollup[]?] | length' 2>/dev/null || echo "0")
          if [[ "$RF" = "0" && "$RP" = "0" && "$RT" -gt 0 ]]; then
            CI_STATUS="open"
          fi
        else
          echo "ci-gate.json >10min stale; gh refresh failed — fail open" >&2
          CI_STATUS="open"
        fi
      else
        echo "ci-gate.json >10min stale; gh unavailable — fail open" >&2
        CI_STATUS="open"
      fi
    fi
  fi
fi

if [[ "$CI_STATUS" != "closed" ]]; then
  exit 0
fi

# CLOSED: require test-pass.json matching HEAD, or override
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

if check_override; then
  exit 0
fi

cat << 'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "PR creation blocked: this branch has a known CI failure. Run `npm run test:gate` to verify tests pass locally for the current HEAD, run /finalize to fix-and-verify, or run /approve-pr to consciously ship despite the known failure (reason will be recorded in git log)."
  }
}
EOF
exit 0

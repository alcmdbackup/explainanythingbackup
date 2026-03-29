#!/usr/bin/env bash
# Orchestrates weekly maintenance skill runs via claude -p in tmux sessions S10-S15.
# Each skill runs in its own pre-existing worktree (worktree_<N>_10 through _15).
# Creates a full project folder per skill (compatible with /finalize workflow).
# Signals S16 monitor for completion notifications.
# Usage: maintenance-scheduler.sh [--dry-run]
set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PARENT_DIR=$(dirname "$REPO_DIR")
LOG_DIR="$REPO_DIR/logs/maintenance"
DATE=$(date +%Y%m%d)
SCHEDULER_LOG="$LOG_DIR/scheduler-${DATE}.log"
COUNTER_FILE="$REPO_DIR/.worktree_counter"
LOCKFILE="$LOG_DIR/.maintenance.lock"
PREAMBLE_FILE=".claude/skills/maintenance/shared-preamble.md"  # relative to REPO_DIR

# Resolve worktree counter
if [ ! -f "$COUNTER_FILE" ]; then
  echo "FATAL: .worktree_counter not found. Run reset_worktrees first." >&2
  exit 1
fi
COUNTER=$(cat "$COUNTER_FILE")

# Acquire lockfile atomically via flock (prevents reset_worktrees conflicts)
exec 9>"$LOCKFILE"
if ! flock -n 9; then
  echo "FATAL: Another maintenance run is active (lockfile: $LOCKFILE)" >&2
  exit 1
fi
# Lock auto-releases when process exits (no trap needed for cleanup)

# Skill name → session + worktree index + allowedTools mapping
declare -A SKILL_SESSIONS=( [refactor-simplify]=S10 [test-gaps]=S11 [update-docs]=S12
  [ts-coverage]=S13 [bugs-code]=S14 [bugs-ux]=S15 )
declare -A SKILL_WT_INDEX=( [refactor-simplify]=10 [test-gaps]=11 [update-docs]=12
  [ts-coverage]=13 [bugs-code]=14 [bugs-ux]=15 )

# Per-skill tool whitelists
TOOLS_RESEARCH='Read,Write,Glob,Grep,Agent,Bash(git log *),Bash(git diff *),Bash(git blame *),Bash(git add *),Bash(git commit *)'
TOOLS_PLAYWRIGHT="${TOOLS_RESEARCH},mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_fill_form,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_console_messages,mcp__playwright__browser_close"
declare -A SKILL_TOOLS=( [refactor-simplify]="$TOOLS_RESEARCH" [test-gaps]="$TOOLS_RESEARCH"
  [update-docs]="$TOOLS_RESEARCH" [ts-coverage]="$TOOLS_RESEARCH" [bugs-code]="$TOOLS_RESEARCH"
  [bugs-ux]="$TOOLS_PLAYWRIGHT" )
SKILLS=(refactor-simplify test-gaps update-docs ts-coverage bugs-code bugs-ux)

mkdir -p "$LOG_DIR"

log() { echo "$(date -Iseconds) $1" >> "$SCHEDULER_LOG"; }

log "SCHEDULER START (counter=${COUNTER}, date=${DATE})"
echo "Maintenance scheduler starting. Worktree counter: ${COUNTER}"

LAUNCHED=0
for skill in "${SKILLS[@]}"; do
  SESSION="${SKILL_SESSIONS[$skill]}"
  WT_INDEX="${SKILL_WT_INDEX[$skill]}"
  WORKTREE_DIR="${PARENT_DIR}/worktree_${COUNTER}_${WT_INDEX}"
  SKILL_FILE="${WORKTREE_DIR}/.claude/skills/maintenance/${skill}/SKILL.md"
  BRANCH="chore/maint-${skill}-${DATE}"
  PROJECT_NAME="maint_${skill}_${DATE}"
  PROJECT_DIR="docs/planning/${PROJECT_NAME}"
  RESEARCH_FILE="${PROJECT_DIR}/${PROJECT_NAME}_research.md"
  PLANNING_FILE="${PROJECT_DIR}/${PROJECT_NAME}_planning.md"
  PROGRESS_FILE="${PROJECT_DIR}/${PROJECT_NAME}_progress.md"
  LOG_FILE="$LOG_DIR/${skill}-${DATE}.log"
  STATUS_FILE="$LOG_DIR/${skill}-${DATE}.status"

  # Validate worktree exists
  if [ ! -d "$WORKTREE_DIR" ]; then
    log "WARN: Worktree not found: $WORKTREE_DIR — run reset_worktrees"
    continue
  fi

  if [ ! -f "$SKILL_FILE" ]; then
    log "WARN: Skill file not found: $SKILL_FILE"
    continue
  fi

  # Skip if branch already exists in this worktree (already ran this week)
  if git -C "$WORKTREE_DIR" rev-parse --verify "$BRANCH" &>/dev/null; then
    log "SKIP: Branch $BRANCH already exists"
    continue
  fi

  # --- Auto-initialize inside worktree ---
  cd "$WORKTREE_DIR"
  git fetch origin main
  git checkout -B "$BRANCH" origin/main

  mkdir -p "$PROJECT_DIR"

  # _status.json (built with jq to avoid injection)
  jq -n \
    --arg branch "$BRANCH" \
    --arg created "$(date -Iseconds)" \
    --arg skill "$skill" \
    --arg session "$SESSION" \
    --arg worktree "worktree_${COUNTER}_${WT_INDEX}" \
    '{branch:$branch, created_at:$created, prerequisites:{}, relevantDocs:[], type:"maintenance", skill:$skill, session:$session, worktree:$worktree}' \
    > "$PROJECT_DIR/_status.json"

  # _research.md (Claude populates this)
  cat > "$RESEARCH_FILE" <<RESEARCHEOF
# Maintenance: ${skill} (${DATE})

## Problem Statement
Automated maintenance check for: ${skill}

## High Level Summary
[To be populated by Claude]

## Findings
[To be populated by Claude]

## Recommendations
[To be populated by Claude]

## Files Examined
[To be populated by Claude]

## Agent Research Log
[To be populated by Claude]
RESEARCHEOF

  # _planning.md (user fleshes out after review)
  cat > "$PLANNING_FILE" <<PLANEOF
# Maintenance: ${skill} — Remediation Plan

## Background
Auto-generated from maintenance findings on ${DATE}.
See \`${PROJECT_NAME}_research.md\` for the full report.
Worktree: worktree_${COUNTER}_${WT_INDEX}

## Requirements
[Copy high-priority findings from research doc here]

## Problem
[Summarize the key issues found]

## Phased Execution Plan

### Phase 1: Quick Wins
- [ ] [Items that can be fixed immediately]

### Phase 2: Deeper Fixes
- [ ] [Items requiring more investigation or refactoring]

## Testing
- [ ] [Tests to add or update based on findings]

## Verification
- [ ] [How to verify the fixes are correct]
PLANEOF

  # _progress.md
  cat > "$PROGRESS_FILE" <<PROGRESSEOF
# Maintenance: ${skill} — Progress

## Research Phase (automated)
### Completed: ${DATE}
- Skill ran via scheduler (session ${SESSION}, worktree worktree_${COUNTER}_${WT_INDEX})
- Branch: ${BRANCH}
- Report: ${PROJECT_NAME}_research.md

## Remediation Phase (manual)
### Work Done
[To be filled by user]

### Issues Encountered
[To be filled by user]
PROGRESSEOF

  git add -- "$PROJECT_DIR"
  git commit -m "chore: auto-initialize ${PROJECT_NAME}"

  # --- Concatenate preamble + skill SKILL.md into temp file ---
  PROMPT_FILE=$(mktemp /tmp/maint-prompt-${skill}-XXXXXX.md)
  cat "$REPO_DIR/$PREAMBLE_FILE" "$WORKTREE_DIR/.claude/skills/maintenance/${skill}/SKILL.md" > "$PROMPT_FILE"

  # --- Clear status file and launch ---
  echo "running" > "$STATUS_FILE"
  tmux kill-session -t "$SESSION" 2>/dev/null || true

  ALLOWED_TOOLS="${SKILL_TOOLS[$skill]}"

  if [ "$DRY_RUN" = true ]; then
    log "DRY-RUN: Would launch ${SESSION} in ${WORKTREE_DIR} with tools: ${ALLOWED_TOOLS}"
    echo "success" > "$STATUS_FILE"
    rm -f "$PROMPT_FILE"
  else
    # Create wrapper script with env vars baked in (avoids quoting issues entirely)
    WRAPPER=$(mktemp /tmp/maint-run-${skill}-XXXXXX.sh)
    chmod 700 "$WRAPPER"  # restrict permissions
    cat > "$WRAPPER" <<WRAPPEREOF
#!/usr/bin/env bash
set -euo pipefail
# Source credentials (same file watcher uses)
[ -f /etc/maintenance-scheduler.env ] && set -a && source /etc/maintenance-scheduler.env && set +a

claude -p \\
  --append-system-prompt-file "${PROMPT_FILE}" \\
  --allowedTools "${ALLOWED_TOOLS}" \\
  --max-turns 150 \\
  --max-budget-usd 5.00 \\
  --output-format text \\
  "Run maintenance skill: ${skill}.
You are on branch: ${BRANCH} in worktree: ${WORKTREE_DIR}
Write your full findings report to: ${RESEARCH_FILE}
When done, commit the updated report:
  git add ${PROJECT_DIR} && git commit -m 'chore: maint ${skill} report ${DATE}'" \\
  2>&1 | tee "${LOG_FILE}"

EXIT_CODE=\${PIPESTATUS[0]}
if [ "\$EXIT_CODE" -eq 0 ]; then
  echo "success" > "${STATUS_FILE}"
else
  echo "failure" > "${STATUS_FILE}"
fi
rm -f "${PROMPT_FILE}"
echo ""
echo "=== MAINTENANCE COMPLETE: ${skill} (exit: \${EXIT_CODE}) ==="
echo "Report: ${WORKTREE_DIR}/${RESEARCH_FILE}"
echo "Branch: ${BRANCH}"
echo "To continue: cd ${WORKTREE_DIR} && claude"
echo "To finalize: cd ${WORKTREE_DIR} && claude /finalize"
WRAPPEREOF

    # Launch in tmux — wrapper sources its own credentials, no env passthrough needed
    tmux new-session -d -s "$SESSION" -c "$WORKTREE_DIR" \
      "bash ${WRAPPER}; rm -f ${WRAPPER}; exec bash"
  fi

  log "STARTED: ${SESSION} skill=${skill} branch=${BRANCH} worktree=worktree_${COUNTER}_${WT_INDEX}"
  LAUNCHED=$((LAUNCHED + 1))
  sleep 10  # stagger launches to avoid API burst
done

log "ALL LAUNCHED: ${LAUNCHED} skills in S10-S15"

# --- Signal S16 monitor (or start it if not running) ---
TRIGGER_FILE="$LOG_DIR/.maintenance-trigger"
if tmux has-session -t S16 2>/dev/null; then
  echo "$DATE" > "$TRIGGER_FILE"
  log "WATCHER: S16 signaled via trigger file"
else
  tmux new-session -d -s S16 -c "$REPO_DIR" \
    "bash deploy/maintenance-watcher.sh '${DATE}' '${LOG_DIR}' '${REPO_DIR}'"
  log "WATCHER: S16 launched fresh"
fi

echo ""
echo "Maintenance skills launched (${LAUNCHED}/6):"
echo "  tmux attach -t S10  # refactor-simplify (worktree_${COUNTER}_10)"
echo "  tmux attach -t S11  # test-gaps         (worktree_${COUNTER}_11)"
echo "  tmux attach -t S12  # update-docs       (worktree_${COUNTER}_12)"
echo "  tmux attach -t S13  # ts-coverage       (worktree_${COUNTER}_13)"
echo "  tmux attach -t S14  # bugs-code         (worktree_${COUNTER}_14)"
echo "  tmux attach -t S15  # bugs-ux           (worktree_${COUNTER}_15)"
echo "  tmux attach -t S16  # monitor"
echo ""
echo "Log: $SCHEDULER_LOG"

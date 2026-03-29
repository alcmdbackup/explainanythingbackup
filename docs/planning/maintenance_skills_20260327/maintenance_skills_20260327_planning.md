# Maintenance Skills Plan

## Background
We want to have skills that run processes periodically to help maintain the health of the project. Each skill should initialize itself fully and proceed through running 4 rounds of research with 4 agents each, before returning research findings for user feedback. These should run automatically in worktrees using tmux where possible.

## Requirements (from GH Issue #TBD)
- Overall instructions
    - Each of these should initialize itself fully and proceed through running 4 rounds of research with 4 agents each, before returning research findings for user feedback.
    - Prefer to do this automatically in a worktree using TMUX if possible, and alert user that these are being run
- Add a maintenance doc covering maintenance
- Specific skills
    - Refactor and simplify
        - Look at how to re-architect and simplify evolution codebase to make it easier to understand and maintain. Delete and confirmed dead code.
    - Test gap coverage
        - Look for gaps and issues with unit, integration, and e2e tests for evolution. Assess what runs on pushes to main vs. production
    - Update documentation
        - Look for gaps in documentation across both evolution docs and main docs directories and then make the necessary updates
    - Gaps in TS coverage
        - In evolution codebase, all key functions and DB reads/writes have inputs and outputs typed
    - Bug verification - reading code
        - Read through codebase to find bugs
    - Bugs and UX issue testing via manual verification
        - Use playwright to open evolution admin dashboard in stage and look for bugs as well as UX/usability issues

## Problem
The project lacks automated health monitoring. Code quality, test coverage, documentation accuracy, type safety, and bugs can all silently degrade over time. Currently these are only checked ad-hoc during development. We need a system that periodically audits the codebase across 6 dimensions, runs deep multi-agent research for each, and surfaces findings for human review — all without requiring an active Claude Code session.

## Options Considered
- [ ] **Option A: Desktop Scheduled Tasks**: Durable scheduling via Claude Desktop app. Pro: no scripting. Con: requires Desktop app running, no tmux review.
- [ ] **Option B: Shell Script + Cron + tmux**: Cron triggers shell scripts calling `claude -p`. Pro: flexible. Con: more glue code, no proven pattern.
- [ ] **Option C: Hybrid /maintain Skill**: Single interactive skill orchestrating all checks. Pro: leverages existing skill infra. Con: session-scoped (3-day expiry), requires active session.
- [ ] **Option D: Cloud Scheduled Tasks**: Run on Anthropic cloud. Pro: no machine needed. Con: no local file access (fresh clone each time).
- [x] **Option E: Minicomputer systemd + claude -p (Selected)**: Follow the evolution runner pattern. systemd timer fires weekly, shell script runs each skill via `claude -p` in tmux sessions. User SSH's in to review.

## Phased Execution Plan

### Phase 1: Infrastructure — Scheduler, Watcher, and Shared Skill Framework
- [ ] Create `deploy/maintenance-scheduler.sh` — main orchestrator: auto-initializes project folders, creates branches in worktrees, spawns tmux S10-S15. Supports `--dry-run` flag. Uses per-skill `--allowedTools`. Concatenates shared preamble + skill SKILL.md into temp file for `--append-system-prompt-file`. Acquires lockfile to prevent `reset_worktrees` conflicts.
- [ ] Create `deploy/maintenance-watcher.sh` — persistent S16 monitor. Active: polls status files, sends single summary via all 4 channels. Idle: blocks on `inotifywait` (zero CPU), dashboard only when attached. Preflight check for `inotifywait` availability. Uses `jq` for all JSON construction (Slack, Resend payloads). Reads env vars from `/etc/maintenance-scheduler.env`.
- [ ] Create `deploy/maintenance-scheduler.service` — systemd oneshot. Uses `EnvironmentFile=/etc/maintenance-scheduler.env` (NOT inline `Environment=` for secrets). `WorkingDirectory` set to canonical repo path.
- [ ] Create `deploy/maintenance-scheduler.timer` — systemd timer firing weekly (Sunday 2am)
- [ ] Create `deploy/maintenance-monitor.service` — systemd service for S16 on boot. `Type=simple` with `tmux new-session` (not forking). `EnvironmentFile=/etc/maintenance-scheduler.env`.
- [ ] Create `/etc/maintenance-scheduler.env` template — contains `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `MAINT_NOTIFY_EMAIL`, `MAINT_FROM_EMAIL`, `SLACK_WEBHOOK_URL`. File permissions `chmod 600`, owned by service user. NOT committed to git.
- [ ] Create `.claude/skills/maintenance/shared-preamble.md` — shared instructions (4-round research protocol, output format). Self-contained — no include directives.
- [ ] Create `logs/maintenance/` directory + add to `.gitignore`
- [ ] Create `deploy/logrotate-maintenance.conf` — rotate logs weekly, keep 8 weeks, compress

### Phase 2: Skill Definitions (Research-Only Skills)
- [ ] Create `.claude/skills/maintenance/refactor-simplify/SKILL.md` — dead code detection, complexity hotspots, dependency graph, API surface audit for `evolution/src/`
- [ ] Create `.claude/skills/maintenance/test-gaps/SKILL.md` — uncovered code paths, missing edge cases, CI config analysis (main vs prod), flaky test patterns for evolution
- [ ] Create `.claude/skills/maintenance/update-docs/SKILL.md` — stale docs, missing feature docs, broken references, accuracy audit across `docs/` and `evolution/docs/`
- [ ] Create `.claude/skills/maintenance/ts-coverage/SKILL.md` — untyped function params/returns, `any` usage, DB query type safety, Zod schema gaps in `evolution/src/`
- [ ] Create `.claude/skills/maintenance/bugs-code/SKILL.md` — error handling gaps, race conditions, null/undefined risks, logic errors across codebase
- [ ] All 5 skills use `TOOLS_RESEARCH` which includes `Write` and `Bash(git add/commit *)` so Claude can write the report and commit it. The shared preamble constrains Claude to only modify the report file — this is a prompt-level constraint, not a tool-level one (`--allowedTools` cannot scope Write to a single file path). Defense-in-depth: worktree isolation limits blast radius.

### Phase 3: Playwright UX Skill
- [ ] Create `.claude/skills/maintenance/bugs-ux/SKILL.md` — Playwright MCP-based exploration of evolution admin dashboard (modeled on `/user-test`)
- [ ] bugs-ux uses extended `--allowedTools` adding `mcp__playwright__browser_*` and `Write` (for screenshots/report)
- [ ] Verify Playwright + Chromium work headlessly on the minicomputer
- [ ] Ensure staging URL is accessible from minicomputer

### Phase 4: Documentation and Deployment
- [ ] Create `docs/feature_deep_dives/maintenance_skills.md` — full feature deep dive
- [ ] Update `evolution/docs/minicomputer_deployment.md` — add maintenance scheduler section
- [ ] Install `inotify-tools` on minicomputer (`apt install inotify-tools`)
- [ ] Install `/etc/maintenance-scheduler.env` with real credentials (chmod 600)
- [ ] Install logrotate config: `cp deploy/logrotate-maintenance.conf /etc/logrotate.d/maintenance-scheduler`
- [ ] Install and enable systemd units (`maintenance-scheduler.timer` + `maintenance-monitor.service`)
- [ ] Run `deploy/maintenance-scheduler.sh --dry-run` to validate worktree resolution, branch creation, project folder setup
- [ ] Run first full maintenance cycle and validate output

## Weekly Lifecycle

**Sunday 2:00 AM** — systemd timer fires `maintenance-scheduler.sh`:
- Reads `.worktree_counter` to resolve worktree paths (e.g., `worktree_38_10` through `_15`)
- For each of 6 skills: in its dedicated worktree, creates `chore/maint-<skill>-YYYYMMDD` branch off `origin/main`, writes full project folder (`_status.json`, `_research.md`, `_planning.md`, `_progress.md`), commits, launches `claude -p` in tmux S10-S15
- Writes trigger file to wake S16 into active mode
- No branch switching on a shared repo — each skill is fully isolated in its own worktree

**Sunday ~2-4 AM** — S16 active mode:
- Polls `.status` files every 30s (single progress line: `[04:32] 3/6 complete`)
- No per-skill notifications — silent until all done

**Sunday ~3-4 AM** — all skills finish (or 2hr timeout):
- S16 fires **one** summary notification across 4 channels: wall, notify-send, Slack, Resend email
- Returns to idle mode

**Sunday 4 AM → next Sunday 2 AM** — idle week:
- S16 blocked on `inotifywait` (**zero CPU/IO**)
- Every 5min: checks if user is attached; renders dashboard only if someone is looking
- S10-S15 tmux sessions stay open with bash prompt inside each worktree — user can attach anytime to read output
- Branches and reports live in each worktree — user can `cd worktree_38_11` and work interactively
- Next week: scheduler skips skills whose branch already exists (no re-runs of stale branches)
- **Important**: running `reset_worktrees` wipes all worktrees and creates fresh ones — only run between maintenance cycles, not during

### `claude -p` — How Each Skill Runs

Each S10-S15 session executes `claude -p` (non-interactive/headless mode). This runs the full Claude Code agentic loop — reading files, spawning sub-agents, writing reports — then exits. Same as interactive Claude Code but without the terminal UI. One prompt in, full execution, result out.

```bash
claude -p \
  --append-system-prompt-file '.claude/skills/maintenance/test-gaps/SKILL.md' \
  --allowedTools 'Read,Write,Glob,Grep,Agent,Bash(git log *)' \
  --max-turns 150 \
  --max-budget-usd 5.00 \
  'Run maintenance skill: test-gaps. Write findings to ...'
```

Key flags:
- `--append-system-prompt-file` — loads SKILL.md as system instructions (since `/skills` can't be invoked in `-p` mode)
- `--allowedTools` — whitelists tools for unattended execution (no permission prompts)
- `--max-turns 150` — prevents runaway loops
- `--max-budget-usd 5.00` — caps API spend per skill run

## Detailed Design

### tmux Session and Worktree Assignments

Each skill runs in its own **pre-existing worktree** from `reset_worktrees`. Worktrees 10-15 are reserved for maintenance; worktrees 1-9 are for normal development. The scheduler reads `.worktree_counter` to resolve the current counter (e.g., `38`), then maps to `worktree_38_10` through `worktree_38_15`.

| Session | Worktree | Skill | Scope |
|---------|----------|-------|-------|
| **S10** | `worktree_<N>_10` | refactor-simplify | Dead code, complexity in `evolution/src/` |
| **S11** | `worktree_<N>_11` | test-gaps | Test coverage gaps for evolution |
| **S12** | `worktree_<N>_12` | update-docs | Stale/missing docs in `docs/` + `evolution/docs/` |
| **S13** | `worktree_<N>_13` | ts-coverage | Untyped functions, `any` usage in `evolution/src/` |
| **S14** | `worktree_<N>_14` | bugs-code | Error handling, race conditions, logic errors |
| **S15** | `worktree_<N>_15` | bugs-ux | Playwright UX testing of evolution admin |
| **S16** | (none) | system monitor | Watches runs, sends notifications |

**Why pre-existing worktrees?** Each worktree is a fully isolated copy of the repo with its own `node_modules` already installed by `reset_worktrees`. This means:
- No concurrent git conflicts — each skill operates on its own working directory
- No `npm install` at run time — dependencies are pre-installed
- Playwright + Chromium available via shared `~/.cache/ms-playwright/`
- `.env.local` and Claude settings already copied by `reset_worktrees`

**Prerequisite**: Run `reset_worktrees` before first use. The script already creates 15 worktrees (NUM_WORKTREES=15).

### Output Tracking: Auto-Initialize Pattern

`/initialize` can't run in `-p` mode (it relies on `AskUserQuestion`). Instead, the scheduler script replicates the essential outputs of `/initialize` directly in bash within each worktree — no interaction needed:

1. **Worktree**: `worktree_<N>_<10-15>` (pre-existing, isolated)
2. **Branch**: `chore/maint-<skill>-<YYYYMMDD>` created inside the worktree (uses `chore/` prefix to bypass workflow enforcement)
3. **Project folder**: `docs/planning/maint_<skill>_<YYYYMMDD>/` within the worktree
4. **Files created**:
   - `_status.json` — branch/skill/worktree metadata
   - `_research.md` — populated by Claude with findings
   - `_planning.md` — pre-seeded with skill context; user can flesh out remediation plan
   - `_progress.md` — template for tracking follow-up work

This means each maintenance run produces a **full project folder** compatible with the standard workflow. After review, the user can:
- `cd` into the worktree and continue interactively: flesh out `_planning.md`, run `/plan-review`, execute fixes
- Run `/finalize` on the branch to create a PR with the report + any fixes
- Cherry-pick actionable changes into a proper feature branch
- Or just read the report and discard the branch

### Alerting and Notifications

The scheduler uses a **3-layer notification strategy**:

| Layer | Mechanism | When | Requires |
|-------|-----------|------|----------|
| **1. wall** | `wall` broadcast to all terminals | All skills complete | SSH session open |
| **2. Desktop** | `notify-send` | All skills complete | Desktop session (DISPLAY set) |
| **3. Slack** | Webhook POST | All skills complete | `SLACK_WEBHOOK_URL` env var |
| **4. Email** | Resend API (`curl`) | All skills complete | `RESEND_API_KEY` + `MAINT_NOTIFY_EMAIL` env vars |

All 4 channels fire **once** — a single summary notification after all 6 skills have stopped (whether success, failure, or timeout). No per-skill chatter.

**wall**: Broadcasts summary to all terminals on the minicomputer.

**notify-send**: Desktop notification with pass/fail counts. Gracefully skipped if no `DISPLAY`.

**Slack**: Sends a single summary message. Reuses the same `SLACK_WEBHOOK_URL` already configured for nightly E2E and post-deploy smoke tests.

**Resend email**: Formatted HTML summary via the [Resend API](https://resend.com/docs/api-reference/emails/send-email). Single `curl` POST to `https://api.resend.com/emails`. Requires:
- `RESEND_API_KEY` — Resend API key (sending_access permission is sufficient)
- `MAINT_NOTIFY_EMAIL` — recipient email address
- A verified sender domain in Resend (e.g., `maintenance@yourdomain.com`)

The email includes a table of all 6 skills with pass/fail/timeout status, branch names for easy checkout, and links to the report files. Only sent if both env vars are set — gracefully skipped otherwise.

Each tmux session writes its exit code to a status file at `logs/maintenance/<skill>-<date>.status` (values: `success`, `failure`, `timeout`).

### S16: Persistent System Monitor

**S16 is not a one-shot watcher — it's a persistent system monitor** that runs indefinitely in tmux. It has two modes:

1. **Active mode** — during a maintenance run, polls status files every 30s. When all 6 skills have stopped, sends a single summary notification (wall + notify-send + Slack + email), then returns to idle mode.
2. **Idle mode** — **does not poll**. Blocks on `inotifywait` watching the trigger file. Zero CPU, zero I/O until the scheduler writes a new trigger. Dashboard is only rendered when a user is attached (detected via `tmux display-message -p '#{session_attached}'`).

S16 is started once by the scheduler on first run and **never exits**. On subsequent weekly runs, the scheduler signals S16 (via a trigger file) to re-enter active mode. tmux sessions have no time limit — S16 persists until machine reboot or explicit kill.

To start S16 independently (e.g., after reboot):
```bash
tmux new-session -d -s S16 "bash deploy/maintenance-watcher.sh --monitor"
```

To view the monitor:
```bash
tmux attach -t S16
```

### Scheduler Script: `deploy/maintenance-scheduler.sh`

```bash
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
```

### Watcher / System Monitor: `deploy/maintenance-watcher.sh`

Persistent process running in S16. Two modes: **active** (monitoring a run) and **idle** (sleeping until triggered).

**Efficiency design:**
- **Active mode**: Polls `.status` files every 30s (only during a run, max ~2hrs). Sends one summary notification when all skills have stopped — no per-skill chatter.
- **Idle mode**: **Zero polling.** Blocks on `inotifywait -e create,modify` watching the trigger file. No CPU, no I/O, no disk reads until the scheduler writes a trigger. Dashboard is only rendered when a user is attached (detected via `tmux display-message -p '#{session_attached}'`).
- **Dependency**: `inotify-tools` package (`apt install inotify-tools`) for `inotifywait`.

```bash
#!/usr/bin/env bash
# Persistent system monitor for S16.
# Active mode: polls status files, sends ONE summary when all skills stop.
# Idle mode: blocks on inotifywait (zero CPU). Dashboard only when user attached.
# Usage:
#   maintenance-watcher.sh <DATE> <LOG_DIR> <REPO_DIR>   # scheduler launch (active first)
#   maintenance-watcher.sh --monitor                       # standalone (idle only)
set -euo pipefail

REPO_DIR="${3:-$(cd "$(dirname "$0")/.." && pwd)}"
LOG_DIR="${2:-$REPO_DIR/logs/maintenance}"
TRIGGER_FILE="$LOG_DIR/.maintenance-trigger"

# Preflight: verify inotifywait is available
if ! command -v inotifywait &>/dev/null; then
  echo "FATAL: inotifywait not found. Install: apt install inotify-tools" >&2
  exit 1
fi

# Source credentials if available (for Slack/Resend notifications)
[ -f /etc/maintenance-scheduler.env ] && set -a && source /etc/maintenance-scheduler.env && set +a

SKILLS=(refactor-simplify test-gaps update-docs ts-coverage bugs-code bugs-ux)
declare -A SKILL_SESSIONS=(
  [refactor-simplify]=S10 [test-gaps]=S11 [update-docs]=S12
  [ts-coverage]=S13 [bugs-code]=S14 [bugs-ux]=S15
)

# ─── Notification: single summary after all skills stop ───

send_summary() {
  local DATE="$1"
  local PASS=0 FAIL=0 TIMED_OUT=0 SUMMARY_TEXT=""

  for skill in "${SKILLS[@]}"; do
    local STATUS=$(cat "$LOG_DIR/${skill}-${DATE}.status" 2>/dev/null || echo "unknown")
    local SESSION="${SKILL_SESSIONS[$skill]}" ICON
    case "$STATUS" in
      success) PASS=$((PASS+1)); ICON="✅" ;; failure) FAIL=$((FAIL+1)); ICON="❌" ;;
      timeout) TIMED_OUT=$((TIMED_OUT+1)); ICON="⏰" ;; *) ICON="❓" ;;
    esac
    SUMMARY_TEXT="${SUMMARY_TEXT}${ICON} ${SESSION} ${skill}: ${STATUS}\n"
  done

  local HEADLINE="${PASS} passed, ${FAIL} failed, ${TIMED_OUT} timed out"
  echo "=== MAINTENANCE SUMMARY ${DATE}: ${HEADLINE} ==="
  echo -e "$SUMMARY_TEXT"

  # 1. wall (all terminals)
  echo -e "Maintenance ${DATE}: ${HEADLINE}\n${SUMMARY_TEXT}" | wall 2>/dev/null || true

  # 2. notify-send (desktop)
  if [ "$FAIL" -gt 0 ] || [ "$TIMED_OUT" -gt 0 ]; then
    notify-send -u critical "Maintenance ${DATE}: ${HEADLINE}" "tmux attach -t S16" 2>/dev/null || true
  else
    notify-send "Maintenance ${DATE}: all passed" "" 2>/dev/null || true
  fi

  # 3. Slack
  local SLACK_COLOR="good"
  [ "$FAIL" -gt 0 ] && SLACK_COLOR="danger"
  [ "$TIMED_OUT" -gt 0 ] && SLACK_COLOR="warning"
  send_slack "Maintenance Report ${DATE}" "${HEADLINE}\n${SUMMARY_TEXT}" "$SLACK_COLOR"

  # 4. Resend email
  send_resend_email "$DATE"
}

# ─── Notification channel helpers ───

send_slack() {
  local SUBJECT="$1" BODY="$2" COLOR="${3:-good}"
  local SLACK_WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
  [ -z "$SLACK_WEBHOOK_URL" ] && return 0
  local PAYLOAD
  PAYLOAD=$(jq -n --arg color "$COLOR" --arg title "$SUBJECT" \
    --arg text "$BODY" --arg footer "maintenance-monitor | $(hostname)" \
    '{attachments:[{color:$color, title:$title, text:$text, footer:$footer}]}')
  curl -s -X POST -H 'Content-type: application/json' --data "$PAYLOAD" \
    "$SLACK_WEBHOOK_URL" || echo "WARN: Slack failed"
}

send_resend_email() {
  local DATE="$1"
  local RESEND_KEY="${RESEND_API_KEY:-}"
  local NOTIFY_EMAIL="${MAINT_NOTIFY_EMAIL:-}"
  local FROM_EMAIL="${MAINT_FROM_EMAIL:-maintenance@explainanything.com}"
  [ -z "$RESEND_KEY" ] || [ -z "$NOTIFY_EMAIL" ] && return 0

  local PASS=0 FAIL=0 TIMED_OUT=0 HTML_ROWS=""
  for skill in "${SKILLS[@]}"; do
    local STATUS=$(cat "$LOG_DIR/${skill}-${DATE}.status" 2>/dev/null || echo "unknown")
    local SESSION="${SKILL_SESSIONS[$skill]}"
    local BRANCH="chore/maint-${skill}-${DATE}"
    local COLOR ICON
    case "$STATUS" in
      success) COLOR="#22c55e"; ICON="&#9989;"; PASS=$((PASS+1)) ;;
      failure) COLOR="#ef4444"; ICON="&#10060;"; FAIL=$((FAIL+1)) ;;
      timeout) COLOR="#f59e0b"; ICON="&#9200;"; TIMED_OUT=$((TIMED_OUT+1)) ;;
      *)       COLOR="#6b7280"; ICON="&#10067;" ;;
    esac
    HTML_ROWS="${HTML_ROWS}<tr><td>${ICON} ${SESSION}</td><td>${skill}</td><td style='color:${COLOR};font-weight:bold'>${STATUS}</td><td><code>${BRANCH}</code></td></tr>"
  done

  local SUBJECT="Maintenance Report ${DATE}: ${PASS} passed, ${FAIL} failed, ${TIMED_OUT} timeout"
  local HTML_BODY="<h2>Maintenance Report - ${DATE}</h2>\
<p><strong>${PASS}</strong> passed, <strong>${FAIL}</strong> failed, <strong>${TIMED_OUT}</strong> timed out</p>\
<table border='1' cellpadding='8' cellspacing='0' style='border-collapse:collapse;font-family:monospace'>\
<tr style='background:#f3f4f6'><th>Session</th><th>Skill</th><th>Status</th><th>Branch</th></tr>\
${HTML_ROWS}</table>\
<p style='margin-top:16px'>To review: <code>ssh minicomputer && tmux attach -t S10</code></p>\
<hr><p style='color:#6b7280;font-size:12px'>maintenance-monitor on $(hostname)</p>"

  local PAYLOAD
  PAYLOAD=$(jq -n \
    --arg from "Maintenance <${FROM_EMAIL}>" \
    --arg to "$NOTIFY_EMAIL" \
    --arg subject "$SUBJECT" \
    --arg html "$HTML_BODY" \
    '{from:$from, to:[$to], subject:$subject, html:$html, tags:[{name:"type",value:"maintenance"}]}')
  curl -s -X POST 'https://api.resend.com/emails' \
    -H "Authorization: Bearer ${RESEND_KEY}" \
    -H 'Content-Type: application/json' \
    -d "$PAYLOAD" \
    && echo "Email sent to ${NOTIFY_EMAIL}" \
    || echo "WARN: Resend email failed"
}

# ─── Active mode: wait for all skills to stop, then notify once ───

watch_run() {
  local DATE="$1"
  local TOTAL=${#SKILLS[@]}
  local TIMEOUT=7200  # 2 hours
  local START=$(date +%s)

  echo "━━━ ACTIVE: Monitoring run ${DATE} (${TOTAL} skills, timeout: ${TIMEOUT}s) ━━━"

  while true; do
    local DONE=0 ELAPSED=$(( $(date +%s) - START ))

    for skill in "${SKILLS[@]}"; do
      local STATUS_FILE="$LOG_DIR/${skill}-${DATE}.status"
      [ ! -f "$STATUS_FILE" ] && continue
      [[ "$(cat "$STATUS_FILE")" != "running" ]] && DONE=$((DONE + 1))
    done

    # Progress line (overwrite in-place, no scroll)
    printf "\r  [%02d:%02d] %d/%d skills complete" $((ELAPSED/60)) $((ELAPSED%60)) "$DONE" "$TOTAL"

    if [ "$DONE" -ge "$TOTAL" ]; then
      echo ""; break
    fi

    if [ "$ELAPSED" -ge "$TIMEOUT" ]; then
      echo ""
      for skill in "${SKILLS[@]}"; do
        local SF="$LOG_DIR/${skill}-${DATE}.status"
        [ -f "$SF" ] && [ "$(cat "$SF")" == "running" ] && echo "timeout" > "$SF"
      done
      break
    fi

    sleep 30
  done

  # --- Single summary notification (all 4 channels) ---
  send_summary "$DATE"
}

# ─── Idle mode: live dashboard ───

show_dashboard() {
  clear
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  S16 SYSTEM MONITOR — $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""

  # Last maintenance run
  local LATEST_LOG=$(ls -t "$LOG_DIR"/scheduler-*.log 2>/dev/null | head -1)
  if [ -n "$LATEST_LOG" ]; then
    local LAST_DATE=$(basename "$LATEST_LOG" | sed 's/scheduler-//;s/.log//')
    echo "  LAST RUN: ${LAST_DATE}"
    local P=0 F=0 T=0
    for skill in "${SKILLS[@]}"; do
      local S=$(cat "$LOG_DIR/${skill}-${LAST_DATE}.status" 2>/dev/null || echo "none")
      case "$S" in success) P=$((P+1));; failure) F=$((F+1));; timeout) T=$((T+1));; esac
    done
    echo "  Results:  ✅ ${P} passed  ❌ ${F} failed  ⏰ ${T} timeout"
  else
    echo "  LAST RUN: (none)"
  fi
  echo ""

  # tmux sessions
  echo "  TMUX SESSIONS:"
  for skill in "${SKILLS[@]}"; do
    local SESSION="${SKILL_SESSIONS[$skill]}"
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "    ${SESSION}  ${skill}  🟢 alive"
    else
      echo "    ${SESSION}  ${skill}  ⚫ stopped"
    fi
  done
  echo ""

  # Evolution runner
  echo "  EVOLUTION RUNNER:"
  if systemctl is-active --quiet evolution-runner.timer 2>/dev/null; then
    local NEXT=$(systemctl show evolution-runner.timer --property=NextElapseUSecRealtime --value 2>/dev/null || echo "unknown")
    echo "    Timer:  🟢 active (next: ${NEXT})"
  else
    echo "    Timer:  ⚫ inactive"
  fi
  echo ""

  # Maintenance timer
  echo "  MAINTENANCE SCHEDULER:"
  if systemctl is-active --quiet maintenance-scheduler.timer 2>/dev/null; then
    local NEXT=$(systemctl show maintenance-scheduler.timer --property=NextElapseUSecRealtime --value 2>/dev/null || echo "unknown")
    echo "    Timer:  🟢 active (next: ${NEXT})"
  else
    echo "    Timer:  ⚫ inactive"
  fi
  echo ""

  # Disk usage
  echo "  DISK USAGE:"
  echo "    logs/maintenance/:  $(du -sh "$LOG_DIR" 2>/dev/null | cut -f1)"
  echo "    docs/planning/:    $(du -sh "$REPO_DIR/docs/planning" 2>/dev/null | cut -f1)"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Refreshing every 60s | Ctrl+C for menu"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# ─── Main loop: persistent monitor ───

# If called with a DATE arg, start in active mode for that run
if [ "${1:-}" != "--monitor" ] && [ -n "${1:-}" ]; then
  watch_run "$1"
fi

# Ensure trigger dir exists and clean any stale trigger
mkdir -p "$LOG_DIR"
rm -f "$TRIGGER_FILE"

echo "S16 entering idle mode. Blocking on inotifywait (zero CPU)."

while true; do
  # Render dashboard ONLY if a user is attached to S16
  ATTACHED=$(tmux display-message -p -t S16 '#{session_attached}' 2>/dev/null || echo "0")
  if [ "$ATTACHED" != "0" ]; then
    show_dashboard
  fi

  # Block until trigger file appears — zero CPU, zero I/O while waiting.
  # 300s timeout lets us refresh dashboard if user attaches mid-wait.
  inotifywait -t 300 -qq -e create -e modify "$LOG_DIR/" --include '^\\.maintenance-trigger$' 2>/dev/null || true

  # Check if trigger file appeared (vs timeout)
  if [ -f "$TRIGGER_FILE" ]; then
    NEW_DATE=$(cat "$TRIGGER_FILE")
    rm -f "$TRIGGER_FILE"
    watch_run "$NEW_DATE"
    echo "Run complete. Returning to idle mode..."
  fi
done
```

### Shared Preamble: `.claude/skills/maintenance/shared-preamble.md`

All maintenance skills include this shared instruction set:

```markdown
## Maintenance Skill Protocol

You are running as an automated maintenance check. Follow this protocol exactly:

### Research Pattern (4 rounds × 4 agents)
For each round, spawn 4 Explore agents in parallel with different investigation angles.
Wait for all agents to complete before starting the next round.

- **Round 1: Discovery** — broad scan of the target area, identify all relevant files and patterns
- **Round 2: Deep Dive** — investigate the most promising findings from Round 1 in detail
- **Round 3: Cross-Reference** — validate findings against related code, tests, and docs
- **Round 4: Synthesis** — prioritize findings by severity/impact, draft recommendations

### Output Format
Write a markdown report to the specified report file with:
1. **Executive Summary** (3-5 bullets)
2. **Findings** (ranked by severity: Critical > High > Medium > Low)
3. **Recommendations** (actionable items with specific file paths)
4. **Files Examined** (list of all files read)
5. **Agent Research Log** (key findings from each round)

### Constraints
- Only modify the report file (the _research.md specified in your prompt)
- Commit only the project folder when done (as instructed in your prompt)
- No pushes, no branch changes, no modifications outside the project folder
- Stay within budget ($5 per skill run)
- Complete within 150 turns
```

### Skill SKILL.md Structure (Example: refactor-simplify)

Note: The scheduler concatenates `shared-preamble.md` + skill `SKILL.md` into a temp file before passing to `--append-system-prompt-file`. No include directives needed — each SKILL.md only contains its skill-specific content.

```markdown
---
description: "Analyze evolution codebase for refactoring and simplification opportunities"
---

## Scope
- Primary: `evolution/src/`
- Secondary: `evolution/scripts/`

## Agent Angles (4 per round)
1. **Dead Code Detection** — find functions, exports, types, and files that are never imported or referenced
2. **Dependency Graph** — map import chains, identify circular dependencies, find overly coupled modules
3. **Complexity Hotspots** — find files with high cyclomatic complexity, deep nesting, or long functions
4. **API Surface Audit** — catalog public exports vs internal usage, find opportunities to reduce surface area

## Key Questions
- What code paths are unreachable from any entry point?
- Which modules have the most incoming/outgoing dependencies?
- Are there duplicate implementations of similar logic?
- What V1 legacy code can be safely removed?
```

### systemd Units

**`deploy/maintenance-scheduler.service`**:
```ini
[Unit]
Description=Maintenance Skills Scheduler
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/home/ac/Documents/ac/explainanything-worktree0
Environment=PATH=/home/ac/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/maintenance-scheduler.env
ExecStart=/bin/bash deploy/maintenance-scheduler.sh
TimeoutStartSec=7200
User=ac
Group=ac
StandardOutput=journal
StandardError=journal
SyslogIdentifier=maintenance-scheduler
```

**`/etc/maintenance-scheduler.env`** (chmod 600, NOT in git):
```ini
# Fill in real values — this file is chmod 600 and NOT in git
ANTHROPIC_API_KEY=
RESEND_API_KEY=
MAINT_NOTIFY_EMAIL=
MAINT_FROM_EMAIL=
SLACK_WEBHOOK_URL=
```

**`deploy/maintenance-scheduler.timer`**:
```ini
[Unit]
Description=Weekly Maintenance Skills Timer

[Timer]
OnCalendar=Sun *-*-* 02:00:00
Persistent=true
AccuracySec=60

[Install]
WantedBy=timers.target
```

**`deploy/maintenance-monitor.service`** (auto-starts S16 on boot):
```ini
[Unit]
Description=Maintenance System Monitor (S16)
After=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ac/Documents/ac/explainanything-worktree0
Environment=PATH=/home/ac/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin
EnvironmentFile=/etc/maintenance-scheduler.env
ExecStart=/usr/bin/tmux new-session -d -s S16 /bin/bash deploy/maintenance-watcher.sh --monitor
ExecStop=/usr/bin/tmux kill-session -t S16
User=ac
Group=ac
StandardOutput=journal
StandardError=journal
SyslogIdentifier=maintenance-monitor

[Install]
WantedBy=multi-user.target
```

Note: `Type=oneshot` + `RemainAfterExit=yes` with `tmux new-session -d` — tmux requires a TTY for foreground mode, so we detach (`-d`) and use `RemainAfterExit` so systemd considers the service active even though the start process exited. `ExecStop` kills the tmux session cleanly. The watcher sources `/etc/maintenance-scheduler.env` directly for Slack/Resend credentials.

### bugs-ux Skill (Playwright-based)

This skill is modeled on `/user-test` but focused on the evolution admin dashboard:

```markdown
## Scope
- Evolution admin dashboard at staging URL
- Pages: /admin/quality/evolution/*, /admin/quality/arena/*, /admin/quality/experiments/*

## Execution
1. Start browser via Playwright MCP: `mcp__playwright__browser_navigate` to staging admin URL
2. Authenticate using test credentials
3. Systematically visit each evolution admin page
4. For each page:
   - Take accessibility snapshot: `mcp__playwright__browser_snapshot`
   - Check console for errors: `mcp__playwright__browser_console_messages`
   - Test interactive elements (sorting, filtering, pagination)
   - Take screenshot of any issues: `mcp__playwright__browser_take_screenshot`
5. Classify findings as Bug-Critical/Major/Minor or UX-Major/Minor

## Agent Angles
1. **Functional Testing** — click every button, fill every form, verify expected behavior
2. **Visual/Layout** — look for broken layouts, overflow, alignment issues
3. **Error States** — test with missing data, invalid inputs, network errors
4. **Accessibility** — check ARIA labels, keyboard navigation, color contrast
```

Note: Playwright 1.56.1 + Chromium is installed and browser cache at `~/.cache/ms-playwright/` is shared across worktrees — no per-worktree install needed. The `--allowedTools` for this skill must additionally include `mcp__playwright__browser_*` tools.

## Testing

### Unit Tests
- [ ] No new application code is being written — maintenance skills are prompt/config only

### Integration Tests
- [ ] No new application code — N/A

### E2E Tests
- [ ] No new application code — N/A

### Manual Verification
- [ ] Run `deploy/maintenance-scheduler.sh --dry-run` — verify worktree resolution, branch creation, project folder setup, no claude -p launched
- [ ] Run full `deploy/maintenance-scheduler.sh` on minicomputer — verify 6 tmux sessions (S10-S15) start in correct worktrees
- [ ] Verify S16 is signaled (trigger file created) or launched fresh
- [ ] Attach to each tmux session and confirm Claude is executing research rounds
- [ ] Verify project folders in worktrees contain all 4 files (_status.json, _research.md, _planning.md, _progress.md)
- [ ] Verify `chore/maint-*` branches created in each worktree with initial commit
- [ ] Verify `.status` files transition from `running` → `success`/`failure`
- [ ] Verify S16 sends single summary notification (wall + Slack + email) when all 6 skills stop
- [ ] Verify flock is active during run (`flock -n logs/maintenance/.maintenance.lock -c echo` should fail while scheduler is running)
- [ ] Verify scheduler exits cleanly when worktrees don't exist (rename one worktree, run scheduler, verify WARN logged and other skills proceed)
- [ ] Run `systemctl start maintenance-scheduler.service` and check `journalctl -u maintenance-scheduler`

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes

### B) Automated Tests
- [ ] `bash deploy/maintenance-scheduler.sh --dry-run` — verify worktree resolution, branch creation, project folders, no claude -p launched
- [ ] `bash deploy/maintenance-scheduler.sh` — full run, verify S10-S15 created + S16 signaled
- [ ] `systemctl list-timers | grep maintenance` — verify timer is active after install
- [ ] Check `logs/maintenance/scheduler-*.log` for successful launch entries
- [ ] Check `logs/maintenance/*-*.status` files transition from `running` → `success`/`failure`
- [ ] Verify S16 returns to idle mode (not exits) after all skills complete
- [ ] Run scheduler twice on same day — verify second run skips all skills (branch-exists check)
- [ ] `logrotate -d deploy/logrotate-maintenance.conf` — verify log rotation config is valid

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/maintenance_skills.md` — write full deep dive (new doc created during /initialize)
- [ ] `evolution/docs/minicomputer_deployment.md` — add maintenance scheduler section
- [ ] `docs/docs_overall/environments.md` — add minicomputer maintenance scheduler to environment overview
- [ ] `docs/docs_overall/project_workflow.md` — mention maintenance skills as an ongoing process
- [ ] `docs/docs_overall/debugging.md` — reference maintenance bug-finding skills
- [ ] `docs/feature_deep_dives/testing_setup.md` — reference test-gaps maintenance skill
- [ ] `docs/docs_overall/testing_overview.md` — reference test-gaps findings
- [ ] `docs/docs_overall/instructions_for_updating.md` — reference update-docs maintenance skill
- [ ] `evolution/docs/architecture.md` — reference refactor-simplify maintenance skill

## Review & Discussion

### Iteration 1 — Scores: 3/3/3

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | API keys in plaintext systemd units, shell injection in heredocs, JSON injection in curl, fragile tmux quoting |
| Architecture & Integration | 3/5 | `# include:` directive doesn't exist, env vars don't propagate systemd→tmux, bugs-ux missing Playwright tools, preamble vs prompt contradicts on commits, WorkingDirectory mismatch |
| Testing & CI/CD | 3/5 | No dry-run mode, secrets in plaintext units, no log rotation, READ-ONLY contradicts Write tool, no lockfile for reset_worktrees |

**Fixes applied:**
1. Secrets → `EnvironmentFile=/etc/maintenance-scheduler.env` (chmod 600, not in git)
2. Heredocs → `jq` for JSON construction (`_status.json`)
3. Curl payloads → `jq` in watcher for Slack/Resend JSON
4. tmux quoting → wrapper script per session (avoids nested quoting entirely)
5. `# include:` → scheduler concatenates `shared-preamble.md` + `SKILL.md` into temp file
6. Env propagation → `tmux new-session -e "ANTHROPIC_API_KEY=..."` + watcher sources `/etc/maintenance-scheduler.env`
7. Per-skill tools → `declare -A SKILL_TOOLS` with `TOOLS_PLAYWRIGHT` for bugs-ux
8. Preamble constraint → changed from "READ-ONLY" to "only modify report file + commit project folder"
9. WorkingDirectory → fixed to canonical `explainanything-worktree0` path
10. Dry-run → `--dry-run` flag validates setup without launching claude
11. Log rotation → `deploy/logrotate-maintenance.conf`, `logs/maintenance/` in `.gitignore`
12. Lockfile → `$LOG_DIR/.maintenance.lock` acquired at start, released on EXIT trap
13. inotifywait regex → escaped dot `\\.maintenance-trigger`
14. S16 Type → changed from `forking` to `simple` (tmux without `-d`)
15. Watcher preflight → checks `inotifywait` availability before entering idle loop

### Iteration 2 — Scores: 3/3/4

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 3/5 | Slack/Resend JSON still string interpolation, wrapper arg quoting via single quotes, API key in process list |
| Architecture & Integration | 3/5 | tmux no-TTY for systemd Type=simple, double REPO_DIR prefix in preamble path, TOOLS_READONLY contradicts docs |
| Testing & CI/CD | 4/5 | Lockfile TOCTOU race, dry-run too shallow, TOOLS_READONLY misleading name |

**Fixes applied:**
16. Slack `send_slack` → `jq -n` for JSON construction (no string interpolation)
17. Resend `send_resend_email` → `jq -n` for JSON payload
18. Wrapper script → baked-in env vars (no positional args), sources `/etc/maintenance-scheduler.env` directly
19. API key passthrough → removed `tmux -e ANTHROPIC_API_KEY=...`, wrapper sources env file instead
20. Wrapper chmod 700 immediately after creation
21. PREAMBLE_FILE → relative path (was double-prefixed with REPO_DIR)
22. Lockfile → `flock -n` (atomic advisory locking, auto-releases on process death)
23. TOOLS_READONLY → renamed to TOOLS_RESEARCH, Phase 2 description updated to honestly document Write access + prompt-level constraint
24. S16 systemd → `Type=oneshot` + `RemainAfterExit=yes` with `tmux -d` (tmux needs no TTY)
25. Verification steps → deduplicated, added idempotency test, logrotate test, S16 idle-not-exit test

### Iteration 3 — Scores: 5/4/4

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 — all security fixes verified |
| Architecture & Integration | 4/5 | 0 critical, 5 minor (cd in loop, no [Install] in scheduler service, tmp cleanup, inotifywait portability, stagger configurability) |
| Testing & CI/CD | 4/5 | 0 critical, 5 minor (lockfile verification wording, dry-run creates real branches, tmp cleanup under kill, no negative test for missing worktrees, stagger hardcoded) |

**Minor fixes applied:**
26. inotifywait regex → anchored to `'^\\.maintenance-trigger$'` for exactness
27. Slack body → remove double-escaping sed pipe (jq `--arg` handles escaping)
28. Env file example → fix `ANTHROPIC_API_KEY` prefix from `re_` to `sk-ant-`
29. Lockfile verification step → updated wording to say "flock active" not "removed on exit"
30. Added negative test: verify scheduler exits cleanly when worktrees don't exist

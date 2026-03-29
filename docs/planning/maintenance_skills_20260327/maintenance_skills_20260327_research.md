# Maintenance Skills Research

## Problem Statement
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

## High Level Summary

There are **3 scheduling tiers** available for Claude Code automation, plus CLI flags for non-interactive execution. The recommended approach for this project combines **Desktop scheduled tasks** (durable, local file access) with **`claude -p`** headless mode for the actual execution, and optionally **tmux** for session management and log viewing.

### Key Finding: Three Scheduling Tiers

| Tier | Persistence | Local Files | Session Required | Best For |
|------|------------|-------------|------------------|----------|
| **Cloud** (claude.ai/code/scheduled) | Survives restarts | No (fresh clone) | No | PR reviews, CI monitoring |
| **Desktop** (Claude Desktop app) | Survives restarts | Yes | No | **Our use case** — local maintenance with file access |
| **`/loop`** (session-scoped) | Session only, 3-day expiry | Yes | Yes | Quick polling during active work |

### Key Finding: CLI Headless Mode (`claude -p`)

Claude Code supports full non-interactive execution via `-p` flag:
```bash
claude -p "Run maintenance check" \
  --allowedTools "Read,Glob,Grep,Bash(git *),Agent" \
  --max-turns 50 \
  --output-format json \
  --bare  # Skip hooks/skills/MCP for faster startup
```

Key flags for automation:
- `-p` / `--print` — non-interactive mode, exits after completion
- `--bare` — skip auto-discovery of hooks/skills/MCP for faster scripted execution
- `--max-turns N` — limit agentic turns to prevent runaway loops
- `--max-budget-usd N` — cap API spend per run
- `--allowedTools` — whitelist specific tools for unattended execution
- `--output-format json` — structured output with session ID and metadata
- `--continue` / `--resume` — continue previous conversations
- `-w` / `--worktree` — start in isolated git worktree
- `--tmux` — create tmux session for the worktree (requires `--worktree`)
- `--append-system-prompt` — add custom instructions while keeping defaults
- `--fallback-model` — auto-fallback when primary model is overloaded

### Key Finding: Worktree + tmux Integration

Claude Code has **native worktree + tmux support**:
```bash
# Start Claude in isolated worktree with tmux session
claude -w maintenance-check --tmux -p "Run the refactor analysis"
```

This creates a git worktree at `.claude/worktrees/maintenance-check` and wraps it in a tmux session. The user can attach later via `tmux attach -t <session>`.

### Key Finding: Desktop Scheduled Tasks (Recommended for Durable Scheduling)

Desktop scheduled tasks are the best fit because they:
1. **Persist across restarts** — survive machine reboots
2. **Access local files** — can read the full codebase
3. **Run autonomously** — configurable permissions
4. **Support MCP servers** — inherits from config files
5. **Minimum 1-minute interval** — flexible scheduling

Created via the Claude Desktop app's Schedule page.

### Key Finding: Existing Project Patterns

This project already has extensive automation infrastructure:
- **5 hook types** in `.claude/hooks/` (PreToolUse, PostToolUse, SessionStart, SessionEnd, SubagentStop)
- **9 commands** in `.claude/commands/` (initialize, research, finalize, user-test, debug, etc.)
- **5 skills** in `.claude/skills/` (plan-review-loop, debug, git-github, etc.)
- **tmux dev server management** in `docs/planning/tmux_usage/` (ensure-server.sh, idle-watcher.sh)
- **systemd timer** for evolution pipeline scheduling (evolution/deploy/evolution-runner.timer)
- **Multi-agent patterns** in finalize (5 code review agents) and plan-review (3 reviewer agents)

### Key Finding: Skill/Command Limitations in `-p` Mode

> User-invoked skills like `/commit` and built-in commands are only available in interactive mode. In `-p` mode, describe the task you want to accomplish instead.

This means skills like `/initialize` **cannot be called directly** in headless mode. Instead, the prompt must describe the full task. However, the `--append-system-prompt-file` flag can load a skill's SKILL.md as additional instructions.

## Recommended Architecture

### Option A: Desktop Scheduled Tasks (Simplest, Recommended)
- Create 6 Desktop scheduled tasks, one per maintenance skill
- Each task has a detailed prompt describing the full maintenance workflow
- Tasks run on configurable schedules (daily/weekly)
- Results appear as sessions in the Desktop app for review
- **Pro**: Durable, no custom scripting needed, built-in UI for results
- **Con**: Requires Desktop app running, can't use `/initialize` directly

### Option B: Shell Script + Cron + tmux (Most Flexible)
- Create a shell script per maintenance skill that calls `claude -p`
- Use system cron (or systemd timers) for scheduling
- Each script creates a tmux session for the run
- User attaches to tmux to view results
- **Pro**: Full control, works with existing tmux infrastructure, durable
- **Con**: More setup, need to handle output/logging manually

### Option C: Hybrid — Skill as Orchestrator
- Create a single `/maintain` skill that orchestrates all 6 checks
- User triggers manually or via `/loop` for session-scoped scheduling
- Skill spawns agents in parallel across worktrees
- Results aggregated and presented in-session
- **Pro**: Leverages existing skill infrastructure, agent parallelism
- **Con**: Session-scoped only (3-day expiry), requires active session

### Option D: Cloud Scheduled Tasks
- Create cloud tasks on claude.ai/code/scheduled
- Each task clones the repo and runs analysis
- **Pro**: No machine required, runs reliably
- **Con**: No local file access (fresh clone each time), min 1-hour interval

### Option E: Minicomputer systemd + claude -p (Best Fit)
- Follow the same pattern as the evolution runner: systemd timer + oneshot service
- Create `deploy/maintenance-runner.service` and `deploy/maintenance-runner.timer`
- Timer fires on a schedule (e.g., daily at 2am), service runs a shell script
- Shell script iterates through each maintenance skill, running `claude -p` with the skill prompt
- Each skill runs in a tmux session so user can attach later to view results
- Output saved to log files and/or markdown reports in `docs/planning/maintenance_reports/`
- **Pro**: Proven pattern (evolution runner already works), durable, leverages existing minicomputer, tmux for review, full local file access, `ANTHROPIC_API_KEY` already available
- **Con**: Requires minicomputer to be running, `claude` CLI must be installed there
- **Architecture sketch**:
  ```
  systemd timer (daily 2am)
    → maintenance-runner.service
      → maintenance-runner.sh
        → for each skill:
            tmux new-session -d -s "maint-$SKILL" \
              "claude -p --append-system-prompt-file .claude/skills/maintenance/$SKILL/SKILL.md \
                --allowedTools 'Read,Glob,Grep,Agent,Bash(git *)' \
                --max-turns 100 --max-budget-usd 5.00 \
                --output-format json \
                'Run maintenance check: $SKILL' \
                2>&1 | tee logs/maintenance-$SKILL-$(date +%Y%m%d).log"
  ```
- **Result viewing**: `tmux attach -t maint-refactor-simplify` to view results
- **Existing precedent**: `evolution/deploy/evolution-runner.{service,timer}` uses identical systemd pattern

## Detailed Architecture for Each Skill

Each maintenance skill follows the same pattern:
1. **Initialize** — set up context (read relevant docs, understand scope)
2. **Research round 1** — spawn 4 Explore agents with different investigation angles
3. **Research round 2** — deeper investigation based on round 1 findings
4. **Research round 3** — cross-reference and validate findings
5. **Research round 4** — synthesize and prioritize findings
6. **Report** — generate structured findings for user review

### Skill 1: Refactor and Simplify (Evolution)
- **Scope**: `evolution/src/`, `evolution/scripts/`
- **Agent angles**: Dead code detection, dependency graph analysis, complexity hotspots, API surface audit
- **Output**: List of refactoring opportunities with estimated effort and impact

### Skill 2: Test Gap Coverage
- **Scope**: `evolution/src/`, `src/__tests__/`, `.github/workflows/ci.yml`
- **Agent angles**: Uncovered code paths, missing edge cases, CI config analysis (main vs prod), flaky test patterns
- **Output**: Test coverage gaps ranked by risk, recommendations for new tests

### Skill 3: Update Documentation
- **Scope**: `docs/`, `evolution/docs/`, code files referenced by docs
- **Agent angles**: Stale docs (code changed but docs didn't), missing docs for new features, broken links/references, accuracy audit
- **Output**: List of doc updates needed with specific files and sections

### Skill 4: TypeScript Coverage Gaps
- **Scope**: `evolution/src/`
- **Agent angles**: Untyped function params/returns, `any` type usage, DB query type safety, Zod schema coverage
- **Output**: Files and functions needing type improvements, prioritized by blast radius

### Skill 5: Bug Verification (Code Reading)
- **Scope**: Entire codebase
- **Agent angles**: Error handling gaps, race conditions, null/undefined risks, logic errors
- **Output**: Potential bugs ranked by severity with reproduction guidance

### Skill 6: Bug/UX Testing (Playwright)
- **Scope**: Evolution admin dashboard (staging)
- **Execution**: Uses Playwright MCP (same pattern as `/user-test`)
- **Agent angles**: Functional bugs, accessibility issues, UX friction, broken UI states
- **Output**: Bug reports with screenshots, similar to `/user-test` output

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md
- docs/feature_deep_dives/debugging_skill.md
- docs/docs_overall/instructions_for_updating.md
- evolution/docs/architecture.md

### Additional Project Docs
- evolution/docs/minicomputer_deployment.md — systemd timer + oneshot service pattern for evolution runner

### External Docs Read
- https://code.claude.com/docs/en/headless — Running Claude Code programmatically
- https://code.claude.com/docs/en/cli-reference — Full CLI flag reference
- https://code.claude.com/docs/en/scheduled-tasks — /loop and CronCreate scheduling
- https://code.claude.com/docs/en/web-scheduled-tasks — Cloud scheduled tasks
- https://code.claude.com/docs/en/desktop — Desktop app and Desktop scheduled tasks

## Code Files Read
- .claude/settings.json — Project settings with hooks, permissions, MCP servers
- .claude/settings.local.json — Local settings overrides
- .claude/hooks/*.sh — All 10+ hook scripts (lifecycle automation)
- .claude/commands/*.md — All 9 command definitions
- .claude/skills/*/SKILL.md — All 5 skill definitions
- docs/planning/tmux_usage/*.sh — tmux server management scripts (ensure-server, start-dev-tmux, idle-watcher, claude-tmux)
- evolution/deploy/evolution-runner.timer — systemd timer for evolution scheduling
- .claude/doc-mapping.json — Code-to-doc mapping configuration
- evolution/deploy/evolution-runner.service — systemd oneshot service (template for maintenance runner)
- evolution/deploy/evolution-runner.timer — systemd timer firing every 60s

## Key Findings

1. **Minicomputer + systemd is the best fit** — the evolution runner already proves this pattern works; we can replicate it for maintenance skills with `claude -p`
2. **`claude -p` headless mode** enables non-interactive execution with tool whitelisting and budget caps
3. **Native `--worktree --tmux` flags** provide built-in isolated execution with tmux session management
4. **Skills/commands can't be invoked in `-p` mode** — prompts must describe the full task, but `--append-system-prompt-file` can load skill instructions
5. **Multi-agent research pattern** is well-established in this project (plan-review uses 3 agents, finalize uses 5 code review agents)
6. **The `/user-test` skill** already demonstrates the Playwright MCP pattern needed for Skill 6
7. **5 scheduling options available**: Cloud, Desktop, /loop, shell+cron, minicomputer systemd
8. **`--bare` mode** recommended for scripted calls to skip hook/skill/MCP auto-discovery for faster startup
9. **Existing systemd pattern** in `evolution/deploy/` provides a proven template: oneshot service + timer, journal logging, graceful shutdown
10. **Minicomputer already has** `ANTHROPIC_API_KEY`, Node.js, and the repo cloned — minimal additional setup needed

## Open Questions

1. **Claude CLI on minicomputer** — Is `claude` CLI installed on the minicomputer? If not, we need to install it or use the `@anthropic-ai/claude-agent-sdk` npm package instead.
2. **Budget per skill run** — What's the acceptable API cost per maintenance run? `--max-budget-usd` can cap this.
3. **Scheduling frequency** — How often should each skill run? (Daily? Weekly? On-demand only?)
4. **Worktree vs main branch** — Should maintenance skills run in isolated worktrees (cleaner) or on the current branch (simpler)?
5. **Output format** — Should findings go into markdown files in the repo, GitHub issues, or just be presented in the session?
6. **Playwright on minicomputer** — For Skill 6 (UX testing), does the minicomputer have a display or headless browser capabilities? Playwright can run headless but needs to be installed.

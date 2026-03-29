# Maintenance Skills

## Overview

Automated weekly health monitoring system that runs 6 `claude -p` skills on the minicomputer. Each skill runs in its own pre-existing worktree and tmux session, performing 4 rounds of multi-agent research. A persistent S16 monitor sends a single summary notification when all skills complete.

**Schedule**: Sunday 2:00 AM via systemd timer.

## Architecture

```
systemd timer (Sun 2am) → maintenance-scheduler.sh
  → reads .worktree_counter → resolves worktree_<N>_10 through _15
  → for each skill: checkout branch, auto-init project folder, launch claude -p in tmux
  → signal S16 monitor via trigger file

S16 (persistent): inotifywait idle (zero CPU) → active polling on trigger → single summary notification
```

## Skills

| Session | Worktree | Skill | Scope |
|---------|----------|-------|-------|
| S10 | `worktree_<N>_10` | refactor-simplify | Dead code, complexity in `evolution/src/` |
| S11 | `worktree_<N>_11` | test-gaps | Test coverage gaps for evolution |
| S12 | `worktree_<N>_12` | update-docs | Stale/missing docs in `docs/` + `evolution/docs/` |
| S13 | `worktree_<N>_13` | ts-coverage | Untyped functions, `any` usage in `evolution/src/` |
| S14 | `worktree_<N>_14` | bugs-code | Error handling, race conditions, logic errors |
| S15 | `worktree_<N>_15` | bugs-ux | Playwright UX testing of evolution admin |
| S16 | (none) | system monitor | Watches runs, sends notifications |

Each skill uses the shared preamble's 4-round x 4-agent research protocol. Skills 10-14 use `TOOLS_RESEARCH` (Read, Write, Glob, Grep, Agent, git). Skill 15 (bugs-ux) additionally gets `mcp__playwright__browser_*` tools.

## Key Files

| File | Purpose |
|------|---------|
| `deploy/maintenance-scheduler.sh` | Main orchestrator (--dry-run supported) |
| `deploy/maintenance-watcher.sh` | Persistent S16 monitor |
| `deploy/maintenance-scheduler.service` | systemd oneshot unit |
| `deploy/maintenance-scheduler.timer` | Weekly Sunday 2am timer |
| `deploy/maintenance-monitor.service` | S16 auto-start on boot |
| `deploy/logrotate-maintenance.conf` | Weekly log rotation, 8 weeks retained |
| `.claude/skills/maintenance/shared-preamble.md` | 4-round research protocol |
| `.claude/skills/maintenance/*/SKILL.md` | Per-skill instructions |

## Weekly Lifecycle

1. **Sunday 2:00 AM** — systemd timer fires scheduler
2. **Scheduler** reads `.worktree_counter`, creates `chore/maint-<skill>-YYYYMMDD` branches, writes project folders, launches `claude -p` in S10-S15
3. **S16 active mode** — polls status files every 30s, shows progress line
4. **All skills complete** (or 2hr timeout) — S16 fires one notification: wall + notify-send + Slack + Resend email
5. **S16 idle mode** — blocks on `inotifywait` (zero CPU/IO) until next week
6. **User review** — attach to any tmux session, read reports, optionally continue with `/finalize`

## Output per Skill

Each skill creates a full project folder in its worktree:
- `docs/planning/maint_<skill>_<YYYYMMDD>/_status.json` — metadata
- `docs/planning/maint_<skill>_<YYYYMMDD>/<name>_research.md` — findings report
- `docs/planning/maint_<skill>_<YYYYMMDD>/<name>_planning.md` — remediation template
- `docs/planning/maint_<skill>_<YYYYMMDD>/<name>_progress.md` — progress tracker

These are compatible with the standard workflow — user can run `/plan-review` and `/finalize` on them.

## Notifications (4 channels)

| Channel | Mechanism | Requires |
|---------|-----------|----------|
| wall | Terminal broadcast | SSH session open |
| Desktop | `notify-send` | DISPLAY set |
| Slack | Webhook POST | `SLACK_WEBHOOK_URL` |
| Email | Resend API | `RESEND_API_KEY` + `MAINT_NOTIFY_EMAIL` |

All fire once after all 6 skills stop. No per-skill chatter.

## Security Design

- API keys in `/etc/maintenance-scheduler.env` (chmod 600, not in git)
- Wrapper scripts source credentials directly (no keys in process list or tmux -e)
- All JSON payloads built with `jq` (no string interpolation)
- `flock` for atomic lockfile (prevents concurrent runs and `reset_worktrees` conflicts)
- Worktree isolation limits blast radius of any single skill

## Operations

```bash
# Manual trigger
bash deploy/maintenance-scheduler.sh

# Dry run (validate setup, no claude launched)
bash deploy/maintenance-scheduler.sh --dry-run

# View monitor
tmux attach -t S16

# View specific skill output
tmux attach -t S10  # refactor-simplify

# Check timer
systemctl list-timers | grep maintenance

# View scheduler logs
journalctl -u maintenance-scheduler -n 50

# Start S16 standalone (after reboot)
tmux new-session -d -s S16 "bash deploy/maintenance-watcher.sh --monitor"
```

## Prerequisites

- `inotify-tools` package (`apt install inotify-tools`)
- `reset_worktrees` must have been run (creates worktrees 10-15)
- `/etc/maintenance-scheduler.env` with credentials
- Playwright + Chromium installed (`~/.cache/ms-playwright/`)

# Backup and Git GitHub Cleanup Research

## Problem Statement
Create a new skill about git and GitHub usage, document credential storage locations, document how to monitor active GitHub Actions runs based on permissions, and fix /finalize and /mainToProd skills to successfully push to the backup repo which has been failing recently.

## Requirements (from GH Issue #NNN)
1. Create a new skill documenting git and GitHub usage patterns
2. Document where git and GitHub credentials are stored
3. Document how to monitor active GitHub Actions runs based on permissions
4. Fix /finalize and /mainToProd to successfully push to the backup repo (currently failing)

## High Level Summary

### Root Cause of Backup Push Failures
The backup pushes in /finalize are **treated as fatal** (no error handling). All 3 backup push commands in finalize.md and 2 in mainToProd.md are in code blocks with other commands, meaning if a push fails, the entire workflow stops. Recent /finalize runs (3 on Mar 6) merged to origin/main but did NOT sync to backup — backup/main is 3 commits behind.

The enforce-bypass-safety.sh hook is NOT the cause — /finalize and /mainToProd run in normal mode (not bypass mode), so the hook exits immediately. The `gh issue create` block we encountered during /initialize was because THIS session runs in bypass mode.

### Key Findings
1. **Backup pushes work when tested directly** — dry-run and actual pushes succeed
2. **Both PATs are valid** — primary (expires Feb 2027) and backup tokens verified working
3. **All 3 backup pushes in finalize.md lack error handling** — they're fatal, blocking the workflow
4. **backup/main is 3 commits behind origin/main** — production is synced
5. **217 branches exist on origin but not backup** — backup is a subset
6. **Worktrees share backup remote config** — no per-worktree setup needed
7. **enforce-bypass-safety.sh has false positive bugs** (dd regex, force-with-lease blocking) but only affects bypass mode

## Credential Storage Locations

### Git Credentials
| Location | Type | Purpose |
|----------|------|---------|
| `~/.git-credentials` | Plain text (0600) | Git credential helper store (primary account) |
| `~/.config/gh/hosts.yml` | Protected (0600) | GitHub CLI OAuth token (primary account) |
| `.git/config` backup remote URL | Embedded PAT | Backup repo push access (backup account) |

### Token Details
- **Primary**: Fine-grained PAT, expires Feb 24, 2027. Scopes: admin, maintain, pull, push, triage on origin repo
- **Backup**: Fine-grained PAT. Scopes: Contents (R/W) + Workflows (R/W), limited to backup repo only
- **Protocol**: HTTPS only (no SSH keys configured)
- **IMPORTANT**: Never commit token values or prefixes to git. Reference locations only.

### GitHub Actions Secrets
- **Repository-level**: OPENAI_API_KEY, DEEPSEEK_API_KEY, PINECONE_API_KEY
- **Development environment**: Supabase creds, Pinecone config, test user creds
- **Production environment**: Supabase creds, test user creds, VERCEL_AUTOMATION_BYPASS_SECRET

## GitHub Actions Monitoring

### 5 Workflows
1. **CI** (`ci.yml`) — PR tests: lint, tsc, unit, integration, E2E
2. **E2E Nightly** (`e2e-nightly.yml`) — Daily 6AM UTC, 2 browsers, real AI
3. **Post-Deploy Smoke** (`post-deploy-smoke.yml`) — After Vercel production deploy
4. **Supabase Migrations** (`supabase-migrations.yml`) — Deploy DB migrations
5. **Migration Reorder** (`migration-reorder.yml`) — Fix timestamp conflicts

### Key gh CLI Commands
```bash
gh run list --limit 10 --json status,name,conclusion,createdAt,headBranch
gh run view <RUN_ID> --verbose
gh run watch <RUN_ID> --exit-status
gh run view <RUN_ID> --log-failed
gh run list --workflow CI --status failure --limit 10
```

### Current Permissions
Full admin access (admin, maintain, pull, push, triage) on Minddojo/explainanything. Rate limits: ~5000/hour per token.

## Backup Push Analysis

### Commands in finalize.md
1. **Line 313** (Step 3): `git -c http.postBuffer=524288000 push backup origin/main:refs/heads/main --no-verify` — Syncs main to backup. FATAL, chained before `git rebase`.
2. **Line 649** (Step 7): `git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify` — Pushes feature branch. FATAL, chained after `git push -u origin HEAD`.
3. **Line 786** (Step 8d): Same as #2 but inside fix-retry iteration loop.

### Commands in mainToProd.md
1. **Line 116** (Step 6): `git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify`
2. **Line 117** (Step 6): `git -c http.postBuffer=524288000 push backup origin/production:refs/heads/production --no-verify`

### Why They Fail

**Two distinct failure periods identified:**

**Period 1 (Mar 1-3): Commands never committed to main**
PR #603 added backup push commands to local copies of finalize.md/mainToProd.md but they were never committed. Every /finalize run fetched the version from origin/main which lacked the backup commands entirely. Fixed by commit `35bb4239` (PR #612, Mar 3).

**Period 2 (Mar 6+): Commands exist but don't reliably execute**
After the fix, backup/main stopped syncing at `f10d5121` (#641). Three subsequent finalize runs (#642, #643, #644) pushed to origin but backup didn't get synced. No error logs exist. The likely cause is structural:

1. **Backup pushes share code blocks with other commands** — Claude interprets code blocks as suggestions, not strict scripts. When the primary push (`git push -u origin HEAD`) succeeds, Claude may skip the secondary backup push and move on to PR creation.
2. **No verification step** — nothing checks whether the backup push actually ran or succeeded.
3. **No explicit instruction** — the commands don't have surrounding text saying "You MUST also push to backup" — they're just silently listed in the same bash block.

**The fix:** Make backup pushes explicit, isolated (own code block with clear instructions), and verified (check output, warn on failure, but don't block the workflow).

### Backup Sync Status (as of research)
- backup/main: 3 commits behind origin/main
- backup/production: synced with origin/production
- 217 branches missing from backup (mostly historical feature/fix branches)
- Backup remote is reachable and functional (verified with actual push)

## enforce-bypass-safety.sh Analysis (Bypass Mode Only)

### Bugs (only affect bypass mode, NOT /finalize)
1. **Line 117**: `git add (-A|\.( |$))` — blocks all `git add -A` commands
2. **Line 101**: `git push.*(--force|--force-with-lease)` — blocks `--force-with-lease` backup pushes
3. **Line 127**: `gh (gist create|issue create.*(\$\(|\`)|pr create.*(\$\(|\`))` — blocks `gh issue create` with heredoc (hit during /initialize)
4. **Line 91**: `dd ` pattern could match unintended strings

### Impact
These bugs block operations in bypass mode only. For /finalize and /mainToProd (normal mode), they have zero effect.

## Skill Structure Research

### Existing Commands (7 total)
| Command | File | Purpose |
|---------|------|---------|
| /initialize | initialize.md | Project setup |
| /research | research.md | Research phase |
| /plan-review | plan-review.md | Multi-agent plan review |
| /debug | debug.md | Debugging workflow |
| /finalize | finalize.md | Branch finalization |
| /user-test | user-test.md | Exploratory testing |
| /mainToProd | mainToProd.md | Main to production merge |

### Existing Skills (4 total)
- debug, plan-review, plan-review-loop, add-to-sandbox-whitelist

### Skill Structure
- Skills: `.claude/skills/<name>/SKILL.md` with YAML frontmatter
- Commands: `.claude/commands/<name>.md` with YAML frontmatter
- Auto-discovered by Claude Code from directory structure
- Frontmatter specifies `allowed-tools`, `description`, `argument-hint`

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Code Files Read
- .claude/commands/finalize.md — backup push commands at lines 313, 649, 786
- .claude/commands/mainToProd.md — backup push commands at lines 116-117
- .claude/hooks/enforce-bypass-safety.sh — regex patterns, bypass mode detection
- .claude/hooks/backup-on-bypass.sh — safety backup hook for bypass mode
- .claude/settings.json — hook registration, sandbox config, allowed tools
- .git/config — remote configurations (origin + backup)
- .github/workflows/ci.yml — CI workflow
- .github/workflows/e2e-nightly.yml — nightly E2E
- .github/workflows/post-deploy-smoke.yml — post-deploy smoke tests
- .github/workflows/supabase-migrations.yml — migration deployment
- .github/workflows/migration-reorder.yml — timestamp conflict resolution
- docs/planning/setup_mirror_repo_as_backup_for_finalize_command_20260301/ — original setup
- docs/planning/backup_test_20260303/ — backup test and fix

## Open Questions
1. Should backup pushes be completely non-fatal, or should they warn and continue?
2. Should we add a periodic sync job (cron or GH Action) to keep backup up-to-date?
3. Should the enforce-bypass-safety.sh bugs be fixed even though they don't affect /finalize?
4. What content should the new git/GitHub skill cover beyond credentials and monitoring?

---
description: Merge main into production, resolve conflicts (preferring main), run checks (including E2E), and create PR
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Read, Glob, mcp__filesystem__write_file
---

# Main to Production Release

Automate the process of merging main into production with conflict resolution and verification.

## Context

- Current branch: !`git branch --show-current`
- Main latest: !`git log origin/main --oneline -1`
- Production latest: !`git log origin/production --oneline -1`

## Workflow

Execute these steps in order:

### 1. Setup

```bash
# Save current work
git stash

# Fetch latest
git fetch origin

# Create a deploy branch from production
git checkout -b deploy/main-to-production-$(date +%b%d | tr '[:upper:]' '[:lower:]') origin/production
```

### 2. Merge Main

```bash
git merge origin/main --no-commit --no-ff
```

### 3. Resolve Conflicts

If conflicts exist, resolve in two steps:

**IMPORTANT**: If `.claude/hooks/block-manual-server.sh` has conflicts, it will break bash commands. Fix it FIRST using `mcp__filesystem__write_file` before running any other git commands.

**Step A — Accept deletions** (files main deleted but production kept):
```bash
git diff --name-only --diff-filter=U | while IFS= read -r f; do
  # :1: = ancestor existed, :3: = main's version absent → main deleted it
  if git show :1:"$f" >/dev/null 2>&1 && \
     ! git show :3:"$f" >/dev/null 2>&1; then
    git rm "$f"
  fi
done
```

**Step B — Prefer main for content conflicts** (only files NOT handled by Step A):
```bash
git checkout --theirs <conflicted-file>
```

Common conflict files:
- `.claude/hooks/block-manual-server.sh` - FIX THIS FIRST via MCP filesystem
- `.claude/settings.json`
- `.claude/review-state/agent-completions.jsonl`
- `CLAUDE.md`
- `docs/docs_overall/environments.md`
- `docs/docs_overall/project_workflow.md`
- `src/lib/services/*.ts`

After resolving:
```bash
git add -A
```

### 4. Run All Verification Checks (collect all failures)

Run ALL 5 checks without stopping on failure. Collect every failure into a summary table, then fix all issues at once:

```bash
# Run all 5 — capture exit codes, do NOT stop on failure
npm run lint;                LINT_RC=$?
npx tsc --noEmit;            TSC_RC=$?
npm run build;               BUILD_RC=$?
npm run test:unit;           UNIT_RC=$?
npm run test:integration;    INT_RC=$?
```

Display results:
```
Check Results
──────────────────────────────────────
Lint:              ✓ PASSED / ✗ FAILED
TypeScript:        ✓ PASSED / ✗ FAILED
Build:             ✓ PASSED / ✗ FAILED
Unit Tests:        ✓ PASSED / ✗ FAILED
Integration Tests: ✓ PASSED / ✗ FAILED
──────────────────────────────────────
```

If any check failed:
1. Fix ALL failing issues at once
2. Re-run ALL 5 checks (not just the ones that failed)
3. Repeat until all 5 pass

### 4.5. E2E Tests

Always run the full E2E suite — no flag required:

```bash
npm run test:e2e
```

This runs the full chromium + chromium-unauth E2E suite. If any E2E tests fail, fix them and re-run until all pass. Do not skip or proceed without passing E2E tests.

### 5. Commit

```bash
git commit -m "Release: main → production ($(date '+%b %d') - <brief description>)

## Summary
<list key PRs merged>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

### 6. Push and Create PR

```bash
git push -u origin HEAD
```

### 6.1. Backup Pushes (non-fatal)

YOU MUST run both commands below. They are non-fatal — if either fails, log the error and continue.

```bash
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
```

Verify exit code. If non-zero, display "WARNING: Backup push (branch) failed with exit code $?" and continue.

```bash
git -c http.postBuffer=524288000 push backup origin/production:refs/heads/production --no-verify
```

Verify exit code. If non-zero, display "WARNING: Backup push (production ref) failed with exit code $?" and continue.

```bash
gh pr create --base production --head $(git branch --show-current) \
  --title "Release: main → production ($(date '+%b %d'))" \
  --body "## Summary
<list of changes>

## Test plan
- [ ] CI passes on all checks
- E2E Tests: ✓ passed
- [ ] Smoke tests pass post-deployment

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

### 6.2. Monitor CI Checks

After PR creation, monitor CI checks until they all pass. If any fail, fix issues locally, push, and re-monitor.

**Step 6.2a: Wait for CI to start**

```bash
sleep 30
```

**Step 6.2b: Watch checks until completion**

```bash
timeout 900 gh pr checks --watch
```

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | All checks passed | Proceed to Step 7 |
| 1 | One or more checks failed | Proceed to Step 6.2c (diagnose) |
| 124 | Timeout (15 min elapsed) | Ask user: "CI timed out. Wait longer or abort?" |
| 8 | Checks still pending | Re-run `gh pr checks --watch` |

**Step 6.2c: Diagnose and fix failures**

```bash
gh pr checks --json name,bucket,link,state
```

Get failure logs:
```bash
FAILED_RUN_IDS=$(gh pr checks --json link,bucket \
  --jq 'map(select(.bucket == "fail") | .link | capture("runs/(?<id>[0-9]+)") | .id) | unique | .[]')

for run_id in $FAILED_RUN_IDS; do
  gh run view "$run_id" --log-failed
done
```

**Step 6.2d: Fix, commit, and push**

1. Analyze the failure logs to identify root causes
2. Fix ALL issues locally
3. Re-run ALL local checks: Step 4 (all 5 checks) + Step 4.5 (E2E). Re-run everything, not just the checks that failed.
4. **Never use `gh run rerun`** — always push new commits to trigger a full CI run. Re-running stale commits can mask issues introduced by fixes.
5. Commit fixes:
   ```bash
   git add -A
   git commit -m "fix: address CI failures (iteration N)"
   ```
6. Push:
   ```bash
   git push
   ```
7. Backup push (non-fatal):
   ```bash
   git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
   ```
   Verify exit code. If non-zero, display "WARNING: Backup push failed with exit code $?" and continue.
8. Return to Step 6.2a (wait 30s, then re-watch)

**Maximum iterations**: 5 fix-push-watch cycles. After 5 failures, ask user: "CI checks have failed 5 times. Continue trying or abort monitoring?"

### 7. Verify and Cleanup

```bash
# Verify PR is mergeable
gh pr view --json mergeable,mergeStateStatus

# Return to original branch
git checkout <original-branch>
git stash pop
```

## Conflict Resolution Strategy

1. **Always prefer main's version** - Main has the newer code
2. **For log files** (`.jsonl`): Can combine entries chronologically, or just take main's
3. **For config files**: Take main's version (has newer hooks/settings)
4. **For source code**: Take main's version (has newer features like `withLogging`)

## Success Criteria

- All conflicts resolved (preferring main)
- Lint passes
- TypeScript compiles
- Build succeeds
- Unit tests pass
- Integration tests pass
- E2E tests pass (always run)
- PR created with no merge conflicts
- PR CI checks all pass (or user chose to abort monitoring)
- `mergeable: MERGEABLE` status
- PR URL displayed

## Troubleshooting

If bash commands fail with "syntax error near `<<<`":
- The hook file has conflicts breaking the bash hook
- Use `mcp__filesystem__write_file` to write the correct content directly
- Then continue with git commands

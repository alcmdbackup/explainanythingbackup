---
description: Merge main into production, resolve conflicts (preferring main), run checks, and create PR
argument-hint: [--e2e]
allowed-tools: Bash(git:*), Bash(gh:*), Bash(npm:*), Bash(npx:*), Read, Glob, mcp__filesystem__write_file
---

# Main to Production Release

Automate the process of merging main into production with conflict resolution and verification.

## Arguments

- `--e2e`: Include full E2E test suite in the verification (optional, default: skip E2E)

The argument passed is: `$ARGUMENTS`

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

### 4. Run Verification Checks

Run each check. If any fails, fix the issues before proceeding:

```bash
# 1. Lint
npm run lint

# 2. TypeScript
npx tsc --noEmit

# 3. Build
npm run build

# 4. Unit Tests
npm run test:unit

# 5. Integration Tests
npm run test:integration
```

If any check fails:
- Fix the issue
- Re-run the failing check
- Continue when all pass

### 4.5. E2E Tests (if --e2e flag provided)

If `$ARGUMENTS` contains `--e2e`:
- Run: `npm run test:e2e`
- This runs the full chromium + chromium-unauth E2E suite
- If any E2E tests fail, fix them and re-run until all pass
- Do not skip or proceed without passing E2E tests

### 5. Commit

```bash
git commit -m "Release: main → production ($(date '+%b %d') - <brief description>)

## Summary
<list key PRs merged>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
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
- E2E Tests: [✓ passed / skipped (no --e2e flag)]
- [ ] Smoke tests pass post-deployment

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

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
- E2E tests pass (if --e2e flag was provided)
- PR created with no merge conflicts
- `mergeable: MERGEABLE` status
- PR URL displayed

## Troubleshooting

If bash commands fail with "syntax error near `<<<`":
- The hook file has conflicts breaking the bash hook
- Use `mcp__filesystem__write_file` to write the correct content directly
- Then continue with git commands

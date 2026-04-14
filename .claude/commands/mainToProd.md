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

### 4. Run All Non-E2E Checks (collect all failures)

Run ALL 5 checks without stopping on failure. Collect every failure into a summary table, then fix all issues at once:

```bash
# Run all 5 — capture exit codes, do NOT stop on failure
npm run lint;                LINT_RC=$?
npx tsc --noEmit;            TSC_RC=$?
npm run build;               BUILD_RC=$?
npm run test;                UNIT_RC=$?
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

1. **Classify failures**: Check if main's CI is also failing:
   ```bash
   MAIN_STATUS=$(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion -q '.[0].conclusion // "unknown"' 2>/dev/null || echo "unknown")
   ```
   If `MAIN_STATUS` is "failure", compare failing tests against main's failures (same approach as Step 6.2d-2). Tests failing on BOTH main and this branch are **pre-existing**.

2. **Surface pre-existing failures**: If pre-existing failures found, use **AskUserQuestion**:
   - Question: "These test failures also exist on main (pre-existing): [list]. How should I handle them?"
   - Options: "Fix them anyway" / "Skip pre-existing, fix only new failures" / "Abort"

3. **Fix** all applicable failing issues at once

4. **Targeted verify**: Run ONLY the specific failing tests locally to confirm the fix works. GATE: all must pass before proceeding.

5. **Stability check**: Run each previously-failing test 5 times (same protocol as Step 6.2d-6). If any run fails, investigate root cause — do NOT add retries/sleeps/skips.

6. **Full verify**: Re-run ALL 5 non-E2E checks (not just the ones that failed)

7. Repeat until all 5 pass

### 4.5. Run E2E Tests

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

**Step 6.2c: Diagnose failures**

Get CI run details and failure logs:

```bash
BRANCH=$(git branch --show-current)
RUNS=$(gh run list --branch "$BRANCH" --limit 5 --json databaseId,name,conclusion,status 2>/dev/null || echo "[]")
echo "$RUNS" | jq -r '.[] | "\(.conclusion // .status)\t\(.name)"'
FAILED_RUN_IDS=$(echo "$RUNS" | jq -r '.[] | select(.conclusion == "failure") | .databaseId' || true)
```

If `RUNS` is empty or `[]`, display "No CI runs found for branch" and return to Step 6.2b (re-watch).

Get failure logs for each failed run:
```bash
for run_id in $FAILED_RUN_IDS; do
  gh run view "$run_id" --log-failed
done
```

If `--log-failed` produces no useful output, try:
```bash
gh run list --branch "$BRANCH" --status failure --json databaseId,name,conclusion
# Then for each: gh run view <id> --log
```

**Step 6.2d: Gated CI retry flow**

This step has 8 sub-steps with 3 hard gates. **Never use `gh run rerun`** — always push new commits to trigger a full CI run.

**Step 6.2d-1: Parse failing tests from CI logs**
```bash
FAILED_SPECS=""
FAILED_TESTS=""
for run_id in $FAILED_RUN_IDS; do
  LOGS=$(gh run view "$run_id" --log-failed 2>&1 || true)
  if [ -z "$LOGS" ] || [ "$LOGS" = "No failed steps" ]; then
    LOGS=$(gh run view "$run_id" --log 2>&1 | tail -500 || true)
  fi
  SPECS=$(echo "$LOGS" | grep -oE 'src/__tests__/e2e/specs/[^ ]*\.spec\.ts' | sort -u || true)
  FAILED_SPECS="$FAILED_SPECS $SPECS"
  TESTS=$(echo "$LOGS" | grep -oE 'FAIL\s+[^ ]*\.test\.ts' | sed 's/FAIL\s*//' | sort -u || true)
  FAILED_TESTS="$FAILED_TESTS $TESTS"
done
FAILED_SPECS=$(echo "$FAILED_SPECS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
FAILED_TESTS=$(echo "$FAILED_TESTS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
```

If BOTH `FAILED_SPECS` and `FAILED_TESTS` are empty → skip Steps 6.2d-5 and 6.2d-6, proceed to Step 6.2d-7 (full verify).

**Step 6.2d-2: Classify failures — pre-existing vs new**
```bash
MAIN_STATUS=$(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion -q '.[0].conclusion // "unknown"' 2>/dev/null || echo "unknown")
```
If "unknown" or empty → treat all as new. If "success" → all are new. If "failure" → compare with main's failing tests (same pattern as 6.2d-1 on main's logs).

**Step 6.2d-3: Surface pre-existing failures to user**

If pre-existing failures found, use **AskUserQuestion**:
- Question: "These test failures also exist on main (pre-existing): [list]. How should I handle them?"
- Options: "Fix them anyway" / "Skip pre-existing, fix only new failures" / "Abort"

**Step 6.2d-4: Fix the issues**
- Analyze root causes from CI logs
- Apply fixes to identified issues

**Step 6.2d-5: Targeted verify — GATE**

Run ONLY the specific failing tests locally with `--retries=0`:
```bash
npx playwright test <specific-spec-file> --project=chromium --retries=0
npx jest <specific-test-file>
```
**HARD GATE**: Every previously-failing test must pass. If any fail, return to Step 6.2d-4.

**Step 6.2d-6: Flakiness stability check — GATE**

Run each previously-failing test 5 times to confirm stability:
```bash
# E2E: use --workers=1 for CI-like conditions
for i in 1 2 3 4 5; do
  npx playwright test <file> --project=chromium --retries=0 --workers=1 || { echo "FLAKY on run $i"; break; }
done
# Unit/integration:
for i in 1 2 3 4 5; do
  npx jest <file> --forceExit || { echo "FLAKY on run $i"; break; }
done
```

If any run fails, the fix is insufficient — the test is still flaky:
1. Do NOT add retries, increase timeouts, wrap in try/catch, add sleeps, or mark as skipped
2. Investigate root cause using testing_overview.md rules (Rule 1, 4, 9, 10, 12, 13, 18)
3. Scan diff for anti-patterns: `git diff | grep -E 'waitForTimeout|new Promise.*setTimeout|setTimeout.*[0-9]{4}|\.sleep\(|\.skip\(|retries:\s*[1-9]|test\.fixme'`
4. If anti-pattern found, automatically rework — do not ask user
5. After reworking, return to Step 6.2d-5
6. If 3+ rework iterations fail to stabilize, THEN escalate to user

**Step 6.2d-7: Full verify — GATE**

Re-run ALL local checks: Step 4 (Run All Non-E2E Checks) + Step 4.5 (Run E2E Tests).
**HARD GATE**: All checks must pass. If any fail, return to Step 6.2d-4.

**Step 6.2d-8: Push**
```bash
git add -A
git commit -m "fix: address CI failures (iteration N)"
git push
```
Backup push (non-fatal):
```bash
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
```
Return to Step 6.2a (wait 30s, then re-watch).

**Persistence rule**: The CI monitor loop (Steps 6.2a→6.2b→6.2c→6.2d→6.2a) MUST keep running until all CI checks pass. Do NOT stop monitoring or leave the PR in a failing state. The only acceptable exit conditions are:
1. **All CI checks pass** — proceed to Step 7
2. **User explicitly chooses "Abort"** — only offered after 5+ failed iterations or for pre-existing failures in Step 6.2d-3

After 5 failed iterations, use **AskUserQuestion**:
- "Continue trying" (default, recommended) — reset counter and keep going
- "Abort monitoring" — stop and leave PR for manual review

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

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

Write the push gate file so the push hook allows the push:
```bash
echo "{\"commit\":\"$(git rev-parse HEAD)\",\"skill\":\"mainToProd\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .claude/push-gate.json
```

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
```

#### 7.4 Backport Test Fixes to Main (Conditional)

Test/helper fixes applied during this workflow (whether from conflict resolution
preferring production-side text, or from manual fixes in Step 4 / Step 4.5) currently
live only on the deploy branch. Without round-tripping to main, the next
`/mainToProd` rediscovers the same failures and re-applies the same fixes. This
step automates the round-trip by opening a backport PR to main.

The diff between `origin/main` and the deploy branch — restricted to test paths — is
exactly the set of changes main is missing.

```bash
DEPLOY_BRANCH=$(git branch --show-current)

# Identify test-file changes on the deploy branch that main lacks
FIXED_FILES=$(git diff origin/main..HEAD --name-only -- \
  'src/__tests__/' '*.spec.ts' '*.test.ts' 'src/__tests__/e2e/helpers/' \
  2>/dev/null | sort -u)

if [ -z "$FIXED_FILES" ]; then
  echo "No test-file diffs vs main — no backport PR needed."
else
  echo "Backporting these test fixes to main:"
  echo "$FIXED_FILES" | sed 's/^/  /'

  BACKPORT_BRANCH="chore/backport-test-fixes-$(date +%Y%m%d-%H%M)"

  # Create branch off main; copy each fixed file from deploy branch
  git checkout -b "$BACKPORT_BRANCH" origin/main

  echo "$FIXED_FILES" | while IFS= read -r f; do
    [ -z "$f" ] && continue
    git checkout "$DEPLOY_BRANCH" -- "$f"
  done

  # If the copy resulted in no actual changes (files already matched main), skip
  if git diff --cached --quiet && git diff --quiet; then
    echo "Files identical to main after copy — no backport PR needed."
    git checkout "$DEPLOY_BRANCH"
  else
    git add -A
    git commit -m "chore: backport test fixes from production release $(date '+%b %d')

Backports test/helper fixes applied inline during the main → production deploy
workflow. Without this round-trip, the next /mainToProd run would rediscover
the same failing tests and re-apply identical fixes during conflict resolution.

Files backported:
$(echo "$FIXED_FILES" | sed 's/^/  - /')

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"

    # Push gate (same pattern as main deploy push)
    echo "{\"commit\":\"$(git rev-parse HEAD)\",\"skill\":\"mainToProd\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .claude/push-gate.json

    if git push -u origin HEAD 2>&1; then
      gh pr create --base main --head "$BACKPORT_BRANCH" \
        --title "chore: backport test fixes from production release $(date '+%b %d')" \
        --body "## Why

The \`/mainToProd\` workflow applied test/helper fixes inline during the $(date '+%b %d') production release. Without backporting, the same fixes would be lost on the next release and would have to be re-discovered during conflict resolution.

## Files
$(echo "$FIXED_FILES" | sed 's/^/- /')

## Test plan
- [ ] CI passes (these are test-only changes)
- [ ] No conflicts when merged

🤖 Generated with [Claude Code](https://claude.com/claude-code)" \
        2>&1 | tail -3

      echo "Backport PR opened. Merge it after the production release lands so the next /mainToProd run doesn't have to re-apply these fixes."
    else
      echo "WARNING: backport branch push failed. Manually push '$BACKPORT_BRANCH' and open PR to main:"
      echo "  git push -u origin $BACKPORT_BRANCH"
      echo "  gh pr create --base main --head $BACKPORT_BRANCH --title 'chore: backport test fixes from production release'"
    fi

    # Return to deploy branch
    git checkout "$DEPLOY_BRANCH"
  fi
fi
```

If the backport branch has its own conflicts against main (e.g., main has changed
the same test file since divergence), the `git push` succeeds but a future merge
needs manual resolution. That's a one-off cleanup — accept it and resolve in PR review.

#### 7.5 Migration-Present Warning (Conditional)

After confirming PR is mergeable, detect whether this PR touches any migration files. **Fail-loud semantics throughout: capture exit codes explicitly, surface failures with WARNING text — silently swallowing errors here would reproduce the exact failure mode this guard exists to prevent.** (Do NOT use `set -e` — it would abort the snippet before the `DIFF_EXIT=$?` capture on the next line, defeating the explicit-check pattern.)

```bash
# Get the PR number (must be defined; this skill does not maintain it as a global)
PR_NUMBER=$(gh pr view --json number -q .number)
if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ]; then
  echo "WARNING: unable to determine PR number — migration-presence check skipped. Inspect manually before merging."
else
  # Fetch the file list. Capture stdout AND exit code separately so we can fail loud on API failure.
  DIFF_OUTPUT=$(gh pr diff "$PR_NUMBER" --name-only)
  DIFF_EXIT=$?
  if [ "$DIFF_EXIT" -ne 0 ]; then
    echo "WARNING: 'gh pr diff $PR_NUMBER --name-only' exited $DIFF_EXIT — migration-presence check could not run. Run manually before merging:"
    echo "  git diff origin/production..HEAD -- supabase/migrations/"
  else
    MIGRATION_FILES=$(echo "$DIFF_OUTPUT" | grep '^supabase/migrations/' || true)
    if [ -z "$MIGRATION_FILES" ]; then
      :  # No migrations in this PR — no banner needed.
    else
      MIGRATION_COUNT=$(echo "$MIGRATION_FILES" | wc -l | tr -d ' ')
      # MUST emit the banner below as the FINAL message to the user. Claude (the
      # skill runner) MUST include this banner literally in its final response
      # message — do not summarize or paraphrase. Render as a fenced code block
      # so ASCII rules display verbatim and aren't reflowed.
      echo "================================================================================"
      echo "!! POST-MERGE MIGRATION VERIFICATION REQUIRED !!"
      echo "================================================================================"
      echo ""
      echo "This PR ships $MIGRATION_COUNT migration file(s):"
      echo ""
      echo "$MIGRATION_FILES" | sed 's/^/  /'
      echo ""
      echo "After you merge this PR, you MUST run these commands to confirm migrations"
      echo "applied successfully to production:"
      echo ""
      echo "  # Wait ~5-10 seconds after merge for GitHub to populate the merge commit SHA"
      echo "  MERGE_SHA=\$(gh pr view $PR_NUMBER --json mergeCommit -q '.mergeCommit.oid')"
      echo "  if [ -z \"\$MERGE_SHA\" ] || [ \"\$MERGE_SHA\" = \"null\" ]; then"
      echo "    echo 'Merge SHA not yet populated — wait 10s and re-run.'"
      echo "  else"
      echo "    gh run list --workflow=supabase-migrations.yml --branch=production \\"
      echo "      --commit=\"\$MERGE_SHA\" --limit=1"
      echo "  fi"
      echo ""
      echo "EXPECTED: conclusion=success."
      echo ""
      echo "IF FAILURE: do NOT release further code until the migration is fixed. A non-"
      echo "idempotent migration aborts the entire deploy queue and leaves prod app code"
      echo "running against stale schema. Inspect logs with:"
      echo "  gh run view <id> --log-failed"
      echo ""
      echo "This exact scenario caused a 2-month silent prod-schema drift in May 2026."
      echo "See: docs/planning/smoke_test_and_nightly_e2e_failing_20260523/"
      echo "================================================================================"
    fi
  fi
fi
```

If `gh pr diff` itself fails for an unknown reason, the fallback manual check is:

```bash
git diff origin/production..HEAD -- supabase/migrations/ | head -1
```

A non-empty result means migrations are present and the post-merge verification is required regardless.

```bash
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

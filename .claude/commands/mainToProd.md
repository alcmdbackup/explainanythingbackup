---
description: Merge main into production, resolve conflicts (preferring main), run checks (including E2E), create PR, and backport any post-merge fixes to main
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

After committing, **record the deploy-merge SHA** so Step 6.3 (backport)
has an unambiguous reference. Use `git rev-parse --git-path` so the path
resolves correctly in BOTH primary checkouts (`.git/maintoprod-deploy-merge-sha`)
AND linked worktrees, where `.git` is a FILE not a directory and the path
becomes `.git/worktrees/<name>/maintoprod-deploy-merge-sha`. Without this,
`echo > .git/maintoprod-deploy-merge-sha` fails with "Not a directory" in
any worktree invocation.

```bash
DEPLOY_MERGE_COMMIT=$(git rev-parse HEAD)
SHA_FILE=$(git rev-parse --git-path maintoprod-deploy-merge-sha)
echo "$DEPLOY_MERGE_COMMIT" > "$SHA_FILE"
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

### 6.3. Backport Fixes to Main (REQUIRED)

After the production PR's CI checks all pass, identify any commits added to
the deploy branch beyond the deploy-merge SHA captured in Step 5 — these are
the post-merge fixes from steps 4, 4.5, and 6.2d. Backport them to main.

This step is REQUIRED. The skill does not return successfully unless either
(a) a backport PR was created and pushed, or (b) zero fix commits were found
beyond the deploy-merge SHA (clean release).

**Step 6.3a — Identify fix commits (uses authoritative `git rev-list --count`, not grep):**

```bash
# Use git rev-parse --git-path so this works in both primary checkouts
# AND linked worktrees (where .git is a FILE, not a directory)
SHA_FILE=$(git rev-parse --git-path maintoprod-deploy-merge-sha)
if [ ! -f "$SHA_FILE" ]; then
  echo "ERROR: $SHA_FILE missing — Step 5 did not run."
  exit 1
fi
DEPLOY_MERGE_COMMIT=$(cat "$SHA_FILE")

# Use git rev-list --count for an authoritative count (NOT `grep -c .` which
# produces a multi-line "0\n0" when the input is empty)
FIX_COUNT=$(git rev-list --count "${DEPLOY_MERGE_COMMIT}..HEAD")

echo "Found $FIX_COUNT fix commits to backport"
```

**Step 6.3b — Branch on FIX_COUNT. CRITICAL: the entire 6.3c-6.3h block must be inside the `else` branch, not a sequence of separate code blocks.**

```bash
if [ "$FIX_COUNT" -eq 0 ]; then
  # ============================================================
  # Clean release path
  # ============================================================
  echo "Clean release — zero fix commits. Skipping backport."
  BACKPORT_PR_URL="none — clean release"
else
  # ============================================================
  # Backport path — Steps 6.3c through 6.3h
  # ============================================================
  FIX_COMMITS=$(git rev-list --reverse "${DEPLOY_MERGE_COMMIT}..HEAD")

  # ---- 6.3c: Create the backport branch off latest main ----
  # Timestamp suffix (HHMM) prevents same-day re-run collision
  git fetch origin main
  BACKPORT_BRANCH="fix/maintoprod-backport-$(date +%b%d-%H%M | tr '[:upper:]' '[:lower:]')"
  git checkout -b "$BACKPORT_BRANCH" origin/main

  # ---- 6.3d: Cherry-pick each fix commit in order ----
  # CRITICAL: use process substitution `< <(...)` NOT a pipe `| while`.
  # A piped while-loop runs in a SUBSHELL, so `exit 1` inside it only kills
  # the subshell — execution would silently fall through to 6.3e/6.3f and
  # produce a broken backport PR on cherry-pick conflict. Process substitution
  # keeps the loop in the parent shell so `exit 1` works as expected.
  while IFS= read -r sha; do
    [ -z "$sha" ] && continue
    if ! git cherry-pick "$sha"; then
      echo "ERROR: cherry-pick conflict on $sha"
      echo "Resolve manually, then run: git cherry-pick --continue"
      echo "After all picks succeed, run steps 6.3e-6.3g manually."
      rm -f "${BODY_TMP:-}"
      exit 1
    fi
  done < <(printf '%s\n' "$FIX_COMMITS")

  # ---- 6.3e: Run local checks on the backport branch ----
  # Includes build because backport commits often touch components.
  # Uses `npm test` (not `npm run test:unit` — that script doesn't exist in
  # package.json; the unit test runner is `test`).
  # Hard exit on failure — without this, 6.3f would push a broken PR.
  if ! (npm run lint && npm run typecheck && npm run build && npm test); then
    echo "ERROR: local checks failed on backport branch — refusing to push."
    echo "Backport branch '$BACKPORT_BRANCH' is left in place for inspection."
    exit 1
  fi

  # ---- 6.3f: Push and create the backport PR ----
  git push -u origin HEAD

  # Backup push — fetch first so --force-with-lease is properly scoped
  git fetch backup 2>/dev/null || echo "WARNING: backup fetch failed; --force-with-lease may degrade"
  git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify || \
    echo "WARNING: backup push failed; continuing"

  # Pre-compute the commit list for the PR body.
  # CRITICAL: use `origin/main..HEAD` NOT `${DEPLOY_MERGE_COMMIT}..HEAD`.
  # The backport branch is based on origin/main (not on the deploy branch),
  # so DEPLOY_MERGE_COMMIT is not an ancestor of HEAD on this branch.
  COMMIT_LIST=$(git log --format='- %h %s' origin/main..HEAD)

  # Use --body-file with a temp file to avoid heredoc-in-markdown EOF
  # whitespace bugs entirely. The temp file is shell-trapped for cleanup.
  BODY_TMP=$(mktemp)
  trap "rm -f \"$BODY_TMP\"" EXIT
  {
    echo "## Summary"
    echo ""
    echo "Backports post-merge fix commits from the $(date '+%b %d') main→production"
    echo "release deploy branch back to main, so the next branch off main starts clean."
    echo ""
    echo "## Commits backported"
    echo "$COMMIT_LIST"
    echo ""
    echo "## Why"
    echo "Fixes made on the deploy branch during /mainToProd verification do not"
    echo "automatically reach main. Without this backport, the next feature branch"
    echo "off main reintroduces the same issues."
    echo ""
    echo "## Test plan"
    echo "- [x] Local lint, typecheck, build, unit tests pass"
    echo "- [ ] CI passes on this PR"
    echo ""
    echo "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  } > "$BODY_TMP"

  # Capture only the PR URL. gh prints "Creating pull request..." to STDERR
  # before the URL on stdout, so capture stdout only (no 2>&1) and take the
  # last line. Use `set -o pipefail` so a `gh pr create` failure isn't masked
  # by the `| tail -1` pipe.
  BACKPORT_PR_URL=$(set -o pipefail; gh pr create --base main --head "$BACKPORT_BRANCH" \
    --title "fix: backport mainToProd fixes from $(date '+%b %d') release" \
    --body-file "$BODY_TMP" | tail -1)
  if [ -z "$BACKPORT_PR_URL" ]; then
    echo "ERROR: gh pr create failed or returned empty URL"
    rm -f "$BODY_TMP"
    exit 1
  fi

  rm -f "$BODY_TMP"
  trap - EXIT

  # ---- 6.3g: BACKPORT_PR_URL is now set for Step 7's summary ----

  # ---- 6.3h: No-op — Step 7's `git checkout <original-branch>` handles
  # the return to the operator's starting branch.
fi
```

### 7. Verify and Cleanup

```bash
# Verify production PR is mergeable
gh pr view --json mergeable,mergeStateStatus

# Display final summary
echo "═══════════════════════════════════════════"
echo "  /mainToProd complete"
echo "═══════════════════════════════════════════"
echo "  Production PR: <url from step 6>"
echo "  Backport PR:   ${BACKPORT_PR_URL}"
echo "═══════════════════════════════════════════"

# Clean up the deploy-merge SHA cache file from Step 5
# (use the same git-path resolver to handle worktrees correctly)
rm -f "$(git rev-parse --git-path maintoprod-deploy-merge-sha)"

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
- **Backport PR to main created** (if any post-merge fix commits were made),
  OR explicitly noted as "clean release — zero fix commits". The skill does
  not return successfully if Step 6.3 is skipped.

## Troubleshooting

If bash commands fail with "syntax error near `<<<`":
- The hook file has conflicts breaking the bash hook
- Use `mcp__filesystem__write_file` to write the correct content directly
- Then continue with git commands

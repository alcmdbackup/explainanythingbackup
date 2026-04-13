# Enforce Run Fix Failing Tests Locally Before Push CI Plan

## Background
We want to save on wasteful CI usage during /finalize and /mainToProd. Currently, CI failures result in repeated pushes without local verification, wasting GitHub Actions minutes. We need to add evolution E2E tests to the local /finalize run, enforce local test verification after any CI failure before resubmitting, always fix flaky test root causes rather than applying surface-level fixes, and surface previously broken tests to the user for guidance.

## Requirements (from GH Issue #962)
- We want to save on wasteful CI usage during /finalize and /mainToProd
- Add evolution E2E tests to local run for /finalize
- In both /finalize and /mainToProd, for any CI failures
    - Fix the issue
    - Run the failing tests locally to verify they pass
    - Run all tests locally and verify they pass
    - Only then can submit to CI again
- For flaky tests, always fix the root cause, never do surface-level fixes
- For previously broken tests, always surface them to the user to ask what to do

## Problem
The `/finalize` and `/mainToProd` skills waste CI minutes by pushing fixes without first verifying them locally. When CI fails, the current flow re-runs ALL local checks but doesn't first target the specific failing tests to confirm the fix works. Evolution E2E tests are never run locally during `/finalize` even when evolution files changed — they only run in CI, so failures are discovered late. There's no guidance for handling flaky tests (root-cause vs surface fix) or pre-existing failures (tests already broken on main before the branch). Both skills also reference `gh pr checks --json` which doesn't exist in gh v2.45.0.

## Options Considered
- [x] **Option A: Edit both skill markdown files directly**: Modify `.claude/commands/finalize.md` and `.claude/commands/mainToProd.md` to add evolution E2E, targeted local verification, flaky test guidance, and pre-existing failure detection. All changes are text edits — no code.
- [ ] **Option B: Create wrapper scripts**: Write shell scripts that orchestrate test runs and failure detection, called from the skills. More maintainable but adds complexity and new files.
- [ ] **Option C: Hook-based enforcement**: Use Claude hooks to enforce local test verification before push. Too rigid — hooks can't handle nuanced decisions like "is this pre-existing?"

**Chosen: Option A** — Direct skill file edits. These are instruction files, not code. Keeping everything inline avoids indirection and makes the full flow readable in one place.

**Rollback plan**: If the restructured CI retry loop causes /finalize or /mainToProd to hang or loop infinitely, revert the `.claude/commands/finalize.md` and `.claude/commands/mainToProd.md` files to their previous versions via `git checkout origin/main -- .claude/commands/finalize.md .claude/commands/mainToProd.md`.

**Phase ordering**: Phases MUST be executed in strict order 0→1→2→3→4→5. Phase 3 depends on Phase 2 (reuses Step 8d-2/8d-3 logic). Phase 2 references the renamed step names from Phase 0.

## Phased Execution Plan

### Phase 0: Rename Steps for Clarity

Rename steps in both skills to make the separation between non-E2E checks and E2E tests explicit.

**File:** `.claude/commands/finalize.md`
- [x] Rename Step 4 from `### 4. Run All Checks (collect all failures)` to `### 4. Run All Non-E2E Checks (collect all failures)`
- [x] Rename Step 5 from `### 5. E2E Critical Tests` to `### 5. Run E2E Tests`
- [x] Update all internal references to these steps (Step 8d-7 says "Step 4 (all 6 checks) + Step 5", etc.)

**File:** `.claude/commands/mainToProd.md`
- [x] Rename Step 4 from `### 4. Run All Verification Checks (collect all failures)` to `### 4. Run All Non-E2E Checks (collect all failures)`
- [x] Rename Step 4.5 from `### 4.5. E2E Tests` to `### 4.5. Run E2E Tests`
- [x] Update all internal references (Step 6.2d says "Step 4 (all 5 checks) + Step 4.5 (E2E)", etc.)

### Phase 1: Add Evolution E2E to /finalize Step 5

**File:** `.claude/commands/finalize.md`

**Current Step 5 (now "Run E2E Tests"):**
```
npm run test:e2e:critical    # always
npm run test:e2e:full         # only with --e2e flag
```

**New Step 5 (Run E2E Tests):**

- [x] Add evolution file detection logic after E2E critical tests pass:
  ```bash
  # Check if evolution files changed
  EVOLUTION_PATHS="evolution|arena|strategy-resolution|manual-experiment|src/app/admin/quality/optimization/"
  EVOLUTION_CHANGED=$(git diff --name-only origin/main | grep -E "$EVOLUTION_PATHS" || true)
  ```
- [x] If `EVOLUTION_CHANGED` is non-empty, run `npm run test:e2e:evolution`
- [x] Keep existing `--e2e` flag behavior for full suite
- [x] Add the evolution detection pattern as a reusable variable at the top of the step

### Phase 2: Restructure CI Retry as Gated Sub-Steps

Replace the current CI retry logic in both skills with explicit, numbered, gated sub-steps. The user is only asked as a last resort.

**Files:** `.claude/commands/finalize.md` (replace Step 8d), `.claude/commands/mainToProd.md` (replace Step 6.2d)

The new CI retry flow has 8 sub-steps with 3 hard gates:

- [x] Write new Step 8d for `/finalize` with this exact flow:

  **Step 8d-1: Parse failing tests from CI logs**
  ```bash
  # Extract specific failing test files from CI output
  FAILED_SPECS=""
  FAILED_TESTS=""
  for run_id in $FAILED_RUN_IDS; do
    LOGS=$(gh run view "$run_id" --log-failed 2>&1 || true)
    
    # If --log-failed returned empty, fall back to full log
    if [ -z "$LOGS" ] || [ "$LOGS" = "No failed steps" ]; then
      LOGS=$(gh run view "$run_id" --log 2>&1 | tail -500 || true)
    fi
    
    # Playwright spec files (multiple patterns for robustness)
    SPECS=$(echo "$LOGS" | grep -oE 'src/__tests__/e2e/specs/[^ ]*\.spec\.ts' | sort -u || true)
    FAILED_SPECS="$FAILED_SPECS $SPECS"
    
    # Jest test files (multiple patterns)
    TESTS=$(echo "$LOGS" | grep -oE 'FAIL\s+[^ ]*\.test\.ts' | sed 's/FAIL\s*//' | sort -u || true)
    FAILED_TESTS="$FAILED_TESTS $TESTS"
  done
  
  # Deduplicate
  FAILED_SPECS=$(echo "$FAILED_SPECS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
  FAILED_TESTS=$(echo "$FAILED_TESTS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
  ```

  **If BOTH `FAILED_SPECS` and `FAILED_TESTS` are empty** (could not parse test names from logs):
  - Display: "Could not extract specific failing test names from CI logs. Will skip targeted verify (8d-5) and stability check (8d-6) and proceed directly to full verify (8d-7)."
  - Skip Steps 8d-5 and 8d-6, proceed to Step 8d-7 (full verify)

  **Step 8d-2: Classify failures — pre-existing vs new**
  ```bash
  # Check if main's CI is green (with null-safety)
  MAIN_STATUS=$(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion -q '.[0].conclusion // "unknown"' 2>/dev/null || echo "unknown")
  ```
  If `MAIN_STATUS` is "unknown" or empty → skip pre-existing detection (no main CI data available), treat all failures as new. Proceed to Step 8d-4.

  If `MAIN_STATUS` is "failure":
  ```bash
  MAIN_RUN_ID=$(gh run list --branch main --workflow ci.yml --limit 1 --json databaseId -q '.[0].databaseId // empty' 2>/dev/null || true)
  if [ -n "$MAIN_RUN_ID" ]; then
    MAIN_LOGS=$(gh run view "$MAIN_RUN_ID" --log-failed 2>&1 || true)
    # Extract main's failing tests using same patterns as 8d-1
    MAIN_FAILED_SPECS=$(echo "$MAIN_LOGS" | grep -oE 'src/__tests__/e2e/specs/[^ ]*\.spec\.ts' | sort -u || true)
    MAIN_FAILED_TESTS=$(echo "$MAIN_LOGS" | grep -oE 'FAIL\s+[^ ]*\.test\.ts' | sed 's/FAIL\s*//' | sort -u || true)
    # Compare: tests in BOTH branch failures and main failures = pre-existing
    PRE_EXISTING=$(comm -12 <(echo "$FAILED_SPECS $FAILED_TESTS" | tr ' ' '\n' | sort) <(echo "$MAIN_FAILED_SPECS $MAIN_FAILED_TESTS" | tr ' ' '\n' | sort) || true)
  fi
  ```
  
  If `MAIN_STATUS` is "success" → all failures are new (not pre-existing). Proceed to Step 8d-4.

  **Note on race conditions**: Main's CI status is a point-in-time snapshot. If main receives new commits between this check and the comparison, the classification may be stale. This is acceptable — the user is asked about pre-existing failures and can override the classification.

  **Step 8d-3: Surface pre-existing failures to user**
  If pre-existing failures found, use **AskUserQuestion**:
  - Question: "These test failures also exist on main (pre-existing): [list]. How should I handle them?"
  - Options:
    1. "Fix them anyway" — fix all failures including pre-existing
    2. "Skip pre-existing, fix only new failures" — note in PR description
    3. "Abort" — stop finalization

  **Step 8d-4: Fix the issues**
  - Analyze root causes from CI logs
  - Apply fixes to identified issues
  - If test is flaky (see Step 8d-6), follow flakiness protocol

  **Step 8d-5: Targeted verify — GATE**
  Run ONLY the specific failing tests locally with `--retries=0`:
  ```bash
  # E2E failures
  npx playwright test <specific-spec-file> --project=chromium --retries=0
  
  # Unit/integration failures  
  npx jest <specific-test-file>
  ```
  **HARD GATE**: Every previously-failing test must pass. If any fail, return to Step 8d-4. Do NOT proceed to Step 8d-6.

  **Step 8d-6: Flakiness stability check — GATE**
  Run each previously-failing test 5 times to confirm stability. Applies to ALL test types:

  For E2E tests:
  ```bash
  for i in 1 2 3 4 5; do
    npx playwright test <file> --project=chromium --retries=0 --workers=1 || { echo "FLAKY on run $i"; break; }
  done
  ```

  For unit/integration tests:
  ```bash
  for i in 1 2 3 4 5; do
    npx jest <file> --forceExit || { echo "FLAKY on run $i"; break; }
  done
  ```

  **Note**: E2E stability runs use `--workers=1` to simulate CI-like serial execution and catch concurrency-related flakiness.

  If any run fails, the fix is **insufficient** — the test is still flaky:
  1. Do NOT add retries, increase timeouts, wrap in try/catch, add sleeps, or mark as skipped
  2. Investigate the root cause using testing_overview.md rules:
     - Start from known state — reset filters, clear DB state between tests (Rule 1)
     - Point-in-time checks → use `expect(locator)` auto-waiting assertions (Rule 4)
     - Missing hydration waits → wait for data-dependent element before interacting (Rule 18)
     - Stacked route mocks → `page.unroute()` before `page.route()` (Rule 10)
     - Shared mutable state → `test.describe.configure({ mode: 'serial' })` (Rule 13)
     - Missing POM waits → POM methods must wait after actions (Rule 12)
     - `networkidle` usage → use specific element/response waits (Rule 9)
  3. Scan the diff for anti-patterns:
     ```bash
     git diff | grep -E 'waitForTimeout|new Promise.*setTimeout|setTimeout.*[0-9]{4}|\.sleep\(|\.skip\(|retries:\s*[1-9]|test\.fixme'
     ```
     If any anti-pattern found, automatically rework the fix — do not ask user.
  4. After reworking, return to Step 8d-5 (targeted verify)
  5. If 3+ rework iterations (within Step 8d-6 specifically) fail to stabilize the test, THEN escalate to user:
     - AskUserQuestion: "Test [name] remains flaky after 3 fix attempts. Root cause appears to be [diagnosis]. Options?"
     - Options: "Continue investigating" / "Skip this test and note in PR" / "Abort"

  **Step 8d-7: Full verify — GATE**
  Re-run ALL local checks: Step 4 (Run All Non-E2E Checks) + Step 5 (Run E2E Tests, including evolution if applicable).
  **HARD GATE**: All checks must pass. If any fail, return to Step 8d-4 for the new failures.

  **Step 8d-8: Push**
  ```bash
  git add -A
  git commit -m "fix: address CI failures (iteration N)"
  git push
  ```
  Backup push (non-fatal). Return to Step 8a (wait 30s, re-watch).

- [x] Add **"Keep monitoring until CI passes"** guidance to `/finalize` Step 8:

  **Persistence rule**: The CI monitor loop (Steps 8a→8b→8c→8d→8a) MUST keep running until all CI checks pass (exit code 0 from `gh pr checks --watch`). Do NOT stop monitoring or leave the PR in a failing state. The only acceptable exit conditions are:
  1. **All CI checks pass** — proceed to Step 8e (success)
  2. **User explicitly chooses "Abort"** — only offered after 5+ failed iterations or for pre-existing failures in Step 8d-3

  After 5 failed iterations, the AskUserQuestion options should be:
  - "Continue trying" (default, recommended) — reset counter and keep going
  - "Abort monitoring" — stop and leave PR for manual review

  Do NOT treat 5 iterations as a hard stop. The default expectation is to keep fixing and retrying until CI is green.

- [x] Write equivalent Step 6.2d for `/mainToProd` with the same 8 sub-steps (adapted for mainToProd's step numbering: Step 4 (Run All Non-E2E Checks) + Step 4.5 (Run E2E Tests) for full verify)

- [x] Add the same **"Keep monitoring until CI passes"** persistence rule to `/mainToProd` Step 6.2:

  The CI monitor loop (Steps 6.2a→6.2b→6.2c→6.2d→6.2a) MUST keep running until all CI checks pass. Same exit conditions and 5-iteration soft checkpoint as /finalize above.

### Phase 3: Add Pre-Existing Detection to Local Test Runs (Step 4)

The pre-existing detection from Phase 2 (Step 8d-2/8d-3) also needs to apply during the initial local test runs, not just CI retry.

**Files:** `.claude/commands/finalize.md` (Step 4 failure handling), `.claude/commands/mainToProd.md` (Step 4 failure handling)

Currently both say: "Fix ALL issues at once (regardless of whether they originated from this branch or pre-existed)"

- [x] Replace `/finalize` Step 4 failure handling with:
  1. When any check fails, identify which test files failed
  2. Run same pre-existing classification as Phase 2 Step 8d-2 (check main's CI status)
  3. If pre-existing failures found, surface to user via AskUserQuestion (same options as Step 8d-3)
  4. For non-pre-existing failures: fix, then run targeted verify (same as 8d-5), then stability check (same as 8d-6), then full verify
- [x] Add same to `/mainToProd` Step 4 failure handling

### Phase 4: Fix `gh pr checks --json` References

**Files:** `.claude/commands/finalize.md` (Step 8c), `.claude/commands/mainToProd.md` (Step 6.2c)

- [x] In `/finalize` Step 8c, replace `gh pr checks --json name,bucket,link,state` with:
  ```bash
  # Get CI run IDs for this PR's latest commit (may have multiple workflows)
  HEAD_SHA=$(git rev-parse HEAD)
  BRANCH=$(git branch --show-current)
  
  # List all runs for this branch, get the latest
  RUNS=$(gh run list --branch "$BRANCH" --limit 5 --json databaseId,name,conclusion,status 2>/dev/null || echo "[]")
  
  # Display structured summary
  echo "$RUNS" | jq -r '.[] | "\(.conclusion // .status)\t\(.name)"'
  
  # Extract failed run IDs
  FAILED_RUN_IDS=$(echo "$RUNS" | jq -r '.[] | select(.conclusion == "failure") | .databaseId' || true)
  ```
  **Note**: Uses `--branch` instead of `--commit` to catch all runs. If `RUNS` is empty or `[]`, display "No CI runs found for branch" and re-watch via Step 8b.
- [x] Apply same fix to `/mainToProd` Step 6.2c
- [x] Keep `gh pr checks --watch` (this works fine — only `--json` is broken)

### Phase 5: Update Documentation

- [x] Update `docs/docs_overall/testing_overview.md` "E2E Tests in Skill Workflows" table (~line 312):
  Change `/finalize` row from:
  ```
  | `/finalize` | Critical (`@critical`) always runs. Evolution (`@evolution`) runs if `evolution/` files changed. | `--e2e` adds full suite | ~1.5 min (critical) + ~3 min (evolution, conditional) |
  ```
  (Currently the table says evolution is conditional but finalize.md does NOT run it — this change makes the doc match the new behavior)
- [x] Update `docs/docs_overall/testing_overview.md` "Check Parity: Local vs CI" table (~line 297):
  Add evolution E2E row for local /finalize:
  ```
  | E2E Evolution | `test:e2e:evolution` (if `evolution/` changed) | `test:e2e:evolution` (if evolution path) | included in full suite |
  ```
- [x] Add a note to the "E2E Tests in Skill Workflows" section: "Both `/finalize` and `/mainToProd` enforce local-first CI retry: after any CI failure, specific failing tests must pass locally before pushing again."
- [x] Also fix mainToProd.md `npm run test:unit` (line 84) to `npm run test` — this is a pre-existing bug (package.json has no `test:unit` script)

## Testing

### Unit Tests
- [x] N/A — changes are to markdown instruction files, not code

### Integration Tests
- [x] N/A — no code changes

### E2E Tests
- [x] N/A — no code changes

### Manual Verification
- [x] Run `/finalize` on a branch with evolution file changes → verify it runs `test:e2e:evolution` (verified: EVOLUTION_PATHS + test:e2e:evolution at finalize.md:704-711)
- [x] Run `/finalize` on a branch with non-evolution changes → verify it does NOT run evolution E2E (verified: gated by EVOLUTION_CHANGED non-empty check)
- [x] Simulate a CI failure during `/finalize` → verify it parses specific failing tests, runs them locally first, then runs full suite (verified: Steps 8d-1→8d-5→8d-7 at finalize.md:959-1076)
- [x] Verify pre-existing failure detection works when main's CI is red (verified: MAIN_STATUS check + PRE_EXISTING comparison at finalize.md:989-1016)
- [x] Run `/mainToProd` and simulate CI failure → verify same targeted verification flow (verified: Steps 6.2d-1→6.2d-5→6.2d-7 at mainToProd.md:232-296)

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes

### B) Automated Tests
- [x] N/A — changes are instruction files only. Verification is manual by running the skills.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/docs_overall/testing_overview.md` — update "E2E Tests in Skill Workflows" table and "Check Parity" table to reflect evolution E2E in /finalize
- [x] `docs/feature_deep_dives/testing_setup.md` — no changes needed (test commands unchanged)
- [x] `docs/docs_overall/environments.md` — no changes needed (CI workflows unchanged)
- [x] `docs/docs_overall/debugging.md` — no changes needed
- [x] `docs/feature_deep_dives/debugging_skill.md` — no changes needed

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

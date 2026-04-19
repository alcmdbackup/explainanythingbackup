---
description: Rebase off remote main, simplify code, run code review, run all checks (lint/typecheck/build/unit/ESM/integration/E2E critical), update docs, fix issues, commit, create PR, and monitor CI until all checks pass
argument-hint: [--e2e]
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, AskUserQuestion, Task
---

# Finalize Branch for PR

Complete the current branch work by rebasing, running all checks, fixing issues, and creating a PR.

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status --short`
- Remote tracking: !`git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "No upstream set"`

## Arguments

- `--e2e`: Include the full E2E suite in addition to E2E critical tests (optional, default: critical only)

The argument passed is: `$ARGUMENTS`

## Workflow

Execute these steps in order. If any step fails, fix the issue before proceeding:

### Step 0: Verification-First Gate

Run the plan's verification steps (tests + Playwright) BEFORE any other finalization work. This is a hard gate — finalization cannot proceed if verification fails.

**Step 0: Locate the planning file**

Derive the plan file path from the current branch name:

```bash
BRANCH=$(git branch --show-current)
BRANCH_TYPE="${BRANCH%%/*}"
PROJECT_NAME="${BRANCH#*/}"
```

Try these paths in order, use the first that exists:
1. `docs/planning/${BRANCH_TYPE}/${PROJECT_NAME}/_planning.md` (modern with type folder)
2. `docs/planning/${PROJECT_NAME}/_planning.md` (modern flat)
3. `docs/planning/${PROJECT_NAME}/${PROJECT_NAME}_planning.md` (legacy)

Store as `$PLAN_FILE`. If none found → display a warning ("No planning file found — skipping verification and plan assessment") and proceed to Step 2.

**Step 0a: Read Verification section**

Read the planning doc and extract the `## Verification` section. Identify:
- Automated test commands/file paths (unit, integration, E2E)
- Playwright verification specs (if any)

If no Verification section found → warn "No Verification section in plan — skipping verification gate" and proceed to Step 1.

**Step 0b: Run automated tests**

Execute each test listed in the Verification section:
- Unit tests: `npm run test` (or specific grep/file path from plan)
- Integration tests: `npm run test:integration` (or specific grep/file path from plan)
- E2E tests: `npm run test:e2e:critical` (or specific spec file from plan)

Collect pass/fail results for each.

**Step 0c: Run Playwright verification (if applicable)**

If plan includes Playwright verification items (UI changes):

1. Ensure local server is running via `./docs/planning/tmux_usage/ensure-server.sh` (per CLAUDE.md — do NOT use `npm run dev` directly)
2. Wait up to 60 seconds for health check:
   ```bash
   curl -sf http://localhost:3000 --max-time 5 --retry 12 --retry-delay 5
   ```
3. Run ONLY the verification-relevant Playwright specs from the plan:
   ```bash
   npx playwright test <spec-file> --headed
   ```
   Do NOT run the full E2E suite — only specs listed in the Verification section.
4. If server fails to start → report error and HARD BLOCK.

**Step 0d: Verification results**

Display verification results summary:
```
Verification Gate
──────────────────────────────────────
Unit tests:        ✓ PASSED / ✗ FAILED
Integration tests: ✓ PASSED / ✗ FAILED
E2E tests:         ✓ PASSED / ✗ FAILED / ⊘ N/A
Playwright:        ✓ PASSED / ✗ FAILED / ⊘ N/A
──────────────────────────────────────
```

If any verification fails → **HARD BLOCK**. Use AskUserQuestion:
- Question: "Verification failed. Finalization cannot proceed with failing verification."
- Options:
  1. "Fix failures and retry" — abort finalization, user fixes and re-runs /finalize
  2. "Abort finalization" — stop entirely

**Step 0e**: Only after ALL verification passes, proceed to Step 1.

### 1. Agent-Based Plan Assessment

Verify that the implementation plan was fully executed using 4 parallel Explore agents that semantically assess the code — not just check if files were touched.

Use `$PLAN_FILE` resolved in Step 0.

If no planning file was found in Step 0 → display a warning ("No planning file found — skipping plan assessment") and proceed to Step 2.

**Step 1b: Gather context for agents**

Run once in the main conversation:
```bash
BRANCH=$(git branch --show-current)
DIFF_FILES=$(git diff --name-only origin/main)
```

Read the planning file content to confirm it exists and is non-empty.

**Step 1b.5: Verify Plan Checkboxes**

Parse the planning doc for checkbox completion. **Code-fence aware**: skip lines inside ``` fenced blocks to avoid false positives on example checkbox syntax (track open/close fence state).

1. **Scan** for all `- [ ]` (unchecked) and `- [x]`/`- [X]` (checked) items outside code fences
2. **Display summary**:
   ```
   Plan Checkbox Verification
   ──────────────────────────────────────
   Total items:   N
   Checked:       N ✓
   Unchecked:     N ✗
   ──────────────────────────────────────
   ```
3. **If any unchecked items**: List each with its line number, then **HARD BLOCK** finalization:
   ```
   Unchecked items:
   - Line 42: [Phase 1] Add rollback plan section
   - Line 67: [Testing] Write integration test for auth flow
   ```
   Use AskUserQuestion:
   - Question: "N unchecked items found in planning doc. Finalization requires all items checked."
   - Options:
     1. "Grant exception and proceed" — log exception: "N unchecked items — exception granted by user"
     2. "Abort finalization to fix" — stop finalization
4. **If exception granted**: Record in finalization output and include in PR body: "N unchecked items — exception granted by user"
5. **If all checked**: Display "Plan checkboxes: ALL COMPLETE ✓" → proceed

This check runs BEFORE Step 1c (4 Explore agents) for fail-fast behavior.

**Step 1c: Launch 4 Explore agents in parallel**

All 4 MUST be launched in a SINGLE message with 4 Task tool calls. Each uses `subagent_type: "Explore"`.

**Agent 1: Implementation Completeness**
```
You are assessing whether a project's implementation plan was fully executed.

PLANNING FILE: $PLAN_FILE
FILES CHANGED (git diff --name-only origin/main):
$DIFF_FILES

YOUR PERSPECTIVE: Implementation Completeness

Instructions:
1. Read the planning file at the path above
2. For each phase in the plan, identify the key deliverables (files to create/modify, features to implement)
3. For each deliverable, read the actual changed file to verify the planned work was done — not just that the file was touched
4. Only report CRITICAL gaps — things that were planned but clearly not implemented

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "implementation_completeness",
  "critical_gaps": ["Each string describes one planned item that was NOT implemented"],
  "summary": "1-2 sentence overall assessment"
}

If all planned work appears complete, return an empty critical_gaps array.
```

**Agent 2: Architecture & Patterns**
```
You are assessing whether code changes follow the project's established patterns.

PLANNING FILE: $PLAN_FILE
FILES CHANGED (git diff --name-only origin/main):
$DIFF_FILES

YOUR PERSPECTIVE: Architecture & Patterns

Instructions:
1. Read the planning file to understand intended architecture
2. Read the changed files and check:
   - Do new services follow the existing service pattern? (see src/lib/services/ for examples)
   - Do new actions use the withLogging + serverReadRequestId wrapper pattern?
   - Are Zod schemas used for new data structures?
   - Are imports/exports consistent with existing modules?
3. Only report CRITICAL deviations — patterns that will cause bugs or maintenance problems

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "architecture_patterns",
  "critical_gaps": ["Each string describes one critical pattern violation"],
  "summary": "1-2 sentence overall assessment"
}

If patterns are followed correctly, return an empty critical_gaps array.
```

**Agent 3: Test Coverage**
```
You are assessing whether appropriate tests were added for the changes.

PLANNING FILE: $PLAN_FILE
FILES CHANGED (git diff --name-only origin/main):
$DIFF_FILES

YOUR PERSPECTIVE: Test Coverage

Instructions:
1. Read the planning file's "Testing" section to understand planned tests
2. Check the diff for test files:
   - Unit tests: *.test.ts / *.test.tsx files colocated with source
   - Integration tests: src/__tests__/integration/*.integration.test.ts
   - E2E tests: src/__tests__/e2e/specs/*.spec.ts
3. For each test file found, read it to verify test scenarios match what was planned
4. Only report CRITICAL gaps — missing test types or planned scenarios with no coverage

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "test_coverage",
  "critical_gaps": ["Each string describes one missing test or test type"],
  "summary": "1-2 sentence overall assessment"
}

If test coverage matches the plan, return an empty critical_gaps array.
```

**Agent 4: Documentation & Integration**
```
You are assessing whether documentation was updated and new code integrates properly.

PLANNING FILE: $PLAN_FILE
FILES CHANGED (git diff --name-only origin/main):
$DIFF_FILES

YOUR PERSPECTIVE: Documentation & Integration

Instructions:
1. Read the planning file's "Documentation Updates" section
2. Check if listed doc files appear in the diff
3. For any new modules, verify they are properly imported where needed
4. Check that new exports are consumed (no dead code introduced)
5. Only report CRITICAL gaps — missing doc updates that were explicitly planned, or broken integrations

YOU MUST respond with ONLY this JSON structure:
{
  "perspective": "documentation_integration",
  "critical_gaps": ["Each string describes one critical doc or integration gap"],
  "summary": "1-2 sentence overall assessment"
}

If docs and integration look complete, return an empty critical_gaps array.
```

**Step 1d: Aggregate and report**

After all 4 agents complete, collect all `critical_gaps` arrays. If any agent response contains text around JSON, extract the JSON block (look for `{...}`).

**If no gaps (all arrays empty)**:
```
Plan Assessment — PASSED
──────────────────────────────────────
4 agents assessed plan completeness:
  ✓ Implementation Completeness: [agent1.summary]
  ✓ Architecture & Patterns: [agent2.summary]
  ✓ Test Coverage: [agent3.summary]
  ✓ Documentation & Integration: [agent4.summary]

No critical gaps found. Proceeding to next step.
──────────────────────────────────────
```
→ Proceed to Step 2.

**If gaps found**:
```
Plan Assessment — Gaps Detected
──────────────────────────────────────
[Implementation] gap description
[Architecture] gap description
[Tests] gap description
[Docs] gap description
──────────────────────────────────────
```

Then use **AskUserQuestion** with:
- Question: "Plan assessment found N critical gap(s). How would you like to proceed?"
- Options:
  1. "Proceed anyway" — continue (gaps are intentional or deferred)
  2. "Stop to fix" — abort finalization

**Step 1e: Handle failures**

- If planning file not found → warn and skip to Step 2 (same as current behavior)
- If any agent returns invalid/unparseable response → report which agent failed, ask "Retry or proceed?"
- If agent response contains text around JSON → extract the JSON block (look for `{...}`)

### 2. Test Coverage Verification

Verify that appropriate test types were added for source code changes.

**Step 2a: Categorize changed files**

Run in main conversation:
```bash
# Source files changed (excluding tests, configs, docs, migrations)
git diff --name-only origin/main | grep -E '^src/.*\.(ts|tsx)$' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__tests__' | grep -v 'testing/'

# Unit tests changed
git diff --name-only origin/main | grep -E '\.(test)\.(ts|tsx)$' | grep -v '__tests__/integration' | grep -v '__tests__/e2e' | grep -v '\.esm\.test\.'

# Integration tests changed (only those under __tests__/integration/)
git diff --name-only origin/main | grep -E '__tests__/integration/.*\.integration\.test\.(ts|tsx)$'

# E2E tests changed
git diff --name-only origin/main | grep -E '__tests__/e2e/specs/.*\.spec\.ts$'
```

**Step 2b: Report test presence**

Display a summary table:

```
Test Coverage Verification
──────────────────────────────────────
Source files changed: N
Unit tests:          N files  [✓ FOUND / ✗ MISSING]
Integration tests:   N files  [✓ FOUND / ✗ MISSING]
E2E tests:           N files  [✓ FOUND / ✗ MISSING]
──────────────────────────────────────
```

**Step 2c: Decision**

If **all 3 test types present**: Display "Test coverage verification PASSED" → proceed to Step 3.

If **any test type missing**: Use **AskUserQuestion** with:
- Question: "Test coverage verification found missing test types: [list]. How would you like to proceed?"
- Options:
  1. "Proceed anyway" — not all changes need all test types
  2. "Stop to fix" — user wants to add missing tests

**Edge case**: If no source files changed (docs-only, config-only), skip test verification entirely with message: "No source files changed — skipping test verification."

### 2.5. Commit Pending Changes and Verify Clean Working Tree

Before rebasing, ensure all changes are committed so the rebase doesn't fail on dirty files.

**Step 2.5a: Check for uncommitted changes:**
```bash
git status --porcelain
```

**Step 2.5b: If output is empty**: Display "Working tree clean ✓" → proceed to Step 3.

**Step 2.5c: If files remain**, categorize them:

1. **Sensitive files** (`.env*`, `*.key`, `*.pem`, `*secret*`, `*credential*`, `*password*`): Always prompt before committing.
2. **Uncertain files** (build artifacts, temp files, logs, caches — e.g. `node_modules/`, `.next/`, `dist/`, `*.log`, `*.tmp`, `*.cache`): Prompt once with a summary.
3. **Normal files**: Commit without prompting.

**For sensitive files**, use **AskUserQuestion** per file:
- Question: "Sensitive file `[filename]` is uncommitted. What should I do?"
- Options:
  1. "Commit it" — user confirms it's safe
  2. "Add to .gitignore" — append pattern and commit .gitignore
  3. "Abort finalization" — stop and let user handle manually

**For uncertain files**, use a single **AskUserQuestion** listing all of them:
- Question: "These files look like they may not belong in the repo:\n[list]\n\nWhat should I do?"
- Options:
  1. "Commit all" — include them in the commit
  2. "Gitignore all" — add patterns to .gitignore
  3. "Let me choose per-file" — prompt individually

**If the user does not respond or skips**, commit everything that isn't already gitignored.

**Then commit all remaining normal + approved files:**
```bash
git add -A
git commit -m "chore: commit pending changes before rebase"
```

**Step 2.5d: Verify clean:**
```bash
git status --porcelain
```

If empty → Display "Working tree clean ✓" → proceed to Step 3.
If still not clean → Display remaining files and abort finalization.

### 3. Fetch and Rebase

```bash
git fetch origin main
git rebase origin/main
```

### 3.1. Backup Push (main mirror)

YOU MUST run this step. It is non-fatal — if it fails, log the error and continue.

```bash
git -c http.postBuffer=524288000 push backup origin/main:refs/heads/main --no-verify
```

Verify exit code. If non-zero, display "WARNING: Backup push (main mirror) failed with exit code $?" and continue.

If rebase conflicts occur:
- Analyze the conflicts
- Fix each conflict file
- Run `git add <file>` for each fixed file
- Run `git rebase --continue`
- Repeat until rebase completes

### 3.5. Code Simplification

Simplify and refine changed code for clarity, consistency, and maintainability while preserving all functionality.

**Step 3.5a: Identify changed source files**

```bash
git diff --name-only origin/main | grep -E '^src/.*\.(ts|tsx)$' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__tests__' | grep -v 'testing/'
```

If no source files changed, display "No source files to simplify — skipping." → proceed to Step 3.7.

**Step 3.5b: Launch code simplification agents**

Split changed files into batches of up to 10 files. Launch one `general-purpose` Task agent per batch, all in parallel in a SINGLE message. Each agent receives:

```
You are an expert code simplification specialist. Analyze and simplify the following recently modified files.

FILES TO SIMPLIFY:
$FILE_LIST

RULES — follow all of these:

1. **Preserve Functionality**: Never change what the code does — only how it does it.

2. **Apply Project Standards**:
   - ES modules with proper import sorting
   - Explicit return type annotations for top-level functions
   - React components with explicit Props types
   - Use `logger.debug` (from server_utilities or client_utilities), never console.log
   - Consistent naming conventions

3. **Enhance Clarity**:
   - Reduce unnecessary complexity and nesting
   - Eliminate redundant code and abstractions
   - Improve variable and function names
   - Consolidate related logic
   - Remove comments that describe obvious code
   - Avoid nested ternaries — prefer switch/if-else
   - Choose clarity over brevity

4. **Do NOT**:
   - Create overly clever solutions
   - Combine too many concerns into single functions
   - Remove helpful abstractions
   - Prioritize fewer lines over readability
   - Create new files

For each file: read it, identify simplification opportunities, apply changes via Edit tool. Return a brief summary per file (or "No changes needed").
```

**Step 3.5c: Report and commit**

After all agents complete, display:
```
Code Simplification — Complete
──────────────────────────────────────
[agent summaries]
──────────────────────────────────────
```

If any files were modified:
```bash
git add -A
git commit -m "refactor: code simplification pass"
```

### 3.7. Code Review

Review changed code for bugs, logic errors, security vulnerabilities, and adherence to project conventions using confidence-based filtering.

**Step 3.7a: Gather review context**

```bash
DIFF_FILES=$(git diff --name-only origin/main)
```

Read the root `CLAUDE.md` and any `CLAUDE.md` files in directories containing changed files.

**Step 3.7b: Launch 5 parallel review agents**

Launch 5 `feature-dev:code-reviewer` Task agents in a SINGLE message. Pass each agent the `$DIFF_FILES` list and the `$CLAUDE_MD_CONTENTS`.

**Agent 1: CLAUDE.md Compliance**
```
Review code changes on this branch (vs origin/main) for compliance with CLAUDE.md instructions.

CLAUDE.md contents: $CLAUDE_MD_CONTENTS
Changed files: $DIFF_FILES

Read each changed file and check adherence to CLAUDE.md rules. Only flag clear violations — CLAUDE.md is guidance, not all instructions apply during review.

Return JSON: [{"file": "path", "line": N, "description": "...", "reason": "CLAUDE.md says: ..."}]
If no issues: []
```

**Agent 2: Bug Scan**
```
Review code changes on this branch (vs origin/main) for bugs and logic errors.

Changed files: $DIFF_FILES

Shallow scan for obvious bugs in the changes. Focus on large bugs, avoid nitpicks. Ignore likely false positives.

Return JSON: [{"file": "path", "line": N, "description": "...", "reason": "bug due to ..."}]
If no issues: []
```

**Agent 3: Historical Context**
```
Review code changes on this branch (vs origin/main) in light of git history.

Changed files: $DIFF_FILES

For key changed files, read git blame and recent history. Identify bugs visible only with historical context.

Return JSON: [{"file": "path", "line": N, "description": "...", "reason": "historical context: ..."}]
If no issues: []
```

**Agent 4: Code Comment Compliance**
```
Review code changes on this branch (vs origin/main) for compliance with code comments.

Changed files: $DIFF_FILES

Read TODOs, warnings, and constraints in comments of modified files. Verify changes comply with that guidance.

Return JSON: [{"file": "path", "line": N, "description": "...", "reason": "comment says: ..."}]
If no issues: []
```

**Agent 5: Security Review**
```
Review code changes on this branch (vs origin/main) for security vulnerabilities.

Changed files: $DIFF_FILES

Check for OWASP top 10, injection risks, auth bypasses, sensitive data exposure, insecure patterns.

Return JSON: [{"file": "path", "line": N, "description": "...", "reason": "security: ..."}]
If no issues: []
```

**Step 3.7c: Confidence scoring**

For each issue found across all agents, launch a parallel Haiku Task agent to score confidence (0–100):

```
Score this code review finding on a scale of 0-100:

Issue: $ISSUE_DESCRIPTION
File: $FILE_PATH  Line: $LINE
Reason: $REASON

Rubric:
  0: False positive, doesn't stand up to scrutiny
 25: Might be real, may also be false positive
 50: Verified real but may be a nitpick, not very important relative to overall PR
 75: Verified, important, will directly impact functionality or explicitly called out in CLAUDE.md
100: Definitely real, will happen frequently, evidence directly confirms

Read the actual file to verify. Return ONLY: {"score": N, "rationale": "..."}
```

**Step 3.7d: Filter and report**

Filter out issues with score < 80.

**If no high-confidence issues**:
```
Code Review — PASSED
──────────────────────────────────────
No high-confidence issues found. Checked for bugs, CLAUDE.md compliance,
security, code comments, and historical context.
──────────────────────────────────────
```
→ Proceed to Step 4.

**If issues found**:
```
Code Review — N Issue(s) Found
──────────────────────────────────────
1. [file:line] description (confidence: N/100)
   Reason: ...
──────────────────────────────────────
```

Use **AskUserQuestion**:
- Question: "Code review found N high-confidence issue(s). How would you like to proceed?"
- Options:
  1. "Fix issues" — fix each issue, then re-run from Step 3.7 (max 2 total iterations)
  2. "Proceed anyway" — continue to checks with noted issues
  3. "Stop to review manually" — abort finalization

**False positive guidance** (provided to all review agents in step 3.7b):

Fix ALL bugs encountered regardless of whether they were introduced by this branch or pre-existed.

Issues to IGNORE:
- Issues a linter, typechecker, or compiler would catch
- Pedantic nitpicks a senior engineer wouldn't call out
- General quality issues unless explicitly required in CLAUDE.md
- Issues silenced by lint-ignore comments
- Intentional functionality changes related to the broader change

### 4. Run All Non-E2E Checks (collect all failures)

<!-- SYNC-POINT: These checks use the same npm scripts as CI (ci.yml).
     CI adds flags: --changedSince (unit), --shard (E2E), --maxWorkers=2
     Finalize runs FULL suites for strict pre-PR verification.
     If you change check commands, update ci.yml and testing_overview.md -->

Run ALL 6 checks using parallel phases. Each phase MUST be a single Bash tool call (PIDs don't persist across calls):

**Phase A** — lint + typecheck + build in parallel (all independent):
```bash
npm run lint & LINT_PID=$!; npm run typecheck & TSC_PID=$!; npm run build & BUILD_PID=$!; wait $LINT_PID; LINT_RC=$?; wait $TSC_PID; TSC_RC=$?; wait $BUILD_PID; BUILD_RC=$?
```

**Phase B** — unit + ESM in parallel:
```bash
npm run test & UNIT_PID=$!; npm run test:esm & ESM_PID=$!; wait $UNIT_PID; UNIT_RC=$?; wait $ESM_PID; ESM_RC=$?
```

**Phase C** — integration (sequential, DB conflicts):
```bash
npm run test:integration; INT_RC=$?
```

Display results:
```
Check Results
──────────────────────────────────────
Lint:              ✓ PASSED / ✗ FAILED
TypeScript:        ✓ PASSED / ✗ FAILED
Build:             ✓ PASSED / ✗ FAILED
Unit Tests:        ✓ PASSED / ✗ FAILED
ESM Tests:         ✓ PASSED / ✗ FAILED
Integration Tests: ✓ PASSED / ✗ FAILED
──────────────────────────────────────
```

If any check failed:

1. **Classify failures**: Check if main's CI is also failing:
   ```bash
   MAIN_STATUS=$(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion -q '.[0].conclusion // "unknown"' 2>/dev/null || echo "unknown")
   ```
   If `MAIN_STATUS` is "failure", compare failing tests against main's failures (same approach as Step 8d-2). Tests failing on BOTH main and this branch are **pre-existing**.

2. **Surface pre-existing failures**: If pre-existing failures found, use **AskUserQuestion**:
   - Question: "These test failures also exist on main (pre-existing): [list]. How should I handle them?"
   - Options: "Fix them anyway" / "Skip pre-existing, fix only new failures" / "Abort"

3. **Fix** all applicable failing issues at once

4. **Targeted verify**: Run ONLY the specific failing tests locally with `--retries=0` to confirm the fix works. GATE: all must pass before proceeding.

5. **Stability check**: Run each previously-failing test 5 times (same protocol as Step 8d-6). If any run fails, investigate root cause — do NOT add retries/sleeps/skips.

6. **Full verify**: Re-run ALL 6 non-E2E checks (not just the ones that failed)

7. Repeat until all 6 pass

### 5. Run E2E Tests

Always run E2E critical tests — no flag required:

```bash
npm run test:e2e:critical
```

Fix any failures before proceeding.

Then check if evolution files changed and run evolution E2E if so:

```bash
EVOLUTION_PATHS="evolution|arena|strategy-resolution|manual-experiment|src/app/admin/quality/optimization/"
EVOLUTION_CHANGED=$(git diff --name-only origin/main | grep -E "$EVOLUTION_PATHS" || true)
```

If `EVOLUTION_CHANGED` is non-empty, ALSO run evolution E2E tests:

```bash
npm run test:e2e:evolution
```

Fix any failures before proceeding.

If `$ARGUMENTS` contains `--e2e`, ALSO run the full E2E suite after critical and evolution tests pass:

```bash
npm run test:e2e:full
```

### 6. Documentation Updates

Automatically update documentation based on code changes:

1. **Get changed files:**
   ```bash
   git diff --name-only origin/main
   ```

2. **Load mapping rules** from `.claude/doc-mapping.json`

3. **Match files to docs:**
   - For each changed file, check if it matches any pattern in mappings
   - If match found → add mapped doc(s) to update queue
   - If no match → continue to AI analysis

4. **AI Analysis for unmapped files:**
   - For files with no mapping match, analyze if the change is doc-worthy
   - Trivial changes (typos, formatting, small bug fixes) → skip
   - Meaningful changes → identify relevant doc and add to queue

5. **Evaluate `alwaysConsider` docs:**
   - For each doc in `alwaysConsider` (e.g., `architecture.md`), review all changes
   - Update if any changes affect the doc's scope

6. **Generate and apply updates:**
   - For each doc in the update queue:
     - Read current doc content
     - Read relevant code diffs
     - Generate updated content preserving existing structure
     - Apply edit using Edit tool

7. **Handle unmapped files with doc-worthy changes:**
   - Ask: "Add mapping rule for [file] → [doc] for future?"
   - If yes → append new mapping to `.claude/doc-mapping.json`

8. **Blocking behavior:**
   - If doc-worthy changes exist but updates failed → **STOP**
   - Display error and do not proceed to push/PR
   - Suggest manual intervention

### 6.5. Commit Changes

Commit all uncommitted changes (code fixes from checks + documentation updates) in one atomic commit:
```bash
git add -A
git commit -m "fix: address lint/type/test issues and update docs for PR"
```

If there are no uncommitted changes, skip this step.

### 6.6. Verify Clean Working Tree

Before pushing, ensure all files are either committed or gitignored.

**6.6a. Check for remaining files:**
```bash
git status --porcelain
```

**6.6b. If output is empty**: Display "Working tree clean ✓" → proceed to Step 7.

**6.6c. If files remain**, categorize them:

1. **Sensitive files** (`.env*`, `*.key`, `*.pem`, `*secret*`, `*credential*`, `*password*`): Always prompt before committing.
2. **Uncertain files** (build artifacts, temp files, logs, caches — e.g. `node_modules/`, `.next/`, `dist/`, `*.log`, `*.tmp`, `*.cache`): Prompt once with a summary.
3. **Normal files**: Commit without prompting.

**For sensitive files**, use **AskUserQuestion** per file:
- Question: "Sensitive file `[filename]` is uncommitted. What should I do?"
- Options:
  1. "Commit it" — user confirms it's safe
  2. "Add to .gitignore" — append pattern and commit .gitignore
  3. "Abort finalization" — stop and let user handle manually

**For uncertain files**, use a single **AskUserQuestion** listing all of them:
- Question: "These files look like they may not belong in the repo:\n[list]\n\nWhat should I do?"
- Options:
  1. "Commit all" — include them in the commit
  2. "Gitignore all" — add patterns to .gitignore
  3. "Let me choose per-file" — prompt individually

**If the user does not respond or skips**, commit everything that isn't already gitignored.

**Then commit all remaining normal + approved files:**
```bash
git add -A
git commit -m "chore: include remaining uncommitted files"
```

**6.6d. Verify clean:**
```bash
git status --porcelain
```

If empty → Display "Working tree clean ✓" → proceed to Step 7.
If still not clean → Display remaining files and abort finalization.

### 7. Push and Create PR

Write the push gate file so the push hook allows the push:
```bash
echo "{\"commit\":\"$(git rev-parse HEAD)\",\"skill\":\"finalize\",\"timestamp\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > .claude/push-gate.json
```

```bash
git push -u origin HEAD
```

### 7.1. Backup Push (branch mirror)

YOU MUST run this step. It is non-fatal — if it fails, log the error and continue.

```bash
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
```

Verify exit code. If non-zero, display "WARNING: Backup push (branch mirror) failed with exit code $?" and continue.

Then create a PR with a structured body summarizing the finalization results:

```bash
BRANCH=$(git branch --show-current)
PROJECT_NAME="${BRANCH#*/}"
```

```bash
gh pr create --base main --title "[Project] ${PROJECT_NAME}" --body "$(cat <<'EOF'
## Summary
[1-3 sentence description of what this branch accomplishes, derived from the planning file]

## Finalization Results

### Plan Assessment
[PASSED / N gaps noted — include agent summaries]

### Code Simplification
[N files simplified / No changes needed]

### Code Review
[PASSED / N issues found (confidence ≥80) — list any that were noted but proceeded with]

### Checks
- Lint: ✓
- TypeScript: ✓
- Build: ✓
- Unit Tests: ✓
- ESM Tests: ✓
- Integration Tests: ✓
- E2E Critical: ✓
- E2E Full: [✓ / skipped (no --e2e flag)]

### Documentation Updates
[List of docs updated, or "No updates needed"]

## Planning
- Folder: `docs/planning/${PROJECT_NAME}/`
- Research: `${PROJECT_NAME}_research.md`
- Plan: `${PROJECT_NAME}_planning.md`
- Progress: `${PROJECT_NAME}_progress.md`

---
🤖 Generated with [Claude Code](https://claude.ai/code)
EOF
)"
```

Replace all `[bracketed placeholders]` with actual results collected during the finalization steps. If a GitHub issue exists for this project, add `Closes #N` to the summary.

### 8. Monitor PR Checks

After PR creation, monitor CI checks until they all pass. If any fail, fix issues locally, push, and re-monitor.

**Step 8a: Wait for CI to start**

Wait 30 seconds for GitHub Actions to pick up the new PR:
```bash
sleep 30
```

**Step 8b: Watch checks until completion**

```bash
timeout 900 gh pr checks --watch
```

This blocks until all checks complete or 15 minutes elapse. Check the exit code:

| Exit Code | Meaning | Action |
|-----------|---------|--------|
| 0 | All checks passed | Proceed to Step 8e (success) |
| 1 | One or more checks failed | Proceed to Step 8c (diagnose) |
| 124 | Timeout (15 min elapsed) | Ask user: "CI timed out. Wait longer or abort?" |
| 8 | Checks still pending | Re-run `gh pr checks --watch` |

**Step 8c: Diagnose failures**

Get CI run details and failure logs:

```bash
# Get CI run IDs for this branch (may have multiple workflows)
BRANCH=$(git branch --show-current)
RUNS=$(gh run list --branch "$BRANCH" --limit 5 --json databaseId,name,conclusion,status 2>/dev/null || echo "[]")

# Display structured summary
echo "$RUNS" | jq -r '.[] | "\(.conclusion // .status)\t\(.name)"'

# Extract failed run IDs
FAILED_RUN_IDS=$(echo "$RUNS" | jq -r '.[] | select(.conclusion == "failure") | .databaseId' || true)
```

If `RUNS` is empty or `[]`, display "No CI runs found for branch" and return to Step 8b (re-watch).

Display a summary table:
```
PR Check Results
──────────────────────────────────────
✓ CI / Detect Changes
✓ CI / TypeScript Check
✗ CI / Unit Tests          ← FAILED
✓ CI / Lint
✗ CI / E2E Tests (Critical) ← FAILED
──────────────────────────────────────
```

Then get failure logs for each failed run:
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

**Step 8d: Gated CI retry flow**

This step has 8 sub-steps with 3 hard gates. **Never use `gh run rerun`** — always push new commits to trigger a full CI run.

**Step 8d-1: Parse failing tests from CI logs**
```bash
FAILED_SPECS=""
FAILED_TESTS=""
for run_id in $FAILED_RUN_IDS; do
  LOGS=$(gh run view "$run_id" --log-failed 2>&1 || true)
  
  # If --log-failed returned empty, fall back to full log
  if [ -z "$LOGS" ] || [ "$LOGS" = "No failed steps" ]; then
    LOGS=$(gh run view "$run_id" --log 2>&1 | tail -500 || true)
  fi
  
  # Playwright spec files
  SPECS=$(echo "$LOGS" | grep -oE 'src/__tests__/e2e/specs/[^ ]*\.spec\.ts' | sort -u || true)
  FAILED_SPECS="$FAILED_SPECS $SPECS"
  
  # Jest test files
  TESTS=$(echo "$LOGS" | grep -oE 'FAIL\s+[^ ]*\.test\.ts' | sed 's/FAIL\s*//' | sort -u || true)
  FAILED_TESTS="$FAILED_TESTS $TESTS"
done

# Deduplicate
FAILED_SPECS=$(echo "$FAILED_SPECS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
FAILED_TESTS=$(echo "$FAILED_TESTS" | tr ' ' '\n' | sort -u | grep -v '^$' || true)
```

If BOTH `FAILED_SPECS` and `FAILED_TESTS` are empty (could not parse test names from logs):
- Display: "Could not extract specific failing test names from CI logs. Will skip targeted verify and stability check, proceeding directly to full verify."
- Skip Steps 8d-5 and 8d-6, proceed to Step 8d-7 (full verify).

**Step 8d-2: Classify failures — pre-existing vs new**
```bash
MAIN_STATUS=$(gh run list --branch main --workflow ci.yml --limit 1 --json conclusion -q '.[0].conclusion // "unknown"' 2>/dev/null || echo "unknown")
```

If `MAIN_STATUS` is "unknown" or empty → skip pre-existing detection, treat all failures as new. Proceed to Step 8d-4.

If `MAIN_STATUS` is "success" → all failures are new. Proceed to Step 8d-4.

If `MAIN_STATUS` is "failure":
```bash
MAIN_RUN_ID=$(gh run list --branch main --workflow ci.yml --limit 1 --json databaseId -q '.[0].databaseId // empty' 2>/dev/null || true)
if [ -n "$MAIN_RUN_ID" ]; then
  MAIN_LOGS=$(gh run view "$MAIN_RUN_ID" --log-failed 2>&1 || true)
  MAIN_FAILED_SPECS=$(echo "$MAIN_LOGS" | grep -oE 'src/__tests__/e2e/specs/[^ ]*\.spec\.ts' | sort -u || true)
  MAIN_FAILED_TESTS=$(echo "$MAIN_LOGS" | grep -oE 'FAIL\s+[^ ]*\.test\.ts' | sed 's/FAIL\s*//' | sort -u || true)
  # Tests in BOTH branch failures and main failures = pre-existing
  PRE_EXISTING=$(comm -12 <(echo "$FAILED_SPECS $FAILED_TESTS" | tr ' ' '\n' | sort) <(echo "$MAIN_FAILED_SPECS $MAIN_FAILED_TESTS" | tr ' ' '\n' | sort) || true)
fi
```

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
- If test is flaky (passes locally, fails in CI or vice versa), follow the flakiness protocol in Step 8d-6

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

E2E stability runs use `--workers=1` to simulate CI-like serial execution and catch concurrency-related flakiness.

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
5. If 3+ rework iterations fail to stabilize the test, THEN escalate to user:
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
Backup push (non-fatal — YOU MUST run this step, but if it fails, log the error and continue):
```bash
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
```
Verify exit code. If non-zero, display "WARNING: Backup push failed with exit code $?" and continue.
Return to Step 8a (wait 30s, then re-watch).

**Persistence rule**: The CI monitor loop (Steps 8a→8b→8c→8d→8a) MUST keep running until all CI checks pass (exit code 0 from `gh pr checks --watch`). Do NOT stop monitoring or leave the PR in a failing state. The only acceptable exit conditions are:
1. **All CI checks pass** — proceed to Step 8e (success)
2. **User explicitly chooses "Abort"** — only offered after 5+ failed iterations or for pre-existing failures in Step 8d-3

After 5 failed iterations, use **AskUserQuestion**:
- "Continue trying" (default, recommended) — reset counter and keep going
- "Abort monitoring" — stop and leave PR for manual review

Do NOT treat 5 iterations as a hard stop. The default expectation is to keep fixing and retrying until CI is green.

**Step 8e: Success**

When all checks pass (exit code 0):

```
PR Checks — ALL PASSED
──────────────────────────────────────
✓ CI / Detect Changes
✓ CI / TypeScript Check
✓ CI / Lint
✓ CI / Unit Tests
✓ CI / Integration Tests (Critical)
✓ CI / E2E Tests (Critical)

Iterations: N (0 = first attempt passed)
──────────────────────────────────────
```

## Success Criteria

- Plan assessment passed (or user chose to proceed with gaps)
- Test coverage verification passed (or user chose to proceed)
- Code simplification pass completed on changed source files
- Code review passed with no high-confidence issues (or user chose to proceed)
- All checks pass (lint, tsc, build, unit, integration)
- E2E critical tests pass (always run)
- E2E full suite passes (if --e2e flag was provided)
- Branch is rebased on latest origin/main
- Documentation is updated for all doc-worthy changes
- Working tree is clean (verified by `git status --porcelain` returning empty)
- PR is created and URL is displayed
- PR CI checks all pass (or user chose to abort monitoring)

## Output

When complete, display:
1. Plan assessment result (passed / gaps noted)
2. Test coverage verification result (passed / missing types noted)
3. Code simplification summary (files simplified / no changes)
4. Code review result (passed / N issues found)
5. Summary of fixes made (if any)
6. All check results (pass/fail)
7. Documentation updates made (list of docs updated)
8. Working tree verification result (clean / N files handled)
9. PR URL
10. PR CI check results (all passed / N iterations / aborted)

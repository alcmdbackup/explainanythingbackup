---
description: Rebase off remote main, run all checks (lint/tsc/build/unit/integration), update docs, fix issues, commit, and create PR
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

- `--e2e`: Include E2E critical tests in the verification (optional, default: skip E2E)

The argument passed is: `$ARGUMENTS`

## Workflow

Execute these steps in order. If any step fails, fix the issue before proceeding:

### 1. Agent-Based Plan Assessment

Verify that the implementation plan was fully executed using 4 parallel Explore agents that semantically assess the code — not just check if files were touched.

**Step 1a: Locate the planning file**

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

If none found → display a warning ("No planning file found — skipping plan assessment") and proceed to Step 2.

**Step 1b: Gather context for agents**

Run once in the main conversation:
```bash
BRANCH=$(git branch --show-current)
DIFF_FILES=$(git diff --name-only origin/main)
```

Read the planning file content to confirm it exists and is non-empty.

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

### 3. Fetch and Rebase

```bash
git fetch origin main
git rebase origin/main
```

If rebase conflicts occur:
- Analyze the conflicts
- Fix each conflict file
- Run `git add <file>` for each fixed file
- Run `git rebase --continue`
- Repeat until rebase completes

### 4. Run Checks (fix issues as they arise)

Run each check. If it fails, fix the issues and re-run until it passes:

1. **Lint**: `npm run lint`
2. **TypeScript**: `npx tsc --noEmit`
3. **Build**: `npm run build`
4. **Unit Tests**: `npm run test:unit`
5. **Integration Tests**: `npm run test:integration`

### 5. E2E Tests (if --e2e flag provided)

If `$ARGUMENTS` contains `--e2e`:
- Run: `npm run test:e2e -- --grep @critical`
- Fix any failures before proceeding

### 6. Commit Changes

If there are uncommitted changes from fixes:
```bash
git add -A
git commit -m "fix: address lint/type/test issues for PR"
```

### 6.5. Documentation Updates

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

8. **Commit doc updates:**
   - If any doc updates were made, amend the previous commit or create new:
   ```bash
   git add docs/ .claude/doc-mapping.json
   git commit --amend --no-edit
   ```

9. **Blocking behavior:**
   - If doc-worthy changes exist but updates failed → **STOP**
   - Display error and do not proceed to push/PR
   - Suggest manual intervention

### 7. Push and Create PR

```bash
git push -u origin HEAD
```

Then create PR using:
```bash
gh pr create --base main --fill
```

Or if more context is needed, create with title and body describing the changes.

## Success Criteria

- Plan assessment passed (or user chose to proceed with gaps)
- Test coverage verification passed (or user chose to proceed)
- All checks pass (lint, tsc, build, unit, integration)
- E2E critical tests pass (if --e2e flag was provided)
- Branch is rebased on latest origin/main
- Documentation is updated for all doc-worthy changes
- PR is created and URL is displayed

## Output

When complete, display:
1. Plan assessment result (passed / gaps noted)
2. Test coverage verification result (passed / missing types noted)
3. Summary of fixes made (if any)
4. All check results (pass/fail)
5. Documentation updates made (list of docs updated)
6. PR URL

# Use Explore Agents In Finalize Plan

## Background

The `/finalize` command (`.claude/commands/finalize.md`) automates the branch finalization workflow: plan verification, rebase, lint/tsc/build/test checks, documentation updates, and PR creation. Its current Step 1 performs a shallow text-based comparison of planned file paths against `git diff --name-only`, which can only detect if files were touched — not whether the planned intent was fulfilled. The project already has a proven multi-agent pattern in `/plan-review` that launches parallel Task agents with structured JSON output and aggregation logic.

## Problem

The current plan verification is surface-level: it extracts file paths from the planning document and checks if they appear in the git diff. A file that was trivially touched (e.g., a comment added) passes the same as one where a full feature was implemented. There is also no verification that appropriate test types (unit, integration, E2E) were added for new code. These two gaps mean `/finalize` can create PRs for incomplete work without flagging it.

## Options Considered

### Option A: Enhance existing Step 1 with smarter diffing
- Keep sequential flow, add `git diff --stat` and heuristics for file size changes
- Pro: Minimal change, no new dependencies
- Con: Still no semantic understanding; heuristics are brittle

### Option B: Launch 4 Explore agents for plan assessment (CHOSEN)
- Replace Step 1 with 4 parallel Explore agents that read both the plan and actual code
- Add a new Step 2 for automated test coverage verification
- Pro: Deep semantic assessment, context-efficient (subagents don't consume main context), proven pattern from `/plan-review`
- Con: Slightly longer wall-clock time for Step 1 (agents run in parallel but each needs to read files)

### Option C: Use Plan agents instead of Explore agents
- Same as Option B but with `subagent_type=Plan`
- Con: Plan agents are designed for document review, not code exploration. Explore agents can navigate the codebase with Grep/Glob/Read which is what's needed.

## Phased Execution Plan

### Phase 1: Add `Task` to allowed-tools and renumber steps

**Files modified:**
- `.claude/commands/finalize.md` (frontmatter only)

**Changes:**
1. Add `Task` to the `allowed-tools` frontmatter line:
   ```yaml
   allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, AskUserQuestion, Task
   ```
2. Renumber existing steps: current 1→(will be replaced), 2→3, 3→4, 4→5, 5→6, 5.5→6.5, 6→7

**Why `Task` must be in finalize.md's frontmatter**: Unlike `/plan-review` which is a command file with NO frontmatter (it inherits permissions from its companion `.claude/skills/plan-review/SKILL.md`), `/finalize` is a standalone command with an explicit `allowed-tools` whitelist. When a command declares `allowed-tools`, only listed tools are available. Since `finalize.md` already declares a whitelist, `Task` must be added to it. This is the correct approach — `Task` enables launching subagents with any `subagent_type` (including `Explore`).

**Testing:**
- Manual: invoke `/finalize` on a test branch and verify the Task tool calls are permitted

---

### Phase 2: Write new Step 1 — Agent-Based Plan Assessment

**Files modified:**
- `.claude/commands/finalize.md` (replace current Step 1 content)

**New Step 1 structure:**

#### Step 1a: Locate planning file (UNCHANGED)
Keep existing logic: derive path from branch name, try 3 paths, warn and skip if not found.

#### Step 1b: Gather context for agents
Run once in the main conversation:
```bash
BRANCH=$(git branch --show-current)
DIFF_FILES=$(git diff --name-only origin/main)
```
Read the planning file content.

**Security note**: The `DIFF_FILES` output is embedded directly into agent prompts. File paths are treated as trusted input since `/finalize` runs in a single-user dev context on the developer's own repository. No sanitization is applied.

#### Step 1c: Launch 4 Explore agents in parallel

All 4 MUST be launched in a SINGLE message with 4 Task tool calls.

Each Task tool call uses these parameters:
- `subagent_type`: `"Explore"`
- `description`: Short label (e.g., "Assess implementation completeness")
- `prompt`: The full agent prompt (see below)

**Explore agent tool constraints**: Explore agents have access to Read, Grep, Glob, and LS tools — they can navigate and read the codebase but cannot Edit, Write, or run Bash commands. This is why agents can only _report_ gaps, not fix them. The main finalize conversation handles all decisions and actions based on agent reports.

Each agent prompt includes:
- The planning file path (so agent can Read it)
- The `DIFF_FILES` output (so agent doesn't need Bash)
- The agent's specific perspective
- The JSON output template

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

#### Step 1d: Aggregate and report

After all 4 agents complete, aggregate results:

```
ALL_GAPS = agent1.critical_gaps + agent2.critical_gaps + agent3.critical_gaps + agent4.critical_gaps
```

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

Then use **AskUserQuestion**:
- "Plan assessment found N critical gap(s). How would you like to proceed?"
- Option 1: "Proceed anyway" — continue (gaps are intentional or deferred)
- Option 2: "Stop to fix" — abort finalization

#### Step 1e: Handle failures

- If planning file not found → warn and skip to Step 2 (same as current behavior)
- If any agent returns invalid/unparseable response → report which agent failed, ask "Retry or proceed?"
- If agent response contains text around JSON → extract the JSON block (look for `{...}`)

---

### Phase 3: Write new Step 2 — Test Coverage Verification

**Files modified:**
- `.claude/commands/finalize.md` (add new Step 2 section)

**New Step 2 structure:**

#### Step 2a: Categorize changed files

Run in main conversation:
```bash
# Source files changed (excluding tests, configs, docs, migrations)
git diff --name-only origin/main | grep -E '^src/.*\.(ts|tsx)$' | grep -v '\.test\.' | grep -v '\.spec\.' | grep -v '__tests__' | grep -v 'testing/'

# Unit tests changed
git diff --name-only origin/main | grep -E '\.(test)\.(ts|tsx)$' | grep -v '__tests__/integration' | grep -v '__tests__/e2e' | grep -v '\.esm\.test\.'

# Integration tests changed (only those under __tests__/integration/ — matches what npm run test:integration runs)
# Note: Colocated *.integration.test.tsx files (e.g., in src/editorFiles/) run under the unit test runner,
# not the integration test runner, per jest.integration.config.js testMatch patterns.
git diff --name-only origin/main | grep -E '__tests__/integration/.*\.integration\.test\.(ts|tsx)$'

# E2E tests changed
git diff --name-only origin/main | grep -E '__tests__/e2e/specs/.*\.spec\.ts$'
```

#### Step 2b: Report test presence

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

#### Step 2c: Decision

**If all 3 test types present**: Display "Test coverage verification PASSED" → proceed to Step 3.

**If any test type missing**: Use **AskUserQuestion**:
- "Test coverage verification found missing test types: [list]. How would you like to proceed?"
- Option 1: "Proceed anyway" — not all changes need all test types (e.g., a utility function may only need unit tests)
- Option 2: "Stop to fix" — user wants to add missing tests

**Note**: The threshold is informational, not strict. Many legitimate changes only warrant unit tests. The prompt exists to make the developer consciously acknowledge which test types they're skipping, not to mandate all 3 for every PR.

**Edge case**: If no source files changed (docs-only, config-only), skip test verification entirely with message: "No source files changed — skipping test verification."

---

### Phase 4: Renumber remaining steps in the document

**Files modified:**
- `.claude/commands/finalize.md` (renumber headers and references)

**Changes:**
- Current Step 2 (Fetch and Rebase) → Step 3
- Current Step 3 (Run Checks) → Step 4
- Current Step 4 (E2E Tests) → Step 5
- Current Step 5 (Commit Changes) → Step 6
- Current Step 5.5 (Documentation Updates) → Step 6.5
- Current Step 6 (Push and Create PR) → Step 7
- Update Success Criteria section to reference new step numbers
- Update Output section to include plan assessment and test verification results

---

## Testing

### Manual verification
1. Create a test branch with known gaps (e.g., missing integration test, incomplete planned feature)
2. Run `/finalize` and verify:
   - 4 agents launch in parallel
   - Agents correctly identify the known gaps
   - Gap report is displayed with correct formatting
   - AskUserQuestion presents proceed/stop options
   - "Proceed anyway" continues to Step 3 (rebase)
   - "Stop to fix" aborts

3. Run `/finalize` on a branch with complete work and verify:
   - All agents report no gaps
   - "PASSED" message displays
   - Test verification shows all 3 test types present
   - Flow continues to rebase without user intervention

4. Run `/finalize` on a docs-only branch and verify:
   - Planning file not found → skip message
   - No source files → test verification skipped
   - Proceeds directly to rebase

5. Run `/finalize` on a branch with a minimal/empty planning file (no phases, no testing section) and verify:
   - Agents handle gracefully (return empty critical_gaps or note the plan is minimal)
   - No crashes from trying to parse nonexistent plan sections

6. If an agent returns malformed output (can be simulated by temporarily breaking a prompt), verify:
   - Error is reported with which agent failed
   - User is asked "Retry or proceed?"
   - "Proceed" continues to Step 2

### No automated tests needed
This is a Claude Code skill file (markdown), not application code. It's tested by invoking the skill.

## Rollback Plan

If the new Steps 1-2 consistently fail (e.g., Task tool unavailable, agents return unparseable responses):

1. **Immediate**: The existing `AskUserQuestion` "Proceed anyway" option in both steps allows skipping past failures without blocking the rest of finalize.
2. **Revert**: `git revert <commit>` the commit that modified `finalize.md` to restore the original Step 1 behavior.
3. **Pre-change reference**: The original Step 1 content is preserved in git history. Run `git show HEAD~1:.claude/commands/finalize.md` to view.

The old Step 1 (text-based diff comparison) is deliberately NOT kept as a commented-out fallback in the file — it would add clutter. Git history serves as the rollback mechanism.

## Documentation Updates

- `.claude/commands/finalize.md` — The primary file being modified (the skill itself)
- No changes to `docs/docs_overall/` or `docs/feature_deep_dives/` — the skill is self-documenting

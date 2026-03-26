# Workflow Improvements Plan

## Background
- /initialize - Review docs being reviewed at end of doc discovery, before reading any file contents
- /plan-update create this. Plan file must have checkboxes for all items - add to template and check anytime after updating plan draft. Plan must include complete tests.
- /plan-review - make sure all discussions are captured in the plan, ask if unsure
- /finalize must verify that all checkboxes are marked as complete in plan file

## Requirements (from GH Issue #TBD)
- /initialize - Review docs being reviewed at end of doc discovery, before reading any file contents
- /plan-update create this. Plan file must have checkboxes for all items - add to template and check anytime after updating plan draft. Plan must include complete tests.
- /plan-review - make sure all discussions are captured in the plan, ask if unsure
- /finalize must verify that all checkboxes are marked as complete in plan file
- Any plan must have verification: A) Playwright verification on local server for UI changes, and/or B) unit/integration/E2E tests. Plans without verification must not be accepted.
- Enforce verification requirements on /plan-update and /plan-review
- /finalize must start by running the plan's verification steps (tests + Playwright) before any other finalization work

## Problem
The project workflow skills lack checkbox-based completion tracking and verification enforcement. Planning docs are created without checkboxes, review discussions are lost between iterations, finalization has no mechanism to verify all planned work is complete, and there's no requirement that plans include concrete verification steps (tests or Playwright). This leads to plans that can't be tracked, review rationale that disappears, PRs that may ship incomplete or unverified work, and UI changes that aren't visually confirmed. A new /plan-update command is needed to bridge the gap between planning and execution, and verification must be enforced across the lifecycle.

## Options Considered
- [ ] **Option A: Minimal — Only add /finalize checkbox check**: Low effort but doesn't solve root cause (plans lack checkboxes)
- [x] **Option B: Full lifecycle — All 4 skills**: More work but creates a coherent checkbox-based tracking system from init→plan→review→finalize
- [ ] **Option C: External tracking tool**: Use GitHub issues/project boards instead of in-doc checkboxes — rejected because it fragments tracking away from the plan

## Phased Execution Plan

### Phase 1: Update /initialize planning template with checkboxes and verification
- [ ] Edit `.claude/commands/initialize.md` step 5 (planning template) to use checkbox format for all actionable sections
- [ ] Update template sections: Options Considered, Phased Execution Plan, Testing, Documentation Updates — all items get `- [ ]` prefix
- [ ] Add Testing subsections to template: Unit Tests, Integration Tests, E2E Tests, Manual Verification — each with checkbox items and file path placeholders
- [ ] Add "## Verification" section to planning template with two required subsections: A) Playwright verification (required for UI changes — run on local server), B) Automated tests (unit/integration/E2E with specific file paths)
- [ ] Add "## Review & Discussion" section placeholder at end of planning template
- [ ] Defer doc reading in step 2.6: Remove "Read all manually tagged docs" line, store paths in `MANUAL_DOCS` list instead (do NOT read yet). The Explore agent in step 2.7 does not need doc contents — it only reads first 30 lines independently.
- [ ] Defer doc reading in step 2.7: Remove "Read all confirmed docs" line, store paths in `AUTO_DOCS` list instead (do NOT read yet)
- [ ] Add new step 2.8 "Final Doc Review": Merge `MANUAL_DOCS` + `AUTO_DOCS` into unified `RELEVANT_DOCS` list (deduplicated). Present full list via AskUserQuestion (multiSelect with all pre-checked). User can deselect any. THEN read all remaining confirmed docs. Data flow: step 2.6 produces `MANUAL_DOCS` → step 2.7 produces `AUTO_DOCS` → step 2.8 merges, confirms, reads → step 3 uses final `RELEVANT_DOCS`

### Phase 2: Create /plan-update command
- [ ] Create new file `.claude/commands/plan-update.md` with frontmatter:
  ```yaml
  ---
  description: Scan planning doc for checkbox completeness, enforce verification requirements, and update checkboxes
  argument-hint: [project-name]
  allowed-tools: Bash(git:*), Read, Edit, Glob, Grep, AskUserQuestion
  ---
  ```
  Note: Read-heavy audit tool — no Write, no Task, no Bash(npm/npx) to keep scope safe.
- [ ] Implement project detection: find project folder from branch name. Two modes:
    - **With argument**: `Glob("docs/planning/*${ARGUMENTS}*")` — direct match
    - **Without argument**: derive from branch: `BRANCH=$(git branch --show-current)`, strip type prefix (`BRANCH_TYPE="${BRANCH%%/*}"`, `PROJECT_NAME="${BRANCH#*/}"`), then try in order:
      1. `grep -Frl "\"branch\": \"${BRANCH}\"" docs/planning/*/_status.json` — primary lookup by branch field
      2. **Fallback** if grep finds nothing (some older _status.json files lack a `branch` key): `Glob("docs/planning/*${PROJECT_NAME}*")` — match by project name directly
- [ ] Implement checkbox scanning: parse planning doc for all actionable items missing `- [ ]` or `- [x]` prefix. **Code-fence aware**: skip lines inside ``` fenced blocks when scanning — track open/close fence state to avoid false positives on example syntax.
- [ ] Implement checkbox enforcement: for Requirements, Phased Execution Plan, Testing, Verification, Documentation Updates sections — ensure all items have checkboxes
- [ ] Implement test validation: verify Testing section has specific file paths (e.g. `src/lib/services/foo.test.ts`), not just generic descriptions
- [ ] Implement bug-test validation: if plan mentions bug fixes, verify corresponding regression test items exist with checkbox
- [ ] Implement verification validation: check that Verification section exists and has at least one of: A) Playwright verification items (required if plan touches UI/components), B) automated test items with file paths. Reject plans missing both.
- [ ] Implement checkbox update: mark items as `[x]` when user confirms completion
- [ ] Implement summary output: show checked/unchecked counts per section, list unchecked items, flag missing verification
- [ ] Command auto-registers via `.claude/commands/` directory convention — no CLAUDE.md registration needed

### Phase 3: Update /plan-review to capture discussions and enforce verification
- [ ] Edit `.claude/commands/plan-review.md` agent prompts to include `perspective` label in gap descriptions
- [ ] After aggregating results (step 3), append a "## Review & Discussion" section to the planning doc (or append to existing placeholder from template) with iteration number, agent scores, score_reasoning, and critical_gaps attributed to each agent. If section already exists, append new iteration under it — do not duplicate the heading.
- [ ] Before auto-fixing each gap, classify as "obvious" vs "ambiguous" — if ambiguous (multiple possible fixes or unclear intent), use AskUserQuestion to confirm approach before editing
- [ ] After fixing each gap, record the fix description in the "Review & Discussion" section: which gap → what was changed → why
- [ ] Update state file schema — replace the existing step 5 JSON template in plan-review.md (currently lines 197-217 showing `"scores": [3, 4, 2]` and `"critical_gaps": [...]`) with this new template:
  ```json
  {
    "plan_file": "<path>",
    "iteration": N,
    "max_iterations": 5,
    "history": [
      {
        "iteration": 1,
        "timestamp": "2026-01-02T...",
        "scores": {"security_technical": 3, "architecture_integration": 4, "testing_cicd": 2},
        "gaps": [
          {"perspective": "security_technical", "description": "...", "fix_description": "..."}
        ],
        "outcome": "iterate"
      }
    ]
  }
  ```
  Positional mapping for array→object conversion: position 0=security_technical, 1=architecture_integration, 2=testing_cicd.
  **Backward compatibility**: When reading existing state files, handle ALL existing variants:
    - Scores as array `[3, 4, 2]` → convert to object using positional mapping above
    - Scores as abbreviated object `{"security": 3, "architecture": 2, "testing": 2}` → normalize keys (`security` → `security_technical`, `architecture` → `architecture_integration`, `testing` → `testing_cicd`)
    - Missing `gaps` key → create empty array, preserve existing `critical_gaps` and `critical_gaps_fixed` fields as read-only references
    - Normalize on first write, preserve old fields alongside new ones for auditability.
- [ ] Capture `minor_issues` in the "Review & Discussion" section (not just critical_gaps)
- [ ] Add verification check to review agents: plans MUST have a Verification section with A) Playwright verification for UI changes, and/or B) automated tests with file paths. Flag as critical gap if missing. Do not accept plan as 5/5 without verification.

### Phase 4: Update /finalize — verification-first and checkbox enforcement
- [ ] Move plan path resolution to new Step 0 (before current Step 1): extract the derivation logic from current Step 1a (branch name → try 3 path patterns) into Step 0. **Delete Step 1a entirely** — replace it with a single line: "Use $PLAN_FILE resolved in Step 0." This avoids duplication and makes the dependency chain clear: Step 0 resolves path → Step 0a-0e run verification → Step 1b uses the same $PLAN_FILE for context gathering.
- [ ] Step 0a: Read the planning doc's Verification section to identify required verification steps
- [ ] Step 0b: Run automated tests listed in the plan (unit/integration/E2E) — execute each test command via `npm run test:unit`, `npm run test:integration`, or `npm run test:e2e -- --grep @relevant` as appropriate. Collect pass/fail results.
- [ ] Step 0c: If plan includes Playwright verification items (UI changes), ensure local server is running via `./docs/planning/tmux_usage/ensure-server.sh` (per CLAUDE.md server management rules — do NOT use `npm run dev` directly). Wait up to 60 seconds for health check (`curl -sf http://localhost:3000 --max-time 5 --retry 12 --retry-delay 5`). Then run specific Playwright specs from the Verification section via `npx playwright test <spec-file> --headed` or Playwright MCP. Do NOT run the full E2E suite — only the verification-relevant specs. If server fails to start, report error and hard block.
- [ ] Step 0d: Display verification results summary. If any verification fails, HARD BLOCK — AskUserQuestion: "Fix failures and retry" / "Abort finalization"
- [ ] Step 0e: Only after all verification passes, proceed to Step 1 (plan assessment)
- [ ] Edit `.claude/commands/finalize.md` to add "Step 1b.5: Verify Plan Checkboxes" between steps 1b and 1c
- [ ] Implement checkbox parsing: regex for `- \[ \]` and `- \[x\]` patterns in planning doc. **Code-fence aware**: skip lines inside ``` fenced blocks to avoid false positives on example checkbox syntax.
- [ ] Display checkbox summary: total, checked, unchecked counts
- [ ] If any unchecked items: list each with line number, then HARD BLOCK finalization
- [ ] AskUserQuestion with options: "Grant exception and proceed" / "Abort finalization to fix"
- [ ] If exception granted, log it in finalization output and PR body ("N unchecked items — exception granted by user")
- [ ] Checkbox check runs BEFORE step 1c (4 Explore agents) for fail-fast behavior

## Testing

### Unit Tests
- [ ] No unit test files needed — these are markdown skill files executed by Claude Code, not TypeScript application code. Checkbox regex parsing and section detection are described declaratively in the skill markdown and executed by the LLM at runtime — there is no standalone function to unit test.

### Integration Tests
- [ ] No integration test files needed — skill files are interpreted by Claude Code runtime, not compiled/executed as code

### CI/CD Impact
- [ ] No CI pipeline changes needed — skill files (.claude/commands/*.md) are not part of the build/test CI workflow. They are consumed only by Claude Code at conversation time.
- [ ] Existing CI checks (lint, tsc, build, unit, integration, E2E) are unaffected — no application code is modified in this project.

### Manual Verification
- [ ] Run `/initialize test_project` on a test branch → verify planning template has checkboxes and Verification section
- [ ] Verify step 2.8 shows unified doc list before reading any contents
- [ ] Run `/plan-update` on a planning doc with missing checkboxes → verify it adds them
- [ ] Run `/plan-update` on a planning doc with bugs but no regression tests → verify it flags the gap
- [ ] Run `/plan-update` on a planning doc with no Verification section → verify it rejects the plan
- [ ] Run `/plan-update` on a UI-change plan without Playwright verification → verify it flags as missing
- [ ] Run `/plan-review` on a test plan → verify "Review & Discussion" section is appended with agent reasoning
- [ ] Run `/plan-review` on a plan missing Verification section → verify agents flag it as critical gap, refuse 5/5
- [ ] Trigger an ambiguous gap during /plan-review → verify it asks user before fixing
- [ ] Run `/finalize` → verify Step 0 runs verification (tests + Playwright) BEFORE any other steps
- [ ] Run `/finalize` with failing tests → verify hard block at Step 0
- [ ] Run `/finalize` on a branch with unchecked planning items → verify hard block at Step 1b.5
- [ ] Grant exception during /finalize checkbox block → verify exception logged in output
- [ ] Load an old-format review state file (scores as array) → run /plan-review → verify normalization to new schema works
- [ ] Test code-fence-aware checkbox scanning: create a planning doc with checkboxes inside ``` code blocks → verify they are skipped in counts

## Rollback Plan
- All changes are to `.claude/commands/*.md` skill files — these are git-tracked markdown files with no runtime dependencies
- **To rollback**: `git revert <commit>` to restore previous skill file versions. No database migrations, no env var changes, no CI config to undo.
- **Partial rollback**: Each phase modifies independent files, so individual phases can be reverted independently:
  - Phase 1: revert changes to `initialize.md`
  - Phase 2: delete `plan-update.md`
  - Phase 3: revert changes to `plan-review.md`
  - Phase 4: revert changes to `finalize.md`
- **Mid-workflow safety**: If a user is mid-/finalize when the skill file changes, the in-progress conversation uses the version loaded at conversation start — skill files are loaded once, not hot-reloaded.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/docs_overall/managing_claude_settings.md` — No changes expected (skill files not settings)
- [ ] `docs/docs_overall/project_workflow.md` — Update Step 5 "Complete Plan" to reference checkbox requirement; mention /plan-update in execution steps; update planning template to show checkbox format

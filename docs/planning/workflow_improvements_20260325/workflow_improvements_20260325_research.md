# Workflow Improvements Research

## Problem Statement
- /initialize - Review docs being reviewed at end of doc discovery, before reading any file contents
- /plan-update create this. Plan file must have checkboxes for all items - add to template and check anytime after updating plan draft. Plan must include complete tests.
- /plan-review - make sure all discussions are captured in the plan, ask if unsure
- /finalize must verify that all checkboxes are marked as complete in plan file

## Requirements (from GH Issue #TBD)
- /initialize - Review docs being reviewed at end of doc discovery, before reading any file contents
- /plan-update create this. Plan file must have checkboxes for all items - add to template and check anytime after updating plan draft. Plan must include complete tests.
- /plan-review - make sure all discussions are captured in the plan, ask if unsure
- /finalize must verify that all checkboxes are marked as complete in plan file

## High Level Summary

Four workflow skill improvements spanning /initialize, /plan-review, /finalize, and a new /plan-update command. The changes enforce a checkbox-based completion tracking system through the entire project lifecycle: planning docs are created with checkboxes (initialize), checkboxes are updated as work progresses (plan-update), review discussions are captured in the plan (plan-review), and all checkboxes must be checked before PR creation (finalize).

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/managing_claude_settings.md

## Code Files Read
- `.claude/commands/initialize.md` — Full skill file (482 lines). Doc discovery in steps 2.6-2.7.
- `.claude/commands/plan-review.md` — Full skill file (261 lines). 3-agent review loop with auto-fix.
- `.claude/commands/finalize.md` — Full skill file (865 lines). Plan assessment in step 1, 4 Explore agents.
- `.claude/commands/summarize-plan.md` — Full skill file (108 lines). Has frontmatter format example.
- `.claude/commands/research.md` — Command structure reference.
- `.claude/review-state/` — 23+ state JSON files from past reviews.
- Multiple planning docs in `docs/planning/` — Checkbox usage analysis.

## Key Findings

### 1. /initialize — Doc Discovery Flow (Steps 2.6-2.7)

**Current behavior**: Docs are read at TWO separate points:
- Step 2.6 line 175: "Read all manually tagged docs" — immediately after user tags them
- Step 2.7 line 205: "Read all confirmed docs" — immediately after auto-discovery selection

**Problem**: User cannot review the complete list of ALL docs before any are read.

**Fix needed**: Defer ALL doc reading. Accumulate docs from steps 2.6 and 2.7 into a list, then present a unified final review (AskUserQuestion) showing all docs before reading any. Add a new step 2.8 "Final Doc Review" between 2.7 and 3.

### 2. /plan-update — New Command (Does Not Exist)

**Current state**: No `/plan-update` command exists. The 8 existing commands are: initialize, research, plan-review, finalize, mainToProd, debug, summarize-plan, user-test.

**Checkbox adoption**: Only 12% of planning docs (102/847) currently use checkboxes. 78% of checkboxes are unchecked (1,106 vs 313). 12 docs have all checkboxes checked.

**Design needs**:
- Parse planning doc for all actionable items
- Ensure all items in Requirements, Phased Execution Plan, Testing, and Documentation Updates sections have checkboxes
- Check off items as work completes
- Validate test completeness (unit/integration/E2E test items present)
- Follow frontmatter format: `---description, argument-hint, allowed-tools---`

### 3. /plan-review — Discussion Capture Missing

**Current behavior** (plan-review.md):
- 3 agents return JSON: `{perspective, critical_gaps, minor_issues, readiness_score, score_reasoning}`
- Gaps are auto-fixed via Edit tool without user confirmation
- State file tracks only: iteration, scores, critical_gaps list, outcome
- `score_reasoning` and `minor_issues` are discarded after each iteration
- No record of WHY fixes were made or which agent raised which concern

**Problems**:
1. No "Discussion" section in planning doc — review rationale is lost
2. No ambiguity detection — auto-fixes even when fix strategy is unclear
3. No gap↔fix traceability — can't trace why specific plan sections exist
4. `score_reasoning` from agents is never persisted

**Fix needed**:
- Add "## Review & Discussion" section to planning doc during review
- Capture agent perspective, score_reasoning, and fix applied for each gap
- Before auto-fixing ambiguous gaps, use AskUserQuestion to confirm approach
- Update state file schema to include perspective attribution and fix descriptions

### 4. /finalize — No Checkbox Verification

**Current behavior** (finalize.md step 1):
- Step 1a: Locate planning file from branch name
- Step 1b: Read planning file, get diff files
- Step 1c: Launch 4 Explore agents for semantic assessment
- Step 1d: Aggregate gaps, ask user if any found
- No checkbox parsing or verification anywhere

**Fix needed**: Add "Step 1b.5: Verify Plan Checkboxes" between 1b and 1c:
- Parse planning doc for `- [ ]` and `- [x]` patterns
- Count checked vs unchecked
- If any unchecked: block finalization, list unchecked items with line numbers
- AskUserQuestion: "Fix and retry" / "Proceed anyway" / "Abort"
- This runs BEFORE expensive agent parallelization (fail-fast)

## Resolved Questions

1. **Yes** — /plan-update must validate that Testing section has specific file paths, not just checkboxes. Also verify that if bugs are mentioned, regression tests exist.
2. **Yes** — "Review & Discussion" section appended at end of plan, with per-iteration entries capturing agent reasoning and fix rationale.
3. **Hard block** — /finalize checkbox check is a hard block unless user grants an explicit exception (logged in PR body).
4. **Yes** — /initialize planning template updated with checkboxes from creation, so plans start with the right structure.
5. **Verification required** — Any plan must have verification: A) Playwright on local server for UI changes, and/or B) unit/integration/E2E tests. Enforced on /plan-update (rejects plans without it) and /plan-review (agents flag as critical gap).
6. **Finalize verification-first** — /finalize must start with Step 0: run the plan's verification steps (tests + Playwright) before any other finalization work. Hard block on failure.

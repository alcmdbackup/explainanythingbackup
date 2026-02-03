# Use Explore Agents In Finalize Progress

## Phase 1: Add Task to allowed-tools frontmatter
### Work Done
- Added `Task` to the `allowed-tools` frontmatter line in `.claude/commands/finalize.md`
- This enables the `Task` tool which is required to launch Explore subagents

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 2: Replace Step 1 with agent-based plan assessment
### Work Done
- Replaced the entire Step 1 (text-based diff comparison) with new agent-based assessment
- Step 1a: Kept existing planning file location logic (3 path attempts)
- Step 1b: Added context gathering (branch name, diff files, planning file read)
- Step 1c: Added 4 Explore agent prompts (Implementation Completeness, Architecture & Patterns, Test Coverage, Documentation & Integration) with structured JSON output templates
- Step 1d: Added aggregation logic with PASSED/Gaps Detected reporting and AskUserQuestion flow
- Step 1e: Added failure handling (file not found, unparseable agent response, JSON extraction)

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 3: Add new Step 2 — Test Coverage Verification
### Work Done
- Added new Step 2 section between Step 1 (plan assessment) and Step 3 (fetch and rebase)
- Step 2a: Added bash commands to categorize changed files (source, unit tests, integration tests, E2E tests)
- Step 2b: Added summary table template
- Step 2c: Added decision logic with AskUserQuestion for missing test types
- Added edge case: skip verification if no source files changed

### Issues Encountered
None.

### User Clarifications
None needed.

## Phase 4: Renumber remaining steps and update references
### Work Done
- Renumbered: Step 2 (Fetch and Rebase) -> Step 3, Step 3 (Run Checks) -> Step 4, Step 4 (E2E Tests) -> Step 5, Step 5 (Commit Changes) -> Step 6, Step 5.5 (Documentation Updates) -> Step 6.5, Step 6 (Push and Create PR) -> Step 7
- Updated Success Criteria to reference "Plan assessment" and "Test coverage verification"
- Updated Output section to include plan assessment result and test coverage verification result (6 items instead of 5)
- Verified all internal cross-references (proceed to Step 2, proceed to Step 3, etc.) are correct

### Issues Encountered
None.

### User Clarifications
None needed.

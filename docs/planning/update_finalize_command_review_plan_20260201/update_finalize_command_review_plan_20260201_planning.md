# Update Finalize Command Review Plan

## Background
The `/finalize` command orchestrates the full PR preparation workflow: rebase, lint/tsc/build/test checks, documentation updates, and PR creation. It currently has no step to verify that the project's planning file has been fully implemented before opening the PR.

## Problem
When a developer runs `/finalize`, the command assumes all planned work is complete. There is no verification that every phase, test file, and documentation update listed in the `_planning.md` has actually been implemented. This can lead to PRs that ship incomplete work without anyone realizing phases were missed.

## Options Considered

### Option A: Add as Step 1 (fail-fast, before checks) — Recommended
Insert plan verification as the very first step, before rebase and checks. If the plan isn't fully implemented, there's no point running lint/tsc/build/tests. Advisory (user can choose to proceed with gaps).

### Option B: Add as final gate (before PR creation)
Insert after all checks pass, right before push/PR. Pro: the diff is fully finalized including fix-up commits. Con: wastes time running all checks only to discover missing phases.

### Option C: Add as a separate command `/verify-plan`
Keep finalize unchanged, create a standalone command. Con: adds friction since developers must remember to run it; duplicates branch-to-plan lookup logic.

**Decision: Option A** — fail-fast at step 1.

## Phased Execution Plan

### Phase 1: Add plan verification step to finalize.md

**Files modified:**
- `.claude/commands/finalize.md`

**Changes:**
1. Insert new `### 1. Plan Completion Verification` section before current step 1
2. Plan file lookup logic:
   ```
   BRANCH=$(git branch --show-current)
   BRANCH_TYPE="${BRANCH%%/*}"              # e.g., feat
   PROJECT_NAME="${BRANCH#*/}"              # e.g., my_project_20260201
   ```
   Try paths in order (first match wins):
   - `docs/planning/${BRANCH_TYPE}/${PROJECT_NAME}/_planning.md`
   - `docs/planning/${PROJECT_NAME}/_planning.md`
   - `docs/planning/${PROJECT_NAME}/${PROJECT_NAME}_planning.md`
3. Skip if no plan file found (warn and proceed)
4. Read plan and extract: phases with files/tests, Documentation Updates section, Out of Scope section
5. Compare against `git diff --name-only origin/main`
6. Check three categories:
   - Files listed in phases but not in diff
   - Test files/names planned but not present
   - Doc updates planned but not in diff
7. Exclude items under "Out of Scope", "Deferred", "Post-MVP"
8. If gaps found: present structured report, ask user to proceed or stop
9. If no gaps: display PASSED, continue

### Phase 2: Renumber existing steps and update metadata

**Files modified:**
- `.claude/commands/finalize.md`

**Changes:**
1. Renumber all existing steps (+1):
   - `### 1. Fetch and Rebase` → `### 2. Fetch and Rebase`
   - `### 2. Run Checks` → `### 3. Run Checks`
   - `### 3. E2E Tests` → `### 4. E2E Tests`
   - `### 4. Commit Changes` → `### 5. Commit Changes`
   - `### 4.5. Documentation Updates` → `### 5.5. Documentation Updates`
   - `### 5. Push and Create PR` → `### 6. Push and Create PR`
2. Update Success Criteria: add plan verification line
3. Update Output section: add plan verification result, renumber items

## Testing
- Manual: run `/finalize` on a branch with a known planning file and verify the step activates
- Manual: run `/finalize` on a branch without a planning file and verify it warns and skips
- Manual: verify that "Out of Scope" items are not flagged as gaps

## Documentation Updates
- No external docs need updating — this change is self-contained within `.claude/commands/finalize.md`

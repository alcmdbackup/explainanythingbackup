# Finalize Should Leave No Uncommitted Files Progress

## Phase 1: Add Verification Step to finalize.md
### Work Done
Added Step 6.6 "Verify Clean Working Tree" to `.claude/commands/finalize.md` (lines 348-468):
- 6.6a: Check for remaining files with `git status --porcelain`
- 6.6b: Early exit if working tree is clean
- 6.6c: File processing loop with:
  - Path validation (within repo check)
  - Status code parsing with origin explanation table
  - Sensitive file pattern detection (.env*, *.key, *.pem, *secret*, *credential*, *password*)
  - AskUserQuestion for each file with 4 options (Commit/Gitignore/Delete/Abort)
  - Safe git commands for each action
  - Loop with 50-iteration guard

### Issues Encountered
None - implementation followed the plan exactly.

### User Clarifications
None required.

## Phase 2: Update Success Criteria in finalize.md
### Work Done
Added to Success Criteria section (line 491):
- "Working tree is clean (verified by `git status --porcelain` returning empty)"

### Issues Encountered
None.

### User Clarifications
None required.

## Phase 3: Update Output Section in finalize.md
### Work Done
Added to Output section (line 502):
- "Working tree verification result (clean / N files handled)"

### Issues Encountered
None.

### User Clarifications
None required.

## Phase 4: Handle Pre-existing Files in initialize.md
### Work Done
Added Step 2.1 "Handle Pre-existing Uncommitted Files" to `.claude/commands/initialize.md` (lines 77-137):
- Check for files carried over from previous branch
- Display warning with file list and status explanations
- Single-select AskUserQuestion for each file with 4 options:
  1. "Leave it" — keep for /finalize later (different from /finalize which has no Leave option)
  2. "Commit it now" — stage and commit immediately
  3. "Add to .gitignore" — gitignore and commit
  4. "Delete it" — remove using git clean/checkout

### Issues Encountered
None.

### User Clarifications
None required.

## Phase 5: Move Commit Prompt Before GitHub Issue
### Work Done
Added Step 7.5 "Offer to Commit Project Files" to `.claude/commands/initialize.md` (lines 334-349):
- AskUserQuestion with "Yes, commit now (Recommended)" and "No, I'll commit later"
- Commits project skeleton files before GitHub issue creation
- Only adds doc-mapping.json if it exists and was modified

### Issues Encountered
None.

### User Clarifications
None required.

## Phase 6: Show Status at End of initialize.md
### Work Done
Updated Step 9 "Output Summary" in `.claude/commands/initialize.md` (lines 377-405):
- Added `git status --short` execution
- Display git status in output
- Added conditional message for uncommitted files with suggested commit command

### Issues Encountered
None.

### User Clarifications
None required.

## Summary

All 6 phases completed successfully. Implementation was done in commit `9626c6f`:
```
feat(skills): add clean working tree verification to /finalize and /initialize
```

Both skills now ensure:
- **/finalize**: No files left uncommitted before PR (strict - no "Leave it" option)
- **/initialize**: Pre-existing files are handled upfront with user control; commit prompt before GitHub issue

The working tree will always be in a well-defined state after these skills complete.

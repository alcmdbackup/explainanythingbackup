# Finalize Should Leave No Uncommitted Files Research

## Problem Statement
Both /finalize and /initialize skills can leave uncommitted files after completion. The user wants explicit control: every file must be either committed or gitignored - no exceptions, no silent skipping.

## High Level Summary
Two skills need updates:

**1. /finalize** - Has a commit step (Step 6) but no final verification. Files can remain if generated after `git add -A` or if commits fail.

**2. /initialize** - Creates 4 project files but **never commits them**. Also doesn't warn about pre-existing uncommitted files that carry over during branch creation.

Both need a verification step that shows uncommitted files and asks the user what to do with each.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- (none selected)

## Code Files Read
- `.claude/commands/finalize.md` - The /finalize skill implementation (380 lines)
- `.claude/commands/initialize.md` - The /initialize skill implementation (333 lines)

## Key Findings

### Current /initialize Workflow
The skill has 9 main steps:
1. Parse and Validate Input
2. Create Branch from Remote Main (`git checkout -b $BRANCH origin/main`)
3. Create Folder Structure
4. Create Research Document (Write tool)
5. Create Planning Document (Write tool)
6. Create Progress Document (Write tool)
7. Documentation Mapping
8. Create GitHub Issue
9. Output Summary

**Gaps Identified in /initialize:**
1. **Files created are never committed** - Steps 3-6 create _status.json, research.md, planning.md, progress.md but never commit them
2. **Pre-existing files not shown** - When `git checkout -b` runs, untracked/modified files from the previous branch carry over silently
3. **No git status at end** - User has no visibility into what's uncommitted

**Evidence from current session:**
After running /initialize, `git status --short` shows:
```
?? docs/papers/                                              <- pre-existing, carried over
?? docs/planning/finalize_should_leave_no_uncommitted_files_20260502/  <- created by skill
```

### Current /finalize Workflow
The skill has 7 main steps:
1. Agent-Based Plan Assessment (4 parallel agents verify plan execution)
2. Test Coverage Verification
3. Fetch and Rebase
4. Run Checks (lint, tsc, build, unit, integration)
5. E2E Tests (optional)
6. Commit Changes (`git add -A && git commit`)
7. Push and Create PR

### Gap Identified
**No verification after Step 6 or 7** - The skill never confirms the working tree is clean. It just commits whatever is staged and moves on.

### Relevant Code from finalize.md

Step 6 "Commit Changes":
```bash
git add -A
git commit -m "fix: address lint/type/test issues for PR"
```

Step 6.5 "Documentation Updates" also does:
```bash
git add docs/ .claude/doc-mapping.json
git commit --amend --no-edit
```

But neither has a follow-up check for remaining files.

## Proposed Solutions

### For /finalize
Add a new **Step 6.6: Verify Clean Working Tree** between Step 6.5 and Step 7 that:
1. Runs `git status --porcelain`
2. If output is empty → proceed
3. If files remain → for each file, use AskUserQuestion to determine: commit it, add to .gitignore, or abort
4. Loop until clean

### For /initialize
Two changes needed:

**A. After Step 2 (branch creation):** Add Step 2.1 to show any pre-existing uncommitted files:
```bash
git status --short
```
If files exist, display warning: "These files were carried over from the previous branch: [list]"

**B. Update Step 9 (Output Summary):** Add git status output at the end:
```
Uncommitted files (created by this initialization):
   ?? docs/planning/project_name/_status.json
   ?? docs/planning/project_name/project_name_research.md
   ?? docs/planning/project_name/project_name_planning.md
   ?? docs/planning/project_name/project_name_progress.md

Run 'git add -A && git commit -m "chore: initialize project_name"' to commit these files.
```

**C. Optional:** Ask user if they want to commit the skeleton files now.

---
description: Rebase off remote main, run all checks (lint/tsc/build/unit/integration), update docs, fix issues, commit, and create PR
argument-hint: [--e2e]
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob, AskUserQuestion
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

### 1. Fetch and Rebase

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

### 2. Run Checks (fix issues as they arise)

Run each check. If it fails, fix the issues and re-run until it passes:

1. **Lint**: `npm run lint`
2. **TypeScript**: `npx tsc --noEmit`
3. **Build**: `npm run build`
4. **Unit Tests**: `npm run test:unit`
5. **Integration Tests**: `npm run test:integration`

### 3. E2E Tests (if --e2e flag provided)

If `$ARGUMENTS` contains `--e2e`:
- Run: `npm run test:e2e -- --grep @critical`
- Fix any failures before proceeding

### 4. Commit Changes

If there are uncommitted changes from fixes:
```bash
git add -A
git commit -m "fix: address lint/type/test issues for PR"
```

### 4.5. Documentation Updates

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

### 5. Push and Create PR

```bash
git push -u origin HEAD
```

Then create PR using:
```bash
gh pr create --base main --fill
```

Or if more context is needed, create with title and body describing the changes.

## Success Criteria

- All checks pass (lint, tsc, build, unit, integration)
- E2E critical tests pass (if --e2e flag was provided)
- Branch is rebased on latest origin/main
- Documentation is updated for all doc-worthy changes
- PR is created and URL is displayed

## Output

When complete, display:
1. Summary of fixes made (if any)
2. All check results (pass/fail)
3. Documentation updates made (list of docs updated)
4. PR URL

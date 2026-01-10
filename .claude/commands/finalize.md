---
description: Rebase off remote main, run all checks (lint/tsc/build/unit/integration), fix issues, commit, and create PR
argument-hint: [--e2e]
allowed-tools: Bash(git:*), Bash(npm:*), Bash(npx:*), Bash(gh:*), Read, Edit, Write, Grep, Glob
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
- PR is created and URL is displayed

## Output

When complete, display:
1. Summary of fixes made (if any)
2. All check results (pass/fail)
3. PR URL

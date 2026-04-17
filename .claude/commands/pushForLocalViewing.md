---
description: Commit all outstanding work, push branch to remote, and print a copy-paste command to pull and run on another machine
allowed-tools: Bash(git:*)
---

# Push for Local Viewing

Commit everything in-progress, push to remote, and output a ready-to-copy command for viewing on another machine.

## Context

- Current branch: !`git branch --show-current`
- Git status: !`git status --short`

## Steps

### 1. Check for anything to commit

```bash
git status --short
```

If the working tree is completely clean (no output), skip to Step 3.

### 2. Stage and commit outstanding work

Stage all changes, skipping `.env*` files:

```bash
git add --all
ENV_FILES=$(git diff --cached --name-only | grep -E '(^|\/)\.env' || true)
[ -n "$ENV_FILES" ] && echo "$ENV_FILES" | xargs git reset HEAD -- 2>/dev/null || true
```

If nothing is staged after this, skip to Step 3.

Commit with a WIP message:

```bash
BRANCH=$(git branch --show-current)
git commit -m "wip: push for local viewing on branch ${BRANCH}

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

### 3. Push to remote

```bash
git push -u origin HEAD 2>&1
```

### 4. Print the copy-paste command

Output this block verbatim with the real branch name substituted:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Run this on your other machine:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  git fetch && git checkout <BRANCH> && git pull && npm run dev

  (already on branch?  git pull && npm run dev)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

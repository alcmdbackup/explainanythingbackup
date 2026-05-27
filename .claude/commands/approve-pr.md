---
description: Write a SHA-keyed approval token (.claude/ci-gate-override.json) that lets gh pr create bypass the PR-creation gate for the current branch and HEAD. Use only when consciously skipping verification (e.g., known-flaky test, urgent fix).
argument-hint: (none)
allowed-tools: Bash(git:*), Read, Write, AskUserQuestion
---

# Approve PR Without Finalize

Write a one-shot approval token so the PR-creation gate (`block-pr-create-without-gate.sh`) allows `gh pr create` despite a known CI failure or skipped `/finalize`. The token is keyed by branch + HEAD SHA: any new commit invalidates it.

Use this command **deliberately**, not habitually. Each approval is auto-committed with your reason in the commit message — it lives forever in `git log`.

## Context

- Current branch: !`git branch --show-current`
- Current HEAD: !`git rev-parse HEAD`
- Time now: !`date -u +%Y-%m-%dT%H:%M:%SZ`

## Workflow

### Step 1: Branch validation

```bash
BRANCH=$(git branch --show-current)
```

If on `main` or `production`, abort with: "Cannot approve PR on main/production. Use /finalize or /mainToProd instead."

If on `hotfix/*`, exit with: "hotfix branches bypass the PR-creation gate automatically. No approval needed."

### Step 2: Check for existing valid approval

If `.claude/ci-gate-override.json` already exists, check whether it covers the current branch + HEAD:

```bash
if [ -f .claude/ci-gate-override.json ]; then
  EXISTING_BRANCH=$(jq -r '.branch // ""' .claude/ci-gate-override.json)
  EXISTING_COMMIT=$(jq -r '.commit // ""' .claude/ci-gate-override.json)
  EXISTING_REASON=$(jq -r '.reason // ""' .claude/ci-gate-override.json)
  if [ "$EXISTING_BRANCH" = "$BRANCH" ] && [ "$EXISTING_COMMIT" = "$(git rev-parse HEAD)" ]; then
    echo "Already approved for this branch + HEAD."
    echo "Reason: $EXISTING_REASON"
    echo "You can run 'gh pr create' now."
    exit 0
  fi
fi
```

### Step 3: Confirm bypass intent (AskUserQuestion)

Use `AskUserQuestion` to confirm:

- Question: "Skip PR-creation verification for the current branch + HEAD? This bypasses the gate that ensures local tests passed and migrations were verified."
- Options:
  1. "Skip verification — I accept the risk" — proceed to Step 4
  2. "Cancel — I'll run /finalize instead" — abort with message: "Cancelled. Run /finalize when ready."

### Step 4: Capture reason (plain-chat prompt)

Emit this message verbatim, then **end the turn with zero tool calls**. Wait for the user's next message:

> Enter a one-line reason for skipping verification (e.g., "flaky test admin-content.spec.ts tracked in #1095", "hotfix for prod auth bug, will fix tests in follow-up"):

When the user replies, treat their entire next message as the reason. Validate:
- If empty or whitespace-only, re-prompt: "Reason cannot be empty. Please provide a one-line reason."
- Otherwise proceed to Step 5.

### Step 5: Write the override token

```bash
HEAD_SHA=$(git rev-parse HEAD)
BRANCH=$(git branch --show-current)
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
APPROVED_BY=$(git config user.email || echo "unknown")
REASON="<the user's reply from Step 4 — embed safely via jq, do not interpolate raw>"

jq -n \
  --arg branch "$BRANCH" \
  --arg commit "$HEAD_SHA" \
  --arg reason "$REASON" \
  --arg approved_at "$NOW" \
  --arg approved_by "$APPROVED_BY" \
  '{branch: $branch, commit: $commit, reason: $reason, approved_at: $approved_at, approved_by: $approved_by, schema_version: 1}' \
  > .claude/ci-gate-override.json
```

Verify the file:

```bash
test -f .claude/ci-gate-override.json || { echo "ERROR: failed to write override file"; exit 1; }
jq empty .claude/ci-gate-override.json || { echo "ERROR: override file is not valid JSON"; exit 1; }
```

### Step 6: Auto-commit

The commit message embeds the reason verbatim so it's grep-able in `git log` later:

```bash
git add .claude/ci-gate-override.json
git commit -m "chore: approve PR skip — $REASON"
```

### Step 7: Print next steps

```
PR-creation approval written ✓
──────────────────────────────────────────
Branch:      <branch>
Commit:      <short SHA>
Reason:      <reason>
Approved by: <git user.email>
──────────────────────────────────────────

You can now run:
  gh pr create --base main --title "..." --body "..."

⚠ The approval is invalidated by any new commit on this branch (it's SHA-keyed,
not time-windowed). If you make more changes, you'll need to re-approve.
```

## Success Criteria

- `.claude/ci-gate-override.json` exists, parses as JSON, and covers current branch + HEAD
- A new commit on the branch contains the reason in its message (audit trail in `git log`)
- The user can immediately run `gh pr create` without the hook denying

## Edge Cases

- On `hotfix/*`: silent exit with note (hook already bypasses)
- On `main`/`production`: refuse
- Existing valid approval: display it and exit (no double-commit)
- Empty reason: re-prompt
- Failed file write: error and exit, no commit
- Failed commit (e.g., uncommitted other changes): warn and abort with instruction to commit/stash other changes first

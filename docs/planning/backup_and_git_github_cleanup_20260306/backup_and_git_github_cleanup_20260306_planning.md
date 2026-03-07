# Backup and Git GitHub Cleanup Plan

## Background
Create a new skill about git and GitHub usage, document credential storage locations, document how to monitor active GitHub Actions runs based on permissions, and fix /finalize and /mainToProd skills to successfully push to the backup repo which has been failing recently.

## Requirements (from GH Issue #NNN)
1. Create a new skill documenting git and GitHub usage patterns
2. Document where git and GitHub credentials are stored
3. Document how to monitor active GitHub Actions runs based on permissions
4. Fix /finalize and /mainToProd to successfully push to the backup repo (currently failing)

## Problem
Backup pushes in /finalize and /mainToProd silently fail because they share code blocks with other git commands and have no verification. Claude treats them as optional since there's no explicit instruction to run them or check their output. Two failure periods occurred: (1) commands weren't committed to main for 2 days, and (2) after the fix, commands exist but Claude skips them ~50% of the time because they're embedded in code blocks as secondary commands. No logs or verification exist to catch failures.

## Options Considered

### For backup push reliability
1. **Isolated code blocks + explicit instructions** (CHOSEN) — Move each backup push to its own code block with clear "YOU MUST run this" language and output verification. Non-fatal: warn on failure but don't block workflow.
2. **Post-push hook** — Add a git hook that auto-pushes to backup after every push to origin. Rejected: hooks are fragile, hard to debug, and would run on every push (not just finalize).
3. **Separate sync step at end** — Add a final "Sync to Backup" step that pushes all refs. Rejected: if finalize fails mid-way, backup never syncs.

### For the git/GitHub skill
1. **New skill file** (CHOSEN) — `.claude/skills/git-github/SKILL.md` with credentials, monitoring, and workflow patterns.
2. **Add to CLAUDE.md** — Rejected: CLAUDE.md is already large and this is reference material, not instructions.
3. **New docs/ file** — Rejected: skills are auto-discovered and can be invoked; docs are passive.

## Phased Execution Plan

### Phase 1: Fix backup pushes in finalize.md
**Files modified:** `.claude/commands/finalize.md`

**Change 1: Step 3 (line 311-314)** — Separate backup push from rebase into its own block with instructions.

Before:
```bash
git fetch origin main
git -c http.postBuffer=524288000 push backup origin/main:refs/heads/main --no-verify
git rebase origin/main
```

After:
```bash
git fetch origin main
git rebase origin/main
```

Then add a new sub-step 3.1 after rebase completes:

```markdown
### 3.1. Sync main to backup

**YOU MUST run this command.** Push origin/main to backup remote. This is non-fatal — if it fails, warn the user and continue.

\```bash
git -c http.postBuffer=524288000 push backup origin/main:refs/heads/main --no-verify
\```

**Verification:** Check the command's exit code. If it succeeds (exit 0), continue silently. If it fails (non-zero exit), display:
"Warning: Backup sync of main failed. Continuing with finalization. Run manually later: `git push backup origin/main:refs/heads/main`"
Then continue to Step 3.5.
```

**Change 2: Step 7 (lines 647-650)** — Separate backup push from origin push.

Before:
```bash
git push -u origin HEAD
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
```

After — split into two blocks:
```bash
git push -u origin HEAD
```

Then add Step 7.1:
```markdown
### 7.1. Push branch to backup

**YOU MUST run this command.** Push the feature branch to backup remote. Non-fatal — warn and continue if it fails.

\```bash
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
\```

**Verification:** Check exit code. If non-zero, display:
"Warning: Backup push of feature branch failed. Run manually: `git push backup HEAD --force-with-lease`"
Then continue to PR creation.
```

**Change 3: Step 8d (lines 783-787)** — Same pattern for the iteration loop push.

Before:
```bash
git push
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
```

After — split into two blocks:
```bash
git push
```

Then:
```markdown
**YOU MUST run this command.** Push to backup (non-fatal):
\```bash
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
\```
**Verification:** Check exit code. If non-zero, display warning and continue to Step 8a.
```

### Phase 2: Fix backup pushes in mainToProd.md
**Files modified:** `.claude/commands/mainToProd.md`

**Change: Step 6 (lines 114-118)** — Separate backup pushes from origin push.

Before:
```bash
git push -u origin HEAD
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
git -c http.postBuffer=524288000 push backup origin/production:refs/heads/production --no-verify
```

After — split into origin push + backup sub-step:
```bash
git push -u origin HEAD
```

Then add Step 6.1:
```markdown
### 6.1. Sync to backup remote

**YOU MUST run both commands below.** Push deploy branch and production ref to backup. Non-fatal — warn and continue if either fails.

\```bash
git -c http.postBuffer=524288000 push backup HEAD --force-with-lease --no-verify
\```

\```bash
git -c http.postBuffer=524288000 push backup origin/production:refs/heads/production --no-verify
\```

**Verification:** Check exit code of each push. If either fails (non-zero exit), display:
"Warning: Backup sync failed. Run manually after PR merges: `git push backup origin/production:refs/heads/production`"
Then continue to PR creation.
```

### Phase 3: Create git/GitHub skill
**Files created:** `.claude/skills/git-github/SKILL.md`

**YAML Frontmatter:**
```yaml
---
name: git-github
description: "Git and GitHub workflow reference: credentials, monitoring, backup remote, and troubleshooting"
allowed-tools:
  - Bash(git:*)
  - Bash(gh:*)
  - Read
  - Grep
  - Glob
---
```

Skill content sections:
1. **Credential Locations** — where git/GitHub creds are stored. **SECURITY: document file paths and mechanisms ONLY. Never include token values, prefixes, or account usernames. Use `<YOUR_PAT>` placeholders in examples.**
2. **Monitoring GitHub Actions** — gh CLI commands for listing, viewing, watching runs
3. **Git Workflow Patterns** — branch naming, commit conventions, merge strategy
4. **Backup Remote** — how backup works, manual sync commands, PAT rotation procedure:
   ```bash
   git remote set-url backup https://<NEW_PAT>@github.com/<ORG>/<REPO>.git
   ```
5. **Troubleshooting** — common issues and fixes, including: if backup push fails with "stale info", run `git fetch backup` first then retry; never capture `git remote -v` output (exposes embedded PAT)

**Security notes for SKILL.md content:**
- The backup remote URL contains an embedded PAT — this is a known trade-off for simplicity. Document the risk and the rotation procedure.
- Never run `git remote -v` and capture/commit output — it exposes the embedded PAT.
- Credential locations are reference-only — the skill should say "check `~/.git-credentials`" not show contents.

### Phase 4: Sync backup and verify
1. Manually push missing commits to backup: `git push backup origin/main:refs/heads/main`
2. Verify sync: `git log backup/main..origin/main` should be empty
3. Run a test /finalize cycle on this branch to confirm backup pushes execute

### Phase 5: Sanitize existing planning docs
**Files modified:** All files in `docs/planning/setup_mirror_repo_as_backup_for_finalize_command_20260301/` and `docs/planning/backup_test_20260303/`

Check for and remove any token prefixes, account usernames, or other credential metadata from the original backup setup planning docs. These were written before the "no secrets" policy was established.

Grep pattern: `grep -rE "(github_pat|ghp_|gho_|ghs_|ghr_|alcmd)" docs/planning/`
Replace any matches with generic descriptions (e.g., "fine-grained PAT" instead of token prefix, "primary account" instead of username).

## Testing

### Manual verification checklist
- [ ] After Phase 1-2 edits, read modified finalize.md and mainToProd.md to verify:
  - Each backup push is in its own code block
  - Each has "YOU MUST run" language
  - Each has exit-code verification
  - Each is marked non-fatal with explicit warning text
- [ ] After Phase 3, verify skill auto-discovery: invoke the skill and confirm it loads
- [ ] After Phase 4, verify `git log backup/main..origin/main` returns empty
- [ ] After Phase 5, grep planning docs for credential metadata: `grep -rE "(github_pat|ghp_|gho_|ghs_|ghr_|alcmd)" docs/planning/`

### No automated tests needed
- These are LLM instruction files (markdown), not code
- The skill file is reference documentation
- Verification is manual: does /finalize actually push to backup on next run?

## Rollback Plan
All changes are markdown files. Rollback via `git revert <commit>` for any phase. No runtime code is affected.

## Security Notes
- `--no-verify` on backup pushes: justified because the backup remote is a private mirror repo with no pre-push hooks. The flag prevents local hooks (e.g., secret scanning) from blocking the backup sync, which only mirrors refs already pushed to origin.
- Embedded PAT in remote URL: known trade-off. Migration to credential helper is out of scope for this project but documented in the skill's troubleshooting section as a future improvement.
- Never capture `git remote -v` output in files or commits — it exposes the embedded PAT.

## Documentation Updates
- `.claude/commands/finalize.md` — backup push isolation (Phase 1)
- `.claude/commands/mainToProd.md` — backup push isolation (Phase 2)
- `.claude/skills/git-github/SKILL.md` — new skill (Phase 3)
- `docs/planning/setup_mirror_repo_as_backup_for_finalize_command_20260301/` — credential sanitization (Phase 5)

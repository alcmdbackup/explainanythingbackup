# Setup Mirror Repo as Backup for Finalize Command Research

## Problem Statement
Set up a mirror backup repository that the /finalize command automatically pushes to after every successful push to origin. The backup repo will be configured with non-destructive permissions (no force-push, no branch deletion) to serve as an emergency recovery source. This ensures code is always preserved in a secondary location regardless of what happens to the primary repository. The implementation adds a single backup push step to the finalize command with best-effort semantics (failures don't block finalize).

## Requirements (from GH Issue #597)
1. Create a backup mirror repository on GitHub (e.g., Minddojo/explainanything-backup)
2. Configure backup repo with non-destructive permissions:
   - Disable force-push on all branches
   - Disable branch deletion
   - Private repo, minimal write access
3. Add `backup` git remote to local git config
4. Modify /finalize command (`.claude/commands/finalize.md`) to:
   - Push current branch to backup remote after successful origin push
   - Use `|| true` so backup failures never block finalize
   - Use `--no-verify` to skip hooks on backup push
5. Document the backup repo setup in relevant docs
6. Decide on auth method (HTTPS PAT, SSH deploy key, or GitHub App token)
7. Decide on push scope (current branch only, or also main/production)

## High Level Summary

The /finalize command has 2 push points: Step 7 (initial `git push -u origin HEAD`) and Step 8d (retry pushes during CI fix iterations). The backup push should be added immediately after the Step 7 push and optionally after Step 8d retries. Auth is already handled via HTTPS + PAT stored in keyring, so the backup remote can reuse the same mechanism. The backup repo needs to be created via `gh repo create` and protected via GitHub UI settings. The change to finalize.md is minimal — one line after each push command.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/docs_overall/testing_overview.md — CI/CD workflows, GitHub Actions config
- docs/docs_overall/environments.md — Environment config, secrets organization, deployment flow
- docs/docs_overall/debugging.md — Debugging tools, recovery workflows

## Code Files Read
- `.claude/commands/finalize.md` — 840-line finalize workflow, 2 push points identified
- `.git/config` — Single `origin` remote to Minddojo/explainanything.git
- `.github/workflows/ci.yml` — CI pipeline triggered by PRs to main/production
- `.github/workflows/post-deploy-smoke.yml` — Post-deploy smoke tests
- `.github/workflows/supabase-migrations.yml` — DB migration deployment

## Key Findings

### 1. Finalize Push Flow (exact insertion points)
- **Step 7 (line 647)**: `git push -u origin HEAD` — primary push after all work complete
  - Backup push goes immediately after this line
- **Step 8d (line 783)**: `git push` — retry push during CI fix iterations
  - Backup push optionally goes after this line too
- Between Step 7 push and PR creation is ideal — code is final, working tree is clean

### 2. Current Git/Auth Setup
- Single remote: `origin` → `https://github.com/Minddojo/explainanything.git`
- Auth: HTTPS protocol, PAT stored in keyring (`github_pat_...` via account `alcmd15492`)
- Git hook path: `.githooks`
- Org repos: `explainanything` (private), `writing_pipeline` (private) — no backup repo exists yet

### 3. Backup Repo Creation
- Can use: `gh repo create Minddojo/explainanything-backup --private`
- Then add remote: `git remote add backup https://github.com/Minddojo/explainanything-backup.git`
- Auth will work automatically via same PAT/keyring (same org, HTTPS protocol)

### 4. Branch Protection (must be done via GitHub UI)
- Current PAT lacks admin scope for branch protection API (HTTP 403)
- Must configure via GitHub UI: Settings → Branches → Add ruleset
- Key settings: Disable force-push, disable branch deletion on wildcard `*` pattern
- No existing `.github/settings.yml` or repo-as-code configuration

### 5. Finalize Command Variables
- `BRANCH=$(git branch --show-current)` — available at push time
- `PROJECT_NAME="${BRANCH#*/}"` — derived from branch
- Remote name `origin` is hardcoded — backup push adds a parallel line with `backup`

### 6. Exact Code Change Needed
After Step 7 push (line 647), add:
```bash
git push backup HEAD 2>/dev/null || true
```
After Step 8d push (line 783), add:
```bash
git push backup HEAD 2>/dev/null || true
```
Total change: 2 lines added to finalize.md.

### 7. `gh` CLI Permissions Already Whitelisted
From `settings.json`: `Bash(gh repo view:*)`, `Bash(gh pr checks:*)`, `Bash(gh pr create:*)`, `Bash(gh issue create:*)` are pre-approved. `gh repo create` would need user approval.

## Open Questions

1. **Repo name**: `Minddojo/explainanything-backup` or different name/org?
2. **Push scope**: Push only current branch, or also push main/production on each finalize?
3. **Step 8d retries**: Should backup push also happen on CI-fix retry pushes, or only the initial Step 7 push?
4. **Initial seed**: Should the backup repo be seeded with all existing branches/tags, or start fresh from the next finalize?
5. **mainToProd command**: Should `.claude/commands/mainToProd.md` also get a backup push? (It merges main→production)

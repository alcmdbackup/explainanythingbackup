# Setup Mirror Repo as Backup for Finalize Command Plan

## Background
Set up a mirror backup repository that the /finalize command automatically pushes to after every successful push to origin. The backup repo serves as an emergency recovery source with append-only protection (no force-push, no branch deletion). Every push to the backup is blocking — if it fails, finalize/mainToProd stops.

## Requirements (from GH Issue #597)
1. Create a backup mirror repository on GitHub
2. Configure backup repo with non-destructive permissions (rulesets)
3. Add `backup` git remote to local git config (shared across worktrees)
4. Modify /finalize and /mainToProd commands to push to backup
5. Document the backup repo setup
6. Configure auth (separate PAT for backup account)
7. Initial seed of all existing branches
8. Keep main and production branches synced on backup

## Problem
The primary repository (`Minddojo/explainanything`) is a single point of failure. If the repo is compromised, accidentally deleted, or suffers a destructive force-push, there is no secondary copy of the code. The /finalize command is the primary code delivery mechanism, making it the natural integration point for an automatic backup push.

## Decisions Made

| Decision | Choice | Rationale |
|---|---|---|
| Backup repo | `alcmdbackup/explainanythingbackup` | Separate account for isolation |
| Visibility | Public | User's choice |
| Auth method | PAT embedded in remote URL | Simplest; works across all worktrees; stored in local .git/config only |
| PAT scope | Contents (R/W) + Workflows (R/W) | Workflows permission required because repo contains `.github/workflows/` |
| Push behavior | Blocking | Backup must succeed or finalize stops |
| Protection | GitHub branch rulesets on `*` pattern | Block force-push + block deletion on all branches |
| TLS fix | `git -c http.postBuffer=524288000 push` | Required to avoid GnuTLS TLS errors on large payloads |
| Remote name | `backup` | Added to shared .git/config, available across all worktrees |

## What's Done

### Infrastructure
- [x] Backup repo exists: `https://github.com/alcmdbackup/explainanythingbackup`
- [x] Rulesets configured: block force-push + block deletion on all branches (`*`)
- [x] `backup` remote added to shared `.git/config` at `/home/ac/Documents/ac/explainanything-worktree0/.git`
- [x] PAT with Contents + Workflows permissions created and embedded in remote URL
- [x] Push tested and confirmed working

### Commands Updated
- [x] `finalize.md` Step 7 (line 648): `git -c http.postBuffer=524288000 push backup HEAD --no-verify`
- [x] `finalize.md` Step 8d (line 785): `git -c http.postBuffer=524288000 push backup HEAD --no-verify`
- [x] `mainToProd.md` Step 6 (line 116): `git -c http.postBuffer=524288000 push backup HEAD --no-verify`

### Initial Seed
- [x] 46 branches pushed to backup (all local branches + production)
- [x] `main` force-pushed (required temporarily disabling ruleset due to divergence)
- [x] `production` pushed from `origin/production` ref
- [x] Ruleset re-enabled after force-push

## Decided: Trunk Branch Sync — Option A (Auto-sync in commands)

- In `/finalize` step 3 (after `git fetch origin main`), add: `git -c http.postBuffer=524288000 push backup origin/main:refs/heads/main --no-verify`
- In `/mainToProd` step 6 (after pushing deploy branch), add: `git -c http.postBuffer=524288000 push backup origin/production:refs/heads/production --no-verify`
- Blocking: if push fails, command stops

**Coverage after implementation:**

| What gets backed up | When | Covered? |
|---|---|---|
| Feature branches | `/finalize` pushes HEAD | Yes |
| Deploy branches | `/mainToProd` pushes HEAD | Yes |
| `main` | `/finalize` step 3 (after fetch) | Yes |
| `production` | `/mainToProd` step 6 (after push) | Yes |

## Testing
- Manual verification: push a branch, confirm it appears on backup repo
- Verify rulesets: attempt `git push --force backup main` — should be rejected
- Verify blocking behavior: temporarily misconfigure backup URL, confirm finalize stops
- No automated tests needed (infrastructure-only change)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/environments.md` — Add section on backup repo: URL, auth, remote setup, recovery instructions
- `docs/docs_overall/debugging.md` — Add recovery workflow: how to restore from backup repo
- `docs/docs_overall/testing_overview.md` — Minor: note that CI doesn't run on backup repo

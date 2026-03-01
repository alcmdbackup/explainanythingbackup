# Setup Mirror Repo as Backup for Finalize Command Research

## Problem Statement
Set up a mirror backup repository that the /finalize command automatically pushes to after every successful push to origin. The backup repo will be configured with non-destructive permissions (no force-push, no branch deletion) to serve as an emergency recovery source. This ensures code is always preserved in a secondary location regardless of what happens to the primary repository. The implementation adds a single backup push step to the finalize command with best-effort semantics (failures don't block finalize).

## Requirements (from GH Issue #TBD)
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
[Summary of findings]

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/docs_overall/testing_overview.md
- docs/docs_overall/environments.md
- docs/docs_overall/debugging.md

## Code Files Read
- .claude/commands/finalize.md (finalize skill — 840-line workflow)
- .git/config (single `origin` remote to Minddojo/explainanything.git)

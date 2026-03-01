# Setup Mirror Repo as Backup for Finalize Command Plan

## Background
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

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
[Concise but thorough list of options]

## Phased Execution Plan
[Incrementally executable milestones]

## Testing
[Tests to write or modify, plus manual verification on stage]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` - May need CI/CD section updates if backup push is added to workflows
- `docs/docs_overall/environments.md` - May need new section documenting the backup remote and auth setup
- `docs/docs_overall/debugging.md` - May need recovery instructions using the backup repo

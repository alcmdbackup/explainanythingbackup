# Questions About Long Running Evolution Runs Progress

## Phase 1: Immediate Unblock (`--include-all`)
### Work Done
- Added `--include-all` flag to `supabase db push` in both staging and production jobs
- Added `--dry-run` preview step before each push for visibility
- File: `.github/workflows/supabase-migrations.yml`

## Phase 2: Auto-Rename GitHub Action
### Work Done
- Created `.github/workflows/migration-reorder.yml`
- Triggers on PRs to main touching `supabase/migrations/**`
- Detects new files with timestamps <= main's latest, renames via `git mv`
- Auto-commits using `stefanzweifel/git-auto-commit-action@v7`
- GITHUB_TOKEN commits don't trigger CI loops (built-in protection)

## Phase 3: Branch Protection Documentation
### Work Done
- Added REQUIRED comment block in `migration-reorder.yml` explaining the branch protection dependency
- Added "Migration Deployment" section to `docs/evolution/reference.md`
- Manual step: enable "Require branches to be up to date before merging" in GitHub repo settings

## Phase 4: Pre-Commit Hook
### Work Done
- Created `.githooks/pre-commit` — blocks commits with stale migration timestamps
- Shows suggested `git mv` fix commands and `--no-verify` bypass
- Added `"prepare": "git config core.hooksPath .githooks || true"` to `package.json`
- Auto-installs on `npm install`

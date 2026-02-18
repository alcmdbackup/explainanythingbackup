# Fix Supabase Migration Deployment Failures Plan

## Background
Production evolution runs hit `Could not find the table 'public.evolution_agent_invocations' in the schema cache` because Supabase migration deployments have been failing since Feb 8. The root cause is out-of-order migration timestamps from parallel branches — `supabase db push` refuses to apply migrations with timestamps earlier than the last applied migration, blocking ALL subsequent migrations.

## Requirements (from GH Issue #458)
1. Unblock production migration deployments immediately
2. Prevent out-of-order timestamp conflicts from recurring
3. Add early warning for developers creating migrations on branches

## Problem
Parallel feature branches create Supabase migration files with timestamps based on when the branch was created, not when it merges to main. When Branch B merges a migration with timestamp `20260215000001` after Branch A's `20260215000005` is already applied, `supabase db push` refuses to apply any pending migrations. This has caused 10+ deployment failures across staging and production since Feb 8, with at least 7 manual fix commits (rename PRs #414, #445, #447, #397). Production has been stuck since Feb 13.

## Options Considered

1. **`--include-all` flag** — Add to `supabase db push` in workflow. Officially recommended by Supabase maintainer. Safe for our independent DDL migrations. 5-second fix.
2. **GitHub Action auto-rename** — PR-level workflow that detects new migrations with timestamps before main's latest and auto-renames them. No existing tool exists; must build custom (~20 lines of bash).
3. **"Require branches to be up to date"** — Branch protection setting that forces PRs to rebase on main before merging. Ensures the auto-rename Action re-runs after competing PRs merge.
4. **Git pre-commit hook** — Local hook blocking commits with stale migration timestamps. Early warning but not a reliable gate (can be skipped).
5. **GitHub merge queue** — REJECTED. Requires Enterprise Cloud ($21/user/mo) for private repos. Read-only queue branches break auto-rename. Overkill for team size.
6. **Squash migrations on merge** — REJECTED. Pushes directly to main post-merge, risks recursive workflows, loses rollback granularity.

## Phased Execution Plan

### Phase 1: Immediate Unblock (5 minutes)
**Goal**: Unblock production and staging migration deployments.

1. Edit `.github/workflows/supabase-migrations.yml`:
   - Line 78: `supabase db push` → `supabase db push --include-all` (staging)
   - Line 135: `supabase db push` → `supabase db push --include-all` (production)
2. Optionally add `--dry-run` preview step before the actual push
3. Commit and push to main to trigger staging deploy
4. Merge main → production to trigger production deploy
5. **Verify**: Check that all pending migrations (including `20260212000001_evolution_agent_invocations`) are applied

### Phase 2: Auto-Rename GitHub Action (30 minutes)
**Goal**: Prevent future out-of-order timestamps at PR time.

1. Create `.github/workflows/migration-reorder.yml`:
   - Trigger: `pull_request` on `main`, types `[opened, synchronize]`, paths `supabase/migrations/**`
   - Permissions: `contents: write`
   - Steps:
     a. Checkout PR branch (`ref: ${{ github.head_ref }}`, `fetch-depth: 0`)
     b. `git diff --diff-filter=A` to find new migration files
     c. `git ls-tree origin/main` to get latest timestamp on main
     d. For each new file with timestamp <= main's latest: `git mv` to `(latest + N)_description.sql`
     e. Commit via `stefanzweifel/git-auto-commit-action@v7`
2. Commits with `GITHUB_TOKEN` don't trigger CI loops (built-in protection)

### Phase 3: Branch Protection (2 minutes)
**Goal**: Ensure Layer 2 re-runs when competing PRs merge.

1. GitHub repo Settings → Branches → main protection rule
2. Enable "Require branches to be up to date before merging"
3. This forces PRs to rebase on main after a competing PR merges, triggering the `synchronize` event which re-runs the auto-rename Action

### Phase 4: Pre-Commit Hook (15 minutes, optional)
**Goal**: Early local warning for developers.

1. Create `.githooks/pre-commit`:
   - Check staged migration files against `origin/main` latest timestamp
   - Block commit (exit 1) if timestamp is stale
   - Show suggested fix and `--no-verify` bypass
2. Add to `package.json`: `"prepare": "git config core.hooksPath .githooks || true"`
3. Auto-installs on `npm install`

## Testing

### Phase 1 verification
- [ ] Trigger migration workflow manually via `workflow_dispatch` with environment=staging
- [ ] Verify `supabase migration list` shows all migrations applied on staging
- [ ] Check production `evolution_agent_invocations` table exists after production deploy
- [ ] Verify dashboard Timeline tab loads without errors

### Phase 2 verification
- [ ] Create a test PR with a migration file with an old timestamp (e.g., `20260101000001_test.sql`)
- [ ] Verify the Action auto-renames it and commits back to the PR branch
- [ ] Verify CI does not enter an infinite loop
- [ ] Test with multiple conflicting migrations in one PR
- [ ] Test with a PR that already has correct timestamps (no rename needed)

### Phase 3 verification
- [ ] Merge a PR with a migration to main
- [ ] Open a second PR with an older migration timestamp
- [ ] Verify GitHub shows "This branch is out-of-date" warning
- [ ] Rebase the second PR and verify the rename Action runs

### Phase 4 verification
- [ ] Run `npm install` and verify `.githooks/pre-commit` is installed via `git config core.hooksPath`
- [ ] Stage a migration file with a stale timestamp and verify commit is blocked
- [ ] Verify `--no-verify` bypasses the hook

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/evolution/reference.md` - Add note about `--include-all` deployment and migration ordering
- `.github/workflows/supabase-migrations.yml` - Updated with `--include-all` flag

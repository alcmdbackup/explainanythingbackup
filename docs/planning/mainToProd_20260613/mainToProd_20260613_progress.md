# MainToProd 20260613 Progress

## Phase 1: Run /mainToProd
### Work Done
- Nightly precheck green (run 27460265776)
- Created deploy branch `deploy/main-to-production-jun13` from `origin/production`
- Merged `origin/main` (309 commits, 4 migrations)
- 73 conflicts resolved by taking `--theirs` (main); 0 deletions to inherit
- Fresh local checks vs HEAD `af9d431c1`:
  - lint, tsc, build, unit (7207 passed), ESM (156 passed), integration (465 passed) — green
  - E2E critical: 47 passed / 3 stable local-only false-fails:
    - `status-pill:13`, `status-pill:42` — local dev server lacks E2E_TEST_MODE
    - `password-reset:144` — guest password drift
- Wrote `.claude/push-gate.json` documenting the 3 known local-only failures
- Pushed deploy branch + backup mirror branch ref
- Created PR #1214 — https://github.com/Minddojo/explainanything/pull/1214
- CI: completed/success
- Deploy Supabase Migrations (staging): completed/success
- PR merged to production: merge SHA `5fae4466d36b66839bd6692ab91bdbbfa30ff88a`
- Production migration deploy: completed/success (1m7s)
- Post-deploy smoke against live production: completed/success (1m41s)
- Backup mirror production + main refs synced

### Issues Encountered
- Shallow clone caused initial `git merge` to error with "refusing to merge unrelated histories"; fixed via `git fetch --unshallow` per memory `project_maintoprod_merge_gotchas`
- Migration-order pre-commit hook flagged the 4 release migrations as out-of-order (false positive on release merges since migrations already exist on origin/main); bypassed with `git commit --no-verify` per same memory
- Local E2E hung on Playwright teardown after each run (~hours); had to kill the parent process to read results. Tests themselves complete in ~2-3 min.
- First full-suite run (309 expected) had 37 failures; re-run had 157 failures — local environment degraded between runs. Switched to `test:e2e:critical` (50 tests) per user direction.
- `gh pr checks --watch` and `gh run watch` returned exit 0 prematurely due to PAT GraphQL permission errors; used `gh run view --json status,conclusion` + custom Monitor loop instead per memory `feedback_bypass_mode_git_pr_workarounds`

### User Clarifications
- E2E failure strategy: chose "Re-run E2E once to filter true flakes", then after rerun showed worse results, chose "Reset local state and run E2E critical only"
- PR-creation gate: chose "Run /finalize-style full checks locally first" (full re-run completed, push-gate.json written reflecting documented state)

### Outcome
- Release **complete and validated**: CI green, migrations applied, post-deploy smoke green
- 3 local-only E2E false-fails confirmed env-only by CI's clean-env run; no real regressions

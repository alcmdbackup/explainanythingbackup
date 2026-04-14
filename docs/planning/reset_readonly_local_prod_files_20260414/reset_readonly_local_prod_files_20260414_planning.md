# Reset Readonly Local Prod Files Plan

## Background
I want to restore the accidentally deleted prod readonly and local readonly files that let Claude Code query Supabase dev and prod respectively. Give me queries to retrieve passwords and then recreate the files for me in exploreanything-worktree0, worktree_37_1, ... worktree_37_x. Also, make sure that @reset_worktrees copies over this file when it is run.

## Requirements (from GH Issue #NNN)
I want to restore the accidentally deleted prod readonly and local readonly files that let Claude Code query Supabase dev and prod respectively. Give me queries to retrieve passwords and then recreate the files for me in exploreanything-worktree0, worktree_37_1, ... worktree_37_x. Also, make sure that @reset_worktrees copies over this file when it is run.

## Problem
`.env.staging.readonly` was deleted and its password was nowhere on disk (confirmed by sweeping worktrees, shell history, psql history, and Claude session transcripts). `.env.prod.readonly` still existed in the main worktree but was missing from all 15 sibling worktrees. Research showed the `reset_worktrees` script already copies both files (no code change needed), so the problem reduces to: recover/reset the staging password, create the file once in the main worktree, and fan it out to siblings.

## Options Considered
- [x] **Option A: Retrieve from disk/history** — swept worktrees, shell + psql history, and `~/.claude/projects/*/*.jsonl`. Found three historical candidates, all rejected by current DB. *Retrieval impossible once rotated.*
- [x] **Option B: Reset via SQL editor (`ALTER ROLE`)** — attempted multiple times with different passwords and `password_encryption = 'scram-sha-256'`. Persistently failed *during this session* with `SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing`.
- [x] **Option C: Reset via Dashboard → Roles UI (CHOSEN)** — succeeded on first attempt. User later observed another worktree recover without a further reset, suggesting intermittent Supavisor/Postgres propagation delay rather than a deterministic "UI required" behavior.

## Phased Execution Plan

### Phase 1: Recover/reset staging password ✓
- [x] Sweep disk + transcripts for existing password (all 3 historical candidates rejected)
- [x] Confirm staging pooler host = `aws-0-us-east-1.pooler.supabase.com:5432` (distinct from prod's `aws-1-us-east-2`)
- [x] Attempt `ALTER ROLE` via SQL editor — persistently failed SASL during this session
- [x] Reset password via Dashboard → Settings → Database → Roles UI (worked) — later observation suggests this was intermittent Supavisor propagation, not a hard requirement

### Phase 2: Create and distribute readonly files ✓
- [x] Write `.env.staging.readonly` in `explainanything-worktree0` with correct pooler URL
- [x] Verify `npm run query:staging` returns data (`count: 35237`)
- [x] Verify readonly enforcement (`DELETE` → `permission denied`)
- [x] Copy `.env.prod.readonly` to `worktree_37_1` … `worktree_37_15`
- [x] Copy `.env.staging.readonly` to `worktree_37_1` … `worktree_37_15`
- [x] Verify all 16 worktrees now contain both files

### Phase 3: Confirm `reset_worktrees` propagation (no code change) ✓
- [x] Confirm `reset_worktrees:155-161` already includes `.env.prod.readonly` and `.env.staging.readonly` in its copy list
- [x] Confirm `$GIT_ROOT = git rev-parse --show-toplevel` resolves to main worktree regardless of invocation dir
- [x] Confirm the `[ -f ]` guard silently skips missing files (so partial state is safe)

### Phase 4: Documentation updates (deferred)
- [ ] *(optional)* Short note in `docs/docs_overall/debugging.md` about intermittent `SASL: SCRAM-SERVER-FINAL-MESSAGE: server signature is missing` after password changes (usually self-resolves; Dashboard Roles UI reset can nudge propagation)
- [ ] *(optional)* Refresh stale host in `.env.prod.readonly.example` (direct-connection → pooler) and `.env.staging.readonly.example` (wrong region) OR replace with `<POOLER_HOST>` placeholder

## Testing

### Unit Tests
- [ ] None needed — pure ops + config change; `scripts/query-db.ts` logic unchanged.

### Integration Tests
- [ ] None needed.

### E2E Tests
- [ ] None needed.

### Manual Verification ✓
- [x] `npm run query:prod -- "SELECT 1"` → `✅ Connected to production (read-only)` + `1`
- [x] `npm run query:staging -- "SELECT count(*) FROM explanations"` → `35237`
- [x] `npm run query:staging -- "DELETE FROM explanations WHERE 1=0"` → `permission denied for table explanations` (enforcement working)
- [x] `for i in 0..15; check both files present` → all 16 worktrees YES/YES

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes.

### B) Automated Tests
- [x] `npm run query:prod -- "SELECT 1 AS ok"` (manual, documented above)
- [x] `npm run query:staging -- "SELECT count(*) FROM explanations"` (manual, documented above)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] docs/docs_overall/debugging.md — brief note on what may change
- [ ] docs/docs_overall/environments.md — .env.prod.readonly / .env.staging.readonly setup section may need clarification
- [ ] docs/docs_overall/cloud_env.md — brief note on what may change
- [ ] docs/docs_overall/testing_overview.md — brief note on what may change
- [ ] docs/feature_deep_dives/testing_setup.md — brief note on what may change
- [ ] evolution/docs/README.md — brief note on what may change
- [ ] evolution/docs/architecture.md — brief note on what may change
- [ ] evolution/docs/data_model.md — brief note on what may change
- [ ] evolution/docs/arena.md — brief note on what may change
- [ ] evolution/docs/rating_and_comparison.md — brief note on what may change
- [ ] evolution/docs/strategies_and_experiments.md — brief note on what may change
- [ ] evolution/docs/cost_optimization.md — brief note on what may change
- [ ] evolution/docs/metrics.md — brief note on what may change
- [ ] evolution/docs/logging.md — brief note on what may change
- [ ] evolution/docs/visualization.md — brief note on what may change
- [ ] evolution/docs/curriculum.md — brief note on what may change
- [ ] evolution/docs/entities.md — brief note on what may change
- [ ] evolution/docs/reference.md — brief note on what may change
- [ ] evolution/docs/minicomputer_deployment.md — brief note on what may change
- [ ] evolution/docs/agents/overview.md — brief note on what may change

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

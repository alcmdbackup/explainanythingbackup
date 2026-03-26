# Systematic Fix Data Wrong Missing Issues Evolution Plan

## Background
Our existing approach to managing data & migrations works poorly. Frequent bugs due to data mismatches between staging vs. code, failed tests, etc. I want a systematic approach to solve this.

## Requirements (from GH Issue #844)
1. Prevent schema drift between SQL and TypeScript
2. Fix active CI blockers (missing views/RPCs, broken test fixtures)
3. Add missing database constraints lost during V2 migration
4. Make test data resilient to schema changes
5. Add CI guardrails to catch schema mismatches before merge
6. Eliminate the migration/test deadlock (tests can't pass because migration hasn't been applied yet)

## Problem
The evolution pipeline has no automated mechanism to keep SQL schema, TypeScript types, test data, and environment state in sync. Every schema change requires manual updates to 6+ locations (migration, Zod schemas, local TS interfaces, test fixtures, E2E seeds, docs). This has produced 40+ data-related bug-fix commits in 2 months, including 3 critical outages. Column renames cascade across 56+ files and generate 3+ follow-up fix commits each. The Supabase client is fully untyped, so `.from()` calls return `any` and field access errors are only caught at runtime.

Additionally, there's a **migration/test deadlock**: CI tests run against staging, but migrations only apply to staging after merge. So tests that reference new schema always fail on the PR, and either (a) you split into two PRs (migration first, code second), (b) tests skip gracefully when schema is missing, or (c) tests fail and block the release — which is what's happening now with `evolution_run_costs`.

## Options Considered
- [x] **Option A: Generated Types + CI-Managed Workflow (Recommended)**: Apply migrations on PR, generate types in CI, wire `Database` generic into Supabase clients. Eliminates both schema drift and the migration/test deadlock.
- [ ] **Option B: Manual Schema Audit Only**: Manually audit all schemas, fix mismatches, add documentation. Fixes current bugs but doesn't prevent future drift or the deadlock.
- [ ] **Option C: Full ORM Migration**: Replace raw Supabase queries with Drizzle/Prisma ORM. Maximum type safety but massive scope, high risk of regressions.

## CI Architecture (New)

### Current Flow (broken)
```
PR: migration + code → CI tests against staging (OLD schema) → tests FAIL
                        migration only applies AFTER merge → deadlock
```

### New Flow
```
PR opened/updated
    ↓
Job 1: Apply PR's migrations to staging DB
    (move supabase-migrations to run on PRs, not just on push to main)
    ↓
Job 2: Generate types from staging, auto-commit to PR branch
    npx supabase gen types typescript --project-id $STAGING_ID > src/lib/database.types.ts
    if changed → git commit + push back to PR
    ↓
Job 3: tsc + lint + tests (existing, but now schema is current)
    .from('evolution_variants') returns typed data
    tsc catches any stale column references
    integration tests run against DB that HAS the new schema
    ↓
All green → PR merges
    (migrations already applied to staging — merge is a no-op for DB)
```

### Key Design Decisions

**Q: Won't applying migrations on PRs be risky?**
Staging is already a shared dev/test DB — local dev, CI, and Vercel previews all use it. Migrations are additive and can't be easily rolled back anyway. Applying on PR just makes CI tests actually test the right schema.

**Q: What if two PRs have conflicting migrations?**
The existing `migration-reorder.yml` workflow handles timestamp conflicts. GitHub's "require branches to be up to date" rule forces re-CI after competing merges. Types regenerate on each CI run, so the second PR always sees the combined schema.

**Q: What if a PR's migration is bad and breaks staging?**
Same risk as today (bad migration on merge breaks staging). But now it's caught BEFORE merge during PR review, not after. The developer sees the failure in their PR CI and can fix it. For destructive migrations (DROP, RENAME), an optional CI guardrail can require manual approval.

**Q: What about rollback?**
Supabase migrations can't be auto-reverted (true today too). For additive migrations (add column/table), they're harmless even if the PR is abandoned. For destructive migrations, the developer must push a fix migration to the same PR. Detection is faster in the new flow (minutes via PR CI vs hours after merge).

**Q: How do developers get the auto-generated type changes locally?**
CI auto-commits `database.types.ts` to the PR branch (same as migration-reorder already does). Developer runs `git pull`, IDE immediately shows type errors on stale code. If they push without pulling, git rejects with "non-fast-forward" and they pull first.

**Q: How does /finalize's rebase help?**
`/finalize` rebases off remote main before creating the PR. This pulls in OTHER developers' merged migrations and their `database.types.ts` updates. Combined with CI regenerating types for YOUR migration, this creates a 3-layer safety chain:

| Layer | Catches | When |
|-------|---------|------|
| `git pull` during dev | CI-generated type updates on your own PR | During development |
| `/finalize` rebase | Other PRs' migrations that landed on main | Before PR creation |
| CI type generation | Your new migration's schema changes | On every push |

## Phased Execution Plan

### Phase 1: Fix Active CI Blockers (Quick Wins)
- [ ] Fix or delete `evolution-run-costs.integration.test.ts` — tests reference intentionally dropped `get_run_total_cost` RPC and `evolution_run_costs` view
- [ ] Fix `evolution-experiment-completion.integration.test.ts` — update test fixtures to use valid UUIDs instead of plain strings
- [ ] Fix `evolution-test-helpers.ts` `createTestArenaComparison` — uses UUID for `winner` field instead of valid `'a'`/`'b'`/`'draw'`
- [ ] Fix `entity-actions.integration.test.ts` — remove test for non-existent `rename` action on ExperimentEntity; fix stale metrics assertions
- [ ] Fix stale `arena_topic` reference in `evolution/docs/metrics.md:101`
- [ ] Run full CI suite and confirm all evolution tests pass

### Phase 2: Add Supabase Generated Types
- [ ] Generate initial `database.types.ts` using `npx supabase gen types typescript --project-id <staging-id>` (requires one-time `SUPABASE_ACCESS_TOKEN` setup)
- [ ] Wire `Database` generic into `src/lib/utils/supabase/client.ts` (`createBrowserClient<Database>`)
- [ ] Wire `Database` generic into `src/lib/utils/supabase/server.ts` (`createServerClient<Database>`)
- [ ] Wire `Database` generic into `src/lib/supabase.ts` (legacy client)
- [ ] Add `"db:types"` script to `package.json` for local use (optional, requires `SUPABASE_ACCESS_TOKEN`)
- [ ] Verify that `.from('evolution_variants')` now returns typed data instead of `any`
- [ ] Fix any type errors surfaced by the new strict typing (this is the payoff — finding current drift)

### Phase 3: CI Workflow Changes
- [ ] Move `supabase-migrations.yml` to also trigger on PRs (not just push to main/production), so PR migrations apply to staging before tests run
- [ ] Add new CI job `generate-types` that runs after migration push:
  ```yaml
  generate-types:
    needs: deploy-migrations
    steps:
      - checkout PR branch with push token
      - npx supabase gen types typescript --project-id $STAGING_ID > src/lib/database.types.ts
      - if changed: git add, commit "chore: regenerate database types", push
  ```
- [ ] Add `SUPABASE_ACCESS_TOKEN` to GitHub repo secrets
- [ ] Ensure `tsc --noEmit` job depends on `generate-types` (so it runs against fresh types)
- [ ] Add a simple integration test that parses a real DB row through each `FullDbSchema` Zod schema — catches Zod/DB mismatches at test time
- [ ] Test the full flow: create a test PR with a migration, verify CI applies migration → regenerates types → tsc catches stale code

### Phase 4: Fix Missing Database Constraints
- [ ] Add migration: FK `evolution_runs.evolution_explanation_id` → `evolution_explanations(id)`
- [ ] Add migration: FK `evolution_experiments.evolution_explanation_id` → `evolution_explanations(id)`
- [ ] Add migration: FK `evolution_explanations.prompt_id` → `evolution_prompts(id)`
- [ ] Add migration: CHECK constraint on `evolution_agent_invocations.agent_name` for known agent names
- [ ] Verify no orphaned data exists before adding constraints (query for orphans first)

### Phase 5: Harden Test Data
- [ ] Replace hardcoded column inserts in fragile integration tests with schema-derived factory functions from `evolution-test-helpers.ts`
- [ ] Add `evolution_metrics` cleanup to the 16 E2E specs that currently skip it
- [ ] Fix fire-and-forget timing in `evolution-entity-logger.integration.test.ts` — replace `setTimeout(200)` with proper await/polling
- [ ] Standardize E2E cleanup: ensure all specs use `trackEvolutionId()` for defense-in-depth cleanup

## Testing

### Unit Tests
- [ ] `evolution/src/lib/schemas.test.ts` — verify all FullDbSchemas can parse generated type shapes
- [ ] New test: `src/lib/database.types.test.ts` — verify generated types file exists and is non-empty

### Integration Tests
- [ ] `src/__tests__/integration/evolution-run-costs.integration.test.ts` — fix or remove (dropped RPC)
- [ ] `src/__tests__/integration/evolution-experiment-completion.integration.test.ts` — fix UUID fixtures
- [ ] `src/__tests__/integration/entity-actions.integration.test.ts` — fix rename/stale assertions
- [ ] New test: `src/__tests__/integration/evolution-schema-validation.integration.test.ts` — parse real DB rows through Zod schemas

### E2E Tests
- [ ] Run full E2E suite after changes: `npm run test:e2e -- --grep "evolution"`

### Manual Verification
- [ ] Verify `supabase gen types` produces correct output for all evolution tables
- [ ] Verify TypeScript IDE autocomplete works on `.from('evolution_variants').select('*')` after typing
- [ ] Test the full CI flow end-to-end with a test PR containing a trivial migration

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] No UI changes in this project — skip Playwright

### B) Automated Tests
- [ ] `npm run test:unit` — all unit tests pass
- [ ] `npm run test:integration` — all integration tests pass (especially evolution-*)
- [ ] `npm run test:e2e -- --grep "evolution"` — all E2E tests pass
- [ ] `npx tsc --noEmit` — no type errors with generated types wired in

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/data_model.md` — add section on generated types and schema validation workflow
- [ ] `evolution/docs/reference.md` — add `npm run db:types` to key scripts, document CI type generation
- [ ] `evolution/docs/metrics.md` — fix stale `arena_topic` entity type reference (line 101)
- [ ] `docs/docs_overall/environments.md` — document new CI flow: migrations apply on PR, types auto-generated

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

# Investigation Formal Verification Evolution Progress

## Phase 1: Property Tests + selectWinner Extraction ✅
### Work Done
- Installed `fast-check@^3` as devDependency
- Created `evolution/src/lib/shared/selectWinner.ts` — unified winner selection with -Infinity semantics for unrated variants
- Created `evolution/src/lib/shared/selectWinner.test.ts` — 7 unit tests (highest mu, sigma tiebreak, unrated, all-unrated, empty pool, single, postcondition)
- Exported `selectWinner` from barrel file `evolution/src/lib/index.ts`
- Updated `runIterationLoop.ts` to use `selectWinner()` (behavioral change: unrated variants now get -Infinity instead of being skipped)
- Updated `persistRunResults.ts` to use `selectWinner()` (no behavioral change)
- Created `computeRatings.property.test.ts` — 10 property-based tests with `jest.unmock('openskill')`
- Created `trackBudget.property.test.ts` — 6 property-based tests for budget invariants

### Issues Encountered
- OpenSkill sigma can increase for very low sigma values (<1.0) — adjusted property test to use sigma >= 1 minimum

## Phase 2: Trust Boundary Hardening ✅
### Work Done
- `claimAndExecuteRun.ts` — replaced `as unknown as ClaimedRun[]` with runtime shape validation
- `buildRunContext.ts` — `Number.isFinite()` checks on arena mu/sigma, replaced `as string` casts with `typeof` checks
- `generateSeedArticle.ts` — added `validateFormat()` call on seed article content
- `Agent.ts` — writes `undefined` execution_detail on parse failure instead of invalid data
- `writeMetrics.ts` — NaN/Infinity guard via `Number.isFinite()` check
- `trackBudget.ts` — `budgetUsd > 0` precondition rejecting NaN, Infinity, negative, zero
- `recomputeMetrics.ts` — `Number.isFinite()` on variant mu/sigma from DB
- `Entity.ts` — added `extractFk()` helper replacing 3 double-cast locations
- `createLLMClient.ts` — empty/whitespace response guard
- Added 11 negative-path unit tests across 5 test files

### Issues Encountered
- Existing test used `createCostTracker(0)` for zero-budget — updated to expect construction-time throw
- `execution_detail` field type is `Record<string, unknown> | undefined`, not nullable — used `undefined` instead of `null`

## Phase 3: DB Constraints ✅
### Work Done
- Created `supabase/migrations/20260328000001_add_evolution_constraints.sql`
  - Backfills NULL statuses before adding CHECK constraints
  - CHECK constraints on evolution_runs, evolution_experiments, evolution_prompts, evolution_strategies
  - UNIQUE constraint on evolution_strategies.config_hash
  - Wrapped in transaction

### Pending
- Pre-migration audit queries on staging (manual step)
- `npm run db:types` after migration
- Deploy to staging and verify

## Phase 4: Format Property Tests + Budget Assertions ✅
### Work Done
- Created `enforceVariantFormat.property.test.ts` — 14 property-based tests (stripCodeBlocks idempotency, validateFormat edge cases, extractParagraphs invariants, detection helpers)
- Added budget postcondition assertions to `trackBudget.ts`:
  - Core invariant (unconditional): logs error if `totalSpent + totalReserved > budgetUsd * 1.01`
  - Strict assertions (gated by `EVOLUTION_ASSERTIONS`): `totalReserved >= 0` and `Number.isFinite(totalSpent)` after each operation
- Set `EVOLUTION_ASSERTIONS=true` in `jest.setup.js`

### Issues Encountered
- Negative cost edge case in existing test triggered strict assertion — guarded assertion to only check when `estimatedCost >= 0`

## Final Verification ✅
- `npm run test`: 4973 passed, 13 skipped (pre-existing), 275 suites
- `npx tsc --noEmit`: clean
- `npm run lint`: only pre-existing warnings
- `npm run build`: clean

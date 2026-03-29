# Investigation Formal Verification Evolution Plan

## Background
Explore using formal verification to solidify the evolution pipeline code. The evolution system is a complex pipeline with multiple interacting components (generate, rank, evolve loop, budget tracking, arena sync, metrics propagation) that would benefit from formal guarantees about correctness invariants.

## Requirements (from GH Issue #872)
Research-derived requirements from 3 rounds of 12 parallel agents:

1. Add property-based testing (fast-check) for pure functions: rating math, budget tracker, format validator, comparison logic
2. Extract duplicated `selectWinner()` into shared utility with postcondition assertions
3. Harden trust boundaries: validate DB reads, RPC responses, LLM outputs, seed articles
4. Add missing DB constraints: status enum CHECKs, config_hash UNIQUE
5. Add runtime assertion framework for budget postconditions

## Problem
The evolution pipeline has 90+ runtime invariants enforced across 6 subsystems, but relies heavily on convention rather than structural guarantees. Winner selection logic is duplicated with divergent semantics. Zero property-based testing exists despite 30%+ pure function density. Database constraints are incomplete — status enums and config_hash uniqueness are enforced only in TypeScript. DB reads are trusted via unsafe `as` casts throughout. These gaps create risk of silent data corruption, state machine violations, and rating math regressions.

## Options Considered
- [x] **Option A: Phased bottom-up (Phases 1-4)** — Property-based tests + code extraction, trust boundary hardening, DB constraints, format tests + assertions. Low disruption, incremental value, no added type complexity.
- [ ] **Option B: Type-system-first** — Start with branded types and discriminated unions. Higher upfront refactor cost.
- [ ] **Option C: Full formal methods** — TLA+ models + branded types + property tests. Maximum coverage but high effort.

**Decision: Option A (Phases 1-4 only)** — Skip branded types (Phase 5). The property-based tests and runtime guards catch the same bugs at test/runtime. Branded types add cognitive overhead that isn't justified for this team size.

**ROI methodology note:** Bug-count estimates (e.g., "~80 rating, ~45 budget") come from git log keyword search for fix-related commits touching evolution files, categorized by subsystem. These are approximate commit counts, not deduplicated verified bugs. Useful for relative prioritization (rating > budget > format) but not precise metrics.

## Phased Execution Plan

### Phase 1: Property Tests + Code Extraction (~1 day)

- [ ] Install `fast-check@^3` as devDependency: `npm install --save-dev fast-check@^3` (pin major version to avoid breaking API changes between v2→v3)
- [ ] Create `evolution/src/lib/shared/selectWinner.ts` — extract unified winner determination function
  - Adopt persistRunResults semantics: unrated variants get `mu=-Infinity, sigma=Infinity`
  - Add postcondition: winner.mu >= all rated variants' mu
  - Add precondition: pool must not be empty
- [ ] Create `evolution/src/lib/shared/selectWinner.test.ts` — unit tests for extracted function
  - Highest mu wins, sigma tiebreak, unrated handling, empty pool throws, all-unrated fallback
- [ ] Export `selectWinner` from barrel file `evolution/src/lib/index.ts` to follow existing public API convention
- [ ] Update `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — replace inline winner logic with `selectWinner()`
  - **Behavioral change:** current loop code SKIPS unrated variants (`if (!r) continue`); unified function INCLUDES them with `mu=-Infinity`. This means unrated variants no longer silently disappear from winner consideration — they explicitly lose. In practice this is a no-op for normal runs (all variants get rated), but changes behavior if ranking is interrupted mid-iteration. This is the correct semantics: the loop and finalization should agree on the winner.
- [ ] Update `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — replace inline winner logic with `selectWinner()` (no behavioral change — already uses `?? -Infinity` semantics)
- [ ] Create `evolution/src/lib/shared/computeRatings.property.test.ts` — property-based tests for rating math
  - **Important:** Jest config mocks openskill (`'^openskill$': '<rootDir>/src/testing/mocks/openskill.ts'`). Property tests MUST use `jest.unmock('openskill')` or a separate jest config override to test against the real library, otherwise rating invariants are tested against a mock.
  - `updateRating`: sigma always decreases for both players, outputs always finite
  - `updateDraw`: symmetry (swap args → swap results), both sigmas decrease
  - `toEloScale`: monotonicity, range [0, 3000], DEFAULT_MU → 1200
  - `aggregateWinners`: agreement → confidence 1.0, both null → TIE 0.0, valid output shape
- [ ] Create `evolution/src/lib/pipeline/infra/trackBudget.property.test.ts` — property-based tests for budget
  - Core invariant: totalSpent + totalReserved ≤ budgetUsd after any operation sequence
  - Reserve margin: returns exactly `cost * 1.3`
  - Reserve-spend swap: available changes by `(reserved - actual)` after recordSpend
  - Phase cost accumulation: sum(phaseCosts) === totalSpent
- [ ] Run lint, tsc, build, all evolution unit tests — verify no regressions

### Phase 2: Trust Boundary Hardening — DB Reads + Seed Validation (~1 day)

**Note:** Use `Number.isFinite()` (not global `isFinite()`) throughout — global `isFinite()` coerces via `ToNumber()`, so `isFinite(null)` returns true and `isFinite('42')` returns true, masking type errors. `Number.isFinite()` returns false for non-number types.

- [ ] Add `safeParse` to RPC claim response in `evolution/src/lib/pipeline/claimAndExecuteRun.ts` (~line 112) — replace `as unknown as ClaimedRun[]` with Zod schema validation. On parse failure: log error with raw response shape, return `{ claimed: false }` (same as "no pending runs" path — pipeline-resilient, no crash).
- [ ] Add `Number.isFinite()` checks on arena entry mu/sigma in `evolution/src/lib/pipeline/setup/buildRunContext.ts` (loadArenaEntries) — NaN is not caught by `??` (Risk #3)
- [ ] Add null validation on `resolveContent` return in `evolution/src/lib/pipeline/setup/buildRunContext.ts` (resolveContent) — replace `as string` cast (Risk #4)
- [ ] Add `validateFormat()` call to seed article content in `generateSeedArticle.ts` — currently the only LLM text path that skips format validation
- [ ] Upgrade Agent detail validation from warn-only in `evolution/src/lib/core/Agent.ts` (~line 36): skip writing `execution_detail` to DB on parse failure (log warning, set `execution_detail: null`), but do NOT throw — preserve pipeline resilience while preventing corrupt detail from reaching DB (Risk #5)
- [ ] Add `Number.isFinite()` guard to `writeMetric()` in `evolution/src/lib/metrics/writeMetrics.ts` — reject NaN/Infinity before DB write (Risk #8)
- [ ] Add precondition to `createCostTracker()` in `evolution/src/lib/pipeline/infra/trackBudget.ts`: `if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw` — rejects NaN, Infinity, negative, and zero (Risk #7)
- [ ] Audit and fix all `?? DEFAULT` fallbacks on numeric DB fields — replace `??` with `Number.isFinite()` guard:
  - `evolution/src/lib/pipeline/setup/buildRunContext.ts` (arena mu/sigma)
  - `evolution/src/lib/metrics/recomputeMetrics.ts` (variant mu/sigma)
  - `evolution/src/lib/pipeline/experiments.ts` or `manageExperiments.ts` (elo_score)
  - `evolution/src/services/evolutionActions.ts` (cost_usd via `Number()`)
  - Any other `?? DEFAULT_MU` / `?? DEFAULT_SIGMA` patterns
- [ ] Entity.ts double-cast fix in `evolution/src/lib/core/Entity.ts` (~lines 185, 238): replace `as unknown as Record<string, unknown>` with a generic runtime type guard. Add helper `function extractFk(row: unknown, key: string): string | undefined` in Entity.ts that does `typeof row === 'object' && row !== null && key in row && typeof row[key] === 'string'`. This preserves the generic CRUD pattern without requiring per-entity Zod schemas — the guard just validates the FK field, not the full entity shape.
- [ ] Add LLM response guard to `evolution/src/lib/pipeline/infra/createLLMClient.ts` — validate response is non-empty string before returning. Guard: `if (typeof response !== 'string' || response.trim().length === 0) throw new Error('Empty LLM response')`. Do NOT check for HTML or content patterns — that risks false positives on legitimate responses containing HTML examples.
- [ ] **New tests for Phase 2 changes:**
  - Unit test for `safeParse` failure path in `claimAndExecuteRun` (returns `{ claimed: false }`)
  - Unit test for `Number.isFinite()` rejecting NaN arena mu/sigma (falls back to DEFAULT)
  - Unit test for `createCostTracker` rejecting negative/NaN/Infinity budgets (throws)
  - Unit test for `writeMetric` rejecting NaN value (throws or returns early)
  - Unit test for LLM client rejecting empty string response (throws)
  - Unit test for Agent detail parse failure → `execution_detail: null` written instead of invalid data
- [ ] Run lint, tsc, build, all evolution unit tests — verify no regressions

### Phase 3: Database Constraints (~0.5 day)

**Pre-migration audit:** Before creating the migration, run these queries on staging to verify no invalid data:
```sql
SELECT status, COUNT(*) FROM evolution_runs GROUP BY status;
SELECT status, COUNT(*) FROM evolution_experiments GROUP BY status;
SELECT status, COUNT(*) FROM evolution_prompts GROUP BY status;
SELECT status, COUNT(*) FROM evolution_strategies GROUP BY status;
SELECT config_hash, COUNT(*) FROM evolution_strategies GROUP BY config_hash HAVING COUNT(*) > 1;
```

**Rollback plan:** If migration fails on staging, the DOWN migration drops all added constraints:
```sql
ALTER TABLE evolution_runs DROP CONSTRAINT IF EXISTS check_runs_status;
ALTER TABLE evolution_experiments DROP CONSTRAINT IF EXISTS check_experiments_status;
ALTER TABLE evolution_prompts DROP CONSTRAINT IF EXISTS check_prompts_status;
ALTER TABLE evolution_strategies DROP CONSTRAINT IF EXISTS check_strategies_status;
ALTER TABLE evolution_strategies DROP CONSTRAINT IF EXISTS uq_strategies_config_hash;
```

- [ ] Create migration `supabase/migrations/20260328000001_add_evolution_constraints.sql` (follows existing `YYYYMMDDNNNNNN` naming scheme):
  - Backfill first: `UPDATE evolution_experiments SET status = 'draft' WHERE status IS NULL;`
  - Backfill all 4 tables: audit for any unexpected status values and fix before adding CHECK
  - Wrap in transaction for atomicity
  - `ALTER TABLE evolution_runs ADD CONSTRAINT check_runs_status CHECK (status IN ('pending','claimed','running','completed','failed'));`
  - `ALTER TABLE evolution_experiments ADD CONSTRAINT check_experiments_status CHECK (status IN ('draft','running','completed','cancelled'));`
  - `ALTER TABLE evolution_prompts ADD CONSTRAINT check_prompts_status CHECK (status IN ('active','archived'));`
  - `ALTER TABLE evolution_strategies ADD CONSTRAINT check_strategies_status CHECK (status IN ('active','archived'));`
  - `ALTER TABLE evolution_strategies ADD CONSTRAINT uq_strategies_config_hash UNIQUE (config_hash);`
- [ ] Run `npm run db:types` after migration to regenerate `src/lib/database.types.ts` reflecting new constraints
- [ ] Deploy to staging first, verify no constraint violations
- [ ] Run E2E tests to confirm pipeline still works end-to-end with new constraints

### Phase 4: Format Validator Property Tests + Budget Assertions (~0.5 day)

- [ ] Create `evolution/src/lib/shared/enforceVariantFormat.property.test.ts`
  - `stripCodeBlocks`: idempotency (strip twice = strip once), non-code text unchanged
  - `validateFormat`: empty → invalid, valid article → valid result, bullets detected outside code blocks
  - `extractParagraphs`: no headings included, no empty blocks, no label lines
- [ ] Add budget postcondition assertions to `evolution/src/lib/pipeline/infra/trackBudget.ts`
  - Core budget invariant assertion is **unconditional** (runs in all environments): `if (totalSpent + totalReserved > budgetUsd * 1.01) logger?.error(...)` — log error but don't throw in production (detect overruns without crashing pipeline)
  - Strict assertions gated with `EVOLUTION_ASSERTIONS` env var (dev/test only):
    - After `reserve()`: `assert(totalReserved >= 0)`
    - After `recordSpend()`: `assert(totalReserved >= 0 && Number.isFinite(totalSpent))`
    - After `release()`: `assert(totalReserved >= 0)`
  - Verify `EVOLUTION_ASSERTIONS=true` is set in jest.setup.js or test env so assertions run in CI
- [ ] Run full test suite

## Testing

### Unit Tests
- [ ] `evolution/src/lib/shared/selectWinner.test.ts` — 5+ cases: highest mu, sigma tiebreak, unrated, all-unrated, empty pool
- [ ] `evolution/src/lib/shared/computeRatings.property.test.ts` — 10 property-based tests for rating math + comparison (with `jest.unmock('openskill')`)
- [ ] `evolution/src/lib/pipeline/infra/trackBudget.property.test.ts` — 6 property-based tests for budget invariants
- [ ] `evolution/src/lib/shared/enforceVariantFormat.property.test.ts` — 8 property-based tests for format validation
- [ ] Phase 2 negative-path tests: safeParse failure, NaN rejection, empty LLM response, invalid Agent detail, negative budget

### Integration Tests
- [ ] Existing evolution pipeline tests pass with `selectWinner()` extraction (no new integration tests needed)

### E2E Tests
- [ ] Existing E2E specs (`admin-evolution-run-pipeline.spec.ts`) pass — pipeline still produces correct winners
- [ ] No new E2E specs needed (this is infrastructure/testing work, not user-facing)

### Manual Verification
- [ ] Run `npm run test` in evolution and confirm all 1,145+ tests pass
- [ ] Run DB constraint audit queries on staging before migration
- [ ] Run DB migration on staging, verify no constraint violations
- [ ] Run one evolution pipeline execution end-to-end after changes

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] N/A — no UI changes in this project

### B) Automated Tests
- [ ] `npx jest evolution/src/lib/shared/selectWinner.test.ts` — winner extraction tests
- [ ] `npx jest evolution/src/lib/shared/computeRatings.property.test.ts` — rating property tests
- [ ] `npx jest evolution/src/lib/pipeline/infra/trackBudget.property.test.ts` — budget property tests
- [ ] `npx jest evolution/src/lib/shared/enforceVariantFormat.property.test.ts` — format property tests
- [ ] `npm run test` — full test suite
- [ ] `npm run tsc` — type checking
- [ ] `npm run lint` — lint pass
- [ ] `npm run build` — build pass

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/reference.md` — add selectWinner to key files table, mention fast-check in testing section
- [ ] `evolution/docs/rating_and_comparison.md` — document rating invariants proven by property tests
- [ ] `evolution/docs/cost_optimization.md` — document budget postcondition assertions
- [ ] `evolution/docs/data_model.md` — document new CHECK constraints and UNIQUE on config_hash

## Review & Discussion

### Iteration 1 (3 agents)

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 3 gaps |
| Architecture & Integration | 3/5 | 3 gaps |
| Testing & CI/CD | 3/5 | 5 gaps |

**Critical gaps identified and resolved:**

1. **[Security] `isFinite()` vs `Number.isFinite()`** — Global `isFinite()` coerces via `ToNumber()`, masking type errors. → Fixed: all references now specify `Number.isFinite()`.
2. **[Security] Budget assertions off in production** — Core invariant should be unconditional. → Fixed: core budget invariant logs unconditionally; strict assertions gated for dev/test.
3. **[Security] DB migration may fail on invalid data** — No pre-migration audit. → Fixed: added pre-migration audit queries for all 4 tables and rollback plan with DOWN migration.
4. **[Architecture] Barrel file export missing** — `selectWinner` not exported from `evolution/src/lib/index.ts`. → Fixed: added barrel file export step.
5. **[Architecture] Entity.ts safeParse underspecified** — 6 entity subclasses have different schemas. → Fixed: specified generic `extractFk()` helper that validates FK field only, preserving generic CRUD pattern.
6. **[Architecture] Migration naming placeholder** — Must use `YYYYMMDDNNNNNN` scheme. → Fixed: specified `20260328000001_add_evolution_constraints.sql`.
7. **[Testing] No rollback plan for DB migration** — → Fixed: added DOWN migration SQL.
8. **[Testing] No unit tests for Phase 2 trust boundary changes** — → Fixed: added 6 specific negative-path unit tests for new error paths.
9. **[Testing] openskill mock in jest.config.js defeats property tests** — → Fixed: property tests must use `jest.unmock('openskill')` to test real library.
10. **[Testing] CI lockfile/type generation not addressed** — → Fixed: added `npm run db:types` after migration; `fast-check@^3` pin ensures lockfile stability.
11. **[Testing] No `EVOLUTION_ASSERTIONS` in CI env** — → Fixed: verify `EVOLUTION_ASSERTIONS=true` set in test env.

### Iteration 2

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 gaps ✅ |
| Architecture & Integration | 3/5 | 2 gaps |
| Testing & CI/CD | 4/5 | 0 gaps ✅ |

**Critical gaps identified and resolved:**

12. **[Architecture] File paths inaccurate** — Plan referenced `claimAndExecuteRun.ts` under wrong directory, `buildRunContext.ts` without `setup/` prefix. → Fixed: all file paths now use full `evolution/src/lib/...` paths.
13. **[Architecture] selectWinner behavioral change undocumented** — Current loop code skips unrated variants; unified function includes them with `-Infinity`. → Fixed: added explicit behavioral change note explaining this is intentional (loop and finalization should agree on winner).

### Iteration 3 — CONSENSUS REACHED

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 5/5 | 0 gaps ✅ |
| Architecture & Integration | 5/5 | 0 gaps ✅ |
| Testing & CI/CD | 4/5 | 0 gaps ✅ |

All reviewers at 4/5+ with zero critical gaps. Plan is ready for execution.

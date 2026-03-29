# Investigation Formal Verification Evolution Plan

## Background
Explore using formal verification to solidify the evolution pipeline code. The evolution system is a complex pipeline with multiple interacting components (generate, rank, evolve loop, budget tracking, arena sync, metrics propagation) that would benefit from formal guarantees about correctness invariants.

## Requirements (from GH Issue #872)
Research-derived requirements from 3 rounds of 12 parallel agents:

1. Add property-based testing (fast-check) for pure functions: rating math, budget tracker, format validator, comparison logic
2. Extract duplicated `selectWinner()` into shared utility with postcondition assertions
3. Add missing DB constraints: status enum CHECKs, config_hash UNIQUE, run_id FK
4. Introduce branded types for compile-time safety: ValidatedArticle, RatedVariant
5. Add runtime assertion framework for budget postconditions and pool invariants
6. (Optional) TLA+ model for concurrent run lifecycle

## Problem
The evolution pipeline has 90+ runtime invariants enforced across 6 subsystems, but relies heavily on convention rather than structural guarantees. Winner selection logic is duplicated with divergent semantics. Zero property-based testing exists despite 30%+ pure function density. Database constraints are incomplete — status enums and config_hash uniqueness are enforced only in TypeScript. These gaps create risk of silent data corruption, state machine violations, and rating math regressions.

## Options Considered
- [x] **Option A: Phased bottom-up** — Start with property-based tests and code extraction (zero-risk), then layer on types and DB constraints. Low disruption, incremental value.
- [ ] **Option B: Type-system-first** — Start with branded types and discriminated unions for compile-time safety, then backfill tests. Higher upfront refactor cost but strongest guarantees.
- [ ] **Option C: Full formal methods** — TLA+ models + property-based tests + branded types all at once. Maximum coverage but very high effort and risk of scope creep.

**Decision: Option A** — phased bottom-up approach. Each phase delivers standalone value and can stop at any point without wasted work.

**ROI methodology note:** Bug-count estimates (e.g., "~80 rating, ~45 budget") come from git log keyword search for fix-related commits touching evolution files, categorized by subsystem. These are approximate commit counts, not deduplicated verified bugs. Useful for relative prioritization (rating > budget > format) but not precise metrics.

## Phased Execution Plan

### Phase 1: Quick Wins — Property Tests + Code Extraction (~1 day)

- [ ] Install `fast-check` as devDependency: `npm install --save-dev fast-check`
- [ ] Create `evolution/src/lib/shared/selectWinner.ts` — extract unified winner determination function
  - Adopt persistRunResults semantics: unrated variants get `mu=-Infinity, sigma=Infinity`
  - Add postcondition: winner.mu >= all rated variants' mu
  - Add precondition: pool must not be empty
- [ ] Create `evolution/src/lib/shared/selectWinner.test.ts` — unit tests for extracted function
  - Highest mu wins, sigma tiebreak, unrated handling, empty pool throws, all-unrated fallback
- [ ] Update `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — replace inline winner logic with `selectWinner()`
- [ ] Update `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — replace inline winner logic with `selectWinner()`
- [ ] Create `evolution/src/lib/shared/computeRatings.property.test.ts` — property-based tests for rating math
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

### Phase 2: Database Constraints (~0.5 day)

- [ ] Create migration `supabase/migrations/YYYYMMDD_add_evolution_constraints.sql`:
  - `ALTER TABLE evolution_runs ADD CONSTRAINT check_runs_status CHECK (status IN ('pending','claimed','running','completed','failed'));`
  - `ALTER TABLE evolution_experiments ADD CONSTRAINT check_experiments_status CHECK (status IN ('draft','running','completed','cancelled'));`
  - `ALTER TABLE evolution_prompts ADD CONSTRAINT check_prompts_status CHECK (status IN ('active','archived'));`
  - `ALTER TABLE evolution_strategies ADD CONSTRAINT check_strategies_status CHECK (status IN ('active','archived'));`
  - `ALTER TABLE evolution_strategies ADD CONSTRAINT uq_strategies_config_hash UNIQUE (config_hash);`
- [ ] Backfill: `UPDATE evolution_experiments SET status = 'draft' WHERE status IS NULL;` (before CHECK)
- [ ] Verify no existing data violates constraints on staging before deploying
- [ ] Run E2E tests to confirm pipeline still works end-to-end with new constraints

### Phase 3: Format Validator Property Tests + Budget Assertions (~0.5 day)

- [ ] Create `evolution/src/lib/shared/enforceVariantFormat.property.test.ts`
  - `stripCodeBlocks`: idempotency (strip twice = strip once), non-code text unchanged
  - `validateFormat`: empty → invalid, valid article → valid result, bullets detected outside code blocks
  - `extractParagraphs`: no headings included, no empty blocks, no label lines
- [ ] Add budget postcondition assertions to `evolution/src/lib/pipeline/infra/trackBudget.ts`
  - After `reserve()`: `assert(totalReserved >= 0)`
  - After `recordSpend()`: `assert(totalReserved >= 0 && totalSpent >= 0)`
  - After `release()`: `assert(totalReserved >= 0)`
  - Gate with `process.env.NODE_ENV !== 'production'` or `EVOLUTION_ASSERTIONS` env var
- [ ] Run full test suite

### Phase 4: Branded Types (optional, ~1-2 days)

- [ ] Add `ValidatedArticle` branded type to `evolution/src/lib/types.ts`
  - `type ValidatedArticle = string & { readonly __validated: unique symbol }`
  - Update `Variant.text` type or add `validatedText` field
  - Update `validateFormat()` return to produce `ValidatedArticle | null`
  - Update generation and evolution call sites to use branded type
- [ ] Add `RatedVariant` type pattern
  - Type that guarantees `ratings.get(v.id)` is defined
  - Apply after ranking phase completes, before finalization consumes
- [ ] Run lint, tsc, build — compiler catches any missed call sites

## Testing

### Unit Tests
- [ ] `evolution/src/lib/shared/selectWinner.test.ts` — 5+ cases: highest mu, sigma tiebreak, unrated, all-unrated, empty pool
- [ ] `evolution/src/lib/shared/computeRatings.property.test.ts` — 10 property-based tests for rating math + comparison
- [ ] `evolution/src/lib/pipeline/infra/trackBudget.property.test.ts` — 6 property-based tests for budget invariants
- [ ] `evolution/src/lib/shared/enforceVariantFormat.property.test.ts` — 8 property-based tests for format validation

### Integration Tests
- [ ] Existing evolution pipeline tests pass with `selectWinner()` extraction (no new integration tests needed)

### E2E Tests
- [ ] Existing E2E specs (`admin-evolution-run-pipeline.spec.ts`) pass — pipeline still produces correct winners
- [ ] No new E2E specs needed (this is infrastructure/testing work, not user-facing)

### Manual Verification
- [ ] Run `npm run test` in evolution and confirm all 1,145+ tests pass
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
- [ ] `npm run tsc` — type checking (catches branded type issues if Phase 4 done)
- [ ] `npm run lint` — lint pass
- [ ] `npm run build` — build pass

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/reference.md` — add selectWinner to key files table, mention fast-check in testing section
- [ ] `evolution/docs/rating_and_comparison.md` — document rating invariants proven by property tests
- [ ] `evolution/docs/cost_optimization.md` — document budget postcondition assertions
- [ ] `evolution/docs/data_model.md` — document new CHECK constraints and UNIQUE on config_hash

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

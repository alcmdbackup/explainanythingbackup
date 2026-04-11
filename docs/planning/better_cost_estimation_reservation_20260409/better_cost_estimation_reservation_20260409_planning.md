# Better Cost Estimation Reservation Plan

## Background
The evolution pipeline's cost estimation for generateFromSeedArticle is inaccurate, leading to budget waste when parallel agents exceed their budgets. The current 1-token-per-4-chars heuristic and fixed output token estimates (1000 for generation, 100 for ranking) don't reflect empirical article lengths. Additionally, parallelism in the generate iteration launches all N agents simultaneously without considering remaining budget, causing agents to fail mid-execution when budget runs out. This project aims to improve cost estimation accuracy using empirical data, establish a feedback loop for estimate validation, and modify the parallel launch strategy to be budget-aware.

## Requirements (from GH Issue #945)
- Estimate the cost of generateFromSeedArticle as accurately as possible, based on model cost and empirical article lengths. This should account for both generation and ranking parts separately.
- Establish a feedback loop that allows us to evaluate the accuracy of our estimates
- Modify generateFromSeedArticle to handle parallelism more gracefully. To reduce waste, estimate how many you can launch in parallel, without going over the remaining budget. Do slightly less than this.
- In the iteration after this, set maximum parallel = 1 - i.e. go sequentially to reduce waste, until all budget is exhausted or all needed variants are generated.

## Problem
Runs with $0.05 budget spend $0.18-$0.44 actual (3.6-8.8x overruns). Root causes: (1) `OUTPUT_TOKEN_ESTIMATES` of 1000 tokens underestimates generation output by 1.5-3x (empirical: 1459-2950 tokens by strategy), (2) `recordSpend()` only logs overruns without preventing them, (3) all 9 agents launch simultaneously with no budget-awareness, and (4) the 1.3x reserve margin can't absorb a 2.5-3x underestimate. GFSA accounts for 93-100% of run cost; swiss ranking rarely gets budget.

## Convergence Threshold Change
- [x] Raise `DEFAULT_CONVERGENCE_SIGMA` from 3.0 to 4.5 in `evolution/src/lib/shared/computeRatings.ts`
- [x] Note: `CONVERGENCE_THRESHOLD` in `rankSingleVariant.ts` imports `DEFAULT_CONVERGENCE_SIGMA` directly — no separate update needed (it cascades automatically)
- [x] This reduces comparisons needed for convergence from ~59 to ~18 (3x faster)
- [x] Elo CI widens from ±94 to ±141 — acceptable for winner selection among 9 variants
- [x] **Blast radius**: Affects ALL callers of `isConverged()`, including swiss ranking via `allConverged()` in `runIterationLoop.ts`. Swiss iterations will also converge faster (wider CIs accepted). This is acceptable — swiss refinement after generation is the same quality/speed trade-off.
- [x] **Rollback plan**: The threshold is a single constant. If wider CIs lead to poor winner selection in production, revert `DEFAULT_CONVERGENCE_SIGMA` back to 3.0 in one line. Monitor via `winner_elo` metric variance across runs before/after the change. No feature flag needed — the constant change is atomic and instantly revertible.
- [x] **Tests to update**:
  - `evolution/src/lib/shared/computeRatings.test.ts` line ~115: `expect(DEFAULT_CONVERGENCE_SIGMA).toBe(3.0)` → `4.5`
  - `evolution/src/lib/pipeline/index.test.ts` line ~68: `expect(v2.DEFAULT_CONVERGENCE_SIGMA).toBe(3.0)` → `4.5`
  - Any property tests in `computeRatings.property.test.ts` that reference the threshold
- [x] Note: the wide CIs are partly due to OpenSkill's beta parameter (sigma/2 ≈ 4.167) assuming high match-outcome noise, which is overestimated for static text judging. Lowering beta is a potential follow-up optimization.

## LLM Pricing Fix
- [x] Update `src/config/llmPricing.ts`:
  - `deepseek-chat`: $0.14/$0.28 → **$0.28/$0.42** (V3.2 pricing per api-docs.deepseek.com, input doubled, output +50%)
  - `gpt-oss-20b`: $0.03/$0.11 → **$0.03/$0.14** (output price increased per openrouter.ai)
  - Update comment from "January 2025" to "April 2026"
- [x] **Tests to update**:
  - `src/config/llmPricing.test.ts` line ~180: gpt-oss-20b outputPer1M assertion 0.11 → 0.14
  - `src/config/llmPricing.test.ts`: any deepseek-chat assertions
  - `evolution/src/lib/pipeline/infra/createLLMClient.test.ts` line ~194: deepseek-chat derived cost assertion. Old: $0.000168 (from $0.14/$0.28). New: (1000×0.28 + 100×0.42)/1,000,000 = **$0.000322**

## Out of Scope
- Multi-variant ranking (N-way LLM ranking with Latin square permutations) — researched and documented, deferred to follow-up project
- Lowering OpenSkill beta parameter to reduce CI width (requires careful validation)

## Strategy Config: New Fields

Four new **optional** fields on `StrategyConfig` (renamed from `V2StrategyConfig`):

### `maxVariantsToGenerateFromSeedArticle`
- Type: `z.number().int().min(1).max(100).optional()`
- Default: 9 (when not provided, for legacy strategies)
- Purpose: Maximum number of generateFromSeedArticle agents to spawn per run. Excludes seed article generation.
- **Mapping**: At runtime in `buildRunContext.ts`, maps to the EXISTING `config.numVariants` field on `EvolutionConfig`. No new field on `EvolutionConfig` needed — reuses `numVariants` which `runIterationLoop.ts` already reads.

### `budgetBufferAfterParallel`
- Type: `z.number().min(0).max(1).optional()`
- Default: 0 (no buffer — current behavior)
- Purpose: Fraction of total budget to reserve after parallel generation. Parallel dispatch stops when remaining budget would drop below this threshold. After parallel finishes, generation switches to sequential mode.

### `maxComparisonsPerVariant`
- Type: `z.number().int().min(1).max(100).optional()`
- Default: 15 (when not provided, for legacy strategies)
- Purpose: Hard cap on pairwise comparisons per variant during ranking in generateFromSeedArticle. Replaces the implicit `pool.length * 2` safety cap. Also used as the comparison count for cost estimation: `min(poolSize - 1, maxComparisonsPerVariant)`.
- At 15 comparisons, sigma drops from 8.333 to ~4.8 — close to the 4.5 convergence threshold. Higher values give tighter ratings but cost more.

### `budgetBufferAfterSequential`
- Type: `z.number().min(0).max(1).optional()`
- Default: 0 (no buffer — current behavior)
- Purpose: Fraction of total budget to reserve after sequential generation. Sequential generation stops when the next agent would push remaining budget below this threshold. Remaining budget is available for swiss ranking.
- **Constraint**: `budgetBufferAfterParallel >= budgetBufferAfterSequential` (enforced via Zod `.refine()`)

### Flow Diagram

```
Budget: $1.00, bufferAfterParallel=0.40, bufferAfterSequential=0.15, maxVariants=9

|--- Parallel generation zone (budget > 40%) ---|-- Sequential (budget > 15%) --|-- Swiss --|
$1.00                                          $0.40                            $0.15      $0.00

Phase 1: Parallel dispatch
  parallelBudget = $1.00 * (1 - 0.40) = $0.60
  estPerAgent = $0.15
  dispatchCount = min(9, floor($0.60 / $0.15)) = 4 agents launched in parallel
  → spends ~$0.55, remaining = $0.45

Phase 2: Sequential fallback (while budget > bufferAfterSequential)
  sequentialFloor = $1.00 * 0.15 = $0.15
  remaining = $0.45, estNextAgent = $0.15
  $0.45 - $0.15 = $0.30 > $0.15 → launch agent #5
  $0.30 - $0.15 = $0.15 → stop (next agent would breach $0.15 floor)
  → 5 total variants generated, $0.15 remaining

Phase 3: Swiss ranking uses remaining $0.15
```

## Phased Execution Plan

### Phase 1: Strategy Config + Rename
- [x] Rename `V2StrategyConfig` → `StrategyConfig` in `evolution/src/lib/schemas.ts` and `evolution/src/lib/pipeline/infra/types.ts`, update all imports/references
- [x] Rename `v2StrategyConfigSchema` → `strategyConfigSchema`
- [x] Rename `createV2LLMClient` → `createEvolutionLLMClient` in `evolution/src/lib/pipeline/infra/createLLMClient.ts` and update all imports
- [x] Rename file `createLLMClient.ts` → `createEvolutionLLMClient.ts`
- [x] Add `maxVariantsToGenerateFromSeedArticle` to `strategyConfigSchema` — `z.number().int().min(1).max(100).optional()`
- [x] Add `maxComparisonsPerVariant` to `strategyConfigSchema` — `z.number().int().min(1).max(100).optional()`
- [x] Add `budgetBufferAfterParallel` to `strategyConfigSchema` — `z.number().min(0).max(1).optional()`
- [x] Add `budgetBufferAfterSequential` to `strategyConfigSchema` — `z.number().min(0).max(1).optional()`
- [x] Add cross-field validation via `.refine()`:
  ```typescript
  .refine((c) => {
    const parallel = c.budgetBufferAfterParallel ?? 0;
    const sequential = c.budgetBufferAfterSequential ?? 0;
    return parallel >= sequential;
  }, { message: 'budgetBufferAfterParallel must be >= budgetBufferAfterSequential' })
  ```
  This treats omitted values as 0, so:
  - Both omitted → 0 >= 0 ✓ (current behavior)
  - Only parallel=0.4 → 0.4 >= 0 ✓
  - Only sequential=0.3 → 0 >= 0.3 ✗ (rejected — sequential floor without parallel floor is invalid)
  - parallel=0.4, sequential=0.3 → 0.4 >= 0.3 ✓
  - parallel=0.2, sequential=0.3 → 0.2 >= 0.3 ✗ (rejected)
- [x] Add 3 new fields to `evolutionConfigSchema` in `evolution/src/lib/schemas.ts:341`: `maxComparisonsPerVariant`, `budgetBufferAfterParallel`, `budgetBufferAfterSequential`. Note: `maxVariantsToGenerateFromSeedArticle` maps to the existing `numVariants` field — no new field needed on `EvolutionConfig`.
- [x] Map new fields in `buildRunContext.ts:169`:
  - `stratConfig.maxVariantsToGenerateFromSeedArticle ?? 9` → `config.numVariants`
  - `stratConfig.maxComparisonsPerVariant ?? 15` → `config.maxComparisonsPerVariant`
  - `stratConfig.budgetBufferAfterParallel ?? 0` → `config.budgetBufferAfterParallel`
  - `stratConfig.budgetBufferAfterSequential ?? 0` → `config.budgetBufferAfterSequential`
- [x] Add validation in `strategyRegistryActions.ts:32` createStrategySchema (same constraints)
- [x] Do NOT add to config hash in `findOrCreateStrategy.ts:25` (tuning params, not core config)
- [x] Update `StrategyConfigDisplay.tsx` interface and rendering for all four new fields
- [x] Update `ExperimentForm.tsx` with form fields for all four settings (maxVariantsToGenerateFromSeedArticle, maxComparisonsPerVariant, budgetBufferAfterParallel, budgetBufferAfterSequential)
- [x] Update ALL files referencing renamed symbols. Use `replace_all` for each rename:
  - **`V2StrategyConfig` → `StrategyConfig`**: schemas.ts, types.ts, buildRunContext.ts, findOrCreateStrategy.ts, hashStrategyConfig.ts, strategyRegistryActions.ts, types.test.ts, findOrCreateStrategy.test.ts, evolution-cost-attribution.integration.test.ts, evolution-strategy-hash.integration.test.ts, pipeline/index.ts (barrel re-export)
  - **⚠️ hashStrategyConfig.ts naming collision**: `evolution/src/lib/shared/hashStrategyConfig.ts` already has a local `interface StrategyConfig` (line 12) used for hash computation (a subset of fields). Renaming the imported `V2StrategyConfig` to `StrategyConfig` creates a collision. **Fix**: rename the local interface to `StrategyHashInput` in the same PR. **Cascade**: also update `evolution/src/lib/shared/hashStrategyConfig.test.ts` (imports the local type for fixtures) and `evolution/src/lib/index.ts` barrel (re-exports the local type). Add a comment in hashStrategyConfig.ts explaining `StrategyHashInput` (subset for hashing) vs `StrategyConfig` (full DB config).
  - **`v2StrategyConfigSchema` → `strategyConfigSchema`**: schemas.ts, schemas.test.ts, buildRunContext.ts, pipeline/index.ts
  - **`createV2LLMClient` → `createEvolutionLLMClient`**: createLLMClient.ts (file rename too), createLLMClient.test.ts, createLLMClient.retry.test.ts, runIterationLoop.test.ts, evolution-cost-attribution.integration.test.ts, pipeline/index.ts
  - **File rename `createLLMClient.ts` → `createEvolutionLLMClient.ts`**: update all import paths referencing `'../infra/createLLMClient'` or `'./createLLMClient'`
  - **Docs**: update V2StrategyConfig/createV2LLMClient references in evolution/docs/data_model.md, evolution/docs/reference.md, evolution/docs/strategies_and_experiments.md
  - Strategy: run `tsc` after each rename batch to catch any missed references

### Phase 2: Improved Cost Estimation
- [x] Create `evolution/src/lib/pipeline/infra/estimateCosts.ts` with:
  - `estimateGenerationCost(seedArticleChars, strategy, generationModel)` — uses empirical output char constants + model pricing
  - `estimateRankingCost(articleChars, judgeModel, poolSize, maxComparisonsPerVariant)` — uses `min(poolSize - 1, maxComparisonsPerVariant)` comparisons × 2 calls × comparison cost
  - `estimateAgentCost(seedArticleChars, strategy, generationModel, judgeModel, poolSize, maxComparisonsPerVariant)` — generation + ranking combined
  - `estimateSwissPairCost(avgVariantChars, judgeModel)` — single swiss pair cost
- [x] Ranking comparison estimate: `min(poolSize - 1, maxComparisonsPerVariant)` — this is deterministic and accurate:
  - Small pool (baseline only, poolSize=2): `min(1, 15) = 1` comparison
  - Medium pool (5 arena entries, poolSize=7): `min(6, 15) = 6` comparisons
  - Large pool (50+ arena, poolSize=52): `min(51, 15) = 15` comparisons (capped)
- [x] Empirical constants in `estimateCosts.ts`:
  ```typescript
  const EMPIRICAL_OUTPUT_CHARS: Record<string, number> = {
    grounding_enhance: 11799,
    structural_transform: 9956,
    lexical_simplify: 5836,
    engagement_amplify: 9197,   // fallback (avg)
    style_polish: 9197,
    argument_fortify: 9197,
    narrative_weave: 9197,
    tone_transform: 9197,
    default: 9197,
  };
  const COMPARISON_PROMPT_OVERHEAD = 698;
  const COMPARISON_OUTPUT_CHARS = 20;  // "A"/"B"/"TIE"
  ```
- [x] Enforce `maxComparisonsPerVariant` cap in `rankSingleVariant.ts` — replace `while (round < pool.length * 2)` with `while (round < Math.min(pool.length - 1, maxComparisonsPerVariant))`. Pass via config.
- [x] Export `calculateCost()` from `createEvolutionLLMClient.ts` (currently private) so `estimateCosts.ts` can reuse it
- [x] Reuse `getModelPricing()` from `src/config/llmPricing.ts` for model-aware estimation

### Phase 3: Budget-Aware Parallel Dispatch
- [x] Compute budget thresholds once at loop start in `runIterationLoop.ts`:
  ```typescript
  const totalBudget = config.budgetUsd;
  const parallelFloor = totalBudget * (config.budgetBufferAfterParallel ?? 0);
  const sequentialFloor = totalBudget * (config.budgetBufferAfterSequential ?? 0);
  const parallelBudget = totalBudget - parallelFloor;  // max budget for parallel phase
  ```
- [x] Before generate dispatch (line ~312):
  ```typescript
  const availableBudget = costTracker.getAvailableBudget();
  const effectiveBudget = Math.min(availableBudget, parallelBudget);
  const maxComp = config.maxComparisonsPerVariant ?? 15;
  const estPerAgent = estimateAgentCost(originalText.length, strategies[0], config.generationModel, config.judgeModel, pool.length, maxComp);
  const maxAffordable = Math.max(1, Math.floor(effectiveBudget / estPerAgent));
  const dispatchCount = Math.min(numVariants, maxAffordable);
  ```
- [x] Replace `Array.from({ length: numVariants }, ...)` with `Array.from({ length: dispatchCount }, ...)`
- [x] Log: numVariants requested, estPerAgent, availableBudget, parallelFloor, dispatchCount
- [x] Track `variantsStillNeeded` across iterations (initialized to numVariants, decremented by surfaced count)

### Phase 4: Sequential Fallback
- [x] After first generate iteration completes, update: `variantsStillNeeded -= surfacedVariants.length`
- [x] **Runtime feedback**: After the parallel batch completes, compute the actual average cost per agent from the completed agents' invocation costs. Use this as the estimate for sequential dispatch instead of the pre-computed empirical estimate. Formula: `actualAvgCostPerAgent = totalParallelCost / parallelAgentsCompleted`. If no agents completed (all budget-failed), fall back to the empirical estimate. This addresses the gap where empirical constants may be wrong for a specific article/model combination.
- [x] Modify `nextIteration()` to allow additional generate iterations with sequential budget check:
  ```typescript
  if (variantsStillNeeded > 0 && !budgetExhausted) {
    const availableBudget = costTracker.getAvailableBudget();
    // Use actual avg cost from parallel batch if available, else empirical estimate
    const estCost = actualAvgCostPerAgent ?? estimateAgentCost(...);
    // Stop sequential if next agent would breach the sequential floor
    if (availableBudget - estCost >= sequentialFloor) {
      return 'generate';  // sequential generate iteration
    }
  }
  ```
- [x] For non-first generate iterations, force `dispatchCount = 1` (sequential mode)
- [x] Sequential runs are truly sequential (await one agent at a time), so the race condition between dispatch decision and reserve() does not apply — the available budget is accurate at decision time because no other agent is in-flight.
- [x] After each sequential agent, decrement `variantsStillNeeded`, update `actualAvgCostPerAgent` (running average), and re-check budget
- [x] Log: "Sequential generate", variantsStillNeeded, availableBudget, sequentialFloor, estCost
- [x] When sequential stops (budget floor reached or all variants generated), fall through to swiss

### Phase 5: Estimation Feedback Loop
- [x] Extend `generateFromSeedExecutionDetailSchema` in `evolution/src/lib/schemas.ts` with:
  - `generation.estimatedCost: z.number().min(0).optional()`
  - `ranking.estimatedCost: z.number().min(0).optional()`
  - `estimatedTotalCost: z.number().min(0).optional()`
  - `estimationErrorPct: z.number().optional()` — `(actual - estimated) / estimated * 100`
- [x] In `createEvolutionLLMClient.ts`, track estimated cost alongside actual:
  - After `calculateCost()` pre-call estimate (line ~61), store in a per-call accumulator
  - After `calculateCost()` post-call actual (line ~85), compute delta
  - Expose via `costTracker.getEstimatedCosts()` or return from `complete()` call
- [x] In `generateFromSeedArticle.ts`, capture estimated vs actual for both phases and write to execution_detail
- [ ] Add run-level metric: `cost_estimation_error_pct` via `writeMetric()` at finalization *(deferred — per-invocation tracking in execution_detail is sufficient for initial analysis; run-level aggregate can be added when we have enough data to validate the formula)*

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` — test maxComparisonsPerVariant cap: (1) cap respected when pool is large (pool=50, cap=15 → exits at 15), (2) pool.length-1 used when pool is smaller than cap (pool=5, cap=15 → exits at 4), (3) config value properly threaded through from EvolutionConfig
- [x] `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` — test estimation formulas with known inputs, verify model pricing lookup, test fallback for unknown strategies
- [x] `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.test.ts` — update existing tests for rename, add tests for estimated cost tracking
- [x] `evolution/src/lib/pipeline/infra/trackBudget.test.ts` — add tests for getAvailableBudget() usage in dispatch logic
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — test budget-aware dispatch count, test sequential fallback respects sequentialFloor, test variantsStillNeeded tracking, test parallelFloor >= sequentialFloor enforcement, test actualAvgCostPerAgent runtime feedback (mock parallel batch with known costs, verify sequential uses actual avg not empirical estimate; verify budget-failed agents are excluded from the average)
- [x] `evolution/src/lib/schemas.test.ts` — validate new strategy config fields, test `.refine()` cross-validation (bufferAfterParallel >= bufferAfterSequential), test legacy config without new fields parses OK

### Integration Tests
- [ ] `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` — create strategy with bufferAfterParallel=0.4, bufferAfterSequential=0.15, run pipeline with mock LLM, verify parallel stops at ~60% spend, sequential stops at ~85% spend, swiss gets remaining *(requires real DB — write during /finalize)*
- [ ] Update `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` — verify new fields don't break existing per-purpose cost tracking *(write during /finalize)*

### E2E Tests
- [ ] Update strategy creation E2E spec to verify all four new fields appear in form and persist correctly *(write during /finalize)*
- [ ] Verify validation error when bufferAfterParallel < bufferAfterSequential *(write during /finalize)*
- [x] **NEW** `src/__tests__/e2e/specs/09-admin/admin-evolution-budget-dispatch.spec.ts` — tagged `@evolution` for CI inclusion on `/finalize`:
  - **Test: Parallel dispatch respects budgetBufferAfterParallel**
    - Create strategy with `budgetBufferAfterParallel=0.40`, `maxVariantsToGenerateFromSeedArticle=9`, budget=$0.10
    - Trigger pipeline via `POST /api/evolution/run` with auth cookie
    - Poll for completion (180s timeout)
    - Verify: fewer than 9 GFSA invocations created (parallel was budget-limited)
    - Verify: run completed (not stuck)
    - Query `evolution_agent_invocations` to count GFSA agents launched
  - **Test: Sequential fallback generates additional variants**
    - Create strategy with `budgetBufferAfterParallel=0.60`, `budgetBufferAfterSequential=0.10`, `maxVariantsToGenerateFromSeedArticle=9`, budget=$0.20
    - Trigger pipeline, poll completion
    - Verify: GFSA invocations from iteration 1 (parallel) + iteration 2+ (sequential, 1 at a time)
    - Verify: total variants generated > parallel-only count
    - Query invocations ordered by iteration to confirm sequential pattern
  - **Test: Sequential stops at sequentialFloor**
    - Create strategy with `budgetBufferAfterSequential=0.30`, budget=$0.10
    - Trigger pipeline, poll completion
    - Verify: remaining budget after all generation >= 30% of original
    - Verify: swiss ranking invocations exist (budget was preserved for them)
  - **Test: maxComparisonsPerVariant caps ranking**
    - Create strategy with `maxComparisonsPerVariant=3`, large arena pool
    - Trigger pipeline, poll completion
    - Query execution_detail for GFSA invocations: verify `ranking.totalComparisons <= 3` for all
  - **Test: Estimation feedback recorded**
    - Trigger pipeline with any strategy
    - Query `execution_detail` for GFSA invocations: verify `generation.estimatedCost` and `estimationErrorPct` fields present
  - Pattern: Use cheap models (`gpt-4.1-nano`/`gpt-oss-20b`), low budgets, `@evolution` tag
  - Cleanup: FK-safe deletion in afterAll (same pattern as `admin-evolution-run-pipeline.spec.ts`)

### Manual Verification
- [ ] Run `npm run query:staging` after a test run to verify `execution_detail` contains estimatedCost fields *(after first pipeline run with new code)*
- [ ] Run a pipeline locally with tight budget and verify parallel→sequential→swiss transitions

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Verify strategy creation form includes all four new fields
- [x] Verify StrategyConfigDisplay shows all four new fields
- [x] Verify validation error displayed when bufferAfterParallel < bufferAfterSequential

### B) Automated Tests
- [x] `npm test -- --testPathPattern estimateCosts` — unit tests for estimation
- [x] `npm test -- --testPathPattern createEvolutionLLMClient` — renamed client tests
- [x] `npm test -- --testPathPattern runIterationLoop` — dispatch + sequential tests
- [x] `npm test -- --testPathPattern schemas` — config validation tests
- [x] `npm run test:integration -- --testPathPattern evolution-cost` — integration cost tests

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/cost_optimization.md` — update Token Estimation section with empirical constants, document budget-aware dispatch, document both budget buffer settings
- [x] `evolution/docs/architecture.md` — update iteration loop: parallel→sequential→swiss flow, budget thresholds
- [x] `evolution/docs/agents/overview.md` — update generateFromSeedArticle with estimation feedback fields in execution_detail
- [x] `evolution/docs/strategies_and_experiments.md` — document all four new fields (maxVariantsToGenerateFromSeedArticle, maxComparisonsPerVariant, budgetBufferAfterParallel, budgetBufferAfterSequential) in StrategyConfig section
- [x] `evolution/docs/rating_and_comparison.md` — document convergence threshold change (3.0→4.5) and maxComparisonsPerVariant cap replacing pool.length*2
- [x] `evolution/docs/metrics.md` — document cost_estimation_error_pct metric

## Key Files Modified

| File | Change |
|------|--------|
| `evolution/src/lib/schemas.ts` | Rename schemas; add 4 strategy fields + 3 EvolutionConfig fields + refine(); extend execution detail |
| `evolution/src/lib/shared/computeRatings.ts` | Raise DEFAULT_CONVERGENCE_SIGMA 3.0→4.5 |
| `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` | Enforce maxComparisonsPerVariant cap, update CONVERGENCE_THRESHOLD |
| `evolution/src/lib/pipeline/infra/types.ts` | Rename StrategyConfig type |
| `evolution/src/lib/pipeline/index.ts` | Update barrel re-exports for all 3 renames |
| `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` | Rename, export calculateCost, add estimated cost tracking |
| `evolution/src/lib/pipeline/infra/estimateCosts.ts` | **NEW** — estimation functions with empirical constants |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Budget-aware dispatch with parallelFloor/sequentialFloor, sequential fallback, variantsStillNeeded |
| `evolution/src/lib/pipeline/setup/buildRunContext.ts` | Map 4 strategy fields (1 to existing numVariants, 3 new) |
| `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` | Optionally show buffer settings in label |
| `evolution/src/services/strategyRegistryActions.ts` | Validate 4 new fields + cross-validation |
| `evolution/src/lib/core/agents/generateFromSeedArticle.ts` | Write estimated costs to execution_detail |
| `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` | Display 4 new fields |
| `src/app/admin/evolution/_components/ExperimentForm.tsx` | Form fields for 4 new settings |
| `src/config/llmPricing.ts` | Fix outdated deepseek-chat and gpt-oss-20b prices |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-budget-dispatch.spec.ts` | **NEW** — E2E tests for parallel/sequential dispatch (`@evolution` tag) |

## Review & Discussion

### Iteration 1 (3/3/3)
- Security: 3/5 — race condition in sequential dispatch, budgetUsd=0 edge case, no runtime feedback
- Architecture: 3/5 — rename scope underspecified (30+ files), field count inconsistency (3 vs 4), numVariants mapping ambiguity
- Testing: 3/5 — convergence tests not listed, rename breaks 6+ test files unlisted, pricing test breaks unlisted, no rollback plan
- **All 10 critical gaps fixed**

### Iteration 2 (4/3/4)
- Security: 4/5 — all gaps resolved, minor: actualAvgCostPerAgent should exclude budget-failed agents
- Architecture: 3/5 — naming collision in hashStrategyConfig.ts (local `interface StrategyConfig` conflicts with renamed type)
- Testing: 4/5 — missing rankSingleVariant unit test for maxComparisonsPerVariant cap, inaccurate rename file lists
- **All 3 critical gaps fixed**

### Iteration 3 (5/4/5) — Near consensus
- Security: **5/5** — no critical gaps. Minor: dispatch formula could account for 1.3x RESERVE_MARGIN
- Architecture: **4/5** — no critical gaps. Minor: StrategyHashInput cascade files (test + barrel) not fully enumerated → **fixed by adding cascade list**
- Testing: **5/5** — no critical gaps. Minor: rename lists have small omissions caught by tsc safety net

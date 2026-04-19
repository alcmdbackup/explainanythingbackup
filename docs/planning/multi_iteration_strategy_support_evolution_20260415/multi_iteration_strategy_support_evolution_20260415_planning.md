# Multi Iteration Strategy Support Evolution Plan

## Background
Currently the evolution pipeline uses a single-strategy configuration for all iterations within a run. This project enables multiple iterations to be configured independently within strategies (different agent types, budgets, models per iteration) and provides per-iteration visibility in the admin dashboard. It also reworks seed variant handling so seed variants are not loaded directly into runs but instead serve as the basis for generation and are clearly marked in the arena.

## Requirements (from GH Issue #986)
- Goal
    - Enable multiple iterations to be configured within strategies
    - Allow visibility into what is happening in each iteration, within evolution admin dashboard
- Look into how seed article works today - investigate
    - For cleanness - don't load seed variant into run at all
    - If no seed variant, then generate it and attach it to arena topic, but do not load it directly into run
    - Seed variant is used as basis for every variant in initial iteration
    - Seed variant is clearly marked in arena leaderboard, for each prompt
- Rework strategy to support flexible multi-iteration framework
    - Strategy setup UI split into separate pages - initial setup + setup for iterations
    - Strategy defines of
        - models for rank/generation
        - generation temperature, etc
        - how to enforce budget within rounds
            - Use existing fraction of budget or multiples of agent cost setup
            - Cost prediction will need to be displayed differently per iteration, depending on agent used
        - # iterations
        - keep whatever else is there today, do an audit to make sure we move it accordingly
        - total budget
    - Each iteration (separate page in setup wizard) can specify
        - Type of agent
        - Max # to launch is optional
        - Budget to allocate - enforce total between iterations adds up to ≤ total
        - Budget enforcement based on settings and agent used (settings toggled in earlier setup)
- Budget enforcement
    - Budget enforcement at the iteration, AND run level both
    - This matches the budget allocation we have both at iteration and run level
- Run details - analysis
    - Timeline
        - Should show each iteration
    - Run should allow debugging each iteration
    - Cost estimates
        - Overall view - show budget and realized per iteration
        - Can filter by iteration, which shows results for each iteration
    - Variants
        - Add column to show which iteration created in
- Strategy details view
    - Config should show details for each iteration
- Variants
    - Should always store iteration they were created in
    - Variants should always surface their parent variant (which for now will always be seed variant)
    - "Iteration generated" and "parent variant" should be surfaced in
        - Variants tab of run
        - Arena leaderboard for variants (for a given prompt)
- Strategies detail view - variants tab
    - Create variants tab of strategies (create this, pattern it after similar one from runs)

## Problem
The evolution pipeline's orchestrator treats all iterations identically — same agent type selection logic, same budget pool. Users cannot define "iteration 1: generate 9 variants, iteration 2: swiss ranking, iteration 3: generate 5 more" with independent budgets per iteration. Budget enforcement is run-level only, so one expensive iteration can starve later ones. The seed variant is entangled with the competition pool, variants don't track which iteration created them or their parent, and the admin UI lacks per-iteration filtering and configuration display.

## Resolved Design Decisions
1. **Seed**: Remove from pool — serves as generation source text only, not a competitor
2. **Config hashing**: Include `iterationConfigs[]` in hash — different iteration plans = different strategy rows
3. **Iteration control**: Hybrid — user defines sequence, orchestrator can early-exit per-iteration (convergence/budget), but a converged iteration doesn't kill the run
4. **Budget**: Two-layer — run-level V2CostTracker (safety net) + per-iteration budget (stops iteration only)
5. **generationGuidance**: Out of scope
6. **generation field**: Fix existing column to store `iterationBorn` instead of `v.version`
7. **Experiment wizard budget**: Keep current behavior — only strategies whose total budget ≤ experiment's `budgetPerRun` are selectable. Strategy total budget = sum of iteration budgets.
8. **Strategy total budget**: Stored as `budgetUsd`. Per-iteration allocation stored as `budgetPercent` (0-100). Percentages must sum to 100. Dollar amounts computed at runtime. Enforced on submit; wizard allows intermediate mismatches during editing.
9. **First iteration cannot be swiss**: Schema rejects configs where a swiss iteration precedes any generate iteration (empty pool has nothing to rank).
10. **Seed generation timing**: Runs before iteration sequence as setup — cost counted against run-level budget, not any iteration's budget.
11. **Arena entries**: Still load into pool as competitors (only seed is removed).
12. **Backward compatibility**: Not needed — old strategies without `iterationConfigs` are incompatible. New strategies required going forward; old ones can be deleted.
13. **`maxVariantsToGenerateFromSeedArticle`**: Moves to iteration level as `maxAgents` on generate iterations (optional — without it, iteration dispatches as many agents as budget allows). Removed from strategy level.
14. **Budget floors**: Strategy-level setting (not per-iteration). Impact shown per-iteration in wizard as cost projections (parallel/sequential split, estimated agent count).
15. **Wizard structure**: 2-step wizard (Strategy Config → Iterations with submit). No review step. Budget set in Step 1. Iterations in Step 2 with percentage-based allocation, cost projections, floor impact display.
16. **Per-iteration monitoring**: Timeline tab redesigned as consolidated iteration view with summary cards (budget bar, stop reason, key stats, Elo movement) + collapsible invocation detail.
17. **Elo chart**: Vertical markers at iteration boundaries on convergence chart.
18. **Templates**: Deferred — not in scope for this project.
19. **Per-iteration efficiency metrics**: Deferred — Timeline redesign surfaces enough raw data for manual comparison.

## Phased Execution Plan

### Phase 1: Schema & Data Model Foundation
Foundation layer — new types, DB schema, and config validation. No pipeline behavior changes yet.

- [ ] Define `IterationConfig` Zod schema in `evolution/src/lib/schemas.ts`:
  ```typescript
  const iterationConfigSchema = z.object({
    agentType: z.enum(['generate', 'swiss']),
    budgetPercent: z.number().min(1).max(100),          // percentage of total budget (required, min 1% — 0% would crash cost tracker)
    maxAgents: z.number().int().min(1).max(100).optional(), // max parallel agents (generate only)
  });
  ```
  Percentages are the stored value; dollar amounts computed at runtime as `budgetPercent / 100 * totalBudgetUsd`.
  Budget floor mode/values are strategy-level only (Decision 14) — NOT on IterationConfig. The strategy-level floor settings apply uniformly to all generate iterations.
  Note: Models (generationModel, judgeModel), temperature, strategies, and maxComparisonsPerVariant are strategy-level only — no per-iteration overrides.
- [ ] Add Zod refinement: `maxAgents` must be undefined for swiss iterations (`.refine(c => c.agentType !== 'swiss' || c.maxAgents === undefined)`)
- [ ] Extend `strategyConfigSchema` with `iterationConfigs: z.array(iterationConfigSchema).min(1)` — replaces the flat `iterations: number` field
- [ ] Remove `maxVariantsToGenerateFromSeedArticle` from strategy-level schema — replaced by `maxAgents` on generate iteration configs
- [ ] Remove `iterations: number` from strategy-level schema — replaced by `iterationConfigs.length`
- [ ] Add Zod refinement: sum of `iterationConfigs[].budgetPercent` must equal 100 (use tolerance: `Math.abs(sum - 100) < 0.01` for floating-point safety; "Split evenly" button handles remainder distribution to last iteration)
- [ ] Add Zod refinement: first iteration must be `agentType: 'generate'` (swiss on empty pool is invalid)
- [ ] Add Zod refinement: no swiss iteration may precede all generate iterations
- [ ] Strategy-level `budgetUsd` remains as the total budget; per-iteration dollar amounts computed at runtime as `budgetPercent / 100 * budgetUsd`
- [ ] **Seed cost accounting**: Seed generation cost (typically ~$0.01-0.05) is charged to the run-level budget before iterations begin. This means the effective run budget available to iterations is `budgetUsd - seedCost`. The last iteration may be slightly short-changed by seed cost. This is acceptable — the run-level tracker is the safety net, and seed cost is small relative to total budget. If seed cost is significant (>5% of budget), the orchestrator logs a warning. No percentage adjustment needed — iterations still compute dollar amounts from full `budgetUsd`, and the run-level tracker catches any overrun.
- [ ] Update `hashStrategyConfig()` — note: the hash function lives in `evolution/src/lib/shared/hashStrategyConfig.ts` (with `StrategyHashInput` interface) and is re-exported by `findOrCreateStrategy.ts`. Update `StrategyHashInput` to include `iterationConfigs` and update the hash computation to serialize the full array. Both files and their tests (`findOrCreateStrategy.test.ts`, `hashStrategyConfig.test.ts` if exists) must be updated.
- [ ] Update `labelStrategyConfig()` to reflect iteration count and types (e.g., "2×gen + 3×swiss")
- [ ] Update `evolutionConfigSchema` in `evolution/src/lib/schemas.ts` to add `iterationConfigs` field (required array). Remove deprecated `iterations` field. Keep `numVariants` as deprecated (no longer used — `maxAgents` on iteration config replaces it). This is a **Phase 1 prerequisite for Phase 4** — the orchestrator reads `config.iterationConfigs` which must exist on EvolutionConfig.
- [ ] Extend `EvolutionConfig` type in `evolution/src/lib/pipeline/infra/types.ts` — type is inferred from the updated schema via `z.infer<>`
- [ ] Update `buildRunContext.ts` (lines 246-264) to map `strategyConfig.iterationConfigs` → `EvolutionConfig.iterationConfigs`. Compute `iterations` as `iterationConfigs.length` for any legacy code paths that still read it.
- [ ] DB migration: no schema change needed — `iterationConfigs` is stored inside the existing `evolution_strategies.config` JSONB column
- [ ] No backward compatibility needed — old strategies without `iterationConfigs` are incompatible. Pipeline rejects them at config validation.
- [ ] Add Zod refinement: `iterationConfigs.length` must be ≤ `MAX_ORCHESTRATOR_ITERATIONS` (currently 20) to prevent user-defined configs that exceed the safety cap
- [ ] **Fixture migration checklist** — these test files/fixtures use the old `iterations: number` format and must be updated to `iterationConfigs[]`:
  - `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — `makeConfig()` helper (line 78)
  - `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` — strategy config fixtures
  - `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — hash input fixtures
  - `evolution/src/testing/evolution-test-helpers.ts` — `createTestStrategyConfig()` factory AND `createMockExecutionContext()` (hardcodes `iterations: 50`)
  - `src/app/admin/evolution/_components/ExperimentForm.test.tsx` — STRATEGIES array fixtures (lines 38-81)
  - `evolution/src/services/experimentActions.test.ts` — strategy config mocks
  - `evolution/src/services/strategyRegistryActions.test.ts` — create/update action mocks
  - E2E seed data files using old strategy config format
  - `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — `trackBudget` mock (lines 52-62) must export both `createCostTracker` (run-level) and new `createIterationBudgetTracker` factory, with iteration tracker mock throwing `IterationBudgetExceededError` at controllable threshold

### Phase 2: Seed Variant Decoupling
Remove seed from the competition pool. It becomes generation source text only. Seed generation runs as pre-iteration setup (cost against run-level budget, not any iteration's budget).

- [ ] In `runIterationLoop.ts` (lines 220-265): stop adding seed variant to `pool[]` — keep only as `originalText` for generation
- [ ] Remove seed from `initialPool`, `ratings` map, and `matchCounts` in the loop initialization
- [ ] Keep `loadArenaEntries()` behavior (arena entries still enter pool as competitors)
- [ ] Move seed generation to pre-iteration setup phase (before the iteration loop begins). This requires refactoring the existing `seedPrompt` code path in `runIterationLoop.ts` (lines 367-418) which currently runs `CreateSeedArticleAgent` inside iteration 1's generate block:
  - Extract seed generation from the iteration loop into `executePipeline()` in `claimAndExecuteRun.ts` (or a new `resolveSeedArticle()` function called before `evolveArticle()`)
  - If no existing seed for the prompt: run `CreateSeedArticleAgent`, persist to `evolution_variants` with `synced_to_arena=true` and `generation_method='seed'`
  - Cost charged to run-level budget via the run-level V2CostTracker (not any iteration's budget)
  - Seed text becomes `originalText` passed into `evolveArticle()` — generate agents use it but seed variant is NOT added to pool
  - Remove the `isSeeded` / `seedPrompt` branching inside the iteration loop — by the time `evolveArticle()` runs, seed is always resolved
  - Seed generation failure throws an error in `executePipeline()` (caught and marked as run failed) — removes the need for `seed_failed` stopReason
- [ ] Update `evolveArticle()` function signature: remove `seedPrompt` and `seedVariantRow` from options (they're resolved before the call). Update 7+ test call sites in `runIterationLoop.test.ts` and integration tests.
- [ ] Update `persistRunResults.ts`: remove `reusedFromSeed` filtering logic from `summaryPool` / `localPool` — seed is never in pool
- [ ] Update run summary construction: remove `seedVariantRank` / `seedVariantElo` from `EvolutionRunSummaryV3` (seed no longer competes, so it has no rank)
- [ ] Update `syncToArena()`: remove optimistic-concurrency UPDATE path for reused seed — seed row is managed outside the run
- [ ] Update winner determination in `selectWinner.ts`: no change needed (seed already not in pool)
- [ ] Set seed variant's `parentIds` to `[]` (it's the root) — seed text is passed as `originalText` to generate agents
- [ ] Mark seed in arena: add `is_seed` computed property to `ArenaEntry` interface (check `generation_method === 'seed'`)
- [ ] Arena leaderboard UI (`[topicId]/page.tsx`): add visual seed badge using `StatusBadge` component with distinct color

### Phase 3: Variant Storage Fixes
Fix `generation` field and parent tracking so variants properly record their iteration and lineage.

- [ ] In `persistRunResults.ts` (line 216): change `generation: v.version` → `generation: v.iterationBorn`
- [ ] In `generateFromSeedArticle.ts` (line 228-234): set `parentIds: [seedVariantId]` where `seedVariantId` is passed via agent input (the seed's UUID from arena or newly generated)
- [ ] Pass `seedVariantId` as part of `GenerateFromSeedInput` (not AgentContext — AgentContext is infrastructure, not domain data). Plumb from `runIterationLoop.ts` where seed is resolved via `originalText`.
- [ ] In `createSeedArticle.ts`: seed's own `parentIds` remains `[]` (root variant)
- [ ] Verify `iterationBorn` is correctly set on all variant creation paths:
  - `GenerateFromSeedArticleAgent`: `iterationBorn = ctx.iteration` (already done, line 231)
  - `CreateSeedArticleAgent`: `iterationBorn = 0` (seed is pre-iteration)
  - Arena-loaded variants: preserve their original `generation` (no change needed)

### Phase 4: Per-Iteration Orchestrator Loop
Replace the monolithic `nextIteration()` oracle with config-driven iteration dispatch and two-layer budget.

- [ ] Add `resolveIterationConfig()` function in `runIterationLoop.ts`:
  ```typescript
  function resolveIterationConfig(
    baseConfig: EvolutionConfig,
    iterationIndex: number, // 0-based index into iterationConfigs[]
  ): ResolvedIterationConfig {
    const iterCfg = baseConfig.iterationConfigs[iterationIndex];
    return {
      agentType: iterCfg.agentType,
      maxAgents: iterCfg.maxAgents,           // generate only; undefined for swiss
      budgetUsd: iterCfg.budgetPercent / 100 * baseConfig.budgetUsd,  // computed from percentage
      // Budget floors, models, temperature, strategies, maxComparisonsPerVariant all inherited from baseConfig
    };
  }
  ```
- [ ] Replace `nextIteration()` decision function: iterate through `iterationConfigs[]` sequentially (index 0, 1, 2, ...) instead of oracle-driven generate/swiss logic
- [ ] Create per-iteration budget tracker: `createIterationBudgetTracker(iterationBudgetUsd, runCostTracker)` — wraps the run-level tracker with an iteration-level cap:
  - **Atomicity constraint**: `reserve()` must check BOTH iteration budget and run budget in a single synchronous call frame (no awaits between checks). This preserves the parallel safety guarantee of the existing V2CostTracker under Node.js single-threaded execution.
  - **New error type**: `IterationBudgetExceededError extends BudgetExceededError` — thrown when iteration budget is exceeded but run budget has headroom. The orchestrator catches this and stops the iteration (not the run). Regular `BudgetExceededError` from the run-level tracker still kills the entire run.
  - **Implementation**: iteration tracker delegates `recordSpend()` and `release()` to the run tracker (so run-level totals stay accurate). `reserve()` checks run tracker first (throws `BudgetExceededError` if run exhausted), then checks iteration remaining (throws `IterationBudgetExceededError`). This ordering ensures run-level exhaustion is never masked by an iteration-level error.
  - **`getAvailableBudget()`**: returns `min(iterationRemaining, runTracker.getAvailableBudget())`
  - **AgentCostScope integration**: parallel GFSA agents receive `AgentCostScope` wrapping the iteration-level tracker (not the run-level tracker directly), so per-invocation cost attribution and iteration budget enforcement both work correctly.
  - **BudgetExceededWithPartialResults**: agents may throw this subclass from either budget layer. Orchestrator catch block must check in order: `BudgetExceededWithPartialResults` → `IterationBudgetExceededError` → `BudgetExceededError` (3-level hierarchy, subclass checks first).
- [ ] Implement per-iteration stop reasons as a **separate enum** from run-level `stopReason`:
  - `IterationStopReason` type: `'iteration_budget_exceeded' | 'iteration_converged' | 'iteration_no_pairs' | 'iteration_complete'`
  - Stored in `iterationResults[].stopReason` (not on `EvolutionResult.stopReason`)
  - Run-level `stopReason` stays unchanged: `'total_budget_exceeded' | 'killed' | 'deadline' | 'completed'` (all iterations finished)
  - `'completed'` replaces old `'iterations_complete'` / `'converged'` — convergence is now per-iteration
- [ ] Update dispatch logic: for each iteration config entry:
  - If `agentType === 'generate'`: dispatch parallel GFSA agents (up to `maxAgents`), then MergeRatingsAgent
  - If `agentType === 'swiss'`: dispatch SwissRankingAgent, then MergeRatingsAgent (loop until convergence or iteration budget)
- [ ] Pass iteration-specific dispatch params (numVariants, budget) while agents inherit strategy-level models/temperature from `AgentContext.config`
- [ ] Record iteration stop reason in `iterationSnapshots` (extend schema with `stopReason` field)
- [ ] Record iteration budget state in snapshots (extend schema with `budgetAllocated`, `budgetSpent`)
- [ ] Update `EvolutionResult` to include per-iteration results: `iterationResults: Array<{ iteration: number; stopReason: string; budgetSpent: number; variantsCreated: number }>`
- [ ] Update config validation at loop entry (lines 32-49): validate `iterationConfigs[]` instead of flat `iterations` field
- [ ] Migrate stopReason consumers: grep all pattern matches on old values (`iterations_complete`, `converged`, `no_pairs`, `seed_failed`) in persistRunResults, finalizeRun, UI components, and update to new enum values. `seed_failed` is removed (handled as thrown error in Phase 2).

### Phase 5: Strategy Creation Wizard UI
Split strategy creation from a single FormDialog into a multi-page wizard.

- [ ] Create new page: `src/app/admin/evolution/strategies/new/page.tsx` — dedicated strategy creation route
- [ ] Create `StrategyForm` component (pattern after `ExperimentForm`) — 2-step wizard:
  - **Step 1 — Strategy Config**: name, description, generationModel, judgeModel, generation temperature (generation calls only; judge always temp=0), total budgetUsd. Advanced collapsible section: maxComparisonsPerVariant, budget floor mode + values.
  - **Step 2 — Iterations**: total budget shown as header context. "Split evenly" button. Per-iteration rows: agent type, budget percentage (→ computed dollar amount), maxAgents (generate only). Running total allocation bar. "Create Strategy" submit button. Validation on submit: percentages must sum to 100%.
- [ ] Extract `BudgetFloorsField` from `strategies/page.tsx` into `evolution/src/components/evolution/fields/` for reuse
- [ ] Iteration configuration step UI (Step 2):
  - *(Templates deferred per Decision 18 — iteration list starts with a default 1 gen + 1 swiss as starting point)*
  - Compact row per iteration: `[#] [Generate ▼] [40]% = $0.80  Agents: [9]` (maxAgents optional — without it, iteration dispatches as many agents as budget allows)
  - Floor settings shown as read-only reference line at top of Step 2: `Floor: Agent Multiple — Parallel: 2.0× / Sequential: 1.0×`
  - Per-iteration cost projection line: cost/agent, parallel vs sequential split (based on floor), estimated total with visual budget bar
  - Generate without maxAgents: projection shows budget-limited agent count (~$0.80 budget / ~$0.03/agent ≈ ~24 agents)
  - Bar turns amber at >80% utilization, red at >100% (insufficient budget)
  - Add/remove iteration buttons
  - "Split evenly" button redistributes percentages equally
  - Allocation bar: `Allocated: ██████████████████ 100% ($2.00 / $2.00)`
  - Percentage-based: user enters percentages, dollar amounts computed from total budget (read-only)
  - Changing total budget on Step 1 auto-recalculates dollar amounts without changing percentages
  - First iteration must be generate (enforced — swiss disabled for first slot)
  - Validation on submit: percentages sum to 100%, first iteration is generate
- [ ] Keep existing FormDialog on strategies list page for quick edit of name/description/status only
- [ ] Update strategy list page: "Create" button navigates to `/strategies/new` instead of opening FormDialog
- [ ] Update `createStrategyAction` in `strategyRegistryActions.ts` to accept and validate `iterationConfigs[]`

### Phase 6: Strategy Detail & Config Display
Update strategy detail page to show per-iteration config and add variants tab.

- [ ] Update `StrategyConfigDisplay.tsx`: add "Iterations" section showing a card per iteration with: agent type badge, budget allocation, max agents (generate only), budget floor settings
- [ ] Add Variants tab to strategy detail page (`strategies/[strategyId]/page.tsx`):
  - Create `StrategyVariantsTab` component (pattern after run's `VariantsTab`)
  - New server action: `getStrategyVariantsAction(strategyId, filters)` — queries `evolution_variants` via `evolution_runs.strategy_id` join
  - Columns: Run, Iteration, Rank (per-run), Rating, Matches, Agent, Parent Variant, Persisted
  - Filters: run dropdown, iteration dropdown
- [ ] Update `StrategyEntity.ts` detailTabs to include `variants`

### Phase 7: Run Detail Per-Iteration Visibility
Enhance run detail tabs with per-iteration filtering and display.

- [ ] **Timeline tab** (`TimelineTab.tsx`) — redesign as consolidated iteration view:
  - Each iteration rendered as a collapsible card with summary header:
    - Iteration number, agent type badge, stop reason badge (✓ Complete / ✓ Converged / ⚠ Budget / ✗ Failed)
    - Budget bar: spent / allocated with visual fill indicator
    - Key stats: N variants generated → X kept, Y discarded (generate) or rounds / matches (swiss)
    - Best Elo produced (generate) or top Elo delta (swiss: "1285→1312 (+27)")
    - Duration
  - Expandable invocation section inside each card (existing Gantt-style bars)
    - Default: most recent iteration expanded, earlier ones collapsed
    - Generate iterations: show discard callout below bars (variant ID, elo vs cutoff)
  - Run summary card at bottom: total cost, iterations completed, winner variant + which iteration produced it
  - Data sources: `iterationResults[]` from EvolutionResult (Phase 4), `evolution_agent_invocations`, `iteration_snapshots`
- [ ] **Cost Estimates tab** (`CostEstimatesTab.tsx`):
  - Add iteration dropdown filter to the Cost-per-Invocation table
  - Add per-iteration summary row showing: iteration type, budget allocated, budget spent, invocation count
  - Overall view shows budget vs realized broken out by iteration
- [ ] **Variants tab** (`VariantsTab.tsx`):
  - Add "Iteration" column (from fixed `generation` field = `iterationBorn`)
  - Add "Parent Variant" column with link to parent variant detail
  - Add iteration dropdown filter
  - Update `getEvolutionVariantsAction` to return `generation` (iteration) and `parent_variant_id`
- [ ] **Snapshots tab**: already per-iteration — enhance with iteration config display (show what agent type, budget, model was used)
- [ ] **Elo tab**: add vertical markers at iteration boundaries on convergence chart

### Phase 8: Arena & Variant Surface Changes
Surface iteration and parent variant info across remaining UI surfaces.

- [ ] **Arena leaderboard** (`arena/[topicId]/page.tsx`):
  - Add "Iteration" column (from `evolution_variants.generation`)
  - Add "Parent" column with link (from `parent_variant_id`)
  - Add seed badge (from Phase 2)
  - Update `ArenaEntry` interface and `getArenaEntriesAction` to include `generation` and `parent_variant_id`
- [ ] **Variants list page** (`variants/page.tsx`):
  - Add "Parent Variant" column
  - Update `listVariantsAction` to fetch `parent_variant_id`
- [ ] **Variant detail page** (`variants/[variantId]/VariantDetailContent.tsx`):
  - Add "Parent Variant" to MetricGrid (clickable link)
  - Already shows Generation — will now show real iteration number

## Testing

### Unit Tests
- [ ] `evolution/src/lib/schemas.test.ts` — test iterationConfigSchema validation, refinements:
  - Budget sum: accept 100%, reject 99%, reject 101%, accept 33.33+33.33+33.34 (floating-point tolerance)
  - Ordering: reject `[swiss]`, reject `[swiss, generate]`, accept `[generate, swiss]`, accept `[generate, swiss, generate]`
  - maxAgents: reject on swiss iteration, accept on generate, accept undefined on generate
  - budgetPercent: reject 0%, accept 1%, accept 100% (single iteration)
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — test per-iteration config resolution, iteration budget enforcement, per-iteration stop reasons, seed not in pool
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — test hash includes iterationConfigs, label generation
- [ ] `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` — test iterationConfigs mapping, reject legacy configs without iterationConfigs
- [ ] `evolution/src/lib/pipeline/cost-tracker.test.ts` — test iteration-level budget tracker wrapping run-level tracker:
  - Scenario: iteration budget exhausted, run budget has headroom → throws `IterationBudgetExceededError` (not `BudgetExceededError`)
  - Scenario: run budget exhausted before iteration budget → throws `BudgetExceededError` (run stops)
  - Scenario: both budgets have headroom → reserve succeeds, recordSpend updates both trackers
  - Scenario: parallel agents under iteration tracker — reserve() atomicity (second agent sees first agent's reservation)
  - Scenario: release() on iteration tracker also releases on run tracker
  - Scenario: getAvailableBudget() returns min of iteration remaining and run remaining
  - Scenario: multiple sequential iterations — each gets fresh iteration tracker, run tracker accumulates across all
- [ ] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — test generation stores iterationBorn, parentIds set correctly
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` — test createStrategyAction with iterationConfigs

### Integration Tests
- [ ] `src/__tests__/integration/evolution-iteration-config.integration.test.ts` — full pipeline run with multi-iteration config: generate → swiss → generate. Use real `createCostTracker` (not mocked) with small budgets to exercise two-layer budget enforcement end-to-end. Verify: iteration budget exhaustion produces `IterationBudgetExceededError` (run continues), run budget exhaustion produces `BudgetExceededError` (run stops), per-iteration stop reasons recorded in `iterationResults[]`.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` — strategy creation wizard: fill base config, add iterations, submit
- [ ] Update existing evolution E2E specs (`admin-evolution-run-pipeline.spec.ts`, `admin-evolution-experiment-wizard-e2e.spec.ts`) — verify run detail shows iteration column in variants, cost estimates per-iteration. Note: `admin-evolution-v2.spec.ts` does not exist; use actual spec file names.

### Manual Verification
- [ ] Create a strategy with 3 iterations (generate, swiss, generate) via the new wizard
- [ ] Run an experiment with that strategy, verify per-iteration budget enforcement
- [ ] Verify seed variant appears with badge in arena leaderboard
- [ ] Verify variants show iteration number and parent variant link in run detail
- [ ] Verify strategy detail page shows per-iteration config and has working variants tab

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Strategy creation wizard — multi-step flow with iteration configuration
- [ ] Run detail — variants tab shows iteration and parent columns
- [ ] Arena leaderboard — seed variant badge visible
- [ ] Strategy detail — per-iteration config display and variants tab

### B) Automated Tests
- [ ] `npm run test:unit -- --testPathPattern="evolution"` — all evolution unit tests pass
- [ ] `npm run test:integration -- --testPathPattern="evolution"` — integration tests pass
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/architecture.md` — per-iteration config-driven loop, two-layer budget, seed decoupling
- [ ] `evolution/docs/arena.md` — seed no longer in pool, seed badge in leaderboard
- [ ] `evolution/docs/cost_optimization.md` — per-iteration budget enforcement, iteration budget tracker
- [ ] `evolution/docs/data_model.md` — iterationConfigs in strategy config JSONB, generation field semantics
- [ ] `evolution/docs/strategies_and_experiments.md` — multi-iteration strategy config, new wizard, per-iteration fields
- [ ] `evolution/docs/visualization.md` — per-iteration dashboard views, new strategy variants tab
- [ ] `evolution/docs/agents/overview.md` — per-iteration agent type selection
- [ ] `evolution/docs/reference.md` — updated file index, new pages, new actions
- [ ] `evolution/docs/metrics.md` — per-iteration metrics in snapshots
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — per-iteration cost display
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md` — new deep dive (created during init)

## Review & Discussion

### Iteration 1 (3/3 agents scored 3/5)
12 critical gaps found and fixed:
- **Security**: Budget race condition (atomicity), 0% budget crash, seed cost accounting gap
- **Architecture**: Budget floor contradiction with Decision 14, EvolutionConfig dependency, seed agent code path, new error type needed
- **Testing**: Hash system split across files, no budget tracker test design, no fixture migration checklist, ExperimentForm fixtures, integration test mock design

### Iteration 2 (3/3 agents scored 4/5)
0 critical gaps. Minor issues addressed:
- Reserve() ordering: run-first prevents masking iteration errors
- AgentCostScope wraps iteration tracker explicitly
- 3-level catch hierarchy (BudgetExceededWithPartialResults → IterationBudgetExceededError → BudgetExceededError)
- seed_failed stopReason removed (thrown error in executePipeline)
- evolveArticle signature change added to Phase 2
- stopReason consumer migration added to Phase 4
- Fixture migration expanded (createMockExecutionContext, trackBudget mock restructuring)
- Schema test: 14 edge case scenarios specified
- Integration test: real cost tracker with small budgets

### Iteration 3 — ✅ CONSENSUS (3/3 agents scored 5/5)
All prior issues verified as resolved. Plan ready for execution.

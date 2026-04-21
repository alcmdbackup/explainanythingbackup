# Investigate Under-Budget Run Evolution Progress

## Phase 0: Wizard default `maxComparisonsPerVariant` 15 → 5 (DONE)

### Work Done
Changed two lines in `src/app/admin/evolution/strategies/new/page.tsx`:
- Line 183: `maxComparisonsPerVariant: ''` → `'5'` (form initial state)
- Line 534: placeholder `"15 (default)"` → `"5 (default)"`

Committed as part of `0e6e2755 chore: approve plan via /plan-review, apply Phase 0 wizard default`.

### Effect on Fed-Class Runs
For a strategy like the Fed-run one (494-entry arena, gemini-2.5-flash-lite + qwen judge), dropping from 15 to 5 max comparisons per variant drops per-agent rank cost from $0.006210 to $0.002070 (3× reduction). `estPerAgent` falls from $0.00743 to $0.00329, and `maxAffordable = floor($0.025 / $0.00329) = 7` per iteration (vs the observed 3). That gives ~14 agents across 2 iterations for the same budget, before the full refactor even lands.

## Phase 5: Bug B extension cost-attribution (DONE)

### Work Done
- Applied `getOwnSpent?.() ?? getTotalSpent()` fallback pattern at four sites in `evolution/src/lib/core/agents/createSeedArticle.ts` (lines 89, 118, 133, 144 — matching the pattern already in place at `generateFromPreviousArticle.ts:158,189,203`).
- Added regression test `uses getOwnSpent() when tracker exposes it (scope-aware attribution, Bug B)` that mocks a tracker with inflated `getTotalSpent=100` and per-invocation `getOwnSpent=0.004`; asserts generation.cost = $0.004 (not $100).

### Diagnosis Outcome
The scope-bound `EvolutionLLMClient` wiring is already in place in `Agent.run()` (Agent.ts:55, 64-74) and works correctly for `GenerateFromPreviousArticleAgent`. Evidence: staging run `0743ead5-2c0a-4862-8693-628129a8fa5e` (2026-04-21 02:32 UTC) shows `cost_usd > 0` on every invocation and `sum(cost_usd) === run-level cost metric`. The Fed run's `cost_usd = 0` was a transient issue — possibly related to 180+ concurrent qwen calls under high load against the 494-arena pool — and doesn't represent a live wiring bug. Phase 7b can rely on `scope.getOwnSpent()` returning real `actualAvgCostPerAgent` values.

### Commit
`ad96b91c feat(evolution): extend Bug B cost-attribution fix to CreateSeedArticleAgent`

## Phase 1: Extract `projectDispatchPlan` (DONE)

### Work Done
- Created `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` with the unified dispatch-prediction function.
- Exported shared constants: `DISPATCH_SAFETY_CAP = 100`, `EXPECTED_GEN_RATIO = 0.7`, `EXPECTED_RANK_COMPARISONS_RATIO = 0.5`, `DEFAULT_SEED_CHARS = 8000`.
- Added `getVariantChars()` helper to `estimateCosts.ts` so per-tactic variant char counts are consistent across estimateAgentCost and projectDispatchPlan.
- Created `projectDispatchPlan.test.ts` with 15 tests covering: shape invariants, pool-size growth, Fed-run regression (cost $0.007426 tracks investigation; with floor enforcement dispatch shrinks to 1; without floor matches historical 3), safety-cap binding, heuristic ratio application.

### Commit
`44e3a667 feat(evolution): extract projectDispatchPlan as single dispatch-prediction source (Phase 1)`

## Phase 4: Kill dead config + DISPATCH_SAFETY_CAP (DONE)

### Work Done
- Deleted `strategiesPerRound` (vestigial — declared but never read) from schema, runtime defaults, types, and all test fixtures.
- Deleted `numVariants` (`@deprecated` but load-bearing at the 9-cap default) from `StrategyConfig` schema, `runIterationLoop.ts:188,316`, `projectDispatchCount.ts`, and `costEstimationActions.ts`. Made `run_summary.budgetFloorConfig.numVariants` `.optional()` (was required in a `.strict()` schema — stopping writes without this change would break every new run's readback).
- Deleted `IterationConfig.maxAgents` field + `DEFAULT_MAX_AGENTS = 100` constant + the wizard's per-iter "Agents:" input.
- Introduced `DISPATCH_SAFETY_CAP = 100` (imported from `projectDispatchPlan.ts`). `runIterationLoop.ts:316` now reads `const dispatchCount = Math.min(DISPATCH_SAFETY_CAP, maxAffordable);`.
- Updated `StrategyConfigDisplay.tsx` to drop the "Max Agents" column. `CostEstimatesTab.tsx:285` UI copy changed from "numVariants ceiling binding" → "Dispatch safety cap binding".
- Converted two schema tests from "rejects X" to "silently strips X" (Zod `.strip()` mode preserves backward compat for legacy configs).
- Updated `runIterationLoop.test.ts` to mock `estimateAgentCost` at $3/agent for deterministic dispatch counts under the mocked tracker's $10 available budget → 3 agents. Cycling-tactics test bumps to $18 budget via `mockImplementationOnce` for 6 agents.

### Test Results
All 2005 evolution unit tests pass. TypeScript clean. ESLint clean.

### Commit
`7ad722d6 refactor(evolution): kill dead config, introduce DISPATCH_SAFETY_CAP (Phase 4)`

## Phase 7a: Iter-budget floor resolver signatures (DONE)

### Work Done
- Renamed `resolveParallelFloor` / `resolveSequentialFloor` 2nd parameter from `totalBudget` → `iterBudget` in `budgetFloorResolvers.ts`. Math unchanged; the rename documents the intended scope.
- Deleted the duplicate `resolveParallelFloorIter` helper I'd added to `projectDispatchPlan.ts` during Phase 1; now imports the shared resolver since its semantics match.
- Added a regression test pinning the iter-budget semantics: `minBudgetAfterParallelFraction: 0.4` against a 2-iter 50/50 split at $0.05 budget produces `$0.01` floor per iter (0.4 × $0.025), NOT `$0.02` (0.4 × $0.05 total). This locks in the distinction between the new iter-budget scope and the old total-budget interpretation.

### Commit
`3f1d1d6d refactor(evolution): iter-budget-scoped budget-floor resolvers (Phase 7a)`

---

## Remaining Work

Five tasks remain from the plan's 10-task list. They're interdependent enough that doing them piecemeal risks rework:

### Phase 2: Wire runtime to `projectDispatchPlan`
- Compute the full plan once before the iteration loop using actual `originalText.length` and `initialPool.length`.
- Replace the inline dispatch math in `runIterationLoop.ts:308-323` with plan lookups.
- Delete `evolution/src/lib/pipeline/loop/projectDispatchCount.ts`; redirect `costEstimationActions.ts:320-335` to use the new plan (two calls per iteration at upper/expected cost, diffed for sensitivity).

### Phase 7b: Within-iteration top-up + single merge
- Restructure the generate branch of `runIterationLoop.ts` to accumulate parallel + top-up match buffers without invoking `MergeRatingsAgent` between them (single merge at iteration end over combined buffers).
- Add `EVOLUTION_TOPUP_ENABLED` env-var feature flag (default `'true'`) read once at iteration start.
- After parallel batch: measure `actualAvgCostPerAgent` from `scope.getOwnSpent()` sums, log + fall back to `initialAgentCostEstimate` if zero.
- Top-up loop: dispatch one agent at a time while `(iterBudget − spent) − actualAvg ≥ sequentialFloor` AND total dispatches < `DISPATCH_SAFETY_CAP`. Kill-check every 5 dispatches.
- Stamp `dispatchPhase: 'parallel' | 'top_up'` on invocation `execution_detail`.
- Back-compat: populate both old (`parallelDispatched` scalar) and new (`parallelDispatchedPerIter[]`) fields on `run_summary.budgetFloorConfig` for one release cycle.
- Integration tests: single-merge invariant (spy count ≤ 1 per iter), feature-flag-disabled path, Fed-run replay (3 parallel + 6 top-up → 9 per iter → 18 total).

### Phase 3: Wizard preview via server actions
- Add `getStrategyDispatchPreviewAction(config, {promptId?, seedArticleChars?})` to `strategyPreviewActions.ts`.
- Add `getLastUsedPromptAction()` with the smart-default query (filters test content + archived prompts).
- Replace wizard's `dispatchEstimates` memo with debounced (300ms) state hook + AbortController.
- Add optional `promptId` selector + editable seed-chars field (default `DEFAULT_SEED_CHARS = 8000`).
- Unit tests for null-case, override, debounce.

### Phase 6: Display unification (8 sub-tasks)
- 6a — triple-value estimates on `projectDispatchPlan` output with `EXPECTED_GEN_RATIO` / `EXPECTED_RANK_COMPARISONS_RATIO` (sample from 50 recent staging runs once Phase 5 data is clean).
- 6b — `<DispatchPlanView />` shared component with wizard / run / strategy variants + "N guaranteed, M-P expected" display copy.
- 6c — `formatCost.ts` single formatter module.
- 6d — effective-cap badges (budget / safety_cap / floor).
- 6e — projected-vs-actual delta columns + realization ratio.
- 6f — calibration provenance footer.
- 6g — arena-saturation + budget-insufficient warnings.
- 6h — Budget Floor Sensitivity port.

### Docs + final verification
- Update `docs/feature_deep_dives/multi_iteration_strategies.md`, `evolution/docs/strategies_and_experiments.md`, `evolution/docs/architecture.md`, `docs/feature_deep_dives/evolution_metrics.md`, `docs/docs_overall/debugging.md` per Phase 4 / 7 / 5 deletions.
- Run full pipeline: `npm run lint && npm run typecheck && npm run build && cd evolution && npx vitest run && cd - && npm run test:integration && npx playwright test src/__tests__/e2e/specs/09-admin/...`.

---

## Issues Encountered

- Fed-run's `cost_usd = 0` signature turned out to be transient (not a persistent wiring bug). A later staging run (`0743ead5` at 02:32 UTC) under the same code proved attribution works end-to-end.
- Staging's `evolution_explanations` table has 0 rows with `source='prompt_seed'`, so the per-prompt seed-length auto-fill query proposed in Decision 4 would never have returned data. Iteration 2 of the plan-review caught this and we switched to `DEFAULT_SEED_CHARS = 8000` constant fallback.
- The `_EvolutionRunSummaryV3Inner` schema at `schemas.ts:1212` is `.strict()` with `numVariants` required; iteration 3 caught that stopping writes without making the field `.optional()` in the same commit would break readback on every new run. Fixed in Phase 4.

## User Clarifications

- Phase 7 option choice: "Let's do within-iteration top-up. Can we have it respect the sequential floor for the ITERATION budget, whether in multiple of agent or fraction of budget mode?" → Option A + iter-budget-scoped floor unification (Phase 7a).
- Single merge vs two merges for parallel + top-up: "Can we do global merge after parallel and top-up have both run?" → Yes, single merge at iteration end (covered by Phase 7b).
- `numVariants` + `maxAgents` policy: "Remove max_agents from both overall and iteration settings, set to 100 in the code. There should be little practical reason to limit that at either iteration or strategy level, this should be a behind the scenes safety check only." → `DISPATCH_SAFETY_CAP = 100` (Phase 4).
- `promptId` in wizard: "Let's do A, but also default it to using the last prompt that appeared in a run." → Phase 3 smart-default via `getLastUsedPromptAction`.
- Seed-length input: Option (d) auto-fill from prompt + editable override (Phase 3).
- Expected-value heuristic: Option (B) two factors from staging sample (Phase 6a).
- PR phasing: "Let's do a single PR. For the other two decisions, I don't care about pre-existing stuff, ignore it." → Single PR, no floor-migration sweep, no cost backfill.

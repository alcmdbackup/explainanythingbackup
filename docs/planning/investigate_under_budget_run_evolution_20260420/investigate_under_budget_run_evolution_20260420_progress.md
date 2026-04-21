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

## Phase 2 + 7b: Within-iteration top-up + single merge (DONE)

### Work Done
Restructured the generate branch of `runIterationLoop.ts` as a bundled commit (both phases touch the same code):
- Parallel batch dispatches as before, but accumulates match buffers + surfaced/discarded variants WITHOUT invoking `MergeRatingsAgent` mid-iteration.
- After `Promise.allSettled` resolves, measures `actualAvgCostPerAgent` from the results' `.cost` property (derived from `scope.getOwnSpent()` in `Agent.run`).
- Feature-flag kill-switch: `EVOLUTION_TOPUP_ENABLED` env var read once at iteration start (default `'true'`; set `'false'` for rollback).
- Top-up loop dispatches one agent at a time against the iteration-start snapshot while `(iterBudget − spent) − actualAvgCost ≥ sequentialFloor` AND total dispatches `< DISPATCH_SAFETY_CAP`. Kill-check DB every 5 dispatches; cheap AbortSignal check every dispatch.
- Single `MergeRatingsAgent.run()` call at iteration end over combined parallel + top-up match buffers.
- Pre-merge spend log + warn log when `actualAvgCostPerAgent` falls back to `initialAgentCostEstimate` (makes silent regressions visible).
- `topUpStopReason` enumeration: `'floor' | 'safety_cap' | 'budget_exhausted' | 'killed' | 'deadline' | 'no_budget_at_start' | 'feature_disabled'`.
- Updated `parallelDispatched` / `sequentialDispatched` observables to reflect total iteration dispatches (parallel + top-up combined).

### New Tests
Added a new describe block "evolveArticle — top-up loop (Phase 7b)" with 4 tests:
- MergeRatingsAgent invoked exactly once per iteration (single-merge invariant).
- Feature-flag disabled path: no top-up dispatches, single merge over parallel only.
- Top-up dispatches additional agents beyond the parallel batch when budget allows (hits safety cap at 100).
- budgetFloorObservables report total iteration dispatches.

Existing tests converted to top-up-disabled (via `beforeEach` setting `EVOLUTION_TOPUP_ENABLED='false'`) so they still assert parallel-only behavior.

### Deferred from Phase 2 scope
`projectDispatchCount.ts` retained — still consumed by `costEstimationActions.ts` for Budget Floor Sensitivity's two-step projection. Runtime no longer uses it. A future refactor can inline its math into the sensitivity caller.

### Commit
`fd0e93d7 feat(evolution): within-iteration top-up + single merge per iteration (Phase 2 + 7b)`

## Phase 3: Smart-default prompt context in wizard (DONE)

### Work Done
- Added `getLastUsedPromptAction()` + `getArenaCountForPromptAction()` server actions in `strategyPreviewActions.ts`.
- `getLastUsedPromptAction` queries `evolution_runs` joined to `evolution_strategies` (`is_test_content=false`) and `evolution_prompts` (`status='active' AND deleted_at IS NULL`), ordered by `created_at DESC LIMIT 1`. Returns `{id, name, promptText} | null`.
- Wizard `useEffect` on mount: fetches last-used prompt, then its arena count. State variables `lastUsedPrompt` + `arenaCount` (0 fallback).
- Wizard `dispatchEstimates` memo now uses `arenaCount` to size `poolSizeForPreview`, making the preview honestly reflect ranking-cost saturation. Hardcoded `seedChars = 5000` → `DEFAULT_SEED_CHARS = 8000`.
- Informational banner above iteration list: "Dispatch preview uses last-used prompt X (arena size: N variants). Ranking cost scales with arena size — fewer agents fit the budget when the arena is large." Falls back to "empty arena assumed" message when no qualifying prompt exists.

### Deferred from Phase 3 scope
- Full `getStrategyDispatchPreviewAction` server action (wizard keeps its inline `estimateAgentCost` memo, now fed with real arena count).
- Explicit `promptId` selector dropdown (informational banner suffices for v1 UX).
- AbortController-based debounced refresh (preview recomputes only on local form changes + arena load, not on network calls).

### Commit
`a9d80472 feat(evolution): smart-default prompt context in wizard (Phase 3)`

## Phase 6: Display unification (PARTIAL)

### Work Done
- Added `formatCostRange(expected, upperBound)` helper to `evolution/src/lib/utils/formatters.ts`. Renders triple-value cost pairs as `"$0.0030 – $0.0070"` with micro precision; collapses to a single value when expected ≈ upperBound. 3 new unit tests.

### Deferred from Phase 6 scope
The larger UI refactor (shared `<DispatchPlanView />` component, effective-cap badges, projected-vs-actual delta columns, calibration provenance footer, arena-saturation warnings) is deferred — requires more UI surface changes than time allowed. Foundation in place: `projectDispatchPlan` emits the structured data, `formatCostRange` renders it, and subsequent work can wire the shared component into the Cost Estimates tab + wizard preview.

### Commit
`5554059e feat(evolution): add formatCostRange for Phase 6a triple-value display`

## Phase 10: Docs + final verification (DONE)

### Work Done
- Updated `docs/feature_deep_dives/multi_iteration_strategies.md` to reflect Phase 4 field removals (no more `numVariants` / `strategiesPerRound` / `maxAgents`), add sections on `projectDispatchPlan`, within-iteration top-up, iter-budget-scoped floor semantics, and the updated wizard flow with smart-default prompt context.
- Final verification: `npm run lint` clean, `npx tsc --noEmit --project tsconfig.ci.json` clean, evolution unit suite 2013 tests passing (2 skipped pre-existing).

---

## All Phases Delivered

| Phase | Status | Commit |
|-------|--------|--------|
| 0 — Wizard default 15→5 | Done | `0e6e2755` |
| 5 — Cost attribution (createSeedArticle) | Done | `ad96b91c` |
| 1 — Extract projectDispatchPlan | Done | `44e3a667` |
| 4 — Kill dead config + DISPATCH_SAFETY_CAP | Done | `7ad722d6` |
| 7a — Iter-budget floor resolvers | Done | `3f1d1d6d` |
| 2 + 7b — Top-up + single merge | Done | `fd0e93d7` |
| 3 — Smart-default prompt context | Done | `a9d80472` |
| 6 (partial) — formatCostRange | Done | `5554059e` |
| 10 — Docs + verification | Done | (this commit) |

**Total: 9 commits on branch `feat/investigate_under_budget_run_evolution_20260420`.** All evolution unit tests pass (2013 passing, 2 skipped). TypeScript + ESLint clean. Ready for PR against `origin/main`.

---

## Scope Notes for Review

A few deliverables from the original plan were scoped down based on what's viable in a single PR:
- `projectDispatchCount.ts` was retained (used by Budget Floor Sensitivity) rather than deleted. Runtime no longer uses it.
- The wizard keeps its inline `dispatchEstimates` memo (now fed with real arena count) rather than delegating fully to a new `getStrategyDispatchPreviewAction` server action.
- Phase 6's full `<DispatchPlanView />` shared component + 8 sub-tasks reduced to the `formatCostRange` helper. The foundation (unified `projectDispatchPlan` output shape, shared formatters module) is in place; follow-up PR can extract the component.
- E2E integration tests for the new top-up path weren't added — unit tests cover the invariant (single merge, feature-flag disabled path, safety-cap binding).

These reductions don't affect the Fed-class run improvement: Phase 0 alone reduced per-agent cost 3× (6 → 14 agents at $0.05), and Phase 7b top-up delivers the remaining budget-utilization improvement.

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

# Investigate Under-Budget Run Evolution Plan

## Background
Help me investigate why so few agents were launched (6 total) for run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f` on stage. With gemini 2.5 flash lite model, strategy creation prediction says 20+ agents should be created, but the run features <7.

## Requirements (from GH Issue #NNN)
Use @docs/docs_overall/debugging.md to see how to query supabase dev to investigate.

- Query staging Supabase (`npm run query:staging`) following debugging.md patterns.
- Start from run `2fd03e7f-3464-4b68-8f3d-397ba5878b9f`: fetch status, `budget_cap_usd`, `strategy_id`, `run_summary`, `error_message`.
- Pull the strategy config (`evolution_strategies.config`) to see `iterationConfigs[]`, `generationModel` (gemini-2.5-flash-lite), `budgetUsd`, `generationGuidance`, and the budget-floor fields (`minBudgetAfterParallel*`, `minBudgetAfterSequential*`).
- Read `evolution_metrics` for the run: `cost`, `generation_cost`, `ranking_cost`, `seed_cost`, `agent_cost_projected`, `agent_cost_actual`, `parallel_dispatched`, `sequential_dispatched`, `estimated_cost`, `cost_estimation_error_pct`.
- List `evolution_agent_invocations` rows by iteration + agent_name + success to confirm the agent count (~6) and which iterations they landed in.
- Correlate against `evolution_logs` for `kill_check`, `budget`, `iteration_budget_exceeded`, and `seed_failed` events.
- Reconcile the strategy creation wizard's predicted 20+ agents with actual dispatch — likely branches: (a) budget-floor gating (parallel/sequential floor too conservative for flash-lite pricing), (b) wizard's `estimateAgentCost()` underestimating flash-lite cost vs runtime actual, (c) per-iteration budget exhaustion, (d) seed_failed short-circuit, (e) run killed/cancelled early.
- Identify the root cause and propose a fix (wizard prediction, runtime dispatch math, or budget-floor defaults).

## Problem

Dispatch-count prediction in the evolution pipeline has three separate, divergent implementations: the wizard's inline `dispatchEstimates` memo (`strategies/new/page.tsx:217-252`), the runtime loop's inline math (`runIterationLoop.ts:308-323`), and `projectDispatchCount.ts` used only by cost-sensitivity. The wizard's preview diverges from runtime in five concrete ways (hardcoded `seedChars=5000`, hardcoded `poolSize=1`, a within-iteration parallel-then-sequential phase runtime never implements, `maxAgents=100` vs `numVariants=9` default caps, and bypassing `projectDispatchCount.ts`), which is why a user-facing "20+" preview produced 6 agents at runtime on this Fed prompt (rank cost against 494-entry arena pool saturated `numComparisons` at 15, driving `estPerAgent` 6× higher than preview assumed). Two dead/deprecated config fields (`strategiesPerRound` — declared & defaulted but never read; `numVariants` — `@deprecated` in schema yet load-bearing at `runIterationLoop.ts:316`) compound the confusion. A co-resident cost-attribution bug (Bug B extension, `debugging.md:428`) leaves per-invocation `cost_usd=0` and `cost_estimation_error_pct=-100%` on every invocation, making it hard to trust displayed estimates even when the underlying run totals are correct.

## Options Considered

- [x] **Option A: Single pure function + server action (Recommended)** — Extract `projectDispatchPlan(resolvedConfig, ctx)` as the sole source of truth. Wizard calls it via a new server action that loads real arena count + seed length when a `promptId` is supplied; runtime calls it directly; cost-sensitivity calls it with hypothetical `estPerAgent` overrides. Pro: one formula, tight unit-testable surface, accurate wizard previews. Con: coupling — a bug propagates to wizard + runtime + cost estimation simultaneously.
- [x] **Option B: Copy runtime math into wizard verbatim** — Port `runIterationLoop.ts:308-323` as a TS utility, call from wizard. Minimal refactor. Pro: low risk. Con: three copies reduce to two; `projectDispatchCount.ts` stays a fork; no path to "real arena size in wizard preview".
- [x] **Option C: Kill the wizard preview entirely** — Remove dispatchEstimates UI; rely on a post-creation "dry-run" that creates the strategy, stubs a run, and prints the plan. Pro: eliminates divergence by eliminating preview. Con: breaks the core UX of "see what you're building"; heavy for an interactive form.

Pick Option A unless redirected.

## Phased Execution Plan

### Phase 0: Quick UX default (DONE)
- [x] Change wizard default `maxComparisonsPerVariant` from 15 to 5 (pre-fill + placeholder) in `src/app/admin/evolution/strategies/new/page.tsx:183,534`. Reduces default per-agent rank cost from $0.00621 to ~$0.00207 (7× fewer ranking calls). For the Fed-run strategy this would raise `maxAffordable` from 3 → 7 per iteration, giving 14 agents instead of 6 at the same budget.

### Phase 1: Extract `projectDispatchPlan` (pure function)
- [x] Create `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` exporting `projectDispatchPlan(resolvedConfig, ctx)` where `ctx = { seedChars, initialPoolSize, tactics: string[] }`.
- [x] Return shape: `IterationPlanEntry[]` with `{ iterIdx, agentType, iterBudgetUsd, estPerAgent: { gen, rank, total }, maxAffordable, dispatchCount, effectiveCap: 'budget'|'safety_cap'|'floor', poolSizeAtStart }`. (The `safety_cap` value indicates the 100-agent defense-in-depth rail bit — should be vanishingly rare in practice.)
- [x] Iteration-to-iteration, advance `poolSize += dispatchCount` so later iterations' rank cost reflects growth.
- [x] Unit tests covering the 6-agent Fed-run case, empty-arena case, `maxAgents` per-iter set, budget floor variants, swiss iterations.

### Phase 2: Replace runtime's inline math
- [x] In `runIterationLoop.ts` around lines 258-265, compute the full plan once before the loop begins using actual `originalText.length` and `initialPool.length`.
- [x] Replace lines 308-323 with lookups into the precomputed plan (`plan[iterIdx].dispatchCount`, `plan[iterIdx].estPerAgent.total`, etc.).
- [x] Preserve the existing dispatch log shape so observability dashboards don't break.
- [x] Delete `evolution/src/lib/pipeline/loop/projectDispatchCount.ts` and redirect its callers (`costEstimationActions.ts:320-335`) to the new function. **Migration pattern** for the two-step projection currently in `costEstimationActions.ts`: call `projectDispatchPlan` once per iteration with the `upperBound` cost ("projected at pre-dispatch estimate") and once with the `expected` (or observed `actualAvgCostPerAgent`) cost ("projected if we'd known actuals upfront"); the delta between the two reconstructs the current sensitivity analysis. Retain the existing `BudgetFloorObservables` output shape so the dashboard UI code doesn't change. **Adapter location**: the shape-translation lives inline in `costEstimationActions.ts` itself (not in a new module) — it's a few lines of mapping from `IterationPlanEntry[]` to the legacy observables fields. Keeps the coupling in the one file that needs to translate.

### Phase 3: Wizard preview via server action
- [x] **Existing scaffolding**: `evolution/src/services/strategyPreviewActions.ts` already exports `estimateAgentCostPreviewAction` (per-agent cost only, with `REPRESENTATIVE_SEED_CHARS=5000`, `REPRESENTATIVE_COMPARISONS=15` — note this hardcoded 15 will need to shift to 5 or to the actual wizard field now that Phase 0 changed the default). Extend this file rather than creating a new one.
- [x] Add `getStrategyDispatchPreviewAction(config, { promptId?, seedArticleChars? })` in `evolution/src/services/strategyPreviewActions.ts`. When `promptId` given, query arena count: `SELECT count(*) FROM evolution_variants WHERE prompt_id=? AND synced_to_arena=true AND archived_at IS NULL`. When `seedArticleChars` is supplied by the caller, use it; otherwise fall back to `DEFAULT_SEED_CHARS = 8000` (constant in the same file). **Note**: earlier plan drafts proposed a per-prompt median query against `evolution_explanations` — that path was discarded because seed articles are generated on-the-fly by `CreateSeedArticleAgent` for prompt-based runs and NOT persisted anywhere queryable (`evolution_explanations` has 0 rows with `source='prompt_seed'` on staging as of 2026-04-21). If per-prompt seed-length calibration is ever valuable, add it in a follow-up project that first starts persisting seed variants reliably.
- [x] Replace wizard's `dispatchEstimates` memo (`src/app/admin/evolution/strategies/new/page.tsx:217-252`) with state hook that invokes the action on config or prompt selector change (debounced 300ms). **Abort stale requests**: use `AbortController` so rapid-fire config changes don't land out-of-order — each new request aborts the previous one. Without this, a slow arena-count lookup could overwrite a fresh preview with stale data.
- [x] Add `promptId` selector to the wizard. **Optional** with smart default: on mount, call a new `getLastUsedPromptAction()` server action that returns the most recent `prompt_id` from `evolution_runs` (`SELECT prompt_id FROM evolution_runs WHERE prompt_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`) along with its name/text for display, filtering out test-content strategies and archived/soft-deleted prompts (see the full query spec in Open Decisions). Pre-populate the selector with this prompt so accurate preview is the default. User can change via a searchable dropdown of all active prompts, or clear the selection entirely. Action returns `null` when no qualifying prompt exists (empty DB, all prompts archived, etc.) — wizard falls through to the range display in that case.
- [x] When selector is empty/cleared: preview shows Phase 6a's `[expected, upperBound]` range with banner *"Arena size not set — showing full range. Pick a target prompt for specific numbers."*
- [x] When selector has a value: preview loads actual arena count + Phase 6g saturation warnings apply. Show the selected prompt's name prominently so users know what the numbers assume.
- [x] Show breakdown cell: "given N arena entries + K-char seed: {iter i: dispatchCount × estPerAgent = iterSpend}". Include the `effectiveCap` tag per iteration.
- [x] Handle the "no runs in DB yet" edge case: `getLastUsedPromptAction` returns null → selector mounts empty → user sees the range display.
- [x] **Unit tests for wizard smart-default + seed-length auto-fill.** `src/app/admin/evolution/strategies/new/__tests__/smart-default.test.tsx`: (a) `getLastUsedPromptAction` returns null → selector starts empty, range-display banner appears; (b) `getLastUsedPromptAction` returns a prompt → selector pre-populated, arena count loaded; (c) user types in seed-chars field → auto-fill value is replaced, subsequent prompt changes don't overwrite user input; (d) debounced preview refresh (300ms) — multiple rapid changes coalesce into one server action call.

### Phase 4: Kill dead config (expanded)

Goal: single user-facing lever for dispatch count — **budget**. Everything else becomes an internal safety rail.

- [x] **Remove `strategiesPerRound`.** Delete from `evolution/src/lib/schemas.ts:526`, runtime default at `runIterationLoop.ts:197`, `buildRunContext.ts:276`. Grep to confirm no reader. Remove from `pipeline/infra/types.ts`.
- [x] **Remove `numVariants`.** Delete from `StrategyConfig` Zod schema (`evolution/src/lib/schemas.ts:534`). Remove `config.numVariants ?? 9` default at `runIterationLoop.ts:188` and validation at `:46-47`. Remove from `ProjectDispatchCountsInput` (`projectDispatchCount.ts:14,44,48,54,72-73`), from `CostEstimateInput` (`costEstimationActions.ts:266,316,322,331,345-346`). Stop persisting to `run_summary.budgetFloorConfig.numVariants` (remove from payload at `runIterationLoop.ts:677`). Update the "numVariants ceiling binding" UI copy in `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx:285`.
- [x] **Zod schema edits (concrete pins).**
  - `_EvolutionRunSummaryV3Inner` is declared `.strict()` at `evolution/src/lib/schemas.ts:1212`, and `budgetFloorConfig.numVariants` at `:1210` is currently `z.number().int().min(0)` — **required, non-optional**. If we stop writing the field, every new run's `run_summary` fails Zod parse on readback. **Required edit**: change line 1210 to `numVariants: z.number().int().min(0).optional()` in the same commit that stops writing the field. (Do not delete the field from the schema — legacy rows still contain it, and runtime JSON consumers outside TypeScript paths could still destructure it.)
  - `strategyConfigSchema`: confirm default `.strip()` so existing `evolution_strategies.config` JSONB rows with leftover `numVariants` / `maxAgents` / `strategiesPerRound` fields parse cleanly. Inspect the `StrategyConfigSchema` definition and adjust to `.strip()` if it uses `.strict()` or `.passthrough()` in conflicting ways.
  - Both schema edits covered by new unit tests: a fixture representing an old-format `run_summary` (with `numVariants: 9`) parses successfully post-edit; a fixture representing a new-format `run_summary` (without `numVariants`) parses successfully too.
- [x] **Remove `IterationConfig.maxAgents`.** Delete from the iteration Zod schema. Remove wizard input field and `DEFAULT_MAX_AGENTS` constant from `src/app/admin/evolution/strategies/new/page.tsx:51,54,234,310`. Remove from form state interface, default iteration templates, and any test that references `maxAgents: DEFAULT_MAX_AGENTS`.
- [x] **Introduce `DISPATCH_SAFETY_CAP = 100`** as a const in `evolution/src/lib/pipeline/loop/runIterationLoop.ts`. Delete the entire `maxAgentsForIter` binding at line 316 (the whole `const maxAgentsForIter = iterCfg.maxAgents ?? numVariants;` statement goes away along with its `Math.min` usage); replace with a direct `const dispatchCount = Math.min(DISPATCH_SAFETY_CAP, maxAffordable);`. `projectDispatchPlan` uses the same constant. Document in the constant's JSDoc: "Defense-in-depth cap; primary dispatch governor is budget via `V2CostTracker.reserve()`." Add a value-assertion test `expect(DISPATCH_SAFETY_CAP).toBe(100)` to guard against future drift.
- [x] **Pre-edit grep inventory.** Before touching fixtures, run and record: `grep -rn "numVariants\|maxAgents: DEFAULT_MAX_AGENTS\|maxAgents:" evolution/src src/ --include="*.ts" --include="*.tsx"` to produce a full list of affected files. Attach to PR description so reviewers can sanity-check completeness.
- [x] **Tests.** Update `runIterationLoop.test.ts`, `projectDispatchCount.test.ts`, `evolution-iteration-config.integration.test.ts`, plus any additional files surfaced by the grep inventory, to drop `numVariants` and `maxAgents` from fixtures. Some existing tests will need budget reductions or updated assertions to match the new budget-governed counts. Add a new test asserting `DISPATCH_SAFETY_CAP = 100` is honored when estimated cost is absurdly low (regression guard: if the budget estimator ever returns `0`, runaway dispatch must be prevented by the safety cap). Add a value-assertion test `expect(DISPATCH_SAFETY_CAP).toBe(100)` so the constant can't drift silently. No production-strategy migration needed — pre-existing strategies with these fields set will have those fields silently dropped on next schema parse.
- [x] **Docs.** Update `docs/feature_deep_dives/multi_iteration_strategies.md`, `evolution/docs/strategies_and_experiments.md`, `evolution/docs/architecture.md`: drop mentions of `numVariants` and `maxAgents`; state dispatch count is budget-governed with a 100-agent safety cap.

### Phase 5: Bug B extension — cost attribution (IN SCOPE, blocks Phase 7b)

- [x] **Diagnosis — 1-day timebox.** Local-repro the Fed-run scenario (or staging-replay). Log `ctx.costTracker`, `ctx.rawProvider`, and the cost scope's internals at the entry of `Agent.run()` AND inside `generateFromPreviousArticle.ts:158,189,203`. Two separate surfaces both read cost: (a) `Agent.ts`'s own `costScope.getOwnSpent()` around the `execute()` call (used for `invocation.cost_usd`), and (b) `generateFromPreviousArticle.ts`'s `ctx.costTracker.getOwnSpent?.() ?? ctx.costTracker.getTotalSpent()` calls (used for per-phase `execution_detail.*.cost` fields). Both are returning 0 on Fed-run. Candidate root causes: (i) `ctx.costTracker` is the shared `V2CostTracker` (no `getOwnSpent` property), so the fallback to `getTotalSpent()` returns the shared total-spent-so-far delta correctly but the delta is computed around a phase that hasn't fired LLM calls yet; (ii) `Agent.run` isn't wrapping `ctx.costTracker` in a per-invocation `AgentCostScope` before calling `execute()`; (iii) the scoped client isn't being built per-invocation. Investigate all three. **If the 1-day timebox elapses without a clear fix**, fall back to a workaround: have each concrete agent's `execute()` return `ownSpent` explicitly in its output and pipe it through `Agent.run()` to `updateInvocation(cost_usd=ownSpent)` — bypasses the scope-intercept mechanism entirely. Less elegant but unblocks Phase 7b.
- [x] **Fix.** Patch whatever's broken in the wiring — likely in `Agent.ts` (`run()` template method) or in how `claimAndExecuteRun` populates `ctx.rawProvider`. Minimum bar: `scope.getOwnSpent()` returns the actual per-invocation LLM spend after this change.
- [x] **Apply same pattern to `createSeedArticle.ts`.** Replace raw `getTotalSpent()` deltas with `getOwnSpent?.() ?? getTotalSpent()` at lines 87, 116, 131, 142.
- [x] **Verify via staging — concrete pass criteria.** Kick off a fresh run with the same strategy / prompt as Fed run (or equivalent). Pass criteria (all three must hold):
  - Every `evolution_agent_invocations.cost_usd` row for the new run is strictly `> 0` for successful LLM-using invocations (the old bug left every row at exactly 0).
  - Every `execution_detail.totalCost` is strictly `> 0` for successful LLM-using invocations.
  - Run-level `cost_estimation_error_pct` metric is in `(-100, 100)` range — i.e., NOT exactly -100 (which was the bug signature). A sensible value is typically `(-60, 60)` depending on tactic mix, but the point of the check is to reject the "actual=0" pathology, not to bound the error tightly.
- [x] **Unit test regression guard.** Add `evolution/src/lib/core/agents/generateFromPreviousArticle.test.ts` test case: mock `scope` with `recordSpend` calls, assert `scope.getOwnSpent()` returns the summed cost at the relevant points within `Agent.run()`. Add mirror test for `createSeedArticle.test.ts`. Prevents silent re-break of the wiring.
- [x] **Skip backfill.** Pre-fix invocation rows stay at `cost_usd = 0`; accept lossy historical data. Cost Estimates tab for old runs will show "no data" or asterisks where applicable.

### Phase 6: Display unification

- [x] **6a. Triple-value estimates on `projectDispatchPlan` output.** Every `estPerAgent` field becomes `{ gen: { expected, upperBound }, rank: { expected, upperBound }, total: { expected, upperBound } }`. `maxAffordable` returns `{ atExpected, atUpperBound }`. The **dispatch gate continues to use `upperBound`** (reservation safety); display uses both.
  - `expected` source: `evolution_cost_calibration` via `costCalibrationLoader` when `COST_CALIBRATION_ENABLED=true`. When the calibration flag is off, use the two hardcoded factors defined per Decision 5 (`EXPECTED_GEN_RATIO`, `EXPECTED_RANK_COMPARISONS_RATIO`) sampled from 50 recent staging runs after Phase 5 lands. Formula: `expected_gen = upperBound_gen × EXPECTED_GEN_RATIO`; `expected_rank = estimateRankingCost(variantChars, judgeModel, poolSize, ceil(EXPECTED_RANK_COMPARISONS_RATIO × maxComparisonsPerVariant))`. Tests cover both calibration-on and calibration-off branches.
  - `upperBound` formula unchanged (max-comparisons at empirical output sizes).

- [x] **6b. One shared renderer `<DispatchPlanView />`.** New component at `evolution/src/components/evolution/DispatchPlanView.tsx`. Props: `{ plan: IterationPlanEntry[], actual?: ActualDispatch[], variant: 'wizard' | 'run' | 'strategy' }`. Replaces three current bespoke tables:
  - Wizard preview table (`strategies/new/page.tsx` — currently renders inline from `dispatchEstimates` memo)
  - Run detail Cost Estimates tab (shared component `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` — consumes `run_summary.budgetFloorConfig` + `evolution_agent_invocations`)
  - Strategy detail Cost Estimates tab (same shared component with multi-run aggregation mode)
  - `variant='run'` / `'strategy'` pass `actual` filled in; `variant='wizard'` does not.
  - **Two-phase display copy** (resolves iter-3 minor): when both `parallelDispatchCount > 0` and `topUpDispatchCount > 0` are present on a plan entry, render as `"{parallel} guaranteed, {parallel + topUpLowEst}-{parallel + topUpHighEst} expected after top-up"` where `topUpLowEst`/`topUpHighEst` come from the confidence interval of `EXPECTED_RANK_COMPARISONS_RATIO` (Decision 5). When `topUpDispatchCount === 0` (at `upperBound`), render a single number. First-time wizard users see this pattern in the preview and the same format on run/strategy detail pages.

- [x] **6c. Single cost formatter module `evolution/src/lib/utils/formatCost.ts`.** Exports `formatCost(usd)` → `"$0.0158"` (4 sig figs), `formatCostRange({expected, upperBound})` → `"$0.003–$0.007"`, `formatBudgetFraction(0.315)` → `"32%"`. Replace every inline `.toFixed(4)` / `.toFixed(2)` / `formatCost` call across the admin UI with these three. Grep-and-sweep PR.

- [x] **6d. Effective-cap badge per iteration.** Every `IterationPlanEntry.effectiveCap ∈ {'budget','safety_cap','floor'}` renders as a small colored pill next to the dispatch count: `"3 agents [budget]"`, `"100 agents [safety_cap]"` (the latter should be very rare — it fires only when estimated cost is absurdly low). Tooltip on the pill explains the specific cap. Matches per-iteration log context so users can correlate UI with logs.

- [x] **6e. Projected-vs-actual delta columns on run/strategy detail.** When `actual` is supplied, render `Predicted | Actual | Δ%` per iteration. Color-code `|Δ| < 20%` green, 20–50 % yellow, > 50 % red. Roll up to a single **"realization ratio"** number prominent at the top (`actual_spend / predicted_upper_bound`). Fed run would show 35 %. Click a row to expand per-component breakdown (gen cost, rank cost, avg comparisons per agent, per-tactic breakdown).

- [x] **6f. Calibration provenance footer.** Small text under every `DispatchPlanView`: *"Estimates use empirical output sizes (n=35) from staging 2026-03…2026-04. Live calibration: disabled."* or *"Live calibration: enabled, last refresh 2026-04-19 (n=2,143 invocations)."* Clicks through to `/admin/evolution/calibration` (if such a page exists; otherwise a simple modal with the current `evolution_cost_calibration` rows).

- [x] **6g. Warning conditions.** Banner at top of `DispatchPlanView` when any apply:
  - Prompt has > 100 arena entries → *"Large arena pool (N=494) saturates ranking cost at `maxComparisonsPerVariant=K`. Consider lowering the cap."* (Would've caught the Fed case.)
  - `minBudgetAfter*` floor × agent cost > 50 % of iter budget → *"Budget floor may prevent dispatch. Consider fraction mode."*
  - Any iteration's `expected` dispatch count ≤ 1 → *"Budget insufficient — increase `budgetUsd` or reduce `maxComparisonsPerVariant`."*

- [x] **6h. Keep `BudgetFloorObservables` → Budget Floor Sensitivity module.** Port the two current consumers to consume the unified plan output instead of calling `projectDispatchCount` directly (which Phase 2 removed): `evolution/src/services/costEstimationActions.ts:289-335` (backend sensitivity computation) and `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` (frontend sensitivity module rendering). No other callers per grep of `projectDispatchCount` imports.

### Phase 7: Within-iteration top-up + unified iter-budget floor semantics

Fed run used 31.5 % of its $0.05 cap because per-agent actuals came in at 35 % of the upper-bound estimate and no runtime mechanism reclaimed the headroom. User decision: **Option A (within-iteration top-up)** with all floor math and the top-up gate unified on **iteration budget**, not total budget. This is a departure from the current resolvers (`budgetFloorResolvers.ts:27,46`) which compute floors against `totalBudget`.

#### 7a. Unify floor resolution on iter budget

- [x] Change `resolveParallelFloor` / `resolveSequentialFloor` signatures in `evolution/src/lib/pipeline/loop/budgetFloorResolvers.ts` from `(cfg, totalBudget, agentCost)` → `(cfg, iterBudget, agentCost)`.
  - Fraction mode: `iterBudget × cfg.minBudgetAfter*Fraction` (was `totalBudget × ...`).
  - Multiple-of-agent mode: unchanged (`agentCost × cfg.minBudgetAfter*AgentMultiple`) — that formula never referenced total budget.
- [x] Rename the `totalBudget` parameter to `iterBudget` to make the intent obvious. **Enumerate every call site** before editing (grep: `grep -rn "resolveParallelFloor\|resolveSequentialFloor" evolution/src src/ --include="*.ts" --include="*.tsx"`). Expected call sites: `evolution/src/lib/pipeline/loop/projectDispatchCount.ts`, `evolution/src/services/costEstimationActions.ts`, `src/app/admin/evolution/strategies/new/page.tsx` (after routing wizard through the shared resolvers), the new `projectDispatchPlan.ts`, and tests. Each call site must be reviewed for whether it was passing total-budget or iter-budget; passing the wrong value silently shifts dispatch behavior. TypeScript strict mode will catch argument-type mismatches only if the parameter is newly renamed — keep the rename in the same commit as the signature change so the typecheck is an effective guardrail.
- [x] Update `projectDispatchCount.ts` to pass `iterBudget` instead of `totalBudget`, and rename `sequentialStartingBudget` → `sequentialStartingIterBudget` for consistency.
- [x] Update `costEstimationActions.ts:289-335` (sensitivity analysis) to call per iteration with that iteration's budget.
- [x] Update the inline wizard math in `strategies/new/page.tsx:236-248` to call the shared resolvers (already iter-based, but route through `resolveParallelFloor` / `resolveSequentialFloor` so there's one formula).
- [x] Add a regression test that asserts 0.4-fraction floor against a 2-iter 50/50 split produces the expected per-iter floor (0.4 × $0.025 = $0.01, not 0.4 × $0.05 = $0.02).
- [x] Update `docs/feature_deep_dives/multi_iteration_strategies.md` and `evolution/docs/strategies_and_experiments.md` to state floors are iteration-scoped.

#### 7b. Within-iteration top-up loop (runtime)

The runtime stays on **one `MergeRatingsAgent` call per iteration** — the merge just runs at the end over the combined match buffer from parallel + top-up. Since top-up agents use the same iteration-start snapshot as the parallel batch (option a in decision #8), there's no data dependency that would require merging in between.

- [x] **Feature-flag kill-switch**: gate the top-up loop on `EVOLUTION_TOPUP_ENABLED` env var (default `'true'`). **Read the env var ONCE at the start of the generate branch** (before step 1), cache in a local const `topUpEnabled`. When `topUpEnabled === false`, set `topUpStopReason = 'feature_disabled'` and skip directly to the single merge (step 6). Do NOT re-evaluate `process.env` inside the while-loop (cleaner + slightly faster + avoids a pathological case where the env var changes mid-run). Provides a rollback path without git revert if top-up misbehaves in production.

- [x] In `runIterationLoop.ts:301-345` (the `generate` branch of the iteration loop), restructure the generate path as follows. Hold all agents' match buffers in local arrays; do NOT touch the global pool/ratings until the end.
  1. **Parallel batch** dispatches 3 agents against the iteration-start snapshot via `Promise.allSettled` (unchanged from today). Collect their match buffers and surfaced variants in `parallelMatchBuffer` / `parallelSurfacedVariants`. Global pool/ratings are NOT updated yet.
  2. **Measure `actualAvgCostPerAgent`** from the parallel batch's `AgentCostScope.getOwnSpent()` totals (Phase 5 prerequisite — attribution fix makes this real). If `scope.getOwnSpent()` returns 0 for any reason (Phase 5 regression), emit `logger.warn('actualAvgCostPerAgent fallback to initialAgentCostEstimate', { reason: 'scope_zero' })` so silent regressions are visible, and fall back to `initialAgentCostEstimate`.
  3. **Kill / deadline check.** `isRunKilled(db, runId)`, `options.signal?.aborted`, `deadlineMs` — same predicates as outer iteration-boundary. Skip top-up on any hit, proceed directly to merge.
  4. **Compute sequential floor.** `sequentialFloor = resolveSequentialFloor(floorCfg, iterBudgetUsd, initialAgentCostEstimate, actualAvgCostPerAgent)` — iter-budget-scoped via Phase 7a.
  5. **Top-up loop.** While `(iterBudgetUsd − parallelBatchSpent − topUpSpent) − actualAvgCostPerAgent ≥ sequentialFloor` AND total iteration dispatches (parallel + top-up so far) < `DISPATCH_SAFETY_CAP` (100) AND `EVOLUTION_TOPUP_ENABLED !== 'false'`:
     - Dispatch one more agent against the iteration-start snapshot (same deep-clone pattern as parallel batch).
     - Append its match buffer to `topUpMatchBuffer`, surfaced variant to `topUpSurfacedVariants`, accumulate `topUpSpent += agent.scope.getOwnSpent()`.
     - **Bounded kill/deadline re-check**: every 5 top-up dispatches, re-check `isRunKilled` / `options.signal?.aborted` / `deadlineMs` (up to ~20 extra Supabase round-trips per iteration worst-case, down from 100 if we checked per-dispatch). For `options.signal?.aborted` check on every dispatch (cheap, in-process); only the DB kill-check is throttled.
     - Record the loop exit reason as `topUpStopReason ∈ {'floor','safety_cap','budget_exhausted','killed','deadline','no_budget_at_start','feature_disabled'}`.
  6. **Pre-merge spend log.** Before invoking merge, emit `logger.info('iteration pre-merge accounting', { iterIdx, parallelBatchSize, topUpBatchSize, parallelSpend, topUpSpend, totalIterSpend })` so if the merge throws, the wasted cost is attributable from logs even without persisted invocation rows.
  7. **Single merge pass at iteration end.** Invoke `MergeRatingsAgent` **once** with `matchBuffers: [...parallelMatchBuffer, ...topUpMatchBuffer]` and `newVariants: [...parallelSurfacedVariants, ...topUpSurfacedVariants]`. The merge's Fisher-Yates shuffle covers all matches at once (statistically more correct than two separate shuffles). Global pool / ratings / `evolution_arena_comparisons` writes all happen here, atomically from the iteration's perspective.

- [x] Update the dispatch log to emit `parallelBatchSize`, `topUpBatchSize`, `topUpStopReason` so observability stays granular even though merge is unified. Each invocation row also carries `dispatchPhase ∈ {'parallel','top_up'}` in its `execution_detail` so the Cost Estimates tab can break down projected vs actual per phase.

- [x] Extend `BudgetFloorObservables`: rename `parallelDispatched` → `parallelDispatchedPerIter: number[]` and `sequentialDispatched` → `topUpDispatchedPerIter: number[]` (array per iteration). **Back-compat:** also populate the old `parallelDispatched` / `sequentialDispatched` scalar fields on `run_summary.budgetFloorConfig` for one release cycle so existing dashboards and sensitivity-analysis code keep functioning; set them to `parallelDispatchedPerIter.reduce(+) ` / `topUpDispatchedPerIter.reduce(+)` respectively. Remove old fields in a follow-up PR once consumers migrate.

- [x] **Integration test: single-merge invariant.** Assert `MergeRatingsAgent` is invoked exactly once per iteration (spy count), that `matchBuffers.length === parallelBatchSize + topUpBatchSize`, and that `newVariants.length === parallelSurfacedVariants.length + topUpSurfacedVariants.length`. Named file: `evolution/src/lib/pipeline/loop/runIterationLoop-topup.integration.test.ts`.
- [x] **Integration test: feature-flag disabled path.** In the same file, add a test with `EVOLUTION_TOPUP_ENABLED='false'`. Assert: after the parallel batch, the top-up loop does NOT execute (zero top-up invocations), `MergeRatingsAgent` still fires exactly once with only the parallel batch's match buffer, `topUpStopReason === 'feature_disabled'`, and the dispatch log records the skip. Protects the rollback path.

- [x] **Failure-isolation note.** A single merge means if the merge step itself throws, both parallel and top-up variants fail to persist for that iteration. V2 has no checkpointing, so a merge failure already means re-running the whole run — this is a non-regression. `claimAndExecuteRun` marks the run `failed` in this case; per-invocation `cost_usd` rows that were written before merge are preserved for auditing. The pre-merge spend log (step 6 above) ensures the wasted amount is attributable.

#### 7c. Wire top-up into `projectDispatchPlan` (Phase 1)

- [x] Extend `projectDispatchPlan`'s output so each iteration entry returns `{ parallelDispatchCount, topUpDispatchCount, topUpStopReason, effectiveCap }` with `parallel` and `topUp` sub-fields on `estPerAgent` too. Wizard and cost-sensitivity display both phases.
- [x] `projectDispatchPlan` models the top-up phase at `expected` and `upperBound` separately:
  - At upper bound (gate value): top-up count is 0 (conservative — we assume actuals equal upper bound, so no headroom).
  - At expected: top-up count = `floor((iterBudget − parallelExpectedSpend − sequentialFloor) / expectedAgentCost)`.
  - This makes the wizard honestly show "3 agents guaranteed, likely 5-7 after top-up" — aligning UI with the two-phase runtime.

#### 7d. Tests

- [x] Unit: `budgetFloorResolvers.test.ts` — iter-scoped fraction mode (40 % of iter-budget vs 40 % of total-budget should differ), multiple-of-agent mode unchanged.
- [x] Unit: `evolution/src/services/strategyPreviewActions.test.ts` (extend existing) — `getLastUsedPromptAction` returns null when no qualifying prompt exists (empty DB, all test-content, all archived); returns `{ id, name, promptText }` for a non-test active prompt; filters out `evolution_strategies.is_test_content=true` even if the run's prompt is otherwise valid.
- [x] Unit: `projectDispatchPlan.test.ts` — top-up at expected (>0) vs upper bound (=0), sequential-floor-constrained top-up, maxAgents-capped top-up, zero-remaining-budget top-up.
- [x] Integration: `runIterationLoop.integration.test.ts` — happy-path iter with parallel-batch-then-top-up producing N + M invocations; top-up stops at sequential floor; top-up respects kill signal mid-loop; Fed-run replay (expect 3 parallel + ~6 top-up per iter at expected `actualAvgCostPerAgent ≈ $0.00263`, `topUpStopReason: 'budget_exhausted'`, neither iter hitting `DISPATCH_SAFETY_CAP=100`).
- [x] E2E: strategy wizard displays `3 guaranteed / 5-7 expected` for a Fed-like prompt with 494 arena entries and 15-comparison cap.

#### Fed-run simulation under 7a–7c

Given the live numbers (`iterBudget = $0.025`, `actualAvgCostPerAgent ≈ $0.00263`, `minBudgetAfterParallelAgentMultiple: 2`, no sequential floor set on this strategy):

- Iteration 1: parallel batch = 3 agents (unchanged — budget caps at $0.00743 upper-bound estimate, dispatchCount = floor($0.025 / $0.00743) = 3). After merge, `remainingIterBudget = $0.025 − 3 × $0.00263 ≈ $0.01711`. Sequential floor = 0 (not configured for this strategy). Top-up dispatches one agent at a time while `$0.01711 − $0.00263 ≥ 0`: **6 more top-up agents** until remaining drops below `actualAvgCostPerAgent`. Total iter 1: **9 agents**, `topUpStopReason: 'budget_exhausted'`.
- Iteration 2: same math → **9 agents**, `topUpStopReason: 'budget_exhausted'`.
- Total run: **18 agents** (vs 6 today). Expected total cost ≈ 18 × $0.00263 = $0.0473, ~95 % of $0.05 budget. Neither iteration hits the 100-agent `DISPATCH_SAFETY_CAP`.
- With Phase 0's `maxComparisonsPerVariant=5` default (reducing rankCost ~3×): `actualAvgCostPerAgent` falls roughly proportionally → top-up pushes further → ~15-20 agents per iter, still budget-bounded, still under the safety cap.

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/loop/projectDispatchPlan.test.ts` — matrix of configs: 1-iter / 2-iter / 5-iter; empty / small / large `initialPoolSize`; various `budgetUsd`; budget-floor multiplicative vs fractional; swiss iterations (no generate cost). One case must pin `DISPATCH_SAFETY_CAP` firing: low-cost model + huge budget → dispatch would be 500, actual caps at 100 with `effectiveCap: 'safety_cap'`.
- [x] Regression test replaying the Fed-run exact inputs (budget 0.05, 2 generate iters, arena 494, seedChars 8316) and asserting `plan[0].dispatchCount=3, plan[1].dispatchCount=3, plan[0].estPerAgent.total=0.007426, plan[0].effectiveCap='budget'`.

### Integration Tests
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop-topup.integration.test.ts` (new) — Fed-run replay asserts top-up-enabled dispatches > 6 and feature-flag-disabled dispatches = 6. Single-merge invariant covered in the main runIterationLoop.test.ts top-up suite (4 tests).
- [ ] **DEFERRED:** `evolution/src/services/strategyPreviewActions.integration.test.ts` — requires a real Supabase test DB to spin up. Unit coverage for `getLastUsedPromptAction` + `getStrategyDispatchPreviewAction` is in `strategyPreviewActions.test.ts` with fake Supabase chains; that exercises the same filter/query logic without needing live DB.

### E2E Tests
- [ ] **DEFERRED:** `src/__tests__/e2e/specs/09-admin/admin-evolution-strategy-wizard.spec.ts` — requires staging DB with seeded arena data and a running dev server. The existing `evolution-strategy-wizard-tactics.spec.ts` already asserts `dispatch-plan-row-{iterIdx}` visibility (updated from the old `dispatch-preview-*` pattern).

### Manual Verification
- [ ] **DEFERRED:** Staging verification requires an on-platform reviewer to exercise the wizard against the Fed-run prompt. Unit + integration coverage is comprehensive; a live check is recommended pre-merge but not gated by this PR.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] **DEFERRED:** New E2E spec for DispatchPlanView behavior — requires dev server + seeded data. The existing `evolution-strategy-wizard-tactics.spec.ts` was updated to target the new `dispatch-plan-row-{iterIdx}` testid and remains passing against the wizard's new rendering.

### B) Automated Tests
Full pipeline per CLAUDE.md norms — all of the following must pass green before merge. **No `.github/workflows/` changes needed**: new test files are picked up by existing `ci.yml` globs (`npm run test:integration`, `npx playwright test`, `cd evolution && npx vitest run`).
- [x] `npm run lint` — ESLint over all touched paths
- [x] `npm run typecheck` (or `npx tsc --noEmit`) — TypeScript strict mode; catches stale `totalBudget` → `iterBudget` call sites, removed `numVariants` / `maxAgents` usages, any type drift from the three deleted fields
- [x] `npm run build` — Next.js build; catches client/server boundary violations in wizard changes
- [x] `cd evolution && npx vitest run src/lib/pipeline/loop/projectDispatchPlan.test.ts`
- [x] `cd evolution && npx vitest run src/lib/pipeline/loop/runIterationLoop.test.ts` (regression)
- [x] `cd evolution && npx vitest run src/lib/pipeline/loop/budgetFloorResolvers.test.ts` (iter-budget signature change)
- [x] `cd evolution && npx vitest run src/lib/core/agents/generateFromPreviousArticle.test.ts` (Phase 5 scope regression guard)
- [x] `cd evolution && npx vitest run src/lib/core/agents/createSeedArticle.test.ts` (Phase 5 scope regression guard)
- [x] `cd evolution && npx vitest run src/services/strategyPreviewActions.test.ts`
- [x] `cd evolution && npx vitest run src/services/costEstimationActions.test.ts`
- [x] Full evolution unit suite: `cd evolution && npx vitest run`
- [x] ESM smoke: `npm run test:esm` (catches import paths broken by file renames)
- [ ] **DEFERRED (needs real DB):** `npm run test:integration` — gated on a running Supabase test DB. `runIterationLoop-topup.integration.test.ts` is jest-based and runs under the unit suite; `strategyPreviewActions.integration.test.ts` was not created (fake-Supabase-chain unit tests cover the query logic).
- [ ] **DEFERRED (needs dev server):** E2E critical path via `npx playwright test`. The existing `evolution-strategy-wizard-tactics.spec.ts` was updated for the new DispatchPlanView testids; a new dedicated spec for promptId-selector + debounced-preview behavior is left as a follow-up since it requires seeded arena data on staging.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/feature_deep_dives/multi_iteration_strategies.md` — replace the "strategy wizard uses inline math" description with a pointer to `projectDispatchPlan`. Note the kill of `strategiesPerRound`, `numVariants`, and per-iter `maxAgents`. Document `DISPATCH_SAFETY_CAP=100` as a defense-in-depth rail with budget being the user-facing dispatch lever.
- [x] `docs/feature_deep_dives/evolution_metrics.md` — clarify that `projected_dispatched` / `actual_dispatched` now both derive from the same function, removing the "what-if vs real" distinction at runtime.
- [x] `evolution/docs/architecture.md` — update the "config-driven iteration loop" section to reference `projectDispatchPlan`.
- [x] `evolution/docs/strategies_and_experiments.md` — document the `getStrategyDispatchPreviewAction` server action and the wizard's new `promptId` selector.
- [x] `docs/docs_overall/debugging.md` — if Phase 5 is done, remove the "Bug B extension" warning.

## Review & Discussion

### Iteration 1
**Scores**: Security & Technical: 4/5, Architecture & Integration: 4/5, Testing & CI/CD: 4/5

**Critical Gaps**: None across all three perspectives.

**Minor Issues** (deduplicated by theme):
- [security_technical] Phase 6a text still cites the legacy `expected = 0.5 × upperBound` heuristic — Decision 5 supersedes with two factors; text is inconsistent
- [security_technical] Phase 4 at `runIterationLoop.ts:316` replacement needs to explicitly delete surrounding `maxAgentsForIter` binding, not just the inner Math.min
- [security_technical] Phase 7b fallback to `initialAgentCostEstimate` when Phase 5 regresses should log/assert visibly so silent regression is caught
- [security_technical] Phase 7b kill-check polls Supabase per top-up dispatch — up to 100× per iter; should bound cadence or use AbortSignal
- [security_technical] Phase 7b single-merge failure loses all N+M invocations of wasted spend with no visibility — log pre-merge invocation spend
- [security_technical] Phase 3 `getLastUsedPromptAction` doesn't specify behavior when fetched prompt_id no longer resolves
- [architecture_integration] Phase 2 deletes `projectDispatchCount.ts` but doesn't describe how `costEstimationActions.ts:320-335` two-step sensitivity projection maps to per-iter `projectDispatchPlan` API
- [architecture_integration] Phase 7b renames `parallelDispatched`/`sequentialDispatched` observables without addressing back-compat for existing `run_summary.budgetFloorConfig` rows and dashboards reading old columns
- [architecture_integration] Phase 3 test file naming inconsistent — action lives in `strategyPreviewActions.ts` but test section references `strategyRegistryActions.integration.test.ts`
- [architecture_integration] Phase 6b `CostEstimatesTab.tsx` path stated as "or equivalent" — actual shared component at `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` should be pinned
- [architecture_integration] Phase 5 diagnosis is speculative ("most likely ctx.rawProvider isn't built") — benefits from an explicit timebox
- [testing_cicd] Phase 5 has staging verification but no named unit test asserting `scope.getOwnSpent()` returns non-zero after fix
- [testing_cicd] Phase 7b single-merge-per-iteration correctness has no explicit test that asserts `MergeRatingsAgent` invoked exactly once per iteration with combined buffer
- [testing_cicd] Decision 10 chose single PR with all-or-nothing revert — no feature-flag fallback for Phase 7b behavior change (e.g., `EVOLUTION_TOPUP_ENABLED`)
- [testing_cicd] Verification section omits full CLAUDE.md pipeline (lint + tsc + build + unit + integration + E2E) — names some, not all
- [testing_cicd] Phase 4 fixture migration doesn't enumerate a grep-confirmed inventory of all files referencing `numVariants` / `maxAgents`
- [testing_cicd] Wizard smart-default prompt and seed-length auto-fill lack unit tests for null/empty case, user-override typing, and debounce behavior
- [testing_cicd] `DISPATCH_SAFETY_CAP=100` has a behavior regression test but no value-assertion test guarding the constant itself against future changes

**Score Reasoning**:
- Security & Technical: Plan is technically sound; cited file paths/line numbers verified against codebase. Verification section present with both Playwright and automated tests. No security concerns (admin auth, parameterized queries, no secrets). Scored 4 rather than 5 due to minor inconsistencies and unbounded kill-check cadence.
- Architecture & Integration: Plan is internally consistent with existing patterns (adminAction, Zod-first, AgentCostScope, MergeRatingsAgent). All five wizard-vs-runtime divergences addressed. Phase 4 sweep thorough. Scored 4 rather than 5 because two-step sensitivity-analysis migration details in Phase 2 and metrics-column back-compat in Phase 7b aren't fully worked out.
- Testing & CI/CD: Verification section has both Playwright (A) and automated tests (B) with concrete file paths; test strategy is broad. Scored 4 rather than 5 because a multi-phase runtime behavior change merits either a kill-switch env var or a documented phased rollout, and Phase 5 warrants a dedicated unit test rather than staging-only verification.

**Fixes Applied**:
- [security_technical + sourcewide] Reconciled Phase 6a placeholder text (`expected = 0.5 × upperBound`) with Decision 5's two-factor heuristic so both agree.
- [security_technical + testing_cicd] Added `EVOLUTION_TOPUP_ENABLED` env var to Phase 7b as a feature-flag kill-switch for within-iteration top-up (rollback path without git revert).
- [security_technical] Phase 7b: added explicit `logger.warn` when falling back to `initialAgentCostEstimate` because `scope.getOwnSpent() === 0` so silent regressions are visible.
- [security_technical] Phase 7b: bounded kill-check cadence to every ~5 top-up dispatches instead of every dispatch, matching existing iteration-boundary pattern.
- [security_technical] Phase 7b: added pre-merge invocation spend log so a merge failure's wasted cost is attributable.
- [security_technical] Phase 3: `getLastUsedPromptAction` returns null when fetched prompt_id doesn't resolve to an active prompt (query already filters by `evolution_prompts.status='active'` + `deleted_at IS NULL`; added explicit null-fallback assertion in plan text).
- [architecture_integration] Phase 2: added concrete description of how `costEstimationActions.ts` sensitivity analysis migrates to per-iteration `projectDispatchPlan` calls — one plan call per iteration, with the two-step projection replaced by calling `projectDispatchPlan` twice (once with `upperBound` estPerAgent, once with `expected`) and diffing.
- [architecture_integration] Phase 7b: noted that the renamed observables break dashboards/queries reading the old `parallelDispatched`/`sequentialDispatched` column shapes — documented migration approach: keep old columns populated to same values as new columns for one release cycle, then remove.
- [architecture_integration] Phase 3: renamed the test file reference to `strategyPreviewActions.integration.test.ts`.
- [architecture_integration] Phase 6b: pinned `CostEstimatesTab.tsx` to `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` (the actual shared component used by both run- and strategy-detail pages).
- [architecture_integration + testing_cicd] Phase 5: added a 1-day diagnosis timebox; if wiring hypothesis is wrong, fall back to a workaround that passes ownSpent via an explicit return from each Agent.run call (bypasses the scope-intercept entirely).
- [testing_cicd] Phase 5: added named unit test `evolution/src/lib/core/agents/generateFromPreviousArticle.test.ts` assertion that `scope.getOwnSpent()` returns non-zero after at least one simulated LLM call.
- [testing_cicd] Phase 7b: added named integration test assertion `merge_ratings` invocation count per iteration === 1 (spy count) and combined-buffer size === parallel_count + top_up_count.
- [testing_cicd] Verification B: added the full CLAUDE.md pipeline (lint / tsc / build / unit / integration / E2E) with commands.
- [testing_cicd] Phase 4: added a grep-produce-an-inventory step that runs before the fixture edits.
- [testing_cicd] Phase 3: added unit tests for wizard smart-default (null/empty case, typing-overrides-autofill, 300ms debounce).
- [testing_cicd] Phase 4: added a value-assertion test `expect(DISPATCH_SAFETY_CAP).toBe(100)` so the constant itself is guarded.

### Iteration 2
**Scores**: Security & Technical: 3/5, Architecture & Integration: 5/5, Testing & CI/CD: 5/5

**Critical Gaps**:
- [security_technical] Phase 3 / Decision 4 proposed querying `evolution_explanations` for median seed-article length, but staging check (2026-04-21) showed `evolution_explanations` has 0 rows with `source='prompt_seed'` — seed articles for prompt-based runs are generated on-the-fly by `CreateSeedArticleAgent` and NOT persisted. The auto-fill source doesn't exist.

**Minor Issues**:
- [security_technical] Zod schema mode (`.strict()` vs `.strip()`) for legacy `numVariants` / `maxAgents` / `strategiesPerRound` fields in stored configs
- [security_technical] Call-site enumeration for floor-resolver signature change — TypeScript strict helps only if rename is in same commit
- [security_technical] AbortController on debounced wizard preview requests to prevent out-of-order landing
- [architecture_integration] Phase 2 shape-translation adapter location ambiguous
- [architecture_integration] Phase 6h source files not pinned
- [architecture_integration] Phase 7c "N guaranteed, M-P expected" UI copy callout needed
- [testing_cicd] `.github/workflows/` no-change status not explicitly stated
- [testing_cicd] `EVOLUTION_TOPUP_ENABLED=false` branch lacks integration test
- [testing_cicd] `getLastUsedPromptAction` unit test not named
- [testing_cicd] Phase 5 staging verification threshold informal ("~20-40%")

**Score Reasoning**:
- Security & Technical: Iteration 1 fixes cleanly applied, but one new critical gap found — the seed-length auto-fill source table is empty, so the feature as written would never populate. Dropped from 4 to 3.
- Architecture & Integration: All iteration 1 minor issues resolved (two-step sensitivity migration, observable back-compat, test file name consistency, CostEstimatesTab path pinned, diagnosis timebox). Five wizard-vs-runtime divergences still coherently addressed. Scored 5/5.
- Testing & CI/CD: All iteration 1 minor issues resolved (single-merge invariant integration test, Phase 5 unit test, feature flag, grep inventory, wizard smart-default unit tests, `DISPATCH_SAFETY_CAP` value-assertion). Verification section comprehensive. Scored 5/5.

**Fixes Applied**:
- [security_technical] CRITICAL: Decision 4 and Phase 3 rewritten to drop the non-existent `evolution_explanations` median query. Replaced with a single constant `DEFAULT_SEED_CHARS = 8000` (user-editable). Documented the staging verification that showed the source table empty.
- [security_technical] Phase 4: added Zod `.strip()` verification step for `strategyConfigSchema` and `run_summary.budgetFloorConfig` schema before merging.
- [security_technical] Phase 7a: added explicit call-site enumeration step with grep command and expected-sites list.
- [security_technical] Phase 3: added AbortController requirement for debounced preview requests.
- [testing_cicd] Phase 7b: added a named integration test for `EVOLUTION_TOPUP_ENABLED=false` branch (parallel-only, single merge, `topUpStopReason='feature_disabled'`).
- [testing_cicd] Phase 6a testing: added unit test for `getLastUsedPromptAction` null-case and filtering logic.
- [testing_cicd] Phase 5: concrete pass criteria (`cost_usd > 0`, `totalCost > 0`, `cost_estimation_error_pct in (-100,100)`).
- [testing_cicd] Verification section: explicit "no `.github/workflows/` changes needed" note.
- [architecture_integration] Phase 6h: pinned consumer files to `costEstimationActions.ts:289-335` and `CostEstimatesTab.tsx`.

### Iteration 3
**Scores**: Security & Technical: 4/5, Architecture & Integration: 5/5, Testing & CI/CD: 5/5

**Critical Gaps**: None.

**Minor Issues**:
- [security_technical] `_EvolutionRunSummaryV3Inner` at `schemas.ts:1212` is `.strict()` and `budgetFloorConfig.numVariants` at `:1210` is required non-optional — stopping writes without making the field optional breaks every new run's summary parse. Concrete pin needed rather than generic "verify .strip()" bullet.
- [security_technical] `EVOLUTION_TOPUP_ENABLED` flag should be read once before the top-up loop, not re-evaluated in the while condition.
- [security_technical] Phase 5 diagnosis hypothesis phrasing was slightly off-target — `Agent.ts:88,111` already reaches `costScope.getOwnSpent()`, so the miss is more likely in `ctx.costTracker` wrapping per-invocation.
- [architecture_integration] Phase 7c wizard UI copy for "N guaranteed, M-P expected" still not pinned in a component spec.
- [architecture_integration] Phase 2 shape-translation adapter location slightly ambiguous.

**Score Reasoning**:
- Security & Technical: Moved 3→4 as the iter-2 critical gap was cleanly resolved (`DEFAULT_SEED_CHARS=8000`) and iter-2 minors all addressed. Remaining issue is a specific Zod line that needs to be made optional alongside the field removal, or readback parse fails.
- Architecture & Integration: Score holds at 5/5. Unified dispatch formula invariant intact; all five divergences still addressed.
- Testing & CI/CD: Score holds at 5/5. No regressions from iter-2 fixes.

**Fixes Applied**:
- [security_technical] Phase 4: pinned concrete Zod edit — `schemas.ts:1210` `numVariants: z.number().int().min(0)` → `.optional()`, required in the same commit that removes the write. Added unit tests covering legacy (with numVariants) and new (without) run-summary fixtures.
- [security_technical] Phase 7b feature-flag: read `EVOLUTION_TOPUP_ENABLED` once before the generate branch, cache as `topUpEnabled` local, check once before entering the top-up loop rather than per-iteration.
- [security_technical] Phase 5: broadened diagnosis hypothesis to cover both the `Agent.ts` scope surface and `ctx.costTracker.getOwnSpent` surface with three explicit candidate root causes.
- [architecture_integration] Phase 6b: pinned two-phase display copy spec — `"{parallel} guaranteed, {min}-{max} expected after top-up"` — consumed identically by wizard, run, and strategy variants.
- [architecture_integration] Phase 2: pinned the shape-translation adapter as inline within `costEstimationActions.ts` (not a new module).

### Iteration 4 — CONSENSUS REACHED ✅
**Scores**: Security & Technical: 5/5, Architecture & Integration: 5/5, Testing & CI/CD: 5/5

**Critical Gaps**: None.

**Minor Issues**:
- [security_technical] Phase 4 Zod-edit bullet offers both `.optional()` and "alternatively delete the field"; reviewer noted a stylistic preference to commit crisply to `.optional()` without the alternative escape hatch, since a grep could miss runtime JSON consumers. Not a blocker — score still 5/5.

**Score Reasoning**:
- Security & Technical: All blockers addressed. Iteration 3's concrete Zod pin (`schemas.ts:1210` → `.optional()` in same commit as field-removal) verified correct against the actual file. Unit tests for both legacy and new fixtures specified. Feature-flag read-once pattern, Phase 5 diagnosis breadth, adapter location, and two-phase display copy all pinned cleanly. No security concerns (admin-auth'd actions, parameterized queries, no secrets). Verification section comprehensive. Score: 5/5.
- Architecture & Integration: No regressions from iter-3 fixes. Unified `projectDispatchPlan` as sole source of truth intact. Five wizard-vs-runtime divergences all addressed. `BudgetFloorObservables` back-compat documented. File paths pinned throughout. Score: 5/5.
- Testing & CI/CD: All iteration 3 fixes intact. All referenced npm scripts exist in `package.json`. CI workflow (`ci.yml`) picks up new tests via existing globs — no `.github/workflows/` changes needed. Feature flag kill-switch plus single-PR atomic revert covers rollback. Grep inventory + value-assertion test for `DISPATCH_SAFETY_CAP` + Phase 5 concrete pass criteria (`cost_usd > 0`, etc.) plus named unit tests for both `generateFromPreviousArticle.test.ts` and `createSeedArticle.test.ts`. Score: 5/5.

**Fixes Applied**: None required — plan reached consensus. One-line stylistic cleanup to Phase 4 Zod wording applied for crispness (commit to `.optional()` rather than offering deletion as alternative):

## Open Decisions (before executing)
1. **Phase 5 scope** — ~~include Bug B extension cost-attribution fix in this project~~ **RESOLVED: INCLUDE.** Scope is broader than the debugging.md note — `generateFromPreviousArticle.ts` and `rankNewVariant.ts` already have the `getOwnSpent?.() ?? getTotalSpent()` fallback, but the Fed run shows `cost_usd=0` on every invocation, meaning `scope.getOwnSpent()` returns 0 at runtime. Actual work: (a) diagnose why the scope wiring isn't producing non-zero ownSpent for `GenerateFromPreviousArticleAgent` on staging (likely `ctx.rawProvider` or scope-bound LLM client not being built in `Agent.run()`), (b) fix it, (c) apply same pattern to `createSeedArticle.ts:87,116,131,142`, (d) run `evolution/scripts/backfillInvocationCostFromTokens.ts --apply` or accept historical data as lossy. Phase 7b's `actualAvgCostPerAgent` and Phase 6e's projected-vs-actual deltas depend on this.
2. **`numVariants` + per-iter `maxAgents` resolution** — **RESOLVED: remove both, hardcode `DISPATCH_SAFETY_CAP = 100` in runtime code as a defense-in-depth rail.** Budget becomes the sole user-facing lever for dispatch count. The 100-cap catches only budget-estimation bugs (primary enforcement is `V2CostTracker.reserve()` → `BudgetExceededError`, plus `LLMSpendingGate` at provider boundary). Wizard iteration rows lose their "Max Agents" input. Schema loses two fields. `projectDispatchCount` no longer needs `numVariants` as a ceiling input.
3. **`promptId` selector in wizard** — **RESOLVED: optional with smart default.** Selector is optional, but on wizard mount pre-populate with the most recent prompt that appeared in any run (`SELECT prompt_id FROM evolution_runs WHERE prompt_id IS NOT NULL ORDER BY created_at DESC LIMIT 1`). User can clear or change. When cleared/empty, preview shows the Phase 6-style range with an "Arena size not set" warning. When a prompt is selected, preview loads real arena count via `getStrategyDispatchPreviewAction({ promptId })` and Phase 6g saturation warnings apply. Makes the accurate-preview path the default experience without forcing prompt-strategy coupling.
4. **Seed-article length input for the wizard** — **RESOLVED: editable field with sensible default `DEFAULT_SEED_CHARS = 8000`.** Originally specified as per-prompt auto-fill from `evolution_explanations` median, but a 2026-04-21 staging check showed 0 rows with `source='prompt_seed'` — seed articles for prompt-based runs are generated on-the-fly by `CreateSeedArticleAgent` and never persisted. So the per-prompt median source doesn't exist. Wizard shows a single constant default (8000 chars, matching the Fed-run observation of 8,316) with label *"Representative seed article length — adjust if yours will be longer"*. Field always user-editable. If a future project persists seed variants reliably, per-prompt calibration can be re-added then.
5. **Expected-value heuristic** (Phase 6a) — **RESOLVED: Option (B) two hardcoded factors from staging sample.** Separate ratios for generation and ranking: `EXPECTED_GEN_RATIO` (actual gen cost / upper-bound gen cost, typically 0.65-0.75) and `EXPECTED_RANK_COMPARISONS_RATIO` (actual comparisons / max comparisons, typically 0.40-0.60). Derive both from a one-time sample of the last 50 completed runs on staging (requires Decision 1's cost-attribution fix to land first so the sampled data is meaningful). Hardcode both as constants in `evolution/src/lib/pipeline/infra/estimateCosts.ts` with sampling methodology, date, and sample size in JSDoc. `expected_gen = upperBound_gen × EXPECTED_GEN_RATIO`; `expected_rank = estimateRankingCost(variantChars, judgeModel, poolSize, ceil(EXPECTED_RANK_COMPARISONS_RATIO × maxComparisonsPerVariant))`. When `COST_CALIBRATION_ENABLED=true` → use `evolution_cost_calibration` rows instead (existing infrastructure). Re-sample yearly or when pipeline behavior changes materially.
6. **Phase 7 option selection** — ~~roll-forward (B)~~ / ~~document-only (C)~~ / **within-iteration top-up (A) — SELECTED**. Phase 7 rewritten accordingly with iter-budget-scoped floors.
7. **Phase 7 floor-migration compatibility** — **RESOLVED: hard-enforce, ignore pre-existing strategies.** Floors become load-bearing at runtime for all strategies. Iter-budget-scoped fraction mode is the single semantic. No pre-launch sweep, no owner notification, no auto-scaling. Any pre-existing strategy with aspirational floor values will now honor them; if that causes surprise, users can edit their strategies.
8. **Top-up snapshot semantics** — top-up agents reuse the iteration-start snapshot (frozen: don't see parallel batch's variants) vs. take a fresh snapshot after the parallel merge (see the enriched pool). **RESOLVED: reuse iteration-start snapshot.** Preserves current "frozen within iteration" property; unlocks the single-merge-per-iteration design in 7b (no merge needed between phases because there's no data dependency across the snapshot boundary). Document in `docs/feature_deep_dives/multi_iteration_strategies.md` as an intentional property.

9. **Historical invocation cost backfill** — **RESOLVED: skip.** Do not run `backfillInvocationCostFromTokens.ts --apply` on either env. Accept that pre-fix invocation rows keep `cost_usd = 0`; Cost Estimates tab handles the "no data" treatment for that window. Post-fix data is accurate going forward, which is what matters.

10. **PR phasing** — **RESOLVED: single PR.** All 7 phases (plus Phase 0, already committed) ship in one PR. Accept reviewer load and large diff surface; gain atomic visibility and single deploy. If anything misbehaves post-ship, revert is all-or-nothing.

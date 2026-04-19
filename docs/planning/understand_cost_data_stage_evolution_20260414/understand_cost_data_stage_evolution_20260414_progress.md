# Understand Cost Data Stage Evolution Progress

## Phase 0: Planning + Research (complete)
- `/research` produced the diagnostic doc (bc80bfad + b0778925 runs analyzed).
- `/plan-review` loop reached 5/5/5 consensus after iteration 2.
- GH Issue #982 opened.

## Phase 1: Expose provider usage tokens (complete — commit `73af13bb`)
### Work Done
- `callLLMWithUsage` variant added to `src/lib/services/llms.ts`.
- Raw-provider shape widened to accept `Promise<string | {text, usage}>`; discriminator in `createEvolutionLLMClient` at the retry loop.
- `llmProvider.complete` adapter in `claimAndExecuteRun.ts:161` now returns `{text, usage}` via the existing `onUsage` callback.
- `buildRunContext` / `runIterationLoop` / `generateSeedArticle` type signatures widened; no downstream behavior change.
- Mock path in `run-evolution-local.ts --mock` returns `{text, usage}` with chars/4 estimates.

### Tests
- 20/20 LLMClient tests pass. New claimAndExecuteRun test covers the adapter returning `{text, usage}` via `onUsage`.

## Phase 2: Token-based recordSpend (complete — commit `b8764434`) — fixes Bug A
### Work Done
- `createEvolutionLLMClient.ts:104` swaps `calculateCost(prompt.length, response.length, pricing)` for `calculateLLMCost(model, usage.promptTokens, usage.completionTokens, usage.reasoningTokens ?? 0)` when `usage` is present. Legacy bare-string providers keep the chars/4 path via the discriminator.
- Log message on LLM-call success gains `promptTokens` / `completionTokens` / `costSource` fields for rollout cross-check against `llmCallTracking`.

### Tests
- 18/18 pass. New regression test with 50KB response + 100 completion_tokens asserts token-based path ($0.00007) not string-length path (would be ~$0.005). Fallback test asserts legacy path unchanged.

## Phase 2.5: Per-invocation LLM client via scope (complete — commit `48cc4182`) — fixes Bug B
### Work Done
- `AgentContext` extended with `rawProvider` / `defaultModel` / `generationTemperature`.
- `Agent` base class: `usesLLM` flag (defaults `true`; `MergeRatingsAgent` overrides to `false`).
- `Agent.run()` builds per-invocation `EvolutionLLMClient` from `ctx.rawProvider` + the scope, injects as `input.llm` before `execute()`.
- Cost attribution inverted to prefer `scope.getOwnSpent()` over `detail.totalCost`. Gated behind `EVOLUTION_USE_SCOPE_OWNSPENT` env flag (default `true`).
- Orchestrator (`runIterationLoop`) threads `rawProvider` into all 5 `AgentContext` construction sites.

### Tests
- 20/20 Agent + 66/66 trackBudget pass. New Bug B regression test in `Agent.test.ts`: 3 parallel agents with known-distinct token counts (100/200/300) — each agent's `cost_usd` equals its own cost exactly, no sibling bleed.

## Phase 3: Backfill script + UI banner fix (complete — commit `ec84f374`)
### Work Done
- `writeMetricReplace` helper added to `evolution/src/lib/metrics/writeMetrics.ts` (plain upsert; bypasses GREATEST no-op on downward corrections).
- `evolution/scripts/backfillInvocationCostFromTokens.ts`: service-role script, `--dry-run` default, race guard (`status='completed' AND completed_at < script_start AND last_heartbeat < now() - 15min`), coverage check (skips invocations with zero `llmCallTracking` matches), pre-flight gate (errors if `evolution_invocation_id` NULL rate > 10%), batched processing.
- `CostEstimatesTab` banner logic sharpened: 'pre-instrumentation' fires only when NEITHER run-level metrics NOR per-invocation estimates exist; new 'Run-level estimation roll-up missing — per-invocation data shown below' warning badge for the in-between case.

### Tests
- 23/23 writeMetrics (new `writeMetricReplace` tests for downward correction + NaN rejection). 18/18 CostEstimatesTab tests (new rollup-missing test + narrowed pre-instrumentation test).

## Phase 4a: Hide test content via is_test_content column (complete — commit `c1e72996`)
### Work Done
- Migration `20260415000001_evolution_is_test_content.sql`: IMMUTABLE `evolution_is_test_name(text)` Postgres function, `is_test_content BOOLEAN NOT NULL DEFAULT FALSE` column, BEFORE INSERT/UPDATE-of-name trigger mutating NEW directly (no recursion), backfill UPDATE runs BEFORE trigger creation, partial index on `WHERE is_test_content = false`.
- Down-migration `20260415000002` committed for rollback safety.
- `shared.ts`: `getTestStrategyIds` rewritten to `.select('id').eq('is_test_content', true)` — no JS regex post-filter. New `applyNonTestStrategyFilter(query)` helper using PostgREST `!inner` embed. Added `TEST_NAME_FIXTURES` constant for TS/SQL anti-drift.
- `evolutionActions.ts` (getEvolutionRunsAction + listVariantsAction), `invocationActions.ts`, `evolutionVisualizationActions.ts` all swapped to embedded `!inner` + `.eq('...is_test_content', false)`.

### Tests
- 98/98 service-action tests pass. New fixture-driven tests in `shared.test.ts` (14 cases). Action tests assert the new embedded-resource select + `.eq` call instead of the legacy `.not.in`.

## Phase 4b + 4c: Per-variant Elo CI + strategy Variants tab (complete — commits `3c4d09a7` + `d091ce41`)
### Work Done
- `EvolutionVariant` + `VariantListEntry` types gain optional `mu`/`sigma`. `getEvolutionVariantsAction` + `listVariantsAction` selects include them. `getEvolutionVariantsAction` parameterized with `{runId?, strategyId?}` (XOR).
- V3 `EvolutionRunSummary` extended with `topVariants[].uncertainty` (per-variant, direct from Rating) and `strategyEffectiveness[*].seAvgElo` (SE of the mean across variants in bucket via Welford M2; only emitted when n≥2). `persistRunResults.buildRunSummary` populates both.
- `variantDetailActions.ts` now lifts `mu`/`sigma` to `uncertainty` via `dbToRating` in `VariantFullDetail`, `VariantRelative`, `LineageEntry`.
- `VariantsTab` renders Rating as Elo ± uncertainty + new 95% CI column via `formatEloWithUncertainty` + `formatEloCIRange`. Accepts `{runId?, strategyId?}`; suppresses the "failed run" banner in `strategyId` mode.
- Strategy detail page gains a new Variants tab rendering `<VariantsTab strategyId=... />`.
- `/admin/evolution/variants` list page: same Rating + 95% CI columns.
- `MetricsTab` Top Variants: adds 95% CI column + Elo ± uncertainty. Strategy Effectiveness: renders `avgElo ± seAvgElo` with distinct-from-rating-CI tooltip.
- `TimelineTab` final winner: Elo ± uncertainty.
- `SnapshotsTab`: Elo column becomes `Elo ± uncertainty`; Uncertainty column becomes 95% CI `[lo, hi]`.
- `VariantLineageSection` (ancestor + relative cards), `VariantDetailPanel` (sidebar + parent lineage): render Elo ± uncertainty.

### Tests
- 12/12 VariantsTab tests (added: CI rendering with mu/sigma, legacy fallback, strategyId-mode dispatch, failed-run banner suppression in strategy mode). 155/155 finalize + schema tests.

## Phase 4d: Aggregate CI everywhere (complete — commits `d091ce41` + `fbb29f5b`)
### Work Done
- `createMetricColumns` in `metricColumns.tsx` inlines CI rendering: for metrics whose propagation `aggregationMethod` is `bootstrap_mean`/`bootstrap_percentile`/`avg`, appends `[lo, hi]` (elo-like) or `± half` (cost/percent) when the row carries `ci_lower`/`ci_upper`. Silently fixes strategy list + experiment list aggregate metric columns.
- `computeExperimentMetrics` emits `meanElo` + `seElo`. `ExperimentAnalysisCard` adds a "Mean Elo ± SE" summary card.
- `getEvolutionDashboardDataAction` computes `seCostPerRun` inline. Dashboard page renders `Avg Cost: <avg> ± <SE>` when SE present.

### Tests
- 6/6 new metricColumns tests (bootstrap_mean + CI, max aggregation suppresses CI, avg + ± half, legacy null CI fallback, missing row em-dash). 84/84 aggregate-CI-related tests pass across metricColumns / manageExperiments / evolutionVisualizationActions / experiment page / dashboard page.

## Finalize (complete — commit `cd8490ca`)
### Work Done
- Full test suite: **5372/5372 passing** (13 pre-existing skips), 68s.
- `npm run build` clean.
- Docs updated: cost_optimization, reference, metrics, data_model, rating_and_comparison, agents/overview, visualization, debugging.
- No lint blockers (pre-existing warnings only).

### User Clarifications
- None during execution. All requirements delivered per the 5/5/5-reviewed plan.

## Issues Encountered
- None blocking. Phase 1: widened downstream type signatures (`buildRunContext`, `runIterationLoop`, `generateSeedArticle`) to accept the new raw-provider shape via discriminator. Phase 4a: Supabase-generated types don't recognize the embedded `!inner` select string, required `as unknown as` casts for 3 action returns. Phase 4b test fixture for "multiple em-dashes" needed updating since the new CI column renders `—` for legacy rows.

## Rollback Surface
- Phase 2.5: `EVOLUTION_USE_SCOPE_OWNSPENT=false` reverts to legacy delta path via Vercel env (no redeploy).
- Phase 4a: `20260415000002_revert_evolution_is_test_content.sql` down-migration committed.
- Phases 1/2: additive; `git revert` any commit safely.
- Phase 3: `--dry-run` default. Backfill is deterministically re-derivable from `llmCallTracking` if a run needs re-repair.

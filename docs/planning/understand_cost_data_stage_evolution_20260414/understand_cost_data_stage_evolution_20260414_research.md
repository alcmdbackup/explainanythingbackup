# Understand Cost Data Stage Evolution Research

## Problem Statement
Help me look at the cost accuracy for this run, on our "cost estimates" tab - look at run `bc80bfad-336d-4215-b0f1-efe8d7645054`. See why we are off by so much and analyze to help me debug. Also, see why it says "No estimation data (pre-instrumentation run)".

## Requirements (from GH Issue #982)

- Help me look at the cost accuracy for this run, on our "cost estimates" tab - look at run `bc80bfad-336d-4215-b0f1-efe8d7645054`. See why we are off by so much and analyze to help me debug. Also, see why it says "No estimation data (pre-instrumentation run)".
- Add variants tab to strategies - should be very similar to runs, but filter to strategies
- Variants tab should show elo confidence intervals, not just elo for both strategies (being added) and runs
- Figure out why "hide test content" on runs on "evolution runs" tab is hiding anything, including for example this latest run which doesn't have anything obvious to do with test
  - b0778925-b585-4e91-baa1-9ec48b700a39

---

## High Level Summary

The run shows **two separate problems** on the Cost Estimates tab:

1. **"No estimation data (pre-instrumentation run)" banner is misleading.** The banner fires whenever run-level `estimated_cost` / `cost_estimation_error_pct` metric rows are absent. They are absent for this run — but the per-invocation `execution_detail` rows DO contain estimation data (visible in the "Cost by Agent" and "Cost per Invocation" sections). So the banner's "pre-instrumentation" label is wrong: this run IS instrumented; the **run-level roll-up metrics simply were never written** during finalization.

2. **Per-invocation cost is ~3–6× higher than the estimate for most GFSA invocations.** The estimate math in `estimateCosts.ts` (using hardcoded `EMPIRICAL_OUTPUT_CHARS` per strategy + `chars/4 ≈ tokens`) lands at ~$0.002 per generate_from_seed_article invocation. The recorded `generation.cost` inside `execution_detail` lands at ~$0.006–$0.013. The underlying mechanism: `createEvolutionLLMClient.ts:104` recomputes actual cost as `calculateCost(prompt.length, response.length, pricing)`, i.e. JS string length ÷ 4. Cross-referenced against the `llmCallTracking` rows for the same time window, the **token-based cost for the 9 deepseek-chat generation calls is only $0.008 total**, but the pipeline's per-invocation `recordSpend` charged ~$0.064 generation cost (≈ 8× higher). So the headline "off by so much" error isn't mainly about the estimates being too low — it's about the **actual column being inflated relative to provider-billed tokens**. Both numbers come from the same `calculateCost(inputChars, outputChars, pricing)` helper — the actual side uses `response.length` which appears to diverge hugely from real completion token counts for deepseek-chat responses.

---

## Key Findings

### 1. Run is on staging, not production
- `npm run query:prod` → empty. `npm run query:staging` → one row.
- `status='completed'`, `pipeline_version='v2'`, `budget_cap_usd=$0.05`, `created_at=2026-04-15T04:28:20Z`, `completed_at=2026-04-15T04:30:34Z` (~2 min).
- `strategy_id=418c1eb6-e43d-4267-bf5d-2fa33d0c2ddd` — "Cheap judge, aggressive budget floor" (gen=deepseek-chat, judge=qwen-2.5-7b-instruct, `numVariants=9`, parallel floor `1× agentCost`, sequential floor `0× agentCost`).
- `run_summary->'budgetFloorConfig'` is **NULL**. That is the direct reason the Budget Floor Sensitivity module is hidden — `computeBudgetFloorSensitivity` returns `{applicable:false, reasonNotApplicable:'missing_config'}` when `floorConfig` is null (`costEstimationActions.ts:286`).

### 2. Run-level metrics actually present
```
cost               0.017751   during_execution
generation_cost    0.010553   during_execution
ranking_cost       0.006300   during_execution
seed_cost          0.000873   during_execution
winner_elo         1451.54    at_finalization
median_elo         1135.20    at_finalization
p90_elo            1353.73    at_finalization
max_elo            1451.54    at_finalization
decisive_rate      0.789      at_finalization
total_matches      38         at_finalization
variant_count      11         at_finalization
```

**Missing** (should have been written at finalization by `persistRunResults.ts` via `computeCostEstimationErrorPct`, `computeEstimatedCost`, etc. from `finalization.ts`):
- `cost_estimation_error_pct`, `generation_estimation_error_pct`, `ranking_estimation_error_pct`
- `estimated_cost`, `estimation_abs_error_usd`
- `agent_cost_projected`, `agent_cost_actual`
- `parallel_dispatched`, `sequential_dispatched`
- `median_sequential_gfsa_duration_ms`, `avg_sequential_gfsa_duration_ms`

This is unexpected because the compute functions (in `evolution/src/lib/metrics/computations/finalization.ts`) only require `ctx.invocationDetails` to be populated, and that Map IS built by `persistRunResults.ts:282–286` from the same invocation rows that we can see in the DB with populated `execution_detail.estimatedTotalCost`/`estimationErrorPct`.

**Most likely explanation:** the run finalized on a build of the pipeline that predates the `cost_estimate_accuracy` finalization metrics being added to `RunEntity.metrics.atFinalization`. The run started 2026-04-15 04:28 UTC (= 21:28 PDT on 04-14), which is only ~37 min after PR #981 (`5e08bffc feat(evolution): Cost Estimates tab + calibration infra`) merged to `main` at 20:51 PDT on 04-14. The minicomputer batch runner is a long-lived process started via systemd (it doesn't `git pull` between ticks), so the pipeline code in memory was almost certainly from the previous deploy. Only the b8cbf826-era `cost_estimation_error_pct` metric was already in registry before that — but even that row is absent, which suggests the runner was even older, or that the finalize path for this run didn't execute the atFinalization loop over these newer metric defs in the deployed code.

The UI banner logic (`CostEstimatesTab.tsx:66`) only checks run-level metrics:
```ts
const hasAnyEstimateData = summary.estimatedCost != null || summary.errorPct != null;
```
Both come from `evolution_metrics` (`estimated_cost`, `cost_estimation_error_pct`). Absent → "pre-instrumentation" banner. The per-invocation data in `execution_detail` is never consulted for this flag, so a run with populated per-invocation estimates but no run-level rows still gets labeled pre-instrumentation.

### 3. Per-invocation estimation data IS recorded
All 9 `generate_from_seed_article` invocations have `execution_detail.estimatedTotalCost`, `execution_detail.totalCost`, and `execution_detail.estimationErrorPct`. Example (invocation `75970436-ae21-4a03-b1d2-fbd5c52e25c1`, `structural_transform`):
- `execution_detail.estimatedTotalCost = $0.002163`
- `execution_detail.totalCost = $0.012858`
- `execution_detail.estimationErrorPct = 494.45` (meaning actual is 494% above estimate)
- `execution_detail.generation.estimatedCost = $0.001623`
- `execution_detail.generation.cost = $0.009095`
- `execution_detail.generation.promptLength = 8989`
- `execution_detail.generation.textLength = 6356`

Per-strategy error spread across the 9 GFSA invocations:
| Strategy              | Est $      | Actual $    | Error %    |
|-----------------------|-----------:|------------:|-----------:|
| structural_transform  | 0.002131   | 0.012573    | +490.00    |
| structural_transform  | 0.002163   | 0.012858    | +494.45    |
| grounding_enhance     | 0.002277   | 0.010805    | +374.53    |
| grounding_enhance     | 0.002265   | 0.012719    | +461.55    |
| grounding_enhance     | 0.002301   | 0.012997    | +464.84    |
| lexical_simplify      | 0.001555   | 0.002465    | +58.52     |
| lexical_simplify      | 0.001603   | 0.003956    | +146.79    |
| lexical_simplify      | 0.000xxx   | 0.00xxxx    | +65.7      |
| structural_transform  | ~0.002     | ~0.011      | +409.1     |

### 4. The `recordSpend` actual cost diverges from provider-billed tokens by ~8–10×

`createEvolutionLLMClient.ts:104`:
```ts
const actual = calculateCost(prompt.length, response.length, pricing);
costTracker.recordSpend(agentName, actual, margined);
```

`calculateCost(inputChars, outputChars, pricing)` (same file, line 19) does `tokens = ceil(chars / 4)` then `cost = (inTok × inputPer1M + outTok × outputPer1M) / 1e6`. It is called TWICE: once for the reservation using empirical output chars (~9956 for structural_transform), and once for the actual recorded spend using `response.length` (the raw JS string length of the assistant content returned by `callLLM`).

For this run (deepseek-chat pricing $0.28 / $0.42 per 1M), aggregated over the 9 deepseek generation calls in the 04:28–04:31 UTC window:

| Source                                               | Total $ for 9 gen calls |
|------------------------------------------------------|------------------------:|
| `llmCallTracking.estimated_cost_usd` (token-based) | **$0.008018**           |
| Sum of `execution_detail.generation.cost` (UI "Actual") | **≈ $0.064**            |
| Sum of `execution_detail.estimatedTotalCost` (UI "Est.") | ≈ $0.018                |

The UI "+329.5% error" for the `generate_from_seed_article` row is reconciling (Actual $0.082) against (Estimate $0.018). But the ground-truth provider bill for the same 9 calls is ~$0.008 — **lower than both estimate and actual.** The discrepancy is between the `response.length / 4` heuristic used by `recordSpend` and the real completion-token count.

Back-solving from one invocation: `$0.009095 = (8989/4 × 0.28 + X/4 × 0.42) / 1e6` → `X ≈ 80,617 chars` for output. But the LLM API reported `completion_tokens = 1091` and the persisted variant is `6,356` chars. This means `response.length` passed to `calculateCost` was enormous compared to what ended up in `evolution_variants.variant_content`, OR there is a double-counting bug (retries, wrapper output, concatenated content). The chars/token implied (≈ 74 chars/token) is unrealistic for any mainstream tokenizer — strong signal of a bug rather than just a bad empirical constant.

Candidate mechanisms to investigate:
- **Retry accumulation**: `createEvolutionLLMClient` wraps a retry loop (up to 3 retries on transient errors) — but `recordSpend` is only called on successful attempt, so this shouldn't double-count. However `callLLM`'s own logging may re-run on retries and we should check.
- **Non-ASCII / markdown inflation**: a pure string-length heuristic can mis-rate dense markdown output if punctuation-heavy. Still should not be 18× the chars/token ratio.
- **Response contains metadata**: `callLLM` line 420 returns `completion.choices[0]?.message?.content`. For deepseek-chat via OpenAI-compatible SDK this is normally plain text. Worth confirming there isn't a thinking-mode or JSON-wrapped response path that inflates the string.
- **Wrong `response.length`**: maybe the value passed is `rawApiResponse` (a JSON.stringify of the full completion object on line 421) instead of `response`. That would explain the ~10× inflation (JSON includes the completion plus usage plus model metadata).

### 5. Why the per-strategy estimate side is also low
Even ignoring the actual-side bug, the `EMPIRICAL_OUTPUT_CHARS` constants were **calibrated from staging data (n=35 invocations)** on presumably cheaper/quieter runs (`estimateCosts.ts:15`). The constants:
- `grounding_enhance: 11799`
- `structural_transform: 9956`
- `lexical_simplify: 5836`

For this run the persisted variant sizes were: structural_transform 5954–6356 chars, grounding_enhance 5218–5669 chars, lexical_simplify 4192–4796 chars. So actual final-variant chars are BELOW the empirical — not above. This corroborates that the estimate side is reasonably calibrated; the discrepancy is on the actual side, not the estimate side.

### 6. Budget Floor Sensitivity hidden
- Strategy config: `minBudgetAfterParallelAgentMultiple = 1`, `minBudgetAfterSequentialAgentMultiple = 0`, `numVariants = 9`, `minBudgetAfter*Fraction` both null.
- `run_summary.budgetFloorConfig` is NULL, so `computeBudgetFloorSensitivity` returns `missing_config` and the section is hidden.
- Even if `budgetFloorConfig` were persisted, the missing `agent_cost_projected` / `agent_cost_actual` run-level metrics would cause `parallel_failed` branch.
- Root cause is the same as (2): this run finalized under a pipeline that didn't write budget-floor observables to `run_summary` nor to `evolution_metrics`.

---

## Playwright verification
- Logged in as `abecha@gmail.com`, visited `/admin/evolution/runs/bc80bfad-336d-4215-b0f1-efe8d7645054?tab=cost-estimates`.
- Confirmed banner: "No estimation data (pre-instrumentation run)".
- Confirmed Summary: Total Cost $0.02, Estimated —, Abs Error —, Error % —, Budget Cap $0.05.
- Confirmed Cost by Agent: `generate_from_seed_article` 9 invocations, Estimated $0.018, Actual $0.082, Error +329.5%, Coverage est+act.
- Confirmed Cost per Invocation: 9 GFSA rows with per-row est/actual/error (ranging +58.5% to +494.4%), plus create_seed_article, merge_ratings, swiss_ranking rows with `—` for estimates.
- Confirmed GFSA Error Distribution: all 9 invocations in the `>+25%` bucket.
- Budget Floor Sensitivity section is absent (as predicted).

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/debugging.md (for `npm run query:staging`)

### Evolution Docs
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/cost_optimization.md — primary reference for two-layer budget + estimation
- evolution/docs/metrics.md — metric registry & timing phases
- evolution/docs/arena.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/curriculum.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md — Cost Estimates tab description
- evolution/docs/minicomputer_deployment.md — long-lived runner deploy shape
- evolution/docs/reference.md
- evolution/docs/agents/overview.md
- evolution/docs/sample_content/api_design_sections.md
- evolution/docs/sample_content/filler_words.md

### Feature Deep Dives
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/metrics_analytics.md

## Code Files Read
- `evolution/src/components/evolution/tabs/CostEstimatesTab.tsx` — `hasAnyEstimateData` on line 66 drives the banner.
- `evolution/src/services/costEstimationActions.ts` — `getRunCostEstimatesAction`, reads metrics table; `computeBudgetFloorSensitivity` gating.
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — `calculateCost`, `recordSpend` call site at line 104. Primary bug surface.
- `evolution/src/lib/pipeline/infra/estimateCosts.ts` — `EMPIRICAL_OUTPUT_CHARS` constants (n=35 staging calibration).
- `evolution/src/lib/metrics/computations/finalization.ts` — `computeCostEstimationErrorPct`, `computeEstimatedCost`, `computeEstimationAbsErrorUsd` depend on `ctx.invocationDetails`.
- `evolution/src/lib/metrics/registry.ts` — confirms the metrics are registered.
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — builds `detailsMap` from invocations and passes as `invocationDetails` in `FinalizationContext`.
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — `llmProvider.complete` routes to `callLLM`.
- `src/lib/services/llms.ts` — `callLLM`/`callLLMModelRaw`; returns `completion.choices[0].message.content`.
- `src/config/modelRegistry.ts` — deepseek-chat pricing `$0.28 / $0.42 per 1M`.

## SQL Queries Run (staging, read-only)
- `evolution_runs WHERE id=…` — confirmed completed, budget $0.05, run_summary.budgetFloorConfig is null.
- `evolution_metrics WHERE entity_type='run' AND entity_id=…` — enumerated which metrics exist.
- `evolution_agent_invocations WHERE run_id=…` — pulled execution_detail for all 14 invocations.
- `evolution_variants WHERE run_id=…` — pulled persisted variant char lengths.
- `evolution_strategies WHERE id=…` — strategy config including floor multipliers.
- `llmCallTracking WHERE call_source LIKE 'evolution_%' AND created_at BETWEEN …` — aggregated real provider token counts & costs by model/phase.

---

## Open Questions / Follow-ups

1. **Why are run-level estimation metrics missing despite per-invocation data being present?** Need to confirm which git commit was actually running on the minicomputer at 2026-04-15T04:30 UTC (e.g. via `journalctl -u evolution-runner.service` or by checking the worktree's HEAD). If the runner was still on a pre-PR-#981 commit, then the `estimated_cost`/`cost_estimation_error_pct` metric definitions weren't in `RunEntity.metrics.atFinalization` at finalize time.

2. **Why does `recordSpend` charge ~8× the token-based cost?** Need a targeted trace: log `response.length` alongside `prompt.length`, `completion_tokens`, `content.length` for the next deepseek-chat call. If `response.length >> content.length`, something in the wrapper is passing a JSON-stringified payload instead of the content string. Strong candidate fix: switch `recordSpend` to use the API's `usage.completion_tokens`/`usage.prompt_tokens` instead of string lengths. `llmCallTracking.estimated_cost_usd` already does this (`calculateLLMCost(costModel, promptTokens, completionTokens, reasoningTokens)` at `llms.ts:428`).

3. **Should the "pre-instrumentation" banner also consider per-invocation data?** Current logic only checks run-level `estimated_cost`/`cost_estimation_error_pct` metrics. A run with populated per-invocation estimates is not really pre-instrumentation; the banner should reflect that more precisely (e.g. "run-level roll-up not written" vs "no estimation instrumentation at all"), or the finalize path should retroactively backfill run-level metrics when rendering the tab.

4. **Should `budgetFloorConfig` be persisted for every run that has floor multipliers set on its strategy?** It's currently null in `run_summary` here even though the strategy config defines AgentMultiple floors. Either `runIterationLoop.ts` isn't emitting `budgetFloorConfig` yet for this code path, or it only emits when certain conditions are met (e.g., only when sequential dispatch ran).

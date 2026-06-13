# Fix Structured Judging Evolution Bugs Research

<!-- Research findings for the multi-bug fix project covering missing run-detail variants, paragraph_recombine dispatch, and absent metrics/cost. -->

## Problem Statement
Multiple bugs need to be fixed.

## Requirements (from GH Issue #1202)
No variants show up under run details for runs like 339ab3cc-a690-4b33-816b-3fcaeaf8f662. Also, despite strategy asking for paragraph recombine, none ever ran. Instead a large number of generateFromPreviousArticle agents ran. There are no metrics or cost estimates. Look also at runs bdb1f65a-a779-4340-9340-31c44ba81566 and 3e94c04f-b7c6-4c4d-a5c5-3060fae1cf7e on stage.

### Symptoms to investigate (broken out)
1. **No variants under Run Details** — run `339ab3cc-a690-4b33-816b-3fcaeaf8f662` (+ `bdb1f65a-a779-4340-9340-31c44ba81566`, `3e94c04f-b7c6-4c4d-a5c5-3060fae1cf7e` on staging) show no variants on the run detail Variants tab.
2. **paragraph_recombine never dispatched** — strategy requested `paragraph_recombine` but a large number of `generateFromPreviousArticle` agents ran instead.
3. **No metrics / no cost estimates** — run-level metrics and cost-estimate tabs are empty for these runs.

## High Level Summary

**Root trigger (operational): OpenRouter ran out of credits.** All three runs share strategy `2fd6d9a0` "Paragraph rewrite with test rubric" (generationModel + judgeModel = `google/gemini-2.5-flash-lite`, budget $0.05). Every one of the 100 generation LLM calls per run failed with HTTP **402**: `"This request requires more credits, or fewer max_tokens. You requested up to 65535 tokens, but can only afford 63282..."`. No tokens were ever billed.

That billing failure cascaded through **five genuine code defects** that turned a quota problem into silent, runaway behavior — these defects are the actual fixable scope. Confirmed ground truth (all 3 runs identical): status `completed`, 100 `generate_from_previous_article` + 1 `merge_ratings` (iteration 1 only), **0** `paragraph_recombine` invocations, **0** `evolution_variants` rows, only 4 zero-valued cost metrics, no `at_finalization` metrics, `run_summary.stopReason = 'arena_only'`.

### Confirmed causal chain (Round 1 — file:line + DB evidence, 5/5 agents converged)
1. **402 is non-transient** → `classifyErrors.ts:34` matches only 429/408/5xx → thrown immediately, no retry; `createEvolutionLLMClient.ts:258-279` calls `release()` not `recordSpend()` → **cost stays 0**.
2. **Failure recorded as success.** `Agent.run()` (`Agent.ts:191,203`) sets `success = !detailInvalid` — keyed on execution_detail *schema validity*, NOT generation success. So 100 hard-failed gens persist as `success=true, cost_usd=0, error_message=null`, real error buried in `execution_detail.generation.error`. (`generateFromPreviousArticle.ts:221-232` returns `variant:null, status:'generation_failed'`.) **[Defect D1]**
3. **Runaway dispatch to the 100 cap.** cost=0 → top-up loop (`runIterationLoop.ts:724-758`) decrements `remaining` only by *realized* cost (stays 0) → loop exits only at `DISPATCH_SAFETY_CAP=100` (`:726`, `topUpStopReason='safety_cap'`). The "large number of generateFromPreviousArticle agents." **[Defect D2]**
4. **Empty pool.** All 100 return `variant:null` → `absorbResult` (`runIterationLoop.ts:638-668`) pushes to *neither* `surfacedVariants` nor `discardedVariants` → pool = only the 999 pre-loaded arena entries.
5. **paragraph_recombine never dispatched (pure downstream effect).** iter1 `inRunPool = pool.filter(!fromArena) = []` (`runIterationLoop.ts:1291`) → `resolvedParents=[]` → `parallelDispatchCount = min(cap, maxAffordable, 4, 0) = 0` (`:1351-1356`). **No routing bug, no kill switch** — fixing iter0 fixes this for free (multi-dispatch maxDispatches=4 wiring verified consistent with single-dispatch).
6. **arena_only early-return hides everything.** finalize `localPool = result.pool.filter(!fromArena) = []` but `result.pool.length>0` → arena-only branch (`persistRunResults.ts:179-205`) marks run `completed` + `stopReason='arena_only'` and **returns before** the `evolution_variants` upsert (Step 4, `:259-337`) and `at_finalization` metrics loop (Step 5, `:347-484`). → 0 variants, no winner_elo/variant_count/total_matches. **[Defect D3]**
7. **Rubric judging NOT implicated.** Rubric `f3c1af7a` ("Test rubric") active, 4 dims (weight 25 each = 100); `getJudgeRubricForEvaluation` resolves cleanly; no fallback WARN. Generation doesn't call the judge.

### Defects identified (fixable scope)
- **D1** — generation hard-failure recorded `success=true`/`error_message=null` (failure masked). `Agent.ts:191`, `generateFromPreviousArticle.ts:224`.
- **D2** — top-up dispatch runs to the 100-agent safety cap on a stream of zero-cost failures. `runIterationLoop.ts:724-758`.
- **D3** — run with 100%-failed generations marked `completed`/`arena_only` instead of `failed`. `persistRunResults.ts:180-195`.
- **D4 (latent)** — `google/gemini-2.5-flash-lite` absent from `src/config/llmPricing.ts` → $10/$30 default. `llmPricing.ts:78,84-93`.
- **D5 (lever)** — generation requested up to **65535 max_tokens**; "or fewer max_tokens" would clear the 402. Where max_tokens is set → Round 2.

> The three reported symptoms = **one operational trigger + an empty-pool cascade**, made silent/runaway by D1–D3. Operational fix: restore OpenRouter credits. Engineering fixes: D1–D3 (+ D4/D5) so this fails loudly and cheaply.

### (Superseded) initial hypotheses
- **H1 (variants hidden, not missing):** The run-detail Variants tab defaults to `variant_kind='article'` (`getEvolutionVariantsAction` default arg, `hide_paragraphs_from_run_variants_tab_evolution_20260603`). If the run only produced `variant_kind='paragraph'` slot rewrites, the default filter hides them all → "no variants." Check the Kind dropdown / DB `variant_kind` distribution per run.
- **H2 (dispatch routing):** `paragraph_recombine` requires a dedicated top-level branch in `runIterationLoop.ts` (added by `make_fixes_paragraph_recombine_20260528`). Per `paragraph_recombine.md`, before that fix a `paragraph_recombine` iteration was a silent no-op. If these runs used a strategy whose `agentType` fell through to the generate-family `dispatchOneAgent`, GFPA would run instead — matching "many generateFromPreviousArticle ran." Possible regression, stale runner code (minicomputer not at origin/main), or a config that didn't actually set `agentType='paragraph_recombine'`.
- **H3 (metrics/cost absence):** Run-cost rows are written via the live `writeMetricMax` path in `createEvolutionLLMClient` (needs `db`+`runId`). The `2026-02-23 → ongoing` audit-gap window (`cost_optimization.md`) shows zero evolution `call_source` rows on staging — per-call cost persistence may not be firing. Also if the run failed before finalization, `at_finalization` metrics (elo, variant_count) never write. Cross-check `evolution_metrics` rows for these run_ids.
- **H4 (structured/rubric judging interaction):** Branch context is `structured_judging_evolution_20260610` (rubric-based pairwise judging just shipped). Need to verify rubric resolution / `EVOLUTION_RUBRIC_JUDGING_ENABLED` and `StrategyConfig.judgeRubricId` did not interfere with dispatch or finalization for these runs.

### Diagnostic queries to run (staging, read-only)
```sql
-- Run rows + status + strategy config
SELECT id, status, strategy_id, error_message, created_at, completed_at
FROM evolution_runs WHERE id IN (
 '339ab3cc-a690-4b33-816b-3fcaeaf8f662',
 'bdb1f65a-a779-4340-9340-31c44ba81566',
 '3e94c04f-b7c6-4c4d-a5c5-3060fae1cf7e');

-- Strategy iterationConfigs to confirm agentType requested
SELECT s.id, s.config->'iterationConfigs'
FROM evolution_strategies s
JOIN evolution_runs r ON r.strategy_id = s.id
WHERE r.id IN ('339ab3cc-...','bdb1f65a-...','3e94c04f-...');

-- Variant kinds present per run
SELECT run_id, variant_kind, persisted, count(*)
FROM evolution_variants WHERE run_id IN ('339ab3cc-...','bdb1f65a-...','3e94c04f-...')
GROUP BY run_id, variant_kind, persisted;

-- Invocation agent_name breakdown (paragraph_recombine vs generate_from_previous_article)
SELECT run_id, agent_name, count(*) FROM evolution_agent_invocations
WHERE run_id IN ('339ab3cc-...','bdb1f65a-...','3e94c04f-...') GROUP BY run_id, agent_name;

-- Metrics rows present
SELECT entity_id, metric_name, value FROM evolution_metrics
WHERE entity_type='run' AND entity_id IN ('339ab3cc-...','bdb1f65a-...','3e94c04f-...');
```
> NOTE: Run UUIDs above must be copied verbatim from the requirements; the `bdb1f65a` value is reproduced from the issue — re-verify the exact string before querying.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (evolution — all 21 read per user request)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/paragraph_recombine.md
- evolution/docs/multi_iteration_strategies.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/metrics.md
- evolution/docs/evolution_metrics.md
- evolution/docs/visualization.md
- evolution/docs/cost_optimization.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/variant_lineage.md
- evolution/docs/arena.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/reference.md
- evolution/docs/criteria_agents.md
- evolution/docs/editing_agents.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/prompt_editor.md

## Code Files Read (across 4 research rounds / 20 agents)
- `evolution/src/lib/core/Agent.ts` (run() success/error_message — D1, ~180-203)
- `evolution/src/lib/core/types.ts` (AgentOutput — D1 `failure` field site, ~192)
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` (3 hard-fail returns 208/221/243; success path 338)
- `evolution/src/lib/core/agents/createSeedArticle.ts` (title/article LLM-error returns 125/140; format-invalid is non-fatal 159)
- `evolution/src/lib/core/agents/{evaluateCriteriaThenGenerateFromPreviousArticle,singlePassEvaluateCriteriaAndGenerate,reflectAndGenerateFromPreviousArticle}.ts` (wrapper reconstruct sites — D1 forwarding)
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` (non-thrown returns 329/338 — D1 broader scope)
- `evolution/src/lib/core/agents/SwissRankingAgent.ts` (status:'failure' non-thrown — D1 broader scope)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (top-up loop 717-758 — D2; parallel accounting 670-676; paragraph_recombine branch 1270-1356)
- `evolution/src/lib/pipeline/loop/rankNewVariant.ts` (discard rule 104-106; ranking-error→TIE swallow 325-343 — separate un-fixed path)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (arena-only branch 179-205 — D3; variant upsert 259-337; finalization metrics 347-484)
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` (rawProvider complete() options 194-222 — D5 chokepoint; markRunFailed race 73-96)
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` (cost reserve/release 258-279; OUTPUT_TOKEN_ESTIMATES; completeStructured dead)
- `evolution/src/lib/shared/classifyErrors.ts` (402 not transient — line 34)
- `evolution/src/lib/shared/computeRatings.ts` (run2PassReversal — judge does NOT catch; caller handles)
- `src/lib/services/llms.ts` (requestOptions 461-468 no max_tokens; Anthropic 8192 at 790/807 — D5)
- `src/config/{modelRegistry.ts,llmPricing.ts}` (gemini-2.5-flash-lite present at $0.10/$0.40 — D4 already mitigated; LOCAL_* $0 pricing)
- `evolution/src/lib/schemas.ts` (iterationConfig Zod: first must be variant-producing)
- Tests: `Agent.test.ts`, `generateFromPreviousArticle.test.ts` (`:167` encodes the bug), `createSeedArticle.test.ts`, `persistRunResults.test.ts` (`:747` #11), `runIterationLoop-topup.integration.test.ts`, `llms.test.ts`

## Implementation-ready fix designs (Rounds 2-4, adversarially verified)

All defects are **latent, pre-existing** (D1 from 2026-04-23 PR#1008; D2 from 2026-04-21 PR#1003; D3 from 2026-03-16 PR#716) — **none is a regression from the structured_judging branch**. Exact diffs live in the planning doc's phases; key decisions:

- **D5 (primary, lowest-risk):** scope the `max_tokens` cap to **evolution only** via a new `CallLLMOptions.maxOutputTokens`, set `EVOLUTION_MAX_OUTPUT_TOKENS=4096` at the single chokepoint `claimAndExecuteRun.ts` `complete()`. A blanket cap in `llms.ts` would risk truncating main-app `returnExplanation` article generation (LONG tier >1500 words) and is REJECTED. 4096 clears the 402 (16× under 65535) with margin over the 2300-token worst case. ⚠ Open: size headroom for reasoning models (cap counts reasoning+completion).
- **D1:** add optional `failure?:{code,message}` to `AgentOutput`; `Agent.run()` flips `success=false` + sets `error_message` when present (execution_detail still gated on schema validity only). Set on hard-fail RETURNS in GFPA (unknown-tactic/LLM-error-non-budget/format-invalid) + seed (title/article LLM errors only — seed format-invalid is non-fatal) + **forward through the 3 criteria/reflect wrappers**. Legit ranked-discards (variant≠null) and `'budget'` aborts stay `success=true`. Only test that flips: `generateFromPreviousArticle.test.ts:167`.
- **D2:** circuit-breaker in the top-up loop keyed on **`result===null || result.status==='generation_failed'`** (NOT cost, NOT the success flag) → independent of D1, terminates after `MAX_CONSECUTIVE_GEN_FAILURES=3`; plus a parallel-batch guard; plus fix `parallelSuccesses` to count by variant not `cost>0`. Keying on cost would **false-fire on $0 local/budget-skip runs** (proven by 4 real `[TEST_EVO]` runs). The TEST_EVO $0 runs carry `status:'budget'` (not `generation_failed`), so the status-keyed breaker correctly ignores them.
- **D3:** in `finalizeRun`, when localPool empty AND **non-arena `discardedVariants` count == 0** (all generations errored, not discarded) → mark run `failed` `error_code='all_generations_failed'` (mirror the empty-pool branch: `runner_id:null` + `.in('status',['claimed','running'])`); else preserve genuine `arena_only` completed. Race-safe via concrete error_code. Existing tests #11/H5 must add a discarded variant to keep exercising the legit path.
- **D4:** already mitigated (model in registry) → ship only a **regression-guard test** that `getModelPricing('google/gemini-2.5-flash-lite')` ≠ $10/$30 default.

## Blast radius & recurrence
- **Silently-affected runs = exactly 3** (the named 2026-06-11 runs), confirmed two ways. **Same 3-run signature on 2026-05-02** (`90441b07`,`97a6cf50`,`ba2ccfc1`) and **possibly 3 more on 2026-04-21/22** (`1dac2a62`,`d3a461d4`,`4a29d218`, smaller budgets) → the mode has fired ≥2, likely ≥3 times with **no detector**.
- **Zero pending/claimed runs** queued — nothing is about to re-fail right now.
- **26 active strategies** use OpenRouter-routed (`google/*`,`qwen/*`) models carrying the same no-max_tokens 402 risk; fleet is dominated by OpenAI gpt-4.1-mini (not at risk).
- **No evolution run-failure alerting exists** (`release-health` is E2E-only). Recommend a scheduled detector (GH Actions + `evolution/scripts/` + existing `SLACK_WEBHOOK_URL`): `completed` run with `generate` invocations>0 AND 0 variants AND cost=0 (legit arena-only has 0 generate invocations, so it won't match); post-D3 simplify to `status='failed' AND error_code='all_generations_failed'`.

## Operational stop-the-bleeding (no-deploy levers)
1. **Top up OpenRouter credits** (the trigger) — verify balance via OpenRouter `GET /api/v1/credits`.
2. **`EVOLUTION_TOPUP_ENABLED=false`** neutralizes the D2 100-agent runaway without a deploy. (`EVOLUTION_MAX_CONCURRENT_RUNS=0` does NOT pause — falls back to 5.)
3. Edit strategy `2fd6d9a0` `generationModel`/`judgeModel` off `google/gemini-2.5-flash-lite` (DB-only) or raise its $0.05 budget.

## Open Questions / residual risks
1. **D1 scope breadth** — `ParagraphRecombineAgent` and `SwissRankingAgent` also return non-thrown failures recorded as `success=true`. Does the D1 fix cover all return sites, or is a follow-up audit of editing/criteria/debate agents needed? (Decide scope: minimal GFPA+seed+wrappers vs all agents.)
2. **402-during-RANKING is a SEPARATE un-fixed silent path** — `rankSingleVariant.ts:336` (the non-budget LLM-error catch → confidence-0 TIE) swallows non-budget LLM errors (incl. 402) as confidence-0 TIEs and continues; a run finishes "ranked" with degenerate ties and no failure surfaced. **Rubric judging (structured_judging) doubles judge call volume → doubles this exposure.** Is this in scope for this project or a follow-up? (D5's max_tokens cap reduces the trigger but doesn't fix the swallow.)
3. **D5 cap sizing for reasoning/structured models** — `max_tokens` counts reasoning+completion together; 4096 may truncate a reasoning trace or a structured JSON response mid-object on thinking models. Verify against `OUTPUT_TOKEN_ESTIMATES` + reasoning headroom; consider exempting/​enlarging for reasoning models.
4. **Possible ≥3 occurrences** — back-test the detector against the 2026-04-21/22 arena_only runs; confirm whether those were 402 wipeouts too.
5. **Production exposure** — all verification was on **staging**. Confirm prod runs the same OpenRouter strategies and run the detector query against prod before assuming staging-only.
6. **Run UUID correction** — the issue text's `bdb1f65a-a779-4340-...` is a transcription error; the real staging run is `bdb1f65a-a779-4784-9340-31c44ba81566` (and `3e94c04f-b7c6-...`, not `-c5b5-`). All three runs verified `completed`/`arena_only`/0-variants/0-cost under strategy `2fd6d9a0`.

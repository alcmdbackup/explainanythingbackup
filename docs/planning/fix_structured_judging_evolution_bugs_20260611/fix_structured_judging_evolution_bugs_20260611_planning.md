# Fix Structured Judging Evolution Bugs Plan

<!-- Implementation plan for the multi-bug evolution fix (missing variants, paragraph_recombine dispatch, absent metrics/cost). Root-caused + adversarially verified across 4 research rounds (20 agents). -->

## Background
Multiple bugs need to be fixed.

## Requirements (from GH Issue #1202)
No variants show up under run details for runs like 339ab3cc-a690-4b33-816b-3fcaeaf8f662. Also, despite strategy asking for paragraph recombine, none ever ran. Instead a large number of generateFromPreviousArticle agents ran. There are no metrics or cost estimates. Look also at runs bdb1f65a-a779-4340-9340-31c44ba81566 and 3e94c04f-c5b5-4c4d-a5c5-3060fae1cf7e on stage.

> **Run-ID correction (verified against staging):** the issue's `bdb1f65a-a779-**4340**-…` and `3e94c04f-**c5b5**-…` are transcription typos. The real runs are `bdb1f65a-a779-**4784**-9340-31c44ba81566` and `3e94c04f-**b7c6**-4c4d-a5c5-3060fae1cf7e`. All three runs are `completed`/`arena_only`/0-variants/0-cost under strategy `2fd6d9a0` "Paragraph rewrite with test rubric".

## Problem
All three reported symptoms are **one operational trigger + an empty-pool cascade**, made silent and runaway by latent code defects (see `_research.md` for the full file:line evidence). Root trigger: **OpenRouter ran out of credits** — every generation LLM call (model `google/gemini-2.5-flash-lite`) failed with HTTP 402 (`"requires more credits, or fewer max_tokens. You requested up to 65535…"`). Cascade: 402 recorded as `success`/$0 → budget never constrains → 100-agent runaway → empty pool → `paragraph_recombine` (pool mode) has no parents → 0 dispatch → finalize takes the `arena_only` early-return → 0 variants, no metrics, run marked `completed`. Rubric judging is **not** implicated. The fixable scope is 5 defects (D1–D5); the structured_judging branch did not cause any of them.

## Options Considered
- [x] **Option A: Per-symptom independent fixes** — rejected: the symptoms share one cascade; fixing them in isolation would miss the trigger (D5) and the silent-masking (D1/D3).
- [x] **Option B: Single-root-cause fix (D5 only)** — partial: capping `max_tokens` (D5) stops *this* 402, but under genuinely zero credits even a small request 402s, and D1/D2/D3 are still needed so the failure is loud + cheap + detected.
- [x] **Option C (CHOSEN): Operational fix + D5 primary + D1/D2/D3 defense-in-depth + detector** — restore credits now; ship the evolution-scoped `max_tokens` cap (D5) as the primary engineering fix; add D1 (loud), D2 (cheap), D3 (visible failure) as defense-in-depth; add a recurrence detector. D4 is a regression-guard test only (already mitigated).

## Ranked fixes (impact-on-this-bug × risk)
| # | Defect | Fix | Risk | Site |
|---|--------|-----|------|------|
| 1 | **D5** | Evolution-scoped `max_tokens` cap (4096) for **non-reasoning** models + `finish_reason==='length'` truncation guard + env kill-switch | Low (scoped; main app untouched; reasoning models exempted) | `src/lib/services/llms.ts`, `evolution/.../claimAndExecuteRun.ts` |
| 2 | **D1** | `failure?` field on `AgentOutput`; `Agent.run()` → `success=false`+`error_message`; set on GFPA/seed hard-fails + forward through wrappers | Medium (flips ~100 invocations to failed; verified no metric/cost breakage) | `Agent.ts`, `types.ts`, GFPA, seed, 3 wrappers |
| 3 | **D3** | finalize: all-errored (non-arena `discardedVariants`==0) → `failed`/`all_generations_failed`, else keep `arena_only` | Medium (distinguish errored vs discarded) | `persistRunResults.ts` |
| 4 | **D2** | top-up breaker keyed on `result.status==='generation_failed'` (not cost) + parallel guard; counts variants not `cost>0` | Medium (must not false-fire on $0 local/budget runs) | `runIterationLoop.ts` |
| 5 | **D4** | regression-guard test only (model already in registry) | Trivial | `llmPricing.test.ts` |

## Phased Execution Plan

### Phase 0: Operational stop-the-bleeding (no deploy) — do first
- [ ] Top up OpenRouter credits for the runner's `OPENROUTER_API_KEY` (verify via OpenRouter `GET /api/v1/credits`).
- [ ] (Optional) set `EVOLUTION_TOPUP_ENABLED=false` on the runner to neutralize the D2 runaway until the PR lands.
- [ ] (Optional) point strategy `2fd6d9a0` off `google/gemini-2.5-flash-lite` or raise its $0.05 budget (DB-only).

### Phase 1: D5 — evolution-scoped max_tokens cap (primary)

> **RESOLVED — reasoning-model truncation (was Open Question #3, a review blocker).** On OpenAI o-series / OpenRouter "thinking" models, `max_tokens` caps **reasoning + completion combined**, and reasoning-capable models (`gpt-oss-20b`, `o3-mini`) are in **active use as both generation and judge** on staging. A flat 4096 could be exhausted by the reasoning trace, returning a truncated/empty completion — and a truncated structured-judge JSON currently fails parse and is **swallowed as a confidence-0 TIE** (`rankSingleVariant.ts:336`), trading a loud 402 for a silent-degradation bug. Decision: **(a) apply the cap only to non-reasoning models** (`getModel(model).supportsReasoning === false`); reasoning models are exempted (no cap) so their traces are never truncated. **(b) Add a `finish_reason === 'length'` guard** in `callOpenAIModel` that throws (so D1 records it `success=false` and it can't be silently swallowed). This makes any future truncation loud regardless of model. **Coverage clarification:** the throw-guard makes *generation-path* truncation loud (the agent's catch → D1 `success=false`); the *ranking/judge-path* truncation is protected by the reasoning-model **exemption** (judge models like gpt-oss-20b/o3-mini are uncapped, so never truncated) — NOT by the throw guard, because `rankSingleVariant.ts:336`'s catch would re-swallow a thrown truncation as a confidence-0 TIE. The standalone judge-swallow hardening stays Open Question #2 (follow-up).

- [x] `src/lib/services/llms.ts`: add `maxOutputTokens?: number` to `CallLLMOptions` (~110). In `callOpenAIModel`, after the temperature block (~470), set `requestOptions.max_tokens = options.maxOutputTokens` ONLY when provided AND the resolved model is non-reasoning (`!modelSupportsReasoning(validatedModel)` (reuse the helper already imported in llms.ts ~line 20/493; do NOT use a non-existent `getModel(...).supportsReasoning`)) — reasoning models stay uncapped. Anthropic branch (hardcoded 8192) untouched.
- [x] `src/lib/services/llms.ts`: add a truncation guard in `callOpenAIModel` — `finishReason` is already captured (~582) but only emitted as a span attribute; when `finish_reason === 'length'`, throw a descriptive error so the call fails loudly (caught by the evolution agent → D1 `success=false`) instead of returning silently-partial text. Verify the streaming + non-streaming branches both surface it.
- [x] `evolution/src/lib/pipeline/claimAndExecuteRun.ts`: add `const EVOLUTION_MAX_OUTPUT_TOKENS = Number(process.env.EVOLUTION_MAX_OUTPUT_TOKENS) || 4096;` (env kill-switch — set to a large value or unset-to-default to neutralize a truncation regression without a redeploy). Set `maxOutputTokens: EVOLUTION_MAX_OUTPUT_TOKENS` **unconditionally inside the rawProvider `complete()`** options object (~204-222) — NOT as an agent-supplied opt. NOTE: `createEvolutionLLMClient.ts:197` and the `complete()` signature reconstruct opts as `{model, temperature, reasoningEffort, invocationId}` and would **drop any field not explicitly threaded**, so the cap must be hardcoded at this single chokepoint, which covers generation/ranking/seed/judge (structured rubric judging routes through the same `complete()`; `completeStructured` is dead).
- [x] **Carve-out (state explicitly, out of scope):** the two offline/admin evolution LLM paths that bypass this chokepoint — `evolution/src/lib/promptEditor/runPromptEditorConfig.ts:78` and `evolution/src/lib/judgeEval/runJudgeEval.ts` — build their own `CallLLMOptions` and remain **uncapped**. They carry the same no-max_tokens 402 risk on OpenRouter models but are not the incident path; capping them is a follow-up (one-line `maxOutputTokens` each).
- [x] 4096 justification: largest evolution non-reasoning output estimate is `evaluate_and_suggest` ≈ 2300 tokens → 4096 gives ~1.8× margin and clears the 402 at ~16× under the 65535 default.

### Phase 2: D1 — record generation hard-failures as failed
- [x] `evolution/src/lib/core/types.ts`: add `failure?: { code: string; message: string }` to `AgentOutput`.
- [x] `evolution/src/lib/core/Agent.ts` (~180-203): `isFailure = detailInvalid || output.failure !== undefined` → drives `success` + return; `error_message` from `output.failure` when present; keep `execution_detail` gated on schema validity only.
- [x] `generateFromPreviousArticle.ts`: set `failure` on unknown-tactic (208), LLM-error-non-budget (221, exclude `'budget'`), format-invalid (243). Success/ranked-discard paths unchanged.
- [x] `createSeedArticle.ts`: set `failure` on title (125) + article (140) LLM errors only — format-invalid stays non-fatal.
- [x] Forward `failure: gfpaOutput.failure` in the 3 wrappers (`evaluateCriteriaThenGenerateFromPreviousArticle.ts` ~607, `singlePassEvaluateCriteriaAndGenerate.ts` ~376, `reflectAndGenerateFromPreviousArticle.ts` ~466).
- [x] **Optional completeness (not a correctness blocker):** `ParagraphRecombineAgent` / `SwissRankingAgent` also return typed non-thrown failures, but their dedicated dispatch branches already inspect `status` explicitly (`runIterationLoop.ts:1209,1243`), so they are NOT masked the way GFPA was. The shared `failure?` field is available to them for free — set it for consistency, but partial coverage is not an architectural inconsistency. Recommend: include them (low cost), but it can ship without.

### Phase 3: D3 — fail runs where all generations errored
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (~179-205): when `localPool` empty, compute the non-arena discarded count from `result.discardedVariants ?? []` (NOTE: `discardedVariants` are agent-generated and never carry `fromArena=true`, so the `.filter(v=>!v.fromArena)` is harmless-but-redundant — a plain `.length` is fine). If 0 → all generations errored → `status='failed'`, `error_code='all_generations_failed'`, `error_message`, `runner_id:null`, `.in('status',['claimed','running'])`. Else preserve the existing `arena_only` completed path. The new `error_code` is written directly on the `evolution_runs` row (not in `run_summary`), so **no DB enum/migration is needed**; race-safe because `markRunFailed` no-ops once `error_code` is non-null.
- [x] (Optional belt-and-suspenders) add `'all_generations_failed'` to the `EvolutionResult.stopReason` union (infra/types.ts) + set it in `runIterationLoop` when no non-arena variant survives. CONFIRMED SAFE to defer: `run_summary.stopReason` is `z.string().max(200)` (free-form, already carries `'arena_only'`), so no schema ripple — this is purely an in-memory typing nicety.

### Phase 4: D2 — stop the top-up runaway

> **D2 is D1-independent defense-in-depth, not the load-bearing fix.** The top-up loop (`runIterationLoop.ts:743-757`) ALREADY breaks with `top_up_dispatch_failed` on the first `!success` dispatch — so once D1 lands (failed gens → `success=false`), the existing branch already terminates the runaway. D2 keys on `result.status` instead so it works **even without D1** (today's 402 returns carry `success=true`), and it changes break-on-**first**-failure to break-on-**third** (a small tolerance so one transient failure mid-healthy-run doesn't abort). Worth shipping as belt-and-suspenders; not co-equal with D1/D5 in necessity.

- [x] `runIterationLoop.ts`: add `const MAX_CONSECUTIVE_GEN_FAILURES = 3;`. In the top-up loop (~717-758), read the settled result's status via the **exact accessor** `r.value.result?.status` (the status lives on the inner `GenerateFromPreviousOutput`, NOT `r.value.status`). This status check is a **NEW pre-condition evaluated on every dispatch — including when `r.value.success === true`** (today's 402 returns are `success:true`), NOT a modification of the existing `else`/failure branch (which would make it dead code). Track consecutive dispatches where `r.value.result == null || r.value.result.status === 'generation_failed'`; reset on any real variant; bail with `topUpStopReason='top_up_dispatch_failed'` + a warn log after `MAX_CONSECUTIVE_GEN_FAILURES`. (`'budget'` status does NOT count — it terminates via the existing budget exit, which is why the TEST_EVO $0 budget-skip runs are safe.)
- [x] `runIterationLoop.ts` (~672): fix `parallelSuccesses` to count REAL variants (`r.value.success && r.value.result?.variant != null && r.value.result.status !== 'generation_failed'`), keeping a SEPARATE `cost>0` accumulator for `parallelSpend` (so `actualAvgCost` math is unaffected). Add a parallel-batch guard: `parallelDispatchCount>1 && parallelSuccesses===0` → set `topUpStopReason` to skip top-up entirely (don't let the kill/deadline checks at ~709-715 clobber an already-set reason). This is what prevents a cost-based count from false-firing on $0 local successes.
- [x] Confirm scope: the top-up loop only dispatches GFPA-family agents. The `paragraph_recombine` branch is separate (`~1270`) and its own top-up (`~1459-1463`) is **naturally bounded** by `topUpIndex < resolvedParents.length` (finite parent set), so it cannot run away and needs no breaker — note this in a code comment.

### Phase 5: D4 + detector + docs
- [x] `src/config/llmPricing.test.ts`: regression-guard test that `getModelPricing('google/gemini-2.5-flash-lite')` resolves to registry pricing ($0.10/$0.40), not the $10/$30 default.
- [x] Recurrence detector: `evolution/scripts/detectArenaOnlyWipeouts.ts` (readonly query: `completed` run with `generate` invocations>0 AND 0 variants AND cost=0, scoped to a recent window) + a colocated `.test.ts` (matches the evolution/scripts convention). `.github/workflows/evolution-run-health.yml` modeled on `e2e-nightly.yml`: `schedule:` cron (daily, after the runner's active window), runs the script against **both staging AND prod** (Open Question #5 — confirm prod exposure), posts to `SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}` (repo-wide secret, already used by e2e-nightly/post-deploy-smoke), with a `created_at > now() - interval` window filter so it never re-alerts historical runs. Post-D3, augment the query to `status='failed' AND error_code='all_generations_failed'`. Validate by back-testing the date windows of the 2026-05-02 (`90441b07`/`97a6cf50`/`ba2ccfc1`) and 2026-06-11 incidents (the script should flag them).
- [x] Doc updates (see Documentation Updates section).

## Testing

### Unit Tests
- [x] `evolution/src/lib/core/Agent.test.ts` — new D1 cases: schema-valid detail + `output.failure` → invocation `success=false` + `error_message`; `execution_detail` still persisted; `status:'budget'` stays `success=true`.
- [x] `evolution/src/lib/core/agents/generateFromPreviousArticle.test.ts` — flip `:167` (format-invalid) to `success=false`; add `success=false` to unknown-tactic; add "402/non-budget LLM error → `status='generation_failed'`" case; budget test unchanged.
- [x] `evolution/src/lib/core/agents/createSeedArticle.test.ts` — seed title/article LLM error → `success=false`; format-invalid stays non-fatal.
- [x] Wrapper tests (`reflectAndGenerate…`, `evaluateCriteriaThen…`, AND `singlePassEvaluateCriteriaAndGenerate…`) — inner GFPA `failure` propagates so the wrapper invocation is `success=false`. (All three wrappers were edited in Phase 2, so all three need a propagation test.)
- [x] `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — NEW: all-errored empty pool (no non-arena discarded) → `failed`/`all_generations_failed`; NEW: all-discarded → `arena_only` completed; UPDATE existing #11 (`:747`) + H5 (`:759`) to include a non-arena discarded variant so they keep exercising the legit path.
- [x] `src/lib/services/llms.test.ts` — `max_tokens=4096` present when `maxOutputTokens` passed for a **non-reasoning** model; **absent for a reasoning model** (`supportsReasoning===true`, e.g. gpt-oss-20b/o3-mini) even when the option is passed (the exemption); absent for plain main-app callers; OpenRouter-Gemini (non-reasoning) case asserts the cap. Extend the existing reasoning-token (~445) + json_schema (~227) fixtures. Add a `finish_reason==='length'` case asserting `callOpenAIModel` THROWS (truncation guard).
- [x] `src/config/llmPricing.test.ts` — D4 regression guard.
- [x] `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — assert the evolution `complete()` options include `maxOutputTokens: 4096`.

### Integration Tests
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop-topup.integration.test.ts` — D2: stream of `{success:true, cost:0, result:{status:'generation_failed', variant:null}}` → loop stops well before 100. **Observability note:** `topUpStopReason` is loop-local (NOT on `EvolutionResult`), so assert the BAIL via `mockGenerateRun.mock.calls.length` (≤ parallel batch + `MAX_CONSECUTIVE_GEN_FAILURES`); to additionally assert the *reason* (`top_up_dispatch_failed` vs `safety_cap`), pass a spy logger via `options.logger` and assert the warn payload. REGRESSION GUARD: stream of `{success:true, cost:0, result:{status:'budget'}}` (the TEST_EVO shape) terminates via the budget exit and does NOT trip the breaker; plus a consecutive-reset case (fail×2 then succeed → counter resets, loop continues). **CI/local note:** this file is matched by the DEFAULT jest config (`*.integration.test.ts` outside `src/__tests__/integration/`), NOT by `test:integration:evolution` — run it locally via `npm test -- --testPathPatterns="runIterationLoop-topup"`; it executes in the `unit-tests` CI job, not `integration-evolution`.
- [x] persistRunResults integration: all-errored path does NOT reach variant upsert / finalization metrics; legit arena-only still writes full run_summary.

### E2E Tests
- [x] (Optional) `09-admin/admin-evolution-runs` — a `failed`/`all_generations_failed` run renders an error state on the run detail (not a blank "completed" with no variants). Only if a UI affordance is added for the new error_code.

### Manual Verification
- [ ] After Phase 1, re-run strategy `2fd6d9a0` on staging (with credits restored) and confirm: paragraph_recombine dispatches (non-empty pool), variants render, metrics + cost populate.
- [x] Verify a deliberately-credit-starved run now fails loudly (`failed`/`all_generations_failed`) and stops near the parallel batch size, not at 100.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] If the new `error_code` surfaces in the UI: manual check of `/admin/evolution/runs/[runId]` Variants/Metrics/Cost Estimates tabs on a failed run via ensure-server.sh. (Otherwise N/A — fixes are backend.)

### B) Automated Tests
- [x] Unit + the D2 top-up test (the latter is default-jest, NOT `test:integration:evolution`): `npm test -- --testPathPatterns="Agent|generateFromPreviousArticle|createSeedArticle|persistRunResults|llms|llmPricing|runIterationLoop-topup"`
- [x] `npm run test:integration:evolution` (CI job `integration-evolution` runs the `evolution-*` integration suite on evolution PRs; the top-up test runs in the `unit-tests` job).
- [x] Full `/finalize` check trio before PR (lint + tsc + build + unit + ESM + integration + E2E critical).

## Documentation Updates
The following docs need updates after the fixes land (scoped down per research — paragraph_recombine/multi_iteration_strategies/variant_lineage/rating_and_comparison are NOT changing, as those behaviors were downstream effects / not implicated):
- [x] `evolution/docs/cost_optimization.md` — add the 2026-05-02/06-11 OpenRouter-402 wipeout to "Historical cost-data caveats"; NEW "402 / no-max_tokens failure mode" subsection + the evolution `maxOutputTokens` cap.
- [x] `evolution/docs/architecture.md` — `Agent.run()` success semantics (D1); new `all_generations_failed` finalize outcome (D3); top-up termination (D2).
- [x] `evolution/docs/reference.md` — `CallLLMOptions.maxOutputTokens` lever; `all_generations_failed` error_code; 402-is-non-transient note in the retry-policy section.
- [x] `docs/docs_overall/debugging.md` — NEW "402 / arena_only silent failure" triage entry with the diagnostic queries (the `success_invocations > gen_invocations` + 0-variants + 0-cost fingerprint).
- [x] `evolution/docs/minicomputer_deployment.md` — "OpenRouter credit exhaustion" ops note + the run-health detector/runbook.
- [x] (`evolution/docs/metrics.md` — only if a new metric is added; the detector is a standalone query, so likely no edit.)

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

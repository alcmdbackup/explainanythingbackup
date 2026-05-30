# Investigate Paragraph Rewrite Cost Undershoot Evolution Plan

## Background
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage. Then fix the underlying cost-estimate accuracy gaps and bring the budget-floor-governed multi-dispatch pattern (already used by `generate` iterations) over to `paragraph_recombine` — surfaced through the wizard preview.

## Requirements (from GH Issue #1138)
Investigate why paragraph rewrite invocations are undershooting their budget by so much by querying Supabase stage.

## Problem
Paragraph rewrite (`paragraph_recombine`) invocations on staging spend `$0.005` median against a `$0.030` iteration budget (`budgetUsd × budgetPercent`) — 16% utilization. Rounds 1–4 of `/research` showed:

- **Cap-vs-actual (~98.8%) is a sizing artifact.** `DEFAULT_PER_INVOCATION_CAP_USD = $0.40` (`ParagraphRecombineAgent.ts:54`) is ~33× the projector's `upperBound` ($0.012). User's perception comes from `SlotsTab.tsx:138-139` rendering `budget: $0.0333  spent: $0.0004` (1.2%).
- **Projector-vs-actual ~50% gap is the real signal.** Dominated by `length_under` drops collapsing per-slot rank counts (53–98% of gap); shorter outputs (11–32%); fewer slots than 12-cap (0–30%).
- **The 20260529 length_under fix is deployed but the LLM ignores it.** Post-fix index-0 drop rates 92–100% (vs pre-fix 89%). Per R4D: index-0 ratios are 0.50–0.74 (mean 0.67) — over-compressing, not just slightly missing.
- **Iteration budget is "respected" only by accident.** The wrapping `IterationBudgetTracker` would catch overruns, but the agent's internal gates (per-slot self-abort, pre-final-ranking) are sized off the static `$0.40` default — 13× the actual `$0.030` iteration share. Today this doesn't bite because actual spend is far below either threshold.
- **Paragraph_recombine is a single-dispatch agent.** `runIterationLoop.ts:1312-1322` runs exactly **1 invocation per iteration**, fanning out internally across N paragraph slots via `Promise.allSettled`. None of the budget-floor + top-up machinery from `generate` iterations applies — there is nothing trying to fill the remaining `$0.025` of the iteration budget.
- **Cost-estimate accuracy is NOT measured for paragraph_recombine.** Generate iterations track `cost_estimation_error_pct`, `generation_estimation_error_pct`, `ranking_estimation_error_pct`, `estimation_abs_error_usd` and propagate to strategy/experiment level. Paragraph_recombine writes none of these; `execution_detail.slots[*].rewrites[*].costUsd` is `0` for every rewrite; there's no per-slot ranking cost. We're flying blind on projector accuracy for this agent.
- **Display defects + dead Layer 3 + llmCallTracking regression** surfaced as cleanup work.

**Goal**: close every cost-estimate accuracy gap for `paragraph_recombine`, then plug the agent into the existing budget-floor-governed multi-dispatch machinery, then surface that dispatch projection in the wizard UI.

## Options Considered

**Original A–E (historical reference, all unchecked):**
- [ ] **Option A: Projector recalibration** — Score 3. Closes 11–32% via output-char tightening; superseded by F+I.
- [ ] **Option B: Per-slot budget rebalance** — Score 1. Self-abort never fires. Rejected.
- [ ] **Option C: Drop-rate-driven short-circuit fix** — Score 4. Conditional on Phase 4 diagnosis.
- [ ] **Option D: Cost-attribution audit** — Score 1. Accounting confirmed correct. Rejected.
- [ ] **Option E: No-op / document** — Score 3. Subsumed by Phase 2 doc updates.

**New F/G/H/I/J/K (ship plan from Round 3+4 + user expansion):**
- [x] **Option F: Cap right-sizing + IterationConfig wiring** — Score 4. Lower `DEFAULT_PER_INVOCATION_CAP_USD` from $0.40 to $0.05; add `perInvocationCapUsd` to `IterationConfig` zod schema; thread through dispatch.
- [x] **Option G: Observability fix (expanded)** — Score 5. Instrument `execution_detail.slots[*].rewrites[*]` with per-rewrite `costUsd`/`temperature`/`status`; add `slot.ranking.cost / status`; **persist invocation-level `estimatedCost`, `estimationErrorPct`, and per-phase `paragraph_rewrite.estimatedCost`/`paragraph_rank.estimatedCost` so paragraph_recombine joins the existing `cost_estimation_error_pct` metric family**; thread `db`/`runId`/`invocationId` into the per-slot LLM client; remove dead Layer 3 of `getRunCostWithFallback`.
- [x] **Option H: Display surface fixes** — Score 3. Add `paragraph_recombine_cost` + `debate_cost` to `getRunCostWithFallback.ts:114-138` Layer 2 sum + `RunsTable.tsx:143-158` inline fallback; expand `EntityMetricsTab.tsx:71-84` `COST_DESCRIPTIONS`; fix the wrong `cost` description.
- [x] **Option I: Re-diagnose 20260529 length_under fix failure** — Score 5. Mandatory before any new drop-rate fix. R4D evidence points to hard char-count directive + per-index temperature override.
- [x] **Option J (NEW): Multi-dispatch for paragraph_recombine** — Score 5. Refactor `runIterationLoop.ts` paragraph_recombine branch from "dispatch 1" to "dispatch K, budget-floor-governed." Reuse the existing `budgetFloorResolvers.ts` (both fraction-of-budget AND multiple-of-agent-cost floors) so paragraph_recombine plugs into the same parallel-batch + sequential-top-up dispatch pattern that `generate` iterations use. Eligibility set is the existing `qualityCutoff` from IterationConfig (`{ mode: 'topN' | 'topPercent', value }`).
- [x] **Option K (NEW): Wizard preview + admin UI for multi-dispatch projection** — Score 4. Extend `projectDispatchPlan.ts:458-507` to project paragraph_recombine dispatch counts using the same `parallelFloor` / `sequentialFloor` math as generate. `DispatchPlanView` then renders the projected parallel/sequential/top-up breakdown for paragraph_recombine iterations, with `effectiveCap` ∈ `'budget' | 'safety_cap' | 'floor' | 'swiss'`. Add a Cost Estimates row on the invocation detail page surfacing projected-vs-actual for paragraph_recombine invocations (made possible by G's `estimatedCost` persistence).

## Phased Execution Plan

### Phase 0: Investigation (DONE)
- [x] Round 1 — Supabase data + code map (n=4 staging invocations).
- [x] Round 2 — Per-input projector recalculation; attribution of the 50% gap.
- [x] Round 3 — Re-diagnosis of 20260529 fix; discovery of `llmCallTracking` regression; option synthesis.
- [x] Round 4 — Length_under root cause (R4D); llmCallTracking static-analysis (R4C); cap-sizing implementation sketch (R4E).

### Phase 1: Observability + Cost-Estimate Instrumentation (G)

**Phase 1a — `execution_detail` instrumentation:**
- [ ] **G1**: Extend `execution_detail.slots[*].rewrites[*]` in `ParagraphRecombineAgent.ts:454,465` (currently `costUsd: 0` placeholder) to include `costUsd`, `temperature`, and `status` (`succeeded` | `dropped:<reason>` | `skipped_slot_abort`). **Per-rewrite cost snapshot mechanism**: today the agent runs `slotLlm.complete(...)` per rewrite and only knows the cumulative `slotScope.getOwnSpent()` at slot end. Snapshot `slotScope.getOwnSpent()` BEFORE each `complete()` call, compute `costUsd = afterSpent - beforeSpent` after the call returns (or in the `validateParagraphRewrite`-drop branch). Mirrors the `costBefore*Call` pattern from `IterativeEditingAgent` per Invariant I2 in `evolution/docs/agents/overview.md`.
- [ ] **G2**: Extend `execution_detail.slots[*].ranking` to include `cost`, `comparisonCount`, and `status` (`completed` | `self_aborted` | `skipped_insufficient_pool`). Snapshot mechanism: `slotScope.getOwnSpent()` delta around the `rankNewVariant` call(s).
- [ ] **G3**: Update Zod schema `slotRecombineExecutionDetailSchema` in `evolution/src/lib/schemas.ts:2105` (the existing schema name — confirmed extant) to accept the new fields. All new fields `.optional()` for backwards compatibility with existing rows; per-rewrite `costUsd` defaults to `0` if missing.

**Phase 1b — projector-vs-actual instrumentation:**
- [ ] **G4**: Capture the projector output (`estimateParagraphRecombineCost(...)` from `estimateCosts.ts:596-637`) at agent dispatch time and persist into `execution_detail`:
  - Top-level `estimatedCost` (expected + upperBound).
  - Per-phase `paragraph_rewrite.estimatedCost` and `paragraph_rank.estimatedCost` (split if `estimateParagraphRecombineCost` is refactored to return per-phase numbers; otherwise persist the combined and split via the per-phase actual cost ratio at read time).
- [ ] **G5**: Compute `estimationErrorPct = (actualCost - estimatedCost) / estimatedCost` at agent finalization and persist into `execution_detail.estimationErrorPct` (mirroring `generate_from_previous_article` invocations).
- [ ] **G6**: Verify that paragraph_recombine invocations join the existing `cost_estimation_error_pct` / `estimation_abs_error_usd` / `estimated_cost` run-level metric family AUTOMATICALLY once G4/G5 persist `estimationErrorPct` + `estimatedTotalCost` into `execution_detail`. Per `evolution/src/lib/metrics/computations/finalization.ts:94-130`, the existing `computeCostEstimationErrorPct` and `computeEstimatedCost` iterate over ALL invocation details agnostic to `agent_name` — no new branch needed in finalization.ts. Add a unit test asserting paragraph_recombine invocations contribute correctly.
- [ ] **G7**: Add per-phase estimation-error rollups: `paragraph_rewrite_estimation_error_pct` and `paragraph_rank_estimation_error_pct` at run level (new compute functions mirroring `computeGenerationEstimationErrorPct` / `computeRankingEstimationErrorPct`), with `avg_paragraph_rewrite_estimation_error_pct` / `avg_paragraph_rank_estimation_error_pct` propagation to strategy/experiment via `SHARED_PROPAGATION_DEFS` in `evolution/src/lib/metrics/registry.ts`.

**Phase 1c — llmCallTracking wiring (targeted slice):**
- [ ] **G8**: Thread `db`, `runId`, and `invocationId` into the per-slot `EvolutionLLMClient` construction at `ParagraphRecombineAgent.ts:352-354`. Today the per-slot client is db-less (per R1D); wiring it makes `createEvolutionLLMClient.ts:230-241` (`if (db && runId)`) fire for `paragraph_rewrite` and `paragraph_rank` calls. **Scope note**: this fixes the paragraph_recombine PER-SLOT slice only. The article-level rank call inside the same agent (`ParagraphRecombineAgent.ts:271-289`) already uses the invocation-scoped client with `db`/`runId`/`invocationId` wired via `Agent.run()` (`Agent.ts:130-141`), yet Round 2 found ZERO `llmCallTracking` rows even for that path on staging. That broader failure (article-rank + all other evolution agents writing nothing since 2026-02-22) is the out-of-scope follow-up flagged in Section 7. G8 will surface that boundary clearly when verification runs.

**Phase 1d — Fallback chain cleanup:**
- [ ] **G9**: Remove Layer 3 from `getRunCostWithFallback.ts:66-86` — the `evolution_run_costs` view was dropped in `20260323000004_drop_legacy_metrics.sql` and currently errors. Layers 1+2+4 cover all cases.

**Phase 1e — Verification:**
- [ ] **G10**: Trigger a fresh paragraph_recombine run on staging via strategy `863bc454…`. Query staging: confirm `execution_detail.slots[*].rewrites[*]` has populated `costUsd`/`temperature`/`status`; confirm `estimationErrorPct` is persisted; confirm `evolution_metrics` has the new run-level rows; confirm `llmCallTracking` has rows with non-null `evolution_invocation_id` matching the new invocation.
- [ ] **G11 (out-of-scope flag)**: If G8 does NOT produce `llmCallTracking` rows, log a follow-up project per the R4C diagnosis (most likely cause: staging running stale pre-April-28 code).

### Phase 2: Cap right-sizing (F)
- [ ] **F1**: Lower `DEFAULT_PER_INVOCATION_CAP_USD` from `0.40` to `0.05` in `ParagraphRecombineAgent.ts:54`. Sanity: at 12 slots → `perSlotBudgetUsd = $0.00417`; pre-final-ranking gate `0.9 × 0.05 = $0.045` retains 9× headroom over median spend.
- [ ] **F2**: Add `perInvocationCapUsd: z.number().min(0.001).max(0.5).optional()` to `iterationConfigSchema` in `evolution/src/lib/schemas.ts`, plus a refinement rejecting it on non-paragraph_recombine agent types. Upper bound 0.5 is 10× the new default ($0.05) — generous but tight enough to catch order-of-magnitude config errors. Must ALSO be added to `canonicalizeIterationConfig` whitelist per J1.5 to participate in `config_hash`.
- [ ] **F3**: In `runIterationLoop.ts:1312-1322` paragraph_recombine dispatch branch, pass `iterCfg.perInvocationCapUsd` into the agent input (agent already accepts the override at `:91, :149`).
- [ ] **F4 (deferred)**: Optionally capture `perInvocationCapUsd` on the projector output so the wizard preview can render "expected $0.009 / cap $0.05" side-by-side. Bundle with Phase 7 (K) UI work.

### Phase 3: Display fixes (H)
- [ ] **H1**: Add `paragraph_recombine_cost` and `debate_cost` to the Layer 2 sum in `getRunCostWithFallback.ts:114-138`.
- [ ] **H2**: Mirror the addition into the inline "Spent" column fallback at `RunsTable.tsx:143-158` (also add `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost`).
- [ ] **H3**: Expand `COST_DESCRIPTIONS` in `EntityMetricsTab.tsx:71-84` to include `paragraph_recombine_cost`, `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost`, `reflection_cost`, `debate_cost`.
- [ ] **H4**: Fix the `cost` description (currently `"= generation + ranking + seed"`) to match post-Phase-6 reality.

### Phase 4: Re-diagnose length_under (I)
- [ ] **I1**: After Phase 1 lands and a fresh run completes, pull per-rewrite text + `dropReason` + `temperature` from `execution_detail.slots[*].rewrites[*]` for new invocations to confirm the R4D pattern (index-0 ratios 0.50–0.74 at temp 1.2).
- [ ] **I2**: Quantify the LLM's actual output behavior at each ladder temperature: median output chars, distribution vs parent-paragraph length, fraction below the 0.80× validator floor.
- [ ] **I3**: Choose between R4D's recommended fixes:
  - (a) **Hard char-count directive**: the directive text lives in `PARAGRAPH_REWRITE_DIRECTIVES` (a module-level `readonly string[]` const). To inject a computed minimum, do NOT mutate the const — instead parameterize the prompt assembly in `buildParagraphRewritePrompt(...)`: append an explicit length-floor instruction containing `at least ${Math.ceil(0.85 * paragraphText.length)} characters (original is ${paragraphText.length})` to the directive section at prompt-build time. The directive const stays a generic "tighten and simplify" hint; the char floor becomes per-paragraph dynamic.
  - (b) **Per-index temperature override**: special-case index-0 to ~0.7 in `ParagraphRecombineAgent.ts:62-76` while keeping index-1/2 at 1.6/2.0.
  - (c) **One-shot retry on `length_under`**.
  - (d) Switch rewriter model for index-0 specifically.
  - Recommend starting with (a)+(b).
- [ ] **I4**: Document chosen approach in this `_planning.md` review section; proceed to Phase 5 if code changes needed.

### Phase 5: Drop-rate fix (C, CONDITIONAL on Phase 4)
- [ ] **C1**: Ship whichever I3 sub-option was chosen.
- [ ] **C2**: Re-run staging; expect index-0 drop rate <30% (down from current 92–100%).
- [ ] **C3**: If no fix is viable, update `estimateCosts.ts:596-637` projector to assume ~35% drop rate (variant of Option A) so the projector matches reality. Validate via the new `cost_estimation_error_pct` rollup from Phase 1 (G6) showing the gap closing.

### Phase 6: Multi-dispatch refactor (J)

**Phase 6a — Schema + IterationConfig + config_hash whitelist:**
- [ ] **J1**: Add to `iterationConfigSchema` in `evolution/src/lib/schemas.ts`:
  - `maxDispatches?: z.number().int().min(1).max(10).optional()` — hard upper bound on parent variants to recombine per iteration. Default behavior when unset: `1` (current single-dispatch behavior). Set to `>1` to opt into multi-dispatch. Cap of 10 matches the practical eligible-parent pool size; raise if a use case emerges.
  - Refinement: reject `maxDispatches` on agent types other than `paragraph_recombine`.
- [ ] **J1.5 (CRITICAL — config_hash dedup correctness)**: Extend `canonicalizeIterationConfig` in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts:35-82` to emit `maxDispatches` (and `perInvocationCapUsd` from F2) when `iterCfg.agentType === 'paragraph_recombine'`. Without this, two strategies that differ ONLY in `maxDispatches` (e.g. `1` vs `5`) will produce identical `config_hash` and collide on the upsert at `:142-148` (`onConflict: 'config_hash'`), silently corrupting the strategy registry. Pre-existing paragraph_recombine knobs (`rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`, `paragraphRewriteModel`) are ALREADY unhashed; leave them as-is to avoid invalidating existing strategy hashes. Add `hashStrategyConfig.test.ts` cases asserting two configs differing only in `maxDispatches` produce different hashes; same for `perInvocationCapUsd`.
- [ ] **J2**: Reuse the existing budget-floor fields on `StrategyConfig` (`minBudgetAfterParallelFraction`, `minBudgetAfterParallelAgentMultiple`, `minBudgetAfterSequentialFraction`, `minBudgetAfterSequentialAgentMultiple`) — no new schema fields needed. Strategies that want multi-dispatch paragraph_recombine set these alongside `maxDispatches > 1`.
- [ ] **J3 (optional)**: Add per-iteration overrides `parallelFloorFraction` / `parallelFloorAgentMultiple` / `sequentialFloorFraction` / `sequentialFloorAgentMultiple` to IterationConfig so paragraph_recombine and generate can have distinct floor profiles within the same strategy. Plumb via `BudgetFloorConfig` shape, choosing iter-level over strategy-level when present (matches existing `iterCfg.debateJudgeReasoningEffort` cascade convention). Defer if scope-creep.

**Phase 6b — Dispatch refactor (faithful generate-runtime mirror):**

> **Architecture note (corrected after plan-review iteration 1):** the generate-iteration RUNTIME (`runIterationLoop.ts:405-419`) does NOT call `resolveParallelFloor` for parallel batch sizing — it uses `parallelDispatchCount = min(DISPATCH_SAFETY_CAP, floor(availBudget / estPerAgent))`. `resolveParallelFloor` lives in the PROJECTOR (`projectDispatchPlan.ts`) and is used for wizard preview math. Only `resolveSequentialFloor` is invoked at runtime (line 718) to gate top-up. J4 mirrors this split.

- [ ] **J4 (CRITICAL — distinct-parent + runtime semantics)**: In `runIterationLoop.ts:1312-1322` paragraph_recombine branch, replace the current single-`resolveParent` + single-`dispatchOneAgent` flow with a budget-governed multi-dispatch loop modeled on the generate-iteration RUNTIME pattern (NOT the projector pattern):
  1. **Eligible parent set**: filter the in-run pool via the existing `qualityCutoff` (eligibility, NOT dispatch count). Apply the same `fromArena` exclusion as `runIterationLoop.ts:1102` (no arena entries as parents — matches existing convention).
  2. **Pre-shuffle for distinct-parent enforcement**: derive a seeded shuffle of `eligibleParents` via `deriveSeed(randomSeed, 'iter${i}', 'paragraph_recombine_shuffle')`, then dispatch by sequential index into the shuffled list. This guarantees K distinct parents without modifying `resolveParent` (whose signature stays untouched). If we ever need parent-eligibility filtering more sophisticated than `qualityCutoff` allows, extend `resolveParent` with a `excludeParentIds?: Set<string>` arg in a follow-up; for J4 the pre-shuffle is sufficient and simpler.
  3. **Parallel batch sizing**: `availBudget = iterTracker.getAvailableBudget()`; `maxAffordable = max(1, floor(availBudget / projector.expected))`; `parallelDispatchCount = min(DISPATCH_SAFETY_CAP, maxAffordable, maxDispatches, eligibleParents.length)`. Dispatch all-at-once via `Promise.allSettled`. (No `resolveParallelFloor` call at runtime — matches generate.)
  4. **Measure**: `actualAvgCostPerAgent = sum(scope.getOwnSpent()) / successCount` across completed parallel invocations. Fall back to `projector.expected` if `successCount === 0`.
  5. **Sequential top-up**: if `EVOLUTION_TOPUP_ENABLED !== 'false'` AND `parallelDispatchCount < maxDispatches` AND `parallelDispatchCount < eligibleParents.length`, sequentially dispatch additional invocations indexed into the pre-shuffled parent list. Gate via `sequentialFloor = resolveSequentialFloor(strategyConfig, iterBudget, projector.expected, actualAvgCostPerAgent)` (matches `runIterationLoop.ts:718`). Continue while `(iterTracker.getAvailableBudget() - actualAvgCostPerAgent) ≥ sequentialFloor` AND total dispatched < `DISPATCH_SAFETY_CAP`.
  6. **Single MergeRatingsAgent**: feed all surfaced recombined variants + concatenated match histories into ONE `MergeRatingsAgent.run()` at iteration end. The merge agent's `matchBuffers: ReadonlyArray<ReadonlyArray<MergeMatchEntry>>` shape already accepts N buffers and `iterationType: 'paragraph_recombine'` is already in its union — no merge-agent changes needed.
- [ ] **J5**: Inline the multi-dispatch loop in `runIterationLoop.ts`'s paragraph_recombine branch (the new code is ~40 lines). Do NOT introduce an `editingDispatch.ts`-style helper unless the loop body grows beyond ~60 lines — premature abstraction otherwise. Reuse existing `seededRandom`, `deriveSeed`, `resolveSequentialFloor`, and `DISPATCH_SAFETY_CAP` from neighboring code.

**Phase 6c — Agent compatibility:**
- [ ] **J6**: Confirm `ParagraphRecombineAgent.execute()` is reentrant (no shared mutable state across invocations). Each invocation already gets a fresh `AgentCostScope` via `createAgentCostScope` (`Agent.ts`) and the agent reads its input parent + emits a single variant. Should be safe; add a regression test.
- [ ] **J7**: Confirm the per-slot scope nesting holds: invocation scope → per-slot scope. With K parallel invocations, each gets its own invocation scope; per-slot scopes nest under their respective invocation scopes. No cross-invocation state.
- [ ] **J8**: Confirm `syncToArena` + `persistSlotMatches` handle K parallel invocations without race. Each invocation writes to distinct `slotTopicId`s for its own parent's paragraphs; no conflict on conflict.

**Phase 6d — Verification:**
- [ ] **J9**: Trigger a staging run with `maxDispatches: 5` and `minBudgetAfterParallelAgentMultiple: 2` set on a paragraph_recombine iteration. Confirm: 3–5 invocations dispatch in parallel; `actualAvgCostPerAgent` measured; top-up loop fills remaining budget; iteration ends with utilization >80% (vs current 16%).

### Phase 7: Wizard + Admin UI (K)

**Phase 7a — Projector update:**
- [ ] **K1**: Extend `projectDispatchPlan.ts:458-507` paragraph_recombine branch to compute `dispatchCount` via the same `parallelFloor` + `sequentialFloor` math used for generate iterations in the PROJECTOR (not the runtime — see J4 architecture note). Use `resolveParallelFloor` / `resolveSequentialFloor` from `budgetFloorResolvers.ts`. Inputs: iteration budget, projector `expected`/`upperBound`, `qualityCutoff` to size eligible set, `maxDispatches` as upper bound. Outputs: `parallelDispatched`, `sequentialDispatched` (top-up estimate), `effectiveCap` ∈ `'budget' | 'safety_cap' | 'floor' | 'eligibility'` (the existing union has `'swiss'` too but it never applies to paragraph_recombine).
- [ ] **K2**: `EstPerAgentValue.paragraphRecombine` is already per-invocation in the existing branch (`projectDispatchPlan.ts:495`); the per-iteration total is already computed at render time as `dispatchCount × estPerAgent.expected.total` (`DispatchPlanView.tsx:84`). K2 work is therefore: just ensure the new `dispatchCount > 1` from K1 flows through to the existing render path. No semantic change to `EstPerAgentValue.paragraphRecombine` itself.

**Phase 7b — Wizard preview:**
- [ ] **K3**: In `DispatchPlanView` (`evolution/src/components/evolution/DispatchPlanView.tsx`), render the parallel/sequential/top-up breakdown for paragraph_recombine iterations the same way generate iterations are rendered. Show `dispatchCount` with breakdown chip (`X parallel + Y top-up (max Z)`), `effectiveCap` reason chip, and `$/Agent (exp – upper)` from the projector.
- [ ] **K4**: Surface the budget-floor configuration on the strategy wizard so users can set `minBudgetAfterParallelAgentMultiple` etc. with live wizard-preview feedback (the same UI that generate iterations already have — extend the same form panel).

**Phase 7c — Per-invocation Cost Estimates tab:**
- [ ] **K5**: On `/admin/evolution/invocations/[invocationId]`, the existing Cost Estimates tab renders projected-vs-actual for generate invocations. Add a paragraph_recombine branch that reads from `execution_detail.estimatedCost` + `.estimationErrorPct` (populated by Phase 1 G4/G5). Renders: top-line projected vs actual, per-phase split (paragraph_rewrite vs paragraph_rank), per-slot table with each slot's projected-vs-actual spend.
- [ ] **K6**: On `/admin/evolution/runs/[runId]` Cost Estimates tab, surface paragraph_recombine alongside the existing generate-iteration cost-estimate accuracy view. Use the new run-level metrics from Phase 1 (G6/G7).

**Phase 7d — SlotsTab cleanup:**
- [ ] **K7**: Update `SlotsTab.tsx:138-139` to render `expected: $X (projector)  spent: $Y` instead of `budget: $X  spent: $Y`, with the per-slot safety cap available via tooltip. The `expected` value comes from the per-slot projector output (G4's split divided by slot count). This collapses the user's "1% spent" perception immediately.

**Phase 7e — Verification:**
- [ ] **K8**: Wizard preview shows realistic dispatch counts and cost breakdown for a multi-dispatch paragraph_recombine strategy. Iteration detail page surfaces projected-vs-actual with non-zero estimation error rates.

## Testing

### Unit Tests
- [ ] **Phase 1 (G)**:
  - `ParagraphRecombineAgent.test.ts` — assert each `rewrites[i]` in `execution_detail` has non-null `costUsd`, `temperature`, `status`. Assert `slot.ranking.cost`/`status` populated. Assert top-level `estimatedCost` and `estimationErrorPct`.
  - `createEvolutionLLMClient.test.ts` (extend or create) — assert tracking-write fires when db+runId+invocationId are passed.
  - New: `evolution/src/lib/metrics/computations/finalization.test.ts` (or equivalent) — assert paragraph_recombine invocations populate `cost_estimation_error_pct` / `estimated_cost` / `estimation_abs_error_usd` run-level metrics.
  - `schemas.test.ts` — assert new optional `execution_detail` fields parse.
- [ ] **Phase 2 (F)**:
  - `ParagraphRecombineAgent.test.ts:134` — change `perInvocationCapUsd: 0.4` to `0.05`.
  - New: assert default cap derives `perSlotBudgetUsd = 0.05 / N`; override passes through.
  - `schemas.test.ts` — assert zod accepts `perInvocationCapUsd` only on `paragraph_recombine`.
- [ ] **Phase 3 (H)**:
  - `getRunCostWithFallback.test.ts` — assert Layer 2 sum includes paragraph_recombine_cost + debate_cost.
  - `RunsTable.test.tsx` — assert "Spent" fallback includes new metrics.
  - `EntityMetricsTab.test.tsx` — assert new `COST_DESCRIPTIONS` entries render.
- [ ] **Phase 5 (C)** (conditional): tests TBD by chosen approach in Phase 4.
- [ ] **Phase 6 (J)**:
  - `runIterationLoop.test.ts` — assert paragraph_recombine multi-dispatch path: `maxDispatches=3` + floor config → 3 invocations dispatched; single MergeRatingsAgent at end.
  - New: `evolution/src/lib/pipeline/loop/paragraphRecombineDispatch.test.ts` (or inline) — assert parent eligibility filter honors `qualityCutoff`; assert distinct-parent dispatch via seeded pre-shuffle (no double-up across K dispatches); assert top-up stops at `sequentialFloor`; **assert that `maxDispatches` unset or `1` reproduces EXACTLY the current single-dispatch behavior (load-bearing rollback regression test for J6).**
  - `schemas.test.ts` — assert `maxDispatches` accepted only on `paragraph_recombine`; range validated; rejected on other agent types.
  - `hashStrategyConfig.test.ts` — assert two configs differing only in `maxDispatches` produce DIFFERENT hashes; same for `perInvocationCapUsd` (J1.5 correctness gate).
  - `ParagraphRecombineAgent.test.ts` — assert agent is reentrant (two parallel `execute()` calls with same context produce independent results).
- [ ] **Phase 7 (K)**:
  - `projectDispatchPlan.test.ts` — assert paragraph_recombine branch returns `dispatchCount > 1` when budget supports it; `effectiveCap` correctly identifies which constraint bound the count.
  - `DispatchPlanView.test.tsx` — assert paragraph_recombine row renders parallel/sequential breakdown.
  - `CostEstimatesTab.test.tsx` — assert paragraph_recombine invocations render projected-vs-actual.

### Integration Tests
- [ ] **Phase 1 (G)**: `src/__tests__/integration/evolution-paragraph-recombine-accumulation.integration.test.ts` — extend to assert per-call `llmCallTracking` rows are written for `paragraph_rewrite` and `paragraph_rank` AgentNames; assert run-level `cost_estimation_error_pct` row is written at finalization. Reuse the `evolutionTablesExist` + `paragraphKindMigrationApplied` skip pattern already in the file.
- [ ] **Phase 1 (G)**: `src/__tests__/integration/evolution-cost-estimate-metrics.integration.test.ts` (or `evolution-metrics-recomputation.integration.test.ts`) — extend to assert paragraph_recombine invocations contribute to the new `paragraph_rewrite_estimation_error_pct` / `paragraph_rank_estimation_error_pct` rollups and that strategy/experiment-level propagation fires.
- [ ] **Phase 1 (G)**: Targeted regression test confirming `getRunCostWithFallback.ts` no longer references the dropped `evolution_run_costs` view.
- [ ] **Phase 2 (F)**: `runIterationLoop` integration test — assert `perInvocationCapUsd` override threads from `iterationConfig` to agent input and into `execution_detail.slots[i].perSlotBudgetUsd`.
- [ ] **Phase 6 (J)**: New integration test `evolution-paragraph-recombine-multi-dispatch.integration.test.ts` — assert: multi-dispatch produces K recombined variants; per-iteration cost utilization >80% with `maxDispatches: 5`; iteration budget enforced (no overrun); single merge agent at end; arena sync for all K variants.

### E2E Tests
- [ ] **Phase 7 (K)**: Extend `admin-evolution-experiment-wizard-e2e.spec.ts` — assert paragraph_recombine iteration shows dispatch projection breakdown in wizard preview.
- [ ] **Phase 7 (K)**: Extend `admin-evolution-invocation-detail.spec.ts` — assert paragraph_recombine invocation Cost Estimates tab renders projected-vs-actual with non-zero estimation-error display.

### Manual Verification
- [ ] After Phase 1+2+6 land, trigger a fresh paragraph_recombine run on staging with `maxDispatches: 5`. Query:
  - Per-slot `execution_detail` has populated `costUsd`/`temperature`/`status` fields.
  - Invocation `execution_detail.estimationErrorPct` is populated.
  - Run-level `cost_estimation_error_pct` metric row exists.
  - `llmCallTracking` has rows tied to the new invocation.
  - 3–5 paragraph_recombine invocations per iteration (not 1).
  - Iteration spend utilization >80% (vs current 16%).
  - SlotsTab renders `expected: $X / spent: $Y` instead of `budget / spent`.

## Verification

### A) Playwright Verification
- [ ] Load `/admin/evolution/strategies/new` wizard — confirm paragraph_recombine iteration row shows `parallel + top-up` dispatch projection (not single-dispatch).
- [ ] Load `/admin/evolution/runs/<post-J-run-id>` → SlotsTab; assert per-slot `expected: $X  spent: $Y` ratio is ~50% (close to projector expected); legend explains "expected vs actual."
- [ ] Load `/admin/evolution/invocations/<post-G-invocation-id>` Cost Estimates tab; assert paragraph_recombine projected-vs-actual rendering with per-phase breakdown.
- [ ] Load `/admin/evolution/runs` runs-list; assert "Spent" column for any paragraph_recombine-only run shows non-zero.

### B) Automated Tests
- [ ] `npm test` — all evolution unit tests (Phases 1–7).
- [ ] `npm run test:integration` — paragraph_recombine accumulation + new multi-dispatch test.
- [ ] `npm run test:e2e:evolution` — confirm wizard + invocation detail tests pass.
- [ ] `npm run test:e2e:critical` — confirm no critical-path regression.
- [ ] `npm run lint`, `npm run typecheck`, `npm run build`.

### C) Rollback & Kill Switch
- [ ] **Operational rollback (whole feature)**: `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED='false'` (existing) short-circuits paragraph_recombine dispatch entirely.
- [ ] **Phase 2 (F) rollback**: revert `DEFAULT_PER_INVOCATION_CAP_USD` to `0.4`. No DB migration; strategies with explicit overrides keep working.
- [ ] **Phase 6 (J) rollback**: omit or set `maxDispatches: 1` on existing strategies — they retain current single-dispatch behavior. New strategies opt in by setting `>1`.
- [ ] **Phase 7 (K) rollback**: wizard + invocation detail UI changes are additive; revert to prior renderers if regressions surface.
- [ ] **Risk assessment**:
  - Low for G/F/H (observability + config + display).
  - Medium for J — multi-dispatch is a runtime behavior change. Mitigated by `maxDispatches` default of 1 (opt-in only) and the existing `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` kill switch. Audit existing strategies before any default change.
  - Low for K — UI-only, no semantic changes.

## Documentation Updates
- [ ] `docs/docs_overall/debugging.md` — add paragraph_recombine cost-undershoot triage row pointing to `execution_detail.slots[*].rewrites[*]` and the new estimation-error metrics.
- [ ] `docs/docs_overall/testing_overview.md` — no expected updates.
- [ ] `docs/feature_deep_dives/testing_setup.md` — no expected updates.
- [ ] `evolution/docs/README.md` — no expected updates.
- [ ] `docs/docs_overall/architecture.md` — no expected updates unless the evolution-loop dispatch references need refresh post-J.
- [ ] `evolution/docs/architecture.md` — update the iteration-loop section: paragraph_recombine now follows the same parallel-batch + sequential-top-up pattern as generate (Phase 6); clarify that `resolveParallelFloor` is projector-only while `resolveSequentialFloor` is the only floor consulted at runtime.
- [ ] `evolution/docs/data_model.md` — note new `execution_detail` fields on paragraph_recombine invocations.
- [ ] `evolution/docs/agents/overview.md` — update `ParagraphRecombineAgent` section: per-slot LLM client now wires db/runId/invocationId; new `execution_detail` shape additions; multi-dispatch behavior under `maxDispatches > 1`.
- [ ] `evolution/docs/cost_optimization.md` — update Paragraph-Recombine Cost section with: projector-vs-actual ~50% gap attribution; new `paragraph_rewrite_estimation_error_pct` / `paragraph_rank_estimation_error_pct` metrics; multi-dispatch budget-floor compatibility. Correct the "audit-gap window ended 2026-04-30" claim.
- [ ] `evolution/docs/rating_and_comparison.md` — no expected updates.
- [ ] `evolution/docs/strategies_and_experiments.md` — note `maxDispatches` and (if J3 ships) per-iteration budget-floor overrides.
- [ ] `evolution/docs/metrics.md` — document `paragraph_rewrite_estimation_error_pct`, `paragraph_rank_estimation_error_pct`, and new `execution_detail` shapes.
- [ ] `evolution/docs/arena.md` — no expected updates.
- [ ] `evolution/docs/entities.md` — no expected updates.
- [ ] `evolution/docs/reference.md` — add `perInvocationCapUsd` + `maxDispatches` to IterationConfig knob list; note Layer 3 removal in `getRunCostWithFallback`.
- [ ] `evolution/docs/visualization.md` — document SlotsTab `expected vs spent` change; document paragraph_recombine dispatch breakdown in `DispatchPlanView`; document new paragraph_recombine Cost Estimates tab.
- [ ] `evolution/docs/minicomputer_deployment.md` — no expected updates.
- [ ] `evolution/docs/curriculum.md` — no expected updates.
- [ ] `evolution/docs/logging.md` — no expected updates.
- [ ] `evolution/docs/paragraph_recombine.md` — **HIGHEST PRIORITY**: update Cost envelope (projector expected `~$0.0093`, upperBound `~$0.0120`, measured median `$0.0048`; new `DEFAULT_PER_INVOCATION_CAP_USD = $0.05`); update Failure modes (`length_under` 30–42% aggregate, 92–100% on index-0); document `perInvocationCapUsd`, `maxDispatches`, budget-floor compatibility; describe the new dispatch flow (parallel batch + sequential top-up) and the eligibility filter via `qualityCutoff`.
- [ ] `evolution/docs/variant_lineage.md` — no expected updates.
- [ ] `evolution/docs/multi_iteration_strategies.md` — add `maxDispatches` to the IterationConfig schema list; document that paragraph_recombine now honors budget floors (same as generate); reference `budgetFloorResolvers.ts`.
- [ ] `evolution/docs/criteria_agents.md` — no expected updates.
- [ ] `evolution/docs/editing_agents.md` — no expected updates.
- [ ] `evolution/docs/evolution_metrics.md` — note new `paragraph_recombine`-tagged estimation-error metric rows.

## Out-of-scope Follow-up Project

**The evolution-wide `llmCallTracking` regression discovered in Round 3+4 warrants its own follow-up project.** Scope distinction:
- *This project* (Phase 1 / G8): wires `db`/`runId`/`invocationId` into the per-slot LLM client for paragraph_recombine. Fixes the paragraph_recombine slice only.
- *Follow-up project*: zero evolution call_source rows since 2026-02-22; the wiring is structurally correct in main but staging shows no writes. Per R4C, most likely cause is stale staging deploy (commit `3e6a7290` may not be deployed) or a new spending-gate Next.js coupling issue. **Verification gate**: if G10 produces `llmCallTracking` rows for paragraph_recombine but other agents' calls (`generation`, `ranking`, `seed`, `reflection`, etc.) still don't on the same run, open a follow-up project to diagnose and fix.

**Decision rule**: do not block this project on the broader regression. Ship G8 (targeted fix) + G11 (follow-up flag).

## Review & Discussion

### `/plan-review` — completed 2026-05-30 (2 iterations, consensus reached)

**Final scores**: Security & Technical 5/5 · Architecture & Integration 5/5 · Testing & CI/CD 5/5. Zero critical gaps remain. Plan is ready for execution.

**Iteration 1 (initial scores 3 / 3 / 4)** — critical gaps surfaced and fixed:
1. **`config_hash` dedup hazard** — adding `maxDispatches` / `perInvocationCapUsd` to `iterationConfigSchema` without extending `canonicalizeIterationConfig`'s whitelist would silently collide strategies with different multi-dispatch behavior. Added explicit step **J1.5** with `hashStrategyConfig.test.ts` correctness gate.
2. **Distinct-parent enforcement** — original J4 asserted distinct parents but `resolveParent` accepts no exclusion arg. Replaced with a **seeded pre-shuffle** mechanism (`deriveSeed(randomSeed, 'iter${i}', 'paragraph_recombine_shuffle')`) that guarantees K distinct parents without modifying `resolveParent`'s signature.
3. **J4 runtime / projector floor split** — original J4 used `resolveParallelFloor` at runtime, but the generate-iteration runtime uses `min(DISPATCH_SAFETY_CAP, floor(availBudget / estPerAgent))` and `resolveParallelFloor` is projector-only. Rewrote J4 step 3 to match generate's runtime pattern; added architecture note in Phase 6b clarifying the split. K1 keeps `resolveParallelFloor` (projector context, where it belongs).

**Minor fixes folded in**: filename typo (`getRunCostsWithFallback` → `getRunCostWithFallback`), F2 zod bound tightened (2.0 → 0.5), J1 maxDispatches bound (20 → 10), K1 effectiveCap union corrected, K2 rewritten to reflect existing per-invocation semantics, I3a const parameterization, G1/G2 per-rewrite cost snapshot mechanism, G6 simplified (auto-joins finalization), G8 scope clarification re article-rank tracking, `docs/docs_overall/architecture.md` doc entry added, `evolution-cost-estimate-metrics.integration.test.ts` extension added, rollback regression test for `maxDispatches` unset.

**Iteration 2 — all reviewers 5/5, no critical gaps.** Remaining minor issues (15 total across the three perspectives) are non-blocking polish to address during execution:
- *Security*: K×N concurrent LLM call blast radius (J9 should observe 429 rates); F1 per-slot self-abort floor audit; clarify hashStrategyConfig test file location; J4 top-up should mirror generate's kill-switch / deadline / abort checks.
- *Architecture*: minor line-cite drift; document paragraph_recombine-specific dispatch extensions vs generate-runtime parity; verify post-refactor line numbers.
- *Testing*: concrete SQL queries for manual verification; budget-overrun guard unit test; explicit `EVOLUTION_TOPUP_ENABLED='false'` coverage; skip-pattern note for the new multi-dispatch integration test; backward-compat schema parse test for old `execution_detail` rows; K7 SlotsTab rename E2E coverage; max-duration expectation for new integration test; explicit strategy/experiment propagation assertion.

Plan-review state and full reviewer-output JSON at `.claude/review-state/investigate_paragraph_rewrite_cost_undershoot_evolution_20260529.json`.

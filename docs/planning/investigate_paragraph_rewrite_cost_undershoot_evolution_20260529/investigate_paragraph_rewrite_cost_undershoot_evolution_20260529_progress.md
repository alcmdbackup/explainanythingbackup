# Investigate Paragraph Rewrite Cost Undershoot Evolution Progress

## Phase 0: Investigation (DONE — 2026-05-30)

### Work Done
Ran `/research` with 4 rounds × 5 parallel agents (20 agents total) against staging Supabase + code maps.

**Round 1 (baseline reconnaissance)**
- A1: Staging cost data baseline — found n=4 paragraph_recombine invocations from strategy `863bc454…`; median cost $0.0048; 98.8% of $0.40 cap left on the table; effective derived cap $0.030.
- A2: Mapped every cost-gating decision in `ParagraphRecombineAgent.execute()` — perSlotBudgetUsd allocation, per-slot self-abort (0.9× per-slot), pre-final-ranking gate (0.9× perInvocationCap), validate-drop path (LLM cost already recorded), article-level rank cost flows to `ranking_cost` not `paragraph_recombine_cost`.
- A3: Mapped `estimateParagraphRecombineCost` math — `expected ≈ $0.0093`, `upperBound ≈ $0.0120` at default knobs. `OUTPUT_TOKEN_ESTIMATES.paragraph_rewrite = 250`, `.paragraph_rank = 100`. Calibration loader includes `paragraph_rewrite` but NOT `paragraph_rank`.
- A4: Traced LLM client cost path — token-based via `calculateLLMCost` (real `usage` tokens), NOT chars/4 heuristic. Per-slot LLM client constructed WITHOUT `db`/`runId`/`invocationId` — so NO `llmCallTracking` rows for `paragraph_rewrite` / `paragraph_rank` calls.
- A5: Traced `paragraph_recombine_cost` metric write path — single SUM-write per invocation via `writeMetricMax` (GREATEST upsert). `getPhaseCosts()` is run-cumulative so MAX-write is mathematically equivalent to SUM-of-invocations under sequential dispatch. **`getRunCostsWithFallback` Layer 2 OMITS `paragraph_recombine_cost`** — latent display bug.

**Round 2 (quantification + projector reality check)**
- A1: Per-slot execution_detail mining — 38% aggregate rewrite drop rate, ALL `length_under`. Per-slot spend $0.0003–$0.0006 (0.5–1.5% of per-slot budget). 16.7% of slots end with ≤1 surviving rewrite. **`execution_detail` MISSING per-rewrite costUsd, temperature, status, per-slot ranking cost.**
- A2: Metric vs invocation parity — invocation `cost_usd` ($0.0043–0.0054) > `paragraph_recombine_cost` rollup ($0.0036–0.0046) by $0.0006–0.0007 = the article-level rank cost (correctly bucketed to `ranking_cost`). Accounting is internally consistent. Each run has exactly 1 paragraph_recombine invocation (MAX-write artifact is benign today).
- A3: Projector vs actual — when recalculated with ACTUAL inputs, projector predicts within 1–7% of actual. Attribution: **rewrite drops 53–98%**, shorter outputs 11–32%, fewer slots 0–30%, article-length variance small.
- A4: Calibration + LLM audit — `evolution_cost_calibration` is EMPTY on staging (0 rows). Hardcoded fallback in play. **ZERO `llmCallTracking` rows for any of the 4 invocations.** Across all staging, only 1 row ever has `evolution_invocation_id IS NOT NULL`, from 2026-04-19 (pre-Apr-28 fix). Broader observability gap.
- A5: Display surface audit — `cost` rollup row exists for all 4 runs (Layer 1 catches). Layer 2 omission is dormant. **`evolution_run_costs` view (Layer 3) was dropped in `20260323000004_drop_legacy_metrics.sql`** — Layer 3 errors and falls through to Layer 4 = 0. `RunsTable.tsx:143-158` inlines its OWN sum omitting paragraph_recombine_cost (active code, latent for current data).

**Round 3 (hypothesis testing)**
- A1: Length_under fix audit — commit `72ebfa80` landed 2026-05-29 19:29 UTC; source confirms `PARAGRAPH_REWRITE_TEMP_FLOOR = 1.2` + "never below ~0.85x" directive. Post-fix index-0 drop rates: 100% / 92% / 100% (vs pre-fix 89%). **Fix is deployed but does not work.**
- A2: Cap sizing — `DEFAULT_PER_INVOCATION_CAP_USD = $0.40` is unreferenced from IterationConfig (no override path). SlotsTab is the surface that renders `budget: $0.0333 spent: $0.0004` — the user's perception source. Recommended: lower to $0.05 + wire schema field.
- A3: llmCallTracking regression — zero `evolution_*` `call_source` rows since **2026-02-22**. ZERO "save failed" warn logs — INSERT isn't even attempted. Evolution-wide, not paragraph_recombine-specific.
- A4: Display surface audit — confirmed P0/P1/P2 fix list (RunsTable inline sum, getRunCostWithFallback Layer 2, COST_DESCRIPTIONS).
- A5: Decision scoring — Options A/B/D rejected. Recommended combo: G + F + H. Conditional I → C.

**Round 4 (synthesis + decision support)**
- A1: Final synthesis text drafted (now the research doc's High Level Summary).
- A2: Full planning doc revision drafted (now in `_planning.md`).
- A3: llmCallTracking regression — hypotheses 1-5 FALSIFIED. Wiring is structurally correct in main. Most likely cause: stale staging deploy (commit `3e6a7290` may not be deployed). **NOT fixable in this project; recommend separate follow-up project.**
- A4: Length_under root cause — index-0 ratios are 0.50–0.74 (mean 0.67) at temp 1.2. LLM is over-compressing, not just barely missing. Recommended fix combo: **hard char-count directive** (replace "~0.85x" with computed `at least N chars`) + **per-index temperature override** (drop index-0 to ~0.7).
- A5: Cap-sizing implementation sketch — concrete file-by-file deltas for Option F (constant change, schema field, dispatch threading, test updates, doc updates).

### Issues Encountered
- `execution_detail` lacks per-rewrite cost / temperature / status — Round 2 had to infer phase split from invocation `cost_usd` minus Σ slot.spentUsd. Phase 1 of the plan addresses this.
- `llmCallTracking` empty for all 4 invocations — Round 2 couldn't compute LLM-call audit drill-down. Round 3+4 traced the regression but it's broader than this project.

### User Clarifications
- User requested 4 rounds × 5 agents each. Followed the structure faithfully; each round built on prior synthesis.

### Outcomes
- Research doc: comprehensive High Level Summary + Findings + Recommendation + Out-of-scope flag.
- Planning doc: 6-phase revised plan (G → F → H → I → C, plus follow-up flag for the broader llmCallTracking regression).
- Branch + GH issue + skeleton committed (`b06133dd`).

## Phase 1: Observability (G) — PARTIAL (G1-G3, G8, G9 done; G4-G7 + verification deferred)
### Work Done
- **G1** (`ParagraphRecombineAgent.ts`): added per-rewrite `costUsd` via `slotScope.getOwnSpent()` delta around each `slotLlm.complete()` call. Added `temperature` (from ladder index) and `status` enum (`succeeded` | `dropped` | `skipped_slot_abort` | `llm_error`) to rewrites detail. Pre-G1 every `rewrites[i].costUsd === 0` — phase split was impossible to observe.
- **G2** (`ParagraphRecombineAgent.ts`): added per-slot ranking `cost`, `comparisonCount`, `status` enum (`completed` | `self_aborted` | `skipped_insufficient_pool`) via `paragraph_rank` phase-cost delta around the per-slot ranking loop.
- **G3** (`schemas.ts`): extended `slotRecombineExecutionDetailSchema` with the new optional fields. All `.optional()` for back-compat with existing rows.
- **G8** (`ParagraphRecombineAgent.ts:352-354`): threaded `db`, `runId`, `invocationId`, `slotLogger` into the per-slot `createEvolutionLLMClient` call. Pre-G8 the per-slot client was db-less, so `paragraph_rewrite`/`paragraph_rank` calls wrote ZERO `llmCallTracking` rows on staging.
- **G9** (`getRunCostWithFallback.ts`): removed dead Layer 3 (`evolution_run_costs` view was dropped in `20260323000004_drop_legacy_metrics.sql`; queries against it have been erroring silently). Layers 1+2 now cover all cases. Test updated to assert new behavior.

### Deferred for next session
- **G4-G7**: projector-output capture + `estimationErrorPct` finalization + new per-phase rollup metrics (`paragraph_rewrite_estimation_error_pct`, `paragraph_rank_estimation_error_pct`). These require touching `estimateCosts.ts`, `finalization.ts`, `registry.ts` — sizable scope.
- **G10**: staging verification — requires deploy + fresh run.
- **G11**: out-of-scope flag — only fires if G10 verification shows broader regression.

## Phase 2: Cap right-sizing (F) — DONE (F1-F3; F4 bundled with Phase 7)
### Work Done
- **F1** (`ParagraphRecombineAgent.ts:54`): lowered `DEFAULT_PER_INVOCATION_CAP_USD` from `0.4` → `0.05`. Per-slot self-abort floor at 12 slots → $0.00375 (median spend $0.0005 = 13%); pre-final-ranking gate at 0.9 × $0.05 = $0.045 (9× headroom over median invocation spend $0.005). Added inline comment block explaining the rationale.
- **F2** (`schemas.ts`): added `perInvocationCapUsd: z.number().min(0.001).max(0.5).optional()` to `iterationConfigSchema` plus refinement rejecting it on non-paragraph_recombine agent types.
- **F3** (`runIterationLoop.ts:1312-1322`): threaded `iterCfg.perInvocationCapUsd` into the agent input.
- **J1.5 PARTIAL** (`findOrCreateStrategy.ts`): extended `canonicalizeIterationConfig` to emit `perInvocationCapUsd` so it participates in `config_hash`. `maxDispatches` not yet hashed (defers until J1 lands in Phase 6).

## Phase 3: Display fixes (H) — PARTIAL (H1 + test; H2-H4 deferred)
### Work Done
- **H1** (`getRunCostWithFallback.ts:114-138`): added `paragraph_recombine_cost` AND `debate_cost` to Layer 2 sum. Pre-fix any paragraph_recombine-only run with a missing `cost` rollup row would under-report by the full paragraph_recombine spend.
- **Tests** (`getRunCostWithFallback.test.ts`): added two regression cases asserting Layer 2 sum picks up `paragraph_recombine_cost` and `debate_cost`. Updated the prior Layer-3 fall-through test to assert post-G9 behavior (returns 0 with warn instead of Layer 3 query).

### Deferred for next session
- **H2** (`RunsTable.tsx:143-158`): inline "Spent" fallback omits `paragraph_recombine_cost`, `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost`, `debate_cost`.
- **H3** (`EntityMetricsTab.tsx:71-84`): `COST_DESCRIPTIONS` missing entries for these metrics.
- **H4**: fix wrong `cost` description (`"= generation + ranking + seed"`).

## Verification
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npx jest` on affected files: 266 passed, 0 failed ✅

## Next session plan
The deferred work spans:
- Phase 1 G4-G7 (projector instrumentation + per-phase rollup metrics) — ~3-4 files.
- Phase 3 H2-H4 (display fallback + descriptions) — small.
- Phase 6 (J — multi-dispatch refactor) — large, the architectural piece.
- Phase 7 (K — wizard + admin UI surfacing) — depends on J.
- Phase 4-5 (I/C — re-diagnose length_under + fix) — depends on Phase 1 verification.

## Phase 1: Observability — G4–G7 (DONE, second sweep)
### Work Done
- **G4** (`estimateCosts.ts`): refactored `estimateParagraphRecombineCost` to also return `perPhase.{paragraphRewriteCost, paragraphRankCost}` so per-phase projections can be persisted into `execution_detail`.
- **G4** (`ParagraphRecombineAgent.ts`): call the projector at the top of `execute()` with actual knobs + parent length + judge/rewriter models; persist `estimatedTotalCost`, `estimatedTotalCostUpperBound`, plus per-phase split into `execution_detail`.
- **G5**: compute `estimationErrorPct = (actual - estimated) / estimated × 100` at finalization for both top-level and per-phase; persist into the detail returned to `Agent.run()`.
- **G6** (verified, no code change): `computeCostEstimationErrorPct` + `computeEstimatedCost` (finalization.ts:94-130) iterate ALL invocation details agnostic to `agent_name` and pick up `estimationErrorPct` + `estimatedTotalCost`. paragraph_recombine joins automatically.
- **G7** (`finalization.ts`, `registry.ts`, `metricCatalog.ts`, `RunEntity`, `StrategyEntity`, `ExperimentEntity`): new per-phase metrics `paragraph_rewrite_estimation_error_pct`, `paragraph_rank_estimation_error_pct` (run level) + `avg_paragraph_rewrite_estimation_error_pct`, `avg_paragraph_rank_estimation_error_pct` (strategy/experiment level). Mirrored through METRIC_REGISTRY + METRIC_CATALOG + entity classes so the dual-registry parity test passes.
- Updated MetricName union in `evolution/src/lib/metrics/types.ts` with the four new entries.

## Phase 3: Display fixes — H2–H4 (DONE)
### Work Done
- **H2** (`RunsTable.tsx:143-158`): inline "Spent" fallback now sums all 9 per-purpose cost metrics (added `paragraph_recombine_cost`, `evaluation_cost`, `iterative_edit_cost`, `proposer_approver_criteria_cost`, `debate_cost` alongside the existing 4). Pre-fix paragraph_recombine-only runs with missing `cost` rollup would under-report by the full paragraph_recombine spend.
- **H3** (`EntityMetricsTab.tsx:71-84`): expanded `COST_DESCRIPTIONS` to include 7 missing entries (paragraph_recombine, debate, evaluation, iterative_edit, proposer_approver_criteria, reflection costs + their totals).
- **H4** (`EntityMetricsTab.tsx`): fixed the wrong `cost` description (was "= generation + ranking + seed" — factually wrong post Phase-6).

## Phase 4: Re-diagnose length_under — I3 + I4 (DONE)
### Work Done
- **I3a (`buildParagraphRewritePrompt.ts`)**: replaced the vague "~0.85x the original length" directive with a HARD CHARACTER COUNT computed from `paragraphText.length`. Rule 3 now reads: "Your rewrite MUST be at least N characters and at most M characters" where N = ceil(0.85 × original) and M = floor(1.20 × original). LLMs follow concrete char counts far better than ratios. Pre-I3a the post-fix invocations showed index-0 ratios of 0.50–0.74 (mean 0.67) — well below the 0.8 validator floor.
- **I3b (`ParagraphRecombineAgent.ts`)**: per-index temperature override — added `PARAGRAPH_REWRITE_INDEX_0_TEMP = 0.7` constant; index-0 now uses 0.7 (length compliance for the "tighten" directive); index-1+ continues to walk the 1.2–2.0 diversity ladder. New schedule for M=3: `[0.7, 1.2, 2.0]`. For M=2: `[0.7, 2.0]`. For M=1: `0.7`.
- **I4**: documented chosen approach (a + b combo) in the planning doc.

## Phase 5: Drop-rate fix — C1 (DONE)
### Work Done
- **C1**: combined I3a (hard char-count) + I3b (per-index temp override). Lands together as a single bundle since they're complementary. Validation: pinned temperature tests updated; all 31 paragraph agent tests pass.

## Phase 6: Multi-dispatch refactor — J1, J1.5, J2, J4, J5 (DONE)
### Work Done
- **J1** (`schemas.ts`): added `maxDispatches: z.number().int().min(1).max(10).optional()` to `iterationConfigSchema` with a paragraph_recombine-only refinement. Default behavior (unset → K=1) preserves single-dispatch back-compat exactly.
- **J1.5** (`findOrCreateStrategy.ts`): extended `canonicalizeIterationConfig` to emit `maxDispatches` (alongside the previously-added `perInvocationCapUsd`) so two strategies that differ only in maxDispatches don't collide on `config_hash`.
- **J2**: reused the existing strategy-level budget-floor fields (`minBudgetAfter*Fraction`, `minBudgetAfter*AgentMultiple`) — no new schema fields needed. Both fraction-of-budget AND multiple-of-agent-cost floor methods are supported out of the box via `budgetFloorResolvers.ts`.
- **J4** (`runIterationLoop.ts` paragraph_recombine branch): replaced the single-`resolveParent` + single-`dispatchOneAgent` flow with a parallel-batch + sequential-top-up loop modeled on the generate-iteration RUNTIME pattern. Key elements:
  1. Eligible parent set: filter pool via `qualityCutoff` + `fromArena` exclusion.
  2. Seeded pre-shuffle for distinct-parent enforcement (no `resolveParent` signature change needed).
  3. Parallel batch sizing: `min(DISPATCH_SAFETY_CAP, floor(availBudget / projector.expected), maxDispatches, eligibleParents.length)`.
  4. `Promise.allSettled` parallel dispatch.
  5. Measure `actualAvgCostPerAgent` from iter-tracker spend delta.
  6. Sequential top-up gated via `resolveSequentialFloor` (matches generate runtime convention).
  7. Single `MergeRatingsAgent.run()` over all surfaced variants' match histories.
- **J5**: inlined the loop (~80 LOC). No new helper file needed.
- **J6/J7/J8**: agent reentrancy, scope nesting, syncToArena safety all hold by construction (per-invocation AgentCostScope, distinct slotTopicId per parent). Confirmed at the code-mapping level; integration test will validate at runtime once Phase 9 verification fires.

## Phase 7: Wizard + admin UI — K1, K2, K7 (DONE)
### Work Done
- **K1** (`projectDispatchPlan.ts:458-507`): extended paragraph_recombine projector branch to compute `dispatchCount` via parallel-floor + sequential-floor math (mirrors generate iteration's projector pattern). For maxDispatches=1 (default), collapses to exact pre-J behavior. For maxDispatches>1: projects `dispatchCount = parallelN`, `expectedTotalDispatch` includes top-up estimate, `effectiveCap ∈ {'budget','safety_cap','eligibility'}`.
- **K2**: `EstPerAgentValue.paragraphRecombine` semantic was already per-invocation; K1's `dispatchCount > 1` flows through to the existing `DispatchPlanView.tsx:84` render path multiplying by dispatch count.
- **K7** (`SlotsTab.tsx:138-139`): changed `budget: $X spent: $Y` → `cap: $X spent: $Y` with a tooltip explaining the cap is a safety rail, not a target. Collapses the user's "1% spent" perception.

### Deferred for follow-up (out-of-scope follow-up project)
- **G10/G11**: staging verification — requires deploy + fresh paragraph_recombine run.
- **K3-K6**: wizard preview rendering breakdown chips + Cost Estimates tab paragraph_recombine branch + admin UI form panel for budget floors. Data plumbing (K1 + K7) ships now; UI components are additive and benefit from larger design work.
- **F4**: optional projector output annotation for wizard "expected $X / cap $Y" side-by-side display.
- **J3**: optional per-iteration budget-floor overrides on IterationConfig (vs current strategy-level). Defer if scope-creep.
- **J9**: manual staging multi-dispatch verification — requires deploy.
- **K8**: wizard preview manual verification — requires deploy.

## Final validation (this session)
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm test` (full repo): **6910 / 6910 passing**, 16 skipped, 0 failed ✅
- `evolution/src` tests: **2955 / 2955 passing**, 3 skipped ✅

## Phase 4: Re-diagnose length_under (I)
### Work Done
(Pending.)

## Phase 5: Drop-rate fix (C, CONDITIONAL on Phase 4)
### Work Done
(Pending.)

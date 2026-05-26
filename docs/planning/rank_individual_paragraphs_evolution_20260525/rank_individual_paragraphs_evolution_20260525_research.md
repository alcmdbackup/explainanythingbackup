# rank_individual_paragraphs_evolution_20260525 Research

## Problem Statement
Improve articles by (1) decomposing the parent article into paragraphs, (2) generating M alternative rewrites per paragraph slot, (3) pairwise-ranking the rewrites per slot via the existing Elo+OpenSkill machinery, (4) selecting the winning rewrite per slot and recombining them into a single variant. This adds paragraph-level granularity to a pipeline that today only ranks whole articles, in the hope of capturing local-optimum gains that whole-article ranking conflates away.

## Requirements (from GH Issue #NNN)
Use the Problem Statement as the requirements anchor; concrete implementation choices will be discussed live in `_planning.md` before being finalized.

## High Level Summary

**What the pipeline already gives us for free (~80% of the work):**
- The ranking + pairwise-comparison machinery (`rankNewVariant`, `compareWithBiasMitigation`, `run2PassReversal`, `ComparisonCache`, `Rating {elo, uncertainty}`) is **fully content-agnostic** — comparison prompts make no article-shape assumption, hashes are content-based, ratings are pure numbers. We can rank paragraphs pairwise without changing one line of comparison code.
- **N-parent (≥3) variants are fully supported** in DB schema (`parent_variant_ids: UUID[]` with `MAX_PARENT_IDS = 10`), in-memory types (`Variant.parentIds: string[]`), lineage walk RPC, and admin UI (`+N more` chip on `VariantParentBadge`). A recombined variant with one parent per paragraph donor is structurally legal today.
- **Paragraph extraction** exists (`extractParagraphs` in `enforceVariantFormat.ts`) and **sentence-level segmentation** exists (`sentenceOverlap.ts` with Levenshtein ≤2 near-match). Multi-pass paragraph→sentence→word diffing exists (`markdownASTdiff.ts`).
- **Best template to fork: `ProposerApproverCriteriaGenerateAgent`** (`evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts`). Single-cycle, multi-LLM-call wrapper with the I1/I2/I3 invariants (direct llm usage, cost snapshots before each helper, partial-detail-on-throw) already established. Its 5-cost-layer cost-stack pattern + `cycles[0].{proposeCostUsd, approveForwardCostUsd, approveMirrorCostUsd}` execution_detail shape is the closest cousin to what we need (per-paragraph rewrite + per-paragraph rank costs).

**What we need to build new (~20% of the work):**
- `extractParagraphsWithRanges(text)` — returns `{paragraphIndex, originalText, startByte, endByte}` tuples. Today's `extractParagraphs` discards byte offsets; reassembly cannot map paragraphs back to source positions without this.
- A "section-tree walker" using remark-parse MDAST to enforce heading-paragraph association (avoids stranded `###` sub-headings when recombined).
- The new agent class itself (`ParagraphRecombineAgent`) — fork ProposerApprover, replace single propose-call with N×M per-paragraph rewrite calls, replace mirror-approver with per-slot ranking.
- Two new cost metrics (`paragraph_rewrite`/`paragraph_rank` → umbrella `paragraph_recombine_cost`) + a new execution_detail Zod schema for the per-paragraph rewrite/ranking breakdown.

**The hard-look risks (failure modes we WILL hit):**
1. **Heading drift / stranded sub-headings** — `extractParagraphs` strips heading lines, so a paragraph from a source variant under `## History` may get spliced under the parent's `## Background` with no provenance check. The recombined article will pass `validateFormat` (which only checks counts) but be semantically broken.
2. **Cross-paragraph coherence loss** — rewriting paragraph N in isolation deletes transitions ("However,", "Therefore,") and breaks paragraph-to-paragraph flow. Prior project `updated_criteria_agent_20260505` added an explicit "preserve transitions between paragraphs" directive to its single-pass agent precisely because this BREAKS in practice. We MUST pass `{previousParagraph, currentParagraph, nextParagraph}` context to each rewrite call.
3. **Sentence-count tolerance cliff** — `validateFormat` allows up to 25% short paragraphs (`>` not `≥`, so 25% exactly fails). For small articles the boundary is brutal: 3-paragraph article tolerates 0 short paragraphs (1/3 ≈ 33% > 25%); 4-paragraph article tolerates 1 (1/4 = 25%, fails at boundary). Recombination changes paragraph counts — variants will silently get DROPPED.
4. **Cost explosion** — realistic envelope: 12 paragraphs × 4 rewrites + 12 slots × ~24 pairwise judge calls = **~336 LLM calls per recombined variant**, ~4× a vanilla `generate` iteration. With `gpt-4.1-nano` rewriter + `qwen-2.5-7b` judge: **~$0.0136 per recombined variant**; with `gpt-4.1-mini`: **~$0.0358**. The **default $0.05 per-run budget supports only 1–3 recombined variants** before exhaustion. Need a per-invocation budget cap (~$0.40 like Debate) + pre-final-ranking gate at 0.9× cap.
5. **Rewrite disasters cohort** — prior project `understand_critera_agent_performance_evolution_20260503` measured n=22 variants with 0-20% sentence verbatim overlap → mean -69 Elo. Paragraph-isolated rewriting will likely produce a higher rate of this failure mode than article-level rewriting did. We need both observational metrics (`paragraph_sentence_verbatim_ratio`) and active gates (drop rewrites with verbatim ratio < 30% before ranking).

## Documents Read
- `docs/docs_overall/getting_started.md` — repo map
- `docs/docs_overall/architecture.md` — service-layer + Server Actions pattern
- `docs/docs_overall/project_workflow.md` — research/plan/execute/wrap-up
- `evolution/docs/README.md` — V2 pipeline orientation
- `evolution/docs/architecture.md` — `evolveArticle()` iteration loop, 3 agent classes, dispatch, kill, convergence, budget
- `evolution/docs/data_model.md` — `evolution_variants` schema, `parent_variant_ids: UUID[]`, `MAX_PARENT_IDS=10`, run summary V3
- `evolution/docs/rating_and_comparison.md` — Elo with uncertainty (OpenSkill internal), `rankPool`, 2-pass reversal, ComparisonCache, parseWinner
- `evolution/docs/criteria_agents.md` — **load-bearing failure-mode analysis**: rewrite-disaster cohort (n=22, -69 Elo), light-edit left-tail, H1/H2 hypotheses, SURGICAL EDITS ONLY block
- `evolution/docs/agents/overview.md` — 8 agent types, `Agent.run()` template, AgentCostScope (B012), DETAIL_VIEW_CONFIGS pattern
- `evolution/docs/editing_agents.md` — IterativeEditingAgent invariants I1/I2/I3, cost knobs, drift recovery
- `evolution/docs/strategies_and_experiments.md` — StrategyConfig, iterationConfigs, bootstrap CIs, run summary
- `evolution/docs/metrics.md` — METRIC_REGISTRY, propagation (sum/avg/bootstrap_mean), stale trigger cascade, attribution metrics
- `evolution/docs/cost_optimization.md` — V2CostTracker, per-iteration budget, AgentName labels, OUTPUT_TOKEN_ESTIMATES
- `evolution/docs/arena.md` — `synced_to_arena` flag, `loadArenaEntries`/`syncToArena`, fromArena filter
- `evolution/docs/visualization.md` — 17 admin pages, MetricGrid, ConfigDrivenDetailRenderer, color palette
- `evolution/docs/entities.md` — entity registry, dual-registry parity, FK cascade tree
- `evolution/docs/reference.md` — file-by-file inventory, kill-switch env vars, RLS, RPCs
- `evolution/docs/variant_lineage.md` — `parent_variant_ids[]` semantics, `get_variant_full_chain` walks `[1]` primary, attribution dimension hook
- `evolution/docs/multi_iteration_strategies.md` — iterationConfig schema, dispatch projector, kill-switch env-flag pattern
- `evolution/docs/evolution_metrics.md` — reflection_cost / iterative_edit_cost / evaluation_cost rollup patterns
- `docs/feature_deep_dives/testing_setup.md` — 4-tier testing, evolution-test-helpers, integration suites (~31), E2E specs (~58)

## Code Files Read
**Round 1 (foundation):**
- `evolution/src/lib/shared/enforceVariantFormat.ts` — `extractParagraphs`, `validateFormat`, `countShortParagraphs`, format-rule check sequence
- `evolution/src/lib/shared/sentenceOverlap.ts` — `extractSentences`, `sentenceVerbatimOverlap`, capped Levenshtein
- `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` — multi-pass paragraph→sentence→word diff, `Intl.Segmenter` sentence tokenization, `alignSentencesBySimilarity`
- `evolution/src/lib/core/agents/generateFromPreviousArticle.ts` — canonical GFPA
- `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts` — wrapper precedent
- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` — combined-call wrapper precedent
- `evolution/src/lib/core/agents/proposerApproverCriteriaGenerate.ts` — **best template to fork**: I1/I2/I3 invariants, 5-layer cost stack, `cycles[0]` execution_detail
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — sub-article granularity precedent, byte-range edits
- `evolution/src/lib/core/agents/debate/DebateAgent.ts` — **multi-parent precedent**: `parentIds = [higher, lower]` sorted by Elo, I4 LLM-client proxy
- `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` — right-to-left splice primitive (reusable for paragraph reassembly)
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` / `rankNewVariant.ts` — `computeTop15Cutoff`, B012 AgentCostScope invariant, fully content-agnostic
- `evolution/src/lib/shared/computeRatings.ts` — `buildComparisonPrompt`, `parseWinner` (no article-shape assumption), `compareWithBiasMitigation`, `run2PassReversal`, `ComparisonCache` (order-invariant content-hash key, identical-text sentinel B029)
- `evolution/src/lib/shared/rating.ts` — `createRating`, `updateRating`, `dbToRating`/`ratingToDb` boundary helpers
- `evolution/src/lib/types.ts` — `Variant.parentIds: string[]` unbounded
- `evolution/src/lib/shared/textVariationFactory.ts` — `createVariant({parentIds})`
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — `MAX_PARENT_IDS=10`, `.filter((v) => !v.fromArena)` (safe for N≥3 parents)
- `evolution/src/lib/core/tactics/index.ts` — `MARKER_TACTICS`, `TACTIC_PALETTE`
- `evolution/src/components/evolution/variant/VariantParentBadge.tsx` — `+N more` chip (UI ready for N-parent)

**Round 2 (surface area):**
- `evolution/src/lib/schemas.ts` — `iterationAgentTypeEnum` (lines 508–518), per-agent superRefines (lines 649–729)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — `dispatchOneAgent` switch (lines 512–620), kill-switch checks
- `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` — `EstPerAgentValue` interface (lines 103–124), `DispatchPlanOptions`, `DISPATCH_SAFETY_CAP=100`
- `src/app/admin/evolution/strategies/new/page.tsx` — `IterationRow` type, per-type controls, `validateCriteriaIds` hook pattern
- `evolution/src/lib/core/agentNames.ts` — `AgentName` typed union (lines 13–41), `COST_METRIC_BY_AGENT` (lines 53–78), `OUTPUT_TOKEN_ESTIMATES`
- `evolution/src/lib/core/agents/index.ts` — barrel for side-effect ATTRIBUTION_EXTRACTORS registration
- `evolution/src/lib/core/startupAssertions.ts` — `TS_PHASES_REFRESH_CALIBRATION` + `TS_PHASES_CALIBRATION_LOADER` sets
- `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` — `CalibrationRow['phase']` union type
- `evolution/src/lib/metrics/registry.ts` — `RUN_METRIC_REGISTRY`, `SHARED_PROPAGATION_DEFS` (`total_X_cost` + `avg_X_cost_per_run` pattern)
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — cost write via `writeMetricMax`, `COST_METRIC_BY_AGENT` lookup
- `evolution/src/lib/pipeline/infra/estimateCosts.ts` — `estimateGenerationCost`, `estimateRankingCost`, `estimateEvaluateAndSuggestCost`, `estimateProposerApproverCriteriaCost`
- `evolution/src/lib/metrics/computations/sentenceOverlapMetrics.ts` — closest-cousin per-variant percentile aggregation pattern
- `supabase/migrations/*stale*` — `mark_elo_metrics_stale()` whitelist (SQL migration needed if new metrics depend on Elo)

**Round 3 (design + tests):**
- `evolution/src/lib/core/detailViewConfigs.ts` — `DETAIL_VIEW_CONFIGS` per-agent `DetailFieldDef[]`, `keyFilter` slicing
- `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` — `buildTabs()` per-agent tab layouts (5–6 tabs for wrappers)
- `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx` — per-phase bar colors (`REFLECTION_COLOR`, `DEBATE_COLOR`, `CRITERIA_APPROVER_FORWARD_COLOR`)
- `evolution/src/lib/core/agents/editing/validateEditGroups.ts` — length-cap + flow-guardrail + Jaccard-similarity gates (precedent for our drop conditions)
- `evolution/src/lib/core/agents/singlePassEvaluateCriteriaAndGenerate.ts` — 3-directive guardrails (Length/Redundancy/Flow), SURGICAL EDITS ONLY block for high-Elo parents
- Various test files: `proposerApproverCriteriaGenerate.test.ts` (~558 lines), `evaluateCriteriaThenGenerateFromPreviousArticle.test.ts` (31 cases), `IterativeEditingAgent.test.ts` (14 cases), `DebateAgent.test.ts` (39 cases), `estimateCosts.test.ts` (27 cases), `projectDispatchPlan.test.ts` (37 cases)

## Key Findings

1. **Reuse-as-is (no changes needed):** comparison primitives, rating math, comparison cache, multi-parent lineage UI (`+N more` chip), lineage walker RPC, `MARKER_TACTICS` registration pattern, `Variant.parentIds: string[]`, `createVariant` factory, format-validator kill-switch (`FORMAT_VALIDATION_MODE=warn` for dev).

2. **Template to fork:** `ProposerApproverCriteriaGenerateAgent`. Same single-cycle multi-LLM-call shape with established I1/I2/I3 invariants. Extension shape: replace `proposer` call with N×M per-paragraph rewrite calls; replace `forward/mirror approver` calls with per-slot pairwise ranking via existing `rankNewVariant` per slot; replace `applyAcceptedGroups` with paragraph reassembly via byte-range splice.

3. **Code surfaces to extend (~17 files for agent registration):**
   - `evolution/src/lib/schemas.ts` (enum + superRefine + new `execution_detail` schema)
   - `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (new dispatch branch + kill-switch check)
   - `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` (new `EstPerAgentValue` peer field + cost projection branch)
   - `src/app/admin/evolution/strategies/new/page.tsx` (new per-iteration controls)
   - `evolution/src/lib/core/agentNames.ts` (2 new labels + COST_METRIC_BY_AGENT mapping)
   - `evolution/src/lib/core/agents/index.ts` (barrel re-export)
   - `evolution/src/lib/core/startupAssertions.ts` + `costCalibrationLoader.ts` (phase union + sets)
   - 1 SQL migration for `evolution_cost_calibration_phase_allowed` CHECK constraint
   - `evolution/src/lib/metrics/registry.ts` (1 run metric + 2 propagation rules for cost; more for paragraph_recombine-specific observational metrics)
   - `evolution/src/lib/pipeline/infra/estimateCosts.ts` (new `estimateParagraphRecombineCost`)
   - `evolution/src/lib/core/detailViewConfigs.ts` + `InvocationDetailContent.tsx` + `InvocationTimelineTab.tsx` (admin UI: 4 required surfaces)
   - `evolution/src/lib/core/tactics/index.ts` (1 marker tactic + 1 TACTIC_PALETTE color)

4. **Cost envelope (concrete numbers):**
   - Per recombined variant with `gpt-4.1-nano` rewriter + `qwen-2.5-7b-instruct` judge: **~$0.0136** (≈336 LLM calls). 
   - With `gpt-4.1-mini` rewriter: **~$0.0358** per variant.
   - Default $0.05 per-run budget supports only 1–3 recombined variants. We need a **per-invocation cap (~$0.40)** + pre-final-ranking gate at 0.9× cap, mirroring DebateAgent.
   - Knobs: `rewritesPerParagraph` (default 3, range 1–8), `maxComparisonsPerParagraph` (default 6), `maxParagraphsPerInvocation` (default 12–15), `rewriteModel` (separate from `generationModel`), 2 env kill-switches.

5. **Reassembly gaps (must build new):**
   - `extractParagraphsWithRanges(text)` returning `{paragraphIndex, originalText, startByte, endByte}` — `extractParagraphs` discards offsets today (verified via grep — no `startByte` / `paragraphRange` helpers exist).
   - Section-tree walker on remark-parse MDAST to enforce heading-paragraph association (avoid stranded `###`).
   - Reuse `applyAcceptedGroups` (right-to-left splice by `range.start` descending) for the splice primitive — already a primitive.

6. **Failure modes from prior projects:**
   - **Rewrite disasters**: 0–20% sentence verbatim → mean -69 Elo (n=22 in criteria_agents). Mitigate with active gate (`paragraph_sentence_verbatim_ratio < 0.30` → drop) AND observational metric.
   - **Light-edit no-op**: rewrite too similar to original (Jaccard ≥ 0.95) → drop, mirroring DebateAgent's synthesis-no-op gate.
   - **Cross-paragraph transition loss**: load-bearing — `updated_criteria_agent_20260505` added "preserve transitions" directive precisely for this. **Pass `{previousParagraph, currentParagraph, nextParagraph}` context to every rewrite call.**
   - **Length explosion**: cap `len(rewritten) / len(original) ≤ 1.20` (paragraph analog of proposer/approver's 1.10 article-level cap).
   - **Format-validation cliff on small articles**: 3-paragraph article tolerates 0 short paragraphs. May need a separate validation policy for recombined output or larger paragraph-floor minimum.

7. **5 prompt guardrail directives to add to the rewrite prompt** (informed by `singlePassEvaluateCriteriaAndGenerate.ts` + the SURGICAL EDITS block):
   - Preserve the paragraph's primary claim and examples (no topic substitution).
   - Keep sentence count within ±20% of original.
   - Preserve transition phrases at paragraph start (`However,`, `Therefore,`, etc.).
   - Prefer additive edits over wholesale rewrites.
   - No new ideas/examples not already implied by the paragraph + neighbor context.

8. **Test scope:** ~2 new test files + extensions to ~5 existing suites → **~80–100 new test cases** across unit / schema / dispatch / cost-estimator / integration / E2E. Mock LLM (`v2MockLlm.ts`) already supports per-label responses — just add `paragraph_rewrite` + `paragraph_rank` to `labelResponses`. New helper needed: `createMockParagraphRecombineInvocation(runId, config)`.

## Open Questions

1. **Decompose granularity** — paragraph-only (per `extractParagraphs`), or sentence-level for fine control? Recommend paragraph-only for v1 (sentence-level explodes the LLM-call count further).

2. **Neighbor context window** — pass `{prev, current, next}` (3 paragraphs) or larger context (whole article + paragraph index marker)? Trade-off: more context = more cost + better coherence; less context = cheaper + worse transitions. Likely answer: 3-paragraph window with the rewrite call passing a section heading and the article's H1 title for top-level orientation.

3. **Per-paragraph ranking depth** — pairwise-rank all M rewrites + original (M+1 candidates per slot)? Or just pick best via single LLM "which of these M paragraphs is best" call? Single-call would be ~M× cheaper at the cost of losing Elo / uncertainty per-slot. Likely: pairwise ranking for the first iteration with this agent, fall back to single-call if cost/Elo trade-off doesn't pan out.

4. **Recombined variant lineage** — `parentIds = [originalArticleId, donor1, donor2, ..., donorN]`? With original as `parentIds[0]` so `elo_delta_vs_parent` compares to the article being improved (matching DebateAgent's convention). Verify in planning.

5. **Iteration eligibility** — paragraph_recombine likely can't be the first iteration (needs a pool of ≥1 variant to draw "donors" from). Mirror DebateAgent's `canBeFirstIteration = false` invariant. Or does it operate on the seed article alone in iter 0?

6. **Recombined output passes whole-article ranking?** — after we emit the recombined variant, should it go through `rankNewVariant` against the existing pool (matching ProposerApprover/Editing pattern, gated by `EVOLUTION_PARAGRAPH_RECOMBINE_RANK_ENABLED`)? Probably yes — it lets paragraph_recombine compete in the arena.

7. **Validation tolerance for recombined output** — `FORMAT_VALIDATION_MODE=warn` for the recombined output specifically, while remaining `reject` for vanilla generates? Or extend `validateFormat` with a more lenient mode for recombined variants? Or pre-validate paragraphs individually so we don't hit the 25%-short cliff on small articles?

8. **Section-tree extraction** — required for v1 (full heading-paragraph mapping via remark-parse MDAST)? Or v1 punts to "rewrite within paragraph only, parent owns headings" and we add MDAST walker in v2?

9. **Cost-knob defaults** — proposed: `rewritesPerParagraph=3`, `maxComparisonsPerParagraph=6`, `maxParagraphsPerInvocation=12`, per-invocation cap=$0.40. Need to validate by mock-running once we have an implementation.

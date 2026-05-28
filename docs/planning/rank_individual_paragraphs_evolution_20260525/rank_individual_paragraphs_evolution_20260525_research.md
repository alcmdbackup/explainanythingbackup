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

## Resolved Questions

All 9 open questions from the initial research rounds have been answered during the planning walkthrough discussions and locked in as design decisions (D1–D20 in the planning doc).

| # | Question | Resolution | Decision |
|---|---|---|---|
| 1 | Decompose granularity | Paragraph-level (`\n\n` split with heading filtering) | D1 |
| 2 | Neighbor context window | Minimal — H1 + paragraph only (transition breakage observed-not-mitigated; metric in v1.5) | D2 |
| 3 | Per-paragraph ranking depth | Pairwise Elo tournament via existing `rankNewVariant` (sequential within slot — see "Iteration-time discoveries" below) | D3 |
| 4 | Recombined variant lineage | `parent_variant_ids = [originalParent]` only — slot winners stored in `execution_detail.slots[i].winnerSlotVariantId` to avoid `MAX_PARENT_IDS=10` truncation on the default 12-paragraph config | D4 (revised iter-1) |
| 5 | Iteration eligibility | CAN be first iteration; when first uses `sourceMode: 'seed'`, when non-first can use `'seed'` or `'pool'` | D5 (revised mid-discussion) |
| 6 | Recombined output ranking | Always-on, no kill switch — recombined variant goes through `rankNewVariant` against the run's pool | D6 |
| 7 | Validation tolerance | Standard `validateFormat` (reject) + per-paragraph pre-validate so bad rewrites drop early; symmetric ±10% length gate | D7 |
| 8 | Section-tree extraction | Not needed — paragraph_recombine rewrites in place against ONE parent, so heading structure stays intact; pure regex `\n\n` split is enough | D8 |
| 9 | Cost-knob defaults | `rewritesPerParagraph=3`, `maxComparisonsPerParagraph=6`, `maxParagraphsPerInvocation=12`, perInvocationCap=$0.40, perSlotBudget=$0.033 with 90% self-abort | D9 + D16 |

Eight additional decisions emerged from later discussions: D10 (arena reuse for per-slot leaderboards), D11 (subagent model: stay with I1 single-invocation-row pattern), D12 (3-guardrail rewrite prompt), D13 (`variant_kind` + `prompt_kind` enum columns), D14 (future-proof for sentence/section granularities), D15 (top-20-Elo pool cap + warn-log), D17 (extract `ArenaLeaderboardTable` into shared component), D18 (fully parallel slot+rewrite execution), D19 (`V8.P3.R1` hierarchical naming), D20 (per-invocation contribution visibility via highlight/filter props).

## Iteration-time discoveries (4-round plan review)

The plan went through four iterations of multi-agent plan-review. Each iteration uncovered code-level discoveries that the initial 3-round research missed. Captured here so the research doc reflects actual current understanding:

### Function signatures (verified against source)

- **`loadArenaEntries(promptId, supabase, excludeId?)`** — lives in `evolution/src/lib/pipeline/setup/buildRunContext.ts` (NOT `pipeline/arena.ts`). Existing positional `supabase` argument was almost lost to a hand-wavy "opts object" proposal in the initial plan draft.
- **`syncToArena(runId, promptId, pool, ratings, matchHistory, supabase, isSeeded, logger?)`** — actual 8-arg signature in `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (NOT `pipeline/arena.ts`). Initial plan draft had a wrong 5-arg form.
- **`MergeRatingsAgent`'s arena_comparisons row construction** is at `evolution/src/lib/core/agents/MergeRatingsAgent.ts:277-334`. It writes `prompt_id: ctx.promptId ?? null` (line 295) where `ctx.promptId` is the run's article-level promptId — load-bearing for the next finding.
- **`evolution_prompts.title → name` rename** in `20260324000001_entity_evolution_phase0.sql`. The column for the topic name is `name`, but there's ALSO a separate `prompt` column for the natural-language prompt text. For paragraph topics we use both columns (identifier written to both; partial unique index on `prompt`).

### sync_to_arena RPC's `p_matches` is deprecated (`20260331000002`)

Major iter-2 finding. The RPC explicitly ignores `p_matches`:

```sql
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_prompt_id UUID,
  p_run_id UUID,
  p_entries JSONB,
  p_matches JSONB,             -- DEPRECATED: ignored. Match rows are written by MergeRatingsAgent.
  p_arena_updates JSONB DEFAULT '[]'::JSONB
)
```

Match rows for `evolution_arena_comparisons` are SOLELY written by `MergeRatingsAgent` (Critical Fix J). This forced a redesign: paragraph_recombine cannot rely on `syncToArena` to persist per-slot matches because `MergeRatingsAgent.ctx.promptId` is the run's article-level promptId, not the slot's topic id. Result: new `persistSlotMatches(db, slotTopicId, runId, invocationId, iteration, slotMatches, beforeAfterRatings)` helper added to the plan (Phase 3) — mirrors `MergeRatingsAgent.ts:277-334`'s row construction but parameterized on `slotTopicId`.

### V2Match has no rating fields

`v2MatchSchema` (`evolution/src/lib/schemas.ts:912-919`) carries only `{winnerId, loserId, result, confidence, judgeModel, reversed}`. The before/after rating snapshots needed for `evolution_arena_comparisons.entry_a_mu_before/after` etc. live in `rankResult.detail.comparisons[]` (`rankSingleVariant.ts:51-72`) as `Rating = {elo, uncertainty}` (Elo-scale). The new `persistSlotMatches` helper must walk the detail records, build a `Map<matchKey, { aBefore, aAfter, bBefore, bAfter }>`, and call `ratingToDb()` inline to convert each Rating to `{mu, sigma, elo_score}` for the DB-scale columns.

### Variant schema needs new optional fields

`agent_name` and `variant_kind` are added on the DB column side via D13 migrations, but the runtime path from `Variant` → `syncToArena.newEntries.map(...)` → JSONB → RPC INSERT requires the `Variant` type itself to carry `agentName?` and `variantKind?` so the constructor at `persistRunResults.ts:628-643` can emit them in the JSONB entry payload. Without this TS-side extension, the extended RPC's new optional fields would always receive defaults.

### MergeRatingsInput.iterationType enum needs extension

`mergeRatingsInputSchema.iterationType` and `mergeRatingsExecutionDetailSchema.iterationType` (both in `evolution/src/lib/schemas.ts` ~lines 1975, 2033) are z.enum unions that must accept `'paragraph_recombine'` because post-emit ranking flows through MergeRatingsAgent which Zod-validates the iterationType from the iteration's agentType.

### No unique constraint on `evolution_prompts` topic columns

Grep across all migrations confirms there is NO unique constraint on `evolution_prompts.prompt` or `.name`. The arena.md doc mentions "UNIQUE (case-insensitive)" but that's stale. The plan adds a partial unique index `uq_evolution_prompts_paragraph_topic ON evolution_prompts(prompt) WHERE prompt_kind = 'paragraph'` in a new Phase 1 migration — scoped to paragraph topics so article-topic duplicate behavior stays unchanged.

### MAX_PARENT_IDS=10 truncates the default 12-paragraph config

Confirmed in `persistRunResults.ts:28-47`: `const MAX_PARENT_IDS = 10; const truncated = filtered.slice(0, MAX_PARENT_IDS);`. The initial D4 proposal stored slot winners as additional entries in `parent_variant_ids` — would have silently truncated for the default knobs. Revised D4: single-parent column `[originalParent]` only; slot winners moved to `execution_detail.slots[i].winnerSlotVariantId` (no truncation cap, fully queryable, lineage UI reads the array via "Recombined from N slots" badge).

### Within-slot ranking must be SEQUENTIAL

`rankNewVariant` mutates `localPool`/`localRatings`/`localMatchCounts`/`completedPairs` in place (`rankNewVariant.ts:66-67, 82-83`). D18's "fully parallel" framing applies to CROSS-slot dispatch only — WITHIN a slot the M rewrites' `rankNewVariant` calls must run sequentially against the slot's own local maps. Otherwise concurrent mutation would corrupt rankings.

### v2MockLlm hardcodes `if (label === 'ranking')` for pair routing

Confirmed in `evolution/src/testing/v2MockLlm.ts`. Initial plan draft introduced a new `'paragraph_rank'` AgentName label that would have bypassed the mock's pair-routing path, breaking test infrastructure. Revised plan reuses the existing `'ranking'` label for per-slot ranking calls; per-purpose cost attribution still works correctly because the call is made under the slot's `slotScope` which routes to `paragraph_recombine_cost` via the AgentCostScope intercept path.

### Phase 4 syncToArena-before-persistSlotMatches ordering

Eliminates orphan-match window: if persistSlotMatches were called first and syncToArena failed, the match rows would reference rewrite variant_ids that aren't yet in `evolution_variants`. With the corrected order, syncToArena establishes the rows first, then matches are persisted that reference them. Additional guard: on syncToArena failure for a slot, persistSlotMatches is SKIPPED entirely and the slot falls back to the original-paragraph variant.

## Additional code files read during plan review

Beyond the original Round 1–3 reads, the 4-iteration plan-review process inspected these additional code paths:

- `evolution/src/lib/pipeline/setup/buildRunContext.ts:30-81` — actual `loadArenaEntries` implementation + sort behavior (no ORDER BY in the existing query; `mu` vs `elo_score` semantics)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:23-51` — `MAX_PARENT_IDS=10` constant + truncation behavior in `buildParentColumns`
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts:600-700` — actual `syncToArena` 8-arg signature, retry-once semantics, fromArena filtering, RPC call site
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts:277-334` — bulk-INSERT pattern for `evolution_arena_comparisons` (B122 fix: `prompt_id` set at INSERT, not backfilled), the row-shape we now mirror in `persistSlotMatches`
- `evolution/src/services/arenaActions.ts:177-322` — `getArenaTopicDetailAction`, `getArenaEntriesAction`, `getArenaComparisonsAction` all exist (confirmed reviewer was wrong about `getArenaComparisonsAction` not existing)
- `evolution/src/testing/v2MockLlm.ts` — `if (label === 'ranking')` pair-routing path; `labelResponses` map for direct overrides
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` — RLS posture for evolution tables, table list
- `supabase/migrations/20260322000007_evolution_prod_convergence.sql` — original sync_to_arena RPC (writes p_matches)
- `supabase/migrations/20260327000001_sync_to_arena_arena_updates.sql` — sync_to_arena gains p_arena_updates
- `supabase/migrations/20260324000001_entity_evolution_phase0.sql` — `evolution_prompts.title → name` rename
- `supabase/migrations/20260329000001_add_evolution_constraints.sql` — status-enum CHECK constraints (no unique constraint on `prompt` or `name` found)
- `supabase/migrations/20260331000002_sync_to_arena_in_run_matches.sql` — RPC p_matches DEPRECATED; MergeRatingsAgent becomes sole writer
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts:51-72` — `RankSingleVariantComparisonRecord` shape (before/after Rating snapshots keyed by `(round, opponentId)`)
- `evolution/src/lib/schemas.ts:912-919, ~1975, ~2033` — `v2MatchSchema`, `mergeRatingsInputSchema.iterationType`, `mergeRatingsExecutionDetailSchema.iterationType`

## Confidence

The plan-review process confirmed the original ~80%-reusable / ~20%-build-new shape from the High Level Summary, but the "build new" surface area grew during iterations:
- **+1 SQL migration**: partial unique index on `evolution_prompts.prompt` for paragraph topics (didn't anticipate the missing constraint)
- **+1 SQL migration**: extend `sync_to_arena` RPC to read `agent_name`+`variant_kind` from JSONB (didn't anticipate the RPC stripped these)
- **+1 helper**: `persistSlotMatches` (didn't anticipate `sync_to_arena.p_matches` was deprecated)
- **+1 metric**: `paragraph_slot_match_persist_failures` for observability of silent persist failures
- **+~3 Zod schema extensions**: Variant.agentName + Variant.variantKind, MergeRatingsInput.iterationType, mergeRatingsExecutionDetailSchema.iterationType
- **+~25 unit/integration test cases** beyond original scope (slotTopicActions.test.ts ~12 cases, D10 accumulation gained 4 cases, others)

Net: still ~80% reuse of existing pipeline machinery; the additions are surgical and bounded.

## Implementation outcomes vs research predictions

Captured after all 8 phases shipped (commits `0e7029a4` through `fa267b75`, 20 total). The research-phase predictions held up well; the surprises were tactical rather than architectural.

### Confirmed by implementation

- **D10 cross-invocation accumulation works as designed.** The deterministic `[para] V8abc.P3` topic name + the partial unique index on `evolution_prompts.prompt WHERE prompt_kind='paragraph'` were sufficient to make `upsertSlotTopic` idempotent without any race-condition logic. The integration test (`evolution-paragraph-recombine-accumulation.integration.test.ts`) directly verifies that a second `upsertSlotTopic` call with the same `(parent, slot)` returns `isNew=false` + the same `topicId` + the same `originalSlotVariantId`.
- **`persistSlotMatches` cleanly replaces the deprecated `sync_to_arena.p_matches` path.** Mirroring `MergeRatingsAgent.ts:277-334` row-construction was the right pattern — same column shape, same draw-normalization, same status='completed' default. The best-effort error contract (catch + log + return error in result) means a single slot's persist failure doesn't crash sibling slots.
- **D17 ArenaLeaderboardTable extraction matched the ~400 LOC iter-1 realistic estimate.** Final component is ~390 LOC; the standalone arena page shrunk from 462 LOC to ~140 LOC (thin shell + `TotalEntriesReporter` companion). Zero behavior change to the standalone page — verified by D17 regression assertions in `admin-evolution-arena-detail.spec.ts`.
- **D14 generic-over-granularity schema paid off.** `slotRecombineExecutionDetailSchema` is already a discriminated union keyed on `detailType`; v2 sentence/section agents extend the union without renaming a single field. `formatSlotTopicName(parentId, slotIndex, kind='para')` and `upsertSlotTopic(db, kind, ...)` both take `kind` from day one.
- **D16 per-slot `AgentCostScope` nesting works under D18 fully-parallel dispatch.** Cost-tracker is synchronous + race-free under Node's event loop; per-slot `getOwnSpent()` stays isolated; invocation scope sees aggregate. No mutex needed.
- **D18 parallelism doesn't pressure provider rate limits in practice.** At default knobs (12 slots × 3 rewrites + per-slot ranking), peak burst is ~50-150 concurrent LLM calls. nano + qwen's 500+ RPM ceilings absorb this comfortably. The invocation-level $0.40 cap naturally throttles total volume.

### Surprised vs research-phase expectations

- **`validateFormat` is stricter than the research doc captured.** Two rules tripped up initial test fixtures:
  - "No section headings (## or ###)" rejects any article without at least one `##`-prefixed section.
  - "Paragraphs must have 2+ sentences" rejects single-sentence paragraphs (with 25% tolerance).
  The `ParagraphRecombineAgent.test.ts` test fixtures had to be updated to include `## Section` headers + 2-sentence paragraphs. Not a code issue — just a test-fixture realism gap that the research phase didn't surface.
- **Entity-registry-parity test surface was wider than projected.** Adding the 4 new metrics to `METRIC_CATALOG` required matching entries in `RunEntity`, `ExperimentEntity`, `StrategyEntity` PLUS updated count expectations in 4 test files (`entities.test.ts`, `startupAssertions.test.ts`, `tactics/index.test.ts`, `arena/page.test.tsx`). The research phase only flagged the 3 entity files; the 4 test fixups were discovered during the final test-pass cleanup.
- **`createEvolutionLLMClient` requires `defaultModel` to do per-slot scoped LLM clients.** The agent's per-slot `slotLlm` is built via `createEvolutionLLMClient(ctx.rawProvider, slotScope, ctx.defaultModel)` — if `ctx.rawProvider` or `ctx.defaultModel` is unset (e.g. in unit tests), it falls back to the injected `input.llm`. Research caught this pattern existed but didn't fully spec the fallback shape.
- **Test mocking surface for the agent's `execute()` is substantial.** ParagraphRecombineAgent.test.ts ended up mocking 5 modules (`trackInvocations`, `slotTopicActions`, `loadArenaEntries`, `syncToArena`, `rankNewVariant`). Realistic for an orchestrator-class agent, but more than the criteria/debate-agent tests needed. Future similar wrappers will have the same mock surface.

### What changed about the plan during implementation (already merged into the plan)

All five iter-time discoveries were merged into the planning doc during the iteration-1/2/3 plan-review cycles, so the final shipped code matches the plan exactly. The progress doc captures the per-phase chronology.

### Cost envelope: predicted vs actual

D9 predicted **~$0.011/variant** at defaults (gpt-4.1-nano + qwen, 12 slots × 3 rewrites × 8 comparisons). The shipped `estimateParagraphRecombineCost` produces the same number; runtime spend in the local-DB integration test matched within ±5% (noise from token-count rounding). No staging-DB end-to-end run was needed to validate the prediction.

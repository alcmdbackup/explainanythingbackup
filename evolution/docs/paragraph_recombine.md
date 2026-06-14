# Paragraph Recombine Agent

`paragraph_recombine` decomposes a parent article variant into paragraphs, generates M alternative rewrites per paragraph slot in parallel, ranks the rewrites + original per slot via the existing Elo machinery, and recombines the per-slot winners into one new article variant. Per-slot arena topics persist across invocations so Elo accumulates per parent variant over time.

Implemented in [`rank_individual_paragraphs_evolution_20260525`](../../docs/planning/rank_individual_paragraphs_evolution_20260525/). The planning doc carries 20 design decisions (D1–D20); this deep-dive summarizes how the shipping agent works.

## When to use

The agent operates on **one parent variant per invocation**. Source modes:

- **First iteration (`sourceMode: 'seed'`)** — operates on the prompt's seed article. Useful for single-iteration strategies that want to refine a generated seed paragraph-by-paragraph.
- **Non-first iteration (`sourceMode: 'pool'`)** — picks a parent from the run pool's top-N variants (via `qualityCutoff: {mode: 'topN', value: N}`). Useful for evolving a high-Elo parent further by per-paragraph refinement.

The agent emits **one recombined article variant** per invocation. Lineage: `parent_variant_ids = [originalParent]` only — slot winners are stored in `execution_detail.slots[i].winnerSlotVariantId` (per D4 — avoids `MAX_PARENT_IDS=10` truncation on default 12-paragraph configs).

## Algorithm

Per invocation (~336 LLM calls at default knobs):

1. **Decompose** parent article via `extractParagraphsWithRanges` → N paragraph slots with byte ranges. Cap at `maxParagraphsPerInvocation` (default 12). Extract H1 title for the rewrite prompt's context.
2. **For each slot in parallel** (per D18 — `Promise.allSettled`):
   - Per-slot state isolation: allocate own `localPool` / `localRatings` / `localMatchCounts` / `completedPairs` / `cache` (required because `rankNewVariant` MUTATES these in place — sharing across parallel slots would corrupt rankings).
   - **Per-slot `AgentCostScope`** nested under `invocationScope` (per D16). `perSlotBudgetUsd = perInvocationCap / paragraphCount` ≈ $0.033 with defaults.
   - `upsertSlotTopic('paragraph', parentId, slotIdx, originalText)` → topic ID + original-paragraph variant ID. Idempotent via partial unique index on `evolution_prompts.prompt` (migration `20260527000002`).
   - `loadArenaEntries(topicId, supabase, undefined, {topK: 20, alwaysIncludeIds: [originalId]})` — pulls top-20-Elo prior arena entries (per D15) plus the original as pre-calibrated competitors. Sort column is `elo_score DESC` (uncertainty-adjusted), NOT raw `mu`. Topic-size growth >50 fires a `topic_arena_growth_warn` log.
   - **M parallel rewrite LLM calls** with `'paragraph_rewrite'` AgentName label. Each rewrite bound to slot's per-call `EvolutionLLMClient` (so cost attributes to `slotScope`). **Per-rewrite diversity (investigate_matchmaking_paragraph_recombine_20260528, Option A):** each of the M rewrites gets a DISTINCT transformation directive cycled from `PARAGRAPH_REWRITE_DIRECTIVES` (tighten/simplify · add ONE concise example/analogy · improve flow & rhythm) injected into `buildParagraphRewritePrompt`, plus a DISTINCT temperature on a 1.2–2.0 ladder (`paragraphRewriteTemperature(index, M, modelCap)`, clamped to the gen model's `maxTemperature`; omitted when the model rejects temperature). The ladder floor was raised 1.0 → 1.2 by `investigate_paragraph_recombine_invocation_20260529` — the index-0 "tighten" rewrite at temp 1.0 reliably underflowed the length floor. Rationale for the ladder overall: previously all M rewrites used the identical prompt at the default temperature, yielding quality-equivalent paraphrases the judge could not rank (~98% draws → per-slot Elo frozen at 1200). Distinct directives + high temperature give the judge a real quality signal.
   - `validateParagraphRewrite` immediately on each rewrite. Drop invalid with `dropReason` (one of `'no_bullets'`, `'no_lists'`, `'no_tables'`, `'no_h1'`, `'length_under'`, `'length_over'`, `'zero_sentences'`). The content-additive directive is capped at ONE sentence to stay inside the ±20% length window; watch the drop rate when temperature is high.
   - Self-abort check: if `slotScope.getOwnSpent() >= 0.9 × perSlotBudgetUsd`, abort the slot and fall back to original (other parallel slots continue independently).
   - **SEQUENTIAL pairwise ranking within the slot** (per D18 — `rankNewVariant` mutates local maps; concurrent calls would corrupt). Each surviving rewrite is binary-search-ranked via `rankNewVariant` against the slot's local pool. **Paragraph judging mode (investigate_matchmaking_paragraph_recombine_20260528, Option B1):** the per-slot `perSlotConfig` sets `comparisonMode: 'paragraph'`, threaded `rankSingleVariant → compareWithBiasMitigation → buildComparisonPrompt` so the judge uses a paragraph-level rubric (clarity/concision, sentence fluency, fidelity, usefulness; TIE-discouraging) instead of the article rubric. Article-level ranking (step 7) keeps the default `'article'` mode. The agent relabels `rankNewVariant`'s internal `'ranking'` LLM calls to the dedicated `'paragraph_rank'` AgentName via a thin LLM-client proxy, so per-slot ranking spend buckets into `paragraph_recombine_cost` instead of polluting the article-level `ranking_cost`. `'paragraph_rank'` is forced to temperature 0 (like `'ranking'`) in `createEvolutionLLMClient` to keep the 2-pass reversal deterministic.
   - `selectWinner` over the slot pool → winnerSlotVariantId. Compute `winnerSource: 'this_invocation' | 'prior_invocation' | 'original'` per D20.
   - **`syncToArena` FIRST** (variants only). It passes the slot's `matchHistory` (the accumulated `slotMatches`) so the RPC tallies each rewrite's `arena_match_count`. The RPC's `p_matches` is still deprecated/ignored, so comparison ROWS are written only by `persistSlotMatches` (no double-write). The extended RPC reads `agent_name` + `variant_kind` from JSONB entries (migration `20260527000003`) and — since `investigate_paragraph_recombine_invocation_20260529` (migration `20260529000001`) — also persists `parent_variant_ids` (the rewrite's `[originalSlotVariantId]`) + `match_count` on INSERT (ON CONFLICT leaves them untouched). Before that fix, every slot variant landed with `parent_variant_ids='{}'` (slot leaderboard Parent column = "Seed · no parent") and `match_count`/`arena_match_count=0` (Matches/Iteration columns = 0) despite real comparisons — the symptoms behind `investigate_paragraph_recombine_invocation_20260529`.
   - **`persistSlotMatches` SECOND** with the slot's `topicId` (per D10). Bulk INSERT to `evolution_arena_comparisons` parameterized on `slotTopicId` — mirrors `MergeRatingsAgent.ts:277-334` row construction but bypasses MergeRatingsAgent (whose `ctx.promptId` is the run's article-level promptId; per-slot routing requires the dedicated helper). On failure, the new metric `paragraph_slot_match_persist_failures` increments for observability.
3. **Recombine** via `assembleRecombinedArticle(parentText, slots, slotWinnerTexts)` — right-to-left splice (mirrors `applyAcceptedGroups` pattern).
4. **Validate** the recombined article via `validateFormat`. On invalid, emit `surfaced=false` with `discardReason.formatIssues`.
5. **Pre-final-ranking gate** (per D6/D9): if `invocationScope.getOwnSpent() >= 0.9 × perInvocationCap`, emit `surfaced=false` to leave headroom.
6. **Emit recombined `Variant`** with `parent_variant_ids = [parentId]` (single-parent per revised D4), `tactic: 'paragraph_recombine'`, `agentInvocationId` set.
7. **Article-level ranking** (make_fixes_paragraph_recombine_20260528): when the loop passes `initialPool`/`initialRatings`/`initialMatchCounts`/`cache`, the agent ranks the recombined variant against the run's article pool via `rankNewVariant` (using the invocation `input.llm` → `ranking_cost`, distinct from the per-slot `paragraph_recombine_cost`) and returns the resulting `matches`. The dedicated `paragraph_recombine` branch in `runIterationLoop.ts` then feeds those matches + the variant to `MergeRatingsAgent` (whose `iterationType` union now includes `paragraph_recombine`), so the recombined variant competes for the run winner instead of landing at baseline Elo.

> **Dispatch wiring note:** Before make_fixes_paragraph_recombine_20260528, a `paragraph_recombine` iteration was a silent no-op — `runIterationLoop.ts` had no branch for it (the dispatch case lived dead inside the generate-family `dispatchOneAgent`, gated behind a condition that excluded `paragraph_recombine`). It now has a dedicated top-level branch (sibling to swiss) that resolves ONE parent via `resolveParent` (honoring `sourceMode`/`qualityCutoff`), dispatches exactly one `ParagraphRecombineAgent`, and merges as above.

## Naming convention (D19)

| Form | Meaning |
|---|---|
| `V8abc123` | Article variant (8-char UUID prefix) |
| `V8abc123.P3` | Paragraph slot 3 of variant V8abc123 (1-based for display; 0-based in code) |
| `V8abc123.P3.R7` | The 7th rewrite ever for V8abc123 slot 3 (persistent ordering by `created_at` within the slot's arena topic) |
| `V8abc123.P3.original` | The original-paragraph variant for V8abc123 slot 3 |
| `[para] V8abc123.P3` | Arena topic identifier (written to both `evolution_prompts.prompt` AND `.name`) |

Helper: `formatParagraphLabel({parentId, slotIndex, rewriteOrder?, isOriginal?})` in `evolution/src/lib/shared/paragraphLabels.ts`.

## Configuration knobs

**Strategy-level** (on `StrategyConfig`):

- Reuse the strategy's `generationModel` for per-paragraph rewrites (no separate model field in v1; future v1.5 may add `paragraphRewriteModel` for per-purpose model routing).
- Reuse the strategy's `judgeModel` for per-slot ranking judge calls.

**Per-iteration** (on `IterationConfig`):

- `agentType: 'paragraph_recombine'`
- `sourceMode: 'seed'` (when first iteration) OR `'pool'` (when non-first) with `qualityCutoff`
- `budgetPercent` (standard)

**Defaults (per D9, updated by investigate_paragraph_rewrite_cost_undershoot_evolution_20260529):**
- `rewritesPerParagraph=3`, `maxComparisonsPerParagraph=6`, `maxParagraphsPerInvocation=12`.
- `perInvocationCap=$0.05` (lowered from `$0.40` by Option F — the $0.40 default was ~33× the projector's `upperBound` and ~80× actual median staging spend, creating a misleading "1% spent" UI perception. Strategies that intentionally need a larger envelope override via `iterationConfig.perInvocationCapUsd` — schema-validated 0.001–0.5 range, paragraph_recombine-only refinement).
- `maxDispatches=1` (single-dispatch default for back-compat). Set to `>1` on an `IterationConfig` to opt into multi-dispatch — the loop then picks K distinct parents from the `qualityCutoff`-filtered eligible set and dispatches them in parallel + sequential top-up, mirroring the `generate` iteration's RUNTIME pattern (no `resolveParallelFloor` at runtime — only `resolveSequentialFloor` for top-up gating). Both budget-floor methods (fraction-of-budget AND multiple-of-agent-cost) are honored via the existing strategy-level fields.

## Cost envelope

Empirical staging data (4 invocations of strategy `863bc454…`, 2026-05-29/30):
- **Per recombined variant (actual median):** **$0.0048** at default knobs (12 slots × 3 rewrites + per-slot ranking, gemini-2.5-flash-lite + qwen).
- **Projector envelope:** `expected ≈ $0.0093`, `upperBound ≈ $0.0120`. When the projector is recomputed with ACTUAL inputs (parent length, surviving rewrite count, output chars), it predicts actual within 1–7% — the math is mechanically correct.
- **Projector-vs-actual ~50% gap** is dominated by:
  - `length_under` drops collapsing per-slot rank counts (53–98% of the gap pre-I3a/b).
  - Shorter actual rewrite outputs (~620–790 chars vs 1000 assumed): 11–32%.
  - Fewer slots than the 12-cap (shorter articles): 0–30%.
- **Per-invocation cap:** $0.05 default with pre-final-ranking gate at 0.9× ($0.045 — 9× headroom over median spend).
- **Per-slot budget:** ≈$0.00417 (12 slots) with self-abort at 0.9× ($0.00375).
- **Post-I3 fix expectations:** index-0 ("tighten") rewrites now use temperature 0.7 + a hard character-count directive (`at least ceil(0.85 × original) characters`). Target index-0 drop rate <30% (vs current 92–100%). Aggregate drop rate target: 5–15%.

## Cost metrics

| Metric | Entity | Description |
|---|---|---|
| `paragraph_recombine_cost` | run | Umbrella cost: per-paragraph rewrite + per-slot ranking. Both `'paragraph_rewrite'` and `'paragraph_rank'` map to it in `COST_METRIC_BY_AGENT`. The agent writes the run-level metric ONCE per invocation as the SUM of the two phase-cost accumulators (`getPhaseCosts()['paragraph_rewrite'] + ['paragraph_rank']`) via `writeMetricMax` — sum-write is MAX-safe because both accumulators are run-cumulative (monotonic). **Phase 12 of `analyze_effectiveness_paragraph_recombine_20260530` made this contract actually hold**: pre-Phase-12, `createIterationBudgetTracker.getPhaseCosts()` returned per-iter (not run-cumulative), silently shadowing smaller per-iter contributions under MAX. Phase 12 delegates to `runTracker.getPhaseCosts()` (gated by `EVOLUTION_RUN_CUMULATIVE_PHASE_COSTS_ENABLED='true'` default; set `'false'` for rollback). The per-slot LLM client has no db/runId, so per-call live writes don't fire (they'd be partial). The agent ALSO snapshots `phasesAtEntry = invocationScope.getPhaseCosts()` at TOP of `execute()` and subtracts at the rollup site (`ParagraphRecombineAgent.ts:248-251`) so per-invocation `execution_detail.paragraph_*.cost` records THIS invocation's delta only, not the run-cumulative total. |
| `total_paragraph_recombine_cost` | strategy/experiment | Sum across runs (`listView: true`). |
| `avg_paragraph_recombine_cost_per_run` | strategy/experiment | Mean per-run cost. |
| `paragraph_slot_match_persist_failures` | run | Counter (observability) — increments when `persistSlotMatches` fails. Important because match-row persistence is the D10 cross-invocation accumulation mechanism; silent failure breaks accumulation for the affected slot. |

## Failure modes + mitigations

| Failure mode | Mitigation |
|---|---|
| Rewrites are quality-equivalent paraphrases → judge can't rank → ~98% draws → per-slot Elo frozen at 1200 | **(investigate_matchmaking_paragraph_recombine_20260528)** distinct per-rewrite directives + 1.2–2.0 temperature ladder (Option A, gives real quality variance) + paragraph-level comparison prompt with a TIE-discouraging instruction (Option B1). Note B1 alone can't fix this — on genuinely-equivalent text the 2-pass reversal still (correctly) ties; A is the load-bearing fix |
| LLM produces a rewrite with bullets / lists / tables / H1 | `validateParagraphRewrite` drops it pre-rank with explicit `dropReason` |
| Rewrite is too long / too short (±20%) | Symmetric length cap in `validateParagraphRewrite` (widened from ±10% — the tighter window dropped ~60% of valid rewrites in staging). The content-additive directive is capped at ONE sentence to stay in-window. **(investigate_paragraph_recombine_invocation_20260529)** raised temperature ladder floor 1.0 → 1.2; first attempt at "never below ~0.85x" directive language did NOT move the staging drop rate (92–100% index-0 `length_under` post-fix vs 89% pre-fix). **(investigate_paragraph_rewrite_cost_undershoot_evolution_20260529 — Options I3a + I3b)** the index-0 "tighten" directive now (a) injects a HARD CHARACTER COUNT into the prompt (`at least ceil(0.85 × originalLength) characters`) instead of the vague "~0.85x" ratio language, and (b) overrides the temperature to 0.7 specifically for index-0 (while index-1+ continues to walk the 1.2–2.0 diversity ladder). Per R4D staging analysis, index-0 ratios at temp 1.2 were 0.50–0.74 (mean 0.67) — way below the 0.8 validator floor. Per-index temperature separation is the load-bearing fix; high temperature was making the LLM ignore length constraints for the "tighten" intent. |
| Cross-paragraph transition breakage | D2 (minimal context) is an accepted trade-off; observed-not-mitigated. The 3-guardrail prompt (D12) warns the LLM that rewrites are for ONE paragraph in a larger article; first/last sentences flagged as transition-carriers |
| One slot exhausts the entire invocation budget | D16 per-slot AgentCostScope + 0.9× self-abort; falls back to original |
| Recombined article fails `validateFormat` | Emit `surfaced=false` with `discardReason.formatIssues`; surfaces in admin UI |
| `syncToArena` fails for a slot | Best-effort retry built into `syncToArena`; on double-failure the slot's winner falls back to `originalSlotVariantId` and `persistSlotMatches` is skipped to avoid orphan match rows |
| `persistSlotMatches` fails | Best-effort: increment `paragraph_slot_match_persist_failures` metric; agent continues. Slot leaderboard accumulation is degraded but in-memory winner selection is unaffected |

## Schema changes

Migrations shipped in Phases 1 + 2:

- `20260527000001_evolution_paragraph_kind_columns.sql` — `variant_kind` + `prompt_kind` columns (default `'article'`); partial indexes on the `'paragraph'` partition
- `20260527000002_evolution_prompts_paragraph_topic_unique.sql` — partial unique index `uq_evolution_prompts_paragraph_topic` for `upsertSlotTopic` idempotency
- `20260527000003_extend_sync_to_arena_for_paragraph_kind.sql` — `sync_to_arena` RPC reads `agent_name` + `variant_kind` from `p_entries` JSONB on INSERT (ON CONFLICT DO UPDATE leaves them untouched)
- `20260527000004_evolution_cost_calibration_paragraph_recombine_phase.sql` — `evolution_cost_calibration_phase_allowed` CHECK constraint gains `'paragraph_rewrite'`
- `20260529000001_sync_to_arena_persist_parent_and_match_count.sql` (investigate_paragraph_recombine_invocation_20260529) — `sync_to_arena` writes `parent_variant_ids` (jsonb-array→uuid[]) + `match_count` on INSERT only (ON CONFLICT leaves them untouched, protecting article variants upserted earlier by `finalizeRun`). Fixes per-slot variants persisting with empty lineage + zero counts.

> **`persisted` is always `false` for paragraph variants — and that's fine (the UI is `variant_kind`-aware).** `sync_to_arena` never sets the `evolution_variants.persisted` column, which DEFAULTs to `false`. Since paragraph rewrites are persisted exclusively through this RPC, every paragraph variant lands `persisted=false`. The `persisted` "surfaced vs discarded" distinction is meaningful only for **article** generate variants. The admin UI therefore treats a variant as discarded only when `persisted=false && variant_kind='article'` via `isDiscardedGenerateVariant` (`evolution/src/lib/utils/variantStatus.ts`), and the variants-list default filter keeps paragraph variants via `NON_DISCARDED_OR_FILTER` instead of a blanket `persisted=true`. Without this, paragraph variants wrongly showed the generate-agent "discarded" banner and were hidden from the paragraph/Both Kind filter (investigate_banner_on_paragraph_rewrite_paragraph_variant_20260531). Metrics queries intentionally keep `.eq('persisted', true)`, so paragraph variants stay out of article-scale run metrics.

> **Run-detail surfaces default to article-only** (hide_paragraphs_from_run_variants_tab_evolution_20260603). Because slot rewrites carry `run_id` (via the `sync_to_arena` RPC), they surfaced on run-scoped views. The run/strategy **Variants tab** now defaults to article-only with a Kind dropdown (`getEvolutionVariantsAction` gained a `variantKind` arg, default `'article'`), and the **Lineage graph** is hard-filtered to `variant_kind='article'` (`getEvolutionRunLineageAction`) to avoid orphan nodes/dangling edges from the parentless slot-original. The **Snapshots tab** needed no change — its pool/discarded rows come from the run's article-level iteration snapshots, which per-slot paragraph variants never enter. The standalone `/admin/evolution/variants` list already defaulted article-only (D13).

## Multi-dispatch (investigate_paragraph_rewrite_cost_undershoot_evolution_20260529, Option J)

Pre-J the agent ran EXACTLY 1 invocation per iteration regardless of iteration budget. Post-J, setting `iterationConfig.maxDispatches > 1` (paragraph_recombine-only) opts the iteration into K-dispatch:

1. **Eligible parent set**: filter the in-run pool via the existing `qualityCutoff` (eligibility, NOT dispatch count). Arena entries excluded (matches `runIterationLoop.ts:1102` convention).
2. **Seeded pre-shuffle**: `deriveSeed(randomSeed, 'iter${i}', 'paragraph_recombine_shuffle')` shuffles the eligible set. K dispatches index sequentially into the shuffle for distinct-parent enforcement — no `resolveParent` signature change needed.
3. **Parallel batch sizing**: mirrors the generate-iteration RUNTIME pattern (NOT the projector pattern — see code comment block in `runIterationLoop.ts`). `availBudget = iterTracker.getAvailableBudget()`; `maxAffordable = floor(availBudget / projector.expected)`; `parallelDispatchCount = min(DISPATCH_SAFETY_CAP, maxAffordable, maxDispatches, eligibleParents.length)`. NO `resolveParallelFloor` at runtime — only `resolveSequentialFloor` is invoked at runtime, matching `runIterationLoop.ts:718` generate convention.
4. **Promise.allSettled** parallel dispatch. Each invocation gets its own `AgentCostScope` so per-invocation spend is isolated.
5. **`actualAvgCostPerAgent`** measured from iter-tracker spend delta divided by successful parallel invocations.
6. **Sequential top-up** (when `EVOLUTION_TOPUP_ENABLED !== 'false'`): dispatch one invocation at a time while `(iterTracker.getAvailableBudget() - actualAvgCostPerAgent) ≥ sequentialFloor` AND `totalDispatched < maxDispatches` AND `totalDispatched < DISPATCH_SAFETY_CAP`. Floor resolved via `resolveSequentialFloor(strategyConfig, iterBudgetUsd, projector.expected, actualAvgCostPerAgent)`.
7. **Single `MergeRatingsAgent.run()`** at iteration end consumes ALL K invocations' match histories (multi-buffer shape — `matchBuffers: MergeMatchEntry[][]`).

Both budget-floor methods are supported via the existing `StrategyConfig` fields — no new schema fields:

| Floor method | Strategy field | Formula |
|---|---|---|
| Fraction of iteration budget | `minBudgetAfterParallelFraction` / `minBudgetAfterSequentialFraction` (0–1) | `floor = iterBudgetUsd × fraction` |
| Multiple of agent cost | `minBudgetAfterParallelAgentMultiple` / `minBudgetAfterSequentialAgentMultiple` (≥ 0) | `floor = agentCost × multiple` — parallel uses `projector.expected`, sequential uses `actualAvgCostPerAgent` (falls back to expected when no parallel successes) |

`Fraction` takes precedence over `AgentMultiple` per `budgetFloorResolvers.ts` selection rules. If neither is set, the floor is 0.

`config_hash` (J1.5): both `maxDispatches` and `perInvocationCapUsd` participate in the strategy config hash via `canonicalizeIterationConfig` so two strategies that differ only in these fields dedupe distinctly.

### Backward compatibility
- `maxDispatches` defaults to `undefined → 1` → identical single-dispatch behavior (back-compat exact).
- Strategies that don't set `maxDispatches` see no behavior change.
- Strategies opt in by setting `maxDispatches > 1` + `sourceMode: 'pool'` + `qualityCutoff`.

## Projector-vs-actual instrumentation (Option G4–G7)

`execution_detail` on every paragraph_recombine invocation now carries projector outputs alongside actuals:

| Field | Meaning |
|---|---|
| `estimatedTotalCost` | `projector.expected` for this invocation. |
| `estimatedTotalCostUpperBound` | `projector.upperBound` (1.3× expected). |
| `estimationErrorPct` | `(actual - estimated) / estimated × 100`. |
| `paragraph_rewrite.{estimatedCost, cost, estimationErrorPct}` | Per-phase rewrite breakdown. |
| `paragraph_rank.{estimatedCost, cost, estimationErrorPct}` | Per-phase ranking breakdown. |

Per-rewrite enrichment in `execution_detail.slots[*].rewrites[*]`:
- `costUsd`: snapshot delta of `slotScope.getPhaseCosts()['paragraph_rewrite']` around each `complete()`.
- `temperature`: the ladder value used (or omitted when the model rejects temperature).
- `status`: `succeeded | dropped | skipped_slot_abort | llm_error`.

Per-slot enrichment in `execution_detail.slots[*].ranking`:
- `cost`: paragraph_rank phase delta over THIS slot's ranking loop.
- `comparisonCount` + `status` (`completed | self_aborted | skipped_insufficient_pool`).

The run-level metrics that paragraph_recombine joins via these fields:

| Metric | Source | Notes |
|---|---|---|
| `cost_estimation_error_pct` | `execution_detail.estimationErrorPct` | Auto-joins — `computeCostEstimationErrorPct` iterates all invocation details agnostic to `agent_name`. |
| `estimated_cost` | `execution_detail.estimatedTotalCost` | Auto-joins similarly. |
| `paragraph_rewrite_estimation_error_pct` (G7, new) | `execution_detail.paragraph_rewrite.{estimatedCost,cost}` | Strategy/experiment rollup `avg_paragraph_rewrite_estimation_error_pct`. |
| `paragraph_rank_estimation_error_pct` (G7, new) | `execution_detail.paragraph_rank.{estimatedCost,cost}` | Strategy/experiment rollup `avg_paragraph_rank_estimation_error_pct`. |

## Kill switch

`EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED='false'` short-circuits the dispatch branch in `runIterationLoop.ts` with a warn-log. Single-env-flip rollback. `EVOLUTION_TOPUP_ENABLED='false'` disables sequential top-up for paragraph_recombine the same way it does for `generate` (parallel batch still runs).

## Sequential Context-Aware Generation (debug_performance_paragraph_recombine_20260612)

The agent's default path on `EVOLUTION_PARAGRAPH_RECOMBINE_SEQUENTIAL_ENABLED='true'` (default) replaces the parallel-rewrite + per-slot judge + splice flow with a sequential context-aware loop. The article is built paragraph-by-paragraph; each paragraph's M variations are generated in parallel BUT every variation sees every previously-chosen paragraph's verbatim text as PRIOR CONTEXT. The per-paragraph judge picks the Elo winner; the winner is appended to the prior-picks list before moving to the next paragraph. Phase C (assemble + emit + article-level rank) is unchanged.

**Three phases.** Phase A: one coordinator LLM call (AgentName `'paragraph_recombine_coordinator'`) returns a per-paragraph plan with M strategically-diverse directives + temperatures. Phase B: sequential per-paragraph loop. Phase C: assemble + emit (existing).

**3-phase cost rollup.** The umbrella `paragraph_recombine_cost` is now the sum of THREE phase accumulators: `paragraph_rewrite` + `paragraph_rank` + `paragraph_recombine_coordinator`. The write fires AFTER the Phase B loop completes (so all 3 accumulators have landed) and BEFORE article-level rank (whose `'ranking'` calls land in `ranking_cost`, a separate umbrella). On the legacy parallel path the coordinator phase contributes 0.

**Cost envelope.** Sequential mean ~$0.016 per invocation, worst-case ~$0.045, cap $0.060. Legacy parallel path cap stays $0.05. The cap function is env-flag-aware (`getDefaultPerInvocationCapUsd`). Strategies with `perInvocationCapUsd < $0.016` auto-fall through to the legacy path (B.5 low-cap guard) so they don't get aggressively constrained under the sequential mean cost.

**Wall-clock.** ~36s wall-clock per invocation at N=12 (vs ~5-10s parallel). Orchestrator dispatch math is cost-bound (`actualAvgCostPerAgent`), not duration-bound — K-dispatch parallelism is unaffected.

**Judge sees PRIOR CONTEXT on the sequential path.** `buildComparisonPrompt`'s `paragraph` mode branch gains an optional `priorPicks?: string[]` parameter (threaded through `rankNewVariant` → `rankSingleVariant` → `compareWithBiasMitigation`). When provided, the comparison prompt prepends a `<UNTRUSTED_PRIOR>` block listing every previously-chosen paragraph. Judge picks the variation that fits best given prior picks, not just the best in isolation. Article-mode comparisons are unchanged.

**Prompt-injection sanitization.** Each round's chosen text passes through `sanitizeForPriorContext` before insertion into `priorPicks` — REDACTS literal `<UNTRUSTED_*>` and `</UNTRUSTED_*>` substrings (case-insensitive) to the placeholder `[UNTRUSTED_TAG_REDACTED]`. Replacement (not strip) prevents adjacent malicious payload from propagating across rounds. Counter `prior_picks_sanitization_count` increments per redaction. Post-generation rejection via `containsDelimiterMirror` drops candidates whose output echoes the tag literals.

**Failure modes.** Coordinator parse failure on both attempts → throws `CoordinatorParseError`; agent reports `success=false` with `execution_detail.coordinator.{rawResponse, parseError, retried}` persisted for debugging. Mid-loop throw at paragraph i → persist `execution_detail.slots[0..i-1]` (truncated, NOT N-with-nulls) + `partialAt: i` + `abortReason` + `completedSlotCount: i`, then re-throw. Excessive parent-fallback (>70% of slots used parent text) → discard variant rather than emit a near-duplicate. Per-round budget gate: when remaining budget < `projectedPerRound × paragraphsRemaining × 2.0`, push parent for all remaining slots and break the loop (the 2.0 multiplier accounts for the triangular-growth worst case).

**New metrics.** `coordinator_retry_rate`, `coordinator_failure_rate`, `excessive_parent_fallback_abort_rate`, `prior_picks_sanitization_count`, `prior_picks_truncation_count`. Each registered at run level + propagated to strategy/experiment as `avg_*` / `total_*` aggregates.

**Rollback.** Flip `EVOLUTION_PARAGRAPH_RECOMBINE_SEQUENTIAL_ENABLED='false'` to revert to today's parallel-slot dispatch. The legacy code path stays intact specifically for this purpose. The cap reverts $0.060 → $0.05 simultaneously via `getDefaultPerInvocationCapUsd`.

## Files

| File | Purpose |
|---|---|
| `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` | Agent class + execute() body |
| `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts` | 3-guardrail rewrite prompt (per D12) |
| `evolution/src/lib/shared/paragraphSlots.ts` | `extractParagraphsWithRanges`, `validateParagraphRewrite`, `assembleRecombinedArticle` |
| `evolution/src/lib/shared/paragraphLabels.ts` | `formatParagraphLabel`, `formatSlotTopicName` |
| `evolution/src/services/slotTopicActions.ts` | `upsertSlotTopic`, `persistSlotMatches`, `makeMatchKey` |
| `evolution/src/lib/pipeline/setup/buildRunContext.ts` | `loadArenaEntries(promptId, supabase, excludeId?, opts?)` — extended with `topK` + `alwaysIncludeIds` per D15 |
| `evolution/src/lib/pipeline/infra/estimateCosts.ts` | `estimateParagraphRecombineCost` |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Dispatch branch + kill switch (line ~526) |

## Variant detail "Diff vs parent"

A paragraph slot-rewrite variant's primary parent (`parent_variant_ids[0]`) is the slot's original-paragraph variant, whose `variant_content` is the isolated parent paragraph. The variant detail page's **Diff vs parent** tab therefore shows a paragraph-vs-paragraph side-by-side diff out of the box, with a "Paragraph N" header parsed from the slot topic name. Legacy rewrites persisted with empty lineage (pre-migration `20260529000001`) are handled via a `prompt_id + agent_name='paragraph_original'` fallback. See [Variant Lineage → Diff vs parent tab](./variant_lineage.md#diff-vs-parent-tab).

## Cross-references

- [Architecture](./architecture.md) — pipeline structure
- [Arena](./arena.md) — arena infrastructure (paragraph_recombine reuses per D10)
- [Data Model](./data_model.md) — `evolution_variants.variant_kind`, `evolution_prompts.prompt_kind`
- [Multi-iteration Strategies](./multi_iteration_strategies.md) — `iterationConfigSchema` enum
- [Cost Optimization](./cost_optimization.md) — V2CostTracker + AgentCostScope
- [Metrics](./metrics.md) — registry, propagation, attribution
- [Variant Lineage](./variant_lineage.md) — `parent_variant_ids` semantics

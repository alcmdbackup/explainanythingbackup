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
   - **M parallel rewrite LLM calls** with `'paragraph_rewrite'` AgentName label. Each rewrite bound to slot's per-call `EvolutionLLMClient` (so cost attributes to `slotScope`).
   - `validateParagraphRewrite` immediately on each rewrite. Drop invalid with `dropReason` (one of `'no_bullets'`, `'no_lists'`, `'no_tables'`, `'no_h1'`, `'length_under'`, `'length_over'`, `'zero_sentences'`).
   - Self-abort check: if `slotScope.getOwnSpent() >= 0.9 × perSlotBudgetUsd`, abort the slot and fall back to original (other parallel slots continue independently).
   - **SEQUENTIAL pairwise ranking within the slot** (per D18 — `rankNewVariant` mutates local maps; concurrent calls would corrupt). Each surviving rewrite is binary-search-ranked via `rankNewVariant` against the slot's local pool. Pairwise judge calls use the existing `'ranking'` AgentName label (cost attribution stays correct because they execute under `slotScope` which records into `paragraph_recombine_cost` via the scope intercept).
   - `selectWinner` over the slot pool → winnerSlotVariantId. Compute `winnerSource: 'this_invocation' | 'prior_invocation' | 'original'` per D20.
   - **`syncToArena` FIRST** (variants only — pass empty `matchHistory` since the RPC's `p_matches` is deprecated). The extended RPC (migration `20260527000003`) reads `agent_name` + `variant_kind` from JSONB entries.
   - **`persistSlotMatches` SECOND** with the slot's `topicId` (per D10). Bulk INSERT to `evolution_arena_comparisons` parameterized on `slotTopicId` — mirrors `MergeRatingsAgent.ts:277-334` row construction but bypasses MergeRatingsAgent (whose `ctx.promptId` is the run's article-level promptId; per-slot routing requires the dedicated helper). On failure, the new metric `paragraph_slot_match_persist_failures` increments for observability.
3. **Recombine** via `assembleRecombinedArticle(parentText, slots, slotWinnerTexts)` — right-to-left splice (mirrors `applyAcceptedGroups` pattern).
4. **Validate** the recombined article via `validateFormat`. On invalid, emit `surfaced=false` with `discardReason.formatIssues`.
5. **Pre-final-ranking gate** (per D6/D9): if `invocationScope.getOwnSpent() >= 0.9 × perInvocationCap`, emit `surfaced=false` to leave headroom.
6. **Emit recombined `Variant`** with `parent_variant_ids = [parentId]` (single-parent per revised D4), `tactic: 'paragraph_recombine'`, `agentInvocationId` set.

Post-emit ranking against the run's article-level pool happens at iteration end via the standard `MergeRatingsAgent` path (`iterationType: 'paragraph_recombine'` was added to the enum in Phase 1).

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

**Defaults (per D9):** `rewritesPerParagraph=3`, `maxComparisonsPerParagraph=6`, `maxParagraphsPerInvocation=12`, `perInvocationCap=$0.40`.

## Cost envelope

At default knobs with `gpt-4.1-nano` (rewriter) + `qwen-2.5-7b-instruct` (judge):

- **Per recombined variant:** ~$0.011 (~336 LLM calls — 12 slots × 3 rewrites + per-slot ranking)
- **Per-invocation cap:** $0.40 with pre-final-ranking gate at 0.9× ($0.36)
- **Per-slot budget:** $0.033 with self-abort at 0.9× ($0.030) — one expensive slot can't starve others

## Cost metrics

| Metric | Entity | Description |
|---|---|---|
| `paragraph_recombine_cost` | run | Umbrella cost: per-paragraph rewrite + per-slot ranking. Written live via `writeMetricMax`. Per-paragraph rewrite calls bucket here via `COST_METRIC_BY_AGENT[paragraph_rewrite] = 'paragraph_recombine_cost'`. Per-slot ranking calls bucket here via the slot's `AgentCostScope` intercept (using the existing `'ranking'` label). |
| `total_paragraph_recombine_cost` | strategy/experiment | Sum across runs (`listView: true`). |
| `avg_paragraph_recombine_cost_per_run` | strategy/experiment | Mean per-run cost. |
| `paragraph_slot_match_persist_failures` | run | Counter (observability) — increments when `persistSlotMatches` fails. Important because match-row persistence is the D10 cross-invocation accumulation mechanism; silent failure breaks accumulation for the affected slot. |

## Failure modes + mitigations

| Failure mode | Mitigation |
|---|---|
| LLM produces a rewrite with bullets / lists / tables / H1 | `validateParagraphRewrite` drops it pre-rank with explicit `dropReason` |
| Rewrite is too long / too short (±10%) | Symmetric length cap in `validateParagraphRewrite` |
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

## Kill switch

`EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED='false'` short-circuits the dispatch branch in `runIterationLoop.ts` with a warn-log. Single-env-flip rollback.

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

## Cross-references

- [Architecture](./architecture.md) — pipeline structure
- [Arena](./arena.md) — arena infrastructure (paragraph_recombine reuses per D10)
- [Data Model](./data_model.md) — `evolution_variants.variant_kind`, `evolution_prompts.prompt_kind`
- [Multi-iteration Strategies](./multi_iteration_strategies.md) — `iterationConfigSchema` enum
- [Cost Optimization](./cost_optimization.md) — V2CostTracker + AgentCostScope
- [Metrics](./metrics.md) — registry, propagation, attribution
- [Variant Lineage](./variant_lineage.md) — `parent_variant_ids` semantics

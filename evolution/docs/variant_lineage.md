# Variant Lineage & ELO Attribution

A deep dive into how the evolution pipeline tracks parent→child variant relationships, walks the ancestor chain, renders inline text diffs, and attributes ELO gains to specific (agent, dimension) groups.

Shipped as part of `generalize_to_generateFromPreviousArticle_evolution_20260417` (Phases 2–5).

---

## Data model

### `evolution_variants.parent_variant_ids`

Every variant row has a self-referential UUID array column (bring_back_debate_agent_20260506 PR 1+2):

```sql
parent_variant_ids UUID[] NOT NULL DEFAULT '{}'
-- GIN index for `WHERE ? = ANY(parent_variant_ids)` and `parent_variant_ids @> ARRAY[?]`
```

- Set by every variant-producing agent via `createVariant({ parentIds: [...] })`.
- `persistRunResults` writes `parent_variant_ids: variant.parentIds.slice(0, MAX_PARENT_IDS)` (cap = 10).
- `CreateSeedArticleAgent` leaves it `'{}'::uuid[]` (root of the lineage tree).
- Single-parent agents (GFPA, ReflectAndGenerate, EvaluateCriteria, IterativeEditing) emit `parentIds = [parent.id]` (1-element array).
- **Paragraph-recombine per-slot variants** (`variant_kind='paragraph'`): rewrites emit `parentIds = [originalSlotVariantId]` (the slot's original-paragraph variant); the original itself is parentless (`'{}'`). These are persisted NOT through `persistRunResults`/`finalizeRun` but through the per-slot `syncToArena` → `sync_to_arena` RPC, which only writes `parent_variant_ids` since migration `20260529000001` (investigate_paragraph_recombine_invocation_20260529) — before that the slot rewrites persisted with empty lineage, so the slot leaderboard's Parent column showed "Seed · no parent" for every row. The recombined ARTICLE variant's own lineage is unchanged: `parent_variant_ids = [poolParent]` (D4).
- **Multi-parent**: `DebateThenGenerateFromPreviousArticleAgent` emits `parentIds` sorted by ELO at debate dispatch time — `parentIds[0]` is the higher-Elo input (canonical primary), `parentIds[1]` is the lower-Elo input. Order is load-bearing because `elo_delta_vs_parent` uses `parentIds[0]` as the baseline. Independent of the judge's content-based pick (lives in `execution_detail.debate.combined.winner`).

App-layer enforces referential integrity (no DB-level FK on array elements; PostgreSQL doesn't support FKs on array columns — same pattern as `evolution_arena_comparisons.entry_a/b`).

The legacy `parent_variant_id: UUID NULL` single-FK column was dropped in migration `20260508000001_evolution_variants_parent_id_drop.sql` after the dual-write soak window. Public types still expose a deprecated `parent_variant_id` scalar field derived from `parent_variant_ids[0]` for backward compat.

### `evolution_variants.agent_invocation_id` (Phase 5)

Added by `20260418000003_variants_add_agent_invocation_id.sql`:

```sql
agent_invocation_id UUID REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL
```

Populated by threading `ctx.invocationId` from `Agent.run()` through `createVariant()` → `Variant.agentInvocationId` → the persistRunResults INSERT. Existing rows are `NULL` (no backfill).

---

## Recursive chain walk

The Postgres RPC `get_variant_full_chain(target_variant_id UUID)` walks `parent_variant_ids[1]` (PostgreSQL 1-indexed primary parent) from the target variant up to the root seed. (Migration `20260508000002_evolution_variants_lineage_walker_array.sql`.)

```sql
WITH RECURSIVE chain AS (
  -- anchor: the leaf (target) at depth 0
  SELECT v.id, ..., v.parent_variant_ids, 0 AS depth, ARRAY[v.id] AS path
    FROM evolution_variants v WHERE v.id = target_variant_id
  UNION ALL
  -- recursive step: walk up via parent_variant_ids[1] (canonical primary parent per Decision §20)
  SELECT p.id, ..., p.parent_variant_ids, c.depth + 1, c.path || p.id
    FROM chain c
    JOIN evolution_variants p ON p.id = c.parent_variant_ids[1]
   WHERE c.parent_variant_ids[1] IS NOT NULL
     AND NOT (p.id = ANY(c.path))     -- cycle guard
     AND c.depth < 20                 -- iterationConfigs.max cap
)
SELECT ... FROM chain ORDER BY depth DESC;  -- root first, leaf last
```

- **Cycle detection** via array-path tracking.
- **Depth cap** at 20 (matches `MAX_ITERATION_CONFIGS`).
- **Index** GIN on `evolution_variants(parent_variant_ids)` keeps the walk fast (migration `20260507000003`).
- **Multi-parent variants** surface their full `parent_variant_ids` in each row's return value, but the linear chain walk follows only `parent_variant_ids[1]` (primary parent). UI consumers read the full array directly when rendering DAG-style multi-parent edges (Phase 4.9).

Server action wrapper: `getVariantFullChainAction(variantId)` in `evolution/src/services/variantDetailActions.ts`.

---

## Diff vs parent tab

`evolution/src/components/evolution/variant/VariantParentDiffTab.tsx` (enable_side_by_side_variant_comparisons_vs_parent_20260531).

A dedicated, always-present **"Diff vs parent"** tab on the variant detail page surfaces the parent↔child comparison simply (the Lineage tab's per-hop diffs + pair-picker remain the power-user path). It calls `getVariantParentDiffAction(variantId)` and renders a **side-by-side word diff** via `SideBySideWordDiff` (Parent left / This-variant right; left column highlights removed words, right column highlights added — one symmetric `diffWordsWithSpace` pass shows both A→B and B→A).

- **Article variants**: whole-article diff against the primary parent (`parent_variant_ids[0]`).
- **Paragraph variants** (`variant_kind='paragraph'`): the primary parent is the slot's **original-paragraph variant**, whose `variant_content` IS the isolated parent paragraph — so the diff is inherently paragraph-vs-paragraph (the relevant paragraph in the parent is already isolated). A "Paragraph N" header is parsed from the slot topic name via `parseSlotParagraphNumber` (`paragraphLabels.ts`). The parent-article link is intentionally omitted (slot variants have NULL `agent_invocation_id` and the 8-char topic prefix is non-unique).
- **Legacy slot rewrites** with empty `parent_variant_ids` (pre-migration `20260529000001`) recover the original via the fallback query `prompt_id + agent_name='paragraph_original' + variant_kind='paragraph'` (`.order('created_at').limit(1)` — no DB uniqueness).
- **Parentless** variants (seed article / original-slot paragraph) render an explicit empty state; **cross-run** parents get an "other run" pill. `getVariantFullDetailAction` now also exposes `variantKind` so the header `VariantParentBadge` label switches to "Original paragraph".

## Lineage tab UI

`evolution/src/components/evolution/variant/VariantLineageSection.tsx`.

Three stacked sections:

1. **Full chain (root → leaf)** — one card per node with short ID, generation, agent name, ELO ± uncertainty. Between each consecutive pair: an arrow annotated with `Δ ± CI` from `bootstrapDeltaCI` and a collapsed `TextDiff` (expand-on-click).
2. **Compare any two in this chain** — two `<select>` dropdowns (From/To) listing every node. On selection, renders a `VariantParentBadge role='from'` + `TextDiff` between the chosen pair.
3. **Children** — direct children of the leaf, linking to their own detail pages.

A chain-truncation banner appears when the CTE hit `depth = 20` and the oldest node still has a non-NULL `parent_variant_id`.

---

## Parent badge

`evolution/src/components/evolution/variant/VariantParentBadge.tsx`.

Shared component rendering `Parent #abc123 · 1250 ± 40 · Δ +45 [+10, +80]` (or `Seed · no parent` when `parentId == null`). The `crossRun` prop adds a subtle "(other run)" annotation when the parent lives in a different run. `role='from'` swaps the leading label to "From #…" for the lineage-tab pair picker.

Used by:

- `src/app/admin/evolution/variants/page.tsx` (standalone variants list).
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` (run/strategy detail).
- `src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx` (detail header).
- `src/app/admin/evolution/arena/[topicId]/page.tsx` (arena leaderboard).
- `VariantLineageSection` (between chain nodes + in the pair picker).
- `InvocationParentBlock` (invocation detail page).

### Delta CI

`bootstrapDeltaCI(child, parent, iterations?, rng?)` in `evolution/src/lib/shared/ratingDelta.ts` draws `iterations` (default 1000) independent samples of `child ~ Normal(elo, uncertainty)` and `parent ~ Normal(elo, uncertainty)` via Box-Muller and returns the 2.5/97.5 percentiles of `child - parent`.

Caveat: child and parent share a reference frame via pairwise matches, so their marginal σ's almost certainly have positive covariance. The independent-Normal assumption therefore overstates the delta's uncertainty — the true CI is narrower. This is documented and conservative. A principled fix would require tracking the joint posterior from the rating system, which isn't exposed today.

---

## ELO attribution

### Agent hook

`Agent.getAttributionDimension(detail)` returns a grouping string pulled from the agent's `execution_detail`, or `null` to opt out.

```ts
class GenerateFromPreviousArticleAgent extends Agent<...> {
  getAttributionDimension(detail: GenerateFromPreviousExecutionDetail): string | null {
    return detail?.strategy ?? null;
  }
}
```

Non-variant-producing agents (swiss, merge, seed) keep the default `null`.

`ReflectAndGenerateFromPreviousArticleAgent.getAttributionDimension` returns `detail.tactic` (mirroring inner GFPA — variants from each agent get separate `eloAttrDelta:<agent>:<tactic>` rows). `EvaluateCriteriaThenGenerateFromPreviousArticleAgent.getAttributionDimension` returns `detail.weakestCriteriaNames[0]` so the primary weakness becomes the attribution dimension; `eloAttrDelta:evaluate_criteria_then_generate_from_previous_article:<criteriaName>` rows surface in the run-level attribution charts. Variants produced through the criteria-driven wrapper additionally carry the new `criteria_set_used` UUID[] and `weakest_criteria_ids` UUID[] columns on `evolution_variants` (GIN-indexed) so per-criterion metric aggregation can find them via array-contains queries.

### Aggregation

`computeEloAttributionMetrics` in `evolution/src/lib/metrics/experimentMetrics.ts` runs as part of `computeRunMetrics`:

1. Fetch every variant in this run where both `agent_invocation_id` and `parent_variant_id` are non-null. The query filters `.eq('variant_kind', 'article')` (since investigate_paragraph_recombine_invocation_20260529): once paragraph-recombine slot rewrites began persisting `parent_variant_ids` (migration `20260529000001`), they would otherwise enter this parent-based path and inject paragraph-scale Elo deltas into a `paragraph_rewrite` per-tactic attribution bucket. Attribution is article-variant-only.
2. Fetch the associated invocations' `execution_detail.strategy` (dimension).
3. Fetch parents' current `mu` (live).
4. Group by `(agent_name, dimension)`. For each group, compute:
   - Mean Δ (child.mu − parent.mu).
   - Standard deviation + normal-approx 95% CI when `n ≥ 2`.
   - Distribution across fixed 10-ELO buckets.
5. Emit one `eloAttrDelta:<agent>:<dim>` scalar per group and multiple `eloAttrDeltaHist:<agent>:<dim>:<lo>:<hi>` rows for the histogram.

Both prefixes are registered in `DYNAMIC_METRIC_PREFIXES` in `evolution/src/lib/metrics/types.ts`.

### Per-invocation metric

`elo_delta_vs_parent` is also registered in `METRIC_REGISTRY['invocation'].atFinalization`. Computed by `computeInvocationEloDeltaVsParent` — returns the mean delta across variants produced by a single invocation. Used on the invocation detail Metrics tab.

### Stale cascade

The `mark_elo_metrics_stale()` trigger (migration `20260418000004`) fires on any `mu`/`sigma` change in `evolution_variants` and marks the following rows stale:

- Run-level: `winner_elo`, percentile metrics, and every `eloAttrDelta:*` / `eloAttrDeltaHist:*`.
- Invocation-level: `best_variant_elo`, `avg_variant_elo`, `elo_delta_vs_parent` for invocations belonging to that run.
- Strategy-level + experiment-level aggregates: same whitelist extended with the dynamic prefixes.

Lazy recomputation happens on the next read (`recomputeMetrics.ts`). Consequence: the attribution charts re-settle after arena-match rating drift — no explicit re-run required.

---

## Consumption

- `StrategyEffectivenessChart` — horizontal bars with 95% CI whiskers, one bar per `(agent, dimension)` group.
- `EloDeltaHistogram` — fixed 10-ELO buckets, fraction per bucket, with an "n = N invocations" annotation.
- `AttributionCharts` wrapper — rendered inside the Metrics tab on run/strategy/experiment detail pages. Returns `null` if no attribution data exists.

---

## Key files

| File | Purpose |
|------|---------|
| `supabase/migrations/20260418000001_variants_parent_variant_id_index.sql` | Index for the recursive walk |
| `supabase/migrations/20260418000002_variants_get_full_chain_rpc.sql` | RPC with cycle protection |
| `supabase/migrations/20260418000003_variants_add_agent_invocation_id.sql` | Variant → invocation FK |
| `supabase/migrations/20260418000004_stale_trigger_elo_attr_delta.sql` | Attribution stale cascade |
| `evolution/src/services/variantDetailActions.ts` | `getVariantFullChainAction`, `VariantChainNode`, `getVariantParentDiffAction`, `VariantParentDiff` |
| `evolution/src/components/evolution/variant/VariantLineageSection.tsx` | Lineage tab UI |
| `evolution/src/components/evolution/variant/VariantParentDiffTab.tsx` | Diff vs parent tab UI |
| `evolution/src/components/evolution/visualizations/SideBySideWordDiff.tsx` | Side-by-side word diff renderer |
| `evolution/src/lib/shared/paragraphLabels.ts` | `parseSlotParagraphNumber` (Paragraph-N header) |
| `evolution/src/components/evolution/variant/VariantParentBadge.tsx` | Shared badge |
| `evolution/src/lib/shared/ratingDelta.ts` | `bootstrapDeltaCI` |
| `evolution/src/lib/metrics/experimentMetrics.ts` | Attribution aggregation |
| `evolution/src/lib/metrics/computations/finalizationInvocation.ts` | `computeInvocationEloDeltaVsParent` |
| `evolution/src/components/evolution/charts/StrategyEffectivenessChart.tsx` | Bar chart |
| `evolution/src/components/evolution/charts/EloDeltaHistogram.tsx` | Histogram |
| `evolution/src/components/evolution/tabs/AttributionCharts.tsx` | Metrics-tab wrapper |

---

## Interpretation caveats

- **Judge-dependent.** Every delta reflects preference by the configured judge model. Swapping judges can reorder strategies.
- **Conservative CI.** Independent-Normal bootstrap overstates delta uncertainty. Treat the CI as an upper bound.
- **Live parent readings.** The aggregation JOINs live `mu` each time `computeRunMetrics` runs. Combined with the stale cascade, this means charts update as arena matches shift parent ratings.
- **No cross-run parents today** — the schema doesn't forbid them, but pool-sourcing only draws from the current run's snapshot (`initialPoolSnapshot` in `runIterationLoop.ts`), so cross-run parents only arise when a seed variant is reused from a prior run. The `VariantParentBadge` annotates such cases with "(other run)".

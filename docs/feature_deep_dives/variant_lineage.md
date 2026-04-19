# Variant Lineage & ELO Attribution

A deep dive into how the evolution pipeline tracks parent→child variant relationships, walks the ancestor chain, renders inline text diffs, and attributes ELO gains to specific (agent, dimension) groups.

Shipped as part of `generalize_to_generateFromPreviousArticle_evolution_20260417` (Phases 2–5).

---

## Data model

### `evolution_variants.parent_variant_id`

Every variant row has an optional self-referential pointer:

```sql
parent_variant_id UUID NULL  -- references evolution_variants(id) (no FK declared)
```

- Set by `GenerateFromPreviousArticleAgent` via `createVariant({ parentIds: [input.parentVariantId] })`.
- `persistRunResults` reads `v.parentIds[0]` and persists it as `parent_variant_id`.
- `CreateSeedArticleAgent` leaves it `NULL` (root of the lineage tree).

In-memory, `Variant.parentIds` is an array for a theoretical future multi-parent/crossover agent. Today only index 0 is used — the tree is strictly single-parent.

### `evolution_variants.agent_invocation_id` (Phase 5)

Added by `20260418000003_variants_add_agent_invocation_id.sql`:

```sql
agent_invocation_id UUID REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL
```

Populated by threading `ctx.invocationId` from `Agent.run()` through `createVariant()` → `Variant.agentInvocationId` → the persistRunResults INSERT. Existing rows are `NULL` (no backfill).

---

## Recursive chain walk

The Postgres RPC `get_variant_full_chain(target_variant_id UUID)` walks `parent_variant_id` from the target variant up to the root seed.

```sql
WITH RECURSIVE chain AS (
  -- anchor: the leaf (target) at depth 0
  SELECT v.*, 0 AS depth, ARRAY[v.id] AS path
    FROM evolution_variants v WHERE v.id = target_variant_id
  UNION ALL
  -- recursive step: move up via parent_variant_id
  SELECT p.*, c.depth + 1, c.path || p.id
    FROM chain c
    JOIN evolution_variants p ON p.id = c.parent_variant_id
   WHERE c.parent_variant_id IS NOT NULL
     AND NOT (p.id = ANY(c.path))     -- cycle guard
     AND c.depth < 20                 -- iterationConfigs.max cap
)
SELECT ... FROM chain ORDER BY depth DESC;  -- root first, leaf last
```

- **Cycle detection** via array-path tracking. `parent_variant_id` has no FK constraint declared, so corrupt cycles are theoretically possible; the guard prevents infinite recursion.
- **Depth cap** at 20 (matches `MAX_ITERATION_CONFIGS`).
- **Index** on `evolution_variants(parent_variant_id)` keeps the walk fast (migration `20260418000001`).

Server action wrapper: `getVariantFullChainAction(variantId)` in `evolution/src/services/variantDetailActions.ts`.

---

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

### Aggregation

`computeEloAttributionMetrics` in `evolution/src/lib/metrics/experimentMetrics.ts` runs as part of `computeRunMetrics`:

1. Fetch every variant in this run where both `agent_invocation_id` and `parent_variant_id` are non-null.
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
| `evolution/src/services/variantDetailActions.ts` | `getVariantFullChainAction`, `VariantChainNode` |
| `evolution/src/components/evolution/variant/VariantLineageSection.tsx` | Lineage tab UI |
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

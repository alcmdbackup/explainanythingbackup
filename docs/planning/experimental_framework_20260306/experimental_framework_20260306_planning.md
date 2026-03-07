# Experimental Framework Plan

## Background
Build a new standalone experimental framework for the evolution pipeline that includes calculating metrics. This framework will be independent of the existing Taguchi L8 / factorial experiment system, providing a structured way to define, run, and analyze experiments with comprehensive metric calculation across the evolution pipeline.

## Requirements (from GH Issue #647)
- Deprecate the existing L8 experiment system. Build on top of manual experiment groups.
- Calculate metrics for each experiment, for each of its runs: total variants, median elo, 90p elo, max elo, and spend by agent type.
- Backfill metrics for previous experiments, assuming raw inputs are available in the DB.
- Statistical significance where applicable: Elo has confidence intervals, need uncertainty bounds about which strategy is better at increasing elo.

## Problem
The current experiment analysis (`analysis.ts`) only computes per-run Elo, cost, and Elo/$. It provides no variant-level distribution metrics (median/90p/max Elo), no per-agent cost breakdown, and no confidence intervals. The strategy detail view similarly shows only Avg Elo and Total Cost with no distribution or CI. All raw data exists in the DB (`evolution_variants`, `evolution_agent_invocations`) but is not aggregated. The L8 factorial design code was documented but never implemented — only manual experiments exist in production.

## Options Considered

### Metrics computation location
1. **Server action (on-demand SQL)** — Query variants + invocations when page loads. Always fresh, no storage overhead. Slower for large experiments but these are small (3-10 runs × ~50 variants each).
2. **Pre-compute at finalization** — Compute and store in `analysis_results` JSONB when experiment reaches terminal state. Fast reads but stale if runs are added later.
3. **Hybrid** ← Recommended — Compute on-demand for active experiments, cache in `analysis_results` when terminal. Backfill script uses the same computation function.

### Statistical significance approach
1. **Pairwise comparisons (Cohen's d, Welch's t-test)** — Compare strategies against each other. Rejected: pairwise explosion, harder to interpret.
2. **Per-strategy bootstrap CIs (point estimates only)** — Bootstrap over raw max-Elo values per run. Simple but ignores within-run rating uncertainty.
3. **Per-strategy bootstrap CIs with uncertainty propagation** ← Recommended — Each bootstrap resample draws from a run's Elo distribution (using OpenSkill sigma) rather than using the point estimate. Produces wider CIs when within-run uncertainty is high (few matches), converges to option 2 when sigma is small. No extra dependencies, ~5 lines on top of plain bootstrap.

### Deprecation strategy
1. **Remove L8/factorial entirely** — Clean but risky if constraint has data.
2. **Hide from UI, keep in schema** ← Recommended — No existing data uses L8/full-factorial. Hide from experiment creation form, mark as deprecated in docs. No migration needed.

## Phased Execution Plan

### Phase 1: Core Metrics Computation
**Goal:** Pure functions that compute all requested metrics from DB data. Shared by both experiment and strategy views.

**Files to create:**
- `evolution/src/experiments/evolution/experimentMetrics.ts` (NEW) — Core metrics computation + bootstrap CI
- `supabase/migrations/YYYYMMDD_compute_run_variant_stats.sql` (NEW) — Postgres RPC for PERCENTILE_CONT queries (cannot use Supabase JS query builder for window aggregates)

**Types:**
```typescript
/** Canonical metric names. Agent costs use template literal pattern. */
type MetricName =
  | 'totalVariants' | 'medianElo' | 'p90Elo' | 'maxElo' | 'cost' | 'eloPer$'
  | `agentCost:${string}`;

/** A single metric measurement.
 *  - Single run: value is the point estimate, sigma carries within-run uncertainty (Elo only), ci is null
 *  - Aggregated: value is the mean, sigma is null (consumed during bootstrap), ci is the output */
interface MetricValue {
  value: number;
  sigma: number | null;          // within-run uncertainty (Elo-scale), for propagation into cross-run bootstrap
  ci: [number, number] | null;   // 95% bootstrap CI (null for single run or N < 2)
  n: number;                     // 1 for single run, N for aggregate
}

/** Flat map of all metrics. Single type used everywhere.
 *  Uses index signature since MetricName includes template literals (agentCost:*).
 *  Not all metrics are present in every bag (e.g., runs with no agent invocations). */
type MetricsBag = { [K in MetricName]?: MetricValue | null };
```

**How uncertainty flows through the system:**
```
Single run:
  maxElo:    { value: 1500, sigma: 40,   ci: null, n: 1 }   ← sigma from top variant's OpenSkill rating
  medianElo: { value: 1320, sigma: null, ci: null, n: 1 }   ← no single sigma (see variantRatings below)
  cost:      { value: 2.30, sigma: null, ci: null, n: 1 }   ← no uncertainty on cost

  Each run also stores variantRatings: Array<{mu, sigma}> on the RunMetricsWithRatings object
  (not in MetricsBag itself). This is used by aggregateMetrics for percentile uncertainty propagation.

Aggregated (strategy with 5 runs):
  maxElo:    { value: 1483, sigma: null, ci: [1430, 1536], n: 5 }  ← sigma-aware bootstrap
  medianElo: { value: 1337, sigma: null, ci: [1310, 1358], n: 5 }  ← percentile bootstrap over all variants' ratings
  cost:      { value: 2.28, sigma: null, ci: [2.08, 2.47], n: 5 }  ← plain bootstrap (no sigma)
```

**Server action return types:**
```typescript
// Experiment detail — per-run metrics, no cross-run CIs
interface ExperimentMetricsResult {
  runs: Array<{ runId: string; status: string; configLabel: string; strategyConfigId: string | null; metrics: MetricsBag }>;
  completedRuns: number;
  totalRuns: number;
  warnings: string[];
}

// Strategy detail — per-run metrics + aggregated with bootstrap CIs
interface StrategyMetricsResult {
  aggregate: MetricsBag;  // cross-run bootstrap CIs, n > 1
  runs: Array<{ runId: string; status: string; configLabel: string; metrics: MetricsBag }>;
}
```

**Key types for aggregation input:**
```typescript
/** Per-run metrics plus variant ratings needed for percentile uncertainty propagation. */
interface RunMetricsWithRatings {
  metrics: MetricsBag;
  variantRatings: Array<{ mu: number; sigma: number }> | null;  // all variants' OpenSkill ratings, null if no checkpoint
}
```

**Key functions:**
- `computeRunMetrics(runId, supabase)` → `RunMetricsWithRatings` — Calls Postgres RPC `compute_run_variant_stats` for PERCENTILE_CONT metrics + Supabase query for agent costs. Loads ALL variant ratings from checkpoint `state_snapshot.ratings` (not just top variant). Returns both the MetricsBag and the full variant ratings array for use in cross-run aggregation.
- `bootstrapMeanCI(values: MetricValue[], rng?)` → `MetricValue` — For scalar metrics. Checks if any input has `sigma`; if so, uses uncertainty-propagating bootstrap (draws from Normal(value, sigma) per resample via Box-Muller). Otherwise uses plain bootstrap. Accepts optional `rng: () => number` for deterministic testing (defaults to `Math.random`). Single function, no caller needs to choose.
- `bootstrapPercentileCI(allRunRatings: Array<Array<{mu, sigma}>>, percentile: number, rng?)` → `MetricValue` — For medianElo/p90Elo. Each bootstrap iteration: pick a run (with replacement), resample that run's variant ratings from Normal(mu, sigma), compute the percentile from the resampled ratings, average across resampled runs. Produces CIs that reflect both between-run variance and within-run rating uncertainty.
- `aggregateMetrics(runData: RunMetricsWithRatings[], rng?)` → `MetricsBag` — Routes each metric to the appropriate bootstrap: `bootstrapPercentileCI` for medianElo/p90Elo (using variantRatings), `bootstrapMeanCI` for everything else. Returns aggregated bag with CIs.

**Postgres RPC function (new migration required):**
```sql
-- Migration: supabase/migrations/YYYYMMDD_compute_run_variant_stats.sql
CREATE OR REPLACE FUNCTION compute_run_variant_stats(p_run_id UUID)
RETURNS TABLE (
  total_variants BIGINT,
  median_elo DOUBLE PRECISION,
  p90_elo DOUBLE PRECISION,
  max_elo DOUBLE PRECISION
) LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    COUNT(elo_score),  -- only count variants with ratings (excludes unrated)
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY elo_score),
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY elo_score),
    MAX(elo_score)
  FROM evolution_variants WHERE run_id = p_run_id AND elo_score IS NOT NULL;
$$;

-- Restrict to service_role (admin-only, consistent with codebase convention)
REVOKE EXECUTE ON FUNCTION compute_run_variant_stats(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compute_run_variant_stats(UUID) TO service_role;
```

Called via `supabase.rpc('compute_run_variant_stats', { p_run_id: runId })`. Agent costs use standard Supabase query builder: `supabase.from('evolution_agent_invocations').select('agent_name, cost_usd').eq('run_id', runId)` with client-side aggregation by agent_name.

**Bootstrap with uncertainty propagation (Elo metrics):**
```typescript
/** Bootstrap that propagates within-run uncertainty into the CI.
 *  For each resample, draws from Normal(elo, sigma) per run instead of using point estimates.
 *  When sigma is small (well-tested variants), behaves like plain bootstrap.
 *  When sigma is large (few matches), correctly widens the CI.
 *  Accepts optional rng for deterministic testing (seed via simple-seedable-rng). */
function bootstrapMeanCI(
  values: MetricValue[],
  iterations = 1000,
  rng: () => number = Math.random  // injectable PRNG for deterministic tests
): MetricValue {
  const hasSigma = values.some(v => v.sigma != null && v.sigma > 0);
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    const n = values.length;
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);  // resample with replacement
      const v = values[idx];
      if (hasSigma && v.sigma != null && v.sigma > 0) {
        // Box-Muller with guard against log(0)
        const u1 = Math.max(Number.EPSILON, rng()), u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        sum += v.value + v.sigma * z;
      } else {
        sum += v.value;
      }
    }
    means.push(sum / n);
  }
  means.sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v.value, 0) / values.length;
  return {
    value: mean,
    sigma: null,  // consumed during bootstrap
    ci: [means[Math.floor(iterations * 0.025)], means[Math.floor(iterations * 0.975)]],
    n: values.length,
  };
}
```

**Bootstrap for percentile Elo metrics (medianElo, p90Elo):**
```typescript
/** Bootstrap CI for a percentile metric across runs, propagating within-run rating uncertainty.
 *  Each iteration: resample runs (with replacement), then for each resampled run,
 *  draw each variant's skill from Normal(mu, sigma), convert to Elo, compute the percentile.
 *  Cost: 1000 iterations × N runs × ~50 variants = ~250K draws. Sub-millisecond.
 *
 *  IMPORTANT: Both point estimate and bootstrap use muToElo(mu) — the posterior mean converted
 *  to Elo scale — NOT the conservative ordinal (mu - 3*sigma). The ordinal is designed for
 *  ranking individual variants; for distribution statistics (median, p90) the posterior mean
 *  is the correct center. This ensures the point estimate and CI are on the same scale. */
function bootstrapPercentileCI(
  allRunRatings: Array<Array<{ mu: number; sigma: number }>>,  // per-run variant ratings
  percentile: number,  // 0.5 for median, 0.9 for p90
  iterations = 1000,
  rng: () => number = Math.random
): MetricValue | null {
  // Guard: filter out empty variant arrays (e.g., corrupted checkpoint data)
  const validRuns = allRunRatings.filter(variants => variants.length > 0);
  if (validRuns.length === 0) return null;

  const nRuns = validRuns.length;
  // Helper: convert posterior mean mu to Elo scale (linear: 1200 + mu * 400/25)
  const muToElo = (mu: number) => ordinalToEloScale(mu);  // ordinalToEloScale is linear: 1200 + ordinal * 16

  const percentileValues: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (let r = 0; r < nRuns; r++) {
      const runIdx = Math.floor(rng() * nRuns);  // resample run
      const variants = validRuns[runIdx];
      // Draw each variant's skill from its posterior, convert to Elo
      const sampledElos: number[] = [];
      for (const v of variants) {
        const u1 = Math.max(Number.EPSILON, rng()), u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        sampledElos.push(muToElo(v.mu + v.sigma * z));
      }
      // Compute percentile from resampled Elos
      sampledElos.sort((a, b) => a - b);
      const idx = Math.min(Math.floor(percentile * sampledElos.length), sampledElos.length - 1);
      sum += sampledElos[idx];
    }
    percentileValues.push(sum / nRuns);
  }
  percentileValues.sort((a, b) => a - b);

  // Point estimate: mean of actual (non-resampled) percentile values across runs
  // Uses muToElo(mu) — same scale as bootstrap samples (posterior mean, not conservative ordinal)
  const actuals = validRuns.map(variants => {
    const elos = variants.map(v => muToElo(v.mu));
    elos.sort((a, b) => a - b);
    return elos[Math.min(Math.floor(percentile * elos.length), elos.length - 1)];
  });
  const mean = actuals.reduce((s, v) => s + v, 0) / actuals.length;
  return {
    value: mean,
    sigma: null,
    ci: [percentileValues[Math.floor(iterations * 0.025)], percentileValues[Math.floor(iterations * 0.975)]],
    n: nRuns,
  };
}

/** Scale consistency between per-run and aggregated medianElo/p90Elo:
 *
 *  Per-run (single run MetricsBag):
 *    medianElo/p90Elo come from SQL PERCENTILE_CONT over elo_score, which is ordinal-based
 *    (ordinalToEloScale(mu - 3*sigma)). This is the standard Elo representation in the UI.
 *
 *  Aggregated (strategy MetricsBag via bootstrapPercentileCI):
 *    The bootstrap samples "true skills" from Normal(mu, sigma), computes ordinals for those
 *    known skills (sigma=0 → ordinal = mu_sampled), then converts to Elo.
 *    This is mu-based Elo — systematically higher than ordinal-based by ~3*sigma*16 per variant.
 *
 *  To keep scales consistent, aggregateMetrics for medianElo/p90Elo uses the point estimate
 *  computed by bootstrapPercentileCI itself (mu-based, line "const mean = actuals..."),
 *  NOT the mean of per-run SQL values. The CI and point estimate are thus on the same scale.
 *
 *  This means aggregated medianElo will be higher than the average of per-run medianElo values.
 *  This is expected and correct: per-run values use the conservative ordinal (penalizes uncertainty),
 *  while the aggregate answers "what is the true median skill?" (posterior mean, unbiased).
 *  Document this distinction in the UI tooltip:
  "Aggregated Elo metrics use posterior mean estimates (unbiased). Per-run Elo uses conservative
   estimates (ordinal = mu - 3*sigma). Aggregated values will be higher than per-run averages —
   this reflects the difference between 'estimated true skill' and 'conservative lower bound'." */
```

**Which bootstrap for which metric:**
| Metric | Bootstrap type | Reason |
|--------|---------------|--------|
| Max Elo | `bootstrapMeanCI` (sigma-aware) | Top variant's sigma propagated via Normal(value, sigma) draws |
| Median Elo | `bootstrapPercentileCI(ratings, 0.5)` | Resamples all variants' ratings per run, computes percentile |
| 90p Elo | `bootstrapPercentileCI(ratings, 0.9)` | Same approach, different percentile |
| Cost | `bootstrapMeanCI` (plain) | No uncertainty on cost values |
| Variants | `bootstrapMeanCI` (plain) | No uncertainty on count values |
| Elo/$ | `bootstrapMeanCI` (plain) | Derived metric, no direct sigma |
| Agent costs | `bootstrapMeanCI` (plain) | No uncertainty on cost values |

**Fallback when variantRatings is null** (no checkpoint): `aggregateMetrics` falls back to plain `bootstrapMeanCI` for medianElo/p90Elo using just the point estimates. This is the same behavior as before — uncertainty propagation is best-effort.

**Mixed variantRatings handling:** When some runs have `variantRatings` and some have `null`, `aggregateMetrics` passes only non-null runs to `bootstrapPercentileCI`. If fewer than 2 runs have ratings, it falls back entirely to plain `bootstrapMeanCI` for all runs. This means `n` for medianElo CI may differ from `n` for cost CI — document this in the UI (e.g., "CI based on N of M runs with rating data").

**Data access patterns:**
```typescript
// Variant stats via Postgres RPC (PERCENTILE_CONT not available in Supabase query builder)
const { data: stats } = await supabase.rpc('compute_run_variant_stats', { p_run_id: runId });

// Agent costs via standard query + client-side GROUP BY
const { data: invocations } = await supabase
  .from('evolution_agent_invocations')
  .select('agent_name, cost_usd')
  .eq('run_id', runId);
const agentCosts = new Map<string, number>();
for (const inv of invocations ?? []) {
  agentCosts.set(inv.agent_name, (agentCosts.get(inv.agent_name) ?? 0) + inv.cost_usd);
}
```

**Max Elo CI (within-run):** For each run, extract top variant's mu/sigma from `run_summary.topVariants[0]` or checkpoint. Map to Elo scale: `[ordinalToEloScale(mu - 1.96*sigma), ordinalToEloScale(mu + 1.96*sigma)]`. Store sigma in Elo scale as `maxEloSigma` for use in cross-run bootstrap.

**Variant ratings extraction:** `computeRunMetrics` loads ALL variant `{mu, sigma}` from the latest checkpoint's `state_snapshot.ratings` map. This serves two purposes:
1. **maxElo sigma:** Top variant's sigma (identified by `run_summary.topVariants[0].id`) is converted to Elo scale and stored in `maxElo.sigma` for cross-run bootstrap.
2. **Percentile uncertainty:** The full `Array<{mu, sigma}>` is returned as `variantRatings` on `RunMetricsWithRatings` for use by `bootstrapPercentileCI` during cross-run aggregation of medianElo/p90Elo.

If no checkpoint exists, `variantRatings = null` and `maxElo.sigma = null` — both fall back to plain bootstrap (point estimates only).

**Checkpoint query performance:** For single-run calls (experiment detail page), one checkpoint query is acceptable. For batch operations (backfill, strategy aggregation), batch-load checkpoints for all run IDs in a single query, then extract ratings per run from the result map. Payload size is manageable: ~50 variants × `{mu, sigma}` ≈ 1KB per run.

### Phase 2: Experiment Metrics — Server Action + Cron + UI
**Goal:** Experiment detail page shows per-run metrics with Elo CIs but no cross-run aggregation.

**Files to modify:**
- `evolution/src/services/experimentActions.ts` — Add `getExperimentMetricsAction(experimentId)`
- `src/app/api/cron/experiment-driver/route.ts` — Replace `computeManualAnalysis()` in `handleAnalyzing()`. Note: `computeManualAnalysis` takes pure inputs `(dbRuns, extractEloFn)`, while `computeRunMetrics` takes `(runId, supabase)` requiring async DB access. The cron handler must be restructured to pass supabase client and iterate runs with async calls, not just swap functions.
- `src/app/api/cron/experiment-driver/route.ts` — **JSONB write strategy**: The `analysis_results` write happens in `handleAnalyzing()` (around line 115-121), NOT in `writeTerminalState()` (which writes `results_summary`). Change the `handleAnalyzing()` analysis_results write from full-column overwrite (`.update({ analysis_results: result })`) to a read-merge-write that preserves existing keys: read current `analysis_results`, merge legacy result + new `metrics_v2` key, then `.update()`. This is safe because the cron handler is the only writer during analysis transitions (no concurrent writes). This harmonizes with the backfill script's merge approach and prevents the cron from destroying backfilled data.
- `evolution/src/experiments/evolution/analysis.ts` — Deprecate `computeManualAnalysis` (keep for backward compat)
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx` — Replace `ManualAnalysisView` with new metrics table

**New server action** (follows existing two-step pattern in `experimentActions.ts`):
```typescript
// Inner function with logging wrapper
const _getExperimentMetrics = withLogging(
  async (experimentId: string): Promise<ActionResult<ExperimentMetricsResult>> => {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    // 1. Fetch experiment + runs (with config, run_summary, total_cost_usd)
    // 2. For each completed run, computeRunMetrics()
    // 3. Return ExperimentMetricsResult (per-run detail, no cross-run CIs)
  }
);
// Export with request ID wrapper
export const getExperimentMetricsAction = serverReadRequestId(_getExperimentMetrics);
```

**Experiment detail UI layout:**
| Column | Source |
|--------|--------|
| Run ID | Link to run detail |
| Status | Badge |
| Strategy | Config label |
| Variants | `totalVariants` |
| Median Elo | `medianElo` |
| 90p Elo | `p90Elo` |
| Max Elo | `maxElo` with CI tooltip showing `maxEloCI` |
| Cost | `totalCost` |
| Elo/$ | `eloPer$` |
| Agent Costs | Expandable row showing `agentCosts` breakdown |

**Summary cards at top:** Total runs, completed runs, total spend, best max Elo (with CI).

### Phase 3: Strategy Metrics — Server Action + UI
**Goal:** Strategy detail page shows same per-run metrics PLUS cross-run bootstrap CIs on aggregated metrics.

**Files to modify:**
- `evolution/src/services/experimentActions.ts` — Add `getStrategyMetricsAction(strategyConfigId)` (same file as experiment metrics — uses standard `withLogging` + `serverReadRequestId` pattern, unlike `eloBudgetActions.ts` which uses bare async functions)
- `src/app/admin/evolution/strategies/[strategyId]/page.tsx` — Add metrics section
- `src/app/admin/evolution/strategies/[strategyId]/StrategyMetricsSection.tsx` (NEW) — Client component for interactive metrics UI (CI tooltips, expandable agent cost rows)

**New server action** (in `experimentActions.ts`, follows existing two-step pattern):
```typescript
const _getStrategyMetrics = withLogging(
  async (strategyConfigId: string): Promise<ActionResult<StrategyMetricsResult>> => {
    await requireAdmin();
    const supabase = await createSupabaseServiceClient();
    // 1. Fetch all runs with this strategy_config_id
    // 2. For each completed run, computeRunMetrics()
    // 3. aggregateMetrics() → bootstrap CIs
    // 4. Return StrategyMetricsResult (both aggregate and per-run detail)
  }
);
export const getStrategyMetricsAction = serverReadRequestId(_getStrategyMetrics);
```

**Strategy detail UI additions:**

**New aggregate metrics section** (above existing run history):
```
┌─────────────────────────────────────────────────────────────┐
│  Max Elo           Median Elo        90p Elo                │
│  1483 [1445,1521]  1337 [1318,1352]  1420 [1395,1448]      │
│                                                             │
│  Avg Cost          Avg Variants      Elo/$                  │
│  $2.28 [$2.08,$2.47]  47 [42,52]    118 [95,142]           │
│                                                             │
│  Agent Cost Breakdown (mean across runs)                    │
│  generation: $0.45 [$0.38,$0.52]                            │
│  tournament: $0.62 [$0.55,$0.70]                            │
│  ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

Each metric shows `mean [ci_lower, ci_upper]`. CI hidden for N < 2. Flagged "low confidence" for N = 2.

**Enhanced run history table** — same columns as experiment view (Variants, Median Elo, 90p Elo, Max Elo w/ CI, Agent Costs expandable).

### Phase 4: Backfill Script
**Goal:** Recompute metrics for all completed experiments + populate strategy aggregate data.

**Files to create:**
- `evolution/scripts/backfill-experiment-metrics.ts` (NEW)

**Safety requirements** (following `backfill-prompt-ids.ts` patterns):
- **Idempotency:** Store metrics under a new JSONB key `analysis_results.metrics_v2` rather than overwriting existing `analysis_results`. Re-running produces identical results. Existing `analysis_results` data (used by current UI) is preserved for rollback.
- **Dry-run mode:** `--dry-run` flag computes metrics and logs results without writing to DB. Default behavior.
- **Batch processing:** Process experiments in batches of 10. Log progress after each batch (`Processed 10/47 experiments`).
- **Partial failure handling:** If a single experiment fails, log the error and continue. At the end, report: `N succeeded, M failed, K skipped (no runs/no variant data)`. Failed experiment IDs are logged for retry.
- **Checkpoint batch loading:** For sigma extraction, batch-load all checkpoints for runs in the current batch in a single query, rather than N individual checkpoint queries.

**Logic:**
1. Query all experiments with status `completed` or `failed`
2. Process in batches of 10:
   a. Batch-load checkpoints for all runs in the batch
   b. For each experiment, call `computeRunMetrics()` per run
   c. Merge result into `analysis_results` using read-merge-write pattern (consistent with `backfill-diff-metrics.ts`):
      ```typescript
      // Read current analysis_results
      const { data: experiment } = await supabase
        .from('evolution_experiments').select('analysis_results').eq('id', experimentId).single();
      // Merge: preserve existing keys, add/replace metrics_v2
      const merged = { ...(experiment?.analysis_results ?? {}), metrics_v2: newMetrics };
      // Write back
      await supabase.from('evolution_experiments').update({ analysis_results: merged }).eq('id', experimentId);
      ```
      This is safe because the backfill script runs serially (no concurrent writers). Follows the same pattern as `backfill-diff-metrics.ts` which merges into execution_detail JSONB.
3. Report: N succeeded, M failed, K skipped (no runs / no variant data)

**Checkpoint fallback:** For runs without persisted variants, use `buildVariantsFromCheckpoint()` pattern from `evolutionVisualizationActions.ts` (note: not `evolutionActions.ts` — the function is in the visualization module).

**Note:** This fallback also applies to `computeRunMetrics()` itself, not just the backfill script. When the RPC `compute_run_variant_stats` returns `total_variants = 0` AND a checkpoint exists for the run, `computeRunMetrics` must reconstruct variant Elo scores from `checkpoint.state_snapshot.ratings` (using `ordinalToEloScale(getOrdinal({mu, sigma}))` per variant) and compute percentile metrics in TypeScript (sort + index for median/p90/max). This fallback path should be tested in both unit and integration tests.

**Rollback plan:** If the new metrics format causes issues, the old `analysis_results` data remains untouched. The UI reads from `metrics_v2` key when available, falls back to existing data otherwise. To rollback, simply revert the UI code — no data migration needed.

**Note:** Strategy aggregate metrics (with bootstrap CIs) are computed on-demand in the server action, not stored — no backfill needed for strategies.

### Phase 5: Deprecate L8/Factorial
**Goal:** Clean up references to the unimplemented L8 system.

**Files to modify:**
- `evolution/docs/evolution/strategy_experiments.md` — Add deprecation notice, note that manual experiments replace L8
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx` — Ensure only manual design is offered (already the case)
- No migration needed — `design` CHECK constraint can keep `L8` and `full-factorial` values for backward compat

## Testing

### Deterministic PRNG Strategy
All bootstrap functions accept an optional `rng: () => number` parameter (defaults to `Math.random`). Unit tests use a seeded PRNG (simple linear congruential generator) to make bootstrap results deterministic. Use low iteration count (100) in tests for speed.

```typescript
// Test helper: seedable PRNG (Numerical Recipes LCG, output in [0, 1))
function createSeededRng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0x100000000; };
}
```

### Unit Tests
- `evolution/src/experiments/evolution/experimentMetrics.test.ts` (NEW)
  - `bootstrapMeanCI` (with seeded RNG):
    - Verify CI narrows with more samples (N=3 vs N=10, same values)
    - Verify CI contains true mean for known distribution
    - Verify CI is wider when sigma is large vs sigma ≈ 0 (uncertainty propagation)
    - Verify falls back to point estimate for runs without sigma (sigma=null)
    - Verify Box-Muller guard: no NaN/Infinity when RNG returns very small values
  - `bootstrapPercentileCI` (with seeded RNG):
    - Verify CI contains true percentile for known distribution
    - Verify CI is wider when variant sigmas are large vs small
    - Verify fallback: when variantRatings is null, aggregateMetrics uses plain bootstrapMeanCI instead
    - Verify computational correctness: known 5-variant ratings → expected median/p90
    - Verify empty variant array guard: returns null, does not produce NaN
    - Verify single-variant-per-run edge case: percentile of 1-element array returns that element
    - Verify mixed runs: some with empty arrays are filtered out, others still computed
    - Verify Box-Muller guard: no NaN/Infinity (same guard as bootstrapMeanCI)
  - `computeRunMetrics` (mocked Supabase):
    - Mock `supabase.rpc('compute_run_variant_stats')` return, verify MetricsBag mapping
    - Mock agent invocation query, verify client-side GROUP BY aggregation
    - Mock checkpoint query, verify ALL variant ratings extracted from `state_snapshot.ratings` (not just top variant)
    - Verify `variantRatings` array has correct length and mu/sigma values
    - **Note:** Unit tests verify data mapping only. SQL correctness (PERCENTILE_CONT) is covered by integration tests.
  - `aggregateMetrics`:
    - Mock multiple RunMetricsWithRatings inputs, verify cross-run aggregation
    - Verify N < 2 returns null CIs
    - Verify maxElo uses sigma-aware bootstrapMeanCI, medianElo/p90Elo use bootstrapPercentileCI, cost uses plain bootstrapMeanCI
    - Verify medianElo/p90Elo CIs are wider than plain bootstrap when variant sigmas are large
    - Verify mixed variantRatings: some runs have ratings (use percentile bootstrap), some null (excluded from percentile bootstrap, included in plain bootstrap fallback)
    - Verify aggregated medianElo point estimate uses mu-based Elo (from bootstrapPercentileCI), not mean of per-run ordinal-based values. Assertion: construct runs with high sigma variants where mu-based and ordinal-based differ significantly (e.g., sigma=8, difference ≈ 384 Elo), verify aggregated value is within ±50 of mu-based expectation and >300 away from ordinal-based expectation.
    - Verify computeRunMetrics checkpoint fallback: when RPC returns total_variants=0 and checkpoint exists, reconstructs variants from checkpoint ratings
  - Edge cases: single run (no CI), all runs failed (empty bag), runs with no variants (null Elo fields), runs without checkpoint (null sigma → plain bootstrap fallback), runs with no agent invocations (empty agent cost metrics with warning)

- `evolution/src/services/experimentActions.test.ts` (MODIFY — add new tests)
  - `getExperimentMetricsAction`: mock supabase, verify it returns `ExperimentMetricsResult` shape
  - `getStrategyMetricsAction`: mock supabase, verify it returns `StrategyMetricsResult` shape with aggregate CIs

- `evolution/scripts/backfill-experiment-metrics.test.ts` (NEW — follows `backfill-prompt-ids.test.ts` pattern)
  - Verify idempotency: running twice produces same results
  - Verify dry-run mode: no DB writes
  - Verify partial failure: one experiment fails, others still processed
  - Verify batch processing: experiments processed in groups of 10

### Integration Tests
- `src/__tests__/integration/experiment-metrics.integration.test.ts` (NEW)
  - Insert test variants with known elo_scores, verify `compute_run_variant_stats` RPC returns expected PERCENTILE_CONT values
  - Insert test agent invocations, verify cost aggregation by agent_name
  - Verify backfill produces correct results for a completed experiment
  - Verify rollback: existing `analysis_results` data preserved after backfill (new data in `metrics_v2` key)
  - **Cleanup:** Follow `manual-experiment.integration.test.ts` pattern with explicit `afterAll` cleanup of inserted test data

### Backward Compatibility
- Verify `computeManualAnalysis` (deprecated) still works unchanged — no modifications to its behavior
- Verify existing `ExperimentAnalysisCard` renders correctly with old `analysis_results` format (before backfill)

### Manual Verification
- Create experiment with 3+ runs on staging
- Verify per-run metrics in experiment detail page
- Navigate to strategy detail, verify bootstrap CIs appear and make sense
- Run backfill script in dry-run mode on staging, verify output
- Run backfill script on staging, verify existing experiments get updated `analysis_results.metrics_v2`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/experimental_framework.md` — Primary doc for this feature (NEW, created at init)
- `evolution/docs/evolution/strategy_experiments.md` — Add deprecation notice, cross-ref to new framework
- `evolution/docs/evolution/visualization.md` — Document new experiment and strategy metrics UI
- `evolution/docs/evolution/reference.md` — Add backfill script to CLI commands section
- `evolution/docs/evolution/README.md` — Add entry for experimental framework doc

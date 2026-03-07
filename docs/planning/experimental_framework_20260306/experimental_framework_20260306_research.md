# Experimental Framework Research

## Problem Statement
Build a new standalone experimental framework for the evolution pipeline that includes calculating metrics. This framework will be independent of the existing Taguchi L8 / factorial experiment system, providing a structured way to define, run, and analyze experiments with comprehensive metric calculation across the evolution pipeline.

## Requirements (from GH Issue #647)
- Deprecate the existing L8 experiment system. Build on top of manual experiment groups.
- Calculate metrics for each experiment, for each of its runs: total variants, median elo, 90p elo, max elo, and spend by agent type.
- Backfill metrics for previous experiments, assuming raw inputs are available in the DB.
- Statistical significance where applicable: Elo has confidence intervals, need uncertainty bounds about which strategy is better at increasing elo.

## High Level Summary

The existing experiment system has two modes: an L8 factorial design (documented but code doesn't exist yet for `factorial.ts` or `factorRegistry.ts`) and manual experiments. The manual experiment infrastructure is functional and will be the foundation. The current analysis (`analysis.ts`) only computes per-run Elo, cost, and Elo/$ — none of the requested metrics (total variants, percentile Elo, agent-type spend) are computed.

All raw data needed for the requested metrics is available in the DB:
- **Total variants**: `evolution_variants` table (by run_id), with checkpoint fallback
- **Elo distribution** (median, 90p, max): `evolution_variants.elo_score` (0-3000 scale, always populated for completed runs)
- **Spend by agent type**: `evolution_agent_invocations.cost_usd` (incremental per invocation, grouped by agent_name)
- **Statistical significance**: OpenSkill mu/sigma provides per-variant uncertainty; strategy-level confidence requires aggregation across runs

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/entity_diagram.md

## Code Files Read
- `evolution/src/experiments/evolution/analysis.ts` — Current manual analysis: only computes per-run Elo, cost, Elo/$. `ManualRunResult` and `ManualAnalysisResult` types. No variant-level or agent-level metrics.
- `evolution/src/services/experimentActions.ts` — Experiment lifecycle: `createManualExperimentAction`, `addRunToExperimentAction`, `startManualExperimentAction`, `getExperimentStatusAction`, `getExperimentRunsAction`. Elo extracted via `extractTopElo()`.
- `evolution/src/services/experimentHelpers.ts` — `extractTopElo()`: reads `run_summary.topVariants[0].ordinal` and converts via `ordinalToEloScale()`.
- `evolution/src/lib/core/rating.ts` — OpenSkill wrapper: `createRating()` (mu=25, sigma=8.333), `getOrdinal()` (mu - 3*sigma), `ordinalToEloScale()` (maps to 0-3000). `openskill` v4.1.0.
- `evolution/src/lib/core/metricsWriter.ts` — `persistAgentMetrics()`: computes per-agent avg_elo, elo_gain, elo_per_dollar. `STRATEGY_TO_AGENT` mapping for variant strategy → agent name.
- `evolution/src/services/eloBudgetActions.ts` — Strategy leaderboard, agent ROI leaderboard, Pareto analysis. All existing metric aggregation.
- `evolution/src/services/evolutionActions.ts` — `getEvolutionVariantsAction`: queries `evolution_variants` by run_id with checkpoint fallback via `buildVariantsFromCheckpoint()`.
- `src/app/api/cron/experiment-driver/route.ts` — State machine: pending → running → analyzing → completed/failed. `computeManualAnalysis()` called during analyzing. `writeTerminalState()` persists results_summary and generates LLM report.
- `evolution/src/services/strategyResolution.ts` — Strategy dedup via SHA-256 config hash. `resolveOrCreateStrategyFromRunConfig()` for pre-registration.

### DB Schema Files
- `supabase/migrations/20260131000002_content_evolution_variants.sql` — variants table with elo_score (0-3000)
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` — per-agent metrics table
- `supabase/migrations/20260212000001_evolution_agent_invocations.sql` — per-invocation cost tracking
- `supabase/migrations/20260222100003_add_experiment_tables.sql` — experiments table
- `supabase/migrations/20260303000001_...` — Flattened model: experiment_id FK on runs
- `supabase/migrations/20260304000003_...` — Added `manual` design type

### UI Components
- `src/app/admin/evolution/analysis/_components/ExperimentForm.tsx` — 3-step wizard for manual experiments
- `src/app/admin/evolution/analysis/_components/ExperimentStatusCard.tsx` — Real-time status
- `src/app/admin/evolution/analysis/_components/ExperimentHistory.tsx` — Past experiments list
- `src/app/admin/evolution/experiments/[experimentId]/ExperimentAnalysisCard.tsx` — Shows ManualAnalysisView (run table with Elo, Cost, Elo/$)
- `src/app/admin/evolution/experiments/[experimentId]/RunsTab.tsx` — Flat run table

## Key Findings

### 1. Existing Experiment Infrastructure
- Manual experiments work: create → add runs → start → cron drives state machine → analysis → complete
- `evolution_experiments` table has `design` field with CHECK constraint allowing `L8`, `full-factorial`, `manual`
- The L8/factorial code (`factorial.ts`, `factorRegistry.ts`, `experimentValidation.ts`) doesn't exist yet — only docs
- `analysis_results` JSONB stores analysis output; `results_summary` JSONB stores best Elo/config/report

### 2. Metrics Data Availability
| Metric | Data Source | Available? |
|--------|-----------|------------|
| Total variants per run | `COUNT(*) FROM evolution_variants WHERE run_id = ?` | Yes |
| Median Elo | `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY elo_score) FROM evolution_variants` | Yes |
| 90th percentile Elo | `PERCENTILE_CONT(0.9) ...` | Yes |
| Max Elo | `MAX(elo_score) FROM evolution_variants` or `run_summary.topVariants[0]` | Yes |
| Spend by agent type | `SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id = ? GROUP BY agent_name` | Yes |
| Checkpoint fallback | `evolution_checkpoints.state_snapshot.pool` + `.ratings` | Yes (for runs without persisted variants) |

### 3. Statistical Significance Approaches
- **Per-variant level**: OpenSkill provides mu/sigma per variant. Confidence interval = `mu ± 1.96 * sigma` (95% CI). Already used in arena leaderboard.
- **Per-run level**: `run_summary.topVariants[0].ordinal` gives best variant's conservative estimate. No per-run CI currently.
- **Cross-run strategy comparison**: Need to aggregate across multiple runs of the same strategy. Approaches:
  1. **Welch's t-test**: Compare mean Elo between two strategies across their runs. Already have per-strategy avg/stddev in `evolution_strategy_configs`.
  2. **Bootstrap CI**: Resample run Elo scores to get CI on mean difference. Already used for `FactorRanking.ci_lower/ci_upper` in the factorial analysis code.
  3. **Effect size (Cohen's d)**: `(mean_A - mean_B) / pooled_stddev` — practical significance measure.
  4. **OpenSkill sigma propagation**: For single runs, the top variant's sigma gives direct uncertainty. For multi-run comparisons, propagate uncertainty via `sqrt(sum(sigma^2) / N)`.

### 4. Experiment Grouping
- Current: `evolution_experiments` → `evolution_runs` via `experiment_id` FK (1:N)
- No concept of experiment groups — each experiment is independent
- The requirement says "manual experiment groups" = the existing manual experiment system, not a new grouping layer
- Each experiment already groups multiple runs; metrics should be computed per-experiment across its runs

### 5. What Needs to Change
- `analysis.ts`: Extend `ManualAnalysisResult` with new metrics (variant counts, percentile Elo, agent spend)
- New server action: `computeExperimentMetricsAction(experimentId)` that queries variants + invocations
- Backfill script: iterate completed experiments, compute metrics, store in `analysis_results`
- Statistical significance: add CI computation for strategy comparison within an experiment
- UI: update `ExperimentAnalysisCard` to show new metrics table
- Deprecation: remove L8/factorial design CHECK constraint and related UI (or just hide it)

### 6. Backfill Feasibility
- Completed runs with persisted variants: straightforward SQL aggregation
- Completed runs without variants (e.g., local CLI runs): use `buildVariantsFromCheckpoint()` pattern
- `evolution_agent_invocations` present for all production runs since migration 20260212000001
- `evolution_run_agent_metrics` present since 20260205000001
- Historical runs before these migrations won't have per-agent data

## Statistical Significance Deep Dive

### Two Sources of Uncertainty

**1. Within-run rating uncertainty (OpenSkill sigma)**
Each variant's Elo comes from pairwise comparisons. OpenSkill tracks `{mu, sigma}` — mu is estimated skill, sigma is how uncertain that estimate is. A variant with 5 matches has high sigma; one with 50 matches has low sigma.
- Per-variant CI: `mu ± 1.96 * sigma` → 95% confidence interval (already used in arena leaderboard)
- Ordinal (`mu - 3*sigma`) is the conservative lower bound
- When reporting "max Elo for a run," that number itself has uncertainty from the top variant's sigma

**2. Between-run strategy variability**
Running the same strategy config multiple times on the same prompt yields different max-Elo values due to LLM non-determinism, different generation seeds, random tournament pairings, etc. This is the harder problem and the real question: "which strategy is better?"

### Tool Options Evaluated

| Tool | How it works | Pros | Cons | Min N |
|------|-------------|------|------|-------|
| **Welch's t-test** | Compare mean max-Elo between two strategies | Simple, gives CI on difference, well-understood | Assumes normality | N≥2 (N≥5 preferred) |
| **Bootstrap CI** | Resample run Elos 1000x, compute mean difference, take 2.5/97.5 percentiles | No normality assumption, already a pattern in codebase (`FactorRanking`) | Slightly more compute (trivial at these sizes) | N≥3 |
| **Mann-Whitney U** | Non-parametric rank test | Robust to outliers, no distribution assumptions | No magnitude CI, less intuitive | N≥3 |
| **Weighted mean (sigma²)** | Weight each run's max-Elo by 1/sigma² of its top variant | Principally correct, accounts for both uncertainty sources | Sigma may not be available (checkpoint-only runs) | N≥2 |
| **Cohen's d effect size** | `(mean_A - mean_B) / pooled_std` | Practical significance (small=0.2, medium=0.5, large=0.8) | Needs variance, complementary to CI | N≥2 |

### Recommended Approach: Per-Strategy Bootstrap CIs (no pairwise comparison)

Instead of comparing strategies pairwise, compute CIs on each strategy's own metrics independently. The reader compares by eye — non-overlapping CIs mean clearly different strategies; overlapping CIs mean inconclusive.

**Per-run level:** Report max Elo with its CI from OpenSkill sigma (within-run uncertainty). Cheap and already available from `run_summary.topVariants[0]`.

**Per-strategy level (cross-run):** Bootstrap CI on each strategy's mean for every metric:
- `bootstrapMeanCI(maxElos)` → "Mean max Elo: 1483 [1445, 1521]"
- `bootstrapMeanCI(medianElos)` → "Mean median Elo: 1337 [1318, 1352]"
- `bootstrapMeanCI(costs)` → "Mean cost: $2.28 [$2.08, $2.47]"
- Same pattern for Elo/$, total variants, etc.

**Sample size handling:**
- N=1: report raw value, no CI
- N=2: CI computable but very wide (flag as "low confidence")
- N≥3: meaningful bootstrap CI

**Implementation — two bootstrap variants:**

Plain bootstrap for metrics without inherent uncertainty (cost, variant count):
```typescript
function bootstrapMeanCI(values: number[], iterations = 1000): MetricWithCI {
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sample = Array.from({ length: values.length }, () => values[Math.floor(Math.random() * values.length)]);
    means.push(sample.reduce((a, b) => a + b, 0) / sample.length);
  }
  means.sort((a, b) => a - b);
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, ci: [means[Math.floor(iterations * 0.025)], means[Math.floor(iterations * 0.975)]], n: values.length };
}
```

Uncertainty-propagating bootstrap for Elo metrics (max Elo). Each resample draws from Normal(elo, sigma) using the top variant's OpenSkill sigma, rather than treating the Elo as a fixed point:
```typescript
function bootstrapMeanCI_withUncertainty(runs: Array<{ value: number; sigma: number }>, iterations = 1000): MetricWithCI {
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let sum = 0;
    for (const run of runs) {
      const u1 = Math.random(), u2 = Math.random();
      const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); // Box-Muller
      sum += run.value + run.sigma * z;
    }
    means.push(sum / runs.length);
  }
  means.sort((a, b) => a - b);
  return { mean: runs.reduce((s, r) => s + r.value, 0) / runs.length, ci: [means[Math.floor(iterations * 0.025)], means[Math.floor(iterations * 0.975)]], n: runs.length };
}
```

When sigma is small (well-tested top variant, many matches), this converges to plain bootstrap. When sigma is large (few matches, uncertain rating), it correctly widens the CI. Runs without available sigma (no checkpoint) fall back to point estimate (sigma=0).

This replaces the earlier pairwise comparison approach (Cohen's d, Welch's t-test). Each strategy stands on its own.

### Strategy Detail View (Current State)

**File:** `src/app/admin/evolution/strategies/[strategyId]/page.tsx`

Currently displays:
- Overview: Runs count, Avg Elo, Total Cost, Avg $/Run, Created By
- Configuration: models, iterations, enabled agents
- Run history table: Run ID, Status, Topic, Elo, Cost, Iters, Date

**Missing (to be added):**
- Per-run: total variants, median Elo, 90p Elo, agent cost breakdown
- Cross-run: bootstrap CIs on all aggregate metrics (mean max Elo, mean cost, etc.)
- No variant-level distribution metrics at all

**Sample size handling:**
- N=1: show raw value, no CI
- N=2: Welch's t-test CI only (wide, flagged "low confidence")
- N≥3: bootstrap CI + Cohen's d
- N≥5: full confidence reporting

### Implementation Notes

Bootstrap CI is ~20 lines of pure TypeScript (no dependencies needed):
```typescript
function bootstrapCI(a: number[], b: number[], iterations = 1000): { ci: [number, number]; meanDiff: number } {
  const diffs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const sampleA = Array.from({ length: a.length }, () => a[Math.floor(Math.random() * a.length)]);
    const sampleB = Array.from({ length: b.length }, () => b[Math.floor(Math.random() * b.length)]);
    diffs.push(mean(sampleA) - mean(sampleB));
  }
  diffs.sort((x, y) => x - y);
  return { ci: [diffs[Math.floor(iterations * 0.025)], diffs[Math.floor(iterations * 0.975)]], meanDiff: mean(a) - mean(b) };
}
```

Cohen's d is similarly trivial:
```typescript
function cohensD(a: number[], b: number[]): number {
  const pooledStd = Math.sqrt(((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / (a.length + b.length - 2));
  return pooledStd === 0 ? 0 : (mean(a) - mean(b)) / pooledStd;
}
```

Within an experiment, comparisons are pairwise between all strategy pairs. For K strategies, that's K*(K-1)/2 comparisons, but K is typically small (2-5).

## Open Questions

1. Should metrics be computed on-demand (query time) or pre-computed and stored in `analysis_results` JSONB?
   - On-demand: always fresh, no storage overhead, but slower for large experiments
   - Pre-computed: fast reads, but needs refresh mechanism
   - Recommendation: compute on-demand for now, cache in `analysis_results` when experiment reaches terminal state

2. For statistical significance, what's the minimum number of runs per strategy to report confidence intervals?
   - Welch's t-test needs N >= 2 per group; N >= 5 preferred
   - Bootstrap needs N >= 3 minimum

3. Should the L8/factorial code path be fully removed or just hidden from the UI?
   - The `design` CHECK constraint includes 'L8' and 'full-factorial'
   - No existing data uses these values (only 'manual' experiments exist)
   - Recommendation: keep the constraint but hide from UI; mark as deprecated in docs

4. How should "spend by agent type" be presented? Per-run breakdown, or aggregated across the experiment?
   - Likely both: per-run in the runs table, aggregated in the experiment summary

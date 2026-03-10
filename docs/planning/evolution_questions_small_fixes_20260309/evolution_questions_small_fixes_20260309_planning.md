# Evolution Questions Small Fixes Plan

## Background
Investigate evolution system questions around agent budgets and max Elo confidence intervals, and apply small fixes. Additionally, investigate a production run (223bc062) that exceeded its cost budget to understand what went wrong and improve cost estimation.

## Requirements (from GH Issue)
1. Per-agent budget clarification: confirm tracking-only, update docs/comments
2. maxElo confidence interval naming: fix the confusing overloaded `sigma` field
3. Production run 223bc062 cost overrun: investigate and improve estimations

## Problem
The `MetricValue` interface uses a `sigma` field that means completely different things depending on the metric. For most metrics it's `null` (CIs come from bootstrap), but for `maxElo` it holds the top variant's Bayesian uncertainty. The UI displays this as `±sigma` which looks like a confidence interval but isn't one. This creates confusion when interpreting experiment results.

## Options Considered

### Option A: Give maxElo a proper bootstrap CI (like other metrics)
- Change `experimentMetrics.ts` to compute `bootstrapPercentileCI` for maxElo (similar to medianElo/p90Elo)
- Remove the `sigma` override — maxElo gets `ci: [lower, upper]` and `sigma: null` like everything else
- **Pros**: Consistent interface, proper statistical CI, UI "just works"
- **Cons**: Slightly different semantics (bootstrap CI vs Bayesian sigma)

### Option B: Rename sigma field to topVariantUncertainty
- Add a dedicated field on MetricValue for the top variant's sigma
- **Pros**: Preserves the Bayesian uncertainty info
- **Cons**: Still not a real CI, UI still needs special-casing

### Option C: Both — bootstrap CI + keep Bayesian sigma as metadata
- Compute proper bootstrap CI for maxElo AND store the top variant sigma separately
- **Pros**: Best of both worlds
- **Cons**: More complexity

**Chosen: Option A** — Simplest fix. The bootstrap CI is what users actually want to see. The raw Bayesian sigma of the top variant is available in the per-variant data if needed.

## Phased Execution Plan

### Phase 1: Fix maxElo sigma → proper display

**Root cause**: `computeRunMetrics()` in `experimentMetrics.ts` calls `scalar(stats.max_elo, topVariantSigmaElo)` (lines 335, 344), which stuffs the top variant's Bayesian sigma (scaled to Elo space) into `MetricValue.sigma`. Two UI files then render this as `±N`, making it look like a CI.

**What sigma actually is**: `topVariant.sigma * (400/25)` = the OpenSkill uncertainty of the single best variant, in Elo-scale points. This is NOT a confidence interval — it's one standard deviation of one variant's rating belief.

**What happens at aggregation**: `aggregateMetrics()` currently routes maxElo through `bootstrapMeanCI()` (line 266) as a fallback — it's not in the `medianElo || p90Elo` special case on line 247. This means maxElo uses mean-of-values bootstrap instead of the proper `bootstrapPercentileCI` that resamples variant ratings within each run. The Box-Muller on per-run sigma partially compensates, but it's treating single-variant uncertainty as run-level noise — not statistically sound.

**Fix (two parts)**:
1. Stop displaying the misleading `±sigma` on per-run rows and stop setting sigma on per-run maxElo
2. Route aggregated maxElo through `bootstrapPercentileCI(percentile=1.0)` — same as medianElo/p90Elo but taking the max instead of 50th/90th percentile. This resamples variant ratings from Normal(mu, sigma) within each run, giving a proper CI that propagates within-run uncertainty correctly.

#### Step 1: Remove misleading ±sigma display from per-run tables

**`ExperimentAnalysisCard.tsx:136-143`** — Remove the sigma span:
```tsx
// Before:
{fmtNum(m.maxElo?.value)}
{m.maxElo?.sigma != null && (
  <span className="text-[var(--text-muted)] ml-1" title={`sigma: ${m.maxElo.sigma.toFixed(1)}`}>
    ±{m.maxElo.sigma.toFixed(0)}
  </span>
)}

// After:
{fmtNum(m.maxElo?.value)}
```

**`StrategyMetricsSection.tsx:145-150`** — Same removal:
```tsx
// Before:
{fmtMetric(m.maxElo)}
{m.maxElo?.sigma != null && (
  <span className="text-[var(--text-muted)] ml-1">±{m.maxElo.sigma.toFixed(0)}</span>
)}

// After:
{fmtMetric(m.maxElo)}
```

#### Step 2: Stop setting sigma on per-run maxElo (clean data)

**`experimentMetrics.ts`**:
- Line 335: `scalar(stats.max_elo, topVariantSigmaElo)` → `scalar(stats.max_elo)`
- Line 344: `scalar(elos[elos.length - 1], topVariantSigmaElo)` → `scalar(elos[elos.length - 1])`
- Delete `getTopVariantSigmaElo()` helper (lines 85-92) — no longer used
- Delete the `topVariantSigmaElo` variable (line 329) — no longer used

**`backfill-experiment-metrics.ts`**:
- Line 73: `{ value: stats.max_elo, sigma: topSigma, ci: null, n: 1 }` → `{ value: stats.max_elo, sigma: null, ci: null, n: 1 }`
- Line 82: same pattern, set `sigma: null`
- Remove the `topSigma` computation (lines 68-72, 81)

#### Step 3: Route aggregated maxElo through `bootstrapPercentileCI`

**`experimentMetrics.ts`, `aggregateMetrics()` line 247** — Add `maxElo` to the percentile routing:
```typescript
// Before:
if (
  (metricName === 'medianElo' || metricName === 'p90Elo') &&
  runsWithRatings.length >= 2
) {
  const pct = metricName === 'medianElo' ? 0.5 : 0.9;

// After:
if (
  (metricName === 'medianElo' || metricName === 'p90Elo' || metricName === 'maxElo') &&
  runsWithRatings.length >= 2
) {
  const pct = metricName === 'medianElo' ? 0.5 : metricName === 'p90Elo' ? 0.9 : 1.0;
```

**What this does**: For each bootstrap iteration, resamples runs, then within each run draws variant skills from Normal(mu, sigma), takes the **max** of the sampled Elos, and averages across runs. The 2.5th/97.5th percentiles of these bootstrap means become the 95% CI. This correctly propagates within-run rating uncertainty (the top variant might not truly be the best if its sigma is high) AND cross-run variance.

**Note on percentile=1.0**: `bootstrapPercentileCI` computes `idx = Math.min(Math.floor(1.0 * length), length - 1)` = `length - 1` = last element = max. This is correct.

**Fallback**: When `runsWithRatings.length < 2`, falls through to `bootstrapMeanCI` which produces `ci: null` for single runs — correct behavior.

#### Step 4: Update tests

**`experimentMetrics.test.ts`**:
- Line 241: `expect(result.metrics.maxElo?.sigma).not.toBeNull()` → `expect(result.metrics.maxElo?.sigma).toBeNull()`
- Line 257: already expects null — no change needed
- Line 283-291: "uses sigma-aware bootstrap for maxElo" — rewrite to verify maxElo uses `bootstrapPercentileCI` path. Provide `variantRatings` on the run data and assert the aggregated maxElo has a proper `ci` (not null). Remove the `mv(1500, 40)` sigma values since per-run maxElo no longer carries sigma.
- Line 291: `expect(result.maxElo?.sigma).toBeNull()` — still valid
- Add test: "uses percentile bootstrap for maxElo (like medianElo/p90Elo)" — provide 3+ runs with variantRatings, verify `aggregateMetrics` produces `maxElo.ci` that's non-null and `maxElo.sigma` that's null

**`experimentActions.test.ts`**:
- Line 540: `maxElo: { value: 1500, sigma: 40, ci: null, n: 1 }` → `sigma: null`

**`backfill-experiment-metrics.test.ts`**:
- Line 44: `expect(result.maxElo?.sigma).not.toBeNull()` → `expect(result.maxElo?.sigma).toBeNull()`

#### Step 5: Run checks
```bash
npm run lint && npx tsc --noEmit && npm run build
npm test -- experimentMetrics.test.ts
npm test -- experimentActions.test.ts
npm test -- backfill-experiment-metrics.test.ts
```

### Phase 2: Clarify per-agent budget docs
1. Add comments in `costTracker.ts` clarifying that agentName is for attribution only
2. Update `cost_optimization.md` to note that per-agent budgets are informational, not enforced
3. Update `architecture.md` Budget Redistribution section to clarify it's proportional display allocation

### Phase 3: Investigate production run cost overrun
1. Query prod `evolution_budget_events` for run 223bc062-f932-431e-b0f7-eec4f133dee3
2. Query `evolution_runs` for the run's config, budget cap, total cost
3. Analyze the timeline of reserve/spend/release events
4. Identify root cause and propose estimation improvements

## Testing
- `experimentMetrics.test.ts` — sigma assertions flip to `.toBeNull()`; sigma-aware bootstrap test rewritten to verify percentile bootstrap path; new test for maxElo percentile CI
- `experimentActions.test.ts` — mock data updated (sigma: 40 → null)
- `backfill-experiment-metrics.test.ts` — same sigma assertion flip
- Run lint/tsc/build + all 3 test files

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Clarify per-agent budget is tracking-only
- `evolution/docs/evolution/experimental_framework.md` - Update maxElo description to reflect bootstrap CI
- `evolution/docs/evolution/architecture.md` - Clarify budget redistribution is informational

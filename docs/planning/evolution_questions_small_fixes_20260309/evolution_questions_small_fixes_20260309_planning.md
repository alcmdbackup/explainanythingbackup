# Evolution Questions Small Fixes Plan

## Background
Investigate evolution system questions around agent budgets and max Elo confidence intervals, and apply small fixes. Additionally, investigate a production run (223bc062) that exceeded its cost budget to understand what went wrong and improve cost estimation.

## Requirements (from GH Issue)
1. Per-agent budget clarification: confirm tracking-only, update docs/comments
2. maxElo confidence interval naming: fix the confusing overloaded `sigma` field
3. Production run 223bc062 cost overrun: investigate and improve estimations

## Problem
Two related issues with Elo display metrics:

1. **maxElo sigma field**: The `MetricValue.sigma` field is overloaded — for most metrics it's `null`, but for maxElo it holds the top variant's Bayesian uncertainty. The UI displays this as `±sigma` which looks like a CI but isn't.

2. **Ordinal vs mu scale inconsistency**: `bootstrapPercentileCI` uses `ordinalToEloScale(v.mu)` for aggregate medianElo/p90Elo, while per-run values come from `elo_score` which is ordinal-based (`mu - 3*sigma`). This creates impossible relationships like aggregate maxElo < aggregate medianElo (strategy 81acd0 in production). Ordinal inflates the gap by `3*sigma*16` = ~144-400 Elo points.

## Options Considered

### Scale: Ordinal vs Mu everywhere

**Option X: Fix bootstrapPercentileCI to use ordinal (match per-run values)**
- Change line 184 and 199 to use `getOrdinal(v)` instead of `v.mu`
- **Pros**: Quick fix, per-run and aggregate values match
- **Cons**: Ordinal is redundant when CIs are available — it double-counts uncertainty (penalizes point estimate AND CI shows spread). Also creates arena bias: older entries with more matches have lower sigma → higher ordinal, even if mu is equal.

**Option Y: Switch everything to mu-based display, keep ordinal only for automated ranking**
- `bootstrapPercentileCI` already uses mu (correct for display)
- Per-run values (`compute_run_variant_stats` SQL) need to switch from `elo_score` (ordinal) to a mu-based value
- Variant persistence stores both mu/sigma and elo_score; add a `display_elo` column or compute from mu at query time
- Arena already does this pattern: `elo_rating` (ordinal, for sort) vs `display_elo` (mu, for UI)
- **Pros**: Consistent scale, no double-counting, no arena age bias, CIs handle uncertainty display
- **Cons**: Larger change, needs DB migration or computed column, existing `elo_score` values in DB are ordinal

**Option Z: Eliminate ordinal entirely — use mu for everything (ranking + display)**
- Replace all `getOrdinal(r)` with `r.mu` for ranking/sorting
- Replace `ordinal >= 0` gates with `r.mu >= 3 * r.sigma` (exact equivalent)
- Swiss pairing win probability: `ordA - ordB` → `rA.mu - rB.mu` (logistic model works identically)
- DB: `elo_score = ordinalToEloScale(mu)` instead of `ordinalToEloScale(getOrdinal(r))`
- Arena: drop `ordinal` column writes, sort by `mu` directly
- **Pros**: Single scale everywhere, no confusion, simpler codebase, CIs communicate uncertainty
- **Cons**: Largest change (~113 occurrences across 45 files including scripts, tests, supervisor, and docs). New variants with high sigma rank equally to proven ones (but tournament already handles this by running more matches for high-sigma pairs).

**Chosen: Option Z** — Eliminate ordinal entirely. Ordinal (`mu - 3*sigma`) is redundant when CIs are available. It creates arena bias toward older entries, causes temporal drift, and the dual-scale architecture is a constant source of bugs (strategy 81acd0). The few places that need conservatism (eligibility gates) can use the original formula `r.mu >= 3 * r.sigma` directly (the exact condition that `ordinal >= 0` encoded).

### maxElo sigma fix

**Option A: Give maxElo a proper bootstrap CI + route through bootstrapPercentileCI**
- Remove sigma override, add maxElo to the percentile bootstrap routing
- **Pros**: Consistent with medianElo/p90Elo, proper CI
- **Chosen**

## Phased Execution Plan

### Phase 1: Fix maxElo sigma → proper display

**Root cause**: `computeRunMetrics()` in `experimentMetrics.ts` calls `scalar(stats.max_elo, topVariantSigmaElo)` (lines 335, 344), which stuffs the top variant's Bayesian sigma (scaled to Elo space) into `MetricValue.sigma`. Two UI files then render this as `±N`, making it look like a CI.

**What sigma actually is**: `topVariant.sigma * (400/25)` = the OpenSkill uncertainty of the single best variant, in Elo-scale points. This is NOT a confidence interval — it's one standard deviation of one variant's rating belief.

**What happens at aggregation**: `aggregateMetrics()` currently routes maxElo through `bootstrapMeanCI()` (line 266) as a fallback — it's not in the `medianElo || p90Elo` special case on line 247. `bootstrapPercentileCI` already uses mu-based Elo (correct for display per Option Y), but per-run values from the SQL RPC use ordinal-based `elo_score`. This mismatch is the root cause of strategy 81acd0's impossible metrics.

**Fix (three parts)**:
1. Stop displaying the misleading `±sigma` on per-run rows and stop setting sigma on per-run maxElo
2. Switch per-run Elo values to mu-based scale (match `bootstrapPercentileCI`)
3. Route aggregated maxElo through `bootstrapPercentileCI(percentile=1.0)`

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

#### Step 3: Switch per-run Elo values to mu-based scale

The SQL RPC `compute_run_variant_stats` reads `elo_score` (ordinal-based). Per-run metrics should use mu-based values to match the aggregate scale.

**Option A: Change the SQL RPC** — Compute percentiles from a mu-based display Elo instead of `elo_score`. This requires either:
- Adding a `display_elo` column to `evolution_variants` (like arena has), OR
- Computing `1200 + mu * 16` inline in SQL using the checkpoint ratings

**Option B: Compute per-run metrics from checkpoint ratings in TypeScript** — The checkpoint fallback path (experimentMetrics.ts:336-345) already exists and uses `getOrdinal`. Change it to use mu. Make this the primary path instead of the SQL RPC fallback.

**Option C: Keep SQL RPC but override per-run values with mu-based computation** — After fetching stats from RPC, recompute median/p90/max from `variantRatings` using mu. The checkpoint is already loaded (line 304-326).

**Chosen: Option C** — Least invasive. The checkpoint ratings are already loaded for sigma extraction. Recompute per-run Elo stats from those ratings using mu. The SQL RPC remains available for backward compat but we prefer the checkpoint path.

**`experimentMetrics.ts`** — After loading checkpoint ratings (line 324-326), always compute stats from ratings when available:
```typescript
// After loading variantRatings from checkpoint...
if (variantRatings && variantRatings.length > 0) {
  const muElos = variantRatings.map((r) => ordinalToEloScale(r.mu));
  muElos.sort((a, b) => a - b);
  metrics.totalVariants = scalar(muElos.length);
  metrics.medianElo = scalar(muElos[Math.min(Math.floor(0.5 * muElos.length), muElos.length - 1)]);
  metrics.p90Elo = scalar(muElos[Math.min(Math.floor(0.9 * muElos.length), muElos.length - 1)]);
  metrics.maxElo = scalar(muElos[muElos.length - 1]);
} else if (stats && stats.total_variants > 0) {
  // Fallback to SQL RPC (ordinal-based) when no checkpoint available
  metrics.totalVariants = scalar(stats.total_variants);
  if (stats.median_elo != null) metrics.medianElo = scalar(stats.median_elo);
  if (stats.p90_elo != null) metrics.p90Elo = scalar(stats.p90_elo);
  if (stats.max_elo != null) metrics.maxElo = scalar(stats.max_elo);
}
```

This means: prefer mu-based values from checkpoint, fall back to ordinal-based from DB only when checkpoint is unavailable.

**`backfill-experiment-metrics.ts`** — Same change: when variantRatings are available, compute from mu instead of ordinal.

#### Step 4: Route aggregated maxElo through `bootstrapPercentileCI` (no change from before)

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

#### Step 5: Update tests

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

#### Step 6: Run checks
```bash
npm run lint && npx tsc --noEmit && npm run build
npm test -- experimentMetrics.test.ts
npm test -- experimentActions.test.ts
npm test -- backfill-experiment-metrics.test.ts
```

### Phase 2: Eliminate ordinal — switch entirely to mu + sigma

**Scope**: ~113 occurrences of `getOrdinal`/`ordinalToEloScale` across 45 files (including scripts, tests, supervisor, and docs). Replace all with `r.mu` for ranking/sorting, `toEloScale(r.mu)` for Elo-scale display.

**Key insight**: `ordinalToEloScale()` is just `1200 + x * 16`. We keep the function but always pass `mu` instead of `mu - 3*sigma`. The function can be renamed to `toEloScale()` for clarity.

**Replacement patterns**:
| Old pattern | New pattern | Context |
|------------|-------------|---------|
| `getOrdinal(r)` for sorting | `r.mu` | Ranking, top-K selection |
| `ordinalToEloScale(getOrdinal(r))` | `ordinalToEloScale(r.mu)` | DB writes, display |
| `ordinal >= 0` gate | `r.mu >= 3 * r.sigma` | Eligibility filtering (exact equivalent) |
| `getOrdinal(rA) >= topQuartileOrdinal` | `rA.mu >= topQuartileMu` | Multi-turn eligibility |
| `ordA - ordB` in win probability | `rA.mu - rB.mu` | Swiss pairing logistic model |

**Gate replacement**: The `ordinal >= 0` gate means `mu - 3*sigma >= 0`, i.e. `mu >= 3*sigma`. This is a joint condition on both mu and sigma — it cannot be replaced by a sigma-only threshold without changing semantics. Replace with the exact equivalent: `r.mu >= 3 * r.sigma`. This preserves the original behavior: a fresh rating (mu=25, sigma=8.33) has ordinal=0 and passes marginally, while a variant that lost matches (mu=20, sigma=7) fails because `20 < 21`.

#### Step 2a: Core rating.ts changes

**Export**: `DEFAULT_MU` — currently module-private (`const DEFAULT_MU = 25`), must be exported for gate checks
**Delete**: `getOrdinal()` function (line 51-53)
**Delete**: `computeEloPerDollar(ordinal, cost)` — replace with mu-based version
**Keep**: `ordinalToEloScale()` — rename to `toEloScale()` since it now always takes mu
**Keep**: `eloToRating()` — backward compat for legacy checkpoint conversion

```typescript
// rating.ts changes:
// EXPORT: export const DEFAULT_MU = 25; (was private, needed for gate checks)
// DELETE: export function getOrdinal(r: Rating): number { return osOrdinal(r); }

/** Convert mu to 0-3000 Elo display scale. Fresh mu=25 → Elo 1200. */
export function toEloScale(mu: number): number {
  return Math.max(0, Math.min(3000, 1200 + mu * (400 / DEFAULT_MU)));
}
// Keep ordinalToEloScale as deprecated alias for backward compat during migration

export function computeEloPerDollar(mu: number, totalCostUsd: number | null): number | null {
  if (!totalCostUsd) return null;
  return (toEloScale(mu) - 1200) / totalCostUsd;
}

// Gate pattern (used in tournament.ts, etc.):
// Old: ordinal >= 0  ===  mu - 3*sigma >= 0  ===  mu >= 3*sigma
// New: r.mu >= 3 * r.sigma  (exact equivalent, no separate constant needed)
```

#### Step 2b: Core ranking — state.ts `getTopByRating()`

```typescript
// Before (state.ts:82):
.sort((a, b) => getOrdinal(b[1]) - getOrdinal(a[1]))
// After:
.sort((a, b) => b[1].mu - a[1].mu)
```

This cascades to ALL code using `getTopByRating()`: evolution parents, quality threshold, winner selection, etc.

#### Step 2c: Tournament Swiss pairing — tournament.ts

**Lines 77-100** (eligibility + pairing):
```typescript
// Before:
const withOrdinals = variants.map((v) => ({
  variant: v,
  ordinal: getOrdinal(ratings.get(v.id) ?? defaultRating),
}));
withOrdinals.sort((a, b) => b.ordinal - a.ordinal);
let eligible = withOrdinals
  .filter((e) => e.ordinal >= 0 || topKIds.has(e.variant.id))

// After:
const withMu = variants.map((v) => {
  const r = ratings.get(v.id) ?? defaultRating;
  return { variant: v, mu: r.mu, sigma: r.sigma };
});
withMu.sort((a, b) => b.mu - a.mu);
let eligible = withMu
  .filter((e) => e.mu >= 3 * e.sigma || topKIds.has(e.variant.id))
```

**Lines 112-119** (win probability):
```typescript
// Before:
const ordA = ordinalMap.get(a.id) ?? getOrdinal(rA);
const ordB = ordinalMap.get(b.id) ?? getOrdinal(rB);
const pWin = 1 / (1 + Math.exp(-(ordA - ordB) / BETA));
// After:
const pWin = 1 / (1 + Math.exp(-(rA.mu - rB.mu) / BETA));
```
Note: BETA stays `DEFAULT_SIGMA * sqrt(2)` — this is the performance spread in mu-space, works identically.

**Lines 155-163** (top quartile):
```typescript
// Before: getTopQuartileOrdinal using getOrdinal
// After: getTopQuartileMu using r.mu
private getTopQuartileMu(ratings: Map<string, Rating>): number {
  if (ratings.size < 4) {
    const mus = [...ratings.values()].map(r => r.mu);
    return mus.length > 0 ? Math.max(...mus) : DEFAULT_MU;
  }
  const sorted = [...ratings.values()].map(r => r.mu).sort((a, b) => b - a);
  return sorted[Math.floor(sorted.length / 4)];
}
```

**Lines 181** (multi-turn eligibility):
```typescript
// Before: getOrdinal(rA) >= topQuartileOrdinal
// After: rA.mu >= topQuartileMu
```

**Lines 383-388** (convergence eligibility):
```typescript
// Before:
const sortedByOrdinal = [...state.ratings.entries()]
  .sort((a, b) => getOrdinal(b.r) - getOrdinal(a.r));
const eligibleForConvergence = sortedByOrdinal
  .filter((e) => getOrdinal(e.r) >= 0 || topKIds.has(e.id))
// After:
const sortedByMu = [...state.ratings.entries()]
  .map(([id, r]) => ({ id, r }))
  .sort((a, b) => b.r.mu - a.r.mu);
const eligibleForConvergence = sortedByMu
  .filter((e) => e.r.sigma <= SIGMA_GATE_THRESHOLD || topKIds.has(e.id))
```

#### Step 2d: Pool stratified sampling — pool.ts

```typescript
// Before (pool.ts:52-54):
const sortedExisting = [...existing].sort(
  (a, b) => getOrdinal(this.state.ratings.get(b) ?? defaultRating) - getOrdinal(this.state.ratings.get(a) ?? defaultRating),
);
// After:
const sortedExisting = [...existing].sort(
  (a, b) => (this.state.ratings.get(b) ?? defaultRating).mu - (this.state.ratings.get(a) ?? defaultRating).mu,
);
```

```typescript
// Before (pool.ts:129):
? [...this.state.ratings.values()].map(getOrdinal)
// After:
? [...this.state.ratings.values()].map(r => r.mu)
```

#### Step 2e: Pipeline run summary — pipeline.ts

```typescript
// Before (pipeline.ts:57):
ordinal: getOrdinal(state.ratings.get(v.id) ?? createRating()),
// After:
mu: (state.ratings.get(v.id) ?? createRating()).mu,
```

Rename `strategyEffectiveness[].avgOrdinal` → `avgMu` (lines 75-84).
Rename `baselineOrdinal` → `baselineMu` (line 100-101).
Rename `ordinalHistory` → `muHistory` in run summary schema (with backward compat).

**Note**: This changes the `EvolutionRunSummary` type. Need to update:
- `experimentHelpers.ts:extractTopElo()` — reads `topVariants[0].ordinal`, change to `.mu`
- `EvolutionRunSummaryV2Schema` in types — rename field
- `arena/[topicId]/page.tsx:247` — displays `avgOrdinal`, change to `avgMu`

#### Step 2f: Persistence + DB writes

**`persistence.ts:77`**:
```typescript
// Before:
elo_score: ordinalToEloScale(getOrdinal(ctx.state.ratings.get(v.id) ?? createRating())),
// After:
elo_score: toEloScale((ctx.state.ratings.get(v.id) ?? createRating()).mu),
```

**`metricsWriter.ts:13-14`** (computeFinalElo):
```typescript
// Before:
const ordinal = getOrdinal(ctx.state.ratings.get(topVariant.id) ?? createRating());
return ordinalToEloScale(ordinal);
// After:
const rating = ctx.state.ratings.get(topVariant.id) ?? createRating();
return toEloScale(rating.mu);
```

**`metricsWriter.ts:194`** (agent metrics):
```typescript
// Before:
return s + ordinalToEloScale(getOrdinal(rating));
// After:
return s + toEloScale(rating.mu);
```

**`arenaIntegration.ts:254-262`** (arena sync):
```typescript
// Before:
const ord = getOrdinal(rating);
return {
  ordinal: ord,
  elo_rating: ordinalToEloScale(ord),
  elo_per_dollar: computeEloPerDollar(ord, cost),
};
// After:
return {
  ordinal: rating.mu - 3 * rating.sigma,  // keep for DB column compat, computed inline
  elo_rating: toEloScale(rating.mu),       // now mu-based
  elo_per_dollar: computeEloPerDollar(rating.mu, cost),
};
```

#### Step 2g: Visualization + display actions

**`buildEloLookup()` in evolutionVisualizationActions.ts:991**:
```typescript
// Before: ordinalToEloScale(getOrdinal(r))
// After: toEloScale(r.mu)
```

**`getEvolutionRunEloHistoryAction` line 533**:
```typescript
// Before: ordinalToEloScale(getOrdinal(rating))
// After: toEloScale(rating.mu)
```

**`getEvolutionRunLineageAction` line 627**:
```typescript
// Before: ordinalToEloScale(getOrdinal(state.ratings.get(v.id) ?? createRating()))
// After: toEloScale((state.ratings.get(v.id) ?? createRating()).mu)
```

**`pipelineUtilities.ts:64,86,89`** — same pattern.

**`variantDetailActions.ts:296`** — same pattern.

**Arena actions (4 functions)** — same as before: select `mu` column, use `toEloScale(elo.mu)`.

**Arena leaderboard (arenaActions.ts:314)**:
```typescript
// Before: .order('ordinal', { ascending: false })
// After: .order('mu', { ascending: false })
```

**Arena `buildArenaEntry` + `updateArenaElo`** (arenaActions.ts:136, 538):
```typescript
// Before: const ord = getOrdinal(rating); ordinal: ord, elo_rating: ordinalToEloScale(ord)
// After: ordinal: rating.mu - 3 * rating.sigma, elo_rating: toEloScale(rating.mu)
```

#### Step 2h: Supervisor ordinalHistory — supervisor.ts

**`supervisor.ts:26,103,153,223,229`** — `SupervisorResumeState` interface and `Supervisor` class:
```typescript
// Before:
ordinalHistory: number[];
// After:
muHistory: number[];
```
All 5 references to `ordinalHistory` become `muHistory`. The supervisor pushes values into this array during runs and serializes it in `getResumeState()`. The `SupervisorResumeState` interface in `types.ts:663` must also rename.

**`types.ts:663,673,696,706`** — `EvolutionRunSummaryV2Schema` and related types:
```typescript
// Before: ordinalHistory: z.array(z.number()).max(100)
// After: muHistory: z.array(z.number()).max(100)
// Before: ordinal: z.number()
// After: mu: z.number()
```

**`supervisor.test.ts`** and **`pipeline.test.ts`** — Update test fixtures from `ordinalHistory` → `muHistory`.

#### Step 2h-scripts: Scripts using getOrdinal/ordinalToEloScale

**`scripts/run-evolution-local.ts:32,547,554`**:
```typescript
// Before: .map(([id, r]) => ({ id, ordinal: getOrdinal(r) }))
// After: .map(([id, r]) => ({ id, mu: r.mu }))
// Before: elo: Math.round(ordinalToEloScale(ordinal))
// After: elo: Math.round(toEloScale(mu))
```

**`scripts/run-arena-comparison.ts:13,227,234,249,259`** and **`scripts/run-bank-comparison.ts:13,227,234,249,259`**:
- Both follow identical pattern: import `getOrdinal` → remove, use `r.mu` for ranking, `toEloScale(r.mu)` for display

**`scripts/run-prompt-bank-comparisons.ts:14,264,271,282-283,289,299`**:
- Same pattern but more occurrences (6 uses of getOrdinal)

**`scripts/backfill-diff-metrics.ts:19-23,32`**:
- Has local copies of `getOrdinal` and `ordinalToEloScale` (not importing from rating.ts)
- Replace local `getOrdinal` with `r.mu`, local `ordinalToEloScale` with `toEloScale` imported from rating.ts

**`scripts/backfill-experiment-metrics.ts:18-22,70,76,81`**:
- Same as above: local copies → import from rating.ts, use mu

**`scripts/lib/arenaUtils.ts:5,81,88`**:
- Import `getOrdinal` → remove, use `r.mu` for ordinal, `toEloScale(r.mu)` for display

#### Step 2i-agents: Other agents using getOrdinal

**`evolvePool.ts:153,203`** — stagnation detection, variant summary:
```typescript
// Before: .sort(([, a], [, b]) => getOrdinal(b) - getOrdinal(a))
// After: .sort(([, a], [, b]) => b.mu - a.mu)
```

**`debateAgent.ts:206-207`** — debate variant selection:
```typescript
// Before: const ordinalA = getOrdinal(...); const ordinalB = getOrdinal(...)
// After: const muA = (state.ratings.get(variantA.id) ?? createRating()).mu; ...
```

**`metaReviewAgent.ts`** (9 occurrences) — all sorting/ranking:
```typescript
// Before: .sort((a, b) => getOrdinal(a[1]) - getOrdinal(b[1]))
// After: .sort((a, b) => a[1].mu - b[1].mu)
```

**`evaluator.ts:155-156`** (tree of thought) — variant ranking:
```typescript
// Before: const ordA = getOrdinal(localRatings.get(a.node.variantId) ?? createRating());
// After: const muA = (localRatings.get(a.node.variantId) ?? createRating()).mu;
```

#### Step 2j: DB migration — arena `ordinal` column

**IMPORTANT: Create index BEFORE changing ORDER BY** to avoid full table scans on leaderboard queries.

1. **First**: Deploy the index migration:
```sql
CREATE INDEX CONCURRENTLY idx_arena_elo_topic_mu
  ON evolution_arena_elo (topic_id, mu DESC);
```

2. **Then**: Change `ORDER BY ordinal DESC` → `ORDER BY mu DESC` in arenaActions.ts

The `evolution_arena_elo.ordinal` column stays in the DB (no breaking migration) but is now a legacy/computed field. We keep writing it for backward compat (`mu - 3*sigma` inline) but stop reading it for sorting. Old rows keep their original ordinal values; new writes recompute `mu - 3*sigma` inline. This means ordinal values reflect the sigma at time of last write — acceptable since ordinal is no longer used for ranking.

#### Step 2k: Update `getOrdinal` export + deprecation

**`lib/index.ts:56`** — Remove `getOrdinal` from exports.
**`rating.ts`** — Delete `getOrdinal()` function entirely. If any external code still references it, they get a compile error (good — forces migration).

#### Step 2l: Update tests

**All 45 files with `getOrdinal`/`ordinalToEloScale`** need updates (including scripts, docs, and tests). Key patterns:

1. **`rating.test.ts`** — Delete `getOrdinal` tests. Add `toEloScale()` tests. Keep `ordinalToEloScale` as deprecated alias test.
2. **`tournament.test.ts`** — Replace `getOrdinal(ratingA) > getOrdinal(ratingB)` with `ratingA.mu > ratingB.mu`. Update Swiss pairing gate expectations.
3. **`state.test.ts`** — Replace ordinal comparisons with mu comparisons.
4. **`metricsWriter.test.ts`** — Update `avg_elo` expectations to mu-based.
5. **`evolutionVisualizationActions.test.ts`** — Update elo_score expectations.
6. **`arenaActions.test.ts`** — Update leaderboard sort expectations, cross-topic assertions.
7. **`persistence.continuation.test.ts`** — Update `getOrdinal` mock.
8. **`run-arena-comparison.test.ts` / `run-bank-comparison.test.ts`** — Update `computeEloPerDollar` tests, remove `getOrdinal` import/usage.
9. **`supervisor.test.ts`** — Update `ordinalHistory` → `muHistory` in fixtures and assertions.
10. **`pipeline.test.ts`** — Update `ordinalHistory` and `topVariants[].ordinal` in fixtures.
11. **`pipelineUtilities.test.ts`** — Update ordinal references.
12. **`arena.test.ts`** — May reference `ordinalHistory` from supervisor resume state.
13. **`evolution-visualization.integration.test.ts`** — References `ordinalToEloScale` (line ~186-188). Update to `toEloScale`.
14. **`arena-actions.integration.test.ts`** — References ordinal-based assertions (line ~648-655). Update to mu-based.
15. **`evolvePool.test.ts` / `debateAgent.test.ts` / `metaReviewAgent.test.ts` / `evaluator.test.ts`** — Update `getOrdinal` usage in test assertions to `r.mu`.
16. **`experimentActions.test.ts`** — Update `maxElo: { sigma: 40 }` → `sigma: null` (Phase 1), then update ordinal-based assertions (Phase 2).
17. **`backfill-experiment-metrics.test.ts`** — Line 44: flip `sigma.not.toBeNull()` → `sigma.toBeNull()` in Phase 1.

**computeEloPerDollar test updates**: `run-arena-comparison.test.ts` and `run-bank-comparison.test.ts` currently call `computeEloPerDollar(ordinal, cost)`. After Phase 2, signature changes to `computeEloPerDollar(mu, cost)`. Tests must pass mu values (e.g., `25` for fresh rating) instead of ordinal values (e.g., `0`). Expected output changes accordingly: `computeEloPerDollar(25, 0.5)` = `(toEloScale(25) - 1200) / 0.5` = `(1600 - 1200) / 0.5` = `800`.

**`ratingWithOrdinal()` test helper**: Found in `pipeline.test.ts:42`, `supervisor.test.ts:9`, `metricsWriter.test.ts:31`. Rename to `ratingWithMu()` and update logic: helper now creates ratings with explicit mu values instead of computing mu from ordinal.

#### Step 2m: Run summary schema migration

`EvolutionRunSummaryV2Schema` stores `ordinalHistory` and `topVariants[].ordinal`. Add V3 schema:
- `muHistory` (replaces `ordinalHistory`)
- `topVariants[].mu` (replaces `.ordinal`)
- `baselineMu` (replaces `baselineOrdinal`)
- `strategyEffectiveness[].avgMu` (replaces `.avgOrdinal`)

Add Zod transform from V2→V3 with two-tier fallback:

**Preferred**: If checkpoint ratings are available alongside the V2 summary, extract mu directly from `checkpoint.ratings[variantId].mu`. This is exact.

**Fallback**: When no checkpoint is available, use `ordinal + 3 * DEFAULT_SIGMA` as approximation (DEFAULT_SIGMA ≈ 8.33, so adds ~25). This is imprecise for variants with non-default sigma but acceptable for historical display — these values are only used in charts/trends, not for ranking decisions. Acceptable margin of error: ±50 Elo points for historical display.

Field mapping:
- `ordinalHistory` → `muHistory`: Array of ordinal values → `ordinal + 3 * DEFAULT_SIGMA` each
- `topVariants[].ordinal` → `.mu`: Same approximation per variant
- `baselineOrdinal` → `baselineMu`: Same approximation
- `strategyEffectiveness[].avgOrdinal` → `.avgMu`: Same approximation

Implementation:
- Add V2 schema as fallback in Zod union: `V3Schema.or(V2Schema.transform(v2ToV3))`
- Chain with existing V1→V2 transform: V1 → V2 → V3
- **Test**: Verify V1 input produces valid V3 output (chained transforms)
- **Note**: New runs write V3 directly. V2 transform is backward-compat only for reading old data.

### Phase 3: Clarify per-agent budget docs
1. Add comments in `costTracker.ts` clarifying that agentName is for attribution only
2. Update `cost_optimization.md` to note that per-agent budgets are informational, not enforced
3. Update `architecture.md` Budget Redistribution section to clarify it's proportional display allocation

## Testing
- **Phase 1** (5 test files): `experimentMetrics.test.ts` sigma assertions flip + maxElo bootstrap test rewritten; `experimentActions.test.ts` mock sigma→null; `backfill-experiment-metrics.test.ts` sigma flip (line 44: `not.toBeNull()` → `toBeNull()`)
- **Phase 2** (45 files total — see Step 2l for complete list): `rating.test.ts` delete ordinal tests + add toEloScale; `tournament.test.ts` mu-based ranking + gate expectations; `state.test.ts` mu comparisons; `metricsWriter.test.ts` mu-based avg_elo; `arenaActions.test.ts` mu-based leaderboard; `supervisor.test.ts` + `pipeline.test.ts` muHistory; `run-arena-comparison.test.ts` + `run-bank-comparison.test.ts` computeEloPerDollar(mu, cost); 2 integration tests; agent test files (evolvePool, debateAgent, metaReviewAgent, evaluator); rename `ratingWithOrdinal()` helpers
- **Schema tests**: V1→V2→V3 chained transform test; V2→V3 approximation accuracy test
- **All phases**: `npm run lint && npx tsc --noEmit && npm run build` + affected test files

## Failure Recovery
- **Each phase is independently committable** — if Phase 2 fails, Phase 1 changes are already committed and working
- **Phase 1 rollback**: Revert the commit. Per-run values revert to ordinal-based, sigma display returns. No DB changes to undo.
- **Phase 2 rollback**: Revert the commits. `getOrdinal` is restored, ordinal-based sorting returns. DB index (`idx_arena_elo_topic_mu`) is harmless to leave. `elo_score` values written during Phase 2 are mu-based but still valid Elo numbers — no data corruption.
- **If tsc/lint fails mid-phase**: Fix the type errors before proceeding. Do NOT skip `--noEmit` checks. Common issues: missing imports after `getOrdinal` deletion, `toEloScale` not yet exported.
- **If tests fail mid-phase**: Check if failure is due to stale test assertions (expected) or actual regression (unexpected). Expected failures: hardcoded Elo values that shifted from ordinal→mu scale (difference of ~400 points for fresh ratings).

## DB Migration Strategy
- **Phase 1**: No migration needed
- **Phase 2**: One small migration:
  - Add `idx_arena_elo_topic_mu` index on `evolution_arena_elo (topic_id, mu DESC)`
  - `evolution_arena_elo.ordinal` column stays (no breaking drop) but becomes legacy computed field
  - `evolution_variants.elo_score` semantics change from ordinalToEloScale(ordinal) to toEloScale(mu) — new runs write mu-based, old runs have ordinal-based (acceptable, rarely cross-compared)
  - `evolution_strategy_configs` aggregates: `computeFinalElo()` now writes mu-based values. Aggregates will naturally shift as new runs complete. No backfill needed.
  - `evolution_run_agent_metrics` values naturally update to mu-based on new runs
  - Run summary schema: V2→V3 migration via Zod transform (ordinalHistory→muHistory). Preferred: extract mu from checkpoint if available. Fallback: `ordinal + 3*DEFAULT_SIGMA` approximation (±50 Elo points acceptable for historical display/charts).
  - **Deployment order**: (1) Deploy index migration first, (2) then deploy code changes. This avoids full table scans during the transition.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Clarify per-agent budget is tracking-only
- `evolution/docs/evolution/experimental_framework.md` - Update maxElo description to reflect bootstrap CI; update Scale Consistency section to document mu-based display
- `evolution/docs/evolution/architecture.md` - Clarify budget redistribution is informational
- `evolution/docs/evolution/rating_and_comparison.md` - Document that ordinal is eliminated; all Elo values are mu-based; sigma communicates uncertainty via CIs
- `evolution/docs/evolution/arena.md` - Document that arena now sorts by mu instead of ordinal; ordinal column is legacy

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

**Chosen: Option Y** — Use mu for all display values. The arena already established this pattern with `display_elo`. Ordinal remains useful for automated conservative decisions (winner selection, sort tiebreaking) but shouldn't be the display value. CIs communicate uncertainty more honestly than baking a penalty into the point estimate.

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

### Phase 2: Switch all Elo display values from ordinal to mu-based

**Principle**: `ordinalToEloScale(mu)` for display, `ordinalToEloScale(getOrdinal(r))` for automated ranking only. The formula is the same (`1200 + x * 16`), but we pass `mu` instead of `mu - 3*sigma`.

**Key insight**: `ordinalToEloScale()` works for both — it's `1200 + x * (400/25)`. The only question is what `x` is: mu (point estimate) or ordinal (conservative). For display, mu is correct.

**What KEEPS ordinal** (16 locations confirmed by audit — all automated decision-making):
- `state.getTopByRating()` (state.ts:82) — foundational ranking primitive
- Tournament Swiss pairing eligibility (tournament.ts:88) — `ordinal >= 0` gate
- Tournament convergence eligibility (tournament.ts:388) — same gate
- Pool stratified sampling (pool.ts:50) — opponent selection
- Evolution parent selection (pool.ts:107) — via getTopByRating
- Rating stagnation detection (evolvePool.ts:153) — top-3 stability
- Quality threshold stopping (supervisor.ts:198) — via getTopByRating
- Top quartile detection (tournament.ts:155) — multi-turn eligibility
- Arena leaderboard sort query (arenaActions.ts:314) — `ORDER BY ordinal DESC`
- Strategy recommendation engine (eloBudgetActions.ts:375) — uses DB values
- Pareto frontier (eloBudgetActions.ts:299) — dominance check
- `computeFinalElo()` (metricsWriter.ts:14) — stays ordinal for DB aggregate consistency
- `persistence.ts:77` — `elo_score` column stays ordinal (index + sorting)
- add-to-arena.ts / add-to-bank.ts scripts — ORDER BY elo_score

**What SWITCHES to mu** (display layer):

#### Step 2a: Add `muToEloScale()` helper to rating.ts

**`evolution/src/lib/core/rating.ts`** — Add alongside existing `ordinalToEloScale`:
```typescript
/** Convert mu (skill estimate) to 0-3000 Elo display scale. Fresh mu=25 → Elo 1200. */
export function muToEloScale(mu: number): number {
  return Math.max(0, Math.min(3000, 1200 + (mu - DEFAULT_MU) * (400 / DEFAULT_MU)));
}
```
Note: This is mathematically equivalent to `ordinalToEloScale(mu)` since both are `1200 + x * 16`. The separate function makes intent clear at call sites.

#### Step 2b: Fix `buildEloLookup()` — cascading fix for ALL visualization

**`evolutionVisualizationActions.ts:985-996`** — This single function feeds ALL visualization:
```typescript
// Before:
ordinalToEloScale(getOrdinal(r as { mu: number; sigma: number }))
// After:
muToEloScale((r as { mu: number; sigma: number }).mu)
```
**Cascading impact** (no component changes needed):
- `buildVariantsFromCheckpoint()` → VariantsTab, RelatedVariantsTab, variants/page.tsx
- `computeEloDelta()` → TimelineTab EloChangesSection
- `_getVariantDetailAction()` → variant detail page
- `_getInvocationFullDetailAction()` → invocation diffs, EloDeltaChip
- `getEvolutionRunLineageAction()` → LineageGraph nodes

**`variantDetailActions.ts:291-301`** — Same `buildEloLookup` pattern:
```typescript
// Same change: ordinalToEloScale(getOrdinal(r)) → muToEloScale(r.mu)
```

**`backfill-diff-metrics.ts:27-40`** — Same pattern.

#### Step 2c: Fix Elo history chart

**`evolutionVisualizationActions.ts:533`** (getEvolutionRunEloHistoryAction):
```typescript
// Before:
converted[id] = ordinalToEloScale(getOrdinal(rating));
// After:
converted[id] = muToEloScale(rating.mu);
```
**Impact**: EloTab chart + EloSparkline automatically use mu-based values.

#### Step 2d: Fix metricsWriter display values

**`metricsWriter.ts:192-207`** (persistAgentMetrics):
```typescript
// Before:
return s + ordinalToEloScale(getOrdinal(rating));
// After:
return s + muToEloScale(rating.mu);
```
This changes `avg_elo`, `elo_gain`, `elo_per_dollar` in `evolution_run_agent_metrics` to mu-based.

**`computeEloPerDollar()` in rating.ts:87-91** — Change parameter semantics:
```typescript
// Before: takes ordinal
export function computeEloPerDollar(ordinal: number, totalCostUsd: number | null): number | null {
  if (!totalCostUsd) return null;
  return (ordinalToEloScale(ordinal) - 1200) / totalCostUsd;
}
// After: takes mu
export function computeEloPerDollar(mu: number, totalCostUsd: number | null): number | null {
  if (!totalCostUsd) return null;
  return (muToEloScale(mu) - 1200) / totalCostUsd;
}
```
Update callers: `arenaIntegration.ts:262` passes `rating.mu` instead of `ord`.

#### Step 2e: Fix arena actions — 4 functions using `elo_rating` for display

All 4 functions query only `elo_rating` (ordinal-derived) where they should use `mu`:

1. **`getCrossTopicSummaryAction`** (arenaActions.ts:601-604):
   - Change SELECT to include `mu` column
   - Use `ordinalToEloScale(elo.mu)` instead of `elo.elo_rating` for avg_elo computation

2. **`getArenaTopicsAction`** (arenaActions.ts:839-842):
   - Change SELECT to include `mu`
   - Use mu-based Elo for `elo_min`, `elo_max`

3. **`getPromptBankCoverageAction`** (arenaActions.ts:969-972):
   - Change SELECT to include `mu`
   - Use `ordinalToEloScale(elo.mu)` for coverage cell elo

4. **`getPromptBankMethodSummaryAction`** (arenaActions.ts:1067-1070):
   - Change SELECT to include `mu`
   - Use mu-based Elo for avgElo aggregation

**Note**: `getArenaLeaderboardAction` already correctly computes `display_elo: ordinalToEloScale(r.mu)` (line 381) — no change needed.

#### Step 2f: Fix strategy aggregate metrics (no DB migration needed)

**`computeFinalElo()` stays ordinal** — this writes to `avg_final_elo` in strategy_configs. Since we're keeping DB aggregates ordinal-based for now (simpler, no backfill needed), the strategy leaderboard values remain ordinal.

**Decision**: Strategy-level DB aggregates (`avg_final_elo`, `best_final_elo`, etc.) stay ordinal for now. The leaderboard/Pareto pages already use them for ranking which is correct. A future phase could add `display_avg_final_elo` if needed, but these aggregate metrics already go through the same formula — the visual difference is ~150-300 Elo points which doesn't affect relative ordering.

#### Step 2g: Update UI components (minimal — most auto-fix from action changes)

**Already fixed by upstream action changes:**
- VariantsTab.tsx:166 — `v.elo_score` now mu-based from `buildEloLookup`
- RelatedVariantsTab.tsx:31 — same
- variants/page.tsx:30 — same
- EloTab chart — history data now mu-based
- EloSparkline — data from history
- LineageGraph — nodes from lineup
- InvocationDetailClient — diffs from actions
- Arena cross-topic, topics, coverage, method summary pages

**Manual UI fix needed:**
- `arena/[topicId]/page.tsx:510` — winner display uses `winner.elo_score` from DB (ordinal). Should use checkpoint mu if available, or leave as-is (minor, only in add-from-run dialog).
- `arena/[topicId]/page.tsx:247` — `avgOrdinal` in strategy effectiveness metadata. Rename to `avgRating` and use mu-based value.

#### Step 2h: Update tests

**Critical test changes:**
1. `rating.test.ts` — Add tests for `muToEloScale()`; existing `ordinalToEloScale` tests stay (function still used for ranking)
2. `metricsWriter.test.ts:437` — `expect(rows[0].avg_elo).toBeCloseTo(ordinalToEloScale(10))` → `toBeCloseTo(muToEloScale(rating.mu))`
3. `run-arena-comparison.test.ts` / `run-bank-comparison.test.ts` — Update `computeEloPerDollar` tests to use mu input
4. `evolutionVisualizationActions.test.ts:606,632` — Update expected elo_score values (now mu-based)
5. `experimentMetrics.test.ts` — Already expects mu-based behavior in line 331+ test
6. `arenaActions.test.ts` — Update cross-topic/method summary assertions
7. Integration tests with hardcoded elo_score values (1200, 1350, 1500) — review and update

**Tests that should NOT change** (ordinal ranking stays):
- `tournament.test.ts` — ordinal-based progression
- `state.test.ts` — getTopByRating ordinal sort
- `persistence.continuation.test.ts` — mock ordinal values

### Phase 3: Clarify per-agent budget docs
1. Add comments in `costTracker.ts` clarifying that agentName is for attribution only
2. Update `cost_optimization.md` to note that per-agent budgets are informational, not enforced
3. Update `architecture.md` Budget Redistribution section to clarify it's proportional display allocation

### Phase 4: Investigate production run cost overrun
1. Query prod `evolution_budget_events` for run 223bc062-f932-431e-b0f7-eec4f133dee3
2. Query `evolution_runs` for the run's config, budget cap, total cost
3. Analyze the timeline of reserve/spend/release events
4. Identify root cause and propose estimation improvements

## Testing
- Phase 1: `experimentMetrics.test.ts` sigma assertions flip; maxElo bootstrap test rewritten; `experimentActions.test.ts` mock sigma→null; `backfill-experiment-metrics.test.ts` sigma flip
- Phase 2: `rating.test.ts` add muToEloScale tests; `metricsWriter.test.ts` update avg_elo expectations; `evolutionVisualizationActions.test.ts` update elo_score expectations; `arenaActions.test.ts` update display assertions; arena comparison tests update computeEloPerDollar; integration tests review hardcoded Elo values
- All phases: `npm run lint && npx tsc --noEmit && npm run build` + affected test files

## DB Migration Strategy
- **No migration needed** for Phase 1 or Phase 2
- `evolution_variants.elo_score` stays ordinal (used for ranking index)
- `evolution_arena_elo` already has `mu`, `sigma`, `ordinal` columns
- `evolution_strategy_configs` aggregates stay ordinal for now (ranking use)
- `evolution_run_agent_metrics` values will naturally update to mu-based on new runs
- Historical data for completed runs stays ordinal — acceptable since we rarely compare across runs from different eras
- **Future optional**: Add `display_elo` column to `evolution_variants` for pre-computed mu-based Elo

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Clarify per-agent budget is tracking-only
- `evolution/docs/evolution/experimental_framework.md` - Update maxElo description to reflect bootstrap CI; update Scale Consistency section to document mu-based display
- `evolution/docs/evolution/architecture.md` - Clarify budget redistribution is informational
- `evolution/docs/evolution/rating_and_comparison.md` - Document that display Elo uses mu, ordinal is for conservative automated decisions only; document the dual-scale pattern
- `evolution/docs/evolution/arena.md` - Already correct (display_elo is mu-based), but note consistency with experiment metrics

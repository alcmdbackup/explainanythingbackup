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

### Phase 1: Fix maxElo to use bootstrap CI
1. In `experimentMetrics.ts`, change maxElo computation to use `bootstrapPercentileCI` (percentile=1.0 i.e. max) instead of the `scalar(value, topVariantSigmaElo)` pattern
2. Remove the special `sigma` assignment for maxElo — it should get `ci` from bootstrap like medianElo/p90Elo
3. Update `StrategyMetricsSection.tsx` and `ExperimentAnalysisCard.tsx` to remove any special `sigma` display logic for maxElo — they should use the standard `ci` rendering path
4. Run lint, tsc, build
5. Update unit tests in `experimentMetrics.test.ts`

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
- Update `experimentMetrics.test.ts` — tests that check maxElo.sigma should now check maxElo.ci instead
- Verify `StrategyMetricsSection` and `ExperimentAnalysisCard` render maxElo with CI brackets
- Run full unit test suite

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Clarify per-agent budget is tracking-only
- `evolution/docs/evolution/experimental_framework.md` - Update maxElo description to reflect bootstrap CI
- `evolution/docs/evolution/architecture.md` - Clarify budget redistribution is informational

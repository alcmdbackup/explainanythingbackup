# Investigate Baseline Variants Evolution Plan

## Background
We want to understand why baseline variants in the last few stage runs are consistently near the strongest variants in the pool, and why the same baseline variant appears to be reused every run. Separately, we want to map out how `generateFromSeedArticle` uses the baseline variant during ranking, and explain why newly generated variants are frequently rated systematically low (elo < 1200 in many cases).

## Requirements (from GH Issue #TBD)
- Investigate why baseline variants in the last few stage runs are consistently near the strongest variants in the pool.
- Investigate why the same baseline variant is being used every run.
- Document how `generateFromSeedArticle` uses the baseline for ranking newly generated variants.
- Explain why ratings for newly generated variants are often systematically low (< 1200).

## Problem
[3-5 sentences describing the problem — refine after /research]

## Options Considered
- [ ] **Option A: Read-only investigation + report**: Query stage DB, trace code paths, write findings into the planning doc with no code changes.
- [ ] **Option B: Investigation + targeted fix**: After root-causing, fix any bug found (e.g., baseline reuse bug, rating-init bias) and add tests.
- [ ] **Option C: Investigation + observability improvements**: Add logging/metrics to surface baseline rating, judge confidence distribution, and variant-vs-baseline win rates.

## Phased Execution Plan

### Phase 1: Data collection
- [ ] Query stage `evolution_runs` for recent runs — inspect `evolution_explanation_id`, `prompt_id`, seed article identity.
- [ ] For each run, inspect `evolution_variants` (baseline row = parent-less / iteration 0) vs generated variants — rank by final `elo_score`.
- [ ] Inspect `evolution_arena_comparisons` to see judge outcomes baseline-vs-new.

### Phase 2: Code trace
- [ ] Trace `buildRunContext.ts` / `generateSeedArticle.ts` — how is the baseline chosen and when is it cached/reused.
- [ ] Trace `GenerateFromSeedArticleAgent` + `rankSingleVariant` — ranking of new variant against local snapshot that includes baseline.
- [ ] Trace `MergeRatingsAgent` and rating update math (OpenSkill → Elo) for new-variant Elo updates.

### Phase 3: Analysis & Write-up
- [ ] Write findings in `_progress.md`: baseline-reuse root cause, "baseline near top" explanation, rating-below-1200 explanation.
- [ ] Decide whether findings warrant a fix (Option B) or observability work (Option C).

## Testing

### Unit Tests
- [ ] [TBD — depends on whether fixes are introduced]

### Integration Tests
- [ ] [TBD]

### E2E Tests
- [ ] [TBD]

### Manual Verification
- [ ] Manually verify findings by re-querying stage DB after any changes.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [None expected unless admin UI changes]

### B) Automated Tests
- [ ] [TBD]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] evolution/docs/architecture.md — clarify baseline handling and seed selection if needed
- [ ] evolution/docs/rating_and_comparison.md — document rating-init behavior for new variants if needed
- [ ] evolution/docs/strategies_and_experiments.md — reflect baseline-related findings
- [ ] evolution/docs/arena.md — baseline interaction with arena entries
- [ ] evolution/docs/data_model.md — if schema semantics need clarification
- [ ] evolution/docs/metrics.md — if new metrics added
- [ ] evolution/docs/visualization.md — if UI changes
- [ ] evolution/docs/cost_optimization.md — unlikely but flagged
- [ ] evolution/docs/reference.md — unlikely but flagged
- [ ] evolution/docs/agents/overview.md — describe generateFromSeedArticle baseline usage
- [ ] evolution/docs/entities.md — unlikely
- [ ] evolution/docs/logging.md — if logging added
- [ ] evolution/docs/curriculum.md — unlikely
- [ ] evolution/docs/minicomputer_deployment.md — unlikely
- [ ] evolution/docs/README.md — if doc map changes
- [ ] docs/feature_deep_dives/evolution_metrics.md — if metrics change
- [ ] docs/feature_deep_dives/testing_setup.md — if new tests added

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

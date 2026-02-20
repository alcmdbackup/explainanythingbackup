# Research Opportunities Improve Evolution Plan

## Background
Research opportunities to improve the evolution pipeline's Elo improvement efficiency per dollar spent. This project will audit the current pipeline's model selection, agent budget allocation, iteration count optimization, and algorithmic approaches to identify concrete improvements that maximize Elo gains relative to cost. The goal is to produce actionable, prioritized recommendations for both technical and algorithmic changes.

## Requirements (from GH Issue #473)

### Elo/$ Efficiency (Algorithmic)
- Research maximizing Elo improvement per dollar spent
- Analyze model selection trade-offs (generation model, judge model) and their impact on Elo/$
- Evaluate agent budget allocation effectiveness — which agents contribute most Elo per dollar
- Investigate optimal iteration counts and diminishing returns curves
- Assess comparison/rating system accuracy and its impact on selection pressure
- Identify algorithmic improvements to the evolutionary process (mutation strategies, crossover effectiveness, selection pressure)
- Review adaptive allocation system and recommend improvements

### Technical Improvements (Infrastructure)
- Evaluate parallelism opportunities — pipeline throughput, concurrent agent execution
- Assess caching effectiveness — comparison cache hit rates, opportunities for cross-run caching
- Review checkpoint/resume efficiency — serialization overhead, state size optimization
- Analyze error recovery paths — retry effectiveness, budget waste from failures
- Investigate pipeline throughput bottlenecks — LLM call latency, DB write patterns
- Review format validation — rejection rates, wasted LLM spend on rejected variants

### Deliverables
- Produce concrete, prioritized recommendations with estimated impact for both tracks
- Rank improvements by effort vs. expected Elo/$ gain

## Problem

The evolution pipeline has strong foundations but leaves significant Elo/$ on the table due to: (1) broken diversity measurement via pseudo-embeddings that cascade into faulty phase transitions, premature stops, and wasted creative exploration budget; (2) sequential agent dispatch causing 3-4x longer wall-clock time than necessary; (3) tournament over-spending through conservative convergence checks and universal 2-pass bias mitigation; (4) wasted LLM spend on format-rejected variants and unconstrained pool growth that inflates calibration costs; and (5) homogeneous crossover from always using the same top-2 parents.

## Options Considered

### Algorithmic Track
1. **Fix pseudo-embeddings** — MinHash/SimHash (zero cost), TF-IDF (zero cost), real embedding API ($0.00002/text)
2. **Self-eval pre-filter** — Cheap pointwise scoring before pool entry vs. no gate (current)
3. **Pool culling** — Cull bottom 25% at phase transition vs. unbounded growth (current)
4. **Diverse parent selection** — Similarity-weighted second parent vs. pure elitist top-2 (current)
5. **Strategy arm weights** — Quantitative weighting from MetaReview vs. uniform probability (current)
6. **Multi-objective Pareto** — (ordinal, novelty) front vs. single-objective ordinal (current)
7. **ML quality predictor** — Cross-run surrogate model vs. per-run calibration only (current)

### Technical Track
1. **Staged parallel dispatch** — 6-stage pipeline vs. sequential (current)
2. **Tournament convergence** — Streak 2 vs. streak 5 (current)
3. **Single-pass for high-gap pairs** — Ordinal-gap adaptive vs. universal 2-pass (current)
4. **Adaptive single-pass** — Data-driven threshold vs. universal 2-pass (current)
5. **Format auto-fix** — Fix + re-validate vs. reject (current)
6. **Confidence instrumentation** — Log distributions vs. no logging (current)
7. **CalibrationRanker parallel reversal** — Promise.all vs. sequential (current)
8. **Reduce calibration opponents** — 3 vs. 5 (current)
9. **Flow budget guard** — Guard flow comparisons vs. unguarded (current)
10. **Cross-run comparison cache** — DB-backed vs. within-run only (current)
11. **Wire adaptive allocation** — Use historical Elo/$ data vs. static caps (current)
12. **Strategy experiment CLI** — Build orchestrator vs. none (current)

## Prioritized Execution Plan

### Sprint 1: Active (This PR)

Tasks 1, 2, 5, 7, 8 selected for implementation based on highest impact/effort ratio.

| # | Task | Status | Depends On | Est. Time |
|---|------|--------|-----------|-----------|
| 1 | Fix pseudo-embeddings with MinHash | **DONE** | None | 15 min |
| 2 | Tournament quick fixes (4 changes) | In Progress | None | 20 min |
| 5 | Pool culling at phase transition | Pending | None | 15 min |
| 8 | Confidence instrumentation | Pending | None | 10 min |
| 7 | Staged parallel agent dispatch | Pending | After 1, 2, 5, 8 | 40 min |

**Task 1: Fix pseudo-embeddings** ✅
- Replaced `_embed()` in `proximityAgent.ts` with word-trigram frequency histogram (64-dim)
- Removed broken 16-char pseudo-embeddings that made all same-article variants identical
- Commit: `09ff6741`

**Task 2: Tournament quick fixes** (in progress)
- Reduce `convergenceChecks` 5→2 (`tournament.ts:42`)
- Reduce `maxStaleRounds` 3→1 (`tournament.ts:44`)
- Tighten tiebreaker threshold `< 1.0` → `<= 0.5` + remove dead code (`tournament.ts:184-203`)
- Parallelize `reversalComparison.ts` sequential → `Promise.all`
- Tests: Update `tournament.test.ts`, `reversalComparison.test.ts`

**Task 5: Pool culling at phase transition**
- Add `cullBottomQuartile()` at EXPANSION→COMPETITION transition in `supervisor.ts`
- Remove bottom 25% of rated variants, preserve baseline, require min pool of 8
- Files: `evolution/src/lib/core/supervisor.ts`
- Test: Unit test verifying pool size reduction, baseline preservation

**Task 7: Staged parallel agent dispatch** (blocked by 1, 2, 5, 8)
- Replace sequential `for...of` loop in `pipeline.ts:388-415` with 6-stage parallel dispatch
- Fix `iterativeEditingAgent.ts` target snapshot hazard for parallel context
- Files: `evolution/src/lib/core/pipeline.ts`, `evolution/src/lib/agents/iterativeEditingAgent.ts`
- Test: `pipelineFlow.test.ts` — staged dispatch ordering and state consistency

**Task 8: Confidence instrumentation**
- Track per-comparison confidence level counts in `TournamentExecutionDetail`
- Add `confidenceDistribution` field to types
- Files: `evolution/src/lib/agents/tournament.ts`, `evolution/src/lib/types.ts`
- Enables data-driven adaptive single-pass decisions in Phase 3

### Sprint 2: Deferred (Follow-up PR)

| # | Task | Reason Deferred |
|---|------|----------------|
| 3 | Format auto-fix mode | Lower priority; dependent on rejection rate data |
| 4 | Diverse parent selection | Requires Task 1 (real embeddings) to be meaningful |
| 6 | Self-eval pre-filter | Adds LLM cost per variant; needs careful ROI analysis |

**Task 3: Format auto-fix mode**
- Add `FORMAT_VALIDATION_MODE=fix` to `formatValidator.ts`
- Auto-fix bullets→prose, missing/extra H1, table removal
- Files: `evolution/src/lib/agents/formatValidator.ts`

**Task 4: Diverse parent selection**
- Similarity-weighted second parent in `pool.ts:107-112`
- Files: `evolution/src/lib/core/pool.ts`

**Task 6: Self-eval pre-filter**
- Cheap pointwise quality gate in `generationAgent.ts` and `evolvePool.ts`
- Files: `evolution/src/lib/agents/generationAgent.ts`, `evolution/src/lib/agents/evolvePool.ts`

### Phase 3: Data-Driven Optimization (after Sprint 1-2 deployed)
Requires empirical data from production runs:

9. **Adaptive single-pass** — Implement calibration mode → adaptive mode transition based on confidence data (requires Task 8)
10. **Quantitative strategy weights** — Wire MetaReview strategy scores into agent scheduling
11. **Reduce calibration opponents** — Validate 3 opponents vs 5 on real data before changing default
12. **Wire adaptive allocation** — Enable once 10+ runs per agent exist

### Phase 4: Long-Term (weeks-months)
13. **Multi-objective Pareto front** — Requires Task 1 (real embeddings)
14. **Strategy experiment CLI** — Build orchestrator for L8 experiment framework
15. **Cross-run quality predictor** — Train after 50+ accumulated runs

## Testing

### Sprint 1 Unit Tests
- `proximityAgent.test.ts` — ✅ 22/22 pass (trigram histogram produces meaningful diversity)
- `tournament.test.ts` — Convergence streak, tiebreaker threshold, stale round tests
- `reversalComparison.test.ts` — Parallel call verification
- `supervisor.test.ts` — Pool culling at phase transition, baseline preservation
- `pipeline.test.ts` / `pipelineFlow.test.ts` — Staged dispatch ordering and state consistency
- `tournament.ts` types — Confidence distribution tracking

### Sprint 2 Unit Tests (deferred)
- `formatValidator.test.ts` — Auto-fix mode for bullets, H1, tables
- `pool.test.ts` — Diverse parent selection with mock similarity matrix
- `generationAgent.test.ts`, `evolvePool.test.ts` — Self-eval pre-filter gate

### Integration Tests
- Run evolution pipeline end-to-end with staged dispatch, verify same-quality output in less wall-clock time

### Manual Verification
- Compare Elo/$ metrics between runs with and without optimizations on staging
- Monitor confidence distribution logs after Sprint 1 deployment to validate Phase 3 assumptions

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/architecture.md` - Pipeline orchestration changes
- `evolution/docs/evolution/strategy_experiments.md` - New experiment configurations
- `evolution/docs/evolution/cost_optimization.md` - Updated cost optimization strategies
- `evolution/docs/evolution/rating_and_comparison.md` - Rating system improvements
- `evolution/docs/evolution/agents/overview.md` - Agent framework changes
- `evolution/docs/evolution/data_model.md` - Data model updates
- `evolution/docs/evolution/agents/generation.md` - Generation agent improvements
- `evolution/docs/evolution/agents/tree_search.md` - Tree search optimizations
- `evolution/docs/evolution/reference.md` - Configuration and reference updates
- `evolution/docs/evolution/hall_of_fame.md` - Hall of fame system changes

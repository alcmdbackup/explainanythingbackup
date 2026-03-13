# Rework Tournament And Calibration Agent Evolution Research

## Problem Statement
Merge CalibrationRanker and Tournament into a single ranking agent that evaluates variants on arrival. The new agent uses a two-phase approach: quick triage to eliminate weak variants, then focused comparison among top-20% contenders. This simplifies the pipeline by removing the EXPANSION/COMPETITION ranking split.

## Requirements (from GH Issue #695)
1. Replace CalibrationRanker + Tournament with a single RankingAgent
2. Evaluate-on-arrival: compare each new variant until either (A) confirmed bad or (B) in top 20% with sigma < threshold
3. Eliminate variants confidently outside top 20% early (mu + 2σ < top-20% cutoff)
4. Only require sigma convergence for top-20% contenders
5. Remove EXPANSION/COMPETITION ranking split (single ranking strategy for both phases)
6. Update pipeline dispatch, supervisor, and agent framework
7. Update tests and documentation

## High Level Summary

The merge is architecturally well-supported — a `'ranking'` sentinel already exists in the supervisor and all downstream consumers are agnostic to which agent populates `state.ratings`. Five rounds of research (20 agents total) confirmed feasibility across all dimensions.

### Architecture
1. **`'ranking'` sentinel already exists** in supervisor.ts — architecture is pre-designed for this merge
2. **All downstream consumers** (MetaReview, Evolution, persistence, attribution, arena sync) read `state.ratings` — completely transparent to this change
3. **TreeSearch** uses isolated local ratings — zero conflict
4. **Arena** uses separate pairing but same rating functions — fully compatible

### Merged Agent Design
5. **Two-phase execute()**: Triage (new entrants, replaces CalibrationRanker) → Fine-ranking (Swiss pairing among contenders, replaces Tournament)
6. **Use PairwiseRanker** as the comparison interface — it's a superset of CalibrationRanker's standalone wrapper
7. **Unify draw detection** at `confidence < 0.3` (Tournament's threshold) — CalibrationRanker's `confidence === 0` is too strict
8. **Skip flow comparison in triage** — saves ~15-30 LLM calls/iteration; preserve in fine-ranking (opt-in via enabledAgents)
9. **Recompute budget pressure after triage** — snapshot before calibration may not reflect post-calibration state
10. **Early elimination**: Extend Swiss pairing eligibility filter to exclude `mu + 2σ < top20Cutoff`

### Config & Backward Compatibility
11. **Keep `calibration.*` and `tournament.*` config sections** for backward compat — merged agent reads both
12. **Alias-based DB reads** (no data migration): query `WHERE agent_name IN ('ranking', 'calibration', 'tournament')`
13. **15 UI files** need string literal updates; keep CalibrationDetail/TournamentDetail for old runs
14. **REQUIRED_AGENTS**: Replace `['calibration', 'tournament']` with `['ranking']`; update AGENT_DEPENDENCIES

### Edge Cases (All Safe)
15. **Single-article mode**: Both agents skip (pool < 2) — merged agent uses same guard
16. **Tiny pools**: Swiss pairing exits via stale rounds — normal termination, not error
17. **Budget exhaustion**: BudgetExceededError re-throw pattern preserved from both agents
18. **All new entrants**: Tied ratings → arbitrary pairing order (acceptable for first iteration)

### Testing
19. **Critical gap**: No test for calibration → tournament handoff (ratings flowing across phase transition)
20. **Test plan**: Phase transition handoff, top-K focusing cost reduction, backward compat for old execution details

## Prior Discussion Findings

### Current Architecture: How the Three Agents Relate

```
PairwiseRanker (utility — not a pipeline agent)
  ├── used by CalibrationRanker (EXPANSION phase)
  └── used by Tournament (COMPETITION phase)
```

- **PairwiseRanker**: Reusable comparison engine. Runs 2-pass bias-mitigated A-vs-B comparisons. Not called by the pipeline directly.
- **CalibrationRanker**: Runs during EXPANSION. For each new variant, picks 3-5 stratified opponents (top/mid/bottom tiers), does quick burst of comparisons. Adaptive early-exit skips remaining opponents if results are decisive.
- **Tournament**: Runs during COMPETITION. Swiss-pairs the entire pool across multiple rounds until sigma converges. Wraps PairwiseRanker internally.

Pipeline dispatch (`pipeline.ts:474-476`):
```typescript
if (agentName === 'ranking') {
  const rankingAgent = phase === 'COMPETITION' ? agents.tournament : agents.calibration;
}
```

### Swiss Pairing: Current Implementation

The `swissPairing()` function in `tournament.ts` maximizes information gain per comparison:
1. **Eligibility filter**: Excludes variants both outside top-K AND confidently below baseline (`mu < 3 * sigma`)
2. **Pair scoring**: `outcomeUncertainty * sigmaWeight` — prefers close matches between uncertain variants
3. **Outcome uncertainty**: Logistic CDF — peaks at 1.0 when ratings are equal, drops to 0 for lopsided matchups
4. **Greedy selection**: Sort pairs by descending score, pick best, mark both used, repeat

For a pool of ~8 variants, Swiss pairing reaches stable rankings in ~10-15 comparisons vs ~28 for full round-robin (~40-60% reduction in LLM calls).

### Why CalibrationRanker Can Be Absorbed

CalibrationRanker's value is fast onboarding — give a new variant a rough rating in 3-5 comparisons. With a top-20% focused approach, the unified agent can absorb this:
- **Phase 1 (triage)** replaces CalibrationRanker — compare each variant against 1-2 anchor opponents to quickly bucket into "contender" vs "eliminated"
- **Phase 2 (fine ranking)** is existing Swiss pairing among contenders only

Benefits of merging:
- Eliminates EXPANSION→COMPETITION phase boundary for ranking
- Removes duplicated rating-update logic
- Uses one pairing strategy instead of two (stratified + Swiss)
- Naturally handles "only care about top 20%" from the start

### Top-20% Focused Strategy Changes

If we only care about top 20%:
1. **Aggressive early elimination**: Once `mu + 2σ < top20thPercentileMu`, stop comparing that variant entirely
2. **Convergence scoping**: Only require sigma convergence for top-20% contenders, not all eligible variants
3. **Pairing bias**: Weight pairing score so matches involving contenders are preferred

Expected impact for pool of 8 (top 20% = top 2):
- Current: ~10-15 comparisons to converge all eligible ratings
- Top-20% focused: ~5-8 comparisons

### Critical Finding: Sigma Is Monotonically Decreasing in Weng-Lin

In OpenSkill (Weng-Lin), sigma **never increases**. Every match — win, loss, or draw, expected or surprising — reduces sigma:
```
σ_new² = σ_old² × (1 - σ_old² × w)    // w is always positive
```

A surprise result causes a large mu shift but sigma still shrinks. This means:
- A converged variant (sigma=2.5) that loses unexpectedly gets a lower mu but even lower sigma (~2.4)
- The system becomes *more confident in a worse rating*
- There is no mechanism to "re-open" uncertainty

**Implication for evaluate-on-arrival**: If existing pool ratings are trustworthy, this is fine. But if a strong newcomer deflates existing ratings, subsequent newcomers may get distorted evaluations against those deflated opponents.

**User decision**: The user explicitly does NOT want sigma inflation / tau parameter to address this. The evaluate-on-arrival approach should work without reopening sigma.

### Options Discussed for Re-Ranking After Upsets

1. **Periodic re-ranking rounds** among top 20% when membership changes — small Swiss round to confirm ordering
2. **Sigma inflation (tau parameter)** — rejected by user
3. **Challenge-based ripple**: When newcomer beats a top-20% variant, re-match that variant against another top-tier to confirm the drop

---

## Round 1 Research Findings

### R1-1: Pipeline Dispatch & Supervisor Integration

**Key insight: The `'ranking'` sentinel already exists — architecture is pre-designed for this merge.**

#### Integration Points (exhaustive list)

| File | Lines | Reference | Change Needed |
|------|-------|-----------|---------------|
| `types.ts` | 15-19 | `AgentName` union includes `'calibration'` and `'tournament'` | Replace with `'ranking'` |
| `types.ts` | 164-198 | `CalibrationExecutionDetail` and `TournamentExecutionDetail` types | Merge into `RankingExecutionDetail` |
| `types.ts` | 337-349 | `AgentExecutionDetail` union | Update to include new type |
| `pipeline.ts` | 272-285 | `PipelineAgents` interface has `calibration` + `tournament` fields | Replace with single `ranking` field |
| `pipeline.ts` | 474-476 | Phase-based dispatch logic | Simplify to `agents.ranking` directly |
| `supervisor.ts` | 55-56 | `ExecutableAgent = AgentName \| 'ranking'` | `'ranking'` becomes part of `AgentName` directly |
| `supervisor.ts` | 63-69 | `AGENT_EXECUTION_ORDER` — `'ranking'` sentinel | No change needed |
| `supervisor.ts` | 83-96 | `getActiveAgents()` — unconditionally includes `'ranking'` | No change needed |
| `index.ts` | 135-150 | `createDefaultAgents()` creates both agents | Single `ranking: new RankingAgent()` |
| `budgetRedistribution.ts` | 10-12 | `REQUIRED_AGENTS` includes both | Replace with `'ranking'` |
| `budgetRedistribution.ts` | 29-36 | `AGENT_DEPENDENCIES`: evolution→tournament, metaReview→tournament | Change to →ranking |
| `configValidation.ts` | 115-120 | Validates `calibration.opponents` and `tournament.topK` | Merge config validation |
| `costEstimator.ts` | 40-52 | `AgentModels` has separate calibration/tournament entries | Merge to single `ranking` |
| `costEstimator.ts` | 228-242 | Separate cost estimation for each | Unified cost estimation |
| `AgentExecutionDetailView.tsx` | 31-43 | Switch cases for 'calibration' and 'tournament' | Single 'ranking' case |

#### Checkpoint/Resume
- `'ranking'` sentinel preserved through checkpoint/resume cycle (pipeline.ts:416)
- Resume logic uses `pendingResumeAgents` which may contain `'ranking'` — no change needed

### R1-2: CalibrationRanker Internals

#### Execute Flow
1. Filter `newEntrantsThisIteration` — skip entries with sigma < 5.0 (CALIBRATED_SIGMA_THRESHOLD)
2. For each entrant: get stratified opponents via `PoolManager.getCalibrationOpponents()`
3. Split opponents into batches: `firstBatch = slice(0, minOpp=2)`, `remainingBatch = slice(minOpp)`
4. Run first batch in parallel (`Promise.allSettled`)
5. Early-exit check: all confidence >= 0.7 AND avg >= 0.8 → skip remaining batch
6. Otherwise run remaining batch in parallel
7. Rating updates applied per-match via `applyRatingUpdate()`

#### Stratified Opponent Selection (`PoolManager.getCalibrationOpponents`, pool.ts:27-105)
- For n=5: 2 from top quartile, 2 from middle, 1 from bottom/new entrants
- For n=3: 1 top, 1 middle, 1 bottom/new
- Deduplication + padding to ensure exactly n opponents

#### Key Differences from Tournament
| Aspect | CalibrationRanker | Tournament |
|--------|------------------|------------|
| Scope | `newEntrantsThisIteration` only | Full pool |
| Opponent selection | Stratified (fixed n) | Swiss pairing (info-theoretic) |
| Rating updates | Per-match, immediate | Batched per round |
| Draw detection | `confidence === 0` | `confidence < 0.3` |
| Convergence | Confidence-based early exit | Sigma-based, 2 consecutive rounds |
| Flow comparison | No | Yes (optional) |
| Multi-turn tiebreaker | No | Yes (top-quartile close matches) |

### R1-3: Tests & Arena Integration

#### Test Coverage
| Component | Tests | Key Gaps |
|-----------|-------|----------|
| Tournament | ~30 | No sigma change verification, no matchCounts assertion |
| CalibrationRanker | ~9 | Multiple entrants per iteration not tested, cache hit tracking |
| PairwiseRanker | ~18 | Dimension score merging not directly tested |
| ArenaIntegration | 0 | **No unit tests at all** |
| ComparisonCache | 0 | **No unit tests at all** |

#### Arena Entry Loading (`arenaIntegration.ts:loadArenaEntries`)
1. Queries `evolution_arena_entries` + `evolution_arena_elo` for topic
2. Creates `TextVariation` with `fromArena: true`
3. Pushes directly to `state.pool` (bypasses `newEntrantsThisIteration`)
4. Pre-seeds `state.ratings` with `{ mu, sigma }` from DB
5. Pre-seeds `state.matchCounts` from DB

Interaction with calibration: Arena entries with sigma < 5.0 skip calibration but serve as opponents. This is a good pattern to preserve in the merged agent.

#### matchHistory & matchCounts
Both agents push to `state.matchHistory` and increment `state.matchCounts` identically. **Fully compatible** — no merge conflict.

### R1-4: Types, State & Downstream Consumers

#### Downstream Consumer Analysis
| Consumer | Reads | Impact of Merge |
|----------|-------|----------------|
| MetaReviewAgent | `state.ratings` for strategy mu analysis | **None** — reads ratings map, doesn't care who wrote it |
| EvolutionAgent | `state.getTopByRating()` for parent selection | **None** — reads sorted pool |
| ProximityAgent | `state.newEntrantsThisIteration` | **None** — set by `startNewIteration()`, not by ranking |
| `buildRunSummary()` | `state.getTopByRating(5)`, `state.ratings` | **None** — reads final ratings |
| `persistVariants()` | `toEloScale(ratings.get(v.id).mu)` | **None** — reads final mu |
| `computeEloAttribution()` | Variant ratings + parent ratings | **None** — reads final state |
| `syncToArena()` | `state.matchHistory`, `state.ratings`, `state.matchCounts` | **None** — reads final state |

**Key finding**: All downstream consumers read from `state.ratings` and `state.matchHistory`. They are completely agnostic to which agent populated these. The merge is **transparent to all consumers**.

#### PipelineState Key Fields (state.ts)
- `ratings: Map<string, Rating>` — mutable, keyed by variant ID
- `matchHistory: Match[]` — append-only
- `matchCounts: Map<string, number>` — incremented by both agents identically
- `newEntrantsThisIteration: string[]` — cleared in `startNewIteration()`, populated by generation/evolution agents
- `getTopByRating(n)` — sorts by mu descending

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/arena.md

## Code Files Read
- evolution/src/lib/agents/tournament.ts — Swiss pairing, tournament agent, budget pressure config
- evolution/src/lib/agents/tournament.test.ts — 30+ tests covering pairing, convergence, budget, time limits
- evolution/src/lib/agents/calibrationRanker.ts — stratified opponent selection, adaptive early exit
- evolution/src/lib/agents/calibrationRanker.test.ts — 9 tests covering early exit, budget errors, low-sigma skip
- evolution/src/lib/agents/pairwiseRanker.ts — core comparison engine (comparePair, compareWithBiasMitigation)
- evolution/src/lib/agents/pairwiseRanker.test.ts — 18 tests covering parsing, caching, concurrency
- evolution/src/lib/core/rating.ts — OpenSkill wrapper (createRating, updateRating, updateDraw, isConverged, toEloScale)
- evolution/src/lib/core/pipeline.ts — dispatch logic, PipelineAgents interface, buildRunSummary
- evolution/src/lib/core/supervisor.ts — ExecutableAgent, AGENT_EXECUTION_ORDER, getActiveAgents
- evolution/src/lib/core/state.ts — PipelineStateImpl, ratings management, serialization
- evolution/src/lib/core/pool.ts — PoolManager, getCalibrationOpponents stratified selection
- evolution/src/lib/core/arenaIntegration.ts — loadArenaEntries, syncToArena
- evolution/src/lib/core/comparisonCache.ts — order-invariant SHA-256 caching
- evolution/src/lib/core/budgetRedistribution.ts — REQUIRED_AGENTS, AGENT_DEPENDENCIES
- evolution/src/lib/core/configValidation.ts — calibration/tournament config validation
- evolution/src/lib/core/costEstimator.ts — per-agent cost estimation, AgentModels
- evolution/src/lib/core/eloAttribution.ts — computeEloAttribution, aggregateByAgent
- evolution/src/lib/core/persistence.ts — persistVariants, checkpoint
- evolution/src/lib/index.ts — createDefaultAgents factory, exports
- evolution/src/lib/types.ts — AgentName, AgentResult, execution detail types, PipelineState
- evolution/src/lib/agents/metaReviewAgent.ts — reads state.ratings for strategy analysis
- evolution/src/lib/agents/evolvePool.ts — getTopByRating for parent selection
- evolution/src/lib/agents/proximityAgent.ts — reads newEntrantsThisIteration
- evolution/src/components/evolution/agentDetails/AgentExecutionDetailView.tsx — UI routing by detailType
- evolution/docs/evolution/agents/overview.md — agent framework and interaction patterns

---

## Round 2 Research Findings

### R2-1: Config System & PoolManager

#### Config Structure (`config.ts`)
```typescript
// Current defaults
calibration: { opponents: 5, minOpponents: 2 },
tournament: { topK: 5 },
```

- `resolveConfig()` uses recursive deep merge — partial overrides of nested objects work
- `MAX_RUN_BUDGET_USD = $1.00` hard cap
- Convergence: `RATING_CONSTANTS.CONVERGENCE_SIGMA_THRESHOLD = 3.0`
- CalibrationRanker skip threshold: `CALIBRATED_SIGMA_THRESHOLD = 5.0`

#### Cross-Dependency
Tournament uses `config.calibration.opponents > 3` to decide structured vs simple comparison mode (tournament.ts:219). This must be preserved or replaced with a dedicated config field.

#### PoolManager.getCalibrationOpponents() (pool.ts:27-105)
- Sorts existing pool by mu descending
- Computes quartiles: q1=25%, q2=50%, q3=75%
- n=5: 2 top + 2 mid + 1 bottom/new; n=3: 1 top + 1 mid + 1 bottom/new
- Edge cases: first iteration (only other new entrants), small pool (mix existing + new), no ratings (sample + new)
- Dedup + padding ensures exactly n opponents

#### Proposed Config for Merged Agent
```typescript
ranking: {
  triageOpponents: number;       // replaces calibration.opponents (default 5)
  triageMinOpponents?: number;   // replaces calibration.minOpponents (default 2)
  topK: number;                  // replaces tournament.topK (default 5)
  convergenceSigmaThreshold?: number;  // default 3.0
  calibratedSigmaThreshold?: number;   // skip already-calibrated (default 5.0)
  useStructuredComparison?: boolean;   // replaces calibration.opponents > 3 heuristic
}
```

### R2-2: UI Components (15 files)

#### Components to Update
| File | What Changes |
|------|-------------|
| `agentDetails/CalibrationDetail.tsx` | Keep for backward compat OR merge into RankingDetail |
| `agentDetails/TournamentDetail.tsx` | Keep for backward compat OR merge into RankingDetail |
| `agentDetails/AgentExecutionDetailView.tsx` | Add 'ranking' case, keep 'calibration'/'tournament' for old runs |
| `tabs/TimelineTab.tsx:358,365` | Agent palette colors for 'calibration' (green) and 'tournament' (red) |
| `strategies/page.tsx:52-66` | AGENT_LABELS record |
| `analysis/StrategyConfigDisplay.tsx:10-22` | AGENT_LABELS record |
| `analysis/CostBreakdownPie.tsx:19-20` | AGENT_COLORS record |
| `analysis/CostAccuracyPanel.tsx` | Per-agent accuracy display |
| `budgetRedistribution.ts:10-12` | REQUIRED_AGENTS list |

#### Test Files (6)
- TimelineTab.test.tsx, StrategyConfigDisplay.test.tsx, CostAccuracyPanel.test.tsx
- BudgetTab.test.tsx, MetricsTab.test.tsx, LogsTab.test.tsx

### R2-3: Comparison Interface Decision

**Recommendation: Use PairwiseRanker (Tournament's pattern)**

| Feature | Standalone (comparison.ts) | PairwiseRanker |
|---------|---------------------------|----------------|
| Simple comparison | Yes | Yes |
| Structured multi-dimension | No | Yes |
| Flow comparison | No | Yes |
| ComparisonCache integration | No (uses Map) | Yes (uses ctx.comparisonCache) |
| agentNameOverride | No | Yes |
| Multi-turn tiebreaker | No | Yes (comparePair as 3rd call) |

CalibrationRanker's private wrapper (lines 17-74) is essentially a thinner version of PairwiseRanker. The merged agent should:
1. Compose `new PairwiseRanker()` internally (like Tournament does)
2. Use `pairwise.compareWithBiasMitigation()` for all comparisons
3. Use `pairwise.comparePair()` for tiebreakers
4. Optionally use `pairwise.compareFlowWithBiasMitigation()` for flow

### R2-4: Backward Compatibility & Migration

#### Risk Summary
| Component | Risk | Strategy |
|-----------|------|----------|
| **Checkpoints** | LOW | Old `last_agent` values are metadata only; resume uses sentinels |
| **Agent Invocations** | HIGH | 6000+ rows with `agent_name = 'calibration'/'tournament'` |
| **Cost Baselines** | HIGH | Baselines keyed by agent name; 'ranking' has no history |
| **Execution Detail Types** | MEDIUM | Stored JSONB has `detailType: 'calibration'/'tournament'` |
| **Run Summary** | NONE | Already agent-agnostic |
| **Feature Flags** | NONE | No agent-specific flags exist |

#### Recommended Migration: Alias-Based Reads (No Data Migration)

1. **Cost baselines**: When fetching for 'ranking', also try 'calibration' and 'tournament'
   ```typescript
   for (const candidate of ['ranking', 'calibration', 'tournament']) {
     const baseline = await getAgentBaseline(candidate, model);
     if (baseline) return baseline;
   }
   ```

2. **Cost aggregation**: Accept all three names in metricsWriter queries

3. **Execution detail UI**: Keep CalibrationDetail and TournamentDetail components, add RankingDetail
   ```typescript
   case 'calibration': return <CalibrationDetail />;
   case 'tournament': return <TournamentDetail />;
   case 'ranking': return <RankingDetail />;
   ```

4. **LLM call tracking**: New calls use `evolution_ranking` call_source. Baseline refresh function already extracts agent name from `call_source.replace(/^evolution_/, '')`.

#### DB References with agent_name Filtering
- `persistence.ts:249` — attribution UPDATE WHERE agent_name (needs null-safety for old records)
- `metricsWriter.ts:143` — cost aggregation by agent_name (works with mixed names)
- `costEstimator.ts:100` — baseline lookup (needs alias fallback)
- `pipeline.test.ts:1116` — test assertions (update to 'ranking')

---

## Round 3 Research Findings

### R3-1: Supervisor & Phase Transition Impact

**Key finding: Supervisor stays almost unchanged.**

- `getActiveAgents()` unconditionally includes `'ranking'` — no phase-dependent logic needed
- Phase transition logic (`shouldTransition()`) is based on pool size and diversity, not agent names
- The `'ranking'` sentinel in `AGENT_EXECUTION_ORDER` already abstracts over calibration/tournament
- **One change needed**: Pass `phase` in `ExecutionContext` so the merged RankingAgent knows whether it's in EXPANSION or COMPETITION. Currently phase is available in pipeline.ts but not forwarded to agent.execute()

### R3-2: TreeSearch Isolation

**No conflict with merge.** TreeSearch uses completely isolated local ratings:
- Creates fresh `Map<string, Rating>` per invocation
- Never reads or writes `state.ratings`
- Uses `createRating()` / `updateRating()` from rating.ts but on its own local map
- Uses its own internal comparison (not PairwiseRanker)
- The merge has zero impact on TreeSearch

### R3-3: Arena Compatibility

**Arena uses separate pairing but same rating/comparison functions — merge is compatible.**

- Arena pairing (`arenaIntegration.ts`): greedy pair selection optimizing for uncertainty × Elo gap, separate from Swiss pairing
- Arena shares `updateRating()`, `updateDraw()`, `toEloScale()` from rating.ts
- `loadArenaEntries()` pre-seeds `state.pool`, `state.ratings`, `state.matchCounts` — these are the same fields the merged agent will use
- `syncToArena()` reads `state.matchHistory` and `state.ratings` — agent-agnostic
- Arena entries skip calibration via `sigma < CALIBRATED_SIGMA_THRESHOLD` check — this pattern should be preserved in the merged agent (skip triage for already-calibrated variants)

### R3-4: Evaluate-on-Arrival Feasibility

**Append-only pool is NOT a blocker. "Evaluate-on-arrival" means "stop comparing confirmed-bad variants", not "remove from pool".**

- Pool grows ~3 variants per iteration (generation + evolution agents)
- Top 20% of typical pool of 25 = top 5 variants
- Early elimination needs only 2-3 decisive losses (mu + 2σ drops below cutoff)
- Swiss pairing already excludes below-baseline variants via eligibility filter
- For the merged agent: extend eligibility filter to also exclude `mu + 2σ < top20Cutoff`
- New variants start with high sigma (8.33), so 2-3 matches are sufficient to triage them
- Convergence for top-20% contenders typically takes 5-8 additional matches after triage

---

## Round 4 Research Findings

### R4-1: Edge Cases

#### Single-Article Mode (pool=1)
- `singleArticle: true` excludes generation/evolution/outlineGeneration but keeps ranking agents enabled
- Both agents' `canExecute()` require `pool.length >= 2` — safely skip when only baseline exists
- **Merged agent**: Single `canExecute()` check `pool >= 2` is sufficient

#### Short Runs (1-2 Iterations)
- Fresh sigma=8.333 needs ~8-12 comparisons to reach convergence threshold (sigma < 3.0)
- In 2 iterations, tournament may only reach ~10-20 comparisons — likely exits via `maxRounds` not convergence
- **No special handling needed** — existing exitReason tracking covers this

#### Tiny Pools (2-3 Variants)
- Swiss pairing with 2 variants: exactly 1 pair per round, stale exit after all unique pairs exhausted
- Stratified selection with 2 variants: all quartiles collapse to same index → only 1 unique opponent even if minOpponents=2
- **Warning**: CalibrationRanker may calibrate with fewer opponents than `minOpponents` config — log warning, not error

#### All New Entrants (First Iteration)
- All variants at mu=25, sigma=8.333 → all pair scores equal → arbitrary pairing order (acceptable)
- Convergence check fails (8.333 > 3.0 threshold) → never converges first iteration (expected)
- **No special handling needed**

#### Budget Exhaustion Mid-Ranking
- Tournament: BudgetExceededError properly re-thrown from Promise.allSettled; rating updates applied only for fulfilled promises
- CalibrationRanker: exception propagates out of execute(); earlier entrants already updated, later entrants skipped
- **Both error paths must be preserved in merged agent**

### R4-2: Budget Pressure Integration

#### Current Budget Architecture
- **Single global CostTracker** per run — no per-agent budget limits
- Pre-call reservation with 30% safety margin; latched overflow flag prevents new reservations
- Per-agent cost tracking is for attribution/reporting only

#### Tournament Budget Pressure Tiers
| Pressure | maxComparisons | maxMultiTurnDebates |
|----------|---------------|-------------------|
| Low (<0.5) | 40 | 3 |
| Medium (0.5-0.8) | 25 | 1 |
| High (≥0.8) | 15 | 0 |

- Budget pressure = `1 - (availableBudget / budgetCapUsd)`
- 5% hard stop: abort if available budget < 5% of cap

#### CalibrationRanker Budget Handling
- **No explicit budget checks** — relies on BudgetExceededError from llmClient.complete()
- No adaptive behavior under pressure (always uses config.calibration.opponents)

#### Changes for Merged Agent
1. **Recompute budget pressure after triage** — pressure snapshot before calibration may not reflect post-calibration state
2. **Decision needed**: Should triage phase reduce opponents under high budget pressure?
3. **Cost estimation**: Merge calibration + tournament into single estimate; currently separate in costEstimator.ts
4. **Cost attribution**: Consider tracking triage vs tournament phases separately within single 'ranking' agent

### R4-3: Flow Comparison in Merged Agent

#### Current Flow Comparison Usage
- **Opt-in** via `enabledAgents.includes('flowCritique')` — disabled by default
- Runs on **all Swiss-paired comparisons** after quality comparison, not selectively
- Produces 5 flow dimensions (`local_cohesion`, `global_coherence`, `transition_quality`, `rhythm_variety`, `redundancy`) + friction spots (exact problem sentences)
- Cost: ~2 additional LLM calls per pair (2-pass bias mitigation)
- **Does NOT influence ranking decision** — winner determined by quality comparison; flow is auxiliary metadata

#### Multi-Turn Tiebreaker
- Triggers when: `confidence <= 0.5` AND both variants in top quartile AND close mu values
- Uses single-pass `comparePair()` (not flow comparison)
- Budget-pressure-dependent: 3 debates at low pressure, 0 at high pressure

#### Recommendation for Merged Agent
- **Skip flow in triage phase** — variants being eliminated don't need detailed flow analysis; saves ~15-30 LLM calls/iteration
- **Preserve flow in fine-ranking phase** — contenders benefit from friction spot feedback
- **No config changes needed** — flow remains optional via existing `enabledAgents` flag

### R4-4: Config System & Backward Compatibility

#### No Formal Experiment/Feature-Flag System
- Behavior controlled via EvolutionRunConfig + strategy_configs table, not feature flags
- Strategy configs hashed by (generationModel, judgeModel, iterations, enabledAgents, singleArticle)
- `calibration` and `tournament` are in REQUIRED_AGENTS — cannot be toggled via enabledAgents

#### Config Backward Compatibility Approach
- **Keep `calibration.*` and `tournament.*` config sections** — merged agent reads both
- No DB schema changes needed; `resolveConfig()` deep merge handles missing fields
- Old configs with both sections parse without error
- Optional: Add `ranking.*` section that takes precedence if present, with fallback to legacy sections

#### Config Validation Changes
- `validateRunConfig()`: Keep existing calibration/tournament validation
- `REQUIRED_AGENTS`: Replace `['calibration', 'tournament']` with `['ranking']`
- `AGENT_DEPENDENCIES`: Change `evolution→tournament` and `metaReview→tournament` to `→ranking`

---

## Round 5 Research Findings

### R5-1: Integration Test Coverage

#### Existing Coverage
- **pipeline.test.ts**: ~2,874 test cases; phase-aware gating, agent sequencing, cost attribution, continuation/resume
- **calibrationRanker.test.ts**: ~9 tests (model passthrough, bias mitigation, early exit, budget errors, arena skip)
- **tournament.test.ts**: ~30 tests (Swiss pairing, eligibility, budget pressure, convergence, multi-turn)
- **pairwiseRanker.test.ts**: ~18 tests (structured/simple modes, dimension merging, cache)

#### Critical Gaps for Merged Agent
1. **Calibration → Tournament handoff**: No test verifying calibrated ratings flow into tournament Swiss pairing across phase transition
2. **Top-20% early elimination**: No end-to-end test where weak variants are excluded from tournament pairing
3. **Convergence early stopping**: No test mixing budget pressure with convergence detection
4. **Arena + ranking integration**: No test of Arena entries (pre-calibrated) flowing through both phases
5. **Backward compat for ExecutionDetail**: No test loading old calibration/tournament detail formats

#### Recommended Test Plan
- **Priority 1**: Phase transition handoff (ratings persist, match history accessible)
- **Priority 2**: Top-K focusing reduces comparison count
- **Priority 3**: Backward compatibility for old execution detail formats
- **Test helpers to add**: `createTestPoolByMuDistribution()`, `createConvergedPool()`, `executePhaseTransitionScenario()`

### R5-2: PoolManager Changes

#### Current API (Read-Only Facade over PipelineState)
| Method | Used By |
|--------|---------|
| `addVariants(variants)` | External loaders |
| `getCalibrationOpponents(id, n)` | CalibrationRanker |
| `getEvolutionParents(n)` | EvolutionAgent |
| `poolStatistics()` | Logging |

#### No Breaking Changes Needed
- PoolManager remains a read-only facade; state mutations happen directly on PipelineState
- `getCalibrationOpponents()` can be reused for triage phase as-is (stratified selection is still the right strategy)
- Tournament's eligibility filtering (mu < 3*sigma AND outside topK) is inline in tournament.ts — could be extracted to PoolManager but not required

#### Optional New Methods
- `getTriageOpponents()` — wrapper for `getCalibrationOpponents()` with clearer semantics
- `getEligibleVariants(topK)` — extract tournament's eligibility filter logic
- `getEliteThreshold(percentile)` — DRY up mu-threshold calculation

### R5-3: DB Schema & Migration

#### Tables with Agent Name References
| Table | Column | Constraint |
|-------|--------|-----------|
| `evolution_agent_invocations` | `agent_name TEXT` | UNIQUE(run_id, iteration, agent_name) |
| `evolution_run_agent_metrics` | `agent_name TEXT` | UNIQUE(run_id, agent_name) |

- Both use TEXT, not enum — no schema change needed for new agent name
- `execution_detail` JSONB has `detailType: 'calibration'|'tournament'` discriminator

#### Recommended: Alias-Based Reads (No Data Migration)
1. New invocations write `agent_name = 'ranking'`
2. Queries that need historical data: `WHERE agent_name IN ('ranking', 'calibration', 'tournament')`
3. Cost baselines: fallback chain `['ranking', 'calibration', 'tournament']`
4. UI: Keep CalibrationDetail/TournamentDetail components for old runs, add RankingDetail for new runs
5. **Zero migration SQL needed**

#### Unique Constraint Consideration
- `UNIQUE(run_id, iteration, agent_name)` means 'ranking' can coexist with old 'calibration'/'tournament' rows
- In merged agent: only one invocation per iteration ('ranking'), not two separate ones
- Old runs: two rows per iteration (calibration + tournament); new runs: one row ('ranking')

### R5-4: Prior Planning & Documentation

#### No Prior Planning Exists for This Merge
- No existing planning docs related to ranking agent consolidation in `docs/planning/`
- No TODO comments in calibrationRanker.ts or tournament.ts about future merging
- The `'ranking'` sentinel in supervisor.ts was designed as a dispatch abstraction, not explicitly for merge prep

#### Docs Needing Update After Merge
- `evolution/docs/evolution/rating_and_comparison.md` — Swiss pairing, calibration strategy sections need major rewrite
- `evolution/docs/evolution/architecture.md` — Phase descriptions, agent classification, data flow diagrams
- `evolution/docs/evolution/arena.md` — Arena integration with new ranking agent

#### Recent Codebase Evolution
- Recent commits show active pipeline maturity: cost estimation fixes, UI cleanup, ordinal→mu migration
- Evolution pipeline is stable and well-tested — merge is a refactoring exercise, not architectural innovation


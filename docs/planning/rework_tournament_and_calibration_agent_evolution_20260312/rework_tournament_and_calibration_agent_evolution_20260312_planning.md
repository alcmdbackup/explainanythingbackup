# Rework Tournament And Calibration Agent Evolution Plan

## Background
Merge CalibrationRanker and Tournament into a single ranking agent that evaluates variants on arrival. The new agent uses a two-phase approach: quick triage to eliminate weak variants, then focused comparison among top-20% contenders. This simplifies the pipeline by removing the EXPANSION/COMPETITION ranking split.

## Requirements (from GH Issue #695)
1. Replace CalibrationRanker + Tournament with a single RankingAgent
2. Evaluate-on-arrival: compare each new variant until either (A) confirmed bad or (B) in top 20% with sigma < threshold
3. Eliminate variants confidently outside top 20% early (mu + 2σ < top-20% cutoff)
4. Only require sigma convergence for top-20% contenders
5. Remove EXPANSION/COMPETITION ranking split (single ranking strategy for both phases)
6. Update pipeline dispatch, supervisor, and agent framework
7. Update tests and documentation

## Problem
The evolution pipeline currently uses two separate ranking agents — CalibrationRanker (EXPANSION phase) and Tournament (COMPETITION phase) — dispatched via a `'ranking'` sentinel in the supervisor. This creates duplicated rating-update logic, inconsistent draw detection thresholds (confidence === 0 vs < 0.3), two different pairing strategies (stratified vs Swiss), and an artificial phase boundary for *ranking specifically* that delays focused ranking of top variants. Since we only care about identifying and converging the top 20%, a single agent can triage new variants quickly and focus comparison budget on contenders, reducing LLM calls by ~40-60%.

**Important scope note**: The EXPANSION/COMPETITION phase system itself is NOT being removed. Phases control which agents execute (7+ agents are COMPETITION-only: reflection, debate, evolution, treeSearch, etc.), phase transition logic (pool size + diversity gates), checkpoint/resume, and UI display. We are only removing the phase-conditional *ranking dispatch* — the merged RankingAgent replaces the `phase === 'COMPETITION' ? tournament : calibration` switch with a single agent that adapts its behavior internally based on pool state (new entrants present → triage; contenders exist → fine-ranking).

## Options Considered

### Option A: Merge into Single RankingAgent (Selected)
- Single class with two-phase execute(): triage (new entrants) → fine-ranking (Swiss pairing among contenders)
- Compose PairwiseRanker internally for all comparisons
- Keep `calibration.*` and `tournament.*` config sections for backward compat
- Alias-based DB reads (no data migration)
- **Pros**: Clean architecture, single pairing strategy, reduced LLM calls
- **Cons**: Large changeset across types/pipeline/UI/tests

### Option B: Keep Two Agents, Unify Strategy
- Keep CalibrationRanker and Tournament as separate classes
- Align draw detection, add top-20% focusing to both
- **Pros**: Smaller changeset
- **Cons**: Still duplicated logic, two agents to maintain, phase boundary remains

### Option C: Tournament Only, Remove CalibrationRanker
- Swiss-pair new entrants against full pool from the start
- **Pros**: Simplest — one existing agent
- **Cons**: Swiss pairing is expensive for new variants that only need 2-3 comparisons to triage; loses CalibrationRanker's efficient stratified onboarding

**Decision**: Option A. The `'ranking'` sentinel already exists, all downstream consumers are transparent, and the merge is a refactoring exercise.

## Phased Execution Plan

### Phase 1: Core Types & Config (no behavior change)
**Goal**: Update type system and config to support 'ranking' agent name. Old agents continue to function.

1. **types.ts**: Add `'ranking'` to `AgentName` union (keep `'calibration'` and `'tournament'` temporarily)
2. **types.ts**: Create `RankingExecutionDetail` type with explicit structure:
   ```typescript
   interface RankingExecutionDetail extends ExecutionDetailBase {
     detailType: 'ranking';
     triage: Array<{
       variantId: string;
       opponents: string[];
       matches: Array<{ opponentId: string; winner: string; confidence: number; cacheHit: boolean }>;
       eliminated: boolean;          // true if mu + 2σ < top20Cutoff
       ratingBefore: { mu: number; sigma: number };
       ratingAfter: { mu: number; sigma: number };
     }>;
     fineRanking: {
       rounds: Array<{ roundNumber: number; pairs: Array<{ variantA: string; variantB: string }>; matches: Array<Match> }>;
       exitReason: 'budget' | 'convergence' | 'stale' | 'maxRounds' | 'time_limit' | 'no_contenders';
       convergenceStreak: number;
     };
     budgetPressure: number;
     budgetTier: 'low' | 'medium' | 'high';
     top20Cutoff: number;
     eligibleContenders: number;
     totalComparisons: number;
     flowEnabled: boolean;
   }
   ```
3. **config.ts**: Keep `calibration.*` and `tournament.*` defaults as-is (merged agent reads both). Add `useStructuredComparison` config field to replace the `calibration.opponents > 3` heuristic used by Tournament (tournament.ts:219)
4. **configValidation.ts**: Keep existing calibration/tournament validation; add validation for 'ranking' agent name

**Note**: `budgetRedistribution.ts` changes (REQUIRED_AGENTS, AGENT_DEPENDENCIES) are deferred to Phase 3 when the agent is wired in. Updating REQUIRED_AGENTS to `['ranking']` before the agent exists would cause build failures.

**Files**: `types.ts`, `config.ts`, `configValidation.ts`
**Tests**: Config validation tests

### Phase 2: RankingAgent Implementation
**Goal**: Create the merged agent — single ranking logic, no phase-conditional code.

#### How the Merged Ranker Works

The same logic runs every iteration regardless of EXPANSION/COMPETITION phase:

1. **Triage new entrants** (if any with sigma >= 5.0):
   - Compare sequentially against stratified opponents (top/mid/bottom quartile)
   - After each match: update rating, check if `mu + 2σ < top20Cutoff` → eliminate early
   - Survivors enter the eligible contender pool

2. **Swiss-pair eligible contenders** (if ≥2 exist where `mu + 2σ >= top20Cutoff`):
   - Info-theoretic pairing among contenders only
   - Optional flow comparison, multi-turn tiebreakers (budget-pressure-dependent)
   - Continue until sigma converges for contenders or budget exhausted

The agent doesn't branch on phase. What naturally differs is context:

| | EXPANSION | COMPETITION |
|---|---|---|
| New entrants per iteration | ~3 (generation only) | ~3 (generation + evolution) |
| Pool size | Small (4-15) | Larger (15-50) |
| Top-20% contenders | 1-3 variants | 3-10 variants |
| Swiss pairing rounds | Few (small eligible set) | More (larger eligible set) |
| Other agents running | generation, ranking, proximity | All 13 agents |

EXPANSION naturally produces fewer contenders and smaller Swiss rounds — cost savings happen organically without phase-conditional code.

#### Implementation Details

1. **Create `evolution/src/lib/agents/rankingAgent.ts`**:
   - Compose `PairwiseRanker` internally (like Tournament does)
   - `canExecute()`: `state.pool.length >= 2`
   - `execute()` runs two steps sequentially:
     - **Step 1: Triage** (runs if newEntrants exist with sigma >= CALIBRATED_SIGMA_THRESHOLD):
       - For each new entrant: get stratified opponents via `PoolManager.getCalibrationOpponents()`
       - Run comparisons **one at a time** (bias-mitigated, no flow comparison)
       - Apply rating update immediately after each match
       - After each match, check exit conditions:
         - `mu + 2σ < top20Cutoff` → **STOP: eliminated** (skip remaining opponents)
         - Decisive result (confidence >= 0.7, avg >= 0.8 across matches so far) → **STOP: placed**
       - A clearly weak variant can be eliminated after just 1 comparison instead of running all 5 opponents
     - **Step 2: Fine-ranking** (runs if ≥2 eligible contenders exist):
       - Recompute budget pressure (post-triage state)
       - **Eligible contenders** = variants where `mu + 2σ >= top20Cutoff` (replaces old `mu >= 3*sigma OR in topK` filter)
       - `top20Cutoff` = mu of the variant at the 80th percentile of the pool (e.g., pool=25 → 5th-ranked variant's mu)
       - Swiss pairing among eligible contenders only — everything below cutoff stops getting compared
       - Run bias-mitigated comparisons + optional flow comparison (if enabledAgents includes flowCritique)
       - Multi-turn tiebreaker for top-quartile close matches (budget-pressure-dependent)
       - Convergence: sigma-based, only for eligible contenders
   - Unified draw detection at `confidence < 0.3`
   - Build `RankingExecutionDetail` (structure defined in Phase 1) with `detailType: 'ranking'`
   - **Structured comparison**: Use `useStructuredComparison` config field (replaces old `calibration.opponents > 3` heuristic from tournament.ts:219)
   - **BudgetExceededError handling**: Triage runs comparisons sequentially → BudgetExceededError propagates directly (no Promise.allSettled wrapper needed). Fine-ranking runs comparisons in parallel via Promise.allSettled → re-throw via `rethrowBudgetErrors()` pattern (same as current Tournament)
   - **Phase**: Agent does NOT branch on EXPANSION/COMPETITION. Phase is available in ExecutionContext for logging only — all behavior driven by pool state (newEntrants, sigma levels, contender count)

2. **Keep `swissPairing()` inline** in rankingAgent.ts (only one consumer; no need for separate file)

3. **Unit tests for RankingAgent** (use existing calibrationRanker.test.ts and tournament.test.ts as templates for mock setup):
   - **Triage sequential elimination**: Verify check after EACH match (not batched) — variant eliminated after 1 loss if mu + 2σ < cutoff
   - **Top-20% cutoff calculation**: Verify cutoff = 80th-percentile mu for various pool distributions (uniform, skewed, boundary ties)
   - **Triage early exit**: Decisive batch (confidence >= 0.7, avg >= 0.8) stops remaining opponents
   - **Triage → fine-ranking flow**: Survivors of triage enter Swiss pairing in same execute() call
   - **Fine-ranking**: Swiss pairing, convergence, budget pressure tiers, multi-turn tiebreaker
   - **Edge cases**: pool < 2 (canExecute returns false), pool = 2 (stale exit), budget exhaustion mid-triage, budget exhaustion mid-fine-ranking, all new entrants eliminated (no contenders → fine-ranking skipped with exitReason 'no_contenders'), single new entrant only
   - **Swiss in EXPANSION**: Verify Swiss pairing runs even during EXPANSION when ≥2 contenders exist (behavioral change from current system)

**Files**: `rankingAgent.ts` (new), `rankingAgent.test.ts` (new)

#### Test Migration from Old Agents
The following test scenarios from existing suites MUST be ported to rankingAgent.test.ts:
- **From tournament.test.ts (47 tests)**: Swiss pairing algorithm, eligibility filtering, budget pressure tiers (low/medium/high), convergence detection (sigma-based, 2 consecutive rounds), multi-turn tiebreaker thresholds, stale round exit, flow comparison integration, completedPairs freshness across rounds, time limit handling, matchHistory/matchCounts updates
- **From calibrationRanker.test.ts (15 tests)**: Model passthrough, bias mitigation reversal, early exit on decisive matches, BudgetExceededError re-throw, arena-calibrated entry skip (sigma < 5.0), low-sigma entries as opponents, multiple entrants per iteration, cache hit tracking
- Tests that are purely about old dispatch mechanics (phase-conditional routing) can be deleted
- **Total: 62 existing tests** to triage (port, adapt, or delete)

#### Test Impact Analysis — Backend Test Files Referencing Old Agent Names
24 test files reference 'calibration' or 'tournament'. Disposition for each:

**Must update (substantive changes):**
- `pipeline.test.ts` — Agent dispatch assertions, phase-based routing, agent creation
- `budgetRedistribution.test.ts` — REQUIRED_AGENTS, AGENT_DEPENDENCIES assertions
- `costEstimator.test.ts` — Per-agent cost estimation, AgentModels entries
- `configValidation.test.ts` — Config validation for calibration/tournament sections
- `agentToggle.test.ts` — Agent enable/disable logic
- `pipelineUtilities.test.ts` — Execution detail truncation rules

**Likely update (string literal references):**
- `costTracker.test.ts` — Agent name in cost tracking assertions
- `metricsWriter.test.ts` — Agent name in metrics aggregation
- `strategyConfig.test.ts` — Strategy hashing with agent names
- `config.test.ts` — Default config structure assertions
- `arena.test.ts` — Arena integration with ranking agents
- `logger.test.ts` — Agent name in log assertions

**Must update (integration tests with agent name assertions):**
- `evolution-pipeline.integration.test.ts` — Agent dispatch assertions, expects 'calibration'/'tournament' names
- `evolution-cost-attribution.integration.test.ts` — Asserts calibration/tournament cost buckets
- `evolution-cost-estimation.integration.test.ts` — Per-agent cost estimation assertions
- `evolution-actions.integration.test.ts` — Service layer integration with agent names
- `evolution-visualization.integration.test.ts` — Visualization data with agent names
- `evolution-outline.integration.test.ts` — Pipeline completion checks
- `experiment-metrics.integration.test.ts` — Experiment metrics referencing agent names
- `run-evolution-local.test.ts` — Local pipeline run assertions

**Review but likely no change (incidental references):**
- `pairwiseRanker.test.ts` — PairwiseRanker is unchanged; references may be in test descriptions only
- `llmClient.test.ts` — Agent name in call_source; may just be test data
- `beamSearch.test.ts`, `evaluator.test.ts` — TreeSearch isolated; references may be in fixtures
- `experimentActions.test.ts`, `evolutionActions.test.ts`, `evolutionVisualizationActions.test.ts` — Service layer; may reference agent names in UI/API test data
- `experimentMetrics.test.ts`, `eloBudgetActions.test.ts`, `costAnalyticsActions.test.ts` — Analytics; may need alias-aware queries

**UI test files (Phase 5):**
- `AgentExecutionDetailView.test.tsx`, `TimelineTab.test.tsx`, `StrategyConfigDisplay.test.tsx`, `CostAccuracyPanel.test.tsx`, `BudgetTab.test.tsx`, `MetricsTab.test.tsx`, `LogsTab.test.tsx`

**Total: ~30 test files** referencing old agent names (22 unit + 8 integration)

### Phase 3: Pipeline Integration
**Goal**: Wire the new agent into the pipeline, replacing the phase-based dispatch.

1. **pipeline.ts**:
   - `PipelineAgents` interface: Replace `calibration` + `tournament` fields with single `ranking` field
   - Dispatch logic (lines 474-476): Replace phase-conditional `phase === 'COMPETITION' ? tournament : calibration` with `agents.ranking` directly
   - Agent handles triage vs fine-ranking internally based on pool state (newEntrants, sigma levels), not pipeline phase

2. **supervisor.ts**:
   - `ExecutableAgent`: Remove `| 'ranking'` union — `'ranking'` is now in `AgentName` directly
   - `AGENT_EXECUTION_ORDER`: No change (already uses `'ranking'`)
   - `getActiveAgents()`: No change (already includes `'ranking'` unconditionally)
   - `EXPANSION_ALLOWED`: Verify `'ranking'` remains in the set (currently present as ExecutableAgent; after merge it's an AgentName — works automatically but add a verification step)
   - Phase still passed in `ExecutionContext` (other agents need it); RankingAgent uses it for logging only

3. **index.ts** (`createDefaultAgents()`):
   - Replace `calibration: new CalibrationRanker()` + `tournament: new Tournament()` with `ranking: new RankingAgent()`

4. **budgetRedistribution.ts** (deferred from Phase 1 to avoid build failures):
   - `REQUIRED_AGENTS`: Replace `'calibration'` + `'tournament'` with `'ranking'`
   - `AGENT_DEPENDENCIES`: Change `evolution→tournament` and `metaReview→tournament` to `→ranking`
   - Update budgetRedistribution tests

5. **costEstimator.ts**:
   - Merge calibration + tournament cost estimates into single 'ranking' estimate
   - `AgentModels`: Single 'ranking' entry replacing two separate entries
   - Cost baseline lookup: fallback chain `['ranking', 'calibration', 'tournament']`
   - Consider seeding initial 'ranking' baselines from combined calibration+tournament historical costs

6. **Integration tests**:
   - Triage ratings persist across iterations and flow into fine-ranking
   - Budget pressure recomputation after triage
   - Checkpoint/resume with 'ranking' agent name
   - Cost attribution to 'ranking' agent

**Note on invocation rows**: The `'ranking'` sentinel currently dispatches to EITHER calibration OR tournament per iteration (not both). So old runs already have 1 row per iteration (agent_name='calibration' during EXPANSION, 'tournament' during COMPETITION). New runs will also have 1 row per iteration (agent_name='ranking'). No row-count transition to handle.

**Files**: `pipeline.ts`, `supervisor.ts`, `index.ts`, `budgetRedistribution.ts`, `costEstimator.ts`, `pipeline.test.ts`

### Phase 4: Backward Compatibility & Persistence
**Goal**: Ensure old runs display correctly and cost tracking works across old/new agent names.

1. **metricsWriter.ts**: Query `agent_name IN ('ranking', 'calibration', 'tournament')` for cost aggregation
2. **costEstimator.ts**: Baseline lookup with alias fallback (already in Phase 3)
3. **persistence.ts**: New invocations use `agent_name = 'ranking'`; null-safety for old records in attribution
4. **eloAttribution.ts**: Accept 'ranking' in agent attribution aggregation
5. **pipelineUtilities.ts**: Add truncation rules for RankingExecutionDetail (triage: max 50 entrants; rounds: max 30)

**Files**: `metricsWriter.ts`, `persistence.ts`, `eloAttribution.ts`, `pipelineUtilities.ts`

### Phase 5: UI Updates
**Goal**: Update frontend to display 'ranking' agent and handle old/new detail formats.

1. **AgentExecutionDetailView.tsx**: Add `case 'ranking': return <RankingDetail />`; keep `case 'calibration'` and `case 'tournament'` for old runs
2. **Create RankingDetail.tsx**: Unified view showing triage entrants + fine-ranking rounds
3. **Keep CalibrationDetail.tsx and TournamentDetail.tsx** — these render old run data and are not deleted until Phase 6 (after production validation)
3. **TimelineTab.tsx**: Add 'ranking' color to agent palette (combine calibration green + tournament red → new color)
4. **strategies/page.tsx**: Update `AGENT_LABELS` record
5. **StrategyConfigDisplay.tsx**: Update `AGENT_LABELS` record
6. **CostBreakdownPie.tsx**: Update `AGENT_COLORS` record
7. **CostAccuracyPanel.tsx**: Update per-agent accuracy display
8. **Update 6 test files**: TimelineTab.test.tsx, StrategyConfigDisplay.test.tsx, CostAccuracyPanel.test.tsx, BudgetTab.test.tsx, MetricsTab.test.tsx, LogsTab.test.tsx

**Files**: ~15 UI files listed in R2-2 research findings

### Phase 6: Cleanup & Documentation
**Goal**: Remove old agent files, update docs. **Execute only after merged agent is validated in production for at least one release cycle.**

1. **Delete** `calibrationRanker.ts` and `calibrationRanker.test.ts`
2. **Delete** `tournament.ts` and `tournament.test.ts`
3. **Delete** `CalibrationDetail.tsx` and `TournamentDetail.tsx` (old run data handled by fallback in AgentExecutionDetailView)
4. **Remove** `'calibration'` and `'tournament'` from `AgentName` union (verify no remaining references via tsc)
5. **Clean up** `AgentModels` in costEstimator.ts — remove old calibration/tournament entries
6. **Update docs** (see Documentation Updates section)
7. **Final verification**: lint, tsc, build, all tests pass

**Files**: Deletions + doc updates

## Testing

### Unit Tests (Phase 2)
See Phase 2 "Unit tests for RankingAgent" and "Test Migration from Old Agents" for full enumeration.

Key new test scenarios (not covered by migrated tests):
- **Sequential triage elimination**: After each single comparison, check `mu + 2σ < top20Cutoff` — verify variant eliminated after 1 match when clearly weak
- **Top-20% cutoff formula**: Unit test `top20Cutoff` computation for pool sizes 3, 5, 10, 25, 50 with various mu distributions
- **Triage → fine-ranking transition**: Single execute() call where 3 new entrants are triaged, 1 eliminated, 2 survivors enter Swiss pairing
- **All entrants eliminated**: 3 new entrants all fail triage → fine-ranking skipped with exitReason 'no_contenders'
- **Swiss pairing in EXPANSION**: Verify fine-ranking runs when ≥2 contenders exist during EXPANSION (behavioral change)
- **No new entrants, existing contenders**: Skip triage, go straight to fine-ranking

### Integration Tests (Phase 3)
- Triage ratings persist across iterations and flow into fine-ranking
- Budget pressure recomputation after triage
- Checkpoint/resume with 'ranking' agent name
- Cost attribution to 'ranking' agent
- Swiss pairing runs in EXPANSION when pool has ≥2 eligible contenders

### Backward Compatibility Tests (Phase 4)
- Old runs with 'calibration'/'tournament' detail types render correctly
- Cost aggregation across old + new agent names (alias-based queries)
- Config with `calibration.*`/`tournament.*` sections still works
- Old execution details (detailType: 'calibration'/'tournament') deserialize without error

### UI Tests (Phase 5)
- RankingDetail component renders both triage entrants and fine-ranking rounds
- Old CalibrationDetail/TournamentDetail still render for historical runs (keep both components)
- Agent colors/labels updated in all views

### Manual Verification
- Run full evolution pipeline end-to-end with merged agent
- Compare LLM call count vs old pipeline (expect ~40-60% reduction for ranking agent specifically)
- Verify old runs in UI still display correctly
- Check cost estimation accuracy with merged agent baselines
- Verify Swiss pairing runs during EXPANSION (new behavior) and produces reasonable rankings

## Rollback Plan

The merge is deployed as code changes only — no DB migration, no data transformation. Rollback options:

1. **Git revert**: Revert the merge commit(s). Old CalibrationRanker and Tournament agent files are restored. Pipeline dispatch reverts to phase-conditional routing. All existing data (agent_invocations with 'calibration'/'tournament' names) remains valid.

2. **Gradual rollback**: If issues are found post-merge, the old agents can be temporarily restored alongside the new one by:
   - Adding back `calibration` and `tournament` to PipelineAgents interface
   - Restoring the phase-conditional dispatch in pipeline.ts
   - No DB changes needed — old and new agent names coexist

3. **Data safety**: New runs write `agent_name = 'ranking'` to invocations. These rows are harmless if we revert — they'll just have an unrecognized agent name that the old UI can handle gracefully (falls through to default case). The alias-based read pattern means forward-compatible queries work in both directions.

Phase 6 (deletion of old agent files) should only proceed after the merged agent has been validated in production for at least one release cycle.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/rating_and_comparison.md` - Major rewrite: remove CalibrationRanker/Tournament split, document single RankingAgent with triage + fine-ranking phases, unified draw detection, top-20% focusing strategy
- `evolution/docs/evolution/architecture.md` - Update: remove EXPANSION/COMPETITION ranking split from phase descriptions, update agent classification diagram, update data flow to show single ranking agent
- `evolution/docs/evolution/arena.md` - Minor update: reference 'ranking' agent instead of calibration/tournament in arena integration section

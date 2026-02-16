# Simplify Evolution Pipeline Research

## Problem Statement
The evolution pipeline has grown in complexity with 12+ agents, a two-phase supervisor, multiple rating systems, and extensive configuration surface area. This project aims to identify opportunities to simplify the pipeline, making it more robust, easier to understand, and easier to debug — without sacrificing the core quality improvement capabilities.

## Requirements (from GH Issue #441)
_To be populated after research identifies specific simplification opportunities._

## High Level Summary

The evolution pipeline spans **56 non-test TypeScript files** (~63 test files separately) with an estimated **~8,500-9,500 source LOC** under `src/lib/evolution/`. It consists of **14 agents** (12 active + 2 library), a **two-phase supervisor** (EXPANSION→COMPETITION), **134 configurable parameters** across 7 configuration systems, and a **three-tier agent gating** mechanism. The system is well-tested (~995 test cases across 52 unit files, 9 integration files, 2 E2E files) and production-resilient (checkpoint/resume, defense-in-depth error handling, FIFO budget reservation).

### Key Metrics

| Metric | Value |
|--------|-------|
| Total source files | 56 non-test TypeScript files |
| Total test files | 63 (52 unit + 9 integration + 2 E2E) |
| Total source LOC | ~8,500-9,500 |
| Active agents | 14 (12 in pipeline + 2 library) |
| Orchestration overhead | ~1,990 LOC (pipeline.ts + supervisor.ts + state.ts + index.ts) |
| pipeline.ts alone | 1,363 LOC |
| types.ts | 679 LOC, 45 exported types |
| Config parameters | 134 total across 7 systems |
| Feature flags | 10 DB-backed flags |
| Budget caps | 12 per-agent percentages (sum: 135%) |
| Test cases | ~995 (`it()` blocks) |
| UI components | 39 files in `src/components/evolution/` |
| Server actions | 41 total across 5 action files (3,551 LOC) |
| Admin pages | 4 evolution-specific routes |
| Scripts | 4 evolution-specific CLI scripts |

---

## Detailed Findings

### 1. Pipeline Orchestration (1,800 LOC)

**Files**: `core/pipeline.ts` (1,363), `core/supervisor.ts` (294), `core/state.ts` (139), `index.ts` (194)

#### Three Pipeline Modes
- **`executeFullPipeline`** — Production path with PoolSupervisor for EXPANSION→COMPETITION phase transitions, checkpoint after each agent, stopping conditions. Used by cron runner, batch runner, admin trigger.
- **`executeFullPipeline` (single-article)** — Same entry point with `config.singleArticle: true`. Skips EXPANSION, disables generation/evolution agents. Stops on quality threshold (all critique dims >= 8).
- **`executeMinimalPipeline`** — Simplified single-pass mode with no phase transitions. Caller provides agent list. Used for testing.

#### Agent Execution Order (per iteration in COMPETITION, 7 groups)
1. **Group 1**: Generation (1-3 variants)
2. **Group 2**: OutlineGeneration (if enabled) + Reflection (quality critique)
3. **Group 3**: Flow Critique (standalone function, flag-gated, separate step)
4. **Group 4**: IterativeEditing / TreeSearch (mutex) + SectionDecomposition + Debate + Evolution (mutation/crossover)
5. **Group 5**: Calibration or Tournament (ranking)
6. **Group 6**: Proximity (diversity)
7. **Group 7**: MetaReview (analysis, $0 cost)

#### Phase Transition Logic
- **EXPANSION→COMPETITION** triggers when: `iteration >= expansionMaxIterations` (hard cutoff) OR `(poolSize >= expansionMinPool AND diversity >= expansionDiversityThreshold)` (early transition). Thresholds are config-driven, not hardcoded.
- Transition is one-way (locked once triggered)
- On transition: ordinal/diversity history reset, strategy rotation starts

#### Factory Functions
- `createDefaultAgents()` — constructs all 12 agents (single source of truth)
- `preparePipelineRun()` — consolidates ~15 lines of boilerplate into a ready-to-run bundle
- `finalizePipelineRun()` — shared post-completion: summary, variants, metrics, strategy config, Hall of Fame feed, log flush

#### runAgent() Wrapper
- Checks `canExecute()` guard
- Creates OTel span
- Retries once on transient errors (exponential backoff: 1s, 2s)
- No state rollback on retry (append-only pool is safe)
- Persists checkpoint + agent invocation record
- BudgetExceededError → pause run
- LLMRefusalError → permanent failure, never retried (ERR-6 pattern)

### 2. Agent Inventory (14 agents, ~4,013 LOC implementation)

| Agent | File | LOC | Phase | Required | Budget | Feature Flag |
|-------|------|-----|-------|----------|--------|-------------|
| GenerationAgent | `generationAgent.ts` | 159 | Both | Yes | 20% | — |
| OutlineGenerationAgent | `outlineGenerationAgent.ts` | 323 | COMP | No | 10% | `outline_generation_enabled` (off) |
| CalibrationRanker | `calibrationRanker.ts` | 269 | Both | Yes | 15% | — |
| Tournament | `tournament.ts` | 443 | COMP | Yes | 20% | `tournament_enabled` |
| EvolutionAgent | `evolvePool.ts` | 417 | COMP | No | 10% | `evolve_pool_enabled` |
| ReflectionAgent | `reflectionAgent.ts` | 230 | COMP | No | 5% | — |
| IterativeEditingAgent | `iterativeEditingAgent.ts` | 442 | COMP | No | 5% | `iterative_editing_enabled` |
| TreeSearchAgent | `treeSearchAgent.ts` | 180 | COMP | No | 10% | `tree_search_enabled` (off) |
| SectionDecompositionAgent | `sectionDecompositionAgent.ts` | 221 | COMP | No | 10% | `section_decomposition_enabled` |
| DebateAgent | `debateAgent.ts` | 407 | COMP | No | 5% | `debate_enabled` |
| ProximityAgent | `proximityAgent.ts` | 175 | Both | Yes | 0% | — |
| MetaReviewAgent | `metaReviewAgent.ts` | 256 | COMP | No | 0% | — |
| PairwiseRanker | `pairwiseRanker.ts` | 361 | Library | No | 20% | — |
| FlowCritique | (standalone fn) | 347 | COMP | No | 5% | `flow_critique_enabled` (off) |
| formatValidator | `formatValidator.ts` | 105 | Both | Yes | — | — |

#### Support Sub-modules
- **Tree-of-Thought** (`treeOfThought/`): 6 source files, ~970 LOC — beam search algorithm, revision actions, evaluator
- **Section** (`section/`): 5 source files, ~392 LOC — section parser, edit runner, stitcher, format validator
- **Flow Rubric** (`flowRubric.ts`): 347 LOC — quality + flow dimensions, prompt builders, cross-scale normalization
- **Experiment** (`experiment/`): 2 source files, ~468 LOC — L8 factorial design, analysis

#### Shared Patterns Across Agents
1. **Promise.allSettled** for parallel LLM calls (Generation, Evolution, Reflection, Calibration, Tournament)
2. **Format validation** calls before pool addition (6 agents)
3. **Pool addition** — UUID + TextVariation construction repeated in 8 agents
4. **BudgetExceededError re-throw** after processing fulfilled results
5. **canExecute() guards** — pool size, ratings existence, critique availability

#### Code Duplication Observed
- Critique prompt building: ReflectionAgent vs flowRubric.ts `buildQualityCritiquePrompt()`
- Format validation: `formatValidator.ts` (full article) vs `sectionFormatValidator.ts` (per-section) — duplicated rule logic
- TextVariation construction: repeated in 8 agents, could be a factory

### 3. Configuration Surface Area (134 Parameters)

| Category | Count |
|----------|-------|
| Run Config (top-level + nested) | 30 |
| Feature Flags (DB) | 10 |
| Budget Caps (per-agent) | 12 |
| Agent Selection (optional agents) | 11 |
| Tournament Config (internal) | 14 |
| Iterative Editing Config | 3 |
| Tree Search Config | 3 |
| Rating Constants | 4 |
| Environment Variables | 2 |
| Strategy Hash Fields | 7 |
| Supervisor Derived | 9 |
| Other Internal Constants | 29 |

#### Three-Tier Agent Gating
Every agent must pass all three tiers to execute:
1. **PhaseConfig** (supervisor) — per-phase `run*` booleans
2. **Feature Flags** (DB `feature_flags` table) — global on/off per agent
3. **enabledAgents** (strategy config) — per-strategy agent subset

#### Notable Complexity
- Budget caps intentionally sum to 135% (not all agents run every iteration)
- Auto-clamping in `resolveConfig()` silently adjusts `expansion.maxIterations` for short runs
- Mutual exclusivity enforced in two places: `featureFlags.ts` and `budgetRedistribution.ts`
- Agent model fallback chain: `agentModels[agent] ?? (isJudge ? judgeModel : generationModel)`

### 4. Type System and Data Flow

**types.ts**: 679 LOC, 47+ exported types/interfaces

Key interfaces:
- `PipelineState` — 17 data fields across 6 "phase groups" (pool, ranking, review, proximity, meta, debate) + 3 optional subsystem fields + 4 methods
- `TextVariation` — base variant type with `OutlineVariant` extension
- `ExecutionContext` — dependency injection container (payload, state, llmClient, logger, costTracker, comparisonCache, featureFlags)
- `AgentExecutionDetail` — discriminated union with 12 agent-specific detail types
- `EvolutionRunSummary` — V2 schema (ordinal-based) with V1 backward compat (Elo-based)
- `CostTracker` — budget enforcement interface

#### Core Utilities (21 files in `core/`)
- `costTracker.ts` (81 LOC) — FIFO reservation queue, 30% safety margin
- `llmClient.ts` (110 LOC) — LLM wrapper with budget enforcement
- `comparisonCache.ts` (56 LOC) — order-invariant SHA-256 cache
- `pool.ts` (146 LOC) — stratified opponent selection (ordinal quartiles)
- `diversityTracker.ts` (110 LOC) — HEALTHY/LOW/CRITICAL/COLLAPSED thresholds
- `rating.ts` (80 LOC) — OpenSkill wrapper (ordinal = mu - 3σ, convergence when σ < 3.0)
- `jsonParser.ts` (54 LOC) — extract JSON from LLM responses
- `validation.ts` (90 LOC) — state contract guards per phase
- `logger.ts` (134 LOC) — structured logging + DB buffer (batch size 20)
- `errorClassification.ts` (43 LOC) — transient error detection
- `seedArticle.ts` (60 LOC) — generate seed article from prompt
- `featureFlags.ts` (95 LOC) — DB-backed feature flag loading
- `budgetRedistribution.ts` (162 LOC) — per-agent budget redistribution when agents disabled
- `agentToggle.ts` (42 LOC) — REQUIRED/OPTIONAL agent lists, dependencies, mutex
- `strategyConfig.ts` (205 LOC) — strategy fingerprinting, hash, get-or-create
- `configValidation.ts` (146 LOC) — validates budgetCaps, enabledAgents, models (added by PR #442)
- `adaptiveAllocation.ts` (234 LOC) — adaptive budget allocation strategy (added by PR #443)
- `costEstimator.ts` (391 LOC) — LLM cost estimation utility (added by PR #443)
- `pipeline.ts`, `supervisor.ts`, `state.ts` (see orchestration section above)

#### Comparison Modules
- `comparison.ts` (129 LOC) — 2-pass A/B reversal with confidence scoring
- `diffComparison.ts` (129 LOC) — CriticMarkup diff with direction reversal (ACCEPT/REJECT/UNSURE)

### 5. Error Handling and Robustness

#### Error Recovery Paths
| Failure | Pipeline Behavior | Recovery |
|---------|------------------|----------|
| Transient LLM error | Agent retried once with backoff | Continues |
| LLM content refusal | Permanent failure (ERR-6), never retried | Queue new run |
| Agent fatal error | Checkpoint saved, run marked `failed` | Queue new run |
| BudgetExceeded | Checkpoint saved, run marked `paused` | Admin increases budget |
| Runner crash | Watchdog marks stale runs `failed` (10 min) | Queue new run |
| All variants rejected | Pool doesn't grow, diversity may collapse | Degenerate stop |

#### Defense-in-Depth
- `markRunFailed()` called at both pipeline level and action level (idempotent via status guard)
- Checkpoint saved before all error handlers (best-effort)
- FIFO budget reservation prevents concurrent over-spending

#### Integration Points Outside `src/lib/evolution/`
- **Server Actions**: 13 in `evolutionActions.ts` (978 LOC) + 11 visualization (1,101 LOC) + 1 batch (84 LOC) + 2 cost analytics (199 LOC) + 14 HoF (1,189 LOC) = 41 total
- **Cron Endpoints**: evolution-runner (272 LOC, 5-min), watchdog (74 LOC, 15-min)
- **Scripts**: 4 evolution-specific CLI scripts (evolution-runner 332 LOC, run-evolution-local 816 LOC, add-to-hall-of-fame 175 LOC, run-hall-of-fame-comparison 279 LOC)
- **UI Components**: 39 files in `src/components/evolution/` (~2,849 LOC)
- **Admin Pages**: 4 evolution-specific routes
- **Test Files**: 63 total (52 unit + 9 integration + 2 E2E), ~995 test cases

---

## Complexity Hotspots

### Highest Complexity Files
1. **`pipeline.ts`** (1,363 LOC) — orchestration, 3 modes, finalization, Hall of Fame feed, flow critique, agent invocation, checkpoint
2. **`types.ts`** (679 LOC) — 45 exported types, 12 discriminated union variants, V1/V2 summary schemas
3. **`tournament.ts`** (443 LOC) — Swiss pairing, budget pressure tiers, multi-turn tiebreakers, flow comparison
4. **`iterativeEditingAgent.ts`** (442 LOC) — multi-cycle edit loop, target selection, inline critique, step-aware editing
5. **`evolvePool.ts`** (417 LOC) — 3 mutation strategies + creative exploration + outline mutation + stagnation detection
6. **`debateAgent.ts`** (407 LOC) — multi-round debate, synthesis, convergence
7. **`costEstimator.ts`** (391 LOC) — LLM cost estimation (added PR #443)
8. **`flowRubric.ts`** (347 LOC) — 2 dimension systems, 6 prompt builders, cross-scale normalization

### Structural Complexity
- **Three-tier gating**: PhaseConfig + FeatureFlags + enabledAgents — 3 independent mechanisms controlling agent execution
- **Two rating systems**: OpenSkill (within-run) + Elo K-32 (Hall of Fame cross-run)
- **Two comparison methods**: standard A/B reversal + CriticMarkup diff reversal
- **Two format validators**: full article + section-level (duplicated rules)
- **Pipeline.ts multi-responsibility**: orchestration + finalization + Hall of Fame + flow critique + strategy linking + prompt linking + cost prediction

---

## Deep Dive Findings (Phase 2)

### A. pipeline.ts Internal Structure (1,363 LOC)

#### Function Inventory

**Exported Functions (8+):**
- `insertBaselineVariant()` (line 345) — adds original text as `version: 0`, `strategy: 'original_baseline'`
- `buildRunSummary()` (line 361) — top 5 variants, baseline rank, match stats, per-strategy effectiveness, returns `version: 2` summary
- `validateRunSummary()` (line 421) — Zod validation of summary, returns null on failure
- `finalizePipelineRun()` (line 438) — orchestrates 7 post-completion steps (see below)
- `qualityThresholdMet()` (line 705) — checks if all critique dimensions >= threshold for single-article early stopping
- `executeMinimalPipeline()` (line 720) — single-pass agent list, no phases, used for testing
- `executeFullPipeline()` (line 855) — production path with supervisor, phases, stopping conditions
- `runFlowCritiques()` (line 1306) — standalone flow critique execution (not an agent)
- Also exported: `sliceLargeArrays()` (line 1103), `truncateDetail()` (line 1122), `persistAgentInvocation()` (line 1142)

**Private Functions (13+):**
- `persistCheckpoint()` (line 28) — upsert to `evolution_checkpoints`, retry up to 3x with backoff
- `persistVariants()` (line 79) — write all pool variants to `content_evolution_variants`, converts ordinal→Elo for DB
- `markRunFailed()` (line 114) — idempotent status guard (only from pending/claimed/running), truncates error to 500 chars
- `markRunPaused()` (line 127) — BudgetExceeded-specific status update
- `computeFinalElo()` (line 136) — top variant ordinal → Elo scale
- `updateStrategyAggregates()` (line 144) — RPC call to `update_strategy_aggregates`
- `linkStrategyConfig()` (line 168) — get-or-create strategy config by hash, link to run
- `getAgentForStrategy()` (line 248) — maps strategy names to agent names for cost attribution
- `persistCostPrediction()` (line 257) — computes and writes prediction to JSONB column, refreshes cost baselines
- `persistAgentMetrics()` (line 300) — per-agent Elo/dollar metrics to `evolution_run_agent_metrics`
- `autoLinkPrompt()` (line 498) — 3-strategy prompt resolution (config → HoF topic → explanation title)
- `feedHallOfFame()` (line 586) — inserts top 3 variants, creates topic if needed, triggers re-ranking
- `runGatedAgents()` (line 817) — three-tier gate check (PhaseConfig + feature flag + canExecute)
- Also: `findTopicByPrompt()` (line 562), `linkPromptToRun()` (line 575), `runAgent()` (line 1179), `persistCheckpointWithSupervisor()` (line 1259)

**Constants:**
- `STRATEGY_TO_AGENT` (line 234) — maps 11 strategy names to owning agent names

#### finalizePipelineRun() — 7-Step Post-Completion

1. Build + validate run summary → write to `content_evolution_runs.run_summary` JSONB
2. `persistVariants()` — all pool variants to DB
3. `persistAgentMetrics()` — Elo/dollar optimization data
4. `persistCostPrediction()` — actual vs predicted cost analysis
5. `linkStrategyConfig()` — strategy fingerprint linking
6. `autoLinkPrompt()` — prompt resolution
7. `feedHallOfFame()` — top 3 variants → Hall of Fame + auto re-ranking

#### executeFullPipeline() Flow (lines ~855-1096)

1. **Setup** (~869-918): OTel span, DB status update, create PoolSupervisor, inject ComparisonCache, restore from checkpoint if resuming
2. **Iteration loop** (~920-1051):
   - `state.startNewIteration()` → increment counter
   - `supervisor.beginIteration()` → detect phase, lock to COMPETITION if transitioning
   - Quality threshold check (single-article only, all dims >= 8)
   - `supervisor.shouldStop()` → budget/iterations/plateau checks
   - Agent execution via `runGatedAgents()` in 7 groups:
     - Group 1: Generation
     - Group 2: Pre-edit (outline, reflection)
     - Group 3: Flow critique (standalone, flag-gated — separate from pre-edit)
     - Group 4: Editing + evolution (iterativeEditing, treeSearch, sectionDecomposition, debate, evolution)
     - Group 5: Ranking (calibration OR tournament)
     - Group 6: Proximity
     - Group 7: MetaReview
   - Checkpoint after each iteration
3. **Completion** (~1053-1083): status update, finalizePipelineRun(), return stopReason + supervisorState

#### runAgent() Wrapper (lines ~1179-1258)

1. `canExecute()` guard → return null if false
2. Retry loop (maxRetries + 1 attempts)
3. OTel span with agent/iteration/phase/attempt attributes
4. `agent.execute(ctx)` call
5. Success: persist invocation + checkpoint
6. BudgetExceededError: checkpoint + pause + throw
7. LLMRefusalError: checkpoint + markRunFailed + throw (permanent, never retried — ERR-6 pattern)
8. Transient error + retries left: exponential backoff (1000ms × 2^attempt), no state rollback
9. Fatal/exhausted: checkpoint + markRunFailed + throw

**Retry amplification:** SDK retries 3x internally → `runAgent()` retries 1x → up to 8 total LLM attempts

### B. Supervisor Phase Logic (295 LOC)

#### PoolSupervisor Private State
- `_phaseLocked: PipelinePhase | null` — one-way lock, never transitions back
- `_currentPhase: PipelinePhase` — starts EXPANSION
- `_strategyRotationIndex` — cycles through 3 generation strategies in COMPETITION
- `ordinalHistory[]` / `diversityHistory[]` — for plateau detection

#### Phase Detection (`detectPhase`, line 111)
- `iteration >= expansionMaxIterations` → COMPETITION (hard cutoff)
- OR `poolSize >= expansionMinPool AND diversity >= expansionDiversityThreshold` → COMPETITION (early transition)

#### EXPANSION vs COMPETITION PhaseConfig Differences

| Aspect | EXPANSION | COMPETITION |
|--------|-----------|-------------|
| Generation | ✓ (if enabled) | ✓ (unless singleArticle) |
| All editing agents | ✗ | ✓ (if enabled) |
| Evolution | ✗ | ✓ (unless singleArticle) |
| Calibration opponents | 3 | — |
| Tournament | ✗ | ✓ |
| Strategy rotation | first strategy only (low diversity) or all 3 | round-robin |

#### Stopping Conditions (5 logical, 3 in supervisor.shouldStop())
`supervisor.shouldStop()` checks 3 conditions:
1. **Plateau** (COMPETITION only): `ordinalHistory` improvement < `plateauThreshold * 6` over last `plateauWindow` iterations (degenerate state — plateau AND diversity < 0.01 — is a sub-case)
2. **Budget exhausted**: `availableBudget < minBudget` ($0.01)
3. **Max iterations**: hard cap reached

Two additional conditions are checked in `executeFullPipeline()` before `shouldStop()`:
4. **Quality threshold** (single-article only): all critique dims >= 8 — checked inline in pipeline.ts, not yet moved to supervisor
5. **Degenerate state**: plateau AND diversity < 0.01 — combined with plateau check

### C. Agent Gating — Three Tiers in Detail

#### Tier 1: PhaseConfig (supervisor.ts)
- `isEnabled(name)` checks: `enabledAgents undefined → true`, `REQUIRED_AGENTS → true`, else `enabledAgents.includes(name)`
- EXPANSION disables all editing/evolution agents
- COMPETITION enables all (subject to other tiers)

#### Tier 2: Feature Flags (featureFlags.ts)
10 flags loaded from `feature_flags` DB table with safe defaults on error:
- **On by default**: tournament, evolvePool, debate, iterativeEditing, sectionDecomposition, promptBasedEvolution
- **Off by default**: outlineGeneration, treeSearch, flowCritique
- **Mutual exclusivity**: `treeSearchEnabled → iterativeEditingEnabled = false`

#### Tier 3: Strategy enabledAgents (agentToggle.ts + budgetRedistribution.ts)
- REQUIRED (always run): generation, calibration, tournament, proximity
- OPTIONAL (user-toggleable): reflection, iterativeEditing, treeSearch, sectionDecomposition, debate, evolution, outlineGeneration, metaReview
- Dependencies: iterativeEditing/treeSearch/sectionDecomposition require reflection; evolution/metaReview require tournament
- Mutex: treeSearch ↔ iterativeEditing
- Budget redistribution: disabled agents' caps removed, remaining agents scaled up proportionally

#### canExecute() Guards Per Agent

| Agent | Guard Conditions |
|-------|-----------------|
| GenerationAgent | `originalText.length > 0` |
| CalibrationRanker | `newEntrantsThisIteration.length > 0 AND pool.length >= 2` |
| Tournament | `pool.length >= 2` |
| ProximityAgent | `pool.length >= 2` |
| ReflectionAgent | `pool.length >= 1` |
| IterativeEditingAgent | has critiques + ratings + top variant has critique |
| TreeSearchAgent | has critiques + ratings + top variant has critique |
| SectionDecompositionAgent | has critiques + ratings + top has critique + >= 2 H2 sections |
| DebateAgent | `countRatedNonBaseline(state) >= 2` |
| EvolutionAgent | `pool.length >= 1 AND ratings.size >= 1` |
| OutlineGenerationAgent | `originalText.length > 0` |
| MetaReviewAgent | `pool.length >= 1 AND ratings.size >= 1` |

### D. Rating and Comparison Systems

#### OpenSkill (Within-Run)
- **Library**: openskill (Weng-Lin Bayesian)
- **Init**: mu=25, sigma=25/3≈8.333
- **Update**: `updateRating(winner, loser)` for decisive, `updateDraw(a, b)` for ties
- **Ordinal**: `mu - 3σ` (fresh rating ≈ 0, conservative estimate)
- **Convergence**: `sigma < 3.0` — tournament checks for early exit
- **Storage**: `PipelineState.ratings: Map<string, {mu, sigma}>`

#### Elo K-32 (Cross-Run, Hall of Fame)
- **Location**: `src/lib/services/hallOfFameActions.ts`
- **Init**: 1200
- **Update**: `K * (actual - expected)`, expected from logistic curve
- **Score mapping**: winner gets `0.5 + 0.5*confidence`, loser `0.5 - 0.5*confidence`
- **Swiss rounds**: sort by Elo, pair adjacent, skip already-compared
- **Independent from OpenSkill** — different scopes, no direct conversion

#### Standard Comparison (comparison.ts, 116 LOC)
- 2-pass position reversal: run A vs B, then B vs A
- Confidence: both agree → 1.0, one TIE → 0.7, disagree → 0.5 (TIE), both null → 0.3
- Cache via ComparisonCache (order-invariant SHA-256 key)

#### Diff Comparison (diffComparison.ts, 127 LOC)
- CriticMarkup format: `{--del--}`, `{++ins++}`, `{~~old~>new~~}`
- 2-pass direction reversal: judge forward diff, judge reverse diff
- Verdicts: ACCEPT (both agree edits help) / REJECT (both agree edits harm) / UNSURE (conflicting)
- **No caching** — each edit evaluation is unique
- Used by: IterativeEditingAgent, SectionEditRunner, BeamSearch

#### Flow Rubric (flowRubric.ts, 336 LOC)
- **Quality dimensions** (1-10 scale): clarity, engagement, precision, voice_fidelity, conciseness
- **Flow dimensions** (0-5 scale): local_cohesion, global_coherence, transition_quality, rhythm_variety, redundancy
- **6 prompt builders**: flow comparison, flow critique, quality critique, plus parsers
- **Cross-scale normalization**: quality `(score-1)/9`, flow `score/5` → both [0,1]
- **Weakness targeting**: `getWeakestDimensionAcrossCritiques()` finds single weakest dimension across both scales

#### Tournament (tournament.ts, 447 LOC)
- Swiss pairing with info-theoretic scoring: `outcomeUncertainty * sigmaWeight`
- Budget pressure tiers: low (<0.5) → 40 max comparisons, medium → 25, high (≥0.8) → 15
- Multi-turn tiebreaker: top-quartile + close match → third-call tiebreaker
- Flow comparison integration: parallel flow comparisons on same pairs, scores prefixed `flow:`
- Convergence: all eligible variants sigma < 3.0 for 5 consecutive rounds
- Exit reasons: maxRounds, budget, stale, convergence

#### Calibration (calibrationRanker.ts, 264 LOC)
- New entrants only vs stratified opponents (ordinal quartiles)
- Adaptive 2-batch: run min opponents first, skip rest if confidence ≥ 0.7
- No multi-turn tiebreakers (unlike tournament)
- Always uses simple A/B comparison (not structured)

#### ComparisonCache (comparisonCache.ts, 43 LOC)
- Order-invariant key: sorted pair → SHA-256 → separate `quality` and `flow` modes
- Only caches valid results (skips errors to allow retry)
- Per-run lifetime (not persisted to DB)

### E. Configuration Deep Dive

#### resolveConfig() Auto-Clamping (config.ts, line 75-91)
- Shallow merge of nested objects (plateau, expansion, generation, calibration, tournament, budgetCaps)
- Auto-clamps `expansion.maxIterations` when `maxIterations` too small: ensures `minCompetitionIters = plateauWindow + 1` iterations remain for COMPETITION phase
- Example: `maxIterations: 5, plateauWindow: 3` → `expansion.maxIterations` clamped to `max(0, 5 - 4) = 1`

#### Budget Flow
1. Agent calls `costTracker.reserveBudget(agentName, estimatedCost)` before each LLM call
2. Reserve adds 30% safety margin: `estimatedCost * 1.3`
3. Checks per-agent cap AND total cap → throws `BudgetExceededError` if exceeded
4. Reservation pushed to FIFO queue per agent
5. After LLM response: `costTracker.recordSpend(agentName, actualCost)` releases exactly one FIFO reservation
6. Budget redistribution: disabled agents' caps removed, remaining scaled proportionally to preserve original 135% sum

#### Strategy Config Fingerprinting
- `extractStrategyConfig()` pulls generationModel, judgeModel, agentModels, iterations, budgetCaps, enabledAgents, singleArticle
- `hashStrategyConfig()` → normalized JSON → SHA-256 → 12-char hex
- Identical configs produce same hash → same `strategy_configs` row
- Enables tracking Elo/dollar per configuration

### F. Checkpoint System

#### What Gets Checkpointed
Full `PipelineState` serialized to JSONB: pool, ratings (mu/sigma), matchCounts, matchHistory, dimensionScores, allCritiques, similarityMatrix, diversityScore, metaFeedback, debateTranscripts, treeSearchResults, treeSearchStates, sectionState

Plus supervisor resume state: phase, strategyRotationIndex, ordinalHistory, diversityHistory

#### Backward Compatibility
- New format: `ratings: Record<string, {mu, sigma}>`
- Legacy format: `eloRatings: Record<string, number>`
- `deserializeState()` checks for `ratings` first, falls back to `eloToRating()` conversion

#### Checkpoint Persistence
- `persistCheckpoint()` upserts with conflict on `(run_id, iteration, last_agent)`
- Retries up to 3x with exponential backoff
- Also updates `content_evolution_runs` with heartbeat, iteration, pool size, cost

### G. Integration Points

#### Server Actions (13 in evolutionActions.ts)
1. `estimateRunCostAction` — cost estimation from strategy
2. `queueEvolutionRunAction` — queue new run
3. `getEvolutionRunsAction` — list with filters
4. `getEvolutionRunByIdAction` — lightweight polling
5. `getEvolutionVariantsAction` — variants (DB or checkpoint fallback)
6. `applyWinnerAction` — apply winning variant to explanation
7. `triggerEvolutionRunAction` — admin manual trigger
8. `getEvolutionRunSummaryAction` — V1/V2 backward compat
9. `getEvolutionCostBreakdownAction` — cost by agent
10. `getEvolutionHistoryAction` — content history for explanation
11. `rollbackEvolutionAction` — rollback to previous content
12. `killEvolutionRunAction` — terminate a running evolution
13. `getEvolutionRunLogsAction` — run logs with filters

Plus: 11 visualization actions, 1 batch action

#### Cron Jobs
- **evolution-runner** (5-min): FIFO claim oldest pending → feature flag check → content resolution → executeFullPipeline → 30s heartbeat
- **evolution-watchdog** (15-min): find runs with heartbeat > 10 min → mark as failed

#### UI Components (39 files in `src/components/evolution/`, ~2,849 LOC)
- Core: AutoRefreshProvider, EloSparkline, EvolutionStatusBadge, LineageGraph, PhaseIndicator, StepScoreBar, VariantCard
- 7 tabs: Elo, Lineage, Logs, Tree, Variants, Timeline, Budget
- 12 agent detail views (one per agent type + shared utilities + router)

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/README.md
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/cost_optimization.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/visualization.md
- docs/evolution/hall_of_fame.md
- docs/evolution/strategy_experiments.md
- docs/evolution/reference.md
- docs/evolution/agents/overview.md
- docs/evolution/agents/generation.md
- docs/evolution/agents/editing.md
- docs/evolution/agents/flow_critique.md
- docs/evolution/agents/support.md
- docs/evolution/agents/tree_search.md

## Code Files Read

### Core Pipeline
- `src/lib/evolution/core/pipeline.ts` (1,363 LOC)
- `src/lib/evolution/core/supervisor.ts` (294 LOC)
- `src/lib/evolution/core/state.ts` (139 LOC)
- `src/lib/evolution/index.ts` (185 LOC)

### Configuration & Types
- `src/lib/evolution/config.ts` (99 LOC)
- `src/lib/evolution/types.ts` (679 LOC)
- `src/lib/evolution/core/featureFlags.ts`
- `src/lib/evolution/core/budgetRedistribution.ts`
- `src/lib/evolution/core/agentToggle.ts`
- `src/lib/evolution/core/strategyConfig.ts`

### Core Utilities
- `src/lib/evolution/core/costTracker.ts` (93 LOC)
- `src/lib/evolution/core/llmClient.ts` (111 LOC)
- `src/lib/evolution/core/comparisonCache.ts` (43 LOC)
- `src/lib/evolution/core/pool.ts` (135 LOC)
- `src/lib/evolution/core/diversityTracker.ts` (111 LOC)
- `src/lib/evolution/core/rating.ts` (81 LOC)
- `src/lib/evolution/core/jsonParser.ts` (18 LOC)
- `src/lib/evolution/core/validation.ts` (91 LOC)
- `src/lib/evolution/core/logger.ts` (135 LOC)
- `src/lib/evolution/core/errorClassification.ts` (44 LOC)
- `src/lib/evolution/core/seedArticle.ts` (61 LOC)

### Agents (all 14)
- `src/lib/evolution/agents/base.ts` (17 LOC)
- `src/lib/evolution/agents/generationAgent.ts` (159 LOC)
- `src/lib/evolution/agents/outlineGenerationAgent.ts` (325 LOC)
- `src/lib/evolution/agents/calibrationRanker.ts` (264 LOC)
- `src/lib/evolution/agents/tournament.ts` (447 LOC)
- `src/lib/evolution/agents/evolvePool.ts` (416 LOC)
- `src/lib/evolution/agents/reflectionAgent.ts` (232 LOC)
- `src/lib/evolution/agents/iterativeEditingAgent.ts` (438 LOC)
- `src/lib/evolution/agents/treeSearchAgent.ts` (180 LOC)
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` (204 LOC)
- `src/lib/evolution/agents/debateAgent.ts` (363 LOC)
- `src/lib/evolution/agents/proximityAgent.ts` (163 LOC)
- `src/lib/evolution/agents/metaReviewAgent.ts` (257 LOC)
- `src/lib/evolution/agents/pairwiseRanker.ts` (384 LOC)
- `src/lib/evolution/agents/formatValidator.ts` (93 LOC)
- `src/lib/evolution/agents/formatRules.ts`

### Comparison & Quality
- `src/lib/evolution/comparison.ts` (116 LOC)
- `src/lib/evolution/diffComparison.ts` (127 LOC)
- `src/lib/evolution/flowRubric.ts` (336 LOC)

### Sub-modules
- `src/lib/evolution/treeOfThought/` (10 files, 2,155 LOC)
- `src/lib/evolution/section/` (9 files, 934 LOC)
- `src/lib/evolution/experiment/` (4 files)

### Integration Points
- `src/lib/services/evolutionActions.ts`
- `src/lib/services/evolutionVisualizationActions.ts`
- `src/lib/services/evolutionBatchActions.ts`
- `src/app/api/cron/evolution-runner/route.ts`
- `src/app/api/cron/evolution-watchdog/route.ts`
- `scripts/evolution-runner.ts`
- `scripts/run-evolution-local.ts`

---

## Deep-Dive Research: Simplification Opportunities

_Research conducted via 4 parallel agents analyzing: (A) agent consolidation, (B) configuration simplification, (C) pipeline orchestration decomposition, (D) type system & code deduplication._

### A. Agent Consolidation & Dead Code

#### A.1 ~~Dead Code~~: PairwiseRanker (361 LOC) — **CORRECTION: NOT dead code**

**Status: KEEP — actively used by Tournament internally.**

- ~~Exported from `index.ts` (L74) but never created in `createDefaultAgents()`~~
- **CORRECTION**: PairwiseRanker IS instantiated inside Tournament: `private readonly pairwise = new PairwiseRanker()` (tournament.ts:131). It provides `compareWithBiasMitigation()` and `comparePair()` used by Tournament only. CalibrationRanker has its own independent `compareWithBiasMitigation()` method that delegates to the standalone `comparison.ts` module.
- Not a pipeline-level agent (not in `createDefaultAgents()`), but IS a library/composition helper.
- **Do NOT delete.**

#### A.2 Feature-Flagged-OFF Agents (Experimental)

| Agent | LOC | Default | Cost/Run | Recommendation |
|-------|-----|---------|----------|----------------|
| OutlineGenerationAgent | 323 | OFF | ~$0.05/variant (6 LLM calls) | Keep experimental; consider consolidating into GenerationAgent as strategy |
| TreeSearchAgent | 180 + 970 (treeOfThought/) | OFF | ~$0.50-1.00 (K×B×D calls) | Keep experimental; needs A/B test vs IterativeEditing |
| FlowCritique | 347 (standalone fn) | OFF | ~$0.01/variant | Keep as-is; good separation from quality critique |

**Key question**: Neither TreeSearch nor IterativeEditing has elo_per_dollar comparison data. Need to query `evolution_run_agent_metrics` to determine which delivers better ROI.

#### A.3 Agent Overlap: Ranking (Calibration vs Tournament)

- `CalibrationRanker` (269 LOC): New entrants vs stratified opponents, adaptive 2-batch
- `Tournament` (443 LOC): Swiss pairing, budget pressure tiers, convergence tracking
- Both implement independent `compareWithBiasMitigation()` (CalibrationRanker delegates to standalone comparison.ts; Tournament delegates to PairwiseRanker). Both share rating update logic and flow comparison patterns.
- **Consolidation opportunity**: CalibrationRanker could become a thin wrapper around Tournament with adaptive budget scaling. Saves ~100 LOC duplication.

#### A.4 Agent Overlap: Critique (3 implementations)

- `ReflectionAgent.execute()` (L55-120): Critiques top 3 variants in parallel
- `IterativeEditingAgent.runInlineCritique()` (L256-283): Critiques 1 variant sequentially
- `pipeline.ts runFlowCritiques()` (L1146-1184): Critiques all non-flow variants in parallel
- All three use `buildQualityCritiquePrompt()` / `buildFlowCritiquePrompt()` from `flowRubric.ts`
- **Consolidation opportunity**: Extract shared `CritiqueBatch` utility. Saves ~150 LOC.

#### A.5 MetaReviewAgent: Keep (Zero Cost)

- `estimateCost()` always returns 0 — pure analysis, no LLM calls
- Produces `state.metaFeedback` consumed by GenerationAgent, EvolutionAgent, DebateAgent
- Zero cost, non-zero value. **No changes needed.**

#### A.6 Shared Pattern: TextVariation Construction

- 6+ agents manually construct `{id: uuidv4(), text, version, parentIds, strategy, createdAt, iterationBorn}`
- Only variance: `parentIds` ([] vs [id] vs [idA, idB]) and `version` calculation
- **Extract factory**: `createTextVariation(text, strategy, state, parentIds?, version?)` — saves ~80 LOC

---

### B. Configuration Simplification

#### B.1 Three-Tier Gating → Unified Gating

**Current**: Agent must pass 4 checks to execute:
1. PhaseConfig boolean (supervisor, phase-dependent)
2. Feature flag not explicitly false (DB `feature_flags` table)
3. Agent in `enabledAgents` list OR is required (strategy config)
4. Single-article mode check (embedded in PhaseConfig)

**Finding**: Tiers 2 and 3 rarely disagree — feature flags provide global on/off, agent toggle provides per-strategy selection, and PhaseConfig already determines execution via booleans.

**Recommendation**: Collapse to PhaseConfig + `config.enabledAgents` only. Remove DB feature_flags dependency; use env vars for 3 experimental toggles.

#### B.2 Feature Flags: 2 Dead, 5 Redundant

| Flag | Default | Production State | Verdict |
|------|---------|-----------------|---------|
| `promptBasedEvolutionEnabled` | TRUE | **NO USAGE FOUND** | **DEAD CODE — remove** |
| `dryRunOnly` | FALSE | **NO USAGE FOUND** | **DEAD CODE — remove** |
| `tournamentEnabled` | TRUE | Always ON, never overridden | Redundant — hardcode |
| `evolvePoolEnabled` | TRUE | Always ON | Redundant — hardcode |
| `debateEnabled` | TRUE | Always ON | Redundant — hardcode |
| `iterativeEditingEnabled` | TRUE | Always ON | Redundant — hardcode |
| `sectionDecompositionEnabled` | TRUE | Always ON | Redundant — hardcode |
| `outlineGenerationEnabled` | FALSE | Rarely toggled | → env var |
| `treeSearchEnabled` | FALSE | Rarely toggled | → env var |
| `flowCritiqueEnabled` | FALSE | Rarely toggled | → env var |

**Recommendation**: Delete DB `feature_flags` table dependency. Keep 3 env vars for experimental toggles. All other flags become part of `config.enabledAgents`.

#### B.3 Config Parameters: 134 → ~18 Meaningful

| System | Current Params | Actually Varies | Action |
|--------|---------------|-----------------|--------|
| Run Config (top-level) | 5 | 3 (maxIter, budget, singleArticle) | Keep 3, hardcode `useEmbeddings` (dead), simplify |
| Plateau | 2 | 0 (never overridden) | Hardcode defaults |
| Expansion | 4 | 1 (maxIterations auto-clamped) | Hardcode good defaults, remove auto-clamping |
| Generation | 1 | 1 | Keep |
| Calibration | 2 | 1 (minOpponents unused) | Remove unused |
| Tournament | 1 (topK) | 1 | Flatten to `tournamentTopK: number` |
| Budget Caps | 12 | See B.4 | Simplify to total-only |
| Models | 2 | 2 | Keep |

**Dead parameters**: `useEmbeddings` (never checked at runtime)

#### B.4 Budget System: Per-Agent Caps → Total-Only

**Current complexity**: 12 per-agent caps summing to 135%, FIFO reservation queue per agent, 30% safety margin, dual check (per-agent + total).

**Finding**: Per-agent caps and FIFO queue add ~60 LOC of complexity. Budget redistribution recalculates caps when agents disabled but only matters when 50%+ agents are off (rare).

**Recommendation**: Simplify to total budget only:
- Replace 12-item `budgetCaps` with single `budgetCapUsd: 5.00`
- Remove 30% safety margin (modern models estimate within 5-10%)
- Remove FIFO queue and individual reservation tracking
- Reduces `costTracker.ts` from ~93 to ~40 LOC
- Removes `budgetRedistribution.ts` entirely

#### B.5 Strategy Config Fingerprinting

- SHA-256 hash deduplicates `strategy_configs` rows for analytics
- Estimated 5-20 unique hashes per 1000 runs
- **Keep but simplify**: Only hash `generationModel`, `judgeModel`, `iterations`, `enabledAgents` (remove `agentModels`, `budgetCaps` from hash)

---

### C. Pipeline Orchestration Decomposition

#### C.1 pipeline.ts Function Map (1,337 LOC → Target: ~800 LOC)

**Categorization of 23 functions:**

| Category | Functions | LOC | Extractable? |
|----------|----------|-----|-------------|
| ORCHESTRATION | executeFullPipeline, executeMinimalPipeline, runGatedAgents, runAgent | ~400 | Core — stays |
| FINALIZATION | finalizePipelineRun, buildRunSummary, validateRunSummary | ~120 | Stays (hub) |
| HOF INTEGRATION | feedHallOfFame, findTopicByPrompt, linkPromptToRun, autoLinkPrompt | ~200 | **Extract to hallOfFame module** |
| PERSISTENCE | persistCheckpoint, persistVariants, persistAgentInvocation, persistCheckpointWithSupervisor | ~150 | Extract to persistence module |
| METRICS | persistAgentMetrics, persistCostPrediction, linkStrategyConfig, updateStrategyAggregates, computeFinalElo | ~170 | Extract to metrics module |
| STATUS | markRunFailed, markRunPaused | ~20 | Small — stays |
| UTILITY | qualityThresholdMet, sliceLargeArrays, truncateDetail | ~50 | Move to utilities |

**Key extraction**: feedHallOfFame (131 LOC) is the single largest function and is tightly coupled to finalizePipelineRun. Moving it to a post-pipeline hook would:
- Remove 200 LOC from pipeline.ts (HoF + topic resolution)
- Reduce finalizePipelineRun from ~58 LOC to ~25 LOC
- Decouple HoF errors from pipeline completion

#### C.2 Two-Phase Supervisor: Keep (Value > Complexity)

**EXPANSION** (iterations 0-7): generation + calibration + proximity only. Cheap, builds diverse pool.
**COMPETITION** (after transition): All agents enabled. Expensive, converges on quality.

**What breaks without EXPANSION?** Nothing — but:
- 5-10% higher cost (expensive agents run from iteration 1)
- Risk of premature convergence without diversity buildup
- Plateau detection still works (3-iteration window)

**Recommendation**: Keep supervisor as-is. Add data collection to log which phase transitions fire. Consider simplified single-phase mode as future option.

#### C.3 Two Pipeline Modes: Consolidate

- `executeFullPipeline` (210 LOC) and `executeMinimalPipeline` (74 LOC) share ~14% code
- Minimal is used only for testing/scripts with custom agent lists
- **Could consolidate**: Add `{phases: false, agentFilter: AgentName[]}` option to Full mode
- **Risk**: Medium — requires refactoring phase detection + agent gating

#### C.4 Stopping Conditions: 5 → Keep All, Consolidate Location

| Condition | Phase | Fires Often? | Keep? |
|-----------|-------|-------------|-------|
| Quality threshold | singleArticle only | Rare | Yes — move into supervisor.shouldStop() |
| Quality plateau | COMPETITION | Common | Yes |
| Degenerate state | COMPETITION | Rare | Yes (safety valve) |
| Budget exhausted | Any | Common | Yes |
| Max iterations | Any | Common | Yes |

**Action**: Move `qualityThresholdMet()` into supervisor for unified stopping logic. Saves ~15 LOC in pipeline.ts.

#### C.5 runAgent() Retry: Keep As-Is

- SDK retries 3× internally + pipeline retries entire agent 1×. Total: up to 8 LLM attempts.
- Design is intentional, well-documented (JSDoc at L1150-1157), state-safe (append-only pool).
- **No changes recommended.** Consider making configurable for future tuning.

#### C.6 Hall of Fame Elo vs OpenSkill

- Evolution uses OpenSkill (within-run): ordinal = mu - 3σ
- HoF uses separate Elo K=32 (cross-run): independent system in `hallOfFameActions.ts`
- `ordinalToEloScale()` converts between them at finalization
- **Two rating systems are justified**: Different scopes (within-run vs cross-run). Keep.

---

### D. Type System & Code Deduplication

#### D.1 types.ts (679 LOC, 50+ types): Well-Structured

| Category | Count | Action |
|----------|-------|--------|
| CORE (5+ file usage) | ~15 types | Keep in types.ts |
| AGENT-SPECIFIC (1-2 files) | ~4 types (GenerationStep, OutlineVariant, DebateTranscript, MetaFeedback) | Colocate with agent (EditTarget already colocated in iterativeEditingAgent.ts) |
| EXECUTION DETAIL (12 variants) | 12 types (~175 LOC) | Keep — needed for UI dispatch + type safety |
| LEGACY/COMPAT | V1Schema, eloRatings field | Remove after migration window |

**AgentExecutionDetail discriminated union (12 variants)**: IS necessary for type safety and UI rendering. Each agent detail component pattern-matches on `detailType`. No simplification possible without losing type safety.

#### D.2 Format Validation: ~45 LOC Duplicated

- `agents/formatValidator.ts` (105 LOC): Full article — requires H1, multiple H2+ sections
- `section/sectionFormatValidator.ts` (89 LOC): Per-section — no H1, H2 optional
- **Shared rules**: Bullet detection, numbered list detection, table detection, paragraph sentence-count validation (~50% of sectionFormatValidator)
- **Action**: Extract shared rules to `core/formatValidationRules.ts`

#### D.3 Comparison Module: Shared 2-Pass Reversal

- `comparison.ts` (116 LOC): Standard A/B reversal with confidence scoring
- `diffComparison.ts` (127 LOC): CriticMarkup diff reversal (ACCEPT/REJECT/UNSURE)
- Both use identical 2-pass reversal structure
- **Action**: Extract base reversal pattern to `core/reversalComparison.ts`. Saves ~30 LOC.

#### D.4 Sub-Module Independence

| Module | Source Files | LOC | Used By | Dead if OFF? |
|--------|-------------|-----|---------|-------------|
| `treeOfThought/` | 6 | 970 | Only `treeSearchAgent.ts` | Yes (flag OFF by default) |
| `section/` | 5 | 392 | Only `sectionDecompositionAgent.ts` | No (flag ON) |
| `experiment/` | 2 | 468 | Only `strategyRegistryActions.ts` + tests | Not pipeline code — move out |

**Recommendation**: Move `experiment/` to `/src/lib/experiments/`. Consider lazy-loading `treeOfThought/` when disabled.

#### D.5 PipelineState: Justified Complexity

- 17 data fields + 3 optional subsystem fields + 4 methods across 6 phase groups
- All fields are both written and read (no write-once-never-read patterns detected)
- Optional sub-module state (`treeSearchResults`, `sectionState`) present only when those agents run
- **No changes needed** — state structure is well-organized for its purpose

---

## Consolidated Simplification Roadmap

### Phase 1: Quick Wins (1-2 days, low risk)

| Item | Files | LOC Saved | Risk |
|------|-------|-----------|------|
| ~~Delete PairwiseRanker~~ | ~~REMOVED — not dead code, used by Tournament~~ | ~~0~~ | — |
| Remove never-toggled feature flags (`promptBasedEvolutionEnabled`, `dryRunOnly`) | `core/featureFlags.ts` + 8 call sites | ~50 (conditional branches) | Low |
| Remove `useEmbeddings` parameter (never checked) | `types.ts`, `config.ts` | ~5 | None |
| Extract TextVariation factory | New `core/textVariationFactory.ts`, 6 agents | ~80 (dedup) | Low |
| Extract shared format validation rules | New `core/formatValidationRules.ts`, 2 validators | ~45 (dedup) | Low |
| **Phase 1 Total** | | **~180** | **Low** |

### Phase 2: Module Extraction (3-5 days, medium risk)

| Item | Files | LOC Moved/Saved | Risk |
|------|-------|----------------|------|
| Extract HoF integration from pipeline.ts | `pipeline.ts`, new `hallOfFameIntegration.ts`, 4 callers | ~200 moved out | Medium |
| Extract metrics persistence from pipeline.ts | `pipeline.ts`, new `core/metricsWriter.ts` | ~170 moved out | Low |
| Collapse feature flags → env vars (3 experimental) + enabledAgents | `featureFlags.ts`, `pipeline.ts`, `index.ts` | ~50 removed | Medium |
| Extract CritiqueBatch utility | New `core/critiqueBatch.ts`, 3 call sites | ~150 (dedup) | Medium |
| Move qualityThresholdMet into supervisor | `pipeline.ts`, `supervisor.ts` | ~15 | Low |
| Move experiment/ out of evolution | `experiment/` → `src/lib/experiments/` | ~468 relocated | Low |
| **Phase 2 Total** | | **~1,053 moved/saved** | **Medium** |

### Phase 3: Structural Simplification (1-2 weeks, high risk)

| Item | Files | LOC Saved | Risk |
|------|-------|-----------|------|
| Simplify budget to total-only | `costTracker.ts`, delete `budgetRedistribution.ts` | ~120 | High |
| Consolidate 2 pipeline modes → config-driven | `pipeline.ts` | ~70 | High |
| Collapse 3-tier gating → unified isEnabled() | `supervisor.ts`, `pipeline.ts`, `agentToggle.ts` | ~80 | High |
| Simplify resolveConfig() (better defaults, no auto-clamping) | `config.ts` | ~30 | Medium |
| Replace PhaseConfig booleans with agent registry | `supervisor.ts` | ~80 | Medium |
| **Phase 3 Total** | | **~380** | **High** |

### Overall Impact

| Metric | Before | After (All Phases) | Reduction |
|--------|--------|-------------------|-----------|
| Total source LOC (evolution/) | ~8,500-9,500 | ~7,200-8,200 | ~15% |
| pipeline.ts | 1,363 | ~800 | ~40% |
| Config parameters | 134 | ~18 meaningful | ~87% |
| Feature flags | 10 (DB-backed) | 3 env vars + enabledAgents | ~70% |
| Agent gating tiers | 3 | 1 | ~67% |
| Budget tracking LOC | ~200 | ~40 | ~80% |
| Dead code removed | 0 | ~540 | N/A |

### Data Needed Before Phase 3

1. **Query `evolution_run_agent_metrics`**: Calculate `avg(elo_per_dollar)` per agent over last 90 days to identify bottom performers
2. **Log phase transitions**: How often does EXPANSION→COMPETITION fire in production?
3. **A/B test TreeSearch vs IterativeEditing**: Compare elo_per_dollar to decide which to keep
4. **Audit budget hits**: How often does per-agent budget cap (not total) trigger BudgetExceededError?

---

## Deep-Dive Findings (Phase 3): Integration Layer

_Research conducted via 4 parallel agents analyzing: (H) UI components, (I) database schema, (J) test suite impact, (K) server actions & integration._

### H. UI Component Simplification (39 files, ~2,849 LOC)

#### H.1 Component Inventory

| Category | Files | LOC | Key Components |
|----------|-------|-----|----------------|
| Tabs (7) | 7 | 1,260 | TimelineTab (349), TreeTab (318), LogsTab (262), BudgetTab (247), VariantsTab (182), EloTab (124), LineageTab (52) |
| Agent Details (13) | 14 | 709 | AgentExecutionDetailView (37, router) + 12 agent-specific detail components + shared.tsx (55) |
| Core Components (9) | 9 | 520 | LineageGraph (180), AutoRefreshProvider (136), VariantCard (73), StepScoreBar (65), EloSparkline (47), PhaseIndicator (37), EvolutionStatusBadge (38), ElapsedTime (43) |
| Barrel Export | 1 | 14 | index.ts |

#### H.2 Dead/Removable Components

- **PairwiseRanker**: No UI components depend on it — zero UI impact on deletion
- **OutlineGenerationAgent** (OFF default): OutlineGenerationDetail.tsx (41 LOC) removable if feature killed
- **TreeSearchAgent** (OFF default): TreeSearchDetail.tsx (49 LOC) + TreeTab.tsx (318 LOC) = **367 LOC** removable
- **FlowCritique** (OFF default): No dedicated component; metrics inline in agent rows

#### H.3 Key Finding: Tabs Are Loosely Coupled

Tabs do **NOT** consume PipelineState directly. They fetch via action functions that query DB and reconstruct data. This means:
- Changes to PipelineState structure don't break UI directly (only via action layer)
- Tab components are stable during pipeline refactoring
- **BudgetTab** would simplify ~80 LOC if budget moves to total-only (remove per-agent caps grid)

#### H.4 Feature Flag Admin UI

**CORRECTION**: No evolution-specific feature flag admin UI exists. Feature flags are only checked in runtime code (cron, actions, scripts), not exposed in any admin page. The claimed ~100 LOC admin section does not exist.

#### H.5 AgentExecutionDetail Discriminated Union (12 variants)

- 19 UI components import from `types.ts`
- Union is necessary for type-safe routing in AgentExecutionDetailView
- Removing an agent requires: delete `{Agent}Detail.tsx` + remove from union + remove switch case
- TypeScript exhaustiveness check enforces all 3 steps — no orphaned code possible

#### H.6 UI Deduplication Opportunities

| Pattern | Locations | Savings |
|---------|-----------|---------|
| DimensionScoresDisplay | ReflectionDetail, IterativeEditingDetail, OutlineGenerationDetail | ~15 LOC |
| useExpandedId() hook | TimelineTab, VariantsTab, LogsTab | ~30 LOC |
| ~~Feature flag admin UI removal~~ | ~~Admin settings page~~ | ~~N/A — does not exist~~ |
| BudgetTab per-agent caps grid | BudgetTab | ~80 LOC |

**UI Total Realistic Savings**: 450-750 LOC (16-26% reduction) with low risk.

---

### I. Database Schema & Simplification Impact

#### I.1 Evolution-Specific Migrations: 12 files (was claimed 16 — corrected)

| Date | Migration | Purpose |
|------|-----------|---------|
| 2026-01-31 | `content_evolution_runs` | Core runs table (root entity) |
| 2026-01-31 | `content_evolution_variants` | Variant pool storage |
| 2026-01-31 | `evolution_checkpoints` | Checkpoint system for crash resume |
| 2026-01-16 | `create_feature_flags` | Generic feature flags (shared table) |
| 2026-01-31 | `evolution_feature_flags_seed` | Seed 10 evolution flags |
| 2026-02-05 | `evolution_run_agent_metrics` | Per-agent cost/Elo metrics |
| 2026-02-05 | `agent_cost_baselines` | Historical cost baselines for prediction |
| 2026-02-05 | `strategy_configs` | Strategy fingerprinting + `update_strategy_aggregates` RPC |
| 2026-02-06 | `tree_search_feature_flag` | Tree search toggle |
| 2026-02-07 | `prompt_fk_on_runs` | Link runs to HoF topics |
| 2026-02-07 | `pipeline_type_on_runs` | Track pipeline mode (full/minimal/batch) |
| 2026-02-09 | `add_flow_critique_flag` | Flow critique toggle |
| 2026-02-10 | `add_cost_estimate_columns` | Cost prediction JSONB columns |
| 2026-02-11 | `evolution_run_logs` | Structured logging |
| 2026-02-12 | `evolution_agent_invocations` | Per-agent execution records |
| 2026-02-14 | `claim_evolution_run` | Atomic batch claiming RPC |

Plus 4 Hall of Fame migrations (article_bank → hall_of_fame rename, rank column, prompt metadata).

#### I.2 Table Dependency Graph

```
content_evolution_runs (root)
├── content_evolution_variants (FK: run_id)
├── evolution_checkpoints (FK: run_id)
├── evolution_run_logs (FK: run_id)
├── evolution_agent_invocations (FK: run_id)
├── evolution_run_agent_metrics (FK: run_id)
├── strategy_configs (FK: strategy_config_id from runs)
├── agent_cost_baselines (referenced, not FKed)
└── hall_of_fame_entries (FK: evolution_run_id)
    └── hall_of_fame_topics (FK: prompt_id from runs)
```

#### I.3 JSONB Column Inventory

| Table | Column | Schema |
|-------|--------|--------|
| `content_evolution_runs` | `config` | Full RunConfig (maxIter, budget, models, budgetCaps, enabledAgents) |
| `content_evolution_runs` | `run_summary` | V2: eloHistory, diversityHistory, matchStats, topVariants; V1 compat: eloRatings |
| `content_evolution_runs` | `cost_estimate_detail` | Per-agent estimates, totalEstimate, confidence |
| `content_evolution_runs` | `cost_prediction` | Estimated vs actual variance per agent |
| `evolution_checkpoints` | `state_snapshot` | Full PipelineState (pool, ratings, matches, critiques, diversity, optional tree/section) |
| `content_evolution_variants` | `quality_scores` | **Never written by pipeline — dead column** |
| `evolution_agent_invocations` | `execution_detail` | AgentExecutionDetail discriminated union (12 variants) |
| `strategy_configs` | `config` | Full StrategyConfig (models, iterations, budgetCaps, enabledAgents) |

#### I.4 Dead/Removable Schema Elements

| Element | Status | Action |
|---------|--------|--------|
| `feature_flags` table (10 evolution rows) | Redundant per Phase 2 | Drop rows, replace with 3 env vars |
| `content_evolution_variants.quality_scores` | Never written by pipeline | Dead column — leave (harmless) |
| `config.budgetCaps` (JSONB field in runs) | Per-agent caps, Phase 3 target | Simplify to single `budgetCapUsd` |
| `pipeline_type` column | Tracks full/minimal/batch | Possibly remove if modes consolidated |
| `evolution_dry_run_only` flag row | Dead — no production usage | Remove row |
| `evolution_prompt_based_enabled` flag row | Dead — no production usage | Remove row |

#### I.5 RPC Functions

| Function | Location | Called By | Simplifiable? |
|----------|----------|-----------|---------------|
| `update_strategy_aggregates(strategy_id, cost, elo)` | strategy_configs migration | pipeline.ts finalization | Could inline (~30 LOC) |
| `claim_evolution_run(runner_id)` | claim migration | Batch runner | Essential — keep (FOR UPDATE SKIP LOCKED) |

#### I.6 Backward Compatibility

Checkpoint deserialization handles legacy Elo format: checks for `ratings` (new), falls back to `eloRatings` (old). No migration needed for existing checkpoints — deserialization handles both formats.

#### I.7 Data Queries Needed Before Phase 3

```sql
-- Agent ROI (bottom performers for removal)
SELECT agent_name, AVG(elo_per_dollar), COUNT(*)
FROM evolution_run_agent_metrics
WHERE created_at >= NOW() - INTERVAL '90 days'
GROUP BY agent_name ORDER BY AVG(elo_per_dollar) ASC;

-- Per-agent budget cap triggers (justify total-only simplification)
SELECT COUNT(*) FILTER (WHERE status = 'paused') as budget_paused,
       COUNT(*) as total_runs
FROM content_evolution_runs;

-- Feature flag override frequency
SELECT name, enabled FROM feature_flags WHERE name LIKE 'evolution_%';
```

---

### J. Test Suite Impact Analysis

#### J.1 Test File Inventory (52 unit + 9 integration + 2 E2E files, ~5,500-6,000 LOC, ~995 individual test cases)

| Category | Files | Test Cases | Key Coverage |
|----------|-------|-----------|-------------|
| Core Pipeline & Orchestration | 6 | 72+ | Pipeline modes, supervisor phases, flow critique, config, state, logging |
| Configuration & Gating | 5 | 78+ | Feature flags, budget redistribution, agent toggle, strategy config |
| Budget System | 3 | 31+ | FIFO reservation, safety margin, per-agent caps, LLM client wiring |
| Comparison & Rating | 4 | 52+ | 2-pass reversal, diff comparison, OpenSkill ordinal, cache |
| Agent Tests | 14 | 143+ | All 14 agents including PairwiseRanker (dead) |
| Section Management | 4 | 38+ | Section parsing, format validation, edit runner, stitcher |
| Tree-of-Thought | 4 | 37+ | Beam search, evaluator, tree node, revision actions |
| Utilities | 6 | 49+ | Pool, diversity, error classification, seed article, JSON parser |
| Experiment Infrastructure | 2 | 22+ | L8 factorial design, ANOVA analysis |

#### J.2 Tests for Dead Code

- **`agents/pairwiseRanker.test.ts`** (~150 LOC, 12+ tests): **KEEP** — PairwiseRanker is used by Tournament internally
- **`experiment/` tests** (2 files): Not pipeline code — relocate with module if moved to `src/lib/experiments/`

#### J.3 Feature Flag Test Impact (DB → env vars)

`core/featureFlags.test.ts` (5 tests) would be **rewritten**:
- Delete tests for dead flags (`promptBasedEvolutionEnabled`, `dryRunOnly`)
- Delete tests for hardcoded flags (5 always-ON flags)
- Keep 3 env var tests for experimental toggles
- **Estimated**: 80 → 40 LOC

#### J.4 Budget System Test Impact (per-agent → total-only)

| Current Tests | After Simplification |
|---------------|---------------------|
| Per-agent cap enforcement (5 tests) | **DELETE** |
| 30% safety margin (2 tests) | **DELETE** (modern models ±5-10%) |
| FIFO queue semantics (4 tests) | **DELETE** |
| Budget redistribution (8 tests) | **DELETE** (entire file) |
| Concurrent reservation safety | **KEEP** |
| Total budget enforcement | **KEEP** |

**Estimated**: costTracker.test.ts 177 → ~80 LOC; budgetRedistribution.test.ts 210 → delete or ~40 LOC

#### J.5 Three-Tier Gating Test Impact

- `agentToggle.test.ts` (16 tests): **KEEP** — dependency/mutex validation still needed for UI
- `featureFlags.test.ts` (5 tests): **REWRITE** as env var tests
- `supervisor.test.ts` phase tests (8 tests): **SIMPLIFY** if phase consolidation happens
- **No test exercises all 3 tiers together** — identified as coverage gap

#### J.6 Shared Test Utilities (Improvement Opportunity)

Each test file independently defines `makeMockLLMClient()`, `makeMockLogger()`, `makeMockCostTracker()`, `makeCtx()`. These are duplicated across 40+ files.

**Opportunity**: Extract to `src/testing/evolution-test-helpers.ts` (~80-100 LOC). Already partially exists (beamSearch.test.ts imports `VALID_VARIANT_TEXT` from there).

#### J.7 Coverage Gaps Identified

1. **No end-to-end test**: cron → queue → executeFullPipeline → DB persistence
2. **No checkpoint resume after partial failure**: multi-iteration + agent fail + resume
3. **No test for all 3 gating tiers together** in single pipeline execution
4. **No test for `ordinalToEloScale()` conversion** (pipeline.ts L129)
5. **No test for agent model fallback chain**: `agentModels[agent] ?? (isJudge ? judgeModel : generationModel)`
6. **No test for diversity collapse → degenerate stop** in real pipeline

#### J.8 Overall Test Impact Summary

| Phase | Test Files Affected | Test Cases Removed | LOC Change |
|-------|--------------------|--------------------|-----------|
| Phase 1 (Quick Wins) | 1 deleted | 12+ | -150 |
| Phase 2 (Module Extraction) | 4 rewritten | 5-10 | -50 to -100 |
| Phase 3 (Structural) | 10 affected | 30-40 | -400 to -500 |
| **Total** | **~15** | **~50-60** | **-600 to -750** |

---

### K. Server Actions & Integration Layer (~8,500 LOC)

#### K.1 Server Action Files

| File | LOC | Actions | Feature Flag Dependencies |
|------|-----|---------|--------------------------|
| `evolutionActions.ts` | 978 | 13 core CRUD actions | `dryRunOnly`, `promptBasedEvolutionEnabled` |
| `evolutionVisualizationActions.ts` | 1,101 | 11 visualization data actions | None |
| `evolutionBatchActions.ts` | 84 | 1 batch dispatch action | None |
| `hallOfFameActions.ts` | 1,189 | 14 HoF actions + Elo K=32 | None |
| `costAnalyticsActions.ts` | 199 | 2 cost accuracy actions | None |
| **Total** | **3,551** | **41** | **2 files** |

#### K.2 Dead Feature Flag Usage in Integration Layer

| Flag | References | Status |
|------|-----------|--------|
| `dryRunOnly` | evolutionActions.ts (1×), cron route.ts (1×), scripts/evolution-runner.ts (1×) = 3 call sites | **Never toggled from default — remove** |
| `promptBasedEvolutionEnabled` | evolutionActions.ts (1×), cron route.ts (1×) = 2 call sites | **Never toggled from default — remove** |
| All other flags | Not referenced in integration layer | No impact |

**Impact**: ~50 LOC removed, ~2 hours refactoring

#### K.3 Cron Jobs

| Endpoint | LOC | Purpose | Simplification |
|----------|-----|---------|----------------|
| `evolution-runner/route.ts` | 272 | FIFO queue processor with heartbeat (manual query, not RPC) | Remove dead flag checks (-20 LOC) |
| `evolution-watchdog/route.ts` | 78 | Stale run detector (>10 min heartbeat) | Already minimal — no changes |

#### K.4 CLI Scripts (4 evolution-specific)

| Script | LOC | Purpose | Status |
|--------|-----|---------|--------|
| `evolution-runner.ts` | 332 | Batch runner with parallelism (uses `claim_evolution_run` RPC) | Active — remove dead flag checks |
| `run-evolution-local.ts` | 816 | Local dev runner with mock LLM | Active — complex but valuable for dev |
| `add-to-hall-of-fame.ts` | 175 | HoF entry creation utility | Active |
| `run-hall-of-fame-comparison.ts` | 279 | HoF Swiss tournament trigger | Active |

Plus 2 experiment/analytics scripts.

#### K.5 Visualization Actions Design Quality

The visualization layer is **well-designed**:
- Each action fetches specific data for one tab/view
- Proper V1/V2 backward compat in deserialization
- No direct PipelineState coupling (fetches from DB)
- `computeEffectiveBudgetCaps()` would simplify if budget goes total-only

#### K.6 Hall of Fame Independence

HoF is **properly decoupled** from pipeline:
- Separate tables: `hall_of_fame_topics`, `entries`, `elo`, `comparisons`
- Independent Elo K=32 system (no OpenSkill dependency)
- Only back-linked via `evolution_run_id`, `evolution_variant_id`
- Can be populated from any generation method

#### K.7 Admin Pages (4 routes)

| Route | Purpose | Feature Flag UI? |
|-------|---------|-----------------|
| `/admin/evolution-dashboard` | Metrics dashboard | No |
| `/admin/quality/evolution` | Run list with filters | No |
| `/admin/quality/evolution/run/[runId]` | Run detail (7 tabs) | No |
| `/admin/quality/evolution/run/[runId]/compare` | Before/after comparison | No |

**CORRECTION**: No evolution-specific feature flag admin UI was found in the codebase. Feature flags are only managed in code (featureFlags.ts defaults + DB), not via an admin page.

#### K.8 Integration Layer Coupling Matrix

```
                 EA   EVA  EBA  HFA  CAA  Cron  Batch  Admin  UI
EA (actions)      -    ✓    ✗    ✗    ✗    ✓     ✗      ✓     ✓
EVA (viz)         ✓     -    ✗    ✗    ✗    ✗     ✗      ✓     ✓
EBA (batch)       ✗    ✗     -    ✗    ✗    ✗     ✓      ✓     ✓
HFA (hall)        ✗    ✗    ✗     -    ✗    ✗     ✗      ✓     ✓
CAA (cost)        ✗    ✗    ✗    ✗     -    ✗     ✗      ✓     ✓
```

**Key Finding**: HoF and Cost Analytics are fully decoupled from pipeline execution — they're analytics layers.

#### K.9 Integration Layer Simplification Summary

| Item | Current | Impact | Effort |
|------|---------|--------|--------|
| Remove dead feature flags | 4 call sites across 3 files | -50 LOC | 2h |
| Collapse `buildRunConfig()` | 60 LOC → ~30 LOC | -30 LOC | 2h |
| Simplify budget in viz action | `computeEffectiveBudgetCaps()` → simple lookup | -30 LOC | 2h |
| Consolidate seed article generation | 3 independent implementations → 1 shared utility | -40 LOC | 4h |
| Drop V1 summary schema | Zod validation simplification | -20 LOC | 30m |

---

## Updated Consolidated Metrics (Including Integration Layer)

### Full System Scope

| Layer | Files | LOC | Simplifiable LOC |
|-------|-------|-----|-----------------|
| Pipeline Core (evolution/) | 56 source | ~8,500-9,500 | 1,000-1,600 |
| UI Components (components/evolution/) | 39 | ~2,849 | 350-650 |
| Server Actions (services/) | 5 | ~3,551 | 150-200 |
| Cron Jobs (api/cron/) | 2 | ~346 | 20-50 |
| CLI Scripts (scripts/) | 4 | ~1,602 | 50-100 |
| Tests (*.test.ts) | 63 | ~5,500-6,000 | 550-650 |
| Admin Pages (app/admin/) | 4 | ~1,738 | 100 |
| **Total** | **173+** | **~24,086-25,586** | **2,220-3,350** |

### Data Queries Recommended Before Phase 3

1. `evolution_run_agent_metrics`: `AVG(elo_per_dollar)` per agent over 90 days
2. Phase transition frequency: How often EXPANSION→COMPETITION fires
3. Per-agent budget cap triggers: How often individual cap (not total) causes pause
4. Feature flag override rates: Are defaults ever changed in DB?
5. TreeSearch vs IterativeEditing: `elo_per_dollar` comparison
6. Prompt-based run usage: How many runs use `prompt_id` without `explanation_id`?

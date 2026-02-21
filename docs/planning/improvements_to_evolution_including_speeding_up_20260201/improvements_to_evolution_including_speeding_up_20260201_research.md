# Improvements to Evolution Including Speeding Up Research

## Problem Statement
The evolution pipeline is a multi-agent system for iteratively improving text content through LLM-driven generation, evaluation, and selection using Elo-based competitive ranking. This research documents the full existing system to inform speed and quality improvements.

## High Level Summary
The evolution pipeline lives in `src/lib/evolution/` with 8 agents, a two-phase supervisor (EXPANSION → COMPETITION), Elo-based ranking, budget enforcement, and checkpoint/resume. The service layer in `src/lib/services/evolutionActions.ts` and `evolutionVisualizationActions.ts` exposes it via server actions. Two CLI scripts (`evolution-runner.ts`, `run-evolution-local.ts`) provide batch and local execution. A visualization dashboard with 5 tabs (Timeline, Elo, Lineage, Budget, Variants) exists at `/admin/quality/evolution/`. Test coverage includes 14 unit test files, 4 integration test suites, and 2 E2E specs.

---

## Architecture Overview

### Two-Phase Pipeline
```
executeMinimalPipeline / executeFullPipeline
              │
              ├─→ PipelineState (mutable state container)
              ├─→ PoolSupervisor (phase transitions)
              ├─→ CostTracker (budget enforcement)
              ├─→ ComparisonCache (deduplication)
              └─→ Agents (generation, calibration, tournament, evolution, etc.)
                     │
                     └─→ LLMClient → Elo updates → State mutations
```

**EXPANSION Phase**: Rapidly builds diverse pool (3 strategies per iteration, all enabled). Runs until pool ≥ 15 AND diversity ≥ 0.25, or iteration ≥ 8 (safety cap).

**COMPETITION Phase**: Refines quality through tournament ranking, evolution (mutation/crossover), reflection, and meta-review. One-way lock — never reverts to EXPANSION.

### Pipeline Entry Points

1. **`executeMinimalPipeline`** (`core/pipeline.ts:174-252`): Simplified single-phase, runs agents sequentially. Used by admin UI manual trigger.
2. **`executeFullPipeline`** (`core/pipeline.ts:282-462`): Phase-aware with PoolSupervisor, checkpoint after each iteration, resume support. Used by batch runner.

### Iteration Flow (Full Pipeline)
```
for i in 0..maxIterations:
  state.startNewIteration()
  supervisor.beginIteration(state)     // Phase detection/transition
  config = supervisor.getPhaseConfig(state)

  if supervisor.shouldStop(state, budget): break

  // Execute agents per phase config:
  if config.runGeneration: runAgent(generation)
  if config.runReflection: runAgent(reflection)
  if config.runEvolution: runAgent(evolution)      // feature flag gated
  if config.runCalibration:
    agent = tournament if COMPETITION else calibration
    runAgent(agent)                                 // feature flag gated
  if config.runProximity: runAgent(proximity)
  if config.runMetaReview: runAgent(metaReview)

  persistCheckpointWithSupervisor()
```

### Stop Conditions
1. **Quality Plateau** (COMPETITION only): Top Elo improvement < 2.0 points for 3 iterations
2. **Budget Exhausted**: Available < $0.01
3. **Max Iterations**: Default 15

---

## Core Components

### Pipeline State (`core/state.ts`)
- Mutable in-place container with append-only pool semantics
- Tracks: pool (TextVariation[]), Elo ratings (Map), match history, critiques, similarity matrix, diversity score, meta-feedback
- Serialization converts Maps to Objects for JSON checkpoint storage

### PoolSupervisor (`core/supervisor.ts`)
- Manages EXPANSION → COMPETITION phase transition
- Phase detection: `poolSize >= 15 AND diversityScore >= 0.25 → COMPETITION`
- Agent gating: Configures which agents run per phase
- Strategy rotation: Cycles through 3 strategies in COMPETITION
- Checkpoint resume: Preserves phase, rotation index, Elo/diversity history

### Elo Rating System (`core/elo.ts`)
- Standard Elo with floor of 800, initial rating 1200
- Adaptive K-factor: 48 (≤5 matches) → 32 (≤15) → 16 (16+)
- Confidence-weighted updates: `actualScore = 0.5 + 0.5 * confidence`
- Draw support: Both get score 0.5

### Cost Tracker (`core/costTracker.ts`)
- Pre-call reservation with 30% safety margin
- Per-agent budget caps: generation 25%, calibration 20%, tournament 30%, evolution 20%, reflection 5%
- BudgetExceededError pauses run (not fails)

### Comparison Cache (`core/comparisonCache.ts`)
- In-memory, order-invariant SHA-256 keys
- Only caches valid results (skips errors for retry)
- Per-run scope, not persisted across runs

### LLM Client (`core/llmClient.ts`)
- Wraps `callOpenAIModel` with budget enforcement
- Default model: `deepseek-chat`
- Pricing: deepseek-chat ($0.14/$0.28), gpt-4.1-mini ($0.40/$1.60), gpt-4.1-nano ($0.10/$0.40) per 1M tokens
- Token estimation: ~4 chars/token, 50% output ratio
- Structured output: JSON parse → Zod validation

### Feature Flags (`core/featureFlags.ts`)
- DB-backed flags: `tournamentEnabled`, `evolvePoolEnabled`, `dryRunOnly`
- Safe defaults on error (all enabled, dry-run off)

### Diversity Tracker (`core/diversityTracker.ts`)
- Thresholds: HEALTHY (≥0.4), LOW (≥0.2), CRITICAL (≥0.1), COLLAPSED (<0.1)
- Recommendations: Force exploration when critical, increase exploration when low
- Lineage dominance detection: Warns if any lineage >50% of pool
- Trend analysis: Compares first-half vs second-half average

---

## Agents

### 1. GenerationAgent (`agents/generationAgent.ts`)
- Creates 3 text variations from original using parallel strategies: structural_transform, lexical_simplify, grounding_enhance
- Uses `generationModel` (default gpt-4.1-mini)
- Format validation rejects non-prose (bullets, tables)
- Incorporates metaFeedback.priorityImprovements if available

### 2. CalibrationRanker (`agents/calibrationRanker.ts`)
- Ranks new entrants via pairwise comparison with stratified opponents
- Position-bias mitigation: Forward + reverse comparison, confidence from agreement
- Stratified opponent selection: 2 top quartile + 2 mid + 1 bottom/new
- Adaptive early exit: Skip remaining if first minOpponents are decisive
- Uses `judgeModel` (default gpt-4.1-nano)
- LLM calls: newEntrants × opponents × 2 (bias mitigation)

### 3. PairwiseRanker (`agents/pairwiseRanker.ts`)
- All-pairs ranking for small pools
- Simple mode (A/B/TIE) and structured mode (5-dimension scores)
- Not typically used in production (Tournament replaces it)

### 4. Tournament (`agents/tournament.ts`)
- Swiss-style tournament with Elo ratings, used in COMPETITION
- Budget pressure tiers: Low (<0.5 spent: 40 comparisons), Medium (25), High (15)
- Multi-turn tiebreaker for top-quartile close matches
- Convergence detection: Stops after N rounds with max Elo change < 10

### 5. EvolutionAgent (`agents/evolvePool.ts`)
- Creates new variants from top parents via mutation and crossover
- Strategies: mutate_clarity, mutate_structure, crossover
- Creative exploration: 30% random chance OR low diversity (<0.5)
- Uses `generationModel`

### 6. ReflectionAgent (`agents/reflectionAgent.ts`)
- Dimensional critiques of top 3 variants
- 5 dimensions: clarity, structure, engagement, precision, coherence
- Outputs per-dimension scores, good/bad examples, notes
- Helpers: getCritiqueForVariant, getWeakestDimension, getImprovementSuggestions

### 7. MetaReviewAgent (`agents/metaReviewAgent.ts`)
- Pure analysis, NO LLM calls (cost $0)
- Analyzes strategy effectiveness, identifies weaknesses, detects failing patterns
- Provides priority improvements for next iteration
- Output feeds into GenerationAgent and EvolutionAgent prompts

### 8. ProximityAgent (`agents/proximityAgent.ts`)
- Computes diversity/similarity via embeddings
- Current implementation: Character-based embeddings (simplified, real OpenAI deferred)
- Test mode: Deterministic MD5-based pseudo-embeddings
- Diversity = 1 - mean(top-10 pairwise similarities)
- No LLM calls in current implementation

### Agent Data Flow
```
originalText → GenerationAgent → [variations]
                                      ↓
                          CalibrationRanker → [Elo ratings]
                                      ↓
                              ReflectionAgent → [critiques]
                                      ↓
                             MetaReviewAgent → [metaFeedback]
                                      ↓
                           EvolutionAgent (uses metaFeedback) → [new variations]
                                      ↓
                              Tournament → [refined Elo rankings]
```

---

## Service Layer

### evolutionActions.ts (`src/lib/services/evolutionActions.ts`)
- `queueEvolutionRunAction(explanationId, budgetCapUsd)` → creates pending run
- `getEvolutionRunsAction(filters?)` → fetches runs with status/date filters
- `getEvolutionVariantsAction(runId)` → fetches variants ordered by Elo DESC
- `applyWinnerAction(explanationId, variantId, runId)` → replaces article content, triggers Phase E quality eval
- `triggerEvolutionRunAction(runId)` → manual trigger, runs executeMinimalPipeline
- `getEvolutionRunSummaryAction(runId)` → parsed run_summary JSONB
- `getEvolutionCostBreakdownAction(runId)` → groups llmCallTracking by agent
- `getEvolutionHistoryAction(explanationId)` → content_history for rollback
- `rollbackEvolutionAction(explanationId, historyId)` → restores previous content

### evolutionVisualizationActions.ts (`src/lib/services/evolutionVisualizationActions.ts`)
- `getEvolutionDashboardDataAction()` → aggregated metrics, time series, recent runs
- `getEvolutionRunTimelineAction(runId)` → iteration timeline from checkpoints
- `getEvolutionRunEloHistoryAction(runId)` → Elo ratings per variant over time
- `getEvolutionRunLineageAction(runId)` → graph nodes + edges from checkpoint
- `getEvolutionRunBudgetAction(runId)` → cumulative burn curve
- `getEvolutionRunComparisonAction(runId)` → original vs winner + quality scores

---

## CLI Scripts

### evolution-runner.ts (`scripts/evolution-runner.ts`)
- Background worker: Claims pending runs, executes full pipeline
- Atomic claim via `claim_evolution_run` RPC (FOR UPDATE SKIP LOCKED)
- Heartbeat every 60s for watchdog monitoring
- Config: `--dry-run`, `--max-runs N`
- Graceful SIGTERM/SIGINT shutdown

### run-evolution-local.ts (`scripts/run-evolution-local.ts`)
- Standalone CLI for local evolution without Next.js
- `--mock` flag: Deterministic responses for testing (no API keys needed)
- `--full --iterations N`: Full pipeline with PoolSupervisor
- Auto-persists to Supabase when env vars available
- Outputs JSON with rankings, full state, cost summary

---

## Database Schema

### evolution_runs
- `id` UUID, `explanation_id` INT, `status` TEXT, `phase` TEXT
- `total_variants` INT, `total_cost_usd` NUMERIC, `budget_cap_usd` NUMERIC
- `config` JSONB, `current_iteration` INT, `run_summary` JSONB
- `runner_id` TEXT, `last_heartbeat` TIMESTAMP
- `source` TEXT: 'explanation' vs 'local:<filename>' for CLI runs

### evolution_variants
- `id` UUID (matches pool variant ID), `run_id` UUID, `explanation_id` INT
- `variant_content` TEXT, `elo_score` NUMERIC, `generation` INT
- `parent_variant_id` UUID, `agent_name` TEXT, `match_count` INT
- `is_winner` BOOLEAN, `quality_scores` JSONB

### evolution_checkpoints
- `run_id` UUID, `iteration` INT, `phase` TEXT, `last_agent` TEXT
- `state_snapshot` JSONB (serialized PipelineState + supervisor state)

### feature_flags
- `evolution_tournament_enabled`, `evolution_evolve_pool_enabled`, `evolution_dry_run_only`

---

## UI Pages

### Admin Evolution Page (`/admin/quality/evolution/page.tsx`)
- Queue dialog, runs table with filters, variant panel, apply/rollback actions

### Dashboard (`/admin/quality/evolution/dashboard/page.tsx`)
- Stat cards (active runs, queue depth, 7d success rate, monthly spend)
- Runs over time chart, daily spend chart, recent runs table
- Auto-refresh polling

### Run Detail (`/admin/quality/evolution/run/[runId]/page.tsx`)
- 5 lazy-loaded tabs: Timeline, Elo, Lineage, Budget, Variants
- Each tab fetches visualization data on mount

### Compare Page (`/admin/quality/evolution/run/[runId]/compare/page.tsx`)
- Word-level text diff, quality radar chart (5 dimensions), stats cards

### Key Components (`src/components/evolution/`)
- EvolutionStatusBadge, PhaseIndicator, EloSparkline, LineageGraph (D3 DAG)
- AutoRefreshProvider, VariantCard
- Tab components: TimelineTab, EloTab, LineageTab, BudgetTab, VariantsTab

---

## Test Coverage

### Unit Tests (14 files)
| File | Tests | Key Coverage |
|------|-------|-------------|
| `generationAgent.test.ts` | GenerationAgent | 3 strategies, format validation, error resilience |
| `calibrationRanker.test.ts` | CalibrationRanker | Judge model, bias mitigation, adaptive early exit |
| `pairwiseRanker.test.ts` | PairwiseRanker | Parse logic, confidence calculation, caching |
| `tournament.test.ts` | Tournament | Swiss pairing, budget pressure, convergence |
| `evolvePool.test.ts` | EvolutionAgent | Mutation/crossover, creative exploration |
| `reflectionAgent.test.ts` | ReflectionAgent | Critique parsing, dimension scores |
| `metaReviewAgent.test.ts` | MetaReviewAgent | Strategy analysis, weakness detection |
| `proximityAgent.test.ts` | ProximityAgent | Similarity, diversity, cosine edge cases |
| `formatValidator.test.ts` | validateFormat | All rules, reject/warn/off modes |
| `pipeline.test.ts` | Pipeline functions | Baseline insert, run summary, validation |
| `pool.test.ts` | PoolManager | Parent selection, baseline exclusion |
| `featureFlags.test.ts` | Feature flags | DB fetch, defaults, error handling |
| `evolutionActions.test.ts` | Service actions | Cost breakdown, rollback, filters |
| `EvolutionStatusBadge.test.tsx` | Status badge | All 6 statuses |

### Integration Tests (4 suites)
| File | Tests | Key Coverage |
|------|-------|-------------|
| `evolution-pipeline.integration.test.ts` | executeMinimalPipeline | Full pipeline with real DB |
| `evolution-actions.integration.test.ts` | Server actions | Queue, apply, rollback with real DB |
| `evolution-infrastructure.integration.test.ts` | Infrastructure | Concurrency, heartbeat, feature flags |
| `evolution-visualization.integration.test.ts` | Visualization | Dashboard, timeline, lineage, budget |

### E2E Tests (2 specs, currently skipped)
| File | Tests | Status |
|------|-------|--------|
| `admin-evolution.spec.ts` | Admin evolution page | Skipped (tables not in CI) |
| `admin-evolution-visualization.spec.ts` | Visualization pages | Skipped (tables not in CI) |

### Test Helpers (`src/testing/utils/evolution-test-helpers.ts`)
- `VALID_VARIANT_TEXT`: Format-valid test markdown
- `evolutionTablesExist()`: Auto-skip guard
- `createMockEvolutionLLMClient()`: Mock LLM client factory
- `createTestEvolutionRun/Variant/Checkpoint()`: DB record factories

---

## Configuration Defaults

```typescript
DEFAULT_EVOLUTION_CONFIG = {
  maxIterations: 15,
  budgetCapUsd: 5.00,
  plateau: { window: 3, threshold: 0.02 },
  expansion: { minPool: 15, minIterations: 3, diversityThreshold: 0.25, maxIterations: 8 },
  generation: { strategies: 3 },
  calibration: { opponents: 5, minOpponents: 2 },
  budgetCaps: { generation: 0.25, calibration: 0.20, tournament: 0.30, evolution: 0.20, reflection: 0.05 },
  useEmbeddings: false,
  judgeModel: 'gpt-4.1-nano',
  generationModel: 'gpt-4.1-mini',
}
```

---

## Known Design Decisions and Trade-offs

1. **Position Bias Mitigation**: Doubles every comparison call (forward + reverse). 2x cost for fair rankings.
2. **Append-Only Pool**: Variants never removed. Memory/serialization cost vs genetic diversity.
3. **Checkpoint-Only Lineage**: DB parent_variant_id not reliably populated; lineage uses in-memory parentIds from checkpoint.
4. **Cost Attribution via Time-Window**: llmCallTracking has no run_id column, matched by timestamp. Concurrent runs may overlap.
5. **Comparison Cache Scope**: In-memory, per-run only. No cross-run caching.
6. **Agent-Level Parallelism Deferred**: Agents execute sequentially within iteration due to shared mutable state.
7. **Batch API Deferred**: OpenAI Batch API (50% discount) requires async job queue incompatible with current synchronous model.
8. **ProximityAgent Simplified**: Uses character-based embeddings, not real OpenAI embeddings.

---

## Speed Improvement Analysis

### Cross-reference with Previous Project
`docs/planning/recommended_improvements_evolution_pipeline_20260131/` proposed 7 improvements. Of these:
- **Already implemented**: Tiered model routing (#1), LLM response cache (#2), adaptive calibration early exit (#5), async parallelism within agents (#6)
- **Deferred**: Conditional bias mitigation (#3), agent-level parallelism (#4), batch API (#7)

### Bottleneck Analysis
Tournament and calibration consume ~90% of per-iteration wall-clock time due to sequential LLM calls. The remaining agents (generation, evolution, reflection, meta-review, proximity) are fast by comparison.

### Speed Improvement Options Evaluated

| # | Approach | Impact | Complexity | Decision |
|---|----------|--------|-----------|----------|
| 1 | Conditional bias mitigation (skip reverse for high-confidence) | ~40% fewer calls | ~30 lines | **DEFERRED** — diminishing returns if parallel rounds implemented |
| 2 | **Parallel Round 1+2 in bias mitigation** | ~50% faster per comparison | ~5 lines | **SELECTED** |
| 3 | **Information-theoretic Swiss pairing** | ~35-45% fewer rounds to converge | ~55 lines | **SELECTED** |
| 4 | Agent-level parallelism (Reflection ‖ Evolution) | ~3-4% wall-clock | ~95 lines | **DEFERRED** — high complexity, low payoff |
| 5 | Budget pressure cap tuning | Variable | ~3 lines | **DEFERRED** — config-only, do later |
| 6 | Prompt shortening | ~15-20% per call | ~10-40 lines | **DEFERRED** — orthogonal to architecture |
| 7 | Batch API (OpenAI) | 50% cost reduction | Major rework | **DEFERRED** — using DeepSeek, not applicable |

### Selected Improvement #2: Parallel Bias Mitigation Rounds

**Current code** (`calibrationRanker.ts:68-130`, `pairwiseRanker.ts:201-276`):
```typescript
// Round 1: A vs B (sequential)
const r1 = await this.comparePair(ctx, textA, textB, structured);
// Round 2: B vs A (reversed) — waits for r1 to finish
const r2 = await this.comparePair(ctx, textB, textA, structured);
```

**Fix**: Replace with `Promise.all([...])` since the two rounds are completely independent — they send separate LLM calls with no shared state. This halves wall-clock time per comparison.

### Selected Improvement #3: Information-Theoretic Swiss Pairing

#### Current Implementation
`tournament.ts:54-84` uses greedy adjacent pairing: sort by Elo, match each player with the nearest unplayed neighbor. This is simple but suboptimal — it often creates uninformative matches between players with well-established ratings.

#### Research: Pairing Algorithm Approaches

**Standard Swiss Improvements (Dutch/Burstein systems)**:
- Classic chess tournament pairing: split into top/bottom halves, match across halves
- Avoids repeat matchups, balances color assignments
- Limited applicability — doesn't optimize for information gain

**Information-Theoretic Pairing (MaxIn-Elo, Bradley-Terry)**:
- Score each potential pair by expected information gain
- Pairs with uncertain outcomes (win probability near 50%) yield the most Elo information
- `outcomeUncertainty = 1 - |expectedA - expectedB|` where expected is from Elo formula
- Dramatically reduces rounds needed to establish stable rankings

**Uncertainty-Aware Pairing (TrueSkill, OpenSkill/Weng-Lin)**:
- Replace Elo with (mu, sigma) tuples where sigma tracks rating confidence
- Prioritize matchups involving high-sigma (uncertain) players
- OpenSkill (`openskill` npm package) implements Weng-Lin 2011 model
- Would require replacing the entire Elo system — large surface area change

**Multi-Objective Pairing**:
- Combine information gain with diversity (avoid lineage self-play)
- Weight by position in ranking (care more about top-K accuracy)

**Practical Implementations Referenced**:
- LMSYS Chatbot Arena: Uses information-theoretic pairing to efficiently rank LLMs
- Glicko-2: Adds volatility parameter, used by chess.com and lichess
- BayesElo: Maximum-likelihood estimate, used in computer chess

#### Decision: Approach A — Sigma-Weighted Info-Theoretic Pairing

**Chosen over Approach B** (replacing Elo with OpenSkill) because:
1. No new dependency — uses existing `matchCount` as sigma proxy
2. Small surface area — only changes pairing selection, not rating updates
3. Preserves all existing Elo infrastructure (adaptive K-factor, confidence-weighted updates, plateau detection)
4. Lower risk — if pairing is worse, existing Elo math still produces valid rankings

**Design**:
```
sigma(v) = 1 / sqrt(min(matchCount(v), cap) + 1)    // cap=20

For each candidate pair (A, B):
  eloA = eloRatings.get(A) ?? 1200
  eloB = eloRatings.get(B) ?? 1200
  expectedA = 1 / (1 + 10^((eloB - eloA) / 400))
  outcomeUncertainty = 1 - |expectedA - (1 - expectedA)|   // = 1 - |2*expectedA - 1|
  sigmaProxy = max(sigma(A), sigma(B))
  pairScore = outcomeUncertainty * sigmaProxy
```

Select pairs greedily by descending `pairScore`, skipping already-matched or previously-played pairs.

**Additional enhancement — Top-K Focus Boosting**:
```
If both A and B are in top-K (K = pool/3):
  pairScore *= 1.5    // 50% boost for matches that refine the leaderboard top
```

This focuses comparison budget where it matters most — accurately ranking the best variants.

**Expected impact**: ~35-45% fewer Swiss rounds to establish stable top-K rankings, because:
- New/uncertain variants get matched immediately (high sigma)
- Established variants stop playing uninformative matches
- Top-K accuracy converges faster with focused comparisons

---

## Documents Read
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- `docs/feature_deep_dives/evolution_pipeline.md`
- `docs/feature_deep_dives/evolution_pipeline_visualization.md`

## Code Files Read
- `src/lib/evolution/index.ts` - Public API exports
- `src/lib/evolution/config.ts` - Default config, Elo constants
- `src/lib/evolution/types.ts` - Shared interfaces
- `src/lib/evolution/core/pipeline.ts` - Pipeline orchestration
- `src/lib/evolution/core/supervisor.ts` - Phase management
- `src/lib/evolution/core/state.ts` - State container
- `src/lib/evolution/core/pool.ts` - Pool management
- `src/lib/evolution/core/elo.ts` - Elo rating functions
- `src/lib/evolution/core/costTracker.ts` - Budget enforcement
- `src/lib/evolution/core/comparisonCache.ts` - Result caching
- `src/lib/evolution/core/diversityTracker.ts` - Diversity tracking
- `src/lib/evolution/core/featureFlags.ts` - Feature flags
- `src/lib/evolution/core/llmClient.ts` - LLM client wrapper
- `src/lib/evolution/core/logger.ts` - Logger factory
- `src/lib/evolution/core/validation.ts` - State validation
- `src/lib/evolution/agents/base.ts` - Agent base class
- `src/lib/evolution/agents/generationAgent.ts` - Text generation
- `src/lib/evolution/agents/calibrationRanker.ts` - Calibration ranking
- `src/lib/evolution/agents/pairwiseRanker.ts` - Pairwise comparison
- `src/lib/evolution/agents/tournament.ts` - Swiss tournament
- `src/lib/evolution/agents/evolvePool.ts` - Evolution/mutation
- `src/lib/evolution/agents/reflectionAgent.ts` - Reflection/critique
- `src/lib/evolution/agents/metaReviewAgent.ts` - Meta review
- `src/lib/evolution/agents/proximityAgent.ts` - Proximity/similarity
- `src/lib/evolution/agents/formatRules.ts` - Format rules
- `src/lib/evolution/agents/formatValidator.ts` - Format validation
- `src/lib/services/evolutionActions.ts` - Server actions
- `src/lib/services/evolutionVisualizationActions.ts` - Visualization actions
- `scripts/evolution-runner.ts` - Batch runner CLI
- `scripts/run-evolution-local.ts` - Standalone local CLI
- `src/app/admin/quality/evolution/page.tsx` - Admin evolution page
- `src/app/admin/quality/evolution/dashboard/page.tsx` - Dashboard
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` - Run detail
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` - Compare page
- `src/components/evolution/` - All visualization components
- `src/testing/utils/evolution-test-helpers.ts` - Test helpers
- All 14 unit test files, 4 integration test suites, 2 E2E specs
- `supabase/migrations/20260131000001-000009` - Evolution DB migrations

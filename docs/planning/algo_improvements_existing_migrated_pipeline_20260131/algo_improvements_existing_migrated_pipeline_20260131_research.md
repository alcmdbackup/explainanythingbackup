# Algo Improvements Existing Migrated Pipeline Research

**Date**: 2026-02-01T04:17:58Z
**Git Commit**: 15d5855
**Branch**: feat/algo_improvements_existing_migrated_pipeline_20260131
**Repository**: Minddojo/explainanything

## Problem Statement
Analyze the current state of the evolution pipeline — its architecture, agent design, integration points, testing coverage, and algorithmic decisions — to inform potential algorithmic improvements.

## High Level Summary

The evolution pipeline is a self-contained subsystem in `src/lib/evolution/` (~40 files, 8 agents, 12 core modules, 17 test files) that iteratively improves article content through LLM-driven genetic evolution with Elo-based ranking. It operates in two phases (EXPANSION → COMPETITION), managed by a PoolSupervisor, with budget enforcement, crash recovery via checkpoints, and an admin UI for monitoring.

Key architectural characteristics:
- **Two execution modes**: Minimal (sequential, admin-triggered) and Full (multi-iteration, batch runner)
- **8 specialized agents**: Generation, CalibrationRanker, PairwiseRanker, Tournament, EvolutionAgent, ReflectionAgent, MetaReviewAgent, ProximityAgent
- **Elo rating system** with adaptive K-factor, position bias mitigation, and confidence weighting
- **Cost-aware**: Per-agent budget caps (generation 25%, calibration 20%, tournament 30%, evolution 20%, reflection 5%) with 30% safety margins
- **Default models**: `deepseek-chat` (generation), `gpt-4.1-nano` (judge)
- **Append-only pool** with serialization for checkpoint/resume
- **Comprehensive test coverage**: 17 unit test files, 3 integration tests, 1 E2E spec (currently skipped)

---

## Detailed Findings

### 1. Architecture Overview

```
Admin UI (page.tsx)
├─ queueEvolutionRunAction → content_evolution_runs (pending)
├─ triggerEvolutionRunAction → executeMinimalPipeline
├─ applyWinnerAction → content_history + explanations.content
└─ rollbackEvolutionAction → content_history

Cron: Quality Eval → auto-queue articles scoring < 0.4
Cron: Watchdog → mark stale runs as failed (>10 min heartbeat)

Batch Runner (evolution-runner.ts)
├─ claimNextRun → content_evolution_runs (claimed)
├─ executeFullPipeline (EXPANSION → COMPETITION)
└─ persist variants → content_evolution_variants
```

### 2. Agent Layer (`src/lib/evolution/agents/`)

| Agent | Purpose | LLM Calls | Scoring | Key Output |
|-------|---------|-----------|---------|------------|
| **GenerationAgent** | Creates 3 initial variants (structural_transform, lexical_simplify, grounding_enhance) | 3 parallel | None | Adds TextVariation to pool |
| **CalibrationRanker** | Calibrates new entrants via stratified opponents + bias mitigation | 2N (forward + reverse) | Elo (adaptive K) | Updates eloRatings, matchHistory |
| **PairwiseRanker** | Full-pool pairwise comparison, optional 5-dimension structured eval | C(n,2)×2 | Elo + dimension scores | matchHistory updates |
| **Tournament** | Swiss-style tournament with budget-adaptive depth + multi-turn tiebreakers | Adaptive | Elo (convergence-aware) | matchHistory, convergence metric |
| **EvolutionAgent** | Genetic evolution: mutate_clarity, mutate_structure, crossover, creative_exploration | 3-4 | None | New variants in pool |
| **ReflectionAgent** | 5-dimension critique (clarity, structure, engagement, precision, coherence) | 3 (top variants) | 1-10 per dimension | allCritiques, dimensionScores |
| **MetaReviewAgent** | Pure analysis — synthesizes strategy success, weakness, priority | 0 | Analysis-only | metaFeedback |
| **ProximityAgent** | Diversity metrics via character-based fallback embeddings | 0 | Cosine similarity | similarityMatrix, diversityScore |

#### Agent Execution Flow (Full Pipeline)
Each iteration runs agents conditionally based on phase:
- **EXPANSION**: Generation → Calibration → Proximity (all 3 generation strategies)
- **COMPETITION**: Generation (1 rotating strategy) → Calibration → Reflection → Evolution → Tournament → Proximity → MetaReview

#### Position Bias Mitigation Protocol
All comparison agents (Calibration, Pairwise, Tournament) run each comparison twice:
1. Forward: A vs B
2. Reverse: B vs A (with labels swapped)
3. Confidence derived from agreement: 1.0 (agree), 0.7 (partial), 0.5 (disagree), 0.3 (one-error)

### 3. Core Layer (`src/lib/evolution/core/`)

| Module | Purpose | Key Algorithms |
|--------|---------|----------------|
| **pipeline.ts** | Orchestrates minimal/full execution with checkpointing | Sequential agent execution, OTel spans, retry with exponential backoff |
| **supervisor.ts** | Two-phase controller (EXPANSION → COMPETITION) | One-way phase lock, strategy rotation, plateau detection, stopping conditions |
| **state.ts** | Mutable central state (PipelineStateImpl) | Append-only pool, Map-based Elo/match tracking, serialization for checkpoints |
| **elo.ts** | Stateless Elo rating calculations | Adaptive K-factor (48→32→16), confidence weighting, floor at 800 |
| **costTracker.ts** | Budget enforcement with atomic reservation | 30% safety margin, per-agent caps, optimistic concurrency |
| **comparisonCache.ts** | Order-invariant SHA-256 content hash cache | Caches valid results only (skips errors for retry) |
| **diversityTracker.ts** | Pool health analysis (pure, no mutations) | Lineage tracing, strategy diversity, trend computation |
| **featureFlags.ts** | Per-agent feature gates from Supabase | Safe defaults (all enabled), fail-open on DB error |
| **llmClient.ts** | Budget-aware LLM wrapper | Token estimation (~4 chars/token), model pricing table, structured output parsing |
| **logger.ts** | Contextualized structured logging | Tags with subsystem=evolution, runId, agentName |
| **pool.ts** | Stratified opponent selection | Elo quartile-based stratification, pool statistics |
| **validation.ts** | Phase-specific state contract predicates | 6-phase invariant checking, append-only enforcement |

#### Elo System Details
- **Initial rating**: 1200
- **Floor**: 800
- **K-factor schedule**: 48 (≤5 matches), 32 (≤15 matches), 16 (16+ matches)
- **Confidence weighting**: `actualScore = 0.5 + 0.5 * confidence` (1.0 = decisive, 0.0 = draw)
- **Standard formula**: `newRating = max(floor, oldRating + K * (actualScore - expectedScore))`

#### Supervisor Phase Transition
- **EXPANSION → COMPETITION** triggers when: `poolSize ≥ minPool (15)` AND `diversity ≥ diversityThreshold (0.25)`
- **Safety cap**: Forces COMPETITION at `expansionMaxIterations (8)`
- **One-way lock**: Once COMPETITION, never returns to EXPANSION
- **Strategy rotation**: In COMPETITION, cycles through [structural_transform, lexical_simplify, grounding_enhance] one per iteration

#### Budget Configuration
```typescript
DEFAULT_EVOLUTION_CONFIG = {
  maxIterations: 15,
  budgetCapUsd: 5.00,
  budgetCaps: {
    generation: 0.25,  // $1.25 cap
    calibration: 0.20,  // $1.00 cap
    tournament: 0.30,   // $1.50 cap
    evolution: 0.20,    // $1.00 cap
    reflection: 0.05,   // $0.25 cap
  },
}
```

### 4. Database Schema

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `content_evolution_runs` | Tracks evolution attempts | status, phase, config (JSONB), budget_cap_usd, total_cost_usd, runner_id, last_heartbeat |
| `content_evolution_variants` | Stores variants + Elo | variant_content, elo_score, generation, agent_name, quality_scores (JSONB), is_winner |
| `evolution_checkpoints` | Crash recovery | iteration, phase, last_agent, state_snapshot (JSONB) |
| `content_history` | Audit trail | previous_content, new_content, source, evolution_run_id |

### 5. Integration Points

| Integration | Trigger | Direction | Purpose |
|-------------|---------|-----------|---------|
| Admin "Queue" | Manual | UI → DB | Queue new run |
| Admin "Trigger" | Manual | UI → In-process | Execute minimal pipeline |
| Admin "Apply Winner" | Manual | UI → DB + Async eval | Apply variant content |
| Admin "Rollback" | Manual | UI → DB | Revert to previous content |
| Cron Quality Eval | Nightly | Batch → Auto-queue | Discover low-quality articles (score < 0.4) |
| Cron Watchdog | Every 15 min | Check → DB | Recover crashed runners (>10 min stale) |
| Batch Runner | Continuous | Worker → Full pipeline | Execute pending runs |
| Post-evolution eval | Winner applied | Event → Async | Measure quality improvement |

### 6. Test Coverage

| Layer | Files | Status |
|-------|-------|--------|
| Core unit tests | 8 files (elo, state, supervisor, config, costTracker, comparisonCache, diversityTracker, featureFlags) | Complete |
| Agent unit tests | 9 files (all agents + formatValidator) | Complete |
| Integration tests | 3 files (pipeline, infrastructure, actions) | Complete (auto-skip if tables missing) |
| E2E tests | 1 file (admin UI) | Skipped (pending DB migration in CI) |
| Service layer tests | 1 file (evolutionActions) | Partial (mocked Supabase) |

### 7. LLM Model Configuration

| Use Case | Default Model | Price (input/output per 1M tokens) |
|----------|---------------|-------------------------------------|
| Text generation | `deepseek-chat` | $0.00014 / $0.00028 |
| Judge/comparison | `gpt-4.1-nano` | $0.0001 / $0.0004 |
| Config overridable | `gpt-4.1-mini` | $0.0004 / $0.0016 |

### 8. Format Enforcement

All generated text must pass format validation before entering the pool:
- Exactly one H1 title (`# Title`)
- At least one section heading (`##` or `###`)
- No bullet points, numbered lists, or tables
- ≥75% of paragraphs must have 2+ sentences
- Controlled by `FORMAT_VALIDATION_MODE` env var: `reject` (default), `warn`, `off`

---

## Documents Read
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/architecture.md`
- `docs/docs_overall/project_workflow.md`
- `docs/feature_deep_dives/evolution_pipeline.md` (referenced by agents)

## Code Files Read
- `src/lib/evolution/index.ts` — Public API exports
- `src/lib/evolution/config.ts` — Default config + Elo constants
- `src/lib/evolution/types.ts` — Shared interfaces (TextVariation, PipelineState, ExecutionContext, etc.)
- `src/lib/evolution/agents/base.ts` — Abstract AgentBase class
- `src/lib/evolution/agents/generationAgent.ts` — 3-strategy text generation
- `src/lib/evolution/agents/calibrationRanker.ts` — New entrant calibration with bias mitigation
- `src/lib/evolution/agents/pairwiseRanker.ts` — Full-pool pairwise + structured eval
- `src/lib/evolution/agents/tournament.ts` — Swiss-style tournament with budget-adaptive depth
- `src/lib/evolution/agents/evolvePool.ts` — Genetic mutation/crossover/creative exploration
- `src/lib/evolution/agents/reflectionAgent.ts` — 5-dimension critique agent
- `src/lib/evolution/agents/metaReviewAgent.ts` — Pure analysis meta-review
- `src/lib/evolution/agents/proximityAgent.ts` — Diversity/similarity metrics
- `src/lib/evolution/agents/formatRules.ts` — Format specification string
- `src/lib/evolution/agents/formatValidator.ts` — Markdown format validation
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestrator
- `src/lib/evolution/core/supervisor.ts` — Two-phase controller
- `src/lib/evolution/core/state.ts` — Mutable PipelineStateImpl
- `src/lib/evolution/core/elo.ts` — Stateless Elo calculations
- `src/lib/evolution/core/costTracker.ts` — Budget enforcement
- `src/lib/evolution/core/comparisonCache.ts` — Order-invariant match cache
- `src/lib/evolution/core/diversityTracker.ts` — Pool health analysis
- `src/lib/evolution/core/featureFlags.ts` — Supabase feature flags
- `src/lib/evolution/core/llmClient.ts` — Budget-aware LLM wrapper
- `src/lib/evolution/core/logger.ts` — Structured evolution logger
- `src/lib/evolution/core/pool.ts` — Stratified opponent selection
- `src/lib/evolution/core/validation.ts` — State contract validation
- `src/lib/services/evolutionActions.ts` — Server actions
- `src/app/admin/quality/evolution/page.tsx` — Admin UI
- `src/app/api/cron/content-quality-eval/route.ts` — Quality eval cron
- `src/app/api/cron/evolution-watchdog/route.ts` — Watchdog cron
- `scripts/evolution-runner.ts` — Batch worker CLI
- All 17 test files in `src/lib/evolution/` (agents + core)
- 3 integration test files in `src/__tests__/integration/`
- 1 E2E spec in `src/__tests__/e2e/specs/`

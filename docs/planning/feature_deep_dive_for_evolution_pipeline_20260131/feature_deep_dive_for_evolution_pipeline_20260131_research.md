# Feature Deep Dive For Evolution Pipeline Research

## Problem Statement
The evolution pipeline subsystem under `src/lib/evolution/` lacked a feature deep dive document. This is a complex subsystem with 7 agents, a two-phase supervisor, Elo ranking, budget enforcement, and checkpoint/resume — all undocumented beyond inline code comments.

## High Level Summary
The evolution pipeline is an autonomous content improvement system. It takes an existing article, generates text variations via LLM, ranks them using pairwise comparisons with Elo ratings, evolves top performers through mutation/crossover, and converges toward higher quality. The pipeline operates in two phases (EXPANSION to build a diverse pool, COMPETITION to refine it) managed by a PoolSupervisor. It integrates with admin UI, batch scripts, cron jobs, and quality evaluation.

## Documents Read
- `docs/docs_overall/getting_started.md` — doc structure and reading order
- `docs/docs_overall/architecture.md` — system design, data flow, tech stack
- `docs/docs_overall/project_workflow.md` — project lifecycle
- `docs/feature_deep_dives/search_generation_pipeline.md` — format reference for deep dive style

## Code Files Read

### Core infrastructure (`src/lib/evolution/core/`)
- `pipeline.ts` — Pipeline orchestrator (minimal + full modes)
- `supervisor.ts` — PoolSupervisor with phase transitions and stopping conditions
- `state.ts` — PipelineStateImpl with serialization/deserialization
- `elo.ts` — Elo rating update functions (decisive, draw, confidence-weighted)
- `costTracker.ts` — Budget enforcement with per-agent caps
- `pool.ts` — PoolManager with stratified sampling
- `diversityTracker.ts` — Pool health monitoring and recommendations
- `validation.ts` — State contract guards
- `llmClient.ts` — LLM client wrapping callOpenAIModel
- `logger.ts` — Structured logger factory
- `featureFlags.ts` — Feature flag reader

### Agents (`src/lib/evolution/agents/`)
- `base.ts` — Abstract AgentBase
- `generationAgent.ts` — 3-strategy text generation
- `calibrationRanker.ts` — New entrant ranking with bias mitigation
- `pairwiseRanker.ts` — Full pairwise comparison (simple + structured modes)
- `tournament.ts` — Swiss-style tournament with convergence detection
- `evolvePool.ts` — Genetic evolution (mutation, crossover, creative exploration)
- `reflectionAgent.ts` — Dimensional critique of top variants
- `metaReviewAgent.ts` — Meta-analysis of strategy performance
- `proximityAgent.ts` — Diversity/similarity computation
- `formatRules.ts` — Shared format rules for prompts
- `formatValidator.ts` — Format validation (H1, headings, no bullets)

### Top-level
- `src/lib/evolution/index.ts` — Public API re-exports
- `src/lib/evolution/types.ts` — Shared interfaces
- `src/lib/evolution/config.ts` — Default config and Elo constants

### Integration points (via Explore agent)
- `src/lib/services/evolutionActions.ts` — 8 server actions
- `src/app/admin/quality/evolution/page.tsx` — Admin UI
- `scripts/evolution-runner.ts` — Batch runner
- `src/app/api/cron/evolution-watchdog/route.ts` — Stale run watchdog
- `src/app/api/cron/content-quality-eval/route.ts` — Auto-queue cron
- `src/lib/services/contentQualityActions.ts` — Quality comparison
- `.github/workflows/evolution-batch.yml` — Weekly batch workflow
- 4 database migration files for evolution tables
- Integration + E2E test files
- Test helper utilities

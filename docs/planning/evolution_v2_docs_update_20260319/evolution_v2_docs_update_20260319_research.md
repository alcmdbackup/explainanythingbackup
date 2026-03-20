# Evolution V2 Docs Update Research

## Problem Statement
Update the evolution pipeline documentation to reflect evolution v2 changes. The evolution system has undergone significant architectural changes including the unified RankingAgent (merging CalibrationRanker and Tournament), evolution explanations decoupling, and various pipeline improvements. This project will audit all evolution docs under evolution/docs/evolution/ and ensure they accurately reflect the current codebase state.

## Requirements (from GH Issue #TBD)
- Audit all evolution docs in evolution/docs/evolution/ for accuracy against current codebase
- Verify all file references, function names, and code patterns are up to date
- Ensure architectural descriptions match current implementation
- Update any stale references to removed or renamed components

## High Level Summary

**V2 is a complete rewrite of the evolution pipeline.** The entire documentation set (19 docs) describes V1 architecture. V2 replaces V1's 12-agent two-phase system with a simplified 3-operation flat loop. V1 code has been largely removed (agents, pipeline, checkpoint/resume, most UI/services), though V1 utility modules (rating, comparison, format validation) are reused by V2. A clean-slate DB migration (20260315000001) dropped all V1 tables and recreated them for V2.

### V2 Architecture (What's Actually Implemented)
- **3 operations per iteration**: generate → rank → evolve (flat loop, no phases)
- **No EXPANSION/COMPETITION phases** — same 3 operations every iteration
- **No checkpoint/resume** — runs must complete in one execution
- **No AgentBase framework** — flat functions (generateVariants, rankPool, evolveVariants)
- **Simplified config** — flat EvolutionConfig (not nested EvolutionRunConfig)
- **Reuses V1 core modules** — OpenSkill rating, bias-mitigated comparison, format validation

### Doc Accuracy Matrix

| # | Document | Accuracy | Action Needed |
|---|----------|----------|---------------|
| 1 | README.md | PARTIALLY_ACCURATE | Rewrite for V2 reading order |
| 2 | architecture.md | STALE | Complete rewrite for V2 |
| 3 | data_model.md | ACCURATE | Minor updates (remove V1-only refs) |
| 4 | rating_and_comparison.md | ACCURATE | Minor updates (RankingAgent → rankPool) |
| 5 | arena.md | ACCURATE | Minor updates (V2 sync pattern) |
| 6 | cost_optimization.md | ACCURATE | Minor updates (V2CostTracker differences) |
| 7 | entity_diagram.md | ACCURATE | Verify relationships |
| 8 | strategy_experiments.md | PARTIALLY_ACCURATE | Update for V2 experiment system |
| 9 | visualization.md | STALE | Major rewrite (80% of UI removed) |
| 10 | reference.md | PARTIALLY_ACCURATE | Major update (config, files, agents) |
| 11 | minicomputer_deployment.md | ACCURATE | Verify deployment steps |
| 12 | curriculum.md | PARTIALLY_ACCURATE | Update for V2 architecture |
| 13 | experimental_framework.md | ACCURATE | Minor updates |
| 14 | agents/overview.md | STALE | Complete rewrite or delete |
| 15 | agents/generation.md | STALE | Complete rewrite or delete |
| 16 | agents/editing.md | STALE | Delete (no editing agents in V2) |
| 17 | agents/tree_search.md | STALE | Delete (no tree search in V2) |
| 18 | agents/support.md | STALE | Delete (no support agents in V2) |
| 19 | agents/flow_critique.md | STALE | Delete (no flow critique in V2) |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### All Evolution Docs (19 files)
- evolution/docs/evolution/README.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/experimental_framework.md
- evolution/docs/evolution/arena.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/entity_diagram.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/minicomputer_deployment.md
- evolution/docs/evolution/curriculum.md
- evolution/docs/evolution/agents/generation.md
- evolution/docs/evolution/agents/editing.md
- evolution/docs/evolution/agents/tree_search.md
- evolution/docs/evolution/agents/support.md
- evolution/docs/evolution/agents/flow_critique.md

## Code Files Read

### V2 Core (evolution/src/lib/v2/)
- evolve-article.ts — Main orchestrator (generate→rank→evolve loop)
- generate.ts — 3 strategy generation (structural_transform, lexical_simplify, grounding_enhance)
- rank.ts — Triage + Swiss fine-ranking (unified from V1 CalibrationRanker + Tournament)
- evolve.ts — Mutation (clarity/structure), crossover, creative exploration
- finalize.ts — Persist results in V1-compatible format
- runner.ts — Execution lifecycle (claim→resolve→evolve→persist→arena sync)
- arena.ts — Load arena entries into pool, sync results back
- llm-client.ts — LLM wrapper with retry, cost tracking, model pricing
- cost-tracker.ts — Reserve-before-spend budget management
- invocations.ts — Agent invocation tracking
- run-logger.ts — Fire-and-forget structured logging
- strategy.ts — Strategy config hashing/labeling (forked from V1, no Zod)
- seed-article.ts — Generate seed article from topic prompt
- experiments.ts — Create experiments, add runs, compute metrics
- errors.ts — BudgetExceededWithPartialResults
- types.ts — V2Match, EvolutionConfig, EvolutionResult, V2StrategyConfig
- index.ts — Barrel exports

### V1 Core Modules Reused by V2 (evolution/src/lib/core/)
- rating.ts — OpenSkill (Weng-Lin Bayesian) rating: createRating, updateRating, updateDraw, toEloScale
- comparison.ts — compareWithBiasMitigation(), 2-pass reversal bias mitigation
- core/reversalComparison.ts — Generic run2PassReversal() runner
- core/comparisonCache.ts — Order-invariant SHA-256 cache (exported but not used by V2)
- agents/formatValidator.ts — validateFormat() for generated text
- agents/formatRules.ts — FORMAT_RULES constant
- core/textVariationFactory.ts — createTextVariation() factory

### V1 Code Status
- evolution/src/lib/core/ — 33 files remain (utility modules reused by V2)
- evolution/src/lib/agents/ — Only formatValidator.ts and formatRules.ts remain
- evolution/src/lib/treeOfThought/ — REMOVED
- evolution/src/lib/section/ — REMOVED
- evolution/src/lib/diffComparison.ts — REMOVED
- evolution/src/lib/flowRubric.ts — REMOVED

### Services (evolution/src/services/)
- experimentActionsV2.ts — 7 V2 server actions (replaces 17+ V1 actions)
- evolutionRunClient.ts — Client-side fetch wrapper
- evolutionRunnerCore.ts — Runner orchestration (rejects V1 checkpoint resume)
- adminAction.ts — Admin action factory
- shared.ts — ActionResult type, UUID validation
- costAnalytics.ts — LLM cost tracking (not evolution-specific)
- All V1 service files REMOVED (evolutionActions, promptRegistryActions, strategyRegistryActions, arenaActions, evolutionVisualizationActions, variantDetailActions, etc.)

### UI Pages (src/app/admin/evolution/)
- experiments/page.tsx — Experiment list
- experiments/[experimentId]/page.tsx — Experiment detail
- start-experiment/page.tsx — Create experiment wizard
- All other V1 pages REMOVED (runs, variants, invocations, strategies, prompts, arena, dashboard)

### Scripts
- evolution/scripts/evolution-runner.ts — Production batch runner (V2, systemd timer)
- evolution/scripts/evolution-runner-v2.ts — Alternate CLI runner (broken LLM provider, dead code)
- evolution/scripts/run-evolution-local.ts — Local CLI (V2)
- evolution/scripts/deferred/ — Arena utility scripts (moved here)

### Database
- supabase/migrations/20260315000001_evolution_v2.sql — Clean-slate V2 migration (drops all V1 tables)
- Active RPCs: claim_evolution_run, update_strategy_aggregates, sync_to_arena, cancel_experiment
- Dropped RPCs: checkpoint_and_continue, apply_evolution_winner, get_non_archived_runs, archive/unarchive_experiment

### Tests
- 17 V2 core test files (197 test cases) — all V2 code
- 14 UI component test files (107 test cases) — shared components
- 6 service test files (78 test cases) — mixed V1/V2
- 0 integration/E2E test files remaining

## Key Findings

1. **V2 is a complete rewrite** — 3-operation flat loop replaces V1's 12-agent two-phase system
2. **All 19 doc files describe V1** — none mention V2 concepts (evolveArticle, flat loop, etc.)
3. **10 of 19 docs are STALE** — describe components that no longer exist (agents, phases, checkpoint/resume)
4. **V1 utility modules are reused** — rating, comparison, format validation unchanged and accurately documented
5. **80% of V1 UI removed** — only 3 experiment pages remain out of 15+ documented pages
6. **Server actions consolidated** — 7 V2 actions replace 44+ V1 actions across 4 files
7. **Clean-slate DB migration** — all V1 data dropped, V2 schema simplified
8. **No V1→V2 migration docs exist** — no deprecation markers or migration guides
9. **agents/ subdirectory should be deleted or consolidated** — 5 of 6 agent docs describe non-existent agents
10. **V2 reuses V1-compatible persistence format** — finalizeRun() writes V1-shaped run_summary/variants

## V2 Pipeline Detail (Rounds 5-6)

### V2 Iteration Loop (evolve-article.ts)
```
for iter = 1 to config.iterations:
  1. Kill detection (check run status in DB)
  2. generateVariants() → 3 strategies in parallel (structural_transform, lexical_simplify, grounding_enhance)
  3. rankPool() → triage new entrants (stratified opponents, adaptive early exit) + Swiss fine-ranking
  4. Record muHistory (top-K mu values)
  5. Check convergence (2 consecutive rounds all sigmas < threshold)
  6. evolveVariants() → mutate_clarity, mutate_structure, crossover, creative_exploration
  7. Budget check (BudgetExceededError breaks loop)
Winner: highest mu, tie-break lowest sigma
Stop reasons: iterations_complete | killed | converged | budget_exceeded
```

### V2 Runner Lifecycle (runner.ts)
1. Start heartbeat (30s interval)
2. Mark run as 'running'
3. resolveConfig(): V1 DB config → V2 flat EvolutionConfig (maxIterations→iterations, budgetCapUsd→budgetUsd)
4. resolveContent(): explanation_id → fetch text OR prompt_id → generateSeedArticle()
5. upsertStrategy(): hash-based dedup, auto-label
6. loadArenaEntries(): inject top entries into initial pool with pre-set ratings
7. evolveArticle() with initialPool
8. finalizeRun(): persist in V1-compatible format (run_summary v3, evolution_variants)
9. syncToArena(): new variants + match results via sync_to_arena RPC

### V2 Ranking Algorithm (rank.ts)
- **Triage**: Stratified opponents (2 top, 2 mid, 1 bottom/new for n=5), adaptive early exit (confidence>=0.7), top-20% cutoff elimination (mu+2σ < cutoff)
- **Fine-ranking**: Swiss pairing via Bradley-Terry outcome uncertainty × sigma weight, budget pressure tiers (low:40, medium:25, high:15 max comparisons), convergence after 2 consecutive rounds
- **Constants**: CALIBRATED_SIGMA_THRESHOLD=5.0, DECISIVE_CONFIDENCE=0.7, AVG_CONFIDENCE_THRESHOLD=0.8, MIN_TRIAGE_OPPONENTS=2

### V2 Cost Tracking (cost-tracker.ts + llm-client.ts)
- Reserve-before-spend with RESERVE_MARGIN=1.3x
- Model pricing: gpt-4.1-nano ($0.10/$0.40), gpt-4.1-mini ($0.40/$1.60), deepseek-chat ($0.27/$1.10), etc.
- Retry: MAX_RETRIES=3, backoff 1s/2s/4s, PER_CALL_TIMEOUT=60s
- Token estimation: chars/4, output estimates: generation=1000, ranking=100

### V2 Arena Integration (arena.ts)
- loadArenaEntries(): non-archived entries with fromArena=true flag, default mu=25/sigma=8.333
- syncToArena(): filters out arena entries, maps V2Match → {entry_a, entry_b, winner:'a'|'draw'}, generation_method='pipeline'

### V2 Experiments (experiments.ts)
- createExperiment(name, promptId): validates 1-200 chars
- addRunToExperiment(): transitions draft→running on first run, rejects completed/cancelled
- computeExperimentMetrics(): aggregates maxElo, totalCost, per-run eloPerDollar from winner variants

## V1 Core Module Usage (Round 7)

### Actively Used by V2 (Category A)
- core/rating.ts — OpenSkill rating (5+ V2 files import)
- comparison.ts — 2-pass bias-mitigated comparison (used by rank.ts)
- core/reversalComparison.ts — Generic reversal runner (used by comparison.ts)
- core/textVariationFactory.ts — createTextVariation() (used by generate, evolve, evolve-article)
- agents/formatValidator.ts — validateFormat() (used by generate, evolve)
- agents/formatRules.ts — FORMAT_RULES constant (used by generate, evolve, seed-article)
- core/errorClassification.ts — isTransientError() (used by llm-client)

### Dead Code in V1 Core (Category B — candidates for cleanup)
- core/configValidation.ts — 0 runtime calls
- core/budgetRedistribution.ts — only used by other dead code
- core/agentToggle.ts — 0 runtime calls
- core/jsonParser.ts — 0 runtime calls
- core/validation.ts — 0 runtime calls
- core/seedArticle.ts — V2 has own seed-article.ts
- core/costEstimator.ts — exported but never called

### V1-Only (used by old runner path in evolutionRunnerCore.ts)
- core/costTracker.ts, core/llmClient.ts, core/logger.ts

## V2 Database Schema (Round 7)

### Migration 20260315000001 (Clean-Slate)
- Drops all V1 tables (13+), RPCs (9+), views (8)
- Creates 10 V2 tables: strategy_configs, arena_topics, experiments, runs, variants, agent_invocations, run_logs, arena_entries, arena_comparisons, arena_batch_runs
- Creates 4 RPCs: claim_evolution_run, update_strategy_aggregates, sync_to_arena, cancel_experiment
- 18 indexes, default-deny RLS policies
- New fields: pipeline_version='v2', archived boolean on runs, status CHECK constraints simplified

## Additional Findings (Round 8)

### Main App Doc References
- docs/docs_overall/architecture.md — Evolution links are accurate (line 100, 103-105, 157-162)
- docs/docs_overall/getting_started.md — Evolution link accurate (line 17)
- .claude/doc-mapping.json — Has extensive evolution mappings that need updating for V2 file paths

### Stale Cron References in Evolution Docs
- reference.md line 95: References removed quality eval cron
- strategy_experiments.md lines 33, 88, 129: References removed cron driver (now batch runner housekeeping)
- architecture.md line 239: "auto-queue cron" language needs updating

### Minicomputer Deployment Discrepancies
- Doc says DEEPSEEK_API_KEY required; runner actually requires OPENAI_API_KEY
- Doc lists PINECONE variables as required; runner doesn't validate them
- Missing --parallel and --max-concurrent-llm CLI args in doc
- evolution-runner-v2.ts exists but is dead code (broken LLM provider)

### Test Infrastructure
- 37 test files, 382 total test cases (197 V2 core + 107 UI + 78 services)
- E2E seeds are V2-compatible (use upsert pattern, V2 schema)
- evolution/src/testing/ has V2-compatible helpers (dual-column migration support)
- No V1 imports remain in src/ — fully migrated to V2

## Open Questions

1. Should V1 agent docs be archived or deleted entirely?
2. Should architecture.md be rewritten from scratch or restructured with V1 as "historical" appendix?
3. What level of detail should V2 docs have? (V1 docs are extremely detailed; V2 is much simpler)
4. Should the README reading order be completely rewritten?
5. Should visualization.md be rewritten to only cover the 3 remaining experiment pages?
6. Should .claude/doc-mapping.json be updated with V2 file paths?
7. Should dead V1 core code be cleaned up as part of this docs project or separately?

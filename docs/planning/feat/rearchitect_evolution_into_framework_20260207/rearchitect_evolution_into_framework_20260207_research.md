# Rearchitect Evolution Into Framework Research

## Problem Statement
Systematically rework the evolution pipeline into a new framework built around core primitives: prompt, strategy (run config), run, hall of fame, pipeline type, agent, and article. The key relationship is prompt + strategy = run, with every run feeding its top 3 outputs into a hall of fame. This enables multi-dimensional dashboards that slice by prompt, strategy, run, pipeline type, agent, and article, with clear units of analysis (run, article, task — where task is an agent operating on an article). The goal is to move from the current monolithic evolution system to a composable, analyzable framework where every dimension is a first-class entity.

## Framework Goals

The framework must be a robust, systematic system that enables three reinforcing capabilities:

### 1. Structured Generation
The framework must produce content through well-defined, reproducible pipelines. Every generation run is the product of a specific prompt × strategy combination, executed by a known pipeline type with configured agents. This structure makes every output traceable to its inputs and configuration, eliminating ad-hoc or one-off generation.

### 2. Robust Analysis
Every dimension (prompt, strategy, run, pipeline type, agent, article) must be a first-class queryable entity. Dashboards can slice and compare across any dimension: "How does strategy X perform across all prompts?", "Which agents contribute the most Elo gain per dollar?", "What's the best pipeline type for hard prompts?". The units of analysis (run, article, task) provide the granularity needed for statistical rigor — not just aggregate metrics but per-task attribution.

### 3. Iteration Based on Findings
Analysis outputs must feed back into generation. When analysis reveals that a strategy underperforms on hard prompts, or that a particular agent consistently degrades quality, those findings should directly inform the next round of strategies and pipeline configurations. The hall of fame accumulates the best outputs across runs, enabling cross-generation comparison and regression detection. The loop is: generate → analyze → adjust strategies/prompts/agents → generate again.

## Key Requirements

### Enforced Pre-defined Strategies and Prompts
Every run must reference a pre-defined strategy and a pre-defined prompt. Neither can be created on the fly at run-trigger time — they must be selected from an existing set managed through an admin UI or seed script.

**Current state (gap analysis):**
- `queueEvolutionRunAction` accepts only `{ explanationId, budgetCapUsd? }` — no strategy or prompt reference. Config is resolved at runtime via `resolveConfig()` merging `DEFAULT_EVOLUTION_CONFIG` with ad-hoc JSONB overrides.
- The CLI runner (`run-evolution-local.ts`) accepts `--prompt` or `--file` as free-form input — no validation against a prompt registry.
- `strategy_configs` table exists (from elo_budget_optimization) with a hash-based identity, but strategies are auto-created from run configs, not pre-defined.
- `article_bank_topics` serves as a de facto prompt registry (case-insensitive unique on `LOWER(TRIM(prompt))`), but it's not enforced at run-trigger time.
- `promptBankConfig.ts` has 5 hardcoded prompts, but these are config-level constants, not DB entities.

**Implication for framework:**
- Need a `prompts` table (or repurpose `article_bank_topics`) as a first-class registry. Runs must FK to a prompt ID.
- Need a `strategies` table (or repurpose/formalize `strategy_configs`) as a first-class registry. Runs must FK to a strategy ID.
- `queueEvolutionRunAction` signature changes to `{ promptId, strategyId }` — no more ad-hoc config.
- CLI runner must validate `--prompt` against the registry (or accept `--prompt-id`).
- Admin UI needs CRUD for managing the prompt and strategy registries before triggering runs.

### Unified Dimensional View
A single dashboard page where users can slice by one or multiple dimensions (prompt, strategy, pipeline type, agent) and view results in a chosen unit of analysis (run, article, or task). Today's dashboards are completely siloed — each page queries one dimension in isolation with no cross-dimensional filtering.

**Current state (gap analysis):**

**Evolution dashboard architecture**: A separate evolution dashboard exists at `/admin/evolution-dashboard` (PR #367), with its own sidebar (`EvolutionSidebar.tsx`, 6 nav items) and overview page (stat cards + quick-link cards). The `SidebarSwitcher.tsx` conditionally renders the evolution sidebar for any path under `/admin/quality/` or `/admin/evolution-dashboard/`, using the main `AdminSidebar.tsx` for all other admin paths. This means new pages added under `/admin/quality/` automatically get the evolution sidebar without `SidebarSwitcher` changes — but the sidebar's `navItems` array and the overview page's QuickLinkCards must be updated to include new pages.

**Current evolution sidebar nav items** (6): Overview, Pipeline Runs, Ops Dashboard, Elo Optimization, Article Bank, Quality Scores.

**Current evolution dashboard stat cards** (6): Last Completed Run, 7d Success Rate, Monthly Spend, Article Bank Size, Avg Elo/$, Failed Runs (7d).

**Key files**: `src/components/admin/EvolutionSidebar.tsx`, `src/components/admin/SidebarSwitcher.tsx`, `src/components/admin/BaseSidebar.tsx`, `src/app/admin/evolution-dashboard/page.tsx`.

6 separate dashboard pages exist (5 under quality + 1 overview), each locked to one dimension:

| Page | URL | Primary Dimension | Cross-Dimensional Filters |
|------|-----|-------------------|--------------------------|
| Run Management | `/admin/quality/evolution` | Runs | Status + date only; no strategy/prompt/agent filters |
| Ops Dashboard | `/admin/quality/evolution/dashboard` | Runs (timeseries) | None; pure read-only charts |
| Elo Optimization | `/admin/quality/optimization` | Strategies + Agents | Tab switching only; cannot click strategy → see runs |
| Article Bank | `/admin/quality/article-bank` | Topics + Entries | None; topics siloed from runs/strategies |
| Run Detail | `/admin/quality/evolution/run/[runId]` | Single run (6 tabs) | Scoped to one run; no comparison with other runs |
| Evolution Overview | `/admin/evolution-dashboard` | Aggregate stats | Quick links to other pages; no filtering or dimensional slicing |

Server actions reinforce the siloing:
- `evolutionVisualizationActions.ts`: 8 actions, each takes one `runId` — no cross-run comparison or filtering
- `eloBudgetActions.ts`: Strategy/agent aggregates with no run linkage in UI (`getStrategyRunsAction` exists but is not wired to the optimization page)
- `articleBankActions.ts`: Topic/entry aggregates completely siloed from runs/strategies (entries store `evolution_run_id` in metadata but the UI doesn't use it for cross-linking)

**Cross-unit navigation gap:** Current dashboards have no inter-unit linking. The run detail page shows agent metrics in a tab but doesn't link to individual articles produced by each agent. The article bank shows entries but doesn't link back to the run or agent that produced them. Agent metrics exist in `evolution_run_agent_metrics` but are only accessible from the single-run detail view. There is no way to click an agent name and see all its tasks across runs, or click an article and see the agent debug data for how it was created.

**Implication for framework:**
- Need a unified server action that accepts multi-dimensional filters: `{ promptIds?, strategyIds?, pipelineTypes?, agentNames?, dateRange? }`
- Need a unified UI with dimension selectors (dropdown/chip filters) and unit-of-analysis toggle (run view, article view, task view)
- Need cross-unit drill-down: every entity (run, article, agent/task) must link to the other two units. Run → shows tasks + articles. Article → links to creating task + run. Task → links to input/output articles + run. Agent name is a universal link to that agent's tasks across all runs.
- **Article visibility**: Every unit of analysis must show its input and output articles. Article view queries ALL variants from `content_evolution_variants` (not just hall-of-fame top 3 from `article_bank_entries`). Run view shows articles at each iteration stage. Task view shows the agent's input → output articles. The data is already available — `content_evolution_variants` stores `agent_name` (who created it), `parent_variant_id` (input article), and `generation`/iteration (when in the pipeline). Currently this data is only used within single-run detail views; the unified explorer surfaces it across runs.
- Existing server actions remain for detail pages; the unified action powers the explorer
- The dimensional data model from Phases 1-4 (prompt FK, strategy FK, pipeline type column) provides the queryable columns this view needs
- **Evolution dashboard navigation updates needed**: `EvolutionSidebar.tsx` must be updated to include 3 new nav items (Explorer, Prompt Registry, Strategies) — growing from 6 to 9 items. The evolution dashboard overview page must add corresponding QuickLinkCards and potentially new stat cards (e.g., prompt count, strategy count). `SidebarSwitcher.tsx` does NOT need changes since new pages are under `/admin/quality/` which already triggers the evolution sidebar.

### Per-Agent Debug Data Inventory
Each agent produces rich intermediate data beyond just variants. Most of this data already exists in checkpoint JSONB blobs but is not queryable or visualizable from the admin UI.

**Data already in checkpoints (extractable without schema changes):**

| Agent | Debug Artifacts | PipelineState Field | Notes |
|-------|----------------|--------------------|----|
| CalibrationRanker | Pairwise match results, rating deltas, opponent selection | `matchHistory[]`, `ratings`, `matchCounts` | Each match has confidence, dimension scores, winner |
| Tournament | Swiss-style matches, OpenSkill updates | `matchHistory[]`, `ratings` | Tournament round structure is ephemeral (not persisted) |
| ReflectionAgent | Dimensional critiques (1-10 per dimension), good/bad examples | `allCritiques[]` | 5 dimensions: clarity, structure, engagement, precision, coherence |
| DebateAgent | Full 3-turn debate transcripts (Advocate A, Advocate B, Judge) | `debateTranscripts[]` | Each has `turns[]` array + synthesis variant link |
| MetaReviewAgent | Strategy effectiveness analysis, priority improvements | `metaFeedback{}` | `successfulStrategies[]`, `patternsToAvoid[]`, `recurringWeaknesses[]` |
| ProximityAgent | Pairwise similarity matrix, diversity score | `similarityMatrix`, `diversityScore` | Sparse matrix (new vs existing only) |
| TreeSearchAgent | Full beam search tree (nodes, edges, pruning), best path | `treeSearchResults[]`, `treeSearchStates[]` | TreeNode has `value`, `revisionAction`, `pruned`, `childNodeIds[]` |
| SectionDecompositionAgent | H2 sections parsed, per-section edit verdicts | `sectionState{}` | `sections[]` with heading/body, `bestVariations[]` with accept/reject |
| OutlineGenerationAgent | Step-level scores (outline→expand→polish→verify) | `pool[]` (as OutlineVariant) | `.steps[].score` (0-1), `.weakestStep` for mutation targeting |

**Data that is ephemeral (lost after execution, not in checkpoints):**

| Agent | Lost Data | What Would Need Persistence |
|-------|-----------|---------------------------|
| IterativeEditingAgent | Edit target selection, judge accept/reject verdicts per cycle, consecutive rejection count | Per-cycle audit log: `{ target, verdict, confidence, cycleNumber }` |
| Tournament | Swiss pairing decisions, sigma convergence checks, budget pressure tier | Per-round metadata: `{ round, pairsSelected, convergenceDelta, budgetPressure }` |
| SectionDecompositionAgent | Per-section judge verdicts (only aggregate stored) | Already partially in `sectionState.bestVariations[]`, but raw verdicts lost |

**LLM call tracking (`llmCallTracking` table):**
- Every LLM call logged with `call_source` field tagged by agent (e.g., `evolution_reflection`, `evolution_debate`)
- Contains: model, tokens (prompt + completion), estimated_cost_usd, created_at
- **Gap**: Not linked to specific variants or iterations — only to agent type and time window

## High Level Summary

The current evolution system has strong foundations but lacks the explicit primitive-to-primitive linkages the framework requires. Here are the key findings organized by framework goal:

### Current State of Core Primitives

**Prompt** — No first-class entity. Prompts exist as: (a) free-text strings in CLI flags, (b) `article_bank_topics.prompt` with case-insensitive uniqueness, (c) 5 hardcoded entries in `promptBankConfig.ts`. No run-level FK to a prompt. The `explanations` table serves as the article-to-evolve source, but there's no "topic → run" linkage outside the article bank.

**Strategy** — Proto-entity exists. `strategy_configs` table stores deduplicated configs via SHA-256 hash with aggregated metrics (avg Elo, Elo/$, stddev). `EvolutionRunConfig` defines the runtime shape (iterations, budget, model choices, agent caps). Strategies are auto-created from run configs via `linkStrategyConfig()` — not pre-defined. Runs FK to `strategy_config_id` (nullable, linked post-hoc).

**Run** — Well-defined lifecycle. `content_evolution_runs` tracks status (pending→claimed→running→completed/failed/paused), config JSONB, cost, phase, iteration. 8 entry points exist (admin UI, cron, CLI, batch, auto-queue). Checkpoint/resume via `evolution_checkpoints` table. Run summary persisted as JSONB.

**Article** — Dual representation. In-memory `TextVariation` (with `parentIds[]` for DAG lineage) and DB `content_evolution_variants` (single `parent_variant_id`). Only `is_winner=true` for the top variant. Article bank entries (`article_bank_entries`) store cross-run articles with Elo ratings.

**Agent** — Well-abstracted. `AgentBase` abstract class with 12 implementations. `PipelineAgents` record with named slots. Per-agent metrics in `evolution_run_agent_metrics`. Feature flags gate optional agents. No agent registry table — agents are code-level entities.

**Pipeline Type** — Implicit only. Two execution functions exist (`executeFullPipeline` with supervisor, `executeMinimalPipeline` without), but no DB entity or dashboard dimension. The distinction is code-level, not data-level.

**Hall of Fame** — Proto-entity exists as article bank. `article_bank_topics` + `article_bank_entries` + `article_bank_elo` + `article_bank_comparisons`. Currently only the single winner enters the bank (not top 3). Swiss-style Elo comparisons within topics. 5×12 prompt bank coverage matrix.

### Gap Analysis for Framework Goals

**G-1 (Structured Generation) Gaps:**
- No prompt → run FK (runs reference `explanation_id`, not a prompt)
- Strategy created post-hoc, not pre-selected
- Pipeline type not recorded as metadata
- `queueEvolutionRunAction({ explanationId, budgetCapUsd? })` allows ad-hoc config
- 3 of 5 entry points missing `TreeSearchAgent` (inconsistent agent sets)

**G-2 (Robust Analysis) Gaps:**
- **By Prompt**: NOT SUPPORTED as dashboard dimension. Article bank provides per-topic comparison but evolution dashboards don't slice by prompt.
- **By Pipeline Type**: NOT SUPPORTED. No way to compare full vs minimal vs batch runs.
- **By Strategy**: SUPPORTED via optimization dashboard (leaderboard, Pareto frontier, run history).
- **By Agent**: SUPPORTED via agent ROI leaderboard and per-run timeline.
- **By Run**: SUPPORTED via run management + 6-tab detail view.
- **By Article**: SUPPORTED via article bank leaderboard and match history.
- Task-level (agent × article): PARTIALLY SUPPORTED. Per-run agent metrics exist; per-iteration agent metrics computed on-the-fly from checkpoints.

**G-3 (Iteration Based on Findings) Gaps:**
- `MetaReviewAgent` provides intra-run feedback but no cross-run learning
- Adaptive allocation exists (`adaptiveAllocation.ts`) but not integrated into run triggering
- No mechanism to flag underperforming strategies/prompts and feed into next run
- Hall of fame only stores single winner, not top 3

### Database Schema Inventory

15+ evolution-related tables across migrations from 2026-01-16 to 2026-02-06:
- **Core**: `content_evolution_runs`, `content_evolution_variants`, `evolution_checkpoints`
- **Article Bank**: `article_bank_topics`, `article_bank_entries`, `article_bank_comparisons`, `article_bank_elo`
- **Metrics**: `evolution_run_agent_metrics`, `agent_cost_baselines`, `strategy_configs`
- **Batch**: `batch_runs`
- **Quality**: `content_history`, `content_quality_scores`, `content_eval_runs`
- **Infrastructure**: `feature_flags`, `llmCallTracking`

### Dimension Support Matrix

| Dimension | Supported? | Where? |
|-----------|-----------|--------|
| By Prompt | No | Article Bank only (separate system) |
| By Strategy | Yes | Optimization dashboard |
| By Run | Yes | Run management + detail pages |
| By Pipeline Type | No | Not exposed |
| By Agent | Yes | Optimization + timeline |
| By Article | Yes | Article Bank |
| By Iteration | Yes | Timeline tab (per-run only) |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/elo_budget_optimization.md
- docs/feature_deep_dives/comparison_infrastructure.md
- docs/feature_deep_dives/evolution_pipeline_visualization.md
- docs/feature_deep_dives/hierarchical_decomposition_agent.md
- docs/feature_deep_dives/iterative_editing_agent.md
- docs/feature_deep_dives/tree_of_thought_revisions.md
- docs/feature_deep_dives/outline_based_generation_editing.md
- docs/feature_deep_dives/admin_panel.md

## Code Files Read

### Core Types & Config
- `src/lib/evolution/types.ts` — TextVariation, EvolutionRunConfig, ExecutionContext, PipelineState, EvolutionRunSummary
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig()
- `src/lib/evolution/index.ts` — createDefaultAgents(), preparePipelineRun()
- `src/config/promptBankConfig.ts` — 5 prompts × 6 methods matrix
- `src/config/batchRunSchema.ts` — BatchConfig schema and expansion

### Pipeline Orchestration
- `src/lib/evolution/core/pipeline.ts` — executeFullPipeline, executeMinimalPipeline, finalizePipelineRun, persistVariants, persistAgentMetrics, linkStrategyConfig
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor, PhaseConfig, EXPANSION→COMPETITION
- `src/lib/evolution/core/state.ts` — PipelineStateImpl, serializeState, deserializeState
- `src/lib/evolution/core/strategyConfig.ts` — StrategyConfig, hashStrategyConfig, extractStrategyConfig

### Core Infrastructure
- `src/lib/evolution/core/rating.ts` — OpenSkill rating, createRating, updateRating, getOrdinal
- `src/lib/evolution/core/costTracker.ts` — CostTrackerImpl, reserveBudget, recordSpend
- `src/lib/evolution/core/llmClient.ts` — createEvolutionLLMClient, estimateTokenCost
- `src/lib/evolution/core/costEstimator.ts` — estimateRunCost, getAgentBaseline, refreshAgentCostBaselines
- `src/lib/evolution/core/adaptiveAllocation.ts` — computeAdaptiveBudgetCaps, getAgentROILeaderboard
- `src/lib/evolution/core/comparisonCache.ts` — ComparisonCache
- `src/lib/evolution/core/pool.ts` — PoolManager, stratified sampling
- `src/lib/evolution/core/diversityTracker.ts` — PoolDiversityTracker
- `src/lib/evolution/core/validation.ts` — validateStateContracts
- `src/lib/evolution/core/featureFlags.ts` — fetchEvolutionFeatureFlags
- `src/lib/evolution/core/logger.ts` — createEvolutionLogger

### Agents (12 total)
- `src/lib/evolution/agents/base.ts` — AgentBase abstract class
- `src/lib/evolution/agents/generationAgent.ts` — 3 strategies (structural, lexical, grounding)
- `src/lib/evolution/agents/calibrationRanker.ts` — Stratified calibration with adaptive early exit
- `src/lib/evolution/agents/tournament.ts` — Swiss-style tournament with OpenSkill
- `src/lib/evolution/agents/evolvePool.ts` — Genetic operators (mutate, crossover, creative)
- `src/lib/evolution/agents/reflectionAgent.ts` — 5-dimension critique
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Edit-judge loop (3 cycles)
- `src/lib/evolution/agents/treeSearchAgent.ts` — Beam search (K=3, B=3, D=3)
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` — H2-level section editing
- `src/lib/evolution/agents/debateAgent.ts` — 3-turn debate + synthesis
- `src/lib/evolution/agents/proximityAgent.ts` — Diversity via cosine similarity
- `src/lib/evolution/agents/metaReviewAgent.ts` — Pure analysis (no LLM)
- `src/lib/evolution/agents/outlineGenerationAgent.ts` — Outline→expand→polish→verify

### Tree-of-Thought Module
- `src/lib/evolution/treeOfThought/types.ts` — TreeNode, RevisionAction, BeamSearchConfig
- `src/lib/evolution/treeOfThought/beamSearch.ts` — Core beam search algorithm
- `src/lib/evolution/treeOfThought/evaluator.ts` — Two-stage evaluation (filter + rank)
- `src/lib/evolution/treeOfThought/revisionActions.ts` — Action selection and prompt building
- `src/lib/evolution/treeOfThought/treeNode.ts` — Tree construction and traversal

### Entry Points (8 total)
- `src/lib/services/evolutionActions.ts` — queueEvolutionRunAction, triggerEvolutionRunAction, applyWinnerAction
- `scripts/evolution-runner.ts` — Batch runner with atomic claim and heartbeat
- `scripts/run-evolution-local.ts` — CLI with --prompt, --file, --bank, --mock flags
- `scripts/run-batch.ts` — Batch experiment matrix expansion
- `src/app/api/cron/evolution-runner/route.ts` — Vercel cron handler
- `src/app/api/cron/evolution-watchdog/route.ts` — Stale heartbeat detection
- `src/app/api/cron/content-quality-eval/route.ts` — Auto-queue for low-scoring articles

### Article Bank & Comparisons
- `src/lib/services/articleBankActions.ts` — addToBankAction, runBankComparisonAction, coverage matrix
- `scripts/lib/bankUtils.ts` — addEntryToBank shared logic
- `scripts/lib/oneshotGenerator.ts` — Title + article generation
- `scripts/run-prompt-bank.ts` — Batch coverage filling

### Dashboard & Visualization
- `src/lib/services/evolutionVisualizationActions.ts` — 8 read-only visualization actions
- `src/lib/services/eloBudgetActions.ts` — Strategy leaderboard, agent ROI, Pareto
- `src/app/admin/evolution-dashboard/page.tsx` — Overview dashboard
- `src/app/admin/quality/evolution/page.tsx` — Run management
- `src/app/admin/quality/evolution/dashboard/page.tsx` — Ops dashboard
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail (6 tabs)
- `src/app/admin/quality/optimization/page.tsx` — Elo budget optimization
- `src/app/admin/quality/article-bank/page.tsx` — Article bank topics
- `src/app/admin/quality/article-bank/[topicId]/page.tsx` — Topic detail (4 tabs)
- `src/app/admin/evolution-dashboard/page.tsx` — Evolution dashboard overview (stat cards + quick links)
- `src/components/admin/EvolutionSidebar.tsx` — Evolution sidebar navigation (6 nav items, BaseSidebar wrapper)
- `src/components/admin/SidebarSwitcher.tsx` — Conditional sidebar rendering (evolution vs main admin, path-based)
- `src/components/admin/BaseSidebar.tsx` — Shared sidebar rendering component

### Database Migrations
- `supabase/migrations/20260131000001_content_evolution_runs.sql`
- `supabase/migrations/20260131000002_content_evolution_variants.sql`
- `supabase/migrations/20260131000003_evolution_checkpoints.sql`
- `supabase/migrations/20260131000008_evolution_runs_optional_explanation.sql`
- `supabase/migrations/20260131000009_variants_optional_explanation.sql`
- `supabase/migrations/20260131000010_add_evolution_run_summary.sql`
- `supabase/migrations/20260201000001_article_bank.sql`
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql`
- `supabase/migrations/20260205000002_add_variant_cost.sql`
- `supabase/migrations/20260205000003_add_agent_cost_baselines.sql`
- `supabase/migrations/20260205000004_add_batch_runs.sql`
- `supabase/migrations/20260205000005_add_strategy_configs.sql`
- `supabase/migrations/20260116064944_create_feature_flags.sql`
- `supabase/migrations/20260131000007_evolution_feature_flags_seed.sql`
- `supabase/migrations/20260131000004_content_history.sql`
- `supabase/migrations/20260131000005_content_quality_scores.sql`
- `supabase/migrations/20260131000006_content_eval_runs.sql`

### Cost Tracking
- `src/config/llmPricing.ts` — LLM_PRICING table, calculateLLMCost
- `src/lib/services/llms.ts` — callOpenAIModel, callAnthropicModel, saveLlmCallTracking

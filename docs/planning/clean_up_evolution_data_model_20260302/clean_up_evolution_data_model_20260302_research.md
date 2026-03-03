# Clean Up Evolution Data Model Research

## Problem Statement
Analyze and clean up the existing data model for the evolution pipeline. This may be part of a rework of the admin dashboard, or that may come later.

## Requirements (from GH Issue #TBD)
To be determined during research phase.

## High Level Summary

The evolution data model spans **17 tables**, **~60 TypeScript types**, **14+ server actions** across 9 service files, and **45+ UI components**. Research with 8 parallel agents across 2 rounds uncovered significant cleanup opportunities in 6 categories:

1. **Dead/redundant DB columns** — `quality_scores`, `cost_estimate_detail`, `continuation_count`, `runner_id` are never displayed in UI
2. **Elo→Ordinal terminology migration ~70% complete** — DB column `elo_score` still uses old name; TypeScript interfaces mix conventions
3. **JSONB overuse** — 11 JSONB columns, some candidates for normalization (cost_prediction, elo_attribution)
4. **Query inefficiency** — SELECT *, N+1 lineage walks, duplicate prompt/strategy lookups across services
5. **Data consistency risks** — no validation that `total_cost_usd = SUM(invocation costs)`, orphaned Hall of Fame FK references
6. **Dashboard-model mismatches** — variants scattered across 3 pages, no strategy/prompt detail pages, cost data fragmented across 4 views

---

## Conceptual Data Model

**Core equation: `Run = Prompt + Strategy + (optional Explanation)`**

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ORCHESTRATION LAYER                         │
│                                                                    │
│  ┌──────────────┐    contains    ┌───────────────┐                 │
│  │  Experiment   │──────────────▶│    Round       │                 │
│  │              │   1:many      │ (factor combo) │                 │
│  └──────────────┘               └───────┬───────┘                 │
│                                         │ spawns                   │
│  ┌──────────────┐    contains           ▼                         │
│  │  Batch        │──────────────▶┌─────────────┐                  │
│  │              │   1:many      │             │                   │
│  └──────────────┘               │     RUN     │                   │
│                                 │             │                   │
└─────────────────────────────────┤             ├───────────────────┘
                                  └──────┬──────┘
                                         │
          ┌──────────────────────────────┼──────────────────────┐
          │                              │                      │
          ▼                              ▼                      ▼
   ┌─────────────┐              ┌──────────────┐       ┌──────────────┐
   │   Prompt     │              │   Strategy    │       │  Explanation  │
   │ (topic/text) │              │ (agents +     │       │ (seed article)│
   │             │              │  models +     │       │   optional    │
   └─────────────┘              │  budget +     │       └──────────────┘
         │                      │  iterations)  │
         │                      └──────────────┘
         │
         │  groups
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          RUN INTERNALS                             │
│                                                                    │
│  Run ──produces──▶ Variants (append-only pool)                     │
│    │                  │                                            │
│    │                  ├── parent lineage (within-run only)          │
│    │                  ├── Elo rating (mu/sigma → ordinal)           │
│    │                  └── creator agent + strategy label            │
│    │                                                               │
│    ├── Invocations (per agent × per iteration)                     │
│    │       └── cost_usd, execution_detail, attribution             │
│    │                                                               │
│    ├── Checkpoints (state snapshots for pause/resume)              │
│    │                                                               │
│    └── Logs (structured, per-agent/iteration)                      │
│                                                                    │
│  Pipeline phases: EXPANSION → COMPETITION → stop                   │
│  Agents run per iteration: generation, calibration, tournament,    │
│    evolution, reflection, debate, iterativeEditing, treeSearch,     │
│    sectionDecomposition, outlineGeneration, proximity, metaReview   │
│                                                                    │
└─────────────────────────────────────────────────────────────────────┘
          │
          │ top 2 winners feed into
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        HALL OF FAME                                 │
│                                                                    │
│  Topic (= Prompt)                                                  │
│    └── Entries (articles: oneshot / evolution_winner / baseline)    │
│          ├── Elo Rating (mu/sigma/ordinal per entry per topic)     │
│          └── Comparisons (head-to-head matches between entries)    │
│                                                                    │
│  Purpose: compare generation METHODS across the same prompt        │
│                                                                    │
└─────────────────────────────────────────────────────────────────────┘
```

| Concept | What it is | Key relationships |
|---------|-----------|-------------------|
| **Prompt** | A topic/question to generate content about | Groups runs; maps 1:1 to HoF Topic |
| **Strategy** | Config template: which agents, models, budget, iterations | Hash-deduped; many runs can share one |
| **Explanation** | An existing article (seed text for evolution) | Optional — prompt-based runs generate their own seed |
| **Run** | Single pipeline execution producing ranked variants | Links to exactly 1 prompt + 1 strategy |
| **Variant** | A specific text version created during a run | Has parent lineage, Elo rating, creator agent |
| **Invocation** | One agent executing in one iteration | Tracks cost, execution detail, attribution |
| **Checkpoint** | Full state snapshot (pool + ratings + history) | For pause/resume across serverless timeouts |
| **Batch** | Group of runs dispatched together | Optional container, links runs via FK |
| **Experiment** | Multi-round factorial design testing strategy factors | Contains rounds, each round spawns a batch |
| **HoF Entry** | A persistent article for cross-method comparison | Linked to topic; may reference a run+variant |
| **HoF Elo** | OpenSkill rating for an entry within a topic | Updated via pairwise comparisons |

---

## Key Findings

### 1. Dead/Unused Database Columns

| Column | Table | Status | Evidence |
|--------|-------|--------|----------|
| `quality_scores` | evolution_variants | **DEAD** | Never queried or displayed in any UI |
| `cost_estimate_detail` | evolution_runs | **DEAD** | Written at queue time, never fetched by UI |
| `continuation_count` | evolution_runs | **DEAD** | Internal state, not surfaced |
| `runner_id` | evolution_runs | **Internal only** | Used by watchdog, never in UI |
| `last_heartbeat` | evolution_runs | **Internal only** | Watchdog-only |
| `runner_agents_completed` | evolution_runs | **DROPPED** | Already removed in migration |
| `variants_generated` | evolution_runs | **DROPPED** | Already removed (was redundant with `total_variants`) |

### 2. Elo → Ordinal Terminology Migration (Incomplete)

**DB layer:**
- `evolution_variants.elo_score` — old name, should be `ordinal_score` or `ordinal`
- `evolution_hall_of_fame_elo.ordinal` — new standard (correct)
- `evolution_hall_of_fame_elo.elo_rating` — backward compat field (derived from ordinal)

**TypeScript layer:**
- `EvolutionVariant` interface in `evolutionActions.ts` uses snake_case `elo_score` (should be camelCase `eloScore`)
- `variantDetailActions.ts` correctly uses `eloScore` (camelCase)
- `types.ts` has deprecated `eloRatings` in `SerializedPipelineState`
- `EvolutionRunSummary` correctly uses `ordinalHistory` (v2)

### 3. Type System Issues

| Issue | Count | Severity |
|-------|-------|----------|
| Unused types (`OutlineVariant`, `GenerationStep`, `PromptMetadata`) | 3 | LOW |
| Duplicate types (RunCostEstimate vs CostEstimateResult, EvolutionRun vs ExplorerRunRow) | 4 pairs | MEDIUM |
| Unsafe type casts (`as StrategyConfig`, `as EvolutionRun`) | 8+ locations | MEDIUM |
| Missing Zod schemas for DB row types | 5+ types | MEDIUM |
| `PipelineState` has 50+ fields, no readonly guarantees | 1 interface | HIGH |
| `AgentResult.agentType` is generic `string` instead of `AgentName` union | 1 field | LOW |

### 4. Query Pattern Issues

| Issue | Impact | Effort |
|-------|--------|--------|
| SELECT * patterns (evolutionActions, strategyRegistry, variantDetail) | 20-30% network overhead from fetching large JSONB | LOW |
| N+1 lineage walk in `getVariantLineageChainAction` (1 query per ancestor) | 10-100× queries on lineage page | MEDIUM |
| Duplicate prompt/strategy lookups across `unifiedExplorerActions` (same table queried 3+ times) | 30-50% extra queries per explorer call | MEDIUM |
| Checkpoint snapshot parsing (100KB-1MB JSONB deserialized in JS) | CPU + memory spikes on visualization pages | HIGH |
| Missing JOINs: run→winner variant and run→prompt/strategy resolved separately | 6 queries → could be 1-2 | MEDIUM |

### 5. Data Consistency Risks

| Risk | Severity | Guard Status |
|------|----------|-------------|
| No validation `total_cost_usd = SUM(invocation costs)` | HIGH | None |
| Hall of Fame entries may have orphaned run_id/variant_id (no FK constraint) | MEDIUM-HIGH | None |
| Checkpoint ratings vs persisted `elo_score` can diverge on resume | MEDIUM | Partial |
| Strategy aggregates updated via parameter, not fresh SUM | MEDIUM | Partial |
| Run status state machine has missing transitions (continuation_pending → running unclear) | MEDIUM | Partial |
| Invocation costs may double-count on resume | MEDIUM | Upsert dedup |
| `match_count` in hall_of_fame_elo always initialized to 0, not maintained | LOW | None |

### 6. Admin Dashboard ↔ Data Model Mismatches

**Navigation structure:**
```
/admin/evolution-dashboard      — overview metrics
/admin/quality/evolution        — runs list + queue
  /run/[runId]                  — 5-tab detail (Timeline, Elo, Lineage, Variants, Logs)
    /compare                    — before/after diff
  /article/[explanationId]      — cross-run article history
  /variant/[variantId]          — single variant deep dive
/admin/quality/hall-of-fame     — method comparison
  /[topicId]                    — topic leaderboard
/admin/quality/explorer         — dimensional explorer
/admin/quality/optimization     — rating optimization
/admin/quality/prompts          — prompt registry
/admin/quality/strategies       — strategy registry
```

**Key mismatches:**
- **Variants scattered across 3 pages** (runs modal, run detail tab, Hall of Fame) — no unified variant browser
- **No Strategy detail page** — can't see all runs using a strategy
- **No Prompt detail page** — can't see prompt's run performance
- **Hall of Fame conflates two concepts** — method comparison vs topic-based ranking
- **Cost data fragmented** across dashboard, runs page, run detail, and Hall of Fame
- **Variant discovery only via run detail or HoF** — no direct browsing path
- **Article detail doesn't show which runs evolved it** clearly

### 7. JSONB Column Analysis

| Column | Table | TypeScript Type | Zod Schema? | Normalization Candidate |
|--------|-------|----------------|-------------|------------------------|
| config | evolution_runs | EvolutionRunConfig | Yes (custom) | HIGH — duplicates strategy_configs |
| run_summary | evolution_runs | EvolutionRunSummary | Yes (v2) | MEDIUM — top variants could be columns |
| cost_estimate_detail | evolution_runs | RunCostEstimate | Yes | DEAD — never displayed |
| cost_prediction | evolution_runs | CostPrediction | Yes | HIGH — could split into summary cols |
| quality_scores | evolution_variants | Critique | No | DEAD — never queried |
| elo_attribution | evolution_variants | EloAttribution | No | MEDIUM — 5 fields could be columns |
| execution_detail | evolution_agent_invocations | AgentExecutionDetail (12-type union) | No | LOW — too nested/varied |
| agent_attribution | evolution_agent_invocations | AgentAttribution | No | MEDIUM — summary fields could be columns |
| config | evolution_strategy_configs | StrategyConfig | Yes (partial) | LOW — core lookup table |
| state_snapshot | evolution_checkpoints | SerializedCheckpoint | No | LOW — designed for atomic serialization |

### 8. Naming Consistency

**Consistent (no action needed):**
- All 11+ tables use `evolution_` prefix
- All DB columns are snake_case
- All timestamps use `created_at`, `updated_at`, `deleted_at`
- All server actions end with `Action` suffix
- Agent names consistent between `AgentName` union and `detailType` discriminator

**Inconsistent (needs cleanup):**
- `EvolutionVariant` interface uses snake_case (`elo_score`, `agent_name`, `is_winner`) — should be camelCase
- Mixed `elo_score` (DB) vs `eloScore` (other TS interfaces)

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/agents/overview.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/cost_optimization.md

## Code Files Read (via 8 agents)

### Database / Migrations
- supabase/migrations/20260131000001_content_evolution_runs.sql
- supabase/migrations/20260131000002_content_evolution_variants.sql
- supabase/migrations/20260131000003_evolution_checkpoints.sql
- supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql
- supabase/migrations/20260205000004_add_batch_runs.sql
- supabase/migrations/20260205000005_add_strategy_configs.sql
- supabase/migrations/20260207000001–20260207000008 (prompt/strategy formalization)
- supabase/migrations/20260211000001_evolution_run_logs.sql
- supabase/migrations/20260212000001_evolution_agent_invocations.sql
- supabase/migrations/20260220000002_hall_of_fame_openskill.sql
- supabase/migrations/20260221000002_evolution_table_rename.sql
- supabase/migrations/20260221000003–4 (drop dead columns)
- supabase/migrations/20260222100003_add_experiment_tables.sql
- supabase/migrations/20260224000001–20260226000002 (fixes + attribution)

### TypeScript Types & Core
- evolution/src/lib/types.ts
- evolution/src/lib/core/strategyConfig.ts
- evolution/src/lib/core/rating.ts
- evolution/src/lib/core/costTracker.ts
- evolution/src/lib/core/pipeline.ts
- evolution/src/lib/core/persistence.ts
- evolution/src/lib/core/metricsWriter.ts
- evolution/src/lib/core/hallOfFameIntegration.ts
- evolution/src/lib/core/eloAttribution.ts
- evolution/src/lib/core/pipelineUtilities.ts
- evolution/src/lib/core/costEstimator.ts
- evolution/src/lib/config.ts
- evolution/src/lib/comparison.ts

### Service Layer
- evolution/src/services/evolutionActions.ts
- evolution/src/services/unifiedExplorerActions.ts
- evolution/src/services/evolutionVisualizationActions.ts
- evolution/src/services/articleDetailActions.ts
- evolution/src/services/variantDetailActions.ts
- evolution/src/services/promptRegistryActions.ts
- evolution/src/services/strategyRegistryActions.ts
- evolution/src/services/hallOfFameActions.ts
- evolution/src/services/strategyResolution.ts

### UI Components
- src/app/admin/evolution-dashboard/page.tsx
- src/app/admin/quality/evolution/page.tsx
- src/app/admin/quality/evolution/run/[runId]/page.tsx
- src/app/admin/quality/evolution/article/[explanationId]/page.tsx
- src/app/admin/quality/evolution/variant/[variantId]/page.tsx
- src/app/admin/quality/hall-of-fame/page.tsx, /[topicId]/page.tsx
- src/components/admin/EvolutionSidebar.tsx
- evolution/src/components/evolution/RunsTable.tsx
- evolution/src/components/evolution/tabs/* (Timeline, Elo, Lineage, Variants, Logs)
- evolution/src/components/evolution/agentDetails/* (12 agent-specific detail views)

---

## Experiment Simplification Research (3 rounds × 4 agents = 12 agents)

### Proposed Change: Eliminate Rounds + Batches

```
BEFORE: Experiment → Round → Batch → Run    (3 tables, 3 FK hops)
AFTER:  Experiment → Run                     (1 FK: experiment_id on runs)
```

Drop 2 tables: `evolution_experiment_rounds`, `evolution_batch_runs`

### Key Finding: Low Migration Risk

- **No production experiment data exists** — E2E tests are `.describe.skip`; system is new and unused in prod
- **Core analysis code is round-agnostic** — `factorial.ts`, `analysis.ts`, `factorRegistry.ts` have zero round references; `analyzeExperiment()` takes flat `(design, runs[])` and works as-is
- **`expandAroundWinner()` is a pure function** — works without any round concept
- **`source` column already links runs to experiments** — pattern: `source = 'experiment:<uuid>'`

### Blast Radius: 12 Production Files + 9 Test Files

**Production code (must change):**

| File | Impact | Key Change |
|------|--------|-----------|
| `experimentActions.ts` | HIGH | Remove batch/round creation, query runs by `experiment_id` |
| `experiment-driver/route.ts` | HIGH | 2-state machine (running→analyzing) replaces 3-state |
| `experimentReportPrompt.ts` | MEDIUM | Remove round context from prompt building |
| `ExperimentStatusCard.tsx` | MEDIUM | Remove rounds section + round progress |
| `ExperimentOverviewCard.tsx` | MEDIUM | Remove "Round X/Y" display |
| `ExperimentHistory.tsx` | MEDIUM | Remove per-round expansion |
| `ExperimentDetailTabs.tsx` | MEDIUM | Remove Rounds tab (keep Runs + Report) |
| `RoundsTab.tsx` | DELETE | Entire component removed |
| `RoundAnalysisCard.tsx` | REPURPOSE | → `ExperimentAnalysisCard` (single card) |
| `RunsTab.tsx` | LOW | Remove round grouping, flat table |
| `ExperimentForm.tsx` | LOW | Remove "Max Rounds" input |
| `run-batch.ts` | LOW | Remove DB batch tracking, keep CLI execution |

**Test files (must update):**

| File | Tests Affected |
|------|---------------|
| `experiment-driver/route.test.ts` | ~27 tests, all mock round/batch structures |
| `experimentActions.test.ts` | ~15 tests with round/batch mocks |
| `admin-experiment-detail.spec.ts` | 4 tests (currently skipped) |
| `ExperimentDetailTabs.test.tsx` | 3 tests |
| `RunsTab.test.tsx` | 3 tests |
| `RoundAnalysisCard.test.tsx` | 8 tests |
| `experimentReportPrompt.test.ts` | 4 tests |
| `ExperimentOverviewCard.test.tsx` | No change |
| `ReportTab.test.tsx` | No change |

**No changes needed:**
- `factorial.ts`, `analysis.ts`, `factorRegistry.ts` (pure design/analysis)
- `evolution-runner.ts`, `evolution-batch.yml` (generic runner, no batch awareness)
- `evolutionBatchActions.ts` (workflow dispatch only)
- All evolution pipeline core code (pipeline.ts, persistence.ts, etc.)

### Simplified Experiment Status Machine

```
CURRENT (9 states):
  pending → round_running → round_analyzing → pending_next_round → (loop)
                                            → converged / budget_exhausted / max_rounds / failed / cancelled

PROPOSED (6 states):
  pending → running → analyzing → completed / failed / cancelled
```

### Migration SQL (Safe — No Existing Data)

```sql
-- 1. Add experiment_id to runs
ALTER TABLE evolution_runs ADD COLUMN experiment_id UUID REFERENCES evolution_experiments(id);
CREATE INDEX idx_evolution_runs_experiment ON evolution_runs(experiment_id);

-- 2. Backfill (if any experiment data exists)
UPDATE evolution_runs r SET experiment_id = er.experiment_id
FROM evolution_experiment_rounds er
WHERE er.batch_run_id = r.batch_run_id;

-- 3. Simplify experiments table status constraint
ALTER TABLE evolution_experiments DROP CONSTRAINT evolution_experiments_status_check;
ALTER TABLE evolution_experiments ADD CONSTRAINT evolution_experiments_status_check
  CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled'));

-- 4. Drop intermediate tables
DROP TABLE IF EXISTS evolution_experiment_rounds CASCADE;
DROP TABLE IF EXISTS evolution_batch_runs CASCADE;

-- 5. Drop unused columns from experiments
ALTER TABLE evolution_experiments DROP COLUMN IF EXISTS current_round;
ALTER TABLE evolution_experiments DROP COLUMN IF EXISTS max_rounds;

-- 6. Add analysis_results to experiments (absorbed from rounds)
ALTER TABLE evolution_experiments ADD COLUMN IF NOT EXISTS analysis_results JSONB;

-- 7. Clean up runs
ALTER TABLE evolution_runs DROP COLUMN IF EXISTS batch_run_id;
```

### Additional Code Files Read (Round 2-3 agents)

- evolution/src/services/experimentActions.ts (full, 718 lines)
- src/app/api/cron/experiment-driver/route.ts (full, 700 lines)
- src/app/api/cron/experiment-driver/route.test.ts (full, 1087 lines)
- evolution/src/experiments/evolution/factorial.ts
- evolution/src/experiments/evolution/analysis.ts
- evolution/src/experiments/evolution/factorRegistry.ts
- evolution/src/experiments/evolution/factorial.test.ts
- evolution/src/experiments/evolution/strategyExperiment.test.ts
- evolution/src/experiments/evolution/factorRegistry.test.ts
- scripts/run-strategy-experiment.ts
- evolution/scripts/run-batch.ts
- evolution/scripts/backfill-prompt-ids.ts
- evolution/src/services/experimentReportPrompt.ts
- All 9 experiment UI components in src/app/admin/quality/optimization/
- src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts

---

## Open Questions

1. Should the Elo→Ordinal rename happen in this project or be deferred? (It touches DB columns, types, and UI labels)
2. Is the current dashboard navigation good enough or does this project include rearchitecting the admin pages?
3. Should dead JSONB columns (`quality_scores`, `cost_estimate_detail`) be dropped or just ignored?
4. How important is the cost reconciliation (total vs sum of invocations) — is data integrity a blocker?
5. Should `PipelineState` be refactored into smaller interfaces (pool, ratings, reviews, etc.)?

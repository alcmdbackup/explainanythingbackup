# Experiment Structure Change Evolution Research

## Problem Statement
The current experiment system uses factor ranges (L8 orthogonal arrays) to auto-generate all 8 runs at once, which is inflexible for iterative exploration. Iterations as a factor adds complexity to analysis since runs with different iteration counts are hard to compare fairly. Additionally, experiment results (ratings, arena entries) only sync after the entire experiment completes, preventing real-time monitoring and early insights.

## Requirements (from GH Issue #616)
1. I want to be able to add experiment groups/runs 1 by 1 rather than by choosing factor range. Please create UI that allows me to do this.
2. I want to remove iterations as a factor. I want each run/experiment group to stop when I hit the budget limit for it, since this will make analysis much easier. I want the budget limit for each run to be clearly labeled at experiment setup.
3. I want ratings and other details to sync to the arena mid-experiment, rather than waiting until the very end.

## Decisions (from user)
1. **Fully replace L8 factorial mode with manual run creation** — No dual mode, remove L8 entirely
2. **Simple elo/cost comparison for analysis** — No main effects computation; direct per-run comparison table
3. **Mid-run arena sync every iteration** — Sync after every pipeline iteration, not just at finalization
4. **Each run has its own budget** — Per-run budget is critical for test accuracy. Must be stored with the run itself and displayed everywhere the run appears (experiment form, runs tab, run detail page, etc.)
5. **`design` field**: Set to `'manual'` for new experiments

## High Level Summary

### Current Architecture
- Experiment → Runs (flat model after migration 20260303000001 dropped rounds/batches)
- ExperimentForm picks 2-7 factors with Low/High → `buildL8FactorDefinitions` → `generateL8Design` → always 8 design rows × N prompts = 8N runs
- Runs linked via `evolution_runs.experiment_id` FK and `config._experimentRow` (integer 1-8)
- State machine: `pending → running → analyzing → completed|failed|cancelled` (cron-driven, 1-min cycle)
- Arena sync happens per-run at `finalizePipelineRun()` only — never mid-run
- Cron driver waits for ALL runs to be terminal before transitioning to `analyzing`

### Key Architectural Findings

**Adding runs to a running experiment already works.** The cron's `handleRunning` just checks "are any runs non-terminal?" — inserting a new `pending` run keeps it in `running` state. No schema change needed for this.

**`sync_to_arena` RPC is NOT safe to call every iteration as-is.** Entries and elo are idempotent (ON CONFLICT DO NOTHING / DO UPDATE), but comparisons are plain INSERT with no dedup. Calling repeatedly would duplicate `N × accumulated_matches`. Solution: watermark approach (track `lastSyncedMatchIndex`, send only new matches).

**PipelineState serialization is JSONB and schema-free.** New optional fields (like `lastSyncedMatchIndex`) need no DB migration — just `field?: type` in the interface + `?? 0` in `deserializeState`. Established pattern used by 5+ prior fields.

**Budget is stored on `evolution_runs.budget_cap_usd`** but NOT displayed in the experiment RunsTab or returned by `getExperimentRunsAction`. This is the #1 missing surface for the per-run budget requirement.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/strategy_experiments.md — Full experiment system docs
- evolution/docs/evolution/data_model.md — Core primitives, migrations, data flow
- evolution/docs/evolution/reference.md — Config, DB schema, key files
- evolution/docs/evolution/architecture.md — Pipeline phases, finalizePipelineRun flow
- evolution/docs/evolution/cost_optimization.md — Cost tracking, estimation, strategy identity
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill rating, tournament
- evolution/docs/evolution/agents/overview.md — Agent framework

## Code Files Read

### Experiment UI (to be replaced/reworked)
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` (557 lines) — Factor toggle + Low/High dropdowns, L8 run preview, validation. **Primary component to rewrite.**
- `src/app/admin/quality/optimization/_components/ExperimentStatusCard.tsx` (194 lines) — Real-time polling, budget/run progress. Works with any run structure.
- `src/app/admin/quality/optimization/_components/ExperimentHistory.tsx` (185 lines) — Past experiments list. Minimal changes.

### Experiment Detail Page
- `src/app/admin/quality/optimization/experiment/[experimentId]/page.tsx` (35 lines) — Server component
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentOverviewCard.tsx` (177 lines) — Shows factor definitions table → needs to show per-run configs instead
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentDetailTabs.tsx` (57 lines) — Three tabs: Analysis, Runs, Report
- `src/app/admin/quality/optimization/experiment/[experimentId]/RunsTab.tsx` (112 lines) — Shows L8 Row column, **missing budget_cap_usd column**
- `src/app/admin/quality/optimization/experiment/[experimentId]/ExperimentAnalysisCard.tsx` — Main effects table → needs replacement with per-run comparison

### Experiment Server Actions
- `evolution/src/services/experimentActions.ts` (585 lines) — `startExperimentAction` creates all runs via L8. Key types: `StartExperimentInput`, `ValidateExperimentOutput`. Needs new `addRunToExperimentAction`.
- `evolution/src/services/experimentHelpers.ts` (14 lines) — `extractTopElo` utility, generic

### Experiment Core Logic
- `evolution/src/experiments/evolution/factorRegistry.ts` (174 lines) — 5 factors including `iterations`. Remove iterations, keep registry for reference but not used by manual mode.
- `evolution/src/experiments/evolution/experimentValidation.ts` (207 lines) — Validates factor ranges, L8 design. Not needed for manual mode.
- `evolution/src/experiments/evolution/factorial.ts` (247 lines) — L8 array, `generateL8Design`, `mapFactorsToPipelineArgs`. Not needed for manual mode.
- `evolution/src/experiments/evolution/analysis.ts` (394 lines) — Main effects assumes L8 structure. Replace with simple per-run comparison.

### Experiment Cron Driver
- `src/app/api/cron/experiment-driver/route.ts` (370 lines) — State machine. `handleAnalyzing` hard-requires a design object (line 173). Must branch on `design === 'manual'` to skip L8 analysis.

### Pipeline & Arena Integration
- `evolution/src/lib/core/pipeline.ts` (795 lines) — `finalizePipelineRun` calls `syncToArena()` at line 179. Injection point for mid-run sync: after `persistCheckpointWithSupervisor` at line 504.
- `evolution/src/lib/core/arenaIntegration.ts` (312 lines) — `syncToArena` sends ALL matchHistory (no cursor). Needs incremental version.
- `evolution/src/lib/core/state.ts` — `serializeState`/`deserializeState`, `MAX_MATCH_HISTORY = 5000`. matchHistory truncated to last 5000 at serialize time only.
- `evolution/src/lib/types.ts` — `SerializedPipelineState`, `PipelineState` interfaces. Adding `lastSyncedMatchIndex?: number` follows established pattern.

### Strategy Config UI (reusable patterns)
- `src/app/admin/quality/strategies/page.tsx` (1148 lines) — `StrategyDialog` with model selects, agent toggles, budget caps. **Best pattern to reuse for manual run form.**
- `src/app/admin/quality/strategies/strategyFormUtils.ts` (49 lines) — `FormState` + `formToConfig()` pattern. Create similar for run form.
- `evolution/src/lib/core/agentToggle.ts` (37 lines) — `toggleAgent` pure function with dependency enforcement
- `evolution/src/lib/core/budgetRedistribution.ts` (142 lines) — `REQUIRED_AGENTS`, `OPTIONAL_AGENTS`, `validateAgentSelection`, `computeEffectiveBudgetCaps`

### DB Schema
- `supabase/migrations/20260222100003_add_experiment_tables.sql` — Original evolution_experiments table
- `supabase/migrations/20260303000001_flatten_experiment_model.sql` — Dropped rounds/batches, added `design TEXT CHECK ('L8', 'full-factorial')` and `analysis_results JSONB`
- `supabase/migrations/20260303000005_arena_rename_and_schema.sql` — `sync_to_arena` RPC. Comparisons INSERT has NO dedup.

### Budget Display
- Run detail page (`run/[runId]/page.tsx`) — Shows `BudgetBar` (cost/budget with percentage)
- Pipeline runs list (`evolution/page.tsx`) — Shows Budget, Cost, Est. columns
- `RunsTable.tsx` — Shows cost + progress bar
- **Experiment RunsTab** — **Missing budget_cap_usd column entirely**
- **getExperimentRunsAction** — **Doesn't fetch budget_cap_usd from DB**

## Key Findings

### 1. evolution_experiments Column Analysis
| Column | L8-specific? | Change needed |
|--------|-------------|---------------|
| `id`, `name`, `status` | Generic | status CHECK: possibly add 'drafting' |
| `total_budget_usd`, `spent_usd` | Generic | Keep but total_budget_usd becomes sum of per-run budgets |
| `factor_definitions` JSONB NOT NULL | L8-shaped ({low,high}) | Store `{}` or per-run config summaries for manual |
| `design` TEXT CHECK | L8-specific | Add 'manual' to CHECK constraint |
| `analysis_results` JSONB | L8 analysis output | Store simple per-run comparison for manual |
| `prompts` TEXT[] NOT NULL | Generic | Keep |
| `optimization_target` | Generic | Keep |
| `convergence_threshold` | Vestigial | Can ignore |
| `config_defaults` | Generic | Keep |
| `results_summary` | Generic container | `factorRanking`/`recommendations` will be empty for manual |

### 2. sync_to_arena RPC Safety
- **Entries**: `ON CONFLICT (id) DO NOTHING` — **idempotent, safe**
- **Elo**: `ON CONFLICT (topic_id, entry_id) DO UPDATE` — **idempotent, safe**
- **Comparisons**: Plain INSERT, NO dedup — **NOT idempotent, duplicates on repeat calls**
- **Solution**: Watermark approach — `lastSyncedMatchIndex` on PipelineState, send only `matchHistory.slice(watermark)`, update watermark after sync, checkpoint includes it

### 3. Mid-Run Sync Injection Point
- **Location**: pipeline.ts, after all agents complete for an iteration, BEFORE `persistCheckpointWithSupervisor` at line 504
- **Order**: (1) run incremental arena sync → update `lastSyncedMatchIndex` → (2) persist checkpoint (serializes updated watermark)
- **On finalization**: `syncToArena` in `finalizePipelineRun` also uses the watermark to send only remaining unsent matches
- **Performance**: ~30 entries + ~20 new matches + ~30 elo rows per iteration = ~80 row-ops per sync call

### 4. Manual Run Creation Flow
```
New: createManualExperimentAction({ name, promptIds, target })
  → INSERT evolution_experiments with design='manual', factor_definitions='{}'
  → status='pending' (no runs yet)

New: addRunToExperimentAction({ experimentId, config: { model, judgeModel, enabledAgents, budgetCapUsd } })
  → Verify experiment is pending or running
  → resolveOrCreateStrategyFromRunConfig → strategy_config_id
  → For each prompt: create explanation row + evolution_runs row
  → Update experiment total_budget_usd += budgetCapUsd * promptCount

startManualExperimentAction({ experimentId })
  → Verify at least 1 run exists
  → Set status='running'
```

### 5. Test Impact Assessment
| Category | Files | Impact |
|----------|-------|--------|
| **HIGH — Must rewrite** | factorial.test, factorRegistry.test, experimentValidation.test, experimentActions.test, strategyExperiment.test, run-strategy-experiment.test | All hardcode L8 8-run count, factor names, specific model prices |
| **MEDIUM — Fixture updates** | analysis.test (L8 path), cron route.test, ExperimentForm.test, ExperimentOverviewCard.test | Change design:'L8' to 'manual', update run counts |
| **LOW — Minimal/none** | ExperimentAnalysisCard.test, RunsTab.test, ReportTab.test, ExperimentHistory.test, strategy-resolution.integration.test | Generic display/logic tests |
| **E2E** | admin-experiment-detail.spec (SKIPPED), admin-elo-optimization.spec (NO IMPACT) | Skipped test needs fixture update |

### 6. DB Migration Needed
Next migration: `20260304000001_manual_experiment_design.sql`
- Add `'manual'` to `design` CHECK constraint (DROP + ADD)
- Optionally add `'drafting'` to `status` CHECK constraint

### 7. Budget Exhaustion Behavior Change: Paused → Completed

**Current behavior has two paths:**
- **Graceful** (`supervisor.shouldStop` at iteration start, `availableBudget < $0.01`): Sets `status='completed'`, calls `finalizePipelineRun` — variants persisted, arena synced. Already correct.
- **Mid-agent** (`BudgetExceededError` thrown during LLM pre-call reservation): Calls `markRunPaused` → `status='paused'`, NO finalization, variants only in checkpoint. `paused` is effectively a terminal status (no automated resume-from-paused path exists).

**The fix (Option A — minimal, highest leverage):**
In `executeFullPipeline`'s agent dispatch loop (pipeline.ts ~line 460), catch `BudgetExceededError` at the `runAgent` call site and convert it to a graceful stop:
```
try { await runAgent(...) }
catch (err) {
  if (err instanceof BudgetExceededError) { stopReason = 'budget_exhausted'; break; }
  throw err;
}
```
The existing post-loop code (`else if (stopReason !== 'killed')`) already calls `finalizePipelineRun` with `status='completed'`. Same treatment for `flowCritique` inline handler (line ~480) and `executeMinimalPipeline` (line ~241).

**Impact:**
- `markRunPaused` is never called for budget exhaustion
- Both paths result in `completed` + full finalization (variants persisted, arena synced)
- No changes to CostTracker, BudgetExceededError, agent internals, or DB schema
- The `'paused'` status becomes effectively unused (can be removed later or kept for manual admin use)
- `error_message` will be set to `'budget_exhausted'` to distinguish from clean completion

**Files to modify:**
- `evolution/src/lib/core/pipeline.ts` — catch BudgetExceededError in agent loop, flowCritique handler, minimal pipeline
- `evolution/src/lib/core/persistence.ts` — `markRunPaused` can be left in place but will no longer be called for budget

### 8. budget_cap_usd JSONB Gap (Pre-existing Bug)

**Bug**: `queueEvolutionRunAction` writes `budget_cap_usd` to the DB column but `buildRunConfig` omits `budgetCapUsd` from the JSONB `config` column. The runner (`evolutionRunnerCore.ts`) only reads from `claimedRun.config` JSONB → `resolveConfig()` defaults to `$5.00`. Custom budget caps are silently ignored at execution time for standalone runs.

**Not affected**: The experiment path (`experimentActions.ts` line 258) spreads the full `resolvedConfig` into JSONB, which includes `budgetCapUsd`. Only standalone `queueEvolutionRunAction` has this bug.

**Fix**: Pass the resolved `budgetCap` into `buildRunConfig` and write it to the JSONB output. One-line addition to `buildRunConfig` body + signature change.

**Cost safeguard summary:**
| Layer | Mechanism | Gap |
|-------|-----------|-----|
| Pre-queue | Cost estimate vs cap | Skipped if no strategyId |
| Pre-call | `reserveBudget` 30% margin | None — always fires |
| Iteration start | `shouldStop` budget < $0.01 | Only between iterations |
| Iteration limit | `maxIterations` default 15, hard loop bound | None |
| Plateau | Elo improvement < threshold for 3 iters | COMPETITION phase only |
| Soft timeout | 740s per invocation | Up to 10 continuations = ~2h |
| Max continuations | 10 | No global wall-clock limit |
| Watchdog | 10min heartbeat threshold, 15min cron | 5min detection gap |
| Abandoned cleanup | 30min for continuation_pending | Hardcoded |
| Budget cap validation | $0.01–$100 at queue time | Max $100 enforced |
| **budget_cap_usd JSONB** | **DB column written, JSONB omitted** | **Runner defaults to $5.00** |

### 9. Reusable UI Patterns for Manual Run Form
| Pattern | Source | How to reuse |
|---------|--------|-------------|
| `FormState` + `formToConfig()` | `strategyFormUtils.ts` | Create `runFormUtils.ts` |
| Model dropdowns | `strategies/page.tsx` MODEL_OPTIONS | Import/copy |
| Agent required/optional split | `strategies/page.tsx` lines 307-373 | Same pattern |
| `toggleAgent` dependency logic | `agentToggle.ts` | Import directly |
| `validateAgentSelection` inline errors | `budgetRedistribution.ts` | Import + render |
| `computeEffectiveBudgetCaps` preview | `budgetRedistribution.ts` | Import + useMemo |
| Cost estimate display | `evolution/page.tsx` StartRunCard | Copy pattern |

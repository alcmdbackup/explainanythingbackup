# Explore Automated Elo Optimization Capability Evolution Research

## Problem Statement
Build an automated Elo optimization loop that chains the existing strategy experiment infrastructure (L8 factorial design → batch execution → main effects analysis → factor refinement) into a self-driving workflow. The system should be initiatable from the admin UI with progress visibility, automatically running screening rounds, analyzing results, and refining factor levels across multiple rounds until convergence or budget exhaustion.

## Requirements (from GH Issue #531)
1. UI trigger on optimization dashboard to start an automated experiment
2. Configurable budget constraint, prompt(s), and optimization target (elo vs elo/$)
3. Automated Round 1 (L8 screening) → analysis → Round 2+ (refinement) loop
4. Real-time progress UI showing current round, completed runs, factor rankings
5. Auto-stop on convergence (top factor effect < threshold) or budget exhaustion
6. Results feed into existing strategy leaderboard and Pareto frontier
7. Brainstorm and implement ways to allow selecting which factors should be tested (factor selection UI)

## High Level Summary

The codebase has a **complete but disconnected** set of building blocks for automated Elo optimization. The L8 factorial design, main effects analysis, batch execution, strategy leaderboard, Pareto frontier, and agent ROI ranking all exist and are tested. The key gap is **orchestration glue** — nothing chains these steps together automatically or exposes them through the UI.

The current CLI workflow (`scripts/run-strategy-experiment.ts`) shells out to `run-evolution-local.ts` for each run, scrapes results from stdout via regex, and stores state in a single JSON file. This works for manual experimentation but is not suitable for production automation because: (a) it requires CLI access, (b) it bypasses the DB queue/claim system, (c) results are fragile (regex parsing), and (d) there's no progress visibility in the UI.

The optimization dashboard at `/admin/quality/optimization` currently has 4 tabs (Strategy Analysis, Agent Analysis, Cost Analysis, Cost Accuracy) with a manual Refresh button and no polling. It would be the natural home for an experiment UI. The run detail page's `AutoRefreshProvider` pattern (5-second polling with tab visibility awareness) provides a proven template for progress monitoring.

## Detailed Findings

### 1. Strategy Experiment System (L8 Factorial)

**Design layer** (`evolution/src/experiments/evolution/factorial.ts`):
- Generates Taguchi L8(2^7) orthogonal array: 8 rows × 7 columns
- 5 default factors (generation model, judge model, iterations, editing approach, support agents)
- Supports custom factors — any `Record<string, FactorDefinition>` with ≤7 factors
- `mapFactorsToPipelineArgs()` converts resolved factor values to pipeline config (model names, iterations, enabledAgents list)
- Interaction estimation via unassigned L8 columns (A×C, A×E)
- `generateFullFactorial()` for Round 2+ multi-level designs (Cartesian product)

**Analysis layer** (`evolution/src/experiments/evolution/analysis.ts`):
- `computeMainEffects()`: for each factor, `avg(Elo|high) - avg(Elo|low)` for both Elo and Elo/$
- `rankFactors()`: sorts by `|eloEffect|` descending
- `generateRecommendations()`: auto-generates actionable recommendations:
  - Expand top factor to more levels in Round 2
  - Lock negligible factors (< 15% of top effect) at their cheap level
  - Flag Elo vs Elo/$ tradeoffs
  - Alert on significant interactions
- Handles partial data gracefully (warns when < 4 runs completed)

**Orchestration layer** (`scripts/run-strategy-experiment.ts`):
- CLI with 4 commands: `plan`, `run`, `analyze`, `status`
- State persisted to `experiments/strategy-experiment.json`
- Executes runs via `execFileSync('npx tsx run-evolution-local.ts ...')` — shells out to subprocess
- Results scraped from stdout: `Run ID`, `Total cost`, `#1 [Elo]` via regex
- Round 2+ supported via `--vary` (multi-level factors) and `--lock` (pin factors) flags
- Auto-analysis triggers only for Round 1 (L8); Round 2 analysis not implemented

**Limitations found:**
- `commandAnalyze` always calls `generateL8Design()` — wrong for full-factorial rounds
- `validatePrerequisites()` checks wrong path (`scripts/run-evolution-local.ts` vs actual `evolution/scripts/`)
- Result parsing is fragile — three regex patterns against stdout
- Single global state file — concurrent experiments would clobber
- `baselineRank` and `stopReason` fields on `ExperimentRun` are never populated

### 2. Optimization Dashboard

**Page** (`src/app/admin/quality/optimization/page.tsx`):
- Client component (`'use client'`) with 4 tabs
- Fetches 4 data sets in parallel on mount via `Promise.all`
- No polling — manual Refresh button only
- Tab state is in-memory (not URL-synced)

**Server actions** (`evolution/src/services/eloBudgetActions.ts`):

| Action | What it returns | Data source |
|--------|----------------|-------------|
| `getStrategyLeaderboardAction` | Sorted strategy list by avg_elo_per_dollar / avg_elo / consistency | `evolution_strategy_configs` |
| `getAgentROILeaderboardAction` | Per-agent Elo/$ ranking | `evolution_run_agent_metrics` |
| `getStrategyParetoAction` | Non-dominated Pareto frontier points (O(n²) JS computation) | `evolution_strategy_configs` |
| `getRecommendedStrategyAction` | Best strategy for budget + optimization goal, with alternatives | `evolution_strategy_configs` (≥3 runs required) |
| `getOptimizationSummaryAction` | Aggregate stats (total runs, spend, top strategy/agent) | Both tables |

**`getRecommendedStrategyAction`** is fully implemented but **not exposed in any UI** — the server action exists but there's no tab, widget, or form to invoke it.

### 3. Batch Execution Infrastructure

**Two distinct execution models:**

1. **Queue-based** (production): `queueEvolutionRunAction` → INSERT `evolution_runs` status='pending' → `claim_evolution_run` RPC (FOR UPDATE SKIP LOCKED) → execute pipeline → finalize
   - Used by: Vercel cron, admin UI trigger, GitHub Actions runner
   - Parallelism via `evolution-runner.ts --parallel N` and `Promise.allSettled`
   - Heartbeat monitoring (30s Vercel, 60s GH Actions)
   - Continuation/resume support across Vercel timeouts

2. **CLI-inline** (development): `run-batch.ts` inserts runs as `status='claimed'` immediately, executes pipeline in-process
   - No parallelism (sequential loop)
   - Used for local JSON-driven batch experiments

**GitHub Actions integration:**
- `dispatchEvolutionBatchAction` triggers workflow via GitHub REST API
- Workflow runs `evolution-runner.ts` with configurable `--parallel` and `--max-runs`
- Fire-and-forget from UI — no completion callback or progress feedback
- Weekly cron (Monday 4am UTC) + manual dispatch

**Key insight for automated experiments:** The queue-based system is the right foundation. Automated experiments should queue runs via `queueEvolutionRunAction` and let the existing runner infrastructure execute them, rather than shelling out to subprocess. This gives us: proper claiming, heartbeat monitoring, continuation/resume, and DB-persisted results.

### 4. Factor Configuration System

**Agent classification:**
- REQUIRED (always run): `generation`, `calibration`, `tournament`, `proximity`
- OPTIONAL (user-toggleable): `reflection`, `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `debate`, `evolution`, `outlineGeneration`, `metaReview`, `flowCritique`

**Dependency map:**
- `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `flowCritique` → require `reflection`
- `evolution`, `metaReview` → require `tournament` (always satisfied)

**Strategy presets:**
| Preset | Model | Judge | Iters | Optional Agents | Pipeline |
|--------|-------|-------|-------|-----------------|----------|
| Economy | deepseek-chat | gpt-4.1-nano | 2 | none | minimal |
| Balanced | gpt-4.1-mini | gpt-4.1-nano | 3 | 6 agents | full |
| Quality | gpt-4.1 | gpt-4.1-mini | 5 | 7 agents + outline | full |

**Current L8 factors vs full factor space:**

The L8 tests 5 factors, but the strategy system supports many more configurable dimensions:
- `generationModel`: any allowed LLM model
- `judgeModel`: any allowed LLM model
- `iterations`: 1-30
- `enabledAgents`: any subset of 9 optional agents
- `singleArticle`: boolean
- `budgetCaps`: per-agent budget fractions
- `agentModels`: per-agent model overrides (schema exists, not wired to pipeline)

The L8's Factor E ("support agents on/off") collapses the entire agent selection into a binary. A more granular approach could test individual agents or agent groups.

### 5. UI Patterns for Integration

**Strategy Registry page** (`strategies/page.tsx`):
- Agent checkbox grid with dependency auto-enable/disable via `toggleAgent()`
- Budget allocation preview via `computeEffectiveBudgetCaps()`
- Preset selector with horizontal button row
- This provides a proven pattern for factor selection UI

**StartRunCard** (in `evolution/page.tsx`):
- Prompt + Strategy + Budget form → `queueEvolutionRunAction` → `triggerEvolutionRun`
- Debounced cost estimation on strategy change
- Per-agent cost breakdown bar chart

**BatchDispatchButtons**:
- Three buttons: Run Next Pending, Batch Dispatch (GH Actions), Trigger All Pending
- Simple fire-and-forget with toast notifications

**AutoRefreshProvider** (in run detail page):
- 5-second polling interval with tab visibility awareness
- `refreshKey` counter as useEffect dependency
- `reportRefresh()` / `reportError()` consumer pattern
- `RefreshIndicator` showing "Updated Xs ago" + manual refresh button

**Key UI patterns to reuse:**
- `AutoRefreshProvider` for experiment progress monitoring
- `EvolutionStatusBadge` for per-run status display
- `RunsTable` with compact mode for showing experiment runs
- `StrategyParetoChart` SVG scatter plot for results visualization
- `EvolutionSidebar` for navigation — new page would need an entry
- `toast.success/error/info` for operation feedback (never loading toasts — button text changes instead)

### 6. Convergence Detection & Stopping Criteria

**Pipeline-level convergence** (`evolution/src/lib/core/supervisor.ts`):

The `PoolSupervisor.shouldStop()` method (line 183) checks four conditions in priority order:
1. **Quality threshold** (line 185): all critique dimensions >= 8 (only in `singleArticle` mode)
2. **Plateau detection** (line 191): `_isPlateaued()` checks the last `plateauWindow` (default 3) COMPETITION iterations; if total ordinal improvement < `plateauThreshold * 6` (default `0.02 * 6 = 0.12`), stops. Only active in COMPETITION phase.
3. **Budget exhaustion** (line 197): `availableBudget < $0.01` (hardcoded min)
4. **Max iterations** (line 201): `state.iteration > maxIterations` (default 15)

If plateau AND `diversityScore < 0.01`, the stop reason becomes "Degenerate state detected" instead of "Quality plateau detected".

**Tournament-level convergence** (`evolution/src/lib/agents/tournament.ts`):
- Sigma-based convergence (line 391): all eligible variants have `sigma < 3.0` (`DEFAULT_CONVERGENCE_SIGMA` from `rating.ts:20`) for 2 consecutive rounds
- Budget-adaptive: max comparisons = 40/25/15 for low/medium/high pressure tiers
- Exit reasons: `'budget' | 'convergence' | 'stale' | 'maxRounds' | 'time_limit'`

**IterativeEditingAgent stopping** (`evolution/src/lib/agents/iterativeEditingAgent.ts`):
- All dimensions >= `qualityThreshold=8` AND no suggestions remaining
- Max consecutive rejections: 3
- Max cycles: 3

**What does NOT exist for multi-round experiment convergence:**
- No stopping criterion between factorial experiment rounds — the analysis layer is purely post-hoc
- No incremental analysis during round execution (all 8 runs must complete before `analyzeExperiment()`)
- No statistical significance testing of factor effects
- The 15% threshold for "negligible" factors is purely relative with no absolute floor
- No variance/standard error computation in `computeMainEffects()`

**Statistical testing gap:** There are **no hypothesis tests** (t-test, F-test, ANOVA, confidence intervals) anywhere in the codebase. The nearest statistical reasoning is the OpenSkill Bayesian rating system (`evolution/src/lib/core/rating.ts`) which provides `mu` (skill estimate) and `sigma` (uncertainty), with `isConverged()` checking `sigma < 3.0`. The orthogonality verification in `factorial.ts:166-173` is a design property check, not a runtime statistical test.

### 7. Strategy Config Hashing & Deduplication

**`evolution_strategy_configs` table** (created in `20260205000005`, renamed in `20260221000002`):

| Column | Type | Purpose |
|--------|------|---------|
| `config_hash` | TEXT UNIQUE | 12-char SHA256 prefix, dedup key |
| `name` | TEXT | User-editable display name |
| `label` | TEXT | Auto-generated summary (read-only) |
| `config` | JSONB | Full `StrategyConfig` object |
| `is_predefined` | BOOLEAN | Admin-curated vs auto-created |
| `pipeline_type` | TEXT | `full | minimal | batch | single` |
| `status` | TEXT | `active | archived` |
| `run_count` | INT | Updated by `update_strategy_aggregates` RPC |
| `total_cost_usd` | NUMERIC(10,4) | Cumulative spend |
| `avg_final_elo` | NUMERIC(8,2) | Incremental running average |
| `avg_elo_per_dollar` | NUMERIC(12,2) | `(avg_final_elo - 1200) / total_cost_usd` |
| `best_final_elo` / `worst_final_elo` | NUMERIC(8,2) | Min/max tracking |
| `stddev_final_elo` | NUMERIC(8,2) | **DECLARED but never populated** — always null |

**Hash algorithm** (`evolution/src/lib/core/strategyConfig.ts:57`):
```
SHA256(JSON.stringify({ generationModel, judgeModel, iterations, enabledAgents (sorted), singleArticle (if true) })).slice(0, 12)
```
What IS hashed: model names, iterations, enabledAgents (sorted alphabetically), singleArticle.
What is NOT hashed: `budgetCaps`, `agentModels` — different spend limits = same strategy identity.

**Dedup paths:**
- Auto-create via `metricsWriter.ts:linkStrategyConfig`: queries by hash, inserts only if missing, with `is_predefined = false`
- Admin create via `strategyRegistryActions.ts:createStrategyCore`: queries by hash; if found, **promotes** to `is_predefined = true` (no duplicate)

**Aggregate computation** — `update_strategy_aggregates` PostgreSQL RPC (called explicitly, not a trigger):
- `avg_final_elo` uses incremental running average: `(current * count + new) / (count + 1)`
- `avg_elo_per_dollar = (avg_final_elo - 1200) / total_cost_usd` — subtracts 1200 baseline
- Uses `SELECT ... FOR UPDATE` to serialize concurrent updates (with 5s statement timeout)
- `stddev_final_elo` is never written — no code path populates it

**Scale inconsistency:** `avg_final_elo` values are on the 0-3000 display scale (via `ordinalToEloScale`), while `persistAgentMetrics` uses raw OpenSkill `mu` values (baseline 25). The two metrics are on different scales.

### 8. Pareto Frontier Computation Details

`getStrategyParetoAction` (`eloBudgetActions.ts:289`):

1. Fetches strategies with `run_count >= minRuns` and non-null `avg_final_elo`
2. Computes `avgCostUsd = total_cost_usd / run_count` in JS
3. O(n²) dominance check: point `p` is dominated if any point `q` has `q.elo >= p.elo AND q.cost <= p.cost` with at least one strict inequality
4. Sets `isPareto: true` on non-dominated points
5. Returns **all** points with the flag, not just the frontier — callers filter/highlight as needed

The 2D objective space is (minimize cost, maximize Elo). Pure brute-force comparison, no sweep-line optimization.

### 9. `getRecommendedStrategyAction` — Implemented but Not Exposed

**Server action** (`eloBudgetActions.ts:354`) — fully working, zero UI references:

1. Fetches strategies with `run_count >= 3` and non-null `avg_final_elo`
2. Filters to "affordable" strategies: `total_cost_usd / run_count <= params.budgetUsd`
3. Sorts by optimization target: `'elo'` (highest avg), `'elo_per_dollar'` (highest efficiency), or `'consistency'` (lowest stddev)
4. Returns `sorted[0]` as `recommended`, `sorted[1..3]` as `alternatives`, plus a `reasoning` string

No ML or weighted scoring — pure single-metric sort after budget filtering. The optimization dashboard (`page.tsx:60`) calls only `getStrategyLeaderboardAction`, `getStrategyParetoAction`, `getAgentROILeaderboardAction`, and `getOptimizationSummaryAction` — `getRecommendedStrategyAction` is absent from all UI imports.

### 10. Batch Run Schema & Matrix Expansion (Already Implemented)

**`src/config/batchRunSchema.ts`** — a complete Zod-validated system for combinatorial experiments:

**`BatchConfigSchema` top-level:**
- `name`: alphanumeric + underscore/hyphen
- `totalBudgetUsd`: positive number
- `safetyMargin`: 0.0-0.5 (default 0.1)
- `defaults`: partial `BatchRunSpec` applied to all runs
- `matrix.prompts`, `matrix.generationModels`, `matrix.judgeModels`, `matrix.iterations`: arrays for Cartesian product
- `matrix.agentModelVariants`: optional per-agent model sweep
- `runs`: explicit run list (merged with defaults, additive with matrix)
- `optimization.adaptiveAllocation`: boolean
- `optimization.prioritySort`: `'cost_asc' | 'elo_per_dollar_desc' | 'random'`
- `comparison`: optional post-batch settings (judgeModel, rounds 1-10)

**`expandBatchConfig()`** (lines 129-193): builds Cartesian product:
```
for prompt × genModel × judgeModel × iterations × agentModelVariants → ExpandedRun
```
Then appends explicit `config.runs` entries merged with defaults.

**`filterByBudget()`** (lines 199-232):
1. Effective budget = `totalBudget * (1 - safetyMargin)`
2. Sorts by priority strategy (cost_asc: cheapest first, elo_per_dollar_desc: best ROI first, random: Fisher-Yates)
3. Greedily selects runs until budget exhausted; excess runs get `status = 'skipped'`
4. Returns full array including skipped runs

**`BatchRunSpecSchema` per-run:**
- `prompt`, `generationModel`, `judgeModel` (required)
- `agentModels`: per-agent model overrides
- `iterations`: 1-30
- `budgetCapUsd`: positive
- `budgetCaps`: per-agent percentage caps (sum <= 1.0)
- `mode`: `'minimal' | 'full'`
- `bankCheckpoints`: optional array

### 11. Three Separate Execution Paths (Not Two)

The codebase has **three distinct** run execution paths, not two as initially documented:

**Path A — `run-batch.ts` (combinatorial experiment CLI):**
```
BatchConfig JSON → parse → expandBatchConfig() → estimateRunCosts() → filterByBudget()
→ INSERT evolution_batch_runs (status='pending')
→ sequential loop: executeEvolutionRun()
    → INSERT topics (or find 'Batch Experiments')
    → INSERT explanations (draft, prompt as content)
    → INSERT evolution_runs (status='claimed', batch_run_id set)
    → preparePipelineRun() + executeFullPipeline() inline
```
- **Bypasses queue**: runs are inserted with `status='claimed'` immediately
- **Sequential only**: no parallelism
- **Tracks batch**: `evolution_batch_runs` table with `execution_plan` JSONB, `spent_usd`, `runs_completed`
- **Resume support**: `--resume <batchId>` re-executes `pending` or `failed` runs
- **Security**: config path restricted to `evolution/experiments/` or `evolution/config/`

**Path B — `evolution-runner.ts` + `queueEvolutionRunAction` (production queue):**
```
Admin UI / cron → queueEvolutionRunAction() → INSERT evolution_runs (status='pending')
→ GitHub Actions dispatch → evolution-batch.yml
    → evolution-runner.ts [--parallel N --max-runs N]
        → claim_evolution_run RPC (FOR UPDATE SKIP LOCKED)
        → Promise.allSettled() parallel execution
```
- **Queue-based**: runs claimed atomically via RPC
- **Parallel**: configurable parallelism via `--parallel N`
- **Heartbeat**: 30s interval, stale detection by watchdog (10min threshold)
- **Continuation**: `checkpoint_and_continue` RPC for atomic status transition across Vercel timeouts

**Path C — `claimAndExecuteEvolutionRun` (Vercel cron + admin one-off):**
```
Vercel cron route / admin server action → claimAndExecuteEvolutionRun({ runnerId, targetRunId? })
→ claim_evolution_run RPC → resolve content → executeFullPipeline()
```
- Claims a specific run via `p_run_id` parameter or next available
- Handles both fresh and resumed runs
- Uses `generateSeedArticle()` for prompt-based runs (LLM call to produce seed text)

### 12. Run Status State Machine

The `evolution_runs.status` column implements this transition graph:

```
pending ──claim RPC──► claimed ──pipeline start──► running
                                                      │
                   ┌──────────────────────────────────┼────────────────────────┐
                   │                                  │                        │
                failed                     continuation_timeout          completed
    (markRunFailed in                 (checkpoint_and_continue       (finalizePipelineRun
     persistence.ts)                   RPC → continuation_pending)    in pipeline.ts)
                   │                          │
                   │              continuation_pending
                   │                          │
                   │              claim RPC (prioritized)
                   │                          │
                   │                       claimed → resume pipeline
                   └──────────────────────────┘

     paused ◄── BudgetExceededError (markRunPaused in persistence.ts)
```

Valid status values: `'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'paused' | 'continuation_pending'`

**Guarded writes:** `markRunFailed` and `markRunPaused` both check `.in('status', ['pending', 'claimed', 'running', 'continuation_pending'])` — refuse to overwrite completed runs. `finalizePipelineRun` checks `.in('status', ['running'])` — only completes a running run.

**Kill detection:** Each pipeline iteration loop polls the DB to check if the run was externally set to `failed` (pipeline.ts lines 364-374).

**Heartbeat system:**
- 30s interval in `evolutionRunnerCore.ts`; also refreshed on every checkpoint write
- Watchdog cron (`src/app/api/cron/evolution-watchdog/route.ts`): 10-minute stale threshold
- Stale runs with recent checkpoint → `continuation_pending` (recovery)
- Stale runs without checkpoint → `failed`
- `continuation_pending` runs not resumed within 30 minutes → `failed`

### 13. Real-Time Progress Patterns

**No SSE/WebSocket** in the evolution pipeline. All updates are polling-based.

**AutoRefreshProvider** (`evolution/src/components/evolution/AutoRefreshProvider.tsx`):
- Manages a `refreshKey: number` counter via React context
- Default polling interval: 5s (run detail page), 15s (dashboard)
- Visibility-aware: pauses incrementing when tab backgrounded; extra tick on tab return
- `isActive` guard: only polls when run is `'running'` or `'claimed'`
- Consumer pattern: tabs call `useAutoRefresh()`, add `refreshKey` to useEffect deps, call `reportRefresh()` on success

**RefreshIndicator** (same file, lines 97-130):
- 1-second interval computing "Xs ago" from `lastRefreshed` timestamp
- Green pulsing dot when `isActive`
- Manual refresh button calling `triggerRefresh()` → increments `refreshKey` immediately

**Each run detail tab fetches independently**, all keyed on `refreshKey`:
- TimelineTab, EloTab, BudgetSection, LogsTab — each has its own `useEffect([..., refreshKey])`

**EvolutionStatusBadge** (`evolution/src/components/evolution/EvolutionStatusBadge.tsx`):
| Status | Color | Icon | Display |
|--------|-------|------|---------|
| `pending` | amber | ⏳ | "pending" |
| `claimed` | gray | ▶ | "starting" |
| `running` | gold | ▶ | "running" |
| `completed` | green | ✓ | "completed" |
| `failed` | red | ✗ | "failed" |
| `paused` | muted gray | ⏸ | "paused" |
| `continuation_pending` | gold | ↻ | "resuming" |

**No `useTransition` or `useOptimistic`** anywhere in the codebase. Purely `useState` + `useEffect` + server actions.

### 14. Factor Interaction Effects — Deep Dive

**L8 column assignments** (`evolution/src/experiments/evolution/factorial.ts:55-64`):
```
Columns 0-4: Factors A-E (genModel, judgeModel, iterations, editor, supportAgents)
Column 5: unassigned → labeled "A×C" (interaction contrast)
Column 6: unassigned → labeled "A×E" (interaction contrast)
```

The interaction labels ("A×C", "A×E") are **by convention**, not derived algebraically from the L8 structure. They are only reported when columns 5-6 are genuinely unassigned (filtered at line 116: `ic.column >= factorKeys.length`).

**Interaction computation** uses the **same** `computeColumnEffect` function as main effects — it partitions rows by L8 column sign pattern and computes `avg(high) - avg(low)`. The column 5 sign pattern acts as a contrast vector encoding the interaction structure. This works because all L8 column pairs are orthogonal (verified by `verifyFullOrthogonality`).

**Significance threshold:** Interactions above `0.15 * |top.eloEffect|` get recommended for "test this combination explicitly in Round 2".

**Round 2+ mechanics** (`scripts/run-strategy-experiment.ts`):
- `--vary "factor=level1,level2,..."` defines dimensions for Cartesian product via `generateFullFactorial()`
- `--lock "factor=value"` pins factors at constant values (merged into every combo)
- `--vary` and `--lock` cannot overlap (conflict check at line 118)
- Locked values are NOT part of the Cartesian product; they're spread into every run

### 15. Experiment State File Structure

**Path:** `experiments/strategy-experiment.json` (created on first `run` command)

```typescript
interface ExperimentState {
  experimentId: string;        // "strategy-experiment-YYYY-MM-DD"
  prompt?: string;             // prompt used for all runs
  rounds: RoundState[];
}

interface RoundState {
  round: number;               // 1, 2, 3, ...
  type: 'screening' | 'refinement' | 'confirmation';
  design: 'L8' | 'full-factorial';
  factors: Record<string, FactorDefinition>;
  runs: ExperimentRun[];       // one per row in the design
  analysis?: AnalysisResult;   // written after analyze command
  lockedFactors?: Record<string, string | number>;  // Round 2+ only
}

interface ExperimentRun {
  row: number;
  runId: string;               // UUID from run output
  status: 'completed' | 'failed' | 'pending' | 'running';
  topElo?: number;             // parsed from "#1 [Elo]" in stdout
  costUsd?: number;            // parsed from "Total cost: $X" in stdout
  baselineRank?: number;       // unused field (never populated)
  stopReason?: string;         // unused field (never populated)
  error?: string;
}
```

Writes are atomic: temp file + `fs.renameSync` (lines 172-174).

### 16. `evolution_batch_runs` Table (Already Exists)

**Migration:** `20260205000004_add_batch_runs.sql`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | UUID PK | Batch identifier |
| `name` | TEXT | Batch name from config |
| `config` | JSONB | Full `BatchConfig` object |
| `status` | TEXT | `pending | running | completed | failed | paused | interrupted` |
| `total_budget_usd` | NUMERIC(10,2) | Budget ceiling |
| `spent_usd` | NUMERIC(10,4) | Running actual spend |
| `estimated_usd` | NUMERIC(10,4) | Pre-run estimate |
| `runs_planned` / `runs_completed` / `runs_failed` / `runs_skipped` | INT | Counters |
| `execution_plan` | JSONB | Array of `ExpandedRun` objects with per-run status/runId/actualCost/topElo |
| `results` | JSONB | Final summary: totalRuns, completed, failed, totalSpent, avgElo |

**`evolution_runs.batch_run_id`** foreign key links individual runs back to their batch.

### 17. `evolution_run_agent_metrics` Table — Population Details

**Schema** (`20260205000001`): `(run_id, agent_name, cost_usd, variants_generated, avg_elo, elo_gain, elo_per_dollar)`

**Population** (`evolution/src/lib/core/metricsWriter.ts:171`):
1. Called by `pipeline.ts:163` in the finalization `Promise.all` block
2. Gets `Record<agentName, costUsd>` from `costTracker.getAllAgentCosts()`
3. Maps strategies to agents via `STRATEGY_TO_AGENT` lookup (handles `critique_edit_*` → `iterativeEditing`, `section_decomposition_*` → `sectionDecomposition`)
4. Computes `avgElo` from raw OpenSkill `mu` values (baseline 25, **not** 1200)
5. `elo_gain = avgElo - 25` (raw mu scale, inconsistent with the 1200 column comment)
6. `elo_per_dollar = eloGain / costUsd`
7. Batch-upserts all rows with `onConflict: 'run_id,agent_name'`

### 18. `claim_evolution_run` RPC — Final Version

**Migration:** `20260222000001_fix_claim_evolution_run_overload.sql`

Signature: `claim_evolution_run(p_runner_id TEXT, p_run_id UUID DEFAULT NULL) RETURNS SETOF evolution_runs`

Key behaviors:
- `FOR UPDATE SKIP LOCKED`: concurrent runners each atomically get a different row
- Priority ordering: `continuation_pending` (priority 0) claimed before `pending` (priority 1)
- Optional `p_run_id`: claims specific run when set (admin-triggered targeted runs)
- Sets `status='claimed'`, `runner_id`, `last_heartbeat=NOW()`, `started_at=NOW()` (preserves existing `started_at` on resume)
- `SECURITY DEFINER` with grants only to `service_role`

### 19. Config Validation System — Complete Map

The codebase has **7 distinct validation layers** from UI to pipeline execution:

#### Layer 1: UI Client-Side (`strategies/page.tsx`)
- Name non-empty check (`toast.error`)
- `validateAgentSelection(enabledAgents)` via `useMemo` — live error display below agent grid
- `computeEffectiveBudgetCaps` — display-only budget preview
- HTML native constraints: `min={0.01} max={1} step={0.01}` for budget caps, `min={1} max={50}` for iterations
- Model selection via `<select>` with hardcoded `MODEL_OPTIONS` — no Zod validation client-side
- **No form validation library** — bare React controlled inputs with manual `if (!x)` guards

#### Layer 2: `toggleAgent` Cascade (`agentToggle.ts:12-37`)
- Pure function: returns new array, no errors thrown
- **Disable cascade**: disabling X removes all agents that depend on X (e.g., `reflection` → removes `iterativeEditing`, `treeSearch`, `sectionDecomposition`, `flowCritique`)
- **Enable cascade**: enabling X auto-enables its optional dependencies (e.g., `iterativeEditing` → adds `reflection`)
- Used only in `StrategyDialog` UI, not in any server action

#### Layer 3: `validateAgentSelection` (`budgetRedistribution.ts:125-142`)
- Checks `AGENT_DEPENDENCIES` — each enabled agent's deps must be in enabledSet or REQUIRED_AGENTS
- Returns `string[]` errors (empty = valid)
- Called in: UI live validation, `validateStrategyConfig`, `validateRunConfig`

#### Layer 4: `validateStrategyConfig` (`configValidation.ts:56-78`) — Lenient
- Only validates fields that are explicitly set (undefined = will use defaults)
- Checks: model names ∈ `ALLOWED_MODELS`, budget cap keys/values, agent dependencies, iterations > 0
- Called in: `buildRunConfig` at queue time (`evolutionActions.ts:296`)
- **NOT called in**: `createStrategyAction`, `updateStrategyAction`, `run-batch.ts`

#### Layer 5: `validateRunConfig` (`configValidation.ts:83-146`) — Strict
- All fields required and validated
- Additional checks: `budgetCapUsd > 0 && finite`, expansion constraints (`maxIterations >= expansion.maxIterations + plateau.window + 1`), per-component params (`generation.strategies > 0`, `calibration.opponents > 0`, `tournament.topK > 0`)
- Called in: `preparePipelineRun` and `prepareResumedPipelineRun` — throws if invalid

#### Layer 6: `resolveConfig` (`config.ts:73-89`) — Auto-Clamping
- Deep-merges `DEFAULT_EVOLUTION_CONFIG` with overrides
- Auto-clamps `expansion.maxIterations` if too high for `maxIterations` — emits `console.warn`
- No errors thrown — pure transformation
- Called before `validateRunConfig` in pipeline prepare

#### Layer 7: `BatchConfigSchema` (`batchRunSchema.ts`) — Zod Parse
- `BatchConfigSchema.parse(raw)` at batch CLI entry
- Model names via `allowedLLMModelSchema`, iterations 1-30, positive budget
- `AgentBudgetCapsSchema`: only 7 agents (vs 12 in `DEFAULT_EVOLUTION_CONFIG.budgetCaps`), sum <= 1.0 check
- **Batch CLI bypasses `validateStrategyConfig` entirely** — inserts directly into `evolution_runs.config`

#### Validation Flow Map

```
UI (strategies/page.tsx)          Server (queue time)              Pipeline (start time)
┌─────────────────────┐    ┌─────────────────────────────┐    ┌──────────────────────┐
│ name non-empty       │    │ requireAdmin()                │    │ resolveConfig()       │
│ toggleAgent cascade  │    │ DB existence checks           │    │   (auto-clamp, warn)  │
│ validateAgentSel.    │    │ enabledAgentsSchema.safeParse │    │ validateRunConfig()   │
│ (display only)       │    │   (Zod, warn-only on fail)    │    │   (hard throw)        │
│ HTML min/max attrs   │    │ validateStrategyConfig()      │    │ computeEffective-     │
│                      │    │   (hard throw on fail)        │    │   BudgetCaps()        │
│ No Zod, no lib       │    │ cost > budget check           │    │                       │
└─────────────────────┘    └─────────────────────────────┘    └──────────────────────┘
        │                            │                                 │
    createStrategyAction        queueEvolutionRunAction          preparePipelineRun
    (NO validation beyond        (calls buildRunConfig)          (final gate)
     name non-empty!)
```

#### Key Gaps and Asymmetries

| Issue | Detail |
|-------|--------|
| `createStrategyAction` has no config validation | A strategy with invalid model/agent/iteration values can be stored; fails only at queue or pipeline time |
| `AgentBudgetCapsSchema` has only 7 agents | `DEFAULT_EVOLUTION_CONFIG.budgetCaps` has 12 keys; `treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique`, `pairwise` are missing from Zod schema |
| Budget cap sum checked in batch schema only | `AgentBudgetCapsSchema.refine(sum <= 1.0)` exists; `validateBudgetCaps` in `configValidation.ts` does NOT check sum |
| `enabledAgentsSchema.safeParse` is non-blocking | Invalid agents silently dropped with `logger.warn`, not rejected |
| `resolveConfig` auto-clamp is invisible | Silently modifies `expansion.maxIterations`; only `console.warn`, not DB logger |
| Batch CLI bypasses `validateStrategyConfig` | Only `BatchConfigSchema.parse` + `validateRunConfig` at pipeline start; no intermediate check |
| `mapFactorsToPipelineArgs` not validated pre-experiment | The L8 design generates factor combinations but nobody validates they produce valid pipeline configs before queuing |

#### Factor Value Sources (for Registry)

| Factor | Source of Valid Values | File | Count |
|--------|----------------------|------|-------|
| Generation/Judge model | `allowedLLMModelSchema` | `src/lib/schemas/schemas.ts:118-124` | 12 models |
| Model pricing (for ordering) | `LLM_PRICING` array | `src/config/llmPricing.ts:14-75` | 26+ entries |
| Optional agents | `OPTIONAL_AGENTS` | `evolution/src/lib/core/budgetRedistribution.ts:15-19` | 9 agents |
| Required agents | `REQUIRED_AGENTS` | `budgetRedistribution.ts:10-13` | 4 agents |
| Agent dependencies | `AGENT_DEPENDENCIES` | `budgetRedistribution.ts:35-42` | 6 entries |
| Iterations | `validateRunConfig` enforces `> 0`; practical max ~30 | `configValidation.ts:100` | 1-30 |
| Pipeline modes | `PIPELINE_TYPES` | `evolution/src/lib/types.ts:575-577` | 4 modes |
| Budget cap keys | `VALID_BUDGET_CAP_KEYS` (from `DEFAULT_EVOLUTION_CONFIG.budgetCaps`) | `configValidation.ts:21` | 12 keys |
| L8 default factors | `DEFAULT_ROUND1_FACTORS` | `factorial.ts:73-79` | 5 factors |
| Strategy presets | `getStrategyPresets()` | `strategyRegistryActions.ts:374-413` | 3 presets |

### 20. Prior Art: Related Project Research

**Optimize Elo Over Fixed Budget** (`docs/planning/optimize_elo_over_fixed_budget_20260204/`):
- Covers budget enforcement (3-tier: pre-call reservation, per-agent caps, supervisor stopping)
- Details per-agent cost tracking infrastructure, cost estimation gaps
- Proposes `evolution_agent_cost_baselines` table (not yet implemented)
- Defines batch config schema (which was subsequently implemented in `batchRunSchema.ts`)
- Outlines adaptive budget allocation using agent ROI data
- Decisions: mean Elo of top-K articles per config as success metric, article bank as reference population, K=3 top articles per run

**Develop Tree-of-Thought Revisions Strategy** (`docs/planning/develop_tree_of_thought_revisions_strat_20260205/`):
- Documents tree search as a revision strategy using MCTS, BFS, DFS, Beam Search
- Identifies existing tree-like support via `TextVariation.parentIds`
- OpenSkill `ordinal = mu - 3σ` as value function; `sigma` as exploration term
- Key insight: "search time can compensate for model capability on refinement tasks" — cheap models exploring multiple revision paths often outperform expensive single-pass models
- The `treeSearch` factor in the L8 design (Factor D) is the toggle for this agent

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/strategy_experiments.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/reference.md

## Code Files Read

### Strategy Experiment System
- `evolution/src/experiments/evolution/factorial.ts` — L8 array, factor definitions, config mapping
- `evolution/src/experiments/evolution/analysis.ts` — Main effects, interactions, ranking, recommendations
- `evolution/src/experiments/evolution/factorial.test.ts` — 15 tests
- `evolution/src/experiments/evolution/analysis.test.ts` — 14 tests
- `scripts/run-strategy-experiment.ts` — CLI orchestrator (plan/run/analyze/status)

### Optimization Dashboard
- `evolution/src/services/eloBudgetActions.ts` — 9 server actions (leaderboard, Pareto, ROI, recommendations, summary)
- `evolution/src/services/costAnalyticsActions.ts` — 2 cost accuracy actions
- `src/app/admin/quality/optimization/page.tsx` — Dashboard layout with 4 tabs
- `src/app/admin/quality/optimization/_components/StrategyLeaderboard.tsx`
- `src/app/admin/quality/optimization/_components/StrategyParetoChart.tsx`
- `src/app/admin/quality/optimization/_components/AgentROILeaderboard.tsx`
- `src/app/admin/quality/optimization/_components/CostSummaryCards.tsx`
- `src/app/admin/quality/optimization/_components/CostBreakdownPie.tsx`
- `src/app/admin/quality/optimization/_components/CostAccuracyPanel.tsx`
- `src/app/admin/quality/optimization/_components/StrategyDetail.tsx`
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx`

### Batch Execution
- `src/config/batchRunSchema.ts` — Zod schemas, expansion, budget filter
- `evolution/scripts/run-batch.ts` — CLI batch orchestrator
- `evolution/scripts/evolution-runner.ts` — GitHub Actions worker
- `evolution/src/services/evolutionRunnerCore.ts` — Shared claim→execute core
- `evolution/src/services/evolutionActions.ts` — queueEvolutionRunAction
- `evolution/src/services/evolutionBatchActions.ts` — GitHub Actions dispatch
- `evolution/src/services/evolutionRunClient.ts` — Browser fetch wrapper
- `src/app/api/evolution/run/route.ts` — Unified runner endpoint
- `.github/workflows/evolution-batch.yml` — GitHub Actions workflow
- `supabase/migrations/20260222000001_fix_claim_evolution_run_overload.sql` — claim RPC

### Factor Configuration
- `evolution/src/lib/core/budgetRedistribution.ts` — Agent classification, dependencies, budget redistribution
- `evolution/src/lib/core/agentToggle.ts` — Toggle utility with cascade enable/disable
- `evolution/src/lib/core/strategyConfig.ts` — Hashing, labeling, StrategyConfig type
- `evolution/src/lib/core/configValidation.ts` — Strategy + run config validation
- `evolution/src/lib/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig()
- `evolution/src/lib/types.ts` — EvolutionRunConfig, AgentName, StrategyConfig types
- `evolution/src/services/strategyRegistryActions.ts` — CRUD, 3 presets

### UI Patterns
- `src/app/admin/quality/strategies/page.tsx` — Agent checkboxes, preset selector, budget preview
- `src/app/admin/quality/evolution/page.tsx` — StartRunCard, BatchDispatchButtons
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — AutoRefreshProvider, BudgetBar, tabs
- `evolution/src/components/evolution/AutoRefreshProvider.tsx` — Polling context, RefreshIndicator
- `evolution/src/components/evolution/EvolutionStatusBadge.tsx` — Status colors, icons, display labels
- `evolution/src/components/evolution/RunsTable.tsx` — Shared table component
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Budget section, refresh pattern
- `src/components/admin/EvolutionSidebar.tsx` — Navigation structure
- `src/components/admin/BaseSidebar.tsx` — Sidebar rendering

### Convergence & Stopping
- `evolution/src/lib/core/supervisor.ts` — Plateau detection, phase transitions, 4 stopping conditions
- `evolution/src/lib/core/rating.ts` — OpenSkill Bayesian rating, `isConverged()`, `DEFAULT_CONVERGENCE_SIGMA=3.0`
- `evolution/src/lib/agents/tournament.ts` — Sigma-based convergence, budget-adaptive comparisons
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — Quality threshold stopping, max cycles
- `evolution/src/lib/core/configValidation.ts` — Validation constraints for plateau/iterations

### Strategy Config & Metrics
- `evolution/src/lib/core/strategyConfig.ts` — Hash algorithm, label generation, config extraction
- `evolution/src/lib/core/metricsWriter.ts` — `linkStrategyConfig`, `persistAgentMetrics`, aggregate updates
- `evolution/src/lib/core/pipeline.ts` — Finalization block calling all metric writers
- `supabase/migrations/20260205000005_add_strategy_configs.sql` — strategy_configs table + RPC
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` — agent metrics table
- `supabase/migrations/20260205000004_add_batch_runs.sql` — batch_runs table
- `supabase/migrations/20260215000003_strategy_aggregates_for_update.sql` — FOR UPDATE lock
- `supabase/migrations/20260221000002_evolution_table_rename.sql` — Final table names + RPC

### State Machine & Progress
- `evolution/src/services/evolutionRunnerCore.ts` — `claimAndExecuteEvolutionRun`, heartbeat, resume
- `evolution/src/lib/core/persistence.ts` — Checkpoint writes, `markRunFailed/Paused`
- `src/app/api/cron/evolution-watchdog/route.ts` — Stale detection, 10-min threshold
- `supabase/migrations/20260216000001_add_continuation_pending_status.sql` — continuation support
- `supabase/migrations/20260222000001_fix_claim_evolution_run_overload.sql` — Final claim RPC

### Config Validation
- `evolution/src/lib/core/configValidation.ts` — `validateStrategyConfig` (lenient), `validateRunConfig` (strict), `validateBudgetCaps`, `ALLOWED_MODELS`, `VALID_BUDGET_CAP_KEYS`
- `evolution/src/lib/core/budgetRedistribution.ts` — `validateAgentSelection`, `enabledAgentsSchema` (Zod), `computeEffectiveBudgetCaps`, `AGENT_DEPENDENCIES`
- `evolution/src/lib/core/agentToggle.ts` — `toggleAgent` cascade enable/disable
- `evolution/src/lib/config.ts` — `resolveConfig` deep merge + auto-clamp
- `evolution/src/lib/index.ts` — `preparePipelineRun`, `prepareResumedPipelineRun` (final validation gate)
- `evolution/src/services/evolutionActions.ts` — `buildRunConfig`, `queueEvolutionRunAction` (queue-time validation)
- `src/lib/schemas/schemas.ts` — `allowedLLMModelSchema` (12 models, source of truth)
- `src/config/llmPricing.ts` — `LLM_PRICING` (model pricing for ordering)
- `src/app/admin/quality/strategies/page.tsx` — UI agent checkbox grid, client-side validation
- `src/app/admin/quality/strategies/strategyFormUtils.ts` — `formToConfig`, `FormState` type
- `evolution/src/services/strategyRegistryActions.ts` — CRUD with no `validateStrategyConfig` call

### Integration Tests
- `scripts/run-strategy-experiment.test.ts` — CLI integration tests (plan/analyze/status commands)

## Architecture Summary

### What Exists (Fully Implemented)
```
[L8 Design] ──► [Run Execution] ──► [Analysis] ──► [Recommendations]
factorial.ts    run-strategy-      analysis.ts     analysis.ts
                experiment.ts                      generateRecommendations()
                (CLI subprocess)

[Dashboard] ◄── [Server Actions] ◄── [DB Tables]
page.tsx        eloBudgetActions    evolution_strategy_configs
4 tabs          .ts (9 actions)     evolution_run_agent_metrics
                                    evolution_runs
```

### What's Missing (The Automation Gap)
```
                    ┌─────────────────────────────────┐
                    │  MISSING: Experiment Orchestrator │
                    │                                   │
UI Trigger ──►      │  plan(factors) → queue runs →     │
                    │  wait for completion → analyze →   │
                    │  decide: refine or stop →          │
                    │  queue Round 2 runs → ...          │
                    │                                   │
Progress UI ◄──     │  emit progress events              │
                    └─────────────────────────────────┘
```

### Execution Path Options
1. **Queue-based** (recommended): Orchestrator queues runs via `queueEvolutionRunAction`, monitors via DB polling, runs via existing cron/GH Actions infrastructure
2. **CLI-based** (current): Shell out to subprocess, scrape stdout — not suitable for production

### Factor Selection Approaches
The current L8 collapses agent selection into a binary (on/off). More granular options:
- Individual agent toggles (checkbox grid, like strategies page)
- Agent group presets (editing group, support group, etc.)
- Custom factor definitions with arbitrary low/high values
- Predefined experiment templates (model comparison, agent ablation, iteration sweep)

### Full Architecture: Three Execution Paths
```
Path A — run-batch.ts (combinatorial CLI)          Path B — queue + runner (production)

BatchConfig JSON                                   Admin UI / cron
    │                                                   │
    ▼                                              queueEvolutionRunAction()
expandBatchConfig() ── Cartesian product               │
    │                                              INSERT evolution_runs (pending)
estimateRunCosts()                                      │
    │                                              GitHub Actions dispatch
filterByBudget() ── greedy selection                    │
    │                                              evolution-runner.ts --parallel N
INSERT evolution_batch_runs                             │
    │                                              claim_evolution_run RPC
sequential loop:                                   (FOR UPDATE SKIP LOCKED)
    INSERT evolution_runs (claimed)                     │
    executeFullPipeline() inline                   Promise.allSettled()
    update batch_runs metrics                      parallel executeFullPipeline()

Path C — claimAndExecuteEvolutionRun (Vercel/admin)
    claim_evolution_run RPC (optional targetRunId)
    resolve content (explanation or prompt→seed)
    executeFullPipeline()
```

### Experiment Automation Gap — Detailed
```
                         ┌────────────────────────────────────────────┐
What the orchestrator    │  1. Accept (factors, budget, prompts, target│
must do:                 │     optimization metric)                    │
                         │  2. Generate L8 design for factors          │
                         │  3. Queue 8 runs via existing batch system  │
                         │  4. Monitor run completion via DB polling   │
                         │  5. Run analyzeExperiment() when all done   │
                         │  6. Check convergence criteria:             │
                         │     - Top effect < absolute threshold?      │
                         │     - Budget remaining for another round?   │
                         │     - Max rounds reached?                   │
                         │  7. If continuing: generate Round 2 design  │
                         │     from recommendations (--vary/--lock)    │
                         │  8. Queue Round 2 runs → repeat from 4     │
                         │  9. Write results to strategy leaderboard   │
                         └────────────────────────────────────────────┘

What exists:             What's missing:
✓ L8 design generation   ✗ Round-to-round orchestration loop
✓ Full factorial gen      ✗ Convergence detection between rounds
✓ Main effects analysis   ✗ Automatic --vary/--lock derivation
✓ Recommendations         ✗ DB-persisted experiment state (vs JSON file)
✓ Batch run tracking      ✗ UI for experiment configuration/monitoring
✓ Queue/claim system      ✗ Integration of recommendations → next round
✓ Strategy leaderboard    ✗ Experiment-level progress server actions
✓ Pareto frontier         ✗ Statistical significance of factor effects
✓ AutoRefreshProvider     ✗ getRecommendedStrategyAction wired to UI
```

### Key Inconsistencies Found

| Issue | Location | Detail |
|-------|----------|--------|
| `stddev_final_elo` never populated | `update_strategy_aggregates` RPC | Column exists in schema, rendered in UI, always null |
| Elo scale inconsistency | `metricsWriter.ts` vs `eloBudgetActions.ts` | Agent metrics use raw mu (baseline 25), strategy aggregates use display Elo (baseline 1200) |
| `baselineRank` / `stopReason` unused | `ExperimentRun` type in `analysis.ts` | Fields declared but never written by any code path |
| `commandAnalyze` hardcoded to L8 | `run-strategy-experiment.ts` | Always calls `generateL8Design()` — wrong for Round 2+ full-factorial |
| Interaction labels by convention | `factorial.ts:113-116` | "A×C" and "A×E" labels are not algebraically derived from L8 structure |

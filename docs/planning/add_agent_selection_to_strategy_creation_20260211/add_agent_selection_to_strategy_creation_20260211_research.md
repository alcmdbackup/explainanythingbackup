# Add Agent Selection To Strategy Creation Research

## Problem Statement
When creating a strategy, user should be able to click checkboxes to enable/disable different types of agents. We need to have safeguards in place though to make sure that agents that are absolutely necessary are not disabled. Agents that must be run together must also be enabled together. We should also add an option to enable full pipeline vs. single article pipeline.

## Requirements (from GH Issue #403)
When creating a strategy, user should be able to click checkboxes to enable/disable different types of agents. We need to have safeguards in place though to make sure that agents that are absolutely necessary are not disabled. Agents that must be run together must also be enabled together.

We should also add an option to enable full pipeline vs. single article pipeline.

## High Level Summary

The evolution pipeline has 12 agents organized across two phases (EXPANSION and COMPETITION). Currently, agent enablement is controlled by **system-wide feature flags** in the `feature_flags` DB table, not per-strategy. The strategy creation UI (`/admin/quality/strategies`) has fields for model, iterations, and budget — but **no agent selection UI exists**. The `StrategyConfig` type stores `generationModel`, `judgeModel`, `agentModels`, `iterations`, and `budgetCaps` — but has no field for enabled/disabled agents. The `EvolutionRunConfig` type has a `singleArticle` boolean that controls full vs single-article pipeline mode. Adding per-strategy agent selection requires extending `StrategyConfig`, adding UI checkboxes with validation rules, and wiring the selection through the pipeline execution path where feature flags currently gate agents.

---

## Key Findings

### 1. Agent Classification: Required vs Optional

**REQUIRED agents** (pipeline breaks without them — checkboxes must be locked):
| Agent | Phase | Why Required |
|-------|-------|-------------|
| GenerationAgent | E, C | Creates the variant pool — no pool = no pipeline |
| CalibrationRanker | E, C | Rates new entrants; rankings drive everything downstream |
| Tournament | E, C | Comprehensive ranking for parent selection and convergence |
| ProximityAgent | E, C | Diversity score gates EXPANSION→COMPETITION transition |

**OPTIONAL agents** (can be safely toggled):
| Agent | Phase | Feature Flag | Default |
|-------|-------|-------------|---------|
| ReflectionAgent | C | (none — always runs) | enabled |
| IterativeEditingAgent | C | `evolution_iterative_editing_enabled` | enabled |
| TreeSearchAgent | C | `evolution_tree_search_enabled` | disabled |
| SectionDecompositionAgent | C | `evolution_section_decomposition_enabled` | enabled |
| DebateAgent | C | `evolution_debate_enabled` | enabled |
| EvolutionAgent | C | `evolution_evolve_pool_enabled` | enabled |
| OutlineGenerationAgent | C | `evolution_outline_generation_enabled` | disabled |
| MetaReviewAgent | C | (none — always runs) | enabled |
| FlowCritique | C | `evolution_flow_critique_enabled` | disabled |

### 2. Agent Co-Dependency Rules

**Tight dependencies (must enable together):**
- **ReflectionAgent → IterativeEditingAgent**: Iterative editing requires critiques from reflection (`canExecute` checks `allCritiques.length > 0`)
- **ReflectionAgent → TreeSearchAgent**: Tree search requires critiques for root selection
- **ReflectionAgent → SectionDecompositionAgent**: Section decomp requires critiques for weakness targeting
- **Tournament → EvolutionAgent**: Evolution reads `ratings` for parent selection
- **Tournament → MetaReviewAgent**: MetaReview reads `ratings` for strategy analysis

**Mutual exclusivity:**
- **TreeSearchAgent ⊕ IterativeEditingAgent**: Feature flag system already enforces this (`treeSearchEnabled → iterativeEditingEnabled = false`)

**Loose dependencies (optional but beneficial):**
- ProximityAgent → EvolutionAgent: Diversity triggers creative exploration
- MetaReviewAgent → GenerationAgent/EvolutionAgent: Meta-feedback steers generation
- ReflectionAgent → DebateAgent: Critiques provide debate context (optional)

### 3. Current Agent Gating Flow

```
EvolutionRunConfig
  → supervisorConfigFromRunConfig()
    → PoolSupervisor
      → getPhaseConfig() returns PhaseConfig with boolean flags:
          runGeneration, runCalibration, runProximity,
          runOutlineGeneration, runReflection, runIterativeEditing,
          runTreeSearch, runSectionDecomposition, runDebate,
          runEvolution, runMetaReview

Pipeline loop (executeFullPipeline):
  for each agent:
    1. Check PhaseConfig.runAgent (supervisor gate)
    2. Check EvolutionFeatureFlags (system-wide gate)
    3. Check agent.canExecute(state) (state prerequisite gate)
    → If all pass → agent.execute()
```

Feature flags are loaded from DB via `fetchEvolutionFeatureFlags()` and passed as `FullPipelineOptions.featureFlags`. They provide a **secondary** gate — phase config gates first, then feature flags can disable despite phase config allowing.

### 4. Pipeline Agent Gating: Exact Code Structure

The pipeline groups agents into three execution blocks with different gating patterns:

**Block 1 — `preEditAgents` array** (outline generation, reflection):
```typescript
const preEditAgents = [
  { configKey: 'runOutlineGeneration', agent: agents.outlineGeneration, flagKey: 'outlineGenerationEnabled' },
  { configKey: 'runReflection', agent: agents.reflection },
];
```
Pattern: `if (!config[configKey] || !agent) continue; if (flagKey && flags?.[flagKey] === false) continue;`

**Block 2 — Standalone flowCritique**:
```typescript
if (config.runReflection && flags?.flowCritiqueEnabled === true) { ... }
```
Note: Uses `=== true` (opt-in) unlike others which use `=== false` (opt-out). Not a PipelineAgent class; standalone function `runFlowCritiques()`.

**Block 3 — `flagGatedAgents` array** (editing, debate, evolution):
```typescript
const flagGatedAgents = [
  { configKey: 'runIterativeEditing', agent: agents.iterativeEditing, flagKey: 'iterativeEditingEnabled' },
  { configKey: 'runTreeSearch', agent: agents.treeSearch, flagKey: 'treeSearchEnabled' },
  { configKey: 'runSectionDecomposition', agent: agents.sectionDecomposition, flagKey: 'sectionDecompositionEnabled' },
  { configKey: 'runDebate', agent: agents.debate, flagKey: 'debateEnabled' },
  { configKey: 'runEvolution', agent: agents.evolution, flagKey: 'evolvePoolEnabled' },
];
```

**Standalone agents** (not in arrays):
- **Generation**: `if (config.runGeneration)` — no feature flag
- **Ranking**: `const useTournament = phase === 'COMPETITION' && flags?.tournamentEnabled !== false;`
- **Proximity**: `if (config.runProximity && agents.proximity)`
- **MetaReview**: `if (config.runMetaReview && agents.metaReview)`

**Execution order per iteration**: Generation → OutlineGeneration → Reflection → FlowCritique → IterativeEditing → TreeSearch → SectionDecomposition → Debate → Evolution → Calibration/Tournament → Proximity → MetaReview

### 5. `PipelineAgents` Type: Required vs Optional Properties

```typescript
export interface PipelineAgents {
  generation: PipelineAgent;              // REQUIRED (no ?)
  calibration: PipelineAgent;             // REQUIRED
  tournament: PipelineAgent;              // REQUIRED
  evolution: PipelineAgent;               // REQUIRED
  reflection?: PipelineAgent;             // optional
  iterativeEditing?: PipelineAgent;       // optional
  treeSearch?: PipelineAgent;             // optional
  sectionDecomposition?: PipelineAgent;   // optional
  debate?: PipelineAgent;                 // optional
  proximity?: PipelineAgent;              // optional
  metaReview?: PipelineAgent;             // optional
  outlineGeneration?: PipelineAgent;      // optional
}
```

### 6. Current Strategy Creation UI — Detailed

**Location:** `/admin/quality/strategies` (`src/app/admin/quality/strategies/page.tsx`)

**FormState interface:**
```typescript
interface FormState {
  name: string;
  description: string;
  pipelineType: PipelineType;     // 'full' | 'minimal' | 'batch' — NO 'single'
  generationModel: string;
  judgeModel: string;
  iterations: number;             // 1-50
  budgetCap: number;              // 0.01-1.0 (generation % only)
}
```

**Form → StrategyConfig mapping:**
```typescript
const formToConfig = (form: FormState): StrategyConfig => ({
  generationModel: form.generationModel,
  judgeModel: form.judgeModel,
  iterations: form.iterations,
  budgetCaps: {
    generation: form.budgetCap,
    calibration: 0.15,            // HARDCODED
    tournament: 0.20,             // HARDCODED
  },
});
```

**Presets:** Economy (minimal, 2 iters), Balanced (full, 3 iters), Quality (full, 5 iters, gpt-4.1), Blank.

**Pipeline type dropdown options:** `['full', 'minimal', 'batch']` — no 'single' option.

**Validation:** Only name required. No cross-field validation.

**What's missing:** No agent selection checkboxes. No single-article pipeline option. Only generation budget cap is user-editable (calibration/tournament are hardcoded).

### 7. Strategy Config Type & Hash

```typescript
// src/lib/evolution/core/strategyConfig.ts
export interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;
  iterations: number;
  budgetCaps: Record<string, number>;
  // NO agent enablement fields exist
}
```

`hashStrategyConfig()` hashes `generationModel`, `judgeModel`, `agentModels`, `iterations`, `budgetCaps`. Agent enablement fields must be added to the hash if they become part of `StrategyConfig`.

### 8. Strategy Config DB Schema

**`strategy_configs` table columns:**
- `id` UUID PK, `config_hash` TEXT UNIQUE, `name` TEXT NOT NULL, `description` TEXT
- `label` TEXT NOT NULL, `config` JSONB NOT NULL, `is_predefined` BOOLEAN
- `pipeline_type` TEXT CHECK ('full','minimal','batch') or NULL
- `status` TEXT ('active'|'archived'), `created_by` TEXT ('system'|'admin')
- Aggregate metrics: `run_count`, `total_cost_usd`, `avg_final_elo`, etc.

**CHECK constraint on pipeline_type** in DB: only allows 'full', 'minimal', 'batch' — the 'single' value exists in the TypeScript type but NOT in the DB constraint.

**RPC function:** `update_strategy_aggregates(p_strategy_id, p_cost_usd, p_final_elo)` updates run_count, totals, and averages.

### 9. Config Flow: Queue → Execute

```
Admin UI: queueEvolutionRunAction({ strategyId, budgetCapUsd })
    ↓
content_evolution_runs INSERT {
  strategy_config_id: strategyId,
  config: {},                          ← INTENTIONALLY EMPTY
  budget_cap_usd: from strategy or override,
}
    ↓
Cron/Manual trigger:
  1. Fetch run row (config = {})
  2. Fetch feature_flags (SYSTEM-WIDE, not per-strategy)
  3. preparePipelineRun({ configOverrides: run.config ?? {} })
     → resolveConfig({}) → DEFAULT_EVOLUTION_CONFIG
  4. executeFullPipeline(agents, ctx, { featureFlags })
```

**Critical finding:** The run's `config` JSONB is empty — strategy config lives in `strategy_configs` via FK. Feature flags are fetched globally from `feature_flags` table, not per-strategy. **No per-strategy agent enablement mechanism currently exists.**

### 10. Pipeline Mode: Full vs Single Article

`singleArticle` field on `EvolutionRunConfig`:
- When `true`: Skips EXPANSION entirely (`expansion.maxIterations: 0`), enters COMPETITION immediately
- Disables GenerationAgent, OutlineGenerationAgent, EvolutionAgent in COMPETITION
- Only improvement agents run: Reflection, IterativeEditing, TreeSearch, SectionDecomposition, Debate
- Stops early when all critique dimensions ≥ 8 (quality threshold)
- Sets `pipeline_type = 'single'` on the run

Currently only accessible via CLI (`--single-article` flag in `run-evolution-local.ts`), not via admin UI.

### 11. Budget Cap Architecture

**Two-level budget enforcement** — per-agent caps + global cap:

```
CostTrackerImpl {
  budgetCapUsd: number;                    // Global cap (e.g. $5.00)
  budgetCaps: Record<string, number>;      // Per-agent % allocations
  spentByAgent: Map<string, number>;       // Actual spend per agent
  reservedByAgent: Map<string, number>;    // Pre-reserved per agent
  totalSpent: number;
  totalReserved: number;
}
```

**Before every LLM call** (`costTracker.reserveBudget(agentName, estimate)`):
1. Adds 30% safety margin: `withMargin = estimate * 1.3`
2. Checks per-agent cap: `agentSpent + withMargin ≤ agentCapPct * budgetCapUsd`
3. Checks global cap: `totalSpent + totalReserved + withMargin ≤ budgetCapUsd`
4. Throws `BudgetExceededError` → pipeline pauses run, persists checkpoint

**Between iterations** (`supervisor.shouldStop(availableBudget)`):
- Stops if `availableBudget < $0.01` (minBudget)
- Stops on quality plateau (COMPETITION only)
- Stops on max iterations

**Key files:**
- `src/lib/evolution/core/costTracker.ts` — CostTrackerImpl, reserveBudget(), recordSpend()
- `src/lib/evolution/core/llmClient.ts` — calls reserveBudget before every LLM call
- `src/lib/evolution/core/pipeline.ts` — checks shouldStop() between iterations
- `src/lib/evolution/core/supervisor.ts` — shouldStop() logic

### 12. Default Budget Caps (Per-Agent Allocation %)

From `DEFAULT_EVOLUTION_CONFIG.budgetCaps` in `src/lib/evolution/config.ts`:

| Agent | Budget % | Default $5 Run |
|-------|----------|----------------|
| generation | 20% | $1.00 |
| calibration | 15% | $0.75 |
| tournament | 20% | $1.00 |
| evolution | 10% | $0.50 |
| reflection | 5% | $0.25 |
| debate | 5% | $0.25 |
| iterativeEditing | 5% | $0.25 |
| treeSearch | 10% | $0.50 |
| outlineGeneration | 10% | $0.50 |
| sectionDecomposition | 10% | $0.50 |
| flowCritique | 5% | $0.25 |
| **Total** | **115%** | — |

**Intentionally sums >100%** — not all agents run every iteration, so percentages overlap safely.

### 13. Preset Budget Strategies

From `getStrategyPresets()` in `src/lib/services/strategyRegistryActions.ts`:

| Preset | Pipeline | Iters | Gen Model | Judge Model | Budget Caps |
|--------|----------|-------|-----------|-------------|-------------|
| Economy | minimal | 2 | deepseek-chat | gpt-4.1-nano | gen:30%, cal:30%, tourn:40% |
| Balanced | full | 3 | gpt-4.1-mini | gpt-4.1-nano | DEFAULT_EVOLUTION_CONFIG |
| Quality | full | 5 | gpt-4.1 | gpt-4.1-mini | DEFAULT_EVOLUTION_CONFIG |

**No preset adjusts budget caps based on which agents are enabled.** Economy only runs 3 agents (generation, calibration, tournament) so only allocates to those 3.

### 14. Agent Cost Profiles

**LLM call volume per iteration** (from `costEstimator.ts`):

| Agent | Calls/Iteration | Model Used | Cost Tier |
|-------|----------------|------------|-----------|
| Tournament | ~50 (25 matches × 2 directions) | judgeModel (nano) | HIGH volume, LOW per-call |
| CalibrationRanker | 18-30 (opponents × entrants × 2) | judgeModel (nano) | HIGH volume, LOW per-call |
| GenerationAgent | 3 (one per strategy) | generationModel (mini) | LOW volume, MED per-call |
| IterativeEditingAgent | 6 (2 dims × 3 passes) | generationModel (mini) | MED volume, MED per-call |
| DebateAgent | 4 (2 advocates + judge + synthesis) | generationModel (mini) | LOW volume, MED per-call |
| EvolutionAgent | 3 (mutations) | generationModel (mini) | LOW volume, MED per-call |
| ReflectionAgent | 3 (reviews) | generationModel (mini) | LOW volume, LOW per-call |
| OutlineGenerationAgent | 6 (multi-step pipeline) | generationModel (mini) | MED volume, MED per-call |
| TreeSearchAgent | K×B×D gen + 30×D eval | generationModel (mini) | HIGH volume, HIGH per-call |
| SectionDecompositionAgent | H2_count × edit pipeline | generationModel (mini) | VARIABLE |
| ProximityAgent | 0 (embeddings only) | — | ZERO LLM cost |
| MetaReviewAgent | 0 (computation only) | — | ZERO LLM cost |

**Cost ranking** (typical 15-iteration full run):
1. **Calibration** — ~354 judge calls (highest volume)
2. **Tournament** — ~350 judge calls
3. **TreeSearch** — beam search multiplies calls (if enabled)
4. **IterativeEditing** — ~42 generation calls
5. **Generation** — ~45 generation calls
6. **Debate** — ~28 generation calls
7. **Evolution** — ~21 generation calls
8. **Reflection** — ~21 generation calls (short outputs)
9. **OutlineGeneration** — ~6 generation calls per iteration
10. **SectionDecomposition** — variable
11. **Proximity/MetaReview** — zero LLM cost

### 15. Per-Agent Cost Tracking & Persistence

**Fully implemented.** `CostTracker.getAllAgentCosts()` returns `Record<string, number>` with exact per-agent spend.

**DB table:** `evolution_run_agent_metrics`
```sql
CREATE TABLE evolution_run_agent_metrics (
  run_id UUID REFERENCES content_evolution_runs(id),
  agent_name TEXT NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  variants_generated INT DEFAULT 0,
  avg_elo NUMERIC(8, 2),
  elo_gain NUMERIC(8, 2),           -- avg_elo - 25 (OpenSkill baseline)
  elo_per_dollar NUMERIC(12, 2),    -- ROI metric
  UNIQUE (run_id, agent_name)
);
```

**Persisted at run completion** by `persistAgentMetrics()` in `pipeline.ts`.

**Dashboard visualization** at `/admin/quality/optimization`:
- `AgentROILeaderboard` — agents ranked by Elo/dollar
- `CostBreakdownPie` — donut chart of % budget per agent
- `CostAccuracyPanel` — estimated vs actual per-agent costs

### 16. Budget Behavior When Agents Are Disabled

**Current behavior: budget is NOT redistributed.** Disabled agents simply spend $0, leaving their allocation as unused headroom.

Example — disabling DebateAgent on a $5 run:
- Debate cap = 5% × $5 = $0.25
- That $0.25 stays unallocated (not shifted to other agents)
- Global budget still $5, but only ~$4.75 is reachable
- Pipeline may terminate earlier on quality plateau or max iterations

**Implication for agent selection feature:**
- When users disable agents, the effective budget shrinks
- Could either: (a) leave as-is (simpler), (b) redistribute freed budget to remaining agents, or (c) auto-reduce total budget to match enabled agents

### 17. Single-Article Mode Budget Impact

When `singleArticle: true`:
- **Skips EXPANSION entirely** (expansion.maxIterations: 0)
- **Disables in COMPETITION**: GenerationAgent, OutlineGenerationAgent, EvolutionAgent
- **Cost reduction**: ~60-70% less than full pipeline
- **Budget NOT auto-adjusted** — same budgetCapUsd applies
- **Recommended**: Lower budgetCapUsd to ~$1.00 for single-article runs

Phase cost comparison:
| Phase | Cost/Iteration | Typical Iterations | Total |
|-------|---------------|-------------------|-------|
| EXPANSION | ~$0.25-0.35 | 8 | ~$2.00-2.80 |
| COMPETITION | ~$0.50-0.70 | 7 | ~$3.50-4.90 |
| Single-article | ~$0.15-0.25 | 7 | ~$1.05-1.75 |

### 18. Adaptive Budget Allocation (Exists But Unused)

`src/lib/evolution/core/adaptiveAllocation.ts` exports:
- `computeAdaptiveBudgetCaps()` — shifts budget proportional to agent ROI (Elo/dollar)
- `budgetPressureConfig()` — adjusts agent aggressiveness based on remaining budget
- **NOT wired into production** — TODO comment: "Wire into pipeline"
- Applies floor (5%) and ceiling (40%) bounds per agent
- Requires 10+ historical samples per agent

### 19. Cost Estimation at Queue Time

`estimateRunCostWithAgentModels()` in `src/lib/evolution/core/costEstimator.ts`:
- Called at queue time, stored as `estimated_cost_usd` on run row
- Uses historical baselines from `agent_cost_baselines` table (50+ samples = high confidence)
- Falls back to token-count heuristics (~1 token per 4 chars)
- Returns per-agent breakdown in `cost_estimate_detail` JSONB column

### 20. Budget Implications for Agent Selection Feature

**Key decisions needed:**

1. **Should disabling agents reduce the total budget cap?**
   - Option A: No change — unused budget is headroom (simplest)
   - Option B: Auto-scale budgetCapUsd proportional to enabled agents' allocations
   - Option C: Redistribute freed percentage to remaining agents (keep total same)

2. **Should the UI show estimated cost impact?**
   - Historical per-agent costs from `evolution_run_agent_metrics` are available
   - `costEstimator.ts` can estimate per-agent costs for the selected config
   - Could show: "Disabling debate saves ~$0.25/run"

3. **Should presets update when agents are toggled?**
   - Economy preset only allocates to 3 agents — if user enables more, should budget rebalance?
   - Quality preset assumes full pipeline — disabling agents wastes allocated budget

4. **Should per-agent budget caps be editable in the UI?**
   - Currently only generation budget is user-editable (FormState.budgetCap)
   - Could expose all caps, or keep them auto-managed

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/agents/overview.md
- docs/evolution/reference.md
- docs/evolution/cost_optimization.md
- docs/evolution/visualization.md
- docs/evolution/agents/generation.md
- docs/feature_deep_dives/admin_panel.md

## Code Files Read
- `src/lib/evolution/index.ts` — createDefaultAgents(), preparePipelineRun()
- `src/lib/evolution/core/featureFlags.ts` — EvolutionFeatureFlags, FLAG_MAP, fetchEvolutionFeatureFlags()
- `src/lib/evolution/core/strategyConfig.ts` — StrategyConfig, StrategyConfigRow, hashStrategyConfig()
- `src/lib/services/strategyRegistryActions.ts` — Strategy CRUD, CreateStrategyInput, presets
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor, PhaseConfig, supervisorConfigFromRunConfig()
- `src/lib/evolution/core/pipeline.ts` — executeFullPipeline(), PipelineAgents, agent gating logic
- `src/lib/evolution/types.ts` — EvolutionRunConfig, singleArticle field
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig()
- `src/lib/services/evolutionActions.ts` — queueEvolutionRunAction, triggerEvolutionRunAction
- `src/app/api/cron/evolution-runner/route.ts` — Cron runner config pickup
- `src/app/admin/quality/strategies/page.tsx` — Strategy creation/editing UI (FormState, formToConfig, presets)
- `src/app/admin/quality/evolution/page.tsx` — Start Run card, strategy selection
- `src/app/admin/quality/optimization/_components/StrategyConfigDisplay.tsx` — Config display
- `supabase/migrations/20260205000005_add_strategy_configs.sql` — strategy_configs table schema
- `supabase/migrations/20260207000003_strategy_formalization.sql` — Strategy lifecycle columns
- `supabase/migrations/20260209000001_strategy_name_not_empty.sql` — Name CHECK constraint
- All 12 agent files in `src/lib/evolution/agents/` — canExecute(), execute() signatures
- `src/lib/evolution/core/costTracker.ts` — CostTrackerImpl, reserveBudget(), recordSpend(), getAllAgentCosts()
- `src/lib/evolution/core/costEstimator.ts` — estimateRunCostWithAgentModels(), RunCostEstimate
- `src/lib/evolution/core/adaptiveAllocation.ts` — computeAdaptiveBudgetCaps() (unused in production)
- `src/lib/evolution/core/llmClient.ts` — budget reservation before LLM calls
- `src/lib/services/eloBudgetActions.ts` — getAgentROILeaderboardAction(), dashboard queries
- `src/app/admin/quality/optimization/_components/AgentROILeaderboard.tsx` — ROI display
- `src/app/admin/quality/optimization/_components/CostBreakdownPie.tsx` — cost breakdown chart
- `src/app/admin/quality/optimization/_components/CostAccuracyPanel.tsx` — estimate vs actual
- `supabase/migrations/20260205000001_add_evolution_run_agent_metrics.sql` — agent metrics schema

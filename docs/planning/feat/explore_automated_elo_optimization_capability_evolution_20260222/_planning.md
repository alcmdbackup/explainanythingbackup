# Explore Automated Elo Optimization Capability Evolution Plan

## Background
Build an automated Elo optimization loop that chains the existing strategy experiment infrastructure (L8 factorial design → batch execution → main effects analysis → factor refinement) into a self-driving workflow. The system should be initiatable from the admin UI with progress visibility, automatically running screening rounds, analyzing results, and refining factor levels across multiple rounds until convergence or budget exhaustion.

## Requirements (from GH Issue #531)
1. UI trigger on optimization dashboard to start an automated experiment
2. Configurable budget constraint, prompt(s), and optimization target (elo vs elo/$)
3. Automated Round 1 (L8 screening) → analysis → Round 2+ (refinement) loop
4. Real-time progress UI showing current round, completed runs, factor rankings
5. Auto-stop on convergence (top factor effect < threshold) or budget exhaustion
6. Results feed into existing strategy leaderboard and Pareto frontier
7. Brainstorm and implement ways to allow selecting which factors should be tested (factor selection UI)

## Problem

The codebase has a complete but disconnected set of building blocks for Elo optimization: L8 factorial design, main effects analysis, batch execution with matrix expansion, strategy leaderboard, Pareto frontier, and agent ROI ranking. The gap is orchestration — nothing chains these steps into an automated multi-round loop. The current CLI (`run-strategy-experiment.ts`) shells out to subprocesses, scrapes results via regex, and stores state in a JSON file — unsuitable for production. Additionally, there are no statistical tests for factor significance, `commandAnalyze` is hardcoded to L8 (wrong for refinement rounds), and `stddev_final_elo` is never populated.

## Options Considered

### Orchestrator Architecture

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Cron-driven state machine** | Idempotent, resumable, uses existing watchdog pattern, observable via DB | Slightly slower (60s poll interval) | **Chosen** |
| GitHub Actions workflow | Parallel execution, long timeout (7hr) | No UI visibility, hard to pause/resume, fire-and-forget | Rejected |
| Long-running background worker | Most flexible, real-time progress | Vercel 60s timeout kills it, operational complexity | Rejected |

### State Storage

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **New `evolution_experiments` + `evolution_experiment_rounds` tables** | Clean separation, queryable, indexable | More migrations | **Chosen** |
| Extend `evolution_batch_runs` | Less migration work | Muddies batch concept, awkward round tracking | Rejected |
| JSONB blob on lightweight table | Simple schema | Hard to query, no indexing on internals | Rejected |

### Factor Level Generation

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **UI presents valid values from codebase, user picks, UI validates** | Full user control, no invalid configs | Requires factor type registry | **Chosen** |
| Hardcoded defaults only | Simple | Inflexible, stale as models change | Rejected |
| Fully auto-derived | Zero friction | May test nonsensical combinations | Rejected |

### Round 2+ Refinement

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Auto-proceed with conservative 3-level expansion** | Fully automated loop, predictable run count | May not explore optimal neighborhood | **Chosen** |
| Manual approval between rounds | Maximum control | Breaks automation, requires human in loop | Rejected |
| Aggressive 4-5 level expansion | Finds optimum faster | Single round can exhaust budget | Rejected |

## Design

### Data Model

**`evolution_experiments` table:**
```sql
-- Rollback: DROP TABLE IF EXISTS evolution_experiment_rounds; DROP TABLE IF EXISTS evolution_experiments;
-- (rounds table must be dropped first due to FK dependency)

CREATE TABLE evolution_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'round_running', 'round_analyzing',
                      'pending_next_round', 'converged', 'budget_exhausted',
                      'max_rounds', 'failed', 'cancelled')),
  optimization_target TEXT NOT NULL DEFAULT 'elo'
    CHECK (optimization_target IN ('elo', 'elo_per_dollar')),
  total_budget_usd NUMERIC(10, 2) NOT NULL,
  spent_usd NUMERIC(10, 4) DEFAULT 0,
  max_rounds INT NOT NULL DEFAULT 5,
  current_round INT DEFAULT 0,
  convergence_threshold NUMERIC(8, 4) DEFAULT 10.0,  -- absolute Elo effect (display scale)
  factor_definitions JSONB NOT NULL,   -- initial factors with user-specified levels
  prompts TEXT[] NOT NULL,
  config_defaults JSONB,               -- base EvolutionRunConfig overrides
  results_summary JSONB,               -- final winning config, best Elo, Pareto points
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- Cron queries by status every 60s; matches idx_batch_runs_status precedent
CREATE INDEX idx_experiments_status ON evolution_experiments(status);
CREATE INDEX idx_experiments_created_at ON evolution_experiments(created_at DESC);

-- No RLS — accessed only via service role (requireAdmin / requireCronAuth)
```

**`evolution_experiment_rounds` table:**
```sql
CREATE TABLE evolution_experiment_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES evolution_experiments(id) ON DELETE CASCADE,
  round_number INT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('screening', 'refinement')),
  design TEXT NOT NULL CHECK (design IN ('L8', 'full-factorial')),
  factor_definitions JSONB NOT NULL,   -- factors for this round
  locked_factors JSONB,                -- pinned values (Round 2+)
  batch_run_id UUID REFERENCES evolution_batch_runs(id),
  analysis_results JSONB,              -- main effects, interactions, recommendations
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (experiment_id, round_number)
);
-- Composite UNIQUE on (experiment_id, round_number) serves as index on experiment_id (leading col)
```

### State Machine

**Atomic locking:** Every cron invocation acquires the experiment row with `SELECT ... FOR UPDATE SKIP LOCKED` before checking or mutating state. This prevents concurrent cron invocations from double-processing the same experiment (same pattern as `claim_evolution_run` RPC and `update_strategy_aggregates` RPC).

**Run creation mechanism:** Experiment rounds create individual `evolution_runs` rows via direct DB inserts (same pattern as `run-batch.ts:137` which inserts with `batch_run_id` set). We do NOT use `queueEvolutionRunAction` because it does not accept `batch_run_id` — extending it is unnecessary since direct inserts with `status='pending'` and `batch_run_id` set are the established batch pattern. Each run gets `status='pending'`. Execution is handled by the existing cron/runner infrastructure (`claim_evolution_run` → `executeFullPipeline`). The experiment driver monitors completion by querying `evolution_runs WHERE batch_run_id = <round's batch> AND status IN ('completed', 'failed')`.

**All-runs-fail handling:** If every run in a batch has `status='failed'`, the round transitions to `'failed'` and the experiment transitions to `'failed'` with `error_message` describing the failure. Partial failures (some completed, some failed) proceed to analysis with only the completed runs, with a warning logged.

```
START: User triggers startExperimentAction (with requireAdmin())
  → INSERT evolution_experiments (status='pending')
  → Generate L8 design from factor_definitions
  → INSERT evolution_experiment_rounds (round 1, type='screening', design='L8')
  → INSERT evolution_batch_runs (status='pending')
  → For each L8 row × prompt: INSERT evolution_runs (status='pending', batch_run_id=<batch>)
  → UPDATE experiment status='round_running', round status='running', batch status='running'

CRON: experiment-driver route (every 60s, requireCronAuth())

  For each experiment in actionable state:
    → SELECT * FROM evolution_experiments WHERE status IN (...) FOR UPDATE SKIP LOCKED
    → Process at most 1 state transition per experiment per invocation

  [round_running] → Check run completion
    Query: SELECT status, COUNT(*) FROM evolution_runs WHERE batch_run_id=<batch> GROUP BY status
    All runs terminal (completed or failed)?
      → If ALL failed → round status='failed', experiment status='failed', error_message set
      → If some completed → round status='analyzing', experiment status='round_analyzing'
      → Update spent_usd from SUM(evolution_runs.total_cost_usd) for the batch

  [round_analyzing] → Run analysis
    1. Fetch completed run results from evolution_runs WHERE batch_run_id=<batch> AND status='completed'
    2. Call analysis pipeline: `computeMainEffects()` → `rankFactors()` → `generateRecommendations()` (from `analysis.ts`; fix: handle both L8 and full-factorial designs)
    3. Store analysis_results on round row
    4. Check convergence (under the same FOR UPDATE lock that holds spent_usd):
       a. |top factor effect| < convergence_threshold → 'converged'
       b. spent_usd + estimateBatchCost(nextRound) > total_budget_usd → 'budget_exhausted'
       c. current_round >= max_rounds → 'max_rounds'
       d. Otherwise → 'pending_next_round'
    5. UPDATE round status='completed'

  [pending_next_round] → Auto-derive next round (budget check under FOR UPDATE)
    1. From recommendations: top factor → expand to 3 levels (winner + 1 neighbor each side)
    2. Negligible factors → lock at cheap level
    3. Generate full-factorial design from varied factors
    4. Re-check: spent_usd + estimateBatchCost(newDesign) > total_budget_usd → 'budget_exhausted'
    5. INSERT evolution_batch_runs, INSERT evolution_runs (status='pending', batch_run_id set)
    6. INSERT new round row, UPDATE experiment status='round_running', current_round++

TERMINAL: converged | budget_exhausted | max_rounds | failed | cancelled
  → Write results_summary (winning config, best Elo, factor rankings)
  → Feed winning config into strategy leaderboard via existing linkStrategyConfig (metricsWriter.ts)
```

### Factor Type Registry (Centralized Factor Infrastructure)

A centralized registry that maps factor names to their valid values, sourced from **existing** codebase constants. This is the **single source of truth** for "what can be tested," "what values are valid," and "how to expand values for refinement rounds." All factor-aware code — UI dropdowns, form validation, experiment generation, and round refinement — reads from this registry. No hardcoded factor lists elsewhere.

**Centralization rules:**
- Model valid values come from `allowedLLMModelSchema` (schemas.ts) — the registry delegates to it, never maintains a parallel list
- Agent valid values come from `OPTIONAL_AGENTS` and `AGENT_DEPENDENCIES` (budgetRedistribution.ts) — the registry delegates to these
- The existing `MODEL_OPTIONS` array in `strategies/page.tsx` (currently hardcoded to 7 of 12 models) must be replaced with a call to `FACTOR_REGISTRY.get('genModel').getValidValues()` — same for any other UI that lists models
- The registry's `validate()` methods delegate to existing validators: `allowedLLMModelSchema.safeParse()` for models, `validateAgentSelection()` for agents — no reimplementation
- The `ALLOWED_MODELS` set in `configValidation.ts` and the registry both read from `allowedLLMModelSchema` — one source, zero divergence

**New file:** `evolution/src/experiments/evolution/factorRegistry.ts`

```typescript
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';
import { LLM_PRICING } from '@/config/llmPricing';
import { OPTIONAL_AGENTS, AGENT_DEPENDENCIES, validateAgentSelection } from '../lib/core/budgetRedistribution';

type FactorType = 'model' | 'integer' | 'boolean' | 'agent_set' | 'enum';

interface FactorTypeDefinition {
  key: string;                    // 'genModel', 'judgeModel', 'iterations', etc.
  label: string;                  // 'Generation Model'
  type: FactorType;
  getValidValues(): (string | number | boolean)[];
  orderValues(values: (string | number)[]): (string | number)[];
  expandAroundWinner(winner: string | number): (string | number)[];
  validate(value: string | number | boolean): boolean;  // delegates to existing validators
  estimateCostImpact(value: string | number): number;    // relative cost weight
}

/** Exported for UI consumption — the ONLY place factor metadata should come from. */
export const FACTOR_REGISTRY: ReadonlyMap<string, FactorTypeDefinition> = new Map([...]);
```

**Five factor types and their sources:**

| Factor Type | Key | Source of Valid Values | Validator Delegation | Count | Ordering |
|---|---|---|---|---|---|
| Generation model | `genModel` | `allowedLLMModelSchema` (`schemas.ts:118`) | `allowedLLMModelSchema.safeParse()` | 12 | By input price via `LLM_PRICING` |
| Judge model | `judgeModel` | `allowedLLMModelSchema` | `allowedLLMModelSchema.safeParse()` | 12 | By input price |
| Iterations | `iterations` | `[2, 3, 5, 8, 10, 15, 20, 30]` (curated from 1-30 range) | Bounds check `> 0 && <= 30` | 8 | Numeric ascending |
| Agent set | `supportAgents` | `OPTIONAL_AGENTS` (`budgetRedistribution.ts:15`) with `AGENT_DEPENDENCIES` | `validateAgentSelection()` | Binary / grouped | By dependency tree |
| Editing approach | `editor` | `['iterativeEditing', 'treeSearch']` | Inclusion check | 2 | N/A |

**Model factor implementation detail:**

```typescript
const modelFactorDef: FactorTypeDefinition = {
  key: 'genModel',
  label: 'Generation Model',
  type: 'model',
  getValidValues() {
    // Delegates to the single source of truth — never a hardcoded list
    return allowedLLMModelSchema.options;
  },
  orderValues(values) {
    return values.sort((a, b) => getInputPrice(a) - getInputPrice(b));
  },
  expandAroundWinner(winner) {
    const ordered = this.orderValues([...this.getValidValues()]);
    const idx = ordered.indexOf(winner);
    const neighbors = [
      ordered[Math.max(0, idx - 1)],
      ordered[idx],
      ordered[Math.min(ordered.length - 1, idx + 1)],
    ];
    return [...new Set(neighbors)];
  },
  validate(value) {
    // Delegates to existing Zod schema — same validator used by configValidation.ts
    return allowedLLMModelSchema.safeParse(value).success;
  },
  estimateCostImpact(value) {
    // Use getModelPricing() helper which handles prefix-matching for model variants
    const pricing = getModelPricing(String(value));  // from llmPricing.ts:84
    const cheapest = Math.min(...Object.values(LLM_PRICING).map(p => p.inputPer1M));
    return pricing ? pricing.inputPer1M / cheapest : 1;
  },
};
```

**Iteration factor — expansion uses geometric interpolation:**

```typescript
expandAroundWinner(winner: number): number[] {
  const all = [2, 3, 5, 8, 10, 15, 20, 30];
  const idx = all.indexOf(winner);
  if (idx === -1) {
    // Winner not in curated list; bracket it
    const lower = all.filter(v => v < winner).pop() ?? winner;
    const upper = all.find(v => v > winner) ?? winner;
    return [...new Set([lower, winner, upper])];
  }
  const neighbors = [
    all[Math.max(0, idx - 1)],
    all[idx],
    all[Math.min(all.length - 1, idx + 1)],
  ];
  return [...new Set(neighbors)];
}
```

**Agent factor — the binary-vs-granular problem:**

The L8 has 7 columns max. The current design uses 5 factors (columns 0-4). Testing 9 individual agents would exceed L8 capacity. Options:

1. **Binary** (current): `supportAgents: on/off` — collapses all optional agents. Simple but coarse.
2. **Agent groups** (3 factors, fits L8):
   - `editingGroup`: `[iterativeEditing OR treeSearch]`
   - `analysisGroup`: `[reflection, sectionDecomposition]`
   - `diversityGroup`: `[debate, evolution, metaReview]`
3. **Individual agent ablation** (Round 2+ only): After screening identifies "support agents matter," a refinement round tests individual agents via full-factorial.

The registry supports all three via `agent_set` type with configurable grouping.

### Config Validation Unification

**Problem:** Validation today is fragmented across 7 layers with gaps and inconsistencies (see Research §19). The experiment system will generate factor combinations that must be validated before queuing, but the current validation chain has holes:

1. `createStrategyAction` stores configs with NO validation — invalid models/agents persist until queue time
2. `AgentBudgetCapsSchema` covers only 7 of 12 budget cap keys
3. Budget cap sum checked in batch schema but NOT in `configValidation.ts`
4. `mapFactorsToPipelineArgs` output is never validated against `validateStrategyConfig`

**Approach: Compose, don't duplicate.** The new `validateExperimentConfig` does NOT reimplement validation. It orchestrates existing validators in a pipeline:

```
Registry.validate()  →  delegates to allowedLLMModelSchema / validateAgentSelection
         ↓
validateStrategyConfig()  →  already in configValidation.ts (lenient, partial configs)
         ↓
validateRunConfig()  →  already in configValidation.ts (strict, resolved configs)
         ↓
validateAgentSelection()  →  already in budgetRedistribution.ts (dependency check)
```

Each step uses the existing function from its existing file. `validateExperimentConfig` only adds the orchestration: expand factor combinations → feed each row through the existing chain → aggregate errors.

**New file:** `evolution/src/experiments/evolution/experimentValidation.ts`

```typescript
// Unified pre-flight validation for experiment configs.
// Composes existing validators — no new validation logic, only orchestration.

import { FACTOR_REGISTRY } from './factorRegistry';
import { generateL8Design, mapFactorsToPipelineArgs } from './factorial';
import { validateStrategyConfig, validateRunConfig } from '../lib/core/configValidation';
import { validateAgentSelection } from '../lib/core/budgetRedistribution';
import { resolveConfig } from '../lib/config';

interface ExperimentValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  expandedConfigs: ExpandedRunConfig[];  // all L8/factorial rows
  estimatedTotalCost: number;
}

async function validateExperimentConfig(
  factorDefs: Record<string, { low: string | number; high: string | number }>,
  prompts: string[],
  configDefaults?: Partial<EvolutionRunConfig>,
): Promise<ExperimentValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate each factor value via registry (which delegates to existing Zod/validators)
  for (const [key, { low, high }] of Object.entries(factorDefs)) {
    const def = FACTOR_REGISTRY.get(key);
    if (!def) { errors.push(`Unknown factor: ${key}`); continue; }
    if (!def.validate(low)) errors.push(`Invalid ${key} low value: ${low}`);
    if (!def.validate(high)) errors.push(`Invalid ${key} high value: ${high}`);
  }

  // 2. Generate all L8 rows and map to pipeline args
  const design = generateL8Design(factorDefs);
  const expandedConfigs: ExpandedRunConfig[] = [];
  for (const row of design.runs) {
    const merged = resolveConfig({ ...configDefaults, ...row.pipelineArgs });

    // 3. Validate each expanded config through EXISTING validators — no new checks here
    const strategyResult = validateStrategyConfig({
      generationModel: merged.generationModel,
      judgeModel: merged.judgeModel,
      iterations: merged.maxIterations,
      enabledAgents: merged.enabledAgents,
      budgetCaps: merged.budgetCaps,
    });
    if (!strategyResult.valid) {
      errors.push(`Row ${row.row}: ${strategyResult.errors.join('; ')}`);
    }

    const runResult = validateRunConfig(merged);
    if (!runResult.valid) {
      errors.push(`Row ${row.row}: ${runResult.errors.join('; ')}`);
    }

    expandedConfigs.push({ row: row.row, config: merged });
  }

  // 4. Cost estimation
  const estimatedTotalCost = await estimateBatchCost(expandedConfigs, prompts);

  // 5. Agent dependency warnings (using existing validateAgentSelection from budgetRedistribution.ts)
  for (const config of expandedConfigs) {
    const agentWarnings = validateAgentSelection(config.config.enabledAgents ?? []);
    warnings.push(...agentWarnings.map(w => `Row ${config.row}: ${w}`));
  }

  return { valid: errors.length === 0, errors, warnings, expandedConfigs, estimatedTotalCost };
}
```

**`estimateBatchCost` — location and definition:**

New function in `evolution/src/experiments/evolution/experimentValidation.ts` (colocated with `validateExperimentConfig`). Aggregates per-run cost estimates across all expanded rows × prompts:

```typescript
import { estimateRunCost, type RunCostEstimate } from '@evolution/lib/core/costEstimator';

const DEFAULT_ESTIMATE_TEXT_LENGTH = 5000; // baseline chars, matches costEstimator conventions

async function estimateBatchCost(
  expandedConfigs: ExpandedRunConfig[],
  prompts: string[],
): Promise<number> {
  // For each config × prompt, delegates to existing estimateRunCost from costEstimator.ts.
  // estimateRunCost signature: (config: EvolutionRunConfig, textLength: number) → RunCostEstimate
  // RunCostEstimate has { totalUsd, confidence, perAgent }.
  let total = 0;
  for (const config of expandedConfigs) {
    const estimate: RunCostEstimate = await estimateRunCost(
      config.config,
      DEFAULT_ESTIMATE_TEXT_LENGTH,  // no actual text yet; use baseline length
    );
    // Scale up low-confidence estimates (no agent cost baselines yet) to avoid budget overruns
    const safetyMultiplier = estimate.confidence === 'low' ? 1.5 : 1.0;
    total += estimate.totalUsd * safetyMultiplier * prompts.length;
  }
  return total;
}
```

The function delegates to the existing `estimateRunCost` in `evolution/src/lib/core/costEstimator.ts` — no new estimation logic. Uses `DEFAULT_ESTIMATE_TEXT_LENGTH` since prompt text hasn't been expanded to seed articles yet. Low-confidence estimates are scaled by 1.5x to prevent budget overruns. Prompts multiply linearly because each run is executed per-prompt.

**Validation invocation points (two calls, same function):**
1. `validateExperimentConfigAction` — server action called by the UI on form changes (debounced) to show live errors/warnings and estimated cost before user hits "Start"
2. `startExperimentAction` — gate before queuing; rejects if validation fails (defense in depth)

**Incremental fixes to existing validators (consolidation):**

These fixes improve existing validation so the experiment chain benefits automatically — no experiment-specific patches needed.

| Fix | Where | What | Why it helps experiments |
|-----|-------|------|-------------------------|
| Add `validateStrategyConfig` call to `createStrategyAction` | `strategyRegistryActions.ts` | Prevents invalid configs from being stored | Experiment results link to strategy_configs; invalid ones would corrupt leaderboard |
| Align `AgentBudgetCapsSchema` with `VALID_BUDGET_CAP_KEYS` | `batchRunSchema.ts` | Add missing 5 agent keys (`treeSearch`, `outlineGeneration`, `sectionDecomposition`, `flowCritique`, `pairwise`) | Experiment rows use the full agent set; batch schema must accept all of them |
| Add sum <= 1.0 check to `validateBudgetCaps` | `configValidation.ts` | Consistent with batch schema | Experiment's `validateRunConfig` call inherits this check automatically |
| Make `enabledAgentsSchema.safeParse` failure blocking | `evolutionActions.ts:buildRunConfig` | Change from warn-only to hard reject | Prevents silently dropping agents from experiment configs |

### Server Actions

**`evolution/src/services/experimentActions.ts`:**

All mutation actions call `requireAdmin()` as first line (matching existing pattern in `strategyRegistryActions.ts`). `validateExperimentConfigAction` also requires admin since it accesses cost estimation data.

| Action | Auth | Input | Output | Notes |
|--------|------|-------|--------|-------|
| `startExperimentAction` | `requireAdmin` | `{ name, factors, prompts, budget, target, maxRounds?, convergenceThreshold?, configDefaults? }` | `{ experimentId }` | Rejects empty prompts, max 10 prompts, validates via `validateExperimentConfig` before queuing |
| `getExperimentStatusAction` | `requireAdmin` | `{ experimentId }` | Full experiment + all rounds with analysis | |
| `listExperimentsAction` | `requireAdmin` | `{ status? }` | Summary list | |
| `cancelExperimentAction` | `requireAdmin` | `{ experimentId }` | Cancels pending runs, sets status='cancelled' | |
| `validateExperimentConfigAction` | `requireAdmin` | `{ factors, prompts, configDefaults }` | `{ valid, errors[], warnings[], expandedRunCount, estimatedCost }` | Server-side guard: rejects < 2 factors, 0 prompts (defense in depth for client-side fast-fail) |

### Cron Route

**`src/app/api/cron/experiment-driver/route.ts`:**
- **Authentication:** Must call `requireCronAuth()` from `src/lib/utils/cronAuth.ts` as the first line — matches `evolution-watchdog` and `evolution-runner` patterns. Without this, the endpoint is publicly accessible and could trigger expensive LLM operations.
- **`maxDuration` export:** Set to 30 (seconds) to prevent analysis of large result sets from exceeding Vercel's default timeout. Matches existing runner route pattern.
- Runs every 60 seconds (Vercel cron)
- Queries for experiments in actionable states using `SELECT ... FOR UPDATE SKIP LOCKED`
- Processes at most 1 state transition per experiment per invocation (idempotent)
- If multiple experiments are actionable, processes all of them (each under its own lock) but each gets only 1 transition
- Guards all transitions with status checks (prevents double-processing)
- Logs all transitions for observability

**`vercel.json` addition** (add third entry to existing crons array):
```json
{
  "crons": [
    { "path": "/api/evolution/run", "schedule": "*/5 * * * *" },
    { "path": "/api/cron/evolution-watchdog", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/experiment-driver", "schedule": "* * * * *" }
  ]
}
```

### UI: Factor Selection & Experiment Form

Added to the existing optimization dashboard (`/admin/quality/optimization`), new "Experiments" tab.

**Factor selection UI — detailed interaction flow:**

The form lets users (a) choose WHICH factors to test and (b) pick low/high values for each. Modeled after the proven `StrategyDialog` pattern from `strategies/page.tsx` (agent checkbox grid + dependency cascade + live validation).

```
┌─ Start Experiment ──────────────────────────────────────────────┐
│                                                                  │
│  Name: [_______________]    Target: (•) Elo  ( ) Elo/$           │
│                                                                  │
│  ── Factors to Test ─────────────────────────────────────────    │
│  ☑ Generation Model    Low: [deepseek-chat ▾]  High: [gpt-5-mini ▾]  │
│  ☑ Judge Model         Low: [gpt-4.1-nano ▾]  High: [gpt-5-nano ▾]   │
│  ☑ Iterations          Low: [3 ▾]             High: [8 ▾]        │
│  ☐ Editing Approach    Low: ─                  High: ─           │
│  ☐ Support Agents      Low: ─                  High: ─           │
│                                                                  │
│  Dropdowns populated from FACTOR_REGISTRY.getValidValues()       │
│  Ordered by FACTOR_REGISTRY.orderValues() (models by price)      │
│                                                                  │
│  ── Prompts ─────────────────────────────────────────────────    │
│  [Enter a topic to test...]                          [+ Add]     │
│                                                                  │
│  ── Budget & Limits ─────────────────────────────────────────    │
│  Total budget: [$10.00]  Max rounds: [5]  Convergence: [10.0]    │
│                                                                  │
│  ── Validation Preview (live, debounced) ────────────────────    │
│  ✓ 8 runs × 1 prompt = 8 total runs                             │
│  ✓ Estimated cost: $3.42 (within $10.00 budget)                  │
│  ⚠ Row 3: iterativeEditing requires reflection (auto-included)   │
│                                                                  │
│              [Cancel]  [Start Experiment]                         │
└──────────────────────────────────────────────────────────────────┘
```

**Key UI behaviors:**

1. **Factor toggle checkboxes**: Each factor in `FACTOR_REGISTRY` renders as a row with a checkbox. Unchecked factors are excluded from the L8 design (fewer factors = more interaction columns available). At least 2 factors must be selected.

2. **Value dropdowns**: Low/high dropdowns for each checked factor are populated **exclusively** from `FACTOR_REGISTRY.get(key).getValidValues()`. Model dropdowns show all 12 models from `allowedLLMModelSchema` (not the hardcoded 7 in `strategies/page.tsx`), ordered by price. Iteration dropdown shows the curated set `[2, 3, 5, 8, 10, 15, 20, 30]`.

3. **Live validation**: On any form change (debounced 500ms), the form calls `validateExperimentConfigAction` server action. The response populates:
   - Run count and estimated cost (from expanded L8 rows)
   - Errors: invalid models, agent dependency violations, budget overflow → shown inline below the form, "Start" button disabled
   - Warnings: auto-included dependencies, negligible cost differences → shown as amber notices

4. **Client-side fast-fail**: Before calling the server action, the form checks locally:
   - At least 2 factors selected
   - At least 1 prompt entered
   - Budget > $0
   - Low ≠ High for each checked factor (otherwise factor has no effect)
   These checks prevent unnecessary server round-trips.

5. **No reimplemented validation in the form component**: The form does NOT import `allowedLLMModelSchema` or `validateAgentSelection` directly. It uses the registry for dropdown values and the server action for validation. The only client-side checks are structural (non-empty, distinct values) — all semantic validation happens server-side through the existing validator chain.

**Eliminating hardcoded model lists:**

The strategies page currently has `MODEL_OPTIONS = ['deepseek-chat', 'gpt-4.1-nano', ...]` (7 of 12 models). The experiment form must NOT replicate this pattern. Instead:
- The experiment form imports `FACTOR_REGISTRY` and calls `getValidValues()` for dropdown options
- As a follow-up consolidation, the strategies page `MODEL_OPTIONS` should also be replaced with a registry/schema-derived list (out of scope for this project but noted as tech debt)

### UI: Experiment Status & History

Also on the "Experiments" tab:

- **Active experiment card**: `EvolutionStatusBadge` for experiment status, round progress bar (e.g., "Round 2 of 5"), budget usage bar, factor rankings table from latest analysis, cancel button
- **Experiment history**: list of past experiments with terminal status, best Elo achieved, total spend, link to winning strategy in leaderboard
- **Polling:** The optimization dashboard currently uses manual refresh only (no `AutoRefreshProvider`). The Experiments tab must add `AutoRefreshProvider` (from `evolution/src/components/evolution/AutoRefreshProvider.tsx`) wrapping the experiment status section, with 15s interval and `isActive` guard that only polls when any experiment is in a non-terminal state (`round_running`, `round_analyzing`, `pending_next_round`). This reuses the proven pattern from the run detail page but must be explicitly added — it is NOT already present.
- Each experiment row expandable to show per-round details: factor definitions, locked factors, analysis results

### Fixes Required

1. **`commandAnalyze` hardcoded to L8** (`scripts/run-strategy-experiment.ts`): Must detect round design type and use appropriate analysis (L8 main effects vs full-factorial comparison)
2. **`stddev_final_elo` never populated**: Add Welford's online algorithm to `update_strategy_aggregates` RPC
3. **Elo scale inconsistency**: Ensure agent metrics and strategy aggregates use the same Elo scale (display scale, baseline 1200)

## Phased Execution Plan

### Phase 1: Data Model, Registry & Validation Foundation
1. Migration: `evolution_experiments` + `evolution_experiment_rounds` tables with rollback SQL, `idx_experiments_status` and `idx_experiments_created_at` indexes, no-RLS comment
2. Factor type registry (`evolution/src/experiments/evolution/factorRegistry.ts`): model, integer, boolean, agent_set, enum types. Delegates to existing sources (`allowedLLMModelSchema`, `OPTIONAL_AGENTS`, `AGENT_DEPENDENCIES`, `LLM_PRICING`) — no parallel valid-value lists. Exports `FACTOR_REGISTRY` map for UI dropdown population.
3. Unified experiment validation (`experimentValidation.ts`): composes (not reimplements) existing `validateStrategyConfig` + `validateRunConfig` + `validateAgentSelection` chain. Orchestrates: expand L8 rows → feed each through existing validators → aggregate errors/warnings.
4. `validateExperimentConfigAction`: server action for pre-flight validation from UI
5. Fix existing validation gaps:
   a. Add `validateStrategyConfig` call to `createStrategyAction`
   b. Align `AgentBudgetCapsSchema` with `VALID_BUDGET_CAP_KEYS` (add 5 missing agents)
   c. Add sum <= 1.0 check to `validateBudgetCaps` in `configValidation.ts`
   d. Make `enabledAgentsSchema.safeParse` failure blocking in `buildRunConfig`

### Phase 2: Core Orchestration
6. `startExperimentAction`: generates L8 design, creates batch, queues runs
7. `getExperimentStatusAction` + `listExperimentsAction` + `cancelExperimentAction`
8. Cron route `experiment-driver`: `requireCronAuth()`, `maxDuration=30`, `FOR UPDATE SKIP LOCKED` per experiment, state machine advancing rounds (check completion → analyze → derive next → queue). Add entry to `vercel.json` crons array.

### Phase 3: Analysis & Auto-Refinement
9. Fix `analyzeExperiment()` to handle both L8 and full-factorial designs
10. Auto-derivation of Round 2+ factors using registry's 3-level expansion heuristic
11. Convergence detection (absolute threshold on top factor effect)
12. Results feed into strategy leaderboard via `linkStrategyConfig`
13. Fix `stddev_final_elo` population in `update_strategy_aggregates`

### Phase 4: UI
14. "Experiments" tab on optimization dashboard with factor toggle checkboxes, value dropdowns populated from `FACTOR_REGISTRY.getValidValues()`, client-side fast-fail checks (≥2 factors, ≥1 prompt, budget > 0, low ≠ high), debounced `validateExperimentConfigAction` for live validation preview (run count, estimated cost, errors, warnings)
15. Active experiment status card (round progress, budget bar, factor rankings, cancel button)
16. Experiment history list with per-round expandable detail
17. Wire `getRecommendedStrategyAction` to UI

## Testing

### Unit Tests
- `factorRegistry.test.ts` — valid value sourcing from codebase constants, price ordering, expansion heuristic (edge: winner at boundary), agent dependency awareness, `estimateCostImpact` correctness, `LLM_PRICING` record access (not array) (~15 tests)
- `experimentValidation.test.ts` — full-chain validation of L8 rows, invalid model detection, agent dependency errors, `estimateBatchCost` aggregation, partial factor definitions, **0 factors rejection**, **1 factor rejection**, empty prompts rejection, prompt count limits (~15 tests)
- `experimentActions.test.ts` — start (with `requireAdmin` check), status, cancel, validation actions, **prompts validation (no empty strings, max count)** (~15 tests)
- `experimentDriver.test.ts` (colocated at `src/app/api/cron/experiment-driver/route.test.ts` matching watchdog pattern) — state transitions, convergence detection, round derivation, **`requireCronAuth` enforcement**, **all-runs-fail → experiment failed**, **partial failure → proceed with completed runs**, **FOR UPDATE SKIP LOCKED prevents double-processing**, **budget check atomicity** (~18 tests)
- Update `analysis.test.ts` — full-factorial analysis path, **empty results (0 completed runs)** (~7 new tests)
- Update `configValidation.test.ts` — budget cap sum check, aligned agent keys (~4 new tests)

### Integration Tests
- `experiment-orchestration.integration.test.ts` — full Round 1 → analysis → Round 2 flow with mock pipeline, **budget exhaustion mid-experiment** (spent + next estimate > total), **cancellation during round_running** (pending runs cancelled), **crash recovery / idempotency** (cron picks up after restart), **two concurrent experiments** (both in round_running, processed independently) (~12 tests)
- `experiment-driver-cron.integration.test.ts` — cron idempotency, concurrent invocation handling via FOR UPDATE SKIP LOCKED, **max round reached terminal state**, **convergence terminal state** (~6 tests)
- Note: integration tests should use the `evolutionTablesExist` guard pattern from `evolution-actions.integration.test.ts` to skip gracefully when tables aren't migrated

### E2E Tests
- `admin-experiment.spec.ts` (in `src/__tests__/e2e/specs/09-admin/`) — start experiment form, initial status display, cancel flow (~5 tests)
- Note: E2E cannot verify round progression (cron-driven). Round advancement is covered exclusively by integration tests. E2E verifies UI form submission, status rendering, and cancel only.

### Manual Verification (Staging)
- Start experiment with 2 factors, 1 prompt, $5 budget → observe Round 1 queuing → analysis → Round 2 auto-derivation → convergence
- Cancel mid-experiment → verify pending runs cancelled, status correct
- Budget exhaustion path → verify graceful stop with results
- All-runs-fail path → verify experiment transitions to failed with error message

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/strategy_experiments.md` — Core doc: add automated experiment orchestration section
- `evolution/docs/evolution/data_model.md` — New tables: evolution_experiments, evolution_experiment_rounds
- `evolution/docs/evolution/architecture.md` — New section on experiment automation architecture
- `evolution/docs/evolution/cost_optimization.md` — Factor type registry, budget-constrained experiment design
- `evolution/docs/evolution/visualization.md` — New UI components: experiment form, status card
- `evolution/docs/evolution/reference.md` — New server actions, cron route, config schema

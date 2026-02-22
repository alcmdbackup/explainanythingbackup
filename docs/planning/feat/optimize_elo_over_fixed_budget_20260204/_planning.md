# Optimize Elo Over Fixed Budget Plan

## Background
The evolution pipeline uses hardcoded per-agent budget caps (generation 25%, calibration 15%, tournament 25%, etc.) and a limited model set. Agent `estimateCost()` methods use hardcoded pricing rates instead of actual model pricing data. There is no way to estimate total cost before running, no JSON-driven batch configuration, no combinatorial model/iteration exploration, and no predicted-vs-actual cost tracking. Most critically, while we track `elo_per_dollar` in the article bank, we don't use this data to inform budget allocation decisions.

**Key discovery from research:** The `MetaReviewAgent` already performs zero-cost effectiveness analysis (`_analyzeStrategies`, `_findWeaknesses`, `_findFailures`, `_prioritize`) but this data isn't used to inform budget allocation. The integration layer is missing.

## Problem
To maximize Elo improvement per dollar, we need to:
1. **Measure** current Elo/dollar performance across models, iterations, and agent configurations
2. **Instrument** per-variant and per-agent cost attribution (currently missing)
3. **Predict** costs accurately using historical data from `llmCallTracking`
4. **Explore** the configuration space systematically via JSON batch configs with combinatorial expansion
5. **Optimize** budget allocation based on observed agent ROI

## Core Optimization Strategy

### The Optimization Loop
```
Measure → Instrument → Predict → Explore → Optimize → Measure...
    ↑__________________________________________|
```

1. **Measure:** Establish baseline Elo/dollar for existing methods
2. **Instrument:** Add per-variant cost tracking to enable fine-grained analysis
3. **Predict:** Build data-driven cost estimators from historical LLM calls
4. **Explore:** Run combinatorial experiments (model × iterations × budget) within total budget constraint
5. **Optimize:** Shift budget allocation toward high-ROI agents/configs

### Key Insight
The system already computes `elo_per_dollar = (elo - 1200) / cost` in `article_bank_elo`. The missing piece is **using this data to guide decisions**:
- Which model gives best Elo/$ for generation vs judging?
- At what iteration count does marginal Elo gain fall below cost?
- Which agents contribute most Elo per dollar spent?

### Existing Infrastructure to Leverage
| Component | Location | How to Use |
|-----------|----------|------------|
| Elo/dollar metric | `article_bank_elo.elo_per_dollar` | Query for model/method comparison |
| Strategy effectiveness | `run_summary.strategyEffectiveness` | Identify high-performing strategies |
| MetaReviewAgent analysis | `state.metaFeedback` | Connect to budget allocation |
| LLM call history | `llmCallTracking` with `call_source` | Build cost baselines per agent/model |
| Adaptive tournament | `budgetPressureConfig()` | Extend pattern to other agents |
| Cross-topic summary | `getCrossTopicSummaryAction` | Aggregate Elo/dollar by method |

## Phased Execution Plan

### Phase 1: Establish Baselines (No Code Changes)
**Goal:** Measure current state before making any changes.

**Steps:**
1. Run `npx tsx scripts/run-prompt-bank.ts` to generate articles across all prompt × method combos
2. Run `npx tsx scripts/run-prompt-bank-comparisons.ts --rounds 5` for comprehensive Elo ranking
3. Query method effectiveness (with empty dataset handling):
   ```sql
   SELECT generation_method, model,
          COALESCE(AVG(elo_rating), 1200) as avg_elo,
          COALESCE(AVG(total_cost_usd), 0) as avg_cost,
          COALESCE(AVG((elo_rating - 1200) / NULLIF(total_cost_usd, 0)), 0) as avg_elo_per_dollar,
          COUNT(*) as sample_count
   FROM article_bank_entries e
   JOIN article_bank_elo elo ON e.id = elo.entry_id
   WHERE e.deleted_at IS NULL
   GROUP BY generation_method, model
   HAVING COUNT(*) >= 1  -- Ensure non-empty results
   ORDER BY avg_elo_per_dollar DESC NULLS LAST;
   ```
4. Query historical agent costs (with empty dataset handling):
   ```sql
   -- NOTE: Table name is case-sensitive quoted identifier in PostgreSQL
   SELECT
     REPLACE(call_source, 'evolution_', '') as agent,
     model,
     COUNT(*) as calls,
     COALESCE(AVG(prompt_tokens), 0) as avg_prompt_tokens,
     COALESCE(AVG(completion_tokens), 0) as avg_completion_tokens,
     COALESCE(AVG(estimated_cost_usd), 0) as avg_cost
   FROM "llmCallTracking"
   WHERE call_source LIKE 'evolution_%'
     AND created_at >= NOW() - INTERVAL '30 days'
   GROUP BY call_source, model
   HAVING COUNT(*) >= 1
   ORDER BY avg_cost DESC NULLS LAST;
   ```
   **Note:** If this returns empty results on a new deployment, proceed with heuristic-based estimation (Phase 3 fallback).
   **Note:** `call_source` values follow pattern `evolution_<agentName>` (e.g., `evolution_generation`, `evolution_calibration`).
5. Document baseline: `{ method, avgElo, avgCost, avgEloPerDollar, winRate }`

**Deliverables:**
- Baseline metrics CSV/JSON
- Per-agent cost baselines
- Identification of current best Elo/dollar configs

### Phase 2: Instrument Cost Attribution
**Goal:** Enable per-variant and per-agent cost tracking.

**Files to modify:**
- `src/lib/evolution/types.ts` — Add `costUsd?: number` to `TextVariation`
- `src/lib/evolution/core/state.ts` — Track cost when calling `addToPool()`
- `src/lib/evolution/core/costTracker.ts` — Add `getAllAgentCosts()` method to interface and implementation
- `src/lib/evolution/agents/*.ts` — Pass cost to variant on creation
- `supabase/migrations/` — Add `cost_usd NUMERIC(10, 6)` to `evolution_variants`

**CostTracker interface extension:**

Step 1: Add method to interface in `src/lib/evolution/types.ts`:
```typescript
// Find existing CostTracker interface and add:
export interface CostTracker {
  // ... existing methods (reserveBudget, recordSpend, getAgentCost, getTotalSpent, getAvailableBudget) ...
  getAllAgentCosts(): Record<string, number>;  // NEW
}
```

Step 2: Implement in `src/lib/evolution/core/costTracker.ts`:
```typescript
// NOTE: Internal Map is named 'spentByAgent' - use correct field name
// Add this method to CostTrackerImpl class:
getAllAgentCosts(): Record<string, number> {
  const costs: Record<string, number> = {};
  for (const [agentName, spent] of this.spentByAgent.entries()) {
    costs[agentName] = spent;
  }
  return costs;
}
```

**New table for agent metrics:**
```sql
-- Migration: 20260205000001_add_evolution_run_agent_metrics.sql
CREATE TABLE evolution_run_agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES evolution_runs(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL,
  cost_usd NUMERIC(10, 6) NOT NULL,
  variants_generated INT DEFAULT 0,
  avg_elo NUMERIC(8, 2),
  elo_gain NUMERIC(8, 2),  -- avg_elo - 1200 (baseline)
  elo_per_dollar NUMERIC(12, 2),  -- (avg_elo - 1200) / cost_usd
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (run_id, agent_name)
);

CREATE INDEX idx_agent_metrics_elo_per_dollar
  ON evolution_run_agent_metrics(elo_per_dollar DESC);

-- Rollback:
-- DROP INDEX IF EXISTS idx_agent_metrics_elo_per_dollar;
-- DROP TABLE IF EXISTS evolution_run_agent_metrics;
```

**Pipeline modification (`src/lib/evolution/core/pipeline.ts`):**
```typescript
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

// At end of executeFullPipeline:
async function persistAgentMetrics(
  runId: string,
  costTracker: CostTracker,
  state: PipelineState
): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const agentCosts = costTracker.getAllAgentCosts();

  // Strategy-to-agent mapping (actual strategy values from codebase):
  // - generation agent: 'structural_transform', 'lexical_simplify', 'grounding_enhance'
  // - evolution agent: 'mutate_clarity', 'mutate_structure', 'crossover', 'creative_exploration'
  //   (from EVOLUTION_STRATEGIES in evolvePool.ts)
  // - debate agent: 'debate_synthesis'
  // - iterativeEditing agent: 'critique_edit_*' (dynamic: critique_edit_engagement, critique_edit_open, etc.)
  // - original: 'original_baseline'
  const strategyToAgent: Record<string, string> = {
    'structural_transform': 'generation',
    'lexical_simplify': 'generation',
    'grounding_enhance': 'generation',
    'mutate_clarity': 'evolution',
    'mutate_structure': 'evolution',
    'crossover': 'evolution',
    'creative_exploration': 'evolution',
    'debate_synthesis': 'debate',
    'original_baseline': 'original',
    // Note: iterativeEditing uses dynamic pattern 'critique_edit_*'
  };

  // Helper to map strategy to agent, handling dynamic patterns
  function getAgentForStrategy(strategy: string): string | null {
    if (strategyToAgent[strategy]) return strategyToAgent[strategy];
    if (strategy.startsWith('critique_edit_')) return 'iterativeEditing';
    return null;  // Unknown strategy
  }

  for (const [agentName, costUsd] of Object.entries(agentCosts)) {
    // NOTE: TextVariation.strategy values are descriptive (e.g., 'structural_transform')
    // We must map them back to agent names for attribution
    const variants = state.pool.filter(v => getAgentForStrategy(v.strategy) === agentName);
    const avgElo = variants.length > 0
      ? variants.reduce((s, v) => s + (state.eloRatings.get(v.id) ?? 1200), 0) / variants.length
      : null;
    const eloGain = avgElo ? avgElo - 1200 : null;
    const eloPerDollar = eloGain && costUsd > 0 ? eloGain / costUsd : null;

    const { error } = await supabase.from('evolution_run_agent_metrics').upsert({
      run_id: runId,
      agent_name: agentName,
      cost_usd: costUsd,
      variants_generated: variants.length,
      avg_elo: avgElo,
      elo_gain: eloGain,
      elo_per_dollar: eloPerDollar,
    });

    if (error) {
      console.warn(`Failed to persist agent metrics for ${agentName}:`, error.message);
    }
  }
}
```

**Tests:**
- `src/lib/evolution/core/costTracker.test.ts` — Test `getAllAgentCosts()` method
- `src/lib/evolution/core/__tests__/agent-metrics.integration.test.ts` — Integration test metric persistence

### Phase 3: Data-Driven Cost Estimation
**Goal:** Replace hardcoded rates with calibrated predictions.

**Step 3a: Build baseline table from historical data**
```sql
CREATE TABLE evolution_agent_cost_baselines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  model TEXT NOT NULL,
  avg_prompt_tokens INT,
  avg_completion_tokens INT,
  avg_cost_usd NUMERIC(10, 6),
  avg_text_length INT,  -- for scaling
  sample_size INT,
  last_updated TIMESTAMP DEFAULT NOW(),
  UNIQUE (agent_name, model)
);

-- Populate from llmCallTracking
INSERT INTO evolution_agent_cost_baselines (agent_name, model, avg_prompt_tokens, avg_completion_tokens, avg_cost_usd, sample_size)
SELECT
  REPLACE(call_source, 'evolution_', '') as agent_name,
  model,
  AVG(prompt_tokens)::INT,
  AVG(completion_tokens)::INT,
  AVG(estimated_cost_usd),
  COUNT(*)
FROM llmCallTracking
WHERE call_source LIKE 'evolution_%'
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY call_source, model
HAVING COUNT(*) >= 10;  -- Minimum sample size
```

**Step 3b: Create cost estimator service (`src/lib/evolution/core/costEstimator.ts`):**
```typescript
import { calculateLLMCost } from '@/config/llmPricing';
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

interface CostBaseline {
  avgPromptTokens: number;
  avgCompletionTokens: number;
  avgCostUsd: number;
  avgTextLength: number;
  sampleSize: number;
}

const baselineCache = new Map<string, CostBaseline>();

export async function getAgentBaseline(
  agentName: string,
  model: string
): Promise<CostBaseline | null> {
  const key = `${agentName}:${model}`;
  if (baselineCache.has(key)) return baselineCache.get(key)!;

  const supabase = await createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('evolution_agent_cost_baselines')
    .select('*')
    .eq('agent_name', agentName)
    .eq('model', model)
    .single();

  if (error) {
    // PGRST116 = no rows found (expected for new agent/model combos)
    if (error.code !== 'PGRST116') {
      console.warn(`Failed to fetch baseline for ${agentName}/${model}:`, error.message);
    }
    return null;
  }

  if (data && data.sample_size >= 50) {
    const baseline = {
      avgPromptTokens: data.avg_prompt_tokens,
      avgCompletionTokens: data.avg_completion_tokens,
      avgCostUsd: data.avg_cost_usd,
      avgTextLength: data.avg_text_length ?? 5000,
      sampleSize: data.sample_size,
    };
    baselineCache.set(key, baseline);
    return baseline;
  }
  return null;
}

export async function estimateAgentCost(
  agentName: string,
  model: string,
  textLength: number,
  callMultiplier: number = 1
): Promise<number> {
  const baseline = await getAgentBaseline(agentName, model);

  if (baseline) {
    const textRatio = textLength / baseline.avgTextLength;
    return baseline.avgCostUsd * textRatio * callMultiplier;
  }

  // Fallback to heuristic
  const tokens = Math.ceil(textLength / 4);
  return calculateLLMCost(model, tokens + 200, tokens) * callMultiplier;
}

export interface RunCostEstimate {
  totalUsd: number;
  perAgent: Record<string, number>;
  perIteration: number;
  confidence: 'high' | 'medium' | 'low';
}

// Per-agent model configuration (matches AgentModelsSchema)
interface AgentModels {
  generation?: AllowedLLMModelType;
  evolution?: AllowedLLMModelType;
  reflection?: AllowedLLMModelType;
  debate?: AllowedLLMModelType;
  iterativeEditing?: AllowedLLMModelType;
  calibration?: AllowedLLMModelType;
  tournament?: AllowedLLMModelType;
}

interface RunCostConfig {
  generationModel?: AllowedLLMModelType;
  judgeModel?: AllowedLLMModelType;
  maxIterations?: number;
  agentModels?: AgentModels;  // Per-agent overrides
}

/**
 * Estimate run cost with support for per-agent model overrides.
 * Each agent uses: agentModels[agent] ?? (isJudgeAgent ? judgeModel : generationModel)
 */
export async function estimateRunCostWithAgentModels(
  config: RunCostConfig,
  textLength: number
): Promise<RunCostEstimate> {
  const defaultGenModel = config.generationModel ?? 'deepseek-chat';
  const defaultJudgeModel = config.judgeModel ?? 'gpt-4.1-nano';
  const agentModels = config.agentModels ?? {};
  const iterations = config.maxIterations ?? 15;
  const expansionIters = Math.min(8, iterations);
  const competitionIters = iterations - expansionIters;

  // Resolve model for each agent (override or default)
  const getModel = (agent: string, isJudge: boolean): AllowedLLMModelType => {
    return (agentModels as Record<string, AllowedLLMModelType | undefined>)[agent]
      ?? (isJudge ? defaultJudgeModel : defaultGenModel);
  };

  const perAgent: Record<string, number> = {};

  // Generation agents (use generationModel as default)
  perAgent.generation = await estimateAgentCost('generation', getModel('generation', false), textLength, 3) * iterations;
  perAgent.evolution = await estimateAgentCost('evolution', getModel('evolution', false), textLength, 3) * competitionIters;
  perAgent.reflection = await estimateAgentCost('reflection', getModel('reflection', false), textLength, 3) * competitionIters;
  perAgent.debate = await estimateAgentCost('debate', getModel('debate', false), textLength, 4) * competitionIters;
  perAgent.iterativeEditing = await estimateAgentCost('iterativeEditing', getModel('iterativeEditing', false), textLength, 6) * competitionIters;

  // Judge agents (use judgeModel as default)
  const calibrationCallsExp = 3 * 3 * 2;
  const calibrationCallsComp = 3 * 5 * 2;
  perAgent.calibration =
    await estimateAgentCost('calibration', getModel('calibration', true), textLength * 2, calibrationCallsExp) * expansionIters +
    await estimateAgentCost('calibration', getModel('calibration', true), textLength * 2, calibrationCallsComp) * competitionIters;
  perAgent.tournament = await estimateAgentCost('tournament', getModel('tournament', true), textLength * 2, 25 * 2) * competitionIters;

  const totalUsd = Object.values(perAgent).reduce((a, b) => a + b, 0);
  const perIteration = totalUsd / iterations;

  // Confidence based on baseline sample sizes for most-used models
  const baselines = await Promise.all([
    getAgentBaseline('generation', getModel('generation', false)),
    getAgentBaseline('calibration', getModel('calibration', true)),
  ]);
  const hasBaselines = baselines.filter(b => b && b.sampleSize >= 50).length;
  const confidence = hasBaselines >= 2 ? 'high' : hasBaselines >= 1 ? 'medium' : 'low';

  return { totalUsd, perAgent, perIteration, confidence };
}

// Backward-compatible wrapper
export async function estimateRunCost(
  config: EvolutionRunConfig,
  textLength: number
): Promise<RunCostEstimate> {
  return estimateRunCostWithAgentModels(config, textLength);
}
```

**Step 3c: Track predicted vs actual**
- Add `estimated_cost_usd` column to `evolution_runs`
- Add `estimatedCostUsd?: number` to `AgentResult`
- Extend `EvolutionRunSummary` with cost prediction data:
  ```typescript
  costPrediction?: {
    estimatedUsd: number;
    actualUsd: number;
    deltaUsd: number;
    deltaPercent: number;
    confidence: 'high' | 'medium' | 'low';
    perAgent: Record<string, { estimated: number; actual: number }>;
  }
  ```

**Tests:** Verify estimates within 50% of actual for diverse text lengths and configs.

### Phase 4: JSON Batch Config with Combinatorial Expansion
**Goal:** Systematically explore model × iteration × budget configuration space.

**New files:**
- `src/config/batchRunSchema.ts` — Zod schema for batch config
- `scripts/run-batch.ts` — Batch executor with budget constraint
- `src/lib/services/batchRunActions.ts` — Server actions for batch management

**Batch config schema:**
```typescript
import { z } from 'zod';
import { allowedLLMModelSchema } from '@/lib/schemas/schemas';

// Agent budget allocation as percentages (0.0-1.0), matching existing EvolutionRunConfig.budgetCaps
const AgentBudgetCapsSchema = z.object({
  generation: z.number().min(0).max(1).optional(),
  calibration: z.number().min(0).max(1).optional(),
  tournament: z.number().min(0).max(1).optional(),
  evolution: z.number().min(0).max(1).optional(),
  reflection: z.number().min(0).max(1).optional(),
  debate: z.number().min(0).max(1).optional(),
  iterativeEditing: z.number().min(0).max(1).optional(),
}).refine(caps => {
  const sum = Object.values(caps).reduce((a, b) => a + (b ?? 0), 0);
  return sum <= 1.0;
}, { message: 'Agent budget caps must sum to <= 1.0' });

// Per-agent model overrides for fine-grained experimentation
// Allows assigning different models to different agents (e.g., cheap model for generation, capable model for judging)
const AgentModelsSchema = z.object({
  // Generation agents (text creation)
  generation: allowedLLMModelSchema.optional(),      // Default: generationModel
  evolution: allowedLLMModelSchema.optional(),       // Default: generationModel
  reflection: allowedLLMModelSchema.optional(),      // Default: generationModel
  debate: allowedLLMModelSchema.optional(),          // Default: generationModel
  iterativeEditing: allowedLLMModelSchema.optional(), // Default: generationModel
  // Judge agents (comparison/ranking)
  calibration: allowedLLMModelSchema.optional(),     // Default: judgeModel
  tournament: allowedLLMModelSchema.optional(),      // Default: judgeModel
}).describe('Per-agent model overrides. Unset agents use generationModel/judgeModel defaults.');

export const BatchRunSpecSchema = z.object({
  prompt: z.string(),
  generationModel: allowedLLMModelSchema,  // Default for generation agents
  judgeModel: allowedLLMModelSchema,       // Default for judge agents
  agentModels: AgentModelsSchema.optional(), // Per-agent overrides
  iterations: z.number().min(1).max(30),
  budgetCapUsd: z.number().positive(),
  budgetCaps: AgentBudgetCapsSchema.optional(),  // Percentages, not absolute USD
  mode: z.enum(['minimal', 'full']).default('full'),
  bankCheckpoints: z.array(z.number()).optional(),
});

export const BatchConfigSchema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Name must be alphanumeric with underscores/hyphens'),
  description: z.string().optional(),
  totalBudgetUsd: z.number().positive(),
  safetyMargin: z.number().min(0).max(0.5).default(0.1),  // 10% safety margin
  defaults: BatchRunSpecSchema.partial(),
  matrix: z.object({
    prompts: z.array(z.string()),
    generationModels: z.array(allowedLLMModelSchema),
    judgeModels: z.array(allowedLLMModelSchema),
    iterations: z.array(z.number()),
    // Optional: per-agent model matrices for fine-grained experimentation
    // If provided, expands to all combinations of agent model assignments
    agentModelVariants: z.array(AgentModelsSchema).optional(),
  }).optional(),
  runs: z.array(BatchRunSpecSchema.partial()).optional(),
  comparison: z.object({
    enabled: z.boolean().default(true),
    judgeModel: allowedLLMModelSchema,
    rounds: z.number().default(3),
  }).optional(),
  optimization: z.object({
    adaptiveAllocation: z.boolean().default(false),
    prioritySort: z.enum(['cost_asc', 'elo_per_dollar_desc', 'random']).default('cost_asc'),
  }).optional(),
});

export type BatchConfig = z.infer<typeof BatchConfigSchema>;
export type BatchRunSpec = z.infer<typeof BatchRunSpecSchema>;
```

**CLI config file validation (`scripts/run-batch.ts`):**
```typescript
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// ES module compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadAndValidateConfig(configPath: string): BatchConfig {
  // Security: Validate config path is within allowed directories
  const resolved = path.resolve(configPath);
  const projectRoot = path.resolve(__dirname, '..');
  const allowedDirs = [
    path.join(projectRoot, 'experiments'),
    path.join(projectRoot, 'config'),
  ];

  const isAllowed = allowedDirs.some(dir => resolved.startsWith(dir));
  if (!isAllowed) {
    throw new Error(`Config file must be in experiments/ or config/ directory. Got: ${resolved}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, 'utf-8'));
  } catch (e) {
    throw new Error(`Invalid JSON in config file: ${e instanceof Error ? e.message : String(e)}`);
  }

  return BatchConfigSchema.parse(raw);
}
```

**New table for batch tracking:**
```sql
-- Migration: 20260205000003_add_evolution_batch_runs.sql
-- Depends on: nothing (standalone table)
CREATE TABLE evolution_batch_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, running, completed, failed, paused
  total_budget_usd NUMERIC(10, 2) NOT NULL,
  spent_usd NUMERIC(10, 4) DEFAULT 0,
  estimated_usd NUMERIC(10, 4),
  runs_planned INT DEFAULT 0,
  runs_completed INT DEFAULT 0,
  runs_failed INT DEFAULT 0,
  execution_plan JSONB,  -- Array of expanded run specs with status
  results JSONB,  -- Final summary after completion
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_evolution_batch_runs_status ON evolution_batch_runs(status);

-- Rollback:
-- DROP INDEX IF EXISTS idx_evolution_batch_runs_status;
-- DROP TABLE IF EXISTS evolution_batch_runs;
```

**Example config (basic - using generationModel/judgeModel):**
```json
{
  "name": "elo_optimization_experiment_1",
  "description": "Testing model × iteration combinations for Elo/dollar optimization",
  "totalBudgetUsd": 50.00,
  "safetyMargin": 0.1,
  "defaults": {
    "budgetCapUsd": 5.00,
    "mode": "full",
    "bankCheckpoints": [5, 10]
  },
  "matrix": {
    "prompts": [
      "Explain photosynthesis",
      "Explain blockchain technology",
      "Explain the causes of World War I"
    ],
    "generationModels": ["deepseek-chat", "gpt-4.1-mini", "gpt-5-nano"],
    "judgeModels": ["gpt-4.1-nano"],
    "iterations": [5, 10, 15]
  },
  "comparison": {
    "enabled": true,
    "judgeModel": "gpt-4.1-nano",
    "rounds": 3
  },
  "optimization": {
    "adaptiveAllocation": true,
    "prioritySort": "cost_asc"
  }
}
```
This expands to 3 × 3 × 1 × 3 = 27 runs.

**Example config (advanced - per-agent model overrides):**
```json
{
  "name": "agent_model_experiment",
  "description": "Testing different models for generation vs competition phases",
  "totalBudgetUsd": 30.00,
  "defaults": {
    "budgetCapUsd": 3.00,
    "generationModel": "deepseek-chat",
    "judgeModel": "gpt-4.1-nano"
  },
  "matrix": {
    "prompts": ["Explain quantum entanglement"],
    "generationModels": ["deepseek-chat"],
    "judgeModels": ["gpt-4.1-nano"],
    "iterations": [10],
    "agentModelVariants": [
      {
        "comment": "Baseline: cheap generation, cheap judging"
      },
      {
        "comment": "Upgrade tournament judge for better final ranking",
        "tournament": "gpt-4.1-mini"
      },
      {
        "comment": "Use capable model for evolution mutations",
        "evolution": "gpt-4.1-mini"
      },
      {
        "comment": "Premium: capable model for both evolution and tournament",
        "evolution": "gpt-4.1-mini",
        "tournament": "gpt-4.1-mini"
      }
    ]
  }
}
```
This expands to 1 × 1 × 1 × 1 × 4 = 4 runs with different agent model configurations.

**Expansion and filtering algorithm:**
```typescript
interface ExpandedRun extends BatchRunSpec {
  estimatedCost: number;
  priority: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}

async function expandAndFilter(config: BatchConfig): Promise<ExpandedRun[]> {
  const expanded: ExpandedRun[] = [];

  // 1. Build Cartesian product from matrix
  if (config.matrix) {
    // Get agentModelVariants or use single empty object (no overrides)
    const agentModelVariants = config.matrix.agentModelVariants?.length
      ? config.matrix.agentModelVariants
      : [{}];  // Default: no per-agent overrides

    for (const prompt of config.matrix.prompts) {
      for (const genModel of config.matrix.generationModels) {
        for (const judgeModel of config.matrix.judgeModels) {
          for (const iterations of config.matrix.iterations) {
            for (const agentModels of agentModelVariants) {
              expanded.push({
                ...config.defaults,
                prompt,
                generationModel: genModel,
                judgeModel,
                iterations,
                agentModels,  // Per-agent model overrides
                estimatedCost: 0,
                priority: 0,
                status: 'pending',
              } as ExpandedRun);
            }
          }
        }
      }
    }
  }

  // 2. Add explicit runs
  if (config.runs) {
    for (const run of config.runs) {
      expanded.push({
        ...config.defaults,
        ...run,
        estimatedCost: 0,
        priority: 0,
        status: 'pending',
      } as ExpandedRun);
    }
  }

  // 3. Estimate costs (accounting for per-agent model overrides)
  for (const run of expanded) {
    const estimate = await estimateRunCostWithAgentModels(
      {
        generationModel: run.generationModel,
        judgeModel: run.judgeModel,
        maxIterations: run.iterations,
        agentModels: run.agentModels,  // Pass per-agent overrides
      },
      run.prompt.length * 100  // Rough text length estimate from prompt
    );
    run.estimatedCost = estimate.totalUsd;
  }

  // 4. Sort by priority strategy
  if (config.optimization?.prioritySort === 'cost_asc') {
    expanded.sort((a, b) => a.estimatedCost - b.estimatedCost);
  } else if (config.optimization?.prioritySort === 'elo_per_dollar_desc') {
    // Use historical Elo/dollar data to prioritize
    for (const run of expanded) {
      run.priority = await getHistoricalEloPerDollar(run.generationModel) ?? 0;
    }
    expanded.sort((a, b) => b.priority - a.priority);
  }

  // 5. Greedily select until budget exhausted (with safety margin)
  const effectiveBudget = config.totalBudgetUsd * (1 - (config.safetyMargin ?? 0.1));
  let budgetRemaining = effectiveBudget;

  for (const run of expanded) {
    if (run.estimatedCost <= budgetRemaining) {
      budgetRemaining -= run.estimatedCost;
    } else {
      run.status = 'skipped';
    }
  }

  return expanded;
}
```

**CLI (`scripts/run-batch.ts`):**
```bash
npx tsx scripts/run-batch.ts --config batch.json [--dry-run] [--confirm] [--resume <batch-id>]
```

**Per-agent model runtime integration:**

When executing a batch run with `agentModels`, the batch executor passes these to the pipeline:
```typescript
// In run-batch.ts, when executing each expanded run:
async function executeRun(run: ExpandedRun): Promise<void> {
  const config: EvolutionRunConfig = {
    ...run,
    // Per-agent models stored in config for agent lookup
    agentModels: run.agentModels,
  };

  await executeFullPipeline(config, ...);
}

// In each agent (e.g., src/lib/evolution/agents/evolvePool.ts):
export class EvolutionAgent implements Agent {
  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    // Resolve model: per-agent override → generationModel default
    const model = ctx.config.agentModels?.evolution ?? ctx.config.generationModel;
    const client = ctx.llmClientFactory(model);
    // ... use client for LLM calls
  }
}

// Similarly for judge agents (calibrationRanker.ts, tournament.ts):
const model = ctx.config.agentModels?.tournament ?? ctx.config.judgeModel;
```

**Note:** This requires adding `agentModels?: AgentModels` to `EvolutionRunConfig` in `types.ts`.

**Tests:** Schema validation, expansion correctness, budget constraint enforcement, resume from checkpoint, per-agent model resolution.

### Phase 5: Adaptive Budget Allocation
**Goal:** Automatically shift budget toward high-ROI agents based on historical data.

**Leverage MetaReviewAgent patterns:**
The MetaReviewAgent already computes strategy effectiveness. We extend this to budget allocation:

```typescript
// src/lib/evolution/core/adaptiveAllocation.ts
import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

interface AgentROI {
  agentName: string;
  avgCostUsd: number;
  avgEloGain: number;
  avgEloPerDollar: number;
  sampleSize: number;
}

export async function getAgentROILeaderboard(
  lookbackDays: number = 30
): Promise<AgentROI[]> {
  const supabase = await createSupabaseServiceClient();
  const { data, error } = await supabase
    .from('evolution_run_agent_metrics')
    .select('agent_name, cost_usd, elo_gain, elo_per_dollar')
    .gte('created_at', new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString());

  if (error) {
    console.warn('Failed to fetch agent metrics:', error.message);
    return [];  // Return empty leaderboard on error - will fall back to defaults
  }

  // Aggregate by agent
  const byAgent = new Map<string, { costs: number[]; gains: number[]; epds: number[] }>();
  for (const row of data ?? []) {
    const existing = byAgent.get(row.agent_name) ?? { costs: [], gains: [], epds: [] };
    existing.costs.push(row.cost_usd);
    if (row.elo_gain) existing.gains.push(row.elo_gain);
    if (row.elo_per_dollar) existing.epds.push(row.elo_per_dollar);
    byAgent.set(row.agent_name, existing);
  }

  const leaderboard: AgentROI[] = [];
  for (const [agentName, data] of byAgent) {
    leaderboard.push({
      agentName,
      avgCostUsd: data.costs.reduce((a, b) => a + b, 0) / data.costs.length,
      avgEloGain: data.gains.length > 0 ? data.gains.reduce((a, b) => a + b, 0) / data.gains.length : 0,
      avgEloPerDollar: data.epds.length > 0 ? data.epds.reduce((a, b) => a + b, 0) / data.epds.length : 0,
      sampleSize: data.costs.length,
    });
  }

  return leaderboard.sort((a, b) => b.avgEloPerDollar - a.avgEloPerDollar);
}

export async function computeAdaptiveBudgetCaps(
  lookbackDays: number = 30,
  minFloor: number = 0.05,
  maxCeiling: number = 0.40
): Promise<Record<string, number>> {
  const leaderboard = await getAgentROILeaderboard(lookbackDays);

  // Filter to agents with sufficient sample size
  const qualified = leaderboard.filter(a => a.sampleSize >= 10 && a.avgEloPerDollar > 0);

  if (qualified.length === 0) {
    // Fall back to defaults from existing config
    // Import: import { DEFAULT_EVOLUTION_CONFIG } from '@/lib/evolution/config';
    return DEFAULT_EVOLUTION_CONFIG.budgetCaps;
  }

  const totalEpd = qualified.reduce((s, a) => s + a.avgEloPerDollar, 0);

  const caps: Record<string, number> = {};
  for (const agent of qualified) {
    const share = agent.avgEloPerDollar / totalEpd;
    caps[agent.agentName] = Math.max(minFloor, Math.min(maxCeiling, share));
  }

  // Add floor for agents not in leaderboard
  const allAgents = ['generation', 'calibration', 'tournament', 'evolution', 'reflection', 'debate', 'iterativeEditing'];
  for (const agent of allAgents) {
    if (!(agent in caps)) {
      caps[agent] = minFloor;
    }
  }

  // Normalize to sum to 1.0
  const sum = Object.values(caps).reduce((a, b) => a + b, 0);
  for (const k of Object.keys(caps)) caps[k] /= sum;

  return caps;
}
```

**Integration:**
- Add `--adaptive-allocation` flag to `run-batch.ts`
- Before each run, compute caps from recent data and merge into config
- Track which allocation was used in `evolution_runs.config`
- Log allocation decisions: `logger.info('Adaptive allocation', { caps, leaderboard })`

### Phase 6: Reporting and Analysis Dashboard
**Goal:** Surface optimization insights from two complementary angles: **Agent-level** and **Strategy-level**.

#### Two Analysis Dimensions

| Dimension | Unit of Analysis | Key Question |
|-----------|------------------|--------------|
| **Agent** | Individual agent (generation, calibration, etc.) | "Which agents produce the most Elo per dollar?" |
| **Strategy** | Complete config (models + iterations + budgetCaps + agentModels) | "Which configuration produces the best results?" |

#### Strategy Config Identity

A **Strategy** is a unique configuration fingerprint. We hash the config to create a stable ID:

```typescript
// src/lib/evolution/core/strategyConfig.ts
import { createHash } from 'crypto';

interface StrategyConfig {
  generationModel: string;
  judgeModel: string;
  agentModels?: Record<string, string>;  // Per-agent overrides
  iterations: number;
  budgetCaps: Record<string, number>;
}

/**
 * Generate a stable hash for a strategy config.
 * Configs with identical settings get the same hash.
 */
export function hashStrategyConfig(config: StrategyConfig): string {
  // Normalize: sort keys, remove undefined, ensure consistent order
  const normalized = {
    generationModel: config.generationModel,
    judgeModel: config.judgeModel,
    agentModels: config.agentModels
      ? Object.keys(config.agentModels).sort().reduce((acc, k) => {
          acc[k] = config.agentModels![k];
          return acc;
        }, {} as Record<string, string>)
      : null,
    iterations: config.iterations,
    budgetCaps: Object.keys(config.budgetCaps).sort().reduce((acc, k) => {
      acc[k] = config.budgetCaps[k];
      return acc;
    }, {} as Record<string, number>),
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 12);
}

/**
 * Auto-generated label describing the strategy config.
 * Format: "Gen: model | Judge: model | Iters: N | Overrides: ..."
 */
export function labelStrategyConfig(config: StrategyConfig): string {
  const parts: string[] = [];

  // Generation model (shortened)
  const genShort = config.generationModel
    .replace('gpt-', '')
    .replace('deepseek-', 'ds-')
    .replace('claude-', 'cl-');
  parts.push(`Gen: ${genShort}`);

  // Judge model (shortened)
  const judgeShort = config.judgeModel
    .replace('gpt-', '')
    .replace('deepseek-', 'ds-')
    .replace('claude-', 'cl-');
  parts.push(`Judge: ${judgeShort}`);

  // Iterations
  parts.push(`${config.iterations} iters`);

  // Per-agent overrides (if any)
  if (config.agentModels && Object.keys(config.agentModels).length > 0) {
    const overrides = Object.entries(config.agentModels)
      .map(([agent, model]) => `${agent}: ${model.replace('gpt-', '')}`)
      .join(', ');
    parts.push(`Overrides: ${overrides}`);
  }

  return parts.join(' | ');
}

/**
 * Generate a default name for a new strategy.
 * Users can edit this to something more meaningful.
 */
export function defaultStrategyName(config: StrategyConfig, hash: string): string {
  const genModel = config.generationModel.split('-').pop() ?? 'unknown';
  return `Strategy ${hash.slice(0, 6)} (${genModel}, ${config.iterations}it)`;
}
```

#### Strategy Tracking Table

```sql
-- Migration: 20260205000005_add_evolution_strategy_configs.sql
CREATE TABLE evolution_strategy_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config_hash TEXT NOT NULL UNIQUE,  -- 12-char sha256 prefix, immutable

  -- User-facing fields
  name TEXT NOT NULL,                -- User-editable display name (e.g., "Premium Tournament Judge")
  description TEXT,                  -- Optional notes about this strategy
  label TEXT NOT NULL,               -- Auto-generated summary (e.g., "Gen: ds-chat | Judge: 4.1-nano | 10 iters")

  -- Full config for inspection and reproduction
  config JSONB NOT NULL,             -- Complete StrategyConfig object

  -- Aggregated metrics (updated after each run)
  run_count INT DEFAULT 0,
  total_cost_usd NUMERIC(10, 4) DEFAULT 0,
  avg_final_elo NUMERIC(8, 2),
  avg_elo_per_dollar NUMERIC(12, 2),
  best_final_elo NUMERIC(8, 2),
  worst_final_elo NUMERIC(8, 2),
  stddev_final_elo NUMERIC(8, 2),

  first_used_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_evolution_strategy_configs_hash ON evolution_strategy_configs(config_hash);
CREATE INDEX idx_evolution_strategy_configs_name ON evolution_strategy_configs(name);
CREATE INDEX idx_evolution_strategy_configs_elo_per_dollar ON evolution_strategy_configs(avg_elo_per_dollar DESC NULLS LAST);

-- Link runs to strategies
ALTER TABLE evolution_runs
  ADD COLUMN strategy_config_id UUID REFERENCES evolution_strategy_configs(id);

-- Rollback:
-- ALTER TABLE evolution_runs DROP COLUMN strategy_config_id;
-- DROP INDEX IF EXISTS idx_evolution_strategy_configs_elo_per_dollar;
-- DROP INDEX IF EXISTS idx_evolution_strategy_configs_name;
-- DROP INDEX IF EXISTS idx_evolution_strategy_configs_hash;
-- DROP TABLE IF EXISTS evolution_strategy_configs;
```

#### Config Display Component

The dashboard shows the full config in a clear, readable format:

```typescript
// src/components/admin/optimization/StrategyConfigDisplay.tsx

interface StrategyConfigDisplayProps {
  config: StrategyConfig;
  showRaw?: boolean;  // Toggle JSON view
}

export function StrategyConfigDisplay({ config, showRaw }: StrategyConfigDisplayProps) {
  if (showRaw) {
    return <pre className="text-xs bg-muted p-3 rounded">{JSON.stringify(config, null, 2)}</pre>;
  }

  return (
    <div className="space-y-3">
      {/* Models Section */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground">Models</h4>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <ConfigRow label="Generation" value={config.generationModel} />
          <ConfigRow label="Judge" value={config.judgeModel} />
        </div>
      </div>

      {/* Per-Agent Overrides */}
      {config.agentModels && Object.keys(config.agentModels).length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-muted-foreground">Agent Model Overrides</h4>
          <div className="grid grid-cols-2 gap-2 mt-1">
            {Object.entries(config.agentModels).map(([agent, model]) => (
              <ConfigRow key={agent} label={agent} value={model} highlight />
            ))}
          </div>
        </div>
      )}

      {/* Iterations & Budget */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground">Execution</h4>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <ConfigRow label="Iterations" value={config.iterations.toString()} />
          <ConfigRow label="Total Budget Cap" value={`$${Object.values(config.budgetCaps).reduce((a, b) => a + b, 0).toFixed(2)}`} />
        </div>
      </div>

      {/* Budget Allocation */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground">Budget Allocation</h4>
        <div className="flex gap-1 mt-1">
          {Object.entries(config.budgetCaps)
            .sort(([, a], [, b]) => b - a)
            .map(([agent, pct]) => (
              <div
                key={agent}
                className="text-xs px-2 py-1 bg-muted rounded"
                title={`${agent}: ${(pct * 100).toFixed(0)}%`}
              >
                {agent.slice(0, 3)}: {(pct * 100).toFixed(0)}%
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
```

#### Pipeline Integration

```typescript
// At start of executeFullPipeline:
async function resolveStrategyConfig(
  config: EvolutionRunConfig,
  customName?: string  // Optional: user-provided name from batch config
): Promise<string> {
  const strategyConfig: StrategyConfig = {
    generationModel: config.generationModel ?? 'deepseek-chat',
    judgeModel: config.judgeModel ?? 'gpt-4.1-nano',
    agentModels: config.agentModels,
    iterations: config.maxIterations ?? 15,
    budgetCaps: config.budgetCaps ?? DEFAULT_EVOLUTION_CONFIG.budgetCaps,
  };

  const hash = hashStrategyConfig(strategyConfig);
  const label = labelStrategyConfig(strategyConfig);
  const name = customName ?? defaultStrategyName(strategyConfig, hash);
  const supabase = await createSupabaseServiceClient();

  // Upsert strategy config (idempotent - only inserts if hash doesn't exist)
  // Note: name is only set on first insert; subsequent runs don't overwrite user edits
  const { data, error } = await supabase
    .from('evolution_strategy_configs')
    .upsert(
      { config_hash: hash, name, label, config: strategyConfig },
      { onConflict: 'config_hash', ignoreDuplicates: true }
    )
    .select('id')
    .single();

  if (error) throw new Error(`Failed to resolve strategy config: ${error.message}`);
  return data.id;
}

// At end of run, update aggregates:
async function updateStrategyMetrics(strategyConfigId: string, runMetrics: RunMetrics): Promise<void> {
  // Use SQL for atomic aggregate update
  await supabase.rpc('update_strategy_aggregates', {
    p_strategy_id: strategyConfigId,
    p_cost_usd: runMetrics.totalCostUsd,
    p_final_elo: runMetrics.topVariantElo,
  });
}
```

#### Server Actions

```typescript
// src/lib/services/eloBudgetActions.ts

// ─── AGENT-LEVEL ANALYSIS ───────────────────────────────────────

/** Agent ROI leaderboard: which agents produce most Elo per dollar? */
export const getAgentROILeaderboardAction = withLogging(async function getAgentROILeaderboard(
  filters?: { lookbackDays?: number; minSampleSize?: number }
): Promise<ActionResult<AgentROI[]>>

/** Agent cost breakdown by model: how much does each agent cost with different models? */
export const getAgentCostByModelAction = withLogging(async function getAgentCostByModel(
  agentName: string
): Promise<ActionResult<{ model: string; avgCost: number; sampleSize: number }[]>>

/** Agent contribution analysis: how much Elo does each agent add to final result? */
export const getAgentContributionAction = withLogging(async function getAgentContribution(
  strategyConfigId?: string  // Optional: filter to specific strategy
): Promise<ActionResult<{ agent: string; avgEloContribution: number }[]>>


// ─── STRATEGY-LEVEL ANALYSIS ────────────────────────────────────

/** Strategy leaderboard: which configs produce best results? */
export const getStrategyLeaderboardAction = withLogging(async function getStrategyLeaderboard(
  filters?: {
    minRuns?: number;        // Require N runs for statistical confidence
    sortBy?: 'avg_elo' | 'avg_elo_per_dollar' | 'best_elo' | 'consistency';
  }
): Promise<ActionResult<StrategyLeaderboardEntry[]>>

interface StrategyLeaderboardEntry {
  id: string;
  configHash: string;

  // User-facing identification
  name: string;               // User-editable name (e.g., "Premium Tournament v2")
  description: string | null; // Optional notes
  label: string;              // Auto-generated summary: "Gen: ds-chat | Judge: 4.1-nano | 10 iters"

  // Full config for inspection
  config: StrategyConfig;     // Complete config object (see StrategyConfigDisplay component)

  // Performance metrics
  runCount: number;
  totalCostUsd: number;
  avgFinalElo: number;
  avgEloPerDollar: number;
  bestFinalElo: number;
  worstFinalElo: number;
  stddevFinalElo: number;     // Lower = more consistent
  lastUsedAt: Date;
}

/** Strategy comparison: side-by-side metrics for 2+ strategies */
export const compareStrategiesAction = withLogging(async function compareStrategies(
  strategyIds: string[]  // 2-4 strategy IDs to compare
): Promise<ActionResult<StrategyComparison>>

interface StrategyComparison {
  strategies: StrategyLeaderboardEntry[];
  configDiff: {
    field: string;           // 'generationModel', 'agentModels.evolution', etc.
    values: string[];        // Value for each strategy
  }[];
  winner: {
    byElo: string;           // Strategy ID with highest avg Elo
    byEloPerDollar: string;  // Strategy ID with best efficiency
    byConsistency: string;   // Strategy ID with lowest stddev
  };
}

/** Strategy detail: all runs for a specific strategy */
export const getStrategyRunsAction = withLogging(async function getStrategyRuns(
  strategyId: string,
  pagination?: { limit: number; offset: number }
): Promise<ActionResult<{ runs: EvolutionRunSummary[]; total: number }>>

/** Strategy Pareto frontier: Elo vs Cost with strategies as points */
export const getStrategyParetoAction = withLogging(async function getStrategyPareto(
  filters?: { minRuns?: number }
): Promise<ActionResult<ParetoPoint[]>>

interface ParetoPoint {
  strategyId: string;
  name: string;               // User-editable name
  label: string;              // Auto-generated summary
  avgCostUsd: number;
  avgFinalElo: number;
  isPareto: boolean;          // True if on Pareto frontier
  runCount: number;
}


// ─── STRATEGY MANAGEMENT ────────────────────────────────────────

/** Update strategy name or description */
export const updateStrategyAction = withLogging(async function updateStrategy(
  strategyId: string,
  updates: { name?: string; description?: string }
): Promise<ActionResult<StrategyLeaderboardEntry>>

/** Get single strategy with full config */
export const getStrategyAction = withLogging(async function getStrategy(
  strategyId: string
): Promise<ActionResult<StrategyLeaderboardEntry>>

/** Clone a strategy config (creates new entry if config differs) */
export const cloneStrategyAction = withLogging(async function cloneStrategy(
  strategyId: string,
  modifications: Partial<StrategyConfig>,
  newName: string
): Promise<ActionResult<{ id: string; isNew: boolean }>>  // isNew=false if config already exists


// ─── RECOMMENDATIONS ────────────────────────────────────────────

/** Given a budget, recommend the best strategy config */
export const getRecommendedStrategyAction = withLogging(async function getRecommendedStrategy(
  params: {
    budgetUsd: number;
    optimizeFor: 'elo' | 'elo_per_dollar' | 'consistency';
  }
): Promise<ActionResult<{
  recommended: StrategyLeaderboardEntry;
  alternatives: StrategyLeaderboardEntry[];  // 2-3 other good options
  reasoning: string;
}>>
```

#### Dashboard UI

**Route:** `/admin/quality/optimization`

**Tab 1: Strategy Analysis** (default)
| Component | Description |
|-----------|-------------|
| `StrategyLeaderboard.tsx` | Sortable table with columns: Name, Label (auto-summary), Avg Elo, Elo/$, Runs, Consistency. Click row to expand config. |
| `StrategyParetoChart.tsx` | Scatter plot: X=cost, Y=Elo. Hover shows name + label. Click opens detail panel. |
| `StrategyComparison.tsx` | Select 2-3 strategies, see side-by-side: full config diff + metrics comparison |
| `StrategyDetail.tsx` | Full strategy view: editable name, description, StrategyConfigDisplay, run history, Elo distribution chart |
| `StrategyRecommender.tsx` | Input budget → get recommended strategy with full config shown |

**Strategy Leaderboard columns:**
```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Name ▼           │ Config Summary              │ Avg Elo │ Elo/$ │ Runs │ σ    │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Premium Judge v2 │ Gen: ds-chat | Judge: 4.1.. │ 1342    │ 284   │ 12   │ 23.4 │
│ [✏️ edit]        │ [📋 view full config]       │         │       │      │      │
├─────────────────────────────────────────────────────────────────────────────────┤
│ Budget Baseline  │ Gen: ds-chat | Judge: 4.1.. │ 1298    │ 432   │ 8    │ 31.2 │
│ [✏️ edit]        │ [📋 view full config]       │         │       │      │      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Expanded row shows full config via `StrategyConfigDisplay`:**
- Models (generation, judge)
- Per-agent overrides (highlighted if present)
- Iterations
- Budget allocation breakdown

**Tab 2: Agent Analysis**
| Component | Description |
|-----------|-------------|
| `AgentROILeaderboard.tsx` | Which agents produce most Elo per dollar? |
| `AgentCostByModel.tsx` | For a selected agent, how does cost vary by model? |
| `AgentContribution.tsx` | Stacked bar: how much Elo does each agent contribute? |
| `AgentBudgetOptimizer.tsx` | Given agent ROI data, suggest optimal budget allocation |

**Tab 3: Cost Analysis**
| Component | Description |
|-----------|-------------|
| `PredictedVsActualChart.tsx` | Line chart: estimated vs actual cost over time |
| `CostBreakdownByAgent.tsx` | Pie chart: where does the money go? |
| `IterationCostCurve.tsx` | At what iteration does marginal cost exceed marginal Elo? |

#### Example Dashboard Queries

**"Which strategy is best for my $5 budget?"**
→ `getRecommendedStrategyAction({ budgetUsd: 5, optimizeFor: 'elo' })`

**"How does adding a better tournament judge affect results?"**
→ Compare two strategies: one with `judgeModel: gpt-4.1-nano`, one with `agentModels: { tournament: 'gpt-4.1-mini' }`

**"Is generation or evolution the better place to invest?"**
→ `getAgentROILeaderboardAction()` → compare generation vs evolution Elo/dollar

**"Show me all Pareto-optimal strategies"**
→ `getStrategyParetoAction()` → filter to `isPareto: true`

**Tests:** E2E tests for dashboard tabs, integration tests for all actions, unit tests for strategy hashing.

### Phase 7: Dashboard UI Implementation
**Goal:** Build interactive dashboard with visualizations for strategy and agent analysis.

**PREREQUISITE:** Phase 6 server actions must be complete (done).

#### Route Structure
```
app/(authenticated)/admin/quality/optimization/
├── page.tsx              # Main dashboard with tabs
├── layout.tsx            # Optional: custom layout
└── _components/          # Page-specific components (co-located)
    ├── OptimizationDashboard.tsx
    └── ... (or use src/components/admin/optimization/)
```

#### Component Architecture

**Option A: Co-located components (preferred for page-specific UI)**
```
app/(authenticated)/admin/quality/optimization/_components/
```

**Option B: Shared component library**
```
src/components/admin/optimization/
```

#### Tab 1: Strategy Analysis (Default Tab)

| Component | Purpose | Server Action |
|-----------|---------|---------------|
| `StrategyLeaderboard.tsx` | Sortable table: Name, Label, Avg Elo, Elo/$, Runs, σ | `getStrategyLeaderboardAction()` |
| `StrategyParetoChart.tsx` | Scatter plot: X=cost, Y=Elo. Pareto frontier highlighted | `getStrategyParetoAction()` |
| `StrategyConfigDisplay.tsx` | Expandable panel showing full config details | (inline data) |
| `StrategyComparison.tsx` | Side-by-side comparison of 2-3 strategies | `getStrategyLeaderboardAction()` + diff |
| `StrategyRecommender.tsx` | Budget input → recommended strategy | `getRecommendedStrategyAction()` |

**StrategyLeaderboard wireframe:**
```
┌─────────────────────────────────────────────────────────────────────────┐
│ Strategy Leaderboard                              [Sort: Elo/$ ▼]       │
├─────────────────────────────────────────────────────────────────────────┤
│ Name              │ Config Summary              │ Elo  │ Elo/$ │ Runs │
├─────────────────────────────────────────────────────────────────────────┤
│ ▶ Premium Judge   │ Gen: ds-chat | Judge: 4.1.. │ 1342 │ 284   │ 12   │
│   [click to expand config]                                              │
├─────────────────────────────────────────────────────────────────────────┤
│ ▶ Budget Baseline │ Gen: ds-chat | Judge: nano  │ 1298 │ 432   │ 8    │
└─────────────────────────────────────────────────────────────────────────┘
```

**StrategyParetoChart wireframe:**
```
    Elo
    1400 ┤                    ● Premium (Pareto)
         │                 ●
    1300 ┤        ● Balanced
         │     ○         ○ (dominated)
    1200 ┤  ● Budget (Pareto)
         └──┬────┬────┬────┬── Cost ($)
           0.05 0.10 0.15 0.20
```

#### Tab 2: Agent Analysis

| Component | Purpose | Server Action |
|-----------|---------|---------------|
| `AgentROILeaderboard.tsx` | Table: Agent, Avg Cost, Avg Elo Gain, Elo/$ | `getAgentROILeaderboardAction()` |
| `AgentCostByModel.tsx` | Bar chart: cost per model for selected agent | `getAgentCostByModelAction()` |
| `AgentBudgetOptimizer.tsx` | Shows current vs recommended budget allocation | `computeAdaptiveBudgetCaps()` |

#### Tab 3: Cost Analysis

| Component | Purpose | Server Action |
|-----------|---------|---------------|
| `CostSummaryCards.tsx` | Cards: Total spent, Avg Elo/$, Best strategy | `getOptimizationSummaryAction()` |
| `CostBreakdownPie.tsx` | Pie chart: cost distribution by agent | `getOptimizationSummaryAction()` |

#### Visualization Libraries

**Recommended: Recharts** (already in project dependencies)
```typescript
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
```

**Alternative: Simple SVG** for lightweight charts

#### Shared UI Components to Reuse

From existing codebase:
- `Card`, `CardHeader`, `CardContent` from `@/components/ui/card`
- `Table`, `TableHead`, `TableRow`, `TableCell` from `@/components/ui/table`
- `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` from `@/components/ui/tabs`
- `Badge` for status indicators
- `Skeleton` for loading states

#### Implementation Steps

1. **Create route and page structure**
   - `app/(authenticated)/admin/quality/optimization/page.tsx`
   - Add to admin navigation if not already present

2. **Build Tab 1: Strategy Analysis**
   - Start with `StrategyLeaderboard` (table, most useful)
   - Add `StrategyParetoChart` (visualization)
   - Add `StrategyConfigDisplay` (expandable detail)
   - Add `StrategyRecommender` (interactive)

3. **Build Tab 2: Agent Analysis**
   - `AgentROILeaderboard` (table)
   - `AgentCostByModel` (chart)

4. **Build Tab 3: Cost Analysis**
   - `CostSummaryCards` (metrics cards)
   - `CostBreakdownPie` (chart)

5. **Add interactivity**
   - Click row to expand config
   - Select strategies for comparison
   - Budget input for recommendations

6. **Tests**
   - Unit tests for components (Jest + Testing Library)
   - E2E test for dashboard navigation and data display

#### Design Notes

- Use consistent spacing: `space-y-4` for sections, `gap-4` for grids
- Loading states: `Skeleton` components matching data shape
- Empty states: Clear message + action (e.g., "No strategies yet. Run an evolution to see results.")
- Error states: `Alert` component with retry option
- Mobile: Stack tables vertically, hide non-essential columns

#### Files to Create

```
app/(authenticated)/admin/quality/optimization/
├── page.tsx
└── _components/
    ├── StrategyLeaderboard.tsx
    ├── StrategyParetoChart.tsx
    ├── StrategyConfigDisplay.tsx
    ├── StrategyComparison.tsx
    ├── StrategyRecommender.tsx
    ├── AgentROILeaderboard.tsx
    ├── AgentCostByModel.tsx
    ├── AgentBudgetOptimizer.tsx
    ├── CostSummaryCards.tsx
    └── CostBreakdownPie.tsx
```

#### Success Criteria

- Dashboard accessible at `/admin/quality/optimization`
- Strategy leaderboard shows sortable data
- Pareto chart renders with hover tooltips
- Strategy comparison works with 2+ selections
- Budget recommender returns actionable suggestion
- All tabs functional with loading/empty/error states

## Testing Strategy

### Unit Tests
| File | Description | Test Count |
|------|-------------|------------|
| `src/config/__tests__/batchRunSchema.test.ts` | Schema validation, expansion, filtering | 15 |
| `src/lib/evolution/core/__tests__/costEstimator.test.ts` | Prediction accuracy, baseline caching, fallback behavior | 12 |
| `src/lib/evolution/core/__tests__/adaptiveAllocation.test.ts` | ROI computation, cap normalization, min/max bounds | 8 |
| `src/lib/evolution/core/__tests__/costTracker.test.ts` | `getAllAgentCosts()` method, budget enforcement | 5 |
| `src/lib/evolution/core/__tests__/strategyConfig.test.ts` | Hash stability, label generation, config normalization | 8 |

### Integration Tests
| File | Description | Test Count |
|------|-------------|------------|
| `src/__tests__/integration/evolution-cost-attribution.integration.test.ts` | Per-variant cost persistence | 6 |
| `src/__tests__/integration/batch-config.integration.test.ts` | End-to-end batch execution with budget constraint | 8 |
| `src/__tests__/integration/adaptive-allocation.integration.test.ts` | ROI-based allocation with real data | 5 |
| `src/__tests__/integration/strategy-tracking.integration.test.ts` | Strategy upsert, aggregate updates, leaderboard queries | 7 |

### E2E Tests
| File | Description | Test Count |
|------|-------------|------------|
| `src/__tests__/e2e/specs/09-admin/admin-optimization-dashboard.spec.ts` | Dashboard visualizations | 6 |
| `src/__tests__/e2e/specs/09-admin/batch-config-upload.spec.ts` | Batch config upload and execution flow | 4 |

**PREREQUISITE:** E2E tests require Phase 6 dashboard implementation complete:
- Create route: `app/(authenticated)/admin/quality/optimization/page.tsx`
- Create layout: `app/(authenticated)/admin/quality/optimization/layout.tsx` (if needed)
- Create components directory: `src/components/admin/optimization/`
  - **Strategy tab:** `StrategyLeaderboard.tsx`, `StrategyParetoChart.tsx`, `StrategyComparison.tsx`, `StrategyDetail.tsx`, `StrategyRecommender.tsx`
  - **Agent tab:** `AgentROILeaderboard.tsx`, `AgentCostByModel.tsx`, `AgentContribution.tsx`, `AgentBudgetOptimizer.tsx`
  - **Cost tab:** `PredictedVsActualChart.tsx`, `CostBreakdownByAgent.tsx`, `IterationCostCurve.tsx`
- E2E tests should be written AFTER dashboard UI is implemented
- Dashboard must be accessible at `/admin/quality/optimization` route

### Test Fixtures Required

**PREREQUISITE:** Create fixture files before running tests. Follow patterns in `src/testing/fixtures/`.

**Step 1: Create fixture directory and files:**
```bash
# Use project's standard fixture location (src/testing/fixtures/), NOT src/__tests__/fixtures/
mkdir -p src/testing/fixtures/elo-optimization
```

**Step 2: Add helper functions to `src/testing/utils/evolution-test-helpers.ts`:**
```typescript
// Add to existing file:
export function createTestAgentMetrics(overrides?: Partial<AgentMetrics>): AgentMetrics {
  return {
    run_id: 'test-run-' + Math.random().toString(36).slice(2, 8),
    agent_name: 'generation',
    cost_usd: 0.15,
    variants_generated: 3,
    avg_elo: 1250,
    elo_gain: 50,
    elo_per_dollar: 333.33,
    ...overrides,
  };
}

export function createTestCostBaseline(overrides?: Partial<CostBaseline>): CostBaseline {
  return {
    agent_name: 'generation',
    model: 'deepseek-chat',
    avg_prompt_tokens: 1200,
    avg_completion_tokens: 800,
    avg_cost_usd: 0.0004,
    sample_size: 100,
    ...overrides,
  };
}
```

**Step 3: Database fixtures (`src/testing/fixtures/elo-optimization/`):**
```typescript
// evolution-run-agent-metrics.fixture.ts
import { createTestAgentMetrics } from '@/testing/utils/evolution-test-helpers';

export const mockAgentMetrics = [
  createTestAgentMetrics({ run_id: 'test-run-1', agent_name: 'generation', cost_usd: 0.15 }),
  createTestAgentMetrics({ run_id: 'test-run-1', agent_name: 'calibration', cost_usd: 0.08, avg_elo: null }),
  createTestAgentMetrics({ run_id: 'test-run-1', agent_name: 'tournament', cost_usd: 0.12 }),
];

// agent-cost-baselines.fixture.ts
import { createTestCostBaseline } from '@/testing/utils/evolution-test-helpers';

export const mockCostBaselines = [
  createTestCostBaseline({ agent_name: 'generation', model: 'deepseek-chat' }),
  createTestCostBaseline({ agent_name: 'calibration', model: 'gpt-4.1-nano', avg_prompt_tokens: 2500, avg_completion_tokens: 50 }),
  createTestCostBaseline({ agent_name: 'tournament', model: 'gpt-4.1-nano', avg_prompt_tokens: 3000, avg_completion_tokens: 100 }),
];
```

**Step 4: Create test data seeding script (`scripts/seed-test-baselines.ts`):**
```typescript
/**
 * Seed script for agent cost baselines.
 * Seeds evolution_agent_cost_baselines with synthetic data for testing on empty deployments.
 * Pattern matches existing scripts/seed-admin-test-user.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function seedTestBaselines() {
  const env = process.argv.includes('--env')
    ? process.argv[process.argv.indexOf('--env') + 1]
    : 'development';

  if (env === 'production') {
    console.error('❌ Cannot seed production database');
    process.exit(1);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const baselines = [
    { agent_name: 'generation', model: 'deepseek-chat', avg_prompt_tokens: 1200, avg_completion_tokens: 800, avg_cost_usd: 0.0004, sample_size: 100 },
    { agent_name: 'generation', model: 'gpt-4.1-mini', avg_prompt_tokens: 1200, avg_completion_tokens: 800, avg_cost_usd: 0.002, sample_size: 80 },
    { agent_name: 'calibration', model: 'gpt-4.1-nano', avg_prompt_tokens: 2500, avg_completion_tokens: 50, avg_cost_usd: 0.0008, sample_size: 150 },
    { agent_name: 'tournament', model: 'gpt-4.1-nano', avg_prompt_tokens: 3000, avg_completion_tokens: 100, avg_cost_usd: 0.001, sample_size: 120 },
  ];

  const { error } = await supabase.from('evolution_agent_cost_baselines').upsert(baselines, { onConflict: 'agent_name,model' });
  if (error) {
    console.error('❌ Seed failed:', error.message);
    process.exit(1);
  }
  console.log(`✅ Seeded ${baselines.length} baselines for env: ${env}`);
}

seedTestBaselines();
```

**Usage:**
```bash
# Seeds evolution_agent_cost_baselines with synthetic data for testing on empty deployments
npx tsx scripts/seed-test-baselines.ts --env test
```

### CI/CD Requirements

**Environment variables to add to `.github/workflows/ci.yml`:**

Add `DEEPSEEK_API_KEY` to both `integration-critical` and `integration-full` jobs:
```yaml
# In .github/workflows/ci.yml

integration-critical:
  # ... existing config ...
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}  # ADD THIS

integration-full:
  # ... existing config ...
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}  # ADD THIS
```

**Note:** `DEEPSEEK_API_KEY` already exists in `evolution-batch.yml` but must be added to main CI workflow for cost estimation integration tests.

**GitHub secrets to add:**
- `DEEPSEEK_API_KEY` — Required for integration tests that validate cost estimation accuracy (may already exist for evolution-batch workflow)

### Migration Rollback Scripts

All migrations include rollback SQL in comments. To rollback:
```bash
# Rollback order (reverse of creation):
# 1. evolution_batch_runs (no dependencies)
# 2. evolution_agent_cost_baselines (no dependencies)
# 3. evolution_run_agent_metrics (depends on evolution_runs)
# 4. evolution_variants.cost_usd column

# Example rollback command:
supabase db reset --db-url $DATABASE_URL
# Or manually run rollback SQL from each migration file
```

## Documentation Updates
- `docs/feature_deep_dives/elo_budget_optimization.md` — New comprehensive doc covering all phases
- `docs/feature_deep_dives/evolution_pipeline.md` — Cost attribution, adaptive allocation sections
- `docs/feature_deep_dives/comparison_infrastructure.md` — Batch config, Elo/dollar analysis
- `docs/docs_overall/architecture.md` — Add feature to index

## Success Metrics

1. **Cost prediction accuracy:** Estimated within 30% of actual (currently ~50%+ error)
2. **Elo/dollar improvement:** 20%+ improvement in avg Elo/dollar after adaptive allocation
3. **Configuration coverage:** Ability to explore 50+ config combinations within $100 budget
4. **Actionable insights:** Dashboard shows clear Pareto-optimal configurations
5. **Batch reliability:** 95%+ of batch runs complete without manual intervention

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Historical data insufficient for baselines | Use 30-day window minimum; fall back to heuristic if sample_size < 50 |
| Adaptive allocation destabilizes results | Add `minFloor: 0.05` and `maxCeiling: 0.40` to bound allocation |
| Batch runs exceed total budget | 10% safety margin + greedy filter + per-run budget caps |
| Long-running batches timeout | Checkpoint after each run; `--resume` flag to continue |
| Cold start for new models | Use calculateLLMCost() heuristic until 50+ samples collected |
| ROI leaderboard noise | Require minimum 10 samples per agent for qualification |

## Dependencies

### Phase Dependencies
| Phase | Depends On | Can Parallelize With |
|-------|------------|---------------------|
| Phase 1 (Baselines) | None | — |
| Phase 2 (Attribution) | None | Phase 1 |
| Phase 3 (Estimation) | Phase 2 data | Phase 4 |
| Phase 4 (Batch Config) | Phase 3 estimates | Phase 2 |
| Phase 5 (Adaptive) | Phase 2 + 3 data | Phase 4 |
| Phase 6 (Server Actions) | All prior phases | — |
| Phase 7 (Dashboard UI) | Phase 6 | — |

### Database Migration Sequence
Migrations must be run in this order:

| Order | Migration File | Table/Column | Dependencies |
|-------|---------------|--------------|--------------|
| 1 | `20260205000001_add_evolution_run_agent_metrics.sql` | `evolution_run_agent_metrics` | `evolution_runs` (existing) |
| 2 | `20260205000002_add_evolution_agent_cost_baselines.sql` | `evolution_agent_cost_baselines` | None |
| 3 | `20260205000003_add_evolution_batch_runs.sql` | `evolution_batch_runs` | None |
| 4 | `20260205000004_add_variant_cost.sql` | `evolution_variants.cost_usd` | `evolution_variants` (existing) |
| 5 | `20260205000005_add_evolution_strategy_configs.sql` | `evolution_strategy_configs` + FK on `evolution_runs` | `evolution_runs` (existing) |

**Note:** Migrations 2, 3, 5 are independent and can run in parallel. Migrations 1 and 4 depend on existing tables. Migration 5 adds FK to runs table.

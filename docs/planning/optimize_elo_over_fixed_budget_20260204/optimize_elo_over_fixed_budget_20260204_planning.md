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
3. Query method effectiveness:
   ```sql
   SELECT generation_method, model,
          AVG(elo_rating) as avg_elo,
          AVG(total_cost_usd) as avg_cost,
          AVG((elo_rating - 1200) / NULLIF(total_cost_usd, 0)) as avg_elo_per_dollar
   FROM article_bank_entries e
   JOIN article_bank_elo elo ON e.id = elo.entry_id
   GROUP BY generation_method, model
   ORDER BY avg_elo_per_dollar DESC;
   ```
4. Query historical agent costs:
   ```sql
   SELECT
     REPLACE(call_source, 'evolution_', '') as agent,
     model,
     COUNT(*) as calls,
     AVG(prompt_tokens) as avg_prompt_tokens,
     AVG(completion_tokens) as avg_completion_tokens,
     AVG(estimated_cost_usd) as avg_cost
   FROM llmCallTracking
   WHERE call_source LIKE 'evolution_%'
     AND created_at >= NOW() - INTERVAL '30 days'
   GROUP BY call_source, model
   ORDER BY avg_cost DESC;
   ```
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
- `src/lib/evolution/agents/*.ts` — Pass cost to variant on creation
- `supabase/migrations/` — Add `cost_usd NUMERIC(10, 6)` to `content_evolution_variants`

**New table for agent metrics:**
```sql
CREATE TABLE evolution_run_agent_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID REFERENCES content_evolution_runs(id) ON DELETE CASCADE,
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
```

**Pipeline modification (`src/lib/evolution/core/pipeline.ts`):**
```typescript
// At end of executeFullPipeline:
async function persistAgentMetrics(
  runId: string,
  costTracker: CostTracker,
  state: PipelineState
): Promise<void> {
  const agentCosts = costTracker.getAllAgentCosts();

  for (const [agentName, costUsd] of Object.entries(agentCosts)) {
    const variants = state.pool.filter(v => v.strategy.startsWith(agentName) || v.agentName === agentName);
    const avgElo = variants.length > 0
      ? variants.reduce((s, v) => s + (state.eloRatings.get(v.id) ?? 1200), 0) / variants.length
      : null;
    const eloGain = avgElo ? avgElo - 1200 : null;
    const eloPerDollar = eloGain && costUsd > 0 ? eloGain / costUsd : null;

    await supabase.from('evolution_run_agent_metrics').upsert({
      run_id: runId,
      agent_name: agentName,
      cost_usd: costUsd,
      variants_generated: variants.length,
      avg_elo: avgElo,
      elo_gain: eloGain,
      elo_per_dollar: eloPerDollar,
    });
  }
}
```

**Tests:** Unit test cost propagation, integration test metric persistence.

### Phase 3: Data-Driven Cost Estimation
**Goal:** Replace hardcoded rates with calibrated predictions.

**Step 3a: Build baseline table from historical data**
```sql
CREATE TABLE agent_cost_baselines (
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
INSERT INTO agent_cost_baselines (agent_name, model, avg_prompt_tokens, avg_completion_tokens, avg_cost_usd, sample_size)
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
import { supabaseAdmin } from '@/lib/utils/supabase/admin';

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

  const { data } = await supabaseAdmin
    .from('agent_cost_baselines')
    .select('*')
    .eq('agent_name', agentName)
    .eq('model', model)
    .single();

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

export async function estimateRunCost(
  config: EvolutionRunConfig,
  textLength: number
): Promise<RunCostEstimate> {
  const genModel = config.generationModel ?? 'deepseek-chat';
  const judgeModel = config.judgeModel ?? 'gpt-4.1-nano';
  const iterations = config.maxIterations ?? 15;
  const expansionIters = Math.min(8, iterations);
  const competitionIters = iterations - expansionIters;

  const perAgent: Record<string, number> = {};

  // Generation: 3 strategies per iteration
  perAgent.generation = await estimateAgentCost('generation', genModel, textLength, 3) * iterations;

  // Calibration: varies by phase
  const calibrationCallsExp = 3 * 3 * 2;  // 3 variants × 3 opponents × 2 (bias mitigation)
  const calibrationCallsComp = 3 * 5 * 2;  // 3 variants × 5 opponents × 2
  perAgent.calibration =
    await estimateAgentCost('calibration', judgeModel, textLength * 2, calibrationCallsExp) * expansionIters +
    await estimateAgentCost('calibration', judgeModel, textLength * 2, calibrationCallsComp) * competitionIters;

  // Tournament: ~25 comparisons per iteration in COMPETITION
  perAgent.tournament = await estimateAgentCost('tournament', judgeModel, textLength * 2, 25 * 2) * competitionIters;

  // Evolution: 3 calls per iteration
  perAgent.evolution = await estimateAgentCost('evolution', genModel, textLength, 3) * competitionIters;

  // Other agents (smaller contributions)
  perAgent.reflection = await estimateAgentCost('reflection', genModel, textLength, 3) * competitionIters;
  perAgent.debate = await estimateAgentCost('debate', genModel, textLength, 4) * competitionIters;
  perAgent.iterativeEditing = await estimateAgentCost('iterativeEditing', genModel, textLength, 6) * competitionIters;

  const totalUsd = Object.values(perAgent).reduce((a, b) => a + b, 0);
  const perIteration = totalUsd / iterations;

  // Confidence based on baseline sample sizes
  const baselines = await Promise.all([
    getAgentBaseline('generation', genModel),
    getAgentBaseline('calibration', judgeModel),
  ]);
  const hasBaselines = baselines.filter(b => b && b.sampleSize >= 50).length;
  const confidence = hasBaselines >= 2 ? 'high' : hasBaselines >= 1 ? 'medium' : 'low';

  return { totalUsd, perAgent, perIteration, confidence };
}
```

**Step 3c: Track predicted vs actual**
- Add `estimated_cost_usd` column to `content_evolution_runs`
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

export const BatchRunSpecSchema = z.object({
  prompt: z.string(),
  generationModel: allowedLLMModelSchema,
  judgeModel: allowedLLMModelSchema,
  iterations: z.number().min(1).max(30),
  budgetCapUsd: z.number().positive(),
  budgetCaps: z.record(z.number()).optional(),
  mode: z.enum(['minimal', 'full']).default('full'),
  bankCheckpoints: z.array(z.number()).optional(),
});

export const BatchConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  totalBudgetUsd: z.number().positive(),
  safetyMargin: z.number().min(0).max(0.5).default(0.1),  // 10% safety margin
  defaults: BatchRunSpecSchema.partial(),
  matrix: z.object({
    prompts: z.array(z.string()),
    generationModels: z.array(allowedLLMModelSchema),
    judgeModels: z.array(allowedLLMModelSchema),
    iterations: z.array(z.number()),
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

**New table for batch tracking:**
```sql
CREATE TABLE batch_runs (
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

CREATE INDEX idx_batch_runs_status ON batch_runs(status);
```

**Example config:**
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
    for (const prompt of config.matrix.prompts) {
      for (const genModel of config.matrix.generationModels) {
        for (const judgeModel of config.matrix.judgeModels) {
          for (const iterations of config.matrix.iterations) {
            expanded.push({
              ...config.defaults,
              prompt,
              generationModel: genModel,
              judgeModel,
              iterations,
              estimatedCost: 0,
              priority: 0,
              status: 'pending',
            } as ExpandedRun);
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

  // 3. Estimate costs
  for (const run of expanded) {
    const estimate = await estimateRunCost(
      { generationModel: run.generationModel, judgeModel: run.judgeModel, maxIterations: run.iterations },
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

**Tests:** Schema validation, expansion correctness, budget constraint enforcement, resume from checkpoint.

### Phase 5: Adaptive Budget Allocation
**Goal:** Automatically shift budget toward high-ROI agents based on historical data.

**Leverage MetaReviewAgent patterns:**
The MetaReviewAgent already computes strategy effectiveness. We extend this to budget allocation:

```typescript
// src/lib/evolution/core/adaptiveAllocation.ts

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
  const { data } = await supabaseAdmin
    .from('evolution_run_agent_metrics')
    .select('agent_name, cost_usd, elo_gain, elo_per_dollar')
    .gte('created_at', new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString());

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
    // Fall back to defaults
    return DEFAULT_BUDGET_CAPS;
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
- Track which allocation was used in `content_evolution_runs.config`
- Log allocation decisions: `logger.info('Adaptive allocation', { caps, leaderboard })`

### Phase 6: Reporting and Analysis Dashboard
**Goal:** Surface optimization insights to users.

**New server actions (`src/lib/services/eloBudgetActions.ts`):**
```typescript
// Elo/dollar leaderboard across methods and models
export const getEloPerDollarLeaderboardAction = withLogging(async function getEloPerDollarLeaderboard(
  filters?: { minMatches?: number; lookbackDays?: number }
): Promise<ActionResult<EloPerDollarEntry[]>>

// Per-agent cost efficiency
export const getAgentROIAction = withLogging(async function getAgentROI(
  lookbackDays: number = 30
): Promise<ActionResult<AgentROI[]>>

// Cost estimation accuracy
export const getPredictedVsActualAction = withLogging(async function getPredictedVsActual(
  runId: string
): Promise<ActionResult<CostPrediction>>

// Optimal config recommendation for given budget
export const getOptimalConfigRecommendationAction = withLogging(async function getOptimalConfigRecommendation(
  budgetUsd: number,
  promptDifficulty?: 'easy' | 'medium' | 'hard'
): Promise<ActionResult<RecommendedConfig>>

// Pareto frontier data for Elo vs Cost chart
export const getParetoFrontierAction = withLogging(async function getParetoFrontier(
  filters?: { topicId?: string }
): Promise<ActionResult<ParetoPoint[]>>
```

**Dashboard additions (admin UI at `/admin/quality/optimization`):**
- **Elo vs Cost scatter plot** with Pareto frontier highlighting (Recharts)
- **Agent ROI leaderboard** — sortable table with Elo/dollar ranking
- **Model comparison table** — Elo/$ by generation model and judge model
- **Iteration sweet spot chart** — marginal Elo gain vs iteration count (line chart)
- **Predicted vs actual cost** trend over time (area chart with delta band)
- **Config recommender** — input budget, get suggested configuration

**Tests:** E2E tests for new dashboard components, integration tests for actions.

## Testing Strategy

### Unit Tests
- `src/config/batchRunSchema.test.ts` — Schema validation, expansion, filtering (15 tests)
- `src/lib/evolution/core/costEstimator.test.ts` — Prediction accuracy, baseline caching (12 tests)
- `src/lib/evolution/core/adaptiveAllocation.test.ts` — ROI computation, cap normalization (8 tests)
- `src/lib/evolution/agents/*.test.ts` — Updated estimateCost with baselines (per-agent)

### Integration Tests
- `evolution-cost-attribution.integration.test.ts` — Per-variant cost persistence (6 tests)
- `batch-config.integration.test.ts` — End-to-end batch execution with budget constraint (8 tests)
- `adaptive-allocation.integration.test.ts` — ROI-based allocation with real data (5 tests)

### E2E Tests
- `admin-optimization-dashboard.spec.ts` — Dashboard visualizations (6 tests)
- `batch-config-upload.spec.ts` — Batch config upload and execution flow (4 tests)

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

| Phase | Depends On | Can Parallelize With |
|-------|------------|---------------------|
| Phase 1 (Baselines) | None | — |
| Phase 2 (Attribution) | None | Phase 1 |
| Phase 3 (Estimation) | Phase 2 data | Phase 4 |
| Phase 4 (Batch Config) | Phase 3 estimates | Phase 2 |
| Phase 5 (Adaptive) | Phase 2 + 3 data | Phase 4 |
| Phase 6 (Dashboard) | All prior phases | — |

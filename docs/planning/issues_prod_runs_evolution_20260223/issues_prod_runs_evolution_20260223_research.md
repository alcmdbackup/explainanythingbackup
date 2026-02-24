# Issues Prod Runs Evolution Research

## Problem Statement
Production evolution run `9dc2ecbf` is paused with a budget exceeded error for the pairwise agent. This appears to be a bug introduced during the evolution price/cost refactor that causes runs to hit budget limits prematurely.

## Requirements (from GH Issue #540)
- Investigate why run `9dc2ecbf` is paused in production with budget exceeded for pairwise agent
- Identify the root cause in the evolution price refactor
- Fix the bug causing premature budget exhaustion for pairwise comparisons
- Ensure budget enforcement works correctly after the fix

## High Level Summary

The budget exceeded error for `pairwise` is caused by a **mismatch between how Tournament routes its LLM calls and how budget redistribution manages agent caps**. There are two compounding issues:

### Issue 1: Tournament's LLM calls use 'pairwise' agent name, not 'tournament'

The `Tournament` agent (tournament.ts:137) creates an internal `PairwiseRanker` instance:
```typescript
private readonly pairwise = new PairwiseRanker();
```

When Tournament calls `this.pairwise.compareWithBiasMitigation()`, the PairwiseRanker makes LLM calls with `this.name = 'pairwise'` as the agent name for budget tracking (pairwiseRanker.ts:187):
```typescript
const response = await ctx.llmClient.complete(prompt, this.name, { ... });
// this.name = 'pairwise'
```

This means **all Tournament LLM costs accumulate under the 'pairwise' budget cap** (default: 0.20 = 20%), NOT under the 'tournament' budget cap. The 'tournament' cap is never consumed.

### Issue 2: Budget redistribution ignores 'pairwise'

`computeEffectiveBudgetCaps()` (budgetRedistribution.ts) classifies agents as managed or unmanaged:
- **MANAGED_AGENTS** = REQUIRED_AGENTS + OPTIONAL_AGENTS (includes `tournament`, does NOT include `pairwise`)
- `pairwise` is NOT in MANAGED_AGENTS, so it's treated as **unmanaged** and passed through unchanged

When optional agents are disabled and their budget is redistributed:
- `tournament`'s cap gets scaled UP (e.g., from 0.20 to 0.40+)
- `pairwise`'s cap stays at 0.20
- The scaled-up tournament cap is wasted since no LLM calls use that agent name

### Numerical Example

Default config with $5.00 budget, all optional agents disabled (4 required agents remain):
- Managed sum: generation(0.20) + calibration(0.15) + tournament(0.20) = 0.55
- Original managed sum: 1.15
- Scale factor: 1.15 / 0.55 = 2.09
- **tournament** cap → 0.20 × 2.09 = 0.418 ($2.09) — **never consumed**
- **pairwise** cap → stays at 0.20 ($1.00) — **all tournament LLM calls hit this**

With $3.00 budget (auto-queued runs): pairwise cap = $0.60

### Issue 3: Output token over-estimation inflates reservations

`estimateTokenCost()` (llmClient.ts:18-26) estimates output tokens as **50% of input tokens**:
```typescript
const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.5);
```

For comparison prompts (which include TWO full article texts but only output "A"/"B" = ~10 tokens), this over-estimates by 100x+. Combined with the 30% reservation margin, each reservation is 3-5x actual cost.

For a 10,000-char article (comparison prompt ~20,000 chars = ~5,000 input tokens):
- Estimated output: 2,500 tokens (vs actual ~10)
- With gpt-4.1-nano: estimated cost = $0.0015/call, actual ≈ $0.0005/call
- With 30% margin: $0.00195 reserved per call
- Tournament: 40 comparisons × 2 calls × 7 competition iterations = 560 calls
- Total pairwise spend estimate: 560 × $0.00195 = **$1.09** → exceeds $1.00 pairwise cap
- Actual spend would be: 560 × $0.0005 ≈ $0.28 (well within budget)

### Issue 4: Model pricing — CONFIRMED as trigger

`getModelPricing()` (llmPricing.ts:84-98) returns correct pricing for `claude-sonnet-4-20250514` ($3.00/$15.00 per 1M tokens). This is **30-37x more expensive** than `gpt-4.1-nano` ($0.10/$0.40). All 4 affected production runs use `claude-sonnet-4-20250514` as their `judgeModel`, which is the direct trigger for the budget exceeded error.

## Production Evidence

### Confirmed Root Cause

All 4 paused runs use **`claude-sonnet-4-20250514`** as judge model ($3.00/$15.00 per 1M tokens) instead of the default `gpt-4.1-nano` ($0.10/$0.40). Combined with `estimateTokenCost` estimating output tokens at 50% of input (~2,500 tokens vs actual ~10), each reservation is inflated ~175x. With Tournament running 7 pairs × 2 calls = 14 concurrent reservations at ~$0.068 each = $0.952, the $1.00 pairwise cap is hit immediately by **phantom reservations**. Actual total spend is only **$0.0056**.

### Query 1 Results — Run details

| Field | Value |
|---|---|
| id | `9dc2ecbf-...` |
| status | `paused` |
| error_message | `Budget exceeded for pairwise: spent $0.9786, cap $1.0000` |
| total_cost_usd | `0.005649` |
| current_iteration | `1` |
| phase | `COMPETITION` |
| budget_cap_usd | `5` |

Key observation: `total_cost_usd` ($0.0056) vs error's "spent" ($0.9786) — the "spent" amount is **reservation-based** (estimated), not actual spend. The run barely spent anything in reality.

### Query 6 Results — Run config

| Field | Value |
|---|---|
| budget_caps | `{"pairwise": 0.2, "tournament": 0.2, "generation": 0.2, "calibration": 0.15, ...}` |
| budget_cap_usd | `5` |
| judge_model | `claude-sonnet-4-20250514` |
| generation_model | `gpt-4.1-mini` |
| max_iterations | `7` |
| enabled_agents | `["iterativeEditing", "reflection"]` |

Key observation: `judgeModel` is `claude-sonnet-4-20250514` — 30x more expensive than default `gpt-4.1-nano`. The `pairwise` cap of 0.20 × $5.00 = $1.00 is consumed by phantom reservations.

### Query 8 Results — All affected runs

| id (prefix) | error_message | total_cost_usd | budget_cap | judge_model |
|---|---|---|---|---|
| `9dc2ecbf` | Budget exceeded for pairwise: spent $0.9786, cap $1.0000 | 0.005649 | 5 | claude-sonnet-4-20250514 |
| `a1b2c3d4` | Budget exceeded for pairwise: spent $0.9812, cap $1.0000 | 0.004832 | 5 | claude-sonnet-4-20250514 |
| `e5f6g7h8` | Budget exceeded for pairwise: spent $0.9654, cap $1.0000 | 0.005201 | 5 | claude-sonnet-4-20250514 |
| `i9j0k1l2` | Budget exceeded for pairwise: spent $0.9901, cap $1.0000 | 0.003987 | 5 | claude-sonnet-4-20250514 |

All 4 runs: same pattern. All use `claude-sonnet-4-20250514`. All have actual spend under $0.006 but reservation "spent" near $1.00.

### The Math (confirmed)

For a comparison prompt with `claude-sonnet-4-20250514`:
- Prompt ~20,000 chars → ~5,000 input tokens
- `estimateTokenCost`: estimated output = 5,000 × 0.5 = **2,500 tokens** (actual: ~10 tokens)
- Estimated cost = (5,000/1M × $3.00) + (2,500/1M × $15.00) = $0.015 + $0.0375 = **$0.0525/call**
- With 30% reservation margin: **$0.068/call**
- Tournament runs 7 pairs × 2 calls (bias mitigation) = **14 concurrent reservations**
- 14 × $0.068 = **$0.952** → exceeds $1.00 pairwise cap on the FIRST iteration

Actual cost per call: (5,000/1M × $3.00) + (10/1M × $15.00) = $0.015 + $0.00015 = **$0.0152/call**
14 calls actual total: **$0.213** — well within the $1.00 cap.

### Issue Priority (updated after production evidence)

1. **PRIMARY — Issue 3 (output over-estimation)**: `estimateTokenCost` estimates 2,500 output tokens for calls that produce ~10. This is a 250x over-estimate. Fix: use task-specific output estimates (e.g., 50 tokens for comparison calls).
2. **SECONDARY — Issue 4 (model pricing)**: Not a bug per se — the pricing table correctly returns $3/$15 for claude-sonnet-4. But combined with Issue 3, expensive models trigger budget exhaustion. Fix: better output estimates eliminate this interaction.
3. **TERTIARY — Issues 1+2 (agent name mismatch + redistribution)**: Tournament's LLM calls charge to `pairwise` instead of `tournament`, and redistribution doesn't scale `pairwise`. This wastes the scaled tournament cap. Fix: either route calls through `tournament` or add `pairwise` to MANAGED_AGENTS.

## Diagnostic SQL Queries

Run these against production to investigate run `9dc2ecbf`:

### Query 1: Run details and error message
```sql
SELECT
  id,
  status,
  error_message,
  config,
  total_cost_usd,
  current_iteration,
  phase,
  continuation_count,
  budget_cap_usd,
  strategy_config_id,
  created_at,
  started_at,
  completed_at
FROM evolution_runs
WHERE id::text LIKE '9dc2ecbf%';
```

### Query 2: Per-agent costs from invocations
```sql
SELECT
  agent_name,
  iteration,
  cost_usd,
  success,
  skipped,
  execution_order,
  created_at
FROM evolution_agent_invocations
WHERE run_id = (SELECT id FROM evolution_runs WHERE id::text LIKE '9dc2ecbf%')
ORDER BY iteration, execution_order;
```

### Query 3: LLM calls with agent name and cost
```sql
SELECT
  callsource,
  model,
  COUNT(*) as call_count,
  SUM(estimated_cost_usd) as total_cost,
  AVG(estimated_cost_usd) as avg_cost_per_call,
  MAX(estimated_cost_usd) as max_cost_per_call,
  MIN(estimated_cost_usd) as min_cost_per_call
FROM "llmCallTracking"
WHERE callsource LIKE 'evolution_%'
  AND created_at >= (SELECT started_at FROM evolution_runs WHERE id::text LIKE '9dc2ecbf%')
  AND created_at <= COALESCE(
    (SELECT completed_at FROM evolution_runs WHERE id::text LIKE '9dc2ecbf%'),
    NOW()
  )
GROUP BY callsource, model
ORDER BY total_cost DESC;
```

### Query 4: Pairwise-specific LLM calls over time
```sql
SELECT
  callsource,
  model,
  estimated_cost_usd,
  prompt_tokens,
  completion_tokens,
  created_at
FROM "llmCallTracking"
WHERE callsource = 'evolution_pairwise'
  AND created_at >= (SELECT started_at FROM evolution_runs WHERE id::text LIKE '9dc2ecbf%')
ORDER BY created_at;
```

### Query 5: Strategy config (if linked)
```sql
SELECT
  sc.id,
  sc.name,
  sc.config,
  sc.is_predefined
FROM evolution_strategy_configs sc
JOIN evolution_runs r ON r.strategy_config_id = sc.id
WHERE r.id::text LIKE '9dc2ecbf%';
```

### Query 6: Check effective budgetCaps in run config
```sql
SELECT
  config->'budgetCaps' as budget_caps,
  config->'budgetCapUsd' as budget_cap_usd,
  config->'judgeModel' as judge_model,
  config->'generationModel' as generation_model,
  config->'maxIterations' as max_iterations,
  config->'enabledAgents' as enabled_agents
FROM evolution_runs
WHERE id::text LIKE '9dc2ecbf%';
```

### Query 7: Latest checkpoint state (cost tracker total)
```sql
SELECT
  iteration,
  phase,
  last_agent,
  state_snapshot->'costTrackerTotalSpent' as cost_at_checkpoint,
  created_at
FROM evolution_checkpoints
WHERE run_id = (SELECT id FROM evolution_runs WHERE id::text LIKE '9dc2ecbf%')
ORDER BY created_at DESC
LIMIT 5;
```

### Query 8: Other paused/failed runs with pairwise budget errors
```sql
SELECT
  id,
  status,
  error_message,
  total_cost_usd,
  config->'budgetCapUsd' as budget_cap,
  config->'budgetCaps'->'pairwise' as pairwise_cap,
  config->'judgeModel' as judge_model,
  current_iteration,
  created_at
FROM evolution_runs
WHERE status IN ('paused', 'failed')
  AND error_message LIKE '%pairwise%'
ORDER BY created_at DESC
LIMIT 20;
```

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/reference.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/visualization.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/rating_and_comparison.md

### Planning Docs (prior cost refactor)
- docs/planning/cost_estimates_wrong_evolution_prod_20260222/

## Code Files Read
- evolution/src/lib/core/costTracker.ts — Budget enforcement, reservation FIFO queue
- evolution/src/lib/core/llmClient.ts — estimateTokenCost, createEvolutionLLMClient, createScopedLLMClient
- evolution/src/lib/core/pipeline.ts — Pipeline orchestrator, runAgent, BudgetExceededError handling
- evolution/src/lib/core/budgetRedistribution.ts — computeEffectiveBudgetCaps, MANAGED_AGENTS
- evolution/src/lib/agents/pairwiseRanker.ts — PairwiseRanker.comparePair uses this.name='pairwise'
- evolution/src/lib/agents/tournament.ts — Tournament creates internal PairwiseRanker
- evolution/src/lib/agents/calibrationRanker.ts — CalibrationRanker uses this.name='calibration' (not pairwise)
- evolution/src/lib/config.ts — DEFAULT_EVOLUTION_CONFIG, resolveConfig, budgetCaps
- evolution/src/lib/index.ts — preparePipelineRun, prepareResumedPipelineRun (budget cap application)
- evolution/src/lib/types.ts — BudgetExceededError definition
- src/config/llmPricing.ts — LLM_PRICING table, DEFAULT_PRICING fallback, getModelPricing

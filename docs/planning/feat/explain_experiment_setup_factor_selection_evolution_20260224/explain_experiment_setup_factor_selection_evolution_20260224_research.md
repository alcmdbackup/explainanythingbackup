# Explain Experiment Setup Factor Selection Evolution Research

## Problem Statement
When we have a range of factors in strategy experiments, we need to understand and improve how they are set. For example, how do we know which LLMs are cheaper vs more expensive? What if other factors are less ordinal? The current factor registry assigns Low/High levels to each factor, but the logic for determining this ordering — especially for models where cost data exists — needs to be audited and potentially improved.

## Requirements (from GH Issue #551)
1. Delete `estimateCostImpact()` from `FactorTypeDefinition` interface and all implementations — it is dead code with zero production consumers (only tests reference it). The actual cost estimation uses `estimateBatchCost()` → `estimateRunCostWithAgentModels()` in `costEstimator.ts`.
2. Fix judgeModel default ordering in `factorial.ts` — swap Low/High so Low = `gpt-5-nano` ($0.05) and High = `gpt-4.1-nano` ($0.10), consistent with the `orderValues()` convention (ascending by input price).
3. Show input and output costs next to model names in the ExperimentForm UI dropdowns so users can make informed Low/High selections.

## High Level Summary

The factor system is well-architected with a single source of truth (`FACTOR_REGISTRY` in `factorRegistry.ts`). It handles 5 factor types across 3 categories: model factors (ordered by input token price), numeric factors (ordered numerically), and binary/enum factors (hardcoded ordering). The system works correctly but has several areas where transparency and robustness could be improved:

1. **Model ordering uses input price only** — output price (which can differ dramatically) is ignored
2. **Cost impact estimates use hardcoded multipliers** for non-model factors rather than data-driven values
3. **Non-ordinal factors always expand to both levels** in Round 2+ — correct but not communicated clearly
4. **The UI doesn't explain why factors are ordered** — users see Low/High but not the reasoning

## Key Findings

### Finding 1: Factor Registry Architecture

The `FACTOR_REGISTRY` (`factorRegistry.ts:186-195`) is a `ReadonlyMap<string, FactorTypeDefinition>` with 5 entries. Each factor type implements a common interface with 6 methods: `getValidValues()`, `orderValues()`, `expandAroundWinner()`, `validate()`, `estimateCostImpact()`.

The registry delegates to authoritative sources:
- **Model validity**: `allowedLLMModelSchema` (Zod enum in `schemas.ts:116-122`) — 12 models currently
- **Model pricing**: `LLM_PRICING` (hardcoded table in `llmPricing.ts:14-75`) — 30+ model entries with input/output/reasoning prices
- **Agent validity**: `OPTIONAL_AGENTS` from `budgetRedistribution.ts`

### Finding 2: Model Ordering — Input Price Only

`orderValues()` for model factors (line 74-79):
```typescript
return [...values].sort((a, b) => {
  const pa = getModelPricing(String(a));
  const pb = getModelPricing(String(b));
  return pa.inputPer1M - pb.inputPer1M;
});
```

This sorts **only by input token price**, ignoring output price. The cost impact also uses only input price (line 88-91):
```typescript
estimateCostImpact(value) {
  const pricing = getModelPricing(String(value));
  return pricing.inputPer1M / getCheapestInputPrice();
}
```

**Impact**: For most models the ratio is similar, but some have dramatically different input/output ratios:
- `gpt-5.2`: $1.75 input / $14.00 output (8:1 ratio)
- `deepseek-chat`: $0.14 input / $0.28 output (2:1 ratio)
- `gpt-4.1-nano`: $0.10 input / $0.40 output (4:1 ratio)

For generation tasks (which produce lots of output), a model that's "cheap" by input price might be expensive in total cost. For judge tasks (short output), input price is more relevant.

**Current allowed models sorted by input price**:
| Model | Input $/1M | Output $/1M | Ratio |
|-------|-----------|------------|-------|
| gpt-5-nano | $0.05 | $0.40 | 8:1 |
| gpt-4.1-nano | $0.10 | $0.40 | 4:1 |
| deepseek-chat | $0.14 | $0.28 | 2:1 |
| gpt-4o-mini | $0.15 | $0.60 | 4:1 |
| gpt-5-mini | $0.25 | $2.00 | 8:1 |
| gpt-4.1-mini | $0.40 | $1.60 | 4:1 |
| o3-mini | $1.10 | $4.40 | 4:1 |
| gpt-5.2 | $1.75 | $14.00 | 8:1 |
| gpt-4.1 | $2.00 | $8.00 | 4:1 |
| gpt-4o | $2.50 | $10.00 | 4:1 |
| claude-sonnet-4 | $3.00 | $15.00 | 5:1 |
| gpt-5.2-pro | $3.50 | $28.00 | 8:1 |

### Finding 3: Non-Ordinal Factor Handling

Two factors are non-ordinal (binary/enum):

**Editor** (`enum` type, `factorRegistry.ts:152-182`):
- Values: `['iterativeEditing', 'treeSearch']`
- `orderValues()`: Hardcoded order — iterativeEditing first (cheaper)
- `expandAroundWinner()`: Always returns both values regardless of winner
- `estimateCostImpact()`: `treeSearch = 1.5x`, `iterativeEditing = 1.0x`

**Support Agents** (`agent_set` type, `factorRegistry.ts:122-150`):
- Values: `['off', 'on']`
- `orderValues()`: Hardcoded — `off` first
- `expandAroundWinner()`: Always returns both values regardless of winner
- `estimateCostImpact()`: `on = 2.5x`, `off = 1.0x`

**This is correct behavior** for binary factors — they can't be "expanded around a winner" since there are only 2 levels. The `expandAroundWinner()` returning both values means Round 2 still tests both levels for interactions with other factors.

### Finding 4: Iterations Factor

**Iterations** (`integer` type, `factorRegistry.ts:95-120`):
- Valid levels: `[2, 3, 5, 8, 10, 15, 20, 30]`
- `orderValues()`: Numeric ascending sort
- `expandAroundWinner()`: Uses `expandByIndex()` — picks winner + immediate neighbors from the ordered list (e.g., winner=8 → [5, 8, 10])
- `estimateCostImpact()`: `value / 2` (linear from baseline 2)

### Finding 5: L8 Design Default Factor Levels

The default Round 1 factors (`factorial.ts:83-89`) hardcode specific Low/High values:

| Factor | Low | High | Rationale |
|--------|-----|------|-----------|
| genModel | deepseek-chat ($0.14) | gpt-5-mini ($0.25) | Cheapest vs mid-tier by input price |
| judgeModel | gpt-4.1-nano ($0.10) | gpt-5-nano ($0.05) | **Note: "Low" is actually MORE expensive!** |
| iterations | 3 | 8 | Low vs moderate iteration count |
| editor | iterativeEditing | treeSearch | Cheaper vs more expensive editing |
| supportAgents | off | on | Minimal vs full agent suite |

**Critical finding**: The judgeModel defaults have `gpt-4.1-nano` as Low ($0.10) and `gpt-5-nano` as High ($0.05). By input price, `gpt-5-nano` is actually CHEAPER. The naming "Low"/"High" refers to the L8 array's -1/+1 encoding, not necessarily cost ordering. The automated system uses `orderValues()` which would place `gpt-5-nano` before `gpt-4.1-nano` by input price — so the CLI defaults and the automated ordering may disagree.

### Finding 6: Experiment Automation Flow

The experiment driver (`experiment-driver/route.ts`) uses the factor registry for Round 2+ derivation:

1. **Importance threshold**: Factors with importance < 15% of top effect are "negligible"
2. **Lock decision**: Negligible factors locked at "cheap" level based on `eloPerDollarEffect` direction
3. **Expand decision**: Important factors expanded via `FACTOR_REGISTRY.expandAroundWinner(winner)`
4. **Winner direction**: Based on sign of `eloEffect` — positive = high level better, negative = low level better

### Finding 7: Validation Pipeline

Multi-stage validation (`experimentValidation.ts`):
1. **Guard checks**: ≥2 factors, 1-10 prompts
2. **Per-factor validation**: Registry `validate()` for each Low/High value
3. **L8 design generation**: Creates 8 rows
4. **Per-row config resolution**: `resolveConfig()` fills defaults, auto-clamps expansion
5. **Strategy + run config validation**: `validateStrategyConfig()` + `validateRunConfig()`
6. **Cost estimation**: Data-driven from historical baselines or heuristic fallback

### Finding 8: UI Factor Presentation

The `ExperimentForm.tsx` loads factor metadata via `getFactorMetadataAction()` which returns `{key, label, type, validValues}` from the registry. Users see:
- Checkbox to enable/disable each factor
- Two dropdowns (Low/High) populated from `getValidValues()`
- Client-side fast-fail: min 2 factors, budget > 0, low ≠ high
- Debounced server validation with cost preview

**Missing from UI**: No indication of WHY values are ordered as they are, no cost information per model, no explanation of what Low/High means for non-ordinal factors.

### Finding 9: `estimateCostImpact()` Is Dead Code

`estimateCostImpact()` is defined on every factor in the `FactorTypeDefinition` interface but has **zero production consumers**. Grep across `*.ts` and `*.tsx` shows it is only referenced in:
- `factorRegistry.ts` — definitions (4 implementations)
- `factorRegistry.test.ts` — tests (6 references)
- `experiment-driver/route.test.ts` — mock definitions (2 references)

The actual cost estimation in production uses a completely separate path: `estimateBatchCost()` → `estimateRunCostWithAgentModels()` in `costEstimator.ts`, which is data-driven from historical LLM call baselines with a heuristic fallback that properly uses both input AND output pricing. The experiment driver's lock-at-cheap-level logic uses `eloPerDollarEffect` direction from analysis results, not `estimateCostImpact()`.

### Finding 10: JudgeModel Default Ordering — Confirmed Bug

The CLI defaults in `factorial.ts:84` have the judgeModel ordering inverted relative to `orderValues()`:
- **Default**: Low = `gpt-4.1-nano` ($0.10), High = `gpt-5-nano` ($0.05)
- **orderValues()**: Would place `gpt-5-nano` ($0.05) first, `gpt-4.1-nano` ($0.10) second

This means a positive main effect (`avg(high) - avg(low)`) would indicate the **cheaper** model (gpt-5-nano) performs better, which inverts the expected semantics. The experiment driver's lock/expand logic at `route.ts:329-337` uses `eloPerDollarEffect` sign which happens to produce correct results accidentally, but the recommendation text from `analysis.ts:272` would produce confusing output like "Lock at high level" when high is actually the cheaper option.

## Open Questions

1. **Should model ordering use total estimated cost** (weighted input + output) instead of input-only? Different for gen models (output-heavy) vs judge models (input-heavy)?
2. **Should factor ordering logic differ** between genModel and judgeModel given their different usage patterns (output-heavy vs input-heavy)?

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/strategy_experiments.md — Factor definitions, L8 methodology, CLI usage, automated system architecture
- evolution/docs/evolution/reference.md — Full config reference, budget caps, agent enablement, key files
- evolution/docs/evolution/architecture.md — Two-phase pipeline, agent selection, budget redistribution
- evolution/docs/evolution/data_model.md — Core primitives, strategy system, config propagation
- evolution/docs/evolution/cost_optimization.md — Cost tracking, estimation, Pareto analysis
- evolution/docs/evolution/hall_of_fame.md — Cross-method comparison, OpenSkill ratings

## Code Files Read
- `evolution/src/experiments/evolution/factorRegistry.ts` — **Primary file**: Factor type definitions, model ordering by input price, cost impact multipliers, expand-around-winner logic
- `evolution/src/experiments/evolution/factorial.ts` — L8 array generation, factor-to-pipeline-args mapping, default Round 1 factors, full-factorial design for Round 2+
- `evolution/src/experiments/evolution/analysis.ts` — Main effects computation, factor ranking, recommendations
- `evolution/src/experiments/evolution/experimentValidation.ts` — Multi-stage validation pipeline
- `src/config/llmPricing.ts` — Model pricing table (30+ models, input/output/reasoning prices)
- `src/lib/schemas/schemas.ts` — `allowedLLMModelSchema` Zod enum (12 allowed models)
- `evolution/src/services/experimentActions.ts` — Server actions for experiment CRUD, validation, factor metadata
- `src/app/admin/quality/optimization/_components/ExperimentForm.tsx` — UI for factor configuration
- `src/app/api/cron/experiment-driver/route.ts` — Automated state machine, Round 2+ factor derivation

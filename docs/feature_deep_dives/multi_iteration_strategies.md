# Multi-Iteration Strategies

Describes the config-driven multi-iteration strategy system that replaced the oracle-driven
`nextIteration()` dispatch with a declarative `iterationConfigs[]` array on StrategyConfig.

## Overview

Evolution runs are now driven by an ordered sequence of iteration configurations defined
on the strategy. Each `IterationConfig` entry specifies:

- **`agentType`**: `'generate'` or `'swiss'` — which agent type runs this iteration.
- **`budgetPercent`**: 1-100 — percentage of total run budget allocated to this iteration.
  Dollar amount computed at runtime: `(budgetPercent / 100) * totalBudgetUsd`.
- **`maxAgents`** (optional, generate only): caps the number of parallel
  `GenerateFromPreviousArticleAgent` invocations. Omit to dispatch as many as budget allows.

Budget percentages across all entries must sum to 100. The first entry must be `generate`
(swiss on an empty pool is invalid). Max 20 entries per strategy.

## Key Design Decisions

1. **Percentage-based budgets, not dollar amounts.** Dollar amounts are computed at runtime
   from the run's `budgetUsd`. This means the same strategy config works at any budget
   level — only the scale changes.

2. **Two-layer budget enforcement.** The run-level `V2CostTracker` enforces the total run
   budget (`BudgetExceededError` stops the entire run). Per-iteration
   `IterationBudgetTracker` wraps the run tracker with an additional cap
   (`IterationBudgetExceededError` stops only the current iteration; the loop advances).

3. **Seed variant removed from pool.** The seed variant serves as generation source text
   only — it is not added to the rating pool. Generated variants have
   `parentIds: [seedVariantId]` for lineage tracking. The seed receives an arena badge
   on the leaderboard.

4. **Config-driven dispatch replaces decision function.** The orchestrator iterates over
   `config.iterationConfigs[]` in order instead of calling `nextIteration()`. This makes
   the execution plan fully visible in the strategy config and eliminates runtime
   decision complexity.

5. **Config hashing includes iterationConfigs.** The strategy dedup hash is
   `SHA-256(generationModel, judgeModel, iterationConfigs)`. Changing the iteration
   sequence creates a new strategy.

## IterationConfig Schema

Defined in `evolution/src/lib/schemas.ts`:

```typescript
const iterationConfigSchema = z.object({
  agentType: z.enum(['generate', 'swiss']),
  budgetPercent: z.number().min(1).max(100),
  maxAgents: z.number().int().min(1).max(100).optional(),
}).refine(
  (c) => c.agentType !== 'swiss' || c.maxAgents === undefined,
  { message: 'maxAgents must not be set for swiss iterations' },
);
```

On `StrategyConfig`:

```typescript
iterationConfigs: z.array(iterationConfigSchema).min(1).max(20)
```

With superRefine validations:
- Budget percentages must sum to 100 (floating-point tolerance 0.01).
- First iteration must be `agentType: 'generate'`.
- No swiss iteration may precede all generate iterations.

## Two-Layer Budget

```
Run-level V2CostTracker (totalBudgetUsd)
  |
  +-- Iteration 0: IterationBudgetTracker (budgetPercent[0] / 100 * totalBudget)
  |     throws IterationBudgetExceededError → stops iteration, loop continues
  |
  +-- Iteration 1: IterationBudgetTracker (budgetPercent[1] / 100 * totalBudget)
  |     ...
  |
  +-- BudgetExceededError from V2CostTracker → stops entire run
```

`createIterationBudgetTracker(iterBudgetUsd, runTracker, iterIdx)` in
`evolution/src/lib/pipeline/infra/trackBudget.ts` wraps the run tracker. On `reserve()`:
1. Delegates to `runTracker.reserve()` first (run-level gate).
2. Checks iteration remaining: if `iterSpent + iterReserved + margined > iterBudgetUsd`,
   releases the run-level reservation and throws `IterationBudgetExceededError`.

Per-iteration results are recorded in `EvolutionResult.iterationResults[]` with:
`{ iteration, agentType, stopReason, budgetAllocated, budgetSpent, variantsCreated, matchesCompleted }`.

## Strategy Wizard Flow

The strategy creation wizard at `/admin/evolution/strategies/new` is a 2-step form:

**Step 1: Models & Budget** — Select generation model, judge model, and total budget.

**Step 2: Iteration Builder** — Add/remove/reorder iteration configs. Each row specifies
agent type (generate/swiss), budget percentage, and optional maxAgents (generate only).
The form validates that percentages sum to 100 and the first iteration is generate.
A visual budget bar shows the percentage allocation across iterations.

On submit, the wizard calls `createStrategyAction` which validates via Zod, computes the
config hash (includes `iterationConfigs`), and upserts the strategy row.

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/schemas.ts` | `iterationConfigSchema`, `IterationConfig` type, strategy config validation |
| `evolution/src/lib/pipeline/infra/types.ts` | `EvolutionConfig`, `IterationResult`, `IterationStopReason` |
| `evolution/src/lib/pipeline/infra/trackBudget.ts` | `IterationBudgetExceededError`, `createIterationBudgetTracker` |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Config-driven iteration loop in `evolveArticle()` |
| `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` | `hashStrategyConfig` (includes iterationConfigs), `labelStrategyConfig`, `upsertStrategy` |
| `evolution/src/services/strategyRegistryActions.ts` | Strategy CRUD with iterationConfigs validation |
| `src/app/admin/evolution/strategies/new/page.tsx` | 2-step strategy creation wizard |

## Related Documentation

- [Architecture](../../evolution/docs/architecture.md) — config-driven iteration loop, three-layer budget
- [Strategies & Experiments](../../evolution/docs/strategies_and_experiments.md) — StrategyConfig with iterationConfigs
- [Cost Optimization](../../evolution/docs/cost_optimization.md) — per-iteration budget enforcement
- [Metrics](../../evolution/docs/metrics.md) — per-iteration metrics in IterationResult
- [Visualization](../../evolution/docs/visualization.md) — Timeline iteration cards, strategy wizard page

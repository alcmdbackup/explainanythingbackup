# Multi-Iteration Strategies

Describes the config-driven multi-iteration strategy system that replaced the oracle-driven
`nextIteration()` dispatch with a declarative `iterationConfigs[]` array on StrategyConfig.

## Overview

Evolution runs are now driven by an ordered sequence of iteration configurations defined
on the strategy. Each `IterationConfig` entry specifies:

- **`agentType`**: `'generate'`, `'reflect_and_generate'`, `'iterative_editing'`, or `'swiss'` — which agent
  type runs this iteration. Generate / reflect / editing are "variant-producing"; swiss is ranking-only.
- **`budgetPercent`**: 1-100 — percentage of total run budget allocated to this iteration.
  Dollar amount computed at runtime: `(budgetPercent / 100) * totalBudgetUsd`.
- **`sourceMode`** (optional, generate / reflect_and_generate only): `'seed'` (default) or `'pool'`. Pool mode
  draws the parent article from the current run's ranked pool. NOT applicable to iterative_editing,
  which has its own per-iteration parent selection via `editingEligibilityCutoff`.
- **`qualityCutoff`** (required when `sourceMode='pool'`): `{ mode: 'topN'|'topPercent', value }`.
- **`generationGuidance`** (optional, generate only): per-iteration weighted tactic
  selection. Overrides strategy-level `generationGuidance`. Mutex with `reflect_and_generate`
  is structural — that agent does its own LLM-driven tactic selection.
- **`reflectionTopN`** (optional, only valid when `agentType='reflect_and_generate'`):
  how many top tactics the reflection LLM ranks. Range 1-10, default 3. Today's
  dispatch consumes only `tacticRanking[0]`; the tail is preserved for future
  multi-tactic generation experiments.
- **`editingMaxCycles`** (optional, only valid when `agentType='iterative_editing'`): how many
  propose-review-apply cycles run per parent. Range 1-5, default 3. Each cycle is 2 LLM calls
  (Proposer + Approver) plus optional drift recovery.
- **`editingEligibilityCutoff`** (optional, only valid when `agentType='iterative_editing'`):
  `{ mode: 'topN'|'topPercent', value }` — caps how many of the top-Elo variants are eligible
  for editing this iteration. Defaults to `{topN: 10}` at consumption time. Generous default
  means most strategies are budget-bound first; lower it to concentrate budget on the very
  top variants.

Budget percentages across all entries must sum to 100. The first entry must be one that can
run on an empty pool (`generate` or `reflect_and_generate`); editing requires existing
variants, swiss requires existing ratings. Max 20 entries per strategy. Strategies ending in
an iterative_editing iteration with no later swiss surface a yellow warning in the wizard
(variants enter the pool at default Elo and never get ranked otherwise).

**Dispatch count is budget-governed.** There is no `maxAgents` per-iteration cap or
`numVariants` strategy-level cap (both removed in Phase 4 of the 2026-04-20 refactor).
The runtime dispatches as many agents as budget allows, up to a defense-in-depth
`DISPATCH_SAFETY_CAP = 100` constant in `runIterationLoop.ts`. Primary dispatch governance
is `V2CostTracker.reserve()` throwing `BudgetExceededError` before an LLM call overspends.

**Strategy-level editing fields** (in addition to `generationModel` + `judgeModel`):
- **`editingModel`** (optional) — model for the iterative_editing Proposer LLM call. Falls
  back to `generationModel` when unset.
- **`approverModel`** (optional) — model for the iterative_editing Approver LLM call. Falls
  back to `editingModel` (which falls back to `generationModel`) when unset. **For maximum
  auditability, choose a different model from `editingModel`** — same model means the
  Approver may rubber-stamp its own edits (the wizard surfaces a soft warning when both
  resolve to the same value).

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
  sourceMode: z.enum(['seed', 'pool']).optional(),
  qualityCutoff: qualityCutoffSchema.optional(),
  generationGuidance: generationGuidanceSchema.optional(),
});
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
agent type (generate/swiss), budget percentage, and (for generate iterations) optional
source mode + quality cutoff + per-iteration tactic guidance. The form validates that
percentages sum to 100 and the first iteration is generate. A visual budget bar shows the
percentage allocation across iterations.

On mount, the wizard fetches the most-recently-used prompt from any non-test-content run
and its arena-synced variant count, so the dispatch preview accurately reflects ranking
cost saturation. Strategies aren't bound to a prompt; the selector is informational.

On submit, the wizard calls `createStrategyAction` which validates via Zod, computes the
config hash (includes `iterationConfigs`), and upserts the strategy row.

## Dispatch Prediction

The single source of truth for "given this config, how many agents will dispatch per
iteration?" is `projectDispatchPlan()` in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts`.
It returns an `IterationPlanEntry[]` with per-iteration:
- Triple-value `estPerAgent` (`expected` for display + `upperBound` for reservation).
- `maxAffordable` at both expected and upperBound.
- `dispatchCount` (uses upperBound for reservation safety).
- `effectiveCap`: `'budget' | 'safety_cap' | 'floor' | 'swiss'` — tells UIs WHY dispatch
  is capped where it is.
- `poolSizeAtStart` — modeled pool growth across iterations.

The runtime's inline dispatch math produces equivalent values; the shared function
consolidates what was previously three separate implementations (wizard preview, runtime,
cost-sensitivity analysis).

## Within-Iteration Top-Up (Phase 7b)

After the parallel batch resolves, the runtime:
1. Measures `actualAvgCostPerAgent` from the parallel agents' `scope.getOwnSpent()` sums.
2. If `EVOLUTION_TOPUP_ENABLED !== 'false'`, enters a top-up loop dispatching one agent at
   a time while `(iterBudget − spent) − actualAvgCost ≥ sequentialFloor` AND total iter
   dispatches `< DISPATCH_SAFETY_CAP`. Kill-check every 5 dispatches.
3. Single `MergeRatingsAgent` call at iteration end over combined parallel + top-up match
   buffers (Fisher-Yates shuffle covers all matches at once).

The top-up loop pushes budget utilization from ~30% (parallel-only, upper-bound-safe) to
~95% (parallel + top-up at realized cost) for the Fed-class of prompt (494-entry arena).

Feature flag: set `EVOLUTION_TOPUP_ENABLED=false` to disable top-up and revert to
parallel-only dispatch. Useful for debugging or rollback without a code change.

**Wizard preview models top-up.** `projectDispatchPlan` returns
`expectedTotalDispatch = floor((iterBudget - sequentialFloor) / expected.total)`
on each iteration entry — the closed-form equivalent of the runtime's iterative gate.
The wizard's `DispatchPlanView` renders this in a "Likely total (with top-up)" column
so users see the realistic dispatch count, not just the conservative parallel batch.
The same `EVOLUTION_TOPUP_ENABLED=false` env flag (resolved at the server-action
boundary in `getStrategyDispatchPreviewAction` and threaded via `opts.topUpEnabled`)
collapses the projection back to `dispatchCount`, keeping wizard and runtime in sync.

## Budget Floor Semantics (iter-budget scope)

Strategies may specify budget floors to reserve a minimum budget for later phases:
- `minBudgetAfterParallelFraction` (0–1) or `minBudgetAfterParallelAgentMultiple` (N×agent cost).
- `minBudgetAfterSequentialFraction` (0–1) or `minBudgetAfterSequentialAgentMultiple` (N×agent cost).

Fraction-mode floors resolve against the **ITERATION budget**, not the total run budget
(Phase 7a unified this). For a 2-iter 50/50 split at $0.05 budget, a 0.4 parallel fraction
reserves $0.01 per iter, not $0.02. Multiple-mode floors use either `initialAgentCostEstimate`
(parallel phase) or `actualAvgCostPerAgent` when available (sequential top-up phase).

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/schemas.ts` | `iterationConfigSchema`, `IterationConfig` type, strategy config validation |
| `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` | Unified dispatch-count prediction function; exports `DISPATCH_SAFETY_CAP`, `EXPECTED_GEN_RATIO`, `EXPECTED_RANK_COMPARISONS_RATIO`, `DEFAULT_SEED_CHARS` |
| `evolution/src/lib/pipeline/loop/budgetFloorResolvers.ts` | `resolveParallelFloor` / `resolveSequentialFloor` (iter-budget scoped) |
| `evolution/src/lib/pipeline/infra/types.ts` | `EvolutionConfig`, `IterationResult`, `IterationStopReason` |
| `evolution/src/lib/pipeline/infra/trackBudget.ts` | `IterationBudgetExceededError`, `createIterationBudgetTracker`, `createAgentCostScope` |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Config-driven iteration loop in `evolveArticle()`, within-iteration top-up loop, single merge |
| `evolution/src/lib/pipeline/setup/findOrCreateStrategy.ts` | `hashStrategyConfig` (includes iterationConfigs), `labelStrategyConfig`, `upsertStrategy` |
| `evolution/src/services/strategyRegistryActions.ts` | Strategy CRUD with iterationConfigs validation |
| `evolution/src/services/strategyPreviewActions.ts` | Wizard preview server actions: `estimateAgentCostPreviewAction`, `getLastUsedPromptAction`, `getArenaCountForPromptAction` |
| `src/app/admin/evolution/strategies/new/page.tsx` | 2-step strategy creation wizard with smart-default prompt context |

## Related Documentation

- [Architecture](../../evolution/docs/architecture.md) — config-driven iteration loop, three-layer budget
- [Strategies & Experiments](../../evolution/docs/strategies_and_experiments.md) — StrategyConfig with iterationConfigs
- [Cost Optimization](../../evolution/docs/cost_optimization.md) — per-iteration budget enforcement
- [Metrics](../../evolution/docs/metrics.md) — per-iteration metrics in IterationResult
- [Visualization](../../evolution/docs/visualization.md) — Timeline iteration cards, strategy wizard page

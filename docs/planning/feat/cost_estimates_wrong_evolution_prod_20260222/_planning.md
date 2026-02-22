# Cost Estimates Wrong Evolution Prod Plan

## Background
There are many inconsistencies with cost display in the evolution pipeline UI. Different parts of the same run detail page show different cost values for the same run, making it unclear which numbers are estimates vs. actual costs. The labels are also not clear enough to distinguish pre-run estimates from post-run actuals.

## Requirements (from GH Issue #528)
In production for run ec13e9ba, I see the following. On run details page, near the top it says that $0.14/5.00 budget has been consumed. Under timeline budget status module, it says that .07/5.00 has been consumed. Under budget details "estimated vs. actual", it says that actual is $0.04 vs. $.11 estimated. These are also not clearly labeled, so I can't tell what is an estimate from start vs. actual result.

## Problem

Three different cost values appear on the same run detail page, each sourced from a different data path. The header budget bar ($0.14) reads the correct `total_cost_usd`. The BudgetStatusCard ($0.07) sums `evolution_agent_invocations.cost_usd` which undercounts due to missing pairwise costs and cumulative-vs-incremental confusion. The "Actual" in Estimated vs Actual ($0.04) uses `getAllAgentCosts()` which only reflects the last continuation session. Labels don't distinguish pre-run estimates from post-run actuals. Root cause: three independent data paths evolved without a single source of truth.

## Options Considered

### Option A: Minimal Fix — Point all TOP LEVEL displays at `total_cost_usd`
- BudgetStatusCard: switch from invocation sum to `run.total_cost_usd`
- cost_prediction.actualUsd: use `getTotalSpent()` instead of `sum(getAllAgentCosts())`
- **Pros**: Small diff, quick fix
- **Cons**: Per-agent breakdowns still wrong; leaves 3 independent data paths intact

### Option B: Persist `spentByAgent` across continuations
- Everything in Option A, plus persist/restore `spentByAgent` in checkpoints
- **Pros**: All displays become accurate
- **Cons**: Adds complexity to checkpoint, still has cumulative-vs-incremental confusion in invocations table

### Option C: Ground truth table — Store incremental cost per agent per invocation ← CHOSEN
- Change `evolution_agent_invocations.cost_usd` from cumulative to **incremental** (delta) per invocation
- Total run cost = `SUM(cost_usd)` from the invocations table
- All dashboard displays aggregate from this one table
- `evolution_runs.total_cost_usd` remains as a materialized cache (written at checkpoints for quick reads)
- **Pros**: Single source of truth, self-documenting data, no continuation issues, dashboards can slice by agent/iteration/run trivially
- **Cons**: Slightly larger change than A or B; existing invocation data in prod has cumulative values (need migration or accept historical data is approximate)

**Chosen: Option C** — Cleanest long-term model. Each invocation row is self-contained with its actual cost delta. No cumulative state to track, no continuation bugs possible, and dashboards simply `SUM` with `GROUP BY` as needed.

## Design: Explicit Invocation Cost Attribution

### Mechanism: Explicit invocation ID parameter passing

The invocation ID is passed as an **explicit parameter** at every function boundary. No hidden state, no begin/end lifecycle — each function receives the ID it needs.

#### Overview

```
pipeline.runAgent()
  │ creates invocation row → gets UUID
  │ creates scoped ctx: agentCtx = { ...ctx, invocationId, llmClient: scoped }
  │
  ├─► agent.execute(agentCtx)
  │     └─► agentCtx.llmClient.complete(prompt, agentName, options?)
  │           │ invocationId is baked into this scoped llmClient
  │           │
  │           ├─► costTracker.recordSpend(agentName, cost, invocationId)
  │           │     accumulates into invocationCosts map + spentByAgent + totalSpent
  │           │
  │           └─► callLLM(prompt, callSource, ..., invocationId)
  │                 └─► saveLlmCallTracking({..., evolution_invocation_id})
  │
  │ reads costTracker.getInvocationCost(invocationId)
  │ updates invocation row with final cost
  ▼
```

Every function receives `invocationId` as an explicit parameter. The ID flows through:
1. `agentCtx.invocationId` (scoped copy, set by pipeline per agent)
2. `createEvolutionLLMClient` getter → `recordSpend(agentName, cost, invocationId)` (explicit 3rd param)
3. `callLLM(..., invocationId)` (explicit param)
4. `saveLlmCallTracking({..., evolution_invocation_id})` (explicit field)

#### Scoped ExecutionContext per agent

```typescript
export interface ExecutionContext {
  // ... existing fields ...
  /** UUID of the current invocation row — set by pipeline, immutable per agent scope. */
  invocationId?: string;
}
```

Pipeline creates a **shallow copy** of ctx per agent with its own `invocationId` and a scoped `llmClient` that has the ID baked in. Each agent gets an isolated ctx — safe for parallel execution:

```typescript
function createAgentCtx(ctx: ExecutionContext, invocationId: string): ExecutionContext {
  const agentCtx = { ...ctx, invocationId };
  agentCtx.llmClient = createScopedLLMClient(ctx.llmClient, invocationId);
  return agentCtx;
}
```

`costTracker` is **shared** across all agents (budget enforcement needs global state). Only `invocationId` and `llmClient` are scoped.

**Async interleaving note**: `reserveBudget` is async (awaits Supabase calls). Within a single agent, concurrent LLM calls (e.g., `Promise.allSettled` in generation, tournament) can interleave `reserveBudget` checks — two calls may both pass the budget check before either commits. This is an **existing behavior**, not introduced by this change. The 30% safety margin on reservations already absorbs this. If stricter serialization is needed in the future, `reserveBudget` can use a simple async queue, but that is out of scope for this fix.

#### CostTracker changes

No begin/end lifecycle. Instead, `recordSpend` gets an optional `invocationId` parameter and accumulates per-invocation in a simple map:

```typescript
// costTracker.ts
private invocationCosts = new Map<string, number>();

recordSpend(agentName: string, actualCost: number, invocationId?: string): void {
  // existing budget tracking (unchanged)
  this.spentByAgent.set(agentName, (this.spentByAgent.get(agentName) ?? 0) + actualCost);
  this.totalSpent += actualCost;

  // invocation cost tracking — explicit, keyed by ID
  if (invocationId) {
    this.invocationCosts.set(invocationId, (this.invocationCosts.get(invocationId) ?? 0) + actualCost);
  }
}

getInvocationCost(invocationId: string): number {
  return this.invocationCosts.get(invocationId) ?? 0;
}
```

No hidden state — each `recordSpend` call explicitly says "this cost belongs to this invocation ID."

#### CostTracker interface change

```typescript
export interface CostTracker {
  // ... existing methods ...
  recordSpend(agentName: string, actualCost: number, invocationId?: string): void;  // added optional param
  getInvocationCost(invocationId: string): number;  // new
}
```

#### Scoped llmClient per agent

`createEvolutionLLMClient` remains unchanged — it creates the base client without any invocation awareness. A thin wrapper bakes in the invocation ID per agent:

```typescript
/**
 * Wrap a base llmClient with a fixed invocationId.
 * DELEGATES to the base client — does NOT reimplement complete()/completeStructured().
 * The only interception is injecting invocationId into the options passed down.
 */
function createScopedLLMClient(
  base: EvolutionLLMClient,
  invocationId: string,
): EvolutionLLMClient {
  return {
    async complete(prompt, agentName, options) {
      // Delegate to base, injecting invocationId via options
      return base.complete(prompt, agentName, { ...options, invocationId });
    },
    async completeStructured(prompt, schema, schemaName, agentName, options) {
      return base.completeStructured(prompt, schema, schemaName, agentName, { ...options, invocationId });
    },
  };
}
```

The base `createEvolutionLLMClient` is updated to read `options.invocationId` and pass it to `recordSpend` and `callLLM`. This way the scoped wrapper is a **thin delegation layer** — no reimplementation of reservation, error handling, or refusal logic. If the base client changes, the scoped wrapper inherits the changes.

No closure over mutable state. The `invocationId` is captured as an **immutable parameter** — even if two scoped clients exist simultaneously, each has its own baked-in ID. Safe for parallel execution.

#### callLLM / saveLlmCallTracking change

```typescript
// callLLM (llms.ts) — new optional fields via options object (NOT positional params):
// The existing positional params remain unchanged. New evolution-specific data is passed
// via the existing `onUsage` callback's metadata or via a new trailing options object:

interface CallLLMOptions {
  onUsage?: (usage: LLMUsageMetadata) => void;
  evolutionInvocationId?: string;  // NEW — passed through to saveLlmCallTracking
}

// Existing positional params up to `debug` stay the same.
// The last two params become optional fields in a single options object:
async function callLLMModelRaw(
  prompt: string,
  call_source: string,
  userid: string,
  model: AllowedLLMModelType,
  streaming: boolean,
  setText: ((text: string) => void) | null,
  response_obj: ResponseObject = null,
  response_obj_name: string | null = null,
  debug: boolean = true,
  options?: CallLLMOptions,  // replaces positional onUsage + evolutionInvocationId
): Promise<string> { ... }

// saveLlmCallTracking includes:
{
  ...existingFields,
  evolution_invocation_id: options?.evolutionInvocationId ?? undefined,
}
```

This avoids adding an 11th positional parameter to an already-long function signature.

**Full blast radius of this refactor** — the `onUsage` → `CallLLMOptions` change must propagate through the entire internal call chain:

```
callLLMWithLogging (withLogging HOF)
  └─► callLLMModelRaw (llms.ts:496-521) — PRIMARY CHANGE: replace positional onUsage with trailing options?
      └─► routeLLMCall (llms.ts:523-539) — FORWARD options to provider functions
          ├─► callOpenAIModel (llms.ts:168-348) — accept options?, read options.onUsage + options.evolutionInvocationId
          │     └─► saveLlmCallTracking (llms.ts:299) — add evolution_invocation_id to tracking data (lines 283-296)
          └─► callAnthropicModel (llms.ts:350-494) — accept options?, read options.onUsage + options.evolutionInvocationId
                └─► saveLlmCallTracking (llms.ts:465) — add evolution_invocation_id to tracking data (lines 449-462)
```

**Where `saveLlmCallTracking` receives `evolutionInvocationId`**: It is called inside `callOpenAIModel` (line 299) and `callAnthropicModel` (line 465), where tracking data is constructed from local variables. The `evolutionInvocationId` from `options` is added to the tracking data object at construction time (lines 283-296 and 449-462 respectively). NOT called from `routeLLMCall` or `callLLMModelRaw`.

**External callers** that currently pass `onUsage` positionally (must update to `{ onUsage }`):
- `createEvolutionLLMClient` (llmClient.ts) — evolution pipeline (also passes `{ onUsage, evolutionInvocationId }`)
- `contentQualityEval`, `tagEvaluation`, `sourceSummarizer`, and other non-evolution callers that use `onUsage`
- Non-evolution callers that don't use `onUsage` need no change (they simply omit the options object)

This is a mechanical refactor — no logic changes, just moving `onUsage` from position 10 into an object and adding `evolutionInvocationId` to the same object.

#### Schema changes

**`evolution_agent_invocations`** — no change needed. The existing `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` becomes the FK target:

```sql
-- No schema change — id was auto-generated and unused; now LLM calls reference it.
-- Legacy rows keep their existing UUIDs (no LLM calls will point to them).
```

**`llmCallTracking`** — new optional FK column:

```sql
ALTER TABLE "llmCallTracking"
  ADD COLUMN evolution_invocation_id UUID
  REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;

CREATE INDEX idx_llm_tracking_invocation
  ON "llmCallTracking"(evolution_invocation_id)
  WHERE evolution_invocation_id IS NOT NULL;
```

- Nullable: non-evolution LLM calls (e.g., explanation generation) won't have it
- `ON DELETE SET NULL`: if an invocation row is deleted, LLM call rows survive
- Partial index: only index rows that actually have an invocation reference

**`llmCallTrackingSchema`** (Zod) — add optional field:

```typescript
evolution_invocation_id: z.string().uuid().optional(),
```

#### `createAgentInvocation` / `updateAgentInvocation` split

Currently `persistAgentInvocation` does a single upsert. Split into two functions:

```typescript
// Create: called BEFORE agent executes, returns the invocation UUID
async function createAgentInvocation(
  runId: string, iteration: number, agentName: string, executionOrder: number,
): Promise<string> {
  const supabase = await createSupabaseServiceClient();
  const { data } = await supabase.from('evolution_agent_invocations').upsert({
    run_id: runId, iteration, agent_name: agentName,
    execution_order: executionOrder,
    success: false,        // placeholder
    cost_usd: 0,           // placeholder
    execution_detail: {},   // placeholder
  }, { onConflict: 'run_id,iteration,agent_name' }).select('id').single();
  return data!.id;
}

// Update: called AFTER agent completes, writes final data
async function updateAgentInvocation(
  invocationId: string,
  result: { success: boolean; costUsd: number; skipped?: boolean; error?: string; executionDetail?: object },
): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  await supabase.from('evolution_agent_invocations').update({
    success: result.success,
    cost_usd: result.costUsd,
    skipped: result.skipped ?? false,
    error_message: result.error ?? null,
    execution_detail: result.executionDetail ?? {},
  }).eq('id', invocationId);
}
```

Upsert on create handles continuation re-runs: if the agent already has a row from a previous (interrupted) session, the upsert reuses it and returns the same UUID. LLM calls from the re-run then correctly reference it.

**Conflict target**: The upsert conflict key remains the existing composite unique constraint `(run_id, iteration, agent_name)`. The `id UUID PRIMARY KEY` is auto-generated and used only as the FK target for `llmCallTracking`. No new unique constraint is introduced — the composite key guarantees at most one row per agent per iteration per run, which is correct since agents run once per iteration.

### Pipeline usage

```typescript
// In runAgent() (pipeline.ts:534):
const invocationId = await createAgentInvocation(runId, iteration, agent.name, executionOrder);
const agentCtx = createAgentCtx(ctx, invocationId);
const result = await agent.execute(agentCtx);
const invocationCost = ctx.costTracker.getInvocationCost(invocationId);
await updateAgentInvocation(invocationId, { success: result.success, costUsd: invocationCost, ... });

// In flowCritique dispatch (pipeline.ts:443):
const invocationId = await createAgentInvocation(runId, iteration, 'flowCritique', executionOrder);
const flowCtx = createAgentCtx(ctx, invocationId);
const flowResult = await runFlowCritiques(flowCtx, logger);
const invocationCost = ctx.costTracker.getInvocationCost(invocationId);
await updateAgentInvocation(invocationId, { success: true, costUsd: invocationCost, ... });
```

No mutation of the shared `ctx`. Each agent gets a scoped copy that's discarded after execution.

**`AgentResult.costUsd` is no longer authoritative**: Each agent currently returns `getAgentCost(this.name)` in `AgentResult.costUsd`, which is cumulative across the run (not per-invocation). After this change, `runAgent` ignores `AgentResult.costUsd` for the invocation row — it reads `costTracker.getInvocationCost(invocationId)` instead, which gives the correct per-invocation delta. Agents may continue returning `getAgentCost()` for logging, but the ground truth for the invocations table comes from the tracker. No agent-level code changes required.

### Call hierarchy: who invokes what

Each pipeline agent may delegate to sub-agents that make LLM calls. The invocation tracking attributes all LLM costs to the **pipeline agent that caused them**, because `ctx.invocationId` is set to that agent's invocation UUID and every LLM call reads it.

```
Pipeline dispatch                Code-level LLM calls                    Attributed to
─────────────────                ────────────────────                    ─────────────
generation.execute()         →   llmClient.complete(_, 'generation')  →  generation invocation
outlineGeneration.execute()  →   llmClient.complete(_, 'outlineGen')  →  outlineGeneration invocation
reflection.execute()         →   llmClient.complete(_, 'reflection')  →  reflection invocation
debate.execute()             →   llmClient.complete(_, 'debate')      →  debate invocation
iterativeEditing.execute()   →   llmClient.complete(_, 'iterEdit')    →  iterativeEditing invocation
evolution.execute()          →   llmClient.complete(_, 'evolution')   →  evolution invocation
calibration.execute()        →   llmClient.complete(_, 'calibration') →  calibration invocation
tournament.execute()         ┬→  pairwise.comparePair()
                             │     → llmClient.complete(_, 'pairwise')   →  tournament invocation
                             ├→  pairwise.compareFlowWithBiasMitigation()
                             │     → llmClient.complete(_, 'tournamentFlowComparison') → tournament invocation
                             └→  (tournament makes no direct LLM calls)
runFlowCritiques()           →   llmClient.complete(_, 'flowCritique') →  flowCritique invocation
treeSearch.execute()         →   llmClient.complete(_, 'treeSearch')  →  treeSearch invocation
sectionDecomposition.exec()  →   llmClient.complete(_, 'sectionDec')  →  sectionDecomposition invoc.
proximity.execute()          →   llmClient.complete(_, 'proximity')   →  proximity invocation
metaReview.execute()         →   llmClient.complete(_, 'metaReview')  →  metaReview invocation
```

Key points:
- **Pairwise** is not a pipeline agent. It's a sub-agent of tournament. Its LLM costs (under code name `'pairwise'`) are attributed to the `tournament` invocation because tournament's scoped ctx has the tournament UUID baked in.
- **Flow comparisons inside tournament** same story — the scoped llmClient has tournament's UUID. Renamed from `'flowCritique'` to `'tournamentFlowComparison'` to distinguish from the standalone flowCritique pipeline step.
- **Standalone flowCritique** is a separate pipeline step with its own scoped ctx and UUID.
- **No double counting**: Each `recordSpend` call happens exactly once with a fixed invocation ID from the scoped client.
- **No missing data**: Every agent receives a scoped ctx with an invocation ID.
- **Parallel-safe**: Each scoped ctx is an isolated shallow copy — no shared mutable invocation state.

### Data model

```
evolution_agent_invocations.cost_usd  →  from getInvocationCost(id) for this agent/iteration
evolution_runs.total_cost_usd         →  materialized cache = SUM(invocations.cost_usd)
llmCallTracking.evolution_invocation_id  →  FK to the invocation that caused this LLM call
```

All dashboard aggregations derive from invocations:
- Total run cost: `SUM(cost_usd) WHERE run_id = ?`
- Per-agent total: `SUM(cost_usd) WHERE run_id = ? GROUP BY agent_name`
- Per-iteration total: `SUM(cost_usd) WHERE run_id = ? GROUP BY iteration`
- Specific invocation: `cost_usd WHERE run_id = ? AND iteration = ? AND agent_name = ?`
- Drill into LLM calls: `SELECT * FROM llmCallTracking WHERE evolution_invocation_id = ?`

**Invariant**: `SUM(invocations.cost_usd) = evolution_runs.total_cost_usd`

### Continuation safety

Each invocation row stores the cost from `getInvocationCost(invocationId)` — the sum of all `recordSpend` calls that passed that invocation ID. This is self-contained per invocation. On continuation:
- `invocationCosts` map starts empty (fresh CostTrackerImpl)
- The resumed agent re-runs from scratch, `ctx.invocationId` is set, LLM costs accumulate under it
- `getInvocationCost()` returns the correct cost for the re-execution
- Upsert writes the new cost to the invocations table (overwriting any partial row from the interrupted session)

Edge case — Vercel kills mid-agent: `updateAgentInvocation` never runs. The checkpoint saved by the previous agent is the resume point. On resume, the agent re-runs cleanly.

### Existing `spentByAgent` — unchanged

The existing `spentByAgent` map and `getAgentCost()` / `getAllAgentCosts()` methods remain for **budget enforcement** (per-agent budget caps in `reserveBudget`). They continue to track costs by code-level agent name (`'pairwise'`, `'flowCritique'`, etc.). The new invocation cost tracking is a separate concern — `recordSpend` writes to both `spentByAgent` (by agent name) and `invocationCosts` (by invocation ID).

**Continuation behavior of `getAllAgentCosts()`**: On continuation, `spentByAgent` is restored from the checkpoint via `restoreSpent()`, so `getAllAgentCosts()` returns the cumulative run total for budget enforcement. However, `getAllAgentCosts()` is **no longer used for dashboard display or cost_prediction**. Dashboard actual costs and cost_prediction now query the invocations table directly (see Phase 4, steps 15-16). This eliminates the continuation bug where `getAllAgentCosts()` only reflected the current session.

### Estimated vs. actual audit

**Pre-run estimates** exist per-agent in `RunCostEstimate.perAgent` (from `estimateRunCostWithAgentModels`). The `tournament` estimate at `costEstimator.ts:200-203` includes pairwise comparison costs (`25 matches × 2 directions`).

**Post-run actuals** come from the ground truth table:
```sql
SELECT agent_name, SUM(cost_usd) as actual_cost
FROM evolution_agent_invocations
WHERE run_id = ?
GROUP BY agent_name
```

Agent names align between estimate and actual: the estimate's `tournament` entry includes pairwise costs, and the actual's `tournament` entry includes pairwise costs (attributed via tournament's scoped ctx). `computeCostPrediction` builds a clean per-agent estimated-vs-actual comparison.

**`cost_prediction` JSONB** stores this snapshot at run completion for historical audit:
```json
{
  "estimatedUsd": 0.1053,
  "actualUsd": 0.1361,
  "deltaPercent": 29.2,
  "perAgent": {
    "tournament": { "estimated": 0.03, "actual": 0.06 },
    "generation": { "estimated": 0.02, "actual": 0.01 },
    ...
  }
}
```

Persisted once at finalization — a frozen audit trail.

## Phased Execution Plan

### Phase 1: Schema & CostTracker API
1. **Migration: `llmCallTracking` FK** — Add `evolution_invocation_id UUID REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL` column with partial index. Non-breaking: column is nullable, existing rows get NULL.
2. **Zod schema** (`schemas.ts`): Add `evolution_invocation_id: z.string().uuid().optional()` to `llmCallTrackingSchema`.
3. **CostTracker API** (`costTracker.ts`): Add optional `invocationId` param to `recordSpend(agentName, cost, invocationId?)`. Add `invocationCosts: Map<string, number>` and `getInvocationCost(invocationId): number`. In `recordSpend`, if `invocationId` provided, accumulate in `invocationCosts` map.
4. **CostTracker interface** (`types.ts`): Update `recordSpend` signature to accept optional `invocationId`. Add `getInvocationCost`.
5. **ExecutionContext** (`types.ts`): Add `invocationId?: string` field.
5b. **LLMCompletionOptions** (`types.ts`): Add `invocationId?: string` field so the scoped wrapper can inject it via `{ ...options, invocationId }` and `createEvolutionLLMClient` can read `options.invocationId`.

### Phase 2: Invocation lifecycle & LLM call linkage
6. **Split `persistAgentInvocation`** (`pipelineUtilities.ts`): Replace with `createAgentInvocation(runId, iteration, agentName, executionOrder): Promise<string>` (upsert with placeholder fields, returns UUID) and `updateAgentInvocation(invocationId, { success, costUsd, skipped, error, executionDetail })`.
7. **`llmClient.ts`**: Add `createScopedLLMClient(base, invocationId)` thin delegation wrapper. It delegates to `base.complete()`/`base.completeStructured()`, injecting `invocationId` via the options object. Update `createEvolutionLLMClient` to read `options.invocationId` and pass it to `recordSpend` and `callLLM`. The scoped wrapper does NOT reimplement reservation or error handling — it only injects the ID.
8. **`callLLM` refactor** (`llms.ts`): Replace the positional `onUsage` param with a trailing `options?: CallLLMOptions` object on `callLLMModelRaw`. Propagate through the internal call chain: `routeLLMCall`, `callAnthropicModel`, `callOpenAIModel`, and the `withLogging` wrapper. Update external callers (`createEvolutionLLMClient`, `contentQualityEval`, `tagEvaluation`, `sourceSummarizer`, etc.) from positional `onUsage` to `{ onUsage }`. Pass `options.evolutionInvocationId` through to `saveLlmCallTracking`. This is a mechanical refactor with no logic changes.
9. **`saveLlmCallTracking`** (`llms.ts`): Write `evolution_invocation_id` to the `llmCallTracking` row when provided.
10. **`createAgentCtx` helper** (`pipeline.ts`): `createAgentCtx(ctx, invocationId)` returns `{ ...ctx, invocationId, llmClient: createScopedLLMClient(...) }`. Shallow copy — costTracker/state/logger shared, invocationId/llmClient scoped.
10b. **Update `executeMinimalPipeline`** (`pipeline.ts:180-255`): The minimal pipeline has its own agent execution loop (lines 201-239) that calls `persistAgentInvocation` at line 214. Apply the same pattern:
```typescript
// executeMinimalPipeline agent loop (pipeline.ts:201-239):
// BEFORE: agent.execute(ctx) → persistAgentInvocation(runId, iteration, agent.name, ...)
// AFTER:
const invocationId = await createAgentInvocation(runId, ctx.state.iteration, agent.name, executionOrder);
const agentCtx = createAgentCtx(ctx, invocationId);
const result = await agent.execute(agentCtx);
const invocationCost = ctx.costTracker.getInvocationCost(invocationId);
await updateAgentInvocation(invocationId, { success: result.success, costUsd: invocationCost, ... });
// Remove old persistAgentInvocation call at line 214
```
This ensures minimal pipeline runs (used for single-iteration quick tests and continuation resumption) produce correct incremental cost data.

### Phase 3: Pipeline wiring & agent name cleanup
11. **`runAgent`** (`pipeline.ts`): Before `agent.execute()`, call `createAgentInvocation` → `createAgentCtx(ctx, invocationId)`. Pass scoped ctx to agent. After execution, read `costTracker.getInvocationCost(invocationId)` → `updateAgentInvocation(invocationId, ...)`. Remove old `persistAgentInvocation` call.
12. **flowCritique dispatch** (`pipeline.ts`): Wrap `runFlowCritiques()` with `createAgentInvocation` → `createAgentCtx` → pass scoped ctx → read cost → `updateAgentInvocation`, giving flowCritique its own invocation row.
13. **Rename tournament flow comparison** (`pairwiseRanker.ts:243`): Change `llmClient.complete(prompt, 'flowCritique', ...)` to `llmClient.complete(prompt, 'tournamentFlowComparison', ...)`. Disambiguates `call_source` in `llmCallTracking`: `evolution_flowCritique` = standalone scoring, `evolution_tournamentFlowComparison` = tournament head-to-head.

### Phase 4: Fix dashboard data sources
14. **BudgetStatusCard** (`getEvolutionRunBudgetAction` in `evolutionVisualizationActions.ts`): Verify the existing SUM logic works correctly now that `cost_usd` stores incremental deltas (it sums invocation rows, which is now correct).
14b. **Timeline delta computation** (`evolutionVisualizationActions.ts`): The timeline view currently computes deltas via `cost - prev` assuming cumulative `cost_usd`. After switching to incremental, this subtraction is wrong (subtracting prev incremental from current incremental). **Fix**: Remove the `prevCostByAgent` delta logic — each row's `cost_usd` IS the delta now. Use `cost_usd` directly as the iteration cost for that agent.
15. **cost_prediction.actualUsd** (`metricsWriter.ts`): Change `persistCostPrediction` to query `SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id = ?` for `actualUsd`, and `SUM(cost_usd) GROUP BY agent_name` for `perAgentCosts`. Remove dependency on `getAllAgentCosts()`.
16. **Update `computeCostPrediction` signature** (`costEstimator.ts`): Accept `actualTotalUsd: number` and `perAgentCosts: Record<string, number>` from caller instead of computing internally.

### Phase 5: UI label clarity
17. **Fix labels** (`TimelineTab.tsx`): Rename "Estimated" → "Pre-run Estimate" and "Actual" → "Final Cost".
18. **Remove redundant total**: If BudgetStatusCard and header bar now show identical values, simplify — either remove BudgetStatusCard's total or have it show a per-agent breakdown instead.

### Phase 6: Data migration (deferred — not blocking initial deploy)
19. **Backfill existing data**: Historical data before this fix has cumulative `cost_usd` values. New runs get accurate incremental data. Dashboard queries detect pre-migration runs and fall back to `evolution_runs.total_cost_usd` (see Deployment section). The backfill migration should run within 1 week of deploy: for each run ordered by (iteration, execution_order), compute `delta = cost_usd - LAG(cost_usd)` for each agent within the run. First row per agent keeps its value (delta from zero).

## Deployment & Rollback Strategy

### Deploy ordering
The schema migration (Phase 1, step 1) **must deploy before** the application code that writes `evolution_invocation_id`. Supabase migrations run independently of Vercel deploys — apply the migration first, verify the column exists, then deploy the code. The new column is nullable with no default constraint, so old code running against the new schema is safe (it simply never writes the column).

### Rollback migration
If the deploy must be reverted, apply the DOWN migration:
```sql
-- DOWN migration: revert llmCallTracking FK
DROP INDEX IF EXISTS idx_llm_tracking_invocation;
ALTER TABLE "llmCallTracking" DROP COLUMN IF EXISTS evolution_invocation_id;
```
This is safe: the column is nullable and the FK is `ON DELETE SET NULL`. Dropping the column removes the FK and any data in it. LLM call rows are preserved. No cascade effects.

### Index creation strategy
Use `CREATE INDEX CONCURRENTLY` in production to avoid locking the `llmCallTracking` table during index creation:
```sql
CREATE INDEX CONCURRENTLY idx_llm_tracking_invocation
  ON "llmCallTracking"(evolution_invocation_id)
  WHERE evolution_invocation_id IS NOT NULL;
```
**Important**: `CREATE INDEX CONCURRENTLY` cannot run inside a transaction. Supabase migrations run within a transaction by default. This index must be in a **separate migration file** executed outside the transaction wrapper, or run as a raw SQL statement via `supabase db execute`. The ALTER TABLE + ADD COLUMN can be in the main transactional migration; the CONCURRENTLY index is a separate non-transactional step. Validate in CI by running the migration against the test database and confirming the index exists with `\di idx_llm_tracking_invocation`.

### Backward-compatibility window
Between schema deploy and code deploy, old code runs against the new schema. Tests must verify:
- Old code tolerates the new nullable column (INSERT without specifying it → NULL, no error)
- New code tolerates rows where `evolution_invocation_id` is NULL (non-evolution calls and pre-migration rows)
- Dashboard queries gracefully handle runs with no invocation FK links (pre-migration data)

### Phase 6 clarification: historical data graceful degradation
Phase 6 (backfill migration) is **deferred, not optional**. Until backfill runs:
- Dashboard queries for historical runs will show `SUM(cost_usd)` from cumulative values (inflated totals). The dashboard must detect this: if a run was created before the migration date, display a "historical estimate" badge and fall back to `evolution_runs.total_cost_usd` for the total.
- New runs created after the code deploy will have correct incremental values.
- A test must verify this graceful degradation: query a run with cumulative data and confirm the UI displays the correct fallback.

The backfill migration logic:
```sql
-- For each run created before the migration cutoff date:
-- Order invocations by (iteration, execution_order)
-- For each agent_name within a run, compute delta = cost_usd - LAG(cost_usd) for same agent
-- Update each row with its delta value
-- First row for each agent keeps its original value (it IS the delta from zero)
```

## Testing

### Unit Tests

**CostTracker** (`costTracker.test.ts`):
- `recordSpend('pairwise', 0.01, tournamentUuid)` attributes $0.01 to `invocationCosts[tournamentUuid]` AND to `spentByAgent['pairwise']` (dual tracking)
- `recordSpend('generation', 0.02)` without invocationId updates `spentByAgent` and `totalSpent` only, no crash
- `getInvocationCost(id)` returns accumulated cost for that invocation ID
- `getInvocationCost(unknownId)` returns 0
- Multiple invocation IDs tracked independently in the same CostTracker instance
- `invocationCosts` map survives across many recordSpend calls (no implicit reset)

**Invocation persistence** (`pipelineUtilities.test.ts`):
- `createAgentInvocation` returns a UUID string
- `createAgentInvocation` upserts — calling twice with same (runId, iteration, agentName) returns the same UUID
- `updateAgentInvocation` writes final cost, success, and execution detail to the row

**Scoped LLM client** (`llmClient.test.ts`):
- `createScopedLLMClient` bakes invocationId into every `complete`/`completeStructured` call
- Scoped client passes invocationId to both `callLLM` and `recordSpend`
- Base client (without scoping) does not pass invocationId — non-evolution calls unaffected
- Two scoped clients with different IDs don't interfere (parallel-safety test)

**`callLLM` / `saveLlmCallTracking`** (`llms.test.ts`):
- `saveLlmCallTracking` writes `evolution_invocation_id` when provided
- `saveLlmCallTracking` omits `evolution_invocation_id` when not provided (null/undefined)

**Pipeline wiring** (`pipeline.test.ts`):
- `runAgent` creates a scoped ctx via `createAgentCtx` — original ctx is not mutated
- `runAgent` reads `costTracker.getInvocationCost(invocationId)` and passes it to `updateAgentInvocation`
- flowCritique dispatch creates a scoped ctx with its own invocation row
- Two agents with different invocation IDs don't cross-contaminate costs (parallel-safety test)

**Dashboard queries** (`costEstimator.test.ts`, `metricsWriter.test.ts`):
- `computeCostPrediction` with new signature (accepts `actualTotalUsd` and `perAgentCosts`) builds correct per-agent comparison
- `persistCostPrediction` queries invocations table for actual costs instead of using `getAllAgentCosts()`

**Backward-compatibility & degradation** (`migration.test.ts`):
- INSERT into `llmCallTracking` without `evolution_invocation_id` succeeds (column nullable)
- SELECT queries handle `evolution_invocation_id IS NULL` rows without error
- Dashboard query for a pre-migration run (cumulative cost_usd) falls back to `evolution_runs.total_cost_usd` and displays "historical estimate" indicator
- Dashboard query for a post-migration run uses `SUM(cost_usd)` from invocations (correct incremental values)
- Zod schema parses both old format (without `evolution_invocation_id`) and new format (with it)

### Integration Tests
- Run a multi-iteration pipeline; verify `SUM(cost_usd)` from invocations = `total_cost_usd` on run
- Run a pipeline with continuation; verify invocation costs are correct across session boundaries (no reset artifacts)
- Verify tournament invocation cost includes pairwise LLM costs (tournament.cost_usd > 0)
- Verify flowCritique has invocation rows when enabled (flowCritique.cost_usd > 0)
- Verify no agent has cost_usd = 0 when it made LLM calls (regression check for the original bug)
- Verify `spentByAgent` still tracks code-level costs correctly for budget enforcement (pairwise has its own entry)
- Verify `llmCallTracking` rows for evolution agents have `evolution_invocation_id` populated
- Verify `llmCallTracking.evolution_invocation_id` FK points to the correct invocation row (join query returns matching agent/iteration)

### Manual Verification (staging)
- Run an evolution that triggers at least one continuation
- Verify all cost displays on run detail page show consistent values
- Verify per-agent breakdown sums to total
- Verify tournament's cost_usd is non-zero (includes pairwise)
- Verify flowCritique appears in invocations when enabled
- Verify `SUM(cost_usd)` from invocations matches `total_cost_usd` on run
- Verify labels clearly distinguish "Pre-run Estimate" from "Final Cost"
- Query `llmCallTracking` for a run's evolution calls and confirm all have `evolution_invocation_id` set

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `evolution/docs/evolution/cost_optimization.md` - Cost tracking and estimation docs may need updating
- `evolution/docs/evolution/reference.md` - Budget enforcement and cost tracker reference
- `evolution/docs/evolution/architecture.md` - Pipeline cost flow documentation
- `evolution/docs/evolution/data_model.md` - Cost-related data model fields
- `evolution/docs/evolution/visualization.md` - Dashboard cost display components
- `evolution/docs/evolution/hall_of_fame.md` - elo_per_dollar and cost metrics

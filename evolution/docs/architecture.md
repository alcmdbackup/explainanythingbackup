# Architecture

This document describes the V2 Evolution pipeline architecture: entry points, execution
flow, the orchestrator-driven iteration loop, budget management, and integration with
the main application.

## Entry Points

The Evolution system can be triggered through four entry points, all converging on a
shared core function.

### API Route

`POST /api/evolution/run` — admin-only endpoint at `src/app/api/evolution/run/route.ts`.

- Protected by `requireAdmin()`.
- `maxDuration = 800` seconds (Vercel limit); pipeline gets `(800 - 60) * 1000 ms`.
- Accepts optional `{ runId: UUID }` body to target a specific pending run.
- Delegates to `claimAndExecuteRun()`.

### CLI Batch Runner

`evolution/scripts/processRunQueue.ts` — the primary batch execution script.

- Flags: `--parallel`, `--max-runs`, `--max-concurrent-llm`, `--max-duration`, `--dry-run`.
- Round-robins between staging and production databases.
- Calls `claimAndExecuteRun({ runnerId, db: target.client })` for each target.
- See [Minicomputer Deployment](./minicomputer_deployment.md) for systemd setup.

### Local Runner

`evolution/scripts/run-evolution-local.ts` — development and testing entry point.

- Flags: `--file`, `--prompt`, `--mock`, `--model`.
- Can bypass the claim system for local iteration.

### Core Function

All entry points funnel into `claimAndExecuteRun()` in
`evolution/src/lib/pipeline/claimAndExecuteRun.ts`:

```typescript
export interface RunnerOptions {
  runnerId: string;
  maxDurationMs?: number;
  targetRunId?: string;
}

export interface RunnerResult {
  claimed: boolean;
  runId?: string;
  stopReason?: string;
  durationMs?: number;
  error?: string;
}

export async function claimAndExecuteRun(
  options: RunnerOptions,
): Promise<RunnerResult>
```

The function follows a strict sequence: check the concurrent run limit, attempt to claim
a pending run via the `claim_evolution_run` RPC, start a 30-second heartbeat timer, then
call the internal `executePipeline()` function which handles the full pipeline lifecycle
(build context, run evolution loop, finalize, sync arena). On any pipeline error, the
run is marked as failed and the error message is returned in `RunnerResult`. The
heartbeat is always cleaned up in a `finally` block regardless of success or failure.
An optional `db` parameter allows external callers (e.g. `processRunQueue.ts`) to inject
their own Supabase client for multi-database support.

## Execution Flow

The end-to-end flow from trigger to completion:

```
  Trigger (API / CLI / Local)
       |
       v
  claimAndExecuteRun()
       |
       +-- Check concurrent limit (EVOLUTION_MAX_CONCURRENT_RUNS, default 5)
       +-- claim_evolution_run RPC (FOR UPDATE SKIP LOCKED, FIFO)
       +-- Start heartbeat (30s interval)
       |
       v
  executePipeline()                 [evolution/src/lib/pipeline/claimAndExecuteRun.ts] (internal)
       |
       +-- Mark run status = 'running'
       +-- Load strategy config from evolution_strategies
       +-- resolveContent()
       |     |
       |     +-- explanation_id path: direct DB read from explanations table
       |     +-- prompt_id path: 2-stage seed article generation
       |           +-- generateSeedArticle() → title LLM call → article LLM call
       |
       +-- loadArenaEntries(promptId)
       |     +-- Load non-archived arena variants from evolution_variants (synced_to_arena=true)
       |     +-- Attach pre-seeded mu/sigma ratings, set fromArena=true
       |
       +-- evolveArticle()          [evolution/src/lib/pipeline/loop/runIterationLoop.ts]
       |     +-- (3-op loop — see next section)
       |
       +-- finalizeRun()            [evolution/src/lib/pipeline/finalize/persistRunResults.ts]
       |     +-- Filter out arena-sourced variants from pool
       |     +-- Build V3 run_summary JSON
       |     +-- Update run status = 'completed'
       |     +-- Upsert variants to evolution_variants
       |     +-- Write cost metric (safety net — ensures row exists even if loop broke early)
       |     +-- Write finalization metrics (elo, matches, variant counts)
       |     +-- Propagate metrics to strategy + experiment entities
       |     +-- Auto-complete experiment if all runs done
       |
       +-- syncToArena()            [evolution/src/lib/pipeline/finalize/persistRunResults.ts]
             +-- Set synced_to_arena=true on winning variant in evolution_variants (prompt-based runs only)
```

### Claim Mechanism

Before attempting a claim, the runner queries the count of all runs with status
`'claimed'` or `'running'`. If this count meets or exceeds `EVOLUTION_MAX_CONCURRENT_RUNS`
(default 5), it returns `{ claimed: false }` without touching any run row.

The `claim_evolution_run` Postgres RPC uses `FOR UPDATE SKIP LOCKED` to provide
contention-free FIFO claiming. Multiple runners can call this RPC simultaneously without
blocking each other — each will atomically claim a different pending run. If a
`targetRunId` is specified, it claims that specific run; otherwise it picks the oldest
pending run ordered by `created_at`. The RPC returns the full run row including
`explanation_id`, `prompt_id`, `experiment_id`, `strategy_id`, and `budget_cap_usd`.

After a successful claim, `executePipeline()` immediately transitions the run to `'running'`
status, loads the strategy configuration from `evolution_strategies`, and proceeds to
content resolution.

### Content Resolution

Two mutually exclusive paths based on what the run targets:

1. **explanation_id path** — reads directly from the `explanations` table. This is the
   fast path for evolving existing content.

2. **prompt_id path** — uses `generateSeedArticle()` in
   `evolution/src/lib/pipeline/seed-article.ts` to create content from scratch via two
   LLM calls (title generation, then article generation). Each call has a 60-second
   timeout.

If neither `explanation_id` nor `prompt_id` is set, the run fails immediately.

### Arena Loading

For prompt-based runs, `loadArenaEntries(promptId)` loads all non-archived variants from
`evolution_variants` where `synced_to_arena=true`. Each entry becomes an `ArenaTextVariation`
(with `fromArena: true`) carrying its existing mu/sigma ratings. These enter the pool as
pre-calibrated competitors alongside the baseline. (The former `evolution_arena_entries`
table was consolidated into `evolution_variants` in migration `20260321000002`.)

## The Orchestrator-Driven Iteration Loop

The core algorithm in `evolveArticle()` runs a sequence of iterations dispatched by the
`nextIteration()` decision function. Each iteration is one of two types:

| Iteration type | Work agent(s)                                       | Merge                | Discard rule                                           |
|----------------|-----------------------------------------------------|----------------------|--------------------------------------------------------|
| **Generate**   | `numVariants` parallel `GenerateFromSeedArticleAgent` | 1 `MergeRatingsAgent` | Each agent decides locally (using its own snapshot)   |
| **Swiss**      | 1 `SwissRankingAgent` (parallel pairs internally)    | 1 `MergeRatingsAgent` | None — paid-for matches always reach global ratings    |

```
  loop:
      |
      +-- nextIteration() decision (kill/abort/deadline checks happen here)
      |     iter==0          → 'generate'
      |     budgetExhausted  → 'done' (stopReason='budget_exceeded')
      |     no eligible <2   → 'done'
      |     all converged    → 'done' (stopReason='converged')
      |     no candidatePairs→ 'done' (stopReason='no_pairs')
      |     else             → 'swiss'
      |
      +-- recordSnapshot(iter, type, 'start')
      |
      +-- if 'generate':
      |     Spawn N parallel GenerateFromSeedArticleAgent invocations,
      |     each with its own deep-cloned local pool/ratings/matchCounts
      |     and a frozen iteration-start snapshot. Each agent generates ONE
      |     variant via a single strategy, then ranks it via binary search
      |     against its local snapshot. Each agent owns its own
      |     surface/discard decision (budget + local mu < top15Cutoff = discard).
      |     Then dispatch MergeRatingsAgent over the surfaced agents' match
      |     buffers in randomized (Fisher-Yates) order.
      |
      +-- if 'swiss':
      |     SwissRankingAgent computes Swiss-style pairs over the eligible
      |     set (overlap allowed, capped at MAX_PAIRS_PER_ROUND), runs them
      |     in parallel via Promise.allSettled, returns the raw match buffer.
      |     MergeRatingsAgent is dispatched UNCONDITIONALLY — even if the
      |     swiss agent reports status='budget', the matches it completed
      |     must reach global ratings before the loop exits.
      |
      +-- recordSnapshot(iter, type, 'end', { discardedVariantIds, discardReasons })
```

The first iteration is always `generate`. Subsequent iterations are `swiss` until the
`nextIteration()` decision returns `done`. For a typical 9-variant run, the sequence is:

```
Iteration 1: generate (9 parallel agents + merge)
Iteration 2: swiss   (1 agent w/ parallel pairs + merge)
Iteration 3: swiss   (1 agent w/ parallel pairs + merge)
... until convergence / no_pairs / budget / kill / deadline
```

### Three Agent Types

All three agents extend the `Agent` base class (`evolution/src/lib/core/Agent.ts`) and
get the standard `Agent.run()` template-method treatment: invocation row creation, cost
delta computation, execution-detail validation, and budget-error handling.

Five extended strategies (`engagement_amplify`, `style_polish`, `argument_fortify`,
`narrative_weave`, `tone_transform`) remain available alongside the three core strategies
(`structural_transform`, `lexical_simplify`, `grounding_enhance`). When the strategy config
sets `generationGuidance` (an array of `{ strategy, percent }` entries summing to 100),
strategies are selected via weighted random sampling instead of the default round-robin
across `config.strategies`.

**`GenerateFromSeedArticleAgent`** (`evolution/src/lib/core/agents/generateFromSeedArticle.ts`)
— ONE variant per invocation. Generates the variant via a single strategy
(`structural_transform`, `lexical_simplify`, `grounding_enhance`, …), then ranks it via
binary search (`rankSingleVariant`) against a deep-cloned local snapshot of the
iteration-start pool/ratings/matchCounts. The agent owns the surface/discard decision:

- `converged` / `eliminated` / `no_more_opponents` → surface
- `budget` and local `mu >= top15Cutoff` → surface
- `budget` and local `mu < top15Cutoff` → **discard** (variant returned with `surfaced: false`,
  matches array empty — they never reach the merge agent)

The execution detail records the full per-comparison timeline (`generateFromSeedRankingDetailSchema`)
including opponent, score, before/after mu/sigma, and the final stop reason.

**`SwissRankingAgent`** (`evolution/src/lib/core/agents/SwissRankingAgent.ts`) — ONE
swiss iteration's worth of parallel pair comparisons. Takes the orchestrator-computed
`eligibleIds` plus `completedPairs` set, runs `swissPairing()` to pick new pairs,
dispatches them in parallel via `Promise.allSettled`, and returns the raw match buffer.
Does **not** apply rating updates — that's the merge agent's job. Status:

- `success` — every pair completed
- `budget` — at least one pair failed with `BudgetExceededError`; successful matches still returned
- `no_pairs` — no candidate pairs left

**`MergeRatingsAgent`** (`evolution/src/lib/core/agents/MergeRatingsAgent.ts`) — Reusable
merge step. Concatenates match buffers from one or more work agents, shuffles them via
Fisher-Yates (using a seeded RNG derived from the run's `random_seed`), and applies
OpenSkill updates to the global ratings sequentially in shuffled order. Adds new
variants from `input.newVariants` to the global pool. Writes one row per match to
`evolution_arena_comparisons` with `prompt_id=NULL` for in-run observability (Critical
Fix J — sole writer of in-run match rows; `sync_to_arena` later backfills `prompt_id`).
Captures before/after pool snapshots in the execution detail. Never discards.

### Per-Agent Frozen Snapshot

In a generate iteration, each parallel `GenerateFromSeedArticleAgent` receives a
deep-cloned snapshot of `pool`, `ratings`, and `matchCounts` taken at iteration start
(before any agent runs). This means agent N+1 cannot see agent N's variant during the
same iteration — they all rank against the same starting state. The merge agent then
reconciles the surfaced agents' results in randomized order to remove sequencing bias.

`deepCloneRatings()` (Critical Fix N) duplicates each `Rating` object so agents never
share references with each other or with the orchestrator's global state.

### Phase Execution and Error Handling

Each agent extends the `Agent` base class. `Agent.run()` wraps `execute()` with:

- Invocation row creation (`createInvocation()`) — populates `ctx.invocationId` so
  every LLM call can pass it for `llmCallTracking` joins (Critical Fix H).
- Cost delta computation (`costTracker.getTotalSpent()` before/after).
- `BudgetExceededError` and `BudgetExceededWithPartialResults` handling — the latter
  must be checked first since it subclasses the former.
- Execution detail Zod validation (failures logged but not fatal).
- `updateInvocation()` with `cost_usd`, `success`, `execution_detail`, `duration_ms`.

The orchestrator uses `Promise.allSettled` for parallel generate dispatch so a single
agent failure does not cancel the others.

### Execution Detail Flow

`Agent.execute()` returns `AgentOutput<TOutput, TDetail>` where `TDetail` is a typed execution detail object (e.g. variant counts for generation, match counts for ranking). `Agent.run()` processes this as follows:

1. `execute()` returns `AgentOutput` with `result`, `detail`, and optional `childVariantIds` / `parentVariantIds`.
2. `run()` patches `totalCost` into the detail object, then validates it via Zod `safeParse`. Validation failures are logged but do not fail the invocation.
3. `duration_ms` is computed from a `Date.now()` timestamp taken before `execute()` is called.
4. `updateInvocation()` is called with `execution_detail` (validated JSONB) and `duration_ms` together, so both fields are always written in the same DB update.
5. The admin UI invocation detail page reads `execution_detail` and renders it via `ConfigDrivenDetailRenderer`, using per-agent `DetailFieldDef[]` configs from `DETAIL_VIEW_CONFIGS` in `evolution/src/lib/core/detailViewConfigs.ts`.

### Pool Growth

The pool is append-only. Typical growth is ~5-6 variants per iteration (3 generated +
2-3 evolved). The baseline and any arena entries form the initial pool at iteration 0.
By the end of a 5-iteration run, the pool typically contains 25-35 variants. Elimination
during triage only prevents a variant from participating in further fine-ranking
comparisons — it remains in the pool and retains its rating for winner determination.

## Stop Reasons

The loop terminates for one of five reasons:

| Stop Reason          | Trigger                                              |
|----------------------|------------------------------------------------------|
| `iterations_complete`| All configured iterations finished normally           |
| `converged`          | Convergence detected during ranking                   |
| `budget_exceeded`    | `BudgetExceededError` thrown by cost tracker           |
| `killed`             | External cancellation via `isRunKilled()` check or abort signal |
| `time_limit`         | Wall clock deadline reached (`deadlineMs` option)     |

### Kill Detection

At each iteration boundary, `isRunKilled()` reads the run's `status` column. If it
finds `'failed'` or `'cancelled'`, the loop exits immediately. This allows the admin UI
or external scripts to abort a run by updating its status. DB errors during kill
detection are swallowed (run continues).

## Convergence

Convergence is checked at the end of each Swiss fine-ranking round. The algorithm
requires **2 consecutive rounds** where all eligible variants have converged.

A variant is **eligible** for convergence checking if it is:
- Not eliminated during triage, AND
- Either `mu + 1.04*sigma >= top15Cutoff` OR in the top-K set (default K=5)

A single variant is **converged** when its sigma drops below
`DEFAULT_CONVERGENCE_SIGMA` (3.0).

```
eligible = !eliminated AND (mu + 1.04*sigma >= top15Cutoff OR in topK)
converged = sigma < 3.0
pool_converged = 2 consecutive rounds where ALL eligible sigmas < 3.0
```

> **Note:** Convergence is checked within a single `rankPool()` call across its Swiss
> rounds. If convergence resets (a new round has unconverged variants), the consecutive
> counter resets to 0.

## Budget Tracking

The system uses a two-layer budget architecture.

### Local Per-Run Budget (V2CostTracker)

Defined in `evolution/src/lib/pipeline/cost-tracker.ts`. Uses a **reserve-before-spend**
pattern for parallel safety:

```typescript
export interface V2CostTracker {
  reserve(phase: string, estimatedCost: number): number;   // Returns margined amount (1.3x)
  recordSpend(phase: string, actualCost: number, reservedAmount: number): void;
  release(phase: string, reservedAmount: number): void;
  getTotalSpent(): number;
  getAvailableBudget(): number;
}
```

Before every LLM call, the caller reserves `estimatedCost * 1.3` (the RESERVE_MARGIN).
The `reserve()` function is **synchronous** — this is intentional for parallel safety
under Node.js's single-threaded event loop. If `totalSpent + totalReserved + margined >
budgetUsd`, a `BudgetExceededError` is thrown immediately.

After a successful LLM call, `recordSpend()` deducts the reservation and adds the actual
cost. On failure, `release()` returns the reservation to the available pool.

> **Warning:** The cost tracker logs an error if actual spend exceeds the budget cap
> (indicating a reservation underestimate), but does **not** throw — the overrun is
> allowed to complete.

### Global System-Wide Budget (LLMSpendingGate)

Defined in `src/lib/services/llmSpendingGate.ts`. Enforces daily/monthly caps and a
kill switch across all LLM calls system-wide (not just evolution). Uses an in-memory TTL
cache (30s for daily spend, 5s for kill switch, 60s for monthly) with DB-atomic
reservation for correctness near the cap boundary.

The per-run V2CostTracker operates within the envelope allowed by the global gate. The
two layers are independent — V2CostTracker does not call LLMSpendingGate directly. The
global gate is checked at the `callLLM()` level in the main app, before the LLM provider
adapter even returns to the evolution pipeline. This means a run can be stopped by either
its local budget or the global daily/monthly cap, whichever is reached first.

### Budget Flow Diagram

```
  Pipeline phase calls llm.complete(prompt, label)
       |
       v
  V2CostTracker.reserve() ─── throws BudgetExceededError if local budget full
       |
       v
  callLLM() in main app
       |
       +-- LLMSpendingGate.checkBudget() ─── throws GlobalBudgetExceededError
       |
       v
  LLM API call
       |
       v
  V2CostTracker.recordSpend() or release()
```

## Winner Determination

After the loop exits, the winner is selected from the full pool:

1. Highest mu (mean skill rating).
2. Tie-break: lowest sigma (most certain rating).
3. Fallback: `pool[0]` (the baseline) if no variant has a rating.

This means the baseline can win if no evolved variant outperforms it — which is the
correct outcome. The winner selection operates on the full pool including arena entries.
However, finalization filters arena-sourced variants out before persisting new variants,
since arena entries already exist in `evolution_variants` with `synced_to_arena=true`.

## Runner Lifecycle

### Heartbeat

`claimAndExecuteRun()` maintains a heartbeat by updating `evolution_runs.last_heartbeat`
every 30 seconds. The heartbeat interval is always cleared in a `finally` block to
prevent leaks.

### Stale Run Expiry

The `claim_evolution_run` RPC automatically expires stale runs before checking the
concurrency limit. On every claim attempt, it marks runs as `'failed'` if they have
been in `'claimed'` or `'running'` status for more than 10 minutes without a heartbeat
update (or with a NULL heartbeat and `created_at` older than 10 minutes). This is
self-healing — no external process is required.

A standalone watchdog also exists in `evolution/src/lib/ops/watchdog.ts` as
defense-in-depth. It handles both stale and NULL heartbeats via an `.or()` filter.

### Concurrent Limits

`EVOLUTION_MAX_CONCURRENT_RUNS` (environment variable, default 5) is checked before
claiming. The core runner counts all runs with status `'claimed'` or `'running'` and
refuses to claim if the limit is reached. This is a soft limit enforced at claim time —
it does not prevent races if two runners check simultaneously, but the `SKIP LOCKED`
semantics ensure they claim different runs even if both pass the concurrency check.

## Main App Integration

The evolution pipeline lives in `evolution/` but integrates tightly with the main
application.

### Path Aliases

TypeScript path aliases map `@evolution/*` to `./evolution/src/*`, allowing the main
app's API route to import evolution code directly:

```typescript
import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';
```

### LLM Adapter

The pipeline does not call LLM APIs directly. Instead, `claimAndExecuteRun.ts` wraps
the main app's `callLLM()` function in a provider object:

```typescript
const llmProvider = {
  async complete(prompt: string, label: string, opts?: { model?: string }): Promise<string> {
    return callLLM(prompt, `evolution_${label}`, EVOLUTION_SYSTEM_USERID, ...);
  },
};
```

All evolution LLM calls use `call_source='evolution_<label>'` for cost attribution and
the system user UUID `'00000000-0000-4000-8000-000000000001'` since there is no
human user in the loop.

`createEvolutionLLMClient` now accepts optional `db` and `runId` parameters. When provided, cost metrics are persisted to the database after each successful LLM call in a fire-and-forget write (errors are logged but do not fail the call). This provides per-LLM-call cost granularity beyond the phase-level cost tracking.

### Database Foreign Keys

- `evolution_runs.explanation_id` references the main `explanations` table.
- `llmCallTracking` rows created during evolution have a foreign key to
  `evolution_invocation_id`, linking each LLM call to a specific pipeline phase
  invocation.

See [Data Model](./data_model.md) for the full schema.

## Zod Validation at Trust Boundaries

All DB writes use Zod `.parse()` to enforce schema constraints before insertion. JSONB reads from the database (e.g., `run_summary`, `execution_detail`) use `.safeParse()` with logging so that malformed legacy data does not crash the pipeline. Schemas are defined in `evolution/src/lib/schemas.ts`.

## V2 vs V1 Contrast

The current V2 architecture replaced a fundamentally different V1 design.

### V1 (Deprecated)

- **Supervisor-Agent-Reducer** pattern with 11+ specialized agents.
- Multi-phase execution: generation, refinement, evaluation, meta-feedback.
- Checkpoint system for resuming interrupted runs.
- Complex inter-agent communication and state management.

### V2 (Current — orchestrator-driven parallel pipeline)

- **Orchestrator-driven loop** — `evolveArticle()` dispatches a sequence of iterations
  via `nextIteration()`, each iteration being one of two types (generate or swiss).
- **3 agent classes** — `GenerateFromSeedArticleAgent`, `SwissRankingAgent`,
  `MergeRatingsAgent`, all using the `Agent.run()` template method.
- **Discard inside the work agent** — each generate agent owns its surface/discard
  decision using its own deep-cloned local rating snapshot. Discarded variants are
  persisted to DB with `persisted=false` so generation cost stays queryable.
- **Per-call AgentContext snapshots** — concurrent agents each receive a frozen
  `AgentContext` (not a shared mutable object). Cross-agent state is rendezvoused
  via the merge agent in randomized order.
- **No checkpoints** — atomic execution; if it fails, the run fails.
- **Budget-aware** — reserve-before-spend pattern, paid-for matches always reach the
  global ratings (merge agent dispatched UNCONDITIONALLY after a swiss iteration).
- **Reproducible** — `random_seed` is generated/persisted per run; `deriveSeed()` gives
  each agent a deterministic sub-seed.
- **Arena integration** — cross-run competition via variants with `synced_to_arena=true`.

The key design trade-off: V2 sacrifices resumability for simplicity. A crashed V2 run
must be re-executed from scratch, but the much simpler code path makes debugging and
reasoning about behavior significantly easier.

> **Note:** Legacy V1 code remains in the codebase: type stubs, unused validation
> functions, and scripts with `@ts-nocheck`. These are not used by any active code path
> but have not been cleaned up.

## Key File Reference

| File | Purpose |
|------|---------|
| `src/app/api/evolution/run/route.ts` | API entry point |
| `evolution/scripts/processRunQueue.ts` | Batch runner (multi-DB round-robin scheduler) |
| `evolution/scripts/run-evolution-local.ts` | Local dev runner |
| `evolution/src/lib/pipeline/claimAndExecuteRun.ts` | Core claim + execute (single entry point) |
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Main loop orchestrator (`evolveArticle`) — `nextIteration()` decision, parallel generate dispatch, swiss/merge sequencing |
| `evolution/src/lib/core/` | Entity base class, Agent base class, METRIC_CATALOG, entityRegistry |
| `evolution/src/lib/core/agents/generateFromSeedArticle.ts` | One generate agent = one variant (single-strategy generate + binary-search rank + local discard) |
| `evolution/src/lib/core/agents/SwissRankingAgent.ts` | One swiss iteration's worth of parallel pair comparisons |
| `evolution/src/lib/core/agents/MergeRatingsAgent.ts` | Reusable shuffled OpenSkill merge (sole writer of in-run `evolution_arena_comparisons`) |
| `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` | Binary-search ranking algorithm for one variant against a local snapshot |
| `evolution/src/lib/pipeline/loop/swissPairing.ts` | Swiss-style pair selection (overlap allowed, capped) |
| `evolution/src/lib/shared/seededRandom.ts` | `SeededRandom` + `deriveSeed()` for reproducible Fisher-Yates shuffles |
| `evolution/src/lib/pipeline/classifyError.ts` | Map exceptions to `RunErrorCode` taxonomy |
| `evolution/src/lib/pipeline/finalize/persistRunResults.ts` | Result persistence (variants, snapshots, error fields, run-level metric aggregates) |
| `evolution/src/lib/pipeline/setup/buildRunContext.ts` | Run context setup + arena pool loading + random_seed init |
| `evolution/src/lib/pipeline/setup/generateSeedArticle.ts` | Seed article generation |
| `evolution/src/lib/pipeline/infra/trackBudget.ts` | Per-run budget tracking |
| `evolution/src/lib/pipeline/infra/createEntityLogger.ts` | Entity-aware structured logging factory |
| `evolution/src/services/logActions.ts` | Multi-entity log query server actions |
| `src/lib/services/llmSpendingGate.ts` | Global LLM spending gate |

## Logging Architecture

The pipeline uses a generalized entity logger that writes structured logs to the `evolution_logs` table (renamed from `evolution_run_logs`).

### EntityLogger Factory

`createEntityLogger(entityCtx, supabase)` in `evolution/src/lib/pipeline/infra/createEntityLogger.ts` replaces the former `createRunLogger`. It accepts an `EntityLogContext` specifying the entity type, entity ID, and denormalized ancestor FKs:

```typescript
type EntityType = 'run' | 'invocation' | 'experiment' | 'strategy';

interface EntityLogContext {
  entityType: EntityType;
  entityId: string;
  runId?: string;
  experimentId?: string;
  strategyId?: string;
}
```

The returned `EntityLogger` exposes `info()`, `warn()`, `error()`, and `debug()` methods. All writes are fire-and-forget — DB errors are swallowed to avoid disrupting pipeline execution. Known context fields (`iteration`, `phaseName`, `variantId`) are extracted from the context argument and written to dedicated columns; remaining fields go into the `context` JSONB column.

### Multi-Entity Logging

Every log row denormalizes its ancestor FKs (`run_id`, `experiment_id`, `strategy_id`) at write time. This enables efficient aggregation queries without JOINs — for example, querying all logs for a strategy returns logs from every run that used that strategy, plus their invocation-level logs. The `entity_type` and `entity_id` columns identify which entity directly emitted the log.

### Invocation-Level Logging

Individual agent invocations can emit their own logs by creating an `EntityLogger` with `entityType: 'invocation'`. These logs carry the invocation's ID as `entity_id` and inherit the parent run's `run_id`, `experiment_id`, and `strategy_id` for aggregation.

## Related Documentation

- [Data Model](./data_model.md) — database schema and relationships
- [Agents](./agents/overview.md) — LLM agent design and prompting
- [Cost Optimization](./cost_optimization.md) — budget strategies and cost reduction
- [Arena](./arena.md) — arena system and cross-run competition
- [Rating and Comparison](./rating_and_comparison.md) — OpenSkill rating mechanics
- [Strategies & Experiments](./strategies_and_experiments.md) — experiment and strategy management

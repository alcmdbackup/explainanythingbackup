# Architecture

This document describes the V2 Evolution pipeline architecture: entry points, execution
flow, the generate-rank-evolve loop, budget management, and integration with the main
application.

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

- Flags: `--parallel`, `--max-runs`, `--max-concurrent-llm`, `--dry-run`.
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
       |     +-- Update strategy aggregate stats
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

## The 3-Op Loop

The core algorithm in `evolveArticle()` runs a generate-rank-evolve loop for up to
`config.iterations` iterations (validated 1-100):

```
  for each iteration:
      |
      +-- Kill check: isRunKilled() → reads evolution_runs.status
      |   (exits with stopReason='killed' if status is 'failed' or 'cancelled')
      |
      +-- GENERATE: generateVariants()
      |   3 parallel strategies → 3 new variants
      |
      +-- RANK: rankPool()
      |   Triage new entrants → Swiss fine-ranking → convergence check
      |
      +-- EVOLVE: evolveVariants()
      |   Mutation (clarity/structure) + crossover → 2-3 new variants
      |
      +-- Update pool, ratings, match history
```

### Generate Phase

`generateVariants()` in `evolution/src/lib/pipeline/generate.ts` runs 3 strategies in
parallel:

- **structural_transform** — radical restructuring of organization and flow.
- **lexical_simplify** — simplify language, replace jargon, shorten sentences.
- **grounding_enhance** — add concrete examples and sensory details.

Each strategy produces one variant via its own LLM call with a strategy-specific system
prompt. The number of strategies per round is configurable via
`config.strategiesPerRound` (default 3). All outputs go through `validateFormat()` before
entering the pool — variants that fail format validation are silently discarded. If
budget runs out mid-generation, any variants already generated are preserved via
`BudgetExceededWithPartialResults`, a specialized error that extends `BudgetExceededError`
and carries partial results.

### Rank Phase

`rankPool()` in `evolution/src/lib/pipeline/rank.ts` operates in two sub-phases:

**Triage** — only runs when there are both existing and new variants (skipped entirely
on the first iteration when all variants are new). For each new entrant whose sigma is
at or above `CALIBRATED_SIGMA_THRESHOLD` (5.0), the system runs pairwise comparisons
against stratified opponents selected from the existing pool. Triage has two early
termination conditions:

- **Elimination**: if after 2+ opponents, `mu + 2*sigma < top20Cutoff` (the mu of the
  variant at the 80th percentile), the entrant is eliminated. Eliminated variants are
  excluded from fine-ranking but remain in the pool with their ratings intact.
- **Decisive early exit**: if after 2+ opponents, all matches had confidence >= 0.7 and
  the average confidence >= 0.8, triage ends early for that entrant (it has been
  sufficiently calibrated).

All comparisons use `compareWithBiasMitigation()`, which handles position-bias
correction in the LLM judge's A-vs-B evaluations.

**Swiss fine-ranking** — pairs non-eliminated eligible variants using Swiss-system
tournament pairing, where variants with similar ratings are matched against each other.
This is more efficient than round-robin because it concentrates comparisons where they
matter most — near rating boundaries. The phase runs up to 20 Swiss rounds, capped by
the budget tier's max comparisons. After each match, ratings are updated using the
OpenSkill (Weng-Lin) Bayesian rating system. Draws are supported and update both
ratings symmetrically.

Budget tiers control comparison intensity:

| Budget Used | Tier   | Max Comparisons |
|-------------|--------|-----------------|
| < 50%       | Low    | 40              |
| 50-80%      | Medium | 25              |
| > 80%       | High   | 15              |

**Partial results on budget errors** — When a `BudgetExceededError` occurs during triage
or Swiss fine-ranking, partial rating updates and matches accumulated so far are not lost.
`rankPool()` catches the budget error and throws `BudgetExceededWithPartialResults` with a
partial `RankResult` containing the accumulated `ratingUpdates`, `matchCountIncrements`,
and `matches` from all comparisons completed before the error. The loop handler in
`runIterationLoop.ts` extracts and applies these partial results (updating the pool's
ratings and match history) before breaking out of the loop with
`stopReason='budget_exceeded'`.

### Evolve Phase

`evolveVariants()` in `evolution/src/lib/pipeline/evolve.ts` applies genetic-algorithm-
inspired operators to the highest-rated variants in the pool:

- **Mutation** — selects a top-rated parent and applies either a `clarity` mutation
  (simplify sentences, improve word precision) or a `structure` mutation (reorganize
  flow, improve transitions). The mutation type alternates or is selected based on
  available feedback about the variant's weakest dimension.
- **Crossover** — selects two top-rated parents and asks the LLM to combine their best
  elements into a new variant that preserves the strengths of both.

Produces 2-3 new variants per iteration. All outputs pass through `validateFormat()`
before entering the pool. Like the generate phase, budget errors during evolution
terminate the loop with `stopReason='budget_exceeded'`.

### Phase Execution and Error Handling

Each phase (generate, rank) is implemented as an Agent subclass (`GenerationAgent`,
`RankingAgent`) in `evolution/src/lib/core/agents/`. The evolve phase calls pipeline functions directly. These agent classes extend the `Agent`
base class and use its `Agent.run()` template method, which wraps execution with
budget-error handling, invocation tracking via `createInvocation()`/`updateInvocation()`,
and cost attribution. The `run()` method catches `BudgetExceededError` and
`BudgetExceededWithPartialResults` separately — the latter extends the former, so order
matters. Invocation records link to `llmCallTracking` rows for full cost attribution.

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

The loop terminates for one of four reasons:

| Stop Reason          | Trigger                                              |
|----------------------|------------------------------------------------------|
| `iterations_complete`| All configured iterations finished normally           |
| `converged`          | Convergence detected during ranking                   |
| `budget_exceeded`    | `BudgetExceededError` thrown by cost tracker           |
| `killed`             | External cancellation via `isRunKilled()` check       |

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

### V2 (Current)

- **Monolithic orchestrator** — `evolveArticle()` owns the entire loop.
- **2 agent classes** — `GenerationAgent`, `RankingAgent` using `Agent.run()` template method.
- **No checkpoints** — atomic execution; if it fails, the run fails.
- **No agent pool** — strategies are hardcoded, not dynamically assigned.
- **Budget-aware** — reserve-before-spend pattern, budget tiers, graceful degradation.
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
| `evolution/src/lib/pipeline/loop/runIterationLoop.ts` | Main loop orchestrator (`evolveArticle`) |
| `evolution/src/lib/core/` | Entity base class, Agent base class, METRIC_CATALOG, entityRegistry |
| `evolution/src/lib/pipeline/generate.ts` | Generate phase (GenerationAgent) |
| `evolution/src/lib/pipeline/rank.ts` | Rank phase (RankingAgent, triage + Swiss) |
| `evolution/src/lib/pipeline/evolve.ts` | Evolve phase (mutation + crossover) |
| `evolution/src/lib/pipeline/finalize.ts` | Result persistence |
| `evolution/src/lib/pipeline/arena.ts` | Arena load/sync |
| `evolution/src/lib/pipeline/seed-article.ts` | Seed article generation |
| `evolution/src/lib/pipeline/cost-tracker.ts` | Per-run budget tracking |
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

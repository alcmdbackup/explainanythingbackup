# Evolution Pipeline Architecture

Pipeline orchestration, iteration loop, stopping conditions, kill mechanism, and data flow for the V2 evolution content improvement system.

## Overview

The evolution pipeline is an autonomous content improvement system that iteratively generates, competes, and refines text variations using LLM-driven operations. It operates as a self-contained subsystem under `evolution/src/lib/v2/` with flat function-based operations, OpenSkill Bayesian rating, budget enforcement, and arena integration.

The pipeline uses an evolutionary algorithm metaphor: a pool of text variants competes via LLM-judged pairwise comparisons, top performers reproduce via mutation and crossover, and the population converges toward higher quality through iterative selection pressure.

```
Article Text → [generate → rank → evolve] × N iterations → Winner Selected
                    │            │             │
                    ├─ 3 strategies  ├─ Triage       ├─ Clarity mutation
                    ├─ Format valid. ├─ Swiss fine   ├─ Structure mutation
                    └─ Parallel      ├─ Early exit   ├─ Crossover
                                     └─ Convergence  └─ Creative exploration*
```
\* Creative exploration fires when diversity is low (0 < diversityScore < 0.5).

## Flat Iteration Loop

V2 uses a **flat loop** — the same 3 operations run every iteration with no phase transitions:

```
for iter = 1 to config.iterations:
  1. Kill detection (check run status in DB — 'failed' or 'cancelled' → break)
  2. generateVariants() → up to 3 variants via parallel strategies
  3. rankPool() → triage new entrants + Swiss fine-ranking
  4. Record muHistory (top-K mu values)
  5. Check convergence (2 consecutive rounds all eligible sigmas < threshold)
  6. evolveVariants() → mutate_clarity, mutate_structure, crossover, creative_exploration
  7. Budget check (BudgetExceededError breaks loop)
```

There are **no EXPANSION/COMPETITION phases**, no `PoolSupervisor`, no checkpoint/resume, and no `AgentBase` framework. Each operation is a plain async function imported from `v2/`.

## Three Operations

### generateVariants() (`v2/generate.ts`)

Generates new text variants using 3 parallel strategies via `Promise.allSettled()`:
- **`structural_transform`** — Aggressively restructure text with full creative freedom
- **`lexical_simplify`** — Simplify language, shorten sentences, reduce jargon
- **`grounding_enhance`** — Add concrete examples, sensory details, real-world connections

Each strategy produces one variant (3 total per iteration). Variants must pass `validateFormat()` before entering the pool; format failures are silently discarded. If budget is exceeded mid-generation, a `BudgetExceededWithPartialResults` error preserves any successfully generated variants.

### rankPool() (`v2/rank.ts`)

Two-step ranking using OpenSkill Bayesian ratings:

1. **Triage** — Sequential calibration of new entrants (sigma >= 5.0) against stratified opponents:
   - For n=5 opponents: 2 from top quartile, 2 from middle, 1 from bottom/fellow new entrants
   - Adaptive early exit: if all matches after `MIN_TRIAGE_OPPONENTS` (2) are decisive (confidence >= 0.7) and average confidence >= 0.8, skip remaining opponents
   - Top-20% cutoff elimination: after triage, variants with `mu + 2σ < cutoff` are excluded from fine-ranking

2. **Fine-ranking** — Swiss-style tournament among eligible contenders:
   - Eligibility: `mu >= 3σ` OR in top-K by mu (default K=5)
   - Pair scoring: `outcomeUncertainty × sigmaWeight` using Bradley-Terry logistic CDF
   - Greedy pair selection by descending score, skipping already-played pairs
   - Budget pressure tiers: low (40 max comparisons), medium (25), high (15) — based on budget fraction consumed
   - Convergence: all eligible sigmas below threshold for 2 consecutive rounds

### evolveVariants() (`v2/evolve.ts`)

Creates new variants from top-rated parents via mutation and crossover:
- **`mutate_clarity`** — Improve clarity of top parent (simplify sentences, precise word choices)
- **`mutate_structure`** — Improve structure of top parent (reorganize flow, strengthen transitions)
- **`crossover`** — Combine best elements of top 2 parents (requires 2+ parents in pool)
- **`creative_exploration`** — Bold, significantly different version (fires when `0 < diversityScore < 0.5`)

Parents are selected by descending mu. All outputs pass format validation before entering the pool.

## Config

V2 uses a flat `EvolutionConfig` (no nested objects like V1's `EvolutionRunConfig`):

```typescript
interface EvolutionConfig {
  iterations: number;          // Generate→rank→evolve iterations (1-100)
  budgetUsd: number;           // Total budget in USD (0-50)
  judgeModel: string;          // Model for comparison/judge calls
  generationModel: string;     // Model for text generation calls
  strategiesPerRound?: number; // Generation strategies per round (default: 3)
  calibrationOpponents?: number; // Triage opponents (default: 5)
  tournamentTopK?: number;     // Top-K for fine-ranking eligibility (default: 5)
}
```

Config is resolved from V1 DB format by `resolveConfig()` in `runner.ts`: `maxIterations` → `iterations`, `budgetCapUsd` → `budgetUsd`, with defaults `gpt-4.1-nano` (judge) and `gpt-4.1-mini` (generation).

Validation is done at `evolveArticle()` entry: iterations 1-100, budgetUsd 0-50, non-empty model strings.

## Runner Lifecycle

The V2 runner (`v2/runner.ts`) manages the full execution lifecycle via `executeV2Run()`:

```
1. Start heartbeat (30s interval)
2. Mark run as 'running'
3. resolveConfig(): V1 DB config → V2 flat EvolutionConfig
4. resolveContent(): explanation_id → fetch text OR prompt_id → generateSeedArticle()
5. upsertStrategy(): hash-based dedup, auto-label (INSERT or match on config_hash)
6. loadArenaEntries(): inject top entries into initial pool with pre-set ratings
7. evolveArticle() with initialPool
8. finalizeRun(): persist in V1-compatible format (run_summary v3, evolution_variants)
9. syncToArena(): new variants + match results via sync_to_arena RPC
```

### Content Resolution

Runs can target either:
- **Existing explanation** (`explanation_id`): Fetches `explanations.content` directly
- **Prompt** (`prompt_id`): Fetches prompt text from `evolution_prompts`, generates a seed article via 2 LLM calls (title generation + article generation)

### Strategy Linking

`upsertStrategy()` creates or matches a `strategy_configs` row via `config_hash` (SHA-256 of `{generationModel, judgeModel, iterations}`). The run is linked to this strategy for experiment tracking.

## Kill Mechanism

Running runs can be killed by admins. The pipeline detects kills at the **iteration boundary** via a DB status check:

1. At the top of each iteration, `isRunKilled()` reads the run's status from `evolution_runs`
2. If status is `'failed'` or `'cancelled'`, the loop breaks with `stopReason = 'killed'`
3. The kill action sets `error_message` and `completed_at` to preserve attribution

In-flight LLM calls complete but their results are discarded at the next iteration boundary.

`markRunFailed()` uses `.in('status', ['pending', 'claimed', 'running'])` guard — if the run is already failed (killed), the guard prevents overwriting the kill attribution.

## Stopping Conditions

Evaluated during the iteration loop:

| Condition | Trigger | Stop Reason |
|-----------|---------|-------------|
| Iterations complete | `iter > config.iterations` | `iterations_complete` |
| External kill | DB status is `'failed'` or `'cancelled'` | `killed` |
| Convergence | All eligible sigmas < threshold for 2 consecutive rounds | `converged` |
| Budget exceeded | `BudgetExceededError` thrown by any operation | `budget_exceeded` |

## Winner Determination

After the loop completes, the winner is selected by:
1. **Highest mu** — variant with the best estimated skill
2. **Tie-break: lowest sigma** — most confident rating wins ties

Baseline (original text) is the fallback if no variant has ratings.

## Append-Only Pool

Variants are never removed from the pool during a run. Low-performing variants naturally sink in mu and become less likely to be selected as parents for evolution. They remain available because they may contain novel structural or stylistic elements useful for future crossover operations.

## Per-Operation Invocation Tracking

Each operation creates a DB invocation row before execution and updates it after completion:
- `createInvocation(db, runId, iteration, operationName, executionOrder)` — row with UUID
- `updateInvocation(db, invocationId, { cost_usd, success, execution_detail, error_message })` — final metrics

This provides per-operation cost attribution and execution tracking in `evolution_agent_invocations`.

## Error Recovery

| Failure Mode | Pipeline Behavior | Recovery |
|---|---|---|
| Transient LLM error | LLM client retries 3x with backoff (1s/2s/4s), 60s timeout | Automatic retry |
| Budget exceeded mid-generation | `BudgetExceededWithPartialResults` preserves partial variants | Run completes with partial results |
| Budget exceeded | Run stops with `stopReason: 'budget_exceeded'` | Admin increases budget, queues new run |
| Content not found | Run marked `failed` immediately | Fix explanation/prompt data |
| Runner crash (no heartbeat) | Watchdog module detects stale heartbeat after 10 min | Queue new run |
| Admin kill | Loop breaks at next iteration boundary | Intentional — no recovery needed |
| All variants rejected by format validator | Pool doesn't grow for that iteration | Pipeline continues until budget or max iterations |

**No checkpoint/resume**: V2 runs must complete in a single execution. There is no `continuation_pending` status, no checkpoint table, and no resume mechanism. The pipeline is designed to be fast enough to complete within budget.

## Parallel Execution

The batch runner supports parallel execution of multiple evolution runs within a single process via `--parallel N`. Pipeline state is fully per-run isolated (separate pool, ratings, match counts, cost tracker), so concurrent runs do not interfere.

Rate limiting is enforced by an in-process `LLMSemaphore` that caps concurrent LLM API calls across all parallel runs. Default: 20, configurable via `EVOLUTION_MAX_CONCURRENT_LLM` env var or `--max-concurrent-llm` CLI flag.

Run claiming uses an atomic `claim_evolution_run` RPC (`FOR UPDATE SKIP LOCKED`) to prevent double-claiming.

## Data Flow

```
1. Experiment Created (admin UI)
   └─ Insert into evolution_experiments (status='draft')

2. Run Queued (admin UI via experimentActionsV2.ts)
   └─ Insert into evolution_runs (status='pending')
   └─ Link to experiment + prompt

3. Runner Claims Run (batch script or admin trigger)
   └─ Atomic claim via claim_evolution_run() RPC
   └─ resolveConfig() → V2 flat EvolutionConfig
   └─ resolveContent() → original text (fetch or generate seed)
   └─ upsertStrategy() → link strategy_configs
   └─ loadArenaEntries() → inject into initial pool

4. Pipeline Loop (evolveArticle, up to config.iterations)
   ├─ Kill detection (DB status check)
   ├─ generateVariants() → up to 3 new variants
   ├─ rankPool() → triage + Swiss fine-ranking
   ├─ evolveVariants() → mutation + crossover children
   └─ Per-operation invocation tracking (create → update)

5. Pipeline Completion (finalizeRun)
   ├─ Build run_summary (winner, pool, ratings, stopReason, costs)
   ├─ Persist to evolution_runs.run_summary (JSONB)
   ├─ Persist all variants to evolution_variants
   ├─ Update strategy aggregates via update_strategy_aggregates RPC
   └─ Mark experiment completed if all runs done

6. Arena Sync (prompt-based runs only)
   ├─ Filter out arena entries (only sync pipeline-generated variants)
   ├─ Map V2Match → arena comparison format
   └─ Sync via sync_to_arena RPC

7. Winner Application (admin action)
   ├─ Replace explanations.content column
   └─ Variant marked is_winner=true
```

## Related Documentation

- [Data Model](./data_model.md) — Core primitives (Prompt, Strategy, Run, Article)
- [Rating & Comparison](./rating_and_comparison.md) — OpenSkill rating, Swiss tournament, bias mitigation
- [Operations Overview](./agents/overview.md) — V2 operations: generate, rank, evolve
- [Reference](./reference.md) — Configuration, database schema, key files
- [Cost Optimization](./cost_optimization.md) — Cost tracking, Pareto analysis
- [Visualization](./visualization.md) — Admin experiment pages and shared components

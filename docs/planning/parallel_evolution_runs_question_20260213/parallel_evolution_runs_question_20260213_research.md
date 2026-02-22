# Parallel Evolution Runs Question Research

## Problem Statement
Investigate whether the current infrastructure can run multiple evolution pipeline runs in parallel. Identify the limiting factors on parallel execution (database connections, LLM API rate limits, budget tracking, process isolation, etc.) and determine how to maximize parallel execution speed.

## Requirements (from GH Issue #422)
- Can the current infrastructure run multiple evolution runs in parallel?
- What is the limiting factor on parallel runs?
- How to maximize speed running things in parallel?

## High Level Summary

**YES — the infrastructure can run multiple evolution runs in parallel**, but the current runners are configured for sequential execution. The pipeline itself is fully isolated per run (separate state, cost tracking, checkpoints, and DB writes). The primary limiting factors are:

1. **LLM API rate limits** — the biggest bottleneck. Each run already fires dozens of concurrent LLM calls internally (tournament rounds, parallel section edits, etc.), and multiple runs multiply this.
2. **Runner architecture** — the batch runner processes runs sequentially; the cron runner claims only 1 run per invocation; GitHub Actions has a concurrency group preventing parallel workflows.
3. **Supabase connection pool** — PgBouncer is configured with `default_pool_size = 20`, `max_client_conn = 100`, which limits concurrent DB connections.

There are **no in-process shared state issues** and **no database concurrency issues** that would prevent parallel execution.

---

## Detailed Findings

### 1. Run Claiming & Concurrency Control

#### Current Claiming Mechanism
- The `claim_evolution_run` RPC is **referenced but not implemented** in the database — no SQL migration exists for it.
- **Fallback**: Optimistic locking via `.eq('status', 'pending')` WHERE clause on UPDATE (`scripts/evolution-runner.ts:86-96`).
- Two runners CAN safely claim different runs. Same-run race is mitigated but not fully prevented (comment at line 86 acknowledges race condition without `FOR UPDATE SKIP LOCKED`).

#### Runner Behavior
| Runner | Runs per invocation | Execution model | Concurrency protection |
|--------|--------------------|-----------------|-----------------------|
| Batch runner (`scripts/evolution-runner.ts`) | Up to `--max-runs` (default 10) | **Sequential** — one at a time | N/A |
| Cron runner (`/api/cron/evolution-runner`) | **1** | Single run | Optimistic locking |
| GitHub Actions (`.github/workflows/evolution-batch.yml`) | Calls batch runner | Sequential | `concurrency: { group: evolution-batch, cancel-in-progress: false }` |
| Admin trigger (`triggerEvolutionRunAction`) | **1** (by run ID) | Inline execution | **NONE** — no atomic claim, status check only |

#### Key Implications
- The batch runner and cron runner each process runs one at a time. To run in parallel, you'd need multiple runner processes.
- The admin trigger action (`evolutionActions.ts:455-576`) has NO concurrency protection. Triggering different run IDs simultaneously works fine — they execute in parallel as separate server action invocations.
- Triggering the **same** run ID twice could cause duplicate execution (both read status as 'pending', both pass the check).

### 2. Pipeline State Isolation

All pipeline state is **per-run instance**, created fresh by `preparePipelineRun()` (`src/lib/evolution/index.ts:150-184`):

| Component | File | Isolation |
|-----------|------|-----------|
| `PipelineStateImpl` | `core/state.ts:17-77` | Per-run instance |
| `CostTrackerImpl` | `core/costTracker.ts:7-87` | Per-run instance |
| `ComparisonCache` | `core/comparisonCache.ts:13-42` | Per-run instance |
| `PoolSupervisor` | `core/supervisor.ts:71-150` | Per-run instance |
| `LogBuffer` | `core/logger.ts:27-134` | Per-run instance |
| All 12 agents | `index.ts:105-120` via `createDefaultAgents()` | Fresh instances per run |
| Feature flags | `core/featureFlags.ts:64-92` | DB-fetched per run |

**Only module-level shared state found**: Cost estimator baseline cache (`core/costEstimator.ts:58-60`) — a `Map` with 5-minute TTL. This is read-only after population and has negligible concurrency impact.

**Conclusion**: Multiple pipelines can run concurrently in the same process without state interference.

### 3. Database Concurrency

All database writes are **per-run isolated** by `run_id`:

| DB Write | Table | Isolation Key | Timing | Safe? |
|----------|-------|--------------|--------|-------|
| Checkpoints | `evolution_checkpoints` | `(run_id, iteration, last_agent)` unique index | After each agent | ✅ |
| Heartbeats | `evolution_runs` | `.eq('id', runId)` row-level update | After each agent | ✅ |
| Cost metrics | `evolution_run_agent_metrics` | `(run_id, agent_name)` unique | At completion only | ✅ |
| LLM call tracking | `llmCallTracking` | Append-only inserts, no shared keys | Per LLM call | ✅ |
| Log entries | `evolution_run_logs` | BIGSERIAL PK, `run_id` FK | Batched (20 entries) | ✅ |
| Variants | `evolution_variants` | UUID PK, `run_id` FK | At completion only | ✅ |

**Supabase connection pooling** (`supabase/config.toml`):
- `pool_mode = "transaction"`
- `default_pool_size = 20`
- `max_client_conn = 100`
- Supabase JS client uses HTTP REST API (stateless) — no local connection pool

**Conclusion**: Database writes from parallel runs cannot collide. The limiting factor is the PgBouncer pool size (20 connections), but since writes are infrequent compared to LLM calls, this is unlikely to be a bottleneck.

### 4. LLM API Rate Limits — THE MAIN BOTTLENECK

#### Provider Configuration (`src/lib/services/llms.ts`)
| Provider | Client | Max Retries | Timeout | Singleton? |
|----------|--------|-------------|---------|------------|
| OpenAI | `new OpenAI(...)` | 3 | 60s | Yes — lazy singleton (lines 109-114) |
| DeepSeek | `new OpenAI(...)` | 3 | 60s | Yes — lazy singleton (lines 133-138) |
| Anthropic | `new Anthropic(...)` | 3 | 60s | Yes — lazy singleton (lines 162-166) |

**No rate limiting, queuing, or throttling exists** in the evolution pipeline or LLM service layer.

#### Concurrent LLM Calls Within a Single Run
Agents already make parallel calls within a single run:

| Agent | Parallel calls | Details |
|-------|---------------|---------|
| GenerationAgent | 3 | One per strategy (`structural_transform`, `lexical_simplify`, `grounding_enhance`) |
| CalibrationRanker | 2-5 | `minOpponents` (default 2) comparisons × 2 calls each (bias mitigation) |
| Tournament | **20-40+** | All Swiss pairings per round × 2 calls each |
| SectionDecompositionAgent | 2-5 | One per eligible H2 section |

A single full pipeline run can fire **40+ concurrent LLM calls** in a single tournament round.

#### Impact of Multiple Concurrent Runs
With N concurrent runs, worst case is N × 40+ = hundreds of simultaneous LLM API calls. Provider rate limits:
- **DeepSeek**: Rate limits are typically generous (high RPM) but throughput varies
- **OpenAI**: Tier-dependent. GPT-4.1-mini has higher limits; GPT-4.1 has lower
- **Anthropic**: Rate limits based on account tier

**The SDKs handle 429 responses with built-in retry** (exponential backoff). The pipeline also retries failed agents once (`core/errorClassification.ts`). But without application-level rate limiting, bursts from parallel runs could cause cascading retries.

### 5. Watchdog and Run Lifecycle

- **Watchdog** (`/api/cron/evolution-watchdog/route.ts`): Correctly handles multiple concurrent runs. Selects ALL stale runs (no LIMIT clause) and batch-updates them.
- **Run statuses**: `pending → claimed → running → completed/failed/paused`
- **Runner ID**: TEXT column identifying the executing process. Cleared on completion/failure. No uniqueness constraint.
- **Queue limits**: No hard limit on pending runs. Auto-queue cron (`content-quality-eval/route.ts:164`) caps at 5 per cron execution with $3 budget each.
- **No global budget enforcement**: Each run has individual `budget_cap_usd` but nothing sums across concurrent runs.

### 6. Ways to Run Multiple Runs in Parallel TODAY

**Option A: Multiple batch runner processes**
```bash
# Terminal 1
npx tsx scripts/evolution-runner.ts --max-runs 5
# Terminal 2
npx tsx scripts/evolution-runner.ts --max-runs 5
```
Each process generates a unique `runner_id` (`runner-${uuid}`). Optimistic locking prevents double-claiming. Each process still runs its own runs sequentially, but different processes run different runs concurrently.

**Option B: Multiple admin triggers**
Trigger different run IDs via the admin UI. Each `triggerEvolutionRunAction` call executes inline as a separate server action invocation. These run concurrently within the Next.js server process.

**Option C: Multiple cron invocations**
If the cron fires while a previous invocation is still running, both claim different runs and execute concurrently (no concurrency group on the cron endpoint, only on GitHub Actions).

### 7. Current Execution Infrastructure

Three execution paths exist today, none of which support parallel run execution:

#### Vercel Cron (primary — runs continuously)
Configured in `vercel.json`:

| Cron Endpoint | Schedule | Behavior |
|---------------|----------|----------|
| `/api/cron/evolution-runner` | Every 5 minutes | Claims **1 pending run**, executes inline. `maxDuration = 300` (5 min) — will timeout before most full pipeline runs complete. |
| `/api/cron/evolution-watchdog` | Every 15 minutes | Marks stale runs (no heartbeat >10 min) as `failed` |
| `/api/cron/content-quality-eval` | Every 6 hours | Auto-queues up to 5 low-scoring articles ($3 budget each) |

**Key limitation**: The Vercel cron runner claims only 1 run per invocation with a 5-minute `maxDuration`. A full pipeline run typically exceeds 5 minutes, so the cron will often timeout. If the cron fires while a previous invocation is still running (overlap), both claim different runs via optimistic locking — accidental parallelism is possible but uncontrolled.

#### GitHub Actions (weekly batch)
Configured in `.github/workflows/evolution-batch.yml`:
- **Schedule**: Mondays 4am UTC (`cron: '0 4 * * 1'`)
- Runs `scripts/evolution-runner.ts --max-runs 10` **sequentially** (one run at a time)
- 7-hour timeout (`timeout-minutes: 420`)
- **Concurrency group** (`evolution-batch`) prevents parallel workflow runs — if manually dispatched while running, new run queues and waits
- Environment: `ubuntu-latest` with `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, Supabase credentials from secrets

#### Local batch runner (manual)
```bash
npx tsx scripts/evolution-runner.ts --max-runs N [--dry-run]
```
- Processes runs **sequentially** in a `while` loop (`scripts/evolution-runner.ts:261-275`)
- Generates unique `runner_id` per process (`runner-${uuid}`)
- Graceful shutdown on SIGTERM/SIGINT — finishes current run before exiting
- 60-second heartbeat interval

#### Summary of Current Throughput
| Path | Max throughput | Parallelism |
|------|---------------|-------------|
| Vercel cron | ~1 run per 5 min (often times out) | None (1 per invocation) |
| GitHub Actions | ~10 runs per week (sequential) | None (concurrency group) |
| Local runner | Sequential, ~1 run per 10-30 min | None (single-threaded loop) |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/reference.md
- docs/evolution/visualization.md
- docs/evolution/cost_optimization.md
- docs/evolution/hall_of_fame.md
- docs/feature_deep_dives/server_action_patterns.md
- docs/feature_deep_dives/state_management.md

## Code Files Read
- `scripts/evolution-runner.ts` — Batch runner claiming and execution loop
- `src/app/api/cron/evolution-runner/route.ts` — Cron runner claiming and execution
- `src/app/api/cron/evolution-watchdog/route.ts` — Stale run detection
- `src/app/api/cron/content-quality-eval/route.ts` — Auto-queue cron
- `src/lib/services/evolutionActions.ts` — Queue and trigger actions
- `src/lib/evolution/core/pipeline.ts` — Pipeline orchestration, checkpoints, finalization
- `src/lib/evolution/core/state.ts` — PipelineStateImpl
- `src/lib/evolution/core/costTracker.ts` — Per-run budget tracking
- `src/lib/evolution/core/comparisonCache.ts` — Comparison cache
- `src/lib/evolution/core/featureFlags.ts` — Feature flag fetching
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor
- `src/lib/evolution/core/logger.ts` — LogBuffer
- `src/lib/evolution/core/llmClient.ts` — Evolution LLM client wrapper
- `src/lib/evolution/core/costEstimator.ts` — Cost estimation with module-level cache
- `src/lib/evolution/core/budgetRedistribution.ts` — Agent budget allocation
- `src/lib/evolution/index.ts` — createDefaultAgents, preparePipelineRun, finalizePipelineRun
- `src/lib/evolution/agents/generationAgent.ts` — Parallel strategy generation
- `src/lib/evolution/agents/calibrationRanker.ts` — Parallel comparison calls
- `src/lib/evolution/agents/tournament.ts` — Parallel Swiss round execution
- `src/lib/evolution/agents/sectionDecompositionAgent.ts` — Parallel section editing
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Instance-level attempted targets
- `src/lib/services/llms.ts` — LLM provider routing, singleton clients, retry config
- `src/lib/utils/supabase/server.ts` — Supabase client creation
- `supabase/config.toml` — PgBouncer pool configuration
- `supabase/migrations/20260131000001_evolution_runs.sql` — Runs table schema
- `supabase/migrations/20260131000002_evolution_variants.sql` — Variants table schema
- `supabase/migrations/20260131000003_evolution_checkpoints.sql` — Checkpoints schema
- `supabase/migrations/20260211000001_evolution_run_logs.sql` — Logs schema
- `.github/workflows/evolution-batch.yml` — GitHub Actions concurrency config
- `vercel.json` — Vercel cron schedule configuration

# Fix Uninitialized Evolution Run Research

## Problem Statement
Make sure that created evolution runs have an explanation id and then get picked up appropriately.

## High Level Summary

Run `12fb16de` is stuck in `pending` with `explanation_id = NULL`. The root cause is a gap between the evolution framework's new "prompt + strategy" queue path and the cron runner's assumption that every run has an `explanation_id`.

**Two problems compound:**
1. `queueEvolutionRunAction` allows creating runs with only a `promptId` (no `explanation_id`), which is valid for the new framework design but leaves the run unprocessable by the cron runner.
2. The cron runner at `evolution-runner/route.ts` picks up ALL pending runs without filtering for null `explanation_id`, claims them, then fails when fetching the explanation.

## Root Cause Analysis

### How the run was created
The admin UI's "Start New Pipeline" card at `page.tsx:143` calls:
```typescript
queueEvolutionRunAction({ promptId, strategyId, budgetCapUsd: cap });
// No explanationId passed
```

In `evolutionActions.ts:106-108`, the validation only requires *either* `explanationId` or `promptId`:
```typescript
if (!input.explanationId && !input.promptId) {
  throw new Error('Either explanationId or promptId is required');
}
```

The insert at line 110-121 conditionally adds `explanation_id` only if provided — when omitted, the DB allows NULL (since migration `20260131000008`).

### Two UI flows exist
1. **"Start New Pipeline" card** (page.tsx:113-201) — sends `{ promptId, strategyId, budgetCapUsd }`, no explanationId. This is the new framework flow.
2. **"Queue for Evolution" dialog** (page.tsx:205-272) — sends `{ explanationId, budgetCapUsd }`. This is the legacy flow.

### Why the cron doesn't pick it up properly
The cron runner at `route.ts:25-31` fetches the oldest pending run with no null filter:
```typescript
.eq('status', 'pending')
.order('created_at', { ascending: true })
```

If claimed, it fails at line 93-97 when querying `.eq('id', null)` and marks the run as `failed`.

### Why `explanation_id` was made nullable
Migration `20260131000008` dropped NOT NULL to support CLI runs (`run-evolution-local.ts`) that operate on local markdown files without a DB explanation. The `source` column distinguishes origins:
- `'explanation'` — production runs linked to a DB explanation
- `'local:<filename>'` — CLI runs on local files
- `'prompt:<text>'` — CLI runs from a topic prompt

## All Insert Paths

| # | Path | File | Sets explanation_id? | Can be NULL? |
|---|------|------|---------------------|--------------|
| 1 | Server Action (admin) | `evolutionActions.ts:117-121` | Conditional | YES — if only `promptId` provided |
| 2 | Auto-Queue Cron | `content-quality-eval/route.ts:168-175` | Always (from articles) | No |
| 3 | CLI Local | `run-evolution-local.ts:472-479` | Optional (flag) | YES — by design |
| 4 | Batch Script | `run-batch.ts:131-141` | Always (creates explanation first) | No |

## All Pickup Mechanisms

| Mechanism | Filters null explanation_id? | Outcome on null | Cleanup? |
|-----------|------------------------------|-----------------|----------|
| Vercel Cron (`route.ts`) | No | Claims, then marks `failed` | YES — `markRunFailed()` releases claim |
| Batch Runner (`evolution-runner.ts`) | No | Throws in `fetchOriginalText()` | NO — orphaned `claimed` run, no error_message |
| Inline Trigger (`triggerEvolutionRunAction`) | No | Throws `"Explanation null not found"` | YES — error returned to caller |

### Queue blocking behavior
- **Cron runner**: Claims null-explanation run → marks `failed` → releases claim → next invocation picks next pending run. **Queue NOT blocked.**
- **Batch runner**: Claims null-explanation run → throws → run stays `claimed` with no error_message → eventually caught by watchdog (10 min). **Queue NOT blocked** (RPC skips claimed runs), but **orphaned run pollutes DB.**

## Pipeline Core is Null-Safe

Every pipeline function that touches `explanationId` has proper guards:

| Function | File:Line | Guard |
|----------|-----------|-------|
| `persistVariants()` | pipeline.ts:78 | `explanation_id: ctx.payload.explanationId \|\| null` |
| `autoLinkPrompt()` | pipeline.ts:454 | `if (ctx.payload.explanationId)` before DB query |
| `feedHallOfFame()` | pipeline.ts:526 | `if (!topicId && ctx.payload.explanationId)` before fallback |

**The pipeline would work fine with `explanationId = null`** if `originalText` is provided.

## Blueprint: CLI `--prompt` Flow

The CLI (`run-evolution-local.ts`) already solves "generate article from prompt":

1. `generateSeedArticle()` (line 550-580) uses `createTitlePrompt()` → `createExplanationPrompt()` → returns `{title, content}`
2. Sets `originalText = seed.content` (line 667) before invoking pipeline
3. Sets `source = 'prompt:<text>'` (line 638) to distinguish from explanation runs
4. The CLI does NOT use `queueEvolutionRunAction` — it inserts directly and runs inline

This is the model for how the cron runner could handle prompt-based runs.

## Framework Implementation Status

The prompt-based run system is ~80% built but the execution path is missing:

| Component | Status | Detail |
|-----------|--------|--------|
| Data model (prompt_id, strategy_config_id FKs) | Done | Migrations 20260207000001-000008 |
| Prompt registry CRUD | Done | `promptRegistryActions.ts` |
| Strategy registry CRUD | Done | `strategyRegistryActions.ts` |
| Auto-link prompt after pipeline | Done | `autoLinkPrompt()` in pipeline.ts:414-477 |
| Hall of Fame top-3 feeding | Done | `feedHallOfFame()` in pipeline.ts:502-635 |
| Pipeline type tracking | Done | `executeFullPipeline` sets `pipeline_type = 'full'` |
| **Prompt-based execution path** | **Missing** | No code generates article from prompt before pipeline |
| Admin UI for prompt/strategy management | Missing | Server actions exist, UI pages don't |

## Type Signature Issues

- `AgentPayload.explanationId` (types.ts:108) typed as `number` — should be `number | null`
- `PipelineRunInputs.explanationId` (index.ts:121) is non-optional — should be `explanationId?: number`

## DB Schema: CHECK Constraint Option

Rather than re-adding NOT NULL (which breaks CLI runs), a CHECK constraint using the `source` column:
```sql
CHECK (explanation_id IS NOT NULL OR source NOT LIKE 'explanation%')
```

This allows null for `source = 'local:*'` and `source = 'prompt:*'` but requires it for `source = 'explanation'`.

The existing `enforce_not_null.sql` migration (20260207000008) enforces NOT NULL on `prompt_id` and `strategy_config_id` but deliberately does NOT enforce `explanation_id`.

## Test Coverage Gaps

| Area | Covered? | Detail | Priority |
|------|----------|--------|----------|
| Queue with `explanationId` only | YES | `runTriggerContract.test.ts` | — |
| Queue with `promptId + strategyId` | YES | `runTriggerContract.test.ts` | — |
| Queue with `promptId` only (no explanationId) | **NO** | Missing test | High |
| Cron runner with null `explanation_id` | **NO** | Only tests invalid ID (999), not null | **Critical** |
| Cron runner with prompt-based run (after fix) | **NO** | Doesn't exist yet | **Critical** |
| Batch runner error cleanup | **NO** | No test for orphaned claimed runs | **Critical** |
| End-to-end status transitions | **NO** | No `pending → claimed → running → completed` test | High |
| Queue for Evolution dialog post-migration | **NO** | Would fail without prompt_id/strategy_config_id | Medium |

### Existing Test Counts
- `runTriggerContract.test.ts` — 8 unit tests (mock Supabase)
- `evolution-actions.integration.test.ts` — 12 integration tests (real DB)
- `evolution-runner/route.test.ts` — 12 unit tests (mock Supabase + pipeline)
- `evolution-infrastructure.integration.test.ts` — 8 integration tests (concurrent claims, heartbeat, split-brain)
- `evolution-pipeline.integration.test.ts` — 6 integration tests (minimal pipeline, checkpoints, budget pause)

## Batch Runner Silent Failure Bug

`evolution-runner.ts` catches errors in `executeRun()` (line 185-187) but does NOT:
- Update run status to `'failed'`
- Clear `runner_id`
- Store error_message

This leaves orphaned `claimed` runs. The cron runner (`route.ts`) handles this correctly via `markRunFailed()` which sets `status='failed'`, `runner_id=null`, and stores the error message.

## Additional Insert Path Issues (Post-Migration 20260207000008)

Migration `20260207000008` makes `prompt_id` and `strategy_config_id` NOT NULL (with safety gates). Multiple insert paths would **fail** post-migration because they don't set these columns:

| Insert Path | Sets prompt_id? | Sets strategy_config_id? | Broken? |
|-------------|----------------|-------------------------|---------|
| Start New Pipeline (UI) | YES | YES | No |
| Queue for Evolution (dialog) | NO | NO | **YES** |
| CLI (`run-evolution-local.ts`) | NO | NO | **YES** |
| Batch (`run-batch.ts`) | NO | NO | **YES** |
| Auto-queue cron | NO | NO | **YES** |

The safety-gated migration checks for existing NULL rows and in-flight runs before applying, so it hasn't broken production yet. But these paths need updating before the migration can safely run.

## Batch Runner Claim Mechanism Detail

The batch runner (`scripts/evolution-runner.ts`) uses two claim strategies:
1. **Primary**: RPC `claim_evolution_run(p_runner_id)` — atomic `FOR UPDATE SKIP LOCKED` at DB level, prevents lock contention between multiple runners
2. **Fallback**: Query oldest pending + conditional update `WHERE id=run.id AND status='pending'` — non-atomic but safe due to condition check

Both skip already-claimed runs, so the queue isn't blocked by orphans — but orphaned `claimed` runs pollute the DB until the watchdog catches them (~10 min).

## CLI Null-Safety Pattern

The CLI at `run-evolution-local.ts:679` uses `explanationId: args.explanationId ?? 0` — defaulting to `0` which is falsy. All downstream pipeline functions use truthiness checks (`if (ctx.payload.explanationId)`), so `0` behaves identically to `null`. This works but is implicit.

## Fix Strategy Options

### Option A: Short-term (require explanation_id for production runs)
- Add validation in `queueEvolutionRunAction`: if `source` would be `'explanation'`, require `explanationId`
- Add DB CHECK constraint: `explanation_id IS NOT NULL OR source NOT LIKE 'explanation%'`
- Make cron runner skip runs with null `explanation_id` (or filter in query)
- Fix batch runner error cleanup

### Option B: Long-term (enable prompt-based execution)
- Teach runners to generate seed articles from prompts using `generateSeedArticle()` pattern
- When `explanation_id` is null but `prompt_id` is set, fetch prompt text → generate article → use as `originalText`
- Update type signatures to allow `explanationId: number | null`
- Enables the full framework vision

### Recommended: Option A + partial B
Since this is a `fix/` branch, scope to what unblocks runs now:
- Fix the cron runner to handle prompt-based runs (the 20% missing from the framework)
- Fix type signatures and batch runner cleanup
- Add validation and tests
- Defer: DB CHECK constraint (requires migration coordination), admin UI pages

Both options should also:
- Clean up stuck run `12fb16de`
- Add missing test cases
- Fix batch runner error cleanup bug

## Per-Run Logging for Admin UI

### Problem

When a pipeline run fails (e.g. "budget exceeded" for run `482250e9`), there's no way to see what happened. Logs go to `server.log` (local file), Honeycomb (OTEL), and Sentry (errors only) — none of which are queryable per-run from the admin UI.

### Current Logging Infrastructure

| Destination | What goes there | Per-run queryable? |
|-------------|----------------|-------------------|
| `server.log` (file) | All log levels, JSON lines | No — grep only |
| Honeycomb (OTEL) | All levels with `{requestId, userId}` context | No — no `runId` in OTEL attributes |
| Sentry | Errors/warnings only | No |
| DB `run_summary` JSONB | Post-run analytics (stop reason, ordinal history, etc.) | Yes — but no raw logs |
| DB `error_message` TEXT | Final error only | Yes — but only one line |

The `EvolutionLogger` in `core/logger.ts` wraps the main logger and injects `{subsystem: 'evolution', runId, agentName}` context into every log entry. Agents extensively log at key points: operation start/complete (`info`), format validation failures (`warn`), comparison errors (`error`), cache hits (`debug`).

### What the Admin UI Shows Per-Run Today

- Status, phase, iteration count, cost, budget
- Variant rankings with Elo/matches
- Agent cost breakdown (from `evolution_run_agent_metrics`)
- Run summary analytics (from `run_summary` JSONB)
- **No logs, no execution trace, no debug output**

### Approach Options

#### Option 1: Buffer logs in memory, persist to DB column

Extend `createEvolutionLogger` to buffer log entries in an array during execution. After the run completes (or fails), persist the buffer to a new `run_logs` JSONB column on `evolution_runs`.

```typescript
// In createEvolutionLogger:
const logBuffer: LogEntry[] = [];
return {
  info: (msg, ctx) => {
    logBuffer.push({ ts: Date.now(), level: 'info', agent: agentName, msg, ctx });
    logger.info(msg, { ...baseContext, ...ctx });
  },
  // ... same for warn, error, debug
  flush: () => logBuffer,  // called by pipeline after completion
};
```

**Pros**: Simple, no new table, no migration coordination, logs available even for failed runs (flush in catch block).
**Cons**: Memory pressure for long runs (~1000+ entries), JSONB column size limits, no streaming (logs only visible after run completes).

#### Option 2: New `evolution_run_logs` table with streaming writes

Create a dedicated table with columns for cross-linking to UI views:
```sql
CREATE TABLE evolution_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES evolution_runs(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  level TEXT NOT NULL,       -- info/warn/error/debug
  agent_name TEXT,           -- links to Timeline agent rows + Explorer task view
  iteration INT,             -- links to Timeline iteration sections
  variant_id TEXT,           -- links to Explorer article view + Variants tab
  message TEXT NOT NULL,
  context JSONB
);
CREATE INDEX idx_run_logs_run_id ON evolution_run_logs(run_id);
CREATE INDEX idx_run_logs_iteration ON evolution_run_logs(run_id, iteration);
CREATE INDEX idx_run_logs_agent ON evolution_run_logs(run_id, agent_name);
```

The `iteration`, `agent_name`, and `variant_id` columns enable precise log slicing:
- **Timeline → agent row click**: `WHERE run_id = X AND iteration = Y AND agent_name = Z`
- **Explorer → article detail**: `WHERE run_id = X AND variant_id = V`
- **Explorer → task (agent × run)**: `WHERE run_id = X AND agent_name = Z`

Logger writes to DB in real-time (or batched every N entries).

**Pros**: Streaming — logs visible while run is in progress. Queryable (filter by level, agent, time, iteration). No memory pressure. Cross-linkable to all UI views.
**Cons**: Requires migration. DB write overhead per log entry (~50-100 per iteration). Could be noisy for long runs.

#### Option 3: Hybrid — buffer + flush with streaming option

Buffer in memory like Option 1, but flush periodically (every iteration or every agent completion) to a JSONB array column. The admin UI polls the column to show live-ish updates.

**Pros**: Low write overhead (one UPDATE per flush, not per log entry). Live-ish visibility. No new table.
**Cons**: JSONB append is slightly awkward (read-modify-write), still limited by column size.

### Recommended: Option 2

A dedicated `evolution_run_logs` table is cleanest because:
1. **Live visibility** — logs appear as the run executes (critical for debugging running pipelines)
2. **Filterable** — admin UI can filter by level (`error` only), agent name, time range
3. **No memory pressure** — works for runs with thousands of log entries
4. **Cleanup** — can be pruned independently (e.g. delete logs older than 30 days)
5. **Matches existing pattern** — `evolution_checkpoints` and `evolution_run_agent_metrics` already follow this per-run table pattern

To reduce DB write overhead, batch writes (buffer 10-20 entries, flush in one INSERT).

### Admin UI Integration

Add a "Logs" tab to the run detail page (`run/[runId]/page.tsx`):
- Filter chips: All / Errors / Warnings / by agent name
- Auto-scroll with newest at bottom
- Auto-refresh every 5s while run status is `running`
- Show timestamp, level (color-coded), agent name, message, expandable context JSON

#### Cross-Linking: Timeline View → Logs

The Timeline view shows iterations (numbered sections) and agents within each iteration. Each should deep-link into filtered log views:

| Timeline Element | Log Filter | Query |
|-----------------|-----------|-------|
| Iteration section header (e.g. "Iteration 2") | All logs for that iteration | `WHERE run_id = X AND iteration = 2` |
| Agent row within iteration (e.g. "pairwise" in Iteration 2) | Agent logs scoped to iteration | `WHERE run_id = X AND iteration = 2 AND agent_name = 'pairwise'` |
| Agent row (standalone) | All logs for that agent across iterations | `WHERE run_id = X AND agent_name = 'pairwise'` |

Implementation: each iteration header and agent row gets a clickable icon/link that opens the Logs tab with pre-applied filters.

#### Cross-Linking: Explorer View → Logs

The Explorer view shows runs, articles (variants), and tasks (agent executions). Each should link to relevant logs:

| Explorer Element | Log Filter | Query |
|-----------------|-----------|-------|
| Run row | All logs for the run | `WHERE run_id = X` |
| Article/variant detail | Logs mentioning that variant | `WHERE run_id = X AND variant_id = V` |
| Task (agent execution) | Agent logs for that run | `WHERE run_id = X AND agent_name = Z` |

Implementation: Explorer rows get a "View Logs" action that navigates to the run detail Logs tab with filters pre-set via URL query params (e.g. `?tab=logs&run=<runId>&agent=pairwise&iteration=2&variant=<variantId>`). The `run` param is always present as the base filter; `agent`, `iteration`, and `variant` narrow further.

### Implementation Scope

| Step | Description | Effort |
|------|-------------|--------|
| 1 | Migration: create `evolution_run_logs` table | Small |
| 2 | Extend `createEvolutionLogger` to batch-write logs to DB | Medium |
| 3 | Server action: `getEvolutionRunLogsAction(runId, filters?)` | Small |
| 4 | Admin UI: "Logs" tab with filtering and auto-refresh | Medium |
| 5 | Retention: cleanup cron or TTL policy for old logs | Small |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- docs/feature_deep_dives/evolution_pipeline.md
- docs/feature_deep_dives/evolution_framework.md

### Planning Docs
- docs/planning/feat/rearchitect_evolution_into_framework_20260207/ (planning + progress)

## Code Files Read
- `src/lib/services/evolutionActions.ts` (full) — queueEvolutionRunAction, triggerEvolutionRunAction
- `src/app/api/cron/evolution-runner/route.ts` (full) — cron runner claim + execute flow
- `src/app/admin/quality/evolution/page.tsx` (full) — admin UI, StartRunCard + QueueDialog
- `scripts/run-evolution-local.ts` (full) — CLI runner, generateSeedArticle, --prompt flow
- `scripts/run-batch.ts` — batch script run creation
- `scripts/evolution-runner.ts` (full) — batch runner pickup, error handling gap
- `scripts/backfill-prompt-ids.ts` (full) — backfill script for prompt_id + strategy_config_id
- `src/app/api/cron/content-quality-eval/route.ts` — auto-queue path
- `src/lib/evolution/index.ts` (full) — preparePipelineRun, finalizePipelineRun, createDefaultAgents
- `src/lib/evolution/core/pipeline.ts` (full) — executeFullPipeline, autoLinkPrompt, feedHallOfFame, persistVariants
- `src/lib/evolution/types.ts` — AgentPayload, PipelineRunInputs type signatures
- `src/lib/services/runTriggerContract.test.ts` (full) — 8 test cases, gaps identified
- `src/__tests__/integration/evolution-actions.integration.test.ts` (full) — 12 integration tests
- `src/app/api/cron/evolution-runner/route.test.ts` (full) — 15 cron runner tests
- `src/testing/utils/evolution-test-helpers.ts` — factory functions
- `supabase/migrations/20260131000001_evolution_runs.sql` — original schema
- `supabase/migrations/20260131000008_evolution_runs_optional_explanation.sql` — DROP NOT NULL
- `supabase/migrations/20260131000009_variants_optional_explanation.sql` — variants nullable
- `supabase/migrations/20260207000002_prompt_fk_on_runs.sql` — prompt_id FK
- `supabase/migrations/20260207000008_enforce_not_null.sql` — safety-gated enforcement
- `supabase/migrations/20260208000001_enforce_prompt_title_strategy_name.sql` — field validation

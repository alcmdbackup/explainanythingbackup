# Questions About Evolution Pipeline Research

## Problem Statement
This project investigates key questions about the evolution pipeline system in ExplainAnything. The goal is to understand the code organization, determine whether the current stage/production infrastructure supports long-lived (20+ minute) evolution pipeline jobs, and fix a Sentry-reported LLM call tracking error.

## Requirements (from GH Issue #459)
1. Where do evolution code files live?
2. Does stage/production currently support long-lived (20 min+) evolution pipeline jobs?
3. Fix Sentry issue EXPLAINANYTHING-Y: `ServiceError: Failed to save LLM call tracking`

## High Level Summary
The evolution pipeline is a self-contained subsystem under `src/lib/evolution/` with its own agent framework, rating system, and pipeline orchestrator. Code spans ~14 core modules, 14 agents, 5 CLI scripts, 3 cron routes, and extensive admin UI. For long-lived jobs: single Vercel invocations are capped at ~13 min (800s Pro timeout), but the pipeline supports continuation-passing (checkpoint + resume on next cron cycle, up to 10 continuations). The GitHub Actions batch runner has a 7-hour timeout and is the primary path for 20+ minute jobs.

A Sentry error was identified where `feedHallOfFame()` passes `'system'` as a userid to LLM call tracking, but the DB column `llmCallTracking.userid` is typed `uuid NOT NULL`. There is also an inconsistency where `callOpenAIModel` lets tracking errors crash callers while `callAnthropicModel` handles them gracefully.

---

## Finding 1: Evolution Code File Locations

The evolution system is a self-contained subsystem with its own agent framework, rating system, and pipeline orchestrator — deliberately isolated from the main ExplainAnything codebase.

### Core Pipeline (`src/lib/evolution/core/`)
| File | Purpose |
|------|---------|
| `pipeline.ts` | Pipeline orchestrator (~751 LOC) — `executeMinimalPipeline` and `executeFullPipeline` |
| `supervisor.ts` | `PoolSupervisor` — EXPANSION→COMPETITION transitions, phase config, stopping conditions |
| `state.ts` | `PipelineStateImpl` — mutable state with append-only pool, serialization for checkpoints |
| `rating.ts` | OpenSkill (Weng-Lin Bayesian) rating wrapper |
| `costTracker.ts` | Per-agent budget attribution, pre-call reservation with 30% margin |
| `comparisonCache.ts` | Order-invariant SHA-256 cache for comparison results |
| `pool.ts` | Stratified opponent selection (ordinal quartile-based) |
| `diversityTracker.ts` | Lineage dominance detection, strategy diversity analysis |
| `validation.ts` | State contract guards |
| `llmClient.ts` | Wraps `callLLM` with budget enforcement and structured JSON output |
| `logger.ts` | Console + DB log buffer (batches writes to `evolution_run_logs`) |
| `budgetRedistribution.ts` | Agent classification, budget cap redistribution |
| `configValidation.ts` | Config validation (`validateStrategyConfig`, `validateRunConfig`) |
| `persistence.ts` | Checkpoint upsert, variant persistence, run status transitions |
| `metricsWriter.ts` | Strategy config linking, cost prediction, per-agent cost metrics |
| `hallOfFameIntegration.ts` | Hall of Fame topic/entry linking and variant feeding |
| `pipelineUtilities.ts` | Agent invocation persistence and execution detail truncation |
| `textVariationFactory.ts` | Shared `createTextVariation()` factory |
| `critiqueBatch.ts` | Shared utility for running LLM critique call batches |
| `reversalComparison.ts` | Generic 2-pass reversal runner |
| `formatValidationRules.ts` | Shared format validation rules |
| `jsonParser.ts` | Shared `extractJSON<T>()` for parsing JSON from LLM responses |
| `costEstimator.ts` | Data-driven cost predictions |
| `adaptiveAllocation.ts` | ROI-based budget allocation |
| `strategyConfig.ts` | Strategy hashing and labeling |

### Agents (`src/lib/evolution/agents/`)
| File | Purpose |
|------|---------|
| `base.ts` | Abstract `AgentBase` class (execute/estimateCost/canExecute contract) |
| `generationAgent.ts` | 3 variants/iteration: structural_transform, lexical_simplify, grounding_enhance |
| `calibrationRanker.ts` | Pairwise comparison for new entrants against stratified opponents |
| `pairwiseRanker.ts` | Full pairwise comparison (simple and structured modes) |
| `tournament.ts` | Swiss-style tournament with info-theoretic pairing |
| `evolvePool.ts` | Genetic evolution — mutation, crossover, creative exploration |
| `reflectionAgent.ts` | Dimensional critique of top 3 variants (5 dimensions, scores 1-10) |
| `iterativeEditingAgent.ts` | Critique-driven surgical edits with blind diff-based LLM judge |
| `treeSearchAgent.ts` | Beam search tree-of-thought revisions |
| `sectionDecompositionAgent.ts` | H2 section decomposition with parallel critique-edit-judge |
| `debateAgent.ts` | 3-turn structured debate producing synthesis variant |
| `outlineGenerationAgent.ts` | Outline-based generation: 6-call pipeline |
| `metaReviewAgent.ts` | Strategy performance analysis (computation-only, no LLM) |
| `proximityAgent.ts` | Cosine similarity, sparse matrix, pool diversity score |
| `formatValidator.ts` | Format validation (H1, headings, no bullets/tables, paragraph quality) |

### Shared Modules (`src/lib/evolution/`)
| File | Purpose |
|------|---------|
| `comparison.ts` | `compareWithBiasMitigation()` — 2-pass A/B reversal with caching |
| `diffComparison.ts` | CriticMarkup diff-based comparison for edit judging |
| `config.ts` | `DEFAULT_EVOLUTION_CONFIG`, `resolveConfig()` for deep-merging overrides |
| `types.ts` | All shared TypeScript types/interfaces |
| `index.ts` | Barrel export — `createDefaultAgents()`, `preparePipelineRun()`, `finalizePipelineRun()` |

### Tree of Thought (`src/lib/evolution/treeOfThought/`)
- `types.ts`, `treeNode.ts`, `beamSearch.ts`, `revisionActions.ts`, `evaluator.ts`, `index.ts`

### Section Decomposition (`src/lib/evolution/section/`)
- `sectionParser.ts`, `sectionStitcher.ts`, `sectionEditRunner.ts`, `sectionFormatValidator.ts`, `types.ts`

### Strategy Experiments (`src/lib/experiments/evolution/`)
- `factorial.ts` — L8 orthogonal array generation
- `analysis.ts` — Main effects, interactions, ranking, recommendations

### Server Actions (outside `src/lib/evolution/`)
| File | Purpose |
|------|---------|
| `src/lib/services/evolutionActions.ts` | 9 actions: queue, trigger, get runs/variants/summary, apply winner, rollback, cost breakdown, history |
| `src/lib/services/evolutionVisualizationActions.ts` | 9 viz actions: timeline, Elo, lineage, budget, comparison, step scores, tree search, invocation detail |
| `src/lib/services/evolutionBatchActions.ts` | GitHub Actions batch dispatch |
| `src/lib/services/hallOfFameActions.ts` | 14 actions for Hall of Fame CRUD, comparison, aggregation |
| `src/lib/services/costAnalyticsActions.ts` | Cost accuracy analytics |
| `src/lib/services/eloBudgetActions.ts` | Dashboard data queries for optimization |
| `src/lib/services/llmSemaphore.ts` | Counting semaphore for concurrent LLM call throttling |
| `src/lib/services/contentQualityActions.ts` | `getEvolutionComparisonAction` — before/after quality scores |

### Admin UI
| Path | Purpose |
|------|---------|
| `src/app/admin/evolution-dashboard/` | Overview dashboard with stat cards and quick links |
| `src/app/admin/quality/evolution/page.tsx` | Run management, variant preview, apply/rollback |
| `src/app/admin/quality/evolution/run/[runId]/page.tsx` | Run detail: 5-tab deep dive (Timeline, Elo, Lineage, Variants, Logs) |
| `src/app/admin/quality/evolution/run/[runId]/compare` | Before/after text diff |
| `src/app/admin/quality/optimization/page.tsx` | Cost optimization dashboard (3 tabs) |
| `src/app/admin/quality/hall-of-fame/page.tsx` | Hall of Fame topic list |
| `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` | Topic detail (4-tab layout) |
| `src/components/evolution/` | Reusable components (status badges, sparklines, lineage graph, tabs, agent detail views) |

### CLI Scripts
| File | Purpose |
|------|---------|
| `scripts/evolution-runner.ts` | Batch runner: claims pending runs, parallel support, heartbeat, graceful shutdown |
| `scripts/run-evolution-local.ts` | Local CLI: mock/real LLM, --full, --prompt, --bank |
| `scripts/run-strategy-experiment.ts` | Strategy experiment CLI (plan/run/analyze/status) |
| `scripts/run-prompt-bank.ts` | Batch generation across prompts x methods |
| `scripts/run-prompt-bank-comparisons.ts` | Batch all-pairs comparisons |
| `scripts/run-hall-of-fame-comparison.ts` | Single-topic pairwise comparison CLI |
| `scripts/add-to-hall-of-fame.ts` | Add evolution run winner to Hall of Fame |
| `scripts/generate-article.ts` | Standalone article generation with --bank flag |
| `scripts/run-batch.ts` | JSON-driven batch experiment execution |

### Cron Routes
| File | Purpose |
|------|---------|
| `src/app/api/cron/evolution-runner/route.ts` | Background runner: polls for pending runs, 30s heartbeat |
| `src/app/api/cron/evolution-watchdog/route.ts` | Marks stale runs (heartbeat > 10min) as failed, every 15 min |
| `src/app/api/cron/content-quality-eval/route.ts` | Auto-queues articles scoring < 0.4 (max 5/cron, $3 budget each) |

### GitHub Actions
- `.github/workflows/evolution-batch.yml` — Weekly batch (Mondays 4am UTC), manual dispatch, 7-hour timeout

---

## Finding 2: Long-Lived (20+ min) Evolution Pipeline Job Support

### Short Answer
Not directly as a single continuous Vercel invocation, but yes via two mechanisms: continuation-passing (serverless) and GitHub Actions batch runner (long-lived process).

### Vercel Serverless Timeout
- Vercel Pro timeout: **800 seconds (~13 minutes)** per invocation
- A single invocation **cannot** run 20+ minutes on Vercel

### Mechanism A: Continuation-Passing (Serverless)
The pipeline checkpoints state and yields before timeout, then the cron runner resumes on the next cycle:

1. **Per-iteration time-check**: adaptive safety margin `min(120s, max(60s, 10% elapsed))`
2. **If timeout approaching** → `checkpointAndMarkContinuationPending()` via atomic RPC
3. **Status transitions**: `running → continuation_pending`
4. **Next cron cycle**: `claim_evolution_run` RPC prioritizes `continuation_pending` over `pending`
5. **Resume**: Cron runner loads latest checkpoint, restores supervisor state (phase, rotation index, history)

**Guard rails:**
- Max 10 continuations per run (prevents infinite loops)
- Watchdog marks stale `continuation_pending` runs as `failed` after 30 minutes
- Defense-in-depth: watchdog checks for recent checkpoint before marking stale `running` runs

**For a 20-min job**: Would need ~2 continuations (13 min + 7 min), assuming the cron runner picks it up promptly. Total wall-clock time depends on cron frequency.

### Mechanism B: GitHub Actions Batch Runner
- File: `.github/workflows/evolution-batch.yml`
- **Timeout: 7 hours** — fully supports 20+ minute jobs in a single continuous process
- Runs `scripts/evolution-runner.ts` which claims pending runs and executes the full pipeline
- Supports `--parallel N` for concurrent execution, `--max-runs N` for total cap
- Scheduled weekly (Mondays 4am UTC) with manual dispatch option
- Concurrency group prevents parallel workflow runs

### Mechanism C: Admin Inline Trigger
- `triggerEvolutionRunAction` from the admin UI triggers execution within a Vercel serverless function
- Subject to the same ~13 min timeout
- Also uses continuation-passing for jobs that exceed the limit

### Cron Frequency (Resolved)
From `vercel.json`:
- `evolution-runner`: every 5 minutes (`*/5 * * * *`)
- `evolution-watchdog`: every 15 minutes (`*/15 * * * *`)
- `content-quality-eval`: every 6 hours (`0 */6 * * *`)

Note: Vercel crons **only run on the production deployment**. Preview/staging deployments do NOT execute crons.

---

## Finding 3: Sentry Issue EXPLAINANYTHING-Y — LLM Call Tracking Error

### Issue Details
- **Error**: `ServiceError: Failed to save LLM call tracking`
- **Sentry ID**: EXPLAINANYTHING-Y
- **Events**: 2 (first seen 2026-02-17T00:09:15Z)
- **Environment**: development (local dev server)
- **Culprit**: `saveLlmCallTracking` in `src/lib/services/llms.ts:2591`

### Call Chain
```
executeFullPipeline
  → finalizePipelineRun
    → feedHallOfFame (hallOfFameIntegration.ts)
      → runHallOfFameComparisonInternal(topicId, 'system', 'gpt-4.1-nano', 1)
        → callLLM wrapper passes 'system' as userid
          → callLLMModel(prompt, 'bank_comparison', 'system', ...)
            → callOpenAIModel
              → saveLlmCallTracking({ userid: 'system', ... })
                → Supabase INSERT fails: 'system' is not a valid UUID
```

### Root Cause: Non-UUID userid

**Database schema** (`supabase/migrations/20251109053825_fix_drift.sql:66`):
```sql
"userid" uuid not null
```

**Bug location** (`src/lib/evolution/core/hallOfFameIntegration.ts:204`):
```typescript
const result = await runHallOfFameComparisonInternal(topicId, 'system', 'gpt-4.1-nano', 1);
```

The string `'system'` is not a valid UUID. PostgreSQL rejects the insert.

### Userid Patterns Across the Codebase

The codebase has **two system UUID constants** that are properly defined:

| Constant | Value | Location | Used By |
|----------|-------|----------|---------|
| `ANONYMOUS_USER_UUID` | `00000000-0000-0000-0000-000000000000` | `src/lib/services/llms.ts:39` (exported) | Editor defaults, test data, CLI scripts |
| `EVOLUTION_SYSTEM_USERID` | `00000000-0000-4000-8000-000000000001` | `src/lib/evolution/core/llmClient.ts:15` (private) | Evolution pipeline agent LLM calls |

All other callers pass real user UUIDs from Supabase auth or `requireAdmin()`. The `'system'` string in `hallOfFameIntegration.ts:204` is the **only** non-UUID userid in the entire codebase.

### Correct Pattern (Already Used by Evolution Pipeline)

The evolution pipeline's own LLM client (`src/lib/evolution/core/llmClient.ts`) correctly uses a system UUID:
```typescript
const EVOLUTION_SYSTEM_USERID = '00000000-0000-4000-8000-000000000001';
// Used in complete() line 57 and completeStructured() line 93
```

### Secondary Bug: Inconsistent Error Handling in `saveLlmCallTracking`

| LLM Provider Path | Error Handling | Line | Behavior |
|---|---|---|---|
| `callOpenAIModel` (also handles DeepSeek) | **No try-catch** | `llms.ts:298` | Tracking error propagates up and crashes caller |
| `callAnthropicModel` | **Has try-catch** | `llms.ts:456-464` | Tracking error logged as non-fatal, execution continues |

The `callOpenAIModel` path (line 298):
```typescript
await saveLlmCallTracking(trackingData);  // NO TRY-CATCH — error propagates
```

The `callAnthropicModel` path (lines 456-464):
```typescript
try {
    await saveLlmCallTracking(trackingData);
} catch (trackingError) {
    logger.error('LLM call tracking save failed (non-fatal)', { ... });
}
```

This means: if the same tracking bug occurred with an Anthropic model, the LLM response would still be returned. With OpenAI/DeepSeek, the caller loses the LLM response entirely.

### Zod Schema Gap

The Zod schema (`src/lib/schemas/schemas.ts:557-570`) validates `userid` as `z.string()` rather than `z.string().uuid()`. This allows non-UUID strings to pass validation, deferring the error to the database layer.

### Impact Assessment

**Current impact (development only):**
- Sentry error triggered on local dev server
- The `feedHallOfFame` auto re-rank call fails, but it's wrapped in try-catch (`hallOfFameIntegration.ts:210`), so the **pipeline run itself completes** — the error is non-fatal to the pipeline
- Hall of Fame Elo rankings don't update after pipeline runs

**Production risk:**
- The evolution cron runs **every 5 minutes in production** (`vercel.json`)
- `feedHallOfFame()` is called at the end of every pipeline run
- The same bug **will trigger in production** whenever a pipeline run completes and feeds the Hall of Fame
- The Anthropic model inconsistency could mask related issues in production if a different model is used

### Environment Deployment Context

| Environment | Evolution Pipeline Runs? | This Bug Triggers? |
|---|---|---|
| **Production (Vercel)** | Yes — cron every 5 min | **Yes** — same `feedHallOfFame` code path |
| **Preview/Staging (Vercel)** | No — crons disabled on preview | No |
| **GitHub Actions Batch** | Yes — weekly or manual | **Yes** — same code path |
| **Local Dev** | Yes — manual admin UI | **Yes** — confirmed via Sentry |

### Proposed Fixes

**Fix 1: Replace `'system'` with `EVOLUTION_SYSTEM_USERID`** (hallOfFameIntegration.ts:204)
- Import `EVOLUTION_SYSTEM_USERID` from `llmClient.ts` (needs to be exported first)
- Or import `ANONYMOUS_USER_UUID` from `llms.ts` (already exported)
- Preferred: use `EVOLUTION_SYSTEM_USERID` since this is an evolution pipeline context

**Fix 2: Wrap `saveLlmCallTracking` in try-catch in `callOpenAIModel`** (llms.ts:298)
- Match the Anthropic path's non-fatal handling
- Tracking is an observability concern and should never abort an LLM response

**Fix 3: Tighten Zod validation** (schemas.ts:558)
- Change `userid: z.string()` to `userid: z.string().uuid()`
- Catches invalid userids at validation time with a clear error message

### Files to Modify

| File | Change |
|------|--------|
| `src/lib/evolution/core/llmClient.ts` | Export `EVOLUTION_SYSTEM_USERID` |
| `src/lib/evolution/core/hallOfFameIntegration.ts` | Import and use `EVOLUTION_SYSTEM_USERID` instead of `'system'` |
| `src/lib/services/llms.ts` | Wrap `saveLlmCallTracking` in try-catch in `callOpenAIModel` (line ~298) |
| `src/lib/schemas/schemas.ts` | Change `userid: z.string()` → `userid: z.string().uuid()` |

### Tests to Update

| File | Change |
|------|--------|
| `src/lib/evolution/core/hallOfFameIntegration.test.ts` | Update mock to expect UUID instead of `'system'` |
| `src/lib/schemas/schemas.test.ts` | Add test for UUID validation on `llmCallTrackingSchema.userid` |
| `src/lib/services/llms.ts` tests (if any) | Test that `callOpenAIModel` returns LLM response even when tracking fails |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- docs/evolution/README.md
- docs/evolution/architecture.md
- docs/evolution/data_model.md
- docs/evolution/reference.md
- docs/evolution/rating_and_comparison.md
- docs/evolution/hall_of_fame.md
- docs/evolution/strategy_experiments.md
- docs/evolution/cost_optimization.md
- docs/evolution/visualization.md

## Code Files Read
- `src/lib/services/llms.ts` — `saveLlmCallTracking`, `callOpenAIModel`, `callAnthropicModel`, `ANONYMOUS_USER_UUID`
- `src/lib/schemas/schemas.ts` — `llmCallTrackingSchema` (userid validation)
- `src/lib/evolution/core/hallOfFameIntegration.ts` — `feedHallOfFame` (bug location: line 204)
- `src/lib/evolution/core/llmClient.ts` — `EVOLUTION_SYSTEM_USERID` constant
- `src/lib/services/hallOfFameActions.ts` — `runHallOfFameComparisonInternal`, `callLLM` wrapper
- `supabase/migrations/20251109053825_fix_drift.sql` — `llmCallTracking` table schema (`userid uuid NOT NULL`)
- `supabase/migrations/20260116061036_add_llm_cost_tracking.sql` — cost tracking column addition
- `vercel.json` — cron configuration (every 5/15 min, every 6 hours)

# Fix Uninitialized Evolution Run Plan

## Background
Make sure that created evolution runs have an explanation id and then get picked up appropriately.

## Problem
Run `12fb16de` is stuck in `pending` with `explanation_id = NULL`. The admin UI's "Start New Pipeline" card creates runs with only `promptId` + `strategyId` (no `explanationId`), which is valid for the new prompt-based framework. However, all three pickup mechanisms (cron runner, batch runner, inline trigger) assume `explanation_id` is set and fail when it's null — the cron marks it `failed`, the batch runner orphans it as `claimed`, and the inline trigger returns an error. The pipeline core itself is null-safe and would work fine if `originalText` were provided. The CLI already has `generateSeedArticle()` that generates articles from prompts, but this pattern hasn't been lifted into the production runners.

## Options Considered

### Option A: Require explanation_id for production runs (short-term guard)
- Validate `explanationId` is present for `source='explanation'` runs
- Add DB CHECK constraint
- Make cron skip null explanation_id runs
- **Pro**: Minimal code changes, prevents bad state
- **Con**: Doesn't enable prompt-based runs — just prevents them from being created

### Option B: Enable prompt-based execution in runners (complete the framework)
- Teach cron/batch runners to generate seed articles from prompts
- Fix type signatures to allow `explanationId: number | null`
- **Pro**: Completes the ~80% built framework, enables the full vision
- **Con**: More code to write and test

### Option C (Chosen): Hybrid — Fix + Enable
Since the framework is 80% built and the CLI already has the `generateSeedArticle` pattern, we complete the last 20% in the cron runner while also adding validation guardrails. Batch runner gets error cleanup but not prompt execution (it's a script, not the primary path). DB CHECK constraint deferred to avoid migration coordination.

## Phased Execution Plan

### Phase 1: Type Fixes & Validation Guardrails
**Goal**: Correct types, add validation so invalid states can't be created.

#### 1a. Fix type signatures
- `src/lib/evolution/types.ts`: Change `AgentPayload.explanationId` from `number` to `number | null`
- `src/lib/evolution/index.ts`: Change `PipelineRunInputs.explanationId` from `number` to `number | null`
- **Additional interfaces to update** (all have `explanation_id: number` that must become `number | null`):
  - `EvolutionRun` in `evolutionActions.ts:19`
  - `EvolutionVariant` in `evolutionActions.ts:39`
  - `DashboardRun` in `evolutionVisualizationActions.ts:38`
  - `ClaimedRun` in `scripts/evolution-runner.ts:41`
- Fix any downstream type errors these changes surface (expect ~4-6 call sites needing null guards)
- **Note**: CLI's `explanationId: args.explanationId ?? 0` pattern is preserved as-is — `0` is functionally equivalent to `null` in pipeline guards

#### 1b. Tighten queueEvolutionRunAction validation + set source correctly
- In `evolutionActions.ts`, after the existing either/or check, add: if no `explanationId` and no `promptId`, reject (already the case — keep)
- **Set `source` column on insert**: when `explanationId` is provided, set `source: 'explanation'`; when only `promptId`, fetch prompt title from `hall_of_fame_topics` and set `source: 'prompt:<title>'`
- This prevents prompt-only runs from getting the default `source='explanation'` which is semantically wrong

#### 1c. Inline trigger scope reduction
- `triggerEvolutionRunAction` is an admin manual-trigger for existing runs. Rather than adding seed generation here (which requires an LLM client not available in server action context), **scope this to explanation-based runs only**:
  - If `explanation_id` is null, return `{ success: false, error: 'Prompt-based runs must be executed via the cron runner. Use the cron to pick up this run.' }` with a clear message
  - This avoids the architectural problem of needing an LLM client factory in a server action
  - The cron runner is the intended execution path for prompt-based runs

**Tests**: Unit tests for validation edge cases in `runTriggerContract.test.ts`

### Phase 2: Cron Runner Prompt-Based Execution
**Goal**: The cron runner can execute runs with null `explanation_id` if `prompt_id` is set.

#### 2a. Extract `generateSeedArticle` into shared utility
- Move the core logic from `scripts/run-evolution-local.ts:550-580` into `src/lib/evolution/core/seedArticle.ts` (matches camelCase naming convention of `costTracker.ts`, `llmClient.ts`, etc.)
- Strip CLI-specific dependencies (commander args, console.log). Keep only the pure logic: prompt → LLM title call → LLM article call → return `{title, content}`
- **Function signature**: `generateSeedArticle(promptText: string, llmClient: EvolutionLLMClient, logger: EvolutionLogger): Promise<{title: string, content: string}>`
  - Accepts LLM client + logger as parameters (same pattern as pipeline agents)
  - Model selection handled by whichever LLM client is passed in
  - Internally calls `createTitlePrompt()` from `src/lib/prompts.ts` and `createExplanationPrompt()`, parsing title via `titleQuerySchema` from `src/lib/schemas/schemas.ts`
- **Error handling**: wrap both LLM calls in try/catch; on failure, throw a standard `Error` with descriptive message including context (prompt text truncated to 200 chars, original error message). Caller decides whether to `markRunFailed()` or retry. No custom error class needed — a descriptive message is sufficient
- **CLI callsite update**: The existing CLI function takes 4 params `(prompt, seedModel, llmClient, logger)`. The extracted utility drops `seedModel` because model selection is encapsulated in the LLM client. Update the CLI callsite at `run-evolution-local.ts:666` to pre-configure the LLM client with the desired seed model before passing it, then call with 3 args: `generateSeedArticle(prompt, seedClient, logger)`. The `seedClient` is already created separately at the CLI level with the seed model
- Keep the CLI importing from the shared location, updating `run-evolution-local.ts` to `import { generateSeedArticle } from '../src/lib/evolution/core/seedArticle'`

#### 2b. Update cron runner to handle prompt-based runs
- **Control flow**: After claiming a run, resolve `originalText` and `title` via one of two branches. Both branches are wrapped in their own try/catch that calls `markRunFailed()` + returns early (400 response) on error. This is critical because content resolution happens before `status='running'` — the outer pipeline catch at line 161-178 uses `.eq('status', 'running')` and would miss failures at the `claimed` stage. **Do NOT re-throw** from the content resolution try/catch — return the 400 response directly so the outer pipeline block is never entered
- **Check feature flag**: inside the null-explanation branch (after determining `explanation_id` is null), read `prompt_based_evolution_enabled` from feature flags. If `false`, call `markRunFailed()` with "Prompt-based evolution temporarily disabled" and return 400. This check happens after claiming but only for prompt-based runs — explanation-based runs are never affected. Code should treat a missing flag row as default `true`
- In `route.ts`, after claiming a run, branch on `explanation_id`:
  - **If `explanation_id` is set** (existing path): fetch explanation content as before, set `originalText = explanation.content`, `title = explanation.explanation_title`
  - **If `explanation_id` is null and `prompt_id` is set**: look up prompt text from `hall_of_fame_topics` by `prompt_id`, create LLM client via `createEvolutionLLMClient()`, call `generateSeedArticle(promptText, llmClient, logger)`, set `originalText = seed.content`, `title = seed.title`
  - **If `explanation_id` is null and `prompt_id` is null**: call `markRunFailed(supabase, runId, 'Run has no explanation_id and no prompt_id')` and return 400
- Pass `explanationId: null` to `preparePipelineRun` (type now allows it). Concretely: `preparePipelineRun({ runId, originalText, title, explanationId: null, configOverrides: pendingRun.config ?? {} })`

#### 2c. Update cron runner query and configure timeout
- Add `prompt_id` to the SELECT in the pending run query (currently only selects `id, explanation_id, config, budget_cap_usd`)
- **Add `maxDuration` export** to `route.ts`: `export const maxDuration = 300;` (5 minutes — Vercel Pro allows up to 300s). Seed generation adds ~10-30s of LLM calls before the pipeline's own LLM calls begin. The existing pipeline already takes 1-3 minutes, so the total needs headroom
- Note: the heartbeat interval (30s) starts after `preparePipelineRun()` — seed generation runs without heartbeat, but the try/catch in 2b ensures cleanup on failure

**Tests**:
- New test in `route.test.ts`: cron claims run with null explanation_id + valid prompt_id → generates seed → executes pipeline
- New test: cron claims run with null explanation_id + null prompt_id → marks failed
- **Mock strategy**: mock `generateSeedArticle` at module level (`jest.mock('../../../lib/evolution/core/seedArticle')`) returning `{title: 'Test Title', content: '# Test\n\nContent...'}`. Do NOT mock LLM calls directly — mock the utility function

### Phase 3: Batch Runner Error Cleanup
**Goal**: Fix the silent failure bug so orphaned `claimed` runs don't accumulate.

#### 3a. Add error cleanup to batch runner
- In `scripts/evolution-runner.ts:185-187`, after catching error in `executeRun()`:
  - Update run `status='failed'`
  - Clear `runner_id=null`
  - Store `error_message`
- Implement as a local `markRunFailed(supabase, runId, errorMessage)` function (batch runner uses its own `createClient()`, not the service client from the cron runner, so import the pattern, not the function)
- Also add a null `explanation_id` guard at the top of `executeRun()`: if `run.explanation_id` is null, call the new `markRunFailed()` and return. Batch runner does not support prompt-based runs (out of scope)

**Tests**: Add `scripts/evolution-runner.test.ts` with a focused test: mock `fetchOriginalText` to throw → verify `markRunFailed` is called → verify run status updated to `failed`

### Phase 4: Clean Up Stuck Run & Add Missing Tests
**Goal**: Resolve the immediate production issue and close test gaps.

#### 4a. Clean up stuck run `12fb16de`
- **Approach**: manual DB update via Supabase dashboard (not a migration — this is a one-time data fix for a specific run)
- Document the SQL in the PR description:
  ```sql
  UPDATE content_evolution_runs
  SET status = 'failed',
      error_message = 'Manually resolved: created without explanation_id before prompt execution path existed'
  WHERE id = '12fb16de' AND status = 'pending';
  ```
- No automated test needed — this is a manual data fix, not a code path

#### 4b. Add missing test cases
- `runTriggerContract.test.ts`: Queue with `promptId` only (no `explanationId`) — verify run created with null explanation_id
- `route.test.ts`: Cron runner with null `explanation_id` + null `prompt_id` → marks failed
- `route.test.ts`: Cron runner with null `explanation_id` + valid `prompt_id` → generates seed article → pipeline succeeds
- `route.test.ts`: Inline trigger with null `explanation_id` → returns error message about cron runner
- **Update test helpers**:
  - Change `createTestEvolutionRun(supabase, explanationId: number, overrides?)` signature to `createTestEvolutionRun(supabase, explanationId: number | null, overrides?)` so tests can create prompt-only runs
  - Change `createTestVariant` similarly — it also has `explanationId: number` as required
  - Update `cleanupEvolutionData` to also accept optional `runIds: string[]` parameter — when provided, delete runs by ID directly (for prompt-only runs that have `explanation_id=NULL` and won't be matched by the existing `.in('explanation_id', ...)` query)

#### 4c. `generateSeedArticle` unit tests
- `src/lib/evolution/core/seedArticle.test.ts`:
  - Happy path: mock LLM client returns valid title JSON + article markdown → returns `{title, content}`
  - Title parse failure: mock LLM returns non-JSON → verify fallback title extraction or SeedGenerationError
  - LLM timeout/error: mock LLM throws → verify SeedGenerationError with context

### Phase 5: Documentation Updates
- Update `docs/feature_deep_dives/evolution_pipeline.md` — document the prompt-based execution path
- Update `docs/feature_deep_dives/evolution_framework.md` — document that prompt-based runs are now executable, inline trigger limitation

## Rollback & Feature Flag Strategy
- **Rollback**: if prompt-based execution causes issues in production, the fix is backwards-compatible. Existing explanation-based runs are unaffected by the changes. The only new code path triggers when `explanation_id IS NULL AND prompt_id IS NOT NULL`
- **Emergency disable**: add a feature flag `prompt_based_evolution_enabled` (default `true`). If set to `false`, the cron runner treats null-explanation + prompt runs the same as null-explanation + null-prompt: marks failed with message "Prompt-based evolution temporarily disabled"
- **Implementation**: In Phase 2b, add the flag check at the top of the prompt-based branch. Also add to `EvolutionFeatureFlags` interface in `featureFlags.ts` and to `FLAG_MAP`. Insert a row in the `feature_flags` table via migration or manual insert (default `true`)
- **The existing `dryRunOnly` flag** skips ALL execution — too broad for this. The new flag is surgical

## Testing

### Unit Tests to Write
| Test | File | Validates |
|------|------|-----------|
| Queue with promptId only | `runTriggerContract.test.ts` | Run created, explanation_id null, source set correctly |
| Cron: null explanation + valid prompt | `route.test.ts` | generateSeedArticle called, pipeline executed |
| Cron: null explanation + null prompt | `route.test.ts` | Run marked failed |
| Cron: seed generation failure | `route.test.ts` | markRunFailed called while status='claimed' (before 'running'), run transitions claimed→failed |
| Inline trigger: null explanation | `route.test.ts` or trigger test | Returns error about cron runner |
| generateSeedArticle happy path | `seedArticle.test.ts` | Returns {title, content} |
| generateSeedArticle LLM failure | `seedArticle.test.ts` | Throws SeedGenerationError |
| Batch runner error cleanup | `evolution-runner.test.ts` | Run status → failed on error |
| Feature flag disabled | `route.test.ts` | Prompt run marked failed when flag off |

### Mock Strategy
- `generateSeedArticle` → mock at module boundary in cron runner tests
- LLM client → mock in `seedArticle.test.ts` unit tests only
- Supabase → continue existing mock chain pattern from `route.test.ts`

### Existing Tests to Verify Still Pass
- All 8 tests in `runTriggerContract.test.ts`
- All 12 tests in `route.test.ts`
- All 12 integration tests in `evolution-actions.integration.test.ts`

### Manual Verification
- Queue a prompt-based run from the "Start New Pipeline" UI
- Verify cron picks it up, generates seed article, runs pipeline to completion
- Verify run transitions: `pending → claimed → running → completed`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/evolution_pipeline.md` - Document prompt-based execution path
- `docs/feature_deep_dives/evolution_framework.md` - Update NOT NULL enforcement section, document that prompt runs are now executable

## Out of Scope (Deferred)
- DB CHECK constraint on `explanation_id` vs `source` — requires migration coordination
- Batch runner prompt-based execution — batch runner is a script, not the primary pickup path
- Admin UI pages for prompt/strategy management — server actions exist, UI deferred
- Updating legacy insert paths (Queue for Evolution dialog, auto-queue cron, CLI, batch) to set `prompt_id`/`strategy_config_id` — needed before migration 20260207000008 can run, but separate concern
- Prompt text sanitization before LLM calls — admin-only surface, low risk, tracked as future hardening

## Future: Per-Run Logging with Cross-Linking

### Motivation
When pipeline runs fail (e.g. "budget exceeded"), there's no way to inspect what happened from the admin UI. Logs go to `server.log`, Honeycomb, and Sentry — none queryable per-run. The `error_message` column captures only the final error, and `run_summary` JSONB has analytics but no execution trace.

### Proposed Architecture
A dedicated `evolution_run_logs` table with columns that enable cross-linking to the admin UI's Timeline and Explorer views:

```sql
CREATE TABLE evolution_run_logs (
  id BIGSERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES content_evolution_runs(id),
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

### Cross-Linking Requirements

#### Timeline View → Logs
The Timeline shows iterations and agents. Each element should deep-link to filtered logs:
- **Iteration header** (e.g. "Iteration 2") → `WHERE run_id = X AND iteration = 2`
- **Agent row** (e.g. "pairwise" in Iteration 2) → `WHERE run_id = X AND iteration = 2 AND agent_name = 'pairwise'`

#### Explorer View → Logs
The Explorer shows runs, articles (variants), and tasks. Each should link to logs:
- **Run row** → `WHERE run_id = X` (all logs)
- **Article/variant detail** → `WHERE run_id = X AND variant_id = V`
- **Task (agent execution)** → `WHERE run_id = X AND agent_name = Z`

#### URL-Based Filter Passing
Navigate between views using query params: `?tab=logs&run=<runId>&agent=pairwise&iteration=2&variant=<variantId>`

All filters are composable — `run` is always present as the base filter, with `agent`, `iteration`, and `variant` narrowing further.

### Implementation Steps
1. Migration: create `evolution_run_logs` table with indexes
2. Extend `createEvolutionLogger` to batch-write logs to DB (buffer 10-20 entries, flush in one INSERT)
3. Server action: `getEvolutionRunLogsAction(runId, filters?)` with pagination
4. Admin UI: "Logs" tab on run detail page with filter chips, auto-refresh, color-coded levels
5. Cross-link buttons on Timeline iterations/agents and Explorer runs/articles/tasks
6. Retention: cleanup cron or TTL policy for old logs (e.g. 30 days)

### Research Reference
Full analysis in research doc section "Per-Run Logging for Admin UI".

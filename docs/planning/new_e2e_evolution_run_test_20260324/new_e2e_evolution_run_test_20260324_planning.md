# New E2E Evolution Run Test Plan

## Background
Design a comprehensive E2E test that runs on production PRs (via `@evolution` tag in `e2e-evolution` CI job), testing that an evolution run can be created via experiment and successfully runs to completion using real LLM calls. The test verifies metrics computation (run, experiment, strategy), arena sync, experiment auto-completion, and that metrics render correctly in the admin UI. Max budget: $0.02 per run.

**CI scope**: `@evolution` tagged tests run on PRs to `production` only (not `main`). This is intentional — real LLM calls are too expensive/slow for every PR to main. The `e2e-critical` job for main PRs uses `@critical` tag only.

## Requirements (from GH Issue #813)
- E2E test that runs on production merges (via `@evolution` tag)
- Creates experiment → queues run → executes with real LLM calls → verifies completion
- Max budget: $0.02 per run
- Verifies: metrics correctly calculated, arena sync works, experiment auto-completes
- Metrics render correctly on run, experiment, and strategy detail pages
- Test must clean up all created data after itself
- As comprehensive as possible within budget constraints

## Problem
There is no E2E test that exercises the full evolution pipeline end-to-end with real LLM calls. All existing evolution E2E tests seed static data and verify UI rendering — none actually trigger pipeline execution. Additionally, no API route exists for triggering evolution runs; runs are only executed via the CLI batch runner script. This means we need both a new API route and a new comprehensive E2E test spec.

## Options Considered

### Option A: Subprocess approach — spawn `processRunQueue.ts`
- **Pros**: No new API route needed
- **Cons**: Script requires multi-DB env files (`.env.local`, `.env.evolution-prod`), uses deprecated `executeV2Run()`, too heavy for E2E
- **Verdict**: Rejected — too coupled to local dev setup

### Option B: New API route `/api/evolution/run` + E2E test
- **Pros**: Clean separation, reusable endpoint, follows existing patterns, runs within Next.js server context where `callLLM` and `createSupabaseServiceClient` work natively
- **Cons**: New API route to maintain
- **Verdict**: ✅ Selected — the natural endpoint that's been missing

### Option C: Import pipeline functions directly into Playwright test
- **Pros**: No new API route
- **Cons**: `claimAndExecuteRun()` depends on `createSupabaseServiceClient()` (Next.js server-only) and `callLLM()` — won't work in Playwright's Node process
- **Verdict**: Rejected — incompatible runtime

## Phased Execution Plan

### Phase 1: Create `/api/evolution/run` API route

**File**: `src/app/api/evolution/run/route.ts`

Create a POST endpoint that:
1. Calls `requireAdmin()` for auth
2. Accepts `{ targetRunId?: string }` body
3. Calls `claimAndExecuteRun({ runnerId: 'api-<requestId>', targetRunId })`
4. Returns `RunnerResult` JSON
5. Sets `maxDuration = 300` (5 minutes for Vercel)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';
import { logger } from '@/lib/server_utilities';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const result = await claimAndExecuteRun({
      runnerId: `api-${randomUUID()}`,
      targetRunId: body.targetRunId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith('Unauthorized')) {
      return NextResponse.json({ error: msg }, { status: 403 });
    }
    logger.error('Evolution run API error', { error: msg });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Note on `requireAdmin()` in API route context**: This is the first usage of `requireAdmin()` in an API route (all prior usages are in server actions via `adminAction()`). `requireAdmin()` calls `createSupabaseServerClient()` which reads cookies from the Next.js request context. API routes share this context, so it should work — but verify during implementation with a quick manual test before writing the full E2E spec.

**Unit test**: `src/app/api/evolution/run/route.test.ts` — mock `requireAdmin` and `claimAndExecuteRun`, verify auth guard and response shape.

### Phase 2: Create comprehensive E2E test spec

**File**: `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`

**Tag**: `{ tag: '@evolution' }` — runs on production PRs via `npm run test:e2e:evolution`

**Structure**: Serial mode since all tests share pipeline-created state. Use `test.describe.configure({ mode: 'serial', timeout: 180_000 })` for extended timeout (pipeline takes 30-60s + UI assertions).

#### `beforeAll` — Seed test data and trigger pipeline

1. Create test strategy via direct Supabase insert:
   ```typescript
   {
     name: `${TEST_PREFIX} Strategy`,
     config: { generationModel: 'gpt-4.1-nano', judgeModel: 'gpt-4.1-nano', iterations: 1, strategiesPerRound: 1 },
     config_hash: `e2e-run-${Date.now()}`,
     status: 'active',
   }
   ```

2. Create test prompt:
   ```typescript
   {
     prompt: 'Write a short article about the water cycle',
     name: `${TEST_PREFIX} Prompt`,  // Zod schema uses `name`; verify at implementation — lifecycle spec uses `title`
     status: 'active',
   }
   ```
   **Column name note**: Zod schema (`evolutionPromptInsertSchema`) defines `name`, but the working lifecycle spec inserts with `title`. A migration may have renamed this column. At implementation time, verify the actual DB column by checking the latest migration or testing the insert. Use whichever column name the insert succeeds with.

3. Create test experiment with `running` status (required for auto-completion):
   ```typescript
   {
     name: `${TEST_PREFIX} Experiment`,
     prompt_id: promptId,
     status: 'running',  // Must be 'running' for complete_experiment_if_done RPC
   }
   ```

4. Create pending run linked to experiment:
   ```typescript
   {
     strategy_id: strategyId,
     prompt_id: promptId,
     experiment_id: experimentId,
     budget_cap_usd: 0.02,
     status: 'pending',
   }
   ```

5. Trigger execution via admin API:
   ```typescript
   const response = await adminPage.request.post('/api/evolution/run', {
     data: { targetRunId: runId },
     headers: { cookie: adminCookies },
   });
   ```

6. Poll for completion using Playwright's `expect.poll()` for proper timeout integration:
   ```typescript
   await expect.poll(async () => {
     const { data } = await sb.from('evolution_runs').select('status').eq('id', runId).single();
     return data?.status;
   }, { timeout: 120_000, intervals: [3_000] }).toBe('completed');
   ```

#### Test 1: Run completed successfully
- Assert run status is `completed`
- Assert `run_summary` JSONB is populated
- Assert `run_summary.version === 3`
- Assert `run_summary.stopReason` is one of `iterations_complete`, `budget_exceeded`, `converged`
- Assert `completed_at` is set

#### Test 2: Variants were created
- Query `evolution_variants` WHERE `run_id = runId`
- Assert at least 2 variants exist (baseline + generated)
- Assert exactly one variant has `is_winner = true`
- Assert winner has `elo_score > 0` and `mu > 0`

#### Test 3: Invocations were recorded
- Query `evolution_agent_invocations` WHERE `run_id = runId`
- Assert at least 1 invocation exists
- Assert invocations have `cost_usd > 0`
- Assert agent names include `generation` and/or `ranking`

#### Test 4: Run metrics were computed
- Query `evolution_metrics` WHERE `entity_type = 'run'` AND `entity_id = runId`
- Assert metric rows exist for: `cost`, `winner_elo`, `median_elo`, `variant_count`
- Assert `cost` value is > 0 and < 0.02

#### Test 5: Strategy metrics were propagated
- Query `evolution_metrics` WHERE `entity_type = 'strategy'` AND `entity_id = strategyId`
- Assert metric rows exist for: `run_count`, `total_cost`, `avg_final_elo`, `best_final_elo`
- Assert `run_count` value is 1
- Assert `total_cost` > 0

#### Test 6: Experiment auto-completed and metrics propagated
- Query `evolution_experiments` WHERE `id = experimentId`
- Assert status is `completed`
- Query `evolution_metrics` WHERE `entity_type = 'experiment'` AND `entity_id = experimentId`
- Assert metric rows exist for: `run_count`, `total_cost`, `avg_final_elo`, `best_final_elo`, `total_matches`
- Assert `run_count` value is 1
- Assert `total_cost` > 0 and < 0.02
- Note: bootstrap CI fields (`ci_lower`, `ci_upper`) will be null with only 1 run (requires 2+ for intervals)

#### Test 7: Arena sync worked
- Query `evolution_variants` WHERE `prompt_id = promptId` AND `synced_to_arena = true`
- Assert at least 1 variant synced to arena

#### Test 8: Run detail page — metrics render
- Navigate to `/admin/evolution/runs/${runId}`
- Assert `[data-testid="entity-detail-header"]` visible
- Click `[data-testid="tab-metrics"]`
- Assert `[data-testid="entity-metrics-tab"]` visible
- Assert `[data-testid="metric-cost"]` visible and contains a dollar value
- Assert `[data-testid="metric-winner-elo"]` visible and contains a number

#### Test 9: Experiment detail page — metrics render
- Navigate to `/admin/evolution/experiments/${experimentId}`
- Assert header visible
- Click `[data-testid="tab-metrics"]`
- Assert `[data-testid="metric-total-cost"]` visible
- Assert `[data-testid="metric-runs"]` visible (should show "1")

#### Test 10: Strategy detail page — metrics render
- Navigate to `/admin/evolution/strategies/${strategyId}`
- Assert header visible
- Click `[data-testid="tab-metrics"]`
- Assert `[data-testid="metric-total-cost"]` visible
- Assert `[data-testid="metric-runs"]` visible

#### Test 11: Logs were written
- Navigate to `/admin/evolution/runs/${runId}`
- Click `[data-testid="tab-logs"]`
- Assert log entries are visible (at least 1 row)

#### `afterAll` — Comprehensive cleanup

Delete in FK-safe order using Supabase service client:
1. `evolution_arena_comparisons` WHERE `prompt_id = promptId`
2. `evolution_agent_invocations` WHERE `run_id = runId`
3. `evolution_logs` WHERE `run_id = runId`
4. `evolution_metrics` WHERE `entity_id IN (runId, strategyId, experimentId)` — covers run, strategy, and experiment metrics
5. `evolution_variants` WHERE `run_id = runId` — only by run_id to avoid deleting arena variants from other runs
6. `evolution_variants` WHERE `prompt_id = promptId` AND `synced_to_arena = true` — clean up arena entries created by syncToArena
7. `evolution_explanations` WHERE `prompt_id = promptId` — seed articles created by pipeline
8. `evolution_runs` WHERE `id = runId`
9. `evolution_experiments` WHERE `id = experimentId`
10. `evolution_strategies` WHERE `id = strategyId`
11. `evolution_prompts` WHERE `id = promptId`

Track all IDs via `trackEvolutionId()` for defense-in-depth global teardown.

**Factory gap**: `evolution_metrics` is not in the factory's `FK_SAFE_DELETION_ORDER` or `EvolutionEntityType`. As part of this project, extend the factory:
- Add `'metric'` to `EvolutionEntityType`
- Add `{ type: 'metric', table: 'evolution_metrics' }` to `FK_SAFE_DELETION_ORDER` (before variants, since metrics have no FK children)
- This ensures defense-in-depth cleanup covers metrics rows if afterAll fails partway.

### Phase 2b: Experiment wizard creation + cleanup test

**File**: `src/__tests__/e2e/specs/09-admin/admin-evolution-experiment-wizard-e2e.spec.ts`

**Tag**: `{ tag: '@evolution' }` — runs on production PRs

**Motivation**: The existing `admin-experiment-wizard.spec.ts` relies on pre-existing prompts/strategies in the DB (picks "first available"), which is fragile and environment-dependent. This new spec seeds its own data, creates an experiment via the UI wizard, verifies it exists, and cleans up completely.

**Structure**: Serial mode.

#### `beforeAll` — Seed prompt and strategy

1. Create test prompt via Supabase service client:
   ```typescript
   {
     prompt: 'E2E wizard test: explain photosynthesis',
     name: `${TEST_PREFIX} Wizard Prompt`,  // See column name note in Phase 2
     status: 'active',
   }
   ```

2. Create test strategy:
   ```typescript
   {
     name: `${TEST_PREFIX} Wizard Strategy`,
     config: { generationModel: 'gpt-4.1-nano', judgeModel: 'gpt-4.1-nano', iterations: 1 },
     config_hash: `e2e-wizard-${Date.now()}`,
     status: 'active',
   }
   ```

#### Test 1: Wizard page loads
- Navigate to `/admin/evolution/start-experiment` (or `/admin/evolution/experiments/new`)
- Assert wizard form renders (`h1` contains "Create Experiment" or similar)
- Assert `[data-testid="experiment-name-input"]` is visible

#### Test 2: Create experiment via wizard
- Fill experiment name: `${TEST_PREFIX} Wizard Experiment`
- Select the seeded prompt from dropdown (search/filter by test prefix to find it reliably)
- Select the seeded strategy from dropdown
- Set budget (if field exists)
- Submit via `[data-testid="create-experiment-submit"]`
- Assert success: toast appears OR page redirects to experiment detail
- Capture `experimentId` from redirect URL or success response

#### Test 3: Experiment appears in list
- Navigate to `/admin/evolution/experiments`
- Assert the created experiment name appears in the table

#### Test 4: Experiment detail page loads
- Navigate to `/admin/evolution/experiments/${experimentId}`
- Assert `[data-testid="entity-detail-header"]` visible
- Assert page contains the experiment name
- Assert status badge shows `draft` or `running` (depending on whether wizard auto-queues runs)

#### `afterAll` — Cleanup

Delete in FK-safe order:
1. Find runs created by the experiment: `evolution_runs` WHERE `experiment_id`
2. Delete run children: `evolution_logs`, `evolution_agent_invocations`, `evolution_variants` WHERE `run_id IN (...)`
3. Delete runs
4. `evolution_experiments` WHERE `id = experimentId`
5. `evolution_strategies` WHERE `id = strategyId`
6. `evolution_prompts` WHERE `id = promptId`

Also track all IDs via `trackEvolutionId()`.

**Note**: This replaces the existing fragile `admin-experiment-wizard.spec.ts`. During implementation, we should either delete the old spec or refactor it to use the same seeded-data pattern.

### Phase 3: Lint, type-check, build, test

1. Run `npx eslint` on new files
2. Run `npx tsc --noEmit`
3. Run `npm run build`
4. Run unit test for the API route
5. Run the E2E test locally (requires OPENAI_API_KEY)

## Testing

### New files
| File | Type | Description |
|------|------|-------------|
| `src/app/api/evolution/run/route.ts` | API route | POST endpoint to trigger evolution runs |
| `src/app/api/evolution/run/route.test.ts` | Unit test | Auth guard, response shape |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` | E2E spec | 11 tests covering full pipeline lifecycle |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-experiment-wizard-e2e.spec.ts` | E2E spec | 4 tests: wizard creation with seeded data + cleanup |

### Modified files
| File | Change |
|------|--------|
| `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` | Add `metric` entity type + `evolution_metrics` to FK_SAFE_DELETION_ORDER |
| `src/__tests__/e2e/specs/09-admin/admin-experiment-wizard.spec.ts` | Delete — replaced by self-contained wizard-e2e spec |

### Manual verification
- Run the E2E test locally with a real OPENAI_API_KEY
- Verify cost stays under $0.02
- Verify cleanup leaves no orphaned data

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/testing_setup.md` — Add new E2E spec to test file listing, document `@evolution` tag for pipeline test
- `docs/docs_overall/testing_overview.md` — Update E2E spec count
- `evolution/docs/reference.md` — Add `/api/evolution/run` to API route inventory, update E2E test listing

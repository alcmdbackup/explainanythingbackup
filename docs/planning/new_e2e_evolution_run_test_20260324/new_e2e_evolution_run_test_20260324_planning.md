# New E2E Evolution Run Test Plan

## Background
Design a comprehensive E2E test that runs on both main and production PRs, testing that an evolution run can be created via experiment and successfully runs to completion using real LLM calls. The test should verify metrics computation (run, experiment, strategy), arena sync, experiment auto-completion, and that metrics render correctly in the admin UI. Max budget: $0.02 per run.

## Requirements (from GH Issue #813)
- E2E test that runs on both main→production merges
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
import { requireAdmin } from '@/lib/services/adminAuth';
import { claimAndExecuteRun } from '@evolution/lib/pipeline/claimAndExecuteRun';
import { logger } from '@/lib/server_utilities';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    await requireAdmin();
    const body = await request.json().catch(() => ({}));
    const result = await claimAndExecuteRun({
      runnerId: `api-${Date.now()}`,
      targetRunId: body.targetRunId,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Unauthorized')) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    logger.error('Evolution run API error', { error: String(error) });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**Unit test**: `src/app/api/evolution/run/route.test.ts` — mock `requireAdmin` and `claimAndExecuteRun`, verify auth guard and response shape.

### Phase 2: Create comprehensive E2E test spec

**File**: `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`

**Tag**: `{ tag: '@evolution' }` — runs on production PRs via `npm run test:e2e:evolution`

**Structure**: Serial mode since all tests share pipeline-created state.

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
     name: `${TEST_PREFIX} Prompt`,
     status: 'active',
   }
   ```

3. Create test experiment:
   ```typescript
   {
     name: `${TEST_PREFIX} Experiment`,
     prompt_id: promptId,
     status: 'draft',
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

6. Poll for completion (timeout 120s):
   ```typescript
   let status = 'pending';
   const deadline = Date.now() + 120_000;
   while (status !== 'completed' && status !== 'failed' && Date.now() < deadline) {
     await new Promise(r => setTimeout(r, 3000));
     const { data } = await sb.from('evolution_runs').select('status').eq('id', runId).single();
     status = data?.status ?? status;
   }
   expect(status).toBe('completed');
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
- Assert metric rows exist (at minimum `run_count`, `total_cost`)

#### Test 6: Experiment auto-completed
- Query `evolution_experiments` WHERE `id = experimentId`
- Assert status is `completed`

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
4. `evolution_metrics` WHERE `entity_id IN (runId, strategyId, experimentId)`
5. `evolution_variants` WHERE `run_id = runId` OR `prompt_id = promptId`
6. `evolution_explanations` WHERE `prompt_id = promptId`
7. `evolution_runs` WHERE `id = runId`
8. `evolution_experiments` WHERE `id = experimentId`
9. `evolution_strategies` WHERE `id = strategyId`
10. `evolution_prompts` WHERE `id = promptId`

Also track all IDs via `trackEvolutionId()` for defense-in-depth global teardown.

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

### Modified files
None expected — all new code.

### Manual verification
- Run the E2E test locally with a real OPENAI_API_KEY
- Verify cost stays under $0.02
- Verify cleanup leaves no orphaned data

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/testing_setup.md` — Add new E2E spec to test file listing, document `@evolution` tag for pipeline test
- `docs/docs_overall/testing_overview.md` — Update E2E spec count
- `evolution/docs/reference.md` — Add `/api/evolution/run` to API route inventory, update E2E test listing

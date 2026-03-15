# Clean Up Vercel Cron Evolution Plan

## Background
Remove ALL Vercel cron infrastructure for the evolution pipeline and move housekeeping tasks (watchdog, experiment-driver, orphaned-reservation cleanup) into the minicomputer batch runner. After this change, `vercel.json` has zero cron entries and Vercel is purely a web host + admin UI.

## Requirements (from GH Issue #703)
1. Remove ALL cron entries from vercel.json
2. Remove GET handler + cron auth from `/api/evolution/run` (keep POST for admin UI)
3. Delete legacy `/api/cron/evolution-runner` re-export
4. Delete watchdog, experiment-driver, and orphaned-reservations cron routes
5. Extract core logic into shared modules under `evolution/src/lib/ops/`
6. Add housekeeping phases to minicomputer batch runner
7. Delete `cronAuth.ts` and `CRON_SECRET` / `EVOLUTION_CRON_ENABLED` env vars
8. Keep admin UI POST endpoint + timeout/continuation system intact
9. Update all affected docs

## Problem
The evolution pipeline currently has 4 Vercel cron jobs that were the original execution mechanism before the minicomputer. The runner cron is already disabled, but 3 housekeeping crons (watchdog, experiment-driver, orphaned-reservations) still run on Vercel. This creates split infrastructure — the minicomputer executes runs but relies on Vercel for crash recovery and experiment orchestration. Moving everything to the minicomputer simplifies the architecture: one system, one timer, zero Vercel crons.

## Options Considered

### Option A: Fold into batch runner (CHOSEN)
Add housekeeping phases to the existing `evolution-runner.ts` that run before claiming new runs. Single systemd timer, single script.
- **Pro**: Simplest. No new infrastructure. All logic in one place
- **Con**: Housekeeping blocked during long runs (acceptable — watchdog threshold is 10 min)

### Option B: Two systemd timers
Separate `evolution-ops.timer` for housekeeping, independent of run execution.
- **Pro**: Housekeeping runs even during long runs
- **Con**: More infrastructure to manage. Marginal benefit since gaps are acceptable

### Option C: Keep crons on Vercel
Only remove the runner cron. Keep watchdog/experiment-driver/orphaned-reservations on Vercel.
- **Pro**: No minicomputer changes. Vercel watchdog provides independent crash detection
- **Con**: Split infrastructure. Vercel watching minicomputer is somewhat circular

## Phased Execution Plan

### Phase 1: Extract shared modules
Create pure-function modules that contain the core logic from each cron route. No route changes yet — just extraction.

**Files to create:**

`evolution/src/lib/ops/watchdog.ts` (~80 lines)
```typescript
// Detect stale evolution runs and recover via checkpoint or mark failed.
export interface WatchdogResult {
  staleRunsFound: number;
  markedFailed: string[];
  recoveredViaContinuation: string[];
  abandonedContinuations: string[];
}
export async function runWatchdog(
  supabase: SupabaseClient,
  thresholdMinutes?: number,
): Promise<WatchdogResult>
```
Extract lines 27-151 from `evolution-watchdog/route.ts`. Remove Next.js imports. Accept Supabase client as param. Update error message from "likely serverless timeout" to "likely runner crash" since minicomputer doesn't have serverless timeouts.

`evolution/src/lib/ops/experimentDriver.ts` (~250 lines)
```typescript
// Advance experiments through their lifecycle state machine.
export interface ExperimentDriverResult {
  processed: number;
  transitions: TransitionResult[];
}
export async function advanceExperiments(
  supabase: SupabaseClient,
  maxExperiments?: number,
): Promise<ExperimentDriverResult>
```
Extract `handleRunning()`, `handleAnalyzing()`, `writeTerminalState()`, and the main loop from `experiment-driver/route.ts`. Move type definitions (`ExperimentRow`, `TransitionResult`).

**callLLM dependency**: The experiment-driver calls `callLLM()` for fire-and-forget report generation. `callLLM` lives in `src/lib/services/llms.ts` which imports `createSupabaseServiceClient` from `src/lib/utils/supabase/server.ts`. That file has `'use server'` and imports `next/headers`, but `createSupabaseServiceClient` itself only uses env vars (`process.env.NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) — it does NOT call `cookies()`. The batch runner already successfully imports `callLLM` via `evolution/src/lib/core/llmClient.ts`, proving this works in tsx/Node context. The extracted module can import `callLLM` directly via the same path.

**Logging**: Use `console.log`/`console.error` in the extracted module (matching batch runner's existing logger pattern) rather than importing `@/lib/server_utilities` logger.

`evolution/src/lib/ops/orphanedReservations.ts` (~10 lines)
```typescript
// Clean up orphaned LLM budget reservations from crashed processes.
export async function cleanupOrphanedReservations(): Promise<void>
```
Extract the single `getSpendingGate().cleanupOrphanedReservations()` call.

**getSpendingGate dependency**: `llmSpendingGate.ts` imports `logger` from `@/lib/server_utilities` (which imports `@sentry/nextjs`) and `createSupabaseServiceClient`. This is the same transitive dependency chain that `callLLM` already uses — and the batch runner already successfully imports `callLLM` via `evolution/src/lib/core/llmClient.ts` → `@/lib/services/llms.ts` → `@/lib/server_utilities`. So `@sentry/nextjs` is already resolved in the batch runner's tsx context. No additional handling needed.

**Error handling**: Wrap the call in try/catch in the batch runner integration (Phase 2) to prevent orphaned-reservation failures from blocking watchdog and experiment advancement.

**Tests:**
- `evolution/src/lib/ops/watchdog.test.ts` — Port 4 logic tests from watchdog route test (6 total - 2 auth = 4 logic)
- `evolution/src/lib/ops/experimentDriver.test.ts` — Port 13 logic tests from experiment-driver route test (15 total - 2 auth = 13 logic)
- `evolution/src/lib/ops/orphanedReservations.test.ts` — 1-2 basic tests

**Verification:** Run extracted module tests. Ensure all pass.

### Phase 2: Wire into batch runner
Update `evolution/scripts/evolution-runner.ts` to call the 3 ops modules before claiming runs.

```typescript
import { runWatchdog } from '../src/lib/ops/watchdog';
import { advanceExperiments } from '../src/lib/ops/experimentDriver';
import { cleanupOrphanedReservations } from '../src/lib/ops/orphanedReservations';

// Run housekeeping BEFORE the claim loop, so it always executes
// even when no pending runs exist. This is important because:
// - Watchdog recovery can CREATE new claimable runs (continuation_pending)
// - Experiment transitions should happen regardless of pending run count
// - The batch runner exits early when no runs are found (line ~381)
async function runHousekeeping(supabase: SupabaseClient): Promise<void> {
  // Each phase is try/caught independently so one failure doesn't block others
  try {
    const watchdogResult = await runWatchdog(supabase);
    if (watchdogResult.staleRunsFound > 0) {
      log.info('Watchdog', watchdogResult);
    }
  } catch (e) { log.error('Watchdog failed', e); }

  try {
    const experimentResult = await advanceExperiments(supabase);
    if (experimentResult.processed > 0) {
      log.info('Experiments advanced', experimentResult);
    }
  } catch (e) { log.error('Experiment driver failed', e); }

  try {
    await cleanupOrphanedReservations();
  } catch (e) { log.error('Orphaned reservation cleanup failed', e); }
}
```

Place housekeeping call BEFORE the `while (processedRuns < maxRuns)` loop, not inside it. This ensures housekeeping always runs once per invocation, even when there are zero pending runs.

**Verification:** Run batch runner with `--dry-run`. Confirm housekeeping executes without errors. Test with a deliberately stale run to verify watchdog recovery.

### Phase 3: Delete cron routes and simplify Vercel route
**Important**: Delete the legacy re-export BEFORE or simultaneously with removing GET from the unified route, since it re-exports GET.

**Delete these files:**
- `src/app/api/cron/evolution-runner/route.ts` (legacy re-export — must delete first)
- `src/app/api/cron/evolution-watchdog/route.ts` + `route.test.ts`
- `src/app/api/cron/experiment-driver/route.ts` + `route.test.ts`
- `src/app/api/cron/reset-orphaned-reservations/route.ts`
- `src/lib/utils/cronAuth.ts` + `cronAuth.test.ts`
- `src/__tests__/integration/evolution-cron-gate.integration.test.ts`

**Simplify `/api/evolution/run/route.ts` to POST-only:**
- Remove `GET` export
- Remove `authenticateRequest()` dual-auth function
- Remove `requireCronAuth` import
- Remove `EVOLUTION_CRON_ENABLED` gate
- Remove `v4` (uuid) import
- Inline `requireAdmin()` directly in POST handler
- Hardcode `runnerId: 'admin-trigger'`
- Keep `maxDuration = 800` and `PIPELINE_MAX_DURATION_MS`

**Route drops from ~108 to ~60 lines.**

**Update `route.test.ts`**: Remove all 9 GET-dependent tests, keeping 7 tests:
- 6 POST tests (targetRunId validation, malformed body, no body, no runId field, successful run via POST, error handling via POST)
- 1 maxDuration test

**Empty vercel.json**: `{ "crons": [] }`

**Clean up `.env.example`**: Remove CRON_SECRET reference

**Verification:** `npm run build`, `npm run tsc`, `npm run lint`, `npm test` all pass.

### Phase 4: Update documentation
See Documentation Updates section below.

**Verification:** Read each updated doc for accuracy.

## Testing

### New unit tests (ported from deleted route tests)
- `evolution/src/lib/ops/watchdog.test.ts` — 4 tests ported from watchdog route (stale run detection, checkpoint recovery, no-checkpoint failure, continuation abandonment)
- `evolution/src/lib/ops/experimentDriver.test.ts` — 13 tests ported from experiment-driver route (running→analyzing, running→failed, analyzing→completed with metrics, analyzing→failed, multi-experiment processing, report generation fire-and-forget, error isolation, computeManualAnalysis for manual design)
- `evolution/src/lib/ops/orphanedReservations.test.ts` — 1-2 new tests (calls spending gate cleanup, handles errors)

### Modified tests
- `src/app/api/evolution/run/route.test.ts` — Remove 9 GET-dependent tests. Keep 7 tests (6 POST + 1 maxDuration). Rewrite POST tests to use `requireAdmin()` directly instead of dual auth mock

### Deleted tests (total: 29 tests across 4 files)
- `src/__tests__/integration/evolution-cron-gate.integration.test.ts` — 3 tests, all cron-specific
- `src/app/api/cron/evolution-watchdog/route.test.ts` — 6 tests (2 auth dropped, 4 logic ported)
- `src/app/api/cron/experiment-driver/route.test.ts` — 15 tests (2 auth dropped, 13 logic ported)
- `src/lib/utils/cronAuth.test.ts` — 5 tests, all cron auth

### Test count summary
| Source | Before | Deleted | Ported | New | After |
|--------|--------|---------|--------|-----|-------|
| route.test.ts (evolution/run) | 16 | 9 | — | — | 7 |
| evolution-cron-gate.integration | 3 | 3 | — | — | 0 |
| watchdog route.test.ts | 6 | 6 | 4 | — | 0 (→ ops/watchdog.test.ts: 4) |
| experiment-driver route.test.ts | 15 | 15 | 13 | — | 0 (→ ops/experimentDriver.test.ts: 13) |
| cronAuth.test.ts | 5 | 5 | — | — | 0 |
| ops/orphanedReservations.test.ts | — | — | — | 2 | 2 |
| **Total** | **45** | **38** | **17** | **2** | **26** |

Net: -19 tests (intentional — auth tests no longer needed, GET tests no longer needed)

### Rollback plan
If issues arise after deploy, revert the commit. The old cron routes and vercel.json entries will be restored. The extracted ops modules are additive and can coexist with the cron routes during a transition period if needed.

### Manual verification
- Deploy to stage, confirm POST `/api/evolution/run` still triggers runs from admin UI
- Confirm `vercel.json` with empty crons deploys without issues
- On minicomputer: run `--dry-run` to confirm housekeeping phases execute

## Documentation Updates
The following docs need updates:

- `evolution/docs/evolution/minicomputer_deployment.md`
  - Rewrite "Fallback: Re-enable Vercel Cron" section → "Manual trigger via admin UI"
  - Update "How It Works" to mention housekeeping phases
  - Remove references to EVOLUTION_CRON_ENABLED env var

- `evolution/docs/evolution/architecture.md`
  - Update "Pipeline Continuation & Vercel Timeouts" section title and content
  - Remove Runner Comparison table (no longer two runners for cron)
  - Update continuation flow: "next batch runner tick" instead of "next cron cycle"
  - Remove references to EVOLUTION_CRON_ENABLED
  - Update Unified Endpoint description: POST-only

- `evolution/docs/evolution/reference.md`
  - Update unified endpoint: POST-only, admin auth only
  - Remove legacy cron re-export entry
  - Remove EVOLUTION_CRON_ENABLED from env vars table
  - Remove CRON_SECRET from env vars (or mark as removed)
  - Update key files table: remove cron routes, add ops modules
  - Update "cron runner" references → "batch runner"

- `evolution/docs/evolution/cost_optimization.md`
  - Line 167: "Runs execute via Vercel serverless (cron-driven)" → "Runs execute via minicomputer batch runner or admin UI trigger"

- `evolution/docs/evolution/data_model.md`
  - Lines 13, 69: "cron runner" → "batch runner"
  - Update continuation_pending description: recovered by batch runner, not cron

- `evolution/docs/evolution/experimental_framework.md`
  - Update experiment-driver reference: now runs in batch runner, not cron route

- `docs/feature_deep_dives/admin_panel.md`
  - Line 280: Remove "via Vercel cron" from orphaned reservation description

- `docs/docs_overall/environments.md`
  - Remove EVOLUTION_CRON_ENABLED from any env var references

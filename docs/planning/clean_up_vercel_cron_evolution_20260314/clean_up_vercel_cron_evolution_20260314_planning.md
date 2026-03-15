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
Extract lines 27-151 from `evolution-watchdog/route.ts`. Remove Next.js imports. Accept Supabase client as param.

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
Extract `handleRunning()`, `handleAnalyzing()`, `writeTerminalState()`, and the main loop from `experiment-driver/route.ts`. Move type definitions (`ExperimentRow`, `TransitionResult`). Keep `callLLM` import for report generation.

`evolution/src/lib/ops/orphanedReservations.ts` (~10 lines)
```typescript
// Clean up orphaned LLM budget reservations from crashed processes.
export async function cleanupOrphanedReservations(): Promise<void>
```
Extract the single `getSpendingGate().cleanupOrphanedReservations()` call.

**Tests:**
- `evolution/src/lib/ops/watchdog.test.ts` — Port 5 logic tests from watchdog route test
- `evolution/src/lib/ops/experimentDriver.test.ts` — Port 18 logic tests from experiment-driver route test
- `evolution/src/lib/ops/orphanedReservations.test.ts` — 1-2 basic tests

**Verification:** Run extracted module tests. Ensure all pass.

### Phase 2: Wire into batch runner
Update `evolution/scripts/evolution-runner.ts` to call the 3 ops modules before claiming runs.

```typescript
// In the main loop, before claiming runs:
import { runWatchdog } from '../src/lib/ops/watchdog';
import { advanceExperiments } from '../src/lib/ops/experimentDriver';
import { cleanupOrphanedReservations } from '../src/lib/ops/orphanedReservations';

// Run housekeeping (fast — all DB operations, <1s total)
const watchdogResult = await runWatchdog(supabase);
if (watchdogResult.staleRunsFound > 0) {
  log.info('Watchdog', watchdogResult);
}

const experimentResult = await advanceExperiments(supabase);
if (experimentResult.processed > 0) {
  log.info('Experiments advanced', experimentResult);
}

await cleanupOrphanedReservations();
```

**Verification:** Run batch runner with `--dry-run`. Confirm housekeeping executes without errors. Test with a deliberately stale run to verify watchdog recovery.

### Phase 3: Simplify Vercel route
Update `/api/evolution/run/route.ts` to POST-only, admin-auth-only.

**Changes:**
- Remove `GET` export
- Remove `authenticateRequest()` dual-auth function
- Remove `requireCronAuth` import
- Remove `EVOLUTION_CRON_ENABLED` gate
- Remove `v4` (uuid) import
- Inline `requireAdmin()` directly in POST handler
- Hardcode `runnerId: 'admin-trigger'`
- Keep `maxDuration = 800` and `PIPELINE_MAX_DURATION_MS`

**Route drops from ~108 to ~60 lines.**

**Verification:** Build passes. POST endpoint still works (test manually or via existing POST tests).

### Phase 4: Delete dead code
- Delete `src/app/api/cron/evolution-runner/route.ts`
- Delete `src/app/api/cron/evolution-watchdog/route.ts` + `route.test.ts`
- Delete `src/app/api/cron/experiment-driver/route.ts` + `route.test.ts`
- Delete `src/app/api/cron/reset-orphaned-reservations/route.ts`
- Delete `src/lib/utils/cronAuth.ts` + `cronAuth.test.ts`
- Delete `src/__tests__/integration/evolution-cron-gate.integration.test.ts`
- Empty `vercel.json` crons: `{ "crons": [] }`
- Remove cron-specific tests from `src/app/api/evolution/run/route.test.ts` (3 tests)

**Verification:** `npm run build`, `npm run tsc`, `npm run lint`, `npm test` all pass.

### Phase 5: Update documentation
See Documentation Updates section below.

**Verification:** Read each updated doc for accuracy.

## Testing

### New unit tests
- `evolution/src/lib/ops/watchdog.test.ts` — Stale run detection, checkpoint recovery path, no-checkpoint failure path, continuation abandonment, threshold configuration
- `evolution/src/lib/ops/experimentDriver.test.ts` — Running→analyzing transition, running→failed (all runs failed), analyzing→completed with metrics, analyzing→failed, multi-experiment processing, report generation (fire-and-forget), error isolation between experiments
- `evolution/src/lib/ops/orphanedReservations.test.ts` — Calls spending gate cleanup, handles errors

### Modified tests
- `src/app/api/evolution/run/route.test.ts` — Remove 3 cron-specific tests (GET gate x2, cron auth x1). Keep 16 POST/shared tests. Update test descriptions

### Deleted tests
- `src/__tests__/integration/evolution-cron-gate.integration.test.ts` (3 tests)
- `src/app/api/cron/evolution-watchdog/route.test.ts` (7 tests — 5 ported to new module)
- `src/app/api/cron/experiment-driver/route.test.ts` (20 tests — 18 ported to new module)
- `src/lib/utils/cronAuth.test.ts`

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

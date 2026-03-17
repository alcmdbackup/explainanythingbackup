# Clean Up Vercel Cron Evolution Research

## Problem Statement
Remove ALL Vercel cron infrastructure for the evolution pipeline and move housekeeping tasks (watchdog, experiment-driver, orphaned-reservation cleanup) into the minicomputer batch runner. After this change, `vercel.json` has zero cron entries and Vercel is purely a web host + admin UI.

## Requirements (from GH Issue #703)
1. Remove ALL cron entries from vercel.json
2. Remove GET handler + EVOLUTION_CRON_ENABLED gate from `/api/evolution/run` route (keep POST for admin UI)
3. Delete legacy `/api/cron/evolution-runner` re-export route
4. Delete `/api/cron/evolution-watchdog` route
5. Delete `/api/cron/experiment-driver` route
6. Delete `/api/cron/reset-orphaned-reservations` route
7. Extract core logic from each deleted route into shared modules
8. Add housekeeping phases to minicomputer batch runner (watchdog, experiment-driver, orphaned-reservations)
9. Delete `cronAuth.ts` (no remaining consumers)
10. Remove `CRON_SECRET` env var requirement
11. Keep admin UI POST endpoint functional
12. Keep timeout/continuation system intact
13. Update all affected docs

## High Level Summary

### Decision: Option A — Fold Everything Into Batch Runner

All 4 Vercel cron tasks move to the minicomputer. The batch runner (`evolution/scripts/evolution-runner.ts`) gains 3 housekeeping phases that run before claiming new evolution runs:

```
Every 60s (systemd timer):
  1. Recover stale runs (watchdog logic)
  2. Advance experiments (experiment-driver logic)
  3. Clean orphaned reservations
  4. Claim + execute pending runs (existing)
```

**Rationale**: All 3 housekeeping tasks are fast DB operations (<1s each). Running them at the top of each batch runner tick is natural and adds negligible overhead. If the minicomputer is down, nothing runs anyway — a Vercel-hosted watchdog watching a minicomputer-only system is circular.

**Trade-off**: If a run takes 20 minutes, housekeeping doesn't run for 20 minutes (systemd skips overlapping ticks). Acceptable because watchdog threshold is 10 minutes, and the only scenario where a run hangs is if the process itself crashes — in which case the next timer tick (after crash) will run housekeeping immediately.

### What Gets Removed (Vercel Side)
- `vercel.json` — delete entirely or empty the crons array
- `src/app/api/evolution/run/route.ts` — remove GET handler, cron auth, EVOLUTION_CRON_ENABLED gate
- `src/app/api/cron/evolution-runner/route.ts` — delete (legacy re-export)
- `src/app/api/cron/evolution-watchdog/route.ts` — delete (logic moves to shared module)
- `src/app/api/cron/experiment-driver/route.ts` — delete (logic moves to shared module)
- `src/app/api/cron/reset-orphaned-reservations/route.ts` — delete (logic moves to shared module)
- `src/lib/utils/cronAuth.ts` — delete (no remaining consumers)
- `src/lib/utils/cronAuth.test.ts` — delete
- `src/__tests__/integration/evolution-cron-gate.integration.test.ts` — delete
- `CRON_SECRET` env var — no longer needed
- `EVOLUTION_CRON_ENABLED` env var — no longer needed

### What Gets Added (Minicomputer Side)
- `evolution/src/lib/ops/watchdog.ts` — extracted watchdog logic (pure function, takes Supabase client)
- `evolution/src/lib/ops/experimentDriver.ts` — extracted experiment state machine (pure function)
- `evolution/src/lib/ops/orphanedReservations.ts` — extracted cleanup (calls spending gate)
- Updates to `evolution/scripts/evolution-runner.ts` — calls all 3 ops before claiming runs

### What Stays Unchanged
- POST handler on `/api/evolution/run` (admin UI trigger) — simplified to admin-auth-only
- `maxDuration = 800` export on POST route (Vercel serverless still needs it)
- Entire continuation/timeout system in pipeline.ts
- `adminAuth.ts` (still used by POST route and 5+ admin server actions)

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/minicomputer_deployment.md — Primary runner docs, fallback instructions
- evolution/docs/evolution/reference.md — Config, feature flags, key files, deployment
- docs/docs_overall/environments.md — Environment configs
- evolution/docs/evolution/architecture.md — Pipeline orchestration, continuation flow, runner comparison
- evolution/docs/evolution/cost_optimization.md — References "Vercel serverless (cron-driven)" at line 167
- evolution/docs/evolution/experimental_framework.md — Experiment-driver cron reference
- evolution/docs/evolution/data_model.md — Run status, continuation_pending, "cron runner" references
- evolution/docs/evolution/visualization.md — continuation_pending status badge
- evolution/docs/evolution/rating_and_comparison.md — No Vercel references
- evolution/docs/evolution/arena.md — No Vercel references

## Code Files Read

### Vercel Configuration
- `vercel.json` — 4 cron entries: evolution/run (*/5), evolution-watchdog (*/15), experiment-driver (*/1), reset-orphaned-reservations (*/5)

### Route Handlers (all to be deleted or simplified)
- `src/app/api/evolution/run/route.ts` — 108 lines. Dual auth (cron OR admin). GET disabled by default via EVOLUTION_CRON_ENABLED. POST always active. maxDuration=800
- `src/app/api/cron/evolution-runner/route.ts` — 3-line re-export. Dead code
- `src/app/api/cron/evolution-watchdog/route.ts` — 160 lines. Core logic: find stale runs (heartbeat > 10min), check for checkpoint, recover or fail. Also abandons stale continuation_pending > 30min. Inline CRON_SECRET auth
- `src/app/api/cron/experiment-driver/route.ts` — 332 lines. Core logic: handleRunning() waits for all runs to complete then transitions to analyzing. handleAnalyzing() computes metrics, writes results_summary, generates LLM report (fire-and-forget). Processes max 5 active experiments per invocation
- `src/app/api/cron/reset-orphaned-reservations/route.ts` — 24 lines. Calls getSpendingGate().cleanupOrphanedReservations(). One-liner

### Auth Infrastructure
- `src/lib/utils/cronAuth.ts` — requireCronAuth(). Can be deleted when all cron routes are gone
- `src/lib/services/adminAuth.ts` — requireAdmin(). Must stay (used by POST route + admin server actions)

### Pipeline Infrastructure
- `evolution/src/lib/core/pipeline.ts` — isNearTimeout(), continuation checkpoint. Stays unchanged
- `evolution/src/services/evolutionRunnerCore.ts` — claimAndExecuteEvolutionRun(). Stays unchanged
- `evolution/src/lib/core/persistence.ts` — checkpointAndMarkContinuationPending(). Stays unchanged

### Minicomputer Runner
- `evolution/scripts/evolution-runner.ts` — Claims up to 10 runs (2 parallel). No maxDurationMs. No housekeeping. This is where housekeeping phases will be added

### Test Files
- `src/app/api/evolution/run/route.test.ts` — 19 tests. Remove 3 cron-specific tests (GET gate x2, cron auth x1). Keep 16 POST/shared tests
- `src/__tests__/integration/evolution-cron-gate.integration.test.ts` — 3 tests. DELETE entire file
- `src/app/api/cron/evolution-watchdog/route.test.ts` — 7 tests. DELETE entire file (route deleted). Write new unit tests for extracted watchdog module
- `src/app/api/cron/experiment-driver/route.test.ts` — 20 tests. DELETE entire file (route deleted). Write new unit tests for extracted experiment-driver module
- `src/lib/utils/cronAuth.test.ts` — DELETE (cronAuth.ts deleted)

## Key Findings

1. **All 3 housekeeping tasks are trivial to extract** — watchdog is ~100 lines of Supabase queries, experiment-driver is ~200 lines of state machine logic, orphaned-reservations is a 1-line call to getSpendingGate().cleanupOrphanedReservations()

2. **Experiment-driver has one LLM call** — fire-and-forget report generation on terminal state. This call uses callLLM() which requires EVOLUTION_SYSTEM_USERID. Needs to work from the batch runner context (no Next.js server actions available)

3. **Watchdog error messages mention "serverless timeout"** — Update to say "runner crash" since minicomputer doesn't have serverless timeouts

4. **cronAuth.ts has zero remaining consumers after deleting all 4 cron routes** — Safe to delete entirely

5. **reset-orphaned-reservations is NOT evolution-specific** but is ONLY needed by evolution (primary LLM consumer). Moving it to the evolution batch runner is fine since non-evolution LLM calls don't use the spending gate reservation system

6. **The batch runner already imports Supabase and has full DB access** — No new dependencies needed for the extracted modules

7. **maxDuration=800 stays on the POST route** — Admin-triggered runs go through Vercel serverless and still benefit from the 740s timeout + continuation system

8. **Minicomputer deployment docs need significant rewrite** — The "Fallback: Re-enable Vercel Cron" section becomes "Manual admin trigger via UI" since there's no cron to re-enable

## Open Questions (Resolved)

1. ~~Should the watchdog move to the minicomputer?~~ **YES** — Decision: Option A
2. ~~Should experiment-driver move to the minicomputer?~~ **YES** — Decision: Option A
3. ~~Should we keep the Vercel POST timeout at 800s?~~ **YES** — Admin UI triggers still need it
4. ~~What about content-quality-eval cron?~~ — Route file not found in codebase. Likely already deleted. Reference in .env.example and reference.md is stale

# Run A516bb78 Marked Failed Evolution Stage Research

## Problem Statement
Evolution run `a516bb78-70d1-41a4-b99f-2057e8f0d448` on staging was marked as failed with error "stale claim auto-expired by claim_evolution_run". The run was actively working for 30 minutes, completing 6 full iterations successfully, when the systemd batch runner process was killed by `TimeoutStartSec=1800` (30 min). The run never got to finalize, losing all in-flight work (0 variants persisted).

## Requirements (from GH Issue #861)
- Investigate why run a516bb78 was marked as failed on staging
- Root cause: systemd 30-min timeout killed the batch runner process mid-execution
- Fix: increase systemd timeout, add wall clock deadline to pipeline, improve SIGTERM handling

## High Level Summary

### Root Cause
The systemd service `evolution-runner.service` has `TimeoutStartSec=1800` (30 minutes). The batch runner (`processRunQueue.ts`) was killed at exactly the 30-minute mark while run a516bb78 was mid-generation on iteration 7. The process death caused:
1. Heartbeat stopped updating (last at 06:59:12, exactly 30.5 min after claim)
2. Invocation for generation iter 7 left with `success: false`, `cost: null`, `duration: null`
3. No finalization — 0 variants persisted despite 6 full iterations of work
4. 10 minutes later, the `claim_evolution_run` RPC auto-expired the run as stale

### Timeline
| Time | Event |
|------|-------|
| 06:09:47 | Run created (pending) |
| 06:28:42 | Run claimed, strategy resolved — pipeline starts |
| 06:28:45 – 06:58:44 | 6 full iterations (generate + rank), all successful |
| **06:58:42** | **Claim + 30:00 — systemd TimeoutStartSec=1800 fires, sends SIGTERM** |
| 06:58:45 | Iteration 7 starts, generation begins |
| 06:59:12 | Last heartbeat (30.5 min) |
| 06:59:23 | structural_transform variant produced (2/3 strategies done) |
| 06:59:30 | lexical_simplify variant produced — **last log ever** |
| *(silence)* | Process killed, 3rd strategy never completed |
| ~07:09:12 | 10 min stale threshold → claim RPC auto-expires run |

### Key Evidence
- `Claim + 30min = 06:58:42.766Z` — matches exactly when problems start
- Generation iter 7 produced 2 variants (logs show them) but invocation was never updated — process died before `Agent.run()` could call `updateInvocation()`
- `runner_id` was nulled by the stale expiry (set to null on failure)
- Budget was $0.05 with ~$0.027 spent (54%) — budget was NOT the issue
- The `maxDurationMs` option exists on `RunnerOptions` but is **never passed or consumed**

### Three Gaps Found
1. **Systemd timeout too short** — 30 min not enough for runs with many iterations or slow LLM providers
2. **No wall clock awareness in pipeline** — `evolveArticle()` has no concept of time limits; it only checks budget and kill signals
3. **SIGTERM not propagated to pipeline** — the graceful shutdown handler in `processRunQueue.ts` only sets `shuttingDown = true` to prevent new claims; in-flight runs continue until SIGKILL

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/data_model.md
- evolution/docs/reference.md
- evolution/docs/arena.md
- evolution/docs/cost_optimization.md
- evolution/docs/curriculum.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/metrics.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/visualization.md
- evolution/docs/agents/overview.md
- docs/docs_overall/debugging.md
- docs/feature_deep_dives/error_handling.md
- docs/feature_deep_dives/testing_pipeline.md

## Code Files Read
- `evolution/deploy/evolution-runner.service` — systemd unit with `TimeoutStartSec=1800`
- `evolution/deploy/evolution-runner.timer` — 60s timer
- `evolution/scripts/processRunQueue.ts` — batch runner, no `maxDurationMs` passed
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — orchestrator with unused `maxDurationMs` option
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — main loop, no time limit check
- `evolution/src/lib/pipeline/infra/types.ts` — `EvolutionResult.stopReason` union
- `evolution/src/lib/maintenance/watchdog.ts` — stale detection (10 min threshold)
- `supabase/migrations/20260323000002_fix_stale_claim_expiry.sql` — auto-expiry in claim RPC
- `src/app/api/evolution/run/route.ts` — API entry point with `maxDuration=300`

## Database Queries (Staging)
- `evolution_runs` WHERE id = 'a516bb78-...' — full run row
- `evolution_logs` WHERE run_id = ... — 200 log entries, last at 06:59:30
- `evolution_agent_invocations` WHERE run_id = ... — 13 invocations, last (gen iter 7) has success=false
- `evolution_variants` WHERE run_id = ... — **0 variants** (finalization never ran)

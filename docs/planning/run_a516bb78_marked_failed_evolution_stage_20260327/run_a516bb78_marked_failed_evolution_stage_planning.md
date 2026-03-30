# Run A516bb78 Marked Failed Evolution Stage Plan

## Background
Evolution run `a516bb78` on staging was killed by systemd's 30-minute `TimeoutStartSec` while mid-execution. The pipeline had no wall clock awareness, so it started iteration 7 at the exact moment systemd sent SIGTERM. The run lost all work (0 variants persisted) because finalization never ran. This project fixes the root cause and adds defense-in-depth so future runs gracefully finalize before external timeouts kill them.

## Requirements (from GH Issue #861)
- Increase systemd timeout to 2 hours, parallel limit to 10
- Wire `maxDurationMs` from batch runner through `claimAndExecuteRun` to `evolveArticle`
- Add wall clock deadline check at iteration boundaries in `runIterationLoop.ts`
- Add `time_limit` to `EvolutionResult.stopReason` union and all Zod schemas
- Improve SIGTERM handling with AbortController propagation to in-flight runs
- Add unit and integration tests for all new behavior

## Problem
The evolution batch runner (`processRunQueue.ts`) runs under systemd with a 30-minute hard timeout. The pipeline has no concept of wall clock limits — it only checks budget and external kill signals at iteration boundaries. When systemd kills the process, in-flight runs lose all work because finalization never executes. The `maxDurationMs` option exists on `RunnerOptions` but is never passed or consumed.

## Options Considered
- [x] **Option A: Defense-in-depth** — Fix all three layers: systemd timeout (2h), pipeline deadline (graceful stop), SIGTERM propagation (abort signal). This is the chosen approach.
- [ ] **Option B: Systemd-only fix** — Just bump `TimeoutStartSec` to infinity. Simple but fragile — runs could hang forever.
- [ ] **Option C: Pipeline-only fix** — Add deadline without fixing systemd. Doesn't help if the pipeline's deadline calculation is wrong.

## Phased Execution Plan

### Phase 1: Systemd Config
- [x] Increase `TimeoutStartSec` from 1800 to 7200 (2 hours) in `evolution/deploy/evolution-runner.service`
- [x] Increase `--parallel` from 2 to 10 in `ExecStart`

### Phase 2: Wire maxDurationMs Through Pipeline
- [x] Add `--max-duration` CLI flag to `evolution/scripts/processRunQueue.ts` (default: 6,000,000ms = 100 min, leaving 20 min buffer under 2h systemd limit for finalization + arena sync + metric propagation)
- [x] Pass `maxDurationMs` from `processRunQueue.ts` to `claimAndExecuteRun()`
- [x] In `claimAndExecuteRun()`, compute `deadlineMs = startMs + options.maxDurationMs` (using existing `startMs` from line 91, NOT `Date.now()`, so time spent on claim + context build is accounted for)
- [x] In `executePipeline()`, add `deadlineMs` and `signal` parameters (both Phases 2+4 modify this signature — do them together)
- [x] In `executePipeline()`, pass `deadlineMs` and `signal` to `evolveArticle()` via new options fields
- [x] Fix `claimAndExecuteRun()` line 156: change `stopReason: 'completed'` to propagate `result.stopReason` from the pipeline (currently hardcoded, loses the actual stop reason). This requires changing `executePipeline()` return type from `Promise<void>` to `Promise<{ stopReason: string }>` so the caller can access it.
- [x] Add guard: if `maxDurationMs` is provided but `<= 0`, treat as "no deadline" (prevent misconfiguration causing immediate `time_limit`)

### Phase 3: Wall Clock Deadline in Iteration Loop
- [x] Add `deadlineMs?: number` and `signal?: AbortSignal` to `evolveArticle()` options type (inline on line 78)
- [x] Add `'time_limit'` to `EvolutionResult.stopReason` union in `evolution/src/lib/pipeline/infra/types.ts` (line 33)
- [x] Add `'time_limit'` to `evolutionResultSchema.stopReason` Zod enum in `evolution/src/lib/schemas.ts` (line 355) — **this is the schema that validates at runtime, separate from the TypeScript interface**
- [x] At iteration boundary in `runIterationLoop.ts`, add checks in this order:
  1. **Abort signal check** (highest priority — process is being killed): `if (options?.signal?.aborted)` → `stopReason = 'killed'`, break
  2. **Kill detection** (DB check): existing `isRunKilled()` → `stopReason = 'killed'`, break
  3. **Deadline check**: `if (options?.deadlineMs && Date.now() >= options.deadlineMs)` → `stopReason = 'time_limit'`, break
- [x] Log the deadline check: `logger.warn('Wall clock deadline reached', { iteration, elapsedMs: Date.now() - startMs, deadlineMs, phaseName: 'loop' })`
- [x] **Important**: Do NOT pass the abort signal to finalization functions — finalization must always complete to save work. Signal is only checked at iteration boundaries.

### Phase 4: SIGTERM / AbortController Propagation
- [x] Create `AbortController` in `processRunQueue.ts` main()
- [x] In SIGTERM/SIGINT handler, call `abortController.abort()` in addition to setting `shuttingDown = true`
- [x] Add `signal?: AbortSignal` to `RunnerOptions`
- [x] Pass `signal` from `processRunQueue.ts` to `claimAndExecuteRun()`
- [x] In `claimAndExecuteRun()`, pass `signal` through to `executePipeline()` → `evolveArticle()` (same threading as `deadlineMs`)

### Phase 5: API Route Hardening
- [x] In `src/app/api/evolution/run/route.ts`, pass `maxDurationMs: 240_000` (4 min, under 5 min Vercel `maxDuration=300`) to `claimAndExecuteRun()` — this gives 60s margin for claim + finalization
- [x] This ensures API-triggered runs also get graceful `time_limit` exits instead of being hard-killed by Vercel

### Phase 6: Schema & Consumer Updates
- [x] Verify `EvolutionRunSummaryV3Schema` in `evolution/src/lib/types.ts` — uses `z.string().max(200)` for stopReason, so `'time_limit'` passes without changes
- [x] Update E2E assertion in `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` line 183: add `'time_limit'` to the stopReason allowlist `expect(['iterations_complete', 'budget_exceeded', 'converged', 'time_limit']).toContain(...)`

### Phase 7: Tests
- [x] Unit test: `runIterationLoop.test.ts` — `evolveArticle` exits with `stopReason='time_limit'` when `deadlineMs` is in the past, verify `iterationsRun=0` and baseline returned as winner
- [x] Unit test: `runIterationLoop.test.ts` — `evolveArticle` exits with `stopReason='killed'` when abort signal fires mid-loop
- [x] Unit test: `runIterationLoop.test.ts` — `evolveArticle` completes normally when `deadlineMs` is far in the future, assert no 'Wall clock deadline reached' log emitted
- [x] Unit test: `runIterationLoop.test.ts` — deadline + budget interaction: if budget is tiny AND deadlineMs is in the past, `time_limit` should not fire because abort/deadline is checked BEFORE generate phase (which triggers budget check). Verify deadline wins.
- [x] Unit test: `runIterationLoop.test.ts` — priority ordering: abort signal takes precedence over deadline when both are true simultaneously
- [x] Unit test: `claimAndExecuteRun.test.ts` — verify `deadlineMs` = `startMs + maxDurationMs` (not `Date.now()`) is passed to `evolveArticle` mock
- [x] Unit test: `claimAndExecuteRun.test.ts` — verify `result.stopReason` from pipeline is propagated in returned `RunnerResult`
- [x] Unit test: `processRunQueue.test.ts` — verify `--max-duration` flag is parsed correctly (import `parseIntArg` directly, don't duplicate)
- [x] Unit test: `processRunQueue.test.ts` — verify default `maxDurationMs=6_000_000` when flag is absent
- [x] Unit test: `processRunQueue.test.ts` — verify SIGTERM triggers `abortController.abort()` and signal reaches `claimAndExecuteRun` options
- [x] Unit test: `schemas.test.ts` (file exists at `evolution/src/lib/schemas.test.ts`) — parameterized test: all stopReason values (`budget_exceeded`, `iterations_complete`, `converged`, `killed`, `time_limit`) pass `evolutionResultSchema` Zod parse
- [x] Unit test: `schemas.test.ts` — negative test: invalid stopReason value `'bogus'` is rejected by `evolutionResultSchema`
- [x] Run existing evolution unit tests to confirm no regressions: `cd evolution && npx vitest run`

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — test deadline exit (including first-iteration edge case), abort signal exit, normal completion, deadline+budget interaction, priority ordering
- [x] `evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — test deadlineMs computation (uses startMs), stopReason propagation
- [x] `evolution/scripts/processRunQueue.test.ts` — test CLI flag parsing (import parseIntArg directly), default values, abort signal wiring
- [x] `evolution/src/lib/schemas.test.ts` — parameterized test for all stopReason enum values

### Integration Tests
- [x] No new integration tests needed — the changes are in-process logic, not DB interactions

### E2E Tests
- [x] Update `admin-evolution-run-pipeline.spec.ts` line 183 stopReason allowlist

### Manual Verification
- [x] Deploy updated service file to minicomputer: `sudo cp evolution/deploy/evolution-runner.service /etc/systemd/system/ && sudo systemctl daemon-reload`
- [x] Verify with `systemctl show evolution-runner.service -p TimeoutStartSec` → should show 7200
- [x] Trigger a test run and verify it can exceed 30 minutes without being killed

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes

### B) Automated Tests
- [x] `cd evolution && npx vitest run src/lib/pipeline/loop/runIterationLoop.test.ts`
- [x] `cd evolution && npx vitest run src/lib/pipeline/claimAndExecuteRun.test.ts`
- [x] `cd evolution && npx vitest run` (full suite, ensure no regressions)
- [x] `npm run lint && npx tsc --noEmit`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/architecture.md` — add `time_limit` to stop reasons table, document wall clock deadline
- [x] `evolution/docs/reference.md` — add `--max-duration` CLI flag to processRunQueue docs, update environment variables
- [x] `evolution/docs/minicomputer_deployment.md` — update TimeoutStartSec from 1800 to 7200, update --parallel from 2 to 10

## Review & Discussion

### Iteration 1 (3/3/3)

**Security & Technical (3/5)**:
- ✅ Fixed: `evolutionResultSchema` at schemas.ts:355 must also add `'time_limit'` — plan now includes this in Phase 3
- ✅ Fixed: `deadlineMs` now uses `startMs + maxDurationMs` instead of `Date.now() +`, accounting for claim+context time
- ✅ Fixed: Check ordering specified — abort signal first (imminent kill), then kill detection, then deadline

**Architecture & Integration (3/5)**:
- ✅ Fixed: `executePipeline()` signature gets both `deadlineMs` and `signal` in one pass (Phase 2, step 4)
- ✅ Fixed: `evolutionResultSchema` in schemas.ts explicitly called out in Phase 3
- ✅ Fixed: API route now gets `maxDurationMs: 240_000` (Phase 5) for Vercel protection
- ✅ Fixed: E2E assertion allowlist updated in Phase 6
- ✅ Fixed: `claimAndExecuteRun` stopReason propagation from pipeline result (Phase 2, step 6)

**Testing & CI/CD (3/5)**:
- ✅ Fixed: Test for deadline on first iteration with `iterationsRun=0` (Phase 7, test 1)
- ✅ Fixed: Test for deadline + budget interaction ordering (Phase 7, test 4)
- ✅ Fixed: Parameterized Zod schema test for all stopReason values (Phase 7, test 11)
- ✅ Fixed: Priority ordering test (abort > deadline) (Phase 7, test 5)
- ✅ Fixed: Test descriptions now include specific assertions
- ✅ Fixed: processRunQueue tests import `parseIntArg` directly (Phase 7, test 8)

**Minor issues noted (non-blocking)**:
- Default changed from 110min to 100min for 20-min buffer (safety margin for finalization)
- AbortSignal explicitly NOT passed to finalization (Phase 3 note)
- MetricsTab UI will show 'time_limit' as-is — acceptable, can add friendly label later

### Iteration 2 (5/4/4)

**Security & Technical (5/5)**: All critical gaps resolved. Minor: guard against `maxDurationMs <= 0` → added.

**Architecture & Integration (4/5)**: All critical gaps resolved. Minor: `executePipeline()` void return type needs changing to surface `stopReason` → now explicit in Phase 2. `RunnerOptions` already has `maxDurationMs` (line 23). `startMs` already computed inside `claimAndExecuteRun()` (line 91).

**Testing & CI/CD (4/5)**: All critical gaps resolved. Minor: added negative Zod validation test. Confirmed `schemas.test.ts` exists at `evolution/src/lib/schemas.test.ts`.

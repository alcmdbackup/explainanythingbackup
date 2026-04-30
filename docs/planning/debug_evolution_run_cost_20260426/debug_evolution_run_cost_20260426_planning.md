# debug_evolution_run_cost_20260426 Plan

## Background
This started as a debug investigation: explain the cost split for invocation `a824f9e0-0f23-47ef-93cb-8fb24ed50a83` on staging. The investigation identified the cost drivers (ranking dominates because it processes both texts × 2 bias-mitigation calls × N comparisons per variant) and surfaced a separate bug: `llmCallTracking` rows have not been written for any evolution run since 2026-02-22. The project pivoted into fixing that audit gap.

## Requirements (from GH Issue #NNN)
For invocation a824f9e0-0f23-47ef-93cb-8fb24ed50a83 on stage, help me understand the generation and ranking cost, and what is driving those.

Expanded scope (during investigation):
- Compare costs across runs and identify per-model cost effectiveness
- Investigate why some models appear thinking vs non-thinking
- Investigate the `llmCallTracking` audit gap and check if RLS is the cause
- Fix the audit gap with noisy-failure mode and a verification test

## Problem
The `llmCallTracking` table is empty for all evolution runs since 2026-02-22 — 387 completed runs across 5 weeks with zero tracking rows. Root cause: `saveLlmCallTracking` calls `createSupabaseServiceClient` from a `'use server'`-decorated file (Next.js-coupled), which misbehaves when invoked from the CLI batch runner (`processRunQueue.ts`). The failure is silent because the original code was fire-and-forget with `logger.warn`. Additionally, even when historic rows exist (pre-Feb-22), the `evolution_invocation_id` column is 100% NULL because the bridge never threaded it through.

## Options Considered
- [x] **Option A: Inject pre-built Supabase client into `saveLlmCallTracking` via `CallLLMOptions.trackingDb`**: backward-compatible (falls back to existing helper), small surface area, addresses the root cause directly. **Selected.**
- [x] **Option B: Move `createSupabaseServiceClient` to a Next.js-free file**: cleaner separation, but a bigger refactor with risk of breaking Next.js callers. Deferred as a follow-up.

## Phased Execution Plan

### Phase 1: Investigate — confirm root cause, rule out RLS
- [x] Query staging for invocation `a824f9e0` cost breakdown (44% gen / 56% rank)
- [x] Compute aggregate run-level metrics across latest 20 runs
- [x] Run cross-model quality comparison on the most-tested prompt
- [x] Verify thinking-vs-non-thinking via `llmCallTracking.reasoning_tokens` where available
- [x] Investigate audit gap; rule out RLS (service_role has bypassrls + INSERT privilege)
- [x] Identify root cause: Next.js-coupled `createSupabaseServiceClient` in CLI context

### Phase 2: Fix — inject db + noisy failure
- [x] Add `trackingDb?: SupabaseClient<Database>` to `CallLLMOptions` in `src/lib/services/llms.ts`
- [x] Thread `trackingDb` through `saveTrackingAndNotify` to `saveLlmCallTracking`
- [x] Use injected client when provided; fall back to `createSupabaseServiceClient` otherwise
- [x] Make first-failure log at `error` level (not warn) with structured fields
- [x] Add `EVOLUTION_TRACKING_STRICT=true` env var that throws on tracking failures
- [x] Reset `trackingFailureCount` to 0 on successful write + emit recovery log
- [x] Export `saveLlmCallTracking` and test helpers (`__resetTrackingFailureCount`, `__getTrackingFailureCount`)

### Phase 3: Wire through evolution bridge
- [x] In `claimAndExecuteRun.ts`, pass `trackingDb: supabase` and `evolutionInvocationId: opts?.invocationId` to `callLLM`
- [x] Update `LLMProvider` and `RawLLMProvider` interfaces to include `invocationId?: string` in opts
- [x] In `createEvolutionLLMClient.ts`, propagate `invocationId: options?.invocationId` to `rawProvider.complete`

## Testing

### Unit Tests
- [x] `src/lib/services/llms.test.ts` — 8 new tests in `saveLlmCallTracking` describe block:
  - injected `trackingDb` is used when provided
  - falls back to `createSupabaseServiceClient` when not provided
  - first failure logs at `error` level (not warn)
  - `EVOLUTION_TRACKING_STRICT=true` throws
  - default mode does NOT throw
  - failure counter resets on success
  - `evolution_invocation_id` is persisted on the row
  - DB error from insert throws

### Integration Tests
- [x] `evolution/scripts/verifyLlmCallTrackingFix.ts` — end-to-end live verification against staging (gated by `--apply` flag). Reproduces the CLI code path, exercises the strict-mode pre-fix failure, exercises the post-fix path with injected client, queries staging to confirm the row landed, asserts on field values (incl. `evolution_invocation_id`), then deletes the test row.

### E2E Tests
- [x] No new E2E tests required — this fix is at the LLM-client/bridge layer with no UI changes.

### Manual Verification
- [x] Ran `npx tsx evolution/scripts/verifyLlmCallTrackingFix.ts --apply` against staging — all 4 steps passed (pre-fix throws → post-fix succeeds → row landed → cleanup OK). Zero residual test rows confirmed via follow-up query.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — no UI changes in this fix.

### B) Automated Tests
- [x] `npx jest src/lib/services/llms.test.ts` — 62/62 pass (8 new + 54 existing)
- [x] `npx jest evolution/src/lib/pipeline/claimAndExecuteRun.test.ts` — 20/20 pass
- [x] `npx tsc --noEmit` — clean
- [x] Live staging verification script — all 4 checks passed end-to-end

## Documentation Updates
- [x] `docs/planning/debug_evolution_run_cost_20260426/debug_evolution_run_cost_20260426_research.md` — populated with full investigation findings, cost breakdown analysis, thinking-vs-non-thinking evidence, cost-effectiveness ranking, and root-cause analysis of the audit gap.

## Review & Discussion
This was a debug-investigation project that pivoted into a code fix during execution, so the typical /plan-review iteration cycle was not run. The fix follows the existing project patterns:
- Uses Zod schemas for validation (`llmCallTrackingSchema`)
- Uses `logger` from `server_utilities` (not `console.log`)
- Preserves the fire-and-forget guarantee in production (LLM calls don't fail on tracking failures)
- Adds a strict-mode env var for CI/dev catching of regressions
- All new behavior is unit-tested and verified end-to-end against staging

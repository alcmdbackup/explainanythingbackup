# Fix Test Isolation Issues Research

## Problem Statement
Two evolution tests fail intermittently in CI due to test-isolation defects on the **shared dev
Supabase**, where parallel CI jobs (`e2e-evolution` ∥ `integration-evolution`), other PRs, and the
nightly run mutate each other's rows. (1) `evolution-llm-cost-attribution.integration.test.ts`
asserts a spend-bucket RPC aggregate (expects 0.75, gets 0.25) because its `is_test=true` row is
deleted by a concurrent test-spend purge between the insert and the RPC read. (2)
`admin-evolution-iterative-editing.spec.ts` fails with an `evolution_variants_run_id_fkey` foreign-key
violation because the parent run is deleted before the pipeline persists its seed variant — a
run-lifecycle race correlated with the recent claim-gate migration (#1257) and tracked by nightly
release-health issue #1256. This project makes both tests resilient to concurrent DB mutation and
fixes the underlying run-deletion-before-persist race so evolution CI (including nightly) is reliably
green.

## Requirements (from GH Issue #1260)
These were root-caused during the `implied_rubric_evolution_fixes_20260621` finalize (the failures
surfaced when latest `main` was merged into that branch; neither is caused by that PR). Captured in
that project's plan doc under "Known CI failures — FIX LATER"; this project owns the fixes.

1. **Failure B — `evolution-llm-cost-attribution.integration.test.ts › "aggregates spend via the RPC and respects p_include_test"` (owner area: LLM spend tracking, #1250).**
   - Symptom: `expect(inclTotal).toBeCloseTo(0.75)` receives `0.25` (only the `is_test=false` row counts).
   - Root cause: the RPC `get_llm_spend_buckets` is correct (with `p_include_test=true` the
     `(p_include_test OR is_test=false)` clause returns all in-window rows; verified by reading
     migrations `20260620000003`/`0004` and by the test passing locally on the same dev DB). The
     `is_test=true` row is **physically deleted between the awaited insert and the RPC read** by a
     concurrent process purging test-flagged spend on the shared dev DB.
   - Fix: make the test independent of global RPC aggregate state under concurrency — re-read its own
     inserted ids (or assert on a query scoped to its unique `call_source` + `is_test`) rather than
     trusting the cross-row RPC sum; and/or identify & neutralize the concurrent `is_test` deleter so
     test spend rows are isolated.

2. **Failure A — `admin-evolution-iterative-editing.spec.ts:262 › "editing-born variants have non-default mu after post-cycle ranking"` (owner area: evolution claim-gate / pipeline, #1257, tracked by #1256).**
   - Symptom: `expect(|mu − 25| > 0.01)` receives `0` (mu stuck at default → no ranked variants).
   - Root cause: the seed-variant persist fails with
     `insert or update on table "evolution_variants" violates foreign key constraint
     "evolution_variants_run_id_fkey"` — the parent `evolution_runs` row is gone before the pipeline
     persists the seed variant → 0 variants → ranking never runs → mu unchanged.
   - Likely trigger: claim-gate migration #1257 (`claim_evolution_run LEFT JOIN → INNER JOIN for FOR
     UPDATE`, `supabase/migrations/20260622000001_…`) altered run claim/lifecycle ordering; corroborated
     by nightly E2E red on `main` today (release-health #1256).
   - Fix: ensure an in-flight pipeline's run row cannot be deleted/released before variant persist
     completes (claim/cleanup ordering or a guard); and ensure concurrent E2E cleanup
     (`cleanupAllTrackedEvolutionData` / spec `afterAll`) does not delete runs another in-flight spec
     still needs.

3. **Strengthen evolution test isolation generally.**
   - Audit evolution integration + E2E tests for shared-DB assumptions: aggregate-over-all-rows reads,
     global/`is_test`-pattern deletes, fixed (non-unique) identifiers, and cleanup that races
     in-flight pipelines.
   - Establish + document a per-run/per-worker scoping convention so tests assert only on data they own.

4. **Verify reliability under concurrency.** The two tests must pass when `integration-evolution` and
   `e2e-evolution` run simultaneously, and the nightly E2E must go green (drive toward closing #1256).

## High Level Summary (UPDATED after /research — premise changed)

**The /research pass overturned the initial framing.** The two failures have *different* root causes,
and **Failure B is already fixed on `main`.** The shared finding is real (concurrency on the shared dev
DB), but Failure B was a PostgREST truncation bug (not a deleter) and Failure A is substantially a
**real-AI pipeline flakiness + run/variant lifecycle** issue (not pure "test isolation"). Details:

### Failure B — RESOLVED on main (no work needed beyond verification)
- The **current** test (`evolution-llm-cost-attribution.integration.test.ts:17-86`) already carries the
  anti-flake fix (file comment lines 25-34): it seeds rows at a **unique far-future timestamp**
  (`EVENT_MS = Date.UTC(2099,0,1,12)+unique`) and queries a **tight ±1h window**, plus bounded read
  polling. 
- **Real root cause (per that comment):** a *wide* range over the shared dev DB returns thousands of
  bucket groups; **PostgREST caps returned rows and the RPC `get_llm_spend_buckets` has no `ORDER BY`,
  so the seeded rows were non-deterministically truncated out** → intermittent 0.5-vs-0.75. NOT a
  concurrent `is_test` deleter (the Explore sweep found no code/migration/trigger/janitor that deletes
  `llmCallTracking` by `is_test`; the only deleters are id/userid/call_source-scoped and don't match
  this test's rows). My initialize-time "concurrent deleter" hypothesis was wrong.
- **Landed via #1258** (`fix(costs): get_llm_spend_buckets 42804 — cast call_source/model to text`,
  the last commit touching the file) — present on `main` since after the failing implied-rubric runs,
  which is why the user's 17:30 re-merge (`d5617be31`) passed.

### Failure A — STILL LATENT (the real remaining work)
- Symptom unchanged: `Seed variant persist failed after retries: … violates foreign key constraint
  "evolution_variants_run_id_fkey"` → 0 variants → mu stays 25.
- The claim-gate fix **#1257** (`8a99c6539`, 2026-06-22 08:00) was **already on `main`** when the FK race
  fired again at ~18:00 (run 27991647393), so #1257 did **not** fix it. It passed in `d5617be31` only
  intermittently. **Nightly release-health #1256 is still OPEN** (E2E Nightly against production, run
  27938679142).
- **Contributing factors identified (not yet disambiguated):**
  1. **Real-AI generation failure on CI** — the E2E log showed `[WARN] getRunCostsWithFallback: runs
     with no cost data at any layer, count: 4`, the fingerprint of generations producing no billable
     output (provider 402/429/timeout — cf. the documented arena-only/402 wipeout pattern). A failed/empty
     generation can leave the run/variant lifecycle in the state that produces the FK error. This is the
     same real-AI-flakiness class that caused sibling tests to be **skipped** (`admin-evolution-budget-dispatch.spec.ts`
     is `test.skip`'d: "pipeline beforeAll timing out on CI… see admin-evolution-iterative-editing.spec.ts").
  2. **Concurrent run deletion** — Playwright runs evolution specs **fullyParallel, workers=2 in CI**
     (`playwright.config.ts:96,99`); `global-teardown.ts:244-271` deletes `evolution_runs`/`evolution_variants`
     by **`%[TEST]%`/`%[E2E]%` name pattern** (not per-id). The `evolution_variants.run_id` FK is **RESTRICT**
     (no explicit `ON DELETE CASCADE` found), so any delete of a run while its pipeline is mid-persist
     → exactly this FK violation. (Note: the run is awaited via `triggerAndWaitForRun` polling
     completed/failed, so teardown shouldn't fire mid-run within the *same* spec — the live vector is a
     **parallel sibling spec / cross-run cleanup or a stale-claim watchdog reclaim during a slow real-AI
     run**, which is why it's intermittent.)
- **Net:** Failure A is primarily an evolution **real-AI E2E reliability + run-lifecycle** problem, only
  partly "test isolation." A durable fix likely combines: (a) make the assertion not depend on a live
  real-AI generation succeeding on CI (mock/seed variants, or gate like the skipped siblings), and/or
  (b) fix the lifecycle so a failed/empty generation or a concurrent cleanup can't produce an FK error
  (e.g. don't delete runs by broad name pattern while any are active; or make persist tolerate-and-skip
  a vanished run instead of erroring), and (c) tie verification to closing nightly #1256.

## Key Findings
1. **Failure B is fixed on `main` (#1258)** — verify-only; the original "concurrent deleter" theory was wrong (real cause: PostgREST row-cap truncation of an unbounded-range, unordered RPC aggregate).
2. **Failure A is not fixed** — claim-gate #1257 didn't resolve it; nightly #1256 still open.
3. **`evolution_variants.run_id` FK is RESTRICT** — deleting/losing a run while a pipeline persists variants throws the observed error; no `ON DELETE CASCADE`.
4. **E2E evolution specs run in parallel (workers=2, fullyParallel)** and `global-teardown` deletes evolution rows by **broad name pattern** (`%[TEST]%`/`%[E2E]%`), a real cross-spec deletion vector.
5. **Real-AI generation failures on CI** (`runs with no cost data`) are a strong contributor and match the documented class of flaky real-AI evolution E2E (siblings already skipped).
6. **Integration tests are `maxWorkers:1`**; contention is cross-job/cross-PR, not intra-job.

## Open Questions (to resolve in brainstorm/plan)
1. **Scope:** Failure B needs no fix — should this project narrow to Failure A + a small isolation/RPC hardening, or keep the broader audit? (Recommend narrowing.)
2. **Failure A primary lever:** is the dominant cause the real-AI generation failure (→ make the test not depend on live generation) or the concurrent run-deletion race (→ fix teardown/lifecycle)? Needs a reproduction running e2e-evolution under load with generation logging to disambiguate.
3. Should `global-teardown` stop deleting evolution rows by broad name pattern (switch to tracked-id only), to remove the cross-spec deletion vector for ALL evolution E2E specs?
4. Should the RPC `get_llm_spend_buckets` get a defensive `ORDER BY` + bounded range contract (belt-and-suspenders for B, helps other callers)?
5. Is nightly #1256 the *same* root cause as the PR-CI iterative-editing failure, or a separate production real-AI issue?

## Decisions (scope, from user — 2026-06-22)
- **Scope → narrow to Failure A + small hardenings.** Failure B is verify-only (already fixed by
  #1258). Hardenings kept as belt-and-suspenders: (a) defensive `ORDER BY` + bounded-range contract on
  `get_llm_spend_buckets`; (b) switch `global-teardown` evolution cleanup off broad `%[TEST]%`/`%[E2E]%`
  name-pattern deletes → tracked-id only (removes the cross-spec deletion vector for ALL evolution E2E).
- **Failure A fix direction → BOTH:** (1) fix the run-lifecycle/teardown so a failed/empty generation
  OR a concurrent cleanup can't produce the `evolution_variants_run_id_fkey` error (don't delete active
  runs; make seed-variant persist tolerate a vanished run instead of throwing); AND (2) make the
  iterative-editing assertion not depend on a live real-AI generation succeeding on CI (seed/mock
  deterministic variants, or gate consistently with the already-skipped sibling).
- Open question #5 (is nightly #1256 the same root cause?) remains to confirm during execution; drive
  verification toward closing #1256.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (to read/refresh during /research)
- docs/feature_deep_dives/testing_pipeline.md — evolution test infrastructure + data factory/cleanup
- evolution/docs/architecture.md — run claim/lifecycle (claim-gate), pipeline execution
- evolution/docs/data_model.md — evolution_runs/variants FK relationships

## Code Files Read (during root-cause investigation)
- src/__tests__/integration/evolution-llm-cost-attribution.integration.test.ts (failing test + afterAll/directRow)
- supabase/migrations/20260620000003_get_llm_spend_buckets.sql + 20260620000004_spend_buckets_granularity_raise.sql (RPC logic — correct)
- src/__tests__/e2e/helpers/evolution-test-data-factory.ts (cleanup scope: tracked-id, FK-safe order)
- jest.integration.config.js (maxWorkers: 1)
- CI run logs: 27988932726 / 27991647393 (the two failing runs; FK-violation + RPC 0.25 evidence)

## Code Files Read (during /research)
- src/__tests__/integration/evolution-llm-cost-attribution.integration.test.ts (CURRENT main — already carries the far-future-timestamp/tight-window anti-flake fix; comment lines 25-34 give the real root cause)
- git log of that test + the iterative-editing spec + claim-gate (fixes: #1258 cost-attribution, #1257 claim-gate, #1255 reduce-e2e-cost)
- src/__tests__/e2e/setup/global-teardown.ts:244-271 (deletes evolution_runs/variants by `%[TEST]%`/`%[E2E]%` name pattern — cross-spec deletion vector)
- playwright.config.ts:96,99 (fullyParallel + workers=2 in CI → evolution specs run in parallel)
- jest.integration.config.js:69 (integration maxWorkers:1)
- src/__tests__/e2e/helpers/evolution-test-data-factory.ts (cleanup scope) ; CI e2e-evolution failure log (FK violation + "runs with no cost data")
- (Explore sweep) confirmed NO `is_test`-based deleter of llmCallTracking exists in code/migrations/janitor/cron

## Still to read (during brainstorm/plan, for Failure A)
- evolution/src/lib/pipeline/claimAndExecuteRun.ts + the "Seed variant persist failed after retries" persist/retry path (run-lifecycle vs FK)
- supabase/migrations/*evolution_claim_gate* + the `claim_evolution_run` RPC (stale-claim/watchdog reclaim semantics)
- the evolution_variants FK migration (confirm RESTRICT; consider ON DELETE CASCADE / persist-tolerates-missing-run)
- the latest e2e-nightly run (27938679142) to confirm whether #1256 is the same root cause

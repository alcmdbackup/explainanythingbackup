# Fix Test Isolation Issues Plan

## Background
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
   - Root cause: RPC is correct; the `is_test=true` row is physically deleted between the awaited
     insert and the RPC read by a concurrent test-spend purge on the shared dev DB.
   - Fix: make the test independent of global RPC aggregate state — re-read its own inserted ids (or
     assert on a query scoped to its unique `call_source` + `is_test`); and/or isolate test spend rows
     from the concurrent deleter.

2. **Failure A — `admin-evolution-iterative-editing.spec.ts:262 › "editing-born variants have non-default mu after post-cycle ranking"` (owner area: evolution claim-gate / pipeline, #1257, tracked by #1256).**
   - Symptom: `expect(|mu − 25| > 0.01)` receives `0` (mu stuck at default → no ranked variants).
   - Root cause: seed-variant persist fails with `evolution_variants_run_id_fkey` violation — the
     parent `evolution_runs` row is gone before the pipeline persists the seed variant.
   - Fix: ensure an in-flight pipeline's run cannot be deleted/released before variant persist
     completes (claim/cleanup ordering or a guard); ensure concurrent E2E cleanup does not delete runs
     another in-flight spec still needs.

3. **Strengthen evolution test isolation generally** — audit evolution integration + E2E tests for
   shared-DB assumptions (aggregate-over-all-rows reads, global/`is_test`-pattern deletes, fixed
   identifiers, cleanup racing in-flight pipelines); establish + document a per-run/per-worker data
   scoping convention.

4. **Verify reliability under concurrency** — both tests pass when `integration-evolution` and
   `e2e-evolution` run simultaneously; drive the nightly E2E green (toward closing #1256).

## Problem
**Scope updated after /research.** Failure B (`evolution-llm-cost-attribution`) is **already fixed on
`main` (#1258)** — its real cause was PostgREST row-cap truncation of an unbounded-range, unordered RPC
aggregate, not a concurrent deleter; it is now verify-only. The remaining work is **Failure A**: the
iterative-editing E2E intermittently fails with `evolution_variants_run_id_fkey` because (1) a real-AI
generation on CI produces no variants/cost (provider 402/429/timeout — same class that got sibling
specs skipped), and/or (2) the run row is deleted while a pipeline is still persisting variants — E2E
specs run in parallel (`workers=2`, fullyParallel) and `global-teardown` deletes evolution rows by broad
`%[TEST]%`/`%[E2E]%` name pattern against a `RESTRICT` FK. Claim-gate fix #1257 did **not** resolve it
and nightly release-health **#1256 is still open**. The fix is twofold: make the test not depend on a
live real-AI generation, and fix the run-lifecycle/teardown so a failed generation or concurrent cleanup
can't produce the FK error. (Full evidence: see the research doc "High Level Summary (UPDATED)".)

## Options Considered
- [x] **Option A: De-flake the test only** — leaves the lifecycle FK latent for real runs/nightly. *(Rejected as sole approach.)*
- [x] **Option B: Fix lifecycle only** — leaves the test dependent on real-AI succeeding on CI. *(Rejected as sole approach.)*
- [x] **Option C (CHOSEN): Lifecycle fix FIRST (gets CI green) + de-flake + small hardening.** Fix the
  run-deletion race at its sole vector (the cross-spec teardown) and make persist fail-closed-correct,
  THEN remove the test's real-AI dependence. Targeted; no full per-worker isolation rewrite.
- [x] **Out of scope:** Failure B fix (#1258 — verify-only); switching `evolution_variants.run_id` to
  `ON DELETE CASCADE` (a prod run-deletion behavior change); full per-worker schema isolation infra;
  converting all ~15 untracked evolution specs to `trackEvolutionId` (too large — handled instead by
  making the pattern-delete active-run-aware).

> **Sequencing decision (from plan-review):** Phase 1 (lifecycle) is the actual fix that turns CI green
> and is the ONLY lever that can affect nightly #1256 — and only once it ships to **production**. Phase 2
> (de-flake) is a separate robustness/cost improvement. Do Phase 1 first.

## Phased Execution Plan

### Phase 0: Verify Failure B is resolved (no code)
- [x] Re-run `npm run test:integration:evolution` on this branch; confirm `evolution-llm-cost-attribution`
  passes (already fixed by #1258 — far-future-timestamp + tight window; root cause was PostgREST
  row-cap truncation of an unordered, unbounded-range aggregate, NOT a deleter). No code change.

### Phase 1: Fix the run-deletion FK race (PRIMARY — turns CI green)
**Confirmed deletion vector:** the stale-claim watchdog only sets `status='failed'` (NOT a deleter), so
the SOLE vector is `global-teardown.ts` Step 5b deleting evolution rows by broad `%[TEST]%`/`%[E2E]%`
name pattern (`evolution_runs`/children, ~lines 244-271) while a PARALLEL spec's pipeline
(`workers=2`, fullyParallel) is mid-persist; `evolution_variants.run_id` is FK `RESTRICT` → the observed
`evolution_variants_run_id_fkey` error.
- [x] **Make the teardown pattern-delete active-run-aware** — do NOT remove it (it is the cleanup safety
  net for the ~15 evolution specs that raw-insert without `trackEvolutionId`; removing it would LEAK
  orphans = more pollution). Apply the `status NOT IN ('pending','claimed','running')` exclusion at the
  **`testRunIds` collection step** (`global-teardown.ts` ~256-266, the `.select('id').in('strategy_id'/
  'experiment_id')` queries) so excluded runs are absent from the single id list used for BOTH the child
  deletes and the run delete (~268-272) — one filter point, no child-orphans. Keep the existing tracked-id
  sweep (`cleanupAllTrackedEvolutionData`) as-is. NOTE: this exclusion is best-effort (a TOCTOU window
  remains between the status SELECT and the DELETE); the Phase-1 persist guard below is the authoritative
  backstop that actually closes the race.
- [x] **Defense-in-depth: make seed-variant persist fail-closed-correct** (`claimAndExecuteRun.ts`,
  the "Seed variant persist failed after retries" upsert/retry path, ~lines 411-432). On the FK error,
  re-assert run existence (`SELECT id FROM evolution_runs WHERE id = runId`): if the run is **provably
  gone**, **gracefully abort** the pipeline (no further variant/invocation/metric writes — they would all
  FK too — via the existing `markRunFailed(db, runId, msg, errorCode)` helper at `claimAndExecuteRun.ts:380`
  with a distinct `error_code`), NOT skip-and-continue; if the run **still exists**, the FK error is a real
  fault → **rethrow** (never swallow — honors the repo's fail-closed data principle / the B008 "silent
  upsert failure regenerates the seed" warning; note a watchdog-`failed`-but-not-deleted run still exists,
  so the guard correctly rethrows there). This guard is the authoritative backstop (closes the teardown
  TOCTOU); the active-run-aware teardown narrows the window. The same run-FK risk exists at the other
  variant-persist sites (`evolveArticle` loop, `MergeRatingsAgent`) — but the teardown fix closes the
  vector for all of them, so a guard there is defense-in-depth: assess, don't assume.
- [x] **Deterministic integration test for the guard:** create a run, delete it, attempt the seed-variant
  persist → assert graceful abort (no unhandled throw; run marked aborted/failed with the reason). This
  proves the fix without a flaky live pipeline.

### Phase 2: De-flake the iterative-editing E2E off live real-AI (robustness + cost)
**Decision (from plan-review): no agent-level LLM mock exists today** (`E2E_TEST_MODE` mocks only
seed-gen + judge-eval, not the generate/iterative_editing agents). Commit to ONE mechanism:
- [x] **Primary: add a deterministic test-LLM path for the evolution generate/edit agents under
  `E2E_TEST_MODE`** — the concrete chokepoint is **`createEvolutionLLMClient`**
  (`evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts`, constructed at
  `claimAndExecuteRun.ts:345` and injected as the single `input.llm`/`EvolutionLLMClient` into every
  agent), so one mock there makes the in-route pipeline complete fast + deterministically with no real
  provider calls. Follow the existing `E2E_TEST_MODE` precedent (`generateSeedArticle.ts`,
  `runJudgeEval.ts`). Systematic (benefits all real-AI evolution E2E; could later unskip
  `admin-evolution-budget-dispatch.spec.ts`). Size: new but contained.
- [x] **Fallback if the above balloons:** seed deterministic editing-stage variants via the test-data
  factory and assert the persistence + ranking (mu divergence) path directly, without invoking
  `/api/evolution/run`. (Trade-off: loses live generate→edit coverage; that path stays covered by the
  real-AI `run-pipeline` spec + nightly.)
- [x] Rule compliance: do NOT add `test.skip` (rule 8) — if any gating is unavoidable it needs
  `eslint-disable flakiness/no-test-skip` + a reason. Preserve the editing→ranking→mu-divergence assertion.
- [x] Note: the failing assertion (line 262) already early-returns on 0 variants, so the real CI failure
  is the FK throw making the run fail — confirm Phase 1 alone turns it green; Phase 2 then removes the
  real-AI dependency/cost/latency so it's deterministic.

### Phase 3: Small hardening (`get_llm_spend_buckets`)
- [x] Base the new migration on the **latest** definition `supabase/migrations/20260622000002_*` (#1258,
  the `call_source/model` text cast) — NOT the older 0003/0004 — and preserve the exact
  `REVOKE ALL … FROM PUBLIC` + `GRANT EXECUTE … TO service_role` block; idempotent `CREATE OR REPLACE`.
- [x] Add a deterministic `ORDER BY bucket` AND document the **bounded-range contract** in the function
  comment + caller docs. NOTE precisely: `ORDER BY` does NOT prevent PostgREST row-cap truncation — it
  only makes truncation deterministic; the real protection is a bounded range (the dashboard already
  queries narrow ranges). Frame the change as "deterministic output + documented bounded-range contract",
  not "fixes truncation". Optional/low-priority — drop if it risks the #1258 fix.
- [x] Run `npm run lint:migrations` + `npm run migration:verify` (Docker) for the new migration; note it
  trips the high-blast PR gate (`supabase/migrations/**`) so /finalize needs the push-gate.
- [x] `evolution_variants.run_id` FK is `RESTRICT` (no `ON DELETE CASCADE`) — document as intentional;
  changing it is explicitly out of scope.

## Testing

### Unit Tests
- [x] Colocated unit tests for the Phase-1 persist fail-closed guard logic (run-existence re-check →
  abort vs rethrow) where it can be isolated (e.g. `evolution/src/lib/pipeline/*.test.ts`)

### Integration Tests
- [x] **New (Phase 1):** `src/__tests__/integration/evolution-*.integration.test.ts` — deterministically
  simulate the deleted-run FK condition (create run → delete → attempt seed-variant persist) and assert
  graceful abort, not an unhandled throw; and that an EXISTING-run FK error still rethrows
- [x] `evolution-llm-cost-attribution.integration.test.ts` — Phase 0 verify pass; if Phase 3 adds
  `ORDER BY`, keep an assertion that a bounded-range query returns the seeded rows
- [x] If the teardown change is testable, assert active runs are NOT deleted by the pattern path

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — green with Phase 1;
  after Phase 2, deterministic (no live real-AI), asserts editing variants persist + mu diverges from
  default after ranking; zero `evolution_variants_run_id_fkey` errors

### Manual Verification
- [x] **Stability gate (mandated by testing_overview):** run the iterative-editing spec **≥5×** under
  `workers=2` (the actual race condition) — all green is the acceptance criterion; any failure aborts the
  fix. Run alongside a second evolution spec to recreate the cross-spec teardown race

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Not a UI change. Run the iterative-editing `@evolution` spec on a local server via ensure-server.sh

### B) Automated Tests
- [x] `npm run test:integration:evolution` (Phase 0 confirm + the new deleted-run guard test)
- [x] `npm run lint:migrations` + `npm run migration:verify` (Phase 3 RPC migration)
- [x] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts --project=chromium --repeat-each=5 --workers=2` (5× stability; `--workers=2` is required to reproduce the cross-spec teardown race locally — the default is only CI)

### C) Nightly #1256 (gated on a production release)
- [x] **#1256 cannot be verified on this PR.** `e2e-nightly.yml` runs `@evolution` against DEPLOYED
  PRODUCTION with real AI. Only the **Phase 1 lifecycle fix reaching production** (via a later
  `/mainToProd`) can affect it; PR-branch/test changes do not. After this merges to main AND is released
  to production, confirm the next nightly is green and close/comment on #1256. Do NOT claim #1256 fixed
  from PR CI.

## Rollback / safety
- [x] Teardown change is revert-only (a guarded `WHERE status NOT IN (...)` filter); no schema impact.
- [x] Persist guard is fail-closed (rethrows on a real fault), so it cannot mask production data loss; if
  it misbehaves, revert the catch block — the prior behavior (throw) is restored.
- [x] Phase-3 migration is `CREATE OR REPLACE` — rollback = re-apply the #1258 (`20260622000002`) body.
- [x] No change to product run-deletion semantics (FK stays RESTRICT).

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/feature_deep_dives/testing_pipeline.md` — evolution test-isolation convention (teardown must
  not delete active runs; prefer `trackEvolutionId`; don't depend on live real-AI; assert on own data)
- [x] `evolution/docs/architecture.md` — the Phase-1 run-lifecycle persist-guard (graceful abort on a
  vanished run) + the active-run-aware teardown contract
- [x] `evolution/docs/data_model.md` — `evolution_variants → evolution_runs` FK is RESTRICT (intentional)
  + the `get_llm_spend_buckets` ORDER BY/bounded-range contract (Phase 3)

## Review & Discussion

### /plan-review — CONSENSUS REACHED (2 iterations, 2026-06-22)

| Iteration | Security & Technical | Architecture & Integration | Testing & CI/CD |
|---|---|---|---|
| 1 | 3/5 | 2/5 | 3/5 |
| 2 | **5/5** | **5/5** | **5/5** |

**Iteration 1 critical gaps (fixed):**
- Tracked-id-only teardown would strip the cleanup safety net from ~15 untracked evolution specs → made
  the pattern-delete **active-run-aware** (keep it; exclude pending/claimed/running) instead of removing it.
- Phase 1 de-flake referenced a non-existent agent-level LLM mock → committed to a concrete mechanism
  (deterministic test-LLM at `createEvolutionLLMClient` under `E2E_TEST_MODE`; factory-seed fallback).
- "persist tolerates a vanished run" could mask production data loss → made fail-closed: re-assert run
  existence, graceful-abort (via `markRunFailed`) ONLY when provably gone, else **rethrow**.
- #1256 closure link was mechanically wrong (nightly = deployed prod + real AI) → added Verification C
  gating #1256 on a production release, not PR CI.
- Phase 3 ORDER BY mischaracterized as a truncation fix → reframed as deterministic output + documented
  bounded-range contract; base the migration on `20260622000002` (#1258), preserve REVOKE/GRANT.
- No stability gate → added `--repeat-each=5 --workers=2` + a deterministic deleted-run integration test
  + a Rollback section.

**Iteration 2 minors folded in (post-consensus polish):** pinned the teardown filter to the `testRunIds`
collection step + noted the TOCTOU/persist-guard-authoritative relationship; reused `markRunFailed`;
named the `createEvolutionLLMClient` boundary; pinned `--workers=2` in the verification command.

**Status:** ✅ Ready for execution. Phase 1 (lifecycle) first → turns CI green; Phase 2 de-flake; Phase 3
hardening (touches `supabase/migrations/**` → high-blast gate + migration:verify). #1256 verification is
gated on a later production release.

# Playwright Sweep Evolution Bugs UX Issues Plan

## Background
Use Playwright (headless, via the MCP server) to systematically explore the evolution admin UI and catalogue bugs / UX issues, then fix the highest-value functional ones. Two sweeps were run: a broad pass across all `/admin/evolution/*` routes, and a focused deep-dive on the newer **Tools** group (Match Viewer, Judge Rubrics, Prompt Editor, Judge Lab + subroutes, Implied Rubric Weights) and the **Criteria** entity.

## Requirements (from GH Issue #1265)
- Use playwright to look for evolution admin UI bugs or UX issues. Don't stop until done.
- Follow-up (this revision): update the plan with the Tools + Criteria findings, then fix the highest-value functional bugs.

## Problem
The evolution admin UI spans ~30 routes with complex interactive state (filters, sorts, pagination, URL-synced tabs, wizards, D3 visualizations, auto-refresh, localStorage column pickers, LLM-backed tools). Regressions and UX rough edges accumulate across the many evolution feature projects. The sweep surfaced functional bugs (silent validation no-ops, broken edit forms, a React setState-in-render, a test-content filter gap) and UX/a11y issues (missing headings, unlabeled toggles, inconsistent titles).

## Findings summary (catalogued — see findings docs)
- **Broad sweep:** `..._findings.md` — 24 findings (#1–#24).
- **Tools + Criteria sweep:** `tools_and_criteria_findings.md` — 30 findings (T1–T30).
- Total: 54 distinct findings, severity-tagged (S1 crash · S2 functional · S3 UX · S4 polish · A11y).

## Options Considered
- [x] **Option A — exploratory MCP sweep, log to findings docs** (discovery): chosen, complete.
- [x] **Option C — fix the highest-value functional bugs with unit tests + (where applicable) a regression check** (durability): chosen for the fix phase below.
- [x] **Option B — author broad new E2E specs for every finding**: rejected for now (too slow; the systemic UX/a11y cluster is deferred to a follow-up project).

## Scope decision (what this PR fixes vs. defers)
**Fix now** — the highest-value, well-scoped functional bugs (root cause understood, contained blast radius, unit-testable):
- #1/#9, #13/#14 (already implemented this session), plus T21, T4, T8, T1, T16.

**Defer to a follow-up** (documented in findings, not in this PR) — the systemic UX/a11y cluster, because it spans many shared components and is better as one cohesive pass: silent-no-op validation (#23/T17/T20/T24), dialog `aria-describedby` (#15/T3), toggle `aria-pressed` (T23), generic/inconsistent page titles (#11/T7/T10/T11), missing `<h1>` on Judge Lab subroutes (T9), entity-list sortability feature (#6/#12/T27), and the assorted S4 polish items.

## Phased Execution Plan

### Phase 1 — Test-content classifier leak (#1/#9) — ✅ DONE (migration table-name fixed after plan-review)
- [x] Broaden `isTestContentName` in `evolution/src/services/shared.ts`: add `[testevo]` + regex `(^|[-_ ])\d{10,13}([-_ ]|$)` (trailing/space/underscore-delimited timestamps).
- [x] Mirror in the `evolution_is_test_name` Postgres function via migration `supabase/migrations/20260623000001_evolution_is_test_name_broaden_patterns.sql`; backfill-reflag **all 7** tables carrying `is_test_content` (strategies, prompts, experiments, criteria, judge_rubrics, style_fingerprints, **`evolution_weight_inference_sessions`**).
- [x] **plan-review fix:** the 7th backfill originally targeted a non-existent relation `evolution_wi_sessions` (that name is only a constraint/trigger PREFIX) — corrected to the real table `evolution_weight_inference_sessions` (created in `20260619000002`, has `is_test_content`). Without this the whole migration aborts + fails CI `migration-verify-test`.
- [x] Update `TEST_NAME_FIXTURES` + unit tests (`shared.test.ts`, 44 pass); verified the SQL regex in an isolated Postgres (`t|t|t|t|f|f|f`); `lint:migrations` clean.
- [x] **DB-level coverage (plan-review gap):** the SQL function's new patterns are currently only TS-tested. Update `src/__tests__/integration/evolution-is-test-content-backfill.integration.test.ts` so its Step-3 invariant loops over **all 7** tables (it currently covers only strategies/prompts/experiments) and its client-side `isTestNameMirror` matches the NEW predicate (add `[testevo]` + the new regex); add fixtures for `[TESTEVO]`/trailing-timestamp rows so CI asserts the broadened SQL function (the stale mirror would otherwise FAIL the test).
- [x] **Doc-hygiene (review gap):** fix the TWO stale references to the non-existent `evolution_is_test_name.integration.test.ts` — in `evolution/src/services/shared.test.ts:~125` AND the source comment `evolution/src/services/shared.ts:~47` — to point at `evolution-is-test-content-backfill.integration.test.ts`.

### Phase 2 — Variant-list dead sort affordance (#13/#14) — ✅ DONE
- [x] Remove the false `sortable: true` on the Rating column in `src/app/admin/evolution/variants/page.tsx` (EntityTable rendered a ▲ + pointer but `onSort` was never wired and `listVariantsAction` has no sort param → dead click). Verified live (header now plain "Rating") + 13 page tests pass.

### Phase 3 — Judge-rubric editor weight load (T21, S2)
- [x] **Bug:** editing an inferred/exported rubric loads weights as raw 0–1 fractions → "1% / 100%" indicator → Save permanently disabled. **Root cause (verified):** `evolution_judge_rubric_dimensions.weight` is mixed-unit — the manual builder (`judge-rubrics/page.tsx`, evenSplit) writes 0–100, but weight-inference "Export as judge rubric" (`weightInferenceActions.ts:~971`, `fit.weights` sum to 1.0) writes 0–1. The edit form (`judge-rubrics/page.tsx` `openEdit()`, ~line 70: `weight: x.weight`) loads the raw value with no conversion.
- [x] **Fix (sum-based heuristic — resolves the double-scaling risk both reviewers flagged):** extract a **pure helper** `hydrateDimensionWeights(dims): {…, weight:number}[]` that computes `Σweight`; if `Σ` is ≈1 (e.g. within [0.5, 1.5]) treat as fractions and `×100` (rounding so the displayed set sums to 100), else assume already 0–100 and pass through. Use it in `openEdit()`. The heuristic is robust because a real 0–100 set can never sum to ~1 and a 0–1 set can never sum to ~100. Persist on save in 0–100 (the manual unit); **no convert-back needed** — judge-time consumption re-normalizes to sum-1 (`rubricJudge.ts normalizeDimensions`), so re-saving an exported rubric as 0–100 does not change judging.
- [x] **Rounding rule (review nit):** when scaling fractions ×100, round each and put the remainder on the first dimension (mirroring the builder's evenSplit) so a 0.333/0.333/0.334 set deterministically yields 33/33/34 = exactly 100 (not 99, which would re-disable Save).
- [x] **(Optional hardening, same PR if cheap):** also make the export producer write 0–100 so no NEW 0–1 rows are created; the load-side heuristic still covers legacy rows. Skip if it widens blast radius. Either way, add a one-line comment near `evolution_judge_rubric_dimensions.weight` reads noting the column is **mixed-unit** — always hydrate/normalize before display/compute.
- [x] **Test:** unit-test `hydrateDimensionWeights` — (a) dims summing to 1.0 → weights summing to 100; (b) dims summing to 100 → unchanged (no double-scale); (c) a single-dim 0–1 (1.0) → 100.

### Phase 4 — RubricEditor setState-in-render (T4, S2)
- [x] **Bug:** "+ Add anchor" triggers `Cannot update a component (FormDialog) while rendering a different component (RubricEditor)`. **Root cause (verified):** `src/app/admin/evolution/criteria/RubricEditor.tsx` calls `onChange(next)` **inside** the `setAnchors((curr)=>{…})` updater (lines ~42/50/58), so the parent FormDialog state updates during RubricEditor's render (StrictMode double-invokes updaters).
- [x] **Fix:** compute `next` and call `onChange(next)` in the event-handler body (or a value-keyed `useEffect`), NOT inside the `setAnchors` updater. Keep existing `RubricEditor.test.tsx` assertions (onChange called with the new array on add/remove/edit) green.
- [x] **Test (review gap — isolation can't reproduce it):** RubricEditor-in-isolation with a `jest.fn()` onChange will NOT fire the warning (no real parent setState), so a console spy there is dead. **Required:** a parent+child **composition** test — a wrapper component whose `onChange` calls a real `setState`, then `jest.spyOn(console,'error')` asserts NO "Cannot update a component while rendering" warning on add-anchor. Keep the existing `RubricEditor.test.tsx` onChange-called-once assertions green. (jest has no StrictMode, so the composition test is the real regression guard; the pure move-onChange-out-of-updater change is what fixes it.)

### Phase 5 — Test criteria leak into rubric dimension picker (T8, S3)
- [x] **Bug:** the Judge Rubrics "New rubric" dimension picker lists `TESTEVO-criterion-…` test criteria that the Criteria list hides. **Root cause (verified — was mis-stated originally):** `judge-rubrics/page.tsx:52` already calls `listCriteriaAction({ filterTestContent: false, … })`; `listCriteriaAction` filters only when the flag is truthy (`criteriaActions.ts:79 if (input.filterTestContent)`), so passing `false` = no filter = the leak. (NB: `listJudgeRubricsAction` uses the inverse convention `!== false`, which is why `false` was wrongly chosen.)
- [x] **Fix:** change `judge-rubrics/page.tsx:52` (the `listCriteriaAction` call) to `filterTestContent: true` (or omit it). This `criteria` state feeds BOTH the New and Edit dimension pickers — intended (test criteria shouldn't be selectable into real rubrics); a draft's already-selected dims are independent of the criteria list, so an Edit draft referencing a test criterion is preserved. **Leave line 51 (`listJudgeRubricsAction`, `filterTestContent: false`) untouched** — that controls the rubric LIST and is a separate concern; flipping it would hide test rubrics an admin may want to see.
- [x] **Test:** assert `listCriteriaAction` is called with `filterTestContent: true` from the page (RTL spy on the action), and/or an integration assertion that the action excludes `is_test_content=true` rows. Add a small RTL test that an Edit draft with a pre-selected (now-filtered) dim still renders it selected.

### Phase 6 — Raw Zod-issue JSON in dialog validation (T1, S3)
- [x] **Bug:** Criteria New/Edit dialog (Min>Max) shows the literal `[{"code":"custom","message":"max_rating must exceed min_rating",…}]` instead of a human message. **Root cause (verified — was mis-located originally):** NOT FormDialog (it just renders `result.error.message`). A `ZodError` thrown by `criteriaActions` `.parse()`/superRefine flows through `adminAction` → `handleError`/`categorizeError` in **`src/lib/errorHandling.ts`**, which has no `ZodError` branch, so it falls through to the UNKNOWN branch returning `error.message` — and a ZodError's `.message` IS the serialized issues array.
- [x] **Fix:** add a `ZodError` branch in `categorizeError` (`src/lib/errorHandling.ts`) returning `error.issues.map(i => i.message).join('; ')` (validation category). **Placement (review gap):** insert it as the FIRST `instanceof Error` check — immediately after the `if (!(error instanceof Error))` guard and BEFORE the `error.message.toLowerCase()` substring ladder (timeout/api/database/validation/schema) — so a serialized issues-array message can't be mis-bucketed by a coincidental substring. `import { ZodError } from 'zod'`. Single canonical fix point — every admin dialog (criteria, style-fingerprint) routes through `adminAction → handleError`; the criteria page renders `result.error?.message`, so this fixes the symptom. (Only the **Create** path throws a `ZodError` — `createCriteriaSchema.parse()` `.refine`; the Update path already throws a plain `Error`, so it's unaffected.)
- [x] **Test (review gap — `categorizeError` is private):** test via the **exported** `handleError(new ZodError(createCriteriaSchema.safeParse(badInput).error.issues), ctx)` (or build a real `ZodError` from `createCriteriaSchema.parse()` in a try/catch) → asserts `.message === "max_rating must exceed min_rating"` (not raw JSON); existing `errorHandling.test.ts` cases still pass.

### Phase 7 — Prompt Editor config label counter (T16, S3)
- [x] **Bug:** "+ Add config" labels skip numbers (config 1, 3, 5…). **Root cause (verified):** `src/app/admin/evolution/prompt-editor/page.tsx:~126` mutates `nextId.current++` INSIDE the `setConfigs(...)` updater → StrictMode double-invokes the updater → double increment. (`nextId` is also reset on unit-change at ~line 120 — preserve that.)
- [x] **Fix:** extract a **pure helper** `nextConfigId(configs): number` = `Math.max(0, ...configs.map(c=>c.id)) + 1`, computed in the handler body (outside any updater); keep the unit-change reset coherent (reset derives from configs, not a mutable ref).
- [x] **Test:** unit-test `nextConfigId` — `[{id:1}]`→2, `[{id:1},{id:2}]`→3, `[]`→1 — and (if feasible) an RTL test that two adds yield labels config 1, 2, 3.

### Phase 8 — T30 (re-judge rubric defaults to Article for paragraph matches)
- [x] **Decision:** **DEFER** to the follow-up project (out of scope for this PR). It's a real S3 default-selection bug but lives in the Match Viewer re-judge sandbox (separate component) and is lower-blast than Phases 3–7. Documented in `tools_and_criteria_findings.md` T30. Listed here only so it's explicitly placed (review gap).

## Testing

### Unit Tests
- [x] `evolution/src/services/shared.test.ts` — classifier fixtures (DONE, 44 pass).
- [x] `src/app/admin/evolution/variants/page.test.tsx` — variants list (DONE, 13 pass).
- [x] Phase 3: unit-test the extracted `hydrateDimensionWeights` pure helper (3 cases above) — colocate next to the judge-rubrics page or in a `weights` util with its own `.test.ts`.
- [x] Phase 4: add a **parent+child composition** test (real-setState wrapper + console.error spy) — NOT an isolation spy; keep `RubricEditor.test.tsx`'s single-onChange assertions.
- [x] Phase 5: RTL spy that `listCriteriaAction` is called with `filterTestContent: true`; Edit-draft-preserves-selected-dim test.
- [x] Phase 6: extend the `src/lib/errorHandling` test with a `ZodError` case.
- [x] Phase 7: unit-test the extracted `nextConfigId` pure helper.
- [x] **Testability note (review gap):** Phases 3 & 7 logic is currently inline in page components with no colocated test. The fix MUST extract the pure helpers above so they're unit-testable without full RTL/server-action mocking.

### Integration Tests
- [x] **(Phase 1 gap)** Update `src/__tests__/integration/evolution-is-test-content-backfill.integration.test.ts`: extend its Step-3 invariant loop from 3 → **all 7** tables, update its client-side `isTestNameMirror` to the NEW predicate (`[testevo]` + `(^|[-_ ])\d{10,13}([-_ ]|$)`), and add `[TESTEVO]`/trailing-timestamp fixtures so CI asserts the broadened **SQL** function (otherwise the stale mirror false-fails). Auto-skips if evolution tables not migrated locally; CI runs it post-`deploy-migrations`.
- [x] There is no separate `evolution_is_test_name.integration.test.ts` (the comment in `shared.test.ts` referencing one is aspirational) — DB-level assertion is folded into the backfill integration test above; fix the stale comment.
- [x] Phase 5: if practical, assert the `is_test_content` filter at the `listCriteriaAction` level in an evolution integration test.

### E2E Tests
- [x] Not adding new E2E specs in this PR (discovery-only findings). Existing `@evolution` admin specs must still pass. **Note:** Phases 3–7 touch `src/app/admin/evolution/**`, so `/finalize` will run the `@evolution` E2E suite (admin host-gated) in addition to `@critical`.

### Manual Verification
- [x] Re-verify each fixed bug live via Playwright MCP on the local server (rubric edit Save enabled; add-anchor no console error; dimension picker hides test criteria; criteria Min>Max shows a human message; prompt-editor labels 1,2,3).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Headless re-check of Phases 3–7 against the local dev server (relaunch server + idle-timestamp keep-alive first).

### B) Automated Tests
- [x] `npm run lint && npm run typecheck && npm run build`.
- [x] `npm run test` (unit) incl. the new tests; `npm run test:integration` (evolution); `npm run test:e2e:critical` + `:evolution` (admin specs touched).
- [x] `npm run migration:verify` (Docker) — re-run after the table-name fix; note the known local env gap (`anon` role / `pg_net`) means CI's `migration-verify-test` is the authoritative run. The migration now references only real tables, so CI verify should pass.

### C) Gates / high-blast acknowledgement (CLAUDE.md)
- [x] This is a **high-blast PR** (touches `supabase/migrations/**`): `gh pr create` requires a valid `.claude/push-gate.json` for HEAD, written by `/finalize`. CI runs `deploy-migrations` (staging) → `generate-types` → `migration-verify-test` (Docker) + `lint-migrations-idempotent` + `check-migration-order` + `check-migration-append-only`.
- [x] Migration version `20260623000001` is the next free slot after `origin/main`'s latest (`20260622000004`); re-confirm no collision at finalize (per the known cross-branch collision risk).

## Documentation Updates
- [x] `evolution/docs/visualization.md` — note the criteria registry list does not show the 5 metric columns (T2), and the criteria "By Prompt" tab is a stub (T6); correct the criteria Runs-tab definition (T26).
- [x] `evolution/docs/reference.md` — only if a config/error detail proves stale (none required so far).

## Review & Discussion
**/plan-review — consensus reached after 3 iterations (Security 5/5, Architecture 5/5, Testing 5/5).**

- **Iteration 1 (2/2/2):** all three reviewers independently caught that the already-"done" migration `20260623000001` backfilled a **non-existent relation `evolution_wi_sessions`** (real table: `evolution_weight_inference_sessions`) — would abort the transaction + fail CI. Also: T21 load-side ×100 would double-scale 0–100 rubrics; T1 mislocated to FormDialog (belongs in `errorHandling.categorizeError`); T8 mis-stated (call already passes `filterTestContent:false` → flip to `true`); the cited anti-drift integration test doesn't exist and the existing backfill integration test is stale (3/7 tables, old predicate mirror); Phases 3/7 "unit tests" needed extractable pure helpers.
- **Fixes applied + verified:** migration table-name corrected and the full body (function + all 7 backfills) **verified end-to-end in an isolated Postgres** (`evolution_weight_inference_sessions` now flags `[TESTEVO]`/`Gate … real` rows correctly). T21 → sum-based heuristic pure helper `hydrateDimensionWeights`. T1 → `ZodError` branch inserted FIRST in `categorizeError`, tested via exported `handleError`. T8 → flip line 52 to `true`, leave line 51 untouched. Integration test → 7-table loop + new-predicate mirror + new fixtures; both stale comments fixed. Phases 3/7 → pure helpers; Phase 4 → mandatory parent+child composition test. T30 explicitly deferred.
- **Iteration 2 (5/5/4) → Iteration 3 (5/5/5):** Testing's remaining test-spec gaps (private `categorizeError`, branch placement, dead isolation spy) resolved.

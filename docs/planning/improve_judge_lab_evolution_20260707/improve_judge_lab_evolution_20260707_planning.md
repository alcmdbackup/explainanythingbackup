# Improve Judge Lab Evolution Plan

## Background
Make improvements to the Judge Lab — the systematic, persisted judge-evaluation tool in the evolution
admin UI (`/admin/evolution/judge-lab`) that runs batch A/B/TIE judge sweeps over frozen test sets and
ranks judge settings by decisive rate. Two improvements are requested: (1) fix a
model-communication error when selecting `deepseek-v4-flash` or `google/gemini-2.5-flash-lite` as the
judge model, and (2) add the ability to edit a test set and view its contents from the test-sets menu.

## Requirements (from GH Issue #1174)
- Trying to use deepseek-v4-flash or google/gemini-2.5-flash-lite results in an error 'error communication with AI model'.
- Want to add the ability to edit test sets and view their contents, from the test sets menu

## Problem
**Requirement 1 is mis-stated as a model bug; the investigation (20-agent, DB-backed) showed the two
named models are correctly registered and routed and have proven-working judge calls.** The generic
"error communication with AI model" is produced by two real defects: (A) `categorizeError()`
(`src/lib/errorHandling.ts:69-75`) masks the true provider error into a generic string, and the
Judge Lab UI discards `res.error.details`; (B) the judge path calls plain `callLLM`
(`runJudgeEval.ts:226`) with all clients at `maxRetries:0` and no retry loop, so a single transient
429/5xx/timeout aborts a sweep cell and leaves an orphan 0-call run. Secondary: `trackingDb` is not
wired in the action path (successful runs leave no `llmCallTracking` rows), the dropdown offers
env-incompatible models (`LOCAL_qwen2.5:14b` on Vercel), and `reasoning:{effort:'none'}` is sent to
non-reasoning models.

**Requirement 2 is a design-constraint problem, not a bug.** Test-set membership is **frozen-once**
and is the comparability anchor (`settings_key` embeds `test_set_id` but not membership). Editing
membership in place silently corrupts existing runs (`fr2-smoke` already has 7). "Edit" therefore
splits into VIEW (read-only) + EDIT (metadata-only) + CLONE (the only safe membership-change path).

## Options Considered
- [x] **Option A (chosen): Fix the diagnosis pipeline + add bounded retry, then deliver view/edit/clone for test sets.** Surface real errors, make the judge path resilient to transients, and respect the frozen contract. Matches all investigation evidence.
- [ ] **Option B: "Fix" model routing / reasoning-effort param.** REJECTED — exonerated by the decisive same-shape/different-provider DB comparison (gpt-4o-mini succeeded while deepseek-v4-flash failed on byte-identical request shape).
- [ ] **Option C: Make test sets directly editable (in-place membership edit).** REJECTED — silently breaks cross-run comparability (same `settings_key`, `replaceCalls` overwrites against a different population) with zero signal; `fr2-smoke`'s 7 runs are live risk.

## Phased Execution Plan

### Phase 1: Unmask the real error (diagnosis pipeline)
- [ ] Stop collapsing LLM errors in `categorizeError()` (`src/lib/errorHandling.ts:69-77`); reorder so `'timeout'` matches before the broad `'api'`/`'openai'` substring. **Intentional severity reclassification**: an error containing BOTH `'timeout'` and `'api'` shifts `LLM_API_ERROR`→`TIMEOUT_ERROR` (Sentry critical→warning) — only that combination changes; existing tests don't cover it so no silent regression.
- [ ] Render `res.error.details` in the Judge Lab failure toast/run view (`src/app/admin/evolution/judge-lab/page.tsx`). Render `details` **generically** (not as an LLM-only string) — the `DATABASE_ERROR` branch puts supabase hints in `details`; acceptable for an admin-gated (`requireAdmin`) tool, but the UI must not assume the shape. No API-key leakage (SDK errors don't echo keys).
- [ ] Wire `trackingDb: db(ctx)` in `createEvalRunAction` (`evolution/src/services/judgeEvalActions.ts:~140`) so judge calls produce `llmCallTracking` rows (match the CLI at `judge-eval.ts:110`)

### Phase 2: Make the judge path resilient + persist failures
- [ ] Wrap `callLLM` in `createCallLLMJudge` (`runJudgeEval.ts:~224-232`) in a bounded retry (`MAX_RETRIES=3` + backoff) reusing `isTransientError` (verified at `evolution/src/lib/shared/classifyErrors.ts:15`) — do NOT re-enable SDK `maxRetries`, do NOT adopt `createEvolutionLLMClient` (it pins temp=0 + writes metrics). **Cost semantics:** the upfront `assertWithinJudgeEvalCap` (`settings.ts`) is an *estimate*, not a hard call-count ceiling once retries exist; the real backstop is the per-call `GlobalBudgetExceededError` gate inside `callLLM`, which each retry re-enters — state this explicitly. Hard cap on attempts so a persistently-transient provider cannot stall a cell.
- [ ] Wrap the `executeSweep` cell (`executeSweep.ts`) in try/catch and persist the failure by **reusing the existing `erroredRepeat()` rows already attached as `partialResults` on the thrown error** (`runJudgeEval.ts:~104-105,137-163`) via `replaceCalls` — do NOT synthesize new rows (avoids `judge_eval_calls` NOT NULL violations: `comparison_mode`/`winner`/`confidence`). Errored calls carry `error IS NOT NULL` and the leaderboard view filters `WHERE c.error IS NULL`, so they correctly stay out of decisive-rate.
- [ ] Curate the judge dropdown: add a **server-side provider-aware accessor** (no client reachability probe is possible) that excludes `provider==='local'` when `LOCAL_LLM_BASE_URL` is unset; apply it only at the judge-lab page layer (`getEvolutionModelIds` is also consumed by arena/prompt-editor/schemas — do not change shared behavior)
- [ ] Reasoning hygiene (shared `llms.ts:443-462`, **global OpenRouter path — not judge-only**): never attach `effort:'none'` for any provider; gate on `supportsReasoning`; guard `gpt-oss-20b` (mandatory reasoning) against `'none'`. Note `deepseek-v4-flash` already routes through the else-branch that strips `'none'` + sets `thinking:{type:'disabled'}` — its test is a regression guard, not a fix.

### Phase 3: View test set contents
- [ ] `getTestSetContentsAction({testSetId, kind})` — call the **unchanged** shared `loadTestSetPairs` (`persist.ts:142`, also used by `executeSweep` — must keep full texts) and **strip `text_a`/`text_b` in the ACTION result mapping** for the list response. Query `judge_eval_test_set_members` count **separately** (loadTestSetPairs returns only resolved pairs, silently dropping orphans at `persist.ts:168-173`) so the action can return member-vs-resolved counts → orphan warning.
- [ ] New detail page `src/app/admin/evolution/judge-lab/test-sets/[testSetId]/page.tsx` (mirror `runs/[evalRunId]/page.tsx`, reuse its `pct()` null-handling): per-pair table (label/kind/mu_a vs mu_b/Elo-gap/gap_kind/expected_winner[render `—`/`tie-acceptable` when null]/baseline_confidence) with lazy `text_a`/`text_b` expand fetched per-pair on demand

### Phase 4: Edit (metadata) + Clone (membership) + UI refactor
- [ ] `updateTestSetMetaAction({testSetId, name?, description?})` — scoped UPDATE on name/description ONLY; zod schema rejects strategy/seed/size; catch `23505` on `name` → friendly error; warn rename breaks saved CLI `--test-set` scripts
- [ ] `cloneTestSetAction({sourceTestSetId, newName, sizeArticle?, sizeParagraph?, strategy?, seed?, manualLabels?, description?})` — load `source.pair_bank_id` and call `getOrCreateTestSet` (which internally calls `selectTestSetMembers`) with the new name → new id → new settings_keys. **Critical edge:** `getOrCreateTestSet` is get-OR-create by name and returns the existing set UNCHANGED with `created:false` on collision — clone MUST treat `created===false` as a name-collision error (or pre-check), else it silently no-ops. Also `try/catch` the insert for `23505` on `name` (TOCTOU backstop — two concurrent clones can both pass a `created===false` pre-check; the UNIQUE constraint is the real guard, consistent with `updateTestSetMetaAction`). Coerce `seed` string→number (BIGINT serializes as string); warn clone re-samples the *current* bank. Expose `description` + `strategy='manual'`+`manualLabels` (omitted from create today).
- [ ] Migrate `test-sets/page.tsx` to **`EntityListPage` self-managed mode** (precedent: `src/app/admin/evolution/strategies/page.tsx`; there is **no** "RegistryPage" component — that name survives only in a comment) → rowActions View/Edit/Clone (+ optional Delete, hard-blocked when `runs>0` given 4-level `ON DELETE CASCADE`). The existing bespoke inline create form (bank `<select>` + name + sizes + strategy + seed) must be ported into a `FormDialog` `children` slot, not just list-only.

## Rollback & Safety
No new feature flags are introduced; all changes are low-risk and **revert-by-PR**:
- Retry is a bounded loop (`MAX_RETRIES=3`) within the existing cost ceiling + LLM semaphore — cannot run away.
- Dropdown curation is a pure filter; reasoning hygiene is a request-shape change guarded by a regression test for non-judge OpenRouter callers; error-unmask is a display/classification change.
- View/Edit/Clone add new server actions + a page; no migration (the `judge_eval_calls.error` column already exists), so no schema rollback surface. In-place membership mutation is structurally absent (no code path writes `judge_eval_test_set_members` for an existing id).

## Testing

### Unit Tests
- [ ] `src/lib/services/llms.test.ts` — request-body shape per model: `deepseek-v4-flash` → `thinking:{type:'disabled'}` + no `reasoning` (regression guard); `gemini-2.5-flash-lite` (OpenRouter) → no `reasoning` when `effort='none'`; `gpt-4o-mini` → no `reasoning_effort` when `effort='none'`; `gpt-oss-20b` never gets `'none'`. Include a **non-judge OpenRouter** case to prove the shared-path hygiene change doesn't regress other callers.
- [ ] `src/lib/errorHandling.test.ts` — `categorizeError()` preserves `details`; add a message containing **BOTH `'api'` and `'timeout'`** (e.g. `"OpenAI API request timeout"`) asserting `TIMEOUT_ERROR` — the existing timeout test (`'Request timeout after 30 seconds'`) has no `'api'` substring and already passes under the bug, so it cannot catch the regression.
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — `createCallLLMJudge` retries on `isTransientError` (twice then success) and does NOT retry non-transient. **Mocking:** `jest.mock('@/lib/services/llms')` so the module-imported `callLLM` is a `jest.fn` (the retry wraps the imported `callLLM`, NOT the injected `JudgeFn`); **unset `E2E_TEST_MODE`** so the stub early-return is bypassed; use fake timers / zero-delay backoff to stay under the 5s unit timeout.
- [ ] `evolution/src/lib/judgeEval/executeSweep.test.ts` (NEW file) — when `runJudgeEval` throws with attached `partialResults`, the cell persists an errored run via `replaceCalls` (assert error row written) instead of a 0-call orphan; mock the Supabase chain.
- [ ] `evolution/src/services/judgeEvalActions.test.ts` — `getTestSetContentsAction` omits `text_a`/`text_b` in list + returns member-vs-resolved counts + flags orphan (simulate a member label absent from the bank); `updateTestSetMetaAction` updates only name/description, rejects strategy/seed/size at schema, maps `23505`; `cloneTestSetAction` yields a new id/settings_key lineage, treats `created===false` as a collision error, and leaves source members/runs untouched

### Integration Tests
- [ ] `src/__tests__/integration/judge-eval-test-sets.integration.test.ts` — editing metadata leaves `settings_key` + members unchanged so dependent runs stay comparable; clone produces a distinct member population; assert the frozen contract **negatively** (no code path updates `judge_eval_test_set_members` for an existing id)

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-test-sets.spec.ts` (`@evolution`) — View row → detail renders members; Edit dialog persists description; Clone creates a new row. **Reuse the existing `admin-evolution-judge-lab.spec.ts` seed pattern**: seed `judge_eval_pair_banks` via the service client + `trackEvolutionId('judge_eval_pair_bank', bankId)`; include `adminTest.afterAll(cleanupAllTrackedEvolutionData)` (required by ESLint `flakiness/require-test-cleanup`; CASCADE from the bank cleans test_sets/members/runs/calls incl. the clone). Add a test-sets POM `resetFilters()` (no-op override is fine if the migrated list has no default "Hide test content" filter) per ESLint `flakiness/require-reset-filters` on `09-admin/*`.

### Manual Verification
- [ ] **Outside `E2E_TEST_MODE`** (local dev vs a real provider — the stub short-circuits `createCallLLMJudge`): trigger a judge sweep with a deliberately-bad model (e.g. `LOCAL_qwen2.5:14b` in a non-local env) and confirm the **real** error now surfaces (not the generic string)
- [ ] Confirm a successful sweep now writes `llmCallTracking` rows

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Run the new test-sets E2E spec on the local server via `ensure-server.sh`; verify view/edit/clone flows

### B) Automated Tests
- [ ] `npm run test:unit -- llms errorHandling runJudgeEval executeSweep judgeEvalActions`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-test-sets.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — Admin UI test-sets section (view/edit), and judge-model notes if model routing changes
- [ ] `evolution/docs/rating_and_comparison.md` — only if comparison/judge-call behavior changes
- [ ] `evolution/docs/reference.md` — LLM model/routing/error notes if model registry changes
- [ ] `evolution/docs/visualization.md` — Judge Lab admin page row (test-sets view/edit)
- [ ] `evolution/docs/data_model.md` — only if judge_eval_* schema changes

## Review & Discussion

### Iteration 1 — scores 4/4/4, 0 critical gaps
All three reviewers (Security, Architecture, Testing) independently verified the plan's file/line claims
against the real codebase and confirmed the diagnosis (error-mask + no-retry, NOT a model/routing bug)
and the frozen-contract VIEW/EDIT/CLONE design. Held at 4/5 on minor-but-load-bearing unstated details.
Resolved into the plan:
- Retry vs. upfront cost-cap semantics (cap is an estimate; per-call `GlobalBudgetExceededError` is the
  real backstop; hard `MAX_RETRIES`).
- Reuse existing `erroredRepeat()`/`partialResults` for failure persistence (satisfies `judge_eval_calls`
  NOT NULL; leaderboard already filters `error IS NULL`).
- `getTestSetContentsAction` strips `text_a/text_b` in the **action mapping** (not shared
  `loadTestSetPairs`, used by `executeSweep`); orphan warning needs a **separate** member-count query.
- `cloneTestSetAction` must treat `getOrCreateTestSet`'s `created===false` (name collision → returns
  existing unchanged) as an error; also catch `23505` (TOCTOU backstop).
- "RegistryPage" doesn't exist → use `EntityListPage` self-managed (precedent `strategies/page.tsx`);
  port the bespoke create form into a `FormDialog` `children` slot.
- Dropdown curation needs a **server-side** provider-aware accessor (no client reachability probe);
  scope to the judge-lab page (`getEvolutionModelIds` is shared with arena/prompt-editor/schemas).
- Reasoning-effort hygiene is a **global** OpenRouter path → add a non-judge regression test.
- Test specifics: retry unit test must `jest.mock('@/lib/services/llms')` + unset `E2E_TEST_MODE` +
  fake timers; errorHandling test needs an `'api'`+`'timeout'` message; E2E reuses the pair-bank
  seed-and-track + `afterAll(cleanupAllTrackedEvolutionData)` + `resetFilters()` conventions; manual
  verify runs outside `E2E_TEST_MODE`.
- Added a Rollback & Safety section (revert-by-PR; no migration; bounded retry).

### Iteration 2 — scores 5/5/5, 0 critical gaps → CONSENSUS
All three reviewers re-verified each fix against the live code and voted 5/5. Final non-blocking nit
(clone path also catch `23505` for TOCTOU) folded in. **Plan is ready for execution.**

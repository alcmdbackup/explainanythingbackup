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
- [ ] Stop collapsing LLM errors in `categorizeError()` (`src/lib/errorHandling.ts:69-75`); reorder so `'timeout'` matches before the broad `'api'` substring
- [ ] Render `res.error.details` in the Judge Lab failure toast/run view (`src/app/admin/evolution/judge-lab/page.tsx`)
- [ ] Wire `trackingDb: db(ctx)` in `createEvalRunAction` (`evolution/src/services/judgeEvalActions.ts:128-141`) so judge calls produce `llmCallTracking` rows (match the CLI)

### Phase 2: Make the judge path resilient + persist failures
- [ ] Wrap `callLLM` in `createCallLLMJudge` (`runJudgeEval.ts:224-232`) in a bounded retry (MAX_RETRIES=3 + backoff) reusing `isTransientError` (`classifyErrors.ts:15`) — do NOT re-enable SDK `maxRetries`, do NOT adopt `createEvolutionLLMClient` (it pins temp=0 + writes metrics)
- [ ] Wrap the `executeSweep` cell (`executeSweep.ts`) in try/catch and persist an errored run/call (`judge_eval_calls.error` exists) instead of an orphan 0-call run
- [ ] Curate the judge dropdown (`page.tsx:57`): exclude `provider==='local'` unless `LOCAL_LLM_BASE_URL` reachable
- [ ] Reasoning hygiene (`llms.ts:443-462`): never attach `effort:'none'` for any provider; gate on `supportsReasoning`; guard `gpt-oss-20b` (mandatory reasoning) against `'none'`

### Phase 3: View test set contents
- [ ] `getTestSetContentsAction({testSetId, kind})` wrapping `loadTestSetPairs` (`persist.ts:142`); **project OUT `text_a`/`text_b`** in the list response; return member-vs-resolved counts for an orphan warning
- [ ] New detail page `src/app/admin/evolution/judge-lab/test-sets/[testSetId]/page.tsx` (mirror `runs/[evalRunId]/page.tsx`): per-pair table (label/kind/mu_a vs mu_b/Elo-gap/gap_kind/expected_winner/baseline_confidence) with lazy text expand

### Phase 4: Edit (metadata) + Clone (membership) + UI refactor
- [ ] `updateTestSetMetaAction({testSetId, name?, description?})` — scoped UPDATE only; catch `23505` on `name`; warn rename breaks CLI scripts; reject strategy/seed/size at the schema
- [ ] `cloneTestSetAction({sourceTestSetId, newName, sizeArticle?, sizeParagraph?, strategy?, seed?, manualLabels?, description?})` — reuse `getOrCreateTestSet` + `selectTestSetMembers` → new id; coerce `seed` string→number; expose manual strategy/labels/description
- [ ] Migrate `test-sets/page.tsx` to `EntityListPage` self-managed mode → rowActions View/Edit/Clone (+ optional Delete hard-blocked when `runs>0`)

## Testing

### Unit Tests
- [ ] `src/lib/services/llms.test.ts` — request-body shape per model: `deepseek-v4-flash` → `thinking:{type:'disabled'}` + no `reasoning`; `gemini-2.5-flash-lite` → no `reasoning` when `effort='none'`; `gpt-4o-mini` → no `reasoning_effort` when `effort='none'`; `gpt-oss-20b` never gets `'none'`
- [ ] `src/lib/errorHandling.test.ts` — `categorizeError()` preserves details and matches `'timeout'` before `'api'`
- [ ] `evolution/src/lib/judgeEval/runJudgeEval.test.ts` — `createCallLLMJudge` retries on `isTransientError` (twice then success) and does NOT retry non-transient
- [ ] `evolution/src/lib/judgeEval/executeSweep.test.ts` — persists an errored run instead of a 0-call orphan when `runJudgeEval` throws
- [ ] `evolution/src/services/judgeEvalActions.test.ts` — `getTestSetContentsAction` omits `text_a`/`text_b` in list + flags orphan; `updateTestSetMetaAction` updates only name/description and maps `23505`; `cloneTestSetAction` yields a new id/settings_key lineage while leaving source members/runs untouched

### Integration Tests
- [ ] `src/__tests__/integration/judge-eval-test-sets.integration.test.ts` — editing metadata leaves `settings_key` + members unchanged so dependent runs stay comparable; clone produces a distinct member population

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-test-sets.spec.ts` (`@evolution`) — View row → detail renders members; Edit dialog persists description; Clone creates a new row

### Manual Verification
- [ ] Trigger a judge sweep with a deliberately-bad model (e.g. `LOCAL_qwen2.5:14b` in a non-local env) and confirm the **real** error now surfaces (not the generic string)
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
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]

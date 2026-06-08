# Improve Judge Lab Evolution Progress

## Phase 1: Unmask the real error (diagnosis pipeline)
### Work Done
- **1a — `src/lib/errorHandling.ts`**: reordered `categorizeError()` so `'timeout'` is matched
  before the broad `'api'`/`'openai'` substring, so a provider timeout that mentions "API" is
  classified `TIMEOUT_ERROR` instead of being collapsed into the generic `LLM_API_ERROR`. The full
  underlying message is preserved in `details` (already the case). Added a regression unit test in
  `src/lib/errorHandling.test.ts` (`"OpenAI API request timeout"` → `TIMEOUT_ERROR`).
- **1b — `src/app/admin/evolution/judge-lab/page.tsx`**: the sweep-failure toast now surfaces
  `res.error.details` as the toast `description` via a new pure `formatErrorDetail()` helper
  (handles string vs object `details`, truncates >500 chars) — the real provider error is now
  visible, not just the generic message.
- **1c — `evolution/src/services/judgeEvalActions.ts`**: `createEvalRunAction` now passes
  `trackingDb: db(ctx)` into `executeSweep` options (matching the CLI), so judge calls write
  `llmCallTracking` rows.

### Checks
- typecheck ✓ · eslint (4 changed files) ✓ · unit 68/68 ✓ (6 suites) · `npm run build` ✓

### Issues Encountered
- None. Verified `ExecuteSweepOptions.trackingDb` exists and the CLI (`judge-eval.ts:110`) already
  passes it, so 1c was a one-line addition.

### User Clarifications
- Scope decision (pre-execution): user chose FULL scope (all 4 phases).

## Phase 2: Resilience + persist failures + dropdown/reasoning hygiene
### Work Done
- **runJudgeEval.ts**: `createCallLLMJudge` now wraps `callLLM` in a bounded retry
  (`MAX_JUDGE_RETRIES=3`, `isTransientError`, exponential backoff; budget/kill-switch NOT retried;
  per-attempt cost accumulators). `runJudgeEval` attaches combined `partialResults` on throw.
  Added `retryBaseDelayMs` param (0 in tests). Unit tests (jest.mock `@/lib/services/llms`, unset
  `E2E_TEST_MODE`, zero-delay).
- **executeSweep.ts**: cell wrapped in try/catch — persists `partialResults` via `replaceCalls`
  (no 0-call orphan), then re-throws. New `executeSweep.test.ts`.
- **modelRegistry.ts**: `getDeployableEvolutionModelIds()` drops `provider:'local'` when
  `LOCAL_LLM_BASE_URL` unset; surfaced via `getJudgeModelOptionsAction` (page loads it on mount).
- **llms.ts**: extracted `resolveReasoningRequestFields()` — non-reasoning models never get a
  reasoning param; `'none'` only for opt-in models (qwen3, default 'none'), coerced to the registry
  default for mandatory-reasoning models (gpt-oss-20b); OpenAI omits `'none'`. Tests for gemini/
  qwen-2.5/gpt-oss-20b.

### UX additions (requested mid-phase)
- Custom-prompt box pre-filled with the real default paragraph rubric (`PARAGRAPH_SANDBOX_RUBRIC`,
  extracted to client-safe `judgeRubrics.ts`); explicit **Explain reasoning** checkbox (default off),
  decoupled from the textarea.
- Leaderboard enriched with `judge_eval_runs.prompt_variant` → new **Prompt** column (Custom,
  expandable / Built-in). No migration (text already persisted).

### Issues Encountered
- A pre-existing `qwen3-8b` test expected `reasoning:{effort:'none'}` — confirmed `'none'` is a
  deliberate disable-thinking value for that model, so the hygiene rule is per-model (not a blanket
  drop). Pre-existing `judgeEvalActions.test.ts` asserted raw leaderboard rows — updated for the
  prompt enrichment.

## Phase 3: View test set contents
### Work Done
- **persist.ts**: `loadTestSetContents` (projects mu/sigma → **display Elo** via `dbToRating`/
  `toDisplayElo`, omits snapshot texts, returns member/resolved/orphan counts) + `getTestSetPairTexts`
  (lazy per-pair). Unit tests in new `persist.test.ts`.
- **judgeEvalActions.ts**: thin `getTestSetContentsAction` / `getTestSetPairTextsAction`.
- New detail page `test-sets/[testSetId]/page.tsx`: kind toggle, Elo±uncertainty + Elo-gap columns,
  lazy text expand, orphan banner.

### Issues Encountered
- `mu`/`sigma` are nullable on a pair → Elo fields made nullable (render `—`).
- User requested **Elo, not raw mu** in the test-set view — done in the server projection.

## Phase 4: Edit (metadata) + Clone (membership) + UI
### Work Done
- **persist.ts**: `updateTestSetMetadata` (name/description only; maps `23505`→friendly) and
  `cloneTestSet` (re-samples current bank via `getOrCreateTestSet` → new id/settings_keys; errors on
  name collision incl. TOCTOU `23505`). Unit tests.
- **judgeEvalActions.ts**: thin `updateTestSetMetaAction` / `cloneTestSetAction` (schemas reject
  membership-determining fields on edit).
- **test-sets list page**: View link + inline Edit/Clone panels with frozen-contract warnings.
  Kept bespoke (consistent with the other judge-lab pages — none use `EntityListPage`).
- **E2E** `admin-evolution-judge-lab-test-sets.spec.ts` (`@evolution`) — view/edit/clone; passes
  locally (39s). Sibling judge-lab leaderboard spec still passes.

### Issues Encountered
- None blocking. `getOrCreateTestSet`'s get-or-create-by-name returns `created:false` on collision;
  `cloneTestSet` treats that as an error so a clone never aliases an existing set.

### Final verification
- lint ✓ · typecheck ✓ · build ✓ · unit **7119 passed / 0 failed** · E2E (both judge-lab specs) ✓

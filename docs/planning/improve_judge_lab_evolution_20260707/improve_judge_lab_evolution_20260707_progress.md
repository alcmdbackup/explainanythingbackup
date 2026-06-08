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

## Phase 2: View test set contents
### Work Done
[Description]

### Issues Encountered
[Problems and solutions]

## Phase 3: Edit test sets
### Work Done
[Description]

### Issues Encountered
[Problems and solutions]

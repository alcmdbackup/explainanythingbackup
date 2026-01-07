# Fix Production E2E Tests Plan

**Issue:** https://github.com/Minddojo/explainanything/issues/160

## Background
The nightly E2E workflow runs against production (`explainanything.vercel.app`) and is failing with ~72 test failures. All failures are in AI suggestion tests because Playwright mocking doesn't work when the app uses Next.js server actions instead of the mockable API route.

## Problem
Tests call `mockAISuggestionsPipelineAPI()` to intercept `/api/runAISuggestionsPipeline`, but production uses server actions (because `NEXT_PUBLIC_USE_AI_API_ROUTE` is not set in the Vercel build). Playwright cannot intercept Next.js server actions (RSC wire format).

## Options Considered

1. **Skip All AI Tests (`@skip-prod`)** - Quick fix, zero AI coverage in production
2. **Enable API Route in Vercel** - Exposes API route (security concern), not recommended
3. **Rewrite for Real AI** - Non-deterministic, slow, may hit rate limits
4. **Hybrid** - Keep 2-3 critical tests with real AI, skip rest
5. **Production-Specific Suite** - More code to maintain

## Selected Approach: Keep 3 Critical Tests, Skip Rest

### Strategy
1. Keep **3 tests** that validate core AI flow with real production AI
2. Add **`@prod-ai`** tag to those tests for isolated runs
3. Add **`@skip-prod`** to all other AI tests (~69 tests)

### Tags

| Tag | Purpose |
|-----|---------|
| `@prod-ai` | Marks tests that call real production AI (run with `--grep="@prod-ai"`) |
| `@skip-prod` | Marks tests to skip in production (run with `--grep-invert="@skip-prod"`) |

### Critical Tests to Keep (Real AI)

| # | Test | File | Why Critical |
|---|------|------|--------------|
| 1 | AI panel is visible | `suggestions.spec.ts` | Basic UI loads |
| 2 | Submit prompt and get success | `suggestions.spec.ts` | Core AI flow works |
| 3 | Accept/reject buttons appear | `user-interactions.spec.ts` | Diff UI renders |

### Files to Modify

| File | Action |
|------|--------|
| `suggestions.spec.ts` | Keep 2 `@prod-ai` tests, add `@skip-prod` to rest |
| `user-interactions.spec.ts` | Keep 1 `@prod-ai` test, add `@skip-prod` to rest |
| `editor-integration.spec.ts` | Add `@skip-prod` to entire file |
| `content-boundaries.spec.ts` | Add `@skip-prod` to entire file |
| `state-management.spec.ts` | Add `@skip-prod` to entire file |
| `save-blocking.spec.ts` | Add `@skip-prod` to entire file |
| `error-recovery.spec.ts` | Already has `@skip-prod` |
| `.github/workflows/e2e-nightly.yml` | Update audit step to include new @skip-prod files |

### Rate Limiting Consideration

The 3 `@prod-ai` tests run sequentially with `test.slow()` which triples timeouts. Since the nightly workflow uses `max-parallel: 1`, tests are isolated per browser. The ~90s timeout per test with real AI calls should not hit rate limits given:
- Only 3 real AI calls per browser run
- Each call is separated by page navigation and setup time
- OpenAI rate limits are typically per-minute (not per-test)

If rate limiting becomes an issue, add `await page.waitForTimeout(5000)` between AI tests.

### Tag Format Note

Two tag formats work with Playwright's `--grep`:
- **Object format (recommended):** `test.describe('Name', { tag: '@skip-prod' }, () => {})`
- **String format (legacy):** `test.describe('Name @skip-prod', () => {})`

The existing `error-recovery.spec.ts` uses string format. New files will use object format for consistency with Playwright best practices.

---

## Phased Execution Plan

### Phase 1: Add @skip-prod to Entire Files (4 files)
Add `{ tag: '@skip-prod' }` to test.describe() in:
- `src/__tests__/e2e/specs/06-ai-suggestions/editor-integration.spec.ts`
- `src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts`
- `src/__tests__/e2e/specs/06-ai-suggestions/state-management.spec.ts`
- `src/__tests__/e2e/specs/06-ai-suggestions/save-blocking.spec.ts`

### Phase 2: Rewrite Critical Tests in suggestions.spec.ts

**Note:** These code snippets show only the test bodies. The existing `beforeAll`/`afterAll` hooks with `createTestExplanationInLibrary` and cleanup should be preserved unchanged.

**Test 1: Panel Visibility**
(Note: This test already exists with `@critical` tag. Add `@prod-ai` alongside it.)
```typescript
test('should display AI suggestions panel', { tag: ['@critical', '@prod-ai'] }, async ({ authenticatedPage: page }) => {
  const resultsPage = new ResultsPage(page);
  await page.goto(`/results?explanation_id=${testExplanation.id}`);
  await resultsPage.waitForAnyContent(60000);

  const isPanelVisible = await resultsPage.isAISuggestionsPanelVisible();
  expect(isPanelVisible).toBe(true);
});
```

**Test 2: Submit Prompt & Get Success**
```typescript
test('should submit prompt and receive successful AI response', { tag: ['@prod-ai'] }, async ({ authenticatedPage: page }) => {
  // Use test.slow() to allow for real AI latency (triples timeout to ~90s)
  test.slow();

  const resultsPage = new ResultsPage(page);
  await page.goto(`/results?explanation_id=${testExplanation.id}`);
  await resultsPage.waitForAnyContent(60000);

  await enterEditMode(page);
  await submitAISuggestionPrompt(page, 'Improve this text');

  // Assert success - real AI should work in production
  // test.slow() triples the default 30s to ~90s which should be sufficient
  await waitForSuggestionsSuccess(page);
});
```

Add `@skip-prod` to all other tests in the file.

### Phase 3: Rewrite Critical Test in user-interactions.spec.ts

**Note:** Same as Phase 2 - preserve existing `beforeAll`/`afterAll` hooks.

**Test 3: Diff Buttons Appear**
```typescript
test('should show accept/reject buttons after AI response', { tag: ['@prod-ai'] }, async ({ authenticatedPage: page }) => {
  // Use test.slow() to allow for real AI latency (triples timeout to ~90s)
  test.slow();

  const resultsPage = new ResultsPage(page);
  await page.goto(`/results?explanation_id=${testExplanation.id}`);
  await resultsPage.waitForAnyContent(60000);

  await enterEditMode(page);
  await submitAISuggestionPrompt(page, 'Add more details');

  // Wait for AI success and diff nodes
  await waitForSuggestionsSuccess(page);
  await waitForDiffNodes(page);

  // Verify diff buttons are visible using same selectors as helpers
  // (clickAcceptOnFirstDiff uses button[data-action="accept"])
  const acceptButton = page.locator('button[data-action="accept"]').first();
  const rejectButton = page.locator('button[data-action="reject"]').first();
  await expect(acceptButton).toBeVisible({ timeout: 10000 });
  await expect(rejectButton).toBeVisible({ timeout: 10000 });
});
```

**Note:** Uses same `button[data-action="accept/reject"]` selectors as `clickAcceptOnFirstDiff()` and `clickRejectOnFirstDiff()` helpers in `suggestions-test-helpers.ts`.

Add `@skip-prod` to all other tests in the file.

### Phase 4: Update e2e-nightly.yml Audit Step

Update the audit step (line 134) to include the 4 new @skip-prod files:

```bash
# Current (only checks 2 files):
for file in $(find src/__tests__/e2e/specs -name "errors.spec.ts" -o -name "error-recovery.spec.ts" 2>/dev/null); do

# Updated (checks all 6 files):
for file in $(find src/__tests__/e2e/specs -name "errors.spec.ts" \
  -o -name "error-recovery.spec.ts" \
  -o -name "editor-integration.spec.ts" \
  -o -name "content-boundaries.spec.ts" \
  -o -name "state-management.spec.ts" \
  -o -name "save-blocking.spec.ts" 2>/dev/null); do
```

### Phase 5: Verify Locally

**Step 1: Run only the 3 critical @prod-ai tests (isolated):**
```bash
npx playwright test --grep="@prod-ai" --project=chromium
```

**Step 2: Run all tests except @skip-prod (simulates production filter):**
```bash
npx playwright test --grep-invert="@skip-prod" --project=chromium
```

**Step 3: Production verification (REQUIRED before merge):**
```bash
# Requires OPENAI_API_KEY env var (get from Vercel or .env.local)
# Run against actual production with real AI - must pass before merging
OPENAI_API_KEY=$OPENAI_API_KEY BASE_URL=https://explainanything.vercel.app npx playwright test --grep="@prod-ai" --project=chromium
```
This step is required because the tests will run against production in the nightly workflow. The nightly workflow already has OPENAI_API_KEY configured.

### Phase 6: Commit & Push
Commit message: `fix(e2e): skip mock-dependent AI tests in production, keep 3 critical @prod-ai tests (#160)`

---

## Testing
- Run `npx playwright test --grep="@prod-ai"` to verify 3 critical tests work
- Run `npx playwright test --grep-invert="@skip-prod"` to simulate production
- Monitor nightly workflow after push

## Documentation Updates
- Update `docs/feature_deep_dives/testing_setup.md` with `@prod-ai` and `@skip-prod` tag documentation

## Rollback Plan

If `@prod-ai` tests prove consistently flaky in production:

1. **Immediate mitigation:** Add `{ tag: '@skip-prod' }` to the 3 @prod-ai tests
2. **Workflow update:** Remove the 3 files from nightly audit expectations
3. **Commit:** `fix(e2e): temporarily skip @prod-ai tests due to flakiness`
4. **Investigate:** Check OpenAI rate limits, API health, or test timing issues
5. **Long-term:** Consider Option E (production-specific test suite with lenient assertions)

## Verification Checklist
- [ ] 4 files have `@skip-prod` on entire test.describe()
- [ ] suggestions.spec.ts has 2 `@prod-ai` tests + rest have `@skip-prod`
- [ ] user-interactions.spec.ts has 1 `@prod-ai` test + rest have `@skip-prod`
- [ ] e2e-nightly.yml audit step checks all 6 @skip-prod files
- [ ] Test 3 uses correct selectors: `button[data-action="accept/reject"]`
- [ ] All @prod-ai tests use `test.slow()` for extended timeouts
- [ ] `--grep="@prod-ai"` runs exactly 3 tests
- [ ] `--grep-invert="@skip-prod"` passes locally
- [ ] Production verification passes (REQUIRED: `BASE_URL=https://explainanything.vercel.app`)
- [ ] Nightly workflow passes after push

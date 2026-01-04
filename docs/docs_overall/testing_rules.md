# Testing Rules

1. **Start from a known state every test.** Create all needed data in the test (or via API/seed), and reset/cleanup DB + auth/session so tests don't depend on order or shared accounts. Use `test-data-factory.ts` to create isolated test data per test suite.
2. **Never use fixed sleeps.** Wait only on observable conditions: element is visible/enabled, URL changed, specific network response completed, websocket event received, etc.
3. **Use stable selectors only.** Prefer `data-testid` (or equivalent); avoid brittle CSS/XPath based on layout/text unless it's an accessibility role/name that's truly stable.
4. **Make async explicit.** After actions, assert the next expected state (auto-waiting assertions) and/or wait for the relevant request: "click → wait for /api/foo 200 → expect success UI."
5. **Isolate external dependencies.** Mock/stub third-party services (payments, email, maps, feature flags) and make backend responses deterministic; avoid real timeouts to external systems.
6. **Keep timeouts short** - 60 seconds max per test. Use `test.slow()` only for tests involving multiple sequential API calls or deliberate delays for testing loading states.
7. **Never silently swallow errors.** Use helpers from `src/__tests__/e2e/helpers/error-utils.ts` instead of bare `.catch(() => {})` or `.catch(() => false)`:
   - `safeWaitFor(locator, state, context, timeout)` - Wait with timeout logging
   - `safeIsVisible(locator, context, timeout)` - Visibility check with error logging (use instead of `.isVisible().catch(() => false)`)
   - `safeTextContent()` - Text extraction with error logging
   - `safeScreenshot()` - Screenshot with failure logging

   **Why?** Silent catches hide real bugs. When a check fails, you get no logs about *why* - was it a timeout? Wrong selector? Page crash? The safe helpers return the same value but log context, making flaky tests debuggable.
8. **Never skip tests that are missing data** Tests must always be run, unless they are impossible to run in that environment. Never skip because test data is not available. Use `test-data-factory.ts` to create required test data in `beforeAll`.

## Acceptable Patterns

These patterns appear to violate rules but are acceptable when used correctly:

### Acceptable setTimeout Uses (Rule 2 Clarification)
- **API delay simulation in mocks**: `delay: 1000` in mock responses to test loading states
- **Streaming chunk simulation**: `setTimeout` to simulate SSE/streaming in integration tests
- **Polling loops with exit conditions**: `setTimeout` inside `waitFor` that checks observable state

### Acceptable test.slow() Uses (Rule 6 Clarification)
- **AI suggestion tests**: Tests involving multiple API interactions with deliberate delays
- **Browser-specific slowdowns**: `if (testInfo.project.name === 'firefox') test.slow()`
- **First-attempt only**: `if (testInfo.retry === 0) test.slow()` - retries use normal timeout
- **Debug/investigation tests**: Tests like `debug-publish-bug.spec.ts` that intentionally test real streaming behavior (no mocking) may exceed 60s with documented rationale

### Test Data Factory Pattern (Rule 1 & 8)
```typescript
import { createTestExplanationInLibrary, TestExplanation } from '../../helpers/test-data-factory';

test.describe('Feature Tests', () => {
  let testExplanation: TestExplanation;

  test.beforeAll(async () => {
    testExplanation = await createTestExplanationInLibrary({
      title: 'Test Explanation',
      content: '<p>Test content</p>',
    });
  });

  test.afterAll(async () => {
    await testExplanation.cleanup();
  });

  test('should work', async ({ authenticatedPage: page }) => {
    await page.goto(`/results?explanation_id=${testExplanation.id}`);
    // Test logic - no skip needed!
  });
});
``` 
# Testing Rules

1. **Start from a known state every test.** Create all needed data in the test (or via API/seed), and reset/cleanup DB + auth/session so tests don't depend on order or shared accounts.
2. **Never use fixed sleeps.** Wait only on observable conditions: element is visible/enabled, URL changed, specific network response completed, websocket event received, etc.
3. **Use stable selectors only.** Prefer `data-testid` (or equivalent); avoid brittle CSS/XPath based on layout/text unless it's an accessibility role/name that's truly stable.
4. **Make async explicit.** After actions, assert the next expected state (auto-waiting assertions) and/or wait for the relevant request: "click → wait for /api/foo 200 → expect success UI."
5. **Isolate external dependencies.** Mock/stub third-party services (payments, email, maps, feature flags) and make backend responses deterministic; avoid real timeouts to external systems.
6. **Keep timeouts short** - 60 seconds max per test
7. **Never silently swallow errors.** Use helpers from `src/__tests__/e2e/helpers/error-utils.ts` instead of bare `.catch(() => {})`:
   - `safeWaitFor()` - Wait with timeout logging
   - `safeIsVisible()` - Visibility check with error logging
   - `safeTextContent()` - Text extraction with error logging
   - `safeScreenshot()` - Screenshot with failure logging

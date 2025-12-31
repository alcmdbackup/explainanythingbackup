# Silent Error Swallowing - Planning

## 1. Background
The codebase has excellent error handling infrastructure including a centralized error handler with Sentry integration, OTLP/Grafana tracing, and request context propagation. However, an audit found 27 instances where errors may be silently swallowed. Most issues (22/27) are in E2E test code where `.catch(() => {})` patterns mask test failures. The remaining 5 are in production code.

## 2. Problem
Silent error swallowing makes debugging extremely difficult because errors occur without any trace. In E2E tests, this leads to flaky tests that pass despite underlying issues. In production code, this can cause data loss (e.g., metrics not being recorded) or user-facing features failing silently (e.g., AI suggestions not loading). The fix requires systematic review and standardization of error handling patterns.

## 3. Options Considered

### Option A: Fix Only Production Code
- **Pros**: Smaller scope, faster completion
- **Cons**: E2E tests remain unreliable, test failures masked
- **Verdict**: Rejected - tests need attention too

### Option B: Fix All + Add ESLint Rule (Recommended)
- **Pros**: Comprehensive fix, prevents future violations
- **Cons**: More work upfront
- **Verdict**: Selected - addresses root cause and prevents recurrence

### Option C: Create Test Helper Only
- **Pros**: Standardizes test error handling
- **Cons**: Doesn't fix production issues
- **Verdict**: Partial solution only

---

## 4. Phased Execution Plan

### Phase 1: Production Code Fixes

#### 1.1 `src/lib/sessionId.ts:136-138`
**Current code:**
```typescript
sendSessionLinkingEvent(anonSessionId, authSessionId, userId).catch(() => {
  // Silently fail - session linking is best-effort
});
```

**Fix:** Add logging (this is intentionally best-effort, but should log):
```typescript
sendSessionLinkingEvent(anonSessionId, authSessionId, userId).catch((err) => {
  // Intentional: Session linking is best-effort, but log for debugging
  console.debug('[SessionId] Session linking failed (best-effort):', err);
});
```

#### 1.2 `src/lib/services/metrics.ts:72-78`
**Current code:**
```typescript
incrementExplanationViews(validationResult.data.explanationid).catch(metricsError => {
  logger.error('Failed to update explanation metrics after view event', {
    explanationid: validationResult.data.explanationid,
    event_name: validationResult.data.event_name,
    error: metricsError instanceof Error ? metricsError.message : String(metricsError)
  });
});
```

**Fix:** Already logs! Just add comment documenting intentional fire-and-forget:
```typescript
// Intentional: Fire-and-forget - metrics failures should not block user flow
// Errors are logged to Sentry via logger.error
incrementExplanationViews(validationResult.data.explanationid).catch(metricsError => {
  logger.error('Failed to update explanation metrics after view event', {
    explanationid: validationResult.data.explanationid,
    event_name: validationResult.data.event_name,
    error: metricsError instanceof Error ? metricsError.message : String(metricsError)
  });
});
```

#### 1.3 `src/lib/services/userLibrary.ts:41-46`
**Current code:** Same pattern as metrics.ts - already logs
**Fix:** Add comment documenting intentional fire-and-forget

#### 1.4 `src/components/AISuggestionsPanel.tsx:229-231`
**Current code:**
```typescript
}).catch((err) => {
  console.error('Failed to load validation results for session:', loadedSessionId, err);
});
```

**Fix:** Update state to show error to user:
```typescript
}).catch((err) => {
  console.error('Failed to load validation results for session:', loadedSessionId, err);
  // Show error state so user knows validation results couldn't be loaded
  setError('Could not load previous validation results');
});
```

#### 1.5 `src/lib/logging/client/consoleInterceptor.ts:145-146`
**Current code:**
```typescript
catch { /* ignore */ }
```

**Fix:** Add intentional documentation:
```typescript
catch {
  // Intentional: Pre-hydration log flushing may fail if window.__PRE_HYDRATION_LOGS__
  // doesn't exist or is malformed - this is expected in some edge cases
}
```

**Phase 1 Acceptance:**
- All production catch blocks either log, re-throw, or have documented reason

---

### Phase 2: E2E Test Helper & Refactor

#### 2.1 Create `src/__tests__/e2e/helpers/error-utils.ts`
```typescript
import { Page, Locator } from '@playwright/test';

/**
 * Safe wait wrapper that logs timeouts instead of silently swallowing them.
 * Use this instead of .catch(() => {}) for wait operations.
 */
export async function safeWaitFor(
  locator: Locator,
  state: 'visible' | 'hidden' | 'attached' | 'detached',
  context: string,
  timeout: number = 10000
): Promise<boolean> {
  try {
    await locator.waitFor({ state, timeout });
    return true;
  } catch (err) {
    console.warn(`[${context}] waitFor ${state} timed out after ${timeout}ms:`,
      err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Safe visibility check that logs errors instead of returning false silently.
 */
export async function safeIsVisible(
  locator: Locator,
  context: string,
  timeout: number = 100
): Promise<boolean> {
  try {
    return await locator.isVisible({ timeout });
  } catch (err) {
    console.warn(`[${context}] isVisible check failed:`,
      err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * Safe text content extraction that logs errors.
 */
export async function safeTextContent(
  locator: Locator,
  context: string
): Promise<string | null> {
  try {
    return await locator.textContent();
  } catch (err) {
    console.warn(`[${context}] textContent failed:`,
      err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Safe screenshot that logs failures (useful for debugging).
 */
export async function safeScreenshot(
  page: Page,
  path: string,
  context: string
): Promise<boolean> {
  try {
    await page.screenshot({ path });
    return true;
  } catch (err) {
    console.warn(`[${context}] Screenshot failed at ${path}:`,
      err instanceof Error ? err.message : err);
    return false;
  }
}
```

#### 2.2 Files to Refactor (using new helpers)

| File | Lines | Change |
|------|-------|--------|
| `src/__tests__/e2e/helpers/wait-utils.ts` | 60-61 | Use `safeIsVisible` and `safeWaitFor` |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | 209, 213, 434, 449 | Use `safeIsVisible`, `safeWaitFor` |
| `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts` | 62, 102, 103 | Use `safeTextContent` |
| `src/__tests__/e2e/helpers/pages/SearchPage.ts` | 76 | Use `safeIsVisible` |
| `src/__tests__/e2e/specs/01-auth/auth.spec.ts` | 70 | Use `safeWaitFor` with context |
| `src/__tests__/e2e/specs/03-library/library.spec.ts` | 24, 35-37, 57, 75, 94, 148 | Use `safeIsVisible` |
| `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` | 76 | Use `safeScreenshot` |
| `src/__tests__/e2e/specs/06-import/import-articles.spec.ts` | 208 | Use `safeWaitFor` |

**Phase 2 Acceptance:**
- All E2E tests use standardized error handling with logging
- No bare `.catch(() => {})` in test code

---

### Phase 3: ESLint Rule & Documentation

#### 3.1 Add ESLint rule

Check current ESLint config type:
```bash
ls -la eslint.config.*
```

**If using `eslint.config.mjs` (flat config):**
```javascript
// Add to eslint.config.mjs
import promisePlugin from 'eslint-plugin-promise';

export default [
  // ... existing config
  {
    plugins: { promise: promisePlugin },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      // Warn on promises without catch handlers
      'promise/catch-or-return': 'warn',
    }
  }
];
```

**If using `.eslintrc.js` (legacy config):**
```javascript
module.exports = {
  // ... existing config
  plugins: ['promise'],
  rules: {
    'no-empty': ['error', { allowEmptyCatch: false }],
    'promise/catch-or-return': 'warn',
  }
};
```

#### 3.2 Install eslint-plugin-promise (if needed)
```bash
npm install -D eslint-plugin-promise
```

**Phase 3 Acceptance:**
- ESLint catches future violations
- All intentional silent catches are documented

---

## 5. Testing

### Unit Tests
- No new unit tests needed - these are infrastructure changes

### Integration Tests
- No new integration tests needed

### E2E Tests
**Modified:**
- All files listed in Phase 2.2 will have their error handling updated
- Run full E2E suite to verify no regressions:
```bash
npm run test:e2e
```

### Manual Verification (Staging)
1. **Session linking:** Trigger auth transition, check logs for session linking debug messages
2. **Metrics failures:** Simulate metrics error (disconnect Supabase), verify error logged to Sentry
3. **AI suggestions:** Load page with invalid session_id, verify error message shown in UI

---

## 6. Documentation Updates

### Files to Update
- `/docs/docs_overall/testing_rules.md` - Add section on E2E error handling patterns:
  ```markdown
  ## E2E Error Handling

  Use helpers from `src/__tests__/e2e/helpers/error-utils.ts` instead of bare `.catch(() => {})`:
  - `safeWaitFor()` - Wait with timeout logging
  - `safeIsVisible()` - Visibility check with error logging
  - `safeTextContent()` - Text extraction with error logging
  - `safeScreenshot()` - Screenshot with failure logging
  ```

### Files NOT Updated
- `/docs/feature_deep_dives/` - No updates needed (infrastructure change, not feature)

---

## 7. All Code Modified (Summary)

### Production Code
| File | Type |
|------|------|
| `src/lib/sessionId.ts` | Add logging to catch |
| `src/lib/services/metrics.ts` | Add comment |
| `src/lib/services/userLibrary.ts` | Add comment |
| `src/components/AISuggestionsPanel.tsx` | Add error state |
| `src/lib/logging/client/consoleInterceptor.ts` | Add comment |

### Test Code
| File | Type |
|------|------|
| `src/__tests__/e2e/helpers/error-utils.ts` | NEW FILE |
| `src/__tests__/e2e/helpers/wait-utils.ts` | Refactor |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | Refactor |
| `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts` | Refactor |
| `src/__tests__/e2e/helpers/pages/SearchPage.ts` | Refactor |
| `src/__tests__/e2e/specs/01-auth/auth.spec.ts` | Refactor |
| `src/__tests__/e2e/specs/03-library/library.spec.ts` | Refactor |
| `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` | Refactor |
| `src/__tests__/e2e/specs/06-import/import-articles.spec.ts` | Refactor |

### Config
| File | Type |
|------|------|
| `eslint.config.mjs` or `.eslintrc.js` | Add rule |
| `package.json` | Add eslint-plugin-promise |

### Documentation
| File | Type |
|------|------|
| `docs/docs_overall/testing_rules.md` | Add E2E error handling section |

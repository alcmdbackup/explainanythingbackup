# E2E Test Failures Research Document

## Date: 2025-12-21

## Failing Tests Summary

### Test 1: Stream Error Display (CONSISTENTLY FAILING)

**File**: `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts:40`
**Test Name**: "should display error message for stream errors"

**What it tests**: Verifies the app displays an error message when the SSE stream sends an error event.

**CI Failure**:
```
Error: expect(received).toContain(expected) // indexOf
Matcher error: received value must not be null nor undefined
Received has value: null
```

**What happens**:
1. Mock is set up to return SSE events: `streaming_start` → `progress` → `error`
2. Test navigates to results page with query
3. Test waits for error element `[data-testid="error-message"]`
4. Element never appears → timeout → errorMessage is `null`

### Test 2: Login Redirect (FLAKY)

**File**: `src/__tests__/e2e/specs/auth.unauth.spec.ts:48`
**Test Name**: "should login with valid credentials"

**CI Failure**:
```
Error: page.waitForURL: Test timeout of 60000ms exceeded.
waiting for navigation to "/" until "load"
```

**What happens**:
1. Test navigates to login page
2. Fills credentials (using real Supabase auth)
3. Submits form
4. Waits for redirect to `/` for 60 seconds
5. Redirect never happens → timeout

---

## Root Cause Analysis

### Test 1: SSE Mock Delivery Issue

**Core Problem**: Playwright's `route.fulfill()` delivers all SSE events synchronously as a single response body:

```typescript
// api-mocks.ts:286-316
await route.fulfill({
  body: events.join(''),  // All 3 events sent at once!
});
```

**Why this might fail in CI**:
1. Real SSE is delivered incrementally over time
2. Browser's EventSource may parse batch-delivered events differently
3. CI environment has stricter/different parsing behavior
4. The mock doesn't simulate actual streaming - it's a single HTTP response with SSE-formatted content

**Evidence**:
- Same test passes locally (faster network, different browser behavior)
- Fails consistently in CI (Ubuntu runner, headless browser)

### Test 2: Supabase Auth Race/Rate Limiting

**Potential Causes**:
1. Multiple parallel tests hitting Supabase auth endpoints (rate limiting)
2. `chromium-unauth` project runs without pre-authenticated session
3. Session cookie not being set correctly in CI environment
4. Redirect relies on client-side JavaScript that may not execute in time

---

## Debug Logging Added

### 1. Test-Side Logging (errors.spec.ts)

```typescript
// Captures browser console messages
page.on('console', msg => {
  console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
});

// Logs network requests/responses to API
page.on('request', req => { ... });
page.on('response', res => { ... });

// Step-by-step logging
console.log('[E2E-DEBUG] Mock registered for stream error');
console.log('[E2E-DEBUG] Navigated to results page, URL:', page.url());
```

### 2. Test-Side Logging (auth.unauth.spec.ts)

```typescript
// Captures browser console
page.on('console', msg => console.log(`[BROWSER ${msg.type()}] ${msg.text()}`));

// Logs navigation events
page.on('framenavigated', frame => { ... });

// Polls URL every 5 seconds during wait
const urlCheckInterval = setInterval(() => {
  console.log('[E2E-DEBUG] Polling URL:', page.url());
}, 5000);
```

### 3. Mock Logging (api-mocks.ts)

```typescript
console.log('[MOCK-DEBUG] Registering stream error mock for:', errorMessage);
console.log('[MOCK-DEBUG] Route handler invoked for returnExplanation');
console.log('[MOCK-DEBUG] Fulfilling with', events.length, 'SSE events');
console.log('[MOCK-DEBUG] Route fulfilled successfully');
```

### 4. Application Logging (results/page.tsx)

```typescript
console.log('[SSE-DEBUG] Got response reader, starting to read SSE stream');
console.log('[SSE-DEBUG] Chunk', chunkCount, 'received, length:', chunk.length);
console.log('[SSE-DEBUG] Error event received:', data.error);
console.log('[SSE-DEBUG] Dispatching ERROR action to lifecycle reducer');
```

---

## Expected CI Output After Logging

Successful case should show:
```
[E2E-DEBUG] Test starting: stream error test
[MOCK-DEBUG] Registering stream error mock for: Stream interrupted
[MOCK-DEBUG] Route registered for **/api/returnExplanation
[E2E-DEBUG] Mock registered for stream error
[E2E-DEBUG] Navigated to results page, URL: http://localhost:3008/results?q=test%20query
[E2E-DEBUG] Request to returnExplanation: POST http://localhost:3008/api/returnExplanation
[MOCK-DEBUG] Route handler invoked for returnExplanation
[MOCK-DEBUG] Fulfilling with 3 SSE events
[MOCK-DEBUG] Route fulfilled successfully
[E2E-DEBUG] Response from returnExplanation: 200 text/event-stream
[BROWSER log] [SSE-DEBUG] Got response reader, starting to read SSE stream
[BROWSER log] [SSE-DEBUG] Chunk 1 received, length: XXX
[BROWSER log] Client received streaming data: {type: 'streaming_start'}
[BROWSER log] Client received streaming data: {type: 'progress', ...}
[BROWSER log] Client received streaming data: {type: 'error', error: 'Stream interrupted'}
[BROWSER log] [SSE-DEBUG] Error event received: Stream interrupted
[BROWSER log] [SSE-DEBUG] Dispatching ERROR action to lifecycle reducer
[E2E-DEBUG] Error element appeared
[E2E-DEBUG] isErrorVisible: true
[E2E-DEBUG] errorMessage: Stream interrupted
```

**What to look for in failing logs**:
- If `[MOCK-DEBUG] Route handler invoked` never appears → mock not being hit
- If `[BROWSER log]` messages don't appear → browser console not captured or SSE not received
- If `Client received streaming data: {type: 'error'}` appears but error element doesn't → React state update issue
- If chunks show 0 length or missing data → SSE parsing issue

---

## Files Modified

| File | Changes |
|------|---------|
| `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` | Added console/network/screenshot logging |
| `src/__tests__/e2e/specs/auth.unauth.spec.ts` | Added console/navigation/URL polling logging |
| `src/__tests__/e2e/helpers/api-mocks.ts` | Added mock invocation logging |
| `src/app/results/page.tsx` | Added SSE event processing logging |

---

## Next Steps After Reviewing CI Logs

1. **If mock is never invoked**: The route pattern `**/api/returnExplanation` may not match in CI
2. **If SSE events aren't received**: Browser EventSource parsing issue with batch delivery
3. **If error event received but UI doesn't update**: React reducer or rendering issue
4. **If login test shows no redirect**: Supabase rate limiting or session cookie issue

---

## Past Fixes Attempted

Previous commits addressing E2E flakiness:
- `f2dd6f7` - Added React hydration detection, replaced arbitrary waits
- `1252b0a` - Replaced `networkidle` with `domcontentloaded + element wait`
- `c05f56d` - Reduced CI workers, increased timeouts
- `932c117` - Added hydration wait before form fill
- `21f60d2` - Disabled Firefox SSE tests

These fixes addressed hydration races and timing but not the core SSE mock delivery issue.

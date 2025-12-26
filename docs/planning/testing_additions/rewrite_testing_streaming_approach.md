# Rewriting E2E Testing Approach for SSE Streaming

## Problem Statement

~8-10 E2E tests are flaky or skipped due to SSE (Server-Sent Events) mocking limitations in Playwright. The core issue: **Playwright's `route.fulfill()` delivers the entire SSE response body at once**, not streamed chunk by chunk.

## Current State

### Flaky/Skipped SSE Tests

| File | Test | Status |
|------|------|--------|
| `search-generate.spec.ts` | should show title during streaming | SKIPPED |
| `search-generate.spec.ts` | should display full content after streaming completes | SKIPPED |
| `search-generate.spec.ts` | should show stream-complete indicator | SKIPPED |
| `search-generate.spec.ts` | should automatically assign tags after generation | SKIPPED |
| `search-generate.spec.ts` | should enable save-to-library button after generation | SKIPPED |
| `search-generate.spec.ts` | should preserve query in URL after generation | Firefox SKIPPED |
| `action-buttons.spec.ts` | should save explanation to library | SKIPPED |
| `action-buttons.spec.ts` | should disable save button after successful save | SKIPPED |

### Root Cause

From `api-mocks.ts` line 131:
```typescript
// Playwright route.fulfill doesn't support streaming delays
```

The SSE mock delivers all events instantly:
```typescript
await route.fulfill({
  body: events,  // All SSE events sent in one batch
});
```

This violates testing rule #2: "Never use fixed sleeps. Wait only on observable conditions."

### Current Workaround: Library Loading Pattern

Tests load pre-existing content from the database instead of generating via SSE:
```typescript
await libraryPage.navigate();
await libraryPage.clickViewByIndex(0);
await page.waitForURL(/\/results\?explanation_id=/);
```

This pattern has 94% pass rate in AI suggestions tests.

---

## Solution: Test-Mode API Route (Recommended)

Add `E2E_TEST_MODE` environment variable that enables real SSE streaming with mock data in the returnExplanation route.

### Critical Gaps Addressed

| Gap | Solution |
|-----|----------|
| Database integration | Use real test DB with seeded data; mock returns real `explanation_id` from fixtures |
| Security | Guard: `if (E2E_TEST_MODE && NODE_ENV === 'production') throw` |
| Firefox limitation | Real streaming fixes Firefox (it's a Playwright mock limitation, not browser) |
| Parallel tests | Stateless mock responses keyed by request params |
| Route complexity | Inject at route level before calling `returnExplanationLogic()` |
| Test coordination | New `bypassSSEMocking()` helper to disable old route handlers |

---

## Implementation Plan

### Phase 1: Infrastructure

#### 1.1 Add production guard
**File:** `src/app/api/returnExplanation/route.ts`
```typescript
// Top of file
if (process.env.E2E_TEST_MODE === 'true' && process.env.NODE_ENV === 'production') {
  throw new Error('E2E_TEST_MODE cannot be enabled in production');
}
```

#### 1.2 Create mock streaming helper
**File:** `src/app/api/returnExplanation/test-mode.ts` (new)
- Export `streamMockResponse(request: Request): Response`
- Return real ReadableStream with 50ms delays between events
- Support multiple scenarios via `X-Test-Scenario` header

```typescript
export async function streamMockResponse(request: Request) {
  const encoder = new TextEncoder();
  const ids = await loadSeededIds();

  const stream = new ReadableStream({
    async start(controller) {
      const events = [
        { type: 'streaming_start' },
        { type: 'progress', stage: 'title_generated', title: 'Test Title' },
        { type: 'content', content: 'First chunk...' },
        { type: 'content', content: 'Second chunk...' },
        { type: 'streaming_end' },
        { type: 'complete', explanation_id: ids[0], tags: ['test'] },
      ];

      for (const event of events) {
        await new Promise(r => setTimeout(r, 50));  // Real delay
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

#### 1.3 Wire up test mode in route
**File:** `src/app/api/returnExplanation/route.ts`
```typescript
export async function POST(request: Request) {
  if (process.env.E2E_TEST_MODE === 'true') {
    const { streamMockResponse } = await import('./test-mode');
    return streamMockResponse(request);
  }
  // ... existing logic
}
```

#### 1.4 Update Playwright config
**File:** `playwright.config.ts`
```typescript
webServer: {
  command: 'npm run dev -- -p 3008',
  port: 3008,
  env: {
    E2E_TEST_MODE: 'true',
    NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
  },
},
```

### Phase 2: Mock Data Fixtures (Using Real Seeded IDs)

#### 2.1 Create test fixtures
**File:** `src/__tests__/e2e/fixtures/mock-explanations.ts` (new)
- Define `MockScenario` type with all SSE event fields
- Export scenarios: `default`, `slow`, `error`, `noMatches`, `withMatches`
- **Use real `explanation_id` values from test DB seed data**

#### 2.2 Database coordination
**Approach:** Query test DB at startup to get valid explanation IDs

```typescript
// test-mode.ts
let seededExplanationIds: string[] = [];

async function loadSeededIds() {
  if (seededExplanationIds.length === 0) {
    const supabase = createClient(...);
    const { data } = await supabase
      .from('explanations')
      .select('id')
      .limit(10);
    seededExplanationIds = data?.map(e => e.id) || [];
  }
  return seededExplanationIds;
}
```

This enables:
- Save-to-library tests to work (ID exists)
- Full regeneration flow testing
- No fake data in production database

#### 2.3 Scenario-based streaming
The `test-mode.ts` handler selects scenario based on:
1. `X-Test-Scenario` header (explicit)
2. `userInput` content matching (implicit, e.g., "error" in query triggers error scenario)
3. Returns a random seeded ID for each successful generation

### Phase 3: Test Migration

#### 3.1 Add bypass helper
**File:** `src/__tests__/e2e/helpers/api-mocks.ts`
```typescript
export async function bypassSSEMocking(page: Page) {
  // Unroute any existing handlers - tests will use real test-mode API
  await page.unroute('**/api/returnExplanation');
}
```

#### 3.2 Update skipped tests
**Files to modify:**
- `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`

Changes per test:
1. Remove `test.skip()`
2. Call `bypassSSEMocking(page)` or just don't set up mock
3. Wait on observable conditions (title appears, content renders, etc.)

#### 3.3 Remove Firefox skip
**File:** `search-generate.spec.ts`
```typescript
// Remove: test.skip(testInfo.project.name === 'firefox', ...)
```

### Phase 4: CI/Verification

#### 4.1 Re-enable Firefox in CI
**File:** `.github/workflows/e2e-nightly.yml`
```yaml
matrix:
  browser: [chromium, firefox]  # Re-add firefox
```

#### 4.2 Verification checklist
- [ ] All 8-10 previously skipped tests pass on Chromium
- [ ] Firefox tests pass (at least 90%)
- [ ] No new flakiness in existing tests
- [ ] Build still works without E2E_TEST_MODE

---

## Files to Modify

| File | Action |
|------|--------|
| `src/app/api/returnExplanation/route.ts` | Add test-mode branch + production guard |
| `src/app/api/returnExplanation/test-mode.ts` | New: mock streaming implementation |
| `src/__tests__/e2e/fixtures/mock-explanations.ts` | New: test scenarios |
| `src/__tests__/e2e/helpers/api-mocks.ts` | Add `bypassSSEMocking()` |
| `playwright.config.ts` | Add `E2E_TEST_MODE: 'true'` |
| `search-generate.spec.ts` | Unskip 6 tests, remove Firefox skip |
| `action-buttons.spec.ts` | Unskip 2 tests |
| `.github/workflows/e2e-nightly.yml` | Re-enable Firefox |

---

## Alternatives Considered

### Option 2: Separate Test SSE Server

Run a lightweight Node.js server alongside Playwright that provides real SSE streaming.

**Pros:**
- Clean separation of test/production code
- Full control over streaming behavior

**Cons:**
- 2 processes to manage in CI
- More infrastructure to maintain
- Potential port conflicts

### Option 3: Keep Current Approach

Continue using library loading pattern for most tests. Keep SSE tests skipped.

**Pros:**
- No new infrastructure
- Already working (94% pass rate)

**Cons:**
- Can't test streaming UX in E2E
- ~8-10 tests remain skipped

---

## Rollback Plan

If flakiness increases after 1 week:
1. Set `E2E_TEST_MODE: 'false'` in playwright.config.ts
2. Re-add `test.skip()` to affected tests
3. Keep infrastructure for future debugging

---

## Success Criteria

- All 8-10 previously skipped tests pass
- No new test failures introduced
- Firefox CI passes (90%+ reliability)
- Production build unaffected (no E2E_TEST_MODE in prod)
- Tests follow rule #2: wait on observable conditions, no fixed sleeps

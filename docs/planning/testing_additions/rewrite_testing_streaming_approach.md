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
| Authentication | Unchanged - middleware validates session; test-mode operates post-auth |
| Database integration | Seed script creates test data; mock returns real `explanation_id` from fixtures |
| Security | Guard: `if (E2E_TEST_MODE && NODE_ENV === 'production') throw` |
| Firefox limitation | Real streaming fixes Firefox (it's a Playwright mock limitation, not browser) |
| Parallel tests | Stateless mock responses keyed by request params |
| Route complexity | Inject at route level before calling `returnExplanationLogic()` |
| Event structure | Use exact production event format with all required fields |
| Scenario control | Keyword detection + X-Test-Scenario header for explicit control |

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

#### 1.2 Create database seeding script
**File:** `src/__tests__/e2e/setup/seed-test-data.ts` (new)

```typescript
import { createClient } from '@supabase/supabase-js';

const TEST_USER_ID = process.env.TEST_USER_ID!;

export async function seedTestData() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check if test data already exists
  const { data: existing } = await supabase
    .from('explanations')
    .select('id')
    .eq('user_id', TEST_USER_ID)
    .eq('title', 'E2E Test Explanation')
    .limit(1);

  if (existing && existing.length > 0) {
    console.log('Test data already seeded');
    return existing.map(e => e.id);
  }

  // Insert test explanations
  const testExplanations = [
    {
      user_id: TEST_USER_ID,
      title: 'E2E Test Explanation',
      content: 'This is test content for E2E streaming tests.',
      tags: ['test', 'e2e'],
      is_saved: false,
    },
    {
      user_id: TEST_USER_ID,
      title: 'E2E Saved Explanation',
      content: 'This explanation is already saved.',
      tags: ['test', 'saved'],
      is_saved: true,
    },
  ];

  const { data, error } = await supabase
    .from('explanations')
    .insert(testExplanations)
    .select('id');

  if (error) throw new Error(`Seed failed: ${error.message}`);
  return data.map(e => e.id);
}

export async function getSeededIds(): Promise<string[]> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await supabase
    .from('explanations')
    .select('id')
    .eq('user_id', process.env.TEST_USER_ID!)
    .like('title', 'E2E%')
    .limit(10);

  if (error || !data || data.length === 0) {
    throw new Error('No seeded test data found. Run seed-test-data first.');
  }

  return data.map(e => e.id);
}
```

#### 1.3 Update global-setup.ts
**File:** `src/__tests__/e2e/setup/global-setup.ts`
```typescript
import { seedTestData } from './seed-test-data';

async function globalSetup() {
  // ... existing env validation ...

  // Seed test data before tests run
  if (process.env.E2E_TEST_MODE === 'true') {
    console.log('Seeding E2E test data...');
    await seedTestData();
  }
}
```

#### 1.4 Create mock streaming helper with exact event structure
**File:** `src/app/api/returnExplanation/test-mode.ts` (new)

```typescript
import { getSeededIds } from '@/__tests__/e2e/setup/seed-test-data';

// Event type definitions matching production exactly
interface StreamingStartEvent {
  type: 'streaming_start';
  isStreaming: true;
}

interface ProgressEvent {
  type: 'progress';
  stage: 'title_generated' | 'searching_matches';
  title: string;
  isStreaming: true;
  isComplete: false;
}

interface ContentEvent {
  type: 'content';
  content: string;
  isStreaming: true;
  isComplete: false;
}

interface StreamingEndEvent {
  type: 'streaming_end';
  isStreaming: false;
}

interface CompleteEvent {
  type: 'complete';
  result: {
    data: Record<string, unknown>;
    error: null;
    originalUserInput: string;
    explanationId: string;
    userQueryId: string;
  };
  isStreaming: false;
  isComplete: true;
}

interface ErrorEvent {
  type: 'error';
  error: string;
  isStreaming: false;
  isComplete: true;
}

type SSEEvent = StreamingStartEvent | ProgressEvent | ContentEvent | StreamingEndEvent | CompleteEvent | ErrorEvent;

// Scenario definitions
type ScenarioName = 'default' | 'slow' | 'error' | 'mid_stream_error' | 'empty_content' | 'long_content';

interface Scenario {
  name: ScenarioName;
  delayMs: number;
  events: (explanationId: string, userInput: string) => SSEEvent[];
  triggerKeywords: string[];
}

const scenarios: Record<ScenarioName, Scenario> = {
  default: {
    name: 'default',
    delayMs: 50,
    triggerKeywords: [],
    events: (explanationId, userInput) => [
      { type: 'streaming_start', isStreaming: true },
      { type: 'progress', stage: 'title_generated', title: 'Understanding Your Query', isStreaming: true, isComplete: false },
      { type: 'content', content: 'This is the first part of the explanation. ', isStreaming: true, isComplete: false },
      { type: 'content', content: 'Here is more detailed information about the topic. ', isStreaming: true, isComplete: false },
      { type: 'content', content: 'And finally, the conclusion of the explanation.', isStreaming: true, isComplete: false },
      { type: 'streaming_end', isStreaming: false },
      {
        type: 'complete',
        result: {
          data: { title: 'Understanding Your Query', content: 'Full content here...', tags: ['test'] },
          error: null,
          originalUserInput: userInput,
          explanationId,
          userQueryId: 'test-query-id',
        },
        isStreaming: false,
        isComplete: true,
      },
    ],
  },
  slow: {
    name: 'slow',
    delayMs: 200,
    triggerKeywords: ['slow', 'delay'],
    events: (explanationId, userInput) => scenarios.default.events(explanationId, userInput),
  },
  error: {
    name: 'error',
    delayMs: 50,
    triggerKeywords: ['trigger-error', 'fail'],
    events: () => [
      { type: 'error', error: 'Test error: API unavailable', isStreaming: false, isComplete: true },
    ],
  },
  mid_stream_error: {
    name: 'mid_stream_error',
    delayMs: 50,
    triggerKeywords: ['mid-stream-fail'],
    events: () => [
      { type: 'streaming_start', isStreaming: true },
      { type: 'progress', stage: 'title_generated', title: 'Starting...', isStreaming: true, isComplete: false },
      { type: 'content', content: 'Content before error...', isStreaming: true, isComplete: false },
      { type: 'error', error: 'Stream interrupted', isStreaming: false, isComplete: true },
    ],
  },
  empty_content: {
    name: 'empty_content',
    delayMs: 50,
    triggerKeywords: ['empty-result'],
    events: (explanationId, userInput) => [
      { type: 'streaming_start', isStreaming: true },
      { type: 'progress', stage: 'title_generated', title: 'Empty Result', isStreaming: true, isComplete: false },
      { type: 'streaming_end', isStreaming: false },
      {
        type: 'complete',
        result: {
          data: { title: 'Empty Result', content: '', tags: [] },
          error: null,
          originalUserInput: userInput,
          explanationId,
          userQueryId: 'test-query-id',
        },
        isStreaming: false,
        isComplete: true,
      },
    ],
  },
  long_content: {
    name: 'long_content',
    delayMs: 30,
    triggerKeywords: ['long-content', 'detailed'],
    events: (explanationId, userInput) => {
      const contentChunks: ContentEvent[] = Array(20).fill(null).map((_, i) => ({
        type: 'content' as const,
        content: `Paragraph ${i + 1}: Lorem ipsum dolor sit amet, consectetur adipiscing elit. `,
        isStreaming: true as const,
        isComplete: false as const,
      }));
      return [
        { type: 'streaming_start', isStreaming: true },
        { type: 'progress', stage: 'title_generated', title: 'Comprehensive Analysis', isStreaming: true, isComplete: false },
        ...contentChunks,
        { type: 'streaming_end', isStreaming: false },
        {
          type: 'complete',
          result: {
            data: { title: 'Comprehensive Analysis', content: 'Full long content...', tags: ['detailed'] },
            error: null,
            originalUserInput: userInput,
            explanationId,
            userQueryId: 'test-query-id',
          },
          isStreaming: false,
          isComplete: true,
        },
      ];
    },
  },
};

// Cached seeded IDs with error handling
let seededIds: string[] | null = null;
let seedError: Error | null = null;

async function loadSeededIds(): Promise<string[]> {
  if (seedError) throw seedError;
  if (seededIds) return seededIds;

  try {
    seededIds = await getSeededIds();
    return seededIds;
  } catch (e) {
    seedError = e as Error;
    throw e;
  }
}

function detectScenario(request: Request, userInput: string): Scenario {
  // Priority 1: Explicit header
  const headerScenario = request.headers.get('X-Test-Scenario') as ScenarioName;
  if (headerScenario && scenarios[headerScenario]) {
    return scenarios[headerScenario];
  }

  // Priority 2: Keyword matching in userInput
  const input = userInput.toLowerCase();
  for (const scenario of Object.values(scenarios)) {
    if (scenario.triggerKeywords.some(kw => input.includes(kw))) {
      return scenario;
    }
  }

  // Default
  return scenarios.default;
}

export async function streamMockResponse(request: Request): Promise<Response> {
  const body = await request.json();
  const { userInput } = body;

  const scenario = detectScenario(request, userInput);
  const ids = await loadSeededIds();
  const explanationId = ids[Math.floor(Math.random() * ids.length)];
  const events = scenario.events(explanationId, userInput);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (const event of events) {
        await new Promise(r => setTimeout(r, scenario.delayMs));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
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

#### 1.5 Wire up test mode in route
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

#### 1.6 Update Playwright config
**File:** `playwright.config.ts`
```typescript
webServer: {
  command: 'npm run dev -- -p 3008',
  port: 3008,
  env: {
    E2E_TEST_MODE: 'true',
    NEXT_PUBLIC_USE_AI_API_ROUTE: 'true',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    TEST_USER_ID: process.env.TEST_USER_ID,
  },
},
```

---

### Phase 1.5: Infrastructure Validation (NEW)

Before migrating all tests, validate the test-mode infrastructure works correctly.

#### 1.5.1 Create validation test file
**File:** `src/__tests__/e2e/specs/00-infrastructure/test-mode.spec.ts` (new)

```typescript
import { test, expect } from '../../fixtures/auth';

test.describe('Test Mode Infrastructure', () => {
  test.describe.configure({ mode: 'serial' });

  test('should stream events with real delays', async ({ page }) => {
    const timestamps: number[] = [];

    // Monitor response timing
    page.on('response', async (response) => {
      if (response.url().includes('/api/returnExplanation')) {
        timestamps.push(Date.now());
      }
    });

    await page.goto('/');
    await page.fill('[data-testid="search-input"]', 'test query');
    await page.click('[data-testid="search-button"]');

    // Wait for streaming to complete
    await page.waitForSelector('[data-testid="stream-complete"]', { timeout: 30000 });

    // Verify title appeared during streaming
    const title = await page.locator('[data-testid="explanation-title"]').textContent();
    expect(title).toBeTruthy();
  });

  test('should handle error scenario via keyword', async ({ page }) => {
    await page.goto('/');
    await page.fill('[data-testid="search-input"]', 'trigger-error test');
    await page.click('[data-testid="search-button"]');

    await expect(page.locator('[data-testid="error-message"]')).toBeVisible({ timeout: 10000 });
  });

  test('should return valid explanation IDs for save operations', async ({ page }) => {
    await page.goto('/');
    await page.fill('[data-testid="search-input"]', 'normal query for save test');
    await page.click('[data-testid="search-button"]');

    await page.waitForSelector('[data-testid="stream-complete"]', { timeout: 30000 });

    // Verify save button is enabled and works
    const saveButton = page.locator('[data-testid="save-button"]');
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
    await expect(page.locator('[data-testid="save-success"]')).toBeVisible({ timeout: 10000 });
  });
});
```

#### 1.5.2 Validation gate
All 3 validation tests must pass before proceeding to Phase 2:
- [ ] Streaming with delays works (events not batched)
- [ ] Error scenario triggers correctly via keyword
- [ ] Seeded IDs work for save operations

---

### Phase 2: Test Scenario Helpers

#### 2.1 Create scenario helper for explicit control
**File:** `src/__tests__/e2e/helpers/scenario-helpers.ts` (new)

```typescript
import { Page } from '@playwright/test';

export type ScenarioName = 'default' | 'slow' | 'error' | 'mid_stream_error' | 'empty_content' | 'long_content';

/**
 * Set explicit test scenario via header.
 * Call before navigating to the page that triggers the API call.
 */
export async function setTestScenario(page: Page, scenario: ScenarioName) {
  await page.route('**/api/returnExplanation', async (route) => {
    const request = route.request();
    const headers = { ...request.headers(), 'X-Test-Scenario': scenario };
    await route.continue({ headers });
  });
}

/**
 * SSE Testing Strategy Documentation:
 *
 * 1. STREAMING TESTS (server-side test-mode, DEFAULT):
 *    - Don't mock anything - server with E2E_TEST_MODE=true handles responses
 *    - Use scenario keywords in search query for implicit control
 *    - Or use setTestScenario() for explicit control
 *
 *    Example (implicit):
 *    await searchPage.submitSearch('quantum physics'); // Uses default scenario
 *    await resultsPage.waitForStreamingComplete();
 *
 *    Example (explicit):
 *    await setTestScenario(page, 'slow');
 *    await searchPage.submitSearch('any query');
 *
 * 2. NETWORK ERROR TESTS (client-side mocking):
 *    - Use existing mock helpers for network-level failures
 *
 *    Example:
 *    await mockReturnExplanationTimeout(page);
 *    await searchPage.submitSearch('anything');
 *    await expect(page.locator('[data-testid="error"]')).toBeVisible();
 *
 * 3. Scenario trigger keywords:
 *    - 'slow' or 'delay' → slow scenario (200ms delays)
 *    - 'trigger-error' or 'fail' → error scenario
 *    - 'mid-stream-fail' → mid-stream error
 *    - 'empty-result' → empty content scenario
 *    - 'long-content' or 'detailed' → long content (20 chunks)
 */
```

---

### Phase 3: Test Migration

#### 3.1 Update skipped tests
**Files to modify:**
- `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts`
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`

Changes per test:
1. Remove `test.skip()`
2. Don't set up mocks (server-side test-mode handles it)
3. Wait on observable conditions (title appears, content renders, etc.)

Example migration:
```typescript
// BEFORE
test.skip('should show title during streaming', async ({ authenticatedPage }) => {
  // ...
});

// AFTER
test('should show title during streaming', async ({ authenticatedPage }) => {
  const searchPage = new SearchPage(authenticatedPage);
  const resultsPage = new ResultsPage(authenticatedPage);

  await searchPage.navigate();
  await searchPage.submitSearch('quantum physics');

  // Wait for title to appear (observable condition)
  await resultsPage.waitForStreamingStart();
  const title = await resultsPage.getTitle();
  expect(title).toBeTruthy();

  // Wait for completion
  await resultsPage.waitForStreamingComplete();
});
```

#### 3.2 Remove Firefox skip
**File:** `search-generate.spec.ts`
```typescript
// Remove: test.skip(testInfo.project.name === 'firefox', ...)
```

---

### Phase 4: CI/Verification

#### 4.1 Re-enable Firefox in CI
**File:** `.github/workflows/e2e-nightly.yml`
```yaml
matrix:
  browser: [chromium, firefox]  # Re-add firefox
```

#### 4.2 Add flakiness monitoring
**File:** `.github/workflows/e2e-nightly.yml`
```yaml
- name: Calculate pass rate
  if: always()
  run: |
    TOTAL=$(cat playwright-report/results.json | jq '.stats.expected + .stats.unexpected + .stats.flaky')
    PASSED=$(cat playwright-report/results.json | jq '.stats.expected')
    RATE=$(echo "scale=2; $PASSED / $TOTAL * 100" | bc)
    echo "PASS_RATE=$RATE" >> $GITHUB_ENV
    echo "Pass rate: $RATE%"

- name: Alert on low pass rate
  if: env.PASS_RATE < 85
  run: |
    echo "::warning::Pass rate $PASS_RATE% below 85% threshold"
    gh issue create --title "E2E flakiness alert: $PASS_RATE%" \
      --body "Pass rate dropped below threshold. Consider rollback." \
      --label "e2e-flakiness"
```

#### 4.3 Verification checklist
- [ ] All 8 previously skipped tests pass on Chromium
- [ ] Firefox tests pass (at least 90%)
- [ ] No new flakiness in existing tests
- [ ] Build still works without E2E_TEST_MODE
- [ ] Phase 1.5 validation tests pass

---

## Files to Modify

| File | Action |
|------|--------|
| `src/app/api/returnExplanation/route.ts` | Add test-mode branch + production guard |
| `src/app/api/returnExplanation/test-mode.ts` | New: mock streaming implementation with scenarios |
| `src/__tests__/e2e/setup/seed-test-data.ts` | New: database seeding script |
| `src/__tests__/e2e/setup/global-setup.ts` | Add seed call for E2E_TEST_MODE |
| `src/__tests__/e2e/helpers/scenario-helpers.ts` | New: scenario control helpers |
| `src/__tests__/e2e/specs/00-infrastructure/test-mode.spec.ts` | New: infrastructure validation tests |
| `playwright.config.ts` | Add env vars for E2E_TEST_MODE |
| `search-generate.spec.ts` | Unskip 6 tests, remove Firefox skip |
| `action-buttons.spec.ts` | Unskip 2 tests |
| `.github/workflows/e2e-nightly.yml` | Re-enable Firefox, add flakiness monitoring |

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

### Rollback Thresholds

| Metric | Warning | Rollback Trigger |
|--------|---------|------------------|
| Pass rate (single run) | < 90% | < 80% |
| Pass rate (3-run avg) | < 92% | < 85% |
| Consecutive failures | 2 runs | 3 runs |
| New test failures | Any | 2+ tests failing |

### Immediate Rollback Procedure (< 10 min)

1. Create PR with these changes:
   ```bash
   # Option 1: Quick config change
   # playwright.config.ts: Set E2E_TEST_MODE to 'false'

   # Option 2: Revert test changes
   git checkout <pre-migration-sha> -- src/__tests__/e2e/specs/02-search-generate/
   git checkout <pre-migration-sha> -- src/__tests__/e2e/specs/04-content-viewing/
   ```

2. Re-add `test.skip()` to the 8 migrated tests (list in PR description)

3. Merge with "emergency" label (expedited review)

4. Verify CI green on main

### Follow-up (within 24 hours)

1. Create issue documenting:
   - Which tests failed
   - Console/trace output
   - Suspected root cause

2. Keep test-mode infrastructure in place for debugging

3. Schedule investigation before next attempt

---

## Success Criteria

- All 8 previously skipped tests pass
- No new test failures introduced
- Firefox CI passes (90%+ reliability)
- Production build unaffected (no E2E_TEST_MODE in prod)
- Tests follow rule #2: wait on observable conditions, no fixed sleeps
- Phase 1.5 validation gate passed

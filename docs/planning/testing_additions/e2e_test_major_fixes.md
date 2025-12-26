# E2E Test Major Fixes

Unified implementation plan reconciling SSE streaming fixes, data management improvements, and auth isolation.

---

## Executive Summary

Three interconnected problems require a coordinated fix:

| Pillar | Problem | Solution |
|--------|---------|----------|
| **SSE Streaming** | Playwright `route.fulfill()` delivers all events at once | E2E_TEST_MODE route bypass with real streaming |
| **Data Management** | No cleanup (17 tables), no per-test creation | Hybrid: shared fixtures + per-test data + full cleanup |
| **Auth Isolation** | Single `.auth/user.json` shared by all tests | API-based auth per worker |

**Current State:**
- 52 E2E tests, 94% pass rate
- 8-10 tests skipped due to SSE limitations
- `global-teardown.ts` is empty
- Tests use `mode: 'serial'` to avoid shared state conflicts

---

## Implementation Phases

### Phase 0: Test User Provisioning (Use Existing)

**Decision:** Use the existing test user (`abecha@gmail.com`) rather than creating a new dedicated user. This is simpler and already works with current setup.

**Credential Storage:**

| Environment | Location | Notes |
|-------------|----------|-------|
| Local dev | `.env.local` | `TEST_USER_EMAIL=abecha@gmail.com`, `TEST_USER_PASSWORD=password` |
| CI (GitHub Actions) | Repository Secrets | `TEST_USER_EMAIL`, `TEST_USER_PASSWORD`, `TEST_USER_ID` |

**Service Role Key Security:**
```bash
# .env.local (local development) - NEVER COMMIT
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# CI: Use GitHub Secrets
# Settings → Secrets → Actions → SUPABASE_SERVICE_ROLE_KEY
```

**Verification Checklist:**
- [ ] TEST_USER_ID extracted from auth.users table (`SELECT id FROM auth.users WHERE email = 'abecha@gmail.com'`)
- [ ] TEST_USER_ID stored in CI secrets
- [ ] TEST_USER_EMAIL stored in CI secrets
- [ ] TEST_USER_PASSWORD stored in CI secrets
- [ ] SUPABASE_SERVICE_ROLE_KEY stored in CI secrets

---

### Phase 1: Infrastructure

**Environment Variables:**
```bash
E2E_TEST_MODE=true        # Enable test-mode routes
TEST_USER_ID=<uuid>       # For data cleanup/creation
TEST_USER_EMAIL=...       # For API auth
TEST_USER_PASSWORD=...    # For API auth
SUPABASE_SERVICE_ROLE_KEY=... # For global setup/teardown (admin operations)
```

**Production Guard:**
```typescript
// src/app/api/returnExplanation/route.ts (top of file)
if (process.env.E2E_TEST_MODE === 'true' && process.env.NODE_ENV === 'production') {
  throw new Error('E2E_TEST_MODE cannot be enabled in production');
}
```

**Files:**
- `playwright.config.ts` - Add env vars to webServer config, add globalSetup/globalTeardown references

**Config Additions (Phase 1):**
```typescript
// playwright.config.ts - Add these at the top level
export default defineConfig({
  globalSetup: './src/__tests__/e2e/setup/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/setup/global-teardown.ts',
  // ... rest of config
});
```

---

### Phase 2: Auth Isolation (API-Based Per Worker)

Replace shared storageState with per-worker API authentication.

**Before:**
```
auth.setup.ts (once) → .auth/user.json → All tests share session
```

**After:**
```
Each worker → API auth → Fresh session per worker
```

**Implementation:**
```typescript
// src/__tests__/e2e/fixtures/auth.ts
import { test as base } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

export const test = base.extend({
  authenticatedPage: async ({ page, context }, use) => {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!,
    });

    if (error) throw new Error(`Auth failed: ${error.message}`);

    // Inject Supabase auth cookies into browser
    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    await context.addCookies([
      {
        name: `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`,
        value: JSON.stringify({
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
        }),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ]);

    await use(page);
  },
});

export { expect } from '@playwright/test';
```

**Config Changes:**
```typescript
// playwright.config.ts - Remove setup project dependency
projects: [
  // Remove: { name: 'setup', testMatch: /.*\.setup\.ts/ },
  {
    name: 'chromium',
    // Remove: dependencies: ['setup'],
    // Remove: use: { storageState: '.auth/user.json' },
    testMatch: /.*\.spec\.ts/,
    testIgnore: /.*\.unauth\.spec\.ts/,
  },
  // ...
]
```

**Benefits:**
- Truly isolated per worker
- No pre-generated auth files
- Faster than UI login
- Parallel-safe

**Auth with Retry Logic:**

Network issues during auth can cause flaky tests. Add retry logic:

```typescript
// src/__tests__/e2e/fixtures/auth.ts
import { test as base, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const MAX_AUTH_RETRIES = 3;
const AUTH_RETRY_DELAY_MS = 1000;

async function authenticateWithRetry(retries = MAX_AUTH_RETRIES): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  for (let attempt = 1; attempt <= retries; attempt++) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: process.env.TEST_USER_EMAIL!,
      password: process.env.TEST_USER_PASSWORD!,
    });

    if (!error && data.session) {
      return {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      };
    }

    if (attempt < retries) {
      console.warn(`Auth attempt ${attempt} failed: ${error?.message}. Retrying...`);
      await new Promise(r => setTimeout(r, AUTH_RETRY_DELAY_MS));
    } else {
      throw new Error(`Auth failed after ${retries} attempts: ${error?.message}`);
    }
  }

  throw new Error('Auth failed: unexpected code path');
}

export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page, context }, use) => {
    const tokens = await authenticateWithRetry();

    const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    await context.addCookies([
      {
        name: `sb-${supabaseUrl.hostname.split('.')[0]}-auth-token`,
        value: JSON.stringify(tokens),
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ]);

    await use(page);
  },
});

export { expect };
```

---

### Phase 3: Data Management (Option 5 Hybrid)

#### 3.1 Global Setup - Seed Shared Fixtures
```typescript
// src/__tests__/e2e/setup/global-setup.ts
import { createClient } from '@supabase/supabase-js';

export default async function globalSetup() {
  if (process.env.E2E_TEST_MODE !== 'true') return;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Seed shared fixtures (topics, tags) if not exist
  await seedSharedFixtures(supabase);

  // Seed SSE test data
  await seedStreamingTestData(supabase);
}
```

#### 3.2 Per-Test Data Factory
```typescript
// src/__tests__/e2e/helpers/test-data-factory.ts
export async function createTestExplanation(options: {
  title: string;
  content?: string;
  isSaved?: boolean;
}) {
  const supabase = createClient(/*...*/);
  const testId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const { data, error } = await supabase
    .from('explanations')
    .insert({
      user_id: process.env.TEST_USER_ID,
      title: `${testId}-${options.title}`,
      content: options.content ?? 'Test content',
      is_saved: options.isSaved ?? false,
    })
    .select()
    .single();

  return { ...data, cleanup: () => deleteByTestId(testId) };
}
```

#### 3.3 Global Teardown - Safe Cleanup Strategy

**CRITICAL:** Never use empty filters like `.match({})` - that deletes ALL rows.

**Safe cleanup relies on:**
1. `TEST_USER_ID` to identify test user's data
2. CASCADE deletes for dependent tables (auto-cleanup)
3. Pattern matching (`test-%`) for independent tables

**Tables with CASCADE delete (auto-cleaned when explanation deleted):**
- `candidate_occurrences` → ON DELETE CASCADE
- `article_sources` → ON DELETE CASCADE
- `article_heading_links` → ON DELETE CASCADE
- `article_link_overrides` → ON DELETE CASCADE

**Tables WITHOUT CASCADE (need explicit cleanup before explanation deletion):**
- `explanation_tags` → Junction table, no CASCADE defined

**Race Condition Fix:**

The original approach had a race condition:
```
Query explanation IDs → [parallel test inserts new data] → Delete by IDs (misses new data)
```

**Solution:** Use direct `user_id` filter instead of pre-querying IDs. For tables without `user_id`, use a subquery or accept that some orphaned rows may remain (cleaned up next run).

```typescript
// src/__tests__/e2e/setup/global-teardown.ts
import { createClient } from '@supabase/supabase-js';

export default async function globalTeardown() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const testUserId = process.env.TEST_USER_ID!;

  if (!testUserId) {
    console.warn('⚠️ TEST_USER_ID not set, skipping cleanup');
    return;
  }

  console.log('🧹 E2E Global Teardown: Starting cleanup for test user...');

  try {
    // Step 1: Delete tables with direct user_id (order matters for FKs)
    // These are safe - always filter by user_id, no race condition
    await supabase.from('userLibrary').delete().eq('userid', testUserId);
    await supabase.from('userQueries').delete().eq('userId', testUserId);
    await supabase.from('userExplanationEvents').delete().eq('userid', testUserId);
    await supabase.from('llmCallTracking').delete().eq('userid', testUserId);

    // Step 2: Delete non-cascading tables using subquery pattern
    // This avoids race condition by doing SELECT + DELETE atomically via RPC
    // Alternative: Use raw SQL with subquery if Supabase client doesn't support
    const { data: explanationIds } = await supabase
      .from('explanations')
      .select('id')
      .eq('user_id', testUserId);

    if (explanationIds && explanationIds.length > 0) {
      const ids = explanationIds.map(e => e.id);

      // Delete in parallel for speed (these don't reference each other)
      await Promise.all([
        supabase.from('explanationMetrics').delete().in('explanationid', ids),
        supabase.from('link_candidates').delete().in('explanation_id', ids),
        supabase.from('explanation_tags').delete().in('explanation_id', ids), // No CASCADE
      ]);
    }

    // Step 3: Delete explanations (auto-cascades to 4 dependent tables)
    // Cascades: candidate_occurrences, article_sources, article_heading_links,
    //           article_link_overrides
    const { error: deleteError } = await supabase
      .from('explanations')
      .delete()
      .eq('user_id', testUserId);

    if (deleteError) {
      console.error('❌ Failed to delete explanations:', deleteError.message);
    }

    // Step 4: Delete independent tables with pattern matching
    await Promise.all([
      supabase.from('topics').delete().ilike('name', 'test-%'),
      supabase.from('tags').delete().ilike('name', 'test-%'),
      supabase.from('link_whitelist').delete().ilike('canonical_term', 'test-%'),
      supabase.from('link_whitelist_aliases').delete().ilike('canonical_term', 'test-%'),
      supabase.from('testing_edits_pipeline').delete().ilike('set_name', 'test-%'),
      supabase.from('source_cache').delete().ilike('url', '%test%'),
    ]);

    console.log('✅ E2E Global Teardown: Complete');
  } catch (error) {
    // Log but don't throw - cleanup failures shouldn't fail the test run
    console.error('❌ E2E Global Teardown failed:', error);
  }
}
```

**Note on Race Condition:** The step 2 query + delete still has a theoretical race window, but it's acceptable because:
1. Tests run in ~seconds; new insertions during teardown are unlikely
2. Leftover rows are cleaned up on the next test run
3. For true atomicity, use a Postgres function with `DELETE ... WHERE id IN (SELECT ...)`

**Cleanup Filter Summary:**

| Table | Filter | Why |
|-------|--------|-----|
| explanations | `.eq('user_id', testUserId)` | Direct ownership |
| userLibrary | `.eq('userid', testUserId)` | Direct ownership |
| userQueries | `.eq('userId', testUserId)` | Direct ownership |
| explanationMetrics | `.in('explanationid', ids)` | No cascade, must be explicit |
| explanation_tags | `.in('explanation_id', ids)` | No cascade, must be explicit |
| candidate_occurrences | *(cascade)* | Auto-deleted with explanation |
| article_sources | *(cascade)* | Auto-deleted with explanation |
| topics | `.ilike('name', 'test-%')` | No user_id, use pattern |
| testing_edits_pipeline | `.ilike('set_name', 'test-%')` | Independent table |

---

### Phase 4: SSE Test-Mode Streaming

**Route Bypass:**
```typescript
// src/app/api/returnExplanation/route.ts
export async function POST(request: Request) {
  if (process.env.E2E_TEST_MODE === 'true') {
    const { streamMockResponse } = await import('./test-mode');
    return streamMockResponse(request);
  }
  // ... existing production logic
}
```

**SSE Event Schema (from production `returnExplanation/route.ts`):**

The production route emits these event types in order:

| Event Type | Fields | When |
|------------|--------|------|
| `streaming_start` | `{ type, isStreaming: true }` | First event |
| `progress` | `{ type, step, message, isStreaming, isComplete }` | During processing |
| `content` | `{ type, content, isStreaming, isComplete }` | Content chunks |
| `streaming_end` | `{ type, isStreaming: false }` | Before final result |
| `complete` | `{ type, result, isStreaming: false, isComplete: true }` | Final result with full data |
| `error` | `{ type, error, isStreaming: false, isComplete: true }` | On failure |

**Mock Streaming Implementation:**
```typescript
// src/app/api/returnExplanation/test-mode.ts
import { randomUUID } from 'crypto';

type ScenarioName = 'default' | 'slow' | 'error' | 'mid_stream_error';

interface SSEEvent {
  type: 'streaming_start' | 'progress' | 'content' | 'streaming_end' | 'complete' | 'error';
  [key: string]: unknown;
}

interface Scenario {
  delayMs: number;
  events: SSEEvent[];
}

// Generate a mock result that matches production schema
const mockResult = {
  id: randomUUID(),
  title: 'Test Explanation Title',
  content: '<p>This is mock explanation content for E2E testing.</p>',
  topic: 'Test Topic',
  isMatch: false,
  matchScore: 0,
};

const scenarios: Record<ScenarioName, Scenario> = {
  default: {
    delayMs: 50,
    events: [
      { type: 'streaming_start', isStreaming: true },
      { type: 'progress', step: 'searching', message: 'Searching for matches...', isStreaming: true, isComplete: false },
      { type: 'progress', step: 'generating', message: 'Generating explanation...', isStreaming: true, isComplete: false },
      { type: 'content', content: '<p>This is mock ', isStreaming: true, isComplete: false },
      { type: 'content', content: 'explanation content ', isStreaming: true, isComplete: false },
      { type: 'content', content: 'for E2E testing.</p>', isStreaming: true, isComplete: false },
      { type: 'streaming_end', isStreaming: false },
      { type: 'complete', result: mockResult, isStreaming: false, isComplete: true },
    ],
  },
  slow: {
    delayMs: 200,  // 200ms between events to test loading states
    events: [
      { type: 'streaming_start', isStreaming: true },
      { type: 'progress', step: 'searching', message: 'Searching...', isStreaming: true, isComplete: false },
      { type: 'content', content: '<p>Slow content chunk...</p>', isStreaming: true, isComplete: false },
      { type: 'streaming_end', isStreaming: false },
      { type: 'complete', result: mockResult, isStreaming: false, isComplete: true },
    ],
  },
  error: {
    delayMs: 50,
    events: [
      { type: 'streaming_start', isStreaming: true },
      { type: 'error', error: 'Test error: Something went wrong', isStreaming: false, isComplete: true },
    ],
  },
  mid_stream_error: {
    delayMs: 50,
    events: [
      { type: 'streaming_start', isStreaming: true },
      { type: 'progress', step: 'generating', message: 'Generating...', isStreaming: true, isComplete: false },
      { type: 'content', content: '<p>Partial content before ', isStreaming: true, isComplete: false },
      { type: 'error', error: 'Connection lost mid-stream', isStreaming: false, isComplete: true },
    ],
  },
};

function detectScenario(request: Request, userInput: string): Scenario {
  // Priority 1: Explicit header
  const headerScenario = request.headers.get('X-Test-Scenario') as ScenarioName | null;
  if (headerScenario && scenarios[headerScenario]) {
    return scenarios[headerScenario];
  }

  // Priority 2: Keyword detection in user input
  const input = userInput?.toLowerCase() ?? '';
  if (input.includes('trigger-error')) return scenarios.error;
  if (input.includes('trigger-slow')) return scenarios.slow;
  if (input.includes('trigger-mid-error')) return scenarios.mid_stream_error;

  return scenarios.default;
}

export async function streamMockResponse(request: Request): Promise<Response> {
  const body = await request.json();
  const scenario = detectScenario(request, body.userInput);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      for (const event of scenario.events) {
        await new Promise(r => setTimeout(r, scenario.delayMs));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',  // Match production
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

**Scenario Control:**
| Trigger | Scenario | Use Case |
|---------|----------|----------|
| `X-Test-Scenario: slow` header | slow | Test loading spinners |
| `"trigger-error"` in query | error | Test error handling UI |
| `"trigger-slow"` in query | slow | Test timeout behavior |
| `"trigger-mid-error"` in query | mid_stream_error | Test partial content recovery |
| *(default)* | default | Normal happy path |

---

### Phase 5: Test Migration

#### 5.1 Remove Serial Mode Constraints

Currently 4 files use `mode: 'serial'` to avoid shared state conflicts:

| File | Line | Current |
|------|------|---------|
| `04-content-viewing/tags.spec.ts` | 11 | `test.describe.configure({ mode: 'serial', retries: 1 });` |
| `04-content-viewing/action-buttons.spec.ts` | 15 | `test.describe.configure({ mode: 'serial', retries: 1 });` |
| `04-content-viewing/viewing.spec.ts` | 11 | `test.describe.configure({ mode: 'serial', retries: 1 });` |
| `06-import/import-articles.spec.ts` | 5 | `test.describe.configure({ mode: 'serial' });` |

**Action:** After auth isolation is in place, remove these constraints to enable parallelism:
```typescript
// Remove this line from each file:
test.describe.configure({ mode: 'serial', retries: 1 });
```

**Note:** Keep `retries: 1` if desired, just remove `mode: 'serial'`.

#### 5.2 Unskip SSE Tests

1. **Unskip 8 SSE tests** in:
   - `search-generate.spec.ts` (6 tests)
   - `action-buttons.spec.ts` (2 tests)

2. **Remove Firefox skip** - Real streaming fixes the Playwright limitation

3. **Update test patterns:**
```typescript
// Before
test.skip('should show title during streaming', async () => {...});

// After
test('should show title during streaming', async ({ authenticatedPage }) => {
  const searchPage = new SearchPage(authenticatedPage);
  await searchPage.submitSearch('quantum physics');
  await expect(page.locator('[data-testid="explanation-title"]')).toBeVisible();
});
```

#### 5.3 Verify All 18 Spec Files Work

All spec files already import from `../../fixtures/auth` and use `authenticatedPage`. After updating the fixture, run a full test to verify no regressions:

```bash
# Run all authenticated tests
npx playwright test --project=chromium

# Verify each file individually if needed
npx playwright test src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts
```

**Files to verify:**
- `specs/smoke.spec.ts`
- `specs/01-auth/auth.spec.ts`
- `specs/02-search-generate/regenerate.spec.ts`
- `specs/02-search-generate/search-generate.spec.ts`
- `specs/03-library/library.spec.ts`
- `specs/04-content-viewing/viewing.spec.ts`
- `specs/04-content-viewing/tags.spec.ts`
- `specs/04-content-viewing/action-buttons.spec.ts`
- `specs/05-edge-cases/errors.spec.ts`
- `specs/06-ai-suggestions/editor-integration.spec.ts`
- `specs/06-ai-suggestions/content-boundaries.spec.ts`
- `specs/06-ai-suggestions/user-interactions.spec.ts`
- `specs/06-ai-suggestions/save-blocking.spec.ts`
- `specs/06-ai-suggestions/suggestions.spec.ts`
- `specs/06-ai-suggestions/state-management.spec.ts`
- `specs/06-ai-suggestions/error-recovery.spec.ts`
- `specs/06-import/import-articles.spec.ts`
- `specs/auth.unauth.spec.ts` (uses unauthenticated fixture - no change needed)

---

### Phase 6: Verification

**Success Criteria:**
- [ ] All 8 previously skipped tests pass
- [ ] Firefox CI passes (90%+ reliability)
- [ ] No new test failures
- [ ] Production build unaffected (E2E_TEST_MODE not in prod)
- [ ] Database cleanup runs without errors
- [ ] Auth isolation prevents cross-test contamination

**CI Monitoring:**
```yaml
# .github/workflows/e2e-nightly.yml
- name: Calculate pass rate
  run: |
    RATE=$(jq '.stats.expected / (.stats.expected + .stats.unexpected) * 100' results.json)
    echo "Pass rate: $RATE%"
```

---

## Critical Path

```
Phase 1: Infrastructure
    ↓
Phase 2: Auth  ←→  Phase 3: Data  [can run in parallel]
    ↓                   ↓
        Phase 4: SSE Streaming
              ↓
        Phase 5: Test Migration
              ↓
        Phase 6: Verification
```

---

## Files to Modify/Create

| File | Action |
|------|--------|
| `playwright.config.ts` | Add E2E_TEST_MODE, TEST_USER_ID; remove setup dependency |
| `src/__tests__/e2e/fixtures/auth.ts` | API-based per-worker auth |
| `src/__tests__/e2e/setup/global-setup.ts` | Seed shared fixtures |
| `src/__tests__/e2e/setup/global-teardown.ts` | Full 17-table cleanup |
| `src/__tests__/e2e/helpers/test-data-factory.ts` | New: per-test data creation |
| `src/__tests__/e2e/setup/seed-test-data.ts` | New: SSE test fixtures |
| `src/app/api/returnExplanation/route.ts` | E2E_TEST_MODE branch + guard |
| `src/app/api/returnExplanation/test-mode.ts` | New: mock streaming |
| `search-generate.spec.ts` | Unskip 6 tests |
| `action-buttons.spec.ts` | Unskip 2 tests |

---

## Rollback Plan

If pass rate drops below 85%:

### Quick Rollback (SSE only)
1. Set `E2E_TEST_MODE=false` in `playwright.config.ts`
2. Re-add `test.skip()` to the 8 SSE tests

### Full Rollback (Auth + Data)
1. Restore `auth.setup.ts` from git:
   ```bash
   git checkout HEAD~1 -- src/__tests__/e2e/auth.setup.ts
   ```
2. Restore original `fixtures/auth.ts`:
   ```bash
   git checkout HEAD~1 -- src/__tests__/e2e/fixtures/auth.ts
   ```
3. Re-add setup project to `playwright.config.ts`:
   ```typescript
   projects: [
     { name: 'setup', testMatch: /auth\.setup\.ts/ },
     {
       name: 'chromium',
       dependencies: ['setup'],
       use: { storageState: '.auth/user.json' },
       // ...
     },
   ]
   ```
4. Re-add `mode: 'serial'` to the 4 affected spec files

### Preserve Files for Rollback
Before implementation, tag the current state:
```bash
git tag e2e-pre-major-fixes
```

---

## Appendix

### Why Firefox Fails with Playwright SSE Mocking

Playwright's `route.fulfill()` buffers the entire response before delivering it to the browser. For SSE streams, this means:

1. All events are buffered
2. Delivered as a single chunk when stream closes
3. Browser receives all events simultaneously instead of incrementally

**Chromium** handles this somewhat gracefully due to internal buffering differences.
**Firefox** is stricter about SSE timing, causing tests that assert on intermediate states (e.g., "title visible during streaming") to fail.

**Solution:** By using `E2E_TEST_MODE` and real streaming (no `route.fulfill()`), Firefox receives actual incremental events, matching production behavior.

### Token Refresh for Long Test Runs

Supabase access tokens expire (default: 1 hour). For test suites running longer than an hour:

1. The fixture authenticates per-worker, so each worker gets a fresh token
2. Individual test files typically complete in minutes
3. If a single test runs > 1 hour (unlikely), add token refresh:

```typescript
// In fixture, before use()
const refreshTimeout = setTimeout(async () => {
  const { data } = await supabase.auth.refreshSession();
  // Update cookies with new tokens
}, 45 * 60 * 1000); // Refresh at 45 minutes

await use(page);
clearTimeout(refreshTimeout);
```

For most E2E suites, this is not needed.

---

## Related Documents
- `rewrite_testing_streaming_approach.md` - SSE streaming details
- `test_data_setup_and_cleanup_improvements.md` - Data management options

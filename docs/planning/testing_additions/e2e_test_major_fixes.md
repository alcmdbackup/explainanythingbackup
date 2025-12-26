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

### Phase 1: Infrastructure

**Environment Variables:**
```bash
E2E_TEST_MODE=true        # Enable test-mode routes
TEST_USER_ID=<uuid>       # For data cleanup/creation
TEST_USER_EMAIL=...       # For API auth
TEST_USER_PASSWORD=...    # For API auth
```

**Production Guard:**
```typescript
// src/app/api/returnExplanation/route.ts (top of file)
if (process.env.E2E_TEST_MODE === 'true' && process.env.NODE_ENV === 'production') {
  throw new Error('E2E_TEST_MODE cannot be enabled in production');
}
```

**Files:**
- `playwright.config.ts` - Add env vars to webServer config

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
- `explanation_tags` → ON DELETE CASCADE

```typescript
// src/__tests__/e2e/setup/global-teardown.ts
export default async function globalTeardown() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const testUserId = process.env.TEST_USER_ID!;

  // Step 1: Get test explanation IDs first (for non-cascading tables)
  const { data: testExplanations } = await supabase
    .from('explanations')
    .select('id')
    .eq('user_id', testUserId);
  const ids = testExplanations?.map(e => e.id) ?? [];

  // Step 2: Delete tables with direct user_id (before explanations due to FKs)
  await supabase.from('userLibrary').delete().eq('userid', testUserId);
  await supabase.from('userQueries').delete().eq('userId', testUserId);
  await supabase.from('userExplanationEvents').delete().eq('userid', testUserId);
  await supabase.from('llmCallTracking').delete().eq('userid', testUserId);

  // Step 3: Delete non-cascading tables that reference explanations
  if (ids.length > 0) {
    await supabase.from('explanationMetrics').delete().in('explanationid', ids);
    await supabase.from('link_candidates').delete().in('explanation_id', ids);
  }

  // Step 4: Delete explanations (auto-cascades to 5+ dependent tables)
  // Cascades: candidate_occurrences, article_sources, article_heading_links,
  //           article_link_overrides, explanation_tags
  await supabase.from('explanations').delete().eq('user_id', testUserId);

  // Step 5: Delete independent tables with pattern matching
  await supabase.from('topics').delete().ilike('name', 'test-%');
  await supabase.from('tags').delete().ilike('name', 'test-%');
  await supabase.from('link_whitelist').delete().ilike('canonical_term', 'test-%');
  await supabase.from('link_whitelist_aliases').delete().ilike('canonical_term', 'test-%');
  await supabase.from('testing_edits_pipeline').delete().ilike('set_name', 'test-%');
  await supabase.from('source_cache').delete().ilike('url', '%test%');
}
```

**Cleanup Filter Summary:**

| Table | Filter | Why |
|-------|--------|-----|
| explanations | `.eq('user_id', testUserId)` | Direct ownership |
| userLibrary | `.eq('userid', testUserId)` | Direct ownership |
| userQueries | `.eq('userId', testUserId)` | Direct ownership |
| explanationMetrics | `.in('explanationid', ids)` | No cascade, must be explicit |
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

**Mock Streaming with Scenarios:**
```typescript
// src/app/api/returnExplanation/test-mode.ts
type ScenarioName = 'default' | 'slow' | 'error' | 'mid_stream_error';

const scenarios = {
  default: { delayMs: 50, events: [...] },
  slow: { delayMs: 200, events: [...] },
  error: { delayMs: 50, events: [{ type: 'error', error: 'Test error' }] },
  // ...
};

export async function streamMockResponse(request: Request): Promise<Response> {
  const body = await request.json();
  const scenario = detectScenario(request, body.userInput);

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
    headers: { 'Content-Type': 'text/event-stream' },
  });
}
```

**Scenario Control:**
- Keyword detection: `"trigger-error"` → error scenario
- Header: `X-Test-Scenario: slow`

---

### Phase 5: Test Migration

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
1. Set `E2E_TEST_MODE=false` in playwright.config.ts
2. Re-add `test.skip()` to the 8 migrated tests
3. Revert auth fixture to storageState-based

---

## Related Documents
- `rewrite_testing_streaming_approach.md` - SSE streaming details
- `test_data_setup_and_cleanup_improvements.md` - Data management options

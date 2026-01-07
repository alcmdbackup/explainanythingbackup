# Nightly E2E Production Plan

## Background

The nightly E2E tests currently run against a locally-built dev environment using `E2E_TEST_MODE=true` which mocks AI responses. This validates test infrastructure but not actual production behavior.

## Problem

1. Tests don't validate real production deployments
2. Mocked AI responses don't catch real integration issues
3. Dev database may have different data characteristics than prod
4. No validation that the actual production URL is functioning correctly

## Options Considered

1. **Run both dev and prod nightly** - Rejected: duplicate costs, complexity
2. **Prod with mocked AI** - Rejected: defeats purpose of testing prod
3. **Prod with real AI, full suite** - Selected: comprehensive validation
4. **Prod with limited test scope** - Rejected: would miss important paths

## Phased Execution Plan

### Phase 1: Prerequisites (Manual)

**Runtime Requirements:**
- Node.js 18+ (required for `AbortSignal.timeout()` in safety checks)
- @supabase/supabase-js 2.x (timeout wrapper pattern compatibility)

**Create Production Test User:**
- Dashboard: https://supabase.com/dashboard/project/qbxhivoezkfbjbsctdzo/auth/users
- Email: `e2e-nightly-test@explainanything.com` (MUST contain "e2e" or "test" for safety check)
- Note the UUID after creation

**Verify GitHub Environment:**
- Ensure `Production` environment exists in GitHub repo Settings > Environments
- Environment should have required reviewers if desired (optional)

**Configure GitHub Production Secrets:**

| Secret | Source | Notes |
|--------|--------|-------|
| `TEST_USER_EMAIL` | New prod test user email | Must match pattern `*e2e*` or `*test*` |
| `TEST_USER_PASSWORD` | New prod test user password | |
| `TEST_USER_ID` | New prod test user UUID | |
| `SUPABASE_SERVICE_ROLE_KEY` | Prod Supabase dashboard | For cleanup only |
| `PINECONE_INDEX_NAME_ALL` | `explainanythingprodlarge` | Verify index exists |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Vercel dashboard | Required for protected deployments |
| `SLACK_WEBHOOK_URL` | Slack app settings | For failure notifications |
| `OPENAI_API_KEY` | OpenAI dashboard | Already exists at repo level |
| `PINECONE_API_KEY` | Pinecone dashboard | Already exists at repo level |

### Phase 2: Workflow Changes

Modify `.github/workflows/e2e-nightly.yml`:

```yaml
name: E2E Nightly (Production)

on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:

jobs:
  e2e:
    runs-on: ubuntu-latest
    environment: Production
    timeout-minutes: 45

    # Sequential browser execution to avoid OpenAI rate limiting
    strategy:
      fail-fast: false
      max-parallel: 1  # Run one browser at a time
      matrix:
        browser: [chromium, firefox]

    env:
      # Production URL - no local build
      BASE_URL: https://explainanything.vercel.app

      # Production secrets
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
      PINECONE_INDEX_NAME_ALL: ${{ secrets.PINECONE_INDEX_NAME_ALL }}

      # Vercel bypass for protected deployments
      VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}

      # Test user credentials
      TEST_USER_ID: ${{ secrets.TEST_USER_ID }}
      TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
      TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}

      # NO E2E_TEST_MODE - uses real AI

    steps:
      - uses: actions/checkout@v4
        with:
          ref: production  # Checkout production branch

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Get Playwright version
        id: playwright-version
        run: echo "version=$(npm ls @playwright/test --json | jq -r '.dependencies["@playwright/test"].version')" >> $GITHUB_OUTPUT

      - name: Cache Playwright browsers
        uses: actions/cache@v4
        id: playwright-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}-${{ matrix.browser }}

      - name: Install Playwright browsers
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps ${{ matrix.browser }}

      - name: Install Playwright deps (when cached)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps ${{ matrix.browser }}

      - name: Health Check (with retry)
        env:
          VERCEL_AUTOMATION_BYPASS_SECRET: ${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}
        run: |
          DEPLOY_URL="https://explainanything.vercel.app"
          MAX_RETRIES=3
          RETRY_DELAY=10

          health_check() {
            if [ -n "$VERCEL_AUTOMATION_BYPASS_SECRET" ]; then
              curl -s -L --max-redirs 5 --connect-timeout 10 --max-time 30 \
                -o /tmp/health.json -w '%{http_code}' \
                -c /tmp/cookies.txt -b /tmp/cookies.txt \
                -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
                -H "x-vercel-set-bypass-cookie: samesitenone" \
                "$DEPLOY_URL/api/health"
            else
              curl -s -L --max-redirs 5 --connect-timeout 10 --max-time 30 \
                -o /tmp/health.json -w '%{http_code}' "$DEPLOY_URL/api/health"
            fi
          }

          for attempt in $(seq 1 $MAX_RETRIES); do
            echo "Health check attempt $attempt/$MAX_RETRIES: $DEPLOY_URL/api/health"
            http_code=$(health_check)

            if [ "$http_code" = "403" ]; then
              echo "::error::Deployment protection blocked (403). Check VERCEL_AUTOMATION_BYPASS_SECRET."
              exit 1  # Don't retry auth failures
            elif [ "$http_code" = "200" ]; then
              response=$(cat /tmp/health.json)
              status=$(echo "$response" | jq -r '.status')
              echo "$response" | jq .
              if [ "$status" = "healthy" ]; then
                echo "::notice::Health check passed on attempt $attempt!"
                exit 0
              fi
            fi

            if [ "$attempt" -lt "$MAX_RETRIES" ]; then
              echo "Attempt $attempt failed (HTTP $http_code), retrying in ${RETRY_DELAY}s..."
              sleep $RETRY_DELAY
            fi
          done

          echo "::error::Health check failed after $MAX_RETRIES attempts"
          cat /tmp/health.json 2>/dev/null || echo "(No response body)"
          exit 1

      - name: Audit @skip-prod tags (BLOCKING)
        run: |
          # BLOCKING pre-flight check: ensure @skip-prod tags exist where expected
          # Tests requiring mocks MUST have this tag or they'll fail in production
          echo "Checking for @skip-prod tags in error test files..."
          missing=0

          # Use find to handle glob expansion properly
          for file in $(find src/__tests__/e2e/specs -name "errors.spec.ts" -o -name "error-recovery.spec.ts" 2>/dev/null); do
            if grep -q "@skip-prod" "$file"; then
              echo "✓ $file has @skip-prod tag"
            else
              echo "::error::BLOCKING: $file missing @skip-prod tag"
              missing=$((missing + 1))
            fi
          done

          if [ "$missing" -gt 0 ]; then
            echo "::error::$missing files missing @skip-prod tags. These tests will fail in production!"
            echo "Add { tag: ['@skip-prod'] } to tests that require mocked errors."
            exit 1
          fi
          echo "All error test files have @skip-prod tags"

      - name: Run E2E Tests
        run: npx playwright test --project=${{ matrix.browser }} --grep-invert="@skip-prod"

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report-${{ matrix.browser }}
          path: playwright-report/
          retention-days: 30

      - name: Notify Slack on failure
        if: failure()
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
        run: |
          echo "::error::Nightly E2E tests failed!"
          if [ -n "$SLACK_WEBHOOK_URL" ]; then
            curl -X POST -H 'Content-type: application/json' \
              --data '{
                "blocks": [
                  {
                    "type": "header",
                    "text": {"type": "plain_text", "text": "🚨 Nightly E2E Tests Failed", "emoji": true}
                  },
                  {
                    "type": "section",
                    "fields": [
                      {"type": "mrkdwn", "text": "*Environment:*\nProduction"},
                      {"type": "mrkdwn", "text": "*Browser:*\n${{ matrix.browser }}"}
                    ]
                  },
                  {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": "*Actions Run:*\n<https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }}|View Logs>"}
                  }
                ]
              }' "$SLACK_WEBHOOK_URL"
          fi
```

**Key changes:**
- Remove `E2E_TEST_MODE: 'true'`
- Add `BASE_URL` pointing to production
- Add `VERCEL_AUTOMATION_BYPASS_SECRET`
- Add `--grep-invert="@skip-prod"` to exclude mock-dependent tests
- Add health check step with Vercel bypass headers
- Add Slack notification on failure
- Use `max-parallel: 1` for sequential browser execution (avoids OpenAI rate limiting)
- Increase timeout to 45 minutes
- Add artifact upload for test reports

### Phase 3: Config Changes

Modify `playwright.config.ts`:

```typescript
// Add at top of file (after imports)
const isProduction = process.env.BASE_URL?.includes('vercel.app') ||
                     process.env.BASE_URL?.includes('explainanything');

// Modify defineConfig
export default defineConfig({
  // Extended timeouts for real AI responses
  timeout: isProduction ? 120000 : (process.env.CI ? 60000 : 30000),

  expect: {
    timeout: isProduction ? 60000 : (process.env.CI ? 20000 : 10000),
  },

  // More retries for flaky real AI tests
  retries: isProduction ? 3 : (process.env.CI ? 2 : 0),

  // Serial execution in production to avoid rate limiting
  // NOTE: Must also set fullyParallel: false when workers: 1
  workers: isProduction ? 1 : 2,
  fullyParallel: isProduction ? false : true,

  // Disable webServer in production (we're testing against live URL)
  // Current config has webServer block starting ~line 90
  webServer: isProduction ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },

  // ... rest of config
});
```

**Why fullyParallel must be conditional:**
- Current config has `fullyParallel: true` (line 83)
- Setting `workers: 1` with `fullyParallel: true` still parallelizes within spec files
- For true serial execution (avoiding rate limits), both must be set

**Why webServer must be disabled:**
- When testing production, we don't need a local server
- Leaving webServer enabled would attempt to start dev server unnecessarily
- Set to `undefined` to completely skip webServer logic

### Phase 4: Test Safety Updates

**File paths:**
- `src/__tests__/e2e/setup/global-teardown.ts`
- `src/__tests__/e2e/setup/global-setup.ts`

#### 4.1 Modify `src/__tests__/e2e/setup/global-setup.ts`

**Exact insertion point**: After line 176 (after `waitForServerReady` completes), before line 178 (env var check).

Add TEST_USER_ID/EMAIL cross-validation at startup (fails fast before any tests run):

```typescript
// FILE: src/__tests__/e2e/setup/global-setup.ts
// INSERT AFTER: line 176 (after waitForServerReady try/catch block)
// INSERT BEFORE: line 178 (const requiredEnvVars = [...])

// === ADD THIS BLOCK ===
const isProduction = baseUrl.includes('vercel.app') || baseUrl.includes('explainanything');

// PRODUCTION SAFETY: Cross-validate TEST_USER_ID matches TEST_USER_EMAIL
if (isProduction) {
  const testUserId = process.env.TEST_USER_ID;
  const testUserEmail = process.env.TEST_USER_EMAIL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!testUserId || !testUserEmail || !serviceRoleKey) {
    throw new Error('PRODUCTION SAFETY: TEST_USER_ID, TEST_USER_EMAIL, and SUPABASE_SERVICE_ROLE_KEY required');
  }

  // Verify the UUID belongs to the expected email (with timeout)
  // Note: createClient already imported at top of file
  const prodSupabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) }
  });

  try {
    const { data: userData, error } = await prodSupabase.auth.admin.getUserById(testUserId);

    if (error || !userData?.user) {
      throw new Error(`PRODUCTION SAFETY: Could not verify TEST_USER_ID: ${error?.message}`);
    }

    if (userData.user.email !== testUserEmail) {
      throw new Error(
        `PRODUCTION SAFETY: TEST_USER_ID belongs to "${userData.user.email}" but TEST_USER_EMAIL is "${testUserEmail}"`
      );
    }

    const isTestUser = testUserEmail.includes('e2e') || testUserEmail.includes('test');
    if (!isTestUser) {
      throw new Error(`PRODUCTION SAFETY: Email "${testUserEmail}" doesn't match pattern *e2e* or *test*`);
    }

    console.log(`   ✓ Verified production test user: ${testUserEmail}`);
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      throw new Error('PRODUCTION SAFETY: Supabase verification timed out after 10s');
    }
    throw e;
  }
}
// === END BLOCK ===

// === ALSO MODIFY existing fixture seeding (lines 191-198) ===
// Change from:
//   if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
// To:
if (!isProduction && process.env.SUPABASE_SERVICE_ROLE_KEY) {
  // ... existing seedSharedFixtures code ...
}
```

#### 4.2 Modify `src/__tests__/e2e/setup/global-teardown.ts`

**Exact insertion point**: Replace line 24. Insert safety check BEFORE the `try` block at line 26.

```typescript
// FILE: src/__tests__/e2e/setup/global-teardown.ts
// REPLACE: line 24 (const supabase = createClient(...))
// WITH the following block (lines 24-52 become new content)

// === REPLACE LINE 24 WITH THIS ===
// Use timeout on all Supabase calls to prevent hanging
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) }
});

// PRODUCTION SAFETY CHECK (before any destructive operations)
const isProduction = process.env.BASE_URL?.includes('vercel.app') ||
                     process.env.BASE_URL?.includes('explainanything');

if (isProduction) {
  try {
    // Re-verify test user email pattern before ANY cleanup
    const { data: userData, error } = await supabase.auth.admin.getUserById(testUserId);

    if (error || !userData?.user) {
      console.error('❌ SAFETY ABORT: Could not verify test user:', error?.message);
      console.log('✅ E2E Global Teardown: Complete (aborted - safety check failed)');
      return;
    }

    const email = userData.user.email || '';
    const isTestUser = email.includes('e2e') || email.includes('test');

    if (!isTestUser) {
      console.error('❌ SAFETY ABORT: User email does not match test pattern!');
      console.error('   Email:', email);
      console.error('   Expected pattern: *e2e* or *test*');
      console.log('✅ E2E Global Teardown: Complete (aborted - safety check failed)');
      return;
    }

    console.log(`   ✓ Verified test user for cleanup: ${email}`);
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      console.error('❌ SAFETY ABORT: Supabase verification timed out after 10s');
    } else {
      console.error('❌ SAFETY ABORT: Unexpected error verifying test user:', e);
    }
    console.log('✅ E2E Global Teardown: Complete (aborted - safety check failed)');
    return;
  }
}
// === END SAFETY CHECK ===

// Line 26+ remains unchanged (try { // Step 1: Get explanation IDs... })
```

#### 4.3 Security Notes for SUPABASE_SERVICE_ROLE_KEY

**Risk**: Service role key provides full database admin access.

**Mitigations implemented:**
1. Cross-validation in setup ensures TEST_USER_ID matches TEST_USER_EMAIL
2. Email pattern check (`*e2e*` or `*test*`) before any cleanup
3. Fail-fast in setup prevents tests from running with misconfigured credentials
4. Cleanup only touches data associated with TEST_USER_ID

**Additional recommendations:**
- Set short-lived GitHub secret rotation policy (90 days)
- Monitor Supabase audit logs for service role usage
- Consider creating a dedicated "cleanup-only" database role in future

### Phase 5: Test Modifications

#### 5.1 Tests Using Mocks (Must Modify or Skip)

| File | Mock Used | Action |
|------|-----------|--------|
| `search-generate.spec.ts` | `mockReturnExplanationAPI` | Remove mock, use flexible assertions |
| `errors.spec.ts` | `mockReturnExplanationAPI` | Add `@skip-prod` tag |
| `suggestions.spec.ts` | `mockAISuggestionsPipelineAPI` | Remove mock, use flexible assertions |
| `editor-integration.spec.ts` | `mockAISuggestionsPipelineAPI` | Remove mock, use flexible assertions |
| `error-recovery.spec.ts` | `mockAISuggestionsPipelineAPI` | Add `@skip-prod` tag |
| `state-management.spec.ts` | `mockAISuggestionsPipelineAPI` | Remove mock, use flexible assertions |
| `user-interactions.spec.ts` | `mockAISuggestionsPipelineAPI` | Remove mock, use flexible assertions |
| `save-blocking.spec.ts` | `mockAISuggestionsPipelineAPI` | Remove mock, use flexible assertions |
| `content-boundaries.spec.ts` | `mockAISuggestionsPipelineAPI` | Remove mock, use flexible assertions |

#### 5.2 Implementing @skip-prod Tag

**Important**: Use Playwright's tag metadata (not `test.skip()`) for compatibility with `--grep-invert="@skip-prod"`.

```typescript
// In errors.spec.ts - Add @skip-prod tag to entire describe block
test.describe('Error handling @skip-prod', () => {
  // Tag in describe name works with grep

  test('should handle API error gracefully', { tag: ['@skip-prod'] }, async () => {
    // Tag in test options also works
    await mockReturnExplanationAPIError(page, 'Simulated error');
    // ...
  });
});

// Alternative: Tag individual tests
test('should recover from mid-stream error', { tag: ['@skip-prod'] }, async () => {
  // This test requires mocked errors - skip in production
});
```

**How it works with workflow:**
```yaml
# In e2e-nightly.yml
run: npx playwright test --project=${{ matrix.browser }} --grep-invert="@skip-prod"
```

The `--grep-invert` flag excludes any test where the test name OR tag contains `@skip-prod`.

#### 5.3 Flexible Assertions Pattern

Replace exact content assertions with existence checks:

```typescript
// BEFORE (mocked - exact content)
await mockReturnExplanationAPI(page, { title: 'Understanding Quantum Physics' });
await expect(page.getByText('Understanding Quantum Physics')).toBeVisible();

// AFTER (real AI - flexible)
// No mock needed
await page.waitForSelector('[data-testid="explanation-title"]', { timeout: 90000 });
const title = await page.getByTestId('explanation-title').textContent();
expect(title).toBeTruthy();
expect(title!.length).toBeGreaterThan(5);
```

### Phase 6: Rate Limiting & Cost Control

#### 6.1 Rate Limiting Strategy

- **Workers**: Set to 1 for serial execution
- **Retries**: Set to 3 with exponential backoff (Playwright default)
- **Timeouts**: Extended to 120s per test for real AI latency

#### 6.2 Cost Monitoring

- **Estimated daily cost**: ~$1-2 (20 AI generations @ $0.05-0.10 each)
- **Monthly cost**: ~$30-60
- **Action**: Set OpenAI usage alerts at $50/month threshold

### Phase 7: Validation & Rollback

#### 7.1 Validation Checklist

1. [ ] Create production test user with correct email pattern
2. [ ] Configure all GitHub Production secrets
3. [ ] Verify Pinecone index `explainanythingprodlarge` exists
4. [ ] Run locally: `BASE_URL=https://explainanything.vercel.app npx playwright test --grep="@smoke"`
5. [ ] Manual workflow dispatch
6. [ ] Monitor first 3 scheduled runs

#### 7.2 Rollback Plan

If issues arise:

```bash
# 1. Immediate: Disable scheduled runs
# Edit e2e-nightly.yml, comment out schedule

# 2. Revert to dev mode
git revert <commit-hash>

# 3. Restore original workflow
environment: staging
E2E_TEST_MODE: 'true'
# Remove BASE_URL
```

## Testing

- **Local smoke**: `BASE_URL=https://explainanything.vercel.app npx playwright test --grep="@smoke"`
- **Local full**: `BASE_URL=https://explainanything.vercel.app npx playwright test --grep-invert="@skip-prod"`
- **CI**: Manual workflow dispatch, then monitor scheduled runs

## Documentation Updates

| File | Changes |
|------|---------|
| `docs/docs_overall/testing_overview.md` | Update nightly workflow to describe production targeting |
| `docs/docs_overall/environments.md` | Add nightly prod test user info and Pinecone index |

# Phase 4: E2E Testing with Playwright - Implementation Plan

## Executive Summary

**Goal:** Validate critical user journeys end-to-end to ensure application reliability and prevent regressions
**Timeline:** 2-3 weeks (10-12 days of focused work)
**Priority:** Medium (optional enhancement, but high value for regression prevention)
**Current Status:** ✅ **Phase 2 Complete** - Auth flow tests implemented with 8/9 passing
**Target:** 52-66 E2E tests covering 7 critical user journeys

---

## Implementation Progress

### ✅ Phase 1: Foundation Setup (COMPLETE - Nov 15, 2025)
**Duration:** ~4 hours
**Status:** 100% Complete

**Files Created:**
1. `playwright.config.ts` - Configuration with Chromium/Firefox, timeouts, video on failure
2. `e2e/` directory structure with fixtures/, helpers/pages/, specs/, setup/
3. `.env.test.example` - Template for test environment variables
4. `e2e/fixtures/auth.ts` - Authentication fixture for reuse
5. `e2e/helpers/pages/BasePage.ts` - Base POM class
6. `e2e/helpers/pages/LoginPage.ts` - Login page POM
7. `e2e/helpers/pages/SearchPage.ts` - Search page POM
8. `e2e/setup/global-setup.ts` - Global test setup
9. `e2e/setup/global-teardown.ts` - Global test cleanup
10. `e2e/specs/smoke.spec.ts` - 3 smoke tests

**Components Updated with data-testid:**
- ✅ `src/app/login/page.tsx` - 5 attributes (email, password, submit, error, signup-toggle)
- ✅ `src/components/SearchBar.tsx` - 2 attributes (search-input, search-submit)
- ✅ `src/components/Navigation.tsx` - 1 attribute (logout-button)

**NPM Scripts Added:**
- `npm run test:e2e` - Run all E2E tests
- `npm run test:e2e:ui` - Interactive UI mode
- `npm run test:e2e:headed` - Headed browser mode
- `npm run test:e2e:chromium` - Chromium only

### ✅ Phase 2: Auth Flow Tests (COMPLETE - Nov 16, 2025)
**Duration:** ~3 hours
**Status:** 8/9 tests passing (1 skipped)

**Tests Implemented in `specs/01-auth/auth.spec.ts`:**
1. ✅ `should login with valid credentials` - Login and redirect to home
2. ✅ `should show error with invalid credentials` - Error display for bad login
3. ✅ `should redirect unauthenticated user from protected route` - Protected route guard
4. ✅ `should persist session after page refresh` - Session persistence
5. ✅ `should access protected route when authenticated` - Auth state maintained
6. ⏭️ `should logout successfully` - SKIPPED (Server Action redirect issue)
7. ✅ `should redirect to home when accessing login while authenticated` - Auth redirect
8. ✅ `should handle empty email submission` - Form validation
9. ✅ `should handle empty password submission` - Form validation

**Additional Infrastructure:**
- Enhanced `fixtures/auth.ts` with Supabase cookie detection (sb-* prefix)
- Improved `helpers/pages/LoginPage.ts` with robust selectors (#email, #password)
- Added data-testid to results page, TagBar, ExplanationsTablePage

**Known Issues:**
1. **Logout Server Action**: signOut() uses redirect() which doesn't work from onClick handler
2. **Supabase Rate Limiting**: Multiple rapid auth tests trigger rate limits; use --workers=1
3. **Cookie Detection**: Supabase uses 'sb-' prefixed cookies, not 'supabase' in name

### ❌ Phase 3: Search & Generate Flow - Part 1 (NOT STARTED)
**Estimated:** 8-10 hours | 8-10 tests

### ❌ Phase 4: Search & Generate Flow - Part 2 (NOT STARTED)
**Estimated:** 3-4 hours | 4-5 tests

### ❌ Phase 5: Library Management (NOT STARTED)
**Estimated:** 3-4 hours | 8-10 tests

### ❌ Phase 6: Content Viewing & Tags (NOT STARTED)
**Estimated:** 4-5 hours | 11-15 tests

### ❌ Phase 7: Regeneration & Error Cases (NOT STARTED)
**Estimated:** 5-6 hours | 13-16 tests

### ❌ Phase 8: CI/CD Integration & Polish (NOT STARTED)
**Estimated:** 4-5 hours

---

## Quick Start Guide

### Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Playwright browsers:
   ```bash
   npx playwright install chromium
   ```

3. Environment configuration uses `.env.local` (no separate test env file needed)

### Running Tests

```bash
# All E2E tests (requires dev server)
npm run test:e2e

# Headed mode (watch browser)
npm run test:e2e:headed

# UI mode (interactive)
npm run test:e2e:ui

# Single test file
npx playwright test e2e/specs/smoke.spec.ts

# Debug mode
PWDEBUG=1 npx playwright test
```

### Current Directory Structure

```
e2e/
├── fixtures/                  # Test fixtures (auth, database seeding)
│   └── auth.ts                # Authentication state management
├── helpers/
│   └── pages/                 # Page Object Models (POMs)
│       ├── BasePage.ts        # Base page class
│       ├── LoginPage.ts       # Login page interactions
│       └── SearchPage.ts      # Search page interactions
├── specs/                     # Test specifications
│   ├── 01-auth/               # (placeholder - no tests yet)
│   ├── 02-search-generate/    # (placeholder - no tests yet)
│   ├── 03-library/            # (placeholder - no tests yet)
│   ├── 04-content-viewing/    # (placeholder - no tests yet)
│   ├── 05-edge-cases/         # (placeholder - no tests yet)
│   └── smoke.spec.ts          # 3 basic smoke tests ✅
├── setup/                     # Global setup/teardown
│   ├── global-setup.ts        # Pre-test setup
│   └── global-teardown.ts     # Post-test cleanup
└── E2E_TESTING_PLAN.md        # This file
```

---

## Key Decisions

✅ **LLM Responses:** Mock OpenAI API for speed, determinism, and cost control
✅ **Database:** Uses `.env.local` credentials (same as development)
✅ **Scope:** E2E tests focus on user flows; Lexical editor stays in Phase 7 unit tests
✅ **Video Recording:** Record only on failures to save storage costs
✅ **Browsers:** Primary focus on Chromium, optional Firefox for critical flows

---

## Writing Tests

### Use Page Object Models

```typescript
import { test, expect } from '@playwright/test';
import { LoginPage } from '../helpers/pages/LoginPage';

test('login with valid credentials', async ({ page }) => {
  const loginPage = new LoginPage(page);
  await loginPage.navigate();
  await loginPage.login('user@example.com', 'password');

  await expect(page).toHaveURL('/');
});
```

### Use Authenticated Fixture

```typescript
import { test, expect } from '../../fixtures/auth';

test('view library requires auth', async ({ authenticatedPage }) => {
  await authenticatedPage.goto('/userlibrary');
  await expect(authenticatedPage.locator('h1')).toContainText('Library');
});
```

### Add data-testid Attributes

Components should have `data-testid` attributes for reliable selectors:

```tsx
<input data-testid="login-email" type="email" />
<button data-testid="login-submit">Login</button>
```

**Currently Implemented:**
- `login-email` - Login email input
- `login-password` - Login password input
- `login-submit` - Login submit button
- `login-error` - Login error message
- `signup-toggle` - Toggle between login/signup
- `search-input` - Search bar input
- `search-submit` - Search submit button
- `logout-button` - Logout button in navigation

**Still Needed (for future phases):**
- `explanation-title` - Explanation title display
- `explanation-content` - Explanation content area
- `stream-complete` - Streaming completion indicator
- `save-to-library` - Save to library button
- `tag-item` - Individual tag display
- `explanation-row` - Library explanation row
- `save-date` - Library save date

---

## Debugging

- **Screenshots**: `test-results/**/*.png` (on failure)
- **Videos**: `test-results/**/*.webm` (on failure)
- **Traces**: `test-results/**/*.zip`
  ```bash
  npx playwright show-trace test-results/path/to/trace.zip
  ```
- **HTML Report**: `npx playwright show-report`

---

## Best Practices

1. **Test user behavior, not implementation** - Focus on what users see and do
2. **Use stable selectors** - Prefer `data-testid` over CSS classes
3. **Keep tests independent** - No shared state between tests
4. **Explicit waits** - Use `waitForSelector`, not arbitrary timeouts
5. **Mock external APIs** - OpenAI responses are mocked for speed

---

## 1. Playwright Configuration

**File:** `playwright.config.ts`

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html'],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
  timeout: 30000,
  expect: {
    timeout: 10000,
  },
});
```

**Key Settings:**
- **Base URL:** `http://localhost:3000`
- **Timeouts:** 30s default, 60s for streaming operations
- **Retries:** 2 in CI, 0 locally
- **Parallel:** Yes (faster execution)
- **Video/Screenshots:** On failure only
- **Browsers:** Chromium (primary), Firefox (optional)

---

## 2. Critical User Journeys (52-66 Tests)

### Journey 1: Authentication Flow ✅ CRITICAL
**Priority:** HIGH
**File:** `e2e/specs/01-auth/auth.spec.ts`
**Estimated Tests:** 8-10
**Effort:** 1 day

**Test Scenarios:**

1. **Login with Valid Credentials**
   - Navigate to `/login`
   - Enter email: `abecha@gmail.com`, password: `password`
   - Click login button
   - Verify redirect to `/` (home page)
   - Verify user session exists (check for auth cookie)

2. **Login with Invalid Credentials**
   - Navigate to `/login`
   - Enter invalid email/password
   - Click login button
   - Verify error message displayed
   - Verify no redirect occurs
   - Verify no session created

3. **Signup Flow**
   - Navigate to `/login`
   - Switch to signup mode
   - Enter new user credentials
   - Submit form
   - Verify redirect to `/` or confirmation page

4. **Protected Route Redirect (Middleware)**
   - Navigate to `/userlibrary` (logged out)
   - Verify redirect to `/login`
   - Login successfully
   - Verify redirect back to `/userlibrary`

5. **Logout Functionality**
   - Login first
   - Navigate to any page
   - Click logout button in Navigation
   - Verify redirect to `/` or `/login`
   - Verify session cleared
   - Attempt to access `/userlibrary` → redirect to login

6. **Session Persistence**
   - Login successfully
   - Refresh page
   - Verify user still logged in (no redirect)
   - Navigate to different pages
   - Verify session maintained

7. **Direct Access to Login (Already Logged In)**
   - Login first
   - Navigate to `/login`
   - Verify redirect to `/` (already authenticated)

---

### Journey 2: Search → Generate → View Flow ✅ CRITICAL
**Priority:** CRITICAL (most important user journey)
**File:** `e2e/specs/02-search-generate/main-flow.spec.ts`
**Estimated Tests:** 12-15
**Effort:** 2-3 days

**Test Scenarios:**

1. **New Query Generation - Full Flow**
   - Navigate to `/` (home page)
   - Enter query: "Explain quantum entanglement"
   - Submit search
   - Verify redirect to `/results?q=Explain+quantum+entanglement`
   - **Streaming verification:**
     - Wait for streaming start indicator
     - Verify title appears (progress event: `title_generated`)
     - Verify content streams in chunks (multiple `content` events)
     - Verify streaming end event
     - Verify complete event with full result
   - **Content verification:**
     - Title is not empty
     - Content length > 100 characters
     - Markdown renders correctly (check for headings, lists, etc.)
   - **Tags verification:**
     - AI tags automatically assigned (count >= 1)
     - Tags displayed in TagBar
     - Tags match content difficulty/type
   - **Actions verification:**
     - "Save to Library" button enabled
     - Metrics displayed (views, saves)
     - URL contains `explanation_id` and `userQueryId`

2. **Vector Match Flow - Skip Generation**
   - Seed database with existing explanation for "Python basics"
   - Seed Pinecone with matching vector
   - Navigate to `/`
   - Search for "Python basics"
   - Verify NO streaming occurs (match found)
   - Verify existing explanation displayed immediately
   - Verify matched explanation ID in URL
   - Verify "Similar explanation found" indicator (if exists)

3. **Save to Library Flow**
   - Login first
   - Generate new explanation
   - Click "Save to Library" button
   - Verify success message/indicator
   - Navigate to `/userlibrary`
   - Verify explanation appears in library

---

### Journey 3: Library Management ✅ HIGH PRIORITY
**Priority:** HIGH
**File:** `e2e/specs/03-library/library.spec.ts`
**Estimated Tests:** 8-10
**Effort:** 1 day

**Test Scenarios:**

1. **View User Library (Authenticated)**
   - Login first
   - Seed 3 explanations in user's library
   - Navigate to `/userlibrary`
   - Verify 3 explanations displayed
   - Verify table shows: title, date saved, tags

2. **Library Empty State**
   - Login with new user (no saves)
   - Navigate to `/userlibrary`
   - Verify empty state message displayed

3. **Remove from Library**
   - Login, navigate to `/userlibrary`
   - Click remove/delete button on explanation
   - Verify confirmation dialog (if exists)
   - Confirm removal
   - Verify explanation disappears from list
   - Verify explanation still exists in main browse (not deleted, just unsaved)

4. **Open Explanation from Library**
   - Navigate to `/userlibrary`
   - Click on saved explanation
   - Verify redirect to `/results?explanation_id={id}`
   - Verify content loads correctly
   - Verify "Saved" indicator present

5. **Library Sorting**
   - Seed 5 explanations with different save dates
   - Navigate to `/userlibrary`
   - Click sort by "Date Saved" (asc/desc)
   - Verify order changes correctly
   - Click sort by "Title"
   - Verify alphabetical sorting

---

### Journey 4: Content Viewing & Interaction
**Priority:** MEDIUM
**File:** `e2e/specs/04-content-viewing/viewing.spec.ts`
**Estimated Tests:** 6-8
**Effort:** 1 day

### Journey 5: Tag Management
**Priority:** MEDIUM
**File:** `e2e/specs/04-content-viewing/tags.spec.ts`
**Estimated Tests:** 5-7
**Effort:** 1 day

### Journey 6: Content Regeneration
**Priority:** MEDIUM
**File:** `e2e/specs/02-search-generate/regenerate.spec.ts`
**Estimated Tests:** 5-6
**Effort:** 1 day

### Journey 7: Error & Edge Cases
**Priority:** LOW (but important for stability)
**File:** `e2e/specs/05-edge-cases/errors.spec.ts`
**Estimated Tests:** 8-10
**Effort:** 1 day

---

## 3. Mock Strategy

### 3.1 Mock OpenAI Responses

**Approach:** Use Playwright's route mocking to intercept OpenAI API calls

```typescript
// e2e/helpers/api-mocks.ts
import { Page } from '@playwright/test';

export async function mockOpenAIStreaming(page: Page, mockResponse: {
  title: string;
  content: string;
  tags: string[];
}) {
  await page.route('https://api.openai.com/v1/chat/completions', async (route) => {
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      start(controller) {
        // Send title
        controller.enqueue(encoder.encode(`data: {"type":"progress","stage":"title_generated","title":"${mockResponse.title}"}\n\n`));

        // Send content in chunks
        const chunks = mockResponse.content.match(/.{1,50}/g) || [];
        chunks.forEach(chunk => {
          controller.enqueue(encoder.encode(`data: {"type":"content","content":"${chunk}"}\n\n`));
        });

        // Send completion
        controller.enqueue(encoder.encode(`data: {"type":"streaming_end"}\n\n`));
        controller.enqueue(encoder.encode(`data: {"type":"complete","result":{"title":"${mockResponse.title}","content":"${mockResponse.content}"}}\n\n`));

        controller.close();
      }
    });

    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: stream,
    });
  });
}
```

### 3.2 Database Strategy

**Uses `.env.local` credentials** - same database as development
- No separate test database needed
- Tests run against real data structure
- Be cautious about creating test data that persists

---

## 4. Test Data & Seeding

### 4.1 Test User Account

**Email:** `abecha@gmail.com`
**Password:** `password`

**Setup:**
- User already exists in Supabase Auth
- Use for all authenticated tests
- Pre-configured in `.env.local`

---

## 5. Timeline & Effort Estimates

| Phase | Task | Duration | Tests | Status |
|-------|------|----------|-------|--------|
| **Phase 1** | Setup & Configuration | 2 days | 3 smoke | ✅ COMPLETE |
| **Phase 2** | Journey 1: Authentication | 1 day | 9 (8 pass) | ✅ COMPLETE |
| **Phase 3** | Journey 2: Search/Generate (Part 1) | 2 days | 8-10 | ❌ NOT STARTED |
| **Phase 4** | Journey 2: Search/Generate (Part 2) | 1 day | 4-5 | ❌ NOT STARTED |
| **Phase 5** | Journey 3: Library Management | 1 day | 8-10 | ❌ NOT STARTED |
| **Phase 6** | Journey 4: Content Viewing + Tags | 1 day | 11-15 | ❌ NOT STARTED |
| **Phase 7** | Journey 6: Regenerate + Journey 7: Errors | 1 day | 13-16 | ❌ NOT STARTED |
| **Phase 8** | CI/CD Integration + Documentation | 1 day | - | ❌ NOT STARTED |

**Total:** 10-12 days
**Total Tests:** 52-66 E2E tests (12 currently implemented: 3 smoke + 9 auth)

---

## 6. Success Metrics

### 6.1 Coverage Metrics
✅ **7 critical user journeys** tested end-to-end
✅ **5 core pages** covered: home, results, library, explanations, login
✅ **3 major features** validated: generation, tags, library
✅ **10+ error scenarios** tested for stability

### 6.2 Quality Metrics
🎯 **< 5% flaky test rate** (stable, deterministic tests)
🎯 **< 10 minutes total execution time** (parallel execution)
🎯 **95%+ pass rate in CI** (reliable regression detection)
🎯 **100% critical paths covered** (no blind spots)

---

## 7. Required Code Changes (Remaining)

### 7.1 Add More data-testid Attributes

**Files to update:**

1. **Results page** (`src/app/results/page.tsx`)
   - Add `data-testid="explanation-title"` to title
   - Add `data-testid="explanation-content"` to content area
   - Add `data-testid="stream-complete"` when streaming finishes
   - Add `data-testid="save-to-library"` to save button
   - Add `data-testid="regenerate-button"` to regenerate button

2. **TagBar component** (`src/components/TagBar.tsx`)
   - Add `data-testid="tag-item"` to each tag
   - Add `data-testid="tag-add-button"` to add button
   - Add `data-testid="tag-apply-button"` to apply button

3. **Library page** (`src/app/userlibrary/page.tsx`)
   - Add `data-testid="explanation-row"` to each row
   - Add `data-testid="explanation-title"` to title cells
   - Add `data-testid="save-date"` to date cells
   - Add `data-testid="remove-{id}"` to remove buttons

---

## 8. CI/CD Integration (Phase 8)

### 8.1 GitHub Actions Workflow

**Create:** `.github/workflows/e2e.yml`

```yaml
name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  e2e-test:
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium firefox

      - name: Build Next.js app
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          MOCK_OPENAI: true

      - name: Run E2E tests
        run: npx playwright test
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
          TEST_USER_EMAIL: abecha@gmail.com
          TEST_USER_PASSWORD: password
          MOCK_OPENAI: true
          CI: true

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30

      - name: Upload videos (failures only)
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-videos
          path: test-results/**/*.webm
          retention-days: 7
```

---

## 9. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Flaky streaming tests** | High | Medium | Add robust wait strategies, mock deterministic responses |
| **Test data conflicts** | Medium | Low | Use unique test data identifiers, cleanup between tests |
| **Long execution time** | Medium | Medium | Parallel execution, mock OpenAI, optimize waits |
| **CI environment differences** | High | Low | Use Docker for consistent environment, explicit browser install |
| **Mock drift from real API** | Medium | Medium | Periodic manual testing with real OpenAI, update mocks |

---

## 10. Next Steps (Immediate Actions)

### To Complete Phase 2 (Auth Flow):
1. Create `e2e/specs/01-auth/auth.spec.ts` with 8-10 tests
2. Test login success/failure flows
3. Test protected route redirects
4. Test logout functionality
5. Test session persistence

### To Run Current Smoke Tests:
```bash
# Terminal 1: Start dev server
npm run dev

# Terminal 2: Run E2E tests
npm run test:e2e
```

---

## Summary

**Phase 2 COMPLETE** - Authentication flow tests implemented:
- Playwright configuration ready
- Directory structure created (now in `src/__tests__/e2e/`)
- 3 POMs implemented (Login, Search, Base)
- 12+ data-testid attributes added to components
- 12 tests total: 3 smoke tests + 9 auth tests (8 passing, 1 skipped)
- NPM scripts configured
- Auth fixtures with proper Supabase cookie detection

**Next:** Phase 3 - Search & Generate Flow (8-10 tests)

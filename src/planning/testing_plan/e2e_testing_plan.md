# Phase 4: E2E Testing with Playwright - Implementation Plan

## Executive Summary

**Goal:** Validate critical user journeys end-to-end to ensure application reliability and prevent regressions
**Timeline:** 2-3 weeks (10-12 days of focused work)
**Priority:** Medium (optional enhancement, but high value for regression prevention)
**Current Status:** Playwright 1.56.1 installed, no config or test files exist
**Target:** 52-66 E2E tests covering 7 critical user journeys

---

## Key Decisions

✅ **LLM Responses:** Mock OpenAI API for speed, determinism, and cost control
✅ **Database:** Schema isolation (Option B) - use test_* prefixed tables in same Supabase project
✅ **Scope:** E2E tests focus on user flows; Lexical editor stays in Phase 7 unit tests
✅ **Video Recording:** Record only on failures to save storage costs
✅ **Browsers:** Primary focus on Chromium, optional Firefox for critical flows

---

## 1. Setup & Configuration (Week 1, Days 1-2)

### 1.1 Playwright Configuration

**Create:** `playwright.config.ts`

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
  timeout: 30000, // Default timeout
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

### 1.2 Test Directory Structure

```
e2e/
├── fixtures/
│   ├── auth.ts              # Authentication state management
│   ├── database.ts          # DB seeding/cleanup utilities
│   └── test-data.ts         # Test data generators
├── helpers/
│   ├── pages/               # Page Object Models
│   │   ├── SearchPage.ts
│   │   ├── ResultsPage.ts
│   │   ├── LibraryPage.ts
│   │   └── LoginPage.ts
│   ├── api-mocks.ts         # OpenAI/API mocking utilities
│   └── streaming.ts         # Streaming response helpers
├── specs/
│   ├── 01-auth/
│   │   └── auth.spec.ts
│   ├── 02-search-generate/
│   │   ├── main-flow.spec.ts
│   │   └── regenerate.spec.ts
│   ├── 03-library/
│   │   └── library.spec.ts
│   ├── 04-content-viewing/
│   │   ├── viewing.spec.ts
│   │   └── tags.spec.ts
│   └── 05-edge-cases/
│       └── errors.spec.ts
└── setup/
    ├── global-setup.ts      # Run once before all tests
    └── global-teardown.ts   # Run once after all tests
```

### 1.3 Environment Setup

**Create:** `.env.test`

```bash
# Test Database (same Supabase project, different schema/tables)
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# Test User Credentials
TEST_USER_EMAIL=abecha@gmail.com
TEST_USER_PASSWORD=password

# Pinecone Test Namespace
PINECONE_NAMESPACE=test-e2e

# Mock OpenAI (for E2E tests)
MOCK_OPENAI=true
```

**Database Strategy (Option B - Schema Isolation):**
- Use same Supabase project
- Create test-prefixed tables: `test_explanations`, `test_userLibrary`, `test_tags`, etc.
- Seed test data before test runs
- Clean up after tests complete
- Advantages: Simpler setup, shares infrastructure, no extra costs

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

**Page Object Model:**

```typescript
// e2e/helpers/pages/LoginPage.ts
export class LoginPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="password"]', password);
    await this.page.click('button[type="submit"]');
  }

  async getErrorMessage() {
    return await this.page.textContent('[data-testid="error-message"]');
  }

  async isLoggedIn() {
    // Check for auth cookie or user indicator
    const cookies = await this.page.context().cookies();
    return cookies.some(c => c.name.includes('supabase'));
  }
}
```

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

3. **Generation Mode: Skip Match**
   - Navigate to `/results?q=test&mode=skip`
   - Verify generation occurs even if match exists
   - Verify new explanation created (different explanation_id)

4. **Generation Mode: Force Match**
   - Seed explanation + vector for "React hooks"
   - Navigate to `/results?q=similar+query&mode=force`
   - Verify match returned (no generation)

5. **Streaming Error Handling**
   - Mock OpenAI to return error mid-stream
   - Search for query
   - Verify error message displayed
   - Verify partial content NOT saved
   - Verify user can retry

6. **Long Content Generation**
   - Search for "Complete history of World War II"
   - Verify streaming handles large content (1000+ chars)
   - Verify no timeout errors
   - Verify content displays correctly

7. **Math Rendering (KaTeX)**
   - Search for "Pythagorean theorem"
   - Verify LaTeX equations render (look for `.katex` class)
   - Verify inline and block math work

8. **Save to Library Flow**
   - Login first
   - Generate new explanation
   - Click "Save to Library" button
   - Verify success message/indicator
   - Navigate to `/userlibrary`
   - Verify explanation appears in library

9. **Unsaved Content Warning**
   - Generate explanation (don't save)
   - Attempt to navigate away
   - Verify warning modal (if implemented)

**Page Object Models:**

```typescript
// e2e/helpers/pages/SearchPage.ts
export class SearchPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/');
  }

  async search(query: string) {
    await this.page.fill('[data-testid="search-input"]', query);
    await this.page.click('[data-testid="search-submit"]');
  }

  async selectMode(mode: 'normal' | 'skip' | 'force') {
    if (mode !== 'normal') {
      await this.page.selectOption('[data-testid="mode-select"]', mode);
    }
  }
}

// e2e/helpers/pages/ResultsPage.ts
export class ResultsPage {
  constructor(private page: Page) {}

  async waitForStreamingComplete(timeout = 60000) {
    await this.page.waitForSelector('[data-testid="stream-complete"]', { timeout });
  }

  async getTitle() {
    return await this.page.textContent('[data-testid="explanation-title"]');
  }

  async getContent() {
    return await this.page.textContent('[data-testid="explanation-content"]');
  }

  async getTags() {
    const tags = await this.page.locator('[data-testid="tag-item"]').all();
    return Promise.all(tags.map(t => t.textContent()));
  }

  async saveToLibrary() {
    await this.page.click('[data-testid="save-to-library"]');
    await this.page.waitForSelector('[data-testid="save-success"]');
  }

  async getMetrics() {
    return {
      views: await this.page.textContent('[data-testid="metric-views"]'),
      saves: await this.page.textContent('[data-testid="metric-saves"]'),
    };
  }
}
```

**Streaming Helper:**

```typescript
// e2e/helpers/streaming.ts
export async function waitForStreamingEvents(page: Page, expectedEvents: string[]) {
  const events: any[] = [];

  // Intercept streaming endpoint
  await page.route('/api/returnExplanation', async (route) => {
    const response = await route.fetch();
    const reader = response.body?.getReader();

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const event = JSON.parse(line.slice(6));
            events.push(event);
          }
        }
      }
    }

    await route.fulfill({ response });
  });

  return events;
}
```

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

3. **Save Explanation to Library**
   - (Already covered in Journey 2, Test 8)
   - Verify explanation appears in library immediately

4. **Remove from Library**
   - Login, navigate to `/userlibrary`
   - Click remove/delete button on explanation
   - Verify confirmation dialog (if exists)
   - Confirm removal
   - Verify explanation disappears from list
   - Verify explanation still exists in main browse (not deleted, just unsaved)

5. **Open Explanation from Library**
   - Navigate to `/userlibrary`
   - Click on saved explanation
   - Verify redirect to `/results?explanation_id={id}`
   - Verify content loads correctly
   - Verify "Saved" indicator present

6. **Library Sorting**
   - Seed 5 explanations with different save dates
   - Navigate to `/userlibrary`
   - Click sort by "Date Saved" (asc/desc)
   - Verify order changes correctly
   - Click sort by "Title"
   - Verify alphabetical sorting

7. **Library Pagination (if implemented)**
   - Seed 50 explanations
   - Navigate to `/userlibrary`
   - Verify pagination controls
   - Navigate to page 2
   - Verify different explanations displayed

**Page Object Model:**

```typescript
// e2e/helpers/pages/LibraryPage.ts
export class LibraryPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/userlibrary');
  }

  async getSavedExplanations() {
    const rows = await this.page.locator('[data-testid="explanation-row"]').all();
    return Promise.all(rows.map(async row => ({
      title: await row.locator('[data-testid="explanation-title"]').textContent(),
      date: await row.locator('[data-testid="save-date"]').textContent(),
    })));
  }

  async removeFromLibrary(explanationId: string) {
    await this.page.click(`[data-testid="remove-${explanationId}"]`);
    await this.page.waitForSelector(`[data-testid="explanation-${explanationId}"]`, { state: 'detached' });
  }

  async sortBy(field: 'title' | 'date') {
    await this.page.click(`[data-testid="sort-${field}"]`);
  }

  async openExplanation(explanationId: string) {
    await this.page.click(`[data-testid="open-${explanationId}"]`);
  }
}
```

---

### Journey 4: Content Viewing & Interaction
**Priority:** MEDIUM
**File:** `e2e/specs/04-content-viewing/viewing.spec.ts`
**Estimated Tests:** 6-8
**Effort:** 1 day

**Test Scenarios:**

1. **Markdown Toggle (View Mode)**
   - Load explanation with markdown content
   - Verify formatted view renders (headings, lists, bold, etc.)
   - Click "Plain Text" toggle (if exists)
   - Verify raw markdown displayed
   - Toggle back to formatted
   - Verify formatted view restored

2. **Math Rendering (KaTeX)**
   - Load explanation with LaTeX equations
   - Verify inline math renders: `$E=mc^2$`
   - Verify block math renders: `$$\int_{a}^{b} f(x) dx$$`
   - Verify no raw LaTeX visible (no `$$` or `$` in display)

3. **Code Blocks**
   - Load explanation with code blocks
   - Verify syntax highlighting (check for `.hljs` or similar class)
   - Verify language label (e.g., "python", "javascript")

4. **Link Enhancement Display**
   - Load explanation with enhanced links
   - Verify heading links work (click scrolls to section)
   - Verify external links open in new tab (target="_blank")

5. **Long Content Scrolling**
   - Load explanation with 2000+ words
   - Scroll to bottom
   - Verify content renders correctly throughout
   - Verify no layout breaks or overflow issues

6. **Responsive Layout (Mobile)**
   - Set viewport to mobile size (375x667)
   - Load explanation
   - Verify content readable (no horizontal scroll)
   - Verify TagBar responsive
   - Verify Navigation collapses correctly

7. **Image Display (if embedded in content)**
   - Load explanation with images
   - Verify images load correctly
   - Verify alt text present

---

### Journey 5: Tag Management
**Priority:** MEDIUM
**File:** `e2e/specs/04-content-viewing/tags.spec.ts`
**Estimated Tests:** 5-7
**Effort:** 1 day

**Test Scenarios:**

1. **View Auto-Assigned Tags**
   - Generate new explanation
   - Verify AI tags automatically appear in TagBar
   - Verify tag types: difficulty, length, teaching method
   - Verify preset tag collections (mutually exclusive groups)

2. **Tag Display in Browse**
   - Navigate to `/explanations`
   - Verify tags displayed in table for each explanation
   - Verify tag colors/styles consistent

3. **Rewrite with Tags Mode**
   - Load explanation with tags
   - Click "Rewrite with tags" button
   - Verify TagBar enters edit mode
   - Add new tag (if allowed)
   - Remove existing tag
   - Click "Apply" button
   - Verify streaming regeneration starts
   - Verify new explanation matches selected tags

4. **Edit with Tags Mode**
   - Load explanation
   - Click "Edit with tags" button
   - Modify tags
   - Click "Apply"
   - Verify explanation updated (no regeneration, just tag update)

5. **Preset Tag Collections Validation**
   - Enter tag edit mode
   - Select tag from preset group (e.g., "Beginner" from difficulty)
   - Attempt to select conflicting tag (e.g., "Advanced")
   - Verify only one tag from preset group selected
   - Verify validation error or auto-deselect previous

6. **Tag Filtering in Browse (if implemented)**
   - Navigate to `/explanations`
   - Click filter by tag (e.g., "Beginner")
   - Verify only explanations with that tag displayed

---

### Journey 6: Content Regeneration
**Priority:** MEDIUM
**File:** `e2e/specs/02-search-generate/regenerate.spec.ts`
**Estimated Tests:** 5-6
**Effort:** 1 day

**Test Scenarios:**

1. **Regenerate Explanation**
   - Load existing explanation
   - Click "Regenerate" button
   - Verify confirmation dialog (if exists)
   - Confirm regeneration
   - Verify streaming starts
   - Verify new content generated (different from original)
   - Verify new explanation_id assigned

2. **Regenerate with Different Mode**
   - Load explanation
   - Select "Skip Match" mode
   - Click regenerate
   - Verify new generation (no match lookup)

3. **Regenerate Preserves Query**
   - Load explanation from query "Python loops"
   - Regenerate
   - Verify new explanation still about "Python loops"

4. **Regenerate Error Handling**
   - Mock OpenAI to fail
   - Click regenerate
   - Verify error message displayed
   - Verify original content NOT overwritten
   - Verify user can retry

5. **Regenerate from Library**
   - Open saved explanation from library
   - Regenerate
   - Verify new version generated
   - Verify library entry NOT updated (new explanation, not overwrite)

---

### Journey 7: Error & Edge Cases
**Priority:** LOW (but important for stability)
**File:** `e2e/specs/05-edge-cases/errors.spec.ts`
**Estimated Tests:** 8-10
**Effort:** 1 day

**Test Scenarios:**

1. **Network Offline Mode**
   - Set browser offline
   - Attempt to search
   - Verify offline error message
   - Restore connection
   - Verify retry works

2. **LLM API Timeout**
   - Mock OpenAI to delay 30+ seconds
   - Search for query
   - Verify timeout error displayed
   - Verify partial content NOT saved

3. **LLM API Error (500)**
   - Mock OpenAI to return 500 error
   - Search for query
   - Verify friendly error message
   - Verify option to retry

4. **Invalid Query (Empty)**
   - Navigate to `/`
   - Submit empty search
   - Verify validation error
   - Verify no navigation occurs

5. **Invalid Query (Too Long)**
   - Enter 1000+ character query
   - Submit search
   - Verify validation error or truncation

6. **Database Connection Error**
   - Mock Supabase to fail
   - Attempt to save explanation
   - Verify error message
   - Verify explanation still viewable (not lost)

7. **Unauthenticated Access to Protected Route**
   - (Already covered in Journey 1, Test 4)
   - Verify redirect to login

8. **Session Expiration**
   - Login
   - Manually delete auth cookie
   - Navigate to `/userlibrary`
   - Verify redirect to login

9. **Concurrent Edits (Race Condition)**
   - Open same explanation in 2 tabs
   - Edit in tab 1, save
   - Edit in tab 2, save
   - Verify conflict handling (last write wins or merge)

10. **Malformed URL Parameters**
    - Navigate to `/results?explanation_id=invalid`
    - Verify error page or redirect to home
    - Navigate to `/results?q=`
    - Verify validation error

---

## 3. Mock Strategy

### 3.1 Mock OpenAI Responses

**Approach:** Use Playwright's route mocking to intercept OpenAI API calls

**Implementation:**

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

    // Simulate streaming response
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

export async function mockOpenAIError(page: Page, errorCode: number = 500) {
  await page.route('https://api.openai.com/v1/**', async (route) => {
    await route.fulfill({
      status: errorCode,
      body: JSON.stringify({ error: { message: 'Mock OpenAI error' } }),
    });
  });
}

export async function mockOpenAIEmbeddings(page: Page) {
  await page.route('https://api.openai.com/v1/embeddings', async (route) => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({
        data: [{
          embedding: Array(1536).fill(0).map(() => Math.random()),
        }],
      }),
    });
  });
}
```

**Usage in Tests:**

```typescript
import { test } from '@playwright/test';
import { mockOpenAIStreaming } from '../helpers/api-mocks';

test('search generates explanation', async ({ page }) => {
  await mockOpenAIStreaming(page, {
    title: 'Quantum Entanglement Explained',
    content: 'Quantum entanglement is a phenomenon...',
    tags: ['Physics', 'Advanced', 'Conceptual'],
  });

  // Rest of test...
});
```

### 3.2 Database Strategy (Schema Isolation)

**Approach:** Use test-prefixed tables in the same Supabase project

**Test Tables:**
- `test_explanations`
- `test_topics`
- `test_tags`
- `test_explanation_tags`
- `test_userLibrary`
- `test_userQueries`
- `test_userExplanationEvents`
- `test_explanationMetrics`

**Seeding Script:**

```typescript
// e2e/fixtures/database.ts
import { createClient } from '@supabase/supabase-js';

export async function seedTestDatabase() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Seed test topics
  await supabase.from('test_topics').insert([
    { id: 1, topic_name: 'Physics', topic_description: 'Physics topics' },
    { id: 2, topic_name: 'Programming', topic_description: 'Programming topics' },
    { id: 3, topic_name: 'Mathematics', topic_description: 'Math topics' },
  ]);

  // Seed test tags
  await supabase.from('test_tags').insert([
    { id: 1, tag_name: 'Beginner', tag_description: 'Beginner level', presetTagId: 1 },
    { id: 2, tag_name: 'Intermediate', tag_description: 'Intermediate level', presetTagId: 1 },
    { id: 3, tag_name: 'Advanced', tag_description: 'Advanced level', presetTagId: 1 },
    { id: 4, tag_name: 'Short', tag_description: 'Short content', presetTagId: 2 },
    { id: 5, tag_name: 'Long', tag_description: 'Long content', presetTagId: 2 },
  ]);

  // Seed test explanations
  await supabase.from('test_explanations').insert([
    {
      id: 1,
      title: 'Python Basics',
      content: '# Python Basics\n\nPython is a high-level programming language...',
      status: 'published',
      primary_topic_id: 2,
    },
    // More explanations...
  ]);

  // Seed Pinecone vectors (via API)
  // ... vector seeding code
}

export async function cleanupTestDatabase() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase.from('test_explanation_tags').delete().neq('id', 0);
  await supabase.from('test_explanations').delete().neq('id', 0);
  await supabase.from('test_tags').delete().neq('id', 0);
  await supabase.from('test_topics').delete().neq('id', 0);
  await supabase.from('test_userLibrary').delete().neq('id', 0);
  await supabase.from('test_userQueries').delete().neq('id', 0);
}
```

### 3.3 Pinecone Test Namespace

**Approach:** Use dedicated test namespace in Pinecone index

**Namespace:** `test-e2e`

**Seeding:**
- Pre-populate 5-10 vectors for match testing
- Use deterministic embeddings (from seed data)
- Clean up after tests

---

## 4. Test Data & Seeding

### 4.1 Test User Account

**Email:** `abecha@gmail.com`
**Password:** `password`

**Setup:**
- Ensure user exists in Supabase Auth
- Pre-create in global setup if needed
- Use for all authenticated tests

### 4.2 Test Data Fixtures

**Topics:**
- Physics
- Programming
- Mathematics
- Science
- History

**Explanations:**
- "Python Basics" (Programming, Beginner, Short)
- "Quantum Entanglement" (Physics, Advanced, Long)
- "Pythagorean Theorem" (Mathematics, Intermediate, Short)
- "World War II Overview" (History, Intermediate, Long)
- "React Hooks" (Programming, Intermediate, Short)

**Tags:**
- Difficulty: Beginner, Intermediate, Advanced (preset group 1)
- Length: Short, Medium, Long (preset group 2)
- Method: Conceptual, Step-by-step, Example-based (preset group 3)

### 4.3 Global Setup/Teardown

```typescript
// e2e/setup/global-setup.ts
import { seedTestDatabase } from '../fixtures/database';

export default async function globalSetup() {
  console.log('🌱 Seeding test database...');
  await seedTestDatabase();
  console.log('✅ Test database ready');
}

// e2e/setup/global-teardown.ts
import { cleanupTestDatabase } from '../fixtures/database';

export default async function globalTeardown() {
  console.log('🧹 Cleaning up test database...');
  await cleanupTestDatabase();
  console.log('✅ Cleanup complete');
}
```

**Update playwright.config.ts:**

```typescript
export default defineConfig({
  // ...
  globalSetup: './e2e/setup/global-setup.ts',
  globalTeardown: './e2e/setup/global-teardown.ts',
});
```

---

## 5. Page Object Model (POM) Design

### 5.1 Benefits
- Reusable code across tests
- Easier maintenance (change UI → update POM, not every test)
- Better readability (test intent clear, not implementation details)

### 5.2 POM Structure

**Base Page:**

```typescript
// e2e/helpers/pages/BasePage.ts
import { Page } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async navigate(path: string) {
    await this.page.goto(path);
  }

  async waitForNavigation(url: string) {
    await this.page.waitForURL(url);
  }

  async screenshot(name: string) {
    await this.page.screenshot({ path: `screenshots/${name}.png` });
  }
}
```

**Specific Pages:**

```typescript
// e2e/helpers/pages/SearchPage.ts
import { BasePage } from './BasePage';

export class SearchPage extends BasePage {
  private searchInput = '[data-testid="search-input"]';
  private searchButton = '[data-testid="search-submit"]';
  private modeSelect = '[data-testid="mode-select"]';

  async navigate() {
    await super.navigate('/');
  }

  async search(query: string, mode?: 'normal' | 'skip' | 'force') {
    if (mode && mode !== 'normal') {
      await this.page.selectOption(this.modeSelect, mode);
    }

    await this.page.fill(this.searchInput, query);
    await this.page.click(this.searchButton);
  }

  async isSearchButtonDisabled() {
    return await this.page.isDisabled(this.searchButton);
  }
}

// e2e/helpers/pages/ResultsPage.ts
import { BasePage } from './BasePage';

export class ResultsPage extends BasePage {
  private titleSelector = '[data-testid="explanation-title"]';
  private contentSelector = '[data-testid="explanation-content"]';
  private tagItemSelector = '[data-testid="tag-item"]';
  private saveButton = '[data-testid="save-to-library"]';

  async waitForStreamingComplete(timeout = 60000) {
    await this.page.waitForSelector('[data-testid="stream-complete"]', { timeout });
  }

  async getTitle() {
    return await this.page.textContent(this.titleSelector);
  }

  async getContent() {
    return await this.page.textContent(this.contentSelector);
  }

  async getTags() {
    const tags = await this.page.locator(this.tagItemSelector).all();
    return Promise.all(tags.map(t => t.textContent()));
  }

  async saveToLibrary() {
    await this.page.click(this.saveButton);
    await this.page.waitForSelector('[data-testid="save-success"]');
  }

  async regenerate() {
    await this.page.click('[data-testid="regenerate-button"]');
  }
}

// e2e/helpers/pages/LibraryPage.ts
import { BasePage } from './BasePage';

export class LibraryPage extends BasePage {
  async navigate() {
    await super.navigate('/userlibrary');
  }

  async getSavedExplanations() {
    const rows = await this.page.locator('[data-testid="explanation-row"]').all();
    return Promise.all(rows.map(async row => ({
      title: await row.locator('[data-testid="explanation-title"]').textContent(),
      date: await row.locator('[data-testid="save-date"]').textContent(),
    })));
  }

  async removeFromLibrary(explanationId: string) {
    await this.page.click(`[data-testid="remove-${explanationId}"]`);
  }

  async openExplanation(title: string) {
    await this.page.click(`text=${title}`);
  }
}

// e2e/helpers/pages/LoginPage.ts
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  private emailInput = 'input[name="email"]';
  private passwordInput = 'input[name="password"]';
  private submitButton = 'button[type="submit"]';

  async navigate() {
    await super.navigate('/login');
  }

  async login(email: string, password: string) {
    await this.page.fill(this.emailInput, email);
    await this.page.fill(this.passwordInput, password);
    await this.page.click(this.submitButton);
  }

  async getErrorMessage() {
    return await this.page.textContent('[data-testid="error-message"]');
  }

  async isLoggedIn() {
    const cookies = await this.page.context().cookies();
    return cookies.some(c => c.name.includes('supabase'));
  }
}
```

---

## 6. Streaming Response Handling

### 6.1 Challenge
OpenAI/LLM responses stream in chunks via SSE (Server-Sent Events). E2E tests must wait for complete stream before validating content.

### 6.2 Strategy

**Approach 1: Wait for completion indicator**

```typescript
// Add data-testid when streaming completes
// In ResultsPage component:
{streamComplete && <div data-testid="stream-complete" />}

// In E2E test:
await page.waitForSelector('[data-testid="stream-complete"]', { timeout: 60000 });
```

**Approach 2: Monitor network responses**

```typescript
// e2e/helpers/streaming.ts
export async function waitForStreamComplete(page: Page) {
  return new Promise<void>((resolve) => {
    page.on('response', async (response) => {
      if (response.url().includes('/api/returnExplanation')) {
        const body = await response.text();
        if (body.includes('"type":"complete"')) {
          resolve();
        }
      }
    });
  });
}
```

**Approach 3: Polling for content updates**

```typescript
export async function waitForContentStable(page: Page, selector: string, timeout = 60000) {
  let lastContent = '';
  let stableCount = 0;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const currentContent = await page.textContent(selector) || '';

    if (currentContent === lastContent) {
      stableCount++;
      if (stableCount >= 3) return; // Content stable for 3 checks
    } else {
      stableCount = 0;
    }

    lastContent = currentContent;
    await page.waitForTimeout(1000);
  }

  throw new Error('Content did not stabilize within timeout');
}
```

### 6.3 Recommended Approach

**Combination:**
1. Add `data-testid="stream-complete"` indicator in UI
2. Use `waitForSelector` with 60s timeout
3. Fallback to content stability polling if indicator fails

---

## 7. CI/CD Integration (Week 2, Day 5)

### 7.1 GitHub Actions Workflow

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

### 7.2 Required GitHub Secrets

**Add to repository settings:**
- `TEST_SUPABASE_URL` - Test Supabase project URL
- `TEST_SUPABASE_ANON_KEY` - Test Supabase anon key
- `TEST_SUPABASE_SERVICE_ROLE_KEY` - Test Supabase service role key

### 7.3 Test Environment

**Database:** Separate test Supabase project or schema isolation (test_* tables)
**APIs:** Mock OpenAI (set `MOCK_OPENAI=true`)
**Pinecone:** Test namespace (`test-e2e`)

---

## 8. Timeline & Effort Estimates

| Phase | Task | Duration | Tests | Notes |
|-------|------|----------|-------|-------|
| **Week 1** | | | | |
| Day 1-2 | Setup & Configuration | 2 days | - | Config, structure, seeding scripts |
| Day 3 | Journey 1: Authentication | 1 day | 8-10 | Login, logout, protected routes |
| Day 4-5 | Journey 2: Search/Generate (Part 1) | 2 days | 8-10 | Basic flow, streaming, tags |
| **Week 2** | | | | |
| Day 1 | Journey 2: Search/Generate (Part 2) | 1 day | 4-5 | Modes, error handling |
| Day 2 | Journey 3: Library Management | 1 day | 8-10 | Save, view, remove |
| Day 3 | Journey 4: Content Viewing | 1 day | 6-8 | Markdown, math, responsive |
| Day 4 | Journey 5: Tags + Journey 6: Regenerate | 1 day | 10-13 | Tag editing, regeneration |
| Day 5 | Journey 7: Error/Edge Cases | 1 day | 8-10 | Offline, timeouts, validation |
| **Week 3** | | | | |
| Day 1-2 | CI/CD Integration + Refinement | 2 days | - | GitHub Actions, flake fixes |
| Day 3 | Documentation + Final Testing | 1 day | - | README, troubleshooting guide |

**Total:** 12 days (2.5 weeks)
**Total Tests:** 52-66 E2E tests

---

## 9. Success Metrics

### 9.1 Coverage Metrics
✅ **7 critical user journeys** tested end-to-end
✅ **5 core pages** covered: home, results, library, explanations, login
✅ **3 major features** validated: generation, tags, library
✅ **10+ error scenarios** tested for stability

### 9.2 Quality Metrics
🎯 **< 5% flaky test rate** (stable, deterministic tests)
🎯 **< 10 minutes total execution time** (parallel execution)
🎯 **95%+ pass rate in CI** (reliable regression detection)
🎯 **100% critical paths covered** (no blind spots)

### 9.3 Business Impact
🎯 **Catch 1+ regression per month** (ROI justification)
🎯 **Reduce manual testing time** by 50%
🎯 **Faster deployment confidence** (automated validation)

---

## 10. Required Code Changes

### 10.1 Add data-testid Attributes

**Files to update:**

1. **SearchBar component** (`src/components/SearchBar.tsx`)
   - Add `data-testid="search-input"` to input
   - Add `data-testid="search-submit"` to button
   - Add `data-testid="mode-select"` to mode selector (if exists)

2. **Results page** (`src/app/results/page.tsx`)
   - Add `data-testid="explanation-title"` to title
   - Add `data-testid="explanation-content"` to content area
   - Add `data-testid="stream-complete"` when streaming finishes
   - Add `data-testid="save-to-library"` to save button
   - Add `data-testid="regenerate-button"` to regenerate button

3. **TagBar component** (`src/components/TagBar.tsx`)
   - Add `data-testid="tag-item"` to each tag
   - Add `data-testid="tag-add-button"` to add button
   - Add `data-testid="tag-apply-button"` to apply button

4. **Library page** (`src/app/userlibrary/page.tsx`)
   - Add `data-testid="explanation-row"` to each row
   - Add `data-testid="explanation-title"` to title cells
   - Add `data-testid="save-date"` to date cells
   - Add `data-testid="remove-{id}"` to remove buttons

5. **Login page** (`src/app/login/page.tsx`)
   - Add `data-testid="error-message"` to error display

6. **Navigation component** (`src/components/Navigation.tsx`)
   - Add `data-testid="logout-button"` to logout button

### 10.2 Environment Variable Updates

**Add to `.env.example`:**

```bash
# E2E Testing
TEST_USER_EMAIL=abecha@gmail.com
TEST_USER_PASSWORD=password
PINECONE_NAMESPACE=test-e2e
MOCK_OPENAI=false
```

---

## 11. Best Practices

### 11.1 Test Design
✅ **Test user behavior, not implementation details**
✅ **Use stable selectors** (data-testid > CSS classes)
✅ **Keep tests independent** (no shared state between tests)
✅ **Test one thing per test** (single assertion focus)

### 11.2 Stability
✅ **Explicit waits over timeouts** (`waitForSelector` not `sleep`)
✅ **Retry logic for flaky operations** (network, animations)
✅ **Clean test data** (reset between tests)
✅ **Mock external APIs** (OpenAI) for determinism

### 11.3 Performance
✅ **Parallel execution** (Playwright default)
✅ **Reuse browser contexts** where safe
✅ **Video on failures only** (save storage)
✅ **Seed data once** (global setup, not per-test)

### 11.4 Debugging
✅ **Screenshots on failure** (automatic)
✅ **Video recording on failure** (automatic)
✅ **Use `page.pause()`** for local debugging
✅ **Playwright inspector** (`PWDEBUG=1 npx playwright test`)

---

## 12. Optional Enhancements

### 12.1 Visual Regression Testing
- Use Playwright screenshots comparison
- Track UI changes over time
- Catch unintended visual regressions

### 12.2 Performance Testing
- Integrate Lighthouse CI
- Track Core Web Vitals (LCP, FID, CLS)
- Performance budgets

### 12.3 Accessibility Testing
- Integrate axe-core
- Automated a11y checks
- WCAG compliance validation

### 12.4 Mobile Testing
- iOS Safari viewport
- Android Chrome viewport
- Touch interactions

### 12.5 Load Testing
- Artillery or k6 for API load tests
- Stress test streaming endpoints
- Database connection pool limits

---

## 13. Next Steps (Immediate Actions)

### Week 1, Day 1
1. ✅ Create `playwright.config.ts`
2. ✅ Set up directory structure (`e2e/fixtures/`, `e2e/helpers/`, `e2e/specs/`)
3. ✅ Create `.env.test` with test credentials
4. ✅ Write database seeding script (`e2e/fixtures/database.ts`)
5. ✅ Add data-testid attributes to SearchBar, ResultsPage

### Week 1, Day 2
6. ✅ Implement Page Object Models (SearchPage, ResultsPage, LoginPage, LibraryPage)
7. ✅ Set up OpenAI mocking utilities (`e2e/helpers/api-mocks.ts`)
8. ✅ Create streaming helper functions (`e2e/helpers/streaming.ts`)
9. ✅ Write global setup/teardown scripts

### Week 1, Day 3
10. ✅ Write Journey 1 tests (Authentication flow)
11. ✅ Run first tests, debug issues
12. ✅ Verify test database isolation working

**Continue with remaining journeys in Weeks 1-2...**

---

## 14. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Flaky streaming tests** | High | Medium | Add robust wait strategies, mock deterministic responses |
| **Test data conflicts** | Medium | Low | Schema isolation, cleanup between tests |
| **Long execution time** | Medium | Medium | Parallel execution, mock OpenAI, optimize waits |
| **CI environment differences** | High | Low | Use Docker for consistent environment, explicit browser install |
| **Mock drift from real API** | Medium | Medium | Periodic manual testing with real OpenAI, update mocks |
| **Database cleanup failures** | High | Low | Use transactions, automated cleanup verification |

---

## 15. Maintenance Plan

### 15.1 Monthly Tasks
- Review flaky test reports
- Update mocks to match OpenAI API changes
- Add tests for new features
- Optimize slow tests

### 15.2 Quarterly Tasks
- Review test coverage gaps
- Refactor Page Object Models
- Update Playwright to latest version
- Performance optimization

### 15.3 On Feature Release
- Add E2E tests for new features
- Update existing tests if UI changed
- Verify no regressions in CI

---

## 16. Documentation

### 16.1 README for E2E Tests

**Create:** `e2e/README.md`

```markdown
# E2E Tests

## Setup

1. Install dependencies: `npm install`
2. Install Playwright browsers: `npx playwright install`
3. Copy `.env.test.example` to `.env.test` and configure
4. Seed test database: `npm run test:e2e:seed`

## Running Tests

- All tests: `npx playwright test`
- Single test file: `npx playwright test e2e/specs/01-auth/auth.spec.ts`
- Headed mode (watch browser): `npx playwright test --headed`
- Debug mode: `PWDEBUG=1 npx playwright test`
- UI mode: `npx playwright test --ui`

## Debugging

- Screenshots: `test-results/**/*.png`
- Videos: `test-results/**/*.webm`
- Traces: `test-results/**/*.zip` (open with `npx playwright show-trace`)

## Writing Tests

See example tests in `e2e/specs/` and Page Object Models in `e2e/helpers/pages/`.
```

---

## Conclusion

This Phase 4 E2E Testing Plan provides a comprehensive strategy for validating critical user journeys in the ExplainAnything application. With 52-66 tests across 7 key flows, the plan balances thorough coverage with maintainability and execution speed.

**Key Strengths:**
- Focused on critical user paths (80/20 rule)
- Mocks external dependencies (OpenAI) for speed and cost
- Schema isolation for safe test data management
- Page Object Models for maintainability
- CI/CD integration for automated regression detection

**Timeline:** 2-3 weeks (on track with original estimate)

**ROI:** High value for regression prevention, faster deployments, reduced manual testing

**Next Action:** Begin Week 1, Day 1 setup tasks (create `playwright.config.ts` + directory structure)

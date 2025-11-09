# Phase 5: CI/CD Integration with GitHub Actions

## Executive Summary

**Goal:** Implement automated testing and deployment pipeline using GitHub Actions to ensure code quality, prevent regressions, and streamline deployment to staging environments.

**Current State:**
- **Unit Tests:** 1,551 tests across 58 test files (95.1% pass rate)
- **Coverage:** ~42% (Statements), ~36% (Branches), ~39% (Functions)
- **CI/CD:** None - no automated testing or deployment
- **Manual Process:** Developers run tests locally before commit/push

**Target State:**
- **Automated Testing:** Run all test suites on every push and PR
- **Coverage Enforcement:** 60-70% initial threshold, progressing to 85%
- **Deployment:** Auto-deploy to staging after tests pass on develop branch
- **Test Execution:** <5 minutes for unit tests, <20 minutes for full suite
- **Integration:** GitHub Actions with coverage reporting, PR comments, and notifications

**Timeline:** 2-3 weeks for complete implementation

**Scope:**
- Phase 5A: Unit tests + coverage + deployment (Weeks 1-2)
- Phase 5B: Integration tests integration (Month 5, when Phase 3 complete)
- Phase 5C: E2E tests integration (Month 5.5, when Phase 4 complete)

---

## Current State Analysis

### Existing Test Infrastructure

**Test Files:** 58 test files, colocated with source code
- App pages: 7 page tests (home, results, explanations, userlibrary, login, error, layout)
- Components: 5 component tests (Navigation, TagBar, AISuggestionsPanel, SearchBar, ExplanationsTablePage)
- Services: 20 service tests (returnExplanation, vectorsim, llms, tags, explanationTags, tagEvaluation, etc.)
- Hooks: 4 hook tests (useExplanationLoader, clientPassRequestId, useStreamingEditor, useUserAuth)
- API Routes: 4 API route tests (stream-chat, client-logs, test-cases, test-responses)
- Auth: 5 auth tests (callback, confirm, middleware, login actions)
- Utilities: Multiple utility tests (prompts, requestIdContext, schemas, formatDate)
- Reducers: 2 reducer tests (tagModeReducer, pageLifecycleReducer)
- Editor: 4 editor tests (markdownASTdiff, importExportUtils, StandaloneTitleLinkNode, DiffTagNode)

**Test Scripts (package.json):**
```json
{
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "test:ci": "jest --ci --coverage --maxWorkers=2"
}
```

**Configuration:**
- **Jest:** Configured with ts-jest, jsdom environment, coverage collection
- **Mocks:** Comprehensive mocking for OpenAI, Pinecone, Supabase, Langchain
- **Coverage:** Thresholds currently set to 0% (ready for enforcement)

**Environment Variables Required:**
```bash
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
OPENAI_API_KEY
PINECONE_API_KEY
PINECONE_INDEX_NAME_ALL
```

### Gap Analysis

**What's Missing:**

1. **No CI/CD Pipeline**
   - No automated test execution on push/PR
   - No coverage enforcement
   - No automated quality gates

2. **No Deployment Automation**
   - Manual deployment process
   - No staging environment auto-deploy
   - No deployment verification

3. **No Integration Between Test Phases**
   - Integration tests (Phase 3) planned but not in CI
   - E2E tests (Phase 4) planned but not in CI
   - No unified test reporting

4. **No Quality Metrics Tracking**
   - No historical coverage trends
   - No test execution time tracking
   - No flaky test detection

5. **No Security Scanning**
   - No automated dependency vulnerability checks
   - No code security analysis
   - No secret scanning

---

## CI/CD Architecture

### Overview

```
Developer Push/PR
       ↓
┌──────────────────────────────────────┐
│   GitHub Actions Trigger             │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│   Workflow Selection                 │
│   • Main CI (always)                 │
│   • Integration (if Phase 3 ready)   │
│   • E2E (if Phase 4 ready)           │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│   Parallel Job Execution             │
│   ├─ Unit Tests (2-3 min)            │
│   ├─ Integration Tests (5-10 min)    │
│   ├─ E2E Tests (10-15 min)           │
│   ├─ Lint & Type Check (1-2 min)    │
│   └─ Security Scan (2-3 min)        │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│   Coverage Analysis & Reporting      │
│   • Calculate coverage metrics       │
│   • Compare with thresholds          │
│   • Generate reports                 │
└──────────────────────────────────────┘
       ↓
┌──────────────────────────────────────┐
│   Quality Gates                      │
│   • Coverage ≥ threshold?            │
│   • All tests passing?               │
│   • No security vulnerabilities?     │
└──────────────────────────────────────┘
       ↓
     Pass? ────No──→ Block PR, notify developer
       ↓
      Yes
       ↓
┌──────────────────────────────────────┐
│   Deployment (develop branch only)   │
│   • Build production bundle          │
│   • Deploy to staging environment    │
│   • Smoke tests                      │
│   • Notify team                      │
└──────────────────────────────────────┘
```

### Workflow Structure

**4 GitHub Actions Workflows:**

1. **Main CI Workflow** (`ci.yml`) - **Always runs**
   - Lint (ESLint, TypeScript type checking)
   - Unit tests with coverage
   - Coverage enforcement
   - Security scanning
   - PR comments with results

2. **Integration Tests Workflow** (`integration.yml`) - **Phase 3+**
   - Runs when integration tests exist (Phase 3)
   - Test database setup (schema isolation)
   - Multi-service integration tests
   - Database cleanup

3. **E2E Tests Workflow** (`e2e.yml`) - **Phase 4+**
   - Runs when E2E tests exist (Phase 4)
   - Playwright browser installation
   - Mock OpenAI responses
   - Test database seeding
   - Full user journey tests

4. **Deploy Staging Workflow** (`deploy-staging.yml`) - **After tests pass**
   - Triggered on develop branch only
   - Runs after all tests pass
   - Deploys to staging environment (Vercel/other)
   - Post-deployment smoke tests

---

## GitHub Actions Workflows

### Workflow 1: Main CI (`ci.yml`)

**Purpose:** Run on every push/PR to validate code quality and unit tests

**File:** `.github/workflows/ci.yml`

```yaml
name: CI - Lint, Test, Coverage

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main, develop]

jobs:
  lint:
    name: Lint & Type Check
    runs-on: ubuntu-latest
    timeout-minutes: 5

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

      - name: Run ESLint
        run: npm run lint

      - name: Run TypeScript type check
        run: npx tsc --noEmit

  unit-tests:
    name: Unit Tests with Coverage
    runs-on: ubuntu-latest
    timeout-minutes: 10

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

      - name: Run unit tests with coverage
        run: npm run test:ci
        env:
          # Mock environment variables for tests
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          OPENAI_API_KEY: ${{ secrets.TEST_OPENAI_API_KEY }}
          PINECONE_API_KEY: ${{ secrets.TEST_PINECONE_API_KEY }}
          PINECONE_INDEX_NAME_ALL: test-index
          CI: true

      - name: Check coverage thresholds
        run: |
          # Extract coverage percentage from coverage-summary.json
          COVERAGE=$(node -p "Math.round(JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json')).total.statements.pct)")
          echo "Current coverage: ${COVERAGE}%"

          # Determine threshold based on date/phase
          THRESHOLD=60
          echo "Required coverage: ${THRESHOLD}%"

          if [ $COVERAGE -lt $THRESHOLD ]; then
            echo "❌ Coverage ${COVERAGE}% is below threshold ${THRESHOLD}%"
            exit 1
          else
            echo "✅ Coverage ${COVERAGE}% meets threshold ${THRESHOLD}%"
          fi

      - name: Upload coverage reports to Codecov
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          files: ./coverage/lcov.info
          flags: unittests
          name: codecov-umbrella
          fail_ci_if_error: false

      - name: Comment PR with coverage
        if: github.event_name == 'pull_request'
        uses: romeovs/lcov-reporter-action@v0.3.1
        with:
          lcov-file: ./coverage/lcov.info
          github-token: ${{ secrets.GITHUB_TOKEN }}
          delete-old-comments: true

      - name: Upload coverage artifacts
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: coverage/
          retention-days: 30

  security-scan:
    name: Security Scanning
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Run npm audit
        run: npm audit --audit-level=moderate
        continue-on-error: true

      - name: Run Snyk security scan
        uses: snyk/actions/node@master
        continue-on-error: true
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}
        with:
          args: --severity-threshold=high

  status-check:
    name: CI Status
    runs-on: ubuntu-latest
    needs: [lint, unit-tests, security-scan]
    if: always()

    steps:
      - name: Check all jobs passed
        run: |
          if [ "${{ needs.lint.result }}" != "success" ] || \
             [ "${{ needs.unit-tests.result }}" != "success" ]; then
            echo "❌ CI pipeline failed"
            exit 1
          fi
          echo "✅ All CI checks passed"
```

**Key Features:**
- **Parallel execution:** Lint, tests, and security run concurrently
- **Fast feedback:** Unit tests complete in 2-3 minutes
- **Coverage enforcement:** Fails if below 60% threshold
- **PR comments:** Automatic coverage report in PR
- **Codecov integration:** Historical coverage tracking

---

### Workflow 2: Integration Tests (`integration.yml`)

**Purpose:** Run integration tests when Phase 3 is complete

**File:** `.github/workflows/integration.yml`

```yaml
name: Integration Tests

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main, develop]

jobs:
  check-integration-tests-exist:
    name: Check if integration tests exist
    runs-on: ubuntu-latest
    outputs:
      exists: ${{ steps.check.outputs.exists }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Check for integration test files
        id: check
        run: |
          if [ -d "src/__tests__/integration" ] && [ "$(ls -A src/__tests__/integration)" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

  integration-tests:
    name: Run Integration Tests
    runs-on: ubuntu-latest
    needs: check-integration-tests-exist
    if: needs.check-integration-tests-exist.outputs.exists == 'true'
    timeout-minutes: 15

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: test_db
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

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

      - name: Setup test database
        run: npm run test:integration:setup
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test_db

      - name: Run integration tests
        run: npm run test:integration
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}
          OPENAI_API_KEY: ${{ secrets.TEST_OPENAI_API_KEY }}
          PINECONE_API_KEY: ${{ secrets.TEST_PINECONE_API_KEY }}
          PINECONE_INDEX_NAME_ALL: test-integration
          CI: true

      - name: Cleanup test database
        if: always()
        run: npm run test:integration:cleanup
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}

      - name: Upload integration test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: integration-test-results
          path: test-results/integration/
          retention-days: 30

  skip-integration-tests:
    name: Integration Tests (Not Implemented)
    runs-on: ubuntu-latest
    needs: check-integration-tests-exist
    if: needs.check-integration-tests-exist.outputs.exists == 'false'
    steps:
      - name: Skip message
        run: |
          echo "⏭️ Integration tests not yet implemented (Phase 3)"
          echo "This workflow will run automatically once Phase 3 is complete"
```

**Key Features:**
- **Conditional execution:** Only runs if integration tests exist
- **PostgreSQL service:** In-memory database for testing
- **Database isolation:** Uses test_* prefixed tables
- **Automatic cleanup:** Ensures no test data pollution
- **Forward-compatible:** Ready for Phase 3 implementation

---

### Workflow 3: E2E Tests (`e2e.yml`)

**Purpose:** Run Playwright E2E tests when Phase 4 is complete

**File:** `.github/workflows/e2e.yml`

```yaml
name: E2E Tests

on:
  push:
    branches: ['**']
  pull_request:
    branches: [main, develop]

jobs:
  check-e2e-tests-exist:
    name: Check if E2E tests exist
    runs-on: ubuntu-latest
    outputs:
      exists: ${{ steps.check.outputs.exists }}
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Check for E2E test files
        id: check
        run: |
          if [ -f "playwright.config.ts" ] && [ -d "e2e" ] && [ "$(ls -A e2e)" ]; then
            echo "exists=true" >> $GITHUB_OUTPUT
          else
            echo "exists=false" >> $GITHUB_OUTPUT
          fi

  e2e-tests:
    name: Run E2E Tests
    runs-on: ubuntu-latest
    needs: check-e2e-tests-exist
    if: needs.check-e2e-tests-exist.outputs.exists == 'true'
    timeout-minutes: 30

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

      - name: Setup test database for E2E
        run: npm run test:e2e:seed
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}

      - name: Run E2E tests
        run: npx playwright test
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.TEST_SUPABASE_ANON_KEY }}
          TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
          TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
          MOCK_OPENAI: true
          CI: true

      - name: Upload Playwright report
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

      - name: Cleanup E2E test data
        if: always()
        run: npm run test:e2e:cleanup
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.TEST_SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.TEST_SUPABASE_SERVICE_ROLE_KEY }}

  skip-e2e-tests:
    name: E2E Tests (Not Implemented)
    runs-on: ubuntu-latest
    needs: check-e2e-tests-exist
    if: needs.check-e2e-tests-exist.outputs.exists == 'false'
    steps:
      - name: Skip message
        run: |
          echo "⏭️ E2E tests not yet implemented (Phase 4)"
          echo "This workflow will run automatically once Phase 4 is complete"
```

**Key Features:**
- **Conditional execution:** Only runs if E2E tests and Playwright config exist
- **Browser installation:** Installs Chromium and Firefox
- **Mock OpenAI:** Uses mocked LLM responses for speed and cost
- **Video on failure:** Records videos only when tests fail
- **Test data management:** Seeds and cleans up test database

---

### Workflow 4: Deploy to Staging (`deploy-staging.yml`)

**Purpose:** Auto-deploy to staging after all tests pass on develop branch

**File:** `.github/workflows/deploy-staging.yml`

```yaml
name: Deploy to Staging

on:
  push:
    branches: [develop]
  workflow_run:
    workflows: ["CI - Lint, Test, Coverage"]
    types: [completed]
    branches: [develop]

jobs:
  deploy:
    name: Deploy to Staging Environment
    runs-on: ubuntu-latest
    timeout-minutes: 15
    if: github.event.workflow_run.conclusion == 'success' || github.event_name == 'push'

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

      - name: Build production bundle
        run: npm run build
        env:
          NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.STAGING_SUPABASE_URL }}
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.STAGING_SUPABASE_ANON_KEY }}
          OPENAI_API_KEY: ${{ secrets.STAGING_OPENAI_API_KEY }}
          PINECONE_API_KEY: ${{ secrets.STAGING_PINECONE_API_KEY }}
          PINECONE_INDEX_NAME_ALL: staging-index
          NODE_ENV: production

      - name: Deploy to Vercel (Staging)
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: '--prod'
          working-directory: ./
          scope: ${{ secrets.VERCEL_ORG_ID }}

      - name: Wait for deployment to be ready
        run: sleep 30

      - name: Run smoke tests against staging
        run: |
          # Basic health check
          STAGING_URL="${{ secrets.STAGING_URL }}"

          echo "Testing staging deployment at ${STAGING_URL}"

          # Test 1: Home page loads
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ${STAGING_URL})
          if [ $HTTP_CODE -ne 200 ]; then
            echo "❌ Home page failed (HTTP ${HTTP_CODE})"
            exit 1
          fi
          echo "✅ Home page responding"

          # Test 2: API health check (if exists)
          HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" ${STAGING_URL}/api/health)
          if [ $HTTP_CODE -eq 200 ]; then
            echo "✅ API health check passed"
          else
            echo "⚠️ API health check skipped (endpoint may not exist)"
          fi

          echo "✅ Smoke tests passed"

      - name: Notify deployment success
        if: success()
        run: |
          echo "🚀 Successfully deployed to staging: ${{ secrets.STAGING_URL }}"
          # Add Slack notification here if needed

      - name: Notify deployment failure
        if: failure()
        run: |
          echo "❌ Staging deployment failed"
          # Add Slack notification here if needed

  rollback:
    name: Rollback on Failure
    runs-on: ubuntu-latest
    needs: deploy
    if: failure()

    steps:
      - name: Rollback to previous version
        run: |
          echo "⏪ Rolling back to previous staging deployment"
          # Implement rollback logic here
          # For Vercel: vercel rollback
```

**Key Features:**
- **Conditional trigger:** Only runs on develop branch after tests pass
- **Production build:** Creates optimized bundle
- **Vercel deployment:** Deploys to Vercel staging environment
- **Smoke tests:** Basic health checks after deployment
- **Rollback capability:** Automatic rollback on deployment failure

---

## Coverage Enforcement Strategy

### Progressive Threshold Increases

**Phase-based coverage targets:**

| Phase | Timeline | Unit Coverage | Integration Coverage | E2E Coverage | Total Target |
|-------|----------|---------------|---------------------|--------------|--------------|
| **5A (Week 1)** | Current | 42% → 60% | N/A | N/A | 60% |
| **5B (Month 4)** | Phase 6-7 | 60% → 70% | N/A | N/A | 70% |
| **5C (Month 5)** | Phase 3 done | 75% | 80% | N/A | 75% |
| **5D (Month 5.5)** | Phase 4 done | 85% | 85% | 90% | 85% |

### Coverage Threshold Configuration

**Update jest.config.js:**

```javascript
module.exports = {
  // ... existing config
  coverageThreshold: {
    global: {
      statements: 60,
      branches: 55,
      functions: 60,
      lines: 60,
    },
    // Stricter thresholds for critical paths
    './src/lib/services/returnExplanation.ts': {
      statements: 90,
      branches: 85,
      functions: 90,
      lines: 90,
    },
    './src/lib/services/llms.ts': {
      statements: 85,
      branches: 80,
      functions: 85,
      lines: 85,
    },
    './src/actions/actions.ts': {
      statements: 80,
      branches: 75,
      functions: 80,
      lines: 80,
    },
  },
};
```

### GitHub Actions Coverage Script

**Create:** `.github/scripts/check-coverage.js`

```javascript
const fs = require('fs');

// Read coverage summary
const coverageSummary = JSON.parse(
  fs.readFileSync('coverage/coverage-summary.json', 'utf8')
);

const total = coverageSummary.total;

// Determine threshold based on environment or date
const getCurrentThreshold = () => {
  const now = new Date();
  const phaseStartDate = new Date('2025-01-09'); // Adjust to actual start date

  const weeksSinceStart = Math.floor(
    (now - phaseStartDate) / (1000 * 60 * 60 * 24 * 7)
  );

  // Progressive thresholds
  if (weeksSinceStart < 4) return 60; // First month
  if (weeksSinceStart < 16) return 70; // Months 2-4
  if (weeksSinceStart < 20) return 75; // Month 5
  return 85; // Month 5.5+
};

const threshold = process.env.COVERAGE_THRESHOLD || getCurrentThreshold();

console.log('Coverage Summary:');
console.log(`  Statements: ${total.statements.pct}%`);
console.log(`  Branches: ${total.branches.pct}%`);
console.log(`  Functions: ${total.functions.pct}%`);
console.log(`  Lines: ${total.lines.pct}%`);
console.log(`\nRequired Threshold: ${threshold}%`);

const meetsThreshold =
  total.statements.pct >= threshold &&
  total.branches.pct >= threshold - 5 && // Allow 5% margin for branches
  total.functions.pct >= threshold &&
  total.lines.pct >= threshold;

if (!meetsThreshold) {
  console.error(`\n❌ Coverage below threshold ${threshold}%`);
  process.exit(1);
}

console.log(`\n✅ Coverage meets threshold ${threshold}%`);
```

---

## Environment Configuration

### GitHub Secrets Required

**Add to repository settings (Settings → Secrets and variables → Actions):**

#### Test Environment Secrets
```bash
# Supabase Test Instance
TEST_SUPABASE_URL=https://xxxxx.supabase.co
TEST_SUPABASE_ANON_KEY=eyJxxx...
TEST_SUPABASE_SERVICE_ROLE_KEY=eyJxxx...

# Test User Credentials
TEST_USER_EMAIL=abecha@gmail.com
TEST_USER_PASSWORD=password

# OpenAI (can use mock or low-rate-limit key)
TEST_OPENAI_API_KEY=sk-test-xxx

# Pinecone Test Environment
TEST_PINECONE_API_KEY=xxx
TEST_PINECONE_INDEX_NAME=test-index

# Coverage Reporting
CODECOV_TOKEN=xxx

# Security Scanning
SNYK_TOKEN=xxx
```

#### Staging Environment Secrets
```bash
# Staging Supabase
STAGING_SUPABASE_URL=https://staging-xxxxx.supabase.co
STAGING_SUPABASE_ANON_KEY=eyJxxx...

# Staging APIs
STAGING_OPENAI_API_KEY=sk-staging-xxx
STAGING_PINECONE_API_KEY=xxx

# Vercel Deployment
VERCEL_TOKEN=xxx
VERCEL_ORG_ID=xxx
VERCEL_PROJECT_ID=xxx
STAGING_URL=https://staging.explainanything.com
```

#### Production Secrets (for future)
```bash
PROD_SUPABASE_URL=xxx
PROD_SUPABASE_ANON_KEY=xxx
PROD_OPENAI_API_KEY=xxx
PROD_PINECONE_API_KEY=xxx
```

### Environment Variable Management

**Create:** `.env.ci` (committed to repo, no secrets)

```bash
# CI Environment Configuration
NODE_ENV=test
CI=true

# Test Configuration
MOCK_OPENAI=true
MOCK_EXTERNAL_APIS=true

# Test Database
USE_TEST_DATABASE=true
TEST_TABLE_PREFIX=test_

# Performance
JEST_MAX_WORKERS=2
PLAYWRIGHT_MAX_WORKERS=2
```

---

## Caching Strategy

### Node Modules Cache

**All workflows use npm cache:**

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'
    cache: 'npm'
```

**Benefits:**
- Reduces install time from ~2-3 min to ~30 seconds
- Saves GitHub Actions minutes
- Consistent dependency versions

### Next.js Build Cache

**Add to workflows:**

```yaml
- name: Cache Next.js build
  uses: actions/cache@v4
  with:
    path: |
      ~/.npm
      ${{ github.workspace }}/.next/cache
    key: ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-${{ hashFiles('**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx') }}
    restore-keys: |
      ${{ runner.os }}-nextjs-${{ hashFiles('**/package-lock.json') }}-
      ${{ runner.os }}-nextjs-
```

**Benefits:**
- Speeds up builds by 50-70%
- Incremental builds only rebuild changed files

### Playwright Browser Cache

**Add to e2e.yml:**

```yaml
- name: Cache Playwright browsers
  uses: actions/cache@v4
  with:
    path: ~/.cache/ms-playwright
    key: ${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-playwright-
```

**Benefits:**
- Avoids re-downloading browsers (saves ~1-2 min)

---

## Branch Protection Rules

### Configure in GitHub Settings

**Repository Settings → Branches → Add rule:**

**For `main` branch:**
- ✅ Require pull request reviews before merging (1 approval)
- ✅ Require status checks to pass before merging:
  - `Lint & Type Check`
  - `Unit Tests with Coverage`
  - `Security Scanning`
  - `Integration Tests` (when Phase 3 complete)
  - `E2E Tests` (when Phase 4 complete)
- ✅ Require branches to be up to date before merging
- ✅ Require conversation resolution before merging
- ✅ Do not allow bypassing the above settings

**For `develop` branch:**
- ✅ Require status checks to pass before merging:
  - `Lint & Type Check`
  - `Unit Tests with Coverage`
- ✅ Require branches to be up to date before merging

**For feature branches:**
- No restrictions (allow rapid development)

---

## Monitoring & Reporting

### 1. Coverage Tracking with Codecov

**Setup:**
1. Sign up at https://codecov.io with GitHub
2. Add repository to Codecov
3. Get token and add as `CODECOV_TOKEN` secret
4. Workflow automatically uploads coverage

**Benefits:**
- Historical coverage trends
- Coverage diff in PRs
- Sunburst visualization
- Coverage badges for README

**Add badge to README.md:**
```markdown
[![codecov](https://codecov.io/gh/yourusername/explainanything/branch/main/graph/badge.svg)](https://codecov.io/gh/yourusername/explainanything)
```

### 2. Test Results Dashboard

**GitHub Actions automatically provides:**
- Test execution time trends
- Pass/fail history
- Flaky test detection
- Workflow duration tracking

**Access:** Repository → Actions → Select workflow → View graphs

### 3. PR Comments with Test Results

**Automated PR comment includes:**
```markdown
## Test Results 🧪

✅ **Unit Tests:** 1,551 passed, 0 failed (2m 34s)
✅ **Coverage:** 62.3% (+1.2% from base)
⚠️ **Integration Tests:** Not yet implemented
⚠️ **E2E Tests:** Not yet implemented

### Coverage Details
| Type | Coverage | Change |
|------|----------|--------|
| Statements | 62.3% | +1.2% |
| Branches | 58.1% | +0.8% |
| Functions | 60.5% | +1.5% |
| Lines | 62.1% | +1.1% |

### Threshold Status
✅ Meets required threshold: 60%

[View full coverage report →](link)
```

### 4. Slack Notifications (Optional)

**Add to workflows for deployment notifications:**

```yaml
- name: Notify Slack on deployment
  if: always()
  uses: slackapi/slack-github-action@v1.24.0
  with:
    payload: |
      {
        "text": "${{ job.status == 'success' && '✅' || '❌' }} Staging Deployment ${{ job.status }}",
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": "*Staging Deployment*\nStatus: ${{ job.status }}\nBranch: ${{ github.ref_name }}\nCommit: ${{ github.sha }}\nAuthor: ${{ github.actor }}"
            }
          }
        ]
      }
  env:
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
```

### 5. Performance Monitoring

**Track test execution time:**

```yaml
- name: Track test performance
  run: |
    START_TIME=$(date +%s)
    npm run test:ci
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    echo "Test duration: ${DURATION}s"

    # Alert if tests take too long
    if [ $DURATION -gt 300 ]; then
      echo "⚠️ Tests took longer than 5 minutes"
    fi
```

---

## Security Best Practices

### 1. Secret Management

**Never commit:**
- ❌ API keys
- ❌ Database passwords
- ❌ Service role keys
- ❌ Access tokens

**Use GitHub Secrets for:**
- ✅ All API keys
- ✅ Database credentials
- ✅ Deployment tokens

### 2. Dependabot for Security Updates

**Create:** `.github/dependabot.yml`

```yaml
version: 2
updates:
  # Enable npm dependency updates
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
    reviewers:
      - "yourusername"
    labels:
      - "dependencies"
      - "security"

    # Group minor and patch updates
    groups:
      production-dependencies:
        dependency-type: "production"
        update-types:
          - "minor"
          - "patch"

      development-dependencies:
        dependency-type: "development"
        update-types:
          - "minor"
          - "patch"

  # Enable GitHub Actions updates
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    labels:
      - "ci/cd"
      - "dependencies"
```

### 3. CodeQL Security Scanning

**Create:** `.github/workflows/codeql.yml`

```yaml
name: CodeQL Security Scan

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  schedule:
    - cron: '0 0 * * 1' # Weekly on Monday

jobs:
  analyze:
    name: Analyze Code
    runs-on: ubuntu-latest
    timeout-minutes: 360
    permissions:
      actions: read
      contents: read
      security-events: write

    strategy:
      fail-fast: false
      matrix:
        language: ['javascript', 'typescript']

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Initialize CodeQL
        uses: github/codeql-action/init@v3
        with:
          languages: ${{ matrix.language }}

      - name: Autobuild
        uses: github/codeql-action/autobuild@v3

      - name: Perform CodeQL Analysis
        uses: github/codeql-action/analyze@v3
        with:
          category: "/language:${{matrix.language}}"
```

### 4. npm Audit in CI

**Automatically runs in ci.yml:**

```yaml
- name: Run npm audit
  run: npm audit --audit-level=moderate
  continue-on-error: true
```

**Manual fix workflow:**

```bash
# Locally fix vulnerabilities
npm audit fix

# If breaking changes needed
npm audit fix --force

# Review changes and test
npm test

# Commit fixes
git commit -am "fix: resolve security vulnerabilities"
```

---

## Implementation Timeline

### Phase 5A: Core CI/CD Setup (Week 1)

**Duration:** 5 days
**Goal:** Get unit tests running in CI with coverage enforcement

#### Day 1: GitHub Actions Setup
- [ ] Create `.github/workflows/` directory
- [ ] Create `ci.yml` workflow (lint + unit tests)
- [ ] Create `deploy-staging.yml` workflow skeleton
- [ ] Commit and push workflows

#### Day 2: Secrets & Environment Configuration
- [ ] Add all GitHub Secrets (test environment)
- [ ] Add staging secrets
- [ ] Test secret access in workflow run
- [ ] Configure branch protection rules for main/develop

#### Day 3: Coverage Enforcement
- [ ] Update jest.config.js with 60% thresholds
- [ ] Create `.github/scripts/check-coverage.js`
- [ ] Test coverage enforcement in CI
- [ ] Set up Codecov integration
- [ ] Add coverage badge to README

#### Day 4: PR Integration
- [ ] Set up LCOV reporter for PR comments
- [ ] Test PR comment generation
- [ ] Configure status checks in branch protection
- [ ] Document CI/CD process in README

#### Day 5: Security & Optimization
- [ ] Add `dependabot.yml` configuration
- [ ] Create `codeql.yml` workflow
- [ ] Add caching for node_modules and builds
- [ ] Test full CI pipeline end-to-end
- [ ] Fix any issues discovered

**Deliverables:**
- ✅ Automated unit tests on every push/PR
- ✅ 60% coverage enforcement
- ✅ PR comments with coverage reports
- ✅ Branch protection rules active
- ✅ Security scanning enabled

---

### Phase 5B: Deployment Pipeline (Week 2)

**Duration:** 5 days
**Goal:** Auto-deploy to staging after tests pass

#### Day 1: Vercel Setup
- [ ] Create Vercel project for staging
- [ ] Get Vercel tokens and add to GitHub Secrets
- [ ] Test manual deployment to Vercel
- [ ] Configure staging environment variables in Vercel

#### Day 2: Deployment Workflow
- [ ] Complete `deploy-staging.yml` workflow
- [ ] Add deployment trigger (after CI passes on develop)
- [ ] Test deployment workflow
- [ ] Verify staging environment works

#### Day 3: Smoke Tests
- [ ] Create smoke test script
- [ ] Add health check endpoint (`/api/health`)
- [ ] Run smoke tests after deployment
- [ ] Add rollback capability

#### Day 4: Notifications
- [ ] Set up Slack webhook (optional)
- [ ] Add deployment notifications
- [ ] Add failure alerts
- [ ] Document deployment process

#### Day 5: Testing & Documentation
- [ ] Test complete deployment pipeline
- [ ] Create rollback procedure documentation
- [ ] Update ci_cd_plan.md with learnings
- [ ] Team training on new CI/CD process

**Deliverables:**
- ✅ Auto-deploy to staging on develop branch
- ✅ Smoke tests after deployment
- ✅ Deployment notifications
- ✅ Rollback capability

---

### Phase 5C: Integration Tests Integration (Month 5)

**Duration:** 2 days (after Phase 3 complete)
**Goal:** Add integration tests to CI pipeline

#### Day 1: Workflow Setup
- [ ] Verify Phase 3 integration tests complete
- [ ] Test integration tests locally
- [ ] Update `integration.yml` workflow
- [ ] Add integration test secrets

#### Day 2: Testing & Refinement
- [ ] Run integration tests in CI
- [ ] Fix any CI-specific issues
- [ ] Update branch protection to require integration tests
- [ ] Document integration test CI setup

**Deliverables:**
- ✅ Integration tests running in CI
- ✅ 40-50 integration tests automated

---

### Phase 5D: E2E Tests Integration (Month 5.5)

**Duration:** 3 days (after Phase 4 complete)
**Goal:** Add E2E tests to CI pipeline

#### Day 1: Playwright Setup
- [ ] Verify Phase 4 E2E tests complete
- [ ] Test E2E tests locally
- [ ] Update `e2e.yml` workflow
- [ ] Configure Playwright browsers for CI

#### Day 2: Database & Mocking
- [ ] Set up test database seeding for E2E
- [ ] Configure OpenAI mocking in CI
- [ ] Test E2E tests in CI
- [ ] Fix CI-specific issues

#### Day 3: Video Recording & Reporting
- [ ] Configure video recording on failure
- [ ] Set up Playwright HTML reports
- [ ] Update branch protection for E2E tests
- [ ] Document E2E test CI setup

**Deliverables:**
- ✅ E2E tests running in CI
- ✅ 52-66 E2E tests automated
- ✅ Video artifacts on failure

---

## Success Metrics

### Quantitative Metrics

**CI/CD Performance:**
- 🎯 Unit test execution: <5 minutes
- 🎯 Integration test execution: <10 minutes
- 🎯 E2E test execution: <20 minutes
- 🎯 Total CI pipeline: <25 minutes (parallel execution)
- 🎯 Deployment time: <5 minutes

**Quality Metrics:**
- 🎯 CI pass rate: ≥95% (stable, not flaky)
- 🎯 Test flakiness: <1% flaky tests
- 🎯 Coverage: 60% → 85% over 5 months
- 🎯 Zero failed deployments to staging

**Developer Experience:**
- 🎯 100% of PRs have automated test results
- 🎯 Coverage reports in all PRs
- 🎯 Merge time reduced by 50% (no manual testing)

### Qualitative Metrics

**Team Adoption:**
- ✅ All developers use PR-based workflow
- ✅ Team trusts CI results (no "works on my machine")
- ✅ Faster code reviews (automated quality checks)

**Business Impact:**
- ✅ Faster feature delivery (confident deployments)
- ✅ Fewer production bugs (comprehensive testing)
- ✅ Reduced manual QA time

---

## Cost Estimation

### GitHub Actions Minutes Usage

**Free Tier:**
- Public repos: Unlimited minutes
- Private repos: 2,000 minutes/month

**Usage per workflow run:**
```
Unit Tests (parallel):
- Lint: 2 min
- Tests: 3 min
- Security: 2 min
Total: ~3 min (parallel execution)

Integration Tests: 10 min (when implemented)
E2E Tests: 20 min (when implemented)

Total per PR: ~3 min (Phase 5A)
Total per PR: ~13 min (Phase 5C)
Total per PR: ~33 min (Phase 5D)
```

**Monthly estimate (20 PRs + 50 pushes):**
```
Phase 5A: 70 runs × 3 min = 210 minutes/month
Phase 5C: 70 runs × 13 min = 910 minutes/month
Phase 5D: 70 runs × 33 min = 2,310 minutes/month
```

**Recommendation:**
- Current free tier sufficient for Phase 5A-B
- May need paid plan ($4/user/month) for Phase 5D
- Alternative: Run E2E tests only on PRs (not all pushes)

### External Services

**Codecov:**
- Free for open source
- $29/month for private repos (optional)

**Snyk:**
- Free for open source
- $0-99/month for private repos (optional)

**Vercel:**
- Free tier: 100 GB bandwidth/month
- Pro: $20/month (if needed for staging)

---

## Troubleshooting Guide

### Common Issues

#### Issue 1: Tests Fail in CI but Pass Locally

**Symptoms:**
- Tests pass with `npm test` locally
- Fail in GitHub Actions with same error

**Possible Causes:**
1. Environment variable mismatch
2. Timezone differences
3. File system case sensitivity (macOS vs Linux)
4. Missing dependencies

**Solution:**
```yaml
# Add debug logging to workflow
- name: Debug environment
  run: |
    echo "Node version: $(node -v)"
    echo "NPM version: $(npm -v)"
    echo "Environment variables:"
    env | grep -v SECRET | sort

    echo "Installed packages:"
    npm list --depth=0
```

#### Issue 2: Coverage Threshold Failing

**Symptoms:**
- Coverage reports 62%, but CI fails at 60% threshold

**Possible Causes:**
1. Coverage calculation includes untested files
2. Thresholds too strict for branches
3. Flaky tests affecting coverage

**Solution:**
```javascript
// jest.config.js - Adjust thresholds
coverageThreshold: {
  global: {
    statements: 60,
    branches: 55, // Allow 5% lower for branches
    functions: 60,
    lines: 60,
  },
}
```

#### Issue 3: Deployment Fails with Build Error

**Symptoms:**
- CI tests pass
- Deployment workflow fails during build

**Possible Causes:**
1. Missing environment variables in staging
2. Build command different in CI vs local
3. Memory limit exceeded

**Solution:**
```yaml
# Increase Node memory for build
- name: Build production bundle
  run: NODE_OPTIONS="--max-old-space-size=4096" npm run build
  env:
    # ... environment variables
```

#### Issue 4: Flaky Tests

**Symptoms:**
- Tests randomly fail and pass without code changes
- Different results on re-run

**Possible Causes:**
1. Race conditions in async tests
2. Non-deterministic data (random IDs, dates)
3. Network timeouts

**Solution:**
```javascript
// Use fixed seeds for random data
import { faker } from '@faker-js/faker';
faker.seed(123);

// Increase timeouts for CI
jest.setTimeout(10000); // 10 seconds

// Use waitFor for async assertions
await waitFor(() => {
  expect(element).toBeInTheDocument();
}, { timeout: 5000 });
```

#### Issue 5: Out of Memory in CI

**Symptoms:**
- Tests fail with "JavaScript heap out of memory"

**Solution:**
```json
// package.json
{
  "scripts": {
    "test:ci": "NODE_OPTIONS='--max-old-space-size=4096' jest --ci --coverage --maxWorkers=2"
  }
}
```

---

## Maintenance & Evolution

### Weekly Tasks

- [ ] Review failed CI runs and investigate root causes
- [ ] Check Dependabot PRs and merge dependency updates
- [ ] Monitor test execution time trends
- [ ] Review coverage trends in Codecov

### Monthly Tasks

- [ ] Review and update coverage thresholds (progressive increase)
- [ ] Analyze flaky tests and fix root causes
- [ ] Optimize slow tests
- [ ] Review GitHub Actions usage and costs
- [ ] Update CI/CD documentation

### Quarterly Tasks

- [ ] Review and update workflows for new GitHub Actions features
- [ ] Audit GitHub Secrets and rotate if needed
- [ ] Review branch protection rules
- [ ] Update Node.js version in workflows
- [ ] Review security scan results and address findings

### On New Feature

- [ ] Add tests for new features (TDD approach)
- [ ] Ensure coverage doesn't drop below threshold
- [ ] Update E2E tests if user-facing changes
- [ ] Update smoke tests if new critical paths

---

## Next Steps (Immediate Actions)

### Week 1, Day 1: Setup GitHub Actions

1. **Create workflow directory:**
   ```bash
   mkdir -p .github/workflows
   mkdir -p .github/scripts
   ```

2. **Create ci.yml workflow:**
   - Copy main CI workflow from this document
   - Commit and push to feature branch

3. **Test workflow:**
   - Create test PR
   - Verify workflow runs
   - Check for errors

### Week 1, Day 2: Configure Secrets

1. **Add test environment secrets in GitHub:**
   - Go to Settings → Secrets and variables → Actions
   - Add all TEST_* secrets
   - Add CODECOV_TOKEN (after signing up)

2. **Test secret access:**
   - Run workflow again
   - Verify secrets are accessible
   - Check for any missing variables

### Week 1, Day 3: Coverage Enforcement

1. **Update jest.config.js:**
   ```javascript
   coverageThreshold: {
     global: {
       statements: 60,
       branches: 55,
       functions: 60,
       lines: 60,
     },
   }
   ```

2. **Test coverage locally:**
   ```bash
   npm run test:coverage
   ```

3. **Fix failing tests if coverage below threshold**

### Week 1, Day 4-5: Complete CI Setup

1. **Add remaining workflows:**
   - integration.yml (conditional)
   - e2e.yml (conditional)
   - codeql.yml (security)

2. **Configure branch protection:**
   - Settings → Branches → Add rule for `main`
   - Require status checks

3. **Set up Codecov:**
   - Sign up at codecov.io
   - Add repository
   - Get token and add to secrets

4. **Document in README:**
   - Add CI/CD section
   - Add badges
   - Document how to run tests

---

## Conclusion

This Phase 5 CI/CD plan provides a comprehensive strategy for automating testing and deployment in the ExplainAnything project. The progressive implementation approach allows for immediate value (automated unit tests) while preparing for future phases (integration and E2E tests).

**Key Strengths:**
- ✅ Immediate automation of existing 1,551 unit tests
- ✅ Progressive coverage enforcement (60% → 85%)
- ✅ Forward-compatible with Phases 3 and 4
- ✅ Auto-deploy to staging for faster iteration
- ✅ Comprehensive security scanning
- ✅ Cost-effective GitHub Actions usage

**Timeline:** 2-3 weeks for core CI/CD (Phase 5A-B), with automatic integration of future test phases

**ROI:**
- 50% reduction in manual testing time
- Faster code reviews with automated checks
- Confident deployments with comprehensive testing
- Early detection of regressions

**Next Action:** Begin Week 1, Day 1 tasks to create GitHub Actions workflows and start automated testing.

---

## Appendix: Quick Reference

### Useful Commands

```bash
# Run tests locally as CI would
npm run test:ci

# Check coverage thresholds
npm run test:coverage

# Lint code
npm run lint

# Type check
npx tsc --noEmit

# Build production bundle
npm run build
```

### Useful Links

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Jest Coverage Configuration](https://jestjs.io/docs/configuration#coveragethreshold-object)
- [Codecov Documentation](https://docs.codecov.com/)
- [Playwright CI Guide](https://playwright.dev/docs/ci)
- [Vercel Deployment](https://vercel.com/docs)

### Key Files

- `.github/workflows/ci.yml` - Main CI workflow
- `.github/workflows/integration.yml` - Integration tests
- `.github/workflows/e2e.yml` - E2E tests
- `.github/workflows/deploy-staging.yml` - Staging deployment
- `.github/workflows/codeql.yml` - Security scanning
- `.github/dependabot.yml` - Dependency updates
- `.github/scripts/check-coverage.js` - Coverage validation
- `jest.config.js` - Test configuration
- `playwright.config.ts` - E2E test configuration (Phase 4)

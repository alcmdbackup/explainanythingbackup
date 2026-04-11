# Testing Setup

## Overview

ExplainAnything uses a **four-tier testing strategy**:

| Tier | Tool | Environment | Purpose |
|------|------|-------------|---------|
| **Unit** | Jest + jsdom | Browser simulation | Component/service tests with mocked dependencies |
| **ESM** | Node test runner + tsx | Node ESM | Tests for ESM-only packages (unified, remark-parse) |
| **Integration** | Jest + node | Real Supabase | Service + database tests with mocked external APIs |
| **E2E** | Playwright | Real browser | Full user flows against running app |
| **Exploratory** | Playwright MCP | Real browser | AI-driven discovery of UX issues and bugs |

### Test Statistics
- **Unit**: ~290 colocated `.test.ts` files (src + evolution + scripts), including 49 evolution-specific (1082 test cases)
- **ESM**: 1 file for AST diffing (bypasses Jest ESM limitations)
- **Integration**: 27 test files in `src/__tests__/integration/`
  - **Critical** (run on PRs to main): 5 tests
  - **Full** (run on PRs to production): All 27 tests
  - **Evolution** (11 files): Auto-skip when evolution DB tables not yet migrated. Covers claim, budget, costs, completion, watchdog, strategy hashing/aggregates, cancel experiment, arena sync, entity logging, experiment lifecycle.
- **E2E**: 48 spec files in `__tests__/e2e/specs/`
  - **Critical** (`{ tag: '@critical' }` parameter): Run on PRs to main. Evolution Phase 1-2 E2E specs are tagged `@critical`.
  - **Evolution** (`{ tag: '@evolution' }` parameter): Dashboard, runs, strategies, arena, experiments, invocations, run pipeline, experiment wizard, accessibility
  - **Full**: All tests (run on PRs to production)
- **Exploratory**: `/user-test` skill for AI-driven exploration (see [User Testing](./user_testing.md))

---

## Commands

```bash
# Unit tests
npm test                      # Run all unit tests
npm run test:watch            # Watch mode
npm run test:coverage         # With coverage report
npm run test:ci               # CI mode with coverage + 2 workers

# ESM tests (for unified/remark packages)
npm run test:esm              # Node native test runner via tsx

# Integration tests
npm run test:integration      # Real database, mocked external APIs
npm run test:integration:watch

# E2E tests
npm run test:e2e              # All Playwright tests
npm run test:e2e:ui           # Interactive UI mode
npm run test:e2e:headed       # Visible browser
npm run test:e2e:chromium     # Chromium only

# Run all
npm run test:all              # Unit + Integration

# Exploratory testing (Claude Code skill)
/user-test                    # Autonomous exploration
/user-test --mode=goal --goal="save an explanation"
/user-test --mode=persona --persona=confused-user
/user-test --dry-run          # Report only, no GitHub issues
```

---

## Configuration Files

| File | Purpose |
|------|---------|
| `jest.config.js` | Unit tests: jsdom environment, module mocks, `clearMocks` + `restoreMocks` |
| `jest.integration.config.js` | Integration: node environment, real Supabase, `clearMocks` + `restoreMocks` |
| `jest.setup.js` | Unit test mocks, polyfills, Testing Library matchers |
| `jest.integration-setup.js` | Integration setup: service role client, stable mocks |
| `jest.shims.js` | OpenAI Node shims (runs before module imports) |
| `playwright.config.ts` | E2E: projects, timeouts, web server, reporters |
| `tsconfig.ci.json` | TypeScript check: incremental builds, shared by local + CI via `npm run typecheck` |

---

## Directory Structure

```
src/testing/
├── README.md                           # Testing directory guide
├── fixtures/
│   ├── database-records.ts            # Test data factories
│   ├── llm-responses.ts               # OpenAI mock responses
│   └── vector-responses.ts            # Pinecone mock responses
├── mocks/
│   ├── openai.ts                      # OpenAI API mock
│   ├── openai-helpers-zod.ts          # OpenAI zod helpers mock
│   ├── @anthropic-ai/sdk.ts           # Anthropic API mock
│   ├── langchain-text-splitter.ts     # LangChain mock
│   ├── @pinecone-database/pinecone.ts # Pinecone API mock
│   ├── @supabase/supabase-js.ts       # Supabase API mock
│   ├── openskill.ts                   # Openskill (Elo rating) mock
│   ├── d3.ts                          # D3 visualization mock
│   └── d3-dag.ts                      # D3-dag layout mock
└── utils/
    ├── test-helpers.ts                # Data builders & utilities
    ├── component-test-helpers.ts      # Component props factories
    ├── editor-test-helpers.ts         # AST factories, AI pipeline fixtures
    ├── integration-helpers.ts         # DB setup/teardown
    ├── logging-test-helpers.ts        # Logging test utilities
    ├── page-test-helpers.ts           # Next.js page testing, router mocks
    └── phase9-test-helpers.ts         # Auth/middleware testing utilities

evolution/src/testing/
├── evolution-test-helpers.ts          # Evolution pipeline test factories & mocks. See [Evolution Reference — Testing](../../evolution/docs/evolution/reference.md#testing).
├── service-test-mocks.ts             # Shared Supabase chain mocks, TEST_UUIDS, setupServiceActionTest(), table-aware builders
└── v2MockLlm.ts                      # Mock EvolutionLLMClient for V2 pipeline tests

src/__tests__/
├── integration/                       # 27 integration test files (11 evolution-specific)
│   ├── auth-flow.integration.test.ts
│   ├── content-report.integration.test.ts
│   ├── error-handling.integration.test.ts
│   ├── evolution-actions.integration.test.ts
│   ├── evolution-cost-attribution.integration.test.ts
│   ├── evolution-cost-estimation.integration.test.ts
│   ├── evolution-infrastructure.integration.test.ts
│   ├── evolution-outline.integration.test.ts
│   ├── evolution-pipeline.integration.test.ts
│   ├── evolution-tree-search.integration.test.ts
│   ├── evolution-visualization.integration.test.ts
│   ├── explanation-generation.integration.test.ts
│   ├── explanation-update.integration.test.ts
│   ├── hall-of-fame-actions.integration.test.ts
│   ├── import-articles.integration.test.ts
│   ├── logging-infrastructure.integration.test.ts
│   ├── metrics-aggregation.integration.test.ts
│   ├── request-id-propagation.integration.test.ts
│   ├── rls-policies.integration.test.ts
│   ├── session-id-propagation.integration.test.ts
│   ├── source-management.integration.test.ts
│   ├── strategy-resolution.integration.test.ts
│   ├── streaming-api.integration.test.ts
│   ├── tag-management.integration.test.ts
│   ├── vector-matching.integration.test.ts
│   └── vercel-bypass.integration.test.ts
└── e2e/
    ├── fixtures/
    │   ├── auth.ts                    # Supabase auth fixture
    │   ├── base.ts                    # Base test fixture with route cleanup
    │   └── admin-auth.ts             # Admin auth fixture
    ├── helpers/
    │   ├── api-mocks.ts               # SSE streaming mocks
    │   ├── error-utils.ts             # Safe error handling utilities
    │   ├── suggestions-test-helpers.ts # AI suggestions test utilities
    │   ├── test-data-factory.ts       # E2E test content creation & cleanup
    │   ├── wait-utils.ts              # Custom wait strategies
    │   └── pages/                     # Page Object Models
    │       ├── BasePage.ts
    │       ├── LoginPage.ts
    │       ├── SearchPage.ts
    │       ├── ResultsPage.ts
    │       ├── ImportPage.ts
    │       ├── UserLibraryPage.ts
    │       └── admin/
    │           ├── AdminBasePage.ts
    │           ├── AdminCandidatesPage.ts
    │           ├── AdminContentPage.ts
    │           ├── AdminReportsPage.ts
    │           ├── AdminUsersPage.ts
    │           └── AdminWhitelistPage.ts
    ├── setup/
    │   ├── global-setup.ts            # Global setup (e.g., Vercel bypass)
    │   ├── global-teardown.ts         # E2E cleanup: Pinecone vectors, tracked IDs
    │   └── vercel-bypass.ts           # Vercel deployment protection bypass
    └── specs/                         # 36 spec files organized by feature
        ├── 01-auth/
        │   └── auth.spec.ts
        ├── 01-home/
        │   └── home-tabs.spec.ts
        ├── 02-search-generate/
        │   ├── search-generate.spec.ts
        │   └── regenerate.spec.ts
        ├── 03-library/
        │   └── library.spec.ts
        ├── 04-content-viewing/
        │   ├── viewing.spec.ts
        │   ├── tags.spec.ts
        │   ├── action-buttons.spec.ts
        │   ├── hidden-content.spec.ts
        │   └── report-content.spec.ts
        ├── 05-edge-cases/
        │   ├── errors.spec.ts
        │   └── global-error.spec.ts
        ├── 06-ai-suggestions/
        │   ├── suggestions.spec.ts
        │   ├── editor-integration.spec.ts
        │   ├── state-management.spec.ts
        │   ├── user-interactions.spec.ts
        │   ├── error-recovery.spec.ts
        │   ├── content-boundaries.spec.ts
        │   └── save-blocking.spec.ts
        ├── 06-import/
        │   └── import-articles.spec.ts
        ├── 07-logging/
        │   └── client-logging.spec.ts
        ├── 08-sources/
        │   └── add-sources.spec.ts
        ├── 09-admin/
        │   ├── admin-auth.spec.ts
        │   ├── admin-content.spec.ts
        │   ├── admin-reports.spec.ts
        │   ├── admin-users.spec.ts
        │   ├── admin-arena.spec.ts
        │   ├── admin-article-variant-detail.spec.ts
        │   ├── admin-auth.spec.ts
        │   ├── admin-budget-events.spec.ts
        │   ├── admin-candidates.spec.ts
        │   ├── admin-content.spec.ts
        │   ├── admin-evolution.spec.ts
        │   ├── admin-evolution-visualization.spec.ts
        │   ├── admin-experiment-detail.spec.ts
        │   ├── admin-evolution-run-pipeline.spec.ts
        │   ├── admin-evolution-experiment-wizard-e2e.spec.ts
        │   ├── admin-prompt-registry.spec.ts
        │   ├── admin-reports.spec.ts
        │   ├── admin-strategy-budget.spec.ts
        │   ├── admin-strategy-crud.spec.ts
        │   ├── admin-strategy-registry.spec.ts
        │   ├── admin-users.spec.ts
        │   └── admin-whitelist.spec.ts
        ├── smoke.spec.ts              # Quick sanity checks
        └── auth.unauth.spec.ts        # Unauthenticated flow tests
```

---

## Mocking Patterns

### Unit Tests
All external services fully mocked:

```typescript
// Chainable Supabase mock
mockSupabase = {
  from: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: {...}, error: null })
};
```

### Integration Tests
- **Real Supabase**: Service role key bypasses RLS
- **Mocked APIs**: OpenAI, Pinecone (cost/speed)
- **Test data prefix**: All data prefixed with `test-` for cleanup

```typescript
import { createTestContext, cleanupTestData } from '@/testing/utils/integration-helpers';

let cleanup: () => Promise<void>;

beforeEach(async () => {
  const context = await createTestContext();
  cleanup = context.cleanup;
});

afterEach(() => cleanup());
```

### E2E Tests
Playwright route interception for API mocking:

```typescript
import { mockReturnExplanationAPI } from '../helpers/api-mocks';

test('streams explanation', async ({ page }) => {
  await mockReturnExplanationAPI(page, { title: 'Test', content: '...' });
  // SSE events are simulated
});
```

### Route Mock Cleanup

All mock helper functions in `api-mocks.ts` call `page.unroute(pattern)` before `page.route(pattern, ...)` to prevent handler stacking when a mock is called multiple times in the same test. This is automatic — callers don't need to manage route cleanup.

```typescript
// Pattern used in all mock helpers (api-mocks.ts)
export async function mockReturnExplanationAPI(page: Page, response: MockResponse) {
  await page.unroute('**/api/returnExplanation');  // Remove any previous handler
  await page.route('**/api/returnExplanation', async (route) => { ... });
}
```

Between tests, route cleanup is handled by fixture teardown (`page.unrouteAll()` in `base.ts` and `auth.ts`).

### global.fetch Restoration

Unit tests that mock `global.fetch` must save and restore the original to prevent cross-test pollution:

```typescript
const originalFetch = global.fetch;
const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => {
  global.fetch = originalFetch;
});
```

---

## ESM Tests

Jest struggles with ESM-only packages like `unified` and `remark-parse`. These tests use Node's native test runner:

**File**: `src/editorFiles/markdownASTdiff/markdownASTdiff.esm.test.ts`

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
```

**Command**: `npm run test:esm` → `npx tsx --test --test-name-pattern='.*' <file>`

---

## E2E Patterns

### `expect.poll` for POM Helper Assertions

Custom POM helpers that return `Promise<T>` should be asserted with `expect.poll`, NOT `expect(await helper())`. The latter captures the value once and races with React hydration / streaming. Enforced by ESLint `flakiness/no-point-in-time-pom-helpers` (testing_overview.md Rule 4).

```typescript
// Wrong — point-in-time, races with re-render
expect(await resultsPage.isPlainTextMode()).toBe(true);
expect(await resultsPage.getContent()).toEqual(initialContent);

// Right — Playwright retries the helper until it matches or timeout
await expect.poll(() => resultsPage.isPlainTextMode()).toBe(true);
await expect
  .poll(() => resultsPage.getContent(), { timeout: 10000 })
  .toEqual(initialContent);
```

The `flakiness/no-point-in-time-pom-helpers` rule fires on `expect(await <camelCasePomInstance>.<method>())` patterns. Playwright's bare `page` fixture is excluded (no uppercase letter before `Page`), so `expect(await page.title()).toBe('foo')` is allowed. Use `expect.poll` anyway for genuine assertion-style checks.

### `resetFilters()` POM Convention for Admin List Pages

Admin list pages with default UI filters (`filterTestContent=true` on the explanations table, etc.) hide seeded `[TEST]`-prefixed rows. Tests must reset the UI's default filter state immediately after navigation, before asserting on seeded rows. The `AdminBasePage.resetFilters()` method is no-op by default; subclasses override to uncheck their specific default filters using Playwright's auto-waiting idempotent `setChecked(false)`. Enforced by ESLint `flakiness/require-reset-filters` for `09-admin/**/*.spec.ts`.

```typescript
// AdminContentPage.ts override
async resetFilters(): Promise<void> {
  // setChecked is auto-waiting + idempotent — safe to call regardless of state.
  // Do NOT use isChecked()-then-uncheck — that pattern is flagged by the
  // existing flakiness/no-point-in-time-checks rule.
  await this.filterTestContentCheckbox.setChecked(false);
}

// In a test:
adminTest('seeds and filters', async ({ adminPage }) => {
  const contentPage = new AdminContentPage(adminPage);
  await contentPage.gotoContent();
  await contentPage.resetFilters();          // ← REQUIRED before seeded-row assertions
  await contentPage.search('[TEST] foo');
  // ...
});
```

For tests that need hidden content visible (e.g. after hiding then verifying), use the separate `enableShowHidden()` helper rather than folding it into `resetFilters()`. This avoids surprising tests that don't want hidden content visible.

### Page Object Models

```typescript
// helpers/pages/SearchPage.ts — POM methods must wait after actions (Rule 12)
export class SearchPage extends BasePage {
  async search(query: string) {
    await this.page.locator('[data-testid="search-input"]').fill(query);
    await this.page.locator('[data-testid="search-submit"]').click();
    // Wait for navigation so callers don't need their own waits
    await this.page.waitForURL(/\/results/, { timeout: 15000 });
  }

  async clickSaveToLibrary() {
    await this.page.click('[data-testid="save-to-library"]');
    // Wait for API response before returning
    await this.page.waitForResponse(resp =>
      resp.url().includes('/userLibrary') && resp.status() === 200
    );
  }
}
```

### Evolution Accessibility Tests

Evolution E2E specs include accessibility tests using Playwright's accessibility snapshot feature (`page.accessibility.snapshot()`). These tests verify ARIA roles, labels, and keyboard navigation across evolution admin pages (tab lists, sortable tables, form controls). The accessibility spec lives in `09-admin/admin-evolution-accessibility.spec.ts`.

### `@critical` Tagging for Evolution

Evolution Phase 1-2 E2E specs are tagged `{ tag: '@critical' }` so they run on every PR to `main`. This ensures core evolution flows (dashboard, runs, experiments, arena) are always validated in CI.

### Auth Fixture

```typescript
// fixtures/auth.ts
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    // Verifies Supabase auth cookies from storageState
    await use(page);
  }
});
```

### Playwright Projects

| Project | Purpose |
|---------|---------|
| `setup` | Auth once, saves to `.auth/user.json` |
| `chromium` | Authenticated tests (depends on setup) |
| `chromium-unauth` | Tests auth redirects with empty state |
| `firefox` | Nightly runs only |

---

## CI/CD Integration

> **Full details**: See `docs/docs_overall/environments.md` for comprehensive environment configuration, local vs CI execution differences, and workflow comparisons.

### CI Caching

Three caches speed up CI runs:

| Cache | Path | Key Strategy | Purpose |
|-------|------|-------------|---------|
| **tsc incremental** | `tsconfig.ci.tsbuildinfo` | `tsconfig.ci.json` + `package-lock.json` | Skip re-checking unchanged files |
| **Jest transforms** | `/tmp/jest-cache` | `package-lock.json` | Reuse ts-jest transpilation results |
| **Next.js build** | `.next/cache` | `package-lock.json` | Reuse webpack/turbopack cache |

Configuration:
- `tsconfig.ci.json` has `incremental: true` and `tsBuildInfoFile: "tsconfig.ci.tsbuildinfo"`
- `jest.config.js` has `cacheDirectory: '/tmp/jest-cache'` (matches CI `--cacheDirectory` flag)
- All caches use `restore-keys` fallback for partial matches

### ci.yml (Push/PR)

```
TypeScript Check ─┐
Lint ─────────────┼─→ Integration Tests ─→ E2E Tests
Unit Tests + ESM ─┘
```

**E2E Behavior by Target Branch:**
- **PRs to `main`**: Critical tests only (`@critical` tagged via `{ tag: '@critical' }`), no sharding
- **PRs to `production`**: Full suite, 4 shards with `fail-fast: true`

### e2e-nightly.yml

- **Schedule**: 6 AM UTC daily
- **Browsers**: Chromium + Firefox (full browser matrix)
- Full test suite against live production URL, no sharding
- **No `E2E_TEST_MODE`** — uses real AI against production (no SSE mocking)
- **YAML runs from `main`** but checks out `production` branch code (`ref: production`)
- **`@skip-prod` filtering (belt-and-suspenders):** CLI `--grep-invert="@skip-prod"` in the workflow YAML ensures tests are skipped regardless of which branch's `playwright.config.ts` is checked out. The config-based `grepInvert` in `playwright.config.ts` provides defense-in-depth when production catches up with main.
- Uses `environment: Production` secrets
- Manual trigger via `workflow_dispatch`

---

## Test Utilities

### test-helpers.ts
```typescript
createMockExplanation(overrides)    // Full explanation record
createMockTopic(overrides)          // Topic record
createMockTag(overrides)            // Tag record
createMockVector(dimension)         // Random embedding vector
createMockOpenAIResponse(content)   // OpenAI chat response
```

### component-test-helpers.ts
```typescript
createMockSimpleTag()               // Simple tag object
createMockPresetTag()               // Preset collection tag
createMockAISuggestionsPanelProps() // Component props
createSuccessResponse(data)         // {success: true, data, error: null}
```

### integration-helpers.ts
```typescript
setupTestDatabase()                 // Service role client
teardownTestDatabase(supabase)      // Clean test-* prefixed data
createTestContext()                 // Full setup with cleanup
waitForDatabaseOperation(fn)        // Retry logic for async DB
```

### editor-test-helpers.ts
```typescript
// AI pipeline test fixtures (30+ cases organized by category)
AI_PIPELINE_FIXTURES = {
  insertions: [...],                // 5 insertion test cases
  deletions: [...],                 // 3 deletion test cases
  updates: [...],                   // 3 update test cases
  mixed: [...],                     // 3 mixed edit cases
  edge: [...],                      // 16 edge cases
  promptSpecific: [...]             // 3 rewrite scenarios
}

// CriticMarkup utilities
hasCriticInsertion(text)            // Check for {++...++}
extractCriticDeletions(text)        // Extract {--...--} content
parseCriticMarkup(text)             // Full CriticMarkup parser

// AST node factories
createMockParagraph(text)           // Paragraph AST node
createMockHeading(level, text)      // Heading AST node
createMockList(items)               // List AST node
// ... 20+ node type factories
```

### page-test-helpers.ts
```typescript
createMockRouter(overrides)         // Next.js router mock
createMockSearchParams(params)      // URL search params
createMockLexicalEditorRef()        // Lexical editor reference
mockUseAuthHook(user)               // Auth hook mock
```

### phase9-test-helpers.ts
```typescript
createMockFormData(fields)          // FormData mock
createMockCookies(values)           // Cookie mock
createMockRedirect()                // Next.js redirect helper
createSupabaseErrorMock(code)       // Supabase error factory
```

### evolution-test-helpers.ts (`evolution/src/testing/`) ([full docs](../../evolution/docs/evolution/reference.md#testing))
```typescript
NOOP_SPAN                              // No-op OTel span for mocked instrumentation
VALID_VARIANT_TEXT                     // Format-valid markdown for pipeline tests
evolutionTablesExist(supabase)         // Check if evolution tables are migrated
cleanupEvolutionData(supabase, opts)   // FK-safe cleanup via CleanupOptions { explanationIds?, runIds?, strategyIds?, promptIds? }
createTestStrategyConfig(supabase)     // Insert [TEST]-prefixed strategy, returns UUID
createTestPrompt(supabase)             // Insert [TEST]-prefixed prompt, returns UUID
createTestEvolutionRun(supabase, ...)  // Insert test evolution run
createTestVariant(supabase, ...)       // Insert test variant
createMockEvolutionLLMClient(overrides) // Mock LLM client for pipeline tests
createMockEvolutionLogger()            // Mock logger with jest.fn() methods
```

**`[TEST]` prefix convention:** `createTestStrategyConfig()` and `createTestPrompt()` produce rows with `[TEST]` in their name/title. Admin UI pages filter these out by default via "Hide test content" checkboxes. See [Admin Panel — Hide Test Content](./admin_panel.md#hide-test-content).

### evolution-test-data-factory.ts (`src/__tests__/e2e/helpers/`)
```typescript
getEvolutionServiceClient()           // Cached Supabase client (service role)
createTestStrategy(options?)          // Insert [TEST_EVO]-prefixed strategy, tracks for cleanup
createTestPrompt(options?)            // Insert [TEST_EVO]-prefixed prompt, tracks for cleanup
createTestRun(options?)               // Insert test run (auto-creates strategy+prompt if needed)
createTestVariant(options)            // Insert test variant
createTestExperiment(options)         // Insert test experiment
cleanupAllTrackedEvolutionData()      // FK-safe 9-step cleanup from per-worker tracking files
```

**`[TEST_EVO]` prefix:** E2E evolution test data uses this prefix (distinct from `[TEST]` used by explanation tests) for easy identification in logs and cleanup queries. Cleanup order: arena_comparisons → invocations → logs → metrics → variants → explanations → runs → experiments → strategies → prompts.

**Cleanup enforcement:** `evolution-test-data-factory` is included in the `require-test-cleanup` ESLint pattern — any E2E spec importing it must have an `afterAll` cleanup block.

### logging-test-helpers.ts
```typescript
createMockLogConfig(overrides)      // LogConfig factory
createMockTracingConfig()           // TracingConfig factory
createMockLogger()                  // Logger with debug/info/warn/error
captureLogCalls(logger)             // Capture log calls for assertions
testSensitiveDataSanitization()     // Test PII redaction
```

---

## Supabase CLI for Test Infrastructure

When debugging test failures, use the Supabase CLI and read-only query scripts to inspect database state. See [debugging.md](../docs_overall/debugging.md#supabase-cli-debugging) for full reference.

### Querying Staging/Production Test Data

```bash
# Check test data state on staging (read-only, DB-enforced)
npm run query:staging -- "SELECT count(*) FROM explanations WHERE explanation_title LIKE '[TEST]%'"
npm run query:staging -- "SELECT id, status, created_at FROM evolution_runs ORDER BY created_at DESC LIMIT 10"

# Query production for comparison
npm run query:prod -- "SELECT count(*) FROM explanations"

# Interactive REPL for exploratory debugging
npm run query:staging
```

### Debugging Slow or Stuck Tests

```bash
# Find queries running > 5 minutes (may indicate test deadlocks)
npx supabase inspect db long-running-queries --linked

# Check for lock contention between parallel test workers
npx supabase inspect db locks --linked
npx supabase inspect db blocking --linked

# Identify slowest queries (may explain slow integration tests)
npx supabase inspect db outliers --linked
```

### Schema & Health Checks

```bash
# Check RLS policies and index coverage (affects test behavior)
npx supabase db advisors --linked

# Verify migration status matches expectations
npx supabase migration list

# Compare local schema vs staging
npx supabase db diff --linked
```

> **Safety:** All commands above are read-only. `npm run query:staging`/`query:prod` use DB-enforced `readonly_local` roles — writes are impossible. `supabase inspect db` reads pg_stat views only. `supabase db query --linked` is blocked by hook — use the query scripts instead.

---

## Key Architectural Decisions

| Aspect | Unit | Integration | E2E |
|--------|------|-------------|-----|
| Database | Mocked | Real (service role) | Real (anon key) |
| OpenAI | Mocked | Mocked | Mocked via routes |
| Execution | Parallel | Sequential (maxWorkers: 1) | Parallel (2 workers) |
| Timeouts | Default | 30s | 60s (CI) / 30s (local) |
| Retries | 0 | 0 | 2 in CI |

---

## Known Issues

1. **E2E logout test skipped**: `signOut()` uses `redirect()` incompatible with onClick
2. **Firefox SSE**: Nightly runs include Firefox against production (no `E2E_TEST_MODE`) using real AI and SSE streaming
3. **Coverage thresholds**: Set ~5% below baseline (branches: 41%, functions: 35%, lines: 42%, statements: 42%)
4. **Supabase rate limits**: Rapid auth tests may trigger limits (use `--workers=1`)
5. **AI suggestions E2E**: Requires `NEXT_PUBLIC_USE_AI_API_ROUTE='true'` in environment
6. **Test data cleanup**: E2E test data uses `[TEST]` prefix for discovery filtering; integration uses `test-` prefix
7. **Jest 30 upgrade**: Using Jest 30.2.0 - async context improvements, minor migration from 29.x
8. **Column name convention**: `userLibrary` table uses `explanationid` (no underscore), while `explanation_tags` uses `explanation_id` (with underscore). Be careful with column names in cleanup queries.

---

## Additional Notes

### Jest 30
- Currently on Jest 30.2.0 (major version upgrade from 29.x)
- Key improvements: better async context, improved ESM support
- Breaking changes were minimal; most tests worked without modification

### OpenTelemetry in Development
- Dev mode includes OTEL auto-instrumentation (see `npm run dev` script)
- Traces sent to Grafana Cloud
- **Testing impact**: OTEL disabled in test environment (`NODE_ENV=test`)
- If tests behave differently in dev vs test, check OTEL instrumentation

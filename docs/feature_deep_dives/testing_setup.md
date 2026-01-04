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
- **Unit**: 60+ colocated `.test.ts` files
- **ESM**: 1 file for AST diffing (bypasses Jest ESM limitations)
- **Integration**: 11 test files in `__tests__/integration/`
- **E2E**: 17 spec files in `__tests__/e2e/specs/` (including 6 AI suggestions specs)
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
| `jest.config.js` | Unit tests: jsdom environment, module mocks |
| `jest.integration.config.js` | Integration: node environment, real Supabase |
| `jest.setup.js` | Unit test mocks, polyfills, Testing Library matchers |
| `jest.integration-setup.js` | Integration setup: service role client, stable mocks |
| `jest.shims.js` | OpenAI Node shims (runs before module imports) |
| `playwright.config.ts` | E2E: projects, timeouts, web server, reporters |
| `tsconfig.ci.json` | TypeScript check in CI (excludes test files) |

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
│   ├── langchain-text-splitter.ts     # LangChain mock
│   ├── @pinecone-database/pinecone.ts # Pinecone API mock
│   └── @supabase/supabase-js.ts       # Supabase API mock
└── utils/
    ├── test-helpers.ts                # Data builders & utilities
    ├── component-test-helpers.ts      # Component props factories
    ├── editor-test-helpers.ts         # AST factories, AI pipeline fixtures
    ├── integration-helpers.ts         # DB setup/teardown
    ├── logging-test-helpers.ts        # Logging test utilities
    ├── page-test-helpers.ts           # Next.js page testing, router mocks
    └── phase9-test-helpers.ts         # Auth/middleware testing utilities

src/__tests__/
├── integration/                       # 11 integration test files
│   ├── auth-flow.integration.test.ts
│   ├── error-handling.integration.test.ts
│   ├── explanation-generation.integration.test.ts
│   ├── explanation-update.integration.test.ts
│   ├── import-articles.integration.test.ts
│   ├── logging-infrastructure.integration.test.ts
│   ├── metrics-aggregation.integration.test.ts
│   ├── request-id-propagation.integration.test.ts
│   ├── streaming-api.integration.test.ts
│   ├── tag-management.integration.test.ts
│   └── vector-matching.integration.test.ts
└── e2e/
    ├── fixtures/auth.ts               # Supabase auth fixture
    ├── helpers/
    │   ├── api-mocks.ts               # SSE streaming mocks
    │   ├── wait-utils.ts              # Custom wait strategies
    │   └── pages/                     # Page Object Models
    │       ├── BasePage.ts
    │       ├── SearchPage.ts
    │       ├── ResultsPage.ts
    │       ├── ImportPage.ts
    │       └── UserLibraryPage.ts
    ├── setup/
    │   └── auth.setup.ts              # Auth once before all tests
    └── specs/                         # Organized by feature
        ├── 01-auth/
        │   └── auth.spec.ts
        ├── 02-search-generate/
        │   ├── search-generate.spec.ts
        │   └── regenerate.spec.ts
        ├── 03-library/
        │   └── library.spec.ts
        ├── 04-content-viewing/
        │   ├── viewing.spec.ts
        │   ├── tags.spec.ts
        │   └── action-buttons.spec.ts
        ├── 05-edge-cases/
        │   └── errors.spec.ts
        ├── 06-ai-suggestions/         # AI suggestions test suite
        │   ├── suggestions.spec.ts
        │   ├── editor-integration.spec.ts
        │   ├── state-management.spec.ts
        │   ├── user-interactions.spec.ts
        │   ├── error-recovery.spec.ts
        │   └── content-boundaries.spec.ts
        ├── 06-import/
        │   └── import-articles.spec.ts
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

### Page Object Models

```typescript
// helpers/pages/SearchPage.ts
export class SearchPage extends BasePage {
  async search(query: string) {
    await this.page.locator('[data-testid="search-input"]').fill(query);
    await this.page.locator('[data-testid="search-submit"]').click();
  }
}
```

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

### ci.yml (Push/PR)

```
TypeScript Check ─┐
Lint ─────────────┼─→ Integration Tests ─→ E2E Tests
Unit Tests + ESM ─┘
```

**E2E Behavior by Target Branch:**
- **PRs to `main`**: Critical tests only (~36 `@critical` tagged), no sharding
- **PRs to `production`**: Full suite, 4 shards with `fail-fast: true`

### e2e-nightly.yml

- **Schedule**: 6 AM UTC daily
- **Browsers**: Chromium + Firefox (full browser matrix)
- Full test suite, no sharding
- `E2E_TEST_MODE=true` for SSE streaming compatibility
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

### logging-test-helpers.ts
```typescript
createMockLogConfig(overrides)      // LogConfig factory
createMockTracingConfig()           // TracingConfig factory
createMockLogger()                  // Logger with debug/info/warn/error
captureLogCalls(logger)             // Capture log calls for assertions
testSensitiveDataSanitization()     // Test PII redaction
```

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
2. **Firefox SSE**: Nightly runs now include Firefox with `E2E_TEST_MODE=true` for real SSE streaming
3. **Coverage at 0%**: Progressive increase planned
4. **Supabase rate limits**: Rapid auth tests may trigger limits (use `--workers=1`)
5. **AI suggestions E2E**: Requires `NEXT_PUBLIC_USE_AI_API_ROUTE='true'` in environment
6. **Test data cleanup**: All test data uses `test-` prefix for reliable teardown
7. **Jest 30 upgrade**: Using Jest 30.2.0 - async context improvements, minor migration from 29.x

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

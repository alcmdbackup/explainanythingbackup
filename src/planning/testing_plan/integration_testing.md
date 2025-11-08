# Integration Testing Plan for ExplainAnything

## Executive Summary

**Current State:**
- **Unit Tests:** 51 test files, 1,207 tests (99.4% pass rate)
- **Integration Tests:** 0 (Phase 3 not started)
- **Coverage:** 38.37% (unit test coverage only)
- **Gap:** No testing of cross-service data flow or external system integration

**Goal:** Implement comprehensive integration testing to validate service interactions, data flow, and external API integration that unit tests cannot cover.

**Target:** 30-50 integration tests covering 10 critical scenarios across 3 tiers

**Timeline:** 1.5 months (44 hours) across 4 phases

---

## Current Testing Gap

### What Unit Tests Cover (Current)
- ✅ Individual function logic
- ✅ Business rule validation
- ✅ Error handling per service
- ✅ Component rendering and interactions
- ✅ Mocked external dependencies

### What Integration Tests Will Cover (New)
- ❌ Multi-service orchestration flows
- ❌ Real database transactions and rollbacks
- ❌ API contract validation (OpenAI, Pinecone, Supabase)
- ❌ Error propagation across service boundaries
- ❌ Request ID context propagation
- ❌ Streaming response handling
- ❌ Concurrent operation coordination
- ❌ Data format compatibility between services

---

## Critical Integration Points Identified

### 1. Core Service Orchestration
**Primary Flow:** `returnExplanation.ts` (Main orchestrator)

**Integration Chain:**
```
returnExplanation
├→ generateTitleFromUserQuery → llms.ts → OpenAI API
├→ searchForSimilarVectors → vectorsim.ts → Pinecone API
├→ findBestMatchFromList → findMatches.ts (match evaluation)
├→ generateNewExplanation → llms.ts → OpenAI streaming
├→ evaluateTags (parallel) → tagEvaluation.ts
├→ createMappingsHeadingsToLinks (parallel) → links.ts
├→ saveExplanationAndTopic → Supabase transaction
└→ processContentToStoreEmbedding → Pinecone upsert
```

**Risk:** Unit tests mock ALL dependencies, so data flow and format compatibility are untested.

### 2. API Routes → Services Integration
**4 API Routes:**
- `/api/stream-chat` → `llms.ts` (streaming responses)
- `/api/client-logs` → logging infrastructure
- `/api/test-cases` → `testingPipeline.ts`
- `/api/test-responses` → `testingPipeline.ts`

**Risk:** Request/response format mismatches, streaming chunk handling, error serialization.

### 3. Server Actions → Multi-Service Coordination
**30+ Server Actions** in `actions.ts`:
- `saveExplanationAndTopic` → creates topic + explanation + embedding
- Tag operations → `tags.ts` + `explanationTags.ts` + database updates
- Metrics aggregation → triggers PostgreSQL stored procedures

**Risk:** Transaction boundaries, partial failures, race conditions.

### 4. Auth Flow Integration
**OAuth Flow:**
```
/auth/callback?code=xxx
├→ exchangeCodeForSession → Supabase Auth
├→ Session cookie creation
└→ middleware.ts validates session → route access granted
```

**Risk:** Cookie persistence, session validation, redirect chains.

### 5. Request ID Propagation
**Full Stack Context:**
```
Client: RequestIdContext.setClient({requestId, userId})
├→ Server Action receives __requestId
├→ serverReadRequestId extracts context
├→ withLogging wrapper logs with requestId
├→ OpenTelemetry spans include requestId
└→ All logs correlate via requestId
```

**Risk:** Context loss in async operations, streaming, or error paths.

### 6. Editor + AI Suggestions Integration
**Complex Flow:**
```
User edits Lexical editor
├→ AISuggestionsPanel triggers
├→ aiSuggestion.ts → callOpenAIModel
├→ Response → markdownASTdiff.ts (diff calculation)
└→ Apply changes → Lexical editor state update
```

**Risk:** State synchronization, diff application, editor corruption.

### 7. Logging Infrastructure (0% Coverage)
**5 files in `src/lib/logging/server/`:**
- `withLogging`, `withLoggingAndTracing` wrappers
- OpenTelemetry integration
- File logging (server.log)
- Structured logging with context

**Risk:** Critical infrastructure completely untested.

---

## Integration Test Scenarios

### TIER 1: Critical User Flows (Highest Priority)

#### Scenario 1: End-to-End Explanation Generation
**Test:** User query → complete explanation with tags and links

**Integration Points:**
1. `returnExplanation` → `generateTitleFromUserQuery` → OpenAI API
2. → `searchForSimilarVectors` → Pinecone query (no match found)
3. → `generateNewExplanation` → OpenAI streaming
4. → Parallel: `evaluateTags` + `createMappingsHeadingsToLinks`
5. → `saveExplanationAndTopic` → Supabase transaction
6. → `processContentToStoreEmbedding` → Pinecone upsert

**What to Test:**
- OpenAI returns valid structured output (title, content, tags)
- Pinecone stores/retrieves vectors with correct dimensions
- Supabase transaction completes successfully
- Parallel operations (tags + links) both complete before response
- Error in any step propagates correctly
- Request ID appears in all logs
- Explanation ID returned matches database record

**Expected Failures Without Integration Tests:**
- Schema mismatch between OpenAI response and database columns
- Vector dimension mismatch (Pinecone expects 1536, receives different)
- Partial completion (explanation saved but embedding fails)
- Race condition in parallel tag/link operations

**Implementation File:** `src/__tests__/integration/explanation-generation.integration.test.ts`

**Estimated Tests:** 5-7 tests
- Happy path (new explanation)
- OpenAI failure mid-generation
- Pinecone upsert failure
- Database constraint violation
- Streaming response handling

---

#### Scenario 2: Vector Similarity Match Flow
**Test:** Query finds existing similar explanation (match > threshold)

**Integration Points:**
1. `returnExplanation` → `searchForSimilarVectors` → Pinecone returns matches
2. → `enhanceMatchesWithCurrentContentAndDiversity` → scoring calculation
3. → `findBestMatchFromList` → returns existing explanation_id
4. → Load from database → return without new generation
5. → User query saved with match reference

**What to Test:**
- Pinecone returns expected match structure (id, score, metadata)
- Match scoring integrates correctly with diversity calculation
- Database lookup succeeds for matched explanation_id
- No unnecessary LLM calls when match found
- User query logged with matched_explanation_id

**Expected Failures Without Integration Tests:**
- Pinecone metadata format changes break parsing
- Match score threshold doesn't account for Pinecone's similarity metric
- Database query uses wrong ID format

**Implementation File:** `src/__tests__/integration/vector-matching.integration.test.ts`

**Estimated Tests:** 4-5 tests
- High similarity match found
- Low similarity (below threshold)
- Multiple matches (diversity selection)
- Pinecone returns empty results

---

#### Scenario 3: Streaming API Response Integration
**Test:** `/api/stream-chat` with real LLM streaming

**Integration Points:**
1. POST `/api/stream-chat` → `RequestIdContext.run()`
2. → `callOpenAIModel(streaming=true, callback)`
3. → OpenAI streaming chunks → callback invoked per chunk
4. → SSE stream to client
5. → Final completion signal

**What to Test:**
- Request ID context propagates into streaming callback
- Streaming chunks arrive in order without corruption
- Error mid-stream handled gracefully (partial response + error)
- Final completion signal sent correctly
- Logging captures streaming duration and chunk count
- Client receives properly formatted SSE events

**Expected Failures Without Integration Tests:**
- Context loss in streaming callback (request ID missing in logs)
- SSE formatting breaks on special characters in chunks
- Error mid-stream causes unclosed connection
- Final chunk indicator missing

**Implementation File:** `src/__tests__/integration/streaming-api.integration.test.ts`

**Estimated Tests:** 4-6 tests
- Successful streaming response
- Error before streaming starts
- Error mid-stream
- Connection interrupted
- Multiple concurrent streams

---

#### Scenario 4: Tag Management Integration
**Test:** Add/remove tags with preset validation and conflict detection

**Integration Points:**
1. `addTagsToExplanationAction` → `addTagsToExplanation` service
2. → Validate against preset tags
3. → Check mutually exclusive groups (conflicting tags)
4. → Insert into `explanation_tags` junction table
5. → Return updated tag list

**What to Test:**
- Preset tag conflict detection (e.g., can't add "basic" + "advanced")
- Junction table updates reflect immediately in queries
- Soft delete pattern works (deleted_at field)
- AI-evaluated tags integrate with manually added tags
- Bulk tag operations maintain data integrity

**Expected Failures Without Integration Tests:**
- Mutually exclusive logic doesn't match database constraints
- Race condition when adding/removing tags concurrently
- Soft delete pattern breaks queries (deleted tags still appear)

**Implementation File:** `src/__tests__/integration/tag-management.integration.test.ts`

**Estimated Tests:** 5-7 tests
- Add valid tags
- Add conflicting tags (should fail)
- Remove tags (soft delete)
- AI tags + manual tags
- Bulk tag operations

---

### TIER 2: Service Integration (High Priority)

#### Scenario 5: Multi-Service Explanation Update
**Test:** Update explanation content + regenerate embeddings + update tags atomically

**Integration Points:**
1. `updateExplanationAndTopic` → Supabase UPDATE transaction
2. → `processContentToStoreEmbedding` → Pinecone upsert (overwrites old vectors)
3. → `applyTagsToExplanation` → tag evaluation + database update

**What to Test:**
- Supabase update transaction completes successfully
- Pinecone vectors updated (not duplicated with new ID)
- Tag changes persist correctly
- Failure in Pinecone upsert rolls back database update
- Explanation version history maintained (if applicable)

**Implementation File:** `src/__tests__/integration/explanation-update.integration.test.ts`

**Estimated Tests:** 4-5 tests

---

#### Scenario 6: Auth Flow Integration
**Test:** Complete OAuth callback → session creation → protected route access

**Integration Points:**
1. `/auth/callback?code=xxx` → `exchangeCodeForSession`
2. → Supabase creates session
3. → Cookie set in response
4. → Next request: `middleware.ts` validates cookie
5. → Protected route access granted

**What to Test:**
- OAuth code exchange succeeds with Supabase
- Session cookie persists correctly (httpOnly, secure flags)
- Middleware correctly validates session cookie
- Invalid/expired sessions redirect to login
- User ID propagates through RequestIdContext in subsequent requests

**Implementation File:** `src/__tests__/integration/auth-flow.integration.test.ts`

**Estimated Tests:** 5-6 tests

---

#### Scenario 7: Metrics Aggregation Pipeline
**Test:** User event triggers PostgreSQL stored procedure for aggregation

**Integration Points:**
1. `createUserExplanationEvent` → INSERT into `userExplanationEvents`
2. → PostgreSQL trigger fires
3. → Calls stored procedure (aggregate calculation)
4. → Updates `explanationMetrics` table

**What to Test:**
- Events trigger aggregation correctly
- Stored procedures calculate metrics accurately (views, clicks, etc.)
- Parallel events don't cause race conditions or lost updates
- Aggregate queries return expected data structure

**Implementation File:** `src/__tests__/integration/metrics-aggregation.integration.test.ts`

**Estimated Tests:** 3-4 tests

---

### TIER 3: Infrastructure Integration (Medium Priority)

#### Scenario 8: Request ID Propagation
**Test:** Request ID flows client → server actions → services → logs → OpenTelemetry

**Integration Points:**
1. Client: `RequestIdContext.setClient({requestId, userId})`
2. → Server action receives `__requestId` in FormData
3. → `serverReadRequestId` extracts context
4. → Service wrapped with `withLogging` includes requestId in logs
5. → OpenTelemetry span tagged with requestId

**What to Test:**
- Request ID survives client → server boundary
- Async operations maintain correct context (no cross-contamination)
- Streaming operations preserve requestId in all chunks
- All log entries include correct requestId
- OpenTelemetry spans correlate correctly

**Implementation File:** `src/__tests__/integration/request-id-propagation.integration.test.ts`

**Estimated Tests:** 3-4 tests

---

#### Scenario 9: Error Handling Integration
**Test:** Service error → categorization → logging → structured response

**Integration Points:**
1. Service throws error (e.g., database constraint violation)
2. → `handleError` catches and categorizes (DATABASE_ERROR)
3. → Logs with full context via logger
4. → Returns structured `ErrorResponse`
5. → Client receives actionable error message

**What to Test:**
- All error categories handled correctly (API, database, validation, etc.)
- Sensitive information not leaked to client
- Errors logged with full stack trace and context
- Retry logic works for transient errors
- Error telemetry captured in OpenTelemetry

**Implementation File:** `src/__tests__/integration/error-handling.integration.test.ts`

**Estimated Tests:** 4-5 tests

---

#### Scenario 10: Logging Infrastructure Integration
**Test:** `withLogging` wrapper → file + console + OpenTelemetry

**Integration Points:**
1. Service function wrapped with `withLogging`
2. → Entry/exit logs written to file (`server.log`)
3. → OpenTelemetry span created with function name
4. → Performance metrics captured (duration, memory)
5. → Error stack traces logged on failure

**What to Test:**
- All logging wrappers function correctly (withLogging, withLoggingAndTracing)
- Logs appear in expected destinations (file, console)
- Performance overhead is acceptable (< 5ms per call)
- No circular dependency issues in logging infrastructure
- Structured logging format is consistent

**Implementation File:** `src/__tests__/integration/logging-infrastructure.integration.test.ts`

**Estimated Tests:** 3-4 tests

---

## Testing Strategy

### How Integration Tests Differ from Unit Tests

| Aspect | Unit Tests (Current) | Integration Tests (New) |
|--------|---------------------|------------------------|
| **Scope** | Single function/module in isolation | Multiple services + external systems |
| **Mocking** | Mock ALL dependencies (Supabase, Pinecone, OpenAI) | Mock ONLY external APIs OR use test instances |
| **Database** | Mocked Supabase client with fake responses | Real test database with transactions |
| **Vectors** | Mocked Pinecone with predefined responses | Test Pinecone index or in-memory vector DB |
| **LLMs** | Mocked OpenAI responses (static JSON) | Stubbed realistic responses OR recorded interactions |
| **Focus** | Logic correctness within function | Data flow, format compatibility, error propagation |
| **Speed** | Very fast (~2 min for 1,207 tests) | Slower (~5-10 min for 30-50 tests) |
| **Isolation** | High (per-function, parallel execution) | Low (cross-service, sequential for DB tests) |
| **Failures** | Logic bugs, validation errors | Schema mismatches, transaction issues, API contracts |

### Recommended Tooling Approach

#### **Option A: Test Database + Realistic Mocks** (Recommended)

```typescript
// Use real test Supabase instance, mock OpenAI/Pinecone with realistic fixtures
beforeAll(async () => {
  // Real test database (or in-memory SQLite for speed)
  testSupabase = createTestSupabaseClient(TEST_DATABASE_URL);
  await setupTestSchema(testSupabase);
  await seedTestData(testSupabase);

  // Mock OpenAI with realistic, deterministic responses
  mockOpenAI.chat.completions.create.mockImplementation(async (params) => {
    return fixtures.getOpenAIResponse(params.messages);
  });

  // Mock Pinecone with in-memory vector store
  mockPinecone = new InMemoryVectorStore(1536); // embedding dimension
  await mockPinecone.seed(fixtures.vectorData);
});

afterEach(async () => {
  // Transaction rollback for isolation
  await testSupabase.rollback();
});
```

**Pros:**
- Fast execution (no real API calls)
- Deterministic (no flakiness from network)
- No API costs during testing
- Full control over edge cases

**Cons:**
- Doesn't catch API contract changes
- Requires maintaining realistic fixtures
- May miss API-specific edge cases

---

#### **Option B: Playwright E2E** (For Phase 4)

```typescript
// Full stack testing with real browser
test('generate explanation end-to-end', async ({ page }) => {
  await page.goto('/');
  await page.fill('[data-testid="search-input"]', 'quantum entanglement');
  await page.click('[data-testid="search-button"]');

  // Wait for AI generation
  await expect(page.locator('h1')).toContainText('Quantum Entanglement');
  await expect(page.locator('[data-testid="explanation-content"]')).toBeVisible();
});
```

**Pros:**
- True end-to-end validation
- Tests actual user interactions
- Catches UI/UX issues

**Cons:**
- Slowest option (minutes per test)
- Flaky (network, timing, browser issues)
- Hard to debug
- Expensive (real API calls)

---

#### **Option C: Hybrid Approach** (Recommended)

**Combination:**
1. **Integration tests** (Option A) for service flows - 30-50 tests
2. **Playwright E2E** (Option B) for critical user journeys - 5-10 tests (defer to Phase 4)

**Benefits:**
- Fast feedback from integration tests
- E2E validation for critical paths
- Cost-effective (minimal real API usage)

---

## Project Structure

### New Directories

```
src/
├── __tests__/                           # NEW - centralized integration & E2E tests
│   ├── integration/                     # Integration tests
│   │   ├── explanation-generation.integration.test.ts
│   │   ├── vector-matching.integration.test.ts
│   │   ├── streaming-api.integration.test.ts
│   │   ├── tag-management.integration.test.ts
│   │   ├── explanation-update.integration.test.ts
│   │   ├── auth-flow.integration.test.ts
│   │   ├── metrics-aggregation.integration.test.ts
│   │   ├── request-id-propagation.integration.test.ts
│   │   ├── error-handling.integration.test.ts
│   │   └── logging-infrastructure.integration.test.ts
│   └── e2e/                             # Playwright E2E (Phase 4)
│       ├── generate-explanation.e2e.ts
│       ├── user-library.e2e.ts
│       └── tag-management.e2e.ts
│
└── testing/
    ├── fixtures/                        # NEW - realistic test data
    │   ├── llm-responses.ts             # OpenAI mock responses
    │   ├── vector-matches.ts            # Pinecone mock data
    │   ├── database-records.ts          # Test explanations, topics, tags
    │   └── streaming-chunks.ts          # Streaming response fixtures
    │
    └── utils/
        └── integration-helpers.ts       # NEW - setup/teardown utilities
            ├── setupTestDatabase()
            ├── teardownTestDatabase()
            ├── seedTestData()
            ├── createTestSupabaseClient()
            └── cleanupTestData()
```

### Configuration Files

#### `jest.integration.config.js` (NEW)
```javascript
module.exports = {
  ...require('./jest.config.js'),

  // Only run integration tests
  testMatch: ['**/__tests__/integration/**/*.integration.test.ts'],

  // Longer timeout for database/API operations
  testTimeout: 30000, // 30 seconds

  // Integration-specific setup
  setupFilesAfterEnv: ['<rootDir>/jest.integration-setup.js'],

  // Use node environment (not jsdom)
  testEnvironment: 'node',

  // Run tests sequentially to avoid database conflicts
  maxWorkers: 1,

  // Clear mocks between tests
  clearMocks: true,
  resetMocks: true,
};
```

#### `jest.integration-setup.js` (NEW)
```javascript
// Global setup for integration tests
beforeAll(async () => {
  // Setup test database
  await setupTestDatabase();
});

afterAll(async () => {
  // Cleanup test database
  await teardownTestDatabase();
});
```

### NPM Scripts (Add to package.json)

```json
{
  "scripts": {
    "test": "jest --config jest.config.js",
    "test:unit": "jest --config jest.config.js",
    "test:integration": "jest --config jest.integration.config.js",
    "test:integration:watch": "jest --config jest.integration.config.js --watch",
    "test:all": "npm run test:unit && npm run test:integration",
    "test:coverage": "jest --config jest.config.js --coverage",
    "test:coverage:all": "jest --config jest.integration.config.js --coverage && npm run test:coverage"
  }
}
```

---

## Implementation Roadmap

### Phase 3A: Foundation Setup
**Duration:** Week 1 (8 hours)
**Status:** Not Started

**Tasks:**
1. Create directory structure (`__tests__/integration/`, `testing/fixtures/`)
2. Create `jest.integration.config.js` and setup file
3. Implement integration test helpers:
   - `setupTestDatabase()` - Create test Supabase instance or SQLite DB
   - `teardownTestDatabase()` - Cleanup after tests
   - `seedTestData()` - Insert baseline test data
   - `createTestSupabaseClient()` - Test-specific client
4. Create realistic fixtures:
   - `llm-responses.ts` - OpenAI chat completion responses
   - `vector-matches.ts` - Pinecone query results
   - `database-records.ts` - Test explanations, topics, tags
5. Add npm scripts for running integration tests
6. Document integration testing patterns in README

**Deliverables:**
- Test infrastructure ready
- First example integration test (proof of concept)
- Documentation for writing integration tests

---

### Phase 3B: Tier 1 Integration Tests
**Duration:** Weeks 2-3 (16 hours)
**Status:** Not Started

**Priority:** HIGHEST - Critical user-facing flows

**Tasks:**

**Week 2:**
1. **Scenario 1:** End-to-end explanation generation (4 hours)
   - 5-7 tests covering happy path, OpenAI failure, Pinecone failure, DB errors
   - File: `explanation-generation.integration.test.ts`

2. **Scenario 2:** Vector similarity match flow (3 hours)
   - 4-5 tests for high/low similarity, multiple matches, empty results
   - File: `vector-matching.integration.test.ts`

**Week 3:**
3. **Scenario 3:** Streaming API integration (3 hours)
   - 4-6 tests for streaming, mid-stream errors, concurrent streams
   - File: `streaming-api.integration.test.ts`

4. **Scenario 4:** Tag management integration (3 hours)
   - 5-7 tests for tag conflicts, soft deletes, bulk operations
   - File: `tag-management.integration.test.ts`

5. **Bug Fixes:** Address integration bugs discovered (3 hours)

**Deliverables:**
- 18-25 integration tests for critical paths
- Bug fixes for any integration issues found
- Updated documentation with learnings

**Expected Bugs Found:** 3-5 integration bugs (schema mismatches, transaction issues)

---

### Phase 3C: Tier 2 Integration Tests
**Duration:** Week 4 (12 hours)
**Status:** Not Started

**Priority:** HIGH - Service coordination

**Tasks:**

1. **Scenario 5:** Multi-service explanation update (3 hours)
   - 4-5 tests for atomic updates, rollback on failure
   - File: `explanation-update.integration.test.ts`

2. **Scenario 6:** Auth flow integration (3 hours)
   - 5-6 tests for OAuth callback, session validation, redirects
   - File: `auth-flow.integration.test.ts`

3. **Scenario 7:** Metrics aggregation pipeline (3 hours)
   - 3-4 tests for trigger execution, concurrent events
   - File: `metrics-aggregation.integration.test.ts`

4. **Additional scenarios as needed** (3 hours)
   - Based on bugs found in Phase 3B
   - Edge cases discovered during testing

**Deliverables:**
- 12-15 additional integration tests
- Coverage of multi-service coordination scenarios

**Expected Bugs Found:** 2-3 integration bugs (race conditions, transaction boundaries)

---

### Phase 3D: Tier 3 Integration Tests
**Duration:** Week 5 (8 hours)
**Status:** Not Started

**Priority:** MEDIUM - Infrastructure validation

**Tasks:**

1. **Scenario 8:** Request ID propagation (2 hours)
   - 3-4 tests for context preservation across async boundaries
   - File: `request-id-propagation.integration.test.ts`

2. **Scenario 9:** Error handling integration (2 hours)
   - 4-5 tests for error categorization, logging, telemetry
   - File: `error-handling.integration.test.ts`

3. **Scenario 10:** Logging infrastructure (2 hours)
   - 3-4 tests for logging wrappers, performance overhead
   - File: `logging-infrastructure.integration.test.ts`

4. **Documentation and CI/CD integration** (2 hours)
   - Update testing_plan.md with Phase 3 completion
   - Add integration tests to CI/CD pipeline
   - Document patterns and best practices

**Deliverables:**
- 10-13 infrastructure tests
- Complete integration test suite (40-50 tests total)
- CI/CD pipeline integration
- Updated documentation

---

### Total Effort Summary

| Phase | Duration | Hours | Tests | Priority |
|-------|----------|-------|-------|----------|
| 3A: Foundation | Week 1 | 8 | 1 (example) | CRITICAL |
| 3B: Tier 1 | Weeks 2-3 | 16 | 18-25 | HIGHEST |
| 3C: Tier 2 | Week 4 | 12 | 12-15 | HIGH |
| 3D: Tier 3 | Week 5 | 8 | 10-13 | MEDIUM |
| **TOTAL** | **5 weeks** | **44 hours** | **40-50** | - |

**Timeline:** 1.5 months part-time (assumes ~2-3 hours/day)

---

## Success Metrics

### Coverage Goals

**Integration Test Metrics:**
- **Test Count:** 40-50 integration tests (vs. 1,207 unit tests)
- **Critical Paths:** 100% of user-facing flows covered
- **Service Integration:** All service-to-service calls tested at least once
- **External APIs:** All OpenAI, Pinecone, Supabase integrations validated

**Code Coverage:**
- Integration tests will primarily validate **data flow**, not increase line coverage
- Expected coverage increase: +2-5 percentage points (from better test data)
- Focus on **integration bugs**, not coverage percentage

### Quality Goals

**Test Quality:**
- **Pass Rate:** ≥99% (matching unit test quality)
- **Flakiness:** <1% flaky tests (deterministic fixtures)
- **Execution Time:** <10 minutes for full integration suite
- **Maintenance:** Integration tests updated within 1 day of service changes

**Bug Detection:**
- **Expected Bugs Found:** 5-10 integration bugs during implementation
- **Bug Categories:**
  - Schema mismatches (OpenAI response ↔ database)
  - Vector dimension mismatches (Pinecone)
  - Transaction rollback issues
  - Error propagation gaps
  - Context loss in async operations
  - Race conditions in parallel flows

### Documentation Goals

**Knowledge Sharing:**
- Integration test patterns documented in `testing/README.md`
- Fixture creation guide for new services
- CI/CD pipeline documentation updated
- Onboarding guide for new developers includes integration testing

**Developer Experience:**
- Integration tests run in <10 min locally
- Clear error messages when tests fail
- Easy to add new integration tests (copy existing pattern)
- Test data fixtures well-organized and discoverable

---

## Risks & Mitigations

### Risk 1: Slow Test Execution
**Impact:** Integration tests take >30 minutes, slowing development

**Mitigations:**
- Use in-memory database (SQLite) instead of PostgreSQL where possible
- Run integration tests in parallel (when safe - separate test data namespaces)
- Cache database schema setup (only seed once per test run)
- Run integration tests separately from unit tests in CI (optional check)
- Use realistic mocks instead of real external APIs (OpenAI, Pinecone)

**Monitoring:** Track test execution time per scenario, optimize slowest tests

---

### Risk 2: Flaky Tests (Network/Timing Issues)
**Impact:** Integration tests randomly fail, reducing confidence

**Mitigations:**
- Use deterministic fixtures (no real network calls to external APIs)
- Add proper `await` for all async operations
- Use explicit timeouts (`waitFor`, `expect.poll`) instead of arbitrary delays
- Retry logic for known-flaky operations (max 2 retries)
- Run tests sequentially for database operations (avoid race conditions)

**Monitoring:** Track flaky test rate, investigate failures >1%

---

### Risk 3: Test Data Pollution
**Impact:** Tests fail due to leftover data from previous runs

**Mitigations:**
- Use transactions with rollback after each test
- Unique test data identifiers (UUIDs, timestamps) to avoid conflicts
- Comprehensive cleanup in `afterEach` hook
- Separate test database from development database
- Reset database schema between test runs (in CI)

**Monitoring:** Check for test failures when run in different orders

---

### Risk 4: Maintenance Burden
**Impact:** Integration tests become outdated and break frequently

**Mitigations:**
- Focus on critical paths only (not exhaustive coverage)
- Reuse unit test fixtures where possible
- Clear documentation of test intent (comments, descriptive names)
- Co-locate integration tests with related services (when possible)
- Regular review of test value (remove low-value tests)

**Monitoring:** Track time spent fixing integration tests vs. unit tests

---

### Risk 5: Fixture Maintenance Overhead
**Impact:** API changes require updating many fixtures

**Mitigations:**
- Use fixture factories (generate fixtures programmatically)
- Version fixtures by API version (e.g., `openai-v1-fixtures.ts`)
- Validate fixtures against actual API schemas (Zod, JSON Schema)
- Document fixture creation process
- Use recorded interactions (VCR pattern) for complex APIs

**Monitoring:** Track fixture update frequency, automate where possible

---

## Immediate Next Steps

### Step 1: Approval & Planning (This Document)
- ✅ Review this integration testing plan
- ❓ Decide on database strategy:
  - **Option A:** Real test Supabase instance (most realistic)
  - **Option B:** In-memory SQLite (fastest, requires schema migration)
  - **Option C:** Mocked database with realistic fixtures (current approach)
- ❓ Approve timeline (5 weeks / 44 hours)

### Step 2: Proof of Concept (Week 1, Phase 3A)
- Create basic integration test infrastructure
- Write first integration test (Scenario 1 - explanation generation)
- Validate approach works with current codebase
- Document any roadblocks or adjustments needed

### Step 3: Iterate Based on Learnings
- Adjust plan based on PoC results
- Refine fixtures and helpers
- Scale to remaining scenarios

### Step 4: Execute Phases 3B-3D
- Follow roadmap as outlined
- Track bugs found and fixed
- Update testing_plan.md with progress

---

## Comparison with Current Testing Plan

### Integration into Overall Testing Strategy

**testing_plan.md Current Status:**
- ✅ Phase 1: Foundation Setup (COMPLETE)
- ✅ Phase 2: Critical Path Testing (COMPLETE)
- ❌ **Phase 3: Integration Testing (THIS DOCUMENT) - NOT STARTED**
- ❌ Phase 4: E2E Testing (Playwright) - NOT STARTED
- ❌ Phase 5: CI/CD Integration - PARTIAL
- ❌ Phase 6: Logging Infrastructure - NOT STARTED
- ✅ Phase 7: Editor & Lexical System (partial)
- ✅ Phase 8: Service Layer Extensions (COMPLETE)
- ✅ Phase 9: Authentication & Middleware (COMPLETE)
- ✅ Phase 10: API Routes & Utilities (COMPLETE)
- ✅ Phase 11: Component Testing (COMPLETE)
- ✅ Phase 12: Pages/Hooks Testing (85% COMPLETE)

**Phase 3 Position in Timeline:**
- **Original Plan:** Phase 3 after Phase 2 (Critical Path)
- **Actual Implementation:** Phase 3 after Phases 2, 8, 9, 10, 11, 12
- **Rationale for Delay:** Unit tests provide faster feedback loop, integration tests require stable services

**Revised Timeline with Phase 3:**
- **Month 4 (Current):**
  - Week 1: Fix 7 failing unit tests + complete layout.tsx test
  - **Week 2-3: Phase 3A-3B (Integration testing foundation + Tier 1)**
  - Week 4: Begin Phase 6 (Logging Infrastructure)

- **Month 5:**
  - **Week 1: Phase 3C-3D (Integration Tier 2 + Tier 3)**
  - Week 2-4: Complete Phase 6 (Logging) + Phase 7 (Editor)

- **Month 5.5:**
  - Week 1-2: Coverage optimization to 85%
  - **Optional: Phase 4 (E2E with Playwright)**

**Impact on 85% Coverage Goal:** Minimal (integration tests validate flow, not coverage)

---

## Appendix: Example Integration Test

### Example: Scenario 1 - Explanation Generation

```typescript
// src/__tests__/integration/explanation-generation.integration.test.ts

import { returnExplanation } from '@/services/returnExplanation';
import { setupTestDatabase, teardownTestDatabase, seedTestData } from '@/testing/utils/integration-helpers';
import { llmFixtures } from '@/testing/fixtures/llm-responses';
import { vectorFixtures } from '@/testing/fixtures/vector-matches';

describe('Explanation Generation Integration', () => {
  beforeAll(async () => {
    await setupTestDatabase();
    await seedTestData();
  });

  afterAll(async () => {
    await teardownTestDatabase();
  });

  it('should generate complete explanation with tags and links', async () => {
    // Arrange
    const userQuery = 'What is quantum entanglement?';
    const mockOpenAI = jest.spyOn(openai.chat.completions, 'create');
    mockOpenAI.mockResolvedValueOnce(llmFixtures.titleGeneration);
    mockOpenAI.mockResolvedValueOnce(llmFixtures.explanationStreaming);

    const mockPinecone = jest.spyOn(pinecone.index('test').namespace('test'), 'query');
    mockPinecone.mockResolvedValueOnce(vectorFixtures.noMatches);

    // Act
    const result = await returnExplanation(userQuery, {
      requestId: 'test-request-123',
      userId: 'test-user-456',
    });

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      explanation_id: expect.any(String),
      title: expect.stringContaining('Quantum'),
      content: expect.any(String),
      tags: expect.arrayContaining([
        expect.objectContaining({ tag_name: expect.any(String) })
      ]),
      links: expect.arrayContaining([
        expect.objectContaining({ url: expect.any(String) })
      ]),
    });

    // Verify database persistence
    const { data: savedExplanation } = await supabase
      .from('explanations')
      .select('*')
      .eq('explanation_id', result.data.explanation_id)
      .single();

    expect(savedExplanation).toBeTruthy();
    expect(savedExplanation.title).toBe(result.data.title);

    // Verify vector embedding stored
    const vectorQuery = await pinecone
      .index('test')
      .namespace('test')
      .fetch([result.data.explanation_id]);

    expect(vectorQuery.records[result.data.explanation_id]).toBeTruthy();
  });

  it('should rollback database changes if Pinecone upsert fails', async () => {
    // Arrange
    const userQuery = 'Test rollback scenario';
    const mockPinecone = jest.spyOn(pinecone.index('test').namespace('test'), 'upsert');
    mockPinecone.mockRejectedValueOnce(new Error('Pinecone service unavailable'));

    // Act
    const result = await returnExplanation(userQuery, {
      requestId: 'test-rollback-123',
      userId: 'test-user-456',
    });

    // Assert
    expect(result.success).toBe(false);
    expect(result.error?.category).toBe('VECTOR_DATABASE_ERROR');

    // Verify no explanation was saved in database
    const { data: explanations } = await supabase
      .from('explanations')
      .select('*')
      .eq('title', expect.stringContaining('Test rollback'));

    expect(explanations).toHaveLength(0);
  });

  // Additional tests:
  // - OpenAI failure mid-generation
  // - Database constraint violation
  // - Streaming response handling
  // - Parallel tag/link operations
});
```

---

## Summary

**Current Gap:** You have 1,207 unit tests (99.4% pass rate) but zero integration tests. Unit tests mock all external dependencies, leaving cross-service integration untested.

**This Plan Addresses:**
- 10 critical integration scenarios across 3 priority tiers
- 40-50 integration tests validating service orchestration
- Real database transactions + realistic API mocks
- Expected to find 5-10 integration bugs current tests miss

**Recommended Approach:**
- Start with Phase 3A (foundation) to validate approach
- Prioritize Tier 1 scenarios (user-facing critical paths)
- Use hybrid approach (test DB + mocked external APIs)
- Keep integration tests separate from unit tests (different config)

**Timeline:** 5 weeks (44 hours) to complete all phases

**Next Action:** Approve this plan, then implement Phase 3A proof of concept (first integration test for explanation generation flow).
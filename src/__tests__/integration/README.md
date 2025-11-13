# Integration Testing Documentation

## Overview

Integration tests validate cross-service interactions, data flow, and external API integration that unit tests cannot cover. Unlike unit tests which mock all dependencies, integration tests use **real database connections** with **mocked external APIs** (OpenAI, Pinecone) for speed and cost-effectiveness.

## Test Strategy

### What Integration Tests Cover

- ✅ Multi-service orchestration flows
- ✅ Real database transactions and rollbacks
- ✅ API request/response integration
- ✅ Error propagation across service boundaries
- ✅ Request ID context propagation
- ✅ Streaming response handling
- ✅ Data format compatibility between services

### What's Mocked vs. Real

| Component | Integration Tests | Unit Tests |
|-----------|------------------|------------|
| **Database (Supabase)** | ✅ **REAL** (test namespace) | ❌ Mocked |
| **OpenAI API** | ❌ Mocked (cost/speed) | ❌ Mocked |
| **Pinecone API** | ❌ Mocked (cost/speed) | ❌ Mocked |
| **Services** | ✅ **REAL** | ✅ Real (isolated) |
| **API Routes** | ✅ **REAL** | ❌ Mocked |

## Running Integration Tests

### Quick Start

```bash
# Run all integration tests
npm run test:integration

# Run integration tests in watch mode
npm run test:integration:watch

# Run both unit and integration tests
npm run test:all
```

### Environment Setup

Integration tests use the `.env.test` file, which is based on `.env.stage` with test-specific overrides:

```bash
# .env.test
PINECONE_NAMESPACE=test          # Isolates test vectors
TEST_USER_ID_PREFIX=test-user-   # Marks test users
TEST_DATA_PREFIX=test-           # Marks test data
NODE_ENV=test
```

**Important**: All test data is prefixed with `test-` for easy cleanup and isolation.

## Writing Integration Tests

### File Structure

```
src/__tests__/integration/
├── streaming-api.integration.test.ts      # Example: API streaming tests
├── explanation-generation.integration.test.ts  # Future: E2E explanation flow
└── ...more tests

src/testing/
├── utils/
│   ├── integration-helpers.ts    # Database setup/teardown utilities
│   └── test-helpers.ts           # Reusable mock builders
└── fixtures/
    ├── llm-responses.ts          # OpenAI mock responses
    └── database-records.ts       # Test data factories
```

### Basic Test Template

```typescript
import { setupTestDatabase, teardownTestDatabase, createTestContext } from '@/testing/utils/integration-helpers';
import { collectStreamData, parseSSEMessages } from '@/testing/utils/test-helpers';
import { SupabaseClient } from '@supabase/supabase-js';
import * as llmsModule from '@/lib/services/llms';

// Mock external APIs (OpenAI, Pinecone)
jest.mock('@/lib/services/llms', () => ({
  ...jest.requireActual('@/lib/services/llms'),
  callOpenAIModel: jest.fn(),
  default_model: 'gpt-4',
}));

describe('My Integration Test Suite', () => {
  let supabase: SupabaseClient;
  let testUserId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    // Set up real database connection
    supabase = await setupTestDatabase();
    console.log('Database setup complete');
  });

  afterAll(async () => {
    // Clean up all test data
    await teardownTestDatabase(supabase);
    console.log('Database cleanup complete');
  });

  beforeEach(async () => {
    // Create test context for each test
    const context = await createTestContext();
    testUserId = context.userId;
    cleanup = context.cleanup;
  });

  afterEach(async () => {
    // Clean up test-specific data
    await cleanup();
  });

  it('should do something', async () => {
    // Arrange
    const mockCallOpenAIModel = llmsModule.callOpenAIModel as jest.MockedFunction<typeof llmsModule.callOpenAIModel>;
    mockCallOpenAIModel.mockImplementation(async (...args) => {
      // Your mock implementation
      return { success: true };
    });

    // Act
    const result = await yourFunction();

    // Assert
    expect(result).toBeDefined();
  });
});
```

### Integration Test Helpers

#### Database Utilities

```typescript
// Create test database client
import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
const supabase = createTestSupabaseClient();

// Set up test database (verify connection)
import { setupTestDatabase } from '@/testing/utils/integration-helpers';
const supabase = await setupTestDatabase();

// Clean up all test data
import { teardownTestDatabase } from '@/testing/utils/integration-helpers';
await teardownTestDatabase(supabase);

// Create test context (database + user + cleanup)
import { createTestContext } from '@/testing/utils/integration-helpers';
const { supabase, testId, userId, cleanup } = await createTestContext();
await cleanup(); // Call this in afterEach
```

#### Test Data Factories

```typescript
// Create test records
import { createTestTopic, createTestExplanation, createTestTag } from '@/testing/fixtures/database-records';

const topic = createTestTopic({ topic: 'Custom Topic' });
const explanation = createTestExplanation(topic.id);
const tags = createTestTags(['basic', 'advanced']);

// Create complete data set
import { createCompleteTestDataSet } from '@/testing/fixtures/database-records';
const { topic, explanation, tags, testId } = createCompleteTestDataSet();
```

#### LLM Response Fixtures

```typescript
// Use predefined LLM responses
import {
  titleGenerationResponse,
  explanationGenerationResponse,
  fullExplanationContent
} from '@/testing/fixtures/llm-responses';

// Create streaming chunks
import { generateStreamingChunks } from '@/testing/fixtures/llm-responses';
for (const chunk of generateStreamingChunks('Your content here')) {
  // Process chunk
}
```

#### Stream Testing Utilities

```typescript
// Collect streaming data
import { collectStreamData, parseSSEMessages } from '@/testing/utils/test-helpers';

const response = await fetch('/api/stream-chat', { ... });
const chunks = await collectStreamData(response.body);
const messages = parseSSEMessages(chunks);

// Find completion message
const completionMessage = messages.find((msg: any) => msg.isComplete);
```

## Best Practices

### 1. Test Data Isolation

✅ **DO**: Use test prefixes for all data
```typescript
const testId = `${TEST_PREFIX}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
const userId = `test-user-${testId}`;
```

❌ **DON'T**: Create data without prefixes
```typescript
const userId = 'user-123'; // Bad: Could conflict with real data
```

### 2. Cleanup

✅ **DO**: Clean up in `afterEach` and `afterAll`
```typescript
afterEach(async () => {
  await cleanup(); // Per-test cleanup
});

afterAll(async () => {
  await teardownTestDatabase(supabase); // Global cleanup
});
```

❌ **DON'T**: Skip cleanup (pollutes database)

### 3. Mock External APIs

✅ **DO**: Mock OpenAI/Pinecone for speed and cost
```typescript
jest.mock('@/lib/services/llms', () => ({
  ...jest.requireActual('@/lib/services/llms'),
  callOpenAIModel: jest.fn(),
}));
```

❌ **DON'T**: Make real API calls in integration tests (expensive, slow, flaky)

### 4. Test Real Data Flow

✅ **DO**: Test actual database operations
```typescript
// Insert to database
await supabase.from('topics').insert(topic);

// Verify persistence
const { data } = await supabase.from('topics').select('*').eq('id', topic.id);
expect(data).toBeTruthy();
```

❌ **DON'T**: Mock database operations (that's what unit tests do)

### 5. Test Error Scenarios

✅ **DO**: Test both success and failure paths
```typescript
it('should handle database errors gracefully', async () => {
  // Test constraint violation, foreign key errors, etc.
});
```

### 6. Use Descriptive Test Names

✅ **DO**: Describe what you're testing and expected behavior
```typescript
it('should stream chat response with proper SSE formatting', async () => { ... });
it('should handle error before streaming starts', async () => { ... });
```

❌ **DON'T**: Use vague names
```typescript
it('works', async () => { ... }); // Bad
it('test1', async () => { ... }); // Bad
```

## Configuration

### Jest Integration Config (`jest.integration.config.js`)

Key differences from unit test config:

```javascript
{
  testEnvironment: 'node',          // Not jsdom
  testMatch: ['**/__tests__/integration/**/*.integration.test.ts'],
  testTimeout: 30000,               // 30 seconds (database operations)
  maxWorkers: 1,                    // Sequential execution (avoid DB conflicts)
  // Supabase NOT mocked - real DB connection
  moduleNameMapper: {
    '^openai$': '<rootDir>/src/testing/mocks/openai.ts',  // Still mocked
    // No Supabase mock - uses real client
  }
}
```

## Troubleshooting

### Database Connection Fails

**Error**: `Failed to connect to test database`

**Solution**:
1. Check `.env.test` has correct `SUPABASE_SERVICE_ROLE_KEY`
2. Verify network access to Supabase
3. Ensure service role key is valid

### Tests Are Flaky

**Symptoms**: Tests pass/fail randomly

**Solutions**:
1. Ensure `maxWorkers: 1` in `jest.integration.config.js`
2. Use unique test IDs (timestamp + random)
3. Verify `cleanup()` is called in `afterEach`
4. Check for race conditions in parallel operations

### Slow Test Execution

**Symptoms**: Tests take >10 minutes

**Solutions**:
1. Reduce number of integration tests (keep under 50)
2. Optimize database queries
3. Use batch operations where possible
4. Consider caching database schema setup

### Mock Not Applied

**Error**: `Cannot read properties of undefined (reading 'completions')`

**Solution**: Use proper mock setup
```typescript
import * as llmsModule from '@/lib/services/llms';
jest.mock('@/lib/services/llms', () => ({
  ...jest.requireActual('@/lib/services/llms'),
  callOpenAIModel: jest.fn(),
}));

// In test:
const mockFn = llmsModule.callOpenAIModel as jest.MockedFunction<typeof llmsModule.callOpenAIModel>;
mockFn.mockImplementation(...);
```

## Current Test Coverage

### Phase 3A: Foundation (Complete ✅)

- ✅ **Streaming API** (`streaming-api.integration.test.ts`): 5 tests
  - Successful streaming response
  - Long content streaming
  - Error handling before stream
  - Missing field validation
  - Request ID context propagation

### Future Phases

- ❌ **Phase 3B**: Tier 1 scenarios (18-25 tests)
  - Explanation generation end-to-end
  - Vector similarity matching
  - Tag management with conflicts

- ❌ **Phase 3C**: Tier 2 scenarios (12-15 tests)
  - Multi-service explanation updates
  - Auth flow integration
  - Metrics aggregation pipeline

- ❌ **Phase 3D**: Tier 3 scenarios (10-13 tests)
  - Request ID propagation across services
  - Error handling integration
  - Logging infrastructure

## Success Metrics

- ✅ **Pass Rate**: 100% (5/5 tests passing)
- ✅ **Execution Time**: <6 seconds (target: <10 minutes for full suite)
- ✅ **Database Cleanup**: Working correctly
- ✅ **Test Isolation**: No cross-contamination

## Resources

- [Integration Testing Plan](../../planning/testing_plan/integration_testing.md)
- [Test Helpers Documentation](../../testing/README.md)
- [Supabase Documentation](https://supabase.com/docs)
- [Jest Documentation](https://jestjs.io/docs/getting-started)

## Contributing

When adding new integration tests:

1. Follow the test template above
2. Add fixtures to `src/testing/fixtures/` if needed
3. Reuse existing helpers from `integration-helpers.ts`
4. Ensure tests clean up after themselves
5. Update this README with new test scenarios
6. Run `npm run test:all` to verify both unit and integration tests pass

## Questions?

- Check [Troubleshooting](#troubleshooting) section
- Review existing tests for examples
- See [Integration Testing Plan](../../planning/testing_plan/integration_testing.md) for overall strategy

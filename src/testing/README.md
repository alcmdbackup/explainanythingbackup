# Testing Directory Structure

This directory contains all testing utilities and configurations for the project.

## Structure

```
src/testing/
├── mocks/              # Mock implementations for external dependencies
│   ├── openai.ts       # OpenAI API mock
│   └── @/              # Scoped package mocks
│       ├── pinecone-database/
│       └── supabase/
├── utils/              # Testing utilities and helpers
│   └── test-helpers.ts # Mock data builders and utilities
├── integration/        # Integration tests (centralized)
└── e2e/               # E2E tests with Playwright (centralized)
```

## Usage

### Unit Tests (Colocated)
Unit tests are placed next to source files:
- `service.ts` → `service.test.ts`
- `component.tsx` → `component.test.tsx`

### Importing Test Utilities
```typescript
import { createMockExplanation, createMockTopic } from '@/testing/utils/test-helpers';
```

### Mocks
Mocks are automatically applied via Jest configuration. Simply import the real module:
```typescript
import OpenAI from 'openai'; // Automatically uses mock from testing/mocks
```

### Test Scripts

**Unit Tests:**
- `npm test` - Run all tests (unit tests only)
- `npm run test:unit` - Run unit tests explicitly
- `npm run test:watch` - Watch mode for unit tests
- `npm run test:coverage` - Coverage report for unit tests
- `npm run test:ci` - CI optimized unit tests

**Integration Tests:**
- `npm run test:integration` - Run integration tests only
- `npm run test:integration:watch` - Watch mode for integration tests
- `npm run test:all` - Run both unit and integration tests

---

## Integration Testing

### Overview

Integration tests validate cross-service data flow and external API integration using **real** connections to:
- **Supabase** (test database instance)
- **OpenAI** (test API key with usage limits)
- **Pinecone** (test index)

Unlike unit tests which mock all dependencies, integration tests verify actual service interactions, database transactions, and API contracts.

### Setup

1. **Use Staging Environment:**
   Integration tests use your existing `.env.stage` file.
   ```bash
   # No separate test environment needed!
   # Tests use staging credentials from .env.stage
   ```

2. **Verify Required Variables:**
   Your `.env.stage` should already have these variables:
   - **Supabase:** Staging project URL and keys
   - **OpenAI:** API key (same as staging)
   - **Pinecone:** Staging index name and API key

3. **Environment Variables in .env.stage:**
   ```bash
   # Supabase (Staging Environment)
   NEXT_PUBLIC_SUPABASE_URL=https://your-staging.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-staging-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-staging-service-role-key

   # OpenAI
   OPENAI_API_KEY=your-openai-api-key

   # Pinecone (Staging Index)
   PINECONE_API_KEY=your-pinecone-api-key
   PINECONE_INDEX=your-staging-index-name
   ```

### Writing Integration Tests

Integration tests use the `.integration.test.ts` suffix and are colocated with their source files:

```typescript
// src/lib/services/example.integration.test.ts
import {
  setupIntegrationTestContext,
  type IntegrationTestContext,
} from '@/testing/utils/integration-helpers';

describe('Example Integration Tests', () => {
  let context: IntegrationTestContext;

  beforeAll(async () => {
    // Setup test context with real clients
    context = await setupIntegrationTestContext();
  });

  afterAll(async () => {
    // Cleanup test data
    await context.cleanup();
  });

  it('should perform end-to-end operation', async () => {
    // Test with real OpenAI, Pinecone, and Supabase
    const result = await yourService(context.supabase, context.openai);

    // Verify database state
    const { data } = await context.supabase
      .from('your_table')
      .select('*')
      .eq('id', result.id);

    expect(data).toBeTruthy();
  }, 60000); // Longer timeout for API calls
});
```

### Test Helpers

**Setup & Cleanup:**
```typescript
import {
  setupIntegrationTestContext,
  seedTestTopic,
  seedTestExplanation,
  seedTestTag,
  seedTestVector,
} from '@/testing/utils/integration-helpers';
```

**Fixtures:**
```typescript
import {
  titleGenerationResponse,
  explanationGenerationResponse,
  generateMockEmbedding,
} from '@/testing/fixtures/llm-responses';

import {
  highSimilarityMatch,
  noMatches,
  createVectorMatch,
} from '@/testing/fixtures/vector-matches';

import {
  testTopics,
  testExplanations,
  testTags,
  createTestExplanation,
} from '@/testing/fixtures/database-records';
```

### Best Practices

**DO:**
- ✅ Use real API connections for realistic testing
- ✅ Clean up test data in `afterAll` hooks
- ✅ Use longer timeouts (30-60 seconds) for API calls
- ✅ Test complete end-to-end flows across services
- ✅ Verify database state after operations
- ✅ Test error propagation across service boundaries

**DON'T:**
- ❌ Mock external services (that's what unit tests are for)
- ❌ Leave test data in the database
- ❌ Use production credentials
- ❌ Run integration tests in watch mode constantly (API costs)
- ❌ Test implementation details (test behavior and contracts)

### Configuration

Integration tests use a separate Jest configuration:

**jest.integration.config.js:**
- `testEnvironment: 'node'` (not jsdom)
- `testMatch: ['**/*.integration.test.ts']`
- `testTimeout: 60000` (60 seconds)
- `maxWorkers: 1` (sequential execution)
- No auto-mocking of external services

### Cost Management

**Estimated Costs:**
- OpenAI: ~$0.10-0.50 per test run (using gpt-4o-mini)
- Pinecone: Free tier or ~$0.01 per test run
- Supabase: Free tier sufficient for testing

**Optimization:**
- Use cheaper models (`gpt-4o-mini` instead of `gpt-4`)
- Run integration tests on-demand (not in watch mode)
- Set usage alerts on test API keys
- Clean up Pinecone vectors regularly

### Troubleshooting

**"Missing environment variables" error:**
- Ensure `.env.stage` exists with all required variables
- Verify `dotenv` is loading the file correctly (should load automatically)

**"Tests timing out":**
- Check network connectivity
- Verify API keys are valid
- Increase timeout in test: `it('test', async () => {}, 120000)`

**"Database cleanup failing":**
- Check RLS policies allow service role to delete
- Verify foreign key constraints
- Use service client for cleanup: `context.supabaseService`

**"Pinecone vectors not found":**
- Pinecone has eventual consistency (~1-2 seconds)
- Add wait after upsert: `await new Promise(r => setTimeout(r, 2000))`

### Phase Implementation Status

- ✅ **Phase 3A:** Foundation Setup (COMPLETE)
  - Integration test infrastructure created
  - First proof-of-concept test: `returnExplanation.integration.test.ts`

- ⏳ **Phase 3B:** Tier 1 Critical Flows (IN PROGRESS)
  - Scenario 1-4: User-facing core flows

- ⏳ **Phase 3C:** Tier 2 Service Integration (PENDING)
  - Scenario 5-7: Multi-service coordination

- ⏳ **Phase 3D:** Tier 3 Infrastructure (PENDING)
  - Scenario 8-10: Request ID, errors, logging

See `/src/planning/testing_plan/integration_testing.md` for complete implementation plan.
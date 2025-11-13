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
- `npm test` - Run all tests
- `npm run test:watch` - Watch mode
- `npm run test:coverage` - Coverage report
- `npm run test:ci` - CI optimized
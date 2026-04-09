# Hide E2E Tests from Staging Research

## Problem Statement
E2E tests create strategies/prompts/experiments with `[E2E]` and `[TEST_EVO]` prefixes that persist in staging DB and are visible in the admin UI because the test content filter in `shared.ts` only excludes `[TEST]` prefixed content.

## Code Files Read
- `evolution/src/services/shared.ts` - Test content filter functions
- `evolution/src/services/evolutionActions.ts` - Run listing with filter
- `evolution/src/services/strategyRegistryActions.ts` - Strategy listing
- `src/__tests__/e2e/specs/09-admin/admin-evolution-anchor-ranking.spec.ts` - Creates `[E2E]` data
- `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` - Creates `[TEST_EVO]` data
- `src/__tests__/integration/evolution-test-content-filter.integration.test.ts` - Filter tests

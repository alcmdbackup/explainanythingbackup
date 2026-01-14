# Remove Remaining Junk Explanations Missed Earlier Research

## Problem Statement

Two junk explanations exist in staging that were missed by the previous cleanup effort:
1. **"Test Title"**
2. **"Understanding Quantum Entanglement"**

## High Level Summary

These junk explanations originate from **integration tests** that:
1. Use mock LLM responses with titles **without** the `[TEST]` prefix
2. Run against the **staging database** (via `.env.test` configuration)
3. Are NOT cleaned up because the teardown logic only deletes records containing `[TEST]` prefix

### Root Cause

| Issue | Location | Problem |
|-------|----------|---------|
| Mock uses "Test Title" | `explanation-generation.integration.test.ts:317, 464` | Hardcoded title without `[TEST]` prefix |
| Mock uses "Understanding Quantum Entanglement" | `llm-responses.ts:16` | Fixture title without `[TEST]` prefix |
| Cleanup misses these | `integration-helpers.ts:87-92, 110-112` | Only deletes records with `%[TEST]%` pattern |

## Documents Read

- `docs/planning/clean_up_junk_articles_in_production_20260112/clean_up_junk_articles_in_production_planning.md` - Previous cleanup effort
- `docs/docs_overall/architecture.md` - System architecture
- `docs/docs_overall/project_workflow.md` - Project workflow

## Code Files Read

### Source Files for "Test Title"

**`src/__tests__/integration/explanation-generation.integration.test.ts`**
- Line 317: `choices: [{ message: { content: JSON.stringify({ title1: 'Test Title', title2: 'Test Title 2', title3: 'Test Title 3' }) } }]`
- Line 464: Same pattern repeated

These are mock LLM responses for error handling tests. When `returnExplanationLogic` runs, it:
1. Generates a title from the mock (selects `title1` = "Test Title")
2. Saves to database with that title
3. Test passes, but record persists

### Source Files for "Understanding Quantum Entanglement"

**`src/testing/fixtures/llm-responses.ts`**
- Line 16: `title1: 'Understanding Quantum Entanglement'`
- Line 27-41: Full content with this title
- Line 123-146: `fullExplanationContent` constant
- Line 196: `completeExplanationFixture.title`

**`src/__tests__/e2e/helpers/api-mocks.ts`**
- Line 178: `defaultMockExplanation.title = 'Understanding Quantum Entanglement'`
- Line 222: `mockLibraryExplanations[0].title`

**`src/actions/actions.ts`**
- Line 386: Mock title for E2E test mode (`mockTitles[90001]`)

### Cleanup Logic (Why It Misses These)

**`src/testing/utils/integration-helpers.ts`**
- Lines 87-92: `teardownTestDatabase()` queries for `%[TEST]%` pattern only
- Lines 110-112: Deletes only records matching `%[TEST]%`

```typescript
// Line 87-92 - Only finds [TEST] prefixed records
const { data: testExplanations } = await supabase
  .from('explanations')
  .select('id')
  .ilike('explanation_title', `%${TEST_PREFIX}%`);  // TEST_PREFIX = '[TEST] '
```

### Database Configuration

**`.env.test`**
```
NEXT_PUBLIC_SUPABASE_URL=https://ifubinffdbyewoezcidz.supabase.co
PINECONE_NAMESPACE=test
NODE_ENV=test
```

Integration tests run against the **same staging database** as local development.

## Test Run Flow (How Junk Gets Created)

```
1. npm run test:integration
   ↓
2. jest.integration-setup.js loads .env.test
   ↓
3. Tests connect to staging Supabase (ifubinffdbyewoezcidz.supabase.co)
   ↓
4. Mock LLM returns "Test Title" or "Understanding Quantum Entanglement"
   ↓
5. returnExplanationLogic saves to database
   ↓
6. teardownTestDatabase() runs, looks for %[TEST]%
   ↓
7. "Test Title" doesn't match pattern → NOT DELETED
   ↓
8. Junk persists in staging
```

## Files Requiring Changes

| File | Change Needed |
|------|---------------|
| `src/__tests__/integration/explanation-generation.integration.test.ts` | Update mock titles to use `[TEST]` prefix |
| `src/testing/fixtures/llm-responses.ts` | Update fixture titles to use `[TEST]` prefix |
| `src/__tests__/e2e/helpers/api-mocks.ts` | Update `defaultMockExplanation.title` |

## Staging Database Cleanup Needed

SQL to identify and delete junk:
```sql
-- Find junk explanations
SELECT id, explanation_title FROM explanations
WHERE explanation_title IN ('Test Title', 'Understanding Quantum Entanglement');

-- Delete (after verification)
DELETE FROM explanations
WHERE explanation_title IN ('Test Title', 'Understanding Quantum Entanglement');
```

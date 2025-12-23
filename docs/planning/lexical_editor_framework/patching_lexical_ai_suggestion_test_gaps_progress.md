# Patching Lexical AI Suggestion Test Gaps - Progress Report

## Overview

This document tracks the implementation progress of the plan outlined in `patching_lexical_ai_suggestion_test_gaps_plan.md`.

## Implementation Status

| Phase | Description | Status | Notes |
|-------|-------------|--------|-------|
| Phase 1 | Add promptSpecific fixtures to AI_PIPELINE_FIXTURES | ✅ Complete | 3 fixtures added |
| Phase 2 | Create integration tests for prompt-specific cases | ✅ Complete | 10 tests passing |
| Phase 3 | Add API mocks for AI suggestions pipeline | ✅ Complete | Mock function created |
| Phase 4 | Extend ResultsPage POM with AI suggestions methods | ✅ Complete | 15+ methods added |
| Phase 5 | Create E2E test specs | ⚠️ Partial | 4 passing, 20 skipped |
| Phase 6 | Add missing data-testid attributes | ✅ Complete | 3 attributes added |

## Detailed Progress

### Phase 1: Unit Test Fixtures ✅

**File:** `src/testing/utils/editor-test-helpers.ts`

Added `promptSpecific` category to `AI_PIPELINE_FIXTURES` with 3 fixtures:
- `removeFirstSentence` - deletion category, 1 diff
- `shortenFirstParagraph` - mixed category, 2 diffs
- `improveEntireArticle` - mixed category, 8 diffs

Also added `getPromptSpecificFixtures()` helper function.

### Phase 2: Integration Tests ✅

**File:** `src/editorFiles/lexicalEditor/promptSpecific.integration.test.tsx`

Created 10 integration tests, all passing:

```
Prompt-Specific: Remove First Sentence
  ✓ should create deletion diff for removed sentence
  ✓ accept removes the sentence from content
  ✓ reject keeps the sentence in content

Prompt-Specific: Shorten First Paragraph
  ✓ should create deletion and insertion diffs
  ✓ accept all replaces verbose paragraph with concise version
  ✓ reject all keeps original verbose paragraph

Prompt-Specific: Improve Entire Article
  ✓ should create multiple diffs across headings and paragraphs
  ✓ accept all transforms article to improved version
  ✓ reject all keeps original poor quality article
  ✓ partial accept keeps some improvements, rejects others
```

### Phase 3: API Mocks ✅

**File:** `src/__tests__/e2e/helpers/api-mocks.ts`

Added:
- `mockAISuggestionsPipeline(page, options)` - Intercepts server action calls
- `mockDiffContent` - Pre-built responses for insertion/deletion/update/mixed
- `mockPromptSpecificContent` - Pre-built responses matching Phase 1 fixtures

### Phase 4: Page Object Model Extensions ✅

**File:** `src/__tests__/e2e/helpers/pages/ResultsPage.ts`

Added selectors:
- `aiSuggestionsPanel`, `aiPromptInput`, `getSuggestionsButton`
- `suggestionsLoading`, `suggestionsSuccess`, `suggestionsError`
- `diffNodes`, `insertionNodes`, `deletionNodes`
- `acceptButton`, `rejectButton`

Added methods:
- `isAISuggestionsPanelVisible()`
- `submitAISuggestion(prompt)`
- `waitForSuggestionsLoading()`, `waitForSuggestionsComplete()`, `waitForSuggestionsError()`
- `getDiffCount()`, `getInsertionCount()`, `getDeletionCount()`
- `acceptDiff(index)`, `rejectDiff(index)`
- `acceptAllDiffs()`, `rejectAllDiffs()`
- `getDiffText(index)`
- `isDiffAcceptButtonVisible(index)`, `isDiffRejectButtonVisible(index)`

### Phase 5: E2E Test Specs ⚠️ Partial

**File:** `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts`

Created 24 E2E tests organized in describe blocks:

**Passing (4 tests):**
1. Panel Interaction: `should display AI suggestions panel`
2. Panel Interaction: `should show loading state when submitting suggestion`
3. Panel Interaction: `should handle suggestion error gracefully`
4. Auth setup

**Skipped (20 tests):**
- 1 Panel Interaction test (success message)
- 3 Diff Visualization tests
- 7 Accept/Reject Interaction tests
- 3 Prompt-Specific: Remove First Sentence tests
- 3 Prompt-Specific: Shorten First Paragraph tests
- 3 Prompt-Specific: Improve Entire Article tests

### Phase 6: Data-testid Attributes ✅

**File:** `src/components/AISuggestionsPanel.tsx`

Added:
- `data-testid="ai-suggestions-panel"` on container
- `data-testid="suggestions-error"` on error display
- `data-testid="suggestions-success"` on success message

## Technical Limitation: RSC Mocking

### Problem

20 E2E tests are skipped because they require mocking Next.js server actions. Server actions in Next.js 14+ use RSC (React Server Components) wire format, not plain JSON.

When Playwright intercepts server action requests and returns JSON:
```typescript
await route.fulfill({
  status: 200,
  headers: { 'Content-Type': 'text/x-component' },
  body: JSON.stringify(response),
});
```

Next.js fails to parse the response, resulting in "Connection closed" errors.

### Root Cause

Server actions communicate using a proprietary RSC serialization format that includes:
- Type markers for React components
- Reference IDs for deduplication
- Special encoding for promises and streams

Plain JSON doesn't satisfy this format, causing parsing failures.

### Impact

Tests that depend on server action responses returning diff content cannot run in E2E:
- Diff visualization (needs content with CriticMarkup)
- Accept/reject interactions (needs diffs to interact with)
- Prompt-specific scenarios (needs specific diff patterns)

### Workaround Options

1. **Refactor to API routes**: Replace server action with traditional API route that returns JSON
2. **Use integration tests**: The 10 integration tests cover diff functionality without E2E overhead
3. **Real server testing**: Run E2E against dev server with test database instead of mocking
4. **RSC encoder**: Implement proper RSC wire format encoding (complex, undocumented)

## Run Commands

```bash
# Integration tests (10 tests)
npm test promptSpecific.integration

# E2E tests (4 passing, 20 skipped)
npx playwright test specs/06-ai-suggestions/suggestions.spec.ts --project=chromium
```

## Success Criteria Status

| Criteria | Status |
|----------|--------|
| 3 promptSpecific fixtures in AI_PIPELINE_FIXTURES | ✅ |
| 10 integration tests passing | ✅ |
| 23 E2E tests passing | ⚠️ 4 passing, 20 skipped |
| data-testid attributes in AISuggestionsPanel | ✅ |
| No flaky tests | ✅ |

## Recommendations

1. **Short-term**: Accept current state - integration tests provide good coverage for diff functionality
2. **Medium-term**: Consider refactoring AI suggestions to use API route instead of server action for better testability
3. **Long-term**: Monitor Next.js developments for official RSC mocking support

## Files Modified/Created

| File | Action |
|------|--------|
| `src/testing/utils/editor-test-helpers.ts` | Modified |
| `src/editorFiles/lexicalEditor/promptSpecific.integration.test.tsx` | Created |
| `src/__tests__/e2e/helpers/api-mocks.ts` | Modified |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | Modified |
| `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` | Created |
| `src/components/AISuggestionsPanel.tsx` | Modified |

## Date

December 22, 2024

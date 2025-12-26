# Plan: Systematic Testing for AI Suggestions Panel

## Problem Statement
"Delete the first sentence" command in AI suggestion panel does nothing. Need to:
1. Debug and fix the current issue
2. Add comprehensive test coverage (E2E, integration, golden tests)
3. Fix existing skipped E2E tests

---

## Critical Insight: Why Proposed Tests Won't Catch This Bug

### The Testing Gap
All proposed tests (E2E, integration, golden) use **mocked AI responses**. They assume the AI returns valid edits. But the bug is likely in the **real AI interaction**:

| Test Type | What It Tests | Why It Misses The Bug |
|-----------|---------------|----------------------|
| Unit tests | Schema validation, prompts | Don't test actual LLM output |
| Integration tests | Pipeline step handoffs | Use mocked LLM responses |
| E2E tests | UI with mocked API | Mock returns known-good CriticMarkup |
| Golden tests | Fixture verification | Fixtures are manually crafted |

### The Real Problem (Hypothesis)
1. **LLM doesn't understand "delete first sentence"** - returns no edits or wrong format
2. **Step 3 AST diff finds no changes** - original and edited content identical
3. **CriticMarkup is empty** - nothing to render in editor

### What Would Actually Catch This
```
Real LLM Integration Test (expensive, flaky):
1. Send actual content + "delete first sentence" to real OpenAI
2. Verify response contains deletion edits
3. Verify Step 3 produces {--...--} markup
```

This is impractical for CI, so **debugging first is the right approach**.

---

## Part 1: Debug "Delete First Sentence" Issue (PRIORITY)

### Likely Root Cause
The `onContentChange` handler in `results/page.tsx:1355-1371` calls `editorRef.current.setContentFromMarkdown(newContent)` directly, which should work. The issue is likely:

1. **Pipeline not returning CriticMarkup** - Step 3 (`RenderCriticMarkupFromMDAstDiff`) may not detect the change
2. **LLM not following instructions** - Step 1 may not produce valid edit for "delete first sentence"
3. **Editor not rendering CriticMarkup** - `setContentFromMarkdown` may not parse `{--...--}` markers

### Debug Steps
1. Open browser console, submit "delete the first sentence"
2. Look for these logs:
   - `PIPELINE STEP 1 RESULT` - Check if AI generated valid edits
   - `PIPELINE STEP 3 RESULT` - Check if CriticMarkup contains `{--`
   - `onContentChange called` - Check if content has CriticMarkup
3. If no CriticMarkup in step 3, issue is in AST diff (identical ASTs)
4. If CriticMarkup exists but editor doesn't show it, issue is in Lexical import

### Files to Check
- `src/editorFiles/aiSuggestion.ts:214-227` - Step 1 output logging
- `src/editorFiles/aiSuggestion.ts:299-307` - Step 3 CriticMarkup generation
- `src/editorFiles/lexicalEditor/importExportUtils.ts` - `setContentFromMarkdown` implementation

---

## Part 2: New E2E Tests

### File: `src/__tests__/e2e/specs/06-ai-suggestions/editor-integration.spec.ts` (NEW)

Tests that verify prompt → editor change end-to-end:

```
1. Delete first sentence - shows deletion diff in editor
2. Delete first sentence - accept removes sentence
3. Delete first sentence - reject keeps sentence
4. Shorten paragraph - shows both deletion and insertion
5. Add paragraph - shows insertion diff
6. Error recovery - panel shows error, editor unchanged
```

### Pattern
- Load from library (no SSE) → mock `/api/runAISuggestionsPipeline` → verify editor DOM has diff nodes

### Helper Functions Needed (add to `suggestions-test-helpers.ts`)
```typescript
waitForDiffNodes(page)      // Wait for [data-diff-type] elements
getDeletionDiffs(page)      // Get all deletion diff elements
getInsertionDiffs(page)     // Get all insertion diff elements
verifyDiffContent(el, text) // Check diff contains expected text
```

---

## Part 3: New Integration Tests

### File: `src/editorFiles/aiSuggestion.pipeline.test.ts` (NEW)

Tests pipeline step handoffs with mocked LLM:

```
1. Step 1→2: generateAISuggestions output is valid for applyAISuggestions
2. Step 2→3: Applied edits produce valid markdown for AST diff
3. Step 3→4: CriticMarkup is valid for preprocessCriticMarkup
4. Step 4→Editor: Preprocessed content imports into Lexical correctly
```

### Mock Strategy
- Mock `generateAISuggestionsAction` to return known fixture data
- Mock `applyAISuggestionsAction` to return known edited markdown
- Use real `RenderCriticMarkupFromMDAstDiff` and `preprocessCriticMarkup`

---

## Part 4: Golden/Snapshot Tests

### File: `src/editorFiles/aiSuggestion.golden.test.ts` (NEW)

Use existing `AI_PIPELINE_FIXTURES` from `src/testing/utils/editor-test-helpers.ts`:

```
For each fixture in AI_PIPELINE_FIXTURES:
1. Step 3 output matches golden (snapshot)
2. Step 4 output matches golden (snapshot)
3. Diff node count matches expected
4. Accept all produces expected content (snapshot)
5. Reject all produces expected content (snapshot)
```

### Fixtures Available (30 cases)
- Insertions: singleWord, multiWord, sentence, paragraph, withFormatting
- Deletions: singleWord, sentence, paragraph
- Updates: singleWord, phrase, sentence
- Mixed: multiParagraph, complexDocument
- Prompt-specific: removeFirstSentence, shortenParagraph, improveArticle

---

## Part 5: Fix Flaky SSE Tests

### Current Issue
`mockReturnExplanationAPI` uses `route.fulfill()` which delivers all SSE events at once. Playwright cannot truly stream.

### Strategy
1. **Keep existing workaround**: Tests load from library instead of SSE generation
2. **Update skipped tests**: Convert to library-loading pattern
3. **Add skip condition for CI**: `test.skip(process.env.CI === 'true', 'SSE flaky in CI')`

### Tests to Unskip in `suggestions.spec.ts`
- Line 42: `should display AI suggestions panel` → Convert to library loading pattern

---

## Implementation Order

### Phase 1: Debug (before tests)
1. [ ] Add debug logging to reproduce issue
2. [ ] Identify which pipeline step fails
3. [ ] Fix root cause

### Phase 2: E2E Tests
4. [ ] Create `editor-integration.spec.ts`
5. [ ] Add helper functions to `suggestions-test-helpers.ts`
6. [ ] Run E2E tests, verify they catch the bug (if not fixed)

### Phase 3: Integration Tests
7. [ ] Create `aiSuggestion.pipeline.test.ts`
8. [ ] Add pipeline step handoff tests
9. [ ] Run integration tests

### Phase 4: Golden Tests
10. [ ] Create `aiSuggestion.golden.test.ts`
11. [ ] Generate initial snapshots
12. [ ] Verify fixtures match actual behavior

### Phase 5: Fix Skipped Tests
13. [ ] Update skipped E2E tests to use library loading
14. [ ] Remove `test.skip()` annotations
15. [ ] Verify all tests pass

---

## Critical Files

| File | Purpose |
|------|---------|
| `src/app/results/page.tsx:1355-1381` | onContentChange handler |
| `src/editorFiles/aiSuggestion.ts` | Pipeline implementation |
| `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` | Existing E2E tests |
| `src/__tests__/e2e/helpers/suggestions-test-helpers.ts` | E2E helpers |
| `src/__tests__/e2e/helpers/api-mocks.ts` | Mock implementations |
| `src/testing/utils/editor-test-helpers.ts` | AI_PIPELINE_FIXTURES |
| `src/editorFiles/lexicalEditor/importExportUtils.ts` | CriticMarkup preprocessing |

---

## Part 6: User Interaction Edge Cases (NEW)

### File: `src/__tests__/e2e/specs/06-ai-suggestions/user-interactions.spec.ts`

Tests for real-world user behavior patterns:

```
1. User types while loading → submit disabled, typing blocked or queued
2. Rapid double-submit → second request ignored or queued
3. Navigate away mid-pipeline → cleanup, no orphan state
4. Close panel while loading → cancel request gracefully
5. Submit empty content after clearing editor → proper error message
6. Submit after accepting some diffs → works with modified content
```

---

## Part 7: State Management Edge Cases (NEW)

### File: `src/__tests__/e2e/specs/06-ai-suggestions/state-management.spec.ts`

Tests for undo/redo and multi-round workflows:

```
1. Undo after accept → restores diff UI
2. Redo after undo → re-applies accepted change
3. Accept all → undo → shows all diffs again
4. Reject all → undo → shows all diffs again
5. Mixed accept/reject → undo sequence works correctly
6. Multi-round: accept some → manual edit → suggest again → no CriticMarkup remnants
7. Reject all → immediate new suggestion → clean state
8. Partial accept → page refresh → only accepted changes persist
```

---

## Part 8: Error Recovery Edge Cases (NEW)

### File: `src/__tests__/e2e/specs/06-ai-suggestions/error-recovery.spec.ts`

Tests for graceful error handling:

```
1. API 429 (rate limit) → show "Please wait" message
2. API 500 → show generic error, allow retry
3. API timeout → show timeout error, allow retry
4. Network offline → show network error
5. Step 1 fails → original content preserved
6. Step 2 fails → original content preserved
7. Step 3 fails → original content preserved
8. Malformed API response → graceful error handling
9. Retry after error → works correctly
```

---

## Part 9: Content Boundary Tests (NEW)

### File: `src/__tests__/e2e/specs/06-ai-suggestions/content-boundaries.spec.ts`

Tests for edge case content:

```
1. Very long content (5k words) → handles or shows limit error
2. Very long content (10k+ words) → clear token limit message
3. Very long prompt (2k chars) → handles correctly
4. Content with frontmatter (YAML) → preserved
5. Content with HTML comments → preserved
6. Content with only whitespace → proper error
7. Content with only code blocks → suggestions work
8. Content with deeply nested lists → suggestions work
```

### New Fixtures Needed in `editor-test-helpers.ts`
- `longContentFixture` (5k words)
- `frontmatterFixture` (with YAML header)
- `htmlCommentFixture`
- `deepNestedListFixture` (5+ levels)

---

## Updated Implementation Order

### Phase 1: Debug (PRIORITY - before any tests)
1. [ ] Add debug logging to reproduce issue
2. [ ] Identify which pipeline step fails
3. [ ] Fix root cause

### Phase 2: Core E2E Tests
4. [ ] Create `editor-integration.spec.ts`
5. [ ] Add helper functions to `suggestions-test-helpers.ts`

### Phase 3: User Edge Case Tests (NEW)
6. [ ] Create `user-interactions.spec.ts`
7. [ ] Create `state-management.spec.ts`
8. [ ] Create `error-recovery.spec.ts`
9. [ ] Create `content-boundaries.spec.ts`

### Phase 4: Integration & Golden Tests
10. [ ] Create `aiSuggestion.pipeline.test.ts`
11. [ ] Create `aiSuggestion.golden.test.ts`
12. [ ] Add new fixtures to `editor-test-helpers.ts`

### Phase 5: Fix Skipped Tests
13. [ ] Update skipped E2E tests to use library loading
14. [ ] Remove `test.skip()` annotations
15. [ ] Verify all tests pass

---

## Success Criteria
- [ ] "Delete first sentence" works in production
- [ ] 6+ new E2E tests verify prompt→editor changes (Part 2)
- [ ] 6+ new E2E tests for user interactions (Part 6)
- [ ] 8+ new E2E tests for state management (Part 7)
- [ ] 9+ new E2E tests for error recovery (Part 8)
- [ ] 8+ new E2E tests for content boundaries (Part 9)
- [ ] 4+ new integration tests verify pipeline handoffs (Part 3)
- [ ] 30+ golden tests prevent regressions (Part 4)
- [ ] 0 skipped tests in AI suggestions suite

**Total new tests: ~70+** (expanded from original ~40)

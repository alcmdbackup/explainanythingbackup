# Testing and Logging Strategy for Lexical Editor Framework

## Problem Statement

The AI suggestion pipeline contains non-deterministic LLM calls that make debugging difficult. We need:
1. Systematic logging to trace issues through the pipeline
2. Testing strategies that bypass LLM calls entirely

---

## Pipeline Determinism Map

```
Step 1 (NON-DET) → Step 2 (NON-DET) → Step 3 (DETERMINISTIC) → Step 4 (DETERMINISTIC)
    LLM Call           LLM Call           Tree Diff             Preprocessing
```

| Step | Function | Deterministic | LLM | Testable in Isolation |
|------|----------|---------------|-----|----------------------|
| 1 | `generateAISuggestionsAction()` | NO | YES | Needs fixtures |
| 2 | `applyAISuggestionsAction()` | NO | YES | Needs fixtures |
| 3 | `RenderCriticMarkupFromMDAstDiff()` | YES | NO | Fully testable |
| 4 | `preprocessCriticMarkup()` | YES | NO | Fully testable |

---

## Testing Strategy: LLM-Free Testing

### Option A: Database Fixtures (Recommended)

Leverage existing `testing_edits_pipeline` table to save/load complete pipeline states:

```typescript
// Load a known-good session
const session = await loadAISuggestionSessionAction(sessionId);
// session.steps contains all 4 pipeline outputs

// Test Step 3 with saved inputs
const step2Output = session.steps.find(s => s.step === 'step2_applied_edits').content;
const result = RenderCriticMarkupFromMDAstDiff(originalAST, parseMarkdown(step2Output));
expect(result).toMatchSnapshot();
```

**To capture fixtures:**
1. Run pipeline via EditorTest page with real LLM
2. Note session_id from database
3. Reference that session_id in tests

### Option B: Static Fixtures in Code

Create fixture files for common scenarios:

```
src/testing/fixtures/
├── aiPipeline/
│   ├── simple-insertion.json      # Step 1 output
│   ├── paragraph-rewrite.json     # Step 1 output
│   ├── heading-change.json        # Step 1 output
│   └── ...
└── markdownDiff/
    ├── before-after-simple.md
    ├── before-after-complex.md
    └── ...
```

### Option C: Deterministic Pipeline Entry Points

Add function overloads that accept pre-computed intermediate results:

```typescript
// Current
runAISuggestionsPipeline(content, userId, prompt)

// New overload for testing
runAISuggestionsPipelineFromStep3(
  originalContent: string,
  editedContent: string,  // Skip Steps 1-2
  sessionId?: string
)
```

---

## Logging Strategy

### Current State

| Layer | Method | Gaps |
|-------|--------|------|
| Server | `server.log` (JSON) | No async buffering, no rotation |
| Client | `console.log` with emoji prefixes | No structure, no persistence |
| Pipeline | Database saves per step | Good - already captures intermediate state |

### Recommended Additions

#### 1. Pipeline Step Logging

Add structured logs at each pipeline boundary:

```typescript
// In aiSuggestion.ts
const pipelineLogger = createPipelineLogger(sessionId);

pipelineLogger.step('1_ai_suggestions', {
  inputLength: content.length,
  promptLength: userPrompt.length,
  outputMarkerCount: parsedOutput.parts.filter(p => p.type === 'edit_marker').length
});
```

#### 2. Lexical Editor State Logging

Track editor mutations for debugging:

```typescript
// In LexicalEditor.tsx
editor.registerMutationListener(DiffTagNodeInline, (mutations, { prevState, nextState }) => {
  for (const [key, type] of mutations) {
    editorLogger.mutation('DiffTagNodeInline', { key, type, tag: getNodeTag(key) });
  }
});
```

#### 3. CriticMarkup Transform Logging

Log transformer matches:

```typescript
// In importExportUtils.ts CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER
console.debug('CriticMarkup match:', {
  type: tag === '++' ? 'insertion' : tag === '--' ? 'deletion' : 'update',
  content: match[2].substring(0, 50),
  position: textNode.getIndexWithinParent()
});
```

---

## Test Categories for Lexical Components

### Category 1: Pure Function Tests (Already Strong)

Location: `markdownASTdiff.test.ts`, `importExportUtils.test.ts`

```typescript
describe('RenderCriticMarkupFromMDAstDiff', () => {
  it('marks single word insertion', () => {
    const before = 'The cat sat.';
    const after = 'The black cat sat.';
    const result = RenderCriticMarkupFromMDAstDiff(parse(before), parse(after));
    expect(result).toContain('{++black ++}');
  });
});
```

### Category 2: Editor Node Tests (Need Expansion)

Location: `DiffTagNode.test.ts`

**Gap:** Limited testing of node lifecycle within full editor context.

```typescript
// Proposed addition
describe('DiffTagNode in editor context', () => {
  it('accepts insertion by removing diff wrapper', async () => {
    const editor = createTestEditor();
    await setContent(editor, 'Hello {++world++}');

    const diffNode = findNode(editor, DiffTagNodeInline);
    diffNode.acceptChange();

    const text = await getEditorText(editor);
    expect(text).toBe('Hello world');
  });
});
```

### Category 3: Integration Tests (Need Fixtures)

```typescript
describe('AI Pipeline Integration', () => {
  it('processes known fixture end-to-end', async () => {
    const fixture = await loadFixture('simple-insertion');

    // Start from Step 2 output (bypass LLM)
    const step3Result = RenderCriticMarkupFromMDAstDiff(
      parse(fixture.original),
      parse(fixture.step2Output)
    );

    const step4Result = preprocessCriticMarkup(step3Result);

    // Verify editor can render
    const editor = createTestEditor();
    await setContent(editor, step4Result);

    const diffNodes = findNodes(editor, DiffTagNodeInline);
    expect(diffNodes.length).toBe(fixture.expectedDiffCount);
  });
});
```

---

## Implementation Plan

### Phase 1: Fixture Infrastructure
1. Create `src/testing/fixtures/aiPipeline/` directory
2. Export 5-10 known-good sessions from database as JSON fixtures
3. Add fixture loader utility: `loadPipelineFixture(name)`

### Phase 2: Deterministic Entry Points
1. Add `runAISuggestionsPipelineFromStep3()` function
2. Add `runAISuggestionsPipelineFromStep4()` function
3. Update EditorTest page to expose step-level testing

### Phase 3: Structured Logging
1. Create `PipelineLogger` class with step-aware logging
2. Add editor mutation logging (optional, debug-only)
3. Add log viewer to EditorTest page

### Phase 4: Test Expansion
1. Add editor context tests for accept/reject flows
2. Add snapshot tests for common diff patterns
3. Add regression test suite using fixtures

---

## File Locations Summary

| Purpose | Path |
|---------|------|
| Pipeline orchestration | `src/editorFiles/aiSuggestion.ts` |
| Step 1-2 actions | `src/editorFiles/actions/actions.ts` |
| Step 3 diff | `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` |
| Step 4 preprocess | `src/editorFiles/lexicalEditor/importExportUtils.ts` |
| Debug page | `src/app/(debug)/editorTest/page.tsx` |
| Pipeline DB service | `src/lib/services/testingPipeline.ts` |
| Existing tests | `*.test.ts` files colocated with source |

---

## Quick Wins

1. **Export 3 sessions now** - Pick diverse cases from EditorTest, save as JSON fixtures
2. **Add `--skip-llm` mode** - Check for `MOCK_PIPELINE_SESSION_ID` env var in aiSuggestion.ts
3. **Log step boundaries** - 4 console.log statements in runAISuggestionsPipeline()

---

## Open Questions

1. Should fixtures be stored in DB only, or committed as JSON files?
2. How much editor mutation logging is too much? (Performance impact)
3. Should we snapshot CriticMarkup output or just validate structure?

# Testing and Logging Strategy for Lexical Editor Framework

## Problem Statement

The AI suggestion pipeline contains non-deterministic LLM calls that make debugging difficult. We need:
1. Testing strategies that bypass LLM calls entirely
2. Comprehensive test coverage for all edit types
3. Integration tests for DiffTagNode accept/reject behavior (currently untested)

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

## Testing Strategy: Static JSON Fixtures

### Approach

Use static JSON fixture files committed to version control. This provides:
- Portability across environments (no DB dependency in tests)
- Version control tracking of fixture changes
- CI-friendly execution
- Explicit expected values (not snapshots)

### Fixture Directory Structure

```
src/testing/fixtures/
└── aiPipeline/
    ├── index.ts                    # Fixture loader utility
    ├── types.ts                    # Fixture type definitions
    └── cases/
        ├── insertions/
        │   ├── single-word.json
        │   ├── multi-word.json
        │   ├── sentence.json
        │   ├── paragraph.json
        │   └── with-formatting.json
        ├── deletions/
        │   ├── single-word.json
        │   ├── sentence.json
        │   └── paragraph.json
        ├── updates/
        │   ├── word-replacement.json
        │   ├── sentence-rewrite.json
        │   └── paragraph-rewrite.json
        ├── mixed/
        │   ├── insert-and-delete.json
        │   ├── multiple-updates.json
        │   └── complex-restructure.json
        └── edge-cases/
            ├── heading-changes.json
            ├── list-modifications.json
            ├── code-block-edits.json
            ├── multiline-in-single-diff.json
            ├── nested-formatting.json
            ├── table-row-add.json
            ├── table-cell-edit.json
            ├── unicode-content.json
            ├── link-in-diff.json
            ├── image-in-diff.json
            ├── adjacent-diffs.json
            ├── whitespace-only.json
            ├── escaped-chars.json
            ├── empty-paragraph.json
            ├── inline-code-diff.json
            └── long-content.json
```

### Fixture Type Definition

```typescript
// src/testing/fixtures/aiPipeline/types.ts
interface PipelineFixture {
  name: string;
  description: string;
  category: 'insertion' | 'deletion' | 'update' | 'mixed' | 'edge-case';

  // Inputs
  originalMarkdown: string;
  editedMarkdown: string;      // Step 2 output (simulated LLM result)

  // Expected outputs
  expectedStep3Output: string; // CriticMarkup from diff
  expectedStep4Output: string; // Preprocessed CriticMarkup

  // Validation metadata
  expectedDiffNodeCount: number;
  expectedDiffTypes: ('ins' | 'del' | 'update')[];
}
```

### Fixture Loader

```typescript
// src/testing/fixtures/aiPipeline/index.ts
export async function loadFixture(path: string): Promise<PipelineFixture>
export async function loadAllFixtures(): Promise<PipelineFixture[]>
export async function loadFixturesByCategory(category: string): Promise<PipelineFixture[]>
```

---

## Comprehensive Test Cases (30 total)

### Insertions (5 cases)

| Case | Original | Edited | Expected CriticMarkup |
|------|----------|--------|----------------------|
| single-word | "The cat sat." | "The black cat sat." | "The {++black ++}cat sat." |
| multi-word | "Hello world." | "Hello beautiful world." | "Hello {++beautiful ++}world." |
| sentence | "First." | "First. Second." | "First.{++ Second.++}" |
| paragraph | "Para 1." | "Para 1.\n\nPara 2." | "Para 1.\n\n{++Para 2.++}" |
| with-formatting | "Text." | "Text **bold**." | "Text{++ **bold**++}." |

### Deletions (3 cases)

| Case | Original | Edited | Expected CriticMarkup |
|------|----------|--------|----------------------|
| single-word | "The black cat sat." | "The cat sat." | "The {--black --}cat sat." |
| sentence | "First. Second." | "First." | "First.{-- Second.--}" |
| paragraph | "Para 1.\n\nPara 2." | "Para 1." | "Para 1.\n\n{--Para 2.--}" |

### Updates (3 cases)

| Case | Original | Edited | Expected CriticMarkup |
|------|----------|--------|----------------------|
| word-replacement | "The cat sat." | "The dog sat." | "The {~~cat~>dog~~} sat." |
| sentence-rewrite | "It was good." | "It was excellent." | "{~~It was good.~>It was excellent.~~}" |
| paragraph-rewrite | Complex paragraph | Rewritten version | Atomic update marker |

### Mixed (3 cases)

- insert-and-delete: Multiple operations in one document
- multiple-updates: Several word replacements
- complex-restructure: Paragraph reordering

### Edge Cases (16 cases)

| Case | Description |
|------|-------------|
| heading-changes | `# Title` → `## Title` |
| list-modifications | Add/remove list items |
| code-block-edits | Changes inside code blocks |
| multiline-in-single-diff | `{++line1\nline2++}` |
| nested-formatting | `{++**bold** and *italic*++}` |
| table-row-add | Add row to markdown table |
| table-cell-edit | Modify cell content in table |
| unicode-content | Emoji and unicode in diffs `{++🎉++}` |
| link-in-diff | `{++[link](url)++}` |
| image-in-diff | `{++![alt](img.png)++}` |
| adjacent-diffs | Insertion immediately after deletion |
| whitespace-only | Only whitespace changes |
| escaped-chars | Backticks, brackets inside diff |
| empty-paragraph | Add/remove empty paragraphs |
| inline-code-diff | `` {++`code`++} `` |
| long-content | 500+ word paragraph (stress test) |

---

## Test File Structure

```
src/editorFiles/markdownASTdiff/__tests__/
├── markdownASTdiff.test.ts           # Existing
└── markdownASTdiff.fixtures.test.ts  # New - fixture-based tests

src/editorFiles/lexicalEditor/__tests__/
├── importExportUtils.test.ts              # Existing
├── preprocessing.fixtures.test.ts         # New - fixture-based tests
└── DiffTagAcceptReject.integration.test.tsx  # New - accept/reject tests
```

### Test Execution Pattern

```typescript
describe('Pipeline Fixtures', () => {
  const fixtures = loadAllFixtures();

  describe.each(fixtures)('$name', (fixture) => {
    it('Step 3: generates correct CriticMarkup', () => {
      const result = RenderCriticMarkupFromMDAstDiff(
        parseMarkdown(fixture.originalMarkdown),
        parseMarkdown(fixture.editedMarkdown)
      );
      expect(result).toBe(fixture.expectedStep3Output);
    });

    it('Step 4: preprocesses correctly', () => {
      const result = preprocessCriticMarkup(fixture.expectedStep3Output);
      expect(result).toBe(fixture.expectedStep4Output);
    });
  });
});
```

---

## Accept/Reject Integration Tests (12 total)

### Current Gap

Existing tests verify UI rendering but NOT the actual editor mutations:
- `DiffTagNode.test.ts` - Node creation, serialization, export
- `DiffTagHoverPlugin.test.tsx` - Mutation detection, mock handlers
- `DiffTagHoverControls.test.tsx` - Positioning, visibility
- `DiffTagInlineControls.test.tsx` - Portal rendering, buttons

**Missing:** Integration tests that verify `handleAccept()` and `handleReject()` actually mutate the editor state correctly.

### Test Cases

| Tag | Action | Verify |
|-----|--------|--------|
| ins | accept | Children unwrapped, diff tag removed |
| ins | reject | Entire node removed |
| del | accept | Entire node removed |
| del | reject | Children unwrapped, diff tag removed |
| update | accept | 2nd child (after) promoted, diff tag removed |
| update | reject | 1st child (before) promoted, diff tag removed |
| update | accept w/ container | DiffUpdateContainerInline properly unwrapped |
| update | reject w/ container | DiffUpdateContainerInline properly unwrapped |
| multi-child | accept ins | Multiple children all unwrapped |
| sequence | accept then accept | Two operations in sequence work |
| edge | empty diff node | Handles gracefully |
| edge | missing node key | No crash, fails gracefully |

### Test Pattern

```typescript
import { createTestEditor, editorUpdate } from '../testUtils';

describe('DiffTag Accept/Reject Integration', () => {
  it('ins accept: unwraps children, removes diff tag', async () => {
    const editor = createTestEditor();

    // Setup: create DiffTagNodeInline with "ins" tag containing text
    await editorUpdate(editor, () => {
      const ins = $createDiffTagNodeInline('ins');
      ins.append($createTextNode('inserted text'));
      $getRoot().getFirstChild().append(ins);
    });

    // Get node key from editor state
    let nodeKey: string;
    editor.getEditorState().read(() => {
      // ... get the diff node key
    });

    // Execute accept
    handleAccept(editor, nodeKey);

    // Verify: text remains, diff tag gone
    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChild();
      const children = paragraph.getChildren();
      expect(children.length).toBe(1);
      expect($isTextNode(children[0])).toBe(true);
      expect(children[0].getTextContent()).toBe('inserted text');
    });
  });
});
```

---

## Logging Strategy

### Current State (Sufficient)

The codebase already has comprehensive logging infrastructure:

| Component | File | Purpose |
|-----------|------|---------|
| Request ID Context | `src/lib/requestIdContext.ts` | AsyncLocalStorage-based context isolation |
| Server Request ID | `src/lib/serverReadRequestId.ts` | Extracts `__requestId` from payloads |
| Client Request ID | `src/hooks/clientPassRequestId.ts` | Generates client-side request IDs |
| Server Logger | `src/lib/server_utilities.ts` | Auto-includes requestId in all logs |
| Function Wrappers | `src/lib/logging/server/automaticServerLoggingBase.ts` | `withLogging()`, `withTracing()` |
| Pipeline DB | `src/lib/services/testingPipeline.ts` | Saves all 4 pipeline steps |

### No Additional Logging Needed

- Request ID propagation already works client → server
- All logs automatically include `requestId` and `userId`
- Pipeline steps are saved to database via `testing_edits_pipeline` table
- EditorTest page provides comprehensive debugging UI

---

## Fixture Capture: EditorTest Export Button

### Add "Export as Fixture" to EditorTest page

When a successful pipeline run completes:
1. Show "Export as Fixture" button
2. Click copies JSON to clipboard:

```json
{
  "name": "",
  "description": "",
  "category": "",
  "originalMarkdown": "...",
  "editedMarkdown": "...",
  "expectedStep3Output": "...",
  "expectedStep4Output": "...",
  "expectedDiffNodeCount": 0,
  "expectedDiffTypes": []
}
```

3. User pastes into appropriate fixture file

---

## Implementation Plan

### Phase 1: Fixture Infrastructure
1. Create `src/testing/fixtures/aiPipeline/types.ts`
2. Create `src/testing/fixtures/aiPipeline/index.ts`
3. Create directory structure for cases

### Phase 2: Initial Fixtures
1. Write 5 initial fixtures by hand (one per category)
2. Verify fixture format is correct

### Phase 3: Pipeline Test Files
1. Create `markdownASTdiff.fixtures.test.ts`
2. Create `preprocessing.fixtures.test.ts`
3. Run tests, verify they pass

### Phase 4: Remaining Fixtures
1. Write remaining 25 fixtures by hand
2. Run through Step 3-4 code to generate expected outputs
3. Manually verify outputs are correct
4. Run full test suite

### Phase 5: Accept/Reject Integration Tests
1. Create `DiffTagAcceptReject.integration.test.tsx`
2. Implement 12 test cases for accept/reject behavior
3. Verify all tests pass

### Phase 6: Fixture Capture Tool
1. Add "Export as Fixture" button to EditorTest page
2. Enable capturing future regression fixtures from real runs

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/testing/fixtures/aiPipeline/types.ts` |
| Create | `src/testing/fixtures/aiPipeline/index.ts` |
| Create | `src/testing/fixtures/aiPipeline/cases/*.json` (30 files) |
| Create | `src/editorFiles/markdownASTdiff/__tests__/markdownASTdiff.fixtures.test.ts` |
| Create | `src/editorFiles/lexicalEditor/__tests__/preprocessing.fixtures.test.ts` |
| Create | `src/editorFiles/lexicalEditor/__tests__/DiffTagAcceptReject.integration.test.tsx` |
| Modify | `src/app/(debug)/editorTest/page.tsx` (add export button) |

---

## Success Criteria

- [ ] All 30 fixture tests pass
- [ ] All 12 accept/reject integration tests pass
- [ ] Each test clearly reports pass/fail with fixture name
- [ ] Failed tests show diff between expected/actual
- [ ] Can run `npm test -- --grep "Pipeline Fixtures"` to run only fixture tests
- [ ] Can run `npm test -- --grep "Accept/Reject"` to run only integration tests
- [ ] EditorTest page can export new fixtures for regression testing

---

## Decisions Made

| Question | Decision | Rationale |
|----------|----------|-----------|
| Fixtures in DB vs JSON? | JSON | Versionable, portable, CI-friendly |
| Editor mutation logging? | Skip | Existing debug pages sufficient |
| Snapshot vs structure? | Structure | Explicit expected values, less brittle |
| Additional pipeline logging? | None | Existing request ID system covers needs |
| Test report format? | Console only | Standard Jest output, no extra infrastructure |
| Deterministic entry points? | Skip | Step 3-4 functions already standalone |
| LLM needed for fixtures? | No | Diff algorithm is deterministic; hand-craft inputs, run code once to get expected outputs |
| Test count? | 30 fixtures + 12 integration | Comprehensive coverage including edge cases and accept/reject |
| Accept/reject testing? | Yes | Currently untested; critical user-facing functionality |

---

## Generating Expected Outputs for Fixtures

For each fixture, follow this workflow:

1. **Write inputs by hand:**
   - `originalMarkdown`: The starting content
   - `editedMarkdown`: The simulated LLM-edited content

2. **Run through Step 3 code:**
   ```typescript
   const step3Result = RenderCriticMarkupFromMDAstDiff(
     parseMarkdown(originalMarkdown),
     parseMarkdown(editedMarkdown)
   );
   // → This becomes expectedStep3Output
   ```

3. **Run through Step 4 code:**
   ```typescript
   const step4Result = preprocessCriticMarkup(step3Result);
   // → This becomes expectedStep4Output
   ```

4. **Manually verify outputs are correct:**
   - Check CriticMarkup syntax is valid
   - Check diff markers match expected changes
   - Check preprocessing normalized multiline patterns

5. **Commit as golden fixture**

No LLM needed - the diff algorithm is deterministic.

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
| Request ID context | `src/lib/requestIdContext.ts` |
| Existing tests | `*.test.ts` files colocated with source |
| Fixture manager | `src/app/(debug)/fixtureManager/page.tsx` |

---

## Fixture Manager Page

**URL**: `/fixtureManager`

A debug page for creating and managing test fixtures.

### Features

1. **Existing Fixtures List** - Table showing all fixtures with name, category, actions (edit/delete/validate)
2. **Create/Edit Form**:
   - Name, description, category inputs
   - Two textareas: `originalMarkdown` and `editedMarkdown`
   - "Generate Expected Outputs" button - runs Step 3-4 deterministically
   - Display of `expectedStep3Output` and `expectedStep4Output`
   - "Save Fixture" button
3. **Validation Panel** - Run fixture through pipeline and compare actual vs expected

### Files to Create

| File | Purpose |
|------|---------|
| `src/testing/fixtures/aiPipeline/types.ts` | `PipelineFixture` interface |
| `src/testing/fixtures/aiPipeline/index.ts` | Fixture loader utilities |
| `src/testing/fixtures/aiPipeline/actions.ts` | Server actions for CRUD + generate |
| `src/app/(debug)/fixtureManager/page.tsx` | Fixture manager UI |

### Key Server Actions

```typescript
listFixturesAction()                    // List all fixtures
loadFixtureAction(path)                 // Load single fixture
saveFixtureAction(fixture)              // Save fixture to JSON
deleteFixtureAction(path)               // Delete fixture
generateExpectedOutputsAction(original, edited)  // Run Step 3-4
validateFixtureAction(fixture)          // Compare actual vs expected
```

### Workflow

1. Enter `originalMarkdown` and `editedMarkdown` in textareas
2. Click "Generate Expected Outputs" to run pipeline
3. Review generated `expectedStep3Output` and `expectedStep4Output`
4. Fill in name, description, category
5. Click "Save Fixture" to write JSON to `src/testing/fixtures/aiPipeline/cases/`

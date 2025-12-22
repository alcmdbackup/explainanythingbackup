# Testing and Logging Strategy for Lexical Editor Framework

## Revision History

| Date | Changes |
|------|---------|
| 2024-12 | **Major Revision**: Skip Fixture Manager UI (extend existing editor-test-helpers.ts instead); Add Phase 7E React component tests (5 components, ~45 tests); Updated test counts (119 new → 297 total) |
| Original | Initial plan with Fixture Manager UI page |

---

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

## Testing Strategy: Inline Fixtures (Revised 2024-12)

> **Decision**: Use inline TypeScript fixtures in `editor-test-helpers.ts` instead of separate JSON files. This leverages existing infrastructure and is simpler to maintain.

### Approach

Extend existing `src/testing/utils/editor-test-helpers.ts` with pipeline fixtures:
- Inline TypeScript objects (type-safe, IDE autocomplete)
- Colocated with existing `MARKDOWN_FIXTURES`
- No file I/O needed in tests
- CI-friendly execution
- Explicit expected values (not snapshots)

### Fixture Structure (in editor-test-helpers.ts)

```typescript
export interface PipelineFixture {
  name: string;
  description: string;
  category: 'insertion' | 'deletion' | 'update' | 'mixed' | 'edge-case';
  originalMarkdown: string;
  editedMarkdown: string;
  expectedStep3Output: string;
  expectedStep4Output: string;
  expectedDiffNodeCount: number;
  expectedDiffTypes: ('ins' | 'del' | 'update')[];
}

export const AI_PIPELINE_FIXTURES: Record<string, Record<string, PipelineFixture>> = {
  insertions: {
    singleWord: { /* ... */ },
    multiWord: { /* ... */ },
    sentence: { /* ... */ },
    paragraph: { /* ... */ },
    withFormatting: { /* ... */ },
  },
  deletions: { /* 3 cases */ },
  updates: { /* 3 cases */ },
  mixed: { /* 3 cases */ },
  edgeCases: { /* 16 cases */ },
};

// Helper to flatten for describe.each()
export function getAllPipelineFixtures(): PipelineFixture[] {
  return Object.values(AI_PIPELINE_FIXTURES)
    .flatMap(category => Object.values(category));
}
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
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { RenderCriticMarkupFromMDAstDiff } from '../markdownASTdiff';
import { preprocessCriticMarkup } from '../lexicalEditor/importExportUtils';
import { loadAllFixtures } from '@/testing/fixtures/aiPipeline';

// Parse markdown to AST (same pattern as aiSuggestion.ts:207-208)
function parseMarkdown(markdown: string) {
  return unified().use(remarkParse).parse(markdown);
}

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

## Accept/Reject Integration Tests (14 total)

### Current Gap

Existing tests verify UI rendering but NOT the actual editor mutations:
- `DiffTagNode.test.ts` - Node creation, serialization, export
- `DiffTagHoverPlugin.test.tsx` - Mutation detection, mock handlers
- `DiffTagHoverControls.test.tsx` - Positioning, visibility
- `DiffTagInlineControls.test.tsx` - Portal rendering, buttons

**Missing:** Integration tests that verify `handleAccept()` and `handleReject()` actually mutate the editor state correctly.

### Prerequisite: Extract Accept/Reject Logic

The `handleAccept` and `handleReject` functions are currently defined as `useCallback` hooks inside `DiffTagHoverPlugin.tsx` (lines 61-133). They cannot be imported for testing.

**Solution:** Extract to a separate testable module:

```typescript
// src/editorFiles/lexicalEditor/diffTagMutations.ts
import { LexicalEditor, $getNodeByKey } from 'lexical';
import { $isDiffTagNodeInline, $isDiffTagNodeBlock, $isDiffUpdateContainerInline } from './DiffTagNode';

export function acceptDiffTag(editor: LexicalEditor, nodeKey: string): void {
  editor.update(() => {
    const node = $getNodeByKey(nodeKey);
    if ($isDiffTagNodeInline(node) || $isDiffTagNodeBlock(node)) {
      const tag = node.__tag;
      if (tag === 'ins') {
        const children = node.getChildren();
        children.forEach(child => node.insertBefore(child));
        node.remove();
      } else if (tag === 'del') {
        node.remove();
      } else if (tag === 'update') {
        const children = node.getChildren();
        if (children.length >= 2) {
          const afterContent = children[1];
          if ($isDiffUpdateContainerInline(afterContent)) {
            afterContent.getChildren().forEach(child => node.insertBefore(child));
          } else {
            node.insertBefore(afterContent);
          }
        }
        node.remove();
      }
    }
  });
}

export function rejectDiffTag(editor: LexicalEditor, nodeKey: string): void {
  // Similar logic with inverted behavior
}
```

Then update `DiffTagHoverPlugin.tsx` to import and use these functions.

### Test Cases

| Tag | Action | Verify |
|-----|--------|--------|
| ins (inline) | accept | Children unwrapped, diff tag removed |
| ins (inline) | reject | Entire node removed |
| del (inline) | accept | Entire node removed |
| del (inline) | reject | Children unwrapped, diff tag removed |
| update (inline) | accept | 2nd child (after) promoted, diff tag removed |
| update (inline) | reject | 1st child (before) promoted, diff tag removed |
| update | accept w/ container | DiffUpdateContainerInline properly unwrapped |
| update | reject w/ container | DiffUpdateContainerInline properly unwrapped |
| multi-child | accept ins | Multiple children all unwrapped |
| sequence | accept then accept | Two operations in sequence work |
| **block (heading)** | **accept** | **DiffTagNodeBlock with heading unwrapped correctly** |
| **block (heading)** | **reject** | **DiffTagNodeBlock with heading removed correctly** |
| edge | empty diff node | Handles gracefully |
| edge | missing node key | No crash, fails gracefully |

### Test Pattern

```typescript
import { createEditor, $getRoot, $createTextNode } from 'lexical';
import { HeadingNode } from '@lexical/rich-text';
import { acceptDiffTag, rejectDiffTag } from '../diffTagMutations';
import { $createDiffTagNodeInline, DiffTagNodeInline, DiffTagNodeBlock, DiffUpdateContainerInline } from '../DiffTagNode';

function createTestEditor() {
  return createEditor({
    nodes: [HeadingNode, DiffTagNodeInline, DiffTagNodeBlock, DiffUpdateContainerInline],
    onError: (error) => { throw error; },
  });
}

async function editorUpdate<T>(editor: LexicalEditor, fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    editor.update(() => {
      try { resolve(fn()); }
      catch (error) { reject(error); }
    }, { discrete: true });
  });
}

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

    // Execute accept using extracted function
    acceptDiffTag(editor, nodeKey);

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

## Phase 7E: React Component Tests (Added 2024-12)

### Current Gap

These 5 React components have **0 tests**:
- `DiffTagHoverPlugin.tsx`
- `DiffTagHoverControls.tsx`
- `DiffTagInlineControls.tsx`
- `ToolbarPlugin.tsx`
- `LexicalEditor.tsx`

### Test Coverage Plan

#### DiffTagHoverPlugin.integration.test.tsx (~10 tests)
| Test | Description |
|------|-------------|
| Registers mutation listeners | Verifies `registerMutationListener` called for DiffTagNodeInline/Block |
| Scans DOM for data-diff-key | After node creation, finds elements with `data-diff-key` attribute |
| Calls accept handler | When accept triggered, verifies handler called with correct nodeKey |
| Calls reject handler | When reject triggered, verifies handler called with correct nodeKey |
| Cleans up on unmount | Verifies listeners removed on component unmount |
| Handles multiple diff nodes | Works correctly with 3+ diff nodes in document |
| Updates on node removal | Clears controls when diff node removed |
| Ignores non-diff mutations | Doesn't react to text node mutations |
| Handles rapid mutations | Debounces correctly with fast sequential changes |
| Works with block nodes | Correctly handles DiffTagNodeBlock mutations |

#### DiffTagHoverControls.test.tsx (~5 tests)
| Test | Description |
|------|-------------|
| Positions relative to target | Calculates correct position from target element bounds |
| Shows when visible=true | Renders controls when visibility prop true |
| Hides when visible=false | Does not render when visibility prop false |
| Accept button triggers callback | onClick calls onAccept prop |
| Reject button triggers callback | onClick calls onReject prop |

#### DiffTagInlineControls.test.tsx (~5 tests)
| Test | Description |
|------|-------------|
| Renders in portal | Uses createPortal to render outside editor DOM |
| Shows accept/reject buttons | Renders both action buttons |
| Buttons are keyboard accessible | Has correct ARIA attributes |
| Handles keyboard events | Enter/Space triggers action |
| Displays correct icons | Shows checkmark for accept, X for reject |

#### ToolbarPlugin.test.tsx (~15 tests)
| Test | Description |
|------|-------------|
| Block selector changes paragraph → h1 | Applies heading format |
| Block selector changes h1 → paragraph | Removes heading format |
| Bold button toggles format | FORMAT_TEXT_COMMAND with 'bold' |
| Italic button toggles format | FORMAT_TEXT_COMMAND with 'italic' |
| Underline button toggles format | FORMAT_TEXT_COMMAND with 'underline' |
| Strikethrough button toggles | FORMAT_TEXT_COMMAND with 'strikethrough' |
| Link button shows editor | Opens FloatingLinkEditor |
| Link input accepts URL | Applies link to selection |
| Link removal works | TOGGLE_LINK_COMMAND with null |
| Unordered list button | INSERT_UNORDERED_LIST_COMMAND |
| Ordered list button | INSERT_ORDERED_LIST_COMMAND |
| Quote button | Applies quote format |
| Code block button | Applies code format |
| Updates on selection change | Toolbar state reflects selection format |
| Disabled when read-only | Buttons disabled in display mode |

#### LexicalEditor.integration.test.tsx (~10 tests)
| Test | Description |
|------|-------------|
| setContentFromMarkdown() | Imports markdown and renders correctly |
| getContentAsMarkdown() | Exports current content to markdown |
| toggleMarkdownMode() | Switches between rich text and raw markdown |
| setEditMode(true) | Enables editing, toolbar visible |
| setEditMode(false) | Disables editing, toolbar hidden |
| applyLinkOverlay() | Wraps matching terms in StandaloneTitleLinkNode |
| focus() | Focuses editor element |
| Handles CriticMarkup import | {++text++} renders as DiffTagNodeInline |
| ContentChangePlugin fires | onChange callback triggered on edit |
| Preserves formatting on round-trip | Bold/italic survives export→import |

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

## Implementation Plan (Revised 2024-12)

> **Decision**: Extend existing fixture patterns in `editor-test-helpers.ts` instead of building a UI-based Fixture Manager. This is simpler and leverages existing infrastructure.

### Phase 1: Extract Accept/Reject Logic (Prerequisite)
1. **Extract accept/reject logic to `src/editorFiles/lexicalEditor/diffTagMutations.ts`**
2. Update `DiffTagHoverPlugin.tsx` to import from `diffTagMutations.ts`

### Phase 2: Extend Existing Fixture Infrastructure
1. Add `AI_PIPELINE_FIXTURES` to `src/testing/utils/editor-test-helpers.ts`
2. Create fixture type definitions inline (no separate types.ts needed)
3. Add fixture loader helpers to editor-test-helpers.ts

### Phase 3: Pipeline Fixture Tests
1. Create `markdownASTdiff.fixtures.test.ts`
2. Create `preprocessing.fixtures.test.ts`
3. Run tests, verify they pass with initial fixtures

### Phase 4: Accept/Reject Integration Tests
1. Create `DiffTagAcceptReject.integration.test.tsx`
2. Implement 14 test cases (12 inline + 2 block) for accept/reject behavior
3. Verify all tests pass

### Phase 5: Phase 7E React Component Tests
1. Create `DiffTagHoverPlugin.integration.test.tsx` (~10 tests)
2. Create `DiffTagHoverControls.test.tsx` (~5 tests)
3. Create `DiffTagInlineControls.test.tsx` (~5 tests)
4. Create `ToolbarPlugin.test.tsx` (~15 tests)
5. Create `LexicalEditor.integration.test.tsx` (~10 tests)

### Phase 6: EditorTest Export Button (Optional)
1. Add "Export as Fixture" button to EditorTest page
2. Enable capturing future regression fixtures from real pipeline runs

---

## Files to Create/Modify (Revised)

| Action | File |
|--------|------|
| Create | `src/editorFiles/lexicalEditor/diffTagMutations.ts` (extracted accept/reject logic) |
| Modify | `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx` (import from diffTagMutations.ts) |
| Extend | `src/testing/utils/editor-test-helpers.ts` (add AI_PIPELINE_FIXTURES) |
| Create | `src/editorFiles/markdownASTdiff/__tests__/markdownASTdiff.fixtures.test.ts` |
| Create | `src/editorFiles/lexicalEditor/__tests__/preprocessing.fixtures.test.ts` |
| Create | `src/editorFiles/lexicalEditor/__tests__/DiffTagAcceptReject.integration.test.tsx` |
| Create | `src/editorFiles/lexicalEditor/__tests__/DiffTagHoverPlugin.integration.test.tsx` |
| Create | `src/editorFiles/lexicalEditor/__tests__/DiffTagHoverControls.test.tsx` |
| Create | `src/editorFiles/lexicalEditor/__tests__/DiffTagInlineControls.test.tsx` |
| Create | `src/editorFiles/lexicalEditor/__tests__/ToolbarPlugin.test.tsx` |
| Create | `src/editorFiles/lexicalEditor/__tests__/LexicalEditor.integration.test.tsx` |
| Modify | `src/app/(debug)/editorTest/page.tsx` (add export button - optional) |

### Removed from Original Plan (Superseded)
- ~~`src/testing/fixtures/aiPipeline/types.ts`~~ (inline in editor-test-helpers.ts)
- ~~`src/testing/fixtures/aiPipeline/index.ts`~~ (inline in editor-test-helpers.ts)
- ~~`src/testing/fixtures/aiPipeline/actions.ts`~~ (no UI manager needed)
- ~~`src/testing/fixtures/aiPipeline/cases/*.json`~~ (fixtures in editor-test-helpers.ts)
- ~~`src/app/(debug)/fixtureManager/page.tsx`~~ (no UI manager needed)

---

## Success Criteria (Revised)

- [ ] All 60 pipeline fixture tests pass (30 cases × 2 steps each)
- [ ] All 14 accept/reject integration tests pass (12 inline + 2 block)
- [ ] All 45 Phase 7E React component tests pass
- [ ] Each test clearly reports pass/fail with fixture name
- [ ] Failed tests show diff between expected/actual
- [ ] Can run `npm test -- --grep "Pipeline Fixtures"` to run only fixture tests
- [ ] Can run `npm test -- --grep "Accept/Reject"` to run only integration tests
- [ ] EditorTest page can export new fixtures for regression testing (optional)

### Expected Test Counts

| Category | Tests |
|----------|-------|
| Pipeline fixtures (30 cases × 2 steps) | 60 |
| Accept/reject integration | 14 |
| DiffTagHoverPlugin | 10 |
| DiffTagHoverControls | 5 |
| DiffTagInlineControls | 5 |
| ToolbarPlugin | 15 |
| LexicalEditor | 10 |
| **Total New Tests** | **~119** |

Combined with existing 178 tests = **~297 total tests**

---

## Decisions Made (Updated 2024-12)

| Question | Decision | Rationale |
|----------|----------|-----------|
| Fixtures in DB vs JSON? | Inline in editor-test-helpers.ts | Simpler than JSON files; leverages existing infrastructure |
| Editor mutation logging? | Skip | Existing debug pages sufficient |
| Snapshot vs structure? | Structure | Explicit expected values, less brittle |
| Additional pipeline logging? | None | Existing request ID system covers needs |
| Test report format? | Console only | Standard Jest output, no extra infrastructure |
| Deterministic entry points? | Skip | Step 3-4 functions already standalone |
| LLM needed for fixtures? | No | Diff algorithm is deterministic |
| Test count? | 60 fixtures + 14 integration + 45 component | Comprehensive coverage |
| Accept/reject testing? | Yes | Currently untested; critical user-facing functionality |
| Accept/reject testability? | Extract to module | `handleAccept`/`handleReject` are `useCallback` hooks; extract to `diffTagMutations.ts` |
| Block-level testing? | Yes (2 tests) | `DiffTagNodeBlock` may behave differently than inline |
| **Fixture Manager UI?** | **Skip** | **Existing editor-test-helpers.ts patterns sufficient; UI is overkill** |
| **Phase 7E React tests?** | **Include** | **5 components have 0 tests; critical gap** |
| Phase ordering? | Extract logic first | diffTagMutations.ts is prerequisite for integration tests |

---

## Generating Expected Outputs for Fixtures

Generate expected outputs programmatically using the deterministic pipeline functions:

```typescript
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { RenderCriticMarkupFromMDAstDiff } from '@/editorFiles/markdownASTdiff/markdownASTdiff';
import { preprocessCriticMarkup } from '@/editorFiles/lexicalEditor/importExportUtils';

function generateFixtureOutputs(originalMarkdown: string, editedMarkdown: string) {
  // Step 3
  const beforeAST = unified().use(remarkParse).parse(originalMarkdown);
  const afterAST = unified().use(remarkParse).parse(editedMarkdown);
  const expectedStep3Output = RenderCriticMarkupFromMDAstDiff(beforeAST, afterAST);

  // Step 4
  const expectedStep4Output = preprocessCriticMarkup(expectedStep3Output);

  return { expectedStep3Output, expectedStep4Output };
}
```

**Workflow:**
1. Define `originalMarkdown` and `editedMarkdown` in fixture
2. Run the generation function to get expected outputs
3. Add to `AI_PIPELINE_FIXTURES` in `editor-test-helpers.ts`

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
| **Existing fixtures** | `src/testing/utils/editor-test-helpers.ts` |

---

## Existing Test Infrastructure

> **Note**: Significant fixture infrastructure already exists. The plan extends this rather than creating parallel systems.

### Current Test Coverage (178 tests)

| File | Tests | Coverage |
|------|-------|----------|
| `DiffTagNode.test.ts` | 63 | Node creation, cloning, serialization, export, DOM |
| `importExportUtils.test.ts` | 52 | Transformers, preprocessing, export, cleanup |
| `markdownASTdiff.test.ts` | 63 | Tokenization, similarity, multi-pass, edge cases |

### Existing Fixture Utilities (`editor-test-helpers.ts`)

**Mock AST Node Factories:**
- `createMockTextNode()`, `createMockParagraph()`, `createMockHeading()`
- `createMockCodeBlock()`, `createMockList()`, `createMockLink()`
- `createMockTable()`, `createMockImage()`, etc.

**Existing MARKDOWN_FIXTURES:**
```typescript
{
  simple: { short, medium, long },
  withUrls: { single, multiple },
  multiSentence: { two, three, withAbbrev },
  similarPairs: { veryHigh, high, medium, low, veryLow },
  edgeCases: { empty, singleWord, whitespace, specialChars, multiline },
  formatted: { withBold, withItalic, withCode, mixed }
}
```

**CriticMarkup Assertion Helpers:**
- `hasCriticInsertion()`, `hasCriticDeletion()`, `hasCriticSubstitution()`
- `extractCriticInsertions()`, `extractCriticDeletions()`, `extractCriticSubstitutions()`
- `countCriticOperations()`, `removeCriticMarkup()`

### What to Add

Extend `editor-test-helpers.ts` with `AI_PIPELINE_FIXTURES`:
```typescript
export const AI_PIPELINE_FIXTURES = {
  insertions: { /* 5 cases */ },
  deletions: { /* 3 cases */ },
  updates: { /* 3 cases */ },
  mixed: { /* 3 cases */ },
  edgeCases: { /* 16 cases */ }
}
```

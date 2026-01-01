# AI Suggestions Pipeline Overview

## Overview

The AI suggestions system enables AI-powered editing of explanations with visual diff tracking. Users provide edit instructions, and the system generates suggested changes displayed inline using CriticMarkup syntax with accept/reject controls.

## Architecture

### System Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           CLIENT COMPONENTS                                 │
├────────────────────────────────────────────────────────────────────────────┤
│  AIEditorPanel.tsx (sidebar) + AdvancedAIEditorModal.tsx (expanded)        │
│    ├─ Inline Diff: runAISuggestionsPipelineAction() [server action]        │
│    ├─ Rewrite: handleUserAction() with UserInputType.Rewrite               │
│    └─ E2E Tests: POST /api/runAISuggestionsPipeline [JSON, mockable]       │
└─────────────────────────────────┬──────────────────────────────────────────┘
                                  ↓
┌────────────────────────────────────────────────────────────────────────────┐
│                           PIPELINE ORCHESTRATION                            │
├────────────────────────────────────────────────────────────────────────────┤
│  getAndApplyAISuggestions() → runAISuggestionsPipeline()                   │
│    ├→ Step 1: generateAISuggestionsAction() → LLM structured output        │
│    ├→ Step 2: applyAISuggestionsAction() → LLM applies edits               │
│    ├→ Step 3: RenderCriticMarkupFromMDAstDiff() → AST diff                 │
│    └→ Step 4: preprocessCriticMarkup() → normalize for Lexical            │
└─────────────────────────────────┬──────────────────────────────────────────┘
                                  ↓
┌────────────────────────────────────────────────────────────────────────────┐
│                           LEXICAL EDITOR                                    │
├────────────────────────────────────────────────────────────────────────────┤
│  DiffTagNodes rendered with accept/reject controls                         │
│    ├─ DiffTagNodeInline: <ins>, <del>, <span> for inline diffs             │
│    ├─ DiffTagNodeBlock: <div> for block-level diffs                        │
│    └─ DiffUpdateContainerInline: wraps before/after in updates             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Core Files

| File | Purpose |
|------|---------|
| `src/components/AIEditorPanel.tsx` | Sidebar UI for AI editing (renamed from AISuggestionsPanel) |
| `src/components/AdvancedAIEditorModal.tsx` | Expanded modal with tags and full editing controls |
| `src/components/OutputModeToggle.tsx` | Toggle between inline-diff and rewrite modes |
| `src/editorFiles/aiSuggestion.ts` | Pipeline orchestration and prompts |
| `src/editorFiles/actions/actions.ts` | Server actions for LLM calls |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | AST-based diff algorithm |
| `src/editorFiles/lexicalEditor/DiffTagNode.ts` | Lexical nodes for diff visualization |
| `src/editorFiles/lexicalEditor/importExportUtils.ts` | CriticMarkup import/export |
| `src/editorFiles/lexicalEditor/diffTagMutations.ts` | Accept/reject mutations |
| `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx` | Event delegation for controls |
| `src/app/(debug)/editorTest/page.tsx` | Debug/testing interface |

---

## The 4-Step Pipeline

Implemented in `runAISuggestionsPipeline()` at `src/editorFiles/aiSuggestion.ts:185-373`.

### Step 1: Generate AI Suggestions (25% progress)

**Function**: `generateAISuggestionsAction()` at `src/editorFiles/actions/actions.ts:23-80`

- **Input**: Original content + user prompt
- **Output**: Structured JSON array with edit segments and `"... existing text ..."` markers
- **Prompt**: `createAISuggestionPrompt()` enforces alternating content/marker pattern
- **Validation**: `aiSuggestionSchema` ensures proper structure
- **Model**: Uses `default_model` with structured output validation

Example output:
```json
{
  "edits": [
    "Improved introduction paragraph here",
    "... existing text ...",
    "Enhanced middle section with better examples"
  ]
}
```

### Step 2: Apply Suggestions (50% progress)

**Function**: `applyAISuggestionsAction()` at `src/editorFiles/actions/actions.ts:91-149`

- **Input**: AI suggestions (Step 1 output) + original content
- **Output**: Complete edited document as markdown
- **Prompt**: `createApplyEditsPrompt()` instructs LLM to merge edits with original
- **Model**: Uses `lighter_model` (faster, no schema validation needed)

### Step 3: Generate AST Diff (75% progress)

**Function**: `RenderCriticMarkupFromMDAstDiff()` at `src/editorFiles/markdownASTdiff/markdownASTdiff.ts:632`

- **Input**: Original AST + edited AST (parsed via `remark-parse`)
- **Output**: Markdown with CriticMarkup annotations
- **Algorithm**: Multi-pass hierarchical diffing (paragraph → sentence → word level)

See [AST Diff Algorithm](#ast-diff-algorithm) section for details.

### Step 4: Preprocess CriticMarkup (90% progress)

**Function**: `preprocessCriticMarkup()` at `src/editorFiles/lexicalEditor/importExportUtils.ts:891-905`

- **Input**: CriticMarkup markdown
- **Output**: Content normalized for Lexical editor import
- **Purpose**: Handle multiline patterns, ensure proper heading formatting

### Model Selection Strategy

The pipeline uses different models for cost/performance optimization:

| Step | Model | Schema Validation | Rationale |
|------|-------|-------------------|-----------|
| Step 1 | `default_model` | Yes (`aiSuggestionSchema`) | Needs structured output for reliable parsing |
| Step 2 | `lighter_model` | No | Simple text merge, faster/cheaper |
| Step 3-4 | N/A | N/A | Local AST processing, no LLM |

---

## Error Handling & Logging

All server actions follow a consistent error handling pattern with structured logging.

### Action Wrapper Pattern

```typescript
// FILE_DEBUG = true enables logging for this file
const FILE_DEBUG = true;

export const generateAISuggestionsAction = withLogging(
  async function(...) {
    try {
      logger.debug('AI Suggestion Request', { textLength, promptLength }, FILE_DEBUG);
      const response = await callOpenAIModel(...);
      logger.debug('AI Suggestion Response', { responseLength }, FILE_DEBUG);
      return { success: true, data: response, error: null };
    } catch (error) {
      logger.error('AI Suggestion Error', {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        success: false,
        data: null,
        error: handleError(error, 'generateAISuggestionsAction', { textLength })
      };
    }
  },
  'generateAISuggestionsAction',
  { enabled: FILE_DEBUG }
);
```

### Key Patterns

| Pattern | Purpose |
|---------|---------|
| `withLogging` wrapper | Automatic entry/exit logging for functions |
| `FILE_DEBUG` constant | Toggle logging per-file |
| `handleError()` utility | Standardized error formatting with context |
| `logger.debug()` | Debug output (server_utilities) |
| `logger.error()` | Error output with stack traces |

### Error Response Structure

```typescript
interface ActionResult<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}
```

---

## CriticMarkup Syntax

| Syntax | Meaning | Display |
|--------|---------|---------|
| `{++inserted text++}` | Addition | Green highlight |
| `{--deleted text--}` | Deletion | Red strikethrough |
| `{~~before~>after~~}` | Replacement | Red → Green |

---

## Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `NEXT_PUBLIC_USE_AI_API_ROUTE` | Toggle API route vs server action | `undefined` (uses server action) |

When `NEXT_PUBLIC_USE_AI_API_ROUTE === 'true'`:
- Uses `/api/runAISuggestionsPipeline` JSON endpoint
- Enables Playwright route mocking for E2E tests
- Returns standard JSON responses

When unset or `false`:
- Uses `runAISuggestionsPipelineAction` server action
- RSC format (not mockable via network)
- Production default

---

## Entry Points

### Production: Unified AI Editor (Sidebar + Modal)

The AI editing system uses a two-tier approach:

1. **AIEditorPanel** (`src/components/AIEditorPanel.tsx`) - Sidebar with:
   - Prompt textarea for edit instructions
   - Source URL management (via SourceList component)
   - Output mode toggle (inline-diff vs rewrite)
   - "Expand" button to open advanced modal

2. **AdvancedAIEditorModal** (`src/components/AdvancedAIEditorModal.tsx`) - Modal with:
   - All sidebar features plus tag management
   - Local state that can diverge from sidebar
   - Dirty state detection with confirmation on cancel
   - Apply button that syncs changes back to sidebar

#### State Management

The panel uses several state hooks for UI control:

```typescript
const [userPrompt, setUserPrompt] = useState('');
const [isLoading, setIsLoading] = useState(false);
const [progressState, setProgressState] = useState<ProgressState | null>(null);
const [error, setError] = useState<string | null>(null);
const [sources, setSources] = useState<SourceChipType[]>([]);
const [outputMode, setOutputMode] = useState<'inline-diff' | 'rewrite'>('inline-diff');
```

#### Progress Tracking

Progress updates map to pipeline steps:

| Progress | Step |
|----------|------|
| 25% | Step 1: Generate suggestions |
| 50% | Step 2: Apply suggestions |
| 75% | Step 3: AST diff |
| 90% | Step 4: Preprocessing |
| 100% | Complete |

#### Environment-Based Execution

```typescript
// Determines calling method based on environment
if (process.env.NEXT_PUBLIC_USE_AI_API_ROUTE === 'true') {
  // E2E tests: call API route (mockable JSON)
  result = await fetch('/api/runAISuggestionsPipeline', {...});
} else {
  // Production: call server action (RSC format)
  result = await runAISuggestionsPipelineAction(...);
}
```

#### Development Features

In development mode, successful results show a "Debug in EditorTest" link with the `session_id` for pipeline debugging.

### API Route (E2E Testing)

`src/app/api/runAISuggestionsPipeline/route.ts` wraps the pipeline for Playwright mocking:

```typescript
POST /api/runAISuggestionsPipeline
Body: { currentContent: string, userPrompt: string, sessionData?: {...} }
Response: { success: boolean, content?: string, error?: string, session_id?: string }
```

### Debug Interface: EditorTest Page

`src/app/(debug)/editorTest/page.tsx` provides granular control over each pipeline step.

#### Pipeline Controls

| Button | Function Called | Purpose |
|--------|-----------------|---------|
| Get AI Suggestions | `generateAISuggestionsAction()` | Step 1 only |
| Apply AI Suggestions | `applyAISuggestionsAction()` | Step 2 only |
| Apply Diff | `RenderCriticMarkupFromMDAstDiff()` | Step 3 only |
| Apply Preprocessing | `preprocessCriticMarkup()` | Step 4 only |
| Run Complete AI Pipeline | `getAndApplyAISuggestionsAction()` | All 4 steps |

#### URL Patterns

- `/editorTest?explanation_id=123` - Load explanation from database
- `/editorTest?session_id=uuid` - Load saved session

#### State Management (21+ hooks)

The page manages extensive state for testing:

```typescript
// Content states
const [currentContent, setCurrentContent] = useState<string>('');
const [aiSuggestions, setAiSuggestions] = useState<string>('');
const [rawAIResponse, setRawAIResponse] = useState<string>('');

// Per-step loading/error states
const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
const [suggestionError, setSuggestionError] = useState('');
const [isApplyingEdits, setIsApplyingEdits] = useState(false);
const [applyError, setApplyError] = useState('');
// ... similar for diff and preprocessing steps

// Session management
const [sessionOptions, setSessionOptions] = useState<Array<{...}>>([]);
const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
const [loadedSessionData, setLoadedSessionData] = useState<{...} | null>(null);

// Stored results dropdown
const [step1Options, setStep1Options] = useState<Array<{...}>>([]);
const [selectedStep1Id, setSelectedStep1Id] = useState<number | null>(null);
```

#### Key Features

| Feature | Description |
|---------|-------------|
| Load from database | Fetch explanation by `explanation_id` |
| Session replay | Load complete 4-step session by `session_id` |
| Test set rename | Edit names of saved test results |
| Fixture export | Export test cases for unit tests |
| Validation errors | Display preprocessing validation issues |
| Edit mode toggle | Switch between edit and view modes |
| Display modes | Toggle markdown/state visualization |

---

## Lexical Editor Integration

### DiffTagNode Types

| Type | DOM Element | Purpose |
|------|-------------|---------|
| `DiffTagNodeInline` | `<ins>`, `<del>`, `<span>` | Inline diff markers |
| `DiffTagNodeBlock` | `<div>` | Block-level diffs |
| `DiffUpdateContainerInline` | `<span>` | Wraps before/after in updates |

Each node stores a `__tag` property: `"ins"`, `"del"`, or `"update"`.

### Import Flow

```
CriticMarkup markdown
    ↓
preprocessCriticMarkup() - normalize multiline patterns, fix heading formatting
    ↓
CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER - regex: /\{([+-~]{2})([\s\S]+?)\1\}/
    ↓
processMarkdownToDiffNode() - convert inner markdown to Lexical nodes
    ↓
DiffTagNodeInline/Block with children
    ↓
promoteNodesAfterImport() - move heading-containing diffs to top-level
```

### Export Flow

```
DiffTagNodes in Lexical tree
    ↓
replaceDiffTagNodesAndExportMarkdown() - convert nodes to CriticMarkup text
    ↓
$convertToMarkdownString() - Lexical native markdown export
    ↓
Markdown with CriticMarkup preserved
```

### DiffTagHoverPlugin Architecture

Located in `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx`.

The plugin uses **event delegation** instead of React portals for performance:

```typescript
export function DiffTagHoverPlugin({
  onPendingSuggestionsChange
}: {
  onPendingSuggestionsChange?: (hasPending: boolean) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const [hasPendingSuggestions, setHasPendingSuggestions] = useState(false);

  // Track pending diff count for UI state
  const updatePendingCount = useCallback(() => {
    editor.getEditorState().read(() => {
      const inlineNodes = $nodesOfType(DiffTagNodeInline);
      const blockNodes = $nodesOfType(DiffTagNodeBlock);
      setHasPendingSuggestions(inlineNodes.length + blockNodes.length > 0);
    });
  }, [editor]);

  useEffect(() => {
    const rootElement = editor.getRootElement();
    if (!rootElement) return;

    // Single click handler via event delegation
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const action = target.getAttribute('data-action');
      const nodeKey = target.getAttribute('data-node-key');

      if (action === 'accept') acceptDiffTag(editor, nodeKey);
      else if (action === 'reject') rejectDiffTag(editor, nodeKey);
    };

    rootElement.addEventListener('click', handleClick);
    return () => rootElement.removeEventListener('click', handleClick);
  }, [editor]);

  // Notify parent of pending state changes
  useEffect(() => {
    onPendingSuggestionsChange?.(hasPendingSuggestions);
  }, [hasPendingSuggestions, onPendingSuggestionsChange]);

  return null; // No React rendering
}
```

**Key Design Decisions**:
- Returns `null` - no DOM output, purely event handling
- Uses `useCallback` for `updatePendingCount` performance
- `onPendingSuggestionsChange` callback notifies parent components
- Event delegation avoids per-node React portals

### Accept/Reject Mutations

Located in `src/editorFiles/lexicalEditor/diffTagMutations.ts`.

**Event Flow**:
1. `DiffTagHoverPlugin` registers click handler on editor root (event delegation)
2. Clicks on buttons with `data-action` and `data-node-key` attributes route to mutation functions
3. Mutations run in `editor.update({ discrete: true })` for atomic changes

**Accept Behavior**:

| Tag Type | Action |
|----------|--------|
| `"ins"` | Extract children, insert before node, remove node → keeps inserted content |
| `"del"` | Remove entire node → accepts deletion |
| `"update"` | Extract "after" container children, insert before node, remove node |

**Reject Behavior**:

| Tag Type | Action |
|----------|--------|
| `"ins"` | Remove entire node → rejects insertion |
| `"del"` | Extract children, insert before node, remove node → keeps original |
| `"update"` | Extract "before" container children, insert before node, remove node |

---

## AST Diff Algorithm

Located in `src/editorFiles/markdownASTdiff/markdownASTdiff.ts`.

### Multi-Pass Hierarchical Approach

```
Tree Level: LCS matching on child nodes
    ↓
Paragraph Level: similarity check (>40% diff → atomic {~~old~>new~~})
    ↓
Sentence Level: alignment via similarity (<30% diff → pair sentences)
    ↓
Word Level: granular diff for similar sentences (<15% diff threshold)
```

### Key Functions

| Function | Line | Purpose |
|----------|------|---------|
| `RenderCriticMarkupFromMDAstDiff()` | 632 | Main entry point |
| `emitCriticForPair()` | 672 | Recursive diff engine |
| `buildParagraphMultiPassRuns()` | 523 | Three-pass paragraph diffing |
| `alignSentencesBySimilarity()` | 271 | Greedy sentence pairing |
| `diffRatioWords()` | 445 | LCS-based similarity metric |
| `diffTextGranularWithLib()` | 643 | Word/char diff via `diff` library |
| `toCriticMarkup()` | 659 | Convert runs to CriticMarkup string |

### Configuration Options

```typescript
interface DiffOptions {
  textGranularity?: 'char' | 'word';  // Default: 'word'
  multipass?: {
    paragraphAtomicDiffIfDiffAbove?: number;  // Default: 0.40
    sentenceAtomicDiffIfDiffAbove?: number;   // Default: 0.15
    sentencesPairedIfDiffBelow?: number;      // Default: 0.30
    sentenceLocale?: string;                   // Default: 'en'
    debug?: boolean;                           // Default: true
  }
}
```

### Atomic Nodes

Nodes that always use whole-node replacement (never granular diff):

**Blocks**: heading, code, table, thematicBreak, html, yaml, list, tableRow, tableCell

**Inline**: inlineCode, math, image, imageReference, linkReference, footnoteReference, link

---

## Database Integration

Pipeline results can be saved for debugging via `saveTestingPipelineStepAction()`:

```typescript
await saveTestingPipelineStepAction(
  'ai-suggestion-session',
  'step1_ai_suggestions',  // or step2, step3, step4
  content,
  {
    session_id: 'uuid',
    explanation_id: 123,
    explanation_title: 'Title',
    user_prompt: 'Make it shorter',
    source_content: originalContent
  }
);
```

### TESTING_edits_pipeline Schema

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial | Primary key |
| `created_at` | timestamp | Auto-generated |
| `step` | varchar | `step1_ai_suggestions`, `step2_applied_edits`, `step3_critic_markup`, `step4_preprocessed` |
| `name` | varchar | Test set name (editable via EditorTest) |
| `content` | text | Step output content |
| `session_metadata` | jsonb | See below |

### Session Metadata Structure

```typescript
interface SessionMetadata {
  session_id: string;           // UUID linking all 4 steps
  explanation_id?: number;      // Source explanation
  explanation_title?: string;   // For display
  user_prompt: string;          // User's edit instruction
  source_content: string;       // Original content
  processing_time?: number;     // Step duration (ms)
}
```

### Session ID Generation

Browser-compatible UUID generation with fallback:

```typescript
const sessionId = crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
```

### Deduplication

Saves are skipped if exact content match already exists in the table for the same step

---

## Testing

### Test Files

| File | Type |
|------|------|
| `src/editorFiles/aiSuggestion.test.ts` | Unit tests for pipeline functions |
| `src/editorFiles/aiSuggestion.golden.test.ts` | Golden reference tests |
| `src/editorFiles/lexicalEditor/DiffTagNode.test.ts` | DiffTagNode unit tests |
| `src/editorFiles/lexicalEditor/importExportUtils.test.ts` | Import/export tests |
| `src/editorFiles/lexicalEditor/DiffTagAcceptReject.integration.test.tsx` | Accept/reject tests |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts` | AST diff algorithm tests |
| `src/__tests__/e2e/specs/06-ai-suggestions/*.spec.ts` | E2E Playwright tests |

### E2E Test Helper Library

`src/__tests__/e2e/helpers/suggestions-test-helpers.ts` provides utilities for E2E testing:

#### API Triggering

```typescript
// Trigger pipeline via API route (mockable)
await triggerAISuggestionsViaAPI(page, {
  userPrompt: 'Make it shorter',
  mockResponse?: { success: true, content: '...' }
});
```

#### DOM Selectors

```typescript
// Get diff elements by type
const insertions = await getInsertionDiffs(page);  // [data-diff-type="ins"]
const deletions = await getDeletionDiffs(page);    // [data-diff-type="del"]
const updates = await getUpdateDiffs(page);        // [data-diff-type="update"]
```

#### Interaction Helpers

```typescript
await acceptDiff(page, diffNode);
await rejectDiff(page, diffNode);
await acceptAllDiffs(page);
await rejectAllDiffs(page);
```

#### UI State Verification

```typescript
await waitForSuggestionsSuccess(page);
await waitForSuggestionsError(page);
await waitForSuggestionsLoading(page);
```

#### Content Inspection

```typescript
const texts = await getAllDiffTexts(page);
const content = await getEditorTextContent(page);
const counts = await getDiffCounts(page);
// counts = { insertions: 2, deletions: 1, updates: 0, total: 3 }
```

#### Data Attributes for Selectors

| Attribute | Purpose |
|-----------|---------|
| `[data-diff-type]` | Diff type: `ins`, `del`, `update` |
| `[data-diff-key]` | Lexical node key for targeting |
| `[data-action]` | Button action: `accept`, `reject` |
| `[data-node-key]` | Node key for mutation routing |

### Test Fixtures

`src/testing/utils/editor-test-helpers.ts` contains 30+ fixtures:
- 5 insertion cases
- 3 deletion cases
- 3 update cases
- 3 mixed operation cases
- 16 edge cases (headings, lists, code blocks, unicode, tables)

---

## Related Documentation

- [markdown_ast_diffing.md](./markdown_ast_diffing.md) - Diff algorithm deep dive
- [lexical_editor_plugins.md](./lexical_editor_plugins.md) - Editor plugin architecture
- [search_generation_pipeline.md](./search_generation_pipeline.md) - Content generation flow

## Exploration Documents

For implementation history and design decisions:
- `/docs/explorations/aisuggestions.md` - Original integration plan
- `/docs/explorations/aisuggestions_critique_1.md` - Design critique
- `/docs/explorations/debugPipelineFromResults.md` - Database integration plan

# Lexical Editor Framework Research Documentation

## Overview

The codebase implements a Lexical-based rich text editor with:
- Custom diff tracking via CriticMarkup syntax
- AI-powered suggestion pipeline
- Streaming content support
- Markdown import/export
- Link overlay system

---

## 1. EDITOR ARCHITECTURE

### Core Setup
**File:** `src/editorFiles/lexicalEditor/LexicalEditor.tsx`

The editor uses `LexicalComposer` with a custom theme (Midnight Scholar) and registered nodes:
- `DiffTagNodeBlock` / `DiffTagNodeInline` - diff visualization
- `DiffUpdateContainerInline` - before/after containers for updates
- `HeadingNode`, `QuoteNode`, `ListNode`, `ListItemNode`
- `CodeNode`, `CodeHighlightNode`
- `LinkNode`, `StandaloneTitleLinkNode`, `AutoLinkNode`
- `TableNode`, `TableCellNode`, `TableRowNode`
- `HorizontalRuleNode`, `OverflowNode`, `MarkNode`

### LexicalEditorRef Interface (Lines 235-244)
```typescript
interface LexicalEditorRef {
  setContentFromMarkdown: (markdown: string) => void;
  getContentAsMarkdown: () => string;
  toggleMarkdownMode: () => void;
  getMarkdownMode: () => boolean;
  setEditMode: (isEditMode: boolean) => void;
  getEditMode: () => boolean;
  focus: () => void;
  applyLinkOverlay: (explanationId: number) => Promise<void>;
}
```

---

## 2. CUSTOM NODES

### DiffTagNodeInline (`DiffTagNode.ts:7-295`)
- Extends `ElementNode`
- Property: `__tag: "ins" | "del" | "update"`
- Creates `<ins>`, `<del>`, or `<span>` HTML elements
- `exportMarkdown()` - converts back to CriticMarkup format
- Used for inline diff visualization

### DiffTagNodeBlock (`DiffTagNode.ts:346-375`)
- Extends `DiffTagNodeInline`
- `isInline()` returns `false` for block-level rendering
- Used when diff contains headings/lists

### DiffUpdateContainerInline (`DiffTagNode.ts:404-525`)
- Property: `__containerType: "before" | "after"`
- Holds before/after content in update diffs (`{~~old~>new~~}`)
- `canBeEmpty()` returns `false`

### StandaloneTitleLinkNode (`StandaloneTitleLinkNode.ts:13-86`)
- Extends `LinkNode`
- Detects URLs matching `/standalone-title?t=...`
- Custom click handler navigates to `/results?t=<title>`

---

## 3. PLUGINS

### ToolbarPlugin (`ToolbarPlugin.tsx`)
- FloatingLinkEditor for URL input
- Block type selector (paragraph, headings, quote, code, lists)
- Text format buttons (bold, italic, underline, strikethrough)
- Registers `SELECTION_CHANGE_COMMAND` listeners

### DiffTagHoverPlugin (`DiffTagHoverPlugin.tsx:1-159`)
- Scans DOM for `data-diff-key` attributes
- Provides Accept/Reject controls for diff nodes
- Registers mutation listeners for `DiffTagNodeInline`/`DiffTagNodeBlock`
- Accept/Reject logic:
  - Accept insertion: keep content, remove diff tag
  - Accept deletion: remove entire node
  - Accept update: keep "after" content
  - Reject: opposite operations

### TextRevealPlugin (`TextRevealPlugin.tsx:1-124`)
- Applies text reveal animations during streaming
- Monitors node creation via mutation listeners
- Supports "scramble" effect
- Respects `prefers-reduced-motion`

### ContentChangePlugin (`LexicalEditor.tsx:141-176`)
- Tracks editor state and content changes
- Serializes state to JSON
- Exports content as markdown
- Calls parent callbacks

### DisplayModePlugin (`LexicalEditor.tsx:179-190`)
- Controls `editor.setEditable()` for edit/display mode

---

## 4. MARKDOWN TRANSFORMERS

**File:** `src/editorFiles/lexicalEditor/importExportUtils.ts`

### MARKDOWN_TRANSFORMERS Array (Lines 1136-1151)
```typescript
[
  HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST,
  INLINE_CODE, BOLD_STAR, ITALIC_STAR, STRIKETHROUGH,
  STANDALONE_TITLE_LINK_TRANSFORMER,
  LINK,
  CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER,
  DIFF_TAG_EXPORT_TRANSFORMER,
]
```

### CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER (Lines 261-475)
- Type: `text-match`
- Trigger: `{` character
- Regex: `/\{([+-~]{2})([\s\S]+?)\1\}/`
- Handles:
  - `{++inserted++}` → DiffTagNodeInline with "ins"
  - `{--deleted--}` → DiffTagNodeInline with "del"
  - `{~~old~>new~~}` → DiffTagNodeInline with "update" + containers

### DIFF_TAG_EXPORT_TRANSFORMER (Lines 483-507)
- Type: `element`
- Exports DiffTagNodeInline back to CriticMarkup

---

## 5. AI SUGGESTION PIPELINE

### Pipeline Overview (`src/editorFiles/aiSuggestion.ts`)

4-step pipeline:
1. **generateAISuggestionsAction()** - Generate structured edits
2. **applyAISuggestionsAction()** - Apply edits to create final text
3. **RenderCriticMarkupFromMDAstDiff()** - Generate markdown AST diff
4. **preprocessCriticMarkup()** - Normalize for editor

### Key Functions

#### runAISuggestionsPipeline() (Lines 99-279)
- Orchestrates complete pipeline
- Saves each step to database if session_id provided
- Progress callbacks: 25% → 50% → 75% → 90% → 100%
- Returns preprocessed content with CriticMarkup

#### aiSuggestionSchema (Lines 14-33)
- Zod schema for structured LLM output
- Enforces alternating pattern: content/marker/content/marker
- Ensures output starts/ends with content

### LLM Service (`src/lib/services/llms.ts`)

#### callOpenAIModel() (Lines 56-180)
- Main function for all OpenAI API calls
- Supports streaming and non-streaming modes
- Structured output via `zodResponseFormat`
- Tracks calls to database via `saveLlmCallTracking()`
- Default model: `gpt-4.1-mini`
- Lighter model: `gpt-4.1-nano`

---

## 6. DIFF SYSTEM

### Markdown AST Diff (`src/editorFiles/markdownASTdiff/markdownASTdiff.ts`)

#### RenderCriticMarkupFromMDAstDiff() (Lines 1036-1040)
- Converts markdown AST diff to CriticMarkup

#### emitCriticForPair() (Lines 1045-1240)
- Compares before/after nodes
- Applies atomic policy to certain node types
- Multi-pass analysis for paragraphs:
  - Pass 1: Paragraph-level similarity
  - Pass 2: Sentence-level alignment
  - Pass 3: Word-level diff

#### Thresholds (Lines 710-818)
- Paragraph atomic if diff > 40%
- Sentence atomic if diff > 15%
- Sentence pairing if diff < 30%

### CriticMarkup Format
- `{--text--}` = deletion
- `{++text++}` = insertion
- `{~~old~>new~~}` = update/replacement

---

## 7. COMMAND SYSTEM

### Registered Commands (ToolbarPlugin.tsx)
- `SELECTION_CHANGE_COMMAND` - selection tracking
- `FORMAT_TEXT_COMMAND` - text formatting (bold, italic, etc.)
- `TOGGLE_LINK_COMMAND` - link insertion/removal
- `INSERT_UNORDERED_LIST_COMMAND` / `INSERT_ORDERED_LIST_COMMAND`
- `REMOVE_LIST_COMMAND`

### Listener Patterns
```typescript
// Update listener
editor.registerUpdateListener(({ editorState }) => {
  editorState.read(() => { /* read state */ });
});

// Mutation listener
editor.registerMutationListener(NodeType, (mutations) => {
  for (const [nodeKey, mutation] of mutations) {
    if (mutation === 'created') { /* handle */ }
  }
});

// Command listener
editor.registerCommand(
  COMMAND,
  () => { /* handler */ return true; },
  COMMAND_PRIORITY_LOW
);
```

---

## 8. LINK OVERLAY SYSTEM

### applyLinkOverlay() (`LexicalEditor.tsx:469-665`)
- Fetches link data via `getLinkDataForLexicalOverlayAction()`
- Processes headings first, then terms sorted by length
- Wraps matches in `StandaloneTitleLinkNode`
- Word boundary checking (lines 522-527)
- Processes matches right-to-left to avoid index drift
- Handles custom overrides per term

---

## 9. STREAMING SUPPORT

### useStreamingEditor Hook (`useStreamingEditor.ts:1-172`)
- Debounced content updates (100ms for streaming)
- Locks editor during streaming (`setEditMode(false)`)
- Protects user edits from overwriting
- Returns: `editorRef` and `handleContentChange`

### Streaming API (`src/app/api/stream-chat/route.ts`)
- POST `/api/stream-chat`
- Creates ReadableStream with SSE format
- `setText` callback sends: `data: {text, isComplete}`

---

## 10. STATE MANAGEMENT

### Serialization
```typescript
const editorState = editor.getEditorState();
const json = JSON.stringify(editorState.toJSON(), null, 2);
```

### Export Functions
- `exportMarkdownReadOnly()` - read-only export
- `replaceDiffTagNodesAndExportMarkdown()` - export with CriticMarkup

### Preprocessing
- `preprocessCriticMarkup()` - normalize multiline patterns
- `replaceBrTagsWithNewlines()` - normalize `<br>` tags
- `promoteNodesAfterImport()` - promote headings to top-level

---

## 11. FILE STRUCTURE

```
src/editorFiles/
├── lexicalEditor/
│   ├── LexicalEditor.tsx              # Main editor (832 lines)
│   ├── DiffTagNode.ts                 # Diff nodes (525 lines)
│   ├── StandaloneTitleLinkNode.ts     # Custom link (103 lines)
│   ├── DiffTagHoverPlugin.tsx         # Hover controls (158 lines)
│   ├── DiffTagInlineControls.tsx      # Accept/Reject UI
│   ├── DiffTagHoverControls.tsx       # Positioning
│   ├── TextRevealPlugin.tsx           # Animation (123 lines)
│   ├── ToolbarPlugin.tsx              # Toolbar (668 lines)
│   ├── importExportUtils.ts           # Transformers (1150+ lines)
│   └── [test files]
├── aiSuggestion.ts                    # AI pipeline
├── markdownASTdiff/
│   └── markdownASTdiff.ts             # Diff algorithm
└── actions/
    └── actions.ts                     # Server actions

src/lib/services/
└── llms.ts                            # LLM integration

src/app/api/
└── stream-chat/route.ts               # Streaming endpoint
```

---

## 12. DATA FLOW DIAGRAM

```
User Input / AI Suggestions
         ↓
┌─────────────────────────────────────────┐
│  AI Pipeline (if AI suggestion)          │
│  1. generateAISuggestionsAction()        │
│  2. applyAISuggestionsAction()           │
│  3. RenderCriticMarkupFromMDAstDiff()    │
│  4. preprocessCriticMarkup()             │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  Markdown with CriticMarkup              │
│  {++inserted++} {--deleted--}            │
│  {~~old~>new~~}                          │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  MARKDOWN_TRANSFORMERS                   │
│  CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  Lexical Editor State                    │
│  DiffTagNodeInline/Block nodes           │
│  Visual diff rendering                   │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  User Actions                            │
│  Accept/Reject diffs → DiffTagHoverPlugin│
│  Edit text → ToolbarPlugin               │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│  Export                                  │
│  replaceDiffTagNodesAndExportMarkdown() │
│  → Markdown with CriticMarkup            │
└─────────────────────────────────────────┘
```

---

## 13. KEY INTEGRATION POINTS

### Editor ↔ AI Pipeline
1. User triggers AI suggestion from `AISuggestionsPanel`
2. Pipeline runs, returns markdown with CriticMarkup
3. Editor imports via `setContentFromMarkdown()`
4. `CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER` converts to `DiffTagNode`s
5. User sees visual diff, can Accept/Reject

### Editor ↔ Database
1. `ContentChangePlugin` exports markdown on every change
2. Parent component saves to database
3. On load, markdown fetched and set via `setContentFromMarkdown()`

### Editor ↔ Link Overlay
1. `applyLinkOverlay(explanationId)` called after content load
2. Fetches whitelist terms from database
3. Wraps matching text in `StandaloneTitleLinkNode`
4. Click navigates to results page

---

## 14. LINE BREAK PROCESSING (`<br>` TAGS)

### Problem Statement
Multiline CriticMarkup patterns (e.g., `{++line1\nline2++}`) break during markdown parsing because:
- Lexical's regex-based transformers expect single-line patterns
- Raw `\n` characters break regex matching across the marks

### Solution: `<br>` as Normalization Bridge

`<br>` tags act as **temporary placeholders** that:
1. Preserve semantic newline information
2. Keep CriticMarkup patterns syntactically valid during regex matching
3. Survive markdown parsing phase
4. Get converted back to actual newlines after parsing

### Processing Pipeline

```
Raw Markdown (with multiline CriticMarkup)
    ↓
preprocessCriticMarkup()
    ├─ normalizeMultilineCriticMarkup() [converts \n to <br>]
    └─ fixHeadingFormatting()
    ↓
$convertFromMarkdownString() [Lexical parser]
    ├─ CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER
    └─ Creates DiffTagNodes with <br> in text
    ↓
replaceBrTagsWithNewlines() [converts <br> back to \n]
    ↓
Final Editor State (with proper newlines)
```

### Key Functions

#### normalizeMultilineCriticMarkup() (`importExportUtils.ts:714-732`)
- **When**: Before markdown parsing
- **Action**: Replaces `\n` with `<br>` inside CriticMarkup patterns
- **Example**: `{++line1\nline2++}` → `{++line1<br>line2++}`

#### replaceBrTagsWithNewlines() (`importExportUtils.ts:1052-1095`)
- **When**: After markdown parsing completes
- **Action by node type**:
  - **Paragraphs/DiffTags**: `<br>` → `\n`
  - **Headings**: `<br>` deleted (headings must be single-line)
- **Edge case**: Multiple `<br><br><br>` collapse to single `\n`

#### removeTrailingBreaksFromTextNodes() (`importExportUtils.ts:1001-1040`)
- **Purpose**: Removes trailing `<br>` artifacts from text nodes
- **When**: Before export to clean up conversion artifacts

### Call Locations

| Location | Function Called |
|----------|-----------------|
| `LexicalEditor.tsx:127` (InitialContentPlugin) | `replaceBrTagsWithNewlines()` |
| `LexicalEditor.tsx:356` (setContentFromMarkdown) | `replaceBrTagsWithNewlines()` |
| `LexicalEditor.tsx:386` (queued operation) | `replaceBrTagsWithNewlines()` |
| `LexicalEditor.tsx:441` (toggleMarkdownMode) | `replaceBrTagsWithNewlines()` |

### Edge Cases

1. **Multiple consecutive `<br>`**: Pattern `/(<br\s*\/?>\s*)+/g` collapses to single `\n`
2. **`<br>` variants handled**: `<br>`, `<br/>`, `<br />`, with whitespace
3. **Headings**: All `<br>` tags deleted (not converted to newlines)

---

## 15. NODE SPLITTING LOGIC FOR DIFFTAGS AND LINKS

### Overview

Node splitting is required when:
1. Inserting DiffTagNodes into existing text (CriticMarkup import)
2. Wrapping text in StandaloneTitleLinkNode (link overlay)

### Lexical's splitText() Method

```typescript
TextNode.splitText(...indices: number[]): TextNode[]
```

**Behavior by argument count:**
- `splitText(endIndex)` → `[before, after]`
- `splitText(startIndex, endIndex)` → `[before, match, after]`

### Link Wrapping Algorithm (`LexicalEditor.tsx:531-563`)

**wrapMatchInLink helper handles 4 cases:**

```typescript
// Case 1: Match covers entire node
if (startIndex === 0 && endIndex === textLength) {
  const clone = $createTextNode(textNode.getTextContent());
  clone.setFormat(textNode.getFormat());
  const linkNode = $createStandaloneTitleLinkNode(url);
  linkNode.append(clone);
  textNode.replace(linkNode);
}

// Case 2: Match at start [match, after]
else if (startIndex === 0) {
  const [match] = textNode.splitText(endIndex);
  // wrap match in link, replace
}

// Case 3: Match at end [before, match]
else if (endIndex === textLength) {
  const parts = textNode.splitText(startIndex);
  const match = parts[1];
  // wrap match in link, replace
}

// Case 4: Match in middle [before, match, after]
else {
  const parts = textNode.splitText(startIndex, endIndex);
  const match = parts[1];
  // wrap match in link, replace
}
```

### DiffTagNode Insertion Algorithm (`importExportUtils.ts:376-390`)

Uses insertBefore/insertAfter pattern instead of splitText:

```typescript
// Step 1: Extract text before and after match
const matchIndex = textContent.indexOf(match[0]);
const beforeText = textContent.substring(0, matchIndex);
const afterText = textContent.substring(matchIndex + match[0].length);

// Step 2: Insert before/after nodes BEFORE replacing
if (beforeText) {
  textNode.insertBefore($createTextNode(beforeText));
}
if (afterText) {
  textNode.insertAfter($createTextNode(afterText));
}

// Step 3: Replace original with DiffTagNode
textNode.replace(diff);
```

**Why this order matters:** Insert sibling nodes BEFORE replace() to maintain DOM references.

### Right-to-Left Processing Pattern

```typescript
// Sort matches descending by startIndex
matches.sort((a, b) => b.startIndex - a.startIndex);

// Process from end to start
for (const match of matches) {
  wrapMatchInLink(node, match.startIndex, match.endIndex, ...);
}
```

**Why right-to-left?**
- Modifying text at position X shifts all indices after X
- Processing left-to-right would invalidate subsequent match indices
- Processing right-to-left preserves validity of earlier indices

### Edge Cases

#### Word Boundaries (`LexicalEditor.tsx:523-528`)
```typescript
const isWordBoundary = (content: string, startIndex: number, endIndex: number): boolean => {
  const isBoundary = (char: string) => /[\s.,;:!?()\[\]{}'\"<>\/]/.test(char);
  const beforeOk = startIndex === 0 || isBoundary(content[startIndex - 1]);
  const afterOk = endIndex >= content.length || isBoundary(content[endIndex]);
  return beforeOk && afterOk;
};
```

#### Overlapping Matches (`LexicalEditor.tsx:629-632`)
```typescript
const overlaps = matches.some(
  m => !(endIndex <= m.startIndex || index >= m.endIndex)
);
if (overlaps) continue; // Skip overlapping match
```

#### Already Inside Link (`LexicalEditor.tsx:511-520`)
```typescript
const isInsideLinkNode = (node: LexicalNode): boolean => {
  let parent = node.getParent();
  while (parent !== null) {
    if ($isLinkNode(parent) || $isStandaloneTitleLinkNode(parent)) {
      return true;
    }
    parent = parent.getParent();
  }
  return false;
};
```

### Node Promotion for Block-Level Content

**Problem:** Headings inside inline DiffTagNodes violate HTML semantics.

**Solution:** (`importExportUtils.ts:215-251`)
1. Detect if DiffTagNode contains headings via `nodeContainsHeading()`
2. After import, promote nested headings to top-level
3. Use `promoteNodeToTopLevel()` which:
   - Splits parent node at promotion point
   - Creates new parent for "after" children
   - Uses `insertAfter()` to maintain position

```typescript
function promoteNodesAfterImport(): void {
  // Find nodes needing promotion (reverse order)
  for (let i = nodesToPromote.length - 1; i >= 0; i--) {
    promoteNodeToTopLevel(nodesToPromote[i]);
  }
}
```

### Complete Flow Example

**Input:** "The algorithm is complex"
**Goal:** Wrap "algorithm" (indices 4-13) with link

```
Step 1: Determine case → middle match (Case 4)
Step 2: splitText(4, 13)
        → parts[0] = "The "
        → parts[1] = "algorithm"
        → parts[2] = " is complex"
Step 3: Create link, append parts[1]
Step 4: parts[1].replace(linkNode)

Result:
  TextNode("The ")
  StandaloneTitleLinkNode
    └─ TextNode("algorithm")
  TextNode(" is complex")
```

### Summary Table

| Operation | Method | File | Lines |
|-----------|--------|------|-------|
| Link wrap - entire | clone + replace | LexicalEditor.tsx | 535-541 |
| Link wrap - start | splitText(end) | LexicalEditor.tsx | 543-547 |
| Link wrap - end | splitText(start) | LexicalEditor.tsx | 549-554 |
| Link wrap - middle | splitText(start, end) | LexicalEditor.tsx | 556-562 |
| DiffTag insert | insertBefore/After + replace | importExportUtils.ts | 376-390 |
| Node promotion | split parent + insertAfter | importExportUtils.ts | 153-208 |
| Heading detection | nodeContainsHeading() | importExportUtils.ts | 128-133 |

---

## 16. TESTING AND DEBUGGING TOOLS

### EditorTest Page (`src/app/(debug)/editorTest/page.tsx`)

**Purpose**: Comprehensive debug page for testing the 4-step AI suggestions pipeline.

**URL Parameters**:
- `?explanation_id=123` - Load explanation content and related sessions
- `?session_id=abc` - Load complete session with all 4 pipeline steps

**4 Color-Coded Test Panels**:

| Panel | Color | Step | Function |
|-------|-------|------|----------|
| AI Suggestions | Orange | 1 | Generate structured edits from AI |
| Edits Applied | Green | 2 | Apply edits to original content |
| Diff Applied | Purple | 3 | Generate CriticMarkup via AST diff |
| Preprocessed | Orange | 4 | Normalize multiline patterns |

**Features**:
- Run individual steps or complete pipeline
- Load previous results from database dropdowns
- Rename saved test sets
- Session-based tracking for AI suggestions
- Validation checks for preprocessed content
- Update editor with final result

### Testing Pipeline Service (`src/lib/services/testingPipeline.ts`)

**Database Table**: `testing_edits_pipeline`

**Record Structure**:
```typescript
{
  id: number;
  set_name: string;           // Test set identifier
  step: string;               // Pipeline step name
  content: string;            // Step output
  session_id?: string;        // AI suggestion session
  explanation_id?: number;
  explanation_title?: string;
  user_prompt?: string;
  source_content?: string;
  session_metadata?: any;
  created_at: string;
}
```

**Step Names**:
- `1_ai_suggestion`
- `2_edits_applied_to_markdown`
- `3_diff_applied_to_markdown`
- `4_preprocess_diff_before_import`

**Key Functions**:

| Function | Purpose |
|----------|---------|
| `checkTestingPipelineExists()` | Check for duplicate records |
| `saveTestingPipelineRecord()` | Insert new pipeline record |
| `checkAndSaveTestingPipelineRecord()` | Deduplicated save |
| `updateTestingPipelineRecordSetName()` | Rename test sets |
| `getTestingPipelineRecords()` | Get all records for set |

### Server Actions (`src/actions/actions.ts`)

**Testing Pipeline Actions**:
- `saveTestingPipelineStepAction()` - Save step with session data
- `getTestingPipelineRecordsByStepAction()` - Populate dropdowns
- `updateTestingPipelineRecordSetNameAction()` - Rename sets

**AI Session Actions**:
- `getAISuggestionSessionsAction()` - List distinct sessions
- `loadAISuggestionSessionAction()` - Load complete session with all steps

### Other Debug Pages (`src/app/(debug)/`)

| Page | Purpose |
|------|---------|
| `diffTest/` | Test markdown diff generation |
| `resultsTest/` | Test DiffTagNode rendering and hover |
| `mdASTdiff_demo/` | Comprehensive AST diff testing with test runner |
| `latex-test/` | Test LaTeX math rendering |
| `streaming-test/` | Test real-time streaming |
| `test-client-logging/` | Test client-side logging |

### Test Files

| File | Coverage |
|------|----------|
| `testingPipeline.test.ts` | Pipeline service with mocked Supabase |
| `actions.test.ts` | Server action tests |
| `DiffTagNode.test.ts` | CriticMarkup node rendering |
| `DiffTagHoverPlugin.test.tsx` | Hover interactions |
| `importExportUtils.test.ts` | Markdown import/export |
| `markdownASTdiff.test.ts` | AST diff generation |

### Validation (EditorTest page)

**Preprocessed Content Checks**:
- **Check A**: Non-CriticMarkup headings start on newline
- **Check B**: CriticMarkup containing headings starts on newline

### Console Logging Prefixes

| Prefix | Source |
|--------|--------|
| `🔧` | Service layer (testingPipeline.ts) |
| `🎭` | AISuggestionsPanel |
| `📝` | Editor actions |

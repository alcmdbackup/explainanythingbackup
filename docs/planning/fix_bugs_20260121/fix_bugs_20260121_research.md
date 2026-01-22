# Fix Bugs 20260121 Research

## Problem Statement
Editing of plaintext does not work in the Lexical editor. This research documents the current implementation of plaintext editing and identifies the root cause.

## High Level Summary

### ROOT CAUSE IDENTIFIED

**The Results Page (`src/app/results/page.tsx`) does NOT use LexicalEditor when in plaintext mode.** Instead, it renders a static `<pre>` element that is not editable.

At lines 1327-1352 in `page.tsx`:

```typescript
) : isMarkdownMode ? (
    <>
        <LexicalEditor
            ref={editorRef}
            // ... editor with isMarkdownMode={true}
            isEditMode={isEditMode && !isStreaming}
        />
        <Bibliography sources={bibliographySources} />
    </>
) : (
    // PROBLEM: This is a static <pre>, NOT an editor!
    <pre className="whitespace-pre-wrap text-sm font-mono text-[var(--text-secondary)] leading-relaxed">
        {formattedExplanation}
    </pre>
)
```

**When `isMarkdownMode=false`:**
- The LexicalEditor is NOT rendered at all
- A static `<pre>` element shows the content
- No editing is possible because it's just displaying text

**The LexicalEditor DOES support plaintext editing** via its `PlainTextPlugin`, but the Results page bypasses the editor entirely when toggling to plaintext view.

### What LexicalEditor Actually Supports

The LexicalEditor component (`src/editorFiles/lexicalEditor/LexicalEditor.tsx`) has two rendering modes:

1. **Rich Text Mode** (`isMarkdownMode=true`): Uses Lexical's `RichTextPlugin` with full markdown rendering
2. **Plain Text Mode** (`isMarkdownMode=false`): Uses Lexical's `PlainTextPlugin` for raw text display

The mode switching is handled by `toggleMarkdownMode()` method which:
- Rich → Plain: Exports markdown content, then re-imports with empty transformers (shows raw markdown syntax)
- Plain → Rich: Reads raw text content, then converts to markdown nodes

### Key Finding: PlainTextPlugin vs RichTextPlugin

The LexicalEditor code at lines 713-749 shows the conditional rendering:

```typescript
{internalMarkdownMode ? (
  <RichTextPlugin ... />
) : (
  <PlainTextPlugin ... />
)}
```

When `internalMarkdownMode=false`, the PlainTextPlugin is used with monospace styling (`font-mono text-sm`). **This DOES support editing**, but the Results page never uses it.

## Documents Read
- `docs/docs_overall/getting_started.md` - Documentation structure
- `docs/docs_overall/architecture.md` - System design and tech stack
- `docs/docs_overall/project_workflow.md` - Project workflow

## Code Files Read

### Primary Editor Component
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx` - Main Lexical editor component (851 lines)

### Key Implementation Details

#### 1. Mode State Management (Lines 281-292)
```typescript
const [internalMarkdownMode, setInternalMarkdownMode] = useState<boolean>(isMarkdownMode);
const [internalEditMode, setInternalEditMode] = useState<boolean>(isEditMode);

// Sync internal state with prop changes
useEffect(() => {
  setInternalMarkdownMode(isMarkdownMode);
}, [isMarkdownMode]);
```

#### 2. InitialContentPlugin (Lines 113-139)
Sets initial content differently based on mode:
- Markdown mode: Uses `$convertFromMarkdownString(initialContent, MARKDOWN_TRANSFORMERS)`
- Plain text mode: Uses `$convertFromMarkdownString(initialContent, undefined)` (no transformers)

#### 3. toggleMarkdownMode() Method (Lines 420-464)
Switches between modes:
- **Markdown → Plain**: Exports content via `replaceDiffTagNodesAndExportMarkdown()`, then clears root and imports with empty transformers
- **Plain → Markdown**: Gets raw text via `$getRoot().getTextContent()`, then converts with `MARKDOWN_TRANSFORMERS`

#### 4. DisplayModePlugin (Lines 179-191)
Controls editability:
```typescript
function DisplayModePlugin({ isEditMode }: { isEditMode: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    editor.setEditable(isEditMode);
    if (!isEditMode) {
      editor.blur();
    }
  }, [editor, isEditMode]);
  return null;
}
```

#### 5. ContentEditable Rendering (Lines 713-749)
The conditional rendering shows different plugins based on mode:
- RichTextPlugin when `internalMarkdownMode=true`
- PlainTextPlugin when `internalMarkdownMode=false`

Both use the same editability logic controlled by `internalEditMode`.

### Related Files
- `src/editorFiles/lexicalEditor/importExportUtils.ts` - Markdown import/export utilities
- `src/editorFiles/lexicalEditor/DiffTagNode.ts` - Custom nodes for AI suggestions
- `src/editorFiles/lexicalEditor/ToolbarPlugin.tsx` - Formatting toolbar
- `src/reducers/pageLifecycleReducer.ts` - Page lifecycle state machine with edit mode management
- `src/hooks/useStreamingEditor.ts` - Editor state during streaming
- `src/app/results/page.tsx` - Main results page using the editor

### Editor Ref Interface (Lines 251-260)
```typescript
export interface LexicalEditorRef {
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

## Architecture Notes

### Two Separate Mode Systems
1. **Markdown Mode** (`isMarkdownMode`/`internalMarkdownMode`): Controls rich text vs plain text rendering
2. **Edit Mode** (`isEditMode`/`internalEditMode`): Controls whether content is editable

### State Flow
```
Props (isMarkdownMode, isEditMode)
  → Internal State (internalMarkdownMode, internalEditMode)
  → Conditional Plugin Rendering (RichTextPlugin vs PlainTextPlugin)
  → ContentEditable with styling based on mode
```

### PlainTextPlugin Implementation (In LexicalEditor - NOT Used by Results Page)
When in plain text mode:
- Uses `PlainTextPlugin` from `@lexical/react/LexicalPlainTextPlugin`
- ContentEditable has `font-mono text-sm` styling
- No markdown transformers applied
- Shows raw markdown syntax as editable text

## Root Cause Summary

| Component | Behavior |
|-----------|----------|
| `LexicalEditor.tsx` | Supports plaintext editing via `PlainTextPlugin` |
| `results/page.tsx` | **BYPASSES** LexicalEditor when `isMarkdownMode=false`, renders static `<pre>` |

**Fix Required:** The Results page should use `LexicalEditor` with `isMarkdownMode={false}` instead of a static `<pre>` element when the user toggles to plaintext mode.

### Affected Code Location
- **File:** `src/app/results/page.tsx`
- **Lines:** 1348-1352
- **Current:** Static `<pre>` element
- **Should be:** `<LexicalEditor isMarkdownMode={false} isEditMode={isEditMode} ... />`

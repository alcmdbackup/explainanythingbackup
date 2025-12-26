# Lexical Editor & Plugins

## Overview

The Lexical editor provides rich text editing with markdown support, AI diff visualization, and text reveal animations. It uses custom nodes and plugins for ExplainAnything-specific features.

## Implementation

### Key Files
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx` - Main component
- `src/editorFiles/lexicalEditor/DiffTagNode.ts` - Diff visualization nodes
- `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx` - Hover interactions
- `src/editorFiles/lexicalEditor/TextRevealPlugin.tsx` - Streaming animation
- `src/editorFiles/lexicalEditor/importExportUtils.ts` - Markdown conversion

### Editor Ref Interface

```typescript
interface LexicalEditorRef {
  setContentFromMarkdown(markdown: string): void;
  getContentAsMarkdown(): string;
  toggleMarkdownMode(): void;
  setEditMode(isEditMode: boolean): void;
  focus(): void;
  applyLinkOverlay(explanationId: string): void;
}
```

### Custom Nodes

| Node | Purpose |
|------|---------|
| `DiffTagNodeInline` | Inline diff tags (insert/delete/update) |
| `DiffTagNodeBlock` | Block-level diff tags |
| `DiffUpdateContainerInline` | Wrapper for before/after in updates |
| `StandaloneTitleLinkNode` | Smart internal links |

### Key Plugins

| Plugin | Purpose |
|--------|---------|
| `InitialContentPlugin` | Loads content without overwriting edits |
| `ContentChangePlugin` | Tracks changes, exports markdown |
| `DisplayModePlugin` | Manages edit vs view mode |
| `DiffTagHoverPlugin` | Hover behavior for diff tags |
| `TextRevealPlugin` | Streaming text animation |

### Markdown Transformers

Custom transformers handle CriticMarkup and internal links:

```typescript
const MARKDOWN_TRANSFORMERS = [
  ...TRANSFORMERS,  // Standard Lexical transformers
  CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER,
  CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER,
  DIFF_TAG_EXPORT_TRANSFORMER,
  STANDALONE_TITLE_LINK_TRANSFORMER
];
```

## Usage

### Basic Setup

```tsx
import { LexicalEditor, LexicalEditorRef } from '@/editorFiles/lexicalEditor/LexicalEditor';

const editorRef = useRef<LexicalEditorRef>(null);

<LexicalEditor
  ref={editorRef}
  initialContent={markdown}
  isEditMode={false}
  onContentChange={(content) => setContent(content)}
/>
```

### Setting Content

```typescript
// Import markdown with CriticMarkup support
editorRef.current?.setContentFromMarkdown(`
# Title

This is {++new++} content with {--removed--} text.
`);
```

### Getting Content

```typescript
const markdown = editorRef.current?.getContentAsMarkdown();
// Exports with CriticMarkup preserved
```

### Mode Management

```typescript
// Toggle edit mode
editorRef.current?.setEditMode(true);

// Toggle markdown source view
editorRef.current?.toggleMarkdownMode();
```

### Applying Link Overlays

```typescript
// Apply whitelist links to content
await editorRef.current?.applyLinkOverlay(explanationId);
```

### Import Pipeline

```
Raw Markdown
    ↓
preprocessCriticMarkup()  // Normalize multiline, fix headings
    ↓
$convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS)
    ↓
replaceBrTagsWithNewlines()  // Normalize line breaks
    ↓
promoteNodesAfterImport()  // Move block elements to top level
```

### Export Pipeline

```
Editor State
    ↓
(Read Mode) exportMarkdownReadOnly()
    ↓
(Write Mode) replaceDiffTagNodes() first
    ↓
$convertToMarkdownString(MARKDOWN_TRANSFORMERS)
```

### DiffTagHoverPlugin

Provides hover interactions for diff nodes:
- Shows accept/reject buttons
- Highlights related changes
- Handles click actions

### TextRevealPlugin

Animates text reveal during streaming:
- Characters appear sequentially
- Configurable speed
- Pauses on punctuation

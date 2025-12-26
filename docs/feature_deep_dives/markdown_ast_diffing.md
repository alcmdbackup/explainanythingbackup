# Markdown AST Diffing

## Overview

The AST diffing system compares markdown documents at multiple levels (paragraph, sentence, word) to produce human-readable diffs using CriticMarkup syntax. It powers the AI suggestion visualization in the editor.

## Implementation

### Key Files
- `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` - Core diffing algorithm
- `src/editorFiles/lexicalEditor/DiffTagNode.ts` - Lexical node for diff display

### CriticMarkup Syntax

| Syntax | Meaning |
|--------|---------|
| `{++inserted text++}` | Addition (green) |
| `{--deleted text--}` | Deletion (red) |
| `{~~before~>after~~}` | Replacement |

### Multi-Pass Algorithm

1. **Pass 1 - Paragraph Level**: Compare paragraphs with 40% similarity threshold
2. **Pass 2 - Sentence Level**: Align sentences using similarity-based pairing (30% diff threshold)
3. **Pass 3 - Word Level**: Granular diff using `diff` library

### Atomic Nodes

Certain nodes are treated as indivisible units (deleted+inserted on any change, never granularly diffed):
- Headings
- Code blocks
- Tables
- Links

### LCS Matching

Child nodes are paired via Longest Common Subsequence using `defaultKeyer()` which considers:
- Node type
- Key properties

Matches are interleaved to keep replacements adjacent in output.

## Usage

### Generating Diff Output

```typescript
import { RenderCriticMarkupFromMDAstDiff } from '@/editorFiles/markdownASTdiff/markdownASTdiff';

const diffMarkdown = RenderCriticMarkupFromMDAstDiff(
  originalMarkdown,
  modifiedMarkdown,
  {
    multipass: {
      paragraphThreshold: 0.4,  // 40% similarity for paragraph matching
      sentenceThreshold: 0.3,   // 30% for sentence matching
      debug: false
    }
  }
);

// Result contains CriticMarkup annotations
// "The {--old--}{++new++} text was {~~changed~>modified~~}."
```

### DiffTagNode in Lexical

```typescript
import {
  $createDiffTagNodeInline,
  $isDiffTagNodeInline
} from '@/editorFiles/lexicalEditor/DiffTagNode';

// Create insertion node
const insertNode = $createDiffTagNodeInline('insert');
insertNode.append($createTextNode('new content'));

// Create deletion node
const deleteNode = $createDiffTagNodeInline('delete');
deleteNode.append($createTextNode('old content'));

// Create update node (before → after)
const updateNode = $createDiffTagNodeInline('update');
// Contains two DiffUpdateContainerInline children
```

### Node Types

| Type | DOM Element | CSS Class |
|------|-------------|-----------|
| `insert` | `<ins>` | `diff-insert` |
| `delete` | `<del>` | `diff-delete` |
| `update` | `<span>` | `diff-update` |

### Markdown Export

DiffTagNodes export back to CriticMarkup:

```typescript
// In editor export pipeline
const markdown = exportMarkdownReadOnly(editor);
// DiffTagNodes → {++...++}, {--...--}, {~~...~>...~~}
```

### Debug Mode

```typescript
const diff = RenderCriticMarkupFromMDAstDiff(original, modified, {
  multipass: { debug: true }
});
// Logs similarity calculations for each pass
```

### Key Design Decisions

1. **Sentence-based pairing**: Better granularity than word-based alone
2. **Atomic nodes**: Prevents fragile constructs from partial diffing
3. **Threshold tuning**: Configurable for different content types
4. **Container nodes**: Structure for before/after without semantic meaning

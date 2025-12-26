# Render Links Directly in Lexical Editor - Research & Design

**Status**: Research Complete
**Related**: [`link_whitelist_and_display_plan.md`](./link_whitelist_and_display_plan.md)

## Problem Statement

When content contains CriticMarkup diffs (from AI suggestions), links cannot be applied using the current markdown-level approach because:
1. Markdown-level linking happens BEFORE Lexical import
2. CriticMarkup regex patterns break when links are embedded
3. Links need to appear INSIDE diff nodes (e.g., an inserted term should be clickable within the insertion highlight)

## Current Link Rendering Flow

### Read-Only Display (Non-Editor)
```
useExplanationLoader.ts
    ↓
resolveLinksForDisplayAction() [server action]
    ↓
resolveLinksForArticle() → finds headings + whitelist terms
    ↓
applyLinksToContent() → string manipulation: "term" → "[term](/standalone-title?t=...)"
    ↓
Linked markdown passed to display component
    ↓
STANDALONE_TITLE_LINK_TRANSFORMER parses links into StandaloneTitleLinkNode
```

### Editor with AI Suggestions (Current - No Links)
```
AI generates CriticMarkup: {++new text++}, {--old text--}
    ↓
preprocessCriticMarkup() normalizes multiline patterns
    ↓
$convertFromMarkdownString() with MARKDOWN_TRANSFORMERS
    ↓
CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER creates DiffTagNodeInline
    ↓
Editor displays diffs BUT no whitelist term links are applied
```

## Proposed Solution: Trigger-Based Link Overlay

### Approach

Replace the deferred "LinkOverlayPlugin" continuous monitoring approach with a simpler **on-demand function** called at specific trigger points.

```typescript
// Exposed via LexicalEditorRef
applyLinkOverlay: (explanationId: number) => Promise<void>;

// Called by parent at trigger points:
await editorRef.current?.applyLinkOverlay(explanationId);
```

### Trigger Points

| Trigger | When | Why |
|---------|------|-----|
| Initial article load | After `setContentFromMarkdown()` | Apply links to fresh content |
| AI suggestions applied | After CriticMarkup is imported | Links appear inside diff nodes |
| Diff accept/reject | After user accepts or rejects a diff | Text positions may have changed |

### Preconditions

- **`explanationId` required**: If no `explanationId` is provided, `applyLinkOverlay()` returns early without applying links
- Both draft and published explanations have IDs - links work for drafts too
- The `explanationId` check handles edge cases where the editor is used without an explanation context

### Implementation

The `applyLinkOverlay()` function will:
1. Return early if no `explanationId` provided
2. Fetch heading links + whitelist + per-article overrides via server action
3. Traverse Lexical tree using `$dfs()` to find TextNodes
4. **Skip TextNodes inside existing LinkNode or StandaloneTitleLinkNode** (avoids double-processing)
5. Match heading text and whitelisted terms (longest-first, first-occurrence-only for terms)
6. Split TextNodes and wrap matches in `StandaloneTitleLinkNode`

### Link Clearing Behavior

- `applyLinkOverlay()` does **NOT** clear existing links first
- Instead, it skips over TextNodes that are already inside a LinkNode
- This handles pre-existing links from markdown import naturally
- After diff accept/reject, re-running overlay will add links to any new/changed text

### Key Code Patterns (from existing codebase)

**Term matching** (from `linkResolver.ts`):
- `isWordBoundary()` - checks whitespace/punctuation (hyphens NOT boundaries)
- First-occurrence tracking via `Set<string>`
- Longest-term-first matching order

**Lexical node manipulation** (from `importExportUtils.ts`):
- `$dfs()` for tree traversal
- `TextNode.splitText()` for splitting at match positions
- `node.replace()` for swapping nodes

**StandaloneTitleLinkNode** (from `StandaloneTitleLinkNode.ts`):
- `$createStandaloneTitleLinkNode(url)` factory
- `$isStandaloneTitleLinkNode(node)` type guard
- Custom click handler for `/standalone-title?t=` URLs

### Implementation Details

#### Checking LinkNode Ancestry

To skip TextNodes already inside a link, traverse ancestors:

```typescript
function isInsideLinkNode(node: LexicalNode): boolean {
  let parent = node.getParent();
  while (parent !== null) {
    if ($isLinkNode(parent) || $isStandaloneTitleLinkNode(parent)) {
      return true;
    }
    parent = parent.getParent();
  }
  return false;
}
```

#### Handling Multiple Matches in One TextNode

Process matches **right-to-left** within each TextNode to avoid index drift:

```typescript
// Within editor.update():
const textContent = textNode.getTextContent();
const matches = findAllMatches(textContent, terms); // Returns sorted by startIndex

// Process from end to start
for (let i = matches.length - 1; i >= 0; i--) {
  const match = matches[i];
  wrapMatchInLink(textNode, match.startIndex, match.endIndex, match.url);
}
```

#### TextNode.splitText() Edge Cases

`splitText()` returns different array lengths based on split positions:

```typescript
function wrapMatchInLink(
  textNode: TextNode,
  startIndex: number,
  endIndex: number,
  url: string
): void {
  const textLength = textNode.getTextContentSize();

  if (startIndex === 0 && endIndex === textLength) {
    // Entire node is the match - wrap without splitting
    const linkNode = $createStandaloneTitleLinkNode(url);
    linkNode.append(textNode);
    textNode.replace(linkNode); // Wrong - textNode is now child
    // Correct approach:
    const clone = $createTextNode(textNode.getTextContent());
    const linkNode = $createStandaloneTitleLinkNode(url);
    linkNode.append(clone);
    textNode.replace(linkNode);
  } else if (startIndex === 0) {
    // Match at start: splitText returns [match, after]
    const [match, after] = textNode.splitText(endIndex);
    const linkNode = $createStandaloneTitleLinkNode(url);
    linkNode.append(match);
    match.replace(linkNode);
  } else if (endIndex === textLength) {
    // Match at end: splitText returns [before, match]
    const [before, match] = textNode.splitText(startIndex);
    const linkNode = $createStandaloneTitleLinkNode(url);
    linkNode.append(match);
    match.replace(linkNode);
  } else {
    // Match in middle: splitText returns [before, match, after]
    const [before, match, after] = textNode.splitText(startIndex, endIndex);
    const linkNode = $createStandaloneTitleLinkNode(url);
    linkNode.append(match);
    match.replace(linkNode);
  }
}
```

#### Heading Matching at Lexical Level

Headings in Lexical are `HeadingNode` elements (not markdown `##` prefixed). Match against stored titles:

```typescript
// Heading links from DB: { headingText: "Machine Learning", standaloneTitle: "..." }
// In Lexical tree, find HeadingNode and match its text content

const nodes = $dfs($getRoot());
nodes.forEach(({ node }) => {
  if ($isHeadingNode(node)) {
    const headingText = node.getTextContent().trim();
    const headingLink = headingLinks.find(h => h.headingText === headingText);
    if (headingLink) {
      // Wrap all text children in link
      wrapHeadingContent(node, headingLink.standaloneTitle);
    }
  }
});
```

#### Transaction Batching

All modifications must occur in a single `editor.update()` call:

```typescript
async applyLinkOverlay(explanationId: number): Promise<void> {
  if (!explanationId) return;

  // Fetch data OUTSIDE editor.update()
  const linkData = await getLinkDataForLexicalOverlayAction(explanationId);

  // All DOM mutations in ONE update call
  editor.update(() => {
    const matchedTerms = new Set<string>(); // First-occurrence tracking
    const nodes = $dfs($getRoot());

    for (const { node } of nodes) {
      if ($isTextNode(node) && !isInsideLinkNode(node)) {
        processTextNode(node, linkData, matchedTerms);
      }
    }
  });
}

## Design Decisions

### 1. Trigger-Based vs Plugin-Based

**Chosen: Trigger-Based**

| Aspect | Trigger-Based | Plugin-Based |
|--------|--------------|--------------|
| Complexity | Lower - explicit calls | Higher - update listeners |
| Debugging | Easier - clear cause/effect | Harder - async reactions |
| Performance | Better - runs only when needed | Worse - monitors all changes |
| Control | Parent controls timing | Plugin decides internally |

### 2. Unified vs Hybrid Flow

**Chosen: Hybrid**

- **Non-editor display**: Keep markdown-level linking (SSR benefits, no client JS)
- **LexicalEditor context**: Use Lexical-level linking via `applyLinkOverlay()`

This keeps SSR benefits for read-only pages while unifying the editor experience.

### 3. Heading Handling

**Chosen: Both headings AND key terms**

- Content is stored **plain** (no embedded links) per Phase 5-7 of the plan
- Heading standalone titles are stored in `article_heading_links` table
- `applyLinkOverlay()` fetches BOTH heading links AND whitelist terms
- Both are applied at Lexical tree level during overlay
- This unifies the linking approach for the editor context

## Files to Implement

| File | Change | Purpose |
|------|--------|---------|
| `/src/actions/actions.ts` | Add action | `getLinkDataForLexicalOverlayAction()` - fetches heading links + whitelist + overrides |
| `/src/editorFiles/lexicalEditor/LexicalEditor.tsx` | Add ref method | `applyLinkOverlay(explanationId)` |
| `/src/editorFiles/lexicalEditor/DiffTagNode.ts` | Update export | Handle `standalone-title-link` in `exportNodeToMarkdown()` |

## Export Behavior

When content with links inside DiffTagNodeInline is exported:

1. `DiffTagNodeInline.exportMarkdown()` iterates children
2. For link children: returns `[text](url)`
3. Wrapped in CriticMarkup: `{++[Machine Learning](/standalone-title?t=...)++}`

**Required fix**: `exportNodeToMarkdown()` in `DiffTagNode.ts` needs to handle `standalone-title-link` node type.

The current implementation has a complex structure handling containers, headings, lists, etc. The fix must:
1. Add `standalone-title-link` to the existing `link` case
2. Use `node.getURL()` method (inherited from LinkNode)
3. Preserve URL encoding (already encoded in the URL)

```typescript
// Current (around line 170 in DiffTagNode.ts)
if (nodeType === 'link') {
  const text = node.getTextContent();
  const url = node.getURL();
  return `[${text}](${url})`;
}

// Updated - add standalone-title-link to the condition
if (nodeType === 'link' || nodeType === 'standalone-title-link') {
  const text = node.getTextContent();
  const url = node.getURL();
  return `[${text}](${url})`;
}
```

**Note**: `StandaloneTitleLinkNode` extends `LinkNode`, so `getURL()` is available.

## Testing Strategy

1. **Unit tests**: Term matching, word boundaries, first-occurrence, override handling
2. **Integration tests**:
   - Load article → verify links applied
   - Apply AI suggestion → verify links inside diff nodes
   - Accept diff → verify links persist
3. **Manual tests**: Click links inside insertions/deletions, verify navigation works

## Resolved Design Questions

1. **Should `applyLinkOverlay()` clear existing links first?**
   - **Decision**: No - skip over existing links instead. Simpler and handles pre-existing links naturally.

2. **Should we debounce multiple rapid triggers?**
   - **Decision**: No - explicit triggers are already intentional.

3. **How to handle links that span across diff boundaries?**
   - **Decision**: Skip matches that would cross DiffTagNode boundaries.

4. **Should headings be handled by the overlay?**
   - **Decision**: Yes - fetch from `article_heading_links` and apply at Lexical level alongside key terms.

5. **What if no `explanationId`?**
   - **Decision**: Return early, skip linking. This is an edge case (editor used outside explanation context).

6. **Should we cache whitelist data?**
   - **Decision**: Deferred - fetch via server action each time, optimize later if needed.
   - **Caveat**: Diff accept/reject may fire rapidly. Consider caching link data in a ref with short TTL (e.g., 5s) if performance becomes an issue.

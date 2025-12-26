# AI Suggestions Pipeline - Validation Plan

## Overview

The 4-step AI suggestions pipeline has validation gaps causing broken suggestions. This plan addresses the highest-priority fixes.

**Pipeline Steps:**
1. Generate AI Suggestions (LLM → JSON with edits array)
2. Apply AI Suggestions (LLM merges edits into original)
3. Generate AST Diff (markdown → CriticMarkup)
4. Preprocess CriticMarkup (normalize for Lexical editor)

---

## Priority Table

| Pri | ID | Issue | File | Effort |
|-----|-----|-------|------|--------|
| **P0** | P | Edit context anchoring - edits lack location context | `aiSuggestion.ts` | Medium |
| **P0** | B2 | Step 2 content preservation - LLM deletes content | `aiSuggestion.ts` | Low |
| **P0** | B3 | CriticMarkup syntax validation - unbalanced markers | `pipelineValidation.ts` | Medium |
| **P0** | H | Nested braces break regex parsing | `importExportUtils.ts` | High |
| **P0** | I | Multiple `~>` separators fail silently | `importExportUtils.ts` | Low |
| **P1** | C | Special chars break CriticMarkup | `markdownASTdiff.ts` | Medium |
| **P1** | K | Malformed markdown crashes AST parsing | `aiSuggestion.ts` | Low |
| **P1** | M | `<br>` conversion corrupts code blocks | `importExportUtils.ts` | Medium |
| **P1** | N | Empty content passes validation | `aiSuggestion.ts` | Low |
| **P1** | E1 | No pipeline-level timeout | `aiSuggestion.ts` | Medium |

---

## P0 Fixes (Critical)

### P. Edit Context Anchoring

**Problem:** Step 1 outputs edits without surrounding context, so Step 2 can't locate where to apply them.

**Solution:** Require each edit to include anchor sentences (before/after) from original.

**Step 1 Prompt Addition:**
```
- CRITICAL: Each edit MUST include:
  1. The last sentence BEFORE your edit (from original) - as anchor
  2. Your actual edited content
  3. The first sentence AFTER your edit (from original) - as anchor
- Skip before-anchor if editing at start, skip after-anchor if editing at end
```

**Example:**
```
Original: "The sky is blue. Cats are mammals. Dogs are loyal."
Edit middle sentence:
{
  "edits": [
    "The sky is blue. Cats are fascinating creatures. Dogs are loyal.",
    "... existing text ..."
  ]
}
```

**Step 2 Prompt Addition:**
```
Each edit includes anchor sentences from original. Use them to locate where to apply the edit.
```

**Validation:** Check that first/last sentences of each edit exist in original.

---

### B2. Step 2 Content Preservation

**Problem:** LLM can delete most content or leave unexpanded markers.

**Validation:**
```typescript
function validateStep2Output(original: string, edited: string): ValidationResult {
  const issues: string[] = [];

  // Length check (allow 50% variance)
  const ratio = edited.length / original.length;
  if (ratio < 0.5 || ratio > 2.0) {
    issues.push(`Suspicious length: ${Math.round(ratio * 100)}% of original`);
  }

  // Heading preservation
  const origHeadings = (original.match(/^#{1,6} .+$/gm) || []).length;
  const editedHeadings = (edited.match(/^#{1,6} .+$/gm) || []).length;
  if (editedHeadings < origHeadings * 0.5) {
    issues.push(`Lost headings: ${origHeadings} → ${editedHeadings}`);
  }

  // Unexpanded markers
  if (edited.includes('... existing text ...')) {
    issues.push('Contains unexpanded markers');
  }

  return { valid: issues.length === 0, issues, severity: 'error' };
}
```

---

### B3. CriticMarkup Syntax Validation

**Problem:** Unbalanced `{++`, `--}`, `~~}` markers break editor.

**Validation:**
```typescript
function validateCriticMarkup(content: string): ValidationResult {
  const issues: string[] = [];

  const insertOpen = (content.match(/\{\+\+/g) || []).length;
  const insertClose = (content.match(/\+\+\}/g) || []).length;
  if (insertOpen !== insertClose) {
    issues.push(`Unbalanced insertions: ${insertOpen} opens, ${insertClose} closes`);
  }

  // Same for deletions {-- --} and substitutions {~~ ~~}

  return { valid: issues.length === 0, issues, severity: 'error' };
}
```

---

### H. Balanced Brace Parsing

**Problem:** Regex `/\{([+-~]{2})([\s\S]+?)\1\}/` fails on nested braces like `{++code with {curly}++}`.

**Solution:** Stack-based parser instead of regex.

```typescript
function extractBalancedCriticMarkup(input: string, startIndex: number): {
  content: string; marker: string; endIndex: number;
} | null {
  const markerMatch = input.slice(startIndex).match(/^\{([+-~]{2})/);
  if (!markerMatch) return null;

  const marker = markerMatch[1];
  const closeMarker = marker + '}';
  let depth = 1, i = startIndex + 3;

  while (i < input.length && depth > 0) {
    if (input.slice(i, i + 3) === '{' + marker) depth++;
    else if (input.slice(i, i + 3) === closeMarker) depth--;
    if (depth > 0) i++;
  }

  if (depth !== 0) return null;
  return { content: input.slice(startIndex + 3, i), marker, endIndex: i + 3 };
}
```

---

### I. Update Marker Parsing

**Problem:** `split('~>')` fails when content contains `~>`.

**Solution:** Use `indexOf` to find first separator only.

```typescript
function parseUpdateContent(inner: string): { before: string; after: string } | null {
  const idx = inner.indexOf('~>');
  if (idx === -1) return null;
  return { before: inner.slice(0, idx), after: inner.slice(idx + 2) };
}
```

---

## P1 Fixes (Important)

### C. Character Escaping

**Problem:** Content with `{++` or `~>` breaks CriticMarkup.

**Solution:** Escape before wrapping, unescape on export.

```typescript
function escapeCriticMarkupContent(text: string): string {
  return text
    .replace(/\{(\+\+|--|~~)/g, '\\{$1')
    .replace(/(\+\+|--|~~)\}/g, '$1\\}')
    .replace(/~>/g, '\\~>');
}
```

---

### K. Safe AST Parsing

**Problem:** Malformed markdown from Step 2 crashes `remarkParse`.

**Solution:** Wrap with try-catch.

```typescript
function safeParseMarkdown(content: string): { ast: Root; issues: string[] } {
  try {
    return { ast: unified().use(remarkParse).parse(content), issues: [] };
  } catch (e) {
    return { ast: createFallbackAST(content), issues: [`Parse error: ${e.message}`] };
  }
}
```

---

### M. Code Block Protection

**Problem:** `<br>` replacement corrupts code blocks.

**Solution:** Skip preprocessing inside code fences.

```typescript
function isInsideCodeBlock(content: string, index: number): boolean {
  const before = content.slice(0, index);
  return (before.match(/```/g) || []).length % 2 === 1;
}
```

---

### N. Empty Content Validation

**Problem:** Empty strings pass Zod schema.

**Solution:** Add minimum length check for content segments.

---

### E1. Pipeline Timeout

**Problem:** No overall timeout (each LLM call could be 60s).

**Solution:** Add 90s pipeline-level timeout with AbortController.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/editorFiles/validation/pipelineValidation.ts` | **CREATE** - All validators |
| `src/editorFiles/aiSuggestion.ts` | Prompts (P), schema (N), safe parse (K), timeout (E1) |
| `src/editorFiles/lexicalEditor/importExportUtils.ts` | Stack parser (H), update fix (I), code blocks (M) |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | Escaping (C) |

---

## Implementation Order

1. Create `pipelineValidation.ts` with validators (B2, B3, P)
2. Update prompts in `aiSuggestion.ts` (P, A2)
3. Fix `importExportUtils.ts` parsing (H, I, M)
4. Add escaping in `markdownASTdiff.ts` (C)
5. Add safe parse and timeout in `aiSuggestion.ts` (K, E1)
6. Integrate validators into pipeline
7. Add tests

---

## Lower Priority (P2/P3)

| ID | Issue |
|----|-------|
| L | Recursion depth limit in AST diff |
| O | Unescape function for export |
| B2.5 | LaTeX/code/link/image preservation validation |
| F | Telemetry integration |
| D1/D2 | Retry and fallback mechanisms |

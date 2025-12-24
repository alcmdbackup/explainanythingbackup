# Unit Test Gaps: AST Diff and Preprocess Functions

## Summary

The AI suggestions pipeline has comprehensive test coverage except for two pure transformation functions that lack dedicated unit tests.

## Pipeline Test Coverage

| Component | Unit Tests | E2E Tests | Status |
|-----------|------------|-----------|--------|
| AISuggestionsPanel UI | 60+ | Yes | ✅ Covered |
| Server Action / API Route | — | Mocked | ✅ Thin wrapper |
| Steps 1-2 (OpenAI calls) | — | Mocked | ✅ Non-deterministic |
| **Step 3: AST Diff** | ❌ None | Implicit | **Gap** |
| **Step 4: Preprocess** | ❌ None | Implicit | **Gap** |
| Editor DiffTag Nodes | 115+ | Yes | ✅ Covered |

## Gap 1: `RenderCriticMarkupFromMDAstDiff`

**File:** `src/editorFiles/markdownASTdiff/markdownASTdiff.ts`

**Purpose:** Compares original vs edited markdown as AST, outputs CriticMarkup annotations.

**Why unit tests matter:**
- Complex algorithm with semantic diff logic
- Bugs cause silent diff corruption
- Pure function: input (two markdown strings) → output (CriticMarkup string)
- 30+ test fixtures already exist in `src/testing/utils/editor-test-helpers.ts`

**Suggested test cases:**
- Simple text changes (word, sentence, paragraph)
- Heading changes (level changes, content changes)
- List modifications (add/remove/reorder items)
- Code block handling (inline and fenced)
- Nested formatting (bold within italic, etc.)
- Edge cases from existing fixtures

**Test file to create:** `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts`

## Gap 2: `preprocessCriticMarkup`

**File:** `src/editorFiles/lexicalEditor/importExportUtils.ts`

**Purpose:** Normalizes CriticMarkup for editor consumption.

**Why unit tests matter:**
- Regex-based normalization can break silently
- Handles multiline patterns, heading formats
- Pure function: input (raw CriticMarkup) → output (normalized CriticMarkup)

**Suggested test cases:**
- Multiline CriticMarkup normalization
- Heading format preservation within diffs
- Whitespace handling around markup
- Adjacent diff handling
- Empty paragraph handling

**Test file to create:** `src/editorFiles/lexicalEditor/importExportUtils.test.ts` (or add to existing)

## Existing Test Fixtures

`src/testing/utils/editor-test-helpers.ts` contains comprehensive fixtures:

**Insertion cases (5):** single-word, multi-word, sentence, paragraph, with formatting
**Deletion cases (3):** single-word, sentence, paragraph
**Update cases (3):** word replacement, sentence rewrite, phrase update
**Mixed cases (3):** insert+delete, multiple updates, complex edits
**Edge cases (16):** headings, lists, code blocks, unicode, links, tables, etc.

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

## Implementation Priority

1. **Step 3 (AST Diff)** - Higher priority, more complex logic
2. **Step 4 (Preprocess)** - Lower priority, simpler transformations

## Files to Modify

- Create: `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts`
- Create or extend: `src/editorFiles/lexicalEditor/importExportUtils.test.ts`
- Reference: `src/testing/utils/editor-test-helpers.ts` (existing fixtures)

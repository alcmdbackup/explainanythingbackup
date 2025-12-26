# Bug Investigation: AI Suggestion Accept Leaves CriticMarkup and `<br>` Tags

**Date:** 2025-12-26
**Status:** Investigating - Root cause not yet confirmed

## Symptoms

### Bug 1: CriticMarkup syntax persists after accepting suggestions

**Steps to reproduce:**
1. Start with clean markdown content (Text A)
2. Open AI Suggestions panel, enter prompt, click "Get Suggestions"
3. AI returns content with CriticMarkup diffs
4. Click accept on the suggestions
5. **Expected:** Clean text with accepted changes
6. **Actual:** Text shows raw CriticMarkup syntax `{~~old~>new~~}` and `<br><br>` tags

**Example:**

Text A (before):
```markdown
## [Early Life and College Career](/standalone-title?t=Jerry%20Rice%20Early%20Life%20and%20College)

Jerry Rice was born on October 13, 1962, in Starkville, Mississippi. From a young age, Rice showed a passion for [football](/standalone-title?t=football), excelling in multiple sports during his high school years...
```

Text B (after accepting - BUGGY):
```markdown
## Early Life and College Career

{~~Jerry Rice was born on October 13, 1962, in Starkville, Mississippi. From a young age, Rice showed a passion for football, excelling in multiple sports during his high school years.<br><br>~>Jerry Rice, born on October 13, 1962, in Starkville, Mississippi, developed a deep passion for football early in life.<br><br>~~}
```

### Bug 2: Mode toggle resurrects accepted suggestions

**Steps to reproduce:**
1. Complete Bug 1 flow (accept suggestions)
2. Switch from markdown rendering mode to plaintext mode
3. Switch back to markdown rendering mode
4. **Expected:** Content stays as accepted
5. **Actual:** Previously-accepted suggestions reappear as diff options

---

## Investigation Progress

### Hypotheses

#### Hypothesis A: CriticMarkup import transformer fails to match
The `CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER` may not be matching the CriticMarkup pattern, leaving it as literal text.

**Evidence needed:**
- Check if DiffTagNodes are created after `setContentFromMarkdown()`
- Verify regex matches the normalized content

#### Hypothesis B: Text node splitting breaks regex match
Other transformers (LINK, BOLD, etc.) may process the text first and split it, breaking the CriticMarkup pattern.

**Evidence needed:**
- Check transformer order in MARKDOWN_TRANSFORMERS
- Verify if content contains markdown formatting inside CriticMarkup

#### Hypothesis C: `<br>` normalization creates unmatchable patterns
`normalizeMultilineCriticMarkup()` replaces `\n` with `<br>`, which may interact poorly with other processing.

**Evidence needed:**
- Log output of preprocessing steps
- Check if `<br>` tags interfere with regex matching

---

## Code Path Analysis

### Import Flow (AI suggestions → Editor)

```
1. AISuggestionsPanel.onContentChange(newContent)
   └── page.tsx:1381: editorRef.current.setContentFromMarkdown(newContent)
       └── LexicalEditor.tsx:383: preprocessCriticMarkup(markdown)
           └── importExportUtils.ts:905: normalizeMultilineCriticMarkup()
               └── Replaces \n with <br> inside CriticMarkup
       └── LexicalEditor.tsx:398: $convertFromMarkdownString(preprocessedMarkdown, MARKDOWN_TRANSFORMERS)
           └── CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER should match {~~...~~}
           └── Creates DiffTagNodeInline with beforeContainer/afterContainer
       └── LexicalEditor.tsx:404: replaceBrTagsWithNewlines()
           └── Converts <br> back to \n in text nodes
```

### Accept Flow (User clicks accept)

```
1. DiffTagHoverPlugin.handleClick() detects accept button click
   └── diffTagMutations.ts:22: acceptDiffTag(editor, nodeKey)
       └── For update tag:
           - Get children[1] (afterContainer)
           - Extract container's children
           - Insert before DiffTagNode
           - Remove DiffTagNode
```

### Export Flow (Reading content from editor)

```
1. AISuggestionsPanel.handleSubmit() needs current content
   └── editorRef.current.getContentAsMarkdown()
       └── LexicalEditor.tsx:415: exportMarkdownReadOnly()
           └── $convertToMarkdownString(MARKDOWN_TRANSFORMERS)
               └── DIFF_TAG_EXPORT_TRANSFORMER converts DiffTagNodes to CriticMarkup
```

---

## Key Files

| File | Role |
|------|------|
| `src/editorFiles/lexicalEditor/importExportUtils.ts` | CriticMarkup transformers, preprocessing |
| `src/editorFiles/lexicalEditor/diffTagMutations.ts` | Accept/reject logic |
| `src/editorFiles/lexicalEditor/LexicalEditor.tsx` | setContentFromMarkdown, getContentAsMarkdown |
| `src/components/AISuggestionsPanel.tsx` | Triggers content updates |
| `src/app/results/page.tsx` | Connects panel to editor |

---

## Recent Changes (may be related)

1. **Commit af62d2e:** Changed AISuggestionsPanel to read from `editorRef.getContentAsMarkdown()` instead of prop
2. **Commit 28f70b8:** Changed `getContentAsMarkdown()` to use `exportMarkdownReadOnly()` instead of mutating `replaceDiffTagNodesAndExportMarkdown()`

---

## Next Steps

1. **Add diagnostic logging** to trace exact content at each step:
   - What AI pipeline returns
   - What `preprocessCriticMarkup()` outputs
   - Whether CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER regex matches
   - What nodes exist after `$convertFromMarkdownString()`
   - What content exists after `acceptDiffTag()`

2. **Reproduce with Playwright** to capture exact state at each step

3. **Check if issue existed before recent commits** by testing on prior commit

---

## Related Documentation

- `docs/planning/lexical_editor_framework/getting_rid_of_current_content.md` - Architecture analysis
- `docs/planning/bug_investigations_second_round_AI_suggestions.md` - Prior investigation of stale content bug

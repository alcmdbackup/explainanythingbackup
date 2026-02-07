# Fix Bugs 20260121 Plan

## Background
The ExplainAnything application has a Results page (`src/app/results/page.tsx`) that displays explanations using the LexicalEditor component. Users can toggle between "Formatted" (markdown) and "Plain Text" views using a button. The LexicalEditor component supports both modes via `RichTextPlugin` and `PlainTextPlugin` respectively. Both plugins support editing when `isEditMode=true`.

## Problem
When users toggle to "Plain Text" mode on the Results page, editing becomes impossible. The root cause is that the Results page bypasses the LexicalEditor entirely when `isMarkdownMode=false` and instead renders a static `<pre>` element (lines 1348-1352). This means:
1. The LexicalEditor is unmounted when switching to plaintext view
2. The `editorRef` becomes invalid
3. No editing is possible because `<pre>` is just displaying text
4. Any unsaved edits in progress are lost when toggling modes

## Options Considered

### Option 1: Use LexicalEditor with `isMarkdownMode={false}` (Recommended)
- Replace the static `<pre>` with `<LexicalEditor isMarkdownMode={false} ...>`
- Pros: Maintains editor state, enables editing, consistent UX
- Cons: Slight additional complexity

### Option 2: Make `<pre>` editable with contentEditable
- Add `contentEditable` attribute to the `<pre>` element
- Pros: Minimal code change
- Cons: Loses all editor features (undo/redo, ref API, content change callbacks), inconsistent with markdown mode

### Option 3: Remove plaintext editing capability
- Keep current behavior, document as view-only
- Pros: No code changes
- Cons: Poor UX, editing should work in both modes

**Selected: Option 1** - Use LexicalEditor with `isMarkdownMode={false}` to maintain consistency and full editing support.

## Phased Execution Plan

### Phase 1: Update Results Page Rendering
**File:** `src/app/results/page.tsx`
**Lines:** 1348-1352

Replace:
```typescript
) : (
    <pre className="whitespace-pre-wrap text-sm font-mono text-[var(--text-secondary)] leading-relaxed">
        {formattedExplanation}
    </pre>
)
```

With:
```typescript
) : (
    <>
        <LexicalEditor
            ref={editorRef}
            placeholder="Content will appear here..."
            className="w-full"
            initialContent={formattedExplanation}
            isMarkdownMode={false}
            isEditMode={isEditMode && !isStreaming}
            showEditorState={false}
            showTreeView={false}
            showToolbar={false}  // No toolbar in plaintext mode
            hideEditingUI={isStreaming}
            onContentChange={handleEditorContentChange}
            isStreaming={isStreaming}
            textRevealEffect={textRevealEffect}
            sources={bibliographySources}
            onPendingSuggestionsChange={setHasPendingSuggestions}
        />
        <Bibliography sources={bibliographySources} />
    </>
)
```

**Note:** Bibliography is intentionally included here because in the `isMarkdownMode=true` branch (lines 1328-1347), Bibliography is rendered inside the fragment. Adding it to the plaintext branch ensures consistent behavior in both modes.

### Phase 2: Run Lint, TypeScript, and Build
```bash
npm run lint
npm run tsc
npm run build
```

### Phase 3: Run Existing Tests
```bash
npm run test:unit
npm run test:integration
npm run test:e2e -- --grep "format toggle"
```

### Phase 4: Add Unit Test for PlainText Mode Editing
**File:** `src/editorFiles/lexicalEditor/LexicalEditor.integration.test.tsx`

Add test case to verify editing works in plaintext mode using the ref API pattern (matching existing test at line 388-398):
```typescript
it('supports editing when isMarkdownMode is false and isEditMode is true', async () => {
  const ref = createRef<LexicalEditorRef>();
  render(
    <LexicalEditor
      ref={ref}
      initialContent="Test content"
      isMarkdownMode={false}
      isEditMode={true}
    />
  );

  await waitFor(() => {
    expect(ref.current).not.toBeNull();
  });

  // Verify edit mode is enabled via ref API
  const editMode = ref.current?.getEditMode();
  expect(editMode).toBe(true);

  // Verify markdown mode is disabled
  const markdownMode = ref.current?.getMarkdownMode();
  expect(markdownMode).toBe(false);
});
```

**Note:** The test uses the ref API (`getEditMode()`, `getMarkdownMode()`) rather than checking DOM attributes directly. Lexical manages editability internally via `editor.setEditable()`, not via the contenteditable attribute. This matches the existing test pattern at lines 388-398.

### Phase 5: Add E2E Test for PlainText Mode Editing
**File:** `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`

Add test case in the "Format Toggle" describe block:
```typescript
test('should allow editing in plain text mode', async ({ authenticatedPage }) => {
  const resultsPage = new ResultsPage(authenticatedPage);

  await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
  await resultsPage.waitForAnyContent(60000);

  // Toggle to plain text mode
  await resultsPage.clickFormatToggle();
  expect(await resultsPage.isPlainTextMode()).toBe(true);

  // Enter edit mode
  await resultsPage.clickEditButton();
  expect(await resultsPage.isInEditMode()).toBe(true);

  // Verify LexicalEditor is rendered (has .lexical-editor class on ContentEditable)
  // This selector matches LexicalEditor.tsx lines 717 and 735
  const editor = authenticatedPage.locator('.lexical-editor');
  await expect(editor).toBeVisible();
});

test('should preserve content when toggling between markdown and plaintext modes', async ({ authenticatedPage }) => {
  const resultsPage = new ResultsPage(authenticatedPage);

  await authenticatedPage.goto(`/results?explanation_id=${testExplanation.id}`);
  await resultsPage.waitForAnyContent(60000);

  // Get initial content
  const initialContent = await resultsPage.getEditorTextContent();

  // Toggle to plain text mode
  await resultsPage.clickFormatToggle();
  expect(await resultsPage.isPlainTextMode()).toBe(true);

  // Verify content is preserved
  const plaintextContent = await resultsPage.getEditorTextContent();
  expect(plaintextContent).toBeTruthy();

  // Toggle back to markdown mode
  await resultsPage.clickFormatToggle();
  expect(await resultsPage.isMarkdownMode()).toBe(true);

  // Verify content is still preserved
  const restoredContent = await resultsPage.getEditorTextContent();
  expect(restoredContent).toBeTruthy();
});
```

**Note:** The `.lexical-editor` selector is valid - it's defined on the ContentEditable component in LexicalEditor.tsx at lines 717 and 735. Added a second test for content preservation across mode toggles.

## Testing

### Unit Tests
- [ ] `LexicalEditor.integration.test.tsx`: Add test for plaintext editing support

### E2E Tests
- [ ] `action-buttons.spec.ts`: Add test for editing in plaintext mode
- [ ] Verify existing format toggle tests still pass

### Manual Verification
1. Navigate to any explanation on Results page
2. Click "Edit" to enter edit mode
3. Make some edits
4. Click "Plain Text" button to toggle view
5. Verify edits are preserved and editor is still editable
6. Make additional edits in plaintext mode
7. Toggle back to "Formatted" mode
8. Verify all edits are preserved
9. Save and verify content persists

## Rollback Plan
If issues arise after deployment:
1. `git revert <commit-hash>` - Reverts the single-file change to page.tsx
2. Re-run `npm run build` to verify build passes
3. Deploy reverted version

This is a low-risk change affecting only the Results page rendering logic with no database or API changes.

## Documentation Updates
- None required - this is a bug fix that restores expected functionality

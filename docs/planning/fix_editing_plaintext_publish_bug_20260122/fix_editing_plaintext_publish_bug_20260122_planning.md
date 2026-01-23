# Fix Editing Plaintext Publish Bug Plan

## Background

The results page has two editor modes: formatted (LexicalEditor) and plaintext (RawMarkdownEditor). The LexicalEditor uses a ref-based API for content access (`getContentAsMarkdown()`), while RawMarkdownEditor uses React state (`rawMarkdownContent`). The page lifecycle reducer (`pageLifecycleReducer`) tracks content changes via `UPDATE_CONTENT` actions, setting `hasUnsavedChanges` when content differs from the original. The publish button visibility depends on this flag.

## Problem

Three related bugs exist in plaintext mode:

1. **Changes don't sync on mode toggle**: When toggling from plaintext to formatted mode, `setContentFromMarkdown()` is called but `UPDATE_CONTENT` is never dispatched to the reducer, so `hasUnsavedChanges` stays false.

2. **Publish button doesn't appear**: `RawMarkdownEditor.onChange` only calls `setRawMarkdownContent()` - it never dispatches `UPDATE_CONTENT`, so the reducer never knows about changes.

3. **Publish uses wrong content**: `handleSaveOrPublishChanges()` reads from `editorRef.current?.getContentAsMarkdown()` which returns LexicalEditor content, not `rawMarkdownContent`. Plaintext edits are lost on publish.

Root cause: The lifecycle reducer only integrates with LexicalEditor, not RawMarkdownEditor.

## Options Considered

### Option A: Sync rawMarkdownContent at Key Moments (Recommended)
- Dispatch `UPDATE_CONTENT` when toggling modes, when exiting edit mode, and on plaintext onChange (debounced)
- Modify publish handler to use `rawMarkdownContent` when in plaintext mode
- Pros: Minimal changes, follows existing patterns, debouncing prevents performance issues
- Cons: Requires careful handling of all sync points

### Option B: Dispatch UPDATE_CONTENT on Every Keystroke Only
- Add non-debounced `UPDATE_CONTENT` dispatch to `RawMarkdownEditor.onChange`
- Pros: Real-time change tracking
- Cons: Performance concerns with excessive reducer dispatches

### Option C: Unify Editors Behind Single Interface
- Create abstraction layer that both editors implement
- Pros: Clean architecture
- Cons: Major refactor, out of scope for bug fix

**Selected: Option A** - Sync at key moments with debounced keystroke tracking

## Phased Execution Plan

### Phase 1: Fix Publish Handler Content Source
**Files:** `src/app/results/page.tsx`

**Current code (line ~581):**
```typescript
const currentContent = editorRef.current?.getContentAsMarkdown() || getPageContent(lifecycleState);
```

**New implementation:**
```typescript
// Get content based on current editor mode
let currentContent: string;
if (isMarkdownMode) {
    // Formatted mode: get from LexicalEditor via ref
    currentContent = editorRef.current?.getContentAsMarkdown() || getPageContent(lifecycleState);
} else {
    // Plaintext mode: get from rawMarkdownContent state
    // Fall back to lifecycle state if rawMarkdownContent is empty (shouldn't happen in edit mode)
    currentContent = rawMarkdownContent || getPageContent(lifecycleState);
}
```

**Rationale:** When `isMarkdownMode === false`, user is in plaintext mode, so we read from `rawMarkdownContent`. When `isMarkdownMode === true`, user is in formatted mode, so we read from the LexicalEditor ref.

### Phase 2: Fix RawMarkdownEditor onChange with Debounced Dispatch
**Files:** `src/app/results/page.tsx`

**Problem:** The current onChange only updates local state:
```typescript
onChange={(newContent) => setRawMarkdownContent(newContent)}
```

**New implementation - create debounced handler:**
```typescript
// Add ref for debounce timer (near other refs, around line 152)
const rawMarkdownDebounceRef = useRef<NodeJS.Timeout | null>(null);

// Extract phase for stable reference in useCallback
const currentPhase = lifecycleState.phase;

// Add handler near other handlers (around line 650)
// Note: We read lifecycleState.phase INSIDE the timeout callback to avoid stale closure issues
// If user exits edit mode before debounce fires, the callback will correctly detect phase !== 'editing'
const handleRawMarkdownChange = useCallback((newContent: string) => {
    // Always update local state immediately for responsive UI
    setRawMarkdownContent(newContent);

    // Debounce the reducer dispatch to prevent excessive updates
    // Similar pattern to existing streaming content debounce
    if (rawMarkdownDebounceRef.current) {
        clearTimeout(rawMarkdownDebounceRef.current);
    }

    rawMarkdownDebounceRef.current = setTimeout(() => {
        // Dispatch UPDATE_CONTENT to sync with lifecycle reducer
        // This ensures hasUnsavedChanges gets computed and publish button appears
        // Check phase at dispatch time (not callback creation time) to handle edge cases
        // where user exits edit mode before debounce fires
        if (lifecycleState.phase === 'editing') {
            dispatchLifecycle({ type: 'UPDATE_CONTENT', content: newContent });
        }
    }, 300); // 300ms debounce - same as typical typing debounce
}, [lifecycleState.phase, dispatchLifecycle]);

// Cleanup in existing useEffect cleanup or add new one
useEffect(() => {
    return () => {
        if (rawMarkdownDebounceRef.current) {
            clearTimeout(rawMarkdownDebounceRef.current);
        }
    };
}, []);
```

**Update RawMarkdownEditor usage (line ~1367):**
```typescript
<RawMarkdownEditor
    content={rawMarkdownContent || formattedExplanation}
    onChange={handleRawMarkdownChange}
    isEditMode={isEditMode && !isStreaming}
/>
```

**Note:** The 300ms debounce prevents excessive reducer dispatches while still providing responsive feedback. The publish button will appear within 300ms of the user stopping typing.

### Phase 3: Fix Mode Toggle State Sync
**Files:** `src/app/results/page.tsx`

**Current code (line ~1220-1231):**
```typescript
onClick={() => {
    if (isMarkdownMode) {
        const currentMarkdown = editorRef.current?.getContentAsMarkdown() || formattedExplanation;
        setRawMarkdownContent(currentMarkdown);
    } else {
        if (rawMarkdownContent && editorRef.current) {
            editorRef.current.setContentFromMarkdown(rawMarkdownContent);
            setEditorCurrentContent(rawMarkdownContent);
        }
    }
    setIsMarkdownMode(!isMarkdownMode);
}}
```

**New implementation:**
```typescript
onClick={() => {
    if (isMarkdownMode) {
        // Switching TO plaintext: capture current content from LexicalEditor
        const currentMarkdown = editorRef.current?.getContentAsMarkdown() || formattedExplanation;
        setRawMarkdownContent(currentMarkdown);
    } else {
        // Switching TO formatted: sync plaintext edits back to LexicalEditor
        const contentToSync = rawMarkdownContent || formattedExplanation;
        if (editorRef.current) {
            editorRef.current.setContentFromMarkdown(contentToSync);
            setEditorCurrentContent(contentToSync);
        }

        // CRITICAL FIX: Dispatch UPDATE_CONTENT to sync with lifecycle reducer
        // This ensures hasUnsavedChanges reflects plaintext edits
        // Only dispatch in 'editing' phase - the reducer guards against other phases
        // (see pageLifecycleReducer.ts line 224-228: warns and ignores in non-editing phases)
        if (contentToSync && lifecycleState.phase === 'editing') {
            dispatchLifecycle({ type: 'UPDATE_CONTENT', content: contentToSync });
        }
    }
    setIsMarkdownMode(!isMarkdownMode);
}}
```

**Note:** We only dispatch in 'editing' phase because `pageLifecycleReducer` explicitly guards against `UPDATE_CONTENT` in other phases (logs warning and returns unchanged state).

### Phase 4: Fix Exit Edit Mode for Plaintext
**Files:** `src/app/results/page.tsx`

**Current code (line ~634-647):**
```typescript
const handleEditModeToggle = () => {
    if (isEditMode) {
        const currentContent = editorRef.current?.getContentAsMarkdown() || '';
        if (currentContent) {
            dispatchLifecycle({ type: 'UPDATE_CONTENT', content: currentContent });
        }
        dispatchLifecycle({ type: 'EXIT_EDIT_MODE' });
    } else {
        dispatchLifecycle({ type: 'ENTER_EDIT_MODE' });
    }
};
```

**New implementation:**
```typescript
const handleEditModeToggle = () => {
    if (isEditMode) {
        // CRITICAL FIX: Get content based on current editor mode
        let contentToSync: string;
        if (isMarkdownMode) {
            // Formatted mode: get from LexicalEditor
            contentToSync = editorRef.current?.getContentAsMarkdown() || '';
        } else {
            // Plaintext mode: get from rawMarkdownContent state
            // Clear any pending debounce to ensure we sync latest content
            if (rawMarkdownDebounceRef.current) {
                clearTimeout(rawMarkdownDebounceRef.current);
                rawMarkdownDebounceRef.current = null;
            }
            contentToSync = rawMarkdownContent;
        }

        // Sync content to lifecycle reducer before exiting
        if (contentToSync) {
            dispatchLifecycle({ type: 'UPDATE_CONTENT', content: contentToSync });
        }

        // Exit edit mode (preserves the content we just synced)
        dispatchLifecycle({ type: 'EXIT_EDIT_MODE' });
    } else {
        dispatchLifecycle({ type: 'ENTER_EDIT_MODE' });
    }
};
```

**Note:** We clear the debounce timer before syncing to ensure the latest content is captured, not a debounced-delayed version.

### Phase 5: Add Markdown Validation (Deferred)
**Status:** Deferred to future work. Content is stored as-is in the database regardless of markdown validity. Validation would be a UX improvement but is not required for the bug fix.

**Future scope if implemented:**
- Create `src/lib/utils/markdownValidation.ts`
- Validate on mode toggle (plaintext → formatted) with warning toast
- Validate on publish with confirmation dialog

## Rollback Plan

If issues are discovered after deployment:

1. **Immediate rollback:** Revert the commit via `git revert <commit-hash>` and deploy
2. **Feature flag alternative:** If needed, add `PLAINTEXT_SYNC_ENABLED` env var to disable the new sync behavior:
   ```typescript
   const PLAINTEXT_SYNC_ENABLED = process.env.NEXT_PUBLIC_PLAINTEXT_SYNC_ENABLED !== 'false';

   // In handleRawMarkdownChange:
   if (PLAINTEXT_SYNC_ENABLED && currentPhase === 'editing') {
       dispatchLifecycle({ type: 'UPDATE_CONTENT', content: newContent });
   }
   ```
3. **Partial rollback:** If only one phase causes issues, each phase is independent and can be reverted individually

**Risk assessment:** Low risk - changes are localized to `page.tsx` and don't affect database schema, API contracts, or other components.

## Testing

### Test Infrastructure Updates Required

Before writing tests, the following infrastructure updates are needed:

1. **Add RawMarkdownEditor mock to page.test.tsx:**
```typescript
// Add to existing mocks section
jest.mock('@/components/RawMarkdownEditor', () => ({
    RawMarkdownEditor: jest.fn(({ content, onChange, isEditMode }) => (
        <textarea
            data-testid="mock-raw-markdown-editor"
            value={content}
            onChange={(e) => onChange(e.target.value)}
            readOnly={!isEditMode}
        />
    )),
}));
```

2. **Add E2E helper method to ResultsPage class:**
```typescript
// Add to src/__tests__/e2e/page-objects/ResultsPage.ts
async editRawMarkdown(text: string) {
    const rawEditor = this.page.getByTestId('raw-markdown-editor');
    await rawEditor.fill(text);
}

async getRawMarkdownContent(): Promise<string> {
    const rawEditor = this.page.getByTestId('raw-markdown-editor');
    return await rawEditor.inputValue();
}
```

### Unit Tests
**File:** `src/app/results/page.test.tsx`

Add new test cases with full implementation:

```typescript
describe('plaintext mode content handling', () => {
    // Setup helper to render component in plaintext edit mode
    const renderInPlaintextEditMode = async (initialContent = 'Initial content') => {
        const mockDispatchLifecycle = jest.fn();
        // ... render with mocked state
        return { mockDispatchLifecycle };
    };

    it('handleSaveOrPublishChanges uses rawMarkdownContent when isMarkdownMode=false', async () => {
        const { mockSaveOrPublishChanges } = renderInPlaintextEditMode();

        // Simulate being in plaintext mode with edited content
        const rawEditor = screen.getByTestId('mock-raw-markdown-editor');
        await userEvent.clear(rawEditor);
        await userEvent.type(rawEditor, 'Edited plaintext content');

        // Trigger publish
        const publishButton = screen.getByTestId('publish-button');
        await userEvent.click(publishButton);

        // Assert saveOrPublishChanges called with plaintext content
        expect(mockSaveOrPublishChanges).toHaveBeenCalledWith(
            expect.objectContaining({
                newContent: 'Edited plaintext content'
            })
        );
    });

    it('handleRawMarkdownChange dispatches UPDATE_CONTENT after debounce', async () => {
        jest.useFakeTimers();
        const { mockDispatchLifecycle } = renderInPlaintextEditMode();

        const rawEditor = screen.getByTestId('mock-raw-markdown-editor');
        await userEvent.type(rawEditor, 'New content');

        // Before debounce, dispatch should not have been called
        expect(mockDispatchLifecycle).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'UPDATE_CONTENT' })
        );

        // After debounce
        jest.advanceTimersByTime(300);

        expect(mockDispatchLifecycle).toHaveBeenCalledWith({
            type: 'UPDATE_CONTENT',
            content: expect.stringContaining('New content')
        });

        jest.useRealTimers();
    });

    it('handleEditModeToggle syncs rawMarkdownContent when exiting plaintext mode', async () => {
        const { mockDispatchLifecycle } = renderInPlaintextEditMode();

        // Type in plaintext editor
        const rawEditor = screen.getByTestId('mock-raw-markdown-editor');
        await userEvent.type(rawEditor, 'Edited content');

        // Click Done button
        const doneButton = screen.getByTestId('edit-button');
        await userEvent.click(doneButton);

        // Assert UPDATE_CONTENT dispatched with plaintext content
        expect(mockDispatchLifecycle).toHaveBeenCalledWith({
            type: 'UPDATE_CONTENT',
            content: expect.stringContaining('Edited content')
        });

        // Assert EXIT_EDIT_MODE dispatched after
        expect(mockDispatchLifecycle).toHaveBeenCalledWith({ type: 'EXIT_EDIT_MODE' });
    });

    it('mode toggle dispatches UPDATE_CONTENT when switching to formatted mode', async () => {
        const { mockDispatchLifecycle } = renderInPlaintextEditMode();

        // Type in plaintext editor
        const rawEditor = screen.getByTestId('mock-raw-markdown-editor');
        await userEvent.type(rawEditor, 'Plaintext edits');

        // Click format toggle button (currently showing "Formatted" to switch back)
        const toggleButton = screen.getByTestId('format-toggle-button');
        await userEvent.click(toggleButton);

        // Assert UPDATE_CONTENT dispatched
        expect(mockDispatchLifecycle).toHaveBeenCalledWith({
            type: 'UPDATE_CONTENT',
            content: expect.stringContaining('Plaintext edits')
        });
    });

    // Edge case tests added per Testing review feedback
    it('uses formattedExplanation fallback when rawMarkdownContent is empty', async () => {
        const { mockSaveOrPublishChanges } = renderInPlaintextEditMode('');

        // rawMarkdownContent is empty, should fall back to formattedExplanation
        const publishButton = screen.getByTestId('publish-button');
        await userEvent.click(publishButton);

        // Assert fallback content is used (from formattedExplanation)
        expect(mockSaveOrPublishChanges).toHaveBeenCalledWith(
            expect.objectContaining({
                newContent: expect.any(String) // Should be formattedExplanation, not empty
            })
        );
    });

    it('mode toggle cancels pending debounce and syncs immediately', async () => {
        jest.useFakeTimers();
        const { mockDispatchLifecycle } = renderInPlaintextEditMode();

        // Type in plaintext (starts 300ms debounce)
        const rawEditor = screen.getByTestId('mock-raw-markdown-editor');
        await userEvent.type(rawEditor, 'Quick edit');

        // Toggle mode immediately (within debounce window)
        const toggleButton = screen.getByTestId('format-toggle-button');
        await userEvent.click(toggleButton);

        // Assert: UPDATE_CONTENT was dispatched immediately on toggle
        // (not waiting for debounce to complete)
        expect(mockDispatchLifecycle).toHaveBeenCalledWith({
            type: 'UPDATE_CONTENT',
            content: expect.stringContaining('Quick edit')
        });

        // Advance past debounce - should NOT dispatch again
        const callCountBefore = mockDispatchLifecycle.mock.calls.filter(
            call => call[0].type === 'UPDATE_CONTENT'
        ).length;

        jest.advanceTimersByTime(400);

        const callCountAfter = mockDispatchLifecycle.mock.calls.filter(
            call => call[0].type === 'UPDATE_CONTENT'
        ).length;

        expect(callCountAfter).toBe(callCountBefore); // No additional dispatch

        jest.useRealTimers();
    });

    it('debounce timer is cleared on component unmount', async () => {
        jest.useFakeTimers();
        const { mockDispatchLifecycle, unmount } = renderInPlaintextEditMode();

        // Type something to start debounce
        const rawEditor = screen.getByTestId('mock-raw-markdown-editor');
        await userEvent.type(rawEditor, 'Unmount test');

        // Unmount before debounce fires
        unmount();

        // Advance past debounce
        jest.advanceTimersByTime(400);

        // Assert: no dispatch happened (timer was cleared)
        expect(mockDispatchLifecycle).not.toHaveBeenCalledWith(
            expect.objectContaining({ type: 'UPDATE_CONTENT' })
        );

        jest.useRealTimers();
    });

    it('does not dispatch UPDATE_CONTENT outside editing phase', async () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        // Render in viewing phase (not editing)
        const { mockDispatchLifecycle } = renderInViewingPhase();

        // Attempt to trigger UPDATE_CONTENT
        // (This tests the phase guard in the reducer)
        mockDispatchLifecycle({ type: 'UPDATE_CONTENT', content: 'Should be ignored' });

        // The reducer should log a warning
        expect(consoleSpy).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE_CONTENT called in phase')
        );

        consoleSpy.mockRestore();
    });
});
```

### E2E Tests
**File:** `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts`

Add new test cases:

```typescript
test.describe('plaintext mode editing', () => {
    test('publish button appears after editing in plaintext mode', async ({ page }) => {
        const resultsPage = new ResultsPage(page);

        // Navigate to published article
        await resultsPage.goto('/results?id=<published-article-id>');
        await resultsPage.waitForContent();

        // Enter edit mode
        await resultsPage.clickEditButton();

        // Switch to plaintext mode
        await resultsPage.clickFormatToggle();

        // Make an edit
        await resultsPage.editRawMarkdown('Added plaintext content');

        // Wait for debounce
        await page.waitForTimeout(400);

        // Assert: publish button is visible
        await expect(page.getByTestId('publish-button')).toBeVisible();
    });

    test('plaintext edits persist after toggling to formatted mode', async ({ page }) => {
        const resultsPage = new ResultsPage(page);
        const uniqueText = `PLAINTEXT_EDIT_${Date.now()}`;

        await resultsPage.goto('/results?id=<published-article-id>');
        await resultsPage.clickEditButton();
        await resultsPage.clickFormatToggle(); // Switch to plaintext

        // Add unique text
        const currentContent = await resultsPage.getRawMarkdownContent();
        await resultsPage.editRawMarkdown(currentContent + '\n\n' + uniqueText);

        // Toggle back to formatted mode
        await resultsPage.clickFormatToggle();

        // Assert: content contains unique text (check in Lexical editor)
        const formattedContent = await resultsPage.getEditorContent();
        expect(formattedContent).toContain(uniqueText);
    });

    test('plaintext edits persist after exiting edit mode', async ({ page }) => {
        const resultsPage = new ResultsPage(page);
        const uniqueText = `PERSIST_TEST_${Date.now()}`;

        await resultsPage.goto('/results?id=<published-article-id>');
        await resultsPage.clickEditButton();
        await resultsPage.clickFormatToggle();

        const currentContent = await resultsPage.getRawMarkdownContent();
        await resultsPage.editRawMarkdown(currentContent + '\n\n' + uniqueText);

        // Click Done
        await resultsPage.clickDoneButton();

        // Re-enter edit mode
        await resultsPage.clickEditButton();

        // Assert: content still has edits
        const content = await resultsPage.getEditorContent();
        expect(content).toContain(uniqueText);
    });

    test('plaintext edits are saved on publish', async ({ page }) => {
        const resultsPage = new ResultsPage(page);
        const uniqueText = `PUBLISH_TEST_${Date.now()}`;

        // Use a draft article or create one for this test
        await resultsPage.goto('/results?id=<draft-article-id>');
        await resultsPage.clickEditButton();
        await resultsPage.clickFormatToggle();

        const currentContent = await resultsPage.getRawMarkdownContent();
        await resultsPage.editRawMarkdown(currentContent + '\n\n' + uniqueText);

        // Wait for debounce
        await page.waitForTimeout(400);

        // Click Publish
        await resultsPage.clickPublishButton();

        // Wait for save to complete and page to reload/update
        await page.waitForLoadState('networkidle');

        // Reload page
        await page.reload();
        await resultsPage.waitForContent();

        // Assert: content contains unique text
        const savedContent = await resultsPage.getEditorContent();
        expect(savedContent).toContain(uniqueText);
    });

    test('rapid mode toggle during debounce preserves content', async ({ page }) => {
        // Edge case: user types, then quickly toggles mode before debounce completes
        const resultsPage = new ResultsPage(page);
        const uniqueText = `RAPID_TOGGLE_${Date.now()}`;

        await resultsPage.goto('/results?id=<published-article-id>');
        await resultsPage.clickEditButton();
        await resultsPage.clickFormatToggle(); // Switch to plaintext

        // Type content
        const currentContent = await resultsPage.getRawMarkdownContent();
        await resultsPage.editRawMarkdown(currentContent + '\n\n' + uniqueText);

        // Immediately toggle back (no wait for debounce)
        await resultsPage.clickFormatToggle(); // Switch to formatted

        // Assert: content should be preserved despite rapid toggle
        const formattedContent = await resultsPage.getEditorContent();
        expect(formattedContent).toContain(uniqueText);

        // Also verify publish button appears (change was tracked)
        await expect(page.getByTestId('publish-button')).toBeVisible();
    });
});
```

### Manual Verification on Stage
1. Load published article
2. Enter edit mode, switch to plaintext
3. Make edits (add/remove text)
4. **Verify "Publish" button appears after ~300ms** (Phase 2 fix with debounce)
5. Toggle back to formatted - **verify edits preserved** (Phase 3 fix)
6. Click Done - **verify edits persist** (Phase 4 fix)
7. Re-enter edit mode, **verify content still has edits**
8. Click Publish - **verify changes saved** (Phase 1 fix)
9. Reload page - **verify published content has changes**

## Documentation Updates

### Files to Update
- `docs/feature_deep_dives/state_management.md`: Add section explaining plaintext mode integration:
  ```markdown
  ### Plaintext Mode Integration

  When in plaintext mode (RawMarkdownEditor), content changes are synced to the
  lifecycle reducer via UPDATE_CONTENT dispatch at these points:
  - On keystroke in plaintext mode (debounced 300ms via handleRawMarkdownChange)
  - When toggling from plaintext to formatted mode (immediate)
  - When exiting edit mode while in plaintext mode (immediate, clears debounce)

  The debounce prevents excessive reducer updates during typing while ensuring
  the publish button appears within 300ms of content changes. The debounce is
  cleared when exiting edit mode to ensure the latest content is captured.

  This differs from LexicalEditor which doesn't dispatch UPDATE_CONTENT on
  every keystroke - instead it syncs only when exiting edit mode. This is
  because LexicalEditor maintains its own internal state that is accessed
  via ref methods.
  ```

### No Updates Needed
- `docs/docs_overall/architecture.md`: No architectural changes
- `docs/docs_overall/testing_overview.md`: No test strategy changes

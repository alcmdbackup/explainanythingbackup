# Fix Editing Plaintext Publish Bug Research

## Problem Statement

Three related bugs in plaintext mode editing:
1. **Changes don't sync when toggling modes** - Edits made in plaintext mode don't carry over to formatted mode
2. **Publish banner doesn't appear** - Content changes in plaintext mode don't trigger the "Publish" button
3. **No markdown validation** - Invalid markdown can be published or toggled without warning

## High Level Summary

The root cause is that `RawMarkdownEditor` changes are stored in local React state (`rawMarkdownContent`) but **never dispatched to the `pageLifecycleReducer`**. The publish banner and change detection rely on the reducer's `hasUnsavedChanges` selector, which only updates via `UPDATE_CONTENT` actions. Since plaintext mode never dispatches this action, changes are invisible to the state machine.

### Key Finding: Missing State Integration

```
LexicalEditor.onChange → handleEditorContentChange → (updates local state, syncs on exit)
RawMarkdownEditor.onChange → setRawMarkdownContent → (DEAD END - no reducer dispatch!)
```

The publish button visibility is controlled by:
```tsx
{(hasUnsavedChanges || explanationStatus === ExplanationStatus.Draft) && (
    <button onClick={handleSaveOrPublishChanges} ...>Publish</button>
)}
```

Since `hasUnsavedChanges` is always `false` for plaintext edits, the button won't appear for published content.

## Documents Read

- `docs/feature_deep_dives/state_management.md` - Page lifecycle reducer documentation
- `docs/docs_overall/architecture.md` - System architecture overview
- `docs/docs_overall/project_workflow.md` - Project workflow process

## Code Files Read

### State Management
| File | Purpose |
|------|---------|
| `src/reducers/pageLifecycleReducer.ts` | Page state machine (idle→loading→streaming→viewing→editing→saving) |
| `src/reducers/tagModeReducer.ts` | Tag modification tracking |

### Editor Components
| File | Purpose |
|------|---------|
| `src/editorFiles/lexicalEditor/LexicalEditor.tsx` | Rich text editor with markdown support |
| `src/components/RawMarkdownEditor.tsx` | Simple textarea for plaintext mode |
| `src/editorFiles/lexicalEditor/importExportUtils.ts` | Markdown import/export utilities |

### Page Integration
| File | Purpose |
|------|---------|
| `src/app/results/page.tsx` | Results page with mode toggle and publish button |

### Validation
| File | Purpose |
|------|---------|
| `src/editorFiles/validation/pipelineValidation.ts` | AI suggestion validation (CriticMarkup) |

---

## Detailed Findings

### 1. Page Lifecycle Reducer State Machine

**File**: `src/reducers/pageLifecycleReducer.ts`

The reducer manages page state through phases:
```
idle → loading → streaming → viewing → editing → saving
  ↑                                       ↓
  └──────────────── error ←───────────────┘
```

**Key actions for change detection:**
- `UPDATE_CONTENT` (line 223-246) - Sets `hasUnsavedChanges` by comparing to `originalContent`
- `UPDATE_TITLE` (line 251-274) - Sets `hasUnsavedChanges` by comparing to `originalTitle`

**Selector used by publish button:**
```typescript
export function hasUnsavedChanges(state: PageLifecycleState): boolean {
  if (state.phase === 'editing') {
    return state.hasUnsavedChanges;
  }
  if (state.phase === 'viewing') {
    return state.hasUnsavedChanges || false;
  }
  return false;
}
```

### 2. RawMarkdownEditor Component

**File**: `src/components/RawMarkdownEditor.tsx`

Simple textarea wrapper for plaintext editing:
```tsx
interface RawMarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  isEditMode: boolean;
  placeholder?: string;
  className?: string;
}
```

**Current integration** in `src/app/results/page.tsx:1365-1369`:
```tsx
<RawMarkdownEditor
    content={rawMarkdownContent || formattedExplanation}
    onChange={(newContent) => setRawMarkdownContent(newContent)}  // BUG: No reducer dispatch!
    isEditMode={isEditMode && !isStreaming}
/>
```

### 3. Mode Toggle Logic

**File**: `src/app/results/page.tsx:1220-1231`

```tsx
const handleMarkdownToggle = () => {
    if (isMarkdownMode) {
        // Switching TO plaintext: capture markdown
        const currentMarkdown = editorRef.current?.getContentAsMarkdown() || formattedExplanation;
        setRawMarkdownContent(currentMarkdown);
    } else {
        // Switching TO formatted: sync back
        if (rawMarkdownContent && editorRef.current) {
            editorRef.current.setContentFromMarkdown(rawMarkdownContent);
            setEditorCurrentContent(rawMarkdownContent);  // BUG: No reducer dispatch!
        }
    }
    setIsMarkdownMode(!isMarkdownMode);
};
```

### 4. LexicalEditor Content Change Handler

**File**: `src/app/results/page.tsx:654-665`

```tsx
const handleEditorContentChange = (newContent: string) => {
    logger.debug('handleEditorContentChange called', {...});

    // Note: During editing, we don't update lifecycle state on every keystroke
    // Content is synced when exiting edit mode (line 639)
    setEditorCurrentContent(newContent);
    // No UPDATE_CONTENT dispatch here either - synced on EXIT_EDIT_MODE
};
```

Content is synced on exit (line 636-639):
```tsx
const currentContent = editorRef.current?.getContentAsMarkdown() || '';
if (currentContent) {
    dispatchLifecycle({ type: 'UPDATE_CONTENT', content: currentContent });
}
```

### 5. Publish Button Visibility

**File**: `src/app/results/page.tsx:1206-1217`

```tsx
{(hasUnsavedChanges || explanationStatus === ExplanationStatus.Draft) && (
    <button
        onClick={handleSaveOrPublishChanges}
        disabled={isSavingChanges || (explanationStatus !== ExplanationStatus.Draft && !hasUnsavedChanges) || isStreaming || hasPendingSuggestions}
        data-testid="publish-button"
        ...
    >
        {isSavingChanges ? 'Publishing...' : 'Publish'}
    </button>
)}
```

### 6. Markdown Validation (Existing)

**File**: `src/editorFiles/validation/pipelineValidation.ts`

Validates CriticMarkup syntax for AI suggestions:
- `validateStep2_ContentPreservation` - Length ratio, heading retention
- `validateStep3_CriticMarkupSyntax` - Balanced markers `{++...++}`, `{--...--}`
- `validateStep4_EditAnchors` - Context validation

**Not used for:**
- General markdown syntax validation
- Mode toggle validation
- Publish-time validation

---

## Architecture Documentation

### Data Flow for Content Changes

**Formatted Mode (LexicalEditor):**
```
User edits → Lexical onChange → handleEditorContentChange → setEditorCurrentContent
                                                         ↓
Exit edit mode → getContentAsMarkdown() → dispatchLifecycle({ type: 'UPDATE_CONTENT' })
                                                         ↓
                                        hasUnsavedChanges = true → Publish button appears
```

**Plaintext Mode (RawMarkdownEditor):**
```
User edits → textarea onChange → setRawMarkdownContent (local state)
                              ↓
Toggle to formatted → setContentFromMarkdown → setEditorCurrentContent
                              ↓
              (MISSING: dispatchLifecycle({ type: 'UPDATE_CONTENT' }))
                              ↓
                    hasUnsavedChanges stays FALSE → No publish button!
```

### State Variables for Mode Toggle

| Variable | Type | Purpose |
|----------|------|---------|
| `isMarkdownMode` | `boolean` | Controls which editor renders |
| `rawMarkdownContent` | `string` | Stores content when in plaintext mode |
| `editorCurrentContent` | `string` | Tracks current Lexical editor content |
| `lifecycleState` | `PageLifecycleState` | Reducer state with `hasUnsavedChanges` |

### Publish Handler

**File**: `src/app/results/page.tsx:573-614`

```tsx
const handleSaveOrPublishChanges = async () => {
    if (!explanationId || (!hasUnsavedChanges && explanationStatus !== ExplanationStatus.Draft) || ...) return;

    dispatchLifecycle({ type: 'START_SAVE' });

    // Gets content from editor, not rawMarkdownContent!
    const currentContent = editorRef.current?.getContentAsMarkdown() || getPageContent(lifecycleState);

    await saveOrPublishChanges({
        explanationId,
        newContent: currentContent,  // BUG: Won't include plaintext changes!
        ...
    });
};
```

---

## Open Questions

1. **Validation strategy**: Should we use an existing markdown parser (remark, unified) or write simple validation?
2. **When to validate**: On every keystroke, on blur, on toggle, or only on publish?
3. **Error UX**: How should validation errors be displayed? Inline, toast, modal?
4. **Partial validation**: Should we allow toggling with warnings but block publish?

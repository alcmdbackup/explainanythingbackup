# Editor State Management Refactor Plan

## Problem Summary

The editor has **three sources of truth** causing race conditions and stale state:
1. Lexical internal state (document tree)
2. Parent state (`content`, `editorCurrentContent`, `lifecycleState`)
3. Hook state (`useStreamingEditor` with independent refs)

**Bugs occurring:**
- Accept/reject succession race conditions
- Mode toggle conflicts (markdown/edit)
- Content overwritten during streaming
- Stale state between parent and editor

---

## Root Cause

`pageLifecycleReducer` already exists but `results/page.tsx` duplicates state outside it:
- `editorCurrentContent` (useState) duplicates `getContent(lifecycleState)`
- `isInitialLoadRef`, `hasInitializedContent`, `debounceTimeoutRef` scatter flags
- Direct `editorRef.current.setContentFromMarkdown()` calls bypass the reducer
- `useStreamingEditor` hook duplicates the same refs again (unused but exists)

**Solution:** Consolidate around existing reducer, don't create new abstractions.

---

## Architecture

```
ResultsPage
  └─ pageLifecycleReducer (ENHANCED)
       ├─ pendingMutations: MutationOp[]
       ├─ processingMutation: MutationOp | null
       ├─ pendingModeToggle: boolean
       └─ syncDirection: 'push' | 'pull' | 'none'

  └─ LexicalEditor
       ├─ MutationQueuePlugin (NEW)
       │    ├─ Reads pendingMutations from props
       │    ├─ Executes one at a time
       │    ├─ Dispatches COMPLETE_MUTATION on done
       │    └─ Disables buttons during processing
       │
       ├─ StreamingSyncPlugin (NEW - replaces debounce logic)
       │    ├─ Subscribes to content from props
       │    ├─ Debounces updates during streaming (100ms)
       │    └─ Pushes to Lexical via setContentFromMarkdown
       │
       ├─ DiffTagHoverPlugin (MODIFIED)
       │    └─ Calls onQueueMutation instead of direct mutation
       │
       └─ ContentChangePlugin (EXISTING - unchanged)
            └─ Emits to handleEditorContentChange (for save/exit)

  └─ AISuggestionsPanel (MODIFIED)
       └─ Receives dispatch prop + isStreaming, uses actions
```

---

## Content Sync Direction Rules

```
STREAMING: reducer → Lexical (push, debounced 100ms)
EDITING:   Lexical → reducer (pull on save/exit only, not continuous)
MUTATIONS: Lexical → reducer (after each accept/reject completes)
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Mode during streaming | Force markdown render mode | Prevents node key conflicts during active content changes |
| Mode toggle during mutations | Complete mutations, then toggle | Prevents stale node keys |
| AI suggestions during streaming | BLOCKED (disable button) | Prevents content conflicts |
| Accept/reject during streaming | BLOCKED (disable buttons) | Content is changing; node keys unstable |
| Multiple mutations | Queue-based serial processing | Supports rapid clicks, processes one at a time |
| Implementation approach | Incremental (7 phases, separate PRs) | Lower risk, easier review |
| Streaming debounce | Keep 100ms in StreamingSyncPlugin | Existing behavior works |
| Mutation queue location | Reducer state | Single source of truth |

> **Note:** During streaming, both AI suggestion requests AND accept/reject buttons must be disabled. The document tree is actively changing, making node keys unstable and mutations unsafe. Editor is forced to markdown render mode during streaming.

---

## New Reducer Types

```typescript
type MutationOp = {
  id: string;
  type: 'accept' | 'reject';
  nodeKey: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
};

// Add to viewing/editing phases:
pendingMutations: MutationOp[];
processingMutation: MutationOp | null;
pendingModeToggle: boolean;
```

## New Reducer Actions

```typescript
// Existing (keep as-is)
| { type: 'STREAM_CONTENT'; content: string }
| { type: 'UPDATE_CONTENT'; content: string }
| { type: 'ENTER_EDIT_MODE' }
| { type: 'EXIT_EDIT_MODE' }

// New actions
| { type: 'QUEUE_MUTATION'; nodeKey: string; mutationType: 'accept' | 'reject' }
| { type: 'START_MUTATION'; id: string }
| { type: 'COMPLETE_MUTATION'; id: string; newContent: string }
| { type: 'FAIL_MUTATION'; id: string; error: string }
| { type: 'REQUEST_MODE_TOGGLE' }   // Sets pendingModeToggle if mutations pending
| { type: 'EXECUTE_MODE_TOGGLE' }   // Actually toggles, clears pendingModeToggle
| { type: 'APPLY_AI_SUGGESTION'; content: string }  // Blocked if streaming
```

## New Selectors

```typescript
canRequestAISuggestion(state): boolean  // false when streaming
canToggleMode(state): boolean           // immediate toggle allowed
hasPendingModeToggle(state): boolean    // toggle queued behind mutations
getMutationQueueLength(state): number   // for UI feedback
```

---

## Implementation Phases

### Phase 1: Extend Reducer (Low Risk)

**Modify:** `src/reducers/pageLifecycleReducer.ts`

- Add `MutationOp` type and mutation queue state fields
- Add actions: `QUEUE_MUTATION`, `START_MUTATION`, `COMPLETE_MUTATION`, `FAIL_MUTATION`
- Add actions: `REQUEST_MODE_TOGGLE`, `EXECUTE_MODE_TOGGLE`, `APPLY_AI_SUGGESTION`
- Add selectors for queue state

**Test:** Unit tests for all new actions and state transitions

---

### Phase 2: Create MutationQueuePlugin (Medium Risk)

**Create:** `src/editorFiles/lexicalEditor/MutationQueuePlugin.tsx`

- Receives `pendingMutations` and `processingMutation` as props
- Receives `onStartMutation`, `onCompleteMutation`, `onFailMutation` callbacks
- Processes mutations serially (one at a time)
- Calls existing `acceptDiffTag()`/`rejectDiffTag()` functions
- Dispatches completion actions via callbacks
- Skips operations where nodeKey already processed

**Test:** Integration test for rapid accept/reject (x3 same node → only first succeeds)

---

### Phase 3: Modify DiffTagHoverPlugin (Low Risk)

**Modify:** `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx`

- Add `onQueueMutation(nodeKey, type)` callback prop
- Replace direct `acceptDiffTag()`/`rejectDiffTag()` calls with callback
- Add `isProcessing` prop to disable buttons during mutation processing
- Keep `onPendingSuggestionsChange` for pending count

**Test:** Verify buttons disable during processing

---

### Phase 4: Create StreamingSyncPlugin (Medium Risk)

**Create:** `src/editorFiles/lexicalEditor/StreamingSyncPlugin.tsx`

- Receives `content`, `isStreaming`, `editorRef` as props
- Implements 100ms debounce during streaming
- Immediately pushes when streaming ends
- Replaces `debouncedUpdateContent` logic from results/page.tsx

**Test:** Verify debounce works, no duplicate updates

---

### Phase 5: Clean Up results/page.tsx (High Risk - Do Last)

**Modify:** `src/app/results/page.tsx`

Remove:
- `editorCurrentContent` useState
- `isInitialLoadRef`, `hasInitializedContent`, `debounceTimeoutRef` refs
- `debouncedUpdateContent` function
- Direct `editorRef.current.setContentFromMarkdown()` calls

Add:
- Pass `pendingMutations`, `processingMutation` to LexicalEditor
- Handle `onQueueMutation` callback → dispatch to reducer
- Wire up new plugins (MutationQueuePlugin, StreamingSyncPlugin)
- All content updates through `dispatch({ type: 'UPDATE_CONTENT' })`

**Test:** Full E2E flow for streaming, editing, accept/reject

---

### Phase 6: Refactor AISuggestionsPanel (Medium Risk)

**Modify:** `src/components/AISuggestionsPanel.tsx`

- Add `dispatch` prop
- Add `isStreaming` prop → disable request button when true
- Replace `onEnterEditMode` + `onContentChange` callbacks with:
  - `dispatch({ type: 'ENTER_EDIT_MODE' })`
  - `dispatch({ type: 'APPLY_AI_SUGGESTION', content })`
- Remove direct ref manipulation

**Test:** AI suggestions work, button disabled during streaming

---

### Phase 7: Delete useStreamingEditor.ts (No Risk)

**Delete:** `src/hooks/useStreamingEditor.ts`

Already unused - functionality consolidated in reducer and plugins.

---

## File Changes Summary

| File | Action | Risk |
|------|--------|------|
| `src/reducers/pageLifecycleReducer.ts` | MODIFY | Low |
| `src/editorFiles/lexicalEditor/MutationQueuePlugin.tsx` | CREATE | Medium |
| `src/editorFiles/lexicalEditor/StreamingSyncPlugin.tsx` | CREATE | Medium |
| `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx` | MODIFY | Low |
| `src/editorFiles/lexicalEditor/LexicalEditor.tsx` | MODIFY | Medium |
| `src/app/results/page.tsx` | MODIFY | High |
| `src/components/AISuggestionsPanel.tsx` | MODIFY | Medium |
| `src/hooks/useStreamingEditor.ts` | DELETE | None |

---

## Testing Strategy

### Unit Tests (Phase 1)
- All new reducer actions and state transitions
- Selector functions

### Integration Tests (Phases 2-4)
1. Rapid accept x3 on same node → only first succeeds
2. Accept then reject same node → second is no-op
3. Streaming + accept → accept completes, streaming continues
4. Mode toggle during mutation queue → queued, executes after complete
5. AI suggestion button during streaming → disabled

### E2E Tests (Phase 5-6)
- Full streaming flow
- Edit mode with save
- AI suggestions flow
- Accept/reject with mode toggle

---

## Mode Transition Rules

```
viewing → editing:     allowed when NOT streaming
editing → viewing:     only when pendingMutations.length === 0
streaming active:      FORCE markdown render mode (not editable)
markdown toggle:       IF pendingMutations.length > 0:
                         set pendingModeToggle = true
                         wait for mutations to complete
                         then execute toggle
                       ELSE:
                         execute immediately
any → streaming:       AI suggestions blocked (button disabled)
```

---

## Existing Infrastructure (Reference)

### pageLifecycleReducer State Machine
```
idle → loading → streaming → viewing → editing → saving
  ↑                                       ↓
  └──────────────── error ←───────────────┘
```

### Existing Actions (keep as-is)
- `START_GENERATION`, `START_STREAMING`, `STREAM_CONTENT`, `STREAM_TITLE`
- `LOAD_EXPLANATION`
- `ENTER_EDIT_MODE`, `EXIT_EDIT_MODE`
- `UPDATE_CONTENT`, `UPDATE_TITLE`
- `START_SAVE`, `SAVE_SUCCESS`
- `ERROR`, `RESET`

### Existing Selectors (keep as-is)
- `isPageLoading()`, `isStreaming()`, `isEditMode()`, `isSavingChanges()`
- `getContent()`, `getTitle()`, `getStatus()`
- `getOriginalContent()`, `getOriginalTitle()`, `hasUnsavedChanges()`

---

## Gap Resolutions (Implementation Details)

### Gap 1: Mode During Streaming

**Behavior**: During streaming, force markdown render mode (read-only). Do not allow toggle.

**Implementation**:
```typescript
// In canToggleMode selector
export const canToggleMode = (state: PageLifecycleState): boolean => {
  // Block during streaming - content is actively changing
  if (state.phase === 'streaming') return false;

  // Block during mutations - node keys may become stale
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return (state.pendingMutations?.length ?? 0) === 0;
  }

  return false;
};
```

**UI**: Disable mode toggle button when `!canToggleMode(state)`. During streaming, editor locked to markdown render.

---

### Gap 2: APPLY_AI_SUGGESTION Behavior

**Behavior**: `APPLY_AI_SUGGESTION` should:
1. **Block** if streaming (checked via `canRequestAISuggestion` selector)
2. **Clear** mutation queue (suggestions are for new content, old mutations are stale)
3. **Enter edit mode** (user needs to accept/reject suggestions)
4. **Set content** with CriticMarkup

**Implementation**:
```typescript
case 'APPLY_AI_SUGGESTION': {
  // Should only be called when canRequestAISuggestion is true
  // (enforced by UI disabling button during streaming)

  if (state.phase === 'viewing' || state.phase === 'editing') {
    return {
      ...state,
      phase: 'editing',
      content: action.content,
      pendingMutations: [],  // Clear stale mutations
      processingMutation: null,
      pendingModeToggle: false,
      hasUnsavedChanges: true,  // AI suggestions are unsaved changes
    };
  }
  return state;
}
```

**AISuggestionsPanel changes**:
```typescript
// Before: Two separate callbacks
onEnterEditMode?.();
onContentChange?.(result.content);

// After: Single dispatch
dispatch({ type: 'APPLY_AI_SUGGESTION', content: result.content });
```

---

### Gap 3: Error Recovery for Failed Mutations

**Behavior**: Failed mutations should:
1. Remove mutation from queue (don't retry automatically)
2. Re-enable accept/reject buttons
3. Show error toast to user
4. Log error for debugging

**Implementation**:
```typescript
case 'FAIL_MUTATION': {
  if (state.phase !== 'viewing' && state.phase !== 'editing') return state;

  // Remove failed mutation from queue
  const updatedMutations = state.pendingMutations.filter(m => m.id !== action.id);

  return {
    ...state,
    pendingMutations: updatedMutations,
    processingMutation: null,
    lastMutationError: action.error,  // For UI to show toast
  };
}
```

**MutationQueuePlugin error handling**:
```typescript
try {
  await acceptDiffTag(editor, nodeKey);
  onCompleteMutation(id, getContentAsMarkdown());
} catch (error) {
  logger.error('MutationQueuePlugin: Mutation failed', { id, nodeKey, error });
  onFailMutation(id, error.message);
  toast.error('Failed to apply change. Please try again.');
}
```

**User recovery**: Click the button again → new mutation queued → processed.

---

### Gap 4: Multiple Mutations Support

**Behavior**: Queue supports unlimited mutations, processed serially one at a time.

**Example flow for rapid clicks**:
```
Click Accept A → queue: [A-accept]
Click Reject B → queue: [A-accept, B-reject]
Click Accept C → queue: [A-accept, B-reject, C-accept]

Processing:
1. START_MUTATION A → processingMutation = A, buttons disabled
2. A completes → COMPLETE_MUTATION → processingMutation = null
3. START_MUTATION B → processingMutation = B
4. B completes → COMPLETE_MUTATION
5. START_MUTATION C → processingMutation = C
6. C completes → COMPLETE_MUTATION → queue empty, buttons enabled
```

**Edge cases**:
- Same node clicked twice: Second queued but no-op when processed (node gone)
- Node disappears before processing: Skip gracefully, dispatch COMPLETE_MUTATION

**Test coverage**:
```typescript
describe('Mutation queue edge cases', () => {
  it('handles rapid clicks on different nodes');
  it('handles same node clicked twice (second is no-op)');
  it('skips mutation if nodeKey no longer exists');
  it('processes only one mutation at a time');
  it('clears mutation queue on APPLY_AI_SUGGESTION');
});
```

---

### Gap 5: contentChange Guard During Mutations

**Problem**: When mutation completes, DOM changes trigger `ContentChangePlugin.onContentChange`, which might dispatch `UPDATE_CONTENT` with the same content.

**Solution**: Content comparison guard (simpler than flag approach).

**Implementation**:
```typescript
const handleEditorContentChange = (newContent: string) => {
  const currentContent = getContent(lifecycleState);
  if (newContent === currentContent) return;  // No change, skip

  // Normal handling...
  dispatchLifecycle({ type: 'UPDATE_CONTENT', content: newContent });
};
```

This is stateless and handles all cases where content hasn't actually changed.

---

## New Selectors (Complete List)

```typescript
// Block AI suggestions during streaming
export const canRequestAISuggestion = (state: PageLifecycleState): boolean =>
  state.phase !== 'streaming';

// Block mode toggle during streaming or pending mutations
export const canToggleMode = (state: PageLifecycleState): boolean => {
  if (state.phase === 'streaming') return false;
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return (state.pendingMutations?.length ?? 0) === 0;
  }
  return false;
};

// Check if mode toggle is queued
export const hasPendingModeToggle = (state: PageLifecycleState): boolean =>
  (state.phase === 'viewing' || state.phase === 'editing')
    && state.pendingModeToggle === true;

// Get queue length for UI feedback
export const getMutationQueueLength = (state: PageLifecycleState): number =>
  (state.phase === 'viewing' || state.phase === 'editing')
    ? state.pendingMutations?.length ?? 0
    : 0;

// Check if any mutation is currently processing
export const isMutationProcessing = (state: PageLifecycleState): boolean =>
  (state.phase === 'viewing' || state.phase === 'editing')
    ? state.processingMutation !== null
    : false;
```

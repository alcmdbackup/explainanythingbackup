# Editor State Management Refactor - Progress

## Status: ALL PHASES COMPLETE ✅

---

## Phase 1: Extend pageLifecycleReducer ✅ COMPLETE

**Commit:** `6753531` - `feat(reducer): add mutation queue to pageLifecycleReducer`

### Changes Made

**File: `src/reducers/pageLifecycleReducer.ts`**

1. Added `MutationOp` type:
```typescript
type MutationOp = {
  id: string;
  type: 'accept' | 'reject';
  nodeKey: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
};
```

2. Extended `viewing` and `editing` phase types with:
   - `pendingMutations: MutationOp[]`
   - `processingMutation: MutationOp | null`
   - `pendingModeToggle: boolean`
   - `lastMutationError?: string`

3. Added 7 new actions:
   - `QUEUE_MUTATION` - add mutation to queue
   - `START_MUTATION` - mark mutation as processing
   - `COMPLETE_MUTATION` - remove completed mutation, update content
   - `FAIL_MUTATION` - remove failed mutation, record error
   - `REQUEST_MODE_TOGGLE` - toggle or queue mode change
   - `EXECUTE_MODE_TOGGLE` - execute queued toggle
   - `APPLY_AI_SUGGESTION` - apply AI content, clear queue

4. Added 6 new selectors:
   - `canRequestAISuggestion()` - blocks during streaming
   - `canToggleMode()` - blocks during streaming/mutations
   - `hasPendingModeToggle()` - checks queued toggle
   - `getMutationQueueLength()` - UI feedback
   - `isMutationProcessing()` - check current processing
   - `getLastMutationError()` - get last error

**File: `src/reducers/pageLifecycleReducer.test.ts`**

- Added helper functions `createViewingState()` and `createEditingState()`
- Updated existing tests to use helpers (required due to new mandatory fields)
- Added comprehensive tests for all new actions and selectors
- **63 tests pass**

### Validation
- ✅ TypeScript compiles without errors
- ✅ ESLint passes (no new warnings)
- ✅ Build succeeds
- ✅ All 63 unit tests pass

---

## Phase 2: Create MutationQueuePlugin ✅ COMPLETE

**File created:** `src/editorFiles/lexicalEditor/MutationQueuePlugin.tsx`

### Implementation Summary

The plugin processes accept/reject mutations from the reducer queue serially:

1. **Watches** for pending mutations in `pendingMutations` prop
2. **Processes** one mutation at a time (guards against re-entry with `isProcessingRef`)
3. **Calls** `acceptDiffTag()`/`rejectDiffTag()` to execute the mutation
4. **Exports** content via `exportMarkdownReadOnly()` after mutation
5. **Dispatches** `onCompleteMutation` or `onFailMutation` callbacks

### Props Interface
```typescript
interface MutationQueuePluginProps {
  pendingMutations: MutationOp[];
  processingMutation: MutationOp | null;
  onStartMutation: (id: string) => void;
  onCompleteMutation: (id: string, newContent: string) => void;
  onFailMutation: (id: string, error: string) => void;
}
```

### Edge Cases Handled
- **Node not found:** If `nodeKey` no longer exists, mutation is a no-op but still completes
- **Rapid clicks:** All mutations are queued, processed serially
- **Errors:** Caught and reported via `onFailMutation`

**File: `src/editorFiles/lexicalEditor/MutationQueuePlugin.test.tsx`**

- **16 tests pass** covering:
  - Initialization and rendering
  - Accept mutation flow
  - Reject mutation flow
  - Error handling (Error objects and non-Error exceptions)
  - Queue processing (serial, skips non-pending)
  - Edge cases (empty content, processing guard)

### Validation
- ✅ TypeScript compiles without errors
- ✅ ESLint passes (no new warnings)
- ✅ Build succeeds
- ✅ All 16 unit tests pass

---

## Phase 3: Modify DiffTagHoverPlugin ✅ COMPLETE

**Commit:** `04f7dae` - `feat(editor): add callback-based mutation queueing to DiffTagHoverPlugin`

**File modified:** `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.tsx`

### Implementation Summary

Changed plugin from directly calling mutation functions to using a callback pattern:

1. **Added new props:**
   - `onQueueMutation?: (nodeKey: string, type: 'accept' | 'reject') => void`
   - `isProcessing?: boolean`

2. **Replaced direct mutation calls:**
   - Before: `acceptDiffTag(editor, nodeKey)` / `rejectDiffTag(editor, nodeKey)`
   - After: `onQueueMutation?.(nodeKey, 'accept')` / `onQueueMutation?.(nodeKey, 'reject')`

3. **Added button disable logic:**
   - Blocks click handler when `isProcessing` is true
   - Sets button `disabled`, `opacity: 0.5`, and `cursor: not-allowed` when processing
   - Re-enables buttons when `isProcessing` becomes false

4. **Removed direct import of `diffTagMutations`**

### Props Interface (Updated)
```typescript
interface DiffTagHoverPluginProps {
  onPendingSuggestionsChange?: (hasPendingSuggestions: boolean) => void;
  onQueueMutation?: (nodeKey: string, type: 'accept' | 'reject') => void;
  isProcessing?: boolean;
}
```

**File: `src/editorFiles/lexicalEditor/DiffTagHoverPlugin.test.tsx`**

- Updated all tests to use `onQueueMutation` callback instead of mocked mutation functions
- Added 5 new tests for `isProcessing` behavior:
  - Blocks clicks when processing
  - Disables buttons visually when processing
  - Enables buttons when not processing
  - Re-enables on state change
  - Fires callback after re-enabling
- **24 tests pass**

### Validation
- ✅ TypeScript compiles without errors
- ✅ ESLint passes (no new warnings)
- ✅ Build succeeds
- ✅ All 24 unit tests pass

---

## Phase 4: Create StreamingSyncPlugin ✅ COMPLETE

**File created:** `src/editorFiles/lexicalEditor/StreamingSyncPlugin.tsx`

### Implementation Summary

The plugin synchronizes streaming content from the reducer to the editor:

1. **Watches** `content` and `isStreaming` props
2. **Debounces** updates with 100ms delay when streaming
3. **Immediate** update when not streaming
4. **Skips** duplicate content to avoid unnecessary renders

### Props Interface
```typescript
interface StreamingSyncPluginProps {
  content: string;           // Content from reducer
  isStreaming: boolean;      // When true, debounce 100ms
}
```

### Content Update Logic
- Uses `editor.update()` directly (same as `setContentFromMarkdown`)
- Calls `preprocessCriticMarkup()` for multiline normalization
- Calls `$convertFromMarkdownString()` with `MARKDOWN_TRANSFORMERS`
- Calls `replaceBrTagsWithNewlines()` for cleanup

**File: `src/editorFiles/lexicalEditor/StreamingSyncPlugin.test.tsx`**

- **18 tests pass** covering:
  - Initialization (2 tests)
  - Content updates without streaming (5 tests)
  - Debounce behavior during streaming (4 tests)
  - Duplicate prevention (2 tests)
  - Cleanup on unmount (2 tests)
  - Edge cases (3 tests)

### Validation
- ✅ TypeScript compiles without errors
- ✅ ESLint passes (no new warnings)
- ✅ Build succeeds
- ✅ All 18 unit tests pass

---

## Phase 5: Clean up results/page.tsx ✅ COMPLETE

**Files modified:**
- `src/editorFiles/lexicalEditor/LexicalEditor.tsx`
- `src/app/results/page.tsx`

### Implementation Summary

Integrated mutation queue and streaming sync plugins into the component hierarchy.

#### LexicalEditor.tsx Changes

1. **Added imports:**
   - `MutationQueuePlugin`
   - `StreamingSyncPlugin`
   - `MutationOp` type from reducer

2. **Extended props interface with 7 new props:**
   - `pendingMutations?: MutationOp[]`
   - `processingMutation?: MutationOp | null`
   - `onStartMutation?: (id: string) => void`
   - `onCompleteMutation?: (id: string, newContent: string) => void`
   - `onFailMutation?: (id: string, error: string) => void`
   - `onQueueMutation?: (nodeKey: string, type: 'accept' | 'reject') => void`
   - `syncContent?: string`

3. **Wired up plugins:**
   - `DiffTagHoverPlugin` now receives `onQueueMutation` and `isProcessing` props
   - `MutationQueuePlugin` conditionally rendered when queue is non-empty
   - `StreamingSyncPlugin` conditionally rendered when `syncContent` is provided

#### results/page.tsx Changes

1. **Removed old state management:**
   - `editorCurrentContent` useState
   - `debounceTimeoutRef` ref
   - `isInitialLoadRef` ref
   - `hasInitializedContent` ref
   - `debouncedUpdateContent` useCallback function
   - Content sync useEffect (87 lines)
   - Cleanup useEffect for debounce
   - Unused `useCallback` import

2. **Updated LexicalEditor usage:**
   - Added all new mutation queue props
   - Added `syncContent` prop from `getPageContent(lifecycleState)`
   - Dispatch actions: `START_MUTATION`, `COMPLETE_MUTATION`, `FAIL_MUTATION`, `QUEUE_MUTATION`

3. **Updated AISuggestionsPanel callback:**
   - Removed direct `editorRef.current.setContentFromMarkdown()` calls
   - Now dispatches `UPDATE_CONTENT` action to reducer
   - `StreamingSyncPlugin` handles pushing content to editor

4. **Updated handleEditorContentChange:**
   - Added content comparison guard to prevent redundant processing
   - Simplified logic (removed isInitialLoadRef references)

### Lines Removed
~100 lines of scattered synchronization logic consolidated into plugins

### Validation
- ✅ TypeScript compiles without errors
- ✅ ESLint passes (no warnings)
- ✅ Build succeeds
- ✅ All 2176 unit tests pass

---

## Phase 6: Refactor AISuggestionsPanel ✅ COMPLETE

**Files modified:**
- `src/components/AISuggestionsPanel.tsx`
- `src/app/results/page.tsx`
- `src/testing/utils/component-test-helpers.ts`
- `src/components/AISuggestionsPanel.test.tsx`

### Implementation Summary

Refactored AISuggestionsPanel to use the dispatch pattern instead of individual callbacks:

1. **Updated props interface:**
   - Added: `dispatch?: React.Dispatch<PageLifecycleAction>`
   - Added: `isStreaming?: boolean`
   - Removed: `onContentChange`, `onEnterEditMode`

2. **Replaced callback usage:**
   - Before: `onEnterEditMode?.()` + `onContentChange?.(content)`
   - After: `dispatch?.({ type: 'APPLY_AI_SUGGESTION', content })`

3. **Added isStreaming disable logic:**
   - Submit button disabled when `isStreaming === true`
   - Prevents AI suggestions during active content streaming

4. **Updated results/page.tsx:**
   - Simplified AISuggestionsPanel props (12 lines removed)
   - Uses `dispatch={dispatchLifecycle}` and `isStreaming={isStreaming}`

5. **Updated tests:**
   - Added 2 new tests for isStreaming behavior
   - Updated callback tests to verify dispatch action

### Validation
- ✅ TypeScript compiles without errors
- ✅ ESLint passes (no warnings)
- ✅ Build succeeds
- ✅ All 30 AISuggestionsPanel tests pass

---

## Phase 7: Delete useStreamingEditor.ts ✅ COMPLETE

**Files deleted:**
- `src/hooks/useStreamingEditor.ts`
- `src/hooks/useStreamingEditor.test.ts`

### Summary

Removed unused hook. Functionality was consolidated into reducer and plugins during Phases 4-5.

### Validation
- ✅ TypeScript compiles without errors
- ✅ Build succeeds

---

## Notes

- Phase 5 successfully removed duplicated state management from results/page.tsx
- Content sync now flows through reducer → StreamingSyncPlugin → editor
- Mutation processing now flows through DiffTagHoverPlugin → reducer → MutationQueuePlugin
- AI suggestions now flow through AISuggestionsPanel → dispatch(APPLY_AI_SUGGESTION) → reducer → StreamingSyncPlugin → editor

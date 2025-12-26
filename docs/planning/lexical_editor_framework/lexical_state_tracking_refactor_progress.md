# Editor State Management Refactor - Progress

## Status: Phase 3 Complete, Phase 4 Next

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

## Remaining Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 4 | Create StreamingSyncPlugin | Pending |
| 5 | Clean up results/page.tsx | Pending |
| 6 | Refactor AISuggestionsPanel | Pending |
| 7 | Delete useStreamingEditor.ts | Pending |

---

## Notes

- The branch has diverged from `origin/main` (3 local commits vs 5 remote)
- Will need to rebase or merge before creating PR

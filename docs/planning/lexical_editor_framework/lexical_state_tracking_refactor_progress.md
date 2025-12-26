# Editor State Management Refactor - Progress

## Status: Phase 1 Complete, Phase 2 In Progress

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

## Phase 2: Create MutationQueuePlugin 🔄 IN PROGRESS

**File to create:** `src/editorFiles/lexicalEditor/MutationQueuePlugin.tsx`

### Implementation Plan

The plugin will:
1. Receive `pendingMutations` and `processingMutation` as props
2. Receive callbacks: `onStartMutation`, `onCompleteMutation`, `onFailMutation`
3. Process mutations serially using existing `acceptDiffTag()`/`rejectDiffTag()` from `diffTagMutations.ts`
4. Handle nodeKey-not-found gracefully (skip and complete)
5. Get content after mutation using `getContentAsMarkdown()` equivalent

### Key Dependencies
- `acceptDiffTag()` and `rejectDiffTag()` from `./diffTagMutations.ts`
- `useLexicalComposerContext` for editor access
- `replaceDiffTagNodesAndExportMarkdown()` for content export

### Props Interface (Draft)
```typescript
interface MutationQueuePluginProps {
  pendingMutations: MutationOp[];
  processingMutation: MutationOp | null;
  onStartMutation: (id: string) => void;
  onCompleteMutation: (id: string, newContent: string) => void;
  onFailMutation: (id: string, error: string) => void;
}
```

---

## Remaining Phases

| Phase | Description | Status |
|-------|-------------|--------|
| 3 | Modify DiffTagHoverPlugin | Pending |
| 4 | Create StreamingSyncPlugin | Pending |
| 5 | Clean up results/page.tsx | Pending |
| 6 | Refactor AISuggestionsPanel | Pending |
| 7 | Delete useStreamingEditor.ts | Pending |

---

## Notes

- The branch has diverged from `origin/main` (3 local commits vs 5 remote)
- Will need to rebase or merge before creating PR

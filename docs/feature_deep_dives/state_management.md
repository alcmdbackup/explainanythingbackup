# State Management

## Overview

State management uses React's `useReducer` for complex state machines and custom hooks for data loading orchestration. This provides predictable state transitions and clear separation of concerns.

## Implementation

### Key Files
- `src/reducers/pageLifecycleReducer.ts` - Page state machine
- `src/reducers/tagModeReducer.ts` - Tag modification tracking
- `src/hooks/useExplanationLoader.ts` - Data loading orchestration

### Page Lifecycle Reducer

Manages the complete lifecycle of the results page:

```
idle → loading → streaming → viewing → editing → saving
   ↑                                       ↓
   └──────────────── error ←───────────────┘
```

### State Phases

| Phase | Key Properties |
|-------|---------------|
| `idle` | Initial state |
| `loading` | Generation in progress |
| `streaming` | `content`, `title` accumulating |
| `viewing` | `content`, `title`, `status`, `original*` |
| `editing` | `hasUnsavedChanges` added |
| `saving` | Save in progress |
| `error` | `error` + optional state fields |

### Action Types

```typescript
type PageAction =
  | { type: 'START_GENERATION' }
  | { type: 'START_STREAMING' }
  | { type: 'STREAM_CONTENT'; content: string }
  | { type: 'STREAM_TITLE'; title: string }
  | { type: 'LOAD_EXPLANATION'; payload: ExplanationData }
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_EDIT_MODE' }
  | { type: 'UPDATE_CONTENT'; content: string }
  | { type: 'UPDATE_TITLE'; title: string }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_SUCCESS'; status: ExplanationStatus }
  | { type: 'ERROR'; error: ErrorResponse }
  | { type: 'RESET' };
```

### Selectors

```typescript
// Phase checks
isPageLoading(state): boolean
isStreaming(state): boolean
isEditMode(state): boolean
isSavingChanges(state): boolean

// Data access
getContent(state): string
getTitle(state): string
getStatus(state): ExplanationStatus

// Change tracking
getOriginalContent(state): string
getOriginalTitle(state): string
hasUnsavedChanges(state): boolean
getError(state): ErrorResponse | undefined
```

## Usage

### Page Lifecycle Reducer

```typescript
import {
  pageLifecycleReducer,
  initialState,
  isPageLoading,
  getContent
} from '@/reducers/pageLifecycleReducer';

const [state, dispatch] = useReducer(pageLifecycleReducer, initialState);

// Start generation
dispatch({ type: 'START_GENERATION' });

// Stream content
dispatch({ type: 'STREAM_CONTENT', content: 'New text...' });

// Load existing
dispatch({
  type: 'LOAD_EXPLANATION',
  payload: { title, content, status, ... }
});

// Enter edit mode
dispatch({ type: 'ENTER_EDIT_MODE' });

// Check state
if (isPageLoading(state)) {
  return <Loading />;
}
const content = getContent(state);
```

### Explanation Loader Hook

```typescript
import { useExplanationLoader } from '@/hooks/useExplanationLoader';

const {
  // Read state
  explanationId,
  explanationTitle,
  content,
  explanationStatus,
  explanationVector,
  systemSavedId,
  userSaved,
  isLoading,
  error,

  // Write methods
  setExplanationId,
  setContent,
  setError,

  // Functions
  loadExplanation,
  clearSystemSavedId
} = useExplanationLoader({
  onTagsLoad: (tags) => setTags(tags),
  onMatchesLoad: (matches) => setMatches(matches),
  onClearPrompt: () => setPrompt(''),
  onSetOriginalValues: (values) => dispatch({ type: 'SET_ORIGINAL', ...values })
});

// Load explanation
await loadExplanation(targetId, shouldClearPrompt, userid, matches);
```

### Load Explanation Flow

1. Fetch explanation via `getExplanationByIdAction`
2. Resolve links via `resolveLinksForDisplayAction`
3. Load vector from Pinecone
4. Fetch tags via `getTagsForExplanationAction`
5. Check user save status via `isExplanationSavedByUserAction`
6. Call provided callbacks with loaded data

### Tag Mode Reducer

Tracks tag modifications before saving:

```typescript
const [tagState, tagDispatch] = useReducer(tagModeReducer, initialTagState);

// Add tag
tagDispatch({ type: 'ADD_TAG', tagId });

// Remove tag
tagDispatch({ type: 'REMOVE_TAG', tagId });

// Check for changes
if (tagState.hasChanges) {
  await saveTagChanges(tagState.addedTags, tagState.removedTags);
}

// Reset after save
tagDispatch({ type: 'RESET' });
```

### Best Practices

1. **Use selectors**: Access state through selector functions for consistency
2. **Dispatch actions**: Never mutate state directly
3. **Handle all phases**: Account for every possible state in UI
4. **Track originals**: Store original values for change detection
5. **Reset on navigation**: Clear state when leaving page

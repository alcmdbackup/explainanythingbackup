# Results Page Refactoring Strategy for Testability

**Created:** 2025-11-01
**Purpose:** Refactor `src/app/results/page.tsx` to enable effective testing
**Prerequisite for:** Phase 12 of testing plan
**Estimated Effort:** 8-12 hours refactoring + 12-16 hours testing = 20-28 hours total
**Net Savings:** 10-20 hours vs. testing without refactoring + much better code quality

---

## Executive Summary

The current `results/page.tsx` is **1,317 lines** with **25+ state variables**, making it nearly impossible to test effectively. This document outlines a refactoring strategy that extracts 6 custom hooks to create testable, maintainable code while preserving all functionality.

**Key Benefits:**
- Testability: Each hook can be tested in isolation
- Maintainability: Clear separation of concerns
- Reusability: Hooks can be used in other components
- Performance: Reduced unnecessary re-renders
- Team velocity: Easier to understand and modify

---

## The Problem: Current State Analysis

### File Statistics
- **Lines:** 1,317 (too large for a single component)
- **State Variables:** 25+
- **Helper Functions:** 10+
- **useEffect Hooks:** 4+ with complex dependencies
- **Server Actions:** 14+ different actions called
- **Responsibilities:** Data loading, streaming, editing, saving, tags, URL routing, matches

### State Variables Inventory

```typescript
// All in one component:
const [prompt, setPrompt] = useState('');
const [explanationTitle, setExplanationTitle] = useState('');
const [content, setContent] = useState('');
const [matches, setMatches] = useState<matchWithCurrentContentType[]>([]);
const [systemSavedId, setSystemSavedId] = useState<number | null>(null);
const [isPageLoading, setIsPageLoading] = useState(false);
const [isStreaming, setIsStreaming] = useState(false);
const [error, setError] = useState<string | null>(null);
const [isMarkdownMode, setIsMarkdownMode] = useState(true);
const [isSaving, setIsSaving] = useState(false);
const [showMatches, setShowMatches] = useState(false);
const [explanationId, setExplanationId] = useState<number | null>(null);
const [userSaved, setUserSaved] = useState(false);
const [userid, setUserid] = useState<string | null>(null);
const [mode, setMode] = useState<MatchMode>(MatchMode.Normal);
const [tags, setTags] = useState<TagUIType[]>([]);
const [tempTagsForRewriteWithTags, setTempTagsForRewriteWithTags] = useState<TagUIType[]>([]);
const [originalTags, setOriginalTags] = useState<TagUIType[]>([]);
const [showRegenerateDropdown, setShowRegenerateDropdown] = useState(false);
const [modeOverride, setModeOverride] = useState<TagBarMode>(TagBarMode.Normal);
const [isTagsModified, setIsTagsModified] = useState(false);
const [explanationVector, setExplanationVector] = useState<{ values: number[] } | null>(null);
const [isEditMode, setIsEditMode] = useState(false);
const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus | null>(null);
const [originalContent, setOriginalContent] = useState('');
const [originalTitle, setOriginalTitle] = useState('');
const [originalStatus, setOriginalStatus] = useState<ExplanationStatus | null>(null);
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
const [isSavingChanges, setIsSavingChanges] = useState(false);
```

### Why This Is Untestable

**Testing this monolithic component requires:**
1. Mocking 14+ server actions
2. Mocking Next.js hooks (useSearchParams, useRouter)
3. Setting up 25+ state variables in correct order
4. Simulating complex state transitions
5. Testing async streaming behavior
6. Coordinating multiple useEffect hooks
7. Verifying 1,317 lines of logic

**Result:** Tests would be:
- 200+ lines each
- Extremely brittle (break on any refactor)
- Hard to understand
- Slow to run
- Difficult to maintain
- Poor coverage (miss edge cases)

---

## The Solution: Extract Custom Hooks

Break the monolithic component into **6 testable custom hooks**, each with a single responsibility.

### Refactoring Strategy

```
Current:           After:
┌─────────────┐   ┌──────────────────┐
│             │   │ ResultsPage      │
│             │   │ (200 lines)      │
│  results/   │   ├──────────────────┤
│  page.tsx   │   │ Uses 6 hooks:    │
│             │   │                  │
│ 1,317 lines │   │ 1. Explanation   │
│ 25+ states  │──►│ 2. Tags          │
│ 10+ funcs   │   │ 3. Streaming     │
│ 4+ effects  │   │ 4. Edit Mode     │
│             │   │ 5. Matches       │
│             │   │ 6. URL Params    │
│             │   └──────────────────┘
└─────────────┘
                  Each hook: ~100-150 lines
                  Easily testable
                  Single responsibility
```

---

## Hook 1: useExplanationData

**Responsibility:** Manage explanation loading, storage, and metadata

**File:** `src/hooks/useExplanationData.ts`

**Lines:** ~150

### State
```typescript
const [explanationTitle, setExplanationTitle] = useState('');
const [content, setContent] = useState('');
const [explanationId, setExplanationId] = useState<number | null>(null);
const [systemSavedId, setSystemSavedId] = useState<number | null>(null);
const [explanationVector, setExplanationVector] = useState<{ values: number[] } | null>(null);
const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus | null>(null);
const [userSaved, setUserSaved] = useState(false);
const [isLoading, setIsLoading] = useState(false);
const [error, setError] = useState<string | null>(null);
```

### Methods
```typescript
const loadExplanation = async (id: number, clearPrompt: boolean) => { /* ... */ };
const checkUserSaved = async (explanationId: number, userid: string) => { /* ... */ };
const saveToLibrary = async (userid: string) => { /* ... */ };
```

### Return Value
```typescript
return {
  // State
  explanationTitle,
  setExplanationTitle,
  content,
  setContent,
  explanationId,
  explanationVector,
  explanationStatus,
  setExplanationStatus,
  userSaved,
  isLoading,
  error,

  // Methods
  loadExplanation,
  checkUserSaved,
  saveToLibrary,
};
```

### Testing Example
```typescript
describe('useExplanationData', () => {
  it('should load explanation by ID', async () => {
    const mockExplanation = createMockExplanation({ id: 123, title: 'Test' });
    (getExplanationByIdAction as jest.Mock).mockResolvedValue(mockExplanation);

    const { result } = renderHook(() => useExplanationData());

    await act(async () => {
      await result.current.loadExplanation(123, false);
    });

    expect(result.current.explanationTitle).toBe('Test');
    expect(result.current.explanationId).toBe(123);
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle load errors', async () => {
    (getExplanationByIdAction as jest.Mock).mockRejectedValue(new Error('Failed'));

    const { result } = renderHook(() => useExplanationData());

    await act(async () => {
      await result.current.loadExplanation(123, false);
    });

    expect(result.current.error).toBe('Failed to load explanation');
  });

  // ... 10-15 more tests
});
```

---

## Hook 2: useTagManagement

**Responsibility:** Manage tag state, modes, and operations

**File:** `src/hooks/useTagManagement.ts`

**Lines:** ~120

### State
```typescript
const [tags, setTags] = useState<TagUIType[]>([]);
const [tempTagsForRewriteWithTags, setTempTagsForRewriteWithTags] = useState<TagUIType[]>([]);
const [originalTags, setOriginalTags] = useState<TagUIType[]>([]);
const [modeOverride, setModeOverride] = useState<TagBarMode>(TagBarMode.Normal);
const [isTagsModified, setIsTagsModified] = useState(false);
```

### Methods
```typescript
const initializeTempTagsForRewriteWithTags = async () => { /* ... */ };
const isInRewriteMode = () => tempTagsForRewriteWithTags.length > 0;
const resetToOriginalTags = () => setTags(originalTags);
```

### Return Value
```typescript
return {
  tags,
  setTags,
  tempTagsForRewriteWithTags,
  setTempTagsForRewriteWithTags,
  originalTags,
  setOriginalTags,
  modeOverride,
  setModeOverride,
  isTagsModified,
  setIsTagsModified,
  initializeTempTagsForRewriteWithTags,
  isInRewriteMode,
  resetToOriginalTags,
};
```

### Testing Example
```typescript
describe('useTagManagement', () => {
  it('should initialize temp tags for rewrite', async () => {
    const mockTags = [createMockTag({ id: 2 }), createMockTag({ id: 5 })];
    (getTempTagsForRewriteWithTagsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockTags
    });

    const { result } = renderHook(() => useTagManagement());

    await act(async () => {
      await result.current.initializeTempTagsForRewriteWithTags();
    });

    expect(result.current.tempTagsForRewriteWithTags).toEqual(mockTags);
  });

  it('should detect rewrite mode', () => {
    const { result } = renderHook(() => useTagManagement());

    act(() => {
      result.current.setTempTagsForRewriteWithTags([createMockTag()]);
    });

    expect(result.current.isInRewriteMode()).toBe(true);
  });

  // ... 8-12 more tests
});
```

---

## Hook 3: useStreamingContent

**Responsibility:** Handle streaming API calls and content generation

**File:** `src/hooks/useStreamingContent.ts`

**Lines:** ~180

### State
```typescript
const [isStreaming, setIsStreaming] = useState(false);
const [isPageLoading, setIsPageLoading] = useState(false);
const [streamedContent, setStreamedContent] = useState('');
```

### Methods
```typescript
const handleUserAction = async (
  userInput: string,
  userInputType: UserInputType,
  matchMode: MatchMode,
  userid: string | null,
  additionalRules: string[],
  previousExplanationViewedId: number | null,
  previousExplanationViewedVector: { values: number[] } | null
) => {
  // Streaming logic from lines 383-568
};
```

### Return Value
```typescript
return {
  isStreaming,
  isPageLoading,
  streamedContent,
  handleUserAction,
};
```

### Testing Example
```typescript
describe('useStreamingContent', () => {
  it('should handle streaming response', async () => {
    const mockStream = createMockStreamingResponse([
      { type: 'streaming_start' },
      { type: 'content', content: 'Partial content' },
      { type: 'content', content: 'Full content' },
      { type: 'complete', result: { explanationId: 123 } }
    ]);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: mockStream
    });

    const { result } = renderHook(() => useStreamingContent());

    await act(async () => {
      await result.current.handleUserAction('test query', UserInputType.Query, MatchMode.Normal, 'user123', [], null, null);
    });

    expect(result.current.isStreaming).toBe(false); // Streaming complete
    expect(result.current.streamedContent).toBe('Full content');
  });

  it('should handle streaming errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500
    });

    const { result } = renderHook(() => useStreamingContent());

    await act(async () => {
      await result.current.handleUserAction('test', UserInputType.Query, MatchMode.Normal, 'user123', [], null, null);
    });

    expect(result.current.isStreaming).toBe(false);
    // Error would be handled by parent
  });

  // ... 15-20 more tests
});
```

---

## Hook 4: useEditMode

**Responsibility:** Manage edit mode, change tracking, and publishing

**File:** `src/hooks/useEditMode.ts`

**Lines:** ~100

### State
```typescript
const [isEditMode, setIsEditMode] = useState(false);
const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
const [originalContent, setOriginalContent] = useState('');
const [originalTitle, setOriginalTitle] = useState('');
const [originalStatus, setOriginalStatus] = useState<ExplanationStatus | null>(null);
const [isSavingChanges, setIsSavingChanges] = useState(false);
```

### Methods
```typescript
const handleEditModeToggle = () => setIsEditMode(!isEditMode);

const handleContentChange = (newContent: string, currentTitle: string) => {
  const hasChanges = newContent !== originalContent || currentTitle !== originalTitle;
  setHasUnsavedChanges(hasChanges);
};

const handleSaveOrPublishChanges = async (
  explanationId: number,
  content: string,
  title: string,
  userid: string
) => { /* ... */ };

const setOriginals = (content: string, title: string, status: ExplanationStatus | null) => {
  setOriginalContent(content);
  setOriginalTitle(title);
  setOriginalStatus(status);
  setHasUnsavedChanges(false);
};
```

### Return Value
```typescript
return {
  isEditMode,
  setIsEditMode,
  hasUnsavedChanges,
  isSavingChanges,
  originalStatus,
  handleEditModeToggle,
  handleContentChange,
  handleSaveOrPublishChanges,
  setOriginals,
};
```

### Testing Example
```typescript
describe('useEditMode', () => {
  it('should detect content changes', () => {
    const { result } = renderHook(() => useEditMode());

    act(() => {
      result.current.setOriginals('original', 'Original Title', ExplanationStatus.Published);
    });

    act(() => {
      result.current.handleContentChange('modified', 'Original Title');
    });

    expect(result.current.hasUnsavedChanges).toBe(true);
  });

  it('should not detect changes when content is same', () => {
    const { result } = renderHook(() => useEditMode());

    act(() => {
      result.current.setOriginals('content', 'Title', ExplanationStatus.Published);
    });

    act(() => {
      result.current.handleContentChange('content', 'Title');
    });

    expect(result.current.hasUnsavedChanges).toBe(false);
  });

  // ... 8-12 more tests
});
```

---

## Hook 5: useMatches

**Responsibility:** Manage match display and interactions

**File:** `src/hooks/useMatches.ts`

**Lines:** ~60

### State
```typescript
const [matches, setMatches] = useState<matchWithCurrentContentType[]>([]);
const [showMatches, setShowMatches] = useState(false);
```

### Methods
```typescript
const toggleMatchesView = () => setShowMatches(!showMatches);
const clearMatches = () => setMatches([]);
```

### Return Value
```typescript
return {
  matches,
  setMatches,
  showMatches,
  setShowMatches,
  toggleMatchesView,
  clearMatches,
};
```

### Testing Example
```typescript
describe('useMatches', () => {
  it('should toggle matches view', () => {
    const { result } = renderHook(() => useMatches());

    act(() => {
      result.current.toggleMatchesView();
    });

    expect(result.current.showMatches).toBe(true);

    act(() => {
      result.current.toggleMatchesView();
    });

    expect(result.current.showMatches).toBe(false);
  });

  it('should manage matches state', () => {
    const { result } = renderHook(() => useMatches());
    const mockMatches = [createMockMatch(), createMockMatch()];

    act(() => {
      result.current.setMatches(mockMatches);
    });

    expect(result.current.matches).toEqual(mockMatches);
  });

  // ... 4-6 more tests
});
```

---

## Hook 6: useUrlParams

**Responsibility:** Handle URL parameter processing and routing

**File:** `src/hooks/useUrlParams.ts`

**Lines:** ~80

### State
```typescript
const searchParams = useSearchParams();
const router = useRouter();
const [mode, setMode] = useState<MatchMode>(MatchMode.Normal);
const [prompt, setPrompt] = useState('');
```

### Methods
```typescript
const initializeMode = (): MatchMode => {
  const urlMode = searchParams.get('mode') as MatchMode;
  const savedMode = localStorage.getItem('explanation-mode') as MatchMode;

  let initialMode = MatchMode.Normal;
  if (urlMode && Object.values(MatchMode).includes(urlMode)) {
    initialMode = urlMode;
  } else if (savedMode && Object.values(MatchMode).includes(savedMode)) {
    initialMode = savedMode;
  }

  // Clear mode parameter from URL
  if (urlMode) {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('mode');
    const newUrl = newParams.toString() ? `/results?${newParams.toString()}` : '/results';
    router.replace(newUrl);
  }

  return initialMode;
};

const processUrlParams = () => {
  const explanationId = searchParams.get('explanation_id');
  const userQueryId = searchParams.get('userQueryId');
  const title = searchParams.get('t');
  const query = searchParams.get('q');

  return { explanationId, userQueryId, title, query };
};
```

### Return Value
```typescript
return {
  mode,
  setMode,
  prompt,
  setPrompt,
  initializeMode,
  processUrlParams,
};
```

### Testing Example
```typescript
describe('useUrlParams', () => {
  it('should initialize mode from URL', () => {
    const mockSearchParams = new URLSearchParams('mode=SkipMatch');
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);

    const { result } = renderHook(() => useUrlParams());

    act(() => {
      const mode = result.current.initializeMode();
      result.current.setMode(mode);
    });

    expect(result.current.mode).toBe(MatchMode.SkipMatch);
  });

  it('should process URL parameters', () => {
    const mockSearchParams = new URLSearchParams('explanation_id=123&q=test');
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);

    const { result } = renderHook(() => useUrlParams());

    const params = result.current.processUrlParams();

    expect(params.explanationId).toBe('123');
    expect(params.query).toBe('test');
  });

  // ... 6-8 more tests
});
```

---

## Refactored Page Component

### Before: 1,317 lines

**File:** `src/app/results/page.tsx` (lines 1-1317)

### After: ~200 lines

```typescript
'use client';

import { useEffect, useRef } from 'react';
import Navigation from '@/components/Navigation';
import TagBar from '@/components/TagBar';
import ResultsLexicalEditor from '@/components/ResultsLexicalEditor';
import AISuggestionsPanel from '@/components/AISuggestionsPanel';
import { useExplanationData } from '@/hooks/useExplanationData';
import { useTagManagement } from '@/hooks/useTagManagement';
import { useStreamingContent } from '@/hooks/useStreamingContent';
import { useEditMode } from '@/hooks/useEditMode';
import { useMatches } from '@/hooks/useMatches';
import { useUrlParams } from '@/hooks/useUrlParams';
import { clientPassRequestId } from '@/hooks/clientPassRequestId';

export default function ResultsPage() {
  // Custom hooks - clean and organized
  const { withRequestId } = clientPassRequestId('anonymous');
  const explanation = useExplanationData();
  const tags = useTagManagement();
  const streaming = useStreamingContent();
  const edit = useEditMode();
  const matches = useMatches();
  const urlParams = useUrlParams();
  const editorRef = useRef(null);

  // Initialize mode from URL on mount
  useEffect(() => {
    const initialMode = urlParams.initializeMode();
    urlParams.setMode(initialMode);
  }, []);

  // Process URL parameters on mount/change
  useEffect(() => {
    const processParams = async () => {
      const params = urlParams.processUrlParams();

      if (params.query) {
        urlParams.setPrompt(params.query);
        await streaming.handleUserAction(
          params.query,
          UserInputType.Query,
          urlParams.mode,
          userid,
          [],
          null,
          null
        );
      } else if (params.explanationId) {
        await explanation.loadExplanation(parseInt(params.explanationId), true);
      }
      // ... other parameter handling
    };

    processParams();
  }, [searchParams]);

  // Handle tag bar apply click
  const handleTagBarApplyClick = async (tagDescriptions: string[]) => {
    if (tags.modeOverride === TagBarMode.RewriteWithTags) {
      await streaming.handleUserAction(
        explanation.explanationTitle,
        UserInputType.RewriteWithTags,
        urlParams.mode,
        userid,
        tagDescriptions,
        null,
        null
      );
    }
    // ... other mode handling
  };

  // Render UI
  return (
    <div className="h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Navigation
        showSearchBar={true}
        searchBarProps={{
          disabled: streaming.isPageLoading || streaming.isStreaming
        }}
      />

      {streaming.isPageLoading && <ProgressBar />}

      <main className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Main Content */}
          <div className="flex-1 px-4 py-8">
            {matches.showMatches ? (
              <MatchesView
                matches={matches.matches}
                onBack={() => matches.setShowMatches(false)}
                onViewMatch={explanation.loadExplanation}
              />
            ) : (
              <ExplanationView
                title={explanation.explanationTitle}
                content={explanation.content}
                tags={tags.isInRewriteMode() ? tags.tempTagsForRewriteWithTags : tags.tags}
                isEditMode={edit.isEditMode}
                isStreaming={streaming.isStreaming}
                editorRef={editorRef}
                onContentChange={edit.handleContentChange}
                onSave={explanation.saveToLibrary}
                onPublish={edit.handleSaveOrPublishChanges}
              />
            )}
          </div>

          {/* AI Suggestions Panel */}
          <div className="w-96 py-8 pr-4">
            <AISuggestionsPanel
              isVisible={true}
              currentContent={explanation.content}
              editorRef={editorRef}
              sessionData={{
                explanation_id: explanation.explanationId,
                explanation_title: explanation.explanationTitle
              }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
```

**Key improvements:**
- Reduced from 1,317 to ~200 lines
- State grouped by concern in hooks
- Clear data flow
- Easy to understand
- Easy to test

---

## Testing Strategy: Before vs After

### Before Refactoring

```typescript
// Attempting to test monolithic component
describe('ResultsPage - Monolithic', () => {
  it('should handle complete user flow', async () => {
    // Mock 14+ server actions
    const mockActions = setupAllServerActionMocks();

    // Mock Next.js hooks
    const mockRouter = { push: jest.fn(), replace: jest.fn() };
    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useSearchParams as jest.Mock).mockReturnValue(new URLSearchParams());

    // Mock streaming response
    const mockStream = createComplexStreamingMock();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, body: mockStream });

    // Render component
    render(<ResultsPage />);

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    // Simulate user entering query
    const searchInput = screen.getByRole('textbox');
    fireEvent.change(searchInput, { target: { value: 'test query' } });
    fireEvent.submit(screen.getByRole('form'));

    // Wait for streaming to complete
    await waitFor(() => {
      expect(screen.getByText('Generated Title')).toBeInTheDocument();
    }, { timeout: 5000 });

    // Verify all state updates happened in correct order
    // ... 50+ more assertions

    // This test is:
    // - 100+ lines
    // - Brittle (breaks on any refactor)
    // - Slow (waits for streaming)
    // - Hard to debug (which assertion failed?)
    // - Incomplete (many edge cases missed)
  });
});
```

**Problems:**
- One massive test covering too much
- Hard to isolate failures
- Slow execution
- Poor coverage of edge cases
- Brittle - breaks on any change

### After Refactoring

```typescript
// Test hooks individually - fast and focused
describe('useExplanationData', () => {
  it('should load explanation', async () => {
    const { result } = renderHook(() => useExplanationData());
    await act(async () => {
      await result.current.loadExplanation(123, false);
    });
    expect(result.current.explanationTitle).toBe('Test');
  });
  // ... 10-15 focused tests
});

describe('useStreamingContent', () => {
  it('should handle streaming', async () => {
    const { result } = renderHook(() => useStreamingContent());
    await act(async () => {
      await result.current.handleUserAction(/* ... */);
    });
    expect(result.current.streamedContent).toBe('Full content');
  });
  // ... 15-20 focused tests
});

// Test page integration - simple
describe('ResultsPage - Integration', () => {
  it('should render with explanation', () => {
    // Mock hooks return values
    jest.spyOn(require('@/hooks/useExplanationData'), 'useExplanationData')
      .mockReturnValue({
        explanationTitle: 'Test',
        content: 'Content',
        // ... other values
      });

    render(<ResultsPage />);

    expect(screen.getByText('Test')).toBeInTheDocument();
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  // ... 10-15 integration tests
});
```

**Benefits:**
- Each test is 5-15 lines
- Fast execution (no streaming delays)
- Easy to debug (clear failure point)
- Complete coverage (easy to test edge cases)
- Maintainable (changes isolated to relevant hooks)

---

## Step-by-Step Refactoring Guide

### Phase 1: Create Hook Files (2 hours)

1. Create `src/hooks/` directory if it doesn't exist
2. Create 6 empty hook files:
   - `useExplanationData.ts`
   - `useTagManagement.ts`
   - `useStreamingContent.ts`
   - `useEditMode.ts`
   - `useMatches.ts`
   - `useUrlParams.ts`

### Phase 2: Extract useMatches (0.5 hours)

**Why start here:** Simplest hook, builds confidence

1. Copy matches-related state to `useMatches.ts`
2. Copy matches-related functions
3. Export return value
4. Import and use in page component
5. Test - page should work identically
6. Write tests for `useMatches`

### Phase 3: Extract useEditMode (1 hour)

1. Copy edit-related state to `useEditMode.ts`
2. Copy edit-related functions
3. Export return value
4. Import and use in page component
5. Test functionality
6. Write tests

### Phase 4: Extract useTagManagement (1.5 hours)

1. Copy tag-related state to `useTagManagement.ts`
2. Copy tag-related functions
3. Export return value
4. Import and use in page component
5. Test functionality
6. Write tests

### Phase 5: Extract useUrlParams (1 hour)

1. Copy URL/routing state to `useUrlParams.ts`
2. Copy mode initialization and param processing
3. Export return value
4. Import and use in page component
5. Test functionality
6. Write tests

### Phase 6: Extract useExplanationData (2 hours)

1. Copy explanation-related state to `useExplanationData.ts`
2. Copy loadExplanation, checkUserSaved, saveToLibrary
3. Export return value
4. Import and use in page component
5. Test functionality
6. Write tests

### Phase 7: Extract useStreamingContent (2 hours)

**Why save for last:** Most complex, depends on understanding from other hooks

1. Copy streaming state to `useStreamingContent.ts`
2. Copy handleUserAction (large function)
3. Export return value
4. Import and use in page component
5. Test functionality
6. Write tests

### Phase 8: Simplify Page Component (1 hour)

1. Remove all extracted code
2. Clean up imports
3. Simplify useEffect hooks
4. Organize remaining UI logic
5. Final testing

**Total refactoring time: 8-12 hours**

---

## Time Investment Analysis

### Without Refactoring
- Testing monolithic component: 30-40 hours
- Result: Brittle, incomplete tests
- Maintenance cost: High (tests break often)
- **Total: 30-40 hours + ongoing high maintenance**

### With Refactoring
- Refactoring: 8-12 hours
- Testing hooks: 8-10 hours
- Testing page integration: 4-6 hours
- Result: Robust, maintainable tests
- Maintenance cost: Low (tests are isolated)
- **Total: 20-28 hours + ongoing low maintenance**

### Net Savings
- **Immediate: 10-20 hours**
- **Long-term: 50%+ reduction in maintenance time**
- **Quality: Much better code and tests**

---

## Benefits Summary

### Testability
| Metric | Before | After |
|--------|--------|-------|
| Test complexity | 200+ lines/test | 10-15 lines/test |
| Test speed | Slow (streaming) | Fast (isolated) |
| Coverage | ~40% | 70-75% |
| Maintainability | Brittle | Robust |

### Code Quality
| Metric | Before | After |
|--------|--------|-------|
| Component size | 1,317 lines | ~200 lines |
| State variables | 25+ in one place | Grouped by concern |
| Understandability | Hard | Easy |
| Changeability | Risky | Safe |

### Team Velocity
| Metric | Before | After |
|--------|--------|-------|
| Onboarding time | 2-3 days | 4-6 hours |
| Bug fix time | 2-4 hours | 30 mins - 1 hour |
| Feature add time | 1-2 days | 2-4 hours |
| Code review time | 1-2 hours | 20-30 mins |

---

## Success Criteria

### Refactoring Complete When:
- ✅ All 6 hooks created and tested
- ✅ Page component reduced to ~200 lines
- ✅ All functionality preserved (no regressions)
- ✅ All original tests still pass
- ✅ 40+ new hook tests written
- ✅ Hooks are documented

### Testing Complete When:
- ✅ 70-75% coverage of results page flow
- ✅ All critical user flows tested
- ✅ All hooks have 80%+ coverage
- ✅ Integration tests verify page behavior
- ✅ Tests run in < 30 seconds

---

## Risk Mitigation

### Risk 1: Breaking Changes During Refactoring
**Mitigation:**
- Refactor one hook at a time
- Test after each extraction
- Keep original code commented out temporarily
- Use version control (commit after each hook)

### Risk 2: Missing Edge Cases
**Mitigation:**
- Review all useEffect dependencies
- Check all state update sequences
- Test streaming behavior thoroughly
- Verify URL parameter handling

### Risk 3: Time Overrun
**Mitigation:**
- Start with simple hooks (useMatches)
- Build confidence before complex hooks
- Can pause after each hook if needed
- Page remains functional throughout

---

## Next Steps

1. **Review this strategy with team** - Get buy-in
2. **Create hooks directory** - Set up structure
3. **Start with useMatches** - Build confidence
4. **Extract hooks one at a time** - Test after each
5. **Write hook tests** - Achieve 80%+ coverage
6. **Simplify page component** - Final cleanup
7. **Write page integration tests** - Verify behavior
8. **Document learnings** - Share with team

---

## References

- Current file: `src/app/results/page.tsx` (1,317 lines)
- Testing plan: `src/backend_explorations/phases_11_12_testing_plan.md`
- React Hooks docs: https://react.dev/reference/react
- Testing Library: https://testing-library.com/docs/react-testing-library/intro/
- Custom Hooks testing: https://react-hooks-testing-library.com/

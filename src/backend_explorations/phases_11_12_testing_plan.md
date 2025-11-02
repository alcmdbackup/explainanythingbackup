# Phases 11 & 12: Component and Page Testing Implementation Plan

**Created:** 2025-11-01
**Status:** Planning
**Estimated Effort:** 47-55 hours
**Expected Tests:** 167-212 new tests
**Target Coverage Increase:** +15-20%

---

## Executive Summary

Comprehensive testing plan for UI layer covering all 6 React components and 4 production pages in the ExplainAnything codebase. This builds on 342 existing passing tests (99.4% pass rate) and established testing infrastructure with Jest, React Testing Library, and comprehensive mocks.

### Key Deliverables
- **Phase 11:** Test all 6 components (103-132 tests, 28-32 hours)
- **Phase 12:** Test all 4 production pages (64-80 tests, 19-23 hours)
- **Total:** 167-212 tests across 2-3 weeks

### Prerequisites
- ✅ Jest 30.2.0 configured with ts-jest
- ✅ React Testing Library 16.3.0 in jsdom environment
- ✅ Comprehensive mocks (OpenAI, Pinecone, Supabase, Next.js)
- ✅ 342 passing tests establishing patterns
- ⚠️ **Critical:** Refactor results/page.tsx before Phase 12 (see results_page_refactoring_strategy.md)

---

## Phase 11: Component Testing (Weeks 13-14)

### Overview
Test all 6 React components with focus on user interactions, state management, and server action integration.

### Component Inventory

#### 1. Navigation.tsx
- **Complexity:** LOW
- **Priority:** HIGH (used on all pages)
- **Lines:** 84
- **Type:** Client component
- **Dependencies:**
  - SearchBar component
  - signOut server action
  - Next.js Link
- **Estimated Tests:** 8-10 tests
- **Time:** 2 hours

**Test Coverage:**
```typescript
describe('Navigation', () => {
  // Rendering
  - should render with search bar when showSearchBar=true
  - should render without search bar when showSearchBar=false
  - should render logout button when user is logged in

  // User Interactions
  - should call signOut when logout clicked
  - should navigate to home when logo clicked

  // Search Bar Integration
  - should pass props to SearchBar correctly
  - should disable SearchBar when disabled prop is true

  // Error Handling
  - should handle signOut errors gracefully
});
```

#### 2. SearchBar.tsx
- **Complexity:** LOW-MEDIUM
- **Priority:** HIGH (core search functionality)
- **Lines:** 92
- **Type:** Client component with variants (home/nav)
- **State:** prompt (controlled input)
- **Props:** variant, placeholder, maxLength, initialValue, onSearch, disabled
- **Estimated Tests:** 12-15 tests
- **Time:** 3 hours

**Test Coverage:**
```typescript
describe('SearchBar', () => {
  // Rendering
  - should render home variant with larger styling
  - should render nav variant with compact styling
  - should display placeholder text
  - should pre-populate with initialValue

  // User Interactions
  - should update input on text change
  - should call onSearch on form submit
  - should call onSearch on Enter key press
  - should not submit empty query
  - should respect maxLength constraint

  // State Management
  - should maintain controlled input state
  - should clear input after successful submit (if configured)

  // Disabled State
  - should disable input when disabled=true
  - should prevent form submission when disabled
});
```

#### 3. ExplanationsTablePage.tsx
- **Complexity:** MEDIUM
- **Priority:** MEDIUM
- **Lines:** 162
- **Type:** Client component
- **State:** sortBy, sortOrder
- **Props:** explanations, error, showNavigation, pageTitle
- **Features:** Sortable columns, navigation bar, content preview
- **Estimated Tests:** 15-20 tests
- **Time:** 4 hours

**Test Coverage:**
```typescript
describe('ExplanationsTablePage', () => {
  // Rendering
  - should render table with explanations
  - should render navigation when showNavigation=true
  - should display page title
  - should show empty state when no explanations
  - should display error message when error provided

  // Sorting
  - should sort by title ascending
  - should sort by title descending
  - should sort by date ascending
  - should sort by date descending
  - should toggle sort order on column click
  - should maintain sort state

  // Data Display
  - should format dates correctly
  - should truncate long content previews
  - should display all table columns

  // Navigation
  - should link to explanation detail pages
  - should pass correct explanation ID in links

  // Responsive Behavior
  - should apply responsive table classes
});
```

#### 4. AISuggestionsPanel.tsx
- **Complexity:** MEDIUM-HIGH
- **Priority:** MEDIUM
- **Lines:** 231
- **Type:** Client component
- **State:** userPrompt, isLoading, progressState, error, lastResult
- **Props:** isVisible, onClose, currentContent, editorRef, onContentChange, onEnterEditMode, sessionData
- **Estimated Tests:** 18-22 tests
- **Time:** 5 hours

**Test Coverage:**
```typescript
describe('AISuggestionsPanel', () => {
  // Rendering
  - should render panel when isVisible=true
  - should hide panel when isVisible=false
  - should display form for user input

  // Form Submission
  - should update userPrompt state on input change
  - should call runAISuggestionsPipelineAction on submit
  - should prevent submission with empty prompt
  - should pass correct parameters to server action

  // Loading States
  - should show loading indicator during processing
  - should disable form during loading
  - should display progress state updates

  // Success States
  - should display suggestion result
  - should call onContentChange with result
  - should show success message
  - should clear form after success (if configured)

  // Error Handling
  - should display error message on failure
  - should re-enable form after error
  - should clear error on new submission

  // Editor Integration
  - should call editorRef methods correctly
  - should trigger edit mode via onEnterEditMode

  // Session Data
  - should include sessionData in API calls
});
```

#### 5. TagBar.tsx
- **Complexity:** VERY HIGH ⚠️
- **Priority:** HIGH (critical feature, high complexity)
- **Lines:** 1,069
- **Type:** Client component with complex state
- **State:** 12+ state variables (tags, modes, dropdowns, availableTags)
- **Props:** 10+ props including tags, setTags, explanationId, modeOverride
- **Features:** 3 modes, tag add/remove/restore, preset collections, searchable
- **Estimated Tests:** 30-40 tests
- **Time:** 8-10 hours

**Test Coverage:**
```typescript
describe('TagBar', () => {
  // Rendering - Normal Mode
  - should render tags in normal mode
  - should show add tag button
  - should display tag badges

  // Rendering - RewriteWithTags Mode
  - should render in rewrite mode
  - should show apply button in rewrite mode
  - should display preset tag collections

  // Rendering - EditWithTags Mode
  - should render in edit mode
  - should show apply button in edit mode
  - should allow tag editing

  // Tag Adding
  - should open tag dropdown on add click
  - should display available tags
  - should filter tags by search query
  - should add tag on selection
  - should close dropdown after adding
  - should prevent duplicate tags

  // Tag Removing
  - should remove tag on remove button click
  - should mark tag as removed (not deleted)
  - should allow restoring removed tags

  // Preset Collections
  - should load preset tag collections
  - should apply preset on selection
  - should replace existing tags with preset

  // Click Outside
  - should close dropdown on outside click
  - should preserve state when closing

  // Mode Switching
  - should switch between modes correctly
  - should reset state on mode change
  - should preserve tags across mode changes

  // Apply Functionality
  - should call tagBarApplyClickHandler with tag descriptions
  - should pass correct tag data
  - should reset to normal mode after apply

  // Server Action Integration
  - should call getAllTagsAction to fetch available tags
  - should handle server errors gracefully

  // Modified State
  - should track modified state
  - should call setIsTagsModified on changes

  // Streaming State
  - should disable interactions when isStreaming=true
});
```

#### 6. ResultsLexicalEditor.tsx
- **Complexity:** VERY HIGH ⚠️
- **Priority:** HIGH (core editor)
- **Lines:** 197
- **Type:** Client component with forwardRef
- **Ref Methods:** updateContent, getContent, setReadOnly
- **State:** currentContent, internalEditMode, refs for debounce
- **Props:** content, isEditMode, onEditModeToggle, onContentChange, isStreaming
- **Estimated Tests:** 20-25 tests
- **Time:** 6-8 hours

**Test Coverage:**
```typescript
describe('ResultsLexicalEditor', () => {
  // Note: Mock entire LexicalEditor component

  // Rendering
  - should render LexicalEditor component
  - should pass content to LexicalEditor
  - should render in read-only mode by default

  // Edit Mode
  - should toggle edit mode
  - should enable editing when isEditMode=true
  - should call onEditModeToggle when toggled

  // Content Updates
  - should handle content changes
  - should debounce rapid content updates
  - should call onContentChange after debounce
  - should filter initial load updates

  // Streaming Behavior
  - should update content during streaming
  - should apply debounce during streaming
  - should handle streaming end

  // Ref Methods
  - should expose updateContent method
  - should expose getContent method
  - should expose setReadOnly method
  - should update editor via updateContent
  - should return current content via getContent

  // Debouncing
  - should debounce content updates (use jest.useFakeTimers)
  - should batch multiple rapid updates
  - should flush debounce on unmount

  // Initial Load
  - should skip onContentChange on initial mount
  - should track initial load state
});
```

### Week 13-14 Schedule

**Week 13: Simple & Medium Components**
- Day 1-2: Setup centralized server action mocks
- Day 3-4: Navigation.tsx + SearchBar.tsx (5 hours)
- Day 5-7: ExplanationsTablePage.tsx + AISuggestionsPanel.tsx (9 hours)

**Week 14: Complex Components**
- Day 8-12: TagBar.tsx (8-10 hours)
- Day 13-14: ResultsLexicalEditor.tsx (6-8 hours)

**Total Week 13-14:** 28-32 hours, 103-132 tests

---

## Phase 12: Page Testing (Week 15)

### Overview
Test 4 production pages with focus on data loading, routing, and component integration. Skip 11 test/demo pages (not production code).

### Page Inventory

#### 1. src/app/page.tsx (Home)
- **Complexity:** LOW
- **Priority:** HIGH (entry point)
- **Lines:** 31
- **Type:** Client component
- **Components:** SearchBar (home variant), Navigation
- **Estimated Tests:** 6-8 tests
- **Time:** 2 hours

**Test Coverage:**
```typescript
describe('Home Page', () => {
  // Rendering
  - should render navigation
  - should render search bar in home variant
  - should display centered layout

  // Search Integration
  - should handle search submission
  - should navigate to results page with query

  // Accessibility
  - should have proper heading structure
  - should have accessible search form

  // SEO
  - should render page metadata
});
```

#### 2. src/app/explanations/page.tsx
- **Complexity:** LOW
- **Priority:** MEDIUM
- **Lines:** 20
- **Type:** Server component
- **Server Functions:** getRecentExplanations
- **Components:** ExplanationsTablePage
- **Estimated Tests:** 8-10 tests
- **Time:** 2 hours

**Test Coverage:**
```typescript
describe('Explanations Page', () => {
  // Server Component Testing
  - should fetch recent explanations on load
  - should pass explanations to table component
  - should render ExplanationsTablePage

  // Data Loading
  - should handle successful data fetch
  - should handle empty explanations list
  - should handle fetch errors

  // Component Integration
  - should pass correct props to ExplanationsTablePage
  - should show navigation in table

  // Error States
  - should display error message on failure
});
```

#### 3. src/app/userlibrary/page.tsx
- **Complexity:** LOW-MEDIUM
- **Priority:** HIGH (key user feature)
- **Lines:** 50
- **Type:** Client component
- **Server Actions:** getUserLibraryExplanationsAction
- **State:** userExplanations, error, loading
- **Components:** ExplanationsTablePage
- **Estimated Tests:** 10-12 tests
- **Time:** 3 hours

**Test Coverage:**
```typescript
describe('User Library Page', () => {
  // Rendering
  - should render loading state initially
  - should render explanations table after load
  - should render navigation

  // Data Loading
  - should call getUserLibraryExplanationsAction on mount
  - should update state with fetched explanations
  - should handle loading state transitions

  // Error Handling
  - should display error message on fetch failure
  - should show empty state when no explanations
  - should allow retry after error

  // User Authentication
  - should redirect if user not authenticated
  - should pass user ID to fetch action
});
```

#### 4. src/app/results/page.tsx ⚠️ REQUIRES REFACTORING
- **Complexity:** EXTREME (1,317 lines, 25+ state variables)
- **Priority:** CRITICAL (main app page)
- **Type:** Client component
- **Components:** Navigation, TagBar, ResultsLexicalEditor, AISuggestionsPanel
- **Estimated Tests:** 40-50 tests (after refactoring)
- **Time:** 12-16 hours (includes refactoring)

**CRITICAL:** Must refactor before testing. See `results_page_refactoring_strategy.md`.

**Test Coverage (after extracting custom hooks):**
```typescript
// Test hooks separately
describe('useExplanationData', () => {
  - should load explanation by ID
  - should handle load errors
  - should fetch tags for explanation
  - should fetch vector data
});

describe('useTagManagement', () => {
  - should initialize temp tags
  - should manage tag state
  - should handle mode override
});

describe('useStreamingContent', () => {
  - should handle streaming responses
  - should update content during stream
  - should handle stream errors
});

describe('useEditMode', () => {
  - should track unsaved changes
  - should compare with original content
  - should handle edit mode toggle
});

describe('useMatches', () => {
  - should manage matches display
  - should toggle matches view
});

// Test page integration
describe('Results Page', () => {
  // Rendering
  - should render navigation
  - should render tag bar
  - should render editor
  - should render AI suggestions panel

  // URL Parameters
  - should load explanation from explanation_id param
  - should load query from q param
  - should handle mode param

  // Critical Flows
  - should generate new explanation from query
  - should display existing explanation
  - should save explanation to library
  - should handle rewrite operation
  - should publish changes

  // Tag Management
  - should display tags
  - should handle rewrite with tags
  - should handle edit with tags

  // Edit Mode
  - should toggle edit mode
  - should track unsaved changes
  - should save changes

  // Streaming
  - should show streaming indicator
  - should update content during streaming
  - should disable actions during streaming

  // Error Handling
  - should display error messages
  - should handle API errors
  - should handle authentication errors

  // Mode Switching
  - should persist mode to localStorage
  - should switch between modes

  // Match Display
  - should show matches when available
  - should toggle matches view
  - should load explanation from match
});
```

**Refactoring Strategy:**
1. Extract custom hooks (8-10 hours)
2. Test hooks individually (8-10 hours)
3. Test page integration (4-6 hours)
4. Total: 20-26 hours (vs 30-40 hours without refactoring)

**Acceptance Criteria:**
- 70-75% coverage target (not 85% - this is acceptable for extreme complexity)
- All critical user flows tested
- Hooks are reusable
- Page component is maintainable

### Week 15 Schedule

**Day 1-2: Refactoring**
- Extract custom hooks from results/page.tsx
- Create test utilities for hooks

**Day 3-5: Simple Pages**
- Home page (2 hours)
- Explanations page (2 hours)
- User Library page (3 hours)

**Day 6-10: Complex Page**
- Test extracted hooks (8-10 hours)
- Test results page integration (4-6 hours)

**Total Week 15:** 19-23 hours, 64-80 tests

---

## Testing Infrastructure

### Mock Setup Pattern

**Create centralized server action mocks:**
```typescript
// src/__mocks__/@/actions/actions.ts
export const getAllTagsAction = jest.fn();
export const getTagsForExplanationAction = jest.fn();
export const getTempTagsForRewriteWithTagsAction = jest.fn();
export const saveExplanationToLibraryAction = jest.fn();
export const isExplanationSavedByUserAction = jest.fn();
export const getUserQueryByIdAction = jest.fn();
export const createUserExplanationEventAction = jest.fn();
export const getExplanationByIdAction = jest.fn();
export const getUserLibraryExplanationsAction = jest.fn();
export const loadFromPineconeUsingExplanationIdAction = jest.fn();
export const saveOrPublishChanges = jest.fn();
export const runAISuggestionsPipelineAction = jest.fn();
export const handleApplyForModifyTags = jest.fn();
export const signOut = jest.fn();
```

### Lexical Editor Mock

**Mock the entire LexicalEditor component:**
```typescript
// jest.setup.js or individual test files
jest.mock('@/editorFiles/lexicalEditor/LexicalEditor', () => ({
  __esModule: true,
  default: jest.fn(({ content, onContentChange, isEditMode }) => (
    <div data-testid="lexical-editor">
      <div data-testid="content">{content}</div>
      <button
        data-testid="trigger-change"
        onClick={() => onContentChange?.('new content')}
      >
        Change Content
      </button>
    </div>
  ))
}));
```

### Async Testing with Timers

**For debouncing and timeouts:**
```typescript
describe('Component with debouncing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should debounce updates', async () => {
    render(<Component />);

    // Trigger multiple updates
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'test' } });

    // Advance timers
    act(() => {
      jest.advanceTimersByTime(100);
    });

    expect(mockCallback).toHaveBeenCalledTimes(1);
  });
});
```

### Click Outside Handler Testing

```typescript
it('should close on outside click', () => {
  render(<Component />);

  // Open dropdown
  fireEvent.click(screen.getByText('Open'));
  expect(screen.getByText('Dropdown Content')).toBeInTheDocument();

  // Click outside
  fireEvent.mouseDown(document.body);
  expect(screen.queryByText('Dropdown Content')).not.toBeInTheDocument();
});
```

---

## Component Test Template

```typescript
/**
 * Component: ComponentName
 * Complexity: LOW/MEDIUM/HIGH
 * Test Coverage Target: 80%+
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { jest } from '@jest/globals';
import ComponentName from './ComponentName';

// Mock dependencies
jest.mock('@/actions/actions');
jest.mock('next/navigation');

describe('ComponentName', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render with default props', () => {
      render(<ComponentName />);
      expect(screen.getByTestId('component-name')).toBeInTheDocument();
    });

    it('should render with custom props', () => {
      render(<ComponentName customProp="value" />);
      expect(screen.getByText('value')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('should handle button click', () => {
      const onClickMock = jest.fn();
      render(<ComponentName onClick={onClickMock} />);

      fireEvent.click(screen.getByRole('button'));
      expect(onClickMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('State Management', () => {
    it('should update state on input change', async () => {
      render(<ComponentName />);

      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'new value' } });

      await waitFor(() => {
        expect(input).toHaveValue('new value');
      });
    });
  });

  describe('Error Handling', () => {
    it('should display error message', () => {
      render(<ComponentName error="Test error" />);
      expect(screen.getByText('Test error')).toBeInTheDocument();
    });
  });
});
```

---

## Success Criteria

### Phase 11 Success Criteria
- ✅ 100+ component tests written
- ✅ All 6 components have test coverage
- ✅ 85%+ pass rate
- ✅ Clear patterns established for React component testing
- ✅ Mock infrastructure for all server actions
- ✅ Documentation of component testing approach

### Phase 12 Success Criteria
- ✅ 60+ page tests written
- ✅ All 4 production pages have test coverage
- ✅ 80%+ pass rate
- ✅ Critical user flows tested (search, view, save)
- ✅ results/page.tsx refactored for testability
- ✅ Integration test approach documented

### Overall Success Criteria
- ✅ 167+ new tests added
- ✅ Total test count: 511+ tests (344 current + 167 new)
- ✅ Overall pass rate: 95%+
- ✅ CI/CD passing with new tests
- ✅ Coverage increase: +15-20% from current baseline

---

## Estimated Effort Summary

| Phase | Component/Page | Complexity | Tests | Hours |
|-------|---------------|------------|-------|-------|
| **Phase 11** | | | | |
| 11 | Navigation | LOW | 8-10 | 2 |
| 11 | SearchBar | LOW-MED | 12-15 | 3 |
| 11 | ExplanationsTablePage | MEDIUM | 15-20 | 4 |
| 11 | AISuggestionsPanel | MED-HIGH | 18-22 | 5 |
| 11 | TagBar | VERY HIGH | 30-40 | 8-10 |
| 11 | ResultsLexicalEditor | VERY HIGH | 20-25 | 6-8 |
| **Phase 11 Total** | | | **103-132** | **28-32** |
| **Phase 12** | | | | |
| 12 | Home page | LOW | 6-8 | 2 |
| 12 | Explanations page | LOW | 8-10 | 2 |
| 12 | User Library page | LOW-MED | 10-12 | 3 |
| 12 | Results page (refactored) | EXTREME | 40-50 | 12-16 |
| **Phase 12 Total** | | | **64-80** | **19-23** |
| **GRAND TOTAL** | | | **167-212** | **47-55** |

---

## Risks & Mitigation

### Risk 1: Lexical Editor Complexity
**Impact:** HIGH
**Probability:** HIGH
**Mitigation:**
- Mock entire LexicalEditor component
- Focus on ResultsLexicalEditor wrapper logic, not Lexical internals
- Consider integration tests instead of deep unit tests

### Risk 2: results/page.tsx Size
**Impact:** CRITICAL
**Probability:** HIGH
**Mitigation:**
- **REQUIRED:** Refactor before testing
- Extract custom hooks (see results_page_refactoring_strategy.md)
- Accept 70-75% coverage (not 85%)
- Use integration tests for complex flows

### Risk 3: Server Action Mocking
**Impact:** MEDIUM
**Probability:** MEDIUM
**Mitigation:**
- Create centralized mock setup in src/__mocks__/@/actions/actions.ts
- Document mock patterns clearly
- Use factory functions for complex mock responses

### Risk 4: Async State Updates
**Impact:** MEDIUM
**Probability:** MEDIUM
**Mitigation:**
- Use `waitFor()` extensively
- Use `act()` for state updates
- Use `jest.useFakeTimers()` for debouncing
- Follow React Testing Library best practices

---

## Next Steps

1. **Read refactoring strategy:** Review `results_page_refactoring_strategy.md`
2. **Set up centralized mocks:** Create `src/__mocks__/@/actions/actions.ts`
3. **Start with simple components:** Navigation.tsx and SearchBar.tsx
4. **Build confidence:** Establish patterns before tackling complex components
5. **Refactor results page:** Extract hooks before Phase 12
6. **Document learnings:** Update patterns as you discover better approaches

---

## References

- Testing plan overview: `/src/planning/testing_plan/testing_plan.md`
- Test helpers: `/src/testing/utils/test-helpers.ts`
- Existing mocks: `/src/__mocks__/`
- Jest config: `/jest.config.js`
- Refactoring strategy: `/src/backend_explorations/results_page_refactoring_strategy.md`

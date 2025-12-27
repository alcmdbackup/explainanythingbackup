/**
 * Test utilities for component testing
 * Provides mock factories for component props, server actions, and complex component types
 */

import { faker } from '@faker-js/faker';
import type { FeedbackModeState } from '@/reducers/tagModeReducer';
import type { SimpleTagUIType, PresetTagUIType, TagUIType } from '@/lib/schemas/schemas';

// ============================================================================
// Tag Mock Factories
// ============================================================================

/**
 * Creates a mock simple tag for testing
 */
export const createMockSimpleTag = (overrides: Partial<SimpleTagUIType> = {}): SimpleTagUIType => ({
  id: faker.number.int({ min: 1, max: 1000 }),
  tag_name: faker.lorem.word(),
  tag_description: faker.lorem.sentence(),
  presetTagId: null,
  created_at: faker.date.recent().toISOString(),
  tag_active_current: true,
  tag_active_initial: true,
  ...overrides,
});

/**
 * Creates a mock preset tag collection for testing
 */
export const createMockPresetTag = (overrides: Partial<PresetTagUIType> = {}): PresetTagUIType => {
  const tag1Id = faker.number.int({ min: 1, max: 1000 });
  const tag2Id = faker.number.int({ min: 1001, max: 2000 });

  return {
    tags: [
      {
        id: tag1Id,
        tag_name: faker.lorem.word(),
        tag_description: faker.lorem.sentence(),
        presetTagId: 1,
        created_at: faker.date.recent().toISOString(),
      },
      {
        id: tag2Id,
        tag_name: faker.lorem.word(),
        tag_description: faker.lorem.sentence(),
        presetTagId: 1,
        created_at: faker.date.recent().toISOString(),
      },
    ],
    tag_active_current: true,
    tag_active_initial: true,
    currentActiveTagId: tag1Id,
    originalTagId: tag1Id,
    ...overrides,
  };
};

// ============================================================================
// FeedbackModeState Mock Factory
// ============================================================================

/**
 * Creates a mock FeedbackModeState for testing TagBar
 */
export const createMockTagState = (overrides: any = {}): FeedbackModeState => {
  const mode = overrides.mode || 'normal';

  if (mode === 'rewriteWithFeedback') {
    return {
      mode: 'rewriteWithFeedback',
      tempTags: overrides.tags || overrides.tempTags || [],
      originalTags: overrides.originalTags || [],
      showRegenerateDropdown: false,
    };
  }

  if (mode === 'editWithFeedback') {
    return {
      mode: 'editWithFeedback',
      tags: overrides.tags || [],
      originalTags: overrides.originalTags || [],
      showRegenerateDropdown: false,
    };
  }

  // Normal mode
  return {
    mode: 'normal',
    tags: overrides.tags || [],
    originalTags: overrides.originalTags || [],
    showRegenerateDropdown: overrides.showRegenerateDropdown !== undefined ? overrides.showRegenerateDropdown : false,
  };
};

// ============================================================================
// Component Props Mock Factories
// ============================================================================

/**
 * Creates mock props for Navigation component
 */
export const createMockNavigationProps = (overrides = {}) => ({
  showSearchBar: false,
  searchBarProps: undefined,
  ...overrides,
});

/**
 * Creates mock props for SearchBar component
 */
export const createMockSearchBarProps = (overrides = {}) => ({
  variant: 'home' as const,
  placeholder: 'Search...',
  maxLength: 1000,
  initialValue: '',
  onSearch: undefined,
  disabled: false,
  ...overrides,
});

/**
 * Creates mock props for TagBar component
 */
export const createMockTagBarProps = (overrides = {}) => ({
  tagState: createMockTagState(),
  dispatch: jest.fn(),
  explanationId: faker.number.int({ min: 1, max: 1000 }),
  onTagClick: jest.fn(),
  tagBarApplyClickHandler: jest.fn(),
  isStreaming: false,
  className: '',
  ...overrides,
});

/**
 * Creates mock props for AISuggestionsPanel component
 */
export const createMockAISuggestionsPanelProps = (overrides: Record<string, unknown> = {}) => {
  // Determine isOpen value
  let isOpenValue = true;
  if (overrides.isOpen !== undefined) {
    isOpenValue = overrides.isOpen as boolean;
  }

  // Remove isOpen from overrides to apply default
  const { isOpen, ...restOverrides } = overrides;

  return {
    isOpen: isOpenValue,
    onOpenChange: jest.fn(),
    currentContent: faker.lorem.paragraph(),
    editorRef: {
      current: {
        getContentAsMarkdown: jest.fn(() => faker.lorem.paragraph()),
        setContentFromMarkdown: jest.fn(),
        setEditMode: jest.fn(),
        focus: jest.fn(),
      },
    },
    dispatch: jest.fn(),
    isStreaming: false,
    sessionData: undefined,
    ...restOverrides,
  };
};

/**
 * Creates mock session data for AISuggestionsPanel
 */
export const createMockSessionData = (overrides = {}) => ({
  explanation_id: faker.number.int({ min: 1, max: 1000 }),
  explanation_title: faker.lorem.sentence(),
  ...overrides,
});

// ============================================================================
// Explanation Data Mock Factories
// ============================================================================

/**
 * Creates a mock explanation for ExplanationsTablePage
 */
export const createMockExplanationForTable = (overrides = {}) => ({
  explanation_id: faker.number.int({ min: 1, max: 1000 }),
  current_title: faker.lorem.sentence(),
  current_content: `# ${faker.lorem.sentence()}\n\n${faker.lorem.paragraphs(2)}`,
  datecreated: faker.date.recent().toISOString(),
  dateSaved: faker.date.recent().toISOString(),
  ...overrides,
});

/**
 * Creates an array of mock explanations for table testing
 */
export const createMockExplanationsArray = (count = 3, overrides = {}) => {
  return Array.from({ length: count }, () => createMockExplanationForTable(overrides));
};

/**
 * Creates mock props for ExplanationsTablePage component
 */
export const createMockExplanationsTablePageProps = (overrides = {}) => ({
  explanations: createMockExplanationsArray(),
  error: null,
  showNavigation: true,
  pageTitle: 'All Explanations',
  ...overrides,
});

// ============================================================================
// Server Action Mocks
// ============================================================================

/**
 * Creates a successful server action response
 */
export const createSuccessResponse = <T>(data: T) => ({
  success: true as const,
  data,
  error: null,
});

/**
 * Creates a failed server action response
 */
export const createErrorResponse = (message = 'An error occurred', code: import('@/lib/errorHandling').ErrorCode = 'UNKNOWN_ERROR') => ({
  success: false as const,
  data: null,
  error: { message, code },
});

/**
 * Mock factory for getAllTagsAction response
 */
export const createMockGetAllTagsResponse = (tags: TagUIType[] = []) =>
  createSuccessResponse(tags);

/**
 * Mock factory for handleApplyForModifyTags response
 */
export const createMockHandleApplyResponse = () =>
  createSuccessResponse({ message: 'Tags applied successfully' });

/**
 * Mock factory for runAISuggestionsPipelineAction response
 */
export const createMockAISuggestionsResponse = (modifiedMarkdown: string) =>
  createSuccessResponse({ modifiedMarkdown });

/**
 * Mock factory for getAllExplanationsForTableAction response
 */
export const createMockGetAllExplanationsResponse = (explanations = createMockExplanationsArray()) =>
  createSuccessResponse(explanations);

// ============================================================================
// Jest Mock Helpers
// ============================================================================

/**
 * Creates a mock dispatch function with typed return value
 */
export const createMockDispatch = () => jest.fn() as jest.MockedFunction<React.Dispatch<any>>;

/**
 * Creates a mock callback function
 */
export const createMockCallback = () => jest.fn();

/**
 * Resets all provided mock functions
 */
export const resetMocks = (...mocks: jest.Mock[]) => {
  mocks.forEach(mock => mock.mockReset());
};

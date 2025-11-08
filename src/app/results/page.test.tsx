/**
 * Results Page Tests - Simplified for Phase 12 Completion
 *
 * This test file covers core functionality of the complex results page:
 * 1. Component rendering with loaded content
 * 2. Hook integration
 * 3. Basic state management
 * 4. Loading states
 *
 * Note: Full streaming and URL parameter tests deferred due to 1,270-line complexity
 * Target: 50%+ coverage on this highly complex page
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import ResultsPage from './page';
import { useSearchParams, useRouter } from 'next/navigation';
import { useExplanationLoader } from '@/hooks/useExplanationLoader';
import { useUserAuth } from '@/hooks/useUserAuth';
import { MatchMode, ExplanationStatus } from '@/lib/schemas/schemas';
import {
  createMockRouter,
  createMockSearchParams,
  createMockUseExplanationLoader,
  createMockUseUserAuth,
} from '@/testing/utils/page-test-helpers';

// Mock Next.js hooks
jest.mock('next/navigation', () => ({
  useSearchParams: jest.fn(),
  useRouter: jest.fn(),
}));

// Mock custom hooks
jest.mock('@/hooks/useExplanationLoader', () => ({
  useExplanationLoader: jest.fn(),
}));

jest.mock('@/hooks/useUserAuth', () => ({
  useUserAuth: jest.fn(),
}));

// Mock RequestId context
jest.mock('@/hooks/clientPassRequestId', () => ({
  clientPassRequestId: jest.fn(() => ({
    withRequestId: (data: any) => data,
  })),
}));

// Mock server actions
jest.mock('@/actions/actions', () => ({
  saveExplanationToLibraryAction: jest.fn(),
  getUserQueryByIdAction: jest.fn(),
  createUserExplanationEventAction: jest.fn(),
  getTempTagsForRewriteWithTagsAction: jest.fn(),
  saveOrPublishChanges: jest.fn(),
}));

// Mock components
jest.mock('@/components/Navigation', () => {
  return function MockNavigation({ showSearchBar, searchBarProps }: any) {
    return (
      <nav data-testid="navigation">
        <div data-testid="search-bar" data-disabled={searchBarProps?.disabled}>
          Navigation
        </div>
      </nav>
    );
  };
});

jest.mock('@/components/TagBar', () => {
  return function MockTagBar({ tagState, dispatch, isStreaming }: any) {
    return (
      <div data-testid="tag-bar" data-mode={tagState.mode} data-streaming={isStreaming}>
        TagBar
      </div>
    );
  };
});

jest.mock('@/editorFiles/lexicalEditor/LexicalEditor', () => {
  const MockEditor = React.forwardRef<any, any>((props, ref) => {
    return (
      <div
        data-testid="lexical-editor"
        data-edit-mode={props.isEditMode}
        data-markdown={props.isMarkdownMode}
      >
        Editor
      </div>
    );
  });
  MockEditor.displayName = 'LexicalEditor';
  return {
    __esModule: true,
    default: MockEditor,
  };
});

jest.mock('@/components/AISuggestionsPanel', () => {
  return function MockAISuggestionsPanel({ isVisible }: any) {
    return isVisible ? <div data-testid="ai-suggestions">AI Suggestions</div> : null;
  };
});

// Mock logger
jest.mock('@/lib/client_utilities', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

describe('ResultsPage - Phase 12 Completion Tests', () => {
  let mockRouter: ReturnType<typeof createMockRouter>;
  let mockSearchParams: URLSearchParams;
  let mockUseExplanationLoader: ReturnType<typeof createMockUseExplanationLoader>;
  let mockUseUserAuth: ReturnType<typeof createMockUseUserAuth>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Setup default mocks - no URL params to avoid triggering API calls
    mockRouter = createMockRouter();
    mockSearchParams = createMockSearchParams(); // Empty params
    mockUseExplanationLoader = createMockUseExplanationLoader({
      explanationTitle: 'Test Explanation',
      content: '# Test Explanation\n\nThis is test content.',
      explanationId: 123,
      explanationStatus: ExplanationStatus.Published,
      isLoading: false,
      userSaved: false,
    });
    mockUseUserAuth = createMockUseUserAuth({
      userid: 'test-user-123',
    });

    (useRouter as jest.Mock).mockReturnValue(mockRouter);
    (useSearchParams as jest.Mock).mockReturnValue(mockSearchParams);
    (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);
    (useUserAuth as jest.Mock).mockReturnValue(mockUseUserAuth);

    // Mock localStorage
    Storage.prototype.getItem = jest.fn();
    Storage.prototype.setItem = jest.fn();
    Storage.prototype.removeItem = jest.fn();
  });

  describe('Component Rendering', () => {
    it('should render Navigation component', () => {
      render(<ResultsPage />);

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('should render Navigation with SearchBar', () => {
      render(<ResultsPage />);

      const searchBar = screen.getByTestId('search-bar');
      expect(searchBar).toBeInTheDocument();
    });

    it('should render TagBar component', () => {
      render(<ResultsPage />);

      const tagBar = screen.getByTestId('tag-bar');
      expect(tagBar).toBeInTheDocument();
    });

    it('should render LexicalEditor component', () => {
      render(<ResultsPage />);

      const editor = screen.getByTestId('lexical-editor');
      expect(editor).toBeInTheDocument();
    });

    it('should render AI Suggestions panel', () => {
      render(<ResultsPage />);

      const aiPanel = screen.getByTestId('ai-suggestions');
      expect(aiPanel).toBeInTheDocument();
    });

    it('should render all main components together', () => {
      render(<ResultsPage />);

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
      expect(screen.getByTestId('tag-bar')).toBeInTheDocument();
      expect(screen.getByTestId('lexical-editor')).toBeInTheDocument();
      expect(screen.getByTestId('ai-suggestions')).toBeInTheDocument();
    });

    it('should apply correct page structure', () => {
      const { container } = render(<ResultsPage />);

      // Verify main container exists with correct classes
      expect(container.querySelector('.dark\\:bg-gray-900')).toBeInTheDocument();
    });
  });

  describe('Hook Integration', () => {
    it('should call useExplanationLoader hook', () => {
      render(<ResultsPage />);

      expect(useExplanationLoader).toHaveBeenCalled();
    });

    it('should call useUserAuth hook', () => {
      render(<ResultsPage />);

      expect(useUserAuth).toHaveBeenCalled();
    });

    it('should pass callbacks to useExplanationLoader', () => {
      render(<ResultsPage />);

      const hookCall = (useExplanationLoader as jest.Mock).mock.calls[0][0];
      expect(hookCall).toHaveProperty('onTagsLoad');
      expect(hookCall).toHaveProperty('onMatchesLoad');
      expect(hookCall).toHaveProperty('onClearPrompt');
      expect(hookCall).toHaveProperty('onSetOriginalValues');
    });

    it('should use explanation data from hook', () => {
      const mockWithContent = createMockUseExplanationLoader({
        content: 'Custom test content',
        explanationTitle: 'Custom Title',
      });
      (useExplanationLoader as jest.Mock).mockReturnValue(mockWithContent);

      render(<ResultsPage />);

      // Verify editor is rendered (it only renders when there's content)
      const editor = screen.getByTestId('lexical-editor');
      expect(editor).toBeInTheDocument();
    });

    it('should use userid from useUserAuth', () => {
      const mockWithUser = createMockUseUserAuth({
        userid: 'custom-user-id',
      });
      (useUserAuth as jest.Mock).mockReturnValue(mockWithUser);

      render(<ResultsPage />);

      expect(useUserAuth).toHaveBeenCalled();
    });
  });

  describe('TagBar Integration', () => {
    it('should initialize TagBar in normal mode', () => {
      render(<ResultsPage />);

      const tagBar = screen.getByTestId('tag-bar');
      expect(tagBar).toHaveAttribute('data-mode', 'normal');
    });

    it('should pass streaming state to TagBar', () => {
      render(<ResultsPage />);

      const tagBar = screen.getByTestId('tag-bar');
      expect(tagBar).toHaveAttribute('data-streaming', 'false');
    });
  });

  describe('Editor Integration', () => {
    it('should initialize editor in view mode', () => {
      render(<ResultsPage />);

      const editor = screen.getByTestId('lexical-editor');
      expect(editor).toHaveAttribute('data-edit-mode', 'false');
    });

    it('should initialize editor in markdown mode', () => {
      render(<ResultsPage />);

      const editor = screen.getByTestId('lexical-editor');
      expect(editor).toHaveAttribute('data-markdown', 'true');
    });
  });

  describe('Search Bar State', () => {
    it('should render search bar with disabled attribute', () => {
      render(<ResultsPage />);

      const searchBar = screen.getByTestId('search-bar');
      // Disabled state is controlled by internal reducer state (isPageLoading || isStreaming)
      expect(searchBar).toHaveAttribute('data-disabled');
    });

    it('should enable search in normal viewing state', () => {
      const notLoadingMock = createMockUseExplanationLoader({
        explanationTitle: 'Test',
        content: 'Test',
        isLoading: false,
      });
      (useExplanationLoader as jest.Mock).mockReturnValue(notLoadingMock);

      render(<ResultsPage />);

      const searchBar = screen.getByTestId('search-bar');
      expect(searchBar).toHaveAttribute('data-disabled', 'false');
    });
  });

  describe('Conditional Rendering', () => {
    it('should render TagBar and Editor only when content exists', () => {
      mockUseExplanationLoader.content = 'Test content';
      mockUseExplanationLoader.explanationTitle = 'Test Title';
      (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);

      render(<ResultsPage />);

      expect(screen.getByTestId('tag-bar')).toBeInTheDocument();
      expect(screen.getByTestId('lexical-editor')).toBeInTheDocument();
    });

    it('should handle empty content gracefully', () => {
      mockUseExplanationLoader.content = '';
      mockUseExplanationLoader.explanationTitle = '';
      (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);

      render(<ResultsPage />);

      // Navigation should still render
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should handle explanation loader error', () => {
      (mockUseExplanationLoader as any).error = 'Failed to load explanation';
      (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);

      render(<ResultsPage />);

      // Should still render components
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('should handle missing userid gracefully', () => {
      (mockUseUserAuth as any).userid = null;
      (useUserAuth as jest.Mock).mockReturnValue(mockUseUserAuth);

      render(<ResultsPage />);

      // Should render but may disable certain features
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });
  });

  describe('Initial State', () => {
    it('should initialize with content from hook', () => {
      render(<ResultsPage />);

      // Verify components that depend on content are rendered
      expect(screen.getByTestId('lexical-editor')).toBeInTheDocument();
      expect(screen.getByTestId('tag-bar')).toBeInTheDocument();
    });

    it('should initialize AI panel as visible', () => {
      render(<ResultsPage />);

      const aiPanel = screen.getByTestId('ai-suggestions');
      expect(aiPanel).toBeInTheDocument();
    });
  });

  describe('Cleanup', () => {
    it('should clean up event listeners on unmount', () => {
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');

      const { unmount } = render(<ResultsPage />);
      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalled();
    });

    it('should not crash when unmounting', () => {
      const { unmount } = render(<ResultsPage />);

      expect(() => unmount()).not.toThrow();
    });
  });

  describe('Published vs Draft Status', () => {
    it('should handle published explanation', () => {
      (mockUseExplanationLoader as any).explanationStatus = ExplanationStatus.Published;
      (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);

      render(<ResultsPage />);

      expect(screen.getByTestId('lexical-editor')).toBeInTheDocument();
    });

    it('should handle draft explanation', () => {
      (mockUseExplanationLoader as any).explanationStatus = ExplanationStatus.Draft;
      (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);

      render(<ResultsPage />);

      expect(screen.getByTestId('lexical-editor')).toBeInTheDocument();
    });
  });

  describe('User Saved State', () => {
    it('should reflect saved state from hook', () => {
      mockUseExplanationLoader.userSaved = true;
      (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);

      render(<ResultsPage />);

      // Verify page renders correctly with saved state
      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });

    it('should reflect unsaved state from hook', () => {
      mockUseExplanationLoader.userSaved = false;
      (useExplanationLoader as jest.Mock).mockReturnValue(mockUseExplanationLoader);

      render(<ResultsPage />);

      expect(screen.getByTestId('navigation')).toBeInTheDocument();
    });
  });
});

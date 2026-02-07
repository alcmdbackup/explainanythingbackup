/**
 * Unit tests for HomeSearchPanel component - form submission and sessionStorage integration.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeSearchPanel from '../HomeSearchPanel';
import { type SourceChipType } from '@/lib/schemas/schemas';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock sessionStorage
const mockSessionStorage: Record<string, string> = {};
const sessionStorageMock = {
  getItem: jest.fn((key: string) => mockSessionStorage[key] || null),
  setItem: jest.fn((key: string, value: string) => {
    mockSessionStorage[key] = value;
  }),
  removeItem: jest.fn((key: string) => {
    delete mockSessionStorage[key];
  }),
  clear: jest.fn(() => {
    Object.keys(mockSessionStorage).forEach(key => delete mockSessionStorage[key]);
  }),
};
Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock child components to simplify testing
jest.mock('../HomeSourcesRow', () => {
  return function MockHomeSourcesRow({ sources, onSourceAdded, onSourceRemoved }: {
    sources: SourceChipType[];
    onSourceAdded: (source: SourceChipType) => void;
    onSourceRemoved: (index: number) => void;
  }) {
    return (
      <div data-testid="mock-sources-row">
        <span>Sources: {sources.length}</span>
        <button
          type="button"
          data-testid="mock-add-source"
          onClick={() => onSourceAdded({
            url: 'https://example.com',
            title: 'Example',
            domain: 'example.com',
            status: 'success',
            favicon_url: null,
            error_message: null,
          })}
        >
          Add Source
        </button>
        {sources.map((_, i) => (
          <button type="button" key={i} data-testid={`mock-remove-source-${i}`} onClick={() => onSourceRemoved(i)}>
            Remove {i}
          </button>
        ))}
      </div>
    );
  };
});

jest.mock('../HomeTagSelector', () => {
  return function MockHomeTagSelector({ state, onChange }: {
    state: { difficulty: string; length: string; simpleTags: string[] };
    onChange: (state: { difficulty: string; length: string; simpleTags: string[] }) => void;
  }) {
    return (
      <div data-testid="mock-tag-selector">
        <span>Difficulty: {state.difficulty}</span>
        <span>Length: {state.length}</span>
        <button
          type="button"
          data-testid="mock-change-difficulty"
          onClick={() => onChange({ ...state, difficulty: 'advanced' })}
        >
          Set Advanced
        </button>
        <button
          type="button"
          data-testid="mock-add-tag"
          onClick={() => onChange({ ...state, simpleTags: [...state.simpleTags, 'science'] })}
        >
          Add Tag
        </button>
      </div>
    );
  };
});

describe('HomeSearchPanel', () => {
  const mockOnSourcesChange = jest.fn();
  const mockOnQueryChange = jest.fn();
  const defaultProps = {
    sources: [] as SourceChipType[],
    onSourcesChange: mockOnSourcesChange,
    query: '',
    onQueryChange: mockOnQueryChange,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    sessionStorageMock.clear();
  });

  describe('Rendering', () => {
    it('should render search input with placeholder', () => {
      render(<HomeSearchPanel {...defaultProps} />);
      expect(screen.getByTestId('home-search-input')).toHaveAttribute(
        'placeholder',
        'What would you like to learn?'
      );
    });

    it('should render search button', () => {
      render(<HomeSearchPanel {...defaultProps} />);
      expect(screen.getByTestId('home-search-submit')).toBeInTheDocument();
    });

    it('should render sources row', () => {
      render(<HomeSearchPanel {...defaultProps} />);
      expect(screen.getByTestId('mock-sources-row')).toBeInTheDocument();
    });

    it('should render tag selector', () => {
      render(<HomeSearchPanel {...defaultProps} />);
      expect(screen.getByTestId('mock-tag-selector')).toBeInTheDocument();
    });

    it('should have correct ARIA attributes', () => {
      render(<HomeSearchPanel {...defaultProps} />);
      const panel = screen.getByRole('tabpanel');
      expect(panel).toHaveAttribute('id', 'search-panel');
      expect(panel).toHaveAttribute('aria-labelledby', 'search-tab');
    });
  });

  describe('Form Submission', () => {
    it('should disable submit button when query is empty', () => {
      render(<HomeSearchPanel {...defaultProps} />);
      expect(screen.getByTestId('home-search-submit')).toBeDisabled();
    });

    it('should enable submit button when query has content', () => {
      render(<HomeSearchPanel {...defaultProps} query="quantum physics" />);
      expect(screen.getByTestId('home-search-submit')).not.toBeDisabled();
    });

    it('should call onQueryChange when typing', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} />);

      await user.type(screen.getByTestId('home-search-input'), 'q');
      expect(mockOnQueryChange).toHaveBeenCalledWith('q');
    });

    it('should navigate to results page on submit', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} query="quantum physics" />);

      await user.click(screen.getByTestId('home-search-submit'));

      expect(mockPush).toHaveBeenCalledWith('/results?q=quantum%20physics');
    });

    it('should submit on Enter key', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} query="quantum physics" />);

      const input = screen.getByTestId('home-search-input');
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

      expect(mockPush).toHaveBeenCalledWith('/results?q=quantum%20physics');
    });

    it('should not submit on Shift+Enter (for newline)', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} query="quantum physics" />);

      const input = screen.getByTestId('home-search-input');
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

      expect(mockPush).not.toHaveBeenCalled();
    });
  });

  describe('SessionStorage - Sources', () => {
    it('should store valid sources in sessionStorage on submit', async () => {
      const user = userEvent.setup();
      const sources: SourceChipType[] = [
        { url: 'https://example.com', title: 'Example', domain: 'example.com', status: 'success', favicon_url: null, error_message: null },
      ];
      render(<HomeSearchPanel {...defaultProps} sources={sources} query="test query" />);

      await user.click(screen.getByTestId('home-search-submit'));

      expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
        'pendingSources',
        JSON.stringify(sources)
      );
    });

    it('should remove pendingSources from sessionStorage when no valid sources', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} sources={[]} query="test query" />);

      await user.click(screen.getByTestId('home-search-submit'));

      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingSources');
    });

    it('should only store successful sources, not loading or failed', async () => {
      const user = userEvent.setup();
      const sources: SourceChipType[] = [
        { url: 'https://success.com', title: 'Success', domain: 'success.com', status: 'success', favicon_url: null, error_message: null },
        { url: 'https://loading.com', title: null, domain: 'loading.com', status: 'loading', favicon_url: null, error_message: null },
        { url: 'https://failed.com', title: null, domain: 'failed.com', status: 'failed', favicon_url: null, error_message: 'Error' },
      ];
      render(<HomeSearchPanel {...defaultProps} sources={sources} query="test query" />);

      await user.click(screen.getByTestId('home-search-submit'));

      const storedSources = JSON.parse(
        sessionStorageMock.setItem.mock.calls.find((c: string[]) => c[0] === 'pendingSources')?.[1] || '[]'
      );
      expect(storedSources).toHaveLength(1);
      expect(storedSources[0].url).toBe('https://success.com');
    });
  });

  describe('SessionStorage - Tags', () => {
    it('should store tags in sessionStorage when non-default values', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} query="test query" />);

      // Change difficulty to non-default
      await user.click(screen.getByTestId('mock-change-difficulty'));

      // Wait for state update to propagate
      await screen.findByText('Difficulty: advanced');

      await user.click(screen.getByTestId('home-search-submit'));

      expect(sessionStorageMock.setItem).toHaveBeenCalledWith(
        'pendingTags',
        expect.stringContaining('difficulty: advanced')
      );
    });

    it('should store simple tags in sessionStorage', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} query="test query" />);

      // Add a simple tag - first verify button is enabled
      expect(screen.getByTestId('home-search-submit')).toBeEnabled();

      await user.click(screen.getByTestId('mock-add-tag'));

      // Wait for state update by finding the submit button enabled
      await screen.findByTestId('home-search-submit');

      await user.click(screen.getByTestId('home-search-submit'));

      const pendingTagsCall = sessionStorageMock.setItem.mock.calls.find(
        (c: string[]) => c[0] === 'pendingTags'
      );
      expect(pendingTagsCall).toBeDefined();
      const storedTags = JSON.parse(pendingTagsCall![1]);
      expect(storedTags).toContain('science');
    });

    it('should remove pendingTags from sessionStorage when all defaults', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} query="test query" />);

      await user.click(screen.getByTestId('home-search-submit'));

      expect(sessionStorageMock.removeItem).toHaveBeenCalledWith('pendingTags');
    });
  });

  describe('Source Management', () => {
    it('should call onSourcesChange when source is added', async () => {
      const user = userEvent.setup();
      render(<HomeSearchPanel {...defaultProps} />);

      await user.click(screen.getByTestId('mock-add-source'));

      expect(mockOnSourcesChange).toHaveBeenCalledWith([
        expect.objectContaining({ url: 'https://example.com' }),
      ]);
    });

    it('should call onSourcesChange when source is removed', async () => {
      const user = userEvent.setup();
      const sources: SourceChipType[] = [
        { url: 'https://example.com', title: 'Example', domain: 'example.com', status: 'success', favicon_url: null, error_message: null },
      ];
      render(<HomeSearchPanel {...defaultProps} sources={sources} />);

      await user.click(screen.getByTestId('mock-remove-source-0'));

      expect(mockOnSourcesChange).toHaveBeenCalledWith([]);
    });
  });
});

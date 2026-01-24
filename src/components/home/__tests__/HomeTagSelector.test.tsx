/**
 * Unit tests for HomeTagSelector component - dropdown chips for difficulty/length presets.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeTagSelector, { type HomeTagState } from '../HomeTagSelector';
import { getAllTagsAction } from '@/actions/actions';

// Mock getAllTagsAction
jest.mock('@/actions/actions', () => ({
  getAllTagsAction: jest.fn(),
}));

const mockGetAllTagsAction = getAllTagsAction as jest.MockedFunction<typeof getAllTagsAction>;

describe('HomeTagSelector', () => {
  const mockOnChange = jest.fn();

  const defaultState: HomeTagState = {
    difficulty: 'intermediate',
    length: 'standard',
    simpleTags: [],
  };

  const defaultProps = {
    state: defaultState,
    onChange: mockOnChange,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllTagsAction.mockResolvedValue({
      success: true,
      data: [
        { id: 1, tag_name: 'science', tag_description: 'Science topics', presetTagId: null, created_at: '2024-01-01T00:00:00Z' },
        { id: 2, tag_name: 'history', tag_description: 'History topics', presetTagId: null, created_at: '2024-01-01T00:00:00Z' },
      ],
      error: null,
    });
  });

  describe('Rendering', () => {
    it('should render Tags label', () => {
      render(<HomeTagSelector {...defaultProps} />);
      expect(screen.getByText('Tags:')).toBeInTheDocument();
    });

    it('should render difficulty dropdown with default value', () => {
      render(<HomeTagSelector {...defaultProps} />);
      expect(screen.getByTestId('home-tag-difficulty')).toHaveTextContent('Intermediate');
    });

    it('should render length dropdown with default value', () => {
      render(<HomeTagSelector {...defaultProps} />);
      expect(screen.getByTestId('home-tag-length')).toHaveTextContent('Standard');
    });

    it('should render Add tag button', () => {
      render(<HomeTagSelector {...defaultProps} />);
      expect(screen.getByTestId('home-add-tag-button')).toBeInTheDocument();
    });

    it('should render simple tag chips when present', () => {
      const stateWithTags: HomeTagState = {
        ...defaultState,
        simpleTags: ['science', 'history'],
      };
      render(<HomeTagSelector {...defaultProps} state={stateWithTags} />);
      expect(screen.getByText('science')).toBeInTheDocument();
      expect(screen.getByText('history')).toBeInTheDocument();
    });
  });

  describe('Difficulty Dropdown', () => {
    it('should open difficulty dropdown when clicked', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-tag-difficulty'));

      expect(screen.getByText('Beginner')).toBeInTheDocument();
      expect(screen.getByText('Advanced')).toBeInTheDocument();
    });

    it('should call onChange with new difficulty when option is selected', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-tag-difficulty'));
      await user.click(screen.getByText('Advanced'));

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultState,
        difficulty: 'advanced',
      });
    });

    it('should close dropdown after selection', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-tag-difficulty'));
      await user.click(screen.getByText('Advanced'));

      // Dropdown should be closed
      await waitFor(() => {
        expect(screen.queryByText('Beginner')).not.toBeInTheDocument();
      });
    });
  });

  describe('Length Dropdown', () => {
    it('should open length dropdown when clicked', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-tag-length'));

      expect(screen.getByText('Brief')).toBeInTheDocument();
      expect(screen.getByText('Detailed')).toBeInTheDocument();
    });

    it('should call onChange with new length when option is selected', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-tag-length'));
      await user.click(screen.getByText('Brief'));

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultState,
        length: 'brief',
      });
    });
  });

  describe('Adding Simple Tags', () => {
    it('should show search input when Add tag is clicked', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-tag-button'));

      expect(screen.getByTestId('home-tag-search-input')).toBeInTheDocument();
    });

    it('should fetch and display available tags', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-tag-button'));

      await waitFor(() => {
        expect(mockGetAllTagsAction).toHaveBeenCalled();
      });

      // Should show available tags
      await waitFor(() => {
        expect(screen.getAllByTestId('home-tag-option')).toHaveLength(2);
      });
    });

    it('should call onChange with new tag when option is selected', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-tag-button'));

      await waitFor(() => {
        expect(screen.getAllByTestId('home-tag-option')).toHaveLength(2);
      });

      await user.click(screen.getByText('science'));

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultState,
        simpleTags: ['science'],
      });
    });

    it('should filter tags based on search input', async () => {
      const user = userEvent.setup();
      render(<HomeTagSelector {...defaultProps} />);

      await user.click(screen.getByTestId('home-add-tag-button'));

      await waitFor(() => {
        expect(screen.getAllByTestId('home-tag-option')).toHaveLength(2);
      });

      await user.type(screen.getByTestId('home-tag-search-input'), 'sci');

      await waitFor(() => {
        expect(screen.getAllByTestId('home-tag-option')).toHaveLength(1);
        expect(screen.getByText('science')).toBeInTheDocument();
      });
    });
  });

  describe('Removing Simple Tags', () => {
    it('should call onChange without removed tag', async () => {
      const user = userEvent.setup();
      const stateWithTags: HomeTagState = {
        ...defaultState,
        simpleTags: ['science', 'history'],
      };
      render(<HomeTagSelector {...defaultProps} state={stateWithTags} />);

      const removeButton = screen.getByRole('button', { name: /remove science/i });
      await user.click(removeButton);

      expect(mockOnChange).toHaveBeenCalledWith({
        ...defaultState,
        simpleTags: ['history'],
      });
    });
  });

  describe('Disabled State', () => {
    it('should disable all controls when disabled prop is true', () => {
      render(<HomeTagSelector {...defaultProps} disabled />);

      expect(screen.getByTestId('home-tag-difficulty')).toBeDisabled();
      expect(screen.getByTestId('home-tag-length')).toBeDisabled();
      expect(screen.getByTestId('home-add-tag-button')).toBeDisabled();
    });
  });
});

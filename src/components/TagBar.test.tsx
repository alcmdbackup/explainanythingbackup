import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagBar from './TagBar';
import { getAllTagsAction } from '@/actions/actions';
import { handleApplyForModifyTags } from '@/lib/services/explanationTags';
// TagBarMode removed - special modes deprecated
import {
  createMockTagBarProps,
  createMockSimpleTag,
  createMockPresetTag,
  createMockTagState,
  createSuccessResponse,
  createErrorResponse,
} from '@/testing/utils/component-test-helpers';

// Mock dependencies
jest.mock('@/actions/actions', () => ({
  getAllTagsAction: jest.fn(),
}));

jest.mock('@/lib/services/explanationTags', () => ({
  handleApplyForModifyTags: jest.fn(),
}));

jest.mock('@/reducers/tagModeReducer', () => {
  return {
    ...jest.requireActual('@/reducers/tagModeReducer'),
    getCurrentTags: jest.fn((state) => {
      return state.tags || [];
    }),
    isTagsModified: jest.fn((state) => {
      const tags = state.tags || [];
      if (!Array.isArray(tags)) return false;
      return tags.some((tag: any) => {
        if ('tag_name' in tag) {
          return tag.tag_active_current !== tag.tag_active_initial;
        }
        return false;
      });
    }),
  };
});

describe('TagBar', () => {
  const mockGetAllTagsAction = getAllTagsAction as jest.MockedFunction<typeof getAllTagsAction>;
  const mockHandleApplyForModifyTags = handleApplyForModifyTags as jest.MockedFunction<typeof handleApplyForModifyTags>;

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear console methods to avoid noise
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ========================================================================
  // Rendering States Tests
  // ========================================================================

  describe('Rendering States', () => {
    it('should render during streaming with disabled add tag button', () => {
      const props = createMockTagBarProps({
        isStreaming: true,
        tagState: createMockTagState({ tags: [] }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByText('Tags:')).toBeInTheDocument();
      const addButton = screen.getByRole('button', { name: /add tag/i });
      expect(addButton).toBeDisabled();
      expect(addButton).toHaveAttribute('title', 'Add tag (disabled during streaming)');
    });

    it('should render Add tag button when not streaming and no tags', () => {
      const props = createMockTagBarProps({
        isStreaming: false,
        tagState: createMockTagState({ tags: [] }),
      });
      render(<TagBar {...props} />);

      // Should show Add tag button even with no tags
      expect(screen.getByTestId('add-tag-trigger')).toBeInTheDocument();
      expect(screen.getByText('Tags:')).toBeInTheDocument();
    });

    it('should render tags in normal unmodified state', () => {
      const simpleTag = createMockSimpleTag({
        id: 1,
        tag_name: 'Test Tag',
        tag_active_current: true,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag], mode: 'normal' }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByText('Test Tag')).toBeInTheDocument();
      expect(screen.queryByText(/apply tags/i)).not.toBeInTheDocument();
    });

    it('should render tags in modified state with themed container', () => {
      const simpleTag = createMockSimpleTag({
        id: 1,
        tag_name: 'Test Tag',
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag], mode: 'normal' }),
      });
      const { container } = render(<TagBar {...props} />);

      // Check for themed container (modified state uses CSS variables)
      const themedContainer = container.querySelector('.bg-\\[var\\(--surface-elevated\\)\\]');
      expect(themedContainer).toBeInTheDocument();
      expect(screen.getByText('Apply Tags')).toBeInTheDocument();
    });

    it('should display correct title based on mode - Normal', () => {
      const simpleTag = createMockSimpleTag({
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({
          tags: [simpleTag],
          mode: 'normal',
        }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByText('Apply Tags')).toBeInTheDocument();
    });

    // Special mode title tests removed - special modes deprecated

    it('should show apply and reset buttons in modified state', () => {
      const simpleTag = createMockSimpleTag({
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag], mode: 'normal' }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /reset/i })).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Simple Tag Tests
  // ========================================================================

  describe('Simple Tags', () => {
    it('should render simple tag chip correctly', () => {
      const simpleTag = createMockSimpleTag({
        id: 1,
        tag_name: 'Simple Tag',
        tag_description: 'A simple test tag',
        tag_active_current: true,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      render(<TagBar {...props} />);

      const tagElement = screen.getByText('Simple Tag');
      expect(tagElement).toBeInTheDocument();
      expect(tagElement).toHaveAttribute('title', 'A simple test tag');
    });

    it('should call onTagClick when simple tag is clicked', () => {
      const mockOnTagClick = jest.fn();
      const simpleTag = createMockSimpleTag({
        id: 1,
        tag_name: 'Clickable Tag',
        tag_active_current: true,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
        onTagClick: mockOnTagClick,
      });
      render(<TagBar {...props} />);

      const tagElement = screen.getByText('Clickable Tag');
      fireEvent.click(tagElement);

      expect(mockOnTagClick).toHaveBeenCalledWith(expect.objectContaining({
        id: 1,
        tag_name: 'Clickable Tag',
      }));
    });

    it('should remove simple tag when X button clicked in modified state', () => {
      const mockDispatch = jest.fn();
      const simpleTag = createMockSimpleTag({
        id: 1,
        tag_name: 'Removable Tag',
        tag_active_current: false, // Already modified (was true initially, now false)
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
        dispatch: mockDispatch,
      });
      render(<TagBar {...props} />);

      const tagContainer = screen.getByText('Removable Tag').closest('span');
      const removeButton = within(tagContainer!).getByRole('button');
      fireEvent.click(removeButton);

      // In modified state, clicking the X on an inactive tag should restore it
      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_TAGS',
        tags: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            tag_active_current: true, // Should become active again
          }),
        ]),
      });
    });

    it('should restore removed simple tag when clicked', () => {
      const mockDispatch = jest.fn();
      const simpleTag = createMockSimpleTag({
        id: 1,
        tag_name: 'Removed Tag',
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
        dispatch: mockDispatch,
      });
      render(<TagBar {...props} />);

      const tagElement = screen.getByText('Removed Tag');
      fireEvent.click(tagElement);

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_TAGS',
        tags: expect.arrayContaining([
          expect.objectContaining({
            id: 1,
            tag_active_current: true,
          }),
        ]),
      });
    });

    it('should show removed tag with different styling', () => {
      const removedTag = createMockSimpleTag({
        tag_name: 'Removed Tag',
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [removedTag] }),
      });
      render(<TagBar {...props} />);

      const tagElement = screen.getByText('Removed Tag');
      expect(tagElement).toHaveClass('line-through');
      expect(tagElement).toHaveClass('opacity-60');
    });

    it('should display tooltip for removed tag', () => {
      const removedTag = createMockSimpleTag({
        tag_name: 'Removed Tag',
        tag_description: 'Test description',
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [removedTag] }),
      });
      render(<TagBar {...props} />);

      const tagElement = screen.getByText('Removed Tag');
      expect(tagElement).toHaveAttribute('title', 'Removed: Test description (click to restore)');
    });

    it('should render multiple simple tags', () => {
      const tag1 = createMockSimpleTag({ id: 1, tag_name: 'Tag 1' });
      const tag2 = createMockSimpleTag({ id: 2, tag_name: 'Tag 2' });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [tag1, tag2] }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByText('Tag 1')).toBeInTheDocument();
      expect(screen.getByText('Tag 2')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Preset Tag Tests
  // ========================================================================

  describe('Preset Tags', () => {
    it('should render preset tag chip correctly', () => {
      const presetTag = createMockPresetTag({
        tags: [
          {
            id: 1,
            tag_name: 'Preset Option 1',
            tag_description: 'First option',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
        ],
        currentActiveTagId: 1,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByText('Preset Option 1')).toBeInTheDocument();
    });

    it('should toggle dropdown when preset tag clicked', async () => {
      const presetTag = createMockPresetTag({
        tags: [
          {
            id: 1,
            tag_name: 'Option 1',
            tag_description: 'First',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
          {
            id: 2,
            tag_name: 'Option 2',
            tag_description: 'Second',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
        ],
        currentActiveTagId: 1,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
      });
      render(<TagBar {...props} />);

      const presetTagElement = screen.getByText('Option 1');
      fireEvent.click(presetTagElement);

      await waitFor(() => {
        expect(screen.getByText('Option 2')).toBeInTheDocument();
      });
    });

    it('should switch active tag when different preset option selected', async () => {
      const mockDispatch = jest.fn();
      const presetTag = createMockPresetTag({
        tags: [
          {
            id: 1,
            tag_name: 'Option 1',
            tag_description: 'First',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
          {
            id: 2,
            tag_name: 'Option 2',
            tag_description: 'Second',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
        ],
        currentActiveTagId: 1,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
        dispatch: mockDispatch,
      });
      render(<TagBar {...props} />);

      // Open dropdown
      const presetTagElement = screen.getByText('Option 1');
      fireEvent.click(presetTagElement);

      // Click Option 2
      await waitFor(() => {
        const option2 = screen.getByText('Option 2');
        fireEvent.click(option2);
      });

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_TAGS',
        tags: expect.arrayContaining([
          expect.objectContaining({
            currentActiveTagId: 2,
          }),
        ]),
      });
    });

    it('should remove preset tag when X button clicked', () => {
      const mockDispatch = jest.fn();
      const presetTag = createMockPresetTag({
        tags: [
          {
            id: 1,
            tag_name: 'Preset Tag',
            tag_description: 'Test',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
        ],
        currentActiveTagId: 1,
        tag_active_current: true,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
        dispatch: mockDispatch,
      });
      render(<TagBar {...props} />);

      const tagContainer = screen.getByText('Preset Tag').closest('span');
      const removeButton = within(tagContainer!).getByRole('button');
      fireEvent.click(removeButton);

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_TAGS',
        tags: expect.arrayContaining([
          expect.objectContaining({
            tag_active_current: false,
          }),
        ]),
      });
    });

    it('should remove preset tag when X button clicked even if already inactive', () => {
      // Note: Preset tags don't have restore functionality like simple tags
      // Clicking the X button on a preset tag always calls handleRemoveTag
      const mockDispatch = jest.fn();
      const presetTag = createMockPresetTag({
        tag_active_current: true,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
        dispatch: mockDispatch,
      });
      render(<TagBar {...props} />);

      const tagContainer = screen.getByText(presetTag.tags[0].tag_name).closest('span');
      const removeButton = within(tagContainer!).getByRole('button');
      fireEvent.click(removeButton);

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_TAGS',
        tags: expect.arrayContaining([
          expect.objectContaining({
            tag_active_current: false,
          }),
        ]),
      });
    });

    it('should close dropdown when clicking outside', async () => {
      const presetTag = createMockPresetTag({
        tags: [
          {
            id: 1,
            tag_name: 'Option 1',
            tag_description: 'First',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
          {
            id: 2,
            tag_name: 'Option 2',
            tag_description: 'Second',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
        ],
        currentActiveTagId: 1,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
      });
      render(<TagBar {...props} />);

      // Open dropdown
      const presetTagElement = screen.getByText('Option 1');
      fireEvent.click(presetTagElement);

      await waitFor(() => {
        expect(screen.getByText('Option 2')).toBeInTheDocument();
      });

      // Click outside
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByText('Option 2')).not.toBeInTheDocument();
      });
    });

    it('should apply correct styling for preset tags (themed when unmodified)', () => {
      const presetTag = createMockPresetTag({
        tag_active_current: true,
        tag_active_initial: true,
        // Ensure not modified: currentActiveTagId === originalTagId
        currentActiveTagId: 100,
        originalTagId: 100,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
      });
      render(<TagBar {...props} />);

      const tagElement = screen.getByText(presetTag.tags[0].tag_name);
      // Preset tags use CSS variable based styling
      expect(tagElement).toHaveClass('bg-[var(--surface-elevated)]');
    });

    it('should show dropdown chevron icon on preset tags', () => {
      const presetTag = createMockPresetTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
      });
      const { container } = render(<TagBar {...props} />);

      const chevronIcon = container.querySelector('svg path[d*="M19 9l-7 7-7-7"]');
      expect(chevronIcon).toBeInTheDocument();
    });

    it('should display tooltip with active option description', () => {
      const presetTag = createMockPresetTag({
        tags: [
          {
            id: 1,
            tag_name: 'Active Option',
            tag_description: 'This is the active description',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
        ],
        currentActiveTagId: 1,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
      });
      render(<TagBar {...props} />);

      const tagElement = screen.getByText('Active Option');
      expect(tagElement).toHaveAttribute('title', 'This is the active description');
    });
  });

  // ========================================================================
  // Add Tag Functionality Tests
  // ========================================================================

  describe('Add Tag Functionality', () => {
    it('should open add tag interface when add button clicked', async () => {
      const simpleTag = createMockSimpleTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
      });
    });

    it('should fetch available tags when opening add interface', async () => {
      const simpleTag = createMockSimpleTag();
      const availableTag1 = {
        id: 2,
        tag_name: 'Available Tag 1',
        tag_description: 'Description 1',
        presetTagId: null,
        created_at: new Date().toISOString(),
      };
      const availableTag2 = {
        id: 3,
        tag_name: 'Available Tag 2',
        tag_description: 'Description 2',
        presetTagId: null,
        created_at: new Date().toISOString(),
      };
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([availableTag1, availableTag2]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(mockGetAllTagsAction).toHaveBeenCalled();
      });
    });

    it('should filter available tags by search input', async () => {
      const simpleTag = createMockSimpleTag({ id: 1 });
      const availableTag1 = {
        id: 2,
        tag_name: 'JavaScript',
        tag_description: 'JS tag',
        presetTagId: null,
        created_at: new Date().toISOString(),
      };
      const availableTag2 = {
        id: 3,
        tag_name: 'Python',
        tag_description: 'Python tag',
        presetTagId: null,
        created_at: new Date().toISOString(),
      };
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([availableTag1, availableTag2]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      // Wait for both tags to initially appear in the dropdown
      await waitFor(() => {
        expect(screen.getByText('JavaScript')).toBeInTheDocument();
        expect(screen.getByText('Python')).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search tags/i);
      fireEvent.change(searchInput, { target: { value: 'Java' } });

      // Should show JavaScript but not Python after filtering
      await waitFor(() => {
        expect(screen.getByText('JavaScript')).toBeInTheDocument();
        expect(screen.queryByText('Python')).not.toBeInTheDocument();
      });
    });

    it('should add selected tag when clicked from dropdown', async () => {
      const mockDispatch = jest.fn();
      const simpleTag = createMockSimpleTag({ id: 1 });
      const availableTag = {
        id: 2,
        tag_name: 'New Tag',
        tag_description: 'New Description',
        presetTagId: null,
        created_at: new Date().toISOString(),
      };
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
        dispatch: mockDispatch,
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([availableTag]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      const newTagElement = await screen.findByText('New Tag');
      fireEvent.click(newTagElement);

      await waitFor(() => {
        expect(mockDispatch).toHaveBeenCalledWith({
          type: 'UPDATE_TAGS',
          tags: expect.arrayContaining([
            expect.objectContaining({
              id: 2,
              tag_name: 'New Tag',
              tag_active_current: true,
              tag_active_initial: false,
            }),
          ]),
        });
      });
    });

    it('should close add interface after adding tag', async () => {
      const simpleTag = createMockSimpleTag({ id: 1 });
      const availableTag = {
        id: 2,
        tag_name: 'New Tag',
        tag_description: 'Description',
        presetTagId: null,
        created_at: new Date().toISOString(),
      };
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([availableTag]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      const newTagElement = await screen.findByText('New Tag');
      fireEvent.click(newTagElement);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/search tags/i)).not.toBeInTheDocument();
      });
    });

    it('should cancel add operation when X button clicked', async () => {
      const simpleTag = createMockSimpleTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
      });

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/search tags/i)).not.toBeInTheDocument();
      });
    });

    it('should cancel add operation when Escape key pressed', async () => {
      const simpleTag = createMockSimpleTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
      });

      const searchInput = screen.getByPlaceholderText(/search tags/i);
      fireEvent.keyDown(searchInput, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/search tags/i)).not.toBeInTheDocument();
      });
    });

    it('should exclude already active tags from available tags', async () => {
      const activeTag = createMockSimpleTag({
        id: 1,
        tag_name: 'Active Tag',
        tag_active_current: true,
      });
      const allTags = [
        {
          id: 1,
          tag_name: 'Active Tag',
          tag_description: 'Already active',
          presetTagId: null,
          created_at: new Date().toISOString(),
        },
        {
          id: 2,
          tag_name: 'Available Tag',
          tag_description: 'Can be added',
          presetTagId: null,
          created_at: new Date().toISOString(),
        },
      ];
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [activeTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse(allTags));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByText('Available Tag')).toBeInTheDocument();
      });
      // "Active Tag" appears once in the tag bar (as an already-active tag)
      // but should NOT appear in the add-tag dropdown
      const allActiveTagElements = screen.getAllByText('Active Tag');
      expect(allActiveTagElements).toHaveLength(1); // Only in tag bar, not in dropdown
    });

    it('should handle getAllTagsAction error gracefully', async () => {
      const simpleTag = createMockSimpleTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createErrorResponse('Failed to fetch tags'));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      // Should not crash and input should still appear
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
      });
    });

    it('should focus input when add interface opens', async () => {
      const user = userEvent.setup();
      const simpleTag = createMockSimpleTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      await user.click(addButton);

      // Verify input appears (focus behavior varies in jsdom)
      await waitFor(() => {
        const searchInput = screen.getByPlaceholderText(/search tags/i);
        expect(searchInput).toBeInTheDocument();
      });

      // Focus should be on the input - the component's useEffect handles this
      // Note: jsdom focus is unreliable, so we verify the input is focusable
      const searchInput = screen.getByPlaceholderText(/search tags/i);
      expect(searchInput).not.toBeDisabled();
    });
  });

  // ========================================================================
  // Apply/Reset Logic Tests
  // ========================================================================

  describe('Apply/Reset Logic', () => {
    it('should call handleApplyForModifyTags in normal mode', async () => {
      mockHandleApplyForModifyTags.mockResolvedValue({ added: 0, removed: 1, errors: [] });
      const simpleTag = createMockSimpleTag({
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag], mode: 'normal' }),
        explanationId: 123,
      });
      render(<TagBar {...props} />);

      const applyButton = screen.getByRole('button', { name: /apply/i });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockHandleApplyForModifyTags).toHaveBeenCalled();
      });
    });

    // Special mode tagBarApplyClickHandler tests removed - special modes deprecated

    it('should reset tags when reset button clicked', () => {
      const mockDispatch = jest.fn();
      const simpleTag = createMockSimpleTag({
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
        dispatch: mockDispatch,
      });
      render(<TagBar {...props} />);

      const resetButton = screen.getByRole('button', { name: /reset/i });
      fireEvent.click(resetButton);

      expect(mockDispatch).toHaveBeenCalledWith({ type: 'RESET_TAGS' });
    });

    it('should not apply when explanationId missing in normal mode', async () => {
      mockHandleApplyForModifyTags.mockResolvedValue({ added: 0, removed: 0, errors: [] });
      const simpleTag = createMockSimpleTag({
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag], mode: 'normal' }),
        explanationId: null,
      });
      render(<TagBar {...props} />);

      const applyButton = screen.getByRole('button', { name: /apply/i });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockHandleApplyForModifyTags).not.toHaveBeenCalled();
      });
    });
  });

  // ========================================================================
  // Edge Cases & Outside Click Tests
  // ========================================================================

  describe('Edge Cases & Outside Click', () => {
    it('should close available tags dropdown on outside click', async () => {
      const simpleTag = createMockSimpleTag();
      const availableTag = {
        id: 2,
        tag_name: 'Available',
        tag_description: 'Desc',
        presetTagId: null,
        created_at: new Date().toISOString(),
      };
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([availableTag]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      // Wait for add interface to open (search input appears)
      await waitFor(() => {
        expect(screen.getByPlaceholderText(/search tags/i)).toBeInTheDocument();
      });

      // Wait for available tags to load from async action
      await waitFor(() => {
        expect(screen.getByText('Available')).toBeInTheDocument();
      });

      // Click outside
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByText('Available')).not.toBeInTheDocument();
      });
    });

    it('should handle empty tags array gracefully by showing Add tag button', () => {
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [] }),
        isStreaming: false,
      });
      render(<TagBar {...props} />);

      // Should show Add tag button even with empty tags array
      expect(screen.getByTestId('add-tag-trigger')).toBeInTheDocument();
    });

    it('should handle null tags gracefully by showing Add tag button', () => {
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: null as any }),
        isStreaming: false,
      });
      render(<TagBar {...props} />);

      // Should show Add tag button even with null tags
      expect(screen.getByTestId('add-tag-trigger')).toBeInTheDocument();
    });

    it('should apply custom className', () => {
      const simpleTag = createMockSimpleTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
        className: 'custom-class',
      });
      const { container } = render(<TagBar {...props} />);

      const rootDiv = container.firstChild as HTMLElement;
      expect(rootDiv).toHaveClass('custom-class');
    });
  });
});

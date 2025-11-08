import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagBar from './TagBar';
import { getAllTagsAction } from '@/actions/actions';
import { handleApplyForModifyTags } from '@/lib/services/explanationTags';
import { TagBarMode } from '@/lib/schemas/schemas';
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

jest.mock('@/reducers/tagModeReducer', () => ({
  ...jest.requireActual('@/reducers/tagModeReducer'),
  getCurrentTags: jest.fn((state) => state.tags),
  getTagBarMode: jest.fn((state) => state.mode),
  isTagsModified: jest.fn((state) => {
    // Simple modification check logic
    if (!state.tags || !Array.isArray(state.tags)) {
      return false;
    }
    return state.tags.some((tag: any) => {
      if ('tag_name' in tag) {
        return tag.tag_active_current !== tag.tag_active_initial;
      }
      return false;
    });
  }),
}));

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
      expect(addButton).toHaveAttribute('title', 'Add new tag (disabled during streaming)');
    });

    it('should render empty (null) when not streaming and no tags', () => {
      const props = createMockTagBarProps({
        isStreaming: false,
        tagState: createMockTagState({ tags: [] }),
      });
      const { container } = render(<TagBar {...props} />);

      expect(container.firstChild).toBeNull();
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

    it('should render tags in modified state with dark container', () => {
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

      // Check for dark background container (modified state)
      const darkContainer = container.querySelector('.bg-gray-800');
      expect(darkContainer).toBeInTheDocument();
      expect(screen.getByText('Apply tags')).toBeInTheDocument();
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

      expect(screen.getByText('Apply tags')).toBeInTheDocument();
    });

    it('should display correct title based on mode - RewriteWithTags', () => {
      const simpleTag = createMockSimpleTag({
        tag_active_current: true,
        tag_active_initial: false, // Modified: was not initially active
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({
          tags: [simpleTag],
          mode: 'rewriteWithTags', // Use exact enum value with spaces
        }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByText('Rewrite with tags')).toBeInTheDocument();
    });

    it('should display correct title based on mode - EditWithTags', () => {
      const simpleTag = createMockSimpleTag({
        tag_active_current: true,
        tag_active_initial: false,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({
          tags: [simpleTag],
          mode: 'editWithTags',
        }),
      });
      render(<TagBar {...props} />);

      expect(screen.getByText('Edit with tags')).toBeInTheDocument();
    });

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
      expect(tagElement).toHaveClass('opacity-75');
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
        tag_active_current: false,
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

    it('should restore removed preset tag when restore button clicked', () => {
      const mockDispatch = jest.fn();
      const presetTag = createMockPresetTag({
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag] }),
        dispatch: mockDispatch,
      });
      render(<TagBar {...props} />);

      const tagContainer = screen.getByText(presetTag.tags[0].tag_name).closest('span');
      const restoreButton = within(tagContainer!).getByRole('button');
      fireEvent.click(restoreButton);

      expect(mockDispatch).toHaveBeenCalledWith({
        type: 'UPDATE_TAGS',
        tags: expect.arrayContaining([
          expect.objectContaining({
            tag_active_current: true,
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

    it('should apply correct styling for preset tags (purple when unmodified)', () => {
      const presetTag = createMockPresetTag({
        tag_active_current: false,
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
      // Preset tags use purple colors when not modified
      expect(tagElement).toHaveClass('bg-purple-100');
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
        expect(screen.getByPlaceholderText(/enter tag name/i)).toBeInTheDocument();
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

      const searchInput = await screen.findByPlaceholderText(/enter tag name/i);
      await userEvent.type(searchInput, 'Java');

      // Should show JavaScript but not Python
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
        expect(screen.queryByPlaceholderText(/enter tag name/i)).not.toBeInTheDocument();
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

      const searchInput = await screen.findByPlaceholderText(/enter tag name/i);
      expect(searchInput).toBeInTheDocument();

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/enter tag name/i)).not.toBeInTheDocument();
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

      const searchInput = await screen.findByPlaceholderText(/enter tag name/i);
      fireEvent.keyDown(searchInput, { key: 'Escape' });

      await waitFor(() => {
        expect(screen.queryByPlaceholderText(/enter tag name/i)).not.toBeInTheDocument();
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
      expect(screen.queryByText('Active Tag')).not.toBeInTheDocument();
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
        expect(screen.getByPlaceholderText(/enter tag name/i)).toBeInTheDocument();
      });
    });

    it('should focus input when add interface opens', async () => {
      const simpleTag = createMockSimpleTag();
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag] }),
      });
      mockGetAllTagsAction.mockResolvedValue(createSuccessResponse([]));

      render(<TagBar {...props} />);

      const addButton = screen.getByRole('button', { name: /add tag/i });
      fireEvent.click(addButton);

      const searchInput = await screen.findByPlaceholderText(/enter tag name/i);
      expect(searchInput).toHaveFocus();
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

    it('should call tagBarApplyClickHandler with descriptions in rewrite mode', async () => {
      const mockTagBarApplyClickHandler = jest.fn();
      const simpleTag = createMockSimpleTag({
        tag_name: 'Test Tag',
        tag_description: 'Test Description',
        tag_active_current: true,
        tag_active_initial: false,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag], mode: 'rewriteWithTags' }),
        tagBarApplyClickHandler: mockTagBarApplyClickHandler,
      });
      render(<TagBar {...props} />);

      const applyButton = screen.getByRole('button', { name: /apply/i });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockTagBarApplyClickHandler).toHaveBeenCalledWith(['Test Description']);
      });
    });

    it('should call tagBarApplyClickHandler with descriptions in edit mode', async () => {
      const mockTagBarApplyClickHandler = jest.fn();
      const simpleTag = createMockSimpleTag({
        tag_name: 'Edit Tag',
        tag_description: 'Edit Description',
        tag_active_current: true,
        tag_active_initial: false,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [simpleTag], mode: 'editWithTags' }),
        tagBarApplyClickHandler: mockTagBarApplyClickHandler,
      });
      render(<TagBar {...props} />);

      const applyButton = screen.getByRole('button', { name: /apply/i });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockTagBarApplyClickHandler).toHaveBeenCalledWith(['Edit Description']);
      });
    });

    it('should extract only active tag descriptions for apply', async () => {
      const mockTagBarApplyClickHandler = jest.fn();
      const activeTag = createMockSimpleTag({
        tag_description: 'Active Description',
        tag_active_current: true,
        tag_active_initial: false,
      });
      const inactiveTag = createMockSimpleTag({
        tag_description: 'Inactive Description',
        tag_active_current: false,
        tag_active_initial: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [activeTag, inactiveTag], mode: 'rewriteWithTags' }),
        tagBarApplyClickHandler: mockTagBarApplyClickHandler,
      });
      render(<TagBar {...props} />);

      const applyButton = screen.getByRole('button', { name: /apply/i });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockTagBarApplyClickHandler).toHaveBeenCalledWith(['Active Description']);
      });
    });

    it('should extract descriptions from active preset tags', async () => {
      const mockTagBarApplyClickHandler = jest.fn();
      const presetTag = createMockPresetTag({
        tags: [
          {
            id: 1,
            tag_name: 'Option 1',
            tag_description: 'Option 1 Description',
            presetTagId: 100,
            created_at: new Date().toISOString(),
          },
        ],
        currentActiveTagId: 1,
        tag_active_current: true,
      });
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [presetTag], mode: 'rewriteWithTags' }),
        tagBarApplyClickHandler: mockTagBarApplyClickHandler,
      });
      render(<TagBar {...props} />);

      const applyButton = screen.getByRole('button', { name: /apply/i });
      fireEvent.click(applyButton);

      await waitFor(() => {
        expect(mockTagBarApplyClickHandler).toHaveBeenCalledWith(['Option 1 Description']);
      });
    });

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

      await screen.findByText('Available');

      // Click outside
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByText('Available')).not.toBeInTheDocument();
      });
    });

    it('should handle empty tags array gracefully', () => {
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: [] }),
        isStreaming: false,
      });
      const { container } = render(<TagBar {...props} />);

      expect(container.firstChild).toBeNull();
    });

    it('should handle null tags gracefully', () => {
      const props = createMockTagBarProps({
        tagState: createMockTagState({ tags: null as any }),
        isStreaming: false,
      });
      const { container } = render(<TagBar {...props} />);

      expect(container.firstChild).toBeNull();
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

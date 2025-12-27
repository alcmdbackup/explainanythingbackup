import {
  tagModeReducer,
  createInitialTagModeState,
  isTagsModified,
  getCurrentTags,
  getTagBarMode,
  type TagModeState,
  type TagModeAction,
} from './tagModeReducer';
import { TagUIType, TagBarMode, SimpleTagUIType, PresetTagUIType } from '@/lib/schemas/schemas';

describe('tagModeReducer', () => {
  // ========================================================================
  // Test Data Factories
  // ========================================================================

  const createSimpleTag = (
    id: number,
    name: string,
    activeCurrent: boolean = true,
    activeInitial: boolean = true
  ): SimpleTagUIType => ({
    id,
    tag_name: name,
    tag_description: `Description for ${name}`,
    presetTagId: null,
    created_at: '2024-01-01T00:00:00Z',
    tag_active_current: activeCurrent,
    tag_active_initial: activeInitial,
  });

  const createPresetTag = (
    tagIds: number[],
    currentActiveId: number,
    originalId: number,
    activeCurrent: boolean = true,
    activeInitial: boolean = true
  ): PresetTagUIType => ({
    tags: tagIds.map(id => ({
      id,
      tag_name: `Tag ${id}`,
      tag_description: `Description for tag ${id}`,
      presetTagId: 1,
      created_at: '2024-01-01T00:00:00Z',
    })),
    tag_active_current: activeCurrent,
    tag_active_initial: activeInitial,
    currentActiveTagId: currentActiveId,
    originalTagId: originalId,
  });

  // ========================================================================
  // Initial State Tests
  // ========================================================================

  describe('createInitialTagModeState', () => {
    it('should create initial state in normal mode with empty tags', () => {
      const state = createInitialTagModeState();

      expect(state.mode).toBe('normal');
      expect(getCurrentTags(state)).toEqual([]);
      if (state.mode === 'normal') {
        expect(state.originalTags).toEqual([]);
        expect(state.showRegenerateDropdown).toBe(false);
      }
    });
  });

  // ========================================================================
  // LOAD_TAGS Action Tests
  // ========================================================================

  describe('LOAD_TAGS action', () => {
    it('should load tags and set them as original tags', () => {
      const initialState = createInitialTagModeState();
      const tags: TagUIType[] = [
        createSimpleTag(1, 'beginner'),
        createSimpleTag(2, 'intermediate'),
      ];

      const action: TagModeAction = { type: 'LOAD_TAGS', tags };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(tags);
      if (newState.mode === 'normal') {
        expect(newState.originalTags).toEqual(tags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });

    it('should replace existing tags when loading new tags', () => {
      const existingTags = [createSimpleTag(1, 'old')];
      const initialState: TagModeState = {
        mode: 'normal',
        tags: existingTags,
        originalTags: existingTags,
        showRegenerateDropdown: true,
      };

      const newTags = [createSimpleTag(2, 'new')];
      const action: TagModeAction = { type: 'LOAD_TAGS', tags: newTags };
      const newState = tagModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(newTags);
      if (newState.mode === 'normal') {
        expect(newState.originalTags).toEqual(newTags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });
  });

  // ========================================================================
  // ENTER_REWRITE_MODE Action Tests
  // ========================================================================

  describe('ENTER_REWRITE_MODE action', () => {
    it('should enter rewrite mode with temp tags', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'normal',
        tags: originalTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const tempTags = [createSimpleTag(2, 'normal'), createSimpleTag(5, 'medium')];
      const action: TagModeAction = { type: 'ENTER_REWRITE_MODE', tempTags };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('rewriteWithTags');
      expect(getCurrentTags(newState)).toEqual(tempTags);
      if (newState.mode === 'rewriteWithTags') {
        expect(newState.originalTags).toEqual(originalTags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });

    it('should preserve originalTags when entering from normal mode', () => {
      const originalTags = [createSimpleTag(1, 'preserved')];
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'preserved', false)], // Modified version
        originalTags,
        showRegenerateDropdown: false,
      };

      const tempTags = [createSimpleTag(2, 'temp')];
      const action: TagModeAction = { type: 'ENTER_REWRITE_MODE', tempTags };
      const newState = tagModeReducer(initialState, action);

      if (newState.mode === 'rewriteWithTags') {
        expect(newState.originalTags).toEqual(originalTags);
      }
    });
  });

  // ========================================================================
  // ENTER_EDIT_MODE Action Tests
  // ========================================================================

  describe('ENTER_EDIT_MODE action', () => {
    it('should enter edit mode and restore original tags', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const modifiedTags = [createSimpleTag(1, 'original', false, true)]; // Modified
      const initialState: TagModeState = {
        mode: 'normal',
        tags: modifiedTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'ENTER_EDIT_MODE' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('editWithTags');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      if (newState.mode === 'editWithTags') {
        expect(newState.originalTags).toEqual(originalTags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });

    it('should not change state if not in normal mode', () => {
      const tempTags = [createSimpleTag(2, 'temp')];
      const initialState: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags,
        originalTags: [],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'ENTER_EDIT_MODE' };
      const newState = tagModeReducer(initialState, action);

      expect(newState).toEqual(initialState);
    });
  });

  // ========================================================================
  // EXIT_TO_NORMAL Action Tests
  // ========================================================================

  describe('EXIT_TO_NORMAL action', () => {
    it('should exit from rewrite mode to normal mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'EXIT_TO_NORMAL' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      expect(newState.originalTags).toEqual(originalTags);
      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should exit from edit mode to normal mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'editWithTags',
        tags: [createSimpleTag(1, 'original', false)],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'EXIT_TO_NORMAL' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should close dropdown when already in normal mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const initialState: TagModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: true,
      };

      const action: TagModeAction = { type: 'EXIT_TO_NORMAL' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(newState.showRegenerateDropdown).toBe(false);
    });
  });

  // ========================================================================
  // TOGGLE_DROPDOWN Action Tests
  // ========================================================================

  describe('TOGGLE_DROPDOWN action', () => {
    it('should toggle dropdown from false to true in normal mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const initialState: TagModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(true);
    });

    it('should toggle dropdown from true to false in normal mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const initialState: TagModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: true,
      };

      const action: TagModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should not toggle dropdown in rewrite mode', () => {
      const initialState: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = tagModeReducer(initialState, action);

      expect(newState).toEqual(initialState);
    });

    it('should not toggle dropdown in edit mode', () => {
      const initialState: TagModeState = {
        mode: 'editWithTags',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = tagModeReducer(initialState, action);

      expect(newState).toEqual(initialState);
    });
  });

  // ========================================================================
  // UPDATE_TAGS Action Tests
  // ========================================================================

  describe('UPDATE_TAGS action', () => {
    it('should update tags in normal mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'normal',
        tags: originalTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const updatedTags = [createSimpleTag(1, 'original', false, true)];
      const action: TagModeAction = { type: 'UPDATE_TAGS', tags: updatedTags };
      const newState = tagModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(updatedTags);
      expect(newState.originalTags).toEqual(originalTags); // Should not change
    });

    it('should update tempTags in rewrite mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const tempTags = [createSimpleTag(2, 'temp')];
      const initialState: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const updatedTags = [createSimpleTag(2, 'temp', false)];
      const action: TagModeAction = { type: 'UPDATE_TAGS', tags: updatedTags };
      const newState = tagModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(updatedTags);
      expect(newState.originalTags).toEqual(originalTags); // Should not change
    });

    it('should update tags in edit mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'editWithTags',
        tags: originalTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const updatedTags = [createSimpleTag(1, 'original', false)];
      const action: TagModeAction = { type: 'UPDATE_TAGS', tags: updatedTags };
      const newState = tagModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(updatedTags);
      expect(newState.originalTags).toEqual(originalTags); // Should not change
    });
  });

  // ========================================================================
  // RESET_TAGS Action Tests
  // ========================================================================

  describe('RESET_TAGS action', () => {
    it('should reset simple tags in normal mode', () => {
      const originalTag = createSimpleTag(1, 'tag', true, true);
      const modifiedTag = createSimpleTag(1, 'tag', false, true);
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [originalTag],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'RESET_TAGS' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      const tags = getCurrentTags(newState);
      expect(tags[0].tag_active_current).toBe(true);
    });

    it('should reset preset tags in normal mode', () => {
      const originalTag = createPresetTag([1, 2, 3], 1, 1);
      const modifiedTag = createPresetTag([1, 2, 3], 2, 1); // Modified to tag 2
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [originalTag],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'RESET_TAGS' };
      const newState = tagModeReducer(initialState, action);

      const tags = getCurrentTags(newState);
      const resetTag = tags[0] as PresetTagUIType;
      expect(resetTag.currentActiveTagId).toBe(1); // Reset to original
    });

    it('should return to normal mode from rewrite mode on reset', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'RESET_TAGS' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
    });

    it('should reset tags in edit mode and return to normal', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const modifiedTags = [createSimpleTag(1, 'original', false)];
      const initialState: TagModeState = {
        mode: 'editWithTags',
        tags: modifiedTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'RESET_TAGS' };
      const newState = tagModeReducer(initialState, action);

      // Implementation exits to normal mode on reset
      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
    });
  });

  // ========================================================================
  // APPLY_TAGS Action Tests
  // ========================================================================

  describe('APPLY_TAGS action', () => {
    it('should update originalTags to match current tags in normal mode', () => {
      const modifiedTag = createSimpleTag(1, 'tag', false, true);
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [createSimpleTag(1, 'tag', true, true)],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'APPLY_TAGS' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      const tags = getCurrentTags(newState);
      expect(tags[0].tag_active_initial).toBe(false);
      if (newState.mode === 'normal') {
        expect(newState.originalTags[0].tag_active_initial).toBe(false);
      }
    });

    it('should update preset tags originalTagId in normal mode', () => {
      const modifiedTag = createPresetTag([1, 2, 3], 2, 1);
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [createPresetTag([1, 2, 3], 1, 1)],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'APPLY_TAGS' };
      const newState = tagModeReducer(initialState, action);

      const tags = getCurrentTags(newState);
      const appliedTag = tags[0] as PresetTagUIType;
      expect(appliedTag.originalTagId).toBe(2);
    });

    it('should return to normal mode from rewrite mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'APPLY_TAGS' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should return to normal mode from edit mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: TagModeState = {
        mode: 'editWithTags',
        tags: [createSimpleTag(1, 'original', false)],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'APPLY_TAGS' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
    });
  });

  // ========================================================================
  // Helper Function Tests
  // ========================================================================

  describe('isTagsModified', () => {
    it('should return false for unmodified simple tags in normal mode', () => {
      const tags = [createSimpleTag(1, 'tag', true, true)];
      const state: TagModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(false);
    });

    it('should return true for modified simple tags in normal mode', () => {
      const state: TagModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'tag', false, true)],
        originalTags: [createSimpleTag(1, 'tag', true, true)],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });

    it('should return true for modified preset tags in normal mode', () => {
      const state: TagModeState = {
        mode: 'normal',
        tags: [createPresetTag([1, 2, 3], 2, 1)], // Current != Original
        originalTags: [createPresetTag([1, 2, 3], 1, 1)],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });

    it('should return true in rewrite mode', () => {
      const state: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags: [createSimpleTag(1, 'original')],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });

    it('should return true in edit mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const state: TagModeState = {
        mode: 'editWithTags',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });
  });

  describe('getCurrentTags', () => {
    it('should return tags in normal mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const state: TagModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(getCurrentTags(state)).toEqual(tags);
    });

    it('should return tempTags in rewrite mode', () => {
      const tempTags = [createSimpleTag(2, 'temp')];
      const state: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags,
        originalTags: [createSimpleTag(1, 'original')],
        showRegenerateDropdown: false,
      };

      expect(getCurrentTags(state)).toEqual(tempTags);
    });

    it('should return tags in edit mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const state: TagModeState = {
        mode: 'editWithTags',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(getCurrentTags(state)).toEqual(tags);
    });
  });

  describe('getTagBarMode', () => {
    it('should return TagBarMode.Normal for normal mode', () => {
      const state: TagModeState = {
        mode: 'normal',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      expect(getTagBarMode(state)).toBe(TagBarMode.Normal);
    });

    it('should return TagBarMode.RewriteWithTags for rewrite mode', () => {
      const state: TagModeState = {
        mode: 'rewriteWithTags',
        tempTags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      expect(getTagBarMode(state)).toBe(TagBarMode.RewriteWithTags);
    });

    it('should return TagBarMode.EditWithTags for edit mode', () => {
      const state: TagModeState = {
        mode: 'editWithTags',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      expect(getTagBarMode(state)).toBe(TagBarMode.EditWithTags);
    });
  });
});

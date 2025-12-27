import {
  feedbackModeReducer,
  createInitialFeedbackModeState,
  isTagsModified,
  getCurrentTags,
  getFeedbackMode,
  type FeedbackModeState,
  type FeedbackModeAction,
} from './tagModeReducer';
import { TagUIType, FeedbackMode, SimpleTagUIType, PresetTagUIType } from '@/lib/schemas/schemas';

describe('feedbackModeReducer', () => {
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

  describe('createInitialFeedbackModeState', () => {
    it('should create initial state in normal mode with empty tags', () => {
      const state = createInitialFeedbackModeState();

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
      const initialState = createInitialFeedbackModeState();
      const tags: TagUIType[] = [
        createSimpleTag(1, 'beginner'),
        createSimpleTag(2, 'intermediate'),
      ];

      const action: FeedbackModeAction = { type: 'LOAD_TAGS', tags };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(tags);
      if (newState.mode === 'normal') {
        expect(newState.originalTags).toEqual(tags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });

    it('should replace existing tags when loading new tags', () => {
      const existingTags = [createSimpleTag(1, 'old')];
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: existingTags,
        originalTags: existingTags,
        showRegenerateDropdown: true,
      };

      const newTags = [createSimpleTag(2, 'new')];
      const action: FeedbackModeAction = { type: 'LOAD_TAGS', tags: newTags };
      const newState = feedbackModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(newTags);
      if (newState.mode === 'normal') {
        expect(newState.originalTags).toEqual(newTags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });
  });

  // ========================================================================
  // ENTER_REWRITE_FEEDBACK_MODE Action Tests
  // ========================================================================

  describe('ENTER_REWRITE_FEEDBACK_MODE action', () => {
    it('should enter rewrite feedback mode with temp tags', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: originalTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const tempTags = [createSimpleTag(2, 'normal'), createSimpleTag(5, 'medium')];
      const action: FeedbackModeAction = { type: 'ENTER_REWRITE_FEEDBACK_MODE', tempTags };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('rewriteWithFeedback');
      expect(getCurrentTags(newState)).toEqual(tempTags);
      if (newState.mode === 'rewriteWithFeedback') {
        expect(newState.originalTags).toEqual(originalTags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });

    it('should preserve originalTags when entering from normal mode', () => {
      const originalTags = [createSimpleTag(1, 'preserved')];
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'preserved', false)], // Modified version
        originalTags,
        showRegenerateDropdown: false,
      };

      const tempTags = [createSimpleTag(2, 'temp')];
      const action: FeedbackModeAction = { type: 'ENTER_REWRITE_FEEDBACK_MODE', tempTags };
      const newState = feedbackModeReducer(initialState, action);

      if (newState.mode === 'rewriteWithFeedback') {
        expect(newState.originalTags).toEqual(originalTags);
      }
    });
  });

  // ========================================================================
  // ENTER_EDIT_FEEDBACK_MODE Action Tests
  // ========================================================================

  describe('ENTER_EDIT_FEEDBACK_MODE action', () => {
    it('should enter edit feedback mode and restore original tags', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const modifiedTags = [createSimpleTag(1, 'original', false, true)]; // Modified
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: modifiedTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'ENTER_EDIT_FEEDBACK_MODE' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('editWithFeedback');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      if (newState.mode === 'editWithFeedback') {
        expect(newState.originalTags).toEqual(originalTags);
        expect(newState.showRegenerateDropdown).toBe(false);
      }
    });

    it('should not change state if not in normal mode', () => {
      const tempTags = [createSimpleTag(2, 'temp')];
      const initialState: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags,
        originalTags: [],
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'ENTER_EDIT_FEEDBACK_MODE' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState).toEqual(initialState);
    });
  });

  // ========================================================================
  // EXIT_TO_NORMAL Action Tests
  // ========================================================================

  describe('EXIT_TO_NORMAL action', () => {
    it('should exit from rewrite feedback mode to normal mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'EXIT_TO_NORMAL' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      expect(newState.originalTags).toEqual(originalTags);
      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should exit from edit feedback mode to normal mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'editWithFeedback',
        tags: [createSimpleTag(1, 'original', false)],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'EXIT_TO_NORMAL' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should close dropdown when already in normal mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: true,
      };

      const action: FeedbackModeAction = { type: 'EXIT_TO_NORMAL' };
      const newState = feedbackModeReducer(initialState, action);

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
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(true);
    });

    it('should toggle dropdown from true to false in normal mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: true,
      };

      const action: FeedbackModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should not toggle dropdown in rewrite feedback mode', () => {
      const initialState: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState).toEqual(initialState);
    });

    it('should not toggle dropdown in edit feedback mode', () => {
      const initialState: FeedbackModeState = {
        mode: 'editWithFeedback',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState).toEqual(initialState);
    });
  });

  // ========================================================================
  // UPDATE_TAGS Action Tests
  // ========================================================================

  describe('UPDATE_TAGS action', () => {
    it('should update tags in normal mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: originalTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const updatedTags = [createSimpleTag(1, 'original', false, true)];
      const action: FeedbackModeAction = { type: 'UPDATE_TAGS', tags: updatedTags };
      const newState = feedbackModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(updatedTags);
      expect(newState.originalTags).toEqual(originalTags); // Should not change
    });

    it('should update tempTags in rewrite feedback mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const tempTags = [createSimpleTag(2, 'temp')];
      const initialState: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const updatedTags = [createSimpleTag(2, 'temp', false)];
      const action: FeedbackModeAction = { type: 'UPDATE_TAGS', tags: updatedTags };
      const newState = feedbackModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(updatedTags);
      expect(newState.originalTags).toEqual(originalTags); // Should not change
    });

    it('should update tags in edit feedback mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'editWithFeedback',
        tags: originalTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const updatedTags = [createSimpleTag(1, 'original', false)];
      const action: FeedbackModeAction = { type: 'UPDATE_TAGS', tags: updatedTags };
      const newState = feedbackModeReducer(initialState, action);

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
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [originalTag],
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'RESET_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      const tags = getCurrentTags(newState);
      expect(tags[0].tag_active_current).toBe(true);
    });

    it('should reset preset tags in normal mode', () => {
      const originalTag = createPresetTag([1, 2, 3], 1, 1);
      const modifiedTag = createPresetTag([1, 2, 3], 2, 1); // Modified to tag 2
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [originalTag],
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'RESET_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

      const tags = getCurrentTags(newState);
      const resetTag = tags[0] as PresetTagUIType;
      expect(resetTag.currentActiveTagId).toBe(1); // Reset to original
    });

    it('should return to normal mode from rewrite feedback mode on reset', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'RESET_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
    });

    it('should reset tags in edit feedback mode and return to normal', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const modifiedTags = [createSimpleTag(1, 'original', false)];
      const initialState: FeedbackModeState = {
        mode: 'editWithFeedback',
        tags: modifiedTags,
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'RESET_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

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
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [createSimpleTag(1, 'tag', true, true)],
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'APPLY_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      const tags = getCurrentTags(newState);
      expect(tags[0].tag_active_initial).toBe(false);
      if (newState.mode === 'normal') {
        expect(newState.originalTags[0].tag_active_initial).toBe(false);
      }
    });

    it('should update preset tags originalTagId in normal mode', () => {
      const modifiedTag = createPresetTag([1, 2, 3], 2, 1);
      const initialState: FeedbackModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [createPresetTag([1, 2, 3], 1, 1)],
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'APPLY_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

      const tags = getCurrentTags(newState);
      const appliedTag = tags[0] as PresetTagUIType;
      expect(appliedTag.originalTagId).toBe(2);
    });

    it('should return to normal mode from rewrite feedback mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'APPLY_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      expect(getCurrentTags(newState)).toEqual(originalTags);
      expect(newState.showRegenerateDropdown).toBe(false);
    });

    it('should return to normal mode from edit feedback mode', () => {
      const originalTags = [createSimpleTag(1, 'original')];
      const initialState: FeedbackModeState = {
        mode: 'editWithFeedback',
        tags: [createSimpleTag(1, 'original', false)],
        originalTags,
        showRegenerateDropdown: false,
      };

      const action: FeedbackModeAction = { type: 'APPLY_TAGS' };
      const newState = feedbackModeReducer(initialState, action);

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
      const state: FeedbackModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(false);
    });

    it('should return true for modified simple tags in normal mode', () => {
      const state: FeedbackModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'tag', false, true)],
        originalTags: [createSimpleTag(1, 'tag', true, true)],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });

    it('should return true for modified preset tags in normal mode', () => {
      const state: FeedbackModeState = {
        mode: 'normal',
        tags: [createPresetTag([1, 2, 3], 2, 1)], // Current != Original
        originalTags: [createPresetTag([1, 2, 3], 1, 1)],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });

    it('should return true in rewrite feedback mode', () => {
      const state: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags: [createSimpleTag(2, 'temp')],
        originalTags: [createSimpleTag(1, 'original')],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });

    it('should return true in edit feedback mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const state: FeedbackModeState = {
        mode: 'editWithFeedback',
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
      const state: FeedbackModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(getCurrentTags(state)).toEqual(tags);
    });

    it('should return tempTags in rewrite feedback mode', () => {
      const tempTags = [createSimpleTag(2, 'temp')];
      const state: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags,
        originalTags: [createSimpleTag(1, 'original')],
        showRegenerateDropdown: false,
      };

      expect(getCurrentTags(state)).toEqual(tempTags);
    });

    it('should return tags in edit feedback mode', () => {
      const tags = [createSimpleTag(1, 'tag')];
      const state: FeedbackModeState = {
        mode: 'editWithFeedback',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(getCurrentTags(state)).toEqual(tags);
    });
  });

  describe('getFeedbackMode', () => {
    it('should return FeedbackMode.Normal for normal mode', () => {
      const state: FeedbackModeState = {
        mode: 'normal',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      expect(getFeedbackMode(state)).toBe(FeedbackMode.Normal);
    });

    it('should return FeedbackMode.RewriteWithFeedback for rewrite feedback mode', () => {
      const state: FeedbackModeState = {
        mode: 'rewriteWithFeedback',
        tempTags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      expect(getFeedbackMode(state)).toBe(FeedbackMode.RewriteWithFeedback);
    });

    it('should return FeedbackMode.EditWithFeedback for edit feedback mode', () => {
      const state: FeedbackModeState = {
        mode: 'editWithFeedback',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      expect(getFeedbackMode(state)).toBe(FeedbackMode.EditWithFeedback);
    });
  });
});

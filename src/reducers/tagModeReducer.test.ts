/**
 * Tests for tagModeReducer
 * Simplified to only test Normal mode (special modes deprecated)
 */

import {
  tagModeReducer,
  createInitialTagModeState,
  isTagsModified,
  getCurrentTags,
  type TagModeState,
  type TagModeAction,
} from './tagModeReducer';
import { TagUIType, SimpleTagUIType, PresetTagUIType } from '@/lib/schemas/schemas';

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
      expect(state.originalTags).toEqual([]);
      expect(state.showRegenerateDropdown).toBe(false);
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
      expect(newState.originalTags).toEqual(tags);
      expect(newState.showRegenerateDropdown).toBe(false);
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
      expect(newState.originalTags).toEqual(newTags);
      expect(newState.showRegenerateDropdown).toBe(false);
    });
  });

  // ========================================================================
  // EXIT_TO_NORMAL Action Tests
  // ========================================================================

  describe('EXIT_TO_NORMAL action', () => {
    it('should close dropdown when in normal mode', () => {
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'test')],
        originalTags: [createSimpleTag(1, 'test')],
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
    it('should toggle dropdown from false to true', () => {
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(true);
    });

    it('should toggle dropdown from true to false', () => {
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [],
        originalTags: [],
        showRegenerateDropdown: true,
      };

      const action: TagModeAction = { type: 'TOGGLE_DROPDOWN' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(false);
    });
  });

  // ========================================================================
  // UPDATE_TAGS Action Tests
  // ========================================================================

  describe('UPDATE_TAGS action', () => {
    it('should update tags in normal mode', () => {
      const initialTags = [createSimpleTag(1, 'original', true, true)];
      const initialState: TagModeState = {
        mode: 'normal',
        tags: initialTags,
        originalTags: initialTags,
        showRegenerateDropdown: false,
      };

      const updatedTags = [createSimpleTag(1, 'original', false, true)];
      const action: TagModeAction = { type: 'UPDATE_TAGS', tags: updatedTags };
      const newState = tagModeReducer(initialState, action);

      expect(getCurrentTags(newState)).toEqual(updatedTags);
      expect(newState.originalTags).toEqual(initialTags); // Original unchanged
    });

    it('should preserve other state properties when updating tags', () => {
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'test')],
        originalTags: [createSimpleTag(1, 'test')],
        showRegenerateDropdown: true,
      };

      const newTags = [createSimpleTag(2, 'new')];
      const action: TagModeAction = { type: 'UPDATE_TAGS', tags: newTags };
      const newState = tagModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(true);
    });
  });

  // ========================================================================
  // RESET_TAGS Action Tests
  // ========================================================================

  describe('RESET_TAGS action', () => {
    it('should reset simple tags to initial active state', () => {
      const originalTag = createSimpleTag(1, 'test', true, true);
      const modifiedTag = createSimpleTag(1, 'test', false, true); // Deactivated

      const initialState: TagModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [originalTag],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'RESET_TAGS' };
      const newState = tagModeReducer(initialState, action);

      const tags = getCurrentTags(newState);
      expect(tags[0]).toEqual(expect.objectContaining({
        tag_active_current: true, // Reset to initial
        tag_active_initial: true,
      }));
    });

    it('should reset preset tags to original tag selection', () => {
      const originalPreset = createPresetTag([1, 2, 3], 1, 1);
      const modifiedPreset = createPresetTag([1, 2, 3], 2, 1); // Changed selection

      const initialState: TagModeState = {
        mode: 'normal',
        tags: [modifiedPreset],
        originalTags: [originalPreset],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'RESET_TAGS' };
      const newState = tagModeReducer(initialState, action);

      const tags = getCurrentTags(newState);
      expect(tags[0]).toEqual(expect.objectContaining({
        currentActiveTagId: 1, // Reset to original
        originalTagId: 1,
      }));
    });
  });

  // ========================================================================
  // APPLY_TAGS Action Tests
  // ========================================================================

  describe('APPLY_TAGS action', () => {
    it('should update original tags to match current after apply', () => {
      const originalTag = createSimpleTag(1, 'test', true, true);
      const modifiedTag = createSimpleTag(1, 'test', false, true);

      const initialState: TagModeState = {
        mode: 'normal',
        tags: [modifiedTag],
        originalTags: [originalTag],
        showRegenerateDropdown: false,
      };

      const action: TagModeAction = { type: 'APPLY_TAGS' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.mode).toBe('normal');
      const tags = getCurrentTags(newState);
      expect(tags[0]).toEqual(expect.objectContaining({
        tag_active_current: false,
        tag_active_initial: false, // Updated to match current
      }));
      expect(newState.originalTags).toEqual(tags);
    });

    it('should close dropdown after apply', () => {
      const initialState: TagModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'test')],
        originalTags: [createSimpleTag(1, 'test')],
        showRegenerateDropdown: true,
      };

      const action: TagModeAction = { type: 'APPLY_TAGS' };
      const newState = tagModeReducer(initialState, action);

      expect(newState.showRegenerateDropdown).toBe(false);
    });
  });

  // ========================================================================
  // Helper Function Tests
  // ========================================================================

  describe('isTagsModified', () => {
    it('should return false when no tags are modified', () => {
      const state: TagModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'test', true, true)],
        originalTags: [createSimpleTag(1, 'test', true, true)],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(false);
    });

    it('should return true when simple tag is modified', () => {
      const state: TagModeState = {
        mode: 'normal',
        tags: [createSimpleTag(1, 'test', false, true)], // Deactivated
        originalTags: [createSimpleTag(1, 'test', true, true)],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });

    it('should return true when preset tag selection is changed', () => {
      const state: TagModeState = {
        mode: 'normal',
        tags: [createPresetTag([1, 2], 2, 1)], // Changed from 1 to 2
        originalTags: [createPresetTag([1, 2], 1, 1)],
        showRegenerateDropdown: false,
      };

      expect(isTagsModified(state)).toBe(true);
    });
  });

  describe('getCurrentTags', () => {
    it('should return tags from normal mode state', () => {
      const tags = [createSimpleTag(1, 'test')];
      const state: TagModeState = {
        mode: 'normal',
        tags,
        originalTags: tags,
        showRegenerateDropdown: false,
      };

      expect(getCurrentTags(state)).toEqual(tags);
    });
  });

  // ========================================================================
  // Default Case Tests
  // ========================================================================

  describe('default case', () => {
    it('should return unchanged state for unknown action type', () => {
      const initialState = createInitialTagModeState();
      const action = { type: 'UNKNOWN_ACTION' } as unknown as TagModeAction;
      const newState = tagModeReducer(initialState, action);

      expect(newState).toBe(initialState);
    });
  });
});

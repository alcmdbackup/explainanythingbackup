/**
 * Tag Mode State Reducer
 *
 * Manages tag modification state for the Normal mode.
 * Special modes (RewriteWithTags, EditWithTags) have been deprecated in favor
 * of the AdvancedAIEditorModal which provides a unified AI editing experience.
 */

import { TagUIType } from '@/lib/schemas/schemas';

// ============================================================================
// State Type Definitions
// ============================================================================

/**
 * Tag mode state - simplified to only support Normal mode
 * - tags: current tags being displayed and modified
 * - originalTags: pristine state for reset functionality
 * - showRegenerateDropdown: controls dropdown visibility
 */
export type TagModeState = {
  mode: 'normal';
  tags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: boolean;
};

// ============================================================================
// Action Type Definitions
// ============================================================================

export type TagModeAction =
  | { type: 'LOAD_TAGS'; tags: TagUIType[] }
  | { type: 'EXIT_TO_NORMAL' }
  | { type: 'TOGGLE_DROPDOWN' }
  | { type: 'UPDATE_TAGS'; tags: TagUIType[] }
  | { type: 'RESET_TAGS' }
  | { type: 'APPLY_TAGS' };

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Checks if any tags have been modified from their original state
 */
function hasModifiedTags(tags: TagUIType[]): boolean {
  return tags.some(tag => {
    if ('tag_name' in tag) {
      // Simple tag - check if tag_active_current != tag_active_initial
      return tag.tag_active_current !== tag.tag_active_initial;
    } else {
      // Preset tag - check if currentActiveTagId != originalTagId
      return tag.currentActiveTagId !== tag.originalTagId;
    }
  });
}

/**
 * Determines if tags are modified
 */
export function isTagsModified(state: TagModeState): boolean {
  return hasModifiedTags(state.tags);
}

/**
 * Gets the current tags array
 */
export function getCurrentTags(state: TagModeState): TagUIType[] {
  return state.tags;
}

// ============================================================================
// Initial State Factory
// ============================================================================

/**
 * Creates initial state for the tag mode reducer
 */
export function createInitialTagModeState(): TagModeState {
  return {
    mode: 'normal',
    tags: [],
    originalTags: [],
    showRegenerateDropdown: false,
  };
}

// ============================================================================
// Reducer Function
// ============================================================================

/**
 * Tag mode state reducer
 * Handles all state transitions for tag modifications
 */
export function tagModeReducer(state: TagModeState, action: TagModeAction): TagModeState {
  switch (action.type) {
    // ------------------------------------------------------------------------
    // LOAD_TAGS: Load tags when explanation is loaded
    // ------------------------------------------------------------------------
    case 'LOAD_TAGS': {
      return {
        mode: 'normal',
        tags: action.tags,
        originalTags: action.tags,
        showRegenerateDropdown: false,
      };
    }

    // ------------------------------------------------------------------------
    // EXIT_TO_NORMAL: Close dropdown (kept for backward compatibility)
    // ------------------------------------------------------------------------
    case 'EXIT_TO_NORMAL': {
      return {
        ...state,
        showRegenerateDropdown: false,
      };
    }

    // ------------------------------------------------------------------------
    // TOGGLE_DROPDOWN: Toggle regenerate dropdown
    // ------------------------------------------------------------------------
    case 'TOGGLE_DROPDOWN': {
      return {
        ...state,
        showRegenerateDropdown: !state.showRegenerateDropdown,
      };
    }

    // ------------------------------------------------------------------------
    // UPDATE_TAGS: Update current tags
    // ------------------------------------------------------------------------
    case 'UPDATE_TAGS': {
      return {
        ...state,
        tags: action.tags,
      };
    }

    // ------------------------------------------------------------------------
    // RESET_TAGS: Reset tags to original state
    // ------------------------------------------------------------------------
    case 'RESET_TAGS': {
      const resetTags = state.originalTags.map(tag => {
        if ('tag_name' in tag) {
          return { ...tag, tag_active_current: tag.tag_active_initial };
        } else {
          return { ...tag, currentActiveTagId: tag.originalTagId };
        }
      });
      return {
        ...state,
        tags: resetTags,
      };
    }

    // ------------------------------------------------------------------------
    // APPLY_TAGS: Handle apply button click
    // ------------------------------------------------------------------------
    case 'APPLY_TAGS': {
      // Update originalTags to match current state after successful apply
      const updatedTags = state.tags.map(tag => {
        if ('tag_name' in tag) {
          return { ...tag, tag_active_initial: tag.tag_active_current };
        } else {
          return { ...tag, originalTagId: tag.currentActiveTagId };
        }
      });
      return {
        mode: 'normal',
        tags: updatedTags,
        originalTags: updatedTags,
        showRegenerateDropdown: false,
      };
    }

    default:
      return state;
  }
}

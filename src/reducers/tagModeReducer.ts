import { TagUIType, TagBarMode } from '@/lib/schemas/schemas';

/**
 * Tag Mode State Machine Reducer
 *
 * Manages the complex state transitions between 3 tag modes:
 * - Normal: Standard tag modification with database persistence
 * - RewriteWithTags: Generate new explanation using selected tags
 * - EditWithTags: Edit existing explanation with tag-based instructions
 *
 * Prevents impossible states by using discriminated unions and centralizing
 * all state transitions in a single reducer function.
 */

// ============================================================================
// State Type Definitions
// ============================================================================

/**
 * Normal mode state
 * - tags: current tags being displayed and modified
 * - originalTags: pristine state for reset functionality
 * - showRegenerateDropdown: controls dropdown visibility
 */
type NormalModeState = {
  mode: 'normal';
  tags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: boolean;
};

/**
 * RewriteWithTags mode state
 * - tempTags: tags used for rewrite operation (preset tags ID 2, 5)
 * - originalTags: preserved from before entering mode
 * - dropdown always closed in this mode
 */
type RewriteWithTagsModeState = {
  mode: 'rewriteWithTags';
  tempTags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: false;
};

/**
 * EditWithTags mode state
 * - tags: tags used for edit operation (restored from originalTags)
 * - originalTags: preserved from before entering mode
 * - dropdown always closed in this mode
 */
type EditWithTagsModeState = {
  mode: 'editWithTags';
  tags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: false;
};

/**
 * Discriminated union of all possible tag mode states
 */
export type TagModeState = NormalModeState | RewriteWithTagsModeState | EditWithTagsModeState;

// ============================================================================
// Action Type Definitions
// ============================================================================

export type TagModeAction =
  | { type: 'LOAD_TAGS'; tags: TagUIType[] }
  | { type: 'ENTER_REWRITE_MODE'; tempTags: TagUIType[] }
  | { type: 'ENTER_EDIT_MODE' }
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
 * Determines if tags are modified based on mode and state
 */
export function isTagsModified(state: TagModeState): boolean {
  if (state.mode === 'normal') {
    return hasModifiedTags(state.tags);
  } else if (state.mode === 'rewriteWithTags') {
    return true; // Always considered modified in special modes
  } else if (state.mode === 'editWithTags') {
    return true; // Always considered modified in special modes
  }
  return false;
}

/**
 * Gets the current tags array based on mode
 */
export function getCurrentTags(state: TagModeState): TagUIType[] {
  if (state.mode === 'rewriteWithTags') {
    return state.tempTags;
  } else if (state.mode === 'normal' || state.mode === 'editWithTags') {
    return state.tags;
  }
  return [];
}

/**
 * Gets the TagBarMode enum value from state
 */
export function getTagBarMode(state: TagModeState): TagBarMode {
  if (state.mode === 'normal') return TagBarMode.Normal;
  if (state.mode === 'rewriteWithTags') return TagBarMode.RewriteWithTags;
  if (state.mode === 'editWithTags') return TagBarMode.EditWithTags;
  return TagBarMode.Normal;
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
 * Handles all state transitions for the tag mode state machine
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
    // ENTER_REWRITE_MODE: Enter rewrite with tags mode
    // ------------------------------------------------------------------------
    case 'ENTER_REWRITE_MODE': {
      return {
        mode: 'rewriteWithTags',
        tempTags: action.tempTags,
        originalTags: state.mode === 'normal' ? state.originalTags : state.originalTags,
        showRegenerateDropdown: false,
      };
    }

    // ------------------------------------------------------------------------
    // ENTER_EDIT_MODE: Enter edit with tags mode
    // ------------------------------------------------------------------------
    case 'ENTER_EDIT_MODE': {
      if (state.mode === 'normal') {
        return {
          mode: 'editWithTags',
          tags: state.originalTags, // Restore original tags
          originalTags: state.originalTags,
          showRegenerateDropdown: false,
        };
      }
      // If not in normal mode, stay in current state
      return state;
    }

    // ------------------------------------------------------------------------
    // EXIT_TO_NORMAL: Exit special modes and return to normal
    // ------------------------------------------------------------------------
    case 'EXIT_TO_NORMAL': {
      if (state.mode === 'normal') {
        // Just close dropdown if already in normal mode
        return {
          ...state,
          showRegenerateDropdown: false,
        };
      }
      // Return to normal mode with original tags
      return {
        mode: 'normal',
        tags: state.originalTags,
        originalTags: state.originalTags,
        showRegenerateDropdown: false,
      };
    }

    // ------------------------------------------------------------------------
    // TOGGLE_DROPDOWN: Toggle regenerate dropdown (normal mode only)
    // ------------------------------------------------------------------------
    case 'TOGGLE_DROPDOWN': {
      if (state.mode === 'normal') {
        return {
          ...state,
          showRegenerateDropdown: !state.showRegenerateDropdown,
        };
      }
      return state;
    }

    // ------------------------------------------------------------------------
    // UPDATE_TAGS: Update current tags
    // ------------------------------------------------------------------------
    case 'UPDATE_TAGS': {
      if (state.mode === 'normal') {
        return {
          ...state,
          tags: action.tags,
        };
      } else if (state.mode === 'rewriteWithTags') {
        return {
          ...state,
          tempTags: action.tags,
        };
      } else if (state.mode === 'editWithTags') {
        return {
          ...state,
          tags: action.tags,
        };
      }
      return state;
    }

    // ------------------------------------------------------------------------
    // RESET_TAGS: Reset tags to original state
    // ------------------------------------------------------------------------
    case 'RESET_TAGS': {
      if (state.mode === 'normal') {
        // Reset tags back to original, preserving original
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
      } else if (state.mode === 'rewriteWithTags') {
        // Reset temp tags to initial temp tags (reload from server would be needed)
        // For now, just return to normal mode
        return {
          mode: 'normal',
          tags: state.originalTags,
          originalTags: state.originalTags,
          showRegenerateDropdown: false,
        };
      } else if (state.mode === 'editWithTags') {
        // Reset tags back to original
        return {
          ...state,
          tags: state.originalTags,
        };
      }
      return state;
    }

    // ------------------------------------------------------------------------
    // APPLY_TAGS: Handle apply button click
    // ------------------------------------------------------------------------
    case 'APPLY_TAGS': {
      // Update originalTags to match current state after successful apply
      if (state.mode === 'normal') {
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
      } else {
        // For rewrite/edit modes, return to normal after apply
        return {
          mode: 'normal',
          tags: state.originalTags,
          originalTags: state.originalTags,
          showRegenerateDropdown: false,
        };
      }
    }

    default:
      return state;
  }
}

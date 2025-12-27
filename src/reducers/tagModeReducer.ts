import { TagUIType, FeedbackMode } from '@/lib/schemas/schemas';

/**
 * Feedback Mode State Machine Reducer
 *
 * Manages the complex state transitions between 3 feedback modes:
 * - Normal: Standard tag modification with database persistence
 * - RewriteWithFeedback: Generate new explanation using selected tags + sources
 * - EditWithFeedback: Edit existing explanation with tag-based instructions + sources
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
 * RewriteWithFeedback mode state
 * - tempTags: tags used for rewrite operation (preset tags ID 2, 5)
 * - originalTags: preserved from before entering mode
 * - dropdown always closed in this mode
 */
type RewriteWithFeedbackModeState = {
  mode: 'rewriteWithFeedback';
  tempTags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: false;
};

/**
 * EditWithFeedback mode state
 * - tags: tags used for edit operation (restored from originalTags)
 * - originalTags: preserved from before entering mode
 * - dropdown always closed in this mode
 */
type EditWithFeedbackModeState = {
  mode: 'editWithFeedback';
  tags: TagUIType[];
  originalTags: TagUIType[];
  showRegenerateDropdown: false;
};

/**
 * Discriminated union of all possible feedback mode states
 */
export type FeedbackModeState = NormalModeState | RewriteWithFeedbackModeState | EditWithFeedbackModeState;

// ============================================================================
// Action Type Definitions
// ============================================================================

export type FeedbackModeAction =
  | { type: 'LOAD_TAGS'; tags: TagUIType[] }
  | { type: 'ENTER_REWRITE_FEEDBACK_MODE'; tempTags: TagUIType[] }
  | { type: 'ENTER_EDIT_FEEDBACK_MODE' }
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
export function isTagsModified(state: FeedbackModeState): boolean {
  if (state.mode === 'normal') {
    return hasModifiedTags(state.tags);
  } else if (state.mode === 'rewriteWithFeedback') {
    return true; // Always considered modified in special modes
  } else if (state.mode === 'editWithFeedback') {
    return true; // Always considered modified in special modes
  }
  return false;
}

/**
 * Gets the current tags array based on mode
 */
export function getCurrentTags(state: FeedbackModeState): TagUIType[] {
  if (state.mode === 'rewriteWithFeedback') {
    return state.tempTags;
  } else if (state.mode === 'normal' || state.mode === 'editWithFeedback') {
    return state.tags;
  }
  return [];
}

/**
 * Gets the FeedbackMode enum value from state
 */
export function getFeedbackMode(state: FeedbackModeState): FeedbackMode {
  if (state.mode === 'normal') return FeedbackMode.Normal;
  if (state.mode === 'rewriteWithFeedback') return FeedbackMode.RewriteWithFeedback;
  if (state.mode === 'editWithFeedback') return FeedbackMode.EditWithFeedback;
  return FeedbackMode.Normal;
}

// ============================================================================
// Initial State Factory
// ============================================================================

/**
 * Creates initial state for the feedback mode reducer
 */
export function createInitialFeedbackModeState(): FeedbackModeState {
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
 * Feedback mode state reducer
 * Handles all state transitions for the feedback mode state machine
 */
export function feedbackModeReducer(state: FeedbackModeState, action: FeedbackModeAction): FeedbackModeState {
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
    // ENTER_REWRITE_FEEDBACK_MODE: Enter rewrite with feedback mode
    // ------------------------------------------------------------------------
    case 'ENTER_REWRITE_FEEDBACK_MODE': {
      return {
        mode: 'rewriteWithFeedback',
        tempTags: action.tempTags,
        originalTags: state.mode === 'normal' ? state.originalTags : state.originalTags,
        showRegenerateDropdown: false,
      };
    }

    // ------------------------------------------------------------------------
    // ENTER_EDIT_FEEDBACK_MODE: Enter edit with feedback mode
    // ------------------------------------------------------------------------
    case 'ENTER_EDIT_FEEDBACK_MODE': {
      if (state.mode === 'normal') {
        return {
          mode: 'editWithFeedback',
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
      } else if (state.mode === 'rewriteWithFeedback') {
        return {
          ...state,
          tempTags: action.tags,
        };
      } else if (state.mode === 'editWithFeedback') {
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
      } else if (state.mode === 'rewriteWithFeedback') {
        // Reset temp tags to initial temp tags (reload from server would be needed)
        // For now, just return to normal mode
        return {
          mode: 'normal',
          tags: state.originalTags,
          originalTags: state.originalTags,
          showRegenerateDropdown: false,
        };
      } else if (state.mode === 'editWithFeedback') {
        // Reset and exit back to normal mode
        return {
          mode: 'normal',
          tags: state.originalTags,
          originalTags: state.originalTags,
          showRegenerateDropdown: false,
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

// ============================================================================
// Backwards Compatibility Aliases
// ============================================================================

// These aliases maintain backwards compatibility during migration
export type TagModeState = FeedbackModeState;
export type TagModeAction = FeedbackModeAction;
export const tagModeReducer = feedbackModeReducer;
export const createInitialTagModeState = createInitialFeedbackModeState;
export const getTagBarMode = getFeedbackMode;

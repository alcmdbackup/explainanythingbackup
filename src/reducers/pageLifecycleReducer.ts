/**
 * Page Lifecycle State Machine Reducer
 *
 * Manages the complete lifecycle of the results page from generation through editing to saving.
 * Consolidates 12 previously scattered state variables into a single discriminated union.
 *
 * Phase Flow:
 * idle → loading → streaming → viewing → editing → saving → (navigation/reload)
 *   ↑                                       ↓
 *   └──────────────── error ←───────────────┘
 *
 * Key Benefits:
 * - Enforces mutual exclusivity (can't load AND edit simultaneously)
 * - Makes impossible states impossible via TypeScript
 * - Simplifies testing (pure reducer function)
 * - Single source of truth for page state
 */

import { ExplanationStatus } from '@/lib/schemas/schemas';

// ============================================================================
// STATE TYPES (Discriminated Union)
// ============================================================================

export type PageLifecycleState =
  | {
      phase: 'idle';
    }
  | {
      phase: 'loading';
    }
  | {
      phase: 'streaming';
      content: string;           // Accumulating during stream
      title: string;             // Set during progress events
    }
  | {
      phase: 'viewing';
      content: string;
      title: string;
      status: ExplanationStatus;
      originalContent: string;   // Preserved for future edits
      originalTitle: string;
      originalStatus: ExplanationStatus;
      hasUnsavedChanges?: boolean; // True if content modified but not saved
    }
  | {
      phase: 'editing';
      content: string;
      title: string;
      status: ExplanationStatus; // Computed: Draft if published+changed
      originalContent: string;
      originalTitle: string;
      originalStatus: ExplanationStatus;
      hasUnsavedChanges: boolean; // Computed: content !== original || title !== original
    }
  | {
      phase: 'saving';
      content: string;
      title: string;
      originalStatus: ExplanationStatus; // Needed for save logic
    }
  | {
      phase: 'error';
      error: string;
      // Preserve state for recovery if error occurred during editing
      content?: string;
      title?: string;
      status?: ExplanationStatus;
      originalContent?: string;
      originalTitle?: string;
      originalStatus?: ExplanationStatus;
      hasUnsavedChanges?: boolean;
    };

// ============================================================================
// ACTION TYPES
// ============================================================================

export type PageLifecycleAction =
  | { type: 'START_GENERATION' }
  | { type: 'START_STREAMING' }
  | { type: 'STREAM_CONTENT'; content: string }
  | { type: 'STREAM_TITLE'; title: string }
  | { type: 'LOAD_EXPLANATION'; content: string; title: string; status: ExplanationStatus }
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_EDIT_MODE' } // Reverts to original values
  | { type: 'UPDATE_CONTENT'; content: string }
  | { type: 'UPDATE_TITLE'; title: string }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_SUCCESS'; newId?: number; isNewExplanation: boolean }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' };

// ============================================================================
// INITIAL STATE
// ============================================================================

export const initialPageLifecycleState: PageLifecycleState = {
  phase: 'idle',
};

// ============================================================================
// REDUCER FUNCTION
// ============================================================================

export function pageLifecycleReducer(
  state: PageLifecycleState,
  action: PageLifecycleAction
): PageLifecycleState {
  switch (action.type) {
    // ------------------------------------------------------------------------
    // Generation Flow: idle/viewing/editing → loading
    // ------------------------------------------------------------------------
    case 'START_GENERATION':
      return { phase: 'loading' };

    // ------------------------------------------------------------------------
    // Streaming Flow: loading → streaming
    // ------------------------------------------------------------------------
    case 'START_STREAMING':
      if (state.phase !== 'loading') {
        console.warn(
          `START_STREAMING called in phase "${state.phase}", expected "loading"`
        );
      }
      return {
        phase: 'streaming',
        content: '',
        title: '',
      };

    // ------------------------------------------------------------------------
    // Content Accumulation: streaming → streaming (with updated content)
    // ------------------------------------------------------------------------
    case 'STREAM_CONTENT':
      if (state.phase !== 'streaming') {
        console.warn(
          `STREAM_CONTENT called in phase "${state.phase}", expected "streaming"`
        );
        return state;
      }
      return {
        ...state,
        content: action.content,
      };

    // ------------------------------------------------------------------------
    // Title Update: streaming → streaming (with updated title)
    // ------------------------------------------------------------------------
    case 'STREAM_TITLE':
      if (state.phase !== 'streaming') {
        console.warn(
          `STREAM_TITLE called in phase "${state.phase}", expected "streaming"`
        );
        return state;
      }
      return {
        ...state,
        title: action.title,
      };

    // ------------------------------------------------------------------------
    // Load Complete: streaming/idle → viewing
    // Sets BOTH current AND original values for change tracking
    // ------------------------------------------------------------------------
    case 'LOAD_EXPLANATION':
      return {
        phase: 'viewing',
        content: action.content,
        title: action.title,
        status: action.status,
        originalContent: action.content,  // Set original for future edits
        originalTitle: action.title,
        originalStatus: action.status,
      };

    // ------------------------------------------------------------------------
    // Edit Mode: viewing → editing (preserves content and unsaved changes flag)
    // ------------------------------------------------------------------------
    case 'ENTER_EDIT_MODE':
      if (state.phase !== 'viewing') {
        console.warn(
          `ENTER_EDIT_MODE called in phase "${state.phase}", expected "viewing"`
        );
        return state;
      }
      return {
        phase: 'editing',
        content: state.content,             // Keep current content (may be modified)
        title: state.title,                 // Keep current title (may be modified)
        status: state.status,               // Keep current status
        originalContent: state.originalContent,
        originalTitle: state.originalTitle,
        originalStatus: state.originalStatus,
        hasUnsavedChanges: state.hasUnsavedChanges || false, // Preserve flag if set
      };

    // ------------------------------------------------------------------------
    // Exit Edit Mode: editing → viewing (KEEPS modified content, does NOT revert)
    // ------------------------------------------------------------------------
    case 'EXIT_EDIT_MODE':
      if (state.phase !== 'editing') {
        console.warn(
          `EXIT_EDIT_MODE called in phase "${state.phase}", expected "editing"`
        );
        return state;
      }
      return {
        phase: 'viewing',
        content: state.content,            // KEEP modified content
        title: state.title,                // KEEP modified title
        status: state.status,              // KEEP computed status (Draft if changed)
        originalContent: state.originalContent,
        originalTitle: state.originalTitle,
        originalStatus: state.originalStatus,
        hasUnsavedChanges: state.hasUnsavedChanges, // Preserve unsaved changes flag
      };

    // ------------------------------------------------------------------------
    // Update Content: editing → editing (with computed hasUnsavedChanges + status)
    // ------------------------------------------------------------------------
    case 'UPDATE_CONTENT':
      if (state.phase !== 'editing') {
        console.warn(
          `UPDATE_CONTENT called in phase "${state.phase}", expected "editing"`
        );
        return state;
      }

      const contentChanged = action.content !== state.originalContent;
      const titleChanged = state.title !== state.originalTitle;
      const hasChanges = contentChanged || titleChanged;

      // If originally published and now has changes, show as Draft
      const newStatus =
        state.originalStatus === ExplanationStatus.Published && hasChanges
          ? ExplanationStatus.Draft
          : state.originalStatus;

      return {
        ...state,
        content: action.content,
        hasUnsavedChanges: hasChanges,
        status: newStatus,
      };

    // ------------------------------------------------------------------------
    // Update Title: editing → editing (with computed hasUnsavedChanges + status)
    // ------------------------------------------------------------------------
    case 'UPDATE_TITLE':
      if (state.phase !== 'editing') {
        console.warn(
          `UPDATE_TITLE called in phase "${state.phase}", expected "editing"`
        );
        return state;
      }

      const titleChangedNow = action.title !== state.originalTitle;
      const contentChangedNow = state.content !== state.originalContent;
      const hasChangesNow = titleChangedNow || contentChangedNow;

      // If originally published and now has changes, show as Draft
      const updatedStatus =
        state.originalStatus === ExplanationStatus.Published && hasChangesNow
          ? ExplanationStatus.Draft
          : state.originalStatus;

      return {
        ...state,
        title: action.title,
        hasUnsavedChanges: hasChangesNow,
        status: updatedStatus,
      };

    // ------------------------------------------------------------------------
    // Save: editing → saving
    // ------------------------------------------------------------------------
    case 'START_SAVE':
      if (state.phase !== 'editing') {
        console.warn(
          `START_SAVE called in phase "${state.phase}", expected "editing"`
        );
        return state;
      }
      return {
        phase: 'saving',
        content: state.content,
        title: state.title,
        originalStatus: state.originalStatus,
      };

    // ------------------------------------------------------------------------
    // Save Success: saving → (component unmounts due to navigation)
    // NOTE: We don't actually transition state here because:
    // - Draft update: window.location.href causes full page reload
    // - New version: router.push causes component unmount
    // ------------------------------------------------------------------------
    case 'SAVE_SUCCESS':
      // This action is mainly for logging/testing purposes
      // The component will unmount before this state is rendered
      return state;

    // ------------------------------------------------------------------------
    // Error: any phase → error (preserves state for recovery)
    // ------------------------------------------------------------------------
    case 'ERROR':
      if (state.phase === 'editing') {
        // Preserve editing state for recovery
        return {
          phase: 'error',
          error: action.error,
          content: state.content,
          title: state.title,
          status: state.status,
          originalContent: state.originalContent,
          originalTitle: state.originalTitle,
          originalStatus: state.originalStatus,
          hasUnsavedChanges: state.hasUnsavedChanges,
        };
      } else if (state.phase === 'viewing') {
        // Preserve viewing state for recovery
        return {
          phase: 'error',
          error: action.error,
          content: state.content,
          title: state.title,
          status: state.status,
          originalContent: state.originalContent,
          originalTitle: state.originalTitle,
          originalStatus: state.originalStatus,
        };
      } else {
        // Other phases: just store error
        return {
          phase: 'error',
          error: action.error,
        };
      }

    // ------------------------------------------------------------------------
    // Reset: any phase → idle
    // ------------------------------------------------------------------------
    case 'RESET':
      return { phase: 'idle' };

    default:
      return state;
  }
}

// ============================================================================
// SELECTORS (Derived State)
// ============================================================================

/**
 * Checks if the page is in loading phase
 */
export function isPageLoading(state: PageLifecycleState): boolean {
  return state.phase === 'loading';
}

/**
 * Checks if the page is streaming content
 */
export function isStreaming(state: PageLifecycleState): boolean {
  return state.phase === 'streaming';
}

/**
 * Checks if the page is in edit mode
 */
export function isEditMode(state: PageLifecycleState): boolean {
  return state.phase === 'editing';
}

/**
 * Checks if the page is currently saving changes
 */
export function isSavingChanges(state: PageLifecycleState): boolean {
  return state.phase === 'saving';
}

/**
 * Gets the current error message, if any
 */
export function getError(state: PageLifecycleState): string | null {
  return state.phase === 'error' ? state.error : null;
}

/**
 * Gets the current content
 */
export function getContent(state: PageLifecycleState): string {
  if (state.phase === 'streaming' || state.phase === 'viewing' || state.phase === 'editing' || state.phase === 'saving') {
    return state.content;
  }
  if (state.phase === 'error' && state.content !== undefined) {
    return state.content;
  }
  return '';
}

/**
 * Gets the current title
 */
export function getTitle(state: PageLifecycleState): string {
  if (state.phase === 'streaming' || state.phase === 'viewing' || state.phase === 'editing' || state.phase === 'saving') {
    return state.title;
  }
  if (state.phase === 'error' && state.title !== undefined) {
    return state.title;
  }
  return '';
}

/**
 * Gets the current status
 */
export function getStatus(state: PageLifecycleState): ExplanationStatus | null {
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return state.status;
  }
  if (state.phase === 'error' && state.status !== undefined) {
    return state.status;
  }
  return null;
}

/**
 * Gets the original content (for change detection)
 */
export function getOriginalContent(state: PageLifecycleState): string {
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return state.originalContent;
  }
  if (state.phase === 'error' && state.originalContent !== undefined) {
    return state.originalContent;
  }
  return '';
}

/**
 * Gets the original title (for change detection)
 */
export function getOriginalTitle(state: PageLifecycleState): string {
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return state.originalTitle;
  }
  if (state.phase === 'error' && state.originalTitle !== undefined) {
    return state.originalTitle;
  }
  return '';
}

/**
 * Gets the original status (for change detection)
 */
export function getOriginalStatus(state: PageLifecycleState): ExplanationStatus | null {
  if (state.phase === 'viewing' || state.phase === 'editing' || state.phase === 'saving') {
    return state.originalStatus;
  }
  if (state.phase === 'error' && state.originalStatus !== undefined) {
    return state.originalStatus;
  }
  return null;
}

/**
 * Checks if there are unsaved changes
 */
export function hasUnsavedChanges(state: PageLifecycleState): boolean {
  if (state.phase === 'editing') {
    return state.hasUnsavedChanges;
  }
  if (state.phase === 'viewing') {
    return state.hasUnsavedChanges || false;
  }
  return false;
}

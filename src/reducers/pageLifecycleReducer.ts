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
// MUTATION QUEUE TYPES
// ============================================================================

export type MutationOp = {
  id: string;
  type: 'accept' | 'reject';
  nodeKey: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
};

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
      // Mutation queue state
      pendingMutations: MutationOp[];
      processingMutation: MutationOp | null;
      pendingModeToggle: boolean;
      lastMutationError?: string;
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
      // Mutation queue state
      pendingMutations: MutationOp[];
      processingMutation: MutationOp | null;
      pendingModeToggle: boolean;
      lastMutationError?: string;
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
  // Existing actions
  | { type: 'START_GENERATION' }
  | { type: 'START_STREAMING' }
  | { type: 'STREAM_CONTENT'; content: string }
  | { type: 'STREAM_TITLE'; title: string }
  | { type: 'LOAD_EXPLANATION'; content: string; title: string; status: ExplanationStatus }
  | { type: 'ENTER_EDIT_MODE' }
  | { type: 'EXIT_EDIT_MODE' }
  | { type: 'UPDATE_CONTENT'; content: string }
  | { type: 'UPDATE_TITLE'; title: string }
  | { type: 'START_SAVE' }
  | { type: 'SAVE_SUCCESS'; newId?: number; isNewExplanation: boolean }
  | { type: 'ERROR'; error: string }
  | { type: 'RESET' }
  // Mutation queue actions
  | { type: 'QUEUE_MUTATION'; nodeKey: string; mutationType: 'accept' | 'reject' }
  | { type: 'START_MUTATION'; id: string }
  | { type: 'COMPLETE_MUTATION'; id: string; newContent: string }
  | { type: 'FAIL_MUTATION'; id: string; error: string }
  // Mode toggle actions
  | { type: 'REQUEST_MODE_TOGGLE' }
  | { type: 'EXECUTE_MODE_TOGGLE' }
  // AI suggestion action
  | { type: 'APPLY_AI_SUGGESTION'; content: string };

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
        // Initialize mutation queue state
        pendingMutations: [],
        processingMutation: null,
        pendingModeToggle: false,
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
        // Preserve mutation queue state
        pendingMutations: state.pendingMutations,
        processingMutation: state.processingMutation,
        pendingModeToggle: state.pendingModeToggle,
        lastMutationError: state.lastMutationError,
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
        // Preserve mutation queue state
        pendingMutations: state.pendingMutations,
        processingMutation: state.processingMutation,
        pendingModeToggle: state.pendingModeToggle,
        lastMutationError: state.lastMutationError,
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

    // ------------------------------------------------------------------------
    // Mutation Queue: Queue a new accept/reject mutation
    // ------------------------------------------------------------------------
    case 'QUEUE_MUTATION': {
      if (state.phase !== 'viewing' && state.phase !== 'editing') {
        console.warn(
          `QUEUE_MUTATION called in phase "${state.phase}", expected "viewing" or "editing"`
        );
        return state;
      }

      const newMutation: MutationOp = {
        id: `${action.nodeKey}-${Date.now()}`,
        type: action.mutationType,
        nodeKey: action.nodeKey,
        status: 'pending',
      };

      return {
        ...state,
        pendingMutations: [...state.pendingMutations, newMutation],
      };
    }

    // ------------------------------------------------------------------------
    // Mutation Queue: Start processing a mutation
    // ------------------------------------------------------------------------
    case 'START_MUTATION': {
      if (state.phase !== 'viewing' && state.phase !== 'editing') {
        return state;
      }

      const mutationToStart = state.pendingMutations.find(m => m.id === action.id);
      if (!mutationToStart) {
        console.warn(`START_MUTATION: mutation ${action.id} not found in queue`);
        return state;
      }

      return {
        ...state,
        pendingMutations: state.pendingMutations.map(m =>
          m.id === action.id ? { ...m, status: 'processing' as const } : m
        ),
        processingMutation: { ...mutationToStart, status: 'processing' },
      };
    }

    // ------------------------------------------------------------------------
    // Mutation Queue: Complete a mutation successfully
    // ------------------------------------------------------------------------
    case 'COMPLETE_MUTATION': {
      if (state.phase !== 'viewing' && state.phase !== 'editing') {
        return state;
      }

      const updatedMutations = state.pendingMutations.filter(m => m.id !== action.id);

      // Check if there was a pending mode toggle that can now execute
      const shouldExecuteToggle = state.pendingModeToggle && updatedMutations.length === 0;

      if (shouldExecuteToggle) {
        // Execute the pending mode toggle
        const newPhase = state.phase === 'viewing' ? 'editing' : 'viewing';
        if (newPhase === 'editing') {
          return {
            phase: 'editing',
            content: action.newContent,
            title: state.title,
            status: state.status,
            originalContent: state.originalContent,
            originalTitle: state.originalTitle,
            originalStatus: state.originalStatus,
            hasUnsavedChanges: action.newContent !== state.originalContent || state.title !== state.originalTitle,
            pendingMutations: [],
            processingMutation: null,
            pendingModeToggle: false,
          };
        } else {
          return {
            phase: 'viewing',
            content: action.newContent,
            title: state.title,
            status: state.status,
            originalContent: state.originalContent,
            originalTitle: state.originalTitle,
            originalStatus: state.originalStatus,
            hasUnsavedChanges: action.newContent !== state.originalContent || state.title !== state.originalTitle,
            pendingMutations: [],
            processingMutation: null,
            pendingModeToggle: false,
          };
        }
      }

      return {
        ...state,
        content: action.newContent,
        pendingMutations: updatedMutations,
        processingMutation: null,
        hasUnsavedChanges: action.newContent !== state.originalContent || state.title !== state.originalTitle,
      };
    }

    // ------------------------------------------------------------------------
    // Mutation Queue: Mutation failed
    // ------------------------------------------------------------------------
    case 'FAIL_MUTATION': {
      if (state.phase !== 'viewing' && state.phase !== 'editing') {
        return state;
      }

      const updatedMutations = state.pendingMutations.filter(m => m.id !== action.id);

      return {
        ...state,
        pendingMutations: updatedMutations,
        processingMutation: null,
        lastMutationError: action.error,
      };
    }

    // ------------------------------------------------------------------------
    // Mode Toggle: Request a mode toggle (may be queued if mutations pending)
    // ------------------------------------------------------------------------
    case 'REQUEST_MODE_TOGGLE': {
      if (state.phase !== 'viewing' && state.phase !== 'editing') {
        console.warn(
          `REQUEST_MODE_TOGGLE called in phase "${state.phase}", expected "viewing" or "editing"`
        );
        return state;
      }

      // If mutations are pending, queue the toggle
      if (state.pendingMutations.length > 0 || state.processingMutation !== null) {
        return {
          ...state,
          pendingModeToggle: true,
        };
      }

      // No mutations pending, execute immediately
      if (state.phase === 'viewing') {
        return {
          phase: 'editing',
          content: state.content,
          title: state.title,
          status: state.status,
          originalContent: state.originalContent,
          originalTitle: state.originalTitle,
          originalStatus: state.originalStatus,
          hasUnsavedChanges: state.hasUnsavedChanges || false,
          pendingMutations: [],
          processingMutation: null,
          pendingModeToggle: false,
        };
      } else {
        return {
          phase: 'viewing',
          content: state.content,
          title: state.title,
          status: state.status,
          originalContent: state.originalContent,
          originalTitle: state.originalTitle,
          originalStatus: state.originalStatus,
          hasUnsavedChanges: state.hasUnsavedChanges,
          pendingMutations: [],
          processingMutation: null,
          pendingModeToggle: false,
        };
      }
    }

    // ------------------------------------------------------------------------
    // Mode Toggle: Execute a queued mode toggle
    // ------------------------------------------------------------------------
    case 'EXECUTE_MODE_TOGGLE': {
      if (state.phase !== 'viewing' && state.phase !== 'editing') {
        return state;
      }

      if (!state.pendingModeToggle) {
        console.warn('EXECUTE_MODE_TOGGLE called but no mode toggle is pending');
        return state;
      }

      if (state.phase === 'viewing') {
        return {
          phase: 'editing',
          content: state.content,
          title: state.title,
          status: state.status,
          originalContent: state.originalContent,
          originalTitle: state.originalTitle,
          originalStatus: state.originalStatus,
          hasUnsavedChanges: state.hasUnsavedChanges || false,
          pendingMutations: state.pendingMutations,
          processingMutation: state.processingMutation,
          pendingModeToggle: false,
        };
      } else {
        return {
          phase: 'viewing',
          content: state.content,
          title: state.title,
          status: state.status,
          originalContent: state.originalContent,
          originalTitle: state.originalTitle,
          originalStatus: state.originalStatus,
          hasUnsavedChanges: state.hasUnsavedChanges,
          pendingMutations: state.pendingMutations,
          processingMutation: state.processingMutation,
          pendingModeToggle: false,
        };
      }
    }

    // ------------------------------------------------------------------------
    // AI Suggestion: Apply AI suggestion content (blocked during streaming)
    // ------------------------------------------------------------------------
    case 'APPLY_AI_SUGGESTION': {
      if (state.phase !== 'viewing' && state.phase !== 'editing') {
        console.warn(
          `APPLY_AI_SUGGESTION called in phase "${state.phase}", expected "viewing" or "editing"`
        );
        return state;
      }

      return {
        phase: 'editing',
        content: action.content,
        title: state.title,
        status: state.status,
        originalContent: state.originalContent,
        originalTitle: state.originalTitle,
        originalStatus: state.originalStatus,
        hasUnsavedChanges: true,
        // Clear stale mutations - AI suggestions replace content
        pendingMutations: [],
        processingMutation: null,
        pendingModeToggle: false,
      };
    }

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

// ============================================================================
// MUTATION QUEUE SELECTORS
// ============================================================================

/**
 * Block AI suggestions during streaming
 */
export function canRequestAISuggestion(state: PageLifecycleState): boolean {
  return state.phase !== 'streaming';
}

/**
 * Block mode toggle during streaming or pending mutations
 */
export function canToggleMode(state: PageLifecycleState): boolean {
  if (state.phase === 'streaming') return false;
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return (state.pendingMutations?.length ?? 0) === 0 && state.processingMutation === null;
  }
  return false;
}

/**
 * Check if mode toggle is queued
 */
export function hasPendingModeToggle(state: PageLifecycleState): boolean {
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return state.pendingModeToggle === true;
  }
  return false;
}

/**
 * Get queue length for UI feedback
 */
export function getMutationQueueLength(state: PageLifecycleState): number {
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return state.pendingMutations?.length ?? 0;
  }
  return 0;
}

/**
 * Check if any mutation is currently processing
 */
export function isMutationProcessing(state: PageLifecycleState): boolean {
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return state.processingMutation !== null;
  }
  return false;
}

/**
 * Get the last mutation error for UI display
 */
export function getLastMutationError(state: PageLifecycleState): string | undefined {
  if (state.phase === 'viewing' || state.phase === 'editing') {
    return state.lastMutationError;
  }
  return undefined;
}

/**
 * Unit tests for Page Lifecycle Reducer
 *
 * Tests all state transitions, computed properties, error handling,
 * and ensures impossible states are prevented.
 */

import { ExplanationStatus } from '@/lib/schemas/schemas';
import {
  pageLifecycleReducer,
  initialPageLifecycleState,
  PageLifecycleState,
  PageLifecycleAction,
  MutationOp,
  isPageLoading,
  isStreaming,
  isEditMode,
  isSavingChanges,
  getError,
  getContent,
  getTitle,
  getStatus,
  getOriginalContent,
  getOriginalTitle,
  getOriginalStatus,
  hasUnsavedChanges,
  canRequestAISuggestion,
  canToggleMode,
  hasPendingModeToggle,
  getMutationQueueLength,
  isMutationProcessing,
  getLastMutationError,
} from './pageLifecycleReducer';

// Helper to create viewing state with mutation queue defaults
const createViewingState = (overrides: Partial<Extract<PageLifecycleState, { phase: 'viewing' }>> = {}): PageLifecycleState => ({
  phase: 'viewing',
  content: 'Original content',
  title: 'Original title',
  status: ExplanationStatus.Published,
  originalContent: 'Original content',
  originalTitle: 'Original title',
  originalStatus: ExplanationStatus.Published,
  pendingMutations: [],
  processingMutation: null,
  pendingModeToggle: false,
  ...overrides,
});

// Helper to create editing state with mutation queue defaults
const createEditingState = (overrides: Partial<Extract<PageLifecycleState, { phase: 'editing' }>> = {}): PageLifecycleState => ({
  phase: 'editing',
  content: 'Original content',
  title: 'Original title',
  status: ExplanationStatus.Published,
  originalContent: 'Original content',
  originalTitle: 'Original title',
  originalStatus: ExplanationStatus.Published,
  hasUnsavedChanges: false,
  pendingMutations: [],
  processingMutation: null,
  pendingModeToggle: false,
  ...overrides,
});

describe('pageLifecycleReducer', () => {
  // ==========================================================================
  // INITIAL STATE
  // ==========================================================================
  describe('initial state', () => {
    it('should start in idle phase', () => {
      expect(initialPageLifecycleState).toEqual({ phase: 'idle' });
    });
  });

  // ==========================================================================
  // GENERATION FLOW: idle → loading → streaming → viewing
  // ==========================================================================
  describe('generation flow', () => {
    it('should transition from idle to loading on START_GENERATION', () => {
      const state = initialPageLifecycleState;
      const action: PageLifecycleAction = { type: 'START_GENERATION' };
      const result = pageLifecycleReducer(state, action);

      expect(result).toEqual({ phase: 'loading' });
    });

    it('should transition from loading to streaming on START_STREAMING', () => {
      const state: PageLifecycleState = { phase: 'loading' };
      const action: PageLifecycleAction = { type: 'START_STREAMING' };
      const result = pageLifecycleReducer(state, action);

      expect(result).toEqual({
        phase: 'streaming',
        content: '',
        title: '',
      });
    });

    it('should accumulate content during streaming with STREAM_CONTENT', () => {
      const state: PageLifecycleState = {
        phase: 'streaming',
        content: 'Hello',
        title: 'Test',
      };
      const action: PageLifecycleAction = {
        type: 'STREAM_CONTENT',
        content: 'Hello World',
      };
      const result = pageLifecycleReducer(state, action);

      expect(result).toEqual({
        phase: 'streaming',
        content: 'Hello World',
        title: 'Test',
      });
    });

    it('should update title during streaming with STREAM_TITLE', () => {
      const state: PageLifecycleState = {
        phase: 'streaming',
        content: 'Test content',
        title: '',
      };
      const action: PageLifecycleAction = {
        type: 'STREAM_TITLE',
        title: 'New Title',
      };
      const result = pageLifecycleReducer(state, action);

      expect(result).toEqual({
        phase: 'streaming',
        content: 'Test content',
        title: 'New Title',
      });
    });

    it('should transition to viewing on LOAD_EXPLANATION and set original values', () => {
      const state: PageLifecycleState = {
        phase: 'streaming',
        content: 'Streamed content',
        title: 'Streamed title',
      };
      const action: PageLifecycleAction = {
        type: 'LOAD_EXPLANATION',
        content: 'Final content',
        title: 'Final title',
        status: ExplanationStatus.Published,
      };
      const result = pageLifecycleReducer(state, action);

      expect(result).toEqual(createViewingState({
        content: 'Final content',
        title: 'Final title',
        originalContent: 'Final content',
        originalTitle: 'Final title',
      }));
    });

    it('should allow LOAD_EXPLANATION from idle (direct load from DB)', () => {
      const state: PageLifecycleState = { phase: 'idle' };
      const action: PageLifecycleAction = {
        type: 'LOAD_EXPLANATION',
        content: 'DB content',
        title: 'DB title',
        status: ExplanationStatus.Draft,
      };
      const result = pageLifecycleReducer(state, action);

      expect(result).toEqual(createViewingState({
        content: 'DB content',
        title: 'DB title',
        status: ExplanationStatus.Draft,
        originalContent: 'DB content',
        originalTitle: 'DB title',
        originalStatus: ExplanationStatus.Draft,
      }));
    });
  });

  // ==========================================================================
  // EDIT FLOW: viewing → editing → viewing (revert) OR editing → saving
  // ==========================================================================
  describe('edit flow', () => {
    const viewingState = createViewingState();

    it('should transition from viewing to editing on ENTER_EDIT_MODE', () => {
      const action: PageLifecycleAction = { type: 'ENTER_EDIT_MODE' };
      const result = pageLifecycleReducer(viewingState, action);

      expect(result).toEqual(createEditingState());
    });

    it('should update content and compute hasUnsavedChanges in editing phase', () => {
      const editingState = createEditingState();

      const action: PageLifecycleAction = {
        type: 'UPDATE_CONTENT',
        content: 'Modified content',
      };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual(createEditingState({
        content: 'Modified content',
        status: ExplanationStatus.Draft, // Changed to Draft because Published + changes
        hasUnsavedChanges: true,
      }));
    });

    it('should update title and compute hasUnsavedChanges in editing phase', () => {
      const editingState = createEditingState();

      const action: PageLifecycleAction = {
        type: 'UPDATE_TITLE',
        title: 'Modified title',
      };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual(createEditingState({
        title: 'Modified title',
        status: ExplanationStatus.Draft, // Changed to Draft because Published + changes
        hasUnsavedChanges: true,
      }));
    });

    it('should NOT change status to Draft if original status was Draft', () => {
      const editingState = createEditingState({
        status: ExplanationStatus.Draft,
        originalStatus: ExplanationStatus.Draft,
      });

      const action: PageLifecycleAction = {
        type: 'UPDATE_CONTENT',
        content: 'Modified content',
      };
      const result = pageLifecycleReducer(editingState, action);

      expect(getStatus(result)).toBe(ExplanationStatus.Draft);
      expect(hasUnsavedChanges(result)).toBe(true);
    });

    it('should preserve modified content on EXIT_EDIT_MODE (not revert)', () => {
      const editingState = createEditingState({
        content: 'Modified content',
        title: 'Modified title',
        status: ExplanationStatus.Draft,
        hasUnsavedChanges: true,
      });

      const action: PageLifecycleAction = { type: 'EXIT_EDIT_MODE' };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual(createViewingState({
        content: 'Modified content', // PRESERVED (not reverted)
        title: 'Modified title', // PRESERVED (not reverted)
        status: ExplanationStatus.Draft, // PRESERVED (shows Draft)
        hasUnsavedChanges: true, // Still has unsaved changes
      }));
    });

    it('should transition from editing to saving on START_SAVE', () => {
      const editingState = createEditingState({
        content: 'Modified content',
        title: 'Modified title',
        status: ExplanationStatus.Draft,
        hasUnsavedChanges: true,
      });

      const action: PageLifecycleAction = { type: 'START_SAVE' };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual({
        phase: 'saving',
        content: 'Modified content',
        title: 'Modified title',
        originalStatus: ExplanationStatus.Published,
      });
    });

    it('should remain in saving phase on SAVE_SUCCESS (component will unmount)', () => {
      const savingState: PageLifecycleState = {
        phase: 'saving',
        content: 'Modified content',
        title: 'Modified title',
        originalStatus: ExplanationStatus.Published,
      };

      const action: PageLifecycleAction = {
        type: 'SAVE_SUCCESS',
        newId: 123,
        isNewExplanation: false,
      };
      const result = pageLifecycleReducer(savingState, action);

      // Component will unmount before this renders, so state doesn't change
      expect(result).toEqual(savingState);
    });
  });

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================
  describe('error handling', () => {
    it('should transition to error from loading', () => {
      const state: PageLifecycleState = { phase: 'loading' };
      const action: PageLifecycleAction = {
        type: 'ERROR',
        error: 'Network error',
      };
      const result = pageLifecycleReducer(state, action);

      expect(result).toEqual({
        phase: 'error',
        error: 'Network error',
      });
    });

    it('should preserve editing state when error occurs during editing', () => {
      const editingState = createEditingState({
        content: 'Modified content',
        title: 'Modified title',
        status: ExplanationStatus.Draft,
        hasUnsavedChanges: true,
      });

      const action: PageLifecycleAction = {
        type: 'ERROR',
        error: 'Save failed',
      };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual({
        phase: 'error',
        error: 'Save failed',
        content: 'Modified content',
        title: 'Modified title',
        status: ExplanationStatus.Draft,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: true,
      });
    });

    it('should preserve viewing state when error occurs during viewing', () => {
      const viewingState = createViewingState({
        content: 'Content',
        title: 'Title',
        originalContent: 'Content',
        originalTitle: 'Title',
      });

      const action: PageLifecycleAction = {
        type: 'ERROR',
        error: 'Something went wrong',
      };
      const result = pageLifecycleReducer(viewingState, action);

      expect(result).toEqual({
        phase: 'error',
        error: 'Something went wrong',
        content: 'Content',
        title: 'Title',
        status: ExplanationStatus.Published,
        originalContent: 'Content',
        originalTitle: 'Title',
        originalStatus: ExplanationStatus.Published,
      });
    });
  });

  // ==========================================================================
  // RESET
  // ==========================================================================
  describe('reset', () => {
    it('should reset to idle from any phase', () => {
      const states: PageLifecycleState[] = [
        { phase: 'loading' },
        { phase: 'streaming', content: 'test', title: 'test' },
        createViewingState({ content: 'test', title: 'test', originalContent: 'test', originalTitle: 'test' }),
        { phase: 'error', error: 'test' },
      ];

      const action: PageLifecycleAction = { type: 'RESET' };

      states.forEach((state) => {
        const result = pageLifecycleReducer(state, action);
        expect(result).toEqual({ phase: 'idle' });
      });
    });
  });

  // ==========================================================================
  // EDGE CASES & INVALID TRANSITIONS
  // ==========================================================================
  describe('edge cases and invalid transitions', () => {
    it('should warn but handle START_STREAMING from non-loading phase', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const state: PageLifecycleState = { phase: 'idle' };
      const action: PageLifecycleAction = { type: 'START_STREAMING' };
      const result = pageLifecycleReducer(state, action);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('START_STREAMING called in phase "idle"')
      );
      expect(result).toEqual({
        phase: 'streaming',
        content: '',
        title: '',
      });

      consoleSpy.mockRestore();
    });

    it('should warn and ignore STREAM_CONTENT from non-streaming phase', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const state: PageLifecycleState = { phase: 'idle' };
      const action: PageLifecycleAction = {
        type: 'STREAM_CONTENT',
        content: 'test',
      };
      const result = pageLifecycleReducer(state, action);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('STREAM_CONTENT called in phase "idle"')
      );
      expect(result).toEqual(state); // State unchanged

      consoleSpy.mockRestore();
    });

    it('should warn and ignore ENTER_EDIT_MODE from non-viewing phase', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const state: PageLifecycleState = { phase: 'loading' };
      const action: PageLifecycleAction = { type: 'ENTER_EDIT_MODE' };
      const result = pageLifecycleReducer(state, action);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ENTER_EDIT_MODE called in phase "loading"')
      );
      expect(result).toEqual(state); // State unchanged

      consoleSpy.mockRestore();
    });

    it('should warn and ignore UPDATE_CONTENT from non-editing phase', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      const state = createViewingState({
        content: 'test',
        title: 'test',
        originalContent: 'test',
        originalTitle: 'test',
      });
      const action: PageLifecycleAction = {
        type: 'UPDATE_CONTENT',
        content: 'new',
      };
      const result = pageLifecycleReducer(state, action);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE_CONTENT called in phase "viewing"')
      );
      expect(result).toEqual(state); // State unchanged

      consoleSpy.mockRestore();
    });
  });

  // ==========================================================================
  // SELECTORS
  // ==========================================================================
  describe('selectors', () => {
    describe('isPageLoading', () => {
      it('should return true for loading phase', () => {
        expect(isPageLoading({ phase: 'loading' })).toBe(true);
      });

      it('should return false for other phases', () => {
        expect(isPageLoading({ phase: 'idle' })).toBe(false);
        expect(
          isPageLoading({ phase: 'streaming', content: '', title: '' })
        ).toBe(false);
      });
    });

    describe('isStreaming', () => {
      it('should return true for streaming phase', () => {
        expect(isStreaming({ phase: 'streaming', content: '', title: '' })).toBe(
          true
        );
      });

      it('should return false for other phases', () => {
        expect(isStreaming({ phase: 'idle' })).toBe(false);
        expect(isStreaming({ phase: 'loading' })).toBe(false);
      });
    });

    describe('isEditMode', () => {
      it('should return true for editing phase', () => {
        const state = createEditingState({
          content: 'test',
          title: 'test',
          originalContent: 'test',
          originalTitle: 'test',
        });
        expect(isEditMode(state)).toBe(true);
      });

      it('should return false for other phases', () => {
        expect(isEditMode({ phase: 'idle' })).toBe(false);
        expect(isEditMode({ phase: 'loading' })).toBe(false);
      });
    });

    describe('isSavingChanges', () => {
      it('should return true for saving phase', () => {
        const state: PageLifecycleState = {
          phase: 'saving',
          content: 'test',
          title: 'test',
          originalStatus: ExplanationStatus.Published,
        };
        expect(isSavingChanges(state)).toBe(true);
      });

      it('should return false for other phases', () => {
        expect(isSavingChanges({ phase: 'idle' })).toBe(false);
        expect(isSavingChanges({ phase: 'loading' })).toBe(false);
      });
    });

    describe('getError', () => {
      it('should return error message in error phase', () => {
        expect(getError({ phase: 'error', error: 'Test error' })).toBe(
          'Test error'
        );
      });

      it('should return null for other phases', () => {
        expect(getError({ phase: 'idle' })).toBeNull();
        expect(getError({ phase: 'loading' })).toBeNull();
      });
    });

    describe('getContent', () => {
      it('should return content from streaming phase', () => {
        expect(
          getContent({ phase: 'streaming', content: 'test', title: '' })
        ).toBe('test');
      });

      it('should return content from viewing phase', () => {
        const state = createViewingState({
          content: 'test',
          title: 'title',
          originalContent: 'test',
          originalTitle: 'title',
        });
        expect(getContent(state)).toBe('test');
      });

      it('should return empty string from idle phase', () => {
        expect(getContent({ phase: 'idle' })).toBe('');
      });
    });

    describe('hasUnsavedChanges', () => {
      it('should return true when in editing phase with changes', () => {
        const state = createEditingState({
          content: 'modified',
          status: ExplanationStatus.Draft,
          originalContent: 'original',
          hasUnsavedChanges: true,
        });
        expect(hasUnsavedChanges(state)).toBe(true);
      });

      it('should return false when in editing phase without changes', () => {
        const state = createEditingState({
          content: 'test',
          title: 'test',
          originalContent: 'test',
          originalTitle: 'test',
        });
        expect(hasUnsavedChanges(state)).toBe(false);
      });

      it('should return false for non-editing phases', () => {
        expect(hasUnsavedChanges({ phase: 'idle' })).toBe(false);
        expect(hasUnsavedChanges({ phase: 'loading' })).toBe(false);
      });
    });
  });

  // ==========================================================================
  // COMPLETE LIFECYCLE FLOW
  // ==========================================================================
  describe('complete lifecycle flow', () => {
    it('should handle full generation → edit → save flow', () => {
      // Start idle
      let state: PageLifecycleState = initialPageLifecycleState;
      expect(state.phase).toBe('idle');

      // Start generation
      state = pageLifecycleReducer(state, { type: 'START_GENERATION' });
      expect(state.phase).toBe('loading');

      // Start streaming
      state = pageLifecycleReducer(state, { type: 'START_STREAMING' });
      expect(state.phase).toBe('streaming');

      // Stream content
      state = pageLifecycleReducer(state, {
        type: 'STREAM_CONTENT',
        content: 'Streaming...',
      });
      expect(getContent(state)).toBe('Streaming...');

      // Stream title
      state = pageLifecycleReducer(state, {
        type: 'STREAM_TITLE',
        title: 'My Title',
      });
      expect(getTitle(state)).toBe('My Title');

      // Load explanation (complete)
      state = pageLifecycleReducer(state, {
        type: 'LOAD_EXPLANATION',
        content: 'Final content',
        title: 'Final title',
        status: ExplanationStatus.Published,
      });
      expect(state.phase).toBe('viewing');
      expect(getContent(state)).toBe('Final content');
      expect(getOriginalContent(state)).toBe('Final content');

      // Enter edit mode
      state = pageLifecycleReducer(state, { type: 'ENTER_EDIT_MODE' });
      expect(state.phase).toBe('editing');
      expect(hasUnsavedChanges(state)).toBe(false);

      // Update content
      state = pageLifecycleReducer(state, {
        type: 'UPDATE_CONTENT',
        content: 'Modified content',
      });
      expect(hasUnsavedChanges(state)).toBe(true);
      expect(getStatus(state)).toBe(ExplanationStatus.Draft);

      // Start save
      state = pageLifecycleReducer(state, { type: 'START_SAVE' });
      expect(state.phase).toBe('saving');
      expect(getContent(state)).toBe('Modified content');
    });

    it('should handle edit → exit (preserve changes) → re-enter edit flow', () => {
      // Start in viewing
      let state: PageLifecycleState = createViewingState({
        content: 'Original',
        title: 'Original Title',
        originalContent: 'Original',
        originalTitle: 'Original Title',
      });

      // Enter edit
      state = pageLifecycleReducer(state, { type: 'ENTER_EDIT_MODE' });
      expect(state.phase).toBe('editing');

      // Make changes
      state = pageLifecycleReducer(state, {
        type: 'UPDATE_CONTENT',
        content: 'Modified',
      });
      expect(getContent(state)).toBe('Modified');
      expect(hasUnsavedChanges(state)).toBe(true);

      // Exit edit mode (preserves changes)
      state = pageLifecycleReducer(state, { type: 'EXIT_EDIT_MODE' });
      expect(state.phase).toBe('viewing');
      expect(getContent(state)).toBe('Modified'); // PRESERVED (not reverted)
      expect(getStatus(state)).toBe(ExplanationStatus.Draft); // Shows Draft indicator
      expect(hasUnsavedChanges(state)).toBe(true); // Still has unsaved changes

      // Can re-enter edit mode and continue editing
      state = pageLifecycleReducer(state, { type: 'ENTER_EDIT_MODE' });
      expect(state.phase).toBe('editing');
      expect(getContent(state)).toBe('Modified'); // Still has modified content
      expect(hasUnsavedChanges(state)).toBe(true); // Still has unsaved changes
    });
  });

  // ==========================================================================
  // MUTATION QUEUE ACTIONS
  // ==========================================================================
  describe('mutation queue actions', () => {
    describe('QUEUE_MUTATION', () => {
      it('should add mutation to queue in viewing phase', () => {
        const state = createViewingState();
        const action: PageLifecycleAction = {
          type: 'QUEUE_MUTATION',
          nodeKey: 'node-1',
          mutationType: 'accept',
        };
        const result = pageLifecycleReducer(state, action);

        expect(result.phase).toBe('viewing');
        if (result.phase === 'viewing') {
          expect(result.pendingMutations).toHaveLength(1);
          expect(result.pendingMutations[0].nodeKey).toBe('node-1');
          expect(result.pendingMutations[0].type).toBe('accept');
          expect(result.pendingMutations[0].status).toBe('pending');
        }
      });

      it('should add mutation to queue in editing phase', () => {
        const state = createEditingState();
        const action: PageLifecycleAction = {
          type: 'QUEUE_MUTATION',
          nodeKey: 'node-2',
          mutationType: 'reject',
        };
        const result = pageLifecycleReducer(state, action);

        expect(result.phase).toBe('editing');
        if (result.phase === 'editing') {
          expect(result.pendingMutations).toHaveLength(1);
          expect(result.pendingMutations[0].type).toBe('reject');
        }
      });

      it('should warn and ignore QUEUE_MUTATION in streaming phase', () => {
        const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
        const state: PageLifecycleState = { phase: 'streaming', content: '', title: '' };
        const action: PageLifecycleAction = {
          type: 'QUEUE_MUTATION',
          nodeKey: 'node-1',
          mutationType: 'accept',
        };
        const result = pageLifecycleReducer(state, action);

        expect(consoleSpy).toHaveBeenCalled();
        expect(result).toEqual(state);
        consoleSpy.mockRestore();
      });
    });

    describe('START_MUTATION', () => {
      it('should move mutation to processing state', () => {
        const initialMutation: MutationOp = {
          id: 'mutation-1',
          type: 'accept',
          nodeKey: 'node-1',
          status: 'pending',
        };
        const state = createViewingState({ pendingMutations: [initialMutation] });
        const action: PageLifecycleAction = { type: 'START_MUTATION', id: 'mutation-1' };
        const result = pageLifecycleReducer(state, action);

        if (result.phase === 'viewing') {
          expect(result.processingMutation).not.toBeNull();
          expect(result.processingMutation?.status).toBe('processing');
          expect(result.pendingMutations[0].status).toBe('processing');
        }
      });
    });

    describe('COMPLETE_MUTATION', () => {
      it('should remove mutation from queue and update content', () => {
        const initialMutation: MutationOp = {
          id: 'mutation-1',
          type: 'accept',
          nodeKey: 'node-1',
          status: 'processing',
        };
        const state = createViewingState({
          pendingMutations: [initialMutation],
          processingMutation: initialMutation,
        });
        const action: PageLifecycleAction = {
          type: 'COMPLETE_MUTATION',
          id: 'mutation-1',
          newContent: 'Updated content after accept',
        };
        const result = pageLifecycleReducer(state, action);

        if (result.phase === 'viewing') {
          expect(result.pendingMutations).toHaveLength(0);
          expect(result.processingMutation).toBeNull();
          expect(result.content).toBe('Updated content after accept');
        }
      });

      it('should execute pending mode toggle when queue empties', () => {
        const initialMutation: MutationOp = {
          id: 'mutation-1',
          type: 'accept',
          nodeKey: 'node-1',
          status: 'processing',
        };
        const state = createViewingState({
          pendingMutations: [initialMutation],
          processingMutation: initialMutation,
          pendingModeToggle: true,
        });
        const action: PageLifecycleAction = {
          type: 'COMPLETE_MUTATION',
          id: 'mutation-1',
          newContent: 'Updated content',
        };
        const result = pageLifecycleReducer(state, action);

        // Should transition to editing due to pending mode toggle
        expect(result.phase).toBe('editing');
        if (result.phase === 'editing') {
          expect(result.pendingModeToggle).toBe(false);
        }
      });
    });

    describe('FAIL_MUTATION', () => {
      it('should remove mutation from queue and set error', () => {
        const initialMutation: MutationOp = {
          id: 'mutation-1',
          type: 'accept',
          nodeKey: 'node-1',
          status: 'processing',
        };
        const state = createViewingState({
          pendingMutations: [initialMutation],
          processingMutation: initialMutation,
        });
        const action: PageLifecycleAction = {
          type: 'FAIL_MUTATION',
          id: 'mutation-1',
          error: 'Node not found',
        };
        const result = pageLifecycleReducer(state, action);

        if (result.phase === 'viewing') {
          expect(result.pendingMutations).toHaveLength(0);
          expect(result.processingMutation).toBeNull();
          expect(result.lastMutationError).toBe('Node not found');
        }
      });
    });

    describe('REQUEST_MODE_TOGGLE', () => {
      it('should toggle immediately when no mutations pending', () => {
        const state = createViewingState();
        const action: PageLifecycleAction = { type: 'REQUEST_MODE_TOGGLE' };
        const result = pageLifecycleReducer(state, action);

        expect(result.phase).toBe('editing');
      });

      it('should queue toggle when mutations are pending', () => {
        const pendingMutation: MutationOp = {
          id: 'mutation-1',
          type: 'accept',
          nodeKey: 'node-1',
          status: 'pending',
        };
        const state = createViewingState({ pendingMutations: [pendingMutation] });
        const action: PageLifecycleAction = { type: 'REQUEST_MODE_TOGGLE' };
        const result = pageLifecycleReducer(state, action);

        expect(result.phase).toBe('viewing'); // Still viewing
        if (result.phase === 'viewing') {
          expect(result.pendingModeToggle).toBe(true);
        }
      });
    });

    describe('APPLY_AI_SUGGESTION', () => {
      it('should enter edit mode and clear mutation queue', () => {
        const pendingMutation: MutationOp = {
          id: 'mutation-1',
          type: 'accept',
          nodeKey: 'node-1',
          status: 'pending',
        };
        const state = createViewingState({ pendingMutations: [pendingMutation] });
        const action: PageLifecycleAction = {
          type: 'APPLY_AI_SUGGESTION',
          content: 'AI suggested content with {++additions++}',
        };
        const result = pageLifecycleReducer(state, action);

        expect(result.phase).toBe('editing');
        if (result.phase === 'editing') {
          expect(result.content).toBe('AI suggested content with {++additions++}');
          expect(result.pendingMutations).toHaveLength(0);
          expect(result.hasUnsavedChanges).toBe(true);
        }
      });
    });
  });

  // ==========================================================================
  // MUTATION QUEUE SELECTORS
  // ==========================================================================
  describe('mutation queue selectors', () => {
    describe('canRequestAISuggestion', () => {
      it('should return false during streaming', () => {
        const state: PageLifecycleState = { phase: 'streaming', content: '', title: '' };
        expect(canRequestAISuggestion(state)).toBe(false);
      });

      it('should return true in viewing phase', () => {
        const state = createViewingState();
        expect(canRequestAISuggestion(state)).toBe(true);
      });
    });

    describe('canToggleMode', () => {
      it('should return false during streaming', () => {
        const state: PageLifecycleState = { phase: 'streaming', content: '', title: '' };
        expect(canToggleMode(state)).toBe(false);
      });

      it('should return true in viewing with empty queue', () => {
        const state = createViewingState();
        expect(canToggleMode(state)).toBe(true);
      });

      it('should return false in viewing with pending mutations', () => {
        const pendingMutation: MutationOp = {
          id: 'mutation-1',
          type: 'accept',
          nodeKey: 'node-1',
          status: 'pending',
        };
        const state = createViewingState({ pendingMutations: [pendingMutation] });
        expect(canToggleMode(state)).toBe(false);
      });
    });

    describe('hasPendingModeToggle', () => {
      it('should return true when mode toggle is queued', () => {
        const state = createViewingState({ pendingModeToggle: true });
        expect(hasPendingModeToggle(state)).toBe(true);
      });

      it('should return false when no mode toggle is queued', () => {
        const state = createViewingState();
        expect(hasPendingModeToggle(state)).toBe(false);
      });
    });

    describe('getMutationQueueLength', () => {
      it('should return queue length', () => {
        const mutations: MutationOp[] = [
          { id: '1', type: 'accept', nodeKey: 'n1', status: 'pending' },
          { id: '2', type: 'reject', nodeKey: 'n2', status: 'pending' },
        ];
        const state = createViewingState({ pendingMutations: mutations });
        expect(getMutationQueueLength(state)).toBe(2);
      });

      it('should return 0 for empty queue', () => {
        const state = createViewingState();
        expect(getMutationQueueLength(state)).toBe(0);
      });
    });

    describe('isMutationProcessing', () => {
      it('should return true when mutation is processing', () => {
        const mutation: MutationOp = { id: '1', type: 'accept', nodeKey: 'n1', status: 'processing' };
        const state = createViewingState({ processingMutation: mutation });
        expect(isMutationProcessing(state)).toBe(true);
      });

      it('should return false when no mutation is processing', () => {
        const state = createViewingState();
        expect(isMutationProcessing(state)).toBe(false);
      });
    });

    describe('getLastMutationError', () => {
      it('should return error message', () => {
        const state = createViewingState({ lastMutationError: 'Failed to apply' });
        expect(getLastMutationError(state)).toBe('Failed to apply');
      });

      it('should return undefined when no error', () => {
        const state = createViewingState();
        expect(getLastMutationError(state)).toBeUndefined();
      });
    });
  });
});

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
} from './pageLifecycleReducer';

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

      expect(result).toEqual({
        phase: 'viewing',
        content: 'Final content',
        title: 'Final title',
        status: ExplanationStatus.Published,
        originalContent: 'Final content', // Should set original
        originalTitle: 'Final title',
        originalStatus: ExplanationStatus.Published,
      });
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

      expect(result).toEqual({
        phase: 'viewing',
        content: 'DB content',
        title: 'DB title',
        status: ExplanationStatus.Draft,
        originalContent: 'DB content',
        originalTitle: 'DB title',
        originalStatus: ExplanationStatus.Draft,
      });
    });
  });

  // ==========================================================================
  // EDIT FLOW: viewing → editing → viewing (revert) OR editing → saving
  // ==========================================================================
  describe('edit flow', () => {
    const viewingState: PageLifecycleState = {
      phase: 'viewing',
      content: 'Original content',
      title: 'Original title',
      status: ExplanationStatus.Published,
      originalContent: 'Original content',
      originalTitle: 'Original title',
      originalStatus: ExplanationStatus.Published,
    };

    it('should transition from viewing to editing on ENTER_EDIT_MODE', () => {
      const action: PageLifecycleAction = { type: 'ENTER_EDIT_MODE' };
      const result = pageLifecycleReducer(viewingState, action);

      expect(result).toEqual({
        phase: 'editing',
        content: 'Original content',
        title: 'Original title',
        status: ExplanationStatus.Published,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: false,
      });
    });

    it('should update content and compute hasUnsavedChanges in editing phase', () => {
      const editingState: PageLifecycleState = {
        phase: 'editing',
        content: 'Original content',
        title: 'Original title',
        status: ExplanationStatus.Published,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: false,
      };

      const action: PageLifecycleAction = {
        type: 'UPDATE_CONTENT',
        content: 'Modified content',
      };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual({
        phase: 'editing',
        content: 'Modified content',
        title: 'Original title',
        status: ExplanationStatus.Draft, // Changed to Draft because Published + changes
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: true,
      });
    });

    it('should update title and compute hasUnsavedChanges in editing phase', () => {
      const editingState: PageLifecycleState = {
        phase: 'editing',
        content: 'Original content',
        title: 'Original title',
        status: ExplanationStatus.Published,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: false,
      };

      const action: PageLifecycleAction = {
        type: 'UPDATE_TITLE',
        title: 'Modified title',
      };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual({
        phase: 'editing',
        content: 'Original content',
        title: 'Modified title',
        status: ExplanationStatus.Draft, // Changed to Draft because Published + changes
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: true,
      });
    });

    it('should NOT change status to Draft if original status was Draft', () => {
      const editingState: PageLifecycleState = {
        phase: 'editing',
        content: 'Original content',
        title: 'Original title',
        status: ExplanationStatus.Draft,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Draft,
        hasUnsavedChanges: false,
      };

      const action: PageLifecycleAction = {
        type: 'UPDATE_CONTENT',
        content: 'Modified content',
      };
      const result = pageLifecycleReducer(editingState, action);

      expect(result.status).toBe(ExplanationStatus.Draft);
      expect(result.hasUnsavedChanges).toBe(true);
    });

    it('should revert to viewing with original values on EXIT_EDIT_MODE', () => {
      const editingState: PageLifecycleState = {
        phase: 'editing',
        content: 'Modified content',
        title: 'Modified title',
        status: ExplanationStatus.Draft,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: true,
      };

      const action: PageLifecycleAction = { type: 'EXIT_EDIT_MODE' };
      const result = pageLifecycleReducer(editingState, action);

      expect(result).toEqual({
        phase: 'viewing',
        content: 'Original content', // REVERTED
        title: 'Original title', // REVERTED
        status: ExplanationStatus.Published, // REVERTED
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
      });
    });

    it('should transition from editing to saving on START_SAVE', () => {
      const editingState: PageLifecycleState = {
        phase: 'editing',
        content: 'Modified content',
        title: 'Modified title',
        status: ExplanationStatus.Draft,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: true,
      };

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
      const editingState: PageLifecycleState = {
        phase: 'editing',
        content: 'Modified content',
        title: 'Modified title',
        status: ExplanationStatus.Draft,
        originalContent: 'Original content',
        originalTitle: 'Original title',
        originalStatus: ExplanationStatus.Published,
        hasUnsavedChanges: true,
      };

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
      const viewingState: PageLifecycleState = {
        phase: 'viewing',
        content: 'Content',
        title: 'Title',
        status: ExplanationStatus.Published,
        originalContent: 'Content',
        originalTitle: 'Title',
        originalStatus: ExplanationStatus.Published,
      };

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
        {
          phase: 'viewing',
          content: 'test',
          title: 'test',
          status: ExplanationStatus.Published,
          originalContent: 'test',
          originalTitle: 'test',
          originalStatus: ExplanationStatus.Published,
        },
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

      const state: PageLifecycleState = {
        phase: 'viewing',
        content: 'test',
        title: 'test',
        status: ExplanationStatus.Published,
        originalContent: 'test',
        originalTitle: 'test',
        originalStatus: ExplanationStatus.Published,
      };
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
        const state: PageLifecycleState = {
          phase: 'editing',
          content: 'test',
          title: 'test',
          status: ExplanationStatus.Published,
          originalContent: 'test',
          originalTitle: 'test',
          originalStatus: ExplanationStatus.Published,
          hasUnsavedChanges: false,
        };
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
        const state: PageLifecycleState = {
          phase: 'viewing',
          content: 'test',
          title: 'title',
          status: ExplanationStatus.Published,
          originalContent: 'test',
          originalTitle: 'title',
          originalStatus: ExplanationStatus.Published,
        };
        expect(getContent(state)).toBe('test');
      });

      it('should return empty string from idle phase', () => {
        expect(getContent({ phase: 'idle' })).toBe('');
      });
    });

    describe('hasUnsavedChanges', () => {
      it('should return true when in editing phase with changes', () => {
        const state: PageLifecycleState = {
          phase: 'editing',
          content: 'modified',
          title: 'test',
          status: ExplanationStatus.Draft,
          originalContent: 'original',
          originalTitle: 'test',
          originalStatus: ExplanationStatus.Published,
          hasUnsavedChanges: true,
        };
        expect(hasUnsavedChanges(state)).toBe(true);
      });

      it('should return false when in editing phase without changes', () => {
        const state: PageLifecycleState = {
          phase: 'editing',
          content: 'test',
          title: 'test',
          status: ExplanationStatus.Published,
          originalContent: 'test',
          originalTitle: 'test',
          originalStatus: ExplanationStatus.Published,
          hasUnsavedChanges: false,
        };
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

    it('should handle edit → cancel (revert) flow', () => {
      // Start in viewing
      let state: PageLifecycleState = {
        phase: 'viewing',
        content: 'Original',
        title: 'Original Title',
        status: ExplanationStatus.Published,
        originalContent: 'Original',
        originalTitle: 'Original Title',
        originalStatus: ExplanationStatus.Published,
      };

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

      // Exit without saving (revert)
      state = pageLifecycleReducer(state, { type: 'EXIT_EDIT_MODE' });
      expect(state.phase).toBe('viewing');
      expect(getContent(state)).toBe('Original'); // REVERTED
      expect(getStatus(state)).toBe(ExplanationStatus.Published); // REVERTED
    });
  });
});

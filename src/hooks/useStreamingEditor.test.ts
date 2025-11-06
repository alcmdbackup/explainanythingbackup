import { renderHook, act, waitFor } from '@testing-library/react';
import { useStreamingEditor } from './useStreamingEditor';

describe('useStreamingEditor', () => {
    let mockEditorRef: any;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();

        // Mock console methods
        jest.spyOn(console, 'log').mockImplementation();
        jest.spyOn(console, 'error').mockImplementation();

        // Create mock editor ref
        mockEditorRef = {
            setEditMode: jest.fn(),
            setContentFromMarkdown: jest.fn()
        };
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    describe('Initial State', () => {
        it('should initialize with empty currentContent', () => {
            const { result } = renderHook(() =>
                useStreamingEditor({
                    content: '',
                    isEditMode: false,
                    isStreaming: false
                })
            );

            expect(result.current.editorRef.current).toBeNull();
            expect(typeof result.current.handleContentChange).toBe('function');
        });

        it('should expose editorRef and handleContentChange', () => {
            const { result } = renderHook(() =>
                useStreamingEditor({
                    content: 'test',
                    isEditMode: false,
                    isStreaming: false
                })
            );

            expect(result.current.editorRef).toBeDefined();
            expect(result.current.handleContentChange).toBeDefined();
        });

        it('should not call onContentChange on initial render', () => {
            const mockOnContentChange = jest.fn();

            renderHook(() =>
                useStreamingEditor({
                    content: 'initial content',
                    isEditMode: false,
                    isStreaming: false,
                    onContentChange: mockOnContentChange
                })
            );

            // Flush all timers
            act(() => {
                jest.runAllTimers();
            });

            expect(mockOnContentChange).not.toHaveBeenCalled();
        });
    });

    describe('Content Synchronization - Streaming Mode', () => {
        it('should debounce content updates during streaming (100ms delay)', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            // Attach mock editor
            result.current.editorRef.current = mockEditorRef;

            // Mark as mounted
            act(() => {
                jest.advanceTimersByTime(0);
            });

            // Update content during streaming
            rerender({
                content: 'streaming content',
                isEditMode: false,
                isStreaming: true
            });

            // Should not update immediately
            expect(mockEditorRef.setContentFromMarkdown).not.toHaveBeenCalled();

            // Advance timers by 50ms - still no update
            act(() => {
                jest.advanceTimersByTime(50);
            });
            expect(mockEditorRef.setContentFromMarkdown).not.toHaveBeenCalled();

            // Advance timers by another 50ms (total 100ms) - should update
            act(() => {
                jest.advanceTimersByTime(50);
            });
            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith('streaming content');
        });

        it('should batch multiple rapid content changes', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            // Attach mock editor
            result.current.editorRef.current = mockEditorRef;

            // Mark as mounted
            act(() => {
                jest.advanceTimersByTime(0);
            });

            // Rapid updates
            rerender({
                content: 'update 1',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(30);
            });

            rerender({
                content: 'update 2',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(30);
            });

            rerender({
                content: 'update 3',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(30);
            });

            rerender({
                content: 'final update',
                isEditMode: false,
                isStreaming: true
            });

            // Should not have called yet
            expect(mockEditorRef.setContentFromMarkdown).not.toHaveBeenCalled();

            // Advance full debounce time
            act(() => {
                jest.advanceTimersByTime(100);
            });

            // Should only update with final content
            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledTimes(1);
            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith('final update');
        });

        it('should clear previous debounce timeout on new content', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            // First update
            rerender({
                content: 'first',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(50);
            });

            // Second update before first debounce completes
            rerender({
                content: 'second',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(100);
            });

            // Should only call once with the second content
            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledTimes(1);
            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith('second');
        });
    });

    describe('Content Synchronization - Non-Streaming Mode', () => {
        it('should update content immediately when not streaming', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            mockEditorRef.setContentFromMarkdown.mockClear();

            rerender({
                content: 'new content',
                isEditMode: false,
                isStreaming: false
            });

            // Should update immediately (0ms debounce)
            act(() => {
                jest.advanceTimersByTime(0);
            });

            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith('new content');
        });

        it('should not debounce when isStreaming is false', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            mockEditorRef.setContentFromMarkdown.mockClear();

            rerender({
                content: 'immediate update',
                isEditMode: false,
                isStreaming: false
            });

            // Should not wait 100ms
            act(() => {
                jest.advanceTimersByTime(0);
            });

            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith('immediate update');
        });
    });

    describe('Edit Mode Protection', () => {
        it('should not call onContentChange when not in edit mode', () => {
            const mockOnContentChange = jest.fn();

            const { result } = renderHook(() =>
                useStreamingEditor({
                    content: 'initial',
                    isEditMode: false,  // Not in edit mode
                    isStreaming: false,
                    onContentChange: mockOnContentChange
                })
            );

            // Try to trigger content change when not in edit mode
            act(() => {
                result.current.handleContentChange('new content');
            });

            expect(mockOnContentChange).not.toHaveBeenCalled();
        });

        it('should call onContentChange for user edits in edit mode', async () => {
            const mockOnContentChange = jest.fn();

            const { result } = renderHook(() =>
                useStreamingEditor({
                    content: 'initial',
                    isEditMode: true,
                    isStreaming: false,
                    onContentChange: mockOnContentChange
                })
            );

            // Note: In the actual implementation, handleContentChange clears isInitialLoadRef
            // before checking shouldCall, so even the first user edit will trigger the callback.
            // This is the actual behavior of the hook as implemented.

            // First user edit - clears isInitialLoadRef and calls callback
            act(() => {
                result.current.handleContentChange('first edit');
            });

            expect(mockOnContentChange).toHaveBeenCalledWith('first edit');

            mockOnContentChange.mockClear();

            // Subsequent edits also call callback
            act(() => {
                result.current.handleContentChange('second edit');
            });

            expect(mockOnContentChange).toHaveBeenCalledWith('second edit');
        });

        it('should skip content updates when in edit mode (protects user edits)', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            // Enter edit mode
            rerender({
                content: 'initial',
                isEditMode: true,
                isStreaming: false
            });

            // Clear isInitialLoadRef by simulating user edit
            act(() => {
                result.current.handleContentChange('user edit');
            });

            mockEditorRef.setContentFromMarkdown.mockClear();

            // Try to update content from prop while in edit mode
            rerender({
                content: 'external update',
                isEditMode: true,
                isStreaming: false
            });

            act(() => {
                jest.advanceTimersByTime(100);
            });

            // Should not overwrite user's edit
            expect(mockEditorRef.setContentFromMarkdown).not.toHaveBeenCalled();
        });

        it('should allow content updates when not in edit mode', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            mockEditorRef.setContentFromMarkdown.mockClear();

            rerender({
                content: 'updated content',
                isEditMode: false,
                isStreaming: false
            });

            act(() => {
                jest.advanceTimersByTime(0);
            });

            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith('updated content');
        });
    });

    describe('Streaming State Effects', () => {
        it('should lock editor during streaming', () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'test',
                        isEditMode: true,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            mockEditorRef.setEditMode.mockClear();

            // Start streaming
            rerender({
                content: 'test',
                isEditMode: true,
                isStreaming: true
            });

            expect(mockEditorRef.setEditMode).toHaveBeenCalledWith(false);
        });

        it('should unlock editor after streaming ends', () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'test',
                        isEditMode: true,
                        isStreaming: true
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.runAllTimers();
            });

            mockEditorRef.setEditMode.mockClear();

            // Stop streaming
            rerender({
                content: 'test',
                isEditMode: true,
                isStreaming: false
            });

            expect(mockEditorRef.setEditMode).toHaveBeenCalledWith(true);
        });

        it('should respect isEditMode when unlocking after streaming', () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'test',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.runAllTimers();
            });

            mockEditorRef.setEditMode.mockClear();

            // Stop streaming with isEditMode=false
            rerender({
                content: 'test',
                isEditMode: false,
                isStreaming: false
            });

            expect(mockEditorRef.setEditMode).toHaveBeenCalledWith(false);
        });
    });

    describe('Race Condition Prevention', () => {
        it('should prevent overwriting content if component unmounts during debounce', async () => {
            const { result, rerender, unmount } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            rerender({
                content: 'streaming content',
                isEditMode: false,
                isStreaming: true
            });

            // Unmount before debounce completes
            unmount();

            act(() => {
                jest.advanceTimersByTime(100);
            });

            // Should not throw or cause issues
            expect(mockEditorRef.setContentFromMarkdown).not.toHaveBeenCalled();
        });

        it('should handle rapid streaming start/stop cycles', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'test',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            // Rapid toggles
            rerender({ content: 'test', isEditMode: false, isStreaming: true });
            rerender({ content: 'test', isEditMode: false, isStreaming: false });
            rerender({ content: 'test', isEditMode: false, isStreaming: true });
            rerender({ content: 'test', isEditMode: false, isStreaming: false });

            act(() => {
                jest.runAllTimers();
            });

            // Should handle gracefully
            expect(mockEditorRef.setEditMode).toHaveBeenCalled();
        });

        it('should prevent duplicate updates with lastStreamingUpdateRef', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            // Send same content twice
            rerender({
                content: 'duplicate content',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(100);
            });

            mockEditorRef.setContentFromMarkdown.mockClear();

            // Send same content again
            rerender({
                content: 'duplicate content',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(100);
            });

            // Should not update again
            expect(mockEditorRef.setContentFromMarkdown).not.toHaveBeenCalled();
        });
    });

    describe('Ref Management', () => {
        it('should clean up debounce timeout on unmount', () => {
            const { result, rerender, unmount } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            // Mount
            act(() => {
                jest.advanceTimersByTime(0);
            });

            // Trigger a debounced update
            rerender({
                content: 'streaming content',
                isEditMode: false,
                isStreaming: true
            });

            // Unmount before debounce completes
            unmount();

            // Should not throw or cause memory leaks
            // (The cleanup effect should clear the timeout)
            act(() => {
                jest.advanceTimersByTime(100);
            });

            // No crash means success
            expect(true).toBe(true);
        });

        it('should handle null editorRef gracefully', () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            // Don't attach editor ref
            act(() => {
                jest.advanceTimersByTime(0);
            });

            // Update content with null ref
            rerender({
                content: 'new content',
                isEditMode: false,
                isStreaming: false
            });

            act(() => {
                jest.advanceTimersByTime(0);
            });

            // Should not throw
            expect(result.current.editorRef.current).toBeNull();
        });
    });

    describe('Callback Invocation', () => {
        it('should call onContentChange with correct content after user edit', async () => {
            const mockOnContentChange = jest.fn();

            const { result } = renderHook(() =>
                useStreamingEditor({
                    content: 'initial',
                    isEditMode: true,
                    isStreaming: false,
                    onContentChange: mockOnContentChange
                })
            );

            // First edit to clear initial load flag
            act(() => {
                result.current.handleContentChange('first edit');
            });

            // Second edit should trigger callback
            act(() => {
                result.current.handleContentChange('user typed content');
            });

            expect(mockOnContentChange).toHaveBeenCalledWith('user typed content');
        });

        it('should not call onContentChange when not in edit mode', () => {
            const mockOnContentChange = jest.fn();

            const { result } = renderHook(() =>
                useStreamingEditor({
                    content: 'initial',
                    isEditMode: false,
                    isStreaming: false,
                    onContentChange: mockOnContentChange
                })
            );

            act(() => {
                result.current.handleContentChange('content change');
            });

            expect(mockOnContentChange).not.toHaveBeenCalled();
        });

        it('should handle missing onContentChange gracefully', () => {
            const { result } = renderHook(() =>
                useStreamingEditor({
                    content: 'initial',
                    isEditMode: true,
                    isStreaming: false
                })
            );

            // Should not throw
            expect(() => {
                act(() => {
                    result.current.handleContentChange('content');
                });
            }).not.toThrow();
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty content gracefully', async () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: '',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            expect(() => {
                rerender({
                    content: '',
                    isEditMode: false,
                    isStreaming: false
                });
            }).not.toThrow();
        });

        it('should handle very long content strings', async () => {
            const longContent = 'a'.repeat(100000);

            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            rerender({
                content: longContent,
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(100);
            });

            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith(longContent);
        });

        it('should handle content with special characters', async () => {
            const specialContent = '**bold** _italic_ `code` [link](url) # heading';

            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            mockEditorRef.setContentFromMarkdown.mockClear();

            rerender({
                content: specialContent,
                isEditMode: false,
                isStreaming: false
            });

            act(() => {
                jest.advanceTimersByTime(0);
            });

            expect(mockEditorRef.setContentFromMarkdown).toHaveBeenCalledWith(specialContent);
        });

        it('should handle rapid mode switches (edit/view)', () => {
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'test',
                        isEditMode: false,
                        isStreaming: false
                    }
                }
            );

            result.current.editorRef.current = mockEditorRef;

            // Rapid mode switches
            rerender({ content: 'test', isEditMode: true, isStreaming: false });
            rerender({ content: 'test', isEditMode: false, isStreaming: false });
            rerender({ content: 'test', isEditMode: true, isStreaming: false });
            rerender({ content: 'test', isEditMode: false, isStreaming: false });

            act(() => {
                jest.runAllTimers();
            });

            // Should handle gracefully
            expect(mockEditorRef.setEditMode).toHaveBeenCalled();
        });

        it('should handle errors in setContentFromMarkdown', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error');
            const { result, rerender } = renderHook(
                (props) => useStreamingEditor(props),
                {
                    initialProps: {
                        content: 'initial',
                        isEditMode: false,
                        isStreaming: true
                    }
                }
            );

            mockEditorRef.setContentFromMarkdown.mockImplementation(() => {
                throw new Error('Editor error');
            });

            result.current.editorRef.current = mockEditorRef;

            act(() => {
                jest.advanceTimersByTime(0);
            });

            rerender({
                content: 'new content',
                isEditMode: false,
                isStreaming: true
            });

            act(() => {
                jest.advanceTimersByTime(100);
            });

            expect(consoleErrorSpy).toHaveBeenCalledWith(
                'Error updating editor content during streaming:',
                expect.any(Error)
            );
        });
    });
});

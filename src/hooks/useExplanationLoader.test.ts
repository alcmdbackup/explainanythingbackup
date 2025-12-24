import { renderHook, act, waitFor } from '@testing-library/react';
import { useExplanationLoader } from './useExplanationLoader';
import {
    getExplanationByIdAction,
    isExplanationSavedByUserAction,
    getTagsForExplanationAction,
    loadFromPineconeUsingExplanationIdAction,
    resolveLinksForDisplayAction
} from '@/actions/actions';
import { ExplanationStatus, TagUIType } from '@/lib/schemas/schemas';
import { logger } from '@/lib/client_utilities';

// Mock all dependencies
jest.mock('@/actions/actions');
jest.mock('@/lib/client_utilities');
jest.mock('@/lib/requestIdContext', () => ({
    RequestIdContext: {
        setClient: jest.fn()
    }
}));

const mockGetExplanationByIdAction = getExplanationByIdAction as jest.MockedFunction<typeof getExplanationByIdAction>;
const mockIsExplanationSavedByUserAction = isExplanationSavedByUserAction as jest.MockedFunction<typeof isExplanationSavedByUserAction>;
const mockGetTagsForExplanationAction = getTagsForExplanationAction as jest.MockedFunction<typeof getTagsForExplanationAction>;
const mockLoadFromPineconeUsingExplanationIdAction = loadFromPineconeUsingExplanationIdAction as jest.MockedFunction<typeof loadFromPineconeUsingExplanationIdAction>;
const mockResolveLinksForDisplayAction = resolveLinksForDisplayAction as jest.MockedFunction<typeof resolveLinksForDisplayAction>;

describe('useExplanationLoader', () => {
    const mockExplanation = {
        id: 123,
        explanation_title: 'Test Explanation',
        content: 'This is test content',
        status: ExplanationStatus.Published,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };

    const mockTags: TagUIType[] = [
        {
            id: 1,
            tag_name: 'beginner',
            tag_description: 'Beginner level',
            presetTagId: null,
            created_at: new Date().toISOString(),
            tag_active_current: true,
            tag_active_initial: true
        },
        {
            id: 2,
            tag_name: 'technical',
            tag_description: 'Technical content',
            presetTagId: null,
            created_at: new Date().toISOString(),
            tag_active_current: true,
            tag_active_initial: false
        }
    ];

    const mockVector = {
        id: 'test-vector-id',
        values: new Array(1536).fill(0.1)
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Default successful mocks
        mockGetExplanationByIdAction.mockResolvedValue({
            ...mockExplanation,
            primary_topic_id: 1,
            timestamp: new Date().toISOString()
        });
        mockIsExplanationSavedByUserAction.mockResolvedValue(true);
        mockGetTagsForExplanationAction.mockResolvedValue({
            success: true,
            data: mockTags,
            error: null
        });
        mockLoadFromPineconeUsingExplanationIdAction.mockResolvedValue({
            success: true,
            data: mockVector,
            error: null
        });
        // Mock resolveLinksForDisplayAction to return content unchanged
        mockResolveLinksForDisplayAction.mockImplementation(async (params) => {
            return (params as { content: string }).content;
        });
    });

    describe('Initial state', () => {
        it('should initialize with default values', () => {
            const { result } = renderHook(() => useExplanationLoader());

            expect(result.current.explanationId).toBeNull();
            expect(result.current.explanationTitle).toBe('');
            expect(result.current.content).toBe('');
            expect(result.current.explanationStatus).toBeNull();
            expect(result.current.explanationVector).toBeNull();
            expect(result.current.systemSavedId).toBeNull();
            expect(result.current.userSaved).toBe(false);
            expect(result.current.isLoading).toBe(false);
            expect(result.current.error).toBeNull();
        });

        it('should expose all setter functions', () => {
            const { result } = renderHook(() => useExplanationLoader());

            expect(typeof result.current.setExplanationId).toBe('function');
            expect(typeof result.current.setExplanationTitle).toBe('function');
            expect(typeof result.current.setContent).toBe('function');
            expect(typeof result.current.setExplanationStatus).toBe('function');
            expect(typeof result.current.setExplanationVector).toBe('function');
            expect(typeof result.current.setSystemSavedId).toBe('function');
            expect(typeof result.current.setUserSaved).toBe('function');
            expect(typeof result.current.setError).toBe('function');
        });

        it('should expose loadExplanation and clearSystemSavedId functions', () => {
            const { result } = renderHook(() => useExplanationLoader());

            expect(typeof result.current.loadExplanation).toBe('function');
            expect(typeof result.current.clearSystemSavedId).toBe('function');
        });

        it('should pass userId to useClientPassRequestId when provided', () => {
            mockUseClientPassRequestId.mockClear();
            renderHook(() => useExplanationLoader({ userId: 'test-user-123' }));

            expect(mockUseClientPassRequestId).toHaveBeenCalledWith('test-user-123');
        });

        it('should use anonymous when userId is not provided', () => {
            mockUseClientPassRequestId.mockClear();
            renderHook(() => useExplanationLoader());

            expect(mockUseClientPassRequestId).toHaveBeenCalledWith('anonymous');
        });
    });

    describe('Setter functions', () => {
        it('should update state when setters are called', () => {
            const { result } = renderHook(() => useExplanationLoader());

            act(() => {
                result.current.setExplanationId(456);
                result.current.setExplanationTitle('New Title');
                result.current.setContent('New Content');
                result.current.setExplanationStatus(ExplanationStatus.Draft);
                result.current.setExplanationVector({ values: [1, 2, 3] });
                result.current.setSystemSavedId(789);
                result.current.setUserSaved(true);
                result.current.setError('Test error');
            });

            expect(result.current.explanationId).toBe(456);
            expect(result.current.explanationTitle).toBe('New Title');
            expect(result.current.content).toBe('New Content');
            expect(result.current.explanationStatus).toBe(ExplanationStatus.Draft);
            expect(result.current.explanationVector).toEqual({ values: [1, 2, 3] });
            expect(result.current.systemSavedId).toBe(789);
            expect(result.current.userSaved).toBe(true);
            expect(result.current.error).toBe('Test error');
        });
    });

    describe('loadExplanation', () => {
        it('should successfully load explanation with all data', async () => {
            const onTagsLoad = jest.fn();
            const onSetOriginalValues = jest.fn();

            const { result } = renderHook(() => useExplanationLoader({
                onTagsLoad,
                onSetOriginalValues
            }));

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            // Verify explanation was loaded (with __requestId from withRequestId wrapper)
            expect(mockGetExplanationByIdAction).toHaveBeenCalledWith(
                expect.objectContaining({ id: 123 })
            );
            expect(result.current.explanationId).toBe(123);
            expect(result.current.explanationTitle).toBe('Test Explanation');
            expect(result.current.content).toBe('This is test content');
            expect(result.current.explanationStatus).toBe(ExplanationStatus.Published);
            expect(result.current.systemSavedId).toBe(123);

            // Verify callbacks were invoked
            expect(onSetOriginalValues).toHaveBeenCalledWith(
                'This is test content',
                'Test Explanation',
                ExplanationStatus.Published
            );
            expect(onTagsLoad).toHaveBeenCalledWith(mockTags);

            // Verify user saved status was checked (with __requestId)
            expect(mockIsExplanationSavedByUserAction).toHaveBeenCalledWith(
                expect.objectContaining({
                    explanationid: 123,
                    userid: 'user-123'
                })
            );
            expect(result.current.userSaved).toBe(true);

            // Verify vector was loaded (with __requestId)
            expect(mockLoadFromPineconeUsingExplanationIdAction).toHaveBeenCalledWith(
                expect.objectContaining({ explanationId: 123 })
            );
            expect(result.current.explanationVector).toEqual(mockVector);

            // Verify loading state
            expect(result.current.isLoading).toBe(false);
            expect(result.current.error).toBeNull();
        });

        it('should handle explanation not found error', async () => {
            mockGetExplanationByIdAction.mockRejectedValue(new Error('Explanation not found'));

            const { result } = renderHook(() => useExplanationLoader());

            await act(async () => {
                await result.current.loadExplanation(999, false, 'user-123');
            });

            expect(result.current.error).toBe('Explanation not found');
            expect(result.current.isLoading).toBe(false);
        });

        it('should handle API errors gracefully', async () => {
            const errorMessage = 'Network error';
            mockGetExplanationByIdAction.mockRejectedValue(new Error(errorMessage));

            const { result } = renderHook(() => useExplanationLoader());

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            expect(result.current.error).toBe(errorMessage);
            expect(result.current.isLoading).toBe(false);
            expect(logger.error).toHaveBeenCalledWith('Failed to load explanation:', {
                error: errorMessage
            });
        });

        it('should clear prompt when clearPrompt is true', async () => {
            const onClearPrompt = jest.fn();

            const { result } = renderHook(() => useExplanationLoader({
                onClearPrompt
            }));

            await act(async () => {
                await result.current.loadExplanation(123, true, 'user-123');
            });

            expect(onClearPrompt).toHaveBeenCalled();
        });

        it('should not clear prompt when clearPrompt is false', async () => {
            const onClearPrompt = jest.fn();

            const { result } = renderHook(() => useExplanationLoader({
                onClearPrompt
            }));

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            expect(onClearPrompt).not.toHaveBeenCalled();
        });

        it('should handle matches parameter correctly', async () => {
            const onMatchesLoad = jest.fn();
            const mockMatches = [
                {
                    explanation_id: 456,
                    topic_id: 1,
                    current_title: 'Match 1',
                    current_content: 'Match content 1',
                    text: 'Match text',
                    ranking: { similarity: 0.95, diversity_score: 0.8 }
                }
            ];

            const { result } = renderHook(() => useExplanationLoader({
                onMatchesLoad
            }));

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123', mockMatches);
            });

            expect(onMatchesLoad).toHaveBeenCalledWith(mockMatches);
        });

        it('should handle missing userid gracefully', async () => {
            const { result } = renderHook(() => useExplanationLoader());

            await act(async () => {
                await result.current.loadExplanation(123, false, null);
            });

            // Should not call isExplanationSavedByUserAction
            expect(mockIsExplanationSavedByUserAction).not.toHaveBeenCalled();
            expect(result.current.userSaved).toBe(false);

            // But should still load explanation successfully
            expect(result.current.explanationId).toBe(123);
            expect(result.current.isLoading).toBe(false);
        });

        it('should handle failed tag loading', async () => {
            const onTagsLoad = jest.fn();
            mockGetTagsForExplanationAction.mockResolvedValue({
                success: false,
                data: null,
                error: { code: 'DATABASE_ERROR', message: 'Failed to fetch tags' }
            });

            const { result } = renderHook(() => useExplanationLoader({
                onTagsLoad
            }));

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            // Should call onTagsLoad with empty array
            expect(onTagsLoad).toHaveBeenCalledWith([]);
            expect(logger.error).toHaveBeenCalledWith('Failed to fetch tags for explanation:', {
                error: { code: 'DATABASE_ERROR', message: 'Failed to fetch tags' }
            });
        });

        it('should handle missing vector gracefully', async () => {
            mockLoadFromPineconeUsingExplanationIdAction.mockResolvedValue({
                success: true,
                data: null,
                error: null
            });

            const { result } = renderHook(() => useExplanationLoader());

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            expect(result.current.explanationVector).toBeNull();
            expect(result.current.isLoading).toBe(false);
        });

        it('should handle vector loading errors', async () => {
            mockLoadFromPineconeUsingExplanationIdAction.mockResolvedValue({
                success: false,
                data: null,
                error: { code: 'NOT_FOUND', message: 'Vector not found' }
            });

            const { result } = renderHook(() => useExplanationLoader());

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            expect(result.current.explanationVector).toBeNull();
            expect(logger.error).toHaveBeenCalledWith('Failed to load explanation vector:', {
                error: { code: 'NOT_FOUND', message: 'Vector not found' },
                explanationId: 123
            });
        });

        it('should handle vector with legacy "vector" field', async () => {
            const legacyVector = {
                vector: new Array(1536).fill(0.2)
            };
            mockLoadFromPineconeUsingExplanationIdAction.mockResolvedValue({
                success: true,
                data: legacyVector as any,
                error: null
            });

            const { result } = renderHook(() => useExplanationLoader());

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            // Should convert to "values" field
            expect(result.current.explanationVector).toEqual({
                vector: legacyVector.vector,
                values: legacyVector.vector
            });
        });

        it('should handle checkUserSaved errors gracefully', async () => {
            mockIsExplanationSavedByUserAction.mockRejectedValue(new Error('Auth error'));

            const { result } = renderHook(() => useExplanationLoader());

            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            // Should set userSaved to false on error
            expect(result.current.userSaved).toBe(false);

            // But should still load explanation successfully
            expect(result.current.explanationId).toBe(123);
            expect(result.current.error).toBeNull();
        });

        it('should set loading state correctly during load', async () => {
            const { result } = renderHook(() => useExplanationLoader());

            // Start loading and wait for completion
            await act(async () => {
                await result.current.loadExplanation(123, false, 'user-123');
            });

            // Loading should be false after completion
            expect(result.current.isLoading).toBe(false);
            expect(result.current.explanationId).toBe(123);
        });
    });

    describe('clearSystemSavedId', () => {
        it('should clear systemSavedId to null', () => {
            const { result } = renderHook(() => useExplanationLoader());

            // Capture functions before act
            const setSavedId = result.current.setSystemSavedId;
            const clearSavedId = result.current.clearSystemSavedId;

            // Set a value first
            act(() => {
                setSavedId(999);
            });

            expect(result.current?.systemSavedId).toBe(999);

            // Clear it
            act(() => {
                clearSavedId();
            });

            expect(result.current?.systemSavedId).toBeNull();
        });
    });

    describe('Callback integration', () => {
        it('should invoke all callbacks when provided', async () => {
            const onTagsLoad = jest.fn();
            const onMatchesLoad = jest.fn();
            const onClearPrompt = jest.fn();
            const onSetOriginalValues = jest.fn();

            const mockMatches = [{
                explanation_id: 456,
                topic_id: 1,
                current_title: 'Match',
                current_content: 'Content',
                text: 'Text',
                ranking: { similarity: 0.9, diversity_score: 0.7 }
            }];

            const { result } = renderHook(() => useExplanationLoader({
                onTagsLoad,
                onMatchesLoad,
                onClearPrompt,
                onSetOriginalValues
            }));

            // Capture function before async operation
            const loadExplanation = result.current.loadExplanation;

            await act(async () => {
                await loadExplanation(123, true, 'user-123', mockMatches);
            });

            expect(onTagsLoad).toHaveBeenCalledWith(mockTags);
            expect(onMatchesLoad).toHaveBeenCalledWith(mockMatches);
            expect(onClearPrompt).toHaveBeenCalled();
            expect(onSetOriginalValues).toHaveBeenCalledWith(
                'This is test content',
                'Test Explanation',
                ExplanationStatus.Published
            );
        });

        it('should not throw errors when callbacks are not provided', async () => {
            const { result } = renderHook(() => useExplanationLoader());

            // Capture function before async operation
            const loadExplanation = result.current.loadExplanation;

            let error: Error | null = null;

            try {
                await act(async () => {
                    await loadExplanation(123, true, 'user-123');
                });
            } catch (err) {
                error = err as Error;
            }

            expect(error).toBeNull();
            expect(result.current?.explanationId).toBe(123);
        });
    });
});

/**
 * Unit tests for Import Actions
 */

// Mock vectorsim to avoid langchain dependencies
jest.mock('@/lib/services/vectorsim', () => ({
    processContentToStoreEmbedding: jest.fn(),
}));

// Mock headers for server actions
jest.mock('next/headers', () => ({
    headers: jest.fn(() => ({
        get: jest.fn(() => 'test-request-id'),
    })),
}));

// Mock import service functions
jest.mock('@/lib/services/importArticle', () => ({
    validateImportContent: jest.fn(),
    detectSource: jest.fn(),
    cleanupAndReformat: jest.fn(),
}));

// Mock topic service
jest.mock('@/lib/services/topics', () => ({
    createTopic: jest.fn(),
}));

// Mock explanation service
jest.mock('@/lib/services/explanations', () => ({
    createExplanation: jest.fn(),
}));

// Mock tag evaluation
jest.mock('@/lib/services/tagEvaluation', () => ({
    evaluateTags: jest.fn(),
}));

// Mock return explanation (applyTagsToExplanation)
jest.mock('@/lib/services/returnExplanation', () => ({
    applyTagsToExplanation: jest.fn(),
}));

// Mock metrics
jest.mock('@/lib/services/metrics', () => ({
    refreshExplanationMetrics: jest.fn(),
}));

import {
    processImport,
    publishImportedArticle,
    detectImportSource,
} from './importActions';
import {
    validateImportContent,
    detectSource,
    cleanupAndReformat,
} from '@/lib/services/importArticle';
import { createTopic } from '@/lib/services/topics';
import { createExplanation } from '@/lib/services/explanations';
import { processContentToStoreEmbedding } from '@/lib/services/vectorsim';
import { evaluateTags } from '@/lib/services/tagEvaluation';
import { applyTagsToExplanation } from '@/lib/services/returnExplanation';
import { refreshExplanationMetrics } from '@/lib/services/metrics';

describe('Import Actions', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('processImport', () => {
        const mockContent = 'Certainly! Here is an explanation of how React hooks work in modern web development with functional components.';
        const mockUserId = 'user-123';

        it('returns success with formatted data on valid input', async () => {
            // Arrange
            (validateImportContent as jest.Mock).mockReturnValue({ isValid: true });
            (detectSource as jest.Mock).mockReturnValue('chatgpt');
            (cleanupAndReformat as jest.Mock).mockResolvedValue({
                title: 'Understanding React Hooks',
                content: '## Introduction\n\nReact Hooks are a powerful feature.',
            });

            // Act
            const result = await processImport(mockContent, mockUserId);

            // Assert
            expect(result.success).toBe(true);
            expect(result.data).toEqual({
                title: 'Understanding React Hooks',
                content: '## Introduction\n\nReact Hooks are a powerful feature.',
                detectedSource: 'chatgpt',
            });
            expect(result.error).toBeNull();
        });

        it('returns error when validation fails', async () => {
            // Arrange
            (validateImportContent as jest.Mock).mockReturnValue({
                isValid: false,
                error: 'Content is too short (minimum 50 characters)',
            });

            // Act
            const result = await processImport('Short', mockUserId);

            // Assert
            expect(result.success).toBe(false);
            expect(result.data).toBeNull();
            expect(result.error).toBeDefined();
            expect(result.error?.message).toContain('too short');
        });

        it('uses provided source when given', async () => {
            // Arrange
            (validateImportContent as jest.Mock).mockReturnValue({ isValid: true });
            (cleanupAndReformat as jest.Mock).mockResolvedValue({
                title: 'Test',
                content: 'Test content',
            });

            // Act
            const result = await processImport(mockContent, mockUserId, 'claude');

            // Assert
            expect(detectSource).not.toHaveBeenCalled();
            expect(result.data?.detectedSource).toBe('claude');
        });

        it('detects source when not provided', async () => {
            // Arrange
            (validateImportContent as jest.Mock).mockReturnValue({ isValid: true });
            (detectSource as jest.Mock).mockReturnValue('gemini');
            (cleanupAndReformat as jest.Mock).mockResolvedValue({
                title: 'Test',
                content: 'Test content',
            });

            // Act
            const result = await processImport(mockContent, mockUserId);

            // Assert
            expect(detectSource).toHaveBeenCalledWith(mockContent);
            expect(result.data?.detectedSource).toBe('gemini');
        });

        it('returns error when cleanupAndReformat throws', async () => {
            // Arrange
            (validateImportContent as jest.Mock).mockReturnValue({ isValid: true });
            (detectSource as jest.Mock).mockReturnValue('other');
            (cleanupAndReformat as jest.Mock).mockRejectedValue(new Error('LLM API error'));

            // Act
            const result = await processImport(mockContent, mockUserId);

            // Assert
            expect(result.success).toBe(false);
            expect(result.data).toBeNull();
            expect(result.error).toBeDefined();
        });
    });

    describe('publishImportedArticle', () => {
        const mockTitle = 'Understanding React Hooks';
        const mockContent = '## Introduction\n\nReact Hooks are a powerful feature.';
        const mockUserId = 'user-456';

        beforeEach(() => {
            // Default successful mocks
            (createTopic as jest.Mock).mockResolvedValue({ id: 100, topic_title: mockTitle });
            (createExplanation as jest.Mock).mockResolvedValue({
                id: 200,
                explanation_title: mockTitle,
                content: mockContent,
            });
            (processContentToStoreEmbedding as jest.Mock).mockResolvedValue(undefined);
            (evaluateTags as jest.Mock).mockResolvedValue({ tags: [], error: null });
            (applyTagsToExplanation as jest.Mock).mockResolvedValue(undefined);
            (refreshExplanationMetrics as jest.Mock).mockResolvedValue(undefined);
        });

        it('returns success with explanationId on successful publish', async () => {
            // Act
            const result = await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert
            expect(result.success).toBe(true);
            expect(result.explanationId).toBe(200);
            expect(result.error).toBeNull();
        });

        it('creates topic with correct title', async () => {
            // Act
            await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert
            expect(createTopic).toHaveBeenCalledWith({
                topic_title: mockTitle,
            });
        });

        it('creates explanation with topic ID and source', async () => {
            // Act
            await publishImportedArticle(mockTitle, mockContent, 'claude', mockUserId);

            // Assert
            expect(createExplanation).toHaveBeenCalledWith(
                expect.objectContaining({
                    explanation_title: mockTitle,
                    content: mockContent,
                    primary_topic_id: 100,
                    source: 'claude',
                    status: 'published',
                })
            );
        });

        it('calls embedding pipeline with formatted content', async () => {
            // Act
            await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert
            expect(processContentToStoreEmbedding).toHaveBeenCalledWith(
                expect.stringContaining(mockTitle),
                200, // explanationId
                100 // topicId
            );
        });

        it('continues on tag evaluation failure (non-blocking)', async () => {
            // Arrange
            (evaluateTags as jest.Mock).mockRejectedValue(new Error('Tag service unavailable'));

            // Act
            const result = await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert - should still succeed
            expect(result.success).toBe(true);
            expect(result.explanationId).toBe(200);
        });

        it('continues on metrics refresh failure (non-blocking)', async () => {
            // Arrange
            (refreshExplanationMetrics as jest.Mock).mockRejectedValue(new Error('Metrics service unavailable'));

            // Act
            const result = await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert - should still succeed
            expect(result.success).toBe(true);
            expect(result.explanationId).toBe(200);
        });

        it('returns error when createTopic fails', async () => {
            // Arrange
            (createTopic as jest.Mock).mockRejectedValue(new Error('Topic creation failed'));

            // Act
            const result = await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert
            expect(result.success).toBe(false);
            expect(result.explanationId).toBeNull();
            expect(result.error).toBeDefined();
        });

        it('returns error when createExplanation fails', async () => {
            // Arrange
            (createExplanation as jest.Mock).mockRejectedValue(new Error('Explanation creation failed'));

            // Act
            const result = await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert
            expect(result.success).toBe(false);
            expect(result.explanationId).toBeNull();
            expect(result.error).toBeDefined();
        });

        it('does not apply tags when evaluation returns error', async () => {
            // Arrange
            (evaluateTags as jest.Mock).mockResolvedValue({ tags: [], error: { message: 'Evaluation failed' } });

            // Act
            await publishImportedArticle(mockTitle, mockContent, 'chatgpt', mockUserId);

            // Assert
            expect(applyTagsToExplanation).not.toHaveBeenCalled();
        });
    });

    describe('detectImportSource', () => {
        it('returns detected source', async () => {
            // Arrange
            (detectSource as jest.Mock).mockReturnValue('chatgpt');

            // Act
            const result = await detectImportSource('Certainly! Here is an explanation...');

            // Assert
            expect(result.source).toBe('chatgpt');
            expect(result.error).toBeNull();
        });

        it('returns "other" on detection error', async () => {
            // Arrange
            (detectSource as jest.Mock).mockImplementation(() => {
                throw new Error('Detection failed');
            });

            // Act
            const result = await detectImportSource('Some content');

            // Assert
            expect(result.source).toBe('other');
            expect(result.error).toBeDefined();
        });

        it('calls detectSource with content', async () => {
            // Arrange
            (detectSource as jest.Mock).mockReturnValue('claude');
            const content = "I'll help you understand this concept.";

            // Act
            await detectImportSource(content);

            // Assert
            expect(detectSource).toHaveBeenCalledWith(content);
        });
    });
});

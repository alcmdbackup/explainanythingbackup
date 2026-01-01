/**
 * Tests for explanationSummarizer service
 * @jest-environment node
 */

import { generateAndSaveExplanationSummary, updateExplanationSummary } from './explanationSummarizer';
import { callOpenAIModel } from './llms';
import { logger } from '../server_utilities';
import { createSupabaseServerClient } from '../utils/supabase/server';

// Mock dependencies
jest.mock('./llms', () => ({
    callOpenAIModel: jest.fn(),
    lighter_model: 'gpt-4.1-nano'
}));

jest.mock('../server_utilities', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../utils/supabase/server', () => ({
    createSupabaseServerClient: jest.fn()
}));

describe('explanationSummarizer', () => {
    let mockSupabase: {
        from: jest.Mock;
        update: jest.Mock;
        eq: jest.Mock;
    };

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup Supabase mock
        mockSupabase = {
            from: jest.fn().mockReturnThis(),
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({ error: null })
        };
        (createSupabaseServerClient as jest.Mock).mockResolvedValue(mockSupabase);
    });

    describe('updateExplanationSummary', () => {
        it('updates explanation with summary data', async () => {
            const summary = {
                summary_teaser: 'This article explains quantum computing fundamentals.',
                meta_description: 'Learn about quantum computing basics and how qubits work.',
                keywords: ['quantum', 'computing', 'qubits', 'superposition', 'entanglement']
            };

            await updateExplanationSummary(123, summary);

            expect(mockSupabase.from).toHaveBeenCalledWith('explanations');
            expect(mockSupabase.update).toHaveBeenCalledWith({
                summary_teaser: summary.summary_teaser,
                meta_description: summary.meta_description,
                keywords: summary.keywords
            });
            expect(mockSupabase.eq).toHaveBeenCalledWith('id', 123);
        });

        it('throws error when update fails', async () => {
            mockSupabase.eq.mockResolvedValue({ error: new Error('Database error') });

            const summary = {
                summary_teaser: 'Test teaser',
                meta_description: 'Test description',
                keywords: ['test', 'keywords', 'array', 'five', 'items']
            };

            await expect(updateExplanationSummary(123, summary))
                .rejects.toThrow('Database error');
        });
    });

    describe('generateAndSaveExplanationSummary', () => {
        it('generates valid summary from article content', async () => {
            const validResponse = JSON.stringify({
                summary_teaser: 'This article explains how photosynthesis works in plants, converting sunlight into chemical energy.',
                meta_description: 'Learn about photosynthesis, the process plants use to convert sunlight, water, and CO2 into glucose.',
                keywords: ['photosynthesis', 'plants', 'sunlight', 'chlorophyll', 'energy']
            });

            (callOpenAIModel as jest.Mock).mockResolvedValue(validResponse);

            await generateAndSaveExplanationSummary(
                123,
                'Photosynthesis Explained',
                'Photosynthesis is the process by which plants convert sunlight into energy...',
                'user123'
            );

            expect(callOpenAIModel).toHaveBeenCalledWith(
                expect.stringContaining('Photosynthesis Explained'),
                'explanation_summarization',
                'user123',
                'gpt-4.1-nano',
                false,
                null,
                expect.any(Object),
                'ExplanationSummary'
            );

            expect(mockSupabase.update).toHaveBeenCalledWith({
                summary_teaser: expect.stringContaining('photosynthesis'),
                meta_description: expect.stringContaining('photosynthesis'),
                keywords: expect.arrayContaining(['photosynthesis'])
            });

            expect(logger.info).toHaveBeenCalledWith(
                'Generated explanation summary',
                expect.objectContaining({
                    explanationId: 123,
                    keywordCount: 5
                })
            );
        });

        it('handles LLM API errors gracefully (fire-and-forget)', async () => {
            (callOpenAIModel as jest.Mock).mockRejectedValue(new Error('OpenAI API error'));

            // Should not throw
            await generateAndSaveExplanationSummary(
                123,
                'Test Title',
                'Test content',
                'user123'
            );

            expect(logger.error).toHaveBeenCalledWith(
                'Failed to generate explanation summary',
                expect.objectContaining({
                    explanationId: 123,
                    error: 'OpenAI API error'
                })
            );

            // Should not call update
            expect(mockSupabase.update).not.toHaveBeenCalled();
        });

        it('handles malformed JSON gracefully', async () => {
            (callOpenAIModel as jest.Mock).mockResolvedValue('not valid json');

            // Should not throw
            await generateAndSaveExplanationSummary(
                123,
                'Test Title',
                'Test content',
                'user123'
            );

            expect(logger.error).toHaveBeenCalled();
            expect(mockSupabase.update).not.toHaveBeenCalled();
        });

        it('handles schema validation failures gracefully', async () => {
            // Missing required keywords array
            const invalidResponse = JSON.stringify({
                summary_teaser: 'Short teaser text that is too short', // Too short (< 50 chars)
                meta_description: 'Short', // Too short
                keywords: ['one'] // Not enough keywords
            });

            (callOpenAIModel as jest.Mock).mockResolvedValue(invalidResponse);

            // Should not throw
            await generateAndSaveExplanationSummary(
                123,
                'Test Title',
                'Test content',
                'user123'
            );

            expect(logger.warn).toHaveBeenCalledWith(
                'Summary schema validation failed',
                expect.objectContaining({
                    explanationId: 123,
                    errors: expect.any(Array)
                })
            );

            expect(mockSupabase.update).not.toHaveBeenCalled();
        });

        it('truncates long content to 4000 characters', async () => {
            const longContent = 'a'.repeat(10000);
            const validResponse = JSON.stringify({
                summary_teaser: 'This is a summary teaser that is long enough to pass validation requirements.',
                meta_description: 'This is a meta description that is also long enough to pass validation.',
                keywords: ['word1', 'word2', 'word3', 'word4', 'word5']
            });

            (callOpenAIModel as jest.Mock).mockResolvedValue(validResponse);

            await generateAndSaveExplanationSummary(
                123,
                'Test Title',
                longContent,
                'user123'
            );

            // Verify prompt contains truncated content
            const callArgs = (callOpenAIModel as jest.Mock).mock.calls[0];
            const prompt = callArgs[0];
            expect(prompt.length).toBeLessThan(longContent.length + 500); // Account for prompt template
        });

        it('handles database update errors gracefully', async () => {
            const validResponse = JSON.stringify({
                summary_teaser: 'This article explains the fundamentals of machine learning algorithms.',
                meta_description: 'Learn about machine learning basics and how algorithms learn from data.',
                keywords: ['machine', 'learning', 'algorithms', 'data', 'training']
            });

            (callOpenAIModel as jest.Mock).mockResolvedValue(validResponse);
            mockSupabase.eq.mockResolvedValue({ error: new Error('DB write failed') });

            // Should not throw
            await generateAndSaveExplanationSummary(
                123,
                'Test Title',
                'Test content',
                'user123'
            );

            expect(logger.error).toHaveBeenCalledWith(
                'Failed to generate explanation summary',
                expect.objectContaining({
                    explanationId: 123,
                    error: 'DB write failed'
                })
            );
        });
    });
});

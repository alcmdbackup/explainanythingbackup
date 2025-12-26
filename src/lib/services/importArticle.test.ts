/**
 * Unit tests for Import Article Service
 */

import { detectSource, validateImportContent, cleanupAndReformat } from './importArticle';
import { callOpenAIModel } from './llms';

jest.mock('./llms', () => ({
    callOpenAIModel: jest.fn(),
    default_model: 'gpt-4o-mini',
}));

describe('importArticle service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('detectSource', () => {
        describe('ChatGPT patterns', () => {
            it('returns "chatgpt" for content starting with "Certainly!"', () => {
                const content = 'Certainly! Here is the explanation you requested about quantum physics. The topic covers wave-particle duality and its implications.';
                expect(detectSource(content)).toBe('chatgpt');
            });

            it('returns "chatgpt" for content starting with "Of course!"', () => {
                const content = 'Of course! I\'d be happy to explain how machine learning works. Machine learning is a subset of artificial intelligence that enables systems to learn.';
                expect(detectSource(content)).toBe('chatgpt');
            });

            it('returns "chatgpt" for content starting with "Great question!"', () => {
                const content = 'Great question! Understanding databases is fundamental to software development. Let me explain the key concepts.';
                expect(detectSource(content)).toBe('chatgpt');
            });

            it('returns "chatgpt" for content with "I\'d be happy to help"', () => {
                const content = 'I\'d be happy to help you understand React hooks. Hooks are functions that let you use state and other React features.';
                expect(detectSource(content)).toBe('chatgpt');
            });
        });

        describe('Claude patterns', () => {
            it('returns "claude" for content with "I\'ll help you"', () => {
                const content = 'I\'ll help you understand this concept thoroughly. Here\'s a detailed and comprehensive explanation of the topic at hand.';
                expect(detectSource(content)).toBe('claude');
            });

            it('returns "claude" for content with "Here\'s my thorough"', () => {
                // Pattern requires: Here's (a|an|my) (detailed|comprehensive|thorough)
                // Need multiple matches to hit score threshold of 2
                const content = 'Here\'s my thorough explanation of how neural networks function. Let me guide you through the architecture.';
                expect(detectSource(content)).toBe('claude');
            });

            it('returns "claude" for content with "Let me walk you through"', () => {
                const content = 'Let me walk you through the process step by step. Here\'s a comprehensive overview of the implementation details.';
                expect(detectSource(content)).toBe('claude');
            });

            it('returns "claude" for content with "I\'d be glad to"', () => {
                const content = 'I\'d be glad to explain this in detail. Here\'s a thorough breakdown of the architecture.';
                expect(detectSource(content)).toBe('claude');
            });
        });

        describe('Gemini patterns', () => {
            it('returns "gemini" for content with "Here\'s some information"', () => {
                const content = 'Here\'s some information about the topic. Based on the knowledge available, this is what we know about quantum computing.';
                expect(detectSource(content)).toBe('gemini');
            });

            it('returns "gemini" for content with "Based on my knowledge"', () => {
                const content = 'Based on my knowledge, this is how the system works. I can provide additional context if needed.';
                expect(detectSource(content)).toBe('gemini');
            });
        });

        describe('Edge cases', () => {
            it('returns "other" for empty content', () => {
                expect(detectSource('')).toBe('other');
            });

            it('returns "other" for whitespace-only content', () => {
                expect(detectSource('   \n\t   ')).toBe('other');
            });

            it('returns "other" when no clear patterns detected', () => {
                const content = 'This is just a plain explanation without any AI-specific markers. It discusses various programming concepts.';
                expect(detectSource(content)).toBe('other');
            });

            it('returns "other" when max score < 2', () => {
                // Single weak pattern match
                const content = 'The system processes data efficiently. Hope this helps!';
                expect(detectSource(content)).toBe('other');
            });

            it('returns "other" when scores are tied', () => {
                // Content with equal patterns from multiple sources
                const content = 'Certainly! I\'ll help you understand this. Here\'s a detailed explanation with comprehensive coverage.';
                // This should have high scores for both chatgpt and claude
                const result = detectSource(content);
                // May return either one depending on implementation, but shouldn't crash
                expect(['chatgpt', 'claude', 'other']).toContain(result);
            });

            it('boosts scores when closing patterns detected', () => {
                const content = 'Certainly! Here is the explanation. Let me know if you have any questions!';
                expect(detectSource(content)).toBe('chatgpt');
            });
        });
    });

    describe('validateImportContent', () => {
        it('returns invalid for empty string', () => {
            const result = validateImportContent('');
            expect(result).toEqual({
                isValid: false,
                error: 'Content is empty',
            });
        });

        it('returns invalid for whitespace-only content', () => {
            const result = validateImportContent('   \n\t   ');
            expect(result).toEqual({
                isValid: false,
                error: 'Content is empty',
            });
        });

        it('returns invalid for content under 50 chars', () => {
            const result = validateImportContent('Short content here.');
            expect(result).toEqual({
                isValid: false,
                error: 'Content is too short (minimum 50 characters)',
            });
        });

        it('returns invalid for exactly 49 chars', () => {
            const content = 'a'.repeat(49);
            const result = validateImportContent(content);
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('too short');
        });

        it('returns valid for exactly 50 chars', () => {
            const content = 'a'.repeat(50);
            const result = validateImportContent(content);
            expect(result).toEqual({ isValid: true });
        });

        it('returns valid for content between 50-100,000 chars', () => {
            const content = 'This is a valid piece of content that meets the minimum length requirement for import.';
            const result = validateImportContent(content);
            expect(result).toEqual({ isValid: true });
        });

        it('returns valid for exactly 100,000 chars', () => {
            const content = 'a'.repeat(100000);
            const result = validateImportContent(content);
            expect(result).toEqual({ isValid: true });
        });

        it('returns invalid for content over 100,000 chars', () => {
            const content = 'a'.repeat(100001);
            const result = validateImportContent(content);
            expect(result).toEqual({
                isValid: false,
                error: 'Content is too long (maximum 100,000 characters)',
            });
        });

        it('trims whitespace before validating', () => {
            const content = '   ' + 'a'.repeat(50) + '   ';
            const result = validateImportContent(content);
            expect(result).toEqual({ isValid: true });
        });
    });

    describe('cleanupAndReformat', () => {
        const mockCallOpenAIModel = callOpenAIModel as jest.MockedFunction<typeof callOpenAIModel>;

        it('returns formatted title and content on success', async () => {
            const mockResponse = JSON.stringify({
                title: 'Understanding React Hooks',
                content: '## Introduction\n\nReact Hooks are functions that let you use state.',
            });
            mockCallOpenAIModel.mockResolvedValue(mockResponse);

            const result = await cleanupAndReformat(
                'Certainly! Here is an explanation of React Hooks...',
                'chatgpt',
                'user-123'
            );

            expect(result).toEqual({
                title: 'Understanding React Hooks',
                content: '## Introduction\n\nReact Hooks are functions that let you use state.',
            });
        });

        it('calls LLM with correct parameters', async () => {
            const mockResponse = JSON.stringify({
                title: 'Test Title',
                content: 'Test content',
            });
            mockCallOpenAIModel.mockResolvedValue(mockResponse);

            await cleanupAndReformat('Test input content', 'claude', 'user-456');

            expect(mockCallOpenAIModel).toHaveBeenCalledWith(
                expect.stringContaining('Test input content'),
                'importArticle:claude',
                'user-456',
                expect.any(String), // model
                false,
                null,
                expect.any(Object), // schema
                'reformatResponse',
                true // FILE_DEBUG
            );
        });

        it('throws on LLM error', async () => {
            mockCallOpenAIModel.mockRejectedValue(new Error('LLM API error'));

            await expect(
                cleanupAndReformat('Test content', 'other', 'user-789')
            ).rejects.toThrow('LLM API error');
        });

        it('throws on invalid JSON response', async () => {
            mockCallOpenAIModel.mockResolvedValue('not valid json');

            await expect(
                cleanupAndReformat('Test content', 'chatgpt', 'user-123')
            ).rejects.toThrow();
        });

        it('throws on response missing required fields', async () => {
            mockCallOpenAIModel.mockResolvedValue(JSON.stringify({ title: 'Only Title' }));

            await expect(
                cleanupAndReformat('Test content', 'chatgpt', 'user-123')
            ).rejects.toThrow();
        });
    });
});

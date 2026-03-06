// Unit tests for sourceSummarizer service — summarization, verbatim fast-path, and truncation fallback.

jest.mock('@/lib/services/llms', () => ({
  callLLM: jest.fn(),
  LIGHTER_MODEL: 'gpt-4.1-nano',
}));

jest.mock('@/lib/server_utilities', () => ({
  logger: { info: jest.fn(), error: jest.fn() },
}));

jest.mock('./sourceFetcher', () => ({
  countWords: jest.fn((s: string) => s.split(/\s+/).filter(Boolean).length),
}));

import { summarizeSourceContent } from './sourceSummarizer';
import { callLLM } from '@/lib/services/llms';
import { logger } from '@/lib/server_utilities';

const mockCallLLM = callLLM as jest.MockedFunction<typeof callLLM>;

describe('sourceSummarizer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('summarizeSourceContent', () => {
    // ── Verbatim fast-path ──────────────────────────────────────

    it('should return content verbatim when word count <= maxWords', async () => {
      const result = await summarizeSourceContent('short text', 3000, 'user1');
      expect(result).toEqual({
        summarized: 'short text',
        isVerbatim: true,
        originalLength: 2,
      });
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    it('should return content verbatim when word count equals maxWords exactly', async () => {
      const content = Array(10).fill('word').join(' ');
      const result = await summarizeSourceContent(content, 10, 'user1');
      expect(result.isVerbatim).toBe(true);
      expect(mockCallLLM).not.toHaveBeenCalled();
    });

    // ── Successful summarization ────────────────────────────────

    it('should call LLM and return summary for long content', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockResolvedValue('This is the summary.');

      const result = await summarizeSourceContent(longContent, 3000, 'user1');

      expect(result.isVerbatim).toBe(false);
      expect(result.summarized).toBe('This is the summary.');
      expect(result.originalLength).toBe(5000);
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it('should pass LIGHTER_MODEL to callLLM', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockResolvedValue('summary');

      await summarizeSourceContent(longContent, 3000, 'user1');

      expect(mockCallLLM).toHaveBeenCalledWith(
        expect.stringContaining('SOURCE CONTENT:'),
        'source_summarization',
        'user1',
        'gpt-4.1-nano',
        false,
        null,
        null,
        null,
      );
    });

    it('should log start and completion info', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockResolvedValue('summary result');

      await summarizeSourceContent(longContent, 3000, 'user1');

      expect(logger.info).toHaveBeenCalledWith(
        'summarizeSourceContent: Starting',
        expect.objectContaining({ originalLength: 5000, maxWords: 3000 }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        'summarizeSourceContent: Complete',
        expect.objectContaining({ originalLength: 5000 }),
      );
    });

    // ── Empty LLM response fallback ─────────────────────────────

    it('should truncate when LLM returns empty string', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockResolvedValue('');

      const result = await summarizeSourceContent(longContent, 3000, 'user1');

      expect(result.isVerbatim).toBe(false);
      expect(result.summarized.endsWith('...')).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        'summarizeSourceContent: LLM call returned empty',
      );
    });

    it('should truncate when LLM returns null', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockResolvedValue(null as unknown as string);

      const result = await summarizeSourceContent(longContent, 3000, 'user1');

      expect(result.isVerbatim).toBe(false);
      expect(result.summarized.endsWith('...')).toBe(true);
    });

    it('should truncate when LLM returns only whitespace', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockResolvedValue('   \n  ');

      const result = await summarizeSourceContent(longContent, 3000, 'user1');
      expect(result.isVerbatim).toBe(false);
      expect(result.summarized.endsWith('...')).toBe(true);
    });

    // ── Error fallback ──────────────────────────────────────────

    it('should truncate on LLM error', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockRejectedValue(new Error('API timeout'));

      const result = await summarizeSourceContent(longContent, 3000, 'user1');

      expect(result.isVerbatim).toBe(false);
      expect(result.summarized.endsWith('...')).toBe(true);
      expect(result.originalLength).toBe(5000);
      expect(logger.error).toHaveBeenCalledWith(
        'summarizeSourceContent: Error',
        expect.objectContaining({ error: 'API timeout' }),
      );
    });

    it('should handle non-Error exceptions in error fallback', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockRejectedValue('string error');

      const result = await summarizeSourceContent(longContent, 3000, 'user1');

      expect(result.isVerbatim).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        'summarizeSourceContent: Error',
        expect.objectContaining({ error: 'Unknown error' }),
      );
    });

    // ── Default maxWords ────────────────────────────────────────

    it('should use default maxWords of 3000', async () => {
      // 2999 words — should be verbatim with default
      const content = Array(2999).fill('word').join(' ');
      const result = await summarizeSourceContent(content, undefined as unknown as number, 'user1');
      // Default is 3000, 2999 <= 3000 → verbatim
      expect(result.isVerbatim).toBe(true);
    });

    // ── Prompt content ──────────────────────────────────────────

    it('should include content and maxWords in the LLM prompt', async () => {
      const longContent = Array(5000).fill('word').join(' ');
      mockCallLLM.mockResolvedValue('summary');

      await summarizeSourceContent(longContent, 2000, 'user1');

      const prompt = mockCallLLM.mock.calls[0][0] as string;
      expect(prompt).toContain('approximately 2000 words');
      expect(prompt).toContain(longContent);
    });
  });
});

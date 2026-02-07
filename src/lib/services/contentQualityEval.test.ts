// Unit tests for content quality eval service.
// Tests prompt construction and schema parsing with mocked LLM.

import { evaluateContentQuality } from './contentQualityEval';
import type { ContentQualityDimension } from '@/lib/schemas/schemas';

// Mock callLLM
jest.mock('./llms', () => ({
  callLLM: jest.fn(),
  LIGHTER_MODEL: 'gpt-4.1-nano',
}));

// Mock supabase (not needed for evaluateContentQuality, but for evaluateAndSaveContentQuality)
jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));

import { callLLM } from './llms';

const mockCallOpenAI = callLLM as jest.MockedFunction<typeof callLLM>;

describe('evaluateContentQuality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns parsed scores for valid LLM response', async () => {
    const mockResponse = JSON.stringify({
      scores: [
        { dimension: 'clarity', score: 0.8, rationale: 'Clear and easy to understand throughout.' },
        { dimension: 'structure', score: 0.7, rationale: 'Well organized with logical flow.' },
        { dimension: 'overall', score: 0.75, rationale: 'Good quality writing overall.' },
      ],
    });

    mockCallOpenAI.mockResolvedValueOnce(mockResponse);

    const result = await evaluateContentQuality(
      42,
      'Test Article',
      'Some test content about programming.',
      'test-user',
      ['clarity', 'structure', 'overall'],
    );

    expect(result).not.toBeNull();
    expect(result!.scores).toHaveLength(3);
    expect(result!.scores[0].dimension).toBe('clarity');
    expect(result!.scores[0].score).toBe(0.8);
  });

  it('returns null when LLM returns empty response', async () => {
    mockCallOpenAI.mockResolvedValueOnce('');

    const result = await evaluateContentQuality(
      42, 'Test', 'Content', 'user',
    );

    expect(result).toBeNull();
  });

  it('returns null when LLM returns invalid JSON', async () => {
    mockCallOpenAI.mockResolvedValueOnce('not json');

    const result = await evaluateContentQuality(
      42, 'Test', 'Content', 'user',
    );

    expect(result).toBeNull();
  });

  it('returns null when schema validation fails', async () => {
    const invalidResponse = JSON.stringify({
      scores: [
        { dimension: 'invalid_dim', score: 2.0, rationale: 'x' },
      ],
    });

    mockCallOpenAI.mockResolvedValueOnce(invalidResponse);

    const result = await evaluateContentQuality(
      42, 'Test', 'Content', 'user',
    );

    expect(result).toBeNull();
  });

  it('returns null when LLM throws', async () => {
    mockCallOpenAI.mockRejectedValueOnce(new Error('API error'));

    const result = await evaluateContentQuality(
      42, 'Test', 'Content', 'user',
    );

    expect(result).toBeNull();
  });

  it('passes correct call_source to LLM', async () => {
    const mockResponse = JSON.stringify({
      scores: [{ dimension: 'overall', score: 0.5, rationale: 'Average quality writing.' }],
    });
    mockCallOpenAI.mockResolvedValueOnce(mockResponse);

    await evaluateContentQuality(42, 'Test', 'Content', 'user', ['overall']);

    expect(mockCallOpenAI).toHaveBeenCalledWith(
      expect.stringContaining('OVERALL'),
      'content_quality_eval',
      'user',
      'gpt-4.1-nano',
      false,
      null,
      expect.anything(),
      'ContentQualityEvalResponse',
    );
  });

  it('uses default dimensions when none specified', async () => {
    const mockResponse = JSON.stringify({
      scores: [
        { dimension: 'clarity', score: 0.7, rationale: 'Clear writing throughout the article.' },
        { dimension: 'structure', score: 0.6, rationale: 'Reasonable structure.' },
        { dimension: 'engagement', score: 0.5, rationale: 'Somewhat engaging.' },
        { dimension: 'overall', score: 0.6, rationale: 'Adequate quality.' },
      ],
    });
    mockCallOpenAI.mockResolvedValueOnce(mockResponse);

    const result = await evaluateContentQuality(42, 'Test', 'Content', 'user');

    // Default is 4 dimensions
    expect(result).not.toBeNull();
    expect(result!.scores).toHaveLength(4);

    // Prompt should contain all 4 default dimension criteria
    const prompt = mockCallOpenAI.mock.calls[0][0];
    expect(prompt).toContain('CLARITY');
    expect(prompt).toContain('STRUCTURE');
    expect(prompt).toContain('ENGAGEMENT');
    expect(prompt).toContain('OVERALL');
  });

  it('truncates long content in prompt', async () => {
    const longContent = 'x'.repeat(10000);
    const mockResponse = JSON.stringify({
      scores: [{ dimension: 'overall', score: 0.5, rationale: 'Average quality writing.' }],
    });
    mockCallOpenAI.mockResolvedValueOnce(mockResponse);

    await evaluateContentQuality(42, 'Test', longContent, 'user', ['overall']);

    const prompt = mockCallOpenAI.mock.calls[0][0];
    // Content should be truncated to 6000 chars
    expect(prompt.length).toBeLessThan(longContent.length);
  });
});

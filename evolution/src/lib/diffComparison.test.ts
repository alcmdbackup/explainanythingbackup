// Unit tests for diff-based comparison with direction reversal bias mitigation.
// Tests internal helpers via the public compareWithDiff() API.

// Mock ESM dependencies to avoid Jest/ESM issues.
// Both unified and remark-parse must be mocked since they are ESM-only and
// diffComparison.ts uses dynamic import() for them.
jest.mock('unified', () => ({
  unified: () => ({
    use: () => ({
      parse: (text: string) => ({
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }],
      }),
    }),
  }),
}));

jest.mock('remark-parse', () => ({
  default: {},
}));

jest.mock('@/editorFiles/markdownASTdiff/markdownASTdiff', () => {
  let callCount = 0;
  return {
    RenderCriticMarkupFromMDAstDiff: jest.fn().mockImplementation(() => {
      callCount++;
      // Even calls = forward diff, odd calls = reverse diff
      if (callCount % 2 === 1) {
        return 'Some text {--old phrase--}{++new phrase++} more text';
      }
      return 'Some text {--new phrase--}{++old phrase++} more text';
    }),
    __resetCallCount: () => { callCount = 0; },
  };
});

// Import after mocks are set up
import { compareWithDiff } from './diffComparison';
import { RenderCriticMarkupFromMDAstDiff } from '@/editorFiles/markdownASTdiff/markdownASTdiff';

beforeEach(() => {
  const mod = jest.requireMock('@/editorFiles/markdownASTdiff/markdownASTdiff') as {
    RenderCriticMarkupFromMDAstDiff: jest.Mock;
    __resetCallCount: () => void;
  };
  mod.__resetCallCount();
  // Reset and restore the default mock implementation (mockClear doesn't undo mockReturnValue)
  mod.RenderCriticMarkupFromMDAstDiff.mockReset();
  let callCount = 0;
  mod.RenderCriticMarkupFromMDAstDiff.mockImplementation(() => {
    callCount++;
    if (callCount % 2 === 1) {
      return 'Some text {--old phrase--}{++new phrase++} more text';
    }
    return 'Some text {--new phrase--}{++old phrase++} more text';
  });
});

describe('parseDiffVerdict (via compareWithDiff)', () => {
  it('parses ACCEPT from LLM response', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('I think we should ACCEPT these changes')
      .mockResolvedValueOnce('These changes should be REJECTED');
    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('ACCEPT');
  });

  it('parses REJECT from LLM response', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('REJECT')
      .mockResolvedValueOnce('ACCEPT');
    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('REJECT');
  });
});

describe('interpretDirectionReversal (via compareWithDiff)', () => {
  it('returns ACCEPT when forward=ACCEPT, reverse=REJECT', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('ACCEPT')  // forward pass
      .mockResolvedValueOnce('REJECT'); // reverse pass
    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('ACCEPT');
    expect(result.confidence).toBe(1.0);
  });

  it('returns REJECT when forward=REJECT, reverse=ACCEPT', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('REJECT')
      .mockResolvedValueOnce('ACCEPT');
    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('REJECT');
    expect(result.confidence).toBe(1.0);
  });

  it('returns UNSURE when both passes ACCEPT (accept bias)', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('ACCEPT')
      .mockResolvedValueOnce('ACCEPT');
    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('UNSURE');
    expect(result.confidence).toBe(0.5);
  });

  it('returns UNSURE when both passes REJECT (reject bias)', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('REJECT')
      .mockResolvedValueOnce('REJECT');
    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('UNSURE');
    expect(result.confidence).toBe(0.5);
  });

  it('returns UNSURE when forward is UNSURE', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('I am not sure')
      .mockResolvedValueOnce('REJECT');
    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('UNSURE');
    expect(result.confidence).toBe(0.3);
  });
});

describe('compareWithDiff', () => {
  it('returns ACCEPT when forward=ACCEPT, reverse=REJECT', async () => {
    const callLLM = jest.fn()
      .mockResolvedValueOnce('ACCEPT')  // forward pass
      .mockResolvedValueOnce('REJECT'); // reverse pass

    const result = await compareWithDiff('# Before\n\nOld text.', '# After\n\nNew text.', callLLM);
    expect(result.verdict).toBe('ACCEPT');
    expect(result.confidence).toBe(1.0);
    expect(callLLM).toHaveBeenCalledTimes(2);
  });

  it('returns UNSURE with 0 changes when diff has no CriticMarkup', async () => {
    (RenderCriticMarkupFromMDAstDiff as jest.Mock).mockReturnValue('No changes here');
    const callLLM = jest.fn();

    const result = await compareWithDiff('# Same\n\nText.', '# Same\n\nText.', callLLM);
    expect(result.verdict).toBe('UNSURE');
    expect(result.changesFound).toBe(0);
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('generates CriticMarkup diff with correct direction', async () => {
    const callLLM = jest.fn().mockResolvedValue('ACCEPT');
    await compareWithDiff('# Before\n\nOld.', '# After\n\nNew.', callLLM);

    // RenderCriticMarkupFromMDAstDiff called twice (forward + reverse)
    expect(RenderCriticMarkupFromMDAstDiff).toHaveBeenCalledTimes(2);
  });

  it('prompt contains no edit context — only CriticMarkup diff + generic criteria', async () => {
    const callLLM = jest.fn().mockResolvedValue('ACCEPT');
    await compareWithDiff('# Before\n\nOld.', '# After\n\nNew.', callLLM);

    const forwardPrompt = callLLM.mock.calls[0][0] as string;
    // Prompt should contain CriticMarkup notation explanation
    expect(forwardPrompt).toContain('{--deleted text--}');
    expect(forwardPrompt).toContain('{++inserted text++}');
    expect(forwardPrompt).toContain('Evaluation Criteria');
    // Prompt should NOT contain any edit target or dimension info
    expect(forwardPrompt).not.toContain('Weakness to Fix');
    expect(forwardPrompt).not.toContain('dimension');
    expect(forwardPrompt).not.toContain('critique');
  });
});

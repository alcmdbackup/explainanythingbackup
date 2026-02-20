// Unit tests for diff-based comparison with direction reversal bias mitigation.

import {
  buildDiffJudgePrompt,
  parseDiffVerdict,
  interpretDirectionReversal,
} from './diffComparison';

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

describe('parseDiffVerdict', () => {
  it('parses ACCEPT', () => {
    expect(parseDiffVerdict('ACCEPT')).toBe('ACCEPT');
    expect(parseDiffVerdict('I think we should ACCEPT these changes')).toBe('ACCEPT');
  });

  it('parses REJECT', () => {
    expect(parseDiffVerdict('REJECT')).toBe('REJECT');
    expect(parseDiffVerdict('These changes should be REJECTED')).toBe('REJECT');
  });

  it('parses UNSURE for ambiguous responses', () => {
    expect(parseDiffVerdict('I am not sure about these changes')).toBe('UNSURE');
    expect(parseDiffVerdict('UNSURE')).toBe('UNSURE');
    expect(parseDiffVerdict('')).toBe('UNSURE');
  });
});

describe('interpretDirectionReversal', () => {
  it('returns ACCEPT when forward=ACCEPT, reverse=REJECT', () => {
    const result = interpretDirectionReversal('ACCEPT', 'REJECT', 3);
    expect(result).toEqual({ verdict: 'ACCEPT', confidence: 1.0, changesFound: 3 });
  });

  it('returns REJECT when forward=REJECT, reverse=ACCEPT', () => {
    const result = interpretDirectionReversal('REJECT', 'ACCEPT', 5);
    expect(result).toEqual({ verdict: 'REJECT', confidence: 1.0, changesFound: 5 });
  });

  it('returns UNSURE when both passes ACCEPT (accept bias)', () => {
    const result = interpretDirectionReversal('ACCEPT', 'ACCEPT', 2);
    expect(result).toEqual({ verdict: 'UNSURE', confidence: 0.5, changesFound: 2 });
  });

  it('returns UNSURE when both passes REJECT (reject bias)', () => {
    const result = interpretDirectionReversal('REJECT', 'REJECT', 4);
    expect(result).toEqual({ verdict: 'UNSURE', confidence: 0.5, changesFound: 4 });
  });

  it('returns UNSURE when forward is UNSURE', () => {
    const result = interpretDirectionReversal('UNSURE', 'REJECT', 1);
    expect(result).toEqual({ verdict: 'UNSURE', confidence: 0.3, changesFound: 1 });
  });

  it('returns UNSURE when reverse is UNSURE', () => {
    const result = interpretDirectionReversal('ACCEPT', 'UNSURE', 1);
    expect(result).toEqual({ verdict: 'UNSURE', confidence: 0.3, changesFound: 1 });
  });

  it('returns UNSURE when both are UNSURE', () => {
    const result = interpretDirectionReversal('UNSURE', 'UNSURE', 2);
    expect(result).toEqual({ verdict: 'UNSURE', confidence: 0.3, changesFound: 2 });
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

describe('buildDiffJudgePrompt', () => {
  it('includes CriticMarkup diff and evaluation criteria', () => {
    const diff = 'Some text {--removed--}{++added++}';
    const prompt = buildDiffJudgePrompt(diff);
    expect(prompt).toContain(diff);
    expect(prompt).toContain('ACCEPT');
    expect(prompt).toContain('REJECT');
    expect(prompt).toContain('UNSURE');
    expect(prompt).toContain('clarity and readability');
  });
});

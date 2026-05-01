// Mock EvolutionLLMClient for V2 tests. Supports label-based and position-based responses.

import type { EvolutionLLMClient, LLMCompletionOptions } from '../lib/types';

const VALID_TEXT = `# Test Article

## Introduction

This is a generated test variant for the evolution pipeline. It demonstrates proper formatting with headings and paragraphs. The content validates correctly against format rules.

## Details

The pipeline generates variants through multiple strategies. Each variant competes in pairwise comparisons. Higher-rated variants advance through subsequent iterations.`;

export interface MockLlmOptions {
  /** Default text returned for generation/evolution labels. */
  defaultText?: string;
  /** Ordered responses consumed by position for ranking calls. */
  rankingResponses?: string[];
  /** Per-pair keyed responses for ranking (checked before positional). */
  pairResponses?: Map<string, string>;
  /** Label-based response overrides. */
  labelResponses?: Record<string, string>;
}

export function createV2MockLlm(options: MockLlmOptions = {}): EvolutionLLMClient & {
  complete: jest.Mock;
  completeStructured: jest.Mock;
  callCount: () => number;
} {
  const defaultText = options.defaultText ?? VALID_TEXT;
  const rankingQueue = [...(options.rankingResponses ?? [])];
  const pairResponses = options.pairResponses ?? new Map<string, string>();
  const labelResponses = options.labelResponses ?? {};
  let callIdx = 0;

  const complete = jest.fn(async (prompt: string, label: string, _options?: LLMCompletionOptions): Promise<string> => {
    callIdx++;

    // Label-based override
    if (labelResponses[label]) return labelResponses[label];

    // Ranking: try pair-based first, then positional
    if (label === 'ranking') {
      // Extract texts from prompt for pair matching
      for (const [key, response] of pairResponses) {
        if (prompt.includes(key)) return response;
      }
      if (rankingQueue.length > 0) return rankingQueue.shift()!;
      throw new Error(
        `v2MockLlm: ranking queue exhausted and no pair-response match for prompt. ` +
          `Tests must either seed enough rankingResponses or add a pairResponses entry. ` +
          `callIdx=${callIdx}`,
      );
    }

    return defaultText;
  });

  const completeStructured = jest.fn(async (): Promise<never> => {
    throw new Error('completeStructured not implemented in V2 mock');
  });

  return {
    complete,
    completeStructured,
    callCount: () => callIdx,
  };
}

export { VALID_TEXT as VALID_VARIANT_TEXT };

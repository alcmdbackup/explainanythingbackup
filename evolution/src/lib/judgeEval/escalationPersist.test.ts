// Unit tests for the pure submatch -> judge_eval_calls row mapper + group key.

import { submatchToCallRow, submatchGroupKey } from './escalationPersist';
import type { SubmatchRecord } from './escalation';
import type { JudgeEvalPair } from './schemas';

const pair: JudgeEvalPair = {
  label: 'art#001',
  pair_kind: 'article',
  variant_a_id: '00000000-0000-4000-8000-0000000000a1',
  variant_b_id: '00000000-0000-4000-8000-0000000000b2',
  text_a: 'A',
  text_b: 'B',
  mu_a: 30,
  mu_b: 25,
  sigma_a: 4,
  sigma_b: 4,
  expected_winner: 'A',
  gap_kind: 'large',
  baseline_confidence: 0.7,
};

const sub: SubmatchRecord = {
  model: 'gpt-4o-mini',
  escalationStep: 1,
  triggeredEscalation: false,
  forwardWinner: 'A',
  reverseWinner: 'B',
  winner: 'A',
  confidence: 1.0,
  costUsd: 0.0021,
  promptTokens: 40,
  outputTokens: 2,
  reasoningTokens: 0,
  forwardRaw: 'A',
  reverseRaw: 'B',
  forwardPrompt: '## Text A ...',
  reversePrompt: '## Text A ...',
  forwardReasoning: null,
  reverseReasoning: null,
  error: null,
};

describe('submatchGroupKey', () => {
  it('ties a match together by pair + repeat', () => {
    expect(submatchGroupKey('art#001', 0)).toBe('art#001#0');
    expect(submatchGroupKey('art#001', 0)).not.toBe(submatchGroupKey('art#001', 1));
  });
});

describe('submatchToCallRow', () => {
  const row = submatchToCallRow(pair, sub, submatchGroupKey(pair.label, 0), 0);

  it('carries the submatch verdict + identity', () => {
    expect(row.winner).toBe('A');
    expect(row.confidence).toBe(1.0);
    expect(row.judge_model).toBe('gpt-4o-mini');
    expect(row.escalation_step).toBe(1);
    expect(row.triggered_escalation).toBe(false);
    expect(row.submatch_group_key).toBe('art#001#0');
    expect(row.repeat_index).toBe(0);
  });

  it('carries the per-pass audit + cost', () => {
    expect(row.forward_winner).toBe('A');
    expect(row.reverse_winner).toBe('B');
    expect(row.forward_raw).toBe('A');
    expect(row.cost_usd).toBeCloseTo(0.0021, 6);
    expect(row.prompt_tokens).toBe(40);
  });

  it('freezes the ground-truth snapshot from the pair', () => {
    expect(row.expected_winner).toBe('A');
    expect(row.gap_kind).toBe('large');
    expect(row.mu_a).toBe(30);
    expect(row.variant_a_id).toBe(pair.variant_a_id);
    expect(row.comparison_mode).toBe('article');
  });

  it('maps an errored (abstained) submatch', () => {
    const errored: SubmatchRecord = { ...sub, winner: 'TIE', confidence: 0, error: 'timeout', forwardRaw: null };
    const r = submatchToCallRow(pair, errored, 'g', 2);
    expect(r.winner).toBe('TIE');
    expect(r.error).toBe('timeout');
    expect(r.repeat_index).toBe(2);
  });
});

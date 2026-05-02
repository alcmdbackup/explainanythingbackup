// Approver JSONL parser — well-formed input, partial parse, missing-default-reject,
// unknown-group-ignored, malformed JSON, extra fields.

import { parseReviewDecisions } from './parseReviewDecisions';

describe('parseReviewDecisions', () => {
  it('parses well-formed JSONL', () => {
    const raw = '{"groupNumber":1,"decision":"accept","reason":"good"}\n{"groupNumber":2,"decision":"reject","reason":"no"}';
    const r = parseReviewDecisions(raw, [1, 2]);
    expect(r).toEqual([
      { groupNumber: 1, decision: 'accept', reason: 'good' },
      { groupNumber: 2, decision: 'reject', reason: 'no' },
    ]);
  });

  it('skips malformed lines', () => {
    const raw = '{"groupNumber":1,"decision":"accept","reason":"x"}\nnot json\n{"groupNumber":2,"decision":"reject","reason":"y"}';
    const r = parseReviewDecisions(raw, [1, 2]);
    expect(r).toHaveLength(2);
  });

  it('defaults missing decisions to reject', () => {
    const raw = '{"groupNumber":1,"decision":"accept","reason":"x"}';
    const r = parseReviewDecisions(raw, [1, 2, 3]);
    expect(r.find((d) => d.groupNumber === 2)?.decision).toBe('reject');
    expect(r.find((d) => d.groupNumber === 3)?.decision).toBe('reject');
  });

  it('ignores decisions for unknown group numbers', () => {
    const raw = '{"groupNumber":1,"decision":"accept","reason":"x"}\n{"groupNumber":99,"decision":"accept","reason":"phantom"}';
    const r = parseReviewDecisions(raw, [1]);
    expect(r).toHaveLength(1);
    expect(r[0]!.groupNumber).toBe(1);
  });

  it('treats invalid decision values as reject', () => {
    const raw = '{"groupNumber":1,"decision":"maybe","reason":"x"}';
    const r = parseReviewDecisions(raw, [1]);
    expect(r[0]!.decision).toBe('reject');
  });

  it('handles empty input by defaulting all to reject', () => {
    const r = parseReviewDecisions('', [1, 2]);
    expect(r.every((d) => d.decision === 'reject')).toBe(true);
  });
});

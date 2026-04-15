// Tests for InvocationTimelineTab — covers 9 adversarial scenarios.

import { render, screen } from '@testing-library/react';
import { InvocationTimelineTab } from './InvocationTimelineTab';

const INV_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

function makeInvocation(overrides: Partial<Parameters<typeof InvocationTimelineTab>[0]['invocation']> = {}) {
  return {
    id: INV_ID,
    agent_name: 'generate_from_seed_article',
    duration_ms: 5000,
    execution_detail: null,
    ...overrides,
  } as Parameters<typeof InvocationTimelineTab>[0]['invocation'];
}

function makeExecDetail(opts: {
  generationDurationMs?: number;
  rankingDurationMs?: number;
  comparisons?: Array<{ round: number; durationMs?: number; opponentId?: string; outcome?: string }>;
  rankingNull?: boolean;
}) {
  if (opts.rankingNull) {
    return {
      generation: { cost: 0.001, promptLength: 500, formatValid: true, durationMs: opts.generationDurationMs ?? 1000 },
      ranking: null,
    };
  }
  return {
    generation: { cost: 0.001, promptLength: 500, formatValid: true, durationMs: opts.generationDurationMs ?? 1000 },
    ranking: {
      cost: 0.003,
      durationMs: opts.rankingDurationMs ?? 4000,
      comparisons: opts.comparisons ?? [],
    },
  };
}

describe('InvocationTimelineTab', () => {
  // Scenario 1: Happy path — complete invocation with full timing
  it('scenario 1: renders complete invocation with full timing (3 comparisons)', () => {
    const inv = makeInvocation({
      duration_ms: 5000,
      execution_detail: makeExecDetail({
        generationDurationMs: 1000,
        rankingDurationMs: 4000,
        comparisons: [
          { round: 1, durationMs: 1500, opponentId: 'v1', outcome: 'win' },
          { round: 2, durationMs: 1200, opponentId: 'v2', outcome: 'loss' },
          { round: 3, durationMs: 1300, opponentId: 'v3', outcome: 'win' },
        ],
      }),
    });
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getByTestId('invocation-timeline')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-generation-bar')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-ranking-bar')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-comparison-0')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-comparison-1')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-comparison-2')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-estimated-note')).not.toBeInTheDocument();
    expect(screen.queryByTestId('timeline-bucketed-note')).not.toBeInTheDocument();
  });

  // Scenario 2: Running invocation — null duration_ms, no execution_detail
  it('scenario 2: renders placeholder for running invocation (null duration, no detail)', () => {
    const inv = makeInvocation({ duration_ms: null, execution_detail: null });
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getByTestId('timeline-running')).toHaveTextContent(/in progress/i);
  });

  // Scenario 3: Pre-instrumentation historical — no durationMs fields on comparisons, but total ranking has timing
  it('scenario 3: proportional-share fallback when per-comparison durationMs is missing', () => {
    const inv = makeInvocation({
      duration_ms: 5000,
      execution_detail: makeExecDetail({
        generationDurationMs: 1000,
        rankingDurationMs: 4000,
        comparisons: [
          { round: 1, opponentId: 'v1', outcome: 'win' }, // no durationMs
          { round: 2, opponentId: 'v2', outcome: 'loss' },
          { round: 3, opponentId: 'v3', outcome: 'win' },
          { round: 4, opponentId: 'v4', outcome: 'win' },
        ],
      }),
    });
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getByTestId('timeline-estimated-note')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-comparison-0')).toBeInTheDocument();
    // 4 comparisons × 1000ms each (4000ms / 4)
  });

  // Scenario 4: Discarded variant — ranking is null
  it('scenario 4: discarded variant shows only generation segment + discarded notice', () => {
    const inv = makeInvocation({
      duration_ms: 1000,
      execution_detail: makeExecDetail({ generationDurationMs: 1000, rankingNull: true }),
    });
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getByTestId('timeline-generation-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-ranking-bar')).not.toBeInTheDocument();
    expect(screen.getByTestId('timeline-discarded')).toBeInTheDocument();
  });

  // Scenario 5: Quick convergence — 3-comparison binary search
  it('scenario 5: quick convergence (3 comparisons) renders 3 sub-bars', () => {
    const inv = makeInvocation({
      duration_ms: 3500,
      execution_detail: makeExecDetail({
        generationDurationMs: 500,
        rankingDurationMs: 3000,
        comparisons: [
          { round: 1, durationMs: 1000, opponentId: 'v1', outcome: 'win' },
          { round: 2, durationMs: 1000, opponentId: 'v2', outcome: 'win' },
          { round: 3, durationMs: 1000, opponentId: 'v3', outcome: 'win' },
        ],
      }),
    });
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getAllByTestId(/^timeline-comparison-\d+$/)).toHaveLength(3);
  });

  // Scenario 6: Full budget — 25 comparisons triggering the bucket-aggregation guard
  it('scenario 6: bucket-aggregates when >20 comparisons (25 → 5 buckets)', () => {
    const comparisons = Array.from({ length: 25 }, (_, i) => ({
      round: i + 1,
      durationMs: 200,
      opponentId: `v${i}`,
      outcome: 'win' as const,
    }));
    const inv = makeInvocation({
      duration_ms: 5500,
      execution_detail: makeExecDetail({ generationDurationMs: 500, rankingDurationMs: 5000, comparisons }),
    });
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getByTestId('timeline-bucketed-note')).toBeInTheDocument();
    // 25 / 5 = 5 buckets
    expect(screen.getAllByTestId(/^timeline-comparison-\d+$/)).toHaveLength(5);
  });

  // Scenario 7: Partial comparison timing — some have durationMs, some don't
  it('scenario 7: partial timing triggers estimated-note fallback', () => {
    const inv = makeInvocation({
      duration_ms: 3000,
      execution_detail: makeExecDetail({
        generationDurationMs: 500,
        rankingDurationMs: 2500,
        comparisons: [
          { round: 1, durationMs: 800, opponentId: 'v1', outcome: 'win' },
          { round: 2, opponentId: 'v2', outcome: 'loss' }, // missing durationMs
          { round: 3, durationMs: 900, opponentId: 'v3', outcome: 'win' },
        ],
      }),
    });
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getByTestId('timeline-estimated-note')).toBeInTheDocument();
  });

  // Scenario 8: Invariant violation — generation duration > total invocation duration (clock skew)
  it('scenario 8: clock-skew invariant violation does not crash', () => {
    const inv = makeInvocation({
      duration_ms: 1000, // total reported as 1s
      execution_detail: makeExecDetail({
        generationDurationMs: 2000, // but generation claims 2s
        rankingDurationMs: 500,
        comparisons: [{ round: 1, durationMs: 500, opponentId: 'v1', outcome: 'win' }],
      }),
    });
    // Should not throw; render completes
    render(<InvocationTimelineTab invocation={inv} />);
    expect(screen.getByTestId('invocation-timeline')).toBeInTheDocument();
  });

  // Scenario 9: Zero-ms comparison — sub-ms or bad data
  it('scenario 9: zero-ms comparison renders with minimum width', () => {
    const inv = makeInvocation({
      duration_ms: 2000,
      execution_detail: makeExecDetail({
        generationDurationMs: 1000,
        rankingDurationMs: 1000,
        comparisons: [{ round: 1, durationMs: 0, opponentId: 'v1', outcome: 'win' }],
      }),
    });
    render(<InvocationTimelineTab invocation={inv} />);
    // 0ms durationMs triggers the proportional-share fallback (since durationMs=0 is filtered out
    // by the "has timing" check). So we see the estimated note.
    expect(screen.getByTestId('timeline-estimated-note')).toBeInTheDocument();
    expect(screen.getByTestId('timeline-comparison-0')).toBeInTheDocument();
  });
});

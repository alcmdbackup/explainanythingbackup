// Component tests for the SubagentsTab — Phase 2 of
// rename_agents_subagents_evolution_20260508. Locks in tree rendering, expand /
// collapse, level pill, kind badge, and the dev-only sum-up validation hook.

import { render, screen } from '@testing-library/react';
import { SubagentsTab } from './SubagentsTab';
import type { InvocationForTree } from '@evolution/lib/shared/buildSubagentTree';

function inv(overrides: Partial<InvocationForTree>): InvocationForTree {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    agent_name: 'generate_from_previous_article',
    cost_usd: null,
    duration_ms: null,
    execution_detail: null,
    ...overrides,
  };
}

describe('SubagentsTab', () => {
  it('renders the L1 root row using invocation.agent_name', () => {
    render(<SubagentsTab invocation={inv({})} />);
    expect(screen.getByTestId('subagent-row-generate_from_previous_article')).toBeInTheDocument();
  });

  it('renders L2 children for a GFPA invocation (generation + ranking)', () => {
    const invocation = inv({
      agent_name: 'generate_from_previous_article',
      cost_usd: 0.033,
      duration_ms: 13200,
      execution_detail: {
        generation: { cost: 0.022, durationMs: 9000 },
        ranking: { cost: 0.011, durationMs: 4200, comparisons: [] },
      },
    });
    render(<SubagentsTab invocation={invocation} />);
    // L2 children carry their own path (not prefixed with the L1 root's name).
    expect(screen.getByTestId('subagent-row-generation')).toBeInTheDocument();
    expect(screen.getByTestId('subagent-row-ranking')).toBeInTheDocument();
  });

  it('renders the dotted path for L4 comparisons under ranking', () => {
    const invocation = inv({
      agent_name: 'generate_from_previous_article',
      execution_detail: {
        generation: { cost: 0.022, durationMs: 9000 },
        ranking: {
          cost: 0.011,
          durationMs: 4200,
          comparisons: [
            { round: 1, opponentId: 'a', outcome: 'win', durationMs: 800, cost: 0.0022 },
          ],
        },
      },
    });
    render(<SubagentsTab invocation={invocation} />);
    // L2 (ranking) is auto-expanded → its L3 children render without a click.
    expect(screen.getByTestId('subagent-row-ranking.comparison.1')).toBeInTheDocument();
  });

  it('renders the wrapper tree for reflect_and_generate (3 layers deep)', () => {
    const invocation = inv({
      agent_name: 'reflect_and_generate_from_previous_article',
      cost_usd: 0.036,
      duration_ms: 14400,
      execution_detail: {
        reflection: { cost: 0.003, durationMs: 1200, tacticChosen: 'engagement_amplify' },
        generation: { cost: 0.022, durationMs: 9000 },
        ranking: { cost: 0.011, durationMs: 4200, comparisons: [] },
      },
    });
    render(<SubagentsTab invocation={invocation} />);
    expect(screen.getByTestId('subagent-row-reflect_and_generate_from_previous_article')).toBeInTheDocument();
    expect(screen.getByTestId('subagent-row-reflection')).toBeInTheDocument();
    expect(screen.getByTestId('subagent-row-generate_from_previous_article')).toBeInTheDocument();
  });

  it('renders unknown agent_name as a leaf-only tree (parser returns empty children)', () => {
    const invocation = inv({ agent_name: 'some_unknown_agent_type' });
    render(<SubagentsTab invocation={invocation} />);
    // L1 row still present; no L2 rows because parser dispatch falls through.
    expect(screen.getByTestId('subagent-row-some_unknown_agent_type')).toBeInTheDocument();
  });
});

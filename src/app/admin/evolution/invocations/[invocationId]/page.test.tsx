// Tests for invocation detail page rendering.

import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import InvocationDetailPage from './page';
import { getInvocationDetailAction } from '@evolution/services/invocationActions';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/invocations/aaaaaaaa-1111-2222-3333-444444444444',
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({ invocationId: 'aaaaaaaa-1111-2222-3333-444444444444' }),
}));

jest.mock('@evolution/services/invocationActions', () => ({
  getInvocationDetailAction: jest.fn().mockResolvedValue({
    success: true,
    data: {
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      run_id: 'bbbbbbbb-1111-2222-3333-444444444444',
      agent_name: 'mutator',
      iteration: 1,
      execution_order: 1,
      success: true,
      cost_usd: 0.125,
      duration_ms: 3200,
      error_message: null,
      execution_detail: { model: 'gpt-4', tokens: 500 },
      created_at: '2026-03-01T00:00:00Z',
    },
  }),
}));

jest.mock('./InvocationExecutionDetail', () => ({
  InvocationExecutionDetail: (props: Record<string, unknown>) => (
    <div data-testid="execution-detail">ExecutionDetail</div>
  ),
}));

describe('InvocationDetailPage', () => {
  it('renders breadcrumb with Invocations link', async () => {
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'aaaaaaaa-1111-2222-3333-444444444444' }) });
    render(page);
    expect(screen.getByText('Invocations').closest('a')).toHaveAttribute('href', '/admin/evolution/invocations');
  });

  it('renders entity detail header', async () => {
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'aaaaaaaa-1111-2222-3333-444444444444' }) });
    render(page);
    expect(screen.getByTestId('entity-detail-header')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('renders info cards with agent and cost', async () => {
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'aaaaaaaa-1111-2222-3333-444444444444' }) });
    render(page);
    expect(screen.getByText('mutator')).toBeInTheDocument();
    expect(screen.getByText('$0.125')).toBeInTheDocument();
  });

  it('renders run cross-link', async () => {
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'aaaaaaaa-1111-2222-3333-444444444444' }) });
    render(page);
    const crossLinks = screen.getByTestId('cross-links');
    const link = crossLinks.querySelector('a[href="/admin/evolution/runs/bbbbbbbb-1111-2222-3333-444444444444"]');
    expect(link).toBeInTheDocument();
  });

  it('renders Subagents tab content by default (Phase 2 rename_agents_subagents_evolution_20260508)', async () => {
    // Phase 2 made `subagents` the default tab; the SubagentsTab component
    // renders subagent-row-* testids for each node in the tree (the L1 row is
    // always present even when the parser yields no children).
    const page = await InvocationDetailPage({ params: Promise.resolve({ invocationId: 'aaaaaaaa-1111-2222-3333-444444444444' }) });
    render(page);
    // The mocked invocation has agent_name 'mutator' — unknown to the parser
    // so children are []. The L1 root row is still present.
    expect(screen.getByTestId('subagent-row-mutator')).toBeInTheDocument();
  });

  it('calls notFound when action fails', async () => {
    jest.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
    jest.mocked(getInvocationDetailAction).mockResolvedValueOnce({ success: false, data: null, error: null });
    await expect(InvocationDetailPage({ params: Promise.resolve({ invocationId: 'aaaaaaaa-1111-2222-3333-444444444444' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });
});

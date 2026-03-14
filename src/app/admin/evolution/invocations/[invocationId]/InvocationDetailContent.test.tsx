// Tests for InvocationDetailContent: 4-tab structure, overview CI display, input/output tabs.

import { render, screen, fireEvent } from '@testing-library/react';
import { InvocationDetailContent } from './InvocationDetailContent';
import type { DiffMetrics } from '@evolution/lib/types';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/admin/evolution/invocations/inv-abc12345',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@evolution/components/evolution/InputArticleSection', () => ({
  InputArticleSection: () => <div data-testid="input-article">InputArticle</div>,
}));

jest.mock('@evolution/components/evolution/TextDiff', () => ({
  TextDiff: () => <div data-testid="text-diff">TextDiff</div>,
}));

jest.mock('@evolution/components/evolution/agentDetails', () => ({
  AgentExecutionDetailView: () => <div data-testid="exec-detail">ExecDetail</div>,
}));

const baseInvocation = {
  id: 'inv-abc12345',
  runId: 'run-00000001',
  agentName: 'improver',
  iteration: 2,
  executionOrder: 1,
  costUsd: 50000,
  skipped: false,
  success: true,
  errorMessage: null,
  executionDetail: null,
  agentAttribution: null,
  createdAt: '2026-01-01T00:00:00Z',
};

const baseRun = {
  id: 'run-00000001',
  status: 'completed',
  phase: null as string | null,
  explanationTitle: 'Test Article',
  explanationId: 1,
};

const baseProps = {
  invocation: baseInvocation,
  run: baseRun,
  diffMetrics: { variantsAdded: 2, matchesPlayed: 5, newVariantIds: [], eloChanges: {}, critiquesAdded: 0, debatesAdded: 0, diversityScoreAfter: 0, metaFeedbackPopulated: false } as DiffMetrics,
  inputVariant: null,
  variantDiffs: [],
  eloHistory: {},
};

describe('InvocationDetailContent', () => {
  it('renders 4 tabs: Overview, Input Variant, Output Variants, Execution Detail', () => {
    render(<InvocationDetailContent {...baseProps} />);
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Input Variant')).toBeInTheDocument();
    expect(screen.getByText('Output Variants')).toBeInTheDocument();
    expect(screen.getByText('Execution Detail')).toBeInTheDocument();
  });

  it('shows overview metrics by default', () => {
    render(<InvocationDetailContent {...baseProps} />);
    expect(screen.getByText('Iteration')).toBeInTheDocument();
    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(screen.getByText('Variants Added')).toBeInTheDocument();
  });

  it('shows CI in overview when inputVariant has sigma', () => {
    render(
      <InvocationDetailContent
        {...baseProps}
        inputVariant={{ variantId: 'v-input01', strategy: 'seed', text: 'hello', textMissing: false, elo: 1300, sigma: 5 }}
      />
    );
    expect(screen.getByText('Inputs / Outputs')).toBeInTheDocument();
    // CI: [1300 - 1.96*5*16, 1300 + 1.96*5*16] = [1143, 1457]
    expect(screen.getByText(/1143.*1457/)).toBeInTheDocument();
  });

  it('hides CI when sigma is null', () => {
    render(
      <InvocationDetailContent
        {...baseProps}
        inputVariant={{ variantId: 'v-input01', strategy: 'seed', text: 'hello', textMissing: false, elo: 1300, sigma: null }}
      />
    );
    expect(screen.getByText('1300')).toBeInTheDocument();
    expect(screen.queryByText(/\[.*,.*\]/)).not.toBeInTheDocument();
  });

  it('shows output variant CI and delta in overview', () => {
    render(
      <InvocationDetailContent
        {...baseProps}
        inputVariant={{ variantId: 'v-input01', strategy: 'seed', text: 'hello', textMissing: false, elo: 1200, sigma: null }}
        variantDiffs={[{
          variantId: 'v-out01aa',
          strategy: 'evolution',
          parentId: 'v-input01',
          beforeText: 'old',
          afterText: 'new',
          textMissing: false,
          eloDelta: 100,
          eloAfter: 1300,
          sigmaAfter: 3,
        }]}
      />
    );
    // Delta display
    expect(screen.getByText('+100 from input')).toBeInTheDocument();
    // CI: [1300 - 1.96*3*16, 1300 + 1.96*3*16] = [1206, 1394] — rounding may vary
    expect(screen.getByText(/120[56].*139[34]/)).toBeInTheDocument();
  });

  it('switches to Input Variant tab', () => {
    render(
      <InvocationDetailContent
        {...baseProps}
        inputVariant={{ variantId: 'v-input01', strategy: 'seed', text: 'hello', textMissing: false, elo: 1200, sigma: null }}
      />
    );
    fireEvent.click(screen.getByText('Input Variant'));
    expect(screen.getByTestId('input-article')).toBeInTheDocument();
  });

  it('switches to Output Variants tab and shows empty state', () => {
    render(<InvocationDetailContent {...baseProps} />);
    fireEvent.click(screen.getByText('Output Variants'));
    expect(screen.getByText('No output variants produced.')).toBeInTheDocument();
  });
});

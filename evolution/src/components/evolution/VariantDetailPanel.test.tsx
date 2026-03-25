// Tests for VariantDetailPanel V2: loading, detail display, parent lineage, and error state.
import { render, screen, waitFor } from '@testing-library/react';
import { VariantDetailPanel } from './VariantDetailPanel';

jest.mock('@evolution/services/variantDetailActions', () => ({
  getVariantFullDetailAction: jest.fn(),
  getVariantParentsAction: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getVariantFullDetailAction, getVariantParentsAction } = require('@evolution/services/variantDetailActions');

const mockDetail = {
  id: 'variant-123',
  runId: 'run-1',
  explanationId: 1,
  explanationTitle: 'Test',
  variantContent: 'Some content here for testing the panel display',
  eloScore: 1350,
  generation: 2,
  agentName: 'generation',
  matchCount: 5,
  isWinner: true,
  parentVariantId: 'parent-1',
  createdAt: '2026-03-19T00:00:00Z',
  runStatus: 'completed',
  runCreatedAt: '2026-03-19T00:00:00Z',
};

describe('VariantDetailPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders detail after loading', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: true, data: mockDetail, error: null,
    });
    getVariantParentsAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByTestId('variant-detail-panel')).toBeInTheDocument());
    expect(screen.getByText(/Rating.*1350/)).toBeInTheDocument();
  });

  it('renders parent lineage', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: true, data: mockDetail, error: null,
    });
    getVariantParentsAction.mockResolvedValue({
      success: true,
      data: [{ id: 'parent-1', eloScore: 1200, generation: 1, agentName: 'generation', isWinner: false, preview: 'Parent text' }],
      error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByTestId('parent-lineage')).toBeInTheDocument());
  });

  it('renders error on failure', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: false, data: null, error: { message: 'Not found' },
    });
    getVariantParentsAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByText('Not found')).toBeInTheDocument());
  });

  it('renders content preview', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: true, data: mockDetail, error: null,
    });
    getVariantParentsAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByText('Content Preview')).toBeInTheDocument());
    expect(screen.getByText(/Some content here/)).toBeInTheDocument();
  });

  it('shows match count in detail', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: true, data: { ...mockDetail, matchCount: 8 }, error: null,
    });
    getVariantParentsAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByTestId('variant-detail-panel')).toBeInTheDocument());
  });

  it('shows agent name', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: true, data: mockDetail, error: null,
    });
    getVariantParentsAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByText('generation')).toBeInTheDocument());
  });

  it('shows generation number', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: true, data: mockDetail, error: null,
    });
    getVariantParentsAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByText('gen 2')).toBeInTheDocument());
  });

  it('renders loading skeleton', () => {
    getVariantFullDetailAction.mockReturnValue(new Promise(() => {}));
    getVariantParentsAction.mockReturnValue(new Promise(() => {}));

    const { container } = render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows default error when no error message', async () => {
    getVariantFullDetailAction.mockResolvedValue({
      success: false, data: null, error: null,
    });
    getVariantParentsAction.mockResolvedValue({
      success: true, data: [], error: null,
    });

    render(<VariantDetailPanel runId="run-1" variantId="variant-123" />);
    await waitFor(() => expect(screen.getByText('Variant not found')).toBeInTheDocument());
  });
});

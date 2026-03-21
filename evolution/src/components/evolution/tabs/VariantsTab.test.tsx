// Tests for VariantsTab V2: loading, table rendering, error, filtering, and expand/collapse.
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VariantsTab } from './VariantsTab';
import * as evolutionActions from '@evolution/services/evolutionActions';
import type { EvolutionVariant } from '@evolution/services/evolutionActions';

jest.mock('@evolution/services/evolutionActions', () => ({
  getEvolutionVariantsAction: jest.fn(),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn().mockReturnValue(null) }),
}));

const mockVariants: EvolutionVariant[] = [
  {
    id: 'aaaa-1111-bbbb-2222-cccc-3333',
    run_id: 'run-1',
    explanation_id: 1,
    variant_content: 'Hello world variant content',
    elo_score: 1350,
    generation: 2,
    agent_name: 'generation',
    match_count: 5,
    is_winner: true,
    created_at: '2026-03-19T00:00:00Z',
  },
  {
    id: 'bbbb-2222-cccc-3333-dddd-4444',
    run_id: 'run-1',
    explanation_id: 1,
    variant_content: 'Another variant',
    elo_score: 1200,
    generation: 1,
    agent_name: 'evolution',
    match_count: 3,
    is_winner: false,
    created_at: '2026-03-19T00:00:00Z',
  },
];

describe('VariantsTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders loading skeleton initially', () => {
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockReturnValue(new Promise(() => {}));
    render(<VariantsTab runId="run-1" />);
    expect(screen.queryByTestId('variants-tab')).toBeNull();
  });

  it('renders variants table after loading', async () => {
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockVariants,
      error: null,
    });

    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());
    expect(screen.getByText('1350')).toBeInTheDocument();
    expect(screen.getAllByText('generation').length).toBeGreaterThan(0);
  });

  it('renders error message on failure', async () => {
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: false,
      data: null,
      error: { message: 'Server error' },
    });

    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument());
  });

  it('filters by strategy', async () => {
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: mockVariants,
      error: null,
    });

    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'generation' } });
    expect(screen.getByText('1350')).toBeInTheDocument();
    expect(screen.queryByText('1200')).toBeNull();
  });
});

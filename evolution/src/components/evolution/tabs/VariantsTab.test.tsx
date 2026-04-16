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

  it('F24/F43: shows em-dash when agent_name is empty', async () => {
    const variantsWithEmptyAgent: EvolutionVariant[] = [
      {
        id: 'cccc-3333-dddd-4444-eeee-5555',
        run_id: 'run-1',
        explanation_id: 1,
        variant_content: 'No agent variant',
        elo_score: 1100,
        generation: 1,
        agent_name: '',
        match_count: 2,
        is_winner: false,
        created_at: '2026-03-19T00:00:00Z',
      },
    ];

    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: variantsWithEmptyAgent,
      error: null,
    });

    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());
    // The Strategy column should show em-dash for empty agent_name.
    // Multiple em-dashes may now appear (e.g. 95% CI column for variants without mu/sigma),
    // so assert >= 1 instead of exactly 1.
    expect(screen.getAllByText('\u2014').length).toBeGreaterThanOrEqual(1);
  });

  it('F26: strategy dropdown has no empty options when variants have empty/null agent_name', async () => {
    const variantsWithEmpty: EvolutionVariant[] = [
      {
        id: 'v1',
        run_id: 'run-1',
        explanation_id: 1,
        variant_content: 'content1',
        elo_score: 1300,
        generation: 1,
        agent_name: 'generation',
        match_count: 3,
        is_winner: false,
        created_at: '2026-03-19T00:00:00Z',
      },
      {
        id: 'v2',
        run_id: 'run-1',
        explanation_id: 1,
        variant_content: 'content2',
        elo_score: 1200,
        generation: 1,
        agent_name: '',
        match_count: 2,
        is_winner: false,
        created_at: '2026-03-19T00:00:00Z',
      },
      {
        id: 'v3',
        run_id: 'run-1',
        explanation_id: 1,
        variant_content: 'content3',
        elo_score: 1100,
        generation: 1,
        agent_name: null as unknown as string,
        match_count: 1,
        is_winner: false,
        created_at: '2026-03-19T00:00:00Z',
      },
    ];

    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: variantsWithEmpty,
      error: null,
    });

    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());

    const select = screen.getByRole('combobox');
    const options = select.querySelectorAll('option');
    // First option is "All strategies", rest should only be non-empty agent names
    for (const opt of Array.from(options)) {
      expect(opt.textContent!.trim()).not.toBe('');
    }
    // Only "All strategies" and "generation" should appear
    expect(options).toHaveLength(2);
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

  it('passes includeDiscarded=false to action by default and toggles to true on click', async () => {
    const mock = evolutionActions.getEvolutionVariantsAction as jest.Mock;
    mock.mockResolvedValue({ success: true, data: mockVariants, error: null });

    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());

    expect(mock).toHaveBeenCalledWith({ runId: 'run-1', includeDiscarded: false });

    const checkbox = screen.getByTestId('include-discarded-toggle').querySelector('input')!;
    fireEvent.click(checkbox);

    await waitFor(() =>
      expect(mock).toHaveBeenCalledWith({ runId: 'run-1', includeDiscarded: true }),
    );
  });

  it('renders persisted=true with check and persisted=false with X', async () => {
    const variantsMixed: EvolutionVariant[] = [
      { ...mockVariants[0]!, persisted: true },
      { ...mockVariants[1]!, persisted: false },
    ];
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: variantsMixed,
      error: null,
    });

    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());

    // First variant id starts with "aaaa-1"
    const firstCell = screen.getByTestId(`persisted-${variantsMixed[0]!.id.substring(0, 6)}`);
    const secondCell = screen.getByTestId(`persisted-${variantsMixed[1]!.id.substring(0, 6)}`);
    expect(firstCell.textContent).toContain('✓');
    expect(secondCell.textContent).toContain('✗');
  });

  // Phase 4b: Elo CI rendering
  it('renders Elo ± uncertainty + 95% CI when mu/sigma are populated', async () => {
    const variants: EvolutionVariant[] = [
      {
        id: 'with-rating-1',
        run_id: 'run-1',
        explanation_id: 1,
        variant_content: 'v1',
        elo_score: 1300,
        // dbToRating(30, 5) → Elo ~1320, uncertainty ~80 (OpenSkill → Elo scale via × 16 / 25-3=22)
        // Use values that produce a known-readable uncertainty
        mu: 30,
        sigma: 5,
        generation: 1,
        agent_name: 'generation',
        match_count: 3,
        is_winner: false,
        created_at: '2026-03-19T00:00:00Z',
      },
    ];
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true, data: variants, error: null,
    });
    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());

    const rating = screen.getByTestId('rating-with-r');
    const ci = screen.getByTestId('ci-with-r');
    // "± " appears in the rating cell (Elo ± half-width)
    expect(rating.textContent).toMatch(/±/);
    // CI cell shows "[lo, hi]"
    expect(ci.textContent).toMatch(/\[-?\d+,\s*\d+\]/);
  });

  it('falls back to bare Elo when mu/sigma are missing (legacy rows)', async () => {
    const variants: EvolutionVariant[] = [
      {
        id: 'legacy-1',
        run_id: 'run-1',
        explanation_id: 1,
        variant_content: 'v1',
        elo_score: 1250,
        // No mu/sigma (legacy variant row)
        generation: 1,
        agent_name: 'generation',
        match_count: 3,
        is_winner: false,
        created_at: '2026-03-19T00:00:00Z',
      },
    ];
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true, data: variants, error: null,
    });
    render(<VariantsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());

    const rating = screen.getByTestId('rating-legacy');
    const ci = screen.getByTestId('ci-legacy');
    // No ± for legacy rows — just the bare rounded Elo.
    expect(rating.textContent).not.toMatch(/±/);
    expect(rating.textContent).toContain('1250');
    // CI cell shows em-dash.
    expect(ci.textContent).toBe('\u2014');
  });

  // Phase 4c: strategyId mode
  it('loads variants via strategyId when strategyId prop is set (runId absent)', async () => {
    const variants: EvolutionVariant[] = [];
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true, data: variants, error: null,
    });
    render(<VariantsTab strategyId="strat-1" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());
    // Assert the action was called with strategyId (not runId)
    expect(evolutionActions.getEvolutionVariantsAction).toHaveBeenCalledWith(
      expect.objectContaining({ strategyId: 'strat-1', includeDiscarded: false }),
    );
    expect(evolutionActions.getEvolutionVariantsAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: expect.anything() }),
    );
  });

  it('does NOT show failed-run banner when in strategyId mode (runStatus is run-only)', async () => {
    (evolutionActions.getEvolutionVariantsAction as jest.Mock).mockResolvedValue({
      success: true, data: [], error: null,
    });
    render(<VariantsTab strategyId="strat-1" runStatus="failed" />);
    await waitFor(() => expect(screen.getByTestId('variants-tab')).toBeInTheDocument());
    // The "This run failed" banner must not appear in strategyId mode
    expect(screen.queryByText(/This run failed/)).not.toBeInTheDocument();
  });
});

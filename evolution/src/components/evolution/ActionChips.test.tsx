// Tests for ActionChips and ActionDistribution components.
// Verifies rendering of action summary badges and aggregated action count bars.

import { render, screen } from '@testing-library/react';
import { ActionChips, ActionDistribution } from './ActionChips';

describe('ActionChips', () => {
  it('renders nothing for empty actions', () => {
    const { container } = render(<ActionChips actions={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for null-like input', () => {
    const { container } = render(<ActionChips actions={null as unknown as unknown[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders action chips with labels', () => {
    const actions = [
      { type: 'ADD_TO_POOL', count: 3, variantIds: ['v1', 'v2', 'v3'] },
      { type: 'RECORD_MATCHES', matchCount: 5, ratingUpdates: 4 },
    ];
    render(<ActionChips actions={actions} />);
    expect(screen.getByTestId('action-chips')).toBeInTheDocument();
    expect(screen.getByText('Add (3)')).toBeInTheDocument();
    expect(screen.getByText('Matches (5)')).toBeInTheDocument();
  });

  it('renders SET_DIVERSITY_SCORE with formatted score', () => {
    const actions = [{ type: 'SET_DIVERSITY_SCORE', score: 0.754 }];
    render(<ActionChips actions={actions} />);
    expect(screen.getByText('Diversity 0.75')).toBeInTheDocument();
  });

  it('renders APPEND_CRITIQUES with count', () => {
    const actions = [{ type: 'APPEND_CRITIQUES', count: 2, variantIds: ['v1', 'v2'] }];
    render(<ActionChips actions={actions} />);
    expect(screen.getByText('Critiques (2)')).toBeInTheDocument();
  });

  it('renders MERGE_FLOW_SCORES with variant count', () => {
    const actions = [{ type: 'MERGE_FLOW_SCORES', variantCount: 4 }];
    render(<ActionChips actions={actions} />);
    expect(screen.getByText('FlowScores (4)')).toBeInTheDocument();
  });

  it('renders SET_META_FEEDBACK without detail', () => {
    const actions = [{ type: 'SET_META_FEEDBACK' }];
    render(<ActionChips actions={actions} />);
    expect(screen.getByText('MetaFeedback')).toBeInTheDocument();
  });

  it('renders START_NEW_ITERATION without detail', () => {
    const actions = [{ type: 'START_NEW_ITERATION' }];
    render(<ActionChips actions={actions} />);
    expect(screen.getByText('NewIter')).toBeInTheDocument();
  });

  it('renders unknown types with raw type name', () => {
    const actions = [{ type: 'CUSTOM_ACTION' }];
    render(<ActionChips actions={actions} />);
    expect(screen.getByText('CUSTOM_ACTION')).toBeInTheDocument();
  });
});

describe('ActionDistribution', () => {
  it('renders nothing for empty counts', () => {
    const { container } = render(<ActionDistribution counts={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders bars sorted by count descending', () => {
    const counts = {
      ADD_TO_POOL: 10,
      RECORD_MATCHES: 25,
      SET_DIVERSITY_SCORE: 5,
    };
    render(<ActionDistribution counts={counts} />);
    const dist = screen.getByTestId('action-distribution');
    expect(dist).toBeInTheDocument();
    // Verify all entries are present
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.getByText('Matches')).toBeInTheDocument();
    expect(screen.getByText('Diversity')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('filters out zero-count entries', () => {
    const counts = {
      ADD_TO_POOL: 5,
      RECORD_MATCHES: 0,
    };
    render(<ActionDistribution counts={counts} />);
    expect(screen.getByText('Add')).toBeInTheDocument();
    expect(screen.queryByText('Matches')).toBeNull();
  });
});

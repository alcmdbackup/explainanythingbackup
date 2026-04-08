// Tests for SnapshotsTab: renders collapsible iteration groups, start/end pool tables,
// and the discarded variants section on generate iterations.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SnapshotsTab } from './SnapshotsTab';
import * as evolutionActions from '@evolution/services/evolutionActions';
import type { IterationSnapshotRow, SnapshotVariantInfo } from '@evolution/services/evolutionActions';

jest.mock('@evolution/services/evolutionActions', () => ({
  getRunSnapshotsAction: jest.fn(),
}));

const v1Id = 'aaaaaaaa-1111-2222-3333-444444444444';
const v2Id = 'bbbbbbbb-1111-2222-3333-444444444444';
const v3Id = 'cccccccc-1111-2222-3333-444444444444';

const variantInfo: Record<string, SnapshotVariantInfo> = {
  [v1Id]: { id: v1Id, agentName: 'structural_transform', persisted: true },
  [v2Id]: { id: v2Id, agentName: 'lexical_simplify', persisted: false },
  [v3Id]: { id: v3Id, agentName: 'baseline', persisted: true },
};

const snapshots: IterationSnapshotRow[] = [
  {
    iteration: 1,
    iterationType: 'generate',
    phase: 'start',
    capturedAt: '2026-04-08T00:00:00Z',
    poolVariantIds: [v3Id],
    ratings: { [v3Id]: { mu: 25, sigma: 8.333 } },
    matchCounts: { [v3Id]: 0 },
  },
  {
    iteration: 1,
    iterationType: 'generate',
    phase: 'end',
    capturedAt: '2026-04-08T00:01:00Z',
    poolVariantIds: [v1Id, v3Id],
    ratings: {
      [v1Id]: { mu: 31.2, sigma: 4.3 },
      [v3Id]: { mu: 22.4, sigma: 5.1 },
    },
    matchCounts: { [v1Id]: 6, [v3Id]: 4 },
    discardedVariantIds: [v2Id],
    discardReasons: { [v2Id]: { mu: 18.2, top15Cutoff: 27.5 } },
  },
];

describe('SnapshotsTab', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders empty state when no snapshots', async () => {
    (evolutionActions.getRunSnapshotsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { snapshots: [], variantInfo: {} },
    });
    render(<SnapshotsTab runId="run-1" />);
    await waitFor(() =>
      expect(screen.getByTestId('snapshots-tab-empty')).toBeInTheDocument(),
    );
  });

  it('renders error when action fails', async () => {
    (evolutionActions.getRunSnapshotsAction as jest.Mock).mockResolvedValue({
      success: false,
      error: { message: 'oops' },
    });
    render(<SnapshotsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByText('oops')).toBeInTheDocument());
  });

  it('renders one collapsible group per iteration with start+end labels', async () => {
    (evolutionActions.getRunSnapshotsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { snapshots, variantInfo },
    });
    render(<SnapshotsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('snapshots-tab')).toBeInTheDocument());

    expect(screen.getByTestId('snapshot-iteration-1')).toBeInTheDocument();
    // First iteration is auto-expanded — START + END headers should both be visible.
    expect(screen.getByText(/START/)).toBeInTheDocument();
    expect(screen.getByText(/END/)).toBeInTheDocument();
  });

  it('shows discarded variants section with reason fields', async () => {
    (evolutionActions.getRunSnapshotsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { snapshots, variantInfo },
    });
    render(<SnapshotsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('snapshots-tab')).toBeInTheDocument());

    expect(screen.getByText(/Discarded during iteration 1/)).toBeInTheDocument();
    // Local mu / cutoff cells from discardReasons
    expect(screen.getByText('18.20')).toBeInTheDocument();
    expect(screen.getByText('27.50')).toBeInTheDocument();
  });

  it('toggles iteration group on header click', async () => {
    (evolutionActions.getRunSnapshotsAction as jest.Mock).mockResolvedValue({
      success: true,
      data: { snapshots, variantInfo },
    });
    render(<SnapshotsTab runId="run-1" />);
    await waitFor(() => expect(screen.getByTestId('snapshots-tab')).toBeInTheDocument());

    // Auto-expanded — clicking the header collapses it.
    const header = screen.getByText(/Iteration 1 — generate/);
    fireEvent.click(header);
    expect(screen.queryByText(/START/)).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText(/START/)).toBeInTheDocument();
  });
});

// Smoke tests for the Phase 4 lineage section: full chain + pair picker + children.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { VariantLineageSection } from './VariantLineageSection';
import type { VariantChainNode, VariantRelative } from '@evolution/services/variantDetailActions';

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatEloWithUncertainty: (elo: number, u?: number) =>
    u != null ? `${Math.round(elo)} ± ${Math.round(u)}` : String(Math.round(elo)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

jest.mock('@evolution/components/evolution/visualizations/TextDiff', () => ({
  TextDiff: ({ original, modified }: { original: string; modified: string }) => (
    <div data-testid="text-diff">
      <span data-testid="diff-original">{original}</span>
      <span data-testid="diff-modified">{modified}</span>
    </div>
  ),
}));

const mockGetChildren = jest.fn();
const mockGetFullChain = jest.fn();

jest.mock('@evolution/services/variantDetailActions', () => ({
  // Kept for legacy callers that import these — returned empty by default in these tests.
  getVariantParentsAction: jest.fn().mockResolvedValue({ success: true, data: [], error: null }),
  getVariantChildrenAction: (...args: unknown[]) => mockGetChildren(...args),
  getVariantLineageChainAction: jest.fn().mockResolvedValue({ success: true, data: [], error: null }),
  getVariantFullChainAction: (...args: unknown[]) => mockGetFullChain(...args),
}));

const seedNode: VariantChainNode = {
  id: 'seed-000000',
  runId: 'run-1',
  agentName: 'seed_variant',
  generation: 0,
  eloScore: 1200,
  uncertainty: 5,
  parentVariantId: null,
  variantContent: 'seed text',
  depth: 2,
};

const midNode: VariantChainNode = {
  id: 'mid-aaaaaa',
  runId: 'run-1',
  agentName: 'lexical_simplify',
  generation: 1,
  eloScore: 1245,
  uncertainty: 38,
  parentVariantId: 'seed-000000',
  variantContent: 'mid text',
  depth: 1,
};

const leafNode: VariantChainNode = {
  id: 'leaf-bbbbbb',
  runId: 'run-1',
  agentName: 'lexical_simplify',
  generation: 2,
  eloScore: 1272,
  uncertainty: 30,
  parentVariantId: 'mid-aaaaaa',
  variantContent: 'leaf text',
  depth: 0,
};

const childRelative: VariantRelative = {
  id: 'child-cccccc',
  eloScore: 1290,
  generation: 3,
  agentName: 'narrative',
  isWinner: false,
  preview: 'child preview',
};

describe('VariantLineageSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetChildren.mockResolvedValue({ success: true, data: [], error: null });
    mockGetFullChain.mockResolvedValue({ success: true, data: [], error: null });
  });

  it('renders empty state when no chain and no children', async () => {
    render(<VariantLineageSection variantId="leaf-bbbbbb" />);
    await waitFor(() => {
      expect(screen.getByText(/no parent or child relationships/)).toBeInTheDocument();
    });
  });

  it('renders the full chain when present', async () => {
    mockGetFullChain.mockResolvedValue({
      success: true,
      data: [seedNode, midNode, leafNode],
      error: null,
    });
    render(<VariantLineageSection variantId="leaf-bbbbbb" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-full-chain')).toBeInTheDocument();
    });
  });

  it('renders the pair picker when chain length >= 2', async () => {
    mockGetFullChain.mockResolvedValue({
      success: true,
      data: [seedNode, leafNode],
      error: null,
    });
    render(<VariantLineageSection variantId="leaf-bbbbbb" />);
    await waitFor(() => {
      expect(screen.getByTestId('lineage-pair-picker')).toBeInTheDocument();
      expect(screen.getByTestId('pair-picker-from')).toBeInTheDocument();
      expect(screen.getByTestId('pair-picker-to')).toBeInTheDocument();
    });
  });

  it('renders children when present', async () => {
    mockGetChildren.mockResolvedValue({ success: true, data: [childRelative], error: null });
    render(<VariantLineageSection variantId="leaf-bbbbbb" />);
    await waitFor(() => {
      expect(screen.getByText(/Children \(1\)/)).toBeInTheDocument();
    });
  });
});

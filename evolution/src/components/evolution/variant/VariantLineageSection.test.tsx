// Tests for VariantLineageSection: parent/children display, lineage chain, and empty state.

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { VariantLineageSection } from './VariantLineageSection';
import type { VariantRelative, LineageEntry } from '@evolution/services/variantDetailActions';

jest.mock('@evolution/lib/utils/formatters', () => ({
  formatElo: (n: number) => String(Math.round(n)),
  formatCost: (n: number) => '$' + n.toFixed(2),
}));

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}));

const mockGetParents = jest.fn();
const mockGetChildren = jest.fn();
const mockGetLineage = jest.fn();

jest.mock('@evolution/services/variantDetailActions', () => ({
  getVariantParentsAction: (...args: unknown[]) => mockGetParents(...args),
  getVariantChildrenAction: (...args: unknown[]) => mockGetChildren(...args),
  getVariantLineageChainAction: (...args: unknown[]) => mockGetLineage(...args),
}));

const parentRelative: VariantRelative = {
  id: 'parent-aaa-111',
  eloScore: 1300,
  generation: 2,
  agentName: 'refiner',
  isWinner: false,
  preview: 'Parent content preview',
};

const childRelative: VariantRelative = {
  id: 'child-bbb-222',
  eloScore: 1450,
  generation: 4,
  agentName: 'narrative',
  isWinner: true,
  preview: 'Child content preview',
};

const ancestor: LineageEntry = {
  id: 'ancestor-ccc-333',
  agentName: 'seed',
  generation: 1,
  eloScore: 1200,
  preview: 'Ancestor content preview',
};

function mockAllEmpty() {
  mockGetParents.mockResolvedValue({ success: true, data: [], error: null });
  mockGetChildren.mockResolvedValue({ success: true, data: [], error: null });
  mockGetLineage.mockResolvedValue({ success: true, data: [], error: null });
}

describe('VariantLineageSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows "Parent" heading when parents exist', async () => {
    mockGetParents.mockResolvedValue({ success: true, data: [parentRelative], error: null });
    mockGetChildren.mockResolvedValue({ success: true, data: [], error: null });
    mockGetLineage.mockResolvedValue({ success: true, data: [], error: null });

    render(<VariantLineageSection variantId="test-id" />);
    await waitFor(() => {
      expect(screen.getByText('Parent')).toBeInTheDocument();
    });
    expect(screen.getByText('parent-a')).toBeInTheDocument();
  });

  it('shows "Children" heading when children exist', async () => {
    mockGetParents.mockResolvedValue({ success: true, data: [], error: null });
    mockGetChildren.mockResolvedValue({ success: true, data: [childRelative], error: null });
    mockGetLineage.mockResolvedValue({ success: true, data: [], error: null });

    render(<VariantLineageSection variantId="test-id" />);
    await waitFor(() => {
      expect(screen.getByText('Children (1)')).toBeInTheDocument();
    });
    expect(screen.getByText('child-bb')).toBeInTheDocument();
  });

  it('shows no-lineage message when all arrays are empty', async () => {
    mockAllEmpty();

    render(<VariantLineageSection variantId="test-id" />);
    await waitFor(() => {
      expect(screen.getByText('This variant has no parent or child relationships.')).toBeInTheDocument();
    });
  });

  it('has data-testid="variant-lineage-section"', async () => {
    mockAllEmpty();

    render(<VariantLineageSection variantId="test-id" />);
    await waitFor(() => {
      expect(screen.getByTestId('variant-lineage-section')).toBeInTheDocument();
    });
  });

  it('shows ancestor chain when lineage data exists', async () => {
    mockGetParents.mockResolvedValue({ success: true, data: [], error: null });
    mockGetChildren.mockResolvedValue({ success: true, data: [], error: null });
    mockGetLineage.mockResolvedValue({ success: true, data: [ancestor], error: null });

    render(<VariantLineageSection variantId="test-id" />);
    await waitFor(() => {
      expect(screen.getByText('Ancestor Chain')).toBeInTheDocument();
    });
    expect(screen.getByText('ancestor')).toBeInTheDocument();
  });

  it('renders parent agent name and elo score', async () => {
    mockGetParents.mockResolvedValue({ success: true, data: [parentRelative], error: null });
    mockGetChildren.mockResolvedValue({ success: true, data: [], error: null });
    mockGetLineage.mockResolvedValue({ success: true, data: [], error: null });

    render(<VariantLineageSection variantId="test-id" />);
    await waitFor(() => {
      expect(screen.getByText('refiner')).toBeInTheDocument();
    });
    expect(screen.getByText('1300')).toBeInTheDocument();
  });

  it('shows winner star for winner children', async () => {
    mockGetParents.mockResolvedValue({ success: true, data: [], error: null });
    mockGetChildren.mockResolvedValue({ success: true, data: [childRelative], error: null });
    mockGetLineage.mockResolvedValue({ success: true, data: [], error: null });

    render(<VariantLineageSection variantId="test-id" />);
    await waitFor(() => {
      expect(screen.getByTitle('Winner')).toBeInTheDocument();
    });
  });
});
